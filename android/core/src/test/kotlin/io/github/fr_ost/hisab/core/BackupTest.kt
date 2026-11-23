package io.github.fr_ost.hisab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlin.test.fail

class BackupTest {
    /** A small file shaped exactly like one the website writes (src/lib/backup.ts). */
    private val websiteFile = """
        {"format":"hisab-backup","version":1,"exportedAt":"2026-09-28T10:00:00.000Z","asOf":"2026-09-28","app":{"version":"abc123"},
         "settings":{"displayName":"Rafi","baseCurrency":"BDT","timezone":"Asia/Dhaka","numberFormat":"SOUTH_ASIAN","autoLockMinutes":15,"incomeCurrency":null,"expenseCurrency":"BDT"},
         "accounts":[
           {"id":"cash1","name":"Cash","type":"CASH","currency":"BDT","openingBalance":"1000.00","openingDate":"2026-01-01","isActive":true,"icon":"wallet","color":"green","sortOrder":0,"createdAt":"2026-01-01T00:00:00.000Z","balance":"2800.00"},
           {"id":"bk1","name":"bKash","type":"MOBILE_WALLET","currency":"BDT","openingBalance":"2537.00","openingDate":"2026-01-01","isActive":true,"icon":null,"color":null,"sortOrder":1,"createdAt":"2026-01-01T00:00:01.000Z","balance":"500.00"}
         ],
         "categories":[
           {"id":"food","name":"Food","kind":"EXPENSE","defaultScope":"PERSONAL","icon":"utensils","color":"orange","isArchived":false,"sortOrder":10,"createdAt":"2026-01-01T00:00:00.000Z"},
           {"id":"sal","name":"Salary","kind":"INCOME","defaultScope":null,"icon":"briefcase","color":"green","isArchived":false,"sortOrder":10,"createdAt":"2026-01-01T00:00:00.000Z"}
         ],
         "recurring":[],
         "transactions":[
           {"type":"TRANSFER","amount":"2000.00","date":"2026-09-28","time":"10:05","loggedTime":null,"accountId":"bk1","toAccountId":"cash1","toAmount":null,"categoryId":null,"countAsExpense":false,"scope":null,"description":"Cash out","notes":"Cash Out Tk 2,000.00 …","recurringId":null,"occurrenceDate":null,"affectsBalance":true,"idempotencyKey":"sms:0123456789abcdef0123456789abcdef01234567:0","createdAt":"2026-09-28T04:06:00.000Z"},
           {"type":"EXPENSE","amount":"37.00","date":"2026-09-28","time":"10:05","loggedTime":null,"accountId":"bk1","toAccountId":null,"toAmount":null,"categoryId":"food","countAsExpense":false,"scope":"PERSONAL","description":"Cash out fee","notes":null,"recurringId":null,"occurrenceDate":null,"affectsBalance":true,"idempotencyKey":"sms:0123456789abcdef0123456789abcdef01234567:1","createdAt":"2026-09-28T04:06:00.010Z"},
           {"type":"EXPENSE","amount":"200.00","date":"2026-09-20","time":null,"loggedTime":"18:30:00","accountId":"cash1","toAccountId":null,"toAmount":null,"categoryId":"food","countAsExpense":false,"scope":"FAMILY","description":"Dinner","notes":null,"recurringId":null,"occurrenceDate":null,"affectsBalance":true,"idempotencyKey":null,"createdAt":"2026-09-20T12:30:00.000Z"}
         ],
         "balanceUpdates":[
           {"accountId":"bk1","date":"2026-09-28","time":null,"loggedTime":"10:06:00","balance":"500.00","source":"SMS","note":null,"smsKey":"sms:0123456789abcdef0123456789abcdef01234567:b","messageDate":"2026-09-28","messageTime":"10:05","createdAt":"2026-09-28T04:06:00.020Z"}
         ],
         "budgets":[{"scope":"PERSONAL","effectiveFrom":"2026-09-01","amount":"30000.00"}],
         "exchangeRates":[{"base":"BDT","currency":"USD","rate":"122.5"}]}
    """.trimIndent()

    private fun ok(text: String): Backup.Read.Ok = when (val read = Backup.read(text)) {
        is Backup.Read.Ok -> read
        is Backup.Read.Bad -> fail(read.message)
    }

