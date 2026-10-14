// A PLAYER'S PREVIEW NEVER SAYS "off" (2026-10-14).
//
// Tim: "right now the player preview doesn't show any previous weeks if that
// player wasn't on your team, instead jsut shows "off". Make is so that never
// happens and it always has all the weeks filled that can be filled."
//
// What is asserted, by behaviour:
//   1. the card (js/player-card.js) fills every `off` week of a run as it
//      opens, from the loose source: the unread dot first, then — once the read
//      lands — his real projection and score, and the word "off" never;
//   2. the shared builder (`playerCardFromWeeks`, Home/Stats/Decisions) and the
//      Trade page's run shape (tokens straight into `weekRun`) both go through
//      it; a man on nobody's roster in ANY week gets a chart, not "Not read yet";
//   3. the Analysis / Players card (js/who-to-start.js `seasonRunData`) reads a
//      week he was on ANOTHER squad off that squad, with no request at all;
//   4. js/season.js `looseLine` / `fetchLooseWeeks` read ESPN's own payload
//      (`kona_player_info`, captured 2026-10-05 on league 1241838): one request
//      a week, the bye rule applied, a score withheld until the week is final,
//      a final week kept for the next page load, a man ESPN does not know = "—";
//   5. every page that opens the card wires the source in.
//
// Run:  node test-loose-weeks.mjs

