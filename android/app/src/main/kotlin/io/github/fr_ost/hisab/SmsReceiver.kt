package io.github.fr_ost.hisab

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import io.github.fr_ost.hisab.core.sms.Received
import io.github.fr_ost.hisab.data.IncomingSms
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Every SMS the phone receives passes through here while automatic reading
 * is on. Bank and wallet messages about money are read into the ledger, on
 * this phone (SmsImport.receive); everything else is left alone and never
 * read any further. Nothing is sent anywhere.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val app = context.applicationContext as HisabApplication
        if (!app.repository.readsSmsAutomatically) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent).orEmpty().mapNotNull { part ->
            val body = part?.messageBody ?: return@mapNotNull null
            val sender = part.originatingAddress ?: part.displayOriginatingAddress ?: return@mapNotNull null
            OutgoingSms(sender, body, part.timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis())
        }
        val messages = SmsFilter.join(parts).filter { SmsFilter.shouldSend(it.sender, it.body) }
        if (messages.isEmpty()) return

        // A moment's work, off the main thread.
        val pending = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                SmsReading.read(app, messages)
            } finally {
                pending.finish()
            }
        }
    }
}

/** Reading messages into the ledger, from the receiver or from the inbox. */
object SmsReading {
    /** The longest Hisab looks back into the inbox. */
    const val RECENT_DAYS = 30

    /** Read messages into the ledger; returns how many were added (or set a balance). */
    suspend fun read(app: HisabApplication, messages: List<OutgoingSms>, notify: Boolean = true): Int {
        val repository = app.repository
        repository.loaded()
        val outcomes = repository.receive(messages.map { IncomingSms(it.sender, it.body.trim(), it.receivedAt) })
        val notifier = Notifier(app)
        if (notify) notifier.added(outcomes)
        notifier.waiting(repository.waiting.value.size)
        return outcomes.count { it is Received.Added || it is Received.Balance }
    }

    /** Bank and wallet messages about money from the last `days` days, oldest first (needs READ_SMS). */
    fun recentInbox(context: Context, days: Int = RECENT_DAYS): List<OutgoingSms> {
        val since = System.currentTimeMillis() - days * 86_400_000L
        val columns = arrayOf(Telephony.TextBasedSmsColumns.ADDRESS, Telephony.TextBasedSmsColumns.BODY, Telephony.TextBasedSmsColumns.DATE)
        val found = mutableListOf<OutgoingSms>()
        context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            columns,
            "${Telephony.TextBasedSmsColumns.DATE} >= ?",
            arrayOf(since.toString()),
            "${Telephony.TextBasedSmsColumns.DATE} ASC",
        )?.use { cursor ->
            while (cursor.moveToNext() && found.size < MAX_RECENT) {
                val sender: String? = cursor.getString(0)
                val body: String? = cursor.getString(1)
                if (sender != null && body != null && SmsFilter.shouldSend(sender, body)) {
                    found += OutgoingSms(sender, body.trim(), cursor.getLong(2))
                }
            }
        }
        return found
    }

    private const val MAX_RECENT = 1000
}
