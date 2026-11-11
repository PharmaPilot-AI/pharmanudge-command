import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { stockReceiptCatalogueQuery } from "@/lib/data/validation";
import { readReceiptCatalogue, receiptCatalogueForScope } from "@/lib/data/receipt-catalogue";
import { OpeningStockRecovery } from "@/lib/data/pending-opening-stock";
import { confirmOpeningStockMutation } from "@/lib/data/opening-stock";
import {
  openingStockItemSchema,
  type OpeningStockItem,
  type OpeningStockSubmission,
} from "@/lib/data/opening-stock-schema";
import {
  describeOpeningExpiry,
  expiryCutoff,
  isValidPhysicalCountDate,
  lagosToday,
} from "@/lib/opening-stock";

export const Route = createFileRoute("/opening-stock")({
  beforeLoad: ({ context }) => {
    const role = context.pharmacyContext?.role;
    if (role !== "owner" && role !== "pharmacist")
      throw redirect({ to: role === "accountant" ? "/reports" : "/pos" });
  },
  loader: ({ context }) => {
    const m = context.pharmacyContext;
    if (!m || (m.role !== "owner" && m.role !== "pharmacist")) throw redirect({ to: "/pos" });
    return readReceiptCatalogue({ pharmacyId: m.pharmacyId, userId: m.userId }, () =>
      stockReceiptCatalogueQuery(),
    );
  },
  head: () => ({ meta: [{ title: "Opening stock from paper records — PharmaNudge" }] }),
  component: OpeningStockPage,
});

function OpeningStockPage() {
  const { pharmacyContext: m } = Route.useRouteContext();
  if (!m || (m.role !== "owner" && m.role !== "pharmacist"))
    return <p role="alert">Owner or pharmacist access is required.</p>;
  return (
    <OpeningStockForm
      key={`${m.pharmacyId}:${m.userId}`}
      pharmacyId={m.pharmacyId}
      userId={m.userId}
    />
  );
}

type Reviewed = {
  item: OpeningStockItem;
  product: string;
  unit: string;
  factor: number;
  baseUnit: string;
};

