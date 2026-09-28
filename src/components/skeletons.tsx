import { Skeleton } from "@/components/ui/misc";

export function PageHeaderSkeleton() {
  return (
    <div className="mb-8 flex flex-col gap-2" aria-busy aria-label="Loading">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-7 w-48" />
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3.5 py-2.5">
          <Skeleton className="size-9 rounded-[10px]" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className = "h-64" }: { className?: string }) {
  return <Skeleton className={`w-full rounded-xl ${className}`} />;
}
