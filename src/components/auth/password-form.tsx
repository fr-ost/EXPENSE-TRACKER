"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { motion, useAnimationControls } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";

export function PasswordForm({
  endpoint,
  submitLabel,
  redirectTo,
  notice,
}: {
  endpoint: "/api/auth/login" | "/api/auth/unlock";
  submitLabel: string;
  redirectTo: string;
  /** Shown above the field until the first attempt (e.g. why you were signed out). */
  notice?: string;
}) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [error, setError] = React.useState<string | null>(notice ?? null);
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const shake = useAnimationControls();
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!password || pending) return;
    setPending(true);
    setError(null);
    try {
      await api(endpoint, { body: { password }, handleAuth: false });
      setDone(true);
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && (err.code === "signed_out" || (endpoint === "/api/auth/unlock" && err.code === "unauthorized"))) {
        // The session is gone (too many wrong passwords, or it expired): sign in again.
        window.location.replace(err.code === "signed_out" ? "/login?reason=signed-out" : "/login");
        return;
      }
      setError(errorMessage(err));
      setPassword("");
      setPending(false);
      void shake.start({ x: [0, -8, 7, -5, 3, 0], transition: { duration: 0.36 } });
      inputRef.current?.focus();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <motion.div animate={shake}>
        <Field label="Password" hideLabel error={error}>
          <div className="relative">
            <Input
              ref={inputRef}
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              autoFocus
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 rounded-lg pr-12 text-[15px]"
              maxLength={256}
              disabled={done}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="absolute right-1.5 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text"
              aria-label={visible ? "Hide password" : "Show password"}
              aria-pressed={visible}
            >
              {visible ? <EyeOffIcon className="size-[18px]" /> : <EyeIcon className="size-[18px]" />}
            </button>
          </div>
        </Field>
      </motion.div>
      <Button type="submit" size="lg" loading={pending || done} disabled={!password} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
