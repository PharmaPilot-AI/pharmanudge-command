# Release integration 01 — acceptance and rollback preparation

Authority: owner-requested `PHARMANUDGE-RELEASE-INTEGRATION-01`, PR #4 comment
[6341708386](https://github.com/PharmaPilot-AI/pharmanudge-command/pull/4#issuecomment-6341708386).
This document is **preparation, not execution approval or release certification**.

## Source provenance

- Base main: `e9f9a02870125eefd521b13cbe41cc2e0f39e3c2`.
- PR #13: `16c91ee16505555b576388444c78ea124c356f0d`.
- PR #14: `2913a2a2f4806f329316312b48e8480f9130d059`.
- PR #15: `4e7585f3e09b0c71445f6eb8031c65ca66b19b81`.

Normal merge commits on an isolated integration branch retain all exact input heads
as ancestors. Main and published source draft branches are not modified. PR #8 and
PR #12 are outside this integration.

Only `src/lib/data/stock-receipts.ts` overlaps between the application inputs. Its
combined implementation preserves PR #14's complete catalogue reads and PR #15's
scoped receipt submission, server-resolved pharmacy, identity checks and owner/
pharmacist admission. The stock server unit fixture must load the real shared
`catalogue-pages` dependency; an unknown-import failure is not an application or
backend qualification failure.

## Acceptance matrix

| Area                    | Source/offline coverage in this tree                                                                                                                                   | Still unexecuted / required before live approval                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential forms        | Real component SSR verifies disabled initial fieldset, POST and regression mutations                                                                                   | Browser no-JS, failed/delayed hydration, keyboard entry, normal callbacks and native POST fallback for login/register/reset; no credential-bearing GET URL |
| Catalogue/POS           | Complete keyset pages, lower caps, empty termination, bounded rows, tenant filters, roles, inventory completeness, cost exclusion and bounded product/unit association | Real PostgREST RPC/filter/order behavior, large-tenant POS/receiving interaction, concurrent catalogue changes and browser usability                       |
| Pending receiving       | Exact persisted request/reference, same-tab reload/retry, immutable payload, storage failures/drift, acknowledgement and double-click guard                            | Real browser storage/quota/reload behavior, route lifecycle and auth switching, offline/interrupted network replies and native UI accessibility            |
| Submission agreement    | Actual POST declaration/validator and actual server helper exercised through a controlled server-function adapter                                                      | Real TanStack HTTP transport, cookies/session refresh, routing, CSRF/request handling and production bundle compatibility                                  |
| User/pharmacy isolation | Scoped keys/envelope, subtree identity, server comparison before RPC; denied sessions/roles in synthetic fixtures                                                      | Real JWT/RLS membership, revoked/changed membership, inactive pharmacies, cross-tenant attempts and concurrent identity changes                            |
| Receipt idempotency     | SQL actor/payload/operation checks inspected; response-loss effect model and same-reference reconciliation tested                                                      | Real SQL locks, transaction rollback, response loss after actual commit, packaging conversions/rounding, expiry and stock movement correctness             |
| Financial workflows     | Expense completeness/order/failure handling and POS catalogue safety in offline fixtures                                                                               | Sale/receipt/expense/day-close transactions, ambiguous-result retries, stock/cash reconciliation, closed-day behavior and reports under real RLS           |
| Build and checks        | Canonical inherited suites plus an integration contract; focused lint, semantic TypeScript, production build and diff checks                                           | Independent review, deployed schema/migration alignment and owner-approved live acceptance; local build is not deployment                                  |
| AI/coding               | No new integration or activation; spending admission stays default-denying                                                                                             | Included-only enforcement and live provider/coding qualification remain separate; not implied by an AI-disabled core release                               |

Historical credential browser evidence remains **0 passed / 0 failed / 12 not run**.
Those are not new receiving-browser cases. Current host sandbox denial remains a
blocker; do not reuse consumed launch approvals, disable sandboxing, change host
policy or retry frozen experiments. All UI hook/router fixtures and the in-memory
receipt model are synthetic; they do not prove browser, database or RLS behavior.

Catalogue pagination is not a multi-request database snapshot. Session storage
covers same-tab reloads, not loss of the browser session or external deletion when
no in-memory copy survives. Local outbox records are not signed/authoritative
receipts; malformed/noncanonical/mismatched records and observed drift fail closed.
Errors remain held rather than discarded or converted into a new operation UUID.

## Proposed release sequence — separately approve every external effect

1. **Review and choose one source publication path.** Independently review the exact
   tested integration commit, source provenance and all remaining gates. Prefer a
   normal merge preserving source history if the owner chooses this integration
   PR; do not separately reapply the same source changes. No merge is performed by
   this preparation task.
2. **Approve prerequisites, not a browser retry.** Designate an existing authorized,
   no-additional-spend environment with verified installed dependencies and
   sandbox-capable Chromium. Prepare a new source-pinned synthetic fixture and
   complete hashes/command for a separate one-time owner approval. Preserve the
   old staged snapshot and failed-run evidence rather than silently re-pinning it.
3. **Complete isolated browser acceptance.** After that approval only, run bounded,
   synthetic, loopback-restricted cases with sandboxing enabled; stop on failure
   without fallback. No real credentials or backend traffic in this phase. Report
   actual cases rather than promoting SSR fixtures into browser acceptance.
4. **Plan an authorized backend acceptance cohort.** Obtain separate approval for
   a pre-existing suitable test tenant/environment, its schema alignment, any
   permitted synthetic writes and retained evidence. No provisioning, migrations,
   account changes or spending are implicit. Validate RLS, transaction/idempotency
   and the financial scenarios above. Credentials stay private; do not ask for
   them in chat or use real pharmacy data without explicit authority.
5. **Reach READY before owner-assisted acceptance.** Only after preparation and
   approvals, offer one short normal-login owner/cashier session with a finite
   checklist. Preview startup, live AI, migrations and deployment are distinct
   decisions; no owner terminal relay or repeated screenshot exercise is assumed.
6. **Approve cutover explicitly.** Pin the reviewed application artifact and deploy
   client/server together: scoped stock-receipt input and POST validator must agree.
   Legacy unscoped submissions fail closed. Reconcile unresolved pre-upgrade work;
   this fix cannot reconstruct requests already lost before persistence existed.
   Confirm an approved rollback target/backup policy and schema compatibility first.
   AI/coding/runner/provider gates remain closed unless separately qualified and
   authorized. Perform deployment only after explicit owner approval.

## Proposed rollback sequence — separately approved, never automatic here

1. Pause new affected business submissions through an owner-approved mechanism
   before rollback; do not abandon uncertain operations, clear browser outboxes,
   rotate operation IDs or replay held transactions. No pause/service change is
   executed by this task.
2. Preserve each pending request, its user/pharmacy binding and exact operation
   reference. Reconcile through the compatible authenticated idempotent endpoint
   in its original context; preserve uncertainty if confirmation is unavailable.
3. Do **not** blindly roll back to the pre-fix client/server: it lacks credential
   guards and durable receiving recovery. An old client can strand an outbox and
   encourage duplicate entry; an old server rejects the scoped envelope. Keep the
   credential protection and compatible outbox/validator pair, or hold affected
   routes until an independently reviewed safe rollback artifact exists.
4. If authorized, deploy the exact reviewed safe application rollback artifact as
   a compatible client/server pair, or publish a normal additive revert/fix after
   review. Do not force-push, rebase or erase published provenance. Main is not
   reverted or changed in this preparation task.
5. This integration adds no SQL migrations. Do not automatically roll back schema,
   delete receipts/stock movements or restore a database over confirmed business
   data. Any data repair/migration/backup restore requires separate approval.
6. Re-run approved reconciliation and acceptance checks before reopening normal
   submissions. Provider/coding admission, budgets/STOP and historical holds remain
   unchanged throughout; a rollback is not authority for spending or activation.
