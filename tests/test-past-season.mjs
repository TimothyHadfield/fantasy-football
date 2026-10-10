// AN EARLIER SEASON OF A LEAGUE (main menu, Tim 2026-10-10: "look into past
// leagues" = earlier seasons): js/season.js never makes, keeps or sends Value
// lines for one.
//
//   node test-past-season.mjs              all scenarios
//   node test-past-season.mjs past-mint    just that one
//
// WHY IT NEEDS A RULE AT ALL. Value is an average over the weeks LEFT, and a
// finished season has none — on a league whose feed carries its bracket.
// MEASURED 2026-10-10 on public league 1241838, seasons 2025, 2024 and 2021:
// every regular game HOME/AWAY, every bracket game decided, and two bracket
// BYES in the first playoff week that stay `winner: 'UNDECIDED'` with no away
// side for ever. That shape (`bracket: 'decided'` below) already yields no
// weeks. But "none left" is read off the bracket's own games, and a league
// whose feed has NO bracket games keeps its playoff weeks "left" for good —
// while ESPN still answers those weeks' squads and wire for a past season
// (measured: week 3 of 2025, 175 roster entries, every one with a projection
// AND a score). The lines made from that would be frozen and, on a sync, sent
// up under first-copy-wins. `bracket: 'none'` is that league.
//
// EVERY SCENARIO IS ITS OWN CHILD PROCESS: js/season.js keeps memos per page
// load, and js/bridge.js decides at import whether there is a browser.
//
// The seasons are worked out from `bridge.currentSeason()` — never a literal
// year — so this suite means the same thing next year.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { moduleUrl, repoFile } from './repo.mjs';

