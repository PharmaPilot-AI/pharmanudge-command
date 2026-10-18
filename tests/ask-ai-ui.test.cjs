const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadTs } = require("./helpers/load-ts.cjs");
const componentPath = "src/components/ai/AskPharmaNudgePanel.tsx";
const router = {
  Link: ({ to, search, children, ...props }) => {
    const params = typeof search === "function" ? search({}) : search;
    return React.createElement(
      "a",
      { ...props, href: to + (params ? `?period=${params.period}` : "") },
      children,
    );
  },
};
const load = (stubs = {}) => loadTs(componentPath, { "@tanstack/react-router": router, ...stubs });
test("route is owner-only, has no automatic loader and wires the real manual action", () => {
  const submit = async () => response();
  const { Route } = loadTs("src/routes/ask-ai.tsx", {
    "@tanstack/react-router": {
      ...router,
      createFileRoute: () => (options) => options,
      redirect: (options) => ({ redirected: options.to }),
    },
    "@/lib/data/validation": { askPharmaNudgeAction: submit },
  });
  assert.equal(typeof Route.beforeLoad, "function");
  for (const role of ["accountant", "staff", undefined]) {
    assert.throws(
      () => Route.beforeLoad({ context: { pharmacyContext: role ? { role } : undefined } }),
      (error) => error.redirected === "/pos",
    );
  }
  assert.doesNotThrow(() => Route.beforeLoad({ context: { pharmacyContext: { role: "owner" } } }));
  assert.equal(Route.loader, undefined);
  const tree = Route.component();
  const panel = childrenOf(tree).find((node) => node.props?.submit);
  assert.equal(panel.props.submit, submit);
});

function childrenOf(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...React.Children.toArray(node.props?.children).flatMap(childrenOf)];
}

const response = (
  advice = {
    status: "available",
    advisory: {
      explanation: "<script>alert(1)</script> [click](https://evil.test)",
      recommendations: ["<img src=x onerror=alert(1)>"],
      fact_ids: ["sales", "missing", "https://evil.test"],
    },
  },
) => ({
  evidence: {
    period: "week",
    businessDate: "2026-10-18",
    retrievedAt: "2026-10-18T11:00:00.000Z",
    facts: [
      { id: "sales", text: "Sales: ₦500", source_label: "Reports", source_path: "/reports" },
      { id: "cash", text: "Cash: ₦300", source_label: "Money", source_path: "/money" },
    ],
    limitations: ["Recorded costs only."],
  },
  advice,
});

