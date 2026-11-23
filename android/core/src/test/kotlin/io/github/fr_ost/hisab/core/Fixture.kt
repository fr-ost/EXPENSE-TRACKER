package io.github.fr_ost.hisab.core

/** A small ledger built up in a test, the way the website's tests use their services. */
class Fixture {
    var data = LedgerData()
    private var created = 1_000L
    private var next = 0

    private fun id(prefix: String) = "$prefix${++next}"
    private fun stamp() = created++

    val food = category("Food", CategoryKind.EXPENSE)
    val salary = category("Salary", CategoryKind.INCOME)

    fun category(name: String, kind: CategoryKind): String {
        val category = Category(id("cat"), name, kind, if (kind == CategoryKind.EXPENSE) ExpenseScope.PERSONAL else null, createdAt = stamp())
        data = data.copy(categories = data.categories + category)
        return category.id
    }

    fun account(name: String, opening: Long = 0, openingDate: String = "2026-01-01", currency: String = "BDT", type: AccountType = AccountType.CASH): String {
        val account = Account(id("acc"), name, type, currency, opening, openingDate, createdAt = stamp())
        data = data.copy(accounts = data.accounts + account)
        return account.id
    }

    fun expense(account: String, amount: Long, date: String, time: String? = null, loggedTime: String? = null, scope: ExpenseScope = ExpenseScope.PERSONAL, affectsBalance: Boolean = true): String =
        add(Transaction(id("t"), EntryType.EXPENSE, amount, date, time, loggedTime, account, categoryId = food, scope = scope, affectsBalance = affectsBalance, createdAt = stamp()))

    fun income(account: String, amount: Long, date: String, time: String? = null): String =
        add(Transaction(id("t"), EntryType.INCOME, amount, date, time, accountId = account, categoryId = salary, createdAt = stamp()))

    fun transfer(from: String, to: String, amount: Long, date: String, toAmount: Long? = null, countAsExpense: Boolean = false, affectsBalance: Boolean = true): String =
        add(
            Transaction(
                id("t"), EntryType.TRANSFER, amount, date, accountId = from, toAccountId = to, toAmount = toAmount, countAsExpense = countAsExpense,
                categoryId = if (countAsExpense) food else null, scope = if (countAsExpense) ExpenseScope.PERSONAL else null,
                affectsBalance = affectsBalance, createdAt = stamp(),
            ),
        )

    fun add(t: Transaction): String {
        data = data.copy(transactions = data.transactions + t)
        return t.id
    }

    fun update(account: String, balance: Long, date: String, time: String? = null, loggedTime: String? = null): String {
        val checkpoint = Checkpoint(id("cp"), account, date, time, loggedTime, balance, createdAt = stamp())
        data = data.copy(checkpoints = data.checkpoints + checkpoint)
        return checkpoint.id
    }

    fun deleteCheckpoint(id: String) {
        data = data.copy(checkpoints = data.checkpoints.map { if (it.id == id) it.copy(deleted = true) else it })
    }

    fun balance(account: String, date: String = TODAY) = Ledger(data).balance(account, date)

    companion object {
        const val TODAY = "2026-09-28"
    }
}

/** "1234.50" → 123450, for readable expectations. */
fun tk(value: String): Long = Money.parse(value)!!
