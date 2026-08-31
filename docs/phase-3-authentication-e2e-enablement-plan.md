# Phase 3 — Authentication & E2E Enablement

Authoritative execution contract. Written after Phase 2B (catalogue create/edit/delete)
was implemented and committed through Checkpoint 9, with two obligations carried forward
unresolved: (1) genuine authenticated browser-level E2E verification of the Phase 2B
catalogue mutation set, and (2) an anonymous-role grant-hardening finding. This document
is the source of truth for Checkpoints 2–11 — each should be executable from this file
alone, without needing prior conversation history.

## Overall objective

Implement the minimum production-appropriate authentication and session infrastructure
required for a real user to authenticate through PharmaPilot, then use that authenticated
application path to discharge the carried-forward Phase 2B catalogue browser-level E2E
verification obligation. No new application features beyond what authentication itself
requires (login, logout, session persistence/refresh, route protection, and — per the
final approved decision below — a genuine (not mock) identity presentation in the
authenticated UI).

## Why this phase exists (verified repository state)

- There is currently **no authentication implementation of any kind** in this repository.
  `AppModeProvider`/`ModeSwitcher` (`src/lib/app-mode.tsx`, `src/components/layout/ModeSwitcher.tsx`)
  is Phase-1 mock role-switching UI backed by in-memory `teamMembers` fixtures
  (`src/lib/mock-data.ts`) — it has never called Supabase auth and is not a stand-in
  authentication mechanism to be "upgraded."
- `createServerSupabaseClient()` (`src/lib/supabase/server.ts`) already accepts an
  optional `accessToken` override and otherwise falls back to reading a bearer token from
  the incoming request's `Authorization` header. Verified: **nothing in this codebase
  currently sends that header** — the browser Supabase client (`src/lib/supabase/client.ts`)
  is defined but imported nowhere in `src/routes` or `src/components`. Every existing
  `createServerFn` call today therefore runs with `accessToken = undefined`, meaning
  `auth.getUser()` inside `getPharmacyContext()` (`src/lib/pharmacy-context.ts`) always
  resolves to "no authenticated user" in the live app today. This is *why* the Phase 2B
  catalogue mutations, despite being fully implemented, have never been exercised by a
  genuinely authenticated browser session — there has been no way to become authenticated.
- RLS and the pharmacy-scoped write policies from Phase 2B
  (`supabase/migrations/20260825132459_catalog_and_tenancy_foundation.sql`,
  `supabase/migrations/20260828090000_catalogue_write_policies.sql`) already grant
  INSERT/UPDATE/DELETE only to the `authenticated` Postgres role, scoped through
  `public.is_pharmacy_member(uuid)`. Phase 3 does not touch these policies.
- CSRF protection for all server functions already exists and needs no new work:
  `src/start.ts` explicitly re-installs `createCsrfMiddleware({ filter: (ctx) =>
  ctx.handlerType === "serverFn" })` (its own comment notes this must be re-added
  explicitly once `src/start.ts` exists, since its presence opts out of the framework's
  automatic default). Every `createServerFn`-based login/logout/mutation call — Phase 2B's
  and Phase 3's — is already covered.
- `supabase/config.toml`'s local `[auth]` block confirms `jwt_expiry = 3600` (1-hour
  access tokens) and `enable_refresh_token_rotation = true` — real refresh handling is not
  optional if a session should outlive an hour. It also shows `enable_signup = true` as
  the **local CLI default** — this is not evidence of the live/linked project's setting,
  and must be independently verified/corrected there (see Checkpoint 9).
- No `supabase/seed.sql` and no pharmacy/user seed data exist anywhere. There is currently
  no way to reach an authenticated state in any environment without this phase's
  provisioning procedure.

## Carried-forward obligations

1. **Catalogue browser-level E2E verification** — Product Create/Edit/Delete, Service
   Create/Edit/Delete, Packaging Unit Create (owned-product positive + cross-pharmacy
   negative), Packaging Unit Edit/Delete (owned-product positive + cross-pharmacy
   negative). Discharged in Checkpoint 11, after authentication is independently verified
   in Checkpoint 9.
2. **Anonymous-role grant-hardening finding** — carried forward **by name, unresolved**.
   Assessed in this document (see "Anonymous-role grant-hardening finding" below) and
   determined **not** to be a prerequisite for safe Phase 3 execution. Its remediation is
   explicitly out of scope for Phase 3.

## Resolved architecture/product decisions (approved)

These seven decisions were explicitly reviewed and approved before this revision. They
are the authoritative resolution for every checkpoint below; where any other section of
this document appears to conflict with one of these, this list controls.

1. **Session storage:** an encrypted, sealed session cookie, sealed/unsealed via the
   already-installed framework's native session primitive — `sealSession`/
   `unsealSession`/`getSession`/`updateSession`/`clearSession`, importable from
   `@tanstack/react-start/server` (re-exported from `h3`, a transitive dependency of
   `@tanstack/start-server-core`, itself already a dependency of `@tanstack/react-start`
   `1.168.32`, which this project already depends on — **no new package**), keyed by
   `SESSION_SECRET` as the seal `password`. Verified directly from the installed
   package's compiled source (`node_modules/h3-v2/dist/h3-*.mjs`): sealing is an
   encrypt-then-MAC construction — AES-256-CBC encryption plus HMAC-SHA256 integrity,
   each key independently derived from `SESSION_SECRET` via PBKDF2 with a random salt per
   seal — not a bare HMAC signature, and not literal AES-256-GCM as originally specified;
   it provides equivalent authenticated-encryption guarantees (confidentiality +
   tamper-evidence) through a different, independently-audited, widely-used construction
   (the same "Iron" sealed-token format used by `@hapi/iron`/`iron-session`) that this
   project does not need to implement or maintain itself. No HMAC-only/signed-but-readable
   cookie (still true — the payload is encrypted, not merely signed), and no new
   database/KV session store, in Phase 3.
2. **Token location:** Supabase tokens are server-only. No parallel browser/`localStorage`
   Supabase session is created; the browser never directly holds or manages raw Supabase
   access/refresh tokens. `src/lib/supabase/client.ts` remains unused, as it is today.
3. **Route protection:** a single `beforeLoad` on the existing root route
   (`src/routes/__root.tsx`). Existing route files are not mechanically moved into a new
   `_authenticated` layout directory merely for architectural purity. **Noted for future
   reconsideration:** a dedicated authenticated layout route may become appropriate later
   if PharmaPilot gains routes that are intentionally public (this phase has none).
4. **Code location:** a dedicated `src/lib/auth/` concern boundary for
   authentication/session/cookie logic — not mixed into `src/lib/supabase/` (client
   construction only) or `src/lib/data/` (catalogue DAL only).
5. **Mock role/mode switcher:** must **not** remain active/selectable in the genuine
   authenticated application UI used for Phase 3 verification. The authenticated UI
   displays/uses the real authenticated user's resolved identity/membership/role instead
   of allowing mock-role selection. Narrowly scoped (see Checkpoint 7): no navigation
   redesign, and no deletion of unrelated mock infrastructure (`mock-data.ts`'s
   `teamMembers`, the Owner/Operations mode concept itself) beyond disabling/replacing the
   identity-selection control.
