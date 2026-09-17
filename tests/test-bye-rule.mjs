// The bye rule, the playoff weeks in the phone's copy, and points-for rounding.
//
//   node test-bye-rule.mjs            all scenarios, one child each
//   node test-bye-rule.mjs <scenario> one
//
// THE BYE RULE. Verified against public league 1241838 on 2026-09-16: ESPN
// projects every position at 0.00 in its team's bye week EXCEPT a D/ST, which it
// projects at 3–7 points in a FUTURE bye (the Lions D/ST at 4.41 in week 6,
// their bye) and sends no projection for at all in a PAST one. js/season.js and
// js/espn.js force a known bye week's projection to exactly 0, once per shape
// (rosters, wire), so every consumer inherits it.
//
// The fixture makes that falsifiable: the Lions (proTeamId 8, bye week 6) D/ST
// STARTS at 4.41 every week, and a Packers D/ST (proTeamId 9, bye week 10) sits
// on the bench at 3.0. Without the rule the optimal lineup keeps the Lions in
// week 6 and scores 24.4; with it, the Packers start and it scores 23.
//
// Every number comes from a raw ESPN payload through a stub `fetch`, so the
// real decoders and the real routing are what is under test.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`);
};
const eq = (a, b, msg) =>
  ok(msg, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ------------------------------------------------------------------ fixture

const LEAGUE_ID = '5550003';
const SEASON = 2026;
const LIONS = 8;     // DET
const PACKERS = 9;   // GB
const BYE_WEEK = 6;
const REGULAR_WEEKS = 14;
const TEAM_COUNT = 10;
const BYES = { settings: { proTeams: [{ id: LIONS, byeWeek: BYE_WEEK }, { id: PACKERS, byeWeek: 10 }] } };

const stat = (week, source, v) => ({ scoringPeriodId: week, statSourceId: source, statSplitTypeId: 1, appliedTotal: v });

/**
 * One week's rosters. Team 1 is the one the assertions read; every other team
 * has a QB and a D/ST so the league is a league.
 *
 * `pastBye`: ESPN's shape for a bye week already played — the Lions D/ST has
 * no projection at all that week, only (here, deliberately) an actual, which
 * the rule must leave alone.
 */
function rosterPayload(week, { pastBye = false } = {}) {
  const entry = (id, slot, pos, proTeamId, stats, extra = {}) => ({
    playerId: id,
    lineupSlotId: slot,
    playerPoolEntry: {
      player: { id, fullName: `Player ${id}`, defaultPositionId: pos, proTeamId, injuryStatus: 'ACTIVE', stats, ...extra },
    },
  });
  const lionsDst = week === BYE_WEEK && pastBye
    ? [stat(week, 0, 9)]
    : [stat(week, 1, 4.41), stat(week, 0, 9)];
  return {
    members: [],
    teams: Array.from({ length: TEAM_COUNT }, (_, i) => {
      const id = i + 1;
      const entries = id === 1
        ? [
          entry(101, 0, 1, PACKERS, [stat(week, 1, 20)]),                 // QB, starts
          entry(102, 16, 16, LIONS, lionsDst),                            // Lions D/ST, starts
          entry(103, 20, 16, PACKERS, [stat(week, 1, 3)]),                // Packers D/ST, bench
          entry(104, 20, 3, LIONS, [stat(week, 1, week === BYE_WEEK ? 0 : 12)]), // a Lions WR: ESPN's own 0.00
          entry(105, 20, 2, PACKERS, [stat(week, 1, 0)], { injuryStatus: 'OUT' }), // OUT, not a bye
        ]
        : [
          entry(id * 100 + 1, 0, 1, 10 + id, [stat(week, 1, 15 + id)]),
          entry(id * 100 + 2, 16, 16, 10 + id, [stat(week, 1, 5)]),
        ];
      return { id, name: `Team ${id}`, abbrev: `T${id}`, roster: { entries } };
    }),
  };
}

function wirePayload(week) {
  const fa = (id, proTeamId, v) => ({
    id,
    status: 'FREEAGENT',
    player: { id, fullName: `Free ${id}`, defaultPositionId: 16, proTeamId, stats: [stat(week, 1, v)] },
  });
  return { players: [fa(901, LIONS, 4.41), fa(902, PACKERS, 3.5)] };
}

/** A 14-week, 10-team season with a 6-team playoff field: weeks 1–2 decided. */
function leaguePayload() {
  const schedule = [];
  for (let week = 1; week <= REGULAR_WEEKS; week++) {
    for (let k = 0; k < TEAM_COUNT / 2; k++) {
      const h = ((k + week) % TEAM_COUNT) + 1;
      const a = ((TEAM_COUNT - 1 - k + week) % TEAM_COUNT) + 1;
      const played = week <= 2;
      schedule.push({
        matchupPeriodId: week,
        home: { teamId: h, totalPoints: played ? 100 + h : 0 },
        away: { teamId: a, totalPoints: played ? 90 + a : 0 },
        winner: played ? 'HOME' : 'UNDECIDED',
        playoffTierType: 'NONE',
      });
    }
  }
  return {
    settings: {
      name: 'Bye League',
      size: TEAM_COUNT,
      scheduleSettings: { matchupPeriodCount: REGULAR_WEEKS, playoffTeamCount: 6 },
      rosterSettings: { lineupSlotCounts: { 0: 1, 16: 1, 20: 3 } },
    },
    members: [],
    teams: Array.from({ length: TEAM_COUNT }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, abbrev: `T${i + 1}`, roster: { entries: [] } })),
    schedule,
  };
}

