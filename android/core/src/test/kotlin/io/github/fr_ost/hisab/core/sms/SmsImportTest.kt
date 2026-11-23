package io.github.fr_ost.hisab.core.sms

import io.github.fr_ost.hisab.core.Account
import io.github.fr_ost.hisab.core.AccountType
import io.github.fr_ost.hisab.core.CategoryKind
import io.github.fr_ost.hisab.core.Checkpoint
import io.github.fr_ost.hisab.core.CheckpointSource
import io.github.fr_ost.hisab.core.Clock
import io.github.fr_ost.hisab.core.EditError
import io.github.fr_ost.hisab.core.Edits
import io.github.fr_ost.hisab.core.EntryInput
import io.github.fr_ost.hisab.core.EntryType
import io.github.fr_ost.hisab.core.ExpenseScope
import io.github.fr_ost.hisab.core.Ids
import io.github.fr_ost.hisab.core.Ledger
import io.github.fr_ost.hisab.core.LedgerData
import io.github.fr_ost.hisab.core.Synced
import io.github.fr_ost.hisab.core.Transaction
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val TODAY = "2026-09-28"
private const val CASH_OUT = "Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00. TrxID BIT9CD5E6F at 28/09/2026 10:05"
private const val PAYMENT = "Payment Tk 350.00 to Daraz (01712345678) successful. Balance Tk 150.00. TrxID BIU1EF7G8H at 28/09/2026 12:00"

/** A ledger built up in a test, as the website's tests use their services. */
private class Book {
    var data = LedgerData(categories = Edits.starterCategories(1))
    private var moment = 10_000L

    fun now() = moment++

    fun account(name: String, type: AccountType = AccountType.CASH, opening: Long = 0, openingDate: String = "2025-01-01"): String {
        val account = Account(Ids.new(), name, type, "BDT", opening, openingDate, createdAt = now())
        save(listOf(account))
        return account.id
    }

    fun category(kind: CategoryKind, name: String) = data.categories.first { it.kind == kind && it.name == name }.id

    fun save(records: List<Synced>) {
        data = data.withRecords(records)
    }

    fun <T : Any> apply(result: T): T {
        when (result) {
            is SmsResult -> save(result.records)
            is Received -> save(result.records)
        }
        return result
    }

    fun balance(id: String, date: String = TODAY) = Ledger(data).balance(id, date)

    fun transactions() = data.live().transactions

    fun checkpoints() = data.live().checkpoints

    fun spend(input: EntryInput, clock: Clock): Transaction = Edits.addTransaction(data, input, clock, createdAt = now()).also { save(listOf(it)) }

    fun item(text: String, draft: SmsDraft, fee: SmsDraft? = null, includeBalance: Boolean = true) =
        SmsItem(text, SmsParser.parse(text, TODAY), draft, fee, includeBalance = includeBalance, issues = emptyList(), ownMatched = true, status = SmsStatus.READY)

    fun add(item: SmsItem, clock: Clock = Clock(TODAY), allowDuplicate: Boolean = false, sameAs: String? = null) =
        apply(SmsImport.add(data, item, clock, allowDuplicate, sameAs, now()))
}

private fun draft(
    type: EntryType,
    amount: Long,
    accountId: String,
    date: String = TODAY,
    time: String? = null,
    toAccountId: String? = null,
    categoryId: String? = null,
    description: String = "",
    notes: String = "",
) = SmsDraft(
    type = type, amount = amount, accountId = accountId, toAccountId = toAccountId, categoryId = categoryId,
    scope = ExpenseScope.PERSONAL, countAsExpense = false, date = date, time = time, description = description, notes = notes,
)

class SmsImportTest {
    private lateinit var book: Book
    private lateinit var cash: String
    private lateinit var bkash: String
    private lateinit var other: String
    private lateinit var shopping: String

    @BeforeTest
    fun setUp() {
        book = Book()
        cash = book.account("Cash", opening = 100_000)
        bkash = book.account("bKash", AccountType.MOBILE_WALLET, opening = 253_700)
        other = book.category(CategoryKind.EXPENSE, "Other")
        shopping = book.category(CategoryKind.EXPENSE, "Shopping")
    }

    private fun cashOut(includeBalance: Boolean = false) = book.item(
        CASH_OUT,
        draft(EntryType.TRANSFER, 200_000, bkash, time = "10:05", toAccountId = cash, description = "Cash out", notes = CASH_OUT),
        draft(EntryType.EXPENSE, 3_700, bkash, time = "10:05", categoryId = other, description = "Cash out fee"),
        includeBalance = includeBalance,
    )

