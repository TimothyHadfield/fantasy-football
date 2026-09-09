// The raw-payload probes, which used to be the site's front page.
//
// They are still worth keeping: every field the dashboard and the stats pages
// read was found by clicking one of these buttons and reading the JSON. But a
// developer's console is not a landing page, so it lives here instead.
//
// This page deliberately does NOT write the saved connection. It configures
// espn.js in memory only, so you can aim a probe at a different league or an
// older season without silently repointing Stats, Analysis and Schedule at it.

import * as espn from './espn.js';
import * as bridge from './bridge.js';
import { savedConfig, onConnection } from './connection.js';

const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

function setStatus(msg, kind = '') {
  const el = $('status');
  el.textContent = msg;
  el.style.color =
    kind === 'ok' ? 'var(--accent)' : kind === 'err' ? 'var(--err)' : 'var(--dim)';
}

function show(obj) {
  const el = $('output');
  el.classList.remove('hidden');
  el.textContent = JSON.stringify(obj, null, 2);
}

function setProbesEnabled(on) {
  document.querySelectorAll('.probe-btn').forEach((b) => { b.disabled = !on; });
}

// ------------------------------------------------------------------ prefilling

// savedConfig() rather than localStorage: the bar and the pages disagreed about
// which key held the league once already, and reading it in a third place is
// how that bug would come back.
const saved = savedConfig();
$('leagueId').value = saved?.leagueId ?? '';
$('season').value = String(saved?.season ?? bridge.currentSeason());

// If the strip finishes its own probe while this page is open, take its answer
// rather than making the same round trip again.
onConnection((conn) => {
  if (!conn) return;
  $('leagueId').value = conn.leagueId;
  $('season').value = String(conn.season);
  espn.configure({ leagueId: conn.leagueId, season: conn.season });
  setStatus(`Connected to ${conn.name}.`, 'ok');
  setProbesEnabled(true);
});

// -------------------------------------------------------------------- probing

async function check() {
  const leagueId = $('leagueId').value.trim();
  const season = Number($('season').value.trim());
  if (!leagueId) { setStatus('Enter a league ID.', 'err'); return; }

  espn.configure({ leagueId, season });

  setStatus('Checking…');
  $('summary').classList.add('hidden');
  $('connect').disabled = true;

  try {
    const league = await espn.testConnection();
    setStatus('League readable.', 'ok');

    const d = league.draft;
    const draftState = d.complete ? 'complete'
      : d.inProgress ? 'in progress'
      : `not started${d.picks.length ? ` (${d.picks.length} picks recorded)` : ''}`;

    $('summaryList').innerHTML = `
      <dt>League</dt><dd>${esc(league.name)}</dd>
      <dt>Teams</dt><dd>${league.size}</dd>
      <dt>Scoring</dt><dd>${esc(league.scoringFormat)}</dd>
      <dt>Roster</dt><dd>${league.rosterSize} (${league.benchSlots} bench)</dd>
      <dt>Draft</dt><dd>${esc(d.type)} &middot; ${draftState}</dd>
    `;
    $('summary').classList.remove('hidden');
    setProbesEnabled(true);
  } catch (err) {
    setStatus(err.message, 'err');
    setProbesEnabled(false);
  } finally {
    $('connect').disabled = false;
  }
}

async function probe(kind) {
  setStatus(`Fetching ${kind}…`);
  try {
    let result;
    if (kind === 'players') {
      const players = await espn.fetchPlayers(50);
      result = { count: players.length, sample: players.slice(0, 5) };
    } else if (kind === 'draft') {
      result = espn.parseLeague(await espn.fetchDraft()).draft;
    } else if (kind === 'rosters') {
      const parsed = espn.parseLeague(await espn.fetchRosters());
      result = parsed.teams.map((t) => ({ team: t.name, players: t.roster.length }));
    } else if (kind === 'matchups') {
      const raw = await espn.fetchMatchups();
      result = { matchups: (raw.schedule || []).length, sample: (raw.schedule || []).slice(0, 3) };
    } else if (kind === 'transactions') {
      const raw = await espn.fetchTransactions();
      result = { count: (raw.transactions || []).length, sample: (raw.transactions || []).slice(0, 3) };
    }
    show(result);
    setStatus(`${kind} OK.`, 'ok');
  } catch (err) {
    setStatus(err.message, 'err');
  }
}

$('connect').addEventListener('click', check);

document.querySelectorAll('.probe-btn').forEach((btn) => {
  btn.addEventListener('click', () => probe(btn.dataset.probe));
});
