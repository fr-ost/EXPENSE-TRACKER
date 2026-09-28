"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={<TriangleAlertIcon />}
      title="This page couldn't load"
      description="Your data is safe — something went wrong while fetching it. Try again, and if it keeps happening check the server logs."
      action={
        // retry() fetches the page again (reset() would only re-render what failed).
        <Button onClick={() => retry()}>
          <RefreshCwIcon />
          Try again
        </Button>
      }
      className="py-24"
    />
  );
}
