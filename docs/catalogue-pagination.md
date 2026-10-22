# Complete catalogue loading

Products, service and packaging management, stock receiving and POS used single
queries that could silently stop at the API row limit. POS could then display
missing stock as zero. The read paths now request UUID-ordered keyset pages of
200 rows and finish only on an empty page, including when the server cap is lower.
Tenant and active filters are reapplied by each caller. After loading, display
ordering uses names/labels with IDs as tie breakers. POS still selects only selling
fields and strips inventory valuation and packaging join metadata.

Errors, null data, malformed/non-increasing IDs, overlarge pages and more than
100,000 rows reject the load instead of returning partial results. Missing POS
inventory also rejects rather than inventing zero availability. Database writes,
authorizations, prices, stock calculations and migrations are unchanged.

Keyset reads are not a multi-request database snapshot: concurrent additions,
deactivation and updates can change the catalogue during loading. The existing
sale RPC remains responsible for validating current prices and stock atomically.
This change does not paginate the separate inventory/expiry screens or member
directory. Those are follow-up review areas, not certified complete by this fix.

## Executed validation

Node 24, no installed project dependencies or network/provider/database calls:

```
node --experimental-vm-modules --test tests/catalogue-pages.test.mjs
```

Tests strip TypeScript using Node and execute the actual source modules with fake
auth/query adapters. They cover 1,205 products/units/services/inventory rows,
lower server caps, tenant filter retention, cost-field exclusion, role/session
denials, receiving, later-page failure, empty/exact-boundary pages, malformed or
non-progressing pages, missing inventory and the aggregate memory bound.

This is offline execution of source, not TypeScript semantic checking, Supabase
integration or browser acceptance. Full app lint/typecheck/build and browser
validation remain pending because project dependencies/browser are unavailable
in the coordinator environment. No installation or production operation was run.
