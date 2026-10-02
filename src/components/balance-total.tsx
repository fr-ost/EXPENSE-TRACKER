"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { AnimatedAmount } from "@/components/animated-amount";
import { Amount, useAppData } from "@/components/app-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/dates";
import { currencySymbol, isRate } from "@/lib/money";
import type { BalanceTotals, ForeignCurrency } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Everything you hold, added up in the main currency (big), then what each
 * currency holds on its own (small). Other currencies count at their rate;
 * one without a rate yet asks for it right here.
 */
export function BalanceTotal({
  totals,
  foreign,
  variant = "page",
  label = "Total balance",
}: {
  totals: BalanceTotals;
  foreign: ForeignCurrency[];
  variant?: "hero" | "page";
  label?: string;
}) {
  const { settings, accounts } = useAppData();
  const negative = totals.total.startsWith("-");
  const several = totals.byCurrency.length > 1;
  const missing = foreign.filter((f) => !f.rate && totals.byCurrency.some((c) => c.currency === f.currency));
  const rated = foreign.filter((f) => f.rate);

  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <span className="text-small font-medium text-text-tertiary">{label}</span>
      {variant === "hero" ? (
        <AnimatedAmount
          value={totals.total}
          className={cn("text-[clamp(2.25rem,11.5vw,3.5rem)] font-semibold leading-none tracking-[-0.04em]", negative ? "text-negative-text" : "text-text")}
        />
      ) : (
        <Amount value={totals.total} tabular={false} tone={negative ? "signed" : "none"} className="text-[2.25rem] font-semibold leading-none tracking-[-0.03em]" />
      )}
      {!several && (
        <span className="text-small text-text-tertiary">
          Across {accounts.filter((a) => a.isActive).length} {accounts.filter((a) => a.isActive).length === 1 ? "account" : "accounts"}
        </span>
      )}
      {several && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-small text-text-tertiary">
          {totals.byCurrency.map((c) => (
            <span key={c.currency} className="whitespace-nowrap">
              <Amount value={c.total} currency={c.currency} className="font-medium text-text-secondary" /> in {c.currency}
              {!c.rate && " (not counted)"}
            </span>
          ))}
        </p>
      )}
      {rated.length > 0 && (
        <p className="text-caption text-text-tertiary">
          {rated.map((f, i) => (
            <React.Fragment key={f.currency}>
              {i > 0 && " · "}
              {currencySymbol(f.currency).trim()}1 = {currencySymbol(settings.baseCurrency).trim()}
              {f.rate}
              {f.source === "conversion" && f.lastConversion && <> (your conversion on {formatDate(f.lastConversion.date, "short")})</>}
            </React.Fragment>
          ))}{" "}
          ·{" "}
          <Link href="/settings#rates" className="font-medium text-accent-text hover:underline">
            Change
          </Link>
        </p>
      )}
      {missing.map((f) => (
        <RatePrompt key={f.currency} currency={f.currency} />
      ))}
    </section>
  );
}

/** "Add the rate to count your dollars": one field, saved as your own rate. */
export function RatePrompt({ currency }: { currency: string }) {
  const router = useRouter();
  const { settings } = useAppData();
  const [rate, setRate] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const id = React.useId();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!isRate(rate)) return toast.error("Enter a rate above 0, like 122.50");
    setPending(true);
    try {
      await api("/api/settings/rates", { method: "PUT", body: { currency, rate } });
      toast.success(`${currency} now counts in your totals`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-small">
      <label htmlFor={id} className="text-text-secondary">
        Add the {currency} rate to count it: {currencySymbol(currency).trim()}1 = {currencySymbol(settings.baseCurrency).trim()}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        value={rate}
        onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder="122.50"
        className="h-8 w-24 tabular"
      />
      <Button type="submit" size="sm" loading={pending}>
        Save
      </Button>
    </form>
  );
}
