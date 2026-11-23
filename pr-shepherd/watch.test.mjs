// Offline tests for watch.mjs: node watch.test.mjs
// Each case runs watch.mjs in a child process that imports this file first. With
// WATCH_TEST_SCENARIO set, the import replaces fetch, Date and setTimeout with fakes.
import {spawnSync} from 'node:child_process';
import {appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const WATCH = join(dirname(SELF), 'watch.mjs');
const VAR = 'ORKA_PR_SHEPHERD_STATE';
const VARS = '/repos/Jont828/dynamo/actions/variables';

function installFakes(sc) {
  const NOW = Date.parse(sc.now);
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) {
      if (a.length) super(...a);
      else super(NOW);
    }
    static now() {
      return NOW;
    }
  };
  globalThis.setTimeout = (fn) => {
    queueMicrotask(fn);
    return 0;
  };
  let unknownLeft = sc.unknownPolls ?? 0;
  const reply = (status, obj) => new Response(obj === undefined ? null : JSON.stringify(obj), {status});
  // Like GitHub, return only the commit fields the query asks for.
  const asked = (q, commit) =>
    Object.fromEntries(Object.entries(commit).filter(([k]) => k === 'oid' || new RegExp(`\\b${k}\\b`).test(q)));
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    if (path === '/graphql') {
      const q = body.query;
      const pr = sc.prs.find((p) => p.number === body.variables.number);
      if (q.includes('search(')) return reply(200, {data: {search: {nodes: sc.prs}}});
      if (q.includes('history(')) {
        // A reviewed head's history: sc.history[oid] = [commit, ...] (newest first), or absent
        // if GitHub no longer has the commit. Served in pages of 100.
        appendFileSync(sc.historyLog, `${body.variables.oid} ${body.variables.after ?? '-'}\n`);
        const all = sc.history?.[body.variables.oid];
        if (!all) return reply(200, {data: {repository: {object: null}}});
        const from = body.variables.after ? Number(body.variables.after) : 0;
        const more = from + 100 < all.length;
        const nodes = all.slice(from, from + 100).map((c) => asked(q, c));
        const history = {pageInfo: {hasNextPage: more, endCursor: more ? String(from + 100) : null}, nodes};
        return reply(200, {data: {repository: {object: {history}}}});
      }
      if (q.includes('commits(first: 100')) {
        // The PR's commit list: sc.commits[number] = [commit, ...] (oldest first), served in
        // pages of sc.commitPage (default 100), or an HTTP error from sc.commitsHttp.
        appendFileSync(sc.commitLog, `${body.variables.number} ${body.variables.after ?? '-'}\n`);
        if (sc.commitsHttp) return reply(sc.commitsHttp, {message: 'Server Error'});
        const all = (sc.commits?.[body.variables.number] ?? []).map((commit) => ({commit: asked(q, commit)}));
        const size = sc.commitPage ?? 100;
        const from = body.variables.after ? Number(body.variables.after) : 0;
        const nodes = all.slice(from, from + size);
        const more = from + size < all.length;
        const commits = {totalCount: sc.commitTotal ?? all.length, pageInfo: {hasNextPage: more, endCursor: more ? String(from + size) : null}, nodes};
        return reply(200, {data: {repository: {pullRequest: {commits}}}});
      }
      if (q.includes('after:')) return reply(200, {data: {repository: {pullRequest: {commits: {nodes: [{commit: sc.page2}]}}}}});
      if (q.includes('commits(')) return reply(200, {data: {repository: {pullRequest: pr}}});
      const mergeable = unknownLeft-- > 0 ? 'UNKNOWN' : sc.mergeableAfter;
      return reply(200, {data: {repository: {pullRequest: {headRefOid: pr.headRefOid, mergeable}}}});
    }
    if (path === `${VARS}/${VAR}` && method === 'GET') {
      return sc.state ? reply(200, {name: VAR, value: JSON.stringify(sc.state)}) : reply(404, {message: 'Not Found'});
    }
    if ((path === VARS && method === 'POST') || (path === `${VARS}/${VAR}` && method === 'PATCH')) {
      if (sc.failWrite) return reply(403, {message: 'Resource not accessible by integration'});
      appendFileSync(sc.writeLog, `${JSON.stringify({method, value: JSON.parse(body.value)})}\n`);
      return method === 'POST' ? reply(201, {}) : new Response(null, {status: 204});
    }
    // A PR's comments (sc.comments[number], oldest first, paged like GitHub), its description
    // (sc.bodies[number]), and edits to that description (logged to sc.bodyLog).
    const issue = path.match(/^\/repos\/[^/]+\/[^/]+\/(issues|pulls)\/(\d+)(\/comments)?$/);
    if (issue?.[1] === 'issues' && issue[3] && method === 'GET') {
      const number = Number(issue[2]);
      const params = new URL(url).searchParams;
      const per = Number(params.get('per_page') ?? 30);
      const page = Number(params.get('page') ?? 1);
      appendFileSync(sc.commentLog, `${number} ${page}\n`);
      if (sc.commentsHttp) return reply(sc.commentsHttp, {message: 'Server Error'});
      return reply(200, (sc.comments?.[number] ?? []).slice((page - 1) * per, page * per));
    }
    if (issue?.[1] === 'pulls' && !issue[3] && method === 'GET') return reply(200, {number: Number(issue[2]), body: sc.bodies?.[issue[2]] ?? null});
    if (issue?.[1] === 'pulls' && !issue[3] && method === 'PATCH') {
      if (sc.failBodyWrite) return reply(403, {message: 'Resource not accessible by integration'});
      appendFileSync(sc.bodyLog, `${JSON.stringify({number: Number(issue[2]), body: body.body})}\n`);
      return reply(200, {number: Number(issue[2]), body: body.body});
    }
    return reply(500, {message: `no fake for ${method} ${path}`});
  };
}

// ---------- fixtures ----------