6. **Live signup posture:** the live Supabase project's public-signup setting is
   explicitly verified — and corrected if necessary — so "no public signup" is enforced at
   the backend, not merely by the absence of signup UI. Verification and (if needed)
   correction are each their **own separate, explicit, dedicated approval gate**,
   performed only at Checkpoint 9 execution time — **never** during plan authoring, and
   not performed by this document's revision.
7. **Initial account permanence (Option A, approved):** the first correctly provisioned
   authenticated owner/admin account ("User A") is real, persistent production/pilot
   data. It is **not** deleted during Phase 3 cleanup. Only Tenant B and other explicitly
   designated E2E fixtures are disposable and are fully cleaned up in Checkpoint 11.

## Global security invariants

1. Supabase email/password authentication only. No OAuth/social login, no magic links, no
   phone/SMS auth, no MFA — none of these are configured or referenced anywhere in this
   phase.
2. No public signup. No signup UI exists anywhere in the app, **and** the live Supabase
   project's signup setting is explicitly verified/corrected (Decision 6, Checkpoint 9) so
   the invariant holds at the backend, not just in the UI.
3. Initial users are provisioned only through the controlled administrative procedures
   defined in this document (see "Controlled user-provisioning procedures"), never through
   application UI. Permanent (User A) and disposable (Tenant B/E2E) provisioning are
   distinct, separately labeled procedures — see that section.
4. `SESSION_SECRET` is server-only: read via `process.env`, never `import.meta.env`, never
   given a `VITE_` prefix, never committed (only its key name, empty, belongs in
   `.env.example`), and never auto-generated as a fallback at startup — its absence or
   insufficient length must throw, not silently substitute a generated value.
5. The session cookie is `httpOnly`, `sameSite: "lax"`, `secure: true` in production
   (`false` only for local `http://` development), and scoped to the application's root
   path (`/`), and its payload is encrypted (Decision 1) — not merely signed. These four
   flags must be passed **explicitly** in every `SessionConfig.cookie` call — verified
   from the installed library's source that its own built-in default
   (`DEFAULT_SESSION_COOKIE = { path: "/", secure: true, httpOnly: true }`) has **no**
   `sameSite` default at all, and defaults `secure: true` unconditionally (not
   NODE_ENV-aware) — relying on the library's defaults alone would silently omit
   `sameSite` and would break local `http://` development, so this project's own explicit
   `cookie` config is the sole source of truth for all four flags, not a fallback.
6. No service-role/admin Supabase credential is introduced anywhere, for any reason,
   including live testing or user provisioning scripts (Phase 2B invariant, carried
   forward unchanged). User provisioning uses the Supabase **Dashboard** or the
   **Management/Auth Admin API with a project-scoped admin session**, not a service-role
   key embedded in this codebase.
7. RLS remains the sole authorization boundary for data access. Session/cookie
   authentication establishes *who is asking*; it never substitutes for, weakens, or is
   treated as redundant with `is_pharmacy_member()`-scoped RLS policies. Authentication
   (identity) and authorization (what that identity may do) remain conceptually and
   implementationally distinct throughout this phase. The authenticated UI's identity
   display (Checkpoint 7) is presentation only — it has no bearing on, and is never a
   substitute for, RLS-enforced authorization.
8. Access-token refresh is handled transparently server-side. A user is never forced back
   to `/login` merely because an hour has passed. A failed or invalid refresh attempt
   (expired/revoked refresh token, network/Supabase error) safely clears the application
   session and returns the user to `/login` — never a silently-broken authenticated-looking
   state.
9. Redirect-after-login accepts only paths present in the allow-list derived from the
   actual router (see "Redirect allow-list" below). Any other value — absolute URLs,
   protocol-relative (`//evil.com`), unknown paths, or malformed input — is rejected and
   falls back to the user's role-appropriate home route.
10. Cross-pharmacy negative testing exercises the genuine
    `createServerFn` → Zod `.validator()` → DAL → `createServerSupabaseClient()` → RLS
    path with a real second tenant's real `product_id`/`id`. Production UI/component code
    is never modified to expose another tenant's identifiers for this purpose; the
    identifier is obtained via the temporary test fixtures' own direct data access
    (Checkpoint 10), the same way Phase 2B's own cross-pharmacy negative tests worked.
11. No Playwright or other browser-testing dependency is introduced for this phase.
    Checkpoint 9 and Checkpoint 11 verification is controlled **manual** browser testing,
    performed and reported by the operator against explicit, written steps and expected
    results.
12. Every live database or auth-data mutation (test-user creation, pharmacy/membership
    rows, catalogue test rows, deletions, any live Supabase auth-configuration change, and
    any live hosting/application configuration change such as setting or replacing
    `SESSION_SECRET`) is classified (purpose, resource(s), operation, tenant context,
    expected result, cleanup plan) and explicitly approved before execution — the same
    rule Phase 2B used, extended to Supabase Auth users, Supabase Auth configuration, and
    live application/hosting configuration.
13. Temporary test data is obviously identifiable (continuing Phase 2B's
    `__phase2b_test__`-style convention, using `__phase3_e2e__` for this phase's
    disposable fixtures) and its cleanup is executed and independently confirmed before
    the checkpoint that created it is considered closed. User A (Decision 7) is explicitly
    exempt from this cleanup — it is not temporary data.

## Global non-goals

Signup UI or enabled self-serve signup, password reset/forgot-password flow, OAuth/social
providers, MFA, "remember me"/multi-device session management, an invite-flow UI (the
`/users` route's existing "Invitations arrive with real authentication in Phase 2" mock
copy and toast are left exactly as-is — stale phase reference and all — since building or
correcting invite UI is out of scope), any redesign of navigation/sidebar/bottom-nav
structure, roles/permissions expansion beyond the existing `pharmacy_role` enum,
remediation of the anonymous-role grant-hardening finding, any inventory/sales/reporting
functionality, any schema/RLS change beyond what a dedicated gate explicitly requires
(none is currently expected). Encountering any of these mid-checkpoint is a
stop-and-report signal, not something to route around.

Note: `AppModeProvider`/`ModeSwitcher`'s mock infrastructure (`teamMembers` fixtures, the
Owner/Operations mode concept) is **not** deleted or redesigned wholesale — Checkpoint 7's
scope is narrowly the identity-*selection* control, per Decision 5.

## Architecture: session mechanism (Decisions 1 & 2)

All Supabase Auth interaction happens **server-side only**. The browser never receives or
handles a raw Supabase access/refresh token, and `src/lib/supabase/client.ts` (the
browser anon-key client) is **not** used for authentication in this design — it remains
unused, exactly as it is today, avoiding any browser-localStorage-vs-server-cookie
dual-source-of-truth problem entirely.

