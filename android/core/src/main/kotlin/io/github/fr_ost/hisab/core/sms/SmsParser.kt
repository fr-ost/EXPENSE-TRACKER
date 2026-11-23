package io.github.fr_ost.hisab.core.sms

import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.Money
import java.text.Normalizer

enum class Direction { DEBIT, CREDIT }

enum class Channel {
    ATM, CASH_OUT, CASH_IN, ADD_MONEY, SALARY, REFUND, CASHBACK, REMITTANCE, INTEREST, RECHARGE, BILL,
    SEND_MONEY, PAYMENT, TRANSFER, DEPOSIT, RECEIVED, DEBITED, UNKNOWN,
}

/** Why a message won't become a transaction. */
enum class IgnoreReason(val label: String) {
    OTP("Verification code — not a transaction"),
    PROMO("Looks like an offer or advert"),
    FAILED("The transaction failed or was declined"),
    REMINDER("A reminder or statement, not a completed transaction"),
    NO_AMOUNT("No transaction amount found"),
}

enum class Confidence { HIGH, MEDIUM, LOW }

/** What a bank or wallet SMS says. Amounts are in paisa; dates "YYYY-MM-DD"; times "HH:MM". */
data class ParsedSms(
    val text: String,
    val direction: Direction?,
    val channel: Channel,
    val amount: Long?,
    val currency: String?,
    val fee: Long?,
    /** The account balance reported after the transaction. */
    val balance: Long?,
    /** The balance's currency (it can differ from the amount's, e.g. a USD charge on a BDT account). */
    val balanceCurrency: String?,
    /** A card's available limit — not a balance, so it never sets one. */
    val limit: Long?,
    val provider: Provider?,
    /** Another bank or wallet named in the message (e.g. "from City Bank" in a bKash alert). */
    val otherProvider: Provider?,
    /** Last digits of your account or card, when the message shows them. */
    val accountDigits: String?,
    /** Last digits of the other side's account. */
    val counterpartyDigits: String?,
    val isCard: Boolean,
    val date: String?,
    val time: String?,
    val counterparty: String?,
    val reference: String?,
    /** Suggested description, e.g. "Sent to 01712345678" or "Daraz". */
    val description: String,
    /** Category names to try, best first (matched case-insensitively against yours). */
    val categoryHints: List<String>,
    val ignored: IgnoreReason?,
    val confidence: Confidence,
)

/** When the phone received a message (the person's local date and time). */
data class ReceivedAt(val date: String, val time: String?)

/**
 * Reads bank and mobile-wallet SMS alerts: amount, direction, bank or
 * wallet, account digits, date and time, fee, balance and who the money went
 * to or came from. The website's reader (src/lib/sms/parse.ts), rule for
 * rule: its tests are this one's tests.
 */
object SmsParser {
    // ---- Text normalisation ------------------------------------------------

    private const val BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯"
    private val ODD_SPACES = Regex("[\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]")

    /** Bengali digits to ASCII, odd spaces to plain ones, line endings unified. */
    fun normalize(text: String): String {
        val folded = Normalizer.normalize(text, Normalizer.Form.NFKC)
            .map { c -> BENGALI_DIGITS.indexOf(c).let { if (it >= 0) '0' + it else c } }
            .joinToString("")
        return folded
            .replace(ODD_SPACES, " ")
            .replace(Regex("\r\n?"), "\n")
            .replace(Regex("[ \t]+"), " ")
            .replace(Regex(" *\n *"), "\n")
            .trim()
    }

    // ---- Amounts -------------------------------------------------------------

    private val CURRENCY_ALIASES = listOf(
        "৳" to "BDT", "tk." to "BDT", "tk" to "BDT", "taka" to "BDT", "bdt" to "BDT", "টাকা" to "BDT",
        "us$" to "USD", "usd" to "USD", "$" to "USD", "inr" to "INR", "rs." to "INR", "rs" to "INR", "₹" to "INR",
        "eur" to "EUR", "€" to "EUR", "gbp" to "GBP", "£" to "GBP", "aed" to "AED", "sar" to "SAR", "myr" to "MYR",
        "sgd" to "SGD", "cad" to "CAD", "aud" to "AUD", "pkr" to "PKR",
    )

    private fun escape(value: String) = value.replace(Regex("""[.*+?^${'$'}{}()|\[\]\\]""")) { "\\" + it.value }

    private val CURRENCY = "(?<![A-Za-z])(?:${CURRENCY_ALIASES.joinToString("|") { escape(it.first) }})(?![A-Za-z])"
    private const val NUMBER = """\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?(?!\d)|\d+(?:\.\d{1,2})?(?!\d)"""

    /** "Tk 1,250.00", "BDT500", "Tk.20", "৳ 45" */
    private val CURRENCY_FIRST = Regex("(?i)($CURRENCY)\\s*[:.]?\\s*($NUMBER)")

