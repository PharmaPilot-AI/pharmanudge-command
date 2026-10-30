# Pilot scope and release preparation — 30 October 2026

## Agreed scope

Owner approved core workflows first, with live AI and reorder alerts deferred.

Included: accounts/recovery, invitations and role management, products, packaging, stock receiving with safe retries, product/service POS, inventory valuation, expiry, expenses, day closing, dashboard/reports and existing Action Center.

Initial onboarding is assisted; application supports one active pharmacy membership per user. Low stock remains explicitly not configured until reorder thresholds are implemented.

Scripted Ask AI is removed from navigation and its direct route redirects home. Live AI draft PR #8 and automated coding/runner changes remain outside this pilot; no provider or runner activation is authorized by this scope.

## Release candidate preparation

Base: verified checkpoint 41552679ea807a51e9dbdc7ad6748f4dd00a1bc1.
This change removes the navigation entry and scripted route implementation. No migrations or data changes.

Prior checkpoint checks passed in TEST; this changed candidate still requires lint, TypeScript, build and a browser smoke check (desktop/mobile navigation and direct /ask-ai redirect). No new automated tests for this small reversible navigation change.

## Remaining release gates

- Validate changed candidate and reconcile Windows root files outside the earlier src/tests archive.
- Review source ancestry and select the integration path preserving normal history.
- Confirm production migration alignment, server-capable hosting and environment configuration; keep credentials private.
- Confirm production email sender and HTTPS callback URLs.
- Pin backup and compatible application rollback procedure; retain uncertain receipt requests and audit records.
- Prepare deployment artifact and obtain final owner cutover approval after reviewable checks.
- Run production smoke checks and assisted pilot onboarding following authorized cutover.

This is release preparation, not deployment certification. Main, production database and hosting are unchanged.