**Verified session primitive** (from the installed `@tanstack/react-start` `1.168.32` →
`@tanstack/start-server-core` → `h3-v2` chain, all already-installed transitive
dependencies — confirmed by reading the compiled source, not assumed): `SessionConfig`
accepts `{ password, name?, maxAge?, cookie?, sessionHeader?, seal?, crypto?,
generateId? }`. `password` (our `SESSION_SECRET`) has a **library-enforced minimum of 32
characters** — `generateKey()` throws `"Password string too short (min 32 characters
required)"` below that, and both `seal()`/`unseal()` throw `"Empty password"` if it's
missing — independently matching (and now doubly enforcing, alongside our own Zod check
in `env.ts`) this plan's existing ≥32-char requirement. `getSession`/`useSession`,
verified from source, have a side effect worth designing around: calling them on a
request with no existing valid session cookie **auto-creates a new empty session and
writes a fresh Set-Cookie**, even for anonymous/unauthenticated requests. To avoid setting
a cookie on every anonymous page view, per-request *read* access therefore uses the
lower-level, side-effect-free pair `getCookie(name)` + `unsealSession(config, value)`
directly — never bare `getSession`/`useSession` for reads. *Writes* (login, refresh
rotation) use `updateSession(config, data)`, which seals and sets the cookie (via
`setChunkedCookie`, which transparently splits the value across multiple cookies if it
ever exceeds a single cookie's size limit — verified in source, no manual size handling
needed). *Clearing* uses `clearSession(config)`, verified to delete the cookie
(`Max-Age=0`) via `deleteChunkedCookie`.

Flow:
1. **Login** (`src/routes/login.tsx` → a `createServerFn` login action): the browser
   posts `{ email, password }` to a server function. The server function uses a
   plain anon-key Supabase client (no forwarded token — nobody is authenticated yet) to
   call `auth.signInWithPassword`. On success it receives Supabase's session object
   (`access_token`, `refresh_token`, `expires_at`) and writes it into the session via
   `updateSession(sessionConfig, { access_token, refresh_token, expires_at })` — sealing
   and cookie-setting happen inside that one call — and returns only a success/failure
   result — never the raw tokens — to the browser.
2. **Session cookie contents**: `{ access_token, refresh_token, expires_at }`, sealed by
   the verified framework-native primitive (encrypt-then-MAC: AES-256-CBC encryption +
   HMAC-SHA256 integrity, each key PBKDF2-derived from `SESSION_SECRET` with a random
   salt per seal — the "Iron" sealed-token format, not a bespoke implementation). No new
   dependency, no new DB/KV store. Confidentiality (the cookie value alone doesn't hand
   over the live bearer tokens in cleartext) and integrity (tampered/invalid cookies fail
   to unseal and are treated as no session) both hold, matching invariant 5's "encrypted,
   not merely signed" requirement via a different, verified construction than originally
   specified.
3. **Per-request resolution**: a server-only helper reads the cookie via `getCookie(name)`
   and, if present, calls `unsealSession(sessionConfig, value)` (catching any throw —
   missing/tampered/expired — and treating it as no session, never letting it propagate).
   If the unsealed `expires_at` is at or near expiry (or a call using the current access
   token fails with 401), calls `auth.refreshSession({ refresh_token })` using the
   anon-key client, then **rewrites the session** via `updateSession(sessionConfig,
   rotatedTokens)` (required — `config.toml` confirms `enable_refresh_token_rotation =
   true`, so the old refresh token stops working after one use).
   `createServerSupabaseClient()`'s existing `accessToken` parameter is used to inject the
   resolved, valid access token — no change to that function's signature, only to what
   supplies its default when no explicit token is passed.
4. **Logout**: a server function reads the current session (via the same side-effect-free
   read path), calls `auth.signOut()` with it if present so the refresh token is
   invalidated server-side too (not just discarded locally), then calls
   `clearSession(sessionConfig)` unconditionally regardless of whether `signOut()`
   succeeds.
5. **Failed/invalid unseal or refresh**: treated identically to "no session" — no session
   data is used, and (for a failed refresh specifically) the session is actively cleared
   via `clearSession(sessionConfig)`, so a corrupted/expired cookie doesn't linger. Route
   protection (Checkpoint 5) then redirects to `/login`.

This keeps `getPharmacyContext()`/`requirePharmacyContext()`
(`src/lib/pharmacy-context.ts`) completely untouched — they already accept an injected
client and call `client.auth.getUser()`, which now simply resolves correctly because the
client they receive carries a real, refreshed access token.

## Architecture: new module (Decision 4)

`src/lib/auth/`:
- `src/lib/auth/env.ts` — `SESSION_SECRET` Zod schema, server-only guard.
- `src/lib/auth/session.ts` — thin wrapper around the framework-native `getCookie`/
  `unsealSession`/`updateSession`/`clearSession` (from `@tanstack/react-start/server`):
  `buildSessionConfig()` (the shared `SessionConfig`, `password: SESSION_SECRET`,
  `name: "pharmapilot_session"`, explicit `cookie` flags per invariant 5),
  `readSessionData()` (side-effect-free read:
  `getCookie` + `unsealSession`, catching failure → `undefined`), `writeSessionData(data)`
  (`updateSession` — seals + sets the cookie in one call), `clearSessionCookie()`
  (`clearSession`). Server-only.
