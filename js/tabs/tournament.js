/* Crease — Tournament tab: teams, fixtures, results and a points table with net run rate.
   Results come from matches scored in the live scorer (linked automatically when a fixture is
   scored from here), from a saved match linked by hand, or from scores typed in. */
import { fmtOvers, parseOvers } from '../maths.js';
import { buildRecords, finishedMatches } from '../records.js';
import { RENDER, appHooks, showTab } from '../router.js';
import { fixtureOutcome, pointsTable } from '../stats.js';
import { closeModal, confirmBox, openModal, toast } from '../ui.js';
import { $, esc, nf, plural, store, uid } from '../utils.js';
import { clearLive, live, matchHooks, scorecardHTML, setupFromFixture } from './live.js';
import { loadNRR } from './nrr.js';
import { saveMatch } from './saved.js';

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const list = () => { const v = store.get('tournaments', []); return Array.isArray(v) ? v : []; };
const saveAll = ts => store.set('tournaments', ts);
const activeId = () => store.get('tour.active', null);
function active() { const ts = list(); return ts.find(t => t.id === activeId()) || ts[0] || null; }
function update(t) { t.updated = Date.now(); const ts = list(); const k = ts.findIndex(x => x.id === t.id); if (k >= 0) ts[k] = t; else ts.push(t); saveAll(ts); }

/* ---------- Results ---------- */
const outcome = fixtureOutcome;
const table = t => pointsTable(t, finishedMatches());
const signed = v => v == null ? '—' : (v > 0.0005 ? '+' : '') + nf(v, 3);

