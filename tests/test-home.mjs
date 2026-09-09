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

/**
 * The same league with week 1 final.
 *
 * The bench panel is where two of the dashboard's player references live, and
 * it only draws once a week is over, so the pre-kickoff fixture cannot reach it.
 * Every squad here benched an RB who outscored the RB his owner started, which
 * is the one comparison SLOT_ELIGIBILITY allows between these three starters —
 * so every row has a miss, and the two men in it are known by name and by id.
 *
 * `blankIds` strips the ESPN id off named players, which is how the "no id, no
 * link" rule is exercised without inventing a second fixture.
 */
function finishedWeek({ blankIds = [] } = {}) {
  const fx = preKickoff();
  const blank = new Set(blankIds);
  const r1 = (n) => Math.round(n * 10) / 10;

  const teams = fx.rosters.teams.map((t, i) => {
    const withId = (p, actual) => ({
      ...p,
      playerId: blank.has(p.playerId) ? null : p.playerId,
      actual,
    });
    const starters = t.starters.map((p) => withId(p, r1(p.projected - 2)));
    // The benched RB beats the started RB by exactly 4 + i, so the "Cost"
    // column has a value this file can predict rather than read back.
    const bench = t.bench.map((p) => withId(p, r1(starters[1].actual + 4 + i)));
    const sum = (arr) => r1(arr.reduce((a, p) => a + p.actual, 0));

    return {
      ...t,
      players: [...starters, ...bench],
      starters,
      bench,
      actualTotal: sum(starters),
      benchActualTotal: sum(bench),
    };
  });

  const scoreOf = new Map(teams.map((t) => [t.id, t.actualTotal]));
  const games = fx.schedule.byWeek.get(1).map((g) => {
    const homeScore = scoreOf.get(g.homeId);
    const awayScore = scoreOf.get(g.awayId);
    return {
      ...g,
      played: true,
      homeScore,
      awayScore,
      margin: r1(homeScore - awayScore),
      winner: homeScore === awayScore ? 'tie' : homeScore > awayScore ? 'home' : 'away',
    };
  });

  const byWeek = new Map(fx.schedule.byWeek);
  byWeek.set(1, games);

  return {
    ...fx,
    schedule: { ...fx.schedule, byWeek, games: [...byWeek.values()].flat() },
    rosters: { week: 1, teams },
  };
}

// The one shape a player reference is allowed to take. Nothing on the page may
// emit a name, an index, an empty id, or the string "undefined".
const PREF_HREF = /^waivers\.html\?player=\d+$/;

