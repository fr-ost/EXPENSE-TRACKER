"use client";

import { TriangleAlertIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { errorDetails } from "@/lib/error-details";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Keeps a crash inside a sheet inside the sheet. Sheets live in the app
 * shell, so without this one bad keystroke would take down every screen.
 */
export class SheetErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void; className?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className={cn("flex flex-col items-center gap-3 py-8 text-center", this.props.className)}>
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-warning-soft text-warning-text [&_svg]:size-5">
          <TriangleAlertIcon aria-hidden />
        </span>
        <p className="text-body font-medium text-text">This form hit a problem</p>
        <p className="max-w-xs text-small text-text-secondary">Nothing was saved. Start it again — your other data is safe.</p>
        <p className="max-w-xs break-words font-mono text-caption text-text-tertiary">{errorDetails(this.state.error)}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={this.props.onClose}>
            Close
          </Button>
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
        </div>
      </div>
    );
  }
}

/**
 * Around a whole sheet: if it crashes while rendering — even in the code that
 * sets the sheet up, outside its form — the sheet closes with a message and
 * the screen behind it carries on. It starts afresh the next time it opens.
 */
export class SheetCrashGuard extends React.Component<
  { open: boolean; onClose: () => void; children: React.ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: Error) {
    console.error(error);
    toast.error("That form hit a problem and was closed", {
      description: `Nothing was saved. ${errorDetails(error)}`,
    });
    this.props.onClose();
  }

  componentDidUpdate(previous: { open: boolean }) {
    if (this.state.crashed && this.props.open && !previous.open) this.setState({ crashed: false });
  }

  render() {
    return this.state.crashed ? null : this.props.children;
  }
}

/** A sheet component wrapped in a `SheetCrashGuard`. */
export function guardSheet<P extends { open: boolean; onOpenChange: (open: boolean) => void }>(
  Sheet: React.ComponentType<P>,
): React.ComponentType<P> {
  function GuardedSheet(props: P) {
    return (
      <SheetCrashGuard open={props.open} onClose={() => props.onOpenChange(false)}>
        <Sheet {...props} />
      </SheetCrashGuard>
    );
  }
  GuardedSheet.displayName = Sheet.displayName ?? Sheet.name;
  return GuardedSheet;
}
