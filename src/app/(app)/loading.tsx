import { CardSkeleton, PageHeaderSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="flex flex-col gap-4">
        <CardSkeleton className="h-40" />
        <CardSkeleton className="h-72" />
      </div>
    </>
  );
}
