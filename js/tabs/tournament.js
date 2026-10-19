/* Crease — Tournament tab: teams, fixtures, results and a points table with net run rate.
   Results come from matches scored in the live scorer (linked automatically when a fixture is
   scored from here), from a saved match linked by hand, or from scores typed in. */
import { fmtOvers, parseOvers } from '../maths.js';
import { finishedMatches, nameKey, parseDismissal } from '../records.js';
import { RENDER, appHooks, showTab } from '../router.js';
import { TIEBREAKS, decided, fixtureOutcome, nrrOf, pointsTable, qualification } from '../stats.js';
import { closeModal, confirmBox, openModal, toast } from '../ui.js';
import { $, esc, nf, plural, store, uid } from '../utils.js';
import { clearLive, live, matchHooks, openScorecard, setupFromFixture } from './live.js';
import { loadNRR } from './nrr.js';
import { saveMatch } from './saved.js';

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const list = () => { const v = store.get('tournaments', []); return Array.isArray(v) ? v : []; };
const saveAll = ts => store.set('tournaments', ts);
const activeId = () => store.get('tour.active', null);
function active() { const ts = list(); return ts.find(t => t.id === activeId()) || ts[0] || null; }
function update(t) { t.updated = Date.now(); const ts = list(); const k = ts.findIndex(x => x.id === t.id); if (k >= 0) ts[k] = t; else ts.push(t); saveAll(ts); }

/* ---------- Results ---------- */
const outcome = fixtureOutcome;
const table = t => pointsTable(t, finishedMatches());
const signed = v => v == null ? '—' : (v > 0.0005 ? '+' : '') + nf(v, 3);

/* ---------- Knockouts ---------- */
const STAGE = { SF1: 'Semi-final 1', SF2: 'Semi-final 2', Q1: 'Qualifier 1', EL: 'Eliminator', Q2: 'Qualifier 2', F: 'Final' };
const KO_ORDER = ['Q1', 'EL', 'SF1', 'SF2', 'Q2', 'F'];
const ordN = k => (['1st', '2nd', '3rd'][k - 1] || `${k}th`);
// How many teams go through from the table: set in the tournament, otherwise top 4 (or top 2 for small groups).
const qualifyN = t => (Number.isInteger(t.qualify) ? t.qualify : t.teams.length > 4 ? 4 : t.teams.length > 2 ? 2 : 0);
const isPlayed = f => !!(f.matchId || f.manual || f.nr);
// Who goes through from a knockout match. A tie goes to the super-over winner; without one, the
// higher-placed side goes through from a semi-final, and a final is shared.
function koWinner(t, f, byId) {
  if (!f.a || !f.b) return null;
  const o = outcome(t, f, byId);
  if (!o || o.error) return null;
  if (o.winner) return { team: o.winner === 'a' ? f.a : f.b, how: '' };
  if (o.so) return { team: o.so === 'a' ? f.a : f.b, how: 'won the super over' };
  if (f.stage === 'F') return { team: null, how: o.nr ? 'no result' : 'tied' };
  const hi = (f.seedA ?? 99) <= (f.seedB ?? 99) ? f.a : f.b;
  return { team: hi, how: `goes through as the higher-placed side (${o.nr ? 'no result' : 'tied'})` };
}
// A knockout slot filled from an earlier match: "SF1" or "W:Q1" is that match's winner, "L:Q1" its loser.
function fromRef(t, ref, byId) {
  const [take, s] = ref.includes(':') ? ref.split(':') : ['W', ref];
  const f = t.fixtures.find(x => x.stage === s);
  const team = f && koWinner(t, f, byId)?.team;
  if (!team) return null;
  return take === 'L' ? (team === f.a ? f.b : f.a) : team;
}
// Until they are played, later knockout matches (Qualifier 2, the final) follow the earlier results.
function syncFinal(t, byId) {
  let changed = false;
  const seedOf = n => { if (!n) return null; for (const f of t.fixtures) { if (!f.stage) continue; if (f.a === n && f.seedA != null) return f.seedA; if (f.b === n && f.seedB != null) return f.seedB; } return null; };
  KO_ORDER.forEach(s => {
    const f = t.fixtures.find(x => x.stage === s && Array.isArray(x.from));
    if (!f || isPlayed(f)) return;
    const [a, b] = f.from.map(r => fromRef(t, r, byId));
    if (f.a === a && f.b === b) return;
    f.a = a; f.b = b; f.seedA = a ? seedOf(a) : null; f.seedB = b ? seedOf(b) : null;
    changed = true;
  });
  return changed;
}

/* ---------- Simulated results ----------
   For trying out a tournament without scoring every match. Each team gets a hidden strength when the
   first match is simulated, so some sides are better than others, like a real league. Scores follow
   typical totals for the overs (about 165 in a T20, 280 in a 50-over match). */
