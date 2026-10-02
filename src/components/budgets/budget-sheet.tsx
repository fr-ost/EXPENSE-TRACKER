"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { useAppData, useFormatMoney } from "@/components/app-data";
import { AmountInput } from "@/components/forms/amount-input";
import { IconBadge } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveSheet } from "@/components/ui/sheet";
import { guardSheet } from "@/components/ui/sheet-error-boundary";
import { api, errorMessage } from "@/lib/api-client";
import { formatMonth, type MonthKey } from "@/lib/dates";
import type { BudgetLine } from "@/lib/types";

/** A crash inside closes the sheet with a message instead of breaking the page. */
export const BudgetSheet = guardSheet(BudgetSheetContent);

function BudgetSheetContent({
  open,
  onOpenChange,
  month,
  line,
  initialCategoryId,
  budgetedIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: MonthKey;
  line?: BudgetLine;
  initialCategoryId?: string;
  budgetedIds: string[];
}) {
  const router = useRouter();
  const { categories } = useAppData();
  const format = useFormatMoney();
  const choices = categories.filter((c) => c.kind === "EXPENSE" && !c.isArchived && (!budgetedIds.includes(c.id) || c.id === line?.category.id));
  const [categoryId, setCategoryId] = React.useState(line?.category.id ?? initialCategoryId ?? "");
  const [amount, setAmount] = React.useState(line ? line.budget.replace(/\.00$/, "") : "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"save" | "remove" | null>(null);

  async function save(value: string, action: "save" | "remove") {
    if (!categoryId) return setError("Choose a category.");
    if (action === "save" && (!value || /^0*(\.0*)?$/.test(value))) return setError("Enter a monthly amount.");
    setPending(action);
    try {
      await api("/api/budgets", { method: "PUT", body: { categoryId, month, amount: value } });
      const name = categories.find((c) => c.id === categoryId)?.name ?? "Budget";
      toast.success(action === "remove" ? `${name} budget removed` : `${name}: ${format(value)} a month`, {
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
      title={line ? `${line.category.name} budget` : "New budget"}
      description={`Applies from ${formatMonth(month)} onward. Earlier months keep their own budget.`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {line && (
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
        {!line && (
          <Field label="Category">
            <Select value={categoryId || undefined} onValueChange={(v) => { setCategoryId(v); setError(null); }}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <IconBadge icon={c.icon} color={c.color} size="sm" className="size-6 rounded-[7px] [&_svg]:size-3.5" />
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <AmountInput label="Monthly budget" value={amount} onChange={(v) => { setAmount(v); setError(null); }} currency="BDT" error={error} autoFocus />
        {line && (
          <p className="text-center text-small text-text-tertiary">
            Spent {format(line.spent)} of {format(line.budget)} in {formatMonth(month)}
          </p>
        )}
      </form>
    </ResponsiveSheet>
  );
}
