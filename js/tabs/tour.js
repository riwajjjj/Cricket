/* Crease — Bilateral tours: one side visiting another for a T20I series, an ODI series and a Test series
   (any of them). Each series has its own score, each match is scored in the right format, and the tour
   keeps the leading run-scorers and wicket-takers. Tests on a tour can also count in a Test championship. */
import { finishedMatches } from '../records.js';
import { fixtureOutcome } from '../stats.js';
import { closeModal, confirmBox, openModal, toast } from '../ui.js';
import { $, esc, plural, uid } from '../utils.js';
import { testOutcome } from './wtc.js';

export const isTour = t => !!t && t.kind === 'tour';
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
export const FORMATS_T = { T20I: { overs: 20, name: 'T20I', many: 'T20Is' }, ODI: { overs: 50, name: 'ODI', many: 'ODIs' }, Test: { overs: null, name: 'Test', many: 'Tests' } };
const ordinal = n => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateTxt = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}` : ''; };
const shortDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]}` : ''; };
const byIdNow = () => new Map(finishedMatches().map(m => [m.id, m]));

export const legOf = (t, f) => (t.legs || []).find(l => l.id === f.leg) || null;
// What the live scorer needs for a match on this tour.
export const tourMatchSetup = (t, f) => { const l = legOf(t, f); return { overs: l?.fmt === 'Test' ? '' : (l?.overs ?? 20), test: l?.fmt === 'Test' }; };
export const matchName = (t, f) => { const l = legOf(t, f); return l ? `${ordinal(f.no)} ${FORMATS_T[l.fmt].name}` : `Match ${f.no}`; };

/* ---------- The tour from the schedule ---------- */
const mkMatch = (leg, no, home, away, d) => ({ id: uid(), leg: leg.id, no, a: home, b: away, matchId: null, manual: null, nr: false, ...(d ? { date: d[0], venue: d[1] } : {}) });
function build(name, home, away, legs) {
    const L = legs.map(([fmt, games]) => ({ id: uid(), fmt, overs: FORMATS_T[fmt].overs, n: games.length }));
    const fixtures = L.flatMap((l, k) => legs[k][1].map((d, n) => mkMatch(l, n + 1, home, away, d)));
    return { id: uid(), created: Date.now(), kind: 'tour', name, teams: [home, away], legs: L, fixtures };
}
// India in New Zealand, October to December 2026: five T20Is, five ODIs and two Tests (the Tests are in the World Test Championship).
export function indNzTemplate() {
    return build('India tour of New Zealand 2026', 'New Zealand', 'India', [
        ['T20I', [['2026-10-22', 'Hagley Oval, Christchurch'], ['2026-10-24', 'Hagley Oval, Christchurch'], ['2026-10-27', 'Hnry Stadium, Wellington'], ['2026-10-30', 'Eden Park, Auckland'], ['2026-11-01', 'Seddon Park, Hamilton']]],
        ['ODI', [['2026-11-04', 'Eden Park, Auckland'], ['2026-11-07', 'Hnry Stadium, Wellington'], ['2026-11-10', 'Seddon Park, Hamilton'], ['2026-11-13', 'Bay Oval, Mount Maunganui'], ['2026-11-15', 'Bay Oval, Mount Maunganui']]],
        ['Test', [['2026-11-19', 'Basin Reserve, Wellington'], ['2026-11-27', 'Hagley Oval, Christchurch']]],
    ]);
}
export function blankTour(name, home, away) { return { id: uid(), created: Date.now(), kind: 'tour', name, teams: [home, away], legs: [], fixtures: [] }; }

/* ---------- Results ----------
   { res: 'a' | 'b' | 't' | 'd' | 'nr', text } or null. A tie settled by a super over counts as a win. */
