/* Crease — Test championships, run the way the ICC World Test Championship is.
   Teams play bilateral series of two to five Tests. Every Test is worth the same: 12 points for a win,
   6 for a tie, 4 for a draw. The table is ranked by the percentage of the points contested that a team
   has won, so sides that play different numbers of Tests can be compared. Points are taken off for slow
   over rates. The top two meet in a one-off final; a drawn or tied final means joint champions. */
import { finishedMatches } from '../records.js';
import { closeModal, confirmBox, openModal, toast } from '../ui.js';
import { $, esc, nf, plural, uid } from '../utils.js';

export const isTestTour = t => !!t && t.kind === 'test';
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const PTS = { w: 12, t: 6, d: 4 };
const ptsOf = t => ({ ...PTS, ...(t.pts || {}) });

/* ---------- The 2025–27 cycle ----------
   27 series and 71 Tests, in the order they're scheduled. Each side plays six series, three at home.
   Each Test has its first day and ground where they've been announced (from the season pages on
   Wikipedia, October 2026); series still to be scheduled have none. */
const WTC_TEAMS = ['Australia', 'Bangladesh', 'England', 'India', 'New Zealand', 'Pakistan', 'South Africa', 'Sri Lanka', 'West Indies'];
const WTC_SERIES = [
    ['Sri Lanka', 'Bangladesh', 2, 'Jun 2025', '', [['2025-06-17', 'Galle International Stadium, Galle'], ['2025-06-25', 'Sinhalese Sports Club Ground, Colombo']]],
    ['England', 'India', 5, 'Jun–Aug 2025', 'Anderson–Tendulkar Trophy', [['2025-06-20', 'Headingley, Leeds'], ['2025-07-02', 'Edgbaston, Birmingham'], ['2025-07-10', "Lord's, London"], ['2025-07-23', 'Old Trafford, Manchester'], ['2025-07-31', 'The Oval, London']]],
    ['West Indies', 'Australia', 3, 'Jun–Jul 2025', 'Frank Worrell Trophy', [['2025-06-25', 'Kensington Oval, Bridgetown'], ['2025-07-03', "National Cricket Stadium, St George's"], ['2025-07-12', 'Sabina Park, Kingston']]],
    ['India', 'West Indies', 2, 'Oct 2025', '', [['2025-10-02', 'Narendra Modi Stadium, Ahmedabad'], ['2025-10-10', 'Arun Jaitley Stadium, Delhi']]],
    ['Pakistan', 'South Africa', 2, 'Oct 2025', '', [['2025-10-12', 'Gaddafi Stadium, Lahore'], ['2025-10-20', 'Rawalpindi Cricket Stadium, Rawalpindi']]],
    ['India', 'South Africa', 2, 'Nov 2025', '', [['2025-11-14', 'Eden Gardens, Kolkata'], ['2025-11-22', 'Assam Cricket Association Stadium, Guwahati']]],
    ['Australia', 'England', 5, 'Nov 2025–Jan 2026', 'The Ashes', [['2025-11-21', 'Perth Stadium, Perth'], ['2025-12-04', 'The Gabba, Brisbane'], ['2025-12-17', 'Adelaide Oval, Adelaide'], ['2025-12-26', 'Melbourne Cricket Ground, Melbourne'], ['2026-01-04', 'Sydney Cricket Ground, Sydney']]],
    ['New Zealand', 'West Indies', 3, 'Dec 2025', '', [['2025-12-02', 'Hagley Oval, Christchurch'], ['2025-12-10', 'Basin Reserve, Wellington'], ['2025-12-18', 'Bay Oval, Mount Maunganui']]],
    ['Bangladesh', 'Pakistan', 2, 'May 2026', '', [['2026-05-08', 'Sher-e-Bangla National Stadium, Dhaka'], ['2026-05-16', 'Sylhet International Cricket Stadium, Sylhet']]],
    ['England', 'New Zealand', 3, 'Jun 2026', '', [['2026-06-04', "Lord's, London"], ['2026-06-17', 'The Oval, London'], ['2026-06-25', 'Trent Bridge, Nottingham']]],
    ['West Indies', 'Sri Lanka', 2, 'Jun–Jul 2026', 'Sobers–Tissera Trophy', [['2026-06-25', 'Sir Vivian Richards Stadium, North Sound'], ['2026-07-03', 'Sir Vivian Richards Stadium, North Sound']]],
    ['West Indies', 'Pakistan', 2, 'Jul–Aug 2026', '', [['2026-07-25', 'Brian Lara Cricket Academy, Trinidad'], ['2026-08-02', "Queen's Park Oval, Port of Spain"]]],
    ['Australia', 'Bangladesh', 2, 'Aug 2026', '', [['2026-08-13', 'Marrara Oval, Darwin'], ['2026-08-22', 'Great Barrier Reef Arena, Mackay']]],
    ['Sri Lanka', 'India', 2, 'Aug 2026', '', [['2026-08-15', 'Galle International Stadium, Galle'], ['2026-08-23', 'Sinhalese Sports Club Ground, Colombo']]],
    ['England', 'Pakistan', 3, 'Aug–Sep 2026', '', [['2026-08-19', 'Headingley, Leeds'], ['2026-08-27', "Lord's, London"], ['2026-09-09', 'Edgbaston, Birmingham']]],
    ['South Africa', 'Australia', 3, 'Oct 2026', '', [['2026-10-09', 'Kingsmead, Durban'], ['2026-10-18', "St George's Park, Gqeberha"], ['2026-10-27', 'Newlands, Cape Town']]],
    ['Bangladesh', 'West Indies', 2, 'Oct–Nov 2026', '', [['2026-10-28', 'Sher-e-Bangla National Stadium, Dhaka'], ['2026-11-05', 'Sylhet International Cricket Stadium, Sylhet']]],
    ['Pakistan', 'Sri Lanka', 2, 'Nov 2026', '', [['2026-11-09', 'Rawalpindi Cricket Stadium, Rawalpindi'], ['2026-11-17', 'Gaddafi Stadium, Lahore']]],
    ['South Africa', 'Bangladesh', 2, 'Nov 2026', '', [['2026-11-15', 'Wanderers Stadium, Johannesburg'], ['2026-11-23', 'Centurion Park, Centurion']]],
    ['New Zealand', 'India', 2, 'Nov–Dec 2026', '', [['2026-11-19', 'Basin Reserve, Wellington'], ['2026-11-27', 'Hagley Oval, Christchurch']]],
    ['Australia', 'New Zealand', 4, 'Dec 2026–Jan 2027', 'Trans-Tasman Trophy', [['2026-12-09', 'Perth Stadium, Perth'], ['2026-12-17', 'Adelaide Oval, Adelaide'], ['2026-12-26', 'Melbourne Cricket Ground, Melbourne'], ['2027-01-04', 'Sydney Cricket Ground, Sydney']]],
    ['South Africa', 'England', 3, 'Dec 2026–Jan 2027', 'Basil D’Oliveira Trophy', [['2026-12-17', 'Wanderers Stadium, Johannesburg'], ['2026-12-26', 'Centurion Park, Centurion'], ['2027-01-03', 'Newlands, Cape Town']]],
    ['India', 'Australia', 5, 'Jan–Mar 2027', 'Border–Gavaskar Trophy', [['2027-01-21', 'Vidarbha Cricket Association Stadium, Nagpur'], ['2027-01-29', 'M. A. Chidambaram Stadium, Chennai'], ['2027-02-11', 'Assam Cricket Association Stadium, Guwahati'], ['2027-02-19', 'JSCA International Stadium, Ranchi'], ['2027-02-27', 'Narendra Modi Stadium, Ahmedabad']]],
    ['New Zealand', 'Sri Lanka', 2, 'Feb 2027', '', [['2027-02-04', 'Bay Oval, Mount Maunganui'], ['2027-02-12', 'Seddon Park, Hamilton']]],
    ['Bangladesh', 'England', 2, 'Feb 2027'],
    ['Sri Lanka', 'South Africa', 2, 'Feb–Mar 2027'],
    ['Pakistan', 'New Zealand', 2, 'Mar 2027'],
];
const mkTest = (s, no) => ({ id: uid(), series: s.id, no, a: s.home, b: s.away, matchId: null, manual: null, nr: false });
const withWhen = (f, d) => { if (d) { f.date = d[0]; f.venue = d[1]; } return f; };
export function wtcTemplate() {
    const series = WTC_SERIES.map(([home, away, tests, when, trophy]) => ({ id: uid(), home, away, tests, when, ...(trophy ? { trophy } : {}) }));
    const fixtures = series.flatMap((s, k) => Array.from({ length: s.tests }, (_, n) => withWhen(mkTest(s, n + 1), WTC_SERIES[k][5]?.[n])));
    fixtures.push({ id: uid(), stage: 'F', a: null, b: null, matchId: null, manual: null, nr: false, venue: 'The Oval, London', date: '2027-06-09', reserve: true });
    return { id: uid(), created: Date.now(), kind: 'test', name: 'World Test Championship 2025–27', teams: WTC_TEAMS.slice(), pts: { ...PTS }, series, fixtures, overRate: true, sched: 2 };
}
// A championship made from the earlier template (no dates or grounds): fill in the ones announced since,
// without touching anything already set, and put the series in date order. Runs once.
export function updateSchedule(t) {
    if (!isTestTour(t) || t.sched >= 2 || !t.series || t.series.length !== WTC_SERIES.length) return false;
    const key = (h, a) => `${h}|${a}`.toLowerCase();
    const tpl = new Map(WTC_SERIES.map((r, k) => [key(r[0], r[1]), { r, k }]));
    if (!t.series.every(s => tpl.has(key(s.home, s.away)))) { t.sched = 2; return true; }
    t.series.forEach(s => {
        const { r } = tpl.get(key(s.home, s.away));
        const old = WTC_OLD_WHEN[key(s.home, s.away)];
        if (r[3] && (!s.when || s.when === old)) s.when = r[3];
        t.fixtures.filter(f => f.series === s.id).forEach(f => {
            const d = r[5]?.[f.no - 1];
            if (!d) return;
            if (!f.date) f.date = d[0];
            if (!f.venue) f.venue = d[1];
        });
    });
    t.series.sort((x, y) => tpl.get(key(x.home, x.away)).k - tpl.get(key(y.home, y.away)).k);
    t.sched = 2;
    return true;
}
// The months the first version of the template gave, so they're only replaced if nobody changed them.
const WTC_OLD_WHEN = { 'bangladesh|pakistan': 'Mar 2026', 'west indies|sri lanka': 'Jun 2026', 'south africa|australia': 'Sep–Oct 2026', 'bangladesh|west indies': 'Oct 2026', 'new zealand|india': 'Oct 2026', 'australia|new zealand': 'Dec 2026', 'south africa|england': 'Dec 2026', 'new zealand|sri lanka': 'Jan 2027', 'india|australia': 'Jan–Feb 2027' };
// An empty Test championship: the teams, then series added one at a time.
export function blankTestTour(name, teams) {
    return { id: uid(), created: Date.now(), kind: 'test', name, teams, pts: { ...PTS }, series: [], fixtures: [{ id: uid(), stage: 'F', a: null, b: null, matchId: null, manual: null, nr: false, reserve: true }], overRate: true };
}

