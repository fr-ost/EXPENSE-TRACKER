"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
  ...props
}: { content: React.ReactNode; children: React.ReactNode } & Omit<
  React.ComponentProps<typeof TooltipPrimitive.Content>,
  "content"
>) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-[70] max-w-64 rounded-sm bg-ink px-2.5 py-1.5 text-caption font-medium text-white shadow-md",
            "data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade-in",
          )}
          {...props}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
