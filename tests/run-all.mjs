// Runs every suite in tests/ and prints one line each.
//
//   npm test                 -> all of them
//   node run-all.mjs fc wv   -> only suites whose name contains fc or wv
//   node run-all.mjs --bless -> record today's counts in counts.json
//
// Each suite gets its OWN child process, and that is not tidiness: an ES
// module initialises once per process and the page modules self-boot on
// import, so two page suites in one process would see each other's DOM. Most
// of the suites already fan out into a child per scenario for the same reason;
// this is the same trick one level up.
//
// A suite passes if it exits 0. The count in the line is scraped from whatever
// summary the suite prints -- they do not all phrase it the same way, and it
// is not worth rewriting eleven working suites to agree.
//
// AND THE COUNT IS NOW COMPARED (AUDIT §3.5). It used to be printed and
// nothing else, which is how a deliberate break that silently moved fc-test
// from 1004 assertions to 992 -- because one whole block sits behind an
// `if (x.length)` -- looked exactly like a green run. So:
//
//   * a count that DROPS fails the run, naming the suite and both numbers;
//   * a count that RISES is fine, printed, and left for `--bless` to record;
//   * a suite listed in counts.json that no longer runs at all fails too,
//     because renaming a suite is the other way a count disappears.
//
// `counts.json` is a committed record, not a cache. Raising or lowering a
// number in it is a decision: run `node run-all.mjs --bless` on a green run,
// and say in the commit message what changed and why.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COUNTS_FILE = path.join(HERE, 'counts.json');

