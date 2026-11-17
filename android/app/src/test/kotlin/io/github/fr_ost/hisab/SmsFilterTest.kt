package io.github.fr_ost.hisab

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsFilterTest {
    @Test
    fun banksAndWalletsSendFromNamesAndShortCodesPeopleFromNumbers() {
        for (sender in listOf("bKash", "NAGAD", "16216", "DBBL", "City Bank", "BRAC-BANK", "16247")) {
            assertTrue(sender, SmsFilter.isBusinessSender(sender))
        }
        for (sender in listOf("+8801712345678", "01712345678", "880 1712-345678", "(017) 1234 5678", "", "  ")) {
            assertFalse(sender, SmsFilter.isBusinessSender(sender))
        }
    }

    @Test
    fun messagesAboutMoneyFromBanksAndWalletsAreSent() {
        val sent = listOf(
            "bKash" to "Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00. TrxID BIT9CD5E6F at 28/09/2026 10:05",
            "CityBank" to "Tk 500.00 spent at SHWAPNO on your A/C **4567. Avl Bal Tk 9,500.00",
            "DBBL" to "Your A/C 1234 is debited with BDT500.00 on 28-SEP-26.",
            "NAGAD" to "Money Received.\nAmount: Tk 1,000.00\nSender: 01712345678\nTxnID: 7A1B2C3D\nBalance: Tk 1,500.00",
            "bKash" to "আপনার অ্যাকাউন্টে ৫০০ টাকা জমা হয়েছে। ব্যালেন্স ১,২০০ টাকা",
            "bKash" to "Your bKash account balance is Tk 8,000.00.",
            "16216" to "Avl Bal: 12,345.67 on 03-Oct-2026",
            "HSBC" to "INR 1,500.00 debited from A/c XX1234. Avl bal INR 10,000.00",
        )
        for ((sender, text) in sent) assertTrue(text, SmsFilter.shouldSend(sender, text))
    }

    @Test
    fun peoplesMessagesCodesAndChatterStayOnThePhone() {
        val kept = listOf(
            // A person, however much money they mention.
            "+8801712345678" to "Send me Tk 500 for lunch please",
            "01712345678" to "Balance Tk 200 left, will pay tomorrow",
            // Verification codes, even with an amount in them.
            "bKash" to "Your bKash verification code is 123456. Never share it.",
            "Daraz" to "Use OTP 482913 to pay Tk 1,250 at Daraz. Valid for 5 minutes.",
            "CityBank" to "One-time password for your Tk 5,000 transfer: 77812",
            "bKash" to "আপনার ওটিপি 123456, ৳500 পেমেন্টের জন্য",
            // From a business, but not about money.
            "bKash" to "Eid Mubarak from bKash!",
            "GP" to "Your internet pack expires on 30 Sep. Dial *121# for offers.",
            "Global" to "Global offer: 50% off this weekend",
            // Nothing there.
            "bKash" to "   ",
        )
        for ((sender, text) in kept) assertFalse("$sender: $text", SmsFilter.shouldSend(sender, text))
        assertFalse(SmsFilter.shouldSend("bKash", "Tk 500.00 received. " + "x".repeat(SmsFilter.MAX_TEXT)))
    }

    @Test
    fun bengaliDigitsReadAsAsciiOnes() {
        assertEquals("Tk 1,250.50", SmsFilter.asciiDigits("Tk ১,২৫০.৫০"))
        assertEquals("plain", SmsFilter.asciiDigits("plain"))
    }

    @Test
    fun theSameMessageHasOneFingerprintHoweverItIsSpaced() {
        val text = "Cash Out Tk 2,000.00 successful. Balance Tk 500.00"
        val fingerprint = SmsFilter.fingerprint("bKash", text)
        assertEquals(64, fingerprint.length)
        assertEquals(fingerprint, SmsFilter.fingerprint(" BKASH ", "  ${text.uppercase().replace(" ", "   ")}\n"))
        assertNotEquals(fingerprint, SmsFilter.fingerprint("NAGAD", text))
        assertNotEquals(fingerprint, SmsFilter.fingerprint("bKash", text.replace("2,000", "3,000")))
    }

    @Test
    fun aLongSmsIsPutBackTogetherFromItsParts() {
        val parts = listOf(
            OutgoingSms("bKash", "Cash Out Tk 2,000.00 to 01912345678 successful. ", 1000),
            OutgoingSms("NAGAD", "Money Received. Amount: Tk 50.00", 1001),
            OutgoingSms("bKash", "Fee Tk 37.00. Balance Tk 500.00.", 1002),
        )
        assertEquals(
            listOf(
                OutgoingSms("bKash", "Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00.", 1000),
                OutgoingSms("NAGAD", "Money Received. Amount: Tk 50.00", 1001),
            ),
            SmsFilter.join(parts),
        )
        assertEquals(emptyList<OutgoingSms>(), SmsFilter.join(emptyList()))
    }
}
