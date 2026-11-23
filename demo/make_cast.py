#!/usr/bin/env python3
"""Build the demo's terminal recordings (asciicast v2) from real command captures, one per segment.

The demo is cut into segments (parts/__init__.py), each built into its own clip so one can be
redone without touching the others. In a segment, each `run(...)` step types the command that was
really run, then replays the output that command really produced (captures/<id>.cast, recorded by
bin/cap), with long idle gaps capped and, for long logs, a speed-up. Beats become asciicast
markers, and out/segments/<segment>/chapters.json records each beat's cast times and the browser
clip shown beside it, which make_video.py uses to keep the browser in step.

Usage: python3 make_cast.py [segment ...]      (default: every segment)
"""

import json
import math
import random
import re
import sys
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
CAPTURES = HERE / "captures"
OUT = HERE / "out"
SEGMENTS_OUT = OUT / "segments"
CLIPS = HERE / "browser" / "clips"
COLS, ROWS = 100, 30
FPS = 30

ESC = "\x1b"
RESET = f"{ESC}[0m"
DIM = f"{ESC}[2m"
BOLD = f"{ESC}[1m"
ITALIC = f"{ESC}[3m"
FG = lambda n: f"{ESC}[38;5;{n}m"  # noqa: E731
BG = lambda n: f"{ESC}[48;5;{n}m"  # noqa: E731
PROMPT = f"{FG(39)}{BOLD}h100{RESET} {FG(245)}~/orka-demo{RESET} {FG(214)}❯{RESET} "
PROMPT_WIDTH = len("h100 ~/orka-demo ❯ ")
CLEAR = f"{ESC}[H{ESC}[2J{ESC}[3J"

OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
DSR = re.compile(r"\x1b\[6n")
# gh prints this when no terminal answers its color query, and never erases it.
SPINNER = re.compile(r"(?:\x1b\[[0-9;]*m)*Working\.\.\.(?:\x1b\[[0-9;]*m)*\r?\n?")


def clean(data):
    """Drop terminal queries and gh's stuck spinner; NBSP (gh's inline-code padding) -> space."""
    return SPINNER.sub("", DSR.sub("", OSC.sub("", data))).replace("\xa0", " ")