/* ---------- Results ----------
   A Test's result: { res: 'a' | 'b' | 'd' | 't', text } or null if not played. A Test abandoned without a
   result counts as a draw, as in the championship. */
const marginTxt = m => (m.how === 'inns' ? `an innings and ${plural(m.n, 'run')}` : m.how === 'wkts' ? plural(m.n, 'wicket') : plural(m.n, 'run'));
export function testOutcome(f, byId) {
    if (f.nr) return { res: 'd', text: 'Abandoned (counts as a draw)', abandoned: true };
    if (f.matchId) {
        const m = byId.get(f.matchId);
        if (!m || m.data.status !== 'done') return null;
        const d = m.data;
        if (d.matchType !== 'test') return { error: 'The linked match isn\'t a Test (two innings each).' };
        const r = String(d.result || '');
        if (/^Match drawn|^No result/i.test(r)) return { res: 'd', text: r || 'Match drawn', linked: m };
        if (/^Match tied/i.test(r)) return { res: 't', text: r, linked: m };
        const w = d.teams.find(n => r.toLowerCase().startsWith(`${String(n).toLowerCase()} won`));
        if (!w) return { error: 'Can\'t tell who won the linked match.' };
        if (!same(w, f.a) && !same(w, f.b)) return { error: 'The linked match has different team names.' };
        return { res: same(w, f.a) ? 'a' : 'b', text: r, linked: m };
    }
    if (f.manual) {
        const m = f.manual, W = m.res === 'a' ? f.a : f.b;
        const text = m.res === 'd' ? 'Match drawn' : m.res === 't' ? 'Match tied' : `${W} won${m.n ? ` by ${marginTxt(m)}` : ''}`;
        return { res: m.res, text };
    }
    return null;
}
const played = (f, byId) => { const o = testOutcome(f, byId); return !!o && !o.error; };
const isSim = f => !!(f.manual?.sim || f.simNR);
const byIdNow = () => new Map(finishedMatches().map(m => [m.id, m]));

/* ---------- The table ---------- */
// Series score from the Tests played so far, and the winner once every Test is done.
export function seriesState(t, s, byId) {
    const tests = t.fixtures.filter(f => f.series === s.id);
    let h = 0, a = 0, done = 0;
    tests.forEach(f => { const o = testOutcome(f, byId); if (!o || o.error) return; done++; if (o.res === 'a') (same(f.a, s.home) ? h++ : a++); if (o.res === 'b') (same(f.b, s.home) ? h++ : a++); });
    const complete = tests.length > 0 && done === tests.length;
    return { h, a, done, total: tests.length, complete, winner: complete && h !== a ? (h > a ? s.home : s.away) : null };
}
export function testTable(t, byId = byIdNow()) {
    const P = ptsOf(t);
    const rows = new Map(t.teams.map((n, k) => [n, { team: n, rank: k, m: 0, w: 0, l: 0, d: 0, t: 0, ded: 0, pts: 0, max: 0, sw: 0, ap: 0, am: 0, left: 0 }]));
    const row = n => [...rows.values()].find(r => same(r.team, n));
    t.fixtures.filter(f => !f.stage).forEach(f => {
        const A = row(f.a), B = row(f.b);
        if (!A || !B) return;
        const o = testOutcome(f, byId);
        if (!o || o.error) { A.left++; B.left++; return; }
        const give = (r, kind, away) => {
            const p = kind === 'w' ? P.w : kind === 't' ? P.t : kind === 'd' ? P.d : 0;
            r.m++; r[kind]++; r.pts += p; r.max += P.w;
            if (away) { r.ap += p; r.am += P.w; }
        };
        const kA = o.res === 'a' ? 'w' : o.res === 'b' ? 'l' : o.res, kB = o.res === 'b' ? 'w' : o.res === 'a' ? 'l' : o.res;
        give(A, kA, false); give(B, kB, true); // the first-named side is at home
        const pen = f.pen || {};
        if (pen.a) { A.ded += pen.a; A.pts -= pen.a; }
        if (pen.b) { B.ded += pen.b; B.pts -= pen.b; B.ap -= pen.b; }
    });
    (t.series || []).forEach(s => { const st = seriesState(t, s, byId); if (st.winner) { const r = row(st.winner); if (r) r.sw++; } });
    const out = [...rows.values()];
    out.forEach(r => { r.pct = r.max ? r.pts / r.max * 100 : null; r.apct = r.am ? r.ap / r.am * 100 : null; });
    // Percentage, then series won, then percentage away from home, then the order the teams are listed in (their ranking).
    const n = v => (v == null ? -1 : v);
    out.sort((x, y) => n(y.pct) - n(x.pct) || y.sw - x.sw || n(y.apct) - n(x.apct) || x.rank - y.rank);
    return out;
}

