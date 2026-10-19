/* Crease — pure cricket calculations shared by the tabs and covered by the tests in /tests.
   Nothing here touches the page or browser storage, so it runs the same in Node and in the browser. */
import { DLS, G50 } from './maths.js';

const EPS = 1e-9;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/* ---------- Batting and bowling figures ---------- */
export function batStats(v) {
  const R = v.runs ?? 0, B = v.balls ?? 0, I = v.inns ?? 0, NO = v.no ?? 0, F4 = v.f4 ?? 0, F6 = v.f6 ?? 0, D = v.dots ?? 0;
  const fifties = v.fifties ?? 0, hundreds = v.hundreds ?? 0;
  const dism = I - NO;
  const bRuns = 4 * F4 + 6 * F6;
  const other = B - D - F4 - F6;
  return {
    R, B, I, NO, F4, F6, D, fifties, hundreds, dism, bRuns, other,
    sr: B > 0 ? R / B * 100 : null,
    avg: dism > 0 ? R / dism : null,
    bdry: R > 0 ? bRuns / R * 100 : null,
    bpb: (F4 + F6) > 0 && B > 0 ? B / (F4 + F6) : null,
    dot: B > 0 ? D / B * 100 : null,
    rpi: I > 0 ? R / I : null,
    rot: B > 0 && other >= 0 ? other / B * 100 : null,
    conv: (fifties + hundreds) > 0 ? hundreds / (fifties + hundreds) * 100 : null,
    s100: B > 0 ? F6 / B * 100 : null,
  };
}

export function bowlStats(v) {
  const balls = v.overs ?? 0, R = v.runs ?? 0, W = v.wkts ?? 0, D = v.dots ?? 0, M = v.maidens ?? 0, Wd = v.wd ?? 0, Nb = v.nb ?? 0;
  const types = [v.bowled ?? 0, v.caught ?? 0, v.lbw ?? 0, v.stumped ?? 0, v.other ?? 0];
  const full = Math.floor(balls / 6);
  return {
    balls, R, W, D, M, Wd, Nb, types, full,
    econ: balls > 0 ? R / (balls / 6) : null,
    avg: W > 0 ? R / W : null,
    sr: W > 0 ? balls / W : null,
    dot: balls > 0 ? D / balls * 100 : null,
    mdn: full > 0 ? M / full * 100 : null,
    xpo: balls > 0 ? (Wd + Nb) / (balls / 6) : null,
  };
}

/* ---------- Net run rate ---------- */
// totals: { RF, OF, RA, OB } with overs in balls. A side bowled out counts as facing its full quota.
export const nrrOf = t => (t.OF > 0 && t.OB > 0 ? t.RF / (t.OF / 6) - t.RA / (t.OB / 6) : null);

// Batting first and scoring `score`: the most the opposition can make for NRR to finish above `target`.
export function nrrSolveBatFirst(base, target, score, quotaBalls) {
  for (let R = score - 1; R >= 0; R--) {
    const v = (base.RF + score) / ((base.OF + quotaBalls) / 6) - (base.RA + R) / ((base.OB + quotaBalls) / 6);
    if (v > target) return { R, nrr: v };
  }
  return null;
}
// Chasing `runsToWin`: the most balls the chase can take for NRR to finish above `target`.
export function nrrSolveChase(base, target, runsToWin, quotaBalls) {
  const oppConc = (base.RA + runsToWin - 1) / ((base.OB + quotaBalls) / 6);
  for (let bb = quotaBalls; bb >= 1; bb--) {
    const v = (base.RF + runsToWin) / ((base.OF + bb) / 6) - oppConc;
    if (v > target) return { balls: bb, nrr: v };
  }
  return null;
}