class Cast:
    def __init__(self, title):
        self.t = 0.0
        self.events = []
        self.chapters = []
        self.title = title
        self.rng = random.Random(828)

    # ---- low level ----
    def out(self, data, dt=0.0):
        self.t += dt
        self.events.append([round(self.t, 4), "o", data])

    def wait(self, seconds):
        self.t += seconds

    def marker(self, label):
        self.events.append([round(self.t, 4), "m", label])

    def clear(self):
        self.out(CLEAR, 0.0)

    # ---- structure ----
    def close_beat(self):
        """End the current beat, idling at the prompt until its browser clips have played."""
        if not self.chapters:
            return
        ch = self.chapters[-1]
        need = browser_seconds(ch["browser"]) + 1.0
        if self.t - ch["start"] < need:
            self.wait(need - (self.t - ch["start"]))
        ch["end"] = round(self.t, 3)

    def card(self, title, subtitle="", kicker="", hold=2.8, keep=False):
        """A title card in the middle of a cleared screen."""
        self.clear()
        lines = [(kicker, FG(214)), (title, BOLD), (subtitle, FG(250))]
        lines = [(text, style) for text, style in lines if text]
        width = min(COLS - 4, max(len(text) for text, _ in lines) + 6)
        pad = " " * ((COLS - width) // 2)
        top = 9
        self.out(f"{ESC}[{top};1H{pad}{FG(39)}╭{'─' * (width - 2)}╮{RESET}")
        for i, (text, style) in enumerate(lines, 1):
            self.out(f"{ESC}[{top + i};1H{pad}{FG(39)}│{RESET}{style}{text.center(width - 2)}{RESET}{FG(39)}│{RESET}", 0.05)
        self.out(f"{ESC}[{top + len(lines) + 1};1H{pad}{FG(39)}╰{'─' * (width - 2)}╯{RESET}", 0.05)
        self.wait(hold)
        if keep:
            self.out(f"{ESC}[{top + len(lines) + 3};1H", 0)
        else:
            self.clear()

    def beat(self, key, label, subtitle="", browser=None, divider=True):
        """Start a beat: a marker, a dim divider in the terminal, and the browser clip to show.
        The first beat starts at 0, so it also covers the segment's title card: beats tile the
        whole segment, and the browser starts its first clip while the card is up."""
        self.close_beat()
        first = not self.chapters
        self.chapters.append({"key": key, "label": label, "subtitle": subtitle,
                              "start": 0.0 if first else round(self.t, 3), "browser": browser})
        self.marker(label)
        after_clear = len(self.events) >= 2 and self.events[-2][2].endswith(CLEAR)
        if divider and not first and not after_clear:
            rule = "─" * max(4, COLS - len(label) - 6)
            self.out(f"\r\n\r\n{FG(240)}── {RESET}{FG(250)}{label}{RESET}{FG(240)} {rule}{RESET}", 0.3)

    # ---- typing and replay ----
    def prompt(self, gap=0.5):
        fresh = self.events and self.events[-1][2].endswith(CLEAR)
        self.out(PROMPT if fresh or not self.events else "\r\n" + PROMPT, gap)

    def type(self, text, fast=False):
        for ch in text:
            base = (0.012, 0.03) if fast else (0.028, 0.075)
            delay = self.rng.uniform(*base)
            if ch == " " and self.rng.random() < 0.12:
                delay += self.rng.uniform(0.08, 0.2)
            self.out(ch, delay)

    def say(self, text, hold=1.4):
        """A narration comment, typed at the prompt like a note to the audience. A long one wraps
        at a space and continues under its first word, instead of the terminal breaking a word."""
        self.prompt(0.4)
        self.out(f"{FG(244)}{ITALIC}", 0)
        rows = textwrap.wrap(f"# {text}", width=COLS - PROMPT_WIDTH - 1, subsequent_indent="  ")
        for i, row in enumerate(rows):
            if i:
                self.out("\r\n" + " " * PROMPT_WIDTH, 0)
            self.type(row, fast=True)
        self.out(RESET, 0)
        self.wait(hold)

    def run(self, cid, display=None, speed=1.0, max_idle=1.2, max_total=None, hold=2.0, banner=None,
            lines=None, suffix=None):
        """Type the command from captures/<cid>.cmd (or `display`), then replay its output.

        `lines` keeps only some output lines: a slice, or a list of slices and line numbers."""
        cmd = display or (CAPTURES / f"{cid}.cmd").read_text().strip()
        self.prompt(0.6)
        self.type(cmd, fast=len(cmd) > 70)
        self.wait(0.35)
        self.out("\r\n", 0)
        self.replay(cid, speed, max_idle, max_total, hold, banner, lines, suffix)

    def replay(self, cid, speed=1.0, max_idle=1.2, max_total=None, hold=2.0, banner=None, lines=None,
               suffix=None):
        """Replay more of a capture's output without typing a command (a log that continues)."""
        # After a beat divider or a narration line, the cursor is mid-line: start a new one.
        last = next((e[2] for e in reversed(self.events) if e[1] == "o"), "\n")
        if not (last.endswith("\n") or last.endswith(CLEAR)):
            self.out("\r\n", 0.1)
        if banner:
            self.out(f"{BG(236)}{FG(214)} {banner} {RESET}\r\n", 0.2)
        events = []
        with open(CAPTURES / f"{cid}.cast") as f:
            next(f)
            for line in f:
                t, kind, data = json.loads(line)
                if kind == "o":
                    events.append((t, clean(data)))
        if lines is not None:
            events = keep_lines(events, lines)
        last = None
        start = self.t
        for t, data in events:
            dt = 0.0 if last is None else max(0.0, t - last) / speed
            last = t
            dt = min(dt, max_idle)
            if max_total and self.t - start > max_total:
                dt = min(dt, 0.01)
            if data:
                self.out(data, dt if self.t > start else 0.25)
        if suffix:
            self.out(suffix, 1.0)
        self.wait(hold)

    def finish(self):
        self.wait(1.5)
        self.close_beat()
        # End on a frame boundary, so segments join without drifting.
        self.t = math.ceil(round(self.t * FPS, 3)) / FPS
        self.chapters[-1]["end"] = round(self.t, 4)
        self.out(" ", 0)


def clip_names(browser):
    if not browser:
        return []
    return [browser] if isinstance(browser, str) else list(browser)


def _bound(token, marks):
    """A clip bound: a mark label, seconds, or a mark plus or minus seconds ("job+2.5")."""
    m = re.fullmatch(r"([A-Za-z_][\w-]*)?([+-]\d+(?:\.\d+)?)?|(\d+(?:\.\d+)?)", token)
    if not m:
        raise ValueError(f"bad clip bound {token!r}")
    if m.group(3):
        return float(m.group(3))
    return marks[m.group(1) or "start"] + float(m.group(2) or 0)


def clip_window(name):
    """(start, end) seconds of a recorded browser clip's content, or None for a still.
    "clip@a~b" plays only between bounds a and b (mark labels, seconds, or mark±seconds);
    "clip@a-b" with plain mark labels also works."""
    base, _, span = name.partition("@")
    meta = CLIPS / f"{base}.json"
    if not meta.exists():
        return None
    m = json.loads(meta.read_text())
    marks = {x["label"]: x["t"] for x in m["marks"]}
    marks.setdefault("start", m["start"])
    marks.setdefault("end", m["duration"])
    if not span:
        return marks["start"], marks["end"]
    a, sep, b = span.partition("~")
    if not sep:
        a, _, b = span.partition("-")
    return _bound(a or "start", marks), _bound(b or "end", marks)


# Slides (browser/clips/<name>.png) stay up this long, so they can be read.
STILL_SECONDS = {"title": 12.0, "outro": 14.0}


def still_seconds(name):
    base, _, span = name.partition("@")
    if span:
        return float(span)
    return STILL_SECONDS.get(base, 8.0)


def browser_seconds(browser):
    total = 0.0
    for name in clip_names(browser):
        w = clip_window(name)
        total += (w[1] - w[0]) if w else still_seconds(name)
    return total


def keep_lines(events, spec):
    """Keep only some output lines, with their timing. spec: a slice, or a list of slices and
    line numbers, kept in the order given."""
    joined = []
    for t, data in events:
        for piece in re.split(r"(?<=\n)", data):
            if piece:
                joined.append((t, piece))
    lines, cur, cur_t = [], "", None
    for t, piece in joined:
        cur += piece
        cur_t = t if cur_t is None else cur_t
        if piece.endswith("\n"):
            lines.append((cur_t, cur))
            cur, cur_t = "", None
    if cur:
        lines.append((cur_t, cur))
    if isinstance(spec, slice):
        return lines[spec]
    out = []
    for part in spec:
        out.extend(lines[part] if isinstance(part, slice) else [lines[part]])
    return out


def write_cast(path, title, duration, events):
    header = {
        "version": 2,
        "width": COLS,
        "height": ROWS,
        "timestamp": 1794440000,
        "title": title,
        "env": {"TERM": "xterm-256color", "SHELL": "/bin/zsh"},
    }
    with open(path, "w") as f:
        f.write(json.dumps(header) + "\n")
        for ev in sorted(events, key=lambda e: e[0]):
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")


def build(key):
    sys.path.insert(0, str(HERE))
    from parts import load

    seg = load(key)
    cast = Cast(seg.SEGMENT["title"])
    seg.play(cast)
    cast.finish()
    out = SEGMENTS_OUT / key
    out.mkdir(parents=True, exist_ok=True)
    write_cast(out / "demo.cast", seg.SEGMENT["title"], cast.t, cast.events)
    meta = dict(seg.SEGMENT, key=key, duration=round(cast.t, 4), chapters=cast.chapters)
    (out / "chapters.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print(f"{key:9s} {cast.t:6.1f}s  {len(cast.events):5d} events  {len(cast.chapters)} beats")
    return meta


def merge(keys, title):
    """Join the segments' casts and beats into out/demo.cast and out/chapters.json."""
    events, chapters, offset = [], [], 0.0
    for key in keys:
        meta = json.loads((SEGMENTS_OUT / key / "chapters.json").read_text())
        with open(SEGMENTS_OUT / key / "demo.cast") as f:
            next(f)
            for line in f:
                t, kind, data = json.loads(line)
                events.append([round(t + offset, 4), kind, data])
        for ch in meta["chapters"]:
            chapters.append(dict(ch, segment=key, part=meta["part"], start=round(ch["start"] + offset, 4),
                                 end=round(ch["end"] + offset, 4)))
        offset += meta["duration"]
    write_cast(OUT / "demo.cast", title, offset, events)
    (OUT / "chapters.json").write_text(json.dumps({"duration": round(offset, 4), "chapters": chapters}, indent=2,
                                                  ensure_ascii=False))
    return offset


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    from parts import SEGMENTS

    for key in sys.argv[1:] or SEGMENTS:
        build(key)
