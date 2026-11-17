package io.github.fr_ost.hisab

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Every SMS the phone receives passes through here while automatic import is
 * on. Bank and wallet messages about money go into the outbox and on to
 * Hisab; everything else is left alone and never read any further.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (Link(context).token == null) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent).orEmpty().mapNotNull { part ->
            val body = part?.messageBody ?: return@mapNotNull null
            val sender = part.originatingAddress ?: part.displayOriginatingAddress ?: return@mapNotNull null
            OutgoingSms(sender, body, part.timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis())
        }
        val messages = SmsFilter.join(parts).filter { SmsFilter.shouldSend(it.sender, it.body) }
        if (messages.isEmpty()) return

        // A moment's disk work, off the main thread.
        val pending = goAsync()
        Thread {
            try {
                SmsStore(context).add(messages)
                Uploads.now(context)
            } finally {
                pending.finish()
            }
        }.start()
    }
}