    private fun payment(date: String = TODAY, time: String? = "12:00") =
        book.item(PAYMENT, draft(EntryType.EXPENSE, 35_000, bkash, date, time, categoryId = shopping, description = "Daraz"))

    private fun setOpening(id: String, opening: Long) {
        book.save(listOf(book.data.accounts.first { it.id == id }.copy(openingBalance = opening)))
    }

    @Test
    fun addsATransferAndItsFeeTogether() {
        val result = book.add(cashOut())
        assertEquals(SmsStatus.ADDED, result.status)
        assertEquals(2, result.ids.size)
        // bKash 2,537 − 2,000 − 37 = 500, exactly what the SMS reports.
        assertEquals(50_000, book.balance(bkash))
        assertEquals(300_000, book.balance(cash))
        val main = book.transactions().first { it.id == result.ids[0] }
        assertEquals(EntryType.TRANSFER, main.type)
        assertEquals("10:05", main.time)
        assertEquals(CASH_OUT, main.notes)
        assertTrue(main.smsKey!!.endsWith(":0"))
    }

    @Test
    fun neverAddsTheSameMessageTwiceEvenWithDifferentSpacing() {
        val first = book.add(cashOut())
        val respaced = cashOut().copy(text = "  ${CASH_OUT.replace(" ", "  ")}\n")
        val second = book.add(respaced)
        assertEquals(SmsStatus.EXISTS, second.status)
        assertEquals(first.ids, second.ids)
        assertEquals(2, book.transactions().size)
        assertEquals(SmsImport.fingerprint(CASH_OUT), SmsImport.fingerprint(CASH_OUT.uppercase()))
        // Built again from the ledger, it shows as added.
        assertEquals(SmsStatus.EXISTS, SmsImport.build(CASH_OUT, book.data, TODAY, emptyMap()).status)
    }

    @Test
    fun theSameMessageOnTwoPhonesIsOneTransaction() {
        val here = SmsImport.add(book.data, cashOut(), Clock(TODAY), now = 1)
        val there = SmsImport.add(book.data, cashOut(), Clock(TODAY), now = 2)
        assertEquals(here.ids, there.ids)
    }

    @Test
    fun flagsATransactionThatIsProbablyAlreadyRecorded() {
        book.spend(EntryInput(EntryType.EXPENSE, 35_000, "2026-09-27", accountId = bkash, categoryId = shopping, scope = ExpenseScope.PERSONAL, description = "Daraz order"), Clock(TODAY))
        val flagged = book.add(payment())
        assertEquals(SmsStatus.DUPLICATE, flagged.status)
        assertEquals(SimilarTransaction(flagged.similar!!.id, "Daraz order", "2026-09-27", 35_000, "bKash"), flagged.similar)
        assertEquals(1, book.transactions().size)
        assertEquals(SmsStatus.ADDED, book.add(payment(), allowDuplicate = true).status)
    }

    @Test
    fun recognisesATransferAddedFromTheOtherAccountsMessage() {
        val bank = book.account("City Bank", AccountType.BANK, opening = 5_000_000)
        val transfer = draft(EntryType.TRANSFER, 250_000, bank, toAccountId = bkash, description = "Add money")
        assertEquals(SmsStatus.ADDED, book.add(book.item("Tk 2,500.00 transferred from your A/C **4567 to bKash", transfer)).status)
        val walletSide = book.item("You have received deposit from iBanking of Tk 2,500.00 from City Bank. TrxID X1 at 28/09/2026 12:11", transfer)
        assertEquals(SmsStatus.DUPLICATE, book.add(walletSide).status)
    }

    @Test
    fun reportsTheLedgersRulesPerMessage() {
        val bad = book.add(book.item("too far ahead", draft(EntryType.EXPENSE, 1_000, bkash, "2028-01-01", categoryId = shopping)))
        assertEquals(SmsStatus.ERROR, bad.status)
        assertEquals("date", bad.errorField)
        assertTrue(bad.error!!.contains("a year ahead"))
        assertTrue(bad.records.isEmpty())
        assertEquals(SmsStatus.ADDED, book.add(payment()).status)
    }

