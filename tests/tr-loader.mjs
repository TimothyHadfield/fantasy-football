// Redirect js/season.js to the Trade page's stub. Only RELATIVE specifiers are
// rewritten, so nothing outside the page's own imports is touched.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo path contains spaces, so the URL -> path conversion must go through
// fileURLToPath; hand-stripping the leading slash leaves %20 behind.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEASON = pathToFileURL(path.join(HERE, 'tr-stub-season.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && /\/season\.js$/.test(spec)) return next(SEASON, ctx);
  return next(spec, ctx);
}
