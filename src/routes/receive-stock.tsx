import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";
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
import { confirmStockReceiptMutation, stockReceiptCatalogueQuery } from "@/lib/data/validation";
import {
  stockReceiptSchema,
  type ReceiptSubmission,
  type StockReceiptInput,
} from "@/lib/data/stock-receipt-schema";
import { ReceiptRecovery } from "@/lib/data/pending-stock-receipt";

export const Route = createFileRoute("/receive-stock")({
  beforeLoad: ({ context }) => {
    const role = context.pharmacyContext?.role;
    if (role !== "owner" && role !== "pharmacist") {
      throw redirect({ to: role === "accountant" ? "/reports" : "/pos" });
    }
  },
  loader: () => stockReceiptCatalogueQuery(),
  head: () => ({
    meta: [
      { title: "Receive Stock — PharmaNudge" },
      {
        name: "description",
        content: "Record supplier deliveries with batch and expiry tracking.",
      },
    ],
  }),
  component: ReceiveStock,
});

type ReceiptItem = StockReceiptInput["items"][number];

interface ReviewEntry {
  key: string;
  item: ReceiptItem;
  productName: string;
  unitLabel: string;
  baseUnitLabel: string;
  conversionFactor: number;
}

function receiptMoney(value: number): string {
  const [whole, fraction] = value.toFixed(2).split(".");
  return `₦${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function lagosToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function ReceiveStock() {
  const { pharmacyContext } = Route.useRouteContext();
  if (!pharmacyContext) return <p role="alert">An authenticated pharmacy context is required.</p>;
  return (
    <ReceiptForm
      key={`${pharmacyContext.pharmacyId}:${pharmacyContext.userId}`}
      pharmacyId={pharmacyContext.pharmacyId}
      userId={pharmacyContext.userId}
    />
  );
}

function ReceiptForm({ pharmacyId, userId }: { pharmacyId: string; userId: string }) {
  const { products, units } = Route.useLoaderData();
  const router = useRouter();
  const saveReceipt = useServerFn(confirmStockReceiptMutation);
  const [recovery] = useState(
    () => new ReceiptRecovery({ pharmacyId, userId }, () => sessionStorage),
  );
  const [pending, setPending] = useState<ReceiptSubmission | null>(null);
  const [ready, setReady] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [invoice, setInvoice] = useState("");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [unitId, setUnitId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [review, setReview] = useState<ReviewEntry[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setPending(recovery.recover());
      setReady(recovery.ready);
    } catch {
      setReady(false);
      setError("Saved receipt recovery is blocked. Recheck storage before continuing.");
    }
  }, [recovery]);

  const locked = !ready || busy || pending !== null || refreshRequired;
  const recheckRecovery = () => {
    try {
      setPending(recovery.recover());
      setReady(recovery.ready);
      setError(null);
    } catch {
      setReady(false);
      setError(
        "Saved receipt recovery is blocked. Resolve storage availability or changed data before continuing.",
      );
    }
  };

  const product = products.find((entry) => entry.id === productId);
  const productUnits = units.filter((entry) => entry.product_id === productId);
  const unit = productUnits.find((entry) => entry.id === unitId) ?? productUnits[0];

  const addEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked || recovery.busy || recovery.pending) return;
    if (!product || !unit) {
      toast.error("Choose a product with an active packaging unit.");
      return;
    }
    if (review.length >= 100) {
      toast.error("A delivery can contain at most 100 entries.");
      return;
    }
    const decimal = /^\d+(?:\.\d{1,6})?$/;
    if (!decimal.test(quantity) || !decimal.test(cost)) {
      toast.error("Enter quantity and purchase cost with up to six decimal places.");
      return;
    }

    const parsed = stockReceiptSchema.shape.items.element.safeParse({
      product_id: product.id,
      packaging_unit_id: unit.id,
      quantity: Number(quantity),
      cost_per_packaging_unit: Number(cost),
      batch_number: batch,
      expiry_date: expiry,
    });
    if (!parsed.success) {
      toast.error("Check the quantity, purchase cost, batch number and expiry date.");
      return;
    }
    if (parsed.data.expiry_date <= lagosToday()) {
      toast.error("Stock expiry must be after today.");
      return;
    }
    const baseQuantity = parsed.data.quantity * unit.base_units_per_unit;
    if (
      baseQuantity >= 1000000000000 ||
      parsed.data.quantity * parsed.data.cost_per_packaging_unit >= 10000000000000000
    ) {
      toast.error("The receipt quantity or value is too large.");
      return;
    }

    setReview((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        item: parsed.data,
        productName: product.name,
        unitLabel: unit.label,
        baseUnitLabel: product.base_unit_label,
        conversionFactor: unit.base_units_per_unit,
      },
    ]);
    setQuantity("");
    setCost("");
    setBatch("");
    setExpiry("");
    setError(null);
  };

  const refreshCatalogue = async () => {
    setRefreshRequired(true);
    try {
      await router.invalidate();
      setRefreshRequired(false);
    } catch {
      toast.warning(
        "Receipt confirmed, but refresh failed. Refresh before starting another receipt.",
      );
    }
  };

  const confirmReceipt = async () => {
    if (recovery.busy || !ready) return;
    if (!recovery.pending && (refreshRequired || review.length === 0)) return;
    setBusy(true);
    setError(null);
    try {
      const request = recovery.pending
        ? undefined
        : {
            supplier_name: supplier,
            invoice_reference: invoice,
            items: review.map((entry) => entry.item),
          };
      if (request && !stockReceiptSchema.omit({ operation_id: true }).safeParse(request).success) {
        toast.error("Enter a supplier name and check the delivery details.");
        return;
      }
      const id = await recovery.submit(request, (data) => saveReceipt({ data }));
      setSavedId(id);
      toast.success("Stock receipt confirmed.");
      await refreshCatalogue();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Receipt outcome is uncertain. Retry the saved submission.",
      );
    } finally {
      setPending(recovery.pending);
      setReady(recovery.ready);
      setBusy(false);
    }
  };

  const startAnother = () => {
    if (busy || recovery.busy || refreshRequired) return;
    try {
      recovery.startAnother();
      setReview([]);
      setSupplier("");
      setInvoice("");
      setQuantity("");
      setCost("");
      setBatch("");
      setExpiry("");
      setSavedId(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cannot clear receipt recovery.");
    } finally {
      setPending(recovery.pending);
      setReady(recovery.ready);
    }
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Receive Stock"
        description="Enter a delivery, review quantities and purchase costs, then save the receipt."
      />

      {savedId && (
        <div
          role="status"
          className="rounded-xl border border-success/30 bg-success/5 p-3.5 text-sm"
        >
          <p className="flex items-center gap-2 font-semibold">
            <PackageCheck className="h-4 w-4" aria-hidden />
            Stock receipt saved to your pharmacy.
          </p>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            Receipt reference: {savedId}
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border p-3.5 text-sm text-destructive">
          <p>{error}</p>
          <p>
            Do not re-enter an uncertain delivery as a new receipt. Its saved request is retained.
          </p>
        </div>
      )}
      {!ready && (
        <Button type="button" disabled={busy} onClick={recheckRecovery}>
          Recheck saved receipt storage
        </Button>
      )}
      {pending && (
        <section
          aria-label="Saved receipt recovery"
          className="flex flex-col gap-3 rounded-xl border p-4"
        >
          <p>
            {savedId
              ? "This receipt is confirmed. Acknowledge it before starting another delivery."
              : "A saved delivery needs confirmation. Retry this exact submission before creating another receipt."}
          </p>
          <p className="break-all">Submission reference: {pending.request.operation_id}</p>
          <p>
            Supplier: {pending.request.supplier_name} · Invoice:{" "}
            {pending.request.invoice_reference || "None"}
          </p>
          <ul>
            {pending.request.items.map((item, index) => (
              <li key={index} className="break-words text-sm">
                {products.find((entry) => entry.id === item.product_id)?.name ?? item.product_id}
                {" · "}
                {item.quantity} ×{" "}
                {units.find((entry) => entry.id === item.packaging_unit_id)?.label ??
                  item.packaging_unit_id}
                {" · "}Batch {item.batch_number} · Expires {item.expiry_date}
                {" · "}Purchase total: {receiptMoney(item.quantity * item.cost_per_packaging_unit)}
              </li>
            ))}
          </ul>
          {savedId ? (
            <Button
              type="button"
              disabled={busy || !ready || refreshRequired}
              onClick={startAnother}
            >
              Start another receipt
            </Button>
          ) : (
            <Button type="button" disabled={busy || !ready} onClick={() => void confirmReceipt()}>
              {busy ? "Confirming saved receipt…" : "Retry saved submission"}
            </Button>
          )}
        </section>
      )}
      {refreshRequired && (
        <Button type="button" disabled={busy} onClick={() => void refreshCatalogue()}>
          Refresh receiving catalogue
        </Button>
      )}

      {products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <p>Add a product and its packaging units before receiving stock.</p>
            <Button asChild className="self-start">
              <Link to="/products">Manage products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Delivery details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rs-supplier">Supplier name</Label>
                <Input
                  id="rs-supplier"
                  value={supplier}
                  maxLength={200}
                  disabled={locked}
                  onChange={(event) => setSupplier(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rs-invoice">Invoice reference (optional)</Label>
                <Input
                  id="rs-invoice"
                  value={invoice}
                  maxLength={100}
                  disabled={locked}
                  onChange={(event) => setInvoice(event.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add delivery item</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={addEntry} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rs-product">Product</Label>
                  <Select
                    value={productId}
                    disabled={locked}
                    onValueChange={(id) => {
                      setProductId(id);
                      setUnitId("");
                    }}
                  >
                    <SelectTrigger id="rs-product">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rs-unit">Unit received</Label>
                  <Select
                    value={unit?.id ?? ""}
                    onValueChange={setUnitId}
                    disabled={locked || productUnits.length === 0}
                  >
                    <SelectTrigger id="rs-unit">
                      <SelectValue placeholder="Choose a unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {productUnits.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.label} (= {entry.base_units_per_unit} {product?.base_unit_label})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {productUnits.length === 0 && (
                    <Link to="/packaging" className="text-sm text-primary underline">
                      Add packaging units for this product
                    </Link>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rs-quantity">Quantity received</Label>
                  <Input
                    id="rs-quantity"
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    required
                    disabled={locked}
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rs-cost">Purchase cost per {unit?.label ?? "unit"} (₦)</Label>
                  <Input
                    id="rs-cost"
                    type="number"
                    min="0"
                    step="0.000001"
                    required
                    disabled={locked}
                    value={cost}
                    onChange={(event) => setCost(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rs-batch">Batch number</Label>
                  <Input
                    id="rs-batch"
                    required
                    maxLength={100}
                    disabled={locked}
                    value={batch}
                    onChange={(event) => setBatch(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rs-expiry">Expiry date</Label>
                  <Input
                    id="rs-expiry"
                    type="date"
                    required
                    disabled={locked}
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  className="self-end"
                  disabled={locked || !unit || review.length >= 100}
                >
                  Add to delivery
                </Button>
              </form>
            </CardContent>
          </Card>

          <section className="flex flex-col gap-3" aria-labelledby="receipt-review">
            <h2 id="receipt-review" className="text-lg font-semibold">
              Review before confirming
            </h2>
            {review.length === 0 ? (
              <p className="rounded-xl border p-3.5 text-sm text-muted-foreground">
                Add delivery items above to review their quantities and purchase costs.
              </p>
            ) : (
              <>
                {review.map((entry) => (
                  <Card key={entry.key}>
                    <CardContent className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{entry.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          Batch {entry.item.batch_number} · Expires {entry.item.expiry_date}
                        </p>
                        <p className="text-sm">
                          {entry.item.quantity} × {entry.unitLabel} ={" "}
                          {Number((entry.item.quantity * entry.conversionFactor).toFixed(6))}{" "}
                          {entry.baseUnitLabel}
                        </p>
                        <p className="text-sm tabular-nums">
                          Purchase total:{" "}
                          {receiptMoney(entry.item.quantity * entry.item.cost_per_packaging_unit)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={locked}
                        aria-label={`Remove ${entry.productName} batch ${entry.item.batch_number}`}
                        onClick={() =>
                          setReview((current) => current.filter((item) => item.key !== entry.key))
                        }
                      >
                        Remove
                      </Button>
                    </CardContent>
                  </Card>
                ))}
                <p className="text-xs text-muted-foreground">
                  Quantities use the packaging conversions shown above. Purchase totals are
                  previews; the saved receipt uses the current catalogue conversion and database
                  rounding.
                </p>
                <Button
                  type="button"
                  className="self-start"
                  disabled={locked}
                  onClick={() => void confirmReceipt()}
                >
                  {busy
                    ? "Saving receipt…"
                    : `Confirm receipt (${review.length} ${review.length === 1 ? "item" : "items"})`}
                </Button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
