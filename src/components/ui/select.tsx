"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./field";
import { inputBase } from "./input";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  const field = useFieldControl();
  return (
    <SelectPrimitive.Trigger
      className={cn(
        inputBase,
        "flex h-10 items-center justify-between gap-2 text-left data-[placeholder]:text-text-tertiary [&>span]:flex [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-2 [&>span]:truncate",
        className,
      )}
      {...field}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 shrink-0 text-text-tertiary" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={6}
        className={cn(
          "relative z-[60] max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface shadow-lg",
          "origin-[var(--radix-select-content-transform-origin)] data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  trailing,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  /** Shown in the list only, not in the closed trigger. */
  trailing?: React.ReactNode;
}) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex h-9 cursor-default select-none items-center gap-2 rounded-sm pl-2.5 pr-8 text-body text-text outline-none",
        "data-[highlighted]:bg-surface-muted data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText asChild>
        <span className="flex min-w-0 items-center gap-2 truncate">{children}</span>
      </SelectPrimitive.ItemText>
      {trailing && <span className="ml-auto shrink-0 pl-3 text-small text-text-tertiary">{trailing}</span>}
      <SelectPrimitive.ItemIndicator className="absolute right-2.5">
        <CheckIcon className="size-4 text-text" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn("px-2.5 pb-1 pt-2 text-caption font-medium text-text-tertiary", className)}
      {...props}
    />
  );
}

export function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
