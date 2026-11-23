package io.github.fr_ost.hisab

import android.app.Application
import io.github.fr_ost.hisab.data.Repository
import kotlinx.coroutines.flow.MutableStateFlow

class HisabApplication : Application() {
    val repository: Repository by lazy { Repository(this) }

    /** Where a notification asked the app to open ("sms", "activity"), until the screens take it. */
    val opens = MutableStateFlow<String?>(null)
}
