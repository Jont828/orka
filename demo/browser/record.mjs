// Records scripted browser scenes for the Orka PR shepherd demo with Playwright and the
// system Chrome. Usage: node record.mjs <scene> [<scene> ...]   (scenes are in scenes.mjs)
// Each scene writes clips/<scene>.webm plus clips/<scene>.json (start offset and chapter marks).
// ORKA_TOKEN (optional) signs the Orka dashboard in through its persisted auth store, so the
// token is never typed on screen.
import {mkdirSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {scenes} from './scenes.mjs';

const W = 1280;
const H = 720;
const OUT = new URL('./clips/', import.meta.url).pathname;
mkdirSync(OUT, {recursive: true});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function helpers(page, t0, marks) {
  const h = {
    page,
    sleep,
    mark(label) {
      marks.push({t: (Date.now() - t0) / 1000, label});
    },
    async goto(url, {waitFor} = {}) {
      await page.goto(url, {waitUntil: 'domcontentloaded'});
      if (waitFor) await page.locator(waitFor).first().waitFor({timeout: 30_000});
      await page.waitForLoadState('networkidle', {timeout: 15_000}).catch(() => {});
      await h.decorate();
    },
    // Hide sign-up banners and other chrome that distracts in a recording.
    async decorate() {
      await page.addStyleTag({
        content: `
          .js-flash-container, .flash-full, [data-testid="sign-up-banner"], .signup-prompt-bg,
          .js-notification-shelf, .Header-old .HeaderMenu-link--sign-up { display: none !important; }
          #orka-caption { position: fixed; inset: auto; left: 50%; bottom: 22px; transform: translateX(-50%);
            margin: 0; overflow: visible; width: max-content;
            z-index: 2147483647; max-width: 1080px; padding: 10px 18px; border-radius: 10px;
            background: rgba(13,17,23,.92); color: #f0f6fc; font: 600 17px/1.35 -apple-system,
            BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.35);
            border: 1px solid rgba(240,246,252,.18); transition: opacity .35s; pointer-events: none; }
          #orka-caption small { display: block; font-weight: 400; font-size: 14px; color: #c9d1d9; }
          #orka-caption .tag { display: inline-block; margin-right: 8px; padding: 1px 7px;
            border-radius: 6px; background: #2f81f7; color: #fff; font-size: 13px; }
          .orka-spot { outline: 4px solid #ff8c00 !important; outline-offset: 4px !important;
            border-radius: 6px; box-shadow: 0 0 0 9999px rgba(1,4,9,.18) !important;
            transition: outline-color .3s, box-shadow .3s; position: relative; z-index: 2; }
          .orka-redact { color: transparent !important; text-shadow: 0 0 9px rgba(87,96,106,.95); user-select: none; }
          .orka-redact[data-label]::before { content: attr(data-label); color: #fff; text-shadow: none; background: #57606a;
            font: 600 12px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; border-radius: 4px;
            padding: 1px 8px; margin-right: 8px; }
        `,
      });
    },
    async caption(text, sub = '', tag = '') {
      await page.evaluate(
        ([text, sub, tag]) => {
          let el = document.getElementById('orka-caption');
          if (!el) {
            el = document.createElement('div');
            el.id = 'orka-caption';
            // A manual popover lives in the top layer, so no page stacking context can cover it.
            el.setAttribute('popover', 'manual');
            document.body.appendChild(el);
          }
          el.replaceChildren();
          if (tag) {
            const t = document.createElement('span');
            t.className = 'tag';
            t.textContent = tag;
            el.appendChild(t);
          }
          el.appendChild(document.createTextNode(text));
          if (sub) {
            const s = document.createElement('small');
            s.textContent = sub;
            el.appendChild(s);
          }
          el.style.opacity = text ? '1' : '0';
          if (!el.matches(':popover-open')) el.showPopover();
        },
        [text, sub, tag],
      );
      if (process.env.DEBUG_SHOTS) {
        const info = await page.evaluate(() => {
          const el = document.getElementById('orka-caption');
          const cs = el && getComputedStyle(el);
          return el && {position: cs.position, opacity: cs.opacity, rect: el.getBoundingClientRect().toJSON(), styles: [...document.querySelectorAll('style')].filter((s) => s.textContent.includes('orka-caption')).length};
        });
        console.log('caption', JSON.stringify(info));
        await page.screenshot({path: `/tmp/caption-${Date.now()}.png`});
      }
    },
    locate(target) {
      if (typeof target !== 'string') return target;
      return target.startsWith('text=') ? page.getByText(target.slice(5), {exact: false}).first() : page.locator(target).first();
    },
    // Smoothly scroll so the target sits about `at` of the way down its scroll view: the window,
    // or the nearest scrollable panel around it (the Orka dashboard scrolls an inner <main>).
    async scrollTo(target, {at = 0.3, ms = 1400} = {}) {
      const loc = h.locate(target);
      await loc.waitFor({state: 'attached', timeout: 20_000});
      await loc.evaluate(
        (el, [at, ms]) =>
          new Promise((done) => {
            let s = el.parentElement;
            while (s && s !== document.body && s !== document.documentElement) {
              const cs = getComputedStyle(s);
              if (/(auto|scroll)/.test(cs.overflowY) && s.scrollHeight > s.clientHeight) break;
              s = s.parentElement;
            }
            const doc = !s || s === document.body || s === document.documentElement;
            const sc = doc ? document.scrollingElement : s;
            const top = doc ? 0 : sc.getBoundingClientRect().top;
            const height = doc ? window.innerHeight : sc.clientHeight;
            const to = Math.max(0, sc.scrollTop + el.getBoundingClientRect().top - top - height * at);
            const from = sc.scrollTop;
            const start = performance.now();
            const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
            const step = (now) => {
              const k = ms ? Math.min(1, (now - start) / ms) : 1;
              sc.scrollTop = from + (to - from) * ease(k);
              if (k < 1) requestAnimationFrame(step);
              else done();
            };
            requestAnimationFrame(step);
          }),
        [at, ms],
      );
    },
    async scrollY(top, ms = 1400) {
      await page.evaluate(
        ([top, ms]) =>
          new Promise((done) => {
            const from = window.scrollY;
            const start = performance.now();
            const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
            const step = (now) => {
              const k = Math.min(1, (now - start) / ms);
              window.scrollTo(0, from + (top - from) * ease(k));
              if (k < 1) requestAnimationFrame(step);
              else done();
            };
            requestAnimationFrame(step);
          }),
        [top, ms],
      );
    },
    async spot(target, ms = 0) {
      const loc = h.locate(target);
      await loc.evaluate((el) => el.classList.add('orka-spot'));
      if (ms) {
        await sleep(ms);
        await loc.evaluate((el) => el.classList.remove('orka-spot')).catch(() => {});
      }
    },
    // Outline one line of a long text block (the dashboard's Result tab is a single <pre>) and
    // scroll it to `at` of the way down its scroll view.
    async spotLine(text, {at = 0.3, ms = 1300} = {}) {
      await page.evaluate(
        ([text, at, ms]) =>
          new Promise((done, fail) => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) if (node.data.includes(text)) break;
            if (!node) return fail(new Error(`text not found: ${text}`));
            const i = node.data.indexOf(text);
            const a = node.data.lastIndexOf('\n', i) + 1;
            let b = node.data.indexOf('\n', i);
            if (b < 0) b = node.data.length;
            const range = document.createRange();
            range.setStart(node, a);
            range.setEnd(node, b);
            const el = document.createElement('span');
            el.style.boxDecorationBreak = 'clone';
            range.surroundContents(el);
            let s = el.parentElement;
            while (s && s !== document.body && s !== document.documentElement) {
              const cs = getComputedStyle(s);
              if (/(auto|scroll)/.test(cs.overflowY) && s.scrollHeight > s.clientHeight) break;
              s = s.parentElement;
            }
            const doc = !s || s === document.body || s === document.documentElement;
            const sc = doc ? document.scrollingElement : s;
            const top = doc ? 0 : sc.getBoundingClientRect().top;
            const height = doc ? window.innerHeight : sc.clientHeight;
            const to = Math.max(0, sc.scrollTop + el.getBoundingClientRect().top - top - height * at);
            const from = sc.scrollTop;
            const start = performance.now();
            const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
            const step = (now) => {
              const k = ms ? Math.min(1, (now - start) / ms) : 1;
              sc.scrollTop = from + (to - from) * ease(k);
              if (k < 1) requestAnimationFrame(step);
              else {
                el.className = 'orka-spot'; // outline it once it's in place
                done();
              }
            };
            requestAnimationFrame(step);
          }),
        [text, at, ms],
      );
    },
    async unspot() {
      await page.evaluate(() => document.querySelectorAll('.orka-spot').forEach((el) => el.classList.remove('orka-spot')));
    },
    // Blur text that names or quotes people other than the PR's author. With only `from`, blur
    // that text; with `to`, blur whole lines, from the one containing `from` through the one
    // containing `to`, and put `label` in front of them so the viewer knows what was hidden.
    async redact(from, to = '', label = '') {
      await page.evaluate(
        ([from, to, label]) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) if (node.data.includes(from)) break;
          if (!node) throw new Error(`text not found: ${from}`);
          const i = node.data.indexOf(from);
          let a = i;
          let b = i + from.length;
          if (to) {
            const j = node.data.indexOf(to, i);
            if (j < 0) throw new Error(`text not found after ${from}: ${to}`);
            a = node.data.lastIndexOf('\n', i) + 1;
            b = node.data.indexOf('\n', j);
            if (b < 0) b = node.data.length;
          }
          const range = document.createRange();
          range.setStart(node, a);
          range.setEnd(node, b);
          const el = document.createElement('span');
          el.className = 'orka-redact';
          if (label) el.dataset.label = label;
          range.surroundContents(el);
        },
        [from, to, label],
      );
    },
    // The Orka dashboard's Logs tab: its scroll box, one row per log line.
    logBox() {
      return page.locator('div.overflow-auto').filter({hasText: 'PR watch at'}).first();
    },
    // Bring the log box near the top of the viewport, so captions don't cover it. The dashboard
    // scrolls an inner panel, not the window, so scroll the box's nearest scrollable ancestor.
    async logsIntoView() {
      const box = h.logBox();
      await box.waitFor({timeout: 20_000});
      await box.evaluate((el) => {
        let s = el.parentElement;
        while (s && s !== document.body) {
          const cs = getComputedStyle(s);
          if (/(auto|scroll)/.test(cs.overflowY) && s.scrollHeight > s.clientHeight) break;
          s = s.parentElement;
        }
        const scroller = s && s !== document.body ? s : document.scrollingElement;
        scroller.style.paddingBottom = '480px'; // room to scroll the box all the way up
        scroller.scrollTop += el.getBoundingClientRect().top - 92;
      });
    },
    // Scroll the log box so the line containing `text` sits `at` of the way down it; returns the line.
    async logTo(text, {at = 0.3, ms = 1300} = {}) {
      const line = h.logBox().locator('[class~="py-0.5"]').filter({hasText: text}).first();
      await line.waitFor({state: 'attached', timeout: 20_000});
      await line.evaluate(
        (el, [at, ms]) =>
          new Promise((done) => {
            const box = el.closest('.overflow-auto');
            const r = el.getBoundingClientRect();
            const b = box.getBoundingClientRect();
            const to = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, box.scrollTop + r.top - b.top - box.clientHeight * at));
            const from = box.scrollTop;
            const start = performance.now();
            const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
            const step = (now) => {
              const k = Math.min(1, (now - start) / ms);
              box.scrollTop = from + (to - from) * ease(k);
              if (k < 1) requestAnimationFrame(step);
              else done();
            };
            requestAnimationFrame(step);
          }),
        [at, ms],
      );
      return line;
    },
  };
  return h;
}

