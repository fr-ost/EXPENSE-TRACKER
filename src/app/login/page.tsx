import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { GoogleButton } from "@/components/auth/google-button";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { googleConfig } from "@/lib/server/auth/google";
import { getSession } from "@/lib/server/auth/guard";

export const metadata: Metadata = { title: "Sign in" };

/** Why the last sign-in didn't complete (set by the Google callback). */
const NOTICES: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long. Please try again.",
  failed: "Google sign-in didn't complete. Please try again.",
  rate_limited: "Too many failed sign-ins from this network. Try again in a few minutes.",
  deleted: "Your account and everything in it has been deleted.",
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error, reason } = await searchParams;
  const destination = safeRedirectPath(next);

  if (!googleConfig()) {
    return (
      <AuthScreen title="Set up sign-in" description="Hisab signs people in with Google, and needs to be connected to it first.">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-small text-text-secondary">
          <p>
            Add <code className="font-mono font-medium text-text">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="font-mono font-medium text-text">GOOGLE_CLIENT_SECRET</code> to the server&apos;s variables (an OAuth
            client from the Google Cloud console), then deploy the change.
          </p>
          <p className="text-text-tertiary">The README has the steps.</p>
        </div>
      </AuthScreen>
    );
  }

  const session = await getSession();
  if (session?.locked) redirect("/lock");
  if (session) redirect(destination);

  const notice = NOTICES[first(error) ?? first(reason) ?? ""];
  return (
    <AuthScreen title="Welcome to Hisab" description="Sign in to open your ledger. New here? Your account is created the first time you sign in.">
      <div className="flex flex-col gap-4">
        {notice && (
          <p role="alert" className="rounded-lg border border-border bg-surface px-4 py-3 text-center text-small text-text-secondary">
            {notice}
          </p>
        )}
        <GoogleButton next={destination} />
      </div>
    </AuthScreen>
  );
}
