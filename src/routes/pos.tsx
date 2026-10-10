import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { posCatalogueQuery, confirmPharmacySaleMutation } from "@/lib/data/validation";
import { saleSchema, type SaleInput } from "@/lib/data/sale-schema";
import type { CartLine, PaymentMethod, Product, ServiceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pos")({
  loader: () => posCatalogueQuery(),
  head: () => ({
    meta: [
      { title: "Sell / POS — PharmaNudge" },
      {
        name: "description",
        content:
          "Fast pharmacy point of sale: search by name or barcode, sell in any unit, add services, check out.",
      },
      { property: "og:title", content: "Sell / POS — PharmaNudge" },
      {
        property: "og:description",
        content: "Fast pharmacy point of sale with unit-flexible selling.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: PosPage,
});

let lineSeq = 0;
const nextLineId = () => `line-${++lineSeq}`;

interface CompletedSale {
  saleId: string;
  total: number;
  itemCount: number;
  method: PaymentMethod;
}

/** Real POS catalogue and atomic checkout with recoverable submissions. */
function PosPage() {
  const catalogue = Route.useLoaderData();
  const router = useRouter();
  const { pharmacyContext } = Route.useRouteContext();
  const storageKey = pharmacyContext
    ? `pharmanudge:pending-sale:${pharmacyContext.pharmacyId}:${pharmacyContext.userId}`
    : null;
  const pendingRef = useRef<SaleInput | null>(null);
  const submittingRef = useRef(false);
  const [pendingSale, setPendingSale] = useState<SaleInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [refreshRequired, setRefreshRequired] = useState(false);

  useEffect(() => {
    setStorageReady(false);
    setStorageError("");
    pendingRef.current = null;
    setPendingSale(null);
    if (!storageKey) return;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const request = saleSchema.parse(JSON.parse(saved));
        pendingRef.current = request;
        setPendingSale(request);
      }
      setStorageReady(true);
    } catch {
      setStorageError(
        "Cannot recover the saved checkout submission. Ask the owner to review it before starting another sale.",
      );
    }
  }, [storageKey]);

  const editingLocked = !storageReady || saving || pendingSale !== null || refreshRequired;
  const products = useMemo<Product[]>(
    () =>
      catalogue.products
        .filter((product) => product.units.length > 0)
        .map((product) => ({
          id: product.id,
          name: product.name,
          genericName: product.generic_name ?? "",
          category: product.category ?? "",
          barcode: product.barcode ?? "",
          baseUnitLabel: product.base_unit_label,
          baseUnitsInStock: Number(product.available_quantity),
          // Compatibility fields for the existing display type.
          // The POS catalogue does not return purchase costs or reorder levels.
          costPerBaseUnit: 0,
          reorderLevelBaseUnits: 0,
          shelfLocation: product.shelf_location ?? "",
          units: product.units.map((unit) => ({
            id: unit.id,
            label: unit.label,
            baseUnitsPerUnit: unit.base_units_per_unit,
            price: unit.price,
          })),
        })),
    [catalogue.products],
  );
  const services = useMemo<ServiceItem[]>(
    () =>
      catalogue.services.map((service) => ({
        id: service.id,
        name: service.name,
        price: service.price,
        description: "",
        category: "",
      })),
    [catalogue.services],
  );
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
          : [p.name, p.genericName, p.category, p.barcode].some((f) => f.toLowerCase().includes(q)),
      ),
    [q, products],
  );
  const serviceResults = useMemo(
    () =>
      services.filter((s) =>
        !q ? true : [s.name, s.description, s.category].some((f) => f.toLowerCase().includes(q)),
      ),
    [q, services],
  );

  const totals = cartTotals(lines);
  const requestedStock = new Map<string, number>();
  for (const line of lines) {
    if (line.kind === "product") {
      requestedStock.set(
        line.product.id,
        (requestedStock.get(line.product.id) ?? 0) + toBaseUnits(line.quantity, line.unit),
      );
    }
  }
  const hasStockConflict = [...requestedStock].some(([id, quantity]) => {
    const current = products.find((product) => product.id === id);
    return (
      !current ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(current.baseUnitsInStock) ||
      quantity > current.baseUnitsInStock
    );
  });

  const addProduct = (product: Product) => {
    if (editingLocked || submittingRef.current) return;
    setCompletedSale(null);
    setLines((prev) => {
      const existing = prev.find(
        (l) =>
          l.kind === "product" && l.product.id === product.id && l.unit.id === product.units[0]!.id,
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
    if (editingLocked || submittingRef.current) return;
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
    if (editingLocked || submittingRef.current) return;
    if (quantity < 1) return;
    setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, quantity } : l)));
  };

  const updateUnit = (lineId: string, unitId: string) => {
    if (editingLocked || submittingRef.current) return;
    setLines((prev) =>
      prev.map((l) => {
        if (l.lineId !== lineId || l.kind !== "product") return l;
        const unit = l.product.units.find((u) => u.id === unitId) ?? l.unit;
        return { ...l, unit };
      }),
    );
  };

  const refreshCatalogue = async () => {
    setRefreshRequired(true);
    try {
      await router.invalidate();
      setRefreshRequired(false);
    } catch {
      toast.error("Refresh failed. Refresh the catalogue before starting another sale.");
    }
  };

  const checkout = async () => {
    if (submittingRef.current || !storageReady || !storageKey) return;
    if (!pendingRef.current && (refreshRequired || lines.length === 0 || hasStockConflict)) return;

    submittingRef.current = true;
    setSaving(true);
    try {
      let request = pendingRef.current;
      if (!request) {
        request = saleSchema.parse({
          operation_id: crypto.randomUUID(),
          payment_method: paymentMethod,
          lines: lines.map((line) =>
            line.kind === "product"
              ? {
                  kind: "product",
                  product_id: line.product.id,
                  packaging_unit_id: line.unit.id,
                  quantity: line.quantity,
                  expected_unit_price: line.unit.price,
                }
              : {
                  kind: "service",
                  service_id: line.service.id,
                  quantity: line.quantity,
                  expected_unit_price: line.service.price,
                },
          ),
        });
        // Persist before sending. If persistence fails, do not submit.
        sessionStorage.setItem(storageKey, JSON.stringify(request));
        pendingRef.current = request;
        setPendingSale(request);
      }

      const result = await confirmPharmacySaleMutation({ data: request });

      if (result.status === "confirmed") {
        setCompletedSale({
          saleId: result.saleId,
          total: request.lines.reduce(
            (sum, line) => sum + Math.round(line.quantity * line.expected_unit_price * 100) / 100,
            0,
          ),
          itemCount: request.lines.length,
          method: request.payment_method,
        });
        setLines([]);
        setCartOpen(false);
        toast.success("Sale saved. Stock updated.");
      } else {
        setLines([]);
        toast.error(result.message);
      }

      // Clear only after a confirmed sale or a definite database rejection.
      sessionStorage.removeItem(storageKey);
      pendingRef.current = null;
      setPendingSale(null);
      await refreshCatalogue();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checkout failed.";
      toast.error(
        pendingRef.current
          ? `${message} Use Retry saved submission to resolve this sale.`
          : message,
      );
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const cartPanel = (
    <CartPanel
      lines={lines}
      paymentMethod={paymentMethod}
      onPaymentMethodChange={(method) => {
        if (!editingLocked && !submittingRef.current) setPaymentMethod(method);
      }}
      onQuantityChange={updateQuantity}
      onUnitChange={updateUnit}
      onRemove={(lineId) => {
        if (!editingLocked && !submittingRef.current) {
          setLines((prev) => prev.filter((line) => line.lineId !== lineId));
        }
      }}
      onCheckout={checkout}
      hasStockConflict={hasStockConflict}
      checkoutDisabled={editingLocked}
      editingDisabled={editingLocked}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sell / POS"
        description="Search by medicine name, generic name or barcode."
      />

      {storageError && (
        <p
          role="alert"
          className="rounded-xl border border-destructive p-4 text-sm text-destructive"
        >
          {storageError}
        </p>
      )}
      {pendingSale && (
        <div role="status" className="rounded-xl border border-warning p-4 text-sm">
          <p>
            A saved checkout submission needs confirmation. Resolve it before starting another sale.
          </p>
          <Button className="mt-3" disabled={saving} onClick={() => void checkout()}>
            {saving ? "Confirming sale…" : "Retry saved submission"}
          </Button>
        </div>
      )}
      {refreshRequired && !pendingSale && (
        <div role="status" className="rounded-xl border p-4 text-sm">
          <p>Refresh stock and selling prices before starting another sale.</p>
          <Button className="mt-3" disabled={saving} onClick={() => void refreshCatalogue()}>
            Refresh catalogue
          </Button>
        </div>
      )}

      {completedSale && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-4">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-success">
              Sale completed — {formatNaira(completedSale.total)}
            </p>
            <p className="text-xs text-muted-foreground">
              Sale reference: {completedSale.saleId} · {completedSale.itemCount} item
              {completedSale.itemCount === 1 ? "" : "s"} · paid by{" "}
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
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search medicine, generic name or scan barcode…"
              className="h-13 pl-11 text-base"
              aria-label="Search products and services"
            />
          </div>

          <div
            className="mt-3 flex gap-1.5 rounded-lg border bg-muted p-1"
            role="tablist"
            aria-label="Item type"
          >
            {(["products", "services"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "min-h-9 flex-1 rounded-md px-3 text-sm font-medium capitalize transition-colors",
                  tab === t
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {tab === "products" ? (
              productResults.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No products found"
                  description="Try a different name, generic name or barcode."
                />
              ) : (
                productResults.map((p) => (
                  <ProductResultRow key={p.id} product={p} onAdd={addProduct} />
                ))
              )
            ) : serviceResults.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No services found"
                description="Try a different search term."
              />
            ) : (
              serviceResults.map((s) => (
                <ServiceResultRow key={s.id} service={s} onAdd={addService} />
              ))
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
