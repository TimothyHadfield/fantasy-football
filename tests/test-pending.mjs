// Checks js/pending.js: the trade offers waiting on ESPN for one team.
//
// Tim, 2026-10-11: "messages on any trade notifications you have".
//
// THE FIXTURES ARE THE DOCUMENTED SHAPE, NOT A RECORDING. ESPN answers
// `view=mPendingTransactions` only for a logged-in owner, so no real payload
// could be measured (js/pending.js lists the sources). Every record below is
// built to that shape — a uuid for an id, `TRADE_PROPOSAL`, `status: PENDING`,
// `TRADE` items with `playerId` / `fromTeamId` / `toTeamId`, epoch-ms dates —
// and then bent, one way at a time, into everything ESPN might send instead.
// The teams are numbers and the men are made-up ids; nobody real is here.
//
// I am team 1 throughout.

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  if (Object.is(a, b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const same = (a, b, msg) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const ok = (c, msg, extra = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); } };

let p = null;
try {
  p = await import('../js/pending.js');
} catch (err) {
  console.log(`FAIL js/pending.js does not load: ${String(err && err.message).split('\n')[0]}`);
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}

const ME = 1;
const T0 = 1760000000000;             // when it was proposed
const T2 = T0 + 2 * 24 * 3600 * 1000; // two days on: when it lapses
const item = (playerId, fromTeamId, toTeamId, type = 'TRADE') => ({
  type, playerId, fromTeamId, toTeamId, fromLineupSlotId: -1, toLineupSlotId: -1, isKeeper: false,
});
/** A proposal as documented. `over` bends it. */
const proposal = (id, teamId, items, over = {}) => ({
  id, type: 'TRADE_PROPOSAL', status: 'PENDING', isPending: true, executionType: 'EXECUTE',
  teamId, memberId: '{00000000-0000-0000-0000-000000000000}', scoringPeriodId: 6,
  proposedDate: T0, expirationDate: T2, teamActions: {}, items, ...over,
});

// ---------------------------------------------------- an offer made TO me
// Team 3 offers his 301 and 302 for my 101.
const TO_ME = proposal('aaaa-1', 3, [item(301, 3, 1), item(302, 3, 1), item(101, 1, 3)]);
{
  const got = p.pendingTrades({ pendingTransactions: [TO_ME] }, ME);
  eq(got.length, 1, 'an offer made to me is listed');
  same(got[0], { id: 'aaaa-1', withTeamId: 3, get: [301, 302], send: [101], proposedAt: T0, expiresAt: T2, fromMe: false },
    'to me: the men coming are `get`, the man leaving is `send`, and he proposed it');
  same(Object.keys(got[0]), ['id', 'withTeamId', 'get', 'send', 'proposedAt', 'expiresAt', 'fromMe'],
    'exactly the contract\'s fields, nothing of ESPN\'s carried along');
  same(p.pendingTrades([TO_ME], ME), got, 'the list itself may be handed in');
  same(p.pendingTrades({ pendingTransactions: [TO_ME] }, '1'), got, 'my team as a string is the same team');
}

// --------------------------------------------------- an offer made BY me
// I offer my 102 for team 2's 201.
const BY_ME = proposal('bbbb-2', 1, [item(102, 1, 2), item(201, 2, 1)]);
{
  const got = p.pendingTrades({ pendingTransactions: [BY_ME] }, ME);
  same(got, [{ id: 'bbbb-2', withTeamId: 2, get: [201], send: [102], proposedAt: T0, expiresAt: T2, fromMe: true }],
    'by me: fromMe is true, and get / send are still from my side');
  // The same record from the other man's chair.
  same(p.pendingTrades({ pendingTransactions: [BY_ME] }, 2),
    [{ id: 'bbbb-2', withTeamId: 1, get: [102], send: [201], proposedAt: T0, expiresAt: T2, fromMe: false }],
    'the same offer read as team 2: mirrored, and not from him');
}

// ------------------------------------------------------- not mine at all
{
  const theirs = proposal('cccc-3', 3, [item(301, 3, 4), item(401, 4, 3)]);
  same(p.pendingTrades({ pendingTransactions: [theirs] }, ME), [], 'an offer between two other teams is not mine');
  same(p.pendingTrades({ pendingTransactions: [TO_ME, theirs, BY_ME] }, ME).map((o) => o.id), ['aaaa-1', 'bbbb-2'],
    'mine are kept, in ESPN\'s order, with the other left out');
}

