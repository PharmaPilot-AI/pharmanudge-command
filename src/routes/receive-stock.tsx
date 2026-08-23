import { createFileRoute } from "@tanstack/react-router";
import { FormEvent, useMemo, useState } from "react";
import { PackageCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNaira, toBaseUnits } from "@/lib/money";
import { products, suppliers } from "@/lib/mock-data";

export const Route = createFileRoute("/receive-stock")({
  head: () => ({
    meta: [
      { title: "Receive Stock — PharmaPilot AI" },
      { name: "description", content: "Record supplier deliveries with batch and expiry. Review base-unit equivalents before confirming." },
      { property: "og:title", content: "Receive Stock — PharmaPilot AI" },
      { property: "og:description", content: "Record supplier deliveries with batch and expiry tracking." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ReceiveStock,
});

interface ReceiptEntry {
  id: number;
  productId: string;
  unitId: string;
  quantity: number;
  costPerUnit: number;
  batchNumber: string;
  expiryDate: string;
  supplier: string;
}

let entrySeq = 0;

/**
 * Receive Stock. Entry → review (with base-unit equivalents) → confirm.
 * Confirm updates local mock state only; no backend writes in Phase 1.
 */
function ReceiveStock() {
  const [supplier, setSupplier] = useState(suppliers[0]!);
  const [productId, setProductId] = useState(products[0]!.id);
  const [unitId, setUnitId] = useState(products[0]!.units[0]!.id);
  const [quantity, setQuantity] = useState("");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [review, setReview] = useState<ReceiptEntry[]>([]);
  const [received, setReceived] = useState<ReceiptEntry[]>([]);

  const product = useMemo(() => products.find((p) => p.id === productId)!, [productId]);
  const unit = useMemo(
    () => product.units.find((u) => u.id === unitId) ?? product.units[0]!,
    [product, unitId],
  );

  const changeProduct = (id: string) => {
    setProductId(id);
    setUnitId(products.find((p) => p.id === id)!.units[0]!.id);
  };

  const addEntry = (e: FormEvent) => {
    e.preventDefault();
    const qty = Number.parseInt(quantity, 10);
    const cost = Number.parseFloat(costPerUnit);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Enter a valid quantity");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      toast.error("Enter a valid cost per unit");
      return;
    }
    if (!batchNumber.trim()) {
      toast.error("Enter a batch number");
      return;
    }
    if (!expiryDate) {
      toast.error("Enter an expiry date");
      return;
    }

    setReview((prev) => [
      ...prev,
      {
        id: ++entrySeq,
        productId,
        unitId: unit.id,
        quantity: qty,
        costPerUnit: cost,
        batchNumber: batchNumber.trim(),
        expiryDate,
        supplier,
      },
    ]);
    setQuantity("");
    setCostPerUnit("");
    setBatchNumber("");
    setExpiryDate("");
  };

  const confirmReceipt = () => {
    setReceived((prev) => [...review, ...prev]);
    setReview([]);
    toast.success("Stock receipt recorded locally (Phase 1 mock — nothing was saved)");
  };

  const describe = (entry: ReceiptEntry) => {
    const p = products.find((x) => x.id === entry.productId)!;
    const u = p.units.find((x) => x.id === entry.unitId)!;
    const base = toBaseUnits(entry.quantity, u);
    return { p, u, base };
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Receive Stock"
        description="Record a supplier delivery with batch and expiry. Everything converts to base units."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="h-4 w-4 text-primary" aria-hidden />
            New delivery entry
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addEntry} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rs-supplier">Supplier</Label>
              <Select value={supplier} onValueChange={setSupplier}>
                <SelectTrigger id="rs-supplier" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rs-product">Product</Label>
              <Select value={productId} onValueChange={changeProduct}>
                <SelectTrigger id="rs-product" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rs-unit">Unit received</Label>
              <Select value={unit.id} onValueChange={setUnitId}>
                <SelectTrigger id="rs-unit" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {product.units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.label}{u.baseUnitsPerUnit > 1 ? ` (= ${u.baseUnitsPerUnit} ${product.baseUnitLabel}s)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rs-qty">Quantity ({unit.label})</Label>
              <Input id="rs-qty" type="number" min={1} inputMode="numeric" placeholder="e.g. 5" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-11 tabular-nums" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rs-cost">Cost per {unit.label.toLowerCase()} (₦)</Label>
              <Input id="rs-cost" type="number" min={0} inputMode="decimal" placeholder="e.g. 21000" value={costPerUnit} onChange={(e) => setCostPerUnit(e.target.value)} className="h-11 tabular-nums" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rs-batch">Batch number</Label>
              <Input id="rs-batch" placeholder="e.g. PX-9102" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} className="h-11" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rs-expiry">Expiry date</Label>
              <Input id="rs-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="h-11" />
            </div>
            <div className="flex items-end sm:col-span-2 lg:col-span-3">
              <Button type="submit" className="h-11 w-full sm:w-auto">Add to delivery</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Review */}
      <section aria-label="Review delivery">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Review before confirming
        </h2>
        {review.length === 0 ? (
          <EmptyState icon={PackageCheck} title="Nothing to review" description="Add delivery entries above — base-unit equivalents appear here before you confirm." />
        ) : (
          <div className="flex flex-col gap-2">
            {review.map((entry) => {
              const { p, u, base } = describe(entry);
              return (
                <div key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card p-3.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Batch {entry.batchNumber} · expires {entry.expiryDate} · {entry.supplier}
                    </p>
                  </div>
                  <p className="tabular-nums text-muted-foreground">
                    {entry.quantity} × {u.label} = <span className="font-semibold text-foreground">{base.toLocaleString("en-US")} {p.baseUnitLabel}s</span>
                  </p>
                  <p className="font-semibold tabular-nums">{formatNaira(entry.costPerUnit * entry.quantity)}</p>
                </div>
              );
            })}
            <Button onClick={confirmReceipt} className="mt-1 h-11 self-start">
              Confirm receipt ({review.length} item{review.length === 1 ? "" : "s"})
            </Button>
          </div>
        )}
      </section>

      {/* Received today */}
      {received.length > 0 && (
        <section aria-label="Received today">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Received today (local mock)
          </h2>
          <div className="flex flex-col gap-2">
            {received.map((entry) => {
              const { p, u, base } = describe(entry);
              return (
                <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-3 text-sm">
                  <PackageCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  <p className="min-w-0 flex-1 truncate">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-muted-foreground"> · {entry.quantity} × {u.label} · Batch {entry.batchNumber}</span>
                  </p>
                  <span className="shrink-0 tabular-nums text-success">+{base.toLocaleString("en-US")} {p.baseUnitLabel}s</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
