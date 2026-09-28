import { CardSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="flex flex-col gap-10" aria-busy aria-label="Loading overview">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-12 w-72" />
      </div>
      <CardSkeleton className="h-28" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <CardSkeleton className="h-80 lg:col-span-3" />
        <CardSkeleton className="h-80 lg:col-span-2" />
      </div>
    </div>
  );
}
