package io.github.fr_ost.hisab.core

/** What a person enters for a recurring entry (amounts in paisa). */
data class RecurringInput(
    val type: EntryType,
    val amount: Long,
    val accountId: String,
    val toAccountId: String? = null,
    val toAmount: Long? = null,
    val categoryId: String? = null,
    val countAsExpense: Boolean = false,
    val scope: ExpenseScope? = null,
    val description: String = "",
    val notes: String? = null,
    val frequency: Frequency,
    val startDate: String,
    val endDate: String? = null,
    val isActive: Boolean = true,
)

/**
 * Recurring entries, with the website's rules (src/lib/server/services/recurring.ts):
 * occurrence k is always counted from the start date (Jan 31 → Feb 28 → Mar
 * 31), each occurrence is posted once — with the same id on every phone, so
 * two phones posting the same rent never make two — and a rule that can no
 * longer post validly (its account deactivated, its category archived)
 * pauses instead of writing bad data. Each returns the records to save.
 */
object Recurrings {
    /** Never post more than this many occurrences of one rule at a time. */
    private const val MAX_POSTS = 400

    fun occurrenceDate(startDate: String, frequency: Frequency, index: Int): String = when (frequency) {
        Frequency.WEEKLY -> Dates.addDays(startDate, 7L * index)
        Frequency.MONTHLY -> Dates.addMonths(startDate, index.toLong())
        Frequency.YEARLY -> Dates.addYears(startDate, index.toLong())
    }

    /** The first occurrence on or after `date` (and after `after`, if given). */
    fun firstIndexOnOrAfter(startDate: String, frequency: Frequency, date: String, after: String? = null): Int {
        var index = 0
        if (date > startDate) {
            val days = Dates.daysBetween(date, startDate)
            index = maxOf(0, (days / (when (frequency) { Frequency.WEEKLY -> 7; Frequency.MONTHLY -> 31; Frequency.YEARLY -> 366 })).toInt() - 1)
        }
        while (occurrenceDate(startDate, frequency, index) < date || (after != null && occurrenceDate(startDate, frequency, index) <= after)) index++
        return index
    }

    private fun schedule(rule: Recurring, index: Int): Recurring {
        val next = occurrenceDate(rule.startDate, rule.frequency, index)
        return rule.copy(occurrenceIndex = index, nextOccurrence = if (rule.endDate != null && next > rule.endDate) null else next)
    }

    /** The transaction a rule posts on a date, as an entry (checked like any other). */
    private fun entry(rule: Recurring, date: String) = EntryInput(
        type = rule.type,
        amount = rule.amount,
        date = date,
        accountId = rule.accountId,
        toAccountId = if (rule.type == EntryType.TRANSFER) rule.toAccountId else null,
        toAmount = if (rule.type == EntryType.TRANSFER) rule.toAmount else null,
        categoryId = if (rule.type == EntryType.TRANSFER && !rule.countAsExpense) null else rule.categoryId,
        scope = when {
            rule.type == EntryType.EXPENSE -> rule.scope ?: ExpenseScope.PERSONAL
            rule.type == EntryType.TRANSFER && rule.countAsExpense -> rule.scope
            else -> null
        },
        countAsExpense = rule.type == EntryType.TRANSFER && rule.countAsExpense,
        description = rule.description,
        notes = rule.notes,
    )

    private fun check(input: RecurringInput) {
        if (input.type == EntryType.ADJUSTMENT) throw EditError("Record a balance update instead.")
        val expenseLike = input.type == EntryType.EXPENSE || (input.type == EntryType.TRANSFER && input.countAsExpense)
        if (expenseLike && input.scope == null) throw EditError("Choose Personal or Family.", "scope")
        if (input.endDate != null && !Dates.isValid(input.endDate)) throw EditError("Choose a valid date.", "endDate")
        if (input.endDate != null && input.endDate < input.startDate) throw EditError("The end date must be after the start date.", "endDate")
    }

    private fun rule(input: RecurringInput, id: String, createdAt: Long) = Recurring(
        id = id,
        type = input.type,
        amount = input.amount,
        accountId = input.accountId,
        toAccountId = if (input.type == EntryType.TRANSFER) input.toAccountId else null,
        toAmount = if (input.type == EntryType.TRANSFER) input.toAmount else null,
        categoryId = if (input.type == EntryType.TRANSFER && !input.countAsExpense) null else input.categoryId,
        countAsExpense = input.type == EntryType.TRANSFER && input.countAsExpense,
        scope = if (input.type == EntryType.EXPENSE || (input.type == EntryType.TRANSFER && input.countAsExpense)) input.scope else null,
        description = input.description.trim(),
        notes = input.notes?.trim()?.ifEmpty { null },
        frequency = input.frequency,
        startDate = input.startDate,
        endDate = input.endDate,
        isActive = input.isActive,
        createdAt = createdAt,
    )

    /**
     * A new rule, checked like an entry on its start date. With `backfill`,
     * occurrences between a past start date and today are posted too.
     */
    fun create(data: LedgerData, input: RecurringInput, today: String, backfill: Boolean, id: String = Ids.new(), createdAt: Long = System.currentTimeMillis()): List<Synced> {
        check(input)
        val draft = rule(input, id, createdAt)
        Edits.resolve(data, entry(draft, input.startDate), Clock(today), "check", createdAt)
        val index = if (backfill) 0 else firstIndexOnOrAfter(input.startDate, input.frequency, today)
        return postDue(data, schedule(draft, index), today)
    }

