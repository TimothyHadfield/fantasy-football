// The Players page while a week is IN PROGRESS and some NFL games are over.
//
//   node done-check.mjs
//
// Tim, 2026-10-04: "for singular player's that have finished their game, their
// numbers are individually updated on all accounts in the player section".
// js/season.js marks such a man `done: true`, moves his projection to `pregame`
// and overwrites `projected` with what he scored (the contract is written out
// in taken-stub-season.mjs, which is the fixture: TAKEN_DONE_WEEK=4). This suite
// boots the real waivers.html + js/waivers-page.js against it and checks, in
// BOTH tables:
//
//   1  a finished man's cell is his score drawn as a FACT — no scale, no green,
//      no shade, no OUT, and a 0 he scored is "0.0" and not "Bye"
//   2  his Actual row carries the score under that week; an unfinished man's
//      stays empty there
//   3  Avg (and so the ranks and "your worst") is built on the score
//   4  the week's colour scale is built from the men still to play, only
//   5  `pregame` survives into the cell's title
//   7  with nobody finished the page is byte-for-byte what it is without the
//      contract's fields at all
//
// Each scenario is its own child process: js/waivers-page.js self-boots on import.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { settleWaiverPage } from './settle.mjs';
import { emit } from './emit.mjs';

const LIVE = { prefs: { 'waivers.source': 'live' }, conn: { leagueId: '99', season: 2026, teamId: 1 } };
const SCENARIOS = {
  plain: {
    label: 'week 4 in progress, the data layer says nothing about finished games',
    env: { WV_PAST: '1', TAKEN_PARTIAL_WEEK: '4' }, ...LIVE,
  },
  nobody: {
    label: 'the contract’s fields are there and nobody has finished',
    env: { WV_PAST: '1', TAKEN_PARTIAL_WEEK: '4', TAKEN_DONE_WEEK: '4', TAKEN_DONE_NONE: '1' }, ...LIVE,
  },
  done: {
    label: 'ten men have finished their week-4 game',
    env: { WV_PAST: '1', TAKEN_PARTIAL_WEEK: '4', TAKEN_DONE_WEEK: '4' }, ...LIVE,
  },
};

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
      href: 'http://localhost/waivers.html', origin: 'http://localhost',
      protocol: 'http:', pathname: '/waivers.html', search: '', hash: '',
    };
  }
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  const store = new Map();
  store.set('ff.prefs', JSON.stringify(cfg.prefs));
  store.set('ff.connection', JSON.stringify(cfg.conn));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  const fetch = async (url) => { throw new Error(`unexpected network call: ${url}`); };

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
  const first = await settleWaiverPage(document);
  console.error = origError;
  return { document, window, errors, rejections, first };
}

const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
/** A cell's classes with the two column-line classes (not about the man) taken off. */
const cues = (td) => (td.getAttribute('class') || '').split(/\s+/)
  .filter((c) => c && c !== 'fut-start' && c !== 'po-start').sort().join(' ');
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

/** A table as { col(week), row(id), act(id) } off the DOM as drawn right now. */
function reader(document, tableId, lead) {
  const table = document.getElementById(tableId);
  const heads = () => [...table.querySelectorAll('thead th')].map((th) => txt(th).replace(/\D.*$/, '') || txt(th));
  const col = (week) => heads().indexOf(String(week));
  const row = (id) => table.querySelector(`tbody tr[data-player="${id}"]:not(.mine)`);
  return {
    table,
    col,
    row,
    cell: (id, week) => { const tr = row(id); return tr ? tr.children[col(week)] : null; },
    avg: (id) => { const tr = row(id); return tr ? tr.querySelector('td.avg') : null; },
    actRow: (id) => table.querySelector(`tbody tr[data-actual-for="${id}"]`),
    // The Actual row swaps the `lead` + 1 identity columns for two cells.
    actCell: (id, week) => {
      const tr = table.querySelector(`tbody tr[data-actual-for="${id}"]`);
      return tr ? tr.children[col(week) - lead + 1] : null;
    },
    column: (week) => [...table.querySelectorAll('tbody tr[data-player]')]
      .map((tr) => ({ tr, td: tr.children[col(week)] })),
  };
}

