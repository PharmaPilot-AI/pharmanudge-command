# Phase 2B — Catalogue Management

Authoritative execution contract. Written after Phase 2A (read-only, pharmacy-scoped
catalogue) was completed and verified. This document is the source of truth for
Checkpoints 2–10 — each should be executable from this file alone, without needing
prior conversation history.

## Overall objective

Convert the read-only, pharmacy-scoped catalogue delivered in Phase 2A into a secure,
authenticated create/edit/delete system for products, packaging units, and services —
using the current schema and RLS foundation, with schema/RLS changes limited to what's
strictly needed to permit writes. No expansion into inventory, sales, purchases,
reporting, or roles.

## Prerequisites from completed Phase 2A

- `requirePharmacyContext()` (`src/lib/pharmacy-context.ts`) — resolves the
  authenticated caller's pharmacy, fails closed on no user / no active membership /
  inactive pharmacy / ambiguous multiple memberships.
- `createServerSupabaseClient()` (`src/lib/supabase/server.ts`) — request-scoped,
  anon-key + forwarded JWT, server-only (`@tanstack/react-start/server-only`), no
  service-role credential.
- Read DAL (`src/lib/data/products.ts`, `src/lib/data/packaging-units.ts`,
  `src/lib/data/services.ts`) — pharmacy-scoped SELECT functions. Every write function
  in Phase 2B is added to these same files.
- Real-data routes (`src/routes/products.tsx`, `src/routes/services.tsx`,
  `src/routes/packaging.tsx`) — already reading live data via
  `createServerFn({ method: "GET" })` wrappers. These are the same files Phase 2B adds
  mutations to.
- Verified schema/RLS state as of Phase 2A completion: SELECT-only RLS on all five
  tables (`pharmacies`, `pharmacy_members`, `products`, `packaging_units`, `services`);
  zero INSERT/UPDATE/DELETE policies anywhere; `is_active` columns exist on all three
  catalogue tables but are **not** repurposed by this phase (hard delete only).
- Existing UI primitives, confirmed present, no new component work needed:
  `src/components/ui/dialog.tsx` (create/edit forms), `src/components/ui/alert-dialog.tsx`
  (destructive-delete confirmation).
- Existing but previously-unused validation stack: `zod`, `react-hook-form`,
  `@hookform/resolvers` (all in `package.json`), and `src/components/ui/form.tsx`
  (shadcn wrapper, unconsumed until this phase).
- Foreign-key behavior verified directly from
  `supabase/migrations/20260825132459_catalog_and_tenancy_foundation.sql`:
  `packaging_units.product_id references public.products(id) on delete cascade`.
  Deleting a product **does** cascade-delete its packaging units at the database level.

## Global security invariants

1. Pharmacy identity for every mutation comes only from `requirePharmacyContext()`,
   server-side — never from a client-supplied `pharmacy_id`.
2. Every UPDATE/DELETE explicitly filters by the authenticated `pharmacy_id` (direct
   column, or joined via `product_id → products.pharmacy_id` for packaging units), in
   addition to RLS.
3. Packaging-unit CREATE/UPDATE re-verifies server-side that `product_id` belongs to
   the authenticated pharmacy before writing.
4. RLS remains a fully independent second boundary — never weakened, never treated as
   redundant with application-layer checks.
5. No service-role/admin client, ever, for any reason including testing.
6. All mutation input is validated server-side with Zod before reaching the DAL.
7. Every DAL/validation/RLS failure propagates as a real, reportable error — never a
   silent false-success.
8. Hard deletion requires explicit UI confirmation via `AlertDialog`.
9. Hard-delete model only — no soft-delete/deactivation schema work this phase.
10. Live database mutation tests require explicit approval before execution, use
    obviously-identifiable throwaway data, and have a stated, executed cleanup step.

## Global non-goals

Inventory/stock management, sales, purchases, suppliers, customers,
prescriptions/dispensing, reporting/analytics, dashboard expansion, notifications,
advanced roles/permissions, soft-delete schema changes, unrelated UI redesign,
service-role/admin access, RLS bypasses. Encountering any of these mid-checkpoint is a
stop-and-report signal, not something to route around.

## Checkpoint dependency/order

Strictly linear and blocking: **1 → 2 → 3 → {4,5} → {6,7} → {8,9} → 10.** Checkpoints 2
and 3 are hard prerequisites for all of 4–9. Each entity's edit/delete checkpoint (5, 7,
9) depends on its own create checkpoint (4, 6, 8) having produced a real row to act on.

