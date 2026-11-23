package io.github.fr_ost.hisab.drive

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Task
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Permission to use the person's Google Drive — only Hisab's own app folder
 * there (hidden from them and from every other app), nothing else in their
 * Drive. Google asks on the phone, the first time; after that the phone gets
 * a fresh token by itself. There is no Hisab server in between.
 */
object DriveAccess {
    const val SCOPE = "https://www.googleapis.com/auth/drive.appdata"

    sealed interface Access {
        data class Granted(val token: String) : Access
        /** Google wants to ask the person first: show this, then call `fromConsent`. */
        data class NeedsConsent(val intent: PendingIntent) : Access
        data class Failed(val message: String) : Access
    }

    private fun request() = AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(SCOPE))).build()

    suspend fun ask(context: Context): Access = try {
        read(Identity.getAuthorizationClient(context).authorize(request()).await())
    } catch (e: ApiException) {
        Access.Failed(describe(e))
    } catch (e: Exception) {
        Access.Failed("Google Drive isn't available on this phone (${e.message ?: e.javaClass.simpleName}).")
    }

    /** What the person answered when Google asked. */
    fun fromConsent(context: Context, data: Intent?): Access = try {
        read(Identity.getAuthorizationClient(context).getAuthorizationResultFromIntent(data))
    } catch (e: ApiException) {
        Access.Failed(describe(e))
    }

    private fun read(result: AuthorizationResult): Access {
        val consent = result.pendingIntent
        if (result.hasResolution() && consent != null) return Access.NeedsConsent(consent)
        val token = result.accessToken
        return if (token.isNullOrEmpty()) Access.Failed("Google didn't give Hisab access to Drive.") else Access.Granted(token)
    }

    private fun describe(e: ApiException) = when (e.statusCode) {
        CommonStatusCodes.CANCELED -> "Not connected: Google Drive wasn't allowed."
        CommonStatusCodes.NETWORK_ERROR -> "No connection. Try again when you're online."
        CommonStatusCodes.DEVELOPER_ERROR ->
            "Google Drive isn't set up for this copy of Hisab yet: its Android client is missing in Google Cloud (see docs/google-drive-android.md)."
        else -> "Google Drive said no (code ${e.statusCode}). Try again later."
    }

    private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
        addOnSuccessListener { continuation.resume(it) }
        addOnFailureListener { continuation.resumeWithException(it) }
        addOnCanceledListener { continuation.cancel() }
    }
}
