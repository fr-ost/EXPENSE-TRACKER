package io.github.fr_ost.hisab.core

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * The app lock's PIN, with the website's rules (src/lib/server/auth/pin.ts):
 * 4 to 8 digits, kept only as a slow hash (PBKDF2 here; the PIN belongs to
 * this phone and never syncs), and wrong guesses counted: after every 5th
 * wrong PIN in a row a wait — 1 minute, 5, 30, then a day each time — during
 * which no PIN is even looked at.
 */
object Pin {
    const val TRIES = 5
    private val WAITS_MINUTES = listOf(1, 5, 30, 24 * 60)
    private const val ITERATIONS = 120_000
    private const val KEY_BITS = 256
    private const val SCHEME = "pbkdf2-sha256"
    private const val SEPARATOR = "."

    fun isValid(pin: String) = Regex("^\\d{4,8}$").matches(pin)

    /** Minutes to wait after this many wrong PINs in a row (0: try again now). */
    fun waitMinutes(failures: Int): Int {
        if (failures <= 0 || failures % TRIES != 0) return 0
        return WAITS_MINUTES[minOf(failures / TRIES, WAITS_MINUTES.size) - 1]
    }

    fun hash(pin: String, salt: ByteArray = ByteArray(16).also { SecureRandom().nextBytes(it) }, iterations: Int = ITERATIONS): String {
        val key = derive(pin, salt, iterations)
        val b64 = Base64.getUrlEncoder().withoutPadding()
        return listOf(SCHEME, iterations.toString(), b64.encodeToString(salt), b64.encodeToString(key)).joinToString(SEPARATOR)
    }

    fun matches(pin: String, stored: String): Boolean {
        val parts = stored.split(SEPARATOR)
        if (parts.size != 4 || parts[0] != SCHEME) return false
        val iterations = parts[1].toIntOrNull()?.takeIf { it in 1..10_000_000 } ?: return false
        val decoder = Base64.getUrlDecoder()
        val salt = runCatching { decoder.decode(parts[2]) }.getOrNull() ?: return false
        val expected = runCatching { decoder.decode(parts[3]) }.getOrNull() ?: return false
        return MessageDigest.isEqual(derive(pin, salt, iterations), expected)
    }

    private fun derive(pin: String, salt: ByteArray, iterations: Int): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pin.toCharArray(), salt, iterations, KEY_BITS)).encoded

    /** Wrong PINs in a row, and until when no PIN is looked at (milliseconds since 1970). */
    data class Attempts(val failures: Int = 0, val waitUntil: Long = 0)

    sealed interface Check {
        data object Correct : Check
        data class Incorrect(val remaining: Int) : Check
        data class Wait(val seconds: Long) : Check
    }

    fun check(pin: String, stored: String, attempts: Attempts, now: Long): Pair<Check, Attempts> {
        if (attempts.waitUntil > now) return Check.Wait((attempts.waitUntil - now + 999) / 1000) to attempts
        if (matches(pin, stored)) return Check.Correct to Attempts()
        val failures = attempts.failures + 1
        val wait = waitMinutes(failures)
        val next = Attempts(failures, if (wait > 0) now + wait * 60_000L else 0)
        return (if (wait > 0) Check.Wait(wait * 60L) else Check.Incorrect(TRIES - failures % TRIES)) to next
    }
}