/** Every panel whose subject is a fantasy team, not an NFL player. */
const TEAM_PANELS = ['#matchups', '#strength', '#standings'];

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

      // --- player references, against the real demo data -------------------
      //
      // The ids are checked against the roster payload the demo generator
      // produces for this week, so a link can only pass by carrying an id that
      // genuinely exists — a name, an index or a fabricated number all fail.
      const demoLinks = Array.from(document.querySelectorAll('a.pref'));
      facts.demoPrefs = demoLinks.length;
      if (!demoLinks.length) problems.push('demo: no player references anywhere on the dashboard');

      const demoBadHref = demoLinks
        .map((a) => a.getAttribute('href'))
        .filter((h) => !PREF_HREF.test(h || ''));
      if (demoBadHref.length) {
        problems.push(`demo: malformed player href ${JSON.stringify(demoBadHref.slice(0, 3))}`);
      }

      const demoWeek = Number((text('matchupsTitle').match(/Week (\d+)/) || [])[1]);
      const demoMod = await import(pathToFileURL(path.join(REPO, 'js/demo-rosters.js')).href);
      const realIds = new Set();
      for (const t of demoMod.generateDemoWeekRosters(demoWeek).teams) {
        for (const p of t.players) realIds.add(String(p.playerId));
      }
      const strangers = demoLinks
        .map((a) => (a.getAttribute('href') || '').replace('waivers.html?player=', ''))
        .filter((id) => !realIds.has(id));
      if (strangers.length) {
        problems.push(`demo: ${strangers.length} link(s) point at ids no roster carries: ${JSON.stringify(strangers.slice(0, 3))}`);
      }

      for (const sel of TEAM_PANELS) {
        const n = document.querySelectorAll(`${sel} a`).length;
        if (n) problems.push(`demo: ${n} link(s) inside ${sel} — team names are not players`);
      }

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

        // ------------------------------------------------- player references
        //
        // Every place the dashboard names a specific NFL player — or shows a
        // number that is his rather than his team's — is an <a class="pref">
        // pointed at waivers.html?player=<ESPN playerId>. Every id expected
        // below is re-derived from the fixture, never read back off the page,
        // so the page cannot pass by agreeing with itself.
        home.render(model);

        const cellText = (td) => (td.textContent || '').replace(/\s+/g, ' ').trim();
        const rowsOf = (sel) => Array.from(document.querySelectorAll(`${sel} tbody tr`));
        const hrefOf = (p) => `waivers.html?player=${p.playerId}`;

        // (1) The injury table: the name and the projection, both his.
        const injured = [];
        for (const t of fx.rosters.teams) {
          for (const p of t.starters) if (p.injuryStatus !== 'ACTIVE') injured.push(p);
        }

        const injuryLinks = Array.from(document.querySelectorAll('#injuries a.pref'));
        facts.injuryLinks = injuryLinks.length;
        if (injuryLinks.length !== injured.length * 2) {
          problems.push(`pref: ${injuryLinks.length} links in the injury table, expected ${injured.length * 2} (name + Proj on ${injured.length} rows)`);
        }
        for (const a of injuryLinks) {
          const href = a.getAttribute('href');
          if (!PREF_HREF.test(href || '')) problems.push(`pref: malformed injury href "${href}"`);
        }

        for (const row of rowsOf('#injuries')) {
          const c = Array.from(row.children);
          const p = injured.find((x) => cellText(c[0]).startsWith(x.name));
          if (!p) { problems.push(`pref: unrecognised injury row "${cellText(c[0])}"`); continue; }

          // text must be exactly what it was before any of this existed
          if (cellText(c[0]) !== `${p.name} ${p.position}`) {
            problems.push(`pref: linking changed the name cell to "${cellText(c[0])}", expected "${p.name} ${p.position}"`);
          }
          if (cellText(c[4]) !== p.projected.toFixed(1)) {
            problems.push(`pref: linking changed ${p.name}'s Proj cell to "${cellText(c[4])}"`);
          }
          if (c[4].getAttribute('data-v') !== String(p.projected)) {
            problems.push(`pref: ${p.name}'s Proj cell lost its data-v; sortable.js reads that, not the text`);
          }

          const nameA = c[0].querySelector('a.pref');
          const projA = c[4].querySelector('a.pref');
          if (!nameA) { problems.push(`pref: ${p.name} is not a link`); continue; }
          if (nameA.getAttribute('href') !== hrefOf(p)) {
            problems.push(`pref: ${p.name} links to "${nameA.getAttribute('href')}", expected "${hrefOf(p)}"`);
          }
          if (!projA) problems.push(`pref: ${p.name}'s projection is not a link`);
          else if (projA.getAttribute('href') !== nameA.getAttribute('href')) {
            problems.push(`pref: ${p.name}'s name and projection point at different players`);
          }

          const title = nameA.getAttribute('title') || '';
          if (!title.includes(p.name)) problems.push(`pref: ${p.name}'s link title does not name him: "${title}"`);
          if (!/Players page/.test(title)) problems.push(`pref: a link title does not say where it goes: "${title}"`);

          // The "Fantasy team" column is a manager, not a player.
          if (c[2].querySelector('a')) problems.push('pref: the injury table linked a fantasy team name');
        }

        facts.injuryNote = text('injuryNote');
        if (!/Players page/.test(facts.injuryNote)) {
          problems.push(`pref: the injury note does not state what its links do: "${facts.injuryNote}"`);
        }

        for (const sel of TEAM_PANELS) {
          const n = document.querySelectorAll(`${sel} a`).length;
          if (n) problems.push(`pref: ${n} link(s) inside ${sel} — team and manager names are not players`);
        }

        // (2) The bench table, on a week that is actually over.
        const fin = finishedWeek();
        home.render(home.buildModel(fin));

        const byTeamName = new Map(fin.rosters.teams.map((t) => [t.name, t]));
        facts.finBenchRows = rowsOf('#bench').length;
        facts.benchLinks = document.querySelectorAll('#bench a.pref').length;
        if (facts.finBenchRows !== 10) problems.push(`fin: ${facts.finBenchRows} bench rows, expected 10`);
        if (facts.benchLinks !== 20) {
          problems.push(`pref: ${facts.benchLinks} links in the bench table, expected 20 (both men in 10 misses)`);
        }

        for (const row of rowsOf('#bench')) {
          const c = Array.from(row.children);
          const t = byTeamName.get(cellText(c[0]));
          if (!t) { problems.push(`pref: unrecognised bench row "${cellText(c[0])}"`); continue; }

          // Team name, and the two team-level totals, belong to nobody.
          if (c[0].querySelector('a')) problems.push('pref: the bench table linked a team name');
          if (c[1].querySelector('a') || c[2].querySelector('a')) {
            problems.push(`pref: a team total in ${t.name}'s row was linked`);
          }
          // Cost is the gap between two players, so it is neither man's number.
          if (c[4].querySelector('a')) problems.push(`pref: ${t.name}'s Cost cell was linked`);

          const benched = t.bench[0];
          const started = t.starters[1];
          const want =
            `${benched.name} (${benched.actual.toFixed(1)}) over ` +
            `${started.name} (${started.actual.toFixed(1)})`;
          if (cellText(c[3]) !== want) {
            problems.push(`pref: linking changed ${t.name}'s miss cell to "${cellText(c[3])}", expected "${want}"`);
          }

          const links = c[3].querySelectorAll('a.pref');
          if (links.length !== 2) {
            problems.push(`pref: ${links.length} links in ${t.name}'s miss, expected 2`);
            continue;
          }
          [benched, started].forEach((p, i) => {
            const href = links[i].getAttribute('href');
            if (href !== hrefOf(p)) {
              problems.push(`pref: ${t.name}'s miss links ${p.name} to "${href}", expected "${hrefOf(p)}"`);
            }
            if (!(links[i].getAttribute('title') || '').includes(p.name)) {
              problems.push(`pref: ${p.name}'s link in a miss has no title naming him`);
            }
          });
        }

        facts.benchNote = text('benchNote');
        if (!/Players page/.test(facts.benchNote)) {
          problems.push(`pref: the bench note does not state what its links do: "${facts.benchNote}"`);
        }

        // (3) A player ESPN gave no id: plain text, not "?player=undefined".
        // Blanking the Aardvarks' benched RB and started RB covers both
        // panels at once — that started RB is also their questionable starter.
        const t0 = fin.rosters.teams[0];
        const noId = finishedWeek({ blankIds: [t0.bench[0].playerId, t0.starters[1].playerId] });
        home.render(home.buildModel(noId));

        const anyBad = Array.from(document.querySelectorAll('a.pref'))
          .map((a) => a.getAttribute('href'))
          .filter((h) => !PREF_HREF.test(h || ''));
        if (anyBad.length) problems.push(`pref: id-less players produced ${JSON.stringify(anyBad.slice(0, 3))}`);

        const n0 = noId.rosters.teams[0];
        const missRow = rowsOf('#bench').find((r) => cellText(r.children[0]) === n0.name);
        facts.noIdMissLinks = missRow ? missRow.children[3].querySelectorAll('a.pref').length : -1;
        if (facts.noIdMissLinks !== 0) {
          problems.push(`pref: ${facts.noIdMissLinks} link(s) emitted for players carrying no id`);
        }
        const wantMiss =
          `${n0.bench[0].name} (${n0.bench[0].actual.toFixed(1)}) over ` +
          `${n0.starters[1].name} (${n0.starters[1].actual.toFixed(1)})`;
        if (missRow && cellText(missRow.children[3]) !== wantMiss) {
          problems.push(`pref: an unlinked miss cell reads "${cellText(missRow.children[3])}", expected "${wantMiss}"`);
        }

        facts.noIdInjuryLinks = document.querySelectorAll('#injuries a.pref').length;
        if (facts.noIdInjuryLinks !== (injured.length - 1) * 2) {
          problems.push(`pref: ${facts.noIdInjuryLinks} injury links with one id missing, expected ${(injured.length - 1) * 2}`);
        }
        const lame = n0.starters[1];
        const lameRow = rowsOf('#injuries').find((r) => cellText(r.children[0]).startsWith(lame.name));
        if (!lameRow) problems.push('pref: the id-less injured starter vanished from the table');
        else {
          if (lameRow.children[0].querySelector('a')) problems.push('pref: linked a player carrying no id');
          if (lameRow.children[4].querySelector('a')) problems.push('pref: linked the projection of a player carrying no id');
          if (cellText(lameRow.children[0]) !== `${lame.name} ${lame.position}`) {
            problems.push(`pref: an unlinked name cell reads "${cellText(lameRow.children[0])}", expected "${lame.name} ${lame.position}"`);
          }
        }
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
