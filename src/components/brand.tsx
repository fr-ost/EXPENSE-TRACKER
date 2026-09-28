import { APP_NAME } from "@/lib/domain";
import { cn } from "@/lib/utils";

/**
 * The mark: a lowercase "h" with an emerald full stop — the books, balanced.
 * Same drawing as the app icons (scripts/generate-icons.mjs).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={cn("size-8", className)} aria-hidden>
      <rect width="512" height="512" rx="116" fill="var(--ink)" />
      <g fill="none" stroke="#fff" strokeWidth="54" strokeLinecap="round" strokeLinejoin="round">
        <path d="M144 118V390" />
        <path d="M144 292c0-52 32-82 76-82s74 30 74 82v98" />
      </g>
      <circle cx="374" cy="372" r="32" fill="#2fbf71" />
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
