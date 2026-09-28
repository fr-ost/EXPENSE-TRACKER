"use client";

import * as React from "react";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Locks the app after the configured idle period. While the user is active,
 * sends a heartbeat so the server-side idle lock (which also applies if the
 * tab is closed) stays in step with real activity.
 */
export function InactivityMonitor({ autoLockMinutes, onLock }: { autoLockMinutes: number; onLock: () => void }) {
  const onLockRef = React.useRef(onLock);
  React.useEffect(() => {
    onLockRef.current = onLock;
  }, [onLock]);

  React.useEffect(() => {
    if (autoLockMinutes <= 0) return;
    const lockAfter = autoLockMinutes * 60_000;
    const heartbeatEvery = Math.max(10_000, Math.min(60_000, lockAfter / 4));
    let lastActivity = Date.now();
    let lastHeartbeat = Date.now();
    let locked = false;

    const lock = () => {
      if (locked) return;
      locked = true;
      onLockRef.current();
    };

    const markActive = () => {
      lastActivity = Date.now();
    };
    let lastMove = 0;
    const onMove = () => {
      const now = Date.now();
      if (now - lastMove > 5_000) {
        lastMove = now;
        markActive();
      }
    };

    const check = () => {
      const now = Date.now();
      if (now - lastActivity >= lockAfter) return lock();
      if (lastActivity > lastHeartbeat && now - lastHeartbeat >= heartbeatEvery) {
        lastHeartbeat = now;
        void fetch("/api/auth/heartbeat", { method: "POST", credentials: "same-origin" })
          .then((response) => {
            if (response.status === 423) lock();
            if (response.status === 401) window.location.replace("/login");
          })
          .catch(() => undefined);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, markActive, { passive: true, capture: true }));
    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(check, 10_000);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActive, { capture: true }));
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [autoLockMinutes]);

  return null;
}
