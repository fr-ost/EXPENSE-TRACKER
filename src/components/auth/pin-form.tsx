"use client";

import { motion, useAnimationControls } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";

/** Keep what was typed to digits, as the PIN is. */
export const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 8);

/** The lock screen's PIN field. */
export function PinForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const shake = useAnimationControls();
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!pin || pending) return;
    setPending(true);
    setError(null);
    try {
      await api("/api/auth/unlock", { body: { pin }, handleAuth: false });
      setDone(true);
      // Keep a fragment (e.g. a message shared into the app) across the redirect.
      router.replace(`${redirectTo}${window.location.hash}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "unauthorized") {
        // The session is gone (it expired, or was signed out elsewhere): sign in again.
        window.location.replace("/login");
        return;
      }
      setError(errorMessage(err));
      setPin("");
      setPending(false);
      void shake.start({ x: [0, -8, 7, -5, 3, 0], transition: { duration: 0.36 } });
      inputRef.current?.focus();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <motion.div animate={shake}>
        <Field label="PIN" hideLabel error={error}>
          <Input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(digitsOnly(e.target.value))}
            className="h-12 rounded-lg text-center text-[17px] tracking-[0.3em] placeholder:tracking-normal"
            disabled={done}
          />
        </Field>
      </motion.div>
      <Button type="submit" size="lg" loading={pending || done} disabled={pin.length < 4} className="w-full">
        Unlock
      </Button>
    </form>
  );
}
