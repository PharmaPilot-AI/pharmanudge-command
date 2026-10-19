# Bounded coordination windows (disabled by default)

This is a **coordination-only** bridge, independent of the coding/publication runner. It reads explicitly allowlisted GitHub comments, recognizes a fixed machine protocol and sends fixed-category project notifications. It cannot interpret natural-language tasks, start an agent/worker, call a model, publish source, merge, deploy or mutate application/business data.

This revision is implementation/review preparation. It is **not authorized to run** by the earlier single-trial or earlier-source approval. A coordinator must approve the new reviewed commit and an explicit authorization-window identity before activation.

Runtime requirements: Python 3.11+ on a POSIX/Linux operator host, trusted `git`, authenticated `gh`, and the existing project `pharmanudge` notification wrapper on the operator PATH. Process-group/locking tests use Linux facilities. No packages, agents, services or scheduler are installed by this source.

## Scope and trust

- Repository: `PharmaPilot-AI/pharmanudge-command`; threads **PR #4 and PR #8 only**. Other threads are rejected, not inferred from links/labels/prose.
- Coordinator: numeric GitHub ID `319955168` **and** login `PharmaPilot-AI`. A matching display name alone is insufficient. Both are public authority pins, not credentials.
- A shared GitHub account cannot distinguish different humans/agents sharing that account. The runtime, operator environment, installed `gh`/project notification wrapper and same-UID filesystem are trusted. This is not host-level or adversarial-worker isolation; existing coding-runner isolation prerequisites remain unresolved by this bridge.
- No comment can choose executables, shell arguments, repository, destination or tools. Notification routing uses the already configured project wrapper/home destination; no bot tokens or private routing values belong in source/examples/logs.

## Fixed protocol, not executable instructions

The event marker is `PHARMANUDGE-COORDINATION-V2`, followed by one strict JSON object. Window/event/task identities are UUIDs. Actions are only `ping` and `status`. Categories are only `task_received`, `result_ready`, `blocked`, and `owner_decision_needed`. The current window must match; malformed/extra fields, unsupported identities/threads/markers and old trial messages have no authority.

Only meaningful status milestones may notify: `result_ready`, `blocked`, `owner_decision_needed`. **Idle polls, pings, task acknowledgements and self-generated receipts never notify.** Meaningful milestones are deduplicated by thread/task/category, including repeated status comments with new event IDs. A fixed ping/pong receipt is bounded separately and uses `PHARMANUDGE-COORDINATION-RECEIPT-V2`, which is not an input marker. Receipts must not create feedback loops.

An authority comment uses the distinct marker `PHARMANUDGE-WINDOW-AUTH-V2` and a strict policy object pinned to the reviewed source SHA and unique window identity. Merely mentioning an approval in prose or copying a worker result does not authorize a window. Exact schema and CLI details are documented with the tested implementation below before activation.

## Immutable window and effects

The supported upper envelope is **24 hours**, **288 total polls**, **300-second intervals**, and **12 total owner-notification attempts**. Fixed coordination receipt attempts have their own bounded allowance. No automatic renewal, burst catch-up, permanent recurring job or in-memory-only budget. Actual arming time, absolute expiry, authority/source fingerprint, counters, per-thread cursors, milestone/event deduplication and uncertain-effect state persist durably.

The new canonical window registry is separate from the consumed original trial ledger and STOP. The old trial is not opened, reset, repurposed, replaced or copied into a fresh budget. Reinitializing the same window or using a changed configuration/source/approval must not renew it. At most one window may be active. Expiry, STOP, exhausted budget, invalid state and unverifiable authority prevent further effects.

Events are admitted durably before cursor advancement; a crash before an external attempt must not silently discard them. Immediately before publication/notification, its attempt and budget charge are persisted. An interrupted/uncertain external attempt is a hold for reconciliation, **never an automatic resend**. This is at-most-once attempts, not exactly-once delivery: a crash before send can lose a notification, while an API timeout can still have taken effect. STOP cannot recall an external API call already in flight.

Locks prevent overlap. Reads, pagination, output sizes, subprocesses and sleeps are bounded; errors/logs never dump thread bodies, questions, private data, headers, secrets or raw provider/backend output. No AI call occurs on idle or any other poll.

Catchable supervisor termination is handled through owned-process-group cleanup. **Uncatchable SIGKILL, host/kernel failure or adversarial same-UID interference are not a guaranteed command-containment boundary.** This source installs no independent watchdog/service; a command/API call already in flight cannot be recalled by a ledger. Unknown attempts remain held, not retried. External process containment is needed if hard supervisor-death enforcement is required before activation; do not treat at-most-once journaling as proof that an orphaned process was killed.

Subprocesses receive only an explicit HOME/PATH/LANG and GitHub client-control environment (plus an operator-selected `GH_CONFIG_DIR` when present), not inherited Hermes profile selectors, provider keys or token environment variables. GitHub authentication is the existing on-disk CLI configuration; the notification wrapper selects its existing project profile. Source and fixtures contain no private routing values.

## Coordinator trigger boundary

