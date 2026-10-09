// THE TRADE PAGE IN A WEEK THAT IS PARTLY PLAYED.
//
//   node test-trade-progress.mjs
//
// Tim, 2026-10-04: "any games that are completely finished are counted … for
// singular players that have finished their game, their numbers are individually
// updated … nothing is waiting on something else that it doesn't depend on."
//
// js/season.js now marks every man of a week ESPN has not closed (`done`,
// `pregame`, and `projected` overwritten with his score once he has finished),
// and a matchup can be `played` + `early` days before its week is. This boots
// trade.html on the stubbed league (tr-stub-season.mjs, `TR_PROGRESS`) through
// the `progress` scenario of tr-test.mjs, three times:
//
//   1      week 5 in progress, one of the two matchups final early, some men
//          finished, some mid-game with a running score, some still to play
//   quiet  week 5 in progress and ONE BENCH MAN finished: no matchup score has
//          moved, so the schedule alone cannot tell the week has begun
//   (off)  nothing marked — the page must be exactly what it was
//
// It is its own file, and not a block in tr-test.mjs, because that suite takes
// ten minutes and these three boots take one.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 260)}` : ''}`);
};
const eq = (a, b, msg) => ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

function run(variant) {
  const env = { ...process.env, TR_DEADLINE: String(Date.now() + 60 * 86400000) };
  delete env.TR_PROGRESS;
  if (variant) env.TR_PROGRESS = variant;
  // Unmarked, the stub knows no kickoffs unless told: the coming week's first
  // game two days off, so "accept by" has a line to draw.
  else env.TR_KICKOFFS = String(Date.now() + 2 * 86400000);
  const res = spawnSync(process.execPath, ['--import', './tr-register.mjs', path.join(HERE, 'tr-test.mjs'), 'progress'], {
    encoding: 'utf8', cwd: HERE, env, maxBuffer: 64 * 1024 * 1024,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) return { boot: `no result — exit ${res.status}: ${String(res.stderr || '').slice(-400)}` };
  return JSON.parse(line.slice(2));
}

const fmt = (n) => n.toFixed(1);
const span = (r) => (r.page.heads.find((h) => /weeks/.test(h)) || '').replace(/^.*\(|\).*$/g, '');
const outToo = (r) => /out too/.test(r.page.note);
/** One card's cell for a week: `cell(card, 'Proj', 5)`. */
const cell = (card, row, week) => (card ? card.rows[row][card.weeks.indexOf(String(week))] : undefined);
const value = (list, name) => ((list.find((x) => x.name === name) || {}).v || '').replace(/[^\d.]/g, '');

// ---- 1. one matchup final early, the week still in progress ----------------
{
  const r = run('1');
  ok('it boots with a week in progress', !r.boot, r.boot);
  if (!r.boot) {
    const W = r.liveWeek;
    const { done, mid, wait, bye } = r.cards;
    eq(r.errors.length, 0, 'no console errors');
    eq(r.page.week, String(W), 'the page opens on the week in progress, not the one after it');
    ok('which is not called played', new RegExp(`^Week ${W} .*not played yet`).test(r.page.status), r.page.status);
    eq(span(r), `weeks ${W + 1}–14`, 'the priced span starts the week after: the week in progress is locked');
    ok('and the page says so', outToo(r) && new RegExp(`week ${W} is out too`, 'i').test(r.page.note));
    ok('accept-by counts from the week in progress: too late for it, in time for the next',
      new RegExp(`for wk ${W + 1}`).test(r.accept.text) && new RegExp(`too late for ${W}\\b`).test(r.accept.text),
      r.accept.text);
    ok('offers are found and ranked', r.page.trades > 0 && /ranked by net increase/.test(r.page.count),
      r.page.count);
    // NET INCREASE (Tim, 2026-10-09: "order them from top to bottom by net
    // increase (your dif+op dif)"): each row's printed "You gain" a week plus
    // its printed "He gains" a week, in tenths, never rising down the table.
    {
      const tenths = (s) => Math.round(Number(String(s).replace('−', '-').replace('+', '').match(/^-?\d+\.\d/)[0]) * 10);
      const net = r.page.rows.map((t) => tenths(t.gainText) + tenths(t.theirText));
      ok('the offers run from the largest net increase (You gain + He gains, as printed) to the smallest',
        net.length === r.page.trades && net.length > 3 && net.every((v, i) => i === 0 || net[i - 1] >= v),
        r.page.rows.map((t, i) => `${t.gainText.split('/wk')[0]}${t.theirText.split('/wk')[0]}=${net[i] / 10}`).join(' '));
      ok('and that is a different order from your own gain alone',
        r.page.rows.some((t, i, a) => i > 0 && tenths(a[i - 1].gainText) < tenths(t.gainText)),
        r.page.rows.map((t) => t.gainText.split('/wk')[0]).join(' '));
      // AND WHEN THE OFFERS CANNOT BE PLAYED OUT — "The selected week" prices
      // one week, so the goal has nothing to simulate. The list used to fall
      // back to the finder's own order ("Ranked by points").
      // (The ORDER of that list is held in tr-test on the demo league: on this
      // stub the finder's own order and net increase happen to coincide.)
      const L = r.weekMeasure.list;
      ok('on a measure the goal cannot play out, the line still says net increase, with why there is no chance column',
        /ranked by net increase \(You gain \+ He gains\)\. No .* yet: /.test(L.count) && !/Ranked by points/.test(L.count),
        L.count.slice(0, 220));
    }

    // A finished man: his number IS his score, and the card sets it against
    // the projection as it was.
    ok('a finished man’s glance line carries his score', (done.glance || '').includes(`Proj ${fmt(r.want.done.act)}`),
      done.glance);
    eq(cell(done, 'Proj', W), fmt(r.want.done.proj), 'his card’s Proj cell is the PRE-GAME projection');
    eq(cell(done, 'Act', W), fmt(r.want.done.act), 'and its Act cell his score');
    eq(value(r.weekMeasure.mine, 'Ana QB1'), fmt(r.want.done.act), '“The selected week” values him at his score');
    // A man mid-game, and one still to play.
    eq(cell(mid, 'Proj', W), fmt(r.want.mid.proj), 'a man mid-game keeps his projection');
    eq(cell(mid, 'Act', W), '', 'and his Act cell is blank: a running score is not a result');
    eq(value(r.weekMeasure.his, 'Cy WR1'), fmt(r.want.mid.proj), 'he is valued at the projection, not the running score');
    eq(cell(wait, 'Act', W), '', 'a man still to play has no Act');
    eq(cell(wait, 'Proj', W), fmt(r.want.wait.proj), 'and his projection');
    // The weeks ESPN has closed are untouched.
    eq(cell(done, 'Proj', W - 1), fmt(r.want.last.proj), 'a final week’s Proj cell is as it was');
    ok('and its Act cell is filled', /^\d/.test(cell(done, 'Act', W - 1) || ''), cell(done, 'Act', W - 1));
    // "No game that week" is `done` too, and must not read as a played game.
    eq(cell(bye, 'Proj', r.byeWeek), 'Bye', 'a bye is still a bye');
    eq(cell(bye, 'Act', r.byeWeek), '', 'with no score');
    ok('and the bye week is still priced', r.byeWeek > W && r.byeWeek <= 14 && span(r) === `weeks ${W + 1}–14`);
  }
}

// ---- 2. only a bench man has finished: no matchup score has moved ----------
{
  const r = run('quiet');
  ok('it boots with one bench man finished', !r.boot, r.boot);
  if (!r.boot) {
    const W = r.liveWeek;
    eq(r.errors.length, 0, 'no console errors');
    eq(r.page.week, String(W), 'the page opens on the week in progress');
    eq(span(r), `weeks ${W + 1}–14`, 'a week in which anyone has finished is out of the priced span');
    ok('and the page says so', outToo(r));
    ok('accept-by is too late for it', new RegExp(`too late for ${W}\\b`).test(r.accept.text), r.accept.text);
    eq(cell(r.cards.done, 'Act', W), '', 'a man who has not played has no Act');
    eq(cell(r.cards.done, 'Proj', W), fmt(r.want.done.proj), 'and his projection');
    ok('offers are still found', r.page.trades > 0);
  }
}

// ---- 3. nothing marked: exactly the page as it was -------------------------
{
  const r = run('');
  ok('it boots with nothing marked', !r.boot, r.boot);
  if (!r.boot) {
    const W = r.liveWeek;
    eq(r.errors.length, 0, 'no console errors');
    eq(r.page.week, String(W), 'the page opens on the first unplayed week');
    eq(span(r), `weeks ${W}–14`, 'which is inside the priced span');
    ok('nothing is “out too”', !outToo(r));
    ok('accept-by is in time for it', new RegExp(`for wk ${W}\\b`).test(r.accept.text) && !/too late/.test(r.accept.text),
      r.accept.text);
    eq(cell(r.cards.done, 'Proj', W), fmt(r.want.done.proj), 'a card’s Proj cell is the projection');
    eq(cell(r.cards.done, 'Act', W), '', 'and its Act cell is blank');
    ok('the glance line is the projection', (r.cards.done.glance || '').includes(`Proj ${fmt(r.want.done.proj)}`),
      r.cards.done.glance);
    eq(value(r.weekMeasure.mine, 'Ana QB1'), fmt(r.want.done.proj), '“The selected week” is the projection');
    ok('and no played-week warning', !r.weekMeasure.warn.text);
  }
}

// ---------------------------------------------------------------------------

if (fails.length) for (const f of fails) console.log('FAIL ' + f);
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
