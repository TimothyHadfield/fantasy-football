// js/espn.js for draft-review-check.mjs: the real module, with the two reads
// the "Our draft" view makes answered from the fixtures and COUNTED
// (`globalThis.__dr`). Everything else — `parsePlayerWeek`,
// `byeAdjustedProjection`, `configure`, the slot tables — is the real code.
//
//   fetchDraft()          ESPN's mDraftDetail payload, as captured
//   fetchPlayersWeek()    raw `players[]` entries in kona_player_info's shape,
//                         so the page decodes them with the real parser

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// (The loader leaves an import made from tests/ alone, so this is the real one.
// The three functions exported by name below win over its own.)
export * from '../js/espn.js';

const DRAFT = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-1241838-2026.json'), 'utf8'));
const FX = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-players-1241838-2026.json'), 'utf8'));
const POS_ID = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DST: 16 };

// ESPN's preseason PPR rank of each of the 170, as kona_player_info sent them on 2026-10-08.
const RANKS = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-ranks-1241838-2026.json'), 'utf8')).ranks;

const calls = (globalThis.__dr = globalThis.__dr || { draft: 0, players: 0, playerIds: 0, schedule: 0, squads: 0, byes: 0, ranks: 0, rankIds: 0 });

export async function fetchDraftRanks(ids) {
  calls.ranks++;
  calls.rankIds += ids.length;
  const out = {};
  for (const id of ids) if (RANKS[id] > 0) out[id] = RANKS[id];
  return out;
}

export async function fetchDraft() {
  calls.draft++;
  const raw = JSON.parse(JSON.stringify(DRAFT));
  // DR_SNAKE=1: the same men in the same order, as a snake would send them.
  if (process.env.DR_SNAKE === '1') {
    raw.settings.draftSettings.type = 'SNAKE';
    for (const p of raw.draftDetail.picks) p.bidAmount = 0;
  }
  // DR_EMPTY=1: the league before it has drafted — ESPN sends no picks.
  if (process.env.DR_EMPTY === '1') {
    raw.draftDetail.picks = [];
    raw.draftDetail.drafted = false;
  }
  return raw;
}

export async function fetchPlayersWeek(ids, week) {
  calls.players++;
  calls.playerIds += ids.length;
  const out = [];
  for (const id of ids) {
    const p = FX.players[id];
    if (!p) continue;
    const [projected, actual] = p.weeks[week] || [null, null];
    const stats = [];
    const line = (statSourceId, appliedTotal) => stats.push({
      statSourceId, statSplitTypeId: 1, scoringPeriodId: Number(week), appliedTotal, proTeamId: p.proTeamId,
    });
    if (projected !== null) line(1, projected);
    if (actual !== null) line(0, actual);
    out.push({ id: Number(id), onTeamId: 0, player: { id: Number(id), fullName: p.name, defaultPositionId: POS_ID[p.position], proTeamId: p.proTeamId, stats } });
  }
  return out;
}

// The connection bar's probe: no league answers in the harness.
export async function fetchLeague() {
  throw new Error('no network in the harness');
}
