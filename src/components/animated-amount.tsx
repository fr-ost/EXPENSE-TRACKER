"use client";

import { animate, useReducedMotion } from "motion/react";
import * as React from "react";
import { useFormatMoney } from "@/components/app-data";
import { toMinor, type Money } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Counts up to a money value on first render, then settles on the exact
 * formatted value. Intermediate frames are whole units for display only.
 */
export function AnimatedAmount({ value, currency, className }: { value: Money; currency?: string; className?: string }) {
  const format = useFormatMoney();
  const reduceMotion = useReducedMotion();
  const exact = format(value, { currency });
  const [text, setText] = React.useState(exact);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current || reduceMotion) {
      setText(exact);
      return;
    }
    started.current = true;
    const target = toMinor(value) / 100n;
    const controls = animate(0, Number(target), {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setText(format(BigInt(Math.round(latest)) * 100n, { currency })),
      onComplete: () => setText(exact),
    });
    return () => controls.stop();
  }, [value, currency, exact, format, reduceMotion]);

  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="sr-only">{exact}</span>
      <span aria-hidden>{text}</span>
    </span>
  );
}
