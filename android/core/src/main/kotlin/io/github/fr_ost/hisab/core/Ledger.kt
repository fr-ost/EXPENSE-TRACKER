package io.github.fr_ost.hisab.core

/**
 * Balances, derived from what was recorded and never stored. The same rules
 * as the website's SQL views (prisma/migrations, "TransactionLeg",
 * "BalanceCorrection", "LedgerEntry"):
 *
 * - A transaction moves its account (and a transfer, its destination too),
 *   unless it doesn't affect balances.
 * - Known balances are anchors: the opening balance, and each balance update.
 *   The earliest anchor fixes the balance at its moment (movements dated
 *   before it are history, cancelled by a correction at the very start), and
 *   every later anchor gets a correction for whatever the ledger doesn't
 *   explain since the previous one.
 * - Within a day, events are ordered by (date, at, rank, createdAt): `at` is
 *   the time, else the time it was recorded on that day, else the end of the
 *   day ("24:00"); the opening comes first and a balance update after the
 *   movements at the same moment.
 *
 * Built from live records (no tombstones); entries whose account no longer
 * exists (deleted on another phone) are left out.
 */
class Ledger(data: LedgerData) {
    private val live = data.live()

    val accounts: Map<String, Account> = live.accounts.associateBy { it.id }

    /** Every account leg of every transaction, whether or not it moves the balance. */
    val legs: List<Leg> = live.transactions.flatMap { t ->
        val from = accounts[t.accountId] ?: return@flatMap emptyList()
        val at = t.time ?: t.loggedTime ?: END_OF_DAY
        val outgoing = t.type == EntryType.EXPENSE || t.type == EntryType.TRANSFER
        val own = Leg(t.id, from.id, from.currency, t.date, t.time, at, t.type, if (outgoing) -t.amount else t.amount, t.affectsBalance, t.createdAt)
        val to = t.toAccountId?.let { accounts[it] }
        if (t.type == EntryType.TRANSFER && to != null) {
            listOf(own, Leg(t.id, to.id, to.currency, t.date, t.time, at, t.type, t.toAmount ?: t.amount, t.affectsBalance, t.createdAt))
        } else {
            listOf(own)
        }
    }

    /** The corrections that make every anchor hold (see the class comment). */
    val corrections: List<Correction>

    /** Everything that moves a balance, by account. */
    private val entriesByAccount: Map<String, List<LedgerEntry>>

    init {
        val legsByAccount = legs.filter { it.affectsBalance }.groupBy { it.accountId }
        val checkpointsByAccount = live.checkpoints.filter { it.accountId in accounts }.groupBy { it.accountId }
        val found = mutableListOf<Correction>()
        for (account in accounts.values) {
            val events = buildList {
                legsByAccount[account.id]?.forEach { add(Event(it.date, it.at, 0, it.createdAt, it.transactionId, it.amount, null, null)) }
                add(Event(account.openingDate, "00:00", -1, account.createdAt, account.id, 0, account.openingBalance, null))
                checkpointsByAccount[account.id]?.forEach {
                    add(Event(it.date, it.time ?: it.loggedTime ?: END_OF_DAY, 1, it.createdAt, it.id, 0, it.balance, it.id))
                }
            }.sortedWith(EVENT_ORDER)

            var moved = 0L
            var previous: Pair<Long, Long>? = null // (balance, moved) at the previous anchor
            for (event in events) {
                moved += event.amount
                val balance = event.balance ?: continue
                val amount = if (previous == null) {
                    balance - account.openingBalance - moved
                } else {
                    balance - previous.first - (moved - previous.second)
                }
                found += if (previous == null) {
                    Correction(account.id, account.currency, event.checkpointId, Correction.Kind.HISTORY, HISTORY_DATE, "00:00", amount)
                } else {
                    Correction(account.id, account.currency, event.checkpointId, Correction.Kind.CORRECTION, event.date, event.at, amount)
                }
                previous = balance to moved
            }
        }
        corrections = found

        val entries = legs.filter { it.affectsBalance }.map { LedgerEntry(it.transactionId, null, it.accountId, it.currency, it.date, it.at, it.type, it.amount) } +
            found.filter { it.amount != 0L }.map { LedgerEntry(null, it.checkpointId, it.accountId, it.currency, it.date, it.at, EntryType.ADJUSTMENT, it.amount) }
        entriesByAccount = entries.groupBy { it.accountId }
    }