    fun update(data: LedgerData, id: String, input: RecurringInput, today: String): List<Synced> {
        val live = data.live()
        val existing = live.recurring.firstOrNull { it.id == id } ?: throw EditError("That recurring entry no longer exists.")
        check(input)
        val draft = rule(input, id, existing.createdAt)
        // Its account and category may be ones only it still uses (inactive, archived): fine, as when editing an entry.
        val previous = Transaction(id, existing.type, existing.amount, existing.startDate, accountId = existing.accountId, toAccountId = existing.toAccountId, categoryId = existing.categoryId, createdAt = existing.createdAt)
        Edits.resolve(data, entry(draft, input.startDate), Clock(today), "check", existing.createdAt, previous)
        var index = existing.occurrenceIndex
        if (existing.frequency != input.frequency || existing.startDate != input.startDate) {
            // Continue after the last posted occurrence; never post the past again.
            val lastPosted = live.transactions.filter { it.recurringId == id }.mapNotNull { it.occurrenceDate }.maxOrNull()
            index = firstIndexOnOrAfter(input.startDate, input.frequency, today, lastPosted)
        }
        return postDue(data, schedule(draft, index), today)
    }

    /** Pause or resume. Resuming skips what was missed while paused. */
    fun setActive(data: LedgerData, id: String, active: Boolean, today: String): List<Synced> {
        val rule = data.live().recurring.firstOrNull { it.id == id } ?: throw EditError("That recurring entry no longer exists.")
        val index = if (active) maxOf(rule.occurrenceIndex, firstIndexOnOrAfter(rule.startDate, rule.frequency, today)) else rule.occurrenceIndex
        val changed = schedule(rule.copy(isActive = active), index)
        return if (active) postDue(data, changed, today) else listOf(changed)
    }

    fun skipNext(data: LedgerData, id: String): List<Synced> {
        val rule = data.live().recurring.firstOrNull { it.id == id } ?: throw EditError("That recurring entry no longer exists.")
        if (rule.nextOccurrence == null) return emptyList()
        return listOf(schedule(rule, rule.occurrenceIndex + 1))
    }

    /** Deleting a rule keeps the entries it already posted. */
    fun delete(data: LedgerData, id: String): List<Synced> {
        val live = data.live()
        val rule = live.recurring.firstOrNull { it.id == id } ?: return emptyList()
        return listOf(rule.copy(deleted = true)) + live.transactions.filter { it.recurringId == id }.map { it.copy(recurringId = null) }
    }

    /** The id an occurrence gets: the same on every phone. */
    fun occurrenceId(ruleId: String, date: String) = Ids.stable("recurring", ruleId, date)

    /** Post every due occurrence of one rule (the rule, changed, comes first in the result). */
    fun postDue(data: LedgerData, rule: Recurring, today: String, now: Long = System.currentTimeMillis()): List<Synced> {
        val next = rule.nextOccurrence
        if (!rule.isActive || next == null || next > today) return listOf(rule)
        val posted = mutableListOf<Synced>()
        var working = data.withRecords(listOf(rule))
        var index = rule.occurrenceIndex
        var pause = false
        while (posted.size < MAX_POSTS) {
            val date = occurrenceDate(rule.startDate, rule.frequency, index)
            if (date > today || (rule.endDate != null && date > rule.endDate)) break
            val id = occurrenceId(rule.id, date)
            // Posted already — here, on another phone, or posted and then deleted.
            val known = working.transactions.any { it.id == id || (!it.deleted && it.recurringId == rule.id && it.occurrenceDate == date) }
            if (!known) {
                val transaction = try {
                    // Checked as a brand-new entry, at the end of its day.
                    Edits.resolve(working, entry(rule, date), Clock(today), id, now).copy(recurringId = rule.id, occurrenceDate = date)
                } catch (_: EditError) {
                    pause = true
                    null
                }
                if (transaction == null) break
                posted += transaction
                working = working.withRecords(listOf(transaction))
            }
            index++
        }
        val updated = schedule(rule, index).let { if (pause) it.copy(isActive = false) else it }
        return listOf(updated) + posted
    }

    /** Everything that has come due, for every active rule. */
    fun postAllDue(data: LedgerData, today: String, now: Long = System.currentTimeMillis()): List<Synced> {
        var working = data
        val changed = mutableListOf<Synced>()
        for (rule in data.live().recurring.filter { it.isActive && it.nextOccurrence != null && it.nextOccurrence <= today }) {
            val records = postDue(working, rule, today, now)
            if (records.size == 1 && records[0] == rule) continue
            changed += records
            working = working.withRecords(records)
        }
        return changed
    }

    /** Occurrences of active rules in the next `days` days. */
    fun upcoming(data: LedgerData, today: String, days: Int = 30): List<Pair<Recurring, String>> {
        val until = Dates.addDays(today, days.toLong())
        val items = mutableListOf<Pair<Recurring, String>>()
        for (rule in data.live().recurring) {
            val next = rule.nextOccurrence ?: continue
            if (!rule.isActive) continue
            var index = firstIndexOnOrAfter(rule.startDate, rule.frequency, next)
            for (n in 0 until 60) {
                val date = occurrenceDate(rule.startDate, rule.frequency, index)
                if (date > until || (rule.endDate != null && date > rule.endDate)) break
                if (date > today) items += rule to date
                index++
            }
        }
        return items.sortedBy { it.second }
    }
}
