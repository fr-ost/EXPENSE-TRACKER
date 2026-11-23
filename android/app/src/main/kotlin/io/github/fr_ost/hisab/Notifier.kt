package io.github.fr_ost.hisab

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.fr_ost.hisab.core.sms.Received
import kotlin.random.Random

/**
 * What automatic reading tells the person: each transaction it added, and
 * how many messages wait for a look. Amounts never show on the lock screen.
 */
class Notifier(context: Context) {
    private val context = context.applicationContext
    private val manager = NotificationManagerCompat.from(this.context)

    init {
        if (Build.VERSION.SDK_INT >= 26) {
            val system = this.context.getSystemService(NotificationManager::class.java)
            system.createNotificationChannel(
                NotificationChannel(ADDED, "Added from SMS", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Each transaction Hisab adds from a bank or wallet SMS."
                },
            )
            system.createNotificationChannel(
                NotificationChannel(ATTENTION, "Needs a look", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Messages Hisab couldn't add by itself."
                },
            )
        }
    }

    fun added(outcomes: List<Received>) {
        val added = outcomes.mapNotNull {
            when (it) {
                is Received.Added -> it.title to it.detail
                is Received.Balance -> it.title to it.detail
                else -> null
            }
        }
        if (added.isEmpty()) return
        if (added.size <= 3) {
            for ((title, detail) in added) post(Random.nextInt(FIRST_ADDED, Int.MAX_VALUE), build(ADDED, title, detail.ifEmpty { null }, OPEN_ACTIVITY))
            return
        }
        val title = "${added.size} transactions added from SMS"
        val style = NotificationCompat.InboxStyle().setBigContentTitle(title)
        added.take(6).forEach { style.addLine(it.first) }
        post(Random.nextInt(FIRST_ADDED, Int.MAX_VALUE), base(ADDED, title, null, OPEN_ACTIVITY).setStyle(style).build())
    }

    /** How many messages wait on Import SMS (none: the reminder goes away). */
    fun waiting(count: Int) {
        if (count <= 0) {
            manager.cancel(WAITING)
            return
        }
        val title = if (count == 1) "1 SMS needs a look" else "$count SMS need a look"
        post(WAITING, build(ATTENTION, title, "Hisab couldn't add them by itself. Tap to review.", OPEN_SMS, silent = true))
    }

    private fun base(channel: String, title: String, detail: String?, open: String, silent: Boolean = false): NotificationCompat.Builder {
        val intent = PendingIntent.getActivity(
            context,
            open.hashCode(),
            Intent(context, MainActivity::class.java)
                .putExtra(MainActivity.OPEN, open)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // What a locked phone shows instead: no amounts, no names.
        val hidden = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(if (channel == ADDED) "A transaction was added from an SMS" else "Some SMS need a look")
            .build()
        return NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.emerald))
            .setContentTitle(title)
            .setContentText(detail)
            .setContentIntent(intent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(silent)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(hidden)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
    }

    private fun build(channel: String, title: String, detail: String?, open: String, silent: Boolean = false): Notification =
        base(channel, title, detail, open, silent).build()

    /** Without permission to notify (Android 13 and later), nothing is shown. */
    @SuppressLint("MissingPermission")
    private fun post(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        manager.notify(id, notification)
    }

    companion object {
        const val OPEN_SMS = "sms"
        const val OPEN_ACTIVITY = "activity"
        private const val ADDED = "added"
        private const val ATTENTION = "attention"
        private const val WAITING = 1
        private const val FIRST_ADDED = 100
    }
}
