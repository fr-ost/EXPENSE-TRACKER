package io.github.fr_ost.hisab

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import io.github.fr_ost.hisab.ui.HisabApp
import io.github.fr_ost.hisab.ui.LocalRepository
import io.github.fr_ost.hisab.ui.theme.HisabTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val repository = (application as HisabApplication).repository
        setContent {
            HisabTheme {
                CompositionLocalProvider(LocalRepository provides repository) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { HisabApp() }
                }
            }
        }
    }
}
