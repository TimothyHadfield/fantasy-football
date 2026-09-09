// Runs every suite in tests/ and prints one line each.
//
//   npm test                 -> all of them
//   node run-all.mjs fc wv   -> only suites whose name contains fc or wv
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

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Cheapest first, so a broken engine shows up before the slow page boots.
const SUITES = [
  ['test-forecast.mjs', 'win probability, sigma calibration, optimal lineup, win-total distribution'],
  ['test-sim.mjs', 'the Monte Carlo season simulation'],
  ['test-projection.mjs', 'the shared projection module'],
  ['test-trade.mjs', 'the trade engine: replacement level, the depth map, the finder'],
  ['hot-check.mjs', 'the hot/cold thresholds on the analysis grid'],
  ['test-pages-render.mjs', 'every page boots its real modules against its real HTML'],
  ['test-home.mjs', 'the home page and the debug page, pre-kickoff included'],
  ['stats-weeks.mjs', 'the stats page at 1/2/3/5/13 weeks of season'],
  ['opp-check.mjs', 'opponent strength on the stats page'],
  ['fc-test.mjs', 'the schedule page forecast and simulation panels'],
  ['wv-test.mjs', 'the waiver-wire page'],
  ['cmp-check.mjs', 'the waiver page compared against your own roster'],
  ['taken-check.mjs', 'the taken-players table: owners, positional ranks, no colour'],
  ['link-check.mjs', 'the player click-through ACROSS pages — the one seam no single-page suite sees'],
  ['an-test.mjs', 'the analysis page'],
  ['tr-test.mjs', 'the trade page: the depth map, the finder, and the controls'],
];

// The dumps are not suites -- they print rendered panels so a refactor can be
// proved a no-op by diffing before against after. See the README.
const NOT_SUITES = ['fc-dump.mjs', 'sim-dump.mjs'];

/** Pull a headline count out of a suite's own summary line. */
function summarise(out) {
  const scenarios = (out.match(/^PASS /gm) || []).length;
  let assertions = null;

  let m = out.match(/All ([\d,]+) assertions passed/);
  if (m) assertions = m[1];
  if (assertions === null) {
    m = out.match(/([\d,]+) passed, [\d,]+ failed/);
    if (m) assertions = m[1];
  }

  if (assertions !== null) {
    return scenarios
      ? `${assertions} assertions across ${scenarios} scenarios`
      : `${assertions} assertions`;
  }
  m = out.match(/All (\d+) pages rendered/);
  if (m) return `${m[1]} pages rendered`;
  m = out.match(/All (\d+) pages OK/);
  if (m) return `${m[1]} pages`;
  if (scenarios) return `${scenarios} scenarios`;
  return 'ok';
}

const filters = process.argv.slice(2);
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

for (const [file] of chosen) {
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [path.join(HERE, file)], {
    cwd: HERE,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const out = (res.stdout || '') + (res.stderr || '');
  const ok = res.status === 0;

  if (ok) {
    console.log(`PASS  ${file.padEnd(22)} ${summarise(out).padEnd(38)} ${secs}s`);
  } else {
    console.log(`FAIL  ${file.padEnd(22)} exit ${res.status ?? res.signal ?? '?'}${' '.repeat(28)}${secs}s`);
    failures.push([file, out]);
  }
}

if (failures.length) {
  for (const [file, out] of failures) {
    console.log(`\n---------- ${file} ----------`);
    console.log(out.trimEnd().split('\n').slice(-40).join('\n'));
  }
}

const total = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  failures.length
    ? `\n${failures.length} of ${chosen.length} suites failed  (${total}s)`
    : `\nAll ${chosen.length} suites passed  (${total}s)`
);
console.log(`(not run here, they print panels rather than assert: ${NOT_SUITES.join(', ')})`);
process.exit(failures.length ? 1 : 0);