/* ---------- Render ---------- */
RENDER.tournament = function renderTournament() {
  const ts = list();
  const t = active();
  const sel = $('#tr-select');
  sel.innerHTML = ts.map(x => `<option value="${esc(x.id)}"${t && x.id === t.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  sel.hidden = ts.length < 2;
  $('#tr-edit').hidden = $('#tr-delete').hidden = !t;
  $('#tr-title').textContent = t ? t.name : 'Tournaments';
  const main = $('#tr-main');
  if (!t) {
    main.innerHTML = `<div class="empty-state" style="text-align:left">
      <p style="margin:0 0 6px;font-weight:700;color:var(--fg)">No tournament yet</p>
      <p style="margin:0 0 14px">Add the teams once, generate the fixtures, then score each match from here. The points table and net run rates update themselves.</p>
      <button type="button" class="btn" data-tr="new">Create a tournament</button></div>`;
    return;
  }
  const byId = new Map(finishedMatches().map(m => [m.id, m]));
  const rows = table(t);
  const played = t.fixtures.filter(f => { const o = outcome(t, f, byId); return o && !o.error; }).length;
  const linked = t.fixtures.map(f => f.matchId && byId.get(f.matchId)).filter(Boolean);
  const rec = buildRecords(linked, { includeBase: false });
  const top = (fn, n = 5) => [...rec.values()].filter(fn.ok).sort(fn.sort).slice(0, n);
  const bats = top({ ok: r => r.bat.inns > 0, sort: (a, b) => b.bat.runs - a.bat.runs || (a.bat.balls - b.bat.balls) });
  const bowls = top({ ok: r => r.bowl.wkts > 0, sort: (a, b) => b.bowl.wkts - a.bowl.wkts || a.bowl.runs - b.bowl.runs });
  const fx = t.fixtures.map((f, k) => {
    const o = outcome(t, f, byId);
    const pending = live && live.tournament && live.tournament.tid === t.id && live.tournament.fid === f.id && live.status !== 'done';
    let status, actions;
    if (o && !o.error) {
      status = `<span class="${o.nr ? 'dim' : ''}">${esc(o.text || '')}</span>`;
      actions = `${o.linked ? `<button type="button" class="btn ghost sm" data-tr="card" data-f="${f.id}">Scorecard</button>` : ''}<button type="button" class="btn ghost sm" data-tr="clear" data-f="${f.id}">Clear result</button>`;
    } else {
      status = pending ? '<span class="badge live" style="font-size:.65rem">Being scored</span>' : o?.error ? `<span class="neg">${esc(o.error)}</span>` : '<span class="dim">Not played yet</span>';
      actions = `<button type="button" class="btn sm" data-tr="score" data-f="${f.id}">${pending ? 'Open scorer' : 'Score live'}</button>
        <button type="button" class="btn ghost sm" data-tr="manual" data-f="${f.id}">Enter result</button>
        <button type="button" class="btn ghost sm" data-tr="link" data-f="${f.id}">Link a saved match</button>
        <button type="button" class="btn ghost sm" data-tr="nr" data-f="${f.id}">No result</button>`;
    }
    return `<div class="fx-row"><div class="fx-main"><span class="fx-no">${k + 1}</span><div><div class="fx-teams">${esc(f.a)} <span class="dim">v</span> ${esc(f.b)}</div><div class="fx-status">${status}</div></div></div>
      <div class="fx-acts">${actions}<button type="button" class="row-del" data-tr="remove" data-f="${f.id}" aria-label="Remove fixture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>`;
  }).join('');
  main.innerHTML = `
    <div class="card">
      <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">Points table</h2><span class="hint" style="margin:0">${plural(played, 'result')} of ${plural(t.fixtures.length, 'fixture')} · ${t.overs ? `${t.overs} overs a side` : 'no fixed overs'} · Win ${t.pts.w}, tie ${t.pts.t}, no result ${t.pts.nr}</span></div>
      <div class="tbl-wrap" style="margin-top:0"><table class="tbl pts-tbl"><thead><tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">NR</th><th class="num">Pts</th><th class="num">NRR</th><th></th></tr></thead>
      <tbody>${rows.map((r, k) => `<tr${k === 0 && r.p ? ' class="hl"' : ''}><td class="dim">${k + 1}</td><td><b>${esc(r.team)}</b></td><td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.tie}</td><td class="num">${r.nr}</td><td class="num"><b>${r.pts}</b></td><td class="num ${r.nrr == null ? 'dim' : r.nrr >= 0 ? 'pos' : 'neg'}">${signed(r.nrr)}</td>
        <td class="num">${r.p - r.nr > 0 ? `<button type="button" class="btn ghost sm" data-tr="nrr" data-team="${esc(r.team)}">NRR solver</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Sorted by points, then net run rate. A side bowled out counts as facing its full ${t.overs ? `${t.overs} overs` : 'quota'}. “NRR solver” opens the Net run rate tab with that team's results, to work out the margin they need.</p>
    </div>
    <div class="card">
      <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">Fixtures and results</h2>
        <div class="head-actions" style="width:auto"><button type="button" class="btn ghost sm" data-tr="rr">Add round-robin fixtures</button><button type="button" class="btn ghost sm" data-tr="addfx">Add a fixture</button></div></div>
      ${fx || '<p class="hint" style="margin:0">No fixtures yet. “Add round-robin fixtures” creates one match between every pair of teams.</p>'}
    </div>
    <div class="grid-2">
      <div class="card"><h2 class="card-title">Most runs</h2>${bats.length ? `<table class="tbl"><tbody>${bats.map((r, k) => `<tr><td class="dim">${k + 1}</td><td>${esc(r.name)}<div class="dim" style="font-size:.78rem">${esc([...r.teams].join(', '))}</div></td><td class="num"><b>${r.bat.runs}</b></td><td class="num dim">${r.bat.balls ? (r.bat.runs / r.bat.balls * 100).toFixed(1) : '—'} SR</td></tr>`).join('')}</tbody></table>` : '<p class="hint" style="margin:0">Appears once a scored match is linked.</p>'}</div>
      <div class="card"><h2 class="card-title">Most wickets</h2>${bowls.length ? `<table class="tbl"><tbody>${bowls.map((r, k) => `<tr><td class="dim">${k + 1}</td><td>${esc(r.name)}<div class="dim" style="font-size:.78rem">${esc([...r.teams].join(', '))}</div></td><td class="num"><b>${r.bowl.wkts}</b></td><td class="num dim">${r.bowl.balls ? (r.bowl.runs / (r.bowl.balls / 6)).toFixed(2) : '—'} econ</td></tr>`).join('')}</tbody></table>` : '<p class="hint" style="margin:0">Appears once a scored match is linked.</p>'}</div>
    </div>`;
};

