import { doughnut, pal } from '../charts.js';
import { group, readGroup } from '../groups.js';
import { rate } from '../maths.js';
import { RENDER } from '../router.js';
import { batStats } from '../stats.js';
import { fmt } from '../state.js';
import { answer, errItems, setKPI, setWarns } from '../ui.js';
import { $, EPS, isNum, nf, plural, shown } from '../utils.js';
/* =====================================================================
   7. BATTING
   ===================================================================== */
group('bat', 'batting', [
  { k: 'name', label: 'Player name', type: 'text', def: 'Example batter', wide: true, maxlen: 40 },
  { k: 'runs', label: 'Runs', def: 1840 },
  { k: 'balls', label: 'Balls faced', def: 1412, tip: 'Deliveries faced. No-balls count as faced; wides do not.' },
  { k: 'inns', label: 'Innings', def: 52 },
  { k: 'no', label: 'Not outs', def: 7, tip: 'Innings where the batter was not dismissed. Their runs count, but they are not dismissals in the average.' },
  { k: 'f4', label: 'Fours', def: 172 },
  { k: 'f6', label: 'Sixes', def: 61 },
  { k: 'dots', label: 'Dot balls', def: 498, tip: 'Balls faced without scoring a run off the bat.' },
  { k: 'ducks', label: 'Ducks', def: 3 },
  { k: 'fifties', label: '50s', def: 13, tip: 'Scores from 50 to 99. Enter hundreds separately.' },
  { k: 'hundreds', label: '100s', def: 2 },
]);
group('batT', 'batting', [
  { k: 'avg', label: 'Target average', type: 'num', def: 45 },
  { k: 'sr', label: 'Target strike rate', type: 'num', def: 140 },
  { k: 'nb', label: 'Over the next … balls', def: 60 },
]);


export { batStats };

RENDER.batting = function renderBatting() {
  const { v, errs } = readGroup('bat');
  const f = fmt();
  const s = batStats(v);
  const w = errItems(errs);
  if (s.NO > s.I) w.push('Not outs are more than innings played.');
  if (s.F4 + s.F6 + s.D > s.B && s.B > 0) w.push('Fours, sixes and dot balls add up to more than the balls faced.');
  if (s.bRuns > s.R) w.push(`Runs from boundaries (${s.bRuns}) are more than total runs (${s.R}).`);
  if (s.fifties + s.hundreds > s.I) w.push('There are more 50s and 100s than innings.');
  if ((v.ducks ?? 0) > Math.max(0, s.dism)) w.push(`Ducks are dismissals, so they can't be more than ${Math.max(0, s.dism)}.`);
  if (50 * s.fifties + 100 * s.hundreds > s.R) w.push('The 50s and 100s add up to more runs than the total.');
  if (s.R > 0 && s.B === 0) w.push('Add balls faced to get a strike rate.');
  if (s.B > 0 && s.R > 6 * s.B) w.push('That is more than six runs a ball, which isn\'t possible without overthrows.');
  if (s.D > 0 && s.other > 0 && s.R - s.bRuns < s.other) w.push(`${s.other} balls scored without a boundary need at least ${s.other} runs, but only ${Math.max(0, s.R - s.bRuns)} came from running.`);
  if (s.I > 0 && s.dism === 0) w.push({ t: 'No dismissals yet, so the average is undefined (shown as —).', level: 'info' });
  setWarns('w-bat', w);

  setKPI('bat-sr', s.sr, { rating: rate(shown(s.sr, 2), f.sr), sub: `${s.R} runs off ${s.B} balls` });
  setKPI('bat-avg', s.avg, { rating: rate(shown(s.avg, 2), f.bavg), sub: s.dism > 0 ? plural(s.dism, 'dismissal') : 'No dismissals' });
  setKPI('bat-rpi', s.rpi, { dp: 1, sub: s.I ? `Across ${plural(s.I, 'innings', 'innings')}` : '' });
  setKPI('bat-bdry', s.bdry, { dp: 1, suffix: '%', sub: `${s.bRuns} runs in 4s and 6s` });
  setKPI('bat-bpb', s.bpb, { dp: 1, sub: `${s.F4 + s.F6} boundaries` });
  setKPI('bat-dot', s.dot, { dp: 1, suffix: '%', rating: rate(shown(s.dot, 1), f.batDot, false), sub: `${s.D} dot balls` });
  setKPI('bat-rot', s.rot, { dp: 1, suffix: '%', sub: 'Balls with runs but no boundary' });
  setKPI('bat-conv', s.conv, { dp: 0, suffix: '%', sub: s.fifties + s.hundreds ? `${s.hundreds} of ${s.fifties + s.hundreds} fifty-plus scores` : 'No 50+ scores yet' });
  setKPI('bat-s100', s.s100, { dp: 2, sub: `${s.F6} sixes` });

  const p = pal();
  doughnut('c-bat-runs', ['Fours', 'Sixes', 'Running'], [4 * s.F4, 6 * s.F6, Math.max(0, s.R - s.bRuns)], [p.sky, p.accent, p.turf]);
  doughnut('c-bat-balls', ['Dots', 'Boundaries', 'Other scoring'], [s.D, s.F4 + s.F6, Math.max(0, s.other)], [p.line2, p.accent, p.turf]);

  // Solver
  const T = readGroup('batT');
  const out = [];
  const A = T.v.avg, S = T.v.sr, N = T.v.nb;
  if (isNum(A) && A > 0 && s.I >= s.NO) {
    const afterDuck = s.R / (s.dism + 1);
    const needOut = Math.ceil(A * (s.dism + 1) - s.R - EPS);
    if (afterDuck >= A - EPS) {
      out.push(answer('✓', `Even a duck next innings keeps the average at <strong>${nf(afterDuck)}</strong>, above ${nf(A, 2)}.`, 'good'));
    } else {
      let extra = '';
      if (s.dism > 0) {
        const needNO = Math.ceil(A * s.dism - s.R - EPS);
        extra = needNO <= 0 ? ' Any not-out score keeps it there.' : ` Or <strong>${needNO}</strong> not out.`;
      }
      out.push(answer(needOut, `runs next innings, if dismissed, to lift the average to <strong>${nf(A, 2)}</strong>.${extra}`, '', `${nf(A, 2)} × (${s.dism} + 1 dismissals) − ${s.R} runs = ${needOut}`));
    }
  }
  if (isNum(S) && S > 0 && isNum(N) && N > 0) {
    const need = Math.ceil(S * (s.B + N) / 100 - s.R - EPS);
    if (need <= 0) out.push(answer('✓', `Already there. Even ${N} straight dot balls leaves the strike rate at <strong>${nf(s.R / (s.B + N) * 100)}</strong>.`, 'good'));
    else if (need > 6 * N) out.push(answer('✗', `Not possible in ${N} balls: it needs ${need} runs, and the most you can score is ${6 * N}.`, 'bad'));
    else out.push(answer(need, `runs off the next ${N} balls to reach a strike rate of <strong>${nf(S, 0)}</strong>. That's ${nf(need / N * 100)} for those balls.`, '', `${nf(S, 0)} × (${s.B} + ${N}) ÷ 100 − ${s.R} = ${need}`));
  }
  $('#o-bat-t').innerHTML = out.join('');
};