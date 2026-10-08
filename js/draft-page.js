// Draft room wiring.
//
// Two things drive the design.
//
// 1. There are 90 seconds per pick. Every interaction that happens while the
//    clock runs is one keystroke or one click, and the recommendation is
//    readable without scrolling.
// 2. The live ESPN draft feed has never been tested against a real draft.
//    So nothing here depends on it: the room is fully usable in manual mode,
//    ESPN sync is an accelerator, and if sync dies mid-draft the room keeps
//    working with whatever it already had.

import {
  configure, fetchPlayers, fetchByeWeeks, fetchDraft, AuthError,
} from './espn.js';
import { demoPlayerPool } from './draft-demo.js';
import {
  LEAGUE, buildBoard, recommend, picksForSlot, pickLabel, roundOf, slotAtPick,
} from './draft-model.js';
import {
  makeRng, opponentPick, simulateDraft, gradeDraft, gradeNotes, bestLineup,
} from './draft-sim.js';
import { enableSort, resort } from './sortable.js';
// The draft, looked back on ("Our draft") — see the section of that name below.
import * as espn from './espn.js';
import * as season from './season.js';
import * as capture from './capture.js';
import * as draftReview from './draft-review.js';
import { generateDemoSchedule, generateDemoWeekRosters } from './demo-rosters.js';
import { heatScale, heatOf, heatMarkHtml } from './heat.js';
import {
  weekRun, registerRun, tipAttr, clearRuns, wireTips, byeWeekOf,
} from './player-card.js';
import { shortName } from './actual-season-table.js';
import { scope } from './prefs.js';
import { savedConfig, onConnection } from './connection.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const pct = (n) => `${Math.round(n * 100)}%`;
const fmt = (n) => (n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1));

const SAVE_KEY = 'ff-draft-room-v1';
const HISTORY_KEY = 'ff-draft-history-v1';

const state = {
  mode: 'practice',   // 'practice' | 'live'
  level: 'normal',
  seed: 1,
  rng: null,
  source: 'demo',
  slotNotice: '',
  leagueId: '',
  slot: 1,
  teams: LEAGUE.teams,
  rounds: LEAGUE.rounds,
  players: [],
  drafted: [],        // [{ playerId, overall, mine }]
  syncTimer: null,
  syncMode: 'manual',
  poolWarning: '',
  filter: 'ALL',
  query: '',
  board: null,
  rec: null,
};

// ------------------------------------------------------------------ persistence
// A browser refresh in the middle of a draft must not lose the board.

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      mode: state.mode, level: state.level,
      source: state.source, leagueId: state.leagueId, slot: state.slot,
      teams: state.teams, rounds: state.rounds,
      // Only a real draft is worth resuming; practice always starts fresh.
      drafted: state.mode === 'live' ? state.drafted : [],
    }));
  } catch { /* private browsing, or storage is full — not worth failing over */ }
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// --------------------------------------------------------------- player pools

/** ESPN's player shape -> the shape draft-model.js expects. */
function toModelPlayer(p, byes) {
  return {
    id: p.id,
    name: p.name,
    pos: p.position,
    team: p.proTeam,
    bye: byes[p.proTeamId] ?? null,
    proj: p.projected ?? 0,
    adp: p.adp,
    owned: p.percentOwned,
    injury: p.injuryStatus || 'ACTIVE',
    // ESPN's player payload does carry per-stat splits, but this project has
    // not yet decoded rushing yards/TDs out of them. Until it does, the
    // rushing-QB rule simply never fires on live data. It still works on the
    // demo pool, and it degrades quietly rather than lying.
    rushYards: p.rushYards ?? 0,
    rushTds: p.rushTds ?? 0,
  };
}

/**
 * ESPN returns a flat placeholder ADP for seasons where it has no real draft
 * data — every player comes back at the same value, commonly 170. That is
 * indistinguishable from real data by shape but useless, and it would silently
 * poison every survival estimate on the board. So: if one ADP value dominates
 * the pool, throw all of them away and say so.
 */
function stripSentinelAdp(players) {
  const counts = new Map();
  for (const p of players) {
    if (p.adp == null) continue;
    counts.set(p.adp, (counts.get(p.adp) || 0) + 1);
  }
  if (!counts.size) return { players, warning: '' };

  const [value, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n < players.length * 0.25) return { players, warning: '' };

  return {
    players: players.map((p) => ({ ...p, adp: null })),
    warning: `ESPN returned the same draft position (${value}) for ${n} players, ` +
      'which means it has no real ADP for this season. Rankings still work, but ' +
      '"will he last?" is a coin flip until real draft data exists.',
  };
}

async function loadLivePool() {
  configure({ leagueId: state.leagueId, season: new Date().getFullYear() });
  const [players, byes] = await Promise.all([fetchPlayers(400), fetchByeWeeks()]);
  const mapped = players
    .filter((p) => p.position !== 'UNK' && (p.projected ?? 0) > 0)
    .map((p) => toModelPlayer(p, byes));

  const { players: cleaned, warning } = stripSentinelAdp(mapped);
  state.poolWarning = warning;
  return cleaned;
}

// ------------------------------------------------------------------- the room

function currentPick() {
  return state.drafted.length + 1;
}

function myPicks() {
  return picksForSlot(state.slot, state.teams, state.rounds);
}

function isMyTurn() {
  return myPicks().includes(currentPick());
}

function myPlayerIds() {
  return state.drafted.filter((d) => d.mine).map((d) => d.playerId);
}

function playerById(id) {
  return state.players.find((p) => p.id === id);
}

function recompute() {
  state.board = buildBoard({
    players: state.players,
    drafted: state.drafted,
    myPlayerIds: myPlayerIds(),
    currentPick: currentPick(),
    slot: state.slot,
    teams: state.teams,
    rounds: state.rounds,
  });
  state.rec = recommend(state.board, 5);
}

// ------------------------------------------------------------ practice mode

function totalPicks() {
  return state.teams * state.rounds;
}

function draftIsOver() {
  return currentPick() > totalPicks();
}

/** Every player taken by one draft slot, derived from the snake itself. */
function rosterForSlot(slot) {
  return state.drafted
    .filter((d) => slotAtPick(d.overall, state.teams) === slot)
    .map((d) => playerById(d.playerId))
    .filter(Boolean);
}

/** All ten rosters, in slot order. */
function allRosters() {
  return Array.from({ length: state.teams }, (_, i) => rosterForSlot(i + 1));
}

/**
 * Run the fake managers until it is the user's turn again.
 *
 * Practice is worthless if it is tedious, so the nine picks between your turns
 * happen instantly and are summarised, rather than played out one at a time.
 */
function runOpponents() {
  if (state.mode !== 'practice') return 0;
  let made = 0;
  while (!draftIsOver() && !isMyTurn()) {
    const pick = currentPick();
    const slot = slotAtPick(pick, state.teams);
    const taken = new Set(state.drafted.map((d) => d.playerId));
    const available = state.players.filter((p) => !taken.has(p.id));
    if (!available.length) break;

    const chosen = opponentPick(
      available, rosterForSlot(slot), roundOf(pick, state.teams),
      state.rounds, state.rng, state.level
    );
    if (!chosen) break;
    state.drafted.push({ playerId: chosen.id, overall: pick, mine: false });
    made++;
  }
  return made;
}

/**
 * What the assistant itself would have scored from the same slot.
 *
 * The honest way to answer "how did I do" — not against an abstract scale, but
 * against the advice you were being given. Opponents are re-seeded identically,
 * though the draft still diverges once a different player comes off the board.
 */
