package io.github.fr_ost.hisab.drive

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Hisab's app folder in the person's Google Drive, through Drive's own API
 * (v3) and nothing else: list, read, write and delete Hisab's files there.
 * Blocking calls: run them off the main thread.
 */
class DriveFiles(private val token: String) {
    data class Remote(val id: String, val name: String, val modifiedTime: String)

    /** Drive answered with an error; `code` is its HTTP status (401: the permission was withdrawn). */
    class DriveError(val code: Int, message: String) : IOException(message)

    private val json = Json { ignoreUnknownKeys = true }

    fun list(): List<Remote> {
        val found = mutableListOf<Remote>()
        var page: String? = null
        do {
            val query = buildString {
                append("spaces=appDataFolder&pageSize=100&fields=")
                append(encode("nextPageToken,files(id,name,modifiedTime)"))
                append("&q=").append(encode("trashed = false"))
                page?.let { append("&pageToken=").append(encode(it)) }
            }
            val body = json.parseToJsonElement(call("GET", "$API/files?$query").toString(Charsets.UTF_8)).jsonObject
            body["files"]?.jsonArray?.forEach { found += remote(it.jsonObject) }
            page = body["nextPageToken"]?.jsonPrimitive?.content
        } while (page != null && found.size < 1000)
        return found
    }

    fun download(id: String): ByteArray = call("GET", "$API/files/${encode(id)}?alt=media")

    fun create(name: String, bytes: ByteArray): Remote {
        val boundary = "hisab${System.nanoTime()}"
        val metadata = """{"name":${quote(name)},"parents":["appDataFolder"]}"""
        val body = java.io.ByteArrayOutputStream().apply {
            write("--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n$metadata\r\n--$boundary\r\nContent-Type: application/gzip\r\n\r\n".toByteArray())
            write(bytes)
            write("\r\n--$boundary--\r\n".toByteArray())
        }.toByteArray()
        val answer = call("POST", "$UPLOAD/files?uploadType=multipart&fields=id,name,modifiedTime", body, "multipart/related; boundary=$boundary")
        return remote(json.parseToJsonElement(answer.toString(Charsets.UTF_8)).jsonObject)
    }

    fun update(id: String, bytes: ByteArray): Remote {
        // HttpURLConnection can't send PATCH; Google's APIs take the override header.
        val answer = call("POST", "$UPLOAD/files/${encode(id)}?uploadType=media&fields=id,name,modifiedTime", bytes, "application/gzip", override = "PATCH")
        return remote(json.parseToJsonElement(answer.toString(Charsets.UTF_8)).jsonObject)
    }

    fun delete(id: String) {
        call("DELETE", "$API/files/${encode(id)}")
    }

    private fun remote(o: JsonObject) = Remote(
        o["id"]?.jsonPrimitive?.content.orEmpty(),
        o["name"]?.jsonPrimitive?.content.orEmpty(),
        o["modifiedTime"]?.jsonPrimitive?.content.orEmpty(),
    )

    private fun call(method: String, url: String, body: ByteArray? = null, type: String? = null, override: String? = null): ByteArray {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 20_000
            connection.readTimeout = 60_000
            connection.setRequestProperty("Authorization", "Bearer $token")
            override?.let { connection.setRequestProperty("X-HTTP-Method-Override", it) }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", type ?: "application/octet-stream")
                connection.setFixedLengthStreamingMode(body.size)
                connection.outputStream.use { it.write(body) }
            }
            val code = connection.responseCode
            if (code !in 200..299) {
                val detail = connection.errorStream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty().take(300)
                throw DriveError(code, "Google Drive answered $code${if (detail.isNotEmpty()) ": $detail" else ""}")
            }
            return if (code == 204) ByteArray(0) else connection.inputStream.use { it.readBytes() }
        } finally {
            connection.disconnect()
        }
    }

    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")

    private fun quote(value: String) = kotlinx.serialization.json.JsonPrimitive(value).toString()

    private companion object {
        const val API = "https://www.googleapis.com/drive/v3"
        const val UPLOAD = "https://www.googleapis.com/upload/drive/v3"
    }
}
