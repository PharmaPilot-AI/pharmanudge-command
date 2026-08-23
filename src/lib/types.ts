/**
 * PharmaPilot AI — domain types.
 *
 * Framework-light on purpose: no React, router, or backend imports here so
 * these types can be reused unchanged when the real backend (base-unit
 * ledger, batch tracking, server-enforced roles) lands in Phase 2.
 */

/** Roles mirror the eventual server-side role system. */
export type Role = "owner" | "pharmacist" | "cashier" | "accountant";

/** Mode is a user/context choice — never derived from viewport size. */
export type AppMode = "owner" | "ops";

export interface TeamMember {
  id: string;
  name: string;
  role: Role;
  roleLabel: string;
  initials: string;
}

/**
 * A sellable packaging configuration for a product.
 * Inventory is always tracked in base units; units are pricing/conversion
 * layers on top (e.g. 1 tin = 100 tablets).
 */
export interface PackagingUnit {
  id: string;
  /** Display name, e.g. "Tablet", "Strip of 10", "Tin of 100". */
  label: string;
  /** How many base units one of this unit contains. Base unit = 1. */
  baseUnitsPerUnit: number;
  /** Selling price in Naira for one of this unit. */
  price: number;
}

export type StockStatus = "out" | "low" | "ok";

export interface Product {
  id: string;
  name: string;
  genericName: string;
  category: string;
  barcode: string;
  /** Base unit label, e.g. "tablet", "capsule", "bottle", "sachet". */
  baseUnitLabel: string;
  /** Current stock, always expressed in base units. */
  baseUnitsInStock: number;
  /** Reorder threshold in base units. */
  reorderLevelBaseUnits: number;
  /** Cost price per base unit (for margin/valuation math). */
  costPerBaseUnit: number;
  shelfLocation: string;
  /** Sellable units; the base unit (baseUnitsPerUnit = 1) is always first. */
  units: PackagingUnit[];
}

/** A physical stock batch. Expiry tracking is batch-level. */
export interface Batch {
  id: string;
  productId: string;
  batchNumber: string;
  /** ISO date string. */
  expiryDate: string;
  /** Precomputed in mock fixtures; derived server-side later. */
  daysToExpiry: number;
  baseUnitsRemaining: number;
  costPerBaseUnit: number;
  supplier: string;
}

/** Services generate revenue but never touch inventory. */
export interface ServiceItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  durationMinutes?: number;
}

export interface ProductCartLine {
  kind: "product";
  lineId: string;
  product: Product;
  unit: PackagingUnit;
  quantity: number;
}

export interface ServiceCartLine {
  kind: "service";
  lineId: string;
  service: ServiceItem;
  quantity: number;
}

/** Discriminated union keeps product vs service revenue distinguishable. */
export type CartLine = ProductCartLine | ServiceCartLine;

export type PaymentMethod = "cash" | "transfer" | "pos_card";

export type ActionSeverity = "critical" | "warning" | "info";
export type ActionStatus = "open" | "snoozed" | "resolved";

export interface ActionItem {
  id: string;
  severity: ActionSeverity;
  title: string;
  detail: string;
  /** Optional Naira amount attached to the action (variance, value at risk…). */
  amount?: number;
  ctaLabel: string;
  /** App route the CTA links to. */
  ctaPath: string;
  assigneeId?: string | undefined;
}

export interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  time: string;
  recordedBy: string;
}

/** Today-at-a-glance figures for the Owner Command Center. */
export interface DailyKpis {
  salesTotal: number;
  productRevenue: number;
  serviceRevenue: number;
  salesDeltaPct: number;
  grossMargin: number;
  grossMarginPct: number;
  estimatedNetProfit: number;
  expensesTotal: number;
  expectedCash: number;
  countedCash: number;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Present on advisory answers: facts and advice stay visually separated. */
  facts?: string[];
  recommendations?: string[];
  sources?: { label: string; path: string }[];
}
