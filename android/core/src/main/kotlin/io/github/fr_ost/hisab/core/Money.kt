package io.github.fr_ost.hisab.core

import java.math.BigInteger

/**
 * Exact money: amounts are whole paisa (cents) in a Long — "1234.50" is
 * 123450. Never a Double. Mirrors src/lib/money.ts.
 */
object Money {
    /** The largest amount Hisab keeps: 999,999,999,999.99 (NUMERIC(14,2) on the website). */
    const val MAX_MINOR = 99_999_999_999_999L

    // A bare trailing point ("12.", while typing) reads as whole units.
    private val PATTERN = Regex("""^(-)?(\d+)(?:\.(\d{0,2}))?$""")
    private val RATE = Regex("""^(\d{1,9})(?:\.(\d{1,6}))?$""")

    /** "1234.5" → 123450; null when it isn't an amount (or is out of range). */
    fun parse(value: String): Long? {
        val match = PATTERN.matchEntire(value.trim()) ?: return null
        val (negative, whole, fraction) = match.destructured
        if (whole.length > 12) return null
        val minor = whole.toLong() * 100 + fraction.padEnd(2, '0').toLong()
        if (minor > MAX_MINOR) return null
        return if (negative.isNotEmpty()) -minor else minor
    }

    /** What a person typed: "1,234.50", " 12 ". Null when it isn't an amount. */
    fun parseInput(value: String): Long? = parse(value.replace(",", "").replace(" ", ""))

    /** 123450 → "1234.50" (the website's and the backup file's form). */
    fun decimal(minor: Long): String {
        val abs = if (minor < 0) -minor else minor
        return "${if (minor < 0) "-" else ""}${abs / 100}.${(abs % 100).toString().padStart(2, '0')}"
    }

    /** 123450 → "1234.5", 200000 → "2000": for an amount field. */
    fun editable(minor: Long): String = decimal(minor).removeSuffix(".00").let { if (it.contains('.')) it.trimEnd('0') else it }

    fun isRate(value: String): Boolean = RATE.matches(value.trim()) && value.any { it in '1'..'9' }

    /** "0122.450000" → "122.45". */
    fun normalizeRate(rate: String): String {
        val parts = rate.trim().split(".")
        val whole = parts[0].ifEmpty { "0" }.toBigInteger().toString()
        val kept = parts.getOrElse(1) { "" }.trimEnd('0')
        return if (kept.isEmpty()) whole else "$whole.$kept"
    }

    /**
     * An amount in another currency, in the main one, at `rate` (main units
     * for one unit): exact, rounded to the nearest paisa, halves away from
     * zero (as the website's SQL ROUND does).
     */
    fun convert(minor: Long, rate: String): Long {
        val match = RATE.matchEntire(rate.trim()) ?: throw IllegalArgumentException("Invalid rate: \"$rate\"")
        val (whole, fraction) = match.destructured
        val scale = BigInteger.TEN.pow(fraction.length)
        val product = BigInteger.valueOf(minor) * BigInteger(whole + fraction)
        val (quotient, remainder) = product.divideAndRemainder(scale)
        val away = remainder.abs() * BigInteger.TWO >= scale
        return (if (away) quotient + BigInteger.valueOf(product.signum().toLong()) else quotient).toLong()
    }

    /** `part / whole` in percent (two decimals of precision), or null when `whole` is zero. */
    fun percentOf(part: Long, whole: Long): Double? {
        if (whole == 0L) return null
        val basisPoints = BigInteger.valueOf(part) * BigInteger.valueOf(10_000) / BigInteger.valueOf(whole)
        return basisPoints.toDouble() / 100
    }

    private val SYMBOLS = mapOf(
        "BDT" to "৳", "USD" to "$", "EUR" to "€", "GBP" to "£", "INR" to "₹", "PKR" to "Rs",
        "AED" to "AED ", "SAR" to "SAR ", "MYR" to "RM", "SGD" to "S$", "CAD" to "C$", "AUD" to "A$",
    )

    fun symbol(currency: String): String = SYMBOLS[currency] ?: "$currency "

    enum class Sign { NEGATIVE, ALWAYS, NEVER }

    /**
     * "৳1,23,456.50": the person's grouping (South Asian 1,23,456 or
     * international 123,456), a true minus sign, the fraction only when it
     * isn't zero (unless `alwaysDecimals`).
     */
    fun format(
        minor: Long,
        currency: String = "BDT",
        grouping: NumberFormat = NumberFormat.SOUTH_ASIAN,
        alwaysDecimals: Boolean = false,
        sign: Sign = Sign.NEGATIVE,
        plain: Boolean = false,
    ): String {
        val abs = if (minor < 0) -minor else minor
        val whole = group((abs / 100).toString(), grouping)
        val fraction = abs % 100
        val decimals = if (alwaysDecimals || fraction != 0L) ".${fraction.toString().padStart(2, '0')}" else ""
        val prefix = when {
            sign == Sign.NEVER -> ""
            minor < 0 -> "−"
            sign == Sign.ALWAYS && minor > 0 -> "+"
            else -> ""
        }
        return "$prefix${if (plain) "" else symbol(currency)}$whole$decimals"
    }

    private fun group(digits: String, grouping: NumberFormat): String {
        if (digits.length <= 3) return digits
        val last = digits.takeLast(3)
        val rest = digits.dropLast(3)
        val size = if (grouping == NumberFormat.SOUTH_ASIAN) 2 else 3
        val groups = ArrayDeque<String>()
        var end = rest.length
        while (end > 0) {
            groups.addFirst(rest.substring(maxOf(0, end - size), end))
            end -= size
        }
        return groups.joinToString(",") + ",$last"
    }
}
