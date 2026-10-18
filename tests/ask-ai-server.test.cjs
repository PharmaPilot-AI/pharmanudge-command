const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");

const input = { question: "How are recorded sales?", period: "week" };
const scope = { userId: "owner-1", pharmacyId: "pharmacy-1", role: "owner" };
const evidence = {
  period: "week",
  businessDate: "2026-10-18",
  retrievedAt: "2026-10-18T12:00:00Z",
  facts: [],
  limitations: [],
};
function setup(options = {}) {
  const calls = [];
  let authCount = 0;
  const client = {
    rpc: async (name, args) => {
      calls.push(["reserve", name, args]);
      if (options.rpcThrows) throw Error("private database detail");
      return options.reservation ?? { data: "allowed", error: null };
    },
  };
  const schema = loadTs("src/lib/data/ask-ai-schema.ts");
  const { askPharmaNudge } = loadTs("src/lib/data/ask-ai.ts", {
    "./ask-ai-schema": schema,
    "../auth/context": {
      resolveSessionUser: async () => {
        calls.push("session");
        await Promise.resolve();
        calls.push("session-resolved");
        return options.noSession ? null : { accessToken: "explicit-token", userId: scope.userId };
      },
    },
    "../supabase/server": {
      createServerSupabaseClient: (token) => {
        assert.equal(token, "explicit-token");
        assert.equal(calls.at(-1), "session-resolved");
        calls.push("client");
        return client;
      },
    },
    "../pharmacy-context": {
      requirePharmacyContext: async () => {
        calls.push("auth");
        authCount++;
        if (authCount > 1 && options.recheckThrows) throw Error("private recheck");
        if (options.authThrows) throw Error("private auth detail");
        return (authCount > 1 && options.changedScope) || options.scope || scope;
      },
    },
    "./ask-ai-context": {
      getAskAiContext: async (period, expected) => {
        calls.push("evidence");
        assert.equal(period, "week");
        assert.equal(expected.pharmacyId, scope.pharmacyId);
        if (options.evidenceThrows) throw Error("private evidence detail");
        return evidence;
      },
    },
    "./ask-ai-gateway": {
      isPharmaNudgeConfigured: () => {
        calls.push("configuration");
        return options.configured !== false;
      },
      requestPharmaNudgeAdvice: async (question, facts) => {
        calls.push("provider");
        assert.equal(question, input.question);
        assert.equal(facts, evidence);
        if (options.providerThrows) throw Error("private provider detail");
        return (
          options.advice ?? {
            status: "available",
            advisory: { explanation: "Advisory", recommendations: [], fact_ids: [] },
          }
        );
      },
    },
  });
  return { askPharmaNudge, calls };
}

test("obvious personal and clinical questions are rejected before auth or quota", async () => {
  for (const question of [
    "Email jane@example.com about sales",
    "Call +234 (803) 123-4567",
    "Patient Jane needs help",
    "Diagnose these symptoms",
    "What dosage should I give?",
    "How many mg should a child take?",
  ]) {
    const { askPharmaNudge, calls } = setup();
    await assert.rejects(askPharmaNudge({ ...input, question }), /business-only/);
    assert.deepEqual(calls, []);
  }
});

test("authenticated owner reserves once after evidence and before provider", async () => {
  const { askPharmaNudge, calls } = setup();
  const result = await askPharmaNudge(input);
  assert.equal(result.evidence, evidence);
  assert.equal(result.advice.status, "available");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    "session",
    "session-resolved",
    "client",
    "auth",
    "evidence",
    "configuration",
    "auth",
    ["reserve", "reserve_pharmacy_ai_request", { target_pharmacy_id: scope.pharmacyId }],
    "provider",
  ]);
});

for (const [label, options] of [
  ["missing session", { noSession: true }],
  ["nonowner", { scope: { ...scope, role: "cashier" } }],
  ["identity mismatch", { scope: { ...scope, userId: "different-user" } }],
  ["membership failure", { authThrows: true }],
  ["evidence read failure", { evidenceThrows: true }],
])
  test(label + " fails closed with a safe error", async () => {
    const { askPharmaNudge, calls } = setup(options);
    await assert.rejects(askPharmaNudge(input), (error) => !error.message.includes("private"));
    assert.ok(!calls.some((call) => Array.isArray(call)));
    assert.ok(!calls.includes("provider"));
  });

test("strict validation rejects empty, oversized, wrong-period and scope injection", async () => {
  for (const invalid of [
    null,
    { ...input, question: " " },
    { ...input, question: "a".repeat(1001) },
    { ...input, period: "year" },
    { ...input, pharmacyId: "attacker" },
  ]) {
    const { askPharmaNudge, calls } = setup();
    await assert.rejects(askPharmaNudge(invalid));
    assert.deepEqual(calls, []);
  }
});

