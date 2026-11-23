package io.github.fr_ost.hisab

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import io.github.fr_ost.hisab.drive.SyncWorker
import io.github.fr_ost.hisab.ui.HisabApp
import io.github.fr_ost.hisab.ui.LocalOpens
import io.github.fr_ost.hisab.ui.LocalRepository
import io.github.fr_ost.hisab.ui.theme.HisabTheme

class MainActivity : ComponentActivity() {
    private val app get() = application as HisabApplication

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) take(intent)
        setContent {
            HisabTheme {
                CompositionLocalProvider(LocalRepository provides app.repository, LocalOpens provides app.opens) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { HisabApp() }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Opening Hisab picks up what the other phones changed.
        if (app.drive.enabled) SyncWorker.soon(this, delaySeconds = 0)
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
