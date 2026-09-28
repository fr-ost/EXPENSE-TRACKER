"use client";

import { CheckCircle2Icon, CircleAlertIcon, InfoIcon } from "lucide-react";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      offset={24}
      mobileOffset={{ bottom: "calc(var(--bottom-nav-height) + 16px + env(safe-area-inset-bottom))" }}
      gap={8}
      duration={4000}
      icons={{
        success: <CheckCircle2Icon className="size-[18px] text-positive" />,
        error: <CircleAlertIcon className="size-[18px] text-negative" />,
        info: <InfoIcon className="size-[18px] text-info" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 rounded-xl bg-ink px-4 py-3 text-body text-white shadow-lg sm:w-[380px]",
          title: "font-medium",
          description: "text-small text-white/65",
          actionButton:
            "ml-auto shrink-0 rounded-md bg-white/12 px-2.5 py-1 text-small font-medium text-white transition-colors hover:bg-white/20",
          icon: "shrink-0",
        },
      }}
    />
  );
}
