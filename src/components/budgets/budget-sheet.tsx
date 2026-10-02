"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { useAppData, useFormatMoney } from "@/components/app-data";
import { AmountInput } from "@/components/forms/amount-input";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/sheet";
import { guardSheet } from "@/components/ui/sheet-error-boundary";
import { api, errorMessage } from "@/lib/api-client";
import { formatMonth, type MonthKey } from "@/lib/dates";
import { SCOPE_META } from "@/lib/domain";
import type { BudgetLine } from "@/lib/types";

/** A crash inside closes the sheet with a message instead of breaking the page. */
export const BudgetSheet = guardSheet(BudgetSheetContent);

/** The monthly limit for Personal or Family spending. */
function BudgetSheetContent({
  open,
  onOpenChange,
  month,
  line,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: MonthKey;
  line: BudgetLine;
}) {
  const router = useRouter();
  const { settings } = useAppData();
  const format = useFormatMoney();
  const label = SCOPE_META[line.scope].label;
  const [amount, setAmount] = React.useState(line.budget ? line.budget.replace(/\.00$/, "") : "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"save" | "remove" | null>(null);

  async function save(value: string, action: "save" | "remove") {
    if (action === "save" && (!value || /^0*(\.0*)?$/.test(value))) return setError("Enter a monthly amount.");
    setPending(action);
    try {
      await api("/api/budgets", { method: "PUT", body: { scope: line.scope, month, amount: value } });
      toast.success(action === "remove" ? `${label} budget removed` : `${label}: ${format(value)} a month`, {
        description: `From ${formatMonth(month)} onward`,
      });
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      // Re-enable only on failure: after success the sheet is closing and must not submit twice.
      setPending(null);
      toast.error(errorMessage(err));
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${label} budget`}
      description={`Everything marked “${label}” counts, whatever the category. Applies from ${formatMonth(month)} onward.`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {line.budget && (
            <Button variant="ghost" className="text-negative-text hover:bg-negative-soft hover:text-negative-text" loading={pending === "remove"} onClick={() => void save("0", "remove")}>
              Remove budget
            </Button>
          )}
          <Button className="sm:ml-auto" size="lg" loading={pending === "save"} onClick={() => void save(amount, "save")}>
            Save budget
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save(amount, "save");
        }}
      >
        <AmountInput
          label="Monthly budget"
          value={amount}
          onChange={(v) => {
            setAmount(v);
            setError(null);
          }}
          currency={settings.baseCurrency}
          error={error}
          autoFocus
        />
        <p className="text-center text-small text-text-tertiary">
          {format(line.spent)} spent for {label.toLowerCase()} in {formatMonth(month)}
          {line.budget && ` · budget ${format(line.budget)}`}
        </p>
      </form>
    </ResponsiveSheet>
  );
}
