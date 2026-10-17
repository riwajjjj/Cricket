/* Crease — test cases for the calculations. Shared by the Node runner (maths.test.js) and the
   in-browser runner (index.html), so both check exactly the same things.
   Each case is { group, name, run } and `run` throws when something is wrong. */
import { parseOvers, fmtOvers, DLS, rate, winProb, FORMATS } from '../js/maths.js';
import { batStats, bowlStats, nrrOf, nrrSolveBatFirst, nrrSolveChase, dlsRevised, fixtureOutcome, pointsTable } from '../js/stats.js';
import { buildRecords, parseDismissal, batFigures, bowlFigures, nameKey } from '../js/records.js';

/* ---------- tiny assertion helpers ---------- */
const show = v => (typeof v === 'string' ? JSON.stringify(v) : String(v));
export function eq(actual, expected, what = 'value') {
  if (actual !== expected) throw new Error(`${what}: expected ${show(expected)}, got ${show(actual)}`);
}
export function close(actual, expected, tol = 0.005, what = 'value') {
  if (typeof actual !== 'number' || !Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error(`${what}: expected ${expected} (±${tol}), got ${show(actual)}`);
  }
}
export function ok(cond, what = 'condition') { if (!cond) throw new Error(`${what} was false`); }

const cases = [];
const t = (group, name, run) => cases.push({ group, name, run });

/* ---------- Overs notation ---------- */
t('Overs', '12.4 overs is 76 balls', () => eq(parseOvers('12.4').balls, 76));
t('Overs', 'whole overs', () => eq(parseOvers('20').balls, 120));
t('Overs', '12.6 is rejected (balls go 0 to 5)', () => { const r = parseOvers('12.6'); eq(r.balls, null); ok(r.error, 'error message'); });
t('Overs', 'text is rejected', () => ok(parseOvers('ten').error, 'error message'));
t('Overs', 'blank is empty, not an error', () => { const r = parseOvers(''); eq(r.balls, null); eq(r.error, undefined); });
t('Overs', 'balls back to overs', () => { eq(fmtOvers(76), '12.4'); eq(fmtOvers(120), '20'); eq(fmtOvers(5), '0.5'); eq(fmtOvers(null), '—'); });

/* ---------- Resource model ---------- */
t('Resources', 'a full 50-over innings is 100%', () => close(DLS.res(50, 0), 100, 1e-9));
t('Resources', '50 overs, 5 down matches the published 49.0%', () => close(DLS.res(50, 5), 49.0, 0.01));
t('Resources', 'every published 50-over value is matched', () => {
  [100, 93.4, 85.1, 74.9, 62.7, 49.0, 34.9, 22.0, 11.9, 4.7].forEach((v, w) => close(DLS.res(50, w), v, 0.01, `${w} down`));
});
t('Resources', 'nothing left with no overs or 10 down', () => { eq(DLS.res(0, 0), 0); eq(DLS.res(20, 10), 0); });
t('Resources', 'T20 start is about 59% of an ODI', () => close(DLS.res(20, 0), 59.2, 0.2));
t('Resources', 'fewer overs or more wickets always means less', () => {
  for (let w = 0; w < 9; w++) for (let u = 1; u <= 50; u++) {
    ok(DLS.res(u, w) > DLS.res(u, w + 1), `res(${u},${w}) > res(${u},${w + 1})`);
    ok(DLS.res(u, w) > DLS.res(u - 1, w), `res(${u},${w}) > res(${u - 1},${w})`);
  }
});

/* ---------- Ratings and win probability ---------- */
t('Ratings', 'strike rate 140 in a T20 is Good', () => eq(rate(140, FORMATS.T20.sr), 2));
t('Ratings', 'economy 6.5 in a T20 is Elite (lower is better)', () => eq(rate(6.5, FORMATS.T20.econ, false), 3));
t('Ratings', 'missing values have no rating', () => eq(rate(null, FORMATS.T20.sr), null));
t('Win chance', 'a finished chase is 100%', () => eq(winProb(0, 30, 3, 20, FORMATS.T20), 100));
t('Win chance', 'no balls left and runs needed is 0%', () => eq(winProb(5, 0, 3, 20, FORMATS.T20), 0));
t('Win chance', 'all out is 0%', () => eq(winProb(5, 30, 10, 20, FORMATS.T20), 0));
t('Win chance', 'more than 6 an over from every ball left is 0%', () => eq(winProb(37, 6, 0, 20, FORMATS.T20), 0));
t('Win chance', 'an open chase stays between 1% and 99%', () => {
  [[1, 60, 0], [30, 12, 9], [40, 30, 3], [180, 120, 0]].forEach(([n, b, w]) => { const p = winProb(n, b, w, 20, FORMATS.T20); ok(p >= 1 && p <= 99, `${n} off ${b}, ${w} down → ${p}`); });
});
t('Win chance', 'losing a wicket lowers the chance', () => ok(winProb(50, 36, 3, 20, FORMATS.T20) > winProb(50, 36, 6, 20, FORMATS.T20)));