    /** "500.00 BDT", "২৫০ টাকা", "1,000 Taka" (codes and words only; "500 $" isn't a thing) */
    private val CURRENCY_LAST = Regex("(?i)($NUMBER)\\s*(?:/-)?\\s*((?<![A-Za-z])(?:bdt|taka|টাকা|tk|usd|inr|eur|gbp|aed|sar|myr|sgd|cad|aud|pkr)(?![A-Za-z]))")

    private fun currencyCode(token: String): String {
        val lower = token.lowercase()
        return CURRENCY_ALIASES.firstOrNull { it.first == lower }?.second ?: "BDT"
    }

    private enum class Label { AMOUNT, BALANCE, LIMIT, FEE, CASHBACK, DUE }

    private data class AmountMatch(val value: Long, val currency: String, val index: Int, val end: Int, val label: Label)

    /** Words right before an amount that say what it is. */
    private val LABELS = listOf(
        Regex("""(?i)(?:\bbal(?:ance)?|\bavl\.?\s*bal\w*|ব্যালেন্স)\s*(?:is|was|of|now)?\s*[:=-]?\s*$""") to Label.BALANCE,
        Regex("""(?i)(?:\b(?:available|avl\.?|credit)\s+limit|\blimit)\s*(?:is|was|of|now)?\s*[:=-]?\s*$""") to Label.LIMIT,
        Regex("""(?i)\b(?:fee|fees|charge|charges|service\s+charge|vat|commission)\s*(?:is|of|amount)?\s*[:=-]?\s*$""") to Label.FEE,
        Regex("""(?i)\bcash\s*-?back\s*(?:of)?\s*[:=-]?\s*$""") to Label.CASHBACK,
        Regex("""(?i)\b(?:due|payable|outstanding|min(?:imum)?\.?\s*(?:amount\s*)?due)\s*(?:is|of)?\s*[:=-]?\s*$""") to Label.DUE,
    )

    private val CLAUSE = Regex("""[\n;]|[.,](?!\d)""")

    private fun labelBefore(text: String, index: Int): Label {
        val window = text.substring(maxOf(0, index - 36), index)
        // Only the current clause counts ("… successful. Balance Tk 12" labels 12, not the first amount).
        val clause = window.split(CLAUSE).last()
        for ((pattern, label) in LABELS) if (pattern.containsMatchIn(clause)) return label
        return Label.AMOUNT
    }

    private fun toMoney(raw: String): Long? = Money.parse(raw.replace(",", ""))

    private fun findAmounts(text: String): List<AmountMatch> {
        val found = mutableListOf<AmountMatch>()
        fun add(index: Int, end: Int, rawNumber: String, currencyToken: String, labelIndex: Int) {
            val value = toMoney(rawNumber) ?: return
            if (found.any { index < it.end && end > it.index }) return
            found += AmountMatch(value, currencyCode(currencyToken), index, end, labelBefore(text, labelIndex))
        }
        for (m in CURRENCY_FIRST.findAll(text)) add(m.range.first, m.range.last + 1, m.groupValues[2], m.groupValues[1], m.range.first)
        for (m in CURRENCY_LAST.findAll(text)) add(m.range.first, m.range.last + 1, m.groupValues[1], m.groupValues[2], m.range.first)
        return found.sortedBy { it.index }
    }

    /** A balance without a currency, e.g. "Avl Bal: 12,345.67" (never a date or time after it). */
    private val UNANCHORED_BALANCE =
        Regex("""(?i)(?:\bbal(?:ance)?|\bavl\.?\s*bal\w*|ব্যালেন্স)\s*(?:is|was|of|now)?\s*[:=-]?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d:/-])""")

    /** Amount without a currency, e.g. "debited by 500.00" or "Amount: 500". */
    private val UNANCHORED_AMOUNT =
        Regex("""(?i)\b(?:amount|amt|debited\s+(?:by|with|for)|credited\s+(?:by|with)|withdrawn|deposited|paid|received|sent)\s*(?:of)?\s*[:=-]?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d:/-])""")

    // ---- Direction and channel ---------------------------------------------

    private class Rule(val pattern: Regex, val direction: Direction, val weight: Int)