const HEAD = 'a'.repeat(40);
const NEW_HEAD = 'b'.repeat(40);
const OLD_HEAD = 'd'.repeat(40);
const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);
const C3 = '3'.repeat(40);
const SHEPHERD_KEY = 'SBKQSTrb8yvIuForFP77qqQ01yqZgtaUYzyMKCyNTgU'; // the default in watch.mjs
const AUTHOR_KEY = 'S1LeLtC5WVGjS+lVIa8qUjfxtoyY4KI6T5C5mHglQMM';
const sig = (fp) => (fp ? {keyFingerprint: fp} : null);
// An author's commit, the shepherd's fix commit, and a copy of a commit made by a rebase
// (same author date and message, new oid, signed by whoever rebased).
const mine = (oid, n, fp = AUTHOR_KEY) => ({
  oid,
  authoredDate: `2026-11-0${n}T10:00:00Z`,
  message: `docs: change ${n}\n\nSigned-off-by: Jonathan Tong`,
  additions: 10 * n,
  deletions: n,
  signature: sig(fp),
});
const fix = (oid, fp = SHEPHERD_KEY) => ({
  oid,
  authoredDate: '2026-11-10T23:00:00Z',
  message: 'fix: address review findings\n\nSigned-off-by: Jonathan Tong\nAutomated-by: pr-shepherd',
  additions: 5,
  deletions: 1,
  signature: sig(fp),
});
const copy = (oid, of, fp = SHEPHERD_KEY) => ({...of, oid, signature: sig(fp)});
const upstream = (n) => ({authoredDate: `2026-10-0${n}T09:00:00Z`, message: `upstream change ${n}`, additions: 3, deletions: 3});
const hist = (...commits) => commits.slice().reverse().map(({authoredDate, message, additions, deletions}) => ({authoredDate, message, additions, deletions}));
const run = (id, name, conclusion, completedAt, {status = 'COMPLETED', wf = 'CI'} = {}) => ({
  __typename: 'CheckRun',
  databaseId: id,
  name,
  status,
  conclusion: status === 'COMPLETED' ? conclusion : null,
  completedAt: status === 'COMPLETED' ? completedAt : null,
  detailsUrl: `https://github.com/ai-dynamo/dynamo/actions/runs/1/job/${id}`,
  checkSuite: {app: {slug: 'github-actions'}, workflowRun: {workflow: {name: wf}}},
});
const pr = ({
  number = 17372,
  head = HEAD,
  mergeable = 'MERGEABLE',
  contexts = [],
  more = false,
  isDraft = false,
  reviewDecision = 'REVIEW_REQUIRED',
  committedDate = '2026-11-10T17:00:00Z',
  headCommit = {authoredDate: committedDate, message: 'docs: head', signature: sig(AUTHOR_KEY)},
} = {}) => ({
  number,
  url: `https://github.com/ai-dynamo/dynamo/pull/${number}`,
  isDraft,
  headRefName: 'docs/examples-site-migration',
  headRefOid: head,
  mergeable,
  reviewDecision,
  commits: {
    nodes: [
      {commit: {...headCommit, oid: head, committedDate, statusCheckRollup: {contexts: {pageInfo: {hasNextPage: more, endCursor: more ? 'c1' : null}, nodes: contexts}}}},
    ],
  },
});
const green = [run(1, 'pre-commit', 'SUCCESS', '2026-11-10T17:12:00Z'), run(2, 'build', 'SUCCESS', '2026-11-10T17:40:00Z')];
const state = (prs, lastFullAt = '2026-11-11T01:00:00Z') => ({version: 1, lastFullAt, prs});
const seen = (extra = {}) => ({head: HEAD, conflictHandled: false, failuresHandled: [], ...extra});

// Times: November is UTC-5 in New York, and Nov 14 is a Saturday. 02:46Z = Tue 21:46 ET,
// 106 minutes after the 20:00 regular run, so past its make-up window; 17:00Z = Wed 12:00 ET.
const BETWEEN_RUNS = '2026-11-11T02:46:00Z';

// Fern docs preview comments (the Fern Docs workflow's, unless login says otherwise) and the
// block the watch keeps at the top of a description.
const FERN_A = 'https://nvidia-preview-01a1f683-6844-73de-904e-a2e3d7634105.docs.buildwithfern.com/dynamo/dev';
const FERN_B = 'https://nvidia-preview-01a1f0b9-3d1d-70d7-9d69-2dbfd2403c28.docs.buildwithfern.com/dynamo/dev';
let commentId = 7000;
const comment = (text, {login = 'github-actions[bot]', created = '2026-11-10T04:00:00Z', updated = created} = {}) => ({
  id: commentId++,
  user: {login, type: login.endsWith('[bot]') ? 'Bot' : 'User'},
  body: text,
  created_at: created,
  updated_at: updated,
});
const fernComment = (url, opts) => comment(`🌿 **Fern Docs Preview:** ${url}`, opts);
const fernBlock = (url) => `<!-- pr-shepherd:fern-preview:start -->\n## 🌿 [Fern docs preview](${url})\n<!-- pr-shepherd:fern-preview:end -->`;
const BODY = [
  '### Overview',
  '',
  'Adds the walkthrough. Closes #18000.',
  '',
  '<!-- This is an auto-generated comment: release notes by coderabbit.ai -->',
  '## Summary by CodeRabbit',
  '- Documentation',
  '<!-- end of auto-generated comment: release notes by coderabbit.ai -->',
].join('\n');

