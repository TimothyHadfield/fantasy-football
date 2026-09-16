// Real names instead of team names: js/espn.js's memberNames/teamIdentity/
// parseLeague, and js/season.js's fetchWeekRosters / fetchSchedule.
//
// The fixtures reproduce the SHAPE of live ESPN payloads exactly as observed on
// 2026-09-16 against public leagues 1241838, 899513, 511328, 643894, 991817 and
// 860621 — including the three that break a naive join:
//
//   * a two-owner squad whose `primaryOwner` is NOT `owners[0]`;
//   * more `members` than `teams`;
//   * team ids that are neither contiguous nor 1-based.
//
// The most important assertion in the file is the LAST block: a payload with no
// `members` array must behave exactly as the code did before names existed.
// Every test stub in this directory is such a payload, and so is every archived
// snapshot, so "inert without members" is what keeps them all working.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { REPO } from './repo.mjs';

const espn = await import(pathToFileURL(path.join(REPO, 'js/espn.js')).href);
const season = await import(pathToFileURL(path.join(REPO, 'js/season.js')).href);

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  if (Object.is(a, b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const deep = (a, b, msg) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log(`FAIL ${msg}`); } };

// --------------------------------------------------------------- the fixture

const SWID = {
  jonas: '{3A2C2DB2-7702-429A-8C0E-BC6C84DAA2EF}',
  tyler: '{3C9E18BA-A6CD-4375-B45E-C96084116FA1}',
  kyle: '{53C6DC6F-ADF8-4DB3-86DC-6FADF8BDB39C}',
  handle: '{5C58A1EF-01F8-4231-98A1-EF01F8C2317A}',
  blank: '{68BB8B99-A369-4CB6-9309-8AE4D74A4785}',
  spare: '{6D2785A0-42A0-4FB7-A785-A042A0EFB73C}',
  ghost: '{87453E0D-FE5F-4A64-BEE4-312875FD6EF1}', // owns a team, not a member
};

const MEMBERS = [
  { id: SWID.jonas, displayName: 'ricky99', firstName: 'Jonas', lastName: 'Larson', notificationSettings: 15 },
  { id: SWID.tyler, displayName: 'greenandgold', firstName: 'Tyler', lastName: 'Grovogel', notificationSettings: 15 },
  { id: SWID.kyle, displayName: 'mofoninja31', firstName: 'Kyle', lastName: 'Perea', notificationSettings: 15 },
  // Privacy / an account that never filled the name in: displayName only.
  { id: SWID.handle, displayName: 'albrechtk15', notificationSettings: 15 },
  // Nothing usable at all.
  { id: SWID.blank, displayName: '', firstName: '  ', lastName: '', notificationSettings: 15 },
  // A league member who owns no squad — members is longer than teams.
  { id: SWID.spare, displayName: 'Lovato777', firstName: 'Andrew', lastName: 'L', notificationSettings: 15 },
];

// Non-contiguous ids, as ESPN really returns after teams leave a league.
const TEAMS = [
  { id: 1, name: 'ricky the blazers', abbrev: 'RIK', owners: [SWID.jonas], primaryOwner: SWID.jonas },
  // Two owners, and primaryOwner is the SECOND entry — verified live in 643894.
  { id: 4, name: "TJ's little Bo", abbrev: 'SOFT', owners: [SWID.tyler, SWID.kyle], primaryOwner: SWID.kyle },
  { id: 5, name: 'Chris Collinsworthless', abbrev: 'CCW', owners: [SWID.handle], primaryOwner: SWID.handle },
  { id: 7, name: 'I Miss Brady', abbrev: 'BRM', owners: [SWID.blank], primaryOwner: SWID.blank },
  // An owner id that is in no members array: an orphaned squad.
  { id: 9, name: "Shake 'n Bake", abbrev: 'CAP', owners: [SWID.ghost], primaryOwner: SWID.ghost },
  // Abandoned: ESPN really does return an empty owners array for these.
  { id: 11, name: 'Purple Rain', abbrev: 'GROV', owners: [], primaryOwner: null },
  // No `name` at all — the location/nickname fallback path.
  { id: 12, location: 'Sixteen', nickname: 'Kickers', abbrev: '16Ks', owners: [], primaryOwner: null },
  // Nothing at all: not even a location.
  { id: 13, abbrev: '', owners: [], primaryOwner: null },
];

