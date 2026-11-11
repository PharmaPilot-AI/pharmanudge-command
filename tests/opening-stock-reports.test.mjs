import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const require = createRequire(import.meta.url),
  ts = require("typescript");
function load(path, imports = {}) {
  const module = { exports: {} };
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id) => {
        if (!(id in imports)) throw Error(`Unexpected import ${id}`);
        return imports[id];
      },
      Date,
      Map,
      Set,
    },
  );
  return module.exports;
}
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const metadata = (n, extra = {}) => ({
  batch_id: id(n),
  internal_lot_reference: `OPEN-${n}`,
  batch_unknown: true,
  manufacturer_batch: null,
  expiry_precision: "month",
  expiry_label: "2028-02",
  expiry_cutoff_date: "2028-03-01",
  physical_count_date: "2027-11-01",
  ...extra,
});
const batch = (n, extra = {}) => ({
  batch_id: id(n),
  batch_number: "legacy-batch",
  expiry_date: "2028-03-01",
  days_to_expiry: 1,
  supplier_name: "Supplier",
  ...extra,
});
function dal(pages, options = {}) {
  const calls = [];
  const api = load("lib/data/inventory.ts", {
    "../opening-stock": load("lib/opening-stock.ts"),
    "@tanstack/react-start/server-only": {},
    "../auth/context": {
      resolveSessionUser: async () => (options.signedOut ? null : { accessToken: "caller-token" }),
    },
    "../pharmacy-context": {
      requirePharmacyContext: async () => {
        if (options.denied) throw Error("No active pharmacy membership");
        return { pharmacyId: "pharmacy-a", role: options.role ?? "pharmacist" };
      },
    },
    "../supabase/server": {
      createServerSupabaseClient: (token) => {
        assert.equal(token, "caller-token");
        return {
          rpc: async (name, args) => {
            calls.push({ name, args });
            return name === "list_pharmacy_stock_batches"
              ? { data: options.batches ?? [batch(1), batch(2)], error: null }
              : pages.shift();
          },
        };
      },
    },
  });
  return { api, calls };
}
test("month opening display preserves label and never presents internal reference as manufacturer batch", () => {
  const { describeStockLot } = load("lib/opening-stock-display.ts");
  const view = describeStockLot(batch(1, { opening: metadata(1) }));
  assert.equal(view.source, "Opening stock");
  assert.equal(view.manufacturerBatch, "Manufacturer batch unknown");
  assert.equal(view.internalLotReference, "OPEN-1");
  assert.equal(view.expiryLabel, "2028-02");
  assert.equal(view.usableThrough, "2028-02-29");
  assert.equal(view.unavailableFrom, "2028-03-01");
  assert.equal(view.physicalCountDate, "2027-11-01");
  assert.equal(view.countdown, "Unavailable in 1 day");
});

