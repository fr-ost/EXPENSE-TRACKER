import { ListSkeleton, PageHeaderSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <ListSkeleton rows={9} />
    </>
  );
}
