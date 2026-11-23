package io.github.fr_ost.hisab.core

import java.util.UUID

/**
 * When a record changed, as a number every phone agrees on the order of: the
 * time in milliseconds, but never earlier than the latest change this phone
 * has seen (from itself or another phone), so a phone whose clock runs slow
 * still records its edits as newer than the ones it has already seen.
 */
class SyncClock(private val now: () -> Long = System::currentTimeMillis, seen: Long = 0) {
    private var last = seen

    @Synchronized
    fun next(): Long {
        last = maxOf(now(), last + 1)
        return last
    }

    /** Records from elsewhere carry their own changes: never stamp behind them. */
    @Synchronized
    fun observe(stamp: Long) {
        if (stamp > last) last = stamp
    }
}

object Ids {
    fun new(): String = UUID.randomUUID().toString()

    /** The same id on every phone for the same thing (an SMS's entry, a row of a backup file). */
    fun stable(vararg parts: String): String = UUID.nameUUIDFromBytes(parts.joinToString("\u0000").toByteArray(Charsets.UTF_8)).toString()
}

/**
 * Combining what two phones hold. For each record (by id), the later change
 * wins — the one with the higher `updatedAt`, then the higher device id, so
 * every phone picks the same one. A deletion is a change too: the tombstone
 * wins over older edits and loses to newer ones.
 */
object Sync {
    fun <T : Synced> winner(a: T, b: T): T =
        if (b.updatedAt > a.updatedAt || (b.updatedAt == a.updatedAt && b.device > a.device)) b else a

    fun <T : Synced> merge(local: List<T>, remote: List<T>): List<T> {
        val byId = LinkedHashMap<String, T>()
        for (record in local) byId[record.id] = byId[record.id]?.let { winner(it, record) } ?: record
        for (record in remote) byId[record.id] = byId[record.id]?.let { winner(it, record) } ?: record
        return byId.values.toList()
    }

    fun merge(local: LedgerData, remote: LedgerData): LedgerData = LedgerData(
        settings = winner(local.settings, remote.settings),
        accounts = merge(local.accounts, remote.accounts),
        categories = merge(local.categories, remote.categories),
        transactions = merge(local.transactions, remote.transactions),
        checkpoints = merge(local.checkpoints, remote.checkpoints),
        budgets = merge(local.budgets, remote.budgets),
        rates = merge(local.rates, remote.rates),
        recurring = merge(local.recurring, remote.recurring),
    )

    /** Records in `merged` that differ from `before`: what the merge changed on this phone. */
    fun changed(before: LedgerData, merged: LedgerData): List<Synced> {
        val old = before.records().associateBy { it::class to it.id }
        return merged.records().filter { old[it::class to it.id] != it }
    }
}
