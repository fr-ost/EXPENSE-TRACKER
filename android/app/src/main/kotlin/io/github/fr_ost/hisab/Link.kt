package io.github.fr_ost.hisab

import android.content.Context

/** A Hisab account and the token that hands this phone's messages to it. */
data class Account(val token: String, val email: String?, val name: String) {
    /** How the account is shown to the person: their Google address, or else their name. */
    val label: String get() = email?.takeIf { it.isNotBlank() } ?: name.ifBlank { "your Hisab account" }
}

/**
 * This phone's link to a Hisab account (automatic SMS import). Kept in the
 * app's private storage, never backed up and never copied to another phone
 * (data_extraction_rules.xml): a token belongs to one phone.
 *
 * A token collected with a link code is only held until the person says yes
 * on the set-up screen: a link can be opened by any website, so a code from
 * someone else's account must never take this phone's messages there.
 */
class Link(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("link", Context.MODE_PRIVATE)

    /** The account this phone's messages go to; null while automatic import is off. */
    val account: Account?
        get() = prefs.getString(TOKEN, null)?.let { Account(it, prefs.getString(EMAIL, null), prefs.getString(NAME, null).orEmpty()) }

    val token: String? get() = prefs.getString(TOKEN, null)

    /** When messages last reached Hisab (milliseconds since 1970), 0 if never. */
    var lastHandedIn: Long
        get() = prefs.getLong(LAST_HANDED_IN, 0L)
        set(value) {
            prefs.edit().putLong(LAST_HANDED_IN, value).apply()
        }

    /** Collected with a link code; waiting for the person to say yes. */
    val pending: Account?
        get() = prefs.getString(PENDING_TOKEN, null)?.let {
            Account(it, prefs.getString(PENDING_EMAIL, null), prefs.getString(PENDING_NAME, null).orEmpty())
        }

    /** This code was already used (a code works once). */
    fun used(code: String): Boolean = prefs.getString(LAST_CODE, null) == code

    fun markUsed(code: String) {
        prefs.edit().putString(LAST_CODE, code).commit()
    }

    fun hold(account: Account, code: String) {
        prefs.edit()
            .putString(PENDING_TOKEN, account.token)
            .putString(PENDING_EMAIL, account.email)
            .putString(PENDING_NAME, account.name)
            .putString(LAST_CODE, code)
            .commit()
    }

    /** The person said yes: the held token becomes this phone's. Returns the token it replaces, if any. */
    fun confirm(): String? {
        val chosen = pending ?: return null
        val previous = token
        prefs.edit()
            .putString(TOKEN, chosen.token)
            .putString(EMAIL, chosen.email)
            .putString(NAME, chosen.name)
            .remove(PENDING_TOKEN)
            .remove(PENDING_EMAIL)
            .remove(PENDING_NAME)
            .putLong(LAST_HANDED_IN, 0L)
            .commit()
        return previous?.takeIf { it != chosen.token }
    }

    /** The person said no: returns the held token, so the site can forget it too. */
    fun dropPending(): String? {
        val held = prefs.getString(PENDING_TOKEN, null)
        prefs.edit().remove(PENDING_TOKEN).remove(PENDING_EMAIL).remove(PENDING_NAME).commit()
        return held
    }

    /** Automatic import is off: forget the account (a held token stays held). */
    fun forget() {
        prefs.edit().remove(TOKEN).remove(EMAIL).remove(NAME).remove(LAST_HANDED_IN).commit()
    }

    private companion object {
        const val TOKEN = "token"
        const val EMAIL = "email"
        const val NAME = "name"
        const val LAST_HANDED_IN = "lastHandedIn"
        const val PENDING_TOKEN = "pendingToken"
        const val PENDING_EMAIL = "pendingEmail"
        const val PENDING_NAME = "pendingName"
        const val LAST_CODE = "lastCode"
    }
}
