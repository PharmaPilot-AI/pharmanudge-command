# Opening stock — additive SQL review package

**REVIEW ONLY / NATIVE POSTGRESQL UNQUALIFIED. SQL was not executed against any database.**
Base: `c9c6523d0aec487343738278772bb9675296de49`. These files deliberately live outside `supabase/migrations`; do not feed them to migration automation or paste them into a hosted editor without separate approval.

## Scope and contracts

- `opening-stock-MIGRATION.sql`: one atomic, absence-guarded transaction; new private metadata tables, opening writer and bounded metadata reader; guarded Action Center wording-only replacement.
- `opening-stock-VERIFY.sql`: bounded read-only catalog assertions and metadata output, **no application RPC invocation** and no customer/auth/stock row reads.
- `opening-stock-RECOVERY.sql`: only unused/empty recovery. Locks pharmacy rows and both new tables, requires exact forward source/security/ACL/column/constraint pins, aborts if either metadata table has rows, restores the exact original Action Center body while preserving its owner/ACL, and uses only `RESTRICT` drops. It never removes receipts, movements or costs.
- `tests/opening-stock-sql.test.mjs`: offline source/contract tests; base migration byte comparisons. They do not emulate PostgreSQL or prove native authorization/atomicity.

No existing migration, delivery RPC, shared grant/default privilege or old signature is changed. `confirm_stock_receipt` is wrapped, not replaced; its complete original `prosrc` is an exact forward precondition. The Action Center declaration/signature/security and complete original body are pinned before replacement. Its only differences are display literals: stock lot and stop-sale date terminology; comparisons, date arithmetic, source snapshots, membership checks and calls are unchanged. Its OID, effective ACL and owner are retained through `CREATE OR REPLACE` and asserted unchanged in the same transaction. Existing Action Center permissions are neither narrowed nor broadened.

## Data design

`opening_stock_receipts` retains the original full request JSONB (tenant, operation, physical count date and original item array), original actor and receipt identity. Request equality is JSONB equality: insignificant object-key order/number spelling is not byte preservation, while original strings, null values and array order are retained. Tenant-scoped operation uniqueness and the old receipt operation namespace prevent normal receipt references being reused for openings.

`opening_stock_lots` retains internal reference, explicit unknown flag, separate full manufacturer batch, original expiry label/precision and effective exclusive stop-sale date. **Additional `product_id` is intentional**: the existing batch table only exposes `(pharmacy_id,id,product_id)` as a tenant unique key. Both metadata FKs use the existing triple keys, without adding an index/constraint to an old table. The RPC joins the actual batch/item pair; the two FKs individually enforce tenant/product identity, not independently a composite batch/item pair. Metadata is inaccessible for direct API writes; no policies are added. Internal lot references are trimmed, case-sensitive, 1–50 characters and unique for the entire pharmacy, including other opening submissions.

The exact original item key set is:

```
product_id, packaging_unit_id, quantity, cost_per_packaging_unit,
batch_unknown, manufacturer_batch, internal_lot_reference,
expiry_precision, expiry_label
```

Extra/missing keys and wrong JSON types, including nulls in required fields, reject. Unknown manufacturer batch requires JSON null; known requires trimmed nonempty string up to 100 characters. Missing/zero/negative cost is not accepted: an explicit positive numeric packaging cost is mandatory. The operator must supply supported actual costs, not estimates; the RPC checks numeric validity, not documentary authenticity. The unchanged receipt writer retains quantity/cost precision, packaging conversion and total bounds, tenant product/unit validation and catalogue locking rules.

The derived legacy batch label starts `INTERNAL LOT ` and includes the internal reference plus either `manufacturer batch unknown` or `manufacturer batch recorded`. The actual manufacturer string is never shortened or masqueraded as the internal batch number. The derived label is capped at 100 characters and metadata retains the full separate manufacturer value.

Month precision accepts exactly `MM/YYYY` or `YYYY-MM`, preserves the original label, validates calendar components and uses the **first day of the following month** as the exclusive stop-sale date. Day precision accepts exactly `YYYY-MM-DD` and retains that exact date as the existing exclusive cutoff; legacy day inventory is never shifted. Unknown/invalid/expired expiry rejects. Calendar parsing uses lexical checks, bounded numeric components and `make_date`, not session-dependent text date parsing. Supported years are 0001–9999; month 9999-12 rejects because its next-month cutoff is outside the supported four-digit mapping range.

