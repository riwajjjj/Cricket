/* Crease — Input groups: field config, building, reading and saving inputs. */
import { parseOvers } from './maths.js';
import { fmt } from './state.js';
import { $$, esc, store } from './utils.js';
/* =====================================================================
   3. Input groups: field config, building, reading, persistence
   ===================================================================== */
export const GROUPS = {};
export const dirty = store.get('dirty', {});
export function group(name, tab, fields, example) { GROUPS[name] = { name, tab, fields, example }; }
export const gid = (g, k) => `${g}-${k}`;

export function tipBtn(text, label) {
  return `<button type="button" class="tip" data-tip="${esc(text)}" aria-label="How ${esc(label)} works">i</button>`;
}
export function fieldHTML(g, f) {
  const kind = f.type || 'int';
  const im = kind === 'text' || kind === 'snum' ? 'text' : kind === 'int' ? 'numeric' : 'decimal';
  return `<div class="field${f.wide ? ' wide' : ''}">
    <div class="lab"><label for="${gid(g, f.k)}">${esc(f.label)}</label>${f.tip ? tipBtn(f.tip, f.label) : ''}</div>
    <input id="${gid(g, f.k)}" type="text" inputmode="${im}" autocomplete="off" spellcheck="false" data-g="${g}"${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}${f.maxlen ? ` maxlength="${f.maxlen}"` : ''}>
  </div>`;
}
export function buildGroups() {
  $$('[data-group]').forEach(c => {
    const g = GROUPS[c.dataset.group];
    if (g) c.innerHTML = g.fields.map(f => fieldHTML(g.name, f)).join('');
  });
}
export function exampleValues(name) {
  const G = GROUPS[name];
  const base = Object.fromEntries(G.fields.map(f => [f.k, f.def ?? '']));
  return G.example ? { ...base, ...G.example(fmt()) } : base;
}
export function setGroup(name, vals) {
  for (const f of GROUPS[name].fields) {
    const el = document.getElementById(gid(name, f.k));
    if (!el) continue;
    if (vals[f.k] !== undefined && vals[f.k] !== null) el.value = String(vals[f.k]);
    el.classList.remove('bad');
    el.removeAttribute('aria-invalid');
  }
}
export function groupValues(name) {
  return Object.fromEntries(GROUPS[name].fields.map(f => [f.k, document.getElementById(gid(name, f.k))?.value ?? '']));
}
export function readGroup(name) {
  const v = {}, errs = [];
  for (const f of GROUPS[name].fields) {
    const el = document.getElementById(gid(name, f.k));
    const s = (el?.value ?? '').trim().replace(/,/g, '').replace(/[\u2212\u2013]/g, '-'); // accept a typographic minus
    const kind = f.type || 'int';
    let out = null, bad = false;
    if (kind === 'text') out = (el?.value ?? '').trim();
    else if (s === '') out = null;
    else if (kind === 'overs') {
      const p = parseOvers(s);
      if (p.error) { bad = true; errs.push(`${f.label}: ${p.error}.`); } else out = p.balls;
    } else {
      const n = Number(s);
      const min = f.min ?? 0;
      if (!Number.isFinite(n)) { bad = true; errs.push(`${f.label} needs a number.`); }
      else if (n < min) { bad = true; errs.push(`${f.label} can't be negative.`); }
      else if (kind === 'int' && !Number.isInteger(n)) { bad = true; errs.push(`${f.label} must be a whole number.`); }
      else if (f.max != null && n > f.max) { bad = true; errs.push(`${f.label} can't be more than ${f.max}.`); }
      else out = n;
    }
    if (el) { el.classList.toggle('bad', bad); if (bad) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); }
    v[f.k] = out;
  }
  return { v, errs };
}
export const saveTimers = {};
export function persistGroup(name) {
  dirty[name] = true;
  clearTimeout(saveTimers[name]);
  saveTimers[name] = setTimeout(() => { store.set('g.' + name, groupValues(name)); store.set('dirty', dirty); }, 250);
}
export function restoreGroups() {
  for (const name of Object.keys(GROUPS)) {
    const saved = store.get('g.' + name, null);
    setGroup(name, saved && dirty[name] ? { ...exampleValues(name), ...saved } : exampleValues(name));
  }
}
export function resetGroups(names) {
  for (const n of names) {
    clearTimeout(saveTimers[n]); // a save still waiting from the last keystroke would bring the old values back
    setGroup(n, exampleValues(n));
    delete dirty[n];
    store.del('g.' + n);
  }
  store.set('dirty', dirty);
}

