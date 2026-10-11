// Checks js/pre-vs-now.js: the rows and the three filters behind the Stats
// page's "Preseason vs now" panel.
//
//   node test-pre-vs-now.mjs
//
// Tim, 2026-10-11: "the proj season avg (before the season started) vs the
// current season avg for every player ... sort/filter them by position,
// rostered, or user."
//
// The league is pre-now-fixture.mjs: 10 squads of 16 and a 150-man wire, rows
// shaped like the real roster and wire reads, the preseason side read through
// the REAL js/proj-trend.js from a copy shaped like the committed one. Every
// expected count comes from the fixture's own rule (`expected`), never from
// the module under test.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';
import * as fx from './pre-now-fixture.mjs';

const mod = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const pvn = await mod('js/pre-vs-now.js');
const trend = await mod('js/proj-trend.js');

let pass = 0;
let fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

trend.setBaseline(fx.baseline());
const scoring = trend.scoringForSeason(fx.SCORING, fx.SEASON);
const preOf = (id) => { const b = trend.baselineOf(id, scoring); return b ? b.perWeek : null; };
const teams = fx.teamsForWeek(fx.CURRENT);
const wire = fx.wireForWeek(fx.CURRENT);

// ------------------------------------------------------------------ the rows
const rows = pvn.buildRows({ teams, wire, preOf });
const want = fx.expected();
const byId = new Map(rows.map((r) => [r.playerId, r]));
eq(teams.length * 16, 160, 'the fixture is 10 squads of 16');
eq(wire.length, 150, 'and a 150-man wire');
eq(rows.length, want.length, 'one row for every man with both numbers');
ok(want.length > 250 && want.length < 310, 'which is most of the 310, not all', want.length);
eq(new Set(rows.map((r) => String(r.playerId))).size, rows.length, 'nobody is listed twice');

let wrong = 0;
for (const w of want) {
  const r = byId.get(w.id);
  if (!r || r.pre !== w.pre || r.avg !== w.avg || r.diff !== w.diff || r.position !== w.position ||
      r.teamId !== w.teamId || r.rostered !== (w.teamId !== null) ||
      r.teamName !== (w.teamId === null ? '' : w.team)) wrong++;
}
eq(wrong, 0, 'each row carries his preseason average, ESPN’s season average, the printed difference, his position and his squad');
ok(rows.every((r) => Math.abs(r.diffRaw - (r.avg - r.pre)) < 1e-9), 'and the unrounded gap to sort on');
ok(rows.every((r) => Math.round((Math.round(r.avg * 10) / 10 - r.pre) * 10) / 10 === r.diff),
  'Diff is the two printed ends subtracted');
ok(rows.some((r) => r.diff < 0) && rows.some((r) => r.diff > 0), 'some are up and some are down');

const noPre = teams.flatMap((t) => t.players).find((p) => !fx.hasPre(p.playerId) && fx.hasAvg(p.playerId));
const noAvg = teams.flatMap((t) => t.players).find((p) => fx.hasPre(p.playerId) && !fx.hasAvg(p.playerId));
ok(noPre && !byId.has(noPre.playerId), 'a man ESPN had no preseason line for is not a row');
ok(noAvg && !byId.has(noAvg.playerId), 'a man with no season average is not a row');
ok(wire.some((p) => !fx.hasAvg(p.playerId)) && rows.every((r) => fx.hasAvg(r.playerId) && fx.hasPre(r.playerId)),
  'on the wire as on a squad');

const stale = byId.get(fx.STALE_ID);
ok(stale && stale.rostered && stale.teamId === 1, 'a free agent who is on a squad is that squad’s player, once');
ok(rows.find((r) => r.position === 'DST'), 'a defence is keyed DST whatever the roster calls it');
ok(!rows.find((r) => r.position === 'D/ST'), 'and never D/ST');

eq(pvn.buildRows({ teams, wire: [], preOf }).length, fx.expected({ wire: false }).length,
  'without the wire it is the squads’ players alone');
eq(pvn.buildRows({ teams, wire }).length, 0, 'no preseason lookup, no rows');
eq(pvn.buildRows({ teams, wire, preOf: () => null }).length, 0, 'nobody in the preseason copy, no rows');
eq(pvn.buildRows().length, 0, 'nothing in, nothing out');
// The cloud copy rebuilds `players`; an older shape has only the two views.
const split = teams.map(({ players, ...t }) => t);
eq(pvn.buildRows({ teams: split, preOf }).length, fx.expected({ wire: false }).length,
  'a team with only starters + bench is read the same');