/* ---------- Editing a tournament ---------- */
function tournamentForm(t) {
  const body = openModal(t ? 'Edit tournament' : 'New tournament', `
    <div class="fields">
      <div class="field wide"><div class="lab"><label for="tf-name">Name</label></div><input id="tf-name" type="text" maxlength="50" autocomplete="off" value="${esc(t?.name || '')}" placeholder="e.g. Valley Premier League 2026"></div>
      <div class="field"><div class="lab"><label for="tf-overs">Overs per side</label></div><input id="tf-overs" type="text" inputmode="numeric" autocomplete="off" value="${esc(t?.overs ?? 20)}"></div>
      <div class="field wide"><div class="lab"><label for="tf-teams">Teams, one per line</label></div><textarea id="tf-teams" rows="6" spellcheck="false" placeholder="Falcons&#10;Rhinos&#10;Tigers&#10;Eagles">${esc((t?.teams || []).join('\n'))}</textarea></div>
    </div>
    <p class="modal-sub" style="margin-top:14px">Points</p>
    <div class="fields three">
      <div class="field"><div class="lab"><label for="tf-w">Win</label></div><input id="tf-w" type="text" inputmode="numeric" value="${esc(t?.pts?.w ?? 2)}"></div>
      <div class="field"><div class="lab"><label for="tf-t">Tie</label></div><input id="tf-t" type="text" inputmode="numeric" value="${esc(t?.pts?.t ?? 1)}"></div>
      <div class="field"><div class="lab"><label for="tf-nr">No result</label></div><input id="tf-nr" type="text" inputmode="numeric" value="${esc(t?.pts?.nr ?? 1)}"></div>
    </div>
    ${t ? '<p class="hint">Renaming a team here keeps its fixtures, as long as it stays on the same line. Removing a team removes its fixtures.</p>' : ''}
    <p class="err-text" id="tf-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">${t ? 'Save changes' : 'Create tournament'}</button></div>`, { wide: true });
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const err = $('#tf-err', body);
    const name = $('#tf-name', body).value.trim();
    const overs = Number($('#tf-overs', body).value.trim());
    const teams = $('#tf-teams', body).value.split('\n').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const pts = { w: Number($('#tf-w', body).value), t: Number($('#tf-t', body).value), nr: Number($('#tf-nr', body).value), l: 0 };
    if (!name) { err.textContent = 'Give the tournament a name.'; return; }
    if (!Number.isInteger(overs) || overs < 1 || overs > 200) { err.textContent = 'Overs per side must be a whole number from 1 to 200.'; return; }
    if (teams.length < 2) { err.textContent = 'Add at least two teams.'; return; }
    const dup = teams.find((n, k) => teams.findIndex(x2 => same(x2, n)) !== k);
    if (dup) { err.textContent = `“${dup}” is listed twice.`; return; }
    if (Object.values(pts).some(v => !Number.isInteger(v) || v < 0)) { err.textContent = 'Points must be whole numbers.'; return; }
    let fixtures = [];
    if (t) {
      const ren = new Map();
      if (t.teams.length === teams.length) t.teams.forEach((old, k) => { if (old !== teams[k]) ren.set(old, teams[k]); });
      fixtures = t.fixtures.map(f => ({ ...f, a: ren.get(f.a) || f.a, b: ren.get(f.b) || f.b })).filter(f => teams.includes(f.a) && teams.includes(f.b));
    }
    const nt = { ...(t || { id: uid(), created: Date.now() }), name, overs, teams, pts, fixtures };
    update(nt);
    store.set('tour.active', nt.id);
    closeModal();
    RENDER.tournament();
    toast(t ? 'Tournament updated' : 'Tournament created. Add the fixtures next.');
  });
}

