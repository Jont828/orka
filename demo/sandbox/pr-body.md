> [!NOTE]
> **Sandbox PR for an Orka demo.** It lives only in `Jont828/dynamo` and is never submitted to `ai-dynamo/dynamo`. It shows the Orka PR shepherd and review assistant working on a PR end to end.

### Overview

Adds `deploy/utils/quantity.py`, a small parser for Kubernetes resource quantities, so benchmarking tooling can compare requested CPU and memory with node capacity without shelling out to `kubectl`.

### Key Changes

- `parse_quantity()` returns a quantity as a `Decimal`: `parse_quantity("500m") == Decimal("0.5")`, `parse_quantity("512Mi") == 536870912`.
- It follows Kubernetes semantics: binary suffixes (`Ki`, `Mi`, `Gi`, `Ti`) are powers of 1024, decimal suffixes (`k`, `M`, `G`, `T`) are powers of 1000, and `m` is one thousandth.
- `cpu_millicores()` and `memory_bytes()` return the two common resources as integers, rounding up.
- Exponent forms (`1e3`) and the `P` and `E` suffixes are out of scope for now.
- Lists the module in `deploy/utils/README.md`.

### Validation

- `pytest deploy/utils/tests/test_quantity.py` (also run by the sandbox's `orka-demo-ci` check).

### Issues and Ongoing Work

- None.
