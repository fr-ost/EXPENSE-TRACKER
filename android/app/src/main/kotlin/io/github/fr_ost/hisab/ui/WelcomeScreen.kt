package io.github.fr_ost.hisab.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import io.github.fr_ost.hisab.HisabApplication
import io.github.fr_ost.hisab.R
import io.github.fr_ost.hisab.drive.SyncWorker
import io.github.fr_ost.hisab.core.Backup
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The first time Hisab opens: start a new ledger, or bring one in from a backup file. */
@Composable
fun WelcomeScreen() {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var currency by remember { mutableStateOf("BDT") }
    var busy by remember { mutableStateOf(false) }

    val app = context.applicationContext as HisabApplication
    val fromDrive = rememberDriveAccess(onToken = { token ->
        busy = true
        try {
            app.drive.sync(token)
            if (repository.data.value?.isEmpty() != false) {
                messages.show("There's no Hisab ledger in this Google account's Drive yet.")
            } else {
                app.drive.enable(true)
                SyncWorker.every(context)
            }
        } catch (e: Exception) {
            messages.show(driveProblem(e))
        } finally {
            busy = false
        }
    }, onProblem = { messages.show(it) })

    val open = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true
        scope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } }.getOrNull()
            }
            val result = if (text == null) Backup.Read.Bad("Couldn't read that file.") else repository.restore(text)
            busy = false
            if (result is Backup.Read.Bad) messages.show(result.message)
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Image(painterResource(R.drawable.splash), contentDescription = null, modifier = Modifier.size(56.dp))
        Text("Welcome to Hisab", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Your private ledger: accounts, spending, budgets and reports. Everything stays on this phone, and can sync through your own Google Drive.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(name, { name = it.take(60) }, label = { Text("Your name (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        PickerField("Main currency", currency, Format.CURRENCIES, { it }, { currency = it }, Modifier.fillMaxWidth())
        Button(onClick = { repository.startFresh(name, currency) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Start") }
        OutlinedButton(onClick = { fromDrive() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text("Restore from Google Drive")
        }
        OutlinedButton(onClick = { open.launch(arrayOf("application/json", "application/octet-stream", "text/plain")) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text(if (busy) "Restoring…" else "Restore a backup file")
        }
        Text(
            "Used Hisab on the web? Download a backup there (Settings → Backup and restore) and restore it here: everything comes along.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
