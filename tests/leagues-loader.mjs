// Same idea as start-loader.mjs: the menu page's `./leagues.js` is redirected
// at the stub beside this file (leagues-stub.mjs), so leagues.html can be
// booted with a list a test chose and with nothing read from storage or ESPN.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo path contains spaces, so the URL -> path conversion must go
// through fileURLToPath; hand-stripping the leading slash leaves %20 behind.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEAGUES = pathToFileURL(path.join(HERE, 'leagues-stub.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && /\/leagues\.js$/.test(spec)) return next(LEAGUES, ctx);
  return next(spec, ctx);
}
