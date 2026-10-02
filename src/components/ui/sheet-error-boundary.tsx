"use client";

import { TriangleAlertIcon } from "lucide-react";
import * as React from "react";
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
