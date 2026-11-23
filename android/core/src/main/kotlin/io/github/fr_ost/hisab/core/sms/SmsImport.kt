package io.github.fr_ost.hisab.core.sms

import io.github.fr_ost.hisab.core.Account
import io.github.fr_ost.hisab.core.AccountType
import io.github.fr_ost.hisab.core.Checkpoint
import io.github.fr_ost.hisab.core.CheckpointSource
import io.github.fr_ost.hisab.core.Clock
import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.EditError
import io.github.fr_ost.hisab.core.Edits
import io.github.fr_ost.hisab.core.EntryType
import io.github.fr_ost.hisab.core.Ids
import io.github.fr_ost.hisab.core.Ledger
import io.github.fr_ost.hisab.core.LedgerData
import io.github.fr_ost.hisab.core.Money
import io.github.fr_ost.hisab.core.Synced
import io.github.fr_ost.hisab.core.Transaction
import java.security.MessageDigest

enum class SmsStatus {
    /** Needs a look before adding (see `issues`). */
    REVIEW,
    /** Complete and confident. */
    READY,
    /** Not a transaction (a code, an advert, a failed payment…); can still be reviewed. */
    IGNORED,
    ADDED,
    /** Added earlier (the same message). */
    EXISTS,
    /** Something similar is already recorded; add anyway, link or skip. */
    DUPLICATE,
    ERROR,
}

/** A recorded movement that looks like the one a message describes. */
data class SimilarTransaction(val id: String, val description: String, val date: String, val amount: Long, val account: String)

/** One message on its way into the ledger (the website's SmsItem, src/components/sms/sms-model.ts). */
data class SmsItem(
    val text: String,
    val parsed: ParsedSms,
    val draft: SmsDraft,
    val fee: SmsDraft?,
    val includeFee: Boolean = true,
    /** Set the account's balance to the one the message reports (see `reportedBalance`). */
    val includeBalance: Boolean = true,
    /** The message's balance is recorded (now, or when it was added before). */
    val balanceSaved: Boolean = false,
    val issues: List<String>,
    /** The message's own account was found from what it says (not guessed from its kind). */
    val ownMatched: Boolean,
    val status: SmsStatus,
    /** Transactions made from this message (main first, then the fee). */
    val addedIds: List<String> = emptyList(),
    val receivedAt: ReceivedAt? = null,
    val similar: SimilarTransaction? = null,
    val error: String? = null,
    val errorField: String? = null,
)

/** What adding one message did; `records` are what to save (unstamped). */
data class SmsResult(
    val status: SmsStatus,
    val ids: List<String> = emptyList(),
    val balanceSaved: Boolean = false,
    val similar: SimilarTransaction? = null,
    val error: String? = null,
    val errorField: String? = null,
    val records: List<Synced> = emptyList(),
)

/** What happened to a message the phone received by itself. */
sealed interface Received {
    val records: List<Synced>

    /** Its transaction is in the ledger; `title` and `detail` say which, for a notification. */
    data class Added(val title: String, val detail: String, override val records: List<Synced>) : Received
    /** It only reported a balance, which is now the account's. */
    data class Balance(val title: String, val detail: String, override val records: List<Synced>) : Received
    /** Added earlier (perhaps now with the balance it reports). */
    data class Exists(override val records: List<Synced>) : Received
    /** Keep it for the person to look at on Import SMS. */
    data object Review : Received { override val records: List<Synced> get() = emptyList() }
    /** Not a transaction: not kept. */
    data object Ignored : Received { override val records: List<Synced> get() = emptyList() }
}

/**
 * The website's SMS import (src/lib/server/services/sms.ts and
 * sms-inbox.ts), on the phone. Each message has a fingerprint of its
 * normalised text — the website's own, so a backup moved between them still
 * knows which messages were added — and its transaction is stored under
 * "sms:<fingerprint>:0", its fee under ":1" and the balance it reports under
 * ":b", with ids made from the same key: the same message is never added
 * twice, here, on another phone or after a restore.
 */
object SmsImport {
    private val SPACES = Regex("(?U)\\s+")

    fun fingerprint(text: String): String {
        val normalized = SmsParser.normalize(text).lowercase().replace(SPACES, " ")
        val digest = MessageDigest.getInstance("SHA-256").digest(normalized.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }.take(40)
    }

    fun key(text: String, part: String) = "sms:${fingerprint(text)}:$part"

