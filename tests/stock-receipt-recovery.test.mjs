import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { pharmacyId: id(1), userId: id(2) };
const draft = () => ({
  supplier_name: "Synthetic supplier",
  invoice_reference: "Fixture invoice",
  items: [
    {
      product_id: id(3),
      packaging_unit_id: id(4),
      quantity: 2,
      cost_per_packaging_unit: 5,
      batch_number: "Fixture batch",
      expiry_date: "2099-12-31",
    },
  ],
});
const plain = (value) => JSON.parse(JSON.stringify(value));
function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
function load(file, overrides = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const path = new URL(`../src/lib/data/${file}.ts`, import.meta.url);
  if (!existsSync(path)) return {};
  const source = readFileSync(path, "utf8");
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  cache.set(file, module.exports);
  const importer = (spec) => {
    if (spec in overrides) return overrides[spec];
    if (spec === "zod") return require("zod");
    if (spec === "./stock-receipt-schema" || spec === "./catalogue-pages") {
      return load(spec.slice(2), overrides, cache);
    }
    assert.fail(`Unexpected test dependency: ${spec}`);
  };
  runInNewContext(outputText, { module, exports: module.exports, require: importer });
  return module.exports;
}
function controller(store, actor = scope, operation = id(5)) {
  const { ReceiptRecovery } = load("pending-stock-receipt");
  assert.equal(
    typeof ReceiptRecovery,
    "function",
    "Durable receipt recovery must exist before dispatch",
  );
  return new ReceiptRecovery(
    actor,
    () => store,
    () => operation,
  );
}

test("the dispatched snapshot is deeply immutable and still equals the durable bytes", async () => {
  const store = storage(),
    recovery = controller(store);
  recovery.recover();
  await recovery.submit(draft(), async (request) => {
    assert.equal(Object.isFrozen(request), true);
    assert.equal(Object.isFrozen(request.request), true);
    assert.equal(Object.isFrozen(request.request.items), true);
    assert.equal(Object.isFrozen(request.request.items[0]), true);
    assert.throws(() => {
      request.request.items[0].quantity++;
    }, TypeError);
    assert.equal(JSON.stringify(request), store.getItem(recovery.key));
    return id(6);
  });
});

test("corrupt, unsupported and noncanonical records fail closed without deleting evidence", async () => {
  const store = storage(),
    writer = controller(store);
  writer.recover();
  await assert.rejects(
    writer.submit(draft(), async () => {
      throw new Error("uncertain");
    }),
  );
  const record = JSON.parse(store.getItem(writer.key));
  for (const raw of [
    "{",
    "null",
    JSON.stringify({ ...record, version: 2 }),
    JSON.stringify({ ...record, extra: true }),
    JSON.stringify({ ...record, request: { ...record.request, supplier_name: " padded " } }),
    " ".repeat(256_001),
  ]) {
    store.setItem(writer.key, raw);
    const reader = controller(store);
    assert.throws(() => reader.recover(), /recovery/i);
    assert.equal(reader.ready, false);
    assert.equal(reader.pending, null);
    assert.equal(store.getItem(writer.key), raw);
    await assert.rejects(reader.submit(undefined, async () => assert.fail("No dispatch allowed")));
  }
});

test("write-applied-then-error and read-back failure keep the same reference recoverable without dispatch", async () => {
  for (const mode of ["write", "readback"]) {
    const store = storage(),
      recovery = controller(store);
    recovery.recover();
    let written = false,
      calls = 0;
    const write = store.setItem,
      read = store.getItem;
    store.setItem = (key, value) => {
      write(key, value);
      written = true;
      if (mode === "write") throw new Error("PRIVATE_DUMMY");
    };
    store.getItem = (key) => {
      if (mode === "readback" && written) throw new Error("PRIVATE_DUMMY");
      return read(key);
    };
    await assert.rejects(
      recovery.submit(draft(), async () => {
        calls++;
        return id(6);
      }),
      /storage/i,
    );
    assert.equal(calls, 0);
    assert.equal(recovery.pending.request.operation_id, id(5));
    store.setItem = write;
    store.getItem = read;
    const reloaded = controller(store, scope, id(99));
    reloaded.recover();
    await reloaded.submit(undefined, async (request) => {
      assert.equal(request.request.operation_id, id(5));
      return id(6);
    });
  }
});

