"use client";

import { XIcon } from "lucide-react";
import * as React from "react";
import { Drawer } from "vaul";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { SheetErrorBoundary } from "./sheet-error-boundary";

/** iPhone / iPad, including iPadOS reporting itself as a Mac. */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

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
  const close = () => onOpenChange(false);
  const handlePress = React.useRef<{ x: number; y: number; mouse: boolean } | null>(null);

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
          {/* A crash in the form or its footer stays in this sheet. */}
          <SheetErrorBoundary onClose={close} className="px-6 pb-6 pt-4">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</div>
            {footer && <div className="border-t border-border bg-surface px-6 py-4">{footer}</div>}
          </SheetErrorBoundary>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      // Only the handle drags the sheet: scrolling a long form or selecting
      // text never tugs it.
      handleOnly
      // Android sizes the page above the keyboard by itself (see the viewport
      // in the root layout); moving the sheet as well makes it jump. iOS
      // Safari can't, so there the sheet makes room for the keyboard.
      repositionInputs={isIOS()}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Drawer.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-[22px] bg-surface shadow-xl outline-none",
            className,
          )}
          aria-describedby={undefined}
        >
          <Drawer.Handle
            // A tap on the handle closes the sheet. Phones also route a tap on
            // the backdrop just above the sheet here, and that one means "close".
            onPointerDownCapture={(event) => {
              handlePress.current = { x: event.clientX, y: event.clientY, mouse: event.pointerType === "mouse" };
            }}
            onClick={(event) => {
              const press = handlePress.current;
              // A mouse drag ends in a click too; only a press that stayed put counts.
              if (press?.mouse && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) return;
              close();
            }}
            className="!m-0 !h-7 !w-full shrink-0 !rounded-none !bg-transparent !opacity-100"
          >
            <span className="absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong" />
          </Drawer.Handle>
          <div className={cn("flex items-center justify-between gap-3 px-5 pb-1 pt-1", hideTitle && "sr-only")}>
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
          <SheetErrorBoundary onClose={close} className="px-5 pb-safe pt-3">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-3">{children}</div>
            {footer && <div className="border-t border-border bg-surface px-5 pb-safe pt-3 [&>*]:mb-3">{footer}</div>}
          </SheetErrorBoundary>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