    @Test
    fun learnsHowTheSameDescriptionWasRecordedBefore() {
        book.add(cashOut())
        book.spend(EntryInput(EntryType.EXPENSE, 12_000, "2026-09-20", accountId = bkash, categoryId = shopping, scope = ExpenseScope.FAMILY, description = "Sent to 01812345678"), Clock(TODAY))
        val (existing, _) = SmsImport.existing(book.data, CASH_OUT)
        assertEquals(2, existing.size)
        val learned = SmsImport.learned(book.data, "sent to 01812345678")
        assertEquals(LearnedEntry(EntryType.EXPENSE, bkash, null, shopping, ExpenseScope.FAMILY, false), learned)
    }

    @Test
    fun setsTheBalanceFromTheMessageOnce() {
        // Hisab thinks bKash has 3,000; the SMS says 500 after the cash out.
        setOpening(bkash, 300_000)
        assertEquals(SmsStatus.ADDED, book.add(cashOut(includeBalance = true)).status)
        assertEquals(50_000, book.balance(bkash))
        val update = book.checkpoints().single()
        assertEquals(CheckpointSource.SMS, update.source)
        assertEquals(TODAY to "10:05", update.messageDate to update.messageTime)
        assertEquals(-46_300, Ledger(book.data).corrections.single { it.checkpointId == update.id }.amount)

        // Added again: nothing; older entries added later don't move today's balance.
        book.add(cashOut(includeBalance = true))
        assertEquals(1, book.checkpoints().size)
        book.spend(EntryInput(EntryType.EXPENSE, 10_000, "2026-09-20", accountId = bkash, categoryId = shopping, scope = ExpenseScope.PERSONAL, description = "Older"), Clock(TODAY))
        assertEquals(50_000, book.balance(bkash))
    }

    @Test
    fun recordsTheReportedBalanceOnlyWithItsTransaction() {
        // A different ৳350 payment that morning, typed by hand.
        book.spend(EntryInput(EntryType.EXPENSE, 35_000, TODAY, "09:00", bkash, categoryId = shopping, scope = ExpenseScope.PERSONAL, description = "Daraz"), Clock(TODAY))
        assertEquals(SmsStatus.DUPLICATE, book.add(payment()).status)
        assertTrue(book.checkpoints().isEmpty())
        assertEquals(218_700, book.balance(bkash))
        assertEquals(SmsStatus.ADDED, book.add(payment(), allowDuplicate = true).status)
        assertEquals(15_000, book.balance(bkash))
    }

    @Test
    fun deletingTheImportRemovesItsBalanceButDeletingTheFeeDoesnt() {
        setOpening(bkash, 300_000)
        val (main, fee) = book.add(cashOut(includeBalance = true)).ids
        book.save(Edits.deleteTransaction(book.data, fee))
        assertEquals(1, book.checkpoints().size)
        assertEquals(50_000, book.balance(bkash))
        book.save(Edits.deleteTransaction(book.data, main))
        assertTrue(book.checkpoints().isEmpty())
        assertEquals(300_000, book.balance(bkash))
    }

    @Test
    fun recordsTheBalanceOfAMessageAddedBeforeWhenItComesAgain() {
        setOpening(bkash, 300_000)
        book.add(cashOut())
        assertEquals(96_300, book.balance(bkash))
        assertEquals(false, SmsImport.existing(book.data, CASH_OUT).second)

        val again = book.add(cashOut(includeBalance = true))
        assertEquals(SmsStatus.EXISTS to true, again.status to again.balanceSaved)
        assertEquals(50_000, book.balance(bkash))
        assertEquals(true, SmsImport.existing(book.data, CASH_OUT).second)
        // Saving it again, or for a message never added, changes nothing.
        assertEquals(true to emptyList(), SmsImport.saveBalance(book.data, CASH_OUT, bkash, 50_000, null, Clock(TODAY)))
        assertEquals(false to emptyList(), SmsImport.saveBalance(book.data, PAYMENT, bkash, 100, null, Clock(TODAY)))
    }

    @Test
    fun aFlaggedMessageConfirmedAsTheSameTransactionTakesOverItsTime() {
        // Paid at 12:00, typed in by hand at 12:05 without a time.
        val typed = book.spend(EntryInput(EntryType.EXPENSE, 35_000, TODAY, accountId = bkash, categoryId = shopping, scope = ExpenseScope.PERSONAL, description = "Daraz"), Clock(TODAY, "12:05:00"))
        val clock = Clock(TODAY, "18:00:00")
        val item = payment()
        val flagged = book.add(item, clock)
        assertEquals(typed.id, flagged.similar?.id)

        val linked = book.add(item, clock, sameAs = typed.id)
        assertEquals(Triple(SmsStatus.EXISTS, listOf(typed.id), true), Triple(linked.status, linked.ids, linked.balanceSaved))
        // Counted once: the balance is what the SMS says, not 150 − 350.
        assertEquals(15_000, book.balance(bkash))
        val now = book.transactions().single()
        assertEquals("12:00", now.time)
        assertTrue(now.smsKey!!.startsWith("sms:"))
        // The message is now linked to it.
        assertEquals(listOf(typed.id), book.add(item, clock).ids)
    }