A visible GitHub result and a coordinator event-triggered review are coordination observations—not an autonomous coding loop or proof of host-level enforcement. This program does not configure a ChatGPT wake mechanism, webhook, gateway, schedule or service. Use only a separately established coordinator trigger. If none is available in an environment, report that boundary; a scheduled read-only review requires separate opt-in, tooling restrictions and cost approval.

## Reviewed schema and operator commands (future approval only)

`bridge.example.json` is inert: `enabled:false`, `dry_run:true`, and all three authority fields are null. It is not a live deployment configuration. No private operating configuration or actual window is created by this PR.

The separately approved private configuration has **exactly** these keys: `enabled`, `dry_run`, `approval_comment_id`, `source_sha` (full 40-character reviewed commit), `window_id` (canonical UUID). Live flags are permitted only after review and explicit activation approval. No state-root, destination, command, limits or repository override is accepted.

A coordinator authority comment on **PR #4**, under its pinned identity, must contain this exact marker followed by a strict JSON object:

```text
PHARMANUDGE-WINDOW-AUTH-V2
```

Object keys: `window_id`, `source_sha`, `threads:[4,8]`, `duration_seconds:86400`, `max_polls:288`, `poll_seconds:300`, `max_notifications:12`, `max_receipts:12`. The IDs/SHA are deliberately not supplied here: they require the future reviewed source and a fresh explicit approval. Duplicate keys, extra fields, changed approval text and other caps are rejected. Reusing an approval comment for a different window is rejected by the persistent registry.

Event objects have **exactly** `window_id`, `event_id`, `task_id`, `action`, `category`. UUIDs must be canonical; a ping must use `category:task_received`. No free-text field is accepted. A task/category is a milestone within its thread; an event UUID is deduplicated across the entire window.

After separate approval only, an operator may run the following from a clean checkout of the exact reviewed commit, with `CONFIG` referring to their private approved configuration:

```sh
python3 tools/pharmanudge-bridge/bridge.py --config "$CONFIG" init
python3 tools/pharmanudge-bridge/bridge.py --config "$CONFIG" run
```

`init` authenticates the approval and captures both thread baselines, then arms the immutable window. It is not a preparation command. The first scheduled poll is 300 seconds after arming; later polls never burst to catch up. The 288 figure is an upper bound, not a promise to make 288 polls before absolute expiry. Charged read failures preserve the next permissible poll time across process restarts; they do not authorize immediate retries, replacement windows or a background restart service.

`run` is one finite foreground process, not a daemon installer or scheduler. Process overlap is locked out. The canonical per-user registry is under `$HOME/.local/state/pharmanudge-coordination-windows`; tests inject separate temporary roots. This path is not an adversarial trust boundary. Arming freezes the configuration, approval fingerprint, actual arming time and absolute expiry. On halt, durable window state becomes `enabled:false,dry_run:true` and retains STOP, counters and deduplication. The immutable authorization/config manifest is retained for audit, not rewritten to manufacture a new budget.

Offline stop is intentionally available without configuration, credentials, source verification or network, including after expiry:

```sh
python3 tools/pharmanudge-bridge/bridge.py stop
```

A global STOP remains latched after operator stop. Removing it or reconciling a corrupt/uncertain window is a manual, separately authorized operation—not normal restart behavior. A retained old trial STOP is neither read nor cleared by this registry.

## Offline validation

Run from the repository root:

```sh
python3 -m unittest discover -s tools/pharmanudge-bridge -p 'test_*.py' -q
python3 -m compileall -q tools/pharmanudge-bridge
python3 tools/pharmanudge-bridge/bridge.py --help
git diff --check
```

Preparation verification: **27 tests passed**. Fixtures cover the strict protocol, both supported/unsupported threads and identities, malformed/duplicate/deep JSON, immutable authority/source/windows, both thread baselines, restarts and overlap, 300-second scheduling and durable budgets, expiry/STOP, corrupted state, cursor/admission crash boundaries, uncertain publication and notification, and idle/ping/acknowledgement/receipt loop suppression. Real local synthetic subprocess tests cover output/deadline/process-group cleanup, including a parent exiting before its descendant, SIGTERM of the supervisor, and SIGTERM/SIGINT/SIGHUP injected at the spawn-return ownership boundary. Additional checks retain exact parent handlers and caller/child masks (including a preblocked signal) through successful launch and startup failure; unrelated secrets/profile selectors are not inherited. CLI fixtures use sentinel executables and temporary HOME/state; the disabled example refuses `init`/`run` without external invocation or initialization. Compile/help/whitespace and a source-publication scan also passed.

These are offline/fake-network and synthetic local-process checks, **not** evidence of a live bridge run, real delivery or a new authorization window. No live polling or notification was used to validate this revision. Source/authority halt handling and deeply nested malformed JSON were reproduced as failing independent regressions before correction.

## Release posture

- Example configuration remains disabled/dry-run with no active authorization.
- Preparation must use only offline/fake-network fixtures and local synthetic subprocesses. No live polling or notification is permitted for this revision during preparation.
- Activation requires coordinator review of the exact new commit, fresh explicit window approval, and separately authorized operator arming.
- Expiry/stop retains consumed state and STOP and restores disabled/dry-run operation. Never delete a ledger to make a test pass or replay an uncertain event.
- The application, original trial, coding-runner state and unrelated services are out of scope.
