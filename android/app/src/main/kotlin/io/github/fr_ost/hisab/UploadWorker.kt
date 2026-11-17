package io.github.fr_ost.hisab

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** When the outbox is sent: as soon as there is a connection, and a sweep every few hours in case. */
object Uploads {
    private const val NOW = "hand-in"
    private const val SWEEP = "hand-in-sweep"

    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun now(context: Context) {
        val request = OneTimeWorkRequest.Builder(UploadWorker::class.java)
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        val work = WorkManager.getInstance(context)
        // After a send already under way, so a message that arrives meanwhile is never skipped.
        work.enqueueUniqueWork(NOW, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        work.enqueueUniquePeriodicWork(
            SWEEP,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequest.Builder(UploadWorker::class.java, 6, TimeUnit.HOURS).setConstraints(online).build(),
        )
    }

    fun stop(context: Context) {
        val work = WorkManager.getInstance(context)
        work.cancelUniqueWork(NOW)
        work.cancelUniqueWork(SWEEP)
    }
}

/**
 * Hands the outbox to Hisab, oldest first, a batch at a time. A message
 * leaves the outbox once the site has answered for it; without a connection
 * everything waits and is tried again later.
 */
class UploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val link = Link(applicationContext)
        val store = SmsStore(applicationContext)
        val token = link.token ?: run {
            // Automatic import is off: nothing may leave the phone.
            store.clear()
            return Result.success()
        }
        val api = HisabApi(BuildConfig.SITE_URL)
        val notifier = Notifier(applicationContext)
        var waiting: Int? = null

        fun answered(batch: List<QueuedSms>, reply: Reply.Ok<HandedIn>) {
            store.remove(batch.map { it.id })
            notifier.added(reply.value.outcomes)
            waiting = reply.value.waiting
            link.lastHandedIn = System.currentTimeMillis()
        }

        fun unlinked(): Result {
            link.forget()
            store.clear()
            Uploads.stop(applicationContext)
            notifier.unlinked()
            return Result.success()
        }

        for (round in 0 until SmsStore.MAX_KEPT / BATCH) {
            val batch = store.oldest(BATCH)
            if (batch.isEmpty()) break
            when (val reply = api.handIn(token, batch)) {
                is Reply.Ok -> answered(batch, reply)
                Reply.Unlinked -> return unlinked()
                Reply.TryLater -> return Result.retry()
                is Reply.Refused -> {
                    // One message the site won't take must not hold up the rest: one at a time.
                    for (message in batch) {
                        when (val single = if (batch.size == 1) reply else api.handIn(token, listOf(message))) {
                            is Reply.Ok -> answered(listOf(message), single)
                            is Reply.Refused -> store.remove(listOf(message.id))
                            Reply.Unlinked -> return unlinked()
                            Reply.TryLater -> return Result.retry()
                        }
                    }
                }
            }
        }
        waiting?.let(notifier::waiting)
        return Result.success()
    }

    private companion object {
        /** The most the site takes at once. */
        const val BATCH = 25
    }
}
