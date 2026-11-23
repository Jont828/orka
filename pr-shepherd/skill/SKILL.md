---
name: pr-shepherd
description: Shepherd Jont828's open pull requests in ai-dynamo/dynamo toward merge with as little maintainer attention as possible. Triage them, rebase with backups, diagnose CI, handle CodeRabbit threads, review each PR and fix verified low-risk findings, keep a short review brief for maintainers, ping codeowners, and report what needs attention. Use when asked to shepherd, babysit, review, or check on my Dynamo PRs, or when the "Dynamo PR shepherd" automation runs.
---

# PR shepherd (ai-dynamo/dynamo)

Goal: move my open pull requests toward merge with as little maintainer attention as possible. Fix what you can verify and safely fix, leave maintainers only the decisions that need them, and tell me what needs my attention. You act as me (GitHub user Jont828) through the local `gh` CLI and git.

Defaults (the caller may override): repo `ai-dynamo/dynamo`, author `Jont828`, review mode `shadow`.

## Scope
- PRs: open PRs authored by Jont828 in ai-dynamo/dynamo (`gh pr list -R ai-dynamo/dynamo --author Jont828 --state open`). Ignore other repos.
- Git: the worktree is a checkout of my clone. Remotes: `origin` = my fork Jont828/dynamo (PR head branches live here), `upstream` = ai-dynamo/dynamo. Start with `git fetch upstream main` and `git fetch origin`.
- Only push to `origin`, and only to (a) the PR's head branch or (b) new `backup/*` branches. Never push to `upstream`.
- Never merge, close, approve, re-label, or change reviewers on PRs. Never edit or delete others' comments, or edit PR titles or descriptions. Never post `/ok to test`.

## Review mode
- `live`: steps C, R and S act on GitHub as written below.
- `shadow`: do steps R and S fully, but don't push fixes from step R and don't post or edit the review brief. Keep step R's fixes out of the review-fix commit, which then holds only step C's fixes. Put the brief and step R's diff in the report: all of it when it's under about 200 lines, otherwise its stat and key hunks. Files you save during the run are lost when it ends. In step C, leave declined threads unresolved.
- `off`: skip steps R and S. In step C, leave declined threads unresolved.

## Preflight
- If `git fetch` or `gh` is denied by a permission prompt, stop. Report that the session lacks non-interactive tool approval (the automation needs allow-all permissions). Don't try to work around it.
- Jont828 has no write or triage access to ai-dynamo/dynamo. Don't attempt `gh run rerun`, because it returns 403. Report flakes as "needs a maintainer rerun" instead.

## Procedure
Triage every PR first: mergeStateStatus, mergeable, reviewDecision, statusCheckRollup, isDraft, createdAt, last commit date, reviews, review threads (GraphQL `reviewThreads` including isResolved), and comments. If mergeStateStatus is UNKNOWN, re-query after a short wait.

Then handle PRs one at a time. You may delegate each PR to a subagent for context isolation, but never work on two PRs concurrently in this worktree. A regular run does steps A→G for each PR. A review (the PR watch asks for one, or I ask you to review a PR) does steps C, R and S. Re-read PR state after any push.

