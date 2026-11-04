// Synthetic integration of the ACTUAL membership resolver and status DAL.
// Not a PostgreSQL/Auth/RLS runtime test; SQL authorization is source-reviewed separately.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
const require = createRequire(import.meta.url),
  ts = require("typescript");
function fixture({
  user = "actor-a",
  session = true,
  members = [
    {
      user_id: "actor-a",
      pharmacy_id: "pharmacy-a",
      role: "cashier",
      is_active: true,
      pharmacies: { is_active: true },
    },
    {
      user_id: "actor-b",
      pharmacy_id: "pharmacy-b",
      role: "owner",
      is_active: true,
      pharmacies: { is_active: true },
    },
  ],
} = {}) {
  const calls = [],
    filters = [],
    cache = new Map();
  const client = {
    auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }) },
    from(name) {
      assert.equal(name, "pharmacy_members");
      const criteria = [];
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          criteria.push([k, v]);
          filters.push([k, v]);
          return q;
        },
        then(resolve, reject) {
          return Promise.resolve({
            error: null,
            data: members.filter((row) =>
              criteria.every(
                ([k, v]) =>
                  (k === "pharmacies.is_active" ? row.pharmacies.is_active : row[k]) === v,
              ),
            ),
          }).then(resolve, reject);
        },
      };
      return q;
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      assert.equal(name, "get_pharmacy_business_day_status");
      // Only tenant B is closed; DAL must never request B for actor A.
      return {
        error: null,
        data: { business_date: "2026-11-04", is_closed: args.target_pharmacy_id === "pharmacy-b" },
      };
    },
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    cache.set(path, module.exports);
    const source = readFileSync(new URL("../src/lib/" + path + ".ts", import.meta.url), "utf8");
    runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        module,
        exports: module.exports,
        require: (s) => {
          if (s === "zod") return require(s);
          if (s === "@tanstack/react-start/server-only") return {};
          if (s === "@tanstack/react-start/server") return { setResponseHeader() {} };
          if (s.endsWith("auth/context"))
            return {
              resolveSessionUser: async () => (session ? { accessToken: "synthetic" } : null),
            };
          if (s.endsWith("supabase/server")) return { createServerSupabaseClient: () => client };
          if (s.endsWith("pharmacy-context")) return load("pharmacy-context");
          throw new Error("Unexpected fixture import");
        },
      },
    );
    return module.exports;
  }
  return { read: load("data/business-day").getPharmacyBusinessDayStatus, calls, filters };
}
test("actual membership resolver derives status scope and ignores a forged other-pharmacy/date input", async () => {
  const f = fixture();
  const result = await f.read({ target_pharmacy_id: "pharmacy-b", business_date: "1900-01-01" });
  assert.equal(result.pharmacyId, "pharmacy-a");
  assert.equal(result.userId, "actor-a");
  assert.equal(result.is_closed, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args.target_pharmacy_id, "pharmacy-a");
  assert.deepEqual(JSON.parse(JSON.stringify(f.filters)), [
    ["user_id", "actor-a"],
    ["is_active", true],
    ["pharmacies.is_active", true],
  ]);
});
for (const [name, options] of [
  ["no session", { session: false }],
  ["no authenticated user", { user: null }],
  ["nonmember", { members: [] }],
  [
    "inactive membership",
    {
      members: [
        {
          user_id: "actor-a",
          pharmacy_id: "pharmacy-a",
          role: "cashier",
          is_active: false,
          pharmacies: { is_active: true },
        },
      ],
    },
  ],
  [
    "inactive pharmacy",
    {
      members: [
        {
          user_id: "actor-a",
          pharmacy_id: "pharmacy-a",
          role: "cashier",
          is_active: true,
          pharmacies: { is_active: false },
        },
      ],
    },
  ],
  ["only other actors membership", { user: "nonmember" }],
  [
    "ambiguous memberships",
    {
      members: ["pharmacy-a", "pharmacy-b"].map((pharmacy_id) => ({
        user_id: "actor-a",
        pharmacy_id,
        role: "owner",
        is_active: true,
        pharmacies: { is_active: true },
      })),
    },
  ],
])
  test("actual membership resolution denies " + name + " before any closure RPC", async () => {
    const f = fixture(options);
    await assert.rejects(f.read());
    assert.equal(f.calls.length, 0);
  });
