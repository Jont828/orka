"""Demo 4: the review assistant (skill steps R and S), on sandbox PR #11. Recorded Nov 11, 2026.

The review run that settled CodeRabbit's comment (demo 1) also reviewed the PR the way a
Dynamo codeowner would, using Dynamo's own review guidance from the base branch, had a
fresh subagent confirm the fix, and posted one review brief for maintainers. In production
this half runs in shadow mode: the brief goes into the report, not onto the PR.
"""

SEGMENT = {
    "part": "review",
    "label": "4",
    "title": "Review assistant",
    "subtitle": "A codeowner-style self-review, a subagent to confirm each fix, one brief for maintainers",
    "recorded": "Nov 11, 2026",
}

RUN2 = "kubectl --context h100 -n orka-system logs -f job/dynamo-pr-shepherd-demo-1794440400-job-9f873be1-0"


def play(c):
    c.card("Review assistant", "Self-review with Dynamo's own rubric, then one brief for maintainers",
           kicker="Demo 4 · steps R + S")

    c.beat("setup", "Setup", "A PR head with new commits from the author, quiet for an hour (no wait in the demo)",
           browser=["opener-review", "pr-rebased@start~start+5"])
    c.say("Every new head of a PR gets a review once it's quiet, so a branch being pushed to waits")
    c.say("The shepherd's own commits never trigger one: it knows them by signature and trailer")

    c.beat("notice", "The gate notices", "PR #11's rebased head is new and quiet: a review is due",
           browser="log-run2-rs@start~work")
    c.run("61-follow-run-2", display=RUN2, lines=slice(0, 2), hold=3.0)

    c.beat("work", "The agent works", "Dynamo's rubric, a codeowner's checks, every fix confirmed by a fresh subagent",
           browser="log-run2-rs@work~end")
    c.replay("61-follow-run-2", lines=[13, 15, 25, slice(27, 34), 41, 45], speed=14, max_idle=2.4,
             banner="⏩ the review run's log, sped up; the CodeRabbit lines are in demo 1", hold=3.0)

    c.beat("result", "Result", "One brief: what the PR does, its risk, where to look, the decisions left",
           browser=["pr-reviewed@brief~diff", "orka-result-2@start~schedule"])
    c.run("74-brief", hold=5.0)
    c.run("75-result-2", lines=slice(24, 33), hold=3.5)

    c.beat("quiet", "Afterwards", "The shepherd's own fix doesn't start another review",
           browser="orka-result-2@schedule~end")
    c.run("71-verdicts-demo", hold=3.0)

    c.beat("production", "In production", "Shadow mode: the brief goes into the report until the author turns it live",
           browser="orka-prod@report~end")
    c.say("Upstream, steps R and S run in shadow mode: briefs and self-review fixes stay in the report")
    c.say("CodeRabbit fixes (step C) already go out live", hold=3.0)
