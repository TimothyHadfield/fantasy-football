// For test-capture.mjs and cross-sim-check.mjs: point the page modules at
// cap-stub-season.mjs instead of js/season.js, and at cap-record-forecast.mjs
// instead of js/forecast.js, so every call a page makes to simulateSeason is
// recorded with its arguments.
//
// Only RELATIVE specifiers are rewritten, and never for an importer inside
// tests/ — the wrapper itself imports the real ../js/forecast.js, and
// rewriting that would point it back at itself (see fc-loader.mjs).
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEASON = pathToFileURL(path.join(HERE, 'cap-stub-season.mjs')).href;
const FORECAST = pathToFileURL(path.join(HERE, 'cap-record-forecast.mjs')).href;
const TESTS = pathToFileURL(HERE).href + '/';

export async function resolve(spec, ctx, next) {
  const fromTests = ctx.parentURL && ctx.parentURL.startsWith(TESTS);
  if (spec.startsWith('.') && !fromTests) {
    if (/\/season\.js$/.test(spec)) return next(SEASON, ctx);
    if (/\/forecast\.js$/.test(spec)) return next(FORECAST, ctx);
  }
  return next(spec, ctx);
}