/* ---------- Simulation ---------- */
const normal = () => { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); };
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function strength(t, team) {
    t.sim = t.sim || {};
    if (t.sim[team] == null) t.sim[team] = Math.round(normal() * 45) / 100;
    return t.sim[team];
}
// Chances for a Test: draws about one in six, a home side wins more often, the stronger side more often still.
function odds(home, away, edge = 0.45) {
    const pd = 0.16, pt = 0.002;
    const ph = (1 - pd - pt) / (1 + Math.exp(-(home - away + edge) * 1.7));
    return { ph, pd, pt };
}
function rollTest(ph, pd, pt) {
    const u = Math.random();
    return u < ph ? 'a' : u < ph + pd ? 'd' : u < ph + pd + pt ? 't' : 'b';
}
function simulateTest(t, f) {
    if (!f.a || !f.b || played(f, byIdNow())) return false;
    if (Math.random() < 0.02) { f.nr = true; f.simNR = true; return true; }
    const { ph, pd, pt } = odds(strength(t, f.a), strength(t, f.b), f.stage ? 0 : 0.45); // the final is at a neutral ground
    const res = rollTest(ph, pd, pt);
    const m = { res, sim: true };
    if (res === 'a' || res === 'b') {
        const u = Math.random();
        if (u < 0.2) Object.assign(m, { how: 'inns', n: rint(1, 220) });
        else if (u < 0.6) Object.assign(m, { how: 'runs', n: Math.round(15 + Math.random() ** 1.6 * 380) });
        else Object.assign(m, { how: 'wkts', n: [2, 3, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10][rint(0, 13)] });
    }
    f.manual = m; f.matchId = null; f.nr = false;
    return true;
}

/* ---------- The final ---------- */
const leagueOf = t => t.fixtures.filter(f => !f.stage);
const finalOf = t => t.fixtures.find(f => f.stage === 'F');
// The two finalists are the top two once every league Test is done. Until the final is played they follow the table.
function syncFinal(t, rows, byId) {
    const fin = finalOf(t);
    if (!fin || played(fin, byId) || fin.matchId) return false;
    const done = leagueOf(t).every(f => played(f, byId));
    const a = done && rows[0]?.m ? rows[0].team : null, b = done && rows[1]?.m ? rows[1].team : null;
    if (fin.a === a && fin.b === b) return false;
    fin.a = a; fin.b = b;
    return true;
}

/* ---------- Race to the final ----------
   The best and worst a team can still finish on, and the chance of a top-two finish from playing the rest
   of the league out many times (better sides so far win more often, and home sides have an edge). */
function race(t, rows, byId) {
    const P = ptsOf(t);
    const rem = leagueOf(t).filter(f => f.a && f.b && !played(f, byId));
    const idx = new Map(rows.map((r, k) => [r.team, k]));
    const best = rows.map(r => { const m = r.max + r.left * P.w; return m ? (r.pts + r.left * P.w) / m * 100 : null; });
    const worst = rows.map(r => { const m = r.max + r.left * P.w; return m ? r.pts / m * 100 : null; });
    const form = rows.map(r => (r.pct == null ? 0 : (r.pct - 50) / 45));
    const N = 4000, top = rows.map(() => 0);
    const pts = new Float64Array(rows.length), max = new Float64Array(rows.length);
    const games = rem.map(f => { const a = idx.get(f.a), b = idx.get(f.b); return a == null || b == null ? null : { a, b, ...odds(form[a], form[b]) }; }).filter(Boolean);
    for (let n = 0; n < N; n++) {
        rows.forEach((r, k) => { pts[k] = r.pts; max[k] = r.max; });
        for (const g of games) {
            const res = rollTest(g.ph, g.pd, g.pt);
            max[g.a] += P.w; max[g.b] += P.w;
            if (res === 'a') pts[g.a] += P.w; else if (res === 'b') pts[g.b] += P.w;
            else { const p = res === 'd' ? P.d : P.t; pts[g.a] += p; pts[g.b] += p; }
        }
        // Ties on percentage are rare; random order settles them here.
        const order = rows.map((_, k) => ({ k, v: max[k] ? pts[k] / max[k] + Math.random() * 1e-9 : -1 })).sort((x, y) => y.v - x.v);
        top[order[0].k]++; top[order[1].k]++;
    }
    return rows.map((r, k) => {
        const others = rows.map((_, q) => q).filter(q => q !== k);
        const through = !rem.length ? k < 2 : others.filter(q => best[q] != null && best[q] >= (worst[k] ?? 0)).length < 2;
        const out = !rem.length ? k >= 2 : others.filter(q => worst[q] != null && worst[q] > (best[k] ?? 100)).length >= 2;
        return { team: r.team, best: best[k], worst: worst[k], chance: top[k] / N, through, out, left: r.left };
    });
}