const margin = m => (m.how === 'inns' ? `an innings and ${plural(m.n, 'run')}` : m.how === 'wkts' ? plural(m.n, 'wicket') : plural(m.n, 'run'));
export function tourOutcome(t, f, byId = byIdNow()) {
    const l = legOf(t, f);
    if (!l) return null;
    if (l.fmt === 'Test') return testOutcome(f, byId);
    if (f.nr) return { res: 'nr', text: 'No result' };
    if (f.matchId) {
        const o = fixtureOutcome({ overs: l.overs }, f, byId);
        if (!o || o.error) return o;
        const res = o.nr ? 'nr' : o.winner || o.so || 't';
        return { res, text: `${o.text || ''}${o.so && !/super over/i.test(o.text || '') ? ` · ${o.so === 'a' ? f.a : f.b} won the super over` : ''}`, linked: o.linked };
    }
    if (f.manual) {
        const m = f.manual, W = m.res === 'a' ? f.a : f.b;
        if (m.res === 't') return { res: m.so || 't', text: `Match tied${m.so ? ` · ${m.so === 'a' ? f.a : f.b} won the super over` : ''}` };
        if (m.res === 'nr') return { res: 'nr', text: 'No result' };
        return { res: m.res, text: `${W} won${m.n ? ` by ${margin(m)}` : ''}` };
    }
    return null;
}
const isPlayedT = (t, f, byId) => { const o = tourOutcome(t, f, byId); return !!o && !o.error; };
const isSim = f => !!(f.manual?.sim || f.simNR);

export function legState(t, l, byId) {
    const games = t.fixtures.filter(f => f.leg === l.id);
    const s = { a: 0, b: 0, d: 0, t: 0, nr: 0, done: 0, total: games.length };
    games.forEach(f => { const o = tourOutcome(t, f, byId); if (!o || o.error) return; s.done++; s[o.res]++; });
    s.complete = s.total > 0 && s.done === s.total;
    return s;
}
function legScore(t, l, s) {
    const [A, B] = t.teams;
    const extra = [s.d ? plural(s.d, 'draw') : '', s.t ? plural(s.t, 'tie') : '', s.nr ? `${s.nr} no result` : ''].filter(Boolean).join(', ');
    const tail = extra ? ` (${extra})` : '';
    if (!s.done) return 'Not started';
    const lead = s.a === s.b ? null : s.a > s.b ? A : B, hi = Math.max(s.a, s.b), lo = Math.min(s.a, s.b);
    if (s.complete) return lead ? `${lead} won ${hi}–${lo}${tail}` : `Series drawn ${s.a}–${s.b}${tail}`;
    return `${lead ? `${lead} lead ${hi}–${lo}` : `Level ${s.a}–${s.b}`}${tail}, ${s.done} of ${s.total} played`;
}

/* ---------- Simulation ---------- */
function simulate(t, f) {
    const l = legOf(t, f);
    if (!l || isPlayedT(t, f, byIdNow())) return false;
    const test = l.fmt === 'Test';
    if (Math.random() < (test ? 0.02 : 0.03)) { f.nr = true; f.simNR = true; return true; }
    t.sim = t.sim || {};
    t.teams.forEach(n => { if (t.sim[n] == null) t.sim[n] = Math.round((Math.random() - 0.5) * 60) / 100; });
    const home = t.sim[f.a] + 0.35, away = t.sim[f.b];
    const pd = test ? 0.18 : 0, pt = test ? 0.002 : 0.008;
    const ph = (1 - pd - pt) / (1 + Math.exp(-(home - away) * 1.6));
    const u = Math.random();
    const res = u < ph ? 'a' : u < ph + pd ? 'd' : u < ph + pd + pt ? 't' : 'b';
    const m = { res, sim: true };
    if (res === 'a' || res === 'b') {
        const v = Math.random();
        if (test && v < 0.2) Object.assign(m, { how: 'inns', n: 1 + Math.floor(Math.random() * 200) });
        else if (v < 0.55) Object.assign(m, { how: 'runs', n: test ? Math.round(20 + Math.random() ** 1.6 * 360) : Math.round(1 + Math.random() ** 1.5 * (l.overs >= 50 ? 150 : 70)) });
        else Object.assign(m, { how: 'wkts', n: [2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 9][Math.floor(Math.random() * 12)] });
    }
    if (res === 't' && !test) m.so = Math.random() < 0.5 ? 'a' : 'b';
    if (res === 't' && !test) m.res = 't';
    f.manual = m; f.matchId = null; f.nr = false;
    return true;
}