### A. Rebase (only when needed)
- Rebase when mergeStateStatus is DIRTY or BEHIND, or when a CI failure is likely fixed on the latest upstream/main (see B). Don't rebase just because main moved. If the PR is already approved, rebase only when required to merge (a failing required check counts).
- Work detached: `git checkout --detach origin/<head>`, and record OLD_SHA.
- Back up first: `git push origin <OLD_SHA>:refs/heads/backup/<head>-<YYYYMMDD-HHMM>` (local time), then verify that it exists on origin. Never proceed without a verified backup.
- Record OLD_BASE=`git merge-base <OLD_SHA> upstream/main`, then run `git rebase upstream/main`. Resolve mechanical conflicts. If a conflict needs a design or product judgment, run `git rebase --abort` and report it.
- Semantic check (merge conflicts won't catch this): from the PR title, description, and diff, identify any rule the PR applies across a group of files (for example, "migrate all vLLM templates to a new folder or style"). Inspect `git diff --name-status <OLD_BASE> upstream/main` for files in that group:
  - If upstream added members in the old style, apply the PR's transformation to them.
  - If upstream deleted or renamed a source that the PR depends on, remove or rename the PR's derived page and any dependent PR additions (indexes, links, nav, catalogs).
  - If upstream modified a source that the PR migrated, port that content change into the migrated copy.
  Put these adjustments in a separate commit whose message explains each one.
- Validate: run `pre-commit run --from-ref upstream/main --to-ref HEAD`, plus relevant tests or builds for changed files when they're reasonably fast (under about 10 minutes). If validation fails and you can't fix it confidently, don't push. Report it instead.
- Push: `git push --force-with-lease=<head>:<OLD_SHA> origin HEAD:refs/heads/<head>`.

### B. CI
- If checks fail, read the failing job logs (`gh pr checks`, `gh run view <id> --log-failed`). If log download returns a transient 403, fetch job logs through the API (`gh api repos/ai-dynamo/dynamo/actions/jobs/<job_id>/logs`) and read the tail.
- Classify the root cause:
  1. This PR's code.
  2. upstream/main or a stale base.
  3. Infrastructure or flake (runner, network, timeout, OOM, registry, quota, external mirrors).
- Compare with the same job on recent upstream main runs and on other open ai-dynamo/dynamo PRs from the last ~48h. Matching failures on unrelated PRs or main point to flake or infra. Also check whether the job passed on the PR's previous commit and whether the PR touches any build inputs. State a confidence (High, Medium, or Low) with the evidence.
- Known recurring flakes (still verify each time): NVIDIA CUDA apt mirror size mismatch ("Mirror sync in progress?") in vllm image builds, and sglang-runtime builds cancelled at the ~60-minute job limit during "Compliance extract" after a slow BuildKit build. Both fail the required `backend-status-check`.
- For causes 2 and 3, check whether a fix has already landed on upstream/main since the PR's merge base:
  - Scan `git log <merge-base>..upstream/main` for commits that touch the failing job's workflow or CI scripts, dependency pins, container or build files, test config, or the failing tests.
  - Look for commits, or linked PRs, whose messages mention the error, test, or job.
  - Check whether that job failed on main runs before a given commit and passed after it.
  Record any likely fixing commit with a confidence.
- Cause 1 with a clear fix: fix it, validate as in A, commit, and push. Make at most one CI-fix commit per PR per run. If the same failure persists after an earlier automated fix (a commit with the `Automated-by: pr-shepherd` trailer), don't retry. Escalate instead.
- Cause 2 or 3 with a likely fix on main (Medium confidence or higher): rebase per A to pick it up, and cite the fixing commit in the report. Don't also rerun the old CI run.
- Cause 3 with no fix on main and High confidence of a flake: report it as needing a maintainer rerun (see Preflight).
- Anything else: report it as needing my attention, with the diagnosis.
- If CI hasn't started because the new SHA is waiting for a maintainer's `/ok to test`, report it.

### C. CodeRabbit
Check unresolved threads, and also CodeRabbit review bodies for "nitpick" and "outside diff range" items that never became threads. Skip walkthrough and summary comments. For each item from `coderabbitai[bot]` with no reply yet from Jont828:
- Re-check it against the current head. If a later commit already fixed it or removed the code, reply with that commit and resolve the thread.
- Otherwise judge it on evidence, not plausibility. Read the surrounding code and any guideline it cites (`.ai/*.md`, the nearest `AGENTS.md`, `.github/review-prompts/`). For a claimed bug, find the code path, or run a command or test that shows it.
- Valid and within this PR's scope: fix it, and every other instance of the same pattern in the PR. The fix goes in the review-fix commit (see Commits). After pushing, reply in the thread with what changed and the commit SHA, and resolve the thread.
- Not valid, not worth it, or out of scope (pre-existing code, or work for a follow-up): reply with a short, specific reason that cites the code or guideline. Post these replies before you push the review-fix commit.
- Needs a decision from me or a maintainer (design, product, API contract, scope), or you can't establish whether it's valid: don't reply. Leave it unresolved and list it under Needs your attention, with your analysis and a recommended answer.

CodeRabbit answers replies automatically, usually within a few minutes. Before you push, wait up to about five minutes for its answers to your declining replies. Then, and in every later run, check each unresolved thread whose last comment is your declining reply or CodeRabbit's answer to it:
- It accepts or only acknowledges: resolve the thread in live review mode, because ai-dynamo/dynamo requires every thread resolved before merge. In the other modes, leave it unresolved.
- It hasn't answered: leave the thread unresolved for a later run. Once your reply is a day old with no answer, treat that as acceptance.
- It disputes with a new argument: re-check once. If it's right, fix it (in the review-fix commit, when you haven't pushed it yet). Otherwise leave the thread unresolved and list the disagreement under Needs your attention, every run until I settle it.
- Don't reply to it again, except to report a fix.

