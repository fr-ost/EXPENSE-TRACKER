"use client";

import { ClipboardPasteIcon, MessageSquareTextIcon, SparklesIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { useAppData } from "@/components/app-data";
import { EmptyState } from "@/components/states";
import { useTransactionSheet } from "@/components/transactions/transaction-sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api-client";
import { fromMinor, toMinor } from "@/lib/money";
import { splitMessages } from "@/lib/sms/parse";
import type { TransactionView } from "@/lib/types";
import { SmsCard } from "./sms-card";
import { buildItem, itemPayload, messageKey, PENDING_STATUSES, type CheckResult, type SimilarTransaction, type SmsItem } from "./sms-model";
import { loadRememberedAccounts, ownEffect, rememberAccountFor, type BalanceCheck } from "./sms-suggest";

type ImportResult =
  | { status: "added"; ids: string[] }
  | { status: "exists"; ids: string[] }
  | { status: "possible_duplicate"; similar: SimilarTransaction }
  | { status: "error"; error: string; fieldErrors?: Record<string, string> };

const AUTO_ADD_KEY = "hisab:sms-auto-add";

function readAutoAdd(): boolean {
  try {
    return localStorage.getItem(AUTO_ADD_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function SmsImporter() {
  const router = useRouter();
  const { accounts, categories, today } = useAppData();
  const { openEdit } = useTransactionSheet();
  const [text, setText] = React.useState("");
  const [items, setItems] = React.useState<SmsItem[]>([]);
  const [analyzing, setAnalyzing] = React.useState(false);
  // On by default; the choice is remembered on this device.
  const storedAutoAdd = React.useSyncExternalStore(subscribeToStorage, readAutoAdd, () => true);
  const [autoAddChoice, setAutoAddChoice] = React.useState<boolean | null>(null);
  const autoAdd = autoAddChoice ?? storedAutoAdd;
  const itemsRef = React.useRef(items);
  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const patchItem = React.useCallback((id: string, patch: Partial<SmsItem>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  /** Add the given items; returns how many were added. */
  const addItems = React.useCallback(
    async (targets: SmsItem[], options: { allowDuplicate?: boolean; quiet?: boolean } = {}) => {
      const sendable: Array<{ item: SmsItem; payload: Extract<ReturnType<typeof itemPayload>, { ok: true }> }> = [];
      for (const item of targets) {
        const payload = itemPayload(item, accounts);
        if (payload.ok) sendable.push({ item, payload });
        else patchItem(item.id, { status: "review", fieldErrors: payload.fieldErrors, issues: [...new Set([...item.issues, "Fix the highlighted fields."])] });
      }
      if (!sendable.length) {
        if (!options.quiet) toast.error("Check the highlighted fields first.");
        return 0;
      }

      for (const { item } of sendable) patchItem(item.id, { status: "saving", error: undefined });
      let results: ImportResult[];
      try {
        const response = await api<{ results: ImportResult[] }>("/api/sms/import", {
          body: {
            items: sendable.map(({ item, payload }) => ({
              text: item.text,
              transaction: payload.transaction,
              fee: payload.fee,
              allowDuplicate: options.allowDuplicate ?? false,
            })),
          },
        });
        results = response.results;
      } catch (error) {
        for (const { item } of sendable) patchItem(item.id, { status: "error", error: errorMessage(error) });
        toast.error(errorMessage(error));
        return 0;
      }

      const addedIds: string[] = [];
      sendable.forEach(({ item }, index) => {
        const result = results[index];
        if (result.status === "added" || result.status === "exists") {
          patchItem(item.id, { status: result.status, addedIds: result.ids, similar: undefined, error: undefined, fieldErrors: {} });
          if (result.status === "added") addedIds.push(...result.ids);
          const own = item.draft.type === "TRANSFER" && item.parsed.direction === "credit" ? item.draft.toAccountId : item.draft.accountId;
          if (own) rememberAccountFor(item.parsed, own);
        } else if (result.status === "possible_duplicate") {
          patchItem(item.id, { status: "duplicate", similar: result.similar });
        } else {
          patchItem(item.id, { status: "error", error: result.error, fieldErrors: result.fieldErrors ?? {} });
        }
      });

      const added = results.filter((r) => r.status === "added").length;
      const flagged = results.filter((r) => r.status === "possible_duplicate").length;
      if (added) {
        router.refresh();
        toast.success(added === 1 ? "Transaction added" : `${added} transactions added`, {
          description: flagged ? `${flagged} look${flagged === 1 ? "s" : ""} like ${flagged === 1 ? "a duplicate" : "duplicates"} — check below.` : undefined,
          action: {
            label: "Undo",
            onClick: () => {
              void Promise.all(addedIds.map((id) => api(`/api/transactions/${id}`, { method: "DELETE" }).catch(() => undefined))).then(() => {
                setItems((list) => list.map((i) => (i.addedIds.some((id) => addedIds.includes(id)) ? { ...i, status: "review", addedIds: [] } : i)));
                toast("Removed");
                router.refresh();
              });
            },
          },
        });
      } else if (flagged && !options.quiet) {
        toast.warning("Already recorded?", { description: "Something similar is already in your ledger — check below." });
      }
      return added;
    },
    [accounts, patchItem, router],
  );

  /** Read messages, check them against the ledger, and (optionally) add the confident ones. */
  const analyze = React.useCallback(
    async (input: string, { auto }: { auto: boolean }) => {
      const known = new Set(itemsRef.current.map((i) => messageKey(i.text)));
      const messages = splitMessages(input).filter((m) => !known.has(messageKey(m)));
      if (!messages.length) {
        toast(input.trim() ? "Those messages are already in the list below." : "Paste a message first.");
        return;
      }
      setAnalyzing(true);
      const remembered = loadRememberedAccounts();
      const provisional = messages.map((m) => buildItem(m, { accounts, categories, today, remembered }));
      let checks: CheckResult[] | null = null;
      try {
        const response = await api<{ results: CheckResult[] }>("/api/sms/check", {
          body: { items: provisional.map((item) => ({ text: item.text, description: item.draft.description })) },
        });
        checks = response.results;
      } catch {
        // Offline or failed: still show what was read; adding checks for duplicates again anyway.
      }
      const built = checks
        ? messages.map((m, i) => buildItem(m, { accounts, categories, today, remembered, check: checks![i] }))
        : provisional;
      setItems((list) => [...built, ...list]);
      setText("");
      setAnalyzing(false);

      const ready = built.filter((item) => item.status === "ready");
      if (auto && autoAdd && ready.length) {
        await addItems(ready, { quiet: true });
      } else if (built.length) {
        const skipped = built.filter((i) => i.status === "ignored").length;
        const already = built.filter((i) => i.status === "exists").length;
        const parts = [
          `Read ${built.length} ${built.length === 1 ? "message" : "messages"}`,
          already ? `${already} already added` : null,
          skipped ? `${skipped} not ${skipped === 1 ? "a transaction" : "transactions"}` : null,
        ].filter(Boolean);
        toast(parts.join(" · "));
      }
    },
    [accounts, categories, today, autoAdd, addItems],
  );

  // Messages shared to the installed app arrive in the URL fragment (never sent to the server).
  React.useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#shared=")) return;
    const shared = decodeURIComponent(hash.slice("#shared=".length));
    window.history.replaceState(null, "", window.location.pathname);
    if (shared.trim()) void analyze(shared, { auto: true });
    // Run once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) return toast("The clipboard is empty.");
      await analyze(clip, { auto: true });
    } catch {
      toast.error("Couldn't read the clipboard. Long-press the box and choose Paste instead.");
    }
  }

  function onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    // Pasting into an empty box reads it straight away; otherwise it's just text editing.
    if (text.trim()) return;
    const pasted = event.clipboardData.getData("text");
    if (!pasted.trim()) return;
    event.preventDefault();
    void analyze(pasted, { auto: true });
  }

  function setAutoAddPreference(value: boolean) {
    setAutoAddChoice(value);
    try {
      localStorage.setItem(AUTO_ADD_KEY, value ? "on" : "off");
    } catch {
      // Not remembered in private mode; fine.
    }
  }

  async function undo(item: SmsItem) {
    try {
      await Promise.all(item.addedIds.map((id) => api(`/api/transactions/${id}`, { method: "DELETE" })));
      patchItem(item.id, { status: "review", addedIds: [] });
      toast("Removed");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function open(item: SmsItem) {
    try {
      const { transaction } = await api<{ transaction: TransactionView }>(`/api/transactions/${item.addedIds[0]}`, { method: "GET" });
      openEdit(transaction);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  // Compare the balance in the newest message for each account with what the
  // ledger shows once everything pending here is added.
  const balanceChecks = React.useMemo(() => {
    const stamp = (item: SmsItem) => `${item.draft.date} ${item.draft.time || "00:00"}`;
    const byAccount = new Map<string, { latest: SmsItem | null; pending: bigint; waiting: boolean }>();
    for (const item of items) {
      if (item.status === "ignored") continue;
      const effect = ownEffect(item.parsed, item.draft, item.includeFee ? item.fee : null);
      if (!effect) continue;
      const entry = byAccount.get(effect.accountId) ?? { latest: null, pending: 0n, waiting: false };
      if (PENDING_STATUSES.includes(item.status)) {
        entry.pending += effect.delta;
        entry.waiting = true;
      }
      if (item.parsed.balance && (!entry.latest || stamp(item) > stamp(entry.latest))) entry.latest = item;
      byAccount.set(effect.accountId, entry);
    }
    const checks = new Map<string, BalanceCheck>();
    for (const [accountId, { latest, pending, waiting }] of byAccount) {
      const account = accounts.find((a) => a.id === accountId);
      if (!latest?.parsed.balance || !account || latest.draft.date > today) continue;
      if (latest.parsed.currency && latest.parsed.currency !== account.currency) continue;
      const expected = fromMinor(toMinor(account.balance) + pending);
      checks.set(latest.id, { account, expected, reported: latest.parsed.balance, matches: expected === latest.parsed.balance, afterPending: waiting });
    }
    return checks;
  }, [items, accounts, today]);

  const pending = items.filter((i) => i.status === "ready" || i.status === "review" || i.status === "error");
  const readyCount = items.filter((i) => i.status === "ready").length;
  const hasAccounts = accounts.some((a) => a.isActive);

  if (!hasAccounts) {
    return (
      <Card>
        <EmptyState
          icon={<MessageSquareTextIcon />}
          title="Add an account first"
          description="SMS are matched to your accounts — add your bank, bKash or cash wallet, then paste messages here."
          action={
            <Button asChild>
              <Link href="/accounts?new=1">Add account</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4 sm:p-5">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void analyze(text, { auto: false });
          }}
        >
          <label htmlFor="sms-text" className="sr-only">
            Transaction messages
          </label>
          <Textarea
            id="sms-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void analyze(text, { auto: false });
              }
            }}
            rows={5}
            maxLength={100_000}
            placeholder={"Paste one or more SMS from your bank, bKash, Nagad or Rocket…\n\ne.g. Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00. TrxID BIT9CD5E6F at 28/09/2026 10:05"}
            className="min-h-32 text-body"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={analyzing} disabled={!text.trim()}>
              <SparklesIcon />
              Analyze
            </Button>
            <Button type="button" variant="outline" onClick={() => void pasteFromClipboard()} disabled={analyzing}>
              <ClipboardPasteIcon />
              Paste
            </Button>
            <label className="ml-auto flex items-center gap-2.5 text-small text-text-secondary">
              <span className="text-right">Add automatically when certain</span>
              <Switch checked={autoAdd} onCheckedChange={setAutoAddPreference} aria-label="Add automatically when certain" />
            </label>
          </div>
          <p className="text-caption text-text-tertiary">
            {autoAdd
              ? "Pasted messages that clearly match one of your accounts are added right away — you can undo. Others wait for you below."
              : "Nothing is added until you press Add."}
          </p>
        </form>
      </Card>

      {items.length > 0 ? (
        <section aria-label="Messages" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-heading font-semibold text-text">
              {pending.length ? `${pending.length} to review` : "All done"}
              <span className="ml-2 text-small font-normal text-text-tertiary">
                {items.length} {items.length === 1 ? "message" : "messages"}
              </span>
            </h2>
            <div className="flex gap-2">
              {readyCount > 1 && (
                <Button size="sm" onClick={() => void addItems(items.filter((i) => i.status === "ready"))}>
                  Add {readyCount} ready
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setItems((list) => list.filter((i) => i.status === "ready" || i.status === "review" || i.status === "saving" || i.status === "duplicate" || i.status === "error"))}
                disabled={!items.some((i) => i.status === "added" || i.status === "exists" || i.status === "ignored")}
              >
                Clear finished
              </Button>
            </div>
          </div>
          <ul className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <SmsCard
                  key={item.id}
                  item={item}
                  balance={balanceChecks.get(item.id)}
                  actions={{
                    onChange: (patch) => patchItem(item.id, patch),
                    onAdd: (options) => void addItems([item], options),
                    onUndo: () => void undo(item),
                    onOpen: () => void open(item),
                    onDismiss: () => setItems((list) => list.filter((i) => i.id !== item.id)),
                  }}
                />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ) : (
        <HowItWorks />
      )}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { title: "Paste", body: "Copy a transaction SMS and paste it above — one message or many at once." },
    { title: "Check", body: "Hisab reads the amount, bank or wallet, type, date and time, and picks the account and category." },
    { title: "Done", body: "It's added to your ledger. Cash outs and ATM withdrawals become transfers to Cash; fees are recorded separately." },
  ];
  return (
    <section aria-label="How it works" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {steps.map((step, index) => (
        <div key={step.title} className="rounded-xl border border-dashed border-border p-4">
          <p className="mb-1 flex items-center gap-2 text-body font-medium text-text">
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-muted text-caption font-semibold text-text-secondary">
              {index + 1}
            </span>
            {step.title}
          </p>
          <p className="text-small text-text-secondary">{step.body}</p>
        </div>
      ))}
      <p className="text-caption text-text-tertiary sm:col-span-3">
        Works with bKash, Nagad, Rocket, Upay and SMS alerts from Bangladeshi banks and cards, in English or Bengali. The same
        message is never added twice.
      </p>
    </section>
  );
}
