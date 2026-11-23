package io.github.fr_ost.hisab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Two phones sharing a ledger through their files in Google Drive. */
class SyncFilesTest {
    /** A phone: its ledger, its clock and its id, changed and synced as the app does. */
    private class Phone(val device: String, start: Long) {
        var data = LedgerData()
        private var now = start
        private val clock = SyncClock({ now })

        fun commit(records: List<Synced>) {
            now += 10
            data = data.withRecords(records.map { it.stamped(clock.next(), device) })
        }

        /** Merge in what other phones wrote, then write this phone's own file. */
        fun sync(drive: MutableMap<String, ByteArray>) {
            for ((name, bytes) in drive) {
                if (name == SyncFiles.name(device)) continue
                val theirs = SyncFiles.read(bytes) ?: continue
                theirs.records().forEach { clock.observe(it.updatedAt) }
                val merged = Sync.merge(data, theirs)
                data = data.withRecords(Sync.changed(data, merged))
            }
            drive[SyncFiles.name(device)] = SyncFiles.write(data, device, now)
        }
    }

    private val clock = Clock("2026-09-28")

    @Test
    fun aFileRoundTripsEverythingIncludingDeletions() {
        val phone = Phone("phone-a", 1_000)
        phone.commit(listOf(phone.data.settings.copy(displayName = "Rahim")) + Edits.starterCategories(1))
        val cash = Edits.saveAccount(phone.data, AccountInput("Cash", AccountType.CASH, "BDT", 50_000, "2026-09-01"), createdAt = 2)
        phone.commit(listOf(cash))
        val food = phone.data.categories.first { it.name == "Food" }
        val spent = Edits.addTransaction(phone.data, EntryInput(EntryType.EXPENSE, 12_000, "2026-09-27", accountId = cash.id, categoryId = food.id, scope = ExpenseScope.PERSONAL), clock, createdAt = 3)
        phone.commit(listOf(spent))
        phone.commit(Edits.deleteTransaction(phone.data, spent.id))

        val read = SyncFiles.read(SyncFiles.write(phone.data, "phone-a", 99))!!
        assertEquals(phone.data, read)
        assertTrue(read.transactions.single().deleted)
        assertTrue(SyncFiles.isSyncFile(SyncFiles.name("phone-a")))
    }

    @Test
    fun twoPhonesEndUpWithTheSameLedger() {
        val drive = mutableMapOf<String, ByteArray>()
        val a = Phone("phone-a", 1_000)
        a.commit(listOf(a.data.settings.copy(displayName = "Rahim")) + Edits.starterCategories(1))
        val cash = Edits.saveAccount(a.data, AccountInput("Cash", AccountType.CASH, "BDT", 50_000, "2026-09-01"), createdAt = 2)
        a.commit(listOf(cash))
        a.sync(drive)

        // A second phone restores from Drive, then both keep working.
        val b = Phone("phone-b", 500) // its clock runs slow
        b.sync(drive)
        assertEquals(a.data.records().toSet(), b.data.records().toSet())

        val food = a.data.categories.first { it.name == "Food" }
        a.commit(listOf(Edits.addTransaction(a.data, EntryInput(EntryType.EXPENSE, 10_000, "2026-09-27", accountId = cash.id, categoryId = food.id, scope = ExpenseScope.PERSONAL), clock, createdAt = 10)))
        // Meanwhile b renames the account, and edits it after seeing a's version: b's later edit wins on both.
        b.commit(listOf(Edits.saveAccount(b.data, AccountInput("Pocket", AccountType.CASH, "BDT", 50_000, "2026-09-01"), cash.id, cash.createdAt)))

        a.sync(drive)
        b.sync(drive)
        a.sync(drive)
        assertEquals(a.data.records().toSet(), b.data.records().toSet())
        assertEquals("Pocket", a.data.accounts.single().name)
        assertEquals(1, b.data.live().transactions.size)
        assertEquals(40_000, Ledger(b.data).balance(cash.id, "2026-09-28"))

        // A deletion on one phone reaches the other.
        b.commit(Edits.deleteTransaction(b.data, b.data.transactions.single().id))
        b.sync(drive)
        a.sync(drive)
        assertTrue(a.data.live().transactions.isEmpty())
    }

    @Test
    fun aFileFromANewerAppOrNotAFileAtAllIsLeftAlone() {
        assertNull(SyncFiles.read("not gzip".toByteArray()))
        val newer = java.io.ByteArrayOutputStream().also { out ->
            java.util.zip.GZIPOutputStream(out).use { it.write("""{"format":"hisab-sync","version":99,"device":"x","writtenAt":1,"data":{}}""".toByteArray()) }
        }.toByteArray()
        assertNull(SyncFiles.read(newer))
        val other = java.io.ByteArrayOutputStream().also { out ->
            java.util.zip.GZIPOutputStream(out).use { it.write("""{"format":"something-else","version":1,"device":"x","writtenAt":1,"data":{}}""".toByteArray()) }
        }.toByteArray()
        assertNull(SyncFiles.read(other))
    }
}