// Cheapest first, so a broken engine shows up before the slow page boots.
const SUITES = [
  ['test-forecast.mjs', 'win probability, sigma calibration, optimal lineup, win-total distribution'],
  ['test-sim.mjs', 'the Monte Carlo season simulation'],
  ['test-must-win.mjs', 'which games swing a season: one game forced won and lost on the same draws, and what it moves'],
  ['test-projection.mjs', 'the shared projection module'],
  ['test-floor.mjs', 'the positional floor: no slot assessed below the waiver wire'],
  ['test-heat.mjs', 'the shared red/green scale: one number against the rest of its own kind'],
  ['test-proj-trend.mjs', 'the preseason arrows: ESPN’s preseason stats re-scored, the >2 a week threshold'],
  ['heat-draw-check.mjs', 'the red/green tint draws on even rows, your own row and under hover (the CSS cascade, run)'],
  ['sortable-check.mjs', 'click-to-sort on its own: data-v, the text fallback, and every glyph heat.js can emit'],
  ['charts-check.mjs', 'the inline-SVG charts on their own: marks placed from the data, identity never by hue alone'],
  ['scatter-check.mjs', 'the projected-vs-actual scatter: the least-squares line by hand, one scale on both axes, the preview that is a link'],
  ['shared-tables-check.mjs', 'the standings, the Summary chart and season-by-week as current / hypothetical / difference: hand-made inputs, signed cells, the dimming'],
  ['test-bye-rule.mjs', 'a known bye week projects 0 (ESPN projects D/STs through theirs), playoff weeks in the phone copy, points for to the tenth'],
  ['test-season-rules.mjs', 'played means ESPN decided it, ties count half, playoff games kept apart, waiver status, byes'],
  ['test-store.mjs', 'the weeks kept in this browser between pages: two freshness clocks, eviction, and the seam in season.js'],
  ['test-decision-data.mjs', 'what the managers did, from ESPN: real transaction payloads decoded, a decided week’s moves frozen, the world’s cold and warm cost'],
  ['nav-check.mjs','the hand-copied nav: the same links in the same order on every page'],
  ['site-status-check.mjs', 'the Site updated stamp, the newer-version bar, the failed-to-load strip'],
  ['test-extension.mjs', 'the bridge worker: URL injection, who may drive it, and the staged trade'],
  ['test-bridge-settle.mjs', 'a private league’s first read waits for the extension’s hello'],
  ['test-espn-tick.mjs', 'ticking your own side on ESPN’s trade page — and never submitting'],
  ['owner-names.mjs', 'real names instead of team names: the ESPN members join'],
  ['test-snapshots.mjs', 'the time machine: what is recorded, and what comes back'],
  ['test-backup.mjs', 'Export archive / Import: every kind of saved week and the preferences in one file, back byte for byte, nothing overwritten'],
  ['test-trade.mjs', 'the trade engine: replacement level, the depth map, the finder'],
  ['test-cloud.mjs', 'the phone bridge: what is synced up, what comes back down, and how old it is'],
  ['test-cloud-wiring.mjs', 'the phone bridge WIRED IN: the substitution in season.js and the bar above it'],
  ['test-decision-cloud.mjs', 'the decisions review on the phone: the world rides in the synced copy and reads back the same'],
  ['test-trade-weekly.mjs', 'the weekly measure: depth across the season, and the combo packer'],
  ['test-trade-cut.mjs', 'the forced cut: the man whose loss costs the priced weeks least goes, so receiving never lowers a week'],
  ['test-trade-net.mjs', 'net gain: your change minus his in the weeks you play him, and the pruned finder keeps what an exhaustive one does'],
  ['test-trade-suggest.mjs', 'the Suggested list under the custom builder: every completion of the ticked men, against a brute force'],
  ['test-trade-odds.mjs', 'the goal: a trade ranked by the title (or last-place) chance it moves, and will he say yes'],
  ['test-live-week.mjs', 'the week in progress: played out from its score so far and the share of the spread left, not from kickoff'],
  ['test-done.mjs', 'what has finished counts now: a finished player’s score is his number, a finished matchup is final before ESPN closes the week'],
  ['test-trade-progress.mjs', 'the trade page in a week partly played: a finished man’s number is his score, and one early final does not end the week'],
  ['test-live-week.mjs','the week in progress: played out from its score so far and the share of the spread left, not from kickoff'],
  ['test-decisions.mjs', 'the decisions review: one decision undone and the season replayed, flips, records, noise'],
  ['test-draft-review.mjs', 'the draft looked back on: where each man went, what he is worth now, the bar at each position, on the real league’s draft'],
  ['test-start-sit.mjs', 'start A over B: the swaps to the best legal lineup, their points, their share of the win chance, who is locked'],
  ['test-accept-by.mjs','when a trade must be accepted: first kickoff among the men you get, minus the league’s review'],
  ['test-ask-ai.mjs', 'the "Ask AI" text: both sides’ +/-, the men, the date and league, nothing undefined'],
  ['hot-check.mjs', 'the hot/cold thresholds on the analysis grid'],
  ['test-pages-render.mjs', 'every page boots its real modules against its real HTML'],
  ['test-home.mjs', 'the home page and the debug page, pre-kickoff included'],
  ['stats-weeks.mjs', 'the stats page at 1/2/3/5/13 weeks of season'],
  ['stats-order.mjs', 'the stats page’s panels, in the order Tim asked for'],
  ['opp-check.mjs', 'opponent strength on the stats page'],
  ['stats-fit.mjs', 'the stats page’s two projected-vs-actual graphs: which team-weeks and player-weeks are dots, and where a tapped dot links'],
  ['fc-test.mjs', 'the schedule page forecast and simulation panels'],
  ['test-capture.mjs', 'the weekly reading: identical from the schedule page and the bar, refusals, status line'],
  ['test-proj-history.mjs', 'projection history: every squad’s roster and its projection in every week ahead, kept once a week beside the reading, and read back'],
  ['test-projhist-cloud.mjs', 'projection history in the cloud: each saved week goes up once and is never rewritten, and a browser without it reads it back'],
  ['cross-sim-check.mjs', 'Summary and Schedule simulate with identical inputs'],
  ['home-winpct-check.mjs', 'Home and Schedule quote the same win chance for the same game'],
  ['test-waiver-gain.mjs', 'Gain on the Players page: an add-and-drop priced by the Trade engine, against a brute force, and the prune proved'],
  ['wv-test.mjs', 'the waiver-wire page'],
  ['cmp-check.mjs', 'the waiver page compared against your own roster'],
  ['taken-check.mjs', 'the taken-players table: owners, positional ranks, no colour'],
  ['done-check.mjs', 'the Players page mid-week: a finished game shows the score, plain, in both tables'],
  ['link-check.mjs', 'the player click-through ACROSS pages — the one seam no single-page suite sees'],
  ['an-test.mjs', 'the analysis page'],
  ['proj-changes-check.mjs', 'Analysis: the Position | Player rows, and Proj changes — a saved week as Total or as now minus then'],
  ['roster-link-check.mjs', 'a link into the roster detail (?team=&week=): lands, saves nothing, applied once'],
  ['pages-done-check.mjs', 'the week in progress on Analysis, Home, Stats, Schedule and Summary: finished players and early-final matchups count'],
  ['record-live-check.mjs', 'a record while its game is being played: 3–2 at 20% reads 3.2–2.8, the same on Stats, Summary and Schedule'],
  ['tr-test.mjs', 'the trade page: the depth map, the finder, and the controls'],
  ['decisions-check.mjs', 'the decisions review page: a squad’s decisions, the weekly totals and the flipped matchup with one undone, the three charts beside their hypotheticals, noise, a what-if trade'],
  ['draft-review-check.mjs', 'the Draft page’s "Our draft": the board, a team’s steals and misses, the previews, and what it asks of ESPN — nothing on the phone’s copy'],
  ['test-summary.mjs', 'the weekly summary page: LUCK, title %, loser %, and the image that gets sent'],
  ['touch-check.mjs', 'the analysis grids on a screen with no hover — the tap-opened card'],
  // Last, because it boots all seven pages and is the slowest thing here that
  // is not tr-test. It measures the prose a reader is SHOWN and fails a page
  // that grew past its ceiling (AUDIT §3.2) — the instrument rule 16 depends on.
  ['text-audit.mjs', 'the words on screen per page, against the ceilings in text-ceilings.json'],
];

