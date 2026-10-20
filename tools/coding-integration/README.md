# HANDOFF-04 — disabled coding integration

Authority: PR #4 comments **6286613477**, **6286981216**, **6287038586**.
Based on PR #11 `ea4b40272a1d955dc3c5e1bc63baaa936e41c043`; inherited files are unchanged.

**Preparation only. No active queue, supervisor, coding/reviewer process, provider
request, publication of an application result, service, timer or webhook is
installed by importing this directory, running tests or inspecting status.**
The owner selected included allowance only/no extra spending and requested
provider-confirmed pause/resume. This clarifies the business envelope, not
activation permission or evidence of included-only enforcement. A strict-USD
alternative is also prepared, not selected or enabled.

## Components and privilege boundaries

- `control.py`: canonical task record digest, immutable policy, operator-private
  queue/lock, source/base/predecessor checks, separate approval/review/publication
  authority and durable start/uncertainty/correction/publication states.
- `runtime.py`: real configurable `/opt/...` argv entry point, **behind default
  denying admission**; trusted Git blob checkout without hooks, filters or `.git`;
  Docker creation/inspection, output capture/quarantine, content-addressed
  checkpoint storage/restoration. Only the two explicit application paths may
  be imported. The base checkout is limited to 32 MiB / 10,000 regular files;
  symlinks/submodules and unsafe paths are refused. Root inputs are read-only.
- `warden.py`: immutable namespace PID 1, UID/GID 65534, non-dumpable, with a
  maximum 900-second UTC+monotonic lease. Writable work/output/temp are bounded
  tmpfs (128/1/8 MiB); stdout/stderr go to DEVNULL, not an unbounded host log.
  Worker descendants are namespace-killed before output export and at expiry.
  The host operator is root; workers never get a host socket/home/control vault.
- `supervisor.py`: one finite foreground controller, durable **12 tick total**
  ceiling, one concurrent runtime, at most **2 total attempted starts**, 1 review
  and 1 correction. A resume also consumes a start; exhaustion can leave no
  correction/restart budget. No reset refunds or replenishes anything.
- `publisher.py`: separate trusted Git plumbing builds an operator-owned commit
  from exact captured blobs; no worker hooks/filters/Git configs are used. An
  explicit private publication approval binds the exact manifest. Push is
  **nonforce**, to the fixed repository and deterministic `handoff4/<policy>`
  branch, then a **draft** PR to `main`. Exact head, repo, branch, draft/open
  state, title/body/manifest are required for reconciliation. A durable intent
  precedes any remote mutation. Any partial push/POST outcome holds; restart
  only reads/adopts an exact matching PR, never retries a mutation blindly.
- `cli.py`: operator-only entry points. Production vault is fixed at
  `/var/lib/pharmanudge-coding-handoff04`; no alternate-root/reset/renew CLI.
  Library tests use disposable private vaults, not the production root.

The local operator must independently authorize the exact policy digest in a
root-owned mode-0600 `approval.json`, outside every worker mount. Matching GitHub
username, account/app identity or repository prose is **not** that approval.
Only the constant narrowly scoped login task text is passed to the coding entry;
arbitrary GitHub body text is not a shell command, prompt permission or policy.

Canonical reads use authenticated `gh` against the fixed repository/thread and
refetch exact task/source/base/policy/predecessor pins at admission and important
boundaries. All three preparation comment body pins are rechecked by the CLI.
The predecessor lock is opened only if already present; consumed claims/daily
charges and any STOP/unresolved state remain authoritative. The new queue has no
API to clear the old ledger or reopen uncertain outcomes.

The trusted operator/Docker daemon/kernel remain trusted. A container is not a
VM audit. Immutable configuration checks, no network/capabilities/devices,
non-root runtime, descriptor-based no-follow/nonblocking export and separate
review reduce scope; they are not a hostile-kernel or arbitrary-code security
certificate. The output scanner rejects selected secret-like markers but is
**not** a general secret detector; independent publication sanitation is still
required. No real credentials are supplied to demonstrate secret isolation.

## Included-only and strict-USD modes (both disabled)

`NoProvider` is the **only shipped production provider binding**, and denies
both modes. Test brokers are clearly synthetic and cannot prove billing.

### A — included-only, zero additional spending

Owner's restriction is honored: no purchased credits, automatic top-ups,
paid overages, secondary credentials or provider fallback may be consumed.
This is **not a guaranteed per-task USD ceiling**. Activation requires privately
attested provider-side enforcement, not a boolean claim/local quota counter.
Neither the private account state nor a restricted job credential was inspected,
created, copied or changed. Shared OAuth must never be mounted/copied into a
worker. Current source cannot qualify or turn on this mode by editing flags.

### B — strict monetary contract

