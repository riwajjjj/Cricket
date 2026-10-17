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
// w: wickets team 2 had lost; lost: balls lost; formatOvers: the format's full innings (sets the G adjustment).
export function dlsRevised({ S, n1, n2, u = 0, w = 0, lost = 0, formatOvers = 50 }) {
  const R1 = DLS.res(n1, 0);
  const start2 = DLS.res(n2, 0);
  const atStop = DLS.res((n2 * 6 - u) / 6, w);
  const after = DLS.res((n2 * 6 - u - lost) / 6, w);
  const used = start2 - atStop;
  const R2 = used + after;
  const G = G50 * DLS.res(formatOvers, 0) / 100;
  const parFor = R => (R <= R1 ? S * R / R1 : S + G * (R - R1) / 100);
  return {
    R1, R2, used, after,
    target: Math.floor(parFor(R2) + EPS) + 1,
    parNow: Math.floor(parFor(used) + EPS),
    revisedBalls: n2 * 6 - lost,
  };
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
    const side = { a: null, b: null };
    d.inns.forEach(inn => {
      const allOut = inn.ended === 'all out';
      side[inn.bat === ai ? 'a' : 'b'] = { r: inn.runs, balls: inn.balls, faced: allOut && quota ? quota : inn.balls, ao: allOut, w: inn.wkts };
    });
    if (!side.a || !side.b) return null;
    const [i1, i2] = d.inns;
    const firstSide = i1.bat === ai ? 'a' : 'b', secondSide = firstSide === 'a' ? 'b' : 'a';
    const winner = i2.runs >= i2.target ? secondSide : i2.runs === i2.target - 1 ? null : firstSide;
    return { a: side.a, b: side.b, winner, text: d.result, linked: m };
  }
  if (f.manual) {
    const quota = (t.overs || 0) * 6;
    const fix = s => ({ ...s, faced: s.ao && quota ? quota : s.balls });
    const A = fix(f.manual.a), B = fix(f.manual.b);
    const winner = A.r > B.r ? 'a' : B.r > A.r ? 'b' : null;
    const sc = (x, s) => `${x} ${s.r}${s.w != null && s.w < 10 ? `/${s.w}` : ''} (${Math.floor(s.balls / 6)}${s.balls % 6 ? '.' + (s.balls % 6) : ''})`;
    const text = winner ? `${winner === 'a' ? f.a : f.b} won · ${sc(f.a, A)} v ${sc(f.b, B)}` : `Tied · ${sc(f.a, A)} v ${sc(f.b, B)}`;
    return { a: A, b: B, winner, text };
  }
  return null;
}

// Points table sorted by points, then net run rate, then wins.
export function pointsTable(t, matches) {
  const byId = new Map(matches.map(m => [m.id, m]));
  const rows = new Map(t.teams.map(n => [n, { team: n, p: 0, w: 0, l: 0, tie: 0, nr: 0, pts: 0, rf: 0, bf: 0, ra: 0, bb: 0 }]));
  const pts = t.pts || { w: 2, t: 1, nr: 1, l: 0 };
  for (const f of t.fixtures) {
    const o = fixtureOutcome(t, f, byId);
    if (!o || o.error) continue;
    const A = rows.get(f.a), B = rows.get(f.b);
    if (!A || !B) continue;
    A.p++; B.p++;
    if (o.nr) { A.nr++; B.nr++; A.pts += pts.nr; B.pts += pts.nr; continue; }
    if (o.winner === 'a') { A.w++; B.l++; A.pts += pts.w; B.pts += pts.l || 0; }
    else if (o.winner === 'b') { B.w++; A.l++; B.pts += pts.w; A.pts += pts.l || 0; }
    else { A.tie++; B.tie++; A.pts += pts.t; B.pts += pts.t; }
    A.rf += o.a.r; A.bf += o.a.faced; A.ra += o.b.r; A.bb += o.b.faced;
    B.rf += o.b.r; B.bf += o.b.faced; B.ra += o.a.r; B.bb += o.a.faced;
  }
  const out = [...rows.values()];
  out.forEach(r => { r.nrr = nrrOf({ RF: r.rf, OF: r.bf, RA: r.ra, OB: r.bb }); });
  out.sort((x, y) => y.pts - x.pts || (y.nrr ?? -99) - (x.nrr ?? -99) || y.w - x.w || x.team.localeCompare(y.team));
  return out;
}
