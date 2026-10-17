/* Crease — Start-up: builds the page, wires header controls, picks the first tab. */
import { narrow, pal } from './charts.js';
import { shareDataFor, shareImage } from './export.js';
import { GROUPS, buildGroups, dirty, exampleValues, persistGroup, resetGroups, restoreGroups, setGroup } from './groups.js';
import { DLS, FORMATS, fmtOvers, parseOvers, winProb } from './maths.js';
import { RENDER, TAB_KEYS, appHooks, nav, schedule, showTab } from './router.js';
import { S, fmt } from './state.js';
import { batStats } from './tabs/batting.js';
import { bowlStats } from './tabs/bowling.js';
import { loadIntoCompare } from './tabs/compare.js';
import { ringMarkup } from './tabs/impact.js';
import { initNRR, nrrFollowFormat, resetNRR } from './tabs/nrr.js';
import { savePlayer, savedPlayers } from './tabs/saved.js';
import { hideTip, kpiGrid, tipEl, toast } from './ui.js';
import { $, $$, FONT, store } from './utils.js';
// Load every tab module: each one registers its renderer and event handlers when it loads.
import './tabs/batting.js';
import './tabs/bowling.js';
import './tabs/nrr.js';
import './tabs/dls.js';
import './tabs/impact.js';
import './tabs/compare.js';
import './tabs/live.js';
import './tabs/players.js';
import './tabs/tournament.js';
import './tabs/saved.js';
import './backup.js';
import './pwa.js';