test("actual evidence render escapes advice, links only evidence, and retains response period", () => {
  const { AskPharmaNudgeEvidence } = load();
  const html = renderToStaticMarkup(
    React.createElement(AskPharmaNudgeEvidence, { response: response() }),
  );
  assert.match(html, /Database evidence/);
  assert.match(html, /AI advisory — not verified/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /href="https:|<script|<img/);
  assert.match(html, /href="\/reports\?period=week"/);
  assert.match(html, /href="\/money\?period=week"/);
  assert.match(html, /href="#ask-fact-0"/);
  assert.doesNotMatch(html, /href="#.*missing/);
  assert.match(html, /2026-10-18T11:00:00.000Z/);
  assert.match(html, /Stock.*current/);
  assert.match(html, /Recorded costs only/);
});

test("unavailable advice retains evidence with safe specific reasons, previous evidence hides advice", () => {
  const { AskPharmaNudgeEvidence } = load();
  for (const reason of ["configuration", "usage_limit", "rate_limit", "provider", "reservation"]) {
    const html = renderToStaticMarkup(
      React.createElement(AskPharmaNudgeEvidence, {
        response: response({ status: "unavailable", reason }),
      }),
    );
    assert.match(html, /Sales: ₦500/);
    assert.match(html, /role="status"/);
    assert.match(html, /no usable AI advisory is available/);
  }
  const old = renderToStaticMarkup(
    React.createElement(AskPharmaNudgeEvidence, { response: response(), previous: true }),
  );
  assert.match(old, /Previous evidence — not updated/);
  assert.doesNotMatch(old, /AI advisory|evil.test/);
});

test("initial manual form has accessible controls, privacy warning, and no automatic request", () => {
  const { AskPharmaNudgePanel } = load();
  let calls = 0;
  const html = renderToStaticMarkup(
    React.createElement(AskPharmaNudgePanel, {
      submit: () => {
        calls++;
      },
    }),
  );
  assert.equal(calls, 0);
  assert.match(html, /for="ask-question"/);
  assert.match(html, /maxLength="1000"/i);
  assert.match(html, /for="ask-period"/);
  assert.match(html, /value="today"/);
  assert.match(html, /value="week"/);
  assert.match(html, /value="month"/);
  assert.match(html, /patient|names/);
  assert.match(html, /emails/);
  assert.match(html, /clinical advice/);
  assert.match(html, /role="status"/);
});

// A tiny hook scheduler drives the actual component's event handlers without a browser,
// React test renderer, network or database. JSX and final HTML still use real React.
function panelHarness(submit) {
  const slots = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === "function" ? value(slots[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
  };
  const { AskPharmaNudgePanel } = load({ react: hooks });
  let tree;
  const harness = {
    render() {
      cursor = 0;
      tree = AskPharmaNudgePanel({ submit });
      return tree;
    },
    find(type, predicate = () => true) {
      return childrenOf(tree).find((node) => node.type === type && predicate(node.props));
    },
    html() {
      return renderToStaticMarkup(tree);
    },
  };
  harness.render();
  return harness;
}

test("suggestions and selection populate only; manual submit locks eagerly and disables every control", async () => {
  const calls = [];
  let resolve;
  const harness = panelHarness((options) => {
    calls.push(options);
    return new Promise((done) => {
      resolve = done;
    });
  });
  harness.find("button", (props) => props.type === "button").props.onClick();
  harness.render();
  assert.match(harness.find("textarea").props.value, /pharmacy/);
  harness.find("select").props.onChange({ target: { value: "week" } });
  harness.render();
  assert.equal(calls.length, 0);
  const send = harness.find("form").props.onSubmit;
  const first = send({ preventDefault() {} });
  const second = send({ preventDefault() {} });
  assert.equal(calls.length, 1, "second submit in the same React tick is ignored");
  assert.equal(calls[0].data.period, "week");
  harness.render();
  for (const node of childrenOf(harness.render()).filter((node) =>
    ["button", "textarea", "select"].includes(node.type),
  ))
    assert.equal(node.props.disabled, true);
  assert.equal(harness.find("form").props["aria-busy"], true);
  resolve(response());
  await Promise.all([first, second]);
  harness.render();
  assert.match(harness.html(), /Response ready/);
  assert.match(harness.html(), /Sales: ₦500/);
  harness.find("select").props.onChange({ target: { value: "month" } });
  harness.render();
  assert.match(harness.html(), /href="\/reports\?period=week"/);
  assert.equal(calls.length, 1);
});

test("transport failure preserves explicitly previous facts, removes old advice and hides raw errors", async () => {
  let calls = 0;
  const harness = panelHarness(async () => {
    if (calls++ === 0) return response();
    throw new Error("SECRET PROVIDER BODY: api_key=do-not-show");
  });
  harness.find("textarea").props.onChange({ target: { value: "Review cash" } });
  harness.render();
  await harness.find("form").props.onSubmit({ preventDefault() {} });
  harness.render();
  assert.match(harness.html(), /AI advisory/);
  await harness.find("form").props.onSubmit({ preventDefault() {} });
  harness.render();
  const html = harness.html();
  assert.match(html, /role="alert"/);
  assert.match(html, /Previous evidence — not updated/);
  assert.match(html, /Sales: ₦500/);
  assert.doesNotMatch(html, /AI advisory|evil.test|SECRET|api_key/);
  assert.equal(harness.find("form").props["aria-busy"], false);
});

test("blank and oversized questions do not reach the action", async () => {
  let calls = 0;
  const harness = panelHarness(async () => {
    calls++;
    return response();
  });
  for (const value of ["  ", "a".repeat(1001)]) {
    harness.find("textarea").props.onChange({ target: { value } });
    harness.render();
    await harness.find("form").props.onSubmit({ preventDefault() {} });
    harness.render();
    assert.match(harness.html(), /Enter a business question/);
  }
  assert.equal(calls, 0);
});
