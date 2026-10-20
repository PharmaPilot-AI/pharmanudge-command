# Local-only harmless fixture assembly (COMPATIBILITY-03)

**Current gate: the COMPATIBILITY-03 attempt remains held. ARCHIVE-FIX-01 only
permits source correction and dummy-executable tests, not real assembly or a new
journal. See [the correction and unexecuted experiment proposal](../ARCHIVE-FIX-01.md).
The usage example below is not clearance to retry or bypass that hold.**

No Dockerfile build is supported. The former bare-ID FROM caused registry metadata
resolution despite pull=false and network=none. Do not repeat that procedure.

Review the clean exact source and `../fixture_assembler.py` before physical use.
The owner-authorized host can execute, with an unused private journal path:

```
python3 -B tools/coding-integration/fixture_assembler.py --allow-stopped-local-assembly --source-sha <exact-clean-correction-SHA> --journal <private-new-attempt.json>
```

The assembler verifies the exact already-cached base ID, rejects volumes/ONBUILD/
healthchecks, clears inherited environment values, creates a uniquely labeled
never-started network-none/cap-drop container with no mounts, copies one
root-owned deterministic regular-file archive via stdin, checks stopped identity,
exact diff and copied fixture bytes/mode, then commits locally to an immutable ID.
It verifies base layers and bounded committed config. It does not start a process,
invoke a builder/registry, install dependencies, expose secrets or retag a base.
Every attempted effect is journaled; create/commit uncertainty remains held with
no automatic retry. Inspect the recorded name/ID manually on uncertainty. Cleanup
removes only the exactly identified still-never-started owned container; an
uncertain image is never automatically removed or reassembled.

This is a qualification fixture, not a coder/production image pin. Production
admission remains unchanged. A separately reviewed harmless adapter must pin the
actual fixture ID and exact clean source before starting any revised warden.
No provider inference, credential delivery or live activation is authorized.
All spending admission remains default-denying/NOT VERIFIED until separately
supported account-control evidence and activation authority exist.