// Lets the tournament tab match the format to its overs before opening the NRR solver.
appHooks.useOvers = n => {
  if (!n) return;
  const key = n === 20 ? 'T20' : n === 50 ? 'ODI' : n === 10 ? 'T10' : 'Custom';
  if (key === 'Custom') { S.customOvers = n; store.set('customOvers', n); $('#custom-overs').value = String(n); }
  if (key !== S.formatKey || key === 'Custom') setFormat(key, { silent: true });
};
export function setFormat(key, { silent = false } = {}) {
  S.formatKey = key;
  store.set('format', key);
  $$('.format-picker [data-format]').forEach(b => {
    const on = b.dataset.format === key;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
  $('#custom-overs-wrap').hidden = key !== 'Custom';
  // Untouched example inputs follow the format so the numbers stay realistic.
  for (const [name, G] of Object.entries(GROUPS)) if (G.example && !dirty[name]) setGroup(name, exampleValues(name));
  nrrFollowFormat();
  if (!silent) {
    RENDER[nav.active] && RENDER[nav.active]();
    toast(`Format set to ${fmt().label}`);
  }
}

export function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
export function syncThemeButton() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  $('#theme-toggle').setAttribute('aria-label', `Switch to ${next} theme`);
}
export function onThemeChange() {
  syncThemeButton();
  if (window.Chart) Chart.defaults.color = pal().muted;
  RENDER[nav.active] && RENDER[nav.active]();
}

/* =====================================================================
   17. Wiring and start-up
   ===================================================================== */
export function init() {
  // theme
  const savedTheme = store.get('theme', null);
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
  syncThemeButton();
  if (window.Chart) { Chart.defaults.font.family = FONT; Chart.defaults.color = pal().muted; }

  buildGroups();
  kpiGrid('k-bat', [
    { id: 'bat-sr', label: 'Strike rate', hero: true, tip: 'Runs ÷ balls faced × 100. Runs per 100 balls.' },
    { id: 'bat-avg', label: 'Average', tip: 'Runs ÷ dismissals. Not outs add runs but not dismissals.' },
    { id: 'bat-rpi', label: 'Runs per innings', tip: 'Runs ÷ innings, counting not outs as innings.' },
    { id: 'bat-bdry', label: 'Boundary %', tip: '(4 × fours + 6 × sixes) ÷ runs × 100.' },
    { id: 'bat-bpb', label: 'Balls per boundary', tip: 'Balls faced ÷ (fours + sixes). Lower means boundaries come more often.' },
    { id: 'bat-dot', label: 'Dot-ball %', tip: 'Dot balls ÷ balls faced × 100. Lower is better.' },
    { id: 'bat-rot', label: 'Strike rotation', tip: 'Balls that scored without being a boundary ÷ balls faced × 100.' },
    { id: 'bat-conv', label: '50 → 100 conversion', tip: 'Hundreds ÷ (fifties + hundreds) × 100.' },
    { id: 'bat-s100', label: 'Sixes per 100 balls', tip: 'Sixes ÷ balls faced × 100.' },
  ]);
  kpiGrid('k-bowl', [
    { id: 'bowl-econ', label: 'Economy', hero: true, tip: 'Runs conceded ÷ overs, where overs = balls ÷ 6.' },
    { id: 'bowl-avg', label: 'Average', tip: 'Runs conceded ÷ wickets. Lower is better.' },
    { id: 'bowl-sr', label: 'Strike rate', tip: 'Balls bowled ÷ wickets. Lower is better.' },
    { id: 'bowl-dot', label: 'Dot-ball %', tip: 'Dot balls ÷ balls bowled × 100.' },
    { id: 'bowl-mdn', label: 'Maiden %', tip: 'Maidens ÷ completed overs × 100.' },
    { id: 'bowl-xpo', label: 'Extras per over', tip: '(Wides + no-balls) ÷ overs.' },
  ]);
  kpiGrid('k-nrr', [{ id: 'nrr-main', label: 'Net run rate', hero: true, tip: '(Runs scored ÷ overs faced) − (runs conceded ÷ overs bowled), over the whole tournament. A side bowled out counts as facing its full quota.' }]);
  $('#kpi-nrr-main').classList.add('big');
  kpiGrid('k-dls', [
    { id: 'dls-t', label: 'Revised target', hero: true },
    { id: 'dls-r1', label: 'Team 1 resources', tip: 'Share of a 50-over innings\' scoring resources Team 1 had available.' },
    { id: 'dls-r2', label: 'Team 2 resources', tip: 'Resources used before the stoppage plus resources left after it.' },
    { id: 'dls-par', label: 'Par at stoppage', tip: 'The score Team 2 needed at the stoppage to be level if no more play were possible.' },
    { id: 'dls-need', label: 'Needed after restart', tip: 'Revised target − Team 2\'s score at the stoppage.' },
    { id: 'dls-rrr', label: 'Rate after restart', tip: 'Runs needed after the restart ÷ overs left after it.' },
  ]);
  $('#imp-bat').innerHTML = ringMarkup('out of 100');
  $('#imp-bowl').innerHTML = ringMarkup('out of 100');

  restoreGroups();
  $('#custom-overs').value = String(S.customOvers);
  setFormat(S.formatKey, { silent: true });

  // inputs → recalc
  document.addEventListener('input', e => {
    const g = e.target.dataset && e.target.dataset.g;
    if (g && GROUPS[g]) { persistGroup(g); schedule(GROUPS[g].tab); }
  });
  initNRR();

  // header actions
  document.addEventListener('click', async e => {
    const reset = e.target.closest('[data-reset]');
    if (reset) {
      const tab = reset.dataset.reset;
      const names = Object.values(GROUPS).filter(g => g.tab === tab).map(g => g.name);
      resetGroups(names);
      if (tab === 'nrr') resetNRR();
      RENDER[tab]();
      toast('Example numbers restored');
    }
    const sv = e.target.closest('[data-save]');
    if (sv) savePlayer(sv.dataset.save);
    const im = e.target.closest('[data-image]');
    if (im) shareImage(shareDataFor(im.dataset.image));
  });
  $('#cmp-load-a').addEventListener('change', e => { const p = savedPlayers().find(x => x.id === e.target.value); if (p) { loadIntoCompare('a', p); RENDER.compare(); toast(`Loaded ${p.name} as A`); } e.target.value = ''; });
  $('#cmp-load-b').addEventListener('change', e => { const p = savedPlayers().find(x => x.id === e.target.value); if (p) { loadIntoCompare('b', p); RENDER.compare(); toast(`Loaded ${p.name} as B`); } e.target.value = ''; });

  // tabs
  const tabs = $$('.tabs [role=tab]');
  tabs.forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('.tabs').addEventListener('keydown', e => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = tabs.length - 1;
    if (n != null) { e.preventDefault(); tabs[n].focus(); showTab(tabs[n].dataset.tab); }
  });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TAB_KEYS.includes(h) && h !== nav.active) showTab(h); });

  // format
  const fbtns = $$('.format-picker [data-format]');
  fbtns.forEach(b => b.addEventListener('click', () => { if (b.dataset.format !== S.formatKey) setFormat(b.dataset.format); }));
  $('.format-picker').addEventListener('keydown', e => {
    const i = fbtns.indexOf(document.activeElement);
    if (i < 0 || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + fbtns.length) % fbtns.length;
    fbtns[n].focus(); setFormat(fbtns[n].dataset.format);
  });
  let coTimer;
  $('#custom-overs').addEventListener('input', e => {
    const n = Number(e.target.value);
    const ok = Number.isInteger(n) && n >= 1 && n <= 100;
    e.target.classList.toggle('bad', !ok);
    if (!ok) return;
    clearTimeout(coTimer);
    coTimer = setTimeout(() => { S.customOvers = n; store.set('customOvers', n); setFormat('Custom'); }, 350);
  });

  // theme
  $('#theme-toggle').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
    onThemeChange();
  });
  if (window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: light)');
    const h = () => { if (!document.documentElement.dataset.theme) onThemeChange(); };
    mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h);
  }

  // re-layout doughnut legends when crossing the narrow breakpoint
  let wasNarrow = narrow(), rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (narrow() !== wasNarrow) { wasNarrow = narrow(); RENDER[nav.active] && RENDER[nav.active](); } if (!tipEl.hidden) hideTip(); }, 150);
  });

  const start = location.hash.slice(1);
  showTab(TAB_KEYS.includes(start) ? start : store.get('tab', 'batting'));
}

// Expose pure maths for testing in the console.
window.Crease = { parseOvers, fmtOvers, DLS, winProb, batStats, bowlStats, FORMATS };

init();
