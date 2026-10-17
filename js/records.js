/* Crease — player records.
   Builds each player's career from finished, saved matches scored in the live scorer, plus any
   "earlier stats" entered by hand. Pure calculations: no DOM here, so other tabs (tournaments)
   can reuse it for a subset of matches. Players are matched by name, ignoring case. */
import { store } from './utils.js';

export const nameKey = n => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
const SKIP_FIELDERS = new Set(['', 'fielder', 'keeper', 'sub', 'substitute']);

export const finishedMatches = () => {
  const v = store.get('matches', []);
  return (Array.isArray(v) ? v : []).filter(m => m && m.data && m.data.status === 'done' && Array.isArray(m.data.inns));
};
export const careerBase = () => { const v = store.get('careerBase', {}); return v && typeof v === 'object' ? v : {}; };

const blankBat = () => ({ inns: 0, no: 0, runs: 0, balls: 0, f4: 0, f6: 0, dots: 0, fifties: 0, hundreds: 0, ducks: 0, hs: -1, hsNo: false });
const blankBowl = () => ({ balls: 0, runs: 0, wkts: 0, maidens: 0, dots: 0, wd: 0, nb: 0, fourW: 0, fiveW: 0, bestW: -1, bestR: 0, types: { bowled: 0, caught: 0, lbw: 0, stumped: 0, other: 0 } });
const blankField = () => ({ ct: 0, st: 0, ro: 0 });

// Older matches only have dismissal text; newer ones also store it structured.
export function parseDismissal(b) {
  if (b.dis && b.dis.how) return b.dis;
  const h = String(b.how || '');
  let m;
  if ((m = h.match(/^c & b (.+)$/))) return { how: 'caught', bowler: m[1], fielder: m[1] };
  if ((m = h.match(/^c (.+?) b (.+)$/))) return { how: 'caught', bowler: m[2], fielder: m[1] };
  if ((m = h.match(/^st (.+?) b (.+)$/))) return { how: 'stumped', bowler: m[2], fielder: m[1] };
  if ((m = h.match(/^lbw b (.+)$/))) return { how: 'lbw', bowler: m[1], fielder: '' };
  if ((m = h.match(/^hit wicket b (.+)$/))) return { how: 'hit wicket', bowler: m[1], fielder: '' };
  if ((m = h.match(/^b (.+)$/))) return { how: 'bowled', bowler: m[1], fielder: '' };
  if ((m = h.match(/^run out(?: \((.+)\))?$/))) return { how: 'run out', bowler: '', fielder: m[1] || '' };
  return { how: h, bowler: '', fielder: '' };
}

const better = (w1, r1, w2, r2) => w1 > w2 || (w1 === w2 && r1 < r2);

