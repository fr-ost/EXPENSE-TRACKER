package io.github.fr_ost.hisab

import android.app.Application
import io.github.fr_ost.hisab.data.Repository
import io.github.fr_ost.hisab.drive.DriveSync
import io.github.fr_ost.hisab.drive.SyncWorker
import kotlinx.coroutines.flow.MutableStateFlow

class HisabApplication : Application() {
    val repository: Repository by lazy {
        Repository(this).also { repository ->
            // Each change made here goes to Google Drive shortly, when sync is on.
            repository.onChanged = { if (drive.enabled) SyncWorker.soon(this) }
        }
    }

    val drive: DriveSync by lazy { DriveSync(this, repository) }

    val lock: AppLock by lazy { AppLock(this) }

    /** Where a notification asked the app to open ("sms", "activity"), until the screens take it. */
    val opens = MutableStateFlow<String?>(null)
}
