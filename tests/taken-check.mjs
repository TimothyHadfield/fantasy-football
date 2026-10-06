// The "Taken players" table on the Players page, end to end against the real
// waivers.html + js/waivers-page.js.
//
//   node taken-check.mjs
//
// A dozen scenarios, each in its own child process, because an ES module
// initialises once per process and waivers-page.js self-boots on import:
//
//   live  a three-squad stub league (taken-stub-season.mjs) where every answer
//         is known by construction -- who owns whom, what each Avg is, which
//         man is the QB3, and which man ESPN has no number for at all.
//   demo  the real demo rosters, so the path Tim actually lands on first is
//         covered too, with the ranks re-derived from the rendered numbers.
//
// EVERY rank assertion is re-derived here from the Avg column AS RENDERED, not
// from the stub's raw numbers and not from the page's own arithmetic. The page
// is being checked against an independent ordering of its own output, which is
// the only way a wrong sort or a wrong grouping shows up as a failure.
//
// Run it with `npm test` from tests/, or on its own with `node taken-check.mjs`.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
// This suite boots the same `js/waivers-page.js` wv-test does, so it waits the
// same way: on the page's own "nothing left in flight" signal rather than on a
// clock. `waiverPagePending()` says what that signal is. It was a fixed 600 ms,
// and the `jump` scenario failed 2 runs in 3 on correct code because of it —
// landing on a `?player=` link widens the span to the whole season, which buys
// thirteen weeks of wire and thirteen of rosters, and the man's positional rank
// was read back before they landed, giving his THREE-week rank instead.
import { settleWaiverPage } from './settle.mjs';
import { emit } from './emit.mjs';

// The per-position startable bars, copied rather than imported: if the page
// changes one, the "some of these numbers clear the bar" check below should
// still be measuring what it says it measures.
const BARS = { QB: 17, RB: 12, WR: 12, TE: 9, DST: 7, K: 9 };