- `src/lib/auth/actions.ts` — `loginMutation`/`logoutMutation` `createServerFn` wrappers.
- `src/lib/auth/context.ts` — `resolveSessionUser()` helper used by the router guard and
  by `createServerSupabaseClient()`'s default resolution. It resolves session validity and
  the user id/email only — it does not resolve `pharmacy_role`. Checkpoint 5 is the single
  place `pharmacy_role` is resolved (via the existing `getPharmacyContext()`, using a
  client built from this helper's token) and exposed to the rest of the app; Checkpoint 7
  consumes that already-resolved data and does not call `getPharmacyContext()` itself.

## Architecture: route protection (Decision 3)

Rather than restructuring the 15 existing route files into a new pathless
`_authenticated` layout directory (a large, unrelated-feeling diff across files Phase 3
has no other reason to touch), route protection is a **single addition to the existing
root route**: `src/routes/__root.tsx` gains a `beforeLoad` that resolves the session once
per navigation and, if unauthenticated and the target path is not `/login`, throws a
`redirect({ to: "/login", search: { redirect: <validated current path> } })`. `/login`
itself gets a mirror-image `beforeLoad`: if already authenticated, redirect away (to the
validated `redirect` search param, or the role-appropriate home). This protects all 15
existing routes with a one-file change plus the new `login.tsx`, and requires no change
to `src/router.tsx`/`routeTree.gen.ts` beyond what adding the `/login` file already
regenerates. If PharmaPilot later needs intentionally public routes, a dedicated
authenticated-layout restructure (Decision 3's noted alternative) becomes the more
appropriate design at that time — not required now.

## Redirect allow-list (derived from the actual router)

Verified directly from `src/routeTree.gen.ts` (all routes are flat, root-level, file-based
— no nesting): `/`, `/actions`, `/ask-ai`, `/close-day`, `/expenses`, `/expiry`,
`/inventory`, `/inventory-ops`, `/money`, `/packaging`, `/pos`, `/products`,
`/receive-stock`, `/reports`, `/services`, `/users`. That is the complete allow-list for
the `redirect` search param — 16 entries, all pre-existing. `/login` (the 17th route,
added by Checkpoint 6) is explicitly **excluded** from the allow-list — redirecting a
freshly-logged-in user back to `/login` is meaningless. Any `redirect` value not
exactly matching one of these 16 strings is rejected and the user's role-appropriate
default home (`roleDefaults[...].home` from `src/lib/app-mode.tsx`, or `/` if role is not
yet resolvable) is used instead.

## Authenticated users with no valid pharmacy membership

`getPharmacyContext()` already fails closed (returns `null`) for this exact case — no
change needed there. Checkpoint 6 adds the UI treatment: a route that successfully
authenticates but resolves no pharmacy context renders a minimal state built from the
existing `EmptyState` component (`src/components/feedback/EmptyState.tsx`) explaining
that the account has no active pharmacy membership, with no self-service remediation
control (provisioning membership is an admin-only, out-of-band action per this phase's
scope) — not a new membership-management screen.

## Anonymous-role grant-hardening finding

Carried forward by name, **not resolved in this phase**. As previously identified during
Phase 2B's live-project RLS inspection: the `anon` Postgres role may retain broader
default table-level grants (via Supabase's schema default privileges) on the tenancy and
catalogue tables than RLS alone would suggest, independent of and in addition to the RLS
policies themselves. This is a defense-in-depth gap (RLS still blocks row access without a
valid `auth.uid()`, so it is not currently exploitable through the app), not a Phase 3
blocker.

**Assessed and confirmed not a Phase 3 prerequisite**, because:
- Phase 3's authentication surface (`auth.users`, Supabase Auth's own schema) is
  Supabase-managed and outside this finding's scope entirely.
- Checkpoint 11's cross-pharmacy negative tests exercise the `authenticated` role's RLS
  boundary (a real second tenant's authenticated user attempting another tenant's row),
  not the `anon` role — this finding and that test target different roles.
- No part of Phase 3 grants anything new to `anon`, or relies on `anon` having reduced
  privileges to be correct.

It remains open and is restated, not silently closed, in this document's exit criteria.

## Checkpoint dependency/order

Strictly linear and blocking: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11.**
Checkpoints 2–4 (secret/cookie primitives, login/logout actions, session-aware client
resolution) must exist before Checkpoint 5 can protect routes with something real to
check. Checkpoint 5 also resolves `pharmacy_role` (via `getPharmacyContext()`) and exposes
it through router context — the single authoritative resolution point for both route
protection and identity presentation. Checkpoint 6 (login UI) needs Checkpoint 3's server
action and Checkpoint 5's redirect allow-list. Checkpoint 7 (authenticated identity
display, replacing the mock switcher) has a **direct dependency on Checkpoint 5** — it
consumes Checkpoint 5's router-context identity/role and performs no independent
resolution of its own. It is sequenced after Checkpoint 6 (login UI) so the header change
lands alongside a working login path, though it has no code dependency on Checkpoint 6
itself. Checkpoint 9 (live auth verification) needs Checkpoints 2–8 fully implemented.
Checkpoint 10 (cross-tenant fixtures) needs Checkpoint 9 passed, so fixtures are created
through a verified-working authenticated path rather than worked around. Checkpoint 11
needs both 9 and 10.

## Approval gate model

Same two-tier model as Phase 2B:
- **Gate A — "Implementation + verification bundle":** for a checkpoint with no live
  auth/database mutation and no schema/RLS change, implementation, self-inspected diff,
  typecheck, build, and a security-invariant checklist are reported together as one
  approval request.
- **Gate B — "Stage, commit, push":** after Gate A's approval, staging/commit/push
  remains its own explicit approval.

**Dedicated, non-bundleable gates** (never folded into Gate A): any live Supabase Auth
user creation/deletion; any live pharmacy/membership row creation/deletion; any live
catalogue test-data mutation; any live Supabase Auth **configuration** change (e.g.
`enable_signup`) — verification and correction are each their own gate, per Decision 6;
any live hosting/application **configuration** change (e.g. setting or replacing
`SESSION_SECRET`) — verification and correction are likewise each their own gate, per
Checkpoint 9's Step 0; any RLS/schema change (none currently expected — a dedicated gate
applies automatically if one becomes necessary); any unexpected scope expansion; commit
and push.

## Rules for live testing (auth + database + configuration)

Every live action — creating a Supabase Auth user, inserting a `pharmacy_members` row,
a login/logout/refresh test, a catalogue create/edit/delete, a negative cross-pharmacy
attempt, a live Supabase Auth configuration check/change, or a live hosting/application
configuration check/change (e.g. `SESSION_SECRET`) — is classified (purpose,
resource(s), operation, tenant context, expected result, cleanup plan) and explicitly
approved before execution. Test data and test users are obviously identifiable
(`__phase3_e2e__` prefix for catalogue rows; a clearly-labeled test email such as
`phase3-e2e-tenant-b@<domain>` for disposable auth users) and cleanup is executed and
confirmed before the checkpoint that created the data is considered closed. **User A
(Decision 7) is never subject to this cleanup** — it is provisioned once, as permanent
data, under its own labeled procedure (see below).

---

## Checkpoint 1 — Phase 3 execution specification

- **Objective:** produce this document.
- **Exact scope:** documentation only.
- **Expected files:** `docs/phase-3-authentication-e2e-enablement-plan.md` (created).
- **Security invariants:** N/A.
- **Acceptance criteria:** document exists, is self-sufficient, and all 11 checkpoints
  are present and correctly ordered.
- **Verification requirements:** Gate A (content review — no code to typecheck/build).
- **Live/authenticated testing requirements:** none.
- **Commit boundary:** this file only.
- **Dependencies:** none.
- **Approval gates:** Gate A → Gate B (commit).

## Checkpoint 2 — Session secret & cookie primitives

- **Objective:** server-only building blocks for a sealed session cookie built on the
  framework's native session primitive, with no behavior wired to any route yet.
- **Exact scope:** `SESSION_SECRET` validation, a shared `SessionConfig`, and
  side-effect-free read / seal-and-write / clear helpers wrapping
  `@tanstack/react-start/server`'s `getCookie`/`unsealSession`/`updateSession`/
  `clearSession` (verified present and already installed — no new package; see
  "Architecture: session mechanism" above for the verified API details).