// ----------------------------------------------- what is not a trade offer
{
  // A waiver claim rides the same list.
  const claim = {
    id: 'dddd-4', type: 'WAIVER', status: 'PENDING', isPending: true, teamId: 1, bidAmount: 7,
    proposedDate: T0, items: [item(901, 0, 1, 'ADD'), item(103, 1, 0, 'DROP')],
  };
  same(p.pendingTrades({ pendingTransactions: [claim] }, ME), [], 'a waiver claim is not a trade offer');
  const roster = { id: 'dddd-5', type: 'ROSTER', status: 'PENDING', teamId: 1, items: [item(101, 1, 1, 'LINEUP')] };
  same(p.pendingTrades({ pendingTransactions: [roster] }, ME), [], 'nor is a lineup move');
  // 2026-10-22: AN ACCEPTED TRADE IN THE LEAGUE'S REVIEW IS a pending move — the
  // same record turned TRADE_ACCEPT, with `processDate` the time it goes through
  // (dustinJ15/fantasy `pending_trades`, probed 2026-10-13).
  const T3 = T0 + 3 * 24 * 3600 * 1000;
  const accept = proposal('dddd-6', 1, [item(301, 3, 1), item(101, 1, 3)], { type: 'TRADE_ACCEPT', processDate: T3 });
  same(p.pendingTrades({ pendingTransactions: [accept] }, ME),
    [{ id: 'dddd-6', withTeamId: 3, get: [301], send: [101], proposedAt: T0, expiresAt: null, fromMe: true, review: true, processAt: T3 }],
    'an accepted trade waiting on the league\'s review is listed, flagged review, with when it processes and no offer clock');
  same(p.pendingTrades({ pendingTransactions: [accept] }, ME, { now: T2 + 1 }).length, 1,
    'its old offer clock running out does not drop it');
  same(p.pendingTrades({ pendingTransactions: [accept] }, ME, { now: T3 }), [], 'once it has processed it is gone');
  same(p.pendingTrades({ pendingTransactions: [{ ...accept, status: 'ACCEPTED' }] }, ME).length, 1, 'status ACCEPTED on it is still in review');
  same(p.pendingTrades({ pendingTransactions: [{ ...accept, status: 'EXECUTED' }] }, ME), [], 'an executed one is done');
  same(p.cleanOffers(p.pendingTrades({ pendingTransactions: [accept] }, ME)),
    p.pendingTrades({ pendingTransactions: [accept] }, ME), 'the synced copy keeps review and processAt');
  // An accept that is a record of its own, naming the proposal: one line, not two.
  const asked = proposal('dddd-7', 3, [item(301, 3, 1), item(101, 1, 3)]);
  const yes = proposal('dddd-8', 1, [item(301, 3, 1), item(101, 1, 3)], { type: 'TRADE_ACCEPT', relatedTransactionId: 'dddd-7', processDate: T3 });
  same(p.pendingTrades({ pendingTransactions: [asked, yes] }, ME).map((o) => [o.id, !!o.review]), [['dddd-8', true]],
    'a proposal answered by a separate accept shows once, as the accepted trade');
}

