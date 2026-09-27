// Redirects the Summary page's `./demo.js` at sum-tie-demo.mjs (one tied game).
// Registered from inside test-summary.mjs's `tie` scenario, before the page is
// imported. Only the page's own import is redirected.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIE_DEMO = pathToFileURL(path.join(HERE, 'sum-tie-demo.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (spec === './demo.js' && /\/summary-page\.js$/.test(ctx.parentURL || '')) {
    return next(TIE_DEMO, ctx);
  }
  return next(spec, ctx);
}
