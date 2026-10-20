# HANDOFF-03: concrete zero-paid-call integration and qualification

Preparation authority: [PR #4 / 6285241174](https://github.com/PharmaPilot-AI/pharmanudge-command/pull/4#issuecomment-6285241174). Additive to corrected PR #10 source `a5777865c883ae80400ed62d1f0942f963dbee7d`. The reviewed offline controls/FIFO fix remain unchanged in `../development-handoff/`.

**Coding execution remains blocked.** This revision makes a fixed, harmless **zero-inference qualification** lifecycle executable with existing installed Docker, not an operational autonomous coding loop. No coding/model worker, inference/reviewer model, live execution policy, dispatcher, service, listener, webhook or schedule is installed/activated. A successful native fixture is not approval to run repository code or spend money.

## Concrete bindings

`bindings.py` provides:

- `GitHubIngress`: real bounded `gh api` GETs to the one pinned repository/PR #4 inbox; canonical comment, issue creator/open state, exact UTF-8 body hash, remote main and old strict numeric-ID/login/window/base/source/policy schema validation. Duplicate/truncated pagination rejects. Repository prose never becomes permission. The default/disabled policy rejects before dispatch.
- `SourceIdentity`: exact clean control-checkout commit verification with read-only Git calls.
- `LegacyGuard`: existing canonical-state identity, disabled coding settings, consumed keys/daily charges, STOP/unknown holds and snapshot fingerprint. Its cooperative exclusive lock opens only the **existing** predecessor lock, never bootstraps, rewrites, reconciles or refunds the old ledger. Canonical paths/fingerprint must be separately approved; they are null in the example, not silently guessed from a new state root.
- `DockerSandbox`: concrete local Unix-socket Docker adapter with no registry credentials, image pulls or arbitrary command interface. Only fixed qualification kinds are accepted; no Hermes/coding entrypoint. All image environment **names** are enumerated and their values cleared without extracting them. The child receives HOME/PATH/LANG only.
- `QualificationPipeline`: synthetic assignment inbox → durable one-start claim → real contained producer → real seal/quarantine → separately isolated deterministic validator → trusted **local** Git/base-relative publisher-manifest preparation. The two containers are different jobs; worker output cannot invoke Docker, authorize review, access the operator Git tree or publish anything.
- `PublisherTranslation`: checks independent validator role, manifest/evidence identity and unchanged implementation fingerprint. It emits `publication_enabled:false`, `qualification_only:true`, `remote_target:null`; no GitHub result publisher is supplied or historical claim adopted.
- `PaidAdmission`: composes real source/predecessor/ingress checks, then refuses selected-provider inference through `CodexBudget`: `hard_spend_capability_unavailable`. No fake successful paid grant or fallback provider is provided.

`guest.py` is the fixed qualification program and trusted namespace PID 1. It does not import an agent/provider or execute task prose. `qualification.py` is an opt-in finite test entrypoint; its default status refuses live work. `integration.example.json` is disabled and is **not** an execution policy.

## Actual installed capability used

Read-only inspection found a local Docker Unix socket and running Docker 29.8.1, cgroup v2/systemd, default AppArmor and builtin seccomp. Two cached images were present. No software/image download or daemon/security-policy change was needed.

The selected already-installed public Python/Node image is pinned by immutable local image ID:

```text
sha256:8f958bdc1b4a422bfafd97cab4f69836401f616ae985d4b57a53d254f5bcb038
```

Observed repository digest: `nikolaik/python-nodejs@sha256:8f958bdc1b4a422bfafd97cab4f69836401f616ae985d4b57a53d254f5bcb038`. This is qualification provenance, not a security certification of that image or a qualified Hermes/coding dependency image. `--pull=never` fails if it is absent; do not substitute a tag or download an image to make the command pass.

Each disposable sandbox has UID/GID 65534, all capabilities dropped, no-new-privileges, private PID/cgroup/network context, network **none**, read-only root/dependencies/input/guard/lease, 0.25 CPU, 64 MiB memory with no additional swap, 16 PIDs, and a 16 MiB private work tmpfs. Mounts are checked against exactly the sterile per-job inputs/lease/status/out and one reviewed guard file, never a host home/worktree/control/credential/socket directory. Root-owned host-only synthetic canary data is deliberately outside those mounts. No real secret is used.

The operator remains trusted UID 0 with access to the existing Docker daemon. This is not protection against a malicious operator/root, a VM boundary, a kernel/image vulnerability audit, or disk-quota qualification for arbitrary untrusted coding. Output bind directories are safe for these fixed tiny fixtures; a general coding runtime needs a separately reviewed filesystem/size/egress policy and prebuilt tool image.

## Independent expiry / authentic sealing

Python guard is namespace **PID 1** (no `--init` intermediary), sets itself non-dumpable, and executes only fixed harmless child kinds. The child has no operator authority, Docker socket, host paths or credentials. Kernel PID-namespace init protections and non-dumpable state are exercised against child SIGSTOP/SIGKILL/ptrace attempts.

An absolute lease end and monotonic maximum are installed inside the container before work. STOP is a host-owned read-only lease marker. On STOP/expiry/exit, PID 1 kills remaining tasks including setsid descendants; namespace-init death also ends the namespace. This is independent of the host Python supervisor/client finally block. Docker itself is not modified or restarted. A killed supervisor cannot renew/start a recovered intent: the saved create/start attempt blocks restart; recovery is inspection/cleanup only.

Before export, the operator authenticates the exact container/job/image/config/mounts through the existing root-owned Docker Unix channel and uses a trusted in-container probe to require **only PID 1**, excluding that probe, remains. A worker-written JSON `sealed` is insufficient. Captured bytes then pass the corrected descriptor-relative no-follow/nonblocking regular-file/link/UTF-8/size checks into private operator quarantine. A separate container with only read-only copies validates the exact base-relative manifest and fixed synthetic content. The old publisher is never called.

These are demonstrated fixture behaviours, not a general proof against all adversarial code or physical host suspension/failure. Tests distinguish no **executing** descendants from arbitrary-grandchild reaping; Docker reports stopped init/PID 0 and the fixture supervisor is explicitly waited.

## Reproducible zero-cost commands

From the clean implementation checkout, without installing dependencies:

```sh
# Existing reviewed offline/FIFO suite:
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tools/development-handoff -q

# New operator/control tests (native cases explicitly skipped by default):
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tools/development-integration -q

# Inspection only; expected exit 2, live_enabled:false:
python3 -B tools/development-integration/qualification.py status

# ONLY under explicit permission for harmless disposable native fixtures:
python3 -B tools/development-integration/qualification.py native \
  --allow-synthetic-containers --source-sha "$(git rev-parse HEAD)"
```

The native command verifies the exact clean source before **and after** the suite, returns JSON with actual case results, source/image pins and a control-code digest, and removes its own containers. No installer/pull, provider request, paid inference or fixture GitHub write occurs. Docker must already be available through the local root-owned socket and the pinned image must already exist; missing capability fails instead of provisioning. CLI refusal is not evidence that the host lacks Docker.

The native suite exercises actual:

- non-root/capability/credential/path/outbound denial; a real synthetic host-only canary; readonly input/root and kernel cgroup limits;
- CPU throttling, cgroup-local OOM kill and fork/PID exhaustion;
- real detached descendant termination on absolute expiry and STOP;
- SIGKILL of the **synthetic host supervisor**, followed by independently enforced container expiry, no executing recorded descendants and no automatic restart;
- unprivileged child attempts to stop/kill/ptrace the namespace warden;
- assignment → one claim → native output → seal → private quarantine → separate native deterministic validation → local Git manifest/publication preparation, then duplicate rejection.

Assignment transport in the end-to-end test is explicitly **synthetic**. The execution, filesystem, Docker role/config checks and validator are real. The validator checks fixed synthetic data, not application correctness or independent human/source review. No fixture application PR/result is published. Unknown-start injection tests are synthetic and remain distinct from actual supervisor-death evidence. Wall-clock jumps are tested with injected clocks, not changes to the host clock.

## Spending limitation: no verified US$1 reservation

Selected existing provider/model remains `openai-codex` / `gpt-6.1-sol`. Installed integration uses the ChatGPT Codex OAuth backend, not an established job-scoped USD reservation interface. No credential/account/billing endpoint was accessed; actual private plan/enterprise entitlements are unverified. Public authoritative documentation was consulted, not a paid probe:

- [Codex with a ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan): limits depend on plan, eligible usage/credits can be shared, and an active turn may continue when a usage limit is reached.
- [Enterprise/Edu limits](https://help.openai.com/en/articles/20001001-manage-usage-limits-and-overages-in-chatgpt-enterprise-and-edu): server-side monthly/user/workspace controls do exist, but a task may finish slightly over a user limit; in-progress credit requests may settle later. Some token-based workspaces expose a USD budget, including a $0 setting. None is qualified here as an authenticated isolated **per-assignment hard pre-dispatch maximum reservation** for the selected account/model.
- [API project budgets](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform): project thresholds are soft controls; they do not establish the requested per-task contract.
- [Prepaid API billing](https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing): access may stop late and accrue negative balance; OpenAI explicitly warns not to rely on prepaid balance as an instantaneous cutoff. Ordinary prepaid/API migration is therefore not a proven US$1 fix.

**Precise result:** no qualified atomic USD-reservation/independently restricted inference capability was found for the existing OAuth path. Do not infer universal absence of private provider contracts. The selected account's controls were not inspected or changed. `CodexBudget.reserve` always fails closed; no time/turn/token limit, fake price, dashboard alert or local journal is called monetary enforcement. The only qualified ceiling here is **zero newly triggered provider calls**, structurally enforced for fixtures by no provider client/credential and no outbound network. It is not billing telemetry for the ongoing interactive session.

Smallest immediately viable alternative is continuing zero-provider-call fixed tasks/preparation. For actual coding, the owner must either (a) separately approve a changed business envelope using existing-plan usage/credits **without claiming a strict USD guarantee**, after privately attested billing semantics and source review, or (b) retain the strict USD requirement and separately authorize evaluation/provisioning of a provider-supported independently scoped pre-dispatch reservation contract. Do not silently switch provider, purchase credits, turn on overages or pretend ordinary prepaid/soft limits satisfy (b).

## Remaining gates / smallest finite proposal

No additional provisioning was required for the **observed native fixture qualification**. Do not activate live coding from that success. A coding tool image, restricted inference access/billing contract, actual independently allowlisted application reviewer identity/validation profile, publisher claim/worktree mapping and full reviewed execution policy still require separate source qualification/permission. A qualification-only plan is not an old-runner publication approval.

After independent review, the smallest additional finite operating proposal is one explicitly named **zero-provider-call synthetic assignment**, one native producer plus one independent fixed validator, at most 15 seconds each under the exact observed image/resource/mount policy, one nonrenewable short outer window, one start/claim, no live publication/model/backend access, and operator-only preparation/evidence. Exact future source/task/base/policy/window pins must be genuine and separately approved, not copied from fixture UUIDs. No new listener/service/schedule is included. For a real login-hardening coding trial, the spending and runtime/reviewer/publisher prerequisites above must first be resolved; the earlier US$1 allowance remains unapproved.

Actual pickup status: this assignment was invoked by the owner through the existing interactive Hermes session. The canonical reader and finite qualification entrypoint now exist, but **no automatic GitHub-to-coding dispatcher or active policy is installed**. The old bridge remains status-only and untouched. A posted comment/draft PR is not evidence of automatic wake-up. Stop for independent review; no owner browser retests, secret recopying or diagnostic relay is needed.
