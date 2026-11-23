# Orka PR shepherd: demo, part by part

What the Orka PR shepherd does, shown live on sandbox PRs in the fork
([Jont828/dynamo](https://github.com/Jont828/dynamo)), never against ai-dynamo/dynamo. Orka 0.3.0 on the
h100 AKS cluster. Recorded Nov 11, 2026 (demos 1, 2, 3c and 4) and Nov 17, 2026 (demos 3a and 3b, the
wrap-up), EST.

| Part | Segment | What it shows | Skill step | Sandbox PR |
|---|---|---|---|---|
| Intro | `intro` | What Orka is, how the shepherd runs on it (a gate every 15 minutes, an agent only when needed), what it handles, how the demos ran, its guardrails | | |
| 1 | `comments` | Review comments: CodeRabbit's M/G finding checked, reproduced, fixed in 418a77b, thread answered and resolved | C | [#11](https://github.com/Jont828/dynamo/pull/11) |
| 2 | `conflict` | Merge conflict: 5998863 on the base edits the PR's README line; backup, rebase, validate, push 4595c1b → 88d6e91 with a lease | A | #11 |
| 3a | `ci_ours` | CI fails because of the PR's own code (hours × 360): reproduced, fixed in eb2c0f9, CI green | B, cause 1 | [#12](https://github.com/Jont828/dynamo/pull/12) |
| 3b | `ci_base` | CI fails because of the base (07a80bb), and the base has a fix (367a899): rebased acb0ab8 → 2c2baf4, CI green | B, cause 2 | [#13](https://github.com/Jont828/dynamo/pull/13) |
| 3c | `ci_infra` | CI fails in a fork-only bot job: diagnosed as infrastructure, reported, no commit | B, cause 3 | #11 |
| 4 | `review` | Review assistant: Dynamo's rubric, each fix confirmed by a fresh subagent, one review brief | R + S | #11 |
| Wrap-up | `wrapup` | Production's 2-hourly report (Nov 17, 18:00), then a recap | D–G | |

After each setup, nobody touched the PRs. Each demo has the same four beats: setup, the gate notices, the
agent works, result. The runs that did work took 6.1, 8.6, 5.4 and 6.2 minutes; every other slot ended in
seconds. Production (`dynamo-pr-shepherd`, `*/15`, review mode **shadow**) was only observed, never changed.

## Watch it

| File | What it is |
|---|---|
| `out/demo.mp4` | The whole demo side by side at 1920x1080 (about 13.5 minutes): terminal left, browser right, the outline of parts and the current beat below. |
| `out/segments/<segment>/segment.mp4` | One clip per segment, the same layout. `demo.mp4` is these joined in order. |
| `out/player/index.html` | Synced player: a real asciinema player with the browser video following it, the outline as buttons (part → demo → beat), and what each demo did with links. Works offline. |
| `out/artifact/` | The same page for publishing as a claude.ai Artifact (body-only HTML, player script from jsDelivr, `browser.mp4` + `poster.jpg` as supporting files). |
| `out/demo.cast`, `out/chapters.json` | The terminal recording alone (`asciinema play out/demo.cast`) and every beat's times. |
| `out/v1/` | The first version (Nov 11, one story on #11), with its `screenplay.py`. |

The terminal types each command and replays the output it really produced. Typing is simulated, long
waits are shortened and marked ⏩, and a few commands are shown in a simpler form (the log and watch
helpers in `bin/` as the `kubectl` calls they wrap). The browser clips are Playwright recordings of a
logged-out Chrome (GitHub) and the Orka dashboard, with captions added on the page. The wrap-up's report
skips, in the terminal, and blurs, in the browser, the parts that name or quote reviewers.

## Layout

| Path | Purpose |
|---|---|
| `parts/` | The story. `__init__.py` lists the parts and the segment order; each segment (`intro.py`, `comments.py`, …) types narration, replays captures and starts beats, each with the browser clips to show. |
| `build.py` | Builds one clip per segment, then joins them and builds the player page (see Rebuild). |
| `make_cast.py` | A segment's narration + captures → `out/segments/<segment>/demo.cast` and `chapters.json`. |
| `make_video.py` | A segment's cast (agg) and browser clips → `terminal.mp4`, `browser.mp4`, `segment.mp4`; `--merge` joins the segments. |
| `make_player.py`, `player/` | The synced player page (template and vendored asciinema-player 3.10.0). |
| `browser/` | `record.mjs` + `scenes.mjs` (Playwright scenes → `clips/*.webm` with marks in `clips/*.json`), `slides.mjs` (slides and demo openers → `clips/*.png`), `chrome.mjs` (the video's frame, once per beat), `check-player.mjs` (player screenshots and sync check). `title.html`, `outro.html` and `still.mjs` made v1's slides. |
| `captures/` | One `.cast` per real command, with the shown text (`.cmd`) and when it ran (`.when`). |
| `bin/` | Capture and inspection helpers: `cap` (records a command into `captures/`), `watch-check`, `watch-runs`, `follow-run`, `follow-next`, `verdicts`, `orka-result`, `ci-failures`, `pr-signers`, `pr-threads`, `pr-brief`, `demo-settings`. |
| `demo-preamble.md`, `pr-shepherd-demo.json` | The demo Task: production's spec and prompt with this preamble prepended. It runs on a `*/5` schedule against the fork only (`SHEPHERD_REPO=Jont828/dynamo`, state in `ORKA_PR_SHEPHERD_DEMO_STATE`). |
| `sandbox/` | Source of the sandbox PRs (`deploy/utils` parsers, tests, the `orka-demo-ci.yml` check) and their bodies. |
| `CLEANUP.log` | Every change made outside this directory, with times. |

## Rebuild

Needs asciinema 3, agg, ffmpeg (with libx264), Node with Playwright (`cd browser && npm ci`), and Chrome.

```bash
python3 build.py                        # every segment's clip, then join them and build the player page
python3 build.py ci_base                # redo one clip (after editing parts/ci_base.py), then join again
python3 build.py --frame-only           # only the frame changed (titles, outline): keep the tracks
python3 build.py --join                 # only join the existing clips and rebuild the page
(cd browser && node check-player.mjs ../out/player/index.html /tmp/pl)   # screenshots + sync check
```

Every beat is a whole number of frames and the first beat of a segment also covers its title card, so
the clips join without drift.

Re-record a browser scene: Orka scenes need `kubectl --context h100 -n orka-system port-forward svc/orka 18080:8080`
and `ORKA_TOKEN` in the environment, for example `ORKA_TOKEN="$(kubectl --context h100 -n orka-system create token orka-client --duration=15m)"`.
It goes into the dashboard's auth store, never on screen. Then `(cd browser && node record.mjs prod-report)`.
Slides: `(cd browser && node slides.mjs [name ...])`. Production Task history is garbage-collected, so
some Nov 11 dashboard scenes (for example `orka-prod`) can no longer be re-recorded.

To publish the page: `out/artifact/index.html` with `browser.mp4` and `poster.jpg` as its files. That
needs a Claude Code session logged in with a claude.ai account.

## Changes outside this directory

All in the fork, plus the demo Task on h100; times are in `CLEANUP.log`.

- `orka-demo/base` (standing in for upstream main): 5998863 (Nov 11, the README conflict) → b92f938 (the
  sandbox check tests the PR head with all deploy/utils tests, like Dynamo's copy-pr-bot) → 07a80bb (the
  base regression) → 367a899 (its fix).
- Sandbox PRs #11, #12 and #13, and their backup branches `backup/orka-demo/quantity-parser-20261111-1836`,
  `backup/orka-demo/duration-parser-20261117-1816` and `backup/orka-demo/pvc-docs-20261117-1846`.
- The fork's "Trigger CI Approval Flow" workflow was disabled during each recording (Nov 11 18:11–18:55,
  Nov 17 17:58–19:01) and is active again.
- The demo Task `dynamo-pr-shepherd-demo` is suspended, with review mode back to `live` (it was `off` for
  demos 3a and 3b).

## Cleanup (nothing here is required; the demo schedule is suspended)

```bash
# the sandbox PRs, their branches (including the demo CI workflow, which lives only on orka-demo/base) and the backups
for pr in 11 12 13; do gh pr close $pr -R Jont828/dynamo; done
for b in orka-demo/quantity-parser orka-demo/duration-parser orka-demo/pvc-docs orka-demo/base \
         backup/orka-demo/quantity-parser-20261111-1836 backup/orka-demo/duration-parser-20261117-1816 \
         backup/orka-demo/pvc-docs-20261117-1846; do
  gh api -X DELETE "repos/Jont828/dynamo/git/refs/heads/$b"; done
gh api -X DELETE repos/Jont828/dynamo/actions/variables/ORKA_PR_SHEPHERD_DEMO_STATE   # the demo gate's state (not production's ORKA_PR_SHEPHERD_STATE)

# the demo Task; this also garbage-collects its owner-referenced child runs, so save any results you want first
kubectl --context h100 -n orka-system delete task dynamo-pr-shepherd-demo

# Playwright's ffmpeg was replaced by a wrapper around Homebrew's; Playwright re-downloads its own after this
rm -rf ~/Library/Caches/ms-playwright/ffmpeg-1011
```