/* ---------- Batting and bowling ---------- */
t('Batting', 'strike rate, average, boundary share', () => {
  const s = batStats({ runs: 368, balls: 280, inns: 10, no: 1, f4: 32, f6: 14, dots: 100 });
  close(s.sr, 131.4286, 1e-3, 'strike rate'); close(s.avg, 40.8889, 1e-3, 'average');
  close(s.bdry, (32 * 4 + 14 * 6) / 368 * 100, 1e-9, 'boundary %'); close(s.bpb, 280 / 46, 1e-9, 'balls per boundary');
  close(s.dot, 100 / 280 * 100, 1e-9, 'dot %'); eq(s.other, 280 - 100 - 46, 'other scoring balls');
});
t('Batting', 'never dismissed has no average', () => eq(batStats({ runs: 50, balls: 40, inns: 2, no: 2 }).avg, null));
t('Batting', 'no balls faced has no strike rate', () => eq(batStats({ runs: 0, balls: 0, inns: 1 }).sr, null));
t('Batting', 'conversion rate of fifties into hundreds', () => close(batStats({ runs: 900, balls: 800, inns: 20, fifties: 3, hundreds: 1 }).conv, 25, 1e-9));
t('Bowling', 'economy, average, strike rate', () => {
  const s = bowlStats({ overs: 24, runs: 26, wkts: 2, dots: 12, wd: 1, nb: 1, maidens: 1 });
  close(s.econ, 6.5, 1e-9, 'economy'); close(s.avg, 13, 1e-9, 'average'); close(s.sr, 12, 1e-9, 'strike rate');
  close(s.dot, 50, 1e-9, 'dot %'); close(s.mdn, 25, 1e-9, 'maiden %'); close(s.xpo, 0.5, 1e-9, 'extras per over');
});
t('Bowling', 'no wickets has no average or strike rate', () => { const s = bowlStats({ overs: 12, runs: 20, wkts: 0 }); eq(s.avg, null); eq(s.sr, null); });

/* ---------- Net run rate ---------- */
const empty = { RF: 0, OF: 0, RA: 0, OB: 0 };
t('Net run rate', '180 in 20 against 170 in 20 is +0.500', () => close(nrrOf({ RF: 180, OF: 120, RA: 170, OB: 120 }), 0.5, 1e-9));
t('Net run rate', 'no overs yet has no net run rate', () => eq(nrrOf(empty), null));
t('Net run rate', 'batting first with 160: most the other side can make', () => {
  eq(nrrSolveBatFirst(empty, 0, 160, 120).R, 159, 'to stay above 0');
  eq(nrrSolveBatFirst(empty, 1, 160, 120).R, 139, 'to stay above +1');
});
t('Net run rate', 'chasing 150: most balls the chase can take', () => {
  eq(nrrSolveChase(empty, 0, 150, 120).balls, 120, 'to stay above 0');
  eq(nrrSolveChase(empty, 1, 150, 120).balls, 106, 'to stay above +1');
});
t('Net run rate', 'an impossible target has no answer', () => eq(nrrSolveBatFirst(empty, 50, 160, 120), null));

/* ---------- Rain-affected targets ---------- */
t('Rain target', 'no rain: target is one more than the first innings', () => eq(dlsRevised({ S: 250, n1: 50, n2: 50 }).target, 251));
t('Rain target', '10 overs lost before the chase', () => {
  const r = dlsRevised({ S: 250, n1: 50, n2: 50, lost: 60 });
  eq(r.target, Math.floor(250 * DLS.res(40, 0) / 100) + 1); eq(r.revisedBalls, 240);
});
t('Rain target', 'team 1 cut short: team 2 gets more to chase (G50 = 245)', () => {
  const R1 = DLS.res(40, 0); const r = dlsRevised({ S: 200, n1: 40, n2: 50 });
  eq(r.target, Math.floor(200 + 245 * (100 - R1) / 100) + 1); ok(r.target > 201, 'target above 201');
});
t('Rain target', 'T20: 172 to chase, rain at 9.2 overs (2 down), 5 overs lost → 131 off 15', () => {
  const r = dlsRevised({ S: 172, n1: 20, n2: 20, u: 56, w: 2, lost: 30, formatOvers: 20 });
  eq(r.revisedBalls, 90); eq(r.target, 131); eq(r.parNow, 71, 'par score at the stoppage');
  eq(r.target, Math.floor(172 * r.R2 / r.R1) + 1, 'target = 172 × R2 ÷ R1, plus 1');
});
t('Rain target', 'ODI: 248 to chase, rain at 22.4 overs (3 down), 12 overs lost → 206 off 38', () => {
  const r = dlsRevised({ S: 248, n1: 50, n2: 50, u: 136, w: 3, lost: 72 });
  eq(r.revisedBalls, 228); eq(r.target, 206);
});
t('Rain target', 'losing more overs never raises the target', () => {
  let last = Infinity;
  for (let lost = 0; lost <= 180; lost += 6) { const tg = dlsRevised({ S: 250, n1: 50, n2: 50, u: 120, w: 3, lost }).target; ok(tg <= last, `${lost} balls lost`); last = tg; }
});

