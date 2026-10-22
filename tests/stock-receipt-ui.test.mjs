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
function catalogueResponse(actor = scope, name = "Synthetic product") {
  return {
    pharmacyId: actor.pharmacyId,
    userId: actor.userId,
    products: [{ id: id(3), name, base_unit_label: "tablet" }],
    units: [{ id: id(4), product_id: id(3), label: "Box", base_units_per_unit: 10 }],
  };
}
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
async function fixture(storage, send, options = {}) {
  let actor = options.actor === undefined ? { ...scope } : options.actor,
    route,
    cells = [],
    cursor = 0,
    effects = [],
    deps = [],
    key,
    loaderData,
    catalogueCalls = 0,
    cleanups = [];
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
              useLoaderData: () => loaderData,
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
          stockReceiptCatalogueQuery: async () => {
            const requestActor = { ...actor };
            catalogueCalls++;
            if (options.query) return options.query({ call: catalogueCalls, actor: requestActor });
            if (catalogueCalls > 1 && options.refreshFails?.())
              throw new Error("Synthetic catalogue refresh failure");
            return {
              ...catalogue,
              pharmacyId: requestActor.pharmacyId,
              userId: requestActor.userId,
            };
          },
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
  async function runLoader() {
    const context = { pharmacyContext: actor };
    await route.options.beforeLoad?.({ context });
    loaderData = await route.options.loader({ context });
    return loaderData;
  }
  await runLoader();
  function render() {
    cursor = 0;
    let tree = route.options.component();
    if (typeof tree.type === "function") {
      if (key !== tree.key) {
        cleanups.forEach((cleanup) => cleanup());
        cleanups = [];
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
    pendingEffects.forEach((effect) => {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    });
    return render();
  }
  return {
    render,
    mount,
    runLoader,
    loader: (context) => route.options.loader({ context }),
    admission: (context) => route.options.beforeLoad({ context }),
    useLoaderSnapshot(value) {
      loaderData = value;
      return render();
    },
    get catalogueCalls() {
      return catalogueCalls;
    },
    async changeActor(value) {
      actor = { ...value };
      await runLoader();
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

test("failed catalogue without a saved request is unavailable, not empty, and successful explicit refresh restores entry", async () => {
  const storage = store();
  let fail = true,
    dispatches = 0;
  const ui = await fixture(
    storage,
    async () => {
      dispatches++;
      return id(6);
    },
    {
      query: async ({ actor }) => {
        if (fail) throw new Error("PRIVATE_QUERY_DIAGNOSTIC");
        return catalogueResponse(actor);
      },
    },
  );
  let tree = ui.mount();
  assert.ok(text(tree).includes("catalogue is unavailable"));
  assert.ok(!text(tree).includes("Add a product and its packaging units"));
  assert.ok(!nodes(tree).some((x) => x.props?.id === "rs-supplier"));
  assert.equal(dispatches, 0);
  assert.equal(storage.map.size, 0);
  fail = false;
  button(tree, "Refresh receiving catalogue").props.onClick();
  await flush();
  tree = ui.render();
  assert.equal(field(tree, "rs-supplier").props.disabled, false);
  await addDelivery(ui);
  assert.equal(button(ui.render(), "Confirm receipt").props.disabled, false);
  assert.equal(dispatches, 0, "Refresh and editing never dispatch a receipt");
});

test("concurrent catalogue refreshes apply only the latest outcome in both settlement orders", async () => {
  for (const latestSucceeds of [false, true]) {
    const waits = [];
    const ui = await fixture(store(), async () => assert.fail("No dispatch"), {
      query: ({ call, actor }) =>
        call === 1
          ? Promise.reject(new Error("initial unavailable"))
          : new Promise((resolve, reject) => waits.push({ resolve, reject, actor })),
    });
    const refresh = button(ui.mount(), "Refresh receiving catalogue").props.onClick;
    refresh();
    refresh();
    assert.equal(waits.length, 2);
    if (latestSucceeds) waits[1].resolve(catalogueResponse(waits[1].actor));
    else waits[1].reject(new Error("newest unavailable"));
    await flush();
    if (latestSucceeds) waits[0].reject(new Error("older unavailable"));
    else waits[0].resolve(catalogueResponse(waits[0].actor));
    await flush();
    const tree = ui.render();
    assert.equal(
      nodes(tree).some((x) => x.props?.id === "rs-supplier"),
      latestSucceeds,
    );
    assert.equal(text(tree).includes("catalogue is unavailable"), !latestSucceeds);
    assert.equal(button(tree, "Refresh receiving catalogue").props.disabled, false);
  }
});

test("successful catalogue refresh cannot bypass unavailable recovery storage", async () => {
  let fail = true;
  const storage = {
    getItem() {
      throw new Error("PRIVATE_STORAGE_DIAGNOSTIC");
    },
  };
  const ui = await fixture(storage, async () => assert.fail("No dispatch"), {
    query: async ({ actor }) => {
      if (fail) throw new Error("initial unavailable");
      return catalogueResponse(actor);
    },
  });
  ui.mount();
  fail = false;
  button(ui.render(), "Refresh receiving catalogue").props.onClick();
  await flush();
  assert.equal(field(ui.render(), "rs-supplier").props.disabled, true);
  assert.equal(field(ui.render(), "rs-quantity").props.disabled, true);
  assert.ok(!text(ui.render()).includes("PRIVATE_STORAGE_DIAGNOSTIC"));
});

test("late catalogue refresh cannot populate a different authenticated user or pharmacy", async () => {
  for (const actor of [
    { ...scope, userId: id(8) },
    { ...scope, pharmacyId: id(9) },
  ]) {
    let release;
    const ui = await fixture(store(), async () => assert.fail("No dispatch"), {
      query: ({ call, actor }) =>
        call === 2
          ? new Promise((resolve) => {
              release = () => resolve(catalogueResponse(actor, "PRIVATE_OLD_SCOPE_RESULT"));
            })
          : Promise.resolve(catalogueResponse(actor)),
    });
    button(ui.mount(), "Refresh receiving catalogue").props.onClick();
    await ui.changeActor(actor);
    release();
    await flush();
    assert.ok(!text(ui.render()).includes("PRIVATE_OLD_SCOPE_RESULT"));
    assert.equal(field(ui.render(), "rs-supplier").props.disabled, false);
  }
});

test("foreign response metadata is rejected and original route admission still denies other roles", async () => {
  const ui = await fixture(store(), async () => assert.fail("No dispatch"), {
    query: async () => catalogueResponse({ ...scope, userId: id(8) }, "PRIVATE_OTHER_USER"),
  });
  const tree = ui.mount();
  assert.ok(text(tree).includes("catalogue is unavailable"));
  assert.ok(!text(tree).includes("PRIVATE_OTHER_USER"));
  let reads = 0;
  for (const actor of [null, { ...scope, role: "cashier" }, { ...scope, role: "accountant" }]) {
    await assert.rejects(
      fixture(store(), async () => assert.fail("No dispatch"), {
        actor,
        query: async () => {
          reads++;
          return catalogueResponse();
        },
      }),
      (error) => error.to === (actor?.role === "accountant" ? "/reports" : "/pos"),
    );
  }
  assert.equal(reads, 0, "Admission denial happens before a catalogue query");
});

test("real installed memory-router invalidation resolves on caught loader failure without unlocking entry", async () => {
  const {
    createRouter,
    createRootRoute,
    createRoute,
    createMemoryHistory,
  } = require("@tanstack/react-router");
  let fail = false;
  const ui = await fixture(store(), async () => assert.fail("No dispatch"), {
    query: async ({ actor }) => {
      if (fail) throw new Error("PRIVATE_INVALIDATION_DIAGNOSTIC");
      return catalogueResponse(actor);
    },
  });
  const root = createRootRoute(),
    child = createRoute({
      getParentRoute: () => root,
      path: "/receive-stock",
      beforeLoad: ({ context }) => ui.admission(context),
      loader: ({ context }) => ui.loader(context),
    });
  const router = createRouter({
    routeTree: root.addChildren([child]),
    history: createMemoryHistory({ initialEntries: ["/receive-stock"] }),
    context: { pharmacyContext: scope },
    isServer: true,
  });
  await router.load();
  const cached = router.state.matches.at(-1).loaderData;
  assert.equal(cached.status, "available");
  ui.mount();
  fail = true;
  await assert.doesNotReject(router.invalidate({ sync: true }));
  const match = router.state.matches.at(-1);
  assert.equal(match.status, "success");
  assert.equal(match.loaderData.status, "unavailable");
  ui.useLoaderSnapshot(match.loaderData);
  let tree = ui.mount();
  assert.ok(text(tree).includes("catalogue is unavailable"));
  ui.useLoaderSnapshot(cached);
  tree = ui.mount();
  assert.ok(
    text(tree).includes("catalogue is unavailable"),
    "Cached success cannot release a refresh lock",
  );
  button(tree, "Refresh receiving catalogue").props.onClick();
  await flush();
  assert.ok(text(ui.render()).includes("catalogue is unavailable"));
  fail = false;
  button(ui.render(), "Refresh receiving catalogue").props.onClick();
  await flush();
  assert.equal(field(ui.render(), "rs-supplier").props.disabled, false);
});

test("saved receipt survives a rejecting actual catalogue route loader and retries unchanged", async () => {
  const storage = store(),
    calls = [];
  let uncertain = true;
  const send = async (request) => {
    calls.push(clone(request));
    if (uncertain) throw new Error("Synthetic uncertain save");
    return id(6);
  };
  const first = await fixture(storage, send);
  first.mount();
  await addDelivery(first);
  button(first.render(), "Confirm receipt").props.onClick();
  await flush();
  const saved = [...storage.map.values()][0],
    reference = calls[0].request.operation_id;
  let reloaded;
  await assert.doesNotReject(async () => {
    reloaded = await fixture(storage, send, {
      query: async () => {
        throw new Error("PRIVATE_QUERY_DIAGNOSTIC");
      },
    });
  }, "A failed catalogue loader must leave the recovery shell mountable");
  let tree = reloaded.mount();
  assert.ok(text(tree).includes(reference));
  assert.equal(calls.length, 1, "Mount must never dispatch");
  assert.ok(text(tree).includes("catalogue is unavailable"));
  assert.ok(!text(tree).includes("PRIVATE_QUERY_DIAGNOSTIC"));
  assert.ok(!text(tree).includes("Add a product and its packaging units"));
  assert.ok(
    !nodes(tree).some(
      (x) => typeof x.props?.onClick === "function" && text(x).includes("Confirm receipt ("),
    ),
  );
  uncertain = false;
  const retry = button(tree, "Retry saved submission").props.onClick;
  retry();
  retry();
  await flush();
  assert.equal(calls.length, 2, "Double retry remains single-flight");
  tree = reloaded.render();
  assert.equal(JSON.stringify(calls[1]), saved);
  assert.equal([...storage.map.values()][0], saved);
  assert.equal(
    button(tree, "Start another receipt").props.disabled,
    true,
    "A caught refresh error is not a successful refresh",
  );
});

test("saved submissions remain retryable when the current catalogue is empty", async () => {
  const storage = store(),
    calls = [];
  let uncertain = true;
  const send = async (request) => {
    calls.push(clone(request));
    if (uncertain) throw new Error("uncertain");
    return id(6);
  };
  const first = await fixture(storage, send);
  first.mount();
  await addDelivery(first);
  button(first.render(), "Confirm receipt").props.onClick();
  await flush();
  const reloaded = await fixture(storage, send, { catalogue: { products: [], units: [] } });
  uncertain = false;
  button(reloaded.mount(), "Retry saved submission").props.onClick();
  await flush();
  assert.deepEqual(calls[1], calls[0]);
  assert.ok(text(reloaded.render()).includes(id(6)));
});

test("catalogue refresh failure never unlocks a new receipt or discards the confirmed request", async () => {
  const storage = store();
  let fails = true;
  const ui = await fixture(storage, async () => id(6), { refreshFails: () => fails });
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
  assert.equal(
    field(ui.render(), "rs-supplier").props.disabled,
    true,
    "Successful refresh does not acknowledge the confirmed receipt",
  );
  assert.equal(storage.map.size, 1);
  button(ui.render(), "Start another receipt").props.onClick();
  assert.equal(storage.map.size, 0);
  assert.equal(field(ui.render(), "rs-supplier").props.disabled, false);
});

test("late confirmation after an identity switch cannot modify the new users recovery state", async () => {
  const storage = store(),
    calls = [];
  let release;
  const response = new Promise((resolve) => {
    release = resolve;
  });
  const ui = await fixture(storage, async (request) => {
    calls.push(clone(request));
    return response;
  });
  ui.mount();
  await addDelivery(ui);
  button(ui.render(), "Confirm receipt").props.onClick();
  const reference = calls[0].request.operation_id;
  await ui.changeActor({ ...scope, userId: id(8) });
  release(id(6));
  await flush();
  const tree = ui.render();
  assert.equal(field(tree, "rs-supplier").props.value, "");
  assert.ok(!text(tree).includes(reference));
  assert.ok(!text(tree).includes(id(6)));
  assert.equal(storage.map.size, 1);
  assert.equal(calls.length, 1);
});

test("receiving fields are locked until recovery and remain locked when storage is unavailable", async () => {
  const storage = {
    getItem() {
      throw new Error("PRIVATE_DUMMY");
    },
  };
  const ui = await fixture(storage, async () => assert.fail("No dispatch allowed"));
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
  const first = await fixture(storage, send);
  first.mount();
  await addDelivery(first);
  button(first.render(), "Confirm receipt").props.onClick();
  await flush();
  const sent = calls[0];
  assert.ok(sent?.request?.operation_id, "Dispatch must contain a scoped durable request");
  assert.equal(field(first.render(), "rs-supplier").props.disabled, true);
  assert.equal(field(first.render(), "rs-quantity").props.disabled, true);
  const reloaded = await fixture(storage, send);
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
  const ui = await fixture(storage, async (request) => {
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
    const tree = await ui.changeActor(actor);
    assert.ok(!text(tree).includes(reference));
    assert.equal(field(tree, "rs-supplier").props.value, "");
    assert.equal(calls.length, 1);
    assert.equal(storage.map.size, 1);
  }
});
