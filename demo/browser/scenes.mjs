// Browser scenes for the Orka PR shepherd demo. Each scene is recorded on its own by
// record.mjs; captions say what the viewer is looking at.
const PR = 'https://github.com/Jont828/dynamo/pull/11';
const UPSTREAM_PR = process.env.UPSTREAM_PR || 'https://github.com/ai-dynamo/dynamo/pull/18618';
const ORKA = process.env.ORKA_URL || 'http://localhost:18080';

// A walk through a finished run's log in the Orka dashboard: each step scrolls the log box
// to a line, outlines it and captions it. A step's `mark` starts a new part of the clip, so
// beats can play parts of it ("log-run1-a@start~work").
function logScene(run, steps) {
  return {
    orkaAuth: true,
    async run(h) {
      await h.goto(`${ORKA}/tasks/${run}?namespace=orka-system`, {waitFor: 'text=Logs'});
      await h.page.getByText('Logs', {exact: true}).first().click();
      await h.logBox().waitFor({timeout: 20_000});
      await h.sleep(800);
      await h.decorate();
      await h.logsIntoView();
      for (const [i, s] of steps.entries()) {
        const line = await h.logTo(s.line, {at: s.at ?? 0.3, ms: i === 0 ? 10 : 1300});
        if (i === 0) h.mark('start');
        if (s.mark) h.mark(s.mark);
        await h.spot(line);
        await h.caption(s.text, s.sub ?? '', s.tag ?? 'Logs');
        await h.sleep(s.hold ?? 4800);
        await h.unspot();
      }
      h.mark('end');
    },
  };
}

