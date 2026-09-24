/**
 * How a child scenario hands its answer back — synchronously, because
 * `process.exit` throws away whatever is still sitting in the pipe.
 *
 * Every suite here runs its scenarios as child processes: the child prints one
 * `@@`-prefixed JSON line and exits, the parent finds that line and parses it.
 * On POSIX a pipe is an ASYNC stream, so `console.log` of a big line only
 * QUEUES the write, and `process.exit()` on the next statement kills the
 * process with most of the line unwritten. The parent then reads half a line,
 * `JSON.parse` throws, and node prints the truncated JSON as the offending
 * source: three lines, no assertion, no clue what failed.
 *
 * On Windows stdout to a pipe is synchronous, so this never happens locally —
 * which is exactly how it was found. tr-test passed on Windows on node 22 and
 * 24, and failed on every GitHub Linux run (2026-09-23), with scenario payloads
 * of 148-227 KB against a 64 KB pipe buffer.
 *
 * `writeSync` against fd 1 returns only once the bytes are gone, and the loop
 * is there because a write to a pipe may be partial. The exit stays explicit: a
 * scenario can leave a timer pending, and a suite that hangs is worse than one
 * that exits.
 *
 * @param {*} payload    anything JSON-serialisable; the parent parses it
 * @param {number} code  exit status — 0 for a scenario that passed
 */
import { writeSync } from 'node:fs';

export function emit(payload, code = 0) {
  const buf = Buffer.from(`@@${JSON.stringify(payload)}\n`, 'utf8');
  let off = 0;
  while (off < buf.length) off += writeSync(1, buf, off, buf.length - off);
  process.exit(code);
}