// The dumps are not suites -- they print rendered panels so a refactor can be
// proved a no-op by diffing before against after. See the README.
const NOT_SUITES = ['fc-dump.mjs', 'sim-dump.mjs'];

/**
 * Pull the numbers out of a suite's own summary line.
 *
 * Returns whatever it could find, keyed by what the number IS -- assertions,
 * scenarios, pages -- because the suites count different things and comparing
 * assertions against pages would be nonsense.
 */
function countsOf(out) {
  const got = {};
  const scenarios = (out.match(/^PASS /gm) || []).length;

  let m = out.match(/All ([\d,]+) assertions passed/);
  if (!m) m = out.match(/([\d,]+) passed, [\d,]+ failed/);
  if (m) got.assertions = Number(m[1].replace(/,/g, ''));

  m = out.match(/All (\d+) pages rendered/) || out.match(/All (\d+) pages OK/);
  if (m) got.pages = Number(m[1]);

  if (scenarios) got.scenarios = scenarios;
  return got;
}

/** The same numbers, phrased the way the run has always phrased them. */
function summarise(got) {
  const n = (v) => v.toLocaleString('en-US');
  if (got.assertions != null) {
    return got.scenarios
      ? `${n(got.assertions)} assertions across ${got.scenarios} scenarios`
      : `${n(got.assertions)} assertions`;
  }
  if (got.pages != null) return `${got.pages} pages`;
  if (got.scenarios != null) return `${got.scenarios} scenarios`;
  return 'ok';
}

function readCounts() {
  try {
    const j = JSON.parse(readFileSync(COUNTS_FILE, 'utf8'));
    return j && typeof j.suites === 'object' ? j : { suites: {} };
  } catch {
    return { suites: {} };
  }
}

const args = process.argv.slice(2);
const bless = args.includes('--bless');
const filters = args.filter((a) => !a.startsWith('--'));
const chosen = filters.length
  ? SUITES.filter(([f]) => filters.some((q) => f.includes(q)))
  : SUITES;

if (!chosen.length) {
  console.log(`No suite matches ${filters.join(', ')}. Known suites:`);
  for (const [f] of SUITES) console.log('  ' + f);
  process.exit(2);
}

const failures = [];
const started = Date.now();
const recorded = readCounts();
const measured = {};
const drops = [];   // counts that fell — a failure
const rises = [];   // counts that grew — fine, and worth blessing