// Typical scoring rate for the overs: about 165 in a T20, 280 in a 50-over match.
const rpoFor = O => (O <= 10 ? 10.5 - (O - 5) * 0.2 : O <= 20 ? 9.5 - (O - 10) * 0.125 : O <= 50 ? 8.25 - (O - 20) * 0.088 : 5.6);
// Powerplay, middle and death overs: 1–6, 7–15 and 16–20 in a T20; 1–10, 11–40 and 41–50 in a 50-over match.
const phaseCuts = O => [O <= 20 ? Math.round(O * 0.3) : Math.round(O * 0.2), O <= 20 ? Math.round(O * 0.25) : Math.round(O * 0.2)];
const phaseOf = (i, O) => { const [pp, de] = phaseCuts(O); return i < pp ? 0 : i >= O - de ? 2 : 1; };
const PHASES = ['Powerplay', 'Middle overs', 'Death overs'];
const phaseOvers = O => { const [pp, de] = phaseCuts(O), r = (x, y) => (x > y ? 'none' : x === y ? `${x}` : `${x}–${y}`); return [r(1, pp), r(pp + 1, O - de), r(O - de + 1, O)]; };
const normal = () => { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); };
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function strengthOf(t, team) {
  t.sim = t.sim || {};
  if (t.sim[team] == null) t.sim[team] = Math.round(normal() * 50) / 100; // about −1 to +1
  return t.sim[team];
}
// A team's players, from the squads saved in the live scorer (Squads button). Without one, numbered players.
const ROLE = /\s*\((?:wk|keeper|c|capt|captain)\)\s*|†/gi;
const squads = () => { const v = store.get('squads', {}); return v && typeof v === 'object' ? v : {}; };
function squadOf(t, team) {
  const raw = squads()[String(team).toLowerCase()];
  const names = Array.isArray(raw) ? raw.map(n => String(n).replace(ROLE, ' ').trim().replace(/\s+/g, ' ')).filter(Boolean) : [];
  const max = t.impact ? 12 : 11;
  if (names.length >= 11) return names.slice(0, max);
  return Array.from({ length: max }, (_, k) => names[k] || `${team} ${k + 1}`);
}
// Split `total` into whole numbers in proportion to `w`.
function share(total, w) {
  const sum = w.reduce((a, x) => a + x, 0) || 1;
  const out = w.map(x => Math.floor(total * x / sum));
  let left = total - out.reduce((a, x) => a + x, 0);
  const order = w.map((x, k) => [total * x / sum - out[k], k]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}
// A believable scorecard for an innings with this total: who scored the runs, who took the wickets.
function simCard(t, batTeam, fieldTeam, inn) {
  const O = t.overs || 20, quota = Math.max(1, Math.ceil(O / 5)) * 6;
  const XI = squadOf(t, batTeam).slice(0, 11), F = squadOf(t, fieldTeam);
  const extras = Math.min(inn.r, Math.round(inn.r * (0.03 + Math.random() * 0.04)));
  const bowlerExtras = Math.round(extras * 0.6); // wides and no-balls count against the bowler; byes don't
  const batRuns = inn.r - extras;
  const n = Math.min(11, inn.w + 2);
  const POS = [1.3, 1.25, 1.25, 1.1, 1, 0.9, 0.7, 0.5, 0.35, 0.25, 0.2];
  const runs = share(batRuns, XI.slice(0, n).map((_, k) => POS[k] * Math.exp(normal() * 0.8) * (k === n - 1 && inn.w < 10 ? 0.5 : 1)));
  const sr = runs.map(() => Math.exp(normal() * 0.25));
  const balls = share(inn.balls, runs.map((r, k) => (r + 2) / sr[k]));
  // Who is out: the first n−1 batters except one of the two at the crease at the end.
  const notOut = inn.w >= 10 ? [n - 1] : [n - 1, n - 2];
  const outIdx = XI.slice(0, n).map((_, k) => k).filter(k => !notOut.includes(k));
  // Bowlers: the last six of the squad (with the impact player, the 12th can bowl too).
  const pool = F.slice(5).reverse().slice(0, 6);
  const overs = Math.ceil(inn.balls / 6);
  const ov = pool.map(() => 0);
  let left = overs;
  for (let k = 0; k < pool.length && left > 0; k++) { const g = Math.min(quota / 6, left, k < 5 ? quota / 6 : left); ov[k] = g; left -= g; }
  if (Math.random() < 0.4 && pool.length > 5 && ov[0] > 1) { const m = rint(1, Math.min(2, ov[0] - 1)); ov[0] -= m; ov[5] += m; }
  const bb = ov.map(x => x * 6);
  const over = bb.reduce((a, x) => a + x, 0) - inn.balls; // the last over may be unfinished
  if (over > 0) { const last = bb.map((x, k) => (x ? k : -1)).filter(k => k >= 0).pop(); bb[last] -= over; }
  const used = pool.map((name, k) => ({ name, balls: bb[k] })).filter(b => b.balls > 0);
  const bRuns = share(inn.r - (extras - bowlerExtras), used.map(b => b.balls * Math.exp(normal() * 0.3)));
  used.forEach((b, k) => { b.runs = bRuns[k]; b.wkts = 0; });
  const fielders = F.slice(0, 11);
  const raw = squads()[String(fieldTeam).toLowerCase()] || [];
  const wkRaw = raw.find(v => /\((?:wk|keeper)\)|†/i.test(v));
  const keeper = wkRaw ? wkRaw.replace(ROLE, ' ').trim().replace(/\s+/g, ' ') : fielders[0];
  const bat = XI.slice(0, n).map((name, k) => {
    const r = runs[k];
    const f6 = Math.min(Math.floor(r / 6), Math.round(r * (0.02 + Math.random() * 0.05)));
    const f4 = Math.min(Math.floor((r - 6 * f6) / 4), Math.round(r * (0.05 + Math.random() * 0.07)));
    const row = { name, runs: r, balls: Math.max(outIdx.includes(k) ? 1 : 0, balls[k]), f4, f6, how: 'not out' };
    if (outIdx.includes(k)) {
      if (Math.random() < 0.07) row.how = `run out (${pick(fielders)})`;
      else {
        const bw = used.length ? used[Math.min(used.length - 1, Math.floor(Math.random() ** 0.8 * used.length))] : null;
        const w = bw ? (used.reduce((best, b) => (Math.random() * b.balls > Math.random() * best.balls ? b : best), bw)) : null;
        if (w) {
          w.wkts++;
          const u = Math.random();
          const c = pick(fielders.filter(x => x !== w.name));
          row.how = u < 0.62 ? (c ? `c ${c} b ${w.name}` : `c & b ${w.name}`) : u < 0.8 ? `b ${w.name}` : u < 0.93 ? `lbw b ${w.name}` : u < 0.97 ? `st ${keeper} b ${w.name}` : `c & b ${w.name}`;
        } else row.how = 'out';
      }
    }
    return row;
  });
  const runOuts = Math.max(0, inn.w - used.reduce((a, b) => a + b.wkts, 0));
  return { bat, bowl: used, extras, dnb: XI.slice(n), ov: overPlan(O, inn, used, extras - bowlerExtras, runOuts) };
}
// Who bowled each over, and the runs and wickets in it, so simulated matches have powerplay and death-over figures.
function overPlan(O, inn, used, otherExtras, runOuts) {
  const overs = Math.ceil(inn.balls / 6);
  if (!overs || !used.length) return [];
  const rem = used.map(b => Math.ceil(b.balls / 6));
  const part = inn.balls % 6 ? used.findIndex(b => b.balls % 6) : -1; // the bowler of an unfinished last over
  const seq = Array(overs).fill(-1);
  let L = overs;
  if (part >= 0) { seq[overs - 1] = part; rem[part]--; L = overs - 1; }
  // Openers and the strike bowlers take the new ball and the death; the others bowl through the middle.
  const PREF = [[3, 3, 2, 0, 0, 1], [0, 0, 2, 2, 3, 3], [3, 3, 1, 2, 0, 0]];
  for (let i = 0; i < L; i++) {
    const prev = i ? seq[i - 1] : -1, next = i === L - 1 && part >= 0 ? part : -1, left = L - i;
    let best = -1, bs = -Infinity;
    rem.forEach((r, k) => {
      if (!r) return;
      const s = (k === prev || k === next ? -500 : 0) + (r >= Math.ceil(left / 2) ? 100 : 0) + (PREF[phaseOf(i, O)][k] ?? 0) + r * 0.3 + Math.random();
      if (s > bs) { bs = s; best = k; }
    });
    if (best < 0) break;
    seq[i] = best; rem[best]--;
  }
  const ov = seq.map((k, i) => ({ b: k, l: i === overs - 1 && inn.balls % 6 ? inn.balls % 6 : 6, br: 0, r: 0, w: 0 }));
  const WW = [1.1, 1, 1.6], PW = [1, 0.85, 1.35];
  const wpick = idx => { const w = idx.map(i => WW[phaseOf(i, O)]); let u = Math.random() * w.reduce((a, x) => a + x, 0); for (let j = 0; j < idx.length; j++) { u -= w[j]; if (u <= 0) return idx[j]; } return idx[idx.length - 1]; };
  used.forEach((b, k) => {
    const mine = ov.map((o, i) => (o.b === k ? i : -1)).filter(i => i >= 0);
    if (!mine.length) return;
    share(b.runs, mine.map(i => PW[phaseOf(i, O)] * ov[i].l * Math.exp(normal() * 0.5))).forEach((r, j) => { ov[mine[j]].br = r; });
    for (let w = 0; w < b.wkts; w++) ov[wpick(mine)].w++;
  });
  share(Math.max(0, otherExtras), ov.map(o => o.l)).forEach((r, i) => { ov[i].r = ov[i].br + r; });
  for (let w = 0; w < runOuts; w++) ov[wpick(ov.map((_, i) => i))].w++;
  return ov;
}
function simulateFixture(t, f) {
  if (!f.a || !f.b || isPlayed(f)) return false;
  // About one league match in 30 is washed out.
  if (!f.stage && Math.random() < 0.033) { f.nr = true; f.simNR = true; f.manual = null; f.matchId = null; f.so = null; return true; }
  const O = t.overs || 20, Q = O * 6;
  const mean = rpoFor(O) * O;
  const first = Math.random() < 0.5 ? 'a' : 'b', second = first === 'a' ? 'b' : 'a';
  const home = t.grounds?.[f.a] ? 0.15 : 0; // a small edge for the home side (the first team named)
  const str = side => strengthOf(t, f[side]) + (side === 'a' ? home : 0);
  const sA = str(first), sB = str(second);
  const pFirst = 1 / (1 + Math.exp(-(sA - sB) * 1.6));
  const u = Math.random();
  const res = u < 0.012 ? 'tie' : u < 0.012 + pFirst * 0.988 ? 'first' : 'second';
  const r1 = Math.max(Math.round(mean * 0.45), Math.round(mean * (1 + 0.04 * sA) + normal() * mean * 0.14));
  const inn1 = Math.random() < 0.25 ? { r: r1, w: 10, balls: Q - rint(0, Math.floor(Q * 0.2)), ao: true } : { r: r1, w: rint(2, 9), balls: Q, ao: false };
  let inn2;
  if (res === 'tie') inn2 = { r: r1, w: rint(5, 9), balls: Q, ao: false };
  else if (res === 'first') {
    const margin = Math.min(r1, 1 + Math.round(Math.abs(normal()) * mean * 0.13));
    inn2 = Math.random() < 0.5 ? { r: r1 - margin, w: 10, balls: Q - rint(1, Math.floor(Q * 0.3)), ao: true } : { r: r1 - margin, w: rint(3, 9), balls: Q, ao: false };
  } else inn2 = { r: r1 + rint(1, 4), w: Math.random() < 0.04 ? 0 : rint(1, 8), balls: Q - Math.floor(Math.random() ** 2 * Q * 0.2), ao: false };
  f.manual = { [first]: inn1, [second]: inn2, first, sim: true };
  f.manual.card = { [first]: simCard(t, f[first], f[second], inn1), [second]: simCard(t, f[second], f[first], inn2) };
  f.matchId = null; f.nr = false; f.simNR = false;
  // A tie goes to a super over in knockouts, or when the tournament lets the super over decide.
  f.so = res === 'tie' && (f.stage || t.tieRule === 'so') ? (Math.random() < 0.5 ? 'a' : 'b') : null;
  return true;
}
const isSim = f => !!(f.manual?.sim || f.simNR);
// The scorecard of a simulated match.
function simCardModal(t, f) {
  const m = f.manual, o = outcome(t, f, new Map());
  const order = m.first === 'b' ? ['b', 'a'] : ['a', 'b'];
  const inn = side => {
    const c = m.card[side], s = m[side];
    return `<h3 class="modal-sub" style="margin:14px 0 6px">${esc(f[side])} ${s.r}${s.w < 10 ? `/${s.w}` : ' all out'} (${fmtOvers(s.balls)} ov)</h3>
      <div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>Batter</th><th></th><th class="num">R</th><th class="num">B</th><th class="num">4s</th><th class="num">6s</th><th class="num">SR</th></tr></thead><tbody>
      ${c.bat.map(b => `<tr><td><b>${esc(b.name)}</b></td><td class="dim" style="font-size:.8rem">${esc(b.how)}</td><td class="num"><b>${b.runs}</b></td><td class="num">${b.balls}</td><td class="num">${b.f4}</td><td class="num">${b.f6}</td><td class="num dim">${b.balls ? nf(b.runs / b.balls * 100, 1) : '—'}</td></tr>`).join('')}
      <tr><td>Extras</td><td></td><td class="num">${c.extras}</td><td colspan="4"></td></tr></tbody></table></div>
      ${c.dnb.length ? `<p class="hint" style="margin:4px 0 0">Did not bat: ${esc(c.dnb.join(', '))}</p>` : ''}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bowler</th><th class="num">O</th><th class="num">R</th><th class="num">W</th><th class="num">Econ</th></tr></thead><tbody>
      ${c.bowl.map(b => `<tr><td><b>${esc(b.name)}</b></td><td class="num">${fmtOvers(b.balls)}</td><td class="num">${b.runs}</td><td class="num"><b>${b.wkts}</b></td><td class="num dim">${nf(b.runs / (b.balls / 6), 2)}</td></tr>`).join('')}</tbody></table></div>`;
  };
  const body = openModal(`${f.a} v ${f.b}`, `<p style="margin:-4px 0 0;font-weight:700">${esc(o?.text?.split(' · ')[0] || '')}${o?.so ? ` · ${esc(o.so === 'a' ? f.a : f.b)} won the super over` : ''}</p>
    <p class="hint" style="margin:4px 0 0">Simulated result${(f.venue || t.grounds?.[f.a]) ? ` at ${esc(f.venue || t.grounds[f.a])}` : ''}.${(() => { const pm = matchFigures(t, f, new Map())?.pom; return pm ? ` Player of the Match: ${esc(pm.name)}.` : ''; })()}</p>
    ${order.map(inn).join('')}
    <div class="modal-actions"><button type="button" class="btn" data-x="close">Close</button></div>`, { wide: true });
  $('[data-x="close"]', body).addEventListener('click', () => closeModal());
}
/* ---------- Player figures, phases and awards ----------
   Every played match (scored in the live scorer or simulated) is read into the same shape: each player's
   batting, bowling and fielding, and the runs and wickets in each phase of the innings. */
// One number for how much a player did in a match: runs (more for scoring quickly), wickets (more for
// bowling tightly) and catches. Picks the Player of the Match and adds up to the Player of the tournament.
function impactOf(p, O) {
  const e = rpoFor(O) / 6;
  let s = 0;
  if (p.bat) s += p.bat.r + (p.bat.r - p.bat.b * e) * 0.5 + (p.bat.r >= 50 ? 10 : 0) + (p.bat.r >= 100 ? 20 : 0);
  if (p.bowl) s += p.bowl.w * 25 + (p.bowl.balls * e - p.bowl.r) * 0.6 + (p.bowl.w >= 3 ? 8 : 0) + (p.bowl.w >= 5 ? 15 : 0);
  return s + p.fd * 8;
}
const blankPh = () => [0, 1, 2].map(() => ({ r: 0, b: 0, w: 0, n: 0 }));
function matchFigures(t, f, byId) {
  const o = f.a && f.b ? outcome(t, f, byId) : null;
  if (!o || o.error || o.nr) return null;
  let O = t.overs || 20;
  const P = new Map(), ph = {}, bph = new Map();
  const get = (name, team) => {
    const k = nameKey(name);
    if (!k) return null;
    let p = P.get(k);
    if (!p) { p = { key: k, name: String(name).trim(), team, bat: null, bowl: null, fd: 0 }; P.set(k, p); }
    return p;
  };
  const phT = team => ph[team] || (ph[team] = { bat: blankPh(), bowl: blankPh() });
  const fielding = (b, fldTeam) => {
    const d = parseDismissal(b);
    if (d.fielder && ['caught', 'stumped', 'run out'].includes(d.how)) { const q = get(d.fielder, fldTeam); if (q) q.fd++; }
  };
  // overs: [{ b: bowler index, r: runs, br: runs off the bowler, w: wickets, l: legal balls }]
  const addOvers = (bt, ft, overs, nameOf) => {
    const seen = new Set();
    overs.forEach((ov, i) => {
      if (!ov.l && !ov.r) return;
      const k = phaseOf(i, O);
      for (const x of [phT(bt).bat[k], phT(ft).bowl[k]]) { x.r += ov.r; x.b += ov.l; x.w += ov.w; if (!seen.has(k)) x.n++; }
      seen.add(k);
      const nm = nameOf(ov.b), key = nameKey(nm);
      if (!key) return;
      let q = bph.get(key);
      if (!q) { q = { key, name: nm, team: ft, ph: blankPh() }; bph.set(key, q); }
      q.ph[k].r += ov.br ?? ov.r; q.ph[k].b += ov.l;
    });
  };
  if (f.manual?.sim && f.manual.card) {
    const c = f.manual.card;
    ['a', 'b'].forEach(side => {
      const other = side === 'a' ? 'b' : 'a', cs = c[side];
      if (!cs) return;
      cs.bat.forEach(b => { const p = get(b.name, f[side]); if (p) p.bat = { r: b.runs, b: b.balls, f4: b.f4, f6: b.f6, out: b.how !== 'not out' }; fielding(b, f[other]); });
      cs.bowl.forEach(b => { const p = get(b.name, f[other]); if (p) p.bowl = { balls: b.balls, r: b.runs, w: b.wkts }; });
      if (Array.isArray(cs.ov)) addOvers(f[side], f[other], cs.ov, k => cs.bowl[k]?.name);
    });
  } else if (o.linked) {
    const d = o.linked.data;
    O = d.overs || O;
    let ai = d.teams.findIndex(x => same(x, f.a));
    if (ai === -1) { const bi = d.teams.findIndex(x => same(x, f.b)); ai = bi === -1 ? 0 : 1 - bi; }
    const tn = i => (i === ai ? f.a : f.b);
    d.inns.slice(0, 2).forEach(inn => {
      const bt = tn(inn.bat), ft = tn(1 - inn.bat);
      inn.batters.forEach(b => { const p = get(b.name, bt); if (p) p.bat = { r: b.runs, b: b.balls, f4: b.f4, f6: b.f6, out: !!b.out }; if (b.out) fielding(b, ft); });
      inn.bowlers.forEach(w => { if (!w.balls && !w.runs) return; const p = get(w.name, ft); if (p) p.bowl = { balls: w.balls, r: w.runs, w: w.wkts }; });
      if (Array.isArray(inn.overs)) addOvers(bt, ft, inn.overs.map(v => ({ b: v.bowler, r: v.runs, br: v.bowlerRuns, w: v.wkts, l: v.legal })), k => inn.bowlers[k]?.name);
    });
    (d.squads || []).forEach((sq, i) => (sq || []).forEach(n => get(String(n).replace(ROLE, ' ').trim(), tn(i))));
  } else return { o, O, players: [], ph, bph: [], pom: null, won: null }; // a typed-in score has no player figures
  const players = [...P.values()];
  players.forEach(p => { p.imp = impactOf(p, O); });
  const res = decided(t, o);
  const won = res === 'a' || res === 'b' ? f[res] : null;
  const pool = players.filter(p => p.bat || p.bowl || p.fd);
  let pom = f.pom ? pool.find(p => same(p.name, f.pom)) : null;
  if (!pom) pom = [...pool].sort((x, y) => (won ? (y.team === won) - (x.team === won) : 0) || y.imp - x.imp)[0] || null;
  return { o, O, players, ph, bph: [...bph.values()], pom, won, chosen: !!(f.pom && pom && same(pom.name, f.pom)) };
}
const fxLabel = (t, f) => (f.stage ? STAGE[f.stage] : `Match ${t.fixtures.filter(x => !x.stage).indexOf(f) + 1}`);
// The whole tournament: each player's totals and match list, the best single performances, and phase totals.
function tourStats(t, byId) {
  const players = new Map(), teamPh = {}, bowlPh = new Map(), inns = [], spells = [], byFx = new Map();
  t.fixtures.forEach(f => {
    const m = matchFigures(t, f, byId);
    if (!m) return;
    byFx.set(f.id, m);
    m.players.forEach(p => {
      let x = players.get(p.key);
      if (!x) { x = { key: p.key, name: p.name, teams: new Set(), m: 0, inns: 0, no: 0, runs: 0, balls: 0, f4: 0, f6: 0, hs: -1, hsNo: false, n50: 0, n100: 0, bb: 0, br: 0, bw: 0, best: null, fd: 0, pom: 0, mvp: 0, games: [] }; players.set(p.key, x); }
      x.teams.add(p.team); x.m++; x.fd += p.fd; x.mvp += p.imp;
      const isPom = m.pom && m.pom.key === p.key;
      if (isPom) x.pom++;
      const opp = p.team === f.a ? f.b : f.a;
      x.games.push({ f, opp, bat: p.bat, bowl: p.bowl, fd: p.fd, pom: isPom, won: m.won ? m.won === p.team : null, imp: p.imp });
      if (p.bat) {
        const b = p.bat;
        x.inns++; if (!b.out) x.no++;
        x.runs += b.r; x.balls += b.b; x.f4 += b.f4 || 0; x.f6 += b.f6 || 0;
        if (b.r >= 100) x.n100++; else if (b.r >= 50) x.n50++;
        if (b.r > x.hs || (b.r === x.hs && !b.out)) { x.hs = b.r; x.hsNo = !b.out; }
        inns.push({ key: p.key, name: p.name, team: p.team, opp, r: b.r, b: b.b, out: b.out, f });
      }
      if (p.bowl && p.bowl.balls) {
        const w = p.bowl;
        x.bb += w.balls; x.br += w.r; x.bw += w.w;
        if (!x.best || w.w > x.best.w || (w.w === x.best.w && w.r < x.best.r)) x.best = { w: w.w, r: w.r };
        spells.push({ key: p.key, name: p.name, team: p.team, opp, w: w.w, r: w.r, balls: w.balls, f });
      }
    });
    Object.entries(m.ph).forEach(([team, v]) => {
      const T = teamPh[team] || (teamPh[team] = { bat: blankPh(), bowl: blankPh() });
      ['bat', 'bowl'].forEach(side => v[side].forEach((q, k) => { ['r', 'b', 'w', 'n'].forEach(z => { T[side][k][z] += q[z]; }); }));
    });
    m.bph.forEach(q => {
      let x = bowlPh.get(q.key);
      if (!x) { x = { key: q.key, name: q.name, teams: new Set(), ph: blankPh() }; bowlPh.set(q.key, x); }
      x.teams.add(q.team);
      q.ph.forEach((v, k) => { x.ph[k].r += v.r; x.ph[k].b += v.b; });
    });
  });
  return { players: [...players.values()], teamPh, bowlPh: [...bowlPh.values()], inns, spells, byFx };
}
let curStats = null; // from the last render, so each fixture row can show its Player of the Match
const rr = (r, b) => (b ? nf(r / (b / 6), 2) : '—');
const plLink = (name, key) => `<button type="button" class="tr-link" data-tr="player" data-key="${esc(key || nameKey(name))}">${esc(name)}</button>`;
const tmLink = name => `<button type="button" class="tr-link" data-tr="team" data-team="${esc(name)}">${esc(name)}</button>`;
const figs = w => `${w.w}/${w.r}`;
const batTxt = b => `${b.r}${b.out ? '' : '*'} (${b.b})`;
// A tap on a player's name: their tournament, match by match.
function playerModal(t, key) {
  const S = tourStats(t, new Map(finishedMatches().map(m => [m.id, m])));
  const x = S.players.find(p => p.key === key);
  if (!x) { toast('No figures for that player yet'); return; }
  const outs = x.inns - x.no;
  const stat = (l, v) => `<div class="tp-stat"><span>${esc(l)}</span><b>${v}</b></div>`;
  const body = openModal(x.name, `
    <p class="hint" style="margin:-6px 0 12px">${[...x.teams].map(esc).join(', ')} · ${plural(x.m, 'match', 'matches')}${x.pom ? ` · ${plural(x.pom, 'Player of the Match award')}` : ''} · ${nf(x.mvp, 0)} tournament points</p>
    ${x.inns ? `<p class="modal-sub">Batting</p><div class="tp-grid">${stat('Runs', x.runs)}${stat('Innings', x.inns)}${stat('Not out', x.no)}${stat('Highest', `${x.hs}${x.hsNo ? '*' : ''}`)}${stat('Average', outs ? nf(x.runs / outs, 2) : '—')}${stat('Strike rate', x.balls ? nf(x.runs / x.balls * 100, 1) : '—')}${stat('50s / 100s', `${x.n50} / ${x.n100}`)}${stat('4s / 6s', `${x.f4} / ${x.f6}`)}</div>` : ''}
    ${x.bb ? `<p class="modal-sub" style="margin-top:14px">Bowling</p><div class="tp-grid">${stat('Wickets', x.bw)}${stat('Overs', fmtOvers(x.bb))}${stat('Runs', x.br)}${stat('Best', x.best ? figs(x.best) : '—')}${stat('Average', x.bw ? nf(x.br / x.bw, 2) : '—')}${stat('Economy', rr(x.br, x.bb))}${stat('Strike rate', x.bw ? nf(x.bb / x.bw, 1) : '—')}</div>` : ''}
    ${x.fd ? `<p class="hint">Fielding: ${plural(x.fd, 'dismissal')} (catches, stumpings and run outs).</p>` : ''}
    <p class="modal-sub" style="margin-top:14px">Match by match</p>
    <div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>Match</th><th>Against</th><th class="num">Batting</th><th class="num">Bowling</th><th></th></tr></thead><tbody>
    ${x.games.map(g => `<tr><td class="dim">${esc(fxLabel(t, g.f))}</td><td>${esc(g.opp)}${g.won == null ? '' : g.won ? ' <span class="chip r2" style="font-size:.62rem">Won</span>' : ' <span class="chip r0" style="font-size:.62rem">Lost</span>'}</td><td class="num">${g.bat ? batTxt(g.bat) : '<span class="dim">—</span>'}</td><td class="num">${g.bowl && g.bowl.balls ? `${figs(g.bowl)} <span class="dim">(${fmtOvers(g.bowl.balls)})</span>` : '<span class="dim">—</span>'}</td><td>${g.pom ? '<span class="chip r3" style="font-size:.62rem">Player of the Match</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="modal-actions"><button type="button" class="btn" data-x="close">Close</button></div>`, { wide: true });
  $('[data-x="close"]', body).addEventListener('click', () => closeModal());
}
// A tap on a team's name: results, form, head-to-head, top players and phase figures.
function teamModal(t, team) {
  const byId = new Map(finishedMatches().map(m => [m.id, m]));
  const S = tourStats(t, byId), rows = table(t), pos = rows.findIndex(r => r.team === team), r = rows[pos];
  if (!r) return;
  const mine = t.fixtures.filter(f => f.a === team || f.b === team);
  const res = f => {
    const o = f.a && f.b ? outcome(t, f, byId) : null;
    if (!o || o.error) return null;
    const d = decided(t, o), me = f.a === team ? 'a' : 'b';
    return d === 'nr' ? 'NR' : d === 'tie' ? 'T' : d === me ? 'W' : 'L';
  };
  const chip = v => `<span class="chip ${v === 'W' ? 'r2' : v === 'L' ? 'r0' : 'r1'}" style="font-size:.65rem">${v}</span>`;
  const played = mine.map(f => ({ f, v: res(f) })).filter(x => x.v);
  const next = mine.filter(f => !res(f) && f.a && f.b).slice(0, 3);
  const h2h = new Map();
  played.forEach(({ f, v }) => {
    const opp = f.a === team ? f.b : f.a;
    const h = h2h.get(opp) || { p: 0, W: 0, L: 0, T: 0, NR: 0 };
    h.p++; h[v]++; h2h.set(opp, h);
  });
  const mineP = S.players.filter(p => p.teams.has(team));
  const topR = mineP.filter(p => p.inns).sort((a, b) => b.runs - a.runs).slice(0, 3);
  const topW = mineP.filter(p => p.bb).sort((a, b) => b.bw - a.bw || a.br - b.br).slice(0, 3);
  const ph = S.teamPh[team];
  const O = t.overs || 20;
  const raw = squads()[team.toLowerCase()];
  const body = openModal(team, `
    <p class="hint" style="margin:-6px 0 10px">${ordN(pos + 1)} · ${r.pts} pts · won ${r.w}, lost ${r.l}${r.tie ? `, tied ${r.tie}` : ''}${r.nr ? `, ${r.nr} no result` : ''} · NRR ${signed(r.nrr)}${t.grounds?.[team] ? ` · home: ${esc(t.grounds[team])}` : ''}</p>
    <p class="modal-sub">Form${played.length > 5 ? ' (last 5)' : ''}</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${played.length ? played.slice(-5).map(x => chip(x.v)).join('') : '<span class="hint" style="margin:0">No results yet.</span>'}</div>
    ${played.length ? `<p class="modal-sub" style="margin-top:14px">Results</p><div class="tbl-wrap" style="margin-top:0"><table class="tbl"><tbody>${played.map(({ f, v }) => `<tr><td class="dim">${esc(fxLabel(t, f))}</td><td>${chip(v)} v ${esc(f.a === team ? f.b : f.a)}</td><td class="dim" style="font-size:.8rem">${esc(outcome(t, f, byId)?.text || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${next.length ? `<p class="hint">Next: ${next.map(f => `${esc(fxLabel(t, f))} v ${esc(f.a === team ? f.b : f.a)}${f.date ? ` (${esc(dateTxt(f.date))})` : ''}`).join(' · ')}</p>` : ''}
    ${h2h.size ? `<p class="modal-sub" style="margin-top:14px">Head-to-head</p><div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>Against</th><th class="num">P</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">NR</th></tr></thead><tbody>${[...h2h].map(([opp, h]) => `<tr><td>${esc(opp)}</td><td class="num">${h.p}</td><td class="num">${h.W}</td><td class="num">${h.L}</td><td class="num">${h.T}</td><td class="num">${h.NR}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${topR.length || topW.length ? `<div class="grid-2" style="margin-top:14px">
      <div><p class="modal-sub">Top run-scorers</p>${topR.map(p => `<div class="tp-line">${plLink(p.name, p.key)}<b>${p.runs}</b></div>`).join('') || '<p class="hint">—</p>'}</div>
      <div><p class="modal-sub">Top wicket-takers</p>${topW.map(p => `<div class="tp-line">${plLink(p.name, p.key)}<b>${p.bw}</b></div>`).join('') || '<p class="hint">—</p>'}</div></div>` : ''}
    ${ph ? `<p class="modal-sub" style="margin-top:14px">By phase</p><div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th></th>${PHASES.map((n, k) => `<th class="num">${n}<div class="dim" style="font-weight:400;font-size:.72rem">overs ${phaseOvers(O)[k]}</div></th>`).join('')}</tr></thead><tbody>
      <tr><td>Batting: run rate</td>${ph.bat.map(q => `<td class="num">${rr(q.r, q.b)}</td>`).join('')}</tr>
      <tr><td>Wickets lost per innings</td>${ph.bat.map(q => `<td class="num">${q.n ? nf(q.w / q.n, 1) : '—'}</td>`).join('')}</tr>
      <tr><td>Bowling: run rate conceded</td>${ph.bowl.map(q => `<td class="num">${rr(q.r, q.b)}</td>`).join('')}</tr>
      <tr><td>Wickets taken per innings</td>${ph.bowl.map(q => `<td class="num">${q.n ? nf(q.w / q.n, 1) : '—'}</td>`).join('')}</tr></tbody></table></div>` : ''}
    <p class="modal-sub" style="margin-top:14px">Squad</p>
    <p class="hint" style="margin:0">${Array.isArray(raw) && raw.length ? raw.map(esc).join(', ') : 'No squad saved yet. Add one with “Squads”.'}</p>
    <div class="modal-actions"><button type="button" class="btn" data-x="close">Close</button></div>`, { wide: true });
  body.addEventListener('click', e => {
    const p = e.target.closest('[data-tr="player"]');
    if (p) { playerModal(t, p.dataset.key); return; }
    if (e.target.closest('[data-x="close"]')) closeModal();
  });
}
// Choose the Player of the Match, or go back to the automatic pick.
function pomForm(t, f) {
  const m = matchFigures(t, f, new Map(finishedMatches().map(x => [x.id, x])));
  const pool = (m?.players || []).filter(p => p.bat || p.bowl || p.fd).sort((a, b) => b.imp - a.imp);
  if (!pool.length) { toast('Player of the Match needs a scorecard: score the match live or simulate it.'); return; }
  const auto = [...pool].sort((x, y) => (m.won ? (y.team === m.won) - (x.team === m.won) : 0) || y.imp - x.imp)[0];
  const line = p => [p.bat && `${batTxt(p.bat)}`, p.bowl && p.bowl.balls && `${figs(p.bowl)}`].filter(Boolean).join(', ');
  const body = openModal(`Player of the Match: ${f.a} v ${f.b}`, `
    <div class="field"><div class="lab"><label for="pom-s">Player</label></div><select id="pom-s"><option value="">Automatic: ${esc(auto.name)}</option>${pool.map(p => `<option value="${esc(p.name)}"${f.pom && same(f.pom, p.name) ? ' selected' : ''}>${esc(p.name)} (${esc(p.team)}) ${esc(line(p))}</option>`).join('')}</select></div>
    <p class="hint">The automatic pick is the player with the biggest impact on the winning side: runs, with extra for scoring quickly, wickets, with extra for bowling tightly, and catches.</p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save</button></div>`);
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'ok') { const v = $('#pom-s', body).value; if (v) f.pom = v; else delete f.pom; update(t); RENDER.tournament(); toast(`Player of the Match: ${v || auto.name}`); }
    closeModal();
  });
}
// Orders the matches still to play so each team gets the longest possible gap between games.
function spreadSchedule(t) {
  if (t.fixtures.some(f => f.date)) return; // a dated schedule keeps its order
  const league = t.fixtures.filter(f => !f.stage), ko = t.fixtures.filter(f => f.stage);
  const done = league.filter(f => isPlayed(f) || busy(t, f)), todo = league.filter(f => !isPlayed(f) && !busy(t, f));
  const last = new Map();
  done.forEach((f, k) => { last.set(f.a, k); last.set(f.b, k); });
  const out = [...done];
  const gap = (f, k) => Math.min(k - (last.get(f.a) ?? -99), k - (last.get(f.b) ?? -99));
  while (todo.length) {
    const k = out.length;
    let best = -1, bestG = -Infinity;
    todo.forEach((f, j) => { const g = gap(f, k) + Math.random() * 0.5; if (g > bestG) { bestG = g; best = j; } });
    const f = todo.splice(best, 1)[0];
    out.push(f); last.set(f.a, k); last.set(f.b, k);
  }
  t.fixtures = [...out, ...ko];
}
// Edit each team's players. Squads are shared with the live scorer, so scoring a fixture picks them up too.
function squadsForm(t) {
  const max = t.impact ? 12 : 11, sq = squads();
  const body = openModal('Squads', `
    <p class="hint" style="margin:-6px 0 12px">One name per line, in batting order${t.impact ? ', the 11 who start. You name the impact player later, when you make the swap in the live scorer' : ', 11 per team'}. Add (c) after the captain and (wk) after the keeper. Simulated matches use these names for their scorecards; teams without a squad get numbered players. The live scorer uses the same squads.</p>
    <div class="grid-2">${t.teams.map((n, k) => `<div class="field"><div class="lab"><label for="sq-${k}">${esc(n)}</label></div><textarea id="sq-${k}" rows="${max}" spellcheck="false">${esc((sq[n.toLowerCase()] || []).join('\n'))}</textarea></div>`).join('')}</div>
    <p class="err-text" id="sq-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save squads</button></div>`, { wide: true });
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const all = squads();
    for (const [k, n] of t.teams.entries()) {
      const names = $(`#sq-${k}`, body).value.split('\n').map(v => v.trim().replace(/\s+/g, ' ')).filter(Boolean);
      if (names.length > max) { $('#sq-err', body).textContent = `${n}: at most ${max} players.`; return; }
      if (names.length === 1) { $('#sq-err', body).textContent = `${n}: add at least two players, or leave it empty.`; return; }
      const plain = names.map(v => v.replace(ROLE, ' ').trim().toLowerCase());
      const dup = plain.find((v, j) => plain.indexOf(v) !== j);
      if (dup) { $('#sq-err', body).textContent = `${n}: “${dup}” is listed twice.`; return; }
      if (names.length) all[n.toLowerCase()] = names; else delete all[n.toLowerCase()];
    }
    store.set('squads', all);
    closeModal(); RENDER.tournament(); toast('Squads saved');
  });
}
if (!document.getElementById('tr-css')) {
  const st = document.createElement('style');
  st.id = 'tr-css';
  st.textContent = `.tr-link{all:unset;cursor:pointer;color:inherit;font-weight:inherit;border-bottom:1px dotted color-mix(in srgb,currentColor 45%,transparent)}.tr-link:hover{color:var(--accent-text)}.tr-link:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
.fx-pom{font-size:.8rem;color:var(--fg-2);margin-top:2px}.tp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}.tp-stat{border:1px solid var(--line);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}.tp-stat span{font-size:.72rem;color:var(--fg-2)}.tp-stat b{font-size:1.05rem}
.tp-line{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 0;border-top:1px solid var(--line)}.tp-line:first-of-type{border-top:0}`;
  document.head.appendChild(st);
}
const busy = (t, f) => live && live.tournament && live.tournament.tid === t.id && live.tournament.fid === f.id && live.status !== 'done';

