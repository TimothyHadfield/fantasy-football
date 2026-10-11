// Checks js/notify.js — the lines of the Notifications page (Tim, 2026-10-11:
// "suggested players to pick up, warnings for future weeks that have missing
// positions or if you're currently starting someone you shouldn't, messages on
// any trade notifications you have, or elete trade opportunities").
//
//   node test-notify.mjs
//
// The squad is a real one's shape: sixteen men, nine starting slots in ESPN's
// own lineupSlotIds (QB 0, RB 2, RB 2, WR 4, WR 4, TE 6, FLEX 23, D/ST 16,
// K 17), six on the bench (20) and one on IR (21). Every name is invented.
// Every expected line is written out by hand.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const N = await import(pathToFileURL(path.join(REPO, 'js/notify.js')).href);
const { buildNotes, movesFor, holesIn, pickups, countNotes, onBye } = N;

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17];
const LABEL = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K', 20: 'BE', 21: 'IR' };
const WEEK = 5;
const ME = 4;
const LEAGUE = { leagueId: '99', season: 2026 };
const NOW = Date.UTC(2026, 9, 8, 18, 0, 0);
const HOUR = 60 * 60 * 1000;

const man = (playerId, name, position, lineupSlotId, projected, extra = {}) => ({
  playerId, name, position, proTeam: 'KC', proTeamId: 12, lineupSlotId, slot: LABEL[lineupSlotId],
  started: lineupSlotId !== 20 && lineupSlotId !== 21,
  projected, actual: null, injuryStatus: 'ACTIVE', ...extra,
});

/** A lineup set exactly right: nothing on the bench beats a starter. */
function squad(change = {}, drop = []) {
  const base = {
    qb: man(101, 'Abel Quinn', 'QB', 0, 22.0),
    rb1: man(102, 'Boris Reed', 'RB', 2, 18.0),
    rb2: man(103, 'Cal Rivers', 'RB', 2, 12.4),
    wr1: man(104, 'Dov Walsh', 'WR', 4, 16.0),
    wr2: man(105, 'Eli Ward', 'WR', 4, 13.0),
    te: man(106, 'Finn Tate', 'TE', 6, 11.0),
    flex: man(107, 'Gus Wolfe', 'WR', 23, 12.6),
    dst: man(108, 'Harbor D/ST', 'DST', 16, 6.0, { proTeamId: 8 }),
    k: man(109, 'Ike Kemp', 'K', 17, 8.0, { proTeamId: 4 }),
    bRb: man(110, 'Jon Ross', 'RB', 20, 9.0),
    bWr: man(111, 'Kit West', 'WR', 20, 9.5),
    bTe: man(112, 'Lou Thorn', 'TE', 20, 7.0),
    bQb: man(113, 'Max Quill', 'QB', 20, 17.0),
    bK: man(114, 'Ned Kane', 'K', 20, 7.5, { proTeamId: 9 }),
    bDst: man(115, 'Orchard D/ST', 'DST', 20, 5.0, { proTeamId: 20 }),
    ir: man(116, 'Pat Rowe', 'RB', 21, 25.0),
  };
  for (const [k, v] of Object.entries(change)) base[k] = { ...base[k], ...v };
  for (const k of drop) delete base[k];
  return base;
}
const list = (s) => Object.values(s);
const teamOf = (s) => ({ id: ME, name: 'Team Four', players: list(s) });
const OTHERS = [
  { id: 3, name: 'Team Three', players: [man(301, 'Quin Ashby', 'WR', 4, 14), man(302, 'Rex Stone', 'RB', 2, 11)] },
  { id: 7, name: 'Team Seven', players: [man(701, 'Sol Vance', 'TE', 6, 9)] },
];
const unlocked = () => false;
const notes = (o) => buildNotes({
  week: WEEK, teamId: ME, league: LEAGUE, slots: SLOTS, isLocked: unlocked, now: NOW,
  teams: [o.team, ...OTHERS].filter(Boolean), ...o,
});
const kind = (ns, k) => ns.filter((n) => n.kind === k);
const ESPN = 'https://fantasy.espn.com/football/team?leagueId=99&seasonId=2026&teamId=4&scoringPeriodId=5';

