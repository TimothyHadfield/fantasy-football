// The Draft page's "what if", booted from the real draft.html with the real
// js/draft-page.js on the sample draft (nothing connected, not one request).
//
// Tim, 2026-10-26: "add a "what if" feature in the draft section where you can
// click on a single player while a user is selected, and then you can replace
// that player with any other player that was drafted after that player and the
// what if will calculate the outcomes as if that user drafted that player. Add a
// "what if" box underneath the draft board ... allow the user to keep switching
// their draft picks with other players as much as they want. When they're done
// allow the player to go back to normal aswell."
//
//   node draft-whatif-check.mjs
//
// One boot, in a child process (a page module self-boots once a process):
// a click on one of the picked team's picks opens the men drafted after it; a
// choice makes the swap (the board's order is js/draft-review.js `whatIfOrder`'s,
// worked out here from the board as it was drawn); the box under the board says
// what the season the page played says; a second swap stacks; Undo drops one;
// Back to normal drops them all. A tap (a finger) chooses rather than previews.
// The arithmetic itself is test-draft-whatif.mjs's.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REPO, HERE, moduleUrl } from './repo.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// ------------------------------------------------------------------- the child

async function child() {
  const errors = [];
  console.error = (...a) => { errors.push(a.join(' ')); };
  process.on('unhandledRejection', (r) => errors.push(`unhandled: ${String((r && r.stack) || r)}`));
  const dom = bootDom({ html: readFileSync(path.join(REPO, 'draft.html'), 'utf8'), store: {} });
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
  const asTouch = (fn) => {
    const mouse = window.matchMedia;
    const touch = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    window.matchMedia = touch;
    globalThis.matchMedia = touch;
    try { return fn(); } finally { window.matchMedia = mouse; globalThis.matchMedia = mouse; }
  };
  await sleep(20);
  const ok = Boolean(await waitFor(() => $('modeBadge').className.includes('demo') &&
    document.querySelector('#draftBoard tbody tr td.dr-cell[data-ov]'), 20000));
  await sleep(20);

  /** The board as drawn: pick -> [team, man]. */
  const board = () => Object.fromEntries([...document.querySelectorAll('#draftBoard td.dr-cell[data-ov]')].map((td) =>
    [td.dataset.ov, [td.dataset.team, (td.querySelector('.dr-why') || {}).dataset?.pid ?? null, td.classList.contains('wi-in')]]));
  const read = () => {
    const pop = $('statCard');
    return {
      team: $('teamSelect').value,
      board: board(),
      panelHidden: $('whatIfPanel').hidden,
      lede: text($('wiLede')),
      undoHidden: $('wiUndo').hidden,
      resetHidden: $('wiReset').hidden,
      tableHidden: $('wiWrap').hidden,
      keyHidden: $('wiKey').hidden,
      explainHidden: $('wiExplain').hidden,
      explain: text($('wiNote')),
      heads: [...document.querySelectorAll('#wiTable thead th')].map(text),
      rows: [...document.querySelectorAll('#wiTable tbody tr')].map((tr) => ({
        cls: tr.className, cells: [...tr.children].map((td) => text(td).replace(/\s*[▲▼]/g, '')), pops: [...tr.children].map((td) => td.hasAttribute('data-pop')),
      })),
      sheetHidden: $('wiSheet').hidden,
      sheetTitle: text($('wiSheetTitle')),
      chips: [...$('wiPos').querySelectorAll('button')].map((b) => [b.dataset.pos, b.classList.contains('on')]),
      cands: [...$('wiList').querySelectorAll('button.wi-cand')].map((b) => [b.dataset.pid, text(b.querySelector('.wi-c-at'))]),
      box: [...document.querySelectorAll('#boxToggle button.on')].map((b) => b.dataset.box),
      pop: pop && !pop.hidden ? { head: text(pop.querySelector('.tc-ident')), rows: [...pop.querySelectorAll('tr')].map((tr) => [...tr.children].map(text)), sheet: pop.classList.contains('sheet') } : null,
      season: window.ffWhatIf && window.ffWhatIf.season(),
      swaps: window.ffWhatIf && window.ffWhatIf.swaps().map((x) => ({ overall: x.overall, playerId: String(x.playerId) })),
    };
  };
  const ser = (s) => (s ? { changed: [...s.changed], left: s.left, teams: s.teams.map((t) => ({ teamId: t.teamId, real: t.real, whatIf: t.whatIf })) } : null);
  const snap = () => { const r = read(); r.season = ser(r.season); return r; };
  const cellOf = (ov) => document.querySelector(`#draftBoard td.dr-cell[data-ov="${ov}"]`);

  const before = snap();
  // The picked team's first pick, and a man in another team's column.
  const mine = Object.entries(before.board).filter(([, v]) => v[0] === before.team).map(([ov]) => Number(ov)).sort((a, b) => a - b);
  const theirs = Object.entries(before.board).find(([, v]) => v[0] !== before.team);
  // ANOTHER TEAM'S PICK opens nothing.
  fire(cellOf(theirs[0]).querySelector('.dr-why') || cellOf(theirs[0]), 'click');
  const other = snap();
  fire(document.body, 'keydown', { key: 'Escape' });
  // THE PERFECT DRAFT ON SHOW: a click on a pick puts the board back on Drafted first.
  const perfBtn = document.querySelector('#boxToggle button[data-box="perfect"]');
  if (perfBtn) fire(perfBtn, 'click');
  const perf = snap();
  const at = mine[1];
  fire(cellOf(at).querySelector('.dr-name') || cellOf(at), 'click');
  const open = snap();
  // A mouse over a man in the list: his preview.
  const second = $('wiList').querySelectorAll('button.wi-cand')[1];
  fire(second, 'mouseover');
  const hover = snap();
  fire(second, 'mouseout');
  // A position chip narrows the list.
  const chip = [...$('wiPos').querySelectorAll('button')].find((b) => b.dataset.pos === 'WR');
  if (chip) fire(chip, 'click');
  const wrs = snap();
  fire([...$('wiPos').querySelectorAll('button')].find((b) => b.dataset.pos === 'ALL'), 'click');
  // CHOOSE: the list's first man (the best by worth now).
  const chosen = $('wiList').querySelector('button.wi-cand').dataset.pid;
  fire($('wiList').querySelector('button.wi-cand'), 'click');
  const one = snap();
  // The box's previews: Record on the picked team's row.
  const myRow = [...document.querySelectorAll('#wiTable tbody tr')].find((tr) => tr.classList.contains('wi-me'));
  fire(myRow.children[1], 'mouseover');
  const recPop = snap().pop;
  fire(myRow.children[1], 'mouseout');
  // A SECOND SWAP, by a finger: the tap on a pick opens the list, a tap in it chooses.
  const at2 = mine[3];
  const two = asTouch(() => {
    fire(cellOf(at2).querySelector('.dr-name') || cellOf(at2), 'click');
    const opened = !$('wiSheet').hidden;
    const b = $('wiList').querySelectorAll('button.wi-cand')[2];
    const pid = b.dataset.pid;
    fire(b, 'click');
    return { opened, pid, page: snap() };
  });
  // A tap outside closes an open list.
  fire(cellOf(mine[4]).querySelector('.dr-name') || cellOf(mine[4]), 'click');
  const reopened = !$('wiSheet').hidden;
  fire(document.body, 'click');
  const closedOutside = $('wiSheet').hidden;
  // UNDO, then BACK TO NORMAL.
  fire($('wiUndo'), 'click');
  const undone = snap();
  fire($('wiReset'), 'click');
  const reset = snap();
  return {
    ok, before, other, perf, at, open, hover, wrs, chosen, one, recPop, at2, two, reopened, closedOutside, undone, reset,
    fetches: dom.fetchCalls, errors,
  };
}