const results = [];
let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) { pass++; results.push(`   ok ${msg}`); }
  else { fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`); results.push(`   FAIL ${msg}`); }
};
const eq = (a, b, msg) => ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// =========================================================================
// THE FIXTURE: a finished season, in the shapes ESPN sends
// =========================================================================
//
// Four teams, three regular weeks, then a four-team bracket in weeks 4 and 5.
// Nine starters and six on the bench; every position somebody holds has a free
// agent — so a WHOLE reading is on offer, and the only thing that can stop the
// lines being made is the rule under test.

const LEAGUE_ID = '1241838';
const TEAMS = [
  { id: 1, teamName: 'The Aardvarks', abbrev: 'AAR' },
  { id: 2, teamName: 'Benned For Life', abbrev: 'BEN' },
  { id: 3, teamName: 'Calamity', abbrev: 'CAL' },
  { id: 4, teamName: 'Deep Threats', abbrev: 'DEE' },
];
const SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17, 20, 20, 20, 20, 20, 20];
const POS = [1, 2, 2, 3, 3, 4, 2, 16, 5, 2, 3, 1, 4, 3, 2];
const SETTINGS = (name) => ({
  name,
  size: TEAMS.length,
  rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 6 } },
});

/** A week's squads. A finished season carries a projection AND a score for every man, every week. */
function rosterPayload(week, seasonId) {
  return {
    settings: SETTINGS('The Keeper League'),
    status: { currentMatchupPeriod: 5, finalScoringPeriod: 5, latestScoringPeriod: 7 },
    members: [],
    teams: TEAMS.map((t) => ({
      id: t.id,
      name: t.teamName,
      abbrev: t.abbrev,
      roster: {
        entries: SLOTS.map((slot, i) => ({
          playerId: t.id * 100 + i,
          lineupSlotId: slot,
          playerPoolEntry: {
            player: {
              fullName: `${t.abbrev} Player ${i}`,
              defaultPositionId: POS[i],
              proTeamId: (i % 30) + 1,
              injuryStatus: 'ACTIVE',
              ownership: { percentOwned: 50 + i },
              stats: [
                { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 10 + i + week * 0.1 },
                { scoringPeriodId: week, statSourceId: 0, statSplitTypeId: 1, appliedTotal: 11 + i },
                { seasonId, statSourceId: 1, statSplitTypeId: 0, appliedTotal: (10 + i) * 13 },
              ],
            },
          },
        })),
      },
    })),
  };
}

function wirePayload(week, seasonId) {
  return {
    players: Array.from({ length: 9 }, (_, i) => ({
      player: {
        id: 9000 + i,
        fullName: `Free Agent ${i}`,
        defaultPositionId: POS[i % POS.length],
        proTeamId: (i % 30) + 1,
        injuryStatus: 'ACTIVE',
        ownership: { percentOwned: 30 - i },
        stats: [
          { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 10 - i },
          { seasonId, statSourceId: 1, statSplitTypeId: 0, appliedTotal: (10 - i) * 13 },
        ],
      },
    })),
  };
}

const side = (teamId, pts) => ({ teamId, totalPoints: pts });

/** The season's schedule: every regular game decided, and the bracket as asked. */
function matchupPayload(bracket) {
  const schedule = [];
  const pairs = { 1: [[1, 2], [3, 4]], 2: [[1, 3], [2, 4]], 3: [[1, 4], [2, 3]] };
  for (const week of [1, 2, 3]) {
    for (const [home, away] of pairs[week]) {
      schedule.push({
        matchupPeriodId: week, playoffTierType: 'NONE', winner: 'AWAY',
        home: side(home, 100 + home), away: side(away, 103 + away),
      });
    }
  }
  if (bracket === 'decided') {
    schedule.push(
      // A bracket bye, as ESPN keeps it for good: one side, UNDECIDED.
      { matchupPeriodId: 4, playoffTierType: 'WINNERS_BRACKET', winner: 'UNDECIDED', home: side(1, 86.52) },
      { matchupPeriodId: 4, playoffTierType: 'WINNERS_BRACKET', winner: 'HOME', home: side(2, 120.5), away: side(3, 99.1) },
      { matchupPeriodId: 5, playoffTierType: 'WINNERS_BRACKET', winner: 'AWAY', home: side(1, 101.2), away: side(2, 147.82) },
      { matchupPeriodId: 5, playoffTierType: 'LOSERS_CONSOLATION_LADDER', winner: 'HOME', home: side(3, 110), away: side(4, 90.4) },
    );
  }
  return {
    settings: { ...SETTINGS('The Keeper League'), scheduleSettings: { matchupPeriodCount: 3, playoffTeamCount: 4 } },
    status: { currentMatchupPeriod: 5, finalScoringPeriod: 5, latestScoringPeriod: 7 },
    members: [],
    teams: TEAMS.map((t) => ({ id: t.id, name: t.teamName, abbrev: t.abbrev, roster: { entries: [] } })),
    schedule,
  };
}

const BYES_PAYLOAD = {
  settings: { proTeams: Array.from({ length: 15 }, (_, i) => ({ id: i + 1, byeWeek: i === 0 ? 4 : 9 })) },
};

/** ESPN, answering every read a page or a sync makes; returns the list of URLs asked. */
function installFetch({ bracket, seasonId }) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const week = Number((u.match(/scoringPeriodId=(\d+)/) || [])[1] || 0);
    const body = /proTeamSchedules_wl/.test(u)
      ? BYES_PAYLOAD
      : /kona_player_info/.test(u)
        ? wirePayload(week || 1, seasonId)
        : week || /mRoster/.test(u)
          ? rosterPayload(week || 1, seasonId)
          : matchupPayload(bracket);
    return { ok: true, status: 200, async json() { return body; } };
  };
  return calls;
}
const wireReads = (calls) => calls.filter((u) => /kona_player_info/.test(u)).length;

function installStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  return map;
}

// The fake Firestore of tests/test-cloud-wiring.mjs, signed in as the owner.
const OWNER_UID = (readFileSync(repoFile('js/cloud.js'), 'utf8').match(/ownerUid:\s*'([^']*)'/) || [])[1] || 'uid-tim';
function makeFake() {
  const docs = new Map();
  const user = { uid: OWNER_UID, email: 'tim@example.com', name: 'Tim' };
  return {
    docs,
    async signIn() { return user; },
    async signOut() {},
    currentUser() { return user; },
    onAuth(cb) { cb(user); return () => {}; },
    async getDoc(p) { const raw = docs.get(p); return raw === undefined ? null : JSON.parse(raw); },
    async setDoc(p, data) { docs.set(p, JSON.stringify(data)); },
  };
}

/** The modules, the league on `season`, a browser's storage and a cloud that is switched off. */
async function world({ seasonOffset, bracket, withCloud = false }) {
  const map = installStorage();
  const bridge = await import(moduleUrl('js/bridge.js'));
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  const capture = await import(moduleUrl('js/capture.js'));
  const year = bridge.currentSeason() + seasonOffset;
  const fake = withCloud ? makeFake() : null;
  if (fake) cloud.configure({ transport: fake });
  else cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  espn.configure({ leagueId: LEAGUE_ID, season: year });
  const calls = installFetch({ bracket, seasonId: year });
  return { map, cloud, espn, season, capture, year, calls, fake, key: `ff.value.${LEAGUE_ID}-${year}` };
}

/** Nothing of Value's anywhere: no lines, no weeks, nobody's number, nothing kept. */
async function noValue(w, name) {
  eq(await w.season.fetchValueBase(), null, `${name}: no lines`);
  const vals = await w.season.fetchPlayerValues();
  eq(vals.base, null, `${name}: fetchPlayerValues carries no lines`);
  ok(`${name}: and no weeks`, same(vals.weeks, []), JSON.stringify(vals.weeks));
  eq(vals.byId.size, 0, `${name}: nobody has an entry`);
  eq(vals.lookup(100), null, `${name}: a rostered man's Value is null — his card carries none`);
  ok(`${name}: nothing was kept in this browser`, ![...w.map.keys()].some((k) => k.startsWith('ff.value.')),
    [...w.map.keys()].join(' '));
}

