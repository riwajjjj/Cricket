/* Crease — Players tab: career records built from scored matches, plus earlier stats entered by hand. */
import { persistGroup, setGroup } from '../groups.js';
import { fmtOvers, parseOvers } from '../maths.js';
import { batFigures, bowlFigures, buildRecords, careerBase, finishedMatches, nameKey } from '../records.js';
import { RENDER, showTab } from '../router.js';
import { closeModal, confirmBox, openModal, toast } from '../ui.js';
import { $, esc, nf, plural, store } from '../utils.js';
import { loadIntoCompare } from './compare.js';

const ui = { view: 'bat', q: '', format: '', team: '', sort: { bat: ['runs', -1], bowl: ['wkts', -1], field: ['total', -1] } };

const COLS = {
  bat: [
    ['name', 'Player'], ['team', 'Team'], ['m', 'M', 1], ['inns', 'Inns', 1], ['no', 'NO', 1], ['runs', 'Runs', 1], ['hs', 'HS', 1],
    ['avg', 'Avg', 1], ['sr', 'SR', 1], ['h', '100', 1], ['f', '50', 1], ['f4', '4s', 1], ['f6', '6s', 1],
  ],
  bowl: [
    ['name', 'Player'], ['team', 'Team'], ['m', 'M', 1], ['ov', 'Overs', 1], ['wkts', 'Wkts', 1], ['runs', 'Runs', 1], ['best', 'Best', 1],
    ['avg', 'Avg', 1], ['econ', 'Econ', 1], ['sr', 'SR', 1], ['fourW', '4w+', 1],
  ],
  field: [['name', 'Player'], ['team', 'Team'], ['m', 'M', 1], ['ct', 'Catches', 1], ['st', 'Stumpings', 1], ['ro', 'Run outs', 1], ['total', 'Total', 1]],
};

function rowsFor(map) {
  return [...map.values()].map(r => {
    const t = r.total, bf = batFigures(t.bat), wf = bowlFigures(t.bowl);
    return {
      r, key: r.key, name: r.name, team: [...r.teams].join(', '), m: t.matches,
      inns: t.bat.inns, no: t.bat.no, runs: t.bat.runs, hs: t.bat.hs, hsTxt: bf.hs, avg: bf.avg, sr: bf.sr, h: t.bat.hundreds, f: t.bat.fifties, f4: t.bat.f4, f6: t.bat.f6,
      ov: t.bowl.balls, wkts: t.bowl.wkts, bRuns: t.bowl.runs, best: t.bowl.bestW * 1000 - t.bowl.bestR, bestTxt: wf.best, bAvg: wf.avg, econ: wf.econ, bSr: wf.sr, fourW: t.bowl.fourW,
      ct: t.field.ct, st: t.field.st, ro: t.field.ro, total: t.field.ct + t.field.st + t.field.ro,
      hasBat: t.bat.inns > 0, hasBowl: t.bowl.balls > 0, hasField: t.field.ct + t.field.st + t.field.ro > 0,
    };
  });
}
const sortVal = (row, k, view) => {
  if (view === 'bowl') return ({ runs: row.bRuns, avg: row.bAvg, sr: row.bSr })[k] ?? row[k];
  return row[k];
};
const cell = (row, k, view) => {
  if (k === 'name') return `<td><button type="button" class="link-btn" data-player="${esc(row.key)}">${esc(row.name)}</button>${row.r.base ? ' <span class="tag-mini" title="Includes earlier stats entered by hand">+</span>' : ''}</td>`;
  if (k === 'team') return `<td class="dim">${esc(row.team || '—')}</td>`;
  if (view === 'bat') {
    if (k === 'hs') return `<td class="num">${row.hsTxt}</td>`;
    if (k === 'avg' || k === 'sr') return `<td class="num">${nf(row[k])}</td>`;
  }
  if (view === 'bowl') {
    if (k === 'ov') return `<td class="num">${fmtOvers(row.ov)}</td>`;
    if (k === 'runs') return `<td class="num">${row.bRuns}</td>`;
    if (k === 'best') return `<td class="num">${row.bestTxt}</td>`;
    if (k === 'avg') return `<td class="num">${nf(row.bAvg)}</td>`;
    if (k === 'econ') return `<td class="num">${nf(row.econ)}</td>`;
    if (k === 'sr') return `<td class="num">${nf(row.bSr, 1)}</td>`;
  }
  return `<td class="num">${row[k] ?? '—'}</td>`;
};

