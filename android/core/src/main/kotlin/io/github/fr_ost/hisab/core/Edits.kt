package io.github.fr_ost.hisab.core

/** Why an edit was refused, in words for the person; `field` says which field to point at. */
class EditError(message: String, val field: String? = null) : Exception(message)

/** What a person enters for a transaction (amounts in paisa). */
data class EntryInput(
    val type: EntryType,
    val amount: Long,
    val date: String,
    val time: String? = null,
    val accountId: String,
    val toAccountId: String? = null,
    val toAmount: Long? = null,
    val categoryId: String? = null,
    val scope: ExpenseScope? = null,
    val countAsExpense: Boolean = false,
    val description: String = "",
    val notes: String? = null,
    val affectsBalance: Boolean = true,
)

data class AccountInput(
    val name: String,
    val type: AccountType,
    val currency: String,
    val openingBalance: Long,
    val openingDate: String,
    val isActive: Boolean = true,
    val icon: String? = null,
    val color: String? = null,
)

/**
 * Every change a person can make, with the website's rules
 * (src/lib/server/services). Each returns the records to save — unstamped:
 * the store stamps them with its clock and device as it saves them.
 */
object Edits {
    private fun refuse(message: String, field: String? = null): Nothing = throw EditError(message, field)

    // ---- Transactions ------------------------------------------------------

    /**
     * Check an entry against the ledger and turn it into a transaction. An
     * inactive account or archived category is fine only when the entry
     * already used it (editing an old entry).
     */
    fun resolve(data: LedgerData, input: EntryInput, clock: Clock, id: String, createdAt: Long, existing: Transaction? = null): Transaction {
        val live = data.live()
        if (input.amount <= 0) refuse("Enter an amount greater than zero.", "amount")
        if (input.amount > Money.MAX_MINOR) refuse("That amount is too large.", "amount")
        if (!Dates.isValid(input.date)) refuse("Choose a valid date.", "date")
        if (input.date > Dates.addYears(clock.today, 1)) {
            refuse("Dates more than a year ahead aren't allowed. Use a recurring transaction for future payments.", "date")
        }
        if (input.time != null && !Dates.isTime(input.time)) refuse("Use a time like 14:30.", "time")
        if (input.description.length > 140) refuse("Keep the description under 140 characters.", "description")
        if ((input.notes?.length ?: 0) > 2000) refuse("Keep notes under 2000 characters.", "notes")
        if (input.type == EntryType.ADJUSTMENT) refuse("Record a balance update instead.")

        val account = usableAccount(live, input.accountId, "accountId", existing?.accountId)
        // An edit that leaves the date and time alone keeps the entry where it was.
        val unmoved = existing != null && existing.date == input.date && existing.time == input.time
        val base = Transaction(
            id = id,
            type = input.type,
            amount = input.amount,
            date = input.date,
            time = input.time,
            loggedTime = if (input.time != null) null else if (unmoved) existing?.loggedTime else Ledger.loggedTimeFor(input.date, null, clock),
            accountId = account.id,
            description = input.description.trim(),
            notes = input.notes?.trim()?.ifEmpty { null },
            affectsBalance = input.affectsBalance,
            recurringId = existing?.recurringId,
            occurrenceDate = existing?.occurrenceDate,
            smsKey = existing?.smsKey,
            createdAt = existing?.createdAt ?: createdAt,
        )
        return when (input.type) {
            EntryType.EXPENSE -> {
                val category = category(live, input.categoryId, CategoryKind.EXPENSE, existing?.categoryId)
                base.copy(categoryId = category.id, scope = input.scope ?: category.defaultScope ?: ExpenseScope.PERSONAL)
            }
            EntryType.INCOME -> base.copy(categoryId = category(live, input.categoryId, CategoryKind.INCOME, existing?.categoryId).id)
            EntryType.TRANSFER -> {
                val toId = input.toAccountId ?: refuse("Choose the account the money went to.", "toAccountId")
                if (toId == input.accountId) refuse("Choose a different destination account.", "toAccountId")
                val destination = usableAccount(live, toId, "toAccountId", existing?.toAccountId)
                val toAmount = if (destination.currency != account.currency) {
                    val received = input.toAmount ?: refuse("${destination.name} uses ${destination.currency}. Enter the amount it received.", "toAmount")
                    if (received <= 0) refuse("Enter the amount received.", "toAmount")
                    received
                } else {
                    null
                }
                if (input.countAsExpense) {
                    val category = category(live, input.categoryId, CategoryKind.EXPENSE, existing?.categoryId)
                    base.copy(toAccountId = destination.id, toAmount = toAmount, countAsExpense = true, categoryId = category.id,
                        scope = input.scope ?: category.defaultScope ?: ExpenseScope.PERSONAL)
                } else {
                    base.copy(toAccountId = destination.id, toAmount = toAmount)
                }
            }
            EntryType.ADJUSTMENT -> refuse("Record a balance update instead.")
        }
    }