In a regular run, finish with the review-fix commit (see Commits) if you made any fixes. In a review, step R finishes it.

### R. Self-review (reviews only)
Review the PR the way a Dynamo codeowner would, fix the verified low-risk findings, and keep everything else for me or the maintainers. Aim for fewer review rounds, not more comments: report only what a reviewer would act on.
1. Scope. The PR watch says what to review. Without it, the last reviewed head is the one in the brief's marker, if there's a brief.
   - A full review, when there's no earlier review.
   - A follow-up of the changes since the last reviewed head. Confirm it with `git merge-base --is-ancestor <last> HEAD`, review `<last>..HEAD`, and re-check the open items in the current brief.
   - A rewritten history since the last reviewed head. Use `git range-diff` against it to find what actually changed. If nothing changed except the base, say so and skip to step S.
2. Rubric. Use Dynamo's own review guidance as it is on upstream/main (for example `git show upstream/main:.agents/skills/pr-checklist/SKILL.md`), not the PR's copy, which the PR may change: `.agents/skills/pr-checklist/SKILL.md`, and what it points to (the area prompts in `.github/review-prompts/`, `.ai/*.md`, the `graham-code-review` skill for Rust, the `dynamo-docs` skill for docs, and the nearest `AGENTS.md`). Read the PR title and description, and check that the change does what they say.
3. Findings. Record for each one: a priority (P0 breaks something or blocks merge; P1 is a real bug or regression to fix before merge; P2 should be fixed; P3 is a nit), a confidence, the file and line, the evidence, and whether this PR introduced it or it's pre-existing. Report a repeated defect once and list every instance. Drop style that pre-commit doesn't enforce, speculation without a concrete code path, remarks that only ask for more tests, and anything CodeRabbit or a human has already raised. Keep at most three P3s.
4. Verify. Give each P0–P2 finding to a fresh subagent that hasn't seen your reasoning, with the code and the claim, and ask it to refute the finding. Keep only findings it can't refute. Where practical, reproduce a finding with a failing test or a command. Spend at most about 10 minutes on each finding; one you can't settle in that time is "unsure".
5. Decide:
   - Fix it: it's confirmed and introduced by this PR, the fix is local and unambiguous, and you can validate it here (see Commits). It must not change the design, the scope, or a user-facing contract (request fields, CLI flags, environment variables, metrics, CRD fields). Fix a P3 only when the fix is trivial and in lines the PR already changes.
   - Ask me: confirmed issues whose fix needs judgment or is large, and unsure findings. Give the evidence and a suggested fix.
   - Ask the maintainers, in the brief: only questions that need a maintainer's call, such as design fit, a contract or compatibility change, or a risk trade-off.
   - Pre-existing issues: list them in the report only. Don't fix them in this PR.
   - Don't raise again anything the current brief or a thread has already settled.
6. Apply. Add the fixes to the review-fix commit (see Commits), together with step C's, and finish it.

### S. Review brief
After step R, keep one short comment on the PR for the maintainers, so they can judge the PR's shape and either merge it or say what they need. It describes the head after your pushes.

```markdown
<!-- pr-shepherd:review-brief head=<full head SHA> -->
**Review brief** for <short head SHA>, written by the author's automated PR assistant.

**What it does:** one or two sentences.
**Risk:** Low, Medium or High, and why. Judge it by what changed (the core components in pr-checklist, user-facing contracts, CI, build or deploy files, security), not by size alone.
**Where to look:** up to three places that most need a human, each a file link and one line.
**Decisions for reviewers:** numbered questions, or "None".
**Checked:** CI at this head; tests or commands run; self-review fixes and their commit; CodeRabbit items fixed and declined.
**Still open:** what's waiting on the author, or "Nothing".

<details><summary>Declined CodeRabbit suggestions (N)</summary>

One line each: the suggestion, why it was declined, and a link to the thread.
</details>
```

