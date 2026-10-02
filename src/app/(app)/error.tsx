"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { clientVersion, describeError } from "@/lib/error-details";

const noSubscription = () => () => {};

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Only in the browser: the server render doesn't know it, and must match.
  const version = useSyncExternalStore(noSubscription, clientVersion, () => null);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={<TriangleAlertIcon />}
      title="This page couldn't load"
      description={
        <>
          Your data is safe — something went wrong while fetching it. Try again, and if it keeps happening check the
          server logs.
          {/* Enough, in a screenshot, to find the cause. */}
          <span className="mt-3 block break-words font-mono text-caption text-text-tertiary">
            {describeError(error)}
            {version && ` · version ${version}`}
          </span>
        </>
      }
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
