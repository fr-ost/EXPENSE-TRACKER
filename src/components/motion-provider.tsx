"use client";

import { MotionConfig } from "motion/react";

/** Honour the OS "reduce motion" setting for every Motion animation. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </MotionConfig>
  );
}
