# Ask PharmaNudge: owner-only evidence and advisory

This integration replaces the scripted Ask AI demonstration with one manually submitted business question and a today/week/month selection. For a hard privacy boundary, the question is mapped locally to fixed financial, cash, stock/expiry or general-overview topics. The provider receives only those topic identifiers, never the original free text. Advice therefore addresses the selected aggregate topics, not arbitrary question details; this is disclosed beside the form. It is not a conversational-history service, clinical adviser, autonomous agent or data-mutation workflow. It does not activate the recurring coordination runner.

## Trust and usage boundaries

- Both route access and the server handler require an authenticated active owner of exactly one active pharmacy. Pharmacy scope comes from membership, never client input. Session resolution precedes authenticated Supabase client creation.
- Input is strictly validated before usage reservation. Missing server AI configuration must leave quota untouched. The database reservation is acquired before any model request; `allowed`, `daily_limit` and `rate_limit` are handled explicitly, and unknown/error responses fail closed. No automatic model retry is performed. A failed provider attempt can consume its one reservation.
- The existing `20261016095000_pharmacy_ai_usage_guard.sql` migration defines a pharmacy-wide 50-request Lagos business-day limit and a 30-second cooldown. This source change does not edit or apply it. Missing/unavailable deployed RPCs must produce a safe failure, not bypass limits.
- Questions are business-only. Do not enter patient details, member/customer names, email addresses, phone numbers, diagnosis or dosing requests. Input guards are conservative checks, not a comprehensive natural-language PII detector. Regex filtering is not the provider privacy boundary: raw question text is never sent. Only fixed business-topic identifiers and whitelisted aggregate evidence are sent. Authorized evidence contains aggregate facts, not member directories or patient records.

## Evidence is not AI advice

Financial values come from existing validated financial/day/stock services. Financial and stock services additionally verify their resolved user/pharmacy/role against the captured request context before their RPCs; day-summary provenance is checked against that context. Existing callers remain unchanged. These are separate authorized reads, not an atomic database snapshot. Database decimal strings remain strings and are formatted without floating-point conversion. Financial facts cover the selected report period; stock is a current snapshot and reconciliation is for the current Lagos business day. Source links use the returned evidence period, not an unrelated current form selection. Retrieval timestamps, business dates and limitations make separate-query and stale-snapshot boundaries visible.

The verified-facts section describes deterministic database records. Generated explanation/recommendations are explicitly **AI advisory, not verified facts**. Known fact IDs are validated, but citations are not proof that a generated interpretation is correct. No product/staff ranking, historical trend, low-stock threshold, patient inference, clinical diagnosis/dose or completed action is invented by the deterministic evidence builder. Zero recorded activity is not proof that the pharmacy did not trade. Model output is ordinary escaped React text, not HTML, executable code or generated actionable links.

Missing configuration, limits and provider failures retain available verified evidence, with a clear status and no mock answer. A failed new request must not silently relabel old evidence as newly retrieved or preserve a previous advisory as the new answer. Submission is manual, never a page-load/period-change effect; a synchronous in-flight guard prevents duplicate submissions.

## Server-only provider contract

`LOVABLE_API_KEY` and optional `APP_AI_MODEL` are read on the server only. Never use a `VITE_` variable for provider credentials. Only the reviewed `google/gemini-3-flash-preview` model is accepted; an unsupported override is unavailable configuration, not an automatic model switch. No credential files or values are included in this change.

The inherited gateway endpoint is `https://ai.gateway.lovable.dev/v1/chat/completions`, with a non-streaming OpenAI-style messages envelope and bounded structured JSON advisory. Requests are limited to 64 KiB, responses to 32 KiB of actual UTF-8 bytes, and the complete request/body-read deadline is 30 seconds. Responses with malformed/truncated structure, unknown cited fact IDs or invalid UTF-8 fail closed. Provider 402 maps to a usage/credit limit and 429 to a rate limit; raw provider error bodies are not returned or logged. Redirects are refused and fetch caching is disabled. The provider payload selects only fixed business-topic identifiers, period/date/retrieval metadata, aggregate fact IDs/text and evidence limitations—not raw question wording, membership or patient objects.

Official provider documentation reviewed: [Lovable AI features](https://docs.lovable.dev/features/ai). It currently lists Gemini 3 Flash Preview, server-side generated `LOVABLE_API_KEY`, and 402/429 credit/rate behavior. The exact gateway envelope/endpoint remains an inherited integration contract; **no live provider request was used to certify it**. Deployment-specific credentials, model entitlement and successful structured output still require separately authorized live acceptance testing.

## Local verification

Existing installed dependencies are sufficient; no test framework install or live service is required:

```sh
npm run test:ask-ai
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

Run ESLint on the changed TypeScript/TSX files and Prettier checks on the scoped test/helper/document files. The Node built-in tests transpile actual application modules with the installed TypeScript compiler. Server/router/auth/database/provider dependencies are explicitly faked; the test VM has empty environment settings and a denied default fetch. The tests do not consume database quota, invoke live AI, write production data, send Telegram messages, apply migrations or deploy.

### Generated-types lint baseline

Focused application-file ESLint passes. The generated `src/lib/supabase/database.types.ts` has 411 existing `prettier/prettier` diagnostics on `origin/main` and the same 411 after the typed RPC addition; no new diagnostics occur in that block. Semantic lint for that file passes with only the formatter rule disabled for the verification command. No lint configuration was changed and unrelated generated formatting was not rewritten.

Remaining live acceptance checks, only with separate authorization: owner/non-owner sessions against deployed RLS; installed RPC availability and real shared cooldown/day behavior; provider entitlement/structured output with approved non-sensitive inputs; and mobile/screen-reader interaction on the deployed authenticated route. A production build alone does not certify any of those integrations.
