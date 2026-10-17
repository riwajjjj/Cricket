import { showCSV, toCSV } from '../export.js';
import { gid, groupValues, persistGroup, readGroup, setGroup } from '../groups.js';
import { fmtOvers, parseOvers } from '../maths.js';
import { RENDER, showTab } from '../router.js';
import { fmt } from '../state.js';
import { confirmBox, openModal, toast } from '../ui.js';
import { $, esc, fx, nf, store, uid } from '../utils.js';
import { batStats } from './batting.js';
import { bowlStats } from './bowling.js';
import { loadIntoCompare } from './compare.js';
import { live, openScorecard, resumeMatch, scorecardCSV } from './live.js';
/* =====================================================================
   15. SAVED players & matches
   ===================================================================== */
export const savedPlayers = () => { const v = store.get('players', []); return Array.isArray(v) ? v : []; };
export const savedMatches = () => { const v = store.get('matches', []); return Array.isArray(v) ? v : []; };

export function savePlayer(kind) {
  const g = kind === 'bat' ? 'bat' : 'bowl';
  const { v, errs } = readGroup(g);
  if (errs.length) { toast('Fix the highlighted fields first'); return; }
  const name = (v.name || '').trim();
  if (!name) { toast('Add a player name first'); document.getElementById(gid(g, 'name'))?.focus(); return; }
  const list = savedPlayers();
  const data = groupValues(g);
  const existing = list.findIndex(p => p.kind === kind && p.name.toLowerCase() === name.toLowerCase());
  const entry = { id: existing >= 0 ? list[existing].id : uid(), kind, name, format: fmt().label, savedAt: Date.now(), data };
  if (existing >= 0) list[existing] = entry; else list.unshift(entry);
  store.set('players', list);
  toast(existing >= 0 ? `Updated ${name}` : `Saved ${name}`);
}
export function saveMatch(quiet = false) {
  if (!live) return;
  const list = savedMatches();
  const entry = { id: live.id, savedAt: Date.now(), title: `${live.teams[0]} v ${live.teams[1]}`, result: live.result || 'In progress', format: live.format, summary: live.inns.map(i => `${live.teams[i.bat]} ${i.runs}/${i.wkts} (${fmtOvers(i.balls)})`).join(' · '), data: JSON.parse(JSON.stringify(live)) };
  const k = list.findIndex(m => m.id === live.id);
  if (k >= 0) list[k] = entry; else list.unshift(entry);
  store.set('matches', list);
  if (!quiet) toast(k >= 0 ? 'Match updated in Saved' : 'Match saved');
  else if (k < 0) toast('Match finished and saved');
}