test("losing storage while still mounted re-persists the frozen reference rather than generating another", async () => {
  const store = storage(),
    recovery = controller(store);
  recovery.recover();
  await assert.rejects(
    recovery.submit(draft(), async () => {
      throw new Error("uncertain");
    }),
  );
  const saved = store.getItem(recovery.key);
  store.removeItem(recovery.key);
  recovery.recover();
  await recovery.submit(undefined, async (request) => {
    assert.equal(JSON.stringify(request), saved);
    assert.equal(store.getItem(recovery.key), saved);
    return id(6);
  });
});

test("acknowledgement never removes a changed record and a fresh delivery gets a fresh reference", async () => {
  const store = storage(),
    { ReceiptRecovery } = load("pending-stock-receipt");
  let next = 5;
  const recovery = new ReceiptRecovery(
    scope,
    () => store,
    () => id(next++),
  );
  recovery.recover();
  await recovery.submit(draft(), async () => id(10));
  const saved = store.getItem(recovery.key),
    changed = JSON.parse(saved);
  changed.request.operation_id = id(90);
  store.setItem(recovery.key, JSON.stringify(changed));
  assert.throws(() => recovery.startAnother(), /storage/i);
  assert.equal(store.getItem(recovery.key), JSON.stringify(changed));
  store.setItem(recovery.key, saved);
  recovery.recover();
  recovery.startAnother();
  await recovery.submit(draft(), async (request) => {
    assert.equal(request.request.operation_id, id(6));
    return id(11);
  });
});

test("server retains missing-session and unauthorized-role denials before receipt RPC", async () => {
  for (const [session, role] of [
    [null, "owner"],
    [{ accessToken: "synthetic" }, "cashier"],
    [{ accessToken: "synthetic" }, "accountant"],
  ]) {
    let calls = 0;
    const mod = load("stock-receipts", {
      "@tanstack/react-start/server-only": {},
      "../auth/context": { resolveSessionUser: async () => session },
      "../pharmacy-context": { requirePharmacyContext: async () => ({ ...scope, role }) },
      "../supabase/server": {
        createServerSupabaseClient: () => ({
          rpc: async () => {
            calls++;
            return { data: id(6), error: null };
          },
        }),
      },
      "./products": { listProducts: async () => [] },
    });
    await assert.rejects(
      mod.confirmStockReceipt({
        version: 1,
        ...scope,
        request: { ...draft(), operation_id: id(5) },
      }),
    );
    assert.equal(calls, 0);
  }
});

test("server compares both request identity pins to authenticated context before any receipt RPC", async () => {
  const submission = { version: 1, ...scope, request: { ...draft(), operation_id: id(5) } };
  for (const actor of [
    { ...scope, role: "owner" },
    { ...scope, role: "pharmacist" },
    { ...scope, pharmacyId: id(8), role: "owner" },
    { ...scope, userId: id(8), role: "owner" },
  ]) {
    const calls = [];
    const mod = load("stock-receipts", {
      "@tanstack/react-start/server-only": {},
      "../auth/context": { resolveSessionUser: async () => ({ accessToken: "synthetic" }) },
      "../pharmacy-context": { requirePharmacyContext: async () => actor },
      "../supabase/server": {
        createServerSupabaseClient: () => ({
          rpc: async (name, args) => {
            calls.push({ name, args });
            return { data: id(6), error: null };
          },
        }),
      },
      "./products": { listProducts: async () => [] },
    });
    if (actor.pharmacyId === scope.pharmacyId && actor.userId === scope.userId) {
      assert.equal(await mod.confirmStockReceipt(submission), id(6));
      assert.equal(calls[0].args.target_pharmacy_id, scope.pharmacyId);
      assert.equal(calls[0].args.operation_id, id(5));
      assert.deepEqual(plain(calls[0].args.receipt_items), submission.request.items);
    } else {
      await assert.rejects(mod.confirmStockReceipt(submission), /user|pharmacy|scope/i);
      assert.equal(calls.length, 0);
    }
  }
});