function manualForm(t, f) {
  const side = (k, label) => `<p class="modal-sub" style="margin-top:12px">${esc(label)}</p><div class="fields three">
    <div class="field"><div class="lab"><label for="mr-${k}-r">Runs</label></div><input id="mr-${k}-r" type="text" inputmode="numeric" autocomplete="off"></div>
    <div class="field"><div class="lab"><label for="mr-${k}-w">Wickets</label></div><input id="mr-${k}-w" type="text" inputmode="numeric" autocomplete="off"></div>
    <div class="field"><div class="lab"><label for="mr-${k}-o">Overs</label></div><input id="mr-${k}-o" type="text" inputmode="decimal" autocomplete="off" value="${esc(t.overs ?? '')}"></div>
  </div><label class="check" style="margin-top:8px"><input type="checkbox" id="mr-${k}-ao"> All out</label>`;
  const body = openModal(`Enter result: ${f.a} v ${f.b}`, `
    <p class="hint" style="margin:-6px 0 4px">For a match you didn't score in Crease. The higher score wins; equal scores are a tie.</p>
    ${side('a', f.a)}${side('b', f.b)}
    <p class="err-text" id="mr-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save result</button></div>`);
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const err = $('#mr-err', body);
    const read = k => {
      const r = $(`#mr-${k}-r`, body).value.trim(), w = $(`#mr-${k}-w`, body).value.trim(), o = parseOvers($(`#mr-${k}-o`, body).value);
      const ao = $(`#mr-${k}-ao`, body).checked;
      const team = k === 'a' ? f.a : f.b;
      if (!/^\d+$/.test(r)) return `${team}: enter the runs scored.`;
      if (w && (!/^\d+$/.test(w) || Number(w) > 10)) return `${team}: wickets must be 0 to 10.`;
      if (o.error || !o.balls) return `${team}: enter the overs faced, like 18.4.`;
      if (t.overs && o.balls > t.overs * 6) return `${team}: that's more than ${t.overs} overs.`;
      return { r: Number(r), w: w === '' ? (ao ? 10 : null) : Number(w), balls: o.balls, ao };
    };
    const A = read('a'), B = read('b');
    if (typeof A === 'string') { err.textContent = A; return; }
    if (typeof B === 'string') { err.textContent = B; return; }
    f.manual = { a: A, b: B }; f.matchId = null; f.nr = false;
    update(t); closeModal(); RENDER.tournament(); toast('Result saved');
  });
}

function linkForm(t, f) {
  const ms = finishedMatches();
  const fit = ms.filter(m => m.data.teams.some(x => same(x, f.a)) && m.data.teams.some(x => same(x, f.b)));
  const others = ms.filter(m => !fit.includes(m));
  const opt = m => `<option value="${esc(m.id)}">${esc(m.title)} · ${esc(m.result)} · ${new Date(m.savedAt).toLocaleDateString()}</option>`;
  if (!ms.length) { toast('There are no finished saved matches to link yet.'); return; }
  const body = openModal(`Link a match: ${f.a} v ${f.b}`, `
    <div class="field"><div class="lab"><label for="lk-m">Saved match</label></div><select id="lk-m">${fit.length ? `<optgroup label="Between these teams">${fit.map(opt).join('')}</optgroup>` : ''}${others.length ? `<optgroup label="Other matches">${others.map(opt).join('')}</optgroup>` : ''}</select></div>
    <p class="hint">The result, scores and player stats come from the saved scorecard.</p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Link match</button></div>`);
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'ok') {
      f.matchId = $('#lk-m', body).value; f.manual = null; f.nr = false;
      update(t); toast('Match linked');
    }
    closeModal(); RENDER.tournament();
  });
}

async function scoreFixture(t, f) {
  const pendingHere = live && live.tournament && live.tournament.fid === f.id && live.status !== 'done';
  if (pendingHere) { showTab('live', { scrollTop: true }); return; }
  if (live && live.status !== 'done') {
    if (!(await confirmBox('Replace the match in the live scorer?', 'The match currently in the live scorer is saved to Saved matches first, so nothing is lost.', 'Save it and continue'))) return;
    saveMatch(true);
  }
  clearLive();
  setupFromFixture({ ta: f.a, tb: f.b, overs: t.overs, link: { tid: t.id, fid: f.id }, label: `${t.name}: ${f.a} v ${f.b}` });
  showTab('live', { scrollTop: true });
}

function sendToNRR(t, team) {
  const byId = new Map(finishedMatches().map(m => [m.id, m]));
  const rows = [];
  t.fixtures.forEach(f => {
    if (!same(f.a, team) && !same(f.b, team)) return;
    const o = outcome(t, f, byId);
    if (!o || o.error || o.nr) return;
    const me = same(f.a, team) ? 'a' : 'b', them = me === 'a' ? 'b' : 'a';
    rows.push({ opp: me === 'a' ? f.b : f.a, rf: String(o[me].r), of: fmtOvers(o[me].balls), fao: !!o[me].ao, ra: String(o[them].r), ob: fmtOvers(o[them].balls), oao: !!o[them].ao });
  });
  if (!rows.length) { toast(`${team} has no results with scores yet.`); return; }
  appHooks.useOvers && appHooks.useOvers(t.overs);
  loadNRR(rows);
  showTab('nrr', { scrollTop: true });
  toast(`${team}'s results loaded into the NRR tab`);
}