function assistantBenchmark() {
  const slot = state.slot;
  const pool = state.players;
  try {
    const sim = simulateDraft({
      players: pool, teams: state.teams, rounds: state.rounds,
      seed: state.seed, level: state.level,
      pickFor: ({ slot: s, overall, available, picks }) => {
        if (s !== slot) return null;
        const board = buildBoard({
          players: pool,
          drafted: picks.map((p) => ({ playerId: p.playerId, overall: p.overall })),
          myPlayerIds: picks.filter((p) => p.slot === slot).map((p) => p.playerId),
          currentPick: overall, slot, teams: state.teams, rounds: state.rounds,
        });
        const rec = recommend(board);
        return rec.pick ? available.find((p) => p.id === rec.pick.id) || null : null;
      },
    });
    const g = gradeDraft({ rosters: sim.rosters, myIndex: slot - 1, picks: [] });
    return { total: g.myTotal, rank: g.rank };
  } catch {
    return null; // a benchmark is a nicety; never let it break the results page
  }
}

// ------------------------------------------------------------------- history

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function pushHistory(entry) {
  try {
    const all = [entry, ...loadHistory()].slice(0, 50);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  } catch { /* storage unavailable — the results still render */ }
}

// ------------------------------------------------------------------- drafting

function draftPlayer(id, mine) {
  if (state.drafted.some((d) => d.playerId === id)) return;
  if (draftIsOver()) return;
  state.drafted.push({ playerId: id, overall: currentPick(), mine: Boolean(mine) });

  if (state.mode === 'practice') {
    runOpponents();
    if (draftIsOver()) { save(); showResults(); return; }
  }
  save();
  render();
}

/**
 * Undo. In practice mode that means rewinding past the opponents' replies too,
 * back to your own last pick — undoing one fake manager's pick would leave the
 * draft in a state that cannot happen.
 */
function undo() {
  if (state.mode === 'practice') {
    while (state.drafted.length && !state.drafted[state.drafted.length - 1].mine) {
      state.drafted.pop();
    }
  }
  state.drafted.pop();
  if (state.mode === 'practice') runOpponents();
  save();
  render();
}

// ------------------------------------------------------------------ rendering

/** Players taken since the user's previous pick, oldest first. */
function picksSinceMyLast() {
  const idx = state.drafted.map((d) => d.mine).lastIndexOf(true);
  return state.drafted
    .slice(idx + 1)
    .map((d) => playerById(d.playerId))
    .filter(Boolean);
}

function renderBar() {
  const bar = $('draftBar');
  const pick = currentPick();
  const mine = isMyTurn();
  const done = pick > state.teams * state.rounds;

  $('barPick').textContent = done ? '—' : pickLabel(pick, state.teams);
  $('barRound').textContent = done ? 'Draft complete' : `Round ${roundOf(pick, state.teams)}`;
  bar.classList.toggle('my-turn', mine && !done);

  if (done) {
    $('barTurn').textContent = 'Draft complete';
  } else if (mine) {
    // In practice the opponents have already replied, so name who went in
    // between — that is the information you would have been watching for.
    const since = picksSinceMyLast();
    $('barTurn').textContent = since.length
      ? `YOUR PICK — since your last: ${since.map((p) => p.name).join(', ')}`
      : 'YOUR PICK — press 1 to take the recommendation';
  } else {
    const next = myPicks().find((p) => p > pick);
    $('barTurn').textContent = next
      ? `Your next pick is ${pickLabel(next, state.teams)} — ${next - pick} away`
      : 'No picks left';
  }

  const sync = $('barSync');
  sync.textContent = state.mode === 'practice' ? `Practice · ${state.level}`
    : state.syncMode === 'live' ? 'ESPN live'
    : state.syncMode === 'error' ? 'Sync failed' : 'Manual';
  sync.className = 'db-sync' + (state.mode === 'practice' ? ''
    : state.syncMode === 'live' ? ' live'
    : state.syncMode === 'error' ? ' error' : '');
}

function renderAlerts() {
  const alerts = [...(state.rec.alerts || [])];
  if (state.poolWarning) alerts.unshift({ kind: 'now', text: state.poolWarning });
  // Which slot you drew matters most in the first round, and stops mattering
  // once you have picks on the board.
  if (state.slotNotice && roundOf(currentPick(), state.teams) <= 2) {
    alerts.unshift({ kind: 'tier', text: state.slotNotice });
  }
  $('alerts').innerHTML = alerts
    .map((a) => `<div class="alert ${a.kind}">${esc(a.text)}</div>`)
    .join('');
}

function whyChips(p) {
  return (p.notes || []).slice(0, 4).map((n) => {
    const warn = /injury|crowded|limit|no picks/.test(n);
    return `<span class="why-chip${warn ? ' warn' : ''}">${esc(n)}</span>`;
  }).join('');
}

function renderPick() {
  const p = state.rec.pick;
  const card = $('pickCard');
  if (!p) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  $('pcName').textContent = p.name;
  $('pcMeta').textContent =
    `${p.pos} · ${p.team}${p.bye ? ` · bye ${p.bye}` : ''}` +
    `${p.adp != null ? ` · ADP ${fmt(p.adp)}` : ''}` +
    `${p.injury && p.injury !== 'ACTIVE' ? ` · ${p.injury}` : ''}`;
  $('pcWhy').innerHTML = whyChips(p);
  $('pcProj').textContent = fmt(p.proj);
  $('pcVorp').textContent = `+${fmt(p.vorp)}`;
  $('pcLast').textContent = state.board.myNextPick ? pct(p.survives) : '—';
}

function renderAlternatives() {
  $('altGrid').innerHTML = (state.rec.alternatives || []).map((p, i) => `
    <div class="alt" data-pos="${esc(p.pos)}" data-id="${p.id}">
      <span class="alt-key">${i + 2}</span>
      <div class="alt-name">${esc(p.name)}</div>
      <div class="alt-meta">${esc(p.pos)} · ${esc(p.team)} · ${fmt(p.proj)} pts${
        state.board.myNextPick ? ` · ${pct(p.survives)} lasts` : ''}</div>
      <div class="alt-why">${esc((p.notes || [])[0] || '')}</div>
    </div>`).join('');
}

function renderRoster() {
  // Show the starting lineup as slots, so a hole is visibly a hole.
  const mine = myPlayerIds().map(playerById).filter(Boolean);
  const bySlot = [];
  const used = new Set();
  const takeBest = (positions) => {
    const cand = mine
      .filter((p) => positions.includes(p.pos) && !used.has(p.id))
      .sort((a, b) => b.proj - a.proj)[0];
    if (cand) used.add(cand.id);
    return cand;
  };

  const layout = [
    ['QB', ['QB']], ['RB', ['RB']], ['RB', ['RB']],
    ['WR', ['WR']], ['WR', ['WR']], ['TE', ['TE']],
    ['FLEX', LEAGUE.flexEligible], ['D/ST', ['DST']], ['K', ['K']],
  ];
  for (const [label, positions] of layout) {
    bySlot.push({ label, player: takeBest(positions) });
  }

  $('rosterSlots').innerHTML = bySlot.map(({ label, player }) => `
    <div class="slot${player ? '' : ' empty'}">
      <span class="slot-tag">${esc(label)}</span>
      <span class="slot-name">${player ? esc(player.name) : 'empty'}</span>
    </div>`).join('');

  const bench = mine.filter((p) => !used.has(p.id));
  const r = state.board.roster;
  $('rosterNote').innerHTML =
    `<strong>${mine.length}</strong> of ${state.rounds} drafted · ` +
    `bench: ${bench.length ? bench.map((p) => esc(p.name)).join(', ') : 'empty'}` +
    (r.starterHolesLeft
      ? ` · <strong>${r.starterHolesLeft}</strong> starting slot${r.starterHolesLeft > 1 ? 's' : ''} still empty`
      : ' · starting lineup complete');
}