// --------------------------------------------- the other moves: claims
{
  const T1 = T0 + 24 * 3600 * 1000;
  const claim = (id, over = {}, items = [item(901, 0, 1, 'ADD'), item(103, 1, 0, 'DROP')]) => ({
    id, type: 'WAIVER', status: 'PENDING', executionType: 'EXECUTE', isPending: true, teamId: 1,
    memberId: '{00000000-0000-0000-0000-000000000000}', scoringPeriodId: 7,
    bidAmount: 7, proposedDate: T0, processDate: T1, items, ...over,
  });
  const got = p.pendingClaims({ pendingTransactions: [claim('w-1')] }, ME);
  same(got, [{ id: 'w-1', kind: 'waiver', add: 901, drop: 103, moves: 0, bid: 7, processAt: T1, proposedAt: T0, order: 1 }],
    'a FAAB claim: who comes, who goes, the bid, when it processes, claim 1');
  same(p.pendingClaims({ pendingTransactions: [claim('w-2', { bidAmount: 0 })] }, ME)[0].bid, 0,
    'a priority league\'s claim: bid 0 (kept; the words leave it out)');
  same(p.pendingClaims({ pendingTransactions: [claim('w-3', { bidAmount: undefined })] }, ME)[0].bid, null,
    'a claim with no bidAmount: bid null');
  same(p.pendingClaims({ pendingTransactions: [claim('w-4', {}, [item(902, 0, 1, 'ADD')])] }, ME)[0],
    { id: 'w-4', kind: 'waiver', add: 902, drop: null, moves: 0, bid: 7, processAt: T1, proposedAt: T0, order: 1 },
    'an add with nobody dropped');
  same(p.pendingClaims({ pendingTransactions: [claim('a'), claim('b'), claim('c', { teamId: 4 })] }, ME).map((c) => [c.id, c.order]),
    [['a', 1], ['b', 2]], 'my claims numbered in ESPN\'s order; another team\'s left out');
  same(p.pendingClaims({ pendingTransactions: [claim('x', { status: 'EXECUTED' }), claim('y', { executionType: 'CANCEL' }),
    claim('z', { isPending: false }), claim('q', { status: 'FAILED_INVALIDPLAYERSOURCE' })] }, ME), [],
  'executed, cancelled, not pending or failed: none');
  same(p.pendingClaims({ pendingTransactions: [claim('r'), { id: 's', type: 'WAIVER', status: 'CANCELED', executionType: 'CANCEL', relatedTransactionId: 'r', teamId: 1, items: [] }] }, ME), [],
    'a claim a CANCEL copy names is gone');
  same(p.pendingClaims({ pendingTransactions: [TO_ME, BY_ME] }, ME), [], 'a trade offer is not a claim');
  const fa = p.pendingClaims({ pendingTransactions: [claim('f', { type: 'FREEAGENT', bidAmount: 0, processDate: undefined })] }, ME)[0];
  same([fa.kind, fa.processAt, fa.order], ['free-agent', null, 1], 'a queued free-agent add');
  same(p.pendingClaims({ pendingTransactions: [claim('d', { type: 'FREEAGENT' }, [item(104, 1, 0, 'DROP')])] }, ME)[0].kind, 'free-agent',
    'a FREEAGENT record that only drops is still the free-agent kind');
  same(p.pendingClaims({ pendingTransactions: [claim('d2', { type: 'DRAFT' }, [item(104, 1, 0, 'DROP')])] }, ME)[0].kind, 'drop',
    'any other record that only drops is a drop');
  const lu = p.pendingClaims({ pendingTransactions: [claim('l', { type: 'ROSTER', bidAmount: undefined }, [item(101, 1, 1, 'LINEUP'), item(102, 1, 1, 'LINEUP')])] }, ME)[0];
  same([lu.kind, lu.moves, lu.order], ['lineup', 2, 0], 'a queued lineup change: two moves, not a numbered claim');
  same(p.pendingClaims({ pendingTransactions: [claim('e', {}, [])] }, ME), [], 'a claim with no men in it: none');
  for (const bad of [undefined, null, {}, { pendingTransactions: 'x' }, 7]) same(p.pendingClaims(bad, ME), [], 'rubbish in, []');
  same(p.pendingClaims({ pendingTransactions: [claim('w-1')] }, 0), [], 'no team, []');
  // The copy.
  const named = got.map((c) => ({ ...c, addName: 'Ray Keane', dropName: 'Eli Ward', addPos: 'WR', memberId: 'x' }));
  same(p.cleanClaims(named), [{ ...got[0], addName: 'Ray Keane', dropName: 'Eli Ward', addPos: 'WR' }],
    'cleanClaims keeps the contract and the names, nothing else');
  same(p.cleanClaims([{ id: 'k', kind: 'hack', add: 1 }, { id: '', kind: 'waiver', add: 1 }, { id: 'k', kind: 'waiver' },
    { id: 'k', kind: 'waiver', add: 'x' }, null, 4]), [], 'whatever is not a move is dropped');
  same(p.cleanClaims(named.map((c) => ({ ...c, addName: 'z'.repeat(200) })))[0].addName, undefined, 'a name too long to be one is dropped');
  eq(p.cleanClaims(Array.from({ length: 30 }, (_, i) => ({ ...got[0], id: `m${i}` }))).length, 20, 'a copy carries at most 20');
  eq(p.claimDone(got[0], T1 - 1), false, 'claimDone: before its waiver run');
  eq(p.claimDone(got[0], T1), true, 'claimDone: at it');
  eq(p.claimDone({ processAt: null }, T1), false, 'claimDone: no time, never');
}

