// NOTIFICATIONS — the loader: gathers what js/notify.js needs, for YOUR team.
//
// Everything is read through js/season.js, which already goes bridge → cloud →
// ESPN with the store in front, so a week this browser holds costs nothing and
// the phone's synced copy asks ESPN for nothing at all (rule 20).
//
//   refresh()      works the list out and resolves with the lines. The cheap
//                  ones first (this week's lineup, offers, saved deals), then
//                  the coming weeks, then the pick-ups, which want the waiver
//                  wire of every week they are priced over (and the wire of a
//                  later week that has a hole, for the man to add:
//                  `HOLE_WIRE_MAX`). `onUpdate(notes)` is called as each part
//                  arrives.
//   load()         the same run, resolving with the whole state the page draws
//                  (`status`, `notes`, `week`, …).
//   savedCount()   `{ now, soon, idea, fresh }` — the counts the last run left,
//                  for the bell. No read of any kind.
//
// THIS FILE IS THE ONLY WRITER OF THE COUNT (docs/notifications-plan.md, After
// review 2): `ff.notes.<leagueId>-<season>` =
// `{ v:1, team, week, at, now, soon, idea, until }`. The league is in the key's
// NAME, so js/leagues.js's parking is not involved. `until` is the next NFL
// kickoff after `at` (null when the kickoffs were not read): a count is fresh
// for the same league, season and team, under three hours old, and with no
// kickoff since it was saved — a kickoff is what locks a lineup and ends a week.
//
// The heavy modules (js/season.js, js/trade.js behind the Gain engine, the
// sample league) are imported only when a run starts, so a page that only
// shows the bell's saved count loads none of them for it.

import { savedConfig, pastSeason } from './connection.js';
import { readSendLater } from './notify-trades.js';

/** A saved count older than this is worked out again. */
export const FRESH_MS = 3 * 60 * 60 * 1000;

/** How many weeks the pick-ups are priced over: the Players page's default span. */
export const GAIN_WEEKS = 3;

/**
 * A coming week with a slot nobody can fill is answered with a man to add, and
 * he comes off THAT week's wire. A hole beyond the weeks the pick-ups already
 * read costs one more wire read; this many at most, nearest holes first. A
 * hole past them says the position and names nobody.
 */
export const HOLE_WIRE_MAX = 3;

export const countKey = (leagueId, season) => `ff.notes.${leagueId}-${season}`;
export const tradesKey = (leagueId, season) => `ff.notes.trades.${leagueId}-${season}`;

const ZERO = { now: 0, soon: 0, idea: 0 };

