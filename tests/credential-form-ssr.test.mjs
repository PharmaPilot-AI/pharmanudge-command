import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

// Use the project's existing dependencies; no browser, app server, auth or network.
const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(
  new URL("../src/components/CredentialForm.tsx", import.meta.url),
  "utf8",
);

function loadForm(text = source) {
  const { outputText, diagnostics } = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  runInNewContext(outputText, { module, exports: module.exports, require });
  return module.exports.CredentialForm;
}

function render(Form, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      Form,
      props,
      React.createElement("input", { type: "email", name: "email" }),
      React.createElement("input", { type: "password", name: "password" }),
      React.createElement("button", { type: "submit" }, "Submit"),
    ),
  );
}

function assertProtected(html) {
  assert.match(html, /^<form[^>]*method="post"/);
  assert.match(
    html,
    /<fieldset\b[^>]*\bdisabled=""[^>]*>[\s\S]*name="email"[\s\S]*name="password"[\s\S]*type="submit"[\s\S]*<\/fieldset>/,
  );
  assert.match(
    html,
    /<noscript><p role="alert">Enable JavaScript to securely submit this form\.<\/p><\/noscript>/,
  );
}

test("real CredentialForm SSR disables credential entry and declares POST before effects run", () => {
  assertProtected(render(loadForm()));
});

test("runtime caller props cannot override the credential POST method", () => {
  assertProtected(render(loadForm(), { method: "get", className: "fixture" }));
});

test("SSR regression assertions catch disabled-fieldset and POST-method removal", () => {
  for (const [before, after] of [
    ["disabled={!hydrated}", "disabled={false}"],
    ['method="post"', 'method="get"'],
  ]) {
    const mutant = source.replace(before, after);
    assert.notEqual(mutant, source);
    assert.throws(() => assertProtected(render(loadForm(mutant))), assert.AssertionError);
  }
});
