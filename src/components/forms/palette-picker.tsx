"use client";

import { CheckIcon } from "lucide-react";
import * as React from "react";
import { PALETTE_KEYS, type PaletteKey } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function PalettePicker({ value, onChange, label = "Colour" }: { value: PaletteKey; onChange: (key: PaletteKey) => void; label?: string }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-small font-medium text-text-secondary">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {PALETTE_KEYS.map((key) => {
          const selected = key === value;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={key}
              onClick={() => onChange(key)}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
                selected && "ring-2 ring-offset-2 ring-[color:var(--swatch)]",
              )}
              style={{ background: `var(--palette-${key})`, "--swatch": `var(--palette-${key})` } as React.CSSProperties}
            >
              {selected && <CheckIcon className="size-3.5 text-white" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