    /** The same message, whatever its spacing or case. */
    fun messageKey(text: String) = SmsParser.normalize(text).lowercase().replace(SPACES, " ")

    // ---- Reading -------------------------------------------------------------

    /**
     * The account each bank or wallet's earlier messages were recorded on, read
     * from the ledger: every SMS transaction keeps its message as its note.
     */
    fun rememberedAccounts(data: LedgerData, today: String): Map<String, String> {
        val rows = data.live().transactions
            .filter { it.smsKey?.startsWith("sms:") == true && it.smsKey.endsWith(":0") && !it.notes.isNullOrEmpty() }
            .sortedByDescending { it.createdAt }
            .take(300)
            .reversed()
        val remembered = mutableMapOf<String, String>()
        for (row in rows) {
            val parsed = runCatching { SmsParser.parse(row.notes!!, today) }.getOrNull() ?: continue
            val own = if (row.type == EntryType.TRANSFER && parsed.direction == Direction.CREDIT) row.toAccountId else row.accountId
            val key = SmsSuggest.rememberKey(parsed)
            if (key == null || own == null) continue
            remembered[key] = own
            parsed.provider?.let { remembered["${it.id}:"] = own }
        }
        return remembered
    }

    /** How the same description was recorded last time, to repeat the person's own choices. */
    fun learned(data: LedgerData, description: String): LearnedEntry? {
        if (description.isEmpty()) return null
        val match = data.live().transactions
            .filter { it.type != EntryType.ADJUSTMENT && it.description.equals(description, ignoreCase = true) }
            .maxByOrNull { it.createdAt } ?: return null
        return LearnedEntry(match.type, match.accountId, match.toAccountId, match.categoryId, match.scope, match.countAsExpense)
    }

    /** Transactions already made from this message (main first), and whether its balance is recorded. */
    fun existing(data: LedgerData, text: String): Pair<List<String>, Boolean> {
        val prefix = "sms:${fingerprint(text)}:"
        val live = data.live()
        val ids = live.transactions.filter { it.smsKey == "${prefix}0" || it.smsKey == "${prefix}1" }.sortedBy { it.smsKey }.map { it.id }
        val saved = live.checkpoints.any { it.smsKey == "${prefix}b" }
        return ids to saved
    }

    /** Read a message against the ledger: what it is, which accounts, and whether it was added before. */
    fun build(
        text: String,
        data: LedgerData,
        today: String,
        remembered: Map<String, String>,
        receivedAt: ReceivedAt? = null,
    ): SmsItem {
        val live = data.live()
        val parsed = SmsParser.parse(text, today, receivedAt)
        val learned = learned(live, parsed.description)
        val suggestion = SmsSuggest.suggest(parsed, live.accounts, live.categories, today, remembered, learned)
        val (existing, balanceSaved) = existing(live, text)
        val status = when {
            existing.isNotEmpty() -> SmsStatus.EXISTS
            parsed.ignored != null -> SmsStatus.IGNORED
            suggestion.ready -> SmsStatus.READY
            else -> SmsStatus.REVIEW
        }
        return SmsItem(
            text = text.trim(),
            parsed = parsed,
            draft = suggestion.draft,
            fee = suggestion.fee,
            balanceSaved = balanceSaved,
            issues = suggestion.issues,
            ownMatched = suggestion.ownMatch == SmsSuggestion.Match.MATCHED,
            status = status,
            addedIds = existing,
            receivedAt = receivedAt,
        )
    }

    /** The message read again against the ledger as it is now (e.g. after an account was added for it). */
    fun rematch(item: SmsItem, data: LedgerData, today: String, remembered: Map<String, String>): SmsItem {
        val fresh = build(item.text, data, today, remembered, item.receivedAt)
        if (missingAccount(fresh) != null && fresh.status != SmsStatus.IGNORED) return item
        return fresh.copy(includeFee = item.includeFee, includeBalance = item.includeBalance)
    }

    /** The account the message is about (money into it for a credit transfer, out of it otherwise). */
    fun ownAccountId(item: SmsItem): String? =
        if (item.draft.type == EntryType.TRANSFER && item.parsed.direction == Direction.CREDIT) item.draft.toAccountId else item.draft.accountId