/* ---------- Rendering ---------- */
const dateTxt = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${Number(m[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}` : ''; };
const p2 = v => (v == null ? '—' : nf(v, 2));
const chanceTxt = (v, sure, never) => (sure ? '100%' : never ? '0%' : v >= 0.995 ? '>99%' : v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`);
const openSeries = new Map(); // series the viewer has opened or closed this visit: id → open

function testRow(t, f, byId, busy) {
    const o = testOutcome(f, byId);
    const pen = f.pen || {};
    const penTxt = [pen.a ? `${f.a} −${pen.a}` : '', pen.b ? `${f.b} −${pen.b}` : ''].filter(Boolean).join(', ');
    let status, acts;
    if (!f.a || !f.b) {
        status = '<span class="dim">The top two in the table, once every league Test is done</span>';
        acts = '';
    } else if (o && !o.error) {
        status = `<span class="${o.res === 'd' ? 'dim' : ''}">${esc(o.text)}</span>${isSim(f) ? ' <span class="chip r1" style="font-size:.65rem">Simulated</span>' : ''}${penTxt ? `<div class="fx-pom">Over-rate deduction: ${esc(penTxt)} ${pen.a + pen.b === 1 ? 'point' : 'points'}</div>` : ''}`;
        acts = `${o.linked ? `<button type="button" class="btn ghost sm" data-tr="card" data-f="${f.id}">Scorecard</button>` : ''}${f.manual ? `<button type="button" class="btn ghost sm" data-tr="w-manual" data-f="${f.id}">Edit result</button>` : ''}${isSim(f) ? `<button type="button" class="btn ghost sm" data-tr="w-resim" data-f="${f.id}">Simulate again</button>` : ''}${f.stage ? '' : `<button type="button" class="btn ghost sm" data-tr="w-pen" data-f="${f.id}">Over-rate penalty</button>`}<button type="button" class="btn ghost sm" data-tr="clear" data-f="${f.id}">Clear result</button>`;
    } else {
        status = busy(f) ? '<span class="badge live" style="font-size:.65rem">Being scored</span>' : o?.error ? `<span class="neg">${esc(o.error)}</span>` : '<span class="dim">Not played yet</span>';
        acts = `<button type="button" class="btn sm" data-tr="score" data-f="${f.id}">${busy(f) ? 'Open scorer' : 'Score live'}</button>
      <button type="button" class="btn ghost sm" data-tr="w-manual" data-f="${f.id}">Enter result</button>
      <button type="button" class="btn ghost sm" data-tr="link" data-f="${f.id}">Link a saved match</button>
      <button type="button" class="btn ghost sm" data-tr="w-nr" data-f="${f.id}">Abandoned</button>
      ${busy(f) ? '' : `<button type="button" class="btn ghost sm" data-tr="w-sim" data-f="${f.id}">Simulate</button>`}`;
    }
    acts += `<button type="button" class="btn ghost sm" data-tr="w-when" data-f="${f.id}">Date and ground</button>`;
    const cap = [dateTxt(f.date), f.venue && `at ${f.venue}`].filter(Boolean).join(' · ');
    const label = f.stage ? 'F' : String(f.no);
    return `<div class="fx-row"><div class="fx-main"><span class="fx-no">${esc(label)}</span><div>${cap ? `<div class="fx-cap">${esc(cap)}</div>` : ''}<div class="fx-teams">${f.stage ? 'Final: ' : `${esc(ordinal(f.no))} Test: `}${esc(f.a || 'TBC')} <span class="dim">v</span> ${esc(f.b || 'TBC')}</div><div class="fx-status">${status}</div></div></div><div class="fx-acts">${acts}</div></div>`;
}
const ordinal = n => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

function seriesScore(s, st) {
    if (!st.done) return `${plural(st.total, 'Test')} · not started`;
    const lead = st.h === st.a ? null : st.h > st.a ? s.home : s.away, hi = Math.max(st.h, st.a), lo = Math.min(st.h, st.a);
    if (st.complete) return lead ? `${lead} won ${hi}–${lo}` : `Series drawn ${st.h}–${st.a}`;
    return `${lead ? `${lead} lead ${hi}–${lo}` : `Level ${st.h}–${st.a}`} after ${st.done} of ${st.total}`;
}

export function renderTestTour(t, main, { busy, persist }) {
    const byId = byIdNow();
    const sch = updateSchedule(t);
    let rows = testTable(t, byId);
    if (syncFinal(t, rows, byId) || sch) persist();
    const P = ptsOf(t);
    const league = leagueOf(t), fin = finalOf(t);
    const done = league.filter(f => played(f, byId)).length;
    const R = race(t, rows, byId);
    const anySim = t.fixtures.some(isSim);
    const left = league.filter(f => !played(f, byId) && !busy(f)).length;
    // The final's result and the champions.
    let champ = '';
    const fo = fin && fin.a && fin.b ? testOutcome(fin, byId) : null;
    if (fo && !fo.error) champ = fo.res === 'a' || fo.res === 'b'
        ? `<div class="champ"><span>Champions</span><b>${esc(fo.res === 'a' ? fin.a : fin.b)}</b><em>${esc(fo.text)}</em></div>`
        : `<div class="champ"><span>Final ${fo.res === 't' ? 'tied' : 'drawn'}</span><b>${esc(fin.a)} and ${esc(fin.b)}</b><em>Joint champions</em></div>`;
    const nextIn = (t.series || []).findIndex(s => !seriesState(t, s, byId).complete);
    const seriesHTML = (t.series || []).map((s, k) => {
        const st = seriesState(t, s, byId);
        const tests = t.fixtures.filter(f => f.series === s.id).sort((x, y) => x.no - y.no);
        const def = (st.done > 0 && !st.complete) || k === nextIn;
        const open = openSeries.has(s.id) ? openSeries.get(s.id) : def;
        const del = st.done ? '' : `<button type="button" class="btn ghost sm danger" data-tr="w-sdel" data-s="${s.id}">Remove series</button>`;
        return `<details class="fold w-series" data-s="${s.id}"${open ? ' open' : ''}><summary><span class="w-s-name"><b>${esc(s.home)} v ${esc(s.away)}</b>${s.trophy ? ` <span class="dim">· ${esc(s.trophy)}</span>` : ''}</span><span class="fold-peek" style="display:block">${esc(seriesScore(s, st))}${s.when ? ` · ${esc(s.when)}` : ''}</span></summary>
      ${tests.map(f => testRow(t, f, byId, busy)).join('')}
      <div class="fx-acts" style="margin-top:6px">${del}<button type="button" class="btn ghost sm" data-tr="w-sedit" data-s="${s.id}">Edit series</button></div></details>`;
    }).join('');
    const hasDed = rows.some(r => r.ded);
    main.innerHTML = `
    <div class="card">
      <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">Standings</h2><span class="hint" style="margin:0;flex-basis:100%">${plural(done, 'Test')} played of ${league.length} · ${plural((t.series || []).length, 'series', 'series')} · Win ${P.w}, tie ${P.t}, draw ${P.d}, loss 0</span></div>
      <div class="tbl-wrap" style="margin-top:0"><table class="tbl pts-tbl"><thead><tr><th>#</th><th>Team</th><th class="num">M</th><th class="num">W</th><th class="num">L</th><th class="num">D</th><th class="num">T</th>${hasDed ? '<th class="num">Ded</th>' : ''}<th class="num">Pts</th><th class="num">PCT</th><th class="num" title="Series won">SW</th></tr></thead>
      <tbody>${rows.map((r, k) => `<tr class="${k === 0 && r.m ? 'hl' : ''}${k === 1 && rows.length > 2 ? ' q-line' : ''}"><td class="dim">${k + 1}</td><td><button type="button" class="tr-link" data-tr="w-team" data-team="${esc(r.team)}"><b>${esc(r.team)}</b></button></td><td class="num">${r.m}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.d}</td><td class="num">${r.t}</td>${hasDed ? `<td class="num ${r.ded ? 'neg' : 'dim'}">${r.ded ? `−${r.ded}` : '0'}</td>` : ''}<td class="num">${r.pts}</td><td class="num"><b>${p2(r.pct)}</b></td><td class="num">${r.sw}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Ranked by PCT, the percentage of the points contested that a team has won: ${P.w} for every Test played, so a side that plays fewer Tests isn't held back. ${t.overRate ? 'A side behind the required over rate loses one point for every over it was short (none if it bowled the other side out inside 80 overs). ' : ''}SW is series won. Level on PCT, the order is decided by series won, then PCT in away Tests, then the ICC Test rankings (the order the teams are listed in under Edit). A Test abandoned without a result counts as a draw. The line marks the top two, who play the final.</p>
    </div>
    <div class="card">
      <h2 class="card-title">Race to the final</h2>
      <div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>Team</th><th class="num">Tests left</th><th class="num">Best PCT</th><th class="num">Worst PCT</th><th class="num">Final chance</th></tr></thead>
      <tbody>${R.map(r => `<tr><td><b>${esc(r.team)}</b> ${r.through ? '<span class="chip r2">In the final</span>' : r.out ? '<span class="chip r0">Out</span>' : ''}</td><td class="num">${r.left}</td><td class="num">${p2(r.best)}</td><td class="num">${p2(r.worst)}</td><td class="num"><b>${chanceTxt(r.chance, r.through, r.out)}</b></td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Best and worst PCT: winning or losing every Test left (over-rate deductions to come aren't counted). The chances come from playing the rest of the cycle out 4,000 times: sides with the better record so far win more often, home sides have an edge, and about one Test in six is drawn.</p>
    </div>
    <div class="card">
      <h2 class="card-title">Final</h2>
      ${champ}
      ${fin ? testRow(t, fin, byId, busy) : ''}
      <p class="hint">A one-off Test between the top two${fin?.venue ? `, at ${esc(fin.venue)}` : ''}${fin?.date ? ` from ${esc(dateTxt(fin.date))}` : ''}. It has a reserve sixth day to make up time lost during the match. If the final is drawn or tied, the two sides are joint champions. The final doesn't count in the standings.${!fin?.a && rows[1]?.m ? ` If the league ended now: ${esc(rows[0].team)} v ${esc(rows[1].team)}.` : ''}</p>
    </div>
    <div class="card">
      <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">Series</h2>
        <div class="head-actions" style="width:auto"><button type="button" class="btn ghost sm" data-tr="squads">Squads</button><button type="button" class="btn ghost sm" data-tr="w-sadd">Add a series</button>${left ? `<button type="button" class="btn ghost sm" data-tr="w-simall">Simulate ${left === league.length ? 'the cycle' : `the other ${left}`}</button>` : ''}${anySim ? '<button type="button" class="btn ghost sm danger" data-tr="w-simclear">Clear simulated results</button>' : ''}</div></div>
      ${seriesHTML || '<p class="hint" style="margin:0">No series yet. “Add a series” sets the home side, the visitors and the number of Tests.</p>'}
      <p class="hint">Each series is listed home side first. Tap a series to open or close it. “Score live” opens a Test in the live scorer; the result comes back here when it's finished. “Simulate” makes up a result (about one Test in 50 is washed out). Simulated results are marked and can be cleared.</p>
    </div>
    ${statsHTML(t, byId)}`;
}

/* ---------- Player and team stats ----------
   From the Tests scored in Crease (or linked from Saved matches), the final included. Results entered by hand or
   simulated have no scorecard, so they add nothing here. Players are told apart by team and name. */
const oversTxt = b => `${Math.floor(b / 6)}${b % 6 ? `.${b % 6}` : ''}`;
function testStats(t, byId) {
    const P = new Map(), inns = [], spells = [], matchFigs = [], totals = [];
    const get = (team, name) => {
        const k = `${team}|${name}`.toLowerCase();
        let x = P.get(k);
        if (!x) { x = { key: k, name, team, tests: new Set(), inns: 0, no: 0, runs: 0, balls: 0, f4: 0, f6: 0, hs: -1, hsNo: false, n50: 0, n100: 0, bb: 0, br: 0, bw: 0, w5: 0, w10: 0, ct: 0, st: 0, ro: 0 }; P.set(k, x); }
        return x;
    };
    t.fixtures.forEach(f => {
        const m = f.matchId && byId.get(f.matchId);
        const d = m?.data;
        if (!d || !Array.isArray(d.inns)) return;
        const mw = new Map(); // wickets and runs in the whole match, by bowler
        d.inns.filter(i => !i.so).forEach((i, n) => {
            const bt = d.teams[i.bat], bw = d.teams[1 - i.bat];
            totals.push({ team: bt, opp: bw, runs: i.runs, wkts: i.wkts, balls: i.balls, dec: i.ended === 'declared', n, f });
            i.batters.forEach(b => {
                if (!b.balls && !b.out && !b.runs) return; // did not bat
                const x = get(bt, b.name);
                x.tests.add(f.id); x.inns++; if (!b.out) x.no++;
                x.runs += b.runs; x.balls += b.balls; x.f4 += b.f4 || 0; x.f6 += b.f6 || 0;
                if (b.runs >= 100) x.n100++; else if (b.runs >= 50) x.n50++;
                if (b.runs > x.hs || (b.runs === x.hs && !b.out)) { x.hs = b.runs; x.hsNo = !b.out; }
                inns.push({ name: b.name, team: bt, opp: bw, r: b.runs, b: b.balls, out: !!b.out });
                const dis = b.dis;
                if (b.out && dis && dis.fielder && ['caught', 'stumped', 'run out'].includes(dis.how)) {
                    const fx = get(bw, dis.fielder.trim()); fx.tests.add(f.id);
                    if (dis.how === 'caught') fx.ct++; else if (dis.how === 'stumped') fx.st++; else fx.ro++;
                }
            });
            i.bowlers.forEach(b => {
                if (!b.balls && !b.runs) return;
                const x = get(bw, b.name);
                x.tests.add(f.id); x.bb += b.balls; x.br += b.runs; x.bw += b.wkts;
                if (b.wkts >= 5) x.w5++;
                spells.push({ name: b.name, team: bw, opp: bt, w: b.wkts, r: b.runs, balls: b.balls });
                const k = x.key, y = mw.get(k) || { name: b.name, team: bw, opp: bt, w: 0, r: 0 };
                y.w += b.wkts; y.r += b.runs; mw.set(k, y);
            });
        });
        mw.forEach((y, k) => { matchFigs.push(y); if (y.w >= 10) P.get(k).w10++; });
    });
    return { players: [...P.values()], inns, spells, matchFigs, totals, tests: t.fixtures.filter(f => f.matchId && byId.get(f.matchId)?.data).length };
}
function statBoard(title, rows, val, sub, note = '') {
    return `<div class="card"><h2 class="card-title">${esc(title)}</h2>${rows.length
        ? `<table class="tbl"><tbody>${rows.map((r, k) => `<tr><td class="dim">${k + 1}</td><td>${esc(r.name)}<div class="dim" style="font-size:.78rem">${esc(r.team)}</div></td><td class="num"><b>${val(r)}</b></td><td class="num dim" style="font-size:.8rem">${sub(r)}</td></tr>`).join('')}</tbody></table>${note ? `<p class="hint" style="margin-bottom:0">${esc(note)}</p>` : ''}`
        : '<p class="hint" style="margin:0">None yet.</p>'}</div>`;
}
function statsHTML(t, byId) {
    const S = testStats(t, byId);
    const L = S.players;
    const top = (ok, sort, n = 5) => L.filter(ok).sort(sort).slice(0, n);
    const avg = x => (x.inns - x.no > 0 ? x.runs / (x.inns - x.no) : null);
    const bavg = x => (x.bw ? x.br / x.bw : null);
    const runs = top(x => x.inns > 0, (a, b) => b.runs - a.runs || (avg(b) ?? 0) - (avg(a) ?? 0));
    const wkts = top(x => x.bw > 0, (a, b) => b.bw - a.bw || bavg(a) - bavg(b));
    const minInns = Math.min(4, L.reduce((m, x) => Math.max(m, x.inns), 0));
    const avgs = top(x => x.inns >= minInns && avg(x) != null, (a, b) => avg(b) - avg(a) || b.runs - a.runs);
    const topW = L.reduce((m, x) => Math.max(m, x.bw), 0), minW = Math.min(10, Math.max(1, Math.ceil(topW / 3)));
    const bavgs = top(x => x.bw >= minW, (a, b) => bavg(a) - bavg(b) || b.bw - a.bw);
    const tons = top(x => x.n100 > 0, (a, b) => b.n100 - a.n100 || b.n50 - a.n50 || b.runs - a.runs);
    const sixes = top(x => x.f6 > 0, (a, b) => b.f6 - a.f6 || b.runs - a.runs);
    const field = top(x => x.ct + x.st > 0, (a, b) => b.ct + b.st - (a.ct + a.st) || b.ct - a.ct);
    const hs = S.inns.slice().sort((a, b) => b.r - a.r || (a.out - b.out) || a.b - b.b).slice(0, 5);
    const bestI = S.spells.filter(x => x.w > 0).sort((a, b) => b.w - a.w || a.r - b.r).slice(0, 5);
    const bestM = S.matchFigs.filter(x => x.w > 0).sort((a, b) => b.w - a.w || a.r - b.r).slice(0, 5);
    const hiT = S.totals.slice().sort((a, b) => b.runs - a.runs).slice(0, 5).map(x => ({ ...x, name: x.team, team: `v ${x.opp}` }));
    const loT = S.totals.filter(x => x.wkts >= 10).sort((a, b) => a.runs - b.runs).slice(0, 5).map(x => ({ ...x, name: x.team, team: `v ${x.opp}` }));
    const sr = x => (x.balls ? nf(x.runs / x.balls * 100, 1) : '—');
    const head = `<div class="card"><h2 class="card-title">Player stats</h2><p class="hint" style="margin:0">${S.tests ? `From ${plural(S.tests, 'Test')} scored in Crease.${t.fixtures.some(f => !f.matchId && (f.manual || f.nr)) ? ' Results entered by hand or simulated have no scorecard, so they aren\'t counted.' : ''}` : 'Runs, wickets and records fill in as Tests are scored here (with “Score live”, or by linking a saved match). Results entered by hand or simulated have no scorecard, so they don\'t count.'}</p></div>`;
    if (!L.length) return head;
    return `${head}
    <div class="grid-2" style="align-items:start">
      ${statBoard('Most runs', runs, x => x.runs, x => `${plural(x.inns, 'inns', 'inns')} · avg ${avg(x) != null ? nf(avg(x), 2) : '—'}${x.n100 ? ` · ${plural(x.n100, 'hundred')}` : ''}${x.n50 ? ` · ${plural(x.n50, 'fifty', 'fifties')}` : ''}`)}
      ${statBoard('Most wickets', wkts, x => x.bw, x => `avg ${nf(bavg(x), 2)} · ${oversTxt(x.bb)} ov${x.w5 ? ` · ${x.w5}×5w` : ''}`)}
      ${statBoard('Highest scores', hs, x => `${x.r}${x.out ? '' : '*'}`, x => `${x.b} balls v ${esc(x.opp)}`)}
      ${statBoard('Best bowling in an innings', bestI, x => `${x.w}/${x.r}`, x => `${oversTxt(x.balls)} ov v ${esc(x.opp)}`)}
      ${statBoard('Best match figures', bestM, x => `${x.w}/${x.r}`, x => `v ${esc(x.opp)}`, 'Both innings of one Test.')}
      ${statBoard('Most hundreds', tons, x => x.n100, x => `${x.n50} fifties · ${x.runs} runs`)}
      ${statBoard('Best batting average', avgs, x => nf(avg(x), 2), x => `${x.runs} runs · SR ${sr(x)}`, `At least ${plural(minInns, 'innings', 'innings')} and out at least once.`)}
      ${statBoard('Best bowling average', bavgs, x => nf(bavg(x), 2), x => `${plural(x.bw, 'wkt')} · econ ${x.bb ? nf(x.br / (x.bb / 6), 2) : '—'}`, `At least ${plural(minW, 'wicket')}.`)}
      ${statBoard('Most catches and stumpings', field, x => x.ct + x.st, x => `${plural(x.ct, 'catch', 'catches')}${x.st ? ` · ${x.st} st` : ''}`)}
      ${statBoard('Most sixes', sixes, x => x.f6, x => `${x.runs} runs`)}
      ${statBoard('Highest team totals', hiT, x => `${x.runs}${x.wkts < 10 ? `/${x.wkts}${x.dec ? 'd' : ''}` : ''}`, x => `${oversTxt(x.balls)} ov`)}
      ${statBoard('Lowest all-out totals', loT, x => x.runs, x => `${oversTxt(x.balls)} ov`)}
    </div>`;
}

/* ---------- Forms ---------- */
function manualForm(t, f, save) {
    const m0 = f.manual || {};
    const body = openModal(`${f.manual ? 'Edit' : 'Enter'} result: ${f.a} v ${f.b}`, `
    <div class="fields">
      <div class="field"><div class="lab"><label for="wm-r">Result</label></div><select id="wm-r"><option value="a"${m0.res === 'a' ? ' selected' : ''}>${esc(f.a)} won</option><option value="b"${m0.res === 'b' ? ' selected' : ''}>${esc(f.b)} won</option><option value="d"${m0.res === 'd' ? ' selected' : ''}>Drawn</option><option value="t"${m0.res === 't' ? ' selected' : ''}>Tied</option></select></div>
      <div class="field"><div class="lab"><label for="wm-h">Won by</label></div><select id="wm-h"><option value="runs"${m0.how === 'runs' ? ' selected' : ''}>Runs</option><option value="wkts"${m0.how === 'wkts' ? ' selected' : ''}>Wickets</option><option value="inns"${m0.how === 'inns' ? ' selected' : ''}>An innings and runs</option></select></div>
      <div class="field"><div class="lab"><label for="wm-n">Margin</label></div><input id="wm-n" type="text" inputmode="numeric" autocomplete="off" value="${esc(m0.n ?? '')}" placeholder="Optional"></div>
    </div>
    <p class="hint">For a Test you didn't score in Crease. ${f.manual?.sim ? 'Saving turns this simulated result into a typed-in one. ' : ''}The margin is optional.</p>
    <p class="err-text" id="wm-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save result</button></div>`);
    const sync = () => { const r = $('#wm-r', body).value, win = r === 'a' || r === 'b'; $('#wm-h', body).closest('.field').hidden = $('#wm-n', body).closest('.field').hidden = !win; };
    body.addEventListener('change', sync); sync();
    body.addEventListener('click', e => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'cancel') { closeModal(); return; }
        const res = $('#wm-r', body).value, how = $('#wm-h', body).value, nS = $('#wm-n', body).value.trim();
        const win = res === 'a' || res === 'b';
        let n = null;
        if (win && nS) {
            n = Number(nS);
            if (!Number.isInteger(n) || n < 1 || (how === 'wkts' && n > 10)) { $('#wm-err', body).textContent = how === 'wkts' ? 'Wickets must be 1 to 10.' : 'The margin must be a whole number of runs.'; return; }
        }
        f.manual = { res, ...(win && n ? { how, n } : {}) }; f.matchId = null; f.nr = false; f.simNR = false;
        closeModal(); save(); toast('Result saved');
    });
}

