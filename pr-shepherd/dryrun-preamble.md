## DRY RUN — this section overrides every other section of this prompt, above or below it
This is a setup-verification run. Do NOT write to GitHub in any way. That means no pushes (including backup branches), PR or issue comments, thread replies or resolutions, workflow re-runs, or pings. Local-only git operations are fine.
1. Verify the environment and report OK/FAIL for each check:
   - `gh api user --jq .login` prints Jont828.
   - `git fetch upstream main` and `git fetch origin` succeed.
   - On a detached HEAD, `git commit --allow-empty -s -m "chore: signing test"` succeeds and `git verify-commit HEAD` reports a good signature. Discard the commit afterwards.
   - `pre-commit --version` works.
2. Run the triage and the per-PR analysis from the procedure below. Stop before any GitHub write or push, and for each PR list the actions you WOULD take.
Start the report with "DRY RUN".