- Keep it under about 250 words, not counting the declined list. Write "None" or "Nothing" instead of padding.
- Live review mode: find my comment with the `pr-shepherd:review-brief` marker and edit it (`gh api -X PATCH repos/ai-dynamo/dynamo/issues/comments/<id> -f body=...`). Post a new comment only when there's none. Don't post on a draft PR.
- In a regular run, if a PR has a brief whose Checked or Still open lines are out of date (CI finished, or you pushed), update those lines only. Don't review again.

### D. Human reviews and comments (notify only)
List reviews, threads, and comments from humans (not bots, not Jont828) that have no later reply from Jont828 and no later commit addressing them. Mark items from the last 24h as NEW, and note whether the author is a codeowner. Don't reply to humans.

### E. Approved, needs manual merge
If reviewDecision is APPROVED and the PR isn't merged or auto-merging, flag it as "ready for you to merge" with any remaining blockers.

### F. Codeowner pings
Ping only when all of these are true: the PR isn't a draft, reviewDecision is REVIEW_REQUIRED, CI is green (or failing only on High-confidence flakes), and there has been no human review activity for 2+ business days.
- Find which codeowner teams or users still need to approve, using requested reviewers and CODEOWNERS. `.github/codeowners/who_owns.py` may help. `gh pr view` caps the file list at 100, so use `gh api --paginate repos/ai-dynamo/dynamo/pulls/<n>/files` for large PRs. Team membership may not be visible to this token. If so, mention teams.
- First check for a comment by Jont828 containing `<!-- pr-shepherd:codeowner-ping -->` in the last 3 business days. If one exists, don't ping. Otherwise post one short, friendly comment that @mentions only the pending owners and ends with that hidden marker.

### G. Age
Flag PRs open for 7+ days, and any PR with no activity (commits or comments by anyone) in 3+ days.

## Commits
- Every commit must be signed (the repo has `commit.gpgsign=true` through SSH) and DCO signed-off (`git commit -s`). Add the trailer `Automated-by: pr-shepherd` to every commit you create. Use the repo's conventional-commit style. If signing fails, don't push. Report it instead.
- The review-fix commit holds the fixes from steps C and R together, so that CI runs once for them. Its message lists each fix and what prompted it (a CodeRabbit thread or a self-review finding).
  - Include only fixes you can validate here: pre-commit passes, and every changed file that has a build or tests gets them run. Where the environment can't build or test a change (for example Rust, Go or C++ code, or anything that needs a GPU or Docker), give me the patch instead of pushing it.
  - To finish it: validate as in step A, have a fresh subagent confirm that the diff fixes exactly the listed items and nothing else, check again that the PR has no approval (see Limits), then commit and push.
  - If validation fails and you can't fix it confidently, don't push. Report it, and leave the affected threads unanswered.

## Limits and failures
- Per PR per run: at most one rebase, one CI-fix commit, and one review-fix commit.
- Don't push a review-fix commit to a PR that has any current approval, even when reviewDecision isn't APPROVED yet (check `latestOpinionatedReviews`). List the fixes instead. In ai-dynamo/dynamo an approval survives new pushes, so it would cover code the approver never saw.
- Never use plain `--force`. If a push fails, inspect the remote state before any retry. Don't change remotes or credentials.
- If any step fails, stop work on that PR, leave origin as-is, and report what happened.
- A review has about 45 minutes per PR. When time runs short, stop fixing, mark what's left unsure, and still write the brief.
- Clean up temp files (for example `/tmp/prs`) before finishing. Leave the worktree clean.

## Report (final message)
Start with **Needs your attention** (or "Nothing needs you"). Then, for each PR, include:
- Link and a one-line status.
- Actions taken: pushes with SHAs, backup branch names, replies and resolutions, and pings.
- CI diagnosis: cause, confidence, evidence, and any fixing commit on main.
- Review, when there was one: how many findings were fixed, asked about, declined, refuted, or pre-existing; each fix with its commit; and the brief. In shadow mode, include the brief and the fixes you would have pushed.
- Items waiting on me.

Keep it short and scannable.
