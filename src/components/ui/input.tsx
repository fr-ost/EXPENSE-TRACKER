"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./field";

export const inputBase = [
  "w-full min-w-0 rounded-md border border-border bg-surface px-3 text-body text-text shadow-xs",
  "placeholder:text-text-quaternary",
  "transition-[border-color,box-shadow] duration-150 ease-out",
  "hover:border-border-strong",
  "focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-[var(--focus-ring)]",
  "disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-text-tertiary",
  "aria-[invalid=true]:border-negative aria-[invalid=true]:focus:ring-[rgb(229_72_77/0.2)]",
].join(" ");

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  const field = useFieldControl();
  return <input type={type} className={cn(inputBase, "h-10", className)} {...field} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const field = useFieldControl();
  return (
    <textarea className={cn(inputBase, "min-h-20 resize-y py-2.5 leading-relaxed", className)} {...field} {...props} />
  );
}