Retains fail-closed hard pre-dispatch maximum-reservation semantics. Ordinary
project thresholds, prepaid balance, estimates, token/time bounds and plan
quota windows are not a contract. The proposed earlier US$1 amount was not
activated and is not inferred from the included-only clarification.

### What is actually supported and what is missing

Public [Hermes provider docs](https://hermes-agent.nousresearch.com/docs/integrations/providers)
confirm ChatGPT/Codex OAuth support. Read-only inspection of installed
`hermes_cli/auth.py` found a non-inference Codex **usage GET** mechanism:
`_codex_usage_probe_url` / `_probe_codex_quota_restored`; it examines reported
primary/secondary windows and uses a 300-second throttle. It was **not called**.
This means a non-inference status route exists, not that it proves included-only
billing or grants worker-safe credential delivery. That helper operates on
shared OAuth credentials, and other auth helpers can mutate shared cooldowns;
none is imported/called here. No inference probe or auth-store mutation is used.

[OpenAI's Codex plan documentation](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
describes plan limits and optional credits. A remaining usage window alone does
not attest that credits/overages cannot be consumed. No unsupported blanket
claim that provider controls can never exist is made.

**Smallest supported alternative now:** remain paused/zero-call. To enable A,
first establish a supported server-enforced included-only entitlement for the
selected account/model, and qualify an operator-owned narrow broker that keeps
OAuth outside the worker. If the provider cannot establish this, there is no
safe flag/local-counter workaround; retain NO-GO rather than switch providers,
buy credits or relax the owner's instruction. The generic Hermes proxy is not
represented as an included-only billing boundary.

## Exhaustion and resume protocol

A qualified trusted broker must report exhaustion through `Exhausted`, after
capturing/exporting bounded checkpoint bytes and verifying all worker descendants
are stopped. The checkpoint hash alone is not content; `checkpoint()` stores
fsynced allowlisted bytes, and `restore()` requires the exact hash before a new
runtime can use it. Quiescence uncertainty becomes **unknown**, not paused.

`resume()` only considers pending paused work; it respects the provider-reported
absolute retry/reset time, and requires fresh positive **non-inference** status.
No fixed five-hour assumption exists. Unavailable/malformed/stale status stays
paused; a still-exhausted report updates the next provider time. No positive
inference call is used as a probe. Every resume revalidates local operator
approval, source/task/base/policy, predecessor, STOP and absolute expiry. An
allowance reset never renews a window, recreates a claim, refunds a start or
bypasses review. The finite controller can automatically advance paused work
when its qualified broker confirms availability; unknown status exits paused
instead of busy-polling. No such broker/controller is running here.

The new Docker coding runtime and broker exhaustion/checkpoint handoff have
**not** been live-qualified; tests inject fake engine/provider events. In the
shipped configuration there is no real broker transport or approved coder
binary, and therefore no live exhaustion event, credential delivery, quota GET
or coding request can occur. This is an explicit external capability blocker,
not successful end-to-end provider integration.

## Review and correction

Captured output enters `review-needed`. The separate coordinator/operator writes
mode-0600 `review.json` with exactly:

```json
{"policy":"<exact-policy-sha256>","manifest":"<exact-output-sha256>","verdict":"approve"}
```

Verdicts: `approve`, `correct`, `reject`. One review is consumed. `correct`
authorizes at most one bounded correction, starting from the captured result;
a second review invocation cannot replenish review/correction budgets. The
operator must convey authenticated narrowly scoped correction guidance through
the independently approved task entry contract; no worker text becomes review
or permission. After correction, exact final-content publication approval is
still required (separate operator attestation of corrected content), not an
implicit second model reviewer. Private review/signing ingress and coordinator
wake-up have not been provisioned. A GitHub comment alone is not sufficient.

`publication-approval.json` is exactly:

```json
{"policy":"<exact-policy-sha256>","manifest":"<exact-final-output-sha256>","approved":true}
```

Unknown PR outcomes require inspect-only reconciliation. If the push succeeded
but POST has no provable result, operator reconciliation is required; no
automatic second POST. Local commit preparation also refuses an existing target
rather than blindly creating another result after an interrupted operation.

## Proposed finite application task (NOT EXECUTED)

One login safeguard task: prevent credential-bearing native GET fallback without
hydration while preserving hydrated submit/redirect behavior. Dummy values only;
no login, real user, pharmacy, backend or provider test. Allowed paths:

- `src/routes/login.tsx`
- `src/lib/auth/login-native-fallback.test.cjs`

Proposed absolute window: **2026-10-21 12:00:00–13:00:00 UTC**, max 1 hour.
This is an unapproved proposal; if it expires, STOP. Do not auto-shift or renew.
One concurrent worker, max 900 seconds per attempted execution, 2 total starts
(initial plus correction OR one checkpoint restart), 1 independent review,
at most 1 correction, 12 total controller ticks, 1 CPU/512 MiB/64 PIDs,
128 MiB work + 1 MiB output + 8 MiB tmpfs, outbound **none**.
No dependency fetch, package lifecycle scripts or general outbound gateway.
A genuinely restricted broker path would require separate source/policy review;
the current no-network/no-socket plan intentionally cannot deliver inference.

## Executable operator procedure — not activation approval

Read-only now:

```sh
python3 -B tools/coding-integration/cli.py status
# expected exit 2: live_enabled=false, included_only_qualified=false
python3 -B -m unittest discover -s tools/coding-integration -q
```

Generate a **disabled** source-pinned proposal, without creating runtime state:

```sh
SOURCE_SHA=$(git rev-parse HEAD)
python3 -B tools/coding-integration/cli.py manifest --source-sha "$SOURCE_SHA" \
  --mode included-only --not-before 1792584000 --not-after 1792587600
# Replace mode with strict-usd for the alternative; neither enables admission.
```

Before launch the operator must (1) obtain independent source review and explicit
activation approval of exact final source/policy/window; (2) resolve/provision
all capabilities below; (3) install the independently approved exact policy
at root-only `policy.json` and matching `approval.json` in the canonical 0700
vault, without changing/recreating an existing queue or clearing STOP/holds;
(4) authenticate the coordinator review channel. There is intentionally no
`approve`, reset, reinstall-over-state or automatic provisioning CLI.

Only **after** those separately approved prerequisites, the single launch/stop
procedure is executable as root from the reviewed clean source:

```sh
python3 -B tools/coding-integration/cli.py pickup
python3 -B tools/coding-integration/cli.py run
# No service/timer is needed. If a finite process exits paused, a later explicit
# operator invocation can resume only the SAME unexpired durable allowance:
python3 -B tools/coding-integration/cli.py resume

# STOP works even with an expired/missing policy; it preserves queue/budgets:
python3 -B tools/coding-integration/cli.py stop
```

The present source **will refuse** a real run: no provider contract exists.
Do not try to bypass that denial with flags. `review`, `prepare-publication` and
`publish` are separate operator commands behind their own exact private approvals;
none is called automatically by worker output. No merge/deployment exists.

## Complete minimal provisioning proposal (nothing installed)

1. Independent source/security review of this exact integration, especially the
   new configurable runtime (the old fixed-fixture boundary is not its approval).
2. Private, non-inference verification of provider-side included-only enforcement
   excluding purchased credits/top-ups/overages/fallback, and a supported reset/
   usage-status contract. No account/billing change is assumed authorized.
3. A credentialless reviewed coding executable under `/opt/` in a prebuilt pinned
   runtime image, with required Python/Node/app-test dependencies already present.
   Current cached image is Python/Node, **not** a qualified coder installation.
   Any build/download/install/new digest requires separate explicit approval and
   a reviewed source/manifest update; no image pull occurs automatically.
4. A narrow operator-owned broker/credential-delivery boundary retaining shared
   OAuth outside the worker. If this needs a new Unix listener/socket, service,
   credential, host/security policy or mount change, approve its exact scope first.
   Limit protocol to selected provider/model/job, no fallback/purchases, bounded
   request/response size, no-inference status only, protected checkpoints and
   durable reservation/start/recovery semantics. **Not currently available.**
5. Provision root-only canonical vault/approval/review-publication ingress; no new
   host user is required by this design. Authentication of independent coordinator
   review and any wake-up mechanism need separate provisioning/review. Existing
   status bridge is neither changed nor repurposed as executor.
6. Requalify exact final image/broker/runtime/storage/expiry/network/checkpoint
   boundary with harmless fixtures and mocked provider first, then obtain finite
   activation approval. No private source, account data or raw diagnostics should
   be posted publicly. No owner browser retest/credential recopy is requested.

## Verification boundaries

New tests use real temporary files/Git plumbing, synthetic ingress/provider/
remote/Docker effects and fake coding engines. No new coding/model/reviewer
process is invoked. RED→GREEN was observed for missing pickup/admission,
pause/resume, review/publication, storage/argv/warden guards, provider backoff,
durable ticks, configuration rejection and checkpoint restore. Additional
already-green adversarial cases are characterization, not invented RED runs.
Inherited fixed Docker qualification, if rerun, remains **harmless fixed fixture**
evidence only—not the new generic coding/runtime/broker's physical qualification.
No independent reviewer is launched under this preparation authority.

Automatic GitHub wake-up/dispatcher remains **not installed or active**. Real
read-only ingress into a disposable disabled queue demonstrates entry-point
pickup, not a background daemon awakening. No ongoing coordinator loop is claimed.
