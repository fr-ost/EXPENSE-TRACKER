package io.github.fr_ost.hisab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SyncTest {
    private fun account(id: String, name: String, at: Long, device: String, deleted: Boolean = false) =
        Account(id, name, AccountType.CASH, "BDT", 0, "2026-01-01", createdAt = 1, updatedAt = at, device = device, deleted = deleted)

    @Test
    fun theLaterChangeWinsAndEveryPhonePicksTheSameOne() {
        val mine = listOf(account("a", "Cash", 100, "phone-a"), account("b", "Bank", 300, "phone-a"))
        val theirs = listOf(account("a", "Wallet", 200, "phone-b"), account("b", "Old bank", 250, "phone-b"), account("c", "bKash", 50, "phone-b"))
        val merged = Sync.merge(mine, theirs).associateBy { it.id }
        assertEquals(mapOf("a" to "Wallet", "b" to "Bank", "c" to "bKash"), merged.mapValues { it.value.name })
        assertEquals(Sync.merge(theirs, mine).toSet(), Sync.merge(mine, theirs).toSet())
        // A tie on time is settled by the device id, the same way on both phones.
        val tie = Sync.merge(listOf(account("a", "A", 5, "phone-a")), listOf(account("a", "B", 5, "phone-b")))
        assertEquals("B", tie.single().name)
    }

    @Test
    fun aDeletionReachesTheOtherPhoneUnlessItWasEditedLater() {
        val deleted = listOf(account("a", "Cash", 200, "phone-a", deleted = true))
        assertTrue(Sync.merge(listOf(account("a", "Cash", 100, "phone-b")), deleted).single().deleted)
        assertEquals(false, Sync.merge(listOf(account("a", "Cash", 300, "phone-b")), deleted).single().deleted)
    }

    @Test
    fun theClockNeverGoesBackwards() {
        var now = 1000L
        val clock = SyncClock({ now })
        assertEquals(1000L, clock.next())
        assertEquals(1001L, clock.next()) // same millisecond: still later
        clock.observe(5000) // another phone's clock is ahead
        assertEquals(5001L, clock.next())
        now = 9000
        assertEquals(9000L, clock.next())
    }

    @Test
    fun theSameThingGetsTheSameIdOnEveryPhone() {
        assertEquals(Ids.stable("sms", "abc", "0"), Ids.stable("sms", "abc", "0"))
        assertTrue(Ids.stable("sms", "abc", "0") != Ids.stable("sms", "abc", "1"))
        assertTrue(Ids.stable("ab", "c") != Ids.stable("a", "bc"))
        assertTrue(Ids.new() != Ids.new())
    }

    @Test
    fun mergingWholeLedgersReportsWhatChanged() {
        val before = LedgerData(accounts = listOf(account("a", "Cash", 100, "phone-a")))
        val remote = LedgerData(
            settings = Settings(displayName = "Shahana", updatedAt = 50, device = "phone-b"),
            accounts = listOf(account("a", "Cash", 100, "phone-a"), account("b", "Bank", 120, "phone-b")),
        )
        val merged = Sync.merge(before, remote)
        assertEquals("Shahana", merged.settings.displayName)
        assertEquals(listOf("settings", "b"), Sync.changed(before, merged).map { it.id })
    }
}