    private val DIRECTION_RULES = listOf(
        Rule(Regex("""(?i)\b(?:has|have)\s+been\s+debited\b|\bis\s+debited\b|\bdebited\s+(?:by|with|for|from)\b"""), Direction.DEBIT, 5),
        Rule(Regex("""(?i)\b(?:has|have)\s+been\s+credited\b|\bis\s+credited\b|\bcredited\s+(?:by|with|to|into|in)\b"""), Direction.CREDIT, 5),
        Rule(Regex("""(?i)\bdebited\b|\bdebit\s+alert\b"""), Direction.DEBIT, 3),
        Rule(Regex("""(?i)\bcredited\b|\bcredit\s+alert\b"""), Direction.CREDIT, 3),
        Rule(Regex("""(?i)\bcash\s*-?\s*out\b"""), Direction.DEBIT, 4),
        Rule(Regex("""(?i)\bcash\s*-?\s*in\b"""), Direction.CREDIT, 4),
        Rule(Regex("""(?i)\b(?:you\s+have\s+)?received\b|\bmoney\s+received\b"""), Direction.CREDIT, 3),
        Rule(Regex("""(?i)\bsend\s+money\b|\byou\s+have\s+sent\b|\bsent\b"""), Direction.DEBIT, 3),
        Rule(Regex("""(?i)\bwithdrawn\b|\bwithdrawal\b|\bwithdraw\b"""), Direction.DEBIT, 3),
        Rule(Regex("""(?i)\bpurchase[ds]?\b|\bspent\b|\bpos\b|\bcharged\b|\bused\s+(?:for|at)\b"""), Direction.DEBIT, 3),
        Rule(Regex("""(?i)\bpayment\b|\bpaid\b|\bbill\s+pay(?:ment)?\b|\bbiller\b"""), Direction.DEBIT, 2),
        Rule(Regex("""(?i)\b(?:got|received|earned|won)\b(?:[^.\n]|\.\d){0,30}\bcash\s*-?\s*back\b"""), Direction.CREDIT, 5),
        Rule(Regex("""(?i)\bdeposit(?:ed)?\b"""), Direction.CREDIT, 3),
        Rule(Regex("""(?i)\brefund(?:ed)?\b|\breversal\b|\breversed\b"""), Direction.CREDIT, 3),
        Rule(Regex("""(?i)\badd(?:ed)?\s+money\b|\badded\s+to\b"""), Direction.CREDIT, 3),
        Rule(Regex("""(?i)\bsalary\b|\bremittance\b|\binterest\b|\bprofit\s+(?:paid|credited)\b"""), Direction.CREDIT, 2),
        Rule(Regex("""(?i)\brecharge[ds]?\b|\btop\s*-?\s*up\b|\bflexiload\b"""), Direction.DEBIT, 2),
        Rule(Regex("""(?i)\bcash\s*-?\s*back\b"""), Direction.CREDIT, 1),
        Rule(Regex("""(?i)\bfrom\s+(?:your|ur)\s+(?:a\/c|acc(?:oun)?t|card|wallet)\b"""), Direction.DEBIT, 3),
        Rule(Regex("""(?i)\b(?:to|into|in)\s+(?:your|ur)\s+(?:a\/c|acc(?:oun)?t|card|wallet)\b"""), Direction.CREDIT, 3),
        Rule(Regex("""(?i)\binward\b|\bincoming\b"""), Direction.CREDIT, 2),
        Rule(Regex("""(?i)\boutward\b|\boutgoing\b"""), Direction.DEBIT, 2),
        Rule(Regex("""(?<![A-Za-z])(?:dr)(?![A-Za-z])\.?"""), Direction.DEBIT, 2),
        Rule(Regex("""(?<![A-Za-z])(?:cr)(?![A-Za-z])\.?"""), Direction.CREDIT, 2),
        Rule(Regex("""জমা|পেয়েছেন|পেয়েছেন|প্রাপ্ত|গ্রহণ করেছেন|ক্রেডিট"""), Direction.CREDIT, 3),
        Rule(Regex("""উত্তোলন|খরচ|পরিশোধ|পাঠানো|পাঠিয়েছেন|পাঠিয়েছেন|কর্তন|ডেবিট"""), Direction.DEBIT, 3),
    )

    private fun detectDirection(text: String, amountIndex: Int): Pair<Direction?, Double> {
        var debit = 0.0
        var credit = 0.0
        for (rule in DIRECTION_RULES) {
            for (match in rule.pattern.findAll(text)) {
                // Keywords close to the amount say more than ones in a trailing sentence.
                val near = amountIndex < 0 || kotlin.math.abs(match.range.first - amountIndex) <= 60
                val score = rule.weight * (if (near) 1.5 else 1.0)
                if (rule.direction == Direction.DEBIT) debit += score else credit += score
            }
        }
        if (debit == credit) return null to 0.0
        return (if (debit > credit) Direction.DEBIT else Direction.CREDIT) to kotlin.math.abs(debit - credit)
    }

