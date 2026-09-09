// Redirect the two modules that would otherwise touch the network. Only
// RELATIVE specifiers are rewritten, and only when the importer is a real page
// module -- so the stubs' own imports of the real files are left alone.
//
// That second condition matters now the tests live inside the repo:
// fc-stub-espn.mjs re-exports the genuine ../js/espn.js, which IS a relative
// specifier ending in /espn.js. Without the importer check the loader would
// point the stub back at itself and the import would never terminate.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo path contains spaces, so the URL -> path conversion must go
// through fileURLToPath; hand-stripping the leading slash leaves %20 behind.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEASON = pathToFileURL(path.join(HERE, 'fc-stub-season.mjs')).href;
const ESPN = pathToFileURL(path.join(HERE, 'fc-stub-espn.mjs')).href;
const TESTS = pathToFileURL(HERE).href + '/';

export async function resolve(spec, ctx, next) {
  const fromTests = ctx.parentURL && ctx.parentURL.startsWith(TESTS);
  if (spec.startsWith('.') && !fromTests) {
    if (/\/season\.js$/.test(spec)) return next(SEASON, ctx);
    if (/\/espn\.js$/.test(spec)) return next(ESPN, ctx);
  }
  return next(spec, ctx);
}
