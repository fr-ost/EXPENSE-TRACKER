"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ease-out",
        "bg-surface-sunken data-[state=checked]:bg-accent",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)] disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-spring)] data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