    /**
     * The balance a message would set for its own account, or null when it
     * shouldn't: no balance in it, another currency, or a card (a card's
     * messages report limits and amounts due, not what the card holds).
     */
    fun reportedBalance(item: SmsItem, accounts: List<Account>, today: String): Pair<Account, Long>? {
        val balance = item.parsed.balance ?: return null
        val account = accounts.firstOrNull { it.id == ownAccountId(item) && !it.deleted } ?: return null
        if (account.type == AccountType.CARD || item.draft.date > today) return null
        if (item.parsed.balanceCurrency != null && item.parsed.balanceCurrency != account.currency) return null
        return account to balance
    }

    /** A message that only reports a balance ("Your balance is Tk 8,000"). */
    fun isBalanceOnly(item: SmsItem) = item.parsed.ignored == IgnoreReason.NO_AMOUNT && item.parsed.balance != null

    /** Added earlier, but the balance it reports isn't recorded yet (and can be). */
    fun needsBalanceSaved(item: SmsItem, accounts: List<Account>, today: String): Boolean {
        val waiting = item.status == SmsStatus.EXISTS || (item.status == SmsStatus.IGNORED && isBalanceOnly(item))
        return waiting && item.includeBalance && !item.balanceSaved && reportedBalance(item, accounts, today) != null
    }

    enum class Missing { OWN, CASH }

    /** Waiting to be added, but its own account (or a withdrawal's Cash account) doesn't exist yet. */
    fun missingAccount(item: SmsItem): Missing? {
        if (item.status !in setOf(SmsStatus.READY, SmsStatus.REVIEW, SmsStatus.ERROR)) return null
        if (ownAccountId(item).isNullOrEmpty()) return Missing.OWN
        val counterpart = if (item.parsed.direction == Direction.CREDIT) item.draft.accountId else item.draft.toAccountId
        val viaCash = item.parsed.channel in setOf(Channel.ATM, Channel.CASH_OUT, Channel.CASH_IN)
        return if (item.draft.type == EntryType.TRANSFER && counterpart.isNullOrEmpty() && viaCash) Missing.CASH else null
    }

    /** An account to make for a message that has nowhere to go. */
    data class AccountSuggestion(val name: String, val type: AccountType, val openingBalance: Long, val openingDate: String)

    fun suggestAccount(item: SmsItem, baseCurrency: String): AccountSuggestion? {
        val missing = missingAccount(item) ?: return null
        val parsed = item.parsed
        val draft = item.draft
        if (missing == Missing.CASH) return AccountSuggestion("Cash", AccountType.CASH, 0, draft.date)
        val digits = parsed.accountDigits?.let { " $it" } ?: ""
        val type = if (parsed.isCard) AccountType.CARD else parsed.provider?.kind ?: if (parsed.accountDigits != null) AccountType.BANK else AccountType.OTHER
        val name = when (type) {
            AccountType.CARD -> "${parsed.provider?.name ?: ""} Card$digits".trim()
            AccountType.BANK -> "${parsed.provider?.name ?: "Bank"}$digits"
            else -> parsed.provider?.name ?: ""
        }
        // What it held before this message's transaction, so the balance the message reports then holds.
        var opening = 0L
        val balance = parsed.balance
        if (type != AccountType.CARD && balance != null && (parsed.balanceCurrency == null || parsed.balanceCurrency == baseCurrency)) {
            val incoming = draft.type == EntryType.INCOME || (draft.type == EntryType.TRANSFER && parsed.direction == Direction.CREDIT)
            val amount = draft.amount
            val received = if (incoming && draft.type == EntryType.TRANSFER && draft.toAmount != null) draft.toAmount else amount
            var delta = if (amount == null) 0L else if (incoming) received ?: 0L else -amount
            if (!incoming && item.includeFee && item.fee?.amount != null) delta -= item.fee.amount
            opening = balance - delta
        }
        return AccountSuggestion(name.take(60), type, opening, draft.date)
    }

    // ---- Adding --------------------------------------------------------------

