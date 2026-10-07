// THE DECISIONS REVIEW PAGE — decisions.html, booted headlessly on the stub
// league and worked the way a reader works it.
//
//   node decisions-check.mjs            every scenario (one child each)
//   node decisions-check.mjs --dump X   print child X's raw facts
//
// Tim, 2026-10-05: "have a list of all the decisions they've made, and what
// would have happened if they hadn't made that that decision ... the biggest
// thing I want to see is the act weekly total for that team each previous week,
// whether that would have changed the outcome of a matchup, and how much it
// would have changed the overall record."
//
// The league is tests/cap-stub-season.mjs's `fetchDecisionWorld` (three decided
// weeks, ten squads, DECISION_CASES). The numbers asserted are worked by hand
// from that world and written here as literals — the engine has its own suite
// (test-decisions.mjs); this one is about what the PAGE shows:
//
//   squad 1, the add+drop undone:  wk 1 114.9 -> 114.9, wk 2 111.1 -> 111.5,
//     wk 3 117.3 -> 115.5 (−1.4 in all); week 2's 111.1–111.1 tie with squad 2
//     becomes a win, so 1-1-1 reads 2-1.
//   squad 2, its add undone: the man never started, so nothing changes.
//   squad 3, its drop undone: squad 4's week-3 pickup of that man could not
//     have happened.
//
// THE WEEK IN PLAY (Tim, 2026-10-05: "Could you just display everything you're
// able to, like we do across the rest of the cite?") is the `early` child, on
// the stub's CAP_EARLY=1: week 4, squad 1 v squad 4 over (squad 1 lost it 118.3, a
// fourth result for each) and the other four matchups still being played.
//
// Tim again, 2026-10-05: "just show what you have right now, so if my bench QB
// scored 8 more than my starter, then my dif should show +8 ... just put a
// little "live" sign by the week number". That is the `bench` child
// (CAP_BENCH_QB=1: squad 1's bench QB finished 8.0 ahead of its starter, one
// bench man still to play), and `bench-all` is the same with nobody left to
// play — the same +8.0 and no live tag.
//
// Tim, 2026-10-05, later: "simplify the lineup button to just be a choice
// between 'perfect hindsight' or 'reasonable' and they select for all weeks,
// nothing else. Also add a button by the user selection that says 'all users'.
// This allows you to have all users to have done a reasonable lineup or perfect
// lineup and see the results." The two rows are checked wherever the list is;
// ALL USERS is the `all` child (and `all-early` on the week in play). Its hand
// numbers are squad 7's under "Reasonable", worked from the stub's rosters
// (projection, then score, of each man in and out):
//   wk 1  RB 710 (15.6) for RB 701 (10.6), WR 711 (14.6) for WR 705 (10.0):
//          92.0 − 8.0 − 5.6 + 10.1 + 14.8 = 103.3   v squad 4, a loss either way
//   wk 2  RB 710 for RB 701, WR 711 (10.3) for WR 703 (9.4), TE 713 (12.5) for
//         TE 706 (6.4): 98.4 − 6.8 − 7.2 − 7.1 + 9.5 + 6.6 + 13.9 = 107.3   v squad 6, a loss
//   wk 3  QB 712 (25.1) for QB 700 (17.9), RB 710 (19.6) for the FLEX RB 707 (11.7):
//          94.8 − 15.3 − 8.3 + 21.1 + 18.2 = 110.5   v squad 8
// so +35.9 in all. ALONE, squad 7 still beats squad 8's real 89.1 in week 3 and
// stays 1-2. With ALL USERS on, squad 8 has set its best projections too —
// QB 812 for 800 (+7.9), WR 811 for 804 (+7.6), TE 813 for 806 (+4.5), RB 810
// for the FLEX 807 (+2.2): 89.1 + 22.2 = 111.3 — and 110.5 loses to it: 0-3.
// The same points, a different record, because the opponent changed as well.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const html = (page) => readFileSync(path.join(REPO, page), 'utf8');
const CONN = { leagueId: '99', season: 2026, teamId: 1 };

function trapErrors() {
  const errors = [];
  console.error = (...a) => { errors.push(a.join(' ')); };
  process.on('unhandledRejection', (r) => errors.push(`unhandled: ${String((r && r.stack) || r)}`));
  return errors;
}

/**
 * A LEAGUE THAT SCORES IN HUNDREDTHS (DZ_CENTS), as Tim's own does: the stub's
 * world prints one decimal everywhere, so a table mixing "121.94" with "106.1"
 * could never show on it. One more loader hook, in front of cap-loader.mjs,
 * hands the page the stub with every man's score moved by 0.01–0.99 — the same
 * amount wherever that man's week is read (a squad, the players' own lines) —
 * and each squad's total and each matchup's score re-added from its starters.
 * The stub file itself is untouched.
 */
function scoreInCents() {
  const stub = new URL('./cap-stub-season.mjs', import.meta.url).href;
  const wrapper = `
    export * from ${JSON.stringify(stub)};
    import { fetchDecisionWorld as base } from ${JSON.stringify(stub)};
    const c2 = (n) => Math.round(n * 100) / 100;
    const odd = (id, w) => {
      let h = 7;
      for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
      return ((h + Number(w) * 11) % 99 + 1) / 100;
    };
    const bump = (id, w, v) => (Number.isFinite(v) ? c2(v + odd(id, w)) : v);
    export async function fetchDecisionWorld(o) {
      const world = await base(o);
      for (const [w, teams] of world.rosters) {
        for (const t of teams) {
          for (const p of t.players) p.actual = bump(p.playerId, w, p.actual);
          t.actualTotal = c2(t.starters.reduce((a, p) => a + (p.actual || 0), 0));
        }
      }
      for (const [id, who] of world.players) {
        for (const w of Object.keys(who.byWeek)) who.byWeek[w].actual = bump(id, w, who.byWeek[w].actual);
      }
      const total = (w, id) => world.rosters.get(w).find((t) => t.id === id).actualTotal;
      for (const g of world.games) {
        if (g.homeActual === null || g.awayActual === null) continue;
        g.homeActual = total(g.week, g.homeId);
        g.awayActual = total(g.week, g.awayId);
      }
      return world;
    }`;
  const hook = `
    const WRAPPER = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(wrapper)}`)};
    const TESTS = ${JSON.stringify(new URL('./', import.meta.url).href)};
    export async function resolve(spec, ctx, next) {
      const fromTests = ctx.parentURL && ctx.parentURL.startsWith(TESTS);
      if (spec.startsWith('.') && !fromTests && /\\/season\\.js$/.test(spec)) return { url: WRAPPER, shortCircuit: true };
      return next(spec, ctx);
    }`;
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
}

// ------------------------------------------------------------------ children

/** Boot decisions.html on the stub and hand back what a scenario drives it with. */
async function bootPage(prefs = {}) {
  const errors = trapErrors();
  const { document, window, map } = bootDom({
    html: html('decisions.html'),
    store: { 'ff.prefs': { 'decisions.source': 'live', ...prefs }, 'ff.connection': CONN },
  });
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  await import(moduleUrl('js/decisions-page.js'));
  await import(moduleUrl('js/connection.js'));

  const $ = (id) => document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
  const click = (el) => fire(el, 'click');
  const choose = (el, value) => { el.value = String(value); fire(el, 'change'); };
  // FINISHED means: the world is on the page, nothing says it is still working,
  // and no percentage is still an ellipsis. Never a fixed sleep.
  const settle = async () => {
    await sleep(30);
    const done = await waitFor(() => $('modeBadge').className.includes('live') &&
      document.querySelector('.dz-row') &&
      !document.querySelector('.searching') &&
      !/…/.test(text($('summaryCur')) + text($('summaryHyp'))), 60000);
    await sleep(30);
    return Boolean(done);
  };
  const row = (id) => [...document.querySelectorAll('.dz-row')].find((b) => b.dataset.id === id) || null;
  const pick = async (id) => { click(row(id)); return settle(); };
  const view = async (box, v) => {
    click(document.querySelector(`#${box}Switch button[data-sbw-view="${v}"]`));
    return settle();
  };

  // The lineup counts (Bench, Proj 0) are read apart, in `counts` below.
  const isCount = (c) => c.classList.contains('dz-lu') || c.classList.contains('dz-lu0');
  const cells = (tr) => [...tr.children].filter((c) => !isCount(c)).map(text);
  const countCells = (tr) => [...tr.children].filter(isCount).map((c) => (c.hasAttribute('hidden') ? null : Number(text(c))));
  const countHeads = (id) => [...document.querySelectorAll(`#${id} thead th`)].filter((c) => isCount(c) && !c.hasAttribute('hidden')).map(text);
  const tableRows = (id) => [...document.querySelectorAll(`#${id} tbody tr`)].map(cells);
  // SEASON BY WEEK as these facts have always read it: the slot and the week
  // cells, each a name and what he counts for. The dim projection before a
  // score and the Avg column at the end (2026-10-06) are the `lineups` child's.
  const weekCell = (td) => {
    const c = td.cloneNode(true);
    for (const pj of [...c.querySelectorAll('.sbw-pj')]) {
      const after = pj.nextSibling;
      if (after && after.nodeType === 3) after.textContent = after.textContent.replace(/^\s+/, '');
      pj.remove();
    }
    return text(c);
  };
  const seasonCells = (tr) => [...tr.children].filter((td) => !td.classList.contains('avg')).map(weekCell);
  const seasonRows = (id) => [...document.querySelectorAll(`#${id} tbody tr`)].map(seasonCells);
  const dimmed = (id) => [...document.querySelectorAll(`#${id} td`)]
    .map((td) => (td.getAttribute('style') || '').match(/opacity:\s*([\d.]+)/))
    .filter(Boolean).map((m) => Number(m[1]));
  const snap = () => ({
    team: $('teamSelect').value,
    badge: text($('modeBadge')),
    list: [...document.querySelectorAll('.dz-row')].map((b) => ({
      id: b.dataset.id, t: text(b), selected: b.getAttribute('aria-selected') === 'true',
      empty: b.dataset.empty === '1',
    })),
    // The LINEUPS group as a reader sees it: what each of its rows is called.
    lineups: [...document.querySelectorAll('.dz-row')].filter((b) => /^lineup-/.test(b.dataset.kind || ''))
      .map((b) => text(b.querySelector('.dz-what')).replace(/^live/, '')),
    // ALL USERS: the switch, what the picker says, and the one-row-a-team table.
    all: {
      on: Boolean($('allSwitch') && $('allSwitch').checked),
      picker: text($('teamSelect').querySelector('option[selected]')),
      options: $('teamSelect').querySelectorAll('option').length,
      rows: tableRows('teamTable'),
      live: [...document.querySelectorAll('#teamTable tbody tr')].filter((tr) => tr.querySelector('.wk-live')).map((tr) => tr.getAttribute('data-team')),
      shown: ['teamTable', 'weekTable', 'resultStats', 'whatIfBox'].map((id) => Boolean($(id)) && !$(id).hasAttribute('hidden')),
    },
    groups: [...document.querySelectorAll('.dz-group')].map(text),
    // Bench and Proj 0: the headings shown, then [bench, proj0] a row (null = hidden).
    counts: {
      weekHeads: countHeads('weekTable'), teamHeads: countHeads('teamTable'),
      weeks: [...document.querySelectorAll('#weekTable tbody:not(.dz-total) tr')].map(countCells),
      total: countCells(document.querySelector('#weekTable tbody.dz-total tr') || { children: [] }),
      teams: Object.fromEntries([...document.querySelectorAll('#teamTable tbody tr')].map((tr) => [tr.getAttribute('data-team'), countCells(tr)])),
    },
    lede: text($('resultLede')),
    total: cells(document.querySelector('#weekTable tbody.dz-total tr') || { children: [] }),
    stats: Object.fromEntries([...document.querySelectorAll('#resultStats .v')].map((v) => [v.dataset.stat, text(v)])),
    // What the tiles and the one-row-a-team table call their numbers, and the
    // "Biggest swap" line under the tiles.
    labels: {
      tiles: [...document.querySelectorAll('#resultStats .k')].map(text),
      teams: [...document.querySelectorAll('#teamTable thead th')].filter((c) => !isCount(c)).map(text),
    },
    big: $('resultBig') ? {
      t: text($('resultBig')), wk: $('resultBig').getAttribute('data-wk'), tag: $('resultBig').tagName,
      shown: !$('resultBig').hasAttribute('hidden') && !$('resultBig').classList.contains('is-empty'),
      hidden: $('resultBig').hasAttribute('hidden'),
    } : null,
    weeks: [...document.querySelectorAll('#weekTable tbody tr[data-wk]')].map((tr) => ({
      c: cells(tr), flip: tr.getAttribute('data-flip') === '1',
    })),
    sub: text($('pageSub')),
    views: Object.fromEntries(['season', 'standings', 'summary'].map((box) => [box, {
      on: text(document.querySelector(`#${box}Switch button.on`)),
      diff: document.querySelector(`#${box}Hyp table`)?.getAttribute('data-view') === 'diff',
    }])),
    season: {
      cur: seasonCells(document.querySelector('#seasonCur tbody.split tr') || { children: [] }),
      hyp: seasonCells(document.querySelector('#seasonHyp tbody.split tr') || { children: [] }),
      body: seasonRows('seasonHyp'),
      curBody: seasonRows('seasonCur'),
      // (the points cells: a slot's own cell carries its lineup place to sort on)
      vals: [...document.querySelectorAll('#seasonHyp td.wk[data-v]')].map((td) => Number(td.getAttribute('data-v'))),
      teamRowHidden: $('seasonTeamRow').hasAttribute('hidden'),
      teams: [...$('seasonTeam').querySelectorAll('option')].map(text),
    },
    standings: { cur: tableRows('standingsCur'), hyp: tableRows('standingsHyp') },
    summary: { cur: tableRows('summaryCur'), hyp: tableRows('summaryHyp'), status: text($('oddsStatus')) },
    notes: { hidden: $('panelNotes').hasAttribute('hidden'), t: text($('mirrorNotes')) },
    dim: {
      weeks: dimmed('weekTable'), season: dimmed('seasonHyp'),
      standings: dimmed('standingsHyp'), summary: dimmed('summaryHyp'),
      current: [...dimmed('seasonCur'), ...dimmed('standingsCur'), ...dimmed('summaryCur')],
    },
    // Where the small LIVE tag is, and which lineup cells are a projection.
    tags: {
      weeks: [...document.querySelectorAll('#weekTable tbody tr[data-wk]')]
        .filter((tr) => tr.children[0].querySelector('.wk-live')).map((tr) => tr.getAttribute('data-wk')),
      list: [...document.querySelectorAll('.dz-row')].filter((b) => b.querySelector('.wk-live')).map((b) => b.dataset.id),
      season: ['seasonCur', 'seasonHyp'].map((id) => [...document.querySelectorAll(`#${id} thead th`)]
        .filter((th) => th.querySelector('.wk-live')).map(text)),
      proj: ['seasonCur', 'seasonHyp'].map((id) => [...document.querySelectorAll(`#${id} td.sbw-proj`)].map(weekCell)),
      all: document.querySelectorAll('.wk-live').length,
    },
    noiseOn: Boolean($('noiseSwitch').checked),
    sims: (globalThis.__simCalls || []).length,
  });
  return { document, window, map, $, fire, click, choose, settle, row, pick, view, snap, errors };
}