    private fun usableAccount(live: LedgerData, id: String, field: String, previous: String?): Account {
        val account = live.accounts.firstOrNull { it.id == id } ?: refuse("Choose an account.", field)
        if (!account.isActive && account.id != previous) refuse("${account.name} is inactive. Reactivate it to record new transactions.", field)
        return account
    }

    private fun category(live: LedgerData, id: String?, kind: CategoryKind, previous: String?): Category {
        val category = live.categories.firstOrNull { it.id == id } ?: refuse("Choose a category.", "categoryId")
        if (category.kind != kind) refuse(if (kind == CategoryKind.EXPENSE) "Choose an expense category." else "Choose an income category.", "categoryId")
        if (category.isArchived && category.id != previous) refuse("${category.name} is archived. Restore it in Settings to use it.", "categoryId")
        return category
    }

    fun addTransaction(data: LedgerData, input: EntryInput, clock: Clock, id: String = Ids.new(), createdAt: Long = System.currentTimeMillis()): Transaction =
        resolve(data, input, clock, id, createdAt)

    fun updateTransaction(data: LedgerData, id: String, input: EntryInput, clock: Clock): Transaction {
        val existing = data.live().transactions.firstOrNull { it.id == id } ?: refuse("That transaction no longer exists.")
        return resolve(data, input, clock, id, existing.createdAt, existing)
    }

    /**
     * Delete a transaction. One made from an SMS takes the balance that
     * message reported with it (its fee stays: it is a transaction of its own).
     */
    fun deleteTransaction(data: LedgerData, id: String): List<Synced> {
        val live = data.live()
        val existing = live.transactions.firstOrNull { it.id == id } ?: return emptyList()
        val reported = existing.smsKey?.takeIf { it.endsWith(":0") }?.let { key ->
            val balanceKey = key.dropLast(1) + "b"
            live.checkpoints.filter { it.smsKey == balanceKey }
        }.orEmpty()
        return listOf(existing.copy(deleted = true)) + reported.map { it.copy(deleted = true) }
    }

    // ---- Accounts ----------------------------------------------------------

    fun saveAccount(data: LedgerData, input: AccountInput, id: String? = null, createdAt: Long = System.currentTimeMillis()): Account {
        val live = data.live()
        val name = input.name.trim().replace(Regex("\\s+"), " ")
        if (name.isEmpty()) refuse("Give the account a name.", "name")
        if (name.length > 60) refuse("Keep the name under 60 characters.", "name")
        if (live.accounts.any { it.id != id && it.name.equals(name, ignoreCase = true) }) refuse("You already have an account called $name.", "name")
        if (!Regex("^[A-Z]{3}$").matches(input.currency)) refuse("Choose a currency.", "currency")
        if (!Dates.isValid(input.openingDate)) refuse("Choose a valid date.", "openingDate")
        if (kotlin.math.abs(input.openingBalance) > Money.MAX_MINOR) refuse("That amount is too large.", "openingBalance")
        val existing = id?.let { key -> live.accounts.firstOrNull { it.id == key } ?: refuse("That account no longer exists.") }
        if (existing != null && existing.currency != input.currency && live.transactions.any { it.accountId == id || it.toAccountId == id }) {
            refuse("This account has transactions in ${existing.currency}. Its currency can't change.", "currency")
        }
        return Account(
            id = id ?: Ids.new(),
            name = name,
            type = input.type,
            currency = input.currency,
            openingBalance = input.openingBalance,
            openingDate = input.openingDate,
            isActive = input.isActive,
            icon = input.icon,
            color = input.color,
            sortOrder = existing?.sortOrder ?: ((live.accounts.maxOfOrNull { it.sortOrder } ?: -1) + 1),
            createdAt = existing?.createdAt ?: createdAt,
        )
    }