function renderWait() {
  const b = state.board;
  $('waitPick').textContent = b.myNextPick ? pickLabel(b.myNextPick, state.teams) : '—';
  const gap = Math.max(0, (b.picksUntilNext ?? 1) - 1);
  const rows = Object.keys(LEAGUE.maxAt).map((pos) => {
    const best = b.available.find((p) => p.pos === pos && !p.blocked);
    const later = b.expectedLaterByPos[pos] ?? 0;
    const now = best ? best.vorp : 0;
    const share = (b.pressure || {})[pos] ?? 0;
    return { pos, best, now, later, cost: Math.max(0, now - later), chasing: share * gap };
  }).sort((a, b2) => b2.cost - a.cost);

  const table = $('waitTable');
  table.querySelector('tbody').innerHTML = rows.map((r) => `
    <tr>
      <td><strong>${esc(r.pos)}</strong></td>
      <td data-v="${r.now}">${r.best ? esc(r.best.name) : '—'}</td>
      <td data-v="${r.later}">${fmt(r.later)}</td>
      <td data-v="${r.cost}">${fmt(r.cost)}</td>
      <td data-v="${r.chasing}">${gap ? `${Math.round(r.chasing)} of ${gap}` : '—'}</td>
    </tr>`).join('');
  resort(table);
}

function renderBoard() {
  const q = state.query.trim().toLowerCase();
  const rows = state.board.available
    .filter((p) => state.filter === 'ALL' || p.pos === state.filter)
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .slice(0, 120);

  const table = $('boardTable');
  table.querySelector('tbody').innerHTML = rows.map((p, i) => `
    <tr class="${p.blocked ? 'gone' : ''}">
      <td data-v="${i + 1}">${i + 1}</td>
      <td class="name">${esc(p.name)}</td>
      <td>${esc(p.pos)}</td>
      <td>${esc(p.team)}</td>
      <td data-v="${p.bye ?? 99}">${p.bye ?? '—'}</td>
      <td data-v="${p.proj}">${fmt(p.proj)}</td>
      <td data-v="${p.adp ?? 999}">${p.adp == null ? '—' : fmt(p.adp)}</td>
      <td data-v="${p.vorp}">${fmt(p.vorp)}</td>
      <td data-v="${p.survives}">${state.board.myNextPick ? pct(p.survives) : '—'}</td>
      <td>${esc((p.notes || [])[0] || '')}</td>
      <td>
        <button type="button" class="mark" data-id="${p.id}" data-mine="1">Mine</button>
        <button type="button" class="mark" data-id="${p.id}" data-mine="">Taken</button>
      </td>
    </tr>`).join('');
  resort(table);
}

function renderLog() {
  $('pickLog').innerHTML = state.drafted.slice().reverse().map((d) => {
    const p = playerById(d.playerId);
    return `<span class="log-pick${d.mine ? ' mine' : ''}">` +
      `<b>${pickLabel(d.overall, state.teams)}</b>${esc(p ? p.name : '?')}</span>`;
  }).join('');
}

function render() {
  recompute();
  renderBar();
  renderAlerts();
  renderPick();
  renderAlternatives();
  renderRoster();
  renderWait();
  renderBoard();
  renderLog();
}

// ------------------------------------------------------------------- results

const GRADE_TIER = {
  'A+': 'great', A: 'great', 'A-': 'great',
  'B+': 'good', B: 'good', 'B-': 'good',
  'C+': 'ok', C: 'ok',
  D: 'poor', F: 'poor',
};

function showResults() {
  stopSync();
  const rosters = allRosters();
  const picks = state.drafted.map((d) => ({
    ...d, player: playerById(d.playerId),
  }));
  const g = gradeDraft({ rosters, myIndex: state.slot - 1, picks });

  $('room').classList.add('hidden');
  $('setupPanel').classList.add('hidden');
  $('results').classList.remove('hidden');

  const badge = $('gradeBadge');
  badge.textContent = g.grade;
  badge.dataset.tier = GRADE_TIER[g.grade] || 'ok';

  $('resultTitle').textContent =
    g.rank === 1 ? 'You won the draft' : `You finished ${ordinal(g.rank)} of ${g.teams}`;
  $('resultSub').textContent =
    `Projected starting lineup: ${Math.round(g.myTotal)} points · ` +
    `league average ${Math.round(g.leagueMean)} · best ${Math.round(g.leagueBest)}`;
  $('resultNotes').innerHTML = gradeNotes(g)
    .map((n) => `<li>${esc(n)}</li>`).join('');

  // Slot-by-slot against the same slot on every other team.
  const lt = $('lineupTable');
  lt.querySelector('tbody').innerHTML = g.bySlot.map((s) => `
    <tr>
      <td><span class="slot-tag">${esc(s.slot)}</span></td>
      <td class="name">${s.player ? esc(s.player.name) : '<em>empty</em>'}</td>
      <td data-v="${s.proj}">${fmt(s.proj)}</td>
      <td data-v="${s.leagueAvg}">${fmt(s.leagueAvg)}</td>
      <td data-v="${s.edge}" class="${s.edge >= 0 ? 'pos-edge' : 'neg-edge'}">
        ${s.edge >= 0 ? '+' : ''}${fmt(s.edge)}
      </td>
    </tr>`).join('');
  resort(lt);

  $('benchNote').textContent =
    `Bench projects ${Math.round(g.benchTotal)} points across ` +
    `${g.myLineup.bench.length} players.`;

  // Everyone's finish.
  const order = g.totals
    .map((total, i) => ({ i, total }))
    .sort((a, b) => b.total - a.total);
  const lg = $('leagueTable');
  lg.querySelector('tbody').innerHTML = order.map((row, idx) => {
    const isMe = row.i === state.slot - 1;
    const diff = row.total - g.myTotal;
    return `
      <tr class="${isMe ? 'me-row' : ''}">
        <td data-v="${idx + 1}">${idx + 1}</td>
        <td class="name">${isMe ? 'You' : `Manager ${row.i + 1}`} <span class="muted">(slot ${row.i + 1})</span></td>
        <td data-v="${row.total}">${Math.round(row.total)}</td>
        <td data-v="${diff}">${isMe ? '—' : `${diff >= 0 ? '+' : ''}${Math.round(diff)}`}</td>
      </tr>`;
  }).join('');
  resort(lg);

  const bench = assistantBenchmark();
  $('benchmarkNote').innerHTML = bench
    ? `Following the assistant's top pick every round from slot ${state.slot} scored ` +
      `<strong>${Math.round(bench.total)}</strong> and finished ${ordinal(bench.rank)}. ` +
      (g.myTotal >= bench.total
        ? `You beat it by ${Math.round(g.myTotal - bench.total)}.`
        : `It beat you by ${Math.round(bench.total - g.myTotal)}.`)
    : '';

  pushHistory({
    at: Date.now(),
    slot: state.slot,
    level: state.level,
    rank: g.rank,
    teams: g.teams,
    total: Math.round(g.myTotal),
    grade: g.grade,
  });
  renderHistory();
}

