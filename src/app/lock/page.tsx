import { LockKeyholeIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { ForgotPin } from "@/components/auth/forgot-pin";
import { PinForm } from "@/components/auth/pin-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSession } from "@/lib/server/auth/guard";
import { canResetPin } from "@/lib/server/auth/pin";

export const metadata: Metadata = { title: "Locked" };

/** Renders no financial data — only a PIN prompt. */
export default async function LockPage({ searchParams }: PageProps<"/lock">) {
  const { next, forgot } = await searchParams;
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
      description="Enter your PIN to open your ledger."
      footer={<SignOutButton variant="link" className="text-small text-text-secondary" />}
    >
      <PinForm redirectTo={destination} />
      <ForgotPin signedInJustNow={canResetPin(session)} open={forgot === "1"} />
    </AuthScreen>
  );
}