RENDER.saved = function renderSaved() {
  const ps = savedPlayers(), ms = savedMatches();
  $('#saved-players').innerHTML = ps.length ? ps.map(p => {
    let mini = '';
    if (p.kind === 'bat') {
      const s = batStats(Object.fromEntries(Object.entries(p.data).map(([k, v]) => [k, k === 'name' ? v : (v === '' ? null : Number(v))])));
      mini = `<div><b>${s.R}</b><span>Runs</span></div><div><b>${nf(s.avg)}</b><span>Average</span></div><div><b>${nf(s.sr)}</b><span>Strike rate</span></div>`;
    } else {
      const d = { ...p.data, overs: parseOvers(p.data.overs).balls };
      Object.keys(d).forEach(k => { if (k !== 'name' && k !== 'overs') d[k] = d[k] === '' ? null : Number(d[k]); });
      const s = bowlStats(d);
      mini = `<div><b>${s.W}</b><span>Wickets</span></div><div><b>${nf(s.econ)}</b><span>Economy</span></div><div><b>${nf(s.avg)}</b><span>Average</span></div>`;
    }
    return `<div class="card saved-card">
      <div class="top"><div><h3>${esc(p.name)}</h3><div class="meta">${p.kind === 'bat' ? 'Batting' : 'Bowling'} · ${esc(p.format)} · ${new Date(p.savedAt).toLocaleDateString()}</div></div></div>
      <div class="mini">${mini}</div>
      <div class="acts">
        <button type="button" class="btn sm" data-sp="open" data-id="${esc(p.id)}">Open</button>
        <button type="button" class="btn ghost sm" data-sp="cmpa" data-id="${esc(p.id)}">Compare as A</button><button type="button" class="btn ghost sm" data-sp="cmpb" data-id="${esc(p.id)}">as B</button>
        <button type="button" class="btn ghost sm danger" data-sp="del" data-id="${esc(p.id)}">Delete</button>
      </div></div>`;
  }).join('') : `<div class="empty-state">No saved players yet. Use “Save player” on the Batting or Bowling tab.</div>`;
  $('#saved-matches').innerHTML = ms.length ? ms.map(m => `<div class="card saved-card">
      <div class="top"><div><h3>${esc(m.title)}</h3><div class="meta">${esc(m.format)} · ${new Date(m.savedAt).toLocaleDateString()}</div></div></div>
      <p style="margin:0;font-weight:700">${esc(m.result)}</p>
      <p class="meta" style="margin:0">${esc(m.summary)}</p>
      <div class="acts">
        <button type="button" class="btn sm" data-sm="view" data-id="${esc(m.id)}">Scorecard</button>
        <button type="button" class="btn ghost sm" data-sm="resume" data-id="${esc(m.id)}">Open in scorer</button>
        <button type="button" class="btn ghost sm" data-sm="csv" data-id="${esc(m.id)}">CSV</button>
        <button type="button" class="btn ghost sm danger" data-sm="del" data-id="${esc(m.id)}">Delete</button>
      </div></div>`).join('') : `<div class="empty-state">No saved matches yet. Score one in the Live scorer and press “Save match”.</div>`;
};
$('#tab-saved').addEventListener('click', async e => {
  const sp = e.target.closest('[data-sp]'), sm = e.target.closest('[data-sm]');
  if (sp) {
    const list = savedPlayers();
    const p = list.find(x => x.id === sp.dataset.id);
    if (!p) return;
    if (sp.dataset.sp === 'open') {
      const g = p.kind === 'bat' ? 'bat' : 'bowl';
      setGroup(g, p.data); persistGroup(g);
      showTab(p.kind === 'bat' ? 'batting' : 'bowling', { scrollTop: true });
      toast(`Loaded ${p.name}`);
    } else if (sp.dataset.sp === 'cmpa' || sp.dataset.sp === 'cmpb') {
      loadIntoCompare(sp.dataset.sp === 'cmpa' ? 'a' : 'b', p);
      showTab('compare', { scrollTop: true });
    } else if (sp.dataset.sp === 'del') {
      if (await confirmBox(`Delete ${p.name}?`, 'This removes the saved player from this browser.', 'Delete', true)) {
        store.set('players', list.filter(x => x.id !== p.id)); RENDER.saved(); toast('Player deleted');
      }
    }
  }
  if (sm) {
    const list = savedMatches();
    const m = list.find(x => x.id === sm.dataset.id);
    if (!m) return;
    if (sm.dataset.sm === 'view') openScorecard({ ...m.data, result: m.data.result || m.result }, m.title);
    else if (sm.dataset.sm === 'csv') showCSV(`${m.title.replace(/\s+/g, '-')}-scorecard.csv`, scorecardCSV(m.data));
    else if (sm.dataset.sm === 'resume') {
      if (live && live.id !== m.id && !(await confirmBox('Replace the current match?', 'The match in the live scorer will be replaced. Save it first if you want to keep it.', 'Replace', true))) return;
      resumeMatch(m.data);
      showTab('live', { scrollTop: true });
    } else if (sm.dataset.sm === 'del') {
      if (await confirmBox(`Delete ${m.title}?`, 'This removes the saved match from this browser.', 'Delete', true)) {
        store.set('matches', list.filter(x => x.id !== m.id)); RENDER.saved(); toast('Match deleted');
      }
    }
  }
});
$('#saved-csv').addEventListener('click', () => {
  const ps = savedPlayers();
  if (!ps.length) { toast('No saved players to export'); return; }
  const rows = [['Name', 'Type', 'Format', 'Runs', 'Balls', 'Innings', 'Not outs', 'Average', 'Strike rate', 'Overs', 'Wickets', 'Runs conceded', 'Economy', 'Bowling average']];
  ps.forEach(p => {
    const d = p.data;
    if (p.kind === 'bat') {
      const s = batStats(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === 'name' ? v : (v === '' ? null : Number(v))])));
      rows.push([p.name, 'Batting', p.format, s.R, s.B, s.I, s.NO, fx(s.avg), fx(s.sr), '', '', '', '', '']);
    } else {
      const v = { ...d, overs: parseOvers(d.overs).balls };
      Object.keys(v).forEach(k => { if (k !== 'name' && k !== 'overs') v[k] = v[k] === '' ? null : Number(v[k]); });
      const s = bowlStats(v);
      rows.push([p.name, 'Bowling', p.format, '', '', '', '', '', '', fmtOvers(s.balls), s.W, s.R, fx(s.econ), fx(s.avg)]);
    }
  });
  showCSV('crease-players.csv', toCSV(rows));
});
$('#saved-clear').addEventListener('click', async () => {
  if (!savedPlayers().length && !savedMatches().length) { toast('Nothing saved yet'); return; }
  if (await confirmBox('Clear everything saved?', 'All saved players and matches will be deleted from this browser. The live match is kept.', 'Delete all', true)) {
    store.set('players', []); store.set('matches', []); RENDER.saved(); toast('Saved items cleared');
  }
});

