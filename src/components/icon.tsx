import {
  ArrowLeftRightIcon,
  BabyIcon,
  BanknoteIcon,
  BookOpenIcon,
  BriefcaseIcon,
  BusIcon,
  CarIcon,
  CircleDashedIcon,
  ClapperboardIcon,
  CoffeeIcon,
  CoinsIcon,
  CreditCardIcon,
  DumbbellIcon,
  FuelIcon,
  Gamepad2Icon,
  GiftIcon,
  GraduationCapIcon,
  HandHeartIcon,
  HeartPulseIcon,
  HouseIcon,
  LandmarkIcon,
  LaptopIcon,
  LightbulbIcon,
  PawPrintIcon,
  PenToolIcon,
  PhoneIcon,
  PiggyBankIcon,
  PillIcon,
  PlaneIcon,
  ReceiptIcon,
  RepeatIcon,
  ScaleIcon,
  ShirtIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  SmartphoneIcon,
  StoreIcon,
  TrendingUpIcon,
  UserIcon,
  UsersIcon,
  UtensilsIcon,
  VaultIcon,
  WalletIcon,
  WifiIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { isIconKey, isPaletteKey, type IconKey, type PaletteKey } from "@/lib/domain";
import { cn } from "@/lib/utils";

const ICONS: Record<IconKey, LucideIcon> = {
  users: UsersIcon,
  user: UserIcon,
  baby: BabyIcon,
  utensils: UtensilsIcon,
  coffee: CoffeeIcon,
  "shopping-cart": ShoppingCartIcon,
  bus: BusIcon,
  car: CarIcon,
  fuel: FuelIcon,
  plane: PlaneIcon,
  house: HouseIcon,
  lightbulb: LightbulbIcon,
  wifi: WifiIcon,
  phone: PhoneIcon,
  receipt: ReceiptIcon,
  "graduation-cap": GraduationCapIcon,
  "book-open": BookOpenIcon,
  "heart-pulse": HeartPulseIcon,
  pill: PillIcon,
  "shopping-bag": ShoppingBagIcon,
  shirt: ShirtIcon,
  repeat: RepeatIcon,
  laptop: LaptopIcon,
  clapperboard: ClapperboardIcon,
  gamepad: Gamepad2Icon,
  dumbbell: DumbbellIcon,
  gift: GiftIcon,
  "hand-heart": HandHeartIcon,
  "paw-print": PawPrintIcon,
  wrench: WrenchIcon,
  "circle-dashed": CircleDashedIcon,
  briefcase: BriefcaseIcon,
  store: StoreIcon,
  "pen-tool": PenToolIcon,
  "trending-up": TrendingUpIcon,
  "piggy-bank": PiggyBankIcon,
  coins: CoinsIcon,
  banknote: BanknoteIcon,
  landmark: LandmarkIcon,
  smartphone: SmartphoneIcon,
  "credit-card": CreditCardIcon,
  "arrow-left-right": ArrowLeftRightIcon,
  wallet: WalletIcon,
  vault: VaultIcon,
  scale: ScaleIcon,
};

export function paletteVar(color: string | null | undefined): string {
  return `var(--palette-${isPaletteKey(color) ? color : "gray"})`;
}

export function AppIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = ICONS[isIconKey(name) ? name : "circle-dashed"];
  return <Icon className={className} aria-hidden />;
}

/**
 * The tinted rounded glyph used for categories and accounts throughout the
 * app: a soft wash of the palette colour behind a full-strength icon.
 */
export function IconBadge({
  icon,
  color,
  size = "md",
  className,
}: {
  icon: string | null | undefined;
  color: PaletteKey | string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const colorVar = paletteVar(color);
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden",
        size === "sm" && "size-7 rounded-[8px] [&_svg]:size-3.5",
        size === "md" && "size-9 rounded-[10px] [&_svg]:size-[17px]",
        size === "lg" && "size-11 rounded-[12px] [&_svg]:size-5",
        className,
      )}
      style={{ color: colorVar }}
    >
      <span className="absolute inset-0 bg-current opacity-[0.11]" />
      <AppIcon name={icon} className="relative" />
    </span>
  );
}

export { ICONS };
