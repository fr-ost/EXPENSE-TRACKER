"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface FieldContextValue {
  id: string;
  errorId: string;
  hintId: string;
  invalid: boolean;
  hasHint: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

/** Props to spread onto the control inside a <Field> for accessible wiring. */
export function useFieldControl() {
  const ctx = React.useContext(FieldContext);
  if (!ctx) return {};
  const describedBy = [ctx.hasHint ? ctx.hintId : null, ctx.invalid ? ctx.errorId : null].filter(Boolean).join(" ");
  return {
    id: ctx.id,
    "aria-invalid": ctx.invalid || undefined,
    "aria-describedby": describedBy || undefined,
  } as const;
}

interface FieldProps {
  label: React.ReactNode;
  error?: string | null;
  hint?: React.ReactNode;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function Field({ label, error, hint, hideLabel, optional, className, children, action }: FieldProps) {
  const id = React.useId();
  const value: FieldContextValue = {
    id,
    errorId: `${id}-error`,
    hintId: `${id}-hint`,
    invalid: !!error,
    hasHint: !!hint,
  };
  return (
    <FieldContext.Provider value={value}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div className={cn("flex items-baseline justify-between gap-2", hideLabel && "sr-only")}>
          <label htmlFor={id} className="text-small font-medium text-text-secondary">
            {label}
            {optional && <span className="ml-1 font-normal text-text-tertiary">(optional)</span>}
          </label>
          {action}
        </div>
        {children}
        {hint && !error && (
          <p id={value.hintId} className="text-caption text-text-tertiary">
            {hint}
          </p>
        )}
        {error && (
          <p id={value.errorId} role="alert" className="text-caption font-medium text-negative-text">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
