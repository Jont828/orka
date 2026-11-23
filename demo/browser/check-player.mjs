// check-player.mjs <index.html> <shot-prefix>: screenshot the synced player page (desktop
// light/dark, phone) and check that the browser video follows the terminal after a jump to a
// beat (in demo 3b, then in the wrap-up), during playback and on pause, and that the "now"
// band and the outline follow too. Prints a JSON report; exits 1 on a failure.
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const [page_, prefix] = process.argv.slice(2);
const url = pathToFileURL(page_).href;
const b = await chromium.launch({channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
const report = {errors: [], shots: [], sync: []};

async function open(name, opts) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => report.errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') report.errors.push(`${name}: console: ${m.text()}`); });
  await p.goto(url);
  await p.waitForSelector('#term .ap-player, #term .ap-wrapper', {timeout: 15000});
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  const width = await p.evaluate(() => ({doc: document.documentElement.scrollWidth, view: innerWidth}));
  if (width.doc > width.view) report.errors.push(`${name}: horizontal overflow ${width.doc} > ${width.view}`);
  return {ctx, p};
}

async function times(p) {
  return p.evaluate(async () => ({
    term: Number((await player.getCurrentTime()).toFixed(2)),
    video: Number(document.getElementById('web').currentTime.toFixed(2)),
    videoPaused: document.getElementById('web').paused,
    now: `${document.getElementById('now-title').textContent} / ${document.getElementById('now-beat').textContent}`,
    current: document.querySelector('#chapters button[aria-current="true"] span')?.textContent,
    part: document.querySelector('#chapters .part[data-current="true"] .part-title')?.textContent,
  }));
}

for (const [name, opts] of [
  ['desktop-light', {viewport: {width: 1280, height: 900}, colorScheme: 'light'}],
  ['desktop-dark', {viewport: {width: 1280, height: 900}, colorScheme: 'dark'}],
  ['phone', {viewport: {width: 390, height: 844}, colorScheme: 'light', deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
]) {
  const {ctx, p} = await open(name, opts);
  const shot = `${prefix}-${name}.png`;
  await p.screenshot({path: shot, fullPage: true});
  report.shots.push(shot);
  if (name === 'desktop-light') {
    const beats = await p.evaluate(() => CHAPTERS.map((c) => `${c.segment}/${c.key}`));
    report.beats = beats.length;
    const fix = beats.indexOf('ci_base/fix');
    const wrap = beats.indexOf('wrapup/report');
    await p.locator('#chapters button').nth(fix).click();
    await p.waitForTimeout(4000);
    report.sync.push({step: 'jump to 3b "Main gets fixed", +4s', expect: '3b · Fixed on main → rebase / Main gets fixed', ...(await times(p))});
    await p.waitForTimeout(6000);
    report.sync.push({step: '+10s', ...(await times(p))});
    await p.screenshot({path: `${prefix}-playing.png`});
    report.shots.push(`${prefix}-playing.png`);
    await p.evaluate(() => player.pause());
    await p.waitForTimeout(800);
    report.sync.push({step: 'paused', ...(await times(p))});
    await p.locator('#chapters button').nth(wrap).click();
    await p.waitForTimeout(3000);
    report.sync.push({step: 'jump to the wrap-up report, +3s', expect: 'Wrap-up · Reports and recap / The 2-hourly report', ...(await times(p))});
  }
  await ctx.close();
}
await b.close();

const bad = report.sync.filter((s) => Math.abs(s.term - s.video) > 0.6 || (s.step === 'paused') !== s.videoPaused
  || (s.expect && s.now !== s.expect));
console.log(JSON.stringify({...report, syncFailures: bad.length}, null, 2));
process.exit(bad.length ? 1 : 0);
