// One stub for the three modules js/playoffs-players.js reads a live league
// through (./season.js, ./espn.js, ./connection.js; po-live-loader.mjs
// redirects them for that importer only). Driven by globalThis.__po:
//   saved        what savedConfig() returns
//   listeners    the onConnection callbacks, for the test to call
//   calls        every season read, with the league espn was configured for
//   schedule(id) the schedule promise for league `id`
import { byeAdjustedProjection } from '../js/espn.js';

export { byeAdjustedProjection };

const po = () => (globalThis.__po ||= { calls: [], listeners: [] });
let config = { leagueId: 'OLD', season: 2026 };

// ./espn.js
export function configure(cfg) { config = { ...config, ...cfg }; }
export function getConfig() { return { ...config }; }

// ./connection.js
export function savedConfig() { return po().saved || null; }
export function onConnection(fn) { po().listeners.push(fn); }

// ./season.js
const log = (name) => po().calls.push(`${name}:${config.leagueId}`);
export function fetchPlayerValues() { log('fetchPlayerValues'); return Promise.resolve(null); }
export function fetchValueBase() { log('fetchValueBase'); return Promise.resolve(null); }
export function fetchSchedule() {
  log('fetchSchedule');
  const f = po().schedule;
  return f ? f(String(config.leagueId)) : Promise.resolve({ weeks: [] });
}
export async function fetchByeWeeks() { return {}; }
export async function fetchWeeksRosters() { log('fetchWeeksRosters'); return new Map(); }
export async function fetchWireWeek() { return []; }
