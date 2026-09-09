// Same idea as wv-loader.mjs, but season.js is redirected at the roster-serving
// stub instead of the empty one.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo path contains spaces, so the URL -> path conversion must go
// through fileURLToPath; hand-stripping the leading slash leaves %20 behind.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEASON = pathToFileURL(path.join(HERE, 'cmp-stub-season.mjs')).href;
const ESPN = pathToFileURL(path.join(HERE, 'wv-stub-espn.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.')) {
    if (/\/season\.js$/.test(spec)) return next(SEASON, ctx);
    if (/\/espn\.js$/.test(spec)) return next(ESPN, ctx);
  }
  return next(spec, ctx);
}
