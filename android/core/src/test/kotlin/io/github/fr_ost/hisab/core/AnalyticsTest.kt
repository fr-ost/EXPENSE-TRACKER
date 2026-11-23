package io.github.fr_ost.hisab.core

import kotlin.test.Test
import kotlin.test.assertEquals

class AnalyticsTest {
    @Test
    fun countsIncomeAndSpendingTheWayTheWebsiteDoes() {
        val f = Fixture()
        val cash = f.account("Cash", tk("10000"))
        val card = f.account("Card", 0, type = AccountType.CARD)
        f.income(cash, tk("50000"), "2026-09-01")
        f.expense(cash, tk("1200"), "2026-09-03")
        f.expense(cash, tk("800"), "2026-09-04", scope = ExpenseScope.FAMILY)
        // Paying the card is a transfer that counts as spending; moving cash isn't spending.
        f.transfer(cash, card, tk("3000"), "2026-09-05", countAsExpense = true)
        f.transfer(cash, card, tk("500"), "2026-09-06")
        f.expense(cash, tk("999"), "2026-10-01") // another month

        val summary = Analytics(f.data).periodSummary("2026-09-01", "2026-09-30", Conversion.only("BDT"))
        assertEquals(tk("50000"), summary.income)
        assertEquals(tk("5000"), summary.expenses)
        assertEquals(tk("2000"), summary.directExpenses)
        assertEquals(tk("3000"), summary.transferExpenses)
        assertEquals(tk("500"), summary.transfers)
        assertEquals(1, summary.transferCount)
        assertEquals(tk("45000"), summary.netSavings)
        assertEquals(90.0, summary.savingsRate)

        val scopes = Analytics(f.data).scopeTotals("2026-09-01", "2026-09-30", Conversion.only("BDT")).associate { it.scope to it.total }
        assertEquals(mapOf(ExpenseScope.PERSONAL to tk("4200"), ExpenseScope.FAMILY to tk("800")), scopes)

        val months = Analytics(f.data).monthlySeries("2026-08", "2026-10", Conversion.only("BDT"))
        assertEquals(listOf("2026-08", "2026-09", "2026-10"), months.map { it.month })
        assertEquals(listOf(0L, tk("5000"), tk("999")), months.map { it.expenses })

        val days = Analytics(f.data).dailySpending("2026-09-02", "2026-09-04", Conversion.only("BDT"))
        assertEquals(listOf("2026-09-02" to 0L, "2026-09-03" to tk("1200"), "2026-09-04" to tk("800")), days)
    }

    @Test
    fun otherCurrenciesCountAtYourRateOrTheLatestConversion() {
        val f = Fixture()
        val bank = f.account("Bank", tk("100000"))
        val usd = f.account("Payoneer", tk("100"), currency = "USD")
        val eur = f.account("Wise", tk("50"), currency = "EUR")
        f.transfer(usd, bank, tk("10"), "2026-08-01", toAmount = tk("1180"))
        f.transfer(usd, bank, tk("10"), "2026-09-01", toAmount = tk("1220"))
        f.expense(usd, tk("2.50"), "2026-09-10")
        f.expense(eur, tk("3"), "2026-09-10")

        val analytics = Analytics(f.data)
        val currencies = analytics.currencies("BDT")
        assertEquals(mapOf("BDT" to "1", "USD" to "122"), currencies.conversion.rates)
        assertEquals(listOf("EUR", "USD"), currencies.foreign.map { it.currency })
        assertEquals(ForeignCurrency.Source.CONVERSION, currencies.foreign.single { it.currency == "USD" }.source)
        // EUR has no rate: left out of totals.
        assertEquals(tk("305"), analytics.periodSummary("2026-09-01", "2026-09-30", currencies.conversion).expenses)
        assertEquals(listOf("USD" to tk("2.50")), analytics.periodSummary("2026-09-01", "2026-09-30", currencies.conversion).foreignExpenses)

        // Your own rate wins.
        f.data = f.data.copy(rates = listOf(Rate(Rate.idOf("BDT", "USD"), "BDT", "USD", "120"), Rate(Rate.idOf("BDT", "EUR"), "BDT", "EUR", "130.5")))
        val mine = Analytics(f.data).currencies("BDT")
        assertEquals(mapOf("BDT" to "1", "EUR" to "130.5", "USD" to "120"), mine.conversion.rates)
        assertEquals(tk("300") + tk("391.50"), Analytics(f.data).periodSummary("2026-09-01", "2026-09-30", mine.conversion).expenses)
    }

    @Test
    fun categoryTotalsAddUpToTheirTotal() {
        val f = Fixture()
        val cash = f.account("Cash", tk("10000"))
        val rent = f.category("Rent", CategoryKind.EXPENSE)
        f.expense(cash, tk("300"), "2026-09-03")
        f.add(Transaction("rent1", EntryType.EXPENSE, tk("700"), "2026-09-05", accountId = cash, categoryId = rent, scope = ExpenseScope.FAMILY, createdAt = 1))
        val totals = Analytics(f.data).categoryTotals("2026-09-01", "2026-09-30", Conversion.only("BDT"))
        assertEquals(listOf("Rent" to tk("700"), "Food" to tk("300")), totals.map { it.category.name to it.total })
        assertEquals(listOf(70.0, 30.0), totals.map { it.share })
        val family = Analytics(f.data).categoryTotals("2026-09-01", "2026-09-30", Conversion.only("BDT"), scope = ExpenseScope.FAMILY)
        assertEquals(listOf("Rent"), family.map { it.category.name })
    }
}
