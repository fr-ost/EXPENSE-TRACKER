package io.github.fr_ost.hisab.core

import io.github.fr_ost.hisab.core.Fixture.Companion.TODAY
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The website's entry rules (resolveEntry and friends), on the phone. */
class EditsTest {
    private val clock = Clock(TODAY, "12:00:00")

    private fun refused(field: String?, block: () -> Unit): String {
        val error = assertFailsWith<EditError> { block() }
        assertEquals(field, error.field, error.message)
        return error.message!!
    }

    @Test
    fun anExpenseTakesItsCategorysUsualScopeAndTheMomentItWasRecorded() {
        val f = Fixture()
        val cash = f.account("Cash", tk("1000"))
        val t = Edits.addTransaction(f.data, EntryInput(EntryType.EXPENSE, tk("120"), TODAY, accountId = cash, categoryId = f.food, description = "  Lunch "), clock, id = "t1", createdAt = 5)
        assertEquals(ExpenseScope.PERSONAL, t.scope)
        assertEquals("Lunch", t.description)
        assertEquals("12:00:00", t.loggedTime)
        // A back-dated one counts at the end of its day.
        val old = Edits.addTransaction(f.data, EntryInput(EntryType.EXPENSE, tk("50"), "2026-09-01", accountId = cash, categoryId = f.food), clock)
        assertNull(old.loggedTime)
        // A time of its own wins.
        val timed = Edits.addTransaction(f.data, EntryInput(EntryType.EXPENSE, tk("50"), TODAY, "09:15", accountId = cash, categoryId = f.food), clock)
        assertEquals("09:15", timed.time)
        assertNull(timed.loggedTime)
    }

    @Test
    fun refusesEntriesThatDontAddUp() {
        val f = Fixture()
        val cash = f.account("Cash", tk("1000"))
        val usd = f.account("Payoneer", 0, currency = "USD")
        fun add(input: EntryInput) = Edits.addTransaction(f.data, input, clock)
        val expense = EntryInput(EntryType.EXPENSE, tk("10"), TODAY, accountId = cash, categoryId = f.food)
        refused("amount") { add(expense.copy(amount = 0)) }
        refused("date") { add(expense.copy(date = "2027-10-01")) }
        refused("date") { add(expense.copy(date = "2026-02-30")) }
        refused("time") { add(expense.copy(time = "25:00")) }
        refused("accountId") { add(expense.copy(accountId = "nowhere")) }
        refused("categoryId") { add(expense.copy(categoryId = f.salary)) }
        refused("categoryId") { add(expense.copy(categoryId = null)) }
        refused("toAccountId") { add(EntryInput(EntryType.TRANSFER, tk("10"), TODAY, accountId = cash, toAccountId = cash)) }
        assertTrue(refused("toAmount") { add(EntryInput(EntryType.TRANSFER, tk("10"), TODAY, accountId = cash, toAccountId = usd)) }.contains("USD"))
        // Same currency: no amount received is kept.
        val other = f.account("Bank", 0)
        assertNull(add(EntryInput(EntryType.TRANSFER, tk("10"), TODAY, accountId = cash, toAccountId = other, toAmount = tk("99"))).toAmount)
        assertEquals(tk("0.08"), add(EntryInput(EntryType.TRANSFER, tk("10"), TODAY, accountId = cash, toAccountId = usd, toAmount = tk("0.08"))).toAmount)
    }

    @Test
    fun anInactiveAccountOrArchivedCategoryIsOnlyForEntriesThatAlreadyUsedIt() {
        val f = Fixture()
        val cash = f.account("Cash", tk("1000"))
        val old = Edits.addTransaction(f.data, EntryInput(EntryType.EXPENSE, tk("10"), "2026-09-01", accountId = cash, categoryId = f.food), clock)
        f.add(old)
        f.data = f.data.copy(
            accounts = f.data.accounts.map { it.copy(isActive = false) },
            categories = f.data.categories.map { it.copy(isArchived = true) },
        )
        refused("accountId") { Edits.addTransaction(f.data, EntryInput(EntryType.EXPENSE, tk("10"), TODAY, accountId = cash, categoryId = f.food), clock) }
        val edited = Edits.updateTransaction(f.data, old.id, EntryInput(EntryType.EXPENSE, tk("12"), "2026-09-01", accountId = cash, categoryId = f.food), clock)
        assertEquals(tk("12"), edited.amount)
        assertEquals(old.createdAt, edited.createdAt)
    }

    @Test
    fun anEditThatLeavesTheDateAndTimeAloneKeepsItsPlace() {
        val f = Fixture()
        val cash = f.account("Cash", tk("1000"))
        val first = Edits.addTransaction(f.data, EntryInput(EntryType.EXPENSE, tk("100"), TODAY, accountId = cash, categoryId = f.food), Clock(TODAY, "09:00:00"))
        f.add(first)
        val edited = Edits.updateTransaction(f.data, first.id, EntryInput(EntryType.EXPENSE, tk("120"), TODAY, accountId = cash, categoryId = f.food), Clock(TODAY, "11:00:00"))
        assertEquals("09:00:00", edited.loggedTime)
    }