import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + String(extra).slice(0, 500) : ''}`); }
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---------------------------------------------------------------- the harness
const { window, document } = parseHTML('<!doctype html><html><body><main id="host"></main></body></html>');
const matchMedia = (q) => ({ media: String(q), matches: false, addEventListener() {}, removeEventListener() {} });
window.matchMedia = matchMedia;
window.location = { origin: 'http://localhost', href: 'http://localhost/trade.html', search: '', assign() {} };
const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
let network = null; // set per section
Object.assign(globalThis, {
  window, document, matchMedia, location: window.location, localStorage: storage,
  HTMLElement: window.HTMLElement, Event: window.Event, Node: window.Node, CustomEvent: window.CustomEvent,
  fetch: async (u, o) => {
    if (network) return network(u, o);
    throw new Error(`unexpected network call: ${u}`);
  },
});
window.localStorage = storage;
if (!window.postMessage) window.postMessage = () => {};

const mod = (f) => import(pathToFileURL(path.join(REPO, f)).href);
const card = await mod('js/player-card.js');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

// What the open card DRAWS: the Proj and Act row texts.
const host = document.getElementById('host');
function opened(key) {
  host.innerHTML = `<span id="cell" data-tip="${key}">x</span>`;
  ok(card.showCard(key, document.getElementById('cell')), 'the card opens', key);
  return drawn();
}
function drawn() {
  const el = document.getElementById('tipCard');
  const row = (sel) => [...el.querySelectorAll(`.tc-run ${sel} td`)].map((td) => td.textContent.trim());
  return { proj: row('tbody'), act: row('tfoot'), html: el.innerHTML, hidden: el.hidden };
}
const saysOff = (d) => d.proj.includes('off') || d.act.includes('off') || /k-off/.test(d.html);

// ESPN's own answer for three men in week 2 (captured 2026-10-05, league 1241838).
const KONA = JSON.parse(readFileSync(path.join(REPO, 'tests/fixtures/players-week-1241838-2026-wk2.json'), 'utf8'));
const LOCK = 3924327; // Drew Lock: on nobody's roster in week 2 — 21.4 against 15.7

// ============================================ 1. the card fills its `off` weeks
ok(typeof card.setLooseSource === 'function', 'player-card.js takes a source for the weeks on no roster');
{
  const asked = [];
  let ready = false;
  card.setLooseSource?.({
    lookup: (id, w) => {
      if (Number(id) !== LOCK) return null;
      if (!ready) return undefined;
      return w === 2 ? { projected: 15.70639184, actual: 21.4 } : w === 1 ? { projected: 14.2, actual: 12.78 } : null;
    },
    request: async (id, weeks) => { asked.push([id, weeks]); ready = true; },
  });

  // THE TRADE PAGE'S SHAPE: tokens straight into weekRun (`tokenAt` → 'off').
  const run = card.weekRun({
    heading: 'ESPN’s projection for weeks 1–4', weeks: [1, 2, 3, 4],
    projections: ['off', 'off', 18.2, 17.0], actuals: ['off', 'off', 9.1, null],
    currentWeek: 4, splitAfter: 3, byeWeek: 14,
  });
  eq(run.cols.map((c) => c.proj.text), ['off', 'off', '18.2', '17.0'], 'the run itself still says where he was on no roster (the tables use it)');
  const key = card.registerRun({ ident: 'Drew Lock · QB', run, playerId: LOCK }, 'tr');
  const first = opened(key);
  ok(!saysOff(first), 'OPENED: the card never draws "off"', first.proj.join(' | '));
  eq(first.proj, ['·', '·', '18.2', '17.0'], 'while his weeks on no roster are read: the unread dot');
  await settle();
  eq(asked, [[LOCK, [1, 2]]], 'one ask, for exactly the weeks he was on no roster');
  const after = drawn();
  ok(!after.hidden, 'the open card stays open across the redraw');
  eq(after.proj, ['14.2', '15.7', '18.2', '17.0'], 'REDRAWN: his real projection in every week');
  eq(after.act, ['12.8', '21.4', '9.1', ''], 'and his real score in every week played (21.4 — ESPN’s own, week 2)');
  ok(!saysOff(after), 'and still no "off" anywhere');

  // Opened again later: filled at once, no second ask.
  card.hideTip();
  const again = opened(key);
  eq(again.proj, ['14.2', '15.7', '18.2', '17.0'], 'opened again: filled straight away');
  await settle();
  eq(asked.length, 1, 'and nothing asked twice');

  // A week with genuinely nothing: "—", never "off" and never a dot for ever.
  const run2 = card.weekRun({ weeks: [1, 2, 3], projections: ['off', 'off', 10], actuals: ['off', 'off', 4], currentWeek: 3 });
  const nobody = card.registerRun({ ident: 'Nobody', run: run2, playerId: 999 }, 'tr');
  const n = opened(nobody);
  eq(n.proj, ['—', '—', '10.0'], 'a man ESPN has no line for: "—"');
  ok(!saysOff(n), 'not "off"');

  // A card with no id cannot be looked up: "—", not "off".
  const noid = card.registerRun({ ident: 'No id', run: card.weekRun({ weeks: [1, 2], projections: ['off', 7], actuals: ['off', 3] }) }, 'tr');
  const ni = opened(noid);
  eq(ni.proj, ['—', '7.0'], 'no playerId: "—"');

  // A redraw that lands after the card was closed does not reopen it.
  ready = false;
  asked.length = 0;
  const late = card.registerRun({ ident: 'Late', run: card.weekRun({ weeks: [1, 2], projections: ['off', 5], actuals: ['off', 5] }), playerId: LOCK }, 'tr');
  opened(late);
  card.hideTip();
  await settle();
  ok(drawn().hidden, 'a read landing after the card closed leaves it closed');
}

// ============================== 2. the shared builder: Home, Stats, Decisions
{
  card.setLooseSource?.({
    lookup: (id, w) => (Number(id) === LOCK ? { projected: w === 2 ? 15.70639184 : 10, actual: w === 2 ? 21.4 : 6 } : null),
    request: async () => {},
  });
  const man = (o) => ({ playerId: LOCK, name: 'Drew Lock', position: 'QB', proTeam: 'NYG', proTeamId: 19, ...o });
  const WEEKS = new Map([
    [1, [{ id: 1, players: [] }, { id: 2, players: [] }]],                 // nobody held him
    [2, [{ id: 1, players: [] }, { id: 2, players: [] }]],                 // nobody held him
    [3, [{ id: 1, players: [man({ projected: 12.1, actual: 0.5 })] }, { id: 2, players: [] }]],
  ]);
  const c = card.playerCardFromWeeks(WEEKS, man(), { weeks: [1, 2, 3], currentWeek: 3 });
  const d = opened(card.registerRun(c, 'home'));
  eq(d.proj, ['10.0', '15.7', '12.1'], 'playerCardFromWeeks: a week on no roster is filled with his own line');
  eq(d.act, ['6.0', '21.4', '0.5'], 'and his score');
  ok(!saysOff(d), 'never "off"');

  // A man on NO roster in any week read (a free agent) gets a chart.
  const fa = card.playerCardFromWeeks(new Map([[1, [{ players: [] }]], [2, [{ players: [] }]]]), man(), { weeks: [1, 2] });
  const f = opened(card.registerRun(fa, 'home'));
  eq(f.proj, ['10.0', '15.7'], 'a free agent: every week filled');
  ok(!saysOff(f), 'never "off"');
}

// ===================== 3. Analysis / Players: another squad's week, no request
{
  card.setLooseSource?.({ lookup: () => { throw new Error('asked the loose source for a week a squad held him'); }, request: async () => {} });
  const wts = await mod('js/who-to-start.js');
  const P = { playerId: 77, name: 'Puka Nacua', position: 'WR', proTeam: 'LAR', proTeamId: 14 };
  const seasonWeeks = new Map([
    [1, [{ id: 1, players: [{ ...P, projected: 14.2, actual: 18.4 }] }, { id: 2, players: [] }]],
    [2, [{ id: 1, players: [] }, { id: 2, players: [{ ...P, projected: 13.1, actual: 9.9 }] }]],   // traded away
    [3, [{ id: 1, players: [{ ...P, projected: 15.0, actual: 20.0 }] }, { id: 2, players: [] }]],   // and back
  ]);
  wts.configure({
    state: { seasonWeeks, seasonFailed: new Set(), weeks: [1, 2, 3], poWeeks: [], playedWeeks: [1, 2, 3], week: 3, isDemo: false, byes: {} },
    valueOn: () => false, asValue: () => null, historyMode: () => 'actual', sourceKey: () => 'k', glanceFor: () => null,
  });
  const idx = wts.seasonIndex(1);
  eq(wts.seasonField(idx, 2, 77, 'projected'), 'off', 'the squad’s own table still knows he was not on it in week 2');
  const run = wts.seasonRunData(idx, P);
  eq(run.cols.map((c) => c.proj.text), ['14.2', '13.1', '15.0'], 'his CARD reads week 2 off the squad that held him');
  eq(run.cols.map((c) => c.act.text), ['18.4', '9.9', '20.0'], 'score too');
  const d = opened(card.registerRun({ ident: 'Puka', run, playerId: 77 }, 'w'));
  ok(!saysOff(d), 'and the card draws no "off"', d.proj.join(' | '));
}

// ========================== 4. the read itself: js/season.js on ESPN's payload
{
  const espn = await mod('js/espn.js');
  const season = await mod('js/season.js');
  ok(typeof season.looseLine === 'function' && typeof season.fetchLooseWeeks === 'function', 'season.js has the read');
  espn.configure({ leagueId: '1241838', season: 2026 });

  const seen = [];
  const answer = (body) => ({ ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } });
  network = async (url, opts = {}) => {
    const u = new URL(String(url));
    const views = u.searchParams.getAll('view');
    if (views.includes('kona_player_info')) {
      const f = JSON.parse(opts.headers['x-fantasy-filter']);
      const ids = f.players.filterIds.value;
      seen.push({ week: Number(u.searchParams.get('scoringPeriodId')), ids });
      return answer({ players: KONA.players.filter((e) => ids.includes(e.player.id)) });
    }
    if (views.includes('mMatchupScore')) {
      // Weeks 1–2 decided, week 3 not: what makes week 2 FINAL.
      const g = (w, done) => ({
        matchupPeriodId: w, playoffTierType: 'NONE', winner: done ? 'HOME' : 'UNDECIDED',
        home: { teamId: 1, totalPoints: done ? 100 : 0 }, away: { teamId: 2, totalPoints: done ? 90 : 0 },
      });
      return answer({ schedule: [g(1, true), g(2, true), g(3, false)], teams: [{ id: 1 }, { id: 2 }], settings: { name: 'T' } });
    }
    // The NFL schedule (byes) and anything else: nothing, which the read survives.
    return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
  };

  eq(season.looseLine(LOCK, 2), undefined, 'not asked yet: undefined (the card draws the dot and asks)');
  await season.fetchLooseWeeks([LOCK, 4678008, 1], [2]);
  eq(seen.length, 1, 'ONE request for the week, every man in it');
  eq(seen[0], { week: 2, ids: [1, LOCK, 4678008] }, 'kona_player_info, scoringPeriodId 2, by id');
  const before = season.looseLine(LOCK, 2);
  eq(before && Math.round(before.projected * 100) / 100, 15.71, 'his projection, ESPN’s own');
  eq(before && before.actual, null, 'a week not known to be final gives out no score (a running score is not a result)');
  eq(season.looseLine(1, 2), null, 'a man ESPN does not know: null — drawn "—"');

  try { await season.fetchSchedule({ settle: false }); } catch (e) { ok(false, 'schedule read', e.message); }
  const final = season.looseLine(LOCK, 2);
  eq(final && final.actual, 21.4, 'once the schedule says week 2 is decided: his score, 21.4');
  eq(season.looseLine(4678008, 2)?.actual, 1.6, 'Jonathon Brooks, the same: 1.6');

  seen.length = 0;
  await season.fetchLooseWeeks([LOCK], [2]);
  eq(seen.length, 0, 'asked again: nothing new is asked');

  // A final week is kept for the next page load.
  await season.fetchLooseWeeks([3924327, 4685720], [2]);
  const keptKey = [...mem.keys()].find((k) => k.startsWith('ff.loose.'));
  ok(!!keptKey, 'a decided week’s lines are kept in this browser', [...mem.keys()].join(','));
  const kept = keptKey ? JSON.parse(mem.get(keptKey)) : {};
  eq(kept['2'] && kept['2']['4685720'] && kept['2']['4685720'].actual, 24.08, 'Bryce Young’s week 2 kept: 24.08');

  // Week 3 is not decided: read, used for its projection, never kept.
  await season.fetchLooseWeeks([LOCK], [3]);
  ok(!(JSON.parse(mem.get(keptKey))['3']), 'an undecided week is not kept');
}

// ============================================ 5. every page that opens a card
for (const f of ['js/trade-page.js', 'js/analysis-page.js', 'js/who-to-start.js', 'js/home-page.js', 'js/stats-page.js', 'js/decisions-page.js']) {
  ok(/import '\.\/loose-weeks\.js';/.test(readFileSync(path.join(REPO, f), 'utf8')), `${f} wires the loose source in`);
}
{
  const src = readFileSync(path.join(REPO, 'js/loose-weeks.js'), 'utf8');
  ok(/import \* as card from '\.\/player-card\.js'/.test(src) && /import \* as season from '\.\/season\.js'/.test(src),
    'loose-weeks.js imports by namespace (a stale cached module cannot take the page down)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
