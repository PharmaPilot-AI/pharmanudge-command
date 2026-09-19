# Phase 4 — PharmaNudge Rename and Brand Migration

Authoritative execution contract, written after Phase 3's closeout. Renames
the project's public brand from "PharmaPilot AI" to "PharmaNudge" across
user-facing surfaces, while preserving every stable technical identifier
that doesn't need to change. Follows the same checkpoint-and-approval
discipline as Phases 2B/3.

## Objective

Change what users, visitors, and collaborators SEE as the product's name,
without breaking active sessions, live auth, deployment, or Supabase
connectivity — and without silently rewriting project history.

## Explicitly preserved, unchanged throughout this phase

- Phase 1 (`.lovable/plan.md`), Phase 2B, Phase 3 plan documents, and the
  Phase 3 Closeout Record — historical record, referenced, never rewritten.
- `SESSION_COOKIE_NAME = "pharmapilot_session"` (src/lib/auth/session.ts) —
  changing it forcibly signs out every active session; out of scope here.
- Supabase project ref (`zcpzzqyvswixqppeujvl`) and API URLs
  (`APP_SUPABASE_URL`/`APP_SUPABASE_ANON_KEY` values) — only the project's
  *display name* changes (Checkpoint 5), never the ref/URL.
- `supabase/migrations/*.sql` file names and their internal comments.
- `supabase/config.toml`'s local `project_id` (CLI linking identifier only).
- `package.json`'s `"name": "tanstack_start_ts"` — already generic,
  unrelated to branding.

## Checkpoint 1 — Read-only inventory and baseline

- **Objective:** establish the authoritative, complete list of every old-brand
  occurrence and the current git/deploy baseline before any change.
- **Exact scope:** read-only. No files modified.
- **Expected output:** a complete grep-based inventory (UI/meta, code,
  Supabase, deployment, GitHub, docs — same categories as the earlier
  read-only inventory already performed), plus current git HEAD hash and
  live-deployed commit confirmation.
- **Acceptance criteria:** inventory covers 100% of "PharmaPilot"/"pharma-
  pilot"-style occurrences found via case-insensitive repo-wide search;
  baseline HEAD recorded.
- **Verification:** Gate A only (review the inventory for completeness).
- **Commit boundary:** none (no changes).
- **Approval gates:** Gate A (review) only — no external action.

## Checkpoint 2 — User-facing UI, assets, metadata, and current-documentation updates

- **Objective:** rename every user-facing brand surface in code.
- **Exact scope:** `<title>`/`og:title` meta across all `src/routes/*.tsx`;
  AI copy in `AiAnswerBlocks.tsx`; README.md pitch/copy; any brand-bearing
  assets (favicon/logo alt text, if any exist — confirmed in Checkpoint 1).
  Historical docs (Phase 1–3 plans, closeout record) are explicitly
  excluded — see "Explicitly preserved" above.
- **Explicit exclusions:** SESSION_COOKIE_NAME, Supabase ref/URLs,
  migrations, package.json name — all preserved per above.
- **Acceptance criteria:** zero remaining old-brand text in in-scope files;
  no functional/logic change, copy-only.
- **Verification:** Gate A (diff review confirms copy-only change).
- **Commit boundary:** all files touched in this checkpoint, one commit.
- **Rollback:** `git revert` — pure copy change, no data/schema impact.
- **Approval gates:** Gate A → Gate B (commit only, not pushed yet).

## Checkpoint 3 — Typecheck/build/review

- **Objective:** verify Checkpoint 2's changes are safe before any live
  exposure.
- **Exact scope:** typecheck, production build, lint (same commands used
  throughout Phases 2B/3), full diff review.
- **Acceptance criteria:** typecheck/build pass; no new lint findings beyond
  pre-existing repo-wide debt.
- **Approval gates:** Gate A only. Then push (its own explicit gate).

## Checkpoint 4 — Deploy and live authentication/regression verification

- **Objective:** confirm the rebrand is live and nothing regressed.
- **Exact scope:** publish (manual, Lovable dashboard); live checks: login/
  logout still work, session persists, new brand text renders correctly on
  key pages, no console errors.
- **Manual-owner action:** publish itself (same as every prior Phase 3
  publish gate).
- **Acceptance criteria:** all live checks pass; SESSION_COOKIE_NAME
  unchanged means existing sessions are NOT expected to break — explicit
  regression check confirms this.
