// The demo league with ONE TIED GAME, for test-summary.mjs's `tie` scenario.
//
// The real demo season has no tie in any of its 65 games, so without this the
// record's "T" would never be drawn by any test. The first week-3 game is made
// level by giving the away side the home side's score. Everything else is the
// real demo, imported by absolute URL so the loader cannot redirect it again.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const real = await import(pathToFileURL(path.join(HERE, '..', 'js', 'demo.js')).href);

export const TIE_WEEK = 3;

export function generateDemoLeague(...args) {
  const d = real.generateDemoLeague(...args);
  const g = d.games.find((x) => x.week === TIE_WEEK);
  g.awayActual = g.homeActual;
  return d;
}
