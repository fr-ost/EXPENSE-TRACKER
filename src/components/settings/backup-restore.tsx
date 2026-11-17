"use client";

import { DownloadIcon, UploadIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { BACKUP_MAX_BYTES, parseBackup, summarizeBackup, type BackupSummary, type RestoreResult } from "@/lib/backup";
import { RestoreDialog } from "./restore-dialog";

/**
 * A backup file of everything you have recorded: download one, or restore
 * one (which replaces what is in the account).
 */
export function BackupFiles() {
  const input = React.useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = React.useState<{ summary: BackupSummary; contents: unknown } | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // So choosing the same file again is still a change.
    event.target.value = "";
    if (!file) return;
    setProblem(null);
    if (file.size > BACKUP_MAX_BYTES) return setProblem("That file is too large to be a Hisab backup.");
    let contents: unknown;
    try {
      contents = JSON.parse(await file.text());
    } catch {
      return setProblem("This isn't a Hisab backup file.");
    }
    // Checked here for a quick answer; the server checks it again before anything changes.
    const parsed = parseBackup(contents);
    if (!parsed.ok) return setProblem(parsed.error);
    setChosen({ summary: summarizeBackup(parsed.backup), contents });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href="/api/backup" download>
            <DownloadIcon />
            Download a backup
          </a>
        </Button>
        <Button variant="outline" onClick={() => input.current?.click()}>
          <UploadIcon />
          Restore from a file
        </Button>
        <input ref={input} type="file" accept="application/json,.json" className="sr-only" aria-label="Backup file to restore" tabIndex={-1} onChange={(e) => void choose(e)} />
      </div>
      {problem && (
        <p role="alert" className="text-small text-negative-text">
          {problem}
        </p>
      )}
      <RestoreDialog
        backup={chosen?.summary ?? null}
        restore={() => api<RestoreResult>("/api/backup/restore", { body: { confirm: "REPLACE", backup: chosen?.contents } })}
        onClose={() => setChosen(null)}
      />
    </div>
  );
}
