import { CardSkeleton, PageHeaderSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <Skeleton className="mb-8 h-10 w-56" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <CardSkeleton key={i} className="h-36" />
        ))}
      </div>
    </>
  );
}
