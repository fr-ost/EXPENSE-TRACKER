"use client";

import { MessageSquareTextIcon, ScaleIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Amount } from "@/components/app-data";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api-client";
import { formatRelativeDay, formatTime, type ISODate } from "@/lib/dates";
import { isZero } from "@/lib/money";
import type { AccountSummary, BalanceUpdateView } from "@/lib/types";

/** The balances entered or read from SMS, with what each one corrected. */
export function BalanceUpdates({
  account,
  updates,
  today,
  onUpdate,
}: {
  account: AccountSummary;
  updates: BalanceUpdateView[];
  today: ISODate;
  onUpdate: () => void;
}) {
  const router = useRouter();
  const [removing, setRemoving] = React.useState<BalanceUpdateView | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/api/accounts/${account.id}/balance/${removing.id}`, { method: "DELETE" });
      toast.success("Balance update removed");
      setRemoving(null);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader
        title="Balance updates"
        description="What you checked or an SMS reported. Older entries added later don't change a balance after one."
        action={
          <Button variant="ghost" size="sm" onClick={onUpdate}>
            Update
          </Button>
        }
      />
      <ul className="mt-2 flex flex-col divide-y divide-border pb-2">
        {updates.map((update) => (
          <li key={update.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-tertiary [&_svg]:size-4">
              {update.source === "SMS" ? <MessageSquareTextIcon aria-hidden /> : <ScaleIcon aria-hidden />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <Amount value={update.balance} currency={account.currency} className="text-body font-medium text-text" />
              <span className="truncate text-small text-text-tertiary">
                {formatRelativeDay(update.date, today)}
                {update.time && ` · ${formatTime(update.time)}`}
                {update.source === "SMS" ? " · from SMS" : ""}
                {update.note && ` · ${update.note}`}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
              {update.startingPoint ? (
                <Badge>Earliest balance</Badge>
              ) : isZero(update.correction) ? (
                <Badge tone="positive">Matched</Badge>
              ) : (
                <>
                  <Amount value={update.correction} currency={account.currency} sign="always" tone="signed" className="text-small font-medium" />
                  <span className="text-caption text-text-tertiary">corrected</span>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setRemoving(update)}
              aria-label={`Remove the balance update of ${formatRelativeDay(update.date, today)}`}
              className="text-text-tertiary"
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this balance update?"
        description="The balance will again follow the recorded transactions from the previous update on. Its correction moves to the next update, if there is one."
        confirmLabel="Remove"
        destructive
        loading={busy}
        onConfirm={remove}
      />
    </Card>
  );
}
