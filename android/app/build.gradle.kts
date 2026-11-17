import java.net.URI

plugins {
    alias(libs.plugins.android.application)
}

/** A setting from the environment (CI) or else gradle.properties; blank counts as unset. */
fun setting(environment: String, property: String): String? =
    sequenceOf(providers.environmentVariable(environment), providers.gradleProperty(property))
        .mapNotNull { it.orNull?.trim()?.takeIf(String::isNotEmpty) }
        .firstOrNull()

// The app is a shell around one site, so the site's address is part of the
// build. Without one everything still builds and tests, around a placeholder.
val siteUrl = (setting("HISAB_URL", "hisabUrl") ?: "https://hisab.invalid").trimEnd('/')
val site = URI(siteUrl)
require(
    site.scheme == "https" && !site.host.isNullOrEmpty() && site.userInfo == null &&
        site.rawPath.isNullOrEmpty() && site.rawQuery == null && site.rawFragment == null,
) { "HISAB_URL must be the site's address and nothing more, like https://hisab.example (it is \"$siteUrl\")." }

// The key that signs what people install. It is never in the repository: CI
// writes it to a file from the ANDROID_SIGNING_KEY secret.
val signingKeystore = setting("HISAB_SIGNING_KEYSTORE", "hisabSigningKeystore")
val signingPassword = setting("HISAB_SIGNING_PASSWORD", "hisabSigningPassword") ?: "hisab-signing"

/** JSON as an Android string resource, where a quote survives only when escaped. */
fun resourceJson(json: String) = json.replace("\"", "\\\"")

android {
    namespace = "io.github.fr_ost.hisab"
    compileSdk = 36

    defaultConfig {
        applicationId = providers.gradleProperty("hisabApplicationId").get()
        minSdk = 24
        targetSdk = 36
        // CI counts the commits, so every build is newer than the one before.
        versionCode = setting("HISAB_VERSION_CODE", "hisabVersionCode")?.toInt() ?: 1
        versionName = "1.0.$versionCode"

        manifestPlaceholders["siteUrl"] = siteUrl
        buildConfigField("String", "SITE_URL", "\"$siteUrl\"")
        // The app's half of the handshake with the site (the site's half is
        // /.well-known/assetlinks.json): together they let the browser show
        // Hisab without an address bar.
        resValue(
            "string",
            "asset_statements",
            resourceJson("""[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"web","site":"$siteUrl"}}]"""),
        )
        // "Share" a bank message from any app to Hisab: the same target the
        // installed website declares in its manifest.
        resValue(
            "string",
            "share_target",
            resourceJson("""{"action":"$siteUrl/sms/share","method":"POST","enctype":"multipart/form-data","params":{"title":"title","text":"text"}}"""),
        )
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
        resValues = true
    }

    lint {
        textReport = true
    }
}

dependencies {
    implementation(libs.androidbrowserhelper)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.work.runtime)

    testImplementation(libs.junit)
    testImplementation(libs.json)
}
