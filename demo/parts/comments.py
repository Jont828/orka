"""Demo 1: review comments (skill step C), on sandbox PR #11. Recorded Nov 11, 2026.

The second demo run (a review run) answered CodeRabbit's comment: it checked the claim
against the code, reproduced it, fixed it in one signed commit, replied and resolved the
thread. The same run also did steps R and S; demo 4 shows that half of its log.
"""

SEGMENT = {
    "part": "comments",
    "label": "1",
    "title": "Review comments",
    "subtitle": "CodeRabbit flags a bug: the shepherd checks it, fixes it and settles the thread",
    "recorded": "Nov 11, 2026",
}

RUN2 = "kubectl --context h100 -n orka-system logs -f job/dynamo-pr-shepherd-demo-1794440400-job-9f873be1-0"


def play(c):
    c.card("Review comments", "CodeRabbit flags a bug: checked, fixed, answered, resolved", kicker="Demo 1 · step C")

    c.beat("setup", "Setup", "PR #11 in the fork: CodeRabbit says M and G use powers of 1024",
           browser=["opener-comments", "pr-before@start~start+9", "pr-before@checks-7.8~checks"])
    c.say("PR #11: a Kubernetes quantity parser, a sandbox PR that lives only in my fork")
    c.run("10-pr-view", lines=slice(0, 16), hold=2.0)
    c.say("CodeRabbit reviewed it and found a real bug, and nobody has answered it yet")
    c.run("12-coderabbit", hold=3.0)

    c.beat("notice", "The gate notices", "The head is new and quiet, so a review run starts",
           browser="log-run2-c@start~work")
    c.say("CodeRabbit comments are handled in review runs and in the 2-hourly regular runs")
    c.run("61-follow-run-2", display=RUN2, lines=slice(0, 2), hold=3.0)

    c.beat("work", "The agent works", "It checks the claim on evidence, reproduces it, fixes it and replies",
           browser="log-run2-c@work~end")
    c.replay("61-follow-run-2", lines=[slice(2, 4), 5, 7, 9, 11, 13, 19, 21, 23, 35, 37, 39],
             speed=14, max_idle=2.4, banner="⏩ the run's log, sped up; the self-review lines are in demo 4", hold=3.0)

    c.beat("result", "Result", "One signed fix commit; CodeRabbit verified it and resolved its own thread",
           browser=["pr-reviewed@start~commit", "pr-reviewed@diff~end"])
    c.run("73-threads", hold=3.0)
    c.run("76-fix-commit", hold=3.0)

    c.beat("production", "In production", "The same step, live upstream: ai-dynamo/dynamo#18618",
           browser="upstream-prod")
    c.say("Step C is live in production: on upstream #18618 it fixed a CodeRabbit item in 751587a")
    c.say("CodeRabbit accepted the fix and resolved its thread; nobody had to step in", hold=3.0)