/* ---------- Player records ---------- */
const match = {
  id: 'm1', title: 'Lions v Tigers', savedAt: 1,
  data: {
    status: 'done', format: 'T20', teams: ['Lions', 'Tigers'], result: 'Lions won by 20 runs',
    squads: [['Asha', 'Ben', 'Cara'], ['Dev', 'Eli', 'Finn']],
    inns: [
      { bat: 0, runs: 150, wkts: 2, balls: 120,
        batters: [{ name: 'Asha', runs: 72, balls: 50, f4: 6, f6: 3, dots: 15, out: true, how: 'c Finn b Eli' },
          { name: 'Ben', runs: 0, balls: 3, f4: 0, f6: 0, dots: 3, out: true, how: 'b Dev' },
          { name: 'Cara', runs: 70, balls: 67, f4: 5, f6: 1, dots: 20, out: false, how: 'not out' }],
        bowlers: [{ name: 'Dev', balls: 60, runs: 70, wkts: 1, maidens: 0, dots: 20, wd: 1, nb: 0 },
          { name: 'Eli', balls: 60, runs: 72, wkts: 1, maidens: 1, dots: 25, wd: 0, nb: 0 }],
        mu: { '1|0': { balls: 20, runs: 30, dots: 4, f4: 2, f6: 2, outs: 1 } } },
      { bat: 1, runs: 130, wkts: 10, balls: 110,
        batters: [{ name: 'dev', runs: 60, balls: 40, f4: 4, f6: 3, dots: 10, out: true, how: 'st Cara b Asha' },
          { name: 'Eli', runs: 10, balls: 12, f4: 1, f6: 0, dots: 5, out: true, how: 'run out (Ben)' }],
        bowlers: [{ name: 'Asha', balls: 60, runs: 55, wkts: 4, maidens: 0, dots: 22, wd: 0, nb: 1 }] },
    ],
  },
};
t('Records', 'dismissal text is read correctly', () => {
  const c = parseDismissal({ how: 'c Finn b Eli' }); eq(c.how, 'caught'); eq(c.fielder, 'Finn'); eq(c.bowler, 'Eli');
  eq(parseDismissal({ how: 'c & b Eli' }).fielder, 'Eli'); eq(parseDismissal({ how: 'run out (Ben)' }).fielder, 'Ben');
  eq(parseDismissal({ how: 'lbw b Dev' }).how, 'lbw'); eq(parseDismissal({ how: 'b Dev' }).how, 'bowled');
});
t('Records', 'names match whatever the case and spacing', () => eq(nameKey('  Dev   Patel '), 'dev patel'));
t('Records', 'batting and bowling totals from a scored match', () => {
  const r = buildRecords([match], { includeBase: false });
  const asha = r.get('asha'); eq(asha.total.bat.runs, 72); eq(asha.total.bowl.wkts, 4); eq(asha.total.matches, 1);
  eq(bowlFigures(asha.total.bowl).best, '4/55'); close(bowlFigures(asha.total.bowl).econ, 5.5, 1e-9, 'economy');
  eq(batFigures(r.get('cara').total.bat).hs, '70*'); eq(r.get('ben').total.bat.ducks, 1);
  const dev = r.get('dev'); eq(dev.total.bat.runs, 60, 'lower-case "dev" joins Dev'); eq(dev.total.bowl.wkts, 1);
});
t('Records', 'catches, stumpings and run outs are credited', () => {
  const r = buildRecords([match], { includeBase: false });
  eq(r.get('finn').field.ct, 1); eq(r.get('cara').field.st, 1); eq(r.get('ben').field.ro, 1);
  eq(r.get('asha').bowl.types.stumped, 1); eq(r.get('eli').bowl.types.caught, 1);
});
t('Records', 'match-ups are stored both ways', () => {
  const r = buildRecords([match], { includeBase: false });
  eq(r.get('asha').vsBowl.get('eli').runs, 30); eq(r.get('eli').vsBat.get('asha').outs, 1);
});
t('Records', 'earlier runs without balls faced stay out of the strike rate', () => {
  const base = { asha: { name: 'Asha', matches: 30, bat: { inns: 28, no: 2, runs: 900 }, bowl: { wkts: 12 } } }; // no balls, no runs conceded
  const a = buildRecords([match], { base }).get('asha');
  eq(a.total.bat.runs, 972, 'career runs include earlier runs'); eq(a.total.matches, 31);
  close(batFigures(a.total.bat).sr, 72 / 50 * 100, 1e-9, 'strike rate from scored balls only');
  close(batFigures(a.total.bat).avg, 972 / 27, 1e-9, 'average uses all runs and dismissals');
  close(bowlFigures(a.total.bowl).avg, 55 / 4, 1e-9, 'wickets without runs conceded stay out of the average');
});
t('Records', 'complete earlier stats count in every rate', () => {
  const base = { asha: { name: 'Asha', bat: { inns: 10, no: 0, runs: 300, balls: 250 }, bowl: { balls: 120, runs: 100, wkts: 5 } } };
  const t2 = buildRecords([match], { base }).get('asha').total;
  close(batFigures(t2.bat).sr, 372 / 300 * 100, 1e-9, 'strike rate'); close(bowlFigures(t2.bowl).econ, 155 / 30, 1e-9, 'economy');
  close(bowlFigures(t2.bowl).avg, 155 / 9, 1e-9, 'average'); close(bowlFigures(t2.bowl).sr, 180 / 9, 1e-9, 'strike rate');
});
t('Records', 'squad members who did nothing still played', () => eq(buildRecords([match], { includeBase: false }).get('finn').total.matches, 1));

