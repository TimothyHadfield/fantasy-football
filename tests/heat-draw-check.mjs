// Does the red/green tint actually DRAW on every row of a table? (AUDIT §1.1)
//
// The scale's tint is a `background-image` (css/app.css, `.heat-up-N` /
// `.heat-dn-N`, specificity 0,1,0). Any rule that matches the same <td> with
// the `background` SHORTHAND and a higher specificity resets that image to
// `none`, and the cell renders untinted while still carrying its class — so
// every class-level assertion in the other suites stays green. Until
// 2026-09-21 the zebra band, the `tr.me` row and row hover all did exactly
// that: 540 of 1,121 heat cells on the site drew no colour.
//
// linkedom has no cascade, so this suite runs one: it parses css/app.css,
// matches every rule against a real-shaped table with linkedom's own
// `matches()`, and picks the winning `background-image` (and
// `background-color`) by !important, specificity, then source order — the
// same three steps a browser uses. `:hover` is stood in for by a class, and
// every @media block is treated as applying (a shorthand that erases the tint
// only on a phone is the same bug).
//
// Checked, for a heat cell in: an odd row, an even row, the user's own row
// (`tr.me`, on both parities), and each of those under hover:
//   1. the winning background-image is the tint's gradient, not `none`;
//   2. the row's own colour (zebra / .me / hover) still wins background-COLOR,
//      so the fix did not trade one layer for the other;
//   3. no rule in app.css that matches any <td> of the table uses the
//      `background` shorthand at all — the next one written would erase the
//      tint again, and this is where it would be caught.
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { repoFile } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++; else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};

// --- a small CSS reader ------------------------------------------------------
const css = readFileSync(repoFile('css/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Flatten the sheet into [{ selectors, decls, order, media }], recursing into @media/@supports. */
function readRules(text, media = null, out = []) {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    // find the matching close brace
    let depth = 1, j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    const body = text.slice(open + 1, j - 1);
    if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
      readRules(body, prelude, out);
    } else if (!prelude.startsWith('@')) {
      const decls = [];
      for (const d of body.split(';')) {
        const k = d.indexOf(':');
        if (k < 0) continue;
        const prop = d.slice(0, k).trim().toLowerCase();
        let value = d.slice(k + 1).trim();
        const important = /!important\s*$/i.test(value);
        value = value.replace(/!important\s*$/i, '').trim();
        if (prop) decls.push({ prop, value, important });
      }
      const selectors = splitList(prelude);
      out.push({ selectors, decls, order: out.length, media, text: prelude });
    }
    i = j;
  }
  return out;
}

/** Split a selector list on top-level commas. */
function splitList(s) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Selectors-4 specificity as [ids, classes, types]. :not/:is take their most specific argument; :where is zero. */
function specificity(sel) {
  let a = 0, b = 0, c = 0;
  // pull out functional pseudo-classes first
  let rest = '';
  for (let i = 0; i < sel.length; i++) {
    const m = /^:(not|is|where|has|nth-child|nth-last-child|nth-of-type|nth-last-of-type)\(/.exec(sel.slice(i));
    if (!m) { rest += sel[i]; continue; }
    let depth = 1, j = i + m[0].length;
    while (j < sel.length && depth) { if (sel[j] === '(') depth++; else if (sel[j] === ')') depth--; j++; }
    const arg = sel.slice(i + m[0].length, j - 1);
    if (m[1] === 'not' || m[1] === 'is' || m[1] === 'has') {
      const best = splitList(arg).map(specificity).sort(cmpSpec).pop() || [0, 0, 0];
      a += best[0]; b += best[1]; c += best[2];
    } else if (m[1] !== 'where') b += 1; // :nth-*() counts as one pseudo-class
    rest += ' ';
    i = j - 1;
  }
  a += (rest.match(/#[\w-]+/g) || []).length;
  b += (rest.match(/\.[\w-]+/g) || []).length;
  b += (rest.match(/\[[^\]]*\]/g) || []).length;
  b += (rest.replace(/::[\w-]+/g, '').match(/:[\w-]+/g) || []).length;
  c += (rest.match(/::[\w-]+/g) || []).length;
  c += (rest.replace(/\[[^\]]*\]/g, '').match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) || []).length;
  return [a, b, c];
}
function cmpSpec(x, y) { return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }

const RULES = readRules(css);
ok(RULES.length > 100, 'app.css parsed into rules', `got ${RULES.length}`);

