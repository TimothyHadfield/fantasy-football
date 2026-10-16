// THE PLAYERS PAGE: "Show my players", the diamond / coin by a name, and the
// filter between them. End to end against the real waivers.html +
// js/waivers-page.js.
//
//   node wv-marks-check.mjs
//
// Tim, 2026-10-14:
//   "make a "show my players" switch on the players section that is default
//    on, but you can turn it off to remove the who to start graph and any of
//    your players in the list of regular players in the available players
//    list."
//   "Addiitonally in the players section show the diamond or coin just like in
//    the trade section by the player's name."
//   "and when you're in the players section allow to sort between coin and
//    diamond players aswell or neither"
// Tim, 2026-10-16:
//   "add a show my players switch in the taken players box that is synced to
//    the available players switch"  (off = your own squad out of Taken too)
//
// The mark is js/outlook-mark.js's rule, the Trade page's: projected 2 or more
// a week above (diamond) or below (coin) his season average. The stub
// (marks-stub-season.mjs) sets every man's average by his id, so which mark a
// row must carry is known here without the page: id % 3 = 0 diamond, 1 coin,
// 2 neither. "sort between" is read as a FILTER: All / Diamonds / Coins /
// Neither, one setting for both tables, remembered.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { emit } from './emit.mjs';

const ME = 4;
const CONN = { leagueId: '99', season: 2026, teamId: ME };
const LIVE = { 'waivers.source': 'live', 'waivers.span': 'all' };

