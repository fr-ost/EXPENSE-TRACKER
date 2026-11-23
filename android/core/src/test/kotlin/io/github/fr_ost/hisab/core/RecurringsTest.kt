package io.github.fr_ost.hisab.core

import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The website's recurring tests (tests/integration/recurring-budgets.test.ts), on the phone. */
class RecurringsTest {
    private var data = LedgerData(categories = Edits.starterCategories(1))
    private lateinit var bank: String
    private lateinit var rent: RecurringInput

    private fun save(records: List<Synced>) {
        data = data.withRecords(records)
    }

    private fun rule() = data.live().recurring.single()
    private fun posted() = data.live().transactions.filter { it.recurringId != null }.sortedBy { it.date }

    @BeforeTest
    fun setUp() {
        val account = Edits.saveAccount(data, AccountInput("Bank", AccountType.BANK, "BDT", 10_000_000, "2025-01-01"), createdAt = 2)
        save(listOf(account))
        bank = account.id
        val housing = data.categories.first { it.name == "Housing" }.id
        rent = RecurringInput(
            type = EntryType.EXPENSE, amount = 2_200_000, accountId = bank, categoryId = housing, scope = ExpenseScope.PERSONAL,
            description = "Rent", frequency = Frequency.MONTHLY, startDate = "2026-06-03",
        )
    }

    @Test
    fun clampsMonthEndsWithoutDrifting() {
        assertEquals(listOf("2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"), (0..3).map { Recurrings.occurrenceDate("2026-01-31", Frequency.MONTHLY, it) })
        assertEquals("2025-02-28", Recurrings.occurrenceDate("2024-02-29", Frequency.YEARLY, 1))
        assertEquals("2028-02-29", Recurrings.occurrenceDate("2024-02-29", Frequency.YEARLY, 4))
        assertEquals("2026-09-15", Recurrings.occurrenceDate("2026-09-01", Frequency.WEEKLY, 2))
    }

    @Test
    fun findsTheFirstOccurrenceOnOrAfterADate() {
        assertEquals(9, Recurrings.firstIndexOnOrAfter("2026-01-05", Frequency.MONTHLY, "2026-09-28"))
        assertEquals(8, Recurrings.firstIndexOnOrAfter("2026-01-05", Frequency.MONTHLY, "2026-09-05"))
        assertTrue(Recurrings.firstIndexOnOrAfter("2020-01-01", Frequency.WEEKLY, "2026-09-28") > 300)
        assertEquals(3, Recurrings.firstIndexOnOrAfter("2026-01-05", Frequency.MONTHLY, "2026-01-01", "2026-03-05"))
    }

    @Test
    fun doesNotPostThePastUnlessAskedToBackFill() {
        save(Recurrings.create(data, rent, "2026-09-28", backfill = false))
        assertTrue(posted().isEmpty())
        assertEquals("2026-10-03", rule().nextOccurrence)
    }

    @Test
    fun backFillsFromAPastStartDate() {
        save(Recurrings.create(data, rent, "2026-09-28", backfill = true))
        assertEquals(listOf("2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03"), posted().map { it.date })
        assertEquals(10_000_000L - 4 * 2_200_000, Ledger(data).balance(bank, "2026-09-28"))
    }

    @Test
    fun postsDueOccurrencesExactlyOnceEvenOnTwoPhones() {
        save(Recurrings.create(data, rent.copy(startDate = "2026-10-03"), "2026-09-28", backfill = false))
        assertTrue(posted().isEmpty())
        // Two phones post the same months: the same ids, so one set once merged.
        val here = Recurrings.postAllDue(data, "2026-12-05")
        val there = Recurrings.postAllDue(data, "2026-12-05")
        save(here)
        save(there)
        save(Recurrings.postAllDue(data, "2026-12-05"))
        assertEquals(3, posted().size)
        assertEquals("2027-01-03", rule().nextOccurrence)
    }

    @Test
    fun stopsAtTheEndDate() {
        save(Recurrings.create(data, rent.copy(endDate = "2026-08-15"), "2026-09-28", backfill = true))
        assertEquals(3, posted().size)
        assertNull(rule().nextOccurrence)
    }