const SCENARIOS = {
  // TWO SQUADS WEARING ONE NAME. The table groups the league into per-manager
  // depth charts, and it used to group them by the LABEL on screen. That was
  // unique often enough to hide the bug while a squad was labelled with ESPN's
  // team name, and it got likelier the moment a squad started being labelled
  // with the person holding it: two owners can share a display name, and a
  // squad whose owner does not resolve falls back to a shared shape.
  //
  // Merged, both squads get one depth chart computed over thirty-two players,
  // so every rank on BOTH of them is wrong and nothing on screen says so. The
  // stub gives teams 1 and 2 the same name under TAKEN_SAME_LABEL and leaves
  // their ids alone, which is exactly the shape that used to merge.
  'same-label': {
    label: '(e) two squads that render the same name stay two squads',
    stub: true,
    env: { TAKEN_SAME_LABEL: '1' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    after: async ({ document }) => ({ rows: takenSnapshot(document) }),
  },
  live: {
    label: '(a) three stub squads: owners, ranks, and nothing coloured',
    stub: true,
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    after: async ({ document, window, waitFor }) => {
      const season = await import('./taken-stub-season.mjs');
      const espn = await import('./wv-stub-espn.mjs');
      const click = (sel) =>
        document.querySelector(sel).dispatchEvent(new window.Event('click', { bubbles: true }));

      const out = {
        rosterBefore: season.calls.rosterWeeks.slice(),
        wireFetchesBefore: espn.calls.weeks.slice(),
      };

      // Widening has to re-rank: over weeks 4-6 Cade Dunlow is the QB3, over
      // weeks 4-9 he is the QB1. The note claims the span moves the rank, so
      // something had better prove it does.
      click('#spanFilter button[data-span="6"]');
      // The three new weeks have to actually arrive before the re-rank can be
      // read, and this is the same claim the `jump` scenario makes — the one that
      // failed 2 runs in 3 behind a fixed 600 ms.
      await waitFor();
      out.wide = takenSnapshot(document);
      out.rosterAfterWiden = season.calls.rosterWeeks.slice();

      click('#spanFilter button[data-span="3"]');
      await waitFor();

      // EACH TABLE HAS ITS OWN position filter now. Pressing the wire's must
      // leave this one alone — that independence is the whole point of the
      // change, and it is the kind of thing that silently regresses — and
      // pressing this one must not cost a request.
      click('#posFilter button[data-pos="QB"]');
      out.takenAfterWireFilter = takenSnapshot(document);
      out.wireAfterWireFilter = wireSnapshot(document);
      click('#posFilter button[data-pos="ALL"]');

      click('#takenPosFilter button[data-pos="QB"]');
      out.qb = takenSnapshot(document);
      out.wireAfterTakenFilter = wireSnapshot(document);
      click('#takenPosFilter button[data-pos="ALL"]');

      // FLEX. A filter across three positions rather than a seventh position,
      // so the things to watch are that it narrows to exactly RB/WR/TE, that
      // the ranks and the Pos keys come through it untouched, and that the two
      // tables still answer only their own button. Pressed on each table in
      // turn and left pressed on the first while the second is pressed, which
      // is the only way to see one filter fail to leave the other alone.
      const wireBefore = wireSnapshot(document);
      // Taken here rather than at the top of this hook: the span was widened and
      // narrowed again in between, which legitimately bought weeks 7-9, and the
      // claim being made is about what FLEX costs, not about what the span did.
      out.wireFetchesBeforeFlex = espn.calls.weeks.slice();
      out.rosterBeforeFlex = season.calls.rosterWeeks.slice();
      click('#takenPosFilter button[data-pos="FLEX"]');
      out.takenFlex = takenSnapshot(document);
      out.wireDuringTakenFlex = wireSnapshot(document);
      out.takenFlexCount = document
        .querySelector('#takenPosFilter button[data-pos="FLEX"] .seg-count').textContent.trim();
      out.takenFlexLabel = (document.querySelector('#takenStats .stat .k') || {}).textContent || '';
      out.takenFlexEmpty = document.querySelectorAll('#takenTable tbody tr.empty-row').length;

      click('#posFilter button[data-pos="FLEX"]');
      out.wireFlex = wireSnapshot(document);
      out.takenDuringWireFlex = takenSnapshot(document);
      out.wireFlexCount = document
        .querySelector('#posFilter button[data-pos="FLEX"] .seg-count').textContent.trim();
      out.wireFlexLabel = (document.querySelector('#waiverStats .stat .k') || {}).textContent || '';

      click('#takenPosFilter button[data-pos="ALL"]');
      out.wireStillFlex = wireSnapshot(document);
      click('#posFilter button[data-pos="ALL"]');
      out.wireBefore = wireBefore;
      out.wireAfterFlex = wireSnapshot(document);
      out.wireFetchesAfterFlex = espn.calls.weeks.slice();

      out.rosterAfterFilter = season.calls.rosterWeeks.slice();

      globalThis.__taken = out;
    },
  },
  demo: {
    label: '(b) the real demo squads',
    stub: false,
    prefs: { 'waivers.source': 'demo' },
  },

  // ---- landing on one man from a ?player= link elsewhere on the site -------
  //
  // Cade Dunlow (7103) is Ridgeway Rovers' third-best QB over the default three
  // weeks and their best over six, which makes him the right man to land on:
  // the jump widens the span to the whole season, so his rank on arrival must
  // be the WIDE one. The reader's own span preference is deliberately left at
  // the narrow default in prefs, so a reload gives it back.
  jump: {
    label: '(c) a ?player= link lands on one man',
    stub: true,
    prefs: { 'waivers.source': 'live', 'waivers.span': '3' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    search: '?player=7103',
    after: async ({ document, window }) => {
      const season = await import('./taken-stub-season.mjs');
      const out = {
        rows: takenSnapshot(document),
        wire: wireSnapshot(document),
        jump: document.getElementById('jumpNote').textContent.replace(/\s+/g, ' ').trim(),
        jumpCls: document.getElementById('jumpNote').getAttribute('class') || '',
        spot: [...document.querySelectorAll('#takenTable tbody tr.spotlight')]
          .map((tr) => tr.getAttribute('data-player')),
        spotAnywhere: [...document.querySelectorAll('tr.spotlight')].length,
        takenOn: [...document.querySelectorAll('#takenPosFilter button.on')]
          .map((b) => b.getAttribute('data-pos')),
        wireOn: [...document.querySelectorAll('#posFilter button.on')]
          .map((b) => b.getAttribute('data-pos')),
        spanOn: [...document.querySelectorAll('#spanFilter button.on')]
          .map((b) => b.getAttribute('data-span')),
        takenSpanOn: [...document.querySelectorAll('#takenSpanFilter button.on')]
          .map((b) => b.getAttribute('data-span')),
        weekCols: [...document.querySelectorAll('#takenTable thead th')].length,
        link: linkView(document, 7103),
        savedSpan: JSON.parse(localStorage.getItem('ff.prefs') || '{}')['waivers.span'],
        rosterWeeks: season.calls.rosterWeeks.slice().sort((a, b) => a - b),
      };

      // Clearing drops the mark and the strip, and deliberately leaves the span
      // and the filter where the jump put them — they are what is on screen now.
      document.querySelector('#jumpNote button[data-clear]')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      out.afterClear = {
        jumpCls: document.getElementById('jumpNote').getAttribute('class') || '',
        spot: [...document.querySelectorAll('tr.spotlight')].length,
        takenOn: [...document.querySelectorAll('#takenPosFilter button.on')]
          .map((b) => b.getAttribute('data-pos')),
        spanOn: [...document.querySelectorAll('#spanFilter button.on')]
          .map((b) => b.getAttribute('data-span')),
      };
      globalThis.__jump = out;
    },
  },

  'jump-unknown': {
    label: '(d) a ?player= link for somebody nobody holds',
    stub: true,
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    search: '?player=424242',
    after: async ({ document }) => {
      globalThis.__jump = {
        jump: document.getElementById('jumpNote').textContent.replace(/\s+/g, ' ').trim(),
        jumpCls: document.getElementById('jumpNote').getAttribute('class') || '',
        spot: [...document.querySelectorAll('tr.spotlight')].length,
        rows: takenSnapshot(document).length,
      };
    },
  },

  // ---- the previous weeks, and a man's Actual row ---------------------------
  //
  // Tim, 2026-10-04: "Instead of showing the preview for that player selected
  // when you hover over their name to show their previous actual and proj
  // scores, just make a drop-down row soley for that player that just shows that
  // player's act score rather than their proj. Additionally make the player's
  // section show all weeks, not just future weeks. However, make a thick line
  // seperateing the future and previous weeks. Only count a week as previous if
  // the week is fully over."
  //
  // The stub league has played weeks 1-3 (week 4 is current). Both tables must
  // draw weeks 1-3 BEFORE week 4, holding ESPN's projection for each; the heavy
  // line is the left edge of week 4; a click on a name opens ONE row under him
  // holding what he scored; and nothing opens on hover any more.
  past: {
    label: '(f) previous weeks are columns, and a click on a name opens his Actual row',
    stub: true,
    env: { WV_PAST: '1' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    after: async ({ document, window, waitFor }) => {
      const season = await import('./taken-stub-season.mjs');
      const espn = await import('./wv-stub-espn.mjs');
      const fire = (el, type) => el && el.dispatchEvent(new window.Event(type, { bubbles: true }));
      const link = (table, pid) => document.querySelector(`#${table} tbody tr#p${pid} a.pref`);
      // Selecting a man narrows HIS table to his position, so the next man may
      // not be on screen: put that table's own filter back to All first.
      const tap = async (table, pid) => {
        fire(document.querySelector(
          `#${table === 'takenTable' ? 'takenPosFilter' : 'posFilter'} button[data-pos="ALL"]`), 'click');
        clickLeft(window, link(table, pid));
        await waitFor();
      };
      const played = (arr) => arr.filter((w) => w <= 3).sort((a, b) => a - b);
      const actRows = () => [...document.querySelectorAll('tr.act-row')]
        .map((tr) => tr.getAttribute('data-actual-for'));
      const out = {
        rosterBefore: played(season.calls.rosterWeeks),
        wireBefore: played(espn.calls.weeks),
        heads: { taken: headView(document, 'takenTable'), wire: headView(document, 'waiverTable') },
        tips: document.querySelectorAll('[data-tip]').length,
        links: document.querySelectorAll('#waiverTable tbody a.pref, #takenTable tbody a.pref').length,
        openAtStart: actRows(),
        // Every row of both tables, before anything is clicked.
        lines: ['takenTable', 'waiverTable'].map((id) => ({
          id,
          rows: [...document.querySelectorAll(`#${id} tbody tr[id]`)]
            .map((tr) => rowView(document, id, tr.getAttribute('data-player'))),
        })),
      };

      // Hovering and tabbing onto a name used to open the played-weeks card.
      fire(link('takenTable', 7101), 'mouseover');
      fire(link('takenTable', 7101), 'focusin');
      await new Promise((r) => setTimeout(r, 400));
      const card = document.getElementById('tipCard');
      out.cardAfterHover = Boolean(card && !card.hidden && !card.hasAttribute('hidden'));
      out.openAfterHover = actRows();

      await tap('takenTable', 7101);
      out.ross = rowView(document, 'takenTable', 7101);
      out.openAfterRoss = actRows();
      out.spotAfterRoss = [...document.querySelectorAll('tr.spotlight')].map((tr) => tr.getAttribute('data-player'));
      out.spanAfterRoss = [...document.querySelectorAll('#spanFilter button.on')].map((b) => b.getAttribute('data-span'));
      out.tableWidthCols = [...document.querySelectorAll('#takenTable thead th')].length;

      // RE-SORT with the row open: it must stay under him and never be sorted
      // as a man of its own. Player (text) and then Avg, both directions.
      out.sorted = [];
      for (const i of [0, 0, 4, 4]) {
        fire(document.querySelectorAll('#takenTable thead th')[i], 'click');
        const trs = [...document.querySelectorAll('#takenTable tbody tr')];
        const at = trs.findIndex((tr) => /\bact-row\b/.test(tr.getAttribute('class') || ''));
        out.sorted.push({
          i,
          count: trs.filter((tr) => /\bact-row\b/.test(tr.getAttribute('class') || '')).length,
          above: at > 0 ? trs[at - 1].getAttribute('id') : null,
          first: trs[0].getAttribute('id'),
          order: trs.filter((tr) => tr.hasAttribute('id')).map((tr) => tr.getAttribute('data-player')).join(','),
        });
      }

      // The same name again closes it; the man stays selected.
      await tap('takenTable', 7101);
      out.openAfterSecond = actRows();
      out.rossClosed = rowView(document, 'takenTable', 7101);
      out.spotAfterSecond = [...document.querySelectorAll('tr.spotlight')].map((tr) => tr.getAttribute('data-player'));
      // And a third opens it again.
      await tap('takenTable', 7101);
      out.openAfterThird = actRows();

      await tap('takenTable', 7106);
      out.hale = rowView(document, 'takenTable', 7106);
      out.openAfterHale = actRows();
      await tap('takenTable', 7108);
      out.kip = rowView(document, 'takenTable', 7108);

      await tap('waiverTable', 5000);
      out.p00 = rowView(document, 'waiverTable', 5000);
      out.openAfterWire = actRows();
      await tap('waiverTable', 5007);
      out.p07 = rowView(document, 'waiverTable', 5007);
      await tap('waiverTable', 5002);
      out.p02 = rowView(document, 'waiverTable', 5002);

      out.rosterAfterAll = played(season.calls.rosterWeeks);
      out.wireAfterAll = played(espn.calls.weeks);
      out.note = (document.getElementById('waiverNote') || {}).textContent || '';
      globalThis.__past = out;
    },
  },

  // A WEEK IN PROGRESS IS NOT A PREVIOUS WEEK. One of week 4's five games is
  // final; "Only count a week as previous if the week is fully over."
  'past-partial': {
    label: '(g) a week in progress stays on the future side of the line',
    stub: true,
    env: { WV_PAST: '1', TAKEN_PARTIAL_WEEK: '4' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    after: async ({ document }) => {
      globalThis.__past = {
        heads: { taken: headView(document, 'takenTable'), wire: headView(document, 'waiverTable') },
        ross: rowView(document, 'takenTable', 7101),
      };
    },
  },

  // The same row on a phone: no hover there, so the tap is all there ever was.
  'past-touch': {
    label: '(h) a tap on a name opens the same row on a phone, and no sheet',
    stub: true,
    coarse: true,
    env: { WV_PAST: '1' },
    prefs: { 'waivers.source': 'live', 'waivers.span': '3' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    after: async ({ document, window, waitFor }) => {
      clickLeft(window, document.querySelector('#takenTable tbody tr#p7101 a.pref'));
      await waitFor();
      const card = document.getElementById('tipCard');
      globalThis.__past = {
        ross: rowView(document, 'takenTable', 7101),
        open: [...document.querySelectorAll('tr.act-row')].map((tr) => tr.getAttribute('data-actual-for')),
        card: Boolean(card && !card.hidden && !card.hasAttribute('hidden')),
        spot: [...document.querySelectorAll('tr.spotlight')].map((tr) => tr.getAttribute('data-player')),
      };
    },
  },

  // ---- `?player=…&week=…`: one man, one week, boxed -------------------------
  //
  // Tim, 2026-10-04: "If it's a player, bring them straight to the player
  // section with that player selected, and cells that they recieved that
  // specific score boxed in orange."
  'link-week': {
    label: '(i) ?player=&week= opens his row and boxes exactly that week’s two cells',
    stub: true,
    env: { WV_PAST: '1' },
    prefs: { 'waivers.source': 'live', 'waivers.span': '3' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    search: '?player=7101&week=2',
    after: async ({ document }) => { globalThis.__past = linkView(document, 7101); },
  },
  'link-week-wire': {
    label: '(j) the same link for a free agent',
    stub: true,
    env: { WV_PAST: '1' },
    prefs: { 'waivers.source': 'live', 'waivers.span': '3' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    search: '?player=5000&week=3',
    after: async ({ document }) => { globalThis.__past = linkView(document, 5000, 'waiverTable'); },
  },
  // A week that is not a previous week has no score to box: the plain jump.
  'link-week-future': {
    label: '(k) ?player=&week= for a week not yet over boxes nothing',
    stub: true,
    env: { WV_PAST: '1' },
    prefs: { 'waivers.source': 'live', 'waivers.span': '3' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    search: '?player=7101&week=5',
    after: async ({ document }) => { globalThis.__past = linkView(document, 7101); },
  },

  // The demo, which is what Tim lands on first (the sample pretends it is week
  // 4): a squad man and a free agent, each with weeks 1-3 and an Actual row.
  'past-demo': {
    label: '(l) the demo draws weeks 1-3 and opens an Actual row for a squad man and a free agent',
    stub: false,
    prefs: { 'waivers.source': 'demo' },
    after: async ({ document, window, waitFor }) => {
      const takenTr = document.querySelector('#takenTable tbody tr[data-player]');
      const wireTr = document.querySelector('#waiverTable tbody tr[data-player]:not(.mine)');
      const takenId = takenTr.getAttribute('data-player');
      const wireId = wireTr.getAttribute('data-player');
      const heads = { taken: headView(document, 'takenTable'), wire: headView(document, 'waiverTable') };
      clickLeft(window, takenTr.querySelector('a.pref'));
      await waitFor();
      const taken = rowView(document, 'takenTable', takenId);
      clickLeft(window, document.querySelector(`#waiverTable tbody tr#p${wireId} a.pref`));
      await waitFor();
      const wire = rowView(document, 'waiverTable', wireId);
      globalThis.__past = {
        heads, taken, wire, takenId, wireId,
        open: [...document.querySelectorAll('tr.act-row')].map((tr) => tr.getAttribute('data-actual-for')),
      };
    },
  },
};

// ------------------------------------------------- reading the previous weeks

/** A real tap is a primary-button click; the page's jump handler asks. */
function clickLeft(window, el) {
  if (!el) return;
  const ev = new window.Event('click', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'button', { value: 0 });
  el.dispatchEvent(ev);
}

const clsOf = (el) => el.getAttribute('class') || '';
const hasCls = (el, c) => new RegExp(`(^|\\s)${c}(\\s|$)`).test(clsOf(el));
const cellText = (el) => el.textContent.replace(/\s+/g, ' ').trim();

/** A table's header: which columns are previous weeks, and where the line is. */
function headView(document, table) {
  const ths = [...document.querySelectorAll(`#${table} thead th`)];
  const weeks = ths.map((th, i) => ({ i, text: cellText(th) })).filter((h) => /^\d+$/.test(h.text));
  return {
    cols: ths.length,
    weeks: weeks.map((h) => h.text),
    past: ths.filter((th) => hasCls(th, 'wk-past')).map(cellText),
    pastAt: ths.map((th, i) => (hasCls(th, 'wk-past') ? i : -1)).filter((i) => i >= 0),
    line: ths.map((th, i) => (hasCls(th, 'fut-start') ? i : -1)).filter((i) => i >= 0),
    lineText: ths.filter((th) => hasCls(th, 'fut-start')).map(cellText),
  };
}

/**
 * One man's row and, when it is open, the Actual row under it. Column indexes
 * are positions in the TABLE (a colspan counts for what it spans), so the two
 * rows and the header can be compared like for like.
 */
function rowView(document, table, pid) {
  const tr = document.querySelector(`#${table} tbody tr#p${pid}`);
  if (!tr) return null;
  const read = (row) => {
    const cells = [];
    let at = 0;
    for (const td of row.children) {
      const span = Number(td.getAttribute('colspan') || 1);
      cells.push({ at, span, td });
      at += span;
    }
    const pick = (c) => cells.filter((x) => hasCls(x.td, c));
    const pastEnd = Math.max(-1, ...pick('wk-past').map((x) => x.at));
    return {
      cols: at,
      label: cellText(row.children[0]),
      past: pick('wk-past').map((x) => cellText(x.td)),
      pastV: pick('wk-past').map((x) => x.td.getAttribute('data-v')),
      pastAt: pick('wk-past').map((x) => x.at),
      line: pick('fut-start').map((x) => x.at),
      box: pick('wk-box').map((x) => ({ at: x.at, text: cellText(x.td) })),
      // Everything right of the previous weeks: the weeks still to play.
      future: cells.filter((x) => x.at > pastEnd && pick('wk-past').length).map((x) => cellText(x.td)),
      futureV: cells.filter((x) => x.at > pastEnd && pick('wk-past').length).map((x) => x.td.getAttribute('data-v')),
      coloured: pick('wk-past').filter((x) => /\b(hot|beats)\b/.test(clsOf(x.td)) ||
        /background/.test(x.td.getAttribute('style') || '')).length,
    };
  };
  const next = tr.nextElementSibling;
  const act = next && hasCls(next, 'act-row') ? next : null;
  const avgAt = table === 'takenTable' ? 4 : 3;
  return {
    ...read(tr),
    avg: tr.children[avgAt].getAttribute('data-v'),
    expanded: (tr.querySelector('a.pref') || { getAttribute: () => null }).getAttribute('aria-expanded'),
    act: act && {
      ...read(act),
      for: act.getAttribute('data-actual-for'),
      child: act.hasAttribute('data-sort-child'),
      glance: cellText(act.children[1]),
      id: act.getAttribute('id'),
    },
  };
}

/** What a `?player=&week=` link left on the page. */
function linkView(document, pid, table = 'takenTable') {
  const boxes = [...document.querySelectorAll('td.wk-box')];
  return {
    head: headView(document, table),
    row: rowView(document, table, pid),
    boxes: boxes.length,
    boxRows: boxes.map((td) => {
      const tr = td.closest('tr');
      return tr.getAttribute('id') || `act:${tr.getAttribute('data-actual-for')}`;
    }),
    open: [...document.querySelectorAll('tr.act-row')].map((tr) => tr.getAttribute('data-actual-for')),
    spot: [...document.querySelectorAll('tr.spotlight')].map((tr) => tr.getAttribute('data-player')),
    jump: document.getElementById('jumpNote').textContent.replace(/\s+/g, ' ').trim(),
  };
}

// --------------------------------------------------------------- reading it

/**
 * The WIRE table's rows, so the two filters can be shown to be independent.
 * Deliberately excludes the "Your …" comparison rows: they are your own men,
 * not free agents, and they follow the wire's filter for their own reasons.
 */
function wireSnapshot(document) {
  return [...document.querySelectorAll('#waiverTable tbody tr')]
    .filter((tr) => {
      const cls = tr.getAttribute('class') || '';
      // The Actual row under a selected man is his second line, not a man.
      return !/\bempty-row\b/.test(cls) && !/\bmine\b/.test(cls) && !/\bact-row\b/.test(cls);
    })
    .map((tr) => {
      const c = [...tr.children];
      return {
        player: tr.getAttribute('data-player'),
        name: c[0].textContent.replace(/\s+/g, ' ').trim(),
        pos: c[1].textContent.trim(),
      };
    });
}

/**
 * Every row of the taken table, as plain data. `week` is the PRICED weeks only
 * — the ones Avg is over. The previous weeks drawn before them (2026-10-04)
 * are `past`; the Actual row under a selected man is not a man and is skipped.
 */
function takenSnapshot(document) {
  const lead = 5 + document.querySelectorAll('#takenTable thead th.wk-past').length;
  return [...document.querySelectorAll('#takenTable tbody tr')]
    .filter((tr) => !/\b(empty-row|act-row)\b/.test(tr.getAttribute('class') || ''))
    .map((tr) => {
      const c = [...tr.children];
      return {
        id: tr.getAttribute('id'),
        player: tr.getAttribute('data-player'),
        cls: tr.getAttribute('class') || '',
        name: c[0].textContent.replace(/\s+/g, ' ').trim(),
        pos: c[1].textContent.trim(),
        posKey: c[1].getAttribute('data-v'),
        tm: c[2].textContent.trim(),
        owner: c[3].textContent.trim(),
        ownerKey: c[3].getAttribute('data-v'),
        avg: c[4].getAttribute('data-v'),
        avgText: c[4].textContent.trim(),
        past: c.slice(5, lead).map((td) => td.textContent.trim()),
        week: c.slice(lead).map((td) => ({
          v: td.getAttribute('data-v'),
          text: td.textContent.trim(),
          cls: td.getAttribute('class') || '',
        })),
      };
    });
}

/** "QB3" -> "QB"; "TE" -> "TE". The bare position, whatever the rank. */
const bareOf = (pos) => pos.replace(/\d+$/, '');
/** "QB3" -> 3; "TE" -> null. */
const rankOf = (pos) => {
  const m = pos.match(/(\d+)$/);
  return m ? Number(m[1]) : null;
};

/**
 * The rank every row SHOULD carry, worked out from the rendered Avg column.
 *
 * Independent of the page's own arithmetic on purpose: it groups by the owner
 * and the bare position as the page printed them, orders by the Avg as the page
 * printed it, and numbers from 1. A man with a blank Avg gets no rank, because
 * there is nothing to order him by.
 */
function ranksFromRendered(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.owner}|${bareOf(r.pos)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const want = new Map();
  for (const group of groups.values()) {
    group
      .filter((r) => r.avg !== null)
      .sort((a, b) => Number(b.avg) - Number(a.avg) || Number(a.player) - Number(b.player))
      .forEach((r, i) => want.set(r.player, i + 1));
    group.filter((r) => r.avg === null).forEach((r) => want.set(r.player, null));
  }
  return want;
}

// ------------------------------------------------------------------- child

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  const html = readFileSync(path.join(REPO, 'waivers.html'), 'utf8');
  const { window, document } = parseHTML(html);

  // linkedom returns undefined for a <select>'s value. Shimmed on the SELECT
  // prototype specifically: HTMLElement.prototype is shadowed here, and would
  // break <input> if it were not.
  const SelectProto = window.HTMLSelectElement?.prototype;
  if (SelectProto) {
    Object.defineProperty(SelectProto, 'value', {
      configurable: true,
      get() {
        const s = this.querySelector('option[selected]') || this.querySelector('option');
        return s ? s.getAttribute('value') ?? s.textContent : '';
      },
      set(v) {
        for (const o of this.querySelectorAll('option')) {
          if ((o.getAttribute('value') ?? o.textContent) === String(v)) o.setAttribute('selected', '');
          else o.removeAttribute('selected');
        }
      },
    });
  }

  // The table prototype has to come from an element linkedom actually made --
  // window.HTMLTableElement is not always the same object, and defining on the
  // wrong one leaves table.tBodies undefined at the moment a page reads it.
  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  Object.defineProperty(TableProto, 'rows', {
    configurable: true,
    get() {
      const head = kids(this, 'THEAD')[0];
      const rows = [];
      if (head) rows.push(...kids(head, 'TR'));
      for (const b of kids(this, 'TBODY')) rows.push(...kids(b, 'TR'));
      return rows;
    },
  });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });

  // js/bridge.js reads window.location.origin on every ping, and linkedom gives
  // the window no location at all.
  // `search` is what a ?player= deep link arrives as, so a scenario can set it.
  const search = cfg.search || '';
  if (!window.location) {
    window.location = {
      href: `http://localhost/waivers.html${search}`, origin: 'http://localhost',
      protocol: 'http:', pathname: '/waivers.html', search, hash: '',
    };
  }
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  const store = new Map();
  if (cfg.prefs) store.set('ff.prefs', JSON.stringify(cfg.prefs));
  if (cfg.conn) store.set('ff.connection', JSON.stringify(cfg.conn));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  // fetch is deliberately not made to work: any real network attempt is a
  // failure this suite reports rather than a request it silently serves.
  const fetchCalls = [];
  const fetch = async (url) => {
    fetchCalls.push(String(url));
    throw new Error(`unexpected network call: ${url}`);
  };

  Object.assign(globalThis, {
    window, document, localStorage, fetch,
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  // `coarse`: a finger, not a mouse — `(hover: none)` matches, which is the one
  // question js/connection.js's coarsePointer() asks.
  if (cfg.coarse) {
    const mm = (q) => ({ matches: /hover:\s*none/.test(q), addEventListener() {}, removeEventListener() {} });
    globalThis.matchMedia = mm;
    window.matchMedia = mm;
  }
  window.localStorage = localStorage;
  window.ResizeObserver = globalThis.ResizeObserver;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  const rejections = [];
  process.on('unhandledRejection', (r) => rejections.push(String(r)));

  await import(pathToFileURL(path.join(REPO, 'js/waivers-page.js')).href);

  // Collected, so a poll that hit its ceiling is asserted below by name rather
  // than turning into a positional rank that is quietly one span out of date.
  const settles = [];
  const waitFor = async (max) => {
    const r = await settleWaiverPage(document, max);
    settles.push(r);
    return r;
  };
  await waitFor();
  if (cfg.after) await cfg.after({ document, window, waitFor });
  console.error = origError;

  return { document, errors, fetchCalls, rejections, cfg, settles };
}

// ------------------------------------------------------------- assertions

function makeChecker() {
  const out = [];
  return {
    out,
    ok(name, cond, detail = '') {
      out.push({ name, pass: Boolean(cond), detail: cond ? '' : String(detail).slice(0, 400) });
    },
  };
}

const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const near = (a, b) => a !== null && b !== null && Math.abs(Number(a) - Number(b)) < 0.005;

async function check(scenario, boot) {
  const c = makeChecker();
  const d = boot.document;
  const $ = (id) => d.getElementById(id);
  // The short status line (demo notice, refusals, progress) sits visibly above
  // the table; the rest is tucked in the explanation below it. Both are read.
  const note = txt($('takenStatus')) + ' ' + txt($('takenNote'));
  const rows = takenSnapshot(d);

  c.ok('no console errors', boot.errors.length === 0, boot.errors.slice(0, 2).join(' | '));
  c.ok('no unhandled rejections', boot.rejections.length === 0, boot.rejections.slice(0, 2).join(' | '));
  c.ok('no unexpected network calls', boot.fetchCalls.length === 0, boot.fetchCalls.slice(0, 2).join(' | '));

  // EVERY POLL REACHED THE PAGE'S FINISHED STATE, not its ceiling — so "the
  // weeks never arrived" is reported as that rather than as a positional rank
  // that is one span out of date and says nothing about why.
  {
    const stuck = (boot.settles || []).filter((s) => !s.ok);
    c.ok('the page reached its own finished state within the poll’s ceiling',
      stuck.length === 0,
      stuck.map((s) => `after ${s.ms}ms: ${s.why}`).join(' | '));
  }

  // ---- (f)-(l) the previous weeks and the Actual row -------------------------
  if (/^(past|link-week)/.test(scenario)) {
    const w = globalThis.__past || {};
    const J = (x) => JSON.stringify(x);
    const WEEKS = ['1', '2', '3'];
    // Where the weeks start in each table: after Player, Pos, Tm, Owner, Avg on
    // the Taken table and after Player, Pos, Tm, Avg, Gain on the wire.
    const LEAD = { taken: 5, wire: 5 };

    /** The header claims, for both tables. */
    const heads = (h) => {
      for (const [name, lead] of Object.entries(LEAD)) {
        const t = (h || {})[name] || {};
        c.ok(`${name}: the previous weeks are exactly the weeks fully over, 1-3`,
          J(t.past) === J(WEEKS), J(t.past));
        c.ok(`${name}: they sit BEFORE the weeks to come, straight after Avg`,
          J(t.pastAt) === J([lead, lead + 1, lead + 2]), J(t.pastAt));
        c.ok(`${name}: every week is a column, in order, 1 first`,
          (t.weeks || []).length > 3 && (t.weeks || []).every((x, i) => Number(x) === i + 1), J(t.weeks));
        c.ok(`${name}: the heavy line is on week 4’s header and nowhere else`,
          J(t.line) === J([lead + 3]) && J(t.lineText) === J(['4']), `${J(t.line)} ${J(t.lineText)}`);
      }
    };

    /** A man's own row: projections in the previous weeks, the line after them. */
    const mainRow = (name, got, lead, proj) => {
      c.ok(`${name}: his row has a cell for each previous week, under its header`,
        got && J(got.pastAt) === J([lead, lead + 1, lead + 2]), J(got && got.pastAt));
      if (proj) {
        c.ok(`${name}: each holds ESPN’s PROJECTION for that week`,
          got && J(got.past) === J(proj), `${J(got && got.past)} want ${J(proj)}`);
      }
      c.ok(`${name}: the heavy line is the left edge of his week 4 cell, and only that`,
        got && J(got.line) === J([lead + 3]), J(got && got.line));
      c.ok(`${name}: a previous week is plain — no green, no shading`,
        got && got.coloured === 0, String(got && got.coloured));
    };

    /** His Actual row: scores, not projections, and no column moved. */
    const actRow = (name, got, lead, act) => {
      const a = got && got.act;
      c.ok(`${name}: ONE row opened directly under him, labelled Actual`,
        a && a.label === 'Actual' && String(a.for) === String(name.id), J(a));
      c.ok(`${name}: it is his second line — no id of its own, and marked so the sort leaves it alone`,
        a && a.id === null && a.child === true, J(a && { id: a.id, child: a.child }));
      c.ok(`${name}: it spans exactly the columns of the row above, so nothing shifts`,
        a && a.cols === got.cols && J(a.pastAt) === J(got.pastAt) && J(a.line) === J(got.line),
        J(a && { cols: [a.cols, got.cols], pastAt: a.pastAt, line: a.line }));
      if (act) {
        c.ok(`${name}: under each previous week is what he SCORED`,
          a && J(a.past) === J(act), `${J(a && a.past)} want ${J(act)}`);
      }
      c.ok(`${name}: and nothing under a week still to come`,
        a && a.future.length > 0 && a.future.every((v) => v === ''), J(a && a.future));
      c.ok(`${name}: his name says the row is open`, got && got.expanded === 'true', String(got && got.expanded));
    };
    const named = (label, id) => ({ id, toString: () => label });

    if (scenario === 'past') {
      heads(w.heads);

      // ---- the hover preview is gone -----------------------------------------
      c.ok('there are names to click (so the next checks are not vacuous)', w.links > 50, String(w.links));
      c.ok('NO NAME CARRIES A HOVER PREVIEW ANY MORE', w.tips === 0, `${w.tips} [data-tip]`);
      c.ok('hovering or tabbing onto a name opens no card', w.cardAfterHover === false, String(w.cardAfterHover));
      c.ok('and no row: nothing is open until a name is clicked',
        J(w.openAtStart) === '[]' && J(w.openAfterHover) === '[]', `${J(w.openAtStart)} ${J(w.openAfterHover)}`);

      // ---- every row, before any click ---------------------------------------
      for (const t of w.lines || []) {
        const lead = t.id === 'takenTable' ? LEAD.taken : LEAD.wire;
        const bad = t.rows.filter((r) =>
          J(r.pastAt) !== J([lead, lead + 1, lead + 2]) || J(r.line) !== J([lead + 3]) || r.coloured);
        c.ok(`#${t.id}: EVERY row has the three previous weeks and the line at week 4`,
          t.rows.length > 5 && bad.length === 0, `${bad.length} of ${t.rows.length} wrong: ${J(bad[0])}`);
        // Avg is over the PRICED weeks only: re-derived from the cells right of
        // the line, the way the note describes it (weeks above zero count).
        const off = t.rows.filter((r) => {
          const real = r.futureV.map(Number).filter((v) => v > 0);
          const mean = real.length ? real.reduce((x, y) => x + y, 0) / real.length : null;
          // The wire prints its Avg key to the tenth; half a tenth is the slack.
          return mean === null ? r.avg !== null : Math.abs(Number(r.avg) - mean) > 0.051;
        });
        c.ok(`#${t.id}: Avg is still the mean of the weeks to come — no previous week in it`,
          off.length === 0, `${off.length} off: ${J(off[0] && { avg: off[0].avg, f: off[0].futureV, p: off[0].pastV })}`);
        // …which only means something if the previous weeks would have moved it.
        const moved = t.rows.filter((r) => {
          const all = [...r.pastV, ...r.futureV].map(Number).filter((v) => v > 0);
          const mean = all.length ? all.reduce((x, y) => x + y, 0) / all.length : null;
          return mean !== null && Math.abs(Number(r.avg) - mean) > 0.2;
        });
        if (t.id === 'waiverTable') {
          c.ok('and counting them WOULD have changed it for some men, so that is not vacuous',
            moved.length > 0, `${moved.length} rows`);
        }
      }

      c.ok('the played weeks are bought with the page, once: wire and rosters for 1-3',
        J(w.rosterBefore) === '[1,2,3]' && J(w.wireBefore) === '[1,2,3]',
        `rosters ${J(w.rosterBefore)} wire ${J(w.wireBefore)}`);

      // ---- Alden Ross: projects 22 flat, scored 25.4, 18.2, 30.0 -------------
      const ross = named('Alden Ross', 7101);
      mainRow(ross, w.ross, LEAD.taken, ['22.0', '22.0', '22.0']);
      actRow(ross, w.ross, LEAD.taken, ['25.4', '18.2', '30.0']);
      c.ok('THE ROW SHOWS HIS SCORES AND NOT HIS PROJECTIONS — the two differ in every week',
        w.ross && w.ross.act && w.ross.act.past.every((v, i) => v !== w.ross.past[i]),
        J(w.ross && w.ross.act && [w.ross.past, w.ross.act.past]));
      c.ok('one row is open in the whole page', J(w.openAfterRoss) === '["7101"]', J(w.openAfterRoss));
      c.ok('the click is still the jump: he is the one marked, over the whole season',
        J(w.spotAfterRoss) === '["7101"]' && J(w.spanAfterRoss) === '["all"]',
        `${J(w.spotAfterRoss)} ${J(w.spanAfterRoss)}`);
      c.ok('the row keeps ESPN’s glance line (Avg · Proj · rank)',
        w.ross && w.ross.act && /Avg .*Proj .*QB/.test(w.ross.act.glance), w.ross && w.ross.act && w.ross.act.glance);

      // ---- it survives a re-sort ---------------------------------------------
      for (const [n, st] of (w.sorted || []).entries()) {
        c.ok(`re-sort ${n + 1} (column ${st.i}): the Actual row is still one row, directly under him`,
          st.count === 1 && st.above === 'p7101', J({ count: st.count, above: st.above }));
      }
      c.ok('the sorts really moved the men (so staying attached is not vacuous)',
        new Set((w.sorted || []).map((st) => st.order)).size >= 3,
        String(new Set((w.sorted || []).map((st) => st.order)).size));
      c.ok('and the Actual row was never sorted to the top as a man of its own',
        (w.sorted || []).length === 4 && (w.sorted || []).every((st) => st.first !== null),
        J((w.sorted || []).map((st) => st.first)));

      // ---- click again: closed; again: open ----------------------------------
      c.ok('clicking his name again closes it',
        J(w.openAfterSecond) === '[]' && w.rossClosed && w.rossClosed.act === null &&
        w.rossClosed.expanded === 'false', `${J(w.openAfterSecond)} ${w.rossClosed && w.rossClosed.expanded}`);
      c.ok('and leaves him selected', J(w.spotAfterSecond) === '["7101"]', J(w.spotAfterSecond));
      c.ok('a third click opens it again', J(w.openAfterThird) === '["7101"]', J(w.openAfterThird));

      // ---- the awkward men ---------------------------------------------------
      const hale = named('Hale Innis (bye in week 2)', 7106);
      mainRow(hale, w.hale, LEAD.taken, ['14.0', 'Bye', '14.0']);
      actRow(hale, w.hale, LEAD.taken, ['11.3', '—', '16.9']);
      c.ok('opening another man closes the first: still one row in the page',
        J(w.openAfterHale) === '["7106"]', J(w.openAfterHale));
      const kip = named('Kip Lund (no projection)', 7108);
      mainRow(kip, w.kip, LEAD.taken, ['—', '—', '—']);
      actRow(kip, w.kip, LEAD.taken, ['4.0', '—', '—']);

      // Hand-checked: Player 00 projects 20.00, 15.20, 24.00 and scored 1.2x - 1.
      const p00 = named('Player 00 (free agent)', 5000);
      mainRow(p00, w.p00, LEAD.wire, ['20.0', '15.2', '24.0']);
      actRow(p00, w.p00, LEAD.wire, ['23.0', '17.2', '27.8']);
      c.ok('a free agent’s row is the only one open, taken table included',
        J(w.openAfterWire) === '["5000"]', J(w.openAfterWire));
      const p07 = named('Player 07 (free agent, bye in week 2)', 5007);
      mainRow(p07, w.p07, LEAD.wire, null);
      actRow(p07, w.p07, LEAD.wire, null);
      c.ok('Player 07: his bye reads Bye, with no score under it',
        w.p07 && w.p07.past[1] === 'Bye' && w.p07.act && w.p07.act.past[1] === '—', J(w.p07 && [w.p07.past, w.p07.act && w.p07.act.past]));
      const p02 = named('Player 02 (free agent, no projection in week 1)', 5002);
      mainRow(p02, w.p02, LEAD.wire, null);
      actRow(p02, w.p02, LEAD.wire, null);
      c.ok('Player 02: no projection is "—", and his score still shows',
        w.p02 && w.p02.past[0] === '—' && w.p02.act && w.p02.act.past[0] === '3.1', J(w.p02 && [w.p02.past, w.p02.act && w.p02.act.past]));

      c.ok('every click was free: no played week was bought twice',
        J(w.wireAfterAll) === '[1,2,3]' && J(w.rosterAfterAll) === '[1,2,3]',
        `rosters ${J(w.rosterAfterAll)} wire ${J(w.wireAfterAll)}`);
      c.ok('"How to read this table" says what the Actual row is',
        /Actual/.test(w.note || '') && /played/i.test(w.note || ''), (w.note || '').slice(0, 200));
    }

    if (scenario === 'past-partial') {
      // Week 4 has one final game of five. It is NOT a previous week.
      heads(w.heads);
      mainRow(named('Alden Ross', 7101), w.ross, LEAD.taken, ['22.0', '22.0', '22.0']);
    }

    if (scenario === 'past-touch') {
      const ross = named('tap on Alden Ross', 7101);
      mainRow(ross, w.ross, LEAD.taken, ['22.0', '22.0', '22.0']);
      actRow(ross, w.ross, LEAD.taken, ['25.4', '18.2', '30.0']);
      c.ok('one row, his', J(w.open) === '["7101"]', J(w.open));
      c.ok('and no sheet or card opened over the page', w.card === false, String(w.card));
      c.ok('the tap selected him', J(w.spot) === '["7101"]', J(w.spot));
    }

    if (scenario === 'link-week' || scenario === 'link-week-wire') {
      const wire = scenario === 'link-week-wire';
      const lead = wire ? LEAD.wire : LEAD.taken;
      const id = wire ? 5000 : 7101;
      const week = wire ? 3 : 2;
      const at = lead + week - 1;
      const who = named(wire ? 'Player 00' : 'Alden Ross', id);
      c.ok('the link still lands on the man', J(w.spot) === J([String(id)]) && /Jumped to/.test(w.jump || ''),
        `${J(w.spot)} ${w.jump}`);
      mainRow(who, w.row, lead, wire ? ['20.0', '15.2', '24.0'] : ['22.0', '22.0', '22.0']);
      actRow(who, w.row, lead, wire ? ['23.0', '17.2', '27.8'] : ['25.4', '18.2', '30.0']);
      c.ok('his Actual row is the one open', J(w.open) === J([String(id)]), J(w.open));
      c.ok('EXACTLY TWO CELLS ARE BOXED in the whole page', w.boxes === 2, String(w.boxes));
      c.ok('one on his own row and one on his Actual row',
        J((w.boxRows || []).slice().sort()) === J([`act:${id}`, `p${id}`].sort()), J(w.boxRows));
      c.ok(`on his row it is the week ${week} PROJECTION`,
        w.row && J(w.row.box) === J([{ at, text: wire ? '24.0' : '22.0' }]), J(w.row && w.row.box));
      c.ok(`on his Actual row it is the week ${week} SCORE, in the same column`,
        w.row && w.row.act && J(w.row.act.box) === J([{ at, text: wire ? '27.8' : '18.2' }]),
        J(w.row && w.row.act && w.row.act.box));
      c.ok('and that column’s header is that week',
        w.head && w.head.weeks[week - 1] === String(week) && w.head.pastAt[week - 1] === at, J(w.head));
    }

    if (scenario === 'link-week-future') {
      c.ok('the link still lands on the man', J(w.spot) === '["7101"]' && /Jumped to Alden Ross/.test(w.jump || ''),
        `${J(w.spot)} ${w.jump}`);
      c.ok('a week that is not over has no score: NOTHING is boxed', w.boxes === 0, String(w.boxes));
      c.ok('the previous weeks are still drawn', w.row && J(w.row.past) === J(['22.0', '22.0', '22.0']), J(w.row && w.row.past));
    }

    if (scenario === 'past-demo') {
      heads(w.heads);
      const { generateDemoWeekRosters } = await import(
        pathToFileURL(path.join(REPO, 'js/demo-rosters.js')).href
      );
      // The squad man, re-derived from the demo generator itself.
      const fmtP = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(1));
      const fmtA = (v) => (typeof v === 'number' ? v.toFixed(1) : '—');
      const want = { proj: [], act: [] };
      for (const wk of [1, 2, 3]) {
        const man = generateDemoWeekRosters(wk).teams.flatMap((t) => t.players)
          .find((p) => String(p.playerId) === w.takenId);
        want.proj.push(man ? fmtP(man.projected) : '—');
        want.act.push(man ? fmtA(man.actual) : '—');
      }
      const man = named('a demo squad man', w.takenId);
      c.ok('a demo squad man: his previous weeks are the generator’s projections',
        w.taken && J(w.taken.past.map((v) => v.replace(/ (OUT|IR|SUSP)$/, ''))) === J(want.proj),
        `${J(w.taken && w.taken.past)} want ${J(want.proj)}`);
      mainRow(man, w.taken, LEAD.taken, null);
      actRow(man, w.taken, LEAD.taken, want.act);
      c.ok('the demo squad man really has three scores (not vacuous)',
        want.act.every((a) => /^\d+\.\d$/.test(a)), J(want));
      const fa = named('a demo free agent', w.wireId);
      mainRow(fa, w.wire, LEAD.wire, null);
      actRow(fa, w.wire, LEAD.wire, null);
      c.ok('a demo free agent shows a projection and a score for each played week',
        w.wire && w.wire.act && w.wire.past.every((v) => /^\d+\.\d|^Bye$/.test(v)) &&
        w.wire.act.past.every((v, i) => (w.wire.past[i] === 'Bye' ? v === '—' : /^\d+\.\d$/.test(v))),
        J(w.wire && [w.wire.past, w.wire.act && w.wire.act.past]));
      c.ok('and opening his closed the squad man’s: one row in the page',
        J(w.open) === J([String(w.wireId)]), J(w.open));
    }
    return c.out;
  }

  // ---- (e) two squads, one label -------------------------------------------
  //
  // Teams 1 and 2 both render "Jordan Vance". The claim is that they are still
  // two depth charts, and the way to prove it is to count RANKS rather than to
  // read the page's own owner column back to it: if the squads merged, the two
  // rosters are ranked as one, so the quarterbacks — three on team 1, two on
  // team 2 — come out QB1..QB5 instead of QB1..QB3 and QB1..QB2.
  if (scenario === 'same-label') {
    const all = takenSnapshot(d);
    const label = 'Jordan Vance';
    const merged = all.filter((r) => r.owner === label);

    c.ok('both squads are in the table under one label',
      merged.length === 20, `${merged.length} rows labelled ${label}`);

    const qbRanks = merged
      .filter((r) => /^QB/.test(r.pos))
      .map((r) => r.pos.replace(/[^0-9]/g, ''))
      .filter(Boolean)
      .sort();

    // Team 1 holds three QBs, team 2 holds two. Kept apart that is 1,1,2,2,3.
    // Merged it would be 1,2,3,4,5 — and every one of those numbers would be a
    // confident statement about a depth chart that does not exist.
    c.ok('the quarterbacks are ranked within their own squads, not across both',
      qbRanks.join(',') === '1,1,2,2,3', `ranks were ${qbRanks.join(',')}`);

    c.ok('so no rank runs past the deepest single squad',
      !qbRanks.some((r) => Number(r) > 3), qbRanks.join(','));

    // And the ranks really are keyed on something other than the label: each
    // squad has to own a QB1, which cannot happen if they share a chart.
    const ones = qbRanks.filter((r) => r === '1').length;
    c.ok('each squad keeps its own QB1', ones === 2, `${ones} men ranked QB1`);

    return c.out;
  }

  // ---- (c)/(d) the ?player= deep link --------------------------------------
  //
  // These two land the page on one man, so the shared assertions below — which
  // all assume an unfiltered table — do not apply and the scenarios answer for
  // themselves.
  if (scenario === 'jump' || scenario === 'jump-unknown') {
    const w = globalThis.__jump || {};

    if (scenario === 'jump') {
      c.ok('the strip names the man the link pointed at',
        /Jumped to Cade Dunlow/.test(w.jump || ''), w.jump);
      c.ok('and says whose roster he is on',
        /Ridgeway Rovers/.test(w.jump || ''), w.jump);
      c.ok('the strip is shown', !/\bhidden\b/.test(w.jumpCls || ''), w.jumpCls);

      c.ok('HIS ROW IS MARKED, AND ONLY HIS',
        JSON.stringify(w.spot) === JSON.stringify(['7103']) && w.spotAnywhere === 1,
        `${JSON.stringify(w.spot)} / ${w.spotAnywhere} marked in the document`);

      c.ok('THE SPAN IS WIDENED TO THE WHOLE SEASON — "his next 13 weeks"',
        JSON.stringify(w.spanOn) === JSON.stringify(['all']), JSON.stringify(w.spanOn));
      c.ok('and both copies of the span control agree, because there is one span',
        JSON.stringify(w.takenSpanOn) === JSON.stringify(w.spanOn),
        `${JSON.stringify(w.spanOn)} vs ${JSON.stringify(w.takenSpanOn)}`);
      c.ok('BUT THE READER’S OWN SPAN PREFERENCE IS NOT OVERWRITTEN',
        w.savedSpan === '3', String(w.savedSpan));

      c.ok('the table he is in is put on HIS position',
        JSON.stringify(w.takenOn) === JSON.stringify(['QB']), JSON.stringify(w.takenOn));
      c.ok('and the OTHER table’s filter is left alone',
        JSON.stringify(w.wireOn) === JSON.stringify(['ALL']), JSON.stringify(w.wireOn));
      c.ok('so what is on screen is him among the men he is measured against',
        (w.rows || []).length > 1 && (w.rows || []).every((r) => bareOf(r.pos) === 'QB'),
        JSON.stringify((w.rows || []).map((r) => r.pos)));

      // He is his squad's QB3 over three weeks and their best over the run-in.
      // The jump widened the span, so the rank on arrival must be the WIDE one:
      // that is the difference between landing on the right answer and landing
      // on the one the reader happened to have set.
      const him = (w.rows || []).find((r) => r.player === '7103');
      c.ok('AND HIS RANK IS THE ONE FOR THE WIDENED SPAN, NOT THE OLD ONE',
        him && him.pos === 'QB1', him && him.pos);

      // No `&week=`: everything above is what it always was, and his Actual
      // row is open under him with nothing boxed.
      const lk = w.link || {};
      c.ok('his Actual row is open under him, and it is the only one',
        JSON.stringify(lk.open) === JSON.stringify(['7103']) && lk.row && lk.row.act &&
        lk.row.act.label === 'Actual', JSON.stringify(lk.open));
      c.ok('and with no &week= nothing is boxed', lk.boxes === 0, String(lk.boxes));

      c.ok('clearing takes the mark and the strip away',
        w.afterClear && w.afterClear.spot === 0 && /\bhidden\b/.test(w.afterClear.jumpCls),
        JSON.stringify(w.afterClear));
      c.ok('but leaves the span and the filter where the jump put them',
        w.afterClear && JSON.stringify(w.afterClear.takenOn) === JSON.stringify(['QB']) &&
        JSON.stringify(w.afterClear.spanOn) === JSON.stringify(['all']),
        JSON.stringify(w.afterClear));

      c.ok('and no roster week was bought twice getting there',
        new Set(w.rosterWeeks || []).size === (w.rosterWeeks || []).length,
        JSON.stringify(w.rosterWeeks));
    }

    if (scenario === 'jump-unknown') {
      c.ok('an id nobody holds says so rather than failing silently',
        /No player with id 424242/.test(w.jump || ''), w.jump);
      c.ok('and offers a reason it might happen',
        /dropped|another league/.test(w.jump || ''), w.jump);
      c.ok('nothing is marked', w.spot === 0, String(w.spot));
      c.ok('and the table is left showing everybody rather than nobody',
        w.rows > 0, String(w.rows));
    }

    return c.out;
  }

  // ---- the shape ------------------------------------------------------------
  const head = [...d.querySelectorAll('#takenTable thead th')].map((th) => txt(th));
  c.ok('the identity columns are Player, Pos, Tm, Owner and Avg',
    JSON.stringify(head.slice(0, 5)) === JSON.stringify(['Player', 'Pos', 'Tm', 'Owner', 'Avg']),
    JSON.stringify(head));
  c.ok('nothing but weeks after them',
    head.length > 5 && head.slice(5).every((h) => /^\d+$/.test(h)), JSON.stringify(head));
  c.ok('the same weeks as the available table',
    JSON.stringify(head.slice(5)) ===
      JSON.stringify([...d.querySelectorAll('#waiverTable thead th')].map((th) => txt(th)).slice(5)),
    JSON.stringify(head));
  c.ok('every header is sortable',
    [...d.querySelectorAll('#takenTable thead th')].every((th) => th.hasAttribute('data-sort')),
    'a header has no data-sort');
  c.ok('the table has rows at all', rows.length > 0, `${rows.length}`);

  // ---- the two tables hold disjoint men -------------------------------------
  const wireRows = [...d.querySelectorAll('#waiverTable tbody tr')]
    .filter((tr) => !/\b(mine|empty-row)\b/.test(tr.getAttribute('class') || ''));
  const takenIds = new Set(rows.map((r) => r.player));
  const wireIds = wireRows.map((tr) => tr.getAttribute('data-player'));
  c.ok('the wire still has its free agents', wireRows.length > 0, `${wireRows.length}`);
  c.ok('not one free agent appears in the taken table',
    wireIds.every((id) => !takenIds.has(id)),
    wireIds.filter((id) => takenIds.has(id)).slice(0, 4).join(','));
  c.ok('and every taken row is a distinct player',
    takenIds.size === rows.length, `${takenIds.size} ids for ${rows.length} rows`);

  // ---- groundwork for the click-through, which is deliberately NOT built ----
  c.ok('every taken row is addressable by player id',
    rows.every((r) => r.id === `p${r.player}` && r.player), JSON.stringify(rows[0]));
  c.ok('so is every wire row',
    wireRows.every((tr) => tr.getAttribute('id') === `p${tr.getAttribute('data-player')}`),
    wireRows.slice(0, 2).map((tr) => tr.getAttribute('id')).join(','));
  const mineRows = [...d.querySelectorAll('#waiverTable tbody tr.mine')];
  c.ok('a comparison row carries the player id but not the element id — it is his second appearance',
    mineRows.every((tr) => tr.getAttribute('data-player') && !tr.hasAttribute('id')),
    mineRows.map((tr) => tr.getAttribute('id')).join(','));
  const allIds = [...d.querySelectorAll('tr[id]')].map((tr) => tr.getAttribute('id'));
  c.ok('no element id is used twice in the document',
    new Set(allIds).size === allIds.length, `${allIds.length} ids, ${new Set(allIds).size} distinct`);
  // The click-through IS built now — this block used to assert the opposite,
  // deliberately, and this is the considered replacement rather than a deletion.
  const takenLinks = [...d.querySelectorAll('#takenTable tbody a.pref')];
  c.ok('every taken row’s name is a link to that player',
    takenLinks.length === rows.length, `${takenLinks.length} links, ${rows.length} rows`);
  c.ok('the link is a real href carrying ESPN’s own id, not a click handler',
    takenLinks.every((a) => /^waivers\.html\?player=\d+$/.test(a.getAttribute('href') || '')),
    takenLinks[0] && takenLinks[0].getAttribute('href'));
  c.ok('and the id in the href is the row’s own player',
    takenLinks.every((a) => {
      const tr = a.closest('tr');
      return a.getAttribute('href') === `waivers.html?player=${tr.getAttribute('data-player')}`;
    }), takenLinks[0] && takenLinks[0].getAttribute('href'));
  c.ok('the wire’s names are links too, by the same contract',
    wireRows.every((tr) => {
      const a = tr.querySelector('td.name a.pref');
      return a && a.getAttribute('href') === `waivers.html?player=${tr.getAttribute('data-player')}`;
    }), 'a wire row has no link, or the wrong one');
  c.ok('linking did not change what a name cell reads',
    rows.every((r) => r.name && !/</.test(r.name)), JSON.stringify(rows[0] && rows[0].name));

  // ---- the rank, re-derived from the rendered Avg ---------------------------
  const want = ranksFromRendered(rows);
  const wrongRank = rows.filter((r) => rankOf(r.pos) !== want.get(r.player));
  c.ok('every rank matches the one re-derived from the rendered Avg column',
    wrongRank.length === 0,
    wrongRank.slice(0, 4).map((r) => `${r.name} ${r.owner} got ${r.pos} want ${want.get(r.player)}`).join(' | '));
  c.ok('and some position group actually has a third man, so that is not vacuous',
    rows.some((r) => rankOf(r.pos) >= 3), JSON.stringify(rows.map((r) => r.pos).slice(0, 8)));
  c.ok('every rank counts from 1 within its owner and position',
    [...new Set(rows.map((r) => `${r.owner}|${bareOf(r.pos)}`))].every((key) => {
      const group = rows.filter((r) => `${r.owner}|${bareOf(r.pos)}` === key && rankOf(r.pos) !== null);
      const ranks = group.map((r) => rankOf(r.pos)).sort((a, b) => a - b);
      return ranks.every((v, i) => v === i + 1);
    }), 'a rank sequence has a hole or starts above 1');

  // ---- the sort keys --------------------------------------------------------
  const POS_ORDER = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DST: 6 };
  c.ok('the Pos key encodes the football order and the rank together',
    rows.every((r) => Number(r.posKey) ===
      (POS_ORDER[bareOf(r.pos)] ?? 9) * 100 + (rankOf(r.pos) ?? 99)),
    rows.slice(0, 4).map((r) => `${r.pos}=${r.posKey}`).join(','));
  const keyFor = (pos) => {
    const r = rows.find((x) => bareOf(x.pos) === pos);
    return r ? Number(r.posKey) : null;
  };
  c.ok('so the Pos column sorts QB before DST',
    keyFor('QB') !== null && keyFor('DST') !== null && keyFor('QB') < keyFor('DST'),
    `QB ${keyFor('QB')} vs DST ${keyFor('DST')}`);
  const firstQb = rows.filter((r) => r.pos === 'QB1').map((r) => Number(r.posKey));
  const secondQb = rows.filter((r) => r.pos === 'QB2').map((r) => Number(r.posKey));
  c.ok('and rank 1 before rank 2 inside a position',
    firstQb.length > 0 && secondQb.length > 0 && Math.max(...firstQb) < Math.min(...secondQb),
    `${JSON.stringify(firstQb)} vs ${JSON.stringify(secondQb)}`);
  c.ok('the Owner column sorts alphabetically on the name shown',
    rows.every((r) => r.ownerKey === r.owner.toLowerCase()),
    rows.slice(0, 3).map((r) => `${r.owner}/${r.ownerKey}`).join(','));
  c.ok('a blank Avg carries no sort key at all — never data-v=""',
    rows.every((r) => (r.avgText === '—') === (r.avg === null)),
    rows.filter((r) => (r.avgText === '—') !== (r.avg === null)).slice(0, 3)
      .map((r) => `${r.name} ${r.avgText}/${r.avg}`).join(','));

  // ---- no colour, anywhere --------------------------------------------------
  const cells = [...d.querySelectorAll('#takenTable tbody td')];
  c.ok('not one cell in the taken table is green text',
    cells.every((td) => !/\bhot\b/.test(td.getAttribute('class') || '')),
    cells.filter((td) => /\bhot\b/.test(td.getAttribute('class') || '')).length + ' hot');
  c.ok('nor is one shaded',
    cells.every((td) => !/\bbeats\b/.test(td.getAttribute('class') || '')),
    cells.filter((td) => /\bbeats\b/.test(td.getAttribute('class') || '')).length + ' shaded');
  const overBar = rows.reduce((n, r) => n + r.week.filter((td) =>
    td.v !== null && typeof BARS[bareOf(r.pos)] === 'number' &&
    Number(td.v) > BARS[bareOf(r.pos)]).length, 0);
  c.ok('and plenty of those numbers clear the startable bar, so that is not vacuous',
    overBar > 0, `${overBar} over the bar`);
  c.ok('the wire above is still coloured, so the difference is the table and not the data',
    [...d.querySelectorAll('#waiverTable tbody td.hot')].length > 0, 'no green on the wire either');

  // ---- a bye is not a blank -------------------------------------------------
  // Since 2026-09-16 a zero is a bye only in the bye week. The stub league's
  // byes are unknown, so its zeros keep the old reading; the SAMPLE squads
  // mean "ruled out" by a zero and never a bye, so demo draws "0.0 OUT".
  const byeCells = rows.flatMap((r) => r.week).filter((td) => /\bbye\b/.test(td.cls));
  const zeroCells = rows.flatMap((r) => r.week).filter((td) => td.v === '0');
  if (scenario === 'demo') {
    c.ok('a demo zero is a ruled-out man, drawn 0.0 with the word, never Bye',
      zeroCells.length > 0 && byeCells.length === 0 &&
      zeroCells.every((td) => /^0\.0 (OUT|IR|SUSP)$/.test(td.text) && /\bzero-out\b/.test(td.cls)),
      JSON.stringify(zeroCells.slice(0, 2)));
    c.ok('and the key names that mark, and no Bye',
      !d.querySelector('#takenLegend [data-when="td.zero-out"]').hasAttribute('hidden') &&
      d.querySelector('#takenLegend [data-when="td.bye"]').hasAttribute('hidden'),
      d.getElementById('takenLegend').outerHTML.slice(0, 300));
  } else {
    c.ok('a bye renders as Bye carrying the zero ESPN returned',
      byeCells.length > 0 && byeCells.every((td) => td.text === 'Bye' && td.v === '0'),
      JSON.stringify(byeCells.slice(0, 2)));
  }

  // ---- the note -------------------------------------------------------------
  c.ok('the note says what Avg is and that it is ours',
    /Avg is the mean of the weeks shown and is ours, not ESPN’s/.test(note), note);
  // D7 (2026-09-20): only weeks projecting above zero count — a bye, a man
  // ruled out and a blank week all leave the average, as on the Trade page.
  c.ok('the note says byes, ruled-out weeks and blank weeks are all left out',
    /only weeks projecting above zero count, so a bye, a man ruled out and a week with no number at all are all left out/.test(note),
    note);
  c.ok('the note says what the rank means',
    /where he ranks on his own manager’s roster/.test(note) &&
    /QB3 is that manager’s third-best quarterback/.test(note), note);
  c.ok('the note says the rank moves with the span',
    /it moves with the span/.test(note) && /a QB2 can become a QB3/.test(note), note);
  c.ok('the note says the rank is ours and not ESPN’s depth chart',
    /our ordering rather than ESPN’s depth chart/.test(note), note);
  c.ok('the note says an unratable man gets no rank',
    /cannot be ranked at all/.test(note) && /bare position/.test(note), note);
  c.ok('the note says nothing is highlighted',
    /Nothing here is highlighted, on purpose/.test(note), note);
  c.ok('and says why — nobody here can be claimed',
    /nobody on this list can be claimed/.test(note), note);
  c.ok('the note distinguishes a Bye cell from a blank one',
    /Bye is the 0\.00 ESPN returns/.test(note) && /blank cell means/.test(note) &&
    /not the same thing/.test(note), note);
  c.ok('the note says the table covers any week shown, not just the first',
    /on a roster in .{0,20}any.{0,20} of weeks/.test(note.replace(/\s+/g, ' ')), note);
  c.ok('and which week decides who owns whom',
    /Owner is the manager holding him in the earliest of those weeks he actually appears in/
      .test(note.replace(/\s+/g, ' ')), note);
  c.ok('and that a week he was not rostered for is blank rather than guessed',
    /not rostered for is blank rather than guessed at/.test(note.replace(/\s+/g, ' ')), note);
  // This used to assert the opposite — that the counts were the WIRE's, because
  // the two tables shared one control. They do not any more, and the note has to
  // say whose numbers these are or the buttons are quietly claiming the wrong
  // pool. Deliberate replacement, not a deletion.
  c.ok('the note says this table has its own position buttons',
    /its own position buttons/.test(note), note);
  c.ok('and that their counts are this table’s',
    /counts on them are this table’s/.test(note), note);
  c.ok('and that they move nothing but this table',
    /move nothing but this table/.test(note), note);
  c.ok('the note says what FLEX is, in English rather than as a token',
    /FLEX here is the same filter as on the wire above/.test(note) &&
    /every running back, receiver and tight end the league is holding/.test(note), note);
  c.ok('and that FLEX leaves the rank beside a name alone',
    /leaves the rank beside a name completely alone/.test(note) &&
    /there is no such thing as a FLEX2/.test(note), note);
  c.ok('the note says the span is shared, and why',
    /the same one as at the top of the page/.test(note) &&
    /priced\s+over the same weeks/.test(note.replace(/\s+/g, ' ')), note);
  c.ok('the note says the names are links and what following one does',
    /Every name here is a link/.test(note) && /marks his row/.test(note), note);

  // The counts on the buttons must actually BE this table's, not just claimed.
  const takenCounts = [...d.querySelectorAll('#takenPosFilter button[data-pos]')]
    .map((b) => [b.getAttribute('data-pos'), (b.querySelector('.seg-count') || {}).textContent]);
  const byPos = {};
  for (const r of rows) byPos[bareOf(r.pos)] = (byPos[bareOf(r.pos)] || 0) + 1;
  // FLEX is not a position, so its count is the three flex-eligible ones added
  // together — re-derived here from the rendered Pos column rather than from the
  // page's own arithmetic, which is the only version of this check worth having.
  const wantFlex = ['RB', 'WR', 'TE'].reduce((n, p) => n + (byPos[p] || 0), 0);
  c.ok('and the counts match the rows this table actually holds',
    takenCounts.every(([pos, n]) =>
      pos === 'ALL' ? Number(n) === rows.length
        : pos === 'FLEX' ? Number(n) === wantFlex
          : Number(n) === (byPos[pos] || 0)),
    JSON.stringify(takenCounts) + ' vs ' + JSON.stringify(byPos));
  c.ok('THE FLEX COUNT IS RB + WR + TE IN THIS TABLE’S OWN POOL',
    Number((takenCounts.find(([p]) => p === 'FLEX') || [])[1]) === wantFlex,
    `${JSON.stringify(takenCounts.find(([p]) => p === 'FLEX'))} vs ${wantFlex} from ${JSON.stringify(byPos)}`);
  c.ok('and that is neither nobody nor everybody, so the check is not vacuous',
    wantFlex > 0 && wantFlex < rows.length, `${wantFlex} of ${rows.length}`);

  // ---- the FLEX button itself, on BOTH controls -----------------------------
  for (const id of ['posFilter', 'takenPosFilter']) {
    const btns = [...d.querySelectorAll(`#${id} button[data-pos]`)]
      .map((b) => b.getAttribute('data-pos'));
    c.ok(`#${id} carries a FLEX button`, btns.includes('FLEX'), btns.join(','));
    c.ok(`and it sits where a flex sits in a lineup — after TE, before K (#${id})`,
      btns.indexOf('FLEX') === btns.indexOf('TE') + 1 &&
      btns.indexOf('K') === btns.indexOf('FLEX') + 1, btns.join(','));
  }
  c.ok('FLEX is not smuggled into the Pos column as a position',
    rows.every((r) => bareOf(r.pos) !== 'FLEX'),
    rows.filter((r) => /FLEX/.test(r.pos)).map((r) => `${r.name} ${r.pos}`).join(','));

  // ---- the stat strip -------------------------------------------------------
  const stats = [...$('takenStats').querySelectorAll('.stat')].map((s) => txt(s));
  c.ok('the strip counts what is on screen', stats.some((s) => /^Taken/.test(s)), stats.join(' | '));
  c.ok('the strip states the weeks shown', stats.some((s) => /^Weeks shown/.test(s)), stats.join(' | '));
  c.ok('the strip names the best average and who owns him',
    stats.some((s) => /^Best average/.test(s)), stats.join(' | '));

  // ---- (a) the stub league, where every answer is known --------------------
  if (scenario === 'live') {
    const season = await import('./taken-stub-season.mjs');
    const w = globalThis.__taken || {};
    const byName = new Map(rows.map((r) => [r.name.replace(/\s+(OUT|IR|Q|D|SUSP|DTD)$/, ''), r]));

    c.ok('every rostered player appears, and no more',
      rows.length === season.ALL.length, `${rows.length} of ${season.ALL.length}`);
    c.ok('each one exactly once',
      season.ALL.every((p) => rows.filter((r) => r.player === String(p.playerId)).length === 1),
      season.ALL.filter((p) => rows.filter((r) => r.player === String(p.playerId)).length !== 1)
        .map((p) => p.name).join(','));

    const wrongOwner = season.ALL.filter((p) => {
      const row = rows.find((r) => r.player === String(p.playerId));
      return !row || row.owner !== p.owner;
    });
    c.ok('the Owner column names the manager who actually holds him',
      wrongOwner.length === 0,
      wrongOwner.slice(0, 4).map((p) => `${p.name} want ${p.owner}`).join(' | '));
    c.ok('all three squads are represented',
      new Set(rows.map((r) => r.owner)).size === 3,
      [...new Set(rows.map((r) => r.owner))].join(','));

    const wrongAvg = season.ALL.filter((p) => {
      const row = rows.find((r) => r.player === String(p.playerId));
      const expect = season.expectedAvg(p.playerId, [4, 5, 6]);
      return expect === null ? row.avg !== null : !near(row.avg, expect);
    });
    c.ok('the Avg is the mean over the weeks shown that project above zero',
      wrongAvg.length === 0,
      wrongAvg.slice(0, 3).map((p) =>
        `${p.name} got ${(rows.find((r) => r.player === String(p.playerId)) || {}).avg} ` +
        `want ${season.expectedAvg(p.playerId, [4, 5, 6])}`).join(' | '));

    // The QB3-shaped case, spelled out.
    c.ok('the best quarterback on a squad is his manager’s QB1',
      byName.get('Alden Ross') && byName.get('Alden Ross').pos === 'QB1',
      byName.get('Alden Ross') && byName.get('Alden Ross').pos);
    c.ok('the second is QB2',
      byName.get('Brix Calder') && byName.get('Brix Calder').pos === 'QB2',
      byName.get('Brix Calder') && byName.get('Brix Calder').pos);
    c.ok('and the third is QB3',
      byName.get('Cade Dunlow') && byName.get('Cade Dunlow').pos === 'QB3',
      byName.get('Cade Dunlow') && byName.get('Cade Dunlow').pos);
    c.ok('the rank is per manager, so another squad has its own QB1 too',
      rows.filter((r) => r.pos === 'QB1').length === 3,
      rows.filter((r) => r.pos === 'QB1').map((r) => `${r.name}/${r.owner}`).join(','));
    c.ok('the QB3’s sort key is 103 — the position, then the rank',
      byName.get('Cade Dunlow') && byName.get('Cade Dunlow').posKey === '103',
      byName.get('Cade Dunlow') && byName.get('Cade Dunlow').posKey);

    // The man ESPN has no number for.
    const lund = byName.get('Kip Lund');
    c.ok('a player ESPN has no number for shows the bare position',
      lund && lund.pos === 'TE', lund && lund.pos);
    c.ok('and no rank against it', lund && rankOf(lund.pos) === null, lund && lund.pos);
    c.ok('and a blank Avg with no sort key',
      lund && lund.avgText === '—' && lund.avg === null, lund && `${lund.avgText}/${lund.avg}`);
    c.ok('and every one of his weeks is blank, not a zero',
      lund && lund.week.every((td) => td.text === '—' && td.v === null),
      lund && JSON.stringify(lund.week));
    c.ok('he sorts to the end of his own position rather than to the top of the table',
      lund && Number(lund.posKey) === 499, lund && lund.posKey);
    c.ok('the only rated tight end on that squad is still the TE1',
      byName.get('Merrick Nolan') && byName.get('Merrick Nolan').pos === 'TE1',
      byName.get('Merrick Nolan') && byName.get('Merrick Nolan').pos);

    // A bye is the zero ESPN returned, and the average leaves it out (D7).
    const jessop = byName.get('Ivor Jessop');
    c.ok('a bye on a rostered man renders as Bye',
      jessop && jessop.week[1].text === 'Bye' && jessop.week[1].v === '0',
      jessop && JSON.stringify(jessop.week));
    c.ok('and does not drag his average down, because the week leaves it',
      jessop && near(jessop.avg, 6), jessop && jessop.avg);
    c.ok('he is still the WR2 behind a 14-a-week receiver',
      jessop && jessop.pos === 'WR2' && byName.get('Hale Innis').pos === 'WR1',
      jessop && jessop.pos);

    // The cost of all this, said out loud.
    // …and, since 2026-10-04, each week already played costs one more of each:
    // they are columns now (the previous weeks), bought once with the page.
    c.ok('every shown week cost a wire request and a roster request, the played weeks included',
      JSON.stringify(w.rosterBefore.slice().sort((a, b) => a - b)) === JSON.stringify([1, 2, 3, 4, 5, 6]) &&
      JSON.stringify(w.wireFetchesBefore.slice().sort((a, b) => a - b)) === JSON.stringify([1, 2, 3, 4, 5, 6]),
      `${JSON.stringify(w.rosterBefore)} / ${JSON.stringify(w.wireFetchesBefore)}`);
    c.ok('the previous weeks are drawn before the priced ones, and are not in `week`',
      rows.every((r) => r.past.length === 3 && r.week.length === 3),
      JSON.stringify(rows[0] && [rows[0].past, rows[0].week.length]));
    c.ok('the cost line says six requests for three weeks',
      /3 weeks = 6 requests to ESPN/.test(txt($('spanCost'))), txt($('spanCost')));
    // The sentence was shortened for the phone on 2026-09-16.
    c.ok('and says what the second request is for',
      /wire \+ rosters per week/.test(txt($('spanCost'))), txt($('spanCost')));
    c.ok('and still says there is no bulk form',
      /there is no bulk form/.test(txt($('spanCost'))), txt($('spanCost')));

    // Widening re-ranks, exactly as the note promises.
    const wideByName = new Map((w.wide || []).map((r) => [r.name, r]));
    c.ok('widening the span re-ranks the quarterbacks',
      wideByName.get('Cade Dunlow') && wideByName.get('Cade Dunlow').pos === 'QB1',
      wideByName.get('Cade Dunlow') && wideByName.get('Cade Dunlow').pos);
    c.ok('and pushes the man who was QB1 down to QB2',
      wideByName.get('Alden Ross') && wideByName.get('Alden Ross').pos === 'QB2',
      wideByName.get('Alden Ross') && wideByName.get('Alden Ross').pos);
    c.ok('and the man who was QB2 down to QB3',
      wideByName.get('Brix Calder') && wideByName.get('Brix Calder').pos === 'QB3',
      wideByName.get('Brix Calder') && wideByName.get('Brix Calder').pos);
    c.ok('the wider Avg is the mean over all six weeks',
      wideByName.get('Cade Dunlow') && near(wideByName.get('Cade Dunlow').avg, 25),
      wideByName.get('Cade Dunlow') && wideByName.get('Cade Dunlow').avg);
    c.ok('widening bought only the roster weeks it did not hold',
      JSON.stringify((w.rosterAfterWiden || []).slice().sort((a, b) => a - b)) ===
        JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]), JSON.stringify(w.rosterAfterWiden));
    c.ok('and no roster week was ever bought twice',
      new Set(w.rosterAfterWiden || []).size === (w.rosterAfterWiden || []).length,
      JSON.stringify(w.rosterAfterWiden));

    // Each table's own filter narrows that table and nothing else. Costs
    // nothing either way: every week already fetched stays fetched.
    c.ok('the taken table’s own position filter narrows the taken table',
      (w.qb || []).length === 6 && (w.qb || []).every((r) => bareOf(r.pos) === 'QB'),
      `${(w.qb || []).length}: ${(w.qb || []).map((r) => r.pos).join(',')}`);
    c.ok('THE WIRE’S FILTER LEAVES THE TAKEN TABLE ALONE',
      (w.takenAfterWireFilter || []).length === season.ALL.length,
      `${(w.takenAfterWireFilter || []).length} of ${season.ALL.length} taken rows survived`);
    c.ok('and it really did narrow the wire, so that is not a vacuous check',
      (w.wireAfterWireFilter || []).length > 0 &&
      (w.wireAfterWireFilter || []).every((r) => r.pos === 'QB'),
      JSON.stringify((w.wireAfterWireFilter || []).map((r) => r.pos)));
    c.ok('AND THE TAKEN FILTER LEAVES THE WIRE ALONE',
      (w.wireAfterTakenFilter || []).length > (w.wireAfterWireFilter || []).length &&
      (w.wireAfterTakenFilter || []).some((r) => r.pos !== 'QB'),
      `${(w.wireAfterTakenFilter || []).length} wire rows`);
    c.ok('filtering and narrowing again fetch nothing',
      JSON.stringify(w.rosterAfterFilter) === JSON.stringify(w.rosterAfterWiden),
      `${JSON.stringify(w.rosterAfterWiden)} -> ${JSON.stringify(w.rosterAfterFilter)}`);
    c.ok('clearing the filter brings every man back',
      rows.length === season.ALL.length, `${rows.length}`);

    // ---- FLEX ---------------------------------------------------------------
    //
    // A filter across RB, WR and TE. Everything below is checked against the
    // UNFILTERED table as rendered a moment earlier, so the page is being
    // measured against its own output rather than against the stub's numbers.
    const flexOf = (list) => list.filter((r) => ['RB', 'WR', 'TE'].includes(bareOf(r.pos)));
    const wantTakenFlex = flexOf(rows);

    c.ok('FLEX on the taken table shows exactly the RB, WR and TE rows',
      (w.takenFlex || []).length === wantTakenFlex.length &&
      JSON.stringify((w.takenFlex || []).map((r) => r.player).sort()) ===
        JSON.stringify(wantTakenFlex.map((r) => r.player).sort()),
      `${(w.takenFlex || []).length} shown, ${wantTakenFlex.length} eligible`);
    c.ok('and nothing else — no quarterback, kicker or defense survives it',
      (w.takenFlex || []).every((r) => ['RB', 'WR', 'TE'].includes(bareOf(r.pos))),
      [...new Set((w.takenFlex || []).map((r) => bareOf(r.pos)))].join(','));
    c.ok('it really did narrow the table, so that is not a vacuous check',
      (w.takenFlex || []).length > 0 && (w.takenFlex || []).length < rows.length,
      `${(w.takenFlex || []).length} of ${rows.length}`);
    c.ok('and it is wider than any one position, which is the point of it',
      new Set((w.takenFlex || []).map((r) => bareOf(r.pos))).size === 3,
      [...new Set((w.takenFlex || []).map((r) => bareOf(r.pos)))].join(','));
    c.ok('nobody is shown twice for being eligible three ways',
      new Set((w.takenFlex || []).map((r) => r.player)).size === (w.takenFlex || []).length,
      `${(w.takenFlex || []).length} rows`);

    // THE ASSERTION THIS WHOLE BLOCK EXISTS FOR. A rank is a fact about a man's
    // depth at HIS OWN position; a filter is a fact about what you are looking
    // at. If FLEX ever leaks into the first, every rank in the table becomes a
    // different and wrong number, and it would look perfectly plausible.
    const before = new Map(rows.map((r) => [r.player, r]));
    const movedRank = (w.takenFlex || []).filter((r) => {
      const was = before.get(r.player);
      return !was || was.pos !== r.pos || was.posKey !== r.posKey;
    });
    c.ok('EVERY RANK STILL READS BY HIS REAL POSITION UNDER FLEX',
      movedRank.length === 0,
      movedRank.slice(0, 4).map((r) =>
        `${r.name} ${r.pos}/${r.posKey} was ${(before.get(r.player) || {}).pos}`).join(' | '));
    c.ok('and no row reads FLEX in the Pos column',
      (w.takenFlex || []).every((r) => !/FLEX/i.test(r.pos)),
      (w.takenFlex || []).map((r) => r.pos).join(','));
    const flexByName = new Map((w.takenFlex || []).map((r) => [r.name, r]));
    c.ok('the man whose bye made him a WR2 is still a WR2, not a FLEX-anything',
      flexByName.get('Ivor Jessop') && flexByName.get('Ivor Jessop').pos === 'WR2',
      flexByName.get('Ivor Jessop') && flexByName.get('Ivor Jessop').pos);
    c.ok('the only rated tight end on that squad is still the TE1',
      flexByName.get('Merrick Nolan') && flexByName.get('Merrick Nolan').pos === 'TE1',
      flexByName.get('Merrick Nolan') && flexByName.get('Merrick Nolan').pos);
    c.ok('and the unrankable tight end still shows the bare position and keys 499',
      flexByName.get('Kip Lund') && flexByName.get('Kip Lund').pos === 'TE' &&
      flexByName.get('Kip Lund').posKey === '499',
      flexByName.get('Kip Lund') && `${flexByName.get('Kip Lund').pos}/${flexByName.get('Kip Lund').posKey}`);

    c.ok('the count on the FLEX button is what it shows',
      Number(w.takenFlexCount) === wantTakenFlex.length,
      `${w.takenFlexCount} vs ${wantTakenFlex.length}`);
    c.ok('the stat strip names the three positions rather than quoting the button',
      /^Taken RB\/WR\/TE$/.test((w.takenFlexLabel || '').trim()), w.takenFlexLabel);
    c.ok('and there is no empty state, because FLEX matched people',
      w.takenFlexEmpty === 0, String(w.takenFlexEmpty));

    // Independence, which is new for FLEX and is exactly the kind of thing that
    // regresses quietly: each table answers its own button, and holding one on
    // FLEX while the other is pressed must change nothing on the first.
    c.ok('FLEX ON THE TAKEN TABLE LEAVES THE WIRE ALONE',
      (w.wireDuringTakenFlex || []).length === (w.wireBefore || []).length &&
      (w.wireDuringTakenFlex || []).some((r) => !['RB', 'WR', 'TE'].includes(r.pos)),
      `${(w.wireDuringTakenFlex || []).length} of ${(w.wireBefore || []).length} wire rows`);
    c.ok('FLEX on the wire shows exactly its own RB, WR and TE',
      (w.wireFlex || []).length === flexOf(w.wireBefore || []).length &&
      (w.wireFlex || []).every((r) => ['RB', 'WR', 'TE'].includes(r.pos)),
      `${(w.wireFlex || []).length} of ${(w.wireBefore || []).length}`);
    c.ok('with its own count, which is the wire’s pool and not the taken one',
      Number(w.wireFlexCount) === flexOf(w.wireBefore || []).length &&
      Number(w.wireFlexCount) !== wantTakenFlex.length,
      `${w.wireFlexCount} vs wire ${flexOf(w.wireBefore || []).length} / taken ${wantTakenFlex.length}`);
    c.ok('and its own strip label',
      /^Available RB\/WR\/TE$/.test((w.wireFlexLabel || '').trim()), w.wireFlexLabel);
    c.ok('AND FLEX ON THE WIRE LEAVES THE TAKEN TABLE WHERE IT WAS',
      JSON.stringify((w.takenDuringWireFlex || []).map((r) => r.player)) ===
        JSON.stringify((w.takenFlex || []).map((r) => r.player)),
      `${(w.takenDuringWireFlex || []).length} vs ${(w.takenFlex || []).length}`);
    c.ok('and clearing the taken filter does not clear the wire’s',
      (w.wireStillFlex || []).length === (w.wireFlex || []).length,
      `${(w.wireStillFlex || []).length} vs ${(w.wireFlex || []).length}`);
    c.ok('clearing both brings every wire row back',
      (w.wireAfterFlex || []).length === (w.wireBefore || []).length,
      `${(w.wireAfterFlex || []).length} of ${(w.wireBefore || []).length}`);
    c.ok('SELECTING FLEX COSTS NO REQUEST — it is a repaint, on either table',
      JSON.stringify(w.wireFetchesAfterFlex) === JSON.stringify(w.wireFetchesBeforeFlex) &&
      JSON.stringify(w.rosterAfterFilter) === JSON.stringify(w.rosterBeforeFlex),
      `wire ${JSON.stringify(w.wireFetchesBeforeFlex)} -> ${JSON.stringify(w.wireFetchesAfterFlex)}, ` +
      `rosters ${JSON.stringify(w.rosterBeforeFlex)} -> ${JSON.stringify(w.rosterAfterFilter)}`);
  }

  // ---- (b) the real demo squads --------------------------------------------
  if (scenario === 'demo') {
    const { generateDemoWeekRosters } = await import(
      pathToFileURL(path.join(REPO, 'js/demo-rosters.js')).href
    );
    // MEMBERSHIP IS THE UNION OVER EVERY WEEK ON SCREEN — weeks 4, 5 and 6 at
    // the default span — and the owner is the earliest of those weeks the man
    // actually appears in.
    //
    // This block asserted week 4 alone until the union replaced it. Rosters
    // really do turn over in the demo (45 of 160 men differ between weeks 4 and
    // 13), so the old rule left a man rostered in week 5 out of a table whose
    // columns include week 5 — and made a link to him from another page land on
    // "he may have been dropped". Re-derived here from demo-rosters.js the same
    // way the page derives it, but written independently.
    const SHOWN = [4, 5, 6];
    const teams = generateDemoWeekRosters(SHOWN[0]).teams;
    const ownerOf = new Map();
    for (const week of SHOWN) {
      for (const t of generateDemoWeekRosters(week).teams) {
        for (const p of t.players) {
          if (!ownerOf.has(String(p.playerId))) ownerOf.set(String(p.playerId), t.name);
        }
      }
    }
    const weekFour = new Set(teams.flatMap((t) => t.players.map((p) => String(p.playerId))));

    c.ok('every man on a demo roster in any week shown is listed',
      rows.length === ownerOf.size, `${rows.length} of ${ownerOf.size}`);
    c.ok('and every row is somebody who is really on one',
      rows.every((r) => ownerOf.has(r.player)),
      rows.filter((r) => !ownerOf.has(r.player)).slice(0, 3).map((r) => r.name).join(','));
    c.ok('the union is genuinely wider than the first week, so that is not vacuous',
      ownerOf.size > weekFour.size, `${ownerOf.size} over ${weekFour.size} in week 4`);
    const wrongOwner = rows.filter((r) => r.owner !== ownerOf.get(r.player));
    c.ok('the Owner column names the manager holding him in the earliest week he appears',
      wrongOwner.length === 0,
      wrongOwner.slice(0, 3).map((r) => `${r.name} got ${r.owner} want ${ownerOf.get(r.player)}`).join(' | '));
    c.ok('a man on a week-4 roster still takes his week-4 owner',
      rows.filter((r) => weekFour.has(r.player))
        .every((r) => r.owner === ownerOf.get(r.player)), 'a week-4 man has the wrong owner');
    c.ok('all ten demo squads are represented',
      new Set(rows.map((r) => r.owner)).size === teams.length,
      `${new Set(rows.map((r) => r.owner)).size}`);
    c.ok('every position appears',
      ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].every((p) => rows.some((r) => bareOf(r.pos) === p)),
      [...new Set(rows.map((r) => bareOf(r.pos)))].join(','));
    c.ok('a demo squad really does run three deep somewhere',
      rows.some((r) => rankOf(r.pos) >= 3), 'no rank of 3 anywhere');
    c.ok('the note admits the squads are invented',
      /invented squads with invented projections/.test(note), note);
    c.ok('the taken table is sorted by Avg, best first',
      (() => {
        const avgs = rows.map((r) => (r.avg === null ? null : Number(r.avg)));
        return avgs.every((v, i) => i === 0 || v === null || avgs[i - 1] === null || v <= avgs[i - 1]);
      })(), JSON.stringify(rows.slice(0, 6).map((r) => r.avg)));
  }

  return c.out;
}

// ------------------------------------------------------------------ runner

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const scenario = process.argv[2];
  try {
    const booted = await boot(scenario);
    const results = await check(scenario, booted);
    emit({ scenario, results }, results.every((r) => r.pass) ? 0 : 1);
  } catch (err) {
    emit({
      scenario,
      results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }],
    }, 1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const args = cfg.stub ? ['--import', './taken-register.mjs', self, scenario] : [self, scenario];
  const res = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: path.dirname(self),
    env: { ...process.env, ...(cfg.env || {}) },
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    console.log(`FAIL ${scenario} — no result\n  stdout: ${res.stdout}\n  stderr: ${(res.stderr || '').slice(0, 1800)}`);
    failed++;
    continue;
  }
  const { results } = JSON.parse(line.slice(2));
  const bad = results.filter((r) => !r.pass);
  total += results.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${scenario}  ${cfg.label}  (${results.length - bad.length}/${results.length})`);
  for (const r of bad) console.log(`   x ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  failed += bad.length;
}

console.log(failed ? `\n${failed} of ${total} assertions failed` : `\nAll ${total} assertions passed`);
process.exit(failed ? 1 : 0);
