// Waiting for a PAGE, and measuring how busy the machine is.
//
// Two jobs, one subject: a suite that boots a real page has to know when the
// page has finished, and a suite that asserts a time budget has to know what a
// second is worth today. Both used to be guessed with a fixed number, and both
// guesses fail the same way — green on an idle box, red on a busy one, on code
// that never changed.
//
// THE MACHINE IS NEVER IDLE. Tim runs `ocrvid.py` OCR jobs that hold several
// cores for hours at a stretch (PROGRESS.md Traps). A fixed `setTimeout` long
// enough for that machine is a suite nobody will wait for; one short enough to
// live with is a suite that fails on correct code. Measured on 2026-09-23: the
// same eight-million-iteration loop takes 96 ms with the machine as Tim leaves
// it and 965 ms with every core taken, so the wait a page needs moves by an
// order of magnitude within one afternoon.
//
// Used by fc-test.mjs, wv-test.mjs, taken-check.mjs and test-trade-weekly.mjs.
// tr-test.mjs has its own `settleGoal()`, which is the pattern these follow: poll
// for the page's own "I have finished" signal, with a generous ceiling, instead
// of sleeping.

/** A plain sleep. Only for a deliberate short wait, never for "it should be done by now". */
export const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until the page says it has finished.
 *
 * `pending()` is the page's own signal, inverted: it returns '' when the page
 * has nothing left in flight, and otherwise a SENTENCE saying what is still
 * going on — "the sim table still says Simulating 10,000 seasons…". That
 * sentence is the whole point of the shape. A poll that returned a bare boolean
 * would time out with nothing to say, and the failure would land later as
 * `Cannot read properties of undefined (reading 'getAttribute')` in an assertion
 * about heat colours, which is what these suites used to do.
 *
 * Two clear readings are required, `quiet` apart, because a page that hands work
 * off through rAF + setTimeout (js/schedule-page.js runSimulation) can be
 * momentarily between two stages. One clear reading could catch that gap.
 *
 * Returns { ok, ms, why, polls } — never throws, and never asserts. The caller
 * asserts, so a ceiling that was hit is reported as a named failing check
 * rather than as a crash somewhere downstream.
 */
export async function settleUntil(pending, opts = {}) {
  const { max = 60000, step = 100, quiet = 250 } = opts;
  const t0 = Date.now();
  let why = 'the poll never ran';
  let polls = 0;
  while (Date.now() - t0 < max) {
    polls++;
    why = String(pending() || '');
    if (!why) {
      await settle(quiet);
      polls++;
      const again = String(pending() || '');
      if (!again) return { ok: true, ms: Date.now() - t0, why: '', polls };
      why = again;
    }
    await settle(step);
  }
  return { ok: false, ms: Date.now() - t0, why: why || 'still not finished', polls };
}

// ------------------------------------------- the waivers page's own signals
//
// Here rather than in one suite because THREE suites boot `js/waivers-page.js`
// against a stub — `wv-test.mjs`, `taken-check.mjs` and `cmp-check.mjs` — and
// "has that page finished" has one answer, not three. It came out of wv-test
// when `taken-check`'s `jump` scenario turned out to fail 2 runs in 3 for exactly
// the same reason: the jump widens the span to the whole season, which buys
// thirteen weeks of wire AND thirteen of rosters, and the suite read the man's
// positional rank 600 ms later and got his THREE-week rank back.
//
// The page publishes what it is still doing three ways, all of them on screen:
//
//   * `#sourceStatus` — "Reading your league…" while the schedule is in the air,
//     then "Loaded 60 available players from … across 10 weeks".
//   * `#waiverStatus` / `#takenStatus` — `progressText()`'s sentence, "Reading
//     ESPN's weekly projections… week 7 of 13.", recomputed on every render from
//     the cache rather than counted by a loop, so it clears the moment the last
//     week lands.
//   * every cell of a week not yet read is a `td.wait` carrying a dot and the
//     title "Week 9 has not been read from ESPN yet."
//
// The third is one a suite already asserts on directly — wv-test's `live-midload`
// checks "every column filled in", `w.wait === 0` — so polling it is polling the
// page's own promise rather than a wait invented here. A week ESPN REFUSED
// renders `td.muted`, never `td.wait` (wv-test's `live-partial` pins that), so a
// refusal ends the poll instead of hanging it.

