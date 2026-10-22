import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const React = require("react");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { pharmacyId: id(1), userId: id(2), role: "owner" };
const clone = (x) => JSON.parse(JSON.stringify(x));
function store() {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
function nodes(element) {
  if (!element || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  return [element, ...nodes(element.props?.children)];
}
function text(element) {
  if (element == null || typeof element === "boolean") return "";
  if (typeof element !== "object") return String(element);
  if (Array.isArray(element)) return element.map(text).join(" ");
  return text(element.props?.children);
}

// Controlled hook scheduling exercises real route callbacks and production recovery code.
// This is an offline component fixture, NOT a ReactDOM/browser hydration test.
function fixture(storage, send, options = {}) {
  let actor = { ...scope },
    route,
    cells = [],
    cursor = 0,
    effects = [],
    deps = [],
    key;
  const catalogue = options.catalogue ?? {
    products: [{ id: id(3), name: "Synthetic product", base_unit_label: "tablet" }],
    units: [{ id: id(4), product_id: id(3), label: "Box", base_units_per_unit: 10 }],
  };
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++,
        frame = cells;
      if (!(i in frame)) frame[i] = typeof initial === "function" ? initial() : initial;
      return [
        frame[i],
        (value) => {
          frame[i] = typeof value === "function" ? value(frame[i]) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      return (cells[i] ??= { current: initial });
    },
    useEffect(effect, next) {
      const i = cursor++;
      if (!deps[i] || next.some((v, j) => v !== deps[i][j])) {
        deps[i] = next;
        effects.push(effect);
      }
    },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const module = { exports: {} };
    cache.set(path, module.exports);
    const importer = (spec) => {
      if (spec === "react") return hooks;
      if (spec === "react/jsx-runtime") return require(spec);
      if (spec === "zod") return require(spec);
      if (spec === "@tanstack/react-router")
        return {
          createFileRoute: () => (options) =>
            (route = {
              options,
              useLoaderData: () => catalogue,
              useRouteContext: () => ({ pharmacyContext: actor }),
            }),
          useRouter: () => ({
            invalidate: async () => {
              if (options.refreshFails?.()) throw new Error("Synthetic refresh failure");
            },
          }),
          Link: "Link",
          redirect: (x) => x,
        };
      if (spec === "@tanstack/react-start") return { useServerFn: (fn) => fn };
      if (spec === "lucide-react") return { PackageCheck: "Icon" };
      if (spec === "sonner") return { toast: { success() {}, error() {}, warning() {} } };
      if (spec.startsWith("@/components/")) return new Proxy({}, { get: (_, name) => name });
      if (spec === "@/lib/data/validation")
        return {
          confirmStockReceiptMutation: ({ data }) => send(data),
          stockReceiptCatalogueQuery: async () => catalogue,
        };
      if (spec.startsWith("@/lib/data/")) return load(`lib/data/${spec.split("/").at(-1)}.ts`);
      if (spec === "./stock-receipt-schema") return load("lib/data/stock-receipt-schema.ts");
      assert.fail(`Unexpected UI fixture dependency: ${spec}`);
    };
    runInNewContext(output, {
      module,
      exports: module.exports,
      require: importer,
      sessionStorage: storage,
      crypto: {
        randomUUID: (() => {
          let n = 20;
          return () => id(n++);
        })(),
      },
      Error,
    });
    return module.exports;
  }
  load("routes/receive-stock.tsx");
  function render() {
    cursor = 0;
    let tree = route.options.component();
    if (typeof tree.type === "function") {
      if (key !== tree.key) {
        key = tree.key;
        cells = [];
        deps = [];
        effects = [];
      }
      cursor = 0;
      tree = tree.type(tree.props);
    }
    return tree;
  }
  function mount() {
    render();
    const pendingEffects = effects;
    effects = [];
    pendingEffects.forEach((effect) => effect());
    return render();
  }
  return {
    render,
    mount,
    changeActor(value) {
      actor = { ...value };
      return mount();
    },
  };
}
function field(tree, id) {
  const result = nodes(tree).find((x) => x.props?.id === id);
  assert.ok(result, `Missing input ${id}`);
  return result;
}
function button(tree, label) {
  const result = nodes(tree).find(
    (x) => typeof x.props?.onClick === "function" && text(x).includes(label),
  );
  assert.ok(result, `Missing button ${label}`);
  return result;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function addDelivery(ui) {
  for (const [name, value] of [
    ["rs-supplier", "Synthetic supplier"],
    ["rs-invoice", "Invoice fixture"],
    ["rs-quantity", "2"],
    ["rs-cost", "5"],
    ["rs-batch", "Batch fixture"],
    ["rs-expiry", "2099-12-31"],
  ])
    field(ui.render(), name).props.onChange({ target: { value } });
  const form = nodes(ui.render()).find((x) => x.type === "form");
  form.props.onSubmit({ preventDefault() {} });
}

test("saved submissions remain retryable when the current catalogue is empty", async () => {
  const storage = store(),
    calls = [];
  let uncertain = true;
  const send = async (request) => {
    calls.push(clone(request));
    if (uncertain) throw new Error("uncertain");
    return id(6);
  };
  const first = fixture(storage, send);
  first.mount();
  await addDelivery(first);
  button(first.render(), "Confirm receipt").props.onClick();
  await flush();
  const reloaded = fixture(storage, send, { catalogue: { products: [], units: [] } });
  uncertain = false;
  button(reloaded.mount(), "Retry saved submission").props.onClick();
  await flush();
  assert.deepEqual(calls[1], calls[0]);
  assert.ok(text(reloaded.render()).includes(id(6)));
});

test("catalogue refresh failure never unlocks a new receipt or discards the confirmed request", async () => {
  const storage = store();
  let fails = true;
  const ui = fixture(storage, async () => id(6), { refreshFails: () => fails });
  ui.mount();
  await addDelivery(ui);
  button(ui.render(), "Confirm receipt").props.onClick();
  await flush();
  assert.equal(button(ui.render(), "Start another receipt").props.disabled, true);
  button(ui.render(), "Start another receipt").props.onClick();
  assert.equal(storage.map.size, 1);
  fails = false;
  button(ui.render(), "Refresh receiving catalogue").props.onClick();
  await flush();
  assert.equal(button(ui.render(), "Start another receipt").props.disabled, false);
  button(ui.render(), "Start another receipt").props.onClick();
  assert.equal(storage.map.size, 0);
});

test("late confirmation after an identity switch cannot modify the new users recovery state", async () => {
  const storage = store(),
    calls = [];
  let release;
  const response = new Promise((resolve) => {
    release = resolve;
  });
  const ui = fixture(storage, async (request) => {
    calls.push(clone(request));
    return response;
  });
  ui.mount();
  await addDelivery(ui);
  button(ui.render(), "Confirm receipt").props.onClick();
  const reference = calls[0].request.operation_id;
  ui.changeActor({ ...scope, userId: id(8) });
  release(id(6));
  await flush();
  const tree = ui.render();
  assert.equal(field(tree, "rs-supplier").props.value, "");
  assert.ok(!text(tree).includes(reference));
  assert.ok(!text(tree).includes(id(6)));
  assert.equal(storage.map.size, 1);
  assert.equal(calls.length, 1);
});

test("receiving fields are locked until recovery and remain locked when storage is unavailable", () => {
  const storage = {
    getItem() {
      throw new Error("PRIVATE_DUMMY");
    },
  };
  const ui = fixture(storage, async () => assert.fail("No dispatch allowed"));
  for (const tree of [ui.render(), ui.mount()]) {
    assert.equal(field(tree, "rs-supplier").props.disabled, true);
    assert.equal(field(tree, "rs-quantity").props.disabled, true);
  }
});

test("real receiving callbacks retain an uncertain request, recover after reload and retry unchanged", async () => {
  const storage = store(),
    calls = [];
  let uncertain = true;
  const send = async (request) => {
    calls.push(clone(request));
    if (uncertain) throw new Error("Synthetic uncertain save");
    return id(6);
  };
  const first = fixture(storage, send);
  first.mount();
  await addDelivery(first);
  button(first.render(), "Confirm receipt").props.onClick();
  await flush();
  const sent = calls[0];
  assert.ok(sent?.request?.operation_id, "Dispatch must contain a scoped durable request");
  assert.equal(field(first.render(), "rs-supplier").props.disabled, true);
  assert.equal(field(first.render(), "rs-quantity").props.disabled, true);
  const reloaded = fixture(storage, send);
  let tree = reloaded.mount();
  assert.ok(text(tree).includes(sent.request.operation_id));
  uncertain = false;
  button(tree, "Retry saved submission").props.onClick();
  await flush();
  assert.deepEqual(calls[1], sent);
  tree = reloaded.render();
  assert.ok(text(tree).includes(id(6)));
  assert.equal(
    storage.map.size,
    1,
    "Confirmation stays recoverable until explicit acknowledgement",
  );
  button(tree, "Start another receipt").props.onClick();
  await flush();
  assert.equal(storage.map.size, 0);
  assert.equal(field(reloaded.render(), "rs-supplier").props.disabled, false);
});

test("identity change remounts the receiving subtree and never displays or retries the previous actors request", async () => {
  const storage = store(),
    calls = [];
  const ui = fixture(storage, async (request) => {
    calls.push(clone(request));
    throw new Error("uncertain");
  });
  ui.mount();
  await addDelivery(ui);
  button(ui.render(), "Confirm receipt").props.onClick();
  await flush();
  const reference = calls[0]?.request?.operation_id;
  assert.ok(reference);
  for (const actor of [
    { ...scope, userId: id(8) },
    { ...scope, pharmacyId: id(9) },
  ]) {
    const tree = ui.changeActor(actor);
    assert.ok(!text(tree).includes(reference));
    assert.equal(field(tree, "rs-supplier").props.value, "");
    assert.equal(calls.length, 1);
    assert.equal(storage.map.size, 1);
  }
});
