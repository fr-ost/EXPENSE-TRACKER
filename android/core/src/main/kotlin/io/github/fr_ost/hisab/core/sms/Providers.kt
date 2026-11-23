package io.github.fr_ost.hisab.core.sms

import io.github.fr_ost.hisab.core.AccountType

/**
 * Banks and mobile wallets whose SMS alerts Hisab recognises (the website's
 * src/lib/sms/providers.ts). Detection uses the name in the message first,
 * then a few well-known message shapes for wallets whose alerts never
 * mention their own name.
 */
data class Provider(
    val id: String,
    val name: String,
    val kind: AccountType,
    /** Matched against the message. Longer, more specific names come first in the list. */
    val pattern: Regex,
    /** Lower-case fragments that identify this provider in an account name, e.g. "City Bank 4567". */
    val aliases: List<String>,
)

object Providers {
    val ALL: List<Provider> = listOf(
        Provider("bkash", "bKash", AccountType.MOBILE_WALLET, Regex("(?i)\\bb[\\s-]?kash\\b|বিকাশ"), listOf("bkash", "b kash", "বিকাশ")),
        Provider("nagad", "Nagad", AccountType.MOBILE_WALLET, Regex("(?i)\\bnagad\\b|নগদ"), listOf("nagad", "নগদ")),
        Provider("rocket", "Rocket", AccountType.MOBILE_WALLET, Regex("(?i)\\brocket\\b|dbbl\\s+mobile\\s+banking|রকেট"), listOf("rocket", "রকেট")),
        Provider("upay", "Upay", AccountType.MOBILE_WALLET, Regex("(?i)\\bupay\\b|উপায়"), listOf("upay", "উপায়")),
        Provider("cellfin", "CellFin", AccountType.MOBILE_WALLET, Regex("(?i)\\bcellfin\\b"), listOf("cellfin")),
        Provider("tap", "Tap", AccountType.MOBILE_WALLET, Regex("(?i)\\btrust\\s+axiata\\b|\\btap\\s+(wallet|account)\\b"), listOf("tap", "trust axiata")),
        Provider("okwallet", "OK Wallet", AccountType.MOBILE_WALLET, Regex("(?i)\\bok\\s*wallet\\b"), listOf("ok wallet", "okwallet")),
        Provider("surecash", "SureCash", AccountType.MOBILE_WALLET, Regex("(?i)\\bsure\\s*cash\\b"), listOf("surecash", "sure cash")),
        Provider("mcash", "mCash", AccountType.MOBILE_WALLET, Regex("(?i)\\bm[\\s-]?cash\\b"), listOf("mcash", "m-cash")),
        Provider("sibl", "Social Islami Bank", AccountType.BANK, Regex("(?i)social\\s+islami|\\bsibl\\b"), listOf("social islami", "sibl")),
        Provider("fsibl", "First Security Islami Bank", AccountType.BANK, Regex("(?i)first\\s+security|\\bfsibl\\b"), listOf("first security", "fsibl")),
        Provider("sjibl", "Shahjalal Islami Bank", AccountType.BANK, Regex("(?i)shahjalal|\\bsjibl\\b"), listOf("shahjalal", "sjibl")),
        Provider("gib", "Global Islami Bank", AccountType.BANK, Regex("(?i)global\\s+islami"), listOf("global islami")),
        Provider("aibl", "Al-Arafah Islami Bank", AccountType.BANK, Regex("(?i)al[\\s-]?arafah|\\baibl\\b"), listOf("al-arafah", "al arafah", "alarafah", "aibl")),
        Provider("ibbl", "Islami Bank", AccountType.BANK, Regex("(?i)islami\\s+bank|\\bibbl\\b"), listOf("islami bank", "ibbl")),
        Provider("dbbl", "Dutch-Bangla Bank", AccountType.BANK, Regex("(?i)dutch[\\s-]?bangla|\\bdbbl\\b"), listOf("dbbl", "dutch-bangla", "dutch bangla")),
        Provider("city", "City Bank", AccountType.BANK, Regex("(?i)\\bcity\\s*bank\\b|\\bcbl\\b|\\bcitytouch\\b"), listOf("city bank", "citybank", "cbl")),
        Provider("brac", "BRAC Bank", AccountType.BANK, Regex("(?i)\\bbrac\\s*bank\\b|\\bastha\\b"), listOf("brac")),
        Provider("ebl", "Eastern Bank", AccountType.BANK, Regex("(?i)eastern\\s+bank|\\bebl\\b"), listOf("ebl", "eastern bank")),
        Provider("scb", "Standard Chartered", AccountType.BANK, Regex("(?i)standard\\s+chartered|\\bscb\\b|\\bstanchart\\b"), listOf("standard chartered", "scb", "stanchart")),
        Provider("hsbc", "HSBC", AccountType.BANK, Regex("(?i)\\bhsbc\\b"), listOf("hsbc")),
        Provider("citi", "Citibank", AccountType.BANK, Regex("(?i)\\bciti\\s*bank\\b|\\bcitibank\\b"), listOf("citibank", "citi bank")),
        Provider("mtb", "Mutual Trust Bank", AccountType.BANK, Regex("(?i)mutual\\s+trust|\\bmtb\\b"), listOf("mtb", "mutual trust")),
        Provider("ucb", "UCB", AccountType.BANK, Regex("(?i)united\\s+commercial|\\bucb\\b|\\bucbl\\b"), listOf("ucb", "united commercial")),
        Provider("prime", "Prime Bank", AccountType.BANK, Regex("(?i)\\bprime\\s*bank\\b"), listOf("prime")),
        Provider("pubali", "Pubali Bank", AccountType.BANK, Regex("(?i)\\bpubali\\b"), listOf("pubali")),
        Provider("sonali", "Sonali Bank", AccountType.BANK, Regex("(?i)\\bsonali\\b"), listOf("sonali")),
        Provider("janata", "Janata Bank", AccountType.BANK, Regex("(?i)\\bjanata\\b"), listOf("janata")),
        Provider("agrani", "Agrani Bank", AccountType.BANK, Regex("(?i)\\bagrani\\b"), listOf("agrani")),
        Provider("rupali", "Rupali Bank", AccountType.BANK, Regex("(?i)\\brupali\\b"), listOf("rupali")),
        Provider("bankasia", "Bank Asia", AccountType.BANK, Regex("(?i)\\bbank\\s*asia\\b"), listOf("bank asia", "bankasia")),
        Provider("abbank", "AB Bank", AccountType.BANK, Regex("(?i)\\bab\\s*bank\\b"), listOf("ab bank", "abbank")),
        Provider("ncc", "NCC Bank", AccountType.BANK, Regex("(?i)\\bncc\\s*bank\\b|\\bnccbl\\b"), listOf("ncc")),
        Provider("southeast", "Southeast Bank", AccountType.BANK, Regex("(?i)south\\s*east\\s+bank"), listOf("southeast", "south east")),
        Provider("onebank", "ONE Bank", AccountType.BANK, Regex("(?i)\\bone\\s*bank\\b"), listOf("one bank", "onebank")),
        Provider("trust", "Trust Bank", AccountType.BANK, Regex("(?i)\\btrust\\s*bank\\b"), listOf("trust bank")),
        Provider("mercantile", "Mercantile Bank", AccountType.BANK, Regex("(?i)\\bmercantile\\b"), listOf("mercantile")),
        Provider("jamuna", "Jamuna Bank", AccountType.BANK, Regex("(?i)\\bjamuna\\s*bank\\b"), listOf("jamuna")),
        Provider("premier", "Premier Bank", AccountType.BANK, Regex("(?i)\\bpremier\\s*bank\\b"), listOf("premier")),
        Provider("dhaka", "Dhaka Bank", AccountType.BANK, Regex("(?i)\\bdhaka\\s*bank\\b"), listOf("dhaka bank")),
        Provider("ific", "IFIC Bank", AccountType.BANK, Regex("(?i)\\bific\\b"), listOf("ific")),
        Provider("exim", "EXIM Bank", AccountType.BANK, Regex("(?i)\\bexim\\b"), listOf("exim")),
        Provider("uttara", "Uttara Bank", AccountType.BANK, Regex("(?i)\\buttara\\s*bank\\b"), listOf("uttara")),
        Provider("midland", "Midland Bank", AccountType.BANK, Regex("(?i)\\bmidland\\b"), listOf("midland")),
        Provider("nrbc", "NRBC Bank", AccountType.BANK, Regex("(?i)\\bnrbc\\b"), listOf("nrbc")),
        Provider("nrb", "NRB Bank", AccountType.BANK, Regex("(?i)\\bnrb\\s*bank\\b|\\bnrbbl\\b"), listOf("nrb bank")),
        Provider("sbac", "SBAC Bank", AccountType.BANK, Regex("(?i)\\bsbac\\b|south\\s+bangla"), listOf("sbac", "south bangla")),
        Provider("meghna", "Meghna Bank", AccountType.BANK, Regex("(?i)\\bmeghna\\s*bank\\b"), listOf("meghna")),
        Provider("modhumoti", "Modhumoti Bank", AccountType.BANK, Regex("(?i)\\bmodhumoti\\b"), listOf("modhumoti")),
        Provider("community", "Community Bank", AccountType.BANK, Regex("(?i)\\bcommunity\\s*bank\\b"), listOf("community")),
        Provider("basic", "BASIC Bank", AccountType.BANK, Regex("(?i)\\bbasic\\s*bank\\b"), listOf("basic bank")),
        Provider("padma", "Padma Bank", AccountType.BANK, Regex("(?i)\\bpadma\\s*bank\\b"), listOf("padma")),
        Provider("union", "Union Bank", AccountType.BANK, Regex("(?i)\\bunion\\s*bank\\b"), listOf("union bank")),
        Provider("bkb", "Bangladesh Krishi Bank", AccountType.BANK, Regex("(?i)krishi\\s+bank|\\bbkb\\b"), listOf("krishi", "bkb")),
    )

