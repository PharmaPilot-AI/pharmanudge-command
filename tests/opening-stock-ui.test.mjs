import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
const require = createRequire(import.meta.url),
  ts = require("typescript"),
  React = require("react");
const path = new URL("../src/routes/opening-stock.tsx", import.meta.url);
const nodes = (x) =>
  !x || typeof x !== "object"
    ? []
    : Array.isArray(x)
      ? x.flatMap(nodes)
      : [x, ...nodes(x.props?.children)];
const text = (x) =>
  x == null || typeof x === "boolean"
    ? ""
    : typeof x !== "object"
      ? String(x)
      : Array.isArray(x)
        ? x.map(text).join(" ")
        : text(x.props?.children);
function load({ role = "owner", saved = null, catalogueStatus = "available" } = {}) {
  assert.ok(existsSync(path), "separate Opening stock screen has not been implemented");
  const source = readFileSync(path, "utf8");
  let route;
  const actor = {
    pharmacyId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    role,
  };
  const data = { ...actor, status: catalogueStatus, data: { ...actor, products: [], units: [] } };
  const hooks = {
    ...React,
    useState(v) {
      return [typeof v === "function" ? v() : v, () => {}];
    },
    useMemo(fn) {
      return fn();
    },
    useRef(v) {
      return { current: v };
    },
    useEffect() {},
  };
  class Recovery {
    ready = true;
    busy = false;
    pending = saved;
    confirmedId = null;
    recover() {
      return saved;
    }
  }
  const importer = (s) => {
    if (s === "react") return hooks;
    if (s === "react/jsx-runtime") return require(s);
    if (s === "@tanstack/react-router")
      return {
        createFileRoute: () => (o) =>
          (route = {
            options: o,
            useRouteContext: () => ({ pharmacyContext: actor }),
            useLoaderData: () => data,
          }),
        redirect: (x) => x,
        Link: "Link",
      };
    if (s === "@tanstack/react-start") return { useServerFn: (x) => x };
    if (s === "@/lib/data/pending-opening-stock") return { OpeningStockRecovery: Recovery };
    if (s === "@/lib/data/opening-stock") return { confirmOpeningStockMutation: async () => "" };
    if (s === "@/lib/data/opening-stock-schema")
      return new Proxy({}, { get: () => ({ safeParse: () => ({ success: false }) }) });
    if (s === "@/lib/opening-stock")
      return {
        expiryCutoff: () => "",
        lagosToday: () => "2026-11-10",
        describeOpeningExpiry: () => "",
      };
    if (s === "@/lib/data/receipt-catalogue")
      return { readReceiptCatalogue: async () => data, receiptCatalogueForScope: (x) => x };
    if (s === "@/lib/data/validation") return { stockReceiptCatalogueQuery: async () => data.data };
    if (s.startsWith("@/components/"))
      return new Proxy({}, { get: (_, k) => (k === "Input" ? "input" : k) });
    if (s === "sonner") return { toast: { success() {}, error() {} } };
    throw Error("unexpected import " + s);
  };
  const mod = { exports: {} };
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module: mod,
      exports: mod.exports,
      require: importer,
      console,
      Intl,
      Date,
      crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000009" },
    },
  );
  return { ...mod.exports, route, actor, data };
}
test("Opening stock route is separate and admission rejects cashier/accountant", () => {
  const f = load();
  for (const role of ["cashier", "accountant"])
    assert.throws(() =>
      f.route.options.beforeLoad({ context: { pharmacyContext: { ...f.actor, role } } }),
    );
  assert.doesNotThrow(() => f.route.options.beforeLoad({ context: { pharmacyContext: f.actor } }));
});
test("paper-record defaults and unresolved expiry explanation are honest", () => {
  const f = load();
  const tree = f.OpeningStockForm({ pharmacyId: f.actor.pharmacyId, userId: f.actor.userId });
  const t = text(tree);
  assert.match(t, /physical count/i);
  assert.match(t, /Manufacturer batch unknown/i);
  assert.match(t, /Internal lot reference/i);
  assert.match(t, /no payment|does not record.*payment/i);
  assert.match(t, /not loaded|not.*saleable/i);
  const es = nodes(tree);
  assert.ok(es.some((n) => n.type === "input" && n.props.type === "date"));
  assert.ok(es.some((n) => n.type === "select" && n.props.value === "month"));
  assert.ok(
    es.some((n) => n.type === "input" && n.props.type === "checkbox" && n.props.checked === true),
  );
});
test("unavailable catalogue blocks new entry but retains recovery UI", () => {
  const f = load({ catalogueStatus: "unavailable" });
  const t = text(f.OpeningStockForm({ pharmacyId: f.actor.pharmacyId, userId: f.actor.userId }));
  assert.match(t, /catalogue.*unavailable/i);
  assert.match(t, /recover|saved|Recheck/i);
});

test("opening-stock is an allowlisted login return without changing delivery recovery format", () => {
  const s = readFileSync(new URL("../src/lib/auth/redirect.ts", import.meta.url), "utf8");
  assert.match(s, /"\/opening-stock"/);
  const legacy = readFileSync(
    new URL("../src/lib/data/pending-stock-receipt.ts", import.meta.url),
    "utf8",
  );
  assert.match(legacy, /pending-stock-receipt:v1/);
});

test("existing receiving screen links to separate opening mode without replacing delivery handler", () => {
  const s = readFileSync(new URL("../src/routes/receive-stock.tsx", import.meta.url), "utf8");
  assert.match(s, /to="\/opening-stock"/);
  assert.match(s, /confirmStockReceiptMutation/);
  assert.match(s, /ReceiptRecovery/);
});