    private val CHANNEL_RULES = listOf(
        Regex("""(?i)\batm\b|cash\s+withdrawal""") to Channel.ATM,
        Regex("""(?i)\bcash\s*-?\s*out\b""") to Channel.CASH_OUT,
        Regex("""(?i)\bcash\s*-?\s*in\b""") to Channel.CASH_IN,
        Regex("""(?i)\badd(?:ed)?\s+money\b|\bi-?banking\b|internet\s+banking|\b(?:bank|card)\s+to\s+(?:bkash|nagad|rocket|upay|wallet)\b""") to Channel.ADD_MONEY,
        Regex("""(?i)\bsalary\b|\bpayroll\b""") to Channel.SALARY,
        Regex("""(?i)\brefund(?:ed)?\b|\breversal\b|\breversed\b""") to Channel.REFUND,
        Regex("""(?i)\bremittance\b|\bwage\s+earner\b""") to Channel.REMITTANCE,
        Regex("""(?i)\binterest\b|\bprofit\s+(?:paid|credited)\b|\bmudaraba\s+profit\b""") to Channel.INTEREST,
        Regex("""(?i)\b(?:got|received|earned|won)\b(?:[^.\n]|\.\d){0,30}\bcash\s*-?\s*back\b|\bcash\s*-?\s*back\b(?:[^.\n]|\.\d){0,30}\b(?:credited|added)\b""") to Channel.CASHBACK,
        Regex("""(?i)\brecharge[ds]?\b|\btop\s*-?\s*up\b|\bairtime\b|\bflexiload\b""") to Channel.RECHARGE,
        Regex("""(?i)\bbill\b|\butility\b|\bdesco\b|\bdpdc\b|\bwasa\b|\btitas\b|\bnesco\b|\bpalli\s+bidyut\b|\belectricity\b""") to Channel.BILL,
        Regex("""(?i)\bsend\s+money\b|\bsent\s+to\b|\byou\s+have\s+sent\b|\bmoney\s+sent\b""") to Channel.SEND_MONEY,
        Regex("""(?i)\bpayment\b|\bpaid\b|\bpurchase[ds]?\b|\bpos\b|\bmerchant\b|\bused\s+(?:for|at)\b|\bspent\b|\bcharged\b|\be-?commerce\b""") to Channel.PAYMENT,
        Regex("""(?i)\bcash\s*-?\s*back\b""") to Channel.CASHBACK,
        Regex("""(?i)\btransfer(?:red)?\b|\bnpsb\b|\bbeftn\b|\brtgs\b|\bfund\s+trf\b|\btrf\b""") to Channel.TRANSFER,
        Regex("""(?i)\bdeposit(?:ed)?\b""") to Channel.DEPOSIT,
        Regex("""(?i)\breceived\b|\bcredited\b|\bdeposit(?:ed)?\b|জমা|পেয়েছেন|পেয়েছেন|ক্রেডিট""") to Channel.RECEIVED,
        Regex("""(?i)\bdebited\b|\bwithdrawn\b|উত্তোলন|খরচ|পরিশোধ|ডেবিট|কর্তন""") to Channel.DEBITED,
    )

    private fun detectChannel(text: String): Channel = CHANNEL_RULES.firstOrNull { it.first.containsMatchIn(text) }?.second ?: Channel.UNKNOWN

    // ---- Dates and times -------------------------------------------------------

    private val MONTHS = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
    private const val MONTH = """(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?"""

    private class DatePattern(val pattern: Regex, val read: (MatchResult) -> IntArray, val numeric: Boolean = false)

    private fun monthOf(word: String) = MONTHS.indexOf(word.take(3).lowercase()) + 1

    // Each read gives (year or -1, month, day).
    private val DATE_PATTERNS = listOf(
        // 2026-09-28
        DatePattern(Regex("""(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)"""), { m -> intArrayOf(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt()) }),
        // 28/09/2026, 28-09-26, 28.09.2026 (day first, as banks in Bangladesh write it)
        DatePattern(Regex("""(?<!\d|\d[.,])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d|[.,]\d)"""), { m -> intArrayOf(m.groupValues[3].toInt(), m.groupValues[2].toInt(), m.groupValues[1].toInt()) }, numeric = true),
        // 28-SEP-26, 28 Sep 2026, 28SEP2026, 28th September
        DatePattern(Regex("""(?i)(?<!\d)(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*$MONTH(?:[\s\-/.,']*(\d{4}|\d{2}))?(?![\d:])"""), { m ->
            intArrayOf(m.groupValues[3].ifEmpty { "-1" }.toInt(), monthOf(m.groupValues[2]), m.groupValues[1].toInt())
        }),
        // Sep 28, 2026
        DatePattern(Regex("""(?i)\b$MONTH\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b"""), { m -> intArrayOf(m.groupValues[3].toInt(), monthOf(m.groupValues[1]), m.groupValues[2].toInt()) }),
    )

    private fun resolveYear(y: Int, month: Int, day: Int, today: String): Int {
        val current = today.take(4).toInt()
        if (y < 0) {
            // No year: the most recent such date that isn't in the future.
            val candidate = Dates.of(current, month, day)
            return if (candidate > Dates.addDays(today, 1)) current - 1 else current
        }
        return if (y < 100) 2000 + y else y
    }

    private fun findDate(text: String, today: String): String? {
        for (p in DATE_PATTERNS) {
            val match = p.pattern.find(text) ?: continue
            var (y, m, d) = p.read(match).let { Triple(it[0], it[1], it[2]) }
            // 09/28/2026 can only be month-first.
            if (p.numeric && m > 12 && d <= 12) m = d.also { d = m }
            if (m < 1 || m > 12) continue
            y = resolveYear(y, m, d, today)
            val date = Dates.of(y, m, d)
            if (Dates.isValid(date)) return date
        }
        return null
    }