// ------------------------------------------- no longer pending, five ways
{
  const one = (over) => p.pendingTrades({ pendingTransactions: [proposal('eeee-1', 3, [item(301, 3, 1), item(101, 1, 3)], over)] }, ME);
  eq(one({}).length, 1, '(the plain record IS listed — so the five below are the rule, not the fixture)');
  same(one({ status: 'EXECUTED' }), [], 'an executed one is gone');
  same(one({ status: 'CANCELED' }), [], 'a cancelled one is gone');
  same(one({ status: 'CANCELED', executionType: 'CANCEL' }), [], 'ESPN\'s CANCEL copy is gone');
  same(one({ executionType: 'CANCEL', status: undefined }), [], 'a CANCEL copy with no status is gone too');
  same(one({ isPending: false }), [], 'isPending false is gone, whatever status says');
  eq(one({ status: undefined }).length, 1, 'a record with no status at all, still isPending, is pending');
  eq(one({ status: undefined, isPending: undefined }).length, 1, 'and so is one that says neither (ESPN listed it as pending)');

  // Answered by another record on the same list.
  const open = proposal('eeee-2', 3, [item(301, 3, 1), item(101, 1, 3)]);
  const decline = { id: 'eeee-3', type: 'TRADE_DECLINE', status: 'EXECUTED', teamId: 1, relatedTransactionId: 'eeee-2', items: [] };
  same(p.pendingTrades({ pendingTransactions: [open, decline] }, ME), [], 'a proposal a decline names is gone');
  const cancel = proposal('eeee-4', 3, [], { executionType: 'CANCEL', status: 'CANCELED', relatedTransactionId: 'eeee-2' });
  same(p.pendingTrades({ pendingTransactions: [cancel, open] }, ME), [], 'and one a CANCEL copy names, whichever comes first');
  eq(p.pendingTrades({ pendingTransactions: [open, { ...decline, relatedTransactionId: 'someone-else' }] }, ME).length, 1,
    'a decline of ANOTHER proposal leaves this one');
}

// --------------------------------------------------------------- the clock
{
  const raw = { pendingTransactions: [TO_ME] };
  eq(p.pendingTrades(raw, ME, { now: T2 - 1 }).length, 1, 'a moment before it lapses it is listed');
  same(p.pendingTrades(raw, ME, { now: T2 }), [], 'at its expirationDate it is not');
  same(p.pendingTrades(raw, ME, { now: T2 + 60000 }), [], 'nor after');
  eq(p.pendingTrades(raw, ME).length, 1, 'with no clock handed in nothing is judged by time');
  const noEnd = proposal('ffff-1', 3, [item(301, 3, 1)], { expirationDate: undefined });
  eq(p.pendingTrades({ pendingTransactions: [noEnd] }, ME, { now: T2 * 2 }).length, 1, 'an offer naming no expiry never lapses here');
  eq(p.expired({ expiresAt: 10 }, 10), true, 'expired: at the time');
  eq(p.expired({ expiresAt: 10 }, 9), false, 'expired: before it');
  eq(p.expired({ expiresAt: null }, 99), false, 'expired: no time, never');
}

// ------------------------------------------------------------------- dates
{
  const dated = (over) => p.pendingTrades({ pendingTransactions: [proposal('gggg-1', 3, [item(301, 3, 1)], over)] }, ME)[0];
  eq(dated({ expirationDate: '2026-10-13T08:53:20.000Z' }).expiresAt, Date.parse('2026-10-13T08:53:20.000Z'),
    'an ISO expirationDate (the form it is WRITTEN in) is read as epoch ms');
  eq(dated({ proposedDate: String(T0) }).proposedAt, T0, 'a date as a numeric string is read');
  eq(dated({ proposedDate: undefined }).proposedAt, null, 'a missing proposedDate is null, and the offer is still listed');
  eq(dated({ expirationDate: 'soon' }).expiresAt, null, 'a date that is not one is null');
  eq(dated({ expirationDate: 0 }).expiresAt, null, 'and so is 0');
  eq(dated({ proposedDate: { seconds: 5 } }).proposedAt, null, 'and an object');
}