for (const [label, options, reason] of [
  ["configuration absent", { configured: false }, "configuration"],
  ["daily limit", { reservation: { data: "daily_limit", error: null } }, "usage_limit"],
  ["cooldown", { reservation: { data: "rate_limit", error: null } }, "rate_limit"],
  ["unknown reservation", { reservation: { data: "future_value", error: null } }, "reservation"],
  ["null reservation", { reservation: { data: null, error: null } }, "reservation"],
  ["RPC error", { reservation: { data: "allowed", error: { message: "private" } } }, "reservation"],
  ["RPC throws", { rpcThrows: true }, "reservation"],
  ["provider throws", { providerThrows: true }, "provider"],
  ["provider unavailable", { advice: { status: "unavailable", reason: "provider" } }, "provider"],
])
  test(label + " retains verified evidence without retry", async () => {
    const { askPharmaNudge, calls } = setup(options);
    const result = await askPharmaNudge(input);
    assert.equal(result.evidence, evidence);
    assert.equal(result.advice.status, "unavailable");
    assert.equal(result.advice.reason, reason);
    assert.equal(
      calls.filter((call) => Array.isArray(call)).length,
      options.configured === false ? 0 : 1,
    );
    assert.equal(
      calls.filter((call) => call === "provider").length,
      label.startsWith("provider") ? 1 : 0,
    );
  });

const financial = {
  period: "week",
  start_date: "2026-10-12",
  end_date: "2026-10-18",
  total_sales: "9007199254740993.01",
  product_revenue: "100.00",
  service_revenue: "10.00",
  cash_sales: "50.00",
  transfer_sales: "40.00",
  card_sales: "20.00",
  product_cost: "70.00",
  gross_profit: "40.00",
  total_expenses: "60.00",
  estimated_net_profit: "-20.00",
  sale_count: "2",
  expense_count: "1",
};
const day = { ...scope, business_date: "2026-10-18", closure: null };
const stock = {
  as_of_date: "2026-10-18",
  active_products: "10",
  out_of_stock_products: "2",
  expiring_batches: "3",
  expired_batches: "1",
  low_stock_products: null,
};
function contextSetup(options = {}) {
  let authCount = 0;
  return loadTs("src/lib/data/ask-ai-context.ts", {
    "../auth/context": {
      resolveSessionUser: async () => ({ accessToken: "token", userId: scope.userId }),
    },
    "../supabase/server": {
      createServerSupabaseClient: (token) => {
        assert.equal(token, "token");
        return {};
      },
    },
    "../pharmacy-context": {
      requirePharmacyContext: async () =>
        ++authCount > 1 && options.changed ? { ...scope, pharmacyId: "other" } : scope,
    },
    "../financial-format": loadTs("src/lib/financial-format.ts"),
    "./financial-schema": loadTs("src/lib/data/financial-schema.ts"),
    "./ask-ai-schema": loadTs("src/lib/data/ask-ai-schema.ts"),
    "./financial": {
      getPharmacyFinancialSummary: async (period) => {
        assert.equal(period, "week");
        if (options.readError) throw Error("private");
        return financial;
      },
    },
    "./day-closing": { getPharmacyDaySummary: async () => options.day ?? day },
    "./stock-health": { getPharmacyStockHealth: async () => options.stock ?? stock },
  }).getAskAiContext;
}

test("aggregate evidence rejects membership drift during separate reads", async () => {
  await assert.rejects(contextSetup({ changed: true })("week", scope));
});

test("aggregate facts retain exact decimal money and explicit date contexts", async () => {
  const result = await contextSetup()("week", scope);
  assert.match(result.facts.find((f) => f.id === "sales").text, /9,007,199,254,740,993\.01/);
  assert.match(result.facts.find((f) => f.id === "net_profit").text, /-₦20\.00/);
  assert.match(result.facts.find((f) => f.id === "report_period").text, /2026-10-12 to 2026-10-18/);
  assert.match(result.facts.find((f) => f.id === "stock_availability").text, /As of 2026-10-18/);
  assert.match(
    result.facts.find((f) => f.id === "cash_reconciliation").text,
    /no saved cash reconciliation/,
  );
  assert.ok(result.limitations.some((text) => text.includes("not historical")));
  assert.ok(!JSON.stringify(result).includes("owner-1"));
  assert.ok(!JSON.stringify(result).includes("pharmacy-1"));
});

test("read errors and mismatched business dates never become zero facts", async () => {
  await assert.rejects(contextSetup({ readError: true })("week", scope));
  await assert.rejects(
    contextSetup({ stock: { ...stock, as_of_date: "2026-10-19" } })("week", scope),
  );
  await assert.rejects(contextSetup({ day: { ...day, pharmacyId: "other" } })("week", scope));
});