/* ---------- Odds, net run rate targets, rescheduling ---------- */
// Plays the rest of the league out many times. Each match goes to the side with the better record so far
// (wins, then net run rate) more often than not; level teams are split by net run rate with some luck.
function qualOdds(t, rows, N, byId, runs = 3000) {
  const n = rows.length, idx = new Map(rows.map((r, k) => [r.team, k]));
  const rem = t.fixtures.filter(f => !f.stage && idx.has(f.a) && idx.has(f.b) && f.a !== f.b && !outcome(t, f, byId));
  if (!rem.length || !N || N >= n) return null;
  const pts = t.pts || { w: 2, t: 1, nr: 1, l: 0 };
  const rating = rows.map(r => Math.log((r.w + 0.5 * r.tie + 1) / (r.l + 0.5 * r.tie + 1)) + (r.nrr ?? 0) * 0.3);
  const ends = rem.map(f => { const A = idx.get(f.a), B = idx.get(f.b); return [A, B, 1 / (1 + Math.exp(-(rating[A] - rating[B]) * 0.8))]; });
  const inN = Array(n).fill(0), in2 = Array(n).fill(0), P = Array(n), key = Array(n), order = rows.map((_, k) => k);
  for (let run = 0; run < runs; run++) {
    for (let k = 0; k < n; k++) P[k] = rows[k].pts;
    for (const [A, B, p] of ends) {
      if (Math.random() < 0.02) { P[A] += pts.nr; P[B] += pts.nr; continue; }
      const w = Math.random() < p ? A : B;
      P[w] += pts.w; P[w === A ? B : A] += pts.l || 0;
    }
    for (let k = 0; k < n; k++) key[k] = P[k] * 1000 + (rows[k].nrr ?? 0) + normal() * 0.35;
    order.sort((x, y) => key[y] - key[x]);
    for (let j = 0; j < N; j++) inN[order[j]]++;
    if (N > 2) { in2[order[0]]++; in2[order[1]]++; }
  }
  return { top: inN.map(v => v / runs), top2: N > 2 ? in2.map(v => v / runs) : null };
}
const pct = (v, sure, never) => (sure ? '100%' : never ? '0%' : v >= 0.995 ? '>99%' : v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`);

// What a team needs in its next match to finish above another on net run rate.
function nrrCalcForm(t) {
  const byId = new Map(finishedMatches().map(m => [m.id, m]));
  const rows = table(t);
  if (rows.length < 2) { toast('Add at least two teams first'); return; }
  const N = qualifyN(t) || 2;
  const O = t.overs || 20, Q = O * 6;
  const def = rows[Math.min(N, rows.length - 1)].team, above = rows[Math.max(0, Math.min(N, rows.length - 1) - 1)].team;
  const nextOpp = team => { const f = t.fixtures.find(x => !x.stage && (x.a === team || x.b === team) && !outcome(t, x, byId) && x.a && x.b); return f ? (f.a === team ? f.b : f.a) : null; };
  const opt = (sel, skip) => rows.filter(r => r.team !== skip).map(r => `<option${r.team === sel ? ' selected' : ''}>${esc(r.team)}</option>`).join('');
  const body = openModal('Net run rate calculator', `
    <div class="fields">
      <div class="field"><div class="lab"><label for="nc-x">Team</label></div><select id="nc-x">${opt(def)}</select></div>
      <div class="field"><div class="lab"><label for="nc-y">Wants to finish above</label></div><select id="nc-y">${opt(above)}</select></div>
      <div class="field"><div class="lab"><label for="nc-o">Next match against</label></div><select id="nc-o"></select></div>
      <div class="field"><div class="lab"><label for="nc-s">First-innings score</label></div><input id="nc-s" type="text" inputmode="numeric" autocomplete="off" value="${Math.round(rpoFor(O) * O)}"></div>
    </div>
    <div id="nc-out" style="margin-top:14px"></div>
    <p class="hint">Assumes ${O} overs a side and that the other team's net run rate stays as it is, unless the two of them are playing each other, when both change. A chase is taken as reaching the target exactly.</p>
    <div class="modal-actions"><button type="button" class="btn" data-x="close">Close</button></div>`, { wide: true });
  const fillOpp = () => { const X = $('#nc-x', body).value, cur = $('#nc-o', body).value, nx = nextOpp(X); $('#nc-o', body).innerHTML = opt(cur && cur !== X ? cur : nx || rows.find(r => r.team !== X).team, X); };
  const calc = () => {
    const X = rows.find(r => r.team === $('#nc-x', body).value), Y = rows.find(r => r.team === $('#nc-y', body).value), opp = $('#nc-o', body).value;
    const out = $('#nc-out', body), S = Number($('#nc-s', body).value);
    if (X === Y) { out.innerHTML = '<p class="err-text">Pick two different teams.</p>'; return; }
    if (!Number.isInteger(S) || S < 1 || S > 999) { out.innerHTML = '<p class="err-text">Enter a first-innings score, like 180.</p>'; return; }
    const vs = Y.team === opp;
    const nrr = (r, rf, bf, ra, bb) => nrrOf({ RF: r.rf + rf, OF: r.bf + bf, RA: r.ra + ra, OB: r.bb + bb });
    // Batting first: the most the opposition can make.
    let R = null;
    for (let x = S - 1; x >= 0; x--) { const a = nrr(X, S, Q, x, Q), b = vs ? nrr(Y, x, Q, S, Q) : (Y.nrr ?? 0); if (a > b) { R = x; break; } }
    // Chasing S + 1: the most balls it can take.
    let B = null;
    for (let bb = Q; bb >= 1; bb--) { const a = nrr(X, S + 1, bb, S, Q), b = vs ? nrr(Y, S, Q, S + 1, bb) : (Y.nrr ?? 0); if (a > b) { B = bb; break; } }
    const W = (t.pts || {}).w ?? 2;
    const xw = X.pts + W, yLo = Y.pts, yHi = Y.pts + (vs ? 0 : W);
    const ptsNote = xw < yLo ? `Even with a win ${X.team} (${xw} pts) stays below ${Y.team} (${Y.pts} pts) on points, so this is net run rate only.`
        : xw > yHi ? `A win takes ${X.team} above ${Y.team} on points${vs ? '' : ' whatever they do'}, so net run rate won't decide it.`
            : `A win puts ${X.team} on ${xw} pts, ${vs || xw === yLo ? `level with ${Y.team}${vs ? '' : ` if they don't pick up points`}` : `level with ${Y.team} if they also win`}, and then net run rate decides it.`;
    out.innerHTML = `<p style="margin:0 0 6px">Now: ${esc(X.team)} ${signed(X.nrr)}, ${esc(Y.team)} ${signed(Y.nrr)}.</p>
      <div class="tp-line"><span>Batting first and making ${S}</span><b>${R == null ? 'Not possible' : `Win by ${S - R}+ runs (keep ${esc(opp)} to ${R} or fewer)`}</b></div>
      <div class="tp-line"><span>Chasing ${S + 1}</span><b>${B == null ? 'Not possible' : `Win in ${fmtOvers(B)} overs or fewer`}</b></div>
      <p class="hint">${esc(ptsNote)}</p>`;
  };
  fillOpp(); calc();
  body.addEventListener('change', e => { if (e.target.id === 'nc-x') fillOpp(); calc(); });
  body.addEventListener('input', calc);
  $('[data-x="close"]', body).addEventListener('click', () => closeModal());
}

