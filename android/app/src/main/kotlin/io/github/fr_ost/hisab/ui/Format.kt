package io.github.fr_ost.hisab.ui

import io.github.fr_ost.hisab.core.AccountType
import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.Money
import io.github.fr_ost.hisab.core.Settings
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** How money, dates and times read on screen, with the person's preferences. */
class Format(private val settings: Settings) {
    val base: String get() = settings.baseCurrency

    fun money(minor: Long, currency: String = settings.baseCurrency, sign: Money.Sign = Money.Sign.NEGATIVE, alwaysDecimals: Boolean = false): String =
        Money.format(minor, currency, settings.numberFormat, alwaysDecimals, sign)

    companion object {
        private val DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
        private val DAY_SHORT = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
        private val LONG = DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", Locale.ENGLISH)

        fun date(value: String): String = runCatching { LocalDate.parse(value).format(DAY) }.getOrDefault(value)

        fun longDate(value: String): String = runCatching { LocalDate.parse(value).format(LONG) }.getOrDefault(value)

        /** "Today", "Yesterday", "Mon, 21 Sep", or "21 Sep 2025" in another year. */
        fun day(value: String, today: String): String = runCatching {
            val date = LocalDate.parse(value)
            val now = LocalDate.parse(today)
            when {
                date == now -> "Today"
                date == now.minusDays(1) -> "Yesterday"
                date.year == now.year -> "${date.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)}, ${date.format(DAY_SHORT)}"
                else -> date.format(DAY)
            }
        }.getOrDefault(value)

        fun month(key: String): String = runCatching {
            val month = YearMonth.parse(key)
            "${month.month.getDisplayName(TextStyle.FULL, Locale.ENGLISH)} ${month.year}"
        }.getOrDefault(key)

        /** "14:05" → "2:05 pm". */
        fun time(value: String): String = runCatching {
            val t = LocalTime.parse(value.take(5))
            val hour = if (t.hour % 12 == 0) 12 else t.hour % 12
            "%d:%02d %s".format(hour, t.minute, if (t.hour < 12) "am" else "pm")
        }.getOrDefault(value)

        fun greeting(): String = when (LocalTime.now().hour) {
            in 5..11 -> "Good morning"
            in 12..16 -> "Good afternoon"
            else -> "Good evening"
        }

        fun accountType(type: AccountType): String = when (type) {
            AccountType.CASH -> "Cash"
            AccountType.BANK -> "Bank"
            AccountType.MOBILE_WALLET -> "Mobile wallet"
            AccountType.CARD -> "Card"
            AccountType.EXCHANGE -> "Exchange"
            AccountType.OTHER -> "Other"
        }

        fun thisMonth(): String = Dates.monthOf(Dates.today())

        /** Currencies offered first; any other three-letter code can be typed. */
        val CURRENCIES = listOf("BDT", "USD", "EUR", "GBP", "INR", "AED", "SAR", "MYR", "SGD", "CAD", "AUD", "PKR")
    }
}