/* ---------- Rain-affected target (DLS-style) ---------- */
// S: team 1 total; n1, n2: overs each side had at the start; u: balls bowled to team 2 before the stoppage;
// w: wickets team 2 had lost; lost: balls lost. formatOvers is accepted for older callers but no longer used.
export function dlsRevised({ S, n1, n2, u = 0, w = 0, lost = 0, formatOvers = 50 }) {
  const R1 = DLS.res(n1, 0);
  const start2 = DLS.res(n2, 0);
  const atStop = DLS.res((n2 * 6 - u) / 6, w);
  const after = DLS.res((n2 * 6 - u - lost) / 6, w);
  const used = start2 - atStop;
  const R2 = used + after;
  // Resources are % of a 50-over innings at every match length, so G50 applies unscaled (T20s included).
  const parFor = R => (R <= R1 ? S * R / R1 : S + G50 * (R - R1) / 100);
  return {
    R1, R2, used, after,
    target: Math.floor(parFor(R2) + EPS) + 1,
    parNow: Math.floor(parFor(used) + EPS),
    revisedBalls: n2 * 6 - lost,
  };
}

/* ---------- Rain across several stoppages (used by the live scorer) ---------- */
// stops: [{ u: balls bowled when play stopped, w: wickets down (on the 10-wicket scale), lost: balls taken off }]
// Returns the resources (% of a 50-over innings) the side had in all, and its final allocation in balls.
export function resourcesWithStops(startBalls, stops = []) {
  let alloc = startBalls, R = DLS.res(startBalls / 6, 0);
  for (const s of stops) {
    const before = DLS.res(Math.max(0, alloc - s.u) / 6, s.w);
    alloc -= s.lost;
    const after = DLS.res(Math.max(0, alloc - s.u) / 6, s.w);
    R -= before - after;
  }
  return { R, alloc };
}
// Team 2's target, and its par score at this moment (what it needed if no more play were possible now).
export function dlsMatch({ S, n1Balls, stops1 = [], n2Balls, stops2 = [], formatOvers, balls2 = 0, wkts2 = 0 }) {
  const a = resourcesWithStops(n1Balls, stops1), b = resourcesWithStops(n2Balls, stops2);
  const parFor = R => (R <= a.R + EPS ? S * R / a.R : S + G50 * (R - a.R) / 100);
  const leftNow = DLS.res(Math.max(0, b.alloc - balls2) / 6, wkts2);
  return { R1: a.R, R2: b.R, alloc2: b.alloc, target: Math.floor(parFor(b.R) + EPS) + 1, parNow: Math.floor(parFor(b.R - leftNow) + EPS) };
}

/* ---------- Tournaments ---------- */
// A fixture's result: null (not played), { nr }, { error }, or scores for sides a and b plus the winner.
export function fixtureOutcome(t, f, byId) {
  if (f.nr) return { nr: true, text: 'No result' };
  if (f.matchId) {
    const m = byId.get(f.matchId);
    if (!m || m.data.status !== 'done') return null;
    const d = m.data;
    if (d.matchType === 'test') return { error: 'Test matches can\'t go in a points table.' };
    if (d.result === 'No result') return { nr: true, text: 'No result', linked: m };
    let ai = d.teams.findIndex(x => same(x, f.a)), bi = d.teams.findIndex(x => same(x, f.b));
    if (ai === -1 && bi !== -1) ai = 1 - bi;
    if (bi === -1 && ai !== -1) bi = 1 - ai;
    if (ai === -1) return { error: 'The linked match has different team names.' };
    const quota = (d.overs || t.overs || 0) * 6;
    const cap = inn => inn.maxBalls ?? quota; // overs a side was allotted, after any rain cuts
    const side = { a: null, b: null };
    d.inns.forEach(inn => {
      const allOut = inn.ended === 'all out';
      side[inn.bat === ai ? 'a' : 'b'] = { r: inn.runs, balls: inn.balls, faced: allOut && cap(inn) ? cap(inn) : inn.balls, ao: allOut, w: inn.wkts };
    });
    if (!side.a || !side.b) return null;
    const [i1, i2] = d.inns;
    const firstSide = i1.bat === ai ? 'a' : 'b', secondSide = firstSide === 'a' ? 'b' : 'a';
    // A rain-revised chase: for net run rate, Team 1 counts as one run short of the target, off Team 2's overs.
    if (i2.dls && i2.target != null && cap(i2)) side[firstSide] = { ...side[firstSide], r: i2.target - 1, balls: cap(i2), faced: cap(i2), ao: false };
    let winner;
    if (i2.ended === 'rain' && d.dlsPar != null) winner = i2.runs > d.dlsPar ? secondSide : i2.runs === d.dlsPar ? null : firstSide;
    else winner = i2.runs >= i2.target ? secondSide : i2.runs === i2.target - 1 ? null : firstSide;
    return { a: side.a, b: side.b, winner, so: winner == null ? soOf(f) : null, text: d.result, linked: m };
  }
  if (f.manual) {
    const quota = (t.overs || 0) * 6;
    const fix = s => ({ ...s, faced: s.ao && quota ? quota : s.balls });
    const A = fix(f.manual.a), B = fix(f.manual.b);
    const winner = A.r > B.r ? 'a' : B.r > A.r ? 'b' : null;
    const sc = (x, s) => `${x} ${s.r}${s.w != null && s.w < 10 ? `/${s.w}` : ''} (${Math.floor(s.balls / 6)}${s.balls % 6 ? '.' + (s.balls % 6) : ''})`;
    // When it's known who batted first (simulated results), give the margin the usual way.
    const first = f.manual.first === 'a' || f.manual.first === 'b' ? f.manual.first : null;
    const W = winner === 'a' ? A : B, L = winner === 'a' ? B : A;
    const margin = !winner || !first ? '' : winner === first ? ` by ${W.r - L.r} run${W.r - L.r === 1 ? '' : 's'}` : ` by ${10 - (W.w ?? 0)} wicket${10 - (W.w ?? 0) === 1 ? '' : 's'}`;
    const order = first === 'b' ? `${sc(f.b, B)} v ${sc(f.a, A)}` : `${sc(f.a, A)} v ${sc(f.b, B)}`;
    const text = winner ? `${winner === 'a' ? f.a : f.b} won${margin} · ${order}` : `Tied · ${order}`;
    return { a: A, b: B, winner, so: winner == null ? soOf(f) : null, text };
  }
  return null;
}
const soOf = f => (f.so === 'a' || f.so === 'b' ? f.so : null);