    @Test
    fun canSkipTheNextOccurrence() {
        save(Recurrings.create(data, rent.copy(startDate = "2026-10-03"), "2026-09-28", backfill = false))
        save(Recurrings.skipNext(data, rule().id))
        save(Recurrings.postAllDue(data, "2026-11-10"))
        assertEquals(listOf("2026-11-03"), posted().map { it.date })
    }

    @Test
    fun doesNotPostThePastAgainWhenTheScheduleIsEdited() {
        save(Recurrings.create(data, rent, "2026-09-28", backfill = true))
        save(Recurrings.update(data, rule().id, rent.copy(startDate = "2026-06-10"), "2026-09-28"))
        save(Recurrings.postAllDue(data, "2026-09-28"))
        assertEquals(4, posted().size)
        assertEquals("2026-10-10", rule().nextOccurrence)
    }

    @Test
    fun skipsOccurrencesMissedWhilePaused() {
        save(Recurrings.create(data, rent.copy(startDate = "2026-10-03"), "2026-09-28", backfill = false))
        save(Recurrings.setActive(data, rule().id, false, "2026-09-28"))
        save(Recurrings.postAllDue(data, "2026-12-31"))
        assertTrue(posted().isEmpty())
        save(Recurrings.setActive(data, rule().id, true, "2026-12-31"))
        assertTrue(posted().isEmpty())
        assertEquals("2027-01-03", rule().nextOccurrence)
    }

    @Test
    fun pausesARuleWhoseAccountWasDeactivatedInsteadOfPosting() {
        save(Recurrings.create(data, rent.copy(startDate = "2026-10-03"), "2026-09-28", backfill = false))
        val account = data.accounts.single()
        save(listOf(Edits.saveAccount(data, AccountInput(account.name, account.type, account.currency, account.openingBalance, account.openingDate, isActive = false), account.id, account.createdAt)))
        save(Recurrings.postAllDue(data, "2026-10-05"))
        assertTrue(posted().isEmpty())
        assertEquals(false, rule().isActive)
    }

    @Test
    fun aDeletedOccurrenceIsNotPostedAgain() {
        save(Recurrings.create(data, rent, "2026-09-28", backfill = true))
        val june = posted().first()
        save(Edits.deleteTransaction(data, june.id))
        // Even a rule set back (e.g. by an older phone) never brings it back.
        save(listOf(rule().copy(occurrenceIndex = 0, nextOccurrence = "2026-06-03")))
        save(Recurrings.postAllDue(data, "2026-09-28"))
        assertEquals(listOf("2026-07-03", "2026-08-03", "2026-09-03"), posted().map { it.date })
    }

    @Test
    fun deletingARuleKeepsWhatItPosted() {
        save(Recurrings.create(data, rent, "2026-09-28", backfill = true))
        save(Recurrings.delete(data, rule().id))
        assertTrue(data.live().recurring.isEmpty())
        assertEquals(4, data.live().transactions.size)
        assertTrue(data.live().transactions.all { it.recurringId == null })
    }

    @Test
    fun checksARuleLikeAnEntry() {
        assertFailsWith<EditError> { Recurrings.create(data, rent.copy(endDate = "2026-01-01"), "2026-09-28", backfill = false) }
        assertFailsWith<EditError> { Recurrings.create(data, rent.copy(categoryId = null), "2026-09-28", backfill = false) }
        assertFailsWith<EditError> { Recurrings.create(data, rent.copy(type = EntryType.TRANSFER, toAccountId = bank, categoryId = null, scope = null), "2026-09-28", backfill = false) }
    }

    @Test
    fun listsWhatIsComingUp() {
        save(Recurrings.create(data, rent.copy(startDate = "2026-10-03", frequency = Frequency.WEEKLY), "2026-09-28", backfill = false))
        assertEquals(listOf("2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24"), Recurrings.upcoming(data, "2026-09-28").map { it.second })
    }
}