function filteredMatches() {
  const all = finishedMatches();
  return ui.format ? all.filter(m => m.data.format === ui.format) : all;
}

RENDER.players = function renderPlayers() {
  const all = finishedMatches();
  const formats = [...new Set(all.map(m => m.data.format).filter(Boolean))];
  const map = buildRecords(filteredMatches(), { includeBase: !ui.format });
  let rows = rowsFor(map);
  const teams = [...new Set(rows.flatMap(r => [...r.r.teams]))].sort();
  // filter controls
  $('#pl-format').innerHTML = `<option value="">All formats</option>${formats.map(f => `<option${f === ui.format ? ' selected' : ''}>${esc(f)}</option>`).join('')}`;
  $('#pl-team').innerHTML = `<option value="">All teams</option>${teams.map(t => `<option${t === ui.team ? ' selected' : ''}>${esc(t)}</option>`).join('')}`;
  $$seg();
  const v = ui.view;
  rows = rows.filter(r => (v === 'bat' ? r.hasBat : v === 'bowl' ? r.hasBowl : r.hasField))
    .filter(r => !ui.q || r.key.includes(nameKey(ui.q)))
    .filter(r => !ui.team || r.r.teams.has(ui.team));
  const [sk, dir] = ui.sort[v];
  rows.sort((a, b) => {
    const x = sortVal(a, sk, v), y = sortVal(b, sk, v);
    if (sk === 'name' || sk === 'team') return String(x).localeCompare(String(y)) * dir;
    if (x == null || y == null) return x == null && y == null ? a.name.localeCompare(b.name) : x == null ? 1 : -1; // blanks always last
    return (x === y ? a.name.localeCompare(b.name) : (x - y) * dir);
  });
  const cols = COLS[v];
  const tbl = $('#pl-tbl');
  const nMatches = filteredMatches().length;
  $('#pl-summary').textContent = all.length
    ? `${plural(nMatches, 'finished match', 'finished matches')}${ui.format ? ` in ${ui.format}` : ''} · ${plural(rows.length, 'player')} shown${ui.format ? ' · earlier stats are only included under All formats' : ''}`
    : 'No finished matches yet.';
  if (!rows.length) {
    tbl.innerHTML = `<tbody><tr><td class="empty-cell">${all.length || Object.keys(careerBase()).length ? 'No players match these filters.' : 'Records build themselves from matches you finish in the Live scorer. You can also add a player\'s earlier stats with “Add earlier stats”.'}</td></tr></tbody>`;
    return;
  }
  tbl.innerHTML = `<thead><tr>${cols.map(([k, l, num]) => `<th class="${num ? 'num' : ''}"><button type="button" class="th-sort${k === sk ? ' on' : ''}" data-sort="${k}" aria-label="Sort by ${esc(l)}">${esc(l)}${k === sk ? (dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(([k]) => cell(r, k, v)).join('')}</tr>`).join('')}</tbody>`;
};
function $$seg() { document.querySelectorAll('#pl-view [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === ui.view))); }

/* ---------- Player detail ---------- */
function openPlayer(key) {
  const map = buildRecords();
  const r = map.get(key);
  if (!r) return;
  const t = r.total, bf = batFigures(t.bat), wf = bowlFigures(t.bowl);
  const stat = (l, v) => `<div><b>${v}</b><span>${esc(l)}</span></div>`;
  const app = r.bat, base = r.base;
  const games = r.games.slice(0, 12).map(g => `<tr>
      <td class="dim">${new Date(g.date).toLocaleDateString()}</td><td>${esc(g.title)}</td>
      <td class="num">${g.bat ? `${g.bat.r}${g.bat.out ? '' : '*'} (${g.bat.b})` : '<span class="dim">—</span>'}</td>
      <td class="num">${g.bowl ? `${g.bowl.w}/${g.bowl.r} (${fmtOvers(g.bowl.balls)})` : '<span class="dim">—</span>'}</td>
      <td class="num">${[g.ct ? `${g.ct} ct` : '', g.st ? `${g.st} st` : '', g.ro ? `${g.ro} ro` : ''].filter(Boolean).join(', ') || '<span class="dim">—</span>'}</td></tr>`).join('');
  const body = openModal(r.name, `
    <p class="hint" style="margin:-6px 0 14px">${esc([...r.teams].join(', ') || 'No team yet')} · ${plural(t.matches, 'match', 'matches')}${base ? ` · includes earlier stats entered by hand (${plural(Number(base.matches) || 0, 'match', 'matches')})` : ''}</p>
    <div class="rec-grid">
      <div class="rec-block"><p class="modal-sub">Batting</p><div class="mini-stats">
        ${stat('Runs', t.bat.runs)}${stat('Average', nf(bf.avg))}${stat('Strike rate', nf(bf.sr))}${stat('Highest', bf.hs)}${stat('Innings', `${t.bat.inns}${t.bat.no ? ` (${t.bat.no} NO)` : ''}`)}${stat('100s / 50s', `${t.bat.hundreds} / ${t.bat.fifties}`)}
      </div></div>
      <div class="rec-block"><p class="modal-sub">Bowling</p><div class="mini-stats">
        ${stat('Wickets', t.bowl.wkts)}${stat('Economy', nf(wf.econ))}${stat('Average', nf(wf.avg))}${stat('Best', wf.best)}${stat('Overs', fmtOvers(t.bowl.balls))}${stat('Strike rate', nf(wf.sr, 1))}
      </div></div>
      <div class="rec-block"><p class="modal-sub">Fielding</p><div class="mini-stats">
        ${stat('Catches', t.field.ct)}${stat('Stumpings', t.field.st)}${stat('Run outs', t.field.ro)}
      </div></div>
    </div>
    ${(() => {
      const tbl = (title, m, who) => {
        const rows = [...m.values()].filter(x => x.balls || x.outs).sort((a, b) => b.balls - a.balls).slice(0, 6);
        if (!rows.length) return '';
        return `<div class="rec-block"><p class="modal-sub">${title}</p><table class="tbl"><thead><tr><th>${who}</th><th class="num">R</th><th class="num">B</th><th class="num">SR</th><th class="num">Out</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${x.runs}</td><td class="num">${x.balls}</td><td class="num">${x.balls ? nf(x.runs / x.balls * 100, 1) : '—'}</td><td class="num">${x.outs || '—'}</td></tr>`).join('')}</tbody></table></div>`;
      };
      const a = tbl('Batting against', r.vsBowl, 'Bowler'), b = tbl('Bowling to', r.vsBat, 'Batter');
      return a || b ? `<div class="grid-2" style="margin-top:14px">${a}${b}</div>` : '';
    })()}
    ${base ? `<p class="hint">From scored matches: ${app.runs} runs, ${r.bowl.wkts} wickets. Earlier stats add ${Number(base.bat?.runs) || 0} runs and ${Number(base.bowl?.wkts) || 0} wickets.</p>` : ''}
    ${games ? `<p class="modal-sub" style="margin-top:16px">Recent scored matches</p><div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>Date</th><th>Match</th><th class="num">Batting</th><th class="num">Bowling</th><th class="num">Fielding</th></tr></thead><tbody>${games}</tbody></table></div>` : '<p class="hint">No scored matches yet: these figures are the earlier stats entered by hand.</p>'}
    <div class="modal-actions">
      <button type="button" class="btn ghost" data-x="base">${base ? 'Edit earlier stats' : 'Add earlier stats'}</button>
      ${t.bat.inns ? '<button type="button" class="btn ghost" data-x="bat">Open in Batting</button>' : ''}
      ${t.bowl.balls ? '<button type="button" class="btn ghost" data-x="bowl">Open in Bowling</button>' : ''}
      ${t.bat.inns ? '<button type="button" class="btn ghost" data-x="cmpa">Compare as A</button><button type="button" class="btn ghost" data-x="cmpb">Compare as B</button>' : ''}
    </div>`, { wide: true });
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    const a = x.dataset.x;
    if (a === 'base') { closeModal(); baseForm(r.name); return; }
    closeModal();
    const s = t.bat;
    if (a === 'bat') {
      setGroup('bat', { name: r.name, runs: s.runs, balls: s.baseNoBalls ? '' : s.balls, inns: s.inns, no: s.no, f4: s.f4, f6: s.f6, dots: s.dots, ducks: s.ducks, fifties: s.fifties, hundreds: s.hundreds });
      persistGroup('bat'); showTab('batting', { scrollTop: true }); toast(s.baseNoBalls ? `${r.name}'s career loaded. Add balls faced for a strike rate.` : `${r.name}'s career loaded`);
    } else if (a === 'bowl') {
      const w = t.bowl;
      setGroup('bowl', { name: r.name, overs: w.baseNoBalls ? '' : fmtOvers(w.balls), maidens: w.maidens, runs: w.runs, wkts: w.wkts, dots: w.dots, wd: w.wd, nb: w.nb, bowled: w.types.bowled, caught: w.types.caught, lbw: w.types.lbw, stumped: w.types.stumped, other: w.types.other });
      persistGroup('bowl'); showTab('bowling', { scrollTop: true }); toast(w.baseNoBalls ? `${r.name}'s career loaded. Add overs for an economy rate.` : `${r.name}'s career loaded`);
    } else if (a === 'cmpa' || a === 'cmpb') {
      loadIntoCompare(a === 'cmpa' ? 'a' : 'b', { name: r.name, data: { runs: s.runs, balls: s.baseNoBalls ? '' : s.balls, inns: s.inns, no: s.no, f4: s.f4, f6: s.f6, fifties: s.fifties, hundreds: s.hundreds } });
      showTab('compare', { scrollTop: true });
    }
  });
}

/* ---------- Earlier stats (career totals from before using Crease) ---------- */
const BASE_FIELDS = [
  ['bat', 'inns', 'Innings'], ['bat', 'no', 'Not outs'], ['bat', 'runs', 'Runs'], ['bat', 'balls', 'Balls faced'], ['bat', 'f4', 'Fours'], ['bat', 'f6', 'Sixes'],
  ['bat', 'fifties', '50s'], ['bat', 'hundreds', '100s'], ['bat', 'ducks', 'Ducks'], ['bat', 'hs', 'Highest score', 'e.g. 87*'],
  ['bowl', 'overs', 'Overs', 'e.g. 64.3'], ['bowl', 'maidens', 'Maidens'], ['bowl', 'runs', 'Runs conceded'], ['bowl', 'wkts', 'Wickets'], ['bowl', 'fourW', '4-wicket hauls'], ['bowl', 'best', 'Best bowling', 'e.g. 4/21'],
  ['field', 'ct', 'Catches'], ['field', 'st', 'Stumpings'], ['field', 'ro', 'Run outs'],
];
function baseForm(name) {
  const all = careerBase();
  const cur = name ? all[nameKey(name)] : null;
  const val = (g, k) => {
    if (!cur) return '';
    if (g === 'bowl' && k === 'overs') return cur.bowl?.balls != null && cur.bowl.balls !== '' ? fmtOvers(Number(cur.bowl.balls)) : '';
    return cur[g]?.[k] ?? '';
  };
  const field = ([g, k, l, ph]) => `<div class="field"><div class="lab"><label for="eb-${g}-${k}">${esc(l)}</label></div><input id="eb-${g}-${k}" type="text" inputmode="${['hs', 'overs', 'best'].includes(k) ? 'text' : 'numeric'}" autocomplete="off" value="${esc(val(g, k))}"${ph ? ` placeholder="${esc(ph)}"` : ''}></div>`;
  const body = openModal(name ? `Earlier stats: ${name}` : 'Add earlier stats', `
    <p class="hint" style="margin:-6px 0 12px">Career totals from before you scored with Crease. Matches you score are added on top. Leave anything you don't know empty.</p>
    <div class="fields">
      ${name ? '' : '<div class="field wide"><div class="lab"><label for="eb-name">Player name</label></div><input id="eb-name" type="text" maxlength="40" autocomplete="off" placeholder="Exactly as in your squads"></div>'}
      <div class="field"><div class="lab"><label for="eb-matches">Matches</label></div><input id="eb-matches" type="text" inputmode="numeric" autocomplete="off" value="${esc(cur?.matches ?? '')}"></div>
    </div>
    <p class="modal-sub" style="margin-top:14px">Batting</p><div class="fields three">${BASE_FIELDS.filter(f => f[0] === 'bat').map(field).join('')}</div>
    <p class="modal-sub" style="margin-top:14px">Bowling</p><div class="fields three">${BASE_FIELDS.filter(f => f[0] === 'bowl').map(field).join('')}</div>
    <p class="modal-sub" style="margin-top:14px">Fielding</p><div class="fields three">${BASE_FIELDS.filter(f => f[0] === 'field').map(field).join('')}</div>
    <p class="err-text" id="eb-err"></p>
    <div class="modal-actions">${cur ? '<button type="button" class="btn ghost danger" data-x="del">Remove earlier stats</button>' : ''}<button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save</button></div>`, { wide: true });
  body.addEventListener('click', async e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const err = $('#eb-err', body);
    const nm = name || ($('#eb-name', body).value || '').trim().replace(/\s+/g, ' ');
    if (!nm) { err.textContent = 'Add the player\'s name.'; return; }
    const k = nameKey(nm);
    if (x.dataset.x === 'del') {
      closeModal();
      if (await confirmBox(`Remove ${nm}'s earlier stats?`, 'Only the hand-entered totals are removed. Scored matches stay.', 'Remove', true)) {
        const b = careerBase(); delete b[k]; store.set('careerBase', b); RENDER.players(); toast('Earlier stats removed');
      }
      return;
    }
    const entry = { name: nm, matches: '', bat: {}, bowl: {}, field: {}, savedAt: Date.now() };
    const mt = ($('#eb-matches', body).value || '').trim();
    if (mt && !/^\d+$/.test(mt)) { err.textContent = 'Matches must be a whole number.'; return; }
    entry.matches = mt;
    for (const [g, key, label] of BASE_FIELDS) {
      const raw = ($(`#eb-${g}-${key}`, body).value || '').trim();
      if (!raw) continue;
      if (key === 'hs') { if (!/^\d+\*?$/.test(raw)) { err.textContent = 'Highest score should look like 87 or 87*.'; return; } entry.bat.hs = raw; continue; }
      if (key === 'best') { if (!/^\d+\s*\/\s*\d+$/.test(raw)) { err.textContent = 'Best bowling should look like 4/21.'; return; } entry.bowl.best = raw.replace(/\s+/g, ''); continue; }
      if (key === 'overs') { const p = parseOvers(raw); if (p.error) { err.textContent = `Overs: ${p.error}.`; return; } entry.bowl.balls = p.balls; continue; }
      if (!/^\d+$/.test(raw)) { err.textContent = `${label} must be a whole number.`; return; }
      entry[g][key] = Number(raw);
    }
    if ((entry.bat.no || 0) > (entry.bat.inns || 0)) { err.textContent = 'Not outs can\'t be more than innings.'; return; }
    if (entry.bat.runs > 0 && !entry.bat.inns) { err.textContent = 'Add the innings played, so the batting average can be worked out.'; return; }
    if (entry.bowl.wkts > 0 && entry.bowl.runs === undefined) { err.textContent = 'Add the runs conceded, so the bowling average can be worked out.'; return; }
    if (!name && careerBase()[k]) { err.textContent = `${nm} already has earlier stats. Open them from the player's page to change them.`; return; }
    const b = careerBase(); b[k] = entry; store.set('careerBase', b);
    closeModal(); RENDER.players(); toast(`Earlier stats saved for ${nm}`);
  });
}

/* ---------- Wiring ---------- */
$('#pl-q').addEventListener('input', e => { ui.q = e.target.value.trim(); RENDER.players(); });
$('#pl-format').addEventListener('change', e => { ui.format = e.target.value; RENDER.players(); });
$('#pl-team').addEventListener('change', e => { ui.team = e.target.value; RENDER.players(); });
$('#pl-view').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { ui.view = b.dataset.view; RENDER.players(); } });
$('#pl-add').addEventListener('click', () => baseForm(null));
$('#pl-tbl').addEventListener('click', e => {
  const s = e.target.closest('[data-sort]'), p = e.target.closest('[data-player]');
  if (s) {
    const k = s.dataset.sort, cur = ui.sort[ui.view];
    ui.sort[ui.view] = cur[0] === k ? [k, -cur[1]] : [k, k === 'name' || k === 'team' || (ui.view === 'bowl' && ['avg', 'econ', 'sr', 'runs'].includes(k)) ? 1 : -1];
    RENDER.players();
  }
  if (p) openPlayer(p.dataset.player);
});
