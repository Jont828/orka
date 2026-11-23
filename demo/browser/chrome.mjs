// chrome.mjs <segment.json> <out-dir>: render the side-by-side video's frame once per beat of a
// segment, as 1920x1080 PNGs: header, panel frames and labels, the current beat, the outline
// of parts (with the skill step each demo shows) and the beats of the current segment.
// make_video.py overlays the terminal and browser videos on top.
//
// segment.json: {manifest: {parts, segments, demo_beats}, segment: {key, part, label, title,
// recorded, chapters: [{key, label, subtitle}]}}
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';

const [src, outDir] = process.argv.slice(2);
const {manifest, segment} = JSON.parse(readFileSync(src, 'utf8'));
const L = {tx: 24, ty: 104, tw: 850, th: 600, bx: 898, by: 123, bw: 998, bh: 562};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

function page(active) {
  const ch = segment.chapters[active];
  const parts = manifest.parts.map((p) => {
    const on = p.key === segment.part;
    const subs = manifest.segments.filter((s) => s.part === p.key && s.label !== p.label);
    const chips = on && subs.length > 1
      ? `<div class="chips">${subs.map((s) => `<span class="${s.key === segment.key ? 'on' : ''}">${esc(s.label)}</span>`).join('')}</div>`
      : '';
    return `<div class="part ${on ? 'on' : ''}"><div class="pl">${esc(p.label)}</div><div class="pt">${esc(p.title)}</div>
      <div class="ps">${esc(p.step)}</div>${chips}</div>`;
  }).join('');
  const beats = segment.chapters.map((c, i) => `<span class="b ${i === active ? 'on' : i < active ? 'done' : ''}">${esc(c.label)}</span>`)
    .join('<span class="sep">›</span>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: 1920px; height: 1080px; background: #010409; color: #f0f6fc; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
    .h1 { position: absolute; left: 26px; top: 28px; font-size: 34px; font-weight: 700; letter-spacing: -0.3px; }
    .tag { position: absolute; right: 26px; top: 38px; font-size: 20px; color: #8b949e; }
    .tag b { color: #f0f6fc; font-weight: 600; }
    .panel { position: absolute; border: 2px solid #30363d; border-radius: 6px; background: #0d1117; }
    .cap { position: absolute; top: ${L.ty + L.th + 10}px; font: 16px ui-monospace, SFMono-Regular, Menlo, monospace; color: #6e7681; }
    .now { position: absolute; left: 26px; right: 26px; top: 744px; font-size: 27px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .now .seg { color: #f0b72f; font-weight: 700; }
    .now .beat { color: #f0f6fc; font-weight: 600; }
    .now .dot { color: #484f58; margin: 0 12px; }
    .sub { position: absolute; left: 26px; right: 26px; top: 786px; font-size: 22px; color: #9da7b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rail { position: absolute; left: 24px; right: 24px; top: 838px; display: grid; grid-template-columns: repeat(${manifest.parts.length}, 1fr); gap: 12px; }
    .part { border: 1.5px solid #21262d; border-radius: 10px; padding: 11px 14px 12px; background: #0d1117; min-height: 92px; position: relative; }
    .part .pl { font: 600 15px ui-monospace, SFMono-Regular, Menlo, monospace; color: #6e7681; }
    .part .pt { font-size: 20px; font-weight: 600; color: #8b949e; margin-top: 3px; line-height: 1.2; }
    .part .ps { font: 15px ui-monospace, SFMono-Regular, Menlo, monospace; color: #6e7681; margin-top: 4px; }
    .part.on { border-color: #f0b72f; background: #1f1a0b; }
    .part.on .pl, .part.on .ps { color: #f0b72f; }
    .part.on .pt { color: #f0f6fc; }
    .chips { position: absolute; right: 12px; top: 10px; display: flex; gap: 6px; }
    .chips span { font: 600 14px ui-monospace, SFMono-Regular, Menlo, monospace; color: #8b949e; border: 1px solid #30363d; border-radius: 6px; padding: 2px 7px; }
    .chips span.on { color: #0d1117; background: #f0b72f; border-color: #f0b72f; }
    .beats { position: absolute; left: 26px; right: 26px; top: 990px; font-size: 21px; color: #6e7681; white-space: nowrap; }
    .beats .b { padding: 5px 12px; border-radius: 999px; }
    .beats .b.done { color: #9da7b3; }
    .beats .b.on { color: #0d1117; background: #f0b72f; font-weight: 700; }
    .beats .sep { margin: 0 6px; color: #484f58; }
    .beats .lbl { font: 600 15px ui-monospace, SFMono-Regular, Menlo, monospace; color: #6e7681; margin-right: 12px; text-transform: uppercase; letter-spacing: .5px; }
  </style></head><body>
    <div class="h1">Orka PR shepherd</div>
    <div class="tag">sandbox PRs in <b>Jont828/dynamo</b> · recorded <b>${esc(segment.recorded)}</b></div>
    <div class="panel" style="left:${L.tx - 2}px;top:${L.ty - 2}px;width:${L.tw}px;height:${L.th}px"></div>
    <div class="panel" style="left:${L.bx - 2}px;top:${L.by - 2}px;width:${L.bw}px;height:${L.bh}px"></div>
    <div class="cap" style="left:${L.tx}px">terminal · real commands and their real output (asciinema)</div>
    <div class="cap" style="left:${L.bx}px">browser · GitHub and the Orka dashboard (Playwright)</div>
    <div class="now"><span class="seg">${esc(segment.label)} · ${esc(segment.title)}</span><span class="dot">/</span><span class="beat">${esc(ch.label)}</span></div>
    <div class="sub">${esc(ch.subtitle)}</div>
    <div class="rail">${parts}</div>
    <div class="beats"><span class="lbl">${segment.part === 'intro' || segment.part === 'wrapup' ? 'in this part' : 'demo'}</span>${beats}</div>
  </body></html>`;
}

const b = await chromium.launch({channel: 'chrome', headless: true});
const p = await b.newPage({viewport: {width: 1920, height: 1080}});
for (let i = 0; i < segment.chapters.length; i++) {
  await p.setContent(page(i));
  await p.screenshot({path: join(outDir, `chrome-${String(i).padStart(2, '0')}.png`)});
}
await b.close();
console.log(`rendered ${segment.chapters.length} frames for ${segment.key}`);
