"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { type ClientSettings } from "@/components/app-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { AUTO_LOCK_OPTIONS, CURRENCIES, NUMBER_FORMAT_LABELS, NUMBER_FORMATS, type NumberFormat } from "@/lib/domain";
import { formatMoney } from "@/lib/money";

function CurrencySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
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
  );
}

export function autoLockLabel(minutes: number) {
  if (minutes === 0) return "Never";
  return minutes === 1 ? "After 1 minute" : minutes === 60 ? "After 1 hour" : `After ${minutes} minutes`;
}

export function PreferencesForm({ settings, timezones }: { settings: ClientSettings; timezones: string[] }) {
  const router = useRouter();
  const [values, setValues] = React.useState(settings);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(settings);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await api("/api/settings", { method: "PUT", body: values });
      toast.success("Preferences saved");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) setErrors(error.fieldErrors);
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const set = <K extends keyof ClientSettings>(key: K, value: ClientSettings[K]) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Your name" optional hint="Used in the greeting on the overview." error={errors.displayName}>
          <Input value={values.displayName} onChange={(e) => set("displayName", e.target.value)} maxLength={60} placeholder="e.g. Rafi" />
        </Field>
        <Field label="Main currency" hint="Totals are shown in it; other currencies count at their exchange rate." error={errors.baseCurrency}>
          <CurrencySelect value={values.baseCurrency} onChange={(v) => set("baseCurrency", v)} />
        </Field>
        <Field label="Income usually in" hint="A new income starts on an account in this currency." error={errors.incomeCurrency}>
          <CurrencySelect value={values.incomeCurrency ?? values.baseCurrency} onChange={(v) => set("incomeCurrency", v)} />
        </Field>
        <Field label="Spending usually in" hint="A new expense starts on an account in this currency." error={errors.expenseCurrency}>
          <CurrencySelect value={values.expenseCurrency ?? values.baseCurrency} onChange={(v) => set("expenseCurrency", v)} />
        </Field>
        <Field label="Timezone" hint="Decides what “today” is." error={errors.timezone}>
          <Select value={values.timezone} onValueChange={(v) => set("timezone", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Auto-lock" hint="Lock after this long without activity." error={errors.autoLockMinutes}>
          <Select value={String(values.autoLockMinutes)} onValueChange={(v) => set("autoLockMinutes", Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTO_LOCK_OPTIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {autoLockLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-small font-medium text-text-secondary">Number format</span>
        <SegmentedControl
          className="self-start"
          ariaLabel="Number format"
          value={values.numberFormat}
          onValueChange={(v: NumberFormat) => set("numberFormat", v)}
          options={NUMBER_FORMATS.map((f) => ({ value: f, label: NUMBER_FORMAT_LABELS[f].split(" ")[0] }))}
        />
        <span className="text-caption text-text-tertiary">
          {NUMBER_FORMAT_LABELS[values.numberFormat]} — e.g. {formatMoney("1250000", { currency: values.baseCurrency, grouping: values.numberFormat })}
        </span>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={pending} disabled={!dirty}>
          Save preferences
        </Button>
      </div>
    </form>
  );
}