    /**
     * Wallets whose alerts don't name themselves, recognised by message shape:
     * bKash ends with "TrxID ABC123XYZ9 at 28/09/2026 14:30", Nagad lists
     * "TxnID: 7A1B2C3D" beside "Balance: Tk", Rocket uses "TxnId:123 Date:28-SEP-26".
     */
    private val SIGNATURES = listOf(
        "bkash" to Regex("""(?i)\bTrxID\s*:?\s*[A-Z0-9]{8,12}\s+at\s+\d{1,2}/\d{1,2}/\d{4}"""),
        "rocket" to Regex("""(?i)\bTxnId\s*:\s*\d{6,}.{0,40}\bDate\s*:\s*\d{1,2}-[A-Z]{3}-\d{2}"""),
        "nagad" to Regex("""(?i)\bTxnID\s*:\s*[A-Z0-9]{6,12}\b[\s\S]{0,80}\bBalance\s*:\s*Tk"""),
    )

    fun byId(id: String): Provider? = ALL.firstOrNull { it.id == id }

    private val OTHER_SIDE = Regex("""(?i)\b(?:from|to|into|via|with|through)\s+(?:your\s+|the\s+|a\s+)?$""")

    /**
     * The bank or wallet a message comes from, and any other one it names.
     * "…from City Bank" in a bKash alert names the other side, so names right
     * after from/to/via don't count as the sender; a known message shape wins.
     */
    fun detect(text: String): Pair<Provider?, Provider?> {
        data class Mention(val provider: Provider, val start: Int, val end: Int)
        val mentions = mutableListOf<Mention>()
        for (provider in ALL) {
            val match = provider.pattern.find(text) ?: continue
            val span = Mention(provider, match.range.first, match.range.last + 1)
            // "Social Islami Bank" must not also count as "Islami Bank".
            if (mentions.none { span.start < it.end && span.end > it.start }) mentions += span
        }
        mentions.sortBy { it.start }
        fun namesOtherSide(index: Int) = OTHER_SIDE.containsMatchIn(text.substring(maxOf(0, index - 18), index))
        val signature = SIGNATURES.firstOrNull { it.second.containsMatchIn(text) }
        val provider = signature?.let { byId(it.first) } ?: mentions.firstOrNull { !namesOtherSide(it.start) }?.provider
        val other = mentions.firstOrNull { it.provider.id != provider?.id }?.provider
        return provider to other
    }
}
