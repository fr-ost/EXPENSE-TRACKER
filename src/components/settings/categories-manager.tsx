"use client";

import { PlusIcon } from "lucide-react";
import * as React from "react";
import { IconBadge, paletteVar } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SCOPE_META, type CategoryKind } from "@/lib/domain";
import type { CategoryWithUsage } from "@/lib/types";
import { CategorySheet } from "./category-sheet";

export function CategoriesManager({ categories }: { categories: CategoryWithUsage[] }) {
  const [kind, setKind] = React.useState<CategoryKind>("EXPENSE");
  const [sheet, setSheet] = React.useState<{ key: number; open: boolean; category?: CategoryWithUsage }>({ key: 0, open: false });
  const open = (category?: CategoryWithUsage) => setSheet((s) => ({ key: s.key + 1, open: true, category }));
  const visible = categories.filter((c) => c.kind === kind).sort((a, b) => Number(a.isArchived) - Number(b.isArchived));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          ariaLabel="Category kind"
          size="sm"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "EXPENSE", label: "Expenses" },
            { value: "INCOME", label: "Income" },
          ]}
        />
        <Button variant="outline" size="sm" onClick={() => open()}>
          <PlusIcon />
          {kind === "EXPENSE" ? "Add category" : "Add source"}
        </Button>
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {visible.map((category) => (
          <li key={category.id}>
            <button
              type="button"
              onClick={() => open(category)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none"
            >
              <IconBadge icon={category.icon} color={category.color} size="sm" className={category.isArchived ? "opacity-40" : undefined} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-body font-medium text-text">
                  <span className="truncate">{category.name}</span>
                  {category.isArchived && <Badge>Archived</Badge>}
                </span>
                <span className="inline-flex items-center gap-1.5 text-caption text-text-tertiary">
                  {category.defaultScope && (
                    <>
                      <span aria-hidden className="size-1.5 rounded-full" style={{ background: paletteVar(SCOPE_META[category.defaultScope].color) }} />
                      {SCOPE_META[category.defaultScope].label} ·{" "}
                    </>
                  )}
                  {category.transactionCount} {category.transactionCount === 1 ? "transaction" : "transactions"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <CategorySheet key={sheet.key} open={sheet.open} onOpenChange={(v) => setSheet((s) => ({ ...s, open: v }))} category={sheet.category} kind={kind} />
    </div>
  );
}