- **Expected files:**
  - `src/lib/auth/env.ts` (new) — Zod schema requiring `SESSION_SECRET` from
    `process.env`, minimum length enforced (≥32 chars — matching, and doubly enforced
    alongside, the framework session library's own verified 32-char minimum), `
    "@tanstack/react-start/server-only"` guarded; throws on missing/short value, never
    generates a fallback.
  - `src/lib/auth/session.ts` (new) — `buildSessionConfig()` (the shared `SessionConfig`:
    `password` from `env.ts`'s `SESSION_SECRET`, `name: "pharmapilot_session"`, an outer
    defensive `maxAge`, and an explicit `cookie` object — `httpOnly: true`, `sameSite: "lax"`,
    `secure: process.env.NODE_ENV === "production"`, `path: "/"` — passed explicitly
    because the library's own cookie defaults have no `sameSite` and an unconditional
    `secure: true`, verified insufficient on their own per invariant 5);
    `readSessionData()` (side-effect-free: `getCookie(name)` then `unsealSession(config,
    value)` if present, catching any throw and returning `undefined` — deliberately never
    calling `getSession`/`useSession` for reads, since those verified auto-create an empty
    session and set a cookie for any request lacking one, including anonymous requests);
    `writeSessionData(data)` (`updateSession(config, data)` — seals and sets the cookie in
    one call); `clearSessionCookie()` (`clearSession(config)`).
  - `.env.example` (modify) — add a commented, empty `SESSION_SECRET=` line documenting
    its purpose and that it must never be `VITE_`-prefixed or committed with a real value.
- **Security invariants:** 4, 5 (cookie flags + encryption), 6.
- **Explicit exclusions:** no login/logout logic, no route wiring, no live testing, no new
  database/KV session store (Decision 1); no use of `getSession`/`useSession` for the
  read path (Decision 1's verified side-effect concern above).
- **Acceptance criteria:** typecheck/build pass; round-trip seal→unseal (via
  `writeSessionData` followed by `readSessionData`, or directly via
  `sealSession`/`unsealSession`) of a sample payload verified in review; missing/short
  `SESSION_SECRET` demonstrably throws — both from `env.ts`'s own Zod check and,
  independently, from the underlying library's own `"Password string too short"`/`"Empty
  password"` checks — rather than silently substituting a value; code review confirms no
  cookie is ever set by a read-only path.
- **Verification requirements:** Gate A (typecheck, build, code review of the session
  helpers and cookie flags against invariants 4–6).
- **Live/authenticated testing requirements:** none.
- **Commit boundary:** the three files above, in one commit.
- **Dependencies:** Checkpoint 1.
- **Approval gates:** Gate A → Gate B (commit).

## Checkpoint 3 — Login and logout server functions

- **Objective:** the actual Supabase Auth calls, wrapped as `createServerFn` actions,
  with no UI yet.
- **Exact scope:** `src/lib/auth/actions.ts`.
- **Expected files:** `src/lib/auth/actions.ts` (new) — `loginAction`
  (`createServerFn({ method: "POST" }).validator(...)` with a Zod
  `{ email: z.string().email(), password: z.string().min(1) }` schema; calls
  `auth.signInWithPassword` on a plain anon-key client; on success, calls
  Checkpoint 2's `writeSessionData`; on failure, throws a single generic error message —
  never distinguishing "no such user" from "wrong password", to avoid account
  enumeration) and `logoutAction` (`createServerFn({ method: "POST" })`; reads the
  current session via Checkpoint 2's `readSessionData`, calls `auth.signOut()` with it if
  present, then calls `clearSessionCookie` unconditionally).
- **Security invariants:** 1, 2, 3, 4, 6, 12.
- **Explicit exclusions:** no route/UI wiring, no live testing, no password-reset logic,
  no browser-side Supabase auth calls (Decision 2).
- **Acceptance criteria:** typecheck/build pass; code review confirms the generic
  error-message behavior and confirms no service-role client is used anywhere in this
  file.
- **Verification requirements:** Gate A.
- **Live/authenticated testing requirements:** none (exercised live in Checkpoint 9).
- **Commit boundary:** `src/lib/auth/actions.ts` only.
- **Dependencies:** Checkpoint 2.
- **Approval gates:** Gate A → Gate B (commit).

## Checkpoint 4 — Session-aware Supabase client resolution & token refresh

- **Objective:** make the resolved, refreshed access token from the session cookie the
  default identity used by every server-side Supabase call.
- **Exact scope:** `src/lib/auth/context.ts` (new) plus a targeted change to
  `src/lib/supabase/server.ts`'s default resolution path.
- **Expected files:**
  - `src/lib/auth/context.ts` (new) — `resolveSessionUser()`: reads the session via
    Checkpoint 2's `readSessionData()`; if the unsealed `expires_at` is at or within a
    small safety margin of now, calls `auth.refreshSession({ refresh_token })` and
    rewrites the session via `writeSessionData()` with the rotated tokens; on any
    unseal/refresh failure, clears the session via `clearSessionCookie()` and returns "no
    session" rather than throwing past the caller. Returns the valid access
    token (or `undefined`) plus, when present, the resolved user id/email. Does **not**
    resolve `pharmacy_role` — Checkpoint 5 does that, via `getPharmacyContext()`, using a
    client built from this helper's token.
  - `src/lib/supabase/server.ts` (modify) — `createServerSupabaseClient()`'s default
    (when no explicit `accessToken` argument and no `Authorization` header is present)
    now also tries `resolveSessionUser()` before falling back to `undefined`. The
    existing explicit-`accessToken`-argument and `Authorization`-header paths are left
    intact (no regression to Checkpoint 2/3-independent callers or tests).
- **Security invariants:** 5, 6, 7, 8 (refresh + failure handling).
- **Explicit exclusions:** no change to `src/lib/pharmacy-context.ts` (verified
  unnecessary — it already composes correctly against any client it's given), no route
  guard yet, no identity-display UI yet.
- **Acceptance criteria:** typecheck/build pass; code review confirms a failed refresh
  cannot leave a stale/invalid token in use, and confirms the cookie is rewritten on every
  successful rotation (not just read).
- **Verification requirements:** Gate A.
- **Live/authenticated testing requirements:** none (exercised live in Checkpoint 9,
  including the refresh-failure path).
- **Commit boundary:** the two files above, in one commit.
- **Dependencies:** Checkpoints 2, 3.
- **Approval gates:** Gate A → Gate B (commit).

## Checkpoint 5 — Protected routes, authenticated identity/role resolution & safe post-login redirect

- **Objective:** every existing route requires authentication; `/login` is the sole
  exception; the `redirect` target is validated against the router-derived allow-list;
  and the authenticated user's session and real `pharmacy_role` are resolved exactly
  once, here, and exposed through router context for every downstream consumer
  (Checkpoint 7's identity display included) to read without re-resolving.
- **Exact scope:** `src/routes/__root.tsx`'s `beforeLoad`, a small shared redirect
  validator, and — as the single authoritative owner of this concern — resolving
  pharmacy membership/role through the existing `getPharmacyContext()`.
- **Expected files:**
  - `src/lib/auth/redirect.ts` (new) — `isAllowedRedirect(path: string): boolean`
    checking exact membership in the 16-entry allow-list defined above (no wildcard/prefix
    matching, no decoding tricks accepted); `resolveHome(role)` reusing
    `roleDefaults[...].home` from `src/lib/app-mode.tsx` as the fallback.
  - `src/routes/__root.tsx` (modify) — add `beforeLoad({ location })`: resolve the
    session user via Checkpoint 4's `resolveSessionUser()`. If absent and
    `location.pathname !== "/login"`, `throw redirect({ to: "/login", search: { redirect:
    isAllowedRedirect(location.pathname) ? location.pathname : undefined } })`. If a
    session user is present, additionally call the existing `getPharmacyContext()`
    (`src/lib/pharmacy-context.ts`, unmodified) using a client built from the resolved
    access token, and return `{ user, pharmacyContext }` (`pharmacyContext` is `null` when
    there is no active membership) as router context — this is the **only** place in the
    app that calls `getPharmacyContext()` for presentation/routing purposes, and its
    result is what Checkpoint 6's no-membership state and Checkpoint 7's identity display
    both read, rather than either re-resolving it.
- **Security invariants:** 7, 9.
- **Explicit exclusions:** no change to any of the 15 other route files; no layout
  restructuring (Decision 3); no presentation/UI change (Checkpoint 7 owns display of this
  data, not its resolution). Checkpoint 7 must not independently re-resolve, infer, mock,
  or override `pharmacy_role` — this checkpoint is its sole source.
- **Acceptance criteria:** typecheck/build pass; code review confirms the allow-list
  check rejects absolute URLs, `//`-prefixed values, and any string not exactly matching
  a listed path; code review confirms `getPharmacyContext()` is called at most once per
  navigation and its result (including the `null`/no-membership case) is correctly
  exposed via router context.
- **Verification requirements:** Gate A.
- **Live/authenticated testing requirements:** none (exercised live in Checkpoint 9).
- **Commit boundary:** the two files above, in one commit.
- **Dependencies:** Checkpoints 2–4.
- **Approval gates:** Gate A → Gate B (commit).

## Checkpoint 6 — Login UI & no-membership state

- **Objective:** a real `/login` screen, and a minimal authenticated-but-unaffiliated
  state, both built from existing design-system components only.
- **Exact scope:** one new route; no other route files touched.
- **Expected files:** `src/routes/login.tsx` (new) — email/password form using
  `src/components/ui/form.tsx` + `input.tsx` + `label.tsx` + `button.tsx` +
  `card.tsx` (matching the existing `react-hook-form` + `zod` pattern already
  established in Phase 2B's mutation forms); its own `beforeLoad` redirects away (to the
  validated `redirect` search param, or `resolveHome(role)`) if already authenticated;
  submit calls Checkpoint 3's `loginAction`; on success, navigates to the validated
  redirect target; on failure, surfaces the generic error via the existing
  `toast.error` (`sonner`) convention. When Checkpoint 5's router context reports no
  pharmacy context (`pharmacyContext === null`) for an otherwise-authenticated session,
  render a minimal state using the existing `EmptyState`
  (`src/components/feedback/EmptyState.tsx`) explaining there is no active pharmacy
  membership for this account — no new membership UI, and no independent re-resolution of
  pharmacy context here.
- **Security invariants:** 1, 2, 9.
- **Explicit exclusions:** no signup link/form anywhere on this page; no "forgot
  password" link; no changes to `AppModeProvider`/`ModeSwitcher` (that is Checkpoint 7).
- **Acceptance criteria:** typecheck/build pass; form validation errors render inline via
  the existing `form.tsx` pattern; invalid submission never reaches `loginAction`.
- **Verification requirements:** Gate A (typecheck, build, form/redirect code review).
- **Live/authenticated testing requirements:** none (exercised live in Checkpoint 9).
- **Commit boundary:** `src/routes/login.tsx` only.
- **Dependencies:** Checkpoints 3, 5.
- **Approval gates:** Gate A → Gate B (commit).

## Checkpoint 7 — Authenticated identity display (mock role-switcher disabled)

- **Objective:** ensure the genuine authenticated application UI displays/uses the real
  authenticated user's resolved identity/membership/role, and that mock-role selection is
  not reachable there — so live verification (Checkpoints 9 and 11) cannot be confused by
  mock identity switching (Decision 5). This checkpoint is **presentation-only**: it
  consumes Checkpoint 5's already-resolved identity/role from router context and performs
  no independent authentication/authorization resolution of its own — it must not
  re-resolve, infer, mock, or override `pharmacy_role`. This is the smallest change that
  satisfies the requirement: the mock user-selection control is disabled/replaced;
  nothing else about the header, navigation, or mock infrastructure is touched.
- **Exact scope:** the header's identity control only.
- **Expected files:**
  - `src/lib/app-mode.tsx` (modify) — `AppModeProvider` accepts an optional real resolved
    identity (id/email + `pharmacy_role`), read from Checkpoint 5's router context —
    **not** independently resolved here. When a real identity is present: `member`/`mode`
    derive from it instead of defaulting to `teamMembers[0]`; `canSwitchMode` reflects the
    *real* resolved role === `"owner"`; and `selectMember` (mock identity switching) is
    not exposed to the authenticated app's consumers. The underlying `teamMembers` fixture
    and mock Owner/Operations mode concept are otherwise unchanged and remain in the
    file/codebase.
  - `src/components/layout/ModeSwitcher.tsx` (modify) — the "switch mock user" `Select`
    (choosing among the 4 fictional `teamMembers`) is removed from the authenticated
    render path and replaced with a small non-interactive display of the real identity
    (initials/email + resolved role label). The existing Owner/Operations toggle buttons
    are unchanged in layout/behavior, now gated on the real resolved role.
- **Security invariants:** 7 (this is presentation only — it has no effect on RLS/data
  authorization, and the role it displays is read from the authoritative
  `pharmacy_members.role`/`getPharmacyContext()` result via Checkpoint 5's router context,
  never client-selectable and never independently re-derived here).
- **Explicit exclusions:** no deletion of `mock-data.ts`/`teamMembers`; no removal of the
  Owner/Operations mode concept; no sidebar/bottom-nav/navigation redesign; no change to
  `nav.ts`/`roleDefaults`' structure; no change to `src/routes/__root.tsx` (that belongs to
  Checkpoint 5); no independent resolution, inference, mocking, or overriding of
  `pharmacy_role` — Checkpoint 5 is the sole source.
- **Acceptance criteria:** typecheck/build pass; code review confirms there is no
  remaining path, in the authenticated app, for a logged-in real user to change the
  displayed identity/role to something other than their own resolved membership; confirms
  `mock-data.ts`'s `teamMembers` export still exists and compiles (unrelated mock
  infrastructure preserved) but is no longer reachable from the authenticated header;
  confirms no call to `getPharmacyContext()` or `resolveSessionUser()` exists anywhere in
  this checkpoint's files.
- **Verification requirements:** Gate A.
- **Live/authenticated testing requirements:** none (exercised live in Checkpoint 9 — the
  identity shown after login is checked against the provisioned user's real
  email/role).
- **Commit boundary:** the two files above, in one commit.
- **Dependencies:** Checkpoint 5 (resolved identity/role exposed via router context).
  Sequenced after Checkpoint 6 (login UI) so this lands alongside a working login path,
  though it has no code dependency on Checkpoint 6 itself.
- **Approval gates:** Gate A → Gate B (commit).

## Checkpoint 8 — Minimal logout action in the app shell

- **Objective:** a real Log out control in the existing authenticated header, with no
  other navigation change.
- **Exact scope:** one small new component plus a one-line insertion into `AppShell.tsx`.
- **Expected files:**
  - `src/components/layout/LogoutButton.tsx` (new) — a single icon button (`LogOut` from
    `lucide-react`, already a dependency) calling Checkpoint 3's `logoutAction`, then
    navigating to `/login` regardless of the action's result (fail-safe: even if the
    server call errors, the user is sent to the login screen and the cookie clear in
    `logoutAction` is unconditional).
  - `src/components/layout/AppShell.tsx` (modify) — one import and one JSX insertion
    into the existing header row (alongside `SyncStatusPill`/`ModeSwitcher`), no other
    change to the file.