function penaltyForm(t, f, save) {
    const p = f.pen || {};
    const body = openModal(`Over-rate penalty: ${f.a} v ${f.b}`, `
    <p class="hint" style="margin:-6px 0 12px">One point comes off for every over a side was behind the required rate at the end of the match. There's no deduction if the side bowled the other team out inside 80 overs.</p>
    <div class="fields">
      <div class="field"><div class="lab"><label for="wp-a">${esc(f.a)}: points off</label></div><input id="wp-a" type="text" inputmode="numeric" autocomplete="off" value="${esc(p.a || 0)}"></div>
      <div class="field"><div class="lab"><label for="wp-b">${esc(f.b)}: points off</label></div><input id="wp-b" type="text" inputmode="numeric" autocomplete="off" value="${esc(p.b || 0)}"></div>
    </div>
    <p class="err-text" id="wp-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save</button></div>`);
    body.addEventListener('click', e => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'cancel') { closeModal(); return; }
        const a = Number($('#wp-a', body).value.trim() || 0), b = Number($('#wp-b', body).value.trim() || 0);
        if (![a, b].every(v => Number.isInteger(v) && v >= 0 && v <= 60)) { $('#wp-err', body).textContent = 'Enter whole numbers of points, 0 or more.'; return; }
        if (a || b) f.pen = { a, b }; else delete f.pen;
        closeModal(); save(); toast(a || b ? 'Penalty saved' : 'Penalty removed');
    });
}