/* ---------- Leading players, from the matches scored in Crease ---------- */
function leaders(t, l, byId) {
    const runs = new Map(), wk = new Map();
    t.fixtures.filter(f => f.leg === l.id && f.matchId).forEach(f => {
        const m = byId.get(f.matchId);
        if (!m) return;
        const d = m.data;
        d.inns.filter(i => !i.so).forEach(i => {
            const bt = d.teams[i.bat], bw = d.teams[1 - i.bat];
            i.batters.forEach(b => { if (!b.balls && !b.out) return; const k = `${bt}|${b.name}`.toLowerCase(); const r = runs.get(k) || { name: b.name, team: bt, runs: 0, balls: 0, inns: 0, outs: 0, hs: 0 }; r.runs += b.runs; r.balls += b.balls; r.inns++; if (b.out) r.outs++; r.hs = Math.max(r.hs, b.runs); runs.set(k, r); });
            i.bowlers.forEach(b => { if (!b.balls) return; const k = `${bw}|${b.name}`.toLowerCase(); const r = wk.get(k) || { name: b.name, team: bw, w: 0, r: 0, balls: 0 }; r.w += b.wkts; r.r += b.runs; r.balls += b.balls; wk.set(k, r); });
        });
    });
    const bat = [...runs.values()].sort((x, y) => y.runs - x.runs || x.balls - y.balls).slice(0, 5);
    const bowl = [...wk.values()].filter(x => x.w).sort((x, y) => y.w - x.w || x.r - y.r).slice(0, 5);
    return { bat, bowl };
}

/* ---------- Rendering ---------- */
const openLegs = new Map();
function matchRow(t, f, byId, busy) {
    const o = tourOutcome(t, f, byId);
    let status, acts;
    if (o && !o.error) {
        status = `<span class="${o.res === 'nr' || o.res === 'd' ? 'dim' : ''}">${esc(o.text)}</span>${isSim(f) ? ' <span class="chip r1" style="font-size:.65rem">Simulated</span>' : ''}`;
        acts = `${o.linked ? `<button type="button" class="btn ghost sm" data-tr="card" data-f="${f.id}">Scorecard</button>` : ''}${f.manual ? `<button type="button" class="btn ghost sm" data-tr="t-manual" data-f="${f.id}">Edit result</button>` : ''}${isSim(f) ? `<button type="button" class="btn ghost sm" data-tr="t-resim" data-f="${f.id}">Simulate again</button>` : ''}<button type="button" class="btn ghost sm" data-tr="t-clear" data-f="${f.id}">Clear result</button>`;
    } else {
        const b = busy(f);
        status = b ? '<span class="badge live" style="font-size:.65rem">Being scored</span>' : o?.error ? `<span class="neg">${esc(o.error)}</span>` : '<span class="dim">Not played yet</span>';
        acts = `<button type="button" class="btn sm" data-tr="score" data-f="${f.id}">${b ? 'Open scorer' : 'Score live'}</button>
      <button type="button" class="btn ghost sm" data-tr="t-manual" data-f="${f.id}">Enter result</button>
      <button type="button" class="btn ghost sm" data-tr="link" data-f="${f.id}">Link a saved match</button>
      <button type="button" class="btn ghost sm" data-tr="t-nr" data-f="${f.id}">${legOf(t, f)?.fmt === 'Test' ? 'Abandoned' : 'No result'}</button>
      ${b ? '' : `<button type="button" class="btn ghost sm" data-tr="t-sim" data-f="${f.id}">Simulate</button>`}`;
    }
    acts += `<button type="button" class="btn ghost sm" data-tr="t-when" data-f="${f.id}">Date and ground</button>`;
    const cap = [dateTxt(f.date), f.venue && `at ${f.venue}`].filter(Boolean).join(' · ');
    return `<div class="fx-row"><div class="fx-main"><span class="fx-no">${f.no}</span><div>${cap ? `<div class="fx-cap">${esc(cap)}</div>` : ''}<div class="fx-teams">${esc(matchName(t, f))}: ${esc(f.a)} <span class="dim">v</span> ${esc(f.b)}</div><div class="fx-status">${status}</div></div></div><div class="fx-acts">${acts}</div></div>`;
}
const legDates = (t, l) => { const ds = t.fixtures.filter(f => f.leg === l.id && f.date).map(f => f.date).sort(); return ds.length ? (ds[0] === ds[ds.length - 1] ? shortDate(ds[0]) : `${shortDate(ds[0])} – ${shortDate(ds[ds.length - 1])}`) : ''; };

