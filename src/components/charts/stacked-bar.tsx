"use client";

import { motion } from "motion/react";
import { Tooltip } from "@/components/ui/tooltip";

export interface Segment {
  key: string;
  label: string;
  share: number;
  color: string;
  valueText: string;
}

/**
 * Part-to-whole as a single horizontal bar. Segments are separated by a 2px
 * surface gap (never a stroke); identity is carried by the legend beside it.
 */
export function StackedBar({ segments, label, height = 10 }: { segments: Segment[]; label: string; height?: number }) {
  const visible = segments.filter((s) => s.share > 0);
  if (!visible.length) {
    return <div className="w-full rounded-full bg-surface-muted" style={{ height }} aria-label={`${label}: nothing yet`} role="img" />;
  }
  return (
    <motion.div
      role="img"
      aria-label={`${label}: ${visible.map((s) => `${s.label} ${s.share.toFixed(0)}%`).join(", ")}`}
      className="flex w-full origin-left gap-[2px] overflow-hidden rounded-full"
      style={{ height }}
      initial={{ scaleX: 0.3, opacity: 0 }}
      animate={{ scaleX: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {visible.map((segment) => (
        <Tooltip key={segment.key} content={`${segment.label} · ${segment.valueText} · ${segment.share.toFixed(1)}%`}>
          <span className="h-full min-w-[3px]" style={{ flexGrow: segment.share, flexBasis: 0, background: segment.color }} />
        </Tooltip>
      ))}
    </motion.div>
  );
}
