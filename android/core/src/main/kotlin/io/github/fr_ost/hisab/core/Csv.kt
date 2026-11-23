package io.github.fr_ost.hisab.core

/**
 * Entries as a CSV file, with the website's columns and rules
 * (src/lib/server/export): oldest first, amounts as plain decimals, and text
 * that a spreadsheet would run as a formula (starting with = + - @) defused
 * with an apostrophe. Starts with a BOM so Excel reads Bengali text right.
 */
object Csv {
    private val HEADERS = listOf(
        "Date", "Time", "Type", "Counts as", "Description", "Category", "Classification", "Account", "To account",
        "Amount", "Currency", "Amount received", "Received currency", "Notes", "Recurring", "Counts in balance",
    )
    private val FORMULA = Regex("^[=+\\-@\\t\\r]")
    private val NEEDS_QUOTES = Regex("[\",\\r\\n]")

    fun safeText(value: String): String = if (FORMULA.containsMatchIn(value)) "'$value" else value

    private fun quote(value: String): String = if (NEEDS_QUOTES.containsMatchIn(value)) "\"" + value.replace("\"", "\"\"") + "\"" else value

    private fun text(value: String?): String = if (value.isNullOrEmpty()) "" else quote(safeText(value))

    private fun number(minor: Long?): String = minor?.let(Money::decimal).orEmpty()

    private fun typeLabel(type: EntryType) = when (type) {
        EntryType.INCOME -> "Income"
        EntryType.EXPENSE -> "Expense"
        EntryType.TRANSFER -> "Transfer"
        EntryType.ADJUSTMENT -> "Adjustment"
    }

    /** Entries dated `from`..`to` (either open), oldest first. */
    fun transactions(data: LedgerData, from: String? = null, to: String? = null): String {
        val live = data.live()
        val accounts = live.accounts.associateBy { it.id }
        val categories = live.categories.associateBy { it.id }
        val rows = live.transactions
            .filter { (from == null || it.date >= from) && (to == null || it.date <= to) && it.accountId in accounts }
            .sortedWith(compareBy<Transaction> { it.date }.thenBy { it.time ?: it.loggedTime ?: Ledger.END_OF_DAY }.thenBy { it.createdAt }.thenBy { it.id })
        val lines = mutableListOf(HEADERS.joinToString(","))
        for (t in rows) {
            val account = accounts.getValue(t.accountId)
            val toAccount = t.toAccountId?.let { accounts[it] }
            val countsAs = when {
                t.type == EntryType.INCOME -> "Income"
                t.type == EntryType.EXPENSE || (t.type == EntryType.TRANSFER && t.countAsExpense) -> "Spending"
                t.type == EntryType.TRANSFER -> "Transfer"
                else -> "Adjustment"
            }
            val scope = when (t.scope) {
                ExpenseScope.PERSONAL -> "Personal"
                ExpenseScope.FAMILY -> "Family"
                null -> ""
            }
            lines += listOf(
                t.date, t.time.orEmpty(), typeLabel(t.type), countsAs, text(t.description), text(categories[t.categoryId]?.name), scope,
                text(account.name), text(toAccount?.name),
                number(t.amount), account.currency,
                if (t.type == EntryType.TRANSFER) number(t.toAmount ?: t.amount) else "", toAccount?.currency.orEmpty(),
                text(t.notes), if (t.recurringId != null) "Yes" else "No", if (t.affectsBalance) "Yes" else "No",
            ).joinToString(",")
        }
        return "﻿" + lines.joinToString("\r\n") + "\r\n"
    }
}
