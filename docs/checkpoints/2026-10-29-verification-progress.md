# Remaining verification — completed in TEST, 30 October 2026

The agreed Remaining verification milestone is complete in TEST. Results below were executed by the user on Windows and in pharmanudge-test (foatlexwlingrevefhbp), with terminal output and screenshots reviewed in the working conversation.

## Source checkpoint

Preserved Windows src/tests snapshot in 534c74055e644fc702e6c1078ae479ed47baed5a against email checkpoint de820118f28f5845d65a1175fdf4fff49d6b0a29. Seventeen tracked files changed: sixteen formatting-only files and app-mode.tsx formatting plus memoized identity/member declarations. Backup files excluded; no absent files deleted. Root configuration and scripts were outside the supplied archive; their formatting changes were not compared against this source checkpoint.

## Final Windows checks, 30 October

- ESLint over src, tests, eslint.config.js and vite.config.ts: exit 0, zero errors, eight Fast Refresh warnings.
- TypeScript --noEmit --pretty false: exit 0.
- Five Node test files (catalogue-pages, credential-form-ssr, release-integration, stock-receipt-recovery, stock-receipt-ui): 48 passed, zero failed/cancelled/skipped, exit 0.
- npm run build: successful, explicit build exit code 0 confirmed.
- The earlier silent ESLint runs stopped blocking progress after the overnight restart. Their root cause was not established.

## Live acceptance, 28–29 October

- Email recovery and verified invitation onboarding were completed in the preceding email checkpoint.
- Owner and Operations mode selections survived refresh.
- Reused verification link was rejected.
- Cancelled invitation was rejected for its verified intended recipient and remained cancelled.
- Unverified-account login was rejected; after verification the account could sign in and correctly saw no pharmacy membership.
- Expired invitation acceptance was rejected without creating membership. The rollback test restored the original invitation to pending, future expiry and null acceptance audit fields.
- Saved closing display showed “You” to its actor and the actor email to another authorized member.

## Live concurrency checks, 29 October

Tests used a dedicated verification pharmacy and overlapping SQL sessions, with a guard checking the first session's active sleep before the competing operation.

1. Competing sale: overlapping sale rejected for insufficient stock; two recorded sales and one tablet remained at that stage.
2. Duplicate stock receipt: one matching receipt, two total receipt movements including the initial receipt, six tablets remained; retry did not add stock twice.
3. Sale before closing: competing sale changed reviewed totals; stale closing was rejected, zero closures and total sales 300.
4. Closing before sale: closing committed and competing new sale was rejected; one closure, three sales and five tablets remained.

An initial sale test failed its overlap guard and was not counted as a concurrency pass. Its committed sale was included in subsequent fixture totals.

## Fixture retirement, 30 October

Dedicated pharmacy 7a291000-0000-4000-8000-000000000001, “VERIFY ONLY — Concurrency 20261029”, was deactivated along with all its memberships. Final query confirmed pharmacy_active = false and active_members = 0. Audit and transaction rows were retained. The original test pharmacies were not retired.

## Scope and release boundary

This is TEST acceptance, not production deployment or an exhaustive security audit. Offline tests simulate dependencies; SQL concurrency checks exercised the functions with authenticated identity claims from the SQL editor and do not establish every authenticated-role RLS/privilege path. No main merge, history rewrite or production change was performed. Production configuration, integration review (including root files outside the archive), and release readiness belong to release preparation.