/** Separately scoped and remounted per authenticated actor; never adopts delivery outbox data. */
export function OpeningStockForm({ pharmacyId, userId }: { pharmacyId: string; userId: string }) {
  const loader = Route.useLoaderData();
  const scope = useMemo(() => ({ pharmacyId, userId }), [pharmacyId, userId]);
  const catalogue = receiptCatalogueForScope(loader, scope);
  const recovery = useMemo(
    () => new OpeningStockRecovery(scope, () => window.sessionStorage),
    [scope],
  );
  const send = useServerFn(confirmOpeningStockMutation);
  const active = useRef(true);
  const guard = useRef(false);
  const [pending, setPending] = useState<OpeningStockSubmission | null>(null);
  const [ready, setReady] = useState(false);
  const [deliveryPending, setDeliveryPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [countDate, setCountDate] = useState(lagosToday);
  const [acknowledged, setAcknowledged] = useState(false);
  const [productId, setProductId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [unknown, setUnknown] = useState(true);
  const [manufacturerBatch, setManufacturerBatch] = useState("");
  const [precision, setPrecision] = useState<"month" | "day" | "unknown">("month");
  const [expiry, setExpiry] = useState("");
  const [items, setItems] = useState<Reviewed[]>([]);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  useEffect(() => {
    active.current = true;
    try {
      setDeliveryPending(
        window.sessionStorage.getItem(
          `pharmanudge:pending-stock-receipt:v1:${pharmacyId}:${userId}`,
        ) !== null,
      );
      setPending(recovery.recover());
      setReady(recovery.ready);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saved opening stock recovery is blocked.");
    }
    return () => {
      active.current = false;
    };
  }, [recovery, pharmacyId, userId]);

  const products = catalogue.status === "available" ? catalogue.data.products : [];
  const units = catalogue.status === "available" ? catalogue.data.units : [];
  const product = products.find((p) => p.id === productId) ?? products[0];
  const productUnits = units.filter((u) => u.product_id === product?.id);
  const unit = productUnits.find((u) => u.id === unitId) ?? productUnits[0];
  const locked =
    !ready || busy || pending !== null || deliveryPending || catalogue.status !== "available";
  const recheck = () => {
    try {
      setDeliveryPending(
        window.sessionStorage.getItem(
          `pharmanudge:pending-stock-receipt:v1:${pharmacyId}:${userId}`,
        ) !== null,
      );
      setPending(recovery.recover());
      setReady(recovery.ready);
      setError("");
    } catch (e) {
      setReady(false);
      setError(e instanceof Error ? e.message : "Recovery unavailable.");
    }
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (locked || !product || !unit) return;
    if (!/^\d+(?:\.\d{1,6})?$/.test(quantity) || !(Number(quantity) > 0)) {
      setError("Enter the counted quantity using the selected unit, up to six decimal places.");
      return;
    }
    if (precision === "unknown") {
      setUnresolved((old) => [
        ...old,
        `${product.name}: ${quantity} ${unit.label} — expiry unresolved; NOT loaded. Keep this quantity on the signed count sheet.`,
      ]);
      setQuantity("");
      setError("");
      return;
    }
    if (items.length >= 100) {
      setError("Save at most 100 confirmed lots in one opening entry.");
      return;
    }
    if (!/^\d+(?:\.\d{1,6})?$/.test(cost) || !(Number(cost) > 0)) {
      setError(
        "Enter a documented cost greater than zero for the selected unit. No zero-cost substitute is allowed.",
      );
      return;
    }
    const parsed = openingStockItemSchema.safeParse({
      product_id: product.id,
      packaging_unit_id: unit.id,
      quantity: Number(quantity),
      cost_per_packaging_unit: Number(cost),
      batch_unknown: unknown,
      manufacturer_batch: unknown ? null : manufacturerBatch,
      internal_lot_reference: `OPEN-${crypto.randomUUID()}`,
      expiry_precision: precision,
      expiry_label: expiry,
    });
    if (!parsed.success) {
      setError(
        "Check the supported cost, quantity, manufacturer information and expiry label. Month format: MM/YYYY or YYYY-MM.",
      );
      return;
    }
    if (expiryCutoff(precision, parsed.data.expiry_label) <= lagosToday()) {
      setError(
        "This expiry is already at its stop-sale cutoff. Do not load it into saleable opening stock.",
      );
      return;
    }
    if (!(unit.base_units_per_unit > 0) || Number(quantity) * unit.base_units_per_unit >= 1e12) {
      setError("The packaging conversion or total quantity is unsupported.");
      return;
    }
    setItems((old) => [
      ...old,
      {
        item: parsed.data,
        product: product.name,
        unit: unit.label,
        factor: unit.base_units_per_unit,
        baseUnit: product.base_unit_label,
      },
    ]);
    setQuantity("");
    setCost("");
    setExpiry("");
    setManufacturerBatch("");
    setError("");
  };
  const submit = async (retry: boolean) => {
    if (!ready || guard.current || (!retry && (locked || !items.length || !acknowledged))) return;
    if (!retry && !isValidPhysicalCountDate(countDate)) {
      setError("Physical count date must be a real date on or before today in Lagos.");
      return;
    }
    if (!retry) {
      try {
        if (
          window.sessionStorage.getItem(
            `pharmanudge:pending-stock-receipt:v1:${pharmacyId}:${userId}`,
          ) !== null
        ) {
          setDeliveryPending(true);
          setError("Reconcile the saved delivery before starting a new opening entry.");
          return;
        }
      } catch {
        setReady(false);
        setError("Recovery storage cannot be checked. Nothing new was dispatched.");
        return;
      }
    }
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      // Saved request reconciliation never replaces its date/reference/items.
      const id = await recovery.submit(
        retry ? undefined : { physical_count_date: countDate, items: items.map((i) => i.item) },
        (request) => send({ data: request }),
      );
      if (active.current) {
        setPending(recovery.pending);
        setConfirmed(id);
      }
    } catch (e) {
      if (active.current) {
        setPending(recovery.pending);
        setReady(recovery.ready);
        setError(
          e instanceof Error
            ? e.message
            : "Opening stock could not be confirmed. Retry only the saved request.",
        );
      }
    } finally {
      guard.current = false;
      if (active.current) setBusy(false);
    }
  };
  const startAnother = () => {
    try {
      recovery.startAnother();
      setPending(null);
      setConfirmed(null);
      setItems([]);
      setAcknowledged(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot clear confirmed recovery.");
    }
  };

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Opening stock from paper records"
        description="Load counted stock you already own. This creates no payment, expense or supplier debt."
      />
      <p className="text-sm">
        This records stock at entry time, with the physical count date kept separately. Reconcile
        movements since the count before loading. Unknown manufacturer batches are allowed; unknown
        expiry is not saleable.
      </p>
      <p className="text-sm">
        <Link to="/receive-stock" className="underline">
          Receiving a new supplier delivery instead?
        </Link>
      </p>
      <p className="text-xs">
        Requires the separately approved opening-stock database draft. Do not publish or load stock
        before schema qualification.
      </p>
      {error && (
        <p role="alert" className="rounded border p-3 text-destructive">
          {error}
        </p>
      )}
      <Button variant="outline" disabled={busy} onClick={recheck}>
        Recheck saved opening-stock recovery
      </Button>
      {deliveryPending && (
        <p role="alert">
          Reconcile and acknowledge the saved delivery on Receive stock before starting new opening
          stock. Its original request is not changed here. Existing saved opening-stock retries
          remain available.
        </p>
      )}
      {pending && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <strong>
              {confirmed
                ? "Opening stock confirmed"
                : "Saved opening stock — do not enter it again"}
            </strong>
            <p>
              Count date {pending.request.physical_count_date} · Entry reference{" "}
              {pending.request.operation_id}
            </p>
            {pending.request.items.map((i) => (
              <p key={i.internal_lot_reference}>
                Internal lot reference {i.internal_lot_reference} ·{" "}
                {i.batch_unknown
                  ? "Manufacturer batch unknown"
                  : `Manufacturer batch ${i.manufacturer_batch}`}{" "}
                ·{" "}
                {products.find((p) => p.id === i.product_id)?.name ??
                  `Product reference ${i.product_id}`}{" "}
                · {i.quantity}{" "}
                {units.find((u) => u.id === i.packaging_unit_id)?.label ??
                  `unit reference ${i.packaging_unit_id}`}{" "}
                at ₦{i.cost_per_packaging_unit} each ·{" "}
                {describeOpeningExpiry(i.expiry_precision, i.expiry_label)}
              </p>
            ))}
            {confirmed ? (
              <>
                <p>
                  Confirmed receipt ID {confirmed}. Reconcile this with the count sheet before
                  adding anything else.
                </p>
                <Button disabled={busy} onClick={startAnother}>
                  Acknowledge confirmed opening stock
                </Button>
              </>
            ) : (
              <Button disabled={busy || !ready} onClick={() => void submit(true)}>
                Retry the exact saved opening stock
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {catalogue.status !== "available" && (
        <p role="alert">
          Opening-stock catalogue is unavailable. New entry is blocked; saved requests can still be
          reconciled. Reload to refresh the catalogue.
        </p>
      )}
      <fieldset disabled={locked} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="opening-count-date">Physical count date</Label>
          <Input
            id="opening-count-date"
            type="date"
            value={countDate}
            onChange={(e) => setCountDate(e.target.value)}
          />
        </div>
        <form onSubmit={add} className="grid gap-3 rounded border p-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="opening-product">Product</Label>
            <select
              id="opening-product"
              value={product?.id ?? ""}
              onChange={(e) => {
                setProductId(e.target.value);
                setUnitId("");
              }}
              className="w-full rounded border p-2"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="opening-unit">Counted unit</Label>
            <select
              id="opening-unit"
              value={unit?.id ?? ""}
              onChange={(e) => setUnitId(e.target.value)}
              className="w-full rounded border p-2"
            >
              {productUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label} = {u.base_units_per_unit} {product?.base_unit_label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="opening-quantity">Quantity on your count sheet</Label>
            <Input
              id="opening-quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="opening-cost">
              Documented cost per {unit?.label ?? "selected unit"} (₦)
            </Label>
            <Input
              id="opening-cost"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              disabled={precision === "unknown"}
            />
            <p className="text-xs">
              Use the actual supported purchase cost for this same unit, not selling price or a zero
              placeholder.
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={unknown}
              onChange={(e) => setUnknown(e.target.checked)}
            />
            Manufacturer batch unknown
          </label>
          {!unknown && (
            <div>
              <Label htmlFor="opening-manufacturer">Manufacturer batch printed on pack</Label>
              <Input
                id="opening-manufacturer"
                value={manufacturerBatch}
                maxLength={100}
                onChange={(e) => setManufacturerBatch(e.target.value)}
              />
            </div>
          )}
          <div>
            <Label htmlFor="opening-precision">What expiry information can you verify?</Label>
            <select
              id="opening-precision"
              value={precision}
              onChange={(e) => {
                setPrecision(e.target.value as typeof precision);
                setExpiry("");
              }}
              className="w-full rounded border p-2"
            >
              <option value="month">Month and year on label</option>
              <option value="day">Exact date on label</option>
              <option value="unknown">Unresolved or mixed — do not load</option>
            </select>
          </div>
          {precision !== "unknown" && (
            <div>
              <Label htmlFor="opening-expiry">
                Original expiry label ({precision === "month" ? "MM/YYYY or YYYY-MM" : "YYYY-MM-DD"}
                )
              </Label>
              <Input
                id="opening-expiry"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                required
              />
              <p className="text-xs">
                Month labels remain usable through that month; stop-sale starts on the next month's
                first day in Lagos. Exact-day rules remain unchanged.
              </p>
            </div>
          )}
          <p className="text-xs">
            Internal lot reference is generated when you add a line. It is NOT a manufacturer batch.
            Keep each counted expiry group physically identifiable.
          </p>
          <Button type="submit" disabled={!product || !unit}>
            {precision === "unknown"
              ? "Mark quantity as not loaded"
              : "Add counted stock for review"}
          </Button>
        </form>
        {items.map(({ item: i, product: p, unit: u, factor, baseUnit }) => (
          <Card key={i.internal_lot_reference}>
            <CardContent className="flex flex-col gap-2 p-4">
              <strong>{p}</strong>
              <p>
                {i.quantity} × {u} = {i.quantity * factor} {baseUnit}. Cost ₦
                {i.cost_per_packaging_unit} per {u}; ₦
                {(i.cost_per_packaging_unit / factor).toFixed(6)} per {baseUnit}. Value ₦
                {(i.quantity * i.cost_per_packaging_unit).toFixed(2)}.
              </p>
              <p>
                {i.batch_unknown
                  ? "Manufacturer batch unknown"
                  : `Manufacturer batch ${i.manufacturer_batch}`}
              </p>
              <p>Internal lot reference: {i.internal_lot_reference}</p>
              <p>{describeOpeningExpiry(i.expiry_precision, i.expiry_label)}</p>
              <p className="text-xs">
                Preview uses the displayed packaging definition. Keep packaging conversions
                unchanged during cutover; the database validates current units and rounding.
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  setItems((old) =>
                    old.filter((x) => x.item.internal_lot_reference !== i.internal_lot_reference),
                  )
                }
              >
                Remove this unsaved line
              </Button>
            </CardContent>
          </Card>
        ))}
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          I have reconciled movements since this physical count and am loading only verified,
          supported quantities and costs.
        </label>
        <Button disabled={!items.length || !acknowledged} onClick={() => void submit(false)}>
          Confirm opening stock — no payment
        </Button>
      </fieldset>
      <section className="rounded border p-4">
        <h2 className="font-semibold">Unresolved quantities — not loaded into saleable stock</h2>
        <p>
          Keep the original quantities and reasons on your signed count sheet, separately from
          loaded totals. This list is a temporary checklist, not saved inventory or a quarantine
          register; it is lost on reload.
        </p>
        {unresolved.map((line, n) => (
          <p key={n}>{line}</p>
        ))}
      </section>
    </div>
  );
}
