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

/**
 * What one phone keeps in the person's Google Drive (its app folder, which
 * only Hisab can see): everything it holds, deleted records included, so
 * every other phone can merge it in. Each phone writes only its own file,
 * so two phones syncing at once never overwrite each other.
 */
object SyncFiles {
    const val FORMAT = "hisab-sync"
    const val VERSION = 1
    const val PREFIX = "hisab-sync-"

    @kotlinx.serialization.Serializable
    private data class File(
        val format: String,
        val version: Int,
        val device: String,
        val writtenAt: Long,
        val data: LedgerData,
    )

    private val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** The file a phone writes: one per phone. */
    fun name(device: String) = "$PREFIX$device.json.gz"

    fun isSyncFile(name: String) = name.startsWith(PREFIX) && name.endsWith(".json.gz")

    fun write(data: LedgerData, device: String, writtenAt: Long): ByteArray {
        val text = json.encodeToString(File.serializer(), File(FORMAT, VERSION, device, writtenAt, data))
        val bytes = java.io.ByteArrayOutputStream()
        java.util.zip.GZIPOutputStream(bytes).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        return bytes.toByteArray()
    }

    /**
     * What another phone wrote, or null when it isn't a sync file this
     * version can read (a newer app wrote it: that phone's changes wait
     * until this one is updated, and nothing is lost).
     */
    fun read(bytes: ByteArray): LedgerData? {
        val text = runCatching {
            java.util.zip.GZIPInputStream(bytes.inputStream()).use { it.readBytes().toString(Charsets.UTF_8) }
        }.getOrNull() ?: return null
        val file = runCatching { json.decodeFromString(File.serializer(), text) }.getOrNull() ?: return null
        if (file.format != FORMAT || file.version > VERSION) return null
        val data = file.data
        // Only well-formed records: an id, and settings under their own id.
        fun <T : Synced> List<T>.usable() = filter { it.id.isNotBlank() && it.id.length <= 200 }
        return LedgerData(
            settings = data.settings.takeIf { it.id == Settings.ID } ?: Settings(),
            accounts = data.accounts.usable(),
            categories = data.categories.usable(),
            transactions = data.transactions.usable(),
            checkpoints = data.checkpoints.usable(),
            budgets = data.budgets.usable(),
            rates = data.rates.usable(),
            recurring = data.recurring.usable(),
        )
    }
}