## Resolved design decisions

1. **Spec file:** this document, `docs/phase-2b-catalogue-management-plan.md`.
2. **Validation module organization:** a single shared module,
   `src/lib/data/validation.ts`. Rationale: the only existing Zod usage in the repo is
   one flat file, `src/lib/supabase/env.ts`, colocated with the concern it validates —
   there is no precedent for a dedicated "validation" or "schemas" folder. Placing the
   catalogue mutation schemas in `src/lib/data/` (the existing DAL topic folder,
   currently `products.ts`, `packaging-units.ts`, `services.ts`) follows the same
   colocation precedent without inventing a new architectural layer.
3. **Product delete confirmation wording:** verified `on delete cascade` from
   `products.id` to `packaging_units.product_id` in the migration — this is real, not
   assumed. The delete-confirmation `AlertDialog` for a product **must** state that its
   packaging units will also be permanently deleted.
4. **Router refresh mechanism:** `router.invalidate()` via `useRouter()` from
   `@tanstack/react-router` — the only invalidation/refresh pattern that exists
   anywhere in this repo today (currently used once, in `src/routes/__root.tsx`'s
   global error boundary). TanStack Query (`QueryClientProvider`) is wired in
   `__root.tsx`/`src/router.tsx` but not actually used for data fetching anywhere
   (`useQuery`/`useMutation` appear nowhere in `src/routes` or `src/components`) — it is
   unused Phase-1 scaffolding, not the active pattern. No narrower/scoped invalidation
   variant is demonstrated anywhere in this repo, so Phase 2B reuses the same bare
   `router.invalidate()` call, invoked from each mutation's success handler, rather
   than inventing a new signature.
5. **Service mutation form scope:** name + price only. Verified directly against the
   generated `services` `Insert` type — `name` and `price` are the only required
   fields with no default; `category`/`description` default to `''`, `duration_minutes`
   is nullable. Name + price alone produces a valid row.

## Approval gate model

Routine checkpoints bundle into two approval points:

- **Gate A — "Implementation + verification bundle":** for a checkpoint with no live
  mutation, no RLS/schema change, and no destructive delete, implementation,
  self-inspected diff, typecheck, build, and a security-invariant checklist are
  reported together as one approval request.
- **Gate B — "Stage, commit, push":** after Gate A's approval, staging/commit/push
  remains its own explicit approval.

