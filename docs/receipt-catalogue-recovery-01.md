# Receipt catalogue recovery correction

Bounded task: PHARMANUDGE-RECEIPT-CATALOGUE-RECOVERY-01, PR #4 comment 6342446416. Additive correction to draft PR #16, input `935baddfa05249aa943c5b1b0f3d701c682cf273`.

## Contract

- Route admission still requires owner/pharmacist membership. The server retains session, pharmacy, user and role authorization. Catalogue responses carry the server-resolved user/pharmacy identity; client comparisons reject mismatched responses and are not authentication authority.
- The actual route loader returns an explicit identity-bound `available`/`unavailable` outcome. A successful empty catalogue remains distinct from a rejected read. Unavailable reads expose only fixed sanitized text and leave the saved-request recovery shell reachable.
- Recovery uses the existing session outbox without a storage-format change. Mount does not dispatch. Explicit retry sends the exact persisted immutable payload/reference even when the catalogue is unavailable. Confirmed requests remain until the existing explicit acknowledgement succeeds.
- Unavailable/unresolved catalogue state blocks new-delivery entry and acknowledgement. Successful refresh does not bypass pending confirmation, recovery readiness, unavailable storage or single-flight guards.

## Refresh and race boundaries

A resolved `router.invalidate()` promise is not evidence of usable catalogue data: a loader which catches its read error can leave the route in `success` with an `unavailable` outcome. The receiving form instead awaits the explicit result of its identity-bound catalogue query.

A current-scope loader failure immediately hides entry controls and locks the form. Cached loader success cannot release a failure/local-refresh lock. Once a failure/local refresh has taken ownership of availability, a successful explicit refresh is required to unlock; the refresh control remains available even after a successful read. Background loader failures may conservatively lock the form again rather than trusting a potentially stale success.

Concurrent explicit refreshes are latest-request-wins. Starting refresh clears usable catalogue state; older completions cannot release the newer lock. Unmount/identity change invalidates outstanding refresh epochs. Response identity and cached loader identity must match the currently mounted user/pharmacy. A scope-mismatched initial cache stays unavailable until an explicit successful current-scope refresh. None of this establishes live backend concurrency or cross-tab durability.

## Offline evidence and limits

The principal regression executes the actual route loader with a rejecting synthetic query, mounts the recovery shell with a persisted uncertain submission, checks no automatic dispatch, then retries byte-equivalent JSON/reference. It fails against the original source because the loader rejects before mounting.

The inherited combined suite is retained. Additional cases cover failed reads with/without an outbox, continued failure, single-flight retry, successful refresh followed by acknowledgement, storage denial, concurrent refresh settlement orders, user/pharmacy changes, foreign response metadata and route-role admission. An installed TanStack in-memory router executes the actual loader and demonstrates resolved invalidation with an unavailable result; this is not browser/DOM acceptance.

Validation uses installed dependencies and the existing reviewed network-denying synthetic environment only. Local source/offline results do not qualify browser hydration, real sessions, real HTTP/storage, live RLS, receipt transaction/idempotency behavior or release readiness.

## Unchanged holds

No migration, storage cleanup, new receipt reference, automatic replay, real authentication, live backend write, browser launch/retry, provider/spending activation, service/security change, merge or deployment is part of this correction. Same-tab/session storage limitations remain. Preserve uncertain outboxes and reconcile their original references in the original authenticated context; do not roll back to an incompatible client/server pair. The existing release acceptance/rollback matrix and all independent-review, browser, live-system and owner approval gates remain in force. Included-only enforcement remains unverified/default-denying.
