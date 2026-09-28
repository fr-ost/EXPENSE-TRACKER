import { ArrowRightIcon, GaugeIcon, ListPlusIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: WalletIcon,
    title: "Add your accounts",
    description: "Cash, bank, bKash, Nagad, cards — each with the balance it held on a date you choose.",
  },
  {
    icon: ListPlusIcon,
    title: "Record transactions",
    description: "Income, expenses and transfers. Back-fill older months and years whenever you like.",
  },
  {
    icon: GaugeIcon,
    title: "Set budgets",
    description: "Monthly limits for the categories you want to watch, with calm warnings at 80% and 100%.",
  },
];

/** First-run state: what Hisab is and the three steps to get going. */
export function Onboarding({ name }: { name: string }) {
  return (
    <div className="mx-auto flex max-w-2xl animate-rise flex-col gap-10 py-6 sm:py-12">
      <div className="flex flex-col gap-4">
        <BrandMark className="size-11" />
        <div className="flex flex-col gap-2">
          <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.03em] text-text">
            Welcome{name ? `, ${name}` : ""}.
          </h1>
          <p className="max-w-lg text-[0.9375rem] leading-relaxed text-text-secondary">
            Hisab is your private ledger. Balances are always calculated from your transactions, so they stay right — even
            when you add entries from months ago.
          </p>
        </div>
      </div>
      <ol className="flex flex-col gap-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex items-start gap-4 rounded-xl border border-border p-5">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-surface-muted text-text">
              <step.icon className="size-5" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-body font-semibold text-text">
                {index + 1}. {step.title}
              </span>
              <span className="text-body text-text-secondary">{step.description}</span>
            </span>
          </li>
        ))}
      </ol>
      <Button asChild size="lg" className="self-start">
        <Link href="/accounts?new=1">
          Add your first account
          <ArrowRightIcon />
        </Link>
      </Button>
    </div>
  );
}