/* ---------- Wiring ---------- */
$('#tr-new').addEventListener('click', () => tournamentForm(null));
$('#tr-edit').addEventListener('click', () => { const t = active(); if (t) tournamentForm(t); });
$('#tr-delete').addEventListener('click', async () => {
  const t = active();
  if (!t) return;
  if (!(await confirmBox(`Delete ${t.name}?`, 'The tournament, its fixtures and typed-in results are removed. Matches scored in the live scorer stay in Saved matches.', 'Delete', true))) return;
  saveAll(list().filter(x => x.id !== t.id));
  store.del('tour.active');
  RENDER.tournament();
  toast('Tournament deleted');
});
$('#tr-select').addEventListener('change', e => { store.set('tour.active', e.target.value); RENDER.tournament(); });
$('#tr-main').addEventListener('click', async e => {
  const b = e.target.closest('[data-tr]');
  if (!b) return;
  const t = active();
  const a = b.dataset.tr;
  if (a === 'new') { tournamentForm(null); return; }
  if (!t) return;
  const f = t.fixtures.find(x => x.id === b.dataset.f);
  switch (a) {
    case 'rr': {
      let added = 0;
      for (let i = 0; i < t.teams.length; i++) for (let j = i + 1; j < t.teams.length; j++) {
        const A = t.teams[i], B = t.teams[j];
        if (!t.fixtures.some(x => (same(x.a, A) && same(x.b, B)) || (same(x.a, B) && same(x.b, A)))) { t.fixtures.push({ id: uid(), a: A, b: B, matchId: null, manual: null, nr: false }); added++; }
      }
      update(t); RENDER.tournament();
      toast(added ? `${plural(added, 'fixture')} added` : 'Every pair of teams already has a fixture');
      break;
    }
    case 'addfx': {
      const opts = t.teams.map(n => `<option>${esc(n)}</option>`).join('');
      const body = openModal('Add a fixture', `<div class="fields"><div class="field"><div class="lab"><label for="af-a">Team</label></div><select id="af-a">${opts}</select></div><div class="field"><div class="lab"><label for="af-b">Against</label></div><select id="af-b">${opts}</select></div></div>
        <p class="err-text" id="af-err"></p><div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Add fixture</button></div>`);
      $('#af-b', body).selectedIndex = Math.min(1, t.teams.length - 1);
      body.addEventListener('click', ev => {
        const x = ev.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'cancel') { closeModal(); return; }
        const A = $('#af-a', body).value, B = $('#af-b', body).value;
        if (same(A, B)) { $('#af-err', body).textContent = 'Pick two different teams.'; return; }
        t.fixtures.push({ id: uid(), a: A, b: B, matchId: null, manual: null, nr: false });
        update(t); closeModal(); RENDER.tournament(); toast('Fixture added');
      });
      break;
    }
    case 'score': if (f) scoreFixture(t, f); break;
    case 'manual': if (f) manualForm(t, f); break;
    case 'link': if (f) linkForm(t, f); break;
    case 'nr': if (f) { f.nr = true; f.manual = null; f.matchId = null; update(t); RENDER.tournament(); toast('Marked as no result'); } break;
    case 'clear':
      if (f && await confirmBox('Clear this result?', 'The fixture goes back to not played. A linked scorecard stays in Saved matches.', 'Clear result')) {
        f.nr = false; f.manual = null; f.matchId = null; update(t); RENDER.tournament();
      }
      break;
    case 'remove':
      if (f && await confirmBox(`Remove ${f.a} v ${f.b}?`, 'The fixture and its result are removed from the tournament.', 'Remove', true)) {
        t.fixtures = t.fixtures.filter(x => x.id !== f.id); update(t); RENDER.tournament();
      }
      break;
    case 'card': {
      const m = f && finishedMatches().find(x => x.id === f.matchId);
      if (m) openModal(m.title, `<p style="margin:0 0 12px;font-weight:700">${esc(m.result)}</p>${m.data.inns.map((_, k) => scorecardHTML(m.data, k)).join('')}`, { wide: true });
      break;
    }
    case 'nrr': sendToNRR(t, b.dataset.team); break;
    default: break;
  }
});

// A match scored from a fixture links itself to that fixture when it finishes.
matchHooks.done.push(m => {
  if (!m.tournament) return;
  const ts = list();
  const t = ts.find(x => x.id === m.tournament.tid);
  const f = t && t.fixtures.find(x => x.id === m.tournament.fid);
  if (!f) return;
  f.matchId = m.id; f.manual = null; f.nr = false; t.updated = Date.now();
  saveAll(ts);
  toast(`Result added to ${t.name}`);
});