// ------------------------------------------------------------ the items
{
  const of = (items, over) => p.pendingTrades({ pendingTransactions: [proposal('hhhh-1', 3, items, over)] }, ME);
  same(of(undefined), [], 'a proposal with no items is skipped');
  same(of(null), [], 'items null: skipped');
  same(of([]), [], 'items empty: skipped');
  same(of('TRADE'), [], 'items not a list: skipped');
  same(of([null, 7, 'x']), [], 'items of rubbish: skipped');

  // A THIRD TEAM.
  same(of([item(301, 3, 1), item(101, 1, 3), item(401, 4, 1)]), [], 'an offer with a third team sending to me is skipped whole');
  same(of([item(301, 3, 1), item(101, 1, 4)]), [], 'so is one where my man goes to a different team than the one sending');
  same(of([item(301, 3, 1), item(101, 1, 3), item(402, 4, 3)]), [],
    'and one with a leg between two OTHER teams beside mine');

  // A cut riding along is not a trade item, and does not spoil the offer.
  same(of([item(301, 3, 1), item(101, 1, 3), item(109, 1, 0, 'DROP'), { type: 'DROP', playerId: 110, fromTeamId: 1 }])[0],
    { id: 'hhhh-1', withTeamId: 3, get: [301], send: [101], proposedAt: T0, expiresAt: T2, fromMe: false },
    'a man cut to make room (one team, or team 0) is left out of get and send');

  // A leg with no type of its own still counts; ids as strings are numbers.
  same(of([{ playerId: '301', fromTeamId: '3', toTeamId: '1' }])[0].get, [301], 'a leg with no type, and ids as strings, is read');
  same(of([item(-16003, 3, 1), item(101, 1, 3)])[0].get, [-16003], 'a D/ST\'s negative id is a real id');
  same(of([item(301, 3, 1), item(301, 3, 1)])[0].get, [301], 'the same man twice is one man');
  same(of([item(301, 3, 1)])[0].send, [], 'a one-sided offer is listed, with an empty side');
  same(of([item(undefined, 3, 1), item(101, 1, 3)]), [], 'a leg with no player id: the offer is skipped, not shown half');
  same(of([item(0, 3, 1)]), [], 'player id 0 is not a player');
  same(of([item(301, 1, 1)]), [], 'a "trade" from me to me is nothing');
}

// ------------------------------------------------------- who proposed it
{
  const got = p.pendingTrades({ pendingTransactions: [proposal('iiii-1', undefined, [item(301, 3, 1)])] }, ME)[0];
  eq(got.fromMe, null, 'no teamId on the record: fromMe is null, not a guess');
  eq(got.withTeamId, 3, 'and the other team still comes from the legs');
}

// ---------------------------------------------------------------- the id
{
  const noId = proposal(undefined, 3, [item(302, 3, 1), item(301, 3, 1), item(101, 1, 3)]);
  const got = p.pendingTrades({ pendingTransactions: [noId] }, ME);
  eq(got.length, 1, 'an offer ESPN gave no id for is still listed');
  eq(got[0].id, '3:301.302>101', 'named by what is in it');
  eq(p.pendingTrades({ pendingTransactions: [noId, noId] }, ME).length, 1, 'and the same offer twice is one offer');
  eq(p.pendingTrades({ pendingTransactions: [TO_ME, TO_ME] }, ME).length, 1, 'the same id twice is one offer');
  eq(p.pendingTrades({ pendingTransactions: [proposal(987654, 3, [item(301, 3, 1)])] }, ME)[0].id, '987654', 'a numeric id is a string');
}

