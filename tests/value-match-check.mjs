// ONE MAN, ONE VALUE — across the Players page, the Trade page and his card.
//
//   node value-match-check.mjs
//
// Tim, 2026-10-19: "I'm seeing players in the player section display a
// different value than the same players in the trade section. Why is that?"
//
// Measured on league 1241838 the same day, every page on Value: Jonathan
// Taylor read 5.6 on Players, 8.5 on Trade and 8.6 on his card. Three
// arithmetics for one word:
//   Players  the mean of his WEEKLY Values over the span shown (Next 3 by
//            default), zero weeks left out;
//   Trade    `valueOf` of his mean over the page's priced span (the week under
//            way and his zero weeks out, the playoff weeks only on one goal);
//   card     js/value.js `playerValue`: `valueOf` his `restAvg` over every
//            week left (js/season.js `fetchPlayerValues`).
// Now both pages print the card's figure. This suite holds that, on the real
// pages with the real js/season.js, over the sample league (demo data: every
// page draws the same squads, so an id on one page is the same man on another
// — the same reason link-check.mjs runs on it).
//
// Each page boots in its own child process (a page module self-boots on import,
// once per process). Claims:
//   1. Players, Taken table, on Value: each man's Value column = his card's;
//   2. Trade, both custom lists, on Value: each man's figure = his card's;
//   3. so every man on both pages prints the same Value on both;
//   4. a card opened on Trade leads with that same Value;
//   5. the card's Value is js/value.js `playerValue` over the weeks left.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { emit } from './emit.mjs';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
/** The number a cell prints, without its heat mark: "13.0", "—". */
const printed = (el) => (text(el).match(/^(?:[+−-]?\d+(?:\.\d+)?|—)/) || [''])[0];

