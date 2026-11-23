package io.github.fr_ost.hisab.drive

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.fr_ost.hisab.HisabApplication
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Sync with Google Drive in the background: soon after a change, when the app opens, and every few hours. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as HisabApplication
        val drive = app.drive
        if (!drive.enabled) return Result.success()
        return when (val access = DriveAccess.ask(applicationContext)) {
            is DriveAccess.Access.Granted -> try {
                // Changes made while it ran go up too, in a second round.
                var rounds = 0
                do {
                    drive.sync(access.token)
                    rounds++
                } while (drive.hasUnsent() && rounds < 3)
                Result.success()
            } catch (e: DriveFiles.DriveError) {
                drive.problem(if (e.code == 401 || e.code == 403) "Google Drive stopped Hisab's access. Connect again." else e.message)
                if (e.code >= 500) Result.retry() else Result.success()
            } catch (e: IOException) {
                drive.problem("Couldn't reach Google Drive. Hisab tries again when you're online.")
                Result.retry()
            }
            is DriveAccess.Access.NeedsConsent -> {
                drive.problem("Google Drive needs your permission again. Open Sync to connect.")
                Result.success()
            }
            is DriveAccess.Access.Failed -> {
                drive.problem(access.message)
                Result.success()
            }
        }
    }

    companion object {
        private const val SOON = "sync-soon"
        private const val PERIODIC = "sync-periodic"
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** A sync shortly (after a change, edits in the next half minute ride along) or now. */
        fun soon(context: Context, delaySeconds: Long = 30) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(online).setInitialDelay(delaySeconds, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context).enqueueUniqueWork(SOON, ExistingWorkPolicy.KEEP, request)
        }

        fun every(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(6, TimeUnit.HOURS).setConstraints(online).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun stop(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(SOON)
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        }
    }
}
