// The player click-through, ACROSS pages.
//
//   node link-check.mjs
//
// Every other suite tests one page. This one tests the seam between them, which
// is the only place the click-through can actually break: `index.html` and
// `analysis.html` MAKE links, `waivers.html` RESOLVES them, and nothing in a
// single-page suite can notice if the two halves stop agreeing. A renamed query
// parameter, an id taken from the wrong field, a link built from a row index
// instead of ESPN's playerId — each of those passes every per-page suite and
// leaves Tim clicking a name that goes nowhere.
//
// It was written after exactly that risk was run in practice: the two source
// pages and the destination were built by three different authors at the same
// time, against a contract agreed in prose.
//
// THE CONTRACT, in one line:
//
//     <a class="pref" href="waivers.html?player=<espnPlayerId>">…</a>
//
// A real href, never a click handler, so middle-click and open-in-new-tab work.
// The id is ESPN's own and nothing else can identify a player.
//
// Each page boots in its own child process: an ES module initialises once per
// process and every page module self-boots on import, so one process cannot
// render two pages. Demo mode throughout — it needs no network and every page
// draws the same demo squads, which is what makes an id from one page
// meaningful on another.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';

/** The pages that MAKE links, and the id of a panel each must have linked. */
const SOURCES = ['index.html', 'analysis.html', 'trade.html', 'waivers.html'];

// ---------------------------------------------------------------- the harness

async function boot(page, search = '') {
  const html = readFileSync(path.join(REPO, page), 'utf8');
  const { window, document } = parseHTML(html);

  // linkedom defines <select>.value on HTMLSelectElement.prototype and returns
  // undefined; shimming HTMLElement.prototype does nothing (it is shadowed).
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

  // Take the table prototype from an element linkedom actually made, NOT from
  // window.HTMLTableElement — they are not always the same object here.
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

  // js/bridge.js reads window.location.origin on every ping, and `search` is
  // how a ?player= link actually arrives.
  window.location = {
    href: `http://localhost/${page}${search}`, origin: 'http://localhost',
    protocol: 'http:', pathname: `/${page}`, search, hash: '',
  };
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  const store = new Map();
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
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };

  // The page's own declared modules, so a renamed module is caught rather than
  // hard-coded around.
  for (const m of [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((x) => x[1])) {
    await import(pathToFileURL(path.join(REPO, m)).href);
  }
  await new Promise((r) => setTimeout(r, 700));
  console.error = origError;

  return { document, errors, fetchCalls };
}

// ------------------------------------------------------------------- the runs

const HREF = /^waivers\.html\?player=(\d+)$/;

async function collect(page) {
  const { document, errors, fetchCalls } = await boot(page);
  const links = [...document.querySelectorAll('a.pref')].map((a) => ({
    href: a.getAttribute('href') || '',
    title: a.getAttribute('title') || '',
    // Whatever the link says, by whichever attribute says it.
    says: `${a.getAttribute('title') || ''}${a.getAttribute('aria-label') || ''}`,
    text: a.textContent.trim(),
    inButton: Boolean(a.closest('button')),
    hasHref: a.hasAttribute('href'),
  }));
  // Anything that names a player without linking him is not an error here, but
  // a link that is NOT a `.pref` would mean a second, competing contract.
  const strayPlayerLinks = [...document.querySelectorAll('a[href*="player="]')]
    .filter((a) => !a.classList.contains('pref')).length;
  return { page, links, strayPlayerLinks, errors, fetchCalls };
}

async function land(search) {
  const { document, errors, fetchCalls } = await boot('waivers.html', search);
  const spot = [...document.querySelectorAll('tr.spotlight')];
  return {
    search,
    marked: spot.length,
    who: spot.length ? spot[0].querySelector('td.name').textContent.trim() : null,
    player: spot.length ? spot[0].getAttribute('data-player') : null,
    strip: document.getElementById('jumpNote').textContent.replace(/\s+/g, ' ').trim(),
    hidden: /\bhidden\b/.test(document.getElementById('jumpNote').getAttribute('class') || ''),
    errors, fetchCalls,
  };
}

// ------------------------------------------------------------------- child

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const [mode, arg] = [process.argv[2], process.argv[3]];
  try {
    const out = mode === 'collect' ? await collect(arg) : await land(arg);
    console.log('@@' + JSON.stringify(out));
    process.exit(0);
  } catch (err) {
    console.log('@@' + JSON.stringify({ boot: String((err && err.stack) || err) }));
    process.exit(1);
  }
}

// ------------------------------------------------------------------- parent

function run(mode, arg) {
  const res = spawnSync(process.execPath, [self, mode, arg], {
    encoding: 'utf8', cwd: path.dirname(self),
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`no result for ${mode} ${arg}\n${res.stderr}`);
  return JSON.parse(line.slice(2));
}

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
};

// ---- every source page makes links, and they all obey the contract ---------

