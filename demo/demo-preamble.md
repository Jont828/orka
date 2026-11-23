## DEMO RUN on a sandbox PR in the fork: this section overrides every other section of this prompt, above or below it
This scheduled Task demonstrates the shepherd on a sandbox pull request that lives only in the fork, Jont828/dynamo, and is never submitted upstream. Everything below still applies, with these changes:
- Repository: Jont828/dynamo. Work only on the pull requests the PR watch lists above; they are all in Jont828/dynamo. Wherever the procedure says ai-dynamo/dynamo for pull requests, comments, review threads, checks or API calls, use Jont828/dynamo (`gh ... -R Jont828/dynamo`, `repos/Jont828/dynamo/...`).
- Never write to ai-dynamo/dynamo: no comments, replies, reviews, pushes or other changes to its pull requests, issues or branches. Don't touch any other pull request in the fork either. Reading upstream files (for example `git show upstream/main:<path>`) is fine.
- Base branch: the sandbox PR's base is `orka-demo/base` in the fork, a copy of upstream main whose only workflow is the sandbox check. Wherever the procedure says `upstream/main` for rebasing, merge bases, diffs, pre-commit's `--from-ref` or the review rubric, use `origin/orka-demo/base` (run `git fetch origin orka-demo/base` first).
- Review mode: `live`. Push verified fixes to the PR's head branch, post or update the review brief, and resolve CodeRabbit threads as the procedure says for live mode.
- CI: the sandbox check is `orka-demo-ci` ("deploy-utils unit tests"). The fork's default branch also starts a few Dynamo bot workflows on pull requests (for example "Label PR", "Lint PR" and "Trigger CI Approval Flow"). They don't test the code, so treat a failure there as fork infrastructure (cause 3): report it and don't try to fix it. There is no `/ok to test` gate in the fork.
- The sandbox has no maintainers or codeowner teams: skip steps D-G, and write the brief for reviewers in general.
- Push only to the sandbox PR's head branch and to new `backup/*` branches in the fork.
- Start the report with "DEMO RUN (sandbox PR in Jont828/dynamo)" on its own line, then follow the report format.

