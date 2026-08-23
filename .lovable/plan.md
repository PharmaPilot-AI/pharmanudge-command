# PharmaPilot AI — Phase 1: Frontend Architecture & Design System (APPROVED)

Frontend-only phase. No database, no auth backend, no APIs, no payments, no AI integration. Screens render typed mock fixtures; core workflows are interactive via local React state.

## 1. Frontend architecture

TanStack Start (React 19 + TypeScript), file-based routing. No RSC experiments, no server functions in Phase 1.

```text
src/
  routes/                  # one file per screen
  components/
    layout/                # AppShell, OwnerBottomNav, OpsSidebar, ModeSwitcher, SyncStatusPill
    ui/                    # shadcn primitives (Button, Card, Badge, Input...)
    kpi/                   # KpiCard, MoneyStat, ReconciliationBadge
    actions/               # ActionCard, ActionList
    pos/                   # ProductResultRow, CartPanel, CartLineItem, ServiceLineItem, UnitSelector, PaymentSummary
    ai/                    # ChatThread, ChatComposer, VerifiedFactsBlock, RecommendationsBlock
    feedback/              # EmptyState, LoadingSkeleton, ErrorState
  lib/
    types.ts               # Product, PackagingUnit, Batch, CartLine, ServiceItem, ActionItem (framework-light)
    money.ts               # ₦ formatting, unit conversion helpers (framework-light)
    mock-data.ts           # typed fixtures
    app-mode.tsx           # mock role/mode context
    nav.ts                 # nav definitions per mode
  styles.css               # design tokens (oklch), typography
```

Decisions:
- Design tokens in `src/styles.css`: calm deep teal-green primary, warm neutral surfaces, amber/red reserved for warning/error. Inter via `<link>` in `__root.tsx`. Semantic tokens only in components.
- Domain types + money/unit helpers are framework-light (no React/router imports) for later backend reuse.
- Product rules encoded in types: `PackagingUnit` (base unit + conversion), `Batch` expiry, `CartLine` discriminated union (product vs service revenue distinguishable).
- `SyncStatusPill` placeholder in shell for future offline POS. AI advisory only: VERIFIED FACTS visually separated from RECOMMENDATIONS.

## 2. Routes

Owner mode (mobile-first):
- `/` Owner Home / Command Center (Sales ₦386,400, Gross Margin ₦91,600, Est. Net Profit ₦67,300, cash short ₦12,400, stock/expiry summaries, Top Actions, Daily Business Brief)
- `/actions` Action Center (interactive Resolve / Snooze / Assign)
- `/inventory` Owner inventory intelligence (summary, low/out of stock, expiry risk, value at risk, prioritized actions)
- `/money` Money (product vs service revenue, reconciliation, expenses)
- `/ask-ai` Ask PharmaPilot AI (scripted demo + suggested chips; unknown input clearly labeled mock)

Operations mode:
- `/pos` Sell / POS (search products+services, add to cart, unit selector, quantity, base-unit stock impact "Stock impact: -10 tablets / Remaining: 990", payment method, local success checkout)
- `/products` Products list
- `/receive-stock` Receive Stock (supplier/item/unit/qty/cost/batch/expiry entry, review with base-unit equivalents, confirm updates local state)
- `/inventory-ops` Operational inventory (detailed table, batches, shelf location, stock count, adjustments, reorder)
- `/expiry` Expiry Center
- `/expenses` Expenses (local form + list update)
- `/close-day` Close Day / Reconciliation (enter counted cash, live variance, short/balanced/over)
- `/reports` Reports
- `/users` Users & Roles (read-only placeholder)
- `/services` Service Catalog
- `/packaging` Product Packaging Setup

Every route has its own `head()` metadata.

## 3. Mode & role model (user decision)

Mode is a user/context concept, NOT viewport-derived.
- Mock user/role selector in header: Owner/Admin, Pharmacist/Manager, Cashier/Assistant, Accountant.
- Defaults: Owner → Owner mode `/`; Cashier → `/pos`; Pharmacist → Ops mode; Accountant → `/reports`.
- Owner can explicitly switch Owner ↔ Operations mode.
- Viewport only changes layout: bottom nav on mobile, left sidebar on desktop — both driven by current mode.

## 4. Responsive strategy

Mobile-first; touch targets ≥44px; labeled nav. Owner screens stack → grids on desktop. POS: two-column workspace on desktop (search/results + persistent cart), mobile cart as bottom sheet. Ops mobile bottom nav: 4 primaries + Menu overlay for the rest.

## 5. Scope guards

No Supabase/schema/Edge Functions/auth/payments/AI APIs/production server logic. No publish. Checkout, Receive Stock, Expenses, Close Day, Action Center update local mock state only.