// How a played fixture counts: 'a', 'b', 'tie' or 'nr'. With the super-over rule, a tie won in a super over is a win.
export function decided(t, o) {
  if (o.nr) return 'nr';
  if (o.winner) return o.winner;
  if (o.so && t.tieRule === 'so') return o.so;
  return 'tie';
}
export const TIEBREAKS = {
  nrr: 'net run rate, then wins',
  wins: 'wins, then net run rate',
  h2h: 'head-to-head, then net run rate',
};

// Points table sorted by points, then net run rate, then wins.
export function pointsTable(t, matches) {
  const byId = new Map(matches.map(m => [m.id, m]));
  const rows = new Map(t.teams.map(n => [n, { team: n, p: 0, w: 0, l: 0, tie: 0, nr: 0, pts: 0, rf: 0, bf: 0, ra: 0, bb: 0 }]));
  const pts = t.pts || { w: 2, t: 1, nr: 1, l: 0 };
  const league = t.fixtures.filter(f => !f.stage); // knockout matches don't count in the table
  for (const f of league) {
    const o = fixtureOutcome(t, f, byId);
    if (!o || o.error) continue;
    const A = rows.get(f.a), B = rows.get(f.b);
    if (!A || !B) continue;
    A.p++; B.p++;
    const res = decided(t, o);
    if (res === 'nr') { A.nr++; B.nr++; A.pts += pts.nr; B.pts += pts.nr; continue; }
    if (res === 'a') { A.w++; B.l++; A.pts += pts.w; B.pts += pts.l || 0; }
    else if (res === 'b') { B.w++; A.l++; B.pts += pts.w; A.pts += pts.l || 0; }
    else { A.tie++; B.tie++; A.pts += pts.t; B.pts += pts.t; }
    A.rf += o.a.r; A.bf += o.a.faced; A.ra += o.b.r; A.bb += o.b.faced;
    B.rf += o.b.r; B.bf += o.b.faced; B.ra += o.a.r; B.bb += o.a.faced;
  }
  const out = [...rows.values()];
  out.forEach(r => { r.nrr = nrrOf({ RF: r.rf, OF: r.bf, RA: r.ra, OB: r.bb }); r.h2h = 0; });
  const tb = TIEBREAKS[t.tiebreak] ? t.tiebreak : 'nrr';
  if (tb === 'h2h') {
    // Points won in the matches between the teams that are level on points.
    const groups = new Map();
    out.forEach(r => { if (!groups.has(r.pts)) groups.set(r.pts, []); groups.get(r.pts).push(r); });
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const names = new Set(g.map(r => r.team));
      for (const f of league) {
        if (!names.has(f.a) || !names.has(f.b)) continue;
        const o = fixtureOutcome(t, f, byId);
        if (!o || o.error) continue;
        const A = rows.get(f.a), B = rows.get(f.b), res = decided(t, o);
        if (res === 'nr') { A.h2h += pts.nr; B.h2h += pts.nr; }
        else if (res === 'a') { A.h2h += pts.w; B.h2h += pts.l || 0; }
        else if (res === 'b') { B.h2h += pts.w; A.h2h += pts.l || 0; }
        else { A.h2h += pts.t; B.h2h += pts.t; }
      }
    }
  }
  const nrrCmp = (x, y) => (y.nrr ?? -99) - (x.nrr ?? -99);
  out.sort((x, y) => y.pts - x.pts
      || (tb === 'wins' ? y.w - x.w : 0)
      || (tb === 'h2h' ? y.h2h - x.h2h : 0)
      || nrrCmp(x, y) || y.w - x.w || x.team.localeCompare(y.team));
  return out;
}

