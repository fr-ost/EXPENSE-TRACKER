package io.github.fr_ost.hisab

import android.app.Application
import io.github.fr_ost.hisab.data.Repository

class HisabApplication : Application() {
    val repository: Repository by lazy { Repository(this) }
}