function whenForm(t, f, save) {
    const body = openModal(`Date and ground: ${f.a || 'TBC'} v ${f.b || 'TBC'}`, `
    <div class="fields">
      <div class="field"><div class="lab"><label for="ww-d">First day</label></div><input id="ww-d" type="date" value="${esc(f.date || '')}"></div>
      <div class="field"><div class="lab"><label for="ww-g">Ground</label></div><input id="ww-g" type="text" maxlength="80" autocomplete="off" value="${esc(f.venue || '')}" placeholder="e.g. Lord's, London"></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save</button></div>`);
    body.addEventListener('click', e => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'ok') {
            const d = $('#ww-d', body).value.trim(), g = $('#ww-g', body).value.trim().replace(/\s+/g, ' ');
            if (d) f.date = d; else delete f.date;
            if (g) f.venue = g; else delete f.venue;
            save();
        }
        closeModal();
    });
}

function seriesForm(t, s, save) {
    const byId = byIdNow();
    const st = s ? seriesState(t, s, byId) : null;
    const opts = sel => t.teams.map(n => `<option${same(n, sel) ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const body = openModal(s ? `Edit series: ${s.home} v ${s.away}` : 'Add a series', `
    <div class="fields">
      <div class="field"><div class="lab"><label for="ws-h">Home side</label></div><select id="ws-h"${st?.done ? ' disabled' : ''}>${opts(s?.home || t.teams[0])}</select></div>
      <div class="field"><div class="lab"><label for="ws-a">Visitors</label></div><select id="ws-a"${st?.done ? ' disabled' : ''}>${opts(s?.away || t.teams[1])}</select></div>
      <div class="field"><div class="lab"><label for="ws-n">Tests</label></div><select id="ws-n">${[2, 3, 4, 5].map(n => `<option${(s?.tests || 2) === n ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field"><div class="lab"><label for="ws-w">When</label></div><input id="ws-w" type="text" maxlength="30" autocomplete="off" value="${esc(s?.when || '')}" placeholder="e.g. Dec 2026"></div>
      <div class="field wide"><div class="lab"><label for="ws-t">Trophy</label></div><input id="ws-t" type="text" maxlength="50" autocomplete="off" value="${esc(s?.trophy || '')}" placeholder="Optional, e.g. The Ashes"></div>
    </div>
    <p class="hint">Series in the championship are two to five Tests.${st?.done ? ' Tests already played stay; you can add Tests or remove ones not played yet.' : ''}</p>
    <p class="err-text" id="ws-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">${s ? 'Save' : 'Add series'}</button></div>`);
    body.addEventListener('click', e => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'cancel') { closeModal(); return; }
        const home = $('#ws-h', body).value, away = $('#ws-a', body).value, n = Number($('#ws-n', body).value);
        if (same(home, away)) { $('#ws-err', body).textContent = 'Pick two different teams.'; return; }
        const when = $('#ws-w', body).value.trim(), trophy = $('#ws-t', body).value.trim();
        const fin = t.fixtures.filter(f => f.stage);
        if (!s) {
            const ns = { id: uid(), home, away, tests: n, ...(when ? { when } : {}), ...(trophy ? { trophy } : {}) };
            t.series = [...(t.series || []), ns];
            t.fixtures = [...t.fixtures.filter(f => !f.stage), ...Array.from({ length: n }, (_, k) => mkTest(ns, k + 1)), ...fin];
            closeModal(); save(); toast('Series added'); return;
        }
        const tests = t.fixtures.filter(f => f.series === s.id).sort((p, q) => p.no - q.no);
        const playedN = tests.filter(f => played(f, byId)).length;
        const lastPlayed = tests.reduce((m, f) => (played(f, byId) ? Math.max(m, f.no) : m), 0);
        if (n < lastPlayed) { $('#ws-err', body).textContent = `Test ${lastPlayed} has been played, so the series needs at least ${lastPlayed} Tests.`; return; }
        if (!playedN) { s.home = home; s.away = away; tests.forEach(f => { f.a = home; f.b = away; }); }
        s.tests = n; if (when) s.when = when; else delete s.when; if (trophy) s.trophy = trophy; else delete s.trophy;
        const keep = tests.filter(f => f.no <= n), add = Array.from({ length: Math.max(0, n - tests.length) }, (_, k) => mkTest(s, tests.length + k + 1));
        const others = t.fixtures.filter(f => !f.stage && f.series !== s.id);
        t.fixtures = [...others, ...keep, ...add, ...fin];
        closeModal(); save(); toast('Series updated');
    });
}

