package io.github.fr_ost.hisab.core.sms

import io.github.fr_ost.hisab.core.Account
import io.github.fr_ost.hisab.core.AccountType
import io.github.fr_ost.hisab.core.Category
import io.github.fr_ost.hisab.core.CategoryKind
import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.EntryInput
import io.github.fr_ost.hisab.core.EntryType
import io.github.fr_ost.hisab.core.ExpenseScope

/** How the same description was recorded last time. */
data class LearnedEntry(
    val type: EntryType,
    val accountId: String,
    val toAccountId: String?,
    val categoryId: String?,
    val scope: ExpenseScope?,
    val countAsExpense: Boolean,
)

/** An entry built from a message, still editable. `amount` null: the message had none. */
data class SmsDraft(
    val type: EntryType,
    val amount: Long?,
    val accountId: String?,
    val toAccountId: String?,
    val toAmount: Long? = null,
    val categoryId: String?,
    val scope: ExpenseScope,
    val countAsExpense: Boolean,
    val date: String,
    val time: String?,
    val description: String,
    val notes: String,
    val affectsBalance: Boolean = true,
) {
    /** As the ledger's rules take it. */
    fun toInput(): EntryInput = EntryInput(
        type = type,
        amount = amount ?: 0,
        date = date,
        time = time,
        accountId = accountId.orEmpty(),
        toAccountId = if (type == EntryType.TRANSFER) toAccountId else null,
        toAmount = if (type == EntryType.TRANSFER) toAmount else null,
        categoryId = if (type != EntryType.TRANSFER || countAsExpense) categoryId else null,
        scope = if (type == EntryType.EXPENSE || (type == EntryType.TRANSFER && countAsExpense)) scope else null,
        countAsExpense = type == EntryType.TRANSFER && countAsExpense,
        description = description,
        notes = notes,
        affectsBalance = affectsBalance,
    )
}

data class SmsSuggestion(
    val draft: SmsDraft,
    val fee: SmsDraft?,
    /** Things to check before adding; empty when the suggestion is complete. */
    val issues: List<String>,
    /** Confident enough to add without review. */
    val ready: Boolean,
    /** How the message's own account was found: from what it says, or only by its kind. */
    val ownMatch: Match?,
) {
    enum class Match { MATCHED, GUESSED }
}

/**
 * Turns a read message into an entry for your accounts and categories
 * (the website's src/components/sms/sms-suggest.ts): which account it is
 * about, whether it is spending, income or a transfer (an ATM withdrawal moves
 * money to your Cash account, it isn't spending), the category, and any fee
 * as its own expense.
 */
object SmsSuggest {
    private val NOT_NAME_CHARS = Regex("[^a-z0-9ঀ-৿]+")

    private fun compact(value: String) = value.lowercase().replace(NOT_NAME_CHARS, "")

    fun nameMatches(account: Account, provider: Provider): Boolean {
        val name = compact(account.name)
        return provider.aliases.any { name.contains(compact(it)) }
    }

    private fun digitsMatch(account: Account, digits: String): Boolean =
        account.name.split(Regex("\\D+")).any { it.length >= digits.length && it.endsWith(digits) }

    /** Key for remembering which account a bank or wallet's messages belong to. */
    fun rememberKey(parsed: ParsedSms): String? {
        if (parsed.provider == null && parsed.accountDigits == null) return null
        return "${parsed.provider?.id ?: "?"}:${parsed.accountDigits ?: ""}"
    }

    private fun likelyKind(parsed: ParsedSms): AccountType? = when {
        parsed.provider != null -> parsed.provider.kind
        parsed.channel in setOf(Channel.CASH_OUT, Channel.CASH_IN, Channel.SEND_MONEY, Channel.RECHARGE, Channel.ADD_MONEY) -> AccountType.MOBILE_WALLET
        parsed.isCard -> AccountType.CARD
        parsed.accountDigits != null -> AccountType.BANK
        else -> null
    }

