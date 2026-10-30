import type { LinkProps } from "@tanstack/react-router";
import {
  BarChart3,
  Boxes,
  CalendarClock,
  ClipboardList,
  Home,
  Layers,
  LockKeyhole,
  Package,
  ReceiptText,
  ShoppingCart,
  Stethoscope,
  Truck,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  icon: LucideIcon;
}

/** Owner mode — mobile-first bottom navigation. */
export const ownerNav: NavItem[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/actions", label: "Actions", icon: Zap },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/money", label: "Money", icon: Wallet },
];

/** Operations mode — labeled sidebar; first four also anchor mobile nav. */
export const opsNav: NavItem[] = [
  { to: "/pos", label: "Sell / POS", icon: ShoppingCart },
  { to: "/products", label: "Products", icon: Package },
  { to: "/receive-stock", label: "Receive Stock", icon: Truck },
  { to: "/inventory-ops", label: "Inventory", icon: ClipboardList },
  { to: "/expiry", label: "Expiry", icon: CalendarClock },
  { to: "/expenses", label: "Expenses", icon: ReceiptText },
  { to: "/close-day", label: "Close Day", icon: LockKeyhole },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/users", label: "Users & Roles", icon: Users },
  { to: "/services", label: "Service Catalog", icon: Stethoscope },
  { to: "/packaging", label: "Packaging", icon: Layers },
];

/** Items shown directly on the mobile bottom bar in ops mode (rest under Menu). */
export const opsMobilePrimaryPaths = ["/pos", "/receive-stock", "/inventory-ops", "/expenses"];
