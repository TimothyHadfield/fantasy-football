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
const PV = await import(pathToFileURL(path.join(REPO, 'js/pending-view.js')).href);
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
    suggest: null,
    action: { label: 'Open Trade', href: 'trade.html' },
  }, 'trade: with no saved deals, one idea line that opens Trade, and no suggestion');
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
    suggest: 'Move Jon Ross into RB, bench Cal Rivers',
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
  eq(demo[0] && demo[0].suggest, 'Move Jon Ross into RB, bench Cal Rivers', 'start: the sample league still says which slot');

  // His game has started: nothing to change.
  const locked = kind(notes({ team: teamOf(s), isLocked: (p) => p.playerId === 110 }), 'start');
  eq(locked, [], 'start: a bench man whose game has started is not offered');

  // A slot left empty: the bench kicker goes in, nobody comes out.
  const e = squad({}, ['k']);
  const fill = kind(notes({ team: teamOf(e) }), 'start');
  eq(fill.map((n) => [n.id, n.title, n.detail, n.action.lineup && n.action.lineup.moves]),
    [['start-114-0', 'Start Ned Kane', '+7.5 pts this week', [{ playerId: 114, fromSlotId: 20, toSlotId: 17 }]]],
    'start: an empty slot is filled in one move');
  eq(fill.map((n) => n.suggest), ['Move Ned Kane into K'], 'start: an empty slot names the slot and benches nobody');

  // A receiver in for a back while the flex holds a back: three men move, and all three are named.
  const via = squad({ flex: { position: 'RB' }, bWr: { projected: 14.0 } });
  eq(kind(notes({ team: teamOf(via) }), 'start').map((n) => [n.title, n.suggest]),
    [['Start Kit West over Cal Rivers', 'Move Kit West into FLEX, Gus Wolfe into RB, bench Cal Rivers']],
    'start: a swap through the flex says every move, the new man first');
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
    suggest: 'Add a TE this week',
    action: { label: 'See him', href: 'waivers.html?player=106' },
  }], 'bad-start: a starter ruled out with nobody to swap in, so the suggestion is to add one');

  // Ruled out but still projected above the bench man: no swap line, so this
  // line names the best man on the bench who may stand in.
  const sub = kind(notes({ team: teamOf(squad({ te: { injuryStatus: 'OUT', projected: 5.0 }, bTe: { projected: 4.0 } })) }), 'bad-start');
  eq(sub.map((n) => [n.id, n.suggest]), [['bad-106', 'Start Lou Thorn instead']], 'bad-start: a bench man who fits is named');
  const subOut = kind(notes({ team: teamOf(squad({ te: { injuryStatus: 'OUT', projected: 5.0 }, bTe: { projected: 4.0, injuryStatus: 'OUT' } })) }), 'bad-start');
  eq(subOut.map((n) => n.suggest), ['Add a TE this week'], 'bad-start: a bench man who is out himself is not the answer');
  const subLocked = kind(notes({ team: teamOf(squad({ te: { injuryStatus: 'OUT', projected: 5.0 }, bTe: { projected: 4.0 } })), isLocked: (p) => p.playerId === 112 }), 'bad-start');
  eq(subLocked.map((n) => n.suggest), ['Add a TE this week'], 'bad-start: nor one whose game has started');
  eq(kind(ns, 'start'), [], 'bad-start: and no swap line beside it');

  // With a tight end on the bench the swap line says it, once.
  const c = notes({ team: teamOf(squad({ te: { injuryStatus: 'OUT', projected: 0 } })) });
  eq([kind(c, 'start').map((n) => n.title), kind(c, 'bad-start').length],
    [['Start Lou Thorn over Finn Tate'], 0], 'bad-start: covered by a swap, it is not said twice');

  // A bye is known only from the bye table; a kicker on bye with no other.
  const b = squad({ k: { projected: 0 } }, ['bK']);
  const bye = kind(notes({ team: teamOf(b), byes: { 4: 5, 12: 9 } }), 'bad-start');
  eq(bye.map((n) => [n.id, n.title, n.detail, n.suggest]), [['bad-109', 'Ike Kemp is on bye', 'In your lineup at K', 'Add a K this week']], 'bad-start: a starter on bye');
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
      suggest: 'Add a K before week 6',
      action: { label: 'Find one', href: 'waivers.html?pos=K' } },
    { id: 'hole-8-6', kind: 'hole', level: 'soon', title: 'Week 8: no TE', detail: 'Nobody on your roster fits',
      suggest: 'Add a TE before week 8',
      action: { label: 'Find one', href: 'waivers.html?pos=TE' } },
  ], 'hole: one line per short slot, soonest week first, opening Players on that position; no wire read, so no man is named');
  eq(N.holeWeeks({ coming, slots: SLOTS }), [6, 8], 'holeWeeks: the weeks whose wire is worth reading, soonest first');

  // THE SUGGESTION, with that week's wire read. One roster all through (as in
  // life): sixteen men, the only kicker on bye in week 6.
  {
    const mine = squad({}, ['bK']);
    const team = teamOf(mine);
    const rosterIn = (w) => list(squad(w === 6 ? { k: { projected: 0 } } : {}, ['bK']));
    const agents = [
      { playerId: 901, name: 'Ray Keane', position: 'K', projected: 9.0 },
      { playerId: 907, name: 'Wes Kirk', position: 'K', projected: 11.0 },
      { playerId: 908, name: 'Xan Kell', position: 'K', projected: 0 },
      { playerId: 902, name: 'Sam Teller', position: 'TE', projected: 30.0 },
    ];
    const heldIds = new Set(list(mine).map((p) => p.playerId));
    const projFor = (p, w) => {
      if (heldIds.has(p.playerId)) return (rosterIn(w).find((x) => x.playerId === p.playerId) || {}).projected ?? null;
      return w === 6 ? (agents.find((a) => a.playerId === p.playerId) || {}).projected ?? null : null;
    };
    const fill = { byWeek: new Map([[6, agents]]), weeks: [5, 6, 7], projFor, floors: null };
    const comingK = [{ week: 6, players: rosterIn(6) }];
    const hole = (o) => kind(notes({ team, coming: comingK, byes: { 4: 6 }, fill, ...o }), 'hole');

    // Who the Gain engine drops for him over weeks 5-7, worked out the long way.
    const G = await import(pathToFileURL(path.join(REPO, 'js/waiver-gain.js')).href);
    const bare = (p) => ({ playerId: p.playerId, name: p.name, position: p.position });
    const base = G.gainBase({ players: list(mine).map(bare), slots: SLOTS, weeks: [5, 6, 7], projFor, floors: null });
    const drop = G.gainOf(base, bare(agents[1]), { prune: false }).drop;
    ok(drop && heldIds.has(drop.playerId) && drop.playerId !== 109, 'hole: the engine names one of your men to drop, and not the kicker who is back next week', JSON.stringify(drop));
    const h = hole({});
    eq(h.map((n) => [n.id, n.detail, n.suggest]), [['hole-6-17', 'Ike Kemp is on bye', `Drop ${drop && drop.name}, add Wes Kirk for 1 week`]],
      'hole: drop the Gain engine’s man, add the best free kicker OF THAT WEEK, "for 1 week" because it is a bye');
    ok(h[0] && h[0].suggest.split(/\s+/).length <= 10, 'hole: the suggestion is ten words or fewer', h[0] && h[0].suggest);

    // Not a known bye (he just projects 0): the week is named instead.
    eq(hole({ byes: null }).map((n) => [n.detail, n.suggest]), [['Ike Kemp projects 0', `Drop ${drop && drop.name}, add Wes Kirk for week 6`]],
      'hole: with no known bye it says "for week 6", not "for 1 week"');
    // One week alone cannot say who to drop (a star on bye would cost it nothing).
    eq(hole({ fill: { ...fill, weeks: [] } }).map((n) => n.suggest), ['Add Wes Kirk for 1 week'], 'hole: one priced week names nobody to drop');
    // That week's wire was not read / has no kicker who scores: nobody is invented.
    eq(hole({ fill: { ...fill, byWeek: new Map([[7, agents]]) } }).map((n) => n.suggest), ['Add a K before week 6'], 'hole: another week’s wire is not this week’s');
    eq(hole({ fill: { ...fill, byWeek: new Map([[6, [agents[2], agents[3]]]]) } }).map((n) => n.suggest), ['Add a K before week 6'], 'hole: no free agent who fits and scores, no name');
    eq(hole({ fill: { ...fill, byWeek: new Map([[6, [agents[1], { ...agents[0], playerId: 109 }]]]) } }).map((n) => n.suggest),
      [`Drop ${drop && drop.name}, add Wes Kirk for 1 week`], 'hole: a man you hold is never the one to add');
  }

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
  eq(ns.map((n) => n.detail), ['+4.0 pts a week', '+2.0 pts a week', '+1.0 pts a week'], 'pickup: the detail is the gain a week, and no longer who to drop');
  const dropped = got[0] && got[0].gain.drop;
  ok(dropped && held.has(dropped.playerId) && ns[0].suggest === `Drop ${dropped.name}, add Ray Keane`, 'pickup: the suggestion is who to drop (one of yours) and who to add', `${JSON.stringify(dropped)} / ${ns[0] && ns[0].suggest}`);
  ok(ns.every((n) => /^Drop .+, add .+$/.test(n.suggest || '') && !/drop/i.test(n.detail)), 'pickup: said once on each line', ns.map((n) => `${n.detail} | ${n.suggest}`));

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
  // The clock in the detail (2026-10-22), in this machine's own zone.
  const exp = `expires ${PV.whenText(NOW + 40 * HOUR, NOW)}`;
  eq(ns, [
    { id: 'offer-abc', kind: 'offer', level: 'now', title: 'Trade offer from Team Three',
      detail: `Get Quin Ashby for Eli Ward, Jon Ross · ${exp}`,
      suggest: 'Check it on Trade before it expires Saturday',
      action: { label: 'Open it', href: 'trade.html?with=3&get=301&send=105,110' } },
    { id: 'offer-def', kind: 'offer', level: 'pending', title: 'Your offer to Team Seven',
      detail: `Get Sol Vance for Lou Thorn · ${exp}`,
      suggest: null,
      action: { label: 'Open it', href: 'trade.html?with=7&get=701&send=112' } },
  ], 'offer: one line per offer, theirs this week (with the day it expires) and yours a pending move with nothing to do, each with its clock, opening that deal on Trade');
  ok(/^expires (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d\d (AM|PM)$/.test(exp), 'offer: the clock reads as a day and a time', exp);
  // An accepted trade in the league's review: pending, with when it goes through.
  const review = kind(notes({ team, offers: [{ ...offers[0], expiresAt: null, review: true, processAt: NOW + 20 * HOUR }] }), 'offer')[0];
  eq([review.level, review.title, review.detail, review.suggest],
    ['pending', 'Trade with Team Three accepted', `Get Quin Ashby for Eli Ward, Jon Ross · processes ${PV.whenText(NOW + 20 * HOUR, NOW)}`, null],
    'offer: an accepted trade in review is a pending line saying when it processes');
  const when = (expiresAt) => kind(notes({ team, offers: [{ ...offers[0], expiresAt }] }), 'offer').map((n) => n.suggest);
  eq([when(null), when(NOW - HOUR), when(NOW + 9 * 24 * HOUR)].flat(),
    Array(3).fill('Check it on Trade before it expires'), 'offer: no expiry known, one already past, or one over six days off: no day is named');
  // On the synced copy the offer is as old as the sync.
  const old = kind(notes({ team, offers: [offers[0]], offersAt: NOW - 2 * HOUR }), 'offer');
  eq(old[0] && old[0].detail, `Get Quin Ashby for Eli Ward, Jon Ross · ${exp} · as of 2 hours ago`, 'offer: a synced copy says how old it is');
  eq(kind(notes({ team, offers: [{ ...offers[0], expiresAt: NOW - HOUR }] }), 'offer')[0].detail,
    'Get Quin Ashby for Eli Ward, Jon Ross', 'offer: a clock already gone is not printed');
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
  saved.deals[0].gain = 1.2;   // as js/notify-trades.js saves it: points a week unless `perWeek` is false
  const ns = kind(notes({ team, saved }), 'trade');
  eq(ns, [
    { id: 'trade-0-3', kind: 'trade', level: 'idea', title: 'Trade with Team Three',
      detail: '+1.2 pts a week · found 3 hours ago', suggest: 'Offer Eli Ward for Quin Ashby',
      action: { label: 'Open it', href: 'trade.html?with=3&get=300&send=100' } },
    { id: 'trade-1-7', kind: 'trade', level: 'idea', title: 'Trade with Team Seven',
      detail: 'Found 3 hours ago', suggest: 'Offer Lou Thorn, Kit West for Sol Vance',
      action: { label: 'Open it', href: 'trade.html?with=7&get=300&send=100,101' } },
    { id: 'trade-2-3', kind: 'trade', level: 'idea', title: 'Trade with Team Three',
      detail: 'Found 3 hours ago', suggest: 'Offer Jon Ross for Rex Stone',
      action: { label: 'Open it', href: 'trade.html?with=3&get=300&send=100' } },
  ], 'trade: the first three saved deals — the deal as the suggestion, its gain and age as the detail — each opening that deal on Trade');
  eq(kind(notes({ team, saved: { ...saved, perWeek: false } }), 'trade')[0].detail, '+1.2 pts · found 3 hours ago', 'trade: a gain saved as a total is not called "a week"');
  const lone = { ...saved, at: undefined, deals: [{ withTeamId: 3, withName: 'Team Three', get: [{ id: 300, name: 'Quin Ashby' }], send: [] }] };
  eq(kind(notes({ team, saved: lone }), 'trade').map((n) => [n.detail, n.suggest]), [['Saved on Trade', 'Ask for Quin Ashby']], 'trade: nothing sent, no gain, no age: still a detail, and the ask alone');
  eq(kind(notes({ team, saved: { ...saved, team: 3 } }), 'trade').map((n) => n.id), ['trade-look'], 'trade: another team’s saved list is not yours');
  eq(kind(notes({ team, saved: { ...saved, v: 2 } }), 'trade').map((n) => n.id), ['trade-look'], 'trade: a record of another shape is not read');
  eq(kind(notes({ team, saved: { ...saved, deals: [] } }), 'trade').map((n) => n.id), ['trade-look'], 'trade: an empty list is the one "look" line');
}

