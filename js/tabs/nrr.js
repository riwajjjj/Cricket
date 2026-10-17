import { dirty, group, readGroup } from '../groups.js';
import { fmtOvers, parseOvers } from '../maths.js';
import { nrrOf, nrrSolveBatFirst, nrrSolveChase } from '../stats.js';
import { RENDER } from '../router.js';
import { fmt } from '../state.js';
import { answer, setKPI, setWarns, toast } from '../ui.js';
import { $, $$, esc, isNum, nf, plural, store } from '../utils.js';
/* =====================================================================
   10. NET RUN RATE
   ===================================================================== */
export function nrrExample() {
  const f = fmt();
  const n = f.overs ?? 20;
  const sets = {
    T20: [['Falcons', 178, '20', false, 161, '20', false], ['Rhinos', 142, '18.4', true, 146, '19.1', false], ['Tigers', 191, '20', false, 155, '18.2', true]],
    ODI: [['Falcons', 287, '50', false, 251, '47.3', true], ['Rhinos', 233, '48.2', true, 236, '44.5', false], ['Tigers', 301, '50', false, 268, '50', false]],
    T10: [['Falcons', 121, '10', false, 108, '10', false], ['Rhinos', 96, '9.4', true, 99, '8.2', false], ['Tigers', 134, '10', false, 117, '10', false]],
  };
  let rows = sets[f.key];
  if (!rows) { // Custom (or Test, where the tab is disabled): scale the T20 set
    const k = n / 20;
    rows = sets.T20.map(r => [r[0], Math.round(r[1] * k), String(n), r[3], Math.round(r[4] * k), String(n), r[6]]);
  }
  return rows.map(r => ({ opp: r[0], rf: String(r[1]), of: r[2], fao: r[3], ra: String(r[4]), ob: r[5], oao: r[6] }));
}
export let nrrRows = store.get('nrrRows', null);
if (!Array.isArray(nrrRows) || !dirty.nrrRows) nrrRows = null;

group('nrrS', 'nrr', [
  { k: 'tgt', label: 'NRR to beat', type: 'snum', min: -99, def: 1.1, tip: 'The rival net run rate you need to finish above. Use a minus sign for negative values.' },
  { k: 'quota', label: 'Overs in next match', def: 20, max: 200 },
  { k: 'bat', label: 'Batting first, you score', def: 170 },
  { k: 'chase', label: 'Chasing, the target is', def: 160, tip: 'Runs needed to win (their total plus one).' },
], f => {
  const n = f.overs ?? 20;
  const k = n / 20;
  const base = f.key === 'ODI' ? { tgt: 0.45, bat: 290, chase: 270 } : f.key === 'T10' ? { tgt: 0.6, bat: 120, chase: 110 } : { tgt: 1.1, bat: Math.round(170 * (f.key === 'T20' ? 1 : k)), chase: Math.round(160 * (f.key === 'T20' ? 1 : k)) };
  return { quota: n, ...base };
});

export function persistNRR() { dirty.nrrRows = true; store.set('dirty', dirty); store.set('nrrRows', nrrRows); }

