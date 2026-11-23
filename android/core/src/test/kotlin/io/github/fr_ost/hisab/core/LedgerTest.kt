package io.github.fr_ost.hisab.core

import io.github.fr_ost.hisab.core.Fixture.Companion.TODAY
import kotlin.test.Test
import kotlin.test.assertEquals

/** The website's balance tests (tests/integration/balances.test.ts), on the phone's ledger. */
class LedgerTest {
    @Test
    fun backFillingTransactionsFromBeforeTheOpeningBalanceNeverChangesIt() {
        val f = Fixture()
        val wallet = f.account("bKash", tk("5000"), openingDate = TODAY)
        f.expense(wallet, tk("1000"), "2026-08-15")
        f.expense(wallet, tk("250.50"), "2026-09-01")
        assertEquals(tk("5000"), f.balance(wallet))
        // History is derived backwards from the known balance.
        assertEquals(tk("5250.50"), f.balance(wallet, "2026-08-31"))
        assertEquals(tk("6250.50"), f.balance(wallet, "2026-08-14"))
        // New spending from today on does move it.
        f.expense(wallet, tk("100"), TODAY)
        assertEquals(tk("4900"), f.balance(wallet))
    }

    @Test
    fun aBalanceUpdateCorrectsTheBalanceAndAbsorbsAnythingAddedBeforeItLater() {
        val f = Fixture()
        val wallet = f.account("Wallet", tk("5000"))
        f.expense(wallet, tk("1000"), "2026-02-10")
        assertEquals(tk("4000"), f.balance(wallet))
        f.update(wallet, tk("5000"), TODAY, "10:00")
        assertEquals(tk("5000"), f.balance(wallet))
        // Older spending recorded afterwards: the balance after the update stays put.
        f.expense(wallet, tk("2000"), "2026-03-05")
        assertEquals(tk("5000"), f.balance(wallet))
        // Earlier the same day (09:30, before the 10:00 update) is absorbed too.
        f.expense(wallet, tk("200"), TODAY, "09:30")
        assertEquals(tk("5000"), f.balance(wallet))
        // After the update (a later time, or no time: the end of the day) it counts.
        f.expense(wallet, tk("300"), TODAY, "18:00")
        f.expense(wallet, tk("150"), TODAY)
        assertEquals(tk("4550"), f.balance(wallet))
        val correction = Ledger(f.data).corrections.single { it.kind == Correction.Kind.CORRECTION }
        assertEquals(tk("3200"), correction.amount)
    }

    @Test
    fun eachUpdateOnlyCorrectsWhatHappenedSinceThePreviousOne() {
        val f = Fixture()
        val wallet = f.account("Wallet", 0)
        val feb = f.update(wallet, tk("1000"), "2026-02-01")
        f.income(wallet, tk("500"), "2026-03-01")
        val apr = f.update(wallet, tk("1500"), "2026-04-01")
        f.expense(wallet, tk("100"), "2026-05-01")
        val jun = f.update(wallet, tk("1300"), "2026-06-01")

        val corrections = Ledger(f.data).corrections.filter { it.kind == Correction.Kind.CORRECTION }.associate { it.checkpointId to it.amount }
        assertEquals(mapOf(feb to tk("1000"), apr to 0L, jun to tk("-100")), corrections)
        assertEquals(0L, f.balance(wallet, "2026-01-31"))
        assertEquals(tk("1500"), f.balance(wallet, "2026-03-15"))
        assertEquals(tk("1400"), f.balance(wallet, "2026-05-15"))
        assertEquals(tk("1300"), f.balance(wallet))

        // Deleting an update hands its correction to the next one.
        f.deleteCheckpoint(apr)
        assertEquals(tk("1300"), f.balance(wallet))
        assertEquals(tk("-100"), Ledger(f.data).corrections.single { it.checkpointId == jun }.amount)
        // Deleting all of them leaves the plain ledger.
        f.deleteCheckpoint(feb)
        f.deleteCheckpoint(jun)
        assertEquals(tk("400"), f.balance(wallet))
    }

