# Bounded PharmaNudge coordination runner

Implementation for [issue #3](https://github.com/PharmaPilot-AI/pharmanudge-command/issues/3), extended with the separately approved result-publication implementation in [issue #6](https://github.com/PharmaPilot-AI/pharmanudge-command/issues/6). **Review artifact only: no schedule, coding task, publication approval or execution is enabled by these source changes.** Python standard library; installed `git`, `gh` and dedicated Hermes CLI are runtime prerequisites. No dependency installation is required.

## Local verification (no live integrations)

From the repository root:

```sh
python3 -m unittest discover -s tools/pharmanudge-runner -p 'test_*.py' -v
python3 -m compileall -q tools/pharmanudge-runner
git diff --check
python3 tools/pharmanudge-runner/runner.py --help
```

Tests use temporary fixtures/fake processes, never real inference, Telegram, remote databases or deployment. No package install is needed. Application sources and package definitions are outside this change; the frontend build does not exercise this Python tool.

## Authority and threat model

The only repository is `PharmaPilot-AI/pharmanudge-command`. Labels, comments, arbitrary issues, worker responses and queue discovery cannot approve work. The local coordinator must review each exact issue body, author and full starting commit and explicitly provision the matching allowlist entry. The example is disabled, dry-run, and has an empty allowlist. This implementation issue is **not** an approved application task and is not automatically pinned.

The main worktree (`/root/projects/pharmanudge-command`) and setup worktree (`/root/projects/pharmanudge-hermes`) are preserved. Worker worktrees start from the approved tracked commit; unfinished Ask AI files and credential/environment files are not copied. Do not copy either existing worktree to prepare a worker.

Git worktrees, a dedicated profile, selected toolsets and prompt restrictions are **not an OS sandbox**. The current service user may be root (UID 0 on the inspected host). A malicious task or model may exceed prompt restrictions using the account's filesystem, network and credential permissions. Review content carefully; deployment of unattended work should require independently reviewed OS/network isolation. No sandbox or monetary spending cap is claimed.

Workers are instructed never to merge, force-push, deploy, apply remote migrations, modify credentials, change profiles/services, schedule jobs or contact third parties. They must follow AGENTS.md and stop for coordinator review. The runner does not publish worker output or automatically turn it into GitHub authority.

## Bounded execution and failure semantics

- A nonblocking OS lock spans the entire poll, preparation, worker and notification lifecycle. Overlap exits without a second worker.
- Persistent claims are keyed by issue/body revision. Claim and UTC daily attempted-start budget are durably saved **before** launch. One task per invocation; at most four attempted starts per UTC day. Restarting cannot clear the budget.
- A crash after claiming, an interrupted run, a timeout or an unknown outcome never automatically retries. Unreconciled `claimed`/`unknown` outcomes must also block *different* tasks/revisions, because an orphaned worker may still be alive. Inspect the retained worktree, process state and ledger before explicit reconciliation. Reconciliation is not permission to execute the same revision again.
- Maximum worker runtime while the supervising runner is alive: 1,200 seconds, TERM to its process group, then KILL after a 30-second grace. The CLI's handled SIGTERM/SIGHUP/SIGINT signals are deferred across subprocess creation and assignment, then replayed only after the cleanup guard owns the process. Deadline initialization and selector registration are inside that guard as well. This uses temporary Python handlers in the main thread, not OS signal masking or `preexec_fn`; the child does not inherit a newly blocked termination mask, and the prior parent handlers are restored. SIGKILL, host failure, and descendants that deliberately escape the process group cannot be contained by this Python supervisor; retained unknown claims block subsequent work until an operator verifies cleanup. Maximum tool iterations: 30. Explicit provider `openai-codex` and model `gpt-6.1-sol`. Time/iteration/start limits are **not a monetary spending cap** and do not guarantee a count of model API calls.
- No `--yolo`, `--accept-hooks` or auto-bypassed `--oneshot`/`-z`. The runner supplies no approval responses (stdin is DEVNULL). This does **not** override all installed Hermes policy: profile/managed environment loading and `approvals.mode: off`, smart approvals, permanent allowlists or hooks can independently affect behavior. The operator must review those settings before authorizing execution; this PR neither reads credential files nor changes shared policy. Environment whitelisting and prompt restrictions do not constitute a sandbox.
- Empty allowlist/queue does not invoke a model and is silent. Poll subprocesses share a 30-second deadline. Guarded alerts have separate allowances of up to five seconds for identity verification and five seconds for sending (up to ten seconds combined); these hold the same lock. Missing/corrupt configuration or state, authentication/network errors and unexpected remote state fail closed; there is no agent fallback. Unverifiable configuration/routing failures stay local rather than guessing a destination or overriding dry-run.
- Dry-run never starts a worker, creates a worker worktree, sends an owner notification or mutates GitHub.
- Notifications use the dedicated command's configured Telegram **home** destination, not explicit account/chat IDs. Messages are static categories only (review needed, blocker, failed/unknown). No raw worker output, issue content, pharmacy/user data, environment dump or credential value is forwarded. Notification failures do not undo claims or retry workers. No notification test is part of this task.

## Local operation (only after coordinator review)

No runtime configuration, ledger or adapter is provisioned by this PR. A reviewed operator can provision the example as `/root/.hermes/profiles/pharmanudge/state/pharmanudge-runner/config.json`, retaining `enabled: false`, `dry_run: true`, and `tasks: []`; protect the directory/config from untrusted writers. Missing configuration fails closed rather than creating defaults.

The following are instructions, **not actions executed as part of this change**:

```sh
RUNNER=/path/to/reviewed/checkout/tools/pharmanudge-runner/runner.py
python3 "$RUNNER" verify-identity
python3 "$RUNNER" init-state
python3 "$RUNNER" pin ISSUE_NUMBER
python3 "$RUNNER" poll
```

`verify-identity` is read-only and must succeed for the specific dedicated service/profile before any scheduling discussion proceeds. `init-state` is an explicit one-time local bootstrap; it refuses to reset existing state. `pin` prints an **unauthorized candidate**, not an approved task, and never edits the allowlist. Independently review the body and approved author's identity via `gh issue view ISSUE_NUMBER --repo PharmaPilot-AI/pharmanudge-command --json number,author,body,state`; compare the exact UTF-8 JSON body value (not CLI-rendered text or a newline-added shell pipeline), full SHA-256 and starting commit to the candidate. Check all relevant AGENTS.md instructions and scope. Only an explicit locally provisioned entry containing all four fields can authorize that exact revision; never automatically pipe `pin` output into the configuration.

Keep `dry_run: true` when reviewing an enabled allowlist: `poll` then validates remote/local authorization but does not launch, publish or notify. Only after separate execution approval may the operator set `enabled: true` and `dry_run: false`. The lock file is local coordination metadata; dry-run does not change the ledger or GitHub. The constructor and CLI enforce one canonical ledger (alternate `--state` paths are rejected and aliases normalize to the fixed identity); a second configuration cannot fork the lock, budget, duplicate history or STOP directory.

The dispatch STOP gate is `/root/.hermes/profiles/pharmanudge/state/pharmanudge-runner/STOP`. For reconciliation, first verify no previous worker/process group remains, inspect its retained worktree and outcome, then explicitly run `python3 "$RUNNER" reconcile 'ISSUE_NUMBER:BODY_SHA256'`. This marks an existing claim terminal; it neither clears the consumed daily budget nor authorizes retry of that revision. Do not automatically reconcile from scheduler/model output.

## Explicit result publication and handoff (issue #6)

Publication is a **separate operator action**, never part of `poll`. Workers still have no publishing authority: their policy leaves local changes, and neither worker prose, issue comments/labels nor a successful exit can create a trusted publication approval. The coding ledger, claims, budgets and STOP are not reset or reconciled by publication. A publication failure must never start another coding worker.

The operator interfaces are:

```sh
python3 "$RUNNER" publication-preview 'ISSUE_NUMBER:BODY_SHA256'
python3 "$RUNNER" publish 'ISSUE_NUMBER:BODY_SHA256'
```

These are documentation examples, **not commands executed against the deployed claim in this PR**. `publication-preview` is an operator-only read-only review aid: inspect the complete proposed manifest/digest and diff, but do not treat that output as authorization. It may perform bounded read-only GitHub identity/task/base checks, but invokes no AI, publication, notification or approval-writing action. Do not paste raw previews into GitHub or Telegram; inspect them locally for sensitive pharmacy/user data.

Publication requires a separately provisioned canonical `publication-approval.json`, initially absent/disabled, with explicit enabled/non-dry settings and a reviewed approval for the exact claim, claim-specific branch/worktree, starting commit, proposed file-content manifest digest and explicit permitted paths. The checked-in publication example remains disabled/dry-run with no approvals. There is no auto-approval or provision/approve CLI. Operators must verify every approval field manually and protect the control directory independently from worker writes. **This PR provisions no publication approval and publishes no actual worker result.**

The local approval schema is deliberately separate from the coding configuration:

- Top level: `enabled` (boolean), `dry_run` (boolean), `approvals` (list). Absent or disabled/dry-run approval blocks publication without creating a journal.
- Each approval has exactly `claim_key`, `base_commit`, `branch`, `worktree_token`, `manifest_sha256`, `paths`, and `validation`.
- `claim_key` is the exact `ISSUE_NUMBER:BODY_SHA256`; `base_commit` is the full starting SHA. `branch` and 32-hex `worktree_token` must match the retained claim, not an arbitrary checkout.
- `manifest_sha256` hashes the JSON manifest using sorted object keys, ASCII escaping, compact `,`/`:` separators and paths sorted lexically. Every manifest entry binds `path`, raw UTF-8 `sha256`, Git `mode`, byte `size`, and `change` (`A` or `M`). `paths` must be the sorted unique exact manifest paths, not globs or a prefix permission.
- `validation` has exactly `status` and `evidence_sha256`: either `{"status":"unverified","evidence_sha256":null}`, or `{"status":"coordinator-reviewed","evidence_sha256":"<64 lowercase hex>"}` after the coordinator independently reviews the referenced validation evidence. A digest is an attestation pointer, not execution or proof of passing tests. Raw validation logs never enter PR text.

A coordinator must provision those fields independently after review; preview never writes or enables approval. The separate `publication-state.json` journal records stages `staging`, `committing`, `committed`, `pushing`, `pushed`, `creating-pr`, and `complete`, together with exact approval/pin digests, expected tree/commit, validated URL and notification outcome. It must not be deleted or hand-reset to bypass uncertain outcomes. An interrupted notification attempt is at-most-once, not an instruction to resend.

The canonical shared runner lock spans validation, local staging/commit, remote reconciliation/push, PR creation and final notification. Publication revalidates a completed `review-needed` claim and retained worktree identity, branch/HEAD/base, exact repository and task pins. Full tracked, untracked and ignored status is accounted for; unexpected files are rejected rather than silently omitted. The permitted path policy is deliberately narrow source/document content. Symlinks, submodules, deletions/renames, `.github` workflows, environment/credential/control files, unsafe paths and unapproved extras are not supported. Approval must match the complete proposed path/content manifest, not only filenames. Normal Git commits disable hooks and stage only exact argument-array paths; never `git add .`, force-push, merge, deploy or migrate.

The supported paths are exact `README.md`, `src/**` and `docs/**` paths only, subject to the stricter credential/control/dot-path exclusions. This intentionally excludes the earlier root-level `PHARMANUDGE_RUNNER_TRIAL.txt` marker and all runner control files; this implementation is not approval to publish that retained trial. Files must be UTF-8 text, at most 128 KiB each, at most 64 changed files and 512 KiB aggregate. Hardlinks, binary/control payloads and unsupported conversion/filter or index states fail closed rather than being normalized into a different approval. Real GitHub publication and Telegram delivery remain untested by this source-only task.

Before committing/pushing/creating a PR, a separate durable publication journal records the intended stage. Explicit subsequent publisher invocations reconcile exact local/remote identity before any permitted continuation; they must not blindly duplicate commits or PRs. An uncertain PR-creation outcome with no provable matching PR stays blocked for manual investigation rather than automatically submitting another creation request. This is **publication** reconciliation only: no unknown coding claim is automatically reconciled, reopened or retried. Keep the journal and original ledger together; deleting either is not recovery.

Only a validated repository draft-PR URL and static/sanitized status enter the durable result and configured dedicated Telegram home notification. Notification failure does not undo publication, create another PR or retry coding. PR text contains a short static summary and exact commit/base, not raw output or user data. Validation is explicitly **unverified** unless the coordinator has reviewed independent evidence; worker exit zero is never reported as tests passing. Secret scanning is defense-in-depth, not proof that a payload is safe: token formats and obvious private keys can be detected, but novel credentials, obfuscation, domain-specific pharmacy/user data and contextual disclosures require human review.

**Deployment/trust limit:** local operator approval state is logically separate from worker output, not an OS security boundary. A malicious worker running as root/the same unrestricted account could tamper with files outside its worktree, including controls. Real publication therefore requires separately reviewed operator/worker filesystem and privilege isolation (or an equivalent externally enforced trust boundary). Repository/global Git configuration, credential helpers and supported SSH/HTTPS transport configuration must also be trusted and protected: rejecting known helper/proxy/receive-pack overrides is not a complete Git-configuration sandbox. This implementation does not grant that isolation or permit enabling publication on the strength of prompt restrictions alone. Known root/isolation and approval-policy caveats still apply.

**Review handoff is not review automation.** A GitHub draft result PR does **not** wake this ChatGPT conversation or guarantee coordinator review. A separately configured, explicitly authorized reviewer trigger is the remaining integration step. No ChatGPT review scheduler, automatic coordinator wake-up, unsolicited message or live notification test is implemented here.

## Installed CLI verification and scheduling policy

The installed `/root/.local/bin/pharmanudge` wrapper explicitly selects `pharmanudge`. Read-only inspection found the active root-user service `hermes-gateway-pharmanudge.service`, executing `hermes_cli.main --profile pharmanudge gateway run`, with working directory and HERMES_HOME `/root/.hermes/profiles/pharmanudge`. This is the dedicated identity, not an inference from ambiguous default-profile gateway status. Reverify identity before any future scheduling; this observation is not a permanent health guarantee.

Inspected installed help supports:

```text
pharmanudge chat --in DIR --provider PROVIDER --model MODEL --max-turns N --toolsets terminal,file --query PROMPT
pharmanudge send --to telegram --quiet MESSAGE
pharmanudge cron create SCHEDULE --name NAME --repeat N --no-agent --script PATH --workdir DIR --deliver local
pharmanudge cron pause JOB_ID
pharmanudge cron remove JOB_ID
```

The script/no-agent cron form is a deterministic dispatcher, not an agent-backed poll. An empty poll must not call inference. The CLI has no per-job hard-runtime or UTC daily-start-budget flags; the runner implements those separately. `--repeat` is a total run cap, not a daily cap or monetary limit.

**Do not execute this template under this PR.** Only after coordinator approval, reviewed local configuration, verified service/profile identity, and deployment of a separately reviewed script adapter under the dedicated profile's scripts directory, a bounded initial trial could use:

```sh
/root/.local/bin/pharmanudge cron create 'every 1h' \
  --name pharmanudge-runner-reviewed-trial \
  --repeat 2 --no-agent \
  --script /root/.hermes/profiles/pharmanudge/scripts/pharmanudge-runner-trial.py \
  --workdir /root/projects/pharmanudge-hermes --deliver local
```

The adapter is **not installed or created by this PR**. It must call the reviewed runner with explicit dedicated local config/state paths; it must not embed secrets or approve tasks. Confirm the named job does not already exist before creation; never blindly duplicate a job. Start with a manual dry-run and a coordinator-observed bounded trial, not an infinite recurring schedule. The owner must separately authorize provisioning and execution.

To stop future dispatch, place the documented STOP file before the next invocation. STOP is a dispatch gate, **not** an emergency kill of an already running worker. Pause the verified trial job with `/root/.local/bin/pharmanudge cron pause JOB_ID`; remove it with `/root/.local/bin/pharmanudge cron remove JOB_ID`. Neither command cancels an in-flight worker: use operator-reviewed process-group termination if needed. Retain ledger and worktrees for reconciliation; do not delete state to bypass duplicate or budget limits. Resume only after explicit review.
