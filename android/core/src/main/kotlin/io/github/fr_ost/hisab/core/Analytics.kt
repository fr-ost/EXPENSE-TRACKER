package io.github.fr_ost.hisab.core

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * How amounts become the main currency: `rates` holds main-currency units for
 * one unit of each currency that can be counted (the main currency itself as
 * "1"). Amounts in a currency without a rate are left out of totals.
 */
data class Conversion(val base: String, val rates: Map<String, String>) {
    /** `minor` in the main currency, or null when its currency has no rate. Each amount is rounded on its own. */
    fun convert(minor: Long, currency: String): Long? {
        if (currency == base) return minor
        val rate = rates[currency] ?: return null
        return Money.convert(minor, rate)
    }

    companion object {
        /** Just one currency, unconverted. */
        fun only(currency: String) = Conversion(currency, mapOf(currency to "1"))
    }
}

/** Another currency your accounts hold, and how it converts. */
data class ForeignCurrency(
    val currency: String,
    val rate: String?,
    val source: Source?,
    val manualRate: String?,
    val lastConversion: Pair<String, String>?, // (rate, date)
) {
    enum class Source { MANUAL, CONVERSION }
}

data class Currencies(val conversion: Conversion, val foreign: List<ForeignCurrency>)

/** Income and spending, the way the website counts them (src/lib/server/services/analytics.ts). */
class Analytics(data: LedgerData) {
    private val live = data.live()
    private val accounts = live.accounts.associateBy { it.id }
    private val categories = live.categories.associateBy { it.id }

    /** Expenses, plus transfers counted as spending — in the source account's currency. */
    private val expenseEntries = live.transactions.mapNotNull { t ->
        val account = accounts[t.accountId] ?: return@mapNotNull null
        if (t.type == EntryType.EXPENSE || (t.type == EntryType.TRANSFER && t.countAsExpense)) Entry(t, account.currency) else null
    }
    private val incomeEntries = live.transactions.mapNotNull { t ->
        val account = accounts[t.accountId] ?: return@mapNotNull null
        if (t.type == EntryType.INCOME) Entry(t, account.currency) else null
    }

    /**
     * The rate for each other currency: your own, else the latest transfer
     * between an account in it and one in the main currency (what you actually
     * got when you converted).
     */
    fun currencies(base: String = live.settings.baseCurrency): Currencies {
        val manual = live.rates.filter { it.base == base }.associate { it.currency to Money.normalizeRate(it.rate) }
        val conversions = mutableMapOf<String, Triple<String, String, Long>>() // currency → (rate, date, createdAt)
        for (t in live.transactions) {
            if (t.type != EntryType.TRANSFER || t.toAmount == null) continue
            val from = accounts[t.accountId] ?: continue
            val to = t.toAccountId?.let { accounts[it] } ?: continue
            val (currency, rate) = when {
                to.currency == base && from.currency != base -> from.currency to ratio(t.toAmount, t.amount)
                from.currency == base && to.currency != base -> to.currency to ratio(t.amount, t.toAmount)
                else -> continue
            }
            if (!Money.isRate(rate)) continue
            val earlier = conversions[currency]
            if (earlier == null || t.date > earlier.second || (t.date == earlier.second && t.createdAt > earlier.third)) {
                conversions[currency] = Triple(Money.normalizeRate(rate), t.date, t.createdAt)
            }
        }
        val foreign = live.accounts.map { it.currency }.distinct().filter { it != base }.sorted().map { currency ->
            val manualRate = manual[currency]
            val last = conversions[currency]
            ForeignCurrency(
                currency = currency,
                rate = manualRate ?: last?.first,
                source = if (manualRate != null) ForeignCurrency.Source.MANUAL else if (last != null) ForeignCurrency.Source.CONVERSION else null,
                manualRate = manualRate,
                lastConversion = last?.let { it.first to it.second },
            )
        }
        val rates = buildMap {
            put(base, "1")
            foreign.forEach { f -> f.rate?.let { put(f.currency, it) } }
        }
        return Currencies(Conversion(base, rates), foreign)
    }

    private fun ratio(numerator: Long, denominator: Long): String =
        BigDecimal.valueOf(numerator).divide(BigDecimal.valueOf(denominator), 6, RoundingMode.HALF_UP).toPlainString()