test("calendar arithmetic handles leap, year rollover and rejects timestamps/impossible dates", () => {
  const { previousCalendarDay, describeStockLot } = load("lib/opening-stock-display.ts");
  for (const [cutoff, last] of [
    ["2027-03-01", "2027-02-28"],
    ["2028-03-01", "2028-02-29"],
    ["2029-01-01", "2028-12-31"],
  ])
    assert.equal(previousCalendarDay(cutoff), last);
  for (const value of ["2027-02-29", "2028-03-01T00:00:00Z", "garbage"])
    assert.throws(() => previousCalendarDay(value));
  const day = describeStockLot(
    batch(1, {
      days_to_expiry: 0,
      opening: metadata(1, {
        expiry_precision: "day",
        expiry_label: "2028-03-01",
        batch_unknown: false,
        manufacturer_batch: "REAL-123",
      }),
    }),
  );
  assert.equal(day.usableThrough, null);
  assert.equal(day.expiryLabel, "2028-03-01");
  assert.equal(day.manufacturerBatch, "Manufacturer batch REAL-123");
  assert.equal(day.countdown, "Unavailable from today");
  const legacy = describeStockLot(batch(1, { days_to_expiry: -2 }));
  assert.equal(legacy.manufacturerBatch, "Batch legacy-batch");
  assert.equal(legacy.unavailableFrom, null);
  assert.equal(legacy.countdown, "Expired 2 days ago");
});
test("DAL fetches capped keyset pages through EMPTY and joins by batch id without changing legacy rows", async () => {
  const f = dal(
    [
      { data: [metadata(1)], error: null },
      { data: [metadata(2)], error: null },
      { data: [], error: null },
    ],
    { batches: [batch(2), batch(3), batch(1)] },
  );
  const rows = await f.api.listPharmacyStockBatches();
  assert.equal(rows[0].opening.batch_id, id(2));
  assert.equal(rows[1].opening, undefined);
  assert.equal(rows[2].opening.batch_id, id(1));
  const calls = f.calls.slice(1);
  assert.equal(calls.length, 3);
  for (const [i, call] of calls.entries()) {
    assert.equal(call.name, "list_opening_stock_lot_metadata");
    assert.equal(call.args.target_pharmacy_id, "pharmacy-a");
    assert.equal(call.args.after_batch_id, i === 0 ? null : id(i));
    assert.ok(call.args.page_limit <= 250);
  }
});
test("metadata failures never return partially annotated stock; missing RPC is a schema gate", async () => {
  for (const pages of [
    [
      { data: [metadata(1)], error: null },
      { data: null, error: { message: "late error" } },
    ],
    [
      { data: [metadata(1)], error: null },
      { data: [metadata(1)], error: null },
    ],
    [{ data: [metadata(2), metadata(1)], error: null }],
    [{ data: null, error: null }],
    [{ data: [], error: { code: "PGRST202", message: "missing" } }],
  ]) {
    await assert.rejects(
      dal([...pages, { data: [], error: null }]).api.listPharmacyStockBatches(),
      /opening.stock.*unavailable/i,
    );
  }
});
test("metadata parser rejects invalid fields, inconsistent labels and explicit foreign scope", async () => {
  for (const extra of [
    { batch_id: "not-uuid" },
    { internal_lot_reference: "" },
    { internal_lot_reference: " OPEN-1" },
    { internal_lot_reference: "x".repeat(51) },
    { batch_unknown: false, manufacturer_batch: " padded " },
    { batch_unknown: false, manufacturer_batch: "x".repeat(101) },
    { batch_unknown: "true" },
    { manufacturer_batch: "invented" },
    { batch_unknown: false },
    { expiry_precision: "year" },
    { expiry_label: "2027-02" },
    { expiry_cutoff_date: "2028-02-30" },
    { expiry_cutoff_date: "2028-03-02" },
    { physical_count_date: "2027-02-29" },
    { pharmacy_id: "other-pharmacy" },
    { expiry_precision: "day", expiry_label: "2028-03-02" },
  ])
    await assert.rejects(
      dal([
        { data: [metadata(1, extra)], error: null },
        { data: [], error: null },
      ]).api.listPharmacyStockBatches(),
      /opening.stock.*unavailable/i,
    );
});
test("authentication and membership read guards precede all RPCs for every role", async () => {
  for (const options of [{ signedOut: true }, { denied: true }]) {
    const f = dal([], options);
    await assert.rejects(f.api.listPharmacyStockBatches());
    assert.equal(f.calls.length, 0);
  }
  for (const role of ["owner", "accountant", "pharmacist", "technician"]) {
    const f = dal([{ data: [], error: null }], { role });
    await f.api.listPharmacyStockBatches();
    assert.equal(f.calls.length, 2);
  }
});

function renderRoute(name, data, role = "owner") {
  let route;
  const React = require("react");
  const imports = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-router": {
      createFileRoute: () => (options) =>
        (route = {
          ...options,
          useLoaderData: () => data,
          useRouteContext: () => ({ pharmacyContext: { role } }),
        }),
      Link: ({ children }) => React.createElement("a", null, children),
      redirect: () => {},
    },
    "lucide-react": new Proxy({}, { get: () => () => null }),
    "@/lib/data/validation": {},
    "@/lib/inventory-format": load("lib/inventory-format.ts"),
    "@/lib/opening-stock-display": load("lib/opening-stock-display.ts"),
    "@/lib/utils": { cn: (...args) => args.join(" ") },
  };
  for (const [path, names] of Object.entries({
    "layout/PageHeader": ["PageHeader"],
    "ui/badge": ["Badge"],
    "ui/input": ["Input"],
    "ui/button": ["Button"],
    "kpi/KpiCard": ["KpiCard"],
    "ui/table": ["Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow"],
  }))
    imports[`@/components/${path}`] = Object.fromEntries(
      names.map((name) => [
        name,
        ({ children, title, description, label, value, sub }) =>
          React.createElement("div", null, title, description, label, value, sub, children),
      ]),
    );
  load(`routes/${name}.tsx`, imports);
  return require("react-dom/server")
    .renderToStaticMarkup(React.createElement(route.component))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}
const uiBatch = () =>
  batch(1, {
    product_name: "Product",
    remaining_quantity: "2",
    base_unit_label: "tablet",
    stock_value: "20.00",
    product_is_active: true,
    as_of_date: "2028-02-29",
    opening: metadata(1),
  });
