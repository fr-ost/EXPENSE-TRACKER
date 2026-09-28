"use client";

import { LaptopIcon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api-client";
import type { SessionInfo } from "@/lib/types";

export function SessionsList({ sessions }: { sessions: SessionInfo[] }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const others = sessions.filter((s) => !s.current).length;
  const LIMIT = 6;
  const shown = sessions.slice(0, LIMIT);

  async function revoke() {
    setPending(true);
    try {
      const result = await api<{ revoked: number }>("/api/settings/sessions", { method: "DELETE" });
      toast.success(`Signed out ${result.revoked} other session${result.revoked === 1 ? "" : "s"}`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border">
        {shown.map((s, i) => (
          <li key={i} className="flex items-center gap-3 py-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-surface-muted text-text-secondary">
              <LaptopIcon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2 text-body font-medium text-text">
                {s.device}
                {s.current && <Badge tone="positive">This device</Badge>}
              </span>
              <span className="text-caption text-text-tertiary">
                Signed in {s.signedIn} · {s.lastActive}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {sessions.length > LIMIT && (
        <p className="text-small text-text-tertiary">
          and {sessions.length - LIMIT} more signed-in {sessions.length - LIMIT === 1 ? "session" : "sessions"}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-caption text-text-tertiary">
          <ShieldCheckIcon className="size-3.5" />
          Sessions expire after 30 days, or 7 days unused.
        </span>
        <Button variant="outline" size="sm" disabled={others === 0} loading={pending} onClick={() => void revoke()}>
          Sign out other sessions
        </Button>
      </div>
    </div>
  );
}
