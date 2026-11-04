import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const require = createRequire(import.meta.url),
  ts = require("typescript");
function fixture() {
  const module = { exports: {} };
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../src/lib/business-day-gate.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    { module, exports: module.exports, Date, Promise, AbortController },
  );
  let time = Date.parse("2026-11-04T23:00:01Z");
  const calls = [];
  const gate = new module.exports.BusinessDayGate("pharmacy-a", "user-a", {
    read: () => new Promise((resolve) => calls.push(resolve)),
    now: () => time,
    setTimeout: () => 0,
    clearTimeout() {},
  });
  return { gate, calls };
}
test("new-day preflight cannot permit submission from a previous-day catalogue or expense list", async () => {
  const f = fixture();
  const pending = f.gate.canSubmit("2026-11-04");
  f.calls[0]({
    pharmacyId: "pharmacy-a",
    userId: "user-a",
    business_date: "2026-11-05",
    is_closed: false,
  });
  assert.equal(await pending, false);
  assert.equal(f.gate.status.kind, "open");
  const retry = f.gate.canSubmit("2026-11-05");
  f.calls[1]({
    pharmacyId: "pharmacy-a",
    userId: "user-a",
    business_date: "2026-11-05",
    is_closed: false,
  });
  assert.equal(await retry, true);
});
test("a delayed previous-day closure rejection cannot latch the newly open Lagos day closed", async () => {
  const f = fixture();
  const pending = f.gate.canSubmit();
  f.calls[0]({
    pharmacyId: "pharmacy-a",
    userId: "user-a",
    business_date: "2026-11-05",
    is_closed: false,
  });
  await pending;
  f.gate.markClosed("2026-11-04");
  assert.equal(f.gate.status.kind, "open");
  f.gate.markClosed("2026-11-05");
  assert.equal(f.gate.status.kind, "closed");
});
