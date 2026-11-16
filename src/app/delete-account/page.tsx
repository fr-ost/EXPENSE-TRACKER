import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/auth-screen";
import { GoogleButton } from "@/components/auth/google-button";
import { APP_NAME } from "@/lib/domain";

export const metadata: Metadata = { title: "Delete your account" };

/**
 * How to delete an account and its data. Public, so it can be linked from
 * the app's store listing and read without signing in.
 */
export default function DeleteAccountPage() {
  return (
    <AuthScreen
      title={`Delete your ${APP_NAME} account`}
      description="You can delete your account, and everything recorded in it, at any time."
    >
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 text-small text-text-secondary">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 marker:text-text-tertiary">
          <li>Sign in with the Google account you use for {APP_NAME}.</li>
          <li>
            Open <span className="font-medium text-text">Settings</span> and go to <span className="font-medium text-text">Delete account</span>.
          </li>
          <li>Type DELETE and confirm.</li>
        </ol>
        <p>
          This removes your accounts, transactions, balance updates, budgets, categories, recurring transactions, exchange rates,
          preferences and sign-ins from our servers straight away. It can&apos;t be undone, and nothing is kept.
        </p>
        <GoogleButton next="/settings#delete-account" size="md" label="Sign in to delete your account" />
      </div>
    </AuthScreen>
  );
}
