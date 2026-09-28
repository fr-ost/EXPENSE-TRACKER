import { LockKeyholeIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { PasswordForm } from "@/components/auth/password-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getSession } from "@/lib/server/auth/guard";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Locked" };

/** Renders no financial data — only a password prompt. */
export default async function LockPage({ searchParams }: PageProps<"/lock">) {
  const { next } = await searchParams;
  const destination = safeRedirectPath(next);
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.locked) redirect(destination);

  return (
    <AuthScreen
      icon={
        <span className="inline-flex size-12 items-center justify-center rounded-[14px] bg-surface-muted text-text">
          <LockKeyholeIcon className="size-[22px]" />
        </span>
      }
      title="Locked"
      description="Your ledger is locked. Enter your password to continue."
      footer={<SignOutButton variant="link" className="text-small text-text-secondary" />}
    >
      <PasswordForm endpoint="/api/auth/unlock" submitLabel="Unlock" redirectTo={destination} />
    </AuthScreen>
  );
}
