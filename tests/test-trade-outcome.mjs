// Checks js/trade-outcome.js and its line in js/notify.js: a trade YOU SENT
// that ended without going through — declined, expired, vetoed, or simply no
// longer pending — and only that.
//
// Tim, 2026-10-22: "in fantasy, If a sent trade is either expired or denied,
// put it in the notifications section where it asks the user if they want to
// follow up or not, or dismiss it, just so the user can best go forward with
// the scenario."
//
// THE RECORDS ARE THE DOCUMENTED SHAPE (js/trade-outcome.js lists the sources:
// dustinJ15/fantasy `trade_resolutions`, probed on three leagues; js/espn.js
// `parseTransactions`), not a recording: no league we may read has a trade.
// Player ids are real ESPN ids (Ja'Marr Chase 4362628, Puka Nacua 4426515,
// Bijan Robinson 4430807, Lamar Jackson 3916387, Josh Jacobs 4047365, Breece
// Hall 4427366, CeeDee Lamb 4241389, Derrick Henry 3043078). I am team 1.

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

let o = null;
let notify = null;
try {
  o = await import('../js/trade-outcome.js');
  notify = await import('../js/notify.js');
} catch (err) {
  console.log(`FAIL js/trade-outcome.js does not load: ${String(err && err.message).split('\n')[0]}`);
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}

const ME = 1;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 22, 18, 0, 0);
const CHASE = 4362628, NACUA = 4426515, BIJAN = 4430807, LAMAR = 3916387;
const JACOBS = 4047365, HALL = 4427366, LAMB = 4241389, HENRY = 3043078;
const MY_MEMBER = '{AAAAAAAA-1111-1111-1111-111111111111}';
const HIS_MEMBER = '{BBBBBBBB-2222-2222-2222-222222222222}';
const ESPN_JOB = '{CCCCCCCC-0000-0000-0000-000000000000}';   // owns no team

/** One offer as js/pending.js `pendingTrades` hands it over. */
const offer = (id, withTeamId, get, send, over = {}) => ({
  id, withTeamId, get, send, proposedAt: NOW - DAY, expiresAt: NOW + DAY, fromMe: true, ...over,
});
/** The rosters now: player -> team. */
const holders = (pairs) => new Map(pairs);
// Nobody moved: each man still on the team he was on when it was offered.
const UNMOVED = holders([[CHASE, 3], [NACUA, 3], [BIJAN, ME], [LAMAR, ME], [JACOBS, 4], [HALL, ME], [LAMB, 2], [HENRY, ME]]);