const SCENARIOS = {};

// ---------------------------------------------------------------- past-mint
//
// The league with no bracket in its feed, on LAST season. ESPN would answer
// every read; nothing may be made.
SCENARIOS['past-mint'] = async () => {
  const w = await world({ seasonOffset: -1, bracket: 'none' });
  const schedule = await w.season.fetchSchedule();
  eq(schedule.games.length, 6, 'the fixture reads as a season: six regular games');
  ok('every one decided', schedule.games.every((g) => g.played));
  // The trap itself, stated so the scenario cannot go vacuous: with no bracket
  // games the playoff weeks read as still to come.
  ok('(its playoff weeks read as "left": no bracket game ever decides them)',
    same(w.season.valueWeeks(schedule), [4, 5]), JSON.stringify(w.season.valueWeeks(schedule)));
  await noValue(w, 'last season, no bracket in the feed');
  eq(wireReads(w.calls), 0, 'and the wire was never read for it');
};

// ------------------------------------------------------------ past-finished
//
// The measured shape: bracket decided, one bye left UNDECIDED for good.
SCENARIOS['past-finished'] = async () => {
  const w = await world({ seasonOffset: -1, bracket: 'decided' });
  const schedule = await w.season.fetchSchedule();
  const data = w.capture.normalizeSchedule(schedule, { isDemo: false });
  eq(schedule.playoffGames.length, 4, 'the bracket rides apart from the regular season: four entries');
  ok('the season reads as over, the undecided bye notwithstanding', w.capture.seasonOver(data));
  ok('no week is left', same(w.season.valueWeeks(schedule), []), JSON.stringify(w.season.valueWeeks(schedule)));
  await noValue(w, 'last season, finished');
  eq(wireReads(w.calls), 0, 'and the wire was never read for it');
};

// ---------------------------------------------------------------- past-older
SCENARIOS['past-older'] = async () => {
  const w = await world({ seasonOffset: -5, bracket: 'none' });
  await noValue(w, 'five seasons back');
};

// ----------------------------------------------------------------- past-kept
//
// Lines already sitting in this browser under an earlier season's key (a
// season that WAS current when they were made): not handed out — there is no
// week to average over — and NOT deleted. Nothing is ever deleted.
SCENARIOS['past-kept'] = async () => {
  const w = await world({ seasonOffset: -1, bracket: 'none' });
  const old = { v: 1, setAt: 1, week: 3, lines: { QB: { waiver: 10, starter: 20, agents: 3, starters: 4 } } };
  w.map.set(w.key, JSON.stringify(old));
  eq(await w.season.fetchValueBase(), null, 'kept lines of an earlier season are not handed out');
  eq((await w.season.fetchPlayerValues()).lookup(100), null, 'so nobody has a Value');
  ok('and they are left exactly where they were', w.map.get(w.key) === JSON.stringify(old), w.map.get(w.key));
};

