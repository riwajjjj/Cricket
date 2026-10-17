import { axes, baseOpts, chart, pal } from '../charts.js';
import { group, readGroup } from '../groups.js';
import { DLS, fmtOvers } from '../maths.js';
import { dlsRevised } from '../stats.js';
import { RENDER } from '../router.js';
import { fmt } from '../state.js';
import { errItems, setKPI, setWarns } from '../ui.js';
import { $, isNum, nf, plural } from '../utils.js';
/* =====================================================================
   11. RAIN TARGET (DLS-style)
   ===================================================================== */
export const DLS_EX = {
  ODI: { s: 248, n1: 50, n2: 50, u: '22.4', w: 3, lost: '12', s2: 121 },
  T20: { s: 172, n1: 20, n2: 20, u: '9.2', w: 2, lost: '5', s2: 74 },
  T10: { s: 118, n1: 10, n2: 10, u: '4.1', w: 1, lost: '3', s2: 46 },
};
group('dls', 'dls', [
  { k: 's', label: 'Team 1 total', def: 248 },
  { k: 'n1', label: 'Team 1 overs allotted', def: 50, tip: 'Overs Team 1 was given at the start of its innings.', max: 200 },
  { k: 'n2', label: 'Team 2 overs at start', def: 50, max: 200 },
  { k: 'u', label: 'Overs bowled at stoppage', type: 'overs', def: '22.4', tip: 'How far into Team 2\'s innings play stopped. Use 0 if Team 2\'s innings was shortened before it began.' },
  { k: 'w', label: 'Wickets down at stoppage', def: 3, max: 9 },
  { k: 'lost', label: 'Overs lost', type: 'overs', def: '12', tip: 'Overs removed from Team 2\'s innings by the interruption.' },
  { k: 's2', label: 'Team 2 score at stoppage', def: 121, tip: 'Used to show whether Team 2 is ahead of par.' },
], f => {
  if (DLS_EX[f.key]) return DLS_EX[f.key];
  const n = f.overs ?? 50;
  return { s: f.avgScore ?? 248, n1: n, n2: n, u: fmtOvers(Math.round(n * 6 * 0.45)), w: 2, lost: String(Math.max(1, Math.round(n * 0.25))), s2: Math.round((f.avgScore ?? 248) * 0.42) };
});

export let dlsShare = null;
RENDER.dls = function renderDLS() {
  const f = fmt();
  const disabled = f.key === 'Test';
  $('#dls-test-note').hidden = !disabled;
  $('#tab-dls .layout').classList.toggle('is-disabled', disabled);
  const { v, errs } = readGroup('dls');
  const w = errItems(errs);
  const S = v.s, n1 = v.n1, n2 = v.n2, u = v.u ?? 0, wk = v.w ?? 0, lost = v.lost ?? 0, s2 = v.s2;
  let ok = isNum(S) && isNum(n1) && n1 > 0 && isNum(n2) && n2 > 0 && !errs.length;
  if (!isNum(S)) w.push({ t: 'Enter Team 1\'s total.', level: 'err' });
  if (isNum(n2) && u > n2 * 6) { w.push('Overs bowled at the stoppage is more than Team 2\'s overs.'); ok = false; }
  if (isNum(n2) && u + lost > n2 * 6) { w.push(`Only ${fmtOvers(Math.max(0, n2 * 6 - u))} overs were left to lose.`); ok = false; }
  if (isNum(f.overs) && ((n1 ?? 0) > f.overs || (n2 ?? 0) > f.overs)) w.push({ t: `Overs above ${f.overs} don't match the ${f.label} format picked at the top.`, level: 'info' });
  if (isNum(s2) && u === 0 && s2 > 0) w.push({ t: 'Team 2 has a score but no overs bowled. Check the stoppage overs.', level: 'info' });
  setWarns('w-dls', w);

  const board = $('#dls-board');
  if (!ok) {
    board.innerHTML = `<div class="board-main"><div class="board-label">Revised target</div><div class="board-eq">Fill in the match details</div></div>`;
    ['dls-t', 'dls-r1', 'dls-r2', 'dls-par', 'dls-need', 'dls-rrr'].forEach(id => setKPI(id, null));
    dlsShare = null;
  } else {
    const { R1, R2, used, after, target, parNow, revisedBalls } = dlsRevised({ S, n1, n2, u, w: wk, lost, formatOvers: f.overs ?? 50 });
    const leftAfter = revisedBalls - u;
    const needFrom = isNum(s2) ? target - s2 : null;
    const full = DLS.res(n2, 0);

    let status = '';
    if (isNum(s2) && u > 0) {
      const d = s2 - parNow;
      status = d > 0 ? `Team 2 is <span class="ok">${plural(d, 'run')} ahead</span> of par` : d === 0 ? 'Team 2 is level with par' : `Team 2 is <span class="no">${plural(-d, 'run')} behind</span> par`;
    }
    board.innerHTML = `<div class="board-main"><div class="board-label">Revised target</div><div class="board-eq">Team 2 needs <em>${target}</em> in ${fmtOvers(revisedBalls)} overs</div>${status ? `<div class="board-label" style="margin-top:10px;letter-spacing:.06em;text-transform:none;font-size:.95rem;color:#cfe0d6">${status} at the stoppage</div>` : ''}</div>
      <div class="board-side"><div class="board-stat"><b>${nf(R1, 1)}%</b><span>Team 1 resources</span></div><div class="board-stat"><b>${nf(R2, 1)}%</b><span>Team 2 resources</span></div></div>`;
    setKPI('dls-t', target, { dp: 0, sub: R2 < R1 ? 'Scaled down by resources' : R2 > R1 ? 'Scaled up using the average-score adjustment' : 'Unchanged' });
    setKPI('dls-r1', R1, { dp: 1, suffix: '%', sub: `${n1} overs, no wickets lost` });
    setKPI('dls-r2', R2, { dp: 1, suffix: '%', sub: `${nf(used, 1)}% used before rain + ${nf(after, 1)}% after` });
    setKPI('dls-par', u > 0 ? parNow : null, { dp: 0, sub: u > 0 ? `If no more play after ${fmtOvers(u)} overs, ${wk} down` : 'No overs bowled yet' });
    setKPI('dls-need', needFrom != null ? Math.max(0, needFrom) : null, { dp: 0, sub: leftAfter > 0 ? `Off ${plural(leftAfter, 'ball')} after the restart` : 'No overs left after the restart' });
    setKPI('dls-rrr', needFrom != null && leftAfter > 0 ? Math.max(0, needFrom) / (leftAfter / 6) : null, { sub: 'Needed per over after the restart' });
    dlsShare = { target, R1, R2, parNow, revisedBalls };

    // Resource curves
    const p = pal();
    const maxN = Math.max(n2, n1, 1);
    const labels = Array.from({ length: maxN + 1 }, (_, i) => String(i));
    const wks = [0, 2, 4, 6, 8];
    const cols = [p.turf, p.sky, p.accent, p.warn, p.ball];
    chart('c-dls', {
      type: 'line',
      data: { labels, datasets: wks.map((ww, i) => ({ label: `${ww} down`, data: labels.map(o => +(DLS.res(+o, ww) / full * 100).toFixed(1)), borderColor: cols[i], backgroundColor: cols[i], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25 })) },
      options: baseOpts({ interaction: { mode: 'index', intersect: false }, scales: axes({ x: 'Overs left', y: '% of a full innings' }), plugins: { tooltip: { callbacks: { title: it => `${it[0].label} overs left`, label: c => ` ${c.dataset.label}: ${c.parsed.y}%` } } } }),
    });
  }
};