function renderHistory() {
  const rows = loadHistory();
  const table = $('historyTable');
  if (table) {
    table.querySelector('tbody').innerHTML = rows.map((r) => `
      <tr>
        <td data-v="${r.at}">${new Date(r.at).toLocaleString()}</td>
        <td data-v="${r.slot}">${r.slot}</td>
        <td>${esc(r.level)}</td>
        <td data-v="${r.rank}">${ordinal(r.rank)} of ${r.teams}</td>
        <td data-v="${r.total}">${r.total}</td>
        <td>${esc(r.grade)}</td>
      </tr>`).join('');
    resort(table);
  }

  // A one-line record on the setup screen, so it is visible before you start.
  const box = $('historyBox');
  if (!box) return;
  if (!rows.length) { box.innerHTML = ''; return; }
  const wins = rows.filter((r) => r.rank === 1).length;
  const avg = rows.reduce((s, r) => s + r.rank, 0) / rows.length;
  box.innerHTML =
    `<div class="history-line"><strong>Practice record:</strong> ${rows.length} draft` +
    `${rows.length > 1 ? 's' : ''}, ${wins} won, average finish ${avg.toFixed(1)}.</div>`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------------------------------------------------------------- ESPN sync

/**
 * Pull the live draft and reconcile it with what we have.
 *
 * ESPN is the authority on what has been picked, so its list replaces ours —
 * but only if it is actually ahead. A transient empty response must never wipe
 * a board someone has been maintaining by hand.
 */
async function syncDraft() {
  try {
    const raw = await fetchDraft();
    const picks = raw?.draftDetail?.picks || [];
    if (!picks.length || picks.length < state.drafted.length) return;

    const mineTeamId = state.myTeamId;
    state.drafted = picks
      .filter((p) => p.playerId)
      .sort((a, b) => (a.overallPickNumber || 0) - (b.overallPickNumber || 0))
      .map((p) => ({
        playerId: p.playerId,
        overall: p.overallPickNumber,
        mine: mineTeamId != null && p.teamId === mineTeamId,
      }));
    state.syncMode = 'live';
    save();
    render();
  } catch (err) {
    state.syncMode = 'error';
    renderBar();
  }
}

function startSync() {
  if (state.source !== 'live') return;
  stopSync();
  syncDraft();
  state.syncTimer = setInterval(syncDraft, 4000);
}

function stopSync() {
  if (state.syncTimer) clearInterval(state.syncTimer);
  state.syncTimer = null;
}

// --------------------------------------------------------------- interactions

function takeRecommendation(index) {
  const list = [state.rec.pick, ...(state.rec.alternatives || [])];
  const p = list[index];
  if (p) draftPlayer(p.id, true);
}

function wireRoom() {
  $('takeBtn').addEventListener('click', () => takeRecommendation(0));
  $('undoBtn').addEventListener('click', undo);
  $('exitBtn').addEventListener('click', () => {
    stopSync();
    $('room').classList.add('hidden');
    $('setupPanel').classList.remove('hidden');
  });

  $('altGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.alt');
    if (card) draftPlayer(Number(card.dataset.id), true);
  });

  $('boardTable').addEventListener('click', (e) => {
    const btn = e.target.closest('button.mark');
    if (btn) draftPlayer(Number(btn.dataset.id), Boolean(btn.dataset.mine));
  });

  $('search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderBoard();
  });

  $('posFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-pos]');
    if (!btn) return;
    state.filter = btn.dataset.pos;
    for (const b of $('posFilter').children) b.classList.toggle('on', b === btn);
    renderBoard();
  });

  // Number keys take a recommendation; "/" jumps to search. Both are one
  // keystroke because that is all there is time for.
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key >= '1' && e.key <= '5') takeRecommendation(Number(e.key) - 1);
    if (e.key === '/') { e.preventDefault(); $('search').focus(); }
    if (e.key === 'u') undo();
  });

  for (const id of ['waitTable', 'boardTable', 'lineupTable', 'leagueTable', 'historyTable']) {
    const el = $(id);
    if (el) enableSort(el);
  }
}

// --------------------------------------------------------------------- setup

function slotAdvice(slot, teams) {
  const picks = picksForSlot(slot, teams, 3);
  const turn = slot >= teams - 2 || slot <= 2;
  return `Your first three picks are <strong>${picks.map((p) => pickLabel(p, teams)).join(', ')}</strong>. ` +
    (turn
      ? 'You are on the turn, so treat back-to-back picks as one decision — take the pair that leaves you strongest, not the best two players in isolation.'
      : 'You pick near the middle of each round, so expect fewer runs to break your way but more consistent gaps between picks.');
}

async function enterRoom() {
  const status = $('setupStatus');
  state.mode = $('setupMode').value;
  state.level = $('setupLevel').value;
  state.leagueId = $('setupLeague').value.trim();
  state.teams = Number($('setupTeams').value) || 10;
  state.rounds = Number($('setupRounds').value) || 16;

  // Practice never touches ESPN. It is the one thing on this site that works
  // with nothing set up, and making it depend on a league would defeat that —
  // the built-in pool is real 2026 players already scored under Tim's rules,
  // so there is nothing to gain by requiring a login.
  state.source = state.mode === 'practice' ? 'demo' : $('setupSource').value;

  const wantsRandomSlot =
    state.mode === 'practice' && $('setupRandomSlot').value !== 'fixed';
  state.slot = wantsRandomSlot
    ? 1 + Math.floor(Math.random() * state.teams)
    : Number($('setupSlot').value) || 1;
  if (state.slot > state.teams) state.slot = state.teams;

  status.textContent = 'Loading player pool…';
  try {
    if (state.source === 'live') {
      if (!state.leagueId) throw new Error('Enter your league ID first.');
      state.players = await loadLivePool();
      state.syncMode = 'live';
    } else {
      state.players = demoPlayerPool();
      state.syncMode = 'manual';
      state.poolWarning = '';
    }
  } catch (err) {
    if (err instanceof AuthError) {
      status.textContent = 'ESPN says you are not authorised for that league. ' +
        'Make sure you are logged in to espn.com in this browser, then try again. ' +
        'Falling back to the demo pool.';
    } else {
      status.textContent = `${err.message} Falling back to the demo pool.`;
    }
    state.players = demoPlayerPool();
    state.source = 'demo';
    state.syncMode = 'manual';
    state.poolWarning = 'Using the demo pool — these are not your league\'s live numbers.';
  }

  if (!state.players.length) {
    status.textContent = 'No players loaded — cannot open the draft room.';
    return;
  }

  if (state.mode === 'practice') {
    // A fresh board every time — a practice draft you resume is not practice.
    state.seed = Math.floor(Math.random() * 2 ** 31);
    state.rng = makeRng(state.seed);
    state.drafted = [];
    const first = picksForSlot(state.slot, state.teams, 3)
      .map((p) => pickLabel(p, state.teams)).join(', ');
    state.slotNotice =
      `You drew slot ${state.slot} of ${state.teams}. Your first three picks: ${first}.`;
  } else {
    state.slotNotice = '';
    const saved = loadSaved();
    if (saved && saved.drafted?.length && saved.slot === state.slot) {
      state.drafted = saved.drafted.filter((d) => playerById(d.playerId));
    }
  }

  status.textContent = '';
  $('setupPanel').classList.add('hidden');
  $('results').classList.add('hidden');
  $('room').classList.remove('hidden');

  if (state.mode === 'practice') runOpponents();
  render();
  if (state.mode === 'live') startSync();
}

function backToSetup() {
  stopSync();
  $('results').classList.add('hidden');
  $('room').classList.add('hidden');
  $('setupPanel').classList.remove('hidden');
  renderHistory();
}

