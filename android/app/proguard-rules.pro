# Crash reports stay readable: keep line numbers, hide file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Records are saved as JSON with kotlinx.serialization: keep what it generates.
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class io.github.fr_ost.hisab.core.**$$serializer { *; }
-keepclassmembers class io.github.fr_ost.hisab.core.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