    private val TIME = Regex("""(?i)(?<![\d:.])([01]?\d|2[0-3])[:.]([0-5]\d)(?:[:.]([0-5]\d))?(?:\s*([ap])\.?\s*m\.?\b)?(?![\d:])""")
    private val AT_BEFORE = Regex("""(?i)\bat\s*$""")

    private fun findTime(text: String): String? {
        for (match in TIME.findAll(text)) {
            val dotted = !match.value.contains(":")
            val meridiem = match.groupValues[4].lowercase()
            // "14.30" only counts with am/pm or right after "at"; otherwise it's probably an amount.
            if (dotted && meridiem.isEmpty() && !AT_BEFORE.containsMatchIn(text.substring(maxOf(0, match.range.first - 4), match.range.first))) continue
            var hour = match.groupValues[1].toInt()
            val minute = match.groupValues[2]
            if (meridiem.isNotEmpty()) {
                if (hour < 1 || hour > 12) continue
                if (meridiem == "p" && hour != 12) hour += 12
                if (meridiem == "a" && hour == 12) hour = 0
            }
            return "%02d:%s".format(hour, minute)
        }
        return null
    }

    // ---- Accounts, references, counterparties --------------------------------

    private val ACCOUNT_REF =
        Regex("""(?i)\b(?:a\/c|acc(?:oun)?t|card)\.?\s*(?:no\.?|number|#)?\s*(?:ending\s*(?:with|in)?\s*)?[:#-]?\s*([0-9Xx*•.\-]{0,20}?)(\d{3,4})(?![\dXx*•]|[.\-][\dXx*•])""")
    private val CARD_ENDING = Regex("""(?i)\bending\s*(?:with|in)?\s*[:#-]?\s*[Xx*•]*(\d{3,4})(?!\d)""")
    private val YOUR_BEFORE = Regex("""(?i)\byour\s*$""")
    private val MOVED_BEFORE = Regex("""(?i)\b(?:debited|credited|withdrawn|deposited|charged|deducted)\s+(?:from|to|into|in)\s*$""")
    private val THEIRS_BEFORE = Regex("""(?i)\b(?:from|to|sender|receiver|beneficiary)\s*$""")
    private val MOBILE = Regex("""^01\d{9}$""")

    private fun findAccountDigits(text: String, walletAlert: Boolean): Pair<String?, String?> {
        var own: String? = null
        var other: String? = null
        for (match in ACCOUNT_REF.findAll(text)) {
            val before = text.substring(maxOf(0, match.range.first - 24), match.range.first)
            val yours = YOUR_BEFORE.containsMatchIn(before) || MOVED_BEFORE.containsMatchIn(before)
            val theirs = !yours && THEIRS_BEFORE.containsMatchIn(before)
            // A full mobile number after "A/C" is the other party's wallet, not a masked account.
            val full = (match.groupValues[1] + match.groupValues[2]).filter { it.isDigit() }
            if (theirs || MOBILE.matches(full)) {
                if (other == null) other = match.groupValues[2]
            } else if (!walletAlert || yours) {
                // Wallet alerts only show your own number as "your A/C"; other numbers are billers' customer ids.
                if (own == null) own = match.groupValues[2]
            }
        }
        if (own == null) own = CARD_ENDING.find(text)?.groupValues?.get(1)
        return own to other
    }

    private val REFERENCE =
        Regex("""(?i)\b(?:trx\s*id|txn\s*id|trxid|txnid|tran(?:s(?:action)?)?\s*id|ref(?:erence)?\s*(?:no|number|#)|rrn|approval\s*code)\.?\s*[:#-]?\s*([A-Z0-9]{5,24})\b""")

    private val PHONE = Regex("""(?:\+?88)?01[3-9]\d{8}\b""")

    /** Words that end a name ("Daraz on 28 Sep", "01712345678 successful"). */
    private const val NAME_END =
        """(?=\s*(?:\(|\)|,|;|\n|\.(?:\s|$)|$|\s+(?:on|at|is|was|has|successful(?:ly)?|ref|txn|trx|trxid|txnid|fee|bal|balance|avl|available|limit|via|from|for|with|dated|date)\b))"""
    private const val NAME = """([A-Za-z0-9+][A-Za-z0-9&@.'’\-/ ]{0,48}?)"""

    private enum class Role { TO, FROM, AT, LABEL }

    private val COUNTERPARTY_PATTERNS = listOf(
        Regex("""(?i)\b(?:merchant|receiver|recipient|payee|beneficiary|biller|sender|agent)(?:\s+name)?\s*[:-]\s*$NAME$NAME_END""") to Role.LABEL,
        Regex("""(?i)(?:\b(?:at|pos(?:\s+purchase)?(?:\s+at)?)\s+|\bpos\s*[/:-]\s*|@\s+)$NAME$NAME_END""") to Role.AT,
        Regex("""(?i)\bto\s+(?:a\/c\s*[:#]?\s*)?$NAME$NAME_END""") to Role.TO,
        Regex("""(?i)\bfrom\s+(?:a\/c\s*[:#]?\s*)?$NAME$NAME_END""") to Role.FROM,
    )

