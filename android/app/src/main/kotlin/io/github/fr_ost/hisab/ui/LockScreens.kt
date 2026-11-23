package io.github.fr_ost.hisab.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import io.github.fr_ost.hisab.AppLock
import io.github.fr_ost.hisab.HisabApplication
import io.github.fr_ost.hisab.R
import io.github.fr_ost.hisab.core.Edits
import io.github.fr_ost.hisab.core.Pin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun waitText(seconds: Long): String = when {
    seconds < 90 -> "$seconds seconds"
    seconds < 90 * 60 -> "${(seconds + 59) / 60} minutes"
    else -> "${(seconds + 3599) / 3600} hours"
}

/** What shows instead of Hisab while it is locked. */
@Composable
fun LockScreen(lock: AppLock) {
    val context = LocalContext.current
    val activity = context as? FragmentActivity
    val scope = rememberCoroutineScope()
    var pin by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    val device = lock.deviceLockAvailable()

    fun askDevice() {
        activity ?: return
        lock.askDevice(activity, "Unlock Hisab") { ok, error ->
            if (ok) {
                // Unlocked by the phone's owner: a forgotten Hisab PIN can go now.
                lock.unlockedByDevice()
            } else if (error != null) {
                message = error
            }
        }
    }

    // The phone's own lock asks straight away; a PIN waits for a tap (no keyboard pops up by itself).
    LaunchedEffect(Unit) { if (lock.method == AppLock.Method.DEVICE && device) askDevice() }

    Column(
        Modifier.fillMaxSize().padding(24.dp).imePadding(),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(painterResource(R.drawable.splash), contentDescription = null, modifier = Modifier.size(56.dp))
        Text("Hisab is locked", style = MaterialTheme.typography.headlineSmall)
        if (lock.method == AppLock.Method.PIN) {
            OutlinedTextField(
                value = pin,
                onValueChange = { typed -> if (typed.length <= 8 && typed.all(Char::isDigit)) pin = typed },
                label = { Text("PIN") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                isError = message != null,
                supportingText = message?.let { { Text(it) } },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(onClick = {
                checking = true
                scope.launch {
                    val check = withContext(Dispatchers.Default) { lock.check(pin) }
                    checking = false
                    pin = ""
                    message = when (check) {
                        Pin.Check.Correct -> null
                        is Pin.Check.Incorrect -> "Wrong PIN. ${check.remaining} ${if (check.remaining == 1) "try" else "tries"} left before a wait."
                        is Pin.Check.Wait -> "Too many wrong PINs. Try again in ${waitText(check.seconds)}."
                    }
                }
            }, enabled = Pin.isValid(pin) && !checking, modifier = Modifier.fillMaxWidth()) { Text(if (checking) "Checking…" else "Unlock") }
            if (device) {
                TextButton(onClick = { askDevice() }) { Text("Forgot your PIN? Use the phone's screen lock") }
            } else {
                Text(
                    "Forgot your PIN? Without a screen lock on this phone, the way back is to clear Hisab's storage in Android's settings, then restore from Google Drive or a backup file.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            message?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            Button(onClick = { askDevice() }, modifier = Modifier.fillMaxWidth()) { Text("Unlock") }
            if (!device) {
                Text(
                    "This phone no longer has a screen lock. Set one in Android's settings to open Hisab.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** More → App lock: off, a PIN, or the phone's screen lock; and after how long away it locks again. */
@Composable
fun LockSettingsScreen(book: Book) {
    val context = LocalContext.current
    val activity = context as? FragmentActivity
    val app = context.applicationContext as HisabApplication
    val lock = app.lock
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    var method by remember { mutableStateOf(lock.method) }
    var settingPin by remember { mutableStateOf(false) }
    val device = remember { lock.deviceLockAvailable() }
    var minutes by remember { mutableIntStateOf(book.settings.autoLockMinutes) }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("App lock")
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Text(
                    "Keep Hisab closed to anyone else who picks up your phone. The lock belongs to this phone: your other phones have their own.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item {
                Section(null) {
                    Column(Modifier.padding(vertical = 8.dp)) {
                        LockChoice("Off", "Hisab opens straight away.", method == AppLock.Method.NONE) {
                            lock.turnOff()
                            method = AppLock.Method.NONE
                            messages.show("App lock is off")
                        }
                        LockChoice(
                            "The phone's screen lock",
                            if (device) "Fingerprint, face or the phone's own PIN." else "Set a screen lock in Android's settings first.",
                            method == AppLock.Method.DEVICE,
                            enabled = device,
                        ) {
                            activity?.let {
                                lock.askDevice(it, "Use your screen lock for Hisab") { ok, _ ->
                                    if (ok) {
                                        lock.useDeviceLock()
                                        method = AppLock.Method.DEVICE
                                        messages.show("Hisab now opens with your screen lock")
                                    }
                                }
                            }
                        }
                        LockChoice("A Hisab PIN", "4 to 8 digits, just for Hisab.", method == AppLock.Method.PIN) { settingPin = true }
                    }
                }
            }
            if (method != AppLock.Method.NONE) {
                item {
                    Section("Lock again after") {
                        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(0 to "Right away", 1 to "1 min", 5 to "5 min", 15 to "15 min").forEach { (value, label) ->
                                FilterChip(selected = minutes == value, onClick = {
                                    minutes = value
                                    repository.edit { listOf(Edits.updateSettings(it) { s -> s.copy(autoLockMinutes = value) }) }
                                }, label = { Text(label) })
                            }
                        }
                    }
                }
                item {
                    OutlinedButton(onClick = { lock.lockNow() }) { Text("Lock now") }
                }
            }
        }
    }

    if (settingPin) {
        PinDialog(onDone = { pin ->
            lock.setPin(pin)
            method = AppLock.Method.PIN
            settingPin = false
            messages.show("PIN set. Hisab asks for it when it opens.")
        }, onDismiss = { settingPin = false })
    }
}

@Composable
private fun LockChoice(title: String, subtitle: String, selected: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected = selected, onClick = onClick, enabled = enabled)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun PinDialog(onDone: (String) -> Unit, onDismiss: () -> Unit) {
    var first by remember { mutableStateOf("") }
    var second by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    fun digits(typed: String) = typed.length <= 8 && typed.all(Char::isDigit)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Choose a PIN") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(first, { if (digits(it)) first = it }, label = { Text("PIN (4 to 8 digits)") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                OutlinedTextField(second, { if (digits(it)) second = it }, label = { Text("The same PIN again") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    isError = error != null, supportingText = error?.let { { Text(it) } })
                Spacer(Modifier.height(4.dp))
                Text("If you forget it, the phone's screen lock opens Hisab instead.", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            Button(onClick = {
                error = when {
                    !Pin.isValid(first) -> "Use 4 to 8 digits."
                    first != second -> "The two PINs are different."
                    else -> null
                }
                if (error == null) onDone(first)
            }) { Text("Set PIN") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
