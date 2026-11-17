package io.github.fr_ost.hisab

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.format.DateUtils
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.Switch
import android.widget.TextView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Automatic SMS import on this phone: setting it up, and seeing or turning it off.
 *
 * Setting up starts on the site (Settings, "Set up on this phone"), which
 * opens hisab://link?code=… here. The code is exchanged for this phone's
 * token, and then — before anything is read — the person sees which Hisab
 * account their messages would go to and exactly what is read and sent, and
 * says yes by turning it on (Android then asks for SMS access).
 *
 * Opened any other way (the phone's settings for the app), it shows whether
 * import is on, and turns it off.
 */
class SmsSetupActivity : Activity() {
    private lateinit var link: Link
    private lateinit var title: TextView
    private lateinit var body: TextView
    private lateinit var account: TextView
    private lateinit var details: TextView
    private lateinit var recent: Switch
    private lateinit var progress: ProgressBar
    private lateinit var primary: Button
    private lateinit var secondary: Button
    private val background: ExecutorService = Executors.newSingleThreadExecutor()

    /** Sent to the phone's settings to allow SMS access; carry on when back. */
    private var awaitingSettings = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_sms_setup)
        link = Link(this)
        title = findViewById(R.id.title)
        body = findViewById(R.id.body)
        account = findViewById(R.id.account)
        details = findViewById(R.id.details)
        recent = findViewById(R.id.recent)
        progress = findViewById(R.id.progress)
        primary = findViewById(R.id.primary)
        secondary = findViewById(R.id.secondary)
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        // Back from the phone's settings with SMS access now allowed.
        if (link.pending != null && hasSmsAccess() && awaitingSettings) {
            awaitingSettings = false
            turnOn()
        }
    }

    override fun onDestroy() {
        background.shutdown()
        super.onDestroy()
    }

    private fun handle(intent: Intent) {
        val code = intent.data
            ?.takeIf { it.scheme == "hisab" && it.host == "link" }
            ?.getQueryParameter("code")
            ?.takeIf { it.length in 20..100 }
        val held = link.pending
        when {
            code != null && !link.used(code) -> collect(code)
            held != null -> confirm(held)
            else -> status()
        }
    }

    // ---- Setting up -----------------------------------------------------

    private fun collect(code: String) {
        working(getString(R.string.setup_linking))
        background.execute {
            val reply = HisabApi(BuildConfig.SITE_URL).collectToken(code, deviceName())
            // Kept before anything else, so a screen turned or closed meanwhile loses nothing.
            when (reply) {
                is Reply.Ok -> link.hold(reply.value, code)
                is Reply.Refused, Reply.Unlinked -> link.markUsed(code)
                Reply.TryLater -> Unit
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                when (reply) {
                    is Reply.Ok -> confirm(reply.value)
                    is Reply.Refused -> failed(reply.message, retry = null)
                    Reply.Unlinked -> failed(getString(R.string.setup_expired), retry = null)
                    Reply.TryLater -> failed(getString(R.string.setup_offline)) { collect(code) }
                }
            }
        }
    }

    /** Whose account, and what will be read and sent: the person decides. */
    private fun confirm(held: Account) {
        val current = link.account
        show(
            title = getString(R.string.setup_title),
            body = getString(R.string.setup_body),
            account = if (current != null && current.token != held.token && current.label != held.label) {
                getString(R.string.setup_account_replaces, held.label, current.label)
            } else {
                getString(R.string.setup_account, held.label)
            },
            details = getString(R.string.setup_details),
            showRecent = true,
            primary = getString(R.string.setup_turn_on) to { askForAccess() },
            secondary = getString(R.string.setup_not_now) to { decline() },
        )
    }

    private val wantsRecent: Boolean get() = recent.isChecked

    private fun askForAccess() {
        if (hasSmsAccess() && (!wantsRecent || canReadInbox())) return turnOn()
        val wanted = buildList {
            add(Manifest.permission.RECEIVE_SMS)
            if (wantsRecent) add(Manifest.permission.READ_SMS)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        requestPermissions(wanted.toTypedArray(), ASK_ACCESS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != ASK_ACCESS || link.pending == null) return
        if (hasSmsAccess()) {
            turnOn()
        } else {
            denied(askAgain = shouldShowRequestPermissionRationale(Manifest.permission.RECEIVE_SMS))
        }
    }

    private fun turnOn() {
        val bringRecent = wantsRecent && canReadInbox()
        val replaced = link.confirm()
        working(getString(if (bringRecent) R.string.setup_bringing else R.string.setup_finishing))
        background.execute {
            // The account this phone used to send to forgets it.
            replaced?.let { HisabApi(BuildConfig.SITE_URL).unlink(it) }
            if (bringRecent) SmsStore(this).add(SmsStore.recentInbox(this, RECENT_DAYS))
            Uploads.now(this)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                show(
                    title = getString(R.string.setup_done_title),
                    body = getString(R.string.setup_done_body),
                    primary = getString(R.string.back_to_hisab) to { backToHisab("/settings?phone=linked#sms-phones") },
                )
            }
        }
    }

    private fun denied(askAgain: Boolean) {
        show(
            title = getString(R.string.denied_title),
            body = getString(R.string.denied_body),
            details = if (askAgain) null else getString(R.string.denied_settings_help),
            primary = if (askAgain) {
                getString(R.string.denied_try_again) to { askForAccess() }
            } else {
                getString(R.string.open_phone_settings) to { openAppSettings() }
            },
            secondary = getString(R.string.setup_not_now) to { decline() },
        )
    }

    private fun decline() {
        val held = link.dropPending()
        working(getString(R.string.setup_finishing))
        background.execute {
            held?.let { HisabApi(BuildConfig.SITE_URL).unlink(it) }
            runOnUiThread { if (!isFinishing && !isDestroyed) backToHisab("/settings#sms-phones") }
        }
    }

    private fun failed(message: String, retry: (() -> Unit)?) {
        show(
            title = getString(R.string.failed_title),
            body = message,
            primary = if (retry != null) getString(R.string.denied_try_again) to retry else getString(R.string.back_to_hisab) to { backToHisab("/settings#sms-phones") },
            secondary = if (retry != null) getString(R.string.back_to_hisab) to { backToHisab("/settings#sms-phones") } else null,
        )
    }

    // ---- Seeing and turning off -----------------------------------------

    private fun status() {
        val current = link.account
        if (current == null) {
            show(
                title = getString(R.string.status_off_title),
                body = getString(R.string.status_off_body),
                primary = getString(R.string.open_hisab_settings) to { backToHisab("/settings#sms-phones") },
            )
            return
        }
        val last = link.lastHandedIn
        show(
            title = getString(if (hasSmsAccess()) R.string.status_on_title else R.string.status_paused_title),
            body = getString(if (hasSmsAccess()) R.string.status_on_body else R.string.status_paused_body),
            account = getString(R.string.setup_account, current.label),
            details = if (last > 0) {
                getString(R.string.status_last, DateUtils.getRelativeTimeSpanString(last, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS))
            } else {
                getString(R.string.status_none_yet)
            },
            primary = if (hasSmsAccess()) {
                getString(R.string.back_to_hisab) to { backToHisab("/sms") }
            } else {
                getString(R.string.open_phone_settings) to { openAppSettings() }
            },
            secondary = getString(R.string.status_turn_off) to { turnOff(current) },
        )
    }

    private fun turnOff(current: Account) {
        link.forget()
        Uploads.stop(this)
        working(getString(R.string.setup_finishing))
        background.execute {
            SmsStore(this).clear()
            HisabApi(BuildConfig.SITE_URL).unlink(current.token)
            runOnUiThread { if (!isFinishing && !isDestroyed) status() }
        }
    }

    // ---- Helpers ----------------------------------------------------------

    private fun hasSmsAccess() = checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED

    private fun canReadInbox() = checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    /** The phone's own name for itself ("Shahana's Pixel"), else its model. */
    private fun deviceName(): String {
        val named = if (Build.VERSION.SDK_INT >= 25) Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME) else null
        if (!named.isNullOrBlank()) return named.trim()
        val maker = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
        val model = Build.MODEL.orEmpty()
        return if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model".trim()
    }

    private fun openAppSettings() {
        awaitingSettings = true
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    /** Back to the site, at `path`, in the app's own window. */
    private fun backToHisab(path: String) {
        startActivity(
            Intent(this, LauncherActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(BuildConfig.SITE_URL + path))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        finish()
    }

    private fun working(message: String) {
        show(title = message, body = null, busy = true)
    }

    private fun show(
        title: String,
        body: String?,
        account: String? = null,
        details: String? = null,
        showRecent: Boolean = false,
        busy: Boolean = false,
        primary: Pair<String, () -> Unit>? = null,
        secondary: Pair<String, () -> Unit>? = null,
    ) {
        this.title.text = title
        fun TextView.set(text: String?) {
            this.text = text
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }
        this.body.set(body)
        this.account.set(account)
        this.details.set(details)
        recent.visibility = if (showRecent) View.VISIBLE else View.GONE
        progress.visibility = if (busy) View.VISIBLE else View.GONE
        for ((button, action) in listOf(this.primary to primary, this.secondary to secondary)) {
            button.visibility = if (action == null) View.GONE else View.VISIBLE
            button.text = action?.first
            button.setOnClickListener { action?.second?.invoke() }
        }
    }

    private companion object {
        const val ASK_ACCESS = 7
        /** How far back "bring in recent messages" reaches. */
        const val RECENT_DAYS = 30
    }
}