// ---------------------------------------------------------------- a quiet team
{
  const ns = notes({ team: teamOf(squad()) });
  eq(ns.map((n) => n.id), ['trade-look'], 'a lineup set right, nothing else known: only the one trade line');
  eq(ns[0], {
    id: 'trade-look', kind: 'trade', level: 'idea', title: 'Look for trades', detail: 'No deals found yet',
    action: { label: 'Open Trade', href: 'trade.html' },
  }, 'trade: with no saved deals, one idea line that opens Trade');
  eq(buildNotes({ week: WEEK, teamId: ME, team: null, slots: SLOTS }), [], 'no team: no lines at all');
}

// ----------------------------------------------------------------------- start
{
  // The bench back now projects 14.0 against the starter's 12.4.
  const s = squad({ bRb: { projected: 14.0 } });
  const ns = kind(notes({ team: teamOf(s) }), 'start');
  eq(ns.length, 1, 'start: one swap, one line');
  eq(ns[0], {
    id: 'start-110-103', kind: 'start', level: 'now',
    title: 'Start Jon Ross over Cal Rivers', detail: '+1.6 pts this week',
    action: {
      label: 'Open ESPN', href: ESPN,
      lineup: {
        label: 'Change it', week: 5, teamId: 4,
        moves: [
          { playerId: 103, fromSlotId: 2, toSlotId: 20 },
          { playerId: 110, fromSlotId: 20, toSlotId: 2 },
        ],
      },
    },
  }, 'start: the line, its points, the ESPN link and the two moves in ESPN’s slot ids');

  // The sample league has no ESPN page and no lineup to change.
  const demo = kind(buildNotes({ week: WEEK, teamId: ME, league: null, team: teamOf(s), slots: SLOTS, isLocked: unlocked }), 'start');
  eq(demo[0] && demo[0].action, { label: 'See him', href: 'waivers.html?player=110' }, 'start: on the sample league the button shows the man, and offers no lineup change');

  // His game has started: nothing to change.
  const locked = kind(notes({ team: teamOf(s), isLocked: (p) => p.playerId === 110 }), 'start');
  eq(locked, [], 'start: a bench man whose game has started is not offered');

  // A slot left empty: the bench kicker goes in, nobody comes out.
  const e = squad({}, ['k']);
  const fill = kind(notes({ team: teamOf(e) }), 'start');
  eq(fill.map((n) => [n.id, n.title, n.detail, n.action.lineup && n.action.lineup.moves]),
    [['start-114-0', 'Start Ned Kane', '+7.5 pts this week', [{ playerId: 114, fromSlotId: 20, toSlotId: 17 }]]],
    'start: an empty slot is filled in one move');
}

// The moves of a swap whose man does not fit the slot being emptied.
{
  const s = squad({ flex: { position: 'RB', name: 'Gus Wolfe' } });   // the flex holds a back
  const players = list(s);
  const swap = { in: s.bWr, out: s.rb2 };   // a receiver in for a running back
  eq(movesFor(swap, { players, slots: SLOTS, isLocked: unlocked }), [
    { playerId: 103, fromSlotId: 2, toSlotId: 20 },
    { playerId: 107, fromSlotId: 23, toSlotId: 2 },
    { playerId: 111, fromSlotId: 20, toSlotId: 23 },
  ], 'moves: a receiver in for a back goes through the flex, in three moves');
  eq(movesFor(swap, { players, slots: SLOTS, isLocked: (p) => p.playerId === 107 }), null,
    'moves: not when the flex man’s game has started');
  eq(movesFor({ in: s.bK, out: s.k }, { players, slots: SLOTS, isLocked: unlocked }), [
    { playerId: 109, fromSlotId: 17, toSlotId: 20 },
    { playerId: 114, fromSlotId: 20, toSlotId: 17 },
  ], 'moves: like for like is two moves');
  eq(movesFor({ in: s.bK, out: null }, { players, slots: SLOTS, isLocked: unlocked }), null,
    'moves: no empty slot that fits him, no moves');
}