if (process.argv[2] === 'child') {
  try {
    emit(await child(), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

// ------------------------------------------------------------------ the parent

if (!process.argv[2]) {
  const res = spawnSync(process.execPath, [self, 'child'], { encoding: 'utf8', cwd: HERE, maxBuffer: 64 * 1024 * 1024 });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  const r = line ? JSON.parse(line.slice(2)) : { boot: `no result. stderr=${(res.stderr || '').slice(0, 1500)}` };

  let pass = 0;
  let fail = 0;
  const ok = (cond, name, detail = '') => {
    if (cond) pass++;
    else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
  };
  const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  const R = await import(moduleUrl('js/draft-review.js'));

  ok(!r.boot, 'boots', r.boot);
  if (!r.boot) {
    ok(r.ok, 'settles on the sample draft');
    eq(r.fetches, [], 'not one request');
    eq(r.errors, [], 'no errors');

    // BEFORE: the box is there, empty, with the hint.
    const b = r.before;
    eq([b.panelHidden, b.tableHidden, b.undoHidden, b.resetHidden, b.keyHidden, b.explainHidden], [false, true, true, true, true, true], 'before: the box shows only its hint; no table, no Undo, no Back to normal');
    ok(/^Click one of .+’s picks on the board to draft someone else there\.$/.test(b.lede), 'before: the hint names the picked team', b.lede);
    eq(Object.keys(b.board).length, 160, 'before: 160 picks on the board');
    eq(b.season, null, 'before: no what-if season');
    eq(r.other.sheetHidden, true, 'another team’s pick opens no list');
    eq(r.other.swaps, [], 'and makes no swap');

    // The board as drawn, as picks (pick, team, man) — the input to the module's own order.
    const picks = Object.entries(b.board).map(([ov, [teamId, pid]]) => ({ overall: Number(ov), teamId, playerId: pid })).sort((x, y) => x.overall - y.overall);

    // OPEN: the list of everyone drafted after the pick.
    const o = r.open;
    eq(o.box, ['drafted'], 'a click on a pick while the perfect draft is on puts the board back on Drafted');
    eq(o.sheetHidden, false, 'a click on one of the picked team’s picks opens the list');
    ok(o.sheetTitle.startsWith(`Pick ${r.at} · `) && o.sheetTitle.includes('instead of'), 'the list says which pick and who is there', o.sheetTitle);
    const after = picks.filter((p) => p.overall > r.at);
    eq(o.cands.map((c) => c[0]).sort(), after.map((p) => p.playerId).sort(), 'the list is every man drafted after that pick, and nobody else');
    eq(o.cands.every(([pid, ov]) => Number(ov) === picks.find((p) => p.playerId === pid).overall), true, 'each with the pick he went at');
    eq(o.chips[0], ['ALL', true], 'the position chips start on All');
    ok(o.chips.length >= 5, 'a chip a position', JSON.stringify(o.chips));
    ok(r.hover.pop && /Now at/.test(JSON.stringify(r.hover.pop.rows)) && /Moves to/.test(JSON.stringify(r.hover.pop.rows)), 'a mouse over a man in the list: his preview, where he is and where he would go', JSON.stringify(r.hover.pop));
    eq(r.hover.swaps, [], 'and a preview makes no swap');
    ok(r.wrs.cands.length > 0 && r.wrs.cands.length < o.cands.length, 'the WR chip narrows the list', `${r.wrs.cands.length} of ${o.cands.length}`);

    // ONE SWAP: the board is the module's order, with the men between moved one pick later.
    const one = r.one;
    eq(one.swaps, [{ overall: r.at, playerId: r.chosen }], 'choosing a man makes the swap');
    eq(one.sheetHidden, true, 'and closes the list');
    const want1 = R.whatIfOrder(picks, one.swaps);
    eq(Object.entries(one.board).map(([ov, v]) => [Number(ov), v[0], v[1]]).sort((x, y) => x[0] - y[0]),
      want1.map((p) => [p.overall, String(p.teamId), String(p.playerId)]), 'the board is the what-if order: each team keeps its picks, the men between slide one later');
    const from = picks.find((p) => p.playerId === r.chosen).overall;
    eq(one.board[r.at][1], r.chosen, 'the chosen man is at the pick');
    eq(one.board[r.at + 1][1], b.board[r.at][1], 'the man who was there is one pick later');
    eq(one.board[from][1], b.board[from - 1][1], 'and the man just before the chosen one’s old pick is now at it');
    eq(Object.keys(one.board).filter((ov) => Number(ov) > from || Number(ov) < r.at).every((ov) => one.board[ov][1] === b.board[ov][1]), true, 'nobody outside the two picks moves');
    eq(Object.entries(one.board).filter(([, v]) => v[2]).map(([ov]) => Number(ov)), [r.at], 'the swapped pick is marked on the board');
    eq([one.panelHidden, one.tableHidden, one.undoHidden, one.resetHidden, one.keyHidden, one.explainHidden], [false, false, false, false, false, false], 'with a swap: the table, Undo, Back to normal, the key and the explain');
    ok(/ takes .+ at pick \d+ instead of .+\.$/.test(one.lede) && one.lede.includes(`pick ${r.at}`), 'the lede says the swap in words', one.lede);
    eq(one.heads, ['Team', 'Record', '+/−', 'Avg', '+/−', 'PF', 'PA', 'Best', 'Worst', 'Rank', '+/−', 'Playoffs', '+/−'], 'the box’s headings');
    eq(one.rows.length, 10, 'a row a team');

    // THE BOX SAYS WHAT THE SEASON SAYS.
    const s = one.season;
    const rec = (x) => `${x.w}-${x.l}${x.t ? `-${x.t}` : ''}`;
    const byRank = s.teams.slice().sort((x, y) => x.whatIf.rank - y.whatIf.rank);
    eq(one.rows.map((row) => row.cells[9]), byRank.map((t) => String(t.whatIf.rank)), 'rows in the what-if’s order, a rank each');
    eq(one.rows.map((row) => row.cells[1]), byRank.map((t) => rec(t.whatIf)), 'each team’s what-if record');
    eq(one.rows.map((row) => row.cells[5]), byRank.map((t) => (Math.round(t.whatIf.pf * 10) / 10).toFixed(1)), 'its points for');
    eq(one.rows.map((row) => row.cells[6]), byRank.map((t) => (Math.round(t.whatIf.pa * 10) / 10).toFixed(1)), 'its points against');
    const signed = (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}`;
    eq(one.rows.map((row) => row.cells[10]), byRank.map((t) => signed(t.real.rank - t.whatIf.rank)), 'the change in rank (up is +)');
    const wins = (x) => x.w + x.t / 2;
    eq(one.rows.map((row) => row.cells[2]), byRank.map((t) => signed(wins(t.whatIf) - wins(t.real))), 'the change in wins');
    eq(s.left, 0, 'the sample’s season is all played');
    ok(one.rows.every((row) => row.cells[11] === 'In' || row.cells[11] === 'Out'), 'with nothing left to play, Playoffs is In or Out');
    eq(one.rows.filter((row) => row.cells[11] === 'In').length, 6, 'six teams in, the sample’s field');
    eq(one.rows.map((row) => row.cells[12]), byRank.map((t) => ((t.whatIf.pPlayoffs >= 0.5) === (t.real.pPlayoffs >= 0.5) ? '0' : `was ${t.real.pPlayoffs >= 0.5 ? 'In' : 'Out'}`)),
      'its change says what it really was, when it changed');
    const games = s.teams.reduce((n, t) => n + t.whatIf.w + t.whatIf.l + t.whatIf.t, 0);
    eq(s.teams.reduce((n, t) => n + t.whatIf.w, 0) * 2 + s.teams.reduce((n, t) => n + t.whatIf.t, 0), games, 'every game has one winner (or a tie on both sides)');
    eq(s.teams.reduce((n, t) => n + t.whatIf.pf, 0).toFixed(6), s.teams.reduce((n, t) => n + t.whatIf.pa, 0).toFixed(6), 'the league’s points for are its points against');
    ok(s.changed.includes(one.board[r.at][0]), 'the team that swapped is one of the changed teams', JSON.stringify(s.changed));
    eq(s.teams.filter((t) => !s.changed.includes(String(t.teamId))).every((t) => Math.abs(t.whatIf.pf - t.real.pf) < 1e-9), true, 'a team with no swap keeps its real points for');
    ok(one.rows.every((row) => row.pops[1] && row.pops[2] && row.pops[3] && row.pops[4] && row.pops[5] && row.pops[6] && row.pops[11]), 'the box’s numbers each open a preview');
    ok(r.recPop && r.recPop.rows.length >= 13 && /What-if record/.test(r.recPop.head), 'Record’s preview: a played week a row', JSON.stringify(r.recPop && r.recPop.head));
    ok(/played weeks only/.test(one.explain) && /Injured reserve is left out/.test(one.explain) && /best lineup/.test(one.explain), 'the explain states the lineup rule');

    // TWO SWAPS, by a finger.
    const t = r.two;
    eq(t.opened, true, 'a tap on another of the team’s picks opens the list');
    eq(t.page.swaps, [{ overall: r.at, playerId: r.chosen }, { overall: r.at2, playerId: t.pid }], 'a tap in the list chooses: the swaps stack');
    eq(t.page.pop, null, 'and the tap opens no preview sheet');
    eq(Object.entries(t.page.board).map(([ov, v]) => [Number(ov), v[0], v[1]]).sort((x, y) => x[0] - y[0]),
      R.whatIfOrder(picks, t.page.swaps).map((p) => [p.overall, String(p.teamId), String(p.playerId)]), 'the board is the order with both swaps');
    ok(/· 2 swaps\.$/.test(t.page.lede), 'the lede counts the swaps', t.page.lede);
    eq([r.reopened, r.closedOutside], [true, true], 'a click outside the list closes it');

    // UNDO, then BACK TO NORMAL.
    eq(r.undone.swaps, one.swaps, 'Undo drops the last swap');
    eq(r.undone.board, one.board, 'and the board is the one-swap board again');
    eq(r.reset.swaps, [], 'Back to normal drops them all');
    eq(Object.fromEntries(Object.entries(r.reset.board).map(([k, v]) => [k, v.slice(0, 2)])), Object.fromEntries(Object.entries(b.board).map(([k, v]) => [k, v.slice(0, 2)])), 'and the board is the draft as it was');
    eq([r.reset.tableHidden, r.reset.undoHidden, r.reset.resetHidden, r.reset.lede], [true, true, true, b.lede], 'and the box is back to its hint');
  }

  console.log(fail ? `\n${fail} of ${pass + fail} assertions FAILED` : `\nAll ${pass} assertions passed`);
  process.exit(fail ? 1 : 0);
}
