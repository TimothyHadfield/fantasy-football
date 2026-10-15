// THE ORANGE AND RED BOXES IN THE CUSTOM TRADE BUILDER.
//
// Tim, 2026-10-15: "when I'm clicking on and off players in the custom trade
// section, if there is a single player I can click on on either team that will
// make it so that the value is positive, the +/week for me is between +1 and
// +4, and the total is between 0 - +5, then fill that player's box in orange.
// Make sure it's not a player who's worth isn't 0, and will just keep all the
// numbers in the same range instead of actually making the trade better. If
// the current trade numbers are already in that range, keep the trade the
// same." And: "also don't highlight a player's box in orange if it's a player
// that was traded between those two teams already. Instead highlight that
// player's box in red."
//
// THE READING, each one a choice:
//   - "the value", "+/week for me" and "the total" are the three figures the
//     box prints for the deal: Value (yours), your gain a week under your name,
//     and Total. The page hands them in as printed; they are compared at the
//     tenth they are printed at, so the box and its colour cannot disagree.
//   - ranges are inclusive: Value > 0, +1 <= your week <= +4, 0 <= Total <= +5.
//   - "worth isn't 0": a man whose Value is 0 (or who has none) is never
//     orange — adding him moves no Value, so he only keeps the figures where
//     they are.
//   - "keep the trade the same": when the deal as ticked is already in range,
//     nothing is orange.
//   - nothing ticked: nothing is orange (there is no trade to complete yet).
//   - red is EVERY man on the two lists who was traded between these two
//     managers already (moving him would undo that trade), ticked or not, so
//     he can be seen; he is never orange.
//
// Pure: no DOM and no page state. The page prices each candidate with the box's
// own pricing and passes a function that does it (`figuresWith`).

const tenth = (n) => Math.round(n * 10) / 10;
const num = (n) => typeof n === 'number' && Number.isFinite(n);

export const HINT_RANGE = Object.freeze({ weekMin: 1, weekMax: 4, totalMin: 0, totalMax: 5 });

/**
 * Are a deal's printed figures in Tim's range?
 * @param {{value:number|null, myWeek:number|null, total:number|null}|null} fig
 */
export function hintInRange(fig) {
  if (!fig || !num(fig.value) || !num(fig.myWeek) || !num(fig.total)) return false;
  const v = tenth(fig.value);
  const w = tenth(fig.myWeek);
  const t = tenth(fig.total);
  return v > 0 &&
    w >= HINT_RANGE.weekMin && w <= HINT_RANGE.weekMax &&
    t >= HINT_RANGE.totalMin && t <= HINT_RANGE.totalMax;
}

/**
 * The marks, one candidate at a time: a generator so the page can price a few
 * men, give the browser a turn, and carry on (or stop when the ticks change).
 * Run it to the end and its return value is the answer.
 *
 * @param {object} o
 * @param {Array<{id:string, side:'a'|'b'}>} o.men every man on the two lists
 * @param {Set<string>|string[]} o.ticked the ids ticked now
 * @param {(man)=>boolean} o.barred he was traded between these two already
 * @param {(id:string)=>number|null} o.valueOf his Value (null: none)
 * @param {object|null} o.current the figures of the deal as ticked
 * @param {(man)=>object|null} o.figuresWith the figures with him ticked too
 * @returns {Generator<number, {orange:Set<string>, red:Set<string>}>}
 */
export function* hintSteps({ men, ticked, barred, valueOf, current, figuresWith }) {
  const on = new Set([...(ticked || [])].map(String));
  const red = new Set();
  const orange = new Set();
  for (const m of men || []) if (barred(m)) red.add(String(m.id));
  // Nothing ticked, or the deal is already where he wants it: no orange.
  if (!on.size || hintInRange(current)) return { orange, red };
  let n = 0;
  for (const m of men || []) {
    const id = String(m.id);
    if (on.has(id) || red.has(id)) continue;
    const v = valueOf(id);
    if (!num(v) || v === 0) continue;
    if (hintInRange(figuresWith(m))) orange.add(id);
    yield ++n;
  }
  return { orange, red };
}

/** `hintSteps` run to the end in one go (tests, and a caller with no page to keep live). */
export function customHints(o) {
  const it = hintSteps(o);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