/** A counting ESPN. `mode.byesDead` refuses the bye read; `mode.dead` everything. */
function installFetch(mode = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const refuse = { ok: false, status: 401, async json() { return {}; } };
    if (mode.dead) return refuse;
    let body;
    const week = Number((u.match(/scoringPeriodId=(\d+)/) || [])[1] || 0);
    if (/proTeamSchedules_wl/.test(u)) {
      if (mode.byesDead) return { ok: false, status: 500, async json() { return {}; } };
      body = BYES;
    } else if (/kona_player_info/.test(u)) body = wirePayload(week || 1);
    else if (week) body = rosterPayload(week, mode);
    else {
      body = leaguePayload();
      if (!/view=mSettings/.test(u)) delete body.settings;
    }
    return { ok: true, status: 200, async json() { return JSON.parse(JSON.stringify(body)); } };
  };
  return calls;
}

const byeCalls = (calls) => calls.filter((u) => /proTeamSchedules_wl/.test(u)).length;

async function load({ cloudTransport = null } = {}) {
  const cloud = await import(moduleUrl('js/cloud.js'));
  if (cloudTransport) cloud.configure({ transport: cloudTransport });
  else cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  const forecast = await import(moduleUrl('js/forecast.js'));
  const projection = await import(moduleUrl('js/projection.js'));
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  return { cloud, espn, season, forecast, projection };
}

const team1 = (teams) => teams.find((t) => t.id === 1);
const byId = (t, id) => t.players.find((p) => p.playerId === id);

/** The best legal lineup for team 1, built the way projection.js builds it. */
function bestLineup(forecast, projection, teams) {
  const counts = projection.slotCountsFromLineups(teams);
  const slots = forecast.slotsFromCounts(counts);
  const pool = team1(teams).players
    .filter((p) => typeof p.projected === 'number')
    .map((p) => ({ playerId: p.playerId, position: p.position, projected: p.projected }));
  return forecast.optimalLineup(pool, slots);
}

// ------------------------------------------------------------------ scenarios