test("single-flight dispatch blocks double click, recovery and acknowledgement until completion", async () => {
  const store = storage(),
    recovery = controller(store);
  recovery.recover();
  let release,
    calls = 0;
  const response = new Promise((resolve) => {
    release = resolve;
  });
  const first = recovery.submit(draft(), async () => {
    calls++;
    return response;
  });
  try {
    assert.equal(recovery.busy, true);
    await assert.rejects(
      recovery.submit(undefined, async () => {
        calls++;
        return id(6);
      }),
      /progress|busy/i,
    );
    assert.throws(() => recovery.recover(), /progress|busy/i);
    assert.equal(calls, 1);
  } finally {
    release(id(6));
    await first;
  }
  assert.equal(recovery.busy, false);
});

test("only an explicitly acknowledged confirmed request can be cleared; failed cleanup remains locked", async () => {
  const store = storage(),
    recovery = controller(store);
  recovery.recover();
  assert.equal(
    typeof recovery.startAnother,
    "function",
    "Confirmed receipt acknowledgement is required",
  );
  assert.throws(() => recovery.startAnother(), /confirmed/i);
  await assert.rejects(
    recovery.submit(draft(), async () => {
      throw new Error("uncertain");
    }),
  );
  assert.throws(() => recovery.startAnother(), /confirmed/i);
  await recovery.submit(undefined, async () => id(6));
  const raw = store.getItem(recovery.key),
    remove = store.removeItem;
  store.removeItem = () => {
    throw new Error("PRIVATE_DUMMY");
  };
  assert.throws(
    () => recovery.startAnother(),
    (error) => /storage/i.test(error.message) && !error.message.includes("PRIVATE"),
  );
  assert.equal(JSON.stringify(recovery.pending), raw);
  assert.equal(store.getItem(recovery.key), raw);
  store.removeItem = remove;
  recovery.recover();
  recovery.startAnother();
  assert.equal(recovery.pending, null);
  assert.equal(recovery.confirmedId, null);
  assert.equal(store.getItem(recovery.key), null);
});

test("invalid confirmation responses never clear or acknowledge the saved request", async () => {
  for (const result of ["", null, {}, "not-a-receipt"]) {
    const store = storage(),
      recovery = controller(store);
    recovery.recover();
    await assert.rejects(
      recovery.submit(draft(), async () => result),
      /confirm/i,
    );
    assert.equal(recovery.confirmedId, null);
    assert.equal(recovery.pending.request.operation_id, id(5));
    assert.equal(store.getItem(recovery.key), JSON.stringify(recovery.pending));
  }
});

test("changed durable records are neither adopted nor overwritten by an uncertain in-memory request", async () => {
  const store = storage(),
    recovery = controller(store);
  recovery.recover();
  await assert.rejects(
    recovery.submit(draft(), async () => {
      throw new Error("uncertain");
    }),
  );
  const saved = store.getItem(recovery.key),
    changed = JSON.parse(saved);
  changed.request.items[0].quantity++;
  const foreign = JSON.stringify(changed);
  store.setItem(recovery.key, foreign);
  assert.throws(() => recovery.recover(), /recovery/i);
  assert.equal(JSON.stringify(recovery.pending), saved);
  let calls = 0;
  await assert.rejects(
    recovery.submit(undefined, async () => {
      calls++;
      return id(6);
    }),
  );
  assert.equal(calls, 0);
  assert.equal(store.getItem(recovery.key), foreign);
});

test("a request appearing after initial recovery cannot be overwritten by a new delivery", async () => {
  const store = storage(),
    earlier = controller(store),
    later = controller(store, scope, id(99));
  earlier.recover();
  later.recover();
  await assert.rejects(
    earlier.submit(draft(), async () => {
      throw new Error("uncertain");
    }),
  );
  const saved = store.getItem(earlier.key);
  let calls = 0;
  await assert.rejects(
    later.submit(draft(), async () => {
      calls++;
      return id(6);
    }),
    /saved|pending/i,
  );
  assert.equal(calls, 0);
  assert.equal(store.getItem(earlier.key), saved);
});

