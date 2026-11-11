import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const scope = { pharmacyId: id(1), userId: id(2) };
export const draft = () => ({
  physical_count_date: "2024-02-29",
  items: [
    {
      product_id: id(3),
      packaging_unit_id: id(4),
      quantity: 2,
      cost_per_packaging_unit: 5,
      batch_unknown: true,
      manufacturer_batch: null,
      internal_lot_reference: "OPEN-1",
      expiry_precision: "month",
      expiry_label: "02/2028",
    },
  ],
});
export const submission = () => ({
  version: 1,
  ...scope,
  request: { operation_id: id(5), ...draft() },
});
export const plain = (value) => JSON.parse(JSON.stringify(value));
export function load(path, overrides = {}, cache = new Map()) {
  const url = new URL(`../src/lib/${path}.ts`, import.meta.url);
  if (cache.has(url.href)) return cache.get(url.href);
  if (!existsSync(url)) return {};
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  cache.set(url.href, module.exports);
  const importer = (spec) => {
    if (spec in overrides) return overrides[spec];
    if (spec === "zod") return require("zod");
    if (spec.startsWith(".")) {
      const relative = new URL(`${spec}.ts`, url).pathname.split("/src/lib/")[1].slice(0, -3);
      return load(relative, overrides, cache);
    }
    assert.fail(`Unexpected dependency ${spec}`);
  };
  runInNewContext(outputText, { module, exports: module.exports, require: importer, Date, Intl });
  return module.exports;
}

test("strict opening contract preserves printed month labels and enforces explicit positive six-place costs", () => {
  const { openingStockSchema, openingStockSubmissionSchema } = load("data/opening-stock-schema");
  assert.equal(typeof openingStockSchema?.parse, "function", "strict opening schema must exist");
  for (const expiry_label of [" 02/2028 ", " 2028-02 "]) {
    const input = submission();
    input.request.items[0].expiry_label = expiry_label;
    assert.equal(
      openingStockSubmissionSchema.parse(input).request.items[0].expiry_label,
      expiry_label.trim(),
    );
  }
  const invalid = [];
  for (const cost of [undefined, null, 0, -1, NaN, Infinity, 1e12, 0.0000001, 1.0000001, "5"]) {
    const s = submission();
    s.request.items[0].cost_per_packaging_unit = cost;
    invalid.push(s);
  }
  for (const quantity of [0, -1, Infinity, 1e12, 0.0000001, 2.0000001]) {
    const s = submission();
    s.request.items[0].quantity = quantity;
    invalid.push(s);
  }
  for (const [field, value] of [
    ["expiry_precision", "unknown"],
    ["expiry_label", ""],
    ["expiry_label", "2023-02-29"],
    ["expiry_label", "13/2028"],
    ["extra", true],
    ["batch_number", "FAKE"],
    ["manufacturer_batch", "FAKE"],
    ["internal_lot_reference", ""],
  ]) {
    const s = submission();
    s.request.items[0][field] = value;
    invalid.push(s);
  }
  for (const physical_count_date of ["2999-01-01", "2023-02-29", "2024-2-01", ""]) {
    const s = submission();
    s.request.physical_count_date = physical_count_date;
    invalid.push(s);
  }
  for (const s of [
    { ...submission(), extra: true },
    { ...submission(), version: 2 },
    { ...submission(), request: { ...submission().request, payments: [] } },
    { ...submission(), request: { ...submission().request, items: [] } },
  ])
    invalid.push(s);
  const overflow = submission();
  overflow.request.items[0].quantity = 1e10;
  overflow.request.items[0].cost_per_packaging_unit = 1e10;
  invalid.push(overflow);
  for (const input of invalid)
    assert.equal(
      openingStockSubmissionSchema.safeParse(input).success,
      false,
      JSON.stringify(input),
    );
  const known = submission();
  Object.assign(known.request.items[0], {
    batch_unknown: false,
    manufacturer_batch: " B-REAL ",
    expiry_precision: "day",
    expiry_label: "2028-02-29",
    quantity: 0.000001,
    cost_per_packaging_unit: 1.000001,
  });
  assert.equal(
    openingStockSubmissionSchema.parse(known).request.items[0].manufacturer_batch,
    "B-REAL",
  );
  known.request.items[0].manufacturer_batch = null;
  assert.equal(openingStockSubmissionSchema.safeParse(known).success, false);
});

test("internal references fit the database mapping and are unique within an opening", () => {
  const { openingStockSubmissionSchema } = load("data/opening-stock-schema");
  const long = submission();
  long.request.items[0].internal_lot_reference = "x".repeat(51);
  assert.equal(openingStockSubmissionSchema.safeParse(long).success, false);
  const duplicate = submission();
  duplicate.request.items.push({ ...duplicate.request.items[0] });
  assert.equal(openingStockSubmissionSchema.safeParse(duplicate).success, false);
  duplicate.request.items[1].internal_lot_reference = "OPEN-2";
  assert.equal(openingStockSubmissionSchema.safeParse(duplicate).success, true);
});

