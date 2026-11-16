"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";

/** Delete the account and everything in it, after typing DELETE and confirming. */
export function DeleteAccount() {
  const [typed, setTyped] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await api("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
      // Full navigation: drops every client-side copy of what was just deleted.
      window.location.replace("/login?reason=deleted");
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-text-secondary">
        Deletes your accounts, transactions, balance updates, budgets, categories, recurring transactions and preferences from
        Hisab, for good. Export anything you want to keep first.
      </p>
      <div className="flex max-w-sm flex-col gap-3">
        <Field label="Type DELETE to continue" error={error}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </Field>
        <Button variant="danger" className="self-start" disabled={typed.trim() !== "DELETE"} onClick={() => setConfirming(true)}>
          Delete my account
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete your account?"
        description="Everything you have recorded will be deleted now. This can't be undone."
        confirmLabel="Delete everything"
        destructive
        loading={pending}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
