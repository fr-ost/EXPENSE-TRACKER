"use client";

import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string, serverValue = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export const useIsDesktop = () => useMediaQuery("(min-width: 640px)");

/**
 * Whether opening a form may put the cursor in a field. Only with a mouse and
 * a real keyboard: on a phone it pops up the keyboard while the sheet slides
 * in, so there a field is focused only when tapped.
 */
export const useAutoFocusFields = () => useMediaQuery("(hover: hover) and (pointer: fine)", false);
