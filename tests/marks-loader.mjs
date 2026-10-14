// Same idea as start-loader.mjs, but season.js is redirected at the stub that
// sets every man's season average (marks-stub-season.mjs).
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEASON = pathToFileURL(path.join(HERE, 'marks-stub-season.mjs')).href;
const ESPN = pathToFileURL(path.join(HERE, 'wv-stub-espn.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.')) {
    // The stub's own import of start-stub-season.mjs goes through untouched;
    // only the page's season.js is redirected.
    if (/\/season\.js$/.test(spec)) return next(SEASON, ctx);
    if (/\/espn\.js$/.test(spec)) return next(ESPN, ctx);
  }
  return next(spec, ctx);
}
