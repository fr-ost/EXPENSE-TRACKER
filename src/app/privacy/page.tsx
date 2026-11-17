import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { APP_NAME } from "@/lib/domain";

export const metadata: Metadata = { title: "Privacy policy" };

/** When this policy last changed. Change it with the policy. */
const UPDATED = "17 November 2026";

/**
 * The privacy policy, for the website and the Android app. Public, so it can
 * be linked from the Google Play listing and read without signing in. Say
 * here exactly what the code does: a change to what is kept or sent changes
 * this page in the same commit.
 */
export default function PrivacyPage() {
  const contact = process.env.CONTACT_EMAIL?.trim();
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-16">
      <Link href="/login" className="mb-8 inline-flex items-center gap-2.5 rounded-md text-body font-semibold text-text">
        <BrandMark className="size-8" />
        {APP_NAME}
      </Link>
      <h1 className="text-title font-semibold text-text">Privacy policy</h1>
      <p className="mt-1 text-small text-text-tertiary">Last updated {UPDATED}</p>

      <div className="mt-8 flex flex-col gap-8 text-body leading-relaxed text-text-secondary [&_h2]:mb-2 [&_h2]:text-heading [&_h2]:font-semibold [&_h2]:text-text [&_li]:mt-1.5 [&_strong]:font-medium [&_strong]:text-text [&_ul]:list-disc [&_ul]:pl-5">
        <p>
          {APP_NAME} is a personal finance ledger: the website, and the Android app that opens it. This page says what {APP_NAME} keeps
          about you, what it does with it, and what it never does. Your ledger is yours: nobody else using {APP_NAME} can see it.
        </p>

        <section>
          <h2>What Hisab keeps</h2>
          <ul>
            <li>
              <strong>Your Google account:</strong> Google&apos;s id for it, your email address and your name, to sign you in. Never
              your Google password — Google checks that.
            </li>
            <li>
              <strong>What you record:</strong> your accounts, transactions, balance updates, budgets, categories, recurring
              transactions, exchange rates and preferences.
            </li>
            <li>
              <strong>Sign-ins:</strong> when you signed in and from which browser, so Settings can list your signed-in devices.
            </li>
            <li>
              <strong>Your app lock PIN</strong>, if you set one: only a scrambled form of it, from which the PIN can&apos;t be read.
            </li>
            <li>
              <strong>Phones linked for SMS import:</strong> the phone&apos;s name, the app&apos;s version, and when it last sent a
              message.
            </li>
          </ul>
        </section>

        <section id="sms" className="scroll-mt-8">
          <h2>Text messages (SMS), in the Android app</h2>
          <p>Only when you turn on automatic SMS import on your phone, and allow it to read SMS:</p>
          <ul>
            <li>
              The app reads the text messages your phone receives — and, only if you ask it to, the ones from the last 30 days.
            </li>
            <li>
              On the phone, it picks out messages from banks and mobile wallets that are about money. <strong>Messages from people
              and verification codes are not read any further and never leave your phone.</strong>
            </li>
            <li>
              The messages it picks out are sent to your {APP_NAME} account over an encrypted connection. Each is used to add its
              transaction, its fee and your account balance to your ledger, and is kept as that transaction&apos;s note so you can
              see where it came from.
            </li>
            <li>
              A message that turns out not to be a transaction is thrown away, not stored. One {APP_NAME} can&apos;t add on its own
              waits for you on the Import SMS page until you add it or remove it.
            </li>
            <li>Messages are never used for advertising, never sold, never shared, and never used for anything else.</li>
            <li>
              You can turn it off at any time: in Settings in {APP_NAME} (remove the phone), in the app, or by taking away the
              app&apos;s SMS permission in your phone&apos;s settings.
            </li>
          </ul>
        </section>

        <section>
          <h2>Google Drive backups, if you turn them on</h2>
          <p>
            If you connect Google Drive, {APP_NAME} keeps copies of your ledger in a hidden folder of its own in your Drive (the
            last ten). It can&apos;t see or touch any other file in your Drive. Google&apos;s permission is stored encrypted on the
            server, only to make those backups, and you can disconnect it in Settings at any time.
          </p>
        </section>

        <section>
          <h2>What Hisab never does</h2>
          <ul>
            <li>No advertising, and no advertising or analytics trackers.</li>
            <li>Your information is never sold, rented or traded.</li>
            <li>
              It is shared with nobody, except the services that run {APP_NAME}, only as they need to: the hosting provider where the
              server and its database run, and Google, for signing in and (if you turn them on) Drive backups.
            </li>
          </ul>
        </section>

        <section>
          <h2>Keeping it safe</h2>
          <p>
            Everything travels over encrypted connections. Each person&apos;s ledger is kept apart, and the database itself refuses
            to mix one person&apos;s records with another&apos;s. Sign-in sessions and linked phones are known to the server only
            by scrambled forms of their keys.
          </p>
        </section>

        <section>
          <h2>How long it is kept, and deleting it</h2>
          <p>
            What you record is kept until you change or delete it. You can download all of it as a backup file in Settings at any
            time. You can also{" "}
            <Link href="/delete-account" className="font-medium text-text underline underline-offset-2">
              delete your account
            </Link>
            : everything in it — your ledger, linked phones, waiting messages, sign-ins and {APP_NAME}&apos;s Drive backups — is
            removed straight away, and nothing is kept.
          </p>
        </section>

        <section>
          <h2>Children</h2>
          <p>{APP_NAME} is not meant for children under 13, and doesn&apos;t knowingly keep information about them.</p>
        </section>

        <section>
          <h2>Changes and questions</h2>
          <p>
            If this policy changes, the new version is posted here with its date.{" "}
            {contact ? (
              <>
                Questions:{" "}
                <a href={`mailto:${contact}`} className="font-medium text-text underline underline-offset-2">
                  {contact}
                </a>
                .
              </>
            ) : (
              <>Questions can be sent through the contact address on {APP_NAME}&apos;s Google Play listing.</>
            )}
          </p>
        </section>
      </div>
    </main>
  );
}
