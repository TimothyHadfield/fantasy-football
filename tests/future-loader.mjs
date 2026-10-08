// Swaps js/season.js for the stub named in FF_FUTURE_STUB, so future-check.mjs
// can boot a page against a synthetic league with no network at all.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo path contains spaces, so the URL -> path conversion must go
// through fileURLToPath (see opp-loader.mjs).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, process.env.FF_FUTURE_STUB || 'opp-season-stub.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (/(^|\/)season\.js$/.test(spec)) return next(STUB, ctx);
  return next(spec, ctx);
}