// ------------------------------------------------ never a throw, always []
{
  for (const [raw, name] of [
    [undefined, 'undefined'], [null, 'null'], ['', 'an empty string'], ['pendingTransactions', 'a string'],
    [42, 'a number'], [{}, 'a payload with no key (the cookie-less read)'], [{ pendingTransactions: null }, 'key null'],
    [{ pendingTransactions: {} }, 'key an object'], [{ pendingTransactions: 'none' }, 'key a string'],
    [{ messages: ['You are not authorized'] }, 'an error body'],
  ]) {
    let got = 'threw';
    try { got = p.pendingTrades(raw, ME); } catch { /* reported below */ }
    same(got, [], `${name} -> []`);
  }
  const rubbish = [null, undefined, 3, 'x', [], { type: 'TRADE_PROPOSAL' }, { type: 'TRADE_PROPOSAL', items: [{}] },
    { type: 'TRADE_PROPOSAL', status: 'PENDING', items: [{ playerId: {}, fromTeamId: [], toTeamId: NaN }] }];
  let got = 'threw';
  try { got = p.pendingTrades({ pendingTransactions: [...rubbish, TO_ME] }, ME); } catch { /* reported below */ }
  same(Array.isArray(got) ? got.map((o) => o.id) : got, ['aaaa-1'], 'a list of rubbish with one real offer in it gives that offer');

  for (const [team, name] of [[undefined, 'undefined'], [null, 'null'], ['', 'empty'], [0, '0'], [-1, 'negative'], ['abc', 'a word'], [1.5, 'a fraction'], [true, 'true']]) {
    same(p.pendingTrades({ pendingTransactions: [TO_ME, BY_ME] }, team), [], `my team ${name} -> []`);
  }
  // A getter that throws, in the middle of the list.
  const bomb = { get type() { throw new Error('boom'); } };
  got = 'threw';
  try { got = p.pendingTrades({ pendingTransactions: [bomb] }, ME); } catch { /* reported below */ }
  same(got, [], 'even a record that throws when read gives [], not a throw');
}

// ------------------------------------------------- cleanOffers (the copy)
{
  const real = p.pendingTrades({ pendingTransactions: [TO_ME, BY_ME] }, ME);
  same(p.cleanOffers(real), real, 'real offers pass through unchanged');
  ok(p.cleanOffers(real)[0] !== real[0] && p.cleanOffers(real)[0].get !== real[0].get, 'as copies, not the same objects');
  same(p.cleanOffers([{ ...real[0], comment: 'take it', memberId: '{x}', items: [1, 2, 3] }]), [real[0]],
    'anything beyond the contract\'s fields is cut off');
  eq(p.MAX_OFFERS, 20, 'a synced copy carries at most 20');
  const many = Array.from({ length: 45 }, (_, i) => ({ ...real[0], id: `m-${i}` }));
  eq(p.cleanOffers(many).length, 20, '45 offers are cut to 20');
  same(p.cleanOffers(many).map((o) => o.id), many.slice(0, 20).map((o) => o.id), 'the first 20, in order');
  eq(p.cleanOffers(many, 3).length, 3, 'or to whatever cap is asked');
  // The bound a synced schedule has to carry: 20 full offers.
  const fat = Array.from({ length: 20 }, (_, i) => ({
    id: `0f8fad5b-d9cb-469f-a165-70867728950${i % 10}`, withTeamId: 10,
    get: Array.from({ length: 8 }, (_, k) => 4000000 + i * 10 + k), send: Array.from({ length: 8 }, (_, k) => -16000 - k),
    proposedAt: T0, expiresAt: T2, fromMe: false,
  }));
  const bytes = JSON.stringify({ teamId: 10, at: T0, offers: p.cleanOffers(fat) }).length;
  ok(bytes < 8000, '20 offers of eight men a side are under 8 KB in the synced copy', `${bytes} chars`);

  for (const [bad, name] of [
    [undefined, 'undefined'], [null, 'null'], [{}, 'an object'], ['x', 'a string'], [7, 'a number'],
  ]) same(p.cleanOffers(bad), [], `cleanOffers(${name}) -> []`);
  same(p.cleanOffers([null, 5, 'x', {}, { id: 'a' }, { id: 'a', withTeamId: 2 }, { id: 'a', withTeamId: 2, get: [1] },
    { id: '', withTeamId: 2, get: [1], send: [] }, { id: 'a', withTeamId: 0, get: [1], send: [] },
    { id: 'a', withTeamId: 2, get: [], send: [] }, { id: 'a', withTeamId: 2, get: ['x'], send: [] },
    { id: 'z'.repeat(500), withTeamId: 2, get: [1], send: [] },
    { id: 'a', withTeamId: 2, get: Array.from({ length: 200 }, (_, i) => i + 1), send: [] }]), [],
    'whatever is not an offer is dropped: no id, no team, no men, a man who is not a number, an id or a side too long to be real');
  same(p.cleanOffers([{ id: 'k', withTeamId: '4', get: ['11'], send: [], proposedAt: 'x', expiresAt: String(T2), fromMe: 'yes' }]),
    [{ id: 'k', withTeamId: 4, get: [11], send: [], proposedAt: null, expiresAt: T2, fromMe: null }],
    'and a loosely-typed one is tightened: numbers as numbers, an unknown date or proposer as null');
}

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