// The championship's own Edit form: name, points, team order (the rankings for the last tie-break) and the final.
export function testTourForm(t, save) {
    const fin = finalOf(t);
    const body = openModal('Edit championship', `
    <div class="fields">
      <div class="field wide"><div class="lab"><label for="wt-name">Name</label></div><input id="wt-name" type="text" maxlength="50" autocomplete="off" value="${esc(t.name)}"></div>
      <div class="field wide"><div class="lab"><label for="wt-teams">Teams, in ICC Test ranking order</label></div><textarea id="wt-teams" rows="9" spellcheck="false">${esc(t.teams.join('\n'))}</textarea></div>
    </div>
    <p class="modal-sub" style="margin-top:14px">Points for each Test</p>
    <div class="fields three">
      <div class="field"><div class="lab"><label for="wt-w">Win</label></div><input id="wt-w" type="text" inputmode="numeric" value="${esc(ptsOf(t).w)}"></div>
      <div class="field"><div class="lab"><label for="wt-t">Tie</label></div><input id="wt-t" type="text" inputmode="numeric" value="${esc(ptsOf(t).t)}"></div>
      <div class="field"><div class="lab"><label for="wt-d">Draw</label></div><input id="wt-d" type="text" inputmode="numeric" value="${esc(ptsOf(t).d)}"></div>
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" id="wt-or"${t.overRate ? ' checked' : ''}> Over-rate penalties (one point off for each over short)</label>
    <p class="hint">The team order is the last tie-break, after PCT, series won and away PCT. Rename a team on its own line to keep its series. Teams can't be removed while they have series.</p>
    <p class="err-text" id="wt-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save changes</button></div>`, { wide: true });
    body.addEventListener('click', e => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'cancel') { closeModal(); return; }
        const err = $('#wt-err', body);
        const name = $('#wt-name', body).value.trim();
        const teams = $('#wt-teams', body).value.split('\n').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
        const pts = { w: Number($('#wt-w', body).value), t: Number($('#wt-t', body).value), d: Number($('#wt-d', body).value) };
        if (!name) { err.textContent = 'Give the championship a name.'; return; }
        if (teams.length < 2) { err.textContent = 'Add at least two teams.'; return; }
        const dup = teams.find((n, k) => teams.findIndex(y => same(y, n)) !== k);
        if (dup) { err.textContent = `“${dup}” is listed twice.`; return; }
        if (Object.values(pts).some(v => !Number.isInteger(v) || v < 0) || !pts.w) { err.textContent = 'Points must be whole numbers, with something for a win.'; return; }
        // Renames: same line, different name.
        const ren = new Map();
        if (teams.length === t.teams.length) t.teams.forEach((o, k) => { if (o !== teams[k]) ren.set(o, teams[k]); });
        const after = n => ren.get(n) || n;
        const missing = (t.series || []).flatMap(s => [after(s.home), after(s.away)]).find(n => !teams.some(y => same(y, n)));
        if (missing) { err.textContent = `${missing} still has series. Remove them first, or rename the team on its own line.`; return; }
        (t.series || []).forEach(s => { s.home = after(s.home); s.away = after(s.away); });
        t.fixtures.forEach(f => { if (f.a) f.a = after(f.a); if (f.b) f.b = after(f.b); if (f.pen) { /* keyed by side, nothing to rename */ } });
        if (t.sim) Object.keys(t.sim).forEach(k => { if (ren.has(k)) { t.sim[ren.get(k)] = t.sim[k]; delete t.sim[k]; } });
        Object.assign(t, { name, teams, pts, overRate: $('#wt-or', body).checked });
        if (fin && !fin.manual && !fin.matchId) { fin.a = null; fin.b = null; } // re-picked from the table
        closeModal(); save(); toast('Championship updated');
    });
}