async function check(scenario, { document, window, errors, rejections, first }) {
  const out = [];
  const ok = (name, cond, detail = '') =>
    out.push({ name, pass: Boolean(cond), detail: cond ? '' : String(detail).slice(0, 400) });

  ok('the page finished loading', first.ok, first.why);
  const taken = reader(document, 'takenTable', 4);
  const wire = reader(document, 'waiverTable', 4);
  const marked = () => document.querySelectorAll('tbody td[data-done]').length;
  const extra = {};

  ok('week 4 is the first column right of the thick line, in both tables',
    [taken, wire].every((t) => {
      const th = t.table.querySelectorAll('thead th')[t.col(4)];
      return th && th.classList.contains('fut-start');
    }));

  if (scenario !== 'done') {
    // 7 · NOTHING FINISHED: the parent compares these two scenarios' tables
    // byte for byte, so here it is only that no cell claims to be final.
    ok('7 · no cell is drawn as a final score', marked() === 0, `${marked()} marked`);
    ok('7 · and no cell says Final',
      ![...document.querySelectorAll('tbody td')].some((td) => /^Final:/.test(td.getAttribute('title') || '')));
    ok('7 · the explanation says nothing about finished games',
      !/game is over/.test(txt(document.getElementById('waiverNote')) + txt(document.getElementById('takenNote'))));
    extra.hash = sha(['waiverTable', 'takenTable', 'waiverNote', 'takenNote', 'waiverHeatBands', 'takenHeatBands']
      .map((id) => document.getElementById(id).innerHTML).join('\u0000'));
    extra.rows = document.querySelectorAll('tbody tr[data-player]').length;
  } else {
    const heat = await import(pathToFileURL(path.join(REPO, 'js/heat.js')).href);
    const title = (td) => (td ? td.getAttribute('title') || '' : '');
    const plain = (td) => td && cues(td) === '' && !/[▲▼]/.test(txt(td)) && !td.querySelector('.zmark');

    // ---- 1 + 5 · the Taken table: the score, plain, with the projection in words
    const ross = taken.cell(7101, 4);
    ok('1 · Taken: a finished man’s week shows what he scored', txt(ross) === '30.5', txt(ross));
    ok('1 · Taken: drawn plain — no scale class, no ▲▼, no tag', plain(ross), `class="${ross && cues(ross)}" ${txt(ross)}`);
    ok('1+5 · Taken: its title is the fact, with the projection it replaced',
      title(ross) === 'Final: scored 30.5 (projected 22.0)', title(ross));
    const crowe = taken.cell(7301, 4);
    ok('1 · Taken: the same for a man who fell far short',
      txt(crowe) === '3.0' && plain(crowe) && title(crowe) === 'Final: scored 3.0 (projected 19.0)',
      `${txt(crowe)} class="${crowe && cues(crowe)}" ${title(crowe)}`);
    const lund = taken.cell(7108, 4);
    ok('1+5 · Taken: no projection to quote → the title quotes none',
      txt(lund) === '6.5' && title(lund) === 'Final: scored 6.5', `${txt(lund)} | ${title(lund)}`);
    const ellery = taken.cell(7104, 4);
    ok('1 · Taken: a man who played and scored nothing reads 0.0, never Bye',
      txt(ellery) === '0.0' && !ellery.classList.contains('bye') && plain(ellery),
      `${txt(ellery)} class="${ellery && cues(ellery)}"`);
    ok('1+3 · Taken: and his title says the zero is a final score left out of Avg',
      /^Final: scored 0\.0 \(projected 15\.0\)/.test(title(ellery)) && /Avg/.test(title(ellery)), title(ellery));
    const pace = taken.cell(7110, 4);
    ok('1 · Taken: a real bye is still Bye', txt(pace) === 'Bye' && pace.classList.contains('bye'), txt(pace));
    ok('1 · every finished score is marked, in both tables: 5 taken + 2 of your own rows + 4 wire',
      marked() === 11, `${marked()} marked`);
    ok('1 · nobody still to play is marked final',
      !taken.cell(7102, 4).hasAttribute('data-done') && !taken.cell(7101, 5).hasAttribute('data-done') &&
      !wire.cell(5007, 4).hasAttribute('data-done'));

    // ---- 4 · the week's scale is the men STILL TO PLAY, measured against each other
    // QBs in week 4: Calder 16, Dunlow 10, Sharp 20, Teague 12 are to come;
    // Ross (30.5) and Crowe (3.0) are over and must not stretch the scale.
    const scale = heat.heatScale([16, 10, 20, 12]);
    const withDone = heat.heatScale([30.5, 16, 10, 20, 12, 3.0]);
    const wantCls = (v, s) => (heat.heatOf(v, s) || { cls: '' }).cls.split(/\s+/).sort().join(' ');
    const toCome = [[7102, 16], [7103, 10], [7201, 20], [7202, 12]];
    ok('4 · the fixture can tell the two scales apart',
      toCome.some(([, v]) => wantCls(v, scale) !== wantCls(v, withDone)),
      toCome.map(([, v]) => `${v}: ${wantCls(v, scale)} / ${wantCls(v, withDone)}`).join(' · '));
    const off = toCome.filter(([id, v]) => cues(taken.cell(id, 4)) !== wantCls(v, scale));
    ok('4 · Taken: week 4’s colour is built from the men still to play, only',
      off.length === 0,
      off.map(([id, v]) => `${id} ${v}: drawn "${cues(taken.cell(id, 4))}" want "${wantCls(v, scale)}"`).join(' · '));
    ok('4 · Taken: week 5, where nobody has played, is coloured as it always was',
      cues(taken.cell(7101, 5)) === wantCls(22, heat.heatScale([22, 16, 10, 20, 12, 19])),
      cues(taken.cell(7101, 5)));

    // ---- 3 · Avg is built on the score (weeks 4–6 on screen)
    const avgOf = (t, id) => txt(t.avg(id)).replace(/[▲▼\s]/g, '');
    ok('3 · Taken: Avg counts the score — Ross (30.5 + 22 + 22) / 3 = 24.8', avgOf(taken, 7101) === '24.8', avgOf(taken, 7101));
    ok('3 · Taken: Gable (2.0 + 9 + 9) / 3 = 6.7', avgOf(taken, 7105) === '6.7', avgOf(taken, 7105));
    ok('3 · Taken: a scored zero is left out, as a projected zero is (D7, as on Trade): Ellery 15.0',
      avgOf(taken, 7104) === '15.0', avgOf(taken, 7104));
    ok('3 · Taken: the rank follows — Ross is still Ridgeway’s QB1',
      /QB\s*1$/.test(txt(taken.row(7101).children[1])), txt(taken.row(7101).children[1]));
    const mineRb = wire.table.querySelector('tbody tr.mine[data-player="7105"]');
    ok('3 · your worst RB is chosen on the score: Gable (6.7), and his week is final too',
      mineRb && txt(mineRb.children[wire.col(4)]) === '2.0' && mineRb.children[wire.col(4)].hasAttribute('data-done'),
      mineRb ? txt(mineRb.children[wire.col(4)]) : 'no Your RB row for 7105');

    // ---- 1 · the wire: neither green on a score, and nothing shaded against one
    const qb = wire.cell(5006, 4);
    ok('1 · Wire: a finished QB over 17 shows the score and is NOT green',
      txt(qb) === '25.0' && plain(qb) && /^Final: scored 25\.0 \(projected \d+\.\d\)$/.test(title(qb)),
      `${txt(qb)} class="${qb && cues(qb)}" ${title(qb)}`);
    const wr = wire.cell(5023, 4);
    ok('1 · Wire: nor a finished WR over 12', txt(wr) === '14.0' && plain(wr), `${txt(wr)} class="${wr && cues(wr)}"`);
    const zero = wire.cell(5011, 4);
    ok('1 · Wire: a scored zero reads 0.0, never Bye',
      txt(zero) === '0.0' && !zero.classList.contains('bye') && plain(zero), `${txt(zero)} class="${zero && cues(zero)}"`);
    const posOf = (tr) => txt(tr.children[1]);
    const shaded = (week, pos) => wire.column(week)
      .filter(({ tr, td }) => !tr.classList.contains('mine') && posOf(tr) === pos && td.classList.contains('beats')).length;
    ok('1 · Wire: no RB is shaded as beating your RB in week 4 — his game is over',
      shaded(4, 'RB') === 0, `${shaded(4, 'RB')} shaded`);
    ok('1 · Wire: week 5 still shades them against him', shaded(5, 'RB') > 0, `${shaded(5, 'RB')}`);
    ok('1 · Wire: and a QB still to play is still shaded against your QB still to play',
      shaded(4, 'QB') > 0, `${shaded(4, 'QB')}`);
    ok('1 · Wire: a man still to play keeps his green',
      wire.column(4).some(({ tr, td }) => !tr.classList.contains('mine') && td.classList.contains('hot')));

    // ---- 6 · the one sentence, behind the toggle only
    for (const id of ['waiverNote', 'takenNote']) {
      const el = document.getElementById(id);
      ok(`6 · #${id} says a finished game shows the score — inside the closed toggle`,
        /game is over/.test(txt(el)) && el.closest('details.explain') && !el.closest('details').hasAttribute('open'),
        txt(el).slice(-200));
    }

    // ---- 2 · the Actual row
    const click = (a) => {
      const ev = new window.Event('click', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'button', { value: 0 });
      a.dispatchEvent(ev);
    };
    const open = async (t, id) => {
      // A jump narrows that table to the man's position; widen both again so
      // the next man is on screen to be clicked.
      for (const f of ['posFilter', 'takenPosFilter']) click(document.querySelector(`#${f} button[data-pos="ALL"]`));
      click(t.row(id).querySelector('a.pref'));
      return settleWaiverPage(document);
    };
    const width = (tr) => [...tr.children].reduce((n, td) => n + Number(td.getAttribute('colspan') || 1), 0);

    let s = await open(taken, 7101);
    ok('2 · Taken: opening Ross settles', s.ok, s.why);
    ok('2 · Taken: his Actual row carries the score under week 4',
      txt(taken.actCell(7101, 4)) === '30.5', txt(taken.actCell(7101, 4)));
    ok('2 · Taken: and nothing under week 5, still to come', txt(taken.actCell(7101, 5)) === '', txt(taken.actCell(7101, 5)));
    ok('2 · Taken: the played weeks beside it are untouched (week 3: 30.0)',
      txt(taken.actCell(7101, 3)) === '30.0', txt(taken.actCell(7101, 3)));
    ok('2 · Taken: the Actual row is exactly as wide as the row above it',
      width(taken.actRow(7101)) === width(taken.row(7101)), `${width(taken.actRow(7101))} vs ${width(taken.row(7101))}`);
    ok('3 · the glance line’s Proj is the score once the game is over',
      /Proj\s*30\.5/.test(txt(taken.actRow(7101))), txt(taken.actRow(7101)).slice(0, 80));

    s = await open(taken, 7102);
    ok('2 · Taken: a man still to play has an empty week-4 cell in his Actual row',
      s.ok && taken.actRow(7102) && txt(taken.actCell(7102, 4)) === '', taken.actRow(7102) ? txt(taken.actCell(7102, 4)) : 'no row');
    s = await open(taken, 7110);
    ok('2 · Taken: a bye puts no score in the Actual row',
      s.ok && taken.actRow(7110) && txt(taken.actCell(7110, 4)) === '', taken.actRow(7110) ? txt(taken.actCell(7110, 4)) : 'no row');
    s = await open(taken, 7104);
    ok('2 · Taken: a scored zero is a score: 0.0',
      s.ok && taken.actRow(7104) && txt(taken.actCell(7104, 4)) === '0.0', taken.actRow(7104) ? txt(taken.actCell(7104, 4)) : 'no row');

    s = await open(wire, 5006);
    ok('2 · Wire: a finished free agent’s Actual row carries the score under week 4',
      s.ok && wire.actRow(5006) && txt(wire.actCell(5006, 4)) === '25.0', wire.actRow(5006) ? txt(wire.actCell(5006, 4)) : 'no row');
    ok('2 · Wire: the Actual row is exactly as wide as the row above it',
      wire.actRow(5006) && width(wire.actRow(5006)) === width(wire.row(5006)));
    s = await open(wire, 5007);
    ok('2 · Wire: an unfinished free agent’s is empty there',
      s.ok && wire.actRow(5007) && txt(wire.actCell(5007, 4)) === '', wire.actRow(5007) ? txt(wire.actCell(5007, 4)) : 'no row');
  }

  ok('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('no unhandled rejections', rejections.length === 0, rejections.slice(0, 2).join(' | '));
  return { results: out, extra };
}

// ------------------------------------------------------------------ runner

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const scenario = process.argv[2];
  try {
    const { results, extra } = await check(scenario, await boot(scenario));
    emit({ scenario, results, extra }, results.every((r) => r.pass) ? 0 : 1);
  } catch (err) {
    emit({ scenario, results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }], extra: {} }, 1);
  }
}