// ---------------------------------------------------------------- resolutions
{
  const prop = (id, over = {}) => ({ id, type: 'TRADE_PROPOSAL', status: 'PENDING', executionType: 'EXECUTE', teamId: ME, memberId: MY_MEMBER, ...over });
  const owners = o.ownersOf([{ id: 1, owners: [MY_MEMBER] }, { id: 3, owners: [HIS_MEMBER.toLowerCase()] }]);
  const r = o.resolutions([
    prop('p-dec'),
    { id: 'd1', type: 'TRADE_DECLINE', status: 'EXECUTED', relatedTransactionId: 'p-dec', processDate: NOW - 2 * HOUR, memberId: HIS_MEMBER },
    prop('c-dec', { executionType: 'CANCEL', status: 'CANCELED', relatedTransactionId: 'p-dec', memberId: HIS_MEMBER, processDate: NOW - 2 * HOUR }),
    prop('c-rival', { executionType: 'CANCEL', status: 'CANCELED', relatedTransactionId: 'p-rival', memberId: HIS_MEMBER, processDate: NOW - HOUR }),
    prop('c-lapse', { executionType: 'CANCEL', status: 'CANCELED', relatedTransactionId: 'p-lapse', memberId: ESPN_JOB, processDate: NOW - 3 * HOUR }),
    prop('c-mine', { executionType: 'CANCEL', status: 'CANCELED', relatedTransactionId: 'p-mine', memberId: MY_MEMBER, processDate: NOW - HOUR }),
    { id: 'a1', type: 'TRADE_ACCEPT', status: 'EXECUTED', relatedTransactionId: 'p-acc', processDate: NOW - HOUR },
    prop('c-acc', { executionType: 'CANCEL', status: 'CANCELED', relatedTransactionId: 'p-acc', memberId: HIS_MEMBER }),
    { id: 'v1', type: 'TRADE_VETO', status: 'EXECUTED', relatedTransactionId: 'p-veto', processDate: NOW - HOUR },
    prop('p-word', { status: 'EXPIRED' }),
  ], { myTeamId: ME, owners });
  eq(r.get('p-dec'), { status: 'declined', at: NOW - 2 * HOUR }, 'a TRADE_DECLINE naming it: declined, at its time');
  eq(r.get('p-rival') && r.get('p-rival').status, 'declined', 'a CANCEL copy written by the other manager: declined');
  eq(r.get('p-lapse') && r.get('p-lapse').status, 'expired', "a CANCEL copy by a member who owns no team (ESPN's job): expired");
  eq(r.get('p-mine') && r.get('p-mine').status, 'withdrawn', 'a CANCEL copy by MY member id: withdrawn');
  eq(r.get('p-acc') && r.get('p-acc').status, 'accepted', 'TRADE_ACCEPT wins over a CANCEL copy of the same proposal');
  eq(r.get('p-veto') && r.get('p-veto').status, 'vetoed', 'a TRADE_VETO naming it: vetoed');
  eq(r.get('p-word') && r.get('p-word').status, 'expired', 'a status word EXPIRED on the proposal itself: expired');
  ok(!r.has('nothing'), 'a proposal nothing names is not resolved');
  // Without the owners, a CANCEL copy says only what its clock says.
  const bare = o.resolutions([
    prop('c1', { executionType: 'CANCEL', relatedTransactionId: 'late', memberId: ESPN_JOB, expirationDate: NOW - 5 * 60 * 1000, processDate: NOW - 4 * 60 * 1000 }),
    prop('c2', { executionType: 'CANCEL', relatedTransactionId: 'early', memberId: HIS_MEMBER, expirationDate: NOW + DAY, processDate: NOW - HOUR }),
  ], { myTeamId: ME });
  eq(bare.get('late') && bare.get('late').status, 'expired', 'no owners: a CANCEL copy written after the expiry is a lapse');
  ok(!bare.has('early'), 'no owners: one written before it says nothing (who wrote it is unknown)');
  eq(o.resolutions(null, { myTeamId: ME }).size, 0, 'nothing handed in: nothing resolved, no throw');
}

// ---------------------------------------------------------------- judge
const seen = [
  offer('p-dec', 3, [CHASE], [BIJAN]),                       // declined
  offer('p-lapse', 3, [NACUA], [LAMAR], { expiresAt: NOW - HOUR }),  // expired on its clock
  offer('p-veto', 4, [JACOBS], [HALL], { review: true, expiresAt: null, processAt: NOW + 12 * HOUR }),
  offer('p-quiet', 2, [LAMB], [HENRY]),                      // vanished, nothing known
  offer('p-acc', 4, [JACOBS], [BIJAN]),                      // went through (history)
  offer('p-swap', 3, [NACUA], [HENRY]),                      // went through (rosters)
  offer('p-done', 2, [LAMB], [LAMAR], { review: true, expiresAt: null, processAt: NOW - HOUR }),  // review over
  offer('p-mine', 3, [CHASE], [HALL]),                       // I withdrew it
  offer('p-still', 3, [CHASE], [LAMAR]),                     // still listed
];
const resolved = new Map([
  ['p-dec', { status: 'declined', at: NOW - 2 * HOUR }],
  ['p-acc', { status: 'accepted', at: NOW - HOUR }],
  ['p-mine', { status: 'withdrawn', at: NOW - HOUR }],
]);
const swapped = new Map([...UNMOVED, [NACUA, ME], [HENRY, 3]]);
{
  const listed = [offer('p-still', 3, [CHASE], [LAMAR]), offer('to-me', 2, [LAMB], [BIJAN], { fromMe: false })];
  const j = o.judge({ seen, offers: listed, resolved, holders: swapped, myTeamId: ME, now: NOW });
  const why = Object.fromEntries(j.ended.map((e) => [e.id, e.reason]));
  eq(why['p-dec'], 'declined', 'DECLINED: named by the history');
  eq(why['p-lapse'], 'expired', 'EXPIRED: gone, nothing in the history, the swap not made, its clock run out');
  eq(why['p-veto'], 'vetoed', 'VETOED: an accepted trade in review gone before its process time');
  eq(why['p-quiet'], 'gone', 'VANISHED, REASON UNKNOWN: "no longer pending"');
  ok(!('p-acc' in why), 'ACCEPTED (history): never listed');
  ok(!('p-swap' in why), 'ACCEPTED (the rosters show the swap): never listed');
  ok(!('p-done' in why), 'ACCEPTED (review time passed): never listed');
  ok(!('p-mine' in why), 'WITHDRAWN by me: not listed');
  ok(!('p-still' in why), 'still waiting: not listed');
  eq(j.ended.find((e) => e.id === 'p-dec').at, NOW - 2 * HOUR, 'a declined one is dated by the decline');
  eq(j.ended.find((e) => e.id === 'p-lapse').at, NOW - HOUR, 'an expired one by its expiry');
  eq(j.ended.find((e) => e.id === 'p-quiet').at, NOW, 'an unknown one by when it was noticed');
  ok(j.ended.every((e) => e.withTeamId && Array.isArray(e.get) && Array.isArray(e.send)), 'each keeps who and what');
  // The same deal turned into an accepted trade in review (a new id) is not "gone".
  const moved = o.judge({
    seen: [offer('p-x', 3, [CHASE], [BIJAN])],
    offers: [offer('acc-x', 3, [CHASE], [BIJAN], { review: true, fromMe: null, processAt: NOW + DAY })],
    holders: UNMOVED, myTeamId: ME, now: NOW,
  });
  eq([moved.ended.length, moved.missing.length], [0, 0], 'an offer that became an accepted trade in review is still waiting');
  // With nothing to tell by (no history, no rosters), it waits for next time.
  const blind = o.judge({ seen: [offer('p-y', 3, [CHASE], [BIJAN])], offers: [], myTeamId: ME, now: NOW });
  eq([blind.ended.length, blind.waiting.map((w) => w.id)], [0, ['p-y']], 'no rosters, no history: nothing is judged; it is kept to ask again');
}

