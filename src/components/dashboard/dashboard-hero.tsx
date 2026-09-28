"use client";

import { Amount, useAppData } from "@/components/app-data";
import { AnimatedAmount } from "@/components/animated-amount";
import type { Money } from "@/lib/money";

/** The one number the dashboard leads with. */
export function DashboardHero({ total, foreign }: { total: Money; foreign: Array<{ currency: string; total: Money }> }) {
  const { accounts, settings } = useAppData();
  const count = accounts.filter((a) => a.isActive && a.currency === settings.baseCurrency).length;
  return (
    <section aria-label="Total balance" className="flex flex-col gap-2">
      <span className="text-small font-medium text-text-tertiary">Total balance</span>
      <AnimatedAmount
        value={total}
        className={`text-[2.75rem] font-semibold leading-none tracking-[-0.04em] sm:text-[3.5rem] ${total.startsWith("-") ? "text-negative-text" : "text-text"}`}
      />
      <span className="text-small text-text-tertiary">
        Across {count} {count === 1 ? "account" : "accounts"}
        {foreign.map((f) => (
          <span key={f.currency}>
            {" "}
            · <Amount value={f.total} currency={f.currency} className="text-text-secondary" /> in {f.currency}
          </span>
        ))}
      </span>
    </section>
  );
}