const CHILDREN = {
  /** One reader, start to finish: every step's facts, in order. */
  async page() {
    const p = await bootPage();
    const out = { settled: await p.settle() };
    out.status = text(p.$('sourceStatus'));
    out.switch = {
      type: p.$('noiseSwitch').getAttribute('type'), role: p.$('noiseSwitch').getAttribute('role'),
      label: text(p.$('noiseSwitch').closest('label')),
    };
    out.start = p.snap();
    out.firstSim = (globalThis.__simCalls || [])[0] || null;

    // The three switches, one at a time, on the add+drop.
    await p.pick('move:mv-adddrop');
    out.addDrop = p.snap();
    for (const box of ['season', 'standings', 'summary']) await p.view(box, 'diff');
    out.addDropDiff = p.snap();

    // Noise: on, then off again.
    p.$('noiseSwitch').checked = true;
    p.fire(p.$('noiseSwitch'), 'change');
    await p.settle();
    out.noiseOn = p.snap();
    out.noisePref = JSON.parse(p.map.get('ff.prefs'))['decisions.noise'];
    p.$('noiseSwitch').checked = false;
    p.fire(p.$('noiseSwitch'), 'change');
    await p.settle();
    out.noiseOff = p.snap();

    // Squad 2: its add of a man who never started changes nothing.
    p.choose(p.$('teamSelect'), 2);
    await p.settle();
    out.team2 = p.snap();
    await p.pick('move:mv-add');
    out.empty = p.snap();
    for (const box of ['season', 'standings', 'summary']) await p.view(box, 'total');
    out.emptyTotal = p.snap();

    // Squad 3: undoing its drop means squad 4's pickup could not have happened.
    p.choose(p.$('teamSelect'), 3);
    await p.settle();
    await p.pick('move:mv-drop');
    out.skipped = p.snap();

    // Back to squad 1, and a trade as if accepted: its QB for squad 9's, from week 2.
    p.choose(p.$('teamSelect'), 1);
    await p.settle();
    for (const box of ['season', 'standings', 'summary']) await p.view(box, 'diff');
    p.choose(p.$('wiWeek'), 2);
    p.choose(p.$('wiTeam'), 9);
    out.formBefore = {
      disabled: p.$('wiAdd').disabled === true || p.$('wiAdd').hasAttribute('disabled'),
      give: [...p.$('wiGive').querySelectorAll('option')].length,
      get: [...p.$('wiGet').querySelectorAll('option')].length,
      labels: [text(p.$('wiGiveLabel')), text(p.$('wiGetLabel'))],
    };
    p.choose(p.$('wiGive'), 100);
    p.choose(p.$('wiGet'), 900);
    out.formReady = {
      disabled: p.$('wiAdd').disabled === true || p.$('wiAdd').hasAttribute('disabled'),
      chips: [...p.document.querySelectorAll('.dz-chip')].map(text),
    };
    p.fire(p.$('whatIfForm'), 'submit');
    await p.settle();
    out.whatIf = p.snap();
    out.prefs = JSON.parse(p.map.get('ff.prefs'));
    out.errors = p.errors;
    return out;
  },

  /**
   * THE WEEK IN PLAY (CAP_EARLY=1): week 4, squad 1 v squad 4 over and the other
   * four matchups still being played. One reader again.
   */
  async early() {
    const p = await bootPage();
    const out = { settled: await p.settle() };
    out.status = text(p.$('sourceStatus'));
    out.start = p.snap();
    await p.pick('move:mv-adddrop');
    out.addDrop = p.snap();
    // A trade as if accepted in week 4: squad 1 would start squad 9's QB, who is
    // still playing — so its finished matchup is not a result in that world.
    p.choose(p.$('wiWeek'), 4);
    p.choose(p.$('wiTeam'), 9);
    p.choose(p.$('wiGive'), 100);
    p.choose(p.$('wiGet'), 900);
    p.fire(p.$('whatIfForm'), 'submit');
    await p.settle();
    out.whatIf = p.snap();

    // Squad 5's own matchup is still being played.
    p.choose(p.$('teamSelect'), 5);
    await p.settle();
    await p.pick('move:mv-trade');
    out.team5 = p.snap();

    // Squad 2's add of a man who never started: nothing changes, anywhere.
    p.choose(p.$('teamSelect'), 2);
    await p.settle();
    await p.pick('move:mv-add');
    for (const box of ['season', 'standings', 'summary']) await p.view(box, 'diff');
    out.empty = p.snap();
    out.errors = p.errors;
    return out;
  },

  /**
   * TIM'S OWN CASE (CAP_EARLY=1 + CAP_BENCH_QB): squad 1's matchup is over and
   * its bench QB scored 8 more than its starter. Perfect hindsight (every week,
   * the one in play with them), then its Season by week as a difference.
   */
  async bench() {
    const p = await bootPage();
    const out = { settled: await p.settle() };
    out.start = p.snap();
    out.offered = Boolean(p.row('lineup-perfect:1:all'));
    if (out.offered) {
      await p.pick('lineup-perfect:1:all');
      out.hindsight = p.snap();
      await p.view('season', 'diff');
      out.diff = p.snap();
    }
    out.errors = p.errors;
    return out;
  },

  /**
   * ALL USERS, one reader: squad 7 alone first (for the hand check), then the
   * switch on, each of the two choices, the three charts as differences, a
   * team picked again, and the switch off. On CAP_EARLY the same on the week
   * in play.
   */
  async all() {
    const p = await bootPage(JSON.parse(process.env.DZ_PREFS || '{}'));
    const out = { settled: await p.settle() };
    const sw = p.$('allSwitch');
    const toggle = async (on) => { sw.checked = on; p.fire(sw, 'change'); return p.settle(); };
    out.control = sw ? {
      type: sw.getAttribute('type'), role: sw.getAttribute('role'), label: text(sw.closest('label')),
      // "By the user selection": the same small group as the team picker.
      byPicker: Boolean(sw.closest('.dz-top')) && sw.closest('.dz-top') === p.$('teamSelect').closest('.dz-top'),
    } : null;
    out.start = p.snap();
    if (!sw) { out.errors = p.errors; return out; }

    p.choose(p.$('teamSelect'), 7);
    await p.settle();
    await p.pick('lineup-reasonable:7:all');
    out.seven = p.snap();
    await p.pick('lineup-perfect:7:all');
    out.sevenPerfect = p.snap();
    p.choose(p.$('teamSelect'), 1);
    await p.settle();
    out.before = p.snap();

    await toggle(true);
    out.on = p.snap();
    out.prefsOn = JSON.parse(p.map.get('ff.prefs'));
    for (const box of ['season', 'standings', 'summary']) await p.view(box, 'diff');
    out.onDiff = p.snap();
    p.choose(p.$('seasonTeam'), 7);
    await p.settle();
    out.season7 = p.snap();
    await p.pick('lineup-perfect:all:all');
    out.perfect = p.snap();
    p.$('noiseSwitch').checked = true;
    p.fire(p.$('noiseSwitch'), 'change');
    await p.settle();
    out.noise = p.snap();
    p.$('noiseSwitch').checked = false;
    p.fire(p.$('noiseSwitch'), 'change');
    for (const box of ['season', 'standings', 'summary']) await p.view(box, 'total');

    // Picking a team in the picker goes back to that team's own list.
    p.choose(p.$('teamSelect'), 1);
    await p.settle();
    out.back = p.snap();
    out.prefsBack = JSON.parse(p.map.get('ff.prefs'));
    // On again, then off by the switch.
    await toggle(true);
    await toggle(false);
    out.off = p.snap();

    // What the engine says, asked directly: the page must only be drawing it.
    const E = await import(moduleUrl('js/decisions.js'));
    const stub = await import('./cap-stub-season.mjs');
    const world = await stub.fetchDecisionWorld({});
    out.engine = {};
    for (const kind of ['lineup-reasonable', 'lineup-perfect']) {
      const m = E.mirror(world, E.lineupDecision(world, kind, E.ALL_TEAMS));
      out.engine[kind] = world.teams.map((t) => {
        const r = m.records.get(t.id);
        const cells = Object.values(m.teams.get(t.id).byWeek);
        return {
          name: t.name, real: r.real, mirror: r.mirror,
          points: Math.round(cells.reduce((a, c) => a + Math.round(c.total * 10) - Math.round(c.realTotal * 10), 0)) / 10,
          live: cells.some((c) => c.live === true), weeks: cells.length,
        };
      });
    }
    out.errors = p.errors;
    return out;
  },

  /**
   * SORTING AND LAYOUT (Tim, 2026-10-06: "fix the decisions section so the
   * formating and function of the graphs matches with the rest of the cite
   * (especially column sorting and no horezontal scrolling)"). One reader
   * clicking headings: each fact is what a table shows right after a step.
   */
  async sort() {
    const p = await bootPage();
    const out = { settled: await p.settle() };
    const tableOf = (id) => { const el = p.$(id); return el.tagName === 'TABLE' ? el : el.querySelector('table'); };
    // The LAST heading row carries the labels (Standings has a group band above).
    const headRow = (id) => { const rows = tableOf(id).querySelectorAll('thead tr'); return [...rows[rows.length - 1].children]; };
    const sortOn = (id, i) => p.click(headRow(id)[i]);
    /** A table's rows, top to bottom: the name, and column `i`'s sort value and words. */
    const col = (id, i) => [...tableOf(id).querySelectorAll('tbody tr')].map((tr) => ({
      name: text(tr.children[0]),
      v: tr.children[i] && tr.children[i].hasAttribute('data-v') ? Number(tr.children[i].getAttribute('data-v')) : null,
      t: text(tr.children[i]),
    }));
    const arrow = (id) => {
      const h = headRow(id);
      const i = h.findIndex((th) => th.classList.contains('sorted'));
      return i < 0 ? null : [i, h[i].classList.contains('asc') ? 'asc' : 'desc'];
    };
    const pair = (box, i) => ({
      cur: col(`${box}Cur`, i), hyp: col(`${box}Hyp`, i),
      arrows: [arrow(`${box}Cur`), arrow(`${box}Hyp`)],
      diff: tableOf(`${box}Hyp`).getAttribute('data-view') === 'diff',
    });
    const own = (id, i) => ({ rows: col(id, i), arrow: arrow(id) });

    // ---- what is wired, and what each table sits in
    const sortable = (id) => headRow(id).map((th) => th.classList.contains('sortable') && th.hasAttribute('data-sort'));
    out.wired = Object.fromEntries(['weekTable', 'teamTable', 'standingsCur', 'standingsHyp', 'summaryCur', 'summaryHyp', 'seasonCur', 'seasonHyp']
      .map((id) => [id, sortable(id)]));
    out.wraps = Object.fromEntries(['weekTable', 'teamTable', 'standingsCur', 'standingsHyp', 'summaryCur', 'summaryHyp', 'seasonCur', 'seasonHyp']
      .map((id) => [id, Boolean(tableOf(id).closest('.table-scroll'))]));
    const pairOf = (id) => p.$(id).closest('.dz-pair').className;
    out.pairs = { season: pairOf('seasonCur'), standings: pairOf('standingsCur'), summary: pairOf('summaryCur') };
    out.before = { standings: pair('standings', 4), summary: pair('summary', 2), week: own('weekTable', 4) };

    // ---- OPP PROJ: the Stats column, on both halves, and what the shared
    // functions say it is — asked directly, of the stub's own squads: the weeks
    // played from the world, the weeks to come from the read the chart made.
    const oppAt = headRow('standingsCur').findIndex((th) => /^opp proj$/i.test(text(th)));
    {
      const P = await import(moduleUrl('js/projection.js'));
      const stub = await import('./cap-stub-season.mjs');
      const world = await stub.fetchDecisionWorld({});
      const sched = await stub.fetchSchedule();
      const fixtureWeeks = [...new Set(sched.games.map((g) => g.week))];
      const toCome = await stub.fetchWeeksRosters([...new Set(sched.games.filter((g) => !g.played).map((g) => g.week))]);
      const weekTeams = new Map();
      for (const w of fixtureWeeks) {
        const teams = toCome.get(w) || world.rosters.get(w);
        if (teams && teams.length) weekTeams.set(w, teams);
      }
      const want = P.opponentProjections(sched.games, P.projectionsFromWeekTeams(weekTeams, null).proj, world.teams.map((t) => t.id));
      out.opp = {
        at: oppAt, cur: col('standingsCur', oppAt), hyp: col('standingsHyp', oppAt),
        want: world.teams.map((t) => ({ name: t.name, v: Math.round(want.get(t.id).avgOpp * 10) / 10 })),
        fixtureWeeks: fixtureWeeks.length, asked: stub.calls.rosters.length,
      };
    }

    // ---- Season by week: week 1 (column 1) on Current, twice; the switch;
    // then the difference's own week 2 leads, and the Slot heading puts the
    // lineup order back.
    const tinted = (id) => [...tableOf(id).querySelectorAll('td')].filter((td) => /\bheat-(up|dn)-\d/.test(td.className)).length;
    out.seasonBefore = pair('season', 1);
    out.tintBefore = [tinted('seasonCur'), tinted('seasonHyp')];
    sortOn('seasonCur', 1);
    out.seasonWk = pair('season', 1);
    sortOn('seasonCur', 1);
    out.seasonWkAsc = pair('season', 1);
    await p.view('season', 'diff');
    out.seasonDiff = pair('season', 1);
    out.tintDiff = [tinted('seasonCur'), tinted('seasonHyp')];

    // ---- Standings: Current's Total (column 4), twice; then the switch
    await p.pick('lineup-perfect:1:all');
    sortOn('seasonHyp', 2);
    out.seasonHypLeads = pair('season', 2);
    sortOn('seasonCur', 0);
    out.seasonSlot = pair('season', 0);
    sortOn('seasonCur', 0);
    out.seasonSlotAsc = pair('season', 0);
    await p.view('season', 'total');
    out.seasonBack = pair('season', 0);
    sortOn('standingsCur', 4);
    out.curTotal = pair('standings', 4);
    sortOn('standingsCur', 4);
    out.curTotalAsc = pair('standings', 4);
    await p.view('standings', 'diff');
    out.curTotalDiff = pair('standings', 4);
    out.oppDiff = col('standingsHyp', oppAt);
    // ---- now the OTHER table leads: the difference's own Total
    sortOn('standingsHyp', 4);
    out.hypTotal = pair('standings', 4);
    // ---- and it survives another decision, another team and the noise switch
    await p.pick('move:mv-adddrop');
    out.hypTotalMoved = pair('standings', 4);

    // ---- the chart: LUCK (column 2) on Current, kept while the simulation runs
    sortOn('summaryCur', 2);
    out.luck = pair('summary', 2);
    p.click(p.row('lineup-reasonable:1:all'));
    out.luckWaiting = { ...pair('summary', 2), dots: /…/.test(text(p.$('summaryCur')) + text(p.$('summaryHyp'))) };
    await p.settle();
    out.luckDone = pair('summary', 2);
    await p.view('summary', 'diff');
    sortOn('summaryHyp', 3);
    out.titleDiff = pair('summary', 3);
    p.$('noiseSwitch').checked = true;
    p.fire(p.$('noiseSwitch'), 'change');
    await p.settle();
    out.titleNoise = pair('summary', 3);
    p.$('noiseSwitch').checked = false;
    p.fire(p.$('noiseSwitch'), 'change');
    await p.settle();

    // ---- one row a week: Diff (4), then Result (5), then another decision
    await p.pick('lineup-perfect:1:all');
    sortOn('weekTable', 4);
    out.weekDiff = own('weekTable', 4);
    sortOn('weekTable', 4);
    out.weekDiffAsc = own('weekTable', 4);
    await p.pick('move:mv-adddrop');
    out.weekDiffMoved = own('weekTable', 4);
    sortOn('weekTable', 5);
    out.weekResult = own('weekTable', 5);
    sortOn('weekTable', 0);
    out.weekWk = own('weekTable', 0);
    p.choose(p.$('teamSelect'), 7);
    await p.settle();
    out.weekTeam7 = own('weekTable', 0);
    out.standingsTeam7 = pair('standings', 4);
    out.seasonTeam7 = pair('season', 0);
    sortOn('weekTable', 5);
    out.weekTeam7Result = own('weekTable', 5);

    // ---- All users: one row a team
    p.$('allSwitch').checked = true;
    p.fire(p.$('allSwitch'), 'change');
    await p.settle();
    out.teamsBefore = own('teamTable', 4);
    sortOn('teamTable', 4);
    out.teamsPoints = own('teamTable', 4);
    await p.pick('lineup-perfect:all:all');
    out.teamsPointsMoved = own('teamTable', 4);
    sortOn('teamTable', 1);
    out.teamsActual = own('teamTable', 1);
    sortOn('teamTable', 0);
    out.teamsName = own('teamTable', 0);
    out.allStandings = pair('standings', 4);

    // ---- THE RED/GREEN SCALE on Season by week. With all users on the panel
    // has its own team picker, so every squad's sheet can be read off the page:
    // each cell's colour must be the shared scale's (js/heat.js) for that slot
    // in that week across the ten squads — worked here from the cells, not
    // from the page's own helper. A week still being played has none.
    const H = await import(moduleUrl('js/heat.js'));
    const sheet = (id) => {
      const t = tableOf(id);
      const live = [...t.querySelectorAll('thead th')].map((th) => Boolean(th.querySelector('.wk-live')));
      return [...t.querySelectorAll('tbody tr')].map((tr) => ({
        slot: tr.getAttribute('data-slot') || 'Total',
        cells: [...tr.children].slice(1).map((td, i) => ({
          v: td.hasAttribute('data-v') ? Number(td.getAttribute('data-v')) : null,
          cls: (td.className.match(/\bheat(-[a-z0-9]+)*/g) || []).join(' '),
          mark: (text(td).match(/[▲▼]/) || [''])[0], title: td.getAttribute('title') || '', live: live[i + 1],
          avg: td.classList.contains('avg'),
        })),
      }));
    };
    const sheets = [];
    for (const opt of [...p.$('seasonTeam').querySelectorAll('option')]) {
      p.choose(p.$('seasonTeam'), opt.getAttribute('value'));
      await p.settle();
      sheets.push({ cur: sheet('seasonCur'), hyp: sheet('seasonHyp') });
    }
    const heat = { squads: sheets.length, cells: 0, tinted: 0, marked: 0, said: 0, wrong: [], liveTinted: 0, liveCells: 0 };
    for (const half of ['cur', 'hyp']) {
      for (const row of sheets[0][half]) {
        row.cells.forEach((first, i) => {
          const same = sheets.map((s) => (s[half].find((r) => r.slot === row.slot) || { cells: [] }).cells[i] || { v: null, cls: '', mark: '', title: '' });
          if (first.live) {
            heat.liveCells += same.length;
            heat.liveTinted += same.filter((c) => c.cls !== '' || c.mark !== '').length;
            return;
          }
          const scale = H.heatScale(same.map((c) => c.v));
          for (const c of same) {
            if (c.v === null) continue;
            // (The Avg column, the last: a slot's Avg against the other squads' Avg there.)
            const what = c.avg
              ? `the other squads’ ${row.slot === 'Total' ? 'average totals' : `${row.slot} average`}`
              : `the other squads’ ${row.slot === 'Total' ? 'totals' : row.slot} in week ${i + 1}`;
            const want = H.heatOf(c.v, scale, { what }) || { cls: '', mark: '', words: '' };
            heat.cells++;
            if (c.avg) heat.avgCells = (heat.avgCells || 0) + 1;
            if (/heat-(up|dn)/.test(c.cls)) heat.tinted++;
            if (c.mark) heat.marked++;
            if (want.words && c.title.includes(want.words)) heat.said++;
            if (c.cls !== want.cls || c.mark !== (want.mark || '')) heat.wrong.push([half, row.slot, i, c.v, c.cls, c.mark, want.cls, want.mark]);
          }
        });
      }
    }
    heat.wrong = heat.wrong.slice(0, 6);
    out.heat = heat;
    out.errors = p.errors;
    return out;
  },

  /**
   * SEASON BY WEEK, FOUR ADDITIONS (Tim, 2026-10-06: "if the user clicks on the
   * number while the preview is open, then automatically pull up that player's
   * season by week right below ... highlight any positions/player's that changed
   * ... show their proj score to the left ... in a dimmer grey ... add a column
   * ... that shows the avg for each row" — "on right not left", he said after).
   * One reader: six decisions read cell by cell beside their week previews, the
   * Avg heading sorted on, then from a preview to the lineups with a mouse, the
   * keyboard and a finger, and with all users on.
   */
  async lineups() {
    if (process.env.DZ_CENTS) scoreInCents();
    const p = await bootPage();
    const out = { settled: await p.settle() };
    const doc = p.document;
    // (A control the page does not have is a fact for the parent to fail on, not a crash here.)
    const tap = (el) => { if (el) p.click(el); };
    // What each man was projected for, straight from the stub's own world (the
    // page reads the same one): week|player -> projection.
    const stub = await import('./cap-stub-season.mjs');
    const world = await stub.fetchDecisionWorld({});
    const projected = new Map();
    for (const [week, teams] of world.rosters) {
      for (const t of teams) for (const man of t.players) projected.set(`${week}|${man.playerId}`, man.projected);
    }
    // (A man a decision keeps who was on nobody's roster that week: his own line.)
    for (const [id, who] of world.players) {
      for (const [week, line] of Object.entries(who.byWeek || {})) {
        if (!projected.has(`${week}|${id}`)) projected.set(`${week}|${id}`, line.projected);
      }
    }
    const bare = (el, drop) => {
      const c = el.cloneNode(true);
      for (const x of [...c.querySelectorAll(drop)]) x.remove();
      return text(c);
    };
    const half = (id) => {
      const t = doc.querySelector(`#${id} table`);
      return {
        diff: t.getAttribute('data-view') === 'diff',
        head: [...t.querySelectorAll('thead th')].map((th) => ({
          t: bare(th, '.wk-live'), sort: th.hasAttribute('data-sort'), at: th.classList.contains('dz-at'),
        })),
        rows: [...t.querySelectorAll('tbody tr')].map((tr) => {
          const avg = tr.querySelector('td.avg');
          return {
            slot: tr.getAttribute('data-slot') || 'Total',
            cells: [...tr.children].slice(1).filter((td) => !td.classList.contains('avg')).map((td) => {
              const pj = td.querySelector('.sbw-pj');
              const pts = td.querySelector('.sbw-pts');
              const wk = Number(td.getAttribute('data-wk'));
              const pid = td.getAttribute('data-pid');
              return {
                wk, pid, name: text(td.querySelector('.sbw-name')),
                pj: pj ? text(pj) : null, whole: pj ? pj.getAttribute('data-r') : null,
                // The projection is the FIRST thing on the numbers' line.
                pjFirst: pj ? pts.firstChild === pj : null,
                shown: bare(pts || td, '.sbw-pj, .heatmark'), v: td.getAttribute('data-v'),
                want: pid && projected.has(`${wk}|${pid}`) ? projected.get(`${wk}|${pid}`) : null,
                title: td.getAttribute('title') || '', lines: pts ? pts.querySelectorAll('br').length : 0,
                chg: td.classList.contains('sbw-chg'), at: td.classList.contains('dz-at'), inPlay: td.classList.contains('sbw-proj'),
              };
            }),
            avg: avg ? { t: bare(avg, '.heatmark'), v: avg.getAttribute('data-v'), last: tr.lastElementChild === avg } : null,
          };
        }),
      };
    };
    const pop = () => {
      const el = p.$('whyPop');
      return {
        open: Boolean(el) && !el.hasAttribute('hidden'), cls: el ? el.className : '',
        buttons: el ? [...el.querySelectorAll('button')].map(text) : [],
      };
    };
    const weekWhy = (wk) => doc.querySelector(`#weekTable tr[data-wk="${wk}"] .dz-why`);
    const manName = (td) => { const m = td.querySelector('.dz-man'); return m ? bare(m, '.pv') : null; };
    /** Every week's preview, as a mouse over its Diff gets it: who Started, who starts Instead. */
    const previews = () => [...doc.querySelectorAll('#weekTable tbody tr[data-wk]')].map((tr) => {
      const el = tr.querySelector('.dz-why');
      p.fire(el, 'mouseover');
      const rows = [...p.$('whyPop').querySelectorAll('tbody tr')].filter((r) => r.children.length === 4);
      const got = {
        wk: Number(tr.getAttribute('data-wk')),
        started: rows.map((r) => manName(r.children[1])).filter(Boolean),
        instead: rows.map((r) => manName(r.children[2])).filter(Boolean),
      };
      p.fire(el, 'mouseout');
      return got;
    });

    // ---- six decisions, each read whole: Hypothetical, then as a Difference
    out.cases = [];
    for (const [team, id] of [[1, 'lineup-reasonable:1:all'], [1, 'lineup-perfect:1:all'], [1, 'move:mv-adddrop'],
      [7, 'lineup-reasonable:7:all'], [7, 'lineup-perfect:7:all'], [3, 'move:mv-drop']]) {
      if (String(p.$('teamSelect').value) !== String(team)) { p.choose(p.$('teamSelect'), team); await p.settle(); }
      await p.pick(id);
      const one = { id, previews: previews(), cur: half('seasonCur'), hyp: half('seasonHyp') };
      await p.view('season', 'diff');
      one.diff = half('seasonHyp');
      await p.view('season', 'total');
      out.cases.push(one);
    }

    // ---- the Avg heading sorts, and the other half follows
    p.choose(p.$('teamSelect'), 1);
    await p.settle();
    await p.pick('lineup-reasonable:1:all');
    const avgHead = () => [...doc.querySelectorAll('#seasonCur thead th')].find((th) => th.classList.contains('avg'));
    const order = (id) => half(id).rows.filter((r) => r.slot !== 'Total').map((r) => [r.slot, r.avg && Number(r.avg.v)]);
    tap(avgHead());
    out.avgSort = { cur: order('seasonCur'), hyp: order('seasonHyp'), total: half('seasonCur').rows.slice(-1)[0].slot, head: Boolean(avgHead()) };
    p.click(doc.querySelector('#seasonCur thead th'));
    p.click(doc.querySelector('#seasonCur thead th'));

    // ---- from a preview to the lineups
    const scrolls = [];
    p.$('panelSeason').scrollIntoView = (o) => scrolls.push(o || null);
    const key = (el, k) => {
      const e = new p.window.Event('keydown', { bubbles: true, cancelable: true });
      e.key = k;
      el.dispatchEvent(e);
    };
    const outlined = () => ['seasonCur', 'seasonHyp'].map((id) => {
      const h = half(id);
      return {
        head: h.head.filter((th) => th.at).map((th) => th.t),
        weeks: [...new Set(h.rows.flatMap((r) => r.cells.filter((c) => c.at).map((c) => c.wk)))],
        cells: h.rows.flatMap((r) => r.cells).filter((c) => c.at).length,
        rows: h.rows.length,
      };
    });
    const where = () => ({
      pop: pop().open, scrolls: scrolls.length, how: scrolls[scrolls.length - 1] || null, outlined: outlined(),
      seasonTeam: p.$('seasonTeam').value, team: p.$('teamSelect').value, all: Boolean(p.$('allSwitch').checked),
      picked: (p.snap().list.find((r) => r.selected) || {}).id,
    });
    // A mouse: over the number its card is open, and the click goes on.
    const two = weekWhy(2);
    p.fire(two, 'mouseover');
    out.cardOpen = pop();
    p.click(two);
    out.mouse = where();
    p.click(p.$('resultLede'));
    out.afterNextClick = where();
    // The keyboard: focus opens the card, Enter goes on.
    const three = weekWhy(3);
    p.fire(three, 'focusin');
    out.focusOpen = pop().open;
    key(three, 'Enter');
    out.keyboard = where();
    p.click(p.$('resultLede'));
    // The Biggest swap line, a button: a click opens its week, and the next goes on.
    p.click(p.$('resultBig'));
    out.bigOpen = pop().open;
    p.click(p.$('resultBig'));
    out.big = { ...where(), wk: p.$('resultBig').getAttribute('data-wk') };
    p.click(p.$('resultLede'));
    // A finger: the first tap is the sheet, as before; its own button goes on.
    const touch = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    const mouse = p.window.matchMedia;
    p.window.matchMedia = touch;
    globalThis.matchMedia = touch;
    p.click(two);
    out.sheet = pop();
    tap(p.$('whyPop').querySelector('.op-go'));
    out.finger = where();
    p.click(p.$('resultLede'));
    p.window.matchMedia = mouse;
    globalThis.matchMedia = mouse;

    // ---- all users: a team's Points/wk goes to THAT team's lineups, and stays in all users
    p.$('allSwitch').checked = true;
    p.fire(p.$('allSwitch'), 'change');
    await p.settle();
    await p.pick('lineup-reasonable:all:all');
    const seven = doc.querySelector('#teamTable tr[data-team="7"] .dz-why');
    out.allBefore = where();
    // The page keeps hover quiet for 900 ms after it has gone on to Season by
    // week (so the card does not pop back up under a still mouse). On a fast
    // machine the steps above take less than that, the hover is ignored and the
    // click opens the card instead of going on — which is how this failed on CI
    // and passed on the laptop.
    await new Promise((r) => setTimeout(r, 1000));
    p.fire(seven, 'mouseover');
    p.click(seven);
    await p.settle();
    out.allGo = where();
    out.allSeason = half('seasonHyp').rows.slice(-1)[0];
    p.window.matchMedia = touch;
    globalThis.matchMedia = touch;
    const four = doc.querySelector('#teamTable tr[data-team="4"] .dz-why');
    p.click(four);
    out.allSheet = pop();
    tap(p.$('whyPop').querySelector('.op-go'));
    await p.settle();
    out.allFinger = where();
    p.window.matchMedia = mouse;
    globalThis.matchMedia = mouse;
    out.errors = p.errors;
    return out;
  },

  /** A fresh page on some prefs, looked at and no more (DZ_PREFS). */
  /**
   * WHERE A DIFFERENCE COMES FROM (Tim, 2026-10-06: "it's really hard to know
   * where that data is coming from or the specifics on when the user started
   * someone with less points"). One reader opening the numbers: every week's
   * Diff, the "Biggest swap" line, and with all users on a team's Points/wk —
   * with a mouse (a card), then with a finger (a sheet with Close).
   */
  async why() {
    if (process.env.DZ_CENTS) scoreInCents();
    const p = await bootPage();
    const out = { settled: await p.settle() };
    const doc = p.document;
    const cellsOf = (tr) => [...tr.children].map(text);
    const read = () => {
      const el = p.$('whyPop');
      if (!el) return { open: false };
      return {
        open: !el.hasAttribute('hidden'), cls: el.className, head: text(el.querySelector('.op-h')),
        cols: [...el.querySelectorAll('thead th')].map(text),
        rows: [...el.querySelectorAll('tbody tr')].map(cellsOf),
        foot: [...el.querySelectorAll('tfoot tr')].map(cellsOf),
        close: text(el.querySelector('.op-close')),
        proj: [...el.querySelectorAll('.dz-proj')].map(text),
      };
    };
    const weekWhy = (wk) => doc.querySelector(`#weekTable tr[data-wk="${wk}"] .dz-why`);
    const teamWhy = (id) => doc.querySelector(`#teamTable tr[data-team="${id}"] .dz-why`);
    const key = (el, k) => {
      const e = new p.window.Event('keydown', { bubbles: true, cancelable: true });
      e.key = k;
      el.dispatchEvent(e);
    };
    /** Every week of what is picked: its row, and the card a mouse over its Diff gets. */
    const weeks = () => [...doc.querySelectorAll('#weekTable tbody tr[data-wk]')].map((tr) => {
      const el = tr.querySelector('.dz-why');
      if (!el) return { row: cellsOf(tr), card: { open: false }, shut: true };
      p.fire(el, 'mouseover');
      const card = read();
      p.fire(el, 'mouseout');
      return { row: cellsOf(tr), card, shut: !read().open };
    });
    const state = () => ({ big: p.snap().big, stats: p.snap().stats, total: p.snap().total, weeks: weeks() });

    out.start = state();
    await p.pick('move:mv-adddrop');
    out.addDrop = state();
    const el = weekWhy(2);
    out.handle = el ? { tab: el.getAttribute('tabindex'), role: el.getAttribute('role'), label: el.getAttribute('aria-label') } : null;
    if (!el) { out.errors = p.errors; return out; }

    // A mouse: a click opens the same card; Escape, a click elsewhere, and
    // leaving a focused number each shut it. Enter opens it from the keyboard.
    p.click(el);
    out.clicked = read();
    key(doc, 'Escape');
    out.afterEscape = read().open;
    p.click(el);
    p.click(p.$('resultLede'));
    out.afterOutside = read().open;
    key(el, 'Enter');
    out.afterEnter = read();
    key(doc, 'Escape');
    p.fire(el, 'focusin');
    out.focused = read().open;
    p.fire(el, 'focusout');
    out.afterBlur = read().open;
    // The line under the tiles opens its own week.
    p.click(p.$('resultBig'));
    out.bigOpened = read();
    key(doc, 'Escape');

    // A finger: no hover, so over does nothing and a tap opens a sheet.
    const touch = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    const mouse = p.window.matchMedia;
    p.window.matchMedia = touch;
    globalThis.matchMedia = touch;
    p.fire(el, 'mouseover');
    out.touchOver = read().open;
    p.click(el);
    out.sheet = read();
    p.click(p.$('whyPop').querySelector('.op-close'));
    out.afterClose = read().open;
    p.window.matchMedia = mouse;
    globalThis.matchMedia = mouse;

    // Squad 7, "Reasonable": the hand numbers at the top of this file, man by man.
    p.choose(p.$('teamSelect'), 7);
    await p.settle();
    await p.pick('lineup-reasonable:7:all');
    out.seven = state();
    await p.pick('lineup-perfect:7:all');
    out.sevenPerfect = state();

    // Squad 1's hindsight (on CAP_BENCH_QB, the week in play with it).
    p.choose(p.$('teamSelect'), 1);
    await p.settle();
    await p.pick('lineup-perfect:1:all');
    out.onePerfect = state();

    // Squad 2's add of a man who never started: no swap anywhere.
    p.choose(p.$('teamSelect'), 2);
    await p.settle();
    await p.pick('move:mv-add');
    out.empty = state();

    // ALL USERS: each team's Points/wk opens its weeks.
    p.$('allSwitch').checked = true;
    p.fire(p.$('allSwitch'), 'change');
    await p.settle();
    out.all = {
      big: p.snap().big, labels: p.snap().labels,
      teams: [...doc.querySelectorAll('#teamTable tbody tr')].map((tr) => {
        const cell = tr.querySelector('.dz-why');
        const td = tr.children[4];
        if (!cell) return { row: cellsOf(tr), v: td.getAttribute('data-v'), card: { open: false }, shut: true };
        p.fire(cell, 'mouseover');
        const card = read();
        p.fire(cell, 'mouseout');
        return { row: cellsOf(tr), v: td.getAttribute('data-v'), card, shut: !read().open };
      }),
    };
    const seven = teamWhy(7);
    if (seven) {
      p.window.matchMedia = touch;
      globalThis.matchMedia = touch;
      p.click(seven);
      out.all.sheet = read();
      p.window.matchMedia = mouse;
      globalThis.matchMedia = mouse;
      key(doc, 'Escape');
    }
    // Picking the other lineup redraws the box: an open card must not outlive it.
    if (seven) p.click(seven);
    await p.pick('lineup-perfect:all:all');
    out.all.afterPick = read().open;
    out.errors = p.errors;
    return out;
  },

  async plain() {
    const p = await bootPage(JSON.parse(process.env.DZ_PREFS || '{}'));
    const out = { settled: await p.settle() };
    out.start = p.snap();
    out.prefs = JSON.parse(p.map.get('ff.prefs'));
    out.errors = p.errors;
    return out;
  },

  /** A fresh page on the prefs the first one left: the what-if is still there. */
  async reload() {
    const p = await bootPage(JSON.parse(process.env.DZ_PREFS || '{}'));
    const out = { settled: await p.settle() };
    out.start = p.snap();
    const x = p.document.querySelector('.dz-x');
    out.hadRemove = Boolean(x);
    if (x) { p.click(x); await p.settle(); }
    out.after = p.snap();
    out.prefs = JSON.parse(p.map.get('ff.prefs'));
    out.errors = p.errors;
    return out;
  },

  /** The other squad in the what-if sees the same trade in its own list. */
  async other() {
    const p = await bootPage({
      ...JSON.parse(process.env.DZ_PREFS || '{}'), 'decisions.team.99-2026': 9, 'decisions.noise': true,
    });
    const out = { settled: await p.settle() };
    out.start = p.snap();
    out.errors = p.errors;
    return out;
  },

  /** The Summary page on the same league, for its chart and its simulation. */
  async summary() {
    const errors = trapErrors();
    const { document } = bootDom({
      html: html('summary.html'),
      store: { 'ff.prefs': { 'summary.source': 'live' }, 'ff.connection': CONN },
    });
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
    await import(moduleUrl('js/summary-page.js'));
    await import(moduleUrl('js/connection.js'));
    await waitFor(() => /simulated seasons/.test(text(document.getElementById('simStatus'))), 60000);
    await sleep(100);
    return {
      rows: [...document.querySelectorAll('#summaryTable tbody tr')].map((tr) => [...tr.children].map(text)),
      call: (globalThis.__simCalls || []).slice(-1)[0] || null,
      errors,
    };
  },

  /** The world cannot be read (DZ env: CAP_WORLD_FAIL, with or without CAP_CLOUD). */
  async failed() {
    const p = await bootPage();
    await waitFor(() => p.$('modeBadge').className.includes('demo') && p.document.querySelector('.dz-row'), 30000);
    await sleep(50);
    return {
      status: text(p.$('sourceStatus')), badge: text(p.$('modeBadge')),
      rows: p.document.querySelectorAll('.dz-row').length, errors: p.errors,
    };
  },

  /** Nothing decided yet: no week to replay. */
  async unplayed() {
    const p = await bootPage();
    await waitFor(() => p.$('modeBadge').className.includes('live'), 30000);
    await sleep(100);
    return {
      status: text(p.$('sourceStatus')),
      hidden: ['main', 'panelSeason', 'panelStandings', 'panelSummary', 'panelNotes']
        .map((id) => p.$(id).hasAttribute('hidden')),
      errors: p.errors,
    };
  },
};