Physical count date is a finite, supported, nonfuture PostgreSQL `date`; the typed RPC does not preserve arbitrary wire date spellings. Operational receipt/movement timestamps remain actual `clock_timestamp()`, never backdated to the count. All moving-day checks use Africa/Lagos. The underlying unchanged writer independently captures its own current timestamp; a transaction straddling Lagos midnight may safely reject an uncommitted request whose cutoff has just arrived.

## Authorization and retries

`confirm_opening_stock(target_pharmacy_id uuid, operation_id uuid, physical_count_date date, opening_items jsonb) returns uuid` requires an authenticated active owner/pharmacist and active pharmacy. It locks the pharmacy first, matching the old writer. After current authorization, an exact committed actor/tenant/operation/request match returns the historical receipt **before** validating today's date, count-date futurity, expiry or current catalogue. A mismatched request/actor or reference used by a non-opening receipt rejects. Retries are not a substitute for authentication: revoked/inactive membership still rejects.

The old writer creates receipt/items/cost layers/movements and the new metadata is added in the same transaction. Any failure rolls everything back. No supplier payment, expense or debt is created.

`list_opening_stock_lot_metadata(target_pharmacy_id uuid, after_batch_id uuid default null, page_limit integer default 250)` permits active membership of **any role** and active pharmacy, returns only the eight documented lot/count fields, uses `batch_id > cursor ORDER BY batch_id`, and requires a limit of 1–250. Continue until an **empty** page, not merely a short page; use the final batch ID. Multiple requests are not one database snapshot. Batch identity is unique. There is no separate receipt-payload reader exposing full requests.

## Security/pin assumptions and qualification gate

The explicitly trusted new-object owner/executor is `postgres`, not an arbitrary current role. New function ACLs must be precisely owner plus authenticated EXECUTE, no grant option, both granted by postgres. New tables must have owner-only ACLs, RLS enabled and no policies/user triggers/rules/inheritance, default/generated/column grants or extra indexes. API table rights and anon/service-role RPC execution are checked effectively as well as through raw ACLs. New object defaults are not changed; unexpected inherited/provider default grants cause the postcheck to **abort the whole transaction**, rather than quietly widening this task or changing shared defaults. Superusers/provider administrators remain administrative trust, not protected API actors; separate transitive SET-role/platform qualification is required.

Catalog assertions compare exact function source, argument names/defaults/returns/security and full table column/constraint definitions. Constraint deparse pins strip whitespace only, preserving grouping/operators/values. These manually prepared deparse pins are **not yet qualified against a native PostgreSQL version**, including server-version differences in not-null constraint catalogs. A mismatch must stop rollout and be reviewed; do not weaken guards to pass a fixture. The migration and verifier fix catalog deparse search path for predictable schema qualification.

Before any execution, separately establish hosted project identity, backup and restore readiness, explicit exact-hash approval, expected baseline ownership/ACLs, actual role memberships/default grants, and absence of new objects. Native disposable qualification must cover parse/deparse, all transaction rollback points, membership/tenant/role matrix, grants/RLS, strict JSON null/type/key cases, every month/day boundary and leap date, timezones/Lagos rollover, operation collisions, exact historical retry, packaging and numeric bounds, batch label lengths and cursor pagination. Also test baseline/forward drift rejection, unexpected default grants, consumed data failclosed recovery, existing delivery outcomes and Action Center owner/ACL preservation. None of these native/live tests has been run here.

## Recovery after use

**No destructive rollback after the first successful opening.** Once either metadata table has data, empty recovery intentionally raises `Forward recovery required`. Preserve all request references, metadata, stock layers, sales consumption, valuations and uncertain submissions. Do not delete opening rows to make the guard pass; that would erase audit/cost meaning and is outside this package. Stop new opening submissions, preserve/reconcile pending operations and prepare a separately reviewed additive forward correction. Do not downgrade to a client that cannot understand pending opening operations or month cutoffs. Changing Action Center copy alone after use needs a separately reviewed exact-source forward patch; it is not a license to drop metadata.

## Evidence

Offline RED/GREEN logs and SHA-256 manifests are kept at `/tmp/pharmanudge-opening-stock-evidence`. Exact command: `node --test tests/opening-stock-sql.test.mjs`. Migration-file byte comparison is against the specified base, including the complete delivery migration. This proves only the exercised source contracts and preservation, not native SQL execution, PostgREST/JWT behavior, deployed database state, production readiness or business-data correctness. No dependencies, network, browser, database connection, commit or push were used.