const raw = () => ({
  members: JSON.parse(JSON.stringify(MEMBERS)),
  teams: JSON.parse(JSON.stringify(TEAMS)),
  settings: { name: 'The League', rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 20: 7 } } },
  status: { currentMatchupPeriod: 2 },
});

// ------------------------------------------------------------- memberNames()

const names = espn.memberNames(raw());
eq(names.size, 5, 'five members resolve to a usable name (the blank one does not)');
eq(names.get(SWID.jonas), 'Jonas Larson', 'first + last become the person');
eq(names.get(SWID.handle), 'albrechtk15', 'displayName is the fallback when ESPN gives no real name');
eq(names.has(SWID.blank), false, 'a member with neither name nor handle resolves to nothing');
eq(names.get(SWID.spare), 'Andrew L', 'a one-letter surname is still a name');
eq(espn.memberNames({}).size, 0, 'no payload => empty map');
eq(espn.memberNames({ members: [] }).size, 0, 'empty members => empty map');
eq(espn.memberNames({ members: [{ displayName: 'x' }] }).size, 0, 'a member with no id is skipped');

// The join is case-insensitive on both sides. ESPN agreed with itself in every
// league observed, but a silent miss here would show a joke name with no error.
const shouty = espn.memberNames({ members: [{ id: SWID.jonas.toLowerCase(), firstName: 'Jonas', lastName: 'Larson' }] });
eq(shouty.get(SWID.jonas), 'Jonas Larson', 'a lower-case member id still keys off the upper-case SWID');

// ------------------------------------------------------------ teamIdentity()

const idOf = (id) => espn.teamIdentity(TEAMS.find((t) => t.id === id), names);

const one = idOf(1);
eq(one.name, 'Jonas Larson', 'the PERSON is the primary label');
eq(one.teamName, 'ricky the blazers', 'the ESPN team name is kept as teamName');
eq(one.owner, 'Jonas Larson', 'owner names the person');
deep(one.ownerNames, ['Jonas Larson'], 'ownerNames lists him');

const two = idOf(4);
eq(two.name, 'Kyle Perea & Tyler Grovogel', 'two owners are joined, primaryOwner FIRST');
eq(two.teamName, "TJ's little Bo", 'a co-owned squad still keeps its team name');
deep(two.ownerNames, ['Kyle Perea', 'Tyler Grovogel'], 'both co-owners listed, primary first');

const handle = idOf(5);
eq(handle.name, 'albrechtk15', 'an owner with no real name falls back to his ESPN handle, not the team');
eq(handle.teamName, 'Chris Collinsworthless', 'and the team name is still there');

const blank = idOf(7);
eq(blank.name, 'I Miss Brady', 'an owner ESPN names NOTHING for falls back to the team name');
eq(blank.owner, null, 'and owner is null, so a page can tell the difference');
deep(blank.ownerNames, [], 'with no owner names at all');

const ghost = idOf(9);
eq(ghost.name, "Shake 'n Bake", 'an owner who is in no members array falls back to the team name');
eq(ghost.owner, null, 'and reports no owner');

const abandoned = idOf(11);
eq(abandoned.name, 'Purple Rain', 'a squad with NO owners falls back to the team name');
eq(abandoned.owner, null, 'and reports no owner');

eq(idOf(12).name, 'Sixteen Kickers', 'no `name`: location + nickname, exactly as before');
eq(idOf(12).teamName, 'Sixteen Kickers', 'and teamName agrees');
eq(idOf(13).name, 'Team 13', 'nothing at all: "Team <id>", exactly as before');

// Three or more owners are counted rather than listed, so a sticky name column
// cannot be blown open by a league with a four-way syndicate.
const crowd = espn.teamIdentity(
  { id: 20, name: 'Committee', owners: [SWID.jonas, SWID.tyler, SWID.kyle, SWID.spare], primaryOwner: SWID.jonas },
  names
);
eq(crowd.name, 'Jonas Larson & Tyler Grovogel +2', 'beyond two owners the rest are counted');
eq(crowd.ownerNames.length, 4, 'but ownerNames still has all four');

// ------------------------------------------------------------- parseLeague()

const parsed = espn.parseLeague(raw());
eq(parsed.teams.length, 8, 'every team survives');
eq(parsed.teams[0].name, 'Jonas Larson', 'parseLeague labels a squad with its person');
eq(parsed.teams[0].teamName, 'ricky the blazers', 'and keeps the ESPN name reachable');
deep(parsed.teams[0].owners, [SWID.jonas], 'the raw SWID array is UNCHANGED — old contract intact');
eq(parsed.teams[0].abbrev, 'RIK', 'abbrev is untouched');
eq(parsed.teams[1].name, 'Kyle Perea & Tyler Grovogel', 'the co-owned squad too');
eq(parsed.teams[3].name, 'I Miss Brady', 'and the unnameable one keeps its team name');
ok(Array.isArray(parsed.teams[0].roster), 'roster still built');

