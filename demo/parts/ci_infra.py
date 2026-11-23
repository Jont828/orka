"""Demo 3c: a failure that isn't the PR's and has no fix yet (skill step B, cause 3), on sandbox
PR #11. Recorded Nov 11, 2026.

A Dynamo bot workflow fails on every PR in the fork because its token is empty there. The
same run as demo 2 read the failing job's log, classified it as infrastructure with High
confidence and reported it, without touching the code. The demo's prompt tells the agent
that these fork-only bot jobs don't test code, so this shows the reporting path, not
unaided detective work.
"""

SEGMENT = {
    "part": "ci",
    "label": "3c",
    "title": "Not our bug, no fix yet → reported",
    "subtitle": "A fork-only bot job fails: diagnosed as infrastructure and reported, not patched",
    "recorded": "Nov 11, 2026",
}

RUN1 = "kubectl --context h100 -n orka-system logs -f job/dynamo-pr-shepherd-demo-1794440100-job-a61bed70-0"


def play(c):
    c.card("3c · Not our bug, no fix yet", "Infrastructure, not code: reported, not patched",
           kicker="Demo 3 · step B")

    c.beat("setup", "Setup", "PR #11's failed check is a Dynamo bot job that has no token in a fork",
           browser=["opener-ci_infra", "pr-before@checks~end"])
    c.run("11-pr-checks", hold=3.0)
    c.say("The sandbox's own test check passes; the failing one is a bot workflow")

    c.beat("notice", "The gate notices", "The same run as demo 2 was also given the failed check",
           browser="log-run1-b@start~work")
    c.run("41-follow-run-1", display=RUN1, lines=slice(0, 2), hold=3.0)

    c.beat("work", "The agent works", "It reads the failing job's log and compares it with what the PR changes",
           browser="log-run1-b@work~end")
    c.replay("41-follow-run-1", lines=[9, 21], speed=12, max_idle=2.6, hold=2.0)
    c.say("Its instructions for the fork say these bot jobs don't test code; it still checks the log")

    c.beat("result", "Result", "Cause 3, High confidence: reported with the evidence, no commit for it",
           browser="pr-rebased@checks~end")
    c.run("50-result-1", lines=slice(22, 28), hold=3.5)
    c.say("Upstream, a High-confidence flake is reported as needing a maintainer rerun", hold=3.0)
