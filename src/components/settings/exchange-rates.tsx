"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/dates";
import { currencySymbol, isRate } from "@/lib/money";
import type { ForeignCurrency } from "@/lib/types";

/**
 * What each other currency is worth in the main one. Without your own rate,
 * the rate of your latest conversion (a transfer between the two) is used.
 */
export function ExchangeRates({ base, foreign }: { base: string; foreign: ForeignCurrency[] }) {
  if (!foreign.length) {
    return (
      <p className="text-body text-text-secondary">
        All your accounts are in {base}. Add an account in another currency and its rate can be set here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {foreign.map((f) => (
        <RateRow key={f.currency} base={base} item={f} />
      ))}
    </ul>
  );
}

function RateRow({ base, item }: { base: string; item: ForeignCurrency }) {
  const router = useRouter();
  const [value, setValue] = React.useState(item.manualRate ?? "");
  const [pending, setPending] = React.useState<"save" | "auto" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const dirty = value !== (item.manualRate ?? "");

  async function save(rate: string | null, action: "save" | "auto") {
    if (rate !== null && !isRate(rate)) return setError("Enter a rate above 0, like 122.50");
    setPending(action);
    try {
      await api("/api/settings/rates", { method: "PUT", body: { currency: item.currency, rate } });
      toast.success(rate === null ? `${item.currency} follows your latest conversion` : `1 ${item.currency} = ${rate} ${base}`);
      if (rate === null) setValue("");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-4 first:pt-1 last:pb-1">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save(value.trim() || null, "save");
        }}
      >
        <label htmlFor={id} className="text-body font-medium text-text">
          1 {item.currency} ({currencySymbol(item.currency).trim()}) =
        </label>
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/[^\d.]/g, ""));
            setError(null);
          }}
          placeholder={item.lastConversion?.rate ?? "Rate"}
          aria-invalid={!!error || undefined}
          className="h-10 w-32 tabular"
        />
        <span className="text-body text-text-secondary">{base}</span>
        <Button type="submit" size="sm" variant="secondary" loading={pending === "save"} disabled={!dirty}>
          Save
        </Button>
      </form>
      {error && <p className="text-caption font-medium text-negative-text">{error}</p>}
      <p className="text-caption text-text-tertiary">
        {item.source === "manual" ? (
          <>Your own rate. </>
        ) : item.source === "conversion" ? (
          <>Using your latest conversion. </>
        ) : (
          <>No rate yet: {item.currency} isn&rsquo;t counted in totals. </>
        )}
        {item.lastConversion && (
          <>
            Latest conversion: {item.lastConversion.rate} on {formatDate(item.lastConversion.date, "short")}.{" "}
          </>
        )}
        {item.source === "manual" && item.lastConversion && (
          <button type="button" className="font-medium text-accent-text hover:underline" disabled={pending !== null} onClick={() => void save(null, "auto")}>
            Use it instead
          </button>
        )}
      </p>
    </li>
  );
}
