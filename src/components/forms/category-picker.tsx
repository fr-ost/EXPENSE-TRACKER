"use client";

import * as React from "react";
import { AppIcon, paletteVar } from "@/components/icon";
import type { CategoryRef } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Fast, one-tap category choice as a wrap of chips (radio group semantics). */
export function CategoryPicker({
  categories,
  value,
  onChange,
  label,
  error,
}: {
  categories: CategoryRef[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  error?: string | null;
}) {
  const labelId = React.useId();
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = categories.findIndex((c) => c.id === value);

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + categories.length) % categories.length;
    onChange(categories[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-small font-medium text-text-secondary">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} aria-invalid={!!error || undefined} className="flex flex-wrap gap-1.5">
        {categories.map((category, index) => {
          const selected = category.id === value;
          const color = paletteVar(category.color);
          return (
            <button
              key={category.id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (selectedIndex === -1 && index === 0) ? 0 : -1}
              onClick={() => onChange(category.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              style={selected ? ({ "--chip": color } as React.CSSProperties) : undefined}
              className={cn(
                "relative inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-full border pl-2 pr-3 text-small font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
                selected
                  ? "border-[color:var(--chip)] text-text"
                  : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
              )}
            >
              {selected && <span aria-hidden className="absolute inset-0 bg-[color:var(--chip)] opacity-[0.09]" />}
              <span className="relative inline-flex size-5 items-center justify-center [&_svg]:size-[15px]" style={{ color }}>
                <AppIcon name={category.icon} />
              </span>
              <span className="relative">{category.name}</span>
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-caption font-medium text-negative-text">
          {error}
        </p>
      )}
    </div>
  );
}
