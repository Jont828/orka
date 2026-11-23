"""The demo's terminal story, chapter by chapter. Every `run` replays a real capture
(captures/<id>.cast); `say` lines are narration typed as shell comments.

Each chapter names the browser clip that plays beside it (browser/clips/<name>.webm, see
browser/scenes.mjs; "clip@a-b" plays only between the clip's marks a and b; title and outro
are slides); make_cast.py writes them to out/chapters.json.
"""

TITLE = "Orka PR shepherd + review assistant: a live demo on a sandbox PR"

DEMO_RUNS = "kubectl --context h100 -n orka-system get tasks -l orka.ai/parent-task=dynamo-pr-shepherd-demo"


def play(c):
    c.chapter("intro", "Orka PR shepherd + review assistant",
              "A scheduled Orka Task that moves PRs toward merge and reviews them", browser="title")
    c.say("First the real production schedule, then a live run on a sandbox PR in my fork", hold=2.0)
    c.say("Left: the terminal (real commands, real output). Right: GitHub and the Orka dashboard", hold=2.0)

    # ---------------------------------------------------------------- production
    c.chapter("prod", "1. The production schedule",
              "Live since Nov 9 on the h100 AKS cluster, for Jont828's PRs in ai-dynamo/dynamo",
              browser=["orka-prod", "upstream-prod"])
    c.say("One Orka Task, a container that runs Copilot CLI with the pr-shepherd skill")
    c.run("01-prod-task", hold=2.5)
    c.say("Every 15 minutes a gate (watch.mjs) decides in seconds whether the agent runs")
    c.run("02-prod-runs", hold=2.0)
    c.run("03-prod-verdicts", hold=3.5)
    c.say("Regular run every 2 hours; in between, only new conflicts, CI failures or reviews", hold=2.2)

    # ---------------------------------------------------------------- sandbox PR
    c.chapter("sandbox", "2. A sandbox PR in the fork",
              "Jont828/dynamo#11: orka-demo/quantity-parser -> orka-demo/base (never upstream)",
              browser="pr-before")
    c.say("To show it act without touching upstream, the demo targets a PR inside the fork")
    c.run("10-pr-view", hold=2.5)
    c.run("11-pr-checks", hold=2.5)
    c.say("CodeRabbit already flagged a real bug in it, and nobody has answered")
    c.run("12-coderabbit", hold=3.0)

    # ---------------------------------------------------------------- base moves
    c.chapter("conflict", "3. The base branch moves",
              "A change lands on orka-demo/base that touches the same README line",
              browser="pr-conflict")
    c.run("20-base-commit", hold=2.5)
    c.run("21-push-base", max_idle=0.4, hold=1.5)
    c.run("22-mergeable", hold=2.0)
    c.say("What would the next slot do? Run the production gate read-only against the sandbox:")
    c.run("23-watch-check", hold=4.0)

    # ---------------------------------------------------------------- demo schedule
    c.chapter("schedule", "4. A demo schedule pointed at the fork",
              "Same image, bootstrap, gate and skill as production; only these settings differ",
              browser="orka-run-live@start-run")
    c.run("30-demo-overrides", hold=3.0)
    c.run("31-apply", hold=1.5)
    c.run("32-demo-task", hold=2.5)

    # ---------------------------------------------------------------- run 1
    c.chapter("run1", "5. The next slot: a run scoped to the problems",
              "18:35: the gate gives the agent steps A (rebase) and B (CI) for PR #11",
              browser="orka-run-live@run-end")
    c.run("40-watch-runs-1", display=f"{DEMO_RUNS} -w", lines=slice(0, 5), max_idle=1.5, suffix="^C", hold=1.0)
    c.run("41-follow-run-1",
          display="kubectl --context h100 -n orka-system logs -f job/dynamo-pr-shepherd-demo-1794440100-job-a61bed70-0",
          speed=12, max_idle=2.6, banner="⏩ six minutes of log, sped up; long pauses trimmed", hold=5.0)

    # ---------------------------------------------------------------- result 1
    c.chapter("result1", "6. Rebased, re-signed, backed up",
              "Conflict gone, the CI failure diagnosed, and the next slot already reviewing",
              browser="pr-rebased")
    c.run("42-runs-now", hold=2.0)
    c.run("51-pr-after", hold=2.0)
    c.say("Commits are re-signed by the cluster's key; the author's messages and dates stay")
    c.run("52-signers", hold=2.5)
    c.run("53-backup", hold=2.5)

    # ---------------------------------------------------------------- run 2
    c.chapter("run2", "7. The next slot: a review run",
              "18:41: the head is new and mergeable, so steps C, R and S start (live mode)",
              browser="orka-review-live")
    c.run("61-follow-run-2",
          display="kubectl --context h100 -n orka-system logs -f job/dynamo-pr-shepherd-demo-1794440400-job-9f873be1-0",
          speed=14, max_idle=2.4, banner="⏩ nine minutes of log, sped up; long pauses trimmed", hold=5.0)

    # ---------------------------------------------------------------- result 2
    c.chapter("result2", "8. Fixed, answered and briefed",
              "One signed fix commit, the CodeRabbit thread settled, a brief for maintainers",
              browser="pr-reviewed")
    c.say("A third commit: signed by the cluster key, with the Automated-by trailer")
    c.run("72-signers", hold=2.5)
    c.run("76-fix-commit", hold=3.5)
    c.run("73-threads", hold=3.5)
    c.run("74-brief", hold=5.0)

    # ---------------------------------------------------------------- quiet
    c.chapter("quiet", "9. Then the watch goes quiet",
              "The shepherd's own fix doesn't start another review",
              browser="orka-result-2")
    c.run("71-verdicts-demo", hold=3.0)
    c.run("75-result-2", lines=slice(0, 14), hold=3.5)
    c.say("Demo over: pause the demo schedule. Production keeps its */15 schedule")
    c.run("80-suspend", hold=1.5)
    c.run("81-final-tasks", hold=3.0)

    c.chapter("outro", "What the shepherd did, unattended",
              "Two agent runs, about 15 minutes in all; nobody touched the PR after the base push",
              browser="outro", keep=True)
    c.say("Sandbox PR: https://github.com/Jont828/dynamo/pull/11", hold=1.0)
    c.say("Every report is the Orka Task result; the schedule is task/dynamo-pr-shepherd", hold=3.0)
