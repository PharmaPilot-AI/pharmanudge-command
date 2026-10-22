import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const plain = (value) => JSON.parse(JSON.stringify(value));

// Executes reviewed application source, with auth/storage/RPC effects explicitly simulated.
function application(overrides) {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const source = readFileSync(new URL(`../src/lib/data/${name}.ts`, import.meta.url), "utf8");
    const module = { exports: {} };
    cache.set(name, module.exports);
    const importer = (spec) => {
      if (spec in overrides) return overrides[spec];
      if (spec === "zod") return require("zod");
      if (["./stock-receipt-schema", "./catalogue-pages", "./products"].includes(spec))
        return load(spec.slice(2));
      assert.fail(`Unapproved integration-fixture dependency: ${spec}`);
    };
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: importer });
    return module.exports;
  }
  return load;
}

function mutationDeclaration() {
  const source = readFileSync(new URL("../src/lib/data/validation.ts", import.meta.url), "utf8");
  const file = ts.createSourceFile("validation.ts", source, ts.ScriptTarget.Latest, true);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(
      (d) => d.name.getText(file) === "confirmStockReceiptMutation",
    );
    if (declaration) return declaration.initializer.getText(file);
  }
  assert.fail("Stock receipt POST declaration is missing");
}

// Controlled server-function boundary; this is not an HTTP/TanStack runtime test.
function action(expression, schemas, confirmStockReceipt) {
  let method;
  const createServerFn = (options) => {
    method = options.method;
    return {
      validator: (validate) => ({
        handler:
          (handle) =>
          async ({ data }) =>
            handle({ data: validate(data) }),
      }),
    };
  };
  const code = ts.transpileModule(`const result = ${expression}; module.exports = result;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, ...schemas, confirmStockReceipt, createServerFn });
  return { invoke: module.exports, method };
}

test("combined outbox, actual POST validator and server handler retain scope/reference across an uncertain reply", async () => {
  const scope = { pharmacyId: id(1), userId: id(2) };
  let actor = { ...scope, role: "owner" },
    loseReply = true,
    rpcCalls = 0,
    effects = 0;
  const values = new Map(),
    receipts = new Map();
  const store = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  let outbox;
  const client = {
    async rpc(name, args) {
      rpcCalls++;
      assert.equal(name, "confirm_stock_receipt");
      const saved = JSON.parse(values.get(outbox.key));
      assert.equal(args.target_pharmacy_id, scope.pharmacyId);
      assert.equal(args.operation_id, saved.request.operation_id);
      assert.equal(args.receipt_supplier, saved.request.supplier_name);
      assert.deepEqual(plain(args.receipt_items), saved.request.items);
      // In-memory effect model only: not evidence about real SQL locking/RLS/idempotency.
      if (!receipts.has(args.operation_id)) {
        receipts.set(args.operation_id, id(6));
        effects++;
      }
      if (loseReply) {
        loseReply = false;
        throw new Error("Synthetic reply lost after model effect");
      }
      return { data: receipts.get(args.operation_id), error: null };
    },
  };
  const load = application({
    "@tanstack/react-start/server-only": {},
    "../auth/context": { resolveSessionUser: async () => ({ accessToken: "synthetic" }) },
    "../pharmacy-context": { requirePharmacyContext: async () => actor },
    "../supabase/server": { createServerSupabaseClient: () => client },
  });
  const schemas = load("stock-receipt-schema");
  const { ReceiptRecovery } = load("pending-stock-receipt");
  const { confirmStockReceipt } = load("stock-receipts");
  const declaration = mutationDeclaration();
  const endpoint = action(declaration, schemas, confirmStockReceipt);
  assert.equal(endpoint.method, "POST");
  const draft = {
    supplier_name: "Synthetic integration supplier",
    invoice_reference: "Fixture",
    items: [
      {
        product_id: id(3),
        packaging_unit_id: id(4),
        quantity: 2,
        cost_per_packaging_unit: 5,
        batch_number: "Fixture",
        expiry_date: "2099-12-31",
      },
    ],
  };
  const envelope = { version: 1, ...scope, request: { ...draft, operation_id: id(5) } };
  await assert.rejects(endpoint.invoke({ data: envelope.request }));
  assert.equal(rpcCalls, 0, "Legacy unscoped input must fail validation before handler effects");
  const broken = declaration.replace(
    "receiptSubmissionSchema.parse(input)",
    "stockReceiptSchema.parse(input)",
  );
  assert.notEqual(broken, declaration);
  await assert.rejects(action(broken, schemas, confirmStockReceipt).invoke({ data: envelope }));
  assert.equal(rpcCalls, 0, "Negative control catches client/validator disagreement");
  outbox = new ReceiptRecovery(
    scope,
    () => store,
    () => id(5),
  );
  outbox.recover();
  await assert.rejects(
    outbox.submit(draft, (data) => endpoint.invoke({ data })),
    /reply lost/,
  );
  const frozen = values.get(outbox.key);
  outbox = new ReceiptRecovery(
    scope,
    () => store,
    () => id(99),
  );
  outbox.recover();
  actor = { ...scope, userId: id(8), role: "owner" };
  await assert.rejects(
    outbox.submit(undefined, (data) => endpoint.invoke({ data })),
    /different user or pharmacy/,
  );
  assert.equal(rpcCalls, 1);
  assert.equal(values.get(outbox.key), frozen);
  actor = { ...scope, role: "owner" };
  assert.equal(await outbox.submit(undefined, (data) => endpoint.invoke({ data })), id(6));
  assert.equal(rpcCalls, 2);
  assert.equal(effects, 1);
  assert.equal(values.get(outbox.key), frozen);
  outbox.startAnother();
  assert.equal(values.size, 0);
});