// ------------------------------------------------------------------- bad-start
{
  // The tight end is ruled out and there is no other on the roster.
  const s = squad({ te: { injuryStatus: 'OUT', projected: 0 } }, ['bTe']);
  const ns = notes({ team: teamOf(s) });
  eq(kind(ns, 'bad-start'), [{
    id: 'bad-106', kind: 'bad-start', level: 'now', title: 'Finn Tate is out', detail: 'In your lineup at TE',
    action: { label: 'See him', href: 'waivers.html?player=106' },
  }], 'bad-start: a starter ruled out with nobody to swap in');
  eq(kind(ns, 'start'), [], 'bad-start: and no swap line beside it');

  // With a tight end on the bench the swap line says it, once.
  const c = notes({ team: teamOf(squad({ te: { injuryStatus: 'OUT', projected: 0 } })) });
  eq([kind(c, 'start').map((n) => n.title), kind(c, 'bad-start').length],
    [['Start Lou Thorn over Finn Tate'], 0], 'bad-start: covered by a swap, it is not said twice');

  // A bye is known only from the bye table; a kicker on bye with no other.
  const b = squad({ k: { projected: 0 } }, ['bK']);
  const bye = kind(notes({ team: teamOf(b), byes: { 4: 5, 12: 9 } }), 'bad-start');
  eq(bye.map((n) => [n.id, n.title, n.detail]), [['bad-109', 'Ike Kemp is on bye', 'In your lineup at K']], 'bad-start: a starter on bye');
  eq(kind(notes({ team: teamOf(b), byes: { 4: 6 } }), 'bad-start'), [], 'bad-start: another week’s bye is not this week’s');
  eq(kind(notes({ team: teamOf(b), byes: null }), 'bad-start'), [], 'bad-start: byes unknown, nothing is claimed');
  eq(kind(notes({ team: teamOf(b), byes: { 4: 5 }, isLocked: (p) => p.playerId === 109 }), 'bad-start'), [], 'bad-start: his game has started, nothing to do');

  const ir = kind(notes({ team: teamOf(squad({ te: { injuryStatus: 'INJURY_RESERVE', projected: 0 } }, ['bTe'])) }), 'bad-start');
  eq(ir.map((n) => n.title), ['Finn Tate is on IR'], 'bad-start: on IR says so');
  const q = kind(notes({ team: teamOf(squad({ te: { injuryStatus: 'QUESTIONABLE' } }, ['bTe'])) }), 'bad-start');
  eq(q, [], 'bad-start: questionable is not out');
  ok(onBye({ proTeamId: 4 }, 5, { 4: 5 }) && !onBye({ proTeamId: 4 }, 5, {}) && !onBye({ proTeamId: 4 }, 5, { 4: 0 }), 'bye: only a known bye week counts');
}