// Move a match: new date or ground, a different place in the order, home and away swapped, or postponed.
function fxEditForm(t, f) {
  const league = t.fixtures.filter(x => !x.stage), ko = t.fixtures.filter(x => x.stage);
  const pos = league.indexOf(f) + 1, played = isPlayed(f), lockTeams = played || busy(t, f) || !!f.stage;
  const body = openModal(`Edit fixture: ${f.a || 'TBC'} v ${f.b || 'TBC'}`, `
    <div class="fields">
      <div class="field"><div class="lab"><label for="fe-d">Date</label></div><input id="fe-d" type="date" value="${esc(f.date || '')}"></div>
      <div class="field"><div class="lab"><label for="fe-g">Ground</label></div><input id="fe-g" type="text" maxlength="80" autocomplete="off" value="${esc(f.venue || '')}" placeholder="${esc(t.grounds?.[f.a] || 'Home ground')}"></div>
      ${f.stage ? '' : `<div class="field"><div class="lab"><label for="fe-p">Match number</label></div><input id="fe-p" type="text" inputmode="numeric" autocomplete="off" value="${pos}"></div>`}
    </div>
    ${lockTeams ? '' : `<label class="check" style="margin-top:10px"><input type="checkbox" id="fe-sw"> Swap home and away (${esc(f.b)} at home)</label>`}
    <p class="hint">Leave the ground empty to use the home team's ground. When every league match has a date, changing a date puts the match back in date order; a new match number moves it there instead.</p>
    <p class="err-text" id="fe-err"></p>
    <div class="modal-actions">${f.stage || played ? '' : '<button type="button" class="btn ghost" data-x="post">Postpone to the end</button>'}<button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save</button></div>`);
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const rest = league.filter(y => y !== f);
    if (x.dataset.x === 'post') {
      delete f.date; f.postponed = true;
      t.fixtures = [...rest, f, ...ko];
      update(t); closeModal(); RENDER.tournament(); toast(`Postponed: now match ${rest.length + 1}. Give it a new date with Edit.`);
      return;
    }
    const err = $('#fe-err', body), d = $('#fe-d', body).value.trim(), g = $('#fe-g', body).value.trim().replace(/\s+/g, ' ');
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) { err.textContent = 'Pick a date, or leave it empty.'; return; }
    let np = pos;
    if (!f.stage) {
      np = Number($('#fe-p', body).value.trim());
      if (!Number.isInteger(np) || np < 1 || np > league.length) { err.textContent = `Match number must be from 1 to ${league.length}.`; return; }
    }
    const dateChanged = (f.date || '') !== d;
    if (d) f.date = d; else delete f.date;
    if (g) f.venue = g; else delete f.venue;
    if (dateChanged && d) delete f.postponed;
    if ($('#fe-sw', body)?.checked) [f.a, f.b] = [f.b, f.a];
    if (!f.stage) {
      let L = rest.slice();
      if (np !== pos) L.splice(np - 1, 0, f);
      else {
        L.splice(pos - 1, 0, f);
        if (dateChanged && L.every(y => y.date)) L = L.map((y, k) => [y, k]).sort((p, q) => p[0].date.localeCompare(q[0].date) || p[1] - q[1]).map(p => p[0]);
      }
      t.fixtures = [...L, ...ko];
    }
    update(t); closeModal(); RENDER.tournament(); toast('Fixture updated');
  });
}

