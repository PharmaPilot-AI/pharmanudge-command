import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, Search, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { CartPanel } from "@/components/pos/CartPanel";
import { ProductResultRow } from "@/components/pos/ProductResultRow";
import { ServiceResultRow } from "@/components/pos/ServiceResultRow";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cartTotals, formatNaira, toBaseUnits } from "@/lib/money";
import { products, services } from "@/lib/mock-data";
import type { CartLine, PaymentMethod, Product, ServiceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pos")({
  head: () => ({
    meta: [
      { title: "Sell / POS — PharmaNudge" },
      { name: "description", content: "Fast pharmacy point of sale: search by name or barcode, sell in any unit, add services, check out." },
      { property: "og:title", content: "Sell / POS — PharmaNudge" },
      { property: "og:description", content: "Fast pharmacy point of sale with unit-flexible selling." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: PosPage,
});

let lineSeq = 0;
const nextLineId = () => `line-${++lineSeq}`;

interface CompletedSale {
  total: number;
  itemCount: number;
  method: PaymentMethod;
}

/**
 * POS workspace. All state is local Phase 1 mock state — checkout ends in a
 * local success state only. Stock impact is shown in base units per line.
 */
function PosPage() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"products" | "services">("products");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cartOpen, setCartOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);

  const q = query.trim().toLowerCase();
  const productResults = useMemo(
    () =>
      products.filter((p) =>
        !q
          ? true
          : [p.name, p.genericName, p.category, p.barcode].some((f) =>
              f.toLowerCase().includes(q),
            ),
      ),
    [q],
  );
  const serviceResults = useMemo(
    () =>
      services.filter((s) =>
        !q
          ? true
          : [s.name, s.description, s.category].some((f) => f.toLowerCase().includes(q)),
      ),
    [q],
  );

  const totals = cartTotals(lines);
  const hasStockConflict = lines.some(
    (l) => l.kind === "product" && toBaseUnits(l.quantity, l.unit) > l.product.baseUnitsInStock,
  );

  const addProduct = (product: Product) => {
    setCompletedSale(null);
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.kind === "product" && l.product.id === product.id && l.unit.id === product.units[0]!.id,
      );
      if (existing) {
        return prev.map((l) =>
          l.lineId === existing.lineId ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        { kind: "product", lineId: nextLineId(), product, unit: product.units[0]!, quantity: 1 },
      ];
    });
  };

  const addService = (service: ServiceItem) => {
    setCompletedSale(null);
    setLines((prev) => {
      const existing = prev.find((l) => l.kind === "service" && l.service.id === service.id);
      if (existing) {
        return prev.map((l) =>
          l.lineId === existing.lineId ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { kind: "service", lineId: nextLineId(), service, quantity: 1 }];
    });
  };

  const updateQuantity = (lineId: string, quantity: number) => {
    if (quantity < 1) return;
    setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, quantity } : l)));
  };

  const updateUnit = (lineId: string, unitId: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.lineId !== lineId || l.kind !== "product") return l;
        const unit = l.product.units.find((u) => u.id === unitId) ?? l.unit;
        return { ...l, unit };
      }),
    );
  };

  const checkout = () => {
    setCompletedSale({ total: totals.total, itemCount: lines.length, method: paymentMethod });
    setLines([]);
    setCartOpen(false);
    toast.success("Sale completed (Phase 1 mock — nothing was saved)");
  };

  const cartPanel = (
    <CartPanel
      lines={lines}
      paymentMethod={paymentMethod}
      onPaymentMethodChange={setPaymentMethod}
      onQuantityChange={updateQuantity}
      onUnitChange={updateUnit}
      onRemove={(lineId) => setLines((prev) => prev.filter((l) => l.lineId !== lineId))}
      onCheckout={checkout}
      hasStockConflict={hasStockConflict}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sell / POS" description="Search by medicine name, generic name or barcode." />

      {completedSale && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-4">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-success">
              Sale completed — {formatNaira(completedSale.total)}
            </p>
            <p className="text-xs text-muted-foreground">
              {completedSale.itemCount} item{completedSale.itemCount === 1 ? "" : "s"} · paid by{" "}
              {completedSale.method === "pos_card" ? "POS card" : completedSale.method}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCompletedSale(null)}>
            Start new sale
          </Button>
        </div>
      )}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-5">
        {/* Search + results */}
        <div className="min-w-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search medicine, generic name or scan barcode…"
              className="h-13 pl-11 text-base"
              aria-label="Search products and services"
            />
          </div>

          <div className="mt-3 flex gap-1.5 rounded-lg border bg-muted p-1" role="tablist" aria-label="Item type">
            {(["products", "services"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "min-h-9 flex-1 rounded-md px-3 text-sm font-medium capitalize transition-colors",
                  tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {tab === "products" ? (
              productResults.length === 0 ? (
                <EmptyState icon={Search} title="No products found" description="Try a different name, generic name or barcode." />
              ) : (
                productResults.map((p) => <ProductResultRow key={p.id} product={p} onAdd={addProduct} />)
              )
            ) : serviceResults.length === 0 ? (
              <EmptyState icon={Search} title="No services found" description="Try a different search term." />
            ) : (
              serviceResults.map((s) => <ServiceResultRow key={s.id} service={s} onAdd={addService} />)
            )}
          </div>
        </div>

        {/* Persistent cart — desktop/tablet */}
        <div className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] lg:block">{cartPanel}</div>
      </div>

      {/* Mobile cart bar + sheet */}
      <div className="fixed inset-x-0 bottom-16 z-30 px-4 lg:hidden">
        <Button
          size="lg"
          className="h-13 w-full justify-between rounded-xl text-base font-semibold shadow-lg"
          onClick={() => setCartOpen(true)}
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" aria-hidden />
            Cart · {lines.length}
          </span>
          <span className="tabular-nums">{formatNaira(totals.total)}</span>
        </Button>
      </div>
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="h-[85dvh] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Current sale</SheetTitle>
          </SheetHeader>
          <div className="h-full p-3">{cartPanel}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
