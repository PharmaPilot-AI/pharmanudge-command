# Bounded PharmaNudge coordination runner

Implementation for [issue #3](https://github.com/PharmaPilot-AI/pharmanudge-command/issues/3). **Review artifact only: no schedule or application task is enabled by this change.** Python standard library; installed `git`, `gh` and dedicated Hermes CLI are runtime prerequisites. No dependency installation is required.

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
- Maximum worker runtime while the supervising runner is alive: 1,200 seconds, TERM to its process group, then KILL after a 30-second grace. Handled termination signals enter cleanup. SIGKILL, host failure, and descendants that deliberately escape the process group cannot be contained by this Python supervisor; retained unknown claims block subsequent work until an operator verifies cleanup. Maximum tool iterations: 30. Explicit provider `openai-codex` and model `gpt-6.1-sol`. Time/iteration/start limits are **not a monetary spending cap** and do not guarantee a count of model API calls.
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
