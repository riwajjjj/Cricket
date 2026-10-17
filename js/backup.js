/* Crease — backup and restore.
   Everything the app keeps lives in this browser's local storage under "crease.*" keys.
   A backup is one JSON file holding all of it; restoring can merge it in or replace everything. */
import { download } from './export.js';
import { RENDER } from './router.js';
import { closeModal, openModal, toast } from './ui.js';
import { $, esc, plural, store } from './utils.js';
import { matchHooks } from './tabs/live.js';

const PREFIX = 'crease.';
const SKIP = new Set(['liveUndo']); // undo history is large and only useful mid-match

function collect() {
  const data = {};
  try {
    for (let k = 0; k < localStorage.length; k++) {
      const key = localStorage.key(k);
      if (!key || !key.startsWith(PREFIX) || SKIP.has(key.slice(PREFIX.length))) continue;
      try { data[key.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(key)); } catch { /* skip unreadable */ }
    }
  } catch { /* storage blocked */ }
  return { app: 'crease', version: 1, exportedAt: new Date().toISOString(), data };
}
const count = v => Array.isArray(v) ? v.length : 0;
function summarise(d) {
  const parts = [plural(count(d.players), 'saved player'), plural(count(d.matches), 'saved match', 'saved matches')];
  const sq = d.squads && typeof d.squads === 'object' ? Object.keys(d.squads).length : 0;
  if (sq) parts.push(plural(sq, 'team squad'));
  if (count(d.tournaments)) parts.push(plural(count(d.tournaments), 'tournament'));
  const base = d.careerBase && typeof d.careerBase === 'object' ? Object.keys(d.careerBase).length : 0;
  if (base) parts.push(`earlier stats for ${plural(base, 'player')}`);
  if (d.live && Array.isArray(d.live.inns)) parts.push(d.live.status === 'done' ? 'the match open in the live scorer' : 'a match in progress');
  return parts.join(', ');
}
const when = iso => { const t = new Date(iso); return isNaN(t) ? 'an unknown date' : t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };

function updateStatus() {
  const el = $('#backup-status');
  if (!el) return;
  const last = store.get('lastBackup', null);
  const d = collect().data;
  const what = summarise(d);
  if (!last && !count(d.players) && !count(d.matches) && !(d.live && d.live.inns)) {
    el.textContent = 'Nothing saved yet. Once you save players or matches, back them up here so a cleared browser or a new phone doesn\'t lose them.';
    return;
  }
  el.textContent = last
      ? `Last backup: ${when(last)}. This browser now holds ${what}.`
      : `No backup yet. This browser holds ${what}, and nothing else has a copy.`;
}

function backupNow() {
  const b = collect();
  const json = JSON.stringify(b, null, 1);
  const name = `crease-backup-${b.exportedAt.slice(0, 10)}.json`;
  const mark = () => { store.set('lastBackup', b.exportedAt); store.set('nudgeSnooze', 0); hideNudge(); updateStatus(); };
  const body = openModal('Back up everything', `
    <p style="margin:0 0 12px;color:var(--fg-2)">This file holds ${esc(summarise(b.data))}, plus your inputs and settings. Keep it somewhere safe, such as your cloud drive or email.</p>
    <textarea class="csv-box" readonly aria-label="Backup data">${esc(json)}</textarea>
    <p class="hint">If the download button does nothing in this view, copy the text and save it as a .json file.</p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="copy">Copy text</button><button type="button" class="btn" data-x="dl">Download backup</button></div>`, { wide: true });
  body.addEventListener('click', async e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'dl') { download(name, new Blob([json], { type: 'application/json' })); mark(); toast('Backup downloaded'); }
    else {
      try { await navigator.clipboard.writeText(json); mark(); toast('Backup copied'); }
      catch { const t = $('.csv-box', body); t.focus(); t.select(); toast('Select the text and copy it'); }
    }
  });
}

function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { error: 'That isn\'t a Crease backup: the text isn\'t valid JSON.' }; }
  if (!obj || obj.app !== 'crease' || !obj.data || typeof obj.data !== 'object') return { error: 'That file isn\'t a Crease backup.' };
  return { backup: obj };
}