export function renderTour(t, main, { busy }) {
    const byId = byIdNow();
    const legs = t.legs || [];
    const states = legs.map(l => legState(t, l, byId));
    const nextIn = states.findIndex(s => !s.complete);
    const summary = legs.map((l, k) => `<div class="tour-leg"><span>${esc(FORMATS_T[l.fmt].name)} series</span><b>${esc(legScore(t, l, states[k]))}</b>${legDates(t, l) ? `<em>${esc(legDates(t, l))}</em>` : ''}</div>`).join('');
    const legCards = legs.map((l, k) => {
        const s = states[k], games = t.fixtures.filter(f => f.leg === l.id).sort((x, y) => x.no - y.no);
        const def = (s.done > 0 && !s.complete) || k === nextIn;
        const open = openLegs.has(l.id) ? openLegs.get(l.id) : def;
        const L = leaders(t, l, byId);
        const lead = L.bat.length || L.bowl.length ? `<div class="grid-2" style="margin-top:12px">
      <div><p class="modal-sub">Most runs</p>${L.bat.map(x => `<div class="tp-line"><span>${esc(x.name)} <span class="dim">${esc(x.team)}</span></span><span><b>${x.runs}</b> <span class="dim">${x.balls ? `SR ${(x.runs / x.balls * 100).toFixed(1)}` : ''}${x.outs ? ` · avg ${(x.runs / x.outs).toFixed(1)}` : ''}</span></span></div>`).join('') || '<p class="hint" style="margin:0">—</p>'}</div>
      <div><p class="modal-sub">Most wickets</p>${L.bowl.map(x => `<div class="tp-line"><span>${esc(x.name)} <span class="dim">${esc(x.team)}</span></span><span><b>${x.w}</b> <span class="dim">econ ${(x.r / (x.balls / 6)).toFixed(2)}</span></span></div>`).join('') || '<p class="hint" style="margin:0">—</p>'}</div></div>
      <p class="hint" style="margin-bottom:0">From the matches scored in Crease (typed-in and simulated results have no player figures).</p>` : '';
        return `<details class="card fold t-leg" data-l="${l.id}"${open ? ' open' : ''}><summary><h2 class="card-title">${esc(FORMATS_T[l.fmt].name)} series</h2><span class="fold-peek" style="display:block">${esc(legScore(t, l, s))} · ${plural(s.total, FORMATS_T[l.fmt].name)}${l.fmt === 'Test' || l.overs === FORMATS_T[l.fmt].overs ? '' : ` of ${l.overs} overs`}${legDates(t, l) ? ` · ${esc(legDates(t, l))}` : ''}</span></summary>
      ${games.map(f => matchRow(t, f, byId, busy)).join('')}
      ${lead}
      <div class="fx-acts" style="margin-top:10px">${s.done ? '' : `<button type="button" class="btn ghost sm danger" data-tr="t-ldel" data-l="${l.id}">Remove series</button>`}<button type="button" class="btn ghost sm" data-tr="t-ledit" data-l="${l.id}">Edit series</button></div></details>`;
    }).join('');
    const left = t.fixtures.filter(f => !isPlayedT(t, f, byId) && !busy(f)).length;
    const anySim = t.fixtures.some(isSim);
    main.innerHTML = `
    <div class="card">
      <div class="sc-head" style="margin-bottom:12px"><h2 class="card-title" style="margin:0">${esc(t.teams[1])} in ${esc(t.teams[0])}</h2>
        <div class="head-actions" style="width:auto"><button type="button" class="btn ghost sm" data-tr="squads">Squads</button><button type="button" class="btn ghost sm" data-tr="t-ladd">Add a series</button>${left ? `<button type="button" class="btn ghost sm" data-tr="t-simall">Simulate the rest</button>` : ''}${anySim ? '<button type="button" class="btn ghost sm danger" data-tr="t-simclear">Clear simulated results</button>' : ''}</div></div>
      ${summary ? `<div class="tour-sum">${summary}</div>` : '<p class="hint" style="margin:0">No series yet. “Add a series” picks the format and the number of matches.</p>'}
      <p class="hint">${esc(t.teams[0])} are at home. “Score live” sets up each match in its format (20 overs, 50 overs or a Test). A tie decided by a super over counts as a win in the series. A Test scored here also goes into a Test championship that has the same Test between these teams, like the World Test Championship.</p>
    </div>
    ${legCards}`;
}

