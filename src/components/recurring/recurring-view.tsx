"use client";

import { MoreHorizontalIcon, PlusIcon, RepeatIcon, SkipForwardIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Amount } from "@/components/app-data";
import { IconBadge } from "@/components/icon";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api-client";
import { describeSchedule, formatRelativeDay, type ISODate } from "@/lib/dates";
import type { RecurringView as Rule } from "@/lib/types";
import { RecurringSheet } from "./recurring-sheet";

function ruleTitle(rule: Rule) {
  return rule.description || rule.category?.name || (rule.type === "TRANSFER" ? "Transfer" : "Recurring");
}

function ruleIcon(rule: Rule) {
  if (rule.type === "TRANSFER" && !rule.countAsExpense) return { icon: "arrow-left-right", color: "slate" };
  return { icon: rule.category?.icon ?? "repeat", color: rule.category?.color ?? "gray" };
}

function RuleAmount({ rule }: { rule: Rule }) {
  if (rule.type === "INCOME") return <Amount value={rule.amount} currency={rule.account.currency} sign="always" tone="income" />;
  if (rule.type === "EXPENSE" || rule.countAsExpense) return <Amount value={`-${rule.amount}`} currency={rule.account.currency} />;
  return <Amount value={rule.amount} currency={rule.account.currency} className="text-text-secondary" />;
}

export function RecurringView({ rules, upcoming, today }: { rules: Rule[]; upcoming: Array<{ rule: Rule; date: ISODate }>; today: ISODate }) {
  const router = useRouter();
  const [sheet, setSheet] = React.useState<{ key: number; open: boolean; rule?: Rule }>({ key: 0, open: false });
  const open = (rule?: Rule) => setSheet((s) => ({ key: s.key + 1, open: true, rule }));

  async function toggle(rule: Rule, isActive: boolean) {
    try {
      await api(`/api/recurring/${rule.id}`, { method: "PATCH", body: { isActive } });
      toast.success(isActive ? `${ruleTitle(rule)} resumed` : `${ruleTitle(rule)} paused`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function skip(rule: Rule) {
    try {
      await api(`/api/recurring/${rule.id}/skip`, { method: "POST" });
      toast.success("Next payment skipped");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader
        title="Recurring"
        description="Rent, bills, subscriptions and allowances — recorded automatically when they fall due."
        actions={
          <Button onClick={() => open()}>
            <PlusIcon />
            New recurring
          </Button>
        }
      />

      {rules.length === 0 ? (
        <EmptyState
          icon={<RepeatIcon />}
          title="Nothing recurring yet"
          description="Set up the regulars once — rent, internet, mobile bill, subscriptions, a monthly family allowance — and Hisab records each one on its date. Each occurrence is posted exactly once."
          action={
            <Button onClick={() => open()}>
              <PlusIcon />
              Add recurring transaction
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader title="All recurring" description={`${rules.filter((r) => r.isActive).length} active`} />
            <ul className="flex flex-col px-3 pb-3 pt-2 sm:px-4">
              {rules.map((rule) => {
                const icon = ruleIcon(rule);
                return (
                  <li key={rule.id} className="flex items-center gap-2 rounded-lg transition-colors hover:bg-surface-subtle">
                    <button
                      type="button"
                      onClick={() => open(rule)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]"
                    >
                      <IconBadge icon={icon.icon} color={icon.color} className={rule.isActive ? undefined : "opacity-50"} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-body font-medium text-text">{ruleTitle(rule)}</span>
                          {!rule.isActive && <Badge>Paused</Badge>}
                        </span>
                        <span className="truncate text-small text-text-tertiary">
                          {describeSchedule(rule.frequency, rule.startDate)}
                          {rule.isActive && rule.nextOccurrence && ` · Next: ${formatRelativeDay(rule.nextOccurrence, today)}`}
                          {!rule.nextOccurrence && " · ended"}
                        </span>
                      </span>
                      <span className="shrink-0 text-body font-medium">
                        <RuleAmount rule={rule} />
                      </span>
                    </button>
                    <Switch checked={rule.isActive} onCheckedChange={(value) => void toggle(rule, value)} aria-label={rule.isActive ? `Pause ${ruleTitle(rule)}` : `Resume ${ruleTitle(rule)}`} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`More for ${ruleTitle(rule)}`} className="mr-1">
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem disabled={!rule.isActive || !rule.nextOccurrence} onSelect={() => void skip(rule)}>
                          <SkipForwardIcon />
                          Skip next payment
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="lg:col-span-2 lg:self-start">
            <CardHeader title="Next 30 days" description={upcoming.length ? `${upcoming.length} scheduled` : "Nothing scheduled"} />
            <ul className="flex flex-col px-5 pb-4 pt-2 sm:px-6">
              {upcoming.length === 0 && <li className="py-6 text-center text-small text-text-tertiary">No payments due in the next 30 days.</li>}
              {upcoming.slice(0, 12).map(({ rule, date }) => (
                <li key={`${rule.id}-${date}`} className="flex items-center gap-3 py-2">
                  <span className="w-20 shrink-0 text-small text-text-tertiary">{formatRelativeDay(date, today)}</span>
                  <span className="min-w-0 flex-1 truncate text-body text-text">{ruleTitle(rule)}</span>
                  <span className="text-body font-medium">
                    <RuleAmount rule={rule} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <RecurringSheet key={sheet.key} open={sheet.open} onOpenChange={(value) => setSheet((s) => ({ ...s, open: value }))} rule={sheet.rule} />
    </>
  );
}
