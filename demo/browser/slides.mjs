// slides.mjs [name ...]: render the demo's slides (1280x720) to clips/<name>.png. They show in
// the browser pane, in the same style as title.html. With no names, renders every slide.
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';

const OUT = new URL('./clips/', import.meta.url).pathname;
mkdirSync(OUT, {recursive: true});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const code = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

const CSS = `
  :root { --ink: #0d1117; --muted: #57606a; --line: #d0d7de; --blue: #0969da; --green: #1a7f37; --orange: #bc4c00;
    --purple: #8250df; --bg: #f6f8fa; --amber: #9a6700; }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1280px; height: 720px; background: #fff; color: var(--ink); overflow: hidden;
    font: 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
  .wrap { padding: 46px 56px 0; }
  .kicker { font: 600 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .6px; text-transform: uppercase;
    color: var(--orange); margin-bottom: 10px; }
  h1 { margin: 0; font-size: 44px; letter-spacing: -0.5px; line-height: 1.12; }
  .sub { margin: 10px 0 0; color: var(--muted); font-size: 20.5px; max-width: 1120px; }
  code { font: 14.5px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); padding: 1px 5px; border-radius: 5px; }
  .grid { display: grid; gap: 16px; margin-top: 30px; }
  .box { border: 1.5px solid var(--line); border-radius: 12px; padding: 16px 18px; background: #fff; }
  .box h3 { margin: 0 0 6px; font-size: 19.5px; }
  .box p { margin: 0; color: var(--muted); font-size: 16.5px; }
  .box ul { margin: 6px 0 0; padding-left: 20px; color: var(--muted); font-size: 16.5px; }
  .box li { margin: 3px 0; }
  .box.hl { border-color: #f0b72f; box-shadow: 0 0 0 3px #fff1c2 inset; }
  .tag { display: inline-block; font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase;
    letter-spacing: .5px; padding: 4px 7px; border-radius: 999px; margin-bottom: 8px; background: #ddf4ff; color: var(--blue); }
  .tag.g { background: #dafbe1; color: var(--green); } .tag.p { background: #fbefff; color: var(--purple); }
  .tag.y { background: #fff8c5; color: #7d4e00; } .tag.o { background: #fff1e5; color: var(--orange); }
  .foot { position: absolute; left: 56px; right: 56px; bottom: 28px; display: flex; justify-content: space-between;
    color: var(--muted); font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 26px; font-size: 16px; }
  th { text-align: left; font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase;
    letter-spacing: .5px; color: var(--muted); padding: 0 12px 10px; border-bottom: 1.5px solid var(--line); }
  td { padding: 11px 12px; border-bottom: 1px solid #eaeef2; vertical-align: top; color: var(--muted); }
  td.cap { color: var(--ink); font-weight: 650; white-space: nowrap; }
  td.step { font: 600 14.5px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--orange); white-space: nowrap; }
  td.demo { white-space: nowrap; color: var(--blue); font-weight: 600; }
  .beats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin-top: 36px; counter-reset: b; }
  .beat { position: relative; padding: 18px 20px 18px 22px; border: 1.5px solid var(--line); border-right: 0; background: #fff; }
  .beat:first-child { border-radius: 12px 0 0 12px; } .beat:last-child { border-right: 1.5px solid var(--line); border-radius: 0 12px 12px 0; }
  .beat h4 { margin: 0 0 6px; font-size: 17.5px; } .beat h4::before { counter-increment: b; content: counter(b) "  "; color: var(--orange);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .beat p { margin: 0; color: var(--muted); font-size: 16px; }
  .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 24px; }
  .fact { background: var(--bg); border-radius: 12px; padding: 16px 18px; font-size: 16px; color: var(--muted); }
  .fact b { color: var(--ink); display: block; font-size: 17.5px; margin-bottom: 4px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 28px; }
  .two ul { margin: 0; padding-left: 20px; } .two li { margin: 8px 0; color: var(--muted); font-size: 17.5px; }
  .two li b { color: var(--ink); }
  .flow { display: grid; grid-template-columns: 1fr 26px 1fr 26px 1.1fr 26px 1fr; margin-top: 28px; }
  .flow .arrow { align-self: center; text-align: center; color: var(--muted); font-size: 22px; }
  .flow .box ul { padding-left: 18px; }
`;

