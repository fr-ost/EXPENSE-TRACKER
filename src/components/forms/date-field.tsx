"use client";

import { addDays, addYears, type ISODate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Native date input (reliable keyboard entry and platform pickers, which
 * matters for back-filling old transactions) with quick picks.
 */
export function DateField({
  value,
  onChange,
  today,
  error,
  label = "Date",
  quickPicks = true,
  allowFuture = true,
}: {
  value: ISODate;
  onChange: (value: ISODate) => void;
  today: ISODate;
  error?: string | null;
  label?: string;
  quickPicks?: boolean;
  allowFuture?: boolean;
}) {
  const yesterday = addDays(today, -1);
  const picks = [
    { label: "Today", value: today },
    { label: "Yesterday", value: yesterday },
  ];
  return (
    <Field
      label={label}
      error={error}
      action={
        quickPicks ? (
          <div className="flex gap-1">
            {picks.map((pick) => (
              <button
                key={pick.label}
                type="button"
                onClick={() => onChange(pick.value)}
                aria-pressed={value === pick.value}
                className={cn(
                  "h-6 rounded-full px-2 text-caption font-medium transition-colors",
                  value === pick.value ? "bg-ink text-white" : "text-text-tertiary hover:bg-surface-muted hover:text-text",
                )}
              >
                {pick.label}
              </button>
            ))}
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
    </Field>
  );
}