if (CHILDREN[process.argv[2]]) {
  try {
    emit(await CHILDREN[process.argv[2]](), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

const RUNS = {
  page: { child: 'page', env: {} },
  reload: { child: 'reload', env: {} },
  other: { child: 'other', env: {} },
  summary: { child: 'summary', env: {} },
  failed: { child: 'failed', env: { CAP_WORLD_FAIL: '1' } },
  'failed-cloud': { child: 'failed', env: { CAP_WORLD_FAIL: '1', CAP_CLOUD: '1' } },
  unplayed: { child: 'unplayed', env: { CAP_DECIDED: '0' } },
  early: { child: 'early', env: { CAP_EARLY: '1' } },
  'summary-early': { child: 'summary', env: { CAP_EARLY: '1' } },
  bench: { child: 'bench', env: { CAP_EARLY: '1', CAP_BENCH_QB: '1' } },
  'bench-all': { child: 'bench', env: { CAP_EARLY: '1', CAP_BENCH_QB: 'all' } },
  all: { child: 'all', env: {} },
  'all-early': { child: 'all', env: { CAP_EARLY: '1', CAP_BENCH_QB: '1' } },
  plain: { child: 'plain', env: {} },
  why: { child: 'why', env: {} },
  'why-early': { child: 'why', env: { CAP_EARLY: '1', CAP_BENCH_QB: '1' } },
  'why-cents': { child: 'why', env: { DZ_CENTS: '1' } },
  lineups: { child: 'lineups', env: {} },
  'lineups-early': { child: 'lineups', env: { CAP_EARLY: '1', CAP_BENCH_QB: '1' } },
  'lineups-cents': { child: 'lineups', env: { DZ_CENTS: '1' } },
  sort: { child: 'sort', env: {} },
  'sort-early': { child: 'sort', env: { CAP_EARLY: '1' } },
};

function child(name, extra = {}) {
  const cfg = RUNS[name];
  const env = { ...process.env };
  for (const k of ['CAP_EARLY', 'CAP_BENCH_QB', 'CAP_DECIDED', 'CAP_WIRE', 'CAP_CLOUD', 'CAP_WORLD_FAIL', 'DZ_PREFS', 'DZ_CENTS', 'FF_SCEN']) delete env[k];
  Object.assign(env, cfg.env, extra);
  const res = spawnSync(process.execPath, ['--import', './cap-register.mjs', self, cfg.child], {
    encoding: 'utf8', cwd: path.dirname(self), maxBuffer: 64 * 1024 * 1024, timeout: 240000, env,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) return { boot: `no result\n${(res.stdout || '').slice(0, 1500)}\n${(res.stderr || '').slice(0, 2500)}` };
  return JSON.parse(line.slice(2));
}

if (process.argv[2] === '--dump') {
  const got = child(process.argv[3]);
  const keys = process.argv.slice(4);
  console.log(JSON.stringify(keys.length ? Object.fromEntries(keys.map((k) => [k, got[k]])) : got, null, 1));
  process.exit(0);
}

// -------------------------------------------------------------------- parent

let pass = 0;
const fails = [];
let where = 'page';
// A page so broken that a fact is missing altogether still ends in a FAIL line
// and a count, never in a bare stack trace.
process.on('uncaughtException', (err) => {
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`FAIL [${where}] a fact the page should show is missing — ${String((err && err.stack) || err).slice(0, 400)}`);
  console.log(`${pass} passed, ${fails.length + 1} failed`);
  process.exit(1);
});
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`[${where}] ${name}${detail !== '' ? ` — ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}` : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const booted = (got, name) => {
  where = name;
  ok('the page boots and settles', !got.boot && got.settled !== false, got.boot || 'never settled');
  if (!got.boot) ok('no console errors', (got.errors || []).length === 0, got.errors);
  return !got.boot;
};
/** A printed number, minus sign and all: "−1.4" -> -1.4. Null for a dash. */
const num = (s) => {
  const m = String(s).replace('−', '-').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
/** Every cell of a difference table after the name: is each one zero or a dash? */
const allZero = (rows) => rows.length > 0 && rows.every((r) => r.slice(1).every((c) => c === '—' || num(c) === 0));
const rowOf = (rows, name) => rows.find((r) => r[0] === name) || [];
/**
 * POINTS/WK (Tim, 2026-10-06: "show the points in that box on the end as
 * points/week, not just points in general"): a season's printed difference over
 * the weeks it covers, signed, one decimal — worked here from the Total row and
 * not read back off the page.
 */
const perWk = (season, weeks) => {
  const v = Math.round((num(season) / weeks) * 10) / 10;
  return v === 0 ? '0.0' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}`;
};
/** A one-row-a-team table of season points, as the page draws it: points a week. */
const eachWeek = (rows, weeks) => rows.map((r) => [...r.slice(0, 4), perWk(r[4], weeks)]);

const page = child('page');
if (booted(page, 'page')) {
  // ---- the top of the page
  ok('the league loaded and says so', /3 finished weeks, 5 moves/.test(page.status), page.status);
  ok('the saved "my team" is the one picked', page.start.team === '1' && page.start.badge === 'Live', page.start.team);
  ok('Display noise is a real switch, labelled', same(page.switch, { type: 'checkbox', role: 'switch', label: 'Display noise' }), page.switch);
  ok('and it is OFF by default', page.start.noiseOn === false);

  // ---- the list
  const ids = page.start.list.map((r) => r.id);
  ok('the list is squad 1’s decisions: its add+drop, then the two lineups — and no week’s own',
    same(ids, ['move:mv-adddrop', 'lineup-reasonable:1:all', 'lineup-perfect:1:all']), ids);
  ok('grouped as Moves and Lineups', same(page.start.groups, ['Moves', 'Lineups']), page.start.groups);
  ok('LINEUPS is exactly two rows, called "Reasonable" and "Perfect hindsight"',
    same(page.start.lineups, ['Reasonable', 'Perfect hindsight']), page.start.lineups);
  ok('All users is off, and the result is the one-row-a-week table with its tiles',
    page.start.all.on === false && same(page.start.all.shown, [false, true, true, true]) && page.start.all.picker === 'Manager 1', page.start.all);
  const first = page.start.list[0];
  ok('the add+drop row reads week, what, record change, points change',
    first.t === 'Wk 2Added Free Agent WR, dropped Manager 1 WR11+1 W−1.4', first.t);
  ok('a lineup row says which lineup, with its record and points change',
    rowOf(page.start.list.map((r) => [r.id, r.t]), 'lineup-perfect:1:all')[1] === 'AllPerfect hindsight+1 W+33.9' &&
    rowOf(page.start.list.map((r) => [r.id, r.t]), 'lineup-reasonable:1:all')[1] === 'AllReasonable+1 W+23.0',
    page.start.list.map((r) => r.t));
  ok('the first decision that changes something is picked', first.selected && page.start.list.filter((r) => r.selected).length === 1);

  // ---- the biggest thing
  const wk = page.addDrop.weeks;
  ok('one row a finished week: actual, hypothetical, difference, result',
    same(wk.map((w) => w.c), [
      ['1', 'Manager 10', '114.9', '114.9', '0.0', 'W'],
      ['2', 'Manager 2', '111.1', '111.5', '+0.4', 'T → W'],
      ['3', 'Manager 3', '117.3', '115.5', '−1.8', 'L'],
    ]), wk.map((w) => w.c));
  ok('and the season under them', same(page.addDrop.total, ['Total', '343.3', '341.9', '−1.4', '+1 W']), page.addDrop.total);
  ok('only the flipped matchup is marked', same(wk.map((w) => w.flip), [false, true, false]), wk.map((w) => w.flip));
  ok('the record in each world, and the points a week: −1.4 over 3 weeks', perWk('−1.4', 3) === '−0.5' &&
    same(page.addDrop.stats, { real: '1-1-1', mirror: '2-1', points: '−0.5' }), page.addDrop.stats);
  ok('the third tile is called "Points/wk"', same(page.addDrop.labels.tiles, ['Actual record', 'Hypothetical', 'Points/wk']), page.addDrop.labels);
  ok('the lede names the decision', /^Undone: Added Free Agent WR, dropped Manager 1 WR11 \(week 2\)\.$/.test(page.addDrop.lede), page.addDrop.lede);

  // ---- the three charts: hypothetical, then difference
  const a = page.addDrop;
  const d = page.addDropDiff;
  ok('each chart opens on Hypothetical', Object.values(a.views).every((v) => v.on === 'Hypothetical' && !v.diff), a.views);
  ok('and each switch turns it into Difference', Object.values(d.views).every((v) => v.on === 'Difference' && v.diff), d.views);
  ok('season by week: current totals, hypothetical totals', same(a.season.cur, ['Total', '114.9', '111.1', '117.3']) &&
    same(a.season.hyp, ['Total', '114.9', '111.5', '115.5']), [a.season.cur, a.season.hyp]);
  ok('season by week, difference: the totals’ differences', same(d.season.hyp, ['Total', '0.0', '+0.4', '−1.8']), d.season.hyp);
  ok('standings: squad 1 is 1–1–1 beside 2–1', rowOf(a.standings.cur, 'Manager 1')[1] === '1–1–1' &&
    rowOf(a.standings.hyp, 'Manager 1')[1] === '2–1', [rowOf(a.standings.cur, 'Manager 1'), rowOf(a.standings.hyp, 'Manager 1')]);
  ok('standings, difference: +1 W for squad 1, and its total −1.4',
    rowOf(d.standings.hyp, 'Manager 1')[1] === '+1 W' && rowOf(d.standings.hyp, 'Manager 1')[4] === '−1.4', rowOf(d.standings.hyp, 'Manager 1'));
  ok('standings, difference: squad 2 lost the tie it had', rowOf(d.standings.hyp, 'Manager 2')[1] === '−1 T' || /L/.test(rowOf(d.standings.hyp, 'Manager 2')[1]), rowOf(d.standings.hyp, 'Manager 2'));
  ok('both standings are in the same order', same(a.standings.cur.map((r) => r[0]), a.standings.hyp.map((r) => r[0])));
  ok('the chart: squad 1’s record in each world', rowOf(a.summary.cur, 'Manager 1')[1] === '1-1-1' && rowOf(a.summary.hyp, 'Manager 1')[1] === '2-1',
    [rowOf(a.summary.cur, 'Manager 1'), rowOf(a.summary.hyp, 'Manager 1')]);
  ok('the chart: every title and loser chance is a percentage in both worlds',
    [...a.summary.cur, ...a.summary.hyp].length === 20 && [...a.summary.cur, ...a.summary.hyp].every((r) => /%( [▲▼])?$/.test(r[3]) && /%( [▲▼])?$/.test(r[4])),
    a.summary.hyp);
  ok('the chart, difference: +1 W, and the two chances as signed points',
    rowOf(d.summary.hyp, 'Manager 1')[1] === '+1 W' && d.summary.hyp.every((r) => /^[+−]?\d+\.\d%$/.test(r[3]) && /^[+−]?\d+\.\d%$/.test(r[4])),
    d.summary.hyp);
  ok('a win in hand moves squad 1’s title chance up', num(rowOf(d.summary.hyp, 'Manager 1')[3]) > 0, rowOf(d.summary.hyp, 'Manager 1'));
  ok('the chart’s two tables are in the same order', same(a.summary.cur.map((r) => r[0]), a.summary.hyp.map((r) => r[0])));
  ok('nothing could not have happened, so no notes panel', a.notes.hidden && a.notes.t === '', a.notes);

  // ---- noise
  ok('noise off: nothing anywhere is dimmed', Object.values(d.dim).every((list) => list.length === 0), d.dim);
  const n = page.noiseOn;
  ok('noise on: week 3 of the weekly totals is dimmed (0.1 noise = opacity 0.935), weeks 1 and 2 are not',
    same(n.dim.weeks, [0.935, 0.935, 0.935]), n.dim.weeks);
  ok('noise on: the hypothetical season dims week 3’s column only',
    n.dim.season.length === n.season.body.length && n.dim.season.every((o) => o === 0.935), n.dim.season);
  ok('noise on: the standings and the chart dim the touched squad’s row',
    n.dim.standings.length >= 17 && n.dim.summary.length >= 4 && [...n.dim.standings, ...n.dim.summary].every((o) => o > 0 && o < 1),
    [n.dim.standings.length, n.dim.summary.length]);
  ok('noise on: the CURRENT halves are never dimmed', n.dim.current.length === 0, n.dim.current);
  ok('the switch is remembered', n.noiseOn === true && page.noisePref === true, page.noisePref);
  ok('noise off again: no opacity left anywhere', Object.values(page.noiseOff.dim).every((list) => list.length === 0), page.noiseOff.dim);

  // ---- an empty decision
  const e = page.empty;
  ok('picking another squad lists ITS decisions', page.team2.list[0].id === 'move:mv-add' && page.team2.list.every((r) => /^move:mv-add$|:2:/.test(r.id)),
    page.team2.list.map((r) => r.id));
  ok('an empty decision reads "No change" in the list', rowOf(e.list.map((r) => [r.id, r.t, r.empty]), 'move:mv-add')[1] === 'Wk 2Added Free Agent RBNo change',
    e.list[0]);
  ok('and is not the one picked by default', page.team2.list[0].selected === false && page.team2.list.some((r) => r.selected));
  ok('picked, its weekly differences are all zero and nothing flips',
    e.weeks.length === 3 && e.weeks.every((w) => w.c[2] === w.c[3] && w.c[4] === '0.0' && !w.flip), e.weeks.map((w) => w.c));
  ok('its record is the same in both worlds', e.stats.real === '0-2-1' && e.stats.mirror === '0-2-1' && e.stats.points === '0.0', e.stats);
  ok('season by week, difference: every cell zero', e.season.vals.length === 33 && e.season.vals.every((v) => v === 0) && same(e.season.hyp, ['Total', '0.0', '0.0', '0.0']), e.season.vals);
  ok('standings, difference: every cell zero', allZero(e.standings.hyp), e.standings.hyp.find((r) => !allZero([r])));
  ok('the chart, difference: every cell zero — the same simulation, not a second roll',
    allZero(e.summary.hyp) && e.summary.hyp.every((r) => r[3] === '0.0%' && r[4] === '0.0%'), e.summary.hyp);
  ok('and it cost no simulation: the mirror’s season is the real one', e.sims === page.team2.sims, [page.team2.sims, e.sims]);
  ok('switched back, the hypothetical chart IS the current one', same(page.emptyTotal.summary.hyp, page.emptyTotal.summary.cur) &&
    same(page.emptyTotal.standings.hyp, page.emptyTotal.standings.cur), page.emptyTotal.summary.hyp);

  // ---- a move that could not have happened
  const s = page.skipped;
  ok('the skipped move is said under the charts, naming the man and why',
    !s.notes.hidden && s.notes.t === 'Could not have happened: Manager 4 added Manager 3 QB12 (week 3). ' +
      'Manager 3 QB12 was not free (Manager 3 still had him).', s.notes);
  ok('a second squad’s lineup changed, so "Lineup of" offers it', !s.season.teamRowHidden && same(s.season.teams, ['Manager 3', 'Manager 4']), s.season.teams);
  ok('with one squad changed there is no such select', a.season.teamRowHidden === true);

  // ---- a trade as if accepted
  const w = page.whatIf;
  ok('the form offers each side’s week-2 roster and waits for both sides',
    page.formBefore.disabled && page.formBefore.give === 15 && page.formBefore.get === 15 &&
    same(page.formBefore.labels, ['Manager 1 gives', 'Manager 9 gives']), page.formBefore);
  ok('with a man on each side it can be added', !page.formReady.disabled && same(page.formReady.chips, ['Manager 1 QB0', 'Manager 9 QB0']), page.formReady);
  const added = w.list.find((r) => r.id.startsWith('whatif:'));
  ok('the what-if is in the list, first, picked, under its own heading',
    added && w.list[0] === added && added.selected && w.groups[0] === 'What if', w.list[0]);
  ok('it reads as a trade with the other squad', added && /^Wk 2Trade Manager 1 QB0 for Manager 9 QB0 \(Manager 9\)/.test(added.t), added && added.t);
  ok('the weekly totals move from week 2 on, and week 1 does not',
    w.weeks[0].c[4] === '0.0' && num(w.weeks[1].c[4]) !== 0 && num(w.weeks[2].c[4]) !== 0, w.weeks.map((x) => x.c));
  ok('BOTH squads’ season totals change in the standings', num(rowOf(w.standings.hyp, 'Manager 1')[4]) !== 0 && num(rowOf(w.standings.hyp, 'Manager 9')[4]) !== 0,
    [rowOf(w.standings.hyp, 'Manager 1'), rowOf(w.standings.hyp, 'Manager 9')]);
  ok('and nobody else’s does', w.standings.hyp.filter((r) => num(r[4]) !== 0).length === 2, w.standings.hyp.map((r) => r[4]));
  ok('"Lineup of" offers both squads', same(w.season.teams, ['Manager 1', 'Manager 9']), w.season.teams);
  const kept = page.prefs['decisions.whatif.99-2026'];
  ok('it is kept in the page’s prefs for this league',
    Array.isArray(kept) && kept.length === 1 && kept[0].week === 2 && kept[0].teamId === 1 && kept[0].withTeamId === 9 &&
    same(kept[0].gives, [100]) && same(kept[0].gets, [900]), kept);

  // ---- the same league on Summary
  const sum = child('summary');
  if (booted(sum, 'summary')) {
    ok('the real season is simulated with the Summary page’s inputs, runs and seed, to the letter',
      page.firstSim && same(page.firstSim, sum.call) && sum.call.runs === 100000, page.firstSim && [page.firstSim.runs, page.firstSim.seed]);
    const five = (rows) => rows.map((r) => r.slice(0, 5).map((c) => c.replace(/\s*[▲▼]$/, '')));
    ok('so "Current" is the Summary page’s chart, row for row', same(five(page.start.summary.cur), five(sum.rows)),
      [five(page.start.summary.cur)[0], five(sum.rows)[0]]);
  }

  // ---- reload: the what-if survives, and can be removed
  const prefs = { DZ_PREFS: JSON.stringify(page.prefs) };
  const again = child('reload', prefs);
  if (booted(again, 'reload')) {
    const back = again.start.list.find((r) => r.id.startsWith('whatif:'));
    ok('after a reload the what-if is still listed, with the same numbers', back && added && back.id === added.id && back.t === added.t, back);
    ok('noise, switched off before the reload, is still off', again.start.noiseOn === false &&
      Object.values(again.start.dim).every((list) => list.length === 0), again.start.noiseOn);
    ok('it has a remove button', again.hadRemove === true);
    ok('removed, it is gone from the list', !again.after.list.some((r) => r.id.startsWith('whatif:')) && again.after.list.length === 3, again.after.list.map((r) => r.id));
    ok('and from the prefs', again.prefs['decisions.whatif.99-2026'] === undefined, again.prefs);
    ok('and a real decision is picked instead', again.after.list.filter((r) => r.selected).length === 1 && again.after.groups[0] === 'Moves', again.after.groups);
  }
  const other = child('other', prefs);
  if (booted(other, 'other squad')) {
    const theirs = other.start.list.find((r) => r.id.startsWith('whatif:'));
    ok('the other squad lists the same trade, said from its side',
      other.start.team === '9' && theirs && /^Wk 2Trade Manager 9 QB0 for Manager 1 QB0 \(Manager 1\)/.test(theirs.t), theirs);
    ok('noise, left on, is on and dimming from the first paint', other.start.noiseOn === true && other.start.dim.weeks.length > 0 &&
      other.start.dim.current.length === 0, other.start.dim.weeks);
  }
}

// ---- the week in play: everything known so far is shown, in both worlds
// The record a table's Result column adds up to, as a tile prints one.
const tally = (weeks, side) => {
  const n = { W: 0, L: 0, T: 0 };
  for (const w of weeks) {
    const letters = w.c[5].split(' → ');
    const l = side === 'real' ? letters[0] : letters[letters.length - 1];
    if (l in n) n[l]++;
  }
  return `${n.W}-${n.L}${n.T ? `-${n.T}` : ''}`;
};
const agree = (s) => tally(s.weeks, 'real') === s.stats.real && tally(s.weeks, 'mirror') === s.stats.mirror;
const col4 = (rows) => rows.map((r) => r[4]);
const bare = (rows) => rows.map((r) => r.slice(0, 5).map((c) => c.replace(/\s*[▲▼]$/, '')));
const LIVE_ROWS = ['lineup-reasonable:1:all', 'lineup-perfect:1:all'];

const early = child('early');
if (booted(early, 'week in play')) {
  ok('the status line says what is counted', /: 3 finished weeks \+ week 4 so far, 5 moves\.$/.test(early.status), early.status);
  ok('and so does the line under the title', early.start.sub === 'Capture Stub League · 3 finished weeks + week 4 so far', early.start.sub);
  const ids = early.start.list.map((r) => r.id);
  ok('the week in play adds no row: the add+drop and the same two lineups, which take it in',
    same(ids, ['move:mv-adddrop', 'lineup-reasonable:1:all', 'lineup-perfect:1:all']) &&
    same(early.start.lineups, ['Reasonable', 'Perfect hindsight']), ids);
  ok('with nobody on the bench finished, hindsight adds nothing for week 4: the finished weeks’ +33.9', rowOf(early.start.list.map((r) => [r.id, r.t]), 'lineup-perfect:1:all')[1] ===
    'AlllivePerfect hindsight+1 W+33.9', early.start.list.map((r) => r.t));
  ok('LIVE sits by "All" on both lineup rows, and by no other row', same(early.start.tags.list, LIVE_ROWS), early.start.tags.list);

  // The add+drop undone, as before, with a fourth week under it.
  const a = early.addDrop;
  ok('the weekly table has the week in play, with its result, marked live',
    same(a.weeks.map((w) => w.c), [
      ['1', 'Manager 10', '114.9', '114.9', '0.0', 'W'],
      ['2', 'Manager 2', '111.1', '111.5', '+0.4', 'T → W'],
      ['3', 'Manager 3', '117.3', '115.5', '−1.8', 'L'],
      ['4live', 'Manager 4', '118.3', '118.3', '0.0', 'L'],
    ]) && same(a.tags.weeks, ['4']), a.weeks.map((w) => w.c));
  ok('and it is in the Total row', same(a.total, ['Total', '461.6', '460.2', '−1.4', '+1 W']), a.total);
  ok('the tiles count it too', same(a.stats, { real: '1-2-1', mirror: '2-2', points: perWk('−1.4', 4) }), a.stats);
  ok('THE TILES ARE THE TABLE: each record is the Result column added up', agree(a), [tally(a.weeks, 'real'), tally(a.weeks, 'mirror'), a.stats]);
  ok('season by week has the fourth column, its head marked live in both boxes', same(a.season.cur, ['Total', '114.9', '111.1', '117.3', '118.3']) &&
    same(a.season.hyp, ['Total', '114.9', '111.5', '115.5', '118.3']) && same(a.tags.season, [['4live'], ['4live']]), [a.season.cur, a.season.hyp, a.tags.season]);
  ok('every starter of squad 1 has finished: no cell is a projection', same(a.tags.proj, [[], []]), a.tags.proj);
  ok('standings count the finished matchup: squad 4 is 4–0, squad 1 1–2–1 beside 2–2',
    rowOf(a.standings.cur, 'Manager 4')[1] === '4–0' && rowOf(a.standings.cur, 'Manager 1')[1] === '1–2–1' &&
    rowOf(a.standings.hyp, 'Manager 1')[1] === '2–2', [rowOf(a.standings.cur, 'Manager 4'), rowOf(a.standings.hyp, 'Manager 1')]);
  ok('and a squad still playing has three results in both', rowOf(a.standings.cur, 'Manager 5')[1] === '1–2' && rowOf(a.standings.hyp, 'Manager 5')[1] === '1–2',
    rowOf(a.standings.cur, 'Manager 5'));

  // The chart: Summary's own, and the same treatment of the week on both sides.
  const sumEarly = child('summary-early');
  if (booted(sumEarly, 'summary, week in play')) {
    ok('"Current" is still the Summary page’s chart, row for row', same(bare(early.start.summary.cur), bare(sumEarly.rows)),
      [bare(early.start.summary.cur)[0], bare(sumEarly.rows)[0]]);
  }
  where = 'week in play';
  ok('the chart’s record is the tile’s for a squad whose matchup is over, in each world',
    rowOf(a.summary.cur, 'Manager 1')[1] === a.stats.real && rowOf(a.summary.hyp, 'Manager 1')[1] === a.stats.mirror,
    [rowOf(a.summary.cur, 'Manager 1'), rowOf(a.summary.hyp, 'Manager 1')]);
  ok('and a matchup in play is the same decimal on both sides', rowOf(a.summary.cur, 'Manager 5')[1] === '1.6-2.4' &&
    rowOf(a.summary.hyp, 'Manager 5')[1] === '1.6-2.4', [rowOf(a.summary.cur, 'Manager 5'), rowOf(a.summary.hyp, 'Manager 5')]);

  // A trade as if accepted in week 4 puts a man still playing in squad 1's
  // lineup: squad 9's QB, projected 25.5, for its own, who scored 10.1. He
  // counts for his projection: 118.3 − 10.1 + 25.5 = 133.7, +15.4.
  const w4 = early.whatIf;
  ok('a what-if on a man still playing shows his points so far in the list, marked live',
    w4.list[0].t === 'Wk 4liveTrade Manager 1 QB0 for Manager 9 QB0 (Manager 9)0+15.4' && w4.list[0].selected &&
    w4.tags.list.includes(w4.list[0].id), w4.list[0]);
  ok('its week-4 row has the totals, and "In play" for the result — the game is not final in that world',
    same(w4.weeks[3].c, ['4live', 'Manager 4', '118.3', '133.7', '+15.4', 'In play']) && !w4.weeks[3].flip, w4.weeks[3]);
  ok('the points are in the Total row and the tile; the matchup is in NEITHER record',
    same(w4.total, ['Total', '461.6', '477.0', '+15.4', '0']) && same(w4.stats, { real: '1-1-1', mirror: '1-1-1', points: '+3.9' }) && perWk(w4.total[3], 4) === '+3.9' && agree(w4),
    [w4.total, w4.stats]);
  ok('and out of both standings: squad 4 is back to 3–0 in each', rowOf(w4.standings.cur, 'Manager 4')[1] === '3–0' &&
    rowOf(w4.standings.hyp, 'Manager 4')[1] === '3–0' && same(w4.standings.cur, w4.standings.hyp), [rowOf(w4.standings.cur, 'Manager 4'), rowOf(w4.standings.hyp, 'Manager 4')]);
  ok('the hypothetical chart does not bank it either', rowOf(w4.summary.hyp, 'Manager 1')[1] === '1-1-1' && rowOf(w4.summary.hyp, 'Manager 4')[1] === '3-0',
    [rowOf(w4.summary.hyp, 'Manager 1'), rowOf(w4.summary.hyp, 'Manager 4')]);
  ok('while "Current" is unmoved', same(w4.summary.cur, early.start.summary.cur));
  ok('Season by week: the QB still playing shows his projection, marked as one, and the total counts it',
    col4(w4.season.body)[0] === 'M. 9 QB025.5' && same(w4.tags.proj, [[], ['M. 9 QB025.5']]) &&
    same(col4(w4.season.body).slice(1, 10), col4(w4.season.curBody).slice(1, 10)) &&
    w4.season.cur[4] === '118.3' && w4.season.hyp[4] === '133.7', [col4(w4.season.body), w4.season.hyp, w4.tags.proj]);

  // A squad whose own matchup is still being played: one starter finished (15.5).
  // Undoing its trade starts an RB projected 16.7 where one projected 16.8 was.
  const t5 = early.team5;
  ok('a squad still playing has the same short list: its trade and the two lineups',
    same(t5.list.map((r) => r.id), ['move:mv-trade', 'lineup-reasonable:5:all', 'lineup-perfect:5:all']), t5.list.map((r) => r.id));
  ok('its week-4 row has what is known so far, and "In play" for the result',
    same(t5.weeks[3].c, ['4live', 'Manager 3', '15.5', '15.4', '−0.1', 'In play']), t5.weeks[3]);
  ok('the Total row and the tiles: four weeks of points (388.9 + 15.5), three results', same(t5.total, ['Total', '404.4', '404.0', '−0.4', '0']) &&
    same(t5.stats, { real: '1-2', mirror: '1-2', points: perWk('−0.4', 4) }) && agree(t5), [t5.total, t5.stats]);
  ok('and the list row is the same −0.4', t5.list[0].t === 'Wk 3Traded Manager 5 RB1 for Manager 6 RB10−0.4', t5.list[0]);
  ok('Season by week: the finished man’s points plain, the other nine as projections, the total so far',
    col4(t5.season.curBody)[0] === 'M. 5 QB015.5' && t5.tags.proj[0].length === 9 && !t5.tags.proj[0].includes('M. 5 QB015.5') &&
    same(t5.tags.proj[0], col4(t5.season.curBody).slice(1, 10)) && t5.season.cur[4] === '15.5' && t5.season.hyp[4] === '15.4',
    [col4(t5.season.curBody), t5.tags.proj[0]]);
  ok('the standings leave the game in play out, as before', rowOf(t5.standings.cur, 'Manager 5')[1] === '1–2' && rowOf(t5.standings.cur, 'Manager 5')[4] === '388.9' &&
    rowOf(t5.standings.hyp, 'Manager 5')[1] === '1–2' && rowOf(t5.standings.hyp, 'Manager 5')[4] === '388.6', [rowOf(t5.standings.cur, 'Manager 5'), rowOf(t5.standings.hyp, 'Manager 5')]);

  // Nothing changed is still nothing, the week in play included.
  const e = early.empty;
  ok('an empty decision: every weekly difference is zero, the week in play too',
    e.weeks.length === 4 && e.weeks.every((x) => x.c[2] === x.c[3] && x.c[4] === '0.0' && !x.flip) &&
    same(e.weeks[3].c, ['4live', 'Manager 6', '0.0', '0.0', '0.0', 'In play']) && same(e.total, ['Total', '328.1', '328.1', '0.0', '0']),
    e.weeks.map((x) => x.c));
  ok('season by week, difference: every cell zero, the week in play too', e.season.vals.length === 44 && e.season.vals.every((v) => v === 0) &&
    same(e.season.hyp, ['Total', '0.0', '0.0', '0.0', '0.0']) && col4(e.season.body).every((c) => /0\.0$/.test(c)),
    [e.season.hyp, e.season.vals.length, col4(e.season.body)]);
  ok('standings, difference: every cell zero', allZero(e.standings.hyp), e.standings.hyp.find((r) => !allZero([r])));
  ok('the chart, difference: every cell zero', allZero(e.summary.hyp) && e.summary.hyp.every((r) => r[3] === '0.0%' && r[4] === '0.0%'), e.summary.hyp);
}

// ---- Tim's own case: the bench QB outscored the starter, one bench man to play
// Squad 1's week-4 matchup is over (118.3, a loss to squad 4). Its
// starting QB scored 10.1 and its bench QB 18.1; the free agent on its bench has
// not played. Perfect hindsight starts the bench QB: 118.3 − 10.1 + 18.1 = 126.3,
// +8.0, and the loss is a win. There is no week-4 row to pick any more: it is
// "Perfect hindsight", which takes the week in play with the finished ones
// (+11.5, +11.4, +11.0 and this +8.0 = +41.9).
const bench = child('bench');
if (booted(bench, 'bench QB, week in play')) {
  ok('perfect hindsight for the week in play is offered', bench.offered === true);
  const texts = Object.fromEntries(bench.start.list.map((r) => [r.id, r.t]));
  ok('there is no week-4 row: the list is the add+drop and the two lineups', same(bench.start.list.map((r) => r.id),
    ['move:mv-adddrop', 'lineup-reasonable:1:all', 'lineup-perfect:1:all']), bench.start.list.map((r) => r.id));
  ok('THE LIST ROW counts it (33.9 + 8.0) and the win, marked live by "All"', texts['lineup-perfect:1:all'] === 'AlllivePerfect hindsight+2 W+41.9',
    texts['lineup-perfect:1:all']);
  ok('LIVE is on the two lineup rows only', same(bench.start.tags.list, LIVE_ROWS), bench.start.tags.list);
  const h = bench.hindsight;
  ok('THE WEEK ROW shows +8.0 and the flipped result, beside the finished weeks', same(h.weeks.map((w) => w.c), [
    ['1', 'Manager 10', '114.9', '126.4', '+11.5', 'W'],
    ['2', 'Manager 2', '111.1', '122.5', '+11.4', 'T → W'],
    ['3', 'Manager 3', '117.3', '128.3', '+11.0', 'L'],
    ['4live', 'Manager 4', '118.3', '126.3', '+8.0', 'L → W'],
  ]) && same(h.weeks.map((w) => w.flip), [false, true, false, true]), h.weeks.map((w) => w.c));
  ok('THE TOTAL ROW counts it', same(h.total, ['Total', '461.6', '503.5', '+41.9', '+2 W']), h.total);
  ok('THE TILES count it, and the game counts though a bench man is still to play', same(h.stats, { real: '1-2-1', mirror: '3-1', points: perWk('+41.9', 4) }) && agree(h),
    h.stats);
  ok('LIVE by the week number: weekly table, and both Season by week heads', same(h.tags.weeks, ['4']) && same(h.tags.season, [['4live'], ['4live']]), h.tags);
  ok('Season by week: the bench QB is in the QB row with his 18.1, and the total is 126.3',
    col4(h.season.curBody)[0] === 'M. 1 QB010.1' && col4(h.season.body)[0] === 'M. 1 QB1218.1' && h.season.hyp[4] === '126.3', col4(h.season.body));
  ok('no cell is a projection: every man shown has finished', same(h.tags.proj, [[], []]), h.tags.proj);
  // Week 4's column: the QB up 8.0; RB 7 moves from FLEX to RB2 (17.4 for the
  // 11.4 there, +6.0) and RB 2 takes FLEX (11.4 for 17.4, −6.0). 8.0 in all.
  const w4 = bench.diff.season.vals.filter((_, i) => i % 4 === 3).slice(0, 10);
  ok('as a difference: +8.0 at QB, +8.0 in the total row, and week 4’s column adds up to it',
    col4(bench.diff.season.body)[0] === 'M. 1 QB12+8.0' && same(bench.diff.season.hyp, ['Total', '+11.5', '+11.4', '+11.0', '+8.0']) &&
    same(w4, [8, 0, 6, 0, 0, 0, 0, -6, 0, 0]), [col4(bench.diff.season.body), bench.diff.season.hyp, w4]);
  ok('the game is final in both worlds, so the standings and the chart count it: 3–1, squad 4 3–1',
    rowOf(h.standings.hyp, 'Manager 1')[1] === '3–1' && rowOf(h.standings.hyp, 'Manager 4')[1] === '3–1' &&
    rowOf(h.summary.hyp, 'Manager 1')[1] === '3-1' && rowOf(h.summary.cur, 'Manager 1')[1] === '1-2-1',
    [rowOf(h.standings.hyp, 'Manager 1'), rowOf(h.summary.hyp, 'Manager 1')]);
}

// The same league with that last bench man finished: nothing is partial.
const done = child('bench-all');
if (booted(done, 'bench QB, everybody finished')) {
  const h = done.hindsight;
  ok('the same +8.0 everywhere', same(h.weeks[3].c, ['4', 'Manager 4', '118.3', '126.3', '+8.0', 'L → W']) &&
    same(h.total, ['Total', '461.6', '503.5', '+41.9', '+2 W']) && same(h.stats, { real: '1-2-1', mirror: '3-1', points: perWk('+41.9', 4) }), [h.weeks[3], h.total, h.stats]);
  ok('and NO live tag anywhere on the page', h.tags.all === 0 && done.diff.tags.all === 0 && same(h.tags.weeks, []) && same(h.tags.list, []) &&
    same(h.tags.season, [[], []]), h.tags);
  ok('the list row reads without it', h.list.find((r) => r.id === 'lineup-perfect:1:all').t === 'AllPerfect hindsight+2 W+41.9' &&
    h.list.length === 3, h.list.map((r) => r.t));
}

// ---- ALL USERS: every team sets the same lineup, every week
// The hand numbers are in the header: squad 7 under "Reasonable" is 103.3,
// 107.3 and 110.5 (+35.9). Alone it stays 1-2; with every team doing it, squad
// 8's 111.3 beats that 110.5 and squad 7 is 0-3.
const recOf = (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;
const signed = (n) => `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(1)}`;
const ALL_IDS = ['lineup-reasonable:all:all', 'lineup-perfect:all:all'];
const MINE = ['move:mv-adddrop', 'lineup-reasonable:1:all', 'lineup-perfect:1:all'];
/** The page's one-row-a-team table against the engine asked directly. */
const drawsEngine = (snapshot, facts) => facts.length === 10 && facts.every((t) => {
  const row = snapshot.all.rows.find((r) => r[0].replace(/live$/, '') === t.name) || [];
  return row[1] === recOf(t.real) && row[2] === recOf(t.mirror) && row[4] === perWk(signed(t.points), t.weeks) &&
    snapshot.all.live.length === facts.filter((x) => x.live).length;
});
const everyone = child('all');
if (booted(everyone, 'all users')) {
  ok('"All users" is a switch in the same small group as the team picker',
    same(everyone.control, { type: 'checkbox', role: 'switch', label: 'All users', byPicker: true }), everyone.control);
  ok('off, the page is one team’s: its list, its week table and tiles, the what-if form',
    same(everyone.start.list.map((r) => r.id), MINE) && same(everyone.start.all.shown, [false, true, true, true]) &&
    everyone.start.all.on === false && everyone.start.all.options === 10, [everyone.start.list.map((r) => r.id), everyone.start.all]);

  // Squad 7 alone, for the hand check.
  const seven = everyone.seven;
  ok('squad 7 alone, Reasonable: the hand numbers, and still 1-2', same(seven.weeks.map((w) => w.c), [
    ['1', 'Manager 4', '92.0', '103.3', '+11.3', 'L'],
    ['2', 'Manager 6', '98.4', '107.3', '+8.9', 'L'],
    ['3', 'Manager 8', '94.8', '110.5', '+15.7', 'W'],
  ]) && same(seven.total, ['Total', '285.2', '321.1', '+35.9', '0']) && same(seven.stats, { real: '1-2', mirror: '1-2', points: '+12.0' }),
  [seven.weeks.map((w) => w.c), seven.total, seven.stats]);

  const on = everyone.on;
  ok('ON: the switch is set and the picker says "All users"', on.all.on === true && on.all.picker === 'All users', on.all);
  ok('the list is the two lineup choices and nothing else: no moves, no trades, no what-ifs',
    same(on.list.map((r) => r.id), ALL_IDS) && same(on.groups, ['Lineups']) && same(on.lineups, ['Reasonable', 'Perfect hindsight']) &&
    on.list.filter((r) => r.selected).length === 1 && on.list[0].selected, [on.list, on.groups]);
  ok('the what-if form, the week table and the tiles give way to one row a team', same(on.all.shown, [true, false, false, false]), on.all.shown);
  const REASONABLE = [
    ['Manager 4', '3-0', '3-0', '0', '+36.1'],
    ['Manager 6', '3-0', '3-0', '0', '+40.9'],
    ['Manager 10', '2-1', '1-2', '−1 W', '+17.1'],
    ['Manager 1', '1-1-1', '2-1', '+1 W', '+23.0'],
    ['Manager 5', '1-2', '2-1', '+1 W', '+51.6'],
    ['Manager 3', '1-2', '1-2', '0', '+29.2'],
    ['Manager 8', '1-2', '2-1', '+1 W', '+31.1'],
    ['Manager 9', '1-2', '1-2', '0', '+22.7'],
    ['Manager 7', '1-2', '0-3', '−1 W', '+35.9'],
    ['Manager 2', '0-2-1', '0-3', '+1 L', '+23.0'],
  ];
  // The table's last column is points a WEEK: each season figure over the 3 weeks.
  ok('REASONABLE, every team: actual record, hypothetical record, the change, the points a week',
    same(on.all.rows, eachWeek(REASONABLE, 3)) && rowOf(on.all.rows, 'Manager 9')[4] === '+7.6' && rowOf(on.all.rows, 'Manager 7')[4] === '+12.0', on.all.rows);
  // THE LINEUP COUNTS (Tim, 2026-10-07): Bench on both lineup decisions, Proj 0 on Reasonable only.
  {
    const add = (rows, i) => rows.reduce((a, r) => a + r[i], 0);
    const sc = seven.counts;
    const pc = everyone.sevenPerfect.counts;
    ok('REASONABLE, one team: Bench and Proj 0 a week, and the Total row adds them up',
      same(sc.weekHeads, ['Bench', 'Proj 0']) && sc.weeks.length === 3 && sc.weeks.every((r) => r.length === 2 && r.every(Number.isInteger)) &&
      same(sc.total, [add(sc.weeks, 0), add(sc.weeks, 1)]) && sc.total[0] > 0, sc);
    ok('PERFECT, one team: Bench only', same(pc.weekHeads, ['Bench']) && pc.weeks.every((r) => Number.isInteger(r[0]) && r[1] === null) &&
      pc.total[0] === add(pc.weeks, 0) && pc.total[0] > 0 && pc.total[1] === null, pc);
    ok('ALL USERS: each team’s counts are its season’s — squad 7 the same totals as alone',
      same(on.counts.teamHeads, ['Bench', 'Proj 0']) && same(on.counts.teams['7'], sc.total) &&
      same(everyone.perfect.counts.teamHeads, ['Bench']) && everyone.perfect.counts.teams["7"][0] === pc.total[0], [on.counts, everyone.perfect.counts.teams]);
    ok('a move has neither column', same(everyone.start.counts.weekHeads, []) && everyone.start.counts.weeks.every((r) => r.every((v) => v === null)), everyone.start.counts);
  }
  ok('and its last heading says so', same(on.labels.teams, ['Team', 'Actual', 'Hypothetical', 'Record', 'Points/wk']), on.labels);
  ok('squad 7: the same +35.9 (+12.0 a week) as alone, but 0-3 — squad 8’s 111.3 now beats its 110.5',
    rowOf(on.all.rows, 'Manager 7')[4] === seven.stats.points && rowOf(on.all.rows, 'Manager 7')[2] === '0-3' && seven.stats.mirror === '1-2',
    [rowOf(on.all.rows, 'Manager 7'), seven.stats]);
  ok('in the order of the Standings table', same(on.all.rows.map((r) => r[0]), on.standings.cur.map((r) => r[0])), on.standings.cur.map((r) => r[0]));
  ok('the list rows carry the league’s points, and no record', same(on.list.map((r) => r.t), ['AllReasonable+310.6', 'AllPerfect hindsight+427.3']) &&
    Math.round(REASONABLE.reduce((a, r) => a + num(r[4]), 0) * 10) / 10 === 310.6, on.list.map((r) => r.t));
  ok('no week is in play: no live tag', on.tags.all === 0 && on.all.live.length === 0, on.tags);
  ok('the table is the engine’s all-teams result, drawn', drawsEngine(on, everyone.engine['lineup-reasonable']), everyone.engine['lineup-reasonable']);

  const d = everyone.onDiff;
  ok('standings, as a difference: each team’s record and points change are the table’s',
    same(d.standings.hyp.map((r) => [r[0], r[1], r[4]]), REASONABLE.map((r) => [r[0], r[3], r[4]])), d.standings.hyp.map((r) => [r[0], r[1], r[4]]));
  ok('the chart, as a difference: each team’s record change is the table’s', d.summary.hyp.length === 10 &&
    d.summary.hyp.every((r) => r[1] === rowOf(REASONABLE, r[0])[3]), d.summary.hyp.map((r) => r.slice(0, 2)));
  ok('"Current" does not move with the mode: the same chart as before the switch',
    same(bare(on.summary.cur), bare(everyone.before.summary.cur)) && same(on.standings.cur, everyone.before.standings.cur), on.summary.cur[0]);
  ok('Season by week offers every team, starting on mine', same(on.season.teams, REASONABLE.map((r) => r[0]).sort((a, b) => num(a) - num(b))) &&
    on.season.teamRowHidden === false && same(on.season.cur, ['Total', '114.9', '111.1', '117.3']), [on.season.teams, on.season.cur]);
  ok('squad 7 picked there: the hand numbers week by week', same(everyone.season7.season.hyp, ['Total', '+11.3', '+8.9', '+15.7']), everyone.season7.season.hyp);

  const pf = everyone.perfect;
  const PERFECT = [
    ['Manager 4', '3-0', '3-0', '0', '+48.3'],
    ['Manager 6', '3-0', '3-0', '0', '+53.5'],
    ['Manager 10', '2-1', '1-2', '−1 W', '+32.4'],
    ['Manager 1', '1-1-1', '1-2', '+1 L', '+33.9'],
    ['Manager 5', '1-2', '2-1', '+1 W', '+58.4'],
    ['Manager 3', '1-2', '1-2', '0', '+41.8'],
    ['Manager 8', '1-2', '1-1-1', '−1 L', '+36.6'],
    ['Manager 9', '1-2', '1-2', '0', '+33.2'],
    ['Manager 7', '1-2', '0-2-1', '−1 W', '+48.1'],
    ['Manager 2', '0-2-1', '1-2', '+1 W', '+41.1'],
  ];
  ok('PERFECT HINDSIGHT, every team', same(pf.all.rows, eachWeek(PERFECT, 3)) && pf.list[1].selected && pf.lede === 'Every team, every week, perfect hindsight.',
    [pf.all.rows, pf.lede]);
  ok('nobody scores less with hindsight, and no less than with projections', PERFECT.every((r, i) => num(r[4]) >= num(REASONABLE[i][4]) && num(r[4]) >= 0));
  ok('squad 1 and squad 7: the same points as each one’s own "Perfect hindsight" row',
    rowOf(PERFECT, 'Manager 1')[4] === '+33.9' && /\+33\.9$/.test(everyone.start.list[2].t) &&
    rowOf(pf.all.rows, 'Manager 7')[4] === everyone.sevenPerfect.stats.points && everyone.sevenPerfect.stats.points === perWk('+48.1', 3) && everyone.sevenPerfect.stats.mirror === '2-1',
    [everyone.start.list[2].t, everyone.sevenPerfect.stats]);
  ok('it too is the engine’s result, drawn', drawsEngine(pf, everyone.engine['lineup-perfect']), everyone.engine['lineup-perfect']);
  ok('standings and the chart follow the choice', same(pf.standings.hyp.map((r) => [r[0], r[1], r[4]]), PERFECT.map((r) => [r[0], r[3], r[4]])) &&
    pf.summary.hyp.every((r) => r[1] === rowOf(PERFECT, r[0])[3]), pf.standings.hyp.map((r) => [r[0], r[1], r[4]]));
  ok('"Display noise" still switches, and the table stays', everyone.noise.noiseOn === true && everyone.noise.all.on === true &&
    same(everyone.noise.all.rows, eachWeek(PERFECT, 3)), everyone.noise.noiseOn);

  // Remembered, and undone both ways.
  ok('the mode is remembered for this league', everyone.prefsOn['decisions.all.99-2026'] === true, everyone.prefsOn);
  const kept = child('plain', { DZ_PREFS: JSON.stringify(everyone.prefsOn) });
  if (booted(kept, 'all users, reloaded')) {
    ok('after a reload All users is still on, with the same table', kept.start.all.on === true && same(kept.start.all.rows, eachWeek(REASONABLE, 3)) &&
      same(kept.start.list.map((r) => r.id), ALL_IDS) && same(kept.start.all.shown, [true, false, false, false]), kept.start.all);
  }
  where = 'all users';
  for (const [name, s] of [['a team picked in the picker', everyone.back], ['the switch turned off', everyone.off]]) {
    ok(`${name}: that team’s own list and tables are back`, s.all.on === false && s.all.picker === 'Manager 1' && s.all.options === 10 &&
      same(s.list.map((r) => r.id), MINE) && same(s.all.shown, [false, true, true, true]) && same(s.weeks, everyone.start.weeks) &&
      same(s.stats, everyone.start.stats), [s.all.on, s.list.map((r) => r.id), s.all.shown]);
  }
  ok('and it is no longer remembered', everyone.prefsBack['decisions.all.99-2026'] === undefined, everyone.prefsBack);

  // The page saves no selection, so an old week's lineup can only come back as
  // a stale key: it must not stop the page, and the first row is picked.
  const stale = child('plain', { DZ_PREFS: JSON.stringify({ ...everyone.prefsBack, 'decisions.selected.99-2026': 'lineup-perfect:1:2' }) });
  if (booted(stale, 'an old week’s lineup in the prefs')) {
    ok('the page shows squad 1’s list with its first row picked', same(stale.start.list.map((r) => r.id), MINE) &&
      stale.start.list[0].selected && stale.start.weeks.length === 3, stale.start.list);
  }
}

// The same on the week in play (squad 1's bench QB case): every team's row
// counts what is known, and says so.
const liveAll = child('all-early');
if (booted(liveAll, 'all users, week in play')) {
  const on = liveAll.on;
  const pf = liveAll.perfect;
  ok('every row is marked live, and both list rows', on.all.live.length === 10 && same(on.tags.list, ALL_IDS) &&
    on.all.rows.every((r) => /live$/.test(r[0])), [on.all.live, on.tags.list]);
  ok('Reasonable is the engine’s result, drawn', drawsEngine(on, liveAll.engine['lineup-reasonable']), on.all.rows);
  ok('Perfect hindsight is the engine’s result, drawn', drawsEngine(pf, liveAll.engine['lineup-perfect']), pf.all.rows);
  ok('squad 1, hindsight: the finished weeks’ +33.9 and the bench QB’s +8.0; squad 4 improved too, so the loss stands',
    same(rowOf(pf.all.rows, 'Manager 1live'), ['Manager 1live', '1-2-1', '1-3', '+1 L', '+10.5']) && perWk('+41.9', 4) === '+10.5', rowOf(pf.all.rows, 'Manager 1live'));
  ok('squad 7: the same points as alone, in both choices',
    rowOf(on.all.rows, 'Manager 7live')[4] === liveAll.seven.stats.points && rowOf(pf.all.rows, 'Manager 7live')[4] === liveAll.sevenPerfect.stats.points,
    [rowOf(on.all.rows, 'Manager 7live'), liveAll.seven.stats, liveAll.sevenPerfect.stats]);
  ok('Season by week still marks week 4 live', same(on.tags.season, [['4live'], ['4live']]) && on.season.cur.length === 5, on.tags.season);
  ok('off again: squad 1’s list, the two lineups live', same(liveAll.off.list.map((r) => r.id), MINE) && same(liveAll.off.tags.list, LIVE_ROWS), liveAll.off.tags.list);
}

// ---- where a difference comes from
//
// Tim, 2026-10-06: "it shows valuable information, but it's really hard to know
// where that data is coming from or the specifics on when the user started
// someone with less points or whatever." Every week's Diff opens the men behind
// it; the biggest swap is said under the tiles; with all users on a team's
// Points/wk opens its weeks. The hand numbers are squad 7's "Reasonable", from
// the top of this file: each man out and in, and what the pair is worth.
const WEEK_COLS = ['Slot', 'Started', 'Instead', '+/−'];
const cents = (n) => Math.round(n * 100) / 100;
/** A week's card against its own row: the swaps add up to the Diff, and the foot is the row's. */
const cardAddsUp = (w) => {
  const c = w.card;
  if (!c.open || !same(c.cols, WEEK_COLS) || c.close !== 'Close' || !w.shut) return false;
  const swaps = c.rows.filter((r) => r.length === 4);
  const foot = Object.fromEntries(c.foot);
  const sum = cents(swaps.reduce((a, r) => a + num(r[3]), 0) + (foot.Rounding ? num(foot.Rounding) : 0));
  return c.head.replace('live', '').startsWith(`Week ${num(w.row[0])} · vs ${w.row[1]}`) &&
    sum === num(w.row[4]) && foot.Diff === w.row[4] && foot.Actual === w.row[2] && foot.Hypothetical === w.row[3] &&
    // Each swap's own figure is its two men's points, apart.
    swaps.every((r) => cents(num(r[2].match(/−?[\d.]+$/)[0]) - num(r[1].match(/−?[\d.]+$/)[0])) === num(r[3])) &&
    (swaps.length > 0 || same(c.rows, [['Same lineup']]));
};
/** One reader's state: every card adds up, the tile is the Total over its weeks, the line is the costliest week's. */
const stateAddsUp = (s) => {
  const far = s.weeks.reduce((a, w) => (Math.abs(num(w.row[4])) > Math.abs(num(a.row[4])) ? w : a), s.weeks[0]);
  const top = num(far.row[4]) === 0 ? null : far.card.rows.reduce((a, r) => (Math.abs(num(a[3])) >= Math.abs(num(r[3])) ? a : r));
  return s.weeks.every(cardAddsUp) && s.stats.points === perWk(s.total[3], s.weeks.length) &&
    (top
      ? s.big.shown && s.big.wk === String(num(far.row[0])) && s.big.t === `Biggest swapWk ${s.big.wk} · ${top[1]} → ${top[2]}${top[3]}`
      : !s.big.shown && s.big.wk === null);
};
for (const [run, weeksHeld] of [['why', 3], ['why-early', 4]]) {
  const why = child(run);
  if (!booted(why, run === 'why' ? 'where a difference comes from' : 'where a difference comes from, week in play')) continue;
  const all = ['start', 'addDrop', 'seven', 'sevenPerfect', 'onePerfect', 'empty'];
  ok('every week’s Diff opens a card whose swaps add up to it, under that week’s Actual and Hypothetical; leaving shuts it',
    all.every((k) => why[k].weeks.length === weeksHeld && stateAddsUp(why[k])), all.filter((k) => !stateAddsUp(why[k])).map((k) => [k, why[k]]));
  ok('a decision that changes no lineup: every card says "Same lineup", and there is no Biggest swap line',
    why.empty.weeks.every((w) => same(w.card.rows, [['Same lineup']])) && why.empty.big.shown === false && why.empty.big.t === 'Biggest swap', why.empty.big);
  ok('with a team picked the line is shown; with all users on it is put away', why.addDrop.big.hidden === false && why.all.big.hidden === true, why.all.big);
  ok('ALL USERS: each Points/wk opens that team’s weeks, their Total, and the Total over those weeks',
    why.all.teams.length === 10 && why.all.teams.every((t) => {
      const c = t.card;
      const name = t.row[0].replace(/live$/, '');
      return c.open && t.shut && same(c.cols, ['Wk', 'Actual', 'Hypothetical', 'Diff']) && c.head === `${name} · ${weeksHeld} weeks` &&
        c.rows.length === weeksHeld && c.foot[0][0] === 'Total' && cents(c.rows.reduce((a, r) => a + num(r[3]), 0)) === num(c.foot[0][3]) &&
        same(c.foot[1], ['Points/wk', t.row[4]]) && t.row[4] === perWk(c.foot[0][3], weeksHeld) && Number(t.v) === num(t.row[4]);
    }), why.all.teams.map((t) => [t.row, t.v, t.card.foot]));
  ok('a finger gets that as a sheet too, and picking the other lineup shuts what was open',
    why.all.sheet && why.all.sheet.cls === 'dz-pop sheet' && why.all.sheet.head === `Manager 7 · ${weeksHeld} weeks` && why.all.afterPick === false,
    [why.all.sheet, why.all.afterPick]);

  if (run === 'why') {
    const s7 = why.seven;
    ok('squad 7, Reasonable, by hand: who sat, who starts instead, and what each pair is worth', same(s7.weeks.map((w) => w.card.rows), [
      [['RB', 'M. 7 RB1 8.0', 'M. 7 RB10 10.1', '+2.1'], ['WR', 'M. 7 WR5 5.6', 'M. 7 WR11 14.8', '+9.2']],
      [['RB', 'M. 7 RB1 6.8', 'M. 7 RB10 9.5', '+2.7'], ['WR', 'M. 7 WR3 7.2', 'M. 7 WR11 6.6', '−0.6'], ['TE', 'M. 7 TE6 7.1', 'M. 7 TE13 13.9', '+6.8']],
      [['QB', 'M. 7 QB0 15.3', 'M. 7 QB12 21.1', '+5.8'], ['FLEX', 'M. 7 RB7 8.3', 'M. 7 RB10 18.2', '+9.9']],
    ]) && same(s7.weeks.map((w) => w.card.foot[w.card.foot.length - 1]), [['Diff', '+11.3'], ['Diff', '+8.9'], ['Diff', '+15.7']]), s7.weeks.map((w) => w.card.rows));
    ok('its Biggest swap: week 3 (+15.7) is its costliest, and the FLEX swap the larger one there',
      same(s7.big, { t: 'Biggest swapWk 3 · M. 7 RB7 8.3 → M. 7 RB10 18.2+9.9', wk: '3', tag: 'BUTTON', shown: true, hidden: false }), s7.big);
    ok('the add+drop: one swap a week, and the line names week 3’s −1.8', same(why.addDrop.weeks.map((w) => w.card.rows), [
      [['Same lineup']], [['WR', 'M. 1 WR4 7.8', 'M. 1 WR11 8.2', '+0.4']], [['WR', 'M. 1 WR4 9.7', 'M. 1 WR11 7.9', '−1.8']],
    ]) && why.addDrop.big.t === 'Biggest swapWk 3 · M. 1 WR4 9.7 → M. 1 WR11 7.9−1.8', [why.addDrop.weeks.map((w) => w.card.rows), why.addDrop.big]);
    ok('the Diff is a button a keyboard reaches, and says what it opens',
      same(why.handle, { tab: '0', role: 'button', label: 'Week 2: the players behind this difference' }), why.handle);
    const card = { open: true, cls: 'dz-pop', head: 'Week 2 · vs Manager 2' };
    const is = (got, want) => Object.keys(want).every((k) => got[k] === want[k]);
    ok('a mouse: a click or Enter opens the card; Escape, a click elsewhere and leaving the number each shut it',
      is(why.clicked, card) && why.afterEscape === false && why.afterOutside === false && is(why.afterEnter, card) &&
      why.focused === true && why.afterBlur === false, [why.clicked, why.afterEscape, why.afterOutside, why.focused, why.afterBlur]);
    ok('the Biggest swap line opens its own week', is(why.bigOpened, { open: true, head: 'Week 3 · vs Manager 3' }) &&
      same(why.bigOpened.rows, [['WR', 'M. 1 WR4 9.7', 'M. 1 WR11 7.9', '−1.8']]), why.bigOpened);
    ok('a finger: hovering does nothing, a tap opens a sheet with Close, and Close shuts it',
      why.touchOver === false && is(why.sheet, { open: true, cls: 'dz-pop sheet', head: 'Week 2 · vs Manager 2', close: 'Close' }) && why.afterClose === false,
      [why.touchOver, why.sheet, why.afterClose]);
  } else {
    const w4 = why.onePerfect.weeks[3];
    ok('Tim’s bench QB, in the week in play: the +8.0 is one swap, QB for QB, and the card is marked live',
      same(w4.card.rows, [['QB', 'M. 1 QB0 10.1', 'M. 1 QB12 18.1', '+8.0']]) && w4.card.head === 'Week 4live · vs Manager 4' &&
      why.onePerfect.stats.points === '+10.5', [w4.card, why.onePerfect.stats]);
    ok('all users: a team’s card marks the week in play', why.all.teams.every((t) => t.card.rows[3][0] === '4live'), why.all.teams[0].card.rows);
  }
}

// ---- a league that scores in hundredths: one decimal, and it adds up as printed
//
// Audit, 2026-10-06, on Tim's league: the week table read "121.94 | 121.94"
// on one line and "106.1 | 111.1" on the next. Every Actual, Hypothetical and
// Total is one decimal now, like every other table on the site, and a row's
// Diff is the difference of the two numbers PRINTED beside it. The men behind
// it keep their hundredths, with a "Rounding" line where they need one to add
// up. The stub prints one decimal whatever the page does, so this is the stub
// with cents put on every score (`scoreInCents`).
{
  const c = child('why-cents');
  if (booted(c, 'a league that scores in hundredths')) {
    const states = ['start', 'addDrop', 'seven', 'sevenPerfect', 'onePerfect', 'empty'];
    const one = (s) => /^\d+\.\d$/.test(String(s).replace(/live$/, ''));
    const diff = (s) => /^([+−]\d+\.\d|0\.0)$/.test(s);
    const asPrinted = (a, h, d) => one(a) && one(h) && diff(d) && Math.round((num(h) - num(a)) * 10) / 10 === num(d);
    const rows = states.flatMap((k) => c[k].weeks.map((w) => w.row));
    const men = states.flatMap((k) => c[k].weeks.flatMap((w) => w.card.rows.filter((r) => r.length === 4)));
    ok('the fixture is what it says: men score in hundredths here', men.some((r) => /\.\d\d$/.test(r[1]) || /\.\d\d$/.test(r[2])), men.slice(0, 3));
    ok('every week’s Actual and Hypothetical is one decimal, and its Diff is the difference of those two',
      rows.length === 18 && rows.every((r) => asPrinted(r[2], r[3], r[4])), rows.filter((r) => !asPrinted(r[2], r[3], r[4])));
    ok('the Total row too', states.every((k) => asPrinted(c[k].total[1], c[k].total[2], c[k].total[3])), states.map((k) => c[k].total));
    ok('a week’s card: its foot is the row’s three numbers, and the swaps with their Rounding line add up to the Diff',
      states.every((k) => c[k].weeks.every(cardAddsUp)), states.flatMap((k) => c[k].weeks.filter((w) => !cardAddsUp(w))).slice(0, 2));
    const feet = states.flatMap((k) => c[k].weeks.map((w) => Object.fromEntries(w.card.foot)));
    ok('Rounding is said where the hundredths leave something over, and only there',
      feet.some((f) => 'Rounding' in f) && feet.some((f) => !('Rounding' in f)) && feet.every((f) => !('Rounding' in f) || num(f.Rounding) !== 0),
      feet.map((f) => f.Rounding));
    ok('ALL USERS: a team’s card is one decimal a week and in its Total, each Diff the difference as printed',
      c.all.teams.length === 10 && c.all.teams.every((t) => t.card.rows.length === 3 && t.card.rows.every((r) => asPrinted(r[1], r[2], r[3])) &&
        asPrinted(t.card.foot[0][1], t.card.foot[0][2], t.card.foot[0][3])),
      c.all.teams.filter((t) => !t.card.rows.every((r) => asPrinted(r[1], r[2], r[3]))).slice(0, 2).map((t) => [t.card.rows, t.card.foot]));
  }
}

// ---- the phone: the tables this page owns fit a 393px screen
//
// linkedom lays nothing out, so the widths themselves are measured in Safari's
// engine (phone-view, 2026-10-06, Tim's league: Season by week 34px and 16px
// too wide before, 0 after; the week table 1px, 4px sorted, 0 after). What is
// held here is that the rules are in the page, inside its phone block only —
// so nothing at laptop width moved.
{
  where = 'phone';
  const css = html('decisions.html');
  const blocks = [];
  for (let at = css.indexOf('@media (max-width: 760px)'); at >= 0; at = css.indexOf('@media (max-width: 760px)', at + 1)) {
    let depth = 0;
    let end = css.indexOf('{', at);
    do { depth += css[end] === '{' ? 1 : css[end] === '}' ? -1 : 0; end++; } while (depth > 0 && end < css.length);
    blocks.push(css.slice(at, end));
  }
  const phone = blocks.join('\n');
  const rest = blocks.reduce((s, b) => s.replace(b, ''), css);
  const has = (re) => re.test(phone);
  ok('Season by week on a phone: the columns share the panel, 4px a side, and a long name ends in an ellipsis',
    has(/\.dz-fit \.sbw-actual \{[^}]*table-layout: fixed;[^}]*width: 100%;/) &&
    has(/\.dz-fit \.sbw-actual th, \.dz-fit \.sbw-actual td \{ padding-left: 4px; padding-right: 4px; \}/) &&
    has(/\.dz-fit \.sbw-actual td\.wk \.sbw-name \{[^}]*text-overflow: ellipsis;/), phone.length);
  ok('the week table and the one-row-a-team table: 4px a side, and the name gives way to a sorted heading’s arrow',
    has(/\.dz-weeks th, \.dz-weeks td \{ padding-left: 4px; padding-right: 4px; \}/) &&
    has(/\.dz-weeks:has\(th\.sorted\) td\.dz-vs \{ max-width: 0; width: 100%; \}/) &&
    has(/\.dz-weeks\.dz-teams th \{ padding-left: 3px; padding-right: 3px; \}/), phone.length);
  ok('none of it outside the phone block: laptop width is as it was',
    !/\.dz-fit \.sbw-actual/.test(rest) && !/has\(th\.sorted\)/.test(rest), '');
}

// ---- Season by week: what changed, the projection, the Avg, and the way there
//
// Tim, 2026-10-06 (the `lineups` child). Each fact is read off the page and
// worked again here: who is marked against the week previews' own names, a
// projection against the stub's world, an Avg from the row's printed numbers.
for (const run of ['lineups', 'lineups-early', 'lineups-cents']) {
  const L = child(run);
  if (!booted(L, run)) continue;
  const names = (list) => [...list].sort();
  const marked = (h, wk) => names(h.rows.flatMap((r) => r.cells).filter((c) => c.chg && c.wk === wk).map((c) => c.name));
  const tenth = (n) => Math.round(n * 10) / 10;
  const meanShown = (row) => {
    const got = row.cells.map((c) => num(c.shown)).filter((v) => v !== null);
    return got.length ? tenth(got.reduce((a, b) => a + b, 0) / got.length).toFixed(1) : '—';
  };
  const bad = { marks: [], proj: [], said: [], twice: [], sorts: [], avg: [], avgDiff: [], place: [] };
  let marks = 0;
  let projs = 0;
  let avgs = 0;
  let inPlay = 0;
  for (const c of L.cases) {
    for (const pv of c.previews) {
      // The men the preview names ARE the men marked: Started in Current,
      // Instead in the hypothetical — and as a Difference too.
      const short = (n) => n;
      if (!same(marked(c.cur, pv.wk), names(pv.started.map(short))) || !same(marked(c.hyp, pv.wk), names(pv.instead.map(short))) ||
        !same(marked(c.diff, pv.wk), names(pv.instead.map(short)))) {
        bad.marks.push([c.id, pv.wk, marked(c.cur, pv.wk), pv.started, marked(c.hyp, pv.wk), pv.instead, marked(c.diff, pv.wk)]);
      }
      marks += pv.started.length + pv.instead.length;
    }
    for (const h of [c.cur, c.hyp]) {
      for (const r of h.rows) {
        for (const x of r.cells.filter((k) => k.pid)) {
          if (x.inPlay) { inPlay++; if (x.pj !== null) bad.twice.push([c.id, r.slot, x.wk, x.pj, x.shown]); continue; }
          projs++;
          if (x.want === null || x.pj !== Number(x.want).toFixed(1) || x.whole !== String(Math.round(x.want)) || !x.pjFirst || x.lines) {
            bad.proj.push([c.id, r.slot, x.wk, x.pj, x.want, x.whole, x.pjFirst]);
          }
          if (!x.title.includes(`proj ${x.pj}, scored ${x.shown}`)) bad.said.push([c.id, r.slot, x.wk, x.title]);
          // Sorting and the scale stay on the score.
          if (Number(Number(x.v).toFixed(1)) !== num(x.shown)) bad.sorts.push([c.id, r.slot, x.wk, x.v, x.shown]);
        }
        avgs++;
        if (!r.avg || r.avg.t !== meanShown(r)) bad.avg.push([c.id, r.slot, r.avg, meanShown(r)]);
        if (!r.avg || !r.avg.last) bad.place.push([c.id, r.slot]);
      }
      const last = h.head[h.head.length - 1];
      if (!last || last.t !== 'Avg' || !last.sort || h.head[0].t !== 'Slot' || h.head[1].t !== '1') bad.place.push([c.id, h.head.map((x) => x.t)]);
    }
    // As a Difference: no projection, and the Avg is the two Avgs' difference as printed.
    c.diff.rows.forEach((r, i) => {
      if (r.cells.some((x) => x.pj !== null)) bad.twice.push([c.id, 'diff', r.slot]);
      const [a, b] = [c.hyp.rows[i].avg, c.cur.rows[i].avg];
      const want = a && b ? tenth(num(a.t) - num(b.t)) : null;
      if (!r.avg || want === null || num(r.avg.t) !== want || !/^([+−]\d|0\.0)/.test(r.avg.t)) bad.avgDiff.push([c.id, r.slot, r.avg, want]);
    });
  }
  ok('six decisions are read, each with its Difference', L.cases.length === 6 && L.cases.every((c) => c.diff.diff && !c.hyp.diff), L.cases.map((c) => c.id));
  ok(`WHAT CHANGED: in every week of every one, the cells marked are exactly the preview’s Started (Current) and Instead (Hypothetical, Difference) — ${marks} men`,
    marks >= 20 && bad.marks.length === 0, bad.marks.slice(0, 3));
  ok(`THE PROJECTION: before every score, on the same line, and it is that man’s projection for that week (${projs} cells), with it to the whole point for a phone`,
    projs > 300 && bad.proj.length === 0, bad.proj.slice(0, 4));
  ok('and the cell says both numbers in words', bad.said.length === 0, bad.said.slice(0, 3));
  ok('a man still playing shows his projection once, and a Difference shows none',
    bad.twice.length === 0 && (run === 'lineups-early' ? inPlay > 0 : inPlay === 0), [inPlay, bad.twice.slice(0, 3)]);
  ok('sorting and the colour scale stay on the score, not the projection', bad.sorts.length === 0, bad.sorts.slice(0, 3));
  ok(`AVG: the mean of the numbers the row shows, in every row and the Total (${avgs} rows)`, avgs >= 132 && bad.avg.length === 0, bad.avg.slice(0, 4));
  ok('it is the last column, after the last week, and its heading sorts', bad.place.length === 0, bad.place.slice(0, 3));
  ok('as a Difference it is the two Avgs’ difference as printed, signed', bad.avgDiff.length === 0, bad.avgDiff.slice(0, 4));
  const sortedAvg = L.avgSort.cur.map((r) => r[1]);
  ok('a click on Avg sorts the lineup by it, best first, the other half in the same order, Total at the foot',
    L.avgSort.head && sortedAvg.length === 10 && sortedAvg.every((v, i) => i === 0 || sortedAvg[i - 1] >= v) && sortedAvg[0] > sortedAvg[9] &&
    same(L.avgSort.cur.map((r) => r[0]), L.avgSort.hyp.map((r) => r[0])) && L.avgSort.total === 'Total', L.avgSort);

  // ---- from a preview to the lineups
  const weeks = L.cases[0].previews.length;
  const column = (o, wk) => o.outlined.every((h) => same(h.head, [String(wk)]) && same(h.weeks, [wk]) && h.cells === h.rows);
  const none = (o) => o.outlined.every((h) => h.head.length === 0 && h.cells === 0);
  ok('a mouse over a week’s Diff has its card open, with no button in reach of nothing', L.cardOpen.open && !/sheet/.test(L.cardOpen.cls), L.cardOpen);
  ok('A CLICK ON THE NUMBER WITH ITS PREVIEW OPEN goes to Season by week: the preview shuts, the panel is scrolled to, smoothly',
    L.mouse.pop === false && L.mouse.scrolls === 1 && same(L.mouse.how, { behavior: 'smooth', block: 'start' }), L.mouse);
  ok('and that week’s column is outlined in both halves, heading to Total — the same team, the same decision',
    column(L.mouse, 2) && L.mouse.seasonTeam === '1' && L.mouse.team === '1' && L.mouse.picked === 'lineup-reasonable:1:all', L.mouse);
  ok('the outline stays until the next click, and then goes', none(L.afterNextClick) && L.afterNextClick.scrolls === 1, L.afterNextClick.outlined);
  ok('the keyboard: focus opens the card, Enter goes on, to that week', L.focusOpen === true && L.keyboard.pop === false && L.keyboard.scrolls === 2 && column(L.keyboard, 3), L.keyboard);
  ok('the Biggest swap line: a click opens its week, the next goes on to it',
    L.bigOpen === true && L.big.pop === false && L.big.scrolls === 3 && column(L.big, Number(L.big.wk)), L.big);
  ok('a finger: the first tap is the sheet, with one button beside Close', /sheet/.test(L.sheet.cls) && same(L.sheet.buttons, ['Season by week', 'Close']), L.sheet);
  ok('and that button goes on: sheet shut, scrolled, the column outlined', L.finger.pop === false && L.finger.scrolls === 4 && column(L.finger, 2), L.finger);
  ok('ALL USERS: a team’s Points/wk goes to THAT team’s lineups — picked in Lineup of, all users still on, the decision unchanged, no week outlined',
    L.allBefore.seasonTeam === '1' && L.allGo.seasonTeam === '7' && L.allGo.all === true && L.allGo.picked === 'lineup-reasonable:all:all' &&
    L.allGo.pop === false && L.allGo.scrolls === 5 && none(L.allGo), [L.allBefore, L.allGo]);
  ok('with a finger there too: the sheet’s button, and the fourth team’s lineups',
    same(L.allSheet.buttons, ['Season by week', 'Close']) && L.allFinger.seasonTeam === '4' && L.allFinger.all === true && L.allFinger.scrolls === 6, [L.allSheet, L.allFinger]);
  ok(`the page still has its ${weeks} weeks and no errors`, weeks >= 3 && (L.errors || []).length === 0, L.errors);
}

// ---- sorting and layout: every table sorts, a pair sorts together
//
// Tim, 2026-10-06: "fix the decisions section so the formating and function of
// the graphs matches with the rest of the cite (especially column sorting and
// no horezontal scrolling)". Run twice: three finished weeks, and with a week
// in play (a result still "In play", a dash, a live tag beside a name).
const namesOf = (rows) => rows.map((r) => r.name);
/** Top to bottom in `dir` on the sort value, with the unknowns (no value) last. */
const inOrder = (rows, dir) => {
  const known = rows.filter((r) => r.v !== null);
  return known.length > 1 && rows.slice(0, known.length).every((r) => r.v !== null) &&
    known.every((r, i) => i === 0 || (dir === 'desc' ? known[i - 1].v >= r.v : known[i - 1].v <= r.v));
};
/** A pair in step: the same teams on the same lines, the same arrow on both. */
const inStep = (p, i, dir) => same(namesOf(p.cur), namesOf(p.hyp)) && same(p.arrows, [[i, dir], [i, dir]]);
/** One row a week: the weeks in `dir`, and the Total row still the last one. */
const weeksInOrder = (t, i, dir) => inOrder(t.rows.slice(0, -1), dir) && t.rows[t.rows.length - 1].name === 'Total' && same(t.arrow, [i, dir]);

for (const run of ['sort', 'sort-early']) {
  const s = child(run);
  if (!booted(s, run)) continue;
  const SORTING = ['weekTable', 'teamTable', 'standingsCur', 'standingsHyp', 'summaryCur', 'summaryHyp', 'seasonCur', 'seasonHyp'];
  ok('every heading of every table sorts — the two the page owns, and both halves of Season by week, Standings and the chart',
    SORTING.every((id) => s.wired[id].length > 0 && s.wired[id].every(Boolean)), s.wired);

  // Season by week (audit, 2026-10-06: the one pair on the page a click did nothing to)
  const slotsOf = (p) => namesOf(p.cur).slice(0, -1);
  const totalLast = (p) => [p.cur, p.hyp].every((rows) => rows[rows.length - 1].name === 'Total' &&
    rows.filter((r) => r.name === 'Total').length === 1);
  const seasonStep = (p, i, dir) => inStep(p, i, dir) && totalLast(p);
  ok('Season by week opens in lineup order, unsorted, its Total at the foot',
    same(s.seasonBefore.arrows, [null, null]) && totalLast(s.seasonBefore) && slotsOf(s.seasonBefore).length === 10, s.seasonBefore.arrows);
  ok('a click on Current’s week 1 sorts its slots, high first, and Total stays at the foot',
    inOrder(s.seasonWk.cur.slice(0, -1), 'desc') && seasonStep(s.seasonWk, 1, 'desc') &&
    !same(slotsOf(s.seasonWk), slotsOf(s.seasonBefore)), [slotsOf(s.seasonWk), s.seasonWk.arrows]);
  ok('a second click turns both halves over', inOrder(s.seasonWkAsc.cur.slice(0, -1), 'asc') && seasonStep(s.seasonWkAsc, 1, 'asc'),
    [slotsOf(s.seasonWkAsc), s.seasonWkAsc.arrows]);
  ok('the switch to Difference keeps Current’s order and both arrows', s.seasonDiff.diff && seasonStep(s.seasonDiff, 1, 'asc') &&
    same(slotsOf(s.seasonDiff), slotsOf(s.seasonWkAsc)), [slotsOf(s.seasonDiff), s.seasonDiff.arrows]);
  ok('a click on Difference’s week 2 sorts THAT half by its own numbers, another decision or not, and Current follows it',
    s.seasonHypLeads.diff && inOrder(s.seasonHypLeads.hyp.slice(0, -1), 'desc') && seasonStep(s.seasonHypLeads, 2, 'desc'),
    [s.seasonHypLeads.hyp.map((r) => r.v), s.seasonHypLeads.arrows]);
  const lineup = slotsOf(s.seasonBefore);
  ok('the Slot heading sorts by place in the lineup, not by the letters: one click the lineup upside down, the next the lineup',
    seasonStep(s.seasonSlot, 0, 'desc') && same(slotsOf(s.seasonSlot), [...lineup].reverse()) &&
    seasonStep(s.seasonSlotAsc, 0, 'asc') && same(slotsOf(s.seasonSlotAsc), lineup), [slotsOf(s.seasonSlot), slotsOf(s.seasonSlotAsc)]);
  ok('back on Hypothetical, and on another team: the same order and arrows',
    !s.seasonBack.diff && seasonStep(s.seasonBack, 0, 'asc') && seasonStep(s.seasonTeam7, 0, 'asc') && same(slotsOf(s.seasonTeam7), lineup),
    [s.seasonBack.arrows, s.seasonTeam7.arrows]);

  // Its colour (Tim: "colorizing eveything red/green … used in virtually all charts across the site")
  const h = s.heat;
  ok('Season by week wears the site’s red/green scale: every cell of every squad’s sheet is the shared scale’s for its slot that week',
    h.squads === 10 && h.cells > 300 && h.tinted > 50 && h.marked > 0 && h.wrong.length === 0, h);
  ok('and so does its Avg column: each row’s Avg against the other squads’ Avg in that row', h.avgCells === 220, h.avgCells);
  ok('a coloured cell says so in words too, never by colour alone', h.said === h.cells, [h.said, h.cells]);
  ok('both halves are coloured as the page opens; as a Difference the right half is the difference’s colours, not the scale’s',
    s.tintBefore[0] > 0 && s.tintBefore[1] > 0 && s.tintDiff[0] > 0 && s.tintDiff[1] === 0, [s.tintBefore, s.tintDiff]);
  ok(run === 'sort' ? 'no week is in play here' : 'the week in play is left uncoloured on every sheet',
    run === 'sort' ? h.liveCells === 0 : h.liveCells > 0 && h.liveTinted === 0, [h.liveCells, h.liveTinted]);

  // Opp proj (audit, 2026-10-06: a dash for every team in both halves)
  const o = s.opp;
  const shown = (rows) => o.want.map((t) => num((rows.find((r) => r.name === t.name) || { t: '—' }).t));
  ok('Standings has Opp proj on both halves: each team’s average projected opponent, as the shared functions give it',
    o.at > 0 && o.want.length === 10 && new Set(o.want.map((t) => t.v)).size > 3 &&
    same(shown(o.cur), o.want.map((t) => t.v)) && same(shown(o.hyp), o.want.map((t) => t.v)), [o.want, o.cur.map((r) => r.t), o.hyp.map((r) => r.t)]);
  ok('no decision moves the fixture list: as a Difference it is 0.0 for everybody', s.oppDiff.length === 10 && s.oppDiff.every((r) => r.t === '0.0'),
    s.oppDiff.map((r) => r.t));
  ok('every table sits in the site’s .table-scroll', Object.values(s.wraps).every(Boolean), s.wraps);
  ok('Standings is one above the other, Season by week side by side while it fits, the chart side by side',
    /\bdz-stack\b/.test(s.pairs.standings) && /\bdz-fit\b/.test(s.pairs.season) && s.pairs.summary === 'dz-pair', s.pairs);
  ok('nothing is sorted until a heading is clicked: the page’s own order, as before',
    same(s.before.standings.arrows, [null, null]) && same(s.before.summary.arrows, [null, null]) && s.before.week.arrow === null &&
    same(namesOf(s.before.standings.cur), namesOf(s.before.standings.hyp)), s.before.standings.arrows);

  // Standings: Current leads
  ok('a click on Current’s Total sorts it, high first', inOrder(s.curTotal.cur, 'desc') &&
    !same(namesOf(s.curTotal.cur), namesOf(s.before.standings.cur)), namesOf(s.curTotal.cur));
  ok('and Hypothetical is in the same order with the same arrow', inStep(s.curTotal, 4, 'desc'), [namesOf(s.curTotal.hyp), s.curTotal.arrows]);
  ok('a second click turns both over', inOrder(s.curTotalAsc.cur, 'asc') && inStep(s.curTotalAsc, 4, 'asc'), s.curTotalAsc.arrows);
  ok('the switch to Difference keeps Current’s order and both arrows', s.curTotalDiff.diff && inStep(s.curTotalDiff, 4, 'asc') &&
    same(namesOf(s.curTotalDiff.cur), namesOf(s.curTotalAsc.cur)), [namesOf(s.curTotalDiff.hyp), s.curTotalDiff.arrows]);
  // …and then the other one does
  ok('a click on Difference’s Total sorts THAT table by its own numbers', inOrder(s.hypTotal.hyp, 'desc'), s.hypTotal.hyp.map((r) => r.v));
  ok('and Current follows it, arrow and all', inStep(s.hypTotal, 4, 'desc'), [namesOf(s.hypTotal.cur), s.hypTotal.arrows]);
  ok('another decision: still the difference’s order, on both', inOrder(s.hypTotalMoved.hyp, 'desc') && inStep(s.hypTotalMoved, 4, 'desc') &&
    s.hypTotalMoved.diff, [s.hypTotalMoved.hyp.map((r) => r.v), s.hypTotalMoved.arrows]);
  ok('another team: the same', inOrder(s.standingsTeam7.hyp, 'desc') && inStep(s.standingsTeam7, 4, 'desc'), s.standingsTeam7.arrows);
  ok('All users: the same', inOrder(s.allStandings.hyp, 'desc') && inStep(s.allStandings, 4, 'desc'), s.allStandings.arrows);

  // The chart
  ok('the chart: Current’s LUCK sorts both halves', inOrder(s.luck.cur, 'desc') && inStep(s.luck, 2, 'desc') &&
    !same(namesOf(s.luck.cur), namesOf(s.before.summary.cur)), [namesOf(s.luck.cur), s.luck.arrows]);
  ok('it holds while the seasons are being simulated', s.luckWaiting.dots && inOrder(s.luckWaiting.cur, 'desc') && inStep(s.luckWaiting, 2, 'desc'),
    [s.luckWaiting.dots, s.luckWaiting.arrows]);
  ok('and when they land', inOrder(s.luckDone.cur, 'desc') && inStep(s.luckDone, 2, 'desc'), s.luckDone.arrows);
  ok('Difference’s Title % leads when it is the one clicked', s.titleDiff.diff && inOrder(s.titleDiff.hyp, 'desc') && inStep(s.titleDiff, 3, 'desc'),
    [s.titleDiff.hyp.map((r) => r.v), s.titleDiff.arrows]);
  ok('Display noise redraws both and moves nobody, level teams included',
    same(namesOf(s.titleNoise.cur), namesOf(s.titleDiff.cur)) && inStep(s.titleNoise, 3, 'desc'), [namesOf(s.titleDiff.cur), namesOf(s.titleNoise.cur)]);

  // One row a week
  ok('the weekly table sorts on Diff, and Total stays at the bottom', weeksInOrder(s.weekDiff, 4, 'desc'), s.weekDiff);
  ok('a second click turns the weeks over, not the Total', weeksInOrder(s.weekDiffAsc, 4, 'asc'), s.weekDiffAsc);
  ok('another decision keeps the column and the direction', weeksInOrder(s.weekDiffMoved, 4, 'asc'), s.weekDiffMoved);
  ok('Result sorts as a result, not as its letters', weeksInOrder(s.weekResult, 5, 'desc'), s.weekResult);
  ok('Wk sorts as a number, live tag or not', weeksInOrder(s.weekWk, 0, 'desc') &&
    same(s.weekWk.rows.slice(0, -1).map((r) => r.v), s.weekWk.rows.slice(0, -1).map((r) => r.v).sort((a, b) => b - a)), s.weekWk);
  ok('another team keeps it', weeksInOrder(s.weekTeam7, 0, 'desc'), s.weekTeam7);

  // One row a team
  ok('All users opens in the Standings order, unsorted', s.teamsBefore.arrow === null && s.teamsBefore.rows.length === 10, s.teamsBefore.arrow);
  ok('its Points column sorts', inOrder(s.teamsPoints.rows, 'desc') && same(s.teamsPoints.arrow, [4, 'desc']), s.teamsPoints);
  ok('the other lineup choice keeps the column', inOrder(s.teamsPointsMoved.rows, 'desc') && same(s.teamsPointsMoved.arrow, [4, 'desc']) &&
    !same(s.teamsPointsMoved.rows.map((r) => r.v), s.teamsPoints.rows.map((r) => r.v)), s.teamsPointsMoved);
  ok('a record sorts as a record', inOrder(s.teamsActual.rows, 'desc') && same(s.teamsActual.arrow, [1, 'desc']), s.teamsActual);
  const bare = s.teamsName.rows.map((r) => r.name.replace(/live$/, '').toLowerCase());
  ok('a name sorts as the name, without its live tag', same(bare, [...bare].sort((a, b) => b.localeCompare(a))) && same(s.teamsName.arrow, [0, 'desc']), bare);

  if (run === 'sort') {
    // The stub's own numbers, so "in order" above cannot be a table of blanks.
    ok('squad 1’s hindsight: the difference leads with its +33.9, and Current did NOT sort itself',
      s.hypTotal.hyp[0].name === 'Manager 1' && s.hypTotal.hyp[0].v === 33.9 && s.hypTotal.cur[0].name === 'Manager 1' &&
      !inOrder(s.hypTotal.cur, 'desc'), s.hypTotal.cur);
    ok('Current led before that: the difference’s +33.9 sat mid-table', s.curTotalDiff.hyp.findIndex((r) => r.v === 33.9) === 2 &&
      !inOrder(s.curTotalDiff.hyp, 'asc'), s.curTotalDiff.hyp.map((r) => r.v));
    ok('the add+drop’s weeks by Result: the tie that became a win, the win, the loss',
      same(s.weekResult.rows.map((r) => [r.name, r.t]).slice(0, 3), [['2', 'T → W'], ['1', 'W'], ['3', 'L']]) &&
      s.weekResult.rows[3].name === 'Total', s.weekResult.rows);
    ok('records, best first: 3-0, 3-0, 2-1, 1-1-1 …',
      same(s.teamsActual.rows.slice(0, 4).map((r) => [r.name, r.t]), [['Manager 4', '3-0'], ['Manager 6', '3-0'], ['Manager 10', '2-1'], ['Manager 1', '1-1-1']]),
      s.teamsActual.rows.slice(0, 4));
  } else {
    // Squad 7's week 4 is still being played: no result in both worlds yet.
    const r7 = s.weekTeam7Result.rows;
    ok('a matchup still in play sorts under every result, over the Total', r7.length === 5 && r7[3].t === 'In play' &&
      r7[4].name === 'Total' && weeksInOrder(s.weekTeam7Result, 5, 'desc'), r7);
  }
}

// ---- the world cannot be read
const failed = child('failed');
where = 'failed read';
ok('a failed read says why, and falls back to the sample', !failed.boot && failed.badge === 'Demo' && failed.rows > 0 &&
  /would not return.*Showing demo data instead\.$/.test(failed.status), failed.boot || failed.status);
const cloud = child('failed-cloud');
where = 'failed read, phone copy';
ok('on the phone’s synced copy it is one short sentence', !cloud.boot &&
  cloud.status === 'This page needs the league read directly for now. Showing demo data instead.', cloud.boot || cloud.status);

// ---- nothing decided yet
const none = child('unplayed');
where = 'no finished week';
ok('fewer than one finished week: said in a few words, and no empty panels', !none.boot &&
  none.status === 'No finished week yet.' && none.hidden.every(Boolean), none.boot || none);
ok('no console errors', !none.boot && none.errors.length === 0, none.errors);

for (const f of fails) console.log('FAIL ' + f);
console.log(fails.length ? `${pass} passed, ${fails.length} failed` : `All ${pass} assertions passed`);
process.exit(fails.length ? 1 : 0);