// ------------------------------------------------------------------------ hole
{
  // Week 6: the only kicker is on bye (projected 0). Week 8: no tight end on
  // the roster at all. Week 7: whole.
  const w6 = list(squad({ k: { projected: 0 } }, ['bK']));
  const w7 = list(squad());
  const w8 = list(squad({}, ['te', 'bTe']));
  const coming = [{ week: 8, players: w8 }, { week: 6, players: w6 }, { week: 7, players: w7 }];
  const ns = kind(notes({ team: teamOf(squad()), coming, byes: { 4: 6 } }), 'hole');
  eq(ns, [
    { id: 'hole-6-17', kind: 'hole', level: 'soon', title: 'Week 6: no K', detail: 'Ike Kemp is on bye',
      action: { label: 'Find one', href: 'waivers.html?pos=K' } },
    { id: 'hole-8-6', kind: 'hole', level: 'soon', title: 'Week 8: no TE', detail: 'Nobody on your roster fits',
      action: { label: 'Find one', href: 'waivers.html?pos=TE' } },
  ], 'hole: one line per short slot, soonest week first, opening Players on that position');

  // The bench covers it: the BEST legal lineup is what is judged, not the one set.
  const covered = list(squad({ k: { projected: 0 } }));
  eq(kind(notes({ team: teamOf(squad()), coming: [{ week: 6, players: covered }], byes: { 4: 6 } }), 'hole'), [],
    'hole: a bench man who fills it means no hole');
  eq(holesIn(covered, SLOTS), [], 'holesIn: the same, asked directly');

  // A week that could not be read is not a week of nine holes.
  eq(kind(notes({ team: teamOf(squad()), coming: [{ week: 6, players: [] }] }), 'hole'), [], 'hole: a week with no roster read says nothing');

  // The flex: four flex-eligible men for five places.
  const thin = list(squad({}, ['flex', 'bRb', 'bWr', 'bTe']));
  const flex = kind(notes({ team: teamOf(squad()), coming: [{ week: 9, players: thin }] }), 'hole');
  eq(flex.map((n) => [n.id, n.title, n.action.href]), [['hole-9-23', 'Week 9: no FLEX', 'waivers.html?pos=FLEX']], 'hole: the flex is a slot like any other');

  // The man on IR cannot be the answer.
  const backs = list(squad({ rb2: { projected: 0 } }, ['bRb', 'flex', 'bWr', 'bTe']));
  const h = holesIn(backs, SLOTS).map((x) => x.slotId).sort((a, b) => a - b);
  eq(h, [2, 23], 'holesIn: the IR man fills nothing (RB and FLEX both short)');
  // D/ST: the filter is spelled DST.
  const noD = kind(notes({ team: teamOf(squad()), coming: [{ week: 6, players: list(squad({}, ['dst', 'bDst'])) }] }), 'hole');
  eq(noD.map((n) => [n.title, n.action.href]), [['Week 6: no D/ST', 'waivers.html?pos=DST']], 'hole: D/ST opens the DST filter');
}

