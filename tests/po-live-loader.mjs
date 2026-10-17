// For js/playoffs-players.js only: ./season.js, ./espn.js and ./connection.js
// go to po-live-stub.mjs. Every other importer gets the real modules.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, 'po-live-stub.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (ctx.parentURL && /\/js\/playoffs-players\.js$/.test(ctx.parentURL)
    && ['./season.js', './espn.js', './connection.js'].includes(spec)) {
    return next(STUB, ctx);
  }
  return next(spec, ctx);
}