export const scenes = {
  // After the review run: thread answered and resolved, one fix commit, the review brief.
  'pr-reviewed': {
    async run(h) {
      await h.goto(PR, {waitFor: 'text=Review brief'});
      await h.scrollTo('text=Actionable comments posted', {at: 0.2, ms: 10});
      h.mark('start');
      await h.caption('The review run: CodeRabbit’s thread is answered and resolved', 'The shepherd fixed the bug, replied with the commit, and CodeRabbit verified it.', 'PR #11');
      await h.scrollTo('review-thread-collapsible[data-resolved="true"]', {at: 0.3});
      await h.sleep(1200);
      await h.page.locator('review-thread-collapsible[data-resolved="true"] button.review-thread-chevron').first().click();
      await h.page.getByText('Fixed in', {exact: false}).first().waitFor({timeout: 20_000});
      await h.sleep(800);
      await h.scrollTo('text=Fixed in', {at: 0.35});
      await h.spot('text=Fixed in');
      await h.sleep(5000);
      await h.unspot();
      await h.scrollTo('text=Verified in', {at: 0.4, ms: 1200});
      await h.spot('text=Verified in');
      await h.caption('CodeRabbit checks the fix and resolves its own thread', 'Live mode would also resolve a declined thread once CodeRabbit accepts the reason.', 'CodeRabbit');
      await h.sleep(4500);
      await h.unspot();
      h.mark('commit');
      await h.scrollTo('text=use decimal multipliers for the M and G quantity suffixes', {at: 0.35});
      await h.spot('text=use decimal multipliers for the M and G quantity suffixes');
      await h.caption('One review-fix commit: signed, signed off, Automated-by: pr-shepherd', 'Validated first: the new tests fail on the old code, all 15 pass, pre-commit is clean.', 'PR #11');
      await h.sleep(4500);
      await h.unspot();
      h.mark('brief');
      await h.scrollTo('text=written by the author', {at: 0.12, ms: 1600});
      await h.spot('text=Decisions for reviewers');
      await h.caption('The review brief: what maintainers need, in one comment', 'Risk, where to look, the one decision only a maintainer can make, and what was checked.', 'Brief');
      await h.sleep(6000);
      await h.unspot();
      await h.scrollY(await h.page.evaluate(() => window.scrollY + 260), 1600);
      await h.spot('text=Still open');
      await h.caption('Edited in place after every review, never a new comment', 'In production it stays in shadow mode until the user turns it live.', 'Brief');
      await h.sleep(5000);
      await h.unspot();
      h.mark('diff');
      await h.goto('https://github.com/Jont828/dynamo/commit/418a77b', {waitFor: 'text=use decimal multipliers'});
      await h.spot('text=Automated-by: pr-shepherd');
      await h.caption('The commit message lists each fix and what prompted it', 'Its signature and trailer keep it from triggering another review.', 'Commit');
      await h.sleep(4500);
      await h.unspot();
      await h.scrollTo('text=Decimal(1000) ** 2', {at: 0.45});
      await h.spot('text=Decimal(1000) ** 2');
      await h.caption('The fix: M and G are powers of 1000, with regression tests', '+5 −2 across quantity.py and test_quantity.py.', 'Commit');
      await h.sleep(5000);
      h.mark('end');
    },
  },
  // The review run's report in the dashboard.
  'orka-result-2': {
    orkaAuth: true,
    async run(h) {
      const run = process.env.RUN || 'dynamo-pr-shepherd-demo-1794440400';
      await h.goto(`${ORKA}/tasks/${run}?namespace=orka-system`, {waitFor: 'text=Result'});
      await h.page.getByText('Result', {exact: true}).first().click();
      await h.sleep(1500);
      await h.decorate();
      h.mark('start');
      await h.caption('The review run’s report, as the Task result', '“Nothing needs you.” 1 fixed, 0 declined; two optional nits for the author.', 'Result');
      await h.sleep(3000);
      await h.page.mouse.move(760, 500);
      for (let i = 0; i < 14; i++) {
        await h.page.mouse.wheel(0, 260);
        await h.sleep(700);
      }
      await h.sleep(2500);
      h.mark('schedule');
      await h.goto(`${ORKA}/tasks/dynamo-pr-shepherd-demo?namespace=orka-system`, {waitFor: 'text=Recent runs'});
      await h.spot('text=Recent runs');
      await h.caption('Three slots: problems, a review, then nothing new', 'The shepherd’s own fix didn’t start another review.', 'Orka');
      await h.sleep(5000);
      h.mark('end');
    },
  },
  // The review run's live log in the dashboard.
  'orka-review-live': {
    orkaAuth: true,
    async run(h) {
      const run = process.env.RUN || 'dynamo-pr-shepherd-demo-1794440400';
      await h.goto(`${ORKA}/tasks/${run}?namespace=orka-system`, {waitFor: 'text=Logs'});
      await h.page.getByText('Logs', {exact: true}).first().click();
      await h.sleep(1500);
      await h.decorate();
      h.mark('start');
      await h.caption('The next slot: “a review is due”, so a review run starts', 'Steps C (CodeRabbit), R (self-review) and S (review brief), in live mode for the sandbox.', 'Logs');
      await h.sleep(5000);
      await h.page.mouse.move(760, 500);
      for (let i = 0; i < 4; i++) {
        await h.page.mouse.wheel(0, 240);
        await h.sleep(1100);
      }
      await h.caption('It checks CodeRabbit’s claim on evidence, not plausibility', 'It reproduces the bug, reads Dynamo’s own review rubric, and runs the tests.', 'Logs');
      await h.sleep(6000);
      h.mark('end');
    },
  },
  // After the first demo run: rebased, re-signed, backed up, conflict gone.
  'pr-rebased': {
    async run(h) {
      await h.goto(PR, {waitFor: 'text=force-pushed'});
      await h.scrollTo('text=force-pushed', {at: 0.45, ms: 10});
      h.mark('start');
      await h.spot('text=force-pushed');
      await h.caption('Six minutes later: the shepherd rebased the PR and force-pushed it', '--force-with-lease on the old head, after a verified backup branch.', 'PR #11');
      await h.sleep(5000);
      await h.unspot();
      await h.page.mouse.move(640, 400);
      await h.page.mouse.wheel(0, 140);
      await h.sleep(1200);
      await h.caption('Both commits re-signed with the cluster’s SSH key (Verified)', 'The author’s messages and dates are kept, so the watch still counts them as the author’s work.', 'PR #11');
      await h.sleep(4500);
      h.mark('commit');
      await h.goto('https://github.com/Jont828/dynamo/commit/88d6e91', {waitFor: 'text=list quantity.py in the deploy/utils README'});
      await h.scrollTo('text=quantity.py` — parses Kubernetes CPU', {at: 0.55});
      await h.spot('text=quantity.py` — parses Kubernetes CPU');
      await h.caption('The conflict, resolved mechanically: both README lines kept', 'Validated with pre-commit and the PR’s tests before the push.', 'README.md');
      await h.sleep(5000);
      await h.unspot();
      h.mark('backup');
      await h.goto('https://github.com/Jont828/dynamo/branches/all?query=backup%2Forka-demo', {waitFor: 'text=backup/orka-demo/quantity-parser'});
      await h.spot('text=backup/orka-demo/quantity-parser');
      await h.caption('The old head stays on a backup branch', 'backup/<branch>-<time>: never rebase without a verified backup.', 'Branches');
      await h.sleep(4500);
      await h.unspot();
      h.mark('checks');
      await h.goto(`${PR}/checks`);
      await h.caption('Checks on the new head: green', 'The failed bot job was fork infrastructure (diagnosed in the report); it no longer runs.', 'Checks');
      await h.sleep(4500);
      h.mark('end');
    },
  },
  // Production, read-only: the live schedule in the dashboard and one of its review reports.
  'orka-prod': {
    orkaAuth: true,
    async run(h) {
      await h.goto(`${ORKA}/tasks/dynamo-pr-shepherd?namespace=orka-system`, {waitFor: 'text=Recent runs'});
      h.mark('start');
      await h.spot('text=Recent runs');
      await h.caption('Production: one scheduled Task, every 15 minutes', 'dynamo-pr-shepherd shepherds Jont828’s open PRs in ai-dynamo/dynamo. Forbid keeps runs from overlapping.', 'Orka');
      await h.sleep(5000);
      await h.unspot();
      h.mark('report');
      await h.goto(`${ORKA}/tasks/dynamo-pr-shepherd-1794437100?namespace=orka-system`, {waitFor: 'text=Result'});
      await h.page.getByText('Result', {exact: true}).first().click();
      await h.sleep(1500);
      await h.decorate();
      await h.caption('Each run’s report is the Task result', 'The 17:45 slot: “a review is due” for #18618, then the agent’s report.', 'Result');
      await h.sleep(4000);
      await h.page.mouse.move(760, 520);
      for (let i = 0; i < 10; i++) {
        await h.page.mouse.wheel(0, 300);
        await h.sleep(650);
      }
      await h.caption('Shadow mode: the review brief is written into the report, not posted', 'The user reads it before deciding to let the assistant post briefs on upstream PRs.', 'Result');
      for (let i = 0; i < 8; i++) {
        await h.page.mouse.wheel(0, 300);
        await h.sleep(650);
      }
      await h.sleep(2500);
      h.mark('end');
    },
  },
  // Production, read-only: what that run did on the real upstream PR.
  'upstream-prod': {
    async run(h) {
      await h.goto(`${UPSTREAM_PR}#discussion_r4544168982`, {waitFor: 'text=the command now passes'});
      await h.scrollTo('text=Make the example command runnable', {at: 0.12, ms: 10});
      h.mark('start');
      await h.caption('Upstream PR #18618: CodeRabbit asks for a runnable command', 'The 17:45 production run verified it, fixed it and answered in the thread.', 'ai-dynamo/dynamo');
      await h.sleep(4000);
      await h.scrollTo('text=the command now passes', {at: 0.35});
      await h.spot('text=the command now passes');
      await h.caption('“Fixed in 751587a”, posted by the shepherd as the author', 'CodeRabbit accepts the fix and resolves its own thread.', 'ai-dynamo/dynamo');
      await h.sleep(5500);
      await h.unspot();
      h.mark('commit');
      await h.goto('https://github.com/ai-dynamo/dynamo/commit/751587a', {waitFor: 'text=make the Slime test command safe to paste'});
      await h.spot('text=Automated-by: pr-shepherd');
      await h.caption('The fix commit: signed by the cluster’s key, with an Automated-by trailer', 'That trailer and signature are how the watch tells the shepherd’s commits from the author’s.', 'ai-dynamo/dynamo');
      await h.sleep(5500);
      h.mark('end');
    },
  },
  // The Orka dashboard while a demo run is going: the schedule, then the run's live log.
  'orka-run-live': {
    orkaAuth: true,
    async run(h) {
      const run = process.env.RUN || 'dynamo-pr-shepherd-demo-1794440100';
      await h.goto(`${ORKA}/tasks`, {waitFor: `text=${run}`});
      h.mark('start');
      await h.caption('The Orka dashboard: every slot is a Task', 'The demo schedule (*/5) and its first run sit next to the production runs (*/15).', 'Orka');
      await h.spot(`text=${run}`);
      await h.sleep(3500);
      await h.unspot();
      await h.page.getByText('dynamo-pr-shepherd-demo', {exact: true}).first().click();
      await h.page.getByText('Recent runs').first().waitFor({timeout: 15_000});
      await h.decorate();
      await h.spot('text=Recent runs');
      await h.caption('The schedule: cron */5, Forbid', 'Forbid means a new slot never starts while a run is still going.', 'Orka');
      await h.sleep(4500);
      await h.unspot();
      h.mark('run');
      await h.goto(`${ORKA}/tasks/${run}?namespace=orka-system`, {waitFor: 'text=Logs'});
      await h.page.getByText('Logs', {exact: true}).first().click();
      await h.sleep(1500);
      await h.decorate();
      await h.caption('The run, live: the gate’s verdict, then the agent at work', 'Copilot CLI (Claude Opus 5.5) follows the pr-shepherd skill inside the container.', 'Logs');
      await h.sleep(5000);
      await h.page.mouse.move(760, 520);
      for (let i = 0; i < 6; i++) {
        await h.page.mouse.wheel(0, 260);
        await h.sleep(900);
      }
      await h.sleep(3000);
      h.mark('end');
    },
  },
  // Main moves: a change lands on the base branch, and the PR now conflicts with it.
  'pr-conflict': {
    async run(h) {
      await h.goto('https://github.com/Jont828/dynamo/commit/5998863', {waitFor: 'text=list convert_api_version.py'});
      h.mark('start');
      await h.caption('Meanwhile, a change lands on the base branch', 'Like upstream main moving: it lists convert_api_version.py in the same README section.', 'orka-demo/base');
      await h.sleep(2500);
      await h.scrollTo('text=converts nvidia.com CRD manifests', {at: 0.45});
      await h.spot('text=converts nvidia.com CRD manifests');
      await h.sleep(4000);
      await h.unspot();
      h.mark('compare');
      await h.goto('https://github.com/Jont828/dynamo/compare/orka-demo/base...orka-demo/quantity-parser', {waitFor: "text=Can’t automatically merge"});
      await h.spot("text=Can’t automatically merge");
      await h.caption('Now the PR conflicts with its base', 'GitHub reports mergeable: CONFLICTING. Nobody has touched the PR.', 'PR #11');
      await h.sleep(4500);
      await h.unspot();
      await h.scrollTo('text=parses Kubernetes CPU and memory quantities', {at: 0.5, ms: 1600});
      await h.spot('text=parses Kubernetes CPU and memory quantities');
      await h.caption('Both sides add a line at the same spot', 'A mechanical conflict: the shepherd can resolve it without a design decision.', 'PR #11');
      await h.sleep(4500);
      h.mark('end');
    },
  },
  // The sandbox PR as the author left it: two signed commits, CodeRabbit's finding, and checks.
  'pr-before': {
    async run(h) {
      await h.goto(PR, {waitFor: 'text=Sandbox PR for an Orka demo'});
      h.mark('start');
      await h.caption('A sandbox PR inside the fork Jont828/dynamo', 'Base: orka-demo/base (a copy of upstream main). It never goes upstream.', 'PR #11');
      await h.sleep(3500);
      await h.spot('text=It follows Kubernetes semantics');
      await h.caption('The PR promises Kubernetes semantics', 'Binary suffixes are powers of 1024, decimal suffixes (k, M, G, T) powers of 1000.', 'PR #11');
      await h.scrollTo('text=It follows Kubernetes semantics', {at: 0.35});
      await h.sleep(3500);
      await h.unspot();
      await h.scrollTo('text=added 2 commits', {at: 0.3});
      await h.spot('text=added 2 commits');
      await h.caption('Two commits by the author, signed with the laptop key', 'One check failed: a Dynamo bot workflow that has no token in a fork.', 'PR #11');
      await h.sleep(4000);
      await h.unspot();
      await h.scrollTo('text=Use decimal multipliers for', {at: 0.45, ms: 2200});
      await h.spot('text=Use decimal multipliers for');
      await h.caption('CodeRabbit found a real bug: M and G use powers of 1024', 'parse_quantity("1M") returns 1048576, not 1000000. Nobody has answered it yet.', 'CodeRabbit');
      await h.sleep(5500);
      await h.unspot();
      h.mark('checks');
      await h.goto(`${PR}/checks`);
      await h.caption('Checks on the head commit', 'orka-demo-ci passes; the fork-only "ok-to-test" bot job fails.', 'Checks');
      await h.sleep(5000);
      h.mark('end');
    },
  },

  // Demo 3a, before: a new PR whose own tests fail in CI.
  'ci-ours-before': {
    async run(h) {
      const pr = 'https://github.com/Jont828/dynamo/pull/12';
      await h.goto(pr, {waitFor: 'text=Sandbox PR for an Orka demo'});
      h.mark('start');
      await h.caption('A new sandbox PR: a duration parser with its own tests', 'Jont828/dynamo#12 → orka-demo/base. One commit, signed by the author’s laptop key.', 'PR #12');
      await h.sleep(3000);
      await h.scrollTo('text=parse_duration("1h30m") == 5400', {at: 0.42});
      await h.spot('text=parse_duration("1h30m") == 5400');
      await h.caption('The PR says what the parser returns', 'Whole seconds: parse_duration("1h30m") == 5400. Its tests check exactly that.', 'PR #12');
      await h.sleep(5000);
      await h.unspot();
      h.mark('job');
      await h.goto('https://github.com/Jont828/dynamo/actions/runs/44195292437/job/134435028046', {waitFor: 'text=Annotations'});
      const step = h.page.getByText('Run the deploy/utils unit tests', {exact: true}).filter({visible: true}).first();
      await step.waitFor({timeout: 20_000});
      await h.scrollTo(step, {at: 0.45, ms: 1000});
      await h.spot(step);
      await h.caption('CI fails on the PR’s own tests', 'Three duration tests fail (2h, 1h30m, 1h0m5s); the other 32 pass.', 'orka-demo-ci');
      await h.sleep(6000);
      h.mark('end');
    },
  },

  // Demo 1 (step C): the review run's CodeRabbit half.
  'log-run2-c': logScene('dynamo-pr-shepherd-demo-1794440400', [
    {line: 'PR watch at Wed, Nov 11, 18:41 EST', tag: 'Gate', text: 'The gate: “a review is due”, so a review run starts', sub: 'PR #11’s head is new and quiet. This demo follows step C, CodeRabbit.'},
    {mark: 'work', line: 'One unresolved CodeRabbit thread', text: 'Step C: one CodeRabbit thread nobody answered', sub: 'It reads the PR’s code at head and the base diff before judging it.'},
    {line: 'finding still applies at head', text: 'Judged on evidence, not plausibility', sub: 'The claim holds at head: M and G use powers of 1024.'},
    {line: 'Now reproducing the CodeRabbit claim', text: 'It reproduces the bug before fixing it', sub: 'And probes edge cases against Kubernetes semantics.'},
    {line: 'Regression tests fail without the fix and pass with it', text: 'Regression tests: fail on the old code, pass with the fix', sub: 'Then pre-commit, then one signed, signed-off commit.'},
    {line: 'Now replying in the CodeRabbit thread and resolving it', text: 'Pushed, then it answers the thread with the commit', sub: 'And resolves it. CodeRabbit checks the fix on its own.'},
    {line: 'finding was right.', at: 0.2, text: 'The report says what it did, and why', sub: 'Every run’s report is the Orka Task’s result.', hold: 5200},
  ]),
  // Demo 4 (steps R and S): the same review run, its self-review and brief.
  'log-run2-rs': logScene('dynamo-pr-shepherd-demo-1794440400', [
    {line: 'PR watch at Wed, Nov 11, 18:41 EST', tag: 'Gate', text: 'The same review run, steps R and S', sub: 'R: a codeowner-style self-review. S: one brief for maintainers.'},
    {mark: 'work', line: 'read the review rubric from upstream/main', text: 'Step R: Dynamo’s own review rubric', sub: 'Read from the base branch (pr-checklist, review prompts), not from the PR’s copy.'},
    {line: 'Rubric read. Now checking test markers', text: 'What a codeowner would check', sub: 'Test markers, CI collection, and whether an existing parser already does this.'},
    {line: 'a fresh subagent will confirm the diff', text: 'A fresh subagent checks every fix', sub: 'It hasn’t seen the reasoning, and must confirm the diff fixes exactly the listed items.'},
    {line: '**CONFIRMED**', text: 'Confirmed: the change, the tests, nothing else', sub: 'Only then is the commit pushed.'},
    {line: 'Posting the review brief', text: 'Step S: the review brief', sub: 'One comment for maintainers, edited in place after each review.'},
    {line: '**Review totals:**', at: 0.25, text: 'The report counts every finding', sub: '1 fixed, 0 declined, 0 refuted, 0 pre-existing.'},
    {line: '**Optional nits for you**', at: 0.25, text: 'Low-stakes findings go to the author, not the PR', sub: 'Two optional nits, kept out of the brief.', hold: 5200},
  ]),
  // Demo 2 (step A): the first run's rebase.
  'log-run1-a': logScene('dynamo-pr-shepherd-demo-1794440100', [
    {line: 'PR watch at Wed, Nov 11, 18:35 EST', tag: 'Gate', text: 'The gate: a new merge conflict on #11', sub: 'A run scoped to the problems starts. The review waits until the conflict is gone.'},
    {mark: 'work', line: 'Backup verified. Rebasing onto', text: 'Backup first, verified on the fork', sub: 'The old head 4595c1b goes to backup/orka-demo/quantity-parser-20261111-1836.'},
    {line: 'Resolving by keeping both README lines', text: 'A mechanical conflict: both lines kept', sub: 'A conflict that needs a design call would be aborted and reported instead.'},
    {line: 'so the semantic check is a no-op', text: 'Then a semantic check', sub: 'Did main add files the PR’s change should also cover? Not here.'},
    {line: 'pre-commit and 13/13 tests pass', text: 'Validated, then pushed with a lease', sub: '--force-with-lease on the old head, never a plain --force.'},
    {line: 'PR is now CLEAN/MERGEABLE', text: 'Conflict gone: CLEAN and MERGEABLE', sub: 'The sandbox check passes on the new head.', hold: 5200},
  ]),
  // Demo 3c (step B): the first run's diagnosis of a fork-only bot job.
  'log-run1-b': logScene('dynamo-pr-shepherd-demo-1794440100', [
    {line: '1 failed check (1 new)', tag: 'Gate', text: 'The same run was also given a failed check', sub: '“Trigger CI Approval Flow / ok-to-test”, a Dynamo bot job.'},
    {mark: 'work', line: 'Both problems persist', text: 'Step B starts with the failing job’s log', sub: 'Then the PR’s diff against the base.'},
    {line: 'fork infrastructure (cause 3)', at: 0.25, text: 'Cause 3: infrastructure, High confidence', sub: 'GH_TOKEN is empty in a fork, so the bot job fails. It doesn’t test code.'},
    {line: 'Lint PR and Label PR all pass', at: 0.25, text: 'Reported, not “fixed”', sub: 'No commit for it. Upstream, a flake is reported as needing a maintainer rerun.', hold: 5200},
  ]),

  // Demo 3a: the run that fixed PR #12, walked through in the dashboard.
  'log-3a': logScene('dynamo-pr-shepherd-demo-1794957300', [
    {line: 'PR watch at Tue, Nov 17, 18:15 EST', tag: 'Gate', text: 'The gate: one new failed check on #12', sub: 'So this run gets step B for that PR only, and skips C–G.'},
    {mark: 'work', line: 'Reading the failed job log and the PR diff', text: 'Step B: the failing job’s log, then the PR’s diff', sub: 'Whose bug is it: this PR’s code, the base, or infrastructure?'},
    {line: 'Backup verified. Reproducing the failure locally', text: 'Backup first, then it reproduces the failure', sub: 'The old head goes to backup/orka-demo/duration-parser-20261117-1816.'},
    {line: 'Reproduced the same 3 failures', text: 'The PR’s own code (cause 1)', sub: '_UNIT_SECONDS["h"] was 360 instead of 3600.'},
    {line: 'CI-equivalent suite passes', text: 'The fix passes the same suite CI runs', sub: '35 passed, 4 skipped, as in CI. Then pre-commit.'},
    {line: 'Waiting for the new CI run to confirm', text: 'One signed CI-fix commit, pushed with a lease', sub: 'Then it waits for CI on the new head.'},
    {line: 'and the PR is now CLEAN', text: 'CI is green and the PR is CLEAN', sub: 'At most one CI-fix commit per PR per run; a repeat failure goes to the author.'},
    {line: 'own code. Confidence: High', at: 0.25, text: 'The report: cause, confidence, evidence', sub: 'Cause 1, High: the three failures match the bug exactly.', hold: 5200},
  ]),
  // Demo 3a, after: the shepherd's fix commit and green CI on PR #12.
  'ci-ours-after': {
    async run(h) {
      const pr = 'https://github.com/Jont828/dynamo/pull/12';
      await h.goto(pr, {waitFor: 'text=use 3600 seconds per hour'});
      await h.scrollTo('text=use 3600 seconds per hour', {at: 0.45, ms: 10});
      h.mark('start');
      await h.spot('text=use 3600 seconds per hour');
      await h.caption('A second commit on #12, by the shepherd', 'Verified with the cluster’s SSH key. The author’s commit is untouched.', 'PR #12');
      await h.sleep(5000);
      await h.unspot();
      h.mark('commit');
      await h.goto('https://github.com/Jont828/dynamo/commit/eb2c0f9', {waitFor: 'text=use 3600 seconds per hour'});
      await h.spot('text=Automated-by: pr-shepherd');
      await h.caption('The commit says what failed and why', 'Signed off, with an Automated-by trailer the gate uses to recognize its own commits.', 'Commit');
      await h.sleep(5000);
      await h.unspot();
      await h.scrollTo('text=_UNIT_SECONDS = {"h": 3600', {at: 0.45, ms: 1400});
      await h.spot('text=_UNIT_SECONDS = {"h": 3600');
      await h.caption('The fix: one line, 360 → 3600', 'Nothing else changed, so CI runs once more and the review stays small.', 'Commit');
      await h.sleep(5000);
      await h.unspot();
      h.mark('checks');
      await h.goto('https://github.com/Jont828/dynamo/actions/runs/44198375966/job/134445736400', {waitFor: 'text=Annotations'});
      const step = h.page.getByText('Run the deploy/utils unit tests', {exact: true}).filter({visible: true}).first();
      await step.waitFor({timeout: 20_000});
      await h.scrollTo(step, {at: 0.45, ms: 10});
      await h.spot(step);
      await h.caption('CI on the new head: green', 'The same check that failed before, on eb2c0f9.', 'orka-demo-ci');
      await h.sleep(5000);
      h.mark('end');
    },
  },

  // Demo 3b, before: a regression lands on the base, and a docs-only PR inherits a failing test.
  'ci-base-before': {
    async run(h) {
      await h.goto('https://github.com/Jont828/dynamo/commit/07a80bb', {waitFor: 'text=drop single-letter tokens'});
      h.mark('start');
      await h.caption('Meanwhile, a change lands on the base branch', '07a80bb stops quoting y and n in converted manifests. It looks like a harmless cleanup.', 'orka-demo/base');
      await h.sleep(3500);
      await h.scrollTo('text=yes/no/on/off', {at: 0.4, ms: 1400});
      await h.spot('text=yes/no/on/off');
      await h.caption('It’s a regression', 'go-yaml, which kubectl uses, reads y and n as booleans. A test covers exactly this.', 'orka-demo/base');
      await h.sleep(5000);
      await h.unspot();
      h.mark('pr');
      await h.goto('https://github.com/Jont828/dynamo/pull/13', {waitFor: 'text=Sandbox PR for an Orka demo'});
      await h.spot('text=Files changed');
      await h.caption('A docs-only PR, branched after that commit', '#13 adds a README section. It touches no code.', 'PR #13');
      await h.sleep(5000);
      await h.unspot();
      h.mark('job');
      await h.goto('https://github.com/Jont828/dynamo/actions/runs/44201113162/job/134455123658', {waitFor: 'text=Annotations'});
      const step = h.page.getByText('Run the deploy/utils unit tests', {exact: true}).filter({visible: true}).first();
      await step.waitFor({timeout: 20_000});
      await h.scrollTo(step, {at: 0.45, ms: 1000});
      await h.spot(step);
      await h.caption('CI fails anyway, on a test the PR never touched', 'test_dump_docs_quotes_yaml11_ambiguous_strings, in convert_api_version.py.', 'orka-demo-ci');
      await h.sleep(5500);
      h.mark('end');
    },
  },

  // Demo 3b: the fix lands on the base branch (after PR #13's CI already failed).
  'ci-base-fix': {
    async run(h) {
      await h.goto('https://github.com/Jont828/dynamo/commit/367a899', {waitFor: 'text=quote y and n again'});
      h.mark('start');
      await h.spot('text=quote y and n again in converted manifests');
      await h.caption('Then a fix lands on the base branch', '367a899 restores y and n. PR #13’s CI stays red: it tests the PR’s own head.', 'orka-demo/base');
      await h.sleep(5500);
      await h.unspot();
      h.mark('end');
    },
  },
  // Demo 3b: the run that rebased PR #13, walked through in the dashboard.
  'log-3b': logScene('dynamo-pr-shepherd-demo-1794959100', [
    {line: 'PR watch at Tue, Nov 17, 18:45 EST', tag: 'Gate', text: 'The gate: one new failed check on #13', sub: 'A docs-only PR. The run gets step B for it.'},
    {mark: 'work', line: 'not DIRTY. Reading the failed job log', text: 'Step B: the failing job’s log first', sub: 'Whose bug is it?'},
    {line: 'Likely a base problem', text: 'A README change can’t break dump_docs', sub: 'So it checks the base: the PR’s merge base, and what has landed since.'},
    {line: 'dropped single-letter tokens from', text: 'It finds the regression and the fix', sub: '07a80bb broke it; 367a899, after the PR’s merge base, restores it.'},
    {line: 'exactly reverts the breaking', text: 'Cause 2, a stale base: rebase, don’t patch', sub: 'Dynamo’s CI tests the PR’s head, so only a rebase brings the fix in.'},
    {line: 'Rebase was clean and the commit is re-signed', text: 'Backup, clean rebase, validation', sub: 'The author’s commit is re-signed; pre-commit and the tests pass.'},
    {line: 'and the PR is CLEAN/MERGEABLE', text: 'CI is green on the rebased head', sub: 'Nothing in the PR changed.'},
    {line: 'reverses it exactly', at: 0.25, text: 'The report cites the fixing commit', sub: 'Cause 2, High confidence, with the evidence.', hold: 5200},
  ]),
  // Demo 3b, after: PR #13 rebased onto the fix, CI green.
  'ci-base-after': {
    async run(h) {
      const pr = 'https://github.com/Jont828/dynamo/pull/13';
      await h.goto(pr, {waitFor: 'text=force-pushed'});
      await h.scrollTo('text=force-pushed', {at: 0.45, ms: 10});
      h.mark('start');
      await h.spot('text=force-pushed');
      await h.caption('Rebased onto the fix and force-pushed, with a lease', 'acb0ab8 → 2c2baf4, after a verified backup branch.', 'PR #13');
      await h.sleep(5000);
      await h.unspot();
      h.mark('checks');
      await h.goto('https://github.com/Jont828/dynamo/actions/runs/44202697841/job/134460597436', {waitFor: 'text=Annotations'});
      const step = h.page.getByText('Run the deploy/utils unit tests', {exact: true}).filter({visible: true}).first();
      await step.waitFor({timeout: 20_000});
      await h.scrollTo(step, {at: 0.45, ms: 10});
      await h.spot(step);
      await h.caption('CI on the rebased head: green', 'The same tests, now with the base’s fix underneath. The PR’s own change is untouched.', 'orka-demo-ci');
      await h.sleep(5000);
      await h.unspot();
      h.mark('backup');
      await h.goto('https://github.com/Jont828/dynamo/branches/all?query=backup%2Forka-demo%2Fpvc', {waitFor: 'text=backup/orka-demo/pvc-docs'});
      await h.spot('text=backup/orka-demo/pvc-docs-20261117-1846');
      await h.caption('The old head stays on a backup branch', 'backup/<branch>-<time>: it never rewrites a branch without one.', 'Branches');
      await h.sleep(4500);
      h.mark('end');
    },
  },

  // Wrap-up: production's 18:00 regular run (Nov 17), its report as the Task result.
  'prod-report': {
    orkaAuth: true,
    async run(h) {
      await h.goto(`${ORKA}/tasks/dynamo-pr-shepherd-1794956400?namespace=orka-system`, {waitFor: 'text=Result'});
      await h.page.getByText('Result', {exact: true}).first().click();
      await h.page.getByText('stacked on an old copy', {exact: false}).first().waitFor({timeout: 20_000});
      await h.sleep(800);
      await h.decorate();
      // The terminal skips what names or quotes reviewers; hide the same here.
      // This copy leaves out the reviewers' GitHub handles, so re-recording this scene stops at
      // the first redact() ("text not found") until the <reviewer-N> placeholders are filled in.
      await h.redact('<reviewer-1> and <reviewer-2>');
      await h.redact('**NEW (<reviewer-2>', 'removing the comment at', 'Reviewers’ names and comments hidden');
      await h.redact('<reviewer-3>');
      await h.spotLine('regular run for the Tue, Nov 17, 18:00 EST slot', {at: 0.18, ms: 10});
      h.mark('start');
      await h.caption('Production, every 2 hours: a regular run', 'Nov 17, 18:00: four open upstream PRs, all CI-green and waiting on review.', 'Result');
      await h.sleep(5000);
      await h.unspot();
      await h.spotLine('so no rebase or CI fix is', {at: 0.3});
      await h.caption('Nothing to rebase or fix, so it pushes nothing', 'The rest of the run is triage: threads, reviews, pings, age.', 'Result');
      await h.sleep(4500);
      await h.unspot();
      await h.spotLine('stacked on an old copy', {at: 0.3});
      await h.caption('It notices what a person would miss', 'A stacked PR is built on an old copy of its parent and lacks a prerequisite.', 'Result');
      await h.sleep(5000);
      await h.unspot();
      await h.spotLine('open 21 days', {at: 0.3});
      await h.caption('Nudges, with restraint', 'Four codeowner pings went unanswered; the last was under 3 business days ago, so no new one.', 'Result');
      await h.sleep(5500);
      await h.unspot();
      await h.spotLine('Pinged Nov 13, so no new ping', {at: 0.35});
      await h.caption('Every PR gets a one-line status', 'CI, threads, reviews, age, and why it did or didn’t act.', 'Result');
      await h.sleep(5000);
      h.mark('end');
    },
  },
};
