import { group, readGroup } from '../groups.js';
import { RENDER } from '../router.js';
import { fmt } from '../state.js';
import { errItems, setWarns, tween } from '../ui.js';
import { $, $$, clamp, esc, isNum, nf, sum } from '../utils.js';
/* =====================================================================
   12. IMPACT
   ===================================================================== */
export const IMP_BAT_EX = { T20: { runs: 68, balls: 41, f4: 6, f6: 4, team: 182 }, ODI: { runs: 94, balls: 88, f4: 9, f6: 3, team: 301 }, Test: { runs: 112, balls: 214, f4: 14, f6: 1, team: 388 }, T10: { runs: 42, balls: 19, f4: 3, f6: 4, team: 131 } };
export const IMP_BOWL_EX = { T20: { overs: '4', runs: 24, wkts: 3, dots: 11, top: 2 }, ODI: { overs: '10', runs: 41, wkts: 3, dots: 34, top: 2 }, Test: { overs: '24.3', runs: 61, wkts: 4, dots: 118, top: 2 }, T10: { overs: '2', runs: 15, wkts: 2, dots: 5, top: 1 } };
group('impBat', 'impact', [
  { k: 'runs', label: 'Runs', def: 68 },
  { k: 'balls', label: 'Balls', def: 41 },
  { k: 'f4', label: 'Fours', def: 6 },
  { k: 'f6', label: 'Sixes', def: 4 },
  { k: 'team', label: 'Team total', def: 182, tip: 'Optional. Adds credit for carrying a large share of the team\'s runs.' },
], f => IMP_BAT_EX[f.key] || IMP_BAT_EX.T20);
group('impBowl', 'impact', [
  { k: 'overs', label: 'Overs', type: 'overs', def: '4' },
  { k: 'runs', label: 'Runs conceded', def: 24 },
  { k: 'wkts', label: 'Wickets', def: 3, max: 10 },
  { k: 'dots', label: 'Dot balls', def: 11 },
  { k: 'top', label: 'Top-order wickets', def: 2, tip: 'How many of the wickets were batters 1 to 4.' },
], f => IMP_BOWL_EX[f.key] || IMP_BOWL_EX.T20);

export function ringMarkup(cap) {
  return `<div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="g-track" cx="60" cy="60" r="50" pathLength="100"/><circle class="g-val" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="0 100"/></svg><div class="ring-num"><div><b>—</b><span>${esc(cap)}</span></div></div></div><div class="bars"></div>`;
}
export const VERDICTS = [[25, 'Quiet day'], [45, 'Useful'], [65, 'Strong'], [82, 'Match-winning'], [101, 'Legendary']];
export const verdictFor = s => VERDICTS.find(([m]) => s < m)[1];
export function setImpact(root, score, parts) {
  const val = root.querySelector('.g-val');
  const ok = isNum(score);
  const s = ok ? Math.round(score) : 0;
  val.setAttribute('stroke-dasharray', `${s} 100`);
  val.style.strokeOpacity = s < 1 ? 0 : 1;
  val.style.stroke = s < 25 ? 'var(--muted)' : s < 45 ? 'var(--sky)' : s < 65 ? 'var(--turf)' : 'var(--accent)';
  tween(root.querySelector('.ring-num b'), ok ? s : null, 0);
  const bars = root.querySelector('.bars');
  const sig = parts.map(p => p.label).join('|');
  if (bars.dataset.sig !== sig) {
    bars.dataset.sig = sig;
    bars.innerHTML = `<p class="verdict-line"></p>` + parts.map(p => `<div class="bar-row"><span>${esc(p.label)}</span><span class="pts"></span><div class="track"><div class="fill"></div></div></div>`).join('');
  }
  bars.querySelector('.verdict-line').innerHTML = ok ? `<strong>${verdictFor(score)}</strong>` : 'Fill in the numbers above';
  $$('.bar-row', bars).forEach((row, i) => {
    const p = parts[i];
    row.querySelector('.pts').textContent = `${nf(p.pts, 1)} / ${p.max}`;
    row.querySelector('.fill').style.width = `${clamp(p.pts / p.max * 100, 0, 100)}%`;
  });
}
export let impactShare = null;
RENDER.impact = function renderImpact() {
  const f = fmt();
  // Batting
  const A = readGroup('impBat');
  const r = A.v.runs ?? 0, b = A.v.balls ?? 0, f4 = A.v.f4 ?? 0, f6 = A.v.f6 ?? 0, team = A.v.team;
  const wa = errItems(A.errs);
  if (4 * f4 + 6 * f6 > r) wa.push('Boundary runs are more than the runs scored.');
  if (f4 + f6 > b) wa.push('More boundaries than balls faced.');
  if (isNum(team) && team > 0 && r > team) wa.push('The innings is bigger than the team total.');
  setWarns('w-impBat', wa);
  const sr = b > 0 ? r / b * 100 : 0;
  const bd = r > 0 ? (4 * f4 + 6 * f6) / r * 100 : 0;
  const bp = [
    { label: 'Weight of runs', max: 40, pts: clamp(r / (f.parRuns * 2), 0, 1) * 40 },
    { label: `Tempo (SR ${nf(sr, 1)})`, max: 30, pts: b > 0 ? clamp((sr - f.parSR * 0.6) / (f.parSR * 0.9), 0, 1) * 30 : 0 },
    { label: 'Boundary hitting', max: 10, pts: clamp(bd / 70, 0, 1) * 10 },
  ];
  if (isNum(team) && team > 0) bp.push({ label: `Share of team total (${Math.round(r / team * 100)}%)`, max: 20, pts: clamp((r / team) / 0.4, 0, 1) * 20 });
  const batScore = b > 0 || r > 0 ? sum(bp.map(x => x.pts)) / sum(bp.map(x => x.max)) * 100 : null;
  setImpact($('#imp-bat'), batScore, bp);

  // Bowling
  const B = readGroup('impBowl');
  const balls = B.v.overs ?? 0, rc = B.v.runs ?? 0, wk = B.v.wkts ?? 0, d = B.v.dots ?? 0, top = B.v.top ?? 0;
  const wb = errItems(B.errs);
  if (top > wk) wb.push('Top-order wickets can\'t be more than total wickets.');
  if (d > balls) wb.push('More dot balls than balls bowled.');
  if (top > 4) wb.push('Only four batters count as top order.');
  setWarns('w-impBowl', wb);
  const econ = balls > 0 ? rc / (balls / 6) : null;
  const dotp = balls > 0 ? d / balls * 100 : 0;
  const dotRef = f.key === 'Test' ? 80 : f.key === 'ODI' ? 65 : 55;
  const wp = [
    { label: `Wickets (${wk})`, max: 40, pts: clamp(wk / f.wkRef, 0, 1) * 40 },
    { label: 'Top-order wickets', max: 10, pts: clamp(Math.min(top, wk) / 3, 0, 1) * 10 },
    { label: `Economy (${econ != null ? nf(econ) : '—'})`, max: 35, pts: econ != null ? clamp((1.5 * f.parEcon - econ) / f.parEcon, 0, 1) * 35 : 0 },
    { label: `Dot balls (${nf(dotp, 0)}%)`, max: 15, pts: clamp(dotp / dotRef, 0, 1) * 15 },
  ];
  const bowlScore = balls > 0 ? sum(wp.map(x => x.pts)) : null;
  setImpact($('#imp-bowl'), bowlScore, wp);
  impactShare = { batScore, bowlScore, r, b, wk, rc, balls };
};

