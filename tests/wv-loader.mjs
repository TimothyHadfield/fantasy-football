// Redirect the two modules that would otherwise touch the network. Only
// RELATIVE specifiers are rewritten, so the stubs' own absolute imports of the
// real files are left alone.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo path contains spaces, so the URL -> path conversion must go
// through fileURLToPath; hand-stripping the leading slash leaves %20 behind.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEASON = pathToFileURL(path.join(HERE, 'wv-stub-season.mjs')).href;
const ESPN = pathToFileURL(path.join(HERE, 'wv-stub-espn.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.')) {
    if (/\/season\.js$/.test(spec)) return next(SEASON, ctx);
    if (/\/espn\.js$/.test(spec)) return next(ESPN, ctx);
  }
  return next(spec, ctx);
}
