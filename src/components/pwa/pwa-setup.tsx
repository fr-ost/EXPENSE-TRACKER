"use client";

import * as React from "react";

/**
 * Registers the service worker (production only: in development it would
 * cache nothing useful and get in the way of hot reloading).
 */
export function PwaSetup() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const register = () =>
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
        // Not fatal: the app works without it, it just can't show the offline screen.
      });
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", () => void register(), { once: true });
  }, []);
  return null;
}
