# Hisab for Android — privacy policy

Hisab for Android is a personal finance ledger that works on your phone,
offline.
This policy says what the app keeps, where, and why. It applies to the
Android app (`io.github.fr_ost.hisab`); the Hisab website has its own policy.

## In short

- **Everything you record stays on your phone.** There is no Hisab server
  and no Hisab account, and the app has no permission to use the internet.
  The developer never receives your data.
- **SMS are read on your phone, only if you turn it on**, and only those
  from banks and wallets about money. They are never sent anywhere.
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
- **Messages are read on the phone and never leave it.**

You can turn this off at any time in **More → Import SMS**, or take away the
SMS permission in Android's settings.

## Files you save

Backup files and CSV exports are saved only where you choose, when you
choose (if you pick a cloud folder, such as Google Drive, in Android's file
picker, that service's own terms apply to the file). Restoring reads only
the file you pick.

## Notifications

When Hisab adds a transaction from an SMS it can show a notification saying
what was added. On the lock screen it hides the amounts.

## Sharing

Hisab shares nothing with anyone. It does not sell data and has no
advertising.

## Deleting your data

Delete entries, accounts and everything else in the app; uninstalling the
app or clearing its storage in Android's settings removes everything on the
phone. Backup files you saved are yours to delete wherever you put them.

## Children

Hisab is meant for adults managing their own money.

## Changes

If this policy changes, the new version is published at the same address,
with the date below.

## Contact

Questions about this policy: the contact email shown on Hisab's Google Play
listing.

*Last updated: 23 November 2026.*
