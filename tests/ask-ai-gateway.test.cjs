const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadTs } = require("./helpers/load-ts.cjs");

const evidence = {
  period: "today",
  businessDate: "2026-10-18",
  retrievedAt: "2026-10-18T12:00:00.000Z",
  facts: [
    {
      id: "sales",
      text: "Recorded sales: ₦9,007,199,254,740,993.01.",
      source_label: "Reports",
      source_path: "/reports",
    },
  ],
  limitations: ["Recorded transactions only; no previous-period comparison."],
};
const advisory = {
  explanation: "Recorded sales are shown above.",
  recommendations: ["Review your source report."],
  fact_ids: ["sales"],
};
function envelope(value = advisory) {
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] };
}
function gateway(
  env = {},
  fetch = async () => new Response(JSON.stringify(envelope())),
  globals = {},
) {
  return loadTs("src/lib/data/ask-ai-gateway.ts", {}, { process: { env }, fetch, ...globals });
}

test("missing key or an unsupported model is configuration, with no provider call", async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return new Response(JSON.stringify(envelope()));
  };
  for (const env of [
    {},
    { LOVABLE_API_KEY: "   " },
    { LOVABLE_API_KEY: "fixture-key", APP_AI_MODEL: "unreviewed/model" },
  ]) {
    const module = gateway(env, fetch);
    assert.equal(module.isPharmaNudgeConfigured(), false);
    const result = await module.requestPharmaNudgeAdvice("Summarize sales", evidence);
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "configuration");
  }
  assert.equal(calls, 0);
});

test("oversized headers or streamed bodies fail closed before accepting advice", async () => {
  for (const oversized of [
    () => new Response(JSON.stringify(envelope()), { headers: { "content-length": "999999" } }),
    () => new Response(JSON.stringify({ ...envelope(), padding: "x".repeat(40000) })),
  ]) {
    let calls = 0;
    const module = gateway({ LOVABLE_API_KEY: "fixture-key" }, async () => {
      calls++;
      return oversized();
    });
    const result = await module.requestPharmaNudgeAdvice("Summarize sales", evidence);
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "provider");
    assert.equal(calls, 1);
  }
});

test("provider payload contains only authorized aggregate evidence and exact decimal text", async () => {
  let payload;
  const module = gateway({ LOVABLE_API_KEY: "fixture-key" }, async (_url, init) => {
    payload = JSON.parse(init.body);
    return new Response(JSON.stringify(envelope()));
  });
  const privateContext = {
    ...evidence,
    member_name: "FixtureMember",
    member_email: "fixture@example.invalid",
    patient_data: "NEVER_SEND_FIXTURE",
  };
  const result = await module.requestPharmaNudgeAdvice("Summarize sales", privateContext);
  assert.equal(result.status, "available");
  assert.equal(payload.model, "google/gemini-3-flash-preview");
  assert.equal(payload.stream, false);
  const provided = JSON.parse(payload.messages[1].content);
  assert.deepEqual(provided.facts, [{ id: "sales", text: evidence.facts[0].text }]);
  assert.equal(provided.facts[0].text.includes("9,007,199,254,740,993.01"), true);
  assert.equal(JSON.stringify(payload).includes("FixtureMember"), false);
  assert.equal(JSON.stringify(payload).includes("fixture@example.invalid"), false);
  assert.equal(JSON.stringify(payload).includes("NEVER_SEND_FIXTURE"), false);
});

test("extra private fields inside a fact are rejected before any provider call", async () => {
  let calls = 0;
  const module = gateway({ LOVABLE_API_KEY: "fixture-key" }, async () => {
    calls++;
    return new Response(JSON.stringify(envelope()));
  });
  const result = await module.requestPharmaNudgeAdvice("Summarize sales", {
    ...evidence,
    facts: [{ ...evidence.facts[0], member_email: "fixture@example.invalid" }],
  });
  assert.equal(result.status, "unavailable");
  assert.equal(calls, 0);
});

test("overlarge multibyte request payload is rejected without invoking the provider", async () => {
  let calls = 0;
  const module = gateway({ LOVABLE_API_KEY: "fixture-key" }, async () => {
    calls++;
    return new Response(JSON.stringify(envelope()));
  });
  const large = {
    ...evidence,
    facts: Array.from({ length: 30 }, (_, i) => ({
      ...evidence.facts[0],
      id: "fact_" + i,
      text: "₦".repeat(1000),
    })),
  };
  const result = await module.requestPharmaNudgeAdvice("Summarize sales", large);
  assert.equal(result.status, "unavailable");
  assert.equal(calls, 0);
});

