package io.github.fr_ost.hisab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class PinTest {
    private val fast = 1_000

    @Test
    fun keepsOnlyASaltedSlowHash() {
        val stored = Pin.hash("4821", iterations = fast)
        assertFalse(stored.contains("4821"))
        assertNotEquals(stored, Pin.hash("4821", iterations = fast))
        assertTrue(Pin.matches("4821", stored))
        assertFalse(Pin.matches("4822", stored))
        assertFalse(Pin.matches("4821", "plain.4821"))
        assertTrue(Pin.isValid("0000") && Pin.isValid("12345678"))
        assertFalse(Pin.isValid("123") || Pin.isValid("123456789") || Pin.isValid("12a4"))
    }

    @Test
    fun waitsGrowAfterEveryFifthWrongPinAsOnTheWebsite() {
        assertEquals(listOf(0, 0, 0, 0, 1, 0, 0, 0, 0, 5), (1..10).map(Pin::waitMinutes))
        assertEquals(30, Pin.waitMinutes(15))
        assertEquals(24 * 60, Pin.waitMinutes(20))
        assertEquals(24 * 60, Pin.waitMinutes(40))
    }

    @Test
    fun aWaitMeansNoPinIsLookedAt() {
        val stored = Pin.hash("4821", iterations = fast)
        var attempts = Pin.Attempts()
        var now = 1_000_000L
        repeat(4) { i ->
            val (check, next) = Pin.check("0000", stored, attempts, now)
            assertEquals(Pin.Check.Incorrect(Pin.TRIES - (i + 1)), check)
            attempts = next
        }
        val (fifth, waiting) = Pin.check("0000", stored, attempts, now)
        assertEquals(Pin.Check.Wait(60), fifth)
        // Even the right PIN waits.
        now += 30_000
        assertEquals(Pin.Check.Wait(30), Pin.check("4821", stored, waiting, now).first)
        now += 31_000
        val (right, cleared) = Pin.check("4821", stored, waiting, now)
        assertEquals(Pin.Check.Correct, right)
        assertEquals(Pin.Attempts(), cleared)
    }
}
