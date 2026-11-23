"""Demo 3b: a CI failure the PR didn't cause, already fixed on the base (skill step B, cause 2),
on sandbox PR #13. Recorded Nov 17, 2026.

A cleanup on orka-demo/base (standing in for upstream main) stops quoting y and n, which breaks
a test. Docs-only PR #13 branches after it, so its CI fails on a test it never touched. Then a
fix lands on the base. Dynamo's CI tests the PR's own head, so only a rebase brings the fix in:
the agent works out it isn't the PR's code, finds the fixing commit and rebases onto it.
"""

SEGMENT = {
    "part": "ci",
    "label": "3b",
    "title": "Fixed on main → rebase",
    "subtitle": "Not the PR's bug: the shepherd finds the fix on the base and rebases onto it",
    "recorded": "Nov 17, 2026",
}

RUN = "kubectl --context h100 -n orka-system logs -f job/dynamo-pr-shepherd-demo-1794959100-job-b0bb4c82-0"
WATCH = "kubectl --context h100 -n orka-system get tasks -l orka.ai/parent-task=dynamo-pr-shepherd-demo -w"


def play(c):
    c.card("3b · Main was broken, and it's fixed now", "Not the PR's bug: find the fix on the base, rebase onto it",
           kicker="Demo 3 · step B")

    c.beat("setup", "Setup", "A base commit breaks a test; docs-only PR #13 branches after it and fails CI",
           browser=["opener-ci_base", "ci-base-before"])
    c.say("A cleanup lands on the base branch (standing in for upstream main):")
    c.run("3b-10-base-regression", lines=slice(0, 3), hold=2.0)
    c.say("It drops y and n from the strings it quotes; go-yaml reads those as booleans")
    c.say("Then a docs-only PR branches from that base")
    c.run("3b-11-pr-view", lines=slice(0, 4), hold=1.5)
    c.run("3b-12-pr-files", hold=1.5)
    c.say("Its CI fails anyway, on a test it never touched:")
    c.run("3b-14-ci-failures", hold=3.0)

    c.beat("fix", "Main gets fixed", "367a899 restores the tokens; PR #13 stays red because CI tests its own head",
           browser="ci-base-fix")
    c.run("3b-20-base-fix", lines=slice(0, 7), hold=3.0)

    c.beat("notice", "The gate notices", "The next slot hands the failed check over",
           browser="log-3b@start~work")
    c.run("3b-21-watch-check", lines=slice(0, 4), hold=3.0)
    c.run("3b-22-watch-runs", display=WATCH, lines=[0, slice(5, 12)], max_idle=1.5, suffix="^C", hold=1.5)

    c.beat("work", "The agent works", "A README change can't break dump_docs: it finds the fix on the base and rebases",
           browser="log-3b@work~end")
    c.run("3b-30-follow-run", display=RUN, lines=slice(0, 28), speed=10, max_idle=2.4,
          banner="⏩ six minutes of log, sped up", hold=3.0)

    c.beat("result", "Result", "Rebased onto the fix with a backup; CI green; the report cites the fixing commit",
           browser="ci-base-after")
    c.run("3b-40-pr-after", hold=2.0)
    c.run("3b-41-pr-checks", hold=2.0)
    c.run("3b-42-signers", hold=2.0)
    c.run("3b-43-backup", hold=2.0)
    c.run("3b-44-report", lines=slice(18, 23), hold=4.0)