export function buildRecords(matches = finishedMatches(), { includeBase = true, base = null } = {}) {
  const map = new Map();
  const get = (name, team) => {
    const k = nameKey(name);
    if (!k) return null;
    let r = map.get(k);
    if (!r) { r = { key: k, name: String(name).trim(), teams: new Set(), matchIds: new Set(), bat: blankBat(), bowl: blankBowl(), field: blankField(), games: [], base: null, vsBowl: new Map(), vsBat: new Map() }; map.set(k, r); }
    if (team) r.teams.add(team);
    return r;
  };
  for (const m of matches) {
    const d = m.data;
    const lines = new Map();
    const line = r => {
      let g = lines.get(r.key);
      if (!g) { g = { id: m.id, title: m.title, date: m.savedAt || d.created, format: d.format, result: d.result, bat: null, bowl: null, ct: 0, st: 0, ro: 0 }; lines.set(r.key, g); r.matchIds.add(m.id); r.games.push(g); }
      return g;
    };
    (d.squads || []).forEach((sq, t) => (sq || []).forEach(n => { const r = get(n, d.teams[t]); if (r) line(r); }));
    for (const inn of d.inns) {
      const batTeam = d.teams[inn.bat], fldTeam = d.teams[1 - inn.bat];
      for (const b of inn.batters) {
        const r = get(b.name, batTeam); if (!r) continue;
        const g = line(r), s = r.bat;
        s.inns++; if (!b.out) s.no++;
        s.runs += b.runs; s.balls += b.balls; s.f4 += b.f4; s.f6 += b.f6; s.dots += b.dots || 0;
        if (b.runs >= 100) s.hundreds++; else if (b.runs >= 50) s.fifties++;
        if (b.out && b.runs === 0) s.ducks++;
        if (b.runs > s.hs || (b.runs === s.hs && !b.out)) { s.hs = b.runs; s.hsNo = !b.out; }
        g.bat = { r: b.runs, b: b.balls, out: !!b.out };
        if (b.out) {
          const dis = parseDismissal(b);
          const f = dis.fielder && !SKIP_FIELDERS.has(nameKey(dis.fielder)) ? get(dis.fielder, fldTeam) : null;
          if (f) {
            const gf = line(f);
            if (dis.how === 'caught') { f.field.ct++; gf.ct++; }
            else if (dis.how === 'stumped') { f.field.st++; gf.st++; }
            else if (dis.how === 'run out') { f.field.ro++; gf.ro++; }
          }
          if (dis.bowler && dis.how !== 'run out') {
            const bw = get(dis.bowler, fldTeam);
            bw.bowl.types[['bowled', 'caught', 'lbw', 'stumped'].includes(dis.how) ? dis.how : 'other']++;
          }
        }
      }
      // Batter-vs-bowler match-ups recorded ball by ball (newer matches only)
      for (const [mk, v] of Object.entries(inn.mu || {})) {
        const [bi, ti] = mk.split('|').map(Number);
        const bw = inn.bowlers[bi], bt = inn.batters[ti];
        if (!bw || !bt) continue;
        const add = (rec, other) => {
          const ok = nameKey(other); if (!ok) return;
          const cur = rec.get(ok) || { name: other, balls: 0, runs: 0, dots: 0, f4: 0, f6: 0, outs: 0 };
          ['balls', 'runs', 'dots', 'f4', 'f6', 'outs'].forEach(f => { cur[f] += v[f] || 0; });
          rec.set(ok, cur);
        };
        const rb = get(bt.name, batTeam), rw = get(bw.name, fldTeam);
        if (rb) add(rb.vsBowl, bw.name);
        if (rw) add(rw.vsBat, bt.name);
      }
      for (const w of inn.bowlers) {
        if (!w.balls && !w.runs) continue;
        const r = get(w.name, fldTeam); if (!r) continue;
        const g = line(r), s = r.bowl;
        s.balls += w.balls; s.runs += w.runs; s.wkts += w.wkts; s.maidens += w.maidens; s.dots += w.dots; s.wd += w.wd; s.nb += w.nb;
        if (w.wkts >= 4) s.fourW++;
        if (w.wkts >= 5) s.fiveW++;
        if (s.bestW < 0 || better(w.wkts, w.runs, s.bestW, s.bestR)) { s.bestW = w.wkts; s.bestR = w.runs; }
        g.bowl = { balls: w.balls, r: w.runs, w: w.wkts };
      }
    }
  }
  if (includeBase) {
    for (const [k, b] of Object.entries(base || careerBase())) {
      const r = get(b.name || k);
      if (r) r.base = b;
    }
  }
  for (const r of map.values()) { r.total = combine(r); r.games.sort((a, b) => (b.date || 0) - (a.date || 0)); }
  return map;
}