export const DEL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
export function buildNRRTable() {
  const t = $('#nrr-tbl');
  t.innerHTML = `<thead><tr><th>Opponent</th><th class="num">Runs for</th><th class="num">Overs faced</th><th>All out</th><th class="num">Runs against</th><th class="num">Overs bowled</th><th>They were all out</th><th class="num">Match NRR</th><th><span class="sr-only">Remove</span></th></tr></thead>
  <tbody>${nrrRows.map((r, i) => `<tr data-i="${i}">
    <td><input type="text" class="w-name" data-k="opp" value="${esc(r.opp)}" aria-label="Opponent ${i + 1}" maxlength="30"></td>
    <td class="num"><input type="text" class="w-n" inputmode="numeric" data-k="rf" value="${esc(r.rf)}" aria-label="Runs for, match ${i + 1}"></td>
    <td class="num"><input type="text" class="w-n" inputmode="decimal" data-k="of" value="${esc(r.of)}" aria-label="Overs faced, match ${i + 1}"></td>
    <td><label class="check"><input type="checkbox" data-k="fao"${r.fao ? ' checked' : ''}> Yes</label></td>
    <td class="num"><input type="text" class="w-n" inputmode="numeric" data-k="ra" value="${esc(r.ra)}" aria-label="Runs against, match ${i + 1}"></td>
    <td class="num"><input type="text" class="w-n" inputmode="decimal" data-k="ob" value="${esc(r.ob)}" aria-label="Overs bowled, match ${i + 1}"></td>
    <td><label class="check"><input type="checkbox" data-k="oao"${r.oao ? ' checked' : ''}> Yes</label></td>
    <td class="num" data-out="nrr">—</td>
    <td><button type="button" class="row-del" data-del="${i}" aria-label="Remove match ${i + 1}">${DEL_ICON}</button></td>
  </tr>`).join('')}</tbody>
  <tfoot><tr class="total"><td>Total</td><td class="num" data-tot="rf">—</td><td class="num" data-tot="of">—</td><td></td><td class="num" data-tot="ra">—</td><td class="num" data-tot="ob">—</td><td></td><td class="num" data-tot="nrr">—</td><td></td></tr></tfoot>`;
}
export function nrrTotals() {
  const f = fmt();
  const Q = (f.overs ?? 0) * 6;
  const warn = [];
  let RF = 0, OF = 0, RA = 0, OB = 0, n = 0;
  const per = nrrRows.map((r, i) => {
    const label = r.opp || `Match ${i + 1}`;
    const rf = Number(String(r.rf).trim()), ra = Number(String(r.ra).trim());
    const ofP = r.fao ? { balls: Q } : parseOvers(r.of);
    const obP = r.oao ? { balls: Q } : parseOvers(r.ob);
    const bad = {};
    if (String(r.rf).trim() === '' || !Number.isInteger(rf) || rf < 0) bad.rf = true;
    if (String(r.ra).trim() === '' || !Number.isInteger(ra) || ra < 0) bad.ra = true;
    if (!r.fao && (ofP.error || !ofP.balls)) bad.of = true;
    if (!r.oao && (obP.error || !obP.balls)) bad.ob = true;
    if (!r.fao && ofP.balls > Q) { bad.of = true; warn.push(`${label}: overs faced is more than the ${f.overs}-over quota.`); }
    if (!r.oao && obP.balls > Q) { bad.ob = true; warn.push(`${label}: overs bowled is more than the ${f.overs}-over quota.`); }
    if (Object.keys(bad).length) { if (!warn.some(x => x.startsWith(label))) warn.push(`${label} is skipped until its runs and overs are filled in correctly.`); return { bad, nrr: null }; }
    RF += rf; RA += ra; OF += ofP.balls; OB += obP.balls; n++;
    return { bad, nrr: rf / (ofP.balls / 6) - ra / (obP.balls / 6), of: ofP.balls, ob: obP.balls };
  });
  const nrr = n ? nrrOf({ RF, OF, RA, OB }) : null;
  return { RF, OF, RA, OB, n, nrr, per, warn, Q };
}
export const signed = (v, dp = 3) => isNum(v) ? (v > 0.0005 ? '+' : '') + nf(v, dp) : '—';
// A solver result is strictly above the target, so add decimals until it no longer looks equal to it.
export const signedVs = (v, target) => { for (let dp = 3; dp < 7; dp++) if (signed(v, dp) !== signed(target, dp)) return signed(v, dp); return signed(v, 7); };
const nrrSign = v => v == null ? '' : Math.abs(v) < 0.0005 || v >= 0 ? 'pos' : 'neg';

