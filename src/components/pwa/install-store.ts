"use client";

import * as React from "react";
import { INSTALL_EVENT } from "./install-capture";

/**
 * Install state for the "Install app" buttons. The prompt event is captured
 * before hydration (see install-capture.ts). iPhone Safari has no prompt:
 * those users get "Share → Add to Home Screen" instructions instead.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __hisabInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

export type InstallMode =
  /** Running as the installed app. */
  | "installed"
  /** The browser can show its install dialog. */
  | "prompt"
  /** iPhone/iPad Safari: install through the Share menu. */
  | "ios"
  /** Nothing to offer (unsupported browser, or the browser already offers it itself). */
  | "unavailable";

function currentMode(): InstallMode {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  if (window.__hisabInstallPrompt) return "prompt";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "unavailable";
}

function subscribe(onChange: () => void) {
  window.addEventListener(INSTALL_EVENT, onChange);
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(INSTALL_EVENT, onChange);
    media.removeEventListener("change", onChange);
  };
}

export function useInstallMode(): InstallMode {
  return React.useSyncExternalStore(subscribe, currentMode, () => "unavailable");
}

/** Show the browser's install dialog. Resolves true when the app was installed. */
export async function promptInstall(): Promise<boolean> {
  const event = window.__hisabInstallPrompt;
  if (!event) return false;
  await event.prompt();
  const { outcome } = await event.userChoice;
  // A prompt can only be used once.
  window.__hisabInstallPrompt = null;
  window.dispatchEvent(new Event(INSTALL_EVENT));
  return outcome === "accepted";
}