    @Test
    fun suggestsAnAccountForAMessageWithNowhereToGo() {
        val nagad = "Money Received.\nAmount: Tk 1,000.00\nSender: 01712345678\nRef: lunch\nTxnID: 7A1B2C3D\nBalance: Tk 1,500.00\n28/09/2026 09:15"
        val item = SmsImport.build(nagad, book.data, TODAY, emptyMap())
        assertEquals(SmsImport.Missing.OWN, SmsImport.missingAccount(item))
        // What it held before the ৳1,000 came in, so the message's ৳1,500 then holds.
        assertEquals(SmsImport.AccountSuggestion("Nagad", AccountType.MOBILE_WALLET, 50_000, TODAY), SmsImport.suggestAccount(item, "BDT"))
        val id = book.account("Nagad", AccountType.MOBILE_WALLET, 50_000, TODAY)
        val again = SmsImport.rematch(item, book.data, TODAY, emptyMap())
        assertEquals(id, again.draft.accountId)
        assertNull(SmsImport.missingAccount(again))
    }
}

/** An SMS balance replaces the account's balance (the website's own cases). */
class SmsBalanceTest {
    private val day = "2026-10-03"
    private lateinit var book: Book
    private lateinit var bkash: String
    private lateinit var income: String
    private lateinit var food: String

    @BeforeTest
    fun setUp() {
        book = Book()
        // Hisab shows ৳5,000.
        bkash = book.account("bKash", AccountType.MOBILE_WALLET, 500_000, "2026-09-01")
        income = book.category(CategoryKind.INCOME, "Other")
        food = book.category(CategoryKind.EXPENSE, "Food")
    }

    private fun received(amount: Long, balance: Long, time: String?, date: String = day, clock: String) {
        val text = "You have received Tk ${amount / 100} from 01711111111. Balance Tk ${balance / 100}. TrxID R$date${time ?: ""}$amount at $date"
        val item = SmsItem(
            text, SmsParser.parse(text, day), draft(EntryType.INCOME, amount, bkash, date, time, categoryId = income, description = "Received", notes = text), null,
            issues = emptyList(), ownMatched = true, status = SmsStatus.READY,
        )
        assertEquals(balance, item.parsed.balance)
        book.apply(SmsImport.add(book.data, item, Clock(day, clock), allowDuplicate = true, now = book.now()))
    }

    private fun spend(amount: Long, clock: String, date: String = day) {
        book.spend(EntryInput(EntryType.EXPENSE, amount, date, accountId = bkash, categoryId = food, scope = ExpenseScope.PERSONAL), Clock(day, clock))
    }

    private fun balance() = book.balance(bkash, day)

    @Test
    fun setsTheBalanceToWhatTheNewestMessageSays() {
        received(50_000, 800_000, "10:05", clock = "15:00:00")
        assertEquals(800_000, balance())
        val update = book.checkpoints().single()
        assertEquals(day to "10:05", update.messageDate to update.messageTime)
        // What Hisab had just before it: ৳5,500.
        assertEquals(550_000, update.balance - Ledger(book.data).corrections.single { it.checkpointId == update.id }.amount)
    }

    @Test
    fun takesWhatWasRecordedBeforeItWasReadAsIncluded() {
        spend(70_000, "12:00:00") // typed in at noon, after the 10:05 message
        received(50_000, 800_000, "10:05", clock = "15:00:00")
        assertEquals(800_000, balance())
        spend(10_000, "16:00:00") // after the SMS was read
        assertEquals(790_000, balance())
    }

    @Test
    fun aMessageFromAnEarlierDayStillSetsTodaysBalanceWhenItIsTheNewest() {
        spend(70_000, "09:00:00", "2026-10-02")
        received(50_000, 800_000, "10:05", "2026-10-01", clock = "15:00:00")
        assertEquals(800_000, balance())
    }

    @Test
    fun anOlderMessageIsHistoryAndNeverOverridesANewerOne() {
        received(10_000, 700_000, "12:00", clock = "15:00:00")
        received(20_000, 650_000, "10:00", clock = "15:05:00")
        assertEquals(700_000, balance())
    }

