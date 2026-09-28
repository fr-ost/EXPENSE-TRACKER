import { CardSkeleton, PageHeaderSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardSkeleton className="mb-6 h-28" />
      <CardSkeleton className="h-96" />
    </>
  );
}