const cases = [
  {
    name: 'new conflict with no state starts a scoped run and records it',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: null},
    expect: {mode: 'watch', writes: 1, stdout: /new problems/, trigger: /merge conflict with its base branch/},
    check: (w) => w[0].method === 'POST' && w[0].value.prs[17372].conflictHandled === true && w[0].value.lastFullAt === '2026-11-11T01:00:00.000Z',
  },
  {
    name: 'conflict already given at this head does nothing',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: state({17372: seen({conflictHandled: true})})},
    expect: {mode: 'none', writes: 0, stdout: /already given to the shepherd at this head/},
  },
  {
    name: 'conflict on a new head starts a run',
    sc: {now: BETWEEN_RUNS, prs: [pr({head: NEW_HEAD, mergeable: 'CONFLICTING', contexts: green})], state: state({17372: seen({conflictHandled: true})})},
    expect: {mode: 'watch', writes: 1},
    check: (w) => w[0].method === 'PATCH' && w[0].value.prs[17372].head === NEW_HEAD,
  },
  {
    name: 'recent failure waits while CI is still running',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: [run(3, 'lint', 'FAILURE', '2026-11-11T02:30:00Z'), run(4, 'build', null, null, {status: 'IN_PROGRESS'})]})], state: state({})},
    expect: {mode: 'none', writes: 0, stdout: /1 failed check \(1 new\), 1 still running/},
  },
  {
    name: 'failure older than the stale limit starts a run while CI still runs',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: [run(3, 'lint', 'FAILURE', '2026-11-11T01:40:00Z'), run(4, 'build', null, null, {status: 'QUEUED'})]})], state: state({})},
    expect: {mode: 'watch', writes: 1, trigger: /1 other checks are still running/},
    check: (w) => w[0].value.prs[17372].failuresHandled.join() === 'run:3',
  },
  {
    name: 'failures after CI finished start a run',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: [...green, run(3, 'lint', 'FAILURE', '2026-11-11T02:40:00Z'), run(6, 'gpu test', 'CANCELLED', '2026-11-11T02:41:00Z')]})], state: state({})},
    expect: {mode: 'watch', writes: 1, trigger: /CI on this head has finished[\s\S]*CI \/ gpu test: CANCELLED[\s\S]*CI \/ lint: FAILURE/},
    check: (w) => w[0].value.prs[17372].failuresHandled.join() === 'run:3,run:6',
  },
  {
    name: 'failures already given do nothing',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: [...green, run(3, 'lint', 'FAILURE', '2026-11-11T02:40:00Z')]})], state: state({17372: seen({failuresHandled: ['run:3']})})},
    expect: {mode: 'none', writes: 0, stdout: /already given to the shepherd\)/},
  },
  {
    name: 'a rerun that passed hides the failure it replaced',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: [run(3, 'lint', 'FAILURE', '2026-11-11T01:00:00Z'), run(7, 'lint', 'SUCCESS', '2026-11-11T02:00:00Z')]})], state: state({})},
    expect: {mode: 'none', writes: 0, stdout: /CI passed \(1 checks\)/},
  },
  {
    name: 'a rerun that failed again starts a run',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: [run(3, 'lint', 'FAILURE', '2026-11-11T01:00:00Z'), run(7, 'lint', 'FAILURE', '2026-11-11T02:30:00Z')]})], state: state({17372: seen({failuresHandled: ['run:3']})})},
    expect: {mode: 'watch', writes: 1},
    check: (w) => w[0].value.prs[17372].failuresHandled.join() === 'run:7',
  },
  {
    name: 'same job name in two workflows counts as two checks',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: [run(3, 'changed-files', 'FAILURE', '2026-11-11T02:30:00Z', {wf: 'A'}), run(7, 'changed-files', 'SUCCESS', '2026-11-11T02:31:00Z', {wf: 'B'})]})], state: state({})},
    expect: {mode: 'watch', trigger: /A \/ changed-files: FAILURE/},
  },
  {
    name: 'failed commit status counts',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: [{__typename: 'StatusContext', context: 'ci/gitlab', state: 'ERROR', createdAt: '2026-11-11T02:00:00Z', targetUrl: 'https://example.invalid/1'}]})], state: state({})},
    expect: {mode: 'watch', trigger: /ci\/gitlab: ERROR/},
  },
  {
    name: 'checks past the first page are read',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({contexts: green, more: true})],
      page2: {oid: HEAD, statusCheckRollup: {contexts: {pageInfo: {hasNextPage: false, endCursor: null}, nodes: [run(9, 'late', 'FAILURE', '2026-11-11T02:00:00Z')]}}},
      state: state({}),
    },
    expect: {mode: 'watch', trigger: /CI \/ late: FAILURE/},
  },
  {
    name: 'unknown mergeability is asked again',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'UNKNOWN', contexts: green})], unknownPolls: 2, mergeableAfter: 'CONFLICTING', state: state({})},
    expect: {mode: 'watch', trigger: /merge conflict/},
  },
  {
    name: 'mergeability that stays unknown does not start a run',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'UNKNOWN', contexts: green})], unknownPolls: 99, mergeableAfter: 'CONFLICTING', state: state({})},
    expect: {mode: 'none', stdout: /not computed mergeability yet/},
  },
  {
    name: 'regular slot runs the full shepherd and records what it saw',
    sc: {now: '2026-11-11T17:00:20Z', prs: [pr({mergeable: 'CONFLICTING', contexts: [...green, run(3, 'lint', 'FAILURE', '2026-11-11T16:00:00Z')]})], state: state({})},
    expect: {mode: 'full', writes: 1, stdout: /regular run for the Wed, Nov 11, 12:00 EST slot/},
    check: (w) => {
      const v = w[0].value;
      return v.lastFullAt === '2026-11-11T17:00:20.000Z' && v.prs[17372].conflictHandled && v.prs[17372].failuresHandled.join() === 'run:3';
    },
  },
  {
    name: 'a regular slot skipped by Forbid is made up later',
    sc: {now: '2026-11-11T17:31:00Z', prs: [pr({contexts: green})], state: state({})},
    expect: {mode: 'full'},
  },
  {
    name: 'a regular slot is not made up after the make-up window',
    sc: {now: '2026-11-11T18:45:00Z', prs: [pr({contexts: green})], state: state({})},
    expect: {mode: 'none', writes: 0},
  },
  {
    name: 'a regular slot already run is not repeated',
    sc: {now: '2026-11-11T17:15:10Z', prs: [pr({contexts: green})], state: state({}, '2026-11-11T17:00:20Z')},
    expect: {mode: 'none', writes: 0},
  },
  {
    name: 'first run without state just after a regular slot assumes it already ran',
    sc: {now: '2026-11-11T17:15:10Z', prs: [pr({contexts: green})], state: null},
    expect: {mode: 'none', writes: 0},
  },
  {
    name: 'first run without state at a regular slot runs it',
    sc: {now: '2026-11-11T17:00:30Z', prs: [pr({contexts: green})], state: null},
    expect: {mode: 'full', writes: 1},
    check: (w) => w[0].method === 'POST',
  },
  {
    name: 'a regular run happens overnight on a weekend',
    sc: {now: '2026-11-14T07:00:10Z', prs: [pr({contexts: green})], state: state({}, '2026-11-14T05:00:20Z')},
    expect: {mode: 'full', writes: 1, stdout: /regular run for the Sat, Nov 14, 02:00 EST slot/},
  },
  {
    name: 'weekends can be left out of the regular runs',
    sc: {now: '2026-11-14T17:00:10Z', prs: [pr({contexts: green})], state: state({}, '2026-11-14T03:00:20Z')},
    env: {SHEPHERD_FULL_DAYS: '1,2,3,4,5'},
    expect: {mode: 'none', writes: 0},
  },
  {
    name: 'nights can be left out of the regular runs',
    sc: {now: '2026-11-11T07:00:10Z', prs: [pr({contexts: green})], state: state({}, '2026-11-11T01:00:20Z')},
    env: {SHEPHERD_FULL_HOURS: '12,14,16,18,20'},
    expect: {mode: 'none', writes: 0},
  },
  {
    name: 'summer time: 12:00 EDT is a regular slot',
    sc: {now: '2026-07-15T16:00:15Z', prs: [pr({contexts: green})], state: state({}, '2026-07-15T00:00:00Z')},
    expect: {mode: 'full', stdout: /12:00 EDT/},
  },
  {
    name: 'a scoped run names the next regular run, not the one already done in this slot',
    sc: {now: '2026-11-11T03:00:30Z', prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: state({}, '2026-11-11T03:00:10Z')},
    expect: {mode: 'watch', trigger: /The regular runs cover them; the next one is due at Wed, Nov 11, 00:00 EST\./},
  },
  {
    name: 'the next regular run follows the configured days and hours',
    sc: {now: '2026-11-14T02:46:00Z', prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: state({}, '2026-11-14T01:00:20Z')},
    env: {SHEPHERD_FULL_DAYS: '1,2,3,4,5', SHEPHERD_FULL_HOURS: '12,14,16,18,20'},
    expect: {mode: 'watch', trigger: /the next one is due at Mon, Nov 16, 12:00 EST\./},
  },
  {
    name: 'a scoped run that cannot be recorded does not start',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: state({}), failWrite: true},
    expect: {exit: 1, stderr: /could not record the trigger/},
  },
  {
    name: 'a regular run still starts when it cannot be recorded',
    sc: {now: '2026-11-11T17:00:20Z', prs: [pr({contexts: green})], state: state({}), failWrite: true},
    expect: {mode: 'full', stderr: /could not record the regular run/},
  },
  {
    name: 'read-only runs never write',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: null},
    env: {SHEPHERD_READ_ONLY: '1'},
    expect: {mode: 'watch', writes: 0},
  },
  {
    name: 'forced full run between regular slots',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({})},
    env: {SHEPHERD_MODE: 'full'},
    expect: {mode: 'full', writes: 1, stdout: /regular run \(forced\)/},
  },
  {
    name: 'check mode reports without writing or running',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: null},
    env: {SHEPHERD_MODE: 'check'},
    expect: {mode: 'none', writes: 0, stdout: /would start a run[\s\S]*Prompt section the run would get/},
  },
  {
    name: 'closed PRs drop out of the state',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: state({999: seen({head: 'c'.repeat(40)})})},
    expect: {mode: 'watch', writes: 1},
    check: (w) => Object.keys(w[0].value.prs).join() === '17372',
  },
  {
    name: 'only the triggering PR is recorded during a scoped run',
    sc: {
      now: BETWEEN_RUNS,
      prs: [
        pr({mergeable: 'CONFLICTING', contexts: green}),
        pr({number: 18000, head: NEW_HEAD, contexts: [run(3, 'lint', 'FAILURE', '2026-11-11T02:40:00Z'), run(4, 'build', null, null, {status: 'IN_PROGRESS'})]}),
      ],
      state: state({}),
    },
    expect: {mode: 'watch', trigger: /PR #17372/},
    check: (w) => w[0].value.prs[18000].failuresHandled.length === 0 && !/PR #18000/.test(w.trigger),
  },
  {
    name: 'no open PRs',
    sc: {now: BETWEEN_RUNS, prs: [], state: state({})},
    expect: {mode: 'none', stdout: /No open PRs by Jont828/},
  },

  // ---------- reviews (SHEPHERD_REVIEW=shadow|live) ----------
  {
    name: 'reviews are off by default: nothing about them is printed, queried or recorded',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: state({})},
    expect: {mode: 'watch', writes: 1, stdoutNot: /review/, triggerNot: /Review it|steps C, R and S/, commitQueries: 0, historyQueries: 0},
    check: (w) => !('reviewedHead' in w[0].value.prs[17372]),
  },
  {
    name: 'a quiet head that was never reviewed starts a full review and records it',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {
      mode: 'watch',
      writes: 1,
      commitQueries: 0,
      stdout: /a review is due, so the shepherd is starting a review run[\s\S]*CI passed \(2 checks\); review due \(full review\)/,
      trigger: /found reviews the shepherd[\s\S]*Review it \(steps C, R and S\): a full review of the PR\.[\s\S]*steps C, R and S \(CodeRabbit, self-review, and the review brief\) for a review[\s\S]*Skip steps D-G/,
      triggerNot: /Skip steps C-G/,
    },
    check: (w) => w[0].value.prs[17372].reviewedHead === HEAD && w[0].value.prs[17372].conflictHandled === false,
  },
  {
    name: 'live mode reviews the same way',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'live'},
    expect: {mode: 'watch', writes: 1, trigger: /a full review of the PR/},
  },
  {
    name: 'a head already reviewed is not reviewed again',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({17372: seen({reviewedHead: HEAD})})},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', writes: 0, commitQueries: 0, stdout: /nothing new[\s\S]*reviewed at this head/},
  },
  {
    name: 'a head newer than the quiet period waits',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green, committedDate: '2026-11-11T02:36:00Z'})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', writes: 0, stdout: /review waits until the head is 60 minutes old \(now 10\)/},
  },
  {
    name: 'the quiet period can be shortened',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green, committedDate: '2026-11-11T02:36:00Z'})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_REVIEW_QUIET_MINUTES: '5'},
    expect: {mode: 'watch', trigger: /a full review of the PR/},
  },
  {
    name: 'author commits after the reviewed head start a follow-up review',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(C1, 1), mine(OLD_HEAD, 2), fix(C2), mine(NEW_HEAD, 3)]},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {
      mode: 'watch',
      writes: 1,
      commitQueries: 1,
      commitPRs: '17372',
      historyQueries: 0,
      stdout: /review due \(follow-up since ddddddd\)/,
      trigger: new RegExp(`a follow-up review of the changes since \`${OLD_HEAD}\`, the last reviewed head`),
    },
    check: (w) => w[0].value.prs[17372].reviewedHead === NEW_HEAD,
  },
  {
    name: 'only the shepherd’s fixes since the reviewed head: no review',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(C1, 1), mine(OLD_HEAD, 2), fix(C2), fix(NEW_HEAD, `SHA256:${SHEPHERD_KEY}`)]},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', writes: 1, historyQueries: 0, stdout: /reviewed at ddddddd; since then only the shepherd's fixes, so this head counts as reviewed\n/},
    check: (w) => w[0].value.prs[17372].reviewedHead === NEW_HEAD && w[0].value.lastFullAt === '2026-11-11T01:00:00Z',
  },
  {
    name: 'check and read-only modes don’t record a head as reviewed',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(OLD_HEAD, 2), fix(NEW_HEAD)]},
    },
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_READ_ONLY: '1'},
    expect: {mode: 'none', writes: 0, stdout: /so this head counts as reviewed/},
  },
  {
    name: 'a head recorded as reviewed is not read again',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({head: NEW_HEAD, reviewedHead: NEW_HEAD})}),
      commits: {17372: [mine(OLD_HEAD, 2), fix(NEW_HEAD)]},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', writes: 0, commitQueries: 0, stdout: /reviewed at this head/},
  },
  {
    name: 'a head that can’t be recorded as reviewed doesn’t fail the slot',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(OLD_HEAD, 2), fix(NEW_HEAD)]},
      failWrite: true,
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', exit: 0, stderr: /could not record the reviewed heads/},
  },
  {
    name: 'a rebase by the shepherd with nothing new starts no review',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      // OLD_HEAD is the shepherd's fix, recorded as reviewed in an earlier slot.
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [copy(C1, mine(C1, 1)), copy(C2, mine(C2, 2)), copy(NEW_HEAD, fix(OLD_HEAD))]},
      history: {[OLD_HEAD]: hist(upstream(1), mine(C1, 1), mine(C2, 2), fix(OLD_HEAD))},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', writes: 1, historyQueries: 1, historyOids: OLD_HEAD, stdout: /since then only a rebase of those commits, so this head counts as reviewed/},
    check: (w) => w[0].value.prs[17372].reviewedHead === NEW_HEAD,
  },
  {
    name: 'a shepherd fix rebased before it was recorded as reviewed starts one review',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [copy(C1, mine(C1, 1)), copy(C2, mine(OLD_HEAD, 2)), copy(NEW_HEAD, fix(C3))]},
      history: {[OLD_HEAD]: hist(upstream(1), mine(C1, 1), mine(OLD_HEAD, 2))},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', trigger: /history was rewritten/},
  },
  {
    name: 'an amend that changes the code is reviewed, though it keeps the message and date',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [copy(C1, mine(C1, 1), AUTHOR_KEY), {...mine(NEW_HEAD, 2), additions: 99}]},
      history: {[OLD_HEAD]: hist(mine(C1, 1), mine(OLD_HEAD, 2))},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', trigger: /history was rewritten/},
  },
  {
    name: 'an amend of the shepherd’s fix that a later shepherd rebase re-signed is reviewed',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [copy(C1, mine(C1, 1)), copy(NEW_HEAD, {...fix(OLD_HEAD), additions: 40})]},
      history: {[OLD_HEAD]: hist(mine(C1, 1), fix(OLD_HEAD))},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', trigger: /history was rewritten/},
  },
  {
    name: 'author commits that a shepherd rebase re-signed are still reviewed',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      // The author pushed change 3 after the review; the shepherd rebased before reviewing it.
      commits: {17372: [copy(C1, mine(C1, 1)), copy(C2, mine(OLD_HEAD, 2)), copy(NEW_HEAD, mine(C3, 3))]},
      history: {[OLD_HEAD]: hist(upstream(1), mine(C1, 1), mine(OLD_HEAD, 2))},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', writes: 1, stdout: /review due \(history rewritten since ddddddd\)/, trigger: /history was rewritten since `d{40}`[\s\S]*git range-diff/},
    check: (w) => w[0].value.prs[17372].reviewedHead === NEW_HEAD,
  },
  {
    name: 'a rebase by the author with a new commit asks for a range-diff review',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [copy(C1, mine(C1, 1), AUTHOR_KEY), copy(C2, mine(OLD_HEAD, 2), AUTHOR_KEY), mine(NEW_HEAD, 3)]},
      history: {[OLD_HEAD]: hist(mine(C1, 1), mine(OLD_HEAD, 2))},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', trigger: /history was rewritten/},
  },
  {
    name: 'a rebase by the author with nothing new starts no review',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [copy(C1, mine(C1, 1), AUTHOR_KEY), copy(NEW_HEAD, mine(OLD_HEAD, 2), AUTHOR_KEY)]},
      history: {[OLD_HEAD]: hist(mine(C1, 1), mine(OLD_HEAD, 2))},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', stdout: /since then only a rebase of those commits/},
  },
  {
    name: 'a reworded commit keeps its author date but counts as new',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [copy(C1, mine(C1, 1), AUTHOR_KEY), {...mine(NEW_HEAD, 2), message: 'docs: change 2, reworded'}]},
      history: {[OLD_HEAD]: hist(mine(C1, 1), mine(OLD_HEAD, 2))},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', trigger: /history was rewritten/},
  },
  {
    name: 'a reviewed head GitHub no longer has: the rebased commits count as new',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [copy(C1, mine(C1, 1)), copy(NEW_HEAD, mine(OLD_HEAD, 2))]},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', historyQueries: 1, trigger: /history was rewritten/},
  },
  {
    name: 'history past the first page is read',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [copy(NEW_HEAD, mine(C1, 1))]},
      history: {[OLD_HEAD]: [...Array.from({length: 120}, (_, k) => ({authoredDate: `2026-10-01T00:00:${String(k % 60).padStart(2, '0')}Z`, message: `other ${k}`})), ...hist(mine(C1, 1))]},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', historyQueries: 2, stdout: /since then only a rebase of those commits/},
  },
  {
    name: 'an unsigned or GPG-signed commit with the trailer counts as the author’s',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green}), pr({number: 18000, head: C3, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD}), 18000: seen({head: C3, reviewedHead: C1})}),
      commits: {17372: [mine(OLD_HEAD, 2), fix(C2, null), fix(NEW_HEAD)], 18000: [mine(C1, 1), {...fix(C3), signature: {}}]},
    },
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_REVIEW_MAX_PER_RUN: '2'},
    expect: {mode: 'watch', stdout: /#17372[^\n]*follow-up[\s\S]*#18000[^\n]*follow-up/},
  },
  {
    name: 'a shepherd fix the author amended counts as the author’s',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(OLD_HEAD, 2), fix(NEW_HEAD, AUTHOR_KEY)]},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', trigger: /follow-up review/},
  },
  {
    name: 'a commit signed by the shepherd without its trailer counts as the author’s',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(OLD_HEAD, 2), {...fix(NEW_HEAD), message: 'docs: mentions Automated-by: pr-shepherd mid-line'}]},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', trigger: /follow-up review/},
  },
  {
    name: 'the shepherd key can be set, and the default key then counts as the author’s',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(OLD_HEAD, 2), fix(NEW_HEAD)]},
    },
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_SIGNING_FINGERPRINT: 'SHA256:other'},
    expect: {mode: 'watch', trigger: /follow-up review/},
  },
  {
    name: 'commits past the first page are read',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(C1, 1), mine(OLD_HEAD, 2), fix(C2), fix(NEW_HEAD)]},
      commitPage: 2,
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', commitQueries: 2, stdout: /since then only the shepherd's fixes/},
  },
  {
    name: 'a PR with more commits than GitHub lists is reviewed',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(OLD_HEAD, 2), fix(C2)]},
      commitTotal: 300,
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', trigger: /history was rewritten/},
  },
  {
    name: 'a PR with more commits than GitHub lists is not reviewed for the shepherd’s own fix',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green, headCommit: fix(NEW_HEAD)})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(OLD_HEAD, 2), fix(C2)]},
      commitTotal: 300,
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', stdout: /since then only the shepherd's fixes/},
  },
  {
    name: 'a head that moves while its commits are read waits',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, contexts: green})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
      commits: {17372: [mine(OLD_HEAD, 2), mine(C2, 3)]},
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', writes: 0, stdout: /review waits, because the head moved while its commits were read/},
  },
  {
    name: 'a commit list that GitHub fails to return waits for the next slot',
    sc: {now: BETWEEN_RUNS, prs: [pr({head: NEW_HEAD, contexts: green})], state: state({17372: seen({reviewedHead: OLD_HEAD})}), commitsHttp: 502},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', writes: 0, stdout: /review waits, because GitHub could not list its commits/, stderr: /could not read the commits since the last reviewed head ddddddd/},
  },
  {
    name: 'drafts and approved PRs are not reviewed',
    sc: {now: BETWEEN_RUNS, prs: [pr({isDraft: true, contexts: green}), pr({number: 18000, head: NEW_HEAD, reviewDecision: 'APPROVED', contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', writes: 0, stdout: /#17372 \(head aaaaaaa, draft\)[^\n]*not reviewed while it is a draft[\s\S]*#18000[^\n]*not reviewed, because it is approved/},
  },
  {
    name: 'a conflicting PR gets its rebase first and its review later',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', writes: 1, stdout: /new problems, so the shepherd[\s\S]*review waits until the merge conflict is resolved/, trigger: /Skip steps C-G/, triggerNot: /Review it/},
    check: (w) => !('reviewedHead' in w[0].value.prs[17372]),
  },
  {
    name: 'unknown mergeability makes a review wait',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'UNKNOWN', contexts: green})], unknownPolls: 99, mergeableAfter: 'UNKNOWN', state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'none', writes: 0, stdout: /review waits until GitHub has computed mergeability/},
  },
  {
    name: 'a review and failed checks start one run with both',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: [...green, run(3, 'lint', 'FAILURE', '2026-11-11T02:40:00Z')]})], state: state({})},
    env: {SHEPHERD_REVIEW: 'live'},
    expect: {
      mode: 'watch',
      writes: 1,
      stdout: /new problems, and a review is due, so the shepherd is starting a run scoped to them/,
      trigger: /found problems and reviews[\s\S]*CI \/ lint: FAILURE[\s\S]*a full review of the PR/,
    },
    check: (w) => w[0].value.prs[17372].reviewedHead === HEAD && w[0].value.prs[17372].failuresHandled.join() === 'run:3',
  },
  {
    name: 'one review per run: the oldest head goes first, and the other waits unrecorded',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({contexts: green, committedDate: '2026-11-10T20:00:00Z'}), pr({number: 18000, head: NEW_HEAD, contexts: green, committedDate: '2026-11-10T18:00:00Z'})],
      state: state({}),
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {
      mode: 'watch',
      writes: 1,
      stdout: /a review is due[\s\S]*#17372[^\n]*review due in a later slot \(1 per run\) \(full review\)[\s\S]*#18000[^\n]*review due \(full review\)/,
      trigger: /PR #18000[\s\S]*a full review/,
      triggerNot: /PR #17372/,
    },
    check: (w) => !('reviewedHead' in w[0].value.prs[17372]) && w[0].value.prs[18000].reviewedHead === NEW_HEAD,
  },
  {
    name: 'the per-run cap can be raised',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green}), pr({number: 18000, head: NEW_HEAD, contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_REVIEW_MAX_PER_RUN: '2'},
    expect: {mode: 'watch', stdout: /2 reviews are due/, trigger: /PR #17372[\s\S]*PR #18000/},
    check: (w) => w[0].value.prs[17372].reviewedHead === HEAD && w[0].value.prs[18000].reviewedHead === NEW_HEAD,
  },
  {
    name: 'a capped PR’s CI problem still runs, without its review',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({contexts: [...green, run(3, 'lint', 'FAILURE', '2026-11-11T02:40:00Z')], committedDate: '2026-11-10T20:00:00Z'}), pr({number: 18000, head: NEW_HEAD, contexts: green, committedDate: '2026-11-10T18:00:00Z'})],
      state: state({}),
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', trigger: /PR #17372[^\n]*\n  - These checks failed[\s\S]*lint: FAILURE[^\n]*\n- PR #18000[\s\S]*a full review/},
    check: (w) =>
      !/PR #17372[^]*Review it[^]*PR #18000/.test(w.trigger) &&
      !('reviewedHead' in w[0].value.prs[17372]) &&
      w[0].value.prs[17372].failuresHandled.join() === 'run:3' &&
      w[0].value.prs[18000].reviewedHead === NEW_HEAD,
  },
  {
    name: 'a review due at a regular slot waits for the next slot',
    sc: {now: '2026-11-11T17:00:20Z', prs: [pr({contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'full', writes: 1, stdout: /review due after this regular run \(full review\)/},
    check: (w) => !('reviewedHead' in w[0].value.prs[17372]),
  },
  {
    name: 'a regular run keeps the last reviewed head',
    sc: {now: '2026-11-11T17:00:20Z', prs: [pr({head: NEW_HEAD, contexts: green})], state: state({17372: seen({reviewedHead: OLD_HEAD})}), commits: {17372: [mine(OLD_HEAD, 2), mine(NEW_HEAD, 3)]}},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'full', writes: 1},
    check: (w) => w[0].value.prs[17372].reviewedHead === OLD_HEAD,
  },
  {
    name: 'the last reviewed head is kept when the head moves',
    sc: {now: BETWEEN_RUNS, prs: [pr({head: NEW_HEAD, mergeable: 'CONFLICTING', contexts: green})], state: state({17372: seen({reviewedHead: OLD_HEAD})})},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', writes: 1},
    check: (w) => w[0].value.prs[17372].reviewedHead === OLD_HEAD && w[0].value.prs[17372].head === NEW_HEAD,
  },
  {
    name: 'another PR’s run keeps this PR’s last reviewed head',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({contexts: green}), pr({number: 18000, head: NEW_HEAD, mergeable: 'CONFLICTING', contexts: green})],
      state: state({17372: seen({reviewedHead: HEAD})}),
    },
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {mode: 'watch', writes: 1, trigger: /PR #18000/, triggerNot: /PR #17372/},
    check: (w) => w[0].value.prs[17372].reviewedHead === HEAD,
  },
  {
    name: 'reviews off keeps a recorded reviewed head',
    sc: {now: BETWEEN_RUNS, prs: [pr({mergeable: 'CONFLICTING', contexts: green})], state: state({17372: seen({head: OLD_HEAD, reviewedHead: OLD_HEAD})})},
    expect: {mode: 'watch', writes: 1},
    check: (w) => w[0].value.prs[17372].reviewedHead === OLD_HEAD,
  },
  {
    name: 'a review that cannot be recorded does not start',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({}), failWrite: true},
    env: {SHEPHERD_REVIEW: 'shadow'},
    expect: {exit: 1, stderr: /could not record the trigger/},
  },
  {
    name: 'check mode shows the review it would start',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_MODE: 'check'},
    expect: {mode: 'none', writes: 0, stdout: /a review is due, so the shepherd would start a review run[\s\S]*Prompt section the run would get[\s\S]*a full review of the PR/},
  },
  {
    name: 'SHEPHERD_MODE=review reviews from scratch now, and read-only writes nothing',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({head: NEW_HEAD, mergeable: 'CONFLICTING', contexts: [...green, run(3, 'lint', 'FAILURE', '2026-11-11T02:40:00Z')], committedDate: '2026-11-11T02:45:00Z'})],
      state: state({17372: seen({reviewedHead: OLD_HEAD})}),
    },
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_MODE: 'review', SHEPHERD_READ_ONLY: '1'},
    expect: {
      mode: 'watch',
      writes: 0,
      commitQueries: 0,
      stdout: /review requested \(SHEPHERD_MODE=review\)/,
      trigger: /a full review of the PR/,
      triggerNot: /follow-up|rewritten|merge conflict with its base|lint: FAILURE/,
    },
  },
  {
    name: 'SHEPHERD_MODE=review never runs the regular shepherd',
    sc: {now: '2026-11-11T17:00:20Z', prs: [pr({contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'live', SHEPHERD_MODE: 'review'},
    expect: {mode: 'watch', writes: 1},
    check: (w) => w[0].value.prs[17372].reviewedHead === HEAD && w[0].value.lastFullAt === '2026-11-11T01:00:00Z',
  },
  {
    name: 'SHEPHERD_MODE=review keeps to the per-run cap',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green}), pr({number: 18000, head: NEW_HEAD, contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_MODE: 'review', SHEPHERD_READ_ONLY: '1'},
    expect: {mode: 'watch', trigger: /PR #17372/, triggerNot: /PR #18000/, stdout: /#18000[^\n]*review due in a later slot/},
  },
  {
    name: 'SHEPHERD_REVIEW_PRS picks the PRs a forced review covers',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green}), pr({number: 18000, head: NEW_HEAD, contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_MODE: 'review', SHEPHERD_REVIEW_PRS: '18000'},
    expect: {mode: 'watch', trigger: /PR #18000/, triggerNot: /PR #17372/, stdout: /#17372[^\n]*not in SHEPHERD_REVIEW_PRS/},
    check: (w) => w[0].value.prs[18000].reviewedHead === NEW_HEAD && !('reviewedHead' in w[0].value.prs[17372]),
  },
  {
    name: 'SHEPHERD_REVIEW_PRS accepts #numbers and spaces',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green}), pr({number: 18000, head: NEW_HEAD, contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_MODE: 'review', SHEPHERD_REVIEW_PRS: ' #18000 ', SHEPHERD_READ_ONLY: '1'},
    expect: {mode: 'watch', trigger: /PR #18000/, triggerNot: /PR #17372/},
  },
  {
    name: 'SHEPHERD_REVIEW_PRS that isn’t PR numbers is rejected',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_MODE: 'review', SHEPHERD_REVIEW_PRS: '18000 pr18001'},
    expect: {exit: 1, stderr: /SHEPHERD_REVIEW_PRS must list PR numbers/},
  },
  {
    name: 'SHEPHERD_MODE=review with nothing to review starts nothing',
    sc: {now: BETWEEN_RUNS, prs: [pr({isDraft: true, contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'shadow', SHEPHERD_MODE: 'review'},
    expect: {mode: 'none', writes: 0, stdout: /review requested, but no open PR can be reviewed/},
  },
  {
    name: 'SHEPHERD_MODE=review needs reviews turned on',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({})},
    env: {SHEPHERD_MODE: 'review'},
    expect: {exit: 1, stderr: /needs SHEPHERD_REVIEW=shadow or live/},
  },
  {
    name: 'an unknown SHEPHERD_REVIEW is rejected',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({})},
    env: {SHEPHERD_REVIEW: 'on'},
    expect: {exit: 1, stderr: /unknown SHEPHERD_REVIEW "on"/},
  },
  {
    name: 'fern: the preview link is added to the top of the description, and the rest is kept',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({contexts: green})],
      state: state({}),
      comments: {17372: [comment('LGTM', {login: 'a-reviewer'}), fernComment(FERN_A), comment('summary', {login: 'coderabbitai[bot]'})]},
      bodies: {17372: BODY},
    },
    expect: {mode: 'none', writes: 0, bodyWrites: 1, commentReads: 1, stdout: /#17372 \(head aaaaaaa\): no merge conflict; CI passed \(2 checks\); Fern docs preview link added to the top of the description/},
    bodyCheck: (b) => b[0].number === 17372 && b[0].body === `${fernBlock(FERN_A)}\n\n${BODY}`,
  },
  {
    name: 'fern: a newer preview replaces the link where it is',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({contexts: green})],
      state: state({}),
      comments: {17372: [fernComment(FERN_A, {created: '2026-11-10T04:00:00Z', updated: '2026-11-11T01:13:42Z'})]},
      bodies: {17372: `${BODY}\n\n${fernBlock(FERN_B)}\n\nMoved here by hand.`},
    },
    expect: {bodyWrites: 1, stdout: /Fern docs preview link updated in the description/},
    bodyCheck: (b) => b[0].body === `${BODY}\n\n${fernBlock(FERN_A)}\n\nMoved here by hand.`,
  },
  {
    name: 'fern: a description that already has the newest link is not edited',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({}), comments: {17372: [fernComment(FERN_A)]}, bodies: {17372: `${fernBlock(FERN_A)}\n\n${BODY}`}},
    expect: {mode: 'none', bodyWrites: 0, stdoutNot: /Fern/},
  },
  {
    name: 'fern: the most recently edited preview comment wins, and only the bot’s Fern links count',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({contexts: green})],
      state: state({}),
      comments: {
        17372: [
          fernComment(FERN_A, {created: '2026-11-10T04:00:00Z', updated: '2026-11-11T02:00:00Z'}),
          fernComment(FERN_B, {created: '2026-11-10T06:00:00Z'}),
          fernComment('https://someone-else.docs.buildwithfern.com/x', {login: 'Jont828', updated: '2026-11-11T02:30:00Z'}),
          fernComment('https://example.invalid/phish', {updated: '2026-11-11T02:40:00Z'}),
          comment('CI reminder', {updated: '2026-11-11T02:45:00Z'}),
        ],
      },
      bodies: {17372: BODY},
    },
    expect: {bodyWrites: 1},
    bodyCheck: (b) => b[0].body === `${fernBlock(FERN_A)}\n\n${BODY}`,
  },
  {
    name: 'fern: the link stops at characters that could end the Markdown link',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({contexts: green})],
      state: state({}),
      comments: {17372: [fernComment(`${FERN_A})](https://example.invalid) <b>x</b>.`)]},
      bodies: {17372: BODY},
    },
    expect: {bodyWrites: 1},
    bodyCheck: (b) => b[0].body === `${fernBlock(FERN_A)}\n\n${BODY}`,
  },
  {
    name: 'fern: each PR gets its own link, and a PR without a preview is left alone',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({contexts: green}), pr({number: 18569, contexts: green}), pr({number: 18618, contexts: green})],
      state: state({}),
      comments: {17372: [fernComment(FERN_A)], 18569: [fernComment(FERN_B)], 18618: [comment('summary', {login: 'coderabbitai[bot]'})]},
      bodies: {17372: BODY, 18569: 'Docs.', 18618: 'Tests.'},
    },
    expect: {bodyWrites: 2, commentReads: 3, stdout: /#18618 \(head aaaaaaa\): no merge conflict; CI passed \(2 checks\)\n/},
    bodyCheck: (b) =>
      b.length === 2 && b[0].number === 17372 && b[0].body.includes(FERN_A) && b[1].number === 18569 && b[1].body === `${fernBlock(FERN_B)}\n\nDocs.`,
  },
  {
    name: 'fern: comments past the first page are read',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({contexts: green})],
      state: state({}),
      comments: {17372: [...Array.from({length: 100}, (_, i) => comment(`comment ${i}`, {login: 'a-reviewer'})), fernComment(FERN_A)]},
      bodies: {17372: BODY},
    },
    expect: {bodyWrites: 1, commentReads: 2},
  },
  {
    name: 'fern: an empty description becomes just the link',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({}), comments: {17372: [fernComment(FERN_A)]}, bodies: {17372: null}},
    expect: {bodyWrites: 1},
    bodyCheck: (b) => b[0].body === fernBlock(FERN_A),
  },
  {
    name: 'fern: a description with Windows line endings keeps them',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({}), comments: {17372: [fernComment(FERN_A)]}, bodies: {17372: 'Line one\r\nLine two'}},
    expect: {bodyWrites: 1},
    bodyCheck: (b) => b[0].body === `${fernBlock(FERN_A).replaceAll('\n', '\r\n')}\r\n\r\nLine one\r\nLine two`,
  },
  {
    name: 'fern: check mode says what it would change and changes nothing',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({}), comments: {17372: [fernComment(FERN_A)]}, bodies: {17372: BODY}},
    env: {SHEPHERD_MODE: 'check'},
    expect: {mode: 'none', bodyWrites: 0, stdout: /Fern docs preview link would be added to the top of the description/},
  },
  {
    name: 'fern: read-only runs never edit a description',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({}), comments: {17372: [fernComment(FERN_A)]}, bodies: {17372: `${fernBlock(FERN_B)}\n\n${BODY}`}},
    env: {SHEPHERD_READ_ONLY: '1'},
    expect: {bodyWrites: 0, stdout: /Fern docs preview link would be updated in the description/},
  },
  {
    name: 'fern: SHEPHERD_FERN_PREVIEW=off reads no comments and edits nothing',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({}), comments: {17372: [fernComment(FERN_A)]}, bodies: {17372: BODY}},
    env: {SHEPHERD_FERN_PREVIEW: 'off'},
    expect: {mode: 'none', bodyWrites: 0, commentReads: 0, stdoutNot: /Fern/},
  },
  {
    name: 'fern: a description that can’t be edited doesn’t stop the slot',
    sc: {
      now: BETWEEN_RUNS,
      prs: [pr({mergeable: 'CONFLICTING', contexts: green})],
      state: state({}),
      comments: {17372: [fernComment(FERN_A)]},
      bodies: {17372: BODY},
      failBodyWrite: true,
    },
    expect: {mode: 'watch', writes: 1, bodyWrites: 0, stdout: /Fern docs preview link not updated/, stderr: /#17372: could not update the Fern docs preview link: PATCH .*HTTP 403/},
  },
  {
    name: 'fern: comments that can’t be read don’t stop the slot',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({}), comments: {17372: [fernComment(FERN_A)]}, bodies: {17372: BODY}, commentsHttp: 502},
    expect: {mode: 'none', bodyWrites: 0, stdout: /Fern docs preview link not updated/, stderr: /could not update the Fern docs preview link: GET .*HTTP 502/},
  },
  {
    name: 'fern: an unknown SHEPHERD_FERN_PREVIEW is rejected',
    sc: {now: BETWEEN_RUNS, prs: [pr({contexts: green})], state: state({})},
    env: {SHEPHERD_FERN_PREVIEW: 'yes'},
    expect: {exit: 1, stderr: /unknown SHEPHERD_FERN_PREVIEW "yes"/},
  },
];

