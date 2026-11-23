"""The demo, part by part.

The video is cut into segments, and each segment is built into its own clip, so one can be
redone without touching the others: `python3 build.py <segment>` rebuilds one clip, then
joins the clips again in SEGMENTS order. Each segment is a module here with a SEGMENT dict
and a `play(cast)` function that types narration, replays captures and starts beats.

PARTS is what the viewer sees as the outline: the intro, the four capabilities (with the
skill steps they come from) and the wrap-up. Part 3 has three segments (3a, 3b, 3c).
"""

import importlib

PARTS = [
    {"key": "intro", "label": "Intro", "title": "Orka and the PR shepherd", "step": "how it runs"},
    {"key": "comments", "label": "1", "title": "Review comments", "step": "step C"},
    {"key": "conflict", "label": "2", "title": "Merge conflict → rebase", "step": "step A"},
    {"key": "ci", "label": "3", "title": "CI failure → fix or rebase", "step": "step B"},
    {"key": "review", "label": "4", "title": "Review assistant", "step": "steps R + S"},
    {"key": "wrapup", "label": "Wrap-up", "title": "Reports and recap", "step": "steps D–G"},
]

SEGMENTS = ["intro", "comments", "conflict", "ci_ours", "ci_base", "ci_infra", "review", "wrapup"]

# The four beats every capability demo follows.
DEMO_BEATS = {
    "setup": "Setup",
    "notice": "The gate notices",
    "work": "The agent works",
    "result": "Result",
}


def load(key):
    return importlib.import_module(f"parts.{key}")


def manifest():
    """Everything the frame and the player page need to draw the outline."""
    return {
        "parts": PARTS,
        "segments": [load(k).SEGMENT | {"key": k} for k in SEGMENTS],
        "demo_beats": DEMO_BEATS,
    }