- **Security invariants:** 8.
- **Explicit exclusions:** no redesign of the header, sidebar, or bottom nav; no
  user-menu/dropdown restructuring beyond the one added button.
- **Acceptance criteria:** typecheck/build pass; `AppShell.tsx` diff is exactly the
  import + one JSX line described above.
- **Verification requirements:** Gate A.
- **Live/authenticated testing requirements:** none (exercised live in Checkpoint 9).
- **Commit boundary:** the two files above, in one commit.
- **Dependencies:** Checkpoint 3.
- **Approval gates:** Gate A → Gate B (commit).

## Checkpoint 9 — Live authenticated login/logout/session verification

- **Objective:** prove, in a real browser against the live project, that authentication
  itself works end-to-end — independent of and prior to the catalogue E2E discharge.
  Includes verifying the live-host `SESSION_SECRET` precondition and provisioning the
  permanent User A account.
- **Exact scope:** verification only; no new application code. Includes executing the
  live-host `SESSION_SECRET` precondition check and the permanent-account provisioning
  procedure (below) for User A.
- **Required steps, each its own approved live-action gate:**
  0. **Hard precondition — verify the live/production hosting environment's
     `SESSION_SECRET`.** Read-only check against the deployment platform's configured
     environment (not the code, which Checkpoint 2 already guards): confirm a
     `SESSION_SECRET` value is actually set for the live/production host, and confirm it
     satisfies the plan's required strength (≥32 chars — checkable via the platform's
     reported length/character count or an equivalent presence-and-strength signal, never
     by reading the value back). The report for this step states pass/fail and
     length-sufficiency only — it must never print, log, or otherwise expose the secret's
     value, in full or masked/partial form. If the secret is **absent or invalid, STOP —
     no browser authentication testing (steps 1–8 below) may proceed.** Setting or
     replacing the live `SESSION_SECRET` is itself a live hosting/application
     configuration mutation and requires its **own separate, explicit approval gate**
     before execution — never bundled with this verification step, and not performed by
     this planning document. After any such separately-approved correction, this
     presence/strength check is **re-run** (still without exposing the value) before
     continuing to step 1.
  1. **Verify** the live Supabase project's public-signup setting. This is a read-only
     check — report the finding as its own gate output. If it needs correction to match
     "no public signup," that correction is a **separate, subsequent, explicit approval
     gate**, performed only after this verification step is reported and approved
     separately — never bundled with the verification itself, and not performed by this
     planning document.
  2. Provision User A — the permanent owner/admin account — via the procedure below. A
     dedicated gate, classified before execution, explicitly labeled as **permanent,
     not disposable**.
  3. Manual browser test: navigate to a protected route unauthenticated → confirm
     redirect to `/login` with `redirect` set to the originally-requested path.
  4. Manual browser test: log in as User A → confirm redirect lands on the
     originally-requested path (or role home if none was set) → inspect the
     `pharmapilot_session` cookie in devtools and confirm `HttpOnly`, `SameSite=Lax`, and
     (in production) `Secure` are all set, and that its value is not plaintext JSON →
     confirm the header
     now shows User A's real resolved identity/role and that no mock-user selector is
     present or usable.
  5. Manual browser test: reload and navigate across several of the 16 protected routes
     → confirm the session persists without re-prompting for login.
  6. Manual browser test: exercise or simulate the refresh path (e.g., wait past/near the
     access-token expiry, or manually corrupt the cookie value) → confirm a valid session
     transparently continues, and confirm a genuinely invalid/corrupted cookie results in
     a clean redirect to `/login`, not an error page or stuck state.
  7. Manual browser test: use the Checkpoint 8 Log out control → confirm the cookie is
     cleared and a subsequent protected-route navigation redirects to `/login`.
  8. Confirm, via the app's client bundle (build output), that `SESSION_SECRET` never
     appears anywhere in shipped JavaScript.
