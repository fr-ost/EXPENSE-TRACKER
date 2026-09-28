"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useTransactionSheet } from "./transaction-sheet";

/** "?new=1" (the installed app's "New transaction" shortcut) opens the entry sheet once. */
export function OpenNewFromUrl() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { openCreate } = useTransactionSheet();
  const wantsNew = params.get("new") === "1";

  React.useEffect(() => {
    if (!wantsNew) return;
    openCreate();
    const rest = new URLSearchParams(params.toString());
    rest.delete("new");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [wantsNew, openCreate, params, pathname, router]);

  return null;
}
