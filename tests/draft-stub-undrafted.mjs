// The men on the real league's squads whom NOBODY DRAFTED, for "Own now"
// (Tim, 2026-10-22: "because the players that user currently owns might've been
// undrafted, list them at the very bottom under that user's collumn bellow the
// last round of the draft").
//
// fixtures/draft-players-1241838-2026.json holds the 170 drafted men only, so
// its squads are short: 151 men held on 19-man rosters (two of them IR). A real
// squad carries about 17, the gap filled from waivers. This tops each team up
// to 17 with real men ESPN projected before the season and nobody drafted —
// the best-projected of them in data/baselines/2026-preseason.json, in order —
// so team 7 (9 drafted men held) gets 8, team 3 (13) gets 4, teams 5 and 6
// (18, 17) none: 20 in all (positions in turn, below). Each week's projection
// is his preseason projection a game; a finished week scored exactly that.
//
// Used by draft-stub-season.mjs when DR_UNDRAFTED=1, and by the suites to work
// out what the page should show.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HERE, REPO } from './repo.mjs';

const FX = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-players-1241838-2026.json'), 'utf8'));
const BL = JSON.parse(readFileSync(path.join(REPO, 'data/baselines/2026-preseason.json'), 'utf8'));
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
const SQUAD = 17;

const held = new Map();
for (const p of Object.values(FX.players)) if (p.onTeamId > 0) held.set(p.onTeamId, (held.get(p.onTeamId) || 0) + 1);
/** One entry a place to fill, team by team in the fixture's order. */
const places = FX.teams.flatMap((t) => Array(Math.max(0, SQUAD - (held.get(t.id) || 0))).fill(t.id));

// Waiver pickups are mostly backs and receivers: the best left at each
// position in turn — RB, WR, RB, WR, TE, QB, K, D/ST — and round again.
const TURN = ['RB', 'WR', 'RB', 'WR', 'TE', 'QB', 'K', 'DST'];
const byPos = new Map(TURN.map((p) => [p, []]));
for (const e of Object.entries(BL.players)
  .filter(([id, b]) => !(id in FX.players) && POS[b.p] && b.g > 0 && b.t > 0)
  .sort((a, b) => b[1].t - a[1].t || Number(a[0]) - Number(b[0]))) byPos.get(POS[e[1].p]).push(e);
const pool = places.map((_, i) => byPos.get(TURN[i % TURN.length]).shift());

/** `{ [playerId]: { name, position, proTeamId, injuryStatus, onTeamId, weeks } }`, the fixture's own shape. */
export const UNDRAFTED = Object.fromEntries(places.map((teamId, i) => {
  const [id, b] = pool[i];
  const a = Math.round((b.t / b.g) * 100) / 100;
  const weeks = Object.fromEntries(FX.weeks.map((w) => [w, [a, FX.finished.includes(w) ? a : null]]));
  return [id, { name: b.n, position: POS[b.p], proTeamId: null, injuryStatus: 'ACTIVE', onTeamId: teamId, weeks }];
}));
