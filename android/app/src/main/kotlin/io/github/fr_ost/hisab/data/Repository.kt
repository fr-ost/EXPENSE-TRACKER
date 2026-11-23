package io.github.fr_ost.hisab.data

import android.content.Context
import androidx.core.content.edit
import io.github.fr_ost.hisab.core.Backup
import io.github.fr_ost.hisab.core.Clock
import io.github.fr_ost.hisab.core.EditError
import io.github.fr_ost.hisab.core.Edits
import io.github.fr_ost.hisab.core.Ids
import io.github.fr_ost.hisab.core.LedgerData
import io.github.fr_ost.hisab.core.Recurrings
import io.github.fr_ost.hisab.core.Settings
import io.github.fr_ost.hisab.core.Sync
import io.github.fr_ost.hisab.core.SyncClock
import io.github.fr_ost.hisab.core.Synced
import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.sms.ReceivedAt
import io.github.fr_ost.hisab.core.sms.Received
import io.github.fr_ost.hisab.core.sms.SmsImport
import io.github.fr_ost.hisab.core.sms.SmsItem
import io.github.fr_ost.hisab.core.sms.SmsResult
import io.github.fr_ost.hisab.core.sms.SmsStatus
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A message the phone received: from whom, its text and when (milliseconds since 1970). */
data class IncomingSms(val sender: String, val text: String, val receivedAt: Long)

/** What came of an edit: done, or why not (and which field to point at). */
sealed interface Outcome {
    data object Done : Outcome
    data class Refused(val message: String, val field: String? = null) : Outcome
}

/**
 * The ledger for the screens: read once from the phone's storage, then kept
 * in memory and changed only through `edit`, which stamps each changed record
 * (when, and on which phone — for sync) and writes it before the screens see it.
 */
