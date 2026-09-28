"use client";

import { PlusIcon } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { DraftDefaults } from "./transaction-draft";
import { useTransactionSheet } from "./transaction-sheet";

export function NewTransactionButton({
  label = "New transaction",
  defaults,
  ...props
}: ButtonProps & { label?: string; defaults?: DraftDefaults }) {
  const { openCreate } = useTransactionSheet();
  return (
    <Button onClick={() => openCreate(defaults)} {...props}>
      <PlusIcon />
      {label}
    </Button>
  );
}
