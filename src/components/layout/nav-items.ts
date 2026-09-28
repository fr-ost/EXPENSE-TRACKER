import {
  ArrowLeftRightIcon,
  BarChart3Icon,
  GaugeIcon,
  HouseIcon,
  MessageSquareTextIcon,
  RepeatIcon,
  Settings2Icon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: HouseIcon },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRightIcon },
  { href: "/sms", label: "Import SMS", icon: MessageSquareTextIcon },
  { href: "/accounts", label: "Accounts", icon: WalletIcon },
  { href: "/budgets", label: "Budgets", icon: GaugeIcon },
  { href: "/recurring", label: "Recurring", icon: RepeatIcon },
  { href: "/reports", label: "Reports", icon: BarChart3Icon },
];

export const SETTINGS_NAV: NavItem = { href: "/settings", label: "Settings", icon: Settings2Icon };

/** Phone tab bar: the four most-used destinations around the add button. */
export const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: HouseIcon },
  { href: "/transactions", label: "Activity", icon: ArrowLeftRightIcon },
  { href: "/accounts", label: "Accounts", icon: WalletIcon },
];

export const MOBILE_MORE: NavItem[] = [
  { href: "/sms", label: "Import SMS", icon: MessageSquareTextIcon },
  { href: "/budgets", label: "Budgets", icon: GaugeIcon },
  { href: "/recurring", label: "Recurring", icon: RepeatIcon },
  { href: "/reports", label: "Reports", icon: BarChart3Icon },
  SETTINGS_NAV,
];

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
