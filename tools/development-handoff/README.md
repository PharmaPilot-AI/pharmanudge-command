# Development handoff controls — offline implementation only

Implements the preparation scope of [DEVELOPMENT-HANDOFF-02](https://github.com/PharmaPilot-AI/pharmanudge-command/pull/4#issuecomment-6272073625), following [the consolidated proposal](https://github.com/PharmaPilot-AI/pharmanudge-command/pull/4#issuecomment-6271977657).

**Not activated. Not a working autonomous development loop.** This package implements the deterministic controls and filesystem quarantine, with authenticated host/broker/process/transport contracts exercised by synthetic adapters. No live adapter is supplied. `UnavailableHost` rejects missing capabilities; the CLI has no dispatch/arm/run command and cannot enable execution through JSON flags. No worker, nested agent/reviewer, model call, container, listener, cron, service or account is created by this package's inspection CLI or its tests.

The active coordination bridge and the old coding runner/publisher are not modified, imported, activated or reconciled. This source neither executes the historical result publisher nor changes its consumed claims/budgets. Independent source review and separately approved host integration/activation remain mandatory.

## Scope and files

- `handoff.py`: strict ingress/policy parsing; one-trial vault; execution capability enforcement; fixed isolated job plan; sealed-output quarantine; independent-review/publication-plan gates; per-request inference authorization journal; inspection-only CLI.
- `test_handoff.py`: synthetic transport, legacy, isolation, process, reviewer and metering adapters; real temporary-file persistence/export checks. **No real network/provider/process adapter is used.**
- `trial.draft.json`: concrete disabled P0 login-hardening trial proposal, not execution approval. Future issue/body/source/window/time/policy pins remain null.
- `implementation-reference.json`: exact public implementation-request identity/body digest, explicitly not future execution authority.
- `.gitignore`: local bytecode exclusions only.

Requires Python 3.11+ on a POSIX/Linux operator host. Standard library only; no dependency install/download. The later login fix is not implemented here and no application file is changed.

## Authority and immutable controls

Repository is exactly `PharmaPilot-AI/pharmanudge-command`; assignment inbox is PR #4. Coordinator requires both numeric GitHub ID `319955168` and login `PharmaPilot-AI`. A shared GitHub account is not proof of distinct independent roles.

The assignment marker is exactly `PHARMANUDGE-TASK-AUTH-V1`, newline, one strict JSON object with exactly:

`execution_window_id`, `assignment_id`, `repo`, `issue`, `author_id`, `author_login`, `task_body_sha256`, `base_commit`, `runner_source_sha`, `executor_source_sha`, `policy_sha256`.

Canonical UUIDs, exact integer types, full hashes, fixed actor/repo/thread, created-only action, unedited valid UTC creation time inside the approved window, and every task/base/source/policy pin are required. Duplicate keys, oversized/deep/malformed JSON, added fields, result/self markers and prose cannot create authority. Task body is fetched from the canonical open non-PR issue and checked as exact UTF-8 bytes; its creator and all three main/base references must match. Task prose is bounded task data passed as a single JSON argument, not executable control or a shell command.

`Controller` requires a genuinely approved policy and trusted code-provided host object. Adapters cannot be named/configured by task JSON. The host identity must match the reviewed control source SHA, with authenticated external capability bindings to the exact window/policy.

`Store` is a **single-trial canonical vault**, not a perpetual dispatcher. Its default per-user path is `$HOME/.local/state/pharmanudge-development-handoff`; no CLI accepts another state root. Internal constructor roots are for trusted embedding and temporary tests, not an adversarial boundary. `arm` refuses any existing state or STOP, including a dangling STOP symlink. Changing UUID, source, policy or configuration cannot renew/reinitialize the vault. There is deliberately no reset/refund/reconcile or subsequent-window CLI. Supporting further windows requires a separately reviewed ledger-preserving integration, not deletion or a substitute root.

Actual arm time, approved absolute end, policy digest, predecessor snapshot digest, first cursor, next poll, charges, request IDs and outcomes persist atomically with file/directory fsync and 0700/0600 permissions. Loaded **and proposed** state is validated before writing/effects. One nonblocking lock spans each whole lifecycle operation. Clock rollback, expiry, STOP, invalid state, stale authority, absent capability and exhausted budgets deny further starts.

The predecessor guard must authenticate a read-only snapshot covering canonical ledger/config identity, all consumed claim keys, unknown/claimed holds, daily attempted-start count, disabled execution and predecessor STOP. It must cooperate with exclusive operator ownership of the old dispatcher. Any consumed matching task, unresolved unknown, STOP, four-start ceiling or snapshot drift rejects the new dispatch. The package never reads/writes the real predecessor state by itself: its default binding is unavailable. The old claims are not copied into an empty replacement budget.

## First-task envelope and execution adapter

The fixed proposed policy is one task / one charged start total, at most 12 polls at 300-second spacing, a nonrenewable window of at most 3,600 seconds, worker runtime at most 1,200 seconds, cleanup at most 30 seconds and 30 tool-calling iterations. A start requires enough remaining window for runtime plus cleanup. The existing runner's provider/model remains `openai-codex` / `gpt-6.1-sol`; no automatic provider fallback.

The draft proposes a maximum 1,000,000 micro-USD reservation (US$1). **This spend allowance is not approved by this implementation request and is not a verified live dollar cap.** Time, turns and token estimates are not monetary limits.

The immutable `JobPlan` specifies:

- fixed argv, working directory `/workspace`, no shell/approval-bypass flags;
- non-root UID, read-only root, no-new-privileges, no Linux capabilities or host mounts;
- only HOME/PATH/LANG in worker environment, no inherited credentials/profile selectors;
- broker-only network, 1 CPU / 2 GiB / 128 PIDs;
- bounded run/kill deadlines, exact assignment and policy identity.

The **trusted external isolation adapter** must verify a pinned dependency/image/filesystem/network policy, create only the approved scratch workspace, keep all tools inside the boundary, provide broker-only inference access without shared provider/GitHub/host credentials, independently enforce absolute kill/lease expiry, and stop/reap the owned job on guard failure. Plans and DTOs are requests to that authenticated boundary, **not evidence that Linux/container enforcement occurred**. No Docker/bwrap/VM implementation or provisioning is hidden in this source. A profile, root process or worktree is not a sandbox.

Admission is durable before cursor advancement; a definitely unattempted exact admission can recover. The canonical control comment is re-fetched and its full-record/body digest and parsed pins are checked again before charging, reservation and process guards; edits/removal cannot silently substitute authority. These are freshness checks, not an atomic GitHub revocation transaction; independent lease/STOP enforcement is still required. Before reservation/process preparation, the one start is durably charged. The reservation request UUID and stage are saved before calling the external broker; process intent is saved before adapter invocation, with a guard after each intent fence. Interruption/uncertainty after charging latches unknown and STOP; restart cannot reserve/start again. A grant is revoked on exit; revocation never refunds the consumed start or proves that a dead controller contained a running process. Independent containment remains a host prerequisite.

## External budget integration

`InferenceGate` is the separate control-plane integration for every model request, not an in-worker price calculator. It accepts only a bound `Grant` and authenticated broker implementation. Worker requests have only `request_id` and bounded `payload`; callers cannot set provider URLs, model, budget, prices or authorization.

The broker contract is:

1. `verify_grant` authenticates window/policy/claim, expiry and the **externally enforced** total allowance.
2. `authorize_call` atomically reserves a provider-enforced per-call maximum within that grant and returns an authenticated `CallPermit`.
3. `execute_bounded` cannot charge beyond that permit, and must enforce lease/deadline independently of controller lifetime.

Locally, reservation intent is journaled before authorization; the returned maximum is checked against the integer micro-USD total and journaled before outbound execution. No automatic refund. Duplicate IDs cannot resend; interrupted authorization/call holds the whole grant across restarts and across new request IDs. Overspend, missing attestation, early/expired calls, late responses and contract violations reject. Journals retain only identities, amounts, phases and response digests—not prompts/responses/keys. A 256-request metadata ceiling also bounds journal growth.

**No real broker or billing attestation exists in this package.** Fake prices/responses in tests prove ordering, arithmetic and fail-closed logic only. A broker that merely returns `true`, estimates tokens, or detects overspend after billing is not a verified hard dollar cap. If the chosen provider/account cannot supply enforceable billing semantics within the approved capability, live execution must remain blocked; no new provider/account/billing change is authorized here.

## Quarantine, independent review and publication

The host must first provide an authenticated seal for the exact completed output ID and policy, proving the worker cannot still mutate the exported tree. `export_output` then opens files with no-follow component checks; rejects unexpected/hidden paths/directories, symlinks, hardlinks, devices, executables, non-UTF-8/control bytes, unstable/oversized reads and overlapping roots; and imports captured bytes into a new private operator quarantine without copying Git metadata, ownership, ACLs or credentials. Existing quarantines are never overwritten. Failed partial imports are retained for manual inspection, not automatically reconciled.

The first trial accepts exactly:

- `src/routes/login.tsx`
- `src/lib/auth/login-native-fallback.test.cjs`

Byte limits remain 128 KiB/file and 512 KiB aggregate, narrowed to these two paths. Export manifests bind path/size/content digest/Git text mode. A quarantine hash is not proof of safe content or a meaningful login fix; independent validation must check the actual diff, privacy and scoped synthetic regressions.

`review` journals intent before contacting an independently authenticated validator. Worker JSON or a self-reported PASS is insufficient: a bound `ReviewStamp` must match the window/claim/policy/exact export manifest, have a real evidence digest, an independent reviewer principal and approve only a draft. No second reviewer call follows uncertainty. The test validator returns explicitly synthetic evidence; no new reviewer inference is launched. A real validation service must rerun tests without spending/model calls unless separately approved under the same external allowance.

`publication_plan` rehashes quarantine and verifies the recorded approval/evidence, but always returns **`publication_enabled:false`, `draft_only:true`**. It is NOT an old-publisher approval or historical runner claim. The quarantine manifest omits base-relative Git change metadata; a separately reviewed trusted importer/translator must establish the real operator-owned result worktree/claim/base and existing publisher's complete manifest, then obtain its exact independent publication approval. Never paste this plan into the old approval schema or publish the historical claim. No Git/PR/notification publisher client is included here.

## Missing live bindings / activation gate

Still required and deliberately not provisioned:

- authenticated canonical GitHub ingress and actual clean-source verifier;
- exclusive, read-only predecessor-state guard;
- externally enforced non-root filesystem/network/process/absolute-expiry isolation and authenticated seals;
- genuinely budget-limited inference service, billing semantics and private scoped capability provisioning;
- independent validator identity and trusted quarantine-to-result/publisher translation;
- exact future issue/body hash, new execution UUID, final reviewed source/policy hashes, explicit start/end and separate owner approval.

No webhook, public listener, service, scheduler, worker profile, shared wrapper or active status bridge is changed. Supplying any real adapters requires another reviewed source revision and separately approved provisioning; approval of this disabled draft cannot authorize unreviewed backend code or config-only capability claims. One future finite operator controller can call `poll` on the approved schedule only after all integrations are reviewed and approved; this preparation does not install that controller. GitHub comments and a draft PR do not wake an implementing agent by themselves. No working autonomous loop is claimed.

## Offline verification and inspection

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tools/development-handoff -v
python3 -m compileall -q tools/development-handoff
python3 tools/development-handoff/handoff.py inspect-draft tools/development-handoff/trial.draft.json
python3 tools/development-handoff/handoff.py check-live
# check-live intentionally returns exit 2, live_ready:false
```

Tests use fake network/provider/process/isolation/reviewer adapters and temporary local files only. There is no real worker or additional inference process. Tracer tests and corrective regressions were observed RED then GREEN; additional existing-behavior checks are characterization, not claimed as new RED evidence. Unit success is not live sandbox/billing/provider or future application acceptance evidence.

The disabled draft inspector reports canonical SHA-256 digests of the current policy and assignment **templates**. They are not active authorization digests and must be recomputed after future owner-approved fields are filled. The implementation-request body digest is genuine provenance only. No future issue/body/source/window pins are fabricated; the real new source commit is reported in the draft PR, avoiding a self-referential commit hash embedded in its own files.

Independent source review remains outstanding. This task explicitly forbids launching additional inference/reviewer processes, so only local self-review/static checks and offline tests are performed here; no independent-review badge is claimed. Stop for coordinator review after publishing this disabled source.
