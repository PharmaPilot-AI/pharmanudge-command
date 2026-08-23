import { ArrowLeftRight, Banknote, CreditCard, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/feedback/EmptyState";
import { cartTotals, formatNaira } from "@/lib/money";
import type { CartLine, PaymentMethod } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CartLineItem } from "./CartLineItem";
import { ServiceLineItem } from "./ServiceLineItem";

const paymentMethods: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "transfer", label: "Transfer", icon: ArrowLeftRight },
  { id: "pos_card", label: "POS Card", icon: CreditCard },
];

interface CartPanelProps {
  lines: CartLine[];
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  onQuantityChange: (lineId: string, quantity: number) => void;
  onUnitChange: (lineId: string, unitId: string) => void;
  onRemove: (lineId: string) => void;
  onCheckout: () => void;
  /** True when any product line exceeds available stock. */
  hasStockConflict: boolean;
}

/** Persistent sale cart: lines, payment method and revenue-split totals. */
export function CartPanel({
  lines,
  paymentMethod,
  onPaymentMethodChange,
  onQuantityChange,
  onUnitChange,
  onRemove,
  onCheckout,
  hasStockConflict,
}: CartPanelProps) {
  const totals = cartTotals(lines);

  return (
    <section
      aria-label="Current sale"
      className="flex h-full flex-col rounded-xl border bg-card"
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShoppingCart className="h-4 w-4 text-primary" aria-hidden />
          Current Sale
        </h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
          {lines.length} item{lines.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {lines.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No items yet"
            description="Search for a medicine or service to start a sale."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {lines.map((line) =>
              line.kind === "product" ? (
                <CartLineItem
                  key={line.lineId}
                  line={line}
                  onQuantityChange={(q) => onQuantityChange(line.lineId, q)}
                  onUnitChange={(u) => onUnitChange(line.lineId, u)}
                  onRemove={() => onRemove(line.lineId)}
                />
              ) : (
                <ServiceLineItem
                  key={line.lineId}
                  line={line}
                  onQuantityChange={(q) => onQuantityChange(line.lineId, q)}
                  onRemove={() => onRemove(line.lineId)}
                />
              ),
            )}
          </div>
        )}
      </div>

      <footer className="border-t p-4">
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Products</dt>
            <dd className="font-medium tabular-nums">{formatNaira(totals.productRevenue)}</dd>
          </div>
          {totals.serviceRevenue > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Services</dt>
              <dd className="font-medium tabular-nums text-info">{formatNaira(totals.serviceRevenue)}</dd>
            </div>
          )}
          <Separator className="my-1" />
          <div className="flex justify-between text-base">
            <dt className="font-semibold">Total</dt>
            <dd className="font-bold tabular-nums">{formatNaira(totals.total)}</dd>
          </div>
        </dl>

        <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Payment method">
          {paymentMethods.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onPaymentMethodChange(m.id)}
              aria-pressed={paymentMethod === m.id}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border text-xs font-medium transition-colors",
                paymentMethod === m.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <m.icon className="h-4 w-4" aria-hidden />
              {m.label}
            </button>
          ))}
        </div>

        <Button
          size="lg"
          className="mt-3 h-12 w-full text-base font-semibold"
          disabled={lines.length === 0 || hasStockConflict}
          onClick={onCheckout}
        >
          Charge {formatNaira(totals.total)}
        </Button>
        {hasStockConflict && (
          <p className="mt-2 text-center text-xs font-medium text-destructive">
            One or more items exceed available stock.
          </p>
        )}
      </footer>
    </section>
  );
}