// After a knockout result changes, later knockout matches that were played with the old teams start again.
function reflowKO(t) {
  const byId = new Map(finishedMatches().map(m => [m.id, m]));
  let reset = 0;
  KO_ORDER.forEach(s => {
    const f = t.fixtures.find(x => x.stage === s && Array.isArray(x.from));
    if (!f || !isPlayed(f)) return;
    const [a, b] = f.from.map(r => fromRef(t, r, byId));
    if (f.a === a && f.b === b) return;
    f.nr = false; f.simNR = false; f.manual = null; f.matchId = null; f.so = null; delete f.pom;
    reset++;
  });
  syncFinal(t, byId);
  return reset;
}
const resetMsg = n => (n ? ` ${plural(n, 'later knockout match was', 'later knockout matches were')} reset, because the teams changed.` : '');

/* ---------- Render ---------- */
const dateTxt = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${Number(m[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]}` : ''; };
function fxRow(t, f, label, byId, caption = '') {
  const known = !!(f.a && f.b);
  const o = known ? outcome(t, f, byId) : null;
  const pending = live && live.tournament && live.tournament.tid === t.id && live.tournament.fid === f.id && live.status !== 'done';
  let status, actions = '';
  if (!known) status = '<span class="dim">Waiting for earlier knockout results</span>';
  else if (o && !o.error) {
    const tie = !o.nr && !o.winner;
    const soTxt = o.so ? ` · ${esc(o.so === 'a' ? f.a : f.b)} won the super over` : '';
    const kw = f.stage && f.stage !== 'F' ? koWinner(t, f, byId) : null;
    const through = kw && kw.how && kw.team && !o.so ? ` · ${esc(kw.team)} ${esc(kw.how)}` : '';
    status = `<span class="${o.nr ? 'dim' : ''}">${esc(o.text || '')}${f.simNR ? ' (washed out)' : ''}${soTxt}${through}</span>${isSim(f) ? ' <span class="chip r1" style="font-size:.65rem">Simulated</span>' : ''}`;
    const pm = curStats?.byFx.get(f.id)?.pom;
    if (pm) status += `<div class="fx-pom">Player of the Match: ${plLink(pm.name, pm.key)}</div>`;
    actions = `${f.manual?.card ? `<button type="button" class="btn ghost sm" data-tr="simcard" data-f="${f.id}">Scorecard</button>` : ''}${pm ? `<button type="button" class="btn ghost sm" data-tr="pom" data-f="${f.id}">Change Player of the Match</button>` : ''}${f.manual && !f.manual.sim ? `<button type="button" class="btn ghost sm" data-tr="manual" data-f="${f.id}">Edit result</button>` : ''}${isSim(f) ? `<button type="button" class="btn ghost sm" data-tr="resim" data-f="${f.id}">Simulate again</button><button type="button" class="btn ghost sm" data-tr="manual" data-f="${f.id}">Edit result</button>` : ''}${tie ? `<button type="button" class="btn ghost sm" data-tr="so" data-f="${f.id}">${o.so ? 'Change super over' : 'Super over winner'}</button>` : ''}${o.linked ? `<button type="button" class="btn ghost sm" data-tr="card" data-f="${f.id}">Scorecard</button>` : ''}<button type="button" class="btn ghost sm" data-tr="clear" data-f="${f.id}">Clear result</button>`;
  } else {
    status = pending ? '<span class="badge live" style="font-size:.65rem">Being scored</span>' : o?.error ? `<span class="neg">${esc(o.error)}</span>` : '<span class="dim">Not played yet</span>';
    actions = `<button type="button" class="btn sm" data-tr="score" data-f="${f.id}">${pending ? 'Open scorer' : 'Score live'}</button>
      <button type="button" class="btn ghost sm" data-tr="manual" data-f="${f.id}">Enter result</button>
      <button type="button" class="btn ghost sm" data-tr="link" data-f="${f.id}">Link a saved match</button>
      <button type="button" class="btn ghost sm" data-tr="nr" data-f="${f.id}">No result</button>
      ${pending ? '' : `<button type="button" class="btn ghost sm" data-tr="sim" data-f="${f.id}">Simulate</button>`}`;
  }
  if (known || !f.stage) actions += `<button type="button" class="btn ghost sm" data-tr="fxedit" data-f="${f.id}">${isPlayed(f) ? 'Date and ground' : 'Reschedule'}</button>`;
  const del = f.stage ? '' : `<button type="button" class="row-del" data-tr="remove" data-f="${f.id}" aria-label="Remove fixture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  return `<div class="fx-row"><div class="fx-main"><span class="fx-no${label.length > 2 ? ' wide' : ''}">${esc(label)}</span><div>${(() => { const c = [caption, f.postponed && !isPlayed(f) ? 'Postponed' : '', dateTxt(f.date), (f.venue || t.grounds?.[f.a]) && `at ${f.venue || t.grounds[f.a]}`].filter(Boolean).join(' · '); return c ? `<div class="fx-cap">${esc(c)}</div>` : ''; })()}<div class="fx-teams">${esc(f.a || 'TBC')} <span class="dim">v</span> ${esc(f.b || 'TBC')}</div><div class="fx-status">${status}</div></div></div>
    <div class="fx-acts">${actions}${del}</div></div>`;
}

function qualCard(t, N) {
  const league = t.fixtures.filter(f => !f.stage);
  if (!N || N >= t.teams.length || !league.length) return '';
  const q = qualification(t, finishedMatches(), N);
  const trows = table(t), od = qualOdds(t, trows, N, new Map(finishedMatches().map(m => [m.id, m])));
  const oi = new Map(trows.map((r, k) => [r.team, k]));
  const tb = TIEBREAKS[t.tiebreak] ? t.tiebreak : 'nrr';
  const tbName = { nrr: 'net run rate', wins: 'the number of wins', h2h: 'head-to-head' }[tb];
  const rows = q.rows.map(r => {
    let chip, text;
    if (r.inAll) { chip = '<span class="chip r2">Through</span>'; text = q.remaining ? `In the top ${N} whatever happens.` : `Finished in the top ${N}.`; }
    else if (r.outAll) { chip = '<span class="chip r0">Out</span>'; text = q.remaining ? `Can't reach the top ${N}.` : `Finished outside the top ${N}.`; }
    else if (!q.remaining) { chip = '<span class="chip r1">Tie-break</span>'; text = `Level on points at the cut-off, so ${tbName} decides.`; }
    else {
      chip = '<span class="chip r3">Alive</span>';
      const sure = r.sure.findIndex(v => v), can = r.can.findIndex(v => v);
      const parts = [];
      const all = n => (n === r.left ? (r.left === 1 ? 'their last match' : `all ${r.left} remaining`) : `${n} of their ${r.left} remaining`);
      if (r.left === 0) parts.push('No matches left: it depends on other results.');
      else if (sure !== -1) {
        parts.push(`Win ${all(sure)} and they're through.`);
        if (can !== -1 && can < sure) parts.push(`${can === 0 ? 'Without another win' : `With ${plural(can, 'win')}`} it can still happen, depending on other results.`);
      } else if (can !== -1) parts.push(`${can === 0 ? 'Need' : `Must win ${all(can)}, and need`} other results to go their way.`);
      if (!r.anyIn) parts.push(`At best they finish level on points, so ${tbName} would decide.`);
      text = parts.join(' ');
    }
    const k = oi.get(r.team);
    const odds = od ? `<td class="num"><b>${pct(od.top[k], r.inAll, r.outAll)}</b></td>${od.top2 ? `<td class="num dim">${pct(od.top2[k], false, r.outAll)}</td>` : ''}` : '';
    return `<tr><td class="dim">${r.pos}</td><td class="q-team"><div class="q-head"><b>${tmLink(r.team)}</b>${chip}</div><div class="q-need">${esc(text)}</div></td><td class="num">${r.pts}</td><td class="num">${r.left}</td>${odds}</tr>`;
  }).join('');
  return `<div class="card">
    <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">Qualification</h2>
      <label class="check" style="gap:8px">Top <select id="tr-q" class="select" aria-label="Teams that go through">${Array.from({ length: t.teams.length - 1 }, (_, k) => k + 1).map(k => `<option${k === N ? ' selected' : ''}>${k}</option>`).join('')}</select> go through</label></div>
    <div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>#</th><th>Team and what they need</th><th class="num">Pts</th><th class="num">Left</th>${od ? `<th class="num">Top ${N}</th>${od.top2 ? '<th class="num">Top 2</th>' : ''}` : ''}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">${q.remaining ? `Plays out the ${plural(q.remaining, 'remaining league match', 'remaining league matches')} every possible way, each won by one side (ties and no results aren't modelled).` : 'The league is complete.'} Teams level on points at the cut-off are separated by ${tbName}, which these scenarios can't predict${q.exact ? '' : '. With this many matches left, this is a points-only estimate'}.${od ? ` The chances come from playing the rest of the league out 3,000 times: the side with the better record so far wins more often, and teams level on points are split by net run rate with some luck.${od.top2 ? ' Top 2 matters in the IPL format, where 1st and 2nd get two chances to reach the final.' : ''}` : ''}</p>
  </div>`;
}

function koCard(t, ko, byId) {
  const list = KO_ORDER.map(s => ko.find(f => f.stage === s)).filter(Boolean);
  const ipl = ko.some(f => f.stage === 'Q1');
  const left = list.some(f => !isPlayed(f));
  const fin = ko.find(f => f.stage === 'F');
  const fw = fin ? koWinner(t, fin, byId) : null;
  const banner = fw ? (fw.team
      ? `<div class="champ"><span>Champions</span><b>${esc(fw.team)}</b>${fw.how ? `<em>${esc(fw.how)}</em>` : ''}</div>`
      : `<div class="champ"><span>Final ${esc(fw.how)}</span><b>Trophy shared</b><em>Record a super over winner to decide it</em></div>`) : '';
  const cap = f => {
    const seeds = f.seedA && f.seedB ? ` · ${ordN(f.seedA)} v ${ordN(f.seedB)}` : '';
    return STAGE[f.stage] + seeds;
  };
  return `<div class="card">
    <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">Knockouts</h2>
      <div class="head-actions" style="width:auto">${left ? '<button type="button" class="btn ghost sm" data-tr="sim-ko">Simulate knockouts</button>' : ''}<button type="button" class="btn ghost sm danger" data-tr="ko-del">Remove knockouts</button></div></div>
    ${banner}
    ${list.map(f => fxRow(t, f, f.stage, byId, cap(f))).join('')}
    <p class="hint">${ipl ? 'The winner of Qualifier 1 goes straight to the final; the loser gets a second chance in Qualifier 2 against the winner of the Eliminator. ' : ''}Knockout matches don't count in the points table. A tied knockout without a super over sends the higher-placed side through.</p>
  </div>`;
}

// A leaderboard card. rows have .name/.key (players) and optionally .team or .teams.
function board(title, rows, val, sub, note = '') {
  const teamOf = r => (r.teams ? [...r.teams].join(', ') : r.team || '');
  return `<div class="card"><h2 class="card-title">${esc(title)}</h2>${rows.length ? `<table class="tbl"><tbody>${rows.map((r, k) => `<tr><td class="dim">${k + 1}</td><td>${plLink(r.name, r.key)}<div class="dim" style="font-size:.78rem">${esc(teamOf(r))}</div></td><td class="num"><b>${val(r)}</b></td><td class="num dim" style="font-size:.8rem">${sub(r)}</td></tr>`).join('')}</tbody></table>${note ? `<p class="hint" style="margin-bottom:0">${esc(note)}</p>` : ''}` : '<p class="hint" style="margin:0">Appears once a match is scored or simulated.</p>'}</div>`;
}
// Run rates and wickets in the powerplay, middle and death overs, by team, and the best bowlers in each.
function phaseCard(t, S) {
  const teams = t.teams.filter(n => S.teamPh[n]);
  if (!teams.length) return '';
  const O = t.overs || 20, ov = phaseOvers(O), minB = O <= 20 ? 12 : 30;
  const head = `<tr><th>Team</th>${PHASES.map((n, k) => `<th class="num">${n}<div class="dim" style="font-weight:400;font-size:.72rem">overs ${ov[k]}</div></th>`).join('')}</tr>`;
  const cell = q => `<td class="num">${rr(q.r, q.b)}<div class="dim" style="font-size:.72rem">${q.n ? `${nf(q.w / q.n, 1)} wkts/inns` : ''}</div></td>`;
  const tbl = side => `<div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead>${head}</thead><tbody>${teams.map(n => `<tr><td>${tmLink(n)}</td>${S.teamPh[n][side].map(cell).join('')}</tr>`).join('')}</tbody></table></div>`;
  const bestIn = k => S.bowlPh.filter(x => x.ph[k].b >= minB).sort((a, b) => a.ph[k].r / a.ph[k].b - b.ph[k].r / b.ph[k].b).slice(0, 5);
  const mini = (k, label) => { const L = bestIn(k); return `<div><p class="modal-sub">${label}</p>${L.length ? L.map(x => `<div class="tp-line">${plLink(x.name, x.key)}<span><b>${rr(x.ph[k].r, x.ph[k].b)}</b> <span class="dim">econ, ${fmtOvers(x.ph[k].b)} ov</span></span></div>`).join('') : `<p class="hint" style="margin:0">Nobody has bowled ${minB / 6} overs here yet.</p>`}</div>`; };
  return `<div class="card"><h2 class="card-title">Phases of the innings</h2>
    <p class="modal-sub">Batting: run rate, wickets lost</p>${tbl('bat')}
    <p class="modal-sub" style="margin-top:14px">Bowling: run rate conceded, wickets taken</p>${tbl('bowl')}
    <div class="grid-2" style="margin-top:14px">${mini(0, 'Best powerplay bowlers')}${mini(2, 'Best death bowlers')}</div>
    <p class="hint">From matches scored live and simulated ones${t.fixtures.some(f => f.manual && !f.manual.sim) ? ' (typed-in scores have no over-by-over detail)' : ''}. Bowlers need ${minB / 6} overs in a phase to be listed.</p></div>`;
}

RENDER.tournament = function renderTournament() {
  const ts = list();
  const t = active();
  const sel = $('#tr-select');
  sel.innerHTML = ts.map(x => `<option value="${esc(x.id)}"${t && x.id === t.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  sel.hidden = ts.length < 2;
  $('#tr-edit').hidden = $('#tr-delete').hidden = !t;
  $('#tr-title').textContent = t ? t.name : 'Tournaments';
  const main = $('#tr-main');
  if (!t) {
    main.innerHTML = `<div class="empty-state" style="text-align:left">
      <p style="margin:0 0 6px;font-weight:700;color:var(--fg)">No tournament yet</p>
      <p style="margin:0 0 14px">Add the teams once, generate the fixtures, then score each match from here. The points table and net run rates update themselves.</p>
      <button type="button" class="btn" data-tr="new">Create a tournament</button></div>`;
    return;
  }
  const byId = new Map(finishedMatches().map(m => [m.id, m]));
  if (syncFinal(t, byId)) update(t);
  const rows = table(t);
  const league = t.fixtures.filter(f => !f.stage), ko = t.fixtures.filter(f => f.stage);
  const played = league.filter(f => { const o = outcome(t, f, byId); return o && !o.error; }).length;
  const S = curStats = tourStats(t, byId);
  const O = t.overs || 20;
  const lead = S.players;
  const top = (ok, sort, n = 5) => lead.filter(ok).sort(sort).slice(0, n);
  const bats = top(r => r.inns > 0, (a, b) => b.runs - a.runs || a.balls - b.balls);
  const bowls = top(r => r.bw > 0, (a, b) => b.bw - a.bw || a.br - b.br);
  const six = top(r => r.f6 > 0, (a, b) => b.f6 - a.f6 || b.runs - a.runs);
  const minB = Math.min(100, Math.max(30, 3 * O));
  const srs = top(r => r.balls >= minB, (a, b) => b.runs / b.balls - a.runs / a.balls);
  const mvp = top(r => r.mvp > 0, (a, b) => b.mvp - a.mvp || b.pom - a.pom);
  const hs = S.inns.slice().sort((a, b) => b.r - a.r || a.b - b.b).slice(0, 5);
  // Balls to reach fifty, estimated from the innings' strike rate (simulated cards don't record every ball).
  const fast = S.inns.filter(x => x.r >= 50 && x.b).map(x => ({ ...x, to50: Math.max(9, Math.ceil(50 * x.b / x.r)) })).sort((a, b) => a.to50 - b.to50 || b.r - a.r).slice(0, 5);
  const bestB = S.spells.filter(x => x.w > 0).sort((a, b) => b.w - a.w || a.r - b.r || a.balls - b.balls).slice(0, 5);
  const fxs = league.map((f, k) => fxRow(t, f, String(k + 1), byId)).join('');
  const N = qualifyN(t);
  const leagueLeft = league.filter(f => f.a && f.b && !isPlayed(f) && !busy(t, f)).length;
  const anySim = t.fixtures.some(isSim);
  const tbTxt = TIEBREAKS[t.tiebreak] || TIEBREAKS.nrr;
  main.innerHTML = `
    <div class="card">
      <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">Points table</h2><button type="button" class="btn ghost sm" data-tr="nrrcalc">NRR calculator</button><span class="hint" style="margin:0;flex-basis:100%">${plural(played, 'result')} of ${plural(league.length, 'fixture')} · ${t.overs ? `${t.overs} overs a side` : 'no fixed overs'} · Win ${t.pts.w}, tie ${t.pts.t}, no result ${t.pts.nr}</span></div>
      <div class="tbl-wrap" style="margin-top:0"><table class="tbl pts-tbl"><thead><tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">NR</th><th class="num">Pts</th><th class="num">NRR</th><th></th></tr></thead>
      <tbody>${rows.map((r, k) => `<tr class="${k === 0 && r.p ? 'hl' : ''}${N && k === N - 1 && rows.length > N ? ' q-line' : ''}"><td class="dim">${k + 1}</td><td><b>${tmLink(r.team)}</b></td><td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.tie}</td><td class="num">${r.nr}</td><td class="num"><b>${r.pts}</b></td><td class="num ${r.nrr == null ? 'dim' : r.nrr >= 0 || Math.abs(r.nrr) < 0.0005 ? 'pos' : 'neg'}">${signed(r.nrr)}</td>
        <td class="num">${r.p - r.nr > 0 ? `<button type="button" class="btn ghost sm" data-tr="nrr" data-team="${esc(r.team)}">NRR solver</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Sorted by points, then ${tbTxt}.${t.tieRule === 'so' ? ' A tie won in a super over counts as a win.' : ''}${N && rows.length > N ? ` The line marks the top ${N}, who go through.` : ''} A side bowled out counts as facing its full ${t.overs ? `${t.overs} overs` : 'quota'}. Tap a team for its results, form and head-to-head record. “NRR calculator” shows the margin a team needs to pass another; “NRR solver” opens the Net run rate tab with that team's results.</p>
    </div>
    ${qualCard(t, N)}
    ${ko.length ? koCard(t, ko, byId) : ''}
    <div class="card">
      <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">${ko.length ? 'League fixtures' : 'Fixtures and results'}</h2>
        <div class="head-actions" style="width:auto"><button type="button" class="btn ghost sm" data-tr="squads">Squads</button><button type="button" class="btn ghost sm" data-tr="rr">Add round-robin fixtures</button><button type="button" class="btn ghost sm" data-tr="import">Add fixtures from a list</button><button type="button" class="btn ghost sm" data-tr="addfx">Add a fixture</button>${leagueLeft ? `<button type="button" class="btn ghost sm" data-tr="sim-all">Simulate ${leagueLeft === league.length ? 'the league' : `the other ${leagueLeft}`}</button>` : ''}${anySim ? '<button type="button" class="btn ghost sm danger" data-tr="sim-clear">Clear simulated results</button>' : ''}${ko.length || t.teams.length < 2 ? '' : '<button type="button" class="btn ghost sm" data-tr="ko">Set up knockouts</button>'}</div></div>
      ${fxs || '<p class="hint" style="margin:0">No fixtures yet. “Add round-robin fixtures” creates the league: every pair of teams once or twice, or the IPL format with ten teams.</p>'}
      ${t.groups && fxs ? `<p class="hint">Groups: ${t.groups.map((g, k) => `${'AB'[k]}: ${g.map(esc).join(', ')}`).join(' · ')}.</p>` : ''}
      ${fxs ? '<p class="hint">“Simulate” makes up a realistic result instead of scoring the match, which is handy for trying out a tournament. Each one comes with a full scorecard (using the squads, if you add them), and about one in 30 league matches is washed out. Simulated results are marked and can be cleared; scored matches are never touched.</p>' : ''}
    </div>
    <div class="grid-2">
      ${board('Orange Cap · most runs', bats, r => r.runs, r => `${r.balls ? nf(r.runs / r.balls * 100, 1) : '—'} SR`)}
      ${board('Purple Cap · most wickets', bowls, r => r.bw, r => `${rr(r.br, r.bb)} econ`)}
    </div>
    ${lead.length ? `<div class="grid-2">
      ${board('Player of the tournament', mvp, r => nf(r.mvp, 0), r => (r.pom ? plural(r.pom, 'PoM award') : '0 PoM awards'), 'Points from every match: runs (more for quick scoring), wickets (more for tight bowling) and catches.')}
      ${board('Most sixes', six, r => r.f6, r => `${r.runs} runs`)}
      ${board('Highest scores', hs, x => `${x.r}${x.out ? '' : '*'}`, x => `${x.b} balls v ${esc(x.opp)}`)}
      ${board('Best bowling', bestB, x => figs(x), x => `${fmtOvers(x.balls)} ov v ${esc(x.opp)}`)}
      ${board('Fastest fifty', fast, x => `${x.to50} balls`, x => `${x.r}${x.out ? '' : '*'} v ${esc(x.opp)}`, 'Balls to 50, estimated from the innings strike rate.')}
      ${board('Best strike rate', srs, r => nf(r.runs / r.balls * 100, 1), r => `${r.runs} off ${r.balls}`, `At least ${minB} balls faced.`)}
    </div>` : ''}
    ${phaseCard(t, S)}
    ${anySim ? '<p class="hint">Simulated players\' figures count here only. They are not added to the Players tab or your records.</p>' : ''}`;
};

/* ---------- Editing a tournament ---------- */
function tournamentForm(t) {
  const body = openModal(t ? 'Edit tournament' : 'New tournament', `
    <div class="fields">
      <div class="field wide"><div class="lab"><label for="tf-name">Name</label></div><input id="tf-name" type="text" maxlength="50" autocomplete="off" value="${esc(t?.name || '')}" placeholder="e.g. Valley Premier League 2026"></div>
      <div class="field"><div class="lab"><label for="tf-overs">Overs per side</label></div><input id="tf-overs" type="text" inputmode="numeric" autocomplete="off" value="${esc(t?.overs ?? 20)}"></div>
      <div class="field wide"><div class="lab"><label for="tf-teams">Teams, one per line</label></div><textarea id="tf-teams" rows="6" spellcheck="false" placeholder="Falcons | Riverside Oval&#10;Rhinos | Hill Park&#10;Tigers&#10;Eagles">${esc((t?.teams || []).map(n => n + (t.grounds?.[n] ? ` | ${t.grounds[n]}` : '')).join('\n'))}</textarea></div>
    </div>
    <p class="modal-sub" style="margin-top:14px">Points</p>
    <div class="fields three">
      <div class="field"><div class="lab"><label for="tf-w">Win</label></div><input id="tf-w" type="text" inputmode="numeric" value="${esc(t?.pts?.w ?? 2)}"></div>
      <div class="field"><div class="lab"><label for="tf-t">Tie</label></div><input id="tf-t" type="text" inputmode="numeric" value="${esc(t?.pts?.t ?? 1)}"></div>
      <div class="field"><div class="lab"><label for="tf-nr">No result</label></div><input id="tf-nr" type="text" inputmode="numeric" value="${esc(t?.pts?.nr ?? 1)}"></div>
    </div>
    <p class="modal-sub" style="margin-top:14px">Rules</p>
    <div class="fields three">
      <div class="field"><div class="lab"><label for="tf-tie">Tied matches</label></div><select id="tf-tie"><option value="share"${t?.tieRule === 'so' ? '' : ' selected'}>Points shared</option><option value="so"${t?.tieRule === 'so' ? ' selected' : ''}>Super over decides</option></select></div>
      <div class="field"><div class="lab"><label for="tf-tb">Level on points</label></div><select id="tf-tb">${Object.entries(TIEBREAKS).map(([k, l]) => `<option value="${k}"${(t?.tiebreak || 'nrr') === k ? ' selected' : ''}>${esc(l[0].toUpperCase() + l.slice(1))}</option>`).join('')}</select></div>
      <div class="field"><div class="lab"><label for="tf-q">Teams that go through</label></div><input id="tf-q" type="text" inputmode="numeric" autocomplete="off" value="${esc(Number.isInteger(t?.qualify) ? t.qualify : '')}" placeholder="Top 4"></div>
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" id="tf-imp"${t?.impact ? ' checked' : ''}> Impact Player rule: each side can swap one player for a substitute during the match</label>
    <p class="hint">After a team's name you can add its home ground, like “Chennai | Chepauk”. The first team named in a fixture is at home. With “Super over decides”, the super-over winner of a tied match gets the points for a win. Knockouts always use the super over. Leave “Teams that go through” empty for the top 4 (top 2 with four teams or fewer), or enter 0 to hide the qualification card.</p>
    ${t ? '<p class="hint">Renaming a team here keeps its fixtures, as long as it stays on the same line. Removing a team removes its fixtures.</p>' : ''}
    <p class="err-text" id="tf-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">${t ? 'Save changes' : 'Create tournament'}</button></div>`, { wide: true });
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const err = $('#tf-err', body);
    const name = $('#tf-name', body).value.trim();
    const overs = Number($('#tf-overs', body).value.trim());
    const lines = $('#tf-teams', body).value.split('\n').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const teams = lines.map(l => l.split('|')[0].trim()).filter(Boolean);
    const grounds = {};
    lines.forEach(l => { const [n, g] = l.split('|').map(x => (x || '').trim()); if (n && g) grounds[n] = g; });
    const pts = { w: Number($('#tf-w', body).value), t: Number($('#tf-t', body).value), nr: Number($('#tf-nr', body).value), l: 0 };
    if (!name) { err.textContent = 'Give the tournament a name.'; return; }
    if (!Number.isInteger(overs) || overs < 1 || overs > 200) { err.textContent = 'Overs per side must be a whole number from 1 to 200.'; return; }
    if (teams.length < 2) { err.textContent = 'Add at least two teams.'; return; }
    const dup = teams.find((n, k) => teams.findIndex(x2 => same(x2, n)) !== k);
    if (dup) { err.textContent = `“${dup}” is listed twice.`; return; }
    if (Object.values(pts).some(v => !Number.isInteger(v) || v < 0)) { err.textContent = 'Points must be whole numbers.'; return; }
    const qS = $('#tf-q', body).value.trim();
    const qualify = qS === '' ? null : Number(qS); // empty: the default for the number of teams
    if (qualify !== null && (!Number.isInteger(qualify) || qualify < 0 || qualify >= teams.length)) { err.textContent = `Teams that go through must be a whole number below ${teams.length}.`; return; }
    const tieRule = $('#tf-tie', body).value === 'so' ? 'so' : 'share';
    const tiebreak = TIEBREAKS[$('#tf-tb', body).value] ? $('#tf-tb', body).value : 'nrr';
    let fixtures = [];
    if (t) {
      const ren = new Map();
      if (t.teams.length === teams.length) t.teams.forEach((old, k) => { if (old !== teams[k]) ren.set(old, teams[k]); });
      // A knockout match whose teams aren't known yet (TBC) is kept.
      const ok = n => n == null || teams.includes(n);
      fixtures = t.fixtures.map(f => ({ ...f, a: ren.get(f.a) || f.a, b: ren.get(f.b) || f.b })).filter(f => ok(f.a) && ok(f.b));
    }
    const nt = { ...(t || { id: uid(), created: Date.now() }), name, overs, teams, pts, fixtures, qualify, tieRule, tiebreak, grounds, impact: $('#tf-imp', body).checked };
    update(nt);
    store.set('tour.active', nt.id);
    closeModal();
    RENDER.tournament();
    toast(t ? 'Tournament updated' : 'Tournament created. Add the fixtures next.');
  });
}