// ------------------------------------------------------------------ send-later
// Tim, 2026-10-15: a saved custom trade set to "After wk N" is a line once week
// N has been played. Entries in the Trade page's stored shape (`ff.prefs`
// `trade.custom`): squad ids as numbers, the men each squad SENDS as id strings.
{
  const team = teamOf(squad());
  const later = [
    { a: ME, b: 3, sendA: ['105'], sendB: ['301'], sendAfter: 4 },          // due: week 4 is played
    { a: 7, b: ME, sendA: ['701'], sendB: ['112', '111'], sendAfter: 3 },   // due, saved from his side
    { a: ME, b: 3, sendA: ['110'], sendB: ['302'], sendAfter: 5 },          // week 5 is the one being played
    { a: ME, b: 3, sendA: ['104'], sendB: ['302'] },                        // send now: no line
    { a: 3, b: 7, sendA: ['301'], sendB: ['701'], sendAfter: 2 },           // not your trade
  ];
  const ns = kind(notes({ team, later }), 'send-later');
  eq(ns, [
    { id: 'later-3-105-301', kind: 'send-later', level: 'now', title: 'Send your trade with Team Three',
      detail: 'Saved for after week 4', suggest: 'Offer Eli Ward for Quin Ashby',
      action: { label: 'Open it', href: 'trade.html?with=3&get=301&send=105' } },
    { id: 'later-7-111.112-701', kind: 'send-later', level: 'now', title: 'Send your trade with Team Seven',
      detail: 'Saved for after week 3', suggest: 'Offer Lou Thorn, Kit West for Sol Vance',
      action: { label: 'Open it', href: 'trade.html?with=7&get=701&send=112,111' } },
  ], 'send-later: one line per trade of yours whose week is played, naming the men each way and opening that deal');
  eq(kind(notes({ team, later: [later[2]] }), 'send-later'), [], 'send-later: not before the week is played');
  eq(kind(notes({ team, later: [{ ...later[0], sendAfter: null }] }), 'send-later'), [], 'send-later: cleared back to now, no line');
  eq(kind(notes({ team }), 'send-later'), [], 'send-later: nothing saved, no line');
  eq(kind(notes({ team, later: 'junk' }), 'send-later'), [], 'send-later: a stored value of another shape is no line');
  eq(countNotes(notes({ team, later })).now, 2, 'send-later: the bell counts them');

  // Read off the Trade page's own preference slot, never another league's.
  const T = await import(pathToFileURL(path.join(REPO, 'js/notify-trades.js')).href);
  const box = (v) => ({ getItem: (k) => (k === 'ff.prefs' ? (typeof v === 'string' ? v : JSON.stringify(v)) : null) });
  const prefs = { '@league': '99-2026', 'trade.week': 5, 'trade.custom': later };
  eq(T.readSendLater('99', 2026, box(prefs)), later.filter((e) => e.sendAfter != null), 'send-later read: this league’s saved trades that carry a week');
  eq(T.readSendLater('99', 2026, box({ ...prefs, '@league': '12-2026' })), [], 'send-later read: another league’s slot is not read');
  eq(T.readSendLater('99', 2026, box({ 'trade.custom': later })).length, 4, 'send-later read: an unmarked slot is the open league’s');
  eq(T.readSendLater('99', 2026, box('{not json')), [], 'send-later read: a broken slot is nothing');
  eq(T.readSendLater('99', 2026, { getItem: () => { throw new Error('denied'); } }), [], 'send-later read: storage refused is nothing');
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
  eq(countNotes(ns), { now: 2, pending: 0, soon: 1, idea: 2 }, 'counts: how many stand at each level');
  eq(new Set(ns.map((n) => n.id)).size, ns.length, 'every line has its own id');
  ok(ns.every((n) => n.title && n.detail && n.action && n.action.label && n.action.href), 'every line has a title, a detail and one button with somewhere to go');
  ok(ns.every((n) => n.title.split(/\s+/).length <= 8 && n.action.label.split(/\s+/).length <= 2), 'a line is a few words and its button one or two');
  eq(countNotes([]), { now: 0, pending: 0, soon: 0, idea: 0 }, 'counts: none');
  // The suggested action: on every line here but the "look" one, and short.
  ok(ns.every((n) => 'suggest' in n && (n.suggest === null || (typeof n.suggest === 'string' && n.suggest))), 'every line carries `suggest`: words or null', ns.map((n) => n.suggest));
  eq(ns.filter((n) => n.suggest === null).map((n) => n.id), ['trade-look'], 'only "Look for trades" has nothing to suggest');
  ok(ns.every((n) => !n.suggest || n.suggest.split(/\s+/).length <= 10), 'a suggestion is ten words or fewer', ns.map((n) => n.suggest));
  ok(ns.every((n) => !n.suggest || n.suggest !== n.detail), 'and never the detail said again');
}