function mergeInto(incoming) {
  const keyOf = p => `${p.kind}|${String(p.name).toLowerCase()}`;
  const newer = (a, b) => ((b?.savedAt || 0) > (a?.savedAt || 0) ? b : a);
  const arr = v => (Array.isArray(v) ? v : []);
  const players = new Map(arr(store.get('players', [])).map(p => [keyOf(p), p]));
  arr(incoming.players).forEach(p => { players.set(keyOf(p), newer(players.get(keyOf(p)), p)); });
  const matches = new Map(arr(store.get('matches', [])).map(m => [m.id, m]));
  arr(incoming.matches).forEach(m => { matches.set(m.id, newer(matches.get(m.id), m)); });
  store.set('players', [...players.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)));
  store.set('matches', [...matches.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)));
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  if (incoming.squads && typeof incoming.squads === 'object') store.set('squads', { ...obj(store.get('squads', {})), ...incoming.squads });
  // Earlier stats: per player, the newer entry wins (what's here, when neither is dated).
  if (incoming.careerBase) {
    const cb = obj(store.get('careerBase', {}));
    Object.entries(obj(incoming.careerBase)).forEach(([k, v]) => { if (!cb[k] || (v?.savedAt || 0) > (cb[k].savedAt || 0)) cb[k] = v; });
    store.set('careerBase', cb);
  }
  // Left-handed batters: anyone marked in either copy stays marked.
  if (incoming.lefties) store.set('lefties', { ...obj(incoming.lefties), ...obj(store.get('lefties', {})) });
  // Tournaments by id; for the same tournament the newer copy wins (or, without dates, the one with more results).
  if (Array.isArray(incoming.tournaments)) {
    const played = t => (t.fixtures || []).filter(f => f.matchId || f.manual || f.nr).length;
    const wins = (a, b) => (a.updated || b.updated ? (a.updated || 0) > (b.updated || 0) : played(a) > played(b));
    const here = store.get('tournaments', []);
    const ts = new Map((Array.isArray(here) ? here : []).map(t => [t.id, t]));
    incoming.tournaments.forEach(t => { if (!t || !t.id) return; const h = ts.get(t.id); if (!h || wins(t, h)) ts.set(t.id, t); });
    store.set('tournaments', [...ts.values()]);
  }
  if (incoming.live && !store.get('live', null)) store.set('live', incoming.live);
}
function replaceWith(incoming) {
  try {
    const old = [];
    for (let k = 0; k < localStorage.length; k++) { const key = localStorage.key(k); if (key && key.startsWith(PREFIX)) old.push(key); }
    old.forEach(k => localStorage.removeItem(k));
  } catch { /* storage blocked */ }
  Object.entries(incoming).forEach(([k, v]) => store.set(k, v));
}

