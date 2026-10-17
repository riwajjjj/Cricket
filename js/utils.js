/* Crease — Small helpers shared by every module. */
/* =====================================================================
   1. Small utilities
   ===================================================================== */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const isNum = v => typeof v === 'number' && Number.isFinite(v);
export const sum = a => a.reduce((x, y) => x + y, 0);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// One rounding path for everything shown or exported. A value that rounds to zero never shows a minus sign.
export const nf = (v, dp = 2) => isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }).replace(/^-(0(\.0+)?)$/, '$1') : '—';
// Plain-number text for CSV files (no thousands commas), rounded exactly as nf rounds it on screen.
export const fx = (v, dp = 2) => isNum(v) ? nf(v, dp).replace(/,/g, '') : '';
// The value as displayed, for rating bands, so a figure shown as 38.0 is rated as 38.0.
export const shown = (v, dp = 2) => isNum(v) ? Number(fx(v, dp)) : v;
export const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + 's')}`;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const reduceMotion = typeof window !== 'undefined' && !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
export const FONT = "'Figtree', system-ui, sans-serif";
export const EPS = 1e-9;

export const store = {
  get(k, d) { try { const v = localStorage.getItem('crease.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('crease.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem('crease.' + k); } catch { /* ignore */ } },
};

export function deepMerge(a, b) {
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v !== 'function' && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}