    @Test
    fun deletingAnSmsEntryTakesTheBalanceItReportedWithIt() {
        val f = Fixture()
        val wallet = f.account("bKash", tk("2537"))
        val main = Transaction("m", EntryType.EXPENSE, tk("350"), TODAY, accountId = wallet, categoryId = f.food, scope = ExpenseScope.PERSONAL, smsKey = "sms:abc:0", createdAt = 1)
        val fee = main.copy(id = "f", amount = tk("5"), smsKey = "sms:abc:1")
        f.add(main)
        f.add(fee)
        f.data = f.data.copy(checkpoints = listOf(Checkpoint("b", wallet, TODAY, balance = tk("2182"), source = CheckpointSource.SMS, smsKey = "sms:abc:b", messageDate = TODAY, createdAt = 2)))
        val gone = Edits.deleteTransaction(f.data, "m")
        assertEquals(listOf("m", "b"), gone.map { it.id })
        assertTrue(gone.all { it.deleted })
        assertEquals(listOf("f"), Edits.deleteTransaction(f.data, "f").map { it.id })
    }

    @Test
    fun accountsHaveUniqueNamesAndKeepTheirHistory() {
        val f = Fixture()
        val cash = f.account("Cash", tk("1000"))
        val input = AccountInput("  cash ", AccountType.CASH, "BDT", 0, TODAY)
        refused("name") { Edits.saveAccount(f.data, input) }
        refused("name") { Edits.saveAccount(f.data, input.copy(name = "  ")) }
        refused("currency") { Edits.saveAccount(f.data, input.copy(name = "Wallet", currency = "taka")) }
        val wallet = Edits.saveAccount(f.data, input.copy(name = "My   Wallet"), createdAt = 9)
        assertEquals("My Wallet", wallet.name)
        assertEquals(1, wallet.sortOrder)

        f.expense(cash, tk("10"), TODAY)
        assertTrue(refused(null) { Edits.deleteAccount(f.data, cash) }.contains("Deactivate"))
        refused("currency") { Edits.saveAccount(f.data, input.copy(name = "Cash", currency = "USD"), id = cash) }
        val unused = f.account("Unused", 0)
        assertEquals(listOf(unused), Edits.deleteAccount(f.data, unused).map { it.id })
    }

    @Test
    fun aBalanceUpdateIsForNowOrEarlierAndSaysWhatTheLedgerHad() {
        val f = Fixture()
        val wallet = f.account("bKash", tk("5000"))
        f.expense(wallet, tk("100"), "2026-09-10")
        f.expense(wallet, tk("50"), TODAY, "11:00")
        refused("date") { Edits.updateBalance(f.data, wallet, tk("10"), "2026-09-29", null, clock) }
        refused("time") { Edits.updateBalance(f.data, wallet, tk("10"), TODAY, "18:00", clock) }
        assertEquals(tk("4900"), Edits.recordedBalanceAt(f.data, wallet, TODAY, "10:30", clock))
        assertEquals(tk("4850"), Edits.recordedBalanceAt(f.data, wallet, TODAY, null, clock))
        val update = Edits.updateBalance(f.data, wallet, tk("4700"), TODAY, "10:30", clock, note = " counted ")
        assertEquals("counted", update.note)
        f.data = f.data.copy(checkpoints = listOf(update))
        assertEquals(tk("4650"), f.balance(wallet))
    }

    @Test
    fun anUpdateBeforeTheOpeningBalanceSeesWhatHistorySays() {
        val f = Fixture()
        val wallet = f.account("bKash", tk("5000"))
        f.expense(wallet, tk("100"), "2025-12-15")
        assertEquals(tk("5100"), Edits.recordedBalanceAt(f.data, wallet, "2025-12-01", null, clock))
    }

    @Test
    fun categoriesStartLikeTheWebsitesAndUsedOnesAreArchivedNotDeleted() {
        val starters = Edits.starterCategories(1)
        assertEquals(20, starters.size)
        assertEquals(ExpenseScope.FAMILY, starters.first { it.name == "Family" }.defaultScope)
        assertEquals(Edits.starterCategories(2).map { it.id }, starters.map { it.id })
        val f = Fixture()
        val cash = f.account("Cash", tk("1000"))
        f.expense(cash, tk("10"), TODAY)
        assertTrue(refused(null) { Edits.deleteCategory(f.data, f.food) }.contains("Archive"))
        refused("name") { Edits.saveCategory(f.data, "food", CategoryKind.EXPENSE, null, "x", "gray") }
        // The same name is fine for the other kind.
        assertEquals("Food", Edits.saveCategory(f.data, "Food", CategoryKind.INCOME, null, "x", "gray").name)
    }

    @Test
    fun budgetsAndRates() {
        val f = Fixture()
        val budget = Edits.setBudget(f.data, ExpenseScope.FAMILY, "2026-09", tk("20000"))
        assertEquals("FAMILY:2026-09-01", budget.id)
        f.data = f.data.copy(budgets = listOf(budget))
        assertEquals(budget, Edits.budgetFor(f.data, ExpenseScope.FAMILY, "2026-11"))
        assertNull(Edits.budgetFor(f.data, ExpenseScope.FAMILY, "2026-08"))
        assertTrue(Edits.setBudget(f.data, ExpenseScope.FAMILY, "2026-09", null).deleted)
        refused("currency") { Edits.setRate(f.data, "BDT", "1") }
        refused("rate") { Edits.setRate(f.data, "USD", "abc") }
        assertEquals("122.45", Edits.setRate(f.data, "USD", "0122.450").rate)
    }
}
