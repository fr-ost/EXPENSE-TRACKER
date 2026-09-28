import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { PasswordForm } from "@/components/auth/password-form";
import { getSession } from "@/lib/server/auth/guard";
import { adminPassword } from "@/lib/server/auth/password";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, reason } = await searchParams;
  const destination = safeRedirectPath(next);

  if (!adminPassword()) {
    return (
      <AuthScreen title="Set your password" description="Hisab needs a password before anyone can sign in.">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-small text-text-secondary">
          <p>
            Add a variable named <code className="font-mono font-medium text-text">ADMIN_PASSWORD</code> to the
            Railway service (Variables tab) with your password as its value, then deploy the change.
          </p>
          <p className="text-text-tertiary">Any 1–10 letters or digits work; longer is safer.</p>
        </div>
      </AuthScreen>
    );
  }

  const session = await getSession();
  if (session?.locked) redirect("/lock");
  if (session) redirect(destination);

  const notice = reason === "signed-out" ? "You were signed out after too many incorrect attempts." : undefined;
  return (
    <AuthScreen title="Welcome back" description="Enter your password to open your ledger.">
      <PasswordForm endpoint="/api/auth/login" submitLabel="Sign in" redirectTo={destination} notice={notice} />
    </AuthScreen>
  );
}
