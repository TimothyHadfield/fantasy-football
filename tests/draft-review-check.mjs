// The Draft page's "Our draft" view, booted from the real draft.html with the
// real js/draft-page.js (Tim, 2026-10-08: "show what our draft looked like and
// allow the user to select a specific user and see which big misses or steals
// they had").
//
//   node draft-review-check.mjs
//
// Four boots, each a child process (a page module self-boots once a process):
//
//   demo     nothing connected: the sample draft, and not one request
//   live     the real league the fixtures were captured from (1241838), through
//            draft-stub-season.mjs / draft-stub-espn.mjs — every number on the
//            board against js/draft-review.js run on the same fixtures here,
//            the team picker, the previews, and what was asked of ESPN, first
//            cold and then again warm
//   cloud    the phone's synced copy: nothing asked of ESPN at all
//   snake    the same page on a hand-made snake draft, where Paid is hidden
//
// The arithmetic itself is test-draft-review.mjs's; this checks the page draws
// what that module says and reads no more than it should.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REPO, HERE, moduleUrl } from './repo.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const CONN = { leagueId: '1241838', season: 2026, teamId: 8 };

// ------------------------------------------------------------------ children

/** season.js and espn.js become the two stubs, for every importer outside tests/. */
function useStubs() {
  const hook = `
    const TESTS = ${JSON.stringify(new URL('./', import.meta.url).href)};
    const SEASON = ${JSON.stringify(new URL('./draft-stub-season.mjs', import.meta.url).href)};
    const ESPN = ${JSON.stringify(new URL('./draft-stub-espn.mjs', import.meta.url).href)};
    export async function resolve(spec, ctx, next) {
      const fromTests = ctx.parentURL && ctx.parentURL.startsWith(TESTS);
      if (spec.startsWith('.') && !fromTests) {
        if (/\\/season\\.js$/.test(spec)) return next(SEASON, ctx);
        if (/\\/espn\\.js$/.test(spec)) return next(ESPN, ctx);
      }
      return next(spec, ctx);
    }`;
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
}

async function boot({ store = {}, stubs = true } = {}) {
  const errors = [];
  console.error = (...a) => { errors.push(a.join(' ')); };
  process.on('unhandledRejection', (r) => errors.push(`unhandled: ${String((r && r.stack) || r)}`));
  if (stubs) useStubs();
  const dom = bootDom({ html: readFileSync(path.join(REPO, 'draft.html'), 'utf8'), store });
  const { document, window } = dom;
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  await import(moduleUrl('js/draft-page.js'));
  await import(moduleUrl('js/connection.js'));

  const $ = (id) => document.getElementById(id);
  const fire = (el, type, init = {}) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, init);
    el.dispatchEvent(ev);
  };
  const settle = async (badge) => {
    await sleep(20);
    const ok = await waitFor(() => $('modeBadge').className.includes(badge) &&
      !document.querySelector('.searching') && (document.querySelector('#draftBoard tbody tr') || $('drMain').hidden), 20000);
    await sleep(20);
    return Boolean(ok);
  };

  /** Everything on the page a fact below is read from. */
  const read = () => {
    const board = $('draftBoard');
    const cells = [...board.querySelectorAll('tbody td.dr-cell')].filter((td) => td.querySelector('.dr-name'));
    const pop = $('drPop');
    return {
      badge: text($('modeBadge')),
      sub: text($('pageSub')),
      status: text($('sourceStatus')),
      mainHidden: $('drMain').hidden,
      reviewHidden: $('reviewView').classList.contains('hidden'),
      roomHidden: $('roomView').classList.contains('hidden'),
      source: [...$('sourceToggle').querySelectorAll('button')].filter((b) => b.classList.contains('on')).map((b) => b.dataset.src),
      teams: [...$('teamSelect').querySelectorAll('option')].map((o) => [o.getAttribute('value'), text(o)]),
      team: $('teamSelect').value,
      heads: [...board.querySelectorAll('thead th')].map(text),
      boardRows: board.querySelectorAll('tbody tr').length,
      mineHead: [...board.querySelectorAll('thead th.dr-mine')].map((th) => th.dataset.team),
      mineCells: board.querySelectorAll('tbody td.dr-mine').length,
      mineTeams: [...new Set([...board.querySelectorAll('tbody td.dr-mine')].map((td) => td.dataset.team))],
      cells: cells.map((td) => ({
        team: td.dataset.team,
        pid: td.querySelector('.dr-why').dataset.pid,
        went: text(td.querySelector('.dr-went')),
        d: text(td.querySelector('.dr-d')).replace(/[▲▼\s]/g, ''),
        name: text(td.querySelector('.dr-name')),
        heat: (td.className.match(/heat-(?:up|dn)-\d|heat-0/) || [''])[0],
        card: td.querySelector('.dr-name').hasAttribute('data-tip'),
      })),
      tableHeads: [...$('teamTable').querySelectorAll('thead th')].filter((th) => !th.hasAttribute('hidden')).map(text),
      sorted: [...$('teamTable').querySelectorAll('thead th.sorted')].map(text),
      table: [...$('teamTable').querySelectorAll('tbody tr')].map((tr) => ({
        pid: tr.dataset.pid,
        cells: [...tr.children].filter((c) => !c.hasAttribute('hidden')).map((c) => text(c).replace(/\s*[▲▼]/g, '')),
        why: Boolean(tr.querySelector('.dr-why')),
        card: Boolean(tr.querySelector('.dr-name[data-tip]')),
      })),
      tiles: [...$('teamStats').querySelectorAll('.dr-tile')].map((t) => ({
        key: t.dataset.tile, k: text(t.querySelector('.k')),
        v: text(t.querySelector('.v')).replace(/\s*[▲▼]/g, ''), who: text(t.querySelector('.dr-who')),
        pid: t.querySelector('.dr-why') ? t.querySelector('.dr-why').dataset.pid : null,
      })),
      note: text($('drNote')),
      explainHidden: $('drExplain').hidden,
      pop: pop && !pop.hidden ? { cls: pop.className, rows: [...pop.querySelectorAll('tr')].map((tr) => [...tr.children].map(text)), head: text(pop.querySelector('.op-h')) } : null,
      titles: document.querySelectorAll('#reviewView td[title], #reviewView .dr-name[title]').length,
    };
  };
  return { ...dom, $, fire, settle, read, errors, calls: () => ({ ...(globalThis.__dr || {}) }) };
}

