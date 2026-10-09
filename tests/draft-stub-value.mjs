// Player Value for the draft suites (docs/value-plan.md, "Wave 2b"): what
// js/season.js `fetchPlayerValues()` would hand the Draft page for the real
// league the fixtures were captured from (1241838), worked out from the same
// fixtures — and the review js/draft-review.js should make of it.
//
//   BASE      the league's frozen lines AS ITS OWN BROWSER MADE THEM: read off
//             `localStorage['ff.value.1241838-2026']` on 2026-10-09 (week 5,
//             three free agents a position), js/value.js `buildBase`'s shape.
//   WEEKS     the weeks left on the fixtures' day: 5 to 17.
//   VALUES    every man somebody holds (`onTeamId` > 0): his average over those
//             weeks and his Value — `{ base, weeks, players }`, the shape
//             draft-stub-season.mjs takes in `globalThis.__ffValue` / FF_VALUE.
//             The 19 men nobody holds are NOT in it: the page works theirs out.
//   nowOf     any drafted man's Value today, by the same arithmetic (a man
//             ESPN projects nothing: 0).
//   preOf     ESPN's preseason projection a game, from the repo's own
//             data/baselines/2026-preseason.json under ESPN's default PPR —
//             the scoring draft-stub-season.mjs's schedule carries.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HERE, moduleUrl } from './repo.mjs';

const V = await import(moduleUrl('js/value.js'));
const T = await import(moduleUrl('js/proj-trend.js'));
const FX = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-players-1241838-2026.json'), 'utf8'));

export const BASE = {
  v: 1, setAt: 1791531868190, week: 5,
  lines: {
    QB: { waiver: 16.65, starter: 18.09, agents: 3, starters: 10 },
    RB: { waiver: 6.17, starter: 10.28, agents: 3, starters: 28 },
    WR: { waiver: 8.34, starter: 9.85, agents: 3, starters: 30 },
    TE: { waiver: 8.75, starter: 10.29, agents: 3, starters: 12 },
    K: { waiver: 9.03, starter: 9.03, agents: 3, starters: 10 },
    DST: { waiver: 5.64, starter: 5.64, agents: 3, starters: 10 },
  },
};
export const WEEKS = FX.weeks.filter((w) => !FX.finished.includes(w));

const avgOf = (p) => V.restAvg(Object.fromEntries(WEEKS.map((w) => [w, (p.weeks[w] || [null])[0]])), WEEKS, null);

/** A drafted man's Value today (0 when ESPN projects him nothing); null for a man not in the fixtures. */
export function nowOf(id) {
  const p = FX.players[id];
  return p ? V.valueOf(BASE, p.position, avgOf(p)) ?? 0 : null;
}

export const VALUES = {
  base: BASE,
  weeks: WEEKS,
  players: Object.fromEntries(Object.entries(FX.players).filter(([, p]) => p.onTeamId > 0)
    .map(([id, p]) => [id, { position: p.position, avg: avgOf(p), value: V.valueOf(BASE, p.position, avgOf(p)) }])),
};

await T.loadBaseline();
/** ESPN's preseason projection a game under default PPR, or null for a man not in the file. */
export function preOf(id) {
  const b = T.baselineOf(id, T.DEFAULT_PPR);
  return b ? b.total / b.games : null;
}

/** What `reviewDraft` takes as `worth`. */
export const WORTH = { base: BASE, now: nowOf, pre: preOf };