    /**
     * A recorded movement of the same amount, the same way, on the same
     * account within a day — e.g. the spending was typed in by hand already,
     * or a transfer was added from the other bank's message.
     */
    fun findSimilar(data: LedgerData, row: Transaction): SimilarTransaction? {
        val live = data.live()
        val accounts = live.accounts.associateBy { it.id }
        val movements = buildList {
            add(row.accountId to if (row.type == EntryType.INCOME) row.amount else -row.amount)
            if (row.type == EntryType.TRANSFER && row.toAccountId != null) add(row.toAccountId to (row.toAmount ?: row.amount))
        }
        data class Leg(val t: Transaction, val accountId: String, val amount: Long)
        val legs = live.transactions.filter { it.type != EntryType.ADJUSTMENT && it.id != row.id && it.accountId in accounts }.flatMap { t ->
            val outgoing = t.type == EntryType.EXPENSE || t.type == EntryType.TRANSFER
            buildList {
                add(Leg(t, t.accountId, if (outgoing) -t.amount else t.amount))
                if (t.type == EntryType.TRANSFER && t.toAccountId != null && t.toAccountId in accounts) add(Leg(t, t.toAccountId, t.toAmount ?: t.amount))
            }
        }
        for ((accountId, amount) in movements) {
            val match = legs
                .filter { it.accountId == accountId && it.amount == amount && kotlin.math.abs(Dates.daysBetween(row.date, it.t.date)) <= 1 }
                .minWithOrNull(compareBy<Leg> { kotlin.math.abs(Dates.daysBetween(row.date, it.t.date)) }.thenByDescending { it.t.createdAt })
            if (match != null) {
                return SimilarTransaction(match.t.id, match.t.description, match.t.date, match.t.amount, accounts[match.t.accountId]?.name ?: "")
            }
        }
        return null
    }

    /**
     * An SMS balance replaces the account's balance — nothing is added to it.
     * The newest message for an account (none sent later, and no balance
     * entered by hand for a later moment) sets the balance as of now:
     * everything already recorded is taken as included, so the account shows
     * exactly what the bank or wallet said. An older message is kept as
     * history at its own moment.
     */
    private fun smsCheckpoint(
        data: LedgerData,
        key: String,
        accountId: String,
        amount: Long,
        messageDate: String,
        messageTime: String?,
        loggedTime: String?,
        clock: Clock,
        now: Long,
    ): Checkpoint {
        val at = messageTime ?: Ledger.END_OF_DAY
        val newer = data.live().checkpoints.any { c ->
            c.accountId == accountId && when (c.source) {
                CheckpointSource.SMS -> {
                    val date = c.messageDate ?: c.date
                    date > messageDate || (date == messageDate && (c.messageTime ?: Ledger.END_OF_DAY) > at)
                }
                CheckpointSource.MANUAL -> c.date > messageDate || (c.date == messageDate && (c.time ?: c.loggedTime ?: Ledger.END_OF_DAY) > at)
            }
        }
        val current = !newer && messageDate <= clock.today
        // It holds from now — or from its own time, if the message is stamped
        // later than now (clocks differ by a minute or two), so it still
        // follows its own transaction.
        val ahead = messageTime != null && messageDate == clock.today && clock.time != null && messageTime > clock.time.take(5)
        val base = Checkpoint(
            id = Ids.stable(key),
            accountId = accountId,
            date = messageDate,
            time = messageTime,
            loggedTime = if (messageTime != null) null else loggedTime,
            balance = amount,
            source = CheckpointSource.SMS,
            smsKey = key,
            messageDate = messageDate,
            messageTime = messageTime,
            createdAt = now,
        )
        return if (current && !ahead) base.copy(date = clock.today, time = null, loggedTime = clock.time) else base
    }

    /** The balance a message reports, for the account it belongs to, once per message. */
    private fun reportedCheckpoint(
        data: LedgerData,
        text: String,
        balance: Pair<String, Long>?,
        row: Transaction,
        clock: Clock,
        now: Long,
    ): Pair<Boolean, Checkpoint?> {
        if (balance == null || (balance.first != row.accountId && balance.first != row.toAccountId)) return false to null
        val key = key(text, "b")
        if (data.live().checkpoints.any { it.smsKey == key }) return true to null
        return true to smsCheckpoint(data, key, balance.first, balance.second, row.date, row.time, row.loggedTime, clock, now)
    }

