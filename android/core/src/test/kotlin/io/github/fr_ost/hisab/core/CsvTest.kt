package io.github.fr_ost.hisab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CsvTest {
    @Test
    fun writesTheWebsitesColumnsOldestFirstAndDefusesFormulas() {
        val f = Fixture()
        val cash = f.account("Cash", 100_000)
        val bank = f.account("Bank", 0, type = AccountType.BANK)
        f.expense(cash, 12_050, "2026-09-02", "09:30")
        f.add(Transaction("t-x", EntryType.EXPENSE, 500, "2026-09-01", accountId = cash, categoryId = f.food, scope = ExpenseScope.FAMILY,
            description = "=HYPERLINK(\"x\")", notes = "line one\nline, two", createdAt = 5))
        f.transfer(cash, bank, 20_000, "2026-09-03", affectsBalance = false)

        val lines = Csv.transactions(f.data).removePrefix("﻿").split("\r\n")
        assertEquals("Date,Time,Type,Counts as,Description,Category,Classification,Account,To account,Amount,Currency,Amount received,Received currency,Notes,Recurring,Counts in balance", lines[0])
        assertEquals("2026-09-01,,Expense,Spending,\"'=HYPERLINK(\"\"x\"\")\",Food,Family,Cash,,5.00,BDT,,,\"line one\nline, two\",No,Yes", lines[1])
        assertEquals("2026-09-02,09:30,Expense,Spending,,Food,Personal,Cash,,120.50,BDT,,,,No,Yes", lines[2])
        assertEquals("2026-09-03,,Transfer,Transfer,,,,Cash,Bank,200.00,BDT,200.00,BDT,,No,No", lines[3])
        assertEquals("", lines.last())
        assertTrue(Csv.transactions(f.data, from = "2026-09-02", to = "2026-09-02").contains("120.50"))
        assertEquals(3, Csv.transactions(f.data, from = "2026-09-02", to = "2026-09-02").removePrefix("﻿").split("\r\n").size)
    }
}