    fun entries(accountId: String): List<LedgerEntry> = entriesByAccount[accountId].orEmpty()

    fun allEntries(): List<LedgerEntry> = entriesByAccount.values.flatten()

    /** The balance at the end of `date`. */
    fun balance(accountId: String, date: String): Long {
        val account = accounts[accountId] ?: return 0
        return account.openingBalance + entries(accountId).sumOf { if (it.date <= date) it.amount else 0L }
    }

    /** Each account with its balance as of `asOf` (normally today), active ones first. */
    fun summaries(asOf: String): List<AccountSummary> {
        val legsByAccount = legs.groupBy { it.accountId }
        val checkpointsByAccount = live.checkpoints.groupBy { it.accountId }
        return accounts.values
            .sortedWith(compareByDescending<Account> { it.isActive }.thenBy { it.sortOrder }.thenBy { it.createdAt }.thenBy { it.id })
            .map { account ->
                val entries = entries(account.id)
                val net = entries.sumOf { if (it.date <= asOf) it.amount else 0L }
                val within = entries.filter { it.transactionId != null && it.date >= account.openingDate && it.date <= asOf }
                val ownLegs = legsByAccount[account.id].orEmpty().filter { it.date <= asOf }
                val balance = account.openingBalance + net
                val inflow = within.sumOf { if (it.amount > 0) it.amount else 0L }
                val outflow = -within.sumOf { if (it.amount < 0) it.amount else 0L }
                val latest = checkpointsByAccount[account.id].orEmpty()
                    .filter { it.date <= asOf }
                    .maxWithOrNull(compareBy<Checkpoint> { it.date }.thenBy { it.time ?: it.loggedTime ?: END_OF_DAY }.thenBy { it.createdAt })
                AccountSummary(
                    account = account,
                    balance = balance,
                    inflow = inflow,
                    outflow = outflow,
                    corrections = balance - account.openingBalance - inflow + outflow,
                    transactionCount = ownLegs.size,
                    lastActivity = ownLegs.maxOfOrNull { it.date },
                    scheduledNet = entries.sumOf { if (it.date > asOf) it.amount else 0L },
                    lastUpdate = latest,
                )
            }
    }

    private data class Event(
        val date: String,
        val at: String,
        val rank: Int,
        val createdAt: Long,
        val id: String,
        val amount: Long,
        val balance: Long?,
        val checkpointId: String?,
    )

    companion object {
        const val END_OF_DAY = "24:00"
        const val HISTORY_DATE = "1900-01-01"

        private val EVENT_ORDER = compareBy<Event> { it.date }.thenBy { it.at }.thenBy { it.rank }.thenBy { it.createdAt }.thenBy { it.id }

        /**
         * Where an entry sits within its day when it has no time: recorded on
         * its own date, the moment it was recorded ("HH:MM:SS"); otherwise the
         * end of the day.
         */
        fun loggedTimeFor(date: String, time: String?, clock: Clock): String? =
            if (time == null && date == clock.today && clock.time != null) clock.time else null
    }
}

/** One account's side of a transaction. `amount` is signed: money into the account is positive. */
data class Leg(
    val transactionId: String,
    val accountId: String,
    val currency: String,
    val date: String,
    val time: String?,
    val at: String,
    val type: EntryType,
    val amount: Long,
    val affectsBalance: Boolean,
    val createdAt: Long,
)

data class Correction(
    val accountId: String,
    val currency: String,
    val checkpointId: String?,
    val kind: Kind,
    val date: String,
    val at: String,
    val amount: Long,
) {
    enum class Kind { HISTORY, CORRECTION }
}

/** Something that moves a balance: a transaction leg, or a correction (`type` ADJUSTMENT). */
data class LedgerEntry(
    val transactionId: String?,
    val checkpointId: String?,
    val accountId: String,
    val currency: String,
    val date: String,
    val at: String,
    val type: EntryType,
    val amount: Long,
)

/**
 * An account and its figures. Money in / out count its own transactions since
 * its opening date; whatever else changed the balance (balance updates) is
 * `corrections`, so opening + in − out + corrections = balance.
 */
data class AccountSummary(
    val account: Account,
    val balance: Long,
    val inflow: Long,
    val outflow: Long,
    val corrections: Long,
    val transactionCount: Int,
    val lastActivity: String?,
    /** Net of transactions dated after the day the figures are for. */
    val scheduledNet: Long,
    /** The latest balance update by then, if any. */
    val lastUpdate: Checkpoint?,
)