    private val NOT_A_NAME =
        Regex("""(?i)^(?:your|ur|you|the|a\/c|acc(?:oun)?t|card|wallet|bank|atm|agent|mobile|account|tk|bdt|taka)\b|^\d{1,2}[/.:-]\d{1,2}|^\d{1,2}\s*(?:am|pm)\b|^\d{1,2}(?:st|nd|rd|th)?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)""")
    private val DOMAIN = Regex("""(?i)^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|bd|xyz)$""")

    /** "DARAZ BD" → "Daraz BD", "NETFLIX.COM" → "netflix.com"; short words stay as written (KFC, BD). */
    private fun tidyName(name: String): String {
        val cleaned = name
            .replace(Regex("""\s+"""), " ")
            .replace(Regex("""[\s.,:;'’\-/]+$"""), "")
            .replace(Regex("""^[\s.,:;'’\-/]+"""), "")
            .trim()
        if (DOMAIN.matches(cleaned)) return cleaned.lowercase()
        if (cleaned != cleaned.uppercase() || !cleaned.any { it in 'A'..'Z' }) return cleaned
        return cleaned.replace(Regex("[A-Z][A-Z]{3,}")) { it.value[0] + it.value.substring(1).lowercase() }
    }

    private fun findCounterparty(text: String, direction: Direction?): String? {
        for ((pattern, role) in COUNTERPARTY_PATTERNS) {
            if (direction == Direction.CREDIT && role == Role.TO) continue
            if (direction == Direction.DEBIT && role == Role.FROM) continue
            val match = pattern.find(text) ?: continue
            val name = tidyName(match.groupValues[1])
            if (name.length < 2 || NOT_A_NAME.containsMatchIn(name) || (!name.any { it.isLetter() && it.code < 128 } && !PHONE.containsMatchIn(name))) continue
            val phone = PHONE.find(name)
            return if (phone != null && name.count { it.isDigit() } >= 11) phone.value.replace(Regex("""^\+?88"""), "") else name
        }
        return null
    }

    // ---- Messages that aren't transactions -------------------------------------

    private val OTP = Regex("""(?i)\b(?:otp|one[\s-]?time\s*(?:pass(?:word|code)?|pin|code)|verification\s*code|security\s*code|passcode|auth(?:entication)?\s*code)\b""")
    private val FAILED = Regex("""(?i)\b(?:failed|unsuccessful|declined|insufficient|not\s+successful|could\s*n[o']t|rejected|unable\s+to)\b""")
    private val REFUNDED = Regex("""(?i)\brefund|\breversed|\bcredited\b""")
    private val REMINDER =
        Regex("""(?i)\b(?:will\s+be\s+(?:debited|deducted|charged|credited)|due\s+date|payment\s+due|min(?:imum)?\.?\s*(?:amount\s*)?due|total\s+due|statement|upcoming|reminder|pay\s+by|is\s+due|please\s+pay)\b""")
    private val DONE = Regex("""(?i)\b(?:has|have)\s+been\s+(?:debited|credited)\b""")
    private val PROMO_MARKERS =
        Regex("""(?i)\b(?:offer|discount|win|lucky|campaign|avail|enjoy|promo|coupon|voucher|click|download|hurry|register|subscribe|t&c|conditions\s+apply|get\s+up\s+to|up\s+to\s+\d+%|\d+%\s*(?:off|cash\s*back|discount))\b|https?:\/\/|www\.|\.com\/|dial\s*\*""")
    private val COMPLETED =
        Regex("""(?i)\b(?:debited|credited|received|you\s+have\s+sent|send\s+money|cash\s*-?\s*(?:out|in)|withdrawn|trx\s*id|txn\s*id|trxid|txnid|purchase\s+of|spent|charged|payment\s+(?:of\s+)?(?:tk|bdt)?\s*[\d,.]+[^.]{0,40}successful)\b""")

    private fun ignoreReason(text: String, hasAmount: Boolean): IgnoreReason? {
        if (OTP.containsMatchIn(text)) return IgnoreReason.OTP
        if (FAILED.containsMatchIn(text) && !REFUNDED.containsMatchIn(text)) return IgnoreReason.FAILED
        if (REMINDER.containsMatchIn(text) && !DONE.containsMatchIn(text)) return IgnoreReason.REMINDER
        if (PROMO_MARKERS.findAll(text).count() >= 2 && !COMPLETED.containsMatchIn(text)) return IgnoreReason.PROMO
        if (!hasAmount) return IgnoreReason.NO_AMOUNT
        return null
    }

    // ---- Descriptions and categories ---------------------------------------------

