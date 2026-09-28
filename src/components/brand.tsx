import { APP_NAME } from "@/lib/domain";
import { cn } from "@/lib/utils";

/** The mark: ledger lines settling into a balance. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <rect x="8" y="9.5" width="16" height="2.6" rx="1.3" fill="#fff" />
      <rect x="8" y="14.7" width="11" height="2.6" rx="1.3" fill="#fff" opacity="0.72" />
      <rect x="8" y="19.9" width="6" height="2.6" rx="1.3" fill="#fff" opacity="0.44" />
    </svg>
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className="size-7" />
      <span className="text-[15px] font-semibold tracking-[-0.015em] text-text">{APP_NAME}</span>
    </span>
  );
}