test("Expiry renders opening provenance, original month, exclusive cutoff and legacy labels; cost stays role guarded", () => {
  const html = renderRoute("expiry", [
    uiBatch(),
    { ...uiBatch(), batch_id: id(3), opening: undefined },
  ]);
  for (const label of [
    "Opening stock",
    "Manufacturer batch unknown",
    "Internal lot reference: OPEN-1",
    "Physical count: 01/11/2027",
    "Expiry label (month): 2028-02",
    "Usable through 29/02/2028",
    "Unavailable from 01/03/2028",
    "Unavailable in 1 day",
    "Batch legacy-batch",
    "Expires 01/03/2028",
    "Stock value at cost",
  ])
    assert.ok(html.includes(label), label);
  assert.ok(!html.includes("Batch OPEN-1"));
  for (const role of ["pharmacist", "technician"])
    assert.ok(!renderRoute("expiry", [uiBatch()], role).includes("20.00"));
  assert.ok(renderRoute("expiry", [uiBatch()], "accountant").includes("20.00"));
});
test("inventory headings describe generic stock lots and stop-sale cutoffs, not manufacturer batches or purchase values", () => {
  const row = {
    product_id: id(1),
    product_name: "Product",
    generic_name: "Generic",
    category: "",
    shelf_location: "",
    is_active: true,
    on_hand_quantity: "2",
    available_quantity: "2",
    expired_quantity: "0",
    expiring_quantity: "2",
    stock_value: "20.00",
    expiring_value: "20.00",
    batch_count: 1,
    nearest_expiry: "2028-03-01",
    base_unit_label: "tablet",
    as_of_date: "2028-02-29",
  };
  const ops = renderRoute("inventory-ops", [row]);
  assert.ok(ops.includes("Stock lots"));
  assert.ok(ops.includes("Nearest stop-sale date"));
  assert.ok(ops.includes("Stock value at cost"));
  assert.ok(!/nearest expiry|purchase value/i.test(ops));
  assert.ok(!renderRoute("inventory-ops", [row], "pharmacist").includes("20.00"));
  const owner = renderRoute("inventory", [row]);
  assert.ok(owner.includes("Stock value at cost"));
  assert.ok(!/purchase value/i.test(owner));
});

test("metadata pagination has finite bounds and rejects oversized pages", async () => {
  const pages = Array.from({ length: 400 }, (_, i) => ({ data: [metadata(i + 1)], error: null }));
  const f = dal(pages);
  await assert.rejects(f.api.listPharmacyStockBatches(), /opening.stock.*unavailable/i);
  assert.equal(f.calls.length, 401);
  await assert.rejects(
    dal([
      { data: Array.from({ length: 251 }, (_, i) => metadata(i + 1)), error: null },
    ]).api.listPharmacyStockBatches(),
    /opening.stock.*unavailable/i,
  );
});
test("known day-labelled metadata is retained, unrelated consumed lots are allowed and unexpected fields do not leak", async () => {
  const known = metadata(1, {
    batch_unknown: false,
    manufacturer_batch: "REAL",
    expiry_precision: "day",
    expiry_label: "2028-03-01",
    unexpected: "ignored",
  });
  const f = dal([
    { data: [known, metadata(4)], error: null },
    { data: [], error: null },
  ]);
  const rows = await f.api.listPharmacyStockBatches();
  assert.equal(rows[0].opening.manufacturer_batch, "REAL");
  assert.equal(rows[0].opening.expiry_precision, "day");
  assert.equal(rows[0].opening.unexpected, undefined);
  assert.equal(rows[1].opening, undefined);
});
test("metadata cutoff mismatch with stock data fails closed", async () => {
  await assert.rejects(
    dal(
      [
        { data: [metadata(1)], error: null },
        { data: [], error: null },
      ],
      { batches: [batch(1, { expiry_date: "2028-02-29" })] },
    ).api.listPharmacyStockBatches(),
    /opening.stock.*unavailable/i,
  );
});

test("writer-supported MM/YYYY labels survive metadata reads and display unchanged", async () => {
  const f = dal(
    [
      { data: [metadata(1, { expiry_label: "02/2028" })], error: null },
      { data: [], error: null },
    ],
    { batches: [batch(1)] },
  );
  const [row] = await f.api.listPharmacyStockBatches();
  assert.equal(row.opening.expiry_label, "02/2028");
  const { describeStockLot } = load("lib/opening-stock-display.ts");
  assert.equal(describeStockLot(row).usableThrough, "2028-02-29");
  assert.equal(describeStockLot(row).unavailableFrom, "2028-03-01");
});

test("a reporting failure asks for compatibility review, never tells the operator to apply a draft", async () => {
  try {
    await dal([{ data: null, error: { code: "PGRST202" } }]).api.listPharmacyStockBatches();
    assert.fail("must reject");
  } catch (e) {
    assert.match(e.message, /unavailable/i);
    assert.doesNotMatch(e.message, /Apply .*draft/i);
  }
});
