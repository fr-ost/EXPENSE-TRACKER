package io.github.fr_ost.hisab.ui

import android.content.Context
import android.text.format.DateUtils
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.fr_ost.hisab.HisabApplication
import io.github.fr_ost.hisab.drive.DriveAccess
import io.github.fr_ost.hisab.drive.DriveFiles
import io.github.fr_ost.hisab.drive.SyncWorker
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * Asking for Google Drive, from a screen: Google's own permission prompt when
 * it wants one, then `onToken` with a token (or `onProblem` with what went wrong).
 */
@Composable
fun rememberDriveAccess(onToken: suspend (String) -> Unit, onProblem: (String) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val consent = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        when (val access = DriveAccess.fromConsent(context, result.data)) {
            is DriveAccess.Access.Granted -> scope.launch { onToken(access.token) }
            is DriveAccess.Access.Failed -> onProblem(access.message)
            is DriveAccess.Access.NeedsConsent -> onProblem("Google Drive wasn't allowed.")
        }
    }
    return {
        scope.launch {
            when (val access = DriveAccess.ask(context)) {
                is DriveAccess.Access.Granted -> onToken(access.token)
                is DriveAccess.Access.NeedsConsent -> consent.launch(IntentSenderRequest.Builder(access.intent.intentSender).build())
                is DriveAccess.Access.Failed -> onProblem(access.message)
            }
        }
    }
}

/** What went wrong talking to Drive, in words. */
fun driveProblem(e: Exception): String = when (e) {
    is DriveFiles.DriveError -> if (e.code == 401 || e.code == 403) "Google Drive refused Hisab's access. Connect again." else (e.message ?: "Google Drive failed.")
    is IOException -> "Couldn't reach Google Drive. Check your connection."
    else -> e.message ?: "Sync failed."
}

private fun ago(context: Context, millis: Long): String =
    if (millis <= 0) "never" else DateUtils.getRelativeTimeSpanString(millis, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()

/** Sync with Google Drive: on or off, sync now, and removing Hisab's copy from Drive. */
@Composable
fun SyncScreen(book: Book) {
    val context = LocalContext.current
    val app = context.applicationContext as HisabApplication
    val drive = app.drive
    val messages = LocalMessages.current
    val status by drive.status.collectAsStateWithLifecycle()
    var combine by remember { mutableStateOf<String?>(null) }
    var confirmRemove by remember { mutableStateOf(false) }
    var working by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun syncNow(token: String, first: Boolean) {
        working = true
        try {
            val report = drive.sync(token)
            if (first) {
                drive.enable(true)
                SyncWorker.every(context)
            }
            messages.show(
                when {
                    report.received > 0 -> "Synced: ${report.received} ${if (report.received == 1) "change" else "changes"} from your other phones"
                    report.otherPhones == 0 -> "Synced. Your other phones join by turning on sync with the same Google account."
                    else -> "Synced: everything is up to date"
                },
            )
        } catch (e: Exception) {
            drive.problem(driveProblem(e))
            messages.show(driveProblem(e))
        } finally {
            working = false
        }
    }

    val turnOn = rememberDriveAccess(onToken = { token ->
        // Another phone's ledger in Drive and one on this phone too: say they will be combined.
        val others = runCatching { drive.othersInDrive(token) }.getOrDefault(0)
        if (others > 0 && book.live.accounts.isNotEmpty()) combine = token else syncNow(token, first = true)
    }, onProblem = { messages.show(it) })
    val now = rememberDriveAccess(onToken = { syncNow(it, first = false) }, onProblem = {
        drive.problem(it)
        messages.show(it)
    })
    val remove = rememberDriveAccess(onToken = { token ->
        working = true
        try {
            val count = drive.removeFromDrive(token)
            SyncWorker.stop(context)
            messages.show(if (count == 0) "Nothing of Hisab's was in Drive" else "Removed Hisab's files from Google Drive")
        } catch (e: Exception) {
            messages.show(driveProblem(e))
        } finally {
            working = false
        }
    }, onProblem = { messages.show(it) })

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Sync with Google Drive")
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Sync", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    when {
                                        status.syncing || working -> "Syncing…"
                                        status.enabled -> "On · last synced ${ago(context, status.lastSynced)}" +
                                            if (status.phones > 0) " · ${status.phones} other ${if (status.phones == 1) "phone" else "phones"}" else ""
                                        else -> "Off: everything stays on this phone only."
                                    },
                                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Switch(checked = status.enabled, enabled = !working, onCheckedChange = { on ->
                                if (on) {
                                    turnOn()
                                } else {
                                    drive.enable(false)
                                    SyncWorker.stop(context)
                                    messages.show("Sync is off. Your copy in Drive stays until you remove it.")
                                }
                            })
                        }
                        status.problem?.takeIf { status.enabled }?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
                        }
                        if (status.enabled) {
                            Button(onClick = { now() }, enabled = !working && !status.syncing) { Text("Sync now") }
                        }
                    }
                }
            }
            item {
                Section("How it works") {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(
                            "Hisab keeps a copy of your ledger in your own Google Drive, in a folder only Hisab can see. There is no Hisab server: your phone talks to Google Drive directly.",
                            "Every phone where you turn this on with the same Google account shares one ledger. Changes go up shortly after you make them; other phones pick them up when they open Hisab, and every few hours.",
                            "If the same thing was changed on two phones, the later change counts. Deleting something deletes it everywhere.",
                            "A new phone: install Hisab and choose “Restore from Google Drive”.",
                            "SMS waiting for a look stay on the phone that received them.",
                        ).forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
                    }
                }
            }
            item {
                OutlinedButton(onClick = { confirmRemove = true }, enabled = !working) { Text("Remove Hisab's copy from Google Drive") }
            }
        }
    }

    combine?.let { token ->
        Confirm(
            "Combine with your other phone?",
            "Your Google Drive already has a Hisab ledger from another phone, and this phone has one too. Turning on sync puts both together: every account and entry from each. If both started from the same backup file, nothing is doubled.",
            "Combine",
            onConfirm = {
                combine = null
                scope.launch { syncNow(token, first = true) }
            },
            onDismiss = { combine = null },
        )
    }
    if (confirmRemove) {
        Confirm(
            "Remove Hisab's copy from Drive?",
            "Every phone's copy in this Google account's Drive is deleted and sync turns off here. What's on this phone stays. Other phones keep theirs and put it back if their sync is on.",
            "Remove",
            onConfirm = {
                confirmRemove = false
                drive.enable(false)
                remove()
            },
            onDismiss = { confirmRemove = false },
        )
    }
}
