# Hisab for Android — privacy policy

Hisab for Android is a personal finance ledger that works on your phone.
This policy says what the app keeps, where, and why. It applies to the
Android app (`io.github.fr_ost.hisab`); the Hisab website has its own policy.

## In short

- **Everything you record stays on your phone.** There is no Hisab server
  and no Hisab account. The developer never receives your data.
- **SMS are read on your phone, only if you turn it on**, and only those
  from banks and wallets about money. They are never sent anywhere.
- **Google Drive sync is optional.** When you turn it on, your ledger is
  copied to *your own* Google Drive, into a folder only Hisab can see.
- No ads, no analytics, no tracking, no crash reporting, no third-party SDKs
  that collect data.

## What the app keeps on your phone

What you enter: your accounts, transactions, balance updates, categories,
budgets, recurring entries, exchange rates and preferences (your name, if
you give one, and your main currency). It is stored in the app's private
storage, which other apps cannot read, and is left out of Android's own
backups and phone-to-phone transfers.

If you turn on automatic SMS reading, bank and wallet messages that Hisab
could not add by itself wait on the phone for you to look at (at most the
newest 500); they are deleted as soon as you add or skip them.

If you set an app lock PIN, only a salted, slow hash of it is kept, on this
phone. A lock with the phone's screen lock uses Android's own fingerprint,
face or PIN check; Hisab never sees your fingerprint or face.

## Text messages (SMS)

Only when you turn on **Read bank and wallet SMS** and allow it when
Android asks:

- The app receives the SMS your phone gets — and, only if you tap **Read the
  last 30 days**, the ones in your inbox from the last 30 days.
- It reads further **only messages from a bank or mobile wallet** (sent from
  a name such as "bKash" or a short code, never from a person's phone
  number) **that mention an amount of money**. Messages from people and
  verification codes (OTPs) are not read any further and are not kept.
- From those messages it records the transaction they describe — amount,
  date, merchant, fee and the balance the bank reports — in your ledger,
  with the message text as the transaction's note.
- **Messages are read on the phone and never leave it**, except as part of
  your own ledger if you turn on Google Drive sync (below).

You can turn this off at any time in **More → Import SMS**, or take away the
SMS permission in Android's settings.

## Google Drive sync (optional)

When you turn on **Sync with Google Drive** (or choose **Restore from Google
Drive** on a new phone), Google asks you to allow Hisab to "see, create and
delete its own configuration data in your Google Drive". That is the only
Google permission Hisab asks for: it cannot see or change any of your other
files in Drive.

Your phone then saves a copy of your ledger (everything listed under "What
the app keeps on your phone", except waiting SMS and the app lock) to
Hisab's hidden app folder in your Google Drive, and reads the copies your
other phones saved there, to keep them the same. The phone talks to Google
Drive directly; no one else receives the data. Google's privacy policy
applies to what is stored in your Google account.

You can stop at any time (**More → Sync with Google Drive**) and remove
Hisab's copy from Drive there. You can also remove Hisab's access in your
Google Account (Security → Third-party apps with account access).

## Files you save

Backup files and CSV exports are saved only where you choose, when you
choose. Restoring reads only the file you pick.

## Notifications

When Hisab adds a transaction from an SMS it can show a notification saying
what was added. On the lock screen it hides the amounts.

## Sharing

Hisab shares nothing with anyone. It does not sell data and has no
advertising.

## Deleting your data

Delete entries, accounts and everything else in the app; uninstalling the
app or clearing its storage in Android's settings removes everything on the
phone. If you used Google Drive sync, remove Hisab's copy from Drive in
**More → Sync with Google Drive** first, or later from Google Drive's
settings (**Manage apps → Hisab → Delete hidden app data**).

## Children

Hisab is meant for adults managing their own money.

## Changes

If this policy changes, the new version is published at the same address,
with the date below.

## Contact

Questions about this policy: the contact email shown on Hisab's Google Play
listing.

*Last updated: 23 November 2026.*
