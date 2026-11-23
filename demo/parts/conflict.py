"""Demo 2: a merge conflict (skill step A), on sandbox PR #11. Recorded Nov 11, 2026.

A change lands on the PR's base branch and edits the same README line, so the PR becomes
CONFLICTING. The next slot's gate hands the conflict to the agent, which backs up the old
head, rebases, resolves the mechanical conflict, validates, and force-pushes with a lease.
The same run also diagnosed a failed bot check; 3c shows that half.
"""

SEGMENT = {
    "part": "conflict",
    "label": "2",
    "title": "Merge conflict → rebase",
    "subtitle": "The base moves under the PR: backup, rebase, resolve, validate, push with a lease",
    "recorded": "Nov 11, 2026",
}

RUN1 = "kubectl --context h100 -n orka-system logs -f job/dynamo-pr-shepherd-demo-1794440100-job-a61bed70-0"
WATCH = "kubectl --context h100 -n orka-system get tasks -l orka.ai/parent-task=dynamo-pr-shepherd-demo -w"


def play(c):
    c.card("Merge conflict → rebase", "The base branch moves under the PR; the shepherd rebases it",
           kicker="Demo 2 · step A")

    c.beat("setup", "Setup", "A change lands on orka-demo/base and edits the same README line as PR #11",
           browser=["opener-conflict", "pr-conflict"])
    c.say("Like upstream main moving: a commit lands on the PR's base and touches the same README line")
    c.run("20-base-commit", hold=2.5)
    c.run("21-push-base", max_idle=0.4, hold=1.5)
    c.run("22-mergeable", hold=2.5)

    c.beat("notice", "The gate notices", "Within one slot (15 minutes, 5 in the demo): a new merge conflict",
           browser="log-run1-a@start~work")
    c.run("23-watch-check", lines=slice(0, 2), hold=3.0)
    c.say("It also found a failed bot check on the PR; 3c shows what happened to that")
    c.run("40-watch-runs-1", display=WATCH, lines=slice(0, 5), max_idle=1.5, suffix="^C", hold=1.0)

    c.beat("work", "The agent works", "Backup, rebase, resolve, validate, then push with a lease",
           browser="log-run1-a@work~end")
    c.run("41-follow-run-1", display=RUN1, lines=[slice(0, 4), 6, 7, 11, 13, 15, 19, 21], speed=12, max_idle=2.6,
          banner="⏩ six minutes of log, sped up", hold=3.0)

    c.beat("result", "Result", "Conflict gone: both README lines kept, commits re-signed, old head backed up",
           browser="pr-rebased@start~checks")
    c.run("51-pr-after", hold=2.0)
    c.say("Rebased commits are re-signed by the cluster's key; the author's messages and dates stay")
    c.run("52-signers", hold=2.5)
    c.run("53-backup", hold=2.5)