/* ---------- Qualification ---------- */
// Who can still finish in the top N. Every remaining league fixture is played out both ways (ties and
// no results are left out). Exact for up to 14 remaining fixtures; beyond that, a points-only estimate.
export function qualification(t, matches, N) {
  const byId = new Map(matches.map(m => [m.id, m]));
  const table = pointsTable(t, matches);
  const pts = t.pts || { w: 2, t: 1, nr: 1, l: 0 };
  const n = table.length;
  const idx = new Map(table.map((r, k) => [r.team, k]));
  const rem = t.fixtures.filter(f => !f.stage && idx.has(f.a) && idx.has(f.b) && f.a !== f.b && !fixtureOutcome(t, f, byId));
  const left = table.map(r => rem.filter(f => f.a === r.team || f.b === r.team).length);
  const rows = table.map((r, k) => ({ team: r.team, pts: r.pts, pos: k + 1, left: left[k], inAll: true, outAll: true, anyIn: false, sure: Array(left[k] + 1).fill(true), can: Array(left[k] + 1).fill(false) }));
  if (N < 1 || N >= n) return { rows, exact: true, remaining: rem.length };
  const W = pts.w, L = pts.l || 0;
  if (rem.length > 14) {
    const maxP = table.map((r, k) => r.pts + left[k] * W), minP = table.map((r, k) => r.pts + left[k] * L);
    rows.forEach((r, k) => {
      const surelyAbove = table.filter((_, q) => q !== k && minP[q] > maxP[k]).length;
      const mightCatch = table.filter((_, q) => q !== k && maxP[q] >= minP[k]).length;
      r.outAll = surelyAbove >= N; r.inAll = mightCatch < N; r.anyIn = !r.outAll;
      r.sure = r.sure.map(() => r.inAll); r.can = r.can.map(() => !r.outAll);
    });
    return { rows, exact: false, remaining: rem.length };
  }
  const K = rem.length, P = new Array(n), wins = new Array(n);
  const ends = rem.map(f => [idx.get(f.a), idx.get(f.b)]);
  for (let mask = 0; mask < (1 << K); mask++) {
    for (let k = 0; k < n; k++) { P[k] = table[k].pts; wins[k] = 0; }
    for (let j = 0; j < K; j++) {
      const [A, B] = ends[j];
      const w = (mask >> j) & 1 ? A : B, l = w === A ? B : A;
      P[w] += W; P[l] += L; wins[w]++;
    }
    for (let k = 0; k < n; k++) {
      let above = 0, level = 0;
      for (let q = 0; q < n; q++) if (q !== k) { if (P[q] > P[k]) above++; else if (P[q] === P[k]) level++; }
      const r = rows[k], w = wins[k];
      if (above + level < N) r.anyIn = true; else { r.inAll = false; r.sure[w] = false; }
      if (above < N) { r.outAll = false; r.can[w] = true; }
    }
  }
  return { rows, exact: true, remaining: K };
}