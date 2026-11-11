# Opening stock from paper records — local review candidate

Base: `c9c6523d0aec487343738278772bb9675296de49`. Local implementation only; **not approved for deployment or SQL application**.

## Approved expiry decision

The owner explicitly selected: **usable through the labelled month; blocked from the first day of the following month**. This decision was obtained before implementation.

New month-labelled opening lots retain `expiry_precision=month` and the original entered numeric label (`MM/YYYY` or `YYYY-MM`, edge whitespace trimmed). Their internal exclusive stop-sale cutoff is the first day of the next calendar month in Africa/Lagos. For `11/2026`, receiving/selling is permitted through November30 and blocked from00:00 Lagos December1. February leap/year transitions use calendar arithmetic.

No existing expiry is shifted. Legacy deliveries retain exact-day semantics: unavailable ON the stored expiry date. Exact-day opening lines likewise retain that exclusive date rule. The printed/entered label is not replaced with a claimed manufacturer-printed exact day; cutoff dates are explicitly labelled as such. Label interpretation remains the owner's/responsible pharmacist's business decision, not a universal manufacturer/clinical claim.

## What changed, and what did not

- A separate `/opening-stock` screen is linked from Receive stock when no old delivery request is pending. Existing delivery form, v1 schema/outbox, writer and financial implementation remain intact; its only screen change is the link.
- Plain-language defaults: count date defaults to today's Lagos date (editable; Ebona must enter its actual2026-11-10 count date), manufacturer batch unknown checked, expiry month/year, blank mandatory cost rather than an invented zero. Internal lot reference is generated once when adding a review line and retained in the exact saved request.
- Real manufacturer batch, when known, is separate from the internal count-lot reference. Unknown manufacturer is explicitly null/flagged, not a fabricated code. One internal count lot does not establish manufacturer batch traceability; keep counted expiry groups physically identifiable.
- Review shows selected-unit quantity, actual catalogue conversion, cost per selected/base unit and stock value. Database validation/rounding remains authoritative. Freeze/review packaging definitions during cutover; neither a bottle's volume nor a box's sachet count is guessed. Current catalogue definitions are used at commit, as in the unchanged delivery writer.
- Physical count date is separate metadata from server receipt/movement entry timestamps. The UI requires acknowledgement that movements since the count have been reconciled. It does not backdate receipts, fabricate intervening trades or reset existing stock balances.
- Unresolved/mixed expiry may be marked **not loaded** on a temporary visible checklist. It never enters the request or saleable ledger. Keep excluded quantities/reasons and loaded totals on the signed count sheet. The checklist is explicitly nonpersistent and is not a new quarantine/adjustment register; full quarantine management is outside scope.
- No payment, expense or supplier debt is created. Actual positive documented costs are required; zero/missing costs are rejected and the UI instructs against estimates or stand-ins. The software validates numbers and operator acknowledgement, not the authenticity of paper cost evidence. Costs populate stock valuation and subsequent sale cost-of-goods, not new cash spending.

## Server/database contracts — drafts only

The new server function re-resolves authenticated active tenant/role and compares saved actor/tenant pins before calling the new opening-only RPC. Owner/pharmacist may write; cashier/accountant may not. Existing tenant/RLS/financial authorization is not widened.

See `docs/drafts/opening-stock-{MIGRATION,VERIFY,RECOVERY}.sql` and `opening-stock-SQL-README.md` for the exact reviewed draft contracts. They are intentionally outside executable migrations. **NO SQL WAS EXECUTED AGAINST ANY DATABASE**, including local/disposable ones.

The migration draft adds private receipt/lot provenance tables and an opening writer/metadata reader. The writer delegates to unchanged `confirm_stock_receipt` for authorized, locked, atomic receipt/item/cost-layer/movement creation, then adds original opening metadata within the same transaction. The original full request, count date, actor, internal reference, unknown/manufacturer fields and original expiry label/precision are retained. Wrapper-converted batch text begins INTERNAL LOT and says manufacturer unknown/recorded, while the real manufacturer batch remains separate.

Existing delivery RPC signature/body, old financial writers, existing migrations, shared defaults and old ACLs are unchanged. New function grants are narrowly owner/authenticated with public/anon/service_role revoked only on new functions. The existing Action Center function receives guarded terminology-only changes from manufacturer-like expiry language to generic stock-lot/stop-sale language, preserving its original body semantics, owner and effective ACL. Native catalog/deparse/privilege behavior remains unqualified.

## Recovery and exact saved requests

New opening requests have a separate scoped durable outbox; old pending delivery v1 bytes are not upgraded, cleared or reused. Storage is read-back-verified before dispatch, references/payloads are immutable, uncertain outcomes remain saved, retry is explicit and confirmed recovery requires acknowledgement. A pending delivery blocks new opening entry, including a delivery appearing after form mount. Original saved opening retries are still available for reconciliation.

