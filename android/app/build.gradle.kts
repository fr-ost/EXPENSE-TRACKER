plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

/** A setting from the environment (CI) or else gradle.properties; blank counts as unset. */
fun setting(environment: String, property: String): String? =
    sequenceOf(providers.environmentVariable(environment), providers.gradleProperty(property))
        .mapNotNull { it.orNull?.trim()?.takeIf(String::isNotEmpty) }
        .firstOrNull()

// The key that signs what people install. It is never in the repository: CI
// writes it to a file from the ANDROID_SIGNING_KEY secret.
val signingKeystore = setting("HISAB_SIGNING_KEYSTORE", "hisabSigningKeystore")
val signingPassword = setting("HISAB_SIGNING_PASSWORD", "hisabSigningPassword") ?: "hisab-signing"

android {
    namespace = "io.github.fr_ost.hisab"
    compileSdk = 36

    defaultConfig {
        applicationId = providers.gradleProperty("hisabApplicationId").get()
        // Android 8.0 and later: the date and time library Hisab counts on is built in.
        minSdk = 26
        targetSdk = 36
        // CI counts the commits, so every build is newer than the one before.
        versionCode = setting("HISAB_VERSION_CODE", "hisabVersionCode")?.toInt() ?: 1
        versionName = "2.0.$versionCode"
    }

    signingConfigs {
        if (signingKeystore != null) {
            create("upload") {
                storeFile = file(signingKeystore)
                storeType = "pkcs12"
                storePassword = signingPassword
                keyAlias = "hisab"
                keyPassword = signingPassword
            }
        }
    }

    buildTypes {
        debug {
            // Installs next to the real app.
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("upload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    lint {
        textReport = true
    }
}

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons)
    implementation(libs.compose.tooling.preview)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.work.runtime)
    implementation(libs.play.services.auth)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.fragment)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.json)
}
