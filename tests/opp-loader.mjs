// Swaps js/season.js for a stub so the stats page can be booted against a
// synthetic league with no network at all.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo path contains spaces, so the URL -> path conversion must go
// through fileURLToPath; hand-stripping the leading slash leaves %20 behind.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, 'opp-season-stub.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (/(^|\/)season\.js$/.test(spec)) return next(STUB, ctx);
  return next(spec, ctx);
}