    private fun matchOwnAccount(parsed: ParsedSms, active: List<Account>, remembered: Map<String, String>): Pair<Account, SmsSuggestion.Match>? {
        val provider = parsed.provider
        val digits = parsed.accountDigits
        if (digits != null) {
            val byDigits = active.filter { digitsMatch(it, digits) }
            if (byDigits.size == 1) return byDigits[0] to SmsSuggestion.Match.MATCHED
            val both = if (provider != null) byDigits.filter { nameMatches(it, provider) } else emptyList()
            if (both.size == 1) return both[0] to SmsSuggestion.Match.MATCHED
        }
        val key = rememberKey(parsed)
        val rememberedId = key?.let { remembered[it] } ?: provider?.let { remembered["${it.id}:"] }
        active.firstOrNull { it.id == rememberedId }?.let { return it to SmsSuggestion.Match.MATCHED }

        if (provider != null) {
            val byName = active.filter { nameMatches(it, provider) }
            val sameKind = byName.filter { it.type == provider.kind || (parsed.isCard && it.type == AccountType.CARD) }
            if (byName.size == 1) return byName[0] to SmsSuggestion.Match.MATCHED
            if (sameKind.size == 1) return sameKind[0] to SmsSuggestion.Match.MATCHED
            // A bank or wallet you don't have an account for: don't guess another one.
            return null
        }
        val kind = likelyKind(parsed)
        val ofKind = if (kind != null) active.filter { it.type == kind } else emptyList()
        if (ofKind.size == 1) return ofKind[0] to SmsSuggestion.Match.GUESSED
        return null
    }

    private val CASH_NAME = Regex("(?i)cash|wallet|pocket|hand|নগদ টাকা")

    private fun cashAccount(active: List<Account>, excludeId: String?): Account? {
        val cash = active.filter { it.type == AccountType.CASH && it.id != excludeId }
        return cash.firstOrNull { CASH_NAME.containsMatchIn(it.name) } ?: cash.firstOrNull()
    }

    private fun matchOtherAccount(parsed: ParsedSms, active: List<Account>, ownId: String?): Account? {
        val others = active.filter { it.id != ownId }
        parsed.counterpartyDigits?.let { digits ->
            val byDigits = others.filter { digitsMatch(it, digits) }
            if (byDigits.size == 1) return byDigits[0]
        }
        parsed.otherProvider?.let { provider ->
            val byName = others.filter { nameMatches(it, provider) }
            if (byName.size == 1) return byName[0]
        }
        return null
    }

    fun pickCategory(hints: List<String>, kind: CategoryKind, categories: List<Category>): Category? {
        val usable = categories.filter { it.kind == kind && !it.isArchived && !it.deleted }.sortedBy { it.sortOrder }
        for (hint in hints) usable.firstOrNull { it.name.equals(hint, ignoreCase = true) }?.let { return it }
        return usable.firstOrNull { it.name.equals("other", ignoreCase = true) } ?: usable.firstOrNull()
    }

    private val FEE_LABELS = mapOf(
        Channel.CASH_OUT to "Cash out fee",
        Channel.SEND_MONEY to "Send money fee",
        Channel.ATM to "ATM fee",
        Channel.TRANSFER to "Transfer fee",
        Channel.BILL to "Bill payment fee",
        Channel.PAYMENT to "Payment fee",
    )