/** '' when the waivers page has nothing in flight, else what it is still doing. */
export function waiverPagePending(document) {
  const read = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  const status = read(document.getElementById('sourceStatus'));
  if (!status) return 'the source status line is still empty — the load has not reported yet';
  if (/^Reading your league/.test(status)) return `the status line still says "${status}"`;

  // The apostrophe in "ESPN’s" is a curly one on the page, matched as any
  // character rather than pasted into a regex where it is easy to get wrong.
  for (const id of ['waiverStatus', 'takenStatus']) {
    const t = read(document.getElementById(id));
    const m = /Reading ESPN.s weekly projections[^.]*\./.exec(t);
    if (m) return `#${id} still says "${m[0]}"`;
  }

  for (const id of ['waiverTable', 'takenTable']) {
    const tbody = document.querySelector(`#${id} tbody`);
    if (!tbody) return `#${id} has no tbody`;
    if (!tbody.querySelectorAll('tr').length) return `#${id} has not been painted yet`;
    const waiting = tbody.querySelectorAll('td.wait').length;
    if (waiting) return `#${id} still has ${waiting} cells on the "not read from ESPN yet" dot`;
  }
  return '';
}

/** Wait for the waivers page to finish. A minute's ceiling; a clean run uses a second. */
export const settleWaiverPage = (document, max = 60000) =>
  settleUntil(() => waiverPagePending(document), { max });

// ---------------------------------------------------------- how busy is it

/**
 * The reference: how long ONE_PASS takes on Tim's laptop with nothing else
 * competing for a core.
 *
 * Measured 2026-09-23 as the fastest of twelve consecutive passes (96 ms; the
 * twelve ranged 96–100). The fastest is the right one to record: a pass that got
 * a whole core to itself is the machine at its best, which is what "idle" means
 * here. Re-measure it on new hardware with
 *
 *   node -e "let x=0;const t=Date.now();for(let i=1;i<=8e6;i++)x+=Math.sqrt(i)/i;console.log(Date.now()-t,x)"
 *
 * run a dozen times, and say in the commit message what it moved to and why.
 */
export const REFERENCE_MS = 95;

/** 8,000,000 square roots. Pure arithmetic and no allocation, so its wall time
 *  is a measure of how much of a core this process is actually being given. */
function onePass() {
  const t0 = Date.now();
  let x = 0;
  for (let i = 1; i <= 8_000_000; i++) x += Math.sqrt(i) / i;
  // Reading the result keeps V8 from deleting the loop as dead code. A
  // benchmark that got optimised away would report every machine as idle.
  if (!Number.isFinite(x)) throw new Error('the benchmark did not compute');
  return Date.now() - t0;
}

/**
 * How much slower this machine is right now than the one REFERENCE_MS was
 * measured on. 1 means idle; 10 means every core is taken.
 *
 * The MEAN of the passes, not the fastest: the fastest pass is the one that got
 * a lucky slice, and the work whose budget this scales will not be so lucky for
 * a whole minute. `factor` never goes below 1 — a machine faster than the
 * reference does not earn a budget tighter than the one the product promises.
 */
export function machineSpeed(reps = 3) {
  const passes = [];
  for (let r = 0; r < reps; r++) passes.push(onePass());
  const ms = passes.reduce((a, b) => a + b, 0) / passes.length;
  const factor = Math.max(1, ms / REFERENCE_MS);
  return { ms: Math.round(ms), passes, factor, loaded: factor > 1.5 };
}

/**
 * A time budget about the real product, made fair on a machine that is not idle.
 *
 * WHY SCALE AND NOT SKIP. Skipping when the machine is busy would mean the
 * assertion never runs at all on the only machine it runs on — Tim's, which is
 * busy permanently — and an assertion that never runs is a deleted assertion
 * with extra steps. Scaling keeps it running every day: the budget the product
 * actually promises on an idle machine, multiplied by how much of a core this
 * process is being given. A genuine regression shows up either way, because the
 * factor is measured before and after the work rather than derived from it.
 */
export function scaledBudget(idleMs, factor) {
  return Math.round(idleMs * factor);
}
