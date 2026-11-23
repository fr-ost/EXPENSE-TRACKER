package io.github.fr_ost.hisab.core

import kotlinx.serialization.Serializable

enum class AccountType { CASH, BANK, MOBILE_WALLET, CARD, EXCHANGE, OTHER }

/** ADJUSTMENT only comes from old website data; Hisab makes balance updates instead. */
enum class EntryType { INCOME, EXPENSE, TRANSFER, ADJUSTMENT }

enum class CategoryKind { INCOME, EXPENSE }

/** Who spending was for. Each has its own monthly budget. */
enum class ExpenseScope { PERSONAL, FAMILY }

enum class Frequency { WEEKLY, MONTHLY, YEARLY }

enum class NumberFormat { SOUTH_ASIAN, INTERNATIONAL }

enum class CheckpointSource { MANUAL, SMS }

/**
 * Every record Hisab keeps can sync between phones through Google Drive: it
 * has an id that is the same on every phone, when it last changed (a clock
 * every phone moves forward, see SyncClock), which phone changed it, and
 * whether it was deleted — a deleted record is kept as a tombstone so the
 * deletion reaches the other phones too.
 */
sealed interface Synced {
    val id: String
    val updatedAt: Long
    val device: String
    val deleted: Boolean

    /** The same record, changed now by `device` (and deleted, if `deleted`). */
    fun stamped(updatedAt: Long, device: String, deleted: Boolean = this.deleted): Synced
}

/** The person's preferences: one record, id "settings". */
@Serializable
data class Settings(
    override val id: String = ID,
    val displayName: String = "",
    val baseCurrency: String = "BDT",
    val numberFormat: NumberFormat = NumberFormat.SOUTH_ASIAN,
    /** The currency a new income / expense starts in (null: the main currency). */
    val incomeCurrency: String? = null,
    val expenseCurrency: String? = null,
    /** Minutes away before the app locks again; 0 never. Only with a lock set. */
    val autoLockMinutes: Int = 5,
    val timezone: String = "Asia/Dhaka",
    override val updatedAt: Long = 0,
    override val device: String = "",
    override val deleted: Boolean = false,
) : Synced {
    override fun stamped(updatedAt: Long, device: String, deleted: Boolean) = copy(updatedAt = updatedAt, device = device, deleted = false)

    companion object {
        const val ID = "settings"
    }
}

/** Where money physically lives. */
@Serializable
data class Account(
    override val id: String,
    val name: String,
    val type: AccountType,
    val currency: String,
    val openingBalance: Long,
    val openingDate: String,
    val isActive: Boolean = true,
    val icon: String? = null,
    val color: String? = null,
    val sortOrder: Int = 0,
    val createdAt: Long,
    override val updatedAt: Long = 0,
    override val device: String = "",
    override val deleted: Boolean = false,
) : Synced {
    override fun stamped(updatedAt: Long, device: String, deleted: Boolean) = copy(updatedAt = updatedAt, device = device, deleted = deleted)
}

@Serializable
data class Category(
    override val id: String,
    val name: String,
    val kind: CategoryKind,
    /** Expense categories only: who spending in it is usually for. */
    val defaultScope: ExpenseScope? = null,
    val icon: String = "circle-dashed",
    val color: String = "gray",
    val isArchived: Boolean = false,
    val sortOrder: Int = 0,
    val createdAt: Long,
    override val updatedAt: Long = 0,
    override val device: String = "",
    override val deleted: Boolean = false,
) : Synced {
    override fun stamped(updatedAt: Long, device: String, deleted: Boolean) = copy(updatedAt = updatedAt, device = device, deleted = deleted)
}

/**
 * Money in, out, or between two of your accounts. `amount` is always
 * positive, in the account's currency; a transfer between currencies also
 * has `toAmount`, in the destination's.
 */
@Serializable
data class Transaction(
    override val id: String,
    val type: EntryType,
    val amount: Long,
    val date: String,
    /** "HH:MM" when the time is known. */
    val time: String? = null,
    /** "HH:MM:SS": when an untimed entry was recorded on its own date (it orders the day). */
    val loggedTime: String? = null,
    val accountId: String,
    val toAccountId: String? = null,
    val toAmount: Long? = null,
    val categoryId: String? = null,
    /** A transfer that is spending too (e.g. paying a card). */
    val countAsExpense: Boolean = false,
    val scope: ExpenseScope? = null,
    val description: String = "",
    val notes: String? = null,
    val recurringId: String? = null,
    val occurrenceDate: String? = null,
    /** False: in reports, but out of every balance. */
    val affectsBalance: Boolean = true,
    /** "sms:<fingerprint>:<part>" for an entry made from an SMS: the same message is never added twice. */
    val smsKey: String? = null,
    val createdAt: Long,
    override val updatedAt: Long = 0,
    override val device: String = "",
    override val deleted: Boolean = false,
) : Synced {
    override fun stamped(updatedAt: Long, device: String, deleted: Boolean) = copy(updatedAt = updatedAt, device = device, deleted = deleted)
}

