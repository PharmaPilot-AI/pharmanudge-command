import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const require = createRequire(new URL("../package.json", import.meta.url));
const draftPath = new URL(
  "../docs/drafts/LOCAL_ONLY_get_pharmacy_business_day_status.sql",
  import.meta.url,
);
const ts = require("typescript");
const scope = {
  pharmacyId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
};
const plain = (value) => JSON.parse(JSON.stringify(value));

test("GET query delegates with no client identity or date arguments", async () => {
  const source = readFileSync(new URL("../src/lib/data/validation.ts", import.meta.url), "utf8");
  const overrides = Object.fromEntries(
    [...source.matchAll(/from "(\.[^"]+)"/g)].map((match) => [match[1], {}]),
  );
  const received = [];
  const expected = { ...scope, business_date: "2026-11-04", is_closed: true };
  overrides["./business-day"] = {
    getPharmacyBusinessDayStatus: async (...args) => {
      received.push(args);
      return expected;
    },
  };
  overrides["@tanstack/react-start"] = {
    createServerFn: (options) => {
      const builder = {
        validator: () => builder,
        handler: (handler) => Object.assign(handler, { method: options.method }),
      };
      return builder;
    },
  };
  const mod = load("data/validation", overrides);
  assert.equal(typeof mod.pharmacyBusinessDayQuery, "function", "GET query must be exported");
  assert.equal(mod.pharmacyBusinessDayQuery.method, "GET");
  assert.equal(
    await mod.pharmacyBusinessDayQuery({
      data: { pharmacyId: "attacker", business_date: "1900-01-01" },
    }),
    expected,
  );
  assert.deepEqual(received, [[]]);
});

test("status RPC type addition matches the draft JSON contract (source check)", () => {
  const source = readFileSync(
    new URL("../src/lib/supabase/database.types.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /get_pharmacy_business_day_status:\s*\{\s*Args:\s*\{\s*target_pharmacy_id: string;?\s*\};\s*Returns: Json;/,
  );
});

test("SQL draft has explicit security and minimal-data guards — source checks, NOT runtime DB qualification", () => {
  assert.ok(existsSync(draftPath), "Local-only SQL draft must exist outside executable migrations");
  const sql = readFileSync(draftPath, "utf8")
    .replace(/--[^\n]*/g, "")
    .toLowerCase();
  assert.match(
    sql,
    /create function public\.get_pharmacy_business_day_status\(target_pharmacy_id uuid\)/,
  );
  assert.match(sql, /returns jsonb/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public,\s*pg_temp/);
  assert.match(sql, /if auth\.uid\(\) is null then/);
  assert.match(sql, /from public\.pharmacy_members m/);
  assert.match(sql, /join public\.pharmacies p on p\.id = m\.pharmacy_id/);
  for (const guard of [
    "m.pharmacy_id = target_pharmacy_id",
    "m.user_id = auth.uid()",
    "m.is_active",
    "p.is_active",
  ])
    assert.ok(sql.includes(guard), guard);
  assert.match(sql, /m\.role in \('owner', 'pharmacist', 'cashier', 'accountant'\)/);
  assert.match(sql, /raise exception[\s\S]*42501/);
  assert.match(sql, /now\(\) at time zone 'africa\/lagos'/);
  assert.match(sql, /from public\.daily_closures c/);
  assert.match(sql, /c\.pharmacy_id = target_pharmacy_id/);
  assert.match(sql, /c\.business_date = v_today/);
  const keys = [...sql.matchAll(/'([a-z_]+)'\s*,/g)]
    .map((match) => match[1])
    .filter((key) => !["owner", "pharmacist", "cashier"].includes(key));
  assert.deepEqual(keys, ["business_date", "is_closed"]);
  assert.match(
    sql,
    /revoke all on function public\.get_pharmacy_business_day_status\(uuid\) from public, anon/,
  );
  assert.match(
    sql,
    /grant execute on function public\.get_pharmacy_business_day_status\(uuid\) to authenticated/,
  );
  assert.doesNotMatch(
    sql,
    /grant\s+[^;]*\bon\s+(?:table\s+)?public\.(?:daily_closures|pharmacy_members|pharmacies)/,
  );
  assert.doesNotMatch(sql, /\b(insert|update|delete|alter table|create table)\b/);
  assert.doesNotMatch(sql, /sales|expenses|sum\s*\(|total/);
});

function load(file, overrides) {
  const path = new URL(`../src/lib/${file}.ts`, import.meta.url);
  if (!existsSync(path)) return {};
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (spec) => {
      if (spec in overrides) return overrides[spec];
      if (spec === "zod") return require("zod");
      assert.fail(`Unexpected dependency: ${spec}`);
    },
  });
  return module.exports;
}
function fixture({
  role = "owner",
  session = { accessToken: "synthetic-token" },
  contextError,
  data = { business_date: "2026-11-04", is_closed: false },
  error = null,
  rpcThrows,
} = {}) {
  const calls = [];
  const responseHeaders = new Map();
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args: plain(args) });
      if (rpcThrows) throw rpcThrows;
      return { data, error };
    },
  };
  const mod = load("data/business-day", {
    "@tanstack/react-start/server-only": {},
    "@tanstack/react-start/server": {
      setResponseHeader: (key, value) => responseHeaders.set(key, value),
    },
    "../auth/context": { resolveSessionUser: async () => session },
    "../pharmacy-context": {
      requirePharmacyContext: async (received) => {
        assert.equal(received, client);
        if (contextError) throw contextError;
        return { ...scope, role };
      },
    },
    "../supabase/server": {
      createServerSupabaseClient: (token) => {
        assert.equal(token, "synthetic-token");
        return client;
      },
    },
  });
  return { mod, calls, responseHeaders };
}