    @Test
    fun aBalanceEnteredForALaterMomentWins() {
        book.save(listOf(Checkpoint(Ids.new(), bkash, day, "18:00", balance = 400_000, createdAt = book.now())))
        received(50_000, 800_000, "10:05", clock = "20:00:00")
        assertEquals(400_000, balance())
    }

    @Test
    fun aMessageThatOnlyReportsABalanceSetsItOnce() {
        val text = "Your bKash account balance is Tk 8,000.00."
        val first = SmsImport.saveBalance(book.data, text, bkash, 800_000, ReceivedAt(day, null), Clock(day, "15:00:00"))
        assertEquals(true, first.first)
        book.save(first.second)
        assertEquals(800_000, balance())
        assertEquals(true to emptyList(), SmsImport.saveBalance(book.data, text, bkash, 800_000, ReceivedAt(day, null), Clock(day, "16:00:00")))
        assertEquals(1, book.checkpoints().size)
        assertTrue(book.transactions().isEmpty())
        assertEquals(true, SmsImport.existing(book.data, text).second)
        // Never for a card, never from the future.
        val card = book.account("Card", AccountType.CARD, openingDate = "2026-09-01")
        assertFailsWith<EditError> { SmsImport.saveBalance(book.data, "Card balance BDT 1.00", card, 100, ReceivedAt(day, null), Clock(day)) }
        assertFailsWith<EditError> { SmsImport.saveBalance(book.data, "Balance Tk 2.00", bkash, 200, ReceivedAt("2026-10-04", null), Clock(day)) }
    }

    @Test
    fun aMessageStampedAMinuteAheadOfTheClockStillFollowsItsTransaction() {
        val fresh = Book()
        val wallet = fresh.account("bKash", AccountType.MOBILE_WALLET, 65_000, "2026-09-01")
        val text = "Payment Tk 50.00 to Daraz (01712345678) successful. Balance Tk 600.00. TrxID AHEAD0001 at 03/10/2026 15:01"
        val item = SmsItem(
            text, SmsParser.parse(text, "2026-10-03"),
            draft(EntryType.EXPENSE, 5_000, wallet, "2026-10-03", "15:01", categoryId = fresh.category(CategoryKind.EXPENSE, "Shopping"), description = "Daraz", notes = text),
            null, issues = emptyList(), ownMatched = true, status = SmsStatus.READY,
        )
        fresh.apply(SmsImport.add(fresh.data, item, Clock("2026-10-03", "15:00:20"), now = fresh.now()))
        assertEquals(60_000, fresh.balance(wallet, "2026-10-03"))
    }
}

/** Messages the phone receives by itself (the website's sms-inbox tests). */
class SmsReceiveTest {
    private val clock = Clock(TODAY, "14:30:00")
    private val otp = "Your bKash verification code is 123456. Never share your code and PIN with anyone."
    private val promo = "Get up to 20% cashback on bKash payment at Daraz! Offer valid till 30 Sep. T&C: https://bka.sh/offer"
    private val nagad = "Money Received.\nAmount: Tk 1,000.00\nSender: 01712345678\nRef: lunch\nTxnID: 7A1B2C3D\nBalance: Tk 1,500.00\n28/09/2026 09:15"
    private val cardSpend = "Tk 500.00 spent at SHWAPNO on your A/C **4567. Avl Bal Tk 9,500.00"
    private val balanceOnly = "Dear customer, your bKash account balance is Tk 8,000.00 as of 28/09/2026 13:00."

    private lateinit var book: Book
    private lateinit var cash: String
    private lateinit var bkash: String

    @BeforeTest
    fun setUp() {
        book = Book()
        cash = book.account("Cash", opening = 100_000)
        bkash = book.account("bKash", AccountType.MOBILE_WALLET, opening = 253_700)
    }

    private fun receive(text: String, time: String, date: String = TODAY): Received =
        book.apply(SmsImport.receive(book.data, text, ReceivedAt(date, time), clock, now = book.now()))

    @Test
    fun addsAMessageThatIsCompleteAndCertain() {
        assertEquals(Received.Added("Moved ৳2,000 · Cash out", "bKash · fee ৳37 · balance ৳500", emptyList()), (receive(CASH_OUT, "10:06") as Received.Added).copy(records = emptyList()))
        val added = book.transactions().sortedBy { it.smsKey }
        assertEquals(
            listOf(listOf(EntryType.TRANSFER, 200_000L, bkash, cash, "10:05"), listOf(EntryType.EXPENSE, 3_700L, bkash, null, "10:05")),
            added.map { listOf(it.type, it.amount, it.accountId, it.toAccountId, it.time) },
        )
        assertEquals(CASH_OUT, added[0].notes)
        assertEquals(50_000, book.balance(bkash))
        assertEquals(300_000, book.balance(cash))
    }

