package io.github.fr_ost.hisab

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.fragment.app.FragmentActivity
import io.github.fr_ost.hisab.core.Pin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The app lock, on this phone only (it never syncs): off, a PIN of the
 * person's own (core Pin: a slow hash, growing waits after wrong guesses),
 * or the phone's own screen lock — fingerprint, face or the phone's PIN.
 * With either, Hisab starts locked and locks again after being away for
 * the chosen minutes. A forgotten Hisab PIN gives way to the phone's screen
 * lock, which removes it.
 */
class AppLock(context: Context) {
    enum class Method { NONE, PIN, DEVICE }

    private val prefs = context.applicationContext.getSharedPreferences("hisab.lock", Context.MODE_PRIVATE)
    private val appContext = context.applicationContext

    val method: Method get() = runCatching { Method.valueOf(prefs.getString(METHOD, null) ?: "NONE") }.getOrDefault(Method.NONE)

    private val state = MutableStateFlow(method != Method.NONE)
    /** Whether the screens are hidden behind the lock right now. */
    val locked: StateFlow<Boolean> = state.asStateFlow()

    private var awaySince = 0L
    private var returning = false

    /** Can the phone's own screen lock (or fingerprint, face) unlock Hisab? */
    fun deviceLockAvailable(): Boolean =
        BiometricManager.from(appContext).canAuthenticate(BIOMETRIC_WEAK or DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS

    fun setPin(pin: String) {
        require(Pin.isValid(pin))
        prefs.edit {
            putString(METHOD, Method.PIN.name)
            putString(HASH, Pin.hash(pin))
            remove(FAILURES)
            remove(WAIT_UNTIL)
        }
    }

    fun useDeviceLock() {
        prefs.edit {
            putString(METHOD, Method.DEVICE.name)
            remove(HASH)
        }
    }

    fun turnOff() {
        prefs.edit { clear() }
        state.value = false
    }

    fun check(pin: String): Pin.Check {
        val stored = prefs.getString(HASH, null) ?: return Pin.Check.Incorrect(Pin.TRIES)
        val (check, attempts) = Pin.check(pin, stored, Pin.Attempts(prefs.getInt(FAILURES, 0), prefs.getLong(WAIT_UNTIL, 0)), System.currentTimeMillis())
        prefs.edit {
            putInt(FAILURES, attempts.failures)
            putLong(WAIT_UNTIL, attempts.waitUntil)
        }
        if (check == Pin.Check.Correct) state.value = false
        return check
    }

    /** Ask the phone's screen lock; `done` says whether it was the owner. */
    fun askDevice(activity: FragmentActivity, title: String, done: (Boolean, String?) -> Unit) {
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = done(true, null)
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = done(false, errString.toString())
        })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL).build())
    }

    fun unlockedByDevice() {
        // The phone's owner: a forgotten Hisab PIN's waits end too.
        prefs.edit {
            remove(FAILURES)
            remove(WAIT_UNTIL)
        }
        state.value = false
    }

    fun lockNow() {
        if (method != Method.NONE) state.value = true
    }

    fun wentAway() {
        awaySince = System.currentTimeMillis()
    }

    /** Hisab opened another app for a moment (a file picker): coming back doesn't lock. */
    fun expectReturn() {
        returning = true
    }

    /** Back in Hisab: locked again when it was away for `minutes` or more (0: every time). */
    fun cameBack(minutes: Int) {
        val away = if (awaySince == 0L) 0L else System.currentTimeMillis() - awaySince
        val wasReturning = returning
        returning = false
        awaySince = 0L
        if (method == Method.NONE || away == 0L) return
        if (wasReturning && away < MAX_ERRAND) return
        if (away >= minutes * 60_000L) state.value = true
    }

    private companion object {
        /** The longest a visit to a file picker can last without locking. */
        const val MAX_ERRAND = 10 * 60_000L
        const val METHOD = "method"
        const val HASH = "hash"
        const val FAILURES = "failures"
        const val WAIT_UNTIL = "waitUntil"
    }
}
