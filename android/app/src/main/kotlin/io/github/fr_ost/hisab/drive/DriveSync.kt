package io.github.fr_ost.hisab.drive

import android.content.Context
import androidx.core.content.edit
import io.github.fr_ost.hisab.core.LedgerData
import io.github.fr_ost.hisab.core.SyncFiles
import io.github.fr_ost.hisab.data.Repository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Sync through the person's own Google Drive, with no server: each phone
 * keeps one file of everything it holds in Hisab's app folder there
 * (SyncFiles), reads the other phones' files when they change, merges them
 * in (the later change to each record wins, deletions included) and writes
 * its own file again when something changed here.
 */
class DriveSync(context: Context, private val repository: Repository) {
    private val prefs = context.applicationContext.getSharedPreferences("hisab.drive", Context.MODE_PRIVATE)
    private val lock = Mutex()

    data class Status(val enabled: Boolean, val lastSynced: Long, val problem: String?, val syncing: Boolean, val phones: Int)

    private val state = MutableStateFlow(read())
    val status: StateFlow<Status> = state.asStateFlow()

    private fun read() = Status(
        enabled = prefs.getBoolean(ENABLED, false),
        lastSynced = prefs.getLong(LAST, 0),
        problem = prefs.getString(PROBLEM, null),
        syncing = false,
        phones = prefs.getInt(PHONES, 0),
    )

    val enabled: Boolean get() = prefs.getBoolean(ENABLED, false)

    fun enable(on: Boolean) {
        prefs.edit {
            putBoolean(ENABLED, on)
            if (!on) remove(PROBLEM)
        }
        state.value = read()
    }

    fun problem(message: String?) {
        prefs.edit { if (message == null) remove(PROBLEM) else putString(PROBLEM, message) }
        state.value = read().copy(syncing = state.value.syncing)
    }

    /** What sync found: changes taken from other phones, and how many other phones there are. */
    data class Report(val received: Int, val otherPhones: Int, val uploaded: Boolean)

    /** Are there other phones' files in this Drive (and does this phone already hold anything)? */
    suspend fun othersInDrive(token: String): Int = withContext(Dispatchers.IO) {
        val mine = SyncFiles.name(repository.device)
        DriveFiles(token).list().count { SyncFiles.isSyncFile(it.name) && it.name != mine }
    }

    suspend fun sync(token: String): Report = lock.withLock {
        state.value = state.value.copy(syncing = true)
        try {
            withContext(Dispatchers.IO) { syncOnce(token) }.also {
                prefs.edit {
                    putLong(LAST, System.currentTimeMillis())
                    putInt(PHONES, it.otherPhones)
                    remove(PROBLEM)
                }
            }
        } finally {
            state.value = read()
        }
    }

    private suspend fun syncOnce(token: String): Report {
        repository.loaded()
        val drive = DriveFiles(token)
        val files = drive.list().filter { SyncFiles.isSyncFile(it.name) }
        val mineName = SyncFiles.name(repository.device)
        val seen = seen()
        var received = 0
        for (file in files) {
            if (file.name == mineName || seen[file.name] == file.modifiedTime) continue
            // A file a newer app wrote waits (unseen) until this one is updated.
            val theirs: LedgerData = SyncFiles.read(drive.download(file.id)) ?: continue
            received += repository.mergeFrom(theirs)
            seen[file.name] = file.modifiedTime
        }
        // The other phones' files that are gone are forgotten.
        seen.keys.retainAll(files.map { it.name }.toSet())

        val mine = files.firstOrNull { it.name == mineName }
        val current = repository.data.value ?: LedgerData()
        val stamp = current.latestStamp()
        var uploaded = false
        if (!current.isEmpty() && (mine == null || stamp != prefs.getLong(UPLOADED, -1) || mine.modifiedTime != prefs.getString(MINE, null))) {
            val bytes = SyncFiles.write(current, repository.device, System.currentTimeMillis())
            val written = if (mine == null) drive.create(mineName, bytes) else drive.update(mine.id, bytes)
            prefs.edit {
                putLong(UPLOADED, stamp)
                putString(MINE, written.modifiedTime)
            }
            uploaded = true
        }
        save(seen)
        return Report(received, files.count { it.name != mineName }, uploaded)
    }

    /** Delete Hisab's files from this Google account's Drive (every phone's), and stop syncing here. */
    suspend fun removeFromDrive(token: String): Int = lock.withLock {
        withContext(Dispatchers.IO) {
            val drive = DriveFiles(token)
            val files = drive.list().filter { SyncFiles.isSyncFile(it.name) }
            files.forEach { drive.delete(it.id) }
            prefs.edit { clear() }
            state.value = read()
            files.size
        }
    }

    /** Whether something changed here since this phone last wrote its file. */
    fun hasUnsent(): Boolean = (repository.data.value?.latestStamp() ?: 0) != prefs.getLong(UPLOADED, -1)

    private fun seen(): MutableMap<String, String> = runCatching {
        Json.parseToJsonElement(prefs.getString(SEEN, "{}") ?: "{}").jsonObject.mapValues { it.value.jsonPrimitive.content }.toMutableMap()
    }.getOrDefault(mutableMapOf())

    private fun save(seen: Map<String, String>) {
        prefs.edit { putString(SEEN, JsonObject(seen.mapValues { JsonPrimitive(it.value) }).toString()) }
    }

    private companion object {
        const val ENABLED = "enabled"
        const val LAST = "last"
        const val PROBLEM = "problem"
        const val PHONES = "phones"
        const val SEEN = "seen"
        const val UPLOADED = "uploaded"
        const val MINE = "mine"
    }
}
