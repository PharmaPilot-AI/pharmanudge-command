/**
 * Money and unit-conversion helpers. Framework-light (no React/router
 * imports) so the same math can back the real backend later.
 *
 * All amounts are whole Naira in Phase 1 mocks.
 */
import type { CartLine, PackagingUnit, Product, StockStatus } from "./types";

/** Deterministic ₦ formatting — identical on server and client (no ICU drift). */
export function formatNaira(amount: number): string {
  const rounded = Math.round(amount);
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "-" : ""}₦${grouped}`;
}

/** "+₦1,200" / "-₦12,400" style for variances and stock impacts. */
export function formatNairaSigned(amount: number): string {
  if (amount === 0) return formatNaira(0);
  return amount > 0 ? `+${formatNaira(amount)}` : formatNaira(amount);
}

/** Convert a quantity in a selling unit to base units (1 tin × 100 = 100 tablets). */
export function toBaseUnits(quantity: number, unit: PackagingUnit): number {
  return quantity * unit.baseUnitsPerUnit;
}

/** Revenue for one cart line (products and services alike). */
export function lineTotal(line: CartLine): number {
  return line.kind === "product"
    ? line.unit.price * line.quantity
    : line.service.price * line.quantity;
}

export function cartTotals(lines: CartLine[]): {
  productRevenue: number;
  serviceRevenue: number;
  total: number;
} {
  let productRevenue = 0;
  let serviceRevenue = 0;
  for (const line of lines) {
    if (line.kind === "product") productRevenue += lineTotal(line);
    else serviceRevenue += lineTotal(line);
  }
  return { productRevenue, serviceRevenue, total: productRevenue + serviceRevenue };
}

export function productStockStatus(product: Product): StockStatus {
  if (product.baseUnitsInStock <= 0) return "out";
  if (product.baseUnitsInStock <= product.reorderLevelBaseUnits) return "low";
  return "ok";
}

/** "1,000 tablets" / "45 packs" — human stock readout in base units. */
export function baseStockLabel(product: Product): string {
  return `${product.baseUnitsInStock.toLocaleString("en-US")} ${product.baseUnitLabel}${product.baseUnitsInStock === 1 ? "" : "s"}`;
}

export function stockStatusLabel(status: StockStatus): string {
  return status === "out" ? "Out of stock" : status === "low" ? "Low stock" : "In stock";
}

export type ExpiryTone = "expired" | "critical" | "warning" | "ok";

export function expiryTone(daysToExpiry: number): ExpiryTone {
  if (daysToExpiry < 0) return "expired";
  if (daysToExpiry <= 30) return "critical";
  if (daysToExpiry <= 90) return "warning";
  return "ok";
}

export function expiryToneLabel(tone: ExpiryTone): string {
  switch (tone) {
    case "expired":
      return "Expired";
    case "critical":
      return "≤ 30 days";
    case "warning":
      return "≤ 90 days";
    default:
      return "Safe";
  }
}