const page = (body, foot = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
  <body><div class="wrap">${body}</div><div class="foot"><span>Orka PR shepherd · live demo on sandbox PRs in Jont828/dynamo</span><span>${esc(foot)}</span></div></body></html>`;

// One opener per demo segment: what it shows, in the four beats every demo follows.
function opener({kicker, title, sub, beats, facts, foot}) {
  return page(`
    <div class="kicker">${esc(kicker)}</div>
    <h1>${esc(title)}</h1>
    <p class="sub">${code(sub)}</p>
    <div class="beats">${beats.map(([h, p]) => `<div class="beat"><h4>${esc(h)}</h4><p>${code(p)}</p></div>`).join('')}</div>
    <div class="facts">${facts.map(([b, p]) => `<div class="fact"><b>${esc(b)}</b>${code(p)}</div>`).join('')}</div>`, foot);
}

const SLIDES = {
  'slide-orka': page(`
    <div class="kicker">What Orka is</div>
    <h1>Orka runs AI agents on your Kubernetes cluster</h1>
    <p class="sub">You write a small YAML Task. Orka runs it in a Pod, keeps a record of what happened and cleans up.
      Model keys and tokens stay in the cluster.</p>
    <div class="grid" style="grid-template-columns: repeat(3, 1fr)">
      <div class="box"><span class="tag">Task</span><h3>Ask a model</h3><p>Orka's AI worker, with built-in tools such as web search and code execution.</p></div>
      <div class="box"><span class="tag p">Task</span><h3>Run a coding agent</h3><p>Codex, Claude Code, Copilot CLI or OpenCode on a real git repository.</p></div>
      <div class="box hl"><span class="tag o">Task · the PR shepherd</span><h3>Run a command</h3><p>Any container image. The shepherd is one: Copilot CLI, <code>gh</code> and git, with its token and signing key from Kubernetes Secrets.</p></div>
    </div>
    <div class="grid" style="grid-template-columns: repeat(3, 1fr); margin-top: 16px">
      <div class="fact"><b>On a schedule</b>A cron and time zone; <code>Forbid</code> keeps runs from overlapping.</div>
      <div class="fact"><b>Every run is a Task</b>Its own status, logs and result, kept as history.</div>
      <div class="fact"><b>Read it anywhere</b>The REST API, <code>kubectl</code>, or the built-in dashboard.</div>
    </div>`, 'Orka 0.3.0 · AKS cluster h100'),

  'slide-shepherd': page(`
    <div class="kicker">The PR shepherd</div>
    <h1>One scheduled Task: a gate every 15 minutes, an agent only when needed</h1>
    <p class="sub">It moves Jont828's open PRs in ai-dynamo/dynamo toward merge, and reviews them before maintainers do.</p>
    <div class="flow">
      <div class="box"><span class="tag">Orka Task</span><h3>Schedule</h3>
        <p><code>*/15 * * * *</code>, <code>Forbid</code>. A container on the h100 cluster; its token and signing key come from Kubernetes Secrets.</p></div>
      <div class="arrow">→</div>
      <div class="box"><span class="tag y">Gate · seconds</span><h3>watch.mjs</h3><ul>
        <li>a regular run every 2 hours</li><li>a new merge conflict</li><li>a new failed check</li><li>a review that's due</li><li>otherwise: stop</li></ul></div>
      <div class="arrow">→</div>
      <div class="box"><span class="tag p">Agent</span><h3>Copilot CLI + skill</h3><ul>
        <li>A · rebase</li><li>B · diagnose CI</li><li>C · CodeRabbit threads</li><li>R, S · self-review, brief</li><li>D–G · report, nudges</li></ul></div>
      <div class="arrow">→</div>
      <div class="box"><span class="tag g">GitHub + report</span><h3>Acts as the author</h3><ul>
        <li>signed commits, pushed with a lease</li><li>thread replies, one brief</li><li>report = the Task's result</li></ul></div>
    </div>
    <div class="facts">
      <div class="fact"><b>Scoped runs</b>A triggered run gets only the PRs and steps that need it.</div>
      <div class="fact"><b>Knows its own work</b>Its commits carry the cluster's signature and an <code>Automated-by</code> trailer.</div>
      <div class="fact"><b>Shadow mode upstream</b>Briefs and self-review fixes stay in the report for now.</div>
    </div>`, 'Production: task/dynamo-pr-shepherd in orka-system'),

  'slide-steps': page(`
    <div class="kicker">What the shepherd handles</div>
    <h1>Each capability is a step of the pr-shepherd skill</h1>
    <table>
      <tr><th>Capability</th><th>Step</th><th>Starts when</th><th>What it does</th><th>Shown in</th></tr>
      <tr><td class="cap">Review comments</td><td class="step">C</td><td>a review run, and every 2-hourly run</td>
        <td>Checks each CodeRabbit item on evidence. Fixes valid ones, declines the rest with a reason, and settles the thread. Design questions go to you.</td><td class="demo">Demo 1</td></tr>
      <tr><td class="cap">Merge conflict</td><td class="step">A</td><td>a new conflict, within one slot</td>
        <td>Verified backup, rebase, mechanical resolution (aborts on judgment calls), validation, push with a lease.</td><td class="demo">Demo 2</td></tr>
      <tr><td class="cap">CI failure</td><td class="step">B</td><td>a new failed check, once CI on that head is done</td>
        <td>Finds whose bug it is. This PR's code: fix it. Fixed on main already: rebase. Infrastructure or a flake: report it.</td><td class="demo">Demo 3a–3c</td></tr>
      <tr><td class="cap">Review assistant</td><td class="step">R + S</td><td>a new head, once it's quiet (60 min)</td>
        <td>Codeowner-style self-review; a fresh subagent tries to refute each finding. Pushes verified low-risk fixes and keeps one brief for maintainers.</td><td class="demo">Demo 4</td></tr>
      <tr><td class="cap">Report and nudges</td><td class="step">D–G</td><td>the 2-hourly regular run</td>
        <td>New human comments, approved PRs to merge, codeowner pings after 2 quiet business days, stale PRs.</td><td class="demo">Wrap-up</td></tr>
    </table>`, 'Every 15 minutes the gate picks the steps a slot needs; most slots need none'),

  'slide-guardrails': page(`
    <div class="kicker">What it never does</div>
    <h1>It acts as the author, within limits, and reports everything</h1>
    <div class="two">
      <div class="box"><span class="tag o">Never</span><ul>
        <li>Merges, approves, closes, re-labels or changes reviewers</li>
        <li>Edits PR titles, descriptions or anyone else's comments</li>
        <li>Replies to people (human comments are listed for you)</li>
        <li>Posts <code>/ok to test</code> or pushes to upstream</li>
        <li>Uses a plain <code>--force</code></li></ul></div>
      <div class="box"><span class="tag g">Always</span><ul>
        <li><b>A verified backup branch</b> before rewriting history</li>
        <li><b>Validates</b> (pre-commit and tests) before it pushes</li>
        <li><b>At most one</b> rebase, CI-fix and review-fix commit per PR per run</li>
        <li><b>No review fixes</b> once a PR has any approval</li>
        <li><b>Signed, signed-off commits</b> with <code>Automated-by: pr-shepherd</code></li></ul></div>
    </div>
    <p class="sub" style="margin-top: 22px">When it can't settle something, it stops, leaves the PR as it was, and puts it under “Needs your attention”.</p>`,
    'From the pr-shepherd skill'),

  'outro-summary': page(`
    <div class="kicker">Recap</div>
    <h1>What the shepherd did, unattended</h1>
    <p class="sub">Three sandbox PRs in Jont828/dynamo. After each setup, nobody touched them.</p>
    <table>
      <tr><th>Demo</th><th>Step</th><th>What happened</th><th>PR</th></tr>
      <tr><td class="cap">1 · Review comments</td><td class="step">C</td><td>CodeRabbit’s M/G bug confirmed and fixed in <code>418a77b</code>; CodeRabbit verified it and resolved its thread.</td><td class="demo">#11</td></tr>
      <tr><td class="cap">2 · Merge conflict</td><td class="step">A</td><td>Backed up, rebased, both README lines kept, commits re-signed, pushed with a lease.</td><td class="demo">#11</td></tr>
      <tr><td class="cap">3a · Our bug</td><td class="step">B</td><td>Cause 1, the PR’s code: one-line fix (360 → 3600) in <code>eb2c0f9</code>; CI green.</td><td class="demo">#12</td></tr>
      <tr><td class="cap">3b · Fixed on main</td><td class="step">B</td><td>Cause 2, a stale base: found <code>367a899</code> on the base and rebased onto it; CI green.</td><td class="demo">#13</td></tr>
      <tr><td class="cap">3c · Not our bug</td><td class="step">B</td><td>Cause 3, infrastructure: a fork-only bot job, reported with evidence, no commit.</td><td class="demo">#11</td></tr>
      <tr><td class="cap">4 · Review assistant</td><td class="step">R + S</td><td>Dynamo’s rubric, the fix confirmed by a fresh subagent, one review brief posted.</td><td class="demo">#11</td></tr>
    </table>
    <div class="facts">
      <div class="fact"><b>4 runs did work</b>26 minutes in all. Every other slot ended in seconds.</div>
      <div class="fact"><b>3 backup branches</b>Verified before any rewrite; every push used a lease.</div>
      <div class="fact"><b>0 writes upstream</b>Production kept its schedule, in shadow mode for reviews.</div>
    </div>`, 'Recorded Nov 11 and Nov 17, 2026 · Orka 0.3.0 on AKS'),
  'opener-comments': opener({
    kicker: 'Demo 1 · review comments · step C',
    title: 'CodeRabbit flags a bug: checked, fixed, answered, resolved',
    sub: 'Sandbox PR #11 adds a Kubernetes quantity parser. CodeRabbit found that `M` and `G` use powers of 1024, and nobody answered.',
    beats: [['Setup', 'An unanswered CodeRabbit comment on PR #11.'], ['The gate notices', 'The head is new and quiet: a review is due.'],
      ['The agent works', 'Checks the claim against the code, reproduces it, fixes it.'], ['Result', 'One signed commit; CodeRabbit verifies it and resolves its thread.']],
    facts: [['Judged on evidence', 'Valid: fixed. Wrong or out of scope: declined with a reason. Needs a decision: left for you.'],
      ['Live in production', 'Upstream, step C already fixes and answers CodeRabbit items.'], ['Recorded', 'Nov 11, 2026, on the h100 cluster.']],
    foot: 'Jont828/dynamo#11',
  }),
  'opener-conflict': opener({
    kicker: 'Demo 2 · merge conflict · step A',
    title: 'The base moves under the PR; the shepherd rebases it',
    sub: 'A commit lands on `orka-demo/base` (standing in for upstream main) and edits the README line PR #11 also edits.',
    beats: [['Setup', 'The PR becomes CONFLICTING. Nobody touches it.'], ['The gate notices', 'The next slot sees a new conflict.'],
      ['The agent works', 'Backup, rebase, resolve, validate, push with a lease.'], ['Result', 'CLEAN again: both lines kept, commits re-signed.']],
    facts: [['Mechanical vs. judgment', 'It resolves mechanical conflicts and aborts and reports one that needs a design call.'],
      ['Semantic check', 'It also looks for main changes the PR’s own rule should cover.'], ['Recorded', 'Nov 11, 2026, on the h100 cluster.']],
    foot: 'Jont828/dynamo#11',
  }),
  'opener-ci_ours': opener({
    kicker: 'Demo 3a · CI failure · step B',
    title: 'Our change broke a test: diagnose it, fix it, push once',
    sub: 'Sandbox PR #12 adds a duration parser. Its hours multiplier is `360`, not `3600`, so three of its own tests fail.',
    beats: [['Setup', 'PR #12’s CI fails on its own tests.'], ['The gate notices', 'Once CI on that head finishes, the next slot hands it over.'],
      ['The agent works', 'Reads the log, reproduces it, decides it’s the PR’s code, fixes it.'], ['Result', 'One signed CI-fix commit; CI green.']],
    facts: [['Cause 1: this PR’s code', 'Fixed, validated with the same tests CI runs, pushed once.'],
      ['No retry loops', 'If its own fix doesn’t work, the next run escalates to you.'], ['Recorded', 'Nov 17, 2026, on the h100 cluster.']],
    foot: 'Jont828/dynamo#12',
  }),
  'opener-ci_base': opener({
    kicker: 'Demo 3b · CI failure · step B',
    title: 'Main was broken, and it’s fixed now: rebase, don’t patch',
    sub: 'A cleanup on the base branch breaks a test. Docs-only PR #13 branches after it and fails CI. Then a fix lands on the base.',
    beats: [['Setup', 'PR #13 fails on a test it never touched. Then main gets fixed.'], ['The gate notices', 'The next slot hands the failure over.'],
      ['The agent works', 'Not this PR’s code. It finds the fix on the base and rebases onto it.'], ['Result', 'CI green, citing the fixing commit.']],
    facts: [['Cause 2: the base', 'It scans the base’s new commits for a fix and rebases to pick it up.'],
      ['Why rebase', 'Dynamo’s CI tests the PR’s head, so a fix on main only arrives with a rebase.'], ['Recorded', 'Nov 17, 2026, on the h100 cluster.']],
    foot: 'Jont828/dynamo#13',
  }),
  'opener-ci_infra': opener({
    kicker: 'Demo 3c · CI failure · step B',
    title: 'Not our bug, no fix yet: report it',
    sub: 'A Dynamo bot workflow fails on every PR in the fork because its token is empty there. It doesn’t test code.',
    beats: [['Setup', 'PR #11 has a failed bot check.'], ['The gate notices', 'The same run as demo 2 gets it.'],
      ['The agent works', 'Reads the job log; nothing in the PR can cause it.'], ['Result', 'Cause 3, High confidence: reported, no commit.']],
    facts: [['Cause 3: infrastructure', 'Reported with evidence. Upstream, a flake is reported as needing a maintainer rerun.'],
      ['A note on this demo', 'Its fork instructions say these bot jobs don’t test code; it still checks the log.'], ['Recorded', 'Nov 11, 2026, on the h100 cluster.']],
    foot: 'Jont828/dynamo#11',
  }),
  'opener-review': opener({
    kicker: 'Demo 4 · review assistant · steps R + S',
    title: 'A codeowner-style review, and one brief for maintainers',
    sub: 'The review run on PR #11 also reviewed the PR with Dynamo’s own guidance and left one comment for the people who decide.',
    beats: [['Setup', 'A PR head with new commits from the author.'], ['The gate notices', 'The head is quiet: a review is due.'],
      ['The agent works', 'Rubric from the base branch; a fresh subagent confirms each fix.'], ['Result', 'One brief: risk, where to look, decisions.']],
    facts: [['Fewer review rounds', 'Only findings a reviewer would act on; nits go to the author.'],
      ['Shadow mode upstream', 'In production the brief goes into the report until the author turns it live.'], ['Recorded', 'Nov 11, 2026, on the h100 cluster.']],
    foot: 'Jont828/dynamo#11',
  }),
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SLIDES);
const b = await chromium.launch({channel: 'chrome', headless: true});
const p = await b.newPage({viewport: {width: 1280, height: 720}});
for (const name of names) {
  if (!SLIDES[name]) throw new Error(`unknown slide ${name}`);
  await p.setContent(SLIDES[name]);
  await p.screenshot({path: `${OUT}${name}.png`});
  const over = await p.evaluate(() => document.querySelector('.wrap').scrollHeight > 690);
  console.log(`${name}.png${over ? '  (content runs into the footer)' : ''}`);
}
await b.close();
