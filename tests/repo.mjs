// Where the site lives, worked out from this file rather than hard-coded.
//
// tests/ sits one level below the repo root, so the root is simply the parent
// of this directory. Every suite imports REPO from here instead of carrying a
// literal C:/Users/... path, which is what used to tie them to one machine.
//
// The repo path contains SPACES ("Code Projects/Fantasy Football"), so any
// file:// URL must be built with pathToFileURL — string-concatenating a path
// into 'file:///' + p produces a URL Node cannot import.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Absolute path of this tests/ directory. */
export const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the repo root (the directory holding index.html and js/). */
export const REPO = path.dirname(HERE);

/** Absolute path of a repo-relative file, e.g. repoFile('js/espn.js'). */
export const repoFile = (rel) => path.join(REPO, rel);

/** Importable file:// URL for a repo-relative module, spaces handled. */
export const moduleUrl = (rel) => pathToFileURL(repoFile(rel)).href;