const SCENARIOS = {
  // A FUTURE bye: ESPN's 4.41 for the Lions D/ST becomes 0, and he sits.
  async 'future-bye'() {
    const { season, forecast, projection } = await load();
    const calls = installFetch();

    const { teams } = await season.fetchWeekRosters(BYE_WEEK);
    const t = team1(teams);
    eq(byId(t, 102).projected, 0, 'the Lions D/ST at 4.41 in its bye week is projected 0');
    eq(byId(t, 102).actual, 9, 'his ACTUAL is never touched');
    eq(byId(t, 103).projected, 3, 'the Packers D/ST, not on bye, keeps 3.0');
    eq(byId(t, 104).projected, 0, 'a Lions WR at ESPN\'s own 0.00 stays 0');
    eq(byId(t, 105).projected, 0, 'an OUT man at 0 in a non-bye week stays 0');
    eq(t.projectedTotal, 20, 'the set lineup\'s total no longer counts the bye D/ST (20, not 24.4)');

    const best = bestLineup(forecast, projection, teams);
    const dst = best.starters.find((s) => s.position === 'DST');
    eq(dst && dst.playerId, 103, 'the optimal lineup starts the Packers D/ST, not the one on bye');
    eq(best.total, 23, 'and scores 23, not 24.4');

    const proj = projection.projectionsFromWeekTeams(new Map([[BYE_WEEK, teams]]));
    eq(proj.proj.get(BYE_WEEK).get(1), 23, 'projection.js inherits it: team 1 is 23 in week 6');

    // A NON-bye week is exactly as ESPN sent it.
    const wk5 = await season.fetchWeekRosters(5);
    const t5 = team1(wk5.teams);
    eq(byId(t5, 102).projected, 4.41, 'week 5 is not his bye: 4.41 untouched');
    eq(byId(t5, 104).projected, 12, 'and the WR keeps his 12');
    const best5 = bestLineup(forecast, projection, wk5.teams);
    eq(best5.starters.find((s) => s.position === 'DST').playerId, 102, 'so in week 5 the Lions D/ST starts');

    eq(byeCalls(calls), 1, 'the byes were read once for both weeks (cached)');
  },

  // A PAST bye: ESPN sends no D/ST projection at all. It is a 0, not a null.
  async 'past-bye'() {
    const { season } = await load();
    installFetch({ pastBye: true });
    const { teams } = await season.fetchWeekRosters(BYE_WEEK);
    const d = byId(team1(teams), 102);
    eq(d.projected, 0, 'a past bye week\'s missing D/ST projection is 0');
    eq(d.actual, 9, 'and the actual is still his');
  },

  // The span: one bye read, however many weeks.
  async span() {
    const { season } = await load();
    const calls = installFetch();
    const got = await season.fetchWeeksRosters([4, 5, 6, 7, 8, 9, 10]);
    eq(got.size, 7, 'seven weeks came back');
    eq(byId(team1(got.get(6)), 102).projected, 0, 'week 6 is zeroed');
    eq(byId(team1(got.get(7)), 102).projected, 4.41, 'week 7 is not');
    eq(byeCalls(calls), 1, 'ONE bye read for the whole span');
  },

  // A failed bye read changes nothing, and is asked once per span.
  async 'byes-fail'() {
    const { season } = await load();
    const calls = installFetch({ byesDead: true });
    const got = await season.fetchWeeksRosters([5, 6, 7, 8, 9, 10]);
    eq(byId(team1(got.get(6)), 102).projected, 4.41, 'with the byes unknown, ESPN\'s 4.41 stands');
    eq(byeCalls(calls), 1, 'and the failing read was asked once, not once per week');
    const wire = await season.fetchWireWeek(BYE_WEEK);
    eq(wire.find((p) => p.playerId === 901).projected, 4.41, 'the wire is left alone too');
  },

  // Demo and the pure rule: no byes known, nothing changes.
  async pure() {
    const { espn } = await load();
    eq(espn.byeAdjustedProjection(4.41, LIONS, 6, {}), 4.41, 'empty byes (demo, failure): untouched');
    eq(espn.byeAdjustedProjection(4.41, LIONS, 6, null), 4.41, 'no byes at all: untouched');
    eq(espn.byeAdjustedProjection(4.41, LIONS, 6, { [LIONS]: 6 }), 0, 'known bye: 0');
    eq(espn.byeAdjustedProjection(null, LIONS, 6, { [LIONS]: 6 }), 0, 'known bye, null: 0');
    eq(espn.byeAdjustedProjection(4.41, LIONS, 5, { [LIONS]: 6 }), 4.41, 'another week: untouched');
    eq(espn.byeAdjustedProjection(null, LIONS, 5, { [LIONS]: 6 }), null, 'another week, null: still null');
    eq(espn.byeAdjustedProjection(4.41, null, 6, { [LIONS]: 6 }), 4.41, 'no pro team: untouched');
    eq(espn.byeAdjustedProjection(4.41, LIONS, 6, { [LIONS]: 0 }), 4.41, 'a zero bye week means none');
    const entry = wirePayload(6).players[0];
    eq(espn.parseFreeAgent(entry, 6).projected, 4.41, 'parseFreeAgent without byes: as ESPN sent it');
    eq(espn.parseFreeAgent(entry, 6, { [LIONS]: 6 }).projected, 0, 'parseFreeAgent with byes: 0');
  },

  // The wire, live.
  async wire() {
    const { season } = await load();
    installFetch();
    const w6 = await season.fetchWireWeek(BYE_WEEK);
    eq(w6.find((p) => p.playerId === 901).projected, 0, 'a free-agent Lions D/ST is 0 in its bye week');
    eq(w6.find((p) => p.playerId === 902).projected, 3.5, 'the Packers D/ST is not');
    const w5 = await season.fetchWireWeek(5);
    eq(w5.find((p) => p.playerId === 901).projected, 4.41, 'and week 5 is untouched');
  },

  // The card: a NULL in his bye week reads Bye.
  async card() {
    // The card module wires its listeners at import, so it needs a document.
    const { parseHTML } = await import('linkedom');
    const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
    Object.assign(globalThis, {
      window, document,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    });
    window.matchMedia = globalThis.matchMedia;
    const card = await import(moduleUrl('js/player-card.js'));
    const tok = (v, demo, ctx) => card.projToken(v, demo, ctx);
    eq(tok(null, false, { week: 6, byeWeek: 6 }), { text: 'Bye', kind: 'bye' }, 'a null in his bye week renders Bye');
    eq(tok(undefined, false, { week: 6, byeWeek: 6 }).text, 'Bye', 'so does undefined');
    eq(tok(null, false, { week: 5, byeWeek: 6 }), { text: '—', kind: 'none' }, 'a null in another week is still —');
    eq(tok(null, false, { week: 6, byeWeek: null }), { text: '—', kind: 'none' }, 'a null with the bye unknown is still —');
    eq(tok(null, true, { week: 6, byeWeek: 6 }), { text: '—', kind: 'none' }, 'demo never claims a bye');
    eq(tok(0, false, { week: 6, byeWeek: 6 }).text, 'Bye', 'a 0 in his bye week is Bye, as before');
    eq(tok(0, false, { week: 5, byeWeek: 6, injuryStatus: 'OUT' }).kind, 'out', 'an OUT 0 elsewhere is still out');
    eq(tok(4.41, false, { week: 5, byeWeek: 6 }).text, '4.4', 'a number is a number');
    eq(card.zeroKind(null, { week: 6, byeWeek: 6 }), 'bye', 'zeroKind: null in the bye week is a bye');
    eq(card.zeroKind(null, { week: 5, byeWeek: 6 }), null, 'zeroKind: null elsewhere is not a zero');
    eq(card.zeroKind(null, { byeWeek: 6 }), null, 'zeroKind: null with no week is not a bye');
  },

  // The phone's copy: the zero and the playoff weeks both go up.
  async cloud() {
    const docs = new Map();
    const src = readFileSync(path.join(REPO, 'js/cloud.js'), 'utf8');
    const user = { uid: (src.match(/ownerUid:\s*'([^']*)'/) || [])[1], email: 't@example.com', name: 'T' };
    const transport = {
      async signIn() { return user; },
      async signOut() {},
      currentUser() { return user; },
      onAuth(cb) { cb(user); return () => {}; },
      async getDoc(p) { const r = docs.get(p); return r === undefined ? null : JSON.parse(r); },
      async setDoc(p, d) { docs.set(p, JSON.stringify(d)); },
    };
    const { cloud, espn, season } = await load({ cloudTransport: transport });
    const capture = await import(moduleUrl('js/capture.js'));

    // Desktop: nothing synced yet, so the reads go to ESPN.
    installFetch();
    const payload = await season.buildCloudPayload();

    // The playoff weeks, derived exactly as the Schedule page derives them.
    const data = capture.normalizeSchedule(payload.schedule, { isDemo: false });
    eq(capture.playoffWeeks(data), [15, 16, 17], 'a 14-week league with 6 playoff teams plays weeks 15–17');
    const plan = capture.rosterPlan(data);
    ok('every week the desktop projects is in the sync', plan.asking.every((w) => payload.weeks.includes(w)),
      `asking ${plan.asking} / synced ${payload.weeks}`);
    for (const w of [15, 16, 17]) {
      ok(`week ${w} squads go up`, payload.rosters.has(w), [...payload.rosters.keys()].join(','));
      ok(`week ${w} wire goes up`, payload.wire.has(w), [...payload.wire.keys()].join(','));
    }
    eq(payload.weeks, Array.from({ length: 17 }, (_, i) => i + 1), 'the span is weeks 1–17, no more');
    eq(payload.byes, { [LIONS]: BYE_WEEK, [PACKERS]: 10 }, 'the byes go up');
    eq(byId(team1(payload.rosters.get(BYE_WEEK)), 102).projected, 0, 'the payload carries the zero');
    eq(payload.wire.get(BYE_WEEK).find((p) => p.playerId === 901).projected, 0, 'the synced wire carries it too');

    const up = await cloud.syncUp(LEAGUE_ID, SEASON, payload);
    ok('the sync is written', up.ok, up.reason);
    const biggest = Math.max(...[...docs.entries()].filter(([k]) => /\/rosters\//.test(k)).map(([, v]) => v.length));
    ok('a roster week stays a sane size', biggest < 200 * 1024, biggest);

    // Phone: ESPN refuses everything; the cloud answers.
    espn.clearReadCache();
    const calls = installFetch({ dead: true });
    const wk = await season.fetchWeekRosters(BYE_WEEK);
    eq(byId(team1(wk.teams), 102).projected, 0, 'the SYNCED copy carries the zero');
    eq(byId(team1(wk.teams), 102).actual, 9, 'and the actual');
    const w5 = await season.fetchWeekRosters(5);
    eq(byId(team1(w5.teams), 102).projected, 4.41, 'a non-bye week synced as ESPN sent it');
    const playoffs = await season.fetchWeeksRosters(plan.project);
    ok('the phone has squads for every projected week, the bracket included',
      plan.project.every((w) => playoffs.has(w)), [...playoffs.keys()].join(','));
    const wire = await season.fetchWireWeek(BYE_WEEK);
    eq(wire.find((p) => p.playerId === 901).projected, 0, 'the synced wire carries the zero');
    eq(calls.length, 0, 'the phone asked ESPN for nothing');
  },

  // Points for: unrounded for ranking, one decimal on screen.
  async 'points-for'() {
    const stats = await import(moduleUrl('js/stats.js'));
    // A beats C, B beats D, week 1 only. A and B are both 1-0; B has more.
    // A is listed FIRST, so a tie on rounded points hands A the higher rank.
    const data = {
      season: SEASON,
      weeks: 1,
      teams: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }, { id: 4, name: 'D' }],
      games: [
        { week: 1, homeId: 1, awayId: 3, homeActual: 128.66, awayActual: 100, homeProjected: 110, awayProjected: 110 },
        { week: 1, homeId: 2, awayId: 4, homeActual: 129.02, awayActual: 90, homeProjected: 110, awayProjected: 110 },
      ],
      injuries: [],
    };
    const s = stats.computeLeagueStats(data);
    const t = (id) => s.teams.find((x) => x.id === id);
    eq(t(2).actualStanding, 1, 'B (129.02) ranks first');
    eq(t(1).actualStanding, 2, 'A (128.66) ranks second — not tied with B at 129');
    eq(t(1).totalActual, 128.7, 'A\'s points for shows to one decimal');
    eq(t(2).totalActual, 129, 'B\'s too');
    ok('points for is kept unrounded for sorting', Math.abs(t(1).pointsFor - 128.66) < 1e-9, t(1).pointsFor);
    ok('and B sorts above A on it', t(2).pointsFor > t(1).pointsFor);

    // A season's total to the tenth, as ESPN shows 1845.60 — not 1846.
    const long = {
      ...data,
      games: Array.from({ length: 14 }, (_, i) => [
        { week: i + 1, homeId: 3, awayId: 1, homeActual: 131.83, awayActual: 90, homeProjected: 110, awayProjected: 110 },
        { week: i + 1, homeId: 2, awayId: 4, homeActual: 90, awayActual: 80, homeProjected: 110, awayProjected: 110 },
      ]).flat(),
    };
    const l = stats.computeLeagueStats(long);
    eq(l.teams.find((x) => x.id === 3).totalActual, 1845.6, 'fourteen 131.83s total 1845.6, not 1846');
  },

  // season.js keeps a score to the hundredth, so 128.66 vs 128.70 is not a tie.
  async 'score-precision'() {
    const { season } = await load();
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      let body;
      if (/proTeamSchedules_wl/.test(u)) body = BYES;
      else if (/scoringPeriodId=(\d+)/.test(u)) body = rosterPayload(1);
      else {
        body = leaguePayload();
        body.schedule = [
          { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 128.66 }, away: { teamId: 2, totalPoints: 128.7 }, winner: 'AWAY', playoffTierType: 'NONE' },
        ];
        body.teams = body.teams.slice(0, 2);
        if (!/view=mSettings/.test(u)) delete body.settings;
      }
      return { ok: true, status: 200, async json() { return JSON.parse(JSON.stringify(body)); } };
    };
    const d = await season.fetchSeasonData();
    const g = d.games[0];
    eq([g.homeActual, g.awayActual], [128.66, 128.7], 'scores are kept to the hundredth');
    const stats = await import(moduleUrl('js/stats.js'));
    const s = stats.computeLeagueStats(d);
    const t2 = s.teams.find((x) => x.id === 2);
    eq([t2.wins, t2.ties], [1, 0], '128.70 beats 128.66 — a win, not a tie');
  },
};