// SEVERAL AT ONCE (Tim, 2026-10-06: "is the 40 minute test really necessary? Is
// there any way we can speed it up"). Each suite is its own node process that
// shares nothing with the others, so a pool of them is the same run in a
// fraction of the time. OPT IN with `--jobs=N`: measured 2026-10-06 at six,
// the run only fell from 32 to 27 minutes (tr-test's own scenarios run one at a
// time and set the floor) and cmp-check failed under the load while passing
// alone, so one at a time stays the default. The suites in
// SOLO make a claim about SPEED and are run alone, first, on an idle machine.
const SOLO = ['test-trade-weekly.mjs'];
const jobsArg = args.find((a) => a.startsWith('--jobs='));
const JOBS = Math.max(1, jobsArg ? Number(jobsArg.slice(7)) || 1 : 1);

function runSuite(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const chunks = [];
    const child = spawn(process.execPath, [path.join(HERE, file)], { cwd: HERE });
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    // 25 MINUTES, NOT TEN. `tr-test` needs ~6 min on an idle machine and hit
    // the old cap whenever Tim's OCR jobs held the cores — a SIGTERM that looks
    // exactly like a broken suite. The cap is here to stop a hang, not to
    // police speed (`test-trade-weekly` owns the speed claim, scaled by a
    // measured machine factor), so it is set well clear of the slowest suite.
    const timer = setTimeout(() => child.kill(), 25 * 60 * 1000);
    const done = (status, signal) => {
      clearTimeout(timer);
      resolve({ file, t0, res: { status, signal, stdout: Buffer.concat(chunks).toString('utf8'), stderr: '' } });
    };
    child.on('error', () => done(null, 'spawn'));
    child.on('close', done);
  });
}

function report({ file, t0, res }) {
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const out = (res.stdout || '') + (res.stderr || '');
  const ok = res.status === 0;

  if (ok) {
    const got = countsOf(out);
    measured[file] = got;
    // A failed suite's count means nothing (it stopped early), so only a
    // passing suite is compared.
    const was = recorded.suites[file];
    const notes = [];
    if (!was) {
      notes.push('not yet in counts.json — run --bless');
    } else {
      for (const kind of ['assertions', 'scenarios', 'pages']) {
        if (was[kind] == null) continue;
        if (got[kind] == null) {
          drops.push([file, kind, was[kind], 'nothing']);
          notes.push(`${kind} no longer reported (was ${was[kind]})`);
        } else if (got[kind] < was[kind]) {
          drops.push([file, kind, was[kind], got[kind]]);
          notes.push(`${kind} FELL ${was[kind]} -> ${got[kind]}`);
        } else if (got[kind] > was[kind]) {
          rises.push([file, kind, was[kind], got[kind]]);
          notes.push(`${kind} up ${was[kind]} -> ${got[kind]}`);
        }
      }
    }
    const tag = notes.length ? `  (${notes.join('; ')})` : '';
    console.log(`PASS  ${file.padEnd(22)} ${summarise(got).padEnd(38)} ${secs}s${tag}`);
  } else {
    console.log(`FAIL  ${file.padEnd(22)} exit ${res.status ?? res.signal ?? '?'}${' '.repeat(28)}${secs}s`);
    failures.push([file, out]);
  }
}

// ONE SLICE OF THE RUN: `--shard=I/N`, for CI, where N machines each take a
// slice and the site is published only when all are green. Slice 1 is tr-test
// ON ITS OWN — it is the longest suite by far (~12 of the ~30 minutes) and so
// sets how long a deploy waits; the others are dealt round the remaining
// slices. One slice (N = 1) is the whole run.
const shardArg = args.find((a) => a.startsWith('--shard='));
const [SHARD, SHARDS] = shardArg ? shardArg.slice(8).split('/').map(Number) : [1, 1];
if (!(SHARDS >= 1 && SHARD >= 1 && SHARD <= SHARDS)) {
  console.log(`--shard=I/N needs 1 <= I <= N, got ${shardArg}`);
  process.exit(2);
}
const LONGEST = 'tr-test.mjs';
function inShard(file, all) {
  if (SHARDS === 1) return true;
  if (file === LONGEST) return SHARD === 1;
  const others = all.filter((f) => f !== LONGEST);
  return others.indexOf(file) % (SHARDS - 1) === SHARD - 2;
}

