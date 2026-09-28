"use client";

import * as React from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EXPENSE_SCOPES, SCOPE_META, type ExpenseScope } from "@/lib/domain";

const OPTIONS = EXPENSE_SCOPES.map((scope) => ({
  value: scope,
  label: SCOPE_META[scope].label,
  icon: (
    <span aria-hidden className="size-1.5 rounded-full" style={{ background: `var(--palette-${SCOPE_META[scope].color})` }} />
  ),
}));

export function ScopePicker({ value, onChange }: { value: ExpenseScope; onChange: (scope: ExpenseScope) => void }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-small font-medium text-text-secondary">
        Spent for
      </span>
      <SegmentedControl ariaLabel="Spent for" value={value} onValueChange={onChange} options={OPTIONS} block />
    </div>
  );
}