    private val MERCHANT_CATEGORIES = listOf(
        Regex("""(?i)food\s*panda|pathao\s*food|hungry\s*naki|\bkfc\b|pizza|burger|restaurant|\bcafe\b|coffee|bakery|sweets|biryani|kacchi|chillox|domino|mcdonald|star\s*kabab|dine""") to listOf("Food", "Dining", "Restaurants"),
        Regex("""(?i)chaldal|shwapno|swapno|\bagora\b|meena\s*bazar|unimart|super\s*shop|grocer""") to listOf("Groceries", "Food"),
        Regex("""(?i)\buber\b|pathao|obhai|shohoz|\bbus\b|railway|\btrain\b|biman|us-?bangla|novoair|air\s*astra|\bfuel\b|petrol|octane|\bcng\b|parking|\btoll\b|metro\s*rail|rapid\s*pass""") to listOf("Transport"),
        Regex("""(?i)netflix|spotify|youtube|google|apple\.com|itunes|icloud|openai|chatgpt|microsoft|adobe|canva|hoichoi|chorki|\bbongo\b|prime\s*video|disney|github|notion|patreon""") to listOf("Subscriptions"),
        Regex("""(?i)daraz|aarong|\bbata\b|\bapex\b|yellow|ecstasy|rokomari|amazon|aliexpress|fashion|\bmall\b|lifestyle|sailor|richman|le\s*reve|shopping""") to listOf("Shopping"),
        Regex("""(?i)star\s*tech|ryans|techland|gadget|computer|electronics|walton|samsung|xiaomi""") to listOf("Technology"),
        Regex("""(?i)pharma|pharmacy|hospital|clinic|diagnostic|medical|medicine|labaid|popular\s*diag|ibn\s*sina|evercare|\bdoctor\b|health""") to listOf("Medical"),
        Regex("""(?i)school|college|university|tuition|coursera|udemy|10\s*minute\s*school|exam\s*fee|admission""") to listOf("Education"),
        Regex("""(?i)cineplex|cinema|blockbuster|\bsteam\b|playstation|\bgame\b|concert""") to listOf("Entertainment"),
        Regex("""(?i)\brent\b|house\s*rent|flat\s*rent""") to listOf("Housing", "Rent"),
        Regex("""(?i)desco|dpdc|wasa|titas|nesco|bpdb|palli\s*bidyut|electricity|gas\s*bill|water\s*bill|internet|broadband|link3|amber\s*it|carnival|grameenphone|\brobi\b|banglalink|teletalk|airtel""") to listOf("Bills", "Utilities"),
    )

    val FEE_CATEGORY_HINTS = listOf("Fees", "Fees & charges", "Charges", "Bank charges", "Bank fees", "Other")

    private fun categoryHintsFor(channel: Channel, direction: Direction?, counterparty: String?, text: String): List<String> {
        if (direction == Direction.CREDIT) {
            return when (channel) {
                Channel.SALARY -> listOf("Salary")
                Channel.INTEREST -> listOf("Investment", "Interest")
                Channel.REMITTANCE -> listOf("Remittance", "Gifts", "Other")
                else -> listOf("Other")
            }
        }
        val subject = "${counterparty ?: ""} $text"
        for ((pattern, hints) in MERCHANT_CATEGORIES) if (pattern.containsMatchIn(subject)) return hints
        return when (channel) {
            Channel.RECHARGE -> listOf("Mobile & internet", "Mobile", "Phone", "Bills")
            Channel.BILL -> listOf("Bills", "Utilities")
            else -> listOf("Other")
        }
    }

    private val CASH = Regex("""(?i)\bcash\b""")

    private fun describe(channel: Channel, direction: Direction?, who: String?, provider: Provider?, otherProvider: Provider?, isCard: Boolean, text: String): String =
        when (channel) {
            Channel.ATM -> "ATM withdrawal"
            Channel.CASH_OUT -> "Cash out"
            Channel.CASH_IN -> "Cash in"
            Channel.ADD_MONEY -> if (otherProvider != null) "Add money from ${otherProvider.name}" else "Add money"
            Channel.SALARY -> if (who != null) "Salary — $who" else "Salary"
            Channel.REFUND -> if (who != null) "Refund from $who" else "Refund"
            Channel.CASHBACK -> "Cashback"
            Channel.REMITTANCE -> if (who != null) "Remittance from $who" else "Remittance"
            Channel.INTEREST -> "Interest"
            Channel.RECHARGE -> if (who != null) "Mobile recharge $who" else "Mobile recharge"
            Channel.BILL -> if (who != null) "$who bill" else "Bill payment"
            Channel.SEND_MONEY -> if (who != null) "Sent to $who" else "Send money"
            Channel.PAYMENT -> who ?: if (isCard) "Card payment" else "Payment"
            Channel.DEPOSIT -> if (CASH.containsMatchIn(text)) "Cash deposit" else if (who != null) "Deposit from $who" else "Deposit"
            Channel.TRANSFER -> if (direction == Direction.CREDIT) (if (who != null) "Transfer from $who" else "Transfer received") else (if (who != null) "Transfer to $who" else "Fund transfer")
            Channel.RECEIVED -> if (who != null) "Received from $who" else "Money received"
            Channel.DEBITED -> who ?: if (provider != null) "${provider.name} debit" else "Debit"
            Channel.UNKNOWN -> who ?: if (provider != null) "${provider.name} transaction" else "SMS transaction"
        }