function manualForm(t, f) {
  const m0 = f.manual, edit = !!m0;
  const side = (k, label) => { const v = m0?.[k]; return `<p class="modal-sub" style="margin-top:12px">${esc(label)}</p><div class="fields three">
    <div class="field"><div class="lab"><label for="mr-${k}-r">Runs</label></div><input id="mr-${k}-r" type="text" inputmode="numeric" autocomplete="off" value="${esc(v?.r ?? '')}"></div>
    <div class="field"><div class="lab"><label for="mr-${k}-w">Wickets</label></div><input id="mr-${k}-w" type="text" inputmode="numeric" autocomplete="off" value="${esc(v?.w ?? '')}"></div>
    <div class="field"><div class="lab"><label for="mr-${k}-o">Overs</label></div><input id="mr-${k}-o" type="text" inputmode="decimal" autocomplete="off" value="${esc(v ? fmtOvers(v.balls) : t.overs ?? '')}"></div>
  </div><label class="check" style="margin-top:8px"><input type="checkbox" id="mr-${k}-ao"${v?.ao ? ' checked' : ''}> All out</label>`; };
  const body = openModal(`${edit ? 'Edit' : 'Enter'} result: ${f.a} v ${f.b}`, `
    <p class="hint" style="margin:-6px 0 4px">${edit ? (m0.sim ? 'Changing a simulated result turns it into a typed-in one, so its made-up scorecard and player figures go.' : 'Change the scores and save.') : 'For a match you didn\'t score in Crease.'} The higher score wins; equal scores are a tie.</p>
    <div class="field" style="margin-top:10px"><div class="lab"><label for="mr-first">Batted first</label></div><select id="mr-first"><option value="">Not sure</option><option value="a"${m0?.first === 'a' ? ' selected' : ''}>${esc(f.a)}</option><option value="b"${m0?.first === 'b' ? ' selected' : ''}>${esc(f.b)}</option></select></div>
    ${side('a', f.a)}${side('b', f.b)}
    <p class="err-text" id="mr-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save result</button></div>`);
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const err = $('#mr-err', body);
    const read = k => {
      const r = $(`#mr-${k}-r`, body).value.trim(), w = $(`#mr-${k}-w`, body).value.trim(), o = parseOvers($(`#mr-${k}-o`, body).value);
      const ao = $(`#mr-${k}-ao`, body).checked;
      const team = k === 'a' ? f.a : f.b;
      if (!/^\d+$/.test(r)) return `${team}: enter the runs scored.`;
      if (w && (!/^\d+$/.test(w) || Number(w) > 10)) return `${team}: wickets must be 0 to 10.`;
      if (o.error || !o.balls) return `${team}: enter the overs faced, like 18.4.`;
      if (t.overs && o.balls > t.overs * 6) return `${team}: that's more than ${t.overs} overs.`;
      return { r: Number(r), w: w === '' ? (ao ? 10 : null) : Number(w), balls: o.balls, ao };
    };
    const A = read('a'), B = read('b');
    if (typeof A === 'string') { err.textContent = A; return; }
    if (typeof B === 'string') { err.textContent = B; return; }
    const first = $('#mr-first', body).value;
    f.manual = { a: A, b: B, ...(first ? { first } : {}) }; f.matchId = null; f.nr = false; f.simNR = false; f.so = null; delete f.pom;
    const n = reflowKO(t);
    update(t); closeModal(); RENDER.tournament(); toast((edit ? 'Result updated.' : 'Result saved.') + resetMsg(n));
  });
}