    /**
     * Add a message's transaction, its fee and the balance it reports, all or
     * nothing. `balance` is the account and amount to set (see
     * `reportedBalance`), `sameAs` a recorded transaction the person says this
     * message is, and `allowDuplicate` adds it even when something similar is
     * recorded.
     */
    fun add(
        data: LedgerData,
        item: SmsItem,
        clock: Clock,
        allowDuplicate: Boolean = false,
        sameAs: String? = null,
        now: Long = System.currentTimeMillis(),
    ): SmsResult {
        val live = data.live()
        val mainKey = key(item.text, "0")
        val feeKey = key(item.text, "1")
        val balance = if (item.includeBalance) reportedBalance(item, live.accounts, clock.today)?.let { it.first.id to it.second } else null

        val fromThisMessage = live.transactions.filter { it.smsKey == mainKey || it.smsKey == feeKey }.sortedBy { it.smsKey }
        if (fromThisMessage.isNotEmpty()) {
            // Added before — perhaps without its balance: record that now.
            val main = fromThisMessage.firstOrNull { it.smsKey == mainKey }
            val (saved, checkpoint) = main?.let { reportedCheckpoint(live, item.text, balance, it, clock, now) } ?: (false to null)
            return SmsResult(SmsStatus.EXISTS, fromThisMessage.map { it.id }, saved, records = listOfNotNull(checkpoint))
        }
        return try {
            if (sameAs != null) return linkToRecorded(live, item, sameAs, mainKey, balance, clock, now)

            val row = Edits.resolve(live, item.draft.toInput(), clock, Ids.stable(mainKey), now).copy(smsKey = mainKey)
            if (!allowDuplicate) {
                // Not added (nor its balance recorded) until the person says
                // whether it's the same transaction or another one.
                findSimilar(live, row)?.let { return SmsResult(SmsStatus.DUPLICATE, similar = it) }
            }
            val created = mutableListOf<Synced>(row)
            val fee = item.fee?.takeIf { item.includeFee && it.amount != null }
            if (fee != null) {
                // The fee comes out of the message's own account, on the same date, whatever was edited above.
                val input = fee.copy(accountId = ownAccountId(item), date = item.draft.date, time = item.draft.time).toInput()
                if (input.type != EntryType.EXPENSE) throw EditError("A fee is spending.", "fee")
                val feeRow = try {
                    Edits.resolve(live.withRecords(created), input, clock, Ids.stable(feeKey), now).copy(smsKey = feeKey)
                } catch (error: EditError) {
                    throw EditError(error.message ?: "Check the fee.", "fee.${error.field ?: "amount"}")
                }
                created += feeRow
            }
            val (saved, checkpoint) = reportedCheckpoint(live.withRecords(created), item.text, balance, row, clock, now)
            SmsResult(SmsStatus.ADDED, created.map { it.id }, saved, records = created + listOfNotNull(checkpoint))
        } catch (error: EditError) {
            SmsResult(SmsStatus.ERROR, error = error.message, errorField = error.field)
        }
    }

    /**
     * The person confirmed a flagged message is a transaction already
     * recorded (e.g. typed in by hand). The message becomes its record: the
     * transaction takes the message's date and time — the bank's clock beats
     * a guess — so the balance the message reports lands right after it, and
     * the same message read again finds it.
     */
    private fun linkToRecorded(
        live: LedgerData,
        item: SmsItem,
        targetId: String,
        mainKey: String,
        balance: Pair<String, Long>?,
        clock: Clock,
        now: Long,
    ): SmsResult {
        val target = live.transactions.firstOrNull { it.id == targetId && it.type != EntryType.ADJUSTMENT }
            ?: throw EditError("That transaction no longer exists.")
        val date = item.draft.date
        val time = item.draft.time ?: target.time
        val unmoved = target.date == date && target.time == time
        val linked = target.copy(
            date = date,
            time = time,
            loggedTime = if (time != null) null else if (unmoved) target.loggedTime else Ledger.loggedTimeFor(date, null, clock),
            // Keep a key another message already gave it (the other side of a transfer).
            smsKey = if (target.smsKey?.startsWith("sms:") == true) target.smsKey else mainKey,
        )
        val (saved, checkpoint) = reportedCheckpoint(live.withRecords(listOf(linked)), item.text, balance, linked, clock, now)
        return SmsResult(SmsStatus.EXISTS, listOf(linked.id), saved, records = listOfNotNull(linked, checkpoint))
    }