    // ---- Entry points ---------------------------------------------------------------

    private val CARD = Regex("""(?i)\b(?:card|visa|master\s*card|mastercard|amex|unionpay)\b""")

    /**
     * Read one message. `today` is the person's date (for dates written
     * without a year); `receivedAt`, for a message the phone received, dates
     * and times a message that states neither.
     */
    fun parse(input: String, today: String, receivedAt: ReceivedAt? = null): ParsedSms {
        val text = normalize(input)
        val amounts = findAmounts(text)
        val channel = detectChannel(text)
        // In a "you got cashback" alert, the cashback is the transaction.
        val primary = amounts.firstOrNull { it.label == Label.AMOUNT } ?: if (channel == Channel.CASHBACK) amounts.firstOrNull { it.label == Label.CASHBACK } else null

        var amount = primary?.value
        var amountIndex = primary?.index ?: -1
        var currency = primary?.currency
        var anchored = primary != null
        if (primary == null) {
            val loose = UNANCHORED_AMOUNT.find(text)
            val value = loose?.let { toMoney(it.groupValues[1]) }
            if (loose != null && value != null && value > 0) {
                amount = value
                amountIndex = loose.range.first
                currency = amounts.firstOrNull()?.currency
                anchored = false
            }
        }
        if (amount == 0L) amount = null

        val feeTotal = amounts.filter { it.label == Label.FEE }.sumOf { it.value }
        val fee = feeTotal.takeIf { it > 0 }
        // The figure after the transaction amount, if there are several.
        fun reported(label: Label) = amounts.firstOrNull { it.label == label && it.index > amountIndex } ?: amounts.firstOrNull { it.label == label }
        var balance: Pair<Long, String>? = reported(Label.BALANCE)?.let { it.value to it.currency }
        if (balance == null) {
            // "Bal: 12,345.67" — the message's own currency.
            val bare = UNANCHORED_BALANCE.find(text)
            val value = bare?.let { toMoney(it.groupValues[1]) }
            if (value != null) balance = value to (currency ?: "BDT")
        }
        val limit = reported(Label.LIMIT)?.value

        val (direction, margin) = detectDirection(text, amountIndex)
        val (provider, otherProvider) = Providers.detect(text)
        val (accountDigits, counterpartyDigits) = findAccountDigits(text, provider?.kind == io.github.fr_ost.hisab.core.AccountType.MOBILE_WALLET)
        val counterparty = findCounterparty(text, direction)
        val reference = REFERENCE.find(text)?.groupValues?.get(1)
        // "28 Sep" in a message received last year is last year's.
        val stated = findDate(text, if (receivedAt != null && receivedAt.date < today) receivedAt.date else today)
        val date = stated ?: receivedAt?.date
        val time = findTime(text) ?: if (receivedAt != null && date == receivedAt.date) receivedAt.time else null
        val isCard = CARD.containsMatchIn(text)
        val ignored = ignoreReason(text, amount != null)

        val confidence = when {
            ignored == null && amount != null && anchored && direction != null && margin >= 3 && date != null && (provider != null || accountDigits != null) -> Confidence.HIGH
            ignored == null && amount != null && direction != null -> Confidence.MEDIUM
            else -> Confidence.LOW
        }

        return ParsedSms(
            text = input.trim(),
            direction = direction,
            channel = channel,
            amount = amount,
            currency = currency,
            fee = fee,
            balance = balance?.first,
            balanceCurrency = balance?.second,
            limit = limit,
            provider = provider,
            otherProvider = otherProvider,
            accountDigits = accountDigits,
            counterpartyDigits = counterpartyDigits,
            isCard = isCard,
            date = date,
            time = time,
            counterparty = counterparty,
            reference = reference,
            description = describe(channel, direction, counterparty, provider, otherProvider, isCard, text).take(140),
            categoryHints = categoryHintsFor(channel, direction, counterparty, text),
            ignored = ignored,
            confidence = confidence,
        )
    }

    /** A line that is a whole transaction alert on its own (so several can be pasted line by line). */
    private fun isStandaloneAlert(line: String): Boolean {
        val primary = findAmounts(line).firstOrNull { it.label == Label.AMOUNT } ?: return false
        return detectDirection(line, primary.index).first != null
    }

    /**
     * Split pasted text into messages: blank lines always separate messages, and
     * a block whose every line is a complete alert is split line by line. Bank
     * alerts that wrap over several lines stay together.
     */
    fun splitMessages(input: String, limit: Int = 50): List<String> {
        val blocks = input.replace(Regex("\r\n?"), "\n").split(Regex("""\n[ \t]*\n+""")).map { it.trim() }.filter { it.isNotEmpty() }
        val messages = mutableListOf<String>()
        for (block in blocks) {
            val lines = block.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
            if (lines.size > 1 && lines.all { isStandaloneAlert(normalize(it)) }) messages += lines else messages += block
        }
        return messages.take(limit)
    }
}
