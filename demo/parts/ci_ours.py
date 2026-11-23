"""Demo 3a: a CI failure caused by the PR's own code (skill step B, cause 1), on sandbox PR #12.
Recorded Nov 17, 2026.

PR #12 adds a duration parser whose hours multiplier is 360 instead of 3600, so three of its
own tests fail. The next slot's gate hands the failure to the agent, which reads the log,
reproduces it, fixes the code in one signed commit and waits for CI to go green.
"""

SEGMENT = {
    "part": "ci",
    "label": "3a",
    "title": "Our change broke a test → fix",
    "subtitle": "The PR's own code fails its tests: the shepherd finds the bug and pushes one signed fix",
    "recorded": "Nov 17, 2026",
}

RUN = "kubectl --context h100 -n orka-system logs -f job/dynamo-pr-shepherd-demo-1794957300-job-a7330b5d-0"
WATCH = "kubectl --context h100 -n orka-system get tasks -l orka.ai/parent-task=dynamo-pr-shepherd-demo -w"


def play(c):
    c.card("3a · Our change broke a test", "The PR's own code fails CI: diagnose it, fix it, push once",
           kicker="Demo 3 · step B")

    c.beat("setup", "Setup", "PR #12 adds a duration parser; three of its own tests fail in CI",
           browser=["opener-ci_ours", "ci-ours-before"])
    c.say("A new sandbox PR: a parser for kubectl-style durations like 90s, 5m or 1h30m")
    c.run("3a-10-pr-view", lines=slice(0, 4), hold=2.0)
    c.run("3a-11-pr-checks", hold=2.5)
    c.say("Which tests fail, and how?")
    c.run("3a-12-ci-failures", hold=3.5)

    c.beat("notice", "The gate notices", "Once CI on that head has finished, the next slot hands the failure over",
           browser="log-3a@start~work")
    c.run("3a-20-watch-check", lines=[slice(0, 4), slice(13, 16)], hold=3.5)
    c.say("The next slot (18:15) starts a run for it")
    c.run("3a-21-watch-runs", display=WATCH, lines=slice(0, 9), max_idle=1.5, suffix="^C", hold=1.5)

    c.beat("work", "The agent works", "Whose bug is it? This PR's: reproduce, fix, validate, push, wait for CI",
           browser="log-3a@work~end")
    c.run("3a-30-follow-run", display=RUN, lines=slice(0, 26), speed=10, max_idle=2.4,
          banner="⏩ five minutes of log, sped up", hold=3.0)

    c.beat("result", "Result", "One signed CI-fix commit; CI is green and nothing needs the author",
           browser="ci-ours-after")
    c.run("3a-40-pr-checks", hold=2.0)
    c.run("3a-41-fix-commit", hold=3.5)
    c.run("3a-42-signers", hold=2.5)
    c.say("The report: cause, confidence and evidence")
    c.run("3a-43-report", lines=[10, slice(18, 22)], hold=4.0)
