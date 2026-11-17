package io.github.fr_ost.hisab

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** What became of a request to the site. */
sealed interface Reply<out T> {
    data class Ok<T>(val value: T) : Reply<T>

    /** The site doesn't know this phone's token: it was removed in Settings. */
    data object Unlinked : Reply<Nothing>

    /** The site said no, and why (in words for the person). Sending it again won't help. */
    data class Refused(val message: String) : Reply<Nothing>

    /** No connection, the site is busy or down: try again later. */
    data object TryLater : Reply<Nothing>
}

/** What the site said about one message. `title` / `detail`: what was added, for a notification. */
data class Outcome(val status: String, val title: String?, val detail: String?) {
    val added: Boolean get() = (status == "added" || status == "balance") && !title.isNullOrBlank()
}

data class HandedIn(val outcomes: List<Outcome>, val waiting: Int)

data class Status(val account: Account, val waiting: Int)

/** The site's answers, read and written (plain functions, so they are tested on the JVM). */
object Replies {
    /** The earliest and latest moments the site takes for when a message arrived (2000–2100). */
    private const val EARLIEST = 946_684_800_000L
    private const val LATEST = 4_102_444_800_000L

    private fun JSONObject.text(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

    private fun account(token: String, json: JSONObject?): Account =
        Account(token, json?.text("email"), json?.text("name").orEmpty())

    fun linked(body: String): Account {
        val json = JSONObject(body)
        val token = json.getString("token")
        if (token.isBlank()) throw JSONException("no token")
        return account(token, json.optJSONObject("account"))
    }

    fun status(body: String, token: String): Status {
        val json = JSONObject(body)
        return Status(account(token, json.optJSONObject("account")), json.optInt("waiting", 0))
    }

    fun handedIn(body: String, expected: Int): HandedIn {
        val json = JSONObject(body)
        val results = json.getJSONArray("results")
        if (results.length() != expected) throw JSONException("expected $expected answers, got ${results.length()}")
        val outcomes = (0 until results.length()).map { index ->
            val result = results.getJSONObject(index)
            Outcome(result.getString("status"), result.text("title"), result.text("detail"))
        }
        return HandedIn(outcomes, json.optInt("waiting", 0))
    }

    /** The site's own words for what went wrong, or a plain fallback. */
    fun error(body: String): String =
        try {
            JSONObject(body).let { if (it.isNull("error")) null else it.optString("error") }
        } catch (_: JSONException) {
            null
        }?.takeIf { it.isNotBlank() } ?: "Something went wrong. Please try again."

    fun handInBody(messages: List<QueuedSms>, appVersion: String): String {
        val list = JSONArray()
        for (message in messages) {
            list.put(
                JSONObject()
                    .put("text", message.body.trim().take(SmsFilter.MAX_TEXT))
                    .put("sender", message.sender.trim().take(SmsFilter.MAX_SENDER))
                    .put("receivedAt", message.receivedAt.coerceIn(EARLIEST, LATEST)),
            )
        }
        return JSONObject().put("messages", list).put("appVersion", appVersion.take(20)).toString()
    }

    fun tokenBody(code: String, deviceName: String, appVersion: String): String =
        JSONObject().put("code", code).put("name", deviceName.take(60)).put("appVersion", appVersion.take(20)).toString()
}

/** The site's endpoints for a linked phone (src/app/api/devices). HTTPS only. */
class HisabApi(private val site: String) {
    /** Exchange a link code for this phone's token. */
    fun collectToken(code: String, deviceName: String): Reply<Account> =
        call("POST", "/api/devices/token", null, Replies.tokenBody(code, deviceName, BuildConfig.VERSION_NAME), Replies::linked)

    fun handIn(token: String, messages: List<QueuedSms>): Reply<HandedIn> =
        call("POST", "/api/devices/inbox", token, Replies.handInBody(messages, BuildConfig.VERSION_NAME)) { Replies.handedIn(it, messages.size) }

    fun status(token: String): Reply<Status> = call("GET", "/api/devices/self", token, null) { Replies.status(it, token) }

    /** Unlink this phone at the site; its token stops working. */
    fun unlink(token: String): Reply<Unit> = call("DELETE", "/api/devices/self", token, null) { }

    private fun <T> call(method: String, path: String, token: String?, body: String?, read: (String) -> T): Reply<T> {
        val connection = try {
            URL(site + path).openConnection() as HttpURLConnection
        } catch (_: IOException) {
            return Reply.TryLater
        }
        return try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            val text = (if (code < 400) connection.inputStream else connection.errorStream)?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
            when {
                code in 200..299 -> try {
                    Reply.Ok(read(text))
                } catch (_: JSONException) {
                    Reply.TryLater
                }
                code == 401 -> Reply.Unlinked
                code == 408 || code == 429 || code >= 500 -> Reply.TryLater
                else -> Reply.Refused(Replies.error(text))
            }
        } catch (_: IOException) {
            Reply.TryLater
        } finally {
            connection.disconnect()
        }
    }
}
