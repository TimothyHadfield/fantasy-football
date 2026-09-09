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
