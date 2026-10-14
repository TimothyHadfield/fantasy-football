// HIS BYE IS BEHIND HIM: a green name.
//
// Tim, 2026-10-11 (Trade): "highlight any opposing team's players in green in
// the custome trade box if they have already had their BYE week".
// Tim, 2026-10-14 (Players): "also in the players section highlight a players
// name in green if they've already had their bye week just like in the trade
// section".
//
// The rule is the Trade page's (`byePastMarkOf` in js/trade-page.js): his NFL
// team's KNOWN bye (js/player-card.js `byeWeekOf`) falls before the first week
// still to come. An unknown bye marks nobody. The markup is the Trade page's
// `bye-hl bye-past` pill on the NAME only, never the cell, so it cannot be read
// as the heat scale; the CSS sits with each page (trade.html, waivers.html).
//
// Pure: a page hands in the bye and its own "first week still to come".
// (js/trade-page.js still carries its own copy of the rule; it can import this.)

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {number|null} bye  his NFL team's bye week, or null when unknown
 * @param {number|undefined} next the first week still to come
 * @returns {{cls:'bye-past', words:string, sr:string}|null}
 */
export function byePastOf(bye, next) {
  if (!Number.isFinite(bye) || !Number.isFinite(next) || !(bye < next)) return null;
  return { cls: 'bye-past', words: `Bye already played (week ${bye})`, sr: ` (bye already played, week ${bye})` };
}

/**
 * The name inside its pill, with the words for a screen reader inside it (the
 * pill is `position: relative`, so the sr-only span cannot escape a scroll box).
 * `nameHtml` is already escaped. With no mark, the name as it was.
 */
export function byePastHtml(nameHtml, mark) {
  if (!mark) return nameHtml;
  return `<span class="bye-hl ${mark.cls}">${nameHtml}<span class="sr-only">${escHtml(mark.sr)}</span></span>`;
}

export const hasByePast = (html) => /\bbye-past\b/.test(html || '');
