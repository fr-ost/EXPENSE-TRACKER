import { CardSkeleton, PageHeaderSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardSkeleton className="mb-6 h-24" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <CardSkeleton className="h-96 lg:col-span-2" />
        <CardSkeleton className="h-96 lg:col-span-3" />
      </div>
    </>
  );
}
