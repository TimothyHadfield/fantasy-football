// NOTIFICATIONS — the page (notifications.html).
//
// Tim, 2026-10-11: "a notifications section which basically helps the user with
// basic instrucitons or important issues or upcoming decisions … for the easy
// ones like the weekly lineup, make it so you just have to click a button to
// automatically change it for your team, or bring you to the specific player on
// the waivers, or the trade notification on the cite."
//
// ONE LIST, most urgent first, under three short headings; each line is a few
// words and ONE button. What the lines are is js/notify.js (pure) and where
// their numbers come from is js/notify-load.js; this file only draws them and
// works the lineup button.
//
// THE LINEUP BUTTON. With the bridge extension allowed to set a lineup
// (`bridge.canSetLineup()`, off by default in the extension's popup) the button
// changes it on ESPN in one click, then THE ROSTER IS READ AGAIN and the line
// goes only when ESPN shows the change. Everywhere else — a phone, the switch
// off, any failure — the button is a plain link to ESPN's own lineup screen.
//
// A line disappears when its cause does: no dismiss, no read mark.

import * as bridge from './bridge.js';
import { onConnection, savedConfig } from './connection.js';
import { load } from './notify-load.js';
import { LEVELS } from './notify.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The three headings, in the list's order. */
const HEADINGS = { now: 'This week', soon: 'Coming weeks', idea: 'Ideas' };

/** The one sentence of a state with no list. (The sample league says so in its badge.) */
const SENTENCES = {
  past: 'An earlier season: it is finished, so there is nothing to do.',
  over: 'This season is over, so there is nothing to do.',
  noteam: 'Choose your team under “You are” in the bar above.',
};

const view = {
  /** What js/notify-load.js last handed over. */
  state: null,
  /** May the extension set a lineup? Asked once; false until it says yes. */
  canWrite: false,
  /** The line whose lineup is being changed right now (its id), or null. */
  working: null,
  /** Lines whose change did not go through: they fall back to the link. */
  failed: new Set(),
  /** `leagueId|season|teamId` of the run on screen, so the bar's hello does not start a second one. */
  key: null,
};

const outside = (href) => /^https?:/i.test(String(href || ''));

function buttonHtml(note) {
  const a = note.action || {};
  const lineup = a.lineup && view.canWrite && !view.failed.has(note.id) ? a.lineup : null;
  if (lineup) {
    const busy = view.working === note.id;
    return `<button type="button" class="nt-go primary" data-lineup="${esc(note.id)}"` +
      `${view.working ? ' disabled' : ''}>${busy ? 'Changing…' : esc(lineup.label || 'Change it')}</button>`;
  }
  if (!a.href) return '';
  const out = outside(a.href) ? ' target="_blank" rel="noopener"' : '';
  return `<a class="nt-go" href="${esc(a.href)}"${out}>${esc(a.label)}</a>`;
}

function rowHtml(note) {
  const failed = view.failed.has(note.id);
  return `<div class="nt-row nt-${esc(note.level)}" data-note="${esc(note.id)}" data-kind="${esc(note.kind)}">
    <span class="nt-title">${esc(note.title)}</span>
    <span class="nt-detail${failed ? ' nt-bad' : ''}">${esc(failed ? 'Could not change it' : note.detail)}</span>
    ${buttonHtml(note)}
  </div>`;
}

function draw() {
  const s = view.state;
  const badge = $('modeBadge');
  const say = $('ntSay');
  const list = $('ntList');
  if (!s) return;

  const live = !s.isDemo;
  badge.className = 'badge ' + (live ? 'live' : 'demo');
  badge.textContent = live ? 'Live' : 'Demo';

  const sentence = s.status === 'error'
    ? `${s.error || 'The league could not be read.'}`
    : SENTENCES[s.status] || '';
  say.textContent = sentence;
  say.hidden = !sentence;
  say.classList.toggle('nt-bad', s.status === 'error');

  const notes = s.notes || [];
  let html = '';
  for (const level of LEVELS) {
    const mine = notes.filter((n) => n.level === level);
    if (!mine.length) continue;
    html += `<div class="nt-group" data-level="${level}">${HEADINGS[level]}</div>` + mine.map(rowHtml).join('');
  }
  // The coming weeks and the wire arrive after the first lines.
  if (s.pending) html += '<div class="nt-row nt-wait">Still checking…</div>';
  list.innerHTML = html;
  list.hidden = !html;
  list.setAttribute('data-state', s.pending ? 'pending' : 'done');
}

const keyOf = (c) => (c ? `${c.leagueId}|${c.season}|${c.teamId ?? ''}` : 'demo');

function show(state) {
  view.state = state;
  draw();
}

function run({ fresh = false } = {}) {
  return load({ onUpdate: show, fresh }).then((state) => {
    show(state);
    return state;
  });
}

/** One click: change it on ESPN, read the roster again, and believe only that. */
async function changeLineup(id) {
  const s = view.state;
  const note = s && (s.notes || []).find((n) => n.id === id);
  const lineup = note && note.action && note.action.lineup;
  if (!lineup || !s.league || view.working) return;
  view.working = id;
  draw();
  let ok = false;
  try {
    const res = await bridge.setLineup({
      leagueId: s.league.leagueId, season: s.league.season,
      week: lineup.week, teamId: lineup.teamId, moves: lineup.moves,
    });
    ok = Boolean(res && res.ok);
  } catch {
    ok = false;
  }
  let after = null;
  if (ok) {
    try { after = await run({ fresh: true }); } catch { after = null; }
  }
  view.working = null;
  // Still listed after the re-read (or never sent): ESPN does not show the
  // change, so the line stays and its button becomes the link.
  const gone = after && after.status === 'live' && !(after.notes || []).some((n) => n.id === id);
  if (!gone) view.failed.add(id);
  draw();
}

$('ntList').addEventListener('click', (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-lineup]') : null;
  if (btn) changeLineup(btn.getAttribute('data-lineup'));
});

// The bar's league, your team, or the season changed: work it out again. What
// is saved is what the bar is about to announce, so its first hello repeats
// what the page already read, and starts nothing.
view.key = keyOf(savedConfig());
onConnection((conn) => {
  const key = keyOf(conn);
  if (key === view.key) return;
  view.key = key;
  view.failed.clear();
  run();
});

// Sync now, or a roster move js/season.js noticed.
document.addEventListener('ff:refresh', (e) => {
  const job = run({ fresh: false });
  if (e.detail && typeof e.detail.waitUntil === 'function') e.detail.waitUntil(job);
});

// May the extension set a lineup? Until it answers yes, every lineup button is
// the link to ESPN — which is also what a phone always shows.
if (typeof bridge.canSetLineup === 'function' && typeof bridge.setLineup === 'function') {
  Promise.resolve()
    .then(() => bridge.canSetLineup())
    .then((yes) => {
      if (yes !== true) return;
      view.canWrite = true;
      draw();
    })
    .catch(() => { /* no: the links stay */ });
}

run();