test("raw free-text identifiers never leave the server; only static business topics do", async () => {
  let content;
  let options;
  const module = gateway({ LOVABLE_API_KEY: "fixture-key" }, async (_url, init) => {
    options = init;
    content = JSON.parse(init.body).messages[1].content;
    return new Response(JSON.stringify(envelope()));
  });
  await module.requestPharmaNudgeAdvice(
    "How did Jane Smith perform? Discuss sales and cash for Pat Jones.",
    evidence,
  );
  assert.doesNotMatch(content, /Jane|Smith|Pat Jones|How did/);
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
  const value = JSON.parse(content);
  assert.equal(value.question, undefined);
  assert.ok(value.business_topics.includes("financial_performance"));
  assert.ok(value.business_topics.includes("cash_reconciliation"));
});

test("deadline bounds even a non-cooperating fetch or stalled body, without retry", async () => {
  for (const mode of ["fetch", "body"]) {
    let calls = 0;
    let signal;
    let cancelled = false;
    const delays = [];
    const module = gateway(
      { LOVABLE_API_KEY: "fixture-key" },
      async (_url, init) => {
        calls++;
        signal = init.signal;
        if (mode === "fetch") return new Promise(() => {});
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        );
      },
      {
        setTimeout(callback, milliseconds) {
          delays.push(milliseconds);
          return setTimeout(callback, 1);
        },
        clearTimeout,
      },
    );
    const result = await Promise.race([
      module.requestPharmaNudgeAdvice("Summarize sales", evidence),
      new Promise((resolve) => setTimeout(() => resolve({ status: "unbounded-fixture" }), 150)),
    ]);
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "provider");
    assert.equal(calls, 1);
    assert.equal(signal.aborted, true);
    assert.equal(delays[0], 30000);
    if (mode === "body") assert.equal(cancelled, true);
  }
});

test("provider errors map to static fallbacks and never retry or expose raw errors", async () => {
  for (const [status, expectedReason] of [
    [402, "usage_limit"],
    [429, "rate_limit"],
    [500, "provider"],
  ]) {
    let calls = 0;
    const module = gateway({ LOVABLE_API_KEY: "fixture-key" }, async () => {
      calls++;
      return new Response("FIXTURE_PRIVATE_PROVIDER_OUTPUT", { status });
    });
    const result = await module.requestPharmaNudgeAdvice("Summarize sales", evidence);
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, expectedReason);
    assert.equal(JSON.stringify(result).includes("FIXTURE_PRIVATE"), false);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const module = gateway({ LOVABLE_API_KEY: "fixture-key" }, async () => {
    calls++;
    throw new Error("FIXTURE_PRIVATE_EXCEPTION");
  });
  const result = await module.requestPharmaNudgeAdvice("Summarize sales", evidence);
  assert.equal(result.reason, "provider");
  assert.equal(JSON.stringify(result).includes("FIXTURE_PRIVATE"), false);
  assert.equal(calls, 1);
});

test("malformed/truncated advisory and unknown fact IDs are rejected without a fake answer", async () => {
  const invalid = [
    "not json",
    JSON.stringify({ choices: [] }),
    JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: JSON.stringify(advisory) } }],
    }),
    JSON.stringify(envelope({ ...advisory, fact_ids: ["unknown_fact"] })),
    JSON.stringify(envelope({ ...advisory, extra: "unreviewed" })),
    JSON.stringify(envelope({ ...advisory, explanation: "x".repeat(3001) })),
    JSON.stringify(envelope({ ...advisory, recommendations: ["x".repeat(801)] })),
    new Uint8Array([255]),
  ];
  for (const body of invalid) {
    let calls = 0;
    const module = gateway({ LOVABLE_API_KEY: "fixture-key" }, async () => {
      calls++;
      return new Response(body);
    });
    const result = await module.requestPharmaNudgeAdvice("Summarize sales", evidence);
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "provider");
    assert.equal("advisory" in result, false);
    assert.equal(calls, 1);
  }
});
