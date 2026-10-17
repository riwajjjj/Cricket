/* Crease — UI building blocks: KPI tiles, counters, warnings, tooltip, modal, toast and the gauge. */
import { tipBtn } from './groups.js';
import { RATINGS } from './maths.js';
import { $, $$, EPS, clamp, esc, isNum, nf, reduceMotion } from './utils.js';
/* =====================================================================
   4. UI building blocks: KPI tiles, counters, warnings, tooltip, modal, toast
   ===================================================================== */
export function kpiGrid(id, defs) {
  $('#' + id).innerHTML = defs.map(d => `
    <div class="kpi${d.hero ? ' hero' : ''}" id="kpi-${d.id}">
      <div class="kpi-top"><span class="kpi-label">${esc(d.label)}</span>${d.tip ? tipBtn(d.tip, d.label) : ''}</div>
      <div class="kpi-v">—</div>
      <div class="kpi-foot"><span class="chip"></span><span class="kpi-sub"></span></div>
    </div>`).join('');
}
export function tween(el, to, dp = 2, suffix = '', signed = false) {
  if (!el) return;
  cancelAnimationFrame(el._raf);
  const show = v => {
    const sign = signed && v > 0.00049 ? '+' : '';
    el.innerHTML = sign + nf(v, dp) + (suffix ? `<small>${esc(suffix)}</small>` : '');
  };
  if (typeof to === 'string') { el._v = null; el.textContent = to; return; }
  if (!isNum(to)) { el._v = null; el.textContent = '—'; return; }
  const from = isNum(el._v) ? el._v : 0;
  el._v = to;
  if (reduceMotion || Math.abs(from - to) < EPS) { show(to); return; }
  const t0 = performance.now(), dur = 420;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    show(p >= 1 ? to : from + (to - from) * e);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
export function setKPI(id, value, o = {}) {
  const k = document.getElementById('kpi-' + id);
  if (!k) return;
  tween(k.querySelector('.kpi-v'), value, o.dp ?? 2, isNum(value) ? (o.suffix || '') : '', o.signed);
  k.classList.remove('r0', 'r1', 'r2', 'r3');
  const chip = k.querySelector('.chip');
  chip.className = 'chip';
  const r = isNum(value) ? o.rating : null;
  if (r != null) { k.classList.add('r' + r); chip.classList.add('r' + r); chip.textContent = o.chip || RATINGS[r]; }
  else chip.textContent = '';
  k.querySelector('.kpi-sub').textContent = o.sub || '';
}
export function setWarns(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  const list = items.filter(Boolean).map(i => typeof i === 'string' ? { t: i, level: 'warn' } : i);
  el.hidden = !list.length;
  el.innerHTML = list.map(i => `<li class="${i.level}">${esc(i.t)}</li>`).join('');
}
export const errItems = errs => errs.map(t => ({ t, level: 'err' }));

export function answer(big, html, cls = '', formula = '') {
  return `<div class="answer ${cls}"><div class="big">${big}</div><p>${html}${formula ? `<span class="formula">${esc(formula)}</span>` : ''}</p></div>`;
}

// Tooltip: one floating element, positioned and clamped to the viewport.
export const tipEl = $('#tooltip');
export let tipOwner = null;
export function showTip(btn) {
  tipOwner = btn;
  tipEl.textContent = btn.dataset.tip;
  tipEl.hidden = false;
  const r = btn.getBoundingClientRect();
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  const x = clamp(r.left + r.width / 2 - tw / 2, 8, window.innerWidth - tw - 8);
  let y = r.top - th - 8;
  if (y < 8) y = r.bottom + 8;
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
}
export function hideTip() { tipEl.hidden = true; tipOwner = null; }
document.addEventListener('mouseover', e => { const t = e.target.closest('.tip'); if (t && t !== tipOwner) showTip(t); });
document.addEventListener('mouseout', e => { const t = e.target.closest('.tip'); if (t && !t.contains(e.relatedTarget) && document.activeElement !== t) hideTip(); });
document.addEventListener('focusin', e => { const t = e.target.closest('.tip'); if (t) showTip(t); });
document.addEventListener('focusout', e => { if (e.target.closest('.tip')) hideTip(); });
document.addEventListener('click', e => {
  const t = e.target.closest('.tip');
  if (t) { e.preventDefault(); if (tipOwner === t && !tipEl.hidden) hideTip(); else showTip(t); }
  else if (!tipEl.hidden) hideTip();
});
window.addEventListener('scroll', () => { if (!tipEl.hidden) hideTip(); }, { passive: true });

// Toast
export let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// Modal
export const modal = $('#modal');
export let modalOnClose = null, lastFocus = null;
export function openModal(title, html, { wide = false, onClose = null } = {}) {
  lastFocus = document.activeElement;
  $('#modal-title').textContent = title;
  // A fresh inner container per dialog, so listeners from an earlier dialog can never fire again.
  const host = $('#modal-body');
  host.innerHTML = '';
  const body = document.createElement('div');
  body.innerHTML = html;
  host.appendChild(body);
  modal.querySelector('.modal-card').classList.toggle('wide', wide);
  modal.hidden = false;
  modalOnClose = onClose;
  document.body.style.overflow = 'hidden';
  const first = body.querySelector('input, select, textarea, button:not(.icon-btn)') || $('#modal-close');
  setTimeout(() => first && first.focus({ preventScroll: true }), 30);
  return body;
}
export function closeModal() {
  if (modal.hidden) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  $('#modal-body').innerHTML = '';
  const cb = modalOnClose; modalOnClose = null;
  if (cb) cb();
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}
$('#modal-close').addEventListener('click', closeModal);
modal.addEventListener('mousedown', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => {
  if (modal.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
  if (e.key === 'Tab') { // keep focus inside the dialog
    const f = $$('button, input, select, textarea, [tabindex]:not([tabindex="-1"])', modal).filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
});
export function confirmBox(title, message, okLabel = 'Confirm', danger = false) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const body = openModal(title, `<p style="margin:0;color:var(--fg-2)">${esc(message)}</p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-x="no">Cancel</button><button type="button" class="btn ${danger ? 'solid-danger' : ''}" data-x="yes">${esc(okLabel)}</button></div>`,
      { onClose: () => finish(false) });
    body.addEventListener('click', e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      const yes = b.dataset.x === 'yes';
      finish(yes);
      closeModal();
    });
  });
}