export function calcNRR() {
  const f = fmt();
  const disabled = f.key === 'Test';
  $('#nrr-test-note').hidden = !disabled;
  $$('#tab-nrr > .card, #tab-nrr > .layout').forEach(el => el.classList.toggle('is-disabled', disabled));
  const t = nrrTotals();
  // per-row outputs + invalid markers
  $$('#nrr-tbl tbody tr').forEach((tr, i) => {
    const r = t.per[i];
    if (!r) return;
    ['rf', 'of', 'ra', 'ob'].forEach(k => tr.querySelector(`[data-k="${k}"]`)?.classList.toggle('bad', !!r.bad[k]));
    tr.querySelector('[data-k="of"]').disabled = !!nrrRows[i].fao;
    tr.querySelector('[data-k="ob"]').disabled = !!nrrRows[i].oao;
    const cell = tr.querySelector('[data-out="nrr"]');
    cell.textContent = signed(r.nrr);
    cell.className = 'num ' + (r.nrr == null ? 'dim' : nrrSign(r.nrr));
  });
  const tot = k => $(`#nrr-tbl [data-tot="${k}"]`);
  if (tot('rf')) {
    tot('rf').textContent = t.n ? t.RF : '—';
    tot('ra').textContent = t.n ? t.RA : '—';
    tot('of').textContent = t.n ? fmtOvers(t.OF) : '—';
    tot('ob').textContent = t.n ? fmtOvers(t.OB) : '—';
    tot('nrr').textContent = signed(t.nrr);
    tot('nrr').className = 'num ' + nrrSign(t.nrr);
  }
  setWarns('w-nrr', [...new Set(t.warn)]);
  setKPI('nrr-main', t.nrr, { dp: 3, signed: true, rating: t.nrr == null ? null : t.nrr >= 0 ? 2 : 0, chip: t.nrr == null ? '' : t.nrr >= 0 ? 'Positive' : 'Negative', sub: t.n ? `Scored ${t.RF} in ${fmtOvers(t.OF)} ov, conceded ${t.RA} in ${fmtOvers(t.OB)} ov` : 'Add a completed match' });

  // Solver
  const S = readGroup('nrrS');
  const tg = S.v.tgt, Qn = (S.v.quota ?? 0) * 6;
  const ob = $('#o-nrr-bat'), oc = $('#o-nrr-chase'), tb = $('#nrr-bat-tbl'), tc = $('#nrr-chase-tbl');
  const solverErr = S.errs.length ? `<ul class="warns">${S.errs.map(e => `<li class="err">${esc(e)}</li>`).join('')}</ul>` : '';
  if (!isNum(tg) || !Qn) { ob.innerHTML = solverErr || answer('—', 'Enter the NRR to beat and the overs in the next match.'); oc.innerHTML = ''; tb.innerHTML = ''; tc.innerHTML = ''; return; }
  const base = { RF: t.RF, OF: t.OF, RA: t.RA, OB: t.OB };
  const batFirst = sc => nrrSolveBatFirst(base, tg, sc, Qn);
  const chaseIt = tgtRuns => nrrSolveChase(base, tg, tgtRuns, Qn);
  const sc = S.v.bat, ct = S.v.chase;
  if (isNum(sc) && sc > 0) {
    const r = batFirst(sc);
    if (!r) ob.innerHTML = answer('✗', `Even bowling them out for 0 leaves you below <strong>${signed(tg)}</strong>. Score more, or look at the chase scenario.`, 'bad');
    else if (r.R === sc - 1) ob.innerHTML = answer('✓', `Any win does it. Win by a single run and your NRR becomes <strong>${signedVs(r.nrr, tg)}</strong>.`, 'good');
    else ob.innerHTML = answer(r.R, `or fewer: restrict them to this to finish above <strong>${signed(tg)}</strong>. That's a win by at least <strong>${plural(sc - r.R, 'run')}</strong>, and your NRR would be ${signedVs(r.nrr, tg)}.`, 'good');
    const vars = [sc - 30, sc - 15, sc, sc + 15, sc + 30].filter(x => x > 0);
    tb.innerHTML = `<thead><tr><th>You score</th><th class="num">Restrict them to</th><th class="num">Win by</th></tr></thead><tbody>${vars.map(x => { const q = batFirst(x); return `<tr${x === sc ? ' class="hl"' : ''}><td>${x}</td><td class="num">${q ? q.R : '<span class="neg">Not possible</span>'}</td><td class="num">${q ? plural(x - q.R, 'run') : '—'}</td></tr>`; }).join('')}</tbody>`;
  } else { ob.innerHTML = ''; tb.innerHTML = ''; }
  if (isNum(ct) && ct > 0) {
    const r = chaseIt(ct);
    if (!r) oc.innerHTML = answer('✗', `No chase of ${ct} lifts you above <strong>${signed(tg)}</strong>, even off one ball.`, 'bad');
    else if (r.balls === Qn) oc.innerHTML = answer('✓', `Any win does it. Chasing on the last ball gives an NRR of <strong>${signedVs(r.nrr, tg)}</strong>.`, 'good');
    else oc.innerHTML = answer(fmtOvers(r.balls), `overs or fewer: chase ${ct} within <strong>${plural(r.balls, 'ball')}</strong> to finish above ${signed(tg)}. Your NRR would be ${signedVs(r.nrr, tg)}.`, 'good', 'Assumes they bat their full quota and you finish on exactly the target.');
    const vars = [ct - 30, ct - 15, ct, ct + 15, ct + 30].filter(x => x > 0);
    tc.innerHTML = `<thead><tr><th>Target</th><th class="num">Chase within</th><th class="num">Balls</th></tr></thead><tbody>${vars.map(x => { const q = chaseIt(x); return `<tr${x === ct ? ' class="hl"' : ''}><td>${x}</td><td class="num">${q ? fmtOvers(q.balls) + ' ov' : '<span class="neg">Not possible</span>'}</td><td class="num">${q ? q.balls : '—'}</td></tr>`; }).join('')}</tbody>`;
  } else { oc.innerHTML = ''; tc.innerHTML = ''; }
  if (solverErr) ob.innerHTML = solverErr + ob.innerHTML;
}
RENDER.nrr = function renderNRR() { if (!nrrRows) nrrRows = nrrExample(); buildNRRTable(); calcNRR(); };