function linkForm(t, f) {
  const ms = finishedMatches();
  const fit = ms.filter(m => m.data.teams.some(x => same(x, f.a)) && m.data.teams.some(x => same(x, f.b)));
  const others = ms.filter(m => !fit.includes(m));
  const opt = m => `<option value="${esc(m.id)}">${esc(m.title)} · ${esc(m.result)} · ${new Date(m.savedAt).toLocaleDateString()}</option>`;
  if (!ms.length) { toast('There are no finished saved matches to link yet.'); return; }
  const body = openModal(`Link a match: ${f.a} v ${f.b}`, `
    <div class="field"><div class="lab"><label for="lk-m">Saved match</label></div><select id="lk-m">${fit.length ? `<optgroup label="Between these teams">${fit.map(opt).join('')}</optgroup>` : ''}${others.length ? `<optgroup label="Other matches">${others.map(opt).join('')}</optgroup>` : ''}</select></div>
    <p class="hint">The result, scores and player stats come from the saved scorecard.</p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Link match</button></div>`);
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'ok') {
      f.matchId = $('#lk-m', body).value; f.manual = null; f.nr = false; f.simNR = false; f.so = null;
      update(t); toast('Match linked');
    }
    closeModal(); RENDER.tournament();
  });
}

async function scoreFixture(t, f) {
  const pendingHere = live && live.tournament && live.tournament.fid === f.id && live.status !== 'done';
  if (pendingHere) { showTab('live', { scrollTop: true }); return; }
  if (live && live.status !== 'done') {
    if (!(await confirmBox('Replace the match in the live scorer?', 'The match currently in the live scorer is saved to Saved matches first, so nothing is lost.', 'Save it and continue'))) return;
    saveMatch(true);
  }
  clearLive();
  setupFromFixture({ ta: f.a, tb: f.b, overs: t.overs, impact: !!t.impact, link: { tid: t.id, fid: f.id }, label: `${t.name}${f.stage ? ` ${STAGE[f.stage].toLowerCase()}` : ''}: ${f.a} v ${f.b}${t.grounds?.[f.a] ? ` at ${t.grounds[f.a]}` : ''}` });
  showTab('live', { scrollTop: true });
}

function sendToNRR(t, team) {
  const byId = new Map(finishedMatches().map(m => [m.id, m]));
  const rows = [];
  t.fixtures.forEach(f => {
    if (f.stage || (!same(f.a, team) && !same(f.b, team))) return;
    const o = outcome(t, f, byId);
    if (!o || o.error || o.nr) return;
    const me = same(f.a, team) ? 'a' : 'b', them = me === 'a' ? 'b' : 'a';
    rows.push({ opp: me === 'a' ? f.b : f.a, rf: String(o[me].r), of: fmtOvers(o[me].balls), fao: !!o[me].ao, ra: String(o[them].r), ob: fmtOvers(o[them].balls), oao: !!o[them].ao });
  });
  if (!rows.length) { toast(`${team} has no results with scores yet.`); return; }
  appHooks.useOvers && appHooks.useOvers(t.overs);
  loadNRR(rows);
  showTab('nrr', { scrollTop: true });
  toast(`${team}'s results loaded into the NRR tab`);
}

function soForm(t, f) {
  const body = openModal(`Super over: ${f.a} v ${f.b}`, `
    <p class="hint" style="margin:-6px 0 14px">The match was tied. Who won the super over? ${f.stage ? 'The winner goes through.' : t.tieRule === 'so' ? 'The winner gets the points for a win.' : 'In this tournament ties share the points, so the table doesn\'t change. Switch “Tied matches” under Edit to let the super over decide.'}</p>
    <div class="modal-actions" style="justify-content:flex-start"><button type="button" class="btn" data-so="a">${esc(f.a)}</button><button type="button" class="btn" data-so="b">${esc(f.b)}</button>${f.so ? '<button type="button" class="btn ghost" data-so="none">No super over</button>' : ''}<button type="button" class="btn ghost" data-so="cancel">Cancel</button></div>`);
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-so]');
    if (!b) return;
    const v = b.dataset.so;
    closeModal();
    if (v === 'cancel') return;
    f.so = v === 'a' || v === 'b' ? v : null;
    const n = reflowKO(t);
    update(t); RENDER.tournament();
    if (n) { toast(resetMsg(n).trim()); return; }
    toast(f.so ? `${f.so === 'a' ? f.a : f.b} won the super over` : 'Super over removed');
  });
}

function koForm(t) {
  const byId = new Map(finishedMatches().map(m => [m.id, m]));
  const rows = table(t);
  if (rows.length < 2) { toast('Add at least two teams first'); return; }
  const pendingN = t.fixtures.filter(f => !f.stage && !outcome(t, f, byId)).length;
  const canSemis = rows.length >= 4;
  let type = canSemis ? (t.koType === 'ipl' ? 'ipl' : 'semis') : 'final';
  const body = openModal('Set up knockouts', `
    <p class="hint" style="margin:-6px 0 12px">Seeds come from the points table as it stands now.${pendingN ? ` ${plural(pendingN, 'league fixture is', 'league fixtures are')} still to be played, so you may want to wait until the league is finished.` : ''}</p>
    <div class="seg" role="group" aria-label="Format">${canSemis ? '<button type="button" data-ko="semis" aria-pressed="true">Semi-finals and a final</button><button type="button" data-ko="ipl" aria-pressed="false">IPL playoffs</button>' : ''}<button type="button" data-ko="final" aria-pressed="${!canSemis}">Final only</button></div>
    <p class="hint" id="ko-desc"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Create knockouts</button></div>`);
  const desc = () => {
    $('#ko-desc', body).textContent = type === 'ipl'
        ? `Qualifier 1: ${rows[0].team} (1st) v ${rows[1].team} (2nd), the winner goes to the final. Eliminator: ${rows[2].team} (3rd) v ${rows[3].team} (4th), the loser is out. Qualifier 2: the loser of Qualifier 1 v the winner of the Eliminator. Final: the winners of Qualifier 1 and Qualifier 2.`
        : type === 'semis'
            ? `Semi-final 1: ${rows[0].team} (1st) v ${rows[3].team} (4th). Semi-final 2: ${rows[1].team} (2nd) v ${rows[2].team} (3rd). The winners meet in the final.`
            : `Final: ${rows[0].team} (1st) v ${rows[1].team} (2nd).`;
    body.querySelectorAll('[data-ko]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ko === type)));
  };
  desc();
  body.addEventListener('click', e => {
    const k = e.target.closest('[data-ko]'), x = e.target.closest('[data-x]');
    if (k) { type = k.dataset.ko; desc(); return; }
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const fx = (stage, a, b, seedA, seedB, extra = {}) => ({ id: uid(), stage, a, b, seedA, seedB, matchId: null, manual: null, nr: false, ...extra });
    t.fixtures = t.fixtures.filter(f => !f.stage);
    t.koType = type;
    if (type === 'ipl') {
      t.fixtures.push(fx('Q1', rows[0].team, rows[1].team, 1, 2), fx('EL', rows[2].team, rows[3].team, 3, 4),
          fx('Q2', null, null, null, null, { from: ['L:Q1', 'W:EL'] }), fx('F', null, null, null, null, { from: ['W:Q1', 'W:Q2'] }));
      if (!Number.isInteger(t.qualify) || !t.qualify) t.qualify = 4;
    } else if (type === 'semis') {
      t.fixtures.push(fx('SF1', rows[0].team, rows[3].team, 1, 4), fx('SF2', rows[1].team, rows[2].team, 2, 3), fx('F', null, null, null, null, { from: ['SF1', 'SF2'] }));
      if (!Number.isInteger(t.qualify) || !t.qualify) t.qualify = 4;
    } else {
      t.fixtures.push(fx('F', rows[0].team, rows[1].team, 1, 2));
      if (!Number.isInteger(t.qualify) || !t.qualify) t.qualify = 2;
    }
    update(t); closeModal(); RENDER.tournament();
    toast(type === 'ipl' ? 'IPL playoffs added' : type === 'semis' ? 'Semi-finals and final added' : 'Final added');
  });
}

// Fixtures typed or pasted in: "Team v Team", optionally with a date and a ground after "|".
function importForm(t) {
  const body = openModal('Add fixtures from a list', `
    <div class="field wide"><div class="lab"><label for="im-text">Matches, one per line</label></div><textarea id="im-text" rows="8" spellcheck="false" placeholder="Falcons v Rhinos | 28 Mar 2026 | Riverside Oval&#10;Tigers v Eagles | 29 Mar 2026&#10;Rhinos v Tigers"></textarea></div>
    <p class="hint">Write “A v B” (or “A vs B”). After a “|” you can add a date, like 28 Mar 2026 or 2026-03-28, and a ground. Team names must match the tournament's teams. The first team named is at home. Matches already in the league are kept, so if you're replacing the league, remove the old fixtures first. A list with dates keeps its order, so it is played out in the order you give.</p>
    <p class="err-text" id="im-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Add these matches</button></div>`, { wide: true });
  const parseDate = v => {
    const x = v.trim(); let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x))) return x;
    if ((m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s*(\d{4})?$/.exec(x))) {
      const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase());
      if (mo >= 0) return `${m[3] || new Date().getFullYear()}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return null;
  };
  body.addEventListener('click', async e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    const err = $('#im-err', body);
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const lines = $('#im-text', body).value.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { err.textContent = 'Type or paste at least one match.'; return; }
    const out = [];
    for (const [k, l] of lines.entries()) {
      const [pair, ...rest] = l.split('|').map(v => v.trim());
      const m = /^(.+?)\s+(?:v|vs|vs\.|versus)\s+(.+)$/i.exec(pair);
      if (!m) { err.textContent = `Line ${k + 1}: write it like “Falcons v Rhinos”.`; return; }
      const A = t.teams.find(n => same(n, m[1])), B = t.teams.find(n => same(n, m[2]));
      if (!A || !B) { err.textContent = `Line ${k + 1}: “${!A ? m[1] : m[2]}” isn't one of the tournament's teams.`; return; }
      if (A === B) { err.textContent = `Line ${k + 1}: a team can't play itself.`; return; }
      let date = null, venue = null;
      for (const r of rest) { const d = parseDate(r); if (d && !date) date = d; else if (r && !venue) venue = r; }
      out.push({ id: uid(), a: A, b: B, date, venue, matchId: null, manual: null, nr: false });
    }
    out.forEach(f => { if (!f.date) delete f.date; if (!f.venue) delete f.venue; });
    t.fixtures = [...t.fixtures.filter(f => !f.stage), ...out, ...t.fixtures.filter(f => f.stage)];
    update(t); closeModal(); RENDER.tournament(); toast(`${plural(out.length, 'match', 'matches')} added`);
  });
}