function restoreDialog() {
  let parsed = null;
  const body = openModal('Restore from a backup', `
    <div class="modal-block"><p class="modal-sub">Choose the backup file</p><input type="file" id="rs-file" accept=".json,application/json" class="file-input"></div>
    <div class="modal-block"><p class="modal-sub">Or paste the backup text</p><textarea id="rs-text" class="csv-box" style="min-height:110px" placeholder='{"app":"crease", …}' aria-label="Backup text"></textarea></div>
    <p class="answer" id="rs-sum" style="display:block" hidden></p>
    <div class="modal-block" id="rs-mode" hidden>
      <p class="modal-sub">How to restore</p>
      <div class="seg"><button type="button" data-mode="merge" aria-pressed="true">Merge with what's here</button><button type="button" data-mode="replace" aria-pressed="false">Replace everything</button></div>
      <p class="hint" id="rs-mode-note">Adds the backup's players, matches, squads, tournaments and earlier stats. Where both have the same one, the newer copy wins. Your settings stay as they are.</p>
    </div>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok" disabled>Restore</button></div>`, { wide: true });
  let mode = 'merge';
  const ok = $('[data-x="ok"]', body), sum = $('#rs-sum', body);
  const show = text => {
    const r = parseBackup(text);
    parsed = r.backup || null;
    sum.hidden = false;
    sum.className = 'answer ' + (parsed ? 'good' : 'bad');
    sum.innerHTML = parsed ? `Backup from <strong>${esc(when(parsed.exportedAt))}</strong> with ${esc(summarise(parsed.data))}.` : esc(r.error);
    $('#rs-mode', body).hidden = !parsed;
    ok.disabled = !parsed;
  };
  $('#rs-file', body).addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { show('{}'); sum.textContent = 'That file is too large to be a Crease backup.'; return; }
    const rd = new FileReader();
    rd.onload = () => { $('#rs-text', body).value = ''; show(String(rd.result || '')); };
    rd.onerror = () => { sum.hidden = false; sum.className = 'answer bad'; sum.textContent = 'The file couldn\'t be read.'; };
    rd.readAsText(f);
  });
  $('#rs-text', body).addEventListener('input', e => { if (e.target.value.trim()) show(e.target.value); else { sum.hidden = true; ok.disabled = true; $('#rs-mode', body).hidden = true; } });
  body.addEventListener('click', e => {
    const m = e.target.closest('[data-mode]'), x = e.target.closest('[data-x]');
    if (m) {
      mode = m.dataset.mode;
      body.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      $('#rs-mode-note', body).textContent = mode === 'merge'
          ? 'Adds the backup\'s players, matches, squads, tournaments and earlier stats. Where both have the same one, the newer copy wins. Your settings stay as they are.'
          : 'Deletes everything Crease keeps in this browser, including any match in progress, and puts the backup in its place.';
      ok.className = 'btn' + (mode === 'replace' ? ' solid-danger' : '');
      ok.textContent = mode === 'replace' ? 'Replace everything' : 'Restore';
    }
    if (x) {
      if (x.dataset.x === 'cancel') { closeModal(); return; }
      if (!parsed) return;
      if (mode === 'replace') replaceWith(parsed.data); else mergeInto(parsed.data);
      closeModal();
      toast('Backup restored. Reloading…');
      setTimeout(() => location.reload(), 700); // start fresh so every tab reads the restored data
    }
  });
}

$('#backup-now').addEventListener('click', backupNow);
$('#backup-restore').addEventListener('click', restoreDialog);
const renderSaved = RENDER.saved;
RENDER.saved = () => { renderSaved && renderSaved(); updateStatus(); };

/* ---------- Reminder ----------
   After a match finishes, a small bar suggests a backup once three or more finished matches exist
   that no backup has. "Later" waits for three more. On opening the app, it shows at most every few days. */
const NUDGE_EVERY = 3, NUDGE_GAP = 3 * 24 * 3600 * 1000;
function sinceBackup() {
  const last = Date.parse(store.get('lastBackup', '') || '') || 0;
  const ms = store.get('matches', []);
  const matches = (Array.isArray(ms) ? ms : []).filter(m => m && m.data && m.data.status === 'done' && (m.savedAt || 0) > last).length;
  return { matches, last };
}
function hideNudge() { const bar = $('#nudge'); if (bar) bar.hidden = true; }
function nudge({ onLoad = false } = {}) {
  const { matches, last } = sinceBackup();
  const snoozed = Number(store.get('nudgeSnooze', 0)) || 0;
  if (matches < NUDGE_EVERY || matches < snoozed + NUDGE_EVERY) return;
  if (onLoad && Date.now() - (Number(store.get('nudgeShown', 0)) || 0) < NUDGE_GAP) return;
  let bar = $('#nudge');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'nudge'; bar.className = 'nudge'; bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-n]');
      if (!b) return;
      hideNudge();
      if (b.dataset.n === 'now') backupNow();
      else store.set('nudgeSnooze', sinceBackup().matches);
    });
  }
  bar.innerHTML = `<p><strong>${plural(matches, 'finished match', 'finished matches')}</strong> ${last ? 'since your last backup' : 'and no backup yet'}. They're only kept in this browser.</p>
    <div class="nudge-acts"><button type="button" class="btn sm" data-n="now">Back up now</button><button type="button" class="btn ghost sm" data-n="later">Later</button></div>`;
  bar.hidden = false;
  store.set('nudgeShown', Date.now());
}
matchHooks.done.push(() => { setTimeout(() => nudge(), 2800); }); // after the "match saved" toast
setTimeout(() => nudge({ onLoad: true }), 3000);