    fun suggest(
        parsed: ParsedSms,
        accounts: List<Account>,
        categories: List<Category>,
        today: String,
        remembered: Map<String, String>,
        learned: LearnedEntry? = null,
    ): SmsSuggestion {
        val active = accounts.filter { it.isActive && !it.deleted }
        fun isActive(id: String?) = id != null && active.any { it.id == id }
        val credit = parsed.direction == Direction.CREDIT

        val own = matchOwnAccount(parsed, active, remembered)
        val cash = cashAccount(active, own?.first?.id)
        val other = matchOtherAccount(parsed, active, own?.first?.id)

        // 1. The shape the message implies: spending or income, or a transfer
        //    between two of your own accounts (money you still have isn't spending).
        var type = if (credit) EntryType.INCOME else EntryType.EXPENSE
        var counterpart: Account? = null
        var counterpartHint = ""
        when (parsed.channel) {
            Channel.ATM, Channel.CASH_OUT -> if (!credit) {
                type = EntryType.TRANSFER
                counterpart = cash
                counterpartHint = "Add a Cash account (or pick one) to record this withdrawal as a transfer."
            }
            Channel.CASH_IN -> if (credit) {
                type = EntryType.TRANSFER
                counterpart = cash
                counterpartHint = "Choose where the cash came from."
            }
            Channel.ADD_MONEY -> if (credit) {
                type = EntryType.TRANSFER
                counterpart = other
                counterpartHint = "Choose the account the money came from${parsed.otherProvider?.let { " (${it.name})" } ?: ""}."
            }
            Channel.TRANSFER -> if (other != null) {
                type = EntryType.TRANSFER
                counterpart = other
            }
            else -> if (!credit && other != null && parsed.otherProvider?.kind == AccountType.MOBILE_WALLET) {
                // e.g. a bank alert for money sent to your own bKash.
                type = EntryType.TRANSFER
                counterpart = other
            }
        }
        var ownId = own?.first?.id
        var counterpartId = counterpart?.id
        var categoryId: String? = null
        var scope: ExpenseScope? = null
        var countAsExpense = false

        // 2. Repeat how you recorded the same description before, when it points
        //    the same way (money out stays money out).
        if (learned != null && (if (credit) learned.type != EntryType.EXPENSE else learned.type != EntryType.INCOME)) {
            val learnedOwn = if (learned.type == EntryType.TRANSFER && credit) learned.toAccountId else learned.accountId
            val learnedCounterpart = if (learned.type == EntryType.TRANSFER) (if (credit) learned.accountId else learned.toAccountId) else null
            if (ownId == null && isActive(learnedOwn)) ownId = learnedOwn
            type = learned.type
            if (type == EntryType.TRANSFER && counterpartId == null && isActive(learnedCounterpart) && learnedCounterpart != ownId) counterpartId = learnedCounterpart
            if (categories.any { it.id == learned.categoryId && !it.isArchived && !it.deleted }) {
                categoryId = learned.categoryId
                scope = learned.scope
                countAsExpense = type == EntryType.TRANSFER && learned.countAsExpense
            }
        }
        if (categoryId == null && type != EntryType.TRANSFER) {
            val category = pickCategory(parsed.categoryHints, if (type == EntryType.INCOME) CategoryKind.INCOME else CategoryKind.EXPENSE, categories)
            categoryId = category?.id
            scope = category?.defaultScope
        }

        val accountId = if (type == EntryType.TRANSFER && credit) counterpartId else ownId
        val toAccountId = if (type == EntryType.TRANSFER) (if (credit) ownId else counterpartId) else null

        // 3. What to check before adding.
        val issues = mutableListOf<String>()
        val ownAccount = active.firstOrNull { it.id == ownId }
        if (ownAccount == null) {
            issues += parsed.provider?.let { "Choose the account for ${it.name}." } ?: "Choose the account."
        } else if (parsed.currency != null && ownAccount.currency != parsed.currency) {
            issues += "The message is in ${parsed.currency}; ${ownAccount.name} uses ${ownAccount.currency}. Enter the amount in ${ownAccount.currency}."
        }
        if (own != null && own.second == SmsSuggestion.Match.GUESSED && ownId == own.first.id) issues += "Check the account — ${own.first.name} is a guess."
        if (type == EntryType.TRANSFER && counterpartId == null) {
            issues += counterpartHint.ifEmpty { if (credit) "Choose the account the money came from." else "Choose the account the money went to." }
        }
        if (parsed.amount == null) issues += "Enter the amount."
        if (parsed.direction == null) issues += "Couldn't tell whether money came in or went out."
        if (parsed.date == null) issues += "No date in the message — using today."
        val date = parsed.date ?: today
        if (date > Dates.addDays(today, 1)) issues += "The date is in the future."

        val draft = SmsDraft(
            type = type,
            amount = parsed.amount,
            accountId = accountId,
            toAccountId = toAccountId,
            categoryId = categoryId,
            scope = scope ?: categories.firstOrNull { it.id == categoryId }?.defaultScope ?: ExpenseScope.PERSONAL,
            countAsExpense = countAsExpense,
            date = date,
            time = parsed.time,
            description = parsed.description,
            notes = parsed.text.take(2000),
        )

        val fee = parsed.fee?.let { amount ->
            val feeCategory = pickCategory(SmsParser.FEE_CATEGORY_HINTS, CategoryKind.EXPENSE, categories)
            draft.copy(
                type = EntryType.EXPENSE,
                amount = amount,
                accountId = ownId,
                toAccountId = null,
                categoryId = feeCategory?.id,
                scope = feeCategory?.defaultScope ?: ExpenseScope.PERSONAL,
                countAsExpense = false,
                description = FEE_LABELS[parsed.channel] ?: "${parsed.provider?.name ?: "Bank"} fee",
            )
        }

        val ready = parsed.ignored == null && issues.isEmpty() && parsed.confidence == Confidence.HIGH
        val match = if (own != null && ownId != null && ownId == own.first.id) own.second else null
        return SmsSuggestion(draft, fee, issues, ready, match)
    }
}
