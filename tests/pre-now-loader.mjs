// Swaps js/season.js for pre-now-stub-season.mjs, so the Stats page boots on
// the fixture league with no network (pre-now-check.mjs).
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo path contains spaces: go through fileURLToPath, never a hand-strip.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, 'pre-now-stub-season.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (/(^|\/)season\.js$/.test(spec)) return next(STUB, ctx);
  return next(spec, ctx);
}