// ------------------------- the guarantee: inert when there are no members ---
//
// Every stub in tests/ and every archived snapshot is a members-less payload.
// If this block ever fails, half the suite is about to.

const noMembers = raw();
delete noMembers.members;
const before = espn.parseLeague(noMembers);
deep(
  before.teams.map((t) => t.name),
  ['ricky the blazers', "TJ's little Bo", 'Chris Collinsworthless', 'I Miss Brady',
    "Shake 'n Bake", 'Purple Rain', 'Sixteen Kickers', 'Team 13'],
  'NO members array => every label is the ESPN team name, exactly as before'
);
ok(before.teams.every((t) => t.owner === null), 'and no team claims an owner');
deep(before.teams.map((t) => t.teamName), before.teams.map((t) => t.name),
  'name and teamName agree when nothing can be resolved');

// ------------------------------------------------- season.js, over transport
//
// Stubbing global fetch rather than the module exercises the REAL espn.js
// transport, so a change to leaguePath()/request() is caught here too.

const rosterPayload = (week) => ({
  members: JSON.parse(JSON.stringify(MEMBERS)),
  teams: TEAMS.slice(0, 4).map((t) => ({
    ...t,
    roster: {
      entries: [
        { playerId: 100 + t.id, lineupSlotId: 0, playerPoolEntry: { player: {
          id: 100 + t.id, fullName: `QB ${t.id}`, defaultPositionId: 1, proTeamId: 12,
          stats: [{ scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 18 }],
        } } },
        { playerId: 200 + t.id, lineupSlotId: 20, playerPoolEntry: { player: {
          id: 200 + t.id, fullName: `Bench ${t.id}`, defaultPositionId: 2, proTeamId: 12,
          stats: [{ scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 4 }],
        } } },
      ],
    },
  })),
});

const matchupPayload = () => ({
  ...raw(),
  schedule: [
    { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 110 }, away: { teamId: 4, totalPoints: 99 } },
    { matchupPeriodId: 1, home: { teamId: 7, totalPoints: 88 }, away: { teamId: 9, totalPoints: 95 } },
  ],
});

const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  seen.push(String(url));
  const body = String(url).includes('view=mRoster') ? rosterPayload(1) : matchupPayload();
  return { ok: true, status: 200, json: async () => body };
};

espn.configure({ leagueId: '476225250', season: 2026 });

const wk = await season.fetchWeekRosters(1);
eq(wk.teams.length, 4, 'four squads came back');
eq(wk.teams[0].name, 'Jonas Larson', 'fetchWeekRosters labels a squad with its person');
eq(wk.teams[0].teamName, 'ricky the blazers', 'and carries the ESPN name');
eq(wk.teams[1].name, 'Kyle Perea & Tyler Grovogel', 'co-owners here too');
eq(wk.teams[3].name, 'I Miss Brady', 'and the unresolvable one keeps its team name');
eq(wk.teams[0].abbrev, 'RIK', 'abbrev survives the spread');
eq(wk.teams[0].starters.length, 1, 'the starter/bench split is untouched');
eq(wk.teams[0].projectedTotal, 18, 'and so are the numbers');
ok(seen.some((u) => u.includes('view=mRoster') && u.includes('view=mTeam')),
  'the roster read still asks for mTeam — which is what populates the name fields');

const sched = await season.fetchSchedule();
eq(sched.byWeek.get(1)[0].homeName, 'Jonas Larson', 'the schedule names the person at home');
eq(sched.byWeek.get(1)[0].awayName, 'Kyle Perea & Tyler Grovogel', 'and away');
eq(sched.teams[0].teamName, 'ricky the blazers', 'schedule teams keep the ESPN name too');

const data = await season.fetchSeasonData();
eq(data.teams[0].name, 'Jonas Larson', 'fetchSeasonData names the person');
eq(data.teams[0].teamName, 'ricky the blazers', 'and passes teamName through to the stats page');

globalThis.fetch = realFetch;

// ------------------------------------------------------------------ summary

if (fail) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`All ${pass} assertions passed`);