// ------------------------------------------------------------------ run

const scen = process.argv[2];
if (scen) {
  try {
    await SCENARIOS[scen]();
  } catch (err) {
    fails.push(`threw: ${err && err.stack || err}`);
  }
  console.log(JSON.stringify({ scen, pass, fails }));
  process.exit(fails.length ? 1 : 0);
}

const self = fileURLToPath(import.meta.url);
let total = 0;
let bad = 0;
for (const name of Object.keys(SCENARIOS)) {
  const res = spawnSync(process.execPath, [self, name], { encoding: 'utf8', timeout: 60000 });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  let r = null;
  try { r = JSON.parse(line); } catch { /* below */ }
  if (!r) {
    bad++;
    console.log(`FAIL ${name}\n  stdout=${(res.stdout || '').slice(0, 800)}\n  stderr=${(res.stderr || '').slice(0, 1500)}`);
    continue;
  }
  total += r.pass;
  if (r.fails.length) {
    bad++;
    console.log(`FAIL ${name}  (${r.pass} assertions)`);
    for (const f of r.fails) console.log(`   - ${f}`);
  } else {
    console.log(`PASS ${name}  (${r.pass} assertions)`);
  }
}
if (bad) {
  console.log(`\n${total} passed, ${bad} failed (scenarios)`);
  process.exit(1);
}
console.log(`\nAll ${total} assertions passed across ${Object.keys(SCENARIOS).length} scenarios`);
