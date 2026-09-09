// Boots index.html and debug.html for real in linkedom, then drives
// home-page.js's model/render pair with a synthetic PRE-KICKOFF week — the case
// that cannot be reached from the demo data, because the demo season is over.
//
//   node test-home.mjs            (parent: one child process per page)
//   node test-home.mjs index.html (child)

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
const PAGES = ['index.html', 'debug.html'];

function moduleSrcs(html) {
  const out = [];
  const re = /<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

async function boot(page) {
  const html = readFileSync(path.join(REPO, page), 'utf8');
  const { window, document } = parseHTML(html);

  const SelectProto = window.HTMLSelectElement?.prototype;
  if (SelectProto) {
    Object.defineProperty(SelectProto, 'value', {
      configurable: true,
      get() {
        const sel = this.querySelector('option[selected]') || this.querySelector('option');
        return sel ? sel.getAttribute('value') ?? sel.textContent : '';
      },
      set(v) {
        for (const o of this.querySelectorAll('option')) {
          if ((o.getAttribute('value') ?? o.textContent) === String(v)) o.setAttribute('selected', '');
          else o.removeAttribute('selected');
        }
      },
    });
  }

  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const fetchCalls = [];
  const fetch = async (url) => { fetchCalls.push(String(url)); throw new Error(`unexpected network call: ${url}`); };

  Object.assign(globalThis, {
    window, document, localStorage, fetch,
    HTMLElement: window.HTMLElement,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    Node: window.Node,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;

  const errors = [];
  const orig = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); orig(...a); };

  const srcs = moduleSrcs(html);
  if (!srcs.length) throw new Error(`${page}: declares no module scripts`);

  const mods = {};
  for (const src of srcs) {
    mods[src] = await import(pathToFileURL(path.join(REPO, src)).href);
  }

  await new Promise((r) => setTimeout(r, 300));
  console.error = orig;

  return { document, mods, errors, fetchCalls, srcs };
}

// ------------------------------------------------------- pre-kickoff fixture

/** Week 1, nothing played, ESPN totals null exactly as season.js now returns. */
function preKickoff() {
  const names = ['Aardvarks', 'Badgers', 'Cobras', 'Dingoes', 'Egrets',
                 'Falcons', 'Gophers', 'Herons', 'Ibexes', 'Jackals'];
  const teams = names.map((n, i) => ({ id: i + 1, name: n }));

  const games = [];
  for (let i = 0; i < 10; i += 2) {
    games.push({
      week: 1,
      homeId: i + 1, homeName: names[i], homeScore: null,
      awayId: i + 2, awayName: names[i + 1], awayScore: null,
      played: false, margin: null, winner: null,
    });
  }

  const byWeek = new Map([[1, games]]);
  for (let w = 2; w <= 13; w++) byWeek.set(w, []);

  const player = (id, name, position, lineupSlotId, slot, projected, injuryStatus) => ({
    playerId: id, name, position, proTeam: 'KC', lineupSlotId, slot,
    started: lineupSlotId !== 20,
    projected, actual: null, seasonProjected: projected * 13,
    injuryStatus, percentOwned: 50,
  });

  const rosterTeams = teams.map((t, i) => {
    const starters = [
      player(t.id * 100 + 1, `QB ${t.name}`, 'QB', 0, 'QB', 18 + i * 0.3, 'ACTIVE'),
      player(t.id * 100 + 2, `RB ${t.name}`, 'RB', 2, 'RB', 12 + i * 0.2, i % 3 === 0 ? 'QUESTIONABLE' : 'ACTIVE'),
      player(t.id * 100 + 3, `WR ${t.name}`, 'WR', 4, 'WR', 11 + i * 0.1, i === 4 ? 'OUT' : 'ACTIVE'),
    ];
    const bench = [player(t.id * 100 + 9, `Bench ${t.name}`, 'RB', 20, 'BE', 6, 'ACTIVE')];
    const projectedTotal = Math.round(starters.reduce((a, p) => a + p.projected, 0) * 10) / 10;
    return {
      id: t.id, name: t.name, abbrev: t.name.slice(0, 3).toUpperCase(),
      players: [...starters, ...bench], starters, bench,
      projectedTotal,
      actualTotal: null,          // nobody has played
      benchActualTotal: null,
      seasonProjectedTotal: Math.round(projectedTotal * 13 * 10) / 10,
    };
  });

  return {
    schedule: {
      leagueName: 'Pre-Kickoff League',
      teams,
      weeks: [...byWeek.keys()],
      byWeek,
      games: [...byWeek.values()].flat(),
    },
    rosters: { week: 1, teams: rosterTeams },
    week: 1,
    teamId: 3,
    isDemo: false,
  };
}

// ------------------------------------------------------------------ child mode

if (process.argv[2]) {
  const page = process.argv[2];
  const problems = [];
  try {
    const { document, mods, errors, fetchCalls } = await boot(page);
    const $ = (id) => document.getElementById(id);
    const text = (id) => ($(id)?.textContent || '').replace(/\s+/g, ' ').trim();

    if (errors.length) problems.push(`console.error: ${errors.slice(0, 3).join(' | ')}`);
    if (fetchCalls.length) problems.push(`network call: ${fetchCalls[0]}`);

    const facts = {};

    if (page === 'index.html') {
      // --- demo boot -----------------------------------------------------
      facts.demoBadge = text('modeBadge');
      facts.demoGames = document.querySelectorAll('#matchups .game').length;
      facts.demoRankRows = document.querySelectorAll('#strength .rank li').length;
      facts.demoStandingsRows = document.querySelectorAll('#standings tbody tr').length;
      facts.demoBenchRows = document.querySelectorAll('#bench tbody tr').length;
      facts.demoWeekOptions = document.querySelectorAll('#weekSelect option').length;

      if (facts.demoBadge !== 'Demo') problems.push(`badge is "${facts.demoBadge}", expected Demo`);
      if (facts.demoGames !== 5) problems.push(`demo: ${facts.demoGames} matchup cards, expected 5`);
      if (facts.demoRankRows !== 10) problems.push(`demo: ${facts.demoRankRows} strength rows, expected 10`);
      if (facts.demoStandingsRows !== 10) problems.push(`demo: ${facts.demoStandingsRows} standings rows, expected 10`);
      if (!facts.demoBenchRows) problems.push('demo: bench panel is empty on a completed week');
      if (facts.demoWeekOptions !== 13) problems.push(`demo: ${facts.demoWeekOptions} week options, expected 13`);
      if (process.env.DUMP_DEMO) console.error($(process.env.DUMP_DEMO)?.innerHTML || '(none)');

      // --- pre-kickoff ---------------------------------------------------
      const home = mods['js/home-page.js'];
      if (!home?.buildModel || !home?.render) {
        problems.push('home-page.js does not export buildModel/render');
      } else {
        const fx = preKickoff();
        const model = home.buildModel(fx);
        home.render(model);

        facts.preGames = document.querySelectorAll('#matchups .game').length;
        facts.preUpcoming = document.querySelectorAll('#matchups .game.upcoming').length;
        facts.preMine = document.querySelectorAll('#matchups .game.mine').length;
        facts.preNote = text('matchupsNote');
        facts.preStandings = text('standings');
        facts.preBench = text('bench');
        facts.preInjuryRows = document.querySelectorAll('#injuries tbody tr').length;
        facts.preRankRows = document.querySelectorAll('#strength .rank li').length;
        facts.preBadge = text('modeBadge');
        facts.preSub = text('pageSub');

        const cards = $('matchups').innerHTML;
        const scores = Array.from(document.querySelectorAll('#matchups .tscore'))
          .map((el) => el.textContent.trim());

        if (facts.preGames !== 5) problems.push(`pre: ${facts.preGames} cards, expected 5`);
        if (facts.preUpcoming !== 5) problems.push('pre: some cards are not marked upcoming');
        if (facts.preMine !== 1) problems.push(`pre: ${facts.preMine} cards flagged as mine, expected 1`);
        if (!scores.every((s) => s === '—')) problems.push(`pre: fabricated scores ${JSON.stringify(scores)}`);
        if (!/Projected:/.test(cards)) problems.push('pre: no projected favourite shown');
        if (!/Nothing has kicked off/.test(facts.preNote)) problems.push(`pre: matchup note reads "${facts.preNote}"`);
        if (!/Nothing has been played/.test(facts.preStandings)) problems.push(`pre: standings not empty-stated: "${facts.preStandings.slice(0, 90)}"`);
        if (/\d+-\d+/.test(facts.preStandings)) problems.push('pre: standings invented a record');
        if (!/has not finished/.test(facts.preBench)) problems.push(`pre: bench not empty-stated: "${facts.preBench.slice(0, 90)}"`);
        if (/0\.0/.test(facts.preBench + facts.preStandings)) problems.push('pre: a fabricated 0.0 reached the page');
        if (facts.preRankRows !== 10) problems.push(`pre: ${facts.preRankRows} strength rows, expected 10`);
        if (facts.preInjuryRows !== 5) problems.push(`pre: ${facts.preInjuryRows} injured starters, expected 5`);
        if (facts.preBadge !== 'Live') problems.push(`pre: badge "${facts.preBadge}", expected Live`);

        // Rosters missing entirely: three panels degrade, page survives.
        const noRosters = home.buildModel({ ...fx, rosters: null });
        home.render(noRosters);
        facts.noRosterStrength = text('strength');
        facts.noRosterInjuries = text('injuries');
        if (!/unavailable/.test(facts.noRosterStrength)) problems.push('no-rosters: strength panel does not say why it is empty');
        if (!/unavailable/.test(facts.noRosterInjuries)) problems.push('no-rosters: injury panel does not say why it is empty');
      }
    }

    if (page === 'debug.html') {
      facts.probeButtons = document.querySelectorAll('.probe-btn').length;
      facts.allDisabled = Array.from(document.querySelectorAll('.probe-btn')).every((b) => b.disabled);
      facts.season = $('season')?.value;
      if (facts.probeButtons !== 5) problems.push(`debug: ${facts.probeButtons} probe buttons, expected 5`);
      if (!facts.allDisabled) problems.push('debug: probes enabled before any league check');
      if (!/^20\d\d$/.test(String(facts.season))) problems.push(`debug: season prefilled as "${facts.season}"`);
    }

    if (process.env.DUMP) console.error($(process.env.DUMP)?.innerHTML || '(no such element)');

    console.log(JSON.stringify({ page, ok: problems.length === 0, problems, facts }));
    process.exit(problems.length ? 1 : 0);
  } catch (err) {
    console.log(JSON.stringify({ page, ok: false, problems: [String(err?.stack || err)] }));
    process.exit(1);
  }
}

// ----------------------------------------------------------------- parent mode

const self = fileURLToPath(import.meta.url);
let failed = 0;
for (const page of PAGES) {
  const res = spawnSync(process.execPath, [self, page], { encoding: 'utf8' });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch { /* fall through */ }

  if (!parsed) {
    console.log(`FAIL ${page}\n  stdout=${res.stdout}\n  stderr=${(res.stderr || '').slice(0, 1500)}`);
    failed++;
    continue;
  }
  console.log(`${parsed.ok ? 'PASS' : 'FAIL'} ${page}`);
  console.log(`  ${JSON.stringify(parsed.facts)}`);
  for (const p of parsed.problems || []) { console.log(`  - ${p.slice(0, 900)}`); }
  if (!parsed.ok) failed++;
}
console.log(failed ? `\n${failed} page(s) failed` : `\nAll ${PAGES.length} pages OK`);
process.exit(failed ? 1 : 0);
