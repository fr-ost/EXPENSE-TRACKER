package io.github.fr_ost.hisab

import androidx.browser.customtabs.CustomTabsCallback

/**
 * The app icon. It opens Hisab full screen in the phone's browser (a Trusted
 * Web Activity): the site runs exactly as it does in Chrome, with the same
 * sign-in, and without an address bar because the site vouches for this app
 * (/.well-known/assetlinks.json).
 */
class LauncherActivity : com.google.androidbrowserhelper.trusted.LauncherActivity() {
    /**
     * The library's own callback closes the app with a crash whenever a page
     * fails to load: a 404, a server error, no connection. Hisab has screens
     * for all three, and a crash would only lose your place.
     */
    override fun getCustomTabsCallback(): CustomTabsCallback = CustomTabsCallback()
}