/* ---------- Tournaments ---------- */
const side = (r, w, balls, ao = false) => ({ r, w, balls, ao });
const tour = {
  overs: 20, teams: ['A', 'B', 'C'], pts: { w: 2, t: 1, nr: 1, l: 0 },
  fixtures: [
    { a: 'A', b: 'B', manual: { a: side(180, 5, 120), b: side(170, 8, 120) } },
    { a: 'B', b: 'C', manual: { a: side(150, 10, 96, true), b: side(151, 3, 90) } },
    { a: 'A', b: 'C' },
  ],
};
t('Tournament', 'points and net run rate (all out counts the full 20 overs)', () => {
  const tb = pointsTable(tour, []);
  eq(tb.map(x => x.team).join(','), 'C,A,B', 'order');
  const [C, A, B] = tb;
  eq(C.pts, 2); eq(A.pts, 2); eq(B.pts, 0); eq(B.p, 2); eq(B.l, 2);
  close(C.nrr, 151 / 15 - 150 / 20, 1e-9, 'C'); close(A.nrr, 0.5, 1e-9, 'A'); close(B.nrr, 320 / 40 - 331 / 35, 1e-9, 'B');
});
t('Tournament', 'no result gives each side a point', () => {
  const tb = pointsTable({ ...tour, fixtures: [{ a: 'A', b: 'B', nr: true }] }, []);
  eq(tb.find(x => x.team === 'A').pts, 1); eq(tb.find(x => x.team === 'B').nr, 1);
});
t('Tournament', 'unplayed fixtures don\'t count', () => eq(pointsTable(tour, []).find(x => x.team === 'C').p, 1));
t('Tournament', 'a linked match with no result counts as a no result', () => {
  const m = { id: 'x', data: { status: 'done', result: 'No result', teams: ['A', 'B'], inns: [{ bat: 0, runs: 80, balls: 60, wkts: 2, ended: 'overs' }, { bat: 1, runs: 10, balls: 12, wkts: 0, target: 81, ended: 'abandoned' }] } };
  const tb = pointsTable({ ...tour, fixtures: [{ a: 'A', b: 'B', matchId: 'x' }] }, [m]);
  const A = tb.find(x => x.team === 'A'); eq(A.nr, 1); eq(A.pts, 1); eq(A.w, 0); eq(A.nrr, null, 'no-result runs stay out of net run rate');
});
t('Tournament', 'a Test match can\'t be linked to a points table', () => {
  const o = fixtureOutcome(tour, { a: 'A', b: 'B', matchId: 'x' }, new Map([['x', { data: { status: 'done', matchType: 'test', teams: ['A', 'B'], inns: [] } }]]));
  ok(o && o.error, 'error returned');
});

export default cases;