    fun periodSummary(from: String, to: String, fx: Conversion): PeriodSummary {
        fun within(date: String) = date >= from && date <= to
        val income = incomeEntries.filter { within(it.t.date) }
        val expenses = expenseEntries.filter { within(it.t.date) }
        val incomeTotal = income.sumOf { fx.convert(it.t.amount, it.currency) ?: 0L }
        val expenseTotal = expenses.sumOf { fx.convert(it.t.amount, it.currency) ?: 0L }
        val transferExpenses = expenses.filter { it.t.type == EntryType.TRANSFER }.sumOf { fx.convert(it.t.amount, it.currency) ?: 0L }
        val transfers = live.transactions.filter { it.type == EntryType.TRANSFER && !it.countAsExpense && within(it.date) }
            .mapNotNull { t -> accounts[t.accountId]?.let { fx.convert(t.amount, it.currency) } }
        val adjustments = Ledger(live).allEntries().filter { it.type == EntryType.ADJUSTMENT && within(it.date) }
            .sumOf { fx.convert(it.amount, it.currency) ?: 0L }
        val net = incomeTotal - expenseTotal
        fun foreign(entries: List<Entry>) = entries.filter { it.currency != fx.base && it.currency in fx.rates }
            .groupBy { it.currency }.map { (currency, list) -> currency to list.sumOf { it.t.amount } }.sortedBy { it.first }
        return PeriodSummary(
            from = from,
            to = to,
            currency = fx.base,
            income = incomeTotal,
            expenses = expenseTotal,
            directExpenses = expenseTotal - transferExpenses,
            transferExpenses = transferExpenses,
            transfers = transfers.sum(),
            transferCount = transfers.size,
            adjustments = adjustments,
            netSavings = net,
            savingsRate = if (incomeTotal > 0) Money.percentOf(net, incomeTotal) else null,
            foreignIncome = foreign(income),
            foreignExpenses = foreign(expenses),
        )
    }

    /** Income, spending and savings for each month from `first` to `last` ("YYYY-MM"), empty months included. */
    fun monthlySeries(first: String, last: String, fx: Conversion): List<MonthPoint> {
        val months = generateSequence(first) { Dates.shiftMonth(it, 1) }.takeWhile { it <= last }.toList()
        val income = incomeEntries.groupBy { Dates.monthOf(it.t.date) }
        val expenses = expenseEntries.groupBy { Dates.monthOf(it.t.date) }
        return months.map { month ->
            val inc = income[month].orEmpty().sumOf { fx.convert(it.t.amount, it.currency) ?: 0L }
            val exp = expenses[month].orEmpty().sumOf { fx.convert(it.t.amount, it.currency) ?: 0L }
            MonthPoint(month, inc, exp, inc - exp, if (inc > 0) Money.percentOf(inc - exp, inc) else null)
        }
    }

    /** Totals per category, largest first. */
    fun categoryTotals(from: String, to: String, fx: Conversion, kind: CategoryKind = CategoryKind.EXPENSE, scope: ExpenseScope? = null): List<CategoryTotal> {
        val source = if (kind == CategoryKind.EXPENSE) expenseEntries else incomeEntries
        val rows = source.filter { it.t.date in from..to && (scope == null || kind != CategoryKind.EXPENSE || it.t.scope == scope) }
            .mapNotNull { e -> fx.convert(e.t.amount, e.currency)?.let { e.t.categoryId to it } }
            .filter { it.first != null && it.first in categories }
            .groupBy({ it.first!! }, { it.second })
        val grand = rows.values.sumOf { it.sum() }
        return rows.map { (id, amounts) ->
            val total = amounts.sum()
            CategoryTotal(categories.getValue(id), total, amounts.size, Money.percentOf(total, grand) ?: 0.0)
        }.sortedWith(compareByDescending<CategoryTotal> { it.total }.thenBy { it.category.name })
    }

    /** Spending for Personal and for Family. */
    fun scopeTotals(from: String, to: String, fx: Conversion): List<ScopeTotal> {
        val rows = expenseEntries.filter { it.t.date in from..to }
            .mapNotNull { e -> fx.convert(e.t.amount, e.currency)?.let { (e.t.scope ?: ExpenseScope.PERSONAL) to it } }
            .groupBy({ it.first }, { it.second })
        val grand = rows.values.sumOf { it.sum() }
        return ExpenseScope.entries.map { scope ->
            val amounts = rows[scope].orEmpty()
            ScopeTotal(scope, amounts.sum(), amounts.size, Money.percentOf(amounts.sum(), grand) ?: 0.0)
        }
    }

    /** Spending on each day from `from` to `to`, zero days included. */
    fun dailySpending(from: String, to: String, fx: Conversion): List<Pair<String, Long>> {
        val byDay = expenseEntries.filter { it.t.date in from..to }.groupBy { it.t.date }
        return generateSequence(from) { Dates.addDays(it, 1) }.takeWhile { it <= to }
            .map { day -> day to byDay[day].orEmpty().sumOf { fx.convert(it.t.amount, it.currency) ?: 0L } }
            .toList()
    }

    private data class Entry(val t: Transaction, val currency: String)
}

data class PeriodSummary(
    val from: String,
    val to: String,
    val currency: String,
    val income: Long,
    val expenses: Long,
    val directExpenses: Long,
    val transferExpenses: Long,
    val transfers: Long,
    val transferCount: Int,
    val adjustments: Long,
    val netSavings: Long,
    val savingsRate: Double?,
    /** Amounts in other currencies, in their own currency. */
    val foreignIncome: List<Pair<String, Long>>,
    val foreignExpenses: List<Pair<String, Long>>,
)

data class MonthPoint(val month: String, val income: Long, val expenses: Long, val savings: Long, val savingsRate: Double?)

data class CategoryTotal(val category: Category, val total: Long, val count: Int, val share: Double)

data class ScopeTotal(val scope: ExpenseScope, val total: Long, val count: Int, val share: Double)