- **Security invariants:** 1–9, 11, 12.
- **Explicit exclusions:** no catalogue mutation testing (Checkpoint 11); no
  cross-pharmacy testing (needs Checkpoint 10's second tenant, which itself depends on
  this checkpoint passing); no implementation file added merely for the Step 0 precondition
  — it is an execution/acceptance criterion, not new code.
- **Acceptance criteria:** all nine steps (0–8) above pass as described, in order, with
  Step 0 blocking every subsequent step until satisfied; any failure is a stop-and-report,
  not a workaround.
- **Verification requirements:** Gate A does not apply here (no new code) — this
  checkpoint is entirely dedicated live-testing gates per the steps above.
- **Live/authenticated testing requirements:** as enumerated above; this is the
  authentication-genuinely-exercised-through-the-browser milestone.
- **Commit boundary:** none expected (no code changes); if Step 0 or Step 1 leads to a
  live configuration correction (`SESSION_SECRET` or `enable_signup` respectively), that
  correction is a configuration action outside this repository, not a commit.
- **Dependencies:** Checkpoints 2–8.
- **Approval gates:** dedicated gate per step above (Steps 0 and 1 each split into a
  verification gate and, if needed, a separate correction gate, with Step 0's correction
  followed by a mandatory re-verification before Step 1 begins).

## Checkpoint 10 — Cross-tenant test fixture provisioning (disposable)

- **Objective:** create the second, throwaway tenant and second, throwaway user needed
  for Checkpoint 11's cross-pharmacy negative tests, through the now-verified
  authenticated path. Everything created here is disposable and is deleted in
  Checkpoint 11's cleanup.
- **Exact scope:** live data only; no application code.
- **Required live actions, each classified and approved individually, each explicitly
  labeled disposable:**
  1. Create one throwaway pharmacy (`__phase3_e2e__ Tenant B`) and one throwaway
     `pharmacy_members` row linking it to a newly-provisioned throwaway auth user
     (`phase3-e2e-tenant-b@<domain>`), via the disposable-fixture provisioning procedure
     below.
  2. Create at least one throwaway product (and its packaging unit) under Tenant B, so
     Checkpoint 11 has a real, RLS-protected `product_id`/`packaging_unit id` belonging to
     a different tenant to attempt against — obtained via Tenant B's own authenticated
     session, never by reading across tenants.
- **Security invariants:** 6, 7, 10, 12, 13.
- **Explicit exclusions:** no application code; no use of Tenant B outside Checkpoint 11's
  negative tests; User A is never used as, or conflated with, this disposable tenant.
- **Acceptance criteria:** Tenant B, its user, and its throwaway catalogue rows exist and
  are confirmed reachable only under Tenant B's own session (a same-tenant read as Tenant
  B's user succeeds; this is not itself the cross-tenant test, only fixture confirmation).
- **Verification requirements:** N/A (no code).
- **Live/authenticated testing requirements:** as enumerated above.
- **Commit boundary:** none.
- **Dependencies:** Checkpoint 9 (passed).
- **Approval gates:** dedicated gate per live action above.

## Checkpoint 11 — Carried-forward Phase 2B catalogue E2E discharge (final)

- **Objective:** final Phase 3 checkpoint. Using the now-verified authenticated browser
  path, genuinely exercise and discharge the full carried-forward Phase 2B catalogue
  mutation set, then fully clean up every piece of disposable data this phase created —
  while leaving User A intact.
