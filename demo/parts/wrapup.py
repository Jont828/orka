"""Wrap-up: the 2-hourly report (skill steps D-G, which only notify) and a recap of the demos.

The report is production's real 18:00 regular run on Nov 17, 2026, for Jont828's open PRs in
ai-dynamo/dynamo. The terminal skips the item that quotes individual reviewers.
"""

SEGMENT = {
    "part": "wrapup",
    "label": "Wrap-up",
    "title": "Reports and recap",
    "subtitle": "The 2-hourly report of what needs you, and what the demos showed",
    "recorded": "Nov 17, 2026",
}


def play(c):
    c.card("Wrap-up", "The 2-hourly report, and what the demos showed", kicker="Wrap-up · steps D–G")

    c.beat("report", "The 2-hourly report", "Production, Nov 17 at 18:00: four upstream PRs, all green, all waiting on review",
           browser="prod-report")
    c.say("Every 2 hours a regular run goes through every open PR, steps A to G, and writes a report")
    c.say("Production at 18:00 today (the item that quotes reviewers is skipped here):")
    c.run("w-10-prod-report", lines=[0, 1, 2, slice(16, 24)], hold=3.0)
    c.say("Steps D-G only notify: human comments, PRs ready to merge, codeowner pings, stale PRs")
    c.replay("w-10-prod-report", lines=[24, 25, slice(26, 28), slice(30, 36)], hold=3.5)

    c.beat("recap", "Recap", "Three sandbox PRs; after each setup, nobody touched them", browser="outro-summary@24")
    c.say("Sandbox PRs: Jont828/dynamo#11, #12 and #13, never submitted upstream")
    c.say("Every run's report is its Orka Task's result; production is task/dynamo-pr-shepherd")
    c.say("Production keeps its */15 schedule, with the review assistant in shadow mode", hold=4.0)
