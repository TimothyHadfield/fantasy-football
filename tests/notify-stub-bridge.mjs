// Stands in for js/bridge.js when the Notifications page is booted
// (notify-check.mjs). Everything is the REAL module — the page's window answers
// `postMessage` the way the extension does, so the connection bar's probe is
// the real code — except the two calls the page makes to change a lineup:
//
//   canSetLineup()   resolves what the scenario says (`lineup.can`)
//   setLineup(args)  recorded; resolves what the scenario says (`lineup.result`)
//                    and, when the scenario says ESPN took it (`lineup.applies`),
//                    hands the moves to the season stub, which then answers
//                    with the men moved.
//
// The scenario is `globalThis.__notifyStub`, set before the page is imported.
//
// notify-loader.mjs leaves THIS file's own import of js/bridge.js alone, so
// the line below is the real module, whatever it exports by then.
export * from '../js/bridge.js';

const cfg = () => globalThis.__notifyStub || {};
const log = (entry) => { (cfg().calls ||= []).push(entry); };

export async function canSetLineup() {
  log(['canSetLineup']);
  return (cfg().lineup || {}).can === true;
}

export async function setLineup(args) {
  log(['setLineup', JSON.parse(JSON.stringify(args))]);
  const l = cfg().lineup || {};
  if (l.throws) throw new Error('The extension did not answer.');
  const result = l.result || { ok: false, reason: 'not allowed' };
  if (result.ok && l.applies) (cfg().moved ||= []).push(...args.moves);
  return result;
}
