import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { test } from 'node:test';

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
async function modules(client, role = 'owner', session = { accessToken: 'dummy' }) {
  const cache = new Map();
  async function get(path) {
    if (cache.has(path)) return cache.get(path);
    const source = await readFile(new URL(`../src/lib/data/${path}.ts`, import.meta.url), 'utf8');
    const m = new SourceTextModule(stripTypeScriptTypes(source), { identifier: path });
    cache.set(path, m);
    await m.link(async spec => {
      if (spec === './catalogue-pages' || spec === './products') return get(spec.slice(2));
      let exports = {};
      if (spec.includes('auth/context')) exports = { resolveSessionUser: async () => session };
      else if (spec.includes('pharmacy-context')) exports = { requirePharmacyContext: async () => ({ pharmacyId: 'tenant-a', role }) };
      else if (spec.includes('supabase/server')) exports = { createServerSupabaseClient: () => client };
      else if (spec.includes('-schema')) exports = { saleSchema: {}, stockReceiptSchema: {} };
      else assert.equal(spec, '@tanstack/react-start/server-only');
      const s = new SyntheticModule(Object.keys(exports), function () {
        for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
      });
      return s;
    });
    return m;
  }
  return async path => { const m = await get(path); if (m.status !== 'evaluated') await m.evaluate(); return m.namespace; };
}

function fakeClient(count = 1205, cap = 73, fail = false, omitStock = false) {
  const calls = [];
  const datasets = {
    products: Array.from({ length: count }, (_, i) => ({ id: id(i + 1), name: `Product ${i}`, is_active: true, pharmacy_id: 'tenant-a', cost_per_base_unit: 'SECRET-COST' })),
    packaging_units: Array.from({ length: count }, (_, i) => ({ id: id(i + 1), product_id: id(i + 1), label: 'Tablet', base_units_per_unit: 1, price: 50, is_active: true, products: { pharmacy_id: 'tenant-a', is_active: true } })),
    services: Array.from({ length: count }, (_, i) => ({ id: id(i + 1), name: `Service ${i}`, price: 20, is_active: true, pharmacy_id: 'tenant-a' })),
    list_pharmacy_inventory: Array.from({ length: count }, (_, i) => ({ product_id: id(i + 1), available_quantity: '17', stock_value: 'SECRET-COST' })),
  };
  function query(table, args) {
    const state = { table, args, filters: [], gt: null, order: null, limit: Infinity, select: '*' };
    const q = {
      select: value => { state.select = value; return q; },
      eq: (key, value) => { state.filters.push([key, value]); return q; },
      gt: (key, value) => { state.gt = [key, value]; return q; },
      order: key => { state.order = key; return q; },
      limit: value => { state.limit = value; return q; },
      then: (ok, bad) => Promise.resolve().then(() => {
        calls.push(state);
        if (fail && state.gt) return { data: null, error: new Error('synthetic') };
        const source = omitStock && table === 'list_pharmacy_inventory' ? [] : datasets[table];
        const rows = source.filter(row => !state.gt || row[state.gt[0]] > state.gt[1]).slice(0, Math.min(cap, state.limit));
        return { error: null, data: rows.map(row => state.select === '*' || state.select.startsWith('*,') || table.startsWith('list_') ? { ...row } : Object.fromEntries(state.select.split(',').map(k => k.trim()).filter(k => k in row).map(k => [k, row[k]]))) };
      }).then(ok, bad),
    };
    return q;
  }
  return { from: table => query(table), rpc: (name, args) => query(name, args), calls };
}

test('all catalogue loaders exceed default row cap and preserve every page tenant filter', async () => {
  for (const [path, method, args] of [['products', 'listProducts', []], ['services', 'listServices', []], ['packaging-units', 'listPackagingUnitsForProduct', [id(1)]]]) {
    const c = fakeClient(); const load = await modules(c); const mod = await load(path);
    const rows = await mod[method](...args, c);
    assert.equal(rows.length, 1205);
    assert.equal(new Set(rows.map(r => r.id)).size, 1205);
    for (const call of c.calls) {
      assert.equal(call.order, 'id'); assert.equal(call.limit, 200);
      assert.ok(call.filters.some(([k, v]) => k.endsWith('pharmacy_id') && v === 'tenant-a'));
      assert.ok(call.filters.some(([k, v]) => k === 'is_active' && v === true));
    }
  }
});

