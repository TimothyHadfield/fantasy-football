// For bell-check.mjs: the top bar's lazy `./notify-load.js` is redirected at
// bell-stub.mjs beside this file — or, with BELL_MISSING=1, at a file that is
// not there, which is what a browser sees while the loader has not shipped.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo path contains spaces, so URLs are built with pathToFileURL.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, 'bell-stub.mjs')).href;
const MISSING = pathToFileURL(path.join(HERE, 'bell-not-there.mjs')).href;

export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && /\/notify-load\.js$/.test(spec)) {
    return next(process.env.BELL_MISSING ? MISSING : STUB, ctx);
  }
  return next(spec, ctx);
}
