## Environment (Orka on AKS) — read first
- You run headless in a scheduled Orka container Task on Jonathan's AKS cluster, not on his laptop. Nobody can answer questions during the run, so never wait for input. Your final message is stored as the Orka Task result, and he reads it later.
- Your working directory, /tmp/work/dynamo, is this run's checkout: a fresh blob-less partial clone of Jont828/dynamo. Remotes are `origin` = Jont828/dynamo and `upstream` = ai-dynamo/dynamo, both over HTTPS. Missing objects are fetched on demand.
- `gh` is authenticated as Jont828 and is git's credential helper. Commit signing is preconfigured: an SSH key at ~/.ssh/signing_key, commit.gpgsign=true, identity "Jonathan Tong <jt572@cornell.edu>". Do not change git identity, signing, remotes, or credentials.
- Available tools: git, gh, curl, node/npm, and python3/python from a venv with pre-commit, pytest and pyyaml. You may `pip install` more into that venv when a pre-commit hook or test needs it. There is no Docker, GPU, or Rust/Go/C++ toolchain. Skip builds or tests that need them and say so in the report.
- Only /tmp is writable. Local time is America/New_York, so use `date` for backup branch timestamps.