- **Rollback:** revert the commit, republish previous build.
- **Approval gates:** dedicated gate before publish; dedicated gate for each
  live check category.

## Checkpoint 5 — Manual Supabase display-name change only

- **Objective:** rename the Supabase project's display name to reflect
  PharmaNudge, without touching its ref or API URLs.
- **Exact scope:** Supabase Dashboard → Project Settings → rename display
  name only. No ref/URL change; no APP_SUPABASE_URL/ANON_KEY change needed.
- **Manual-owner action:** entirely yours — a dashboard setting, no code
  involved.
- **Acceptance criteria:** display name updated; app continues functioning
  unchanged (ref/URL untouched, so no env var impact expected).
- **Verification:** read-only confirmation the app still loads/authenticates
  normally immediately after.
- **Rollback:** rename back via the same dashboard setting — fully reversible,
  no data impact.
- **Approval gates:** dedicated gate before this manual action; dedicated
  gate for the post-change verification.

## Checkpoint 6 — Optional new-domain setup with old-domain redirect

- **Objective:** if desired, move off `pharmacy-ai-pilot.lovable.app` to a
  PharmaNudge-branded domain, preserving reachability of the old one.
- **Exact scope:** manual, Lovable-side domain configuration; add redirect
  from old domain to new.
- **Manual-owner action:** entirely yours — domain/DNS decisions,
  registration if a new domain is needed, Lovable's domain settings.
- **Acceptance criteria:** new domain (if added) serves the app correctly;
  old domain redirects rather than 404s; no auth/cookie breakage (cookie
  `path`/`domain` scoping should be reviewed if the new domain differs from
  the old one's origin — flagged as a review item, not assumed safe).
- **Rollback:** remove the new domain binding; old domain continues serving
  as before, unaffected throughout.
- **Approval gates:** dedicated gate before domain change; dedicated gate
  confirming redirect + auth behavior post-change. This step is explicitly
  optional — may be skipped entirely.

## Checkpoint 7 — GitHub repository rename (last), then Lovable sync verification

- **Objective:** rename the GitHub org/repo last, after everything else is
  stable, since this is the highest-blast-radius, least-reversible-feeling
  step and the one most likely to disturb Lovable's already-documented
  sync fragility (Phase 3 encountered real sync-lag issues).
- **Exact scope:** manual GitHub rename (org and/or repo, your choice of
  scope); immediate post-rename check that Lovable's GitHub integration
  still shows "in sync" AND that the Lovable editor's own file view reflects
  current code (the same two-sided check used to diagnose the Phase 3 sync
  incident).
- **Manual-owner action:** entirely yours — GitHub org/repo settings.
- **Acceptance criteria:** GitHub redirects old repo URL to new (GitHub does
  this automatically for renamed repos); Lovable sync confirmed working via
  the dual-check method; a trivial nudge commit (same pattern as Phase 3's
  `caf0a3f`) available as a fallback if sync doesn't pick up the rename
  automatically.
- **Rollback:** GitHub repo renames are reversible (rename back); if Lovable
  sync breaks and can't be recovered via a nudge commit, this is flagged as
  a stop-and-report situation requiring manual Lovable support contact —
  not something to route around.
- **Approval gates:** dedicated gate before the rename; dedicated gate for
  the post-rename sync verification.

## Checkpoint 8 — Final old-brand audit and closeout

- **Objective:** confirm no old-brand text remains anywhere it shouldn't,
  and formally close the phase.
- **Exact scope:** re-run Checkpoint 1's full inventory; confirm every
  in-scope occurrence from the baseline is now updated, and every
  explicitly-preserved item remains untouched and intentional.
- **Acceptance criteria:** zero unintended old-brand references in
  user-facing/code/config surfaces; all preserved items confirmed
  unchanged; git clean and synchronized; typecheck/build passing.
- **Commit boundary:** none expected (verification only) unless the audit
  finds something needing a follow-up fix, which becomes its own gate.
- **Approval gates:** Gate A (audit review) → closeout record appended to
  this document, mirroring Phase 3's Closeout Record format.

## Definition of Phase 4 COMPLETE

All eight checkpoints individually approved through their gates;
typecheck/build passing; live app confirmed functioning under the new
brand with no auth/session regression; Supabase display name updated
(ref/URL unchanged); GitHub rename complete with Lovable sync confirmed
working; old-brand audit shows zero unintended occurrences; every item in
"Explicitly preserved" remains genuinely untouched; Phase 1–3 historical
documents unmodified.