// League fixtures: every pair once, every pair twice (home and away), or the IPL's 14-match format for ten teams.
function rrForm(t) {
  const n = t.teams.length, ten = n === 10;
  const body = openModal('Add league fixtures', `
    <div class="seg" role="group" aria-label="Format" style="flex-wrap:wrap">
      <button type="button" data-rr="1" aria-pressed="true">Play each other once</button>
      <button type="button" data-rr="2" aria-pressed="false">Twice (home and away)</button>
      ${ten ? '<button type="button" data-rr="ipl" aria-pressed="false">IPL 2026 format</button><button type="button" data-rr="ipl22" aria-pressed="false">Older IPL format (2022–25)</button>' : ''}
    </div>
    ${ten ? '<label class="check" id="rr-draw-l" style="margin-top:10px" hidden><input type="checkbox" id="rr-draw" checked> Draw the two groups at random (untick to use the order the teams are listed)</label>' : ''}
    <p class="hint" id="rr-desc"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Add fixtures</button></div>`);
  let mode = '1';
  const desc = () => {
    const draw = $('#rr-draw', body);
    if (draw) $('#rr-draw-l', body).hidden = !mode.startsWith('ipl');
    $('#rr-desc', body).textContent = mode === 'ipl'
        ? `Two groups of five${draw?.checked ? ', drawn at random' : `: ${t.teams.slice(0, 5).join(', ')} and ${t.teams.slice(5).join(', ')}`}. Each team plays the other four in its own group once, and the five teams in the other group twice, home and away: 14 matches each, 70 in all. Home and away are shared out, and the matches are spread through the season. To use the real match order instead, paste the fixtures with “Add fixtures from a list”.`
        : mode === 'ipl22'
            ? `Two groups of five${draw?.checked ? ', drawn at random' : `: ${t.teams.slice(0, 5).join(', ')} and ${t.teams.slice(5).join(', ')}`}. Each team plays its own group twice, the team in the same place in the other group twice, and the other four once: 14 matches each, 70 in all. Home and away are shared out, and the matches are spread through the season.`
            : mode === '2' ? `Every team plays every other team twice: ${2 * (n - 1)} matches each, ${n * (n - 1)} in all.` : `Every team plays every other team once: ${n - 1} matches each, ${n * (n - 1) / 2} in all.`;
    body.querySelectorAll('[data-rr]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rr === mode)));
  };
  desc();
  body.addEventListener('change', desc);
  body.addEventListener('click', e => {
    const k = e.target.closest('[data-rr]'), x = e.target.closest('[data-x]');
    if (k) { mode = k.dataset.rr; desc(); return; }
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    // IPL: the group draw decides the order; team k of group A is paired with team k of group B.
    let order = t.teams.slice();
    const hasLeague = t.fixtures.some(y => !y.stage);
    // Fixtures already made from a draw: keep that draw, or re-running would pair the teams differently.
    if (mode.startsWith('ipl') && hasLeague && t.groups?.flat().length === n && t.groups.flat().every(v => t.teams.includes(v))) order = t.groups.flat();
    else if (mode.startsWith('ipl')) {
      if ($('#rr-draw', body)?.checked) order = order.map(v => [Math.random(), v]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
      t.groups = [order.slice(0, 5), order.slice(5)];
    }
    // How many times each pair should meet.
    const times = (i, j) => {
      if (!mode.startsWith('ipl')) return Number(mode);
      const gi = i < 5 ? 0 : 1, gj = j < 5 ? 0 : 1;
      if (mode === 'ipl') return gi === gj ? 1 : 2; // 2026: own group once, the other group twice
      return gi === gj || i % 5 === j % 5 ? 2 : 1;
    };
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push(Math.random() < 0.5 ? [i, j] : [j, i]); // who is at home first
    let added = 0;
    // First legs for every pair, then the return legs, so each team's matches are spread out.
    [1, 2].forEach(leg => pairs.forEach(([i, j]) => {
      if (times(Math.min(i, j), Math.max(i, j)) < leg) return;
      const A = order[i], B = order[j];
      const have = t.fixtures.filter(y => !y.stage && ((same(y.a, A) && same(y.b, B)) || (same(y.a, B) && same(y.b, A)))).length;
      if (have >= leg) return;
      t.fixtures.push(leg === 1 ? { id: uid(), a: A, b: B, matchId: null, manual: null, nr: false } : { id: uid(), a: B, b: A, matchId: null, manual: null, nr: false });
      added++;
    }));
    spreadSchedule(t);
    update(t); closeModal(); RENDER.tournament();
    toast(added ? `${plural(added, 'fixture')} added and spread through the season` : 'Those fixtures are already there. The matches still to play have been reordered.');
  });
}

/* ---------- Wiring ---------- */
$('#tr-new').addEventListener('click', () => tournamentForm(null));
$('#tr-edit').addEventListener('click', () => { const t = active(); if (t) tournamentForm(t); });
$('#tr-delete').addEventListener('click', async () => {
  const t = active();
  if (!t) return;
  if (!(await confirmBox(`Delete ${t.name}?`, 'The tournament, its fixtures and typed-in results are removed. Matches scored in the live scorer stay in Saved matches.', 'Delete', true))) return;
  saveAll(list().filter(x => x.id !== t.id));
  store.del('tour.active');
  RENDER.tournament();
  toast('Tournament deleted');
});
$('#tr-select').addEventListener('change', e => { store.set('tour.active', e.target.value); RENDER.tournament(); });
$('#tr-main').addEventListener('change', e => {
  if (e.target.id !== 'tr-q') return;
  const t = active();
  if (!t) return;
  t.qualify = Number(e.target.value); update(t); RENDER.tournament();
});
$('#tr-main').addEventListener('click', async e => {
  const b = e.target.closest('[data-tr]');
  if (!b) return;
  const t = active();
  const a = b.dataset.tr;
  if (a === 'new') { tournamentForm(null); return; }
  if (!t) return;
  const f = t.fixtures.find(x => x.id === b.dataset.f);
  switch (a) {
    case 'rr': rrForm(t); break;
    case 'import': importForm(t); break;
    case 'sim': if (f && simulateFixture(t, f)) { syncFinal(t, new Map(finishedMatches().map(m => [m.id, m]))); update(t); RENDER.tournament(); toast('Result simulated'); } break;
    case 'sim-all': {
      let n = 0;
      t.fixtures.forEach(x => { if (!x.stage && !busy(t, x) && simulateFixture(t, x)) n++; });
      update(t); RENDER.tournament();
      toast(n ? `${plural(n, 'match', 'matches')} simulated` : 'Nothing left to simulate');
      break;
    }
    case 'sim-ko': {
      const byId = new Map(finishedMatches().map(m => [m.id, m]));
      let n = 0;
      // One round at a time, so each later match picks up the teams that came through.
      KO_ORDER.forEach(s => { syncFinal(t, byId); const x = t.fixtures.find(y => y.stage === s); if (x && !busy(t, x) && simulateFixture(t, x)) n++; });
      syncFinal(t, byId);
      update(t); RENDER.tournament();
      toast(n ? `${plural(n, 'knockout match', 'knockout matches')} simulated` : 'Nothing left to simulate');
      break;
    }
    case 'simcard': if (f?.manual?.card) simCardModal(t, f); break;
    case 'resim':
      if (f && isSim(f)) {
        f.manual = null; f.nr = false; f.simNR = false; f.so = null; delete f.pom;
        simulateFixture(t, f);
        const n = reflowKO(t);
        update(t); RENDER.tournament(); toast('Simulated again.' + resetMsg(n));
      }
      break;
    case 'pom': if (f) pomForm(t, f); break;
    case 'player': playerModal(t, b.dataset.key); break;
    case 'team': teamModal(t, b.dataset.team); break;
    case 'nrrcalc': nrrCalcForm(t); break;
    case 'fxedit': if (f) fxEditForm(t, f); break;
    case 'squads': squadsForm(t); break;
    case 'sim-clear':
      if (await confirmBox('Clear simulated results?', 'Every simulated result goes back to not played. Scored and typed-in results stay.', 'Clear', true)) {
        t.fixtures.forEach(x => { if (x.manual?.sim) { x.manual = null; x.so = null; delete x.pom; } if (x.simNR) { x.nr = false; x.simNR = false; } });
        t.sim = {};
        syncFinal(t, new Map(finishedMatches().map(m => [m.id, m])));
        update(t); RENDER.tournament(); toast('Simulated results cleared');
      }
      break;
    case 'addfx': {
      const opts = t.teams.map(n => `<option>${esc(n)}</option>`).join('');
      const body = openModal('Add a fixture', `<div class="fields"><div class="field"><div class="lab"><label for="af-a">Team</label></div><select id="af-a">${opts}</select></div><div class="field"><div class="lab"><label for="af-b">Against</label></div><select id="af-b">${opts}</select></div></div>
        <p class="err-text" id="af-err"></p><div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Add fixture</button></div>`);
      $('#af-b', body).selectedIndex = Math.min(1, t.teams.length - 1);
      body.addEventListener('click', ev => {
        const x = ev.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'cancel') { closeModal(); return; }
        const A = $('#af-a', body).value, B = $('#af-b', body).value;
        if (same(A, B)) { $('#af-err', body).textContent = 'Pick two different teams.'; return; }
        t.fixtures.push({ id: uid(), a: A, b: B, matchId: null, manual: null, nr: false });
        update(t); closeModal(); RENDER.tournament(); toast('Fixture added');
      });
      break;
    }
    case 'score': if (f) scoreFixture(t, f); break;
    case 'manual': if (f) manualForm(t, f); break;
    case 'link': if (f) linkForm(t, f); break;
    case 'nr': if (f) { f.nr = true; f.simNR = false; f.manual = null; f.matchId = null; f.so = null; delete f.pom; const n = reflowKO(t); update(t); RENDER.tournament(); toast('Marked as no result.' + resetMsg(n)); } break;
    case 'clear':
      if (f && await confirmBox('Clear this result?', 'The fixture goes back to not played. A linked scorecard stays in Saved matches.', 'Clear result')) {
        f.nr = false; f.simNR = false; f.manual = null; f.matchId = null; f.so = null; delete f.pom;
        const n = reflowKO(t);
        update(t); RENDER.tournament(); if (n) toast(resetMsg(n).trim());
      }
      break;
    case 'remove':
      if (f && await confirmBox(`Remove ${f.a} v ${f.b}?`, 'The fixture and its result are removed from the tournament.', 'Remove', true)) {
        t.fixtures = t.fixtures.filter(x => x.id !== f.id); update(t); RENDER.tournament();
      }
      break;
    case 'card': {
      const m = f && finishedMatches().find(x => x.id === f.matchId);
      if (m) openScorecard({ ...m.data, result: m.data.result || m.result }, m.title);
      break;
    }
    case 'nrr': sendToNRR(t, b.dataset.team); break;
    case 'so': if (f) soForm(t, f); break;
    case 'ko': koForm(t); break;
    case 'ko-del': {
      const done = t.fixtures.some(x => x.stage && isPlayed(x));
      if (await confirmBox('Remove the knockouts?', done ? 'The knockout fixtures and their results are removed. Scorecards stay in Saved matches.' : 'The knockout fixtures are removed. You can set them up again.', 'Remove', true)) {
        t.fixtures = t.fixtures.filter(x => !x.stage); update(t); RENDER.tournament(); toast('Knockouts removed');
      }
      break;
    }
    default: break;
  }
});

// A match scored from a fixture links itself to that fixture when it finishes.
matchHooks.done.push(m => {
  if (!m.tournament) return;
  const ts = list();
  const t = ts.find(x => x.id === m.tournament.tid);
  const f = t && t.fixtures.find(x => x.id === m.tournament.fid);
  if (!f) return;
  f.matchId = m.id; f.manual = null; f.nr = false; f.simNR = false; t.updated = Date.now();
  saveAll(ts);
  toast(`Result added to ${t.name}`);
});