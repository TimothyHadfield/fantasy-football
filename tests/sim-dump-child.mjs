
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { REPO } from './repo.mjs';
const { window, document } = parseHTML(readFileSync(path.join(REPO, 'schedule.html'), 'utf8'));
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true,
  get(){ const s=this.querySelector('option[selected]')||this.querySelector('option'); return s? (s.getAttribute('value') ?? s.textContent):''; },
  set(v){ for (const o of this.querySelectorAll('option')) { if ((o.getAttribute('value') ?? o.textContent)===String(v)) o.setAttribute('selected',''); else o.removeAttribute('selected'); } } });
const TP = Object.getPrototypeOf(document.createElement('table'));
const kids=(el,t)=> el?Array.from(el.children).filter(c=>c.tagName===t):[];
Object.defineProperty(TP,'tBodies',{configurable:true,get(){return kids(this,'TBODY');}});
Object.defineProperty(TP,'tHead',{configurable:true,get(){return kids(this,'THEAD')[0]||null;}});
Object.defineProperty(TP,'rows',{configurable:true,get(){const h=kids(this,'THEAD')[0];const r=[];if(h)r.push(...kids(h,'TR'));for(const b of kids(this,'TBODY'))r.push(...kids(b,'TR'));return r;}});
const RP = Object.getPrototypeOf(document.createElement('tr'));
Object.defineProperty(RP,'cells',{configurable:true,get(){return Array.from(this.children).filter(c=>c.tagName==='TD'||c.tagName==='TH');}});
window.location = { href:'http://localhost/', origin:'http://localhost', pathname:'/schedule.html', search:'', hash:'' };
globalThis.location = window.location; window.postMessage = () => {};
const store = new Map(JSON.parse(process.env.FC_STORE));
Object.assign(globalThis, { window, document,
  localStorage:{ getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k), clear:()=>store.clear() },
  fetch: async (u) => { throw new Error('net '+u); },
  HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
  getComputedStyle: () => ({ position:'', getPropertyValue: () => '' }),
  requestAnimationFrame: fn => setTimeout(fn,0), cancelAnimationFrame: id => clearTimeout(id),
  ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
  matchMedia: () => ({ matches:false, addEventListener(){}, removeEventListener(){} }) });
window.localStorage = globalThis.localStorage; window.ResizeObserver = globalThis.ResizeObserver;

await import(pathToFileURL(path.join(REPO, 'js/schedule-page.js')).href);
await new Promise(r => setTimeout(r, 900));
const $ = id => document.getElementById(id);
const t = el => el ? el.textContent.replace(/\s+/g,' ').trim() : '';
console.log('RUNS   :', Array.from($('simRuns').querySelectorAll('button')).map(b => (b.className.includes('on')?'['+t(b)+']':' '+t(b)+' ')).join(''));
console.log('STATS  :', Array.from($('simStats').querySelectorAll('.stat')).map(s=>t(s)).join('   |   '));
console.log('CAP    :', t($('simCap')));
console.log('CHART  :', $('simChart').querySelectorAll('path.ff-bar').length + ' bars; titles: ' +
  Array.from($('simChart').querySelectorAll('path.ff-bar title')).map(x=>t(x)).join(', '));
console.log('TABLE  :');
for (const tr of $('simTable').querySelectorAll('tbody tr')) {
  console.log('   ', (tr.getAttribute('class')||'').padEnd(10), Array.from(tr.children).map(td=>t(td).padStart(12)).join(''));
}
console.log('NOTE   :');
for (const line of $('simNote').innerHTML.split('<br>')) console.log('    -', line.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim());
console.log('FC EXP :', Array.from($('forecastStats').querySelectorAll('.stat')).map(s=>t(s)).join(' | '));
console.log('FC TEAM:', t($('forecastTitle')));
