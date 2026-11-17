"use client";

import { LockKeyholeIcon, LogOutIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { signOut } from "@/components/auth/sign-out-button";
import { BrandLockup, BrandMark } from "@/components/brand";
import { InstallMoreItem, InstallRailButton, InstallSidebarButton } from "@/components/pwa/install-app";
import { useTransactionSheet } from "@/components/transactions/transaction-sheet";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/misc";
import { ResponsiveSheet } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { InactivityMonitor } from "./inactivity-monitor";
import { MOBILE_MORE, MOBILE_TABS, PRIMARY_NAV, SETTINGS_NAV, isActivePath, type NavItem } from "./nav-items";

/** A small count beside a destination (messages waiting on Import SMS). */
function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} waiting`}
      className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] font-semibold leading-none text-white", className)}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function AppShell({
  autoLockMinutes,
  canLock,
  smsWaiting = 0,
  children,
}: {
  /** Minutes without activity before locking; 0 never. */
  autoLockMinutes: number;
  /** The user has an app-lock PIN, so "Lock now" is offered. */
  canLock: boolean;
  /** Messages a linked phone handed in that are waiting on the Import SMS page. */
  smsWaiting?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { openCreate } = useTransactionSheet();
  const [locking, setLocking] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const waitingAt = (href: string) => (href === "/sms" ? smsWaiting : 0);

  const lockNow = React.useCallback(() => {
    // Cover the screen immediately, then lock server-side. The full page
    // navigation drops every client-side copy of financial data.
    setLocking(true);
    const next = `${window.location.pathname}${window.location.search}`;
    void fetch("/api/auth/lock", { method: "POST", credentials: "same-origin" })
      .catch(() => undefined)
      .finally(() => window.location.replace(`/lock?next=${encodeURIComponent(next)}`));
  }, []);

  // "N" opens a new transaction from anywhere (unless typing or in a dialog).
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=listbox], [role=menu], [role=combobox]")) return;
      event.preventDefault();
      openCreate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCreate]);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-ink px-3 py-2 text-small font-medium text-white transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <Sidebar pathname={pathname} onAdd={() => openCreate()} onLock={canLock ? lockNow : null} waitingAt={waitingAt} />
      <Rail pathname={pathname} onAdd={() => openCreate()} onLock={canLock ? lockNow : null} waitingAt={waitingAt} />
      <MobileTopBar onLock={canLock ? lockNow : null} />

      <main id="main" className="md:pl-[76px] lg:pl-[var(--sidebar-width)]">
        <div className="mx-auto w-full max-w-[var(--content-max)] px-4 pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+2rem)] pt-4 sm:px-6 md:pb-16 md:pt-8 lg:px-10 lg:pt-10">
          {children}
        </div>
      </main>

      <MobileTabBar pathname={pathname} onAdd={() => openCreate()} onMore={() => setMoreOpen(true)} waiting={MOBILE_MORE.some((item) => waitingAt(item.href) > 0)} />

      <ResponsiveSheet open={moreOpen} onOpenChange={setMoreOpen} title="More">
        <nav aria-label="More" className="flex flex-col gap-1">
          {MOBILE_MORE.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMoreOpen(false)}
              className={cn(
                "flex h-12 items-center gap-3 rounded-lg px-3 text-body font-medium transition-colors",
                isActivePath(pathname, item.href) ? "bg-surface-muted text-text" : "text-text-secondary hover:bg-surface-muted",
              )}
            >
              <item.icon className="size-5" />
              {item.label}
              <CountBadge count={waitingAt(item.href)} className="ml-auto" />
            </Link>
          ))}
          <div className="my-2 h-px bg-border" />
          <InstallMoreItem />
          {canLock && (
            <button onClick={lockNow} className="flex h-12 items-center gap-3 rounded-lg px-3 text-body font-medium text-text-secondary hover:bg-surface-muted">
              <LockKeyholeIcon className="size-5" />
              Lock now
            </button>
          )}
          <button onClick={() => void signOut()} className="flex h-12 items-center gap-3 rounded-lg px-3 text-body font-medium text-text-secondary hover:bg-surface-muted">
            <LogOutIcon className="size-5" />
            Sign out
          </button>
        </nav>
      </ResponsiveSheet>

      <InactivityMonitor autoLockMinutes={canLock ? autoLockMinutes : 0} onLock={lockNow} />

      {locking && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-canvas" role="status" aria-label="Locking">
          <LockKeyholeIcon className="size-6 text-text-tertiary" />
        </div>
      )}
    </div>
  );
}

type WaitingAt = (href: string) => number;

function Sidebar({ pathname, onAdd, onLock, waitingAt }: { pathname: string; onAdd: () => void; onLock: (() => void) | null; waitingAt: WaitingAt }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-width)] flex-col border-r border-border bg-surface-subtle lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/dashboard" className="rounded-md" aria-label="Hisab overview">
          <BrandLockup />
        </Link>
      </div>
      <div className="px-3 pb-3">
        <Button onClick={onAdd} className="w-full justify-between pl-3.5 pr-2.5">
          <span className="inline-flex items-center gap-2">
            <PlusIcon />
            New transaction
          </span>
          <Kbd className="text-white/70">N</Kbd>
        </Button>
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-3 pt-2">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} active={isActivePath(pathname, item.href)} waiting={waitingAt(item.href)} />
        ))}
      </nav>
      <div className="flex flex-col gap-0.5 border-t border-border px-3 py-3">
        <InstallSidebarButton />
        <SidebarLink item={SETTINGS_NAV} active={isActivePath(pathname, SETTINGS_NAV.href)} />
        {onLock && (
          <button
            onClick={onLock}
            className="flex h-9 items-center gap-3 rounded-md px-3 text-body font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text"
          >
            <LockKeyholeIcon className="size-[18px]" />
            Lock now
          </button>
        )}
        <button
          onClick={() => void signOut()}
          className="flex h-9 items-center gap-3 rounded-md px-3 text-body font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text"
        >
          <LogOutIcon className="size-[18px]" />
          Sign out
        </button>
      </div>
    </aside>
  );
}

function SidebarLink({ item, active, waiting = 0 }: { item: NavItem; active: boolean; waiting?: number }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-9 items-center gap-3 rounded-md px-3 text-body font-medium transition-colors",
        active ? "text-text" : "text-text-secondary hover:bg-surface-muted hover:text-text",
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-md border border-border bg-surface shadow-xs"
          transition={{ type: "spring", stiffness: 520, damping: 40 }}
        />
      )}
      <item.icon className="relative size-[18px]" />
      <span className="relative">{item.label}</span>
      <CountBadge count={waiting} className="relative ml-auto" />
    </Link>
  );
}

function Rail({ pathname, onAdd, onLock, waitingAt }: { pathname: string; onAdd: () => void; onLock: (() => void) | null; waitingAt: WaitingAt }) {
  const railLink = (item: NavItem) => {
    const active = isActivePath(pathname, item.href);
    const waiting = waitingAt(item.href);
    return (
      <Tooltip key={item.href} content={waiting ? `${item.label} · ${waiting} waiting` : item.label} side="right">
        <Link
          href={item.href}
          aria-label={waiting ? `${item.label}, ${waiting} waiting` : item.label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex size-11 items-center justify-center rounded-lg transition-colors",
            active ? "border border-border bg-surface text-text shadow-xs" : "text-text-secondary hover:bg-surface-muted hover:text-text",
          )}
        >
          <item.icon className="size-5" />
          {waiting > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-ink ring-2 ring-surface-subtle" />}
        </Link>
      </Tooltip>
    );
  };
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col items-center gap-2 border-r border-border bg-surface-subtle py-4 md:flex lg:hidden">
      <Link href="/dashboard" aria-label="Hisab overview" className="mb-2 rounded-md">
        <BrandMark />
      </Link>
      <Tooltip content="New transaction (N)" side="right">
        <Button size="icon" onClick={onAdd} aria-label="New transaction" className="size-11 rounded-lg">
          <PlusIcon />
        </Button>
      </Tooltip>
      <nav aria-label="Main" className="mt-2 flex flex-col items-center gap-1">
        {PRIMARY_NAV.map(railLink)}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-1">
        <InstallRailButton />
        {railLink(SETTINGS_NAV)}
        {onLock && (
          <Tooltip content="Lock now" side="right">
            <button onClick={onLock} aria-label="Lock now" className="flex size-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted hover:text-text">
              <LockKeyholeIcon className="size-5" />
            </button>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}

function MobileTopBar({ onLock }: { onLock: (() => void) | null }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/70 bg-canvas/85 px-4 backdrop-blur-xl md:hidden">
      <Link href="/dashboard" aria-label="Hisab overview" className="rounded-md">
        <BrandLockup />
      </Link>
      {onLock && (
        <Button variant="ghost" size="icon" onClick={onLock} aria-label="Lock now">
          <LockKeyholeIcon />
        </Button>
      )}
    </header>
  );
}

function MobileTabBar({ pathname, onAdd, onMore, waiting }: { pathname: string; onAdd: () => void; onMore: () => void; waiting: boolean }) {
  const moreActive = MOBILE_MORE.some((item) => isActivePath(pathname, item.href));
  const tab = (item: NavItem) => {
    const active = isActivePath(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
          active ? "text-text" : "text-text-tertiary",
        )}
      >
        <item.icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
        {item.label}
      </Link>
    );
  };
  return (
    <nav
      aria-label="Main"
      data-tabbar
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-canvas/90 pb-safe backdrop-blur-xl md:hidden"
    >
      <div className="flex h-[var(--bottom-nav-height)] items-stretch px-2">
        {tab(MOBILE_TABS[0])}
        {tab(MOBILE_TABS[1])}
        <div className="flex flex-1 items-center justify-center">
          <button
            onClick={onAdd}
            aria-label="New transaction"
            className="inline-flex size-12 items-center justify-center rounded-full bg-ink text-white shadow-md transition-transform active:scale-95"
          >
            <PlusIcon className="size-6" />
          </button>
        </div>
        {tab(MOBILE_TABS[2])}
        <button
          onClick={onMore}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
            moreActive ? "text-text" : "text-text-tertiary",
          )}
        >
          <span className="relative">
            <MoreHorizontalIcon className="size-[22px]" />
            {waiting && <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-ink ring-2 ring-canvas" />}
          </span>
          More{waiting && <span className="sr-only"> (messages waiting)</span>}
        </button>
      </div>
    </nav>
  );
}
