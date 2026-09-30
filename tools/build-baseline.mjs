#!/usr/bin/env node
// Build data/baselines/2026-preseason.json — ESPN's PRESEASON projection, kept.
//
// WHY THIS EXISTS (2026-09-29). Tim: "put a up or down arrow by that player's
// name if their rest-of-season proj/week has increased or decreased by more
// than 2 than it was at the begginning of the season." ESPN keeps no history of
// its own projections (rule 8): the season split `102026` is overwritten with
// the rest-of-season projection as the weeks go by, so "the beginning of the
// season" cannot be read from ESPN any more. A Wayback Machine copy of ESPN's
// own player feed from 9 September 2026 — the day before kickoff — still has
// it, with every player's RAW projected stats, so it can be re-scored under any
// league's rules. This script turns that copy into a small static file, once.
// The site reads the file; it never fetches Wayback.
//
//   node tools/build-baseline.mjs                 -> download the capture
//   node tools/build-baseline.mjs <capture.json>  -> use a copy already saved
//
// WHAT IS KEPT, per player id: `p` defaultPositionId (scoring overrides are
// keyed by it), `g` projected games (stat 210), `s` the raw projected stats,
// `t` ESPN's own default-PPR `appliedTotal` (the check that re-scoring is
// right: tests/test-proj-trend.mjs re-scores with ESPN's default rules and must
// land on it), and `n` the name, for reading the file by hand.
//
// WHICH STATS: every stat id a league's scoring could use. That is any raw stat
// ESPN projects, so all of them are kept except `210` (games, kept as `g`) and
// the zeros. Values are rounded to 4 significant figures — a re-scored total
// moves by well under 0.1. Only players with a season projection above zero are
// kept (501 of the capture's 1,036): 222 KB, 74 KB gzipped as Pages serves it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_URL =
  'https://web.archive.org/web/20260909134305id_/https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/247693678?view=kona_player_info_edit_draft_strategy&platformVersion=0155a883398e9b366a9297c29085da9a89ac2192';
export const CAPTURED = '2026-09-09';
const SEASON_SPLIT = '102026';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'data', 'baselines', '2026-preseason.json');

const round = (v) => {
  if (!Number.isFinite(v) || v === 0) return 0;
  return Number(v.toPrecision(4));
};

async function readCapture(arg) {
  if (arg) return JSON.parse(fs.readFileSync(arg, 'utf8'));
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Wayback answered ${res.status}`);
  return res.json();
}

export function buildBaseline(capture) {
  const players = {};
  let seen = 0;
  for (const e of capture.players || []) {
    const p = e && e.player;
    if (!p || p.id === undefined) continue;
    seen++;
    const split = (p.stats || []).find(
      (s) => s.id === SEASON_SPLIT && s.statSourceId === 1 && s.statSplitTypeId === 0
    );
    if (!split || !split.stats) continue;
    const games = Number(split.stats['210']);
    if (!(games > 0) || !(split.appliedTotal > 0)) continue;
    const s = {};
    for (const [id, v] of Object.entries(split.stats)) {
      if (id === '210') continue;
      const r = round(Number(v));
      if (r !== 0) s[id] = r;
    }
    players[p.id] = {
      n: p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim(),
      p: p.defaultPositionId,
      g: games,
      t: Math.round(split.appliedTotal * 100) / 100,
      s,
    };
  }
  return {
    about:
      'ESPN\'s preseason projection for the 2026 season, raw stats per player, from a Wayback ' +
      'Machine copy of ESPN\'s own player feed captured the day before kickoff. Built by ' +
      'tools/build-baseline.mjs. p = defaultPositionId, g = projected games (stat 210), ' +
      't = ESPN default-PPR appliedTotal, s = raw projected stats (stat id -> value).',
    source: SOURCE_URL,
    captured: CAPTURED,
    season: 2026,
    playersInCapture: seen,
    players,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const capture = await readCapture(process.argv[2]);
  const out = buildBaseline(capture);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(out);
  fs.writeFileSync(OUT, json + '\n');
  console.log(`${Object.keys(out.players).length} players of ${out.playersInCapture} -> ${OUT} (${json.length} bytes)`);
}