const SCENARIOS = {
  marks: {
    label: '(a) a diamond or a coin by each name it belongs to, in both tables, and the filter',
    prefs: LIVE, conn: CONN,
  },
  mine: {
    label: '(b) Show my players: on by default; off takes away the box and your rows, on brings them back',
    prefs: { ...LIVE, 'waivers.position': 'WR' }, conn: CONN,
  },
  offSaved: {
    label: '(c) the switch and the filter come back the way they were left',
    prefs: { ...LIVE, 'waivers.position': 'WR', 'waivers.showMine': false, 'waivers.mark': 'coin' }, conn: CONN,
  },
  demo: {
    label: '(d) the sample league: no marks (its men are invented), no filter, the switch still works',
    prefs: { 'waivers.source': 'demo', 'waivers.position': 'RB' }, conn: null,
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
  await new Promise((r) => setTimeout(r, 2500));
  console.error = origError;
  return { document, window, errors, rejections, store, cfg };
}

// ------------------------------------------------------------- assertions

function makeChecker() {
  const out = [];
  return {
    out,
    ok(name, cond, detail = '') {
      out.push({ name, pass: Boolean(cond), detail: cond ? '' : String(detail).slice(0, 500) });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cls = (el) => (el ? el.getAttribute('class') || '' : '');
const isHidden = (el) => !el || el.hasAttribute('hidden');

/** Every row of a table that is a man (not his Actual line, not an empty note). */
function rowsOf(d, id) {
  const t = d.getElementById(id);
  return t ? [...t.querySelectorAll('tbody tr[data-player]')] : [];
}

/** What a row carries by his name: 'diamond', 'coin' or null. */
function markOf(tr) {
  const name = tr.querySelector('td.name');
  if (!name) return 'no name cell';
  const marks = [...name.querySelectorAll('span.outlook')];
  if (marks.length > 1) return 'two marks';
  if (!marks.length) return null;
  return /\boutlook-diamond\b/.test(cls(marks[0])) ? 'diamond' : /\boutlook-coin\b/.test(cls(marks[0])) ? 'coin' : 'odd';
}

const kindFor = (id) => ({ 0: 'diamond', 1: 'coin', 2: null })[Number(id) % 3];

function snap(d) {
  const wire = rowsOf(d, 'waiverTable');
  const taken = rowsOf(d, 'takenTable');
  const sw = d.getElementById('showMine');
  return {
    wire: wire.map((tr) => ({ id: tr.getAttribute('data-player'), mine: /\bmine\b/.test(cls(tr)), mark: markOf(tr) })),
    taken: taken.map((tr) => ({
      id: tr.getAttribute('data-player'), mark: markOf(tr),
      // The stub's squads hold ids team * 100 + i, so your men are ME * 100 + i.
      mine: Math.floor(Number(tr.getAttribute('data-player')) / 100) === ME,
      owner: tr.querySelector('td.owner')?.textContent.trim() || '',
    })),
    takenSwitchExists: Boolean(d.getElementById('takenShowMine')),
    takenSwitchOn: Boolean(d.getElementById('takenShowMine')?.checked),
    takenCount: d.querySelector('#takenStats .stat .v')?.textContent.trim() || '',
    box: !isHidden(d.getElementById('startBox')),
    boxRows: d.querySelectorAll('#startersTable tbody tr').length,
    switchExists: Boolean(sw),
    switchOn: Boolean(sw && sw.checked),
    switchRole: sw ? sw.getAttribute('role') : null,
    switchInLabel: Boolean(sw && sw.closest('label.switch')),
    mineKey: !isHidden(d.querySelector('#waiverLegend .key[data-compare] .mine-tag')?.closest('.key')),
    markCtl: !isHidden(d.getElementById('markCtl')),
    takenMarkCtl: !isHidden(d.getElementById('takenMarkCtl')),
    markOn: d.querySelector('#markFilter button.on')?.getAttribute('data-mark') ?? null,
    takenMarkOn: d.querySelector('#takenMarkFilter button.on')?.getAttribute('data-mark') ?? null,
    outlookKey: !isHidden(d.querySelector('#waiverLegend .key[data-when="span.outlook"]')),
    empty: d.querySelector('#waiverTable tbody tr.empty-row')?.textContent.trim() || '',
  };
}

const prefsOf = (store) => { try { return JSON.parse(store.get('ff.prefs') || '{}'); } catch { return {}; } };

async function click(d, w, sel) {
  const el = d.querySelector(sel);
  if (!el) return false;
  el.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(150);
  return true;
}

async function flip(d, w, on, id = 'showMine') {
  const el = d.getElementById(id);
  if (!el) return false;
  el.checked = on;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(150);
  return true;
}

async function check(scenario, { document: d, window: w, errors, rejections, store }) {
  const c = makeChecker();
  c.ok('no console errors', errors.length === 0, errors.join(' | '));
  c.ok('no unhandled rejections', rejections.length === 0, rejections.join(' | '));
  const s = snap(d);

  c.ok('THE SWITCH EXISTS: a checkbox with role=switch inside a label.switch, as on the Trade page',
    s.switchExists && s.switchRole === 'switch' && s.switchInLabel, JSON.stringify(s));
  const sw = d.getElementById('showMine');
  const label = sw && sw.closest('label.switch');
  c.ok('it says "Show my players"', label && label.textContent.replace(/\s+/g, ' ').trim() === 'Show my players',
    label ? label.textContent : 'none');
  c.ok('it sits at the top of the Available players panel, on its heading line',
    Boolean(sw && sw.closest('.panel-head')), 'not in .panel-head');

  if (scenario === 'marks') {
    c.ok('the list has free agents and your own rows', s.wire.some((r) => !r.mine) && s.wire.some((r) => r.mine),
      JSON.stringify(s.wire.slice(0, 5)));
    const wrong = (rows) => rows.filter((r) => r.mark !== kindFor(r.id));
    c.ok('EVERY AVAILABLE ROW carries exactly the mark his numbers call for (diamond / coin / none)',
      s.wire.length > 0 && wrong(s.wire).length === 0, JSON.stringify(wrong(s.wire).slice(0, 6)));
    c.ok('and that includes all three kinds', ['diamond', 'coin', null].every((k) => s.wire.some((r) => r.mark === k)),
      JSON.stringify(s.wire.map((r) => r.mark)));
    c.ok('your own rows carry theirs too', s.wire.filter((r) => r.mine).every((r) => r.mark === kindFor(r.id)),
      JSON.stringify(s.wire.filter((r) => r.mine)));
    c.ok('EVERY TAKEN ROW carries his', s.taken.length > 0 && wrong(s.taken).length === 0,
      JSON.stringify(wrong(s.taken).slice(0, 6)));
    c.ok('the mark is the Trade page\'s markup (js/outlook-mark.js), with the words for a screen reader',
      Boolean(d.querySelector('#waiverTable td.name span.outlook.outlook-diamond > span[aria-hidden="true"] + span.sr-only')),
      'no outlook span of the shared shape');
    c.ok('the key line for the marks is shown while marks are drawn', s.outlookKey, 'hidden');
    c.ok('THE FILTER is shown on both tables, on All', s.markCtl && s.takenMarkCtl && s.markOn === 'ALL' && s.takenMarkOn === 'ALL',
      JSON.stringify([s.markCtl, s.takenMarkCtl, s.markOn, s.takenMarkOn]));
    const buttons = [...d.querySelectorAll('#markFilter button')].map((b) => b.getAttribute('data-mark'));
    c.ok('its buttons are All, Diamonds, Coins, Neither', buttons.join(',') === 'ALL,diamond,coin,none', buttons.join(','));

    // THE GREEN NAME (Tim, 2026-10-14: "highlight a players name in green if
    // they've already had their bye week just like in the trade section"): the
    // Trade page's pill, `bye-hl bye-past`, on the name, before week 8.
    const past = (tr) => {
      const pill = tr.querySelector('td.name a.pref span.bye-hl.bye-past');
      return Boolean(pill && /\bbye already played, week \d+/.test(pill.querySelector('.sr-only')?.textContent || ''));
    };
    const teamOf = (tr) => {
      const id = Number(tr.getAttribute('data-player'));
      return id >= 5000 ? 1 + ((id - 5000) % 30) : 1;   // see marks-stub-season.mjs
    };
    const wireTr = rowsOf(d, 'waiverTable');
    const takenTr = rowsOf(d, 'takenTable');
    const byeWrong = (trs) => trs.filter((tr) => past(tr) !== (teamOf(tr) === 1 || teamOf(tr) === 2))
      .map((tr) => `${tr.getAttribute('data-player')}:${teamOf(tr)}:${past(tr)}`);
    c.ok('BYE ALREADY PLAYED: every available row whose team\'s bye is behind week 8 has the green name, and no other',
      wireTr.length > 0 && byeWrong(wireTr).length === 0, byeWrong(wireTr).slice(0, 8).join(' '));
    c.ok('that is some rows and not others (team 3, bye week 10, and unknown byes stay plain)',
      wireTr.some(past) && wireTr.some((tr) => !past(tr)) && wireTr.some((tr) => teamOf(tr) === 3 && !past(tr)),
      `${wireTr.filter(past).length} of ${wireTr.length}`);
    c.ok('the taken table and your own rows carry it too',
      takenTr.length > 0 && byeWrong(takenTr).length === 0 &&
      wireTr.filter((tr) => /\bmine\b/.test(cls(tr))).every(past), byeWrong(takenTr).slice(0, 6).join(' '));
    c.ok('the pill is the Trade page\'s class on the name only, and its key shows',
      !d.querySelector('#waiverTable td.bye-past, #waiverTable tr.bye-past') &&
      !isHidden(d.querySelector('#waiverLegend .key[data-when="span.bye-past"]')), 'cell-level class, or key hidden');

    const all = s;
    for (const kind of ['diamond', 'coin', 'none']) {
      await click(d, w, `#markFilter button[data-mark="${kind}"]`);
      const f = snap(d);
      const want = kind === 'none' ? null : kind;
      c.ok(`${kind}: only those rows in the available list, and every one of them`,
        f.wire.length > 0 && f.wire.every((r) => r.mark === want) &&
        f.wire.length === all.wire.filter((r) => r.mark === want).length,
        `${f.wire.length} vs ${all.wire.filter((r) => r.mark === want).length}: ${JSON.stringify(f.wire.slice(0, 4))}`);
      c.ok(`${kind}: the taken table follows the same one setting`,
        f.taken.length > 0 && f.taken.every((r) => r.mark === want) &&
        f.taken.length === all.taken.filter((r) => r.mark === want).length,
        `${f.taken.length} vs ${all.taken.filter((r) => r.mark === want).length}`);
      c.ok(`${kind}: both controls show it, and it is remembered`,
        f.markOn === kind && f.takenMarkOn === kind && prefsOf(store)['waivers.mark'] === kind,
        JSON.stringify([f.markOn, f.takenMarkOn, prefsOf(store)['waivers.mark']]));
    }

    await click(d, w, '#takenMarkFilter button[data-mark="ALL"]');
    const back = snap(d);
    c.ok('All (pressed on the Taken table) brings every row back in both',
      back.wire.length === all.wire.length && back.taken.length === all.taken.length && back.markOn === 'ALL',
      `${back.wire.length}/${all.wire.length} ${back.taken.length}/${all.taken.length}`);
  }

  if (scenario === 'mine') {
    c.ok('DEFAULT ON', s.switchOn, 'off');
    c.ok('on: the Who to start box is shown, with your receivers', s.box && s.boxRows > 0, JSON.stringify([s.box, s.boxRows]));
    c.ok('on: your own row is in the list', s.wire.some((r) => r.mine), JSON.stringify(s.wire.map((r) => r.mine)));
    c.ok('on: its key is in the legend', s.mineKey, 'hidden');
    // Every free agent's row, cell for cell (Gain, the green box, every number).
    const agents = () => rowsOf(d, 'waiverTable').filter((tr) => !/\bmine\b/.test(cls(tr)))
      .map((tr) => tr.outerHTML).sort();
    // The played weeks arrive after the table: wait them out, or a row changes under us.
    for (let t = 0; t < 100 && d.querySelector('#waiverTable td.wait, #waiverTable td .gn-wait'); t++) await sleep(100);
    const agents0 = agents();
    await flip(d, w, false);
    const off = snap(d);
    c.ok('OFF: the Who to start box is gone', !off.box, 'still shown');
    c.ok('OFF: none of your men is in the list', off.wire.length > 0 && !off.wire.some((r) => r.mine) &&
      !d.querySelector('#waiverTable tr.mine'), JSON.stringify(off.wire.filter((r) => r.mine)));
    c.ok('OFF: the free agents are all still there', off.wire.length === s.wire.filter((r) => !r.mine).length,
      `${off.wire.length} vs ${s.wire.filter((r) => !r.mine).length}`);
    c.ok('OFF: the "Your …" key is hidden', !off.mineKey, 'shown');
    c.ok('OFF: remembered', prefsOf(store)['waivers.showMine'] === false, JSON.stringify(prefsOf(store)));
    c.ok('OFF: every free agent\'s row is exactly what it was (the switch hides rows, it changes no number)',
      agents0.length > 0 && agents().join('\n') === agents0.join('\n'), (() => {
        const now = agents();
        const i = now.findIndex((x, k) => x !== agents0[k]);
        if (i < 0) return `${now.length} rows vs ${agents0.length}`;
        let k = 0;
        while (agents0[i][k] === now[i][k]) k++;
        return `${agents0[i].slice(Math.max(0, k - 120), k + 120)} ||| ${now[i].slice(Math.max(0, k - 120), k + 120)}`;
      })());
    await flip(d, w, true);
    const on = snap(d);
    c.ok('ON AGAIN: the box and your row are back, exactly as before',
      on.box && on.boxRows === s.boxRows && on.wire.length === s.wire.length && on.wire.some((r) => r.mine), JSON.stringify(on.wire.length));
    c.ok('ON AGAIN: remembered', prefsOf(store)['waivers.showMine'] === true, JSON.stringify(prefsOf(store)));

    // THE TAKEN BOX'S OWN SWITCH (Tim, 2026-10-16: "add a show my players
    // switch in the taken players box that is synced to the available players
    // switch"). One setting: either switch flips both, and both lists follow.
    const tsw = d.getElementById('takenShowMine');
    const tlabel = tsw && tsw.closest('label.switch');
    c.ok('TAKEN SWITCH: a role=switch checkbox in a label.switch on the Taken box\'s heading line',
      Boolean(tsw && tsw.getAttribute('role') === 'switch' && tlabel && tsw.closest('#takenPanel .panel-head')),
      'missing or not on #takenPanel .panel-head');
    c.ok('TAKEN SWITCH: it says "Show my players", and is on',
      Boolean(tlabel && tlabel.textContent.replace(/\s+/g, ' ').trim() === 'Show my players' && s.takenSwitchOn),
      tlabel ? tlabel.textContent : 'none');
    const theirs = s.taken.filter((r) => !r.mine);
    c.ok('on: the Taken table holds your men and everyone else\'s', s.taken.some((r) => r.mine) && theirs.length > 0,
      `${s.taken.filter((r) => r.mine).length} mine of ${s.taken.length}`);
    const takenOthers = () => rowsOf(d, 'takenTable')
      .filter((tr) => Math.floor(Number(tr.getAttribute('data-player')) / 100) !== ME).map((tr) => tr.outerHTML).sort();
    const others0 = takenOthers();
    await flip(d, w, false, 'takenShowMine');
    const toff = snap(d);
    c.ok('TAKEN OFF: none of your men in the Taken table, everyone else still there',
      toff.taken.length === theirs.length && !toff.taken.some((r) => r.mine),
      `${toff.taken.length} vs ${theirs.length}; mine left: ${toff.taken.filter((r) => r.mine).length}`);
    c.ok('TAKEN OFF: every other row is exactly what it was (no number moves)',
      others0.length > 0 && takenOthers().join('\n') === others0.join('\n'), `${takenOthers().length} vs ${others0.length}`);
    c.ok('TAKEN OFF: the Taken count tile follows the rows', toff.takenCount === String(theirs.length),
      `${toff.takenCount} vs ${theirs.length}`);
    c.ok('TAKEN OFF: the Available switch follows, and so does that list and the box',
      !toff.switchOn && !toff.box && !toff.wire.some((r) => r.mine), JSON.stringify([toff.switchOn, toff.box]));
    c.ok('TAKEN OFF: remembered as the one setting', prefsOf(store)['waivers.showMine'] === false, JSON.stringify(prefsOf(store)));
    await flip(d, w, true, 'showMine');
    const ton = snap(d);
    c.ok('AVAILABLE ON: the Taken switch follows, and your men are back in the Taken table',
      ton.takenSwitchOn && ton.taken.length === s.taken.length && ton.taken.some((r) => r.mine),
      JSON.stringify([ton.takenSwitchOn, ton.taken.length, s.taken.length]));
    await flip(d, w, false, 'showMine');
    const aoff = snap(d);
    c.ok('AVAILABLE OFF: the Taken switch goes off and your men leave the Taken table too',
      !aoff.takenSwitchOn && aoff.taken.length === theirs.length && !aoff.taken.some((r) => r.mine),
      JSON.stringify([aoff.takenSwitchOn, aoff.taken.length]));
    await flip(d, w, true, 'takenShowMine');
    const back2 = snap(d);
    c.ok('TAKEN ON: everything is back as it started',
      back2.switchOn && back2.takenSwitchOn && back2.box && back2.wire.length === s.wire.length &&
      back2.taken.length === s.taken.length, JSON.stringify([back2.switchOn, back2.takenSwitchOn, back2.taken.length]));
  }

  if (scenario === 'offSaved') {
    c.ok('the switch comes back off', s.switchExists && !s.switchOn, 'on');
    c.ok('so no box and no rows of yours', !s.box && !s.wire.some((r) => r.mine), JSON.stringify([s.box, s.wire.length]));
    c.ok('the Taken box\'s switch comes back off too, and none of your men is in that table',
      s.takenSwitchExists && !s.takenSwitchOn && s.taken.length > 0 && !s.taken.some((r) => r.mine),
      JSON.stringify([s.takenSwitchExists, s.takenSwitchOn, s.taken.filter((r) => r.mine).length]));
    c.ok('the filter comes back on Coins, and the list is only coins',
      s.markOn === 'coin' && s.wire.length > 0 && s.wire.every((r) => r.mark === 'coin'),
      JSON.stringify([s.markOn, s.wire.slice(0, 4)]));
  }

  if (scenario === 'demo') {
    c.ok('no mark anywhere: the sample league\'s men are invented',
      !d.querySelector('span.outlook'), 'a mark was drawn');
    c.ok('so no filter either', s.switchExists && !s.markCtl && !s.takenMarkCtl, JSON.stringify([s.markCtl, s.takenMarkCtl]));
    c.ok('the switch is on and the stand-in team\'s box and row are shown', s.switchOn && s.box && s.wire.some((r) => r.mine),
      JSON.stringify([s.switchOn, s.box]));
    await flip(d, w, false);
    const off = snap(d);
    c.ok('off: box and rows gone on the sample league too', !off.box && !off.wire.some((r) => r.mine),
      JSON.stringify([off.box]));
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
    emit({ scenario, results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }] }, 1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const res = spawnSync(
    process.execPath,
    ['--import', './marks-register.mjs', self, scenario],
    { encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, ...(cfg.env || {}) } },
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