class Repository(context: Context) {
    private val store = Store(context)
    private val prefs = context.applicationContext.getSharedPreferences("hisab", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** This phone's id among the phones that share a ledger. */
    val device: String = prefs.getString(DEVICE, null) ?: Ids.new().take(8).also { prefs.edit { putString(DEVICE, it) } }

    private val clock = SyncClock()
    private val state = MutableStateFlow<LedgerData?>(null)

    /** The ledger, deleted records included; null until it has been read. */
    val data: StateFlow<LedgerData?> = state.asStateFlow()

    private val inbox = MutableStateFlow<List<WaitingSms>>(emptyList())

    /** Bank and wallet messages waiting for the person on Import SMS, newest first. */
    val waiting: StateFlow<List<WaitingSms>> = inbox.asStateFlow()

    init {
        scope.launch {
            val loaded = store.load()
            clock.observe(loaded.latestStamp())
            inbox.value = store.waiting()
            state.value = loaded
            postRecurring()
        }
    }

    /** The ledger, once it has been read. */
    suspend fun loaded(): LedgerData = state.filterNotNull().first()

    /** Add the recurring entries that have come due (when the app opens, and each day it stays open). */
    @Synchronized
    fun postRecurring() {
        val data = state.value ?: return
        commit(Recurrings.postAllDue(data, Dates.today()))
    }

    private val current: LedgerData get() = state.value ?: LedgerData()

    /** Called after each change made on this phone (to sync it). */
    var onChanged: (() -> Unit)? = null

    /** Save records (from an edit, a restore or another phone) as this phone's change. */
    @Synchronized
    fun commit(records: List<Synced>) {
        if (records.isEmpty()) return
        val stamped = records.map { it.stamped(clock.next(), device) }
        store.save(stamped)
        state.value = current.withRecords(stamped)
        onChanged?.invoke()
    }

    /** Take in what another phone holds: each record's later change wins. Returns how many records changed here. */
    @Synchronized
    fun mergeFrom(theirs: LedgerData): Int {
        val merged = Sync.merge(current, theirs)
        val changed = Sync.changed(current, merged)
        absorb(changed)
        return changed.size
    }

    /** Records that already carry their own stamps (from another phone): saved as they are. */
    @Synchronized
    fun absorb(records: List<Synced>) {
        if (records.isEmpty()) return
        records.forEach { clock.observe(it.updatedAt) }
        store.save(records)
        state.value = current.withRecords(records)
    }

    /** Make a change with the ledger's rules; a refusal changes nothing. */
    fun edit(change: (LedgerData) -> List<Synced>): Outcome = try {
        commit(change(current))
        Outcome.Done
    } catch (e: EditError) {
        Outcome.Refused(e.message ?: "That can't be saved.", e.field)
    }

    fun clock(): Clock = Clock.now()

    /** A new ledger: preferences and the starter categories. */
    fun startFresh(name: String, currency: String) {
        val now = System.currentTimeMillis()
        // The starter categories have the same ids on every phone and count as
        // the oldest change there is, so a phone that started later never undoes
        // what another phone did to them.
        absorb(Edits.starterCategories(now).map { it.stamped(1, "") })
        commit(listOf(current.settings.copy(displayName = name.trim().take(60), baseCurrency = currency)))
    }

    /**
     * Replace everything with a backup file's contents: what's here now is
     * deleted (as tombstones, so other phones follow), then the file's records
     * are saved.
     */
    suspend fun restore(text: String): Backup.Read = withContext(Dispatchers.Default) {
        val read = Backup.read(text)
        if (read is Backup.Read.Ok) {
            val keep = read.data.records().map { it::class to it.id }.toSet()
            val gone = current.live().records().filter { it !is Settings && (it::class to it.id) !in keep }.map { it.stamped(0, device, deleted = true) }
            commit(gone + read.data.records())
        }
        read
    }

    fun backupText(appVersion: String): String = Backup.write(current, Clock.now().today, System.currentTimeMillis(), appVersion)

    // ---- SMS ---------------------------------------------------------------

    /** Read bank and wallet messages as they arrive (the person turned it on, and Android allows it). */
    var readsSmsAutomatically: Boolean
        get() = prefs.getBoolean(SMS_AUTO, false)
        set(value) = prefs.edit { putBoolean(SMS_AUTO, value) }

    /**
     * Messages the phone received, oldest first (a later message's balance
     * and duplicate check build on the earlier ones): each is added when it
     * is complete and certain, dropped when it isn't a transaction, and kept
     * for the person otherwise. Results are in the order given.
     */
    @Synchronized
    fun receive(messages: List<IncomingSms>): List<Received> {
        if (current.isEmpty()) return messages.map { Received.Review }
        val clock = Clock.now()
        val remembered = SmsImport.rememberedAccounts(current, clock.today)
        val outcomes = arrayOfNulls<Received>(messages.size)
        val now = System.currentTimeMillis()
        for ((index, message) in messages.withIndex().sortedBy { it.value.receivedAt }) {
            val receivedAt = minOf(message.receivedAt, now)
            val (date, time) = Dates.local(receivedAt)
            val outcome = try {
                SmsImport.receive(current, message.text, ReceivedAt(date, time), clock, remembered)
            } catch (e: RuntimeException) {
                // One message that can't be read must not lose the others, nor itself.
                Received.Review
            }
            commit(outcome.records)
            val fingerprint = SmsImport.fingerprint(message.text)
            if (outcome == Received.Review) store.keep(WaitingSms(fingerprint, message.text.trim(), message.sender.take(40), receivedAt))
            else store.forget(listOf(fingerprint))
            outcomes[index] = outcome
        }
        inbox.value = store.waiting()
        return outcomes.map { it ?: Received.Review }
    }

    /** Add a message from Import SMS (see SmsImport.add); once it is dealt with it stops waiting. */
    @Synchronized
    fun addSms(item: SmsItem, allowDuplicate: Boolean = false, sameAs: String? = null): SmsResult {
        val result = SmsImport.add(current, item, Clock.now(), allowDuplicate, sameAs)
        commit(result.records)
        if (result.status == SmsStatus.ADDED || result.status == SmsStatus.EXISTS) dealtWith(listOf(item.text))
        return result
    }

    /** Record the balance a message reports (one added before, or one that only reports a balance). */
    @Synchronized
    fun saveSmsBalance(text: String, accountId: String, amount: Long, reportedAt: ReceivedAt?): Outcome = try {
        val (saved, records) = SmsImport.saveBalance(current, text, accountId, amount, reportedAt, Clock.now())
        commit(records)
        if (saved) {
            dealtWith(listOf(text))
            Outcome.Done
        } else {
            Outcome.Refused("That message's transaction isn't in your ledger.")
        }
    } catch (e: EditError) {
        Outcome.Refused(e.message ?: "That balance can't be saved.", e.field)
    }

    /** These messages no longer wait (added, or the person doesn't want them). */
    fun dealtWith(texts: List<String>) {
        store.forget(texts.map(SmsImport::fingerprint))
        inbox.value = store.waiting()
    }

    /** Small things this phone remembers for the person (the account last used, …). */
    fun remember(key: String, value: String?) = prefs.edit { if (value == null) remove(key) else putString(key, value) }

    fun recall(key: String): String? = prefs.getString(key, null)

    private companion object {
        const val DEVICE = "device"
        const val SMS_AUTO = "sms.auto"
    }
}
