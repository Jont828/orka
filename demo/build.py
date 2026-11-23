#!/usr/bin/env python3
"""Build the demo: one clip per segment, then the joined video and the player page.

  python3 build.py                    every segment's clip, then join them and build the page
  python3 build.py ci_base review     redo only these clips, then join again and rebuild the page
  python3 build.py --join             only join the existing clips and rebuild the page
  python3 build.py ... --frame-only   keep the segments' terminal and browser tracks; redraw
                                      only the frame around them (titles, outline, beat labels)

Segments (parts/__init__.py): intro, comments, conflict, ci_ours, ci_base, ci_infra, review,
wrapup. Each clip is out/segments/<segment>/segment.mp4, with its cast and chapters beside it.
The joined outputs are out/demo.mp4, out/browser.mp4, out/demo.cast, out/chapters.json,
out/player/ and out/artifact/.
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import make_cast  # noqa: E402
import make_player  # noqa: E402
import make_video  # noqa: E402
from parts import SEGMENTS  # noqa: E402


def main():
    keys = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    unknown = sorted(set(keys) - set(SEGMENTS)) + sorted(flags - {"--join", "--frame-only"})
    if unknown:
        raise SystemExit(f"unknown: {', '.join(unknown)}\nsegments: {', '.join(SEGMENTS)}\n{__doc__}")
    if "--join" not in flags:
        for key in keys or SEGMENTS:
            if "--frame-only" not in flags:
                make_cast.build(key)
            make_video.build(key, reuse_tracks="--frame-only" in flags)
    missing = [k for k in SEGMENTS if not (make_video.SEGMENTS_OUT / k / "segment.mp4").exists()]
    if missing:
        raise SystemExit(f"no clip yet for: {', '.join(missing)} (run python3 build.py {' '.join(missing)})")
    make_video.merge()
    make_player.main()


if __name__ == "__main__":
    main()