function teamModal(t, team) {
    const byId = byIdNow();
    const rows = testTable(t, byId), r = rows.find(x => same(x.team, team)), pos = rows.indexOf(r) + 1;
    const ser = (t.series || []).filter(s => same(s.home, team) || same(s.away, team));
    const line = s => {
        const st = seriesState(t, s, byId), home = same(s.home, team);
        const tests = t.fixtures.filter(f => f.series === s.id).sort((p, q) => p.no - q.no).map(f => {
            const o = testOutcome(f, byId);
            if (!o || o.error) return '<span class="bdot sm" title="Not played">·</span>';
            const mine = same(f.a, team) ? 'a' : 'b';
            const c = o.res === mine ? 'd4' : o.res === 'd' || o.res === 't' ? 'd0' : 'dw';
            return `<span class="bdot sm ${c}" title="${esc(o.text)}">${o.res === mine ? 'W' : o.res === 'd' ? 'D' : o.res === 't' ? 'T' : 'L'}</span>`;
        }).join('');
        return `<tr><td>${home ? 'v' : '@'} ${esc(home ? s.away : s.home)}<div class="dim" style="font-size:.78rem">${esc(seriesScore(s, st))}${s.when ? ` · ${esc(s.when)}` : ''}</div></td><td style="white-space:normal"><span class="mini-chips">${tests}</span></td></tr>`;
    };
    openModal(team, `
    <p class="hint" style="margin:-6px 0 12px">${ordinal(pos)} · ${r.pts} points from ${r.max} contested · PCT ${p2(r.pct)}${r.apct != null ? ` (away ${p2(r.apct)})` : ''}${r.ded ? ` · ${r.ded} lost for over rate` : ''}</p>
    <div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>Series</th><th>Tests</th></tr></thead><tbody>${ser.map(line).join('') || '<tr><td class="dim" colspan="2">No series yet.</td></tr>'}</tbody></table></div>
    <p class="hint">“v” is at home and “@” away. W won, L lost, D drawn, T tied.</p>`);
}

/* ---------- Actions ----------
   Clicks on data-tr="w-…" buttons. Returns true when the action was handled here. */
export async function testTourAction(t, a, f, b, { save, busy }) {
    const byId = () => byIdNow();
    switch (a) {
        case 'w-manual': if (f) manualForm(t, f, save); return true;
        case 'w-pen': if (f) penaltyForm(t, f, save); return true;
        case 'w-when': if (f) whenForm(t, f, save); return true;
        case 'w-nr': if (f) { f.nr = true; f.simNR = false; f.manual = null; f.matchId = null; save(); toast('Marked as abandoned: it counts as a draw'); } return true;
        case 'w-sim': if (f && simulateTest(t, f)) { save(); toast('Result simulated'); } return true;
        case 'w-resim': if (f && isSim(f)) { f.manual = null; f.nr = false; f.simNR = false; simulateTest(t, f); save(); toast('Simulated again'); } return true;
        case 'w-simall': {
            let n = 0;
            leagueOf(t).forEach(x => { if (!busy(x) && simulateTest(t, x)) n++; });
            save(); toast(n ? `${plural(n, 'Test')} simulated` : 'Nothing left to simulate'); return true;
        }
        case 'w-simclear':
            if (await confirmBox('Clear simulated results?', 'Every simulated Test goes back to not played. Scored and typed-in results stay.', 'Clear', true)) {
                t.fixtures.forEach(x => { if (x.manual?.sim) x.manual = null; if (x.simNR) { x.nr = false; x.simNR = false; } });
                t.sim = {};
                const fin = finalOf(t); if (fin && !fin.manual && !fin.matchId && !fin.nr) { fin.a = null; fin.b = null; }
                save(); toast('Simulated results cleared');
            }
            return true;
        case 'w-sadd': seriesForm(t, null, save); return true;
        case 'w-sedit': { const s = (t.series || []).find(x => x.id === b.dataset.s); if (s) seriesForm(t, s, save); return true; }
        case 'w-sdel': {
            const s = (t.series || []).find(x => x.id === b.dataset.s);
            if (s && await confirmBox(`Remove ${s.home} v ${s.away}?`, 'The series and its Tests are removed from the championship.', 'Remove', true)) {
                t.series = t.series.filter(x => x !== s); t.fixtures = t.fixtures.filter(x => x.series !== s.id); save();
            }
            return true;
        }
        case 'w-team': teamModal(t, b.dataset.team); return true;
        case 'clear':
            if (f && await confirmBox('Clear this result?', 'The Test goes back to not played. A linked scorecard stays in Saved matches.', 'Clear result')) {
                f.nr = false; f.simNR = false; f.manual = null; f.matchId = null; delete f.pen;
                if (f.stage) { f.a = null; f.b = null; }
                save();
            }
            return true;
        default: return false;
    }
}

// Remember series the viewer opens or closes, so a re-render keeps them that way.
document.addEventListener('click', e => {
    const sum = e.target.closest?.('.w-series > summary');
    if (sum) { openSeries.set(sum.parentElement.dataset.s, !sum.parentElement.open); return; }
    // Working inside a series keeps it open, even once its last Test has a result.
    const in_ = e.target.closest?.('.w-series [data-tr]');
    if (in_) openSeries.set(in_.closest('.w-series').dataset.s, true);
});