function readJson(key) {
  try {
    const v = JSON.parse(globalThis.localStorage.getItem(key) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage refused: the bell simply asks again next time */ }
}

/**
 * The counts the last run saved, and whether they can still be shown as they
 * are. Not fresh → the caller asks `refresh()` (in the background) and shows
 * these meanwhile.
 *
 * With nothing to count — no league connected, an earlier season, no team
 * chosen — the answer is zeros that ARE fresh: there is nothing to work out.
 */
export function savedCount(now = Date.now()) {
  const cfg = savedConfig();
  if (!cfg || pastSeason(cfg.season) || cfg.teamId === null || cfg.teamId === undefined) {
    return { ...ZERO, fresh: true };
  }
  const rec = readJson(countKey(cfg.leagueId, cfg.season));
  if (!rec || rec.v !== 1 || String(rec.team) !== String(cfg.teamId)) return { ...ZERO, fresh: false };
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const age = now - Number(rec.at);
  const fresh = Number.isFinite(age) && age >= 0 && age < FRESH_MS &&
    !(Number.isFinite(rec.until) && now >= rec.until);
  return { now: n(rec.now), soon: n(rec.soon), idea: n(rec.idea), fresh };
}

/** The week being played next: the first with a game not yet final (Home's rule), or null. */
function currentWeek(schedule) {
  const pending = (schedule.weeks || []).find((w) =>
    (schedule.byWeek.get(w) || []).some((g) => !g.played));
  return pending ?? null;
}

const sameId = (a, b) => a !== null && a !== undefined && String(a) === String(b);

/** The next kickoff after `now` in `{ [proTeamId]: { [week]: epochMs } }`, or null. */
function nextKickoff(kickoffs, now) {
  let next = null;
  for (const byWeek of Object.values(kickoffs || {})) {
    for (const at of Object.values(byWeek || {})) {
      if (Number.isFinite(at) && at > now && (next === null || at < next)) next = at;
    }
  }
  return next;
}

/** week -> (playerId -> projection) off roster weeks, every squad's men. */
function rosterProjections(weekTeams) {
  const out = new Map();
  for (const [week, teams] of weekTeams) {
    const by = new Map();
    for (const t of teams || []) {
      for (const p of t.players || []) {
        if (p.playerId !== null && p.playerId !== undefined) by.set(p.playerId, p.projected);
      }
    }
    out.set(Number(week), by);
  }
  return out;
}

/**
 * What the Gain engine is fed, built the way js/waivers-page.js `prepareGain`
 * builds it: your men off the rosters, a free agent off the wire, anything but
 * a number is "no projection".
 *
 * `projFor` knows every week in `wires` — the weeks priced and the weeks read
 * only because they have a hole — but the POOL of pick-ups is the priced weeks'
 * alone, so a hole's wire never changes which pick-ups are suggested.
 *
 * @param {number[]} weeks the weeks priced, ascending
 * @param {Map<number, Array>} wires week -> that week's free agents
 * @param {Map<number, Array>} weekTeams week -> squads
 * @param {Object} team your squad
 */
function wireInput({ weeks, wires, weekTeams, team, floors }) {
  const held = new Set((team.players || []).map((p) => p.playerId));
  const rosterProj = rosterProjections(weekTeams);
  const wireProj = new Map();
  const pool = new Map();
  for (const [w, agents] of wires) {
    const by = new Map();
    const priced = weeks.includes(w);
    for (const p of agents || []) {
      if (p.playerId === null || p.playerId === undefined) continue;
      by.set(p.playerId, p.projected);
      if (priced && !pool.has(p.playerId)) pool.set(p.playerId, { playerId: p.playerId, name: p.name, position: p.position });
    }
    wireProj.set(w, by);
  }
  const seen = new Map();
  const projFor = (p, week) => {
    const at = `${p.playerId}|${week}`;
    if (seen.has(at)) return seen.get(at);
    const v = ((held.has(p.playerId) ? rosterProj : wireProj).get(week) || new Map()).get(p.playerId);
    const n = typeof v === 'number' ? v : null;
    seen.set(at, n);
    return n;
  };
  return { weeks, pool: [...pool.values()], projFor, floors: floors || null };
}

/** The weeks with a hole whose wire is not being read already: the nearest `HOLE_WIRE_MAX`. */
function holeWireWeeks(engine, { coming, slots, span, allowed = null }) {
  return engine.holeWeeks({ coming, slots })
    .filter((w) => !span.includes(w) && (!allowed || allowed.has(Number(w))))
    .slice(0, HOLE_WIRE_MAX);
}

// -------------------------------------------------------------- the runs

/** Everything a run imports, once. */
let heavy = null;
function modules() {
  if (!heavy) {
    heavy = Promise.all([
      import('./notify.js'), import('./season.js'), import('./espn.js'),
      import('./trade.js'), import('./projection.js'), import('./start-sit.js'),
    ]).then(([engine, season, espn, trade, projection, startSit]) =>
      ({ engine, season, espn, trade, projection, startSit }));
    heavy.catch(() => { heavy = null; });
  }
  return heavy;
}

const slotsOf = (m, teams) => m.trade.slotsForLeague(m.projection.slotCountsFromLineups(teams));

/** The sample league: no league is connected, so nothing is read and nothing is saved. */
async function runDemo(emit) {
  const m = await modules();
  const demo = await import('./demo-rosters.js');
  const schedule = demo.generateDemoSchedule();
  const week = demo.DEMO_CURRENT_WEEK;
  const teams = demo.generateDemoWeekRosters(week).teams;
  // The sample league has no owner: the first squad stands in, as on Players.
  const team = teams[0] || null;
  const base = {
    week, teamId: team ? team.id : null, league: null, team, teams,
    slots: slotsOf(m, teams),
    // Every sample week carries its scores; the sample is PRETENDED to be at
    // this week, so nobody has kicked off in it.
    isLocked: () => false,
    saved: null, now: Date.now(),
  };
  const state = { status: 'demo', isDemo: true, week, teamId: base.teamId, league: null };
  emit({ ...state, notes: m.engine.buildNotes(base), pending: true });

  const later = (schedule.weeks || []).filter((w) => w > week);
  const weekTeams = new Map([[week, teams]]);
  for (const w of later) weekTeams.set(w, demo.generateDemoWeekRosters(w).teams);
  const coming = later.map((w) => ({
    week: w, players: ((weekTeams.get(w) || []).find((t) => sameId(t.id, base.teamId)) || {}).players || [],
  }));
  emit({ ...state, notes: m.engine.buildNotes({ ...base, coming }), pending: true });

  const weeks = [week, ...later].slice(0, GAIN_WEEKS);
  const extra = holeWireWeeks(m.engine, { coming, slots: base.slots, span: weeks });
  const wires = new Map([...weeks, ...extra].map((w) => [w, demo.generateDemoFreeAgents(w)]));
  const wire = team ? wireInput({ weeks, wires, weekTeams, team, floors: null }) : null;
  const fill = wire ? { byWeek: wires, weeks, projFor: wire.projFor, floors: null } : null;
  return { ...state, notes: m.engine.buildNotes({ ...base, coming, wire, fill }), pending: false };
}

async function runLive(cfg, emit, { fresh = false } = {}) {
  const league = { leagueId: cfg.leagueId, season: cfg.season };
  const state = { status: 'live', isDemo: false, week: null, teamId: cfg.teamId, league };
  // An earlier season is finished and read-only: nothing to do, nothing read.
  if (pastSeason(cfg.season)) return { ...state, status: 'past', notes: [], pending: false };

  const m = await modules();
  const { season } = m;
  m.espn.configure({ leagueId: cfg.leagueId, season: cfg.season });
  const has = (name) => typeof season[name] === 'function';

  const schedule = await season.fetchSchedule();
  const week = currentWeek(schedule);
  if (week === null) return { ...state, status: 'over', notes: [], pending: false };
  state.week = week;
  if (cfg.teamId === null || cfg.teamId === undefined) return { ...state, status: 'noteam', notes: [], pending: false };

  // Known BEFORE any roster is read: on the synced copy the byes are handed to
  // every roster read (the copy's own, or none), because a read left to find
  // them itself asks ESPN when the copy has none.
  let cloud = null;
  try { cloud = has('cloudSource') ? await season.cloudSource() : null; } catch { cloud = null; }
  const cloudByes = cloud ? (cloud.byes || {}) : null;

  const rosters = await season.fetchWeekRosters(week, {
    ...(fresh ? { fresh: true } : {}), ...(cloud ? { byes: cloudByes } : {}),
  });
  const teams = (rosters && rosters.teams) || [];
  const team = teams.find((t) => sameId(t.id, cfg.teamId)) || null;
  if (!team) return { ...state, status: 'noteam', notes: [], pending: false };

  // THE SYNCED COPY ASKS ESPN FOR NOTHING: its byes ride the copy itself, and
  // the NFL's kickoffs are not on it, so there the roster's own evidence locks
  // who has played (as on Home).
  let byes = null;
  let kickoffs = null;
  try {
    if (cloud) byes = cloud.byes || null;
    else if (has('fetchByeWeeks')) byes = await season.fetchByeWeeks();
    if (!cloud && has('fetchProKickoffs')) kickoffs = await season.fetchProKickoffs();
  } catch { /* unknown byes and kickoffs: fewer lines, never a wrong one */ }
  if (byes && !Object.keys(byes).length) byes = null;

  const now = Date.now();
  const isLocked = (p) => {
    if (m.startSit.hasPlayed(p)) return true;
    const at = kickoffs && kickoffs[p.proTeamId] && kickoffs[p.proTeamId][week];
    return Number.isFinite(at) && at <= now;
  };

  // Offers waiting on ESPN: `[]` when the read is not there yet, or fails.
  let offers = [];
  try {
    if (has('fetchPendingTrades')) offers = (await season.fetchPendingTrades()) || [];
  } catch { offers = []; }

  const base = {
    week, teamId: cfg.teamId, league, team, teams, slots: slotsOf(m, teams), isLocked, byes,
    offers,
    // On the synced copy an offer is as old as the sync that carried it.
    offersAt: cloud && has('weekReadAt') ? season.weekReadAt(week) : null,
    saved: readJson(tradesKey(cfg.leagueId, cfg.season)),
    later: readSendLater(cfg.leagueId, cfg.season),
    now,
  };
  emit({ ...state, notes: m.engine.buildNotes(base), pending: true });

  // THE COMING WEEKS: one roster read a week, out of the store where held.
  const left = has('valueWeeks') ? season.valueWeeks(schedule) : (schedule.weeks || []);
  // On the synced copy only the weeks it HOLDS are asked for: a week it lacks
  // would fall through to ESPN, and the phone asks ESPN for nothing.
  const held = (shape) => new Set(((cloud && cloud.weeks && cloud.weeks[shape]) || []).map(Number));
  const heldRosters = held('rosters');
  const heldWire = held('wire');
  const later = left.filter((w) => w > week && (!cloud || heldRosters.has(Number(w))));
  let weekTeams = new Map();
  try {
    if (later.length && cloud) {
      // Week by week with the copy's byes: the span read fetches the byes itself.
      for (const w of later) {
        const got = await season.fetchWeekRosters(w, { byes: cloudByes });
        if (got && got.teams && got.teams.length) weekTeams.set(w, got.teams);
      }
    } else if (later.length) weekTeams = (await season.fetchWeeksRosters(later)) || new Map();
  } catch { weekTeams = new Map(); }
  const coming = later.map((w) => ({
    week: w, players: ((weekTeams.get(w) || []).find((t) => sameId(t.id, cfg.teamId)) || {}).players || [],
  }));
  emit({ ...state, notes: m.engine.buildNotes({ ...base, coming }), pending: true });

  // THE PICK-UPS: the wire of each week priced. A week with a finished game in
  // it is locked — no claim made now can move it (the Players page's rule).
  const underWay = teams.some((t) => (t.players || []).some((p) => p.done === true));
  const near = [week, ...later].slice(0, GAIN_WEEKS).filter((w) => !(w === week && underWay));
  const span = near.filter((w) => !cloud || heldWire.has(Number(w)));
  // THE HOLES' OWN WIRE: a hole beyond those weeks is one more read each, a
  // few at most — and on the synced copy only a week the copy holds.
  const extra = holeWireWeeks(m.engine, {
    coming, slots: base.slots, span, allowed: cloud ? heldWire : null,
  });
  const wires = new Map();
  await Promise.all([...span, ...extra].map(async (w) => {
    try {
      const got = await season.fetchWireWeek(w);
      if (got && got.length) wires.set(w, got);
    } catch { /* that week's wire would not answer: it is not priced */ }
  }));
  weekTeams.set(week, teams);
  // The run of weeks held from the first one, as on Players: a gap ends it.
  const weeks = [];
  for (const w of span) {
    if (!wires.has(w) || !weekTeams.has(w)) break;
    weeks.push(w);
  }
  let floors = null;
  try {
    const f = weeks.length && has('fetchFloors') ? await season.fetchFloors(week) : null;
    floors = f && f.size ? f : null;
  } catch { floors = null; }
  const input = wireInput({ weeks, wires, weekTeams, team, floors });
  const wire = weeks.length ? input : null;
  // Who to drop for a hole's man is priced over the pick-ups' weeks (whether or
  // not their wire was read: your own men's numbers come off the rosters).
  const fill = {
    byWeek: wires, weeks: near.filter((w) => weekTeams.has(w)), projFor: input.projFor, floors,
  };
  const notes = m.engine.buildNotes({ ...base, coming, wire, fill });

  writeJson(countKey(cfg.leagueId, cfg.season), {
    v: 1, team: cfg.teamId, week, at: Date.now(), ...m.engine.countNotes(notes),
    until: nextKickoff(kickoffs, Date.now()),
  });
  return { ...state, notes, pending: false };
}

/** The run in the air, shared: the bell and the page ask in the same moment. */
let inflight = null;

/**
 * Work the list out. Resolves with
 * `{ status, notes, pending, week, teamId, league, isDemo, error? }`:
 *
 *   status  'demo'    no league connected: the sample league's lines
 *           'live'    your league's lines
 *           'past'    an earlier season — finished, nothing listed
 *           'over'    this season has no week left to play
 *           'noteam'  nobody is set as you in the connection bar
 *           'error'   the league could not be read (`error` says why)
 *
 * `onUpdate(state)` is called as parts arrive, with `pending: true` until the
 * last. `fresh: true` re-reads this week's rosters from ESPN (after a lineup
 * change) and never shares an earlier run.
 */
export function load({ onUpdate = null, fresh = false } = {}) {
  const cfg = savedConfig();
  // Joined only when it is working out the SAME league, season and team: a run
  // for the team picked a moment ago is not this one's (sweep 2026-10-16 #7).
  const key = cfg ? `${cfg.leagueId}|${cfg.season}|${cfg.teamId}` : 'demo';
  if (inflight && !fresh && inflight.key === key) {
    if (onUpdate) inflight.listeners.add(onUpdate);
    return inflight.promise;
  }
  const listeners = new Set(onUpdate ? [onUpdate] : []);
  const emit = (state) => {
    for (const fn of listeners) {
      try { fn(state); } catch { /* a listener's own problem */ }
    }
  };
  const job = { listeners, promise: null, key };
  job.promise = (cfg ? runLive(cfg, emit, { fresh }) : runDemo(emit))
    .catch((err) => ({
      status: 'error', isDemo: false, notes: [], pending: false, week: null,
      teamId: cfg ? cfg.teamId : null, league: cfg ? { leagueId: cfg.leagueId, season: cfg.season } : null,
      error: String((err && err.message) || err),
    }))
    .then((state) => {
      if (inflight === job) inflight = null;
      emit(state);
      return state;
    });
  inflight = job;
  return job.promise;
}

/**
 * The same run, for a caller that only wants the lines (the bell).
 *
 * @param {Function|{onUpdate?:Function, fresh?:boolean}} [opts] `onUpdate(notes)`
 *   is called as parts arrive
 * @returns {Promise<Array>} the lines (js/notify.js `buildNotes`)
 */
export function refresh(opts = {}) {
  const o = typeof opts === 'function' ? { onUpdate: opts } : (opts || {});
  const each = typeof o.onUpdate === 'function' ? (state) => o.onUpdate(state.notes) : null;
  return load({ onUpdate: each, fresh: o.fresh === true }).then((state) => state.notes);
}
