// VALUE MEASUREMENT — any players against any other players, by Value.
//
// Tim, 2026-10-12: "Add a "vlaue measurement" tool at the top middle of the
// custom trades box when you can search for any players traded to any other
// players and see how the value diff measurements line up. This is just for fun
// or personal use when you hear trades online and whatnot. Make sure the search
// is smart so if you just search "cook" for james cook III or whatever it will
// still come up and whatnot."
//
// Pure: the page hands in the players and their Values; nothing here reads a
// league or the document.

/** A name as the search reads it: lower case, no accents, no punctuation. */
export function normName(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')          // D'Andre = dandre, St. Brown = st brown, A.J. = aj
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** One edit apart (a letter wrong, missing, extra, or two swapped) — or equal. */
function nearly(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// How well one typed word fits one name: 0 = a whole word of it, 1 = the start
// of a word, 2 = inside a word, 3 = one slip away from the start of a word
// (only for a word long enough that a slip is not most of it). null = no fit.
function wordFit(word, parts) {
  let best = null;
  for (const p of parts) {
    let fit = null;
    if (p === word) fit = 0;
    else if (p.startsWith(word)) fit = 1;
    else if (p.includes(word)) fit = 2;
    else if (word.length >= 4 && (nearly(word, p.slice(0, word.length)) || nearly(word, p.slice(0, word.length + 1)) ||
      nearly(word, p.slice(0, word.length - 1)))) fit = 3;
    if (fit !== null && (best === null || fit < best)) best = fit;
  }
  return best;
}

/**
 * THE PLAYERS A SEARCH MEANS, best first.
 *
 * Every typed word has to fit the name somewhere, in any order, so "cook" finds
 * James Cook III, "cook james" does too, and "j cook" does not find Dalvin. A
 * name typed run together ("jamescook") or with its dots and apostrophes left
 * out ("dandre", "aj brown") still fits, and so does one slipped letter
 * ("mahomse"). The position or the NFL team may be one of the words ("cook rb").
 * Ties go to the higher Value, then the name.
 *
 * @param {Array<{playerId:*, name:string, position?:string, team?:string, value?:number|null}>} players
 * @param {string} query
 * @param {{limit?:number, exclude?:Iterable}} [opts] `exclude`: playerIds to leave out
 * @returns {Array} the matching players (the same objects), best first
 */
export function searchPlayers(players, query, { limit = 8, exclude = [] } = {}) {
  const words = normName(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const out = new Set([...exclude].map(String));
  const joined = words.join('');
  const hits = [];
  for (const p of players || []) {
    if (!p || out.has(String(p.playerId))) continue;
    const name = normName(p.name);
    if (!name) continue;
    const parts = name.split(' ');
    const extra = [normName(p.position), normName(p.team)].filter(Boolean);
    let score = 0;
    let fits = true;
    let named = false;
    let slip = false;
    for (const w of words) {
      let fit = wordFit(w, parts);
      // A position or team word narrows the list; it never outranks a name.
      if (fit !== null) named = true;
      if (fit === 3) slip = true;
      else if (extra.includes(w)) fit = 1;
      if (fit === null) { fits = false; break; }
      score += fit;
    }
    if (!fits || !named) {
      // Run together: "jamescook", "stbrown".
      if (joined.length < 3 || !name.replace(/ /g, '').includes(joined)) continue;
      score = 2 * words.length;
    }
    hits.push({ p, score, slip });
  }
  // A slipped letter is a guess: it is only offered when nothing fits as typed
  // ("cook" is the Cooks, not Coker).
  const sure = hits.filter((h) => !h.slip);
  if (sure.length) hits.splice(0, hits.length, ...sure);
  const val = (p) => (typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : -Infinity);
  hits.sort((x, y) => x.score - y.score || val(y.p) - val(x.p) || String(x.p.name).localeCompare(String(y.p.name)));
  return hits.slice(0, limit).map((h) => h.p);
}

/**
 * HOW THE TWO SIDES LINE UP. Each total is the Values added up, to a tenth (a
 * man with no Value adds nothing); `diff` is the first side less the second.
 */
export function measure(valuesA, valuesB) {
  const r1 = (n) => { const r = Math.round(n * 10) / 10; return r === 0 ? 0 : r; };
  const sum = (list) => (list || []).reduce((t, v) => t + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0);
  const a = sum(valuesA), b = sum(valuesB);
  return { a: r1(a), b: r1(b), diff: r1(a - b) };
}
