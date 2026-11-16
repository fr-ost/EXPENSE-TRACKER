"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import { GoogleButton } from "./google-button";

/**
 * A forgotten PIN is removed by proving who you are again: sign in with
 * Google, then remove it (and set a new one in Settings).
 */
export function ForgotPin({ signedInJustNow, open }: { signedInJustNow: boolean; open: boolean }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await api("/api/auth/pin/reset", { handleAuth: false });
      // Full navigation: the app loads afresh, unlocked.
      window.location.replace("/settings#app-lock");
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <details className="group mt-5 text-center" open={open}>
      <summary className="cursor-pointer list-none text-small text-text-secondary underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
        Forgot your PIN?
      </summary>
      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-left text-small text-text-secondary">
        {signedInJustNow ? (
          <>
            <p>You have just signed in with Google, so you can remove the PIN. Set a new one in Settings whenever you like.</p>
            <Button variant="danger-soft" loading={pending} onClick={() => void remove()}>
              Remove PIN and open Hisab
            </Button>
          </>
        ) : (
          <>
            <p>Sign in with Google again to show it&apos;s you. You can then remove the PIN.</p>
            <GoogleButton next="/dashboard" resetPin size="md" label="Confirm with Google" />
          </>
        )}
        {error && (
          <p role="alert" className="text-negative-text">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
