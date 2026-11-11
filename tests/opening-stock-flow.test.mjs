import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
const require = createRequire(import.meta.url),
  ts = require("typescript"),
  React = require("react");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { pharmacyId: id(1), userId: id(2), role: "owner" };
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
function fixture({
  store = new Map(),
  send = async () => id(99),
  date = "2026-11-10T12:00:00Z",
  bottle = false,
} = {}) {
  let cells = [],
    cursor = 0,
    deps = [],
    effects = [],
    tree,
    route,
    counter = 10;
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [date]));
    }
    static now() {
      return new Date(date).getTime();
    }
  }
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  const catalogue = {
    ...actor,
    status: "available",
    data: {
      ...actor,
      products: [
        {
          id: id(3),
          name: bottle ? "Synthetic bottles" : "Synthetic sachets",
          base_unit_label: bottle ? "bottle" : "sachet",
        },
      ],
      units: [
        {
          id: id(4),
          product_id: id(3),
          label: bottle ? "bottle" : "box",
          base_units_per_unit: bottle ? 1 : 12,
        },
      ],
    },
  };
  const hooks = {
    ...React,
    useState(v) {
      let i = cursor++;
      if (!(i in cells)) cells[i] = typeof v === "function" ? v() : v;
      return [cells[i], (v) => (cells[i] = typeof v === "function" ? v(cells[i]) : v)];
    },
    useRef(v) {
      let i = cursor++;
      return (cells[i] ??= { current: v });
    },
    useMemo(fn, next) {
      let i = cursor++;
      if (!deps[i] || next.some((x, j) => x !== deps[i][j])) {
        cells[i] = fn();
        deps[i] = next;
      }
      return cells[i];
    },
    useEffect(fn, next) {
      let i = cursor++;
      if (!deps[i] || next.some((x, j) => x !== deps[i][j])) {
        effects.push(fn);
        deps[i] = next;
      }
    },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    let source = readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
    const mod = { exports: {} };
    cache.set(path, mod.exports);
    function importer(s) {
      if (s === "react") return hooks;
      if (s === "react/jsx-runtime" || s === "zod") return require(s);
      if (s === "@tanstack/react-router")
        return {
          createFileRoute: () => (o) =>
            (route = {
              options: o,
              useLoaderData: () => catalogue,
              useRouteContext: () => ({ pharmacyContext: actor }),
            }),
          Link: "Link",
          redirect: (x) => x,
        };
      if (s === "@tanstack/react-start") return { useServerFn: (x) => x };
      if (s === "@/lib/data/opening-stock")
        return { confirmOpeningStockMutation: ({ data }) => send(data) };
      if (s === "@/lib/data/validation")
        return { stockReceiptCatalogueQuery: async () => catalogue.data };
      if (s.startsWith("@/components/"))
        return new Proxy({}, { get: (_, k) => (k === "Input" ? "input" : k) });
      if (s.startsWith("@/lib/")) return load(s.slice(2) + ".ts");
      if (s.startsWith(".")) {
        const resolved = new URL(s + ".ts", "file:///" + path).pathname.slice(1);
        return load(resolved);
      }
      throw Error("unexpected fixture import " + s);
    }
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
        Date: Clock,
        Intl,
        console,
        crypto: { randomUUID: () => id(counter++) },
        window: { sessionStorage: storage },
      },
    );
    cache.set(path, mod.exports);
    return mod.exports;
  }
  const module = load("routes/opening-stock.tsx");
  function render() {
    cursor = 0;
    tree = module.OpeningStockForm(actor);
    while (effects.length) effects.shift()();
    return tree;
  }
  render();
  render();
  const find = (predicate) => {
    const n = nodes(tree).find(predicate);
    assert.ok(n, "expected node");
    return n;
  };
  const change = (name, value) => {
    find((n) => n.props?.id === name).props.onChange({ target: { value } });
    render();
  };
  const click = async (label) => {
    await find((n) => n.type === "Button" && text(n).includes(label)).props.onClick();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    render();
  };
  const add = () => {
    find((n) => n.type === "form").props.onSubmit({ preventDefault() {} });
    render();
  };
  const acknowledge = () => {
    find(
      (n) => n.type === "input" && n.props.type === "checkbox" && n.props.checked === false,
    ).props.onChange({ target: { checked: true } });
    render();
  };
  return {
    store,
    render,
    change,
    click,
    add,
    acknowledge,
    find,
    get text() {
      return text(tree);
    },
    get tree() {
      return tree;
    },
    fill() {
      change("opening-quantity", "3");
      change("opening-cost", "120");
      change("opening-expiry", "11/2026");
      add();
      acknowledge();
    },
  };
}
test("an unresolved existing delivery outbox prevents a new opening-stock entry", () => {
  const store = new Map([
    [
      `pharmanudge:pending-stock-receipt:v1:${actor.pharmacyId}:${actor.userId}`,
      "saved-original-delivery",
    ],
  ]);
  const f = fixture({ store });
  assert.equal(f.find((n) => n.type === "fieldset").props.disabled, true);
  assert.match(f.text, /delivery.*reconcil|reconcil.*delivery/i);
  assert.equal(store.values().next().value, "saved-original-delivery");
});
test("real form handlers persist exact supported lot/cost/unit request and recover it unchanged after error/reload", async () => {
  const requests = [],
    store = new Map();
  let fail = true;
  const send = async (data) => {
    requests.push(JSON.parse(JSON.stringify(data)));
    if (fail) throw Error("Synthetic uncertain response");
    return id(99);
  };
  let f = fixture({ store, send });
  f.fill();
  assert.match(f.text, /36\s+sachet/);
  assert.match(f.text, /₦\s*10\.000000\s+per\s+sachet/);
  await f.click("Confirm opening stock");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request.items[0].quantity, 3);
  assert.equal(requests[0].request.items[0].cost_per_packaging_unit, 120);
  assert.equal(requests[0].request.items[0].batch_unknown, true);
  assert.equal(requests[0].request.items[0].manufacturer_batch, null);
  assert.equal(requests[0].request.items[0].expiry_label, "11/2026");
  assert.equal(requests[0].request.physical_count_date, "2026-11-10");
  const raw = store.values().next().value;
  fail = false;
  f = fixture({ store, send, date: "2026-12-02T12:00:00Z" });
  assert.match(
    text(f.find((n) => n.type === "Card" && text(n).includes("Entry reference"))),
    /Synthetic sachets/,
  );
  await f.click("Retry the exact");
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(store.values().next().value, raw);
  assert.match(f.text, /Opening stock confirmed/);
  await f.click("Acknowledge confirmed");
  assert.equal(store.size, 0);
});
test("unknown expiry quantity stays explicitly not loaded and cannot dispatch", async () => {
  const requests = [];
  const f = fixture({
    send: async (x) => {
      requests.push(x);
      return id(99);
    },
  });
  f.change("opening-precision", "unknown");
  f.change("opening-quantity", "7");
  f.add();
  assert.match(f.text, /7 box.*NOT loaded/);
  assert.equal(
    f.find((n) => n.type === "Button" && text(n).includes("Confirm opening stock")).props.disabled,
    true,
  );
  assert.equal(requests.length, 0);
  assert.equal(f.store.size, 0);
});
test("blank or zero costs do not add a saleable opening lot", () => {
  const f = fixture();
  f.change("opening-quantity", "3");
  f.change("opening-expiry", "11/2026");
  f.add();
  assert.match(f.text, /documented cost greater than zero/);
  f.change("opening-cost", "0");
  f.add();
  assert.equal(
    f.find((n) => n.type === "Button" && text(n).includes("Confirm opening stock")).props.disabled,
    true,
  );
  assert.equal(f.store.size, 0);
});