const CHILDREN = {
  // NOTHING CONNECTED. The stubs are not even installed: a request would throw.
  async demo() {
    const p = await boot({ stubs: false });
    const ok = await p.settle('demo');
    const first = p.read();
    // Another team, from the picker and then from the board's own heading.
    p.$('teamSelect').value = first.teams[3][0];
    p.fire(p.$('teamSelect'), 'change');
    const picked = p.read();
    p.fire(p.document.querySelector(`#draftBoard thead button[data-team="${first.teams[6][0]}"]`), 'click');
    const byBoard = p.read();
    // The view switch, and back.
    p.fire(p.$('viewToggle').querySelector('button[data-view="room"]'), 'click');
    const room = p.read();
    p.fire(p.$('viewToggle').querySelector('button[data-view="review"]'), 'click');
    const back = p.read();
    return { ok, first, picked, byBoard, room, back, fetches: p.fetchCalls, errors: p.errors, prefs: JSON.parse(p.map.get('ff.prefs') || '{}') };
  },

  async live() {
    const p = await boot({ store: { 'ff.prefs': { 'draft.source': 'live' }, 'ff.connection': CONN } });
    const ok = await p.settle('live');
    const cold = p.calls();
    const first = p.read();
    const kept = JSON.parse(p.map.get('ff-draft-review-v1') || '{}');

    // A PREVIEW: the first number in the team's table (a mouse: `matchMedia` says hover).
    const why = p.document.querySelector('#teamTable tbody .dr-why');
    p.fire(why, 'click');
    const pop = p.read().pop;
    p.fire(p.document.body, 'click');
    const shut = p.read().pop;
    // The same man's number on the board opens the same thing.
    p.fire(p.document.querySelector(`#draftBoard .dr-why[data-pid="${why.dataset.pid}"]`), 'click');
    const boardPop = p.read().pop;
    p.fire(p.document.body, 'keydown', { key: 'Escape' });
    const afterEsc = p.read().pop;

    // ANOTHER TEAM.
    p.$('teamSelect').value = '7';
    p.fire(p.$('teamSelect'), 'change');
    const seven = p.read();

    // AGAIN, WARM: to the sample and back. Nothing kept is asked for twice.
    p.fire(p.$('sourceToggle').querySelector('button[data-src="demo"]'), 'click');
    const okDemo = await p.settle('demo');
    const sample = p.read();
    p.fire(p.$('sourceToggle').querySelector('button[data-src="live"]'), 'click');
    const okWarm = await p.settle('live');
    const warm = p.calls();
    const again = p.read();
    return {
      ok, okDemo, okWarm, cold, warm, first, pop, shut, boardPop, afterEsc, seven, sample, again,
      keptLeague: kept.league, keptPicks: kept.kept && kept.kept.draft ? kept.kept.draft.picks.length : 0,
      keptWeeks: kept.kept && kept.kept.weeks ? Object.keys(kept.kept.weeks).length : 0,
      fetches: p.fetchCalls.filter((u) => /espn/i.test(u)), errors: p.errors,
      prefs: JSON.parse(p.map.get('ff.prefs') || '{}'),
    };
  },

  // THE PHONE'S SYNCED COPY (DR_CLOUD=1): there is no draft in it.
  async cloud() {
    const p = await boot({ store: { 'ff.prefs': { 'draft.source': 'live' }, 'ff.connection': CONN } });
    const ok = await p.settle('demo');
    return { ok, calls: p.calls(), page: p.read(), fetches: p.fetchCalls.filter((u) => /espn/i.test(u)), errors: p.errors };
  },

  // A SNAKE (DR_SNAKE=1 makes the espn stub's draft one: same men, same order).
  async snake() {
    const p = await boot({ store: { 'ff.prefs': { 'draft.source': 'live' }, 'ff.connection': CONN } });
    const ok = await p.settle('live');
    const page = p.read();
    p.fire(p.document.querySelector('#teamTable tbody .dr-why'), 'click');
    return { ok, page, pop: p.read().pop, errors: p.errors };
  },
};