/** A known balance at a moment ("balance update"): the ledger is corrected to agree with it. */
@Serializable
data class Checkpoint(
    override val id: String,
    val accountId: String,
    val date: String,
    val time: String? = null,
    val loggedTime: String? = null,
    val balance: Long,
    val source: CheckpointSource = CheckpointSource.MANUAL,
    val note: String? = null,
    val smsKey: String? = null,
    /** For a balance read from an SMS: when the message was sent. */
    val messageDate: String? = null,
    val messageTime: String? = null,
    val createdAt: Long,
    override val updatedAt: Long = 0,
    override val device: String = "",
    override val deleted: Boolean = false,
) : Synced {
    override fun stamped(updatedAt: Long, device: String, deleted: Boolean) = copy(updatedAt = updatedAt, device = device, deleted = deleted)
}

/** A monthly budget for one scope, from `effectiveFrom` ("YYYY-MM-01") until the next one. Id: "PERSONAL:2026-09-01". */
@Serializable
data class Budget(
    override val id: String,
    val scope: ExpenseScope,
    val effectiveFrom: String,
    val amount: Long,
    override val updatedAt: Long = 0,
    override val device: String = "",
    override val deleted: Boolean = false,
) : Synced {
    override fun stamped(updatedAt: Long, device: String, deleted: Boolean) = copy(updatedAt = updatedAt, device = device, deleted = deleted)

    companion object {
        fun idOf(scope: ExpenseScope, effectiveFrom: String) = "${scope.name}:$effectiveFrom"
    }
}

/** Your own rate for a currency: main-currency units for one unit ("122.45"). Id: "BDT:USD". */
@Serializable
data class Rate(
    override val id: String,
    val base: String,
    val currency: String,
    val rate: String,
    override val updatedAt: Long = 0,
    override val device: String = "",
    override val deleted: Boolean = false,
) : Synced {
    override fun stamped(updatedAt: Long, device: String, deleted: Boolean) = copy(updatedAt = updatedAt, device = device, deleted = deleted)

    companion object {
        fun idOf(base: String, currency: String) = "$base:$currency"
    }
}

/** A transaction that repeats: posted on its own when it comes due. */
@Serializable
data class Recurring(
    override val id: String,
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
    /** How many occurrences have been posted or skipped. */
    val occurrenceIndex: Int = 0,
    val nextOccurrence: String? = null,
    val isActive: Boolean = true,
    val createdAt: Long,
    override val updatedAt: Long = 0,
    override val device: String = "",
    override val deleted: Boolean = false,
) : Synced {
    override fun stamped(updatedAt: Long, device: String, deleted: Boolean) = copy(updatedAt = updatedAt, device = device, deleted = deleted)
}

/** Everything one person has recorded, deleted records (tombstones) included. */
@Serializable
data class LedgerData(
    val settings: Settings = Settings(),
    val accounts: List<Account> = emptyList(),
    val categories: List<Category> = emptyList(),
    val transactions: List<Transaction> = emptyList(),
    val checkpoints: List<Checkpoint> = emptyList(),
    val budgets: List<Budget> = emptyList(),
    val rates: List<Rate> = emptyList(),
    val recurring: List<Recurring> = emptyList(),
) {
    /** Without the tombstones: what the person sees. */
    fun live(): LedgerData = LedgerData(
        settings = settings,
        accounts = accounts.filterNot { it.deleted },
        categories = categories.filterNot { it.deleted },
        transactions = transactions.filterNot { it.deleted },
        checkpoints = checkpoints.filterNot { it.deleted },
        budgets = budgets.filterNot { it.deleted },
        rates = rates.filterNot { it.deleted },
        recurring = recurring.filterNot { it.deleted },
    )

    /** Every record, settings first. */
    fun records(): List<Synced> = listOf(settings) + accounts + categories + transactions + checkpoints + budgets + rates + recurring

    /** The latest change any record carries. */
    fun latestStamp(): Long = records().maxOfOrNull { it.updatedAt } ?: 0L
}