    @Test
    fun neverAddsTheSameMessageTwice() {
        receive(CASH_OUT, "10:06")
        assertIs<Received.Exists>(receive(CASH_OUT, "10:06"))
        assertIs<Received.Exists>(receive("  ${CASH_OUT.lowercase()} ", "10:07"))
        assertEquals(2, book.transactions().size)
    }

    @Test
    fun dropsMessagesThatArentTransactions() {
        assertEquals(Received.Ignored, receive(otp, "09:00"))
        assertEquals(Received.Ignored, receive(promo, "09:01"))
        assertTrue(book.transactions().isEmpty())
        assertTrue(book.checkpoints().isEmpty())
    }

    @Test
    fun keepsAMessageItCantPlaceForThePerson() {
        // There is no Nagad account.
        assertEquals(Received.Review, receive(nagad, "09:16"))
        assertTrue(book.transactions().isEmpty())
    }

    @Test
    fun leavesAMessageForThePersonWhenSomethingSimilarIsRecorded() {
        book.spend(EntryInput(EntryType.EXPENSE, 35_000, "2026-09-27", accountId = bkash, categoryId = book.category(CategoryKind.EXPENSE, "Shopping"), scope = ExpenseScope.PERSONAL, description = "Daraz order"), clock)
        assertEquals(Received.Review, receive(PAYMENT, "12:01"))
        assertEquals(1, book.transactions().size)
        assertTrue(book.checkpoints().isEmpty())
    }

    @Test
    fun datesAMessageThatStatesNeitherByWhenThePhoneReceivedIt() {
        val bank = book.account("City Bank 4567", AccountType.BANK, 1_000_000)
        val outcome = receive(cardSpend, "21:40", "2026-09-27")
        assertEquals(Received.Added("Spent ৳500 · Shwapno", "City Bank 4567 · balance ৳9,500", emptyList()), (outcome as Received.Added).copy(records = emptyList()))
        val spent = book.transactions().single { it.accountId == bank }
        assertEquals("2026-09-27" to "21:40", spent.date to spent.time)
    }

    @Test
    fun takesAMessageThatOnlyReportsABalanceWhenItSaysWhose() {
        assertEquals(Received.Balance("Balance ৳8,000", "bKash", emptyList()), (receive(balanceOnly, "13:01") as Received.Balance).copy(records = emptyList()))
        assertEquals(800_000, book.balance(bkash))
        assertTrue(book.transactions().isEmpty())
        assertIs<Received.Balance>(receive(balanceOnly, "13:01"))
        assertEquals(1, book.checkpoints().size)
        // No account it could belong to: the person decides.
        assertEquals(Received.Review, receive("Your Nagad account balance is Tk 300.00.", "13:05"))
    }

    @Test
    fun learnsWhichAccountAWalletsMessagesBelongTo() {
        val wallet = book.account("Daily spending", AccountType.MOBILE_WALLET, 500_000)
        book.save(listOf(book.data.accounts.first { it.id == bkash }.copy(name = "Old wallet")))
        // Nothing says "Daily spending" is the bKash account.
        assertEquals(Received.Review, receive(CASH_OUT, "10:06"))

        // The person adds it, choosing the account…
        val item = SmsImport.build(CASH_OUT, book.data, TODAY, emptyMap())
        val chosen = item.copy(draft = item.draft.copy(accountId = wallet))
        assertEquals(SmsStatus.ADDED, book.add(chosen).status)

        // …and the next bKash message goes there on its own.
        val outcome = receive(PAYMENT, "12:01")
        assertEquals("Daily spending · balance ৳150", (outcome as Received.Added).detail)
        assertEquals(wallet, book.transactions().single { it.description == "Daraz" }.accountId)
    }

    @Test
    fun aPhoneWhoseClockRunsAheadCantDateAMessageInTheFuture() {
        book.account("City Bank 4567", AccountType.BANK, 1_000_000)
        assertIs<Received.Added>(receive(cardSpend, "09:00", "2026-10-03"))
        val spent = book.transactions().single()
        assertEquals(TODAY to "14:30", spent.date to spent.time)
    }
}