// A name listed twice is run once.
const everything = [...new Set(chosen.map(([f]) => f))];
const queue = everything.filter((f) => inShard(f, everything));
for (const file of queue.filter((f) => SOLO.includes(f))) report(await runSuite(file));
const rest = queue.filter((f) => !SOLO.includes(f));
await Promise.all(Array.from({ length: Math.min(JOBS, rest.length) }, async () => {
  while (rest.length) report(await runSuite(rest.shift()));
}));

// A suite that used to exist and did not run at all is the other way a count
// vanishes, so a full run checks the record for names it never saw.
const missing = filters.length
  ? []
  : Object.keys(recorded.suites).filter((f) => !chosen.some(([g]) => g === f));

if (failures.length) {
  for (const [file, out] of failures) {
    console.log(`\n---------- ${file} ----------`);
    // Long lines are CUT. One scenario's page state is a single 300 KB line,
    // and printing it whole buries every assertion above it — which is exactly
    // how a real CI failure arrived on 2026-09-23 with nothing readable in it.
    // ON CI, EVERY LINE. A failure there cannot be re-run by hand, and the
    // last 40 lines were not enough to name one on 2026-09-23: the suite
    // crashed with a three-line stack and no assertion in it.
    const keep = process.env.CI ? -100000 : -40;
    console.log(out.trimEnd().split('\n').slice(keep)
      .map((l) => (l.length > 400 ? `${l.slice(0, 400)}... [${l.length} chars]` : l))
      .join('\n'));
  }
}

const total = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  failures.length
    ? `\n${failures.length} of ${queue.length} suites failed  (${total}s)`
    : `\nAll ${queue.length} suites passed  (${total}s)`
);

// ------------------------------------------------------------ the count gate
if (rises.length && !bless) {
  console.log('\nCounts grew (fine — record them with `node run-all.mjs --bless`):');
  for (const [file, kind, was, now] of rises) console.log(`  ${file}  ${kind} ${was} -> ${now}`);
}
if (drops.length) {
  console.log('\nCOUNTS FELL. An assertion that stopped running is a test that stopped testing:');
  for (const [file, kind, was, now] of drops) console.log(`  ${file}  ${kind} ${was} -> ${now}`);
  console.log('  Put the missing assertions back, or — if they went on purpose — say so to Tim');
  console.log('  and run `node run-all.mjs --bless` to record the new numbers.');
}
if (missing.length) {
  console.log('\nRECORDED BUT NEVER RAN (renamed or deleted?):');
  for (const f of missing) console.log(`  ${f}`);
}

if (bless) {
  if (!Object.keys(measured).length) {
    console.log('\nNothing to --bless: no suite passed.');
  } else {
    // Only PASSING suites are recorded — a suite that stopped early has no
    // count — and the record is merged, so blessing a filtered run cannot wipe
    // the suites it did not run.
    const next = {
      _: 'Per-suite counts off a green run. run-all.mjs FAILS when one of these '
        + 'falls (AUDIT §3.5); a rise is fine and is recorded by `node run-all.mjs --bless`. '
        + 'Do not hand-edit: re-bless on a green run and say what changed.',
      measured: new Date().toISOString().slice(0, 10),
      suites: { ...recorded.suites, ...measured },
    };
    writeFileSync(COUNTS_FILE, JSON.stringify(next, null, 2) + '\n');
    console.log(`\nRecorded ${Object.keys(measured).length} suite counts in counts.json.`);
    if (failures.length) {
      console.log('NOT recorded (they failed in this run, so they have no count):');
      for (const [file] of failures) console.log(`  ${file}`);
    }
  }
}

console.log(`(not run here, they print panels rather than assert: ${NOT_SUITES.join(', ')})`);
process.exit(failures.length || (drops.length && !bless) || missing.length ? 1 : 0);
