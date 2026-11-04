import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
function load(name, imports = {}, globals = {}) {
  const file = new URL(`../src/lib/${name}.ts`, import.meta.url);
  if (!existsSync(file)) return {};
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (s) => {
      assert.ok(s in imports, `Unexpected dependency ${s}`);
      return imports[s];
    },
    Intl,
    Date,
    Promise,
    AbortController,
    ...globals,
  });
  return module.exports;
}
const scope = { pharmacyId: "pharmacy-a", userId: "actor-a" };
function fixture(actor = scope) {
  const { BusinessDayGate } = load("business-day-gate");
  assert.equal(typeof BusinessDayGate, "function", "production business-day gate must exist");
  let time = Date.parse("2026-11-04T12:00:00Z");
  const calls = [],
    timers = new Map();
  let serial = 0;
  const gate = new BusinessDayGate(actor.pharmacyId, actor.userId, {
    read: (signal) => new Promise((resolve, reject) => calls.push({ resolve, reject, signal })),
    now: () => time,
    setTimeout: (fn, ms) => {
      timers.set(++serial, { fn, at: time + ms });
      return serial;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const answer = (i, extra = {}) =>
    calls[i].resolve({
      ...actor,
      business_date: new Date(time + 3600000).toISOString().slice(0, 10),
      is_closed: false,
      ...extra,
    });
  const advance = async (ms) => {
    time += ms;
    for (const [id, timer] of [...timers])
      if (timer.at <= time) {
        timers.delete(id);
        timer.fn();
      }
    await flush();
  };
  return {
    gate,
    calls,
    timers,
    answer,
    advance,
    setTime: (value) => {
      time = Date.parse(value);
    },
  };
}
const flush = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};
test("initial and missing identity gates are fail-closed, verified current scoped open status permits submission", async () => {
  const f = fixture();
  assert.equal(f.gate.blocked, true);
  assert.equal(f.gate.status.kind, "checking");
  const submit = f.gate.canSubmit();
  assert.equal(f.calls.length, 1);
  f.answer(0);
  assert.equal(await submit, true);
  assert.equal(f.gate.blocked, false);
  const missing = fixture({ pharmacyId: undefined, userId: undefined });
  assert.equal(await missing.gate.canSubmit(), false);
  assert.equal(missing.calls.length, 0);
});

for (const invalid of [
  undefined,
  null,
  { business_date: undefined },
  { pharmacyId: "other" },
  { userId: "other" },
  { business_date: "2026-11-03" },
  { business_date: "2026-11-05" },
  { is_closed: "false" },
]) {
  test(`missing/malformed/mismatched status fails closed: ${JSON.stringify(invalid)}`, async () => {
    const f = fixture();
    const pending = f.gate.canSubmit();
    if (invalid == null) f.calls[0].resolve(invalid);
    else f.answer(0, invalid);
    assert.equal(await pending, false);
    assert.equal(f.gate.status.kind, "error");
  });
}
test("RPC failure is handled and fails closed after previous open", async () => {
  const f = fixture();
  const initial = f.gate.canSubmit();
  f.answer(0);
  await initial;
  const pending = f.gate.canSubmit();
  f.calls[1].reject(new Error("offline"));
  assert.equal(await pending, false);
  assert.equal(f.gate.blocked, true);
});
test("each sequential submit performs a fresh read; concurrent submits share one bounded read", async () => {
  const f = fixture();
  const a = f.gate.canSubmit(),
    b = f.gate.canSubmit();
  assert.equal(f.calls.length, 1);
  f.answer(0);
  assert.equal(await a, true);
  assert.equal(await b, true);
  const c = f.gate.canSubmit();
  assert.equal(f.calls.length, 2);
  f.answer(1, { is_closed: true });
  assert.equal(await c, false);
});
test("hung status times out fail-closed and late reply cannot overwrite a later read", async () => {
  const f = fixture();
  const pending = f.gate.canSubmit();
  await f.advance(10000);
  assert.equal(await pending, false);
  const next = f.gate.canSubmit();
  f.answer(1, { is_closed: true });
  assert.equal(await next, false);
  f.answer(0);
  await flush();
  assert.equal(f.gate.status.kind, "closed");
  assert.equal(f.timers.size, 0);
});
test("markClosed latches synchronously, discards older open responses and survives same-date refresh", async () => {
  const f = fixture();
  const pending = f.gate.canSubmit();
  f.gate.markClosed();
  assert.equal(f.gate.status.kind, "closed");
  assert.equal(f.gate.blocked, true);
  f.answer(0);
  assert.equal(await pending, false);
  const next = f.gate.refresh();
  f.answer(1);
  await next;
  assert.equal(f.gate.status.kind, "closed");
});
test("Lagos midnight forgets yesterday closure but blocks until fresh current date verification", async () => {
  const f = fixture();
  f.setTime("2026-11-04T22:59:59Z");
  f.gate.markClosed();
  f.setTime("2026-11-04T23:00:00Z");
  assert.equal(f.gate.status.kind, "checking");
  assert.equal(f.gate.blocked, true);
  const next = f.gate.canSubmit();
  f.answer(0);
  assert.equal(await next, true);
  assert.equal(f.gate.status.business_date, "2026-11-05");
});
test("open status expires even if timers were suspended, and pre-midnight replies cannot reopen next day", async () => {
  const f = fixture();
  const first = f.gate.refresh();
  f.answer(0);
  await first;
  await f.advance(15000);
  assert.equal(f.gate.blocked, true);
  f.setTime("2026-11-04T22:59:59Z");
  const next = f.gate.canSubmit();
  f.setTime("2026-11-04T23:00:00Z");
  f.answer(1, { business_date: "2026-11-04" });
  assert.equal(await next, false);
});
test("dispose rejects stale scope responses, notifies no subscribers and cancels timers", async () => {
  const f = fixture();
  let notified = 0;
  f.gate.subscribe(() => notified++);
  const pending = f.gate.canSubmit();
  f.gate.dispose();
  const count = notified;
  f.answer(0);
  assert.equal(await pending, false);
  assert.equal(notified, count);
  assert.equal(f.timers.size, 0);
  assert.equal(f.gate.blocked, true);
  await f.gate.refresh();
  assert.equal(f.calls.length, 1);
});
function hookFixture() {
  let time = Date.parse("2026-11-04T12:00:00Z"),
    serial = 0,
    cursor = 0;
  const slots = [],
    effects = [],
    timers = new Map(),
    calls = [];
  const target = () => {
    const events = new Map();
    return {
      events,
      addEventListener: (key, fn) => {
        if (!events.has(key)) events.set(key, new Set());
        events.get(key).add(fn);
      },
      removeEventListener: (key, fn) => events.get(key)?.delete(fn),
      fire: (key) => {
        for (const fn of events.get(key) ?? []) fn();
      },
    };
  };
  const window = target(),
    document = { ...target(), visibilityState: "visible" };
  let args = [scope.pharmacyId, scope.userId],
    value;
  const react = {
    useMemo: (fn, deps) => {
      const i = cursor++;
      if (!slots[i] || deps.some((x, n) => x !== slots[i].deps[n]))
        slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useReducer: () => {
      cursor++;
      return [0, () => render(false)];
    },
    useEffect: (fn, deps) => {
      const i = cursor++;
      if (!slots[i] || deps.some((x, n) => x !== slots[i].deps[n])) {
        slots[i]?.cleanup?.();
        slots[i] = { deps, fn };
        effects.push(() => {
          slots[i].cleanup = fn();
        });
      }
    },
  };
  const globals = {
    window,
    document,
    Date: { now: () => time },
    setTimeout: (fn, ms) => {
      timers.set(++serial, { fn, at: time + ms });
      return serial;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const { useBusinessDay } = load(
    "use-business-day",
    {
      react,
      "./business-day-gate": load("business-day-gate"),
      "@/lib/data/validation": {
        pharmacyBusinessDayQuery: () =>
          new Promise((resolve, reject) => calls.push({ resolve, reject })),
      },
    },
    globals,
  );
  assert.equal(typeof useBusinessDay, "function", "production hook must exist");
  function render(runEffects = true) {
    cursor = 0;
    value = useBusinessDay(...args);
    if (runEffects) while (effects.length) effects.shift()();
    return value;
  }
  render();
  return {
    get value() {
      return value;
    },
    calls,
    timers,
    window,
    document,
    answer: (i, extra = {}) =>
      calls[i].resolve({
        pharmacyId: args[0],
        userId: args[1],
        business_date: new Date(time + 3600000).toISOString().slice(0, 10),
        is_closed: false,
        ...extra,
      }),
    scope: (...next) => {
      args = next;
      render();
    },
    advance: async (ms) => {
      time += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= time) {
          timers.delete(id);
          timer.fn();
        }
      await flush();
    },
    unmount: () => {
      for (const s of slots) s?.cleanup?.();
    },
    strictReplay: () => {
      for (const s of slots)
        if (s?.fn) {
          s.cleanup?.();
          s.cleanup = s.fn();
        }
    },
  };
}
test("production hook polls at 15 seconds, revalidates on focus/visible/online, cleans up on unmount", async () => {
  const f = hookFixture();
  assert.equal(f.value.blocked, true);
  assert.equal(f.calls.length, 1);
  f.answer(0);
  await flush();
  assert.equal(f.value.blocked, false);
  await f.advance(14999);
  assert.equal(f.calls.length, 1);
  await f.advance(1);
  assert.equal(f.calls.length, 2);
  f.answer(1);
  await flush();
  for (const event of ["focus", "online"]) {
    f.window.fire(event);
    const i = f.calls.length - 1;
    f.answer(i);
    await flush();
  }
  assert.equal(f.calls.length, 4);
  f.document.visibilityState = "hidden";
  f.document.fire("visibilitychange");
  assert.equal(f.calls.length, 4);
  f.document.visibilityState = "visible";
  f.document.fire("visibilitychange");
  assert.equal(f.calls.length, 5);
  f.unmount();
  assert.equal(f.timers.size, 0);
  f.answer(4);
  await flush();
  for (const handlers of [...f.window.events.values(), ...f.document.events.values()])
    assert.equal(handlers.size, 0);
});
test("production hook scope change never exposes old open data and ignores stale network completion", async () => {
  const f = hookFixture();
  f.scope("pharmacy-b", "actor-b");
  assert.equal(f.value.blocked, true);
  f.answer(0, scope);
  await flush();
  assert.equal(f.value.blocked, true);
  f.answer(1);
  await flush();
  assert.equal(f.value.blocked, false);
  f.scope(undefined, undefined);
  assert.equal(f.value.blocked, true);
  assert.equal(await f.value.canSubmit(), false);
  f.unmount();
});
test("production hook survives React strict-effect setup/cleanup replay", async () => {
  const f = hookFixture();
  f.strictReplay();
  assert.equal(f.calls.length, 2);
  f.answer(0);
  await flush();
  assert.equal(f.value.blocked, true);
  f.answer(1);
  await flush();
  assert.equal(f.value.blocked, false);
  f.unmount();
});
for (const role of ["owner", "pharmacist", "cashier", "accountant"])
  test(`${role} uses only identity-tagged status and never requires financial data`, async () => {
    const f = fixture({ ...scope, userId: role });
    const pending = f.gate.canSubmit();
    f.answer(0);
    assert.equal(await pending, true);
  });
test("a submission never treats a previously started background poll as its own fresh read", async () => {
  const f = fixture();
  const poll = f.gate.refresh();
  const submit = f.gate.canSubmit();
  assert.equal(f.calls.length, 1);
  f.answer(0);
  await poll;
  await flush();
  assert.equal(f.calls.length, 2);
  f.answer(1, { is_closed: true });
  assert.equal(await submit, false);
});
test("timeout and disposal abort transport before permitting a replacement read", async () => {
  const f = fixture();
  const pending = f.gate.canSubmit();
  assert.equal(f.calls[0].signal?.aborted, false);
  await f.advance(10000);
  assert.equal(await pending, false);
  assert.equal(f.calls[0].signal.aborted, true);
  const next = f.gate.canSubmit();
  assert.equal(f.calls[1].signal.aborted, false);
  f.gate.dispose();
  assert.equal(f.calls[1].signal.aborted, true);
  assert.equal(await next, false);
});