let failed = 0;
let total = 0;
const extras = {};
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const res = spawnSync(process.execPath, ['--import', './taken-register.mjs', self, scenario], {
    encoding: 'utf8',
    cwd: path.dirname(self),
    env: { ...process.env, ...cfg.env },
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    console.log(`FAIL ${scenario} — no result\n  stdout: ${res.stdout}\n  stderr: ${(res.stderr || '').slice(0, 1800)}`);
    failed++;
    continue;
  }
  const { results, extra } = JSON.parse(line.slice(2));
  extras[scenario] = extra || {};
  const bad = results.filter((r) => !r.pass);
  total += results.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${scenario}  ${cfg.label}  (${results.length - bad.length}/${results.length})`);
  for (const r of bad) console.log(`   x ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  failed += bad.length;
}

// 7 · THE CONTRACT'S FIELDS ALONE CHANGE NOTHING: both tables, both notes and
// both threshold strips, byte for byte, with `done: false` on every man and
// with no such field at all.
total++;
const same = extras.plain && extras.nobody && extras.plain.hash && extras.plain.hash === extras.nobody.hash &&
  extras.plain.rows > 80;
console.log(`${same ? 'PASS' : 'FAIL'} 7 · nobody finished = no contract at all, byte for byte ` +
  `(${extras.plain?.hash} vs ${extras.nobody?.hash}, ${extras.plain?.rows} rows)`);
if (!same) failed++;

console.log(failed ? `\n${failed} of ${total} assertions failed` : `\nAll ${total} assertions passed`);
process.exit(failed ? 1 : 0);
