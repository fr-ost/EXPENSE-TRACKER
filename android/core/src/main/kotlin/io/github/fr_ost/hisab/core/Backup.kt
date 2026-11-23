package io.github.fr_ost.hisab.core

import java.time.Instant
import java.time.format.DateTimeParseException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/**
 * The backup file: everything one person has recorded, as JSON — the same
 * format as the website's (src/lib/backup.ts, "hisab-backup" version 1), so a
 * file moves between the website and the app in either direction.
 *
 * A file is read as untrusted input: every row is checked, every reference
 * must point inside the file, and nothing in it can refer to anything else.
 * Rows get ids that are the same on every phone for the same file, so two
 * phones restoring one file end up with the same records.
 */
object Backup {
    const val FORMAT = "hisab-backup"
    const val VERSION = 1

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = false
    }

    sealed interface Read {
        data class Ok(val data: LedgerData, val summary: Summary, val exportedAt: String) : Read
        data class Bad(val message: String) : Read
    }

    data class Summary(
        val accounts: Int,
        val categories: Int,
        val transactions: Int,
        val balanceUpdates: Int,
        val budgets: Int,
        val exchangeRates: Int,
        val recurring: Int,
    )

    /** Read a backup file. The records it gives are unstamped: the caller stamps them as it saves them. */
    fun read(text: String): Read {
        val file = try {
            json.decodeFromString(File.serializer(), text)
        } catch (e: SerializationException) {
            return Read.Bad("This isn't a Hisab backup file, or it is damaged.")
        } catch (e: IllegalArgumentException) {
            return Read.Bad("This isn't a Hisab backup file, or it is damaged.")
        }
        if (file.format != FORMAT) return Read.Bad("This isn't a Hisab backup file.")
        if (file.version > VERSION) return Read.Bad("This backup is from a newer version of Hisab. Update the app first.")
        return try {
            Read.Ok(convert(file), summarize(file), file.exportedAt)
        } catch (e: Invalid) {
            Read.Bad("The backup can't be used: ${e.message}. Nothing was changed.")
        }
    }

    private class Invalid(message: String) : Exception(message)

    private fun fail(message: String): Nothing = throw Invalid(message)

    private fun money(value: String, what: String): Long = Money.parse(value) ?: fail("$what \"$value\" is not an amount")

    private fun positive(value: String, what: String): Long = money(value, what).also { if (it <= 0) fail("$what must be greater than zero") }

    private fun date(value: String, what: String): String = value.also { if (!Dates.isValid(it)) fail("$what \"$it\" is not a date") }

    private fun time(value: String?, what: String): String? = value?.also { if (!Dates.isTime(it)) fail("$what \"$it\" is not a time") }

    private fun loggedTime(value: String?): String? = value?.takeIf { Dates.isTimeWithSeconds(it) }

    private fun instant(value: String, what: String): Long = try {
        Instant.parse(value).toEpochMilli()
    } catch (_: DateTimeParseException) {
        fail("$what \"$value\" is not a moment")
    }

    private inline fun <reified T : Enum<T>> enumOf(value: String, what: String): T =
        enumValues<T>().firstOrNull { it.name == value } ?: fail("$what \"$value\" is not known")

    private fun currency(value: String): String = value.also { if (!Regex("^[A-Z]{3}$").matches(it)) fail("\"$it\" is not a currency code") }

    private fun convert(file: File): LedgerData {
        val s = file.settings
        val settings = Settings(
            displayName = s.displayName.take(60),
            baseCurrency = currency(s.baseCurrency),
            numberFormat = enumOf(s.numberFormat, "Number format"),
            incomeCurrency = s.incomeCurrency?.let(::currency),
            expenseCurrency = s.expenseCurrency?.let(::currency),
            autoLockMinutes = s.autoLockMinutes.coerceIn(0, 60),
            timezone = s.timezone.take(64),
        )

        val accounts = file.accounts.map { a ->
            if (a.name.isBlank()) fail("an account has no name")
            Account(
                id = a.id,
                name = a.name.take(60),
                type = enumOf(a.type, "Account type"),
                currency = currency(a.currency),
                openingBalance = money(a.openingBalance, "Opening balance"),
                openingDate = date(a.openingDate, "Opening date"),
                isActive = a.isActive,
                icon = a.icon,
                color = a.color,
                sortOrder = a.sortOrder,
                createdAt = instant(a.createdAt, "Created"),
            )
        }
        val accountIds = accounts.map { it.id }.toSet()
        if (accountIds.size != accounts.size) fail("two accounts have the same id")
        if (accounts.map { it.name.lowercase() }.toSet().size != accounts.size) fail("two accounts have the same name")

        val categories = file.categories.map { c ->
            if (c.name.isBlank()) fail("a category has no name")
            val kind = enumOf<CategoryKind>(c.kind, "Category kind")
            Category(
                id = c.id,
                name = c.name.take(40),
                kind = kind,
                defaultScope = if (kind == CategoryKind.EXPENSE) c.defaultScope?.let { enumOf<ExpenseScope>(it, "Scope") } ?: ExpenseScope.PERSONAL else null,
                icon = c.icon,
                color = c.color,
                isArchived = c.isArchived,
                sortOrder = c.sortOrder,
                createdAt = instant(c.createdAt, "Created"),
            )
        }
        val categoryKinds = categories.associate { it.id to it.kind }
        if (categoryKinds.size != categories.size) fail("two categories have the same id")

        fun account(id: String?, what: String): String? {
            if (id == null) return null
            if (id !in accountIds) fail("$what refers to an account that isn't in the file")
            return id
        }

        fun checkEntry(type: EntryType, accountId: String, toAccountId: String?, countAsExpense: Boolean, categoryId: String?, scope: ExpenseScope?, what: String) {
            account(accountId, what)
            val transfer = type == EntryType.TRANSFER
            if (transfer) {
                if (toAccountId == null) fail("a transfer has no destination")
                account(toAccountId, what)
                if (toAccountId == accountId) fail("a transfer goes to the account it comes from")
            } else if (toAccountId != null || countAsExpense) {
                fail("only a transfer has a destination")
            }
            val spending = type == EntryType.EXPENSE || (transfer && countAsExpense)
            val needsCategory = type == EntryType.INCOME || spending
            if (needsCategory != (categoryId != null)) fail(if (needsCategory) "an entry has no category" else "an entry has a category it can't have")
            if (categoryId != null) {
                val kind = categoryKinds[categoryId] ?: fail("$what refers to a category that isn't in the file")
                if (kind != (if (type == EntryType.INCOME) CategoryKind.INCOME else CategoryKind.EXPENSE)) fail("an entry's category is of the other kind")
            }
            if (spending != (scope != null)) fail(if (spending) "spending has no scope" else "an entry has a scope it can't have")
        }

        val recurring = file.recurring.map { r ->
            val type = enumOf<EntryType>(r.type, "Type")
            if (type == EntryType.ADJUSTMENT) fail("a recurring transaction can't be an adjustment")
            val scope = r.scope?.let { enumOf<ExpenseScope>(it, "Scope") }
            checkEntry(type, r.accountId, r.toAccountId, r.countAsExpense, r.categoryId, scope, "A recurring transaction")
            Recurring(
                id = r.id,
                type = type,
                amount = positive(r.amount, "Amount"),
                accountId = r.accountId,
                toAccountId = r.toAccountId,
                toAmount = r.toAmount?.let { positive(it, "Amount received") },
                categoryId = r.categoryId,
                countAsExpense = r.countAsExpense,
                scope = scope,
                description = r.description.take(140),
                notes = r.notes?.take(2000),
                frequency = enumOf(r.frequency, "Frequency"),
                startDate = date(r.startDate, "Start date"),
                endDate = r.endDate?.let { date(it, "End date") },
                occurrenceIndex = r.occurrenceIndex.coerceAtLeast(0),
                nextOccurrence = r.nextOccurrence?.let { date(it, "Next date") },
                isActive = r.isActive,
                createdAt = instant(r.createdAt, "Created"),
            )
        }
        val recurringIds = recurring.map { it.id }.toSet()

        val seen = HashMap<String, Int>()
        val smsKeys = HashSet<String>()
        val transactions = file.transactions.map { t ->
            val type = enumOf<EntryType>(t.type, "Type")
            val scope = t.scope?.let { enumOf<ExpenseScope>(it, "Scope") }
            val amount = money(t.amount, "Amount")
            if (type == EntryType.ADJUSTMENT) {
                if (amount == 0L) fail("an adjustment is zero")
                account(t.accountId, "A transaction")
            } else {
                if (amount <= 0) fail("an amount must be greater than zero")
                checkEntry(type, t.accountId, t.toAccountId, t.countAsExpense, t.categoryId, scope, "A transaction")
            }
            val recurringId = t.recurringId?.also { if (it !in recurringIds) fail("a transaction refers to a recurring transaction that isn't in the file") }
            val key = t.idempotencyKey?.takeIf { it.startsWith("sms:") }
            if (key != null && !smsKeys.add(key)) fail("two transactions come from the same SMS")
            val base = listOf("tx", t.createdAt, t.accountId, t.type, t.amount, t.date, t.idempotencyKey.orEmpty())
            val n = seen.merge(base.joinToString("|"), 1, Int::plus)!!
            Transaction(
                id = Ids.stable(*(base + n.toString()).toTypedArray()),
                type = type,
                amount = amount,
                date = date(t.date, "Date"),
                time = time(t.time, "Time"),
                loggedTime = if (t.time == null) loggedTime(t.loggedTime) else null,
                accountId = t.accountId,
                toAccountId = t.toAccountId,
                toAmount = t.toAmount?.let { positive(it, "Amount received") },
                categoryId = t.categoryId,
                countAsExpense = t.countAsExpense,
                scope = scope,
                description = t.description.take(140),
                notes = t.notes?.take(2000),
                recurringId = recurringId,
                occurrenceDate = t.occurrenceDate?.let { date(it, "Occurrence") },
                affectsBalance = type == EntryType.ADJUSTMENT || t.affectsBalance,
                smsKey = key,
                createdAt = instant(t.createdAt, "Created"),
            )
        }

        val checkpointKeys = HashSet<String>()
        val checkpoints = file.balanceUpdates.map { c ->
            account(c.accountId, "A balance update")
            val source = enumOf<CheckpointSource>(c.source, "Source")
            if ((source == CheckpointSource.SMS) != (c.messageDate != null)) fail("a balance update from an SMS has no message date")
            if (c.smsKey != null && !checkpointKeys.add(c.smsKey)) fail("two balance updates come from the same SMS")
            val base = listOf("cp", c.createdAt, c.accountId, c.date, c.balance, c.smsKey.orEmpty())
            val n = seen.merge(base.joinToString("|"), 1, Int::plus)!!
            Checkpoint(
                id = Ids.stable(*(base + n.toString()).toTypedArray()),
                accountId = c.accountId,
                date = date(c.date, "Date"),
                time = time(c.time, "Time"),
                loggedTime = if (c.time == null) loggedTime(c.loggedTime) else null,
                balance = money(c.balance, "Balance"),
                source = source,
                note = c.note?.take(500),
                smsKey = c.smsKey,
                messageDate = c.messageDate?.let { date(it, "Message date") },
                messageTime = time(c.messageTime, "Message time"),
                createdAt = instant(c.createdAt, "Created"),
            )
        }

        val budgets = file.budgets.map { b ->
            val scope = enumOf<ExpenseScope>(b.scope, "Scope")
            val from = date(b.effectiveFrom, "Budget month")
            if (!from.endsWith("-01")) fail("a budget doesn't start on the first of a month")
            val amount = money(b.amount, "Budget")
            if (amount < 0) fail("a budget is negative")
            Budget(Budget.idOf(scope, from), scope, from, amount)
        }.distinctBy { it.id }

        val rates = file.exchangeRates.map { r ->
            if (!Money.isRate(r.rate)) fail("\"${r.rate}\" is not a rate")
            if (r.base == r.currency) fail("a rate is for the main currency")
            Rate(Rate.idOf(currency(r.base), currency(r.currency)), r.base, r.currency, Money.normalizeRate(r.rate))
        }.distinctBy { it.id }

        return LedgerData(settings, accounts, categories, transactions, checkpoints, budgets, rates, recurring)
    }

    private fun summarize(file: File) = Summary(
        accounts = file.accounts.size,
        categories = file.categories.size,
        transactions = file.transactions.size,
        balanceUpdates = file.balanceUpdates.size,
        budgets = file.budgets.size,
        exchangeRates = file.exchangeRates.size,
        recurring = file.recurring.size,
    )

    fun summarize(data: LedgerData): Summary {
        val live = data.live()
        return Summary(live.accounts.size, live.categories.size, live.transactions.size, live.checkpoints.size, live.budgets.size, live.rates.size, live.recurring.size)
    }

    /** Everything recorded, as a backup file (balances as of the end of `asOf`). */
    fun write(data: LedgerData, asOf: String, exportedAt: Long, appVersion: String): String {
        val live = data.live()
        val ledger = Ledger(live)
        val s = live.settings
        val file = File(
            format = FORMAT,
            version = VERSION,
            exportedAt = Instant.ofEpochMilli(exportedAt).toString(),
            asOf = asOf,
            app = FileApp("android $appVersion"),
            settings = FileSettings(s.displayName, s.baseCurrency, s.timezone, s.numberFormat.name, s.autoLockMinutes, s.incomeCurrency, s.expenseCurrency),
            accounts = live.accounts.map { a ->
                FileAccount(a.id, a.name, a.type.name, a.currency, Money.decimal(a.openingBalance), a.openingDate, a.isActive, a.icon, a.color, a.sortOrder,
                    Instant.ofEpochMilli(a.createdAt).toString(), Money.decimal(ledger.balance(a.id, asOf)))
            },
            categories = live.categories.map { c ->
                FileCategory(c.id, c.name, c.kind.name, c.defaultScope?.name, c.icon, c.color, c.isArchived, c.sortOrder, Instant.ofEpochMilli(c.createdAt).toString())
            },
            recurring = live.recurring.map { r ->
                FileRecurring(r.id, r.type.name, Money.decimal(r.amount), r.accountId, r.toAccountId, r.toAmount?.let(Money::decimal), r.categoryId, r.countAsExpense,
                    r.scope?.name, r.description, r.notes, r.frequency.name, r.startDate, r.endDate, r.occurrenceIndex, r.nextOccurrence, r.isActive,
                    Instant.ofEpochMilli(r.createdAt).toString())
            },
            transactions = live.transactions.sortedWith(compareBy({ it.date }, { it.createdAt })).map { t ->
                FileTransaction(t.type.name, Money.decimal(t.amount), t.date, t.time, t.loggedTime, t.accountId, t.toAccountId, t.toAmount?.let(Money::decimal),
                    t.categoryId, t.countAsExpense, t.scope?.name, t.description, t.notes, t.recurringId, t.occurrenceDate, t.affectsBalance, t.smsKey,
                    Instant.ofEpochMilli(t.createdAt).toString())
            },
            balanceUpdates = live.checkpoints.sortedWith(compareBy({ it.date }, { it.createdAt })).map { c ->
                FileBalanceUpdate(c.accountId, c.date, c.time, c.loggedTime, Money.decimal(c.balance), c.source.name, c.note, c.smsKey, c.messageDate, c.messageTime,
                    Instant.ofEpochMilli(c.createdAt).toString())
            },
            budgets = live.budgets.sortedWith(compareBy({ it.scope }, { it.effectiveFrom })).map { FileBudget(it.scope.name, it.effectiveFrom, Money.decimal(it.amount)) },
            exchangeRates = live.rates.map { FileRate(it.base, it.currency, it.rate) },
        )
        return json.encodeToString(File.serializer(), file)
    }

    @Serializable
    private data class File(
        val format: String,
        val version: Int,
        val exportedAt: String,
        val asOf: String,
        val app: FileApp? = null,
        val settings: FileSettings,
        val accounts: List<FileAccount>,
        val categories: List<FileCategory>,
        val recurring: List<FileRecurring>,
        val transactions: List<FileTransaction>,
        val balanceUpdates: List<FileBalanceUpdate>,
        val budgets: List<FileBudget>,
        val exchangeRates: List<FileRate>,
    )

    @Serializable
    private data class FileApp(val version: String)

    @Serializable
    private data class FileSettings(
        val displayName: String,
        val baseCurrency: String,
        val timezone: String,
        val numberFormat: String,
        val autoLockMinutes: Int,
        val incomeCurrency: String? = null,
        val expenseCurrency: String? = null,
    )

    @Serializable
    private data class FileAccount(
        val id: String,
        val name: String,
        val type: String,
        val currency: String,
        val openingBalance: String,
        val openingDate: String,
        val isActive: Boolean,
        val icon: String? = null,
        val color: String? = null,
        val sortOrder: Int,
        val createdAt: String,
        val balance: String? = null,
    )

    @Serializable
    private data class FileCategory(
        val id: String,
        val name: String,
        val kind: String,
        val defaultScope: String? = null,
        val icon: String,
        val color: String,
        val isArchived: Boolean,
        val sortOrder: Int,
        val createdAt: String,
    )

    @Serializable
    private data class FileRecurring(
        val id: String,
        val type: String,
        val amount: String,
        val accountId: String,
        val toAccountId: String? = null,
        val toAmount: String? = null,
        val categoryId: String? = null,
        val countAsExpense: Boolean,
        val scope: String? = null,
        val description: String,
        val notes: String? = null,
        val frequency: String,
        val startDate: String,
        val endDate: String? = null,
        val occurrenceIndex: Int,
        val nextOccurrence: String? = null,
        val isActive: Boolean,
        val createdAt: String,
    )

    @Serializable
    private data class FileTransaction(
        val type: String,
        val amount: String,
        val date: String,
        val time: String? = null,
        val loggedTime: String? = null,
        val accountId: String,
        val toAccountId: String? = null,
        val toAmount: String? = null,
        val categoryId: String? = null,
        val countAsExpense: Boolean,
        val scope: String? = null,
        val description: String,
        val notes: String? = null,
        val recurringId: String? = null,
        val occurrenceDate: String? = null,
        val affectsBalance: Boolean,
        @SerialName("idempotencyKey") val idempotencyKey: String? = null,
        val createdAt: String,
    )

    @Serializable
    private data class FileBalanceUpdate(
        val accountId: String,
        val date: String,
        val time: String? = null,
        val loggedTime: String? = null,
        val balance: String,
        val source: String,
        val note: String? = null,
        val smsKey: String? = null,
        val messageDate: String? = null,
        val messageTime: String? = null,
        val createdAt: String,
    )

    @Serializable
    private data class FileBudget(val scope: String, val effectiveFrom: String, val amount: String)

    @Serializable
    private data class FileRate(val base: String, val currency: String, val rate: String)
}
