# ARCHIVE-FIX-01: correction and review gate

Scope: PR #4 comment 6299434426. Source-only correction, dummy-executable tests and
publication. **No real Docker experiment, assembly replay or activation is allowed
by this document.** Independent source review and explicit experiment clearance
are still required. No independent test/security approval is claimed.

## Retained evidence and limits

The historical stopped-container attempt was executed at a7c28c4 and retained as
unknown. Its exact-ID retained events are create, extract-to-dir, archive-path,
destroy; no start is recorded. The old journal is 341 bytes with SHA-256
`862305fa678d8705424d9061fc9984df2fc2033a6a69437a09e162b281616658`.
It records base/container/token/name/fixture hash/unknown phase only. It has no
per-operation elapsed time, process exit code, stdout/stderr byte count, parse
category or rejected verification field. The overall ~41.8 seconds does not prove
a timeout. An archive-path event does not prove stream return or valid metadata.
The source swallowed the original exception; later source cannot recover it.
Do not change that journal or use another assembly identity to bypass its hold.

## Correction

`bounded_process.capture` uses a selector-driven binary stdin/stdout/stderr loop,
not unbounded communicate/run PIPE capture. Production operation timeout remains
30 seconds (not increased), with live stdout <=4 MiB and stderr <=64 KiB, plus a
single over-limit detection byte per stream. Stderr is counted/discarded, never
returned or persisted. Input is <=32 KiB and stdin is DEVNULL when absent.
The direct child is waited/reaped and its process group is killed on all returns;
streams/selectors are closed. Descendant termination is tested, not arbitrary
orphan reaping, hostile containment or SIGKILL/host-failure resilience.

Sanitized evidence: fixed operation stage/category, elapsed milliseconds, exit
code (null when unavailable), accepted stdin bytes, observed stdout/stderr bytes,
stream-complete flags and direct-child/cleanup status. Incomplete captures never
pretend to provide total output counts. No argv, raw OS errors, stderr, archive
bytes, member values or environment values appear in diagnostics.

Categories distinguish timeout, os_error, nonzero_exit, stdout_limit,
stderr_limit, stdin_incomplete and cleanup_error. Archive verification separately
reports archive_parse, archive_metadata or archive_content and fixed field codes:
input_type, output_limit, truncated, parse, member_count, type, linkname, name,
uid, gid, mode, size, mtime, pax_headers, content. Exact original fixture/path/
root UID/GID/mode/content and input timestamp/PAX constraints remain enforced.

Assembly diagnostics retain success transport records and a primary failure
separate from cleanup failure. A cleanup or cleanup-journal error cannot replace
the primary diagnostic. Failed journal persistence remains flagged on the safe
exception evidence, not converted to success. Generic injected adapters without
process evidence are explicitly labeled, never given fabricated exit codes.
No image, job, capability or production provider-admission pin is changed.

## Repeatable tests (no Docker)

```
python3 -B -m unittest discover -s tools/coding-integration -p test_archive_transport.py -v
python3 -B -m unittest discover -s tools/coding-integration -p test_archive_verification.py -v
python3 -B -m unittest discover -s tools/coding-integration -p test_assembly_diagnostics.py -v
python3 -B -m unittest discover -s tools/coding-integration -q
python3 -B -m unittest discover -s tools/development-handoff -q
python3 -B -m unittest discover -s tools/development-integration -q
```

Dummy subprocesses/fake Docker executables exercise the actual production wrapper,
binary transfer, concurrent stream limits, timeout/nonzero/OS failures, malformed/
truncated archive and individual metadata/content failures. These are not physical
Docker-archive qualification or evidence of the historical failure's cause.

## Minimal proposed experiment — NOT EXECUTED / NOT CLEARED

After the coordinator inspects the published correction and retained effects/
cleanup evidence, seek explicit clearance for exactly ONE stopped-container
copy-in/copy-out experiment, not a full assembly retry or hold reconciliation.

Bind the experiment receipt to the reviewed published source SHA, exact cached
base ID, held journal SHA-256 above and original failed container ID
`d1e4c778648145ced0a41153d8a6f307433b95f98d96d104e1f394fb5e4ec988`.
Use one unique experiment label explicitly identifying this parent attempt.
The original unknown journal/claims/budgets/STOP stay byte-preserved. An approved
linked experiment receipt is not a replacement assembly journal or a reset.

At most one --pull=never create from the exact cached base, configured stopped,
network none, cap-drop ALL, no mounts/devices/secrets/socket or credentials;
never start it. Check exact ID/base/labels/never-started state, copy in the same
deterministic fixture tar once, verify exact diff, copy out the same file once,
run the reviewed verifier, then remove only that exactly verified owned stopped
container. Proposed absolute total <=90 seconds, <=80 seconds work and <=10
seconds reserved owned cleanup, each operation <=30 seconds or remaining budget,
whichever is smaller. Keep live stdout/stderr caps and all stage/category/time/
exit/count/cleanup evidence. No retry after any uncertainty; report and hold.

No start, commit, new image/tag/image push, pull, builder, downloads, network,
provider/account operation or broader qualification. No raw stderr/archive or
secrets are reported. Success would qualify this one archive contract only, not
a fixture image, revised warden/exporter boundary, live coder or spending gate.
Included-only remains NOT VERIFIED and provider admission default-denying.
