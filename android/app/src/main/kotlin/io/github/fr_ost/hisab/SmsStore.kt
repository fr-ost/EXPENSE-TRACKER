package io.github.fr_ost.hisab

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.provider.Telephony

/** A message in the outbox. */
data class QueuedSms(val id: Long, val sender: String, val body: String, val receivedAt: Long)

/**
 * The outbox: bank and wallet messages waiting to reach Hisab, so none is
 * lost while the phone is offline. Each is kept until the site has answered
 * for it, then removed; the phone keeps no record of what it sent.
 */
class SmsStore(context: Context) : SQLiteOpenHelper(context.applicationContext, "outbox.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE outbox (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "fingerprint TEXT NOT NULL UNIQUE, " +
                "sender TEXT NOT NULL, " +
                "body TEXT NOT NULL, " +
                "received_at INTEGER NOT NULL)",
        )
        db.execSQL("CREATE INDEX outbox_received_at ON outbox (received_at)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    /** Add messages (one already waiting is kept once). Returns how many are new. */
    fun add(messages: List<OutgoingSms>): Int {
        val db = writableDatabase
        var added = 0
        db.beginTransaction()
        try {
            for (message in messages) {
                val values = ContentValues().apply {
                    put("fingerprint", SmsFilter.fingerprint(message.sender, message.body))
                    put("sender", message.sender.take(SmsFilter.MAX_SENDER))
                    put("body", message.body.trim())
                    put("received_at", message.receivedAt)
                }
                if (db.insertWithOnConflict("outbox", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L) added++
            }
            // Offline for a very long time: the oldest give way.
            db.execSQL("DELETE FROM outbox WHERE id NOT IN (SELECT id FROM outbox ORDER BY received_at DESC LIMIT $MAX_KEPT)")
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return added
    }

    /** The oldest waiting messages: the site reads them in the order they arrived. */
    fun oldest(limit: Int): List<QueuedSms> =
        readableDatabase.query("outbox", arrayOf("id", "sender", "body", "received_at"), null, null, null, null, "received_at ASC, id ASC", limit.toString())
            .use { cursor ->
                buildList {
                    while (cursor.moveToNext()) add(QueuedSms(cursor.getLong(0), cursor.getString(1), cursor.getString(2), cursor.getLong(3)))
                }
            }

    fun remove(ids: Collection<Long>) {
        if (ids.isEmpty()) return
        writableDatabase.delete("outbox", "id IN (${ids.joinToString(",") { "?" }})", ids.map(Long::toString).toTypedArray())
    }

    fun count(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM outbox", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }

    fun clear() {
        writableDatabase.delete("outbox", null, null)
    }

    companion object {
        const val MAX_KEPT = 1000

        /**
         * Bank and wallet messages already on the phone from the last `days`
         * days (the person chose to bring them in). Needs READ_SMS.
         */
        fun recentInbox(context: Context, days: Int): List<OutgoingSms> {
            val since = System.currentTimeMillis() - days * 86_400_000L
            val columns = arrayOf(Telephony.TextBasedSmsColumns.ADDRESS, Telephony.TextBasedSmsColumns.BODY, Telephony.TextBasedSmsColumns.DATE)
            val found = mutableListOf<OutgoingSms>()
            context.contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                columns,
                "${Telephony.TextBasedSmsColumns.DATE} >= ?",
                arrayOf(since.toString()),
                "${Telephony.TextBasedSmsColumns.DATE} ASC",
            )?.use { cursor ->
                while (cursor.moveToNext() && found.size < MAX_KEPT) {
                    val sender: String? = cursor.getString(0)
                    val body: String? = cursor.getString(1)
                    if (sender != null && body != null && SmsFilter.shouldSend(sender, body)) {
                        found += OutgoingSms(sender, body.trim(), cursor.getLong(2))
                    }
                }
            }
            return found
        }
    }
}
