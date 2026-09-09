// The "Your …" comparison rows on the Add players page, end to end against the
// real waivers.html + js/waivers-page.js.
//
//   node cmp-check.mjs
//
// The squad is hand-built in cmp-stub-season.mjs so every answer is known by
// construction, and every "which player is worst" assertion recomputes the
// average here from the stub's raw numbers rather than trusting the page.
//
// Run it with `npm test` from tests/, or on its own with `node cmp-check.mjs`.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';

const CONN = { leagueId: '99', season: 2026, teamId: 4 };
const NO_TEAM = { leagueId: '99', season: 2026 };
const LIVE = { 'waivers.source': 'live' };

const SCENARIOS = {
  mine: {
    label: '(a) your worst man at each position, in the same table',
    prefs: LIVE, conn: CONN,
  },
  widen: {
    label: '(b) widening the span re-picks the worst man',
    prefs: LIVE, conn: CONN,
    after: async ({ document, window }) => {
      const season = await import('./cmp-stub-season.mjs');
      const espn = await import('./wv-stub-espn.mjs');
      const before = {
        rosterFetches: season.calls.rosterWeeks.slice(),
        wireFetches: espn.calls.weeks.slice(),
        rows: mineSnapshot(document),
      };
      document.querySelector('#spanFilter button[data-span="6"]')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
      globalThis.__cmp = {
        before,
        after: mineSnapshot(document),
        rosterFetches: season.calls.rosterWeeks.slice(),
        wireFetches: espn.calls.weeks.slice(),
        cost: document.getElementById('spanCost').textContent.replace(/\s+/g, ' ').trim(),
      };
    },
  },
  filter: {
    label: '(c) the position filter, the counts, and no refetch',
    prefs: LIVE, conn: CONN,
    after: async ({ document, window }) => {
      const season = await import('./cmp-stub-season.mjs');
      const espn = await import('./wv-stub-espn.mjs');
      const click = (sel) =>
        document.querySelector(sel).dispatchEvent(new window.Event('click', { bubbles: true }));
      const count = (pos) =>
        document.querySelector(`#posFilter button[data-pos="${pos}"] .seg-count`).textContent.trim();
      const snap = () => ({
        rows: [...document.querySelectorAll('#waiverTable tbody tr')].map((tr) => ({
          mine: /\bmine\b/.test(tr.getAttribute('class') || ''),
          name: tr.children[0].textContent.replace(/\s+/g, ' ').trim(),
          pos: tr.children[1].textContent.trim(),
        })),
      });

      const out = {
        counts: { ALL: count('ALL'), QB: count('QB'), WR: count('WR'), DST: count('DST') },
        fetchesBefore: {
          roster: season.calls.rosterWeeks.slice(), wire: espn.calls.weeks.slice(),
        },
      };
      click('#posFilter button[data-pos="QB"]');
      out.qb = snap();
      click('#posFilter button[data-pos="DST"]');
      out.dst = snap();
      click('#posFilter button[data-pos="ALL"]');
      out.all = snap();
      out.fetchesAfter = {
        roster: season.calls.rosterWeeks.slice(), wire: espn.calls.weeks.slice(),
      };
      globalThis.__cmp = out;
    },
  },
  'no-team': {
    label: '(d) nobody set as you: no rows, and the note says how to turn them on',
    prefs: LIVE, conn: NO_TEAM,
  },
  'roster-refused': {
    label: '(e) ESPN refuses every roster week',
    prefs: LIVE, conn: CONN,
    env: { CMP_FAIL_ROSTER_WEEKS: '4,5,6' },
  },
  'roster-partial': {
    label: '(f) ESPN refuses one roster week',
    prefs: LIVE, conn: CONN,
    env: { CMP_FAIL_ROSTER_WEEKS: '5' },
  },
};