const made = new Map();
for (const page of SOURCES) {
  const got = run('collect', page);
  ok(`${page} booted clean`, !got.boot, got.boot);
  if (got.boot) continue;

  ok(`${page} has no console errors`, got.errors.length === 0, got.errors.slice(0, 2).join(' | '));
  ok(`${page} made no network call`, got.fetchCalls.length === 0, got.fetchCalls.slice(0, 2).join(' | '));
  ok(`${page} links to players at all`, got.links.length > 0, `${got.links.length} links`);

  const bad = got.links.filter((l) => !HREF.test(l.href));
  ok(`every ${page} link obeys the href contract`, bad.length === 0,
    bad.slice(0, 3).map((l) => l.href).join(' | '));

  // A real anchor, never a handler — that is what makes middle-click work.
  ok(`every ${page} link is a real href`, got.links.every((l) => l.hasHref), 'a .pref with no href');
  // A link inside a button is invalid HTML and swallows the click.
  ok(`no ${page} link is nested in a button`, got.links.every((l) => !l.inButton),
    'a .pref inside a button');
  ok(`no ${page} link points at an undefined player`,
    !got.links.some((l) => /player=(undefined|null|NaN|)$/.test(l.href)),
    got.links.filter((l) => /player=(undefined|null|NaN|)$/.test(l.href)).slice(0, 2).map((l) => l.href).join(' | '));
  ok(`${page} has no competing second contract`, got.strayPlayerLinks === 0,
    `${got.strayPlayerLinks} player links that are not .pref`);
  // A name carries a `title`; an analysis grid NUMBER carries an `aria-label`
  // instead, because that cell draws a tip card of its own and a `title` beside
  // it would have the browser put a second tooltip on top a moment later.
  // Either way the link has to say where it goes.
  ok(`every ${page} link says where it goes`, got.links.every((l) => l.says.length > 0),
    'a .pref that says nothing');
  ok(`no ${page} link is empty to click`, got.links.every((l) => l.text.length > 0),
    'a .pref with no text');

  made.set(page, got.links.filter((l) => HREF.test(l.href)));
}

// ---- the ids the two source pages produce actually exist on the destination -
//
// This is the assertion the whole suite is for. A sample rather than all of
// them: each landing is a child process, and the failure mode being guarded
// against — the wrong FIELD, the wrong parameter name — shows up on the first
// one, not on the four-hundredth.

const SAMPLE = 4;
for (const [page, links] of made) {
  const ids = [...new Set(links.map((l) => HREF.exec(l.href)[1]))];
  ok(`${page} produced distinct player ids`, ids.length > 1, `${ids.length} distinct`);

  // Spread across the list rather than the first four, so a page that only gets
  // its first panel right does not pass.
  const step = Math.max(1, Math.floor(ids.length / SAMPLE));
  const picked = Array.from({ length: Math.min(SAMPLE, ids.length) }, (_, i) => ids[i * step]);

  for (const id of picked) {
    const got = run('land', `?player=${id}`);
    ok(`a link from ${page} (player ${id}) LANDS ON EXACTLY ONE MAN`,
      got.marked === 1, `${got.marked} rows marked — ${got.strip}`);
    ok(`and the man it lands on is the one asked for (${id})`,
      got.player === String(id), `${got.player} vs ${id}`);
    ok(`and the page says so out loud (${id})`,
      !got.hidden && /^Jumped to /.test(got.strip), got.strip);
    ok(`landing from ${page} costs no unexpected request (${id})`,
      got.fetchCalls.length === 0, got.fetchCalls.slice(0, 2).join(' | '));
    ok(`landing from ${page} logs no error (${id})`,
      got.errors.length === 0, got.errors.slice(0, 2).join(' | '));
  }
}

// ---- and a link whose text is a NUMBER still points at its own player -------
//
// Tim asked for "a number that refers to the player" to be clickable too, and a
// number carries no name to check itself against — so a grid cell wired to the
// wrong row would look perfectly fine on the page.

const gridLinks = (made.get('analysis.html') || []).filter((l) => /^\d+\.\d/.test(l.text));
ok('the analysis grids link their NUMBERS, not only their names', gridLinks.length > 0,
  `${gridLinks.length} numeric links`);
{
  const sample = gridLinks.slice(0, 3);
  for (const l of sample) {
    const id = HREF.exec(l.href)[1];
    const got = run('land', `?player=${id}`);
    // The link's own label names the man; the destination must agree.
    const named = (l.says.split(/\s+[—·]\s+/)[0] || '').trim();
    ok(`the number "${l.text}" lands on the man its tooltip names`,
      got.marked === 1 && named.length > 0 && got.who.startsWith(named),
      `tooltip says "${named}", landed on "${got.who}"`);
  }
}

// ---- an id nobody has is answered, not swallowed ---------------------------

{
  const got = run('land', '?player=987654321');
  ok('an unknown id is reported rather than failing silently',
    !got.hidden && /No player with id 987654321/.test(got.strip), got.strip);
  ok('and nothing is marked', got.marked === 0, `${got.marked} marked`);
}

// ---- no link at all is the normal state ------------------------------------

{
  const got = run('land', '');
  ok('with no ?player= the page is its ordinary self', got.hidden && got.marked === 0,
    `${got.marked} marked, hidden=${got.hidden}`);
}

for (const f of fails) console.log(`FAIL ${f}`);
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