test('POS loads products, units, services and inventory beyond cap without cost leakage', async () => {
  const c = fakeClient(); const load = await modules(c); const { getPosCatalogue } = await load('sales');
  const result = await getPosCatalogue();
  assert.equal(result.products.length, 1205); assert.equal(result.services.length, 1205);
  assert.ok(result.products.every(p => p.available_quantity === '17' && p.units.length === 1));
  assert.ok(!JSON.stringify(result).includes('SECRET-COST'));
  for (const call of c.calls) {
    if (call.table === 'list_pharmacy_inventory') assert.equal(call.args.target_pharmacy_id, 'tenant-a');
    else assert.ok(call.filters.some(([k, v]) => k.endsWith('pharmacy_id') && v === 'tenant-a'));
  }
});

test('receiving loads products and units beyond cap and strips join metadata', async () => {
  const c = fakeClient(); const load = await modules(c); const { getStockReceiptCatalogue } = await load('stock-receipts');
  const result = await getStockReceiptCatalogue();
  assert.equal(result.products.length, 1205); assert.equal(result.units.length, 1205);
  assert.ok(result.units.every(u => !('products' in u)));
});

test('later-page errors reject complete POS load instead of returning partial stock', async () => {
  const c = fakeClient(401, 200, true); const load = await modules(c);
  await assert.rejects((await load('sales')).getPosCatalogue(), /complete catalogue/);
});

test('missing inventory rejects catalogue instead of inventing zero availability', async () => {
  const c = fakeClient(3, 200, false, true); const load = await modules(c);
  await assert.rejects((await load('sales')).getPosCatalogue(), /Inventory changed/);
});

test('POS denies missing sessions and accountant before querying', async () => {
  for (const [role, session] of [['accountant', { accessToken: 'dummy' }], ['owner', null]]) {
    const c = fakeClient(); const load = await modules(c, role, session);
    await assert.rejects((await load('sales')).getPosCatalogue()); assert.equal(c.calls.length, 0);
  }
});

test('receiving denies cashier before querying', async () => {
  const c = fakeClient(); const load = await modules(c, 'cashier');
  await assert.rejects((await load('stock-receipts')).getStockReceiptCatalogue()); assert.equal(c.calls.length, 0);
});

test('empty catalogue, exact page boundary and lower server caps terminate only on empty page', async () => {
  const load = await modules({}); const { loadCatalogueRows } = await load('catalogue-pages');
  for (const [count, cap] of [[0, 200], [200, 200], [401, 7]]) {
    const source = Array.from({ length: count }, (_, i) => ({ id: id(i + 1) })); let calls = 0;
    const result = await loadCatalogueRows(async after => { calls++; return { data: source.filter(r => !after || r.id > after).slice(0, cap), error: null }; }, r => r.id);
    assert.equal(result.length, count); assert.equal(calls, Math.ceil(count / cap) + 1);
  }
});

test('duplicate, unordered, malformed, null and overlarge responses fail closed', async () => {
  const load = await modules({}); const { loadCatalogueRows } = await load('catalogue-pages');
  for (const data of [[{ id: id(2) }, { id: id(1) }], [{ id: id(1) }, { id: id(1) }], [{ id: 'invalid' }], null, Array.from({ length: 201 }, (_, i) => ({ id: id(i + 1) }))]) {
    await assert.rejects(loadCatalogueRows(async () => ({ data, error: null }), r => r.id));
  }
  await assert.rejects(loadCatalogueRows(async () => ({ data: [{ id: id(1) }], error: null }), r => r.id), /ordering/);
});

test('catalogue memory bound rejects rather than silently returning truncated rows', async () => {
  const load = await modules({}); const { loadCatalogueRows } = await load('catalogue-pages');
  let calls = 0;
  await assert.rejects(loadCatalogueRows(async after => {
    calls++; const start = after ? Number(after.slice(-12)) + 1 : 1;
    return { data: Array.from({ length: 200 }, (_, i) => ({ id: id(start + i) })), error: null };
  }, r => r.id), /loading limit/);
  assert.equal(calls, 501);
});
