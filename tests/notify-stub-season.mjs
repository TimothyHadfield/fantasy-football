// Stands in for js/season.js when the Notifications page is booted
// (notify-check.mjs).
//
// A league of four squads in a real one's shape — nine starters in ESPN's own
// lineupSlotIds (QB 0, RB 2, RB 2, WR 4, WR 4, TE 6, FLEX 23, D/ST 16, K 17)
// and six on the bench (20) — fourteen weeks, four of them played, so week 5
// is the week being played next. Every name is invented.
//
// TEAM 4 IS "YOU", and has one of every kind of line:
//
//   start      week 5: the bench back (409, 14.0) projects more than the
//              starting one (402, 12.4)                        -> +1.6
//   bad-start  week 5: the tight end (405) is ruled OUT, projected 0, and
//              there is no other on the roster
//   hole       week 6: the kicker (408) is on bye (NFL team 4), projected 0,
//              and there is no other on the roster
//   pickup     the wire has a kicker (901, 12.0) and a tight end (902, 13.0)
//              better than yours, and a receiver (903, 4.0) who is not
//   offer      whatever the scenario puts in `offers`
//   trade      read by the page out of localStorage, not from here
//
// The scenario is `globalThis.__notifyStub`, set before the page is imported:
//   playedThrough  the last week with its games final (default 4)
//   offers         what `fetchPendingTrades` answers
//   cloud          true: this is the phone's synced copy (`cloudSource`)
//   cloudWire      the weeks of the waiver wire that copy holds (default: this
//                  week's alone)
//   zeroK          more weeks in which your kicker projects 0 (no bye is known
//                  for them): holes beyond the weeks the pick-ups read
//   moved          lineup moves ESPN "took" (notify-stub-bridge.mjs adds them):
//                  week 5's roster is answered with those men moved
// Every call is recorded in `calls`.
//
// Only what js/notify-load.js reads is here. It asks for each read by name
// and goes without one that is missing, so nothing else is needed.

const cfg = () => (globalThis.__notifyStub ||= {});
const log = (entry) => { (cfg().calls ||= []).push(entry); };

export const WEEKS = 14;
export const NTEAMS = 4;
export const ME = 4;
export const NOW_WEEK = 5;
export const BYES = { 4: 6 };
/** Sunday's first kickoff, two days off: nobody has played. */
export const KICKOFF = Date.now() + 48 * 60 * 60 * 1000;

const LABEL = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K', 20: 'BE' };
//             slot  pos    proj  NFL team
const SHAPE = [
  [0, 'QB', 22.0, 12], [2, 'RB', 18.0, 12], [2, 'RB', 12.4, 12], [4, 'WR', 16.0, 12], [4, 'WR', 13.0, 12],
  [6, 'TE', 11.0, 12], [23, 'WR', 12.6, 12], [16, 'DST', 6.0, 8], [17, 'K', 8.0, 4],
  [20, 'RB', 9.0, 12], [20, 'WR', 9.5, 12], [20, 'QB', 17.0, 12], [20, 'DST', 5.0, 20], [20, 'WR', 8.0, 12], [20, 'RB', 7.0, 12],
];
export const playerId = (teamId, i) => teamId * 100 + i;
export const playerName = (teamId, i) => `T${teamId} Man ${String(i).padStart(2, '0')}`;

function buildTeams(week) {
  const teams = [];
  for (let id = 1; id <= NTEAMS; id++) {
    const players = SHAPE.map(([slotId, position, projected, proTeamId], i) => {
      const p = {
        playerId: playerId(id, i), name: playerName(id, i), position, proTeam: 'KC', proTeamId,
        lineupSlotId: slotId, slot: LABEL[slotId], started: slotId !== 20,
        projected, actual: null, injuryStatus: 'ACTIVE',
      };
      if (id === ME && week === NOW_WEEK && i === 9) p.projected = 14.0;
      if (id === ME && week === NOW_WEEK && i === 5) { p.projected = 0; p.injuryStatus = 'OUT'; }
      if (id === ME && (week === 6 || (cfg().zeroK || []).includes(week)) && i === 8) p.projected = 0;
      return p;
    });
    if (id === ME && week === NOW_WEEK) {
      for (const mv of cfg().moved || []) {
        const p = players.find((x) => x.playerId === mv.playerId);
        if (!p) continue;
        p.lineupSlotId = mv.toSlotId;
        p.slot = LABEL[mv.toSlotId];
        p.started = mv.toSlotId !== 20;
      }
    }
    teams.push({
      id, name: `Team ${id}`, abbrev: `T${id}`, players,
      starters: players.filter((p) => p.started), bench: players.filter((p) => !p.started),
    });
  }
  return teams;
}

export async function fetchSchedule() {
  log(['schedule']);
  const through = cfg().playedThrough ?? 4;
  const byWeek = new Map();
  for (let w = 1; w <= WEEKS; w++) {
    const games = [];
    for (let t = 1; t <= NTEAMS; t += 2) {
      const played = w <= through;
      games.push({
        week: w, played,
        homeId: t, homeName: `Team ${t}`, homeScore: played ? 100 + t : null,
        awayId: t + 1, awayName: `Team ${t + 1}`, awayScore: played ? 95 + t : null,
      });
    }
    byWeek.set(w, games);
  }
  return {
    leagueName: 'Stub League',
    teams: Array.from({ length: NTEAMS }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` })),
    weeks: [...byWeek.keys()], byWeek, games: [...byWeek.values()].flat(),
  };
}

/** The weeks left, as the real one answers them. */
export function valueWeeks(schedule) {
  return (schedule.weeks || []).filter((w) => (schedule.byWeek.get(w) || []).some((g) => !g.played));
}

export async function fetchWeekRosters(week, opts) {
  log(['week', week, opts && opts.fresh === true ? 'fresh' : 'held']);
  return { week, teams: buildTeams(week) };
}

export async function fetchWeeksRosters(weeks) {
  log(['weeks', [...weeks]]);
  return new Map(weeks.map((w) => [w, buildTeams(w)]));
}

export async function fetchWireWeek(week) {
  log(['wire', week]);
  const fa = (id, name, position, projected) => ({
    playerId: id, name, position, proTeam: 'DEN', proTeamId: 7, projected, actual: null,
    injuryStatus: 'ACTIVE', percentOwned: 20,
  });
  return [fa(901, 'Free Kicker', 'K', 12.0), fa(902, 'Free Tightend', 'TE', 13.0), fa(903, 'Free Receiver', 'WR', 4.0)];
}

export async function fetchFloors() { return new Map(); }

export async function cloudSource() {
  // `weeks` as js/cloud.js `readDown` reports them: the weeks the copy holds.
  const all = Array.from({ length: 17 }, (_, i) => i + 1);
  return cfg().cloud
    ? { byes: { ...BYES }, at: Date.now() - 2 * 60 * 60 * 1000, weeks: { rosters: all, wire: cfg().cloudWire || [NOW_WEEK] } }
    : null;
}
export function weekReadAt() { return Date.now() - 2 * 60 * 60 * 1000 - 1000; }

export async function fetchByeWeeks() { log(['byes']); return { ...BYES }; }
export async function fetchProKickoffs() {
  log(['kickoffs']);
  return { 12: { [NOW_WEEK]: KICKOFF }, 4: { [NOW_WEEK]: KICKOFF + 3 * 60 * 60 * 1000 } };
}

export async function fetchPendingTrades() {
  log(['offers']);
  return cfg().offers || [];
}
