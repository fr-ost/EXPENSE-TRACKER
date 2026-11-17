"use client";

import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import * as React from "react";
import { Amount, useAppData } from "@/components/app-data";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api-client";
import { describeContents, type BackupSummary, type RestoreResult } from "@/lib/backup";

/** "12 Nov 2026, 3:04 pm" in the user's timezone. */
export function useFormatMoment() {
  const { settings } = useAppData();
  return React.useCallback(
    (iso: string) => {
      try {
        return new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
      } catch {
        return iso.slice(0, 10);
      }
    },
    [settings.timezone],
  );
}

/**
 * Restoring a backup, in three steps: what it holds and what will happen,
 * the restore itself, and what came of it. Afterwards the app is loaded
 * afresh, since everything on screen is from before.
 */
export function RestoreDialog({
  backup,
  restore,
  onClose,
}: {
  /** The backup chosen, or null when nothing is being restored. */
  backup: BackupSummary | null;
  /** Does the restore; rejects with a message when it couldn't be done (nothing changed then). */
  restore: () => Promise<RestoreResult>;
  onClose: () => void;
}) {
  const formatMoment = useFormatMoment();
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<RestoreResult | null>(null);

  async function run() {
    setWorking(true);
    setError(null);
    try {
      setResult(await restore());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  // Everything on screen is from before the restore: load the app afresh.
  const finish = () => window.location.replace("/dashboard");

  return (
    <Dialog
      open={backup !== null}
      onOpenChange={(open) => {
        if (open || working) return;
        if (result) finish();
        else {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent hideClose aria-describedby="restore-description">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Backup restored</DialogTitle>
              <DialogDescription id="restore-description">Your account now holds {describeContents(result)}.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              {result.balanceDifferences.length === 0 ? (
                <p className="flex items-start gap-2 text-body text-text-secondary">
                  <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-positive" />
                  Every account balance matches the backup.
                </p>
              ) : (
                <div className="flex flex-col gap-2 text-body text-text-secondary">
                  <p className="flex items-start gap-2">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                    These balances differ from the ones recorded in the backup. Check them against your bank or wallet.
                  </p>
                  <ul className="flex flex-col gap-1 pl-6">
                    {result.balanceDifferences.map((d) => (
                      <li key={d.account}>
                        <span className="font-medium text-text">{d.account}</span>: now <Amount value={d.restored} currency={d.currency} />, was{" "}
                        <Amount value={d.inBackup} currency={d.currency} /> in the backup
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </DialogBody>
            <DialogFooter>
              <Button onClick={finish}>Open Hisab</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Restore this backup?</DialogTitle>
              <DialogDescription id="restore-description">
                {backup && (
                  <>
                    Made {formatMoment(backup.exportedAt)} — {describeContents(backup)}.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-3 text-body text-text-secondary">
              <p>
                Restoring <span className="font-medium text-text">replaces everything</span> in your account with what is in this backup.
                Anything you recorded after it was made will be gone.
              </p>
              <p>It happens all at once: if the backup can&apos;t be restored, nothing changes.</p>
              {error && (
                <p role="alert" className="rounded-lg bg-negative-soft px-3 py-2 text-negative-text">
                  {error}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" disabled={working} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" loading={working} onClick={() => void run()}>
                Replace my data
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
