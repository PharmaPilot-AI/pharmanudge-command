import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const draft = n => read(`docs/drafts/opening-stock-${n}.sql`);
const body = (s, name) => s.split(`create function public.${name}(`)[1]?.split('as $opening$')[1]?.split('$opening$;')[0];

test('review package exists, transaction bounded, not executable migrations', () => {
  for (const n of ['MIGRATION', 'VERIFY', 'RECOVERY']) {
    const p = `docs/drafts/opening-stock-${n}.sql`;
    assert.ok(existsSync(new URL(p, root)), `${p} missing`);
    const s = read(p);
    assert.match(s, /REVIEW ONLY.*NATIVE.*UNQUALIFIED/);
    assert.match(s, /begin;/i); assert.match(s, /commit;/i);
    assert.doesNotMatch(s, /\bCASCADE\b|alter default privileges/i);
  }
  assert.match(read('docs/drafts/opening-stock-SQL-README.md'), /not executed/i);
});
test('old migration bytes remain exactly base c9c6523', () => {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', 'c9c6523', 'supabase/migrations'], {cwd: root}).toString().trim().split('\n');
  for (const p of files) assert.equal(read(p), execFileSync('git', ['show', `c9c6523:${p}`], {cwd: root}).toString(), p);
});
test('opening metadata tenant FKs, unique identity and private tables', () => {
  const s = draft('MIGRATION');
  for (const n of ['opening_stock_receipts', 'opening_stock_lots']) {
    assert.match(s, new RegExp(`create table public\\.${n}`));
    assert.match(s, new RegExp(`alter table public\\.${n} enable row level security`));
  }
  assert.match(s, /unique \(pharmacy_id, operation_id\)/);
  assert.match(s, /unique \(pharmacy_id, internal_lot_reference\)/);
  assert.match(s, /references public.stock_receipts\(pharmacy_id, id\) on delete restrict/);
  assert.match(s, /references public.stock_batches\(pharmacy_id, id, product_id\) on delete restrict/);
  assert.match(s, /references public.stock_receipt_items\(pharmacy_id, id, product_id\) on delete restrict/);
  assert.doesNotMatch(s, /create policy/i);
});
test('writer exact retry precedes date validation and delegates unchanged receipt RPC', () => {
  const s = body(draft('MIGRATION'), 'confirm_opening_stock'); assert.ok(s);
  assert.ok(s.indexOf('return v_existing.receipt_id') < s.indexOf('physical_count_date > v_today'));
  assert.match(s, /v_existing.actor_user_id is distinct from v_actor/);
  assert.match(s, /v_existing.request_payload is distinct from v_payload/);
  assert.match(s, /Operation reference belongs to a non-opening receipt/);
  assert.match(s, /for update/); assert.match(s, /m.role in \('owner', 'pharmacist'\)/);
  assert.match(s, /public.confirm_stock_receipt\(/);
  assert.match(s, /Opening stock — physical count/);
  assert.match(s, /Opening count /);
  assert.match(s, /v_now at time zone 'Africa\/Lagos'/);
  assert.doesNotMatch(s, /insert into public\.(expenses|payments|debts|stock_batches|stock_movements)/);
});
test('strict original item schema, explicit cost, real dates and exclusive month cutoff', () => {
  const s = body(draft('MIGRATION'), 'confirm_opening_stock');
  assert.match(s, /v_line - v_keys <> '\{\}'::jsonb/);
  assert.match(s, /v_line \?& v_keys/);
  assert.match(s, /jsonb_typeof\(v_line->'batch_unknown'\) is distinct from 'boolean'/);
  assert.match(s, /jsonb_typeof\(v_line->'manufacturer_batch'\) not in \('string', 'null'\)/);
  assert.match(s, /v_cost <= 0/); assert.match(s, /make_date\(v_year, v_month, v_day\)/);
  assert.match(s, /interval '1 month'/); assert.match(s, /v_cutoff <= v_today/);
  assert.match(s, /length\(v_ref\) not between 1 and 50/);
  assert.match(s, /manufacturer batch unknown/); assert.match(s, /manufacturer batch recorded/);
  assert.match(s, /v_quantity <> round\(v_quantity, 6\)/);
  assert.match(s, /v_cost <> round\(v_cost, 6\)/);
});
test('keyset reader active any-role tenant gate and bounded unique batch cursor', () => {
  const s = draft('MIGRATION'); const b = body(s, 'list_opening_stock_lot_metadata');
  assert.match(s, /after_batch_id uuid default null,[\s\S]*page_limit integer default 250/i);
  assert.match(b, /page_limit not between 1 and 250/);
  assert.match(b, /m.is_active = true/); assert.match(b, /p.is_active = true/);
  assert.doesNotMatch(b, /m.role/);
  assert.match(b, /l.batch_id > after_batch_id/); assert.match(b, /order by l.batch_id/);
  assert.match(b, /limit page_limit/);
});
test('new RPC ACLs strict and action wording guarded by exact original source', () => {
  const s = draft('MIGRATION');
  assert.match(s, /p.prosrc is distinct from \$baseline_action\$/);
  assert.match(s, /Stock lot /); assert.match(s, /stop-sale date/);
  assert.match(s, /proacl/); assert.match(s, /proowner/);
  for (const name of ['confirm_opening_stock', 'list_opening_stock_lot_metadata']) {
    assert.match(s, new RegExp(`revoke all on function public\\.${name}[^;]+from public, anon, authenticated, service_role`, 'i'));
    assert.match(s, new RegExp(`alter function public\\.${name}[^;]+owner to postgres`, 'i'));
  }
  assert.doesNotMatch(s, /create or replace function public.confirm_stock_receipt/);
});
test('catalog-only verifier and data-present failclosed recovery', () => {
  const v = draft('VERIFY'); const r = draft('RECOVERY');
  assert.match(v, /set transaction read only/i);
  assert.doesNotMatch(v, /(?:perform|select) public\.(confirm_|list_|get_)/i);
  assert.match(v, /aclexplode/); assert.match(v, /pg_constraint/); assert.match(v, /pg_policy/);
  assert.match(r, /if exists \(select 1 from public.opening_stock_receipts\)/);
  assert.match(r, /if exists \(select 1 from public.opening_stock_lots\)/);
  assert.match(r, /Forward recovery required/);
  assert.doesNotMatch(r, /\bdelete\s+from|(?:^|;)\s*truncate\s/im);
  assert.match(r, /drop table public.opening_stock_lots restrict/);
  assert.match(r, /\$forward_action\$/);
});

test('complete source pins match and Action Center only changes wording', () => {
  const m=draft('MIGRATION'),v=draft('VERIFY'),r=draft('RECOVERY');
  const extract=(s,tag)=>s.split(`$${tag}$`)[1];
  for(const name of ['confirm_opening_stock','list_opening_stock_lot_metadata'])
    for(const s of [m,v,r]) assert.equal(extract(s,`pin_${name}`),body(m,name));
  const original=read('supabase/migrations/20261015164000_pharmacy_action_candidates.sql').split('as $$')[1].split('$$;')[0];
  const forward=original.replaceAll("'Batch '","'Stock lot '").replaceAll("' expires on '","' has stop-sale date '")
    .replaceAll("' has expired stock'","' has stock past its stop-sale date'")
    .replaceAll("' has stock expiring within 30 days'","' has stock reaching its stop-sale date within 30 days'")
    .replaceAll("'. Review the batch and plan an appropriate stock action.'","'. Review the stock lot and plan an appropriate stock action.'");
  assert.equal(extract(m,'baseline_action'),original);
  assert.equal(extract(m,'action_body'),forward); assert.equal(extract(r,'action_body'),original);
  for(const s of [m,v,r]) assert.equal(extract(s,'forward_action'),forward);
  const receipt=read('supabase/migrations/20261007204500_confirm_stock_receipt.sql').split('as $$')[1].split('$$;')[0];
  assert.equal(extract(m,'delivery_source'),receipt);
  for(const s of [m,r]) {
    const g=s.split('do $action_guard$')[1].split('$action_guard$;')[0];
    assert.match(g,/p.proparallel <> 'u'/);
    assert.match(g,/p.proisstrict or p.proleakproof/);
    assert.match(g,/p.procost <> 100/); assert.match(g,/p.prorows <> 1000/);
    assert.match(g,/p.prosupport <> 0/);
  }
});
test('all recovery drops follow empty-data guards and catalog pins stay synchronized', () => {
  const m=draft('MIGRATION'),v=draft('VERIFY'),r=draft('RECOVERY');
  const g=s=>s.split('do $catalog_pin$')[1].split('$catalog_pin$;')[0];
  assert.equal(g(m),g(v)); assert.equal(g(v),g(r));
  assert.ok(r.indexOf('$unused_only$;')<r.indexOf('drop function'));
  assert.match(m,/Trusted postgres executor required/); assert.match(m,/New opening objects must be absent/);
  assert.match(v,/Unexpected opening column default\/generated\/ACL state/);
  assert.match(v,/Exact opening constraints drift/);
  assert.match(v,/Unexpected effective direct API table rights/);
  assert.match(v,/Unexpected effective API RPC privileges/);
  const old=read('supabase/migrations/20261007204500_confirm_stock_receipt.sql');
  assert.equal(createHash('sha256').update(old).digest('hex'),'824cb65e6a46937dc4b3a3a2d2f2679f56d4d353430129cfa8fd08f59a753156');
});

test('new catalog security pins include support hooks, cost and row estimates', () => {
  for(const name of ['MIGRATION','VERIFY','RECOVERY']) {
    const s=draft(name).split('do $catalog_pin$')[1].split('$catalog_pin$;')[0];
    assert.match(s,/p.prosupport = 0 and p.procost = 100/);
    assert.match(s,/p.prorows = case when p.proretset then 1000 else 0 end/);
    assert.match(s,/a.attcollation <> case when a.atttypid = 'text'::regtype/);
  }
});
