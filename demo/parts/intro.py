"""Intro: what Orka is, how the PR shepherd runs on it, and what it handles.

Production captures and dashboard clips are from Nov 11, 2026; the slides are from Nov 17.
"""

SEGMENT = {
    "part": "intro",
    "label": "Intro",
    "title": "Orka and the PR shepherd",
    "subtitle": "What Orka is, how the shepherd runs on it, and what it handles",
    "recorded": "Nov 11, 2026",
}


def play(c):
    c.card("Orka PR shepherd", "Moves PRs toward merge and reviews them, on a schedule", kicker="Intro")

    c.beat("orka", "What Orka is", "A Kubernetes-native platform that runs container and AI-agent Tasks",
           browser="slide-orka")
    c.say("Orka runs Tasks on Kubernetes: a container or an AI agent, once or on a schedule")
    c.say("Each run is its own Task, with logs and a result, in kubectl, the API and a dashboard")
    c.say("The PR shepherd is one of those Tasks, on the h100 AKS cluster:")
    c.run("01-prod-task", hold=3.0)

    c.beat("shepherd", "The PR shepherd", "One scheduled Task: a gate every 15 minutes, an agent only when needed",
           browser=["slide-shepherd@12", "orka-prod@start~report"])
    c.say("A container with Copilot CLI and the pr-shepherd skill, acting as the PR's author")
    c.say("Every 15 minutes a gate (watch.mjs) looks at the open PRs in seconds")
    c.run("02-prod-runs", hold=2.0)
    c.say("It starts the agent only when something needs it, and only for that:")
    c.run("03-prod-verdicts", hold=3.5)

    c.beat("handles", "What it handles", "Each capability is a step of the pr-shepherd skill",
           browser="slide-steps")
    c.say("1  Review comments: CodeRabbit's threads are checked, fixed or declined, then settled (step C)")
    c.say("2  Merge conflicts: rebase with a backup, validate, push with a lease (step A)")
    c.say("3  CI failures: whose bug? Fix ours, rebase onto a fix on main, report the rest (step B)")
    c.say("4  Review assistant: a codeowner-style self-review and a brief for maintainers (steps R, S)")
    c.say("Plus a 2-hourly report of what needs you: human comments, approvals, pings, stale PRs", hold=2.5)

    c.beat("demos", "How the demos run", "A copy of the Task, every 5 minutes, on sandbox PRs inside the fork",
           browser="orka-run-live@start~run")
    c.say("To show it act without touching upstream, a copy of the Task watches sandbox PRs in my fork")
    c.run("30-demo-overrides", lines=slice(0, 8), hold=3.0)
    c.say("Review mode was live for demos 1 and 4, and off for 3a and 3b, so a review doesn't mix in", hold=2.5)

    c.beat("guardrails", "What it never does", "It acts as the author, within limits, and reports everything",
           browser="slide-guardrails")
    c.say("It never merges, approves, closes, edits titles or posts /ok to test, and never pushes upstream")
    c.say("Backup before any rewrite, one fix commit of each kind per run, no fix push after an approval")
    c.say("Every commit is signed, signed off and carries Automated-by: pr-shepherd", hold=3.0)
