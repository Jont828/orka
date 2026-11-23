> [!NOTE]
> **Sandbox PR for an Orka demo.** It lives only in `Jont828/dynamo` and is never submitted to `ai-dynamo/dynamo`. It shows the Orka PR shepherd handling a CI failure that the PR didn't cause.

### Overview

Documents how to check what a benchmarking or profiling job left on the `dynamo-pvc` claim before downloading it, using the existing `pvc-access-pod`.

### Key Changes

- Adds "Checking What's on the PVC" to `deploy/utils/README.md`: the size of each top-level directory, and the newest results first.

### Validation

- Docs only. The sandbox's `orka-demo-ci` check runs the `deploy/utils` unit tests.

### Issues and Ongoing Work

- None.