async function run(name) {
  const scene = scenes[name];
  if (!scene) throw new Error(`unknown scene ${name}; known: ${Object.keys(scenes).join(', ')}`);
  const dir = join(OUT, `.tmp-${name}`);
  rmSync(dir, {recursive: true, force: true});
  const browser = await chromium.launch({channel: 'chrome', headless: true, args: [`--window-size=${W},${H}`]});
  const context = await browser.newContext({
    viewport: {width: W, height: H},
    deviceScaleFactor: 1,
    colorScheme: scene.colorScheme ?? 'light',
    bypassCSP: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    recordVideo: {dir, size: {width: W, height: H}},
  });
  if (process.env.ORKA_TOKEN && scene.orkaAuth) {
    await context.addInitScript((token) => {
      try {
        localStorage.setItem('orka-auth', JSON.stringify({state: {token}, version: 0}));
      } catch {}
    }, process.env.ORKA_TOKEN);
  }
  const page = await context.newPage();
  const t0 = Date.now();
  const marks = [];
  const h = helpers(page, t0, marks);
  let ok = true;
  try {
    await scene.run(h);
  } catch (err) {
    ok = false;
    console.error(`scene ${name} failed: ${err.stack || err.message}`);
    await page.screenshot({path: join(OUT, `${name}-error.png`)}).catch(() => {});
  }
  const duration = (Date.now() - t0) / 1000;
  await context.close();
  await browser.close();
  const [file] = readdirSync(dir).filter((f) => f.endsWith('.webm'));
  renameSync(join(dir, file), join(OUT, `${name}.webm`));
  rmSync(dir, {recursive: true, force: true});
  const start = marks.find((m) => m.label === 'start')?.t ?? 0;
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({scene: name, ok, duration, start, marks}, null, 2));
  console.log(`${ok ? 'recorded' : 'FAILED'} ${name}: ${duration.toFixed(1)}s (content starts at ${start.toFixed(1)}s)`);
  if (!ok) process.exitCode = 1;
}

for (const name of process.argv.slice(2)) await run(name);
