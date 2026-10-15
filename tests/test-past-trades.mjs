// NO BUYING BACK WHAT YOU TRADED — js/past-trades.js.
//
//   node test-past-trades.mjs
//
// Tim, 2026-10-15: "don't suggest trades from players that you've already
// traded with that user? Ex: I give away saquon Barkely, so don't suggest I buy
// him back from the same user, or vice versa."

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const { pastTradeBars, undoesPastTrade } = await import(pathToFileURL(path.join(REPO, 'js/past-trades.js')).href);

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

// You are team 1. You sent man 10 to team 2 for man 20 (filed from YOUR side),
// and team 3 sent you man 30 for your man 11 (filed from HIS side).
const moves = [
  { kind: 'add', teamId: 1, adds: [99], drops: [], trade: null },
  { kind: 'trade', teamId: 1, trade: { withTeamId: 2, gives: [10], gets: [20] } },
  { kind: 'trade', teamId: 3, trade: { withTeamId: 1, gives: [30], gets: [11] } },
  { kind: 'trade', teamId: 4, trade: { withTeamId: 5, gives: [40], gets: [50] } },
];
const bars = pastTradeBars(moves, 1);
const offer = (partner, send, receive) => ({ partner: { id: partner }, send: send.map((playerId) => ({ playerId })), receive: receive.map((playerId) => ({ playerId })) });

ok(bars.size === 2, 'only the managers you traded with have bars', [...bars.keys()].join());
ok(undoesPastTrade(offer(2, [12], [10]), bars), 'buying back the man you sent him is barred');
ok(undoesPastTrade(offer(2, [20], [21]), bars), 'sending back the man you got from him is barred');
ok(undoesPastTrade(offer(3, [13], [11]), bars), 'filed from HIS side: buying back your man is barred');
ok(undoesPastTrade(offer(3, [30], [31]), bars), 'filed from HIS side: sending his man back is barred');
ok(undoesPastTrade(offer('2', ['12'], ['10']), bars), 'ids as strings match too');
ok(!undoesPastTrade(offer(4, [10], [41]), bars), 'the same man with ANOTHER manager is allowed');
ok(!undoesPastTrade(offer(2, [12], [21]), bars), 'other men with the same manager are allowed');
ok(!undoesPastTrade(offer(5, [12], [40]), bars), 'a trade between two other managers bars nothing for you');
ok(!undoesPastTrade(offer(2, [12], [10]), pastTradeBars([], 1)), 'no trades, no bars');
ok(!undoesPastTrade(offer(2, [12], [10]), null), 'no bars read yet: nothing barred');

console.log(`test-past-trades.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