// ---------------------------------------------------------------------- pickup
{
  const mine = squad();
  const team = teamOf(mine);
  const weeks = [5, 6, 7];
  // Free agents: a kicker worth 4.0 a week more than Ike Kemp (8.0), a tight end
  // worth 2.0 more than Finn Tate (11.0), a D/ST worth 1.0 more, a quarterback
  // worth 0.5 more, a receiver who beats nobody, and a man already on the roster.
  const pool = [
    { playerId: 901, name: 'Ray Keane', position: 'K', proj: 12.0 },
    { playerId: 902, name: 'Sam Teller', position: 'TE', proj: 13.0 },
    { playerId: 903, name: 'Quarry D/ST', position: 'DST', proj: 7.0 },
    { playerId: 904, name: 'Tom Quade', position: 'QB', proj: 22.5 },
    { playerId: 905, name: 'Uli Webb', position: 'WR', proj: 4.0 },
    { playerId: 101, name: 'Abel Quinn', position: 'QB', proj: 40.0 },
  ];
  const mineProj = new Map(list(mine).map((p) => [p.playerId, p.projected]));
  const wireProj = new Map(pool.map((p) => [p.playerId, p.proj]));
  const held = new Set(mineProj.keys());
  const projFor = (p) => (held.has(p.playerId) ? mineProj : wireProj).get(p.playerId) ?? null;
  const wire = { weeks, pool, projFor, floors: null };

  const got = pickups({ team, slots: SLOTS, wire });
  eq(got.map((g) => [g.player.playerId, Math.round(g.gain.perWeek * 10) / 10]), [[901, 4], [902, 2], [903, 1]],
    'pickups: the three biggest gains, best first, and never a man you hold');
  const ns = kind(notes({ team, wire }), 'pickup');
  eq(ns.map((n) => [n.id, n.level, n.title, n.action]), [
    ['pickup-901', 'idea', 'Pick up Ray Keane', { label: 'See him', href: 'waivers.html?player=901' }],
    ['pickup-902', 'idea', 'Pick up Sam Teller', { label: 'See him', href: 'waivers.html?player=902' }],
    ['pickup-903', 'idea', 'Pick up Quarry D/ST', { label: 'See him', href: 'waivers.html?player=903' }],
  ], 'pickup: a line each, opening that man on Players');
  ok(ns.length === 3 && /^\+4\.0 pts a week · drop .+/.test(ns[0].detail), 'pickup: the gain a week and who to drop', ns[0] && ns[0].detail);
  const dropped = got[0] && got[0].gain.drop;
  ok(dropped && held.has(dropped.playerId) && ns[0].detail === `+4.0 pts a week · drop ${dropped.name}`, 'pickup: the man to drop is one of yours', JSON.stringify(dropped));

  // Nobody better: no line. Nothing read yet: no line.
  eq(kind(notes({ team, wire: { ...wire, pool: [pool[4], pool[5]] } }), 'pickup'), [], 'pickup: a free agent who beats nobody is not suggested');
  eq(kind(notes({ team, wire: null }), 'pickup'), [], 'pickup: none until the wire has been read');
  eq(kind(notes({ team, wire: { ...wire, weeks: [] } }), 'pickup'), [], 'pickup: none with no week to price');
  // A gain that would print as +0.0 is not a suggestion.
  const tiny = [{ playerId: 906, name: 'Vic Kay', position: 'K', proj: 8.04 }];
  const tinyProj = (p) => (held.has(p.playerId) ? mineProj.get(p.playerId) : 8.04);
  eq(kind(notes({ team, wire: { weeks, pool: tiny, projFor: tinyProj, floors: null } }), 'pickup'), [], 'pickup: a gain that rounds to +0.0 is not shown');
}

// ----------------------------------------------------------------------- offer
{
  const team = teamOf(squad());
  const offers = [
    { id: 'abc', withTeamId: 3, get: [301], send: [105, 110], proposedAt: NOW - HOUR, expiresAt: NOW + 40 * HOUR, fromMe: false },
    { id: 'def', withTeamId: 7, get: [701], send: [112], proposedAt: NOW - 2 * HOUR, expiresAt: NOW + 40 * HOUR, fromMe: true },
  ];
  const ns = kind(notes({ team, offers }), 'offer');
  eq(ns, [
    { id: 'offer-abc', kind: 'offer', level: 'now', title: 'Trade offer from Team Three',
      detail: 'Get Quin Ashby for Eli Ward, Jon Ross',
      action: { label: 'Open it', href: 'trade.html?with=3&get=301&send=105,110' } },
    { id: 'offer-def', kind: 'offer', level: 'idea', title: 'Your offer to Team Seven',
      detail: 'Get Sol Vance for Lou Thorn',
      action: { label: 'Open it', href: 'trade.html?with=7&get=701&send=112' } },
  ], 'offer: one line per offer, theirs this week and yours an idea, opening that deal on Trade');
  // On the synced copy the offer is as old as the sync.
  const old = kind(notes({ team, offers: [offers[0]], offersAt: NOW - 2 * HOUR }), 'offer');
  eq(old[0] && old[0].detail, 'Get Quin Ashby for Eli Ward, Jon Ross · as of 2 hours ago', 'offer: a synced copy says how old it is');
  eq(kind(notes({ team, offers: [] }), 'offer'), [], 'offer: none waiting, no line');
  eq(kind(notes({ team, offers: null }), 'offer'), [], 'offer: a read that gave nothing is no line');
  eq(kind(notes({ team, offers: [{ id: 'x' }] }), 'offer'), [], 'offer: an offer with no other team is dropped');
}