const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
// Totals = scored matches + earlier stats entered by hand.
// Earlier stats are often incomplete (runs without balls faced, say), so each rate only uses the
// earlier figures that come with what it divides by: strike rate needs balls, economy needs overs.
function combine(r) {
  const b = r.base || {};
  const bb = b.bat || {}, bw = b.bowl || {}, bf = b.field || {};
  const bat = { ...r.bat };
  ['inns', 'no', 'runs', 'balls', 'f4', 'f6', 'dots', 'fifties', 'hundreds', 'ducks'].forEach(k => { bat[k] += n(bb[k]); });
  bat.srRuns = r.bat.runs + (n(bb.balls) > 0 ? n(bb.runs) : 0);
  bat.srBalls = r.bat.balls + (n(bb.balls) > 0 ? n(bb.balls) : 0);
  bat.avgRuns = r.bat.runs + (n(bb.inns) > 0 ? n(bb.runs) : 0);
  bat.baseNoBalls = n(bb.runs) > 0 && !(n(bb.balls) > 0);
  const hsB = String(bb.hs ?? '').match(/^(\d+)(\*)?$/);
  if (hsB && (Number(hsB[1]) > bat.hs || (Number(hsB[1]) === bat.hs && hsB[2]))) { bat.hs = Number(hsB[1]); bat.hsNo = !!hsB[2]; }
  const bowl = { ...r.bowl, types: { ...r.bowl.types } };
  ['balls', 'runs', 'wkts', 'maidens', 'dots', 'wd', 'nb', 'fourW', 'fiveW'].forEach(k => { bowl[k] += n(bw[k]); });
  const hasBalls = n(bw.balls) > 0, hasRuns = bw.runs !== undefined && bw.runs !== '', hasWk = n(bw.wkts) > 0;
  bowl.econRuns = r.bowl.runs + (hasBalls ? n(bw.runs) : 0);
  bowl.econBalls = r.bowl.balls + (hasBalls ? n(bw.balls) : 0);
  bowl.avgRuns = r.bowl.runs + (hasRuns && hasWk ? n(bw.runs) : 0);
  bowl.avgWkts = r.bowl.wkts + (hasRuns && hasWk ? n(bw.wkts) : 0);
  bowl.srBalls = r.bowl.balls + (hasBalls && hasWk ? n(bw.balls) : 0);
  bowl.srWkts = r.bowl.wkts + (hasBalls && hasWk ? n(bw.wkts) : 0);
  bowl.baseNoBalls = n(bw.runs) > 0 && !hasBalls;
  const bestB = String(bw.best ?? '').match(/^(\d+)\s*\/\s*(\d+)$/);
  if (bestB && (bowl.bestW < 0 || better(Number(bestB[1]), Number(bestB[2]), bowl.bestW, bowl.bestR))) { bowl.bestW = Number(bestB[1]); bowl.bestR = Number(bestB[2]); }
  const field = { ct: r.field.ct + n(bf.ct), st: r.field.st + n(bf.st), ro: r.field.ro + n(bf.ro) };
  return { matches: r.matchIds.size + n(b.matches), bat, bowl, field };
}

export function batFigures(s) {
  const dism = s.inns - s.no;
  const runsA = s.avgRuns ?? s.runs, runsS = s.srRuns ?? s.runs, balls = s.srBalls ?? s.balls;
  return {
    avg: dism > 0 ? runsA / dism : null,
    sr: balls > 0 ? runsS / balls * 100 : null,
    hs: s.hs < 0 ? '—' : `${s.hs}${s.hsNo ? '*' : ''}`,
  };
}
export function bowlFigures(s) {
  const eR = s.econRuns ?? s.runs, eB = s.econBalls ?? s.balls, aR = s.avgRuns ?? s.runs, aW = s.avgWkts ?? s.wkts, sB = s.srBalls ?? s.balls, sW = s.srWkts ?? s.wkts;
  return {
    econ: eB > 0 ? eR / (eB / 6) : null,
    avg: aW > 0 ? aR / aW : null,
    sr: sW > 0 ? sB / sW : null,
    best: s.bestW < 0 ? '—' : `${s.bestW}/${s.bestR}`,
  };
}

/* ---------- Milestones ----------
   Walks through finished matches in the order they were played and notes 50s, 100s, four- and
   five-wicket hauls, 50- and 100-run partnerships, and career landmarks (runs, wickets, matches).
   Career landmarks count on from any earlier stats entered by hand. Newest first. */