// ----------------------------------------------------------------- past-sync
//
// A sync of an earlier season (js/connection.js is meant never to start one;
// this is the second lock): the schedule goes up with NO valueBase, so nothing
// is frozen in the cloud under first-copy-wins.
SCENARIOS['past-sync'] = async () => {
  const w = await world({ seasonOffset: -1, bracket: 'none', withCloud: true });
  const payload = await w.season.buildCloudPayload();
  ok('the payload was built', !!payload && !!payload.schedule, JSON.stringify(Object.keys(payload || {})));
  ok('its schedule carries no valueBase', !('valueBase' in payload.schedule), JSON.stringify(payload.schedule.valueBase));
  ok('and nothing was kept in this browser', !w.map.has(w.key), w.map.get(w.key));
  ok('nor is anything of Value\'s in what would be written', !/valueBase/.test(JSON.stringify(payload)));
};

// ------------------------------------------------------------------- current
//
// NOT VACUOUS, and the season being played is untouched: the very same league
// and readings on THIS season make lines, keep them, and give men a Value.
SCENARIOS.current = async () => {
  const w = await world({ seasonOffset: 0, bracket: 'none' });
  const base = await w.season.fetchValueBase();
  ok('this season: the same reading makes lines', !!base && base.v === 1 && !!base.lines.QB, JSON.stringify(base));
  eq(base && base.week, 4, 'set in the first week left');
  eq(wireReads(w.calls), 2, 'one wire read for each week left');
  ok('kept under the league and season', same(JSON.parse(w.map.get(w.key) || 'null'), base), [...w.map.keys()].join(' '));
  const vals = await w.season.fetchPlayerValues();
  ok('over the weeks left', same(vals.weeks, [4, 5]), JSON.stringify(vals.weeks));
  eq(vals.byId.size, 60, 'everybody on a squad has an entry');
  ok('and a starter has a Value above zero', vals.lookup(114) > 0, String(vals.lookup(114)));
};

// --------------------------------------------------------------- current-sync
SCENARIOS['current-sync'] = async () => {
  const w = await world({ seasonOffset: 0, bracket: 'none', withCloud: true });
  const payload = await w.season.buildCloudPayload();
  const base = payload && payload.schedule ? payload.schedule.valueBase : null;
  ok('this season: the sync\'s schedule carries valueBase', !!base && base.v === 1 && !!base.lines.QB, JSON.stringify(base));
  ok('and this browser kept it', same(JSON.parse(w.map.get(w.key) || 'null'), base), w.map.get(w.key));
};

// =========================================================================
// RUNNER (the shape of tests/test-cloud-wiring.mjs)
// =========================================================================

const self = fileURLToPath(import.meta.url);
const asked = process.argv[2];

if (asked) {
  const fn = SCENARIOS[asked];
  if (!fn) {
    console.log(`no scenario named ${asked}`);
    process.exit(2);
  }
  const rejections = [];
  process.on('unhandledRejection', (e) => rejections.push(String((e && e.message) || e)));
  try {
    await fn();
  } catch (err) {
    fails.push(`threw: ${(err && err.stack) || err}`);
  }
  ok('no unhandled rejections', rejections.length === 0, rejections.join(' | '));
  console.log(results.join('\n'));
  console.log(JSON.stringify({ scenario: asked, pass, fails }));
  process.exit(fails.length ? 1 : 0);
}

const order = Object.keys(SCENARIOS);
let total = 0;
let failed = 0;
for (const name of order) {
  const res = spawnSync(process.execPath, [self, name], { encoding: 'utf8', timeout: 5 * 60 * 1000 });
  const out = (res.stdout || '') + (res.stderr || '');
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch { /* fall through */ }
  if (!parsed) {
    failed++;
    console.log(`FAIL ${name} — no result`);
    console.log(out.trimEnd().split('\n').slice(-25).map((l) => `    ${l}`).join('\n'));
    continue;
  }
  total += parsed.pass;
  if (parsed.fails.length) {
    failed++;
    console.log(`FAIL ${name}  (${parsed.pass} passed, ${parsed.fails.length} failed)`);
    for (const f of parsed.fails) console.log(`   ✗ ${f}`);
  } else {
    console.log(`PASS ${name}  (${parsed.pass} assertions)`);
  }
}

console.log(failed
  ? `\n${failed} of ${order.length} scenarios failed`
  : `\nAll ${total} assertions passed across ${order.length} scenarios`);
process.exit(failed ? 1 : 0);
