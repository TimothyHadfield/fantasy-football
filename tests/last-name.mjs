// A man's name AS A TRADE ROW PRINTS IT (Tim, 2026-10-12: "name the players as
// their lastname only"), written out again here rather than imported: the
// page's `lastNameOf` (js/trade-page.js) is not exported, and a test that
// borrowed it would agree with whatever it did.
//
// The rule, in the page's own words: a suffix (Jr./Sr./II/III/IV/V) is dropped,
// "St." stays with its name, a defence keeps its whole name, and two men in the
// same deal with the same last name get their first initial back.
//
// Not a suite: tr-test.mjs and test-notify-trades.mjs import it.

const SUFFIX = new Set(['jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv', 'v']);

/** The bare last name of one full name. */
export function bareLast(name) {
  const parts = String(name || '').trim().split(' ').filter(Boolean);
  while (parts.length > 1 && SUFFIX.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  if (parts.length < 2) return parts.join(' ');
  const tail = parts[parts.length - 1];
  const before = parts[parts.length - 2].toLowerCase();
  return (before === 'st.' || before === 'st') && parts.length > 2 ? `${parts[parts.length - 2]} ${tail}` : tail;
}

const isDefence = (full, position) => full.endsWith('D/ST') || position === 'DST' || position === 'D/ST';

/**
 * @param {string} full his full name
 * @param {Object} [opts]
 * @param {string} [opts.position] 'DST' / 'D/ST' keeps the whole name
 * @param {string[]} [opts.others] the full names of the OTHER men in the same
 *   deal (both sides); one sharing his last name gives him his initial back
 */
export function lastNameShown(full, { position = '', others = [] } = {}) {
  const name = String(full || '').trim();
  if (!name || isDefence(name, position)) return name;
  const mine = bareLast(name);
  return others.some((o) => bareLast(o) === mine) ? `${name.charAt(0)}. ${mine}` : mine;
}

/**
 * The name a `.man` element PRINTS, read off the DOM: what stands in his link
 * before his trend arrow, position tag and number, without the words kept for
 * a screen reader. (The page writes no space between the name and the tag, so
 * the man's whole text cannot be cut apart afterwards: "RB1RB17.0/wk".)
 */
export function printedName(man) {
  const host = (man && man.querySelector('a.pref')) || man;
  if (!host) return '';
  const STOP = /\b(pp|val|trend|outlook|per)\b/;
  const read = (node) => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    const c = node.getAttribute('class') || '';
    if (/\bsr-only\b/.test(c)) return '';
    return [...node.childNodes].map(read).join('');
  };
  let out = '';
  for (const node of host.childNodes) {
    if (node.nodeType === 1 && STOP.test(node.getAttribute('class') || '')) break;
    out += read(node);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Every man of one deal, as its row prints them: `[{name, position}] → [shown]`. */
export function shownNames(men) {
  return men.map((p, i) => lastNameShown(p.name, {
    position: p.position,
    others: men.filter((_, j) => j !== i).map((q) => q.name),
  }));
}
