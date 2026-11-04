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
async function fixture(page, { saved = null, closed = true, send = null } = {}) {
  let cells = [],
    cursor = 0,
    effects = [],
    deps = [],
    route,
    tree,
    requests = [];
  const storage = new Map(),
    key = `pharmanudge:pending-${page === "pos" ? "sale" : "expense"}:${actor.pharmacyId}:${actor.userId}`;
  if (saved) storage.set(key, JSON.stringify(saved));
  const gate = {
    status: { kind: closed ? "closed" : "open", business_date: "2026-11-04" },
    blocked: closed,
    checks: 0,
    canSubmit: async () => {
      gate.checks++;
      return !gate.blocked;
    },
    refresh: async () => {},
    markClosed: () => {
      gate.blocked = true;
      gate.status = { kind: "closed", business_date: "2026-11-04" };
    },
  };
  const hooks = {
    ...React,
    useState(v) {
      let i = cursor++;
      if (!(i in cells)) cells[i] = typeof v === "function" ? v() : v;
      return [
        cells[i],
        (v) => {
          cells[i] = typeof v === "function" ? v(cells[i]) : v;
        },
      ];
    },
    useRef(v) {
      let i = cursor++;
      return (cells[i] ??= { current: v });
    },
    useMemo(fn) {
      cursor++;
      return fn();
    },
    useEffect(fn, next) {
      let i = cursor++;
      if (!deps[i] || next.some((v, j) => v !== deps[i][j])) {
        deps[i] = next;
        effects.push(fn);
      }
    },
  };
  const data =
    page === "pos"
      ? {
          businessDate: "2026-11-04",
          products: [],
          services: [{ id: id(3), name: "Synthetic", price: 20 }],
        }
      : { ...actor, date: "2026-11-04", expenses: [] };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    let source = readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
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
              useLoaderData: () => data,
              useRouteContext: () => ({ pharmacyContext: actor }),
            }),
          useRouter: () => ({ invalidate: async () => {} }),
          redirect: (x) => x,
        };
      if (spec === "@/lib/use-business-day") return { useBusinessDay: () => gate };
      if (spec === "@/lib/data/validation")
        return {
          confirmPharmacySaleMutation: async ({ data }) => {
            requests.push(JSON.parse(JSON.stringify(data)));
            if (send) return send(data);
            return { status: "confirmed", saleId: id(4) };
          },
          recordPharmacyExpenseMutation: async ({ data }) => {
            requests.push(JSON.parse(JSON.stringify(data)));
            if (send) return send(data);
            return { status: "confirmed", expenseId: id(4) };
          },
        };
      if (spec === "sonner") return { toast: { success() {}, error() {} } };
      if (spec === "lucide-react") return new Proxy({}, { get: () => "Icon" });
      if (spec === "@/components/feedback/BusinessDayNotice")
        return load("components/feedback/BusinessDayNotice.tsx");
      if (spec.startsWith("@/components/")) return new Proxy({}, { get: (_, name) => name });
      if (spec.startsWith("@/lib/")) return load(spec.slice(2) + ".ts");
      if (spec === "clsx") return { clsx: () => "" };
      if (spec === "tailwind-merge") return { twMerge: () => "" };
      return require(spec);
    };
    runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        module,
        exports: module.exports,
        require: importer,
        crypto: { randomUUID: () => id(7) },
        sessionStorage: {
          getItem: (k) => storage.get(k) ?? null,
          setItem: (k, v) => storage.set(k, v),
          removeItem: (k) => storage.delete(k),
        },
        console,
      },
    );
    return module.exports;
  }
  load("routes/" + page + ".tsx");
  function render() {
    cursor = 0;
    tree = route.options.component();
    if (page === "expenses") tree = tree.type(tree.props);
    return tree;
  }
  function expanded() {
    return nodes(tree).flatMap((n) =>
      n.type?.name === "BusinessDayNotice" ? nodes(n.type(n.props)) : [n],
    );
  }
  render();
  effects.splice(0).forEach((fn) => fn());
  render();
  return {
    gate,
    setLoadedDate: (date) => {
      data.date = date;
      data.businessDate = date;
      render();
    },
    storage,
    requests,
    key,
    render,
    all: () => expanded(),
    text: () => expanded().map(text).join(" "),
    cart: () => nodes(tree).find((n) => n.type === "CartPanel"),
    addService: () => {
      nodes(tree)
        .find((n) => n.props?.role === "tab" && text(n) === "services")
        .props.onClick();
      render();
      const n = nodes(tree).find((n) => n.type === "ServiceResultRow");
      n.props.onAdd(n.props.service);
      render();
    },
    form: () => nodes(tree).find((n) => n.type === "form"),
    input: (name, value) => {
      nodes(tree)
        .find((n) => n.props?.id === name)
        .props.onChange({ target: { value } });
      render();
    },
    retry: () =>
      expanded().find((n) => n.type === "Button" && text(n).includes("Retry saved submission")),
    flush: async () => {
      for (let i = 0; i < 8; i++) await new Promise(setImmediate);
      render();
    },
  };
}
for (const page of ["pos", "expenses"]) {
  test(`${page} already-closed page shows a notice and disables new submission`, async () => {
    const f = await fixture(page);
    assert.match(f.text(), /Business day closed/);
    if (page === "pos") {
      assert.equal(f.cart().props.checkoutDisabled, true);
      await f.cart().props.onCheckout();
    } else {
      assert.equal(f.all().find((n) => n.type === "fieldset").props.disabled, true);
      f.form().props.onSubmit({ preventDefault() {} });
      await f.flush();
    }
    assert.equal(f.requests.length, 0);
    assert.equal(f.storage.size, 0);
  });
}

