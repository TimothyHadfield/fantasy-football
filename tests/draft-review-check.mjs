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
//   value    the same league with its frozen Value lines known (FF_VALUE, the
//            shape js/season.js hands on): "vs worth now" on Value, and the
//            row of team totals over round one
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
    // The shared stat card (js/pop.js); the page's own popover is gone.
    const pop = $('statCard');
    const link = pop && pop.querySelector('.tc-open');
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
      // THE BOX SWITCH ("Drafted" / "Own now"), and the cells boxed one by one.
      box: $('boxToggle') ? {
        hidden: $('boxToggle').hidden,
        labels: [...$('boxToggle').querySelectorAll('button')].map((b) => [b.dataset.box, text(b)]),
        on: [...$('boxToggle').querySelectorAll('button.on')].map((b) => b.dataset.box),
      } : null,
      // THE COMPARISON SWITCH: each tab's key, its words and whether it is hidden, and the one lit.
      compare: {
        labels: [...$('compareToggle').querySelectorAll('button')].map((b) => [b.dataset.compare, text(b), b.hasAttribute('hidden')]),
        on: [...$('compareToggle').querySelectorAll('button.on')].map((b) => b.dataset.compare),
      },
      // The box the board sits in, and the panel that box is in (its height is the stylesheet's).
      boardBox: [board.parentNode.className, board.parentNode.parentNode.id],
      ownPids: [...board.querySelectorAll('tbody td.dr-own')].map((td) => (td.querySelector('.dr-why') ? td.querySelector('.dr-why').dataset.pid : null)),
      ownOther: board.querySelectorAll('.dr-own:not(td.dr-cell)').length,
      boardOwn: board.classList.contains('dr-own-on'),
      // Every cell of the board as drawn, the box classes left out: flipping the switch must change none of it.
      boardHtml: board.innerHTML.replace(/ dr-(?:mine|own)\b/g, ''),
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
      // The team totals (Value): which row of the board's body it is, its label, a number a team.
      totalRow: (() => {
        const tr = board.querySelector('tbody tr.dr-total');
        if (!tr) return null;
        return {
          index: [...board.querySelectorAll('tbody tr')].indexOf(tr),
          label: text(tr.querySelector('td.dr-rd')),
          cells: [...tr.querySelectorAll('td.dr-tot')].map((td) => ({
            team: td.dataset.team, v: text(td).replace(/\s*[▲▼]/g, ''), mine: td.classList.contains('dr-mine'),
            heat: (td.className.match(/heat-(?:up|dn)-\d|heat-0/) || [''])[0],
          })),
        };
      })(),
      explainHidden: $('drExplain').hidden,
      pop: pop && !pop.hidden ? {
        cls: pop.className, rows: [...pop.querySelectorAll('tr')].map((tr) => [...tr.children].map(text)), head: text(pop.querySelector('.tc-ident')),
        foot: text(pop.querySelector('.sc-foot')), link: link ? [text(link), link.getAttribute('href')] : null,
        close: Boolean(pop.querySelector('.tc-close')),
      } : null,
      oldPop: Boolean($('drPop')),
      titles: document.querySelectorAll('#reviewView td[title], #reviewView .dr-name[title], #reviewView button[title]').length,
      goNames: document.querySelectorAll('#reviewView .dr-name[data-tip]:not([data-tip-go])').length,
    };
  };
  /** Until `fn()` is back, the pointer is a finger (`(hover: none)` matches). */
  const asTouch = (fn) => {
    const mouse = window.matchMedia;
    const touch = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    window.matchMedia = touch;
    globalThis.matchMedia = touch;
    try { return fn(); } finally { window.matchMedia = mouse; globalThis.matchMedia = mouse; }
  };
  /** A mouse click, and where it went ('' when it went nowhere). */
  const clickTo = (el) => {
    window.location.href = '';
    fire(el, 'click');
    const went = window.location.href || '';
    window.location.href = '';
    return went;
  };
  return { ...dom, $, fire, settle, read, asTouch, clickTo, errors, calls: () => ({ ...(globalThis.__dr || {}) }) };
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
    // THE SAMPLE GOES NOWHERE: its men and teams are made up.
    const head = p.document.querySelector(`#draftBoard thead button[data-team="${first.teams[6][0]}"]`);
    p.fire(head, 'mouseover');
    const headCard = p.read().pop;
    const headWent = p.clickTo(head);
    p.fire(head, 'mouseout');
    const nameWent = p.clickTo(p.document.querySelector('#teamTable tbody .dr-name'));
    const headSheet = p.asTouch(() => { p.fire(head, 'click'); return p.read().pop; });
    p.fire(p.document.body, 'keydown', { key: 'Escape' });
    return {
      ok, first, picked, byBoard, room, back, headCard, headWent, nameWent, headSheet,
      fetches: p.fetchCalls, errors: p.errors, prefs: JSON.parse(p.map.get('ff.prefs') || '{}'),
    };
  },

  // THE DRAFT ROOM, on the built-in pool: nothing connected, not one request.
  async room() {
    const p = await boot({ stubs: false });
    await p.settle('demo');
    const { document } = p;
    p.fire(p.$('viewToggle').querySelector('button[data-view="room"]'), 'click');
    p.fire(p.$('startBtn'), 'click');
    const entered = await waitFor(() => !p.$('room').classList.contains('hidden') && document.querySelector('#boardTable tbody tr'), 20000);
    const card = () => {
      const c = p.$('statCard');
      if (!c || c.hidden) return null;
      const link = c.querySelector('.tc-open');
      return {
        head: text(c.querySelector('.tc-ident')), foot: text(c.querySelector('.sc-foot')),
        rows: [...c.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(text)),
        total: [...c.querySelectorAll('tfoot tr.sc-total td')].map(text),
        link: link ? link.getAttribute('href') : null, sheet: c.classList.contains('sheet'),
      };
    };
    const over = (el) => { if (!el) return null; p.fire(el, 'mouseover'); const c = card(); const went = p.clickTo(el); p.fire(el, 'mouseout'); return c && { ...c, went }; };
    const th = (id) => Object.fromEntries([...p.$(id).querySelectorAll('thead th')].map((h) => [text(h), h.getAttribute('title') || '']));
    const heatOf = (td) => (td.className.match(/heat-(?:up|dn)-\d|heat-0/) || [''])[0];

    const rows = [...document.querySelectorAll('#boardTable tbody tr')];
    const cols = rows.map((tr) => [...tr.children]);
    const first = cols[0];
    const board = {
      rows: rows.length,
      carded: cols.filter((c) => ['p', 'j', 'v', 'l'].every((k, i) => (c[[1, 5, 7, 8][i]].getAttribute('data-dcard') || '').startsWith(`${k}:`))).length,
      tabStops: document.querySelectorAll('#boardTable tbody [tabindex]').length,
      titled: document.querySelectorAll('#roomView [data-dcard][title]').length,
      projHeat: new Set(cols.map((c) => heatOf(c[5]))).size,
      vorpHeat: new Set(cols.map((c) => heatOf(c[7]))).size,
      allHeat: cols.every((c) => heatOf(c[5]) && heatOf(c[7])),
      otherHeat: cols.filter((c) => [0, 1, 2, 3, 4, 6, 8, 9].some((i) => /heat/.test(c[i].className))).length,
      // The best QB by projection on the board is green; the best by vs repl. overall too.
      vorpTop: heatOf(cols.slice().sort((a, b) => Number(b[7].dataset.v) - Number(a[7].dataset.v))[0][7]),
      vorpLow: heatOf(cols.slice().sort((a, b) => Number(a[7].dataset.v) - Number(b[7].dataset.v))[0][7]),
    };
    const cells = { name: text(first[1]), pos: text(first[2]), proj: text(first[5]).replace(/\s*[▲▼]/g, ''), vorp: text(first[7]).replace(/\s*[▲▼]/g, ''), lasts: text(first[8]), why: text(first[9]) };
    const previews = { name: over(first[1]), proj: over(first[5]), vorp: over(first[7]), lasts: over(first[8]), why: over(first[9]) };
    const pick = { name: over(p.$('pcName')), vorp: over(p.$('pcVorp')), pcVorp: text(p.$('pcVorp')) };
    const waitRow = [...document.querySelectorAll('#waitTable tbody tr')].map((tr) => [...tr.children]).find((c) => c[3].hasAttribute('data-dcard'));
    const wait = waitRow ? { cost: text(waitRow[3]), card: over(waitRow[3]), best: over(waitRow[1]), bestName: text(waitRow[1]) } : null;
    // A finger: the same card as a sheet, and on the built-in pool no link out of the draft.
    const sheet = p.asTouch(() => { p.fire(first[1], 'click'); return card(); });
    p.fire(document.body, 'keydown', { key: 'Escape' });
    const heads = { board: th('boardTable'), wait: th('waitTable'), lineup: th('lineupTable') };

    // THE WHOLE DRAFT, taking the recommendation every round.
    let picks = 0;
    while (p.$('results').classList.contains('hidden') && picks < 40) { p.fire(p.$('takeBtn'), 'click'); picks++; }
    const done = !p.$('results').classList.contains('hidden');
    const sub = text(p.$('resultSub'));
    const lineup = [...document.querySelectorAll('#lineupTable tbody tr')].map((tr) => [...tr.children]);
    const league = [...document.querySelectorAll('#leagueTable tbody tr')].map((tr) => [...tr.children]);
    const results = {
      done, picks, sub, title: text(p.$('resultTitle')), badge: text(p.$('gradeBadge')),
      grade: over(p.$('gradeBadge')),
      edge: { cell: text(lineup[0][4]), proj: text(lineup[0][2]), name: text(lineup[0][1]), card: over(lineup[0][4]) },
      man: over(lineup[0][1]),
      heat: league.map((c) => heatOf(c[2])),
      otherHeat: league.filter((c) => [0, 1, 3].some((i) => /heat/.test(c[i].className))).length,
      team: { cell: text(league[0][2]).replace(/\s*[▲▼]/g, ''), name: text(league[0][1]), card: over(league[0][2]) },
    };
    return { entered: Boolean(entered), board, cells, previews, pick, wait, sheet, heads, results, fetches: p.fetchCalls, errors: p.errors };
  },

  async live() {
    const p = await boot({ store: { 'ff.prefs': { 'draft.source': 'live' }, 'ff.connection': CONN } });
    const ok = await p.settle('live');
    const cold = p.calls();
    const first = p.read();
    const kept = JSON.parse(p.map.get('ff-draft-review-v1') || '{}');

    // A PREVIEW: the first number in the team's table (a mouse: `matchMedia` says hover).
    const why = p.document.querySelector('#teamTable tbody .dr-why');
    p.fire(why, 'mouseover');
    const pop = p.read().pop;
    const whyWent = p.clickTo(why);
    p.fire(why, 'mouseout');
    const shut = p.read().pop;
    // The same man's number on the board opens the same thing.
    p.fire(p.document.querySelector(`#draftBoard .dr-why[data-pid="${why.dataset.pid}"]`), 'mouseover');
    const boardPop = p.read().pop;
    p.fire(p.document.body, 'keydown', { key: 'Escape' });
    const afterEsc = p.read().pop;
    // A finger: the same card as a sheet with a Close.
    const sheet = p.asTouch(() => { p.fire(why, 'click'); return p.read().pop; });
    p.fire(p.document.body, 'keydown', { key: 'Escape' });

    // THE CONNECTORS. His name goes to him on Players.
    const nameEl = p.document.querySelector('#teamTable tbody .dr-name');
    const namePid = nameEl.closest('tr').dataset.pid;
    const nameWent = p.clickTo(nameEl);
    // A team's heading on the board: its card; a click picks it, the next goes to its roster.
    const head = p.document.querySelector('#draftBoard thead button[data-team="3"]');
    p.fire(head, 'mouseover');
    const headCard = p.read().pop;
    const headFirst = p.clickTo(head);
    const headPicked = p.$('teamSelect').value;
    const headStill = p.read().pop;
    const headSecond = p.clickTo(head);
    p.fire(head, 'mouseout');
    const other = p.document.querySelector('#draftBoard thead button[data-team="5"]');
    const headSheet = p.asTouch(() => { p.fire(other, 'click'); return p.read().pop; });
    const sheetPicked = p.$('teamSelect').value;
    p.fire(p.document.body, 'keydown', { key: 'Escape' });
    const cardsMeta = { oldPop: first.oldPop, titles: first.titles, goNames: first.goNames };

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
      whyWent, sheet, namePid, nameWent, headCard, headFirst, headPicked, headStill, headSecond, headSheet, sheetPicked, cardsMeta,
      keptLeague: kept.league, keptPicks: kept.kept && kept.kept.draft ? kept.kept.draft.picks.length : 0,
      keptWeeks: kept.kept && kept.kept.weeks ? Object.keys(kept.kept.weeks).length : 0,
      fetches: p.fetchCalls.filter((u) => /espn/i.test(u)), errors: p.errors,
      prefs: JSON.parse(p.map.get('ff.prefs') || '{}'),
    };
  },

  // AGAINST THE PRESEASON RANK: the other half of the comparison switch.
  async pre() {
    const p = await boot({ store: { 'ff.prefs': { 'draft.source': 'live' }, 'ff.connection': CONN } });
    const ok = await p.settle('live');
    const sw = () => ({
      hidden: p.$('compareToggle').hidden,
      on: [...p.$('compareToggle').querySelectorAll('button.on')].map((b) => b.dataset.compare),
    });
    const now = p.read();
    const swNow = sw();
    const cold = p.calls();
    const kept = JSON.parse(p.map.get('ff-draft-review-v1') || '{}');
    p.fire(p.$('compareToggle').querySelector('button[data-compare="pre"]'), 'click');
    const pre = p.read();
    const swPre = sw();
    const afterSwitch = p.calls();
    const why = p.document.querySelector('#teamTable tbody .dr-why');
    p.fire(why, 'mouseover');
    const pop = p.read().pop;
    const popPid = why.dataset.pid;
    p.fire(why, 'mouseout');
    const head = p.document.querySelector('#draftBoard thead button[data-team="3"]');
    p.fire(head, 'mouseover');
    const headCard = p.read().pop;
    p.fire(head, 'mouseout');
    const prefsPre = JSON.parse(p.map.get('ff.prefs') || '{}');
    // To the sample and back: the ranks are kept, and the view stays.
    p.fire(p.$('sourceToggle').querySelector('button[data-src="demo"]'), 'click');
    await p.settle('demo');
    const sample = p.read();
    p.fire(p.$('sourceToggle').querySelector('button[data-src="live"]'), 'click');
    await p.settle('live');
    const warm = p.calls();
    const again = p.read();
    p.fire(p.$('compareToggle').querySelector('button[data-compare="now"]'), 'click');
    const back = p.read();
    return {
      ok, now, pre, swNow, swPre, cold, afterSwitch, warm, pop, popPid, headCard, sample, again, back, prefsPre,
      keptRanks: kept.kept && kept.kept.ranks ? Object.keys(kept.kept.ranks).length : 0,
      prefsBack: JSON.parse(p.map.get('ff.prefs') || '{}'),
      fetches: p.fetchCalls.filter((u) => /espn/i.test(u)), errors: p.errors,
    };
  },

  // VALUE KNOWN (FF_VALUE: the league's frozen lines and every rostered man's
  // figure, through draft-stub-season.mjs). "vs worth now" is on Value.
  async value() {
    const p = await boot({ store: { 'ff.prefs': { 'draft.source': 'live' }, 'ff.connection': CONN } });
    const ok = await p.settle('live');
    const cold = p.calls();
    const first = p.read();
    const why = p.document.querySelector('#teamTable tbody .dr-why');
    p.fire(why, 'mouseover');
    const pop = p.read().pop;
    const popPid = why.dataset.pid;
    p.fire(why, 'mouseout');
    const head = p.document.querySelector('#draftBoard thead button[data-team="3"]');
    p.fire(head, 'mouseover');
    const headCard = p.read().pop;
    p.fire(head, 'mouseout');
    // A PLAYER'S CARD carries his Value: a man on a squad, and one nobody holds.
    const cardOf = (pid) => {
      const el = p.document.querySelector(`#draftBoard .dr-why[data-pid="${pid}"]`).closest('td').querySelector('.dr-name');
      p.fire(el, 'mouseover');
      const c = p.$('tipCard');
      const v = c && !c.hidden && c.querySelector('.tc-value');
      const said = v ? text(v) : null;
      p.fire(el, 'mouseout');
      return said;
    };
    const cards = Object.fromEntries((process.env.DR_CARDS || '').split(',').filter(Boolean).map((pid) => [pid, cardOf(pid)]));
    // Another team: only its own panel is redrawn.
    p.$('teamSelect').value = '7';
    p.fire(p.$('teamSelect'), 'change');
    const seven = p.read();
    p.$('teamSelect').value = '8';
    p.fire(p.$('teamSelect'), 'change');
    // The other view, and back.
    p.fire(p.$('compareToggle').querySelector('button[data-compare="pre"]'), 'click');
    const pre = p.read();
    // In that view a number's preview carries his own preseason Value.
    const whyPre = p.document.querySelector('#teamTable tbody .dr-why');
    p.fire(whyPre, 'mouseover');
    const prePop = p.read().pop;
    const prePopPid = whyPre.dataset.pid;
    p.fire(whyPre, 'mouseout');
    p.fire(p.$('compareToggle').querySelector('button[data-compare="now"]'), 'click');
    const back = p.read();
    return {
      ok, cold, first, pop, popPid, headCard, cards, seven, pre, back, prePop, prePopPid,
      fetches: p.fetchCalls.filter((u) => /espn/i.test(u)), errors: p.errors,
    };
  },

  // THE FOUR VIEWS (Tim, 2026-10-09: "add a expected value and value now tab
  // … along with the vs worth now and vs preseason rank tabs? Also rename the
  // worth now tab to value difference and the vs preseason rank to rank
  // difference."). DR_COMPARE is a choice already stored when the page opens:
  // then only what it opened on is read.
  async views() {
    const stored = process.env.DR_COMPARE ? { 'draft.compare': process.env.DR_COMPARE } : {};
    const p = await boot({ store: { 'ff.prefs': { 'draft.source': 'live', ...stored }, 'ff.connection': CONN } });
    const ok = await p.settle('live');
    const opened = p.read();
    if (process.env.DR_COMPARE) return { ok, opened, errors: p.errors };
    const prefs = () => JSON.parse(p.map.get('ff.prefs') || '{}')['draft.compare'];
    /** A tab clicked (false when the switch has no such tab), then the page and what is remembered. */
    const go = (k) => {
      const b = p.$('compareToggle').querySelector(`button[data-compare="${k}"]`);
      if (b) p.fire(b, 'click');
      return { there: Boolean(b), page: p.read(), pref: prefs() };
    };
    const hover = (el) => {
      p.fire(el, 'mouseover');
      const pop = p.read().pop;
      p.fire(el, 'mouseout');
      return pop;
    };
    const exp = go('exp');
    const why = p.document.querySelector('#teamTable tbody .dr-why');
    const expPop = hover(why);
    const expPopPid = why.dataset.pid;
    const expHead = hover(p.document.querySelector('#draftBoard thead button[data-team="3"]'));
    const val = go('val');
    const valHead = hover(p.document.querySelector('#draftBoard thead button[data-team="3"]'));
    const pre = go('pre');
    const back = go('now');
    return {
      ok, opened, exp, expPop, expPopPid, expHead, val, valHead, pre, back, calls: p.calls(),
      fetches: p.fetchCalls.filter((u) => /espn/i.test(u)), errors: p.errors,
    };
  },

  // WHOSE MEN ARE BOXED: the column a team drafted, or the men it owns now
  // (Tim, 2026-10-09: "make a switch that instead boxes all the players that
  // you currently own. Nothing else changes except the white boarders").
  // Team 3 on the real league: 12 of its 17 picks still its own, 3 dropped, 2 on
  // other squads, and one man another team drafted.
  async own() {
    const p = await boot({ store: { 'ff.prefs': { 'draft.source': 'live', 'draft.team.1241838-2026': 3 }, 'ff.connection': CONN } });
    const ok = await p.settle('live');
    const cold = p.calls();
    const click = (sel) => p.fire(p.document.querySelector(sel), 'click');
    const prefs = () => JSON.parse(p.map.get('ff.prefs') || '{}');
    const drafted = p.read();
    click('#boxToggle button[data-box="own"]');
    const own = p.read();
    const prefsOwn = prefs();
    const afterSwitch = p.calls();
    // Another team, by the picker and then by the board's heading: the boxes follow.
    p.$('teamSelect').value = '1';
    p.fire(p.$('teamSelect'), 'change');
    const one = p.read();
    click('#draftBoard thead button[data-team="3"]');
    p.fire(p.document.body, 'keydown', { key: 'Escape' });
    const three = p.read();
    // The other comparison redraws the board: the boxes are the same men.
    click('#compareToggle button[data-compare="pre"]');
    const pre = p.read();
    click('#compareToggle button[data-compare="now"]');
    // To the sample and back: still on.
    click('#sourceToggle button[data-src="demo"]');
    await p.settle('demo');
    const sample = p.read();
    click('#sourceToggle button[data-src="live"]');
    await p.settle('live');
    const again = p.read();
    click('#boxToggle button[data-box="drafted"]');
    const back = p.read();
    return {
      ok, cold, afterSwitch, warm: p.calls(), drafted, own, one, three, pre, sample, again, back, prefsOwn, prefsBack: prefs(),
      fetches: p.fetchCalls.filter((u) => /espn/i.test(u)), errors: p.errors,
    };
  },

  // …AND REMEMBERED: a page opened with the choice stored.
  async ownKept() {
    const p = await boot({ store: { 'ff.prefs': { 'draft.source': 'live', 'draft.team.1241838-2026': 3, 'draft.box': 'own' }, 'ff.connection': CONN } });
    const ok = await p.settle('live');
    return { ok, page: p.read(), errors: p.errors };
  },

  // A LEAGUE THAT HAS NOT DRAFTED (DR_EMPTY=1): nothing to box.
  async empty() {
    const p = await boot({ store: { 'ff.prefs': { 'draft.source': 'live', 'draft.box': 'own' }, 'ff.connection': CONN } });
    const ok = await p.settle('live');
    return { ok, page: p.read(), compareHidden: p.$('compareToggle').hidden, errors: p.errors };
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
    p.fire(p.document.querySelector('#teamTable tbody .dr-why'), 'mouseover');
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
/** A difference in Value, as the page prints it. */
const sv = (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)}`;

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
    eq([f.teams.length, f.heads.length, f.boardRows, f.cells.length], [10, 11, 17, 160], 'demo: ten teams, the totals and sixteen rounds, 160 picks on the board');
    eq(f.heads[0], 'Rd', 'demo: the round column');
    eq(f.heads.slice(1), f.teams.map((t) => t[1]), 'demo: a column a team, in the picker’s order');
    eq(f.cells.slice(0, 10).map((c) => c.went.split(' ')[0]), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 'demo: round one runs 1-10');
    eq(f.cells.slice(10, 20).map((c) => c.went.split(' ')[0]), ['20', '19', '18', '17', '16', '15', '14', '13', '12', '11'], 'demo: round two snakes back');
    // (The sample league's Value is made in memory, so its "vs worth now" is on Value.)
    ok(f.cells.every((c) => c.card && c.name && /^[+−]?\d+\.\d$/.test(c.d)), 'demo: every pick has a name with a card and a difference in Value', f.cells.slice(0, 5).map((c) => c.d).join(' '));
    ok(new Set(f.cells.map((c) => c.heat)).size >= 5 && f.cells.every((c) => c.heat), 'demo: the board is on the heat scale, in several steps');
    const tot = f.totalRow;
    eq(tot && [tot.index, tot.label, tot.cells.map((c) => c.team)], [0, 'Value', f.teams.map((t) => t[0])], 'demo: the row of team totals is the first under the headings, a number a team');
    ok(tot && tot.cells.every((c) => /^\d+\.\d$/.test(c.v) && Number(c.v) > 0), 'demo: each a Value', tot && tot.cells.map((c) => c.v).join(' '));
    ok(tot && new Set(tot.cells.map((c) => c.heat)).size >= 3, 'demo: coloured against the other teams', tot && tot.cells.map((c) => c.heat).join(' '));
    eq([f.team, f.mineHead, f.mineTeams, f.mineCells], [f.teams[0][0], [f.teams[0][0]], [f.teams[0][0]], 17], 'demo: the first team is picked and its column marked, its total with it');
    eq(f.tableHeads, ['Player', 'Pick', 'Now', '+/−'], 'demo: a snake has no Paid column');
    eq([f.table.length, f.sorted], [16, ['+/−']], 'demo: the team’s sixteen picks, sorted by the difference');
    const diffs = f.table.map((t) => Number(t.cells[3].replace('−', '-')));
    ok(diffs.every((d, i) => i === 0 || diffs[i - 1] >= d), 'demo: biggest steal first, biggest miss last', diffs.join(','));
    ok(f.table.every((t) => t.why && t.card), 'demo: every row has a preview and a card');
    eq(f.tiles.map((t) => [t.k, t.v]), [['Best steal', sv(diffs[0])], ['Biggest miss', sv(diffs[diffs.length - 1])]], 'demo: the two tiles are the table’s ends');
    ok(f.table.every((t) => /^\d+\.\d$/.test(t.cells[2])), 'demo: Now is his Value today', f.table.slice(0, 4).map((t) => t.cells[2]).join(' '));
    eq(f.tiles.map((t) => t.pid), [f.table[0].pid, f.table[f.table.length - 1].pid], 'demo: and name those two men');
    ok(f.table.every((t) => f.cells.find((c) => c.pid === t.pid && c.team === f.team && c.d === t.cells[3])), 'demo: the table and the board agree on every pick');
    eq(f.titles, 0, 'demo: no `title` on a cell (a phone would open it over the preview)');
    ok(/smoothed line/.test(f.note) && /read at his pick/.test(f.note) && !/Rank/.test(f.note) && !/drafted again today/.test(f.note),
      'demo: how it works is said under the fold — the line, read at his pick — without the auction’s line', f.note);

    const p = r.picked;
    eq([p.team, p.mineHead, p.mineTeams, p.mineCells], [f.teams[3][0], [f.teams[3][0]], [f.teams[3][0]], 17], 'demo: picking a team moves the mark to its column');
    eq(p.totalRow && p.totalRow.cells.filter((c) => c.mine).map((c) => c.team), [f.teams[3][0]], 'demo: and to its total');
    ok(p.table.length === 16 && p.table[0].pid !== f.table[0].pid, 'demo: and lists its picks');
    eq(p.cells, f.cells, 'demo: the board itself does not change');
    eq(r.byBoard.team, f.teams[6][0], 'demo: a team’s heading on the board picks it too');
    eq(r.byBoard.mineHead, [f.teams[6][0]], 'demo: and marks it');
    eq([r.room.reviewHidden, r.room.roomHidden], [true, false], 'demo: the switch shows the draft room');
    eq([r.back.reviewHidden, r.back.roomHidden], [false, true], 'demo: and back');
    eq(r.prefs['draft.team.demo'], Number(f.teams[6][0]), 'demo: the team is remembered');

    // THE PREVIEWS (2026-10-08, docs/previews-plan.md).
    eq([f.oldPop, f.goNames], [false, 0], 'demo: no popover of the page’s own, and every name is marked as one a click follows');
    eq(r.headCard && [r.headCard.cls, r.headCard.head], ['tipcard statcard', f.teams[6][1]], 'demo: a team’s heading on the board opens that team’s card');
    eq(r.headCard && r.headCard.rows.map((x) => x[0].replace(/(Avg|Best steal|Biggest miss).*/, '$1')),
      ['Record', 'Avg', 'Week 14 proj', 'Best steal', 'Biggest miss'], 'demo: its record, its average, this week, and its draft’s two ends');
    ok(r.headCard && /^Avg\d+(st|nd|rd|th) of 10$/.test(r.headCard.rows[1][0]), 'demo: the average says where it stands', r.headCard && r.headCard.rows[1][0]);
    eq([r.headWent, r.nameWent], ['', ''], 'demo: the sample’s teams and men go nowhere on a click');
    eq(r.headSheet && [r.headSheet.cls, r.headSheet.link, r.headSheet.close], ['tipcard statcard sheet', null, true], 'demo: a finger gets the same card as a sheet, with no link');
  }
}

// ----------------------------------------------------------- the draft room
{
  const r = run('room');
  ok(!r.boot, 'room: boots', r.boot);
  if (!r.boot) {
    const n = (s) => Number(String(s).replace('−', '-').replace('+', ''));
    /** Do a card's rows come to its bold line? (The first row, less the rest.) */
    const adds = (c) => Boolean(c && c.total.length) &&
      Math.abs(c.rows.reduce((a, x) => a + n(x[x.length - 1]), 0) - n(c.total[c.total.length - 1])) < 0.01;
    const { board: b, cells: c, previews: v, results: z } = r;
    ok(r.entered, 'room: a practice draft opens');
    eq([r.fetches, r.errors], [[], []], 'room: not one request, no errors');

    // HEADINGS: a one-line title each, and no others.
    const titled = (o) => Object.entries(o).filter(([, t]) => t).map(([k]) => k);
    eq([titled(r.heads.board), titled(r.heads.wait), titled(r.heads.lineup)],
      [['ADP', 'vs repl.', 'Lasts'], ['Cost of waiting', 'Chasing it'], ['Edge']], 'room: the six headings that needed one have a title');
    ok(Object.values({ ...r.heads.board, ...r.heads.wait, ...r.heads.lineup }).every((t) => t.length < 70 && !/\n/.test(t)), 'room: each one line');

    // THE BOARD.
    eq([b.rows, b.carded, b.tabStops, b.titled], [120, 120, 0, 0], 'room: all 120 rows open a card on the name, Proj, vs repl. and Lasts — no tab stops, no title beside a card');
    ok(b.allHeat && b.projHeat >= 5 && b.vorpHeat >= 5, 'room: Proj and vs repl. are on the red/green scale, in several steps', [b.projHeat, b.vorpHeat]);
    // (The scale is the whole board's; the worst of the 120 rows shown is red, not always the reddest.)
    eq([b.vorpTop, /^heat-dn-[2-4]$/.test(b.vorpLow), b.otherHeat], ['heat-up-4', true, 0], 'room: the best vs repl. is the greenest, the worst shown is red, and no other column is coloured');

    // A NAME: who he is, his three figures, and every note (the Why column has room for one).
    ok(v.name && v.name.head.startsWith(`${c.name} · ${c.pos}`), 'room: a name opens his card', v.name && v.name.head);
    eq(v.name && v.name.rows.slice(0, 3).map((x) => x[0]), ['Proj', 'ADP', 'Bye'], 'room: Proj, ADP, bye');
    eq(v.name && v.name.rows[0][1], c.proj, 'room: the projection the board prints');
    // (A man who is hurt has an Injury row between the two.)
    ok(v.name && v.name.rows.length > 3 && v.name.rows.slice(3).some((x) => x[0] === c.why && x[1] === '') &&
      v.name.rows.slice(3).every((x) => x[1] === '' || x[0] === 'Injury'),
      'room: and all his notes, the Why column’s among them', v.name && v.name.rows);
    eq(v.why, v.name, 'room: the Why cell opens the same card');
    eq([v.name && v.name.link, v.name && v.name.went, r.sheet && r.sheet.sheet, r.sheet && r.sheet.link], [null, '', true, null],
      'room: on the built-in pool it links nowhere, with a mouse or as a finger’s sheet');
    eq(r.sheet && r.sheet.rows, v.name && v.name.rows, 'room: the sheet is the same card');

    // THE NUMBERS.
    ok(adds(v.vorp), 'room: vs repl. is Proj less the replacement at his position', v.vorp);
    eq(v.vorp && [v.vorp.rows[0], v.vorp.rows[1][0], n(v.vorp.total[1])], [['Proj', c.proj], `Replacement ${c.pos}`, n(c.vorp)], 'room: and comes to the cell');
    ok(v.vorp && /of \d+ · avg -?[\d.]+ for the board$/.test(v.vorp.foot), 'room: with where it stands on the board', v.vorp && v.vorp.foot);
    ok(v.proj && new RegExp(`of \\d+ · avg [\\d.]+ for ${c.pos}s on the board$`).test(v.proj.foot) && v.proj.rows[0][1] === c.proj,
      'room: Proj says where he stands at his position', v.proj && v.proj.foot);
    eq(v.lasts && [v.lasts.rows.map((x) => x[0]).slice(0, 3), v.lasts.total], [['ADP', 'Your next pick', 'Picks before it'], ['Lasts', c.lasts]],
      'room: Lasts is his ADP against the picks before your next one');
    eq(r.pick.vorp && r.pick.vorp.total[1], r.pick.pcVorp, 'room: the pick card’s own vs repl. opens its breakdown');
    ok(r.pick.name && r.pick.name.rows.length >= 3, 'room: and its name his card');
    ok(r.wait && adds(r.wait.card) && r.wait.card.total[1] === r.wait.cost, 'room: Cost of waiting is the best now less what is expected later', r.wait);
    ok(r.wait && r.wait.best && r.wait.best.head.startsWith(r.wait.bestName), 'room: Best now opens that man');

    // THE RESULTS.
    ok(z.done && z.picks === 16, 'room: sixteen picks finish the draft', [z.done, z.picks]);
    eq(z.grade && z.grade.head, `Grade ${z.badge}`, 'room: the grade opens what it is made of');
    ok(adds(z.grade) && z.grade.rows[0][0] === 'Your lineup' && z.grade.rows[1][0] === 'League average', 'room: your lineup less the league’s average', z.grade);
    ok(z.grade && z.sub.includes(`lineup: ${Math.round(n(z.grade.rows[0][1]))} points`), 'room: the lineup the page states', [z.sub, z.grade && z.grade.rows[0]]);
    ok(z.grade && /^\d+(st|nd|rd|th) of 10 · best [\d.]+$/.test(z.grade.foot), 'room: and the finish', z.grade && z.grade.foot);
    ok(adds(z.edge.card) && n(z.edge.card.total[1]) === n(z.edge.cell) && z.edge.card.rows[0][1] === z.edge.proj && z.edge.card.head.startsWith(z.edge.name),
      'room: Edge is his projection less the league average at the slot', z.edge);
    ok(z.man && z.man.head.startsWith(z.edge.name) && z.man.link === null, 'room: a name in the lineup opens his card');
    ok(z.heat.length === 10 && z.heat.every(Boolean) && /up/.test(z.heat[0]) && /dn/.test(z.heat[9]) && z.otherHeat === 0,
      'room: Starting lineup is on the scale across the ten teams, best green and worst red', z.heat);
    ok(z.team.card && z.team.card.rows.length === 9 && adds(z.team.card) && Math.round(n(z.team.card.total[2])) === n(z.team.cell),
      'room: and opens that team’s nine starters, which come to it', z.team);
    ok(z.team.card && /of 10 · league avg [\d.]+$/.test(z.team.card.foot), 'room: with where it stands', z.team.card && z.team.card.foot);
    ok(!/\bSD\b|z-score|standard dev|step \d of/i.test(JSON.stringify([v, r.pick, r.wait, z])), 'room: no card speaks of the scale’s workings');
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
    run.plain = f;

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
    // NO VALUE LINES for this league (the stub hands none): nothing of Value is drawn.
    eq([f.totalRow, /drafted again today/.test(f.note), /smoothed|Expected value/.test(f.note)], [null, true, false], 'live, no lines: no row of totals, and the place-based words');

    // THE PREVIEW.
    const top = want.byId.get(f.table[0].pid);
    eq(r.pop && r.pop.cls, 'tipcard statcard', 'live: a number opens its preview as the shared stat card');
    eq(r.cardsMeta, { oldPop: false, titles: 0, goNames: 0 }, 'live: no popover of the page’s own, no `title` beside a card, every name follows a click');
    ok(r.pop && /^(Highest|Lowest|\d+(st|nd|rd|th) (highest|lowest)) of 170 picks$/.test(r.pop.foot), 'live: and says where the difference stands among the 170 picks', r.pop && r.pop.foot);
    eq([r.whyWent, r.pop && r.pop.close], ['', false], 'live: a mouse’s card has no Close and a click on the number goes nowhere');
    eq(r.sheet && [r.sheet.cls, r.sheet.rows, r.sheet.close, r.sheet.link], ['tipcard statcard sheet', r.pop && r.pop.rows, true, null], 'live: a finger gets the same rows as a sheet with a Close');

    // THE CONNECTORS.
    eq(r.nameWent, `waivers.html?player=${r.namePid}`, 'live: a click on a name goes to him on Players');
    const t3 = R.teamReview(want.rv.rows, 3);
    const short = (x) => x.name.replace(/^(\S)\S*\s+/, '$1. ');
    eq(r.headCard && [r.headCard.head, r.headCard.rows.map((x) => x[0].replace(/^(Avg).*/, '$1'))],
      [nameOfTeam(3), ['Record', 'Avg', 'Week 5 proj', `Best steal${short(t3.steal)}`, `Biggest miss${short(t3.miss)}`]],
      'live: a team’s heading opens its card — record, average, this week, its best steal and biggest miss');
    eq(r.headCard && r.headCard.rows.slice(3).map((x) => x[1]), [signed(t3.steal.diff), signed(t3.miss.diff)], 'live: with those two differences');
    eq([r.headFirst, r.headPicked, Boolean(r.headStill)], ['', '3', true], 'live: a click on a heading picks that team, and its card stays');
    eq(r.headSecond, 'analysis.html?team=3#rosterDetail', 'live: a click on the team already picked goes to its roster on Analysis');
    eq([r.sheetPicked, r.headSheet && r.headSheet.link], ['5', ['Open roster →', 'analysis.html?team=5#rosterDetail']], 'live: a tap picks the team and its sheet carries the link');
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

// ----------------------------------------------- against the preseason rank
// Tim, 2026-10-08: "show where they were drafted relative to where they were
// ranked at the start of the season … if Jahmar gibbs was drafted 5th, then his
// number should show +4, because he was ranked #1".
{
  const r = run('pre');
  ok(!r.boot, 'pre: boots', r.boot);
  if (!r.boot) {
    const RK = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-ranks-1241838-2026.json'), 'utf8')).ranks;
    const draft = R.parseDraft(RAW);
    const base = expected(RAW);
    const players = new Map(base.rv.rows.map((x) => [x.playerId, { name: x.name, position: x.position, soFar: x.soFar, rest: x.rest, total: x.total }]));
    const rv = R.reviewDraft({ draft, players, slots: [0, 2, 2, 4, 4, 4, 6, 16, 17, 23], teams: 10, ranks: RK });
    const byId = new Map(rv.rows.map((x) => [String(x.playerId), x]));
    ok(r.ok, 'pre: settles on the league');
    eq(r.errors, [], 'pre: no errors');
    eq(r.fetches, [], 'pre: nothing went to ESPN around the stubs');
    eq([r.swNow, r.swPre], [{ hidden: false, on: ['now'] }, { hidden: false, on: ['pre'] }], 'pre: the switch opens on worth now and moves');
    eq([r.cold.ranks, r.cold.rankIds, r.keptRanks], [1, 170, 170], 'pre: the ranks are read once, for the 170 drafted, and kept');
    eq([r.afterSwitch.ranks, r.warm.ranks, r.warm.draft], [1, 1, 1], 'pre: the switch asks ESPN for nothing, and neither does coming back');
    eq(r.now.cells.map((c) => c.d), [...r.now.cells].map((c) => signed(base.byId.get(c.pid).diff)), 'pre: before the switch the board is on worth now');

    const wrong = r.pre.cells.filter((c) => c.d !== signed(byId.get(c.pid).preDiff));
    eq(wrong.slice(0, 3), [], 'pre: every cell of the board is drafted-at less the preseason place');
    eq(r.pre.cells.map((c) => [c.pid, c.went]), r.now.cells.map((c) => [c.pid, c.went]), 'pre: the same men in the same places at the same prices');
    ok(r.pre.cells.some((c, i) => c.d !== r.now.cells[i].d), 'pre: and the numbers did change');
    const gibbs = rv.rows.find((x) => x.name === 'Jahmyr Gibbs');
    const cell = r.pre.cells.find((c) => c.pid === String(gibbs.playerId));
    eq([gibbs.pre, cell && cell.d], [1, signed(gibbs.at - 1)], 'pre: Gibbs, ranked 1, shows where he went less one');
    ok(new Set(r.pre.cells.map((c) => c.heat)).size >= 5 && r.pre.cells.every((c) => c.heat), 'pre: on the heat scale, in several steps');

    const t8 = R.teamReview(rv.rows, 8, 'preDiff');
    eq(r.pre.tableHeads, ['Player', 'Paid', 'Rank', 'Pre', '+/−'], 'pre: the column is Pre');
    eq(r.now.tableHeads, ['Player', 'Paid', 'Rank', 'Now', '+/−'], 'pre: and was Now');
    const rowWrong = r.pre.table.filter((t) => {
      const w = byId.get(t.pid);
      return t.cells[2] !== String(w.at) || t.cells[3] !== String(w.pre) || t.cells[4] !== signed(w.preDiff);
    });
    eq(rowWrong, [], 'pre: every row’s rank, preseason place and difference');
    eq(r.pre.tiles.map((t) => [t.k, t.v, t.pid]), [
      ['Biggest slide', signed(t8.steal.preDiff), String(t8.steal.playerId)],
      ['Biggest reach', signed(t8.miss.preDiff), String(t8.miss.playerId)],
    ], 'pre: the two tiles are the team’s ends on this difference');
    ok(/ESPN ranked/.test(r.pre.note) && !/drafted again today/.test(r.pre.note), 'pre: how it works explains Pre, not Now', r.pre.note);
    run.plainPreNote = r.pre.note;

    const top = byId.get(r.popPid);
    eq(r.pop && r.pop.rows, [
      ['Paid', `$${top.bid}`], ['Price rank', String(top.at)], ...(top.keeper ? [['Keeper', 'Yes']] : []),
      ['ESPN preseason rank', String(top.espnRank)], ['Among players drafted', String(top.pre)],
      [top.preDiff > 0 ? 'Later than ranked' : top.preDiff < 0 ? 'Earlier than ranked' : 'As ranked', signed(top.preDiff)],
    ], 'pre: a number opens what it is made of — paid, price rank, ESPN’s rank, the place, the difference');
    ok(r.pop && /of 170 picks$/.test(r.pop.foot), 'pre: and where it stands among the 170', r.pop && r.pop.foot);
    const t3 = R.teamReview(rv.rows, 3, 'preDiff');
    eq(r.headCard && r.headCard.rows.slice(3).map((x) => [x[0].replace(/^(Biggest (?:slide|reach)).*/, '$1'), x[1]]),
      [['Biggest slide', signed(t3.steal.preDiff)], ['Biggest reach', signed(t3.miss.preDiff)]], 'pre: a team’s card carries its two ends on this difference');

    eq(r.prefsPre['draft.compare'], 'pre', 'pre: the view is remembered');
    ok(r.sample.cells.length === 160 && r.sample.cells.every((c) => /^[+−]?\d+$/.test(c.d)), 'pre: the sample has preseason ranks of its own');
    eq(r.again.cells.map((c) => c.d), r.pre.cells.map((c) => c.d), 'pre: back on the league, still against the preseason rank');
    eq(r.back.cells.map((c) => c.d), r.now.cells.map((c) => c.d), 'pre: and the switch goes back to worth now');
    eq(r.prefsBack['draft.compare'], undefined, 'pre: which is not stored, being the default');
  }
}

// ------------------------------------------------- vs worth now, on Value
// Tim, 2026-10-09: "Instead of basing the "vs worth now" on position in the
// draft, base it off of their current value - their expected value based on
// their rank in the draft. … Additionally I want you to display the total value
// of all the player's that that user drafted at the top as a row above the
// first round picks below their name."
{
  const VAL = await import('./draft-stub-value.mjs');
  const RK = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-ranks-1241838-2026.json'), 'utf8')).ranks;
  const plain = expected(RAW);
  const draft = R.parseDraft(RAW);
  const players = new Map(plain.rv.rows.map((x) => [x.playerId, { name: x.name, position: x.position, soFar: x.soFar, rest: x.rest, total: x.total }]));
  const rv = R.reviewDraft({ draft, players, slots: [0, 2, 2, 4, 4, 4, 6, 16, 17, 23], teams: 10, ranks: RK, worth: VAL.WORTH });
  const byId = new Map(rv.rows.map((x) => [String(x.playerId), x]));
  const totals = R.teamValues(rv.rows);
  const achane = rv.rows.find((x) => x.name === "De'Von Achane");
  const gibbs = rv.rows.find((x) => x.name === 'Jahmyr Gibbs');
  const r = run('value', { FF_VALUE: JSON.stringify(VAL.VALUES), DR_CARDS: `${gibbs.playerId},${achane.playerId}` });
  ok(!r.boot, 'value: boots', r.boot);
  if (!r.boot) {
    const f = r.first;
    ok(r.ok, 'value: settles on the league');
    eq([r.errors, r.fetches], [[], []], 'value: no errors, and nothing went to ESPN around the stubs');
    eq([r.cold.draft, r.cold.players, r.cold.ranks], [1, 17, 1], 'value: it asks ESPN for no more than the page did before');
    ok(!(String(achane.playerId) in VAL.VALUES.players) && String(gibbs.playerId) in VAL.VALUES.players, 'value: (Achane is on nobody’s squad, so the league’s figures do not have him; Gibbs is)');

    // THE BOARD: every difference is his Value today less the line at his price's rank.
    eq(f.cells.length, 170, 'value: 170 picks on the board');
    eq(f.cells.filter((c) => c.d !== sv(byId.get(c.pid).valueDiff)).slice(0, 3), [], 'value: every cell’s difference, to the tenth');
    eq(f.cells.map((c) => [c.pid, c.went]), run.plain.cells.map((c) => [c.pid, c.went]), 'value: the same men in the same places at the same prices');
    ok(f.cells.some((c, i) => c.d !== run.plain.cells[i].d), 'value: and the numbers are not the place-based ones');
    ok(new Set(f.cells.map((c) => c.heat)).size >= 5 && f.cells.every((c) => c.heat), 'value: on the heat scale, in several steps');
    const ach = f.cells.find((c) => c.pid === String(achane.playerId));
    eq([ach.went, ach.d, ach.heat], ['$44 RB', sv(achane.valueDiff), 'heat-dn-4'], 'value: Achane, $44 and dropped, is the bottom of the scale');
    ok(achane.valueNow === 0 && achane.valueDiff < -5, 'value: (worth nothing now against about seven expected)', [achane.expected, achane.valueNow]);

    // THE ROW OF TOTALS, between the headings and round one.
    const tot = f.totalRow;
    eq(tot && [tot.index, tot.label], [0, 'Value'], 'value: the totals are the first row under the team names');
    eq(f.boardRows, 18, 'value: one row more than the seventeen rounds');
    eq(tot && tot.cells.map((c) => [c.team, c.v]), draft.order.map((id) => [String(id), totals.get(id).toFixed(1)]), 'value: each team’s total is the Value today of the seventeen men it drafted');
    eq(f.cells.slice(0, 10).map((c) => c.team), draft.order.map(String), 'value: and round one comes straight after it');
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const heatOfTeam = (id) => tot.cells.find((c) => c.team === String(id)).heat;
    ok(/^heat-up/.test(heatOfTeam(sorted[0][0])) && /^heat-dn/.test(heatOfTeam(sorted[9][0])), 'value: the best total is green and the worst red', tot.cells.map((c) => c.heat).join(' '));
    eq([tot.cells.filter((c) => c.mine).map((c) => c.team), f.mineCells], [['8'], 18], 'value: the picked team’s mark runs through its total');

    // THE TEAM.
    const t8 = R.teamReview(rv.rows, 8, 'valueDiff');
    eq(f.tableHeads, ['Player', 'Paid', 'Rank', 'Now', '+/−'], 'value: the same columns');
    const rowWrong = f.table.filter((t) => {
      const w = byId.get(t.pid);
      return t.cells[1] !== `$${w.bid}` || t.cells[2] !== String(w.at) || t.cells[3] !== w.valueNow.toFixed(1) || t.cells[4] !== sv(w.valueDiff);
    });
    eq([f.table.length, rowWrong], [17, []], 'value: every row’s price, rank, Value today and difference');
    eq(f.tiles.map((t) => [t.k, t.v, t.pid]), [
      ['Best steal', sv(t8.steal.valueDiff), String(t8.steal.playerId)],
      ['Biggest miss', sv(t8.miss.valueDiff), String(t8.miss.playerId)],
    ], 'value: the two tiles are the team’s ends on this difference');
    const t7 = R.teamReview(rv.rows, 7, 'valueDiff');
    eq(r.seven.tiles.map((t) => t.pid), [String(t7.steal.playerId), String(t7.miss.playerId)], 'value: another team’s own two');
    eq(r.seven.cells, f.cells, 'value: and the board does not change');

    // THE PREVIEW adds up: expected, today, the difference.
    const top = byId.get(r.popPid);
    eq(r.pop && r.pop.rows, [
      ['Paid', `$${top.bid}`], ['Price rank', String(top.at)], ...(top.keeper ? [['Keeper', 'Yes']] : []),
      ['Expected value', top.expected.toFixed(1)], ['Value now', top.valueNow.toFixed(1)],
      [top.valueDiff > 0 ? 'Steal' : top.valueDiff < 0 ? 'Miss' : 'Even', sv(top.valueDiff)],
    ], 'value: a number opens paid, price rank, expected value, value now and the difference');
    ok(r.pop && /of 170 picks$/.test(r.pop.foot), 'value: and where it stands among the 170', r.pop && r.pop.foot);
    const t3 = R.teamReview(rv.rows, 3, 'valueDiff');
    eq(r.headCard && r.headCard.rows.slice(3).map((x) => [x[0].replace(/^(Best steal|Biggest miss).*/, '$1'), x[1]]),
      [['Best steal', sv(t3.steal.valueDiff)], ['Biggest miss', sv(t3.miss.valueDiff)]], 'value: a team’s card carries its two ends on Value');
    ok(/smoothed line/.test(f.note) && /read at his price rank/.test(f.note) && /Rank/.test(f.note) && !/drafted again today/.test(f.note), 'value: how it works explains the line, and the auction’s Rank', f.note);

    // THE CARDS: a man on a squad is looked up; a man nobody holds is handed in.
    eq(r.cards, { [gibbs.playerId]: `Value ${gibbs.valueNow.toFixed(1)}`, [achane.playerId]: 'Value 0.0' }, 'value: a player’s card opens with his Value, held or dropped');

    // THE OTHER VIEW is the one it was, with the totals still over it.
    eq(r.pre.cells.filter((c) => c.d !== signed(byId.get(c.pid).preDiff)).slice(0, 3), [], 'value: "vs preseason rank" is still drafted-at less the preseason place');
    eq([r.pre.tableHeads, r.pre.tiles.map((t) => t.k)], [['Player', 'Paid', 'Rank', 'Pre', '+/−'], ['Biggest slide', 'Biggest reach']], 'value: with its own column and tiles');
    ok(/ESPN ranked/.test(r.pre.note) && !/smoothed/.test(r.pre.note), 'value: and its own words');
    // ITS ROW OF TOTALS adds up each man's OWN preseason Value (Tim, 2026-10-09:
    // "for the "vs preseason rank" setting, put the value at the top … as what
    // it was proj to be based on preseason predictions (which is different than
    // the preseason expected value we talked about before)").
    const VV = await import(moduleUrl('js/value.js'));
    const preTotals = R.teamValues(rv.rows, 'valuePre');
    const byHand = (id) => Math.round(rv.rows.filter((x) => x.teamId === id)
      .reduce((a, x) => a + (VAL.BASE.lines[x.position] ? VV.valueOf(VAL.BASE, x.position, VAL.preOf(x.playerId)) ?? 0 : 0), 0) * 10) / 10;
    const pt = r.pre.totalRow;
    eq(pt && [pt.index, pt.label], [0, 'Value'], 'value, pre: the row of totals stays where it was, under the same label');
    eq(pt && pt.cells.map((c) => [c.team, c.v]), draft.order.map((id) => [String(id), byHand(id).toFixed(1)]),
      'value, pre: each team’s total is the sum of its seventeen men’s own preseason Values');
    eq(draft.order.map((id) => preTotals.get(id)), draft.order.map(byHand), 'value, pre: (which is what js/draft-review.js adds up)');
    ok(pt && pt.cells.every((c, i) => c.v !== tot.cells[i].v), 'value, pre: and every one differs from the total today', pt && pt.cells.map((c) => c.v).join(' '));
    const lineSum = (id) => Math.round(rv.rows.filter((x) => x.teamId === id).reduce((a, x) => a + x.expected, 0) * 10) / 10;
    ok(pt && pt.cells.some((c) => c.v !== lineSum(Number(c.team)).toFixed(1)), 'value, pre: nor is it the smoothed line’s expected value added up');
    const preSorted = [...preTotals.entries()].sort((a, b) => b[1] - a[1]);
    const preHeat = (id) => pt.cells.find((c) => c.team === String(id)).heat;
    ok(pt && /^heat-up/.test(preHeat(preSorted[0][0])) && /^heat-dn/.test(preHeat(preSorted[9][0])), 'value, pre: coloured on the totals shown — the best preseason total green, the worst red', pt && pt.cells.map((c) => c.heat).join(' '));
    ok(preSorted[0][0] !== sorted[0][0] || preSorted[9][0] !== sorted[9][0], 'value, pre: (the two rankings of teams are not the same one)');
    ok(/Value on the board adds up each drafted player’s preseason Value\./.test(r.pre.note), 'value, pre: how it works says what the row adds up', r.pre.note);
    ok(run.plainPreNote && !/preseason Value/.test(run.plainPreNote), 'value, pre: and says nothing of it for a league with no lines');
    const ptop = byId.get(r.prePopPid);
    eq(r.prePop && r.prePop.rows, [
      ['Paid', `$${ptop.bid}`], ['Price rank', String(ptop.at)], ...(ptop.keeper ? [['Keeper', 'Yes']] : []),
      ['ESPN preseason rank', String(ptop.espnRank)], ['Among players drafted', String(ptop.pre)],
      ['Preseason value', ptop.valuePre.toFixed(1)],
      [ptop.preDiff > 0 ? 'Later than ranked' : ptop.preDiff < 0 ? 'Earlier than ranked' : 'As ranked', signed(ptop.preDiff)],
    ], 'value, pre: a number’s preview carries his own preseason Value');
    eq([r.back.cells, r.back.totalRow], [f.cells, tot], 'value: and the switch comes back to Value, its totals with it');
  }
}

// ------------------------------------------- the four views of the switch
// Tim, 2026-10-09: "Could you also add a expected value and value now tab in
// the draft room along with the vs worth now and vs preseason rank tabs? Also
// rename the worth now tab to value difference and the vs preseason rank to
// rank difference."
{
  const VAL = await import('./draft-stub-value.mjs');
  const H = await import(moduleUrl('js/heat.js'));
  const RK = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-ranks-1241838-2026.json'), 'utf8')).ranks;
  const plain = expected(RAW);
  const draft = R.parseDraft(RAW);
  const players = new Map(plain.rv.rows.map((x) => [x.playerId, { name: x.name, position: x.position, soFar: x.soFar, rest: x.rest, total: x.total }]));
  const rv = R.reviewDraft({ draft, players, slots: [0, 2, 2, 4, 4, 4, 6, 16, 17, 23], teams: 10, ranks: RK, worth: VAL.WORTH });
  const byId = new Map(rv.rows.map((x) => [String(x.playerId), x]));
  const gibbs = rv.rows.find((x) => x.name === 'Jahmyr Gibbs');
  const FOUR = [['now', 'Value difference'], ['exp', 'Expected value'], ['val', 'Value now'], ['pre', 'Rank difference']];
  const ENV = { FF_VALUE: JSON.stringify(VAL.VALUES) };
  /** A team's sum of one figure, added up here pick by pick. */
  const sumOf = (id, key) => (Math.round(rv.rows.filter((x) => x.teamId === id).reduce((a, x) => a + x[key], 0) * 10) / 10).toFixed(1);
  const heatWant = (key) => {
    const scale = H.heatScale(rv.rows.map((x) => x[key]));
    return (pid) => (H.heatOf(byId.get(pid)[key], scale).cls.match(/heat-(?:up|dn)-\d|heat-0/) || [''])[0];
  };

  const r = run('views', ENV);
  ok(!r.boot, 'views: boots', r.boot);
  if (!r.boot) {
    ok(r.ok, 'views: settles on the league');
    eq([r.errors, r.fetches], [[], []], 'views: no errors, and nothing went to ESPN around the stubs');
    eq(r.opened.compare.labels, FOUR.map(([k, said]) => [k, said, false]), 'views: four tabs — Value difference, Expected value, Value now, Rank difference');
    eq([r.opened.compare.on, r.opened.cells.filter((c) => c.d !== sv(byId.get(c.pid).valueDiff)).slice(0, 3)], [['now'], []], 'views: it opens on Value difference, as it did');
    eq([r.calls.draft, r.calls.ranks], [1, 1], 'views: and no tab asks ESPN for anything');

    // EACH NEW VIEW: one figure, on the board, in its totals, in the team's table and tiles.
    const VIEW = [
      ['exp', r.exp, 'expected', 'valueNow', ['Player', 'Paid', 'Rank', 'Now', 'Expected'], r.expHead],
      ['val', r.val, 'valueNow', 'expected', ['Player', 'Paid', 'Rank', 'Expected', 'Now'], r.valHead],
    ];
    for (const [k, v, key, other, heads, headCard] of VIEW) {
      const f = v.page;
      ok(v.there, `${k}: the tab is on the switch`);
      eq([f.compare.on, v.pref], [[k], k], `${k}: it lights, and is remembered`);
      eq([f.cells.length, f.cells.filter((c) => c.d !== byId.get(c.pid)[key].toFixed(1)).slice(0, 3)], [170, []], `${k}: every cell of the board is his ${key}, one decimal, unsigned`);
      const g = f.cells.find((c) => c.pid === String(gibbs.playerId));
      eq(g && g.d, gibbs[key].toFixed(1), `${k}: Gibbs’s cell prints his ${key}`);
      eq(f.cells.map((c) => [c.pid, c.went]), r.opened.cells.map((c) => [c.pid, c.went]), `${k}: the same men in the same places at the same prices`);
      const want = heatWant(key);
      eq(f.cells.filter((c) => c.heat !== want(c.pid)).slice(0, 3), [], `${k}: every cell is coloured on the figure shown, against every pick`);
      ok(f.cells.some((c, i) => c.heat !== r.opened.cells[i].heat), `${k}: which is not the colour its difference had`);
      const tot = f.totalRow;
      eq(tot && [tot.index, tot.label], [0, 'Value'], `${k}: the totals stay the first row, under the same label`);
      eq(tot && tot.cells.map((c) => [c.team, c.v]), draft.order.map((id) => [String(id), sumOf(id, key)]), `${k}: each team’s total is the sum of the ${key} shown under it`);
      const ranked = draft.order.map((id) => [id, Number(sumOf(id, key))]).sort((a, b) => b[1] - a[1]);
      const heatOfTeam = (id) => tot.cells.find((c) => c.team === String(id)).heat;
      ok(tot && /^heat-up/.test(heatOfTeam(ranked[0][0])) && /^heat-dn/.test(heatOfTeam(ranked[9][0])), `${k}: the best total green and the worst red`, tot && tot.cells.map((c) => c.heat).join(' '));

      // THE TEAM: the pair of figures, the one shown last and sorted on, high to low.
      eq([f.tableHeads, f.sorted], [heads, [heads[4]]], `${k}: the table keeps its columns, its last under “${heads[4]}” and sorted on`);
      const rowWrong = f.table.filter((t) => {
        const w = byId.get(t.pid);
        return t.cells[1] !== `$${w.bid}` || t.cells[2] !== String(w.at) || t.cells[3] !== w[other].toFixed(1) || t.cells[4] !== w[key].toFixed(1);
      });
      eq([f.table.length, rowWrong], [17, []], `${k}: every row’s price, rank, ${other} and ${key}`);
      const shown = f.table.map((t) => Number(t.cells[4]));
      ok(shown.every((n, i) => i === 0 || shown[i - 1] >= n), `${k}: highest first`, shown.join(' '));
      const mine = rv.rows.filter((x) => x.teamId === 8);
      const hi = Math.max(...mine.map((x) => x[key]));
      const lo = Math.min(...mine.map((x) => x[key]));
      eq(f.tiles.map((t) => [t.k, t.v]), [['Highest', hi.toFixed(1)], ['Lowest', lo.toFixed(1)]], `${k}: the two tiles are the team’s highest and lowest`);
      ok(f.tiles.every((t, i) => byId.get(t.pid).teamId === 8 && byId.get(t.pid)[key] === [hi, lo][i]), `${k}: each naming a man of its own who has that figure`, f.tiles.map((t) => t.pid));
      const three = rv.rows.filter((x) => x.teamId === 3).map((x) => x[key]);
      eq(headCard && headCard.rows.slice(3).map((x) => [x[0].replace(/^(Highest|Lowest).*/, '$1'), x[1]]),
        [['Highest', Math.max(...three).toFixed(1)], ['Lowest', Math.min(...three).toFixed(1)]], `${k}: a team’s card carries the same two ends`);
      ok(/smoothed line/.test(f.note) && /Value today/.test(f.note) && !/Above zero/.test(f.note), `${k}: how it works explains both figures and no difference`, f.note);
    }
    ok(/Value on the board adds up expected value for every player a team drafted\./.test(r.exp.page.note), 'exp: how it works says what its totals add up', r.exp.page.note);
    ok(/Value on the board adds up Now for every player a team drafted\./.test(r.val.page.note), 'val: and so does Value now', r.val.page.note);
    ok(r.exp.page.cells.some((c, i) => c.d !== r.val.page.cells[i].d) && r.exp.page.totalRow.cells.every((c, i) => c.v !== r.val.page.totalRow.cells[i].v), 'views: (the two new views are not the same numbers)');

    // THE PREVIEW still explains the difference: it is what joins the three Value views.
    const top = byId.get(r.expPopPid);
    eq(r.expPop && r.expPop.rows, [
      ['Paid', `$${top.bid}`], ['Price rank', String(top.at)], ...(top.keeper ? [['Keeper', 'Yes']] : []),
      ['Expected value', top.expected.toFixed(1)], ['Value now', top.valueNow.toFixed(1)],
      [top.valueDiff > 0 ? 'Steal' : top.valueDiff < 0 ? 'Miss' : 'Even', sv(top.valueDiff)],
    ], 'exp: a number opens paid, price rank, expected value, value now and the difference');

    // THE TWO OLD VIEWS, under their new names.
    eq([r.pre.page.compare.on, r.pre.pref], [['pre'], 'pre'], 'views: Rank difference is stored as it always was');
    eq(r.pre.page.cells.filter((c) => c.d !== signed(byId.get(c.pid).preDiff)).slice(0, 3), [], 'views: and is still drafted-at less the preseason place');
    eq([r.pre.page.tableHeads, r.pre.page.tiles.map((t) => t.k)], [['Player', 'Paid', 'Rank', 'Pre', '+/−'], ['Biggest slide', 'Biggest reach']], 'views: with its own column and tiles');
    eq([r.back.page.compare.on, r.back.pref], [['now'], undefined], 'views: Value difference is not stored, being the default');
    eq([r.back.page.cells, r.back.page.totalRow, r.back.page.table, r.back.page.tiles, r.back.page.tableHeads, r.back.page.note],
      [r.opened.cells, r.opened.totalRow, r.opened.table, r.opened.tiles, ['Player', 'Paid', 'Rank', 'Now', '+/−'], r.opened.note], 'views: and comes back exactly as it opened');
  }

  // REMEMBERED: a page opened with a choice stored — a new one, and the old 'pre'.
  const ke = run('views', { ...ENV, DR_COMPARE: 'exp' });
  ok(!ke.boot, 'views, kept exp: boots', ke.boot);
  if (!ke.boot) {
    eq([ke.ok, ke.errors, ke.opened.compare.on], [true, [], ['exp']], 'views, kept: a page opened with Expected value stored opens on it');
    eq(ke.opened.cells.filter((c) => c.d !== byId.get(c.pid).expected.toFixed(1)).slice(0, 3), [], 'views, kept: every cell his expected value');
  }
  const kp = run('views', { ...ENV, DR_COMPARE: 'pre' });
  ok(!kp.boot, 'views, kept pre: boots', kp.boot);
  if (!kp.boot) {
    eq([kp.ok, kp.errors, kp.opened.compare.on], [true, [], ['pre']], 'views, kept: the old stored “pre” still lands on Rank difference');
    eq(kp.opened.cells.filter((c) => c.d !== signed(byId.get(c.pid).preDiff)).slice(0, 3), [], 'views, kept: with its numbers');
  }

  // NO LINES (no FF_VALUE): the two new tabs have nothing to show.
  for (const stored of ['val', 'exp']) {
    const n = run('views', { DR_COMPARE: stored });
    ok(!n.boot, `views, no lines (${stored}): boots`, n.boot);
    if (n.boot) continue;
    eq([n.ok, n.errors], [true, []], `views, no lines (${stored}): settles without an error`);
    eq(n.opened.compare.labels, [['now', 'Value difference', false], ['exp', 'Expected value', true], ['val', 'Value now', true], ['pre', 'Rank difference', false]],
      `views, no lines (${stored}): the two new tabs are hidden`);
    eq(n.opened.compare.on, ['now'], `views, no lines (${stored}): a stored new view falls back to Value difference`);
    eq([n.opened.cells.length, n.opened.cells.filter((c) => c.d !== signed(plain.byId.get(c.pid).diff)).slice(0, 3), n.opened.totalRow],
      [170, [], null], `views, no lines (${stored}): which is the place-based board it was, with no totals`);
    eq([n.opened.tableHeads, n.opened.tiles.map((t) => t.k)], [['Player', 'Paid', 'Rank', 'Now', '+/−'], ['Best steal', 'Biggest miss']], `views, no lines (${stored}): its table and tiles too`);
  }

  // THE BOARD AT ITS FULL HEIGHT (Tim, 2026-10-09: "extend the draft board down
  // so you don't have to scroll in the box itself"). There is no layout here,
  // so this reads the stylesheet: the board's own box must lift the height cap
  // every other `.table-scroll` has, by a rule no phone rule can outrank.
  if (!r.boot) {
    eq(r.opened.boardBox, ['table-scroll', 'panelBoard'], 'board: it sits in the board panel’s own scroll box');
    const css = readFileSync(path.join(REPO, 'css/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
    const lifts = rules.filter(([sel, body]) => sel.split(',').some((s) => /^#panelBoard\s+\.table-scroll$/.test(s.trim())) && /max-height:\s*none/.test(body));
    ok(lifts.length >= 1, 'board: that box has no height cap, so every round is on the page and nothing scrolls up and down inside it', lifts.length);
    const caps = rules.filter(([sel, body]) => /#panelBoard|\.dr-board|#draftBoard/.test(sel) && /max-height:(?!\s*none)/.test(body));
    eq(caps.map(([sel]) => sel), [], 'board: and no other rule of the board’s puts one back');
  }
}

// ------------------------------------------------- drafted, or owned now
// Tim, 2026-10-09: "In the draft room right now there's a white highlighted box
// around the players you drafted which is just one column. Could you make a
// switch that instead boxes all the players that you currently own. Nothing
// else changes except the white boarders the highlight the players."
{
  const VAL = await import('./draft-stub-value.mjs');
  const draft = R.parseDraft(RAW);
  const draftedBy = (id) => draft.picks.filter((p) => p.teamId === id).map((p) => String(p.playerId));
  const ownedBy = (id) => draft.picks.filter((p) => FX.players[p.playerId] && FX.players[p.playerId].onTeamId === id).map((p) => String(p.playerId));
  const sortS = (a) => [...a].sort();
  const r = run('own', { FF_VALUE: JSON.stringify(VAL.VALUES) });
  ok(!r.boot, 'own: boots', r.boot);
  if (!r.boot) {
    const d = r.drafted;
    const o = r.own;
    ok(r.ok, 'own: settles on the league');
    eq([r.errors, r.fetches], [[], []], 'own: no errors, and nothing went to ESPN around the stubs');
    // (The fixture is the real league: team 3 drafted 17, holds 12 of them and one man another team drafted.)
    const mine3 = draftedBy(3);
    const own3 = ownedBy(3);
    const got = own3.filter((pid) => !mine3.includes(pid));
    const gone = mine3.filter((pid) => !own3.includes(pid));
    const dropped = gone.filter((pid) => !(FX.players[pid].onTeamId > 0));
    eq([mine3.length, own3.length, got.length, gone.length, dropped.length], [17, 13, 1, 5, 3], 'own: (team 3 — 17 drafted, 13 of the drafted held now, one of them another team’s pick, five of its own gone, three of those dropped)');

    // DEFAULT: the column, exactly as before.
    eq(d.box, { hidden: false, labels: [['drafted', 'Drafted'], ['own', 'Own now']], on: ['drafted'] }, 'own: the switch is on the page, on Drafted');
    eq([d.team, d.mineHead, d.mineTeams, d.mineCells], ['3', ['3'], ['3'], 18], 'own, Drafted: the team’s column is boxed as it was — its total and seventeen rounds');
    eq([d.ownPids, d.ownOther, d.boardOwn], [[], 0, false], 'own, Drafted: and no cell is boxed on its own');

    // OWN NOW: the men on its squad today, wherever they were drafted.
    eq(o.box.on, ['own'], 'own: the switch moves');
    eq(sortS(o.ownPids), sortS(own3), 'own, Own now: exactly the thirteen men on team 3’s squad today are boxed');
    ok(got.every((pid) => o.ownPids.includes(pid)) && o.cells.find((c) => c.pid === got[0]).team !== '3', 'own, Own now: the man another team drafted among them, in that team’s column', got);
    ok(gone.every((pid) => !o.ownPids.includes(pid)), 'own, Own now: and not the three it dropped nor the two now on other squads', gone);
    eq([o.mineCells, o.mineTeams, o.ownOther, o.boardOwn], [0, [], 0, true], 'own, Own now: the column is not boxed, nor its total, nor an empty cell');
    eq([o.mineHead, o.team], [['3'], '3'], 'own, Own now: the team’s heading keeps its mark, and it is still the team picked');
    // NOTHING ELSE CHANGES.
    eq(o.cells, d.cells, 'own: every cell’s text and colour is the same in the two states');
    eq(o.boardHtml === d.boardHtml, true, 'own: the board is the same board to the letter, the box classes apart');
    eq([o.totalRow.cells.map((c) => [c.team, c.v, c.heat]), o.table, o.tiles, o.note, o.sub],
      [d.totalRow.cells.map((c) => [c.team, c.v, c.heat]), d.table, d.tiles, d.note, d.sub], 'own: the totals, the team’s table, its tiles and the words are untouched');
    eq([r.afterSwitch, r.warm.draft, r.warm.players, r.warm.ranks], [r.cold, r.cold.draft, r.cold.players, r.cold.ranks], 'own: the switch asks nothing of anybody, and nor does the rest');
    eq(r.prefsOwn['draft.box'], 'own', 'own: the choice is remembered');

    // ANOTHER TEAM: the boxes follow it.
    eq([r.one.team, sortS(r.one.ownPids), r.one.mineCells, r.one.mineHead], ['1', sortS(ownedBy(1)), 0, ['1']], 'own: picking team 1 boxes its men instead');
    eq(r.one.cells, d.cells, 'own: and the board does not change');
    eq([r.three.team, sortS(r.three.ownPids)], ['3', sortS(own3)], 'own: a heading on the board picks its team, boxes and all');
    eq([sortS(r.pre.ownPids), r.pre.mineCells, r.pre.box.on], [sortS(own3), 0, ['own']], 'own: the other comparison redraws the board with the same men boxed');
    // (The sample's squads change hands too: by week 14 a team holds some of its sixteen picks, not all.)
    ok(r.sample.box.on[0] === 'own' && r.sample.ownPids.length > 0 && r.sample.ownPids.length < 16 && r.sample.mineCells === 0,
      'own: on the sample, the men its picked team still holds', [r.sample.box.on, r.sample.ownPids.length, r.sample.mineCells]);
    eq([sortS(r.again.ownPids), r.again.box.on, r.again.mineCells], [sortS(own3), ['own'], 0], 'own: and back on the league it is still Own now');
    eq([r.back.box.on, r.back.ownPids, r.back.mineCells, r.back.mineTeams, r.back.boardOwn], [['drafted'], [], 18, ['3'], false], 'own: Drafted puts the column’s box back');
    eq(r.prefsBack['draft.box'], undefined, 'own: which is not stored, being the default');
  }
  const k = run('ownKept', { FF_VALUE: JSON.stringify(VAL.VALUES) });
  ok(!k.boot, 'own, kept: boots', k.boot);
  if (!k.boot) {
    eq([k.ok, k.errors, k.page.box && k.page.box.on, sortS(k.page.ownPids), k.page.mineCells], [true, [], ['own'], sortS(ownedBy(3)), 0],
      'own, kept: a page opened with the choice stored opens on Own now');
  }
  const e = run('empty', { DR_EMPTY: '1' });
  ok(!e.boot, 'empty: boots', e.boot);
  if (!e.boot) {
    eq([e.ok, e.errors, e.page.status, e.page.mainHidden, e.compareHidden], [true, [], 'No draft yet.', true, true], 'empty: a league that has not drafted shows no draft');
    eq(e.page.box && e.page.box.hidden, true, 'empty: and no box switch');
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