test("storage getter, reads, quota and silent write failures prevent dispatch without leaking storage error text", async () => {
  for (const mode of ["getter", "read", "write", "silent"]) {
    const store = storage();
    let blocked = true,
      calls = 0;
    const { ReceiptRecovery } = load("pending-stock-receipt");
    const recovery = new ReceiptRecovery(
      scope,
      () => {
        if (blocked && mode === "getter") throw new Error("PRIVATE_DUMMY");
        return store;
      },
      () => id(5),
    );
    if (mode === "read")
      store.getItem = () => {
        if (blocked) throw new Error("PRIVATE_DUMMY");
        return null;
      };
    if (mode === "write")
      store.setItem = () => {
        throw new Error("PRIVATE_DUMMY");
      };
    if (mode === "silent") store.setItem = () => {};
    if (mode === "getter" || mode === "read") {
      assert.throws(
        () => recovery.recover(),
        (error) => /recovery/i.test(error.message) && !error.message.includes("PRIVATE"),
      );
      await assert.rejects(
        recovery.submit(draft(), async () => {
          calls++;
          return id(6);
        }),
      );
    } else {
      recovery.recover();
      await assert.rejects(
        recovery.submit(draft(), async () => {
          calls++;
          return id(6);
        }),
        (error) => /storage/i.test(error.message) && !error.message.includes("PRIVATE"),
      );
    }
    assert.equal(calls, 0);
    blocked = false;
  }
});

test("user and pharmacy boundaries isolate keys and reject transplanted recovery records", async () => {
  const store = storage(),
    original = controller(store);
  original.recover();
  await assert.rejects(
    original.submit(draft(), async () => {
      throw new Error("uncertain");
    }),
  );
  const raw = store.getItem(original.key);
  for (const actor of [
    { ...scope, pharmacyId: id(8) },
    { ...scope, userId: id(8) },
  ]) {
    const other = controller(store, actor);
    assert.notEqual(other.key, original.key);
    assert.equal(other.recover(), null);
    store.setItem(other.key, raw);
    assert.throws(() => other.recover(), /recovery|scope/i);
    assert.equal(other.ready, false);
    assert.equal(other.pending, null);
    assert.equal(store.getItem(original.key), raw);
  }
});

test("pending payload cannot be changed through a new draft or a mutable recovered view", async () => {
  const store = storage(),
    recovery = controller(store);
  recovery.recover();
  await assert.rejects(
    recovery.submit(draft(), async () => {
      throw new Error("uncertain");
    }),
  );
  const saved = store.getItem(recovery.key);
  const view = recovery.pending;
  view.request.items[0].quantity = 999;
  view.userId = id(90);
  let calls = 0;
  await assert.rejects(
    recovery.submit({ ...draft(), supplier_name: "Changed supplier" }, async () => {
      calls++;
      return id(6);
    }),
    /saved|pending/i,
  );
  assert.equal(calls, 0);
  assert.equal(store.getItem(recovery.key), saved);
  await recovery.submit(undefined, async (request) => {
    assert.deepEqual(plain(request), JSON.parse(saved));
    return id(6);
  });
});

test("uncertain save persists before dispatch and reload retries the exact same reference and payload", async () => {
  const store = storage(),
    first = controller(store);
  first.recover();
  let sent;
  await assert.rejects(
    first.submit(draft(), async (request) => {
      sent = plain(request);
      assert.deepEqual(JSON.parse(store.getItem(first.key)), sent);
      throw new Error("Synthetic uncertain response");
    }),
    /uncertain/,
  );
  assert.equal(first.pending.request.operation_id, id(5));
  const reloaded = controller(store, scope, id(99));
  assert.deepEqual(plain(reloaded.recover()), sent);
  const result = await reloaded.submit(undefined, async (request) => {
    assert.deepEqual(plain(request), sent);
    return id(6);
  });
  assert.equal(result, id(6));
  assert.equal(reloaded.confirmedId, id(6));
  assert.deepEqual(
    JSON.parse(store.getItem(reloaded.key)),
    sent,
    "Retain recovery until explicit confirmation acknowledgement",
  );
});