- **Exact scope:** verification only; no new application code.
- **Required live tests, each its own approved gate, performed as User A against User
  A's own (Tenant A) pharmacy unless stated otherwise:**
  1. Product Create — real row persists, correctly scoped to Tenant A.
  2. Product Edit — persists and reflects after `router.invalidate()`.
  3. Product Delete — row (and cascaded packaging units) removed.
  4. Service Create.
  5. Service Edit.
  6. Service Delete.
  7. Packaging Unit Create — owned-product positive case (against a Tenant A product).
  8. Packaging Unit Create — cross-pharmacy negative case: attempt to create a packaging
     unit against Checkpoint 10's Tenant B `product_id` while authenticated as User A →
     must be denied server-side (RLS), not merely hidden by UI.
  9. Packaging Unit Edit/Delete — owned-product positive case.
  10. Packaging Unit Edit/Delete — cross-pharmacy negative case: attempt against
      Checkpoint 10's Tenant B packaging unit while authenticated as User A → must be
      denied server-side.
  11. **Cleanup (disposable fixtures only):** delete every `__phase3_e2e__`-prefixed row
      created by this checkpoint and by Checkpoint 10 (Tenant B's throwaway
      products/packaging units, the Tenant B `pharmacy_members` row, the Tenant B
      pharmacy row, and the Tenant B auth user), plus any throwaway row created by steps
      1–10 above beyond what those steps' own create/edit/delete cycle already removed.
      **User A, User A's real pharmacy (Tenant A), and User A's `pharmacy_members` row are
      explicitly out of scope for this cleanup and must not be deleted.**
  12. **Cleanup verification:** confirm zero leftover `__phase3_e2e__`-prefixed rows and
      zero leftover disposable auth users (Tenant B) remain in the live project, and
      separately confirm User A and Tenant A remain intact and functional (a successful
      login/read as User A after cleanup).
- **Security invariants:** 1–13 (full set).
- **Explicit exclusions:** no new application features; no schema/RLS change.
- **Acceptance criteria:** all 10 live tests pass with the stated expected results
  (including both negative cases genuinely denied server-side); disposable-fixture
  cleanup executed and independently confirmed; User A/Tenant A confirmed intact; `git
  status` clean; typecheck/build passing on the final state.
- **Verification requirements:** Gate A covers typecheck/build/status review only (no new
  code expected); every live test and every cleanup action is its own dedicated gate.
- **Live/authenticated testing requirements:** as enumerated above — this is the
  catalogue-E2E-obligation-discharged milestone.
- **Commit boundary:** none expected (verification only; no empty/unnecessary commit).
- **Dependencies:** Checkpoints 9, 10.
- **Approval gates:** Gate A (status/typecheck/build review) → dedicated gate per live
  test → dedicated gate for cleanup → dedicated gate for cleanup verification.

---

## Controlled user-provisioning procedures

Two distinct procedures. No step in either is executed by authoring this plan — both are
documented only.

### A. Permanent account provisioning (User A — Checkpoint 9)

Produces real, persistent production/pilot data. Never subject to Phase 3 cleanup.

1. Create the Supabase Auth user via the **Supabase Dashboard** (Authentication → Users →
   Add user) or the **Auth Admin API called from an operator's authenticated management
   session** (never via a service-role key embedded in this repository) — the real
   owner/admin's actual email + a generated temporary password, email pre-confirmed
   (local config shows `enable_confirmations = false`; confirm this matches the live
   project, or complete confirmation as part of this step if not).
2. If Tenant A (the real pharmacy) does not yet exist, insert one `pharmacies` row via
   the Supabase SQL Editor (approved, as a live-data action, before running).
3. Insert one `pharmacy_members` row linking User A's `auth.users.id` to Tenant A with
   role `owner`, via the Supabase SQL Editor — approved before running, since no admin UI
   exists for this in the app yet (out of scope to build one this phase).
4. Record the exact resulting `user_id`/`pharmacy_id`/`pharmacy_members.id` in
   Checkpoint 9's live-action approval record, labeled **permanent**.
5. Communicate the temporary password to the real intended owner/admin out-of-band —
   never committed, never logged.

### B. Disposable E2E fixture provisioning (Tenant B — Checkpoint 10)

Produces throwaway data, fully deleted in Checkpoint 11's cleanup.

1. Create the Supabase Auth user the same way as step A.1, using a clearly disposable,
   test-labeled email (e.g. `phase3-e2e-tenant-b@<domain>`).
2. Insert one `pharmacies` row named with the `__phase3_e2e__` prefix.
3. Insert one `pharmacy_members` row linking the throwaway user to Tenant B.
4. Record the exact resulting ids in Checkpoint 10's live-action approval record, labeled
   **disposable — scheduled for Checkpoint 11 cleanup**.

## Disposable-fixture cleanup procedure (Checkpoint 10 + Checkpoint 11 fixtures only)

Excludes User A and Tenant A entirely — nothing in this procedure ever targets them.

1. Delete all `__phase3_e2e__`-prefixed `products`/`services`/`packaging_units` rows
   (Tenant B's fixtures, plus any Tenant A throwaway rows created solely to exercise
   Checkpoint 11's positive cases, if not already removed by their own delete step).
2. Delete the Tenant B `pharmacy_members` row.
3. Delete the Tenant B `pharmacies` row.
4. Delete the Tenant B auth user via the Supabase Dashboard or Auth Admin API.
5. Re-query for any remaining `__phase3_e2e__`-prefixed row across all five tables and
   confirm zero results before Checkpoint 11 is considered closed.
6. Confirm User A can still log in and read Tenant A data, as positive proof cleanup did
   not touch permanent data.

---

## Definition of Phase 3 COMPLETE

These are tracked as **five distinct facts**, not one:

1. **Authentication/session functionality is complete:** Checkpoints 1–8 implemented,
   typecheck/build passing, all security invariants 1–9, 11, 12 demonstrably holding by
   code review — including Checkpoint 7's authenticated identity display replacing the
   mock role-selection control.
2. **Authentication is genuinely exercised through the browser:** Checkpoint 9's nine
   steps (0–8) all passed live, including the Step 0 `SESSION_SECRET` precondition, the
   refresh and refresh-failure paths, the cookie flag inspection, and confirmation that
   the real identity (not a mock-selectable one) is displayed post-login.
3. **The carried-forward Phase 2B catalogue E2E obligation is fully discharged:**
   Checkpoint 11's 10 live tests (including both cross-pharmacy negative cases) all
   passed.
4. **Temporary test data is completely cleaned up:** Checkpoint 11's cleanup executed and
   independently re-verified as zero leftover `__phase3_e2e__` rows and zero leftover
   disposable (Tenant B) auth users — **while User A and Tenant A remain intact by
   design**, confirmed functional post-cleanup. User A's continued existence is not a
   cleanup failure; it is the correct, approved outcome (Decision 7).
5. **The anonymous-role grant-hardening finding remains unresolved, intentionally
   deferred:** explicitly restated here, not silently closed by this phase's completion.

Phase 3 is not COMPLETE unless all five are true. Facts 1–4 being true does not imply
fact 5 is resolved — it is explicitly not, and is not claimed to be.
