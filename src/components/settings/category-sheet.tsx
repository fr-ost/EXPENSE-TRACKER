"use client";

import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { PalettePicker } from "@/components/forms/palette-picker";
import { AppIcon, IconBadge, paletteVar } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ResponsiveSheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useAutoFocusFields } from "@/hooks/use-media-query";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { EXPENSE_SCOPES, ICON_KEYS, SCOPE_META, isIconKey, isPaletteKey, type CategoryKind, type ExpenseScope, type IconKey, type PaletteKey } from "@/lib/domain";
import type { CategoryWithUsage } from "@/lib/types";
import { categoryInput, fieldErrorsOf } from "@/lib/validation";
import { cn } from "@/lib/utils";

/** Icons that make sense for categories (account-type glyphs excluded). */
const CATEGORY_ICONS = ICON_KEYS.filter((k) => !["landmark", "smartphone", "credit-card", "arrow-left-right", "vault", "scale"].includes(k));

export function CategorySheet({
  open,
  onOpenChange,
  category,
  kind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: CategoryWithUsage;
  kind: CategoryKind;
}) {
  const router = useRouter();
  const canAutoFocus = useAutoFocusFields();
  const [name, setName] = React.useState(category?.name ?? "");
  const [icon, setIcon] = React.useState<IconKey>(isIconKey(category?.icon) ? category.icon : "circle-dashed");
  const [color, setColor] = React.useState<PaletteKey>(isPaletteKey(category?.color) ? category.color : "blue");
  const [scope, setScope] = React.useState<ExpenseScope>(category?.defaultScope ?? "PERSONAL");
  const [archived, setArchived] = React.useState(category?.isArchived ?? false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const categoryKind = category?.kind ?? kind;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = categoryInput.safeParse({ name, kind: categoryKind, defaultScope: categoryKind === "EXPENSE" ? scope : null, icon, color, isArchived: archived });
    if (!parsed.success) return setErrors(fieldErrorsOf(parsed.error));
    setPending(true);
    try {
      if (category) await api(`/api/categories/${category.id}`, { method: "PUT", body: parsed.data });
      else await api("/api/categories", { body: parsed.data });
      toast.success(category ? "Category updated" : `${parsed.data.name} added`);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      // Re-enable only on failure: after success the sheet is closing and must not submit twice.
      setPending(false);
      if (error instanceof ApiClientError) setErrors(error.fieldErrors);
      toast.error(errorMessage(error));
    }
  }

  async function remove() {
    if (!category) return;
    setDeleting(true);
    try {
      await api(`/api/categories/${category.id}`, { method: "DELETE" });
      toast.success(`${category.name} deleted`);
      setConfirmDelete(false);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title={category ? "Edit category" : categoryKind === "EXPENSE" ? "New expense category" : "New income source"}
        footer={
          <div className="flex items-center gap-2">
            {category && (
              <Button variant="ghost" size="icon" aria-label="Delete category" onClick={() => setConfirmDelete(true)} className="text-negative-text hover:bg-negative-soft hover:text-negative-text">
                <Trash2Icon />
              </Button>
            )}
            <Button type="submit" form="category-form" loading={pending} size="lg" className="flex-1 sm:ml-auto sm:h-10 sm:flex-none sm:text-body">
              {category ? "Save changes" : "Add category"}
            </Button>
          </div>
        }
      >
        <form id="category-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
          <div className="flex items-end gap-3">
            <IconBadge icon={icon} color={color} size="lg" />
            <Field label="Name" error={errors.name} className="flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus={!category && canAutoFocus} className="h-11" />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-small font-medium text-text-secondary">Icon</span>
            <div role="radiogroup" aria-label="Icon" className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
              {CATEGORY_ICONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={key === icon}
                  aria-label={key.replace(/-/g, " ")}
                  onClick={() => setIcon(key)}
                  className={cn(
                    "inline-flex aspect-square items-center justify-center rounded-md border transition-colors [&_svg]:size-4",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
                    key === icon ? "border-ink bg-surface-subtle" : "border-transparent text-text-secondary hover:bg-surface-muted",
                  )}
                  style={key === icon ? { color: paletteVar(color) } : undefined}
                >
                  <AppIcon name={key} />
                </button>
              ))}
            </div>
          </div>

          <PalettePicker value={color} onChange={setColor} />

          {categoryKind === "EXPENSE" && (
            <div className="flex flex-col gap-2">
              <span className="text-small font-medium text-text-secondary">Usually spent for</span>
              <SegmentedControl
                ariaLabel="Default classification"
                block
                value={scope}
                onValueChange={setScope}
                options={EXPENSE_SCOPES.map((s) => ({ value: s, label: SCOPE_META[s].label }))}
              />
              <span className="text-caption text-text-tertiary">Pre-selected when you pick this category. You can change it per transaction.</span>
            </div>
          )}

          {category && (
            <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
              <span className="flex flex-col">
                <span className="text-body font-medium text-text">Archived</span>
                <span className="text-small text-text-tertiary">Hidden when adding transactions; history and reports keep it.</span>
              </span>
              <Switch checked={archived} onCheckedChange={setArchived} aria-label="Archived" />
            </label>
          )}
        </form>
      </ResponsiveSheet>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${category?.name ?? "category"}?`}
        description={
          category && category.transactionCount > 0
            ? "Categories with transactions can't be deleted — archive it instead to hide it while keeping history."
            : "It has no transactions and will be removed permanently."
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={remove}
      />
    </>
  );
}