// ------------------------------------------- the season average off the weeks
{
  const man = (playerId, seasonAvg) => ({ playerId, seasonAvg });
  const weeks = new Map([
    [1, [{ id: 1, players: [man(7, 9.5), man(8, 4)] }]],
    [2, [{ id: 2, players: [man(7, 11.25)] }, { id: 1, players: [man(8, null)] }]],
    [3, [{ id: 2, players: [man(7, null)] }, { id: 1, starters: [man(9, 6.5)], bench: [] }]],
  ]);
  eq(pvn.seasonAvgOf(7, weeks, 2), 11.25, 'his average is read off the current week’s entry');
  eq(pvn.seasonAvgOf(7, weeks, 3), 11.25, 'else off the latest week that carries one');
  eq(pvn.seasonAvgOf(8, weeks, 3), 4, 'however far back that is');
  eq(pvn.seasonAvgOf(9, weeks, 3), 6.5, 'on a team with only starters + bench too');
  eq(pvn.seasonAvgOf(99, weeks, 3), null, 'a man on no roster has none');
  eq(pvn.seasonAvgOf(7, null, 3), null, 'no weeks, no average');
  const viaWeeks = pvn.buildRows({
    teams: [{ id: 2, name: 'B', players: [{ playerId: 7, name: 'Seven', position: 'RB', seasonAvg: null }] }],
    preOf: () => 10, avgOf: (id) => pvn.seasonAvgOf(id, weeks, 3),
  });
  eq(viaWeeks.length === 1 && viaWeeks[0].avg, 11.25, 'and `avgOf` hands that to the row');
}

// --------------------------------------------------------------- the filters
const count = (f) => pvn.filterRows(rows, f).length;
const wantCount = (fn) => want.filter(fn).length;
eq(count(pvn.defaultFilters()), want.length, 'at rest the filters show everybody');
eq(count(null), want.length, 'as do no filters at all');

for (const pos of pvn.POSITIONS) {
  const got = pvn.filterRows(rows, { position: pos });
  eq(got.length, wantCount((w) => w.position === pos), `Position ${pos}: the right number of rows`);
  ok(got.length > 0 && got.every((r) => r.position === pos), `Position ${pos}: and nobody else`);
}
eq(pvn.POSITIONS.reduce((a, pos) => a + count({ position: pos }), 0), want.length,
  'the six positions add up to everybody');

eq(count({ rostered: 'rostered' }), wantCount((w) => w.teamId !== null), 'Rostered: the squads’ players');
eq(count({ rostered: 'free' }), wantCount((w) => w.teamId === null), 'Free agents: the wire’s');
ok(pvn.filterRows(rows, { rostered: 'free' }).every((r) => !r.rostered && r.teamId === null), 'and only them');
eq(count({ rostered: 'rostered' }) + count({ rostered: 'free' }), want.length, 'the two add up to everybody');

for (const t of fx.TEAMS) {
  const got = pvn.filterRows(rows, { team: t.id });
  eq(got.length, wantCount((w) => w.teamId === t.id), `User ${t.name}: his players`);
  ok(got.length > 8 && got.every((r) => r.teamId === t.id), `User ${t.name}: and only his`);
}
eq(count({ team: '4' }), wantCount((w) => w.teamId === 4), 'a team id off a <select> is a string and still matches');
eq(count({ position: 'RB', team: 4, rostered: 'rostered' }), wantCount((w) => w.position === 'RB' && w.teamId === 4),
  'the three narrow together');
eq(count({ position: 'K', rostered: 'free' }), wantCount((w) => w.position === 'K' && w.teamId === null),
  'position and free agents together');

// ------------------------------------------------ the controls agree with each other
{
  let f = pvn.defaultFilters();
  eq(JSON.stringify(f), JSON.stringify({ position: 'all', rostered: 'all', team: 'all' }), 'the filters at rest');
  f = pvn.setFilter(f, 'team', '4');
  eq(f.rostered, 'rostered', 'choosing a user sets Rostered');
  eq(f.team, '4', 'and keeps the user');
  f = pvn.setFilter(f, 'position', 'WR');
  eq(`${f.position}/${f.rostered}/${f.team}`, 'WR/rostered/4', 'a position leaves the other two alone');
  f = pvn.setFilter(f, 'rostered', 'free');
  eq(`${f.position}/${f.rostered}/${f.team}`, 'WR/free/all', 'Free agents lets go of the user');
  f = pvn.setFilter(pvn.setFilter(f, 'team', 2), 'rostered', 'all');
  eq(`${f.rostered}/${f.team}`, 'all/all', 'All lets go of the user too');
  f = pvn.setFilter(pvn.setFilter(f, 'team', 2), 'rostered', 'rostered');
  eq(`${f.rostered}/${f.team}`, 'rostered/2', 'Rostered keeps him');
  f = pvn.setFilter(f, 'team', 'all');
  eq(`${f.rostered}/${f.team}`, 'rostered/all', 'All teams leaves Rostered where it was');
  eq(pvn.setFilter(f, 'position', 'XX').position, 'all', 'an unknown position is All');
  eq(pvn.setFilter(f, 'rostered', 'maybe').rostered, 'all', 'an unknown Rostered choice is All');
  const before = JSON.stringify(f);
  pvn.setFilter(f, 'team', 9);
  eq(JSON.stringify(f), before, 'and the filters handed in are never changed');
}

// ----------------------------------------------------- when the wire is needed
eq(pvn.needsWire({ rostered: 'all' }), true, 'All needs the free agents');
eq(pvn.needsWire({ rostered: 'free' }), true, 'so does Free agents');
eq(pvn.needsWire({ rostered: 'rostered' }), false, 'Rostered does not');
eq(pvn.needsWire(pvn.setFilter(pvn.defaultFilters(), 'team', 3)), false, 'nor does a user');

const c = pvn.countRows(rows);
eq(`${c.all}/${c.rostered}/${c.free}`,
  `${want.length}/${wantCount((w) => w.teamId !== null)}/${wantCount((w) => w.teamId === null)}`,
  'the counts the note prints');

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
