/* Crease — Tournament tab: teams, fixtures, results and a points table with net run rate.
   Results come from matches scored in the live scorer (linked automatically when a fixture is
   scored from here), from a saved match linked by hand, or from scores typed in. */
import { fmtOvers, parseOvers } from '../maths.js';
import { buildRecords, finishedMatches, nameKey } from '../records.js';
import { RENDER, appHooks, showTab } from '../router.js';
import { TIEBREAKS, fixtureOutcome, pointsTable, qualification } from '../stats.js';
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
  return { bat, bowl: used, extras, dnb: XI.slice(n) };
}
function simulateFixture(t, f) {
  if (!f.a || !f.b || isPlayed(f)) return false;
  // About one league match in 30 is washed out.
  if (!f.stage && Math.random() < 0.033) { f.nr = true; f.simNR = true; f.manual = null; f.matchId = null; f.so = null; return true; }
  const O = t.overs || 20, Q = O * 6;
  const rpo = O <= 10 ? 10.5 - (O - 5) * 0.2 : O <= 20 ? 9.5 - (O - 10) * 0.125 : O <= 50 ? 8.25 - (O - 20) * 0.088 : 5.6;
  const mean = rpo * O;
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
    <p class="hint" style="margin:4px 0 0">Simulated result${t.grounds?.[f.a] ? ` at ${esc(t.grounds[f.a])}` : ''}.</p>
    ${order.map(inn).join('')}
    <div class="modal-actions"><button type="button" class="btn" data-x="close">Close</button></div>`, { wide: true });
  $('[data-x="close"]', body).addEventListener('click', () => closeModal());
}
// Players' tournament totals: scored matches (from their scorecards) plus simulated ones.
function leaders(t, linked) {
  const rec = buildRecords(linked, { includeBase: false });
  const map = new Map();
  const get = (name, team) => {
    const k = nameKey(name);
    let r = map.get(k);
    if (!r) { r = { name, teams: new Set(), bat: { inns: 0, runs: 0, balls: 0, f6: 0, hs: 0 }, bowl: { wkts: 0, runs: 0, balls: 0 } }; map.set(k, r); }
    if (team) r.teams.add(team);
    return r;
  };
  rec.forEach(r => {
    const x = get(r.name); r.teams.forEach(tm => x.teams.add(tm));
    x.bat.inns += r.bat.inns; x.bat.runs += r.bat.runs; x.bat.balls += r.bat.balls; x.bat.f6 += r.bat.f6 || 0; x.bat.hs = Math.max(x.bat.hs, r.bat.hs || 0);
    x.bowl.wkts += r.bowl.wkts; x.bowl.runs += r.bowl.runs; x.bowl.balls += r.bowl.balls;
  });
  t.fixtures.forEach(f => {
    const c = f.manual?.sim && f.manual.card;
    if (!c) return;
    ['a', 'b'].forEach(side => {
      const other = side === 'a' ? 'b' : 'a';
      c[side]?.bat.forEach(b => { const x = get(b.name, f[side]); x.bat.inns++; x.bat.runs += b.runs; x.bat.balls += b.balls; x.bat.f6 += b.f6; x.bat.hs = Math.max(x.bat.hs, b.runs); });
      c[side]?.bowl.forEach(b => { const x = get(b.name, f[other]); x.bowl.wkts += b.wkts; x.bowl.runs += b.runs; x.bowl.balls += b.balls; });
    });
  });
  return [...map.values()];
}
// Orders the matches still to play so each team gets the longest possible gap between games.
function spreadSchedule(t) {
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
    <p class="hint" style="margin:-6px 0 12px">One name per line, in batting order${t.impact ? ', 12 per team: the XI and the impact player' : ', 11 per team'}. Add (c) after the captain and (wk) after the keeper. Simulated matches use these names for their scorecards; teams without a squad get numbered players. The live scorer uses the same squads.</p>
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
const busy = (t, f) => live && live.tournament && live.tournament.tid === t.id && live.tournament.fid === f.id && live.status !== 'done';

/* ---------- Render ---------- */
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
    actions = `${f.manual?.card ? `<button type="button" class="btn ghost sm" data-tr="simcard" data-f="${f.id}">Scorecard</button>` : ''}${tie ? `<button type="button" class="btn ghost sm" data-tr="so" data-f="${f.id}">${o.so ? 'Change super over' : 'Super over winner'}</button>` : ''}${o.linked ? `<button type="button" class="btn ghost sm" data-tr="card" data-f="${f.id}">Scorecard</button>` : ''}<button type="button" class="btn ghost sm" data-tr="clear" data-f="${f.id}">Clear result</button>`;
  } else {
    status = pending ? '<span class="badge live" style="font-size:.65rem">Being scored</span>' : o?.error ? `<span class="neg">${esc(o.error)}</span>` : '<span class="dim">Not played yet</span>';
    actions = `<button type="button" class="btn sm" data-tr="score" data-f="${f.id}">${pending ? 'Open scorer' : 'Score live'}</button>
      <button type="button" class="btn ghost sm" data-tr="manual" data-f="${f.id}">Enter result</button>
      <button type="button" class="btn ghost sm" data-tr="link" data-f="${f.id}">Link a saved match</button>
      <button type="button" class="btn ghost sm" data-tr="nr" data-f="${f.id}">No result</button>
      ${pending ? '' : `<button type="button" class="btn ghost sm" data-tr="sim" data-f="${f.id}">Simulate</button>`}`;
  }
  const del = f.stage ? '' : `<button type="button" class="row-del" data-tr="remove" data-f="${f.id}" aria-label="Remove fixture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  return `<div class="fx-row"><div class="fx-main"><span class="fx-no${label.length > 2 ? ' wide' : ''}">${esc(label)}</span><div>${caption || t.grounds?.[f.a] ? `<div class="fx-cap">${esc([caption, t.grounds?.[f.a] && `at ${t.grounds[f.a]}`].filter(Boolean).join(' · '))}</div>` : ''}<div class="fx-teams">${esc(f.a || 'TBC')} <span class="dim">v</span> ${esc(f.b || 'TBC')}</div><div class="fx-status">${status}</div></div></div>
    <div class="fx-acts">${actions}${del}</div></div>`;
}

function qualCard(t, N) {
  const league = t.fixtures.filter(f => !f.stage);
  if (!N || N >= t.teams.length || !league.length) return '';
  const q = qualification(t, finishedMatches(), N);
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
    return `<tr><td class="dim">${r.pos}</td><td class="q-team"><div class="q-head"><b>${esc(r.team)}</b>${chip}</div><div class="q-need">${esc(text)}</div></td><td class="num">${r.pts}</td><td class="num">${r.left}</td></tr>`;
  }).join('');
  return `<div class="card">
    <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">Qualification</h2>
      <label class="check" style="gap:8px">Top <select id="tr-q" class="select" aria-label="Teams that go through">${Array.from({ length: t.teams.length - 1 }, (_, k) => k + 1).map(k => `<option${k === N ? ' selected' : ''}>${k}</option>`).join('')}</select> go through</label></div>
    <div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>#</th><th>Team and what they need</th><th class="num">Pts</th><th class="num">Left</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">${q.remaining ? `Plays out the ${plural(q.remaining, 'remaining league match', 'remaining league matches')} every possible way, each won by one side (ties and no results aren't modelled).` : 'The league is complete.'} Teams level on points at the cut-off are separated by ${tbName}, which these scenarios can't predict${q.exact ? '' : '. With this many matches left, this is a points-only estimate'}.</p>
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
  const linked = t.fixtures.map(f => f.matchId && byId.get(f.matchId)).filter(Boolean);
  const lead = leaders(t, linked);
  const top = (fn, n = 5) => lead.filter(fn.ok).sort(fn.sort).slice(0, n);
  const bats = top({ ok: r => r.bat.inns > 0, sort: (a, b) => b.bat.runs - a.bat.runs || (a.bat.balls - b.bat.balls) });
  const bowls = top({ ok: r => r.bowl.wkts > 0, sort: (a, b) => b.bowl.wkts - a.bowl.wkts || a.bowl.runs - b.bowl.runs });
  const six = top({ ok: r => r.bat.f6 > 0, sort: (a, b) => b.bat.f6 - a.bat.f6 || b.bat.runs - a.bat.runs });
  const hs = top({ ok: r => r.bat.inns > 0, sort: (a, b) => b.bat.hs - a.bat.hs });
  const fxs = league.map((f, k) => fxRow(t, f, String(k + 1), byId)).join('');
  const N = qualifyN(t);
  const leagueLeft = league.filter(f => f.a && f.b && !isPlayed(f) && !busy(t, f)).length;
  const anySim = t.fixtures.some(isSim);
  const tbTxt = TIEBREAKS[t.tiebreak] || TIEBREAKS.nrr;
  main.innerHTML = `
    <div class="card">
      <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">Points table</h2><span class="hint" style="margin:0">${plural(played, 'result')} of ${plural(league.length, 'fixture')} · ${t.overs ? `${t.overs} overs a side` : 'no fixed overs'} · Win ${t.pts.w}, tie ${t.pts.t}, no result ${t.pts.nr}</span></div>
      <div class="tbl-wrap" style="margin-top:0"><table class="tbl pts-tbl"><thead><tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">NR</th><th class="num">Pts</th><th class="num">NRR</th><th></th></tr></thead>
      <tbody>${rows.map((r, k) => `<tr class="${k === 0 && r.p ? 'hl' : ''}${N && k === N - 1 && rows.length > N ? ' q-line' : ''}"><td class="dim">${k + 1}</td><td><b>${esc(r.team)}</b></td><td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.tie}</td><td class="num">${r.nr}</td><td class="num"><b>${r.pts}</b></td><td class="num ${r.nrr == null ? 'dim' : r.nrr >= 0 || Math.abs(r.nrr) < 0.0005 ? 'pos' : 'neg'}">${signed(r.nrr)}</td>
        <td class="num">${r.p - r.nr > 0 ? `<button type="button" class="btn ghost sm" data-tr="nrr" data-team="${esc(r.team)}">NRR solver</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Sorted by points, then ${tbTxt}.${t.tieRule === 'so' ? ' A tie won in a super over counts as a win.' : ''}${N && rows.length > N ? ` The line marks the top ${N}, who go through.` : ''} A side bowled out counts as facing its full ${t.overs ? `${t.overs} overs` : 'quota'}. “NRR solver” opens the Net run rate tab with that team's results, to work out the margin they need.</p>
    </div>
    ${qualCard(t, N)}
    ${ko.length ? koCard(t, ko, byId) : ''}
    <div class="card">
      <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">${ko.length ? 'League fixtures' : 'Fixtures and results'}</h2>
        <div class="head-actions" style="width:auto"><button type="button" class="btn ghost sm" data-tr="squads">Squads</button><button type="button" class="btn ghost sm" data-tr="rr">Add round-robin fixtures</button><button type="button" class="btn ghost sm" data-tr="addfx">Add a fixture</button>${leagueLeft ? `<button type="button" class="btn ghost sm" data-tr="sim-all">Simulate ${leagueLeft === league.length ? 'the league' : `the other ${leagueLeft}`}</button>` : ''}${anySim ? '<button type="button" class="btn ghost sm danger" data-tr="sim-clear">Clear simulated results</button>' : ''}${ko.length || t.teams.length < 2 ? '' : '<button type="button" class="btn ghost sm" data-tr="ko">Set up knockouts</button>'}</div></div>
      ${fxs || '<p class="hint" style="margin:0">No fixtures yet. “Add round-robin fixtures” creates the league: every pair of teams once or twice, or the IPL format with ten teams.</p>'}
      ${t.groups && fxs ? `<p class="hint">Groups: ${t.groups.map((g, k) => `${'AB'[k]}: ${g.map(esc).join(', ')}`).join(' · ')}.</p>` : ''}
      ${fxs ? '<p class="hint">“Simulate” makes up a realistic result instead of scoring the match, which is handy for trying out a tournament. Each one comes with a full scorecard (using the squads, if you add them), and about one in 30 league matches is washed out. Simulated results are marked and can be cleared; scored matches are never touched.</p>' : ''}
    </div>
    <div class="grid-2">
      <div class="card"><h2 class="card-title">Orange Cap · most runs</h2>${bats.length ? `<table class="tbl"><tbody>${bats.map((r, k) => `<tr><td class="dim">${k + 1}</td><td>${esc(r.name)}<div class="dim" style="font-size:.78rem">${esc([...r.teams].join(', '))}</div></td><td class="num"><b>${r.bat.runs}</b></td><td class="num dim">${r.bat.balls ? nf(r.bat.runs / r.bat.balls * 100, 1) : '—'} SR</td></tr>`).join('')}</tbody></table>` : '<p class="hint" style="margin:0">Appears once a match is scored or simulated.</p>'}</div>
      <div class="card"><h2 class="card-title">Purple Cap · most wickets</h2>${bowls.length ? `<table class="tbl"><tbody>${bowls.map((r, k) => `<tr><td class="dim">${k + 1}</td><td>${esc(r.name)}<div class="dim" style="font-size:.78rem">${esc([...r.teams].join(', '))}</div></td><td class="num"><b>${r.bowl.wkts}</b></td><td class="num dim">${r.bowl.balls ? nf(r.bowl.runs / (r.bowl.balls / 6)) : '—'} econ</td></tr>`).join('')}</tbody></table>` : '<p class="hint" style="margin:0">Appears once a match is scored or simulated.</p>'}</div>
    </div>
    ${six.length ? `<div class="grid-2">
      <div class="card"><h2 class="card-title">Most sixes</h2><table class="tbl"><tbody>${six.map((r, k) => `<tr><td class="dim">${k + 1}</td><td>${esc(r.name)}<div class="dim" style="font-size:.78rem">${esc([...r.teams].join(', '))}</div></td><td class="num"><b>${r.bat.f6}</b></td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h2 class="card-title">Highest scores</h2><table class="tbl"><tbody>${hs.map((r, k) => `<tr><td class="dim">${k + 1}</td><td>${esc(r.name)}<div class="dim" style="font-size:.78rem">${esc([...r.teams].join(', '))}</div></td><td class="num"><b>${r.bat.hs}</b></td></tr>`).join('')}</tbody></table></div>
    </div>` : ''}
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
    <label class="check" style="margin-top:12px"><input type="checkbox" id="tf-imp"${t?.impact ? ' checked' : ''}> Impact Player rule: squads of 12, any of them can bat or bowl, only 11 bat</label>
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
  const side = (k, label) => `<p class="modal-sub" style="margin-top:12px">${esc(label)}</p><div class="fields three">
    <div class="field"><div class="lab"><label for="mr-${k}-r">Runs</label></div><input id="mr-${k}-r" type="text" inputmode="numeric" autocomplete="off"></div>
    <div class="field"><div class="lab"><label for="mr-${k}-w">Wickets</label></div><input id="mr-${k}-w" type="text" inputmode="numeric" autocomplete="off"></div>
    <div class="field"><div class="lab"><label for="mr-${k}-o">Overs</label></div><input id="mr-${k}-o" type="text" inputmode="decimal" autocomplete="off" value="${esc(t.overs ?? '')}"></div>
  </div><label class="check" style="margin-top:8px"><input type="checkbox" id="mr-${k}-ao"> All out</label>`;
  const body = openModal(`Enter result: ${f.a} v ${f.b}`, `
    <p class="hint" style="margin:-6px 0 4px">For a match you didn't score in Crease. The higher score wins; equal scores are a tie.</p>
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
    f.manual = { a: A, b: B }; f.matchId = null; f.nr = false; f.simNR = false; f.so = null;
    update(t); closeModal(); RENDER.tournament(); toast('Result saved');
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
    update(t); RENDER.tournament();
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

// League fixtures: every pair once, every pair twice (home and away), or the IPL's 14-match format for ten teams.
function rrForm(t) {
  const n = t.teams.length, ten = n === 10;
  const body = openModal('Add league fixtures', `
    <div class="seg" role="group" aria-label="Format" style="flex-wrap:wrap">
      <button type="button" data-rr="1" aria-pressed="true">Play each other once</button>
      <button type="button" data-rr="2" aria-pressed="false">Twice (home and away)</button>
      ${ten ? '<button type="button" data-rr="ipl" aria-pressed="false">IPL format</button>' : ''}
    </div>
    ${ten ? '<label class="check" id="rr-draw-l" style="margin-top:10px" hidden><input type="checkbox" id="rr-draw" checked> Draw the two groups at random (untick to use the order the teams are listed)</label>' : ''}
    <p class="hint" id="rr-desc"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Add fixtures</button></div>`);
  let mode = '1';
  const desc = () => {
    const draw = $('#rr-draw', body);
    if (draw) $('#rr-draw-l', body).hidden = mode !== 'ipl';
    $('#rr-desc', body).textContent = mode === 'ipl'
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
    if (mode === 'ipl' && hasLeague && t.groups?.flat().length === n && t.groups.flat().every(v => t.teams.includes(v))) order = t.groups.flat();
    else if (mode === 'ipl') {
      if ($('#rr-draw', body)?.checked) order = order.map(v => [Math.random(), v]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
      t.groups = [order.slice(0, 5), order.slice(5)];
    }
    // How many times each pair should meet.
    const times = (i, j) => {
      if (mode !== 'ipl') return Number(mode);
      const gi = i < 5 ? 0 : 1, gj = j < 5 ? 0 : 1;
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
    case 'squads': squadsForm(t); break;
    case 'sim-clear':
      if (await confirmBox('Clear simulated results?', 'Every simulated result goes back to not played. Scored and typed-in results stay.', 'Clear', true)) {
        t.fixtures.forEach(x => { if (x.manual?.sim) { x.manual = null; x.so = null; } if (x.simNR) { x.nr = false; x.simNR = false; } });
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
    case 'nr': if (f) { f.nr = true; f.simNR = false; f.manual = null; f.matchId = null; f.so = null; update(t); RENDER.tournament(); toast('Marked as no result'); } break;
    case 'clear':
      if (f && await confirmBox('Clear this result?', 'The fixture goes back to not played. A linked scorecard stays in Saved matches.', 'Clear result')) {
        f.nr = false; f.simNR = false; f.manual = null; f.matchId = null; f.so = null; update(t); RENDER.tournament();
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