    @Test
    fun keepsOpeningPlusInMinusOutPlusCorrectionsEqualToTheBalance() {
        val f = Fixture()
        val wallet = f.account("Wallet", tk("1000"), openingDate = "2026-09-01")
        f.expense(wallet, tk("300"), "2026-09-05")
        f.expense(wallet, tk("999"), "2026-08-20") // history
        f.update(wallet, tk("900"), "2026-09-20", "12:00")

        val summary = Ledger(f.data).summaries(TODAY).single()
        assertEquals(tk("900"), summary.balance)
        assertEquals(0L, summary.inflow)
        assertEquals(tk("300"), summary.outflow)
        assertEquals(tk("200"), summary.corrections)
        assertEquals(2, summary.transactionCount)
        assertEquals("2026-09-20", summary.lastUpdate?.date)
        assertEquals("12:00", summary.lastUpdate?.time)
        val fx = Conversion.only("BDT")
        assertEquals(tk("200"), Analytics(f.data).periodSummary("2026-09-01", "2026-09-30", fx).adjustments)
    }

    @Test
    fun entriesWithoutATimeRecordedOnALaterDayCountAtTheEndOfTheirDay() {
        val f = Fixture()
        val wallet = f.account("bKash", tk("5000"))
        f.update(wallet, tk("4000"), "2026-09-20", "12:00")
        // Back-filled today for the 20th, no time: after the 12:00 update.
        f.expense(wallet, tk("100"), "2026-09-20", loggedTime = Ledger.loggedTimeFor("2026-09-20", null, Clock(TODAY, "10:01:00")))
        assertEquals(tk("3900"), f.balance(wallet))
    }

    @Test
    fun anEntryRecordedOnItsOwnDateSitsWhereItWasRecorded() {
        val f = Fixture()
        val wallet = f.account("bKash", tk("5000"))
        val logged = Ledger.loggedTimeFor(TODAY, null, Clock(TODAY, "09:00:00"))
        assertEquals("09:00:00", logged)
        f.expense(wallet, tk("100"), TODAY, loggedTime = logged)
        f.update(wallet, tk("4900"), TODAY, loggedTime = "10:00:00")
        f.expense(wallet, tk("20"), TODAY, loggedTime = "11:00:00")
        // Before the 10:00 update the 100 is absorbed; after it the 20 counts.
        assertEquals(tk("4880"), f.balance(wallet))
    }

    @Test
    fun anUpdateBeforeTheOpeningBalanceOnlyFillsInHistory() {
        val f = Fixture()
        val wallet = f.account("bKash", tk("5000"))
        f.expense(wallet, tk("100"), "2025-12-15")
        f.update(wallet, tk("7000"), "2025-12-01", loggedTime = "10:00:00")
        assertEquals(tk("7000"), f.balance(wallet, "2025-12-01"))
        assertEquals(tk("5000"), f.balance(wallet, "2026-01-01"))
        assertEquals(tk("5000"), f.balance(wallet))
    }

    @Test
    fun entriesThatDontAffectBalancesStillCountAsSpendingButMoveNoBalance() {
        val f = Fixture()
        val wallet = f.account("Card", tk("1000"))
        val cash = f.account("Cash", 0)
        f.expense(wallet, tk("250"), "2026-09-10", affectsBalance = false)
        f.transfer(wallet, cash, tk("100"), "2026-09-11", affectsBalance = false)
        assertEquals(tk("1000"), f.balance(wallet))
        assertEquals(0L, f.balance(cash))
        assertEquals(tk("250"), Analytics(f.data).periodSummary("2026-09-01", "2026-09-30", Conversion.only("BDT")).expenses)
    }

    @Test
    fun aTransferMovesBothSidesInTheirOwnCurrencies() {
        val f = Fixture()
        val bank = f.account("Bank", tk("100000"))
        val dollars = f.account("Payoneer", tk("10"), currency = "USD")
        f.transfer(dollars, bank, tk("5"), "2026-09-10", toAmount = tk("610"))
        assertEquals(tk("100610"), f.balance(bank))
        assertEquals(tk("5"), f.balance(dollars))
        assertEquals(tk("10"), f.balance(dollars, "2026-09-09"))
    }

    @Test
    fun recordsDeletedOnAnotherPhoneAreLeftOut() {
        val f = Fixture()
        val wallet = f.account("Wallet", tk("500"))
        val gone = f.account("Gone", tk("100"))
        f.expense(gone, tk("50"), "2026-09-01")
        f.data = f.data.copy(accounts = f.data.accounts.map { if (it.id == gone) it.copy(deleted = true) else it })
        val ledger = Ledger(f.data)
        assertEquals(listOf(wallet), ledger.summaries(TODAY).map { it.account.id })
        assertEquals(0L, ledger.balance(gone, TODAY))
    }
}