    /**
     * Record the balance a message reports without adding anything: a message
     * added earlier, or one that only reports a balance, dated `reportedAt`.
     * Returns whether it is saved, and what to save.
     */
    fun saveBalance(
        data: LedgerData,
        text: String,
        accountId: String,
        amount: Long,
        reportedAt: ReceivedAt?,
        clock: Clock,
        now: Long = System.currentTimeMillis(),
    ): Pair<Boolean, List<Synced>> {
        val live = data.live()
        val main = live.transactions.firstOrNull { it.smsKey == key(text, "0") }
        if (main != null) {
            val (saved, checkpoint) = reportedCheckpoint(live, text, accountId to amount, main, clock, now)
            return saved to listOfNotNull(checkpoint)
        }
        if (reportedAt == null) return false to emptyList()
        val key = key(text, "b")
        if (live.checkpoints.any { it.smsKey == key }) return true to emptyList()
        val account = live.accounts.firstOrNull { it.id == accountId } ?: throw EditError("That account no longer exists.")
        if (account.type == AccountType.CARD) throw EditError("A card's SMS reports a limit or amount due, not a balance.")
        if (reportedAt.date > clock.today) throw EditError("The message is dated in the future.")
        val loggedTime = Ledger.loggedTimeFor(reportedAt.date, reportedAt.time, clock)
        return true to listOf(smsCheckpoint(live, key, accountId, amount, reportedAt.date, reportedAt.time, loggedTime, clock, now))
    }

    // ---- Messages the phone receives by itself ---------------------------------

    /**
     * A message the phone just received, read exactly as Import SMS reads a
     * pasted one: not a transaction → dropped; complete and certain → added
     * (with its fee and balance); anything else → kept for the person.
     */
    fun receive(
        data: LedgerData,
        text: String,
        receivedAt: ReceivedAt,
        clock: Clock,
        remembered: Map<String, String> = rememberedAccounts(data, clock.today),
        now: Long = System.currentTimeMillis(),
    ): Received {
        val live = data.live()
        // A phone's clock can run ahead; a message can't arrive after now.
        val now5 = clock.time?.take(5)
        val ahead = receivedAt.date > clock.today || (receivedAt.date == clock.today && now5 != null && (receivedAt.time ?: "") > now5)
        val item = build(text, live, clock.today, remembered, if (ahead) ReceivedAt(clock.today, now5) else receivedAt)
        val settings = live.settings
        fun money(value: Long, currency: String?) =
            Money.format(value, currency ?: settings.baseCurrency, settings.numberFormat)

        if (isBalanceOnly(item)) {
            // "Your balance is Tk 8,000": nothing to add, but it is the account's balance — when the message says whose.
            val reported = if (item.ownMatched) reportedBalance(item, live.accounts, clock.today) else null
            if (reported == null) return Received.Review
            val (saved, records) = try {
                saveBalance(live, text, reported.first.id, reported.second, ReceivedAt(item.draft.date, item.draft.time), clock, now)
            } catch (_: EditError) {
                false to emptyList()
            }
            if (!saved) return Received.Review
            return Received.Balance("Balance ${money(reported.second, reported.first.currency)}", reported.first.name, records)
        }
        if (item.parsed.ignored != null) return Received.Ignored

        if (item.status == SmsStatus.EXISTS) {
            val reported = if (needsBalanceSaved(item, live.accounts, clock.today)) reportedBalance(item, live.accounts, clock.today) else null
            val records = reported?.let {
                runCatching { saveBalance(live, text, it.first.id, it.second, null, clock, now).second }.getOrDefault(emptyList())
            }.orEmpty()
            return Received.Exists(records)
        }
        if (item.status == SmsStatus.READY) {
            val result = add(live, item, clock, now = now)
            when (result.status) {
                SmsStatus.ADDED -> {
                    val own = live.accounts.firstOrNull { it.id == ownAccountId(item) }
                    val source = live.accounts.firstOrNull { it.id == item.draft.accountId } ?: own
                    val verb = when (item.draft.type) {
                        EntryType.INCOME -> "Received"
                        EntryType.TRANSFER -> "Moved"
                        else -> "Spent"
                    }
                    val title = listOf("$verb ${money(item.draft.amount ?: 0, source?.currency)}", item.draft.description).filter { it.isNotEmpty() }.joinToString(" · ")
                    val detail = listOfNotNull(
                        own?.name,
                        item.fee?.amount?.takeIf { item.includeFee }?.let { "fee ${money(it, own?.currency)}" },
                        item.parsed.balance?.takeIf { result.balanceSaved }?.let { "balance ${money(it, own?.currency)}" },
                    ).joinToString(" · ")
                    return Received.Added(title, detail, result.records)
                }
                SmsStatus.EXISTS -> return Received.Exists(result.records)
                // Something similar is recorded, or the ledger's rules refuse it: the person decides.
                else -> {}
            }
        }
        return Received.Review
    }
}
