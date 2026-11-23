package io.github.fr_ost.hisab

import android.content.Intent
import android.content.IntentSender
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.fr_ost.hisab.drive.SyncWorker
import io.github.fr_ost.hisab.ui.HisabApp
import io.github.fr_ost.hisab.ui.LocalOpens
import io.github.fr_ost.hisab.ui.LocalRepository
import io.github.fr_ost.hisab.ui.LockScreen
import io.github.fr_ost.hisab.ui.theme.HisabTheme

/** The one screen of the app (a FragmentActivity: the phone's screen-lock prompt needs one). */
class MainActivity : FragmentActivity() {
    private val app get() = application as HisabApplication

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) take(intent)
        setContent {
            HisabTheme {
                CompositionLocalProvider(LocalRepository provides app.repository, LocalOpens provides app.opens) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                        val locked by app.lock.locked.collectAsStateWithLifecycle()
                        if (locked) LockScreen(app.lock) else HisabApp()
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        app.lock.cameBack(app.repository.data.value?.settings?.autoLockMinutes ?: 5)
        // With a lock on, the recent-apps screen shows no picture of Hisab.
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(app.lock.method == AppLock.Method.NONE)
        app.repository.postRecurring()
        // Opening Hisab picks up what the other phones changed.
        if (app.drive.enabled) SyncWorker.soon(this, delaySeconds = 0)
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations) app.lock.wentAway()
    }

    // A file picker or Google's prompt opened from Hisab: coming back from it doesn't lock.
    @Deprecated("Called by the activity-result APIs")
    override fun startActivityForResult(intent: Intent, requestCode: Int, options: Bundle?) {
        app.lock.expectReturn()
        @Suppress("DEPRECATION")
        super.startActivityForResult(intent, requestCode, options)
    }

    @Deprecated("Called by the activity-result APIs")
    override fun startIntentSenderForResult(
        intent: IntentSender,
        requestCode: Int,
        fillInIntent: Intent?,
        flagsMask: Int,
        flagsValues: Int,
        extraFlags: Int,
        options: Bundle?,
    ) {
        app.lock.expectReturn()
        @Suppress("DEPRECATION")
        super.startIntentSenderForResult(intent, requestCode, fillInIntent, flagsMask, flagsValues, extraFlags, options)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        take(intent)
    }

    private fun take(intent: Intent?) {
        intent?.getStringExtra(OPEN)?.let { app.opens.value = it }
    }

    companion object {
        const val OPEN = "open"
    }
}