test("month expiry remains available through its labelled month; exact days remain exclusive", () => {
  const helper = load("opening-stock");
  assert.equal(typeof helper.expiryCutoff, "function", "opening expiry helper must exist");
  for (const [precision, label, cutoff] of [
    ["month", "02/2024", "2024-03-01"],
    ["month", "2023-02", "2023-03-01"],
    ["month", "12/2028", "2029-01-01"],
    ["day", "2024-02-29", "2024-02-29"],
  ]) {
    assert.equal(helper.expiryCutoff(precision, label), cutoff);
  }
  for (const [precision, label] of [
    ["unknown", "02/2024"],
    ["month", "13/2024"],
    ["month", "00/2024"],
    ["month", "2024-2"],
    ["month", "0000-01"],
    ["month", "9999-12"],
    ["day", "2023-02-29"],
    ["day", "2024-04-31"],
    ["day", "2024-2-01"],
  ])
    assert.throws(() => helper.expiryCutoff(precision, label));
  assert.match(helper.describeOpeningExpiry("month", "02/2024"), /02\/2024/);
  assert.match(helper.describeOpeningExpiry("month", "02/2024"), /through|end/i);
  assert.match(helper.describeOpeningExpiry("day", "2024-02-29"), /unavailable|exclusive/i);
  assert.equal(helper.lagosToday(new Date("2024-02-29T23:30:00Z")), "2024-03-01");
  assert.equal(helper.isValidPhysicalCountDate("2024-02-29", "2024-03-01"), true);
  for (const date of ["2024-02-30", "2024-03-02", "0000-01-01", "2024-2-01"])
    assert.equal(helper.isValidPhysicalCountDate(date, "2024-03-01"), false);
});

function server(
  actor = { ...scope, role: "owner" },
  session = { accessToken: "synthetic" },
  result = { data: id(8), error: null },
) {
  const calls = [];
  const mod = load("data/opening-stock", {
    "@tanstack/react-start/server-only": {},
    "@tanstack/react-start": {
      createServerFn: (options) => ({
        validator: (parse) => ({
          handler:
            (handler) =>
            async ({ data }) => {
              assert.equal(options.method, "POST");
              return handler({ data: parse(data) });
            },
        }),
      }),
    },
    "../auth/context": { resolveSessionUser: async () => session },
    "../pharmacy-context": { requirePharmacyContext: async () => actor },
    "../supabase/server": {
      createServerSupabaseClient: (token) => {
        assert.equal(token, "synthetic");
        return {
          rpc: async (name, args) => {
            calls.push({ name, args });
            return result;
          },
        };
      },
    },
  });
  return { ...mod, calls };
}

test("opening DAL sends only strict opening payload with authenticated server pins and POST validator", async () => {
  for (const role of ["owner", "pharmacist"]) {
    const api = server({ ...scope, role });
    assert.equal(typeof api.confirmOpeningStock, "function", "opening DAL must exist");
    assert.equal(await api.confirmOpeningStock(submission()), id(8));
    assert.deepEqual(plain(api.calls), [
      {
        name: "confirm_opening_stock",
        args: {
          target_pharmacy_id: scope.pharmacyId,
          operation_id: id(5),
          physical_count_date: "2024-02-29",
          opening_items: submission().request.items,
        },
      },
    ]);
    assert.equal(await api.confirmOpeningStockMutation({ data: submission() }), id(8));
    const invalid = submission();
    invalid.request.items[0].cost_per_packaging_unit = 0;
    await assert.rejects(api.confirmOpeningStockMutation({ data: invalid }));
    await assert.rejects(api.confirmOpeningStock({ ...submission(), payment: 10 }));
    const future = submission();
    future.request.physical_count_date = "2999-01-01";
    await assert.rejects(api.confirmOpeningStock(future));
    assert.equal(api.calls.length, 2);
  }
});

test("opening DAL denies missing session, other scopes, unauthorized roles, invalid responses and missing RPC", async () => {
  for (const [actor, session] of [
    [{ ...scope, role: "owner" }, null],
    [{ ...scope, role: "cashier" }, { accessToken: "synthetic" }],
    [{ ...scope, role: "accountant" }, { accessToken: "synthetic" }],
    [{ ...scope, pharmacyId: id(90), role: "owner" }, { accessToken: "synthetic" }],
    [{ ...scope, userId: id(90), role: "pharmacist" }, { accessToken: "synthetic" }],
  ]) {
    const api = server(actor, session);
    assert.equal(typeof api.confirmOpeningStock, "function");
    await assert.rejects(api.confirmOpeningStock(submission()));
    assert.equal(api.calls.length, 0);
  }
  for (const result of [
    { data: null, error: null },
    { data: "not-id", error: null },
    { data: { id: id(8) }, error: null },
    { data: null, error: { code: "PGRST202", message: "PRIVATE schema cache" } },
  ]) {
    const api = server(undefined, undefined, result);
    await assert.rejects(
      api.confirmOpeningStock(submission()),
      (e) => !e.message.includes("PRIVATE"),
    );
    assert.equal(api.calls.length, 1);
  }
});
