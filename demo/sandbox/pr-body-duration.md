> [!NOTE]
> **Sandbox PR for an Orka demo.** It lives only in `Jont828/dynamo` and is never submitted to `ai-dynamo/dynamo`. It shows the Orka PR shepherd handling a CI failure caused by the PR's own code.

### Overview

Adds `deploy/utils/duration.py`, a small parser for kubectl-style durations, so benchmarking tooling can compare and add timeouts given in the form `kubectl wait --timeout` accepts.

### Key Changes

- `parse_duration()` returns whole seconds: `parse_duration("90s") == 90`, `parse_duration("5m") == 300`, `parse_duration("1h30m") == 5400`.
- Units are `h`, `m` and `s`, each at most once and largest first. Anything else raises `ValueError`.

### Validation

- `pytest deploy/utils/tests/test_duration.py` (also run by the sandbox's `orka-demo-ci` check).

### Issues and Ongoing Work

- None.
