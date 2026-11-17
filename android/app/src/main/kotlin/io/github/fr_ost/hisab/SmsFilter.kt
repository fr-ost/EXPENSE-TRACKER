package io.github.fr_ost.hisab

import java.security.MessageDigest

/** A message on its way to Hisab. `receivedAt`: when the phone got it, in milliseconds since 1970. */
data class OutgoingSms(val sender: String, val body: String, val receivedAt: Long)

/**
 * Which messages may leave the phone: ones from a bank or a wallet (a name
 * like "bKash" or a short code like "16216", never a person's phone number)
 * that are about money, and never a verification code. Nothing else is read
 * any further, stored or sent.
 *
 * This only keeps people's own messages on the phone. What a message means
 * is decided by the site, which reads it exactly as a pasted one
 * (src/lib/sms/parse.ts).
 */
object SmsFilter {
    /** The longest message the site takes. */
    const val MAX_TEXT = 2000
    const val MAX_SENDER = 40

    /** A phone number: a person, not a bank. Banks and wallets send from names and short codes. */
    private val PERSON = Regex("""^\+?\d{8,15}$""")
    private val SEPARATORS = Regex("""[\s\-().]""")

    private const val CURRENCY = """(?:৳|টাকা|(?<![A-Za-z])(?:tk|bdt|taka|usd|inr|rs|eur|gbp|aed|sar|myr|sgd|cad|aud)(?![A-Za-z]))"""
    private const val AMOUNT = """\d[\d,]*(?:\.\d{1,2})?"""
    private val MONEY = Regex("""(?i)$CURRENCY\.?\s*[:.]?\s*$AMOUNT|$AMOUNT\s*(?:/-)?\s*$CURRENCY""")
    private val BALANCE = Regex("""(?i)(?<![A-Za-z])(?:balance|bal|avl)(?![A-Za-z]).{0,24}?\d""")
    private val CODE = Regex(
        """(?i)(?<![A-Za-z])(?:otp|one[\s-]?time\s*(?:pass(?:word|code)?|pin|code)|verification\s*code|security\s*code|passcode|auth(?:entication)?\s*code)(?![A-Za-z])|ওটিপি|ভেরিফিকেশন""",
    )

    fun isBusinessSender(sender: String): Boolean {
        val compact = sender.replace(SEPARATORS, "")
        return compact.isNotEmpty() && !PERSON.matches(compact)
    }

    /** Bengali digits as ASCII ones, as the site reads them. */
    fun asciiDigits(text: String): String = buildString(text.length) {
        for (c in text) append(if (c in '০'..'৯') '0' + (c - '০') else c)
    }

    fun shouldSend(sender: String, body: String): Boolean {
        val text = body.trim()
        if (text.isEmpty() || text.length > MAX_TEXT || !isBusinessSender(sender)) return false
        val plain = asciiDigits(text)
        if (CODE.containsMatchIn(plain)) return false
        return MONEY.containsMatchIn(plain) || BALANCE.containsMatchIn(plain)
    }

    /** The same message, however it is spaced: the outbox keeps it once. */
    fun fingerprint(sender: String, body: String): String {
        val normalized = "${sender.trim().lowercase()}\n${body.trim().lowercase().replace(Regex("""\s+"""), " ")}"
        return MessageDigest.getInstance("SHA-256").digest(normalized.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }

    /**
     * A long SMS arrives in parts, one after another from the same sender:
     * put each message back together, in the order they came.
     */
    fun join(parts: List<OutgoingSms>): List<OutgoingSms> {
        val joined = LinkedHashMap<String, OutgoingSms>()
        for (part in parts) {
            val earlier = joined[part.sender]
            joined[part.sender] = earlier?.copy(body = earlier.body + part.body) ?: part
        }
        return joined.values.toList()
    }
}