/* ---------- Forms ---------- */
function manualForm(t, f, save) {
    const l = legOf(t, f), test = l.fmt === 'Test', m0 = f.manual || {};
    const opts = [['a', `${f.a} won`], ['b', `${f.b} won`], ...(test ? [['d', 'Drawn'], ['t', 'Tied']] : [['t', 'Tied'], ['nr', 'No result']])];
    const hows = test ? [['runs', 'Runs'], ['wkts', 'Wickets'], ['inns', 'An innings and runs']] : [['runs', 'Runs'], ['wkts', 'Wickets']];
    const body = openModal(`${f.manual ? 'Edit' : 'Enter'} result: ${matchName(t, f)}`, `
    <div class="fields">
      <div class="field"><div class="lab"><label for="tm-r">Result</label></div><select id="tm-r">${opts.map(([v, x]) => `<option value="${v}"${m0.res === v ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="field"><div class="lab"><label for="tm-h">Won by</label></div><select id="tm-h">${hows.map(([v, x]) => `<option value="${v}"${m0.how === v ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="field"><div class="lab"><label for="tm-n">Margin</label></div><input id="tm-n" type="text" inputmode="numeric" autocomplete="off" value="${esc(m0.n ?? '')}" placeholder="Optional"></div>
      ${test ? '' : `<div class="field"><div class="lab"><label for="tm-so">Super over</label></div><select id="tm-so"><option value="">None</option><option value="a"${m0.so === 'a' ? ' selected' : ''}>${esc(f.a)} won it</option><option value="b"${m0.so === 'b' ? ' selected' : ''}>${esc(f.b)} won it</option></select></div>`}
    </div>
    <p class="hint">For a match you didn't score in Crease. The margin is optional.</p>
    <p class="err-text" id="tm-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save result</button></div>`);
    const sync = () => {
        const r = $('#tm-r', body).value, win = r === 'a' || r === 'b';
        $('#tm-h', body).closest('.field').hidden = $('#tm-n', body).closest('.field').hidden = !win;
        const so = $('#tm-so', body); if (so) so.closest('.field').hidden = r !== 't';
    };
    body.addEventListener('change', sync); sync();
    body.addEventListener('click', e => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'cancel') { closeModal(); return; }
        const res = $('#tm-r', body).value, how = $('#tm-h', body).value, nS = $('#tm-n', body).value.trim();
        const win = res === 'a' || res === 'b';
        let n = null;
        if (win && nS) {
            n = Number(nS);
            if (!Number.isInteger(n) || n < 1 || (how === 'wkts' && n > 10)) { $('#tm-err', body).textContent = how === 'wkts' ? 'Wickets must be 1 to 10.' : 'The margin must be a whole number of runs.'; return; }
        }
        const so = res === 't' ? $('#tm-so', body)?.value || '' : '';
        f.manual = { res, ...(win && n ? { how, n } : {}), ...(so ? { so } : {}) }; f.matchId = null; f.nr = false; f.simNR = false;
        closeModal(); save(); toast('Result saved');
    });
}
function whenForm(f, save) {
    const body = openModal(`Date and ground: ${f.a} v ${f.b}`, `
    <div class="fields">
      <div class="field"><div class="lab"><label for="tw-d">Date (first day)</label></div><input id="tw-d" type="date" value="${esc(f.date || '')}"></div>
      <div class="field"><div class="lab"><label for="tw-g">Ground</label></div><input id="tw-g" type="text" maxlength="80" autocomplete="off" value="${esc(f.venue || '')}" placeholder="e.g. Eden Park, Auckland"></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save</button></div>`);
    body.addEventListener('click', e => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'ok') {
            const d = $('#tw-d', body).value.trim(), g = $('#tw-g', body).value.trim().replace(/\s+/g, ' ');
            if (d) f.date = d; else delete f.date;
            if (g) f.venue = g; else delete f.venue;
            save();
        }
        closeModal();
    });
}
function legForm(t, l, save) {
    const byId = byIdNow(), s = l ? legState(t, l, byId) : null;
    const games = l ? t.fixtures.filter(f => f.leg === l.id).sort((x, y) => x.no - y.no) : [];
    const lastPlayed = games.reduce((m, f) => (isPlayedT(t, f, byId) ? Math.max(m, f.no) : m), 0);
    const body = openModal(l ? `Edit the ${FORMATS_T[l.fmt].name} series` : 'Add a series', `
    <div class="fields">
      <div class="field"><div class="lab"><label for="tl-f">Format</label></div><select id="tl-f"${s?.done ? ' disabled' : ''}>${Object.keys(FORMATS_T).map(k => `<option value="${k}"${(l?.fmt || 'ODI') === k ? ' selected' : ''}>${FORMATS_T[k].many}</option>`).join('')}</select></div>
      <div class="field"><div class="lab"><label for="tl-n">Matches</label></div><select id="tl-n">${[1, 2, 3, 4, 5, 6, 7].map(n => `<option${(l?.n || 3) === n ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field"><div class="lab"><label for="tl-o">Overs a side</label></div><input id="tl-o" type="text" inputmode="numeric" autocomplete="off" value="${esc(l?.overs ?? '')}" placeholder="20 or 50"></div>
    </div>
    <p class="hint">Overs are set by the format; change them only for something unusual, like a 40-over series.${lastPlayed ? ` Match ${lastPlayed} has been played, so the series needs at least ${lastPlayed} matches.` : ''}</p>
    <p class="err-text" id="tl-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">${l ? 'Save' : 'Add series'}</button></div>`);
    const sync = () => { const fm = $('#tl-f', body).value, o = $('#tl-o', body); o.closest('.field').hidden = fm === 'Test'; if (!l || fm !== l.fmt) o.value = FORMATS_T[fm].overs ?? ''; };
    body.addEventListener('change', e => { if (e.target.id === 'tl-f') sync(); });
    if (!l) sync(); else $('#tl-o', body).closest('.field').hidden = l.fmt === 'Test';
    body.addEventListener('click', e => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'cancel') { closeModal(); return; }
        const fmt = $('#tl-f', body).value, n = Number($('#tl-n', body).value);
        const ov = fmt === 'Test' ? null : Number($('#tl-o', body).value.trim());
        if (fmt !== 'Test' && (!Number.isInteger(ov) || ov < 1 || ov > 50)) { $('#tl-err', body).textContent = 'Overs a side must be a whole number from 1 to 50.'; return; }
        if (n < lastPlayed) { $('#tl-err', body).textContent = `Match ${lastPlayed} has been played, so keep at least ${lastPlayed} matches.`; return; }
        const [home, away] = t.teams;
        if (!l) {
            const nl = { id: uid(), fmt, overs: ov, n };
            t.legs = [...(t.legs || []), nl];
            t.fixtures = [...t.fixtures, ...Array.from({ length: n }, (_, k) => mkMatch(nl, k + 1, home, away))];
            closeModal(); save(); toast('Series added'); return;
        }
        if (!s.done) l.fmt = fmt;
        l.overs = l.fmt === 'Test' ? null : ov; l.n = n;
        const keep = games.filter(f => f.no <= n), add = Array.from({ length: Math.max(0, n - games.length) }, (_, k) => mkMatch(l, games.length + k + 1, home, away));
        t.fixtures = [...t.fixtures.filter(f => f.leg !== l.id), ...keep, ...add];
        closeModal(); save(); toast('Series updated');
    });
}
export function tourForm(t, save) {
    const body = openModal('Edit tour', `
    <div class="fields">
      <div class="field wide"><div class="lab"><label for="to-name">Name</label></div><input id="to-name" type="text" maxlength="50" autocomplete="off" value="${esc(t.name)}"></div>
      <div class="field"><div class="lab"><label for="to-h">Home side</label></div><input id="to-h" type="text" maxlength="40" autocomplete="off" value="${esc(t.teams[0])}"></div>
      <div class="field"><div class="lab"><label for="to-a">Visitors</label></div><input id="to-a" type="text" maxlength="40" autocomplete="off" value="${esc(t.teams[1])}"></div>
    </div>
    <p class="hint">Renaming a side renames it in every match. Use the same names as in the live scorer, so scored matches line up.</p>
    <p class="err-text" id="to-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save changes</button></div>`);
    body.addEventListener('click', e => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === 'cancel') { closeModal(); return; }
        const name = $('#to-name', body).value.trim(), h = $('#to-h', body).value.trim().replace(/\s+/g, ' '), a = $('#to-a', body).value.trim().replace(/\s+/g, ' ');
        if (!name || !h || !a) { $('#to-err', body).textContent = 'Fill in the name and both sides.'; return; }
        if (same(h, a)) { $('#to-err', body).textContent = 'The two sides need different names.'; return; }
        const [oh, oa] = t.teams;
        t.fixtures.forEach(f => { f.a = same(f.a, oh) ? h : same(f.a, oa) ? a : f.a; f.b = same(f.b, oh) ? h : same(f.b, oa) ? a : f.b; });
        if (t.sim) { const s = {}; if (t.sim[oh] != null) s[h] = t.sim[oh]; if (t.sim[oa] != null) s[a] = t.sim[oa]; t.sim = s; }
        t.name = name; t.teams = [h, a];
        closeModal(); save(); toast('Tour updated');
    });
}