// ----------------------------------------------------------------------- trade
{
  const team = teamOf(squad());
  const deal = (withTeamId, withName, get, send) => ({
    withTeamId, withName, get: get.map((name, i) => ({ id: 300 + i, name })), send: send.map((name, i) => ({ id: 100 + i, name })),
  });
  const saved = {
    v: 1, team: ME, at: NOW - 3 * HOUR,
    deals: [
      deal(3, 'Team Three', ['Quin Ashby'], ['Eli Ward']),
      deal(7, 'Team Seven', ['Sol Vance'], ['Lou Thorn', 'Kit West']),
      deal(3, 'Team Three', ['Rex Stone'], ['Jon Ross']),
      deal(7, 'Team Seven', ['Sol Vance'], ['Ned Kane']),
    ],
  };
  const ns = kind(notes({ team, saved }), 'trade');
  eq(ns, [
    { id: 'trade-0-3', kind: 'trade', level: 'idea', title: 'Trade with Team Three',
      detail: 'Get Quin Ashby for Eli Ward · found 3 hours ago', action: { label: 'Open it', href: 'trade.html?with=3&get=300&send=100' } },
    { id: 'trade-1-7', kind: 'trade', level: 'idea', title: 'Trade with Team Seven',
      detail: 'Get Sol Vance for Lou Thorn, Kit West · found 3 hours ago', action: { label: 'Open it', href: 'trade.html?with=7&get=300&send=100,101' } },
    { id: 'trade-2-3', kind: 'trade', level: 'idea', title: 'Trade with Team Three',
      detail: 'Get Rex Stone for Jon Ross · found 3 hours ago', action: { label: 'Open it', href: 'trade.html?with=3&get=300&send=100' } },
  ], 'trade: the first three saved deals, with their age, each opening that deal on Trade');
  eq(kind(notes({ team, saved: { ...saved, team: 3 } }), 'trade').map((n) => n.id), ['trade-look'], 'trade: another team’s saved list is not yours');
  eq(kind(notes({ team, saved: { ...saved, v: 2 } }), 'trade').map((n) => n.id), ['trade-look'], 'trade: a record of another shape is not read');
  eq(kind(notes({ team, saved: { ...saved, deals: [] } }), 'trade').map((n) => n.id), ['trade-look'], 'trade: an empty list is the one "look" line');
}

// --------------------------------------------------------------- order, counts
{
  const s = squad({ bRb: { projected: 14.0 } });
  const team = teamOf(s);
  const coming = [{ week: 6, players: list(squad({ k: { projected: 0 } }, ['bK'])) }];
  const offers = [{ id: 'abc', withTeamId: 3, get: [301], send: [105], fromMe: false }];
  const pool = [{ playerId: 901, name: 'Ray Keane', position: 'K' }];
  const held = new Map(list(s).map((p) => [p.playerId, p.projected]));
  const wire = { weeks: [5, 6, 7], pool, projFor: (p) => (held.has(p.playerId) ? held.get(p.playerId) : 12), floors: null };
  const ns = notes({ team, coming, offers, wire, byes: { 4: 6 } });
  eq(ns.map((n) => `${n.level}:${n.kind}`), ['now:start', 'now:offer', 'soon:hole', 'idea:pickup', 'idea:trade'],
    'order: this week, then the coming weeks, then ideas');
  eq(countNotes(ns), { now: 2, soon: 1, idea: 2 }, 'counts: how many stand at each level');
  eq(new Set(ns.map((n) => n.id)).size, ns.length, 'every line has its own id');
  ok(ns.every((n) => n.title && n.detail && n.action && n.action.label && n.action.href), 'every line has a title, a detail and one button with somewhere to go');
  ok(ns.every((n) => n.title.split(/\s+/).length <= 8 && n.action.label.split(/\s+/).length <= 2), 'a line is a few words and its button one or two');
  eq(countNotes([]), { now: 0, soon: 0, idea: 0 }, 'counts: none');
}

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