if (process.argv[2]) {
  try {
    emit(await CHILDREN[process.argv[2]](), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

// -------------------------------------------------------------------- parent

function run(child, env = {}) {
  const res = spawnSync(process.execPath, [self, child], {
    encoding: 'utf8', cwd: HERE, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) return { boot: `no result. stdout=${(res.stdout || '').slice(0, 400)} stderr=${(res.stderr || '').slice(0, 1500)}` };
  return JSON.parse(line.slice(2));
}

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const signed = (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}`;

// WHAT THE PAGE SHOULD SAY, worked out here from the same fixtures.
const R = await import(moduleUrl('js/draft-review.js'));
const RAW = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-1241838-2026.json'), 'utf8'));
const FX = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-players-1241838-2026.json'), 'utf8'));
function expected(raw) {
  const draft = R.parseDraft(raw);
  const finished = new Set(FX.finished);
  const players = new Map();
  for (const [id, p] of Object.entries(FX.players)) {
    const byWeek = {};
    for (const w of FX.weeks) {
      const [proj, act] = p.weeks[w] || [null, null];
      byWeek[w] = finished.has(w) ? { counts: act ?? 0, done: true } : { counts: proj, done: false };
    }
    players.set(Number(id), { name: p.name, position: p.position, ...R.seasonOf(byWeek, FX.weeks) });
  }
  const rv = R.reviewDraft({ draft, players, slots: [0, 2, 2, 4, 4, 4, 6, 16, 17, 23], teams: 10 });
  return { draft, rv, byId: new Map(rv.rows.map((r) => [String(r.playerId), r])) };
}
const nameOfTeam = (id) => FX.teams.find((t) => t.id === id).name;
const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

// --------------------------------------------------- the card's page half
// player-card.js draws the card; each page that shows one carries its rules.
// Without them the card is an unstyled block at the foot of the document —
// measured in WebKit at 393px on 2026-10-08: its top was at y=1458 of a 659px
// window, so a tap on a name appeared to do nothing.
{
  const html = readFileSync(path.join(REPO, 'draft.html'), 'utf8');
  const rule = (sel) => (html.match(new RegExp(`\\n\\s*${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`)) || [])[1] || '';
  ok(/position: fixed/.test(rule('.tipcard')) && /pointer-events: none/.test(rule('.tipcard')), 'the page pins the player card to the window');
  ok(/bottom: 0/.test(rule('.tipcard.sheet')) && /pointer-events: auto/.test(rule('.tipcard.sheet')), 'and, on a touch screen, to its foot as a sheet');
}

// ---------------------------------------------------------------------- demo
{
  const r = run('demo');
  ok(!r.boot, 'demo: boots', r.boot);
  if (!r.boot) {
    const f = r.first;
    ok(r.ok, 'demo: settles on the sample');
    eq(r.fetches, [], 'demo: not one request');
    eq(r.errors, [], 'demo: no errors');
    eq([f.badge, f.source, f.mainHidden, f.explainHidden], ['Demo', ['demo'], false, false], 'demo: the badge, the switch, and the draft on the page');
    eq([f.reviewHidden, f.roomHidden], [false, true], 'demo: "Our draft" is the view the page opens on');
    ok(/^Demo League · Snake · 160 picks · 13 weeks played$/.test(f.sub), 'demo: the line under the heading', f.sub);
    eq(f.status, '', 'demo: nothing in the status line');
    eq([f.teams.length, f.heads.length, f.boardRows, f.cells.length], [10, 11, 16, 160], 'demo: ten teams, sixteen rounds, 160 picks on the board');
    eq(f.heads[0], 'Rd', 'demo: the round column');
    eq(f.heads.slice(1), f.teams.map((t) => t[1]), 'demo: a column a team, in the picker’s order');
    eq(f.cells.slice(0, 10).map((c) => c.went.split(' ')[0]), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 'demo: round one runs 1-10');
    eq(f.cells.slice(10, 20).map((c) => c.went.split(' ')[0]), ['20', '19', '18', '17', '16', '15', '14', '13', '12', '11'], 'demo: round two snakes back');
    ok(f.cells.every((c) => c.card && c.name && /^[+−]?\d+$/.test(c.d)), 'demo: every pick has a name with a card and a difference');
    ok(new Set(f.cells.map((c) => c.heat)).size >= 5 && f.cells.every((c) => c.heat), 'demo: the board is on the heat scale, in several steps');
    eq(f.cells.reduce((a, c) => a + Number(c.d.replace('−', '-')), 0), 0, 'demo: a snake’s differences cancel');
    eq([f.team, f.mineHead, f.mineTeams, f.mineCells], [f.teams[0][0], [f.teams[0][0]], [f.teams[0][0]], 16], 'demo: the first team is picked and its column marked');
    eq(f.tableHeads, ['Player', 'Pick', 'Now', '+/−'], 'demo: a snake has no Paid column');
    eq([f.table.length, f.sorted], [16, ['+/−']], 'demo: the team’s sixteen picks, sorted by the difference');
    const diffs = f.table.map((t) => Number(t.cells[3].replace('−', '-')));
    ok(diffs.every((d, i) => i === 0 || diffs[i - 1] >= d), 'demo: biggest steal first, biggest miss last', diffs.join(','));
    ok(f.table.every((t) => t.why && t.card), 'demo: every row has a preview and a card');
    eq(f.tiles.map((t) => [t.k, t.v]), [['Best steal', signed(diffs[0])], ['Biggest miss', signed(diffs[diffs.length - 1])]], 'demo: the two tiles are the table’s ends');
    eq(f.tiles.map((t) => t.pid), [f.table[0].pid, f.table[f.table.length - 1].pid], 'demo: and name those two men');
    ok(f.table.every((t) => f.cells.find((c) => c.pid === t.pid && c.team === f.team && c.d === t.cells[3])), 'demo: the table and the board agree on every pick');
    eq(f.titles, 0, 'demo: no `title` on a cell (a phone would open it over the preview)');
    ok(/drafted again today/.test(f.note) && !/Rank/.test(f.note), 'demo: how it works is said under the fold, without the auction’s line');

    const p = r.picked;
    eq([p.team, p.mineHead, p.mineTeams, p.mineCells], [f.teams[3][0], [f.teams[3][0]], [f.teams[3][0]], 16], 'demo: picking a team moves the mark to its column');
    ok(p.table.length === 16 && p.table[0].pid !== f.table[0].pid, 'demo: and lists its picks');
    eq(p.cells, f.cells, 'demo: the board itself does not change');
    eq(r.byBoard.team, f.teams[6][0], 'demo: a team’s heading on the board picks it too');
    eq(r.byBoard.mineHead, [f.teams[6][0]], 'demo: and marks it');
    eq([r.room.reviewHidden, r.room.roomHidden], [true, false], 'demo: the switch shows the draft room');
    eq([r.back.reviewHidden, r.back.roomHidden], [false, true], 'demo: and back');
    eq(r.prefs['draft.team.demo'], Number(f.teams[6][0]), 'demo: the team is remembered');
  }
}

// ---------------------------------------------------------------------- live
{
  const r = run('live');
  ok(!r.boot, 'live: boots', r.boot);
  if (!r.boot) {
    const want = expected(RAW);
    const f = r.first;
    ok(r.ok, 'live: settles on the league');
    eq(r.errors, [], 'live: no errors');
    eq(r.fetches, [], 'live: nothing went to ESPN around the stubs');
    eq([f.badge, f.source, f.status], ['Live', ['live'], ''], 'live: the badge and the switch');
    eq(f.sub, 'The Keeper League · Auction · 170 picks · 4 weeks played', 'live: the line under the heading');

    // WHAT IT COST. Cold: the draft once, and one read a week for the 19 men nobody holds.
    eq([r.cold.draft, r.cold.players, r.cold.playerIds], [1, 17, 17 * 19], 'live, cold: the draft once, and seventeen reads of 19 dropped men');
    eq([r.keptLeague, r.keptPicks, r.keptWeeks], ['1241838-2026', 170, 17], 'live: the draft and those weeks are kept in this browser');
    eq([r.warm.draft, r.warm.players], [1, 17], 'live, warm: neither is asked for again');
    eq(r.again.cells, f.cells, 'live, warm: and the board is the same board');

    // THE BOARD against js/draft-review.js on the same fixtures: all 170.
    eq([f.heads.length, f.boardRows, f.cells.length], [11, 17, 170], 'live: ten teams, seventeen rows, 170 picks');
    eq(f.heads.slice(1), want.draft.order.map(nameOfTeam), 'live: the columns are ESPN’s draft order');
    const wrong = f.cells.filter((c) => {
      const w = want.byId.get(c.pid);
      return !w || c.d !== signed(w.diff) || c.went !== `$${w.bid} ${w.position === 'DST' ? 'D/ST' : w.position}` || String(w.teamId) !== c.team;
    });
    eq(wrong.slice(0, 3), [], 'live: every cell’s price, position, team and difference');
    const board = R.boardOf(want.draft);
    eq(f.cells.map((c) => c.pid), board.rows.flat().map((p) => String(p.playerId)), 'live: each team’s column runs dearest first');
    const hub = f.cells.find((c) => c.name === 'C. Hubbard');
    const ach = f.cells.find((c) => c.name === 'D. Achane');
    eq([hub && hub.went, hub && hub.d, hub && hub.heat], ['$1 RB', '+125', 'heat-up-4'], 'live: Hubbard, $1, +125, the top of the scale');
    eq([ach && ach.went, ach && ach.d, ach && ach.heat], ['$44 RB', '−151', 'heat-dn-4'], 'live: Achane, $44, −151, the bottom of it');

    // THE TEAM: the saved "my team" (8) is the one picked.
    const t8 = R.teamReview(want.rv.rows, 8);
    eq([f.team, f.mineHead, f.mineCells], ['8', ['8'], 17], 'live: my team is picked and marked');
    eq(f.tableHeads, ['Player', 'Paid', 'Rank', 'Now', '+/−'], 'live: an auction’s columns');
    eq(f.table.map((t) => t.pid).sort(), t8.picks.map((p) => String(p.playerId)).sort(), 'live: its seventeen picks');
    const rowWrong = f.table.filter((t) => {
      const w = want.byId.get(t.pid);
      return t.cells[1] !== `$${w.bid}` || t.cells[2] !== String(w.at) || t.cells[3] !== String(w.now) || t.cells[4] !== signed(w.diff);
    });
    eq(rowWrong, [], 'live: every row’s price, rank, worth now and difference');
    eq(f.tiles.map((t) => [t.k, t.v, t.pid]), [
      ['Best steal', signed(t8.steal.diff), String(t8.steal.playerId)],
      ['Biggest miss', signed(t8.miss.diff), String(t8.miss.playerId)],
    ], 'live: the two tiles');
    ok(/Rank/.test(f.note) && /price/.test(f.note), 'live: how it works explains the auction’s Rank');

    // THE PREVIEW.
    const top = want.byId.get(f.table[0].pid);
    eq(r.pop && r.pop.cls, 'dr-pop', 'live: a number opens its preview as a card');
    eq(r.pop && r.pop.head, `${top.name} · ${top.position === 'DST' ? 'D/ST' : top.position}`, 'live: headed by the man');
    eq(r.pop && r.pop.rows, [
      ['Points so far', fmt(top.soFar)], ['Projected rest', fmt(top.rest)], ['Paid', `$${top.bid}`],
      ['Price rank', String(top.at)], ...(top.keeper ? [['Keeper', 'Yes']] : []), ['Worth now', `Pick ${top.now}`],
      [top.diff > 0 ? 'Steal' : 'Miss', signed(top.diff)],
    ], 'live: points so far, projected rest, paid, price rank, worth now, and the difference');
    eq(r.shut, null, 'live: a click elsewhere shuts it');
    eq(r.boardPop && r.boardPop.rows, r.pop && r.pop.rows, 'live: his number on the board opens the same preview');
    eq(r.afterEsc, null, 'live: Escape shuts it');

    // ANOTHER TEAM, then the sample and back.
    const t7 = R.teamReview(want.rv.rows, 7);
    eq([r.seven.team, r.seven.mineHead, r.seven.table.length], ['7', ['7'], 17], 'live: team 7 picked');
    eq(r.seven.tiles.map((t) => t.pid), [String(t7.steal.playerId), String(t7.miss.playerId)], 'live: its own steal and miss');
    eq(r.prefs['draft.team.1241838-2026'], 7, 'live: remembered for this league');
    ok(r.okDemo && r.sample.badge === 'Demo' && r.sample.cells.length === 160, 'live: the switch goes to the sample');
    ok(r.okWarm && r.again.badge === 'Live' && r.again.team === '7', 'live: and back, to the team that was picked');
  }
}

// --------------------------------------------------------------------- cloud
{
  const r = run('cloud', { DR_CLOUD: '1' });
  ok(!r.boot, 'cloud: boots', r.boot);
  if (!r.boot) {
    ok(r.ok, 'cloud: settles');
    eq([r.calls.draft || 0, r.calls.players || 0, r.calls.squads || 0, r.calls.schedule || 0], [0, 0, 0, 0], 'cloud: nothing is asked of ESPN — no draft, no players, no squads');
    eq(r.fetches, [], 'cloud: and nothing around the stubs');
    eq(r.errors, [], 'cloud: no errors');
    eq(r.page.status, 'This page needs the league read directly for now. Showing demo data instead.', 'cloud: says why, in the site’s words');
    eq([r.page.badge, r.page.source, r.page.cells.length], ['Demo', ['demo'], 160], 'cloud: over the sample draft');
  }
}

// --------------------------------------------------------------------- snake
{
  const r = run('snake', { DR_SNAKE: '1' });
  ok(!r.boot, 'snake: boots', r.boot);
  if (!r.boot) {
    const raw = JSON.parse(JSON.stringify(RAW));
    raw.settings.draftSettings.type = 'SNAKE';
    for (const p of raw.draftDetail.picks) p.bidAmount = 0;
    const want = expected(raw);
    const f = r.page;
    ok(r.ok, 'snake: settles');
    eq(r.errors, [], 'snake: no errors');
    eq(f.sub, 'The Keeper League · Snake · 170 picks · 4 weeks played', 'snake: says so');
    eq(f.tableHeads, ['Player', 'Pick', 'Now', '+/−'], 'snake: Pick, and no Paid');
    const wrong = f.cells.filter((c) => {
      const w = want.byId.get(c.pid);
      return !w || c.went.split(' ')[0] !== String(w.overall) || c.d !== signed(w.overall - w.now);
    });
    eq([f.cells.length, wrong.slice(0, 3)], [170, []], 'snake: every cell is its overall pick, and the difference is pick − worth now');
    const top = want.byId.get(f.table[0].pid);
    eq(r.pop && r.pop.rows.map((x) => x[0]), ['Points so far', 'Projected rest', 'Drafted', ...(top.keeper ? ['Keeper'] : []), 'Worth now', top.diff > 0 ? 'Steal' : 'Miss'], 'snake: the preview says Drafted, not a price');
    eq(r.pop && r.pop.rows[2], ['Drafted', `Pick ${top.overall}`], 'snake: his pick');
  }
}

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