**Dedicated, non-bundleable gates** (never folded into Gate A):
- Any live database mutation (per invariant 10).
- Any RLS or schema change (Checkpoint 2's migration).
- Any destructive delete, however minor.
- Any unexpected scope expansion (a file/package/capability not listed in a
  checkpoint's "expected files" below).
- Commit and push — always their own approvals, never inferred from Gate A.

## Rules for live database mutation testing

Every mutation — create, edit, delete, or a negative-case attempt — is classified
(purpose, table(s), operation, pharmacy/tenant context, expected result, cleanup plan)
and explicitly approved before execution, regardless of Gate A bundling elsewhere. Test
data is obviously identifiable (e.g., name-prefixed `__phase2b_test__`) and cleanup is
executed and confirmed before its checkpoint closes.

## Rules for staging/commit/push approval gates

Gate A bundles implementation + inspection + typecheck + build + routine
security-checklist review into one approval. Commit (Gate B) and push are each still
their own explicit approval, never inferred from Gate A. Live mutations, RLS/schema
changes, destructive deletes, and unexpected scope expansion always get their own
dedicated gate.

---

## Checkpoint 1 — Phase 2B execution specification

- **Objective:** produce this document.
- **Exact scope:** documentation only.
- **Expected files:** `docs/phase-2b-catalogue-management-plan.md` (created).
- **Implementation requirements:** this document, with all five design decisions
  resolved (done above).
- **Security requirements:** N/A.
- **Explicit exclusions:** no code/schema/config changes.
- **Acceptance criteria:** document exists, is self-sufficient, and all 10 checkpoints
  are present and correctly ordered.
- **Verification sequence:** Gate A (content review — no code to typecheck/build).
- **Rollback/recovery:** revert the one new file via git.
- **Approval gates:** Gate A → Gate B (commit).

## Checkpoint 2 — Write-side DAL foundation

- **Objective:** add pharmacy-scoped create/update/delete DAL functions, and the RLS
  policies that make them possible.
- **Exact scope:** DAL write functions for all three entities, plus a new migration.
- **Expected files:**
  - `src/lib/data/products.ts` — add `createProduct`, `updateProduct`, `deleteProduct`.
  - `src/lib/data/packaging-units.ts` — add `createPackagingUnit`,
    `updatePackagingUnit`, `deletePackagingUnit`.
  - `src/lib/data/services.ts` — add `createService`, `updateService`,
    `deleteService`.
  - New `supabase/migrations/*.sql` adding INSERT/UPDATE/DELETE RLS policies for
    `products`, `packaging_units`, `services`, mirroring the existing SELECT policies'
    `is_pharmacy_member()` pattern (joined via `products.pharmacy_id` for
    `packaging_units`, since it has no direct `pharmacy_id` column).
- **Implementation requirements:** every write derives `pharmacy_id` from
  `requirePharmacyContext()`; update/delete filter by it explicitly; packaging-unit
  writes verify product ownership.
- **Security requirements:** invariants 1–5.
- **Explicit exclusions:** no UI, no `createServerFn` wiring, no soft-delete, no
  service-role "testing shortcut."
- **Required execution sequence** (this is the authoritative step order for
  Checkpoint 2 — no step may be skipped or reordered):
  1. Inspect and document the current RLS state for `products`, `packaging_units`,
     and `services` (policy-by-policy, command-by-command) before designing anything.
  2. Design the minimum pharmacy-scoped INSERT/UPDATE/DELETE policies required —
     no broader grant than catalogue CRUD needs.
  3. Review the exact proposed SQL/policy definitions as part of Gate A, before any
     application to the linked project.
  4. **STOP for a dedicated RLS/security approval gate** before creating or applying
     the migration, or otherwise changing live RLS/schema state. No migration is
     applied without this explicit, separate approval.
  5. After approved application, explicitly verify: the migration/application
     succeeded; the linked/live migration state reflects the newly-applied migration
     (e.g. via `supabase migration list --linked`); the expected INSERT/UPDATE/DELETE
     policies exist exactly as designed; the existing SELECT isolation is unchanged;
     no broader permissions were introduced than designed in step 2; no
     service-role/admin credential or RLS bypass was introduced anywhere.
  6. Before Checkpoint 2 closes, perform an approved tenant-isolation verification
     demonstrating that catalogue writes cannot cross pharmacy boundaries (e.g., a
     write attempt scoped to one pharmacy cannot affect another's rows).
  7. Any live test that INSERTs, UPDATEs, or DELETEs data follows the global live-
     mutation rules in full: classify first, get explicit approval, use identifiable
     temporary test data, execute cleanup, and verify that cleanup succeeded.
  8. If linked Supabase connectivity prevents any required post-application
     verification (step 5 or 6), **Checkpoint 2 remains OPEN** — it is not closed or
     assumed successful on the strength of the migration file alone.
- **Acceptance criteria:** typecheck/build pass; new DAL functions exist, unused by
  any route yet; migration applies cleanly to the linked project; every item in the
  required execution sequence above is satisfied and verified, not assumed.
- **Verification sequence:** Gate A covers DAL code + migration SQL review (steps 1–3
  above), typecheck, build. The migration's application to the linked project is a
  **dedicated RLS/schema gate** (step 4), reviewed and approved on its own before
  running. Post-application verification (steps 5–6) and any live mutation test
  (step 7) are their own dedicated gates, not folded into Gate A or the schema gate.
- **Rollback/recovery:** a follow-up migration dropping the new policies if ever
  needed; DAL changes revert via git. If step 5 or 6 verification cannot be completed
  (step 8), no rollback is triggered automatically — the checkpoint stays open pending
  a resolved path to verification.
- **Commit boundary:** DAL files and migration file, in one or more commits as agreed
  at execution time.
- **Approval gates:** Gate A → dedicated RLS/security gate (apply migration) →
  dedicated post-application verification gate → dedicated tenant-isolation test gate
  → Gate B (commit).

## Checkpoint 3 — Server mutation and validation foundation

- **Objective:** establish one reusable `createServerFn({ method: "POST" })` + Zod
  pattern for Checkpoints 4–9.
- **Exact scope:** shared validation module plus the mutation-wrapping pattern; no
  route files touched yet.
- **Expected files:** `src/lib/data/validation.ts` (new — see resolved decision 2).
- **Implementation requirements:** a Zod schema per entity's create/update input
  (never including `pharmacy_id` as a field); `createServerFn({ method: "POST" })
  .validator(schema).handler(...)` wrapping each Checkpoint 2 DAL function; a
  post-mutation refresh via `router.invalidate()` (resolved decision 4); a standard
  error-to-UI convention (`toast.error` on thrown/validation failure).
- **Security requirements:** invariants 6, 7.
- **Explicit exclusions:** no real form wired to any route yet.
- **Acceptance criteria:** typecheck/build pass; pattern demonstrated as reusable
  across entities.
- **Verification sequence:** Gate A (typecheck, build, code review confirming no
  client field can influence `pharmacy_id`).
- **Rollback/recovery:** new file only, revert via git.
- **Commit boundary:** `src/lib/data/validation.ts` only.
- **Approval gates:** Gate A → Gate B (commit).

## Checkpoint 4 — Product Create

- **Objective:** make the existing "Add product" button in `products.tsx` persist a
  real, pharmacy-scoped row.
- **Exact scope:** wire the UI to `createProduct` via Checkpoint 3's pattern.
- **Expected files:** `src/routes/products.tsx` (modify) — replace the
  `toast.info("Product creation arrives with the Phase 2 backend")` no-op with a real
  `Dialog`-based form.
- **Implementation requirements:** form fields limited to real schema columns
  (`name`, `generic_name`, `category`, `barcode`, `base_unit_label`,
  `cost_per_base_unit`, `shelf_location`); success calls `router.invalidate()` and
  closes the dialog; failure surfaces a real error via `toast.error`.
- **Security requirements:** invariants 1, 2, 6, 7.
- **Explicit exclusions:** no edit/delete yet.
- **Acceptance criteria:** valid submission creates a real, correctly-scoped row;
  invalid submission shows a real validation error.
- **Verification sequence:** Gate A (typecheck, build, form/mutation code review). The
  live create test (approved, throwaway, named product) is a **dedicated mutation
  gate**, with a stated cleanup plan.
- **Rollback/recovery:** revert `products.tsx` via git; any live test row deleted per
  its plan.
- **Commit boundary:** `src/routes/products.tsx` only.
- **Approval gates:** Gate A → dedicated gate (live create test) → Gate B (commit).

## Checkpoint 5 — Product Edit & Delete

- **Objective:** pharmacy-scoped edit and confirmed hard-delete for existing products.
- **Exact scope:** extend `products.tsx` with per-row edit/delete actions.
- **Expected files:** `src/routes/products.tsx` (modify).
- **Implementation requirements:** edit reuses Checkpoint 4's form, pre-filled; delete
  requires an `AlertDialog` confirmation, whose text **must** state that the product's
  packaging units will also be permanently deleted (resolved decision 3 — real
  `on delete cascade` behavior); both scope by `pharmacy_id` server-side.
- **Security requirements:** invariants 1–4, 6–8.
- **Explicit exclusions:** none beyond the cascade-warning requirement above.
- **Acceptance criteria:** edit persists and reflects after `router.invalidate()`;
  delete removes the row and its cascaded packaging units; a hypothetical
  cross-pharmacy attempt is denied by RLS regardless of UI behavior.
- **Verification sequence:** Gate A (typecheck, build, code review). Live edit test
  may bundle into Gate A if targeting an already-approved throwaway row; live delete
  is always its own **dedicated destructive-delete gate**.
- **Rollback/recovery:** revert via git; no schema rollback needed.
- **Commit boundary:** `src/routes/products.tsx` only.
- **Approval gates:** Gate A → dedicated gate (live delete) → Gate B (commit).

## Checkpoint 6 — Service Create

- **Objective:** replace `services.tsx`'s existing local-only mock write with a real,
  persisted create.
- **Exact scope:** `src/routes/services.tsx` (modify) — reconnecting an existing
  working form, not building one from nothing.
- **Expected files:** `src/routes/services.tsx`.
- **Implementation requirements:** remove the local `useState` append and the
  `"(Phase 1 mock)"` toast; wire the existing name + price fields (resolved decision
  5 — no new fields added) to `createService` via Checkpoint 3's pattern.
- **Security requirements:** invariants 1, 2, 6, 7.
- **Explicit exclusions:** edit/delete (Checkpoint 7); no new form fields.
- **Acceptance criteria/verification/rollback:** same shape as Checkpoint 4.
- **Commit boundary:** `src/routes/services.tsx` only.
- **Approval gates:** Gate A → dedicated gate (live create test) → Gate B (commit).

## Checkpoint 7 — Service Edit & Delete

- **Objective/scope:** mirrors Checkpoint 5, for services (`src/routes/services.tsx`).
  No cascade complexity — services have no dependent child table, so the delete
  confirmation needs no cascade warning.
- **Security requirements:** invariants 1–4, 6–8.
- **Acceptance/verification/rollback:** same shape as Checkpoint 5.
- **Commit boundary:** `src/routes/services.tsx` only.
- **Approval gates:** Gate A → dedicated gate (live delete) → Gate B (commit).

## Checkpoint 8 — Packaging Unit Create

- **Objective:** replace `packaging.tsx`'s local-only mock write with a real,
  product-and-pharmacy-scoped create.
- **Exact scope:** `src/routes/packaging.tsx` (modify).
- **Expected files:** `src/routes/packaging.tsx`.
- **Implementation requirements:** create call passes the currently-selected
  `product_id`; server-side handler re-verifies that product belongs to the
  authenticated pharmacy before inserting (invariant 3 is central here).
- **Security requirements:** invariants 1–3, 6, 7.
- **Explicit exclusions:** edit/delete (Checkpoint 9); no bulk/all-products packaging
  view (out of scope, per Phase 2A Checkpoint 11's finding).
- **Acceptance criteria:** create succeeds for an owned product; an attempt against a
  different pharmacy's product is denied server-side.
- **Verification sequence:** Gate A (typecheck, build, ownership-check code review).
  Live positive-case create test and the cross-pharmacy negative test are both
  **dedicated mutation gates**, approved individually.
- **Commit boundary:** `src/routes/packaging.tsx` only.
- **Approval gates:** Gate A → dedicated gate(s) (live create test; cross-pharmacy
  negative test) → Gate B (commit).

## Checkpoint 9 — Packaging Unit Edit & Delete

- **Objective/scope:** mirrors Checkpoint 5/7 for packaging units, with the same
  product-ownership re-verification applied to edit/delete.
- **Expected files:** `src/routes/packaging.tsx`.
- **Security requirements:** invariants 1–4, 6–8, invariant 3 re-emphasized for
  edit/delete.
- **Acceptance/verification/rollback:** same shape as Checkpoint 5/7, plus the
  negative cross-pharmacy-product case.
- **Commit boundary:** `src/routes/packaging.tsx` only.
- **Approval gates:** Gate A → dedicated gate(s) (live delete; cross-pharmacy negative
  test) → Gate B (commit).

## Checkpoint 10 — Phase 2B security and CRUD smoke testing

- **Objective:** final whole-phase verification, now able to exercise the positive
  authenticated path for real.
- **Exact scope:** verification only, no new application code.
- **Acceptance criteria:** typecheck/build pass; every create/edit/delete flow for all
  three entities exercised at least once live (approved, throwaway, cleaned-up); the
  cross-pharmacy negative test run for packaging units; `git` clean and synchronized;
  zero leftover test data anywhere in the live database.
- **Explicit exclusions:** no new features; no schema beyond Checkpoint 2's
  write-enabling policies.
- **Verification sequence:** Gate A covers typecheck/build/status review; every
  individual remaining live CRUD test is its own dedicated mutation gate.
- **Rollback/recovery:** N/A unless a defect is found, reported as a separate
  follow-up.
- **Commit boundary:** none expected (no empty/unnecessary commit).
- **Approval gates:** Gate A → dedicated gate(s) per remaining live test → dedicated
  push gate only if prior commits weren't already pushed incrementally.

## Definition of Phase 2B COMPLETE

All ten checkpoints individually approved through their required gates; typecheck/build
passing on the final state; all ten security invariants demonstrably holding; at least
one live, approved, cleaned-up CRUD test per entity per operation; the packaging-unit
cross-pharmacy negative test passed; zero leftover test data in the live database; git
synchronized with a clean working tree; schema/RLS limited to Checkpoint 2's
write-enabling policies.

## Addendum — Carried-Forward Obligation Discharged

Checkpoint 10's live smoke-testing (including the packaging-unit
cross-pharmacy negative test) was never executed live under this document —
there was no way to become authenticated at the time. That obligation was
carried forward into Phase 3 and fully discharged there, at Phase 3's
Checkpoint 11, on 2026-09-19. See
`docs/phase-3-authentication-e2e-enablement-plan.md`'s Checkpoint 11 and its
Phase 3 Closeout Record for the actual live test results and cleanup
evidence. This document's own Definition of Phase 2B COMPLETE above is now
satisfied by reference to that later work, not by any live testing recorded
directly in this file.
