package io.github.fr_ost.hisab

import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RepliesTest {
    @Test
    fun aCollectedTokenSaysWhoseAccountItIs() {
        val linked = Replies.linked("""{"token":"tok_123","account":{"email":"shahana@example.com","name":"Shahana"}}""")
        assertEquals(Account("tok_123", "shahana@example.com", "Shahana"), linked)
        assertEquals("shahana@example.com", linked.label)

        // The owner from before Google sign-in has no address yet: their name is shown.
        val owner = Replies.linked("""{"token":"tok_456","account":{"email":null,"name":"Rafi"}}""")
        assertEquals(null, owner.email)
        assertEquals("Rafi", owner.label)
        assertEquals("your Hisab account", Account("t", null, "").label)
    }

    @Test(expected = JSONException::class)
    fun noTokenIsNoLink() {
        Replies.linked("""{"token":"","account":{"email":"a@example.com","name":"A"}}""")
    }

    @Test
    fun eachMessageGetsAnAnswer() {
        val handedIn = Replies.handedIn(
            """{"results":[{"status":"added","title":"Moved ৳2,000 · Cash out","detail":"bKash · fee ৳37"},{"status":"ignored"},{"status":"review"},{"status":"balance","title":"Balance ৳8,000","detail":"bKash"}],"waiting":1}""",
            expected = 4,
        )
        assertEquals(1, handedIn.waiting)
        assertEquals(listOf("added", "ignored", "review", "balance"), handedIn.outcomes.map { it.status })
        assertEquals(listOf(true, false, false, true), handedIn.outcomes.map { it.added })
        assertEquals("bKash · fee ৳37", handedIn.outcomes[0].detail)
        assertEquals(null, handedIn.outcomes[1].title)
    }

    @Test(expected = JSONException::class)
    fun answersThatDontMatchTheMessagesAreNotTrusted() {
        Replies.handedIn("""{"results":[{"status":"added","title":"x"}],"waiting":0}""", expected = 2)
    }

    @Test
    fun theSitesOwnWordsForAProblem() {
        assertEquals("That link has expired. Start again from Settings in Hisab.", Replies.error("""{"error":"That link has expired. Start again from Settings in Hisab.","code":"invalid"}"""))
        assertEquals("Something went wrong. Please try again.", Replies.error("<html>Bad gateway</html>"))
        assertEquals("Something went wrong. Please try again.", Replies.error("""{"error":null}"""))
    }

    @Test
    fun whatIsSentIsWhatTheSiteTakes() {
        val body = JSONObject(
            Replies.handInBody(
                listOf(
                    QueuedSms(1, "  bKash  ", "  Cash Out Tk 2,000.00 successful.  ", 1_790_000_000_000),
                    QueuedSms(2, "A".repeat(60), "Tk 5 paid", 0),
                    QueuedSms(3, "NAGAD", "Tk 9 paid", Long.MAX_VALUE),
                ),
                appVersion = "1.0.42",
            ),
        )
        assertEquals("1.0.42", body.getString("appVersion"))
        val messages = body.getJSONArray("messages")
        assertEquals(3, messages.length())
        assertEquals("Cash Out Tk 2,000.00 successful.", messages.getJSONObject(0).getString("text"))
        assertEquals("bKash", messages.getJSONObject(0).getString("sender"))
        assertEquals(1_790_000_000_000, messages.getJSONObject(0).getLong("receivedAt"))
        // Within what the site accepts: a sender of 40 characters, a moment between 2000 and 2100.
        assertEquals(40, messages.getJSONObject(1).getString("sender").length)
        assertEquals(946_684_800_000, messages.getJSONObject(1).getLong("receivedAt"))
        assertEquals(4_102_444_800_000, messages.getJSONObject(2).getLong("receivedAt"))
    }

    @Test
    fun aLinkCodeIsSentWithThePhonesName() {
        val body = JSONObject(Replies.tokenBody("code_abc", "Shahana's Pixel 8 with a name far too long to keep in full here", "1.0.42"))
        assertEquals("code_abc", body.getString("code"))
        assertEquals(60, body.getString("name").length)
        assertTrue(body.getString("name").startsWith("Shahana's Pixel 8"))
        assertFalse(body.has("token"))
    }
}