/** Which background-image a shorthand value sets: its image layer, or none. */
const imageOfShorthand = (v) => (/(gradient\(|url\()/.test(v) ? v : 'none');
/** Which background-color a shorthand value sets (the last token that is not an image/position keyword). */
const colorOfShorthand = (v) => (/(gradient\(|url\()/.test(v) ? 'transparent' : v);

/**
 * Run the cascade for one element and one longhand. `:hover` in a selector is
 * matched as the class `__hover`, which the fixture puts on the hovered <tr>.
 */
function cascade(el, prop) {
  let win = null;
  for (const r of RULES) {
    for (const sel of r.selectors) {
      if (/::/.test(sel)) continue; // pseudo-elements paint their own box
      const probe = sel.replace(/:hover/g, '.__hover');
      let hit = false;
      try { hit = el.matches(probe); } catch { continue; }
      if (!hit) continue;
      const spec = specificity(sel);
      for (const d of r.decls) {
        let value = null;
        if (d.prop === prop) value = d.value;
        else if (d.prop === 'background') value = prop === 'background-image' ? imageOfShorthand(d.value) : colorOfShorthand(d.value);
        if (value === null) continue;
        const cand = { value, spec, order: r.order, important: d.important, sel, via: d.prop };
        if (!win
          || (cand.important && !win.important)
          || (cand.important === win.important && (cmpSpec(cand.spec, win.spec) > 0
            || (cmpSpec(cand.spec, win.spec) === 0 && cand.order >= win.order)))) win = cand;
      }
    }
  }
  return win;
}

// --- sanity: the specificity counter agrees with the numbers in AUDIT §1.1 --
ok(cmpSpec(specificity('tbody tr:nth-child(even) td'), [0, 1, 3]) === 0, 'specificity of the zebra rule is 0,1,3');
ok(cmpSpec(specificity('tbody tr.me td'), [0, 1, 3]) === 0, 'specificity of tbody tr.me td is 0,1,3');
ok(cmpSpec(specificity('.heat-up-4'), [0, 1, 0]) === 0, 'specificity of a tint rule is 0,1,0');
ok(cmpSpec(specificity('.heat.heat-up-1:not(html)'), [0, 2, 1]) === 0, 'specificity of the weight rule is 0,2,1');
ok(cmpSpec(specificity('#seasonTable td.lit'), [1, 1, 1]) === 0, 'specificity of #seasonTable td.lit is 1,1,1');

// --- the fixture: the Stats page's main table, ten teams, one of them yours --
// Shape copied from what stats.html renders in demo mode: a sticky td.name,
// then value cells, every value cell on the scale (`heat heat-up-N` /
// `heat-dn-N` / `heat-0`), ten rows in one tbody. Row 4 is `tr.me` (even), and
// row 7 is a second `tr.me` (odd) so both parities of "your row" are covered.
const STEPS = ['heat-up-4', 'heat-up-2', 'heat-dn-1', 'heat-0', 'heat-dn-3', 'heat-up-1', 'heat-dn-4'];
const rowsHtml = Array.from({ length: 10 }, (_, r) => {
  const me = r === 3 || r === 6 ? ' class="me"' : '';
  const cells = STEPS.map((s, c) => `<td class="heat ${STEPS[(c + r) % STEPS.length]}" data-v="${100 + r + c}">${100 + r + c}</td>`).join('');
  return `<tr${me}><td class="name">Team ${r + 1}</td>${cells}</tr>`;
}).join('');
const { document } = parseHTML(`<!doctype html><html><body><div class="table-scroll"><table id="mainTable">
<thead><tr><th class="name">Team</th>${STEPS.map((_, i) => `<th>c${i}</th>`).join('')}</tr></thead>
<tbody>${rowsHtml}</tbody></table></div></body></html>`);
const rows = [...document.querySelectorAll('tbody tr')];

const GRADIENT = /linear-gradient\(rgba\((59, 165, 93|224, 82, 95), 0\.\d+\)/;
const stepOf = (td) => (td.className.match(/heat-(up|dn)-\d/) || [null])[0];

const STATES = [
  { name: 'odd row', row: 0 },
  { name: 'even row', row: 1, color: 'var(--row-alt)' },
  { name: 'tr.me (even row)', row: 3, color: '#14261a' },
  { name: 'tr.me (odd row)', row: 6, color: '#14261a' },
];
let tinted = 0;
for (const hover of [false, true]) {
  for (const st of STATES) {
    const tr = rows[st.row];
    if (hover) tr.classList.add('__hover');
    const label = `${st.name}${hover ? ' under hover' : ''}`;
    const cells = [...tr.querySelectorAll('td.heat')].filter(stepOf);
    ok(cells.length >= 5, `${label}: fixture row has tinted-step cells`, `got ${cells.length}`);
    for (const td of cells) {
      const img = cascade(td, 'background-image');
      const drew = !!img && GRADIENT.test(img.value);
      if (drew) tinted++;
      ok(drew, `${label}: ${stepOf(td)} cell draws its tint`,
        img ? `winner "${img.sel}" via ${img.via}: ${img.value}` : 'no rule sets background-image');
      // the tint's own step wins, not some other step's gradient
      ok(!!img && new RegExp(`\\.${stepOf(td)}\\b`).test(img.sel), `${label}: ${stepOf(td)} cell's image comes from its own step rule`, img && img.sel);
      const col = cascade(td, 'background-color');
      const want = hover ? 'var(--panel-3)' : st.color;
      if (want) ok(!!col && col.value === want, `${label}: row colour ${want} still owns background-color`, col ? `${col.sel} → ${col.value}` : 'none');
    }
    // heat-0 draws nothing, and must not pick up a gradient from anywhere
    for (const td of tr.querySelectorAll('td.heat-0')) {
      const img = cascade(td, 'background-image');
      ok(!img || img.value === 'none', `${label}: heat-0 cell draws no tint`, img && img.value);
    }
    if (hover) tr.classList.remove('__hover');
  }
}
ok(tinted >= 40, 'tinted cells actually checked', `${tinted}`);

// --- lint: no shorthand anywhere it could land on a table cell --------------
for (const tr of rows) tr.classList.add('__hover');
const offenders = new Set();
for (const td of document.querySelectorAll('tbody td')) {
  for (const r of RULES) {
    if (!r.decls.some((d) => d.prop === 'background')) continue;
    for (const sel of r.selectors) {
      let hit = false;
      try { hit = td.matches(sel.replace(/:hover/g, '.__hover')); } catch { /* unsupported selector */ }
      if (hit) offenders.add(sel);
    }
  }
}
for (const tr of rows) tr.classList.remove('__hover');
ok(offenders.size === 0, 'no app.css rule that matches a table cell uses the `background` shorthand',
  [...offenders].join(' | '));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
