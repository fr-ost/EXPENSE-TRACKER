package io.github.fr_ost.hisab.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape

/** The website's colours (src/app/globals.css): white canvas, ink for actions, emerald for money in. */
object Palette {
    val Ink = Color(0xFF0E0E12)
    val Emerald = Color(0xFF2FBF71)
    val Positive = Color(0xFF15803D)
    val Negative = Color(0xFFC2410C)
    val Muted = Color(0xFF5C5C66)
    val Faint = Color(0xFF8A8A94)
    val Surface = Color(0xFFF4F4F6)
    val Border = Color(0xFFE6E6EA)
    val Warning = Color(0xFFB45309)
}

private val Light = lightColorScheme(
    primary = Palette.Ink,
    onPrimary = Color.White,
    secondary = Palette.Emerald,
    onSecondary = Color.White,
    background = Color.White,
    onBackground = Palette.Ink,
    surface = Color.White,
    onSurface = Palette.Ink,
    surfaceVariant = Palette.Surface,
    onSurfaceVariant = Palette.Muted,
    surfaceContainer = Palette.Surface,
    surfaceContainerLow = Color(0xFFFAFAFB),
    surfaceContainerHigh = Color(0xFFEEEEF1),
    outline = Palette.Border,
    outlineVariant = Palette.Border,
    error = Palette.Negative,
)

private val Dark = darkColorScheme(
    primary = Color.White,
    onPrimary = Palette.Ink,
    secondary = Palette.Emerald,
    background = Color(0xFF0E0E12),
    onBackground = Color(0xFFF2F2F4),
    surface = Color(0xFF0E0E12),
    onSurface = Color(0xFFF2F2F4),
    surfaceVariant = Color(0xFF1C1C22),
    onSurfaceVariant = Color(0xFFA6A6B0),
    surfaceContainer = Color(0xFF17171C),
    surfaceContainerLow = Color(0xFF131317),
    surfaceContainerHigh = Color(0xFF222229),
    outline = Color(0xFF2E2E36),
    outlineVariant = Color(0xFF2E2E36),
    error = Color(0xFFF97316),
)

private val Type = Typography(
    headlineLarge = TextStyle(fontSize = 32.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.5).sp),
    headlineMedium = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp),
    titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp),
    bodyMedium = TextStyle(fontSize = 14.sp),
    labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun HisabTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) Dark else Light,
        typography = Type,
        shapes = Shapes(
            small = RoundedCornerShape(8.dp),
            medium = RoundedCornerShape(12.dp),
            large = RoundedCornerShape(16.dp),
            extraLarge = RoundedCornerShape(24.dp),
        ),
        content = content,
    )
}

/** Money in green, money out in the warning colour, in either theme. */
@Composable
fun amountColor(minor: Long): Color = when {
    minor > 0 -> if (isSystemInDarkTheme()) Palette.Emerald else Palette.Positive
    minor < 0 -> MaterialTheme.colorScheme.onSurface
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

/** A category's colour key (the website's palette) as a colour. */
fun paletteColor(key: String?): Color = when (key) {
    "terracotta" -> Color(0xFFC2603E)
    "violet" -> Color(0xFF7C3AED)
    "orange" -> Color(0xFFEA7317)
    "blue" -> Color(0xFF2563EB)
    "brown" -> Color(0xFF8B5E3C)
    "slate" -> Color(0xFF64748B)
    "teal" -> Color(0xFF0D9488)
    "rose" -> Color(0xFFE11D48)
    "plum" -> Color(0xFF9D4EDD)
    "indigo" -> Color(0xFF4F46E5)
    "cyan" -> Color(0xFF0891B2)
    "amber" -> Color(0xFFD97706)
    "lime" -> Color(0xFF65A30D)
    "green" -> Color(0xFF16A34A)
    "red" -> Color(0xFFDC2626)
    "pink" -> Color(0xFFDB2777)
    else -> Color(0xFF8A8A94)
}

/** The colours a category can have, in order. */
val PALETTE_KEYS = listOf("green", "teal", "cyan", "blue", "indigo", "violet", "plum", "pink", "rose", "red", "terracotta", "orange", "amber", "lime", "brown", "slate", "gray")
