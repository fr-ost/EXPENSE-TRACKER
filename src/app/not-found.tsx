import { CompassIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState
        icon={<CompassIcon />}
        title="Nothing here"
        description="This page doesn't exist, or the item was deleted."
        action={
          <Button asChild>
            <Link href="/dashboard">Back to overview</Link>
          </Button>
        }
      />
    </main>
  );
}
