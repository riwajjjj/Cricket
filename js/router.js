/* Crease — Tabs: which tab is showing, and rendering it. */
import { charts } from './charts.js';
import { $$, reduceMotion, store } from './utils.js';
/* =====================================================================
   6. Format picker, theme, tabs, scheduling
   ===================================================================== */
export const TAB_KEYS = ['batting', 'bowling', 'nrr', 'dls', 'impact', 'compare', 'live', 'players', 'tournament', 'saved'];
export const appHooks = {}; // filled in by main.js for modules that need start-up functions
export const RENDER = {};
export const nav = { active: null };

export let rafId = 0;
export const pending = new Set();
export function schedule(tab) {
  if (tab !== nav.active) return;
  pending.add(tab);
  if (!rafId) rafId = requestAnimationFrame(() => {
    rafId = 0;
    const list = [...pending];
    pending.clear();
    list.forEach(k => RENDER[k] && RENDER[k]());
  });
}

export function showTab(key, opts = {}) {
  if (!TAB_KEYS.includes(key)) key = 'batting';
  const changed = nav.active !== key;
  nav.active = key;
  $$('.tabs [role=tab]').forEach(b => {
    const on = b.dataset.tab === key;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
    if (on && changed) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  $$('.tab-panel').forEach(p => {
    const on = p.id === 'tab-' + key;
    if (on && p.hidden) {
      p.hidden = false;
      if (!reduceMotion) { p.classList.remove('enter'); void p.offsetWidth; p.classList.add('enter'); }
    } else if (!on) p.hidden = true;
  });
  store.set('tab', key);
  try { if (location.hash !== '#' + key) history.replaceState(null, '', '#' + key); } catch { /* sandboxed */ }
  RENDER[key] && RENDER[key]();
  const panel = document.getElementById('tab-' + key);
  Object.values(charts).forEach(ch => { if (panel.contains(ch.canvas)) ch.resize(); });
  if (opts.scrollTop && changed) window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

