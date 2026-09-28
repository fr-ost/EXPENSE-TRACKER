"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { useAppData } from "@/components/app-data";
import { DateField } from "@/components/forms/date-field";
import { PalettePicker } from "@/components/forms/palette-picker";
import { AppIcon, paletteVar } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveSheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { ACCOUNT_TYPE_META, ACCOUNT_TYPES, CURRENCIES, isPaletteKey, type AccountType, type PaletteKey } from "@/lib/domain";
import { sanitizeAmountInput } from "@/lib/money";
import type { AccountSummary } from "@/lib/types";
import { accountInput, fieldErrorsOf } from "@/lib/validation";
import { cn } from "@/lib/utils";

const DEFAULT_COLORS: Record<AccountType, PaletteKey> = {
  CASH: "green",
  BANK: "blue",
  MOBILE_WALLET: "rose",
  CARD: "indigo",
  EXCHANGE: "amber",
  OTHER: "slate",
};

export function AccountFormSheet({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: AccountSummary;
}) {
  const router = useRouter();
  const { settings, today } = useAppData();
  const formId = React.useId();
  const editing = !!account;
  const hasHistory = (account?.transactionCount ?? 0) > 0;

  const initialBalance = account?.openingBalance ?? "0";
  const [name, setName] = React.useState(account?.name ?? "");
  const [type, setType] = React.useState<AccountType>(account?.type ?? "CASH");
  const [currency, setCurrency] = React.useState(account?.currency ?? settings.baseCurrency);
  const [negative, setNegative] = React.useState(initialBalance.startsWith("-"));
  const [balance, setBalance] = React.useState(initialBalance.replace(/^-/, "").replace(/\.00$/, "").replace(/^0$/, ""));
  const [openingDate, setOpeningDate] = React.useState(account?.openingDate ?? today);
  const [color, setColor] = React.useState<PaletteKey>(isPaletteKey(account?.color) ? account.color : DEFAULT_COLORS[account?.type ?? "CASH"]);
  const [colorTouched, setColorTouched] = React.useState(!!account?.color);
  const [isActive, setIsActive] = React.useState(account?.isActive ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  const chooseType = (next: AccountType) => {
    setType(next);
    if (!colorTouched) setColor(DEFAULT_COLORS[next]);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      name,
      type,
      currency,
      openingBalance: `${negative && balance ? "-" : ""}${balance || "0"}`,
      openingDate,
      icon: account?.icon ?? null,
      color,
      isActive,
    };
    const parsed = accountInput.safeParse(payload);
    if (!parsed.success) return setErrors(fieldErrorsOf(parsed.error));
    setPending(true);
    try {
      if (editing) {
        await api(`/api/accounts/${account.id}`, { method: "PUT", body: parsed.data });
        toast.success("Account updated");
      } else {
        await api("/api/accounts", { body: parsed.data });
        toast.success(`${parsed.data.name} added`);
      }
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      // Re-enable only on failure: after success the sheet is closing and must not submit twice.
      setPending(false);
      if (error instanceof ApiClientError) setErrors(error.fieldErrors);
      toast.error(errorMessage(error));
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit account" : "New account"}
      description={editing ? undefined : "Where your money physically lives."}
      footer={
        <div className="flex gap-2 sm:justify-end">
          <Button variant="secondary" className="hidden sm:inline-flex" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={pending} size="lg" className="flex-1 sm:h-10 sm:flex-none sm:text-body">
            {editing ? "Save changes" : "Add account"}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field label="Name" error={errors.name}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "MOBILE_WALLET" ? "e.g. bKash" : type === "BANK" ? "e.g. City Bank savings" : "e.g. Cash wallet"}
            maxLength={60}
            autoFocus={!editing}
            className="h-11"
          />
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-small font-medium text-text-secondary">Type</span>
          <div role="radiogroup" aria-label="Account type" className="grid grid-cols-3 gap-2">
            {ACCOUNT_TYPES.map((option) => {
              const selected = option === type;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => chooseType(option)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-small font-medium transition-[border-color,background-color,color] duration-150",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
                    selected ? "border-ink bg-surface-subtle text-text" : "border-border text-text-secondary hover:border-border-strong",
                  )}
                >
                  <span style={{ color: selected ? paletteVar(color) : undefined }} className="[&_svg]:size-5">
                    <AppIcon name={ACCOUNT_TYPE_META[option].icon} />
                  </span>
                  {ACCOUNT_TYPE_META[option].label}
                </button>
              );
            })}
          </div>
          <p className="text-caption text-text-tertiary">{ACCOUNT_TYPE_META[type].hint}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
          <Field
            label="Opening balance"
            error={errors.openingBalance}
            hint={type === "CARD" ? "For a credit card, use − for the amount you owe." : undefined}
          >
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNegative((n) => !n)}
                aria-pressed={negative}
                aria-label={negative ? "Balance is negative" : "Balance is positive"}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-heading font-medium text-text-secondary shadow-xs hover:border-border-strong"
              >
                {negative ? "−" : "+"}
              </button>
              <Input
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(sanitizeAmountInput(e.target.value))}
                placeholder="0"
                className="h-11 tabular"
              />
            </div>
          </Field>
          <Field label="Currency" error={errors.currency} hint={editing && hasHistory ? "Fixed once there is history." : undefined}>
            <Select value={currency} onValueChange={setCurrency} disabled={editing && hasHistory}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code}
                    <span className="text-text-tertiary">{c.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <DateField
            label="Balance as of"
            value={openingDate}
            onChange={setOpeningDate}
            today={today}
            error={errors.openingDate}
            quickPicks={false}
            allowFuture={false}
          />
          {!errors.openingDate && (
            <p className="text-caption text-text-tertiary">
              What the account held at the start of this day. Older transactions you add later are kept as history and
              don&rsquo;t change the balance from this date on.
            </p>
          )}
        </div>

        <PalettePicker
          value={color}
          onChange={(key) => {
            setColor(key);
            setColorTouched(true);
          }}
        />

        {editing && (
          <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
            <span className="flex flex-col">
              <span className="text-body font-medium text-text">Active</span>
              <span className="text-small text-text-tertiary">Inactive accounts keep their history but are hidden when adding transactions.</span>
            </span>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Active" />
          </label>
        )}
      </form>
    </ResponsiveSheet>
  );
}
