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
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlin.random.Random

/**
 * What automatic import tells the person: each transaction it added, how
 * many messages wait for a look, and when the phone was unlinked. Amounts
 * never show on the lock screen.
 */
class Notifier(context: Context) {
    private val context = context.applicationContext
    private val manager = NotificationManagerCompat.from(this.context)

    init {
        if (Build.VERSION.SDK_INT >= 26) {
            val system = this.context.getSystemService(NotificationManager::class.java)
            system.createNotificationChannel(
                NotificationChannel(ADDED, this.context.getString(R.string.channel_added), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = this@Notifier.context.getString(R.string.channel_added_about)
                },
            )
            system.createNotificationChannel(
                NotificationChannel(ATTENTION, this.context.getString(R.string.channel_attention), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = this@Notifier.context.getString(R.string.channel_attention_about)
                },
            )
        }
    }

    fun added(outcomes: List<Outcome>) {
        val added = outcomes.filter { it.added }
        if (added.isEmpty()) return
        if (added.size <= 3) {
            for (outcome in added) {
                post(Random.nextInt(FIRST_ADDED, Int.MAX_VALUE), build(ADDED, outcome.title.orEmpty(), outcome.detail, "/transactions"))
            }
            return
        }
        val title = context.getString(R.string.added_many, added.size)
        val style = NotificationCompat.InboxStyle().setBigContentTitle(title)
        added.take(6).forEach { style.addLine(it.title) }
        post(Random.nextInt(FIRST_ADDED, Int.MAX_VALUE), base(ADDED, title, null, "/transactions").setStyle(style).build())
    }

    /** How many messages wait on Import SMS (none: the reminder goes away). */
    fun waiting(count: Int) {
        if (count <= 0) {
            manager.cancel(WAITING)
            return
        }
        val title = context.resources.getQuantityString(R.plurals.waiting, count, count)
        post(WAITING, build(ATTENTION, title, context.getString(R.string.waiting_detail), "/sms", silent = true))
    }

    fun unlinked() {
        post(UNLINKED, build(ATTENTION, context.getString(R.string.unlinked_title), context.getString(R.string.unlinked_detail), "/settings#sms-phones"))
    }

    private fun base(channel: String, title: String, detail: String?, path: String, silent: Boolean = false): NotificationCompat.Builder {
        val open = PendingIntent.getActivity(
            context,
            path.hashCode(),
            Intent(context, LauncherActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(BuildConfig.SITE_URL + path))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // What a locked phone shows instead: no amounts, no names.
        val hidden = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(if (channel == ADDED) R.string.added_hidden else R.string.attention_hidden))
            .build()
        return NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.emerald))
            .setContentTitle(title)
            .setContentText(detail)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setOnlyAlertOnce(silent)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(hidden)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
    }

    private fun build(channel: String, title: String, detail: String?, path: String, silent: Boolean = false): Notification =
        base(channel, title, detail, path, silent).build()

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

    private companion object {
        const val ADDED = "added"
        const val ATTENTION = "attention"
        const val WAITING = 1
        const val UNLINKED = 2
        const val FIRST_ADDED = 100
    }
}
