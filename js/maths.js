/* Crease — Cricket maths: overs notation, format benchmarks, the resource model and win probability. */
import { clamp, isNum } from './utils.js';
/* =====================================================================
   2. Cricket maths: overs, formats, resources, win probability
   ===================================================================== */
export function parseOvers(str) {
  const s = String(str ?? '').trim();
  if (s === '') return { balls: null };
  if (!/^\d+(\.\d)?$/.test(s)) return { balls: null, error: 'write overs like 12 or 12.4' };
  const [o, b = '0'] = s.split('.');
  if (+b > 5) return { balls: null, error: `${s} isn't valid: the number after the dot counts balls, 0 to 5` };
  return { balls: (+o) * 6 + (+b) };
}
export const fmtOvers = balls => isNum(balls) ? `${Math.floor(balls / 6)}${balls % 6 ? '.' + (balls % 6) : ''}` : '—';

// Benchmarks per format. Threshold arrays give the Poor | Average | Good | Elite cut points.
export const FORMATS = {
  T20:  { key: 'T20',  label: 'T20',  overs: 20, sr: [110, 130, 150], bavg: [20, 28, 36], batDot: [45, 38, 32], econ: [9, 8, 7],       bowlAvg: [32, 25, 19], bowlSR: [24, 18, 14], bowlDot: [30, 38, 45], avgScore: 165, parRuns: 35, parSR: 135, parEcon: 8,   wkRef: 4, sixRef: 9 },
  ODI:  { key: 'ODI',  label: 'ODI',  overs: 50, sr: [75, 88, 100],   bavg: [25, 35, 45], batDot: [55, 48, 42], econ: [6, 5.4, 4.7],    bowlAvg: [40, 32, 26], bowlSR: [45, 36, 30], bowlDot: [45, 52, 58], avgScore: 280, parRuns: 50, parSR: 90,  parEcon: 5.4, wkRef: 4, sixRef: 4 },
  Test: { key: 'Test', label: 'Test', overs: null, sr: [40, 52, 65],  bavg: [25, 35, 45], batDot: [82, 76, 70], econ: [3.8, 3.2, 2.7], bowlAvg: [38, 30, 24], bowlSR: [75, 60, 50], bowlDot: [70, 77, 82], avgScore: null, parRuns: 60, parSR: 55, parEcon: 3.2, wkRef: 5, sixRef: 2 },
  T10:  { key: 'T10',  label: 'T10',  overs: 10, sr: [130, 155, 185], bavg: [15, 22, 30], batDot: [40, 34, 28], econ: [11, 10, 8.5],   bowlAvg: [25, 18, 13], bowlSR: [15, 11, 8],  bowlDot: [25, 33, 40], avgScore: 115, parRuns: 25, parSR: 165, parEcon: 10,  wkRef: 3, sixRef: 14 },
};
export const RATINGS = ['Poor', 'Average', 'Good', 'Elite'];

// Benchmarks for any overs-per-side, scaled from the nearest standard format.
export function profileFor(n) {
  const base = n <= 12 ? FORMATS.T10 : n <= 30 ? FORMATS.T20 : FORMATS.ODI;
  const avgScore = Math.round(base.avgScore * DLS.res(n, 0) / DLS.res(base.overs, 0));
  return { ...base, key: 'Custom', label: `${n}-over`, overs: n, avgScore };
}
export function rate(v, th, higherIsBetter = true) {
  if (!isNum(v) || !th) return null;
  if (higherIsBetter) return v < th[0] ? 0 : v < th[1] ? 1 : v < th[2] ? 2 : 3;
  return v > th[0] ? 0 : v > th[1] ? 1 : v > th[2] ? 2 : 3;
}

/* Resource model. The Duckworth–Lewis form Z(u,w) = F(w)·(1 − e^(−b·u/F(w))), with each F(w) solved so
   that with 50 overs left the model returns the published Standard Edition value for w wickets lost,
   and b = 0.0274 fitted to the whole published table (5 to 50 overs left, 0 to 9 wickets): every
   entry is matched to within 0.1 of a percentage point. Resources are % of a full 50-over innings. */
export const DLS = (() => {
  const B = 0.0274, N0 = 50;
  const norm = 1 - Math.exp(-B * N0);
  const T50 = [100, 93.4, 85.1, 74.9, 62.7, 49.0, 34.9, 22.0, 11.9, 4.7];
  const raw = (u, F) => F * (1 - Math.exp(-B * u / F)) / norm * 100;
  const F = T50.map(t => {
    let lo = 1e-4, hi = 2;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (raw(N0, mid) < t) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  });
  const res = (u, w) => (u <= 0 || w >= 10) ? 0 : raw(u, F[Math.max(0, Math.floor(w))]);
  return { res };
})();
export const G50 = 245;

export function winProb(need, ballsLeft, wkDown, totalOvers, f) {
  if (need <= 0) return 100;
  if (ballsLeft <= 0 || wkDown >= 10) return 0;
  if (need > ballsLeft * 6) return 0; // out of reach without extras
  const base = f.avgScore ?? FORMATS.T20.avgScore;
  const baseOvers = f.overs ?? 20;
  const avgN = base * DLS.res(totalOvers, 0) / DLS.res(baseOvers, 0);
  const r = DLS.res(ballsLeft / 6, wkDown) / DLS.res(totalOvers, 0);
  const par = avgN * r;
  const scale = Math.max(4, 0.11 * avgN * Math.sqrt(r));
  const p = 100 / (1 + Math.exp(-(par - need) / scale));
  return clamp(p, 1, 99); // only a finished chase shows 0% or 100%
}