async function boot(page, prefs) {
  const html = readFileSync(path.join(REPO, page), 'utf8');
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
      const rows = [];
      const head = kids(this, 'THEAD')[0];
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

  window.location = {
    href: `http://localhost/${page}`, origin: 'http://localhost',
    protocol: 'http:', pathname: `/${page}`, search: '', hash: '',
  };
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  const store = new Map([['ff.prefs', JSON.stringify(prefs)]]);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  const fetchCalls = [];
  Object.assign(globalThis, {
    window, document, localStorage,
    fetch: async (u) => { fetchCalls.push(String(u)); throw new Error(`unexpected network call: ${u}`); },
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: (q) => ({
      matches: /min-width/.test(String(q)), media: String(q),
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    }),
  });
  window.localStorage = localStorage;
  window.matchMedia = globalThis.matchMedia;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  for (const m of [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((x) => x[1])) {
    await import(pathToFileURL(path.join(REPO, m)).href);
  }
  await pause(700);
  if (page === 'trade.html') {
    for (let i = 0; i < 1800 && !document.querySelector('#tradeTable[data-ranked]'); i++) await pause(100);
  }
  // The Values arrive after the first paint (js/season.js, then a repaint).
  await pause(800);
  console.error = origError;
  return { document, window, errors, fetchCalls };
}

/** The card's Value for every man: what each page hands the card (`setValueSource`). */
async function cardValues() {
  const season = await import(pathToFileURL(path.join(REPO, 'js/season.js')).href);
  const got = await season.fetchPlayerValues({ demo: true });
  const out = {};
  for (const [id, m] of got.byId) out[id] = { value: m.value, position: m.position, avg: m.avg };
  return { weeks: got.weeks, base: got.base, men: out };
}

async function players() {
  const { document, errors, fetchCalls } = await boot('waivers.html', { 'waivers.show': 'value' });
  const table = document.getElementById('takenTable');
  const heads = [...table.querySelectorAll('thead th')].map(text);
  const col = heads.findIndex((h) => h === 'Value' || h === 'Avg');
  const rows = {};
  for (const tr of table.querySelectorAll('tbody tr[data-player]')) {
    rows[tr.getAttribute('data-player')] = { name: text(tr.querySelector('a.pref')), shown: printed(tr.children[col]) };
  }
  const on = [...document.querySelectorAll('#takenShowToggle button.on')].map((b) => b.getAttribute('data-show'));
  return { heads, head: heads[col], on, rows, card: await cardValues(), errors, fetchCalls };
}

async function trade() {
  const { document, window, errors, fetchCalls } = await boot('trade.html', { 'trade.valueView': 'value', 'trade.source': 'demo' });
  const $ = (id) => document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const rows = {};
  const read = () => {
    for (const id of ['cuListA', 'cuListB']) {
      for (const m of $(id).querySelectorAll('.cu-man[data-man]')) {
        rows[m.getAttribute('data-man')] = { name: text(m.querySelector('.nm')), shown: printed(m.querySelector('.pv')) };
      }
    }
  };
  read();
  // Every other squad in turn on the right, so most of the league is read.
  const pick = $('cuTeamB');
  const teams = pick ? [...pick.querySelectorAll('option')].map((o) => o.getAttribute('value')) : [];
  for (const t of teams) {
    pick.value = t;
    fire(pick, 'change');
    await pause(150);
    read();
  }
  // A card, opened on the first man of your list: its glance line.
  const pv = $('cuListA').querySelector('.cu-man[data-man] .pv');
  let cardSays = null;
  let cardMan = null;
  if (pv) {
    cardMan = pv.closest('.cu-man').getAttribute('data-man');
    pv.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
    const tip = $('tipCard');
    cardSays = tip ? text(tip.querySelector('.tc-glance')) : null;
    pv.dispatchEvent(new window.Event('mouseout', { bubbles: true }));
  }
  const on = [...document.querySelectorAll('#cuValueView button.on')].map((b) => b.getAttribute('data-value-view'));
  return { on, rows, teams: teams.length, cardMan, cardSays, card: await cardValues(), errors, fetchCalls };
}

// ------------------------------------------------------------------- child

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  try {
    emit(process.argv[2] === 'players' ? await players() : await trade(), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

// ------------------------------------------------------------------- parent

function run(mode) {
  const res = spawnSync(process.execPath, [self, mode], { encoding: 'utf8', cwd: path.dirname(self), maxBuffer: 64 * 1024 * 1024 });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`no result for ${mode} - exit ${res.status}\n${String(res.stderr).slice(-1500)}`);
  return JSON.parse(line.slice(2));
}

if (!process.argv[2]) {
  let pass = 0;
  const fails = [];
  const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`);
  };
  const want = (card, id) => {
    const m = card.men[id] ?? card.men[Number(id)];
    return m && typeof m.value === 'number' ? m.value.toFixed(1) : '—';
  };

  const P = run('players');
  const T = run('trade');
  for (const [label, got] of [['Players', P], ['Trade', T]]) {
    ok(`${label}: boots clean`, !got.boot && got.errors.length === 0, got.boot || got.errors.slice(0, 2).join(' | '));
    if (got.boot) continue;
    ok(`${label}: no network call`, got.fetchCalls.length === 0, got.fetchCalls.slice(0, 2).join(' | '));
    ok(`${label}: opened on Value`, got.on.length >= 1 && got.on.every((v) => v === 'value'), JSON.stringify(got.on));
  }

  if (!P.boot && !T.boot) {
    const card = P.card;
    // 5. The card's Value is the one function over the weeks left.
    const { playerValue, restAvg } = await import(pathToFileURL(path.join(REPO, 'js/value.js')).href);
    ok('the card: there are lines and weeks left', card.base && card.weeks.length >= 1, JSON.stringify(card.weeks));
    ok('the card: the same on both pages (one js/season.js answer)', JSON.stringify(card) === JSON.stringify(T.card));
    if (typeof playerValue === 'function') {
      ok('the card: js/value.js has the one Value function (playerValue)', true);
      const byAvg = Object.entries(card.men).filter(([, m]) => typeof m.avg === 'number' &&
        m.value !== playerValue(card.base, m.position, Object.fromEntries(card.weeks.map((w) => [w, m.avg])), card.weeks));
      ok('the card: each Value is playerValue of his average over the weeks left', byAvg.length === 0,
        JSON.stringify(byAvg.slice(0, 3)));
      ok('the card: and that average is restAvg (sanity)', restAvg({ 1: 4, 2: 0, 3: 8 }, [1, 2, 3], 2) === 6);
    } else {
      ok('the card: js/value.js has the one Value function (playerValue)', false, 'no playerValue export');
    }

    // 1. Players.
    ok('Players: the Value column says so', P.head === 'Value', P.head);
    const pIds = Object.keys(P.rows);
    const pBad = pIds.filter((id) => P.rows[id].shown !== want(card, id))
      .map((id) => `${P.rows[id].name} ${P.rows[id].shown} (card ${want(card, id)})`);
    ok('Players: every rostered man’s Value column is his card’s Value', pIds.length >= 60 && pBad.length === 0,
      `${pIds.length} men; ${pBad.length} differ: ${pBad.slice(0, 6).join(', ')}`);

    // 2. Trade.
    const tIds = Object.keys(T.rows);
    const tBad = tIds.filter((id) => T.rows[id].shown !== want(card, id))
      .map((id) => `${T.rows[id].name} ${T.rows[id].shown} (card ${want(card, id)})`);
    ok('Trade: every man’s figure in the custom lists is his card’s Value', tIds.length >= 60 && tBad.length === 0,
      `${tIds.length} men over ${T.teams} squads; ${tBad.length} differ: ${tBad.slice(0, 6).join(', ')}`);

    // 3. The two pages, man for man.
    const both = tIds.filter((id) => P.rows[id]);
    const xBad = both.filter((id) => P.rows[id].shown !== T.rows[id].shown)
      .map((id) => `${T.rows[id].name} Players ${P.rows[id].shown} / Trade ${T.rows[id].shown}`);
    ok('Players and Trade: the same man prints the same Value on both', both.length >= 60 && xBad.length === 0,
      `${both.length} men on both; ${xBad.length} differ: ${xBad.slice(0, 6).join(', ')}`);
    ok('and some of them are worth something (not a page of zeros)', both.filter((id) => Number(T.rows[id].shown) > 0).length >= 10,
      both.filter((id) => Number(T.rows[id].shown) > 0).length);

    // 4. The card opened on Trade.
    ok('a card opened on Trade leads with that same Value',
      T.cardMan && (T.cardSays || '').startsWith(`Value ${want(card, T.cardMan)}`) &&
      (T.rows[T.cardMan] || {}).shown === want(card, T.cardMan),
      `${T.cardMan}: ${T.cardSays} / row ${(T.rows[T.cardMan] || {}).shown}`);
  }

  console.log(`value-match-check: ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(fails.length ? 1 : 0);
}