function init() {
  const saved = loadSaved();
  if (saved) {
    $('setupMode').value = saved.mode || 'practice';
    $('setupSource').value = saved.source || 'demo';
    $('setupLeague').value = saved.leagueId || '';
    $('setupSlot').value = saved.slot || 1;
    $('setupTeams').value = saved.teams || 10;
    $('setupRounds').value = saved.rounds || 16;
    if (saved.level) $('setupLevel').value = saved.level;
  }

  const updateAdvice = () => {
    const practice = $('setupMode').value === 'practice';
    const randomSlot = $('setupRandomSlot').value !== 'fixed';
    if (practice && randomSlot) {
      // No slot to advise on yet — it is drawn when the draft starts.
      $('slotAdvice').innerHTML =
        'Your slot will be drawn when you start, and the room will tell you how to ' +
        'play it.';
      return;
    }
    $('slotAdvice').innerHTML = slotAdvice(
      Number($('setupSlot').value) || 1,
      Number($('setupTeams').value) || 10
    );
  };
  const updateMode = () => {
    const practice = $('setupMode').value === 'practice';
    const randomSlot = $('setupRandomSlot').value !== 'fixed';

    $('practiceRow').classList.toggle('hidden', !practice);
    // Nothing about a league is relevant to a practice draft, so those fields
    // are not merely ignored — they are hidden, because leaving a League ID box
    // on screen makes the feature look like it needs one.
    $('fieldSource').classList.toggle('hidden', practice);
    $('fieldLeague').classList.toggle('hidden', practice);
    $('fieldSlot').classList.toggle('hidden', practice && randomSlot);

    $('startBtn').textContent = practice ? 'Start practice draft' : 'Enter draft room';
    $('setupIntro').innerHTML = practice
      ? 'Draft against nine computer managers, with the assistant advising you on ' +
        'every pick. Nothing to connect and nothing to log in to. Your draft slot ' +
        'is randomised, the same way your league does it an hour before.'
      : 'Set this up <strong>before</strong> the draft starts. Your league randomises ' +
        'the order an hour beforehand, so come back and set your slot once you know it.';
    updateAdvice();
  };
  $('setupSlot').addEventListener('input', updateAdvice);
  $('setupTeams').addEventListener('input', updateAdvice);
  $('setupMode').addEventListener('change', updateMode);
  $('setupRandomSlot').addEventListener('change', updateMode);
  updateMode();
  renderHistory();

  $('startBtn').addEventListener('click', enterRoom);

  // The sitewide bar starts a practice draft from a standing start, whatever
  // was left in the setup form.
  const startPractice = (e) => {
    if (e) e.preventDefault();
    $('setupMode').value = 'practice';
    $('setupRandomSlot').value = 'random';
    updateMode();
    // Not remembered: a practice draft started from the bar is one visit.
    showView('room', false);
    $('setupPanel').classList.remove('hidden');
    $('results').classList.add('hidden');
    enterRoom();
  };
  const barBtn = $('barPracticeBtn');
  if (barBtn) barBtn.addEventListener('click', startPractice);

  // draft.html?practice=1 — what the bar links to from every other page.
  const search = (typeof location !== 'undefined' && location.search) || '';
  if (new URLSearchParams(search).has('practice')) startPractice();
  $('againBtn').addEventListener('click', enterRoom);
  $('resultsExitBtn').addEventListener('click', backToSetup);
  $('clearHistoryBtn').addEventListener('click', () => {
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* nothing to do */ }
    renderHistory();
  });
  wireRoom();
}

// ================================================== the draft, looked back on
//
// Tim, 2026-10-08: "I also want to expand the draft section to show what our
// draft looked like and allow the user to select a specific user and see which
// big misses or steals they had based on current season proj and information."
//
// "Our draft" is the page's first view; the draft room above is the other half
// of the switch and is not touched by anything below. The arithmetic — where a
// man was drafted, what he is worth now, the difference — is js/draft-review.js
// (pure, tests/test-draft-review.mjs). This section reads the weeks and draws.
//
// WHAT IT READS, on a league read directly (the laptop, or the bridge):
//   - the schedule and every week's squads, through js/season.js and its store
//     — the reads the Analysis page makes, so usually already in this browser;
//   - the draft, once: `espn.fetchDraft()`. A finished draft never changes, so
//     it is kept in this browser and not asked for again;
//   - the weeks of drafted men who are on nobody's squad that week (dropped
//     since), which no squad read carries: one `espn.fetchPlayersWeek` a week
//     that has any. A finished week is kept for good; a week still to come for
//     six hours, as its projection moves.
// ON THE PHONE'S SYNCED COPY there is no draft (the copy does not carry one),
// so nothing is asked of ESPN at all and the page says so over the sample.

