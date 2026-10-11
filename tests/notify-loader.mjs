// For notify-check.mjs: js/season.js is redirected at notify-stub-season.mjs
// (a league whose own team has one of every kind of line), and js/bridge.js at
// notify-stub-bridge.mjs (the real module, plus the extension's lineup switch
// under the scenario's control).
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo path contains spaces, so the URL -> path conversion must go
// through fileURLToPath; hand-stripping the leading slash leaves %20 behind.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEASON = pathToFileURL(path.join(HERE, 'notify-stub-season.mjs')).href;
const BRIDGE = pathToFileURL(path.join(HERE, 'notify-stub-bridge.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.')) {
    if (/\/season\.js$/.test(spec)) return next(SEASON, ctx);
    // The stub re-exports the real module: its own import is left alone.
    if (/\/bridge\.js$/.test(spec) && ctx.parentURL !== BRIDGE) return next(BRIDGE, ctx);
  }
  return next(spec, ctx);
}
