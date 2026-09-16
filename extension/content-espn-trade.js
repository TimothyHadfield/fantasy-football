// Ticks YOUR OWN side of a staged trade on ESPN's trade builder.
//
// WHY THIS FILE EXISTS
// --------------------
// The site can deep-link into ESPN's trade screen, and the `players=` query
// parameter pre-ticks players — but ESPN matches those ids against the
// COUNTERPARTY's roster only. Read from their shipped bundle (trade.page.js,
// 2026-09-16):
//
//     p = t.find(e => e.teamId === x);   // x = fromTeamId — YOUR roster
//     m = t.find(e => e.teamId === d);   // d = teamId     — THEIR roster
//     y && i.length && m.players.forEach(e => {
//       includes(i, e.id) && j.addPlayer(e, TRADE)         // only ever `m`
//     })
//
// Your own roster (`p`) is fetched and rendered and never pre-selected. There
// is no second parameter for it, and swapping teamId/fromTeamId does not work:
// ESPN overrides fromTeamId to a team you own and then refuses with "You are
// trying to propose trade to yourself."
//
// So the URL gets their side ticked and this script gets yours ticked. The
// owner then presses ESPN's own Propose Trade button himself.
//
// *** NEVER SUBMIT. ***
// This script clicks roster checkboxes and NOTHING ELSE. It must never click
// Propose Trade, never touch the confirmation modal, never dispatch any event
// on either. The only write that ever reaches ESPN is the owner's own click on
// their own button, on a page he opened himself. If you are here to "finish the
// job" by pressing the button too — don't. That is the whole safety model.
// (For the same reason the extension holds no write-host permission at all:
// manifest.json's host_permissions is the READ host and only the READ host.)
//
// A CHECKBOX IS A TOGGLE.
// Their side is already ticked by the URL. A script that blindly clicked would
// UNTICK them and propose a smaller trade than intended — which would look
// completely fine on screen. So every click is preceded by a read of the
// current state, and only a box that needs to change is touched.
//
// FAILURE IS ALWAYS SILENT AND NON-FATAL.
// With no staged trade, a changed ESPN build, or an exception anywhere, the
// page is left exactly as the URL made it: their side ticked, yours not. That
// is today's behaviour, which works, so there is nothing to break.

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Selectors. Every one of these was confirmed against ESPN's shipped bundle
  // rather than guessed — see the quotes, which are the minified source.
  // ---------------------------------------------------------------------------

  // Two roster panels, and the order is fixed by this line in trade.page.js:
  //     ...[[u,p,m],[i,l,c]].map(...)      u = toTeam (THEIRS), i = fromTeam (MINE)
  // so panel 0 is the counterparty and panel 1 is you. We do not rely on that
  // ordering for correctness — see pickTheirPanel() — only as a tie-break.
  const PANEL = '.trade-container-wrapper';

  // The action column renders, for a trade:
  //   <span tabIndex="0" role="checkbox" aria-label=… aria-checked={checked}>
  //     <label class="control control--checkbox inline__control roster-action-checkbox">
  //       <input class="form__control form__control--checkbox" type="checkbox">
  //       <div class="control__indicator">…</div>
  //     </label>
  //   </span>
  //
  // From trade.page.js:
  //   createElement(k, {checked: g, className: cx(a, "roster-action-checkbox"), onChange: f})
  //   k = e => createElement("span", {tabIndex:"0", role:"checkbox",
  //                                   "aria-label":e["aria-label"],
  //                                   "aria-checked":e.checked, onKeyDown:…},
  //                          createElement(Checkbox, e))
  // and Checkbox (module 92 of main.js):
  //   i.className = "form__control form__control--checkbox"; i.type = "checkbox";
  //   return jsxs("label", {htmlFor:id, className:l, children:[label, jsx("input", i), …]})
  //
  // So: aria-checked lives on the span, and `checked` + `onChange` live on the
  // INPUT. The input is therefore the node to click.
  const CHECKBOX_LABEL = '.roster-action-checkbox';
  const CHECKBOX_ROLE = '[role="checkbox"]';
  const CHECKBOX_INPUT = 'input.form__control--checkbox';

  // ESPN's table primitive. `tr` is the fallback in case the class is renamed.
  const ROW = '.Table__TR';

  // A player's id is not written into the DOM as an attribute anywhere. It is
  // recoverable from the headshot, which main.js builds as
  //   "https://a.espncdn.com/i/headshots/nfl/players/full/" + player.id + ".png"
  // (a D/ST gets proTeamLogoUrl instead and so has no id — that is why a name
  // is staged alongside every id).
  const HEADSHOT_RE = /players(?:\/|%2F)full(?:\/|%2F)(\d{1,9})\.png/i;

  const BADGE_ID = 'ff-bridge-trade-badge';

  // ESPN's own z-index base is 1e6 (main.js: Z_INDEX_OPTS.base). Sit above it.
  const BADGE_Z = '2147483000';

  // React renders the rosters only after two network round trips, so the tables
  // are not there at document_idle. Give up eventually rather than watching the
  // DOM forever on a page the owner has wandered away from.
  const READY_TIMEOUT_MS = 25000;
  const POLL_MS = 200;

  // After the last click, let React's store settle before reading state back.
  const SETTLE_MS = 60;

  const log = (...a) => { try { console.debug('[FF bridge]', ...a); } catch { /* ignore */ } };

  // ---------------------------------------------------------------------------
  // Talking to the worker
  // ---------------------------------------------------------------------------

  /** Never throws, never rejects: a dead worker must not break ESPN's page. */
  function askWorker(request) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(request, (res) => {
          // Reading lastError is what suppresses the "Unchecked runtime.lastError"
          // console noise when the worker has gone away.
          const err = chrome.runtime.lastError;
          if (err) { resolve({ ok: false, error: err.message }); return; }
          resolve(res || { ok: false, error: 'No response from the extension.' });
        });
      } catch (err) {
        resolve({ ok: false, error: err && err.message });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Reading the page
  // ---------------------------------------------------------------------------

  const normName = (s) => String(s || '')
    .toLowerCase()
    .replace(/’/g, "'")         // ESPN uses a curly apostrophe in some names
    .replace(/[.'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  /** Every name this row could be called, normalised. */
  function rowNames(row) {
    const out = new Set();
    const add = (v) => { const n = normName(v); if (n) out.add(n); };

    for (const img of row.querySelectorAll('img[alt]')) {
      // Both call sites spell it the same way:
      //   alt: `${player.fullName} Headshot`   and   alt: player.fullName
      add(String(img.getAttribute('alt') || '').replace(/\s+headshot$/i, ''));
    }
    const athlete = row.querySelector('.player-column__athlete');
    if (athlete) add(athlete.textContent);
    return out;
  }

  /** The ESPN player id for this row, or null (a D/ST genuinely has none). */
  function rowPlayerId(row) {
    for (const img of row.querySelectorAll('img[src]')) {
      const m = HEADSHOT_RE.exec(img.getAttribute('src') || '');
      if (m) return Number(m[1]);
    }
    return null;
  }

  /**
   * The row a checkbox belongs to.
   *
   * ESPN's table primitive puts the class on a real <tr>, and that is the first
   * try. The rest is insurance against a rebuilt table: without a row we cannot
   * tell WHO a checkbox is for, and a checkbox we cannot identify is one we must
   * never click. The bounded walk stops at the panel, so it can never widen far
   * enough to make two players look like one row.
   */
  function rowFor(label, panel) {
    const known = label.closest(ROW) || label.closest('tr') || label.closest('[role="row"]');
    if (known) return known;
    let node = label.parentElement;
    for (let i = 0; i < 8 && node && node !== panel; i += 1) {
      if (node.querySelector('img[alt]')) return node;
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Every roster checkbox on the page, with who it belongs to.
   *
   * Deliberately scoped to the two roster panels. The page has other controls
   * (Propose Trade, the confirmation modal, the draft-pick pickers) and this is
   * the line that keeps them out of reach: nothing outside a panel, and nothing
   * that is not a roster-action checkbox, is ever considered.
   */
  function indexCheckboxes(doc) {
    const panels = Array.from(doc.querySelectorAll(PANEL));
    const entries = [];

    panels.forEach((panel, panelIndex) => {
      for (const label of panel.querySelectorAll(CHECKBOX_LABEL)) {
        const role = label.closest(CHECKBOX_ROLE) || label.querySelector(CHECKBOX_ROLE);
        const input = label.matches(CHECKBOX_INPUT)
          ? label
          : label.querySelector(CHECKBOX_INPUT);
        const row = rowFor(label, panel);
        if (!row) continue;
        entries.push({
          panelIndex,
          role,
          input,
          row,
          id: rowPlayerId(row),
          names: rowNames(row),
        });
      }
    });

    return { panels, entries };
  }

  /** True / false / null when the page will not say. */
  function isTicked(entry) {
    if (entry.role) {
      const a = entry.role.getAttribute('aria-checked');
      if (a === 'true') return true;
      if (a === 'false') return false;
    }
    if (entry.input) {
      // `checked` as a live property first: after a click React re-renders the
      // attribute, but the property is what the browser itself tracks.
      if (typeof entry.input.checked === 'boolean') return entry.input.checked;
      if (entry.input.hasAttribute('checked')) return true;
    }
    return null;
  }

  /** The panel the counterparty's men are in, so we never tick inside it. */
  function pickTheirPanel(entries, theirIds, panelCount) {
    const tally = new Map();
    for (const e of entries) {
      if (e.id != null && theirIds.has(e.id)) {
        tally.set(e.panelIndex, (tally.get(e.panelIndex) || 0) + 1);
      }
    }
    let best = null;
    let bestN = 0;
    for (const [panel, n] of tally) if (n > bestN) { best = panel; bestN = n; }
    // Fallback to ESPN's own render order: [[toTeam…],[fromTeam…]] — theirs is
    // first. Only used when their side could not be located at all, which
    // happens when every man they are giving up is a D/ST.
    if (best === null && panelCount >= 2) best = 0;
    return best;
  }

  // ---------------------------------------------------------------------------
  // Ticking — through the REAL event path, not by writing an attribute
  // ---------------------------------------------------------------------------

  /**
   * Tick one box.
   *
   * React records a checkbox's change from the CLICK event, not from a `change`
   * event and certainly not from the attribute: its ChangeEventPlugin listens
   * for `click` on checkbox and radio inputs at the root and synthesises
   * onChange from it. So `input.click()` — a real, trusted-shaped, bubbling
   * click on the node React put `onChange` on — is the one thing that makes
   * ESPN's MobX store (playerTransactionStore.addPlayer) actually record the
   * selection. Setting aria-checked, or the `checked` property, or dispatching
   * a bare `change`, would repaint the box and propose nothing: the trade would
   * LOOK right on screen and go out missing your side entirely.
   *
   * The keyboard path is the fallback, and it is a real path too: the wrapping
   * span carries onKeyDown and calls the same onChange for the space key.
   */
  function tickOnce(entry) {
    if (entry.input && typeof entry.input.click === 'function') {
      entry.input.click();
      return true;
    }
    if (entry.role && typeof entry.role.dispatchEvent === 'function'
        && typeof KeyboardEvent === 'function') {
      entry.role.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
      }));
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // The badge
  // ---------------------------------------------------------------------------

  /**
   * Say what happened, on the page.
   *
   * A silently smaller trade than intended is the failure mode with real
   * consequences here — he would propose two men when he meant three and never
   * know. So a man we could not find is named, in full, in red.
   *
   * textContent throughout: names come from the site over postMessage, and
   * while the worker validates them, building HTML out of them would put an
   * injection point on espn.com. There is no innerHTML in this file.
   *
   * The four ways a man can fail to be in the trade are kept apart on purpose,
   * because they need different things done about them: he is not on the roster
   * shown (he was dropped or traded); ESPN would not record the click (their
   * build changed); the page did not look as expected (refused on purpose); or
   * he was already ticked (nothing wrong at all).
   */
  function showBadge(doc, { ticked, already, missing, notRegistered, refused, note }) {
    const old = doc.getElementById(BADGE_ID);
    if (old && old.remove) old.remove();

    const problems = missing.length + notRegistered.length + refused.length > 0;

    const box = doc.createElement('div');
    box.id = BADGE_ID;
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    // One style attribute, written once. Setting a camelCase style property
    // afterwards is the kind of thing that works in a browser and silently
    // does nothing in a headless DOM, so the colour is decided here instead.
    box.setAttribute('style', [
      'position:fixed', 'left:16px', 'bottom:16px', 'z-index:' + BADGE_Z,
      'max-width:320px', 'padding:10px 12px',
      'font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif',
      'color:#1b2430', 'background:#ffffff',
      'border:1px solid #cbd5e1',
      'border-left:4px solid ' + (problems ? '#dc2626' : '#16a34a'),
      'border-radius:8px', 'box-shadow:0 2px 12px rgba(0,0,0,.18)',
    ].join(';'));

    const title = doc.createElement('div');
    title.setAttribute('style', 'font-weight:600;margin-bottom:2px');
    const n = ticked.length;
    title.textContent = n
      ? `Fantasy Football Bridge ticked ${n} of your player${n === 1 ? '' : 's'}.`
      : 'Fantasy Football Bridge ticked nothing.';
    box.appendChild(title);

    const line = (text, colour) => {
      const p = doc.createElement('div');
      p.setAttribute('style', 'margin-top:4px' + (colour ? ';color:' + colour : ';color:#556'));
      p.textContent = text;
      box.appendChild(p);
    };

    if (ticked.length) line(ticked.join(', '));
    if (already.length) line(`Already selected: ${already.join(', ')}`);
    if (missing.length) {
      line(
        `NOT on the roster shown, so NOT in this trade: ${missing.join(', ')}. ` +
        'Check the deal before you propose it.',
        '#b91c1c'
      );
    }
    if (notRegistered.length) {
      line(
        `ESPN did not record the selection for: ${notRegistered.join(', ')}. ` +
        'Tick them yourself before you propose it.',
        '#b91c1c'
      );
    }
    if (refused.length) {
      line(
        `Left alone, because ESPN’s page did not look as expected: ${refused.join(', ')}. ` +
        'Tick them yourself before you propose it.',
        '#b91c1c'
      );
    }
    if (note) line(note, '#b45309');
    line('Nothing has been sent. Press ESPN’s Propose Trade yourself.');

    const close = doc.createElement('button');
    close.setAttribute('type', 'button');
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = 'Dismiss';
    close.setAttribute('style', [
      'margin-top:8px', 'padding:3px 8px', 'font:inherit', 'font-size:12px',
      'cursor:pointer', 'border:1px solid #cbd5e1', 'border-radius:6px',
      'background:#f1f5f9', 'color:#1b2430',
    ].join(';'));
    close.addEventListener('click', () => { try { box.remove(); } catch { /* ignore */ } });
    box.appendChild(close);

    (doc.body || doc.documentElement).appendChild(box);
    return box;
  }

  // ---------------------------------------------------------------------------
  // Waiting for the rosters
  // ---------------------------------------------------------------------------

  function rostersReady(doc) {
    const panels = doc.querySelectorAll(PANEL);
    if (panels.length < 2) return false;
    return doc.querySelectorAll(CHECKBOX_LABEL).length > 0;
  }

  function waitForRosters(doc, win) {
    if (rostersReady(doc)) return Promise.resolve(true);
    return new Promise((resolve) => {
      // Declared before finish() uses them, not after: the three are torn down
      // together and a temporal-dead-zone reference here would be a timer left
      // running on ESPN's page forever.
      let observer = null;
      let poll = null;
      let deadline = null;
      let done = false;

      const finish = (v) => {
        if (done) return;
        done = true;
        try { if (observer) observer.disconnect(); } catch { /* ignore */ }
        try { win.clearInterval(poll); } catch { /* ignore */ }
        try { win.clearTimeout(deadline); } catch { /* ignore */ }
        resolve(v);
      };

      const check = () => { if (rostersReady(doc)) finish(true); };

      if (typeof win.MutationObserver === 'function') {
        observer = new win.MutationObserver(check);
        try {
          observer.observe(doc.documentElement || doc, { childList: true, subtree: true });
        } catch { observer = null; }
      }
      // A poll as well as the observer: ESPN's tables are rendered into a
      // container that is itself replaced, and an observer that was attached to
      // the wrong root would simply never fire. The poll is the cheap insurance.
      poll = win.setInterval(check, POLL_MS);
      deadline = win.setTimeout(() => finish(false), READY_TIMEOUT_MS);
    });
  }

  const sleep = (win, ms) => new Promise((r) => win.setTimeout(r, ms));

  // ---------------------------------------------------------------------------
  // The run
  // ---------------------------------------------------------------------------

  async function run(win, doc) {
    const loc = win.location;
    // Belt and braces over the manifest's match pattern: a single-page app can
    // route away from the trade builder without a reload.
    if (!loc || !/^\/football\/team\/trade/.test(String(loc.pathname || ''))) {
      return { ran: false, reason: 'not the trade page' };
    }

    const q = new win.URLSearchParams(String(loc.search || ''));
    const claim = {
      type: 'TAKE_STAGED_TRADE',
      leagueId: q.get('leagueId') || '',
      myTeamId: q.get('fromTeamId') || '',
      theirTeamId: q.get('teamId') || '',
    };

    // Single-use and short-lived: the worker deletes the record as it hands it
    // over, and refuses one older than a few minutes. Both of those live in the
    // worker rather than here, because here is the untrusted half — this script
    // runs on espn.com.
    const res = await askWorker(claim);
    if (!res || !res.ok || !res.data) {
      log('nothing staged for this page', res && res.error);
      return { ran: false, reason: (res && res.error) || 'nothing staged' };
    }

    const staged = res.data;
    const mine = Array.isArray(staged.myPlayers) ? staged.myPlayers : [];
    const theirIds = new Set(
      (Array.isArray(staged.theirPlayerIds) ? staged.theirPlayerIds : []).map(Number)
    );
    if (!mine.length) return { ran: false, reason: 'nothing of yours staged' };

    const ok = await waitForRosters(doc, win);
    if (!ok) {
      showBadge(doc, {
        ticked: [], already: [], notRegistered: [], refused: [],
        missing: mine.map((p) => p.name || `#${p.id}`),
        note: 'ESPN’s rosters did not finish loading, so nothing was ticked.',
      });
      return { ran: false, reason: 'rosters never appeared' };
    }

    const { panels, entries } = indexCheckboxes(doc);
    const theirPanel = pickTheirPanel(entries, theirIds, panels.length);

    const ticked = [];
    const already = [];
    const missing = [];
    const refused = [];

    for (const want of mine) {
      const label = want.name || `#${want.id}`;
      const wantName = normName(want.name);

      // Id first — it comes from ESPN's own API and cannot be ambiguous. The
      // name is the fallback, and it is what covers a D/ST, whose row carries a
      // team logo instead of a headshot and so has no id in the DOM at all.
      let entry = entries.find((e) => e.id != null && e.id === want.id);
      if (!entry && wantName) {
        const byName = entries.filter((e) => e.names.has(wantName));
        // Two men on the page with one name is exactly the case where a guess
        // would tick the wrong player, so it is refused rather than guessed.
        if (byName.length === 1) entry = byName[0];
        else if (byName.length > 1) { refused.push(label); continue; }
      }

      if (!entry) { missing.push(label); continue; }

      // The safety stop. Our own men can only be on our own roster, so a match
      // inside the counterparty's panel means the page is not the one this
      // trade was staged for — a changed ESPN layout, or a link edited by hand.
      // Ticking there would ADD one of their players to what we receive.
      if (theirPanel !== null && entry.panelIndex === theirPanel) {
        refused.push(label);
        continue;
      }

      const before = isTicked(entry);
      if (before === true) { already.push(label); continue; }

      if (!tickOnce(entry)) { missing.push(label); continue; }
      ticked.push({ label, entry });
    }

    // Read the state back only after React has had a turn. A click that did not
    // register has to be reported, not assumed.
    if (ticked.length) await sleep(win, SETTLE_MS);

    const confirmed = [];
    const failed = [];
    for (const { label, entry } of ticked) {
      const after = isTicked(entry);
      // null means the page will not say — treat that as success rather than
      // crying wolf, since the click itself went through the real path.
      if (after === false) failed.push(label);
      else confirmed.push(label);
    }

    showBadge(doc, {
      ticked: confirmed,
      already,
      missing,
      notRegistered: failed,
      refused,
      note: '',
    });

    return { ran: true, ticked: confirmed, already, missing, refused, failed };
  }

  // Exposed for the test suite and for debugging in the console. This is the
  // ISOLATED world's window — ESPN's own scripts cannot see it.
  const win = typeof window !== 'undefined' ? window : globalThis;
  win.__ffTradeTick = run(win, win.document).catch((err) => {
    // Non-fatal, always: with this script dead the page is exactly what the URL
    // made it, which is what the owner had before the extension existed.
    log('gave up', err);
    return { ran: false, reason: String(err && err.message) };
  });
})();
