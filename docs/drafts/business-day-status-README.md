# Business-day status RPC — review-only SQL package

**Drafts for review, not execution authorization. No production application and no database qualification are claimed.** These documents prepare verification and rollback for the additive `public.get_pharmacy_business_day_status(target_pharmacy_id uuid)` RPC. No database, Auth, role, browser or network checks were run to prepare this package.

## Contract and boundaries

- One UUID input: the requested pharmacy, never a caller-supplied date or user identity.
- An active `pharmacy_members` row must join the same active `pharmacies` row, match `auth.uid()` and the requested pharmacy, and have role `owner`, `accountant`, `cashier` or `pharmacist`. Rejection uses SQLSTATE `42501`.
- The server derives the current date in `Africa/Lagos`. Closure existence is scoped to that pharmacy and that business date.
- JSONB output contains **only** `business_date` and Boolean `is_closed`. No totals, closure identifiers, actor identities, notes or financial data are exposed.
- The RPC is read-only, stable, `SECURITY DEFINER`, with fixed `search_path = public, pg_temp`. All relation references and `auth.uid()` must remain schema-qualified. Execution is restricted to the intended authenticated role plus the function owner; table/default ACLs and existing functions are outside this change.
- This is a status hint, not an atomic permission to write. Existing write-side close-day guards, membership checks, operation references and retry/reconciliation behavior must remain authoritative and unchanged. A status result can become stale before a submission.

## Files and review order

1. Inspect the separately authored forward draft, `docs/drafts/LOCAL_ONLY_get_pharmacy_business_day_status.sql`, intentionally outside executable `supabase/migrations/`; review the complete draft, not just the function body. The verification and rollback source pins match its current `$$` body byte-for-byte. The forward draft is an atomic transaction with an absence preflight, `CREATE FUNCTION` (never replacement), and an exact new-function ACL postcheck. Independently prove the function and all same-name overloads are absent before any future application; the draft also refuses them. Repository absence is not a live database baseline. If it exists, stop; this drop-only rollback cannot restore a pre-existing definition/owner/ACL. Confirm that the eventual change is additive and does not change unrelated privileges/data. Its trusted owner and baseline must be independently established in any eventual target. If default ACLs give additional roles execution rights, the exact-ACL guard intentionally rejects that state; do not broaden privileges or change shared defaults to make it pass.
2. Review `business-day-status-VERIFY.sql`. It is a catalog-only `READ ONLY` transaction. It reports exact ACL tuples, owner, role membership edges and relevant function metadata and asserts the pinned function source/shape and ACLs. It deliberately never invokes the application RPC or inspects tenant/auth rows. A successful catalog check is not a successful member-access test.
3. Review `business-day-status-ROLLBACK.sql`. This is a **write-capable, unexecuted** transaction. It validates the exact UUID overload, expected function body, language, argument names/defaults, result type, stability, fixed search path, definer flags and exact ACL shape before dropping **only that function**, without `CASCADE`. Missing target or any detected drift aborts. It does not undo migration history, alter tables/data, grant/revoke any rights or recreate a prior function.

The scripts pin source bytes, rather than accepting a few security-related substrings as proof. Body changes, including benign whitespace changes, require a fresh review and coordinated pin updates. A source pin is a drift guard, not a semantic proof. Catalog flags and ACL checks complement it; object ownership, trust in referenced tables/Auth functions, schema CREATE rights, role inheritance/SET paths and concurrent DDL still require target-specific review. Do not run concurrent DDL during verification/rollback. The scripts do not make an unverified owner safe by comparing its ACL to itself.

For any future authorized run, independently confirm the target identity, reviewed migration version/source, trusted owner and baseline grants first. Use a SQL client configured to stop on the first error; never continue or commit an aborted/partially submitted script. Verification sets local timeouts and ends in `ROLLBACK`. Rollback sets bounded lock/statement timeouts, ends in `COMMIT`, and must be approved separately. Do not paste or run either script merely because it is included in this package.

## Evidence levels — do not conflate them

**Offline/synthetic application tests:** sibling work may exercise the actual DAL/client parsing and gate behavior with mocked RPC/Auth responses, source-contract assertions or controlled module fixtures. These can establish application contract handling, role-independent rendering/gating, malformed response rejection and recovery semantics within those fixtures. Source inspection can check the intended SQL membership predicate/date/output contract. Neither proves that PostgreSQL accepts the SQL, that the deployed function has the expected ACL/owner, or that live Supabase Auth/RLS/role behavior is correct. Consult the parent change report for actual commands, counts and limitations; this package does not assert an unobserved test pass.

**Native SQL qualification: NOT RUN.** No forward application, catalog verification, rollback, SQL parser/runtime, privilege or transaction atomicity checks were performed here. These scripts are prepared review artifacts, not a tested database recipe.

**Auth/role qualification: NOT RUN.** An eventual separately authorized disposable target should use genuine authenticated request contexts (not a privileged SQL-editor invocation masquerading as a member) to cover:

| Context/case | Required observation |
| --- | --- |
| Active owner/accountant/cashier/pharmacist, active own pharmacy | Exactly two keys; server Lagos date; Boolean closure state |
| Active member, no closure / own current-day closure | `false` / `true` respectively |
| Closure only in another pharmacy or another date | Must not change requested pharmacy's current-day result |
| Nonmember, another tenant, inactive member/pharmacy, unsupported role, NULL pharmacy | Denial, SQLSTATE `42501`, no status leakage |
| Anonymous/no session | No EXECUTE access; authenticated role without valid user claim must fail authorization |
| UTC/Lagos boundary and session timezone variation | Server-derived Lagos date, no client date override |
| Function and table permissions before/after forward and rollback | Only the new RPC is added/removed; existing rights, write guards and data unchanged |
| Induced source/ACL/security drift, missing target, dependency or lock contention | Rollback refuses/aborts atomically, never `CASCADE`s |

Actual database qualification needs a target-specific role/owner/default-ACL baseline and effective-access review, including inherited or SET-capable role paths. An administrator/superuser can bypass access controls; invoking this RPC as that role is not evidence of member authorization. Do not manufacture production membership or JWT claims for this review.

## Rollback compatibility

Coordinate application rollback or feature removal first: callers depending on the RPC will otherwise receive a missing-function error and must fail safely, not treat it as an open day. Keep existing write-side guards and financial retry/recovery state intact. Removing this read-only RPC does not reopen a day or reverse any financial operation. If the function existed before the additive migration, or has since evolved, this rollback is inapplicable: stop and design a separately reviewed reconciliation. Keep migration-history handling separate and truthful; do not delete history rows or replay unrelated migrations.
