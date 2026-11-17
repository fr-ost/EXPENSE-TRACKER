"use client";

import { CloudIcon, CloudOffIcon, TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api-client";
import { DRIVE_BACKUPS_KEPT, describeContents, type BackupSummary, type DriveBackupFile, type DriveStatus, type RestoreResult } from "@/lib/backup";
import { RestoreDialog, useFormatMoment } from "./restore-dialog";

/** What happened when the person came back from Google (?drive=…). */
const NOTICES: Record<string, { text: string; good?: boolean }> = {
  connected: { text: "Google Drive is connected. Hisab will keep a backup there from now on.", good: true },
  cancelled: { text: "Google Drive wasn't connected." },
  "not-granted": { text: "Google Drive wasn't connected: the permission to keep backups there has to be ticked on Google's screen." },
  "other-account": { text: "That's a different Google account. Choose the one you sign in to Hisab with." },
  problem: { text: "Google Drive is connected, but the first backup didn't work." },
  failed: { text: "Connecting Google Drive didn't complete. Please try again." },
};

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

type BackupOutcome = { status: "saved" } | { status: "unchanged" } | { status: "empty" };

/**
 * Backups in the person's own Google Drive: connect it once, and Hisab keeps
 * the last few copies there on its own. Any of them can be restored.
 */
export function DriveBackups({ status, notice }: { status: DriveStatus; notice?: string }) {
  const router = useRouter();
  const formatMoment = useFormatMoment();
  const [busy, setBusy] = React.useState<"backup" | "disconnect" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const [backups, setBackups] = React.useState<DriveBackupFile[] | "loading" | null>(null);
  const [listProblem, setListProblem] = React.useState<string | null>(null);
  const [chosen, setChosen] = React.useState<DriveBackupFile | null>(null);

  if (!status.available) return null;
  const said = notice ? NOTICES[notice] : undefined;

  async function backUpNow() {
    setBusy("backup");
    try {
      const outcome = await api<BackupOutcome>("/api/drive/backups");
      toast.success(outcome.status === "empty" ? "Nothing to back up yet" : "Backed up to Google Drive");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    try {
      await api("/api/drive", { method: "DELETE" });
      toast.success("Google Drive disconnected");
      setConfirmDisconnect(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function openList() {
    setBackups("loading");
    setListProblem(null);
    try {
      setBackups((await api<{ backups: DriveBackupFile[] }>("/api/drive/backups", { method: "GET" })).backups);
    } catch (error) {
      setListProblem(errorMessage(error));
      setBackups([]);
      router.refresh();
    }
  }

  const summaryOf = (backup: DriveBackupFile): BackupSummary =>
    backup.summary ?? { exportedAt: backup.createdAt, accounts: 0, categories: 0, transactions: 0, balanceUpdates: 0, budgets: 0, exchangeRates: 0, recurring: 0 };

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-secondary">
          {status.connected && !status.needsReconnect ? <CloudIcon className="size-4" /> : <CloudOffIcon className="size-4" />}
        </span>
        <div className="flex min-w-0 flex-col gap-1 text-body text-text-secondary">
          <p className="font-medium text-text">Google Drive</p>
          {!status.connected ? (
            <p>
              Connect your Google Drive and Hisab keeps a backup there on its own — a new copy on any day your ledger has changed, the
              last {DRIVE_BACKUPS_KEPT} kept. They go into a folder of Hisab&apos;s own: it can&apos;t see or touch anything else in your Drive.
            </p>
          ) : status.needsReconnect ? (
            <p>Google Drive needs to be connected again before backups can continue.</p>
          ) : (
            <p>
              {status.lastBackupAt ? <>Last backup {formatMoment(status.lastBackupAt)}.</> : <>No backup yet.</>}{" "}
              {status.lastBackupAt && status.lastCheckedAt && status.lastCheckedAt > status.lastBackupAt && !status.problem && (
                <>Nothing has changed since. </>
              )}
              A new copy is saved on any day your ledger has changed; the last {DRIVE_BACKUPS_KEPT} are kept.
            </p>
          )}
        </div>
      </div>

      {said && (
        <p role="status" className={said.good ? "rounded-lg bg-positive-soft px-3 py-2 text-small text-positive-text" : "rounded-lg bg-warning-soft px-3 py-2 text-small text-warning-text"}>
          {said.text}
        </p>
      )}
      {status.connected && (status.problem || status.needsReconnect) && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-small text-warning-text">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {status.needsReconnect ? "Google no longer lets Hisab reach your Drive. Connect it again to carry on backing up." : `The last backup didn't work: ${status.problem}`}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!status.connected || status.needsReconnect ? (
          <Button asChild variant="outline">
            <a href="/api/drive/connect">{status.connected ? "Connect Google Drive again" : "Connect Google Drive"}</a>
          </Button>
        ) : (
          <>
            <Button variant="outline" loading={busy === "backup"} onClick={() => void backUpNow()}>
              Back up now
            </Button>
            <Button variant="outline" onClick={() => void openList()}>
              Restore from Google Drive
            </Button>
          </>
        )}
        {status.connected && (
          <Button variant="ghost" onClick={() => setConfirmDisconnect(true)}>
            Disconnect
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google Drive?"
        description="Hisab will stop backing up to your Drive. The backups already there stay until you connect again or remove them in Google Drive's settings."
        confirmLabel="Disconnect"
        loading={busy === "disconnect"}
        onConfirm={() => void disconnect()}
      />

      <Dialog open={backups !== null && chosen === null} onOpenChange={(open) => !open && setBackups(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Backups in your Google Drive</DialogTitle>
            <DialogDescription>Choose one to restore. Your account as it is now is saved to Drive first.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {backups === "loading" ? (
              <p className="py-6 text-center text-small text-text-tertiary">Looking in your Drive…</p>
            ) : listProblem ? (
              <p role="alert" className="py-4 text-body text-negative-text">
                {listProblem}
              </p>
            ) : backups && backups.length === 0 ? (
              <p className="py-6 text-center text-small text-text-tertiary">There are no backups in your Drive yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {(Array.isArray(backups) ? backups : []).map((backup) => (
                  <li key={backup.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-body font-medium text-text">{formatMoment(backup.createdAt)}</span>
                      <span className="text-caption text-text-tertiary">
                        {backup.summary ? describeContents(backup.summary) : "Backup"} · {formatSize(backup.size)}
                      </span>
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setChosen(backup)}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <RestoreDialog
        backup={chosen ? summaryOf(chosen) : null}
        restore={() => api<RestoreResult>("/api/drive/restore", { body: { confirm: "REPLACE", fileId: chosen?.id } })}
        onClose={() => setChosen(null)}
      />
    </div>
  );
}
