#!/usr/bin/env python3
"""Assemble the demo videos: one clip per segment, then the joined demo.

For each segment (out/segments/<key>/, from make_cast.py):
  terminal.mp4  the segment's cast rendered by agg (github-dark, 16 px), on its own timeline
  browser.mp4   one stretch per beat, cut from browser/clips/*.webm (or a slide), each exactly
                as long as its beat, so it plays in step with the cast
  segment.mp4   both side by side at 1920x1080, in a frame showing the outline and the beat

--merge joins the segment clips into out/demo.mp4, their browser tracks into out/browser.mp4,
and their casts into out/demo.cast with out/chapters.json (for the player page). Every stretch
is a whole number of frames, so the joins don't drift.

Usage: python3 make_video.py [segment ...] [--reuse-browser | --reuse-tracks]
       python3 make_video.py --merge
"""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
SEGMENTS_OUT = OUT / "segments"
CLIPS = HERE / "browser" / "clips"
FPS = 30

sys.path.insert(0, str(HERE))
from make_cast import clip_names, clip_window, merge as merge_casts, still_seconds  # noqa: E402
from parts import SEGMENTS, manifest  # noqa: E402

ENC = ["-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]


def sh(*args):
    subprocess.run([str(a) for a in args], check=True)


def ffprobe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return float(out)


def frames(t):
    return round(t * FPS)


def beat_frames(meta):
    """Each beat's length in frames. Beats tile the segment from 0 (the first one also covers
    the title card), so they add up to the segment's exact length."""
    chapters = meta["chapters"]
    edges = [0] + [frames(c["start"]) for c in chapters[1:]] + [frames(meta["duration"])]
    return [b - a for a, b in zip(edges, edges[1:])]


def terminal_video(seg, tmp):
    gif = tmp / "terminal.gif"
    sh("agg", "--font-size", "16", "--theme", "github-dark", "--idle-time-limit", "120",
       "--fps-cap", "30", "--last-frame-duration", "0.5", seg / "demo.cast", gif)
    out = seg / "terminal.mp4"
    sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", gif,
       "-vf", f"fps={FPS},pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=0x0d1117", *ENC, "-crf", "20", out)
    return out


def browser_beat(chapter, n, path):
    """Exactly n frames of browser for one beat: its clips (or slides) in order, slowed by up to
    1.4x when short, then held on the last frame."""
    duration = n / FPS
    names = clip_names(chapter["browser"])
    inputs, parts, content = [], [], 0.0
    for i, name in enumerate(names):
        w = clip_window(name)
        base = name.split("@")[0]
        if w is None:
            secs = still_seconds(name) if len(names) > 1 else duration
            inputs += ["-loop", "1", "-t", f"{secs:.3f}", "-i", CLIPS / f"{base}.png"]
            parts.append(f"[{i}:v]fps={FPS},scale=1280:720,setsar=1,setpts=PTS-STARTPTS[p{i}]")
            content += secs
        else:
            a, b = w
            inputs += ["-i", CLIPS / f"{base}.webm"]
            parts.append(f"[{i}:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS,fps={FPS},scale=1280:720,setsar=1[p{i}]")
            content += b - a
    stretch = min(1.4, duration / content) if 0 < content < duration else 1.0
    chain = "".join(f"[p{i}]" for i in range(len(names)))
    graph = ";".join(parts) + f";{chain}concat=n={len(names)}:v=1:a=0[c];" \
        f"[c]setpts={stretch:.4f}*PTS,tpad=stop_mode=clone:stop_duration={duration + 1:.3f},fps={FPS}[v]"
    sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", graph,
       "-map", "[v]", "-frames:v", n, *ENC, "-crf", "23", "-r", FPS, path)


def browser_video(seg, meta, tmp):
    parts = []
    for i, (ch, n) in enumerate(zip(meta["chapters"], beat_frames(meta))):
        part = tmp / f"beat{i:02d}.mp4"
        browser_beat(ch, n, part)
        parts.append(part)
    lst = tmp / "beats.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    out = seg / "browser.mp4"
    sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst,
       "-c", "copy", "-movflags", "+faststart", out)
    return out


