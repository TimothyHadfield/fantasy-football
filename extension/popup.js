// A self-contained check, so a failure can be diagnosed without opening the
// site at all. If this works and the site does not, the problem is the site.

const $ = (id) => document.getElementById(id);

// The fantasy season is named for the year it starts, so from January until
// the summer the current season is still last calendar year. Using
// getFullYear() outright probes a season that does not exist yet.
function currentSeason(now = new Date()) {
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
}
const SEASON = currentSeason();

chrome.storage.local.get(['leagueId'], ({ leagueId }) => {
  if (leagueId) $('league').value = leagueId;
});

// "Let the site set my lineup". OFF until he turns it on here, and this popup
// is the only thing that can turn it on: background.js refuses every lineup
// change while the stored value is anything but exactly `true`, and a web page
// cannot reach extension storage. (Tim, 2026-10-11: "Yes, lineup only".)
const ALLOW_LINEUP_KEY = 'allowLineup';

function paintAllow(on) {
  $('allow').setAttribute('aria-checked', on ? 'true' : 'false');
}

chrome.storage.local.get([ALLOW_LINEUP_KEY], (stored) => {
  paintAllow(stored[ALLOW_LINEUP_KEY] === true);
});

// The whole row is the target, the way a labelled switch behaves anywhere.
$('allow-row').addEventListener('click', () => {
  const on = $('allow').getAttribute('aria-checked') !== 'true';
  // Painted only once it is saved, so the switch never shows a state the
  // worker would not act on.
  chrome.storage.local.set({ [ALLOW_LINEUP_KEY]: on }, () => {
    if (!chrome.runtime.lastError) paintAllow(on);
  });
});

function show(text, cls) {
  const out = $('out');
  out.textContent = text;
  out.className = cls || '';
}

$('test').addEventListener('click', () => {
  const leagueId = $('league').value.trim();
  if (!/^\d{1,12}$/.test(leagueId)) {
    show('A league ID is digits only — check the number in your ESPN URL.', 'bad');
    return;
  }

  chrome.storage.local.set({ leagueId });
  show('Asking ESPN…');

  chrome.runtime.sendMessage({ type: 'PROBE', season: SEASON, leagueId }, (res) => {
    if (chrome.runtime.lastError) {
      show(`Extension error: ${chrome.runtime.lastError.message}`, 'bad');
      return;
    }
    if (!res || !res.ok) {
      show(res?.error || 'No response.', 'bad');
      return;
    }
    const d = res.data;
    show(
      `Connected.\n${d.name}\n${d.teams.length} teams, season ${d.season}.\n\n` +
      'Open the site and it will pick this league up automatically.',
      'good'
    );
  });
});