const RUN_MARKS = [250, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000];
const WKT_MARKS = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500];
const APP_MARKS = [10, 25, 50, 75, 100, 150, 200, 250];
const ORDN = k => { const s = ['th', 'st', 'nd', 'rd'], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); };
export function milestones(matches = finishedMatches(), base = careerBase()) {
  const out = [];
  const tot = new Map();
  const T = k => {
    let t = tot.get(k);
    if (!t) { const b = base[k] || {}; t = { runs: n(b.bat?.runs), wkts: n(b.bowl?.wkts), apps: n(b.matches) }; tot.set(k, t); }
    return t;
  };
  const when = m => m.data.created || m.savedAt || 0;
  const crossed = (from, to, marks) => marks.filter(x => from < x && to >= x);
  [...matches].sort((a, b) => when(a) - when(b)).forEach((m, order) => {
    const d = m.data, date = when(m);
    const ev = (key, name, kind, text, size) => out.push({ key, name, kind, text, size, date, order, matchId: m.id, title: m.title });
    // Who played: squads if entered, otherwise everyone who batted or bowled.
    const played = new Map();
    const add = (name, team) => { const k = nameKey(name); if (k && !played.has(k)) played.set(k, { name: String(name).trim(), team }); };
    (d.squads || []).forEach((sq, t) => (sq || []).forEach(nm => add(nm, t)));
    d.inns.forEach(inn => { inn.batters.forEach(b => add(b.name, inn.bat)); inn.bowlers.forEach(w => { if (w.balls || w.runs) add(w.name, 1 - inn.bat); }); });
    for (const [k, p] of played) {
      const t = T(k), before = t.apps; t.apps++;
      crossed(before, t.apps, APP_MARKS).forEach(x => ev(k, p.name, 'apps', `${p.name} plays a ${ORDN(x)} match`, 1));
    }
    d.inns.forEach(inn => {
      const opp = d.teams[1 - inn.bat], bt = d.teams[inn.bat];
      inn.batters.forEach(b => {
        const k = nameKey(b.name); if (!k) return;
        const sc = `${b.runs}${b.out ? '' : '*'} (${b.balls})`;
        if (b.runs >= 100) ev(k, b.name, '100', `${b.name} ${sc} v ${opp}`, 4);
        else if (b.runs >= 50) ev(k, b.name, '50', `${b.name} ${sc} v ${opp}`, 2);
        const t = T(k), before = t.runs; t.runs += b.runs;
        crossed(before, t.runs, RUN_MARKS).forEach(x => ev(k, b.name, 'runs', `${b.name} passes ${x.toLocaleString('en-US')} career runs`, 3));
      });
      inn.bowlers.forEach(w => {
        const k = nameKey(w.name); if (!k || !(w.balls || w.runs)) return;
        if (w.wkts >= 5) ev(k, w.name, '5w', `${w.name} ${w.wkts}/${w.runs} v ${bt}`, 4);
        else if (w.wkts === 4) ev(k, w.name, '4w', `${w.name} 4/${w.runs} v ${bt}`, 2);
        const t = T(k), before = t.wkts; t.wkts += w.wkts;
        crossed(before, t.wkts, WKT_MARKS).forEach(x => ev(k, w.name, 'wkts', `${w.name} takes a ${ORDN(x)} career wicket`, 3));
      });
      (Array.isArray(inn.parts) ? inn.parts : []).forEach(p => {
        if (p.runs < 50) return;
        const [x, y] = p.p.map(j => inn.batters[j]?.name).filter(Boolean);
        if (!x || !y) return;
        const kind = p.runs >= 100 ? '100p' : '50p';
        ev(nameKey(x) + '|' + nameKey(y), `${x} & ${y}`, kind, `${x} & ${y} add ${p.runs} for the ${ORDN(p.w)} wicket v ${opp}`, p.runs >= 100 ? 3 : 1);
      });
    });
  });
  return out.sort((a, b) => b.date - a.date || b.order - a.order || b.size - a.size);
}