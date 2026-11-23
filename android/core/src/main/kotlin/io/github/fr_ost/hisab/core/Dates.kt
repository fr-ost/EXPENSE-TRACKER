package io.github.fr_ost.hisab.core

import java.time.DateTimeException
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * Dates are ISO strings, "2026-09-28", as on the website: they sort as text,
 * and the backup file and the SMS reader use them as they are. Months are
 * "2026-09". Times of day are "14:30" (to the minute) or "14:30:05".
 */
object Dates {
    private val ISO = Regex("""^\d{4}-\d{2}-\d{2}$""")
    private val TIME = Regex("""^([01]\d|2[0-3]):[0-5]\d$""")
    private val TIME_SECONDS = Regex("""^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$""")

    fun isValid(value: String): Boolean = ISO.matches(value) && try {
        LocalDate.parse(value)
        true
    } catch (_: DateTimeException) {
        false
    }

    fun isTime(value: String): Boolean = TIME.matches(value)

    fun isTimeWithSeconds(value: String): Boolean = TIME_SECONDS.matches(value)

    fun of(year: Int, month: Int, day: Int): String = "%04d-%02d-%02d".format(year, month, day)

    fun parse(value: String): LocalDate = LocalDate.parse(value)

    fun addDays(value: String, days: Long): String = parse(value).plusDays(days).toString()

    fun addMonths(value: String, months: Long): String = parse(value).plusMonths(months).toString()

    fun addYears(value: String, years: Long): String = parse(value).plusYears(years).toString()

    fun daysBetween(later: String, earlier: String): Long = ChronoUnit.DAYS.between(parse(earlier), parse(later))

    fun monthOf(value: String): String = value.substring(0, 7)

    fun monthStart(month: String): String = "$month-01"

    fun monthEnd(month: String): String = YearMonth.parse(month).atEndOfMonth().toString()

    fun shiftMonth(month: String, months: Long): String = YearMonth.parse(month).plusMonths(months).toString()

    fun daysInMonth(year: Int, month: Int): Int = YearMonth.of(year, month).lengthOfMonth()

    fun min(a: String, b: String): String = if (a <= b) a else b

    fun max(a: String, b: String): String = if (a >= b) a else b

    /** Today where the person is. */
    fun today(zone: ZoneId = ZoneId.systemDefault()): String = LocalDate.now(zone).toString()

    /** The time of day where the person is: "14:30", or "14:30:05" with `seconds`. */
    fun now(zone: ZoneId = ZoneId.systemDefault(), seconds: Boolean = false): String =
        LocalTime.now(zone).truncatedTo(ChronoUnit.SECONDS).format(DateTimeFormatter.ofPattern(if (seconds) "HH:mm:ss" else "HH:mm"))

    /** A moment (milliseconds since 1970) as the date and time it was where the person is. */
    fun local(instant: Long, zone: ZoneId = ZoneId.systemDefault()): Pair<String, String> {
        val at = ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(instant), zone)
        return at.toLocalDate().toString() to at.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm"))
    }
}

/** "Now" for the person: today, and the time of day to the second when known. */
data class Clock(val today: String, val time: String? = null) {
    companion object {
        fun now(zone: ZoneId = ZoneId.systemDefault()) = Clock(Dates.today(zone), Dates.now(zone, seconds = true))
    }
}