// ---------------------------------------------------------------- pending claims (2026-10-22)
{
  const at = NOW + 9 * HOUR;
  const claims = [
    { id: 'w1', kind: 'waiver', add: 900, drop: 105, addName: 'Ned Park', dropName: 'Eli Ward', bid: 7, processAt: at, order: 1 },
    { id: 'w2', kind: 'waiver', add: 901, drop: null, addName: 'Ty Moss', bid: 0, processAt: at, order: 2 },
    { id: 'd1', kind: 'drop', add: null, drop: 110, dropName: 'Jon Ross', bid: null, processAt: null, order: null },
  ];
  const ns = kind(notes({ team: teamOf(squad()), claims }), 'claim');
  const when = PV.whenText(at, NOW);
  eq(ns.map((n) => [n.id, n.level, n.title, n.detail, n.action.href]), [
    ['claim-w1', 'pending', 'Waiver claim', `Add Ned Park, drop Eli Ward · $7 bid · claim 1 · processes ${when}`, 'waivers.html?player=900'],
    ['claim-w2', 'pending', 'Waiver claim', `Add Ty Moss · claim 2 · processes ${when}`, 'waivers.html?player=901'],
    ['claim-d1', 'pending', 'Drop', 'Drop Jon Ross', 'waivers.html?player=110'],
  ], 'claims: a FAAB claim shows its bid, a no-FAAB claim none, each with its order and process time; a drop says who');
  eq(countNotes(notes({ team: teamOf(squad()), claims })).pending, 3, 'claims: the bell counts them as pending');
  eq(N.claimNotes({ claims: [claims[1]], claimsAt: NOW - 2 * HOUR, now: NOW })[0].detail,
    `Add Ty Moss · claim 2 · processes ${when} · as of 2 hours ago`, 'claims: a synced copy says how old it is');
  eq(N.claimNotes({ claims: [null, {}, 'x'] }), [], 'claims: rubbish makes no lines');
  eq(kind(notes({ team: teamOf(squad()) }), 'claim'), [], 'claims: none known, no lines');
  ok(ns.every((n) => n.title.split(/\s+/).length <= 8 && n.action.label.split(/\s+/).length <= 2), 'claims: a few words and a short button');
}

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