test("each supported synthetic role reads only DB status with server-derived identity", async () => {
  for (const role of ["owner", "pharmacist", "cashier", "accountant"]) {
    for (const is_closed of [false, true]) {
      const { mod, calls } = fixture({ role, data: { business_date: "2026-11-04", is_closed } });
      assert.equal(
        typeof mod.getPharmacyBusinessDayStatus,
        "function",
        "Business-day status DAL must exist",
      );
      const result = await mod.getPharmacyBusinessDayStatus({
        pharmacyId: "attacker",
        userId: "attacker",
        business_date: "1900-01-01",
      });
      assert.deepEqual(plain(result), { ...scope, business_date: "2026-11-04", is_closed });
      assert.deepEqual(calls, [
        {
          name: "get_pharmacy_business_day_status",
          args: { target_pharmacy_id: scope.pharmacyId },
        },
      ]);
    }
  }
});

test("missing session, inactive/ambiguous context and unsupported role fail before RPC", async () => {
  for (const options of [
    { session: null },
    { contextError: new Error("No active pharmacy membership for the current user.") },
    { role: "viewer" },
  ]) {
    const { mod, calls } = fixture(options);
    await assert.rejects(mod.getPharmacyBusinessDayStatus());
    assert.equal(calls.length, 0);
  }
});

test("strict validation rejects malformed dates, missing fields, coercion and extra totals", async () => {
  for (const data of [
    null,
    [],
    "open",
    {},
    { business_date: "2026-11-04" },
    { business_date: "2026-11-04", is_closed: "false" },
    { business_date: "2026-11-04", is_closed: 0 },
    { business_date: "2026-02-29", is_closed: false },
    { business_date: "2026-04-31", is_closed: false },
    { business_date: "2026-13-01", is_closed: false },
    { business_date: "2026-1-04", is_closed: false },
    { business_date: "2026-11-04T00:00:00Z", is_closed: false },
    { business_date: "2026-11-04", is_closed: false, totals: {} },
  ]) {
    const { mod } = fixture({ data });
    await assert.rejects(mod.getPharmacyBusinessDayStatus(), /status|response/i);
  }
  const { mod } = fixture({ data: { business_date: "2028-02-29", is_closed: true } });
  assert.equal((await mod.getPharmacyBusinessDayStatus()).business_date, "2028-02-29");
});

test("missing RPC, denied read and thrown transport errors fail closed without private detail", async () => {
  for (const options of [
    { error: { code: "PGRST202", message: "PRIVATE missing function" } },
    { error: { code: "42501", message: "PRIVATE denied" } },
    { rpcThrows: new Error("PRIVATE transport") },
  ]) {
    const { mod } = fixture(options);
    await assert.rejects(
      mod.getPharmacyBusinessDayStatus(),
      (error) => /business-day status/i.test(error.message) && !error.message.includes("PRIVATE"),
    );
  }
});

test("status reads are explicitly non-cacheable across closure transitions", async () => {
  const { mod, responseHeaders } = fixture();
  await mod.getPharmacyBusinessDayStatus();
  assert.equal(responseHeaders.get("Cache-Control"), "no-store");
});
