// OUT FOR THE SEASON — ESPN's own flag, and the rule the Trade page bars by.
//
//   node test-out-for-season.mjs
//
// Tim, 2026-10-12: "This doesn't happen often but I just saw a trade offer with
// a player that was out for the rest of the season, which should never happen."
//
// The first rule (2026-10-12) guessed "for the season" from status Out + a 0
// projection in every week left. ESPN projects most IR men 0 for every week
// left even when it expects them back (measured on public league 1241838,
// 2026-10-14: Tank Dell, back 10/18, was barred). ESPN's own word is
// `player.injuryDetails.outForSeason`, on `kona_playercard` only.
//
// The entries below are cut from that view's real shape (2026-10-14): the keys
// ESPN sends around `injuryDetails` are kept so the decoder is fed what it will
// really be fed. The players are public NFL players.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const espn = await imp('js/espn.js');
const { outForSeasonRule } = await imp('js/injury.js');

let pass = 0;
let fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/** One `kona_playercard` entry, in ESPN's shape. */
function card(id, fullName, injuryStatus, injuryDetails, extra = {}) {
  return {
    appliedStatTotal: 0, draftAuctionValue: 0, droppedByEliminatedTeam: false, id,
    keeperValue: 7, keeperValueFuture: 7, lineupLocked: false, onTeamId: 10,
    player: {
      active: true, defaultPositionId: 2, droppable: true, eligibleSlots: [2, 3, 23, 7, 20, 21],
      fullName, id, injured: injuryStatus !== 'ACTIVE',
      ...(injuryDetails === undefined ? {} : { injuryDetails }),
      injuryStatus, proTeamId: 26,
      ownership: { percentOwned: 57.35, percentStarted: 0.32 },
      stats: [{ seasonId: 2026, scoringPeriodId: 7, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 0 }],
      ...extra,
    },
    ratings: {}, rosterLocked: false, status: 'ONTEAM', tradeLocked: false, transactions: null,
  };
}

// ---------------------------------------------------------------- the decoder
{
  const back = espn.parseInjuryDetails(card(4366031, 'Tank Dell', 'INJURY_RESERVE',
    { expectedReturnDate: [2026, 10, 18], outForSeason: false, type: 'Knee - ACL + MCL' }));
  same(back, { playerId: 4366031, outForSeason: false, returnDate: '2026-10-18', type: 'Knee - ACL + MCL' },
    'a returner decodes to outForSeason false with his return date');
  const gone = espn.parseInjuryDetails(card(4429160, "De'Von Achane", 'INJURY_RESERVE',
    { expectedReturnDate: [2027, 2, 15], outForSeason: true, type: 'Knee - ACL' }));
  same(gone, { playerId: 4429160, outForSeason: true, returnDate: '2027-02-15', type: 'Knee - ACL' },
    'a man out for the season decodes to outForSeason true');
  eq(espn.parseInjuryDetails(card(1, 'No Details', 'OUT', undefined)), null,
    'no injuryDetails on the entry is not known (null), never "not out"');
  eq(espn.parseInjuryDetails(card(2, 'Half Details', 'OUT', { expectedReturnDate: [2026, 11, 2], type: 'Chest' })), null,
    'injuryDetails without a true/false outForSeason is not known either');
  const noDate = espn.parseInjuryDetails(card(3, 'Dateless', 'OUT', { outForSeason: false, type: null }));
  ok(noDate && noDate.returnDate === null && noDate.type === null && noDate.outForSeason === false,
    'a missing return date and type decode to null', JSON.stringify(noDate));
  eq(espn.parseInjuryDetails(null), null, 'nothing decodes to nothing');
  eq(typeof espn.fetchInjuryDetails, 'function', 'espn.js has the kona_playercard read');
}

// ------------------------------------------------------------------ the rule
//
// `weekValues` is what the Trade page holds of him for each week left, his bye
// left out: twelve weeks, as on 1241838 in week 6.
{
  const zeros = Array(12).fill(0);
  const man = (injuryStatus, injuryDetails) => ({
    playerId: 4366031, name: 'Tank Dell', position: 'WR', injuryStatus,
    ...(injuryDetails ? { injuryDetails } : {}),
  });
  const backOct18 = { outForSeason: false, returnDate: '2026-10-18', type: 'Knee - ACL + MCL' };
  const forSeason = { outForSeason: true, returnDate: '2027-02-15', type: 'Knee - ACL' };

  // The bug Tim saw the other side of: a returner projected at 0 everywhere.
  eq(outForSeasonRule(man('INJURY_RESERVE', backOct18), zeros), false,
    'ESPN says he is coming back (outForSeason false) and projects 0 in every week: NOT barred');
  eq(outForSeasonRule(man('OUT', backOct18), zeros), false,
    'the same for status OUT');
  eq(outForSeasonRule(man('INJURY_RESERVE', forSeason), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3.2]), true,
    'ESPN says out for the season: barred even with a positive projection in a week');
  eq(outForSeasonRule(man('INJURY_RESERVE', forSeason), []), true,
    'and barred with no week held at all — ESPN said so');

  // Unknown: the old rule, unchanged.
  eq(outForSeasonRule(man('INJURY_RESERVE'), zeros), true,
    'not known, out, 0 in every week held: the old rule bars him');
  eq(outForSeasonRule(man('INJURY_RESERVE'), [0, 0, 4.1, ...Array(9).fill(0)]), false,
    'not known, out, but a positive week: the old rule keeps him');
  eq(outForSeasonRule(man('INJURY_RESERVE'), []), false,
    'not known and no week held: not barred');
  eq(outForSeasonRule(man('QUESTIONABLE'), zeros), false,
    'not known, questionable: not barred');
  eq(outForSeasonRule(man('ACTIVE'), zeros), false,
    'not known, healthy: not barred');
  eq(outForSeasonRule(man('INJURY_RESERVE', { returnDate: '2026-10-18' }), zeros), true,
    'details without a true/false flag count as not known: the old rule');
  eq(outForSeasonRule({ name: 'Nobody', injuryStatus: 'OUT' }, zeros), false,
    'a man with no id is never barred');
}

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
