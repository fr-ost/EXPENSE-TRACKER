import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Server-rendered pagination that preserves every other search param. */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  searchParams,
  basePath,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}) {
  if (pageCount <= 1) return null;
  const href = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      const v = Array.isArray(value) ? value[0] : value;
      if (v && key !== "page") params.set(key, v);
    }
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const linkClass = (disabled: boolean) =>
    cn(
      "inline-flex h-9 items-center gap-1 rounded-md border border-border bg-surface px-3 text-small font-medium shadow-xs transition-colors",
      disabled ? "pointer-events-none opacity-40" : "hover:border-border-strong hover:bg-surface-subtle",
    );
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 pt-6">
      <p className="text-small text-text-tertiary tabular">
        {first.toLocaleString("en-US")}–{last.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
      </p>
      <div className="flex items-center gap-2">
        <Link href={href(page - 1)} className={linkClass(page <= 1)} aria-disabled={page <= 1} scroll>
          <ChevronLeftIcon className="size-4" />
          Previous
        </Link>
        <Link href={href(page + 1)} className={linkClass(page >= pageCount)} aria-disabled={page >= pageCount} scroll>
          Next
          <ChevronRightIcon className="size-4" />
        </Link>
      </div>
    </nav>
  );
}