Committed exact tenant/actor/operation/payload RPC retries resolve before moving-date/expiry/catalogue checks; an uncommitted retry can execute later if its current guards still permit it. Do NOT describe every retry as read-only reconciliation. Lost tab/sessionStorage is still outside this tab-local recovery guarantee. Do not re-enter an uncertain opening as a new receipt or change its original reference.

The empty/unused recovery draft checks exact source/security/ACL/table shape and REFUSES after opening metadata exists. It never deletes opening receipts, consumed stock/cost history or pending references. After use, stop new entries, reconcile saved operations and use a separately reviewed additive forward fix. Do not roll back to a client unable to interpret opening outboxes or month cutoffs.

## Reports and deployment dependency

Expiry displays show opening source/count date, original label/precision, manufacturer unknown or actual value, separate internal reference, usable-through date for month precision and unavailable-from cutoff/countdown. Legacy delivery display semantics stay intact.

Inventory headings describe generic stock lots, nearest stop-sale dates and value at cost rather than implying manufacturer batch counts or new purchases. Dashboard availability and POS earliest-eligible-cutoff allocation retain existing predicates. Action Center draft terminology avoids presenting an internal cutoff as a printed exact expiry day.

Opening provenance is fetched by bounded, complete keyset pagination until EMPTY (not short-page termination), validated and joined by batch ID. Missing schema/metadata or inconsistent data **blocks the stock-batch/Expiry report** rather than silently labelling openings as deliveries. Consequently this client is NOT ready for deployment before separately qualified/approved schema support. Metadata calls across pages are not a transaction snapshot. Limits deliberately fail closed rather than return incomplete provenance.

## Illustrative Ebona onboarding walkthrough — SYNTHETIC FIGURES ONLY

The actual Ebona bottle/sachet counts, prices and pack definitions were not present in the supplied conversation; these are demonstrations, NOT extracted stock records, actual Ebona costs or invented manufacturer batches. Replace them with the signed count sheet's supported values before any real use. No sample data has been entered into a database.

### Bottles

1. Define/select a synthetic product sold/countable as whole bottles: base unit bottle, selected unit bottle=1 bottle. Do not divide by millilitres unless the real product is actually defined/dispensed that way.
2. On Opening stock, set physical count date2026-11-10. Illustrative count6 bottles, documented illustrative cost₦1,500 per bottle; review shows6 base bottles,₦1,500 per base bottle and₦9,000 stock value.
3. Leave Manufacturer batch unknown checked. Add original expiry label11/2026 with month precision. The generated OPEN-… reference is explicitly an INTERNAL lot, not a manufacturer number.
4. Review cutoff2026-12-01 / usable through2026-11-30; confirm only after count-to-entry reconciliation. Entry timestamp remains actual submission time. No new payment is recorded.

### Sachets

1. Select a different synthetic product with base unit sachet and a documented illustrative box=12 sachets. This is an example definition, NOT a claim about Ebona's actual packaging or tablets per sachet.
2. Illustrative count3 boxes at₦120 per box gives36 sachets,₦10 per sachet and₦360 stock value. Do not enter₦120 as the cost per sachet when selecting boxes, or substitute the selling price.
3. Unknown manufacturer remains checked; enter original month/year label only for the physically identifiable counted group. If amounts for different expiry months are separately known, add separate internal lots. Do not guess a split.
4. For an inseparable/uncertain expiry quantity, choose Unresolved or mixed, enter counted quantity and select Mark quantity as not loaded. Retain it on paper and physically hold it outside saleable picking until resolved; it is NOT a submitted stock layer.

## Verification evidence and limits

Meaningful synthetic tests exercise real calendar/schema helpers, server DAL dispatch with fake authenticated/RPC boundaries, exact recovery/storage controls, actual form callbacks and precision-aware report reads/rendering. They include bottle/sachet conversion walkthroughs, month/leap/year/Lagos boundaries, unsupported expiry/cost/payloads, changed scope/references, uncertainty/reload/retry after cutoff, legacy delivery compatibility, capped pagination/late failure and report cost visibility. SQL tests inspect source/contracts and exact embedded pins only—not native PL/pgSQL execution or atomicity proof.

Independent integrated review caught `MM/YYYY` being accepted by the writer but rejected by the first report reader. A failing actual-DAL regression reproduced it. Reader and writer now share the same calendar helper, preserving both label spellings. Initial source/test failures are retained as historical evidence; final logs/candidate hashes are supplied externally. A separate fresh follow-up reviews the correction; no review is represented as live target approval.

Local typecheck, scoped lint, full inherited/new Node suite and production build results are recorded in the external review package. No hosted browser, native SQL, PostgREST/JWT, production tenant isolation or clinical batch traceability qualification is claimed. Existing patched dependency manifest/lock/Bun config remain byte-identical to the reviewed base; no installs/upgrades occurred. SQL qualification, compatible schema deployment, targeted runtime acceptance and publication remain separate owner gates.