def side_by_side(seg, meta, terminal, browser, tmp):
    """1920x1080: a per-beat frame (browser/chrome.mjs) under the terminal and browser."""
    fdir = tmp / "frames"
    fdir.mkdir()
    spec = tmp / "segment.json"
    spec.write_text(json.dumps({"manifest": manifest(), "segment": meta}))
    sh("node", HERE / "browser" / "chrome.mjs", spec, fdir)
    bgs = []
    for i, n in enumerate(beat_frames(meta)):
        bg = tmp / f"bg{i:02d}.mp4"
        sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", FPS,
           "-i", fdir / f"chrome-{i:02d}.png", "-frames:v", n,
           "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", FPS, bg)
        bgs.append(bg)
    lst = tmp / "bg.txt"
    lst.write_text("".join(f"file '{b}'\n" for b in bgs))
    bg = tmp / "bg.mp4"
    sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", bg)
    graph = ";".join([
        f"[0:v]fps={FPS},setsar=1[bg]",
        "[1:v]scale=850:600:flags=lanczos,setsar=1[t]",
        "[2:v]scale=998:562:flags=lanczos,setsar=1[b]",
        "[bg][t]overlay=24:104:eof_action=repeat[x]",
        "[x][b]overlay=898:123:eof_action=repeat[v]",
    ])
    out = seg / "segment.mp4"
    sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", bg, "-i", terminal, "-i", browser,
       "-filter_complex", graph, "-map", "[v]", "-frames:v", frames(meta["duration"]),
       *ENC, "-crf", "24", "-r", FPS, out)
    return out


def build(key, reuse_browser=False, reuse_tracks=False):
    seg = SEGMENTS_OUT / key
    meta = json.loads((seg / "chapters.json").read_text())
    tmp = Path(tempfile.mkdtemp(prefix=f"orka-demo-{key}-"))
    try:
        terminal = seg / "terminal.mp4" if reuse_tracks else terminal_video(seg, tmp)
        browser = seg / "browser.mp4" if (reuse_browser or reuse_tracks) else browser_video(seg, meta, tmp)
        out = side_by_side(seg, meta, terminal, browser, tmp)
        lengths = {"browser": ffprobe_duration(browser), "segment": ffprobe_duration(out)}
        print(f"{key:9s} cast {meta['duration']:6.1f}s  terminal {ffprobe_duration(terminal):6.1f}s  "
              f"browser {lengths['browser']:6.1f}s  segment {lengths['segment']:6.1f}s", flush=True)
        for name, seconds in lengths.items():
            if abs(seconds - meta["duration"]) > 1.5 / FPS:
                raise SystemExit(f"{key}: {name} track is {seconds:.3f}s, but the cast is {meta['duration']:.3f}s")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def merge():
    tmp = Path(tempfile.mkdtemp(prefix="orka-demo-merge-"))
    try:
        for name, target in (("segment.mp4", OUT / "demo.mp4"), ("browser.mp4", OUT / "browser.mp4")):
            lst = tmp / f"{name}.txt"
            lst.write_text("".join(f"file '{SEGMENTS_OUT / k / name}'\n" for k in SEGMENTS))
            sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst,
               "-c", "copy", "-movflags", "+faststart", target)
        total = merge_casts(SEGMENTS, "Orka PR shepherd: what it does, demo by demo")
        print(f"merged {len(SEGMENTS)} segments: cast {total:.1f}s  demo.mp4 {ffprobe_duration(OUT / 'demo.mp4'):.1f}s  "
              f"browser.mp4 {ffprobe_duration(OUT / 'browser.mp4'):.1f}s")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--merge" in sys.argv:
        merge()
        return
    for key in args or SEGMENTS:
        build(key, reuse_browser="--reuse-browser" in sys.argv, reuse_tracks="--reuse-tracks" in sys.argv)


if __name__ == "__main__":
    main()
