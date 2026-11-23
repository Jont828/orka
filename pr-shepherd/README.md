# Dynamo PR shepherd on Orka (h100 AKS)

Orka 0.3.0 runs your `pr-shepherd` skill (`~/.copilot/skills/pr-shepherd/SKILL.md`) as a scheduled container Task.
It replaced the Copilot app's "Dynamo PR shepherd" automation on Nov 9, 2026.
The Task uses Copilot CLI with your Copilot subscription, plus `gh` and git as Jont828.

| File | Purpose |
| --- | --- |
| `preamble.md` | Headless/Orka environment notes prepended to the skill |
| `dryrun-preamble.md` | Read-only override used by dry-run Tasks |
| `bootstrap.sh` | Container script: runs the PR watch gate, then installs pinned gh/uv/Copilot CLI, clones the fork, runs `copilot -p` |
| `watch.mjs` | PR watch gate: decides whether a slot runs the full shepherd, a run scoped to new conflicts, CI failures or reviews, or nothing; keeps the [Fern docs preview link](#fern-docs-preview-link) at the top of each PR description |
| `watch.test.mjs` | Offline tests for the gate (`node watch.test.mjs`) |
| `render.py` | Builds `pr-shepherd.yaml` and `pr-shepherd-dryrun.yaml` from the skill (`uv run --with pyyaml python render.py`) |
| `mint-token.sh` | Mints a dedicated GitHub token for the cluster through GitHub's device flow |
| `prompt.md` | The original Nov 4 automation prompt, for reference and rollback (`PR_SHEPHERD_SKILL=prompt.md` when rendering) |
| `signing_key.pub` | Public half of the cluster's commit-signing key |
| `dryrun-report.txt`, `dryrun-report-20261109.txt` | Dry-run reports: Nov 4 (original prompt) and Nov 9 (skill + dedicated token) |
| `dryrun-report-review-20261110.txt` | First review dry run (`SHEPHERD_MODE=review`, read-only) of #17372, Nov 10 |

Cluster objects (namespace `orka-system`, context `h100`):

- `task/dynamo-pr-shepherd` is the schedule: `*/15 * * * *` America/New_York, `Forbid`. Live since Nov 9, 2026; every
  15 minutes with the PR watch since Nov 10 (before that, `0 12-20/2 * * 1-5`).
- `task/dynamo-pr-shepherd-dryrun*` are read-only verification runs.
- `secret/pr-shepherd-github` (`token`) and `secret/pr-shepherd-signing` (`signing_key`, `signing_key.pub`) hold the credentials.

## PR watch

Every 15 minutes the Task starts and `watch.mjs` decides, in a few seconds and before anything is installed:

- **Regular run** every 2 hours on the even hour (00:00, 02:00, …, 22:00 ET), every day including weekends: the
  full skill. Until Nov 10 these ran only on weekdays, 12:00–20:00 ET. If a triggered run was still going at that
  time, Forbid skips the slot, and the next slot within 90 minutes makes it up.
- **Triggered run** when one of your open PRs has a problem the shepherd hasn't been given yet:
  - a merge conflict (`mergeable: CONFLICTING`) at a head it hasn't been given that conflict for, or
  - failed checks (failure, timed out, cancelled, startup failure, or a failed commit status) that it hasn't been
    given, once CI on that head has finished. A failure that's over 60 minutes old counts even while other checks
    still run. A rerun that passes hides the failure it replaced; a rerun that fails again counts as new.

  The run gets a prompt section listing those PRs and problems. It handles only step A (rebase) or B (CI) for them
  and skips C–G (CodeRabbit, human reviews, approvals, pings, age), which the regular runs cover. Its report starts
  with "Triggered by the PR watch:".
- **Review run** when a PR head needs a review (see [Review assistant](#review-assistant)). It can share a run
  with a triggered run's problems.
- **Nothing**: the Task result is one line per PR, like `#17372 (head 279deed): no merge conflict; CI passed (128 checks)`.

What the shepherd has been given is stored in the Actions variable `ORKA_PR_SHEPHERD_STATE` on Jont828/dynamo
(GitHub: Settings → Secrets and variables → Actions → Variables). The gate writes it before a run starts, so a run
that fails isn't retried every 15 minutes: the problem waits for the next regular run, a new head, or a new
failure. A triggered run whose state can't be written doesn't start, and its Task fails. To make the watch
look at everything again, delete the variable:

```bash
gh api -X DELETE repos/Jont828/dynamo/actions/variables/ORKA_PR_SHEPHERD_STATE   # reset
gh api repos/Jont828/dynamo/actions/variables/ORKA_PR_SHEPHERD_STATE --jq .value | jq .   # inspect
```

Settings, with defaults in `watch.mjs` (to change one, add it to the Task's `env` in `render.py`): `SHEPHERD_FULL_DAYS` (`1,2,3,4,5,6,7`, Monday is 1),
`SHEPHERD_FULL_HOURS` (`0,2,4,6,8,10,12,14,16,18,20,22`), `SHEPHERD_CI_STALE_MINUTES` (`60`), `SHEPHERD_FULL_MAKEUP_MINUTES` (`90`).
For example, `SHEPHERD_FULL_DAYS=1,2,3,4,5` with `SHEPHERD_FULL_HOURS=12,14,16,18,20` brings back the old weekday
regular runs. To watch only some hours, narrow the cron in `render.py` (for example `*/15 8-23 * * *`); regular runs
at hours the cron skips don't happen either. `SHEPHERD_REVIEW` (`off`, `shadow` or `live`) comes from `REVIEW_MODE`
in `render.py`, and `SHEPHERD_SIGNING_FINGERPRINT` from `signing_key.pub` (see [Review assistant](#review-assistant)).
`SHEPHERD_REVIEW_QUIET_MINUTES` (`60`) is how old a head must be before it's reviewed, and
`SHEPHERD_REVIEW_MAX_PER_RUN` (`1`) how many PRs one run reviews. `SHEPHERD_FERN_PREVIEW` (`on` or `off`) turns the
[Fern docs preview link](#fern-docs-preview-link) on or off. `SHEPHERD_MODE` is
`auto` on the schedule. `full` always runs the full skill, `review` reviews open PRs that aren't drafts or approved
from scratch right away (up to the per-run limit; `SHEPHERD_REVIEW_PRS=18569` picks which, and anything but PR
numbers there is an error), and `check` only prints what `auto` would do.
`SHEPHERD_READ_ONLY=1` never writes the state or a PR description. Most runs now end in seconds, so the Task keeps 100 successful runs
(about a day) instead of 10.

## Fern docs preview link

Since Nov 19, 2026, every slot, whatever else it does, keeps a link to each open PR's newest Fern docs preview at the
top of the PR's description, as a heading:

```markdown
<!-- pr-shepherd:fern-preview:start -->
## 🌿 [Fern docs preview](https://nvidia-preview-<id>.docs.buildwithfern.com/dynamo/dev)
<!-- pr-shepherd:fern-preview:end -->
```

- **Where the link comes from:** upstream's `fern-docs.yml` runs on the `pull-request/<N>` copy of a PR, which
  copy-pr-bot pushes after `/ok to test` (dynamo-ops posts that for Verified fork commits). When the PR changes docs,
  it builds a preview and edits one `github-actions[bot]` comment, "🌿 **Fern Docs Preview:** <url>", with each
  build's new URL. The watch takes the URL from the most recently edited of those comments, and only a
  `*.docs.buildwithfern.com` URL. A PR without that comment (one that changes no docs) is left alone.
- **The edit:** the watch replaces the block between the markers wherever it is (so you can move it), or adds it at
  the top. The rest of the description, including CodeRabbit's summary, stays as it is. It reads the description
  right before writing, and writes only when the link changed. A new build shows up within 15 minutes, or after a
  long run, which Forbid waits for. A deleted block comes back at the next slot, so turn the feature off instead.
- The gate does this edit, not the agent. The skill still tells the agent never to edit PR descriptions.
- Editing a description re-runs upstream's `pr-issue-link` and `lint-pr-title` checks, which run on `edited`. It
  doesn't start CI.
- A PR's status line in the Task result says when its link was added or updated (in check and read-only runs, that
  it would be). A GitHub error is logged and retried at the next slot. It never fails the slot.
- **Off:** add `SHEPHERD_FERN_PREVIEW=off` to the Task's `env` in `render.py`, then re-render and apply. The blocks
  already in descriptions stay until you delete them.

## Review assistant

Since Nov 10, 2026 the skill has review steps that aim to leave maintainers only the decisions that need them:
C (CodeRabbit), R (self-review) and S (review brief). They follow Dynamo's own review guidance in the checkout
(`.agents/skills/pr-checklist`, `.github/review-prompts/`, `.ai/*.md`).

- **When:** the watch starts a review run for an open PR that isn't a draft or approved and has no merge conflict,
  once its head has commits the shepherd didn't make since the last review and is at least 60 minutes old (so a
  branch you're still pushing to waits). The first review of a PR is a full review; later ones cover only the new
  commits, or use `git range-diff` after a rebase.
  - The shepherd's own fixes never start a review: they're signed with the cluster's key (`signing_key.pub`) and
    carry the `Automated-by: pr-shepherd` trailer. A fix you amend locally is signed with your key, so it does.
  - After a rebase, by the shepherd or by you, a commit counts as already reviewed when it keeps the author date,
    message and line counts of a commit in the last reviewed head's history. So your new commits still start a
    review even when a shepherd rebase re-signed them, and so does an amend that changes line counts. The gap: an
    amend that keeps every count (say, one line changed in place) isn't reviewed until your next commit.
  - A head with nothing new since its last review (only the shepherd's fixes, or a rebase) is recorded as reviewed,
    so later rebases match those fixes too. That's the one state write a slot can make without starting a run.
  - One run reviews one PR (the one whose head has waited longest); the others wait for the next slots. A review due
    at a regular slot also waits for the next slot, so a run stays well within its time limit.
  - The last head given to a review is `reviewedHead` in the state. It's recorded before the run starts, so a review
    run that fails isn't retried until the next new head. To redo one, or to review a PR from scratch, start a
    one-off review of that PR (below), or remove its `reviewedHead` so the watch reviews it again:

    ```bash
    V=repos/Jont828/dynamo/actions/variables/ORKA_PR_SHEPHERD_STATE
    gh api -X PATCH $V -f value="$(gh api $V --jq .value | jq -c 'del(.prs["18569"].reviewedHead)')"
    ```
- **C, CodeRabbit:** each new item is judged on evidence against the current head. Valid ones are fixed, along with
  every other instance of the same pattern; the rest get a short reason; items that need your call are listed in
  the report. CodeRabbit answers replies automatically: a declined thread is resolved (in live mode) only once it
  accepts the reason or a day passes without an answer, later runs pick up late answers, and a dispute goes to you.
- **R, self-review:** a codeowner-style review. A fresh subagent tries to refute each P0–P2 finding, and only
  findings it can't refute survive. A confirmed finding this PR introduced, with a local, unambiguous fix, is fixed;
  the rest go to you (report) or, for questions only a maintainer can answer, into the brief. Pre-existing issues
  are only reported. Fixes from C and R go in one review-fix commit, so CI runs once. Only fixes the container can
  validate are pushed (it has no Rust, Go or C++ toolchain, GPU or Docker); for the others you get the patch.
- **S, review brief:** one comment on the PR, edited in place after each review: what the PR does, its risk and why,
  where to look, decisions for reviewers, what was checked, and what's still open.
- **Mode**, set by `REVIEW_MODE` in `render.py`:
  - `shadow` (the setting since Nov 10): review runs happen, and their reports hold the brief and the fixes they
    would push. The brief isn't posted and those fixes aren't pushed. CodeRabbit threads are handled as before
    (with the stricter judgment above), and declined ones stay open.
  - `live`: pushes verified fixes, posts and updates the brief, and resolves a declined CodeRabbit thread once
    CodeRabbit accepts the reason (ai-dynamo/dynamo requires every thread resolved before merge).
    The skill's own default is `shadow`, so the Copilot app automation or an interactive run uses shadow unless told
    otherwise.
  - `off`: no review runs, and steps R and S are skipped.
- **Limits:** no review-fix commit on a PR with any approval, even a partial one (an approval here survives new
  pushes, so it would cover code the approver never saw; it's checked again just before pushing), one review-fix
  commit per PR per run, and about 45 minutes per PR.

Reports from review runs start with "Triggered by the PR watch:", and their Task result's first line says "a review
is due". Orka keeps them about a day. To list the recent ones (with the port-forward and `$TOKEN` from
[below](#dry-run-run-once-now-check-the-watch-read-reports)):

```bash
for t in $(kubectl --context h100 -n orka-system get tasks -l orka.ai/parent-task=dynamo-pr-shepherd -o jsonpath='{.items[*].metadata.name}'); do
  curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/v1/tasks/$t/result?namespace=orka-system" \
    | jq -r '.result // empty' | head -1 | grep -q 'review' && echo "$t"
done
```

## Pause and resume

Two shepherds working the same PRs would race. Keep the Copilot app's "Dynamo PR shepherd" automation disabled
while this schedule runs, and pause this one before you re-enable that one.

```bash
kubectl --context h100 -n orka-system patch task dynamo-pr-shepherd --type merge -p '{"spec":{"suspend":true}}'    # pause
kubectl --context h100 -n orka-system patch task dynamo-pr-shepherd --type merge -p '{"spec":{"suspend":false}}'   # resume
```

Pausing stops the regular runs and the watch together. It doesn't stop a run that has already started. After a resume, Orka doesn't make up the runs it missed,
except one that's less than 10 minutes late. Its `MissedSchedule` warning event is expected.

## Dry run, run once now, check the watch, read reports

```bash
# Read-only dry run of the full skill (unique name, so earlier dry runs are kept):
kubectl --context h100 create --dry-run=client -o json -f pr-shepherd-dryrun.yaml \
  | jq --arg n "dynamo-pr-shepherd-dryrun-$(date +%Y%m%d-%H%M)" '.metadata.name = $n' \
  | kubectl --context h100 create -f -

# Read-only dry run of a review (steps C, R and S) from scratch of one PR (set PR):
PR=18569
kubectl --context h100 create --dry-run=client -o json -f pr-shepherd-dryrun.yaml \
  | jq --arg n "dynamo-pr-shepherd-reviewdry-$(date +%Y%m%d-%H%M)" --arg pr "$PR" '.metadata.name = $n
        | .spec.env |= (map(if .name=="SHEPHERD_MODE" then .value="review" else . end) + [{name:"SHEPHERD_REVIEW_PRS",value:$pr}])' \
  | kubectl --context h100 create -f -

# One-off real review from scratch of one PR, built from the scheduled spec; in live review mode it pushes and
# posts. Like the one-off run above, Forbid can't see it, so start it when no scheduled run is going:
PR=18569
kubectl --context h100 -n orka-system get task dynamo-pr-shepherd -o json \
  | jq --arg pr "$PR" '.metadata={name:"dynamo-pr-shepherd-review-\(now|floor)",namespace:"orka-system"} | del(.status)
        | .spec |= (del(.schedule,.timeZone,.concurrencyPolicy,.startingDeadlineSeconds,.successfulRunsHistoryLimit,.failedRunsHistoryLimit,.suspend)
                    | .env |= (map(if .name=="SHEPHERD_MODE" then .value="review" else . end) + [{name:"SHEPHERD_REVIEW_PRS",value:$pr}]))' \
  | kubectl --context h100 apply -f -

# One-off real run of the full skill, built from the scheduled spec. It isn't a child of the
# schedule, so Forbid can't see it: start it when no scheduled run is going.
kubectl --context h100 -n orka-system get task dynamo-pr-shepherd -o json \
  | jq '.metadata={name:"dynamo-pr-shepherd-manual-\(now|floor)",namespace:"orka-system"} | del(.status)
        | .spec |= (del(.schedule,.timeZone,.concurrencyPolicy,.startingDeadlineSeconds,.successfulRunsHistoryLimit,.failedRunsHistoryLimit,.suspend)
                    | .env |= map(if .name=="SHEPHERD_MODE" then .value="full" else . end))' \
  | kubectl --context h100 apply -f -

# What would the watch do right now? Prints the decision and prompt section, writes nothing, runs no agent:
kubectl --context h100 -n orka-system get task dynamo-pr-shepherd -o json \
  | jq '.metadata={name:"dynamo-pr-shepherd-watchcheck-\(now|floor)",namespace:"orka-system",labels:{"pr-shepherd/mode":"check"}} | del(.status)
        | .spec |= (del(.schedule,.timeZone,.concurrencyPolicy,.startingDeadlineSeconds,.successfulRunsHistoryLimit,.failedRunsHistoryLimit,.suspend)
                    | .timeout="10m" | .env |= map(if .name=="SHEPHERD_MODE" then .value="check" else . end))' \
  | kubectl --context h100 create -f -
# The same check locally, with your laptop's gh token:
GH_TOKEN=$(gh auth token) TZ=America/New_York SHEPHERD_REVIEW=shadow SHEPHERD_MODE=check SHEPHERD_OUT_DIR=$(mktemp -d) node watch.mjs

kubectl --context h100 -n orka-system get tasks -l orka.ai/parent-task=dynamo-pr-shepherd   # scheduled runs
kubectl --context h100 -n orka-system logs -f job/"$(kubectl --context h100 -n orka-system get task <run> -o jsonpath='{.status.jobName}')"   # live
```

The report is the Task result. You can read it through the API or the dashboard, both of which need a port-forward:

```bash
kubectl --context h100 -n orka-system port-forward svc/orka 8080:8080 &
TOKEN=$(kubectl --context h100 -n orka-system create token orka-client)
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/v1/tasks/<task-name>/result?namespace=orka-system" | jq -r .result
# Dashboard: http://localhost:8080 (sign in with $TOKEN)
```

## Credentials

- **Signing key:** commits are signed with a key that exists only in the cluster. Its public half,
  `signing_key.pub`, is on GitHub as the signing key "Orka H100" (added Nov 9, 2026). If it's ever removed, those
  commits show as "Unverified". ai-dynamo/dynamo has no signed-commit rule, so that wouldn't block merging.
- **GitHub token:** since Nov 9 the Secret holds a token used only by the cluster. It is a GitHub CLI OAuth token
  (`gho_`) minted through the device flow, with scopes `repo`, `read:org` and `workflow`. It isn't your laptop's
  `gh` token or the Copilot app's token, so you can revoke it on its own. gh, git and Copilot CLI all use it.
  Copilot CLI rejects classic `ghp_` PATs. To rotate it:

  ```bash
  S=$(mktemp -d)
  ./mint-token.sh start "$S"   # prints a code: approve it at https://github.com/login/device
  ./mint-token.sh poll "$S"    # waits for approval, checks the account is Jont828
  kubectl --context h100 -n orka-system create secret generic pr-shepherd-github \
    --from-file=token="$S/token" --dry-run=client -o json | kubectl --context h100 replace -f -
  rm -rf "$S"
  ```

  To revoke the old token after rotating, use `POST https://api.github.com/credentials/revoke` with `{"credentials": ["<token>"]}`.

## Change the instructions, model or schedule

- **Instructions:** edit the skill (`~/.copilot/skills/pr-shepherd/SKILL.md`). Environment-specific notes go in `preamble.md`.
- **Model, effort, review mode or schedule:** edit `render.py`. The regular-run times are `SHEPHERD_FULL_DAYS` and
  `SHEPHERD_FULL_HOURS` (see [PR watch](#pr-watch)); the cron only sets how often the watch looks. `REVIEW_MODE`
  turns the review assistant to `off`, `shadow` or `live`.
- **Watch logic:** edit `watch.mjs` and run `node watch.test.mjs`.

Then run `uv run --with pyyaml python render.py` and `kubectl --context h100 apply -f pr-shepherd.yaml`.
The render doesn't set `suspend`, so applying it leaves the schedule paused or running, as it was.
