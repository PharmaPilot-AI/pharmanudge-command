# Harmless fixture image preparation

This image contains a fixed synthetic namespace probe, not a coding agent. It
cannot establish provider/spending, coder, broker, checkpoint or release readiness.
The source is prepared for host review; no image was built in the coordinator.

On the existing authorized Docker host, first verify a clean exact source and
that the FROM digest is already cached. Build with no network or image pull:

```
docker build --network=none --pull=false --tag pn-h4-harmless-qualification tools/coding-integration/fixture-image
docker image inspect pn-h4-harmless-qualification --format '{{.Id}}'
```

Stop if the local builder cannot resolve the cached digest offline. Do not fetch
dependencies, a builder or another image. Record the resulting immutable image
digest for source review. Do not replace the existing production image/policy pin
or relax image admission. Current policy deliberately rejects a different image;
a later source-reviewed exact pin and dedicated qualification harness are needed
before running the revised warden against it. A tag is not an approval or a pin.

The four fixed child modes are success, failure (forged old marker plus exit 1),
sleep (expiry/STOP testing) and descendant (reaping testing). The probe verifies
UID/GID 65534, empty groups, zero effective/permitted capabilities, denial of root
completion-directory access and PID-1 signalling. Its synthetic /out/probe.json
is for the dedicated physical test harness only, not application-result export.
Source/mock passes never count as a physical pass. Keep all live workers disabled.