    /** Delete an account that was never used; one with history is deactivated instead. */
    fun deleteAccount(data: LedgerData, id: String): List<Synced> {
        val live = data.live()
        val account = live.accounts.firstOrNull { it.id == id } ?: return emptyList()
        val used = live.transactions.count { it.accountId == id || it.toAccountId == id }
        if (used > 0) refuse("This account has $used transaction${if (used == 1) "" else "s"}. Deactivate it instead to hide it while keeping its history.")
        if (live.recurring.any { it.accountId == id || it.toAccountId == id }) {
            refuse("Recurring transactions use this account. Remove them first, or deactivate the account instead.")
        }
        return listOf(account.copy(deleted = true)) + live.checkpoints.filter { it.accountId == id }.map { it.copy(deleted = true) }
    }

    // ---- Balance updates -----------------------------------------------------

    /**
     * "This account holds X" at a moment: the ledger is corrected to agree.
     * Not for the future, nor for a time later today.
     */
    fun updateBalance(
        data: LedgerData,
        accountId: String,
        balance: Long,
        date: String,
        time: String?,
        clock: Clock,
        note: String? = null,
        id: String = Ids.new(),
        createdAt: Long = System.currentTimeMillis(),
    ): Checkpoint {
        val live = data.live()
        live.accounts.firstOrNull { it.id == accountId } ?: refuse("That account no longer exists.")
        if (!Dates.isValid(date)) refuse("Choose a valid date.", "date")
        if (date > clock.today) refuse("A balance can't be for the future.", "date")
        if (time != null && !Dates.isTime(time)) refuse("Use a time like 14:30.", "time")
        if (time != null && date == clock.today && clock.time != null && time > clock.time.take(5)) refuse("That time is later than now.", "time")
        if (kotlin.math.abs(balance) > Money.MAX_MINOR) refuse("That amount is too large.", "balance")
        return Checkpoint(
            id = id,
            accountId = accountId,
            date = date,
            time = time,
            loggedTime = if (time == null) Ledger.loggedTimeFor(date, null, clock) else null,
            balance = balance,
            source = CheckpointSource.MANUAL,
            note = note?.trim()?.ifEmpty { null }?.take(500),
            createdAt = createdAt,
        )
    }

    /** What the ledger says an account held at a moment (to compare a new balance update with). */
    fun recordedBalanceAt(data: LedgerData, accountId: String, date: String, time: String?, clock: Clock): Long =
        Ledger(data).balanceAt(accountId, date, time ?: Ledger.loggedTimeFor(date, null, clock) ?: Ledger.END_OF_DAY)

    fun deleteCheckpoint(data: LedgerData, id: String): List<Synced> =
        data.live().checkpoints.filter { it.id == id }.map { it.copy(deleted = true) }

    // ---- Categories ----------------------------------------------------------

    fun saveCategory(
        data: LedgerData,
        name: String,
        kind: CategoryKind,
        defaultScope: ExpenseScope?,
        icon: String,
        color: String,
        isArchived: Boolean = false,
        id: String? = null,
        createdAt: Long = System.currentTimeMillis(),
    ): Category {
        val live = data.live()
        val clean = name.trim().replace(Regex("\\s+"), " ")
        if (clean.isEmpty()) refuse("Give the category a name.", "name")
        if (clean.length > 40) refuse("Keep the name under 40 characters.", "name")
        val existing = id?.let { key -> live.categories.firstOrNull { it.id == key } ?: refuse("That category no longer exists.") }
        if (existing != null && existing.kind != kind) refuse("A category can't change between income and spending.")
        if (live.categories.any { it.id != id && it.kind == kind && it.name.equals(clean, ignoreCase = true) }) refuse("You already have a category called $clean.", "name")
        return Category(
            id = id ?: Ids.new(),
            name = clean,
            kind = kind,
            defaultScope = if (kind == CategoryKind.EXPENSE) defaultScope ?: ExpenseScope.PERSONAL else null,
            icon = icon,
            color = color,
            isArchived = isArchived,
            sortOrder = existing?.sortOrder ?: ((live.categories.filter { it.kind == kind }.maxOfOrNull { it.sortOrder } ?: 0) + 10),
            createdAt = existing?.createdAt ?: createdAt,
        )
    }

    /** Delete a category nothing uses; a used one is archived instead. */
    fun deleteCategory(data: LedgerData, id: String): List<Synced> {
        val live = data.live()
        val category = live.categories.firstOrNull { it.id == id } ?: return emptyList()
        val used = live.transactions.count { it.categoryId == id } + live.recurring.count { it.categoryId == id }
        if (used > 0) refuse("${category.name} is used by $used entr${if (used == 1) "y" else "ies"}. Archive it instead.")
        return listOf(category.copy(deleted = true))
    }