function runAll() {
  let failed = 0;
  for (const c of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'watch-test-'));
    const writeLog = join(dir, 'writes.jsonl');
    const commitLog = join(dir, 'commit-queries.log');
    const historyLog = join(dir, 'history-queries.log');
    const bodyLog = join(dir, 'body-writes.jsonl');
    const commentLog = join(dir, 'comment-reads.log');
    const scenario = join(dir, 'scenario.json');
    writeFileSync(scenario, JSON.stringify({...c.sc, writeLog, commitLog, historyLog, bodyLog, commentLog}));
    const res = spawnSync(process.execPath, ['--import', SELF, WATCH], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        TZ: 'America/New_York',
        GH_TOKEN: 'test-token',
        SHEPHERD_OUT_DIR: join(dir, 'out'),
        WATCH_TEST_SCENARIO: scenario,
        ...c.env,
      },
    });
    const modeFile = join(dir, 'out', 'mode');
    const mode = existsSync(modeFile) ? readFileSync(modeFile, 'utf8') : null;
    const trigger = existsSync(join(dir, 'out', 'trigger.md')) ? readFileSync(join(dir, 'out', 'trigger.md'), 'utf8') : '';
    const writes = existsSync(writeLog) ? readFileSync(writeLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    writes.trigger = trigger;
    const commitQueries = existsSync(commitLog) ? readFileSync(commitLog, 'utf8').trim().split('\n') : [];
    const historyQueries = existsSync(historyLog) ? readFileSync(historyLog, 'utf8').trim().split('\n') : [];
    const bodyWrites = existsSync(bodyLog) ? readFileSync(bodyLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    const commentReads = existsSync(commentLog) ? readFileSync(commentLog, 'utf8').trim().split('\n') : [];
    const e = c.expect;
    const problems = [];
    if (res.status !== (e.exit ?? 0)) problems.push(`exit ${res.status}, want ${e.exit ?? 0}`);
    if (e.mode && mode !== e.mode) problems.push(`mode ${mode}, want ${e.mode}`);
    if (e.writes !== undefined && writes.length !== e.writes) problems.push(`${writes.length} writes, want ${e.writes}`);
    if (e.commitQueries !== undefined && commitQueries.length !== e.commitQueries) problems.push(`${commitQueries.length} commit-list queries, want ${e.commitQueries}`);
    const commitPRs = [...new Set(commitQueries.map((l) => l.split(' ')[0]))].join();
    if (e.historyQueries !== undefined && historyQueries.length !== e.historyQueries) problems.push(`${historyQueries.length} history queries, want ${e.historyQueries}`);
    const historyOids = [...new Set(historyQueries.map((l) => l.split(' ')[0]))].join();
    if (e.historyOids !== undefined && historyOids !== e.historyOids) problems.push(`history read for "${historyOids}", want "${e.historyOids}"`);
    if (e.commitPRs !== undefined && commitPRs !== e.commitPRs) problems.push(`commit lists read for PRs "${commitPRs}", want "${e.commitPRs}"`);
    if (e.stdout && !e.stdout.test(res.stdout)) problems.push(`stdout does not match ${e.stdout}`);
    if (e.stdoutNot && e.stdoutNot.test(res.stdout)) problems.push(`stdout matches ${e.stdoutNot}`);
    if (e.stderr && !e.stderr.test(res.stderr)) problems.push(`stderr does not match ${e.stderr}`);
    if (e.trigger && !e.trigger.test(trigger)) problems.push(`trigger.md does not match ${e.trigger}`);
    if (e.triggerNot && e.triggerNot.test(trigger)) problems.push(`trigger.md matches ${e.triggerNot}`);
    if (c.check && !(writes.length && c.check(writes))) problems.push('state check failed');
    if (e.bodyWrites !== undefined && bodyWrites.length !== e.bodyWrites) problems.push(`${bodyWrites.length} description edits, want ${e.bodyWrites}`);
    if (e.commentReads !== undefined && commentReads.length !== e.commentReads) problems.push(`${commentReads.length} comment-page reads, want ${e.commentReads}`);
    if (c.bodyCheck && !(bodyWrites.length && c.bodyCheck(bodyWrites))) problems.push(`description check failed: ${JSON.stringify(bodyWrites)}`);
    if (/test-token/.test(res.stdout + res.stderr + trigger)) problems.push('token leaked into output');
    if (problems.length) {
      failed++;
      console.log(`FAIL ${c.name}\n  ${problems.join('\n  ')}\n  stdout: ${res.stdout.trim().replace(/\n/g, '\n          ')}\n  stderr: ${res.stderr.trim()}`);
    } else console.log(`ok   ${c.name}`);
    rmSync(dir, {recursive: true, force: true});
  }
  console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nall ${cases.length} passed`);
  process.exitCode = failed ? 1 : 0;
}

if (process.env.WATCH_TEST_SCENARIO) installFakes(JSON.parse(readFileSync(process.env.WATCH_TEST_SCENARIO, 'utf8')));
else runAll();
