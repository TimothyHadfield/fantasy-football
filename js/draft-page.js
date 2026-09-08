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

init();
