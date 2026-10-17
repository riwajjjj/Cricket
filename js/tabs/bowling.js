import { doughnut, pal } from '../charts.js';
import { group, readGroup } from '../groups.js';
import { fmtOvers, rate } from '../maths.js';
import { RENDER } from '../router.js';
import { bowlStats } from '../stats.js';
import { fmt } from '../state.js';
import { answer, errItems, setKPI, setWarns } from '../ui.js';
import { $, EPS, isNum, nf, plural, sum } from '../utils.js';
/* =====================================================================
   8. BOWLING
   ===================================================================== */
group('bowl', 'bowling', [
  { k: 'name', label: 'Player name', type: 'text', def: 'Example bowler', wide: true, maxlen: 40 },
  { k: 'overs', label: 'Overs', type: 'overs', def: '124.3', tip: 'Cricket notation: the digit after the dot counts balls (0 to 5). 124.3 is 747 balls.' },
  { k: 'maidens', label: 'Maidens', def: 6 },
  { k: 'runs', label: 'Runs conceded', def: 812, tip: 'Includes wides and no-balls. Byes and leg-byes are not charged to the bowler.' },
  { k: 'wkts', label: 'Wickets', def: 41 },
  { k: 'dots', label: 'Dot balls', def: 402 },
  { k: 'wd', label: 'Wides', def: 23, tip: 'Number of wides bowled. Each one costs at least one run.' },
  { k: 'nb', label: 'No-balls', def: 7 },
  { k: 'bowled', label: 'Bowled', def: 9 },
  { k: 'caught', label: 'Caught', def: 23 },
  { k: 'lbw', label: 'LBW', def: 6 },
  { k: 'stumped', label: 'Stumped', def: 2 },
  { k: 'other', label: 'Hit wicket / other', def: 1 },
]);
group('bowlT', 'bowling', [
  { k: 'econ', label: 'Target economy', type: 'num', def: 6.25 },
  { k: 'next', label: 'Over the next … overs', type: 'overs', def: '20' },
  { k: 'avg', label: 'Target average', type: 'num', def: 18 },
  { k: 'conc', label: 'While conceding … runs', def: 150 },
]);


export { bowlStats };

RENDER.bowling = function renderBowling() {
  const { v, errs } = readGroup('bowl');
  const f = fmt();
  const s = bowlStats(v);
  const w = errItems(errs);
  if (s.M > s.full) w.push(`Maidens can't be more than completed overs (${s.full}).`);
  if (s.D > s.balls) w.push('Dot balls are more than balls bowled.');
  if (s.W > s.balls && s.balls > 0) w.push('More wickets than balls bowled.');
  if (s.Wd + s.Nb > s.R) w.push(`Each wide and no-ball costs at least one run, so runs conceded should be at least ${s.Wd + s.Nb}.`);
  const typed = sum(s.types);
  if (typed > s.W) w.push(`Wicket types add up to ${typed}, more than the ${s.W} wickets.`);
  else if (typed < s.W && typed > 0) w.push({ t: `${plural(s.W - typed, 'wicket')} have no type recorded.`, level: 'info' });
  setWarns('w-bowl', w);

  $('#bowl-figs').innerHTML = `<span class="figs">${s.W}/${s.R}</span><span class="figs-cap">in ${fmtOvers(s.balls)} overs${s.M ? `, ${plural(s.M, 'maiden')}` : ''}</span>`;
  setKPI('bowl-econ', s.econ, { rating: rate(s.econ, f.econ, false), sub: 'Runs per over' });
  setKPI('bowl-avg', s.avg, { rating: rate(s.avg, f.bowlAvg, false), sub: 'Runs per wicket' });
  setKPI('bowl-sr', s.sr, { dp: 1, rating: rate(s.sr, f.bowlSR, false), sub: 'Balls per wicket' });
  setKPI('bowl-dot', s.dot, { dp: 1, suffix: '%', rating: rate(s.dot, f.bowlDot), sub: `${s.D} of ${s.balls} balls` });
  setKPI('bowl-mdn', s.mdn, { dp: 1, suffix: '%', sub: `${s.M} of ${s.full} overs` });
  setKPI('bowl-xpo', s.xpo, { dp: 2, sub: `${s.Wd} wides, ${s.Nb} no-balls` });

  const p = pal();
  const labels = ['Bowled', 'Caught', 'LBW', 'Stumped', 'Other'], data = s.types.slice(), colors = [p.ball, p.sky, p.accent, p.violet, p.turf];
  if (typed < s.W) { labels.push('Not recorded'); data.push(s.W - typed); colors.push(p.line2); }
  doughnut('c-bowl-wk', labels, data, colors);
  doughnut('c-bowl-balls', ['Dot balls', 'Scored off', 'Wides & no-balls'], [s.D, Math.max(0, s.balls - s.D), s.Wd + s.Nb], [p.turf, p.sky, p.violet]);

  const T = readGroup('bowlT');
  const out = [];
  const E = T.v.econ, nb = T.v.next;
  if (isNum(E) && E > 0 && isNum(nb) && nb > 0) {
    const maxRuns = Math.floor(E * (s.balls + nb) / 6 - s.R + EPS);
    if (maxRuns < 0) out.push(answer('✗', `Out of reach in ${fmtOvers(nb)} overs. Even all dot balls only brings the economy down to <strong>${nf(s.R / ((s.balls + nb) / 6))}</strong>.`, 'bad'));
    else out.push(answer(maxRuns, `runs at most in the next ${fmtOvers(nb)} overs to get the economy to <strong>${nf(E)}</strong>. That's ${nf(maxRuns / (nb / 6))} an over for the spell.`, 'good', `${nf(E)} × (${s.balls} + ${nb}) balls ÷ 6 − ${s.R} = ${maxRuns}`));
  }
  const A = T.v.avg, X = T.v.conc;
  if (isNum(A) && A > 0 && isNum(X)) {
    const k = Math.ceil((s.R + X) / A - s.W - EPS);
    if (k <= 0) out.push(answer('✓', `Already there. Conceding ${X} more runs without a wicket still leaves the average at <strong>${s.W ? nf((s.R + X) / s.W) : '—'}</strong>.`, 'good'));
    else out.push(answer(k, `${k === 1 ? 'wicket' : 'wickets'} needed while conceding ${X} runs to bring the average to <strong>${nf(A)}</strong>.`, '', `(${s.R} + ${X}) ÷ ${nf(A)} − ${s.W} wickets = ${k}`));
  }
  $('#o-bowl-t').innerHTML = out.join('');
};