    /** The categories a new ledger starts with (all editable). The same as the website's. */
    fun starterCategories(createdAt: Long): List<Category> {
        val expense = listOf(
            Triple("Family", ExpenseScope.FAMILY, "users" to "terracotta"),
            Triple("Personal", ExpenseScope.PERSONAL, "user" to "violet"),
            Triple("Food", ExpenseScope.PERSONAL, "utensils" to "orange"),
            Triple("Transport", ExpenseScope.PERSONAL, "bus" to "blue"),
            Triple("Housing", ExpenseScope.PERSONAL, "house" to "brown"),
            Triple("Bills", ExpenseScope.PERSONAL, "receipt" to "slate"),
            Triple("Education", ExpenseScope.PERSONAL, "graduation-cap" to "teal"),
            Triple("Medical", ExpenseScope.PERSONAL, "heart-pulse" to "rose"),
            Triple("Shopping", ExpenseScope.PERSONAL, "shopping-bag" to "plum"),
            Triple("Subscriptions", ExpenseScope.PERSONAL, "repeat" to "indigo"),
            Triple("Technology", ExpenseScope.PERSONAL, "laptop" to "cyan"),
            Triple("Entertainment", ExpenseScope.PERSONAL, "clapperboard" to "amber"),
            Triple("Gifts", ExpenseScope.PERSONAL, "gift" to "lime"),
            Triple("Other", ExpenseScope.PERSONAL, "circle-dashed" to "gray"),
        ).mapIndexed { index, (name, scope, look) ->
            // The same id on every phone, so two phones starting fresh don't double the list.
            Category(Ids.stable("category", "EXPENSE", name), name, CategoryKind.EXPENSE, scope, look.first, look.second, sortOrder = (index + 1) * 10, createdAt = createdAt)
        }
        val income = listOf(
            "Salary" to ("briefcase" to "green"),
            "Business" to ("store" to "teal"),
            "Freelance" to ("pen-tool" to "blue"),
            "Investment" to ("trending-up" to "indigo"),
            "Gifts" to ("gift" to "amber"),
            "Other" to ("circle-dashed" to "gray"),
        ).mapIndexed { index, (name, look) ->
            Category(Ids.stable("category", "INCOME", name), name, CategoryKind.INCOME, null, look.first, look.second, sortOrder = (index + 1) * 10, createdAt = createdAt)
        }
        return expense + income
    }

    // ---- Budgets, rates, settings ---------------------------------------------

    /** The monthly budget for a scope from `month` ("YYYY-MM") on; null removes the one starting that month. */
    fun setBudget(data: LedgerData, scope: ExpenseScope, month: String, amount: Long?): Budget {
        val from = Dates.monthStart(month)
        if (!Dates.isValid(from)) refuse("Choose a month.")
        if (amount != null && amount < 0) refuse("A budget can't be negative.", "amount")
        val id = Budget.idOf(scope, from)
        val existing = data.budgets.firstOrNull { it.id == id }
        return Budget(id, scope, from, amount ?: existing?.amount ?: 0, deleted = amount == null)
    }

    /** The budget in force for a scope in `month`, if any. */
    fun budgetFor(data: LedgerData, scope: ExpenseScope, month: String): Budget? =
        data.live().budgets.filter { it.scope == scope && it.effectiveFrom <= Dates.monthStart(month) }.maxByOrNull { it.effectiveFrom }

    /** Your own rate for a currency (null: use the latest conversion again). */
    fun setRate(data: LedgerData, currency: String, rate: String?): Rate {
        val base = data.settings.baseCurrency
        if (currency == base) refuse("The main currency doesn't need a rate.", "currency")
        if (rate != null && !Money.isRate(rate)) refuse("Enter a rate above 0, like 122.45.", "rate")
        val id = Rate.idOf(base, currency)
        return Rate(id, base, currency, rate?.let(Money::normalizeRate) ?: data.rates.firstOrNull { it.id == id }?.rate ?: "1", deleted = rate == null)
    }

    fun updateSettings(data: LedgerData, change: (Settings) -> Settings): Settings {
        val next = change(data.settings)
        if (!Regex("^[A-Z]{3}$").matches(next.baseCurrency)) refuse("Choose a currency.", "baseCurrency")
        if (next.displayName.length > 60) refuse("Keep your name under 60 characters.", "displayName")
        return next
    }
}
