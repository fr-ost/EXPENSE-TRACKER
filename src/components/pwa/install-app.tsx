"use client";

import { CheckCircle2Icon, DownloadIcon, PlusSquareIcon, ShareIcon, XIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { promptInstall, useInstallMode } from "./install-store";

async function install() {
  try {
    if (await promptInstall()) toast.success("Hisab is installed", { description: "Open it from your home screen or app list." });
  } catch {
    toast.error("The browser couldn't start the install. Use its menu → Install app instead.");
  }
}

function IosSteps({ className }: { className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-1.5 text-small text-text-secondary", className)}>
      <li className="flex items-center gap-2">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-text">
          <ShareIcon className="size-3.5" />
        </span>
        In Safari, tap <span className="font-medium text-text">Share</span>
      </li>
      <li className="flex items-center gap-2">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-text">
          <PlusSquareIcon className="size-3.5" />
        </span>
        Choose <span className="font-medium text-text">Add to Home Screen</span>
      </li>
    </ol>
  );
}

/** Sidebar row (desktop), shown only when the browser can install. */
export function InstallSidebarButton() {
  const mode = useInstallMode();
  if (mode !== "prompt") return null;
  return (
    <button
      onClick={() => void install()}
      className="flex h-9 items-center gap-3 rounded-md px-3 text-body font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text"
    >
      <DownloadIcon className="size-[18px]" />
      Install app
    </button>
  );
}

/** Icon button for the tablet rail. */
export function InstallRailButton() {
  const mode = useInstallMode();
  if (mode !== "prompt") return null;
  return (
    <Tooltip content="Install app" side="right">
      <button
        onClick={() => void install()}
        aria-label="Install app"
        className="flex size-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted hover:text-text"
      >
        <DownloadIcon className="size-5" />
      </button>
    </Tooltip>
  );
}

/** Row in the phone's "More" sheet. */
export function InstallMoreItem() {
  const mode = useInstallMode();
  const [showSteps, setShowSteps] = React.useState(false);
  if (mode === "installed" || mode === "unavailable") return null;
  return (
    <>
      <button
        onClick={() => (mode === "prompt" ? void install() : setShowSteps((v) => !v))}
        aria-expanded={mode === "ios" ? showSteps : undefined}
        className="flex h-12 items-center gap-3 rounded-lg px-3 text-body font-medium text-text-secondary hover:bg-surface-muted"
      >
        <DownloadIcon className="size-5" />
        {mode === "prompt" ? "Install app" : "Add to Home Screen"}
      </button>
      {mode === "ios" && showSteps && <IosSteps className="mb-2 ml-11" />}
    </>
  );
}

/** Settings card: what installing gives you and how, on this device. */
export function InstallAppCard() {
  const mode = useInstallMode();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3.5">
        <BrandMark className="size-11 shrink-0" />
        <p className="text-body text-text-secondary">
          Install Hisab to open it like an app: its own icon, a full screen without browser bars, and on Android you can share a bank
          SMS straight into it.
        </p>
      </div>
      {mode === "installed" ? (
        <p className="flex items-center gap-2 text-small font-medium text-positive-text">
          <CheckCircle2Icon className="size-4" />
          You&rsquo;re using the installed app.
        </p>
      ) : mode === "prompt" ? (
        <Button className="self-start" onClick={() => void install()}>
          <DownloadIcon />
          Install app
        </Button>
      ) : mode === "ios" ? (
        <IosSteps />
      ) : (
        <p className="text-small text-text-tertiary">
          Open Hisab in Chrome or Edge and choose <span className="font-medium text-text-secondary">Install</span> in the address bar, or
          the browser menu → <span className="font-medium text-text-secondary">Install Hisab</span> (on Android: menu →{" "}
          <span className="font-medium text-text-secondary">Add to Home screen</span>). If it&rsquo;s already installed, open it from your
          home screen or app list.
        </p>
      )}
    </div>
  );
}

const BANNER_KEY = "hisab:install-banner";

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function bannerDismissed(): boolean {
  try {
    return localStorage.getItem(BANNER_KEY) === "dismissed";
  } catch {
    return false;
  }
}

/** A one-time, dismissible invitation on the overview. */
export function InstallBanner() {
  const mode = useInstallMode();
  const stored = React.useSyncExternalStore(subscribeToStorage, bannerDismissed, () => true);
  const [dismissed, setDismissed] = React.useState(false);
  const [showSteps, setShowSteps] = React.useState(false);
  if (stored || dismissed || (mode !== "prompt" && mode !== "ios")) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(BANNER_KEY, "dismissed");
    } catch {
      // Private mode: it just shows again next time.
    }
  };

  return (
    <section aria-label="Install the app" className="flex animate-rise items-start gap-3.5 rounded-xl border border-border bg-surface-subtle p-4">
      <BrandMark className="size-10 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="text-body font-semibold text-text">Get the Hisab app</p>
          <p className="text-small text-text-secondary">One tap from your home screen, full screen, and share bank SMS straight in.</p>
        </div>
        {mode === "ios" && showSteps && <IosSteps />}
        <div className="flex gap-2">
          {mode === "prompt" ? (
            <Button size="sm" onClick={() => void install()}>
              <DownloadIcon />
              Install
            </Button>
          ) : (
            !showSteps && (
              <Button size="sm" onClick={() => setShowSteps(true)}>
                How to install
              </Button>
            )
          )}
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Not now
          </Button>
        </div>
      </div>
      <button onClick={dismiss} aria-label="Dismiss" className="-m-1 inline-flex size-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-muted hover:text-text">
        <XIcon className="size-4" />
      </button>
    </section>
  );
}
