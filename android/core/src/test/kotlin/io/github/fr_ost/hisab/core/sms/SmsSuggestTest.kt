package io.github.fr_ost.hisab.core.sms

import io.github.fr_ost.hisab.core.Account
import io.github.fr_ost.hisab.core.AccountType
import io.github.fr_ost.hisab.core.Category
import io.github.fr_ost.hisab.core.CategoryKind
import io.github.fr_ost.hisab.core.EntryType
import io.github.fr_ost.hisab.core.ExpenseScope
import io.github.fr_ost.hisab.core.Money
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The phone suggests the same entry as the website for every message: the
 * fixture (src/test/resources/sms-suggest.json) holds what the website's
 * suggestFromSms (src/components/sms/sms-suggest.ts) made of every message in
 * the parser corpus, for two sets of accounts and categories and with
 * earlier entries to learn from.
 */
class SmsSuggestTest {
    private val fixture = Json.parseToJsonElement(javaClass.getResource("/sms-suggest.json")!!.readText()).jsonObject

    private fun account(id: String, name: String, type: AccountType, currency: String = "BDT", isActive: Boolean = true) =
        Account(id, name, type, currency, 0, "2025-01-01", isActive = isActive, createdAt = 1)

    private fun category(id: String, name: String, kind: CategoryKind, scope: ExpenseScope? = null, archived: Boolean = false) =
        Category(id, name, kind, scope, isArchived = archived, createdAt = 1)

    private data class Setup(val accounts: List<Account>, val categories: List<Category>, val remembered: Map<String, String>)

    private val setups = mapOf(
        "full" to Setup(
            listOf(
                account("a-cash", "Cash", AccountType.CASH), account("a-bkash", "bKash", AccountType.MOBILE_WALLET),
                account("a-nagad", "Nagad", AccountType.MOBILE_WALLET), account("a-city", "City Bank ••4567", AccountType.BANK),
                account("a-dbbl", "DBBL 1234", AccountType.BANK), account("a-ebl", "EBL Card 9876", AccountType.CARD),
                account("a-usd", "Payoneer", AccountType.OTHER, "USD"), account("a-old", "Old bank 4321", AccountType.BANK, isActive = false),
            ),
            listOf(
                category("c-family", "Family", CategoryKind.EXPENSE, ExpenseScope.FAMILY), category("c-shopping", "Shopping", CategoryKind.EXPENSE, ExpenseScope.PERSONAL),
                category("c-bills", "Bills", CategoryKind.EXPENSE, ExpenseScope.PERSONAL), category("c-food", "Food", CategoryKind.EXPENSE, ExpenseScope.PERSONAL),
                category("c-fees", "Fees & charges", CategoryKind.EXPENSE, ExpenseScope.PERSONAL),
                category("c-transport", "Transport", CategoryKind.EXPENSE, ExpenseScope.FAMILY, archived = true),
                category("c-other", "Other", CategoryKind.EXPENSE, ExpenseScope.PERSONAL), category("c-salary", "Salary", CategoryKind.INCOME),
                category("c-other-in", "Other", CategoryKind.INCOME),
            ),
            emptyMap(),
        ),
        "sparse" to Setup(
            listOf(account("a-wallet", "My wallet", AccountType.MOBILE_WALLET), account("a-bank", "Savings", AccountType.BANK)),
            listOf(category("c-misc", "Misc", CategoryKind.EXPENSE), category("c-in", "Income", CategoryKind.INCOME)),
            mapOf("bkash:" to "a-wallet", "?:4567" to "a-bank"),
        ),
    )

    private val learned = listOf(
        LearnedEntry(EntryType.EXPENSE, "a-nagad", null, "c-food", ExpenseScope.FAMILY, false),
        LearnedEntry(EntryType.TRANSFER, "a-city", "a-ebl", "c-bills", ExpenseScope.PERSONAL, true),
    )

    private fun JsonElement.text(): String? = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonObject.str(key: String): String? = this[key]?.text()?.ifEmpty { null }

    private fun draftFields(d: SmsDraft): Map<String, Any?> = mapOf(
        "type" to d.type.name,
        "amount" to d.amount,
        "accountId" to d.accountId,
        "toAccountId" to d.toAccountId,
        "categoryId" to d.categoryId,
        "scope" to d.scope.name,
        "countAsExpense" to d.countAsExpense,
        "date" to d.date,
        "time" to d.time,
        "description" to d.description,
        "notes" to d.notes,
    )

    private fun expectedDraft(e: JsonObject): Map<String, Any?> = mapOf(
        "type" to e.str("type"),
        "amount" to e.str("amount")?.let { Money.parse(it) },
        "accountId" to e.str("accountId"),
        "toAccountId" to e.str("toAccountId"),
        "categoryId" to if (e.str("type") == "INCOME") e.str("incomeCategoryId") else e.str("expenseCategoryId"),
        "scope" to e.str("scope"),
        "countAsExpense" to e["countAsExpense"]!!.jsonPrimitive.boolean,
        "date" to e.str("date"),
        "time" to e.str("time"),
        "description" to e["description"]!!.jsonPrimitive.content,
        "notes" to e["notes"]!!.jsonPrimitive.content,
    )

    @Test
    fun suggestsWhatTheWebsiteSuggestsForEveryMessage() {
        val today = fixture["today"]!!.jsonPrimitive.content
        val cases = fixture["cases"]!!.jsonArray
        assertTrue(cases.size > 700)
        val differences = mutableListOf<String>()
        for (element in cases) {
            val c = element.jsonObject
            val text = c["text"]!!.jsonPrimitive.content
            val receivedAt = (c["receivedAt"] as? JsonObject)?.let { ReceivedAt(it["date"]!!.jsonPrimitive.content, it["time"]?.text()) }
            val setup = setups.getValue(c["setup"]!!.jsonPrimitive.content)
            val learnedIndex = c["learned"]!!.jsonPrimitive.int
            val parsed = SmsParser.parse(text, today, receivedAt)
            val s = SmsSuggest.suggest(parsed, setup.accounts, setup.categories, today, setup.remembered, learned.getOrNull(learnedIndex))

            val actual = mapOf(
                "draft" to draftFields(s.draft),
                "fee" to s.fee?.let(::draftFields),
                "issues" to s.issues,
                "ready" to s.ready,
                "ownMatch" to s.ownMatch?.name?.lowercase(),
            )
            val expected = mapOf(
                "draft" to expectedDraft(c["draft"]!!.jsonObject),
                "fee" to (c["fee"] as? JsonObject)?.let(::expectedDraft),
                "issues" to c["issues"]!!.jsonArray.map { it.jsonPrimitive.content },
                "ready" to c["ready"]!!.jsonPrimitive.boolean,
                "ownMatch" to c["ownMatch"]!!.text(),
            )
            for ((key, value) in expected) {
                if (actual[key] != value) differences += "[${c["setup"]!!.jsonPrimitive.content}/$learnedIndex] ${text.take(70)}\n  $key: expected $value\n  but got ${actual[key]}"
            }
        }
        assertEquals(emptyList<String>(), differences.take(15), "${differences.size} differences")
    }

    @Test
    fun fingerprintsMatchTheWebsite() {
        for (element in fixture["fingerprints"]!!.jsonArray) {
            val c = element.jsonObject
            assertEquals(c["fingerprint"]!!.jsonPrimitive.content, SmsImport.fingerprint(c["text"]!!.jsonPrimitive.content))
        }
    }
}
