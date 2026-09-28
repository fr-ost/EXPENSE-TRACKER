"use client";

import Link from "next/link";
import { Amount, useAppData } from "@/components/app-data";
import { IconBadge } from "@/components/icon";
import { accountIcon } from "@/components/forms/account-select";
import { ACCOUNT_TYPE_META } from "@/lib/domain";
import { describeDay } from "@/lib/dates";
import type { AccountSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AccountCard({ account, today }: { account: AccountSummary; today: string }) {
  const { settings } = useAppData();
  return (
    <Link
      href={`/accounts/${account.id}`}
      className={cn(
        "group flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 shadow-xs transition-[border-color,box-shadow,transform] duration-200",
        "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
        !account.isActive && "opacity-70",
      )}
    >
      <div className="flex items-center gap-3">
        <IconBadge icon={accountIcon(account)} color={account.color ?? "slate"} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-body font-semibold text-text">{account.name}</span>
          <span className="text-small text-text-tertiary">
            {ACCOUNT_TYPE_META[account.type].label}
            {account.currency !== settings.baseCurrency && ` · ${account.currency}`}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Amount
          value={account.balance}
          currency={account.currency}
          tabular={false}
          tone={account.balance.startsWith("-") ? "signed" : "none"}
          className="text-[1.625rem] font-semibold leading-none tracking-[-0.025em]"
        />
        <span className="text-small text-text-tertiary">
          {account.lastActivity ? `Last activity ${describeDay(account.lastActivity, today)}` : "No transactions yet"}
        </span>
      </div>
    </Link>
  );
}
