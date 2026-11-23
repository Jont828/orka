// PR watch gate for the dynamo PR shepherd.
//
// Runs first in every slot of the scheduled Orka Task (every 15 minutes), before any tool
// install, using only Node built-ins. It picks what this slot does:
//   full   a regular run is due (by default every 2 hours on the even hour, every day)
//   watch  an open PR has a merge conflict at a head the shepherd hasn't been given, or
//          failed checks it hasn't been given, once that head's CI has finished, or (with
//          SHEPHERD_REVIEW on) a head that needs a review: one with commits the shepherd
//          didn't sign since the last review, untouched for a quiet period
//   none   nothing new, so the slot ends in seconds
// What the shepherd has already been given is kept in an Actions variable on the fork, so
// one problem starts one run, not one run per slot.
// Whatever the slot does, it also keeps a link to each PR's newest Fern docs preview at the
// top of the PR's description (see syncFernPreviews).
//
// Writes $SHEPHERD_OUT_DIR/mode (none|full|watch) and, for watch, trigger.md (the prompt
// section that scopes the run). The summary on stdout starts the Task result.

import {mkdirSync, writeFileSync} from 'node:fs';
import {hostname} from 'node:os';
import {join} from 'node:path';

const env = process.env;
const list = (s) => s.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x));
const num = (s, dflt) => (s && Number.isFinite(Number(s)) ? Number(s) : dflt);
// "18569, #18570" -> [18569, 18570]. Anything else is an error, so a typo can't widen a review.
function prNumbers(s) {
  const parts = String(s ?? '').split(/[\s,]+/).filter(Boolean);
  const out = parts.map((p) => Number(p.replace(/^#/, '')));
  if (out.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error(`SHEPHERD_REVIEW_PRS must list PR numbers, not "${s}"`);
  return out;
}

const cfg = {
  token: env.GH_TOKEN,
  mode: (env.SHEPHERD_MODE || 'auto').toLowerCase(), // auto | full | review | check
  readOnly: env.SHEPHERD_READ_ONLY === '1',
  repo: env.SHEPHERD_REPO || 'ai-dynamo/dynamo',
  author: env.SHEPHERD_AUTHOR || 'Jont828',
  stateRepo: env.SHEPHERD_STATE_REPO || 'Jont828/dynamo',
  stateVar: env.SHEPHERD_STATE_VAR || 'ORKA_PR_SHEPHERD_STATE',
  tz: env.TZ || 'America/New_York',
  // Regular runs start at :00 of these local hours on these ISO weekdays (Monday = 1).
  fullDays: list(env.SHEPHERD_FULL_DAYS || '1,2,3,4,5,6,7'),
  fullHours: list(env.SHEPHERD_FULL_HOURS || '0,2,4,6,8,10,12,14,16,18,20,22'),
  // A regular run that Forbid skipped (another run was still going) is made up by a
  // later slot within this many minutes.
  fullMakeupMinutes: num(env.SHEPHERD_FULL_MAKEUP_MINUTES, 90),
  // Failed checks wait for the head's CI to finish, unless they are at least this old.
  ciStaleMinutes: num(env.SHEPHERD_CI_STALE_MINUTES, 60),
  // Review runs (steps C, R and S of the skill): off | shadow | live. The gate only needs to
  // know whether they're on; the rendered prompt tells the agent which mode it's in.
  review: (env.SHEPHERD_REVIEW || 'off').toLowerCase(),
  // A head is reviewed once its newest commit is at least this old, so work in progress
  // that is still being pushed isn't reviewed.
  reviewQuietMinutes: num(env.SHEPHERD_REVIEW_QUIET_MINUTES, 60),
  // At most this many PRs are reviewed in one run, so a run stays well inside its time
  // limit. The others wait for a later slot.
  reviewMaxPerRun: Math.max(1, num(env.SHEPHERD_REVIEW_MAX_PER_RUN, 1)),
  // With SHEPHERD_MODE=review, review only these PR numbers (default: every eligible PR).
  reviewPRs: prNumbers(env.SHEPHERD_REVIEW_PRS),
  // The SSH key fingerprint (SHA256, base64) of the shepherd's signing key, which only the
  // cluster has. See isShepherdFix.
  signingFingerprint: (env.SHEPHERD_SIGNING_FINGERPRINT || 'SBKQSTrb8yvIuForFP77qqQ01yqZgtaUYzyMKCyNTgU').replace(/^SHA256:/, ''),
  // Keep the newest Fern docs preview link at the top of each PR's description: on | off.
  fernPreview: (env.SHEPHERD_FERN_PREVIEW || 'on').toLowerCase(),
  outDir: env.SHEPHERD_OUT_DIR || '/tmp/watch',
};
const AUTOMATED_TRAILER = /^Automated-by: pr-shepherd\s*$/m;

const SLOT_MS = 15 * 60_000;
const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE']);
const FAILED_STATES = new Set(['FAILURE', 'ERROR']);
const WEEKDAYS = {Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => process.stderr.write(`[watch] ${msg}\n`);
const short = (sha) => (sha || '').slice(0, 7);
const clean = (s) => String(s ?? '').replace(/[\r\n`]+/g, ' ').trim();

// ---------- GitHub ----------

async function gh(path, {method = 'GET', body, allow404 = false} = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'orka-pr-shepherd-watch',
          ...(body ? {'Content-Type': 'application/json'} : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt < 3) {
        await sleep(2000 * attempt);
        continue;
      }
      throw new Error(`${method} ${path}: ${err.message}`);
    }
    if (res.status === 404 && allow404) return null;
    if ((res.status >= 500 || res.status === 429) && attempt < 3) {
      await sleep(2000 * attempt);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }
}

async function graphql(query, variables) {
  const res = await gh('/graphql', {method: 'POST', body: {query, variables}});
  if (res.errors?.length) throw new Error(`GraphQL: ${res.errors.map((e) => e.message).join('; ')}`);
  return res.data;
}

const CONTEXTS = `
  pageInfo { hasNextPage endCursor }
  nodes {
    __typename
    ... on CheckRun {
      databaseId name status conclusion completedAt detailsUrl
      checkSuite { app { slug } workflowRun { workflow { name } } }
    }
    ... on StatusContext { context state createdAt targetUrl }
  }`;

// What tells the shepherd's own commits and rebased copies apart (see isShepherdFix).
const COMMIT_ID = 'oid authoredDate message additions deletions signature { ... on SshSignature { keyFingerprint } }';

// The shepherd's own work: a commit signed with its key that carries its trailer. When the
// shepherd rebases, it re-signs the author's commits too, but those copies keep their own
// message, so they still count as the author's. A commit the author amends is re-signed
// with the author's key.
const isShepherdFix = (c) =>
  (c.signature?.keyFingerprint ?? '').replace(/^SHA256:/, '') === cfg.signingFingerprint && AUTOMATED_TRAILER.test(c.message ?? '');
// A rebase keeps a commit's author date, message and (unless it resolved a conflict) line
// counts, so this matches a commit to its copies. An amend that changes the code usually
// changes the line counts too.
const copyKey = (c) => `${c.authoredDate}\n${c.additions}/${c.deletions}\n${c.message}`;

const PR_FIELDS = `
  number url isDraft headRefName headRefOid mergeable reviewDecision
  commits(last: 1) { nodes { commit { ${COMMIT_ID} committedDate statusCheckRollup { contexts(first: 100) { ${CONTEXTS} } } } } }`;

const [owner, name] = cfg.repo.split('/');

async function fetchPR(number) {
  const data = await graphql(
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${PR_FIELDS} } } }`,
    {owner, name, number},
  );
  return data.repository.pullRequest;
}

async function moreContexts(number, after) {
  const data = await graphql(
    `query($owner: String!, $name: String!, $number: Int!, $after: String!) {
      repository(owner: $owner, name: $name) { pullRequest(number: $number) {
        commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100, after: $after) { ${CONTEXTS} } } } } } } } }`,
    {owner, name, number, after},
  );
  const commit = data.repository.pullRequest.commits.nodes[0]?.commit;
  return {oid: commit?.oid, page: commit?.statusCheckRollup?.contexts};
}

// Returns {number, url, isDraft, branch, head, headCommittedAt, reviewDecision, mergeable,
// checks} with every check context of the head commit, or null if the head moved while it
// was being read.
async function completePR(raw) {
  const commit = raw.commits.nodes[0]?.commit;
  if (!commit || commit.oid !== raw.headRefOid) return null;
  const contexts = [...(commit.statusCheckRollup?.contexts.nodes ?? [])];
  let page = commit.statusCheckRollup?.contexts.pageInfo;
  while (page?.hasNextPage) {
    const next = await moreContexts(raw.number, page.endCursor);
    if (next.oid !== raw.headRefOid) return null;
    contexts.push(...(next.page?.nodes ?? []));
    page = next.page?.pageInfo;
  }
  let mergeable = raw.mergeable;
  // GitHub computes mergeability in the background after main moves, so ask again.
  for (let i = 0; mergeable === 'UNKNOWN' && i < 5; i++) {
    await sleep(5000);
    const data = await graphql(
      `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid mergeable } } }`,
      {owner, name, number: raw.number},
    );
    if (data.repository.pullRequest.headRefOid !== raw.headRefOid) return null;
    mergeable = data.repository.pullRequest.mergeable;
  }
  return {
    number: raw.number,
    url: raw.url,
    isDraft: raw.isDraft,
    branch: raw.headRefName,
    head: raw.headRefOid,
    headCommittedAt: commit.committedDate,
    headIsShepherdFix: isShepherdFix(commit),
    reviewDecision: raw.reviewDecision,
    mergeable,
    checks: summarizeChecks(contexts),
  };
}

// The PR's commits, oldest first, and the PR's commit count (GitHub lists at most 250).
async function prCommits(number) {
  const commits = [];
  for (let after = null; ; ) {
    const data = await graphql(
      `query($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) {
          commits(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor }
            nodes { commit { ${COMMIT_ID} } } } } } }`,
      {owner, name, number, after},
    );
    const page = data.repository.pullRequest.commits;
    commits.push(...page.nodes.map((n) => n.commit));
    if (!page.pageInfo.hasNextPage) return {commits, total: page.totalCount};
    after = page.pageInfo.endCursor;
  }
}

// copyKey of each commit in a head's history, newest first, as far back as 250 commits. An
// empty set if GitHub no longer has the commit.
async function historyKeys(oid) {
  const keys = new Set();
  for (let after = null, pages = 0; pages < 3; pages++) {
    const data = await graphql(
      `query($owner: String!, $name: String!, $oid: GitObjectID!, $after: String) {
        repository(owner: $owner, name: $name) { object(oid: $oid) { ... on Commit {
          history(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { authoredDate message additions deletions } } } } } }`,
      {owner, name, oid, after},
    );
    const history = data.repository.object?.history;
    if (!history) break;
    for (const c of history.nodes) keys.add(copyKey(c));
    if (!history.pageInfo.hasNextPage) break;
    after = history.pageInfo.endCursor;
  }
  return keys;
}

async function listPRs() {
  const q = `repo:${cfg.repo} is:pr is:open author:${cfg.author}`;
  const data = await graphql(
    `query($q: String!) { search(query: $q, type: ISSUE, first: 50) {
      nodes { ... on PullRequest { ${PR_FIELDS} } } } }`,
    {q},
  );
  const prs = [];
  for (const raw of data.search.nodes.filter((n) => n?.number)) {
    let pr = await completePR(raw);
    for (let i = 0; !pr && i < 2; i++) pr = await completePR(await fetchPR(raw.number));
    if (!pr) throw new Error(`#${raw.number}: the head kept moving while its checks were read`);
    prs.push(pr);
  }
  return prs.sort((a, b) => a.number - b.number);
}

function summarizeChecks(contexts) {
  // Keep only the newest run of each check, so a rerun that passed replaces its failure.
  const latest = new Map();
  for (const c of contexts) {
    if (c.__typename === 'CheckRun') {
      const id = `${c.checkSuite?.app?.slug}/${c.checkSuite?.workflowRun?.workflow?.name}/${c.name}`;
      const prev = latest.get(id);
      if (!prev || c.databaseId > prev.databaseId) latest.set(id, c);
    } else if (c.__typename === 'StatusContext') {
      latest.set(`status/${c.context}`, c);
    }
  }
  const out = {total: latest.size, pending: 0, failing: []};
  for (const c of latest.values()) {
    if (c.__typename === 'CheckRun') {
      if (c.status !== 'COMPLETED') out.pending++;
      else if (FAILED_CONCLUSIONS.has(c.conclusion)) {
        const wf = c.checkSuite?.workflowRun?.workflow?.name;
        out.failing.push({
          key: `run:${c.databaseId}`,
          name: clean(wf ? `${wf} / ${c.name}` : c.name),
          result: c.conclusion,
          at: c.completedAt,
          url: c.detailsUrl,
        });
      }
    } else if (c.state === 'PENDING' || c.state === 'EXPECTED') out.pending++;
    else if (FAILED_STATES.has(c.state)) {
      out.failing.push({
        key: `status:${c.context}@${c.createdAt}`,
        name: clean(c.context),
        result: c.state,
        at: c.createdAt,
        url: c.targetUrl,
      });
    }
  }
  out.failing.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ---------- Fern docs preview link in the PR description ----------

// Upstream's Fern Docs workflow builds a docs preview for each head of a PR that changes the
// docs, once that head is approved for CI. It keeps one github-actions[bot] comment pointing
// at the newest build ("<herb emoji> **Fern Docs Preview:** <url>"), and every build has a new URL.
// Each slot copies that URL into a heading at the top of the PR's description, between these
// markers, and leaves the rest of the description alone. A PR with no preview comment is
// left alone too.
const FERN_BOT = 'github-actions[bot]';
const FERN_START = '<!-- pr-shepherd:fern-preview:start -->';
const FERN_END = '<!-- pr-shepherd:fern-preview:end -->';
const FERN_BLOCK = /<!-- pr-shepherd:fern-preview:start -->[\s\S]*?<!-- pr-shepherd:fern-preview:end -->/;
// Only a Fern-hosted URL is copied, and it stops at any character that could end or escape
// the Markdown link.
const FERN_URL = /https:\/\/[a-z0-9-]+\.docs\.buildwithfern\.com(?:\/[\w.~\/-]*)?/i;

// The URL in the most recently updated preview comment on a PR, or null.
async function fernPreviewURL(number) {
  let newest = null;
  for (let page = 1; page <= 30; page++) {
    const comments = await gh(`/repos/${owner}/${name}/issues/${number}/comments?per_page=100&page=${page}`);
    for (const c of comments) {
      if (c.user?.login !== FERN_BOT || !/fern docs preview/i.test(c.body ?? '')) continue;
      const url = c.body.match(FERN_URL)?.[0].replace(/\.+$/, '');
      if (!url) continue;
      // The workflow edits its comment in place, so the newest build is the newest edit.
      const at = Date.parse(c.updated_at || c.created_at) || 0;
      if (!newest || at > newest.at || (at === newest.at && c.id > newest.id)) newest = {url, at, id: c.id};
    }
    if (comments.length < 100) break;
  }
  return newest?.url ?? null;
}

// \u{1F33F} is the herb emoji the preview comment starts with. Escaped, so this file stays ASCII
// and render.py keeps it a readable YAML block.
const fernBlock = (url) => `${FERN_START}\n## \u{1F33F} [Fern docs preview](${url})\n${FERN_END}`;

// The description with the block for url in place of its earlier block, or at the top.
function withFernBlock(body, url) {
  const text = body ?? '';
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const block = fernBlock(url).replaceAll('\n', nl);
  if (FERN_BLOCK.test(text)) return text.replace(FERN_BLOCK, () => block);
  return text.trim() ? `${block}${nl}${nl}${text}` : block;
}

// Puts each PR's newest Fern docs preview link at the top of its description. Returns a
// status note for each PR whose description changed (or, without writes, would change) or
// couldn't be updated. A failure never fails the slot: the next slot tries again.
async function syncFernPreviews(prs, write) {
  const notes = new Map();
  if (cfg.fernPreview === 'off') return notes;
  for (const pr of prs) {
    try {
      const url = await fernPreviewURL(pr.number);
      if (!url) continue;
      // Read the description right before writing it, so an edit made in the meantime (yours,
      // or CodeRabbit's summary at the bottom) isn't lost.
      const path = `/repos/${owner}/${name}/pulls/${pr.number}`;
      const current = (await gh(path)).body ?? '';
      const body = withFernBlock(current, url);
      if (body === current) continue;
      const what = FERN_BLOCK.test(current) ? 'updated in the description' : 'added to the top of the description';
      if (write) await gh(path, {method: 'PATCH', body: {body}});
      notes.set(pr.number, `Fern docs preview link ${write ? '' : 'would be '}${what}`);
    } catch (err) {
      log(`#${pr.number}: could not update the Fern docs preview link: ${err.message}`);
      notes.set(pr.number, 'Fern docs preview link not updated (GitHub error; the next slot tries again)');
    }
  }
  return notes;
}

// ---------- State (an Actions variable on the fork) ----------

const [stateOwner, stateName] = cfg.stateRepo.split('/');
const varsPath = `/repos/${stateOwner}/${stateName}/actions/variables`;
const emptyState = () => ({version: 1, lastFullAt: null, prs: {}});

async function loadState() {
  const v = await gh(`${varsPath}/${cfg.stateVar}`, {allow404: true});
  if (!v) return {existed: false, state: emptyState()};
  try {
    const s = JSON.parse(v.value);
    if (s?.version !== 1 || typeof s.prs !== 'object' || s.prs === null) throw new Error('unexpected shape');
    return {existed: true, state: s};
  } catch (err) {
    log(`state variable ${cfg.stateVar} is unreadable (${err.message}); starting fresh`);
    return {existed: true, state: emptyState()};
  }
}

async function saveState(state, existed) {
  const body = {name: cfg.stateVar, value: JSON.stringify(state)};
  if (existed) return gh(`${varsPath}/${cfg.stateVar}`, {method: 'PATCH', body});
  try {
    await gh(varsPath, {method: 'POST', body});
  } catch (err) {
    if (!/HTTP (409|422)/.test(err.message)) throw err;
    await gh(`${varsPath}/${cfg.stateVar}`, {method: 'PATCH', body});
  }
}

// What the shepherd has been given for a PR's current head. A new head starts clean, except
// for the last head given to a review, which follow-up reviews start from.
function entryFor(state, pr) {
  const e = state.prs[pr.number];
  const reviewedHead = e?.reviewedHead ?? null;
  if (e && e.head === pr.head) return {conflictHandled: !!e.conflictHandled, failuresHandled: e.failuresHandled ?? [], reviewedHead};
  return {conflictHandled: false, failuresHandled: [], reviewedHead};
}

function nextState(state, prs, given, now, fullRun, advanced = new Set()) {
  const out = {
    version: 1,
    lastFullAt: fullRun ? now.toISOString() : state.lastFullAt,
    prs: {},
    updatedAt: now.toISOString(),
    updatedBy: hostname(),
  };
  for (const pr of prs) {
    const e = entryFor(state, pr);
    const current = new Set(pr.checks.failing.map((f) => f.key));
    const handled = new Set(e.failuresHandled.filter((k) => current.has(k)));
    const g = given.get(pr.number);
    for (const f of g?.failures ?? []) handled.add(f.key);
    const reviewedHead = g?.review || advanced.has(pr.number) ? pr.head : e.reviewedHead;
    out.prs[pr.number] = {
      head: pr.head,
      conflictHandled: e.conflictHandled || !!g?.conflict,
      failuresHandled: [...handled].sort(),
      ...(reviewedHead ? {reviewedHead} : {}),
    };
  }
  return out;
}

// ---------- Schedule ----------

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: cfg.tz,
  hourCycle: 'h23',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const showFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: cfg.tz,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});
const show = (d) => showFmt.format(d);

function localParts(d) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {weekday: WEEKDAYS[p.weekday], hour: Number(p.hour), minute: Number(p.minute)};
}

function isFullSlot(t) {
  const p = localParts(new Date(t));
  return p.minute === 0 && cfg.fullHours.includes(p.hour) && cfg.fullDays.includes(p.weekday);
}

// The most recent regular-run time at or before now (within the past 8 days).
function latestFullSlot(now) {
  let t = Math.floor(now.getTime() / SLOT_MS) * SLOT_MS;
  for (let i = 0; i < 8 * 24 * 4; i++, t -= SLOT_MS) if (isFullSlot(t)) return new Date(t);
  return null;
}

// The first regular-run time after the current slot (within the next 8 days).
function nextFullSlot(now) {
  let t = Math.floor(now.getTime() / SLOT_MS) * SLOT_MS + SLOT_MS;
  for (let i = 0; i < 8 * 24 * 4; i++, t += SLOT_MS) if (isFullSlot(t)) return new Date(t);
  return null;
}

// ---------- Decision ----------

const reviewOn = () => cfg.review === 'shadow' || cfg.review === 'live';

// Whether a PR's head needs a review: {due, kind, since}, or {due: false, note} with advance
// set when nothing new arrived since the last review, so the head counts as reviewed. kind
// is full, followup (the head builds on the last reviewed head, since) or rewritten (since
// is no longer in the PR's history, after a rebase).
//   followup:  the commits after since count, except the shepherd's own fixes.
//   rewritten: the PR's commits count, except copies of commits in since's history.
// SHEPHERD_MODE=review reviews every open PR that isn't a draft or approved (or those in
// SHEPHERD_REVIEW_PRS) from scratch, skipping the waiting rules.
async function reviewStatus(pr, e, now) {
  if (!reviewOn()) return {due: false, note: null};
  if (pr.isDraft) return {due: false, note: 'not reviewed while it is a draft'};
  if (pr.reviewDecision === 'APPROVED') return {due: false, note: 'not reviewed, because it is approved'};
  if (cfg.mode === 'review') {
    if (cfg.reviewPRs.length && !cfg.reviewPRs.includes(pr.number)) return {due: false, note: 'not in SHEPHERD_REVIEW_PRS'};
    return {due: true, kind: 'full'};
  }
  const last = e.reviewedHead;
  if (last === pr.head) return {due: false, note: 'reviewed at this head'};
  if (pr.mergeable === 'CONFLICTING') return {due: false, note: 'review waits until the merge conflict is resolved'};
  if (pr.mergeable !== 'MERGEABLE') return {due: false, note: 'review waits until GitHub has computed mergeability'};
  const age = now - Date.parse(pr.headCommittedAt);
  if (age < cfg.reviewQuietMinutes * 60_000) {
    return {due: false, note: `review waits until the head is ${cfg.reviewQuietMinutes} minutes old (now ${Math.max(0, Math.floor(age / 60_000))})`};
  }
  if (!last) return {due: true, kind: 'full'};
  const nothingNew = (what) => ({due: false, advance: true, note: `reviewed at ${short(last)}; since then only ${what}, so this head counts as reviewed`});
  try {
    const {commits, total} = await prCommits(pr.number);
    if (commits.at(-1)?.oid !== pr.head) {
      if (total <= commits.length) return {due: false, note: 'review waits, because the head moved while its commits were read'};
      // GitHub lists only a PR's first 250 commits, so only the newest one can be checked.
      return pr.headIsShepherdFix ? nothingNew("the shepherd's fixes") : {due: true, kind: 'rewritten', since: last};
    }
    const i = commits.findIndex((c) => c.oid === last);
    if (i >= 0) {
      if (commits.slice(i + 1).every(isShepherdFix)) return nothingNew("the shepherd's fixes");
      return {due: true, kind: 'followup', since: last};
    }
    const reviewed = await historyKeys(last);
    if (commits.every((c) => reviewed.has(copyKey(c)))) return nothingNew('a rebase of those commits');
    return {due: true, kind: 'rewritten', since: last};
  } catch (err) {
    log(`#${pr.number}: could not read the commits since the last reviewed head ${short(last)}: ${err.message}`);
    return {due: false, note: 'review waits, because GitHub could not list its commits'};
  }
}

function reviewNote(r, deferred) {
  if (!r.due) return r.note;
  const kind = r.kind === 'full' ? 'full review' : r.kind === 'followup' ? `follow-up since ${short(r.since)}` : `history rewritten since ${short(r.since)}`;
  return `review due${deferred ? ` ${deferred}` : ''} (${kind})`;
}

function describe(pr, e, note) {
  const conflict =
    pr.mergeable === 'CONFLICTING'
      ? e.conflictHandled
        ? 'merge conflict (already given to the shepherd at this head)'
        : 'merge conflict'
      : pr.mergeable === 'UNKNOWN'
        ? 'GitHub has not computed mergeability yet'
        : 'no merge conflict';
  const c = pr.checks;
  const handled = new Set(e.failuresHandled);
  const fresh = c.failing.filter((f) => !handled.has(f.key)).length;
  let ci;
  if (c.total === 0) ci = 'no checks yet';
  else if (c.failing.length === 0) ci = c.pending ? `CI running (${c.pending} of ${c.total} checks pending)` : `CI passed (${c.total} checks)`;
  else {
    ci = `${c.failing.length} failed check${c.failing.length === 1 ? '' : 's'}`;
    ci += fresh ? ` (${fresh} new)` : ' (already given to the shepherd)';
    if (c.pending) ci += `, ${c.pending} still running`;
  }
  return `#${pr.number} (head ${short(pr.head)}${pr.isDraft ? ', draft' : ''}): ${conflict}; ${ci}${note ? `; ${note}` : ''}`;
}

function reviewLine(r) {
  if (r.kind === 'full') return '  - Review it (steps C, R and S): a full review of the PR.';
  if (r.kind === 'followup') return `  - Review it (steps C, R and S): a follow-up review of the changes since \`${r.since}\`, the last reviewed head.`;
  return `  - Review it (steps C, R and S): its history was rewritten since \`${r.since}\`, the last reviewed head. Use git range-diff against that head to find what changed.`;
}

function triggerDoc(triggers, now) {
  const next = nextFullSlot(now);
  const reviews = triggers.some((t) => t.review);
  const problems = triggers.some((t) => t.conflict || t.failures.length);
  const found = problems && reviews ? 'problems and reviews' : reviews ? 'reviews' : 'problems';
  const lines = [
    '## Triggered run (PR watch): read first',
    `The PR watch started this run at ${show(now)} because it found ${found} the shepherd hasn't been given yet. This is not a regular run.`,
    '',
  ];
  for (const t of triggers) {
    lines.push(`- PR #${t.pr.number} (${t.pr.url}), branch \`${clean(t.pr.branch)}\`, head \`${short(t.pr.head)}\`:`);
    if (t.conflict) lines.push('  - It has a merge conflict with its base branch (mergeable: CONFLICTING).');
    if (t.failures.length) {
      lines.push(
        t.pr.checks.pending
          ? `  - These checks failed. ${t.pr.checks.pending} other checks are still running, but these failures are over ${cfg.ciStaleMinutes} minutes old:`
          : '  - These checks failed, and CI on this head has finished:',
      );
      for (const f of t.failures) lines.push(`    - ${f.name}: ${f.result}${f.url ? ` (${f.url})` : ''}`);
    }
    if (t.review) lines.push(reviewLine(t.review));
  }
  const due = next ? `; the next one is due at ${show(next)}` : '';
  lines.push(
    '',
    'Scope of this run:',
    reviews
      ? '- Work only on the PRs listed above, and only on what is listed for each: step A (rebase) for a merge conflict, step B (CI) for failed checks, and steps C, R and S (CodeRabbit, self-review, and the review brief) for a review. Re-triage those PRs first, because their state may have changed since the watch looked. If a problem is already gone, say so and leave it alone.'
      : '- Work only on the PRs listed above, and only on the problems listed: step A (rebase) for a merge conflict, step B (CI) for failed checks. Re-triage those PRs first, because their state may have changed since the watch looked. If a problem is already gone, say so and leave that PR alone.',
    reviews
      ? `- Skip steps D-G (human reviews, approvals, codeowner pings, and age), and step C for a PR without a review. The regular runs cover them${due}.`
      : `- Skip steps C-G (CodeRabbit, human reviews, approvals, codeowner pings, and age). The regular runs cover them${due}.`,
    `- Every other rule below still applies, including backups, validation, the per-run limits, and signed, signed-off commits. Start the report with "Triggered by the PR watch:" and the ${found} above.`,
    '',
    '',
  );
  return lines.join('\n');
}

async function main() {
  if (!cfg.token) throw new Error('GH_TOKEN is not set');
  if (!['auto', 'full', 'review', 'check'].includes(cfg.mode)) throw new Error(`unknown SHEPHERD_MODE "${cfg.mode}"`);
  if (!['off', 'shadow', 'live'].includes(cfg.review)) throw new Error(`unknown SHEPHERD_REVIEW "${cfg.review}"`);
  if (cfg.mode === 'review' && !reviewOn()) throw new Error('SHEPHERD_MODE=review needs SHEPHERD_REVIEW=shadow or live');
  if (!['on', 'off'].includes(cfg.fernPreview)) throw new Error(`unknown SHEPHERD_FERN_PREVIEW "${cfg.fernPreview}"`);
  mkdirSync(cfg.outDir, {recursive: true});
  const now = new Date();
  const [prs, loaded] = await Promise.all([listPRs(), loadState()]);
  const state = loaded.state;
  const write = !cfg.readOnly && cfg.mode !== 'check';

  // With no state yet (the first run, or after a reset), assume the regular run before this
  // slot already happened, so a deploy or a reset doesn't start a late one.
  const fullSlot = latestFullSlot(now);
  const slotStart = new Date(Math.floor(now.getTime() / SLOT_MS) * SLOT_MS);
  if (!loaded.existed && fullSlot && fullSlot < slotStart) state.lastFullAt = fullSlot.toISOString();
  const lastFull = state.lastFullAt ? new Date(state.lastFullAt) : null;
  const fullDue =
    cfg.mode === 'full' ||
    (cfg.mode !== 'review' && !!fullSlot && now - fullSlot <= cfg.fullMakeupMinutes * 60_000 && (!lastFull || lastFull < fullSlot));

  // A regular run doesn't review: a review that is due waits for the next slot, so one run
  // stays within its time limit. So does each review past the per-run cap, oldest head first.
  const reviewOf = new Map();
  for (const pr of prs) reviewOf.set(pr.number, await reviewStatus(pr, entryFor(state, pr), now));
  const due = prs.filter((pr) => reviewOf.get(pr.number).due);
  due.sort((a, b) => Date.parse(a.headCommittedAt) - Date.parse(b.headCommittedAt) || a.number - b.number);
  const capped = new Set(due.slice(cfg.reviewMaxPerRun).map((pr) => pr.number));

  // Every slot keeps the Fern docs preview links current, whatever else it does.
  const fernNotes = await syncFernPreviews(prs, write);

  const status = [];
  const given = new Map();
  const triggers = [];
  for (const pr of prs) {
    const e = entryFor(state, pr);
    const r = reviewOf.get(pr.number);
    const later = fullDue ? 'after this regular run' : capped.has(pr.number) ? `in a later slot (${cfg.reviewMaxPerRun} per run)` : '';
    const notes = [reviewNote(r, later), fernNotes.get(pr.number)].filter(Boolean).join('; ');
    status.push(`- ${describe(pr, e, notes)}`);
    const review = r.due && !capped.has(pr.number) ? r : null;
    if (cfg.mode === 'review') {
      if (review) {
        triggers.push({pr, conflict: false, failures: [], review});
        given.set(pr.number, {review: true});
      }
      continue;
    }
    const handled = new Set(e.failuresHandled);
    const fresh = pr.checks.failing.filter((f) => !handled.has(f.key));
    const stale = fresh.some((f) => now - Date.parse(f.at) >= cfg.ciStaleMinutes * 60_000);
    const t = {
      pr,
      conflict: pr.mergeable === 'CONFLICTING' && !e.conflictHandled,
      failures: fresh.length && (pr.checks.pending === 0 || stale) ? fresh : [],
      review,
    };
    if (fullDue) given.set(pr.number, {conflict: pr.mergeable === 'CONFLICTING', failures: pr.checks.failing});
    else if (t.conflict || t.failures.length || t.review) {
      triggers.push(t);
      given.set(pr.number, {conflict: t.conflict, failures: t.failures, review: !!t.review});
    }
  }

  let mode = 'none';
  if (fullDue) mode = 'full';
  else if (triggers.length) mode = 'watch';

  const head = cfg.mode === 'check' ? `PR watch check at ${show(now)}; nothing was written` : `PR watch at ${show(now)}`;
  const starting = cfg.mode === 'check' ? 'would start' : 'is starting';
  const problems = triggers.some((t) => t.conflict || t.failures.length);
  const reviewCount = triggers.filter((t) => t.review).length;
  const reviewsDue = reviewCount === 1 ? 'a review is due' : `${reviewCount} reviews are due`;
  const out = [];
  if (mode === 'full') out.push(`${head}: regular run${cfg.mode === 'full' ? ' (forced)' : ` for the ${show(fullSlot)} slot`}.`);
  else if (mode === 'watch' && cfg.mode === 'review') out.push(`${head}: review requested (SHEPHERD_MODE=review), so the shepherd ${starting} a review run.`);
  else if (mode === 'watch' && !reviewCount) out.push(`${head}: new problems, so the shepherd ${starting} a run scoped to them.`);
  else if (mode === 'watch' && !problems) out.push(`${head}: ${reviewsDue}, so the shepherd ${starting} a review run.`);
  else if (mode === 'watch') out.push(`${head}: new problems, and ${reviewsDue}, so the shepherd ${starting} a run scoped to them.`);
  else if (cfg.mode === 'review') out.push(`${head}: review requested, but no open PR can be reviewed, so the shepherd didn't run.`);
  else out.push(`${head}: nothing new, so the shepherd ${cfg.mode === 'check' ? 'would not run' : "didn't run"}.`);
  out.push(...(status.length ? status : [`- No open PRs by ${cfg.author} in ${cfg.repo}.`]));

  // A head with nothing new since its last review is recorded as reviewed, even in a slot
  // that starts no run, so later rebases match its commits and its commits aren't read again.
  const advanced = new Set(prs.filter((pr) => reviewOf.get(pr.number).advance).map((pr) => pr.number));
  if ((mode !== 'none' || advanced.size) && write) {
    try {
      await saveState(nextState(state, prs, given, now, mode === 'full', advanced), loaded.existed);
    } catch (err) {
      // A triggered run that can't be recorded would start again every slot, so don't
      // start it. A regular run goes ahead anyway, and a review head is recorded next time.
      if (mode === 'watch') throw new Error(`could not record the trigger in ${cfg.stateRepo} variable ${cfg.stateVar}: ${err.message}`);
      log(`could not record the ${mode === 'full' ? 'regular run' : 'reviewed heads'} in ${cfg.stateRepo} variable ${cfg.stateVar}: ${err.message}`);
    }
  }

  const doc = mode === 'watch' ? triggerDoc(triggers, now) : '';
  if (cfg.mode === 'check') {
    if (doc) out.push('', 'Prompt section the run would get:', '', doc.trimEnd());
    mode = 'none';
  }
  writeFileSync(join(cfg.outDir, 'trigger.md'), doc);
  writeFileSync(join(cfg.outDir, 'mode'), mode);
  process.stdout.write(`${out.join('\n')}\n`);
}

main().catch((err) => {
  log(`FAILED: ${err.message}`);
  process.exit(1);
});
