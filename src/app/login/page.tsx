import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { PasswordForm } from "@/components/auth/password-form";
import { getSession } from "@/lib/server/auth/guard";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const destination = safeRedirectPath(next);
  const session = await getSession();
  if (session?.locked) redirect("/lock");
  if (session) redirect(destination);

  return (
    <AuthScreen title="Welcome back" description="Enter your password to open your ledger.">
      <PasswordForm endpoint="/api/auth/login" submitLabel="Sign in" redirectTo={destination} />
    </AuthScreen>
  );
}
