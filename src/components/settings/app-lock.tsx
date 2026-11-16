"use client";

import { LockKeyholeIcon, LockKeyholeOpenIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { digitsOnly } from "@/components/auth/pin-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { autoLockLabel } from "./preferences-form";

function PinInput({ value, onChange, autoComplete = "off" }: { value: string; onChange: (pin: string) => void; autoComplete?: string }) {
  return (
    <Input
      type="password"
      inputMode="numeric"
      autoComplete={autoComplete}
      value={value}
      onChange={(e) => onChange(digitsOnly(e.target.value))}
      placeholder="4 to 8 digits"
      className="tracking-[0.2em] placeholder:tracking-normal"
    />
  );
}

type Mode = "idle" | "set" | "off";

/**
 * The app lock: a PIN of your own, asked for after a while without activity,
 * on "Lock now" and after signing in.
 */
export function AppLock({ hasPin, autoLockMinutes }: { hasPin: boolean; autoLockMinutes: number }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("idle");
  const [current, setCurrent] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [repeat, setRepeat] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  function close() {
    setMode("idle");
    setCurrent("");
    setPin("");
    setRepeat("");
    setErrors({});
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "set" && pin !== repeat) return setErrors({ repeat: "The two PINs don't match." });
    setPending(true);
    setErrors({});
    try {
      if (mode === "set") {
        await api("/api/settings/pin", { method: "PUT", body: { pin, currentPin: hasPin ? current : null } });
        toast.success(hasPin ? "PIN changed" : "App lock is on");
      } else {
        await api("/api/settings/pin", { method: "DELETE", body: { currentPin: current } });
        toast.success("App lock is off");
      }
      close();
      router.refresh();
    } catch (error) {
      // A wrong current PIN is reported against that field (the API says "pin").
      if (error instanceof ApiClientError) setErrors(error.fieldErrors.pin ? { current: errorMessage(error) } : error.fieldErrors);
      if (!(error instanceof ApiClientError) || Object.keys(error.fieldErrors).length === 0) toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const when = autoLockMinutes > 0 ? `${autoLockLabel(autoLockMinutes).toLowerCase()} without activity, ` : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-secondary">
          {hasPin ? <LockKeyholeIcon className="size-4" /> : <LockKeyholeOpenIcon className="size-4" />}
        </span>
        <p className="text-body text-text-secondary">
          {hasPin ? (
            <>
              <span className="font-medium text-text">On.</span> Hisab asks for your PIN {when}when you choose Lock now, and after you
              sign in.
            </>
          ) : (
            <>
              <span className="font-medium text-text">Off.</span> Set a PIN and Hisab will ask for it after a while without activity
              and after you sign in — so an unlocked phone or laptop doesn&apos;t open your ledger.
            </>
          )}
        </p>
      </div>

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setMode("set")}>
            {hasPin ? "Change PIN" : "Set a PIN"}
          </Button>
          {hasPin && (
            <Button variant="ghost" onClick={() => setMode("off")}>
              Turn off
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-3" noValidate>
          {hasPin && (
            <Field label="Current PIN" error={errors.current ?? errors.currentPin}>
              <PinInput value={current} onChange={setCurrent} />
            </Field>
          )}
          {mode === "set" && (
            <>
              <Field label={hasPin ? "New PIN" : "PIN"} error={errors.pin}>
                <PinInput value={pin} onChange={setPin} autoComplete="new-password" />
              </Field>
              <Field label="Repeat it" error={errors.repeat}>
                <PinInput value={repeat} onChange={setRepeat} autoComplete="new-password" />
              </Field>
            </>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={pending}
              variant={mode === "off" ? "danger-soft" : "primary"}
              disabled={(hasPin && current.length < 4) || (mode === "set" && (pin.length < 4 || repeat.length < 4))}
            >
              {mode === "off" ? "Turn off app lock" : hasPin ? "Change PIN" : "Turn on app lock"}
            </Button>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
          <p className="text-caption text-text-tertiary">
            Forgotten PINs are removed by signing in with Google again, so the PIN keeps other people out of an unlocked device — it
            isn&apos;t a second password.
          </p>
        </form>
      )}
    </div>
  );
}
