"use client";

import { LogOutIcon } from "lucide-react";
import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  // Full navigation: drops every client-side cache of financial data.
  window.location.replace("/login");
}

export function SignOutButton({ withIcon, ...props }: ButtonProps & { withIcon?: boolean }) {
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      variant="ghost"
      loading={pending}
      onClick={() => {
        setPending(true);
        void signOut();
      }}
      {...props}
    >
      {withIcon && <LogOutIcon />}
      Sign out
    </Button>
  );
}