test("a delivery saved after opening form mount blocks new opening dispatch without altering either request", async () => {
  const requests = [],
    store = new Map();
  const f = fixture({
    store,
    send: async (x) => {
      requests.push(x);
      return id(99);
    },
  });
  f.fill();
  store.set(
    `pharmanudge:pending-stock-receipt:v1:${actor.pharmacyId}:${actor.userId}`,
    "late-original-delivery",
  );
  await f.click("Confirm opening stock");
  assert.equal(requests.length, 0);
  assert.equal(store.size, 1);
  assert.equal(store.values().next().value, "late-original-delivery");
});

test("illustrative whole-bottle count uses bottle units and supported per-bottle costs without millilitre assumptions", async () => {
  const requests = [];
  const f = fixture({
    bottle: true,
    send: async (x) => {
      requests.push(x);
      return id(99);
    },
  });
  f.change("opening-quantity", "6");
  f.change("opening-cost", "1500");
  f.change("opening-expiry", "11/2026");
  f.add();
  f.acknowledge();
  assert.match(f.text, /6\s+bottle/);
  assert.match(f.text, /₦\s*1500\.000000\s+per\s+bottle/);
  assert.match(f.text, /9000\.00/);
  await f.click("Confirm opening stock");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request.items[0].quantity, 6);
  assert.equal(requests[0].request.items[0].cost_per_packaging_unit, 1500);
  assert.equal(requests[0].request.items[0].manufacturer_batch, null);
});
