package io.github.fr_ost.hisab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MoneyTest {
    @Test
    fun readsAndWritesAmountsExactly() {
        assertEquals(123450L, Money.parse("1234.5"))
        assertEquals(-5L, Money.parse("-0.05"))
        assertEquals(1200L, Money.parse("12."))
        assertEquals(Money.MAX_MINOR, Money.parse("999999999999.99"))
        for (bad in listOf("", "abc", "1.234", "1,000", "1e5", "--1", "9999999999999")) assertNull(Money.parse(bad), bad)
        assertEquals(100000L, Money.parseInput(" 1,000 "))
        assertEquals("1234.50", Money.decimal(123450))
        assertEquals("-0.05", Money.decimal(-5))
        assertEquals("1234.5", Money.editable(123450))
        assertEquals("2000", Money.editable(200000))
        assertEquals("0.05", Money.editable(5))
    }

    @Test
    fun formatsAsPeopleWriteIt() {
        assertEquals("৳1,23,456.50", Money.format(12345650))
        assertEquals("৳123,456.50", Money.format(12345650, grouping = NumberFormat.INTERNATIONAL))
        assertEquals("৳2,000", Money.format(200000))
        assertEquals("৳2,000.00", Money.format(200000, alwaysDecimals = true))
        assertEquals("−৳500", Money.format(-50000))
        assertEquals("+$5", Money.format(500, "USD", sign = Money.Sign.ALWAYS))
        assertEquals("৳1,00,00,000", Money.format(1_000_000_000))
        assertEquals("৳999", Money.format(99900))
        assertEquals("1,234", Money.format(123400, plain = true))
        assertEquals("JPY 5", Money.format(500, "JPY"))
    }

    @Test
    fun convertsCurrenciesRoundingHalvesAwayFromZero() {
        assertEquals(61000L, Money.convert(500, "122"))
        assertEquals(12245L, Money.convert(100, "122.45"))
        // 0.01 × 0.5 = 0.005 → 0.01; −0.005 → −0.01
        assertEquals(1L, Money.convert(1, "0.5"))
        assertEquals(-1L, Money.convert(-1, "0.5"))
        assertEquals(0L, Money.convert(1, "0.4"))
        assertEquals("122.45", Money.normalizeRate("0122.450000"))
        assertEquals("7", Money.normalizeRate("7.000"))
        assertEquals(true, Money.isRate("122.45"))
        assertEquals(false, Money.isRate("0"))
        assertEquals(false, Money.isRate("1.1234567"))
        assertEquals(50.0, Money.percentOf(50, 100))
        assertNull(Money.percentOf(5, 0))
    }
}
