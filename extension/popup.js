// A self-contained check, so a failure can be diagnosed without opening the
// site at all. If this works and the site does not, the problem is the site.

const $ = (id) => document.getElementById(id);
const SEASON = new Date().getFullYear();

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
  if (!leagueId) { show('Enter your league ID first.', 'bad'); return; }

  chrome.storage.local.set({ leagueId });
  show('Asking ESPN…');

  chrome.runtime.sendMessage(
    { type: 'PROBE', season: SEASON, leagueId },
    (res) => {
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
        `Connected.\n${d.name}\n${d.teams.length} teams, season ${d.season}.\n` +
        `Now open the site — it will pick this up.`,
        'good'
      );
    }
  );
});
