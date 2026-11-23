#!/usr/bin/env python3
"""Build the synced player page from player/template.html and the joined demo: out/demo.cast,
out/chapters.json and out/browser.mp4 (make_video.py --merge, or build.py).

  out/player/    open index.html locally (player script vendored, works offline)
  out/artifact/  the same page for publishing (player script from jsDelivr, body-only HTML)

Both get browser.mp4 (re-encoded small enough to publish) and poster.jpg (the first slide).
The page's outline (parts, then segments, then beats) comes from parts/ and chapters.json.
Usage: python3 make_player.py
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
PLAYER = HERE / "player"
POSTER = HERE / "browser" / "clips" / "slide-orka.png"

sys.path.insert(0, str(HERE))
from parts import manifest  # noqa: E402
CDN_JS = "https://cdn.jsdelivr.net/npm/asciinema-player@3.10.0/dist/bundle/asciinema-player.min.js"


def js_literal(value):
    """JSON for an inline <script>, with '</' broken so the HTML parser can't end the script."""
    return json.dumps(value, ensure_ascii=False).replace("</", "<\\/")


def outline():
    """Parts, their segments (with start and end on the joined timeline) and every beat."""
    chapters = [{k: c[k] for k in ("segment", "part", "key", "label", "subtitle", "start", "end")}
                for c in json.loads((OUT / "chapters.json").read_text())["chapters"]]
    segments = []
    for s in manifest()["segments"]:
        beats = [c for c in chapters if c["segment"] == s["key"]]
        segments.append({k: s[k] for k in ("key", "part", "label", "title", "subtitle", "recorded")}
                        | {"start": beats[0]["start"], "end": beats[-1]["end"]})
    return {"parts": manifest()["parts"], "segments": segments, "chapters": chapters}


def build(dest, js_src, wrap):
    dest.mkdir(parents=True, exist_ok=True)
    page = (PLAYER / "template.html").read_text()
    page = page.replace("{{PLAYER_CSS}}", (PLAYER / "vendor" / "asciinema-player.css").read_text())
    page = page.replace("{{PLAYER_JS_SRC}}", js_src)
    page = page.replace("{{VIDEO_SRC}}", "browser.mp4").replace("{{POSTER_SRC}}", "poster.jpg")
    page = page.replace("{{OUTLINE_JSON}}", js_literal(outline()))
    page = page.replace("{{CAST_JSON}}", js_literal((OUT / "demo.cast").read_text()))
    if wrap:
        page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                '<style>html{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
                + page.replace("<div class=\"wrap\">", "</head>\n<body>\n<div class=\"wrap\">", 1) + "\n</body>\n</html>\n")
    (dest / "index.html").write_text(page)
    return dest / "index.html"


def web_video(web, limit_mb=14.5):
    """The browser track for the page: 960 px wide (the page shows it at about 900), small enough
    to publish as an Artifact file (at most 15 MB). Lower the quality until it fits."""
    for crf in (28, 30, 32, 34, 36):
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", OUT / "browser.mp4",
                        "-vf", "scale=960:-2:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", str(crf),
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", web], check=True)
        if web.stat().st_size / 1e6 <= limit_mb:
            return crf
    raise SystemExit(f"{web.name} is still over {limit_mb} MB at crf {crf}")


def main():
    web = OUT / "browser-web.mp4"
    crf = web_video(web)
    poster = OUT / "poster.jpg"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", POSTER, "-q:v", "3", poster], check=True)
    local = build(OUT / "player", "vendor/asciinema-player.min.js", wrap=True)
    shutil.copytree(PLAYER / "vendor", OUT / "player" / "vendor", dirs_exist_ok=True)
    artifact = build(OUT / "artifact", CDN_JS, wrap=False)
    for d in (OUT / "player", OUT / "artifact"):
        shutil.copy(web, d / "browser.mp4")
        shutil.copy(poster, d / "poster.jpg")
    for p in (local, artifact, web):
        print(f"{p.relative_to(HERE)}  {p.stat().st_size / 1e6:.2f} MB" + (f"  (crf {crf})" if p == web else ""))


if __name__ == "__main__":
    main()