    @Test
    fun readsTheWebsitesBackupWithTheSameBalances() {
        val read = ok(websiteFile)
        assertEquals(Backup.Summary(2, 2, 3, 1, 1, 1, 0), read.summary)
        val data = read.data
        assertEquals("Rafi", data.settings.displayName)
        val ledger = Ledger(data)
        // The balances the file recorded for its day.
        assertEquals(tk("2800"), ledger.balance("cash1", "2026-09-28"))
        assertEquals(tk("500"), ledger.balance("bk1", "2026-09-28"))
        val fee = data.transactions.single { it.description == "Cash out fee" }
        assertEquals("sms:0123456789abcdef0123456789abcdef01234567:1", fee.smsKey)
        assertEquals("18:30:00", data.transactions.single { it.description == "Dinner" }.loggedTime)
        assertEquals(listOf(Budget("PERSONAL:2026-09-01", ExpenseScope.PERSONAL, "2026-09-01", tk("30000"))), data.budgets)
        assertEquals("BDT:USD", data.rates.single().id)
    }

    @Test
    fun theSameFileGivesTheSameIdsOnEveryPhone() {
        val first = ok(websiteFile).data
        val second = ok(websiteFile).data
        assertEquals(first.transactions.map { it.id }, second.transactions.map { it.id })
        assertEquals(first.checkpoints.map { it.id }, second.checkpoints.map { it.id })
        assertEquals(3, first.transactions.map { it.id }.toSet().size)
    }

    @Test
    fun writesAFileTheWebsiteAndThisAppReadBackToTheSameLedger() {
        val data = ok(websiteFile).data
        val written = Backup.write(data, "2026-09-28", 1_790_000_000_000, "1.0.40")
        assertTrue(written.contains("\"format\":\"hisab-backup\""))
        assertTrue(written.contains("\"idempotencyKey\":\"sms:"))
        val again = ok(written).data
        assertEquals(data.accounts, again.accounts)
        assertEquals(data.categories, again.categories)
        assertEquals(data.transactions.map { it.copy(id = "") }.toSet(), again.transactions.map { it.copy(id = "") }.toSet())
        assertEquals(data.checkpoints.map { it.copy(id = "") }.toSet(), again.checkpoints.map { it.copy(id = "") }.toSet())
        assertEquals(data.budgets, again.budgets)
        assertEquals(data.rates, again.rates)
        assertEquals(data.settings, again.settings)
        assertEquals(Ledger(data).balance("bk1", "2026-09-28"), Ledger(again).balance("bk1", "2026-09-28"))
    }

    @Test
    fun refusesFilesThatArentRightAndSaysWhy() {
        fun bad(text: String): String = when (val read = Backup.read(text)) {
            is Backup.Read.Bad -> read.message
            is Backup.Read.Ok -> fail("accepted: $text")
        }
        assertTrue(bad("not json").contains("isn't a Hisab backup"))
        assertTrue(bad("""{"format":"something-else"}""").contains("isn't a Hisab backup"))
        assertTrue(bad(websiteFile.replace("\"version\":1", "\"version\":2")).contains("newer version"))
        assertTrue(bad(websiteFile.replace("\"amount\":\"37.00\"", "\"amount\":\"-37.00\"")).contains("greater than zero"))
        assertTrue(bad(websiteFile.replace("\"amount\":\"200.00\"", "\"amount\":\"lots\"")).contains("not an amount"))
        assertTrue(bad(websiteFile.replace("\"categoryId\":\"food\",\"countAsExpense\":false,\"scope\":\"FAMILY\"", "\"categoryId\":\"nowhere\",\"countAsExpense\":false,\"scope\":\"FAMILY\"")).contains("category that isn't in the file"))
        assertTrue(bad(websiteFile.replace("\"accountId\":\"cash1\",\"toAccountId\":null", "\"accountId\":\"someone-elses\",\"toAccountId\":null")).contains("account that isn't in the file"))
        assertTrue(bad(websiteFile.replace("\"toAccountId\":\"cash1\"", "\"toAccountId\":\"bk1\"")).contains("comes from"))
        assertTrue(bad(websiteFile.replace("\"date\":\"2026-09-20\"", "\"date\":\"2026-02-30\"")).contains("not a date"))
        assertTrue(bad(websiteFile.replace("\"categoryId\":\"food\",\"countAsExpense\":false,\"scope\":\"FAMILY\"", "\"categoryId\":\"sal\",\"countAsExpense\":false,\"scope\":\"FAMILY\"")).contains("other kind"))
        assertTrue(bad(websiteFile.replace(":1\",\"createdAt\":\"2026-09-28T04:06:00.010Z\"", ":0\",\"createdAt\":\"2026-09-28T04:06:00.010Z\"")).contains("same SMS"))
        assertIs<Backup.Read.Ok>(Backup.read(websiteFile.replace("\"icon\":\"wallet\"", "\"icon\":\"wallet\",\"somethingNew\":5")))
    }
}
