"use client";

import { XIcon } from "lucide-react";
import * as React from "react";
import { Drawer } from "vaul";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

interface ResponsiveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Hide the visual title (kept for screen readers). */
  hideTitle?: boolean;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  size?: "md" | "lg";
}

/**
 * A centred dialog on desktop and a draggable bottom sheet on phones — the
 * same content, laid out for each context.
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  description,
  hideTitle,
  headerAction,
  footer,
  children,
  className,
  size = "md",
}: ResponsiveSheetProps) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn(size === "lg" ? "max-w-2xl" : "max-w-[500px]", className)}>
          <div className={cn("flex items-start justify-between gap-4 px-6 pt-6 pr-14", hideTitle && "sr-only")}>
            <div className="flex flex-col gap-1">
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </div>
            {headerAction}
          </div>
          {hideTitle && !description && <DialogDescription className="sr-only">{title}</DialogDescription>}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</div>
          {footer && <div className="border-t border-border bg-surface px-6 py-4">{footer}</div>}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Drawer.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-[22px] bg-surface shadow-xl outline-none",
            className,
          )}
          aria-describedby={undefined}
        >
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border-strong" aria-hidden />
          <div className={cn("flex items-center justify-between gap-3 px-5 pb-1 pt-3", hideTitle && "sr-only")}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <Drawer.Title className="text-heading font-semibold text-text">{title}</Drawer.Title>
              {description && (
                <Drawer.Description className="text-small text-text-secondary">{description}</Drawer.Description>
              )}
            </div>
            {headerAction ?? (
              <Drawer.Close
                className="inline-flex size-8 items-center justify-center rounded-full bg-surface-muted text-text-secondary"
                aria-label="Close"
              >
                <XIcon className="size-4" />
              </Drawer.Close>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-3">{children}</div>
          {footer && <div className="border-t border-border bg-surface px-5 pb-safe pt-3 [&>*]:mb-3">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