/* =====================================================================
   9. GAUGE (used by the live scorer)
   ===================================================================== */
export function gaugeMarkup() {
  return `<svg viewBox="0 0 220 132" role="img" aria-label="Win probability gauge">
    <path class="g-track" d="M20 112 A90 90 0 0 1 200 112" pathLength="100"/>
    <path class="g-val" d="M20 112 A90 90 0 0 1 200 112" pathLength="100" stroke-dasharray="0 100"/>
    <text class="g-num" x="110" y="100">—</text>
    <text class="g-cap" x="110" y="127">Chasing side</text>
  </svg>
  <div class="g-legend"><span class="g-l"></span><span class="g-r"></span></div>
  <p class="hint g-note" hidden></p>
  <ul class="g-facts" hidden></ul>`;
}
export function setGauge(root, p, left, right, note) {
  const val = root.querySelector('.g-val'), num = root.querySelector('.g-num');
  const ok = isNum(p);
  const pv = ok ? clamp(p, 0, 100) : 0;
  val.setAttribute('stroke-dasharray', `${pv} 100`);
  val.style.strokeOpacity = pv < 0.6 ? 0 : 1;
  val.style.stroke = !ok ? 'var(--line)' : pv < 35 ? 'var(--ball)' : pv < 65 ? 'var(--accent)' : 'var(--turf)';
  num.textContent = ok ? `${Math.round(pv)}%` : '—';
  root.querySelector('.g-l').innerHTML = left || '';
  root.querySelector('.g-r').innerHTML = right || '';
  const n = root.querySelector('.g-note');
  n.hidden = !note;
  n.textContent = note || '';
}


