import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type FormEvent } from "react";
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
import { stockReceiptSchema, type StockReceiptInput } from "@/lib/data/stock-receipt-schema";

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
  const { products, units } = Route.useLoaderData();
  const router = useRouter();
  const saveReceipt = useServerFn(confirmStockReceiptMutation);
  const inFlight = useRef(false);
  const operationId = useRef<string | null>(null);
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

  const product = products.find((entry) => entry.id === productId);
  const productUnits = units.filter((entry) => entry.product_id === productId);
  const unit = productUnits.find((entry) => entry.id === unitId) ?? productUnits[0];

  const addEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
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

  const confirmReceipt = async () => {
    if (inFlight.current || review.length === 0) return;
    operationId.current ??= crypto.randomUUID();

    const parsed = stockReceiptSchema.safeParse({
      operation_id: operationId.current,
      supplier_name: supplier,
      invoice_reference: invoice,
      items: review.map((entry) => entry.item),
    });
    if (!parsed.success) {
      toast.error("Enter a supplier name and check the delivery details.");
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError(null);

    try {
      const id = await saveReceipt({ data: parsed.data });
      setSavedId(id);
      setReview([]);
      setSupplier("");
      setInvoice("");
      operationId.current = null;
      toast.success("Stock receipt saved.");

      try {
        await router.invalidate();
      } catch {
        toast.warning("Receipt saved. The catalogue could not be refreshed.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to confirm stock receipt.");
    } finally {
      inFlight.current = false;
      setBusy(false);
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
                  disabled={busy}
                  onChange={(event) => setSupplier(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rs-invoice">Invoice reference (optional)</Label>
                <Input
                  id="rs-invoice"
                  value={invoice}
                  maxLength={100}
                  disabled={busy}
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
                    disabled={busy}
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
                    disabled={busy || productUnits.length === 0}
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
                    disabled={busy}
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
                    disabled={busy}
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
                    disabled={busy}
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
                    disabled={busy}
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  className="self-end"
                  disabled={busy || !unit || review.length >= 100}
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
                        disabled={busy}
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
                {error && (
                  <div role="alert" className="rounded-xl border p-3.5 text-sm text-destructive">
                    <p>{error}</p>
                    <p className="mt-1">
                      If the connection failed, retry with the same delivery details before
                      refreshing this page.
                    </p>
                  </div>
                )}
                <Button
                  type="button"
                  className="self-start"
                  disabled={busy}
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