test("saved closure values are whitelisted without notes or identities", async () => {
  const closure = {
    business_date: "2026-10-18",
    opening_cash: "10.00",
    expected_cash: "25.00",
    counted_cash: "23.00",
    cash_variance: "-2.00",
    notes: "patient Jane private@example.com",
    closed_by: "private-member",
  };
  const result = await contextSetup({ day: { ...day, closure } })("week", scope);
  const text = result.facts.find((f) => f.id === "cash_reconciliation").text;
  assert.match(text, /Saved reconciliation for 2026-10-18/);
  assert.match(text, /variance -₦2\.00/);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("saved closing from a different day is rejected", async () => {
  await assert.rejects(
    contextSetup({
      day: {
        ...day,
        closure: {
          business_date: "2026-10-17",
          opening_cash: "0.00",
          expected_cash: "0.00",
          counted_cash: "0.00",
          cash_variance: "0.00",
        },
      },
    })("week", scope),
  );
});

test("POST action strictly validates before delegating to the server DAL", async () => {
  const stubs = {};
  for (const name of [
    "sales",
    "sale-schema",
    "expenses",
    "expense-schema",
    "day-closing",
    "day-closing-schema",
    "financial",
    "financial-schema",
    "stock-health",
    "actions",
    "action-schema",
    "inventory",
    "stock-receipts",
    "stock-receipt-schema",
    "products",
    "services",
    "packaging-units",
    "pharmacy-members",
    "pharmacy-invitations",
  ])
    stubs["./" + name] = {};
  const calls = [];
  stubs["./ask-ai-schema"] = loadTs("src/lib/data/ask-ai-schema.ts");
  stubs["./ask-ai"] = {
    askPharmaNudge: async (data) => {
      calls.push(data);
      return "response";
    },
  };
  stubs["@tanstack/react-start"] = {
    createServerFn: ({ method }) => {
      let validate = (value) => value;
      return {
        validator(fn) {
          validate = fn;
          return this;
        },
        handler(fn) {
          const action = async (input) => fn({ data: validate(input) });
          action.method = method;
          return action;
        },
      };
    },
  };
  const { askPharmaNudgeAction } = loadTs("src/lib/data/validation.ts", stubs);
  assert.equal(typeof askPharmaNudgeAction, "function");
  assert.equal(askPharmaNudgeAction.method, "POST");
  await assert.rejects(askPharmaNudgeAction({ ...input, pharmacyId: "attacker" }));
  assert.equal(calls.length, 0);
  assert.equal(await askPharmaNudgeAction(input), "response");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [input]);
});

function membershipClient(rows, { user = { id: scope.userId }, error = null } = {}) {
  const filters = [];
  const query = {
    select: () => query,
    eq: (field, value) => {
      filters.push([field, value]);
      return query;
    },
    then: (resolve) =>
      resolve({
        data: rows.filter((row) => filters.every(([field, value]) => row[field] === value)),
        error,
      }),
  };
  return {
    filters,
    auth: { getUser: async () => ({ data: { user }, error }) },
    from: (table) => {
      assert.equal(table, "pharmacy_members");
      return query;
    },
  };
}

test("real pharmacy membership resolver enforces active user, pharmacy and unambiguous membership", async () => {
  const { requirePharmacyContext } = loadTs("src/lib/pharmacy-context.ts", {
    "./auth/context": {},
    "./supabase/server": {},
  });
  const member = {
    user_id: scope.userId,
    pharmacy_id: scope.pharmacyId,
    role: "owner",
    is_active: true,
    "pharmacies.is_active": true,
  };
  for (const client of [
    membershipClient([]),
    membershipClient([{ ...member, is_active: false }]),
    membershipClient([{ ...member, "pharmacies.is_active": false }]),
    membershipClient([member, { ...member, pharmacy_id: "other" }]),
    membershipClient([member], { user: null }),
    membershipClient([member], { error: { message: "private" } }),
  ])
    await assert.rejects(requirePharmacyContext(client));
  const client = membershipClient([member]);
  const resolved = await requirePharmacyContext(client);
  assert.deepEqual(JSON.parse(JSON.stringify(resolved)), scope);
  assert.deepEqual(client.filters, [
    ["user_id", scope.userId],
    ["is_active", true],
    ["pharmacies.is_active", true],
  ]);
});

for (const options of [
  { changedScope: { ...scope, pharmacyId: "other" } },
  { changedScope: { ...scope, userId: "other" } },
  { changedScope: { ...scope, role: "cashier" } },
  { recheckThrows: true },
])
  test("authorization drift before reservation preserves facts without quota or model", async () => {
    const { askPharmaNudge, calls } = setup(options);
    const result = await askPharmaNudge(input);
    assert.equal(result.evidence, evidence);
    assert.equal(result.advice.status, "unavailable");
    assert.ok(!calls.some(Array.isArray));
    assert.ok(!calls.includes("provider"));
  });
