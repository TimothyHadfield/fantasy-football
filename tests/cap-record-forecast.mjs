// js/forecast.js, with simulateSeason recording what it was asked.
//
// Everything is the real module; an explicit local export wins over the
// `export *` re-export, so only simulateSeason is wrapped. The arguments are
// kept on globalThis.__simCalls in a JSON-safe form (Maps as sorted entries),
// which is what lets two pages' calls be compared for equality.
export * from '../js/forecast.js';
import { simulateSeason as real } from '../js/forecast.js';

const entries = (m) =>
  m instanceof Map ? [...m].map(([k, v]) => [k, entries(v)]).sort((a, b) => a[0] - b[0]) : m;

export function simulateSeason(args) {
  const calls = (globalThis.__simCalls ||= []);
  calls.push({
    teamIds: args.teamIds,
    banked: entries(args.banked),
    games: args.games,
    sigma: args.sigma,
    runs: args.runs,
    seed: args.seed,
    playoff: args.playoff
      ? { teams: args.playoff.teams, weeks: args.playoff.weeks, proj: entries(args.playoff.proj) }
      : null,
  });
  return real(args);
}