// ---------------------------------------------------------------- received
{
  const rec = { v: 1, team: ME, seen: [], ended: [], handled: [] };
  const first = o.advance(rec, {
    offers: [offer('to-me', 3, [CHASE], [BIJAN], { fromMe: false }), offer('by-me', 2, [LAMB], [HENRY])],
    holders: UNMOVED, myTeamId: ME, now: NOW,
  });
  eq(first.seen.map((s) => s.id), ['by-me'], 'RECEIVED: an offer sent TO me is not remembered');
  const second = o.advance(first, { offers: [], holders: UNMOVED, myTeamId: ME, now: NOW + HOUR });
  eq(second.ended.map((e) => [e.id, e.reason]), [['by-me', 'gone']], 'so when both vanish, only mine is listed');
  eq(second.seen, [], 'and nothing is remembered any more');
}

// ---------------------------------------------------------------- storage + dismiss
{
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const L = '1241838', S = 2026;
  eq(o.readSent(L, S, ME, storage).seen, [], 'nothing stored: an empty record');
  let rec = o.readSent(L, S, ME, storage);
  rec = o.advance(rec, { offers: [offer('d-1', 3, [CHASE], [BIJAN])], holders: UNMOVED, myTeamId: ME, now: NOW });
  o.writeSent(L, S, rec, storage);
  rec = o.advance(o.readSent(L, S, ME, storage), {
    offers: [], resolved: new Map([['d-1', { status: 'declined', at: NOW }]]), holders: UNMOVED, myTeamId: ME, now: NOW + HOUR,
  });
  o.writeSent(L, S, rec, storage);
  eq(o.activeEnded(o.readSent(L, S, ME, storage).ended, []).map((e) => e.id), ['d-1'], 'the declined offer is kept until handled');
  ok(mem.has('ff.trades.sent.1241838-2026'), 'under the league in the key\'s name');
  eq(o.readSent(L, S, 7, storage).ended, [], 'another team\'s record is not mine');
  ok(o.markHandled(L, S, ME, 'd-1', storage), 'Dismiss is remembered');
  eq(o.activeEnded(o.readSent(L, S, ME, storage).ended, o.readSent(L, S, ME, storage).handled), [], 'DISMISSED: gone');
  // The computer reports it again (a synced copy made before the dismiss, or the
  // same history read once more): it stays gone.
  const again = o.advance(o.readSent(L, S, ME, storage), {
    offers: [], resolved: new Map([['d-1', { status: 'declined', at: NOW }]]), holders: UNMOVED, myTeamId: ME, now: NOW + 2 * HOUR,
  });
  eq(again.ended, [], 'DISMISSED STAYS GONE: a later read does not bring it back');
  const synced = [{ id: 'd-1', withTeamId: 3, get: [CHASE], send: [BIJAN], reason: 'declined', at: NOW }];
  eq(o.activeEnded(synced, o.readSent(L, S, ME, storage).handled), [], 'nor does the synced copy carrying it');
  // Garbage in storage never throws.
  mem.set('ff.trades.sent.1241838-2026', '{not json');
  eq(o.readSent(L, S, ME, storage).ended, [], 'unreadable storage: an empty record');
  eq(o.cleanEnded([{ id: 'x', withTeamId: 3, get: [CHASE], send: [], reason: 'won' }, null, 7]), [], 'cleanEnded drops anything that is not an ended offer');
  eq(o.cleanEnded(Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, withTeamId: 3, get: [CHASE], send: [BIJAN], reason: 'gone' }))).length, o.MAX_ENDED, 'at most MAX_ENDED ride along');
}

