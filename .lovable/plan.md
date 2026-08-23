# PharmaPilot AI — Phase 1: Frontend Architecture & Design System

Frontend-only phase. No database, no auth backend, no APIs, no payments, no AI integration. All screens render realistic mock data from typed local fixtures.

## 1. Proposed frontend architecture

TanStack Start (React 19 + TypeScript) with file-based routing. Structure:

```text
src/
  routes/                  # one file per screen (see section 2)
  components/
    layout/                # AppShell, OwnerBottomNav, OpsSidebar, ModeSwitcher, SyncStatusPill
    ui/                    # existing shadcn primitives (Button, Card, Badge, Input...)
    kpi/                   # KpiCard, MoneyStat, ReconciliationBadge
    actions/               # ActionCard, ActionList (severity-ranked attention items)
    pos/                   # ProductSearch, ProductResultRow, CartPanel, CartLineItem,
                           # ServiceLineItem, UnitSelector, PaymentSummary
    ai/                    # ChatThread, ChatComposer, VerifiedFactsBlock, RecommendationsBlock
    feedback/              # EmptyState, LoadingSkeleton, ErrorState
  lib/
    types.ts               # Product, PackagingUnit, Batch, CartLine, ServiceItem, Action, Kpi...
    money.ts               # ₦ formatting helpers (Intl.NumberFormat en-NG)
    mock-data.ts           # typed fixtures: today's KPIs, products, batches, actions, AI demo
    nav.ts                 # nav item definitions for both modes
  styles.css               # design tokens (oklch), typography, semantic variants
```

Key decisions:
- **Design tokens first.** Calm healthcare-business palette defined in `src/styles.css` (deep teal-green primary, warm neutral surfaces, restrained semantic colors: success/warning/danger/info). Inter loaded via `<link>` in `__root.tsx` head. No hardcoded colors in components — semantic tokens and shadcn variants only.
- **Product rules encoded in types, not logic.** `PackagingUnit` (base unit + conversion, e.g. 1 tin = 100 tablets), `Batch` with expiry, `CartLine` discriminated union of `product` vs `service` lines so service revenue is always distinguishable in the UI. Ledger immutability, offline sync, and server-side roles are noted in types/comments but not implemented.
- **Sync status** shown as a `SyncStatusPill` ("Online · Synced") in the shell — placeholder for future offline POS.
- **AI is advisory**: the Ask AI screen visually separates VERIFIED FACTS from RECOMMENDATIONS with links like "View reconciliation records". Demo conversation is scripted mock data.

## 2. Routes / screens

Owner mode (mobile-first, bottom nav):
| Route | Screen |
|---|---|
| `/` | Owner Home / Command Center (Today's Sales ₦386,400, Gross Margin ₦91,600, Est. Net Profit ₦67,300, cash status "₦12,400 short", stock/expiry summaries, Top Actions, Daily Business Brief) |
| `/actions` | Action Center (Amoxicillin out of stock, 4 batches expiring ≤30 days, ₦18,000 variance to review...) |
| `/inventory` | Inventory overview (stock levels, low/out-of-stock) |
| `/money` | Money: sales vs service revenue, cash reconciliation status, expenses summary |
| `/ask-ai` | Ask PharmaPilot AI conversational screen |

Operations mode (desktop/tablet-first, left sidebar):
| Route | Screen |
|---|---|
| `/pos` | Sell / POS workspace (search, results, cart, unit selector, services, checkout) |
| `/products` | Products list |
| `/receive-stock` | Receive Stock |
| `/inventory-ops` | Inventory (operations view) — *or share `/inventory`, see Q2* |
| `/expiry` | Expiry Center (batch/expiry table) |
| `/expenses` | Expenses |
| `/close-day` | Close Day / Daily Reconciliation |
| `/reports` | Reports |
| `/users` | Users & Roles (placeholder, roles shown read-only) |
| `/services` | Service Catalog (e.g. Pharmacist Consultation — ₦3,000) |
| `/packaging` | Product Packaging Setup (units & conversions) |

Every route gets its own `head()` metadata (title, description, og tags). Root shell provides nav chrome around `<Outlet />`.

## 3. Reusable component structure

- **Shell:** `AppShell` picks navigation by viewport — `OwnerBottomNav` (5 labeled tabs, large touch targets) on mobile; `OpsSidebar` (labeled, icon + text) on desktop. `ModeSwitcher` in the header toggles Owner/Operations context; `SyncStatusPill` always visible.
- **KPI:** `KpiCard` (label, ₦ value, delta vs yesterday, optional status tint), `MoneyStat`, `ReconciliationBadge` (Balanced / Short ₦12,400 / Over).
- **Actions:** `ActionCard` with severity badge (critical/warning/info), title, context line, CTA link.
- **POS:** `ProductResultRow` (name, generic, strength, stock by unit, price), `UnitSelector` (tablet / strip / tin with conversion hint), `CartLineItem` for stock products, visually distinct `ServiceLineItem` (service icon + "Service" badge, no stock impact note), `PaymentSummary` with big checkout button.
- **AI:** `VerifiedFactsBlock` (fact list w/ source links) vs `RecommendationsBlock` (numbered advice, "advisory only" note).
- **Feedback:** `EmptyState`, `LoadingSkeleton`, `ErrorState` used consistently on all placeholder screens.

## 4. Responsive strategy (mobile-first)

- Base styles target phones; `md:`/`lg:` scale up. Touch targets ≥44px, labeled nav everywhere.
- Owner screens: single-column stacked KPI cards on mobile → 2–4 column grids on desktop.
- POS: desktop = two-column workspace (search/results left, persistent cart right). Tablet = same but tighter. Mobile = results full-width with cart as a bottom sheet/badge button.
- Sidebar collapses to the owner bottom nav pattern on small screens so every route stays reachable on mobile.
- Tested mentally against 360px phones through 1440px desktops.

## 5. Questions & assumptions

1. **Brand color:** I assume a calm deep teal-green primary (trust/healthcare) with warm neutral surfaces and amber/red reserved for warnings. OK, or do you have brand colors?
2. **One Inventory screen or two?** Owner bottom nav and ops sidebar both list Inventory. Assumption: a single `/inventory` route that adapts its layout per device, keeping the route count down. Confirm or I'll split them.
3. **Mode switching:** Assumption — the app opens in Owner mode on `/`; a header switcher jumps to Operations (opens `/pos`). On desktop the sidebar shows all ops screens; owner screens remain reachable. Confirm.
4. **Mock AI:** The Ask AI screen will be a scripted demo conversation (no real model). Typing anything replays the "Why is cash short today?" example. OK for phase 1?
5. **Scope guard:** No real forms will submit — Receive Stock, Expenses, Close Day etc. render full UI with mock data but actions are inert (toast: "Backend coming in phase 2"). Confirm that's the right depth.

## Technical details

- Tailwind v4 tokens in `src/styles.css` using oklch; shadcn variants extended (e.g. Button `hero`/`checkout` variants) rather than ad-hoc classes.
- ₦ formatting via `Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 })`.
- No new heavy dependencies; icons via `lucide-react`; toasts via `sonner` (mounted once in `__root.tsx`).
- `createFileRoute` paths will match filenames exactly; `routeTree.gen.ts` left to the generator.