/** The "Your …" rows as {label, name, pos, avg, hot, weekValues}. */
function mineSnapshot(document) {
  return [...document.querySelectorAll('#waiverTable tbody tr.mine')].map((tr) => {
    const cells = [...tr.children];
    return {
      label: (tr.querySelector('.mine-tag') || {}).textContent || '',
      name: cells[0].textContent.replace(/\s+/g, ' ').trim(),
      pos: cells[1].textContent.trim(),
      avg: cells[3].getAttribute('data-v'),
      hot: cells.slice(4).filter((td) => /\bhot\b/.test(td.getAttribute('class') || '')).length,
      week: cells.slice(4).map((td) => td.getAttribute('data-v')),
    };
  });
}

// ------------------------------------------------------------------- child

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  const html = readFileSync(path.join(REPO, 'waivers.html'), 'utf8');
  const { window, document } = parseHTML(html);

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

  if (!window.location) {
    window.location = {
      href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:',
      pathname: '/waivers.html', search: '', hash: '',
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
  window.localStorage = localStorage;
  window.ResizeObserver = globalThis.ResizeObserver;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  const rejections = [];
  process.on('unhandledRejection', (r) => rejections.push(String(r)));

  await import(pathToFileURL(path.join(REPO, 'js/waivers-page.js')).href);
  await new Promise((r) => setTimeout(r, cfg.wait ?? 600));
  if (cfg.after) await cfg.after({ document, window });
  console.error = origError;

  return { document, errors, fetchCalls, rejections, cfg };
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
  const note = txt($('waiverNote'));
  const season = await import('./cmp-stub-season.mjs');
  const espn = await import('./wv-stub-espn.mjs');

  const allRows = [...d.querySelectorAll('#waiverTable tbody tr')];
  const mine = mineSnapshot(d);

  c.ok('no console errors', boot.errors.length === 0, boot.errors.slice(0, 2).join(' | '));
  c.ok('no unhandled rejections', boot.rejections.length === 0, boot.rejections.slice(0, 2).join(' | '));
  c.ok('no unexpected network calls', boot.fetchCalls.length === 0, boot.fetchCalls.slice(0, 2).join(' | '));

  // The worst man at each position, worked out here rather than read off the
  // page, so the page is being checked against arithmetic and not against itself.
  const worstOver = (weeks) => {
    const held = new Map();
    for (const p of season.MINE) {
      if (!held.has(p.position)) held.set(p.position, []);
      held.get(p.position).push({ p, avg: season.expectedAvg(p.playerId, weeks) });
    }
    const out = new Map();
    for (const [pos, group] of held) {
      const rated = group.filter((r) => r.avg !== null);
      if (!rated.length) continue;
      out.set(pos, {
        ...rated.reduce((a, b) => (b.avg < a.avg ? b : a)),
        depth: group.length,
      });
    }
    return out;
  };

  // ---- (a) the rows themselves --------------------------------------------
  if (scenario === 'mine') {
    const want = worstOver([4, 5, 6]);

    c.ok('one comparison row per position held, and no more',
      mine.length === 5, `${mine.length}: ${mine.map((m) => m.label).join(',')}`);
    c.ok('no row for a position he does not roster',
      !mine.some((m) => m.pos === 'DST') && season.MINE.every((p) => p.position !== 'DST'),
      mine.map((m) => m.pos).join(','));
    c.ok('one row per position he DOES roster',
      ['QB', 'RB', 'WR', 'TE', 'K'].every((p) => mine.filter((m) => m.pos === p).length === 1),
      mine.map((m) => `${m.pos}:${m.label}`).join(','));

    // The label's number is his depth there.
    const labels = mine.map((m) => m.label).sort().join(' ');
    c.ok('the label is "Your <pos><depth>"',
      labels === 'Your K2 Your QB3 Your RB4 Your TE2 Your WR5', labels);
    c.ok('the number equals the count he holds at that position',
      mine.every((m) => m.label === `Your ${m.pos}${want.get(m.pos).depth}`),
      mine.map((m) => `${m.label}/${want.get(m.pos).depth}`).join(','));

    // The man named really is his lowest average there.
    const wrongMan = mine.filter((m) => !m.name.includes(want.get(m.pos).p.name));
    c.ok('each row names his lowest-averaging player at that position',
      wrongMan.length === 0,
      wrongMan.map((m) => `${m.label} got ${m.name} want ${want.get(m.pos).p.name}`).join(' | '));

    const wrongAvg = mine.filter((m) => !near(m.avg, want.get(m.pos).avg));
    c.ok('the Avg shown is the mean over the weeks shown, byes counted, blanks left out',
      wrongAvg.length === 0,
      wrongAvg.map((m) => `${m.label} got ${m.avg} want ${want.get(m.pos).avg}`).join(' | '));

    const wr = mine.find((m) => m.pos === 'WR');
    c.ok('a bye on one of your men counts as the zero ESPN returned',
      wr && wr.week[1] === '0' && near(wr.avg, 8 / 3), JSON.stringify(wr));
    const te = mine.find((m) => m.pos === 'TE');
    c.ok('and the better tight end is not punished for a week ESPN had no number for',
      te && te.name.includes('Tobin Nash'), te && te.name);

    // Never green.
    c.ok('not one comparison-row week cell is green',
      mine.every((m) => m.hot === 0), JSON.stringify(mine.map((m) => [m.label, m.hot])));
    const qb = mine.find((m) => m.pos === 'QB');
    c.ok('even though a wire QB on the same numbers would be',
      qb && [...d.querySelectorAll('#waiverTable tbody tr:not(.mine) td.hot')].length > 0,
      'no green anywhere');

    // In the table with everyone else.
    c.ok('the comparison rows live in the same tbody as the wire',
      allRows.length === 65, `${allRows.length}`);
    c.ok('they are marked as not-a-free-agent',
      allRows.filter((r) => /\bmine\b/.test(r.getAttribute('class') || '')).length === 5,
      'no .mine rows');
    c.ok('and carry the label in the identity column',
      [...d.querySelectorAll('#waiverTable tbody tr.mine .mine-tag')].length === 5, 'no labels');

    // Sorting: the default is Avg, best first, and your rows take part in it.
    const avgs = allRows.map((r) => {
      const v = r.children[3].getAttribute('data-v');
      return v === null ? null : Number(v);
    });
    const monotonic = avgs.every((v, i) => i === 0 || v === null || avgs[i - 1] === null || v <= avgs[i - 1]);
    c.ok('the whole table is still ordered by Avg, comparison rows included', monotonic,
      JSON.stringify(avgs.slice(0, 8)));

    const isMine = allRows.map((r) => /\bmine\b/.test(r.getAttribute('class') || ''));
    const interior = isMine
      .map((m, i) => m && isMine.slice(0, i).some((x) => !x) && isMine.slice(i + 1).some((x) => !x))
      .filter(Boolean).length;
    c.ok('they are interleaved with the wire rather than pinned to one end',
      interior >= 3, `${interior} of ${mine.length} sit inside the wire`);

    // The one that matters: your QB has available players on both sides of him,
    // so the sort is answering "who beats the man I would drop" directly.
    const qbIndex = allRows.findIndex((r) => /\bmine\b/.test(r.getAttribute('class') || '') &&
      r.children[1].textContent.trim() === 'QB');
    c.ok('wire players sit both above and below your own QB',
      qbIndex > 0 && isMine.slice(0, qbIndex).some((m) => !m) &&
      isMine.slice(qbIndex + 1).some((m) => !m),
      `your QB is row ${qbIndex + 1} of ${allRows.length}`);

    // The counts stay about players you can add.
    c.ok('the All count is the pool, not the pool plus your rows',
      txt(d.querySelector('#posFilter button[data-pos="ALL"] .seg-count')) === '60',
      txt(d.querySelector('#posFilter button[data-pos="ALL"] .seg-count')));
    c.ok('and the QB count does not include your own QB',
      txt(d.querySelector('#posFilter button[data-pos="QB"] .seg-count')) === '10',
      txt(d.querySelector('#posFilter button[data-pos="QB"] .seg-count')));

    // The doubled cost, said out loud.
    c.ok('each shown week cost a wire request and a roster request',
      JSON.stringify(espn.calls.weeks.slice().sort()) === JSON.stringify([4, 5, 6]) &&
      JSON.stringify(season.calls.rosterWeeks.slice().sort()) === JSON.stringify([4, 5, 6]),
      `${JSON.stringify(espn.calls.weeks)} / ${JSON.stringify(season.calls.rosterWeeks)}`);
    c.ok('the cost line says six requests, not three',
      /3 weeks = 6 requests to ESPN/.test(txt($('spanCost'))), txt($('spanCost')));
    c.ok('and says what the second one is for',
      /the wire and your roster for each one/.test(txt($('spanCost'))), txt($('spanCost')));

    // The note.
    c.ok('the note says what a Your … row is',
      /is one of your own players rather than someone you can add/.test(note), note);
    c.ok('the note says worst means lowest Avg over the weeks currently shown',
      /lowest Avg over the weeks currently shown/.test(note) &&
      /widening the span can change which of your men appears/.test(note), note);
    c.ok('the note says the number is his depth there',
      /The number is your depth there/.test(note) &&
      /QB3 because you hold three quarterbacks/.test(note), note);
    c.ok('the note says they are never green and never counted',
      /never coloured green/.test(note) && /never counted on the position buttons/.test(note), note);
  }

  // ---- (b) widening ---------------------------------------------------------
  if (scenario === 'widen') {
    const w = globalThis.__cmp || {};
    const was = worstOver([4, 5, 6]);
    const now = worstOver([4, 5, 6, 7, 8, 9]);

    const beforeQb = (w.before.rows || []).find((m) => m.pos === 'QB');
    const afterQb = (w.after || []).find((m) => m.pos === 'QB');

    c.ok('the arithmetic really does change hands', was.get('QB').p.name !== now.get('QB').p.name,
      `${was.get('QB').p.name} -> ${now.get('QB').p.name}`);
    c.ok('the narrow span names the man who is worst over three weeks',
      beforeQb && beforeQb.name.includes(was.get('QB').p.name), beforeQb && beforeQb.name);
    c.ok('widening re-picks him for the six weeks now shown',
      afterQb && afterQb.name.includes(now.get('QB').p.name), afterQb && afterQb.name);
    c.ok('the label still states his depth, which the span cannot change',
      beforeQb && afterQb && beforeQb.label === 'Your QB3' && afterQb.label === 'Your QB3',
      `${beforeQb && beforeQb.label} -> ${afterQb && afterQb.label}`);
    c.ok('and the Avg is recomputed over the wider span',
      afterQb && near(afterQb.avg, now.get('QB').avg),
      `${afterQb && afterQb.avg} vs ${now.get('QB').avg}`);
    c.ok('every position still has exactly one row',
      (w.after || []).length === 5, `${(w.after || []).length}`);

    c.ok('widening buys only the roster weeks it does not hold',
      JSON.stringify(w.rosterFetches.slice().sort((a, b) => a - b)) ===
        JSON.stringify([4, 5, 6, 7, 8, 9]), JSON.stringify(w.rosterFetches));
    c.ok('and no week is fetched twice',
      new Set(w.rosterFetches).size === w.rosterFetches.length, JSON.stringify(w.rosterFetches));
    c.ok('the wire is bought the same way',
      JSON.stringify(w.wireFetches.slice().sort((a, b) => a - b)) ===
        JSON.stringify([4, 5, 6, 7, 8, 9]), JSON.stringify(w.wireFetches));
    c.ok('the cost line keeps up', /6 weeks = 12 requests to ESPN/.test(w.cost || ''), w.cost);
  }

  // ---- (c) filtering --------------------------------------------------------
  if (scenario === 'filter') {
    const w = globalThis.__cmp || {};
    c.ok('the counts are available players only',
      w.counts.ALL === '60' && w.counts.QB === '10' && w.counts.WR === '17' && w.counts.DST === '8',
      JSON.stringify(w.counts));

    const qbMine = w.qb.rows.filter((r) => r.mine);
    c.ok('filtering to QB keeps exactly one comparison row',
      qbMine.length === 1 && qbMine[0].name.startsWith('Your QB3'), JSON.stringify(qbMine));
    c.ok('and the ten available quarterbacks with it',
      w.qb.rows.length === 11 && w.qb.rows.every((r) => r.pos === 'QB'), `${w.qb.rows.length}`);

    c.ok('a position he does not roster shows the wire alone',
      w.dst.rows.length === 8 && w.dst.rows.every((r) => !r.mine), `${w.dst.rows.length}`);
    c.ok('clearing the filter brings everything back',
      w.all.rows.length === 65 && w.all.rows.filter((r) => r.mine).length === 5,
      `${w.all.rows.length}`);

    c.ok('switching the position filter refetches no wire week',
      JSON.stringify(w.fetchesBefore.wire) === JSON.stringify(w.fetchesAfter.wire),
      `${JSON.stringify(w.fetchesBefore.wire)} -> ${JSON.stringify(w.fetchesAfter.wire)}`);
    c.ok('and refetches no roster week either',
      JSON.stringify(w.fetchesBefore.roster) === JSON.stringify(w.fetchesAfter.roster),
      `${JSON.stringify(w.fetchesBefore.roster)} -> ${JSON.stringify(w.fetchesAfter.roster)}`);
  }

  // ---- (d) nobody is you ----------------------------------------------------
  if (scenario === 'no-team') {
    c.ok('there are no comparison rows', mine.length === 0, JSON.stringify(mine));
    c.ok('the wire is still there', allRows.length === 60, `${allRows.length}`);
    c.ok('no roster request was spent at all',
      season.calls.rosterWeeks.length === 0, JSON.stringify(season.calls.rosterWeeks));
    c.ok('so the cost line is back to one request a week',
      /3 weeks = 3 requests to ESPN, one per week/.test(txt($('spanCost'))), txt($('spanCost')));
    c.ok('the note says why there are none',
      /Nobody is set as you/.test(note), note);
    c.ok('and names the control that turns them on',
      /“You are” menu in the connection bar/.test(note), note);
    c.ok('and says what turning them on would give you',
      /Your QB3/.test(note) && /worst man there/.test(note), note);
  }

  // ---- (e) every roster week refused ---------------------------------------
  if (scenario === 'roster-refused') {
    c.ok('there are no comparison rows to draw', mine.length === 0, JSON.stringify(mine));
    c.ok('the wire is still shown in full', allRows.length === 60, `${allRows.length}`);
    c.ok('the note says the comparison is missing and why',
      /ESPN refused your rosters for every week shown/.test(note), note);
    c.ok('the note names the weeks', /\(4, 5 and 6\)/.test(note), note);
    c.ok('and says what to do about it', /Reload the page to try again/.test(note), note);
    c.ok('the wire is not blamed for it', !/ESPN did not return week/.test(note), note);
  }

  // ---- (f) one roster week refused -----------------------------------------
  if (scenario === 'roster-partial') {
    const want = worstOver([4, 6]);   // week 5 never arrived
    c.ok('the comparison rows survive a missing week', mine.length === 5, `${mine.length}`);
    c.ok('and average only the weeks that did load',
      mine.every((m) => near(m.avg, want.get(m.pos).avg)),
      mine.map((m) => `${m.label} ${m.avg} vs ${want.get(m.pos).avg}`).join(' | '));
    c.ok('the missing week has no sort key on those rows',
      mine.every((m) => m.week[1] === null), JSON.stringify(mine.map((m) => m.week)));
    c.ok('the note names the week your roster is missing for',
      /ESPN refused your rosters for week 5/.test(note), note);
    c.ok('the wire kept its week 5 numbers',
      [...d.querySelectorAll('#waiverTable tbody tr:not(.mine)')]
        .filter((r) => r.children[5].getAttribute('data-v') !== null).length > 50,
      'week 5 empty on the wire too');
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
    console.log('@@' + JSON.stringify({ scenario, results }));
    process.exit(results.every((r) => r.pass) ? 0 : 1);
  } catch (err) {
    console.log('@@' + JSON.stringify({
      scenario,
      results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }],
    }));
    process.exit(1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const res = spawnSync(
    process.execPath,
    ['--import', './cmp-register.mjs', self, scenario],
    { encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, ...(cfg.env || {}) } }
  );
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