// ---------------------------------------------------------------- the line
{
  const teams = [
    { id: 1, name: 'Tim', players: [{ playerId: BIJAN, name: 'Bijan Robinson' }, { playerId: HENRY, name: 'Derrick Henry' }] },
    { id: 2, name: 'Sam', players: [{ playerId: LAMB, name: 'CeeDee Lamb' }] },
    { id: 3, name: 'Bob', players: [{ playerId: CHASE, name: "Ja'Marr Chase" }] },
    { id: 4, name: 'Ann', players: [] },
  ];
  const ended = [
    { id: 'p-dec', withTeamId: 3, get: [CHASE], send: [BIJAN], reason: 'declined', at: NOW - 2 * HOUR },
    { id: 'p-lapse', withTeamId: 2, get: [LAMB], send: [HENRY], reason: 'expired', at: NOW - HOUR },
    { id: 'p-veto', withTeamId: 4, get: [JACOBS], send: [HALL], reason: 'vetoed', at: NOW - HOUR, getNames: ['Josh Jacobs'], sendNames: ['Breece Hall'] },
    { id: 'p-quiet', withTeamId: 2, get: [LAMB], send: [BIJAN], reason: 'gone', at: NOW },
  ];
  const lines = notify.endedNotes({ ended, teams, teamId: ME, now: NOW });
  eq(lines.map((l) => l.title), [
    'Bob declined your offer', 'Your offer to Sam expired', 'Your trade with Ann was vetoed', 'Your offer to Sam is no longer pending',
  ], 'the title says who and why');
  ok(lines[0].detail.startsWith("Get Ja'Marr Chase for Bijan Robinson · ended "), 'the detail: what was offered for what, and when', lines[0].detail);
  ok(lines[2].detail.startsWith('Get Josh Jacobs for Breece Hall'), 'names nobody rosters any more come from what was kept', lines[2].detail);
  ok(/ · noticed /.test(lines[3].detail), 'an unknown reason says when it was noticed', lines[3].detail);
  ok(lines.every((l) => l.level === 'pending' && l.kind === 'ended'), 'a pending-level line (counted by the bell)');
  ok(lines.every((l) => l.action.label === 'Follow up' && l.dismiss), 'two choices: Follow up and Dismiss');
  eq(lines[0].action.href, `trade.html?with=3&get=${CHASE}&send=${BIJAN}`, 'Follow up opens the same deal in the Trade page\'s builder');
  eq(lines[0].action.followUp, { id: 'p-dec', a: 1, b: 3, sendA: [String(BIJAN)], sendB: [String(CHASE)] },
    'and carries it as the Trade page saves a custom trade (a = you, b = him, the men each side sends)');
  // In the whole list: under Pending, first there, and counted.
  const team = teams[0];
  const all = notify.buildNotes({ week: 7, teamId: ME, team, teams, slots: [], ended, offers: [offer('w', 3, [CHASE], [HENRY])], now: NOW });
  const pend = all.filter((n) => n.level === 'pending');
  eq(pend.map((n) => n.kind), ['ended', 'ended', 'ended', 'ended', 'offer'], 'in the list: Pending, the ended offers first');
  eq(notify.countNotes(all).pending, 5, 'the bell counts them');
  eq(notify.buildNotes({ week: 7, teamId: ME, team, teams, slots: [], now: NOW }).filter((n) => n.kind === 'ended').length, 0, 'none handed in: no line');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