const savedSale = {
  operation_id: id(8),
  payment_method: "cash",
  lines: [{ kind: "service", service_id: id(3), quantity: 1, expected_unit_price: 20 }],
};
const savedExpense = {
  operation_id: id(8),
  category: "Utilities",
  description: "Synthetic fuel",
  amount: 20,
  payment_source: "cash",
};
for (const page of ["pos", "expenses"]) {
  async function submit(f) {
    if (page === "pos") await f.cart().props.onCheckout();
    else f.form().props.onSubmit({ preventDefault() {} });
    await f.flush();
  }
  function fill(f) {
    if (page === "pos") f.addService();
    else {
      f.input("ex-desc", "Synthetic fuel");
      f.input("ex-amount", "20");
    }
  }
  test(`${page} preflight blocks a closure after the page was loaded open without persisting a new request`, async () => {
    const f = await fixture(page, { closed: false });
    fill(f);
    f.gate.canSubmit = async () => {
      f.gate.markClosed();
      return false;
    };
    await submit(f);
    assert.equal(f.requests.length, 0);
    assert.equal(f.storage.size, 0);
    assert.match(f.text(), /Business day closed/);
  });
  test(`${page} status update while page is open locks then new verified day unlocks`, async () => {
    const f = await fixture(page, { closed: false });
    fill(f);
    f.gate.markClosed();
    f.render();
    assert.match(f.text(), /Business day closed/);
    assert.equal(
      page === "pos"
        ? f.cart().props.checkoutDisabled
        : f.all().find((n) => n.type === "fieldset").props.disabled,
      true,
    );
    f.gate.status = { kind: "open", business_date: "2026-11-05" };
    f.gate.blocked = false;
    f.render();
    assert.equal(
      page === "pos"
        ? f.cart().props.checkoutDisabled
        : f.all().find((n) => n.type === "fieldset").props.disabled,
      true,
      "yesterday's catalogue/expense list must refresh before new submissions",
    );
    f.setLoadedDate("2026-11-05");
    assert.equal(
      page === "pos"
        ? f.cart().props.checkoutDisabled
        : f.all().find((n) => n.type === "fieldset").props.disabled,
      false,
    );
    await submit(f);
    assert.equal(f.requests.length, 1);
  });
  test(`${page} closed-day saved retry bypasses new-request preflight and uses the exact original request`, async () => {
    const saved = page === "pos" ? savedSale : savedExpense;
    const f = await fixture(page, { saved });
    await f.retry().props.onClick();
    await f.flush();
    assert.equal(f.gate.checks, 0);
    assert.deepEqual(f.requests, [saved]);
    assert.equal(f.storage.size, 0);
  });
  test(`${page} transport failure preserves the exact pending reference through closure and retry`, async () => {
    const saved = page === "pos" ? savedSale : savedExpense;
    let attempts = 0;
    const f = await fixture(page, {
      saved,
      send: async () => {
        if (++attempts === 1) throw new Error("Synthetic lost response");
        return { status: "confirmed", saleId: id(4), expenseId: id(4) };
      },
    });
    await f.retry().props.onClick();
    await f.flush();
    assert.deepEqual(JSON.parse(f.storage.get(f.key)), saved);
    await f.retry().props.onClick();
    await f.flush();
    assert.deepEqual(f.requests, [saved, saved]);
    assert.equal(f.gate.checks, 0);
    assert.equal(f.storage.size, 0);
  });
  test(`${page} database closure race latches closed notice and keeps definite rejection handling`, async () => {
    const message = `This business day is closed. New ${page === "pos" ? "sales" : "expenses"} cannot be recorded.`;
    const f = await fixture(page, {
      closed: false,
      send: async () => ({ status: "rejected", message }),
    });
    fill(f);
    await submit(f);
    assert.equal(f.requests.length, 1);
    assert.equal(f.storage.size, 0);
    assert.match(f.text(), /Business day closed/);
  });
}

for (const page of ["pos", "expenses"]) {
  test(`${page} duplicate submit during delayed read-only preflight produces one original request`, async () => {
    const f = await fixture(page, { closed: false });
    if (page === "pos") f.addService();
    else {
      f.input("ex-desc", "Synthetic fuel");
      f.input("ex-amount", "20");
    }
    let release,
      checks = 0;
    const wait = new Promise((r) => (release = r));
    f.gate.canSubmit = async (expectedDay) => {
      assert.equal(expectedDay, "2026-11-04");
      checks++;
      return wait;
    };
    const submit = () =>
      page === "pos"
        ? f.cart().props.onCheckout()
        : f.form().props.onSubmit({ preventDefault() {} });
    const first = submit(),
      second = submit();
    await f.flush();
    assert.equal(checks, 1);
    assert.equal(f.requests.length, 0);
    assert.equal(f.storage.size, 0);
    release(true);
    await first;
    await second;
    await f.flush();
    assert.equal(f.requests.length, 1);
  });
}
