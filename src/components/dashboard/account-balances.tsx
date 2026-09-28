"use client";

import Link from "next/link";
import { Amount, useAppData } from "@/components/app-data";
import { accountIcon } from "@/components/forms/account-select";
import { IconBadge } from "@/components/icon";
import { ACCOUNT_TYPE_META } from "@/lib/domain";

export function AccountBalances() {
  const { accounts } = useAppData();
  const visible = accounts.filter((a) => a.isActive);
  return (
    <ul className="flex flex-col">
      {visible.map((account) => (
        <li key={account.id}>
          <Link
            href={`/accounts/${account.id}`}
            className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-subtle"
          >
            <IconBadge icon={accountIcon(account)} color={account.color ?? "slate"} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-medium text-text">{account.name}</span>
              <span className="text-caption text-text-tertiary">{ACCOUNT_TYPE_META[account.type].label}</span>
            </span>
            <Amount
              value={account.balance}
              currency={account.currency}
              tone={account.balance.startsWith("-") ? "signed" : "none"}
              className="text-body font-medium"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
