"use client";

import * as React from "react";
import { useAppData } from "@/components/app-data";
import { useAutoFocusFields } from "@/hooks/use-media-query";
import { currencySymbol, groupAmountInput, sanitizeAmountInput } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The hero amount field: large, centred, auto-sizing, numeric keyboard on
 * phones. Shows digit grouping when not focused.
 */
export function AmountInput({
  value,
  onChange,
  currency,
  error,
  autoFocus,
  label = "Amount",
  tone = "neutral",
}: {
  value: string;
  onChange: (value: string) => void;
  currency: string;
  error?: string | null;
  autoFocus?: boolean;
  label?: string;
  tone?: "neutral" | "positive";
}) {
  const { settings } = useAppData();
  // On a phone the keyboard opens only when the field is tapped.
  const canAutoFocus = useAutoFocusFields();
  const [focused, setFocused] = React.useState(false);
  const id = React.useId();
  const display = focused ? value : groupAmountInput(value, settings.numberFormat);

  return (
    <div className="flex flex-col items-center gap-1 pb-1 pt-2">
      <label htmlFor={id} className="sr-only">
        {label} in {currency}
      </label>
      <div
        className={cn(
          "flex max-w-full items-baseline justify-center gap-1 transition-colors",
          tone === "positive" && value ? "text-positive-text" : "text-text",
        )}
      >
        <span className="translate-y-[-2px] text-[1.75rem] font-medium text-text-tertiary">
          {currencySymbol(currency).trim()}
        </span>
        {/* The hidden text sizes the box; the input sits on top of it, so the
            input's own intrinsic width never affects the layout. */}
        <span className="relative inline-block min-w-[1ch] max-w-[calc(100vw-7rem)]">
          <span
            aria-hidden
            className="invisible block overflow-hidden whitespace-pre text-[2.75rem] font-semibold tracking-[-0.03em] tabular sm:text-[3rem]"
          >
            {display || "0"}
          </span>
          <input
            id={id}
            size={1}
            inputMode="decimal"
            autoComplete="off"
            autoFocus={autoFocus && canAutoFocus}
            placeholder="0"
            value={display}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => onChange(sanitizeAmountInput(e.target.value))}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="absolute inset-0 w-full min-w-0 bg-transparent p-0 text-center text-[2.75rem] font-semibold tracking-[-0.03em] text-inherit tabular caret-accent outline-none placeholder:text-text-quaternary focus-visible:outline-none sm:text-[3rem]"
          />
        </span>
      </div>
      <p
        id={`${id}-error`}
        role={error ? "alert" : undefined}
        className={cn("h-4 text-caption font-medium text-negative-text transition-opacity", !error && "opacity-0")}
      >
        {error}
      </p>
    </div>
  );
}
