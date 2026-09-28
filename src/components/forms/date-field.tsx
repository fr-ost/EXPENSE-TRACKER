"use client";

import { ClockIcon, XIcon } from "lucide-react";
import * as React from "react";
import { addDays, addYears, type ISODate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const chip = "h-6 rounded-full px-2 text-caption font-medium transition-colors";

/**
 * Native date input (reliable keyboard entry and platform pickers, which
 * matters for back-filling old transactions) with quick picks. With
 * `onTimeChange`, an optional time of day can be added below the date.
 */
export function DateField({
  value,
  onChange,
  today,
  error,
  label = "Date",
  quickPicks = true,
  allowFuture = true,
  time,
  onTimeChange,
  timeError,
}: {
  value: ISODate;
  onChange: (value: ISODate) => void;
  today: ISODate;
  error?: string | null;
  label?: string;
  quickPicks?: boolean;
  allowFuture?: boolean;
  /** "HH:MM" or "" for none. */
  time?: string;
  onTimeChange?: (time: string) => void;
  timeError?: string | null;
}) {
  const yesterday = addDays(today, -1);
  const timeId = React.useId();
  const timeRef = React.useRef<HTMLInputElement>(null);
  const [timeOpen, setTimeOpen] = React.useState(!!time);
  const showTime = !!onTimeChange && (timeOpen || !!time);
  const picks = [
    { label: "Today", value: today },
    { label: "Yesterday", value: yesterday },
  ];
  return (
    <Field
      label={label}
      error={error ?? timeError}
      action={
        quickPicks || (onTimeChange && !showTime) ? (
          <div className="flex gap-1">
            {quickPicks &&
              picks.map((pick) => (
                <button
                  key={pick.label}
                  type="button"
                  onClick={() => onChange(pick.value)}
                  aria-pressed={value === pick.value}
                  className={cn(
                    chip,
                    value === pick.value ? "bg-ink text-white" : "text-text-tertiary hover:bg-surface-muted hover:text-text",
                  )}
                >
                  {pick.label}
                </button>
              ))}
            {onTimeChange && !showTime && (
              <button
                type="button"
                onClick={() => {
                  setTimeOpen(true);
                  requestAnimationFrame(() => timeRef.current?.focus());
                }}
                className={cn(chip, "inline-flex items-center gap-1 text-text-tertiary hover:bg-surface-muted hover:text-text")}
              >
                <ClockIcon className="size-3" aria-hidden />
                Time
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      <Input
        type="date"
        value={value}
        min="1900-01-01"
        max={allowFuture ? addYears(today, 1) : today}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="h-11 tabular"
      />
      {showTime && (
        <div className="flex items-center gap-2">
          <label htmlFor={timeId} className="sr-only">
            Time
          </label>
          <Input
            ref={timeRef}
            id={timeId}
            type="time"
            value={time ?? ""}
            onChange={(e) => onTimeChange?.(e.target.value.slice(0, 5))}
            aria-invalid={!!timeError || undefined}
            className="h-10 w-36 tabular"
          />
          <button
            type="button"
            onClick={() => {
              onTimeChange?.("");
              setTimeOpen(false);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-small text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text"
          >
            <XIcon className="size-3.5" aria-hidden />
            Remove time
          </button>
        </div>
      )}
    </Field>
  );
}
