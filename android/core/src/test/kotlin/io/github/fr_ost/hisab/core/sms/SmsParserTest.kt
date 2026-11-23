package io.github.fr_ost.hisab.core.sms

import io.github.fr_ost.hisab.core.Money
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.boolean

/**
 * The phone reads every message exactly as the website does: the fixture
 * (src/test/resources/sms-corpus.json) holds what the website's reader
 * (src/lib/sms/parse.ts) made of every message in its own tests, read as
 * pasted and as received by a phone.
 */
class SmsParserTest {
    private val corpus = Json.parseToJsonElement(javaClass.getResource("/sms-corpus.json")!!.readText()).jsonObject

    private fun JsonElement.text(): String? = if (this is JsonNull) null else jsonPrimitive.content

    private fun money(e: JsonElement?): Long? = e?.text()?.let { Money.parse(it) }

    /** What the Kotlin reader made of a message, in the fixture's terms. */
    private fun fields(p: ParsedSms): Map<String, Any?> = mapOf(
        "direction" to p.direction?.name?.lowercase(),
        "channel" to p.channel.name.lowercase(),
        "amount" to p.amount,
        "currency" to p.currency,
        "fee" to p.fee,
        "balance" to p.balance,
        "balanceCurrency" to p.balanceCurrency,
        "limit" to p.limit,
        "provider" to p.provider?.id,
        "otherProvider" to p.otherProvider?.id,
        "accountDigits" to p.accountDigits,
        "counterpartyDigits" to p.counterpartyDigits,
        "isCard" to p.isCard,
        "date" to p.date,
        "time" to p.time,
        "counterparty" to p.counterparty,
        "reference" to p.reference,
        "description" to p.description,
        "categoryHints" to p.categoryHints,
        "ignored" to p.ignored?.name?.lowercase(),
        "confidence" to p.confidence.name.lowercase(),
    )

    private fun expected(e: JsonObject): Map<String, Any?> = mapOf(
        "direction" to e["direction"]!!.text(),
        "channel" to e["channel"]!!.text(),
        "amount" to money(e["amount"]),
        "currency" to e["currency"]!!.text(),
        "fee" to money(e["fee"]),
        "balance" to money(e["balance"]),
        "balanceCurrency" to e["balanceCurrency"]!!.text(),
        "limit" to money(e["limit"]),
        "provider" to e["provider"]!!.text(),
        "otherProvider" to e["otherProvider"]!!.text(),
        "accountDigits" to e["accountDigits"]!!.text(),
        "counterpartyDigits" to e["counterpartyDigits"]!!.text(),
        "isCard" to e["isCard"]!!.jsonPrimitive.boolean,
        "date" to e["date"]!!.text(),
        "time" to e["time"]!!.text(),
        "counterparty" to e["counterparty"]!!.text(),
        "reference" to e["reference"]!!.text(),
        "description" to e["description"]!!.text(),
        "categoryHints" to e["categoryHints"]!!.jsonArray.map { it.jsonPrimitive.content },
        "ignored" to e["ignored"]!!.text(),
        "confidence" to e["confidence"]!!.text(),
    )

    @Test
    fun readsEveryMessageExactlyAsTheWebsiteDoes() {
        val today = corpus["today"]!!.jsonPrimitive.content
        val cases = corpus["cases"]!!.jsonArray
        assertTrue(cases.size > 150, "the fixture has the website's test messages")
        val wrong = mutableListOf<String>()
        for (case in cases) {
            val c = case.jsonObject
            val text = c["text"]!!.jsonPrimitive.content
            val received = c["receivedAt"]!!.takeIf { it !is JsonNull }?.jsonObject?.let { ReceivedAt(it["date"]!!.jsonPrimitive.content, it["time"]!!.text()) }
            val got = fields(SmsParser.parse(text, today, received))
            val want = expected(c["expected"]!!.jsonObject)
            val differences = want.keys.filter { got[it] != want[it] }.map { "$it: got ${got[it]}, want ${want[it]}" }
            if (differences.isNotEmpty()) wrong += "${if (received != null) "[received] " else ""}$text\n    ${differences.joinToString("\n    ")}"
        }
        assertEquals("", wrong.joinToString("\n\n"), "${wrong.size} of ${cases.size} messages read differently")
    }

    @Test
    fun splitsPastedTextIntoMessagesAsTheWebsiteDoes() {
        val split = corpus["split"]!!.jsonObject
        val want = split["expected"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(want, SmsParser.splitMessages(split["text"]!!.jsonPrimitive.content, 500))
    }

    @Test
    fun recognisesBanksAndWallets() {
        assertEquals("bkash", Providers.detect("Cash Out Tk 2,000.00 to 01912345678 successful. TrxID BIT9CD5E6F at 28/09/2026 10:05").first?.id)
        // "…from City Bank" in a bKash alert names the other side.
        val (provider, other) = Providers.detect("You have received deposit from iBanking of Tk 2,500.00 from City Bank. TrxID X1 at 28/09/2026 12:11")
        assertEquals(listOf("bkash", "city"), listOf(provider?.id, other?.id))
        // "Social Islami Bank" isn't also "Islami Bank".
        assertEquals("sibl", Providers.detect("Social Islami Bank: your A/C 1234 is debited").first?.id)
        assertEquals(54, Providers.ALL.size)
    }
}