/* ---------- Actions ---------- */
export async function tourAction(t, a, f, b, { save, busy }) {
    switch (a) {
        case 't-manual': if (f) manualForm(t, f, save); return true;
        case 't-when': if (f) whenForm(f, save); return true;
        case 't-nr': if (f) { f.nr = true; f.simNR = false; f.manual = null; f.matchId = null; save(); toast(legOf(t, f)?.fmt === 'Test' ? 'Marked as abandoned (a draw)' : 'Marked as no result'); } return true;
        case 't-sim': if (f && simulate(t, f)) { save(); toast('Result simulated'); } return true;
        case 't-resim': if (f && isSim(f)) { f.manual = null; f.nr = false; f.simNR = false; simulate(t, f); save(); toast('Simulated again'); } return true;
        case 't-simall': { let n = 0; t.fixtures.forEach(x => { if (!busy(x) && simulate(t, x)) n++; }); save(); toast(n ? `${plural(n, 'match', 'matches')} simulated` : 'Nothing left to simulate'); return true; }
        case 't-simclear':
            if (await confirmBox('Clear simulated results?', 'Every simulated match goes back to not played. Scored and typed-in results stay.', 'Clear', true)) {
                t.fixtures.forEach(x => { if (x.manual?.sim) x.manual = null; if (x.simNR) { x.nr = false; x.simNR = false; } });
                t.sim = {}; save(); toast('Simulated results cleared');
            }
            return true;
        case 't-clear':
            if (f && await confirmBox('Clear this result?', 'The match goes back to not played. A linked scorecard stays in Saved matches.', 'Clear result')) {
                f.nr = false; f.simNR = false; f.manual = null; f.matchId = null; save();
            }
            return true;
        case 't-ladd': legForm(t, null, save); return true;
        case 't-ledit': { const l = (t.legs || []).find(x => x.id === b.dataset.l); if (l) legForm(t, l, save); return true; }
        case 't-ldel': {
            const l = (t.legs || []).find(x => x.id === b.dataset.l);
            if (l && await confirmBox(`Remove the ${FORMATS_T[l.fmt].name} series?`, 'The series and its matches are removed from the tour.', 'Remove', true)) {
                t.legs = t.legs.filter(x => x !== l); t.fixtures = t.fixtures.filter(x => x.leg !== l.id); save();
            }
            return true;
        }
        default: return false;
    }
}

// Keep a series open or closed the way the viewer left it; working inside one keeps it open.
document.addEventListener('click', e => {
    const sum = e.target.closest?.('.t-leg > summary');
    if (sum) { openLegs.set(sum.parentElement.dataset.l, !sum.parentElement.open); return; }
    const inn = e.target.closest?.('.t-leg [data-tr]');
    if (inn) openLegs.set(inn.closest('.t-leg').dataset.l, true);
});