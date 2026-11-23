package io.github.fr_ost.hisab.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import androidx.core.database.sqlite.transaction
import io.github.fr_ost.hisab.core.Account
import io.github.fr_ost.hisab.core.Budget
import io.github.fr_ost.hisab.core.Category
import io.github.fr_ost.hisab.core.Checkpoint
import io.github.fr_ost.hisab.core.LedgerData
import io.github.fr_ost.hisab.core.Rate
import io.github.fr_ost.hisab.core.Recurring
import io.github.fr_ost.hisab.core.Settings
import io.github.fr_ost.hisab.core.Synced
import io.github.fr_ost.hisab.core.Transaction
import kotlinx.serialization.json.Json

/**
 * Where everything recorded lives on the phone: one table of records, each
 * kept as JSON under its kind and id (deleted ones too, as tombstones, so
 * the deletion can reach other phones). The whole ledger is read once at
 * start and kept in memory; each change is written here as it happens.
 */
class Store(context: Context) : SQLiteOpenHelper(context.applicationContext, "hisab.db", null, 1) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (kind, id))",
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun load(): LedgerData {
        val rows = mutableMapOf<String, MutableList<String>>()
        readableDatabase.rawQuery("SELECT kind, body FROM records", null).use { cursor ->
            while (cursor.moveToNext()) rows.getOrPut(cursor.getString(0)) { mutableListOf() } += cursor.getString(1)
        }
        fun <T> decode(kind: String, read: (String) -> T): List<T> = rows[kind].orEmpty().mapNotNull { body ->
            // A record this version can't read is left alone rather than lost.
            runCatching { read(body) }.getOrNull()
        }
        return LedgerData(
            settings = decode(SETTINGS) { json.decodeFromString(Settings.serializer(), it) }.firstOrNull() ?: Settings(),
            accounts = decode(ACCOUNT) { json.decodeFromString(Account.serializer(), it) },
            categories = decode(CATEGORY) { json.decodeFromString(Category.serializer(), it) },
            transactions = decode(TRANSACTION) { json.decodeFromString(Transaction.serializer(), it) },
            checkpoints = decode(CHECKPOINT) { json.decodeFromString(Checkpoint.serializer(), it) },
            budgets = decode(BUDGET) { json.decodeFromString(Budget.serializer(), it) },
            rates = decode(RATE) { json.decodeFromString(Rate.serializer(), it) },
            recurring = decode(RECURRING) { json.decodeFromString(Recurring.serializer(), it) },
        )
    }

    fun save(records: List<Synced>) {
        if (records.isEmpty()) return
        writableDatabase.transaction {
            for (record in records) {
                val (kind, body) = encode(record)
                val values = ContentValues().apply {
                    put("kind", kind)
                    put("id", record.id)
                    put("updated_at", record.updatedAt)
                    put("body", body)
                }
                insertWithOnConflict("records", null, values, SQLiteDatabase.CONFLICT_REPLACE)
            }
        }
    }

    private fun encode(record: Synced): Pair<String, String> = when (record) {
        is Settings -> SETTINGS to json.encodeToString(Settings.serializer(), record)
        is Account -> ACCOUNT to json.encodeToString(Account.serializer(), record)
        is Category -> CATEGORY to json.encodeToString(Category.serializer(), record)
        is Transaction -> TRANSACTION to json.encodeToString(Transaction.serializer(), record)
        is Checkpoint -> CHECKPOINT to json.encodeToString(Checkpoint.serializer(), record)
        is Budget -> BUDGET to json.encodeToString(Budget.serializer(), record)
        is Rate -> RATE to json.encodeToString(Rate.serializer(), record)
        is Recurring -> RECURRING to json.encodeToString(Recurring.serializer(), record)
    }

    private companion object {
        const val SETTINGS = "settings"
        const val ACCOUNT = "account"
        const val CATEGORY = "category"
        const val TRANSACTION = "transaction"
        const val CHECKPOINT = "checkpoint"
        const val BUDGET = "budget"
        const val RATE = "rate"
        const val RECURRING = "recurring"
    }
}