const prefs = scope('draft');
const REVIEW_KEY = 'ff-draft-review-v1';
const GAP_FRESH_MS = 6 * 60 * 60 * 1000;
/** How many of those reads go out together. */
const GAP_TOGETHER = 3;
const same = (a, b) => String(a) === String(b);
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** A place gained or lost, signed, with a real minus. */
const signed = (d) => (d === null || d === undefined ? '—' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}`);
const POS_SAID = { DST: 'D/ST' };
const posSaid = (pos) => POS_SAID[pos] || pos || '';

const review = {
  source: 'demo',
  world: null,
  teamId: null,
  leagueKey: 'demo',
  /** ESPN reads this page load asked for, by kind — printed nowhere, read by tests and by hand. */
  reads: { draft: 0, players: 0, squads: 0 },
};
if (typeof window !== 'undefined') window.ffDraftReads = review.reads;

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

/** Is this page's data the phone's synced copy? */
async function fromCloud() {
  if (typeof season.cloudSource !== 'function') return false;
  try { return Boolean(await season.cloudSource()); } catch { return false; }
}

// ---------------------------------------------------------- what is kept here

function readKept(leagueKey) {
  try {
    const all = JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}') || {};
    return all.league === leagueKey && all.kept ? all.kept : {};
  } catch { return {}; }
}

/** One league at a time: a second league's copy replaces the first. */
function writeKept(leagueKey, kept) {
  try { localStorage.setItem(REVIEW_KEY, JSON.stringify({ league: leagueKey, kept })); } catch { /* read again next time */ }
}

// ------------------------------------------------------------------ the world

/** Every week of the season, and which of them are behind us. */
function weeksOf(data) {
  const poWeeks = capture.playoffWeeks(data);
  const open = new Set(capture.openWeeks(data));
  const finished = new Set([
    ...data.weeks.filter((w) => !open.has(w)),
    ...poWeeks.filter((w) => capture.playoffWeekDecided(data, w)),
  ]);
  const weeks = [...data.weeks, ...poWeeks];
  return { weeks, poWeeks, finished, currentWeek: weeks.find((w) => !finished.has(w)) ?? weeks[weeks.length - 1] ?? null };
}

/**
 * Put a draft and its weeks together: every drafted man's season week by week,
 * then the review itself.
 *
 * @param {Object} o
 * @param {Map<number, Array>} o.rosters week -> that week's squads
 * @param {function(number, number):Object|null} o.gapOf (week, playerId) -> a
 *   man's week when he was on nobody's squad: `{name, position, proTeamId,
 *   projected, actual}`
 */
function assemble({ draft, data, rosters, gapOf, byes, isDemo }) {
  const { weeks, poWeeks, finished, currentWeek } = weeksOf(data);
  const drafted = new Set(draft.picks.map((p) => p.playerId));
  const men = new Map();
  const man = (id) => {
    if (!men.has(id)) men.set(id, { playerId: id, name: '', position: '', proTeamId: null, injuryStatus: null, glance: null, byWeek: {} });
    return men.get(id);
  };

  for (const w of weeks) {
    const over = finished.has(w);
    const on = new Set();
    for (const t of rosters.get(w) || []) {
      for (const p of t.players || []) {
        if (!drafted.has(p.playerId) || on.has(p.playerId)) continue;
        on.add(p.playerId);
        const m = man(p.playerId);
        m.name = p.name || m.name;
        m.position = p.position || m.position;
        m.proTeamId = p.proTeamId ?? m.proTeamId;
        // The week in play: a man who has finished carries his score as
        // `projected` and what was projected as `pregame` (js/season.js).
        const played = over || p.done === true;
        const score = played ? (finite(p.actual) ?? (over ? 0 : finite(p.projected)) ?? 0) : null;
        const proj = p.done === true ? finite(p.pregame) : finite(p.projected);
        m.byWeek[w] = { proj, act: score, counts: played ? score : proj, done: played };
        if (w <= currentWeek || m.injuryStatus === null) m.injuryStatus = p.injuryStatus || m.injuryStatus;
        if (w === currentWeek) m.glance = { avg: p.seasonAvg, proj, rank: p.posRank, pos: p.position };
      }
    }
    for (const id of drafted) {
      if (on.has(id)) continue;
      const g = gapOf(w, id);
      if (!g) continue;
      const m = man(id);
      m.name = m.name || g.name || '';
      m.position = m.position || (g.position && g.position !== 'UNK' ? g.position : '');
      m.proTeamId = m.proTeamId ?? g.proTeamId ?? null;
      const proj = finite(espn.byeAdjustedProjection(g.projected, g.proTeamId, w, byes));
      const score = over ? (finite(g.actual) ?? 0) : null;
      m.byWeek[w] = { proj, act: score, counts: over ? score : proj, done: over };
    }
  }

  // The lineup, off the latest week whose lineups are final (else the first).
  const lineupWeek = [...weeks].reverse().find((w) => finished.has(w) && (rosters.get(w) || []).length) ?? weeks[0];
  const slots = draftReview.slotsFromLineups(rosters.get(lineupWeek) || []);

  const players = new Map();
  for (const [id, m] of men) {
    if (!m.position) continue;
    players.set(id, { name: m.name, position: m.position, ...draftReview.seasonOf(m.byWeek, weeks) });
  }
  const rv = draftReview.reviewDraft({ draft, players, slots, teams: data.teams.length || null });
  return {
    isDemo, name: data.leagueName, teams: data.teams, weeks, poWeeks, finished, currentWeek,
    draft, men, byes, slots, rv,
    board: draftReview.boardOf(draft),
    // One scale for the whole draft: a pick's colour is its difference against everybody's.
    scale: heatScale(rv.rows.map((r) => r.diff)),
  };
}

/** The sample league never drafted, so its draft is made up from its week-1 squads. */
function demoWorld() {
  const data = capture.normalizeSchedule(generateDemoSchedule(), { isDemo: true });
  const { weeks } = weeksOf(data);
  const rosters = new Map(weeks.map((w) => [w, generateDemoWeekRosters(w).teams]));
  const first = rosters.get(weeks[0]) || [];
  const draft = draftReview.sampleDraft(first, draftReview.slotsFromLineups(first));
  return assemble({ draft, data, rosters, gapOf: () => null, byes: {}, isDemo: true });
}

/** A league read directly. Throws what the reads throw. */
async function liveWorld(cfg) {
  const say = (msg) => setStatus(`<span class="searching">${esc(msg)}</span>`);
  const data = capture.normalizeSchedule(await season.fetchSchedule(), { isDemo: false });
  const { weeks, finished } = weeksOf(data);
  const leagueKey = `${cfg.leagueId}-${cfg.season}`;
  const kept = readKept(leagueKey);

  let draft = kept.draft || null;
  if (!draft) {
    say('Reading the draft…');
    review.reads.draft++;
    draft = draftReview.parseDraft(await fetchDraft());
    if (draft.done) kept.draft = draft;
  }
  if (!draft.picks.length) return { empty: true, isDemo: false, name: data.leagueName, teams: data.teams };

  const rosters = await season.fetchWeeksRosters(weeks, {
    onProgress: (done, total, week, from) => {
      if (from === 'espn') review.reads.squads++;
      say(`Reading week ${week} (${done}/${total})`);
    },
  });
  const byes = await season.fetchByeWeeks();

  // THE MEN ON NOBODY'S SQUAD. What is kept for a week stands while the week's
  // state has not changed, and for a week still to come only six hours.
  const now = Date.now();
  if (!kept.weeks) kept.weeks = {};
  const wanted = [];
  for (const w of weeks) {
    const over = finished.has(w);
    let k = kept.weeks[w];
    if (!k || k.over !== over || (!over && now - k.at > GAP_FRESH_MS)) k = kept.weeks[w] = { at: now, over, men: {} };
    const on = new Set((rosters.get(w) || []).flatMap((t) => (t.players || []).map((p) => p.playerId)));
    const ids = draft.picks.map((p) => p.playerId).filter((id) => !on.has(id) && !(id in k.men));
    if (ids.length) wanted.push({ week: w, ids, k });
  }
  let read = 0;
  for (let i = 0; i < wanted.length; i += GAP_TOGETHER) {
    await Promise.all(wanted.slice(i, i + GAP_TOGETHER).map(async ({ week, ids, k }) => {
      review.reads.players += Math.ceil(ids.length / 100);
      const got = new Map((await espn.fetchPlayersWeek(ids, week))
        .map((e) => espn.parsePlayerWeek(e, week)).map((p) => [Number(p.playerId), p]));
      // A man ESPN does not know is kept as nothing, so he is not asked for again.
      for (const id of ids) {
        const p = got.get(Number(id));
        k.men[id] = p ? [p.name, p.position, p.proTeamId, p.projected, p.actual] : 0;
      }
      say(`Reading dropped players (${++read}/${wanted.length})`);
    }));
  }
  writeKept(leagueKey, kept);

  const gapOf = (w, id) => {
    const e = kept.weeks[w] && kept.weeks[w].men[id];
    return e ? { name: e[0], position: e[1], proTeamId: e[2], projected: e[3], actual: e[4] } : null;
  };
  return assemble({ draft, data, rosters, gapOf, byes, isDemo: false });
}

/**
 * Read one source's draft and put it on the page.
 * @returns {Promise<boolean>} false when it could not be read; the reason is
 *          then in the status line and whatever was on screen is left there
 */
async function loadReview(src) {
  const demo = src === 'demo';
  let world;
  let leagueKey = 'demo';
  let cfg = null;
  if (demo) {
    world = demoWorld();
    setStatus('');
  } else {
    // Never read localStorage for the league directly — see PROGRESS.md rule 6.
    cfg = savedConfig();
    if (!cfg) {
      setStatus('No league connected yet. Connect one on the bar above first.', true);
      return false;
    }
    configure({ leagueId: cfg.leagueId, season: cfg.season });
    // The phone's copy holds no draft: say so, and ask ESPN for nothing.
    if (await fromCloud()) {
      setStatus('This page needs the league read directly for now.', true);
      return false;
    }
    setStatus('<span class="searching">Loading your league from ESPN…</span>');
    try {
      world = await liveWorld(cfg);
    } catch (err) {
      setStatus(esc(err.message), true);
      return false;
    }
    leagueKey = `${cfg.leagueId}-${cfg.season}`;
    // Loaded: the line under the heading names the league, so this one says nothing.
    setStatus(world.empty ? 'No draft yet.' : '');
  }

  review.world = world;
  review.leagueKey = leagueKey;
  // Whose picks: the team last picked for THIS league, else the saved "my
  // team", else the first — the Decisions page's rule.
  const teamOf = (id) => (world.teams || []).find((t) => same(t.id, id)) || null;
  const pick = [prefs.get(`team.${leagueKey}`), cfg && cfg.teamId].map(teamOf).find(Boolean) || world.teams[0] || null;
  review.teamId = pick ? pick.id : null;
  renderReview();
  return true;
}

// -------------------------------------------------------------------- drawing

const teamName = (id) => {
  const t = (review.world.teams || []).find((x) => same(x.id, id));
  return t ? t.name || `Team ${id}` : `Team ${id}`;
};
const nameOf = (r) => r.name || `Player ${r.playerId}`;
/** Where he went, as the page prints it: a price in an auction, a pick in a snake. */
const wentFor = (r) => (review.world.draft.type === 'auction' ? `$${r.bid}` : String(r.overall));

/** A man's card: his season week by week (js/player-card.js). */
function cardAttr(r) {
  const w = review.world;
  const m = w.men.get(r.playerId);
  if (!m || !m.position) return '';
  // One card a man, however many places on the page name him.
  if (w.cards.has(r.playerId)) return tipAttr(w.cards.get(r.playerId));
  const first = w.weeks[0];
  const last = w.weeks[w.weeks.length - 1];
  const run = weekRun({
    heading: `${w.isDemo ? 'Sample projections' : 'ESPN’s projection'} for weeks ${first}–${last}`,
    weeks: w.weeks,
    projections: w.weeks.map((wk) => (m.byWeek[wk] ? m.byWeek[wk].proj : null)),
    actuals: w.weeks.map((wk) => (m.byWeek[wk] && m.byWeek[wk].done ? m.byWeek[wk].act : null)),
    currentWeek: w.currentWeek,
    demo: w.isDemo,
    byeWeek: byeWeekOf(m, w.byes),
    injuryStatus: m.injuryStatus,
    playoffWeeks: w.poWeeks,
  });
  const key = registerRun({
    ident: `${m.name} · ${posSaid(m.position)}`,
    run,
    href: w.isDemo ? null : `waivers.html?player=${encodeURIComponent(r.playerId)}`,
    id: `dr:${r.playerId}`,
    glance: m.glance,
  }, 'dr');
  w.cards.set(r.playerId, key);
  return tipAttr(key);
}

/** A difference that opens what it is made of. */
function whyHtml(r, inner, cls = '') {
  return `<span class="dr-why${cls ? ` ${cls}` : ''}" data-pid="${esc(r.playerId)}" tabindex="0" role="button" ` +
    `aria-label="${esc(nameOf(r))}: where this number comes from">${inner}</span>`;
}

function renderReview() {
  const w = review.world;
  if (!w) return;
  $('modeBadge').className = 'badge ' + (w.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = w.isDemo ? 'Demo' : 'Live';
  $('teamSelect').innerHTML = (w.teams || [])
    .map((t) => `<option value="${esc(t.id)}"${same(t.id, review.teamId) ? ' selected' : ''}>${esc(teamName(t.id))}</option>`)
    .join('');
  closePop();

  const any = !w.empty;
  $('drMain').hidden = !any;
  $('drExplain').hidden = !any;
  if (!any) { $('pageSub').textContent = w.name || ''; return; }

  const auction = w.draft.type === 'auction';
  const played = w.weeks.filter((wk) => w.finished.has(wk)).length;
  $('pageSub').textContent = [
    w.name, auction ? 'Auction' : 'Snake', `${w.draft.picks.length} picks`,
    played ? `${played} week${played === 1 ? '' : 's'} played` : '',
  ].filter(Boolean).join(' · ');
  $('thAt').textContent = auction ? 'Rank' : 'Pick';
  $('teamTable').querySelector('th.dr-paid').hidden = !auction;

  $('drNote').innerHTML =
    '<p><strong>Now</strong> is where a player would go if the same players were drafted again today: ' +
    'points so far plus ESPN’s projection for every week left, measured against a typical bench player at his position.</p>' +
    (auction
      ? '<p><strong>Rank</strong> is his price’s place in the draft: the most expensive player is 1, and players who cost the same share a place.</p>'
      : '') +
    `<p><strong>+/−</strong> is ${auction ? 'Rank' : 'Pick'} minus Now. Above zero is a steal, below zero a miss. ` +
    'Green and red compare it with every pick in the draft.</p>' +
    '<p>A player counts for the team that drafted him, wherever he is now.</p>';

  clearRuns('dr');
  w.cards = new Map();
  drawBoard();
  drawTeam();
}

function drawBoard() {
  const w = review.world;
  const { teamIds, rows } = w.board;
  const byId = new Map(w.rv.rows.map((r) => [r.playerId, r]));
  const mine = (id) => (same(id, review.teamId) ? ' dr-mine' : '');
  const table = $('draftBoard');
  // How many columns the stylesheet keeps at a readable width (css/app.css, `.dr-board`).
  table.setAttribute('style', `--dr-cols: ${teamIds.length}`);
  table.querySelector('thead').innerHTML = '<tr><th class="dr-rd">Rd</th>' + teamIds.map((id) =>
    `<th class="dr-col${mine(id)}" data-team="${esc(id)}"><button type="button" class="dr-pick-team" data-team="${esc(id)}" ` +
    `title="${esc(teamName(id))}">${esc(teamName(id))}</button></th>`).join('') + '</tr>';
  table.querySelector('tbody').innerHTML = rows.map((row, i) =>
    `<tr><td class="dr-rd">${i + 1}</td>` + row.map((pk, c) => {
      const id = teamIds[c];
      if (!pk) return `<td class="dr-cell dr-none${mine(id)}" data-team="${esc(id)}"></td>`;
      const r = byId.get(pk.playerId);
      const h = r.diff === null ? null : heatOf(r.diff, w.scale);
      return `<td class="dr-cell${mine(id)}${h ? ` ${h.cls}` : ''}" data-team="${esc(id)}">` +
        whyHtml(r, `<span class="dr-went">${esc(wentFor(r))}${r.position ? ` ${esc(posSaid(r.position))}` : ''}</span>` +
          `<span class="dr-d">${signed(r.diff)}${heatMarkHtml(h)}</span>`, 'dr-top') +
        `<span class="dr-name"${cardAttr(r)}>${esc(shortName({ name: nameOf(r), position: r.position }))}</span>` +
        '</td>';
    }).join('') + '</tr>').join('');
}

function drawTeam() {
  const w = review.world;
  const auction = w.draft.type === 'auction';
  const t = draftReview.teamReview(w.rv.rows, review.teamId);
  const who = (r) => `<span class="dr-name"${cardAttr(r)}>${esc(shortName({ name: nameOf(r), position: r.position }))}</span>` +
    // (A defence's name says what it is: "Jaguars D/ST".)
    (r.position && r.position !== 'DST' ? ` <span class="muted">${esc(posSaid(r.position))}</span>` : '');

  // Both tiles keep their room when a team has no steal or no miss, so the
  // table under them does not move from one team to the next.
  const tile = (k, r, key) => `<div class="stat dr-tile" data-tile="${key}"><div class="k">${k}</div>` +
    (r
      ? `<div class="v">${whyHtml(r, `${signed(r.diff)}${heatMarkHtml(heatOf(r.diff, w.scale))}`)}</div><div class="dr-who">${who(r)}</div>`
      : '<div class="v muted">—</div><div class="dr-who">&nbsp;</div>') +
    '</div>';
  $('teamStats').innerHTML = tile('Best steal', t.steal, 'steal') + tile('Biggest miss', t.miss, 'miss');

  $('teamTable').querySelector('tbody').innerHTML = t.picks.map((r) => {
    const h = r.diff === null ? null : heatOf(r.diff, w.scale);
    const v = (n) => (n === null || n === undefined ? '' : ` data-v="${esc(n)}"`);
    return `<tr data-pid="${esc(r.playerId)}">` +
      `<td class="name" data-v="${esc(nameOf(r))}">${who(r)}</td>` +
      `<td class="dr-paid"${auction ? '' : ' hidden'}${v(r.bid)}>${auction ? `$${r.bid}` : ''}</td>` +
      `<td${v(r.at)}>${r.at}</td>` +
      `<td${v(r.now)}>${r.now === null ? '—' : r.now}</td>` +
      // No `title`: on a phone js/touch-titles.js would open it over the preview.
      `<td class="dr-diff${h ? ` ${h.cls}` : ''}"${v(r.diff)}>` +
      (r.diff === null ? '—' : whyHtml(r, `${signed(r.diff)}${heatMarkHtml(h)}`)) + '</td></tr>';
  }).join('');
  resort($('teamTable'));

  // The picked team's column on the board.
  for (const el of $('draftBoard').querySelectorAll('[data-team]')) {
    if (el.tagName !== 'BUTTON') el.classList.toggle('dr-mine', same(el.dataset.team, review.teamId));
  }
}

function pickTeam(id) {
  const w = review.world;
  const t = w && (w.teams || []).find((x) => same(x.id, id));
  if (!t || w.empty) return;
  review.teamId = t.id;
  prefs.set(`team.${review.leagueKey}`, t.id);
  $('teamSelect').value = String(t.id);
  closePop();
  // Only the team's own panel is redrawn; the board keeps its cells.
  drawTeam();
}

// ------------------------------------------- where a difference comes from
//
// The house pattern (the Stats page's, as copied by Decisions): a mouse hovers
// or focuses a number and gets a card beside it; a finger has no hover, so a
// tap opens a sheet with a Close button. A tap outside or Escape shuts either.

let pop = null;
let popPid = null;

function closePop() {
  if (pop) pop.hidden = true;
  popPid = null;
}

function popHtml(pid) {
  const w = review.world;
  const r = w && !w.empty && w.rv.rows.find((x) => same(x.playerId, pid));
  if (!r) return '';
  const auction = w.draft.type === 'auction';
  const line = (k, v) => `<tr><td class="name">${k}</td><td class="num">${v}</td></tr>`;
  const said = r.diff === null ? '' : r.diff > 0 ? 'Steal' : r.diff < 0 ? 'Miss' : 'Even';
  return `<div class="op-h">${esc(nameOf(r))}${r.position ? ` <span class="muted">· ${esc(posSaid(r.position))}</span>` : ''}</div>` +
    '<table><tbody>' +
    line('Points so far', fmt(r.soFar)) +
    line('Projected rest', fmt(r.rest)) +
    (auction ? line('Paid', `$${r.bid}`) + line('Price rank', r.at) : line('Drafted', `Pick ${r.at}`)) +
    (r.keeper ? line('Keeper', 'Yes') : '') +
    line('Worth now', r.now === null ? '—' : `Pick ${r.now}`) +
    '</tbody>' +
    (said ? `<tfoot><tr class="op-gap"><td class="name">${said}</td><td class="num">${signed(r.diff)}</td></tr></tfoot>` : '') +
    '</table><button type="button" class="op-close">Close</button>';
}

function openPop(el, sheet) {
  const html = popHtml(el.dataset.pid);
  if (!html) return;
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'drPop';
    document.body.appendChild(pop);
    pop.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.op-close')) closePop(); });
  }
  popPid = el.dataset.pid;
  pop.className = sheet ? 'dr-pop sheet' : 'dr-pop';
  pop.innerHTML = html;
  pop.hidden = false;
  pop.style.left = '';
  pop.style.top = '';
  if (sheet || typeof el.getBoundingClientRect !== 'function') return;
  const r = el.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
  const below = r.bottom + 6;
  pop.style.left = `${left}px`;
  pop.style.top = `${below + ph <= window.innerHeight - 8 ? below : Math.max(8, r.top - ph - 6)}px`;
}

function wirePop(root) {
  const target = (e) => (e.target && e.target.closest ? e.target.closest('.dr-why') : null);
  const noHover = () => !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  const within = (e, el) => Boolean(e.relatedTarget && el.contains(e.relatedTarget));
  const open = (el) => Boolean(pop && !pop.hidden && same(popPid, el.dataset.pid));
  root.addEventListener('mouseover', (e) => {
    const el = target(e);
    if (el && !noHover() && !within(e, el)) openPop(el, false);
  });
  root.addEventListener('mouseout', (e) => {
    const el = target(e);
    if (el && !noHover() && !within(e, el)) closePop();
  });
  root.addEventListener('click', (e) => {
    const el = target(e);
    if (!el) return;
    if (noHover() && open(el)) closePop(); else openPop(el, noHover());
  });
  root.addEventListener('keydown', (e) => {
    const el = target(e);
    if (!el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    openPop(el, noHover());
  });
  root.addEventListener('focusin', (e) => {
    const el = target(e);
    if (el && !noHover() && !open(el)) openPop(el, false);
  });
  root.addEventListener('focusout', () => { if (!noHover()) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  document.addEventListener('click', (e) => {
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target) || target(e)) return;
    closePop();
  });
}

// ------------------------------------------------------------------- controls

/** "Our draft" or the draft room. Remembered when picked on the switch, so a refresh mid-draft stays in the room. */
function showView(view, remember = true) {
  const room = view === 'room';
  $('reviewView').classList.toggle('hidden', room);
  $('roomView').classList.toggle('hidden', !room);
  for (const b of $('viewToggle').querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === (room ? 'room' : 'review'));
  if (remember) prefs.set('view', room ? 'room' : null);
  if (room) closePop();
}

function paintSource() {
  for (const b of $('sourceToggle').querySelectorAll('button')) b.classList.toggle('on', b.dataset.src === review.source);
}

// One load at a time: the connection bar can announce a league while the page
// is already reading one.
let reviewLoading = false;
// Whether the reader chose a source by hand this page load (the Decisions rule).
let sourcePicked = false;

async function selectSource(src) {
  if (reviewLoading) return;
  reviewLoading = true;
  try {
    if (await loadReview(src)) {
      review.source = src;
      prefs.set('source', src);
    }
  } finally {
    reviewLoading = false;
  }
  paintSource();
}

/** The remembered source, but never a blank page: a failed read keeps its reason over the sample. */
async function startReview() {
  if (prefs.get('source') === 'live' && savedConfig()) {
    reviewLoading = true;
    try {
      if (await loadReview('live')) { review.source = 'live'; return; }
      const why = $('sourceStatus').innerHTML;
      await loadReview('demo');
      review.source = 'demo';
      setStatus(`${why} Showing demo data instead.`, true);
    } finally {
      reviewLoading = false;
      paintSource();
    }
    return;
  }
  await loadReview('demo');
  review.source = 'demo';
  paintSource();
}

function initReview() {
  $('viewToggle').addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('button[data-view]');
    if (btn) showView(btn.dataset.view);
  });
  $('sourceToggle').addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('button[data-src]');
    if (!btn) return;
    sourcePicked = true;
    selectSource(btn.dataset.src);
  });
  $('teamSelect').addEventListener('change', (e) => pickTeam(e.target.value));
  $('draftBoard').addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('button.dr-pick-team');
    if (btn) pickTeam(btn.dataset.team);
  });
  enableSort($('teamTable'), { defaultIndex: 4, defaultAsc: false });
  wirePop($('reviewView'));
  wireTips($('reviewView'));

  showView(prefs.get('view') === 'room' ? 'room' : 'review');
  paintSource();
  startReview();

  // The connection bar probes in the background, so a league arriving after the
  // page has booted is the normal case.
  let triedLive = false;
  onConnection((conn) => {
    if (!conn) return;
    if (triedLive || sourcePicked || review.source === 'live') return;
    triedLive = true;
    selectSource('live');
  });
}

initReview();
init();