export function loadNRR(rows) { nrrRows = rows; persistNRR(); }
export function nrrFollowFormat() { if (!dirty.nrrRows) nrrRows = nrrExample(); }
export function resetNRR() { nrrRows = nrrExample(); delete dirty.nrrRows; store.del('nrrRows'); store.set('dirty', dirty); }
export function initNRR() {
  if (!nrrRows) nrrRows = nrrExample();
  const nt = $('#nrr-tbl');
  const onRow = e => {
    const tr = e.target.closest('tr[data-i]');
    const k = e.target.dataset.k;
    if (!tr || !k) return;
    const r = nrrRows[+tr.dataset.i];
    r[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    persistNRR();
    calcNRR();
  };
  nt.addEventListener('input', onRow);
  nt.addEventListener('change', e => { if (e.target.type === 'checkbox') onRow(e); });
  nt.addEventListener('click', e => {
    const d = e.target.closest('[data-del]');
    if (!d) return;
    if (nrrRows.length <= 1) { toast('Keep at least one match row'); return; }
    nrrRows.splice(+d.dataset.del, 1);
    persistNRR();
    RENDER.nrr();
  });
  $('#nrr-add').addEventListener('click', () => {
    const q = String(fmt().overs ?? 20);
    nrrRows.push({ opp: `Opponent ${nrrRows.length + 1}`, rf: '', of: q, fao: false, ra: '', ob: q, oao: false });
    persistNRR();
    RENDER.nrr();
    const inputs = $$('#nrr-tbl tbody tr:last-child input[data-k="rf"]');
    inputs[0] && inputs[0].focus();
  });

}
