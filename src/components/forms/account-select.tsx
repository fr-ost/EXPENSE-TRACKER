"use client";

import { Amount } from "@/components/app-data";
import { IconBadge } from "@/components/icon";
import { Field } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACCOUNT_TYPE_META } from "@/lib/domain";
import type { AccountSummary } from "@/lib/types";

export function accountIcon(account: Pick<AccountSummary, "icon" | "type">) {
  return account.icon ?? ACCOUNT_TYPE_META[account.type].icon;
}

export function AccountSelect({
  label,
  accounts,
  value,
  onChange,
  error,
  disabledId,
  placeholder = "Choose account",
}: {
  label: string;
  accounts: AccountSummary[];
  value: string;
  onChange: (id: string) => void;
  error?: string | null;
  /** An account that can't be chosen (e.g. the other side of a transfer). */
  disabledId?: string;
  placeholder?: string;
}) {
  return (
    <Field label={label} error={error}>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-11">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem
              key={account.id}
              value={account.id}
              disabled={account.id === disabledId}
              trailing={<Amount value={account.balance} currency={account.currency} />}
            >
              <IconBadge icon={accountIcon(account)} color={account.color ?? "slate"} size="sm" className="size-6 rounded-[7px] [&_svg]:size-3.5" />
              <span className="truncate">{account.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
