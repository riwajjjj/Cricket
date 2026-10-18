import { alpha, axes, baseOpts, chart, pal } from '../charts.js';
import { copyText, fitText, roundRect, shareImage, showCSV, showImageModal, toCSV } from '../export.js';
import { tipBtn } from '../groups.js';
import { DLS, fmtOvers, parseOvers, profileFor, winProb } from '../maths.js';
import { RENDER, nav } from '../router.js';
import { dlsMatch } from '../stats.js';
import { testOdds } from '../testsim.js';
import { fmt } from '../state.js';
import { closeModal, confirmBox, gaugeMarkup, modal, openModal, setGauge, toast } from '../ui.js';
import { $, $$, esc, fx, nf, plural, store, uid } from '../utils.js';
import { saveMatch } from './saved.js';
/* =====================================================================
   14. LIVE SCORER
   ===================================================================== */
export let live = store.get('live', null);
export let undoStack = store.get('liveUndo', []);
if (!Array.isArray(undoStack)) undoStack = [];
if (live && (!Array.isArray(live.inns) || !live.inns.length)) live = null;

export const mkBatter = name => ({ name, runs: 0, balls: 0, f4: 0, f6: 0, dots: 0, out: false, how: 'not out' });
export const mkBowler = name => ({ name, balls: 0, runs: 0, wkts: 0, maidens: 0, dots: 0, wd: 0, nb: 0 });
export const mkOver = bowler => ({ bowler, balls: [], runs: 0, bowlerRuns: 0, wkts: 0, legal: 0 });
export function newInnings(bat, s, ns, bowler, target) {
  return { bat, runs: 0, wkts: 0, balls: 0, extras: { wd: 0, nb: 0, b: 0, lb: 0 }, batters: [mkBatter(s), mkBatter(ns)], striker: 0, non: 1,
    bowlers: [mkBowler(bowler)], bowler: 0, lastBowler: -1, overs: [mkOver(0)], freeHit: false, target, needBowler: false, fow: [], part: { runs: 0, balls: 0 }, ended: null,
    parts: [mkPart(0, 1, 1)] };
}
// One partnership: the two batters (by position in the innings), runs and balls together, and each one's share.
export const mkPart = (x, y, w) => ({ p: [x, y], w, runs: 0, balls: 0, r: [0, 0], b: [0, 0] });
// A new pair after a wicket or a retirement. An empty stand (no runs, no balls) is replaced rather than kept.
function newPart(i) {
  if (!Array.isArray(i.parts)) return; // matches started before partnerships were recorded
  const last = i.parts[i.parts.length - 1];
  const p = mkPart(i.striker, i.non, i.wkts + 1);
  if (last && !last.runs && !last.balls) i.parts[i.parts.length - 1] = p; else i.parts.push(p);
}
// Balls this innings may last: the overs per side, less anything taken off for rain.
export const maxBallsOf = (i, m = live) => i.maxBalls ?? (m.overs ? m.overs * 6 : null);
export const cur = () => live.inns[live.inns.length - 1];
// The match is saved after every action. The undo history (up to 40 full copies of the match, several
// megabytes in a long Test) is written once scoring pauses, and when the page is closed.
let undoSaveTimer = 0;
const saveUndo = () => { clearTimeout(undoSaveTimer); undoSaveTimer = 0; store.set('liveUndo', undoStack.slice(-40)); };
export function saveLive() {
  store.set('live', live);
  clearTimeout(undoSaveTimer);
  undoSaveTimer = setTimeout(saveUndo, 1500);
}
window.addEventListener('pagehide', () => { if (undoSaveTimer) saveUndo(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && undoSaveTimer) saveUndo(); });

export const howOf = b => (b.out || b.retired) ? b.how : 'not out';
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Who can still come in: unused players, or a retired batter returning.
// Squads: optional named lists per team, in batting order. Players per side follows the squad size.
export const sqOf = (m, team) => (m && Array.isArray(m.squads?.[team]) && m.squads[team].length >= 2) ? m.squads[team] : null;
export const ppsOf = (m, inn) => sqOf(m, inn.bat)?.length || m.pps;
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const selectField = (id, label, opts, sel) => `<div class="field"><div class="lab"><label for="${id}">${esc(label)}</label></div><select id="${id}">${opts.map(o => `<option value="${esc(o.v)}"${o.v === sel ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select></div>`;
export const freshLeft = i => ppsOf(live, i) - i.batters.length;
export const canBringIn = i => freshLeft(i) > 0 || i.batters.some(b => b.retired);
function bringIn(i, name) {
  const nm = (name || '').trim();
  const back = i.batters.findIndex(b => b.retired && nm && b.name.toLowerCase() === nm.toLowerCase());
  if (back !== -1 || freshLeft(i) <= 0) {
    const k = back !== -1 ? back : i.batters.findIndex(b => b.retired);
    i.batters[k].retired = false; i.batters[k].how = 'not out';
    return k;
  }
  i.batters.push(mkBatter(nm || `Batter ${i.batters.length + 1}`));
  return i.batters.length - 1;
}

export function dismissalText(how, bowler, fielder) {
  const fd = (fielder || '').trim();
  switch (how) {
    case 'bowled': return `b ${bowler}`;
    case 'caught': return fd && fd.toLowerCase() === bowler.toLowerCase() ? `c & b ${bowler}` : `c ${fd || 'fielder'} b ${bowler}`;
    case 'lbw': return `lbw b ${bowler}`;
    case 'stumped': return `st ${fd || 'keeper'} b ${bowler}`;
    case 'hit wicket': return `hit wicket b ${bowler}`;
    case 'run out': return `run out${fd ? ` (${fd})` : ''}`;
    default: return how;
  }
}

/* ---------- Recorded actions ----------
   Every change to a match goes through act(). Outside a replay it saves an undo point,
   appends the action to live.log, saves and re-renders. Replaying the log from live.init
   rebuilds the match, which is how a past ball can be edited. Core functions validate
   first and return an error message instead of changing anything. */
let replaying = false, curLi = -1;
export const matchHooks = { done: [] }; // other modules can react when a match finishes
function act(entry, core, { animate = false } = {}) {
  if (replaying) return core();
  const snap = JSON.stringify(live);
  const wasDone = live.status === 'done';
  curLi = Array.isArray(live.log) ? live.log.length : -1;
  const err = core();
  if (err) return err;
  undoStack.push(snap); if (undoStack.length > 60) undoStack.shift();
  if (Array.isArray(live.log)) live.log.push(entry);
  if (!wasDone && live.status === 'done') matchFinished();
  saveLive();
  renderLiveAll(animate);
  return null;
}
function matchFinished() {
  saveMatch(true);
  matchHooks.done.forEach(fn => { try { fn(live); } catch { /* a hook must never break scoring */ } });
}
function runEntry(e) {
  switch (e.t) {
    case 'ball': return coreBall(e.ev);
    case 'bowler': return coreBowler(e.name);
    case 'swap': return coreSwap();
    case 'retire': return coreRetire(e.who, e.name);
    case 'pen': return corePenalty(e.bat);
    case 'rename': return coreRename(e.names);
    case 'end': return coreEnd(e.reason);
    case 'start2': return coreStart2(e.s, e.ns, e.bw, e.bat, e.lost || 0);
    case 'rain': return coreRain(e.lost, e.noMore);
    case 'session': return coreSession(e.stumps);
    case 'newball': return coreNewBall();
    case 'dayovers': return coreDayOvers(e.overs);
    default: return 'an unknown action';
  }
}
// Rebuild the whole match from its starting point and a (possibly edited) log.
function rebuild(log) {
  const prev = live, init = live.init;
  live = JSON.parse(init); live.init = init; live.log = [];
  replaying = true;
  let err = null;
  for (let k = 0; k < log.length; k++) {
    curLi = k;
    err = runEntry(log[k]);
    if (err) { err = explain(log[k], err); break; }
    live.log.push(log[k]);
  }
  replaying = false;
  if (err) { live = prev; return err; }
  live.id = prev.id; live.created = prev.created; live.tournament = prev.tournament;
  return null;
}
// Turn a replay failure into something a scorer can act on.
function explain(entry, err) {
  if (/new over hadn't started|over had already ended/.test(err)) return 'it would move the end of an over that the next bowler had already started';
  if (/innings had already finished|first innings hadn't finished/.test(err)) return 'it would end an innings before balls that were scored in it';
  if (entry.t === 'bowler') return `the bowler change after it no longer works (${err.replace(/\.$/, '')})`;
  return err;
}
export const canEdit = () => !!(live && live.init && Array.isArray(live.log));
export function editLog(change) {
  if (!canEdit()) return 'This match was started before ball editing existed, so its balls can\'t be edited.';
  const snap = JSON.stringify(live);
  const wasDone = live.status === 'done';
  const log = change(live.log.map(x => JSON.parse(JSON.stringify(x))));
  const err = rebuild(log);
  if (err) return err;
  undoStack.push(snap); if (undoStack.length > 60) undoStack.shift();
  if (live.status === 'done') { if (wasDone) saveMatch(true); else matchFinished(); }
  else if (wasDone) { live.result = null; saveMatch(true); }
  saveLive();
  renderLiveAll();
  return null;
}

/* ---------- Core scoring ---------- */
function coreBall(ev) {
  const i = cur();
  if (live.status !== 'live') return 'the innings had already finished by then';
  if (i.needBowler) return 'that over had already ended, so another ball can\'t go in it';
  const over = i.overs[i.overs.length - 1];
  const bw = i.bowlers[i.bowler];
  const strikerBefore = i.striker, nonBefore = i.non;
  const st = i.batters[i.striker];
  const cm = commSink ? { ballNo: `${Math.floor(i.balls / 6)}.${(i.balls % 6) + 1}`, runsBefore: st.runs, wkBefore: bw.wkts, partBefore: i.part.runs } : null;
  let legal = true, total = 0, bowlerRuns = 0, ran = 0, label = '', cls = '', noneLeft = false;
  const r = ev.runs || 0;
  const dot = () => { st.dots = (st.dots || 0) + 1; };
  switch (ev.type) {
    case 'run':
      st.runs += r; st.balls++; if (r === 0) dot();
      if (!ev.ot) { if (r === 4) st.f4++; if (r === 6) st.f6++; }
      total = bowlerRuns = r; ran = ev.ran ?? r;
      label = r === 0 ? '•' : String(r) + (ev.ot ? 'ot' : ''); cls = ev.ot ? '' : r === 0 ? 'd0' : r === 4 ? 'd4' : r === 6 ? 'd6' : '';
      break;
    case 'wd':
      legal = false; total = bowlerRuns = 1 + r; i.extras.wd += total; bw.wd++; ran = r;
      label = r ? `${total}wd` : 'wd'; cls = 'dx';
      break;
    case 'nb':
      legal = false; total = bowlerRuns = 1 + r; i.extras.nb += 1; bw.nb++;
      st.runs += r; st.balls++; if (r === 0) dot(); if (r === 4) st.f4++; if (r === 6) st.f6++; ran = r;
      label = r ? `nb+${r}` : 'nb'; cls = 'dx';
      break;
    case 'b': case 'lb':
      total = r; i.extras[ev.type] += r; st.balls++; dot(); ran = ev.ran ?? r;
      label = `${r}${ev.type}`; cls = 'dx';
      break;
    case 'wkt': {
      const ro = ev.how === 'run out';
      if (ev.ball === 'wd') { // stumped, hit wicket or run out off a wide
        legal = false; total = bowlerRuns = 1 + r; i.extras.wd += total; bw.wd++; ran = r;
        label = 'wd+W';
      } else if (ev.ball === 'nb') { // only a run out is possible off a no-ball
        legal = false; total = bowlerRuns = 1 + r; i.extras.nb += 1; bw.nb++;
        st.runs += r; st.balls++; if (r === 0) dot(); ran = r;
        label = 'nb+W';
      } else {
        st.balls++;
        if (ro) { st.runs += r; total = bowlerRuns = r; ran = r; }
        if (!ro || r === 0) dot();
        label = ro && r ? `W+${r}` : 'W';
      }
      if (!ro) bw.wkts++;
      cls = 'dw';
      break;
    }
    default: return 'an unknown kind of ball';
  }
  i.runs += total; bw.runs += bowlerRuns; over.runs += total; over.bowlerRuns += bowlerRuns;
  i.part.runs += total;
  if (legal) { i.balls++; bw.balls++; over.legal++; i.part.balls++; if (bowlerRuns === 0) bw.dots++; }
  over.balls.push({ l: label, c: cls, li: curLi });

  // Batter-vs-bowler match-ups (keyed by position in this innings, so renames don't break them)
  const wideBall = ev.type === 'wd' || (ev.type === 'wkt' && ev.ball === 'wd');
  const ro = ev.type === 'wkt' && ev.how === 'run out';
  const batRuns = ev.type === 'run' || ev.type === 'nb' ? r : (ev.type === 'wkt' && ro && ev.ball !== 'wd' ? r : 0);
  i.mu = i.mu || {};
  const mk = `${i.bowler}|${strikerBefore}`;
  const mu = i.mu[mk] || (i.mu[mk] = { balls: 0, runs: 0, dots: 0, f4: 0, f6: 0, outs: 0 });
  if (!wideBall) {
    mu.balls++; mu.runs += batRuns; if (batRuns === 0) mu.dots++;
    if (!ev.ot && (ev.type === 'run' || ev.type === 'nb')) { if (r === 4) mu.f4++; if (r === 6) mu.f6++; }
  }
  if (ev.type === 'wkt' && !ro) mu.outs++;
  // Where the shot went (wagon wheel), when the scorer tapped it
  if (ev.ww && batRuns > 0 && isFinite(ev.ww.x) && isFinite(ev.ww.y)) (st.shots = st.shots || []).push({ x: +ev.ww.x.toFixed(3), y: +ev.ww.y.toFixed(3), r: batRuns });
  // Partnership: every run counts for the pair; the striker's own runs and balls are tracked too.
  const pt = Array.isArray(i.parts) ? i.parts[i.parts.length - 1] : null;
  if (pt) {
    pt.runs += total; if (legal) pt.balls++;
    const s = pt.p.indexOf(strikerBefore);
    if (s !== -1) { pt.r[s] += batRuns; if (!wideBall) pt.b[s]++; }
  }

  if (ran % 2 === 1) { const t = i.striker; i.striker = i.non; i.non = t; }

  const stand = { runs: i.part.runs, balls: i.part.balls }; // the partnership including this ball
  if (ev.type === 'wkt') {
    const outIdx = ev.how === 'run out' && ev.outWho === 'non' ? nonBefore : strikerBefore;
    const ob = i.batters[outIdx];
    ob.out = true;
    ob.how = dismissalText(ev.how, bw.name, ev.fielder);
    ob.dis = { how: ev.how, bowler: ev.how === 'run out' ? '' : bw.name, fielder: (ev.fielder || '').trim() };
    i.wkts++; over.wkts++;
    i.fow.push({ score: i.runs, wkt: i.wkts, name: ob.name, over: fmtOvers(i.balls) });
    i.part = { runs: 0, balls: 0 };
    if (canBringIn(i)) {
      const ni = bringIn(i, ev.newBatter);
      if (i.striker === outIdx) i.striker = ni; else if (i.non === outIdx) i.non = ni;
      newPart(i);
    } else noneLeft = true;
  }

  if ((ev.type === 'nb' || (ev.type === 'wkt' && ev.ball === 'nb')) && !isTest()) i.freeHit = true;
  else if (legal) i.freeHit = false;

  let overDone = false;
  if (legal && i.balls % 6 === 0) {
    overDone = true;
    if (over.legal === 6 && over.bowlerRuns === 0) bw.maidens++;
    const t = i.striker; i.striker = i.non; i.non = t;
  }
  if (cm) {
    commentBall({ i, ev, bw, st, cm, total, r, batRuns, stand, strikerBefore, nonBefore, noneLeft });
    if (overDone) commentOver(i, over, bw);
  }

  const cap = maxBallsOf(i);
  const oversDone = cap != null && i.balls >= cap;
  const chased = i.target != null && i.runs >= i.target;
  if (noneLeft || oversDone || chased) endInnings(chased ? 'target' : noneLeft ? 'all out' : 'overs');
  else if (overDone) { i.lastBowler = i.bowler; i.needBowler = true; }
  return null;
}
let ballTarget = null; // { mode: 'replace' | 'insert', li } while a past ball is being edited
// If an edit's follow-up dialog is cancelled, forget the pending edit (checked after any synchronous submit).
new MutationObserver(() => { if (modal.hidden && ballTarget) ballTarget = null; }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
/* ---------- Commentary ----------
   Not stored: it is rebuilt by replaying the match's action log on a scratch copy, with commSink
   collecting lines as each ball is scored. Edited balls therefore correct the commentary too, and
   saved matches get it as well. Matches scored before the action log existed have none. */
let commSink = null;
const say = (kind, text, o = '') => { if (commSink) commSink.push({ inn: live.inns.length - 1, o, kind, text }); };
function commentBall({ i, ev, bw, st, cm, total, r, batRuns, stand, strikerBefore, nonBefore, noneLeft }) {
  const where = ev.ww && batRuns > 0 && isFinite(ev.ww.x) && isFinite(ev.ww.y) ? ` to ${shotPhrase(ev.ww, lefty(st.name))}` : '';
  const big = n => (n === 4 ? 'FOUR' : n === 6 ? 'SIX' : plural(n, 'run'));
  let kind = 'ball', text = '';
  switch (ev.type) {
    case 'run':
      if (ev.ot) text = `${plural(r, 'run')}, overthrows included${where}`;
      else if (r === 4 || r === 6) { kind = r === 4 ? 'four' : 'six'; text = `${big(r)}${where}`; }
      else text = r === 0 ? 'no run' : `${plural(r, 'run')}${where}`;
      break;
    case 'wd': kind = 'extra'; text = total === 1 ? 'wide' : `wide, ${total} runs in all`; break;
    case 'nb':
      kind = r === 4 ? 'four' : r === 6 ? 'six' : 'extra';
      text = r ? `no-ball, and ${big(r)} off the bat${where}` : 'no-ball';
      if (!isTest()) text += '. Free hit next';
      break;
    case 'b': kind = 'extra'; text = plural(r, 'bye'); break;
    case 'lb': kind = 'extra'; text = plural(r, 'leg bye'); break;
    case 'wkt': {
      kind = 'wkt';
      const ob = i.batters[ev.how === 'run out' && ev.outWho === 'non' ? nonBefore : strikerBefore];
      text = `OUT! ${ob.name} ${ob.how}, ${ob.runs} (${ob.balls})${ev.ball === 'wd' ? ', off a wide' : ev.ball === 'nb' ? ', off a no-ball' : ''}${ev.how === 'run out' && r ? `, after ${plural(r, 'run')}` : ''}`;
      break;
    }
    default: return;
  }
  say(kind, `${bw.name} to ${st.name}, ${text}`, cm.ballNo);
  const x = [...BAT_MARKS].reverse().find(m => cm.runsBefore < m && st.runs >= m);
  if (x) say('ms', `${cap1(markName(x))} for ${st.name}: ${st.runs} off ${plural(st.balls, 'ball')}`);
  if (cm.wkBefore < 10 && bw.wkts >= 10) say('ms', `All ten for ${bw.name}: ${bw.wkts}/${bw.runs}`);
  else if (cm.wkBefore < 5 && bw.wkts >= 5) say('ms', `Five-for for ${bw.name}: ${bw.wkts}/${bw.runs}`);
  if (ev.type === 'wkt') {
    const outK = ev.how === 'run out' && ev.outWho === 'non' ? nonBefore : strikerBefore;
    const survivor = outK === strikerBefore ? nonBefore : strikerBefore;
    const inK = [i.striker, i.non].find(k => k !== survivor);
    say('fow', `Fall of wicket: ${i.runs}/${i.wkts} (${i.batters[outK].name}, ${fmtOvers(i.balls)} ov). The stand was ${stand.runs} off ${plural(stand.balls, 'ball')}.${!noneLeft && i.batters[inK] ? ` ${i.batters[inK].name} comes in.` : ''}`);
  } else {
    const px = [...PART_MARKS].reverse().find(m => cm.partBefore < m && i.part.runs >= m);
    if (px) say('ms', `${px}-run partnership between ${i.batters[i.striker].name} and ${i.batters[i.non].name}`);
  }
}
function commentOver(i, over, bw) {
  const crease = [i.striker, i.non].map(k => i.batters[k]).filter(b => b && !b.out).map(b => `${b.name} ${b.runs}* (${b.balls})`).join(', ');
  const cap = maxBallsOf(i);
  const chase = i.target != null && i.target > i.runs && cap != null && cap > i.balls ? ` · need ${i.target - i.runs} off ${plural(cap - i.balls, 'ball')}` : '';
  const maiden = over.legal === 6 && over.bowlerRuns === 0;
  say('over', `End of over ${i.balls / 6}: ${plural(over.runs, 'run')}${maiden ? ' (maiden)' : ''}${over.wkts ? `, ${plural(over.wkts, 'wicket')}` : ''} · ${live.teams[i.bat]} ${i.runs}/${i.wkts}${chase}${crease ? ` · ${crease}` : ''} · ${bw.name} ${fmtOvers(bw.balls)}-${bw.maidens}-${bw.runs}-${bw.wkts}`);
}
// Lines for actions other than balls, worked out from the match before and after the action.
function commentAction(e, before) {
  const i = cur();
  switch (e.t) {
    case 'bowler': {
      const b = i.bowlers[i.bowler];
      if (b && b.balls === 0 && !before.bowlers.includes(b.name.toLowerCase())) say('event', `${b.name} comes into the attack`);
      break;
    }
    case 'start2': {
      const team = live.teams[i.bat];
      say('event', `${team} begin the ${ORD[live.inns.length - 1]} innings${i.target != null ? `, needing ${i.target} to win${i.dls && i.maxBalls != null ? ` off ${fmtOvers(i.maxBalls)} overs (DLS)` : ''}` : ''}. ${i.batters[0].name} and ${i.batters[1].name} open; ${i.bowlers[0].name} to bowl.`);
      break;
    }
    case 'retire': { const r = i.batters.find(b => b.retired && before.crease.includes(b.name)); if (r) say('event', `${r.name} retires hurt, ${r.runs} (${r.balls})`); break; }
    case 'pen': say('event', `5 penalty runs to ${e.bat ? live.teams[i.bat] : live.teams[1 - i.bat]}`); break;
    case 'session': { const s = live.sessions?.[live.sessions.length - 1]; if (s) say('session', `${s.label}, day ${s.day}: ${s.text}`); break; }
    case 'dayovers': say('event', `Overs for day ${clockOf().day} set to ${e.overs}${e.overs < 90 ? ' (time lost to rain or bad light)' : e.overs > 90 ? ' (extra time to make up lost overs)' : ''}`); break;
    case 'newball': say('event', `New ball taken after ${fmtOvers(i.balls - (before.newBallFrom || 0))} overs`); break;
    case 'rain': {
      const k = live.inns.length - 1, stop = live.rain?.stops[k]?.slice(-1)[0];
      if (!stop) break;
      const inn = live.inns[k];
      say('event', `Rain stops play: ${fmtOvers(stop.lost)} overs lost.${k === 1 && inn.dls ? ` Revised target ${inn.target} off ${fmtOvers(inn.maxBalls)} overs.` : k === 0 && !inn.ended ? ` ${live.teams[inn.bat]} now have ${fmtOvers(inn.maxBalls)} overs.` : ''}`);
      break;
    }
    default: break;
  }
}
export function commentaryOf(m) {
  if (!m || !m.init || !Array.isArray(m.log)) return null;
  // Scoring only appends to the log, so pick up the replay where it stopped last time.
  let st = commState.get(m.log);
  if (!st || st.k > m.log.length) {
    st = { scratch: null, k: 0, out: [], ended: new Set(), failed: false };
    commState.set(m.log, st);
  }
  if (st.k === m.log.length || st.failed) return st.out;
  const keep = { live, replaying, curLi };
  try {
    replaying = true; commSink = st.out;
    if (!st.scratch) {
      live = JSON.parse(m.init); live.init = m.init; live.log = [];
      const i0 = live.inns[0];
      say('event', `${live.teams[0]} v ${live.teams[1]}${live.format ? `, ${live.format}` : ''}. ${live.teams[i0.bat]} bat first: ${i0.batters[0].name} and ${i0.batters[1].name} open; ${i0.bowlers[0].name} to bowl.`);
      st.scratch = live;
    } else live = st.scratch;
    for (; st.k < m.log.length; st.k++) {
      curLi = st.k;
      const c = cur();
      const before = { bowlers: c.bowlers.map(b => b.name.toLowerCase()), crease: [c.batters[c.striker]?.name, c.batters[c.non]?.name], newBallFrom: c.newBall || 0 };
      if (runEntry(m.log[st.k])) { st.failed = true; break; }
      if (m.log[st.k].t !== 'ball') commentAction(m.log[st.k], before);
      live.inns.forEach((inn, j) => {
        if (!inn.ended || st.ended.has(j)) return;
        st.ended.add(j);
        commSink.push({ inn: j, o: '', kind: 'end', text: `${live.teams[inn.bat]} ${scoreTxt(inn)} (${fmtOvers(inn.balls)} ov): ${endedText(inn.ended, live)}` });
      });
      if (live.status === 'done' && live.result && !st.out.some(x => x.kind === 'result')) say('result', live.result);
    }
  } finally {
    ({ live, replaying, curLi } = keep);
    commSink = null;
  }
  return st.out;
}
// One replay per log array: identity changes on undo, edits and loading a saved match, so those start afresh.
const commState = new WeakMap();
const commLi = e => `<li class="cm cm-${e.kind}"><span class="cm-o">${esc(e.o)}</span><span class="cm-t">${esc(e.text)}</span></li>`;
// Latest lines for the scorer. Built just after the screen updates, so a ball never waits for it.
let commTimer = 0;
function commentaryCardHTML(m = live) {
  if (!m || !m.init || !Array.isArray(m.log)) return '';
  const st = commState.get(m.log);
  const hit = st && st.k === m.log.length ? st.out : null;
  if (!hit) { clearTimeout(commTimer); commTimer = setTimeout(fillCommentary, 20); }
  return `<div class="card comm-card">
    <div class="sc-head" style="margin-bottom:10px"><h2 class="card-title" style="margin:0">Commentary</h2><button type="button" class="btn ghost sm" data-act="comm">Full commentary</button></div>
    <ul class="cm-list" id="comm-latest">${hit ? latestHTML(hit) : '<li class="cm"><span class="cm-o"></span><span class="cm-t dim">Writing the commentary…</span></li>'}</ul>
  </div>`;
}
const latestHTML = list => (list.length ? list.slice(-10).reverse().map(commLi).join('') : '<li class="cm"><span class="cm-o"></span><span class="cm-t dim">The first ball goes here.</span></li>');
function fillCommentary() {
  const el = $('#comm-latest');
  if (!el || !live) return;
  const list = commentaryOf(live);
  if (list) el.innerHTML = latestHTML(list);
}
// The whole match, newest first, grouped by innings, with a plain-text copy.
export function openCommentary(m, title) {
  const list = commentaryOf(m);
  if (!list) { toast('This match was scored before commentary existed.'); return; }
  const groups = [];
  list.forEach(e => { const g = groups[groups.length - 1]; if (g && g.inn === e.inn) g.items.push(e); else groups.push({ inn: e.inn, items: [e] }); });
  const head = k => { const inn = m.inns[k]; return inn ? `${m.teams[inn.bat]} · ${isTest(m) ? `${ORD[k]} innings` : `innings ${k + 1}`}` : ''; };
  const text = list.map(e => `${e.o ? e.o + '  ' : ''}${e.text}`).join('\n');
  const body = openModal(`Commentary: ${title}`, `
    <div class="modal-actions" style="justify-content:flex-start;margin:-4px 0 12px"><button type="button" class="btn ghost sm" data-x="copy">Copy as text</button></div>
    ${groups.reverse().map(g => `<p class="modal-sub" style="margin:14px 0 6px">${esc(head(g.inn))}</p><ul class="cm-list">${g.items.slice().reverse().map(commLi).join('')}</ul>`).join('')}
    <textarea class="csv-box" readonly aria-label="Commentary as text" hidden>${esc(text)}</textarea>`, { wide: true });
  body.addEventListener('click', e => { if (e.target.closest('[data-x="copy"]')) copyText(text, $('.csv-box', body)); });
}

/* ---------- Milestones in play ----------
   Chips under the scoreboard when a batter, bowler or partnership is close to a landmark,
   and a toast when one is reached. */
const BAT_MARKS = [50, 100, 150, 200, 250, 300, 350, 400];
const PART_MARKS = [50, 100, 150, 200, 250, 300];
const markName = n => ({ 50: 'fifty', 100: 'hundred', 200: 'double hundred', 300: 'triple hundred' })[n] || String(n);
const cap1 = s => s[0].toUpperCase() + s.slice(1);
function alertsHTML(i) {
  if (!live || live.status !== 'live') return '';
  const out = [];
  [i.striker, i.non].forEach(k => {
    const b = i.batters[k];
    const nx = b && BAT_MARKS.find(x => x > b.runs);
    if (nx && nx - b.runs <= 10) out.push(`${esc(b.name)} ${b.runs}*: ${nx - b.runs} from a ${markName(nx)}`);
  });
  [i.bowler, i.lastBowler].filter((k, j, a) => k >= 0 && a.indexOf(k) === j).forEach(k => {
    const w = i.bowlers[k];
    if (w && (w.wkts === 4 || w.wkts === 9)) out.push(`${esc(w.name)} ${w.wkts}/${w.runs}: one more for ${w.wkts === 4 ? 'a five-for' : 'all ten'}`);
  });
  const pn = PART_MARKS.find(x => x > i.part.runs);
  if (pn && i.part.runs > 0 && pn - i.part.runs <= 10) out.push(`Partnership ${i.part.runs}: ${pn - i.part.runs} from a ${pn}-run stand`);
  return out.length ? `<div class="ms-alerts" aria-live="polite">${out.map(t => `<span class="ms-alert">${t}</span>`).join('')}</div>` : '';
}
function msState() {
  if (!live || live.status !== 'live') return null;
  const i = cur();
  return { n: live.inns.length, bats: i.batters.map(b => b.runs), wk: i.bowlers.map(b => b.wkts), part: i.part.runs, parts: Array.isArray(i.parts) ? i.parts.length : -1 };
}
function msAnnounce(was) {
  if (!was) return;
  const i = live.inns[was.n - 1];
  if (!i) return;
  const msgs = [];
  i.batters.forEach((b, k) => {
    const x = [...BAT_MARKS].reverse().find(m => (was.bats[k] ?? 0) < m && b.runs >= m);
    if (x) msgs.push(`${cap1(markName(x))} for ${b.name}: ${b.runs}${b.out ? '' : '*'} (${b.balls})`);
  });
  i.bowlers.forEach((w, k) => {
    const before = was.wk[k] ?? 0;
    if (before < 10 && w.wkts >= 10) msgs.push(`All ten for ${w.name}: ${w.wkts}/${w.runs}`);
    else if (before < 5 && w.wkts >= 5) msgs.push(`Five-for for ${w.name}: ${w.wkts}/${w.runs}`);
  });
  const sameStand = Array.isArray(i.parts) ? i.parts.length === was.parts : i.part.runs >= was.part;
  const px = sameStand && [...PART_MARKS].reverse().find(m => was.part < m && i.part.runs >= m);
  if (px) msgs.push(`${px}-run partnership`);
  if (msgs.length) toast(msgs.join(' · '));
}
export function applyBall(ev) {
  if (ballTarget) {
    const t = ballTarget; ballTarget = null;
    const err = editLog(log => { if (t.mode === 'replace') log[t.li] = { t: 'ball', ev }; else log.splice(t.li, 0, { t: 'ball', ev }); return log; });
    toast(err ? `Can't make that change: ${err}.` : t.mode === 'replace' ? 'Ball changed. The match was recalculated.' : 'Ball added. The match was recalculated.');
    return;
  }
  if (!live || live.status !== 'live' || cur().needBowler) return;
  const was = msState();
  const err = act({ t: 'ball', ev }, () => coreBall(ev), { animate: true });
  if (!err) msAnnounce(was);
}
// The match as it stood just before log entry li (used so edit dialogs show the right batters).
function stateBefore(li) {
  const real = live;
  if (rebuild(real.log.slice(0, li))) { live = real; return null; }
  const before = live; live = real;
  return before;
}
// Open a ball-entry dialog against the match as it was at that ball, then return to the present.
function withStateAt(li, open) {
  const before = stateBefore(li);
  if (!before) { toast('That ball can\'t be edited.'); return; }
  const real = live;
  live = before;
  try { open(); } finally { live = real; }
}
function openEditBall(li) {
  if (!canEdit() || !live.log[li]) return;
  const entry = live.log[li];
  let label = '', cls = '', where = '';
  live.inns.forEach((inn, k) => inn.overs.forEach((o, n) => o.balls.forEach(b => { if (b.li === li) { label = b.l; cls = b.c; where = `${live.teams[inn.bat]} innings, over ${n + 1}, bowled by ${inn.bowlers[o.bowler]?.name || '?'}`; } })));
  if (entry.t !== 'ball') {
    const body = openModal('Edit penalty runs', `<p style="margin:0;color:var(--fg-2)">${esc(where)}: 5 penalty runs.</p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn solid-danger" data-x="del">Remove penalty</button></div>`);
    body.addEventListener('click', e => {
      const x = e.target.closest('[data-x]'); if (!x) return;
      closeModal();
      if (x.dataset.x === 'del') { const err = editLog(log => { log.splice(li, 1); return log; }); toast(err ? `Can't remove it: ${err}.` : 'Penalty removed'); }
    });
    return;
  }
  let mode = 'replace';
  const keys = [['run', 0, '•'], ['run', 1, '1'], ['run', 2, '2'], ['run', 3, '3'], ['run', 4, '4'], ['run', 6, '6'], ['wkt', '', 'W'], ['wd', '', 'WD'], ['nb', '', 'NB'], ['b', '', 'BYE'], ['lb', '', 'LB'], ['more', '', 'MORE']];
  const body = openModal('Fix a ball', `
    <p style="margin:0 0 14px;color:var(--fg-2)"><span class="bdot ${esc(cls)}" style="margin-right:8px">${esc(label)}</span>${esc(where)}</p>
    <div class="modal-block"><div class="seg" id="eb-mode"><button type="button" data-mode="replace" aria-pressed="true">Change this ball</button><button type="button" data-mode="insert" aria-pressed="false">Add a missed ball before it</button></div></div>
    <div class="modal-block"><p class="modal-sub" id="eb-sub">It should have been</p>
      <div class="pad edit-pad">${keys.map(([a, r, l]) => `<button type="button" data-k="${a}" data-r="${r}" class="${a === 'wkt' ? 'kw' : ['wd', 'nb', 'b', 'lb', 'more'].includes(a) ? 'kx' : r === 4 ? 'k4' : r === 6 ? 'k6' : ''}">${l}</button>`).join('')}</div>
    </div>
    <p class="hint">Everything after this ball is recalculated. If the change would move the end of an over that the next bowler has already started, it's refused and nothing changes.</p>
    <div class="modal-actions"><button type="button" class="btn ghost danger" data-x="del">Delete this ball</button><button type="button" class="btn ghost" data-x="cancel">Cancel</button></div>`);
  body.addEventListener('click', e => {
    const m = e.target.closest('[data-mode]'), k = e.target.closest('[data-k]'), x = e.target.closest('[data-x]');
    if (m) { mode = m.dataset.mode; body.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode))); $('#eb-sub').textContent = mode === 'replace' ? 'It should have been' : 'The missed ball was'; }
    if (x) {
      closeModal();
      if (x.dataset.x === 'del') { const err = editLog(log => { log.splice(li, 1); return log; }); toast(err ? `Can't delete it: ${err}.` : 'Ball deleted. The match was recalculated.'); }
      return;
    }
    if (!k) return;
    const kind = k.dataset.k;
    closeModal();
    ballTarget = { mode, li };
    if (kind === 'run') { applyBall({ type: 'run', runs: Number(k.dataset.r) }); return; }
    withStateAt(li, () => liveAction(kind === 'more' ? 'more' : kind, null));
    if (modal.hidden) ballTarget = null; // dialog didn't open
  });
}

function coreRetire(who, name) {
  const i = cur();
  if (live.status !== 'live') return 'the innings had already finished';
  if (!canBringIn(i)) return 'nobody was left to come in';
  const idx = who === 'non' ? i.non : i.striker;
  const b = i.batters[idx];
  b.retired = true; b.how = 'retired hurt';
  const ni = bringIn(i, name);
  if (i.striker === idx) i.striker = ni; else i.non = ni;
  i.part = { runs: 0, balls: 0 };
  newPart(i);
  return null;
}
export function retireBatter(who, name) { return !act({ t: 'retire', who, name }, () => coreRetire(who, name)); }

function corePenalty(toBatting) {
  const i = cur();
  if (live.status !== 'live') return 'the innings had already finished';
  if (toBatting) {
    i.runs += 5; i.extras.pen = (i.extras.pen || 0) + 5;
    const o = i.overs[i.overs.length - 1]; // show it in the over and the charts
    o.runs += 5; o.balls.push({ l: '5pen', c: 'dx', li: curLi });
    if (i.target != null && i.runs >= i.target) endInnings('target');
  } else {
    const fld = 1 - i.bat;
    const prev = [...live.inns].reverse().find(x => x !== i && x.bat === fld);
    if (prev) {
      // The fielding side has already batted: add to their latest innings, so any target rises.
      prev.runs += 5; prev.extras.pen = (prev.extras.pen || 0) + 5;
      const lastO = prev.overs.filter(o => o.balls.length).pop() || prev.overs[prev.overs.length - 1];
      lastO.runs += 5;
      if (i.target != null) i.target += 5;
    } else {
      live.pendingPen = (live.pendingPen || 0) + 5; // added when they start batting
      live.pendingPenTeam = fld;
    }
  }
  return null;
}
export function awardPenalty(toBatting) { act({ t: 'pen', bat: toBatting }, () => corePenalty(toBatting)); }

function coreSwap() {
  if (live.status !== 'live') return 'the innings had already finished';
  const i = cur(); const t = i.striker; i.striker = i.non; i.non = t;
  return null;
}
function coreEnd(reason) {
  if (reason === 'draw') return coreEndAny('draw');
  if (reason === 'abandoned') return coreAbandon();
  if (live.status !== 'live') return 'the innings had already finished';
  endInnings(reason);
  return null;
}
// Limited overs: play stopped for good (rain, bad light) with no result.
function coreAbandon() {
  if (live.status === 'done') return 'the match had already finished';
  if (live.status === 'live') { const i = cur(); i.ended = 'abandoned'; i.needBowler = false; i.freeHit = false; }
  live.status = 'done'; live.result = 'No result';
  return null;
}
function coreEndAny(reason) {
  if (live.status === 'done') return 'the match had already finished';
  if (live.status === 'break') { live.status = 'done'; live.result = 'Match drawn'; return null; }
  endInnings(reason);
  return null;
}

/* ---------- Rain (limited overs) ----------
   A stoppage takes overs off the innings in play. Overs lost from the first innings lower Team 1's
   resources; Team 2's target then comes from the same DLS-style resource model as the Rain target tab. */
const minResultOvers = n => (n >= 50 ? 20 : n >= 20 ? 5 : Math.max(1, Math.ceil(n / 4)));
export const rainHit = (m = live) => !!(m && m.rain && m.rain.stops.some(s => s.length));
const wkScale = (m, i) => i.wkts + (11 - ppsOf(m, i)); // smaller sides mapped onto the 10-wicket model
// Team 2's target, allocation and current par. `lost2` previews overs lost before the chase starts.
export function dlsFor(m = live, lost2 = 0) {
  const i1 = m.inns[0], i2 = m.inns[1];
  const stops = m.rain ? m.rain.stops : [[], []];
  const stops2 = i2 ? stops[1] : (lost2 > 0 ? [{ u: 0, w: 0, lost: lost2 }] : []);
  return dlsMatch({ S: i1.runs, n1Balls: m.overs * 6, stops1: stops[0], n2Balls: maxBallsOf(i1, m), stops2, formatOvers: m.overs, balls2: i2 ? i2.balls : 0, wkts2: i2 ? wkScale(m, i2) : 0 });
}
// What the side batting second will chase, before its innings starts.
export function plannedChase(m = live, lost2 = 0) {
  const i1 = m.inns[0];
  if (isTest(m) || !m.overs || (!rainHit(m) && !(lost2 > 0))) return { target: i1.runs + 1, balls: m.overs ? maxBallsOf(i1, m) : null, dls: false };
  const d = dlsFor(m, lost2);
  return { target: d.target, balls: d.alloc2, dls: true };
}
function coreRain(lost, noMore) {
  if (live.status !== 'live') return 'the innings had already finished';
  if (isTest() || !live.overs) return 'rain targets only apply to limited-overs matches';
  const i = cur(), k = live.inns.length - 1;
  const alloc = maxBallsOf(i), left = alloc - i.balls;
  const take = noMore ? left : lost;
  if (!Number.isInteger(take) || take <= 0) return left <= 0 ? 'no overs were left to lose' : 'enter the overs lost';
  if (take > left) return `only ${fmtOvers(left)} overs were left to lose`;
  if (!live.rain) live.rain = { stops: [[], []] };
  live.rain.stops[k].push({ u: i.balls, w: wkScale(live, i), lost: take });
  i.maxBalls = alloc - take;
  if (k === 0) {
    if (i.maxBalls <= i.balls) endInnings('rain');
    return null;
  }
  const d = dlsFor();
  i.target = d.target; i.dls = true;
  if (i.maxBalls <= i.balls) {
    // No more play. Short of the minimum overs there is no result; otherwise the par score decides.
    if (i.balls < minResultOvers(live.overs) * 6) {
      i.ended = 'abandoned'; i.needBowler = false; i.freeHit = false;
      live.status = 'done'; live.result = 'No result';
      return null;
    }
    live.dlsPar = d.parNow;
    endInnings('rain');
    return null;
  }
  if (i.runs >= i.target) endInnings('target');
  return null;
}
export function applyRain(lost, noMore) { return act({ t: 'rain', lost, noMore: !!noMore }, () => coreRain(lost, noMore)); }

function renameInSquad(team, old, nm) {
  const sq = live.squads?.[team];
  if (!sq) return;
  const k = sq.findIndex(x => sameName(x, old));
  if (k !== -1) sq[k] = nm;
  if (live.keepers?.[team] && sameName(live.keepers[team], old)) live.keepers[team] = nm;
  if (live.captains?.[team] && sameName(live.captains[team], old)) live.captains[team] = nm;
  if (replaying) return;
  const saved = squadStore(), key = live.teams[team].toLowerCase(); // keep the remembered squad in step
  if (saved[key]) {
    const j = saved[key].findIndex(x => sameName(x.replace(ROLE_MARK, ' ').trim(), old));
    if (j !== -1) {
      const was = saved[key][j];
      saved[key][j] = nm + (IS_CAPT.test(was) ? ' (c)' : '') + (IS_WK.test(was) ? ' (wk)' : '');
      store.set('squads', saved);
    }
  }
}
// Rename one player of a team everywhere: as a batter, as a bowler, and in dismissals they took part in.
function renamePlayer(team, old, nm) {
  const swap = (s, from, to) => s.replace(new RegExp(`(^|[^\\w])${escRe(from)}(?=$|[^\\w])`, 'g'), (m, pre) => pre + to);
  live.inns.forEach(inn => {
    if (inn.bat === team) {
      inn.batters.forEach(b => { if (sameName(b.name, old)) b.name = nm; });
      inn.fow.forEach(w => { if (sameName(w.name, old)) w.name = nm; });
    } else {
      inn.bowlers.forEach(b => { if (sameName(b.name, old)) b.name = nm; });
      inn.batters.forEach(bt => {
        if (!bt.out) return;
        bt.how = swap(bt.how, old, nm);
        if (bt.dis) { if (bt.dis.bowler && sameName(bt.dis.bowler, old)) bt.dis.bowler = nm; if (bt.dis.fielder && sameName(bt.dis.fielder, old)) bt.dis.fielder = nm; }
      });
    }
  });
  renameInSquad(team, old, nm);
}
function coreRename(names) {
  names.teams.forEach((t, k) => { if (t) live.teams[k] = t; });
  const pairs = [];
  live.inns.forEach((inn, k) => {
    (names.bowlers[k] || []).forEach((nm, j) => { const b = inn.bowlers[j]; if (b && nm && nm !== b.name) pairs.push([1 - inn.bat, b.name, nm]); });
    (names.batters[k] || []).forEach((nm, j) => { const b = inn.batters[j]; if (b && nm && nm !== b.name) pairs.push([inn.bat, b.name, nm]); });
  });
  pairs.forEach(([team, old, nm]) => renamePlayer(team, old, nm));
  return null;
}
export function renameAll(names) { act({ t: 'rename', names }, () => coreRename(names)); }

export const isTest = (m = live) => !!m && m.matchType === 'test';
const ORD = ['1st', '2nd', '3rd', '4th'];
const teamTotal = (team, m = live) => m.inns.filter(x => x.bat === team).reduce((s, x) => s + x.runs, 0);
// Test cricket: who bats next, and whether the follow-on can be enforced.
export function testNext(m = live) {
  const n = m.inns.length, [a, b] = m.inns;
  if (n === 1) return { bat: 1 - a.bat, canFollowOn: false };
  if (n === 2) {
    const lead = a.runs - b.runs;
    const canFollowOn = lead >= (m.followOn || 200);
    return { bat: a.bat, canFollowOn, lead };
  }
  const counts = [0, 1].map(t => m.inns.filter(x => x.bat === t).length);
  return { bat: counts[0] === 1 ? 0 : 1, canFollowOn: false };
}
function testNeed(team4, m = live) { return teamTotal(1 - team4, m) - teamTotal(team4, m) + 1; }

/* ---------- Test cricket: days and sessions ----------
   The scorer ends each session (Lunch, Tea, Stumps). A day is 90 overs; stumps called early loses the
   rest of that day, and stumps on the last day ends the match as a draw. Each finished session keeps the
   innings totals at its end, so runs, wickets and overs per session can be worked out afterwards. */
const DAY_BALLS = 90 * 6;
export const SESS = ['Morning', 'Afternoon', 'Evening'], SESS_END = ['Lunch', 'Tea', 'Stumps'];
const snapInns = (m = live) => m.inns.map(i => ({ bat: i.bat, runs: i.runs, wkts: i.wkts, balls: i.balls }));
const ballsOf = s => s.reduce((a, x) => a + x.balls, 0);
// The match clock. Matches started before sessions existed count everything so far as day 1, morning.
export const clockOf = (m = live) => m.clock || { day: 1, s: 0, start: [], dayStart: [] };
export const todayBalls = (m = live) => ballsOf(snapInns(m)) - ballsOf(clockOf(m).dayStart);
// Balls left in the match: what's left of today plus the remaining days. Overs bowled beyond 90 in a day
// (if Stumps is never pressed) come out of the days still to come.
// Overs scheduled for a day: 90 unless changed (a late start for rain, or extra time to make up lost overs).
export const dayBalls = (m = live, d = clockOf(m).day) => { const o = (m.dayOvers || {})[d]; return o != null ? o * 6 : DAY_BALLS; };
export function matchBallsLeft(m = live) {
  let t = 0;
  for (let d = clockOf(m).day; d <= (m.days || 5); d++) t += dayBalls(m, d);
  return Math.max(0, t - todayBalls(m));
}
// Change how many overs today has. Must not be fewer than have already been bowled today.
function coreDayOvers(overs) {
  if (!isTest()) return 'overs per day are only kept in Test matches';
  if (live.status === 'done') return 'the match had already finished';
  const o = Number(overs);
  if (!Number.isInteger(o) || o < 0 || o > 120) return 'overs for the day must be a whole number from 0 to 120';
  if (o * 6 < todayBalls()) return `${fmtOvers(todayBalls())} overs have already been bowled today`;
  live.dayOvers = { ...(live.dayOvers || {}), [clockOf().day]: o };
  return null;
}
const scoreTxt = (i, m = live) => (i.ended === 'all out' ? `${i.runs} all out` : `${i.runs}/${i.wkts}${i.ended === 'declared' && isTest(m) ? ' dec' : ''}`);
function leadShort(m = live) {
  const i = m.inns[m.inns.length - 1];
  if (m.inns.length === 1) return '';
  const d = teamTotal(i.bat, m) - teamTotal(1 - i.bat, m);
  return d > 0 ? `lead by ${plural(d, 'run')}` : d < 0 ? `trail by ${plural(-d, 'run')}` : 'scores level';
}
function closeText(m = live) {
  const i = m.inns[m.inns.length - 1], l = leadShort(m);
  return `${m.teams[i.bat]} ${scoreTxt(i)}${l ? ` (${l})` : ''}`;
}
function coreSession(stumps) {
  if (!isTest()) return 'sessions are only kept in Test matches';
  if (live.status === 'done') return 'the match had already finished';
  const c = { ...clockOf(live) };
  const end = snapInns();
  const endsDay = !!stumps || c.s === 2;
  live.sessions = live.sessions || [];
  live.sessions.push({ day: c.day, s: c.s, start: c.start, end, stumps: endsDay, label: endsDay ? 'Stumps' : SESS_END[c.s], text: closeText() });
  if (endsDay) { c.day++; c.s = 0; c.dayStart = end; } else c.s++;
  c.start = end;
  live.clock = c;
  if (endsDay && c.day > (live.days || 5)) coreEndAny('draw'); // stumps on the last day
  return null;
}
// Runs, wickets and overs in one session, by team, and who had the better of it.
// A wicket counts for about 25 runs; a margin under 20 is called shared.
export function sessionStats(se, m) {
  const by = [{ runs: 0, wkts: 0, batted: false }, { runs: 0, wkts: 0, batted: false }];
  let balls = 0;
  se.end.forEach((e, k) => {
    const s = se.start[k] || { runs: 0, wkts: 0, balls: 0 };
    by[e.bat].runs += e.runs - s.runs; by[e.bat].wkts += e.wkts - s.wkts; balls += e.balls - s.balls;
    if (e.balls > s.balls || e.runs > s.runs) by[e.bat].batted = true;
  });
  const pts = [0, 1].map(t => by[t].runs + 25 * by[1 - t].wkts);
  const d = pts[0] - pts[1];
  return { by, balls, runs: by[0].runs + by[1].runs, wkts: by[0].wkts + by[1].wkts, verdict: !balls ? '' : Math.abs(d) < 20 ? 'Shared' : m.teams[d > 0 ? 0 : 1] };
}
// The day-by-day card: every finished session, plus the one in play.
export function daysHTML(m) {
  if (!isTest(m) || !(m.sessions?.length || m.clock)) return '';
  const rows = [...(m.sessions || [])];
  const c = clockOf(m);
  if (m.status !== 'done') rows.push({ day: c.day, s: c.s, start: c.start, end: snapInns(m), now: true });
  const body = rows.map(se => {
    const st = sessionStats(se, m);
    const who = [0, 1].filter(t => st.by[t].batted).map(t => `${esc(m.teams[t])} ${st.by[t].runs}${st.by[1 - t].wkts ? `, took ${plural(st.by[1 - t].wkts, 'wicket')}` : ''}`).join(' · ');
    return `<tr${se.now ? ' class="hl"' : ''}><td class="dim">Day ${se.day}</td><td>${SESS[se.s]}${se.now ? ' <span class="badge live" style="font-size:.6rem">Now</span>' : ''}</td><td class="num">${st.runs}/${st.wkts}</td><td class="num">${fmtOvers(st.balls)}</td><td style="white-space:normal">${who || '<span class="dim">—</span>'}</td><td>${st.verdict ? (st.verdict === 'Shared' ? '<span class="dim">Shared</span>' : `<b>${esc(st.verdict)}</b>`) : ''}</td><td style="white-space:normal" class="dim">${se.now ? '' : `${esc(se.label)}: ${esc(se.text)}`}</td></tr>`;
  }).join('');
  return `<div class="card scorecard days-card">
    <div class="sc-head"><h3>Day by day</h3><span class="hint" style="margin:0">${tipBtn('Who had the better of each session: runs scored plus about 25 runs for every wicket taken. Within 20 of each other, it is called shared.', 'session verdicts')}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Day</th><th>Session</th><th class="num">Runs/wkts</th><th class="num">Overs</th><th>By team</th><th>Session to</th><th>At the break</th></tr></thead><tbody>${body}</tbody></table></div>
  </div>`;
}

/* ---------- Test cricket: result chances, follow-on, declarations, new ball ---------- */
const wlOf = (m, t) => (sqOf(m, t)?.length || m.pps || 11) - 1;
// Win / draw / lose chances from the match as it stands (see testsim.js for how it plays the rest out).
function chancesInput(m, declareNow) {
  if (!isTest(m) || m.status === 'done') return null;
  const inns = m.inns.map((i, k) => ({ bat: i.bat, runs: i.runs, wkts: i.wkts, balls: i.balls, done: !!i.ended || (m.status === 'break' && k === m.inns.length - 1) }));
  if (declareNow) inns[inns.length - 1].done = false;
  if (m.inns.length >= 4 && inns.every(x => x.done)) return null;
  const next = inns.every(x => x.done) ? { bat: m === live ? nextBatTeam() : testNext(m).bat } : null;
  return { inns, next, ballsLeft: matchBallsLeft(m), wl: [wlOf(m, 0), wlOf(m, 1)], fo: m.followOn || 200, declareNow, sims: 800 };
}
export function testChances(m = live, { declareNow = false } = {}) {
  const input = chancesInput(m, declareNow);
  if (!input) return null;
  const key = JSON.stringify(input);
  if (!oddsCache.has(key)) {
    if (oddsCache.size > 20) oddsCache.delete(oddsCache.keys().next().value);
    oddsCache.set(key, testOdds(input));
  }
  return oddsCache.get(key);
}
const oddsCache = new Map(); // the same match state is drawn several times (scorer, break screen, re-renders)
// The bar if the chances for this state are already known; otherwise a placeholder that is filled in
// just after the screen updates, so scoring a ball never waits for the simulation.
let oddsTimer = 0;
function oddsSlot(m, declareNow) {
  const input = chancesInput(m, declareNow);
  if (!input) return '';
  const hit = oddsCache.get(JSON.stringify(input));
  if (hit) return oddsBar(m, hit);
  clearTimeout(oddsTimer);
  oddsTimer = setTimeout(fillOdds, 30);
  return `<div class="odds-pending" data-odds="${declareNow ? 'decl' : 'main'}">Working out the chances…</div>`;
}
function fillOdds() {
  if (!live) return;
  document.querySelectorAll('#live-main .odds-pending').forEach(el => {
    const r = testChances(live, { declareNow: el.dataset.odds === 'decl' });
    if (r) el.outerHTML = oddsBar(live, r); else el.remove();
  });
}
const pct = v => `${Math.round(v * 100)}%`;
function oddsBar(m, r) {
  const seg = (t, v, cls) => `<span class="odds-seg ${cls}" style="flex-grow:${Math.max(v, 0.0001)}" title="${esc(t)} ${pct(v)}"></span>`;
  return `<div class="odds-bar" role="img" aria-label="${esc(`${m.teams[0]} ${pct(r.win[0])}, draw ${pct(r.draw)}, ${m.teams[1]} ${pct(r.win[1])}`)}">${seg(m.teams[0], r.win[0], 'a')}${seg('Draw', r.draw, 'd')}${seg(m.teams[1], r.win[1], 'b')}</div>
    <div class="odds-legend"><span><i class="a"></i>${esc(m.teams[0])} <b>${pct(r.win[0])}</b></span><span><i class="d"></i>Draw <b>${pct(r.draw)}</b></span><span><i class="b"></i>${esc(m.teams[1])} <b>${pct(r.win[1])}</b></span></div>`;
}
export function testOddsHTML(m = live) {
  const slot = oddsSlot(m, false);
  if (!slot) return '';
  const rpo = (() => { const b = m.inns.reduce((a, i) => a + i.balls, 0), r = m.inns.reduce((a, i) => a + i.runs, 0); const k = b / (b + 1500); return (1 - k) * 3.2 + k * (b ? r / b * 6 : 3.2); })();
  return `<div class="card odds-card">
    <h2 class="card-title">Result chances ${tipBtn(`Plays the rest of the match out 800 times, an over at a time, at this match's scoring rate (about ${nf(rpo, 1)} an over) and wicket rate, with later innings losing wickets faster and simple rules for declarations, the follow-on and blocking out for a draw. It counts the overs left from the day and session, so ending sessions with Lunch, Tea and Stumps keeps it accurate. It ignores who the players are, so treat it as a guide.`, 'result chances')}</h2>
    ${slot}
    <p class="hint">About ${fmtOvers(matchBallsLeft(m))} overs left in the match.</p>
  </div>`;
}
const NEW_BALL = 80 * 6;
const ballAge = i => i.balls - (i.newBall || 0);
function coreNewBall() {
  if (!isTest() || live.status !== 'live') return 'the new ball can only be taken during a Test innings';
  const i = cur();
  if (ballAge(i) < NEW_BALL) return 'the new ball isn\'t due until the old one is 80 overs old';
  i.newBall = i.balls;
  return null;
}
// Day and session, overs today, new ball, and the follow-on or declaration situation.
export function testCardHTML() {
  if (!isTest() || live.status === 'done') return '';
  const c = clockOf(), days = live.days || 5, i = cur(), n = live.inns.length;
  const today = todayBalls(), sched = dayBalls(), leftToday = Math.max(0, sched - today);
  const lines = [];
  if (live.status === 'live') {
    const age = ballAge(i);
    lines.push(age >= NEW_BALL
        ? `<li><span>New ball</span><b class="pos">Available · this one is ${fmtOvers(age)} overs old <button type="button" class="btn sm" data-act="newball" style="margin-left:8px">Take new ball</button></b></li>`
        : `<li><span>Ball age</span><b>${fmtOvers(age)} overs · new ball due in ${fmtOvers(NEW_BALL - age)}</b></li>`);
    const fo = live.followOn || 200, i1 = live.inns[0];
    if (n === 2 && i1.runs >= fo) {
      const need = i1.runs - fo + 1 - i.runs;
      lines.push(need > 0 ? `<li><span>Follow-on</span><b class="neg">${esc(live.teams[i.bat])} need ${need} more to avoid it</b></li>` : '<li><span>Follow-on</span><b class="pos">Avoided</b></li>');
    }
    if (n === 4 && i.target != null) lines.push(`<li><span>Chase</span><b>${Math.max(0, i.target - i.runs)} to win · about ${fmtOvers(matchBallsLeft())} overs left</b></li>`);
  }
  let decl = '';
  if (live.status === 'live' && n === 3) {
    const lead = teamTotal(i.bat) - teamTotal(1 - i.bat);
    if (lead > 0) {
      decl = `<div class="decl"><p class="modal-sub" style="margin:0 0 4px">If ${esc(live.teams[i.bat])} declare now</p>
        <p style="margin:0 0 8px">${esc(live.teams[1 - i.bat])} need <b>${lead + 1}</b> to win in about <b>${fmtOvers(matchBallsLeft())}</b> overs.</p>
        ${oddsSlot(live, true)}</div>`;
    }
  }
  const btn = (v, label, ghost) => `<button type="button" class="btn ${ghost ? 'ghost ' : ''}sm" data-act="session" data-v="${v}">${label}</button>`;
  return `<div class="card test-card">
    <h2 class="card-title">Day ${c.day} of ${days} · ${SESS[c.s].toLowerCase()} session</h2>
    <ul class="g-facts">
      <li><span>Overs today</span><b>${fmtOvers(today)} of ${fmtOvers(sched)} bowled${sched !== DAY_BALLS ? ' (changed)' : ''} · about ${fmtOvers(leftToday)} left <button type="button" class="btn ghost sm" data-act="dayovers" style="margin-left:8px">Rain / change overs</button></b></li>
      ${lines.join('')}
    </ul>
    ${decl}
    <div class="modal-actions" style="justify-content:flex-start;margin-top:12px">${c.s < 2 ? `${btn('', SESS_END[c.s])}${btn('1', 'Stumps now', true)}` : btn('1', c.day >= days ? 'Stumps: end of the match' : 'Stumps')}</div>
    <p class="hint" style="margin-top:8px">${c.day >= days && c.s === 2 ? 'Stumps on the last day ends the match as a draw.' : c.s < 2 ? `Press ${SESS_END[c.s]} at the break. “Stumps now” ends the day early (bad light, rain), and the rest of today's overs are lost.` : 'Press Stumps at the close of play.'}</p>
  </div>`;
}
export function endInnings(reason) {
  const i = cur();
  i.ended = reason;
  i.needBowler = false;
  i.freeHit = false;
  if (isTest()) {
    const n = live.inns.length;
    if (reason === 'draw') { live.status = 'done'; live.result = 'Match drawn'; return; }
    if (n === 3) {
      const t4 = testNext().bat, need = testNeed(t4);
      if (need <= 0) { live.status = 'done'; live.result = `${live.teams[t4]} won by an innings and ${plural(1 - need, 'run')}`; return; }
    }
    if (n < 4) { live.status = 'break'; return; }
    live.status = 'done'; live.result = computeResult(); return;
  }
  if (live.inns.length === 1) live.status = 'break';
  else { live.status = 'done'; live.result = computeResult(); }
}
export function computeResult() {
  if (isTest()) {
    const i4 = live.inns[3], t4 = i4.bat;
    if (i4.runs >= i4.target) return `${live.teams[t4]} won by ${plural(ppsOf(live, i4) - 1 - i4.wkts, 'wicket')}`;
    if (i4.ended === 'all out') return i4.runs === i4.target - 1 ? 'Match tied' : `${live.teams[1 - t4]} won by ${plural(i4.target - 1 - i4.runs, 'run')}`;
    return 'Match drawn';
  }
  const [i1, i2] = live.inns;
  const t1 = live.teams[i1.bat], t2 = live.teams[i2.bat];
  const dl = i2.dls ? ' (DLS)' : '';
  // Rain ended the chase for good: the result is decided against the par score.
  if (i2.ended === 'rain' && live.dlsPar != null) {
    const par = live.dlsPar;
    if (i2.runs > par) return `${t2} won by ${plural(i2.runs - par, 'run')} (DLS)`;
    if (i2.runs === par) return 'Match tied (DLS)';
    return `${t1} won by ${plural(par - i2.runs, 'run')} (DLS)`;
  }
  if (i2.runs >= i2.target) {
    const wl = ppsOf(live, i2) - 1 - i2.wkts;
    const cap = maxBallsOf(i2);
    const bl = cap ? cap - i2.balls : null;
    return `${t2} won by ${plural(wl, 'wicket')}${bl ? ` (${i2.dls ? 'DLS, ' : ''}${plural(bl, 'ball')} left)` : dl}`;
  }
  if (i2.runs === i2.target - 1) return `Match tied${dl}`;
  return `${t1} won by ${plural(i2.target - 1 - i2.runs, 'run')}${dl}`;
}

function coreBowler(name) {
  const i = cur();
  const nm = (name || '').trim();
  if (live.status !== 'live' || !i.needBowler) return 'a new over hadn\'t started at that point';
  if (!nm) return 'Type the bowler\'s name.';
  let idx = i.bowlers.findIndex(b => sameName(b.name, nm));
  if (idx !== -1 && idx === i.lastBowler) return `${i.bowlers[idx].name} bowled the last over. Pick someone else.`;
  if (idx !== -1 && live.overs) {
    const cap = bowlCap(i);
    if (Math.floor(i.bowlers[idx].balls / 6) >= cap) return `${i.bowlers[idx].name} has bowled the maximum ${plural(cap, 'over')}.`;
  }
  if (idx === -1) { i.bowlers.push(mkBowler(nm)); idx = i.bowlers.length - 1; }
  i.bowler = idx;
  i.overs.push(mkOver(idx));
  i.needBowler = false;
  return null;
}
// Each bowler may bowl a fifth of the innings, rounded up; a rain-shortened innings has a lower limit.
const bowlCap = i => Math.ceil(Math.ceil(maxBallsOf(i) / 6) / 5);
export function setBowler(name) {
  const err = act({ t: 'bowler', name: (name || '').trim() }, () => coreBowler(name));
  if (err) { const el = $('#live-bowler-err'); if (el) el.textContent = err; }
}

export function undo() {
  if (!undoStack.length) { toast('Nothing to undo'); return; }
  const wasDone = live && live.status === 'done';
  live = JSON.parse(undoStack.pop());
  saveLive();
  if (wasDone && live.status !== 'done') saveMatch(true); // keep Saved matches (and any tournament) in step: the match is open again
  renderLiveAll();
  toast('Last action undone');
}

export const liveField = (id, label, value, o = {}) => `<div class="field${o.wide ? ' wide' : ''}"><div class="lab"><label for="${id}">${esc(label)}</label></div><input id="${id}" type="text" value="${esc(value)}" autocomplete="off" spellcheck="false"${o.im ? ` inputmode="${o.im}"` : ''}${o.list ? ` list="${o.list}"` : ''} maxlength="${o.max || 30}"></div>`;

const squadStore = () => { const v = store.get('squads', {}); return v && typeof v === 'object' ? v : {}; };
// Squad lines can mark the captain with "(c)" and the wicketkeeper with "(wk)" or "†",
// e.g. "Asif (c)", "Kiran (wk)", or both: "Kiran (c) (wk)".
const ROLE_MARK = /\s*\((?:wk|keeper|c|capt|captain)\)\s*|†/gi;
const IS_WK = /\((?:wk|keeper)\)|†/i;
const IS_CAPT = /\((?:c|capt|captain)\)/i;
const parseSquadFull = text => {
  let keeper = null, captain = null;
  const names = (text || '').split('\n').map(s => {
    const n = s.replace(ROLE_MARK, ' ').trim().replace(/\s+/g, ' ');
    if (n && IS_WK.test(s) && !keeper) keeper = n;
    if (n && IS_CAPT.test(s) && !captain) captain = n;
    return n;
  }).filter(Boolean);
  return { names, keeper, captain };
};
const parseSquad = text => parseSquadFull(text).names;
const markRoles = (names, keeper, captain) => names.map(n => n + (captain && sameName(n, captain) ? ' (c)' : '') + (keeper && sameName(n, keeper) ? ' (wk)' : ''));
// " (c)", " (wk)" or " (c, wk)" after a player's name, for the given team.
export const roleTag = (m, team, name) => {
  if (!m || !name) return '';
  const r = [];
  if (m.captains?.[team] && sameName(m.captains[team], name)) r.push('c');
  if (m.keepers?.[team] && sameName(m.keepers[team], name)) r.push('wk');
  return r.length ? ` (${r.join(', ')})` : '';
};
const FOLLOW_ON = { 5: 200, 4: 150, 3: 150, 2: 100, 1: 75 }; // Laws of Cricket 14.1
let prefill = null; // set when a tournament fixture is scored
export function setupFromFixture(p) { prefill = p; }
export function setupHTML() {
  const f = fmt();
  const saved = squadStore();
  const tA = prefill?.ta || 'Falcons', tB = prefill?.tb || 'Rhinos';
  const rawA = saved[tA.toLowerCase()] || [], rawB = saved[tB.toLowerCase()] || [];
  const sqA = parseSquad(rawA.join('\n')), sqB = parseSquad(rawB.join('\n'));
  const auto = (id, label, value) => liveField(id, label, value).replace('<input ', '<input data-auto="1" ');
  return `<div class="card">
    <h2 class="card-title">New match</h2>
    ${prefill?.label ? `<p class="hint" style="margin:-4px 0 14px">${esc(prefill.label)}. If ${esc(tB)} bat first, press “Swap batting order”.</p>` : ''}
    <div class="setup-grid">
      ${liveField('ls-ta', 'Batting first', tA)}
      ${liveField('ls-tb', 'Bowling first', tB)}
      ${liveField('ls-ov', 'Overs per side', prefill?.overs ?? f.overs ?? '', { im: 'numeric', max: 3 })}
      ${selectField('ls-type', 'Match type', [{ v: 'limited', l: 'Limited overs' }, { v: 'test', l: 'Test: two innings each' }], f.key === 'Test' && !prefill ? 'test' : 'limited')}
      ${selectField('ls-days', 'Days left when play starts (sets the follow-on)', [5, 4, 3, 2, 1].map(d => ({ v: String(d), l: `${d} day${d > 1 ? 's' : ''} · follow-on at ${FOLLOW_ON[d]}` })), '5')}
    </div>
    <div class="modal-actions" style="justify-content:flex-start;margin-top:10px"><button type="button" class="btn ghost sm" data-act="swap-teams">Swap batting order</button></div>
    <div class="grid-2 squads">
      ${['a', 'b'].map((s, k) => `<div class="field">
        <div class="lab"><label for="ls-sq${s}" id="ls-sq${s}-l">${esc(k ? tB : tA)} players</label></div>
        <textarea id="ls-sq${s}" rows="11" spellcheck="false" data-loaded="${(k ? rawB : rawA).length ? 1 : 0}" placeholder="Optional. One name per line, in batting order. Add (c) after the captain and (wk) after the wicketkeeper.">${esc((k ? rawB : rawA).join('\n'))}</textarea>
        <span class="sq-count" id="ls-sq${s}-c"></span>
      </div>`).join('')}
    </div>
    <p class="hint">With squads entered, new batters, bowlers and fielders are picked from a list during the match, and each team's size sets its players per side. Add (c) after the captain and (wk) after the wicketkeeper, for example “Asif (c)” or “Kiran (c) (wk)”. They're tagged on the scorecard, and stumpings pick the keeper automatically. Squads are remembered by team name for next time.</p>
    <div class="setup-grid" style="margin-top:14px">
      ${auto('ls-s', 'Striker', sqA[0] || 'Batter 1').replace('maxlength', 'list="ls-sqa-list" maxlength')}
      ${auto('ls-ns', 'Non-striker', sqA[1] || 'Batter 2').replace('maxlength', 'list="ls-sqa-list" maxlength')}
      ${auto('ls-bw', 'Opening bowler', sqB[sqB.length - 1] || 'Bowler 1').replace('maxlength', 'list="ls-sqb-list" maxlength')}
      ${liveField('ls-pps', 'Players per side', '11', { im: 'numeric', max: 2 })}
    </div>
    <datalist id="ls-sqa-list"></datalist><datalist id="ls-sqb-list"></datalist>
    <p class="hint">Leave overs empty for an unlimited innings (it ends when the side is all out or you end it). Bowlers are limited to a fifth of the overs. In a Test, if the first day is washed out, pick the days remaining: the follow-on follows them (Law 14.3).</p>
    <p class="err-text" id="ls-err"></p>
    <div class="modal-actions" style="justify-content:flex-start"><button type="button" class="btn" data-act="start">Start match</button></div>
  </div>`;
}
function swapSetupTeams() {
  const sw = (x, y) => { const a = $('#' + x), b = $('#' + y); if (!a || !b) return; const t = a.value; a.value = b.value; b.value = t; };
  sw('ls-ta', 'ls-tb'); sw('ls-sqa', 'ls-sqb');
  ['ls-s', 'ls-ns', 'ls-bw'].forEach(id => { const el = $('#' + id); if (el) { el.dataset.auto = '1'; el.value = id === 'ls-bw' ? 'Bowler 1' : id === 'ls-s' ? 'Batter 1' : 'Batter 2'; } });
  setupSync(null);
}
// Keeps the setup form consistent as squads and team names are typed.
function setupSync(target) {
  const id = target?.id || '';
  const test = $('#ls-type')?.value === 'test';
  const ovEl = $('#ls-ov'), daysWrap = $('#ls-days')?.closest('.field');
  if (ovEl) { ovEl.disabled = test; if (test) ovEl.value = ''; else if (!ovEl.value && id === 'ls-type') ovEl.value = String(fmt().overs ?? 20); }
  if (daysWrap) daysWrap.hidden = !test;
  if (['ls-s', 'ls-ns', 'ls-bw'].includes(id)) { target.dataset.auto = '0'; return; }
  const saved = squadStore();
  [['a', 'ls-ta'], ['b', 'ls-tb']].forEach(([s, teamId]) => {
    const ta = $('#ls-sq' + s);
    if (!ta) return;
    const team = ($('#' + teamId).value || '').trim();
    if (id === teamId) { // a known team name brings its squad back
      const prev = saved[team.toLowerCase()];
      if (prev && (!ta.value.trim() || ta.dataset.loaded === '1')) { ta.value = prev.join('\n'); ta.dataset.loaded = '1'; }
      else if (ta.dataset.loaded === '1' && !prev) { ta.value = ''; ta.dataset.loaded = '0'; }
    }
    if (id === 'ls-sq' + s) ta.dataset.loaded = '0';
    $('#ls-sq' + s + '-l').textContent = `${team || (s === 'a' ? 'Batting first' : 'Bowling first')} players`;
    const { names: sq, keeper, captain } = parseSquadFull(ta.value);
    const dup = sq.find((n, k) => sq.findIndex(x => sameName(x, n)) !== k);
    $('#ls-sq' + s + '-c').textContent = !sq.length ? 'No squad: you will type names as you go.' : dup ? `“${dup}” appears twice.` : sq.length === 1 ? 'Add at least one more player, or leave it empty.' : sq.length > 11 ? `${sq.length} names: the most is 11.` : `${plural(sq.length, 'player')} · ${captain ? `captain: ${captain}` : 'no captain marked'} · ${keeper ? `keeper: ${keeper}` : 'no keeper marked'}`;
    $('#ls-sq' + s + '-c').classList.toggle('bad-text', !!dup || sq.length === 1 || sq.length > 11);
    $(`#ls-sq${s}-list`).innerHTML = sq.map(n => `<option value="${esc(n)}"></option>`).join('');
    const fill = (fid, v) => { const el = $('#' + fid); if (el && el.dataset.auto === '1' && v) el.value = v; };
    if (s === 'a' && sq.length >= 2) { fill('ls-s', sq[0]); fill('ls-ns', sq[1]); }
    if (s === 'b' && sq.length >= 2) fill('ls-bw', sq[sq.length - 1]);
  });
  const both = ['a', 'b'].map(s => parseSquad($('#ls-sq' + s)?.value)).filter(q => q.length >= 2);
  const pps = $('#ls-pps');
  if (pps) { pps.disabled = both.length === 2; if (both.length === 2) pps.value = String(both[0].length === both[1].length ? both[0].length : Math.max(both[0].length, both[1].length)); }
}
export function startMatch() {
  const g = id => ($('#' + id)?.value ?? '').trim();
  const err = $('#ls-err');
  const ta = g('ls-ta') || 'Team A', tb = g('ls-tb') || 'Team B';
  const ovS = g('ls-ov'), ppsS = g('ls-pps');
  const test = g('ls-type') === 'test';
  const ov = ovS === '' || test ? null : Number(ovS);
  const pps = Number(ppsS || 11);
  if (sameName(ta, tb)) { err.textContent = 'Give the two teams different names.'; return; }
  if (ov !== null && (!Number.isInteger(ov) || ov < 1 || ov > 200)) { err.textContent = 'Overs must be a whole number from 1 to 200, or empty.'; return; }
  const full = [parseSquadFull($('#ls-sqa')?.value), parseSquadFull($('#ls-sqb')?.value)];
  const squads = full.map(f => f.names);
  for (const [k, sq] of squads.entries()) {
    const team = k ? tb : ta;
    if (sq.length === 1) { err.textContent = `${team}: add at least two players, or leave the squad empty.`; return; }
    if (sq.length > 11) { err.textContent = `${team}: a squad can have at most 11 players.`; return; }
    const dup = sq.find((n, j) => sq.findIndex(x => sameName(x, n)) !== j);
    if (dup) { err.textContent = `${team}: “${dup}” is listed twice.`; return; }
  }
  if (!(squads[0].length && squads[1].length) && (!Number.isInteger(pps) || pps < 2 || pps > 11)) { err.textContent = 'Players per side must be from 2 to 11.'; return; }
  let s = g('ls-s') || 'Batter 1', ns = g('ls-ns') || 'Batter 2', bw = g('ls-bw') || 'Bowler 1';
  if (sameName(s, ns)) { err.textContent = 'The two openers need different names.'; return; }
  const inSq = (sq, nm) => sq.find(x => sameName(x, nm));
  if (squads[0].length) {
    if (!inSq(squads[0], s) || !inSq(squads[0], ns)) { err.textContent = `Both openers must be in the ${ta} squad.`; return; }
    s = inSq(squads[0], s); ns = inSq(squads[0], ns);
  }
  if (squads[1].length) {
    if (!inSq(squads[1], bw)) { err.textContent = `The opening bowler must be in the ${tb} squad.`; return; }
    bw = inSq(squads[1], bw);
  }
  const saved = squadStore();
  if (squads[0].length) saved[ta.toLowerCase()] = markRoles(squads[0], full[0].keeper, full[0].captain);
  if (squads[1].length) saved[tb.toLowerCase()] = markRoles(squads[1], full[1].keeper, full[1].captain);
  store.set('squads', saved);
  live = { id: uid(), created: Date.now(), teams: [ta, tb], overs: ov, pps, squads: squads.map(q => q.length ? q : null), keepers: full.map(f => f.names.length ? f.keeper : null), captains: full.map(f => f.names.length ? f.captain : null), format: test ? 'Test' : fmt().label, status: 'live', inns: [newInnings(0, s, ns, bw, null)], result: null };
  if (test) { live.matchType = 'test'; live.days = Number(g('ls-days')) || 5; live.followOn = FOLLOW_ON[live.days] || 200; live.clock = { day: 1, s: 0, start: [], dayStart: [] }; live.sessions = []; }
  if (prefill?.link) live.tournament = prefill.link;
  prefill = null;
  bbbOpen.clear();
  live.init = JSON.stringify(live); // the starting point the action log replays from
  live.log = [];
  undoStack = [];
  saveLive();
  renderLiveAll();
}

// Test cricket: how far ahead or behind the batting side is.
function leadText(between) {
  const i = cur(), team = live.teams[i.bat], other = live.teams[1 - i.bat];
  if (live.inns.length === 1) return between ? `${team} made ${i.runs}. ${other} to bat.` : `${team} batting first`;
  const diff = teamTotal(i.bat) - teamTotal(1 - i.bat);
  const s = diff > 0 ? `${team} lead by ${plural(diff, 'run')}` : diff < 0 ? `${team} trail by ${plural(-diff, 'run')}` : 'Scores level';
  return between ? `Innings over. ${s}.` : s;
}
export function boardHTML() {
  const i = cur();
  const team = live.teams[i.bat];
  const crr = i.balls ? i.runs / (i.balls / 6) : null;
  const chasing = i.target != null;
  const cap = maxBallsOf(i);
  const ballsLeft = cap != null ? cap - i.balls : null;
  const need = chasing ? i.target - i.runs : null;
  const rrr = chasing && ballsLeft > 0 && need > 0 ? need / (ballsLeft / 6) : null;
  let eq = '';
  if (live.status === 'done') eq = `<span class="ok">${esc(live.result)}</span>`;
  else if (live.status === 'break' && isTest()) eq = esc(leadText(true));
  else if (live.status === 'break') { const pc = plannedChase(); eq = `Innings over. ${esc(live.teams[1 - i.bat])} need <em>${pc.target}</em> to win${pc.dls ? ` off ${fmtOvers(pc.balls)} overs (DLS)` : ''}`; }
  else if (isTest() && !chasing) eq = esc(leadText(false));
  else if (chasing && ballsLeft != null && need > ballsLeft * 6) eq = `Need ${need} off ${ballsLeft} ${ballsLeft === 1 ? 'ball' : 'balls'}: <span class="no">out of reach</span>`;
  else if (chasing) eq = ballsLeft != null ? `Need <em>${need}</em> off <em>${ballsLeft}</em> ${ballsLeft === 1 ? 'ball' : 'balls'}` : `Need <em>${need}</em> to win`;
  else if (live.overs && crr != null) eq = `Projected <em>${Math.round(i.runs + crr * (ballsLeft / 6))}</em>`;
  return `<div class="board${live.status === 'live' && chasing ? ' pulse' : ''}">
    <div class="board-main">
      <div class="team-line">${esc(team)}${isTest() ? `<span class="dim" style="font-size:.85em">${ORD[live.inns.length - 1]} innings${live.followedOn && live.inns.length === 3 ? ', following on' : ''}${live.status !== 'done' ? ` · Day ${clockOf().day}, ${SESS[clockOf().s].toLowerCase()}` : ''}</span>` : ''}${live.status === 'live' ? '<span class="badge live">Live</span>' : ''}${i.freeHit && live.status === 'live' ? '<span class="badge fh">Free hit</span>' : ''}</div>
      <div class="score-big">${i.runs}/${i.wkts}<small>(${fmtOvers(i.balls)}${cap != null ? `/${fmtOvers(cap)}` : ''} ov)</small></div>
      ${eq ? `<div class="board-eq" style="font-size:clamp(1.15rem,.9rem + 1.2vw,1.6rem);margin-top:8px">${eq}</div>` : ''}
    </div>
    <div class="board-side">
      <div class="board-stat"><b>${crr != null ? nf(crr) : '—'}</b><span>Run rate</span></div>
      ${chasing ? `<div class="board-stat"><b>${i.target}</b><span>Target${i.dls ? ' (DLS)' : ''}</span></div>` : ''}
      ${chasing && i.dls && live.status === 'live' && !isTest() ? `<div class="board-stat"><b>${dlsFor().parNow}</b><span>DLS par now</span></div>` : ''}
      ${chasing && live.status === 'live' ? `<div class="board-stat"><b>${rrr != null ? nf(rrr) : '—'}</b><span>Required</span></div>` : ''}
      ${live.status === 'live' ? `<div class="board-stat"><b>${i.part.runs}<small style="font-size:.6em;color:#9fb4a8"> (${i.part.balls})</small></b><span>Partnership</span></div>` : ''}
    </div>
  </div>`;
}

function bowlerPicker(i) {
  const fsq = sqOf(live, 1 - i.bat);
  if (!fsq) return liveField('live-bowler', 'Bowler', '', { list: 'live-bowlers' });
  const cap = live.overs ? bowlCap(i) : Infinity;
  const find = nm => i.bowlers.findIndex(b => sameName(b.name, nm));
  const eligible = fsq.filter(nm => { const k = find(nm); return k === -1 || (k !== i.lastBowler && Math.floor(i.bowlers[k].balls / 6) < cap); });
  // Default: whoever bowled the over before last (the usual change of ends), then another recent bowler, then the tail.
  const recent = i.overs.slice(0, -1).reverse().map(o => i.bowlers[o.bowler]?.name).filter(Boolean);
  const sel = recent.find(nm => eligible.some(e => sameName(e, nm))) || eligible[eligible.length - 1];
  const opts = eligible.map(nm => { const k = find(nm); const b = i.bowlers[k]; const t = nm + roleTag(live, 1 - i.bat, nm); return { v: nm, l: b ? `${t} · ${fmtOvers(b.balls)}-${b.maidens}-${b.runs}-${b.wkts}` : t }; });
  if (!opts.length) return '<p class="err-text">Nobody in the squad is able to bowl this over.</p>';
  return selectField('live-bowler', 'Bowler', opts, eligible.find(e => sameName(e, sel)));
}
export function liveHTML(animateLast) {
  const i = cur();
  const over = i.overs[i.overs.length - 1];
  const bw = i.bowlers[i.bowler];
  const lockPad = i.needBowler;
  const overNo = Math.floor(i.balls / 6) + (i.needBowler ? 1 : 1);
  const strip = !i.needBowler && over.balls.length
      ? over.balls.map((b, k) => chip(b, animateLast && k === over.balls.length - 1)).join('')
      : `<span class="empty-over">${i.needBowler ? 'Over complete' : 'New over'}</span>`;
  const prevBowler = i.lastBowler >= 0 ? i.bowlers[i.lastBowler] : null;
  const bowlerOpts = i.bowlers.filter((b, k) => k !== i.lastBowler).map(b => `<option value="${esc(b.name)}"></option>`).join('');
  const prompt = i.needBowler ? `<div class="card prompt-card">
      <h2 class="card-title">Over ${overNo}: who's bowling?</h2>
      <div class="prompt-row">
        ${bowlerPicker(i)}
        <button type="button" class="btn" data-act="set-bowler" style="height:42px">Start over</button>
      </div>
      <datalist id="live-bowlers">${bowlerOpts}</datalist>
      <p class="err-text" id="live-bowler-err"></p>
      ${prevBowler ? `<p class="hint" style="margin-top:4px">${esc(prevBowler.name)} bowled the last over and can't bowl this one.</p>` : ''}
    </div>` : '';
  const dis = lockPad ? ' disabled' : '';
  const sr = b => b.balls ? nf(b.runs / b.balls * 100, 1) : '—';
  const batRow = (idx, mark) => { const b = i.batters[idx]; return `<tr class="bat-row"><td class="${mark ? 'on-strike' : ''}">${esc(b.name + roleTag(live, i.bat, b.name))}${mark ? ' *' : ''}</td><td class="num"><b>${b.runs}</b></td><td class="num">${b.balls}</td><td class="num">${b.f4}</td><td class="num">${b.f6}</td><td class="num">${sr(b)}</td></tr>`; };
  const lastOvers = i.overs.filter(o => o.balls.length).slice(-5).reverse();
  return `${boardHTML()}
  ${alertsHTML(i)}
  <div class="live-grid">
    <div class="live-col">
      ${prompt}
      <div class="card">
        <h2 class="card-title">This over${!i.needBowler ? ` <span class="dim" style="text-transform:none;letter-spacing:0;font:500 .85rem var(--f-body);color:var(--muted)">· ${esc(bw.name)} · over ${overNo}</span>` : ''}</h2>
        <div class="over-strip" aria-live="polite">${strip}</div>
        <div style="margin-top:14px">
          <div class="pad" role="group" aria-label="Runs off the bat">
            ${[0, 1, 2, 3, 4, 6].map(r => `<button type="button" data-act="run" data-r="${r}" class="${r === 4 ? 'k4' : r === 6 ? 'k6' : ''}" aria-label="${r === 0 ? 'Dot ball' : plural(r, 'run')}"${dis}>${r === 0 ? '•' : r}</button>`).join('')}
          </div>
          <div class="pad-row2 pad" role="group" aria-label="Wickets and extras">
            <button type="button" data-act="wkt" class="kw" aria-label="Wicket"${dis}>W</button>
            <button type="button" data-act="wd" class="kx"${dis}>WD</button>
            <button type="button" data-act="nb" class="kx"${dis}>NB</button>
            <button type="button" data-act="b" class="kx" aria-label="Byes"${dis}>BYE</button>
            <button type="button" data-act="lb" class="kx" aria-label="Leg byes"${dis}>LB</button>
            <button type="button" data-act="more" class="kx" aria-label="Other runs: fives, overthrows"${dis}>MORE</button>
          </div>
          <div class="pad-tools">
            <button type="button" class="btn ghost sm" data-act="undo"${undoStack.length ? '' : ' disabled'}>Undo</button>
            <button type="button" class="btn ghost sm" data-act="swap">Swap strike</button>
            <button type="button" class="btn ghost sm" data-act="retire">Retire batter</button>
            <button type="button" class="btn ghost sm" data-act="penalty">Penalty runs</button>
            ${live.overs && !isTest() ? '<button type="button" class="btn ghost sm" data-act="rain">Rain / stoppage</button>' : ''}
            <button type="button" class="btn ghost sm" data-act="rename">Edit names</button>
            <button type="button" class="btn ghost sm danger" data-act="end-inn">${isTest() ? 'Declare' : 'End innings'}</button>
            ${isTest() ? '<button type="button" class="btn ghost sm" data-act="draw">End as a draw</button>' : '<button type="button" class="btn ghost sm" data-act="abandon">No result</button>'}
          </div>
          <label class="check ww-toggle"><input type="checkbox" id="ww-on"${store.get('wwOn', false) ? ' checked' : ''}> Wagon wheel: ask where each scoring shot went</label>
          <p class="hint">Keyboard: 0–6 for runs, W for a wicket, U to undo. MORE covers 5s, 7s and overthrows.</p>
        </div>
      </div>
    </div>
    <div class="live-col">
      ${testCardHTML()}
      <div class="card">
        <h2 class="card-title">At the crease</h2>
        <div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>Batter</th><th class="num">R</th><th class="num">B</th><th class="num">4s</th><th class="num">6s</th><th class="num">SR</th></tr></thead>
        <tbody>${batRow(i.striker, true)}${batRow(i.non, false)}</tbody></table></div>
      </div>
      <div class="card">
        <h2 class="card-title">Bowling</h2>
        <div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>Bowler</th><th class="num">O</th><th class="num">M</th><th class="num">R</th><th class="num">W</th><th class="num">Econ</th></tr></thead>
        <tbody>${(i.needBowler && prevBowler ? [prevBowler] : [bw]).map(b => `<tr><td>${esc(b.name + roleTag(live, 1 - i.bat, b.name))}</td><td class="num">${fmtOvers(b.balls)}</td><td class="num">${b.maidens}</td><td class="num">${b.runs}</td><td class="num"><b>${b.wkts}</b></td><td class="num">${b.balls ? nf(b.runs / (b.balls / 6)) : '—'}</td></tr>`).join('')}</tbody></table></div>
      </div>
      ${commentaryCardHTML()}
      ${matchupsCard(i)}
      ${lastOvers.length ? `<div class="card"><h2 class="card-title">Recent overs</h2><div class="tbl-wrap" style="margin-top:0"><table class="tbl"><tbody>${lastOvers.map(o => { const n = i.overs.indexOf(o) + 1; return `<tr><td class="dim">Ov ${n}</td><td>${esc(i.bowlers[o.bowler].name)}</td><td style="white-space:normal"><span class="mini-chips">${o.balls.map(b => chip(b, false, true)).join('')}</span></td><td class="num"><b>${o.runs}</b>${o.wkts ? ` <span class="neg">${o.wkts}w</span>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>` : ''}
    </div>
  </div>
  ${situationHTML(liveSituation())}
  ${testOddsHTML()}`;
}

/* Match situation inside the live scorer: projections, win probability, par check. */
export function liveSituation() {
  if (!live || live.status !== 'live' || !live.overs) return null;
  const i = cur(), cap = maxBallsOf(i), N = cap / 6, prof = profileFor(N);
  const left = cap - i.balls;
  const crr = i.balls ? i.runs / (i.balls / 6) : null;
  const chasing = i.target != null;
  const need = chasing ? i.target - i.runs : null;
  const rrr = chasing && left > 0 && need > 0 ? need / (left / 6) : null;
  const pps = ppsOf(live, i);
  const wkEff = i.wkts + (11 - pps); // map smaller sides onto the 10-wicket model
  const inHand = pps - 1 - i.wkts;
  const full = DLS.res(N, 0);
  const resLeft = DLS.res(left / 6, wkEff) / full;
  const par = Math.round(prof.avgScore * (1 - resLeft));
  const resProj = Math.round(i.runs + prof.avgScore * resLeft);
  const wp = chasing ? winProb(need, left, wkEff, N, prof) : null;
  return { i, N, prof, left, crr, chasing, need, rrr, wkEff, inHand, par, resProj, wp, team: live.teams[i.bat], opp: live.teams[1 - i.bat] };
}
export function situationHTML(s) {
  if (!s || s.left <= 0) return '';
  const { i, left, crr, chasing, need, rrr } = s;
  const rows = [];
  if (crr != null) rows.push({ name: 'Current rate', r: crr, hl: true });
  const center = crr != null ? Math.round(crr) : Math.round(s.prof.avgScore / s.N);
  const lo = Math.max(1, center - 1);
  for (let r = lo; r <= lo + 3; r++) rows.push({ name: `${r} an over`, r });
  if (rrr != null && rrr <= 36) rows.push({ name: 'Required rate', r: rrr });
  rows.forEach(x => { x.proj = Math.round(i.runs + x.r * left / 6); });
  const table = `<div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>Scoring at</th><th class="num">Rate</th><th class="num">Final total</th>${chasing ? '<th class="num">Outcome</th>' : ''}</tr></thead><tbody>${rows.map(x => {
    let out = '';
    if (chasing) { const d = x.proj - i.target; out = d >= 0 ? '<td class="num pos">Wins</td>' : `<td class="num neg">${-d} short</td>`; }
    return `<tr${x.hl ? ' class="hl"' : ''}><td>${esc(x.name)}</td><td class="num">${nf(x.r)}</td><td class="num">${x.proj}</td>${out}</tr>`;
  }).join('')}</tbody></table></div>`;
  const fact = (a, b) => `<li><span>${esc(a)}</span><b>${esc(b)}</b></li>`;
  let side;
  if (chasing) {
    const bnd = need <= left ? 0 : Math.ceil((need - left) / 3);
    const lost = need > 6 * left;
    side = `<div class="card gauge-card">
      <h2 class="card-title">Win probability ${tipBtn('Estimated from runs needed, balls left and wickets in hand, using a resource model of a typical innings of this length. It ignores pitch and players, so treat it as a guide.', 'win probability')}</h2>
      <div class="gauge" id="live-gauge">${gaugeMarkup()}</div>
      ${lost ? `<p class="hint" style="text-align:center">Even ${plural(left, 'six', 'sixes')} make only ${6 * left}. Only extras can keep this alive.</p>` : ''}
      <ul class="g-facts">
        ${fact('Runs needed per ball', nf(need / left))}
        ${fact('Rate gap (required − current)', crr != null && rrr != null ? (rrr - crr > 0 ? '+' : '') + nf(rrr - crr) : '—')}
        ${fact('Fours needed if every other ball is a single', lost ? 'Out of reach' : need > 4 * left ? 'Needs sixes' : bnd === 0 ? 'None: singles do it' : String(bnd))}
        ${fact('Balls per wicket in hand', s.inHand > 0 ? nf(left / s.inHand, 1) : '—')}
      </ul>
    </div>`;
  } else {
    const diff = i.runs - s.par;
    side = `<div class="card">
      <h2 class="card-title">Par check ${tipBtn('Par is what a typical side scores by this stage of an innings of this length, allowing for wickets lost. It uses the same resource model as the rain-target tab, so it is an estimate.', 'par check')}</h2>
      <div class="answer ${diff >= 0 ? 'good' : 'bad'}"><div class="big">${diff >= 0 ? '+' : ''}${diff}</div><p>runs ${diff >= 0 ? 'ahead of' : 'behind'} par for <strong>${i.runs}/${i.wkts}</strong> after ${fmtOvers(i.balls)} overs.</p></div>
      <ul class="g-facts">
        ${fact('Par score at this stage', String(s.par))}
        ${fact('Projected total at the current rate', crr != null ? String(Math.round(i.runs + crr * left / 6)) : '—')}
        ${fact('Typical total from here, allowing for wickets', String(s.resProj))}
        ${fact('Wickets in hand', String(s.inHand))}
      </ul>
    </div>`;
  }
  return `<div class="grid-2 wide-left live-situation">
    <div class="card">
      <h2 class="card-title">Projections</h2>
      ${table}
    </div>
    ${side}
  </div>`;
}
export function paintSituation() {
  const s = liveSituation();
  const g = $('#live-gauge');
  if (!s || !g || s.wp == null) return;
  setGauge(g, s.wp, `${esc(s.team)} <b>${Math.round(s.wp)}%</b>`, `${esc(s.opp)} <b>${100 - Math.round(s.wp)}%</b>`, '');
  const cap = g.querySelector('.g-cap');
  if (cap) cap.textContent = s.team;
}
export function wpSeries(m) {
  const i2 = m.inns[1];
  if (!i2 || !m.overs) return null;
  const pps = ppsOf(m, i2);
  const N = maxBallsOf(i2, m) / 6, prof = profileFor(N), off = 11 - pps;
  const pts = [{ l: '0', p: winProb(i2.target, N * 6, off, N, prof) }];
  let r = 0, w = 0, b = 0;
  i2.overs.filter(o => o.balls.length).forEach(o => {
    r += o.runs; w += o.wkts; b += o.legal;
    const need = i2.target - r, left = N * 6 - b;
    let p;
    if (need <= 0) p = 100;
    else if (left <= 0 || w >= pps - 1) p = need === 1 ? 50 : 0;
    else p = winProb(need, left, w + off, N, prof);
    pts.push({ l: fmtOvers(b), p: Math.round(p * 10) / 10 });
  });
  return pts;
}

export function breakHTML() {
  const test = isTest();
  const n = live.inns.length;
  const nx = test ? testNext() : null;
  const batTeam = test ? nextBatTeam() : 1 - live.inns[0].bat;
  const t2 = live.teams[batTeam];
  const title = test
      ? `${ORD[n]} innings: ${t2} to bat${n === 3 ? `, needing ${testNeed(batTeam)} to win` : ''}`
      : chaseTitle(t2, plannedChase());
  const fo = test && nx.canFollowOn ? `<div class="modal-block"><p class="modal-sub">${esc(live.teams[live.inns[0].bat])} lead by ${plural(nx.lead, 'run')}, so they can enforce the follow-on</p>
    <div class="seg"><button type="button" data-act="fo" data-v="0" aria-pressed="${!followOn}">${esc(live.teams[live.inns[0].bat])} bat again</button><button type="button" data-act="fo" data-v="1" aria-pressed="${followOn}">Enforce the follow-on: ${esc(live.teams[live.inns[1].bat])} bat again</button></div></div>` : '';
  const bsq = sqOf(live, batTeam), fsq = sqOf(live, 1 - batTeam);
  const opts = (sq, team) => sq.map(nm => ({ v: nm, l: nm + roleTag(live, team, nm) }));
  return `${boardHTML()}
  <div class="card prompt-card">
    <h2 class="card-title" id="l2-title">${esc(title)}</h2>
    ${fo}
    <div class="setup-grid">
      ${(bsq ? selectField('l2-s', 'Striker', opts(bsq, batTeam), bsq[0]) + selectField('l2-ns', 'Non-striker', opts(bsq, batTeam), bsq[1]) : liveField('l2-s', 'Striker', 'Batter 1') + liveField('l2-ns', 'Non-striker', 'Batter 2'))
  + (fsq ? selectField('l2-bw', 'Opening bowler', opts(fsq, 1 - batTeam), fsq[fsq.length - 1]) : liveField('l2-bw', 'Opening bowler', ''))}
      ${!test && live.overs ? liveField('l2-lost', 'Overs lost before the chase', '0', { im: 'decimal', max: 5 }) : ''}
    </div>
    ${!test && live.overs ? '<p class="hint" id="l2-dls">If rain takes overs off the chase before it starts, enter them and the target is revised.</p>' : ''}
    <p class="err-text" id="l2-err"></p>
    <div class="modal-actions" style="justify-content:flex-start">
      <button type="button" class="btn" data-act="start-2nd">Start ${test ? ORD[n] : 'second'} innings</button>
      ${test ? '<button type="button" class="btn ghost" data-act="draw">End as a draw</button>' : '<button type="button" class="btn ghost" data-act="abandon">No result</button>'}
      <button type="button" class="btn ghost" data-act="undo"${undoStack.length ? '' : ' disabled'}>Undo last ball</button>
    </div>
  </div>
  ${test ? `<div class="grid-2">${testCardHTML()}${testOddsHTML()}</div>` : ''}`;
}
const chaseTitle = (t2, pc) => `Second innings: ${t2} need ${pc.target}${pc.dls ? ` off ${fmtOvers(pc.balls)} overs (DLS)` : ''}`;
// Overs lost before the chase: the box accepts cricket notation; empty or 0 means none.
function readLost2() {
  const s = ($('#l2-lost')?.value ?? '').trim();
  if (!s || s === '0') return { balls: 0 };
  const p = parseOvers(s);
  if (p.error || p.balls == null) return { error: `Overs lost: ${p.error || 'write it like 4 or 4.3'}.` };
  const full = maxBallsOf(live.inns[0]);
  if (p.balls >= full) return { error: `Overs lost must be less than the ${fmtOvers(full)} overs available.` };
  return { balls: p.balls };
}
function previewLost2() {
  const r = readLost2(), t = $('#l2-title'), h = $('#l2-dls');
  if (!t || !h) return;
  if (r.error) { h.textContent = r.error; h.classList.add('bad-text'); return; }
  h.classList.remove('bad-text');
  const pc = plannedChase(live, r.balls);
  t.textContent = chaseTitle(live.teams[1 - live.inns[0].bat], pc);
  h.textContent = r.balls ? `${fmtOvers(r.balls)} overs lost: the chase is ${fmtOvers(pc.balls)} overs, with a DLS-style revised target.` : 'If rain takes overs off the chase before it starts, enter them and the target is revised.';
}
export function startSecond() {
  const g = id => ($('#' + id)?.value ?? '').trim();
  const err = $('#l2-err');
  const s = g('l2-s') || 'Batter 1', ns = g('l2-ns') || 'Batter 2';
  const bw = g('l2-bw');
  if (s.toLowerCase() === ns.toLowerCase()) { err.textContent = 'The two openers need different names.'; return; }
  if (!bw) { err.textContent = 'Type the opening bowler\'s name.'; return; }
  const bat = isTest() ? nextBatTeam() : undefined;
  const lr = isTest() ? { balls: 0 } : readLost2();
  if (lr.error) { err.textContent = lr.error; return; }
  const lost = lr.balls;
  const e = act({ t: 'start2', s, ns, bw, bat, lost }, () => coreStart2(s, ns, bw, bat, lost));
  if (e) err.textContent = e; else followOn = false;
}
let followOn = false; // break-screen choice in a Test
function nextBatTeam() { const nx = testNext(); return nx.canFollowOn && followOn ? live.inns[1].bat : nx.bat; }
function coreStart2(s, ns, bw, bat, lost = 0) {
  if (live.status !== 'break') return 'the previous innings hadn\'t finished at that point';
  const limited = !isTest() && live.overs;
  if (lost && (!limited || !Number.isInteger(lost) || lost < 0 || lost >= maxBallsOf(live.inns[0]))) return 'the overs lost before the chase didn\'t fit the innings';
  const last = live.inns[live.inns.length - 1];
  let team, target;
  if (isTest()) {
    team = bat ?? testNext().bat;
    target = live.inns.length === 3 ? testNeed(team) : null;
    if (live.inns.length === 2 && team === live.inns[1].bat) live.followedOn = true;
  } else { team = 1 - live.inns[0].bat; target = live.inns[0].runs + 1; }
  const inn = newInnings(team, s, ns, bw, target);
  const penFor = live.pendingPenTeam ?? (1 - last.bat);
  if (live.pendingPen && penFor === team) { inn.runs += live.pendingPen; inn.extras.pen = live.pendingPen; inn.overs[0].runs += live.pendingPen; live.pendingPen = 0; live.pendingPenTeam = null; }
  live.inns.push(inn);
  if (limited) {
    if (lost > 0) { if (!live.rain) live.rain = { stops: [[], []] }; live.rain.stops[1].push({ u: 0, w: 0, lost }); }
    if (rainHit()) { const d = dlsFor(); inn.target = d.target; inn.maxBalls = d.alloc2; inn.dls = true; }
  }
  live.status = 'live';
  return null;
}

export function doneHTML() {
  return `${boardHTML()}<div class="card result-banner"><h2 class="card-title">Result</h2><p style="margin:0;font:700 1.4rem/1.25 var(--f-display);letter-spacing:.02em">${esc(live.result)}</p>
    <p class="hint">${live.inns.map(i => `${esc(live.teams[i.bat])} ${i.runs}/${i.wkts} (${fmtOvers(i.balls)} ov)`).join(' · ')}</p>
    <div class="modal-actions" style="justify-content:flex-start"><button type="button" class="btn" data-act="save-match">Save match</button><button type="button" class="btn ghost" data-act="image">Share as image</button><button type="button" class="btn ghost" data-act="sc-image">Scorecard image</button><button type="button" class="btn ghost" data-act="print">Print or save as PDF</button><button type="button" class="btn ghost" data-act="csv">Scorecard CSV</button><button type="button" class="btn ghost" data-act="undo"${undoStack.length ? '' : ' disabled'}>Undo last ball</button></div></div>`;
}

// A ball in an over. In the live match it's a button that opens the edit dialog.
function chip(b, isNew, small, m = live) {
  const cls = `bdot ${b.c}${small ? ' sm' : ''}${isNew ? ' new' : ''}`;
  if (m === live && canEdit() && Number.isInteger(b.li) && b.li >= 0) return `<button type="button" class="${cls} editable" data-act="edit-ball" data-li="${b.li}" aria-label="Edit ball: ${esc(b.l)}">${esc(b.l)}</button>`;
  return `<span class="${cls}">${esc(b.l)}</span>`;
}
const endedText = (r, m) => ({ target: 'Target reached', 'all out': 'All out', overs: 'Overs used up', declared: isTest(m) ? 'Declared' : 'Innings closed early', draw: 'Match drawn', abandoned: 'No result', rain: 'Cut short by rain' })[r] || `Ended: ${r}`;
// Partnerships. Matches scored before partnerships were recorded fall back to runs between wickets.
const ordW = k => (['1st', '2nd', '3rd'][k - 1] || `${k}th`);
export function partnershipRows(m, i) {
  if (Array.isArray(i.parts)) {
    const last = i.parts[i.parts.length - 1];
    return i.parts.filter(p => p.runs || p.balls).map(p => ({
      w: p.w, runs: p.runs, balls: p.balls,
      names: p.p.map((j, s) => { const b = i.batters[j]; return b ? { name: b.name, r: p.r[s], b: p.b[s] } : null; }).filter(Boolean),
      open: p === last && i.ended !== 'all out',
    }));
  }
  let prev = 0;
  const rows = i.fow.map(f => { const r = { w: f.wkt, runs: f.score - prev, balls: null, names: [], open: false }; prev = f.score; return r; });
  if (rows.length && i.runs > prev && i.ended !== 'all out') rows.push({ w: i.wkts + 1, runs: i.runs - prev, balls: null, names: [], open: true });
  return rows;
}
function partsHTML(m, i) {
  const rows = partnershipRows(m, i);
  if (!rows.length) return '';
  const best = rows.reduce((a, b) => (b.runs > a.runs ? b : a));
  const who = r => r.names.length ? r.names.map(n => `${esc(n.name)} <span class="dim">${n.r} (${n.b})</span>`).join(' &amp; ') : '<span class="dim">—</span>';
  return `<details class="bbb parts"><summary>Partnerships · best ${best.runs}${best.open ? '*' : ''} for the ${ordW(best.w)} wicket</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Wkt</th><th>Batters</th><th class="num">Runs</th><th class="num">Balls</th></tr></thead><tbody>${rows.map(r => `<tr><td class="dim">${ordW(r.w)}</td><td style="white-space:normal">${who(r)}</td><td class="num"><b>${r.runs}${r.open ? '*' : ''}</b></td><td class="num">${r.balls ?? '—'}</td></tr>`).join('')}</tbody></table></div>${rows.some(r => r.open) ? '<p class="sc-meta">* unbroken</p>' : ''}</details>`;
}
// The over-by-over table inside a scorecard's "Ball by ball" section.
function bbbBody(m, i) {
  const ov = i.overs.filter(o => o.balls.length);
  return `<div class="tbl-wrap"><table class="tbl"><tbody>${ov.map(o => `<tr><td class="dim">Ov ${i.overs.indexOf(o) + 1}</td><td>${esc(i.bowlers[o.bowler]?.name || '')}</td><td style="white-space:normal"><span class="mini-chips">${o.balls.map(b => chip(b, false, true, m)).join('')}</span></td><td class="num"><b>${o.runs}</b></td></tr>`).join('')}</tbody></table></div>`;
}
const bbbOpen = new Set(); // which live innings have "Ball by ball" open, kept across re-renders
export function scorecardHTML(m, idx) {
  const i = m.inns[idx];
  const team = m.teams[i.bat];
  const isCur = idx === m.inns.length - 1 && m.status === 'live';
  const ex = i.extras;
  const exT = ex.wd + ex.nb + ex.b + ex.lb + (ex.pen || 0);
  const rr = i.balls ? nf(i.runs / (i.balls / 6)) : '—';
  const bats = i.batters.map((b, k) => {
    const atCrease = isCur && (k === i.striker || k === i.non);
    const how = howOf(b);
    return `<tr><td>${esc(b.name + roleTag(m, i.bat, b.name))}${atCrease && k === i.striker ? ' *' : ''}</td><td class="dismissal">${esc(how)}</td><td class="num"><b>${b.runs}</b></td><td class="num">${b.balls}</td><td class="num">${b.f4}</td><td class="num">${b.f6}</td><td class="num">${b.balls ? nf(b.runs / b.balls * 100, 1) : '—'}</td></tr>`;
  }).join('');
  const bowls = i.bowlers.filter(b => b.balls || b.runs).map(b => `<tr><td>${esc(b.name + roleTag(m, 1 - i.bat, b.name))}</td><td class="num">${fmtOvers(b.balls)}</td><td class="num">${b.maidens}</td><td class="num">${b.runs}</td><td class="num"><b>${b.wkts}</b></td><td class="num">${b.balls ? nf(b.runs / (b.balls / 6)) : '—'}</td><td class="num">${b.dots}</td><td class="num">${b.wd}/${b.nb}</td></tr>`).join('');
  return `<div class="card scorecard">
    <div class="sc-head"><h3>${esc(team)} · innings ${idx + 1}</h3><span class="sc-total">${i.runs}/${i.wkts} <span class="dim" style="font-size:.8em">(${fmtOvers(i.balls)} ov, RR ${rr})</span></span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Batter</th><th>Dismissal</th><th class="num">R</th><th class="num">B</th><th class="num">4s</th><th class="num">6s</th><th class="num">SR</th></tr></thead><tbody>${bats}</tbody></table></div>
    <p class="sc-meta">Extras ${exT} (b ${ex.b}, lb ${ex.lb}, w ${ex.wd}, nb ${ex.nb}${ex.pen ? `, pen ${ex.pen}` : ''})${i.target != null ? ` · Target ${i.target}${i.dls ? ' (DLS)' : ''}` : ''}${i.maxBalls != null && m.overs && i.maxBalls !== m.overs * 6 ? ` · Reduced to ${fmtOvers(i.maxBalls)} overs` : ''}${i.ended ? ` · ${esc(endedText(i.ended, m))}` : ''}</p>
    ${i.fow.length ? `<p class="sc-meta">Fall of wickets: ${i.fow.map(w => `${w.score}-${w.wkt} (${esc(w.name)}, ${w.over} ov)`).join(', ')}</p>` : ''}
    ${partsHTML(m, i)}
    ${(() => {
    const ov = i.overs.filter(o => o.balls.length);
    if (!ov.length) return '';
    const edit = m === live && canEdit();
    // In the live match the overs are only drawn when the section is open, so scoring a ball doesn't redraw them all.
    const lazy = m === live && !bbbOpen.has(idx);
    return `<details class="bbb" data-bbb="${idx}"${m === live && bbbOpen.has(idx) ? ' open' : ''}><summary>Ball by ball${edit ? ' · tap a ball to fix it' : ''}</summary>${lazy ? '' : bbbBody(m, i)}</details>`;
  })()}
    ${bowls ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bowler</th><th class="num">O</th><th class="num">M</th><th class="num">R</th><th class="num">W</th><th class="num">Econ</th><th class="num">Dots</th><th class="num">Wd/Nb</th></tr></thead><tbody>${bowls}</tbody></table></div>` : ''}
  </div>`;
}

export function liveCharts(m) {
  const wrap = $('#live-charts');
  const any = m && m.inns.some(i => i.overs.some(o => o.balls.length));
  wrap.hidden = !any;
  if (!any) return;
  const p = pal();
  const tcol = [p.accent, p.sky];
  const seen = [0, 0];
  const cols = m.inns.map(i => { const c = seen[i.bat]++ ? alpha(tcol[i.bat], 0.55) : tcol[i.bat]; return c; });
  const innLabel = (i, k) => isTest(m) ? `${m.teams[i.bat]} (${ORD[k]})` : m.teams[i.bat];
  const perInn = m.inns.map(i => i.overs.filter(o => o.balls.length));
  const maxO = Math.max(...perInn.map(o => o.length), 1);
  const labels = Array.from({ length: maxO }, (_, k) => String(k + 1));
  chart('c-live-manhattan', {
    type: 'bar',
    data: { labels, datasets: m.inns.map((i, k) => ({
        label: innLabel(i, k),
        data: labels.map((_, j) => perInn[k][j] ? perInn[k][j].runs : null),
        backgroundColor: cols[k].startsWith('#') ? alpha(cols[k], 0.8) : cols[k],
        borderColor: labels.map((_, j) => perInn[k][j] && perInn[k][j].wkts ? p.ball : 'rgba(0,0,0,0)'),
        borderWidth: 2, borderRadius: 4, maxBarThickness: 26,
      })) },
    options: baseOpts({ scales: axes({ x: 'Over', y: 'Runs' }), plugins: { tooltip: { callbacks: { afterLabel: c => { const o = perInn[c.datasetIndex][c.dataIndex]; return o && o.wkts ? `${plural(o.wkts, 'wicket')}` : ''; } } } } }),
  });
  const wl = Array.from({ length: maxO + 1 }, (_, k) => String(k));
  const ds = m.inns.map((i, k) => {
    let c = 0;
    const d = [0, ...perInn[k].map(o => (c += o.runs))];
    return { label: innLabel(i, k), data: wl.map((_, j) => j < d.length ? d[j] : null), borderColor: cols[k], backgroundColor: alpha(tcol[i.bat], 0.12), fill: k === 0, borderDash: isTest(m) && k >= 2 ? [5, 4] : undefined, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, spanGaps: false };
  });
  const tgt = isTest(m) ? m.inns[3]?.target : m.inns[1]?.target;
  if (tgt) ds.push({ label: `Target ${tgt}`, data: wl.map(() => tgt), borderColor: p.ball, borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, fill: false });
  chart('c-live-worm', { type: 'line', data: { labels: wl, datasets: ds }, options: baseOpts({ interaction: { mode: 'index', intersect: false }, scales: axes({ x: 'Overs', y: 'Runs' }) }) });

  wagonCard(m);
  const wp = wpSeries(m);
  const card = $('#live-wp-card');
  card.hidden = !wp;
  if (wp) {
    const t2 = m.teams[m.inns[1].bat], t1 = m.teams[m.inns[0].bat];
    $('#live-wp-hint').textContent = `Above the middle line favours ${t2}, below it favours ${t1}. Each point is the end of an over.`;
    const ax = axes({ x: 'Overs', y: `${t2} win chance` });
    ax.y = { ...ax.y, min: 0, max: 100, ticks: { ...ax.y.ticks, stepSize: 25, callback: v => v + '%' } };
    chart('c-live-wp', {
      type: 'line',
      data: { labels: wp.map(x => x.l), datasets: [
          { label: `${t2} win chance`, data: wp.map(x => x.p), borderColor: p.fg2, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: p.fg2, tension: 0.25, fill: { target: { value: 50 }, above: alpha(p.sky, 0.28), below: alpha(p.accent, 0.28) } },
          { label: 'Even', data: wp.map(() => 50), borderColor: p.line2, borderDash: [4, 4], borderWidth: 1, pointRadius: 0, fill: false },
        ] },
      options: baseOpts({ interaction: { mode: 'index', intersect: false }, scales: ax, plugins: { legend: { display: false }, tooltip: { filter: c => c.datasetIndex === 0, callbacks: { title: it => `After ${it[0].label} overs`, label: c => ` ${t2} ${c.parsed.y}%  ·  ${t1} ${Math.round((100 - c.parsed.y) * 10) / 10}%` } } } }),
    });
  }
}

export function renderLiveAll(animateLast = false) {
  const main = $('#live-main'), actions = $('#live-actions'), cards = $('#live-cards');
  if (!live) {
    main.innerHTML = setupHTML();
    setupSync(null);
    actions.innerHTML = '';
    cards.innerHTML = '';
    liveCharts(null);
    return;
  }
  main.innerHTML = live.status === 'live' ? liveHTML(animateLast) : live.status === 'break' ? breakHTML() : doneHTML();
  actions.innerHTML = `${live.status !== 'done' ? `<button type="button" class="btn ghost" data-act="save-match">Save progress</button>` : ''}<button type="button" class="btn ghost danger" data-act="new">New match</button>`;
  cards.innerHTML = (live.status !== 'live' ? commentaryCardHTML() : '') + daysHTML(live) + live.inns.map((_, k) => scorecardHTML(live, k)).join('');
  paintSituation();
  liveCharts(live);
  if (live.status === 'live' && cur().needBowler) setTimeout(() => $('#live-bowler')?.focus({ preventScroll: true }), 30);
}
RENDER.live = () => renderLiveAll();

/* ---------- Wagon wheel ---------- */
// Field drawn from behind the batter: straight down the ground is up. For a right-hander the off side is on the right.
const SECTORS = ['Long off', 'Cover', 'Point', 'Third man', 'Fine leg', 'Square leg', 'Midwicket', 'Long on'];
// The same zones in plain words, for anyone who doesn't know the fielding positions.
const SECTOR_HINT = ['straight, off side', 'in front, off side', 'square, off side', 'behind, off side', 'behind, leg side', 'square, leg side', 'in front, leg side', 'straight, leg side'];
// Each direction split at the dashed inner circle (about the 30-yard circle): close-in and deep positions.
const INNER_R = 0.48;
const POS_IN = ['Mid-off', 'Cover', 'Point', 'Slips and gully', 'Leg slip', 'Square leg', 'Midwicket', 'Mid-on'];
const POS_OUT = ['Long off', 'Deep cover', 'Deep point', 'Third man', 'Fine leg', 'Deep square leg', 'Deep midwicket', 'Long on'];
const POS_SHORT = ['Mid-off', 'Cover', 'Point', 'Slips', 'Leg slip', 'Sq. leg', 'Mid-wkt', 'Mid-on'];
const isInner = shot => Math.hypot(shot.x, shot.y) <= INNER_R;
// Every standard fielding position, found from the exact angle and distance of a tap.
// Angles run clockwise from straight down the ground, towards the off side, for a right-hander.
const CLOSE_R = 0.2;
const DEEP16 = ['Long off', 'Deep extra cover', 'Deep cover', 'Deep cover point', 'Deep point', 'Deep backward point', 'Third man', 'Fine third man',
  'Fine leg', 'Long leg', 'Deep backward square leg', 'Deep square leg', 'Deep forward square leg', 'Deep midwicket', 'Cow corner', 'Long on'];
const RING16 = ['Mid-off', 'Extra cover', 'Cover', 'Cover point', 'Point', 'Backward point', 'Gully', 'Slips',
  'Leg slip', 'Short fine leg', 'Backward square leg', 'Square leg', 'Forward square leg', 'Midwicket', 'Midwicket', 'Mid-on'];
const CLOSE6 = [[45, 'Silly mid-off'], [135, 'Silly point'], [180, 'Slips'], [225, 'Leg slip'], [315, 'Short leg'], [360, 'Silly mid-on']];
function fieldPos(shot, left) {
  const x = left ? -shot.x : shot.x;
  let ang = Math.atan2(x, -shot.y) * 180 / Math.PI; if (ang < 0) ang += 360;
  const d = Math.hypot(shot.x, shot.y), band = Math.floor(ang / 22.5) % 16;
  const name = d <= CLOSE_R ? CLOSE6.find(([to]) => ang < to)[1] : d <= INNER_R ? RING16[band] : DEEP16[band];
  const side = ang < 180 ? 'off side' : 'leg side';
  const off = ang < 180 ? ang : 360 - ang; // 0 = straight, 90 = square, 180 = straight behind
  const dir = off < 30 ? 'straight' : off < 75 ? 'in front of square' : off < 105 ? 'square' : off < 150 ? 'behind square' : 'fine, behind the batter';
  const dist = d <= CLOSE_R ? 'very close to the bat' : d <= INNER_R ? 'inside the circle' : 'out near the boundary';
  return { name, hint: `${dir}, ${side}, ${dist}` };
}
const posName = (shot, left) => fieldPos(shot, left).name;
// Commentary wording for a shot: the position plus where it sits relative to the batter, e.g. "backward square leg, behind square on the leg side".
function shotPhrase(shot, left) {
  const f = fieldPos(shot, left), [dir, side] = f.hint.split(', ');
  const d = dir === 'straight' ? 'straight' : dir === 'square' ? 'square of the wicket' : dir === 'fine, behind the batter' ? 'fine behind the batter' : dir;
  return dir === 'straight' ? `${f.name.toLowerCase()}, straight down the ground` : `${f.name.toLowerCase()}, ${d} on the ${side}`;
}
const lefty = name => !!store.get('lefties', {})[nameKey(name)];
const nameKey = s => String(s || '').trim().toLowerCase();
function sectorOf(shot, left) {
  const x = left ? -shot.x : shot.x;
  let ang = Math.atan2(x, -shot.y) * 180 / Math.PI; if (ang < 0) ang += 360;
  return Math.floor(ang / 45) % 8;
}
function fieldSVG(shots, { left = false, picker = false } = {}) {
  const C = 150, R = 136;
  const col = r => r >= 6 ? 'var(--accent)' : r >= 4 ? 'var(--sky)' : 'var(--turf)';
  const lines = shots.map(s => `<line x1="${C}" y1="${C}" x2="${(C + s.x * R).toFixed(1)}" y2="${(C + s.y * R).toFixed(1)}" stroke="${col(s.r)}" stroke-width="${s.r >= 4 ? 2.4 : 1.6}" stroke-linecap="round" opacity=".9"/>`).join('');
  const side = (x, txt) => `<text x="${x}" y="22" class="ww-lbl" text-anchor="middle">${txt}</text>`;
  const offRight = !left;
  return `<svg viewBox="0 0 300 300" class="ww-svg${picker ? ' picker' : ''}" role="img" aria-label="${picker ? 'Tap where the shot went' : 'Wagon wheel'}">
    <ellipse cx="${C}" cy="${C}" rx="${R}" ry="${R}" class="ww-ground"/>
    <circle cx="${C}" cy="${C}" r="${R * 0.48}" class="ww-ring"/>
    ${[0, 1, 2, 3].map(k => { const a = k * Math.PI / 4; return `<line x1="${C - Math.sin(a) * R}" y1="${C - Math.cos(a) * R}" x2="${C + Math.sin(a) * R}" y2="${C + Math.cos(a) * R}" class="ww-grid"/>`; }).join('')}
    ${picker ? pickerZones(C, R, left) : ''}
    ${picker ? `<circle cx="${C}" cy="${C}" r="${(R * CLOSE_R).toFixed(1)}" class="ww-fine"/>${Array.from({ length: 8 }, (_, w) => { const a = w * Math.PI / 4 + Math.PI / 8; return `<line x1="${(C + Math.sin(a) * R * CLOSE_R).toFixed(1)}" y1="${(C - Math.cos(a) * R * CLOSE_R).toFixed(1)}" x2="${(C + Math.sin(a) * R).toFixed(1)}" y2="${(C - Math.cos(a) * R).toFixed(1)}" class="ww-fine"/>`; }).join('')}` : ''}
    <rect x="${C - 5}" y="${C - 46}" width="10" height="46" rx="2" class="ww-pitch"/>
    ${lines}
    <circle cx="${C}" cy="${C}" r="4" class="ww-bat"/>
    ${side(offRight ? 236 : 64, 'OFF')}${side(offRight ? 64 : 236, 'LEG')}
    <text x="${C}" y="${picker ? C - R + 16 : C - 54}" class="ww-lbl" text-anchor="middle">BOWLER</text>
    ${picker ? `<text x="${C}" y="${C + R + 14}" class="ww-lbl" text-anchor="middle">BEHIND THE BATTER</text>` : ''}
  </svg>`;
}
// Tap targets for the picker: eight directions, each split into a close-in part (inside the dashed
// circle) and a deep part, labelled with the fielding position.
function pickerZones(C, R, left) {
  const ri = R * INNER_R;
  return Array.from({ length: 8 }, (_, w) => {
    const a0 = w * Math.PI / 4, a1 = a0 + Math.PI / 4, mid = a0 + Math.PI / 8;
    const z = sectorOf({ x: Math.sin(mid), y: -Math.cos(mid) }, left);
    const pt = (a, r) => `${(C + Math.sin(a) * r).toFixed(1)} ${(C - Math.cos(a) * r).toFixed(1)}`;
    const at = r => [C + Math.sin(mid) * r, C - Math.cos(mid) * r].map(v => v.toFixed(1));
    const [ox, oy] = at(R * 0.76), [ix, iy] = at(ri * 0.8);
    const [h1, h2] = SECTOR_HINT[z].split(', ');
    return `<path d="M${C} ${C} L${pt(a0, ri)} A${ri} ${ri} 0 0 1 ${pt(a1, ri)} Z" class="ww-zone" data-z="${z}" data-in="1"/>
      <path d="M${pt(a0, ri)} L${pt(a0, R)} A${R} ${R} 0 0 1 ${pt(a1, R)} L${pt(a1, ri)} A${ri} ${ri} 0 0 0 ${pt(a0, ri)} Z" class="ww-zone" data-z="${z}" data-in="0"/>
      <text x="${ox}" y="${(+oy - 4).toFixed(1)}" class="ww-zname" text-anchor="middle">${POS_OUT[z]}</text>
      <text x="${ox}" y="${(+oy + 8).toFixed(1)}" class="ww-zhint" text-anchor="middle">${h1} · ${h2}</text>
      <text x="${ix}" y="${(+iy + 3).toFixed(1)}" class="ww-zin" text-anchor="middle">${POS_SHORT[z]}</text>`;
  }).join('');
}
// Ask where a scoring shot went (if the scorer has turned this on), then record the ball.
function withShot(ev) {
  const batRuns = ev.runs || 0;
  if (ballTarget || !store.get('wwOn', false) || batRuns === 0 || !live || live.status !== 'live' || cur().needBowler) { applyBall(ev); return; }
  const i = cur(), bat = i.batters[i.striker].name;
  let done = false;
  const finish = ww => { if (done) return; done = true; applyBall(ww ? { ...ev, ww } : ev); };
  const body = openModal(`Where did the ${batRuns === 4 ? 'four' : batRuns === 6 ? 'six' : batRuns === 1 ? 'single' : `${batRuns} runs`} go?`, `
    <p class="hint" style="margin:-6px 0 8px">${esc(bat)} · tap roughly where the ball went. The batter is the white dot, facing the bowler at the top. ${lefty(bat) ? 'Left-hander.' : 'Right-hander.'}</p>
    <div class="ww-pick">${fieldSVG([], { left: lefty(bat), picker: true })}</div>
    <p class="ww-cap" id="ww-cap" aria-live="polite">Move over the field to see the exact position. The small inner circle is close to the bat, the dashed circle is the inner ring, and beyond it is out near the boundary.</p>
    <div class="modal-actions"><label class="check" style="margin-right:auto"><input type="checkbox" id="ww-pick-lh"${lefty(bat) ? ' checked' : ''}> Left-handed batter</label><button type="button" class="btn ghost" data-x="skip">Skip</button></div>`, { onClose: () => finish(null) });
  const onTap = e => {
    const svg = e.currentTarget, rc = svg.getBoundingClientRect();
    if (!rc.width || !rc.height) return;
    let x = ((e.clientX - rc.left) / rc.width * 300 - 150) / 136, y = ((e.clientY - rc.top) / rc.height * 300 - 150) / 136;
    const d = Math.hypot(x, y); if (d > 1.05) { x /= d / 1.05; y /= d / 1.05; }
    finish({ x, y }); // record first: closing the dialog would otherwise count as "no tap"
    closeModal();
  };
  body.querySelector('.ww-pick svg').addEventListener('click', onTap);
  // Name the zone under the pointer, so the scorer can check before tapping.
  body.querySelector('.ww-pick').addEventListener('pointermove', e => {
    const svg = body.querySelector('.ww-pick svg'), rc = svg.getBoundingClientRect();
    if (!rc.width) return;
    const x = ((e.clientX - rc.left) / rc.width * 300 - 150) / 136, y = ((e.clientY - rc.top) / rc.height * 300 - 150) / 136;
    if (Math.hypot(x, y) > 1.05) return;
    const p = fieldPos({ x, y }, $('#ww-pick-lh', body).checked);
    $('#ww-cap', body).innerHTML = `<b>${p.name}</b>: ${p.hint}`;
  });
  body.querySelector('#ww-pick-lh').addEventListener('change', e => {
    const l = store.get('lefties', {}); if (e.target.checked) l[nameKey(bat)] = true; else delete l[nameKey(bat)]; store.set('lefties', l);
    body.querySelector('.ww-pick').innerHTML = fieldSVG([], { left: e.target.checked, picker: true });
    body.querySelector('.ww-pick svg').addEventListener('click', onTap);
  });
  body.addEventListener('click', e => { if (e.target.closest('[data-x="skip"]')) closeModal(); });
}
let wwSel = '';
function wagonCard(m) {
  const card = $('#live-ww-card');
  const opts = [];
  m.inns.forEach((inn, k) => {
    const withShots = inn.batters.map((b, j) => ({ b, j })).filter(x => x.b.shots && x.b.shots.length);
    if (!withShots.length) return;
    opts.push({ v: `${k}:all`, l: `${m.teams[inn.bat]} · ${isTest(m) ? ORD[k] : k ? '2nd' : '1st'} innings (all batters)` });
    withShots.forEach(({ b, j }) => opts.push({ v: `${k}:${j}`, l: `${b.name} · ${b.runs} (${b.balls})` }));
  });
  card.hidden = !opts.length;
  if (!opts.length) return;
  if (!opts.some(o => o.v === wwSel)) {
    const ci = m.inns.length - 1, inn = m.inns[ci];
    const pref = inn && m.status === 'live' ? `${ci}:${inn.striker}` : '';
    wwSel = opts.some(o => o.v === pref) ? pref : opts[0].v;
  }
  const [k, who] = wwSel.split(':');
  const inn = m.inns[Number(k)];
  const pick = who === 'all' ? inn.batters.filter(b => b.shots) : [inn.batters[Number(who)]];
  const shots = pick.flatMap(b => (b.shots || []).map(s => ({ ...s, left: lefty(b.name) })));
  const one = who !== 'all' ? pick[0] : null;
  const zones = SECTORS.map(() => ({ runs: 0, n: 0 }));
  shots.forEach(s => { const z = zones[sectorOf(s, s.left)]; z.runs += s.r; z.n++; });
  const total = zones.reduce((a, z) => a + z.runs, 0) || 1;
  const offRuns = zones.slice(0, 4).reduce((a, z) => a + z.runs, 0);
  const offPct = Math.round(offRuns / total * 100); // leg side is the remainder, so the two always add to 100
  $('#ww-controls').innerHTML = `<select id="ww-who" class="select" aria-label="Whose shots">${opts.map(o => `<option value="${esc(o.v)}"${o.v === wwSel ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>
    ${one ? `<label class="check"><input type="checkbox" id="ww-lh" data-name="${esc(nameKey(one.name))}"${lefty(one.name) ? ' checked' : ''}> Left-handed</label>` : ''}`;
  $('#ww-svg').innerHTML = fieldSVG(shots, { left: one ? lefty(one.name) : false });
  $('#ww-zones').innerHTML = `<p class="hint" style="margin:0 0 10px">${plural(shots.length, 'scoring shot')} recorded · off side ${offPct}%, leg side ${100 - offPct}% of runs${who === 'all' ? ' (each batter\'s own off and leg side)' : ''}</p>
    ${SECTORS.map((nm, z) => `<div class="bar-row"><span>${nm}</span><span class="pts">${plural(zones[z].runs, 'run')} · ${plural(zones[z].n, 'shot')}</span><div class="track"><div class="fill" style="width:${Math.round(zones[z].runs / total * 100)}%"></div></div></div>`).join('')}`;
}

/* ---------- Match-ups ---------- */
function matchupsCard(i) {
  const rows = Object.entries(i.mu || {}).map(([k, v]) => { const [bi, ti] = k.split('|').map(Number); return { ...v, bowler: i.bowlers[bi]?.name || '?', batter: i.batters[ti]?.name || '?' }; })
      .filter(r => r.balls || r.outs).sort((a, b) => b.balls - a.balls).slice(0, 8);
  if (!rows.length) return '';
  return `<div class="card"><h2 class="card-title">Match-ups</h2><div class="tbl-wrap" style="margin-top:0"><table class="tbl"><thead><tr><th>Batter</th><th>Bowler</th><th class="num">R</th><th class="num">B</th><th class="num">SR</th><th class="num">Dots</th><th class="num">Out</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.batter)}</td><td>${esc(r.bowler)}</td><td class="num"><b>${r.runs}</b></td><td class="num">${r.balls}</td><td class="num">${r.balls ? nf(r.runs / r.balls * 100, 1) : '—'}</td><td class="num">${r.dots}</td><td class="num">${r.outs ? `<span class="neg">${r.outs}</span>` : '—'}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}

export function pickRuns(title, note, options, onPick) {
  const body = openModal(title, `<p class="modal-sub">${esc(note)}</p><div class="opt-grid">${options.map(o => `<button type="button" data-v="${o.v}">${esc(o.l)}</button>`).join('')}</div>`);
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const v = Number(b.dataset.v);
    closeModal();
    onPick(v);
  });
}
function batterNameField(i, id, label) {
  const back = i.batters.filter(b => b.retired);
  const sq = sqOf(live, i.bat);
  if (sq) {
    const yet = sq.filter(n => !i.batters.some(b => sameName(b.name, n)));
    const opts = [...yet.map(n => ({ v: n, l: n + roleTag(live, i.bat, n) })), ...back.map(b => ({ v: b.name, l: `${b.name} (retired, returning)` }))];
    return selectField(id, label, opts, opts[0]?.v);
  }
  const def = freshLeft(i) > 0 ? `Batter ${i.batters.length + 1}` : (back[0]?.name || '');
  return `<div class="field"><div class="lab"><label for="${id}">${esc(label)}</label></div><input id="${id}" type="text" maxlength="30" autocomplete="off" value="${esc(def)}" list="${id}-list"></div>
    <datalist id="${id}-list">${back.map(b => `<option value="${esc(b.name)}"></option>`).join('')}</datalist>
    ${back.length ? `<p class="hint" style="grid-column:1/-1;margin:0">Type ${back.map(b => esc(b.name)).join(' or ')} to bring a retired batter back in.</p>` : ''}`;
}
function fielderField(i) {
  const fsq = sqOf(live, 1 - i.bat);
  if (!fsq) return `<div class="lab"><label for="wk-fielder">Fielder</label></div><input id="wk-fielder" type="text" maxlength="30" autocomplete="off" placeholder="Optional">`;
  const bowler = i.bowlers[i.bowler]?.name;
  const opts = [{ v: '', l: 'Not recorded' }, ...fsq.map(n => ({ v: n, l: n + roleTag(live, 1 - i.bat, n) + (bowler && sameName(n, bowler) ? ' (bowler)' : '') })), { v: 'sub', l: 'Substitute fielder' }];
  return selectField('wk-fielder', 'Fielder', opts, '').replace(/^<div class="field">|<\/div>$/g, '');
}
const TYPES = { fair: ['bowled', 'caught', 'lbw', 'stumped', 'hit wicket', 'run out'], wd: ['stumped', 'hit wicket', 'run out'], nb: ['run out'] };
const typeLabel = t => t === 'lbw' ? 'LBW' : t[0].toUpperCase() + t.slice(1);
export function wicketModal() {
  const i = cur();
  const fh = i.freeHit;
  const last = !(freshLeft(i) > 0 || i.batters.some(b => b.retired));
  const st = i.batters[i.striker], ns = i.batters[i.non];
  let ball = 'fair', how = fh ? 'run out' : 'bowled', who = 'striker', runs = 0;
  const allowed = () => fh ? ['run out'] : TYPES[ball];
  const body = openModal('Wicket', `
    ${fh ? '<p class="hint" style="margin:0 0 10px">Free hit: only a run out is possible.</p>' : ''}
    <div class="modal-block"><p class="modal-sub">Delivery</p><div class="seg" id="wk-ball">
      <button type="button" data-ball="fair" aria-pressed="true">Fair ball</button><button type="button" data-ball="wd" aria-pressed="false">Wide</button><button type="button" data-ball="nb" aria-pressed="false">No-ball</button>
    </div></div>
    <div class="modal-block"><p class="modal-sub">How out</p><div class="seg" id="wk-how"></div></div>
    <div class="modal-block" id="wk-ro" hidden>
      <p class="modal-sub">Who is out</p>
      <div class="seg" id="wk-who"><button type="button" data-who="striker" aria-pressed="true">${esc(st.name)} (striker)</button><button type="button" data-who="non" aria-pressed="false">${esc(ns.name)}</button></div>
    </div>
    <div class="modal-block" id="wk-r">
      <p class="modal-sub" id="wk-r-lbl">Runs completed</p>
      <div class="seg" id="wk-runs">${[0, 1, 2, 3].map(r => `<button type="button" data-runs="${r}" aria-pressed="${r === 0}">${r}</button>`).join('')}</div>
    </div>
    <div class="fields one">
      <div class="field" id="wk-f-wrap">${fielderField(i)}</div>
      ${last ? '' : batterNameField(i, 'wk-new', 'New batter')}
    </div>
    ${last ? '<p class="hint">Nobody is left to bat, so this wicket ends the innings.</p>' : ''}
    <p class="hint" id="wk-note"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn solid-danger" data-x="ok">Record wicket</button></div>`);
  const press = (wrap, attr, val) => $$(`[data-${attr}]`, wrap).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(val))));
  const sync = () => {
    const list = allowed();
    if (!list.includes(how)) how = list[0];
    $('#wk-how').innerHTML = list.map(t => `<button type="button" data-how="${t}" aria-pressed="${t === how}">${typeLabel(t)}</button>`).join('');
    $('#wk-ro').hidden = how !== 'run out';
    $('#wk-r').hidden = how !== 'run out';
    $('#wk-r-lbl').textContent = ball === 'wd' ? 'Runs completed (added as wides)' : ball === 'nb' ? 'Runs completed (credited to the batter)' : 'Runs completed before the run out';
    $('#wk-f-wrap').hidden = !['caught', 'stumped', 'run out'].includes(how);
    const fs = $('#wk-fielder');
    const keeper = live.keepers?.[1 - i.bat];
    if (fs && fs.tagName === 'SELECT' && keeper) { // stumpings default to the keeper
      if (how === 'stumped' && (fs.value === '' || fs.dataset.auto === '1')) { fs.value = keeper; fs.dataset.auto = '1'; }
      else if (how !== 'stumped' && fs.dataset.auto === '1') { fs.value = ''; fs.dataset.auto = '0'; }
    }
    $('#wk-note').textContent = ball === 'wd' ? 'The wide still counts: 1 run plus any runs completed, and the ball is bowled again.' : ball === 'nb' ? 'The no-ball still counts, and the next ball is a free hit.' : '';
    if (how !== 'run out') { who = 'striker'; press($('#wk-who'), 'who', who); }
  };
  sync();
  $('#wk-fielder')?.addEventListener('change', e => { e.target.dataset.auto = '0'; });
  body.addEventListener('click', e => {
    const bl = e.target.closest('[data-ball]'), h = e.target.closest('[data-how]'), w = e.target.closest('[data-who]'), r = e.target.closest('[data-runs]'), x = e.target.closest('[data-x]');
    if (bl) { ball = bl.dataset.ball; press($('#wk-ball'), 'ball', ball); sync(); }
    if (h) { how = h.dataset.how; sync(); }
    if (w) { who = w.dataset.who; press($('#wk-who'), 'who', who); }
    if (r) { runs = Number(r.dataset.runs); press($('#wk-runs'), 'runs', runs); }
    if (x) {
      if (x.dataset.x === 'cancel') { closeModal(); return; }
      const takesRuns = how === 'run out';
      const ev = { type: 'wkt', ball, how, outWho: how === 'run out' ? who : 'striker', runs: takesRuns ? runs : 0, fielder: $('#wk-fielder')?.value || '', newBatter: $('#wk-new')?.value || '' };
      closeModal();
      applyBall(ev);
    }
  });
}

function moreRunsModal() {
  let ran = 1, ot = false, to = 'bat';
  const body = openModal('Other runs', `
    <div class="modal-block"><p class="modal-sub">Runs completed by running</p><div class="seg" id="mr-ran">${[0, 1, 2, 3, 4, 5, 6, 7].map(r => `<button type="button" data-ran="${r}" aria-pressed="${r === ran}">${r}</button>`).join('')}</div></div>
    <div class="modal-block"><label class="check" style="font-size:.9rem;color:var(--fg-2)"><input type="checkbox" id="mr-ot"> Overthrow went to the boundary (+4)</label></div>
    <div class="modal-block"><p class="modal-sub">Credited to</p><div class="seg" id="mr-to"><button type="button" data-to="bat" aria-pressed="true">Batter</button><button type="button" data-to="b" aria-pressed="false">Byes</button><button type="button" data-to="lb" aria-pressed="false">Leg byes</button></div></div>
    <p class="answer" style="display:block;margin-top:16px" id="mr-sum"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Add runs</button></div>`);
  const press = (wrap, attr, val) => $$(`[data-${attr}]`, wrap).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(val))));
  const total = () => ran + (ot ? 4 : 0);
  const sum = () => {
    const t = total();
    $('#mr-sum').innerHTML = t === 0 ? 'No runs: use the dot-ball button for this.' : `<strong>${plural(t, 'run')}</strong> to ${to === 'bat' ? 'the batter' : to === 'b' ? 'byes' : 'leg byes'}. ${ran % 2 ? 'The batters crossed, so strike changes.' : 'Strike stays the same.'}`;
  };
  sum();
  $('#mr-ot').addEventListener('change', e => { ot = e.target.checked; sum(); });
  body.addEventListener('click', e => {
    const a = e.target.closest('[data-ran]'), t = e.target.closest('[data-to]'), x = e.target.closest('[data-x]');
    if (a) { ran = Number(a.dataset.ran); press($('#mr-ran'), 'ran', ran); sum(); }
    if (t) { to = t.dataset.to; press($('#mr-to'), 'to', to); sum(); }
    if (x) {
      if (x.dataset.x === 'cancel') { closeModal(); return; }
      const t2 = total();
      if (t2 === 0) { toast('Pick at least one run'); return; }
      closeModal();
      const ev = { type: to === 'bat' ? 'run' : to, runs: t2, ran, ot: ot || undefined };
      if (to === 'bat') withShot(ev); else applyBall(ev);
    }
  });
}

function retireModal() {
  const i = cur();
  if (!canBringIn(i)) { toast('Nobody is left to come in, so no one can retire.'); return; }
  let who = 'striker';
  const st = i.batters[i.striker], ns = i.batters[i.non];
  const body = openModal('Retire a batter', `
    <div class="modal-block"><p class="modal-sub">Who is retiring</p><div class="seg" id="rt-who"><button type="button" data-who="striker" aria-pressed="true">${esc(st.name)} (striker)</button><button type="button" data-who="non" aria-pressed="false">${esc(ns.name)}</button></div></div>
    <div class="fields">${batterNameField(i, 'rt-new', 'Replacement batter')}</div>
    <p class="hint">Retired hurt is not a wicket. The batter can come back later by typing their name when a new batter is needed.</p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Retire batter</button></div>`);
  body.addEventListener('click', e => {
    const w = e.target.closest('[data-who]'), x = e.target.closest('[data-x]');
    if (w) { who = w.dataset.who; $$('[data-who]', body).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.who === who))); }
    if (x) {
      if (x.dataset.x === 'cancel') { closeModal(); return; }
      const nm = $('#rt-new').value;
      closeModal();
      retireBatter(who, nm);
      toast('Batter retired hurt');
    }
  });
}

function penaltyModal() {
  const i = cur();
  const bat = live.teams[i.bat], fld = live.teams[1 - i.bat];
  const fieldBatted = live.inns.some(x => x !== i && x.bat === 1 - i.bat);
  const fieldNote = fieldBatted ? `added to ${fld}'s last innings${i.target != null ? ', so the target goes up by 5' : ''}` : `added to ${fld}'s score when they bat`;
  const body = openModal('Penalty runs', `
    <p class="modal-sub">Award 5 penalty runs to</p>
    <div class="opt-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))"><button type="button" data-pen="bat" style="font-size:1rem">${esc(bat)}<br><span style="font:500 .75rem var(--f-body);color:var(--muted)">batting now</span></button><button type="button" data-pen="fld" style="font-size:1rem">${esc(fld)}<br><span style="font:500 .75rem var(--f-body);color:var(--muted)">fielding now</span></button></div>
    <p class="hint">Runs to the batting side are added straight to the score. Runs to the fielding side are ${esc(fieldNote)}. Neither counts as a ball.</p>`);
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-pen]');
    if (!b) return;
    closeModal();
    awardPenalty(b.dataset.pen === 'bat');
    toast(`5 penalty runs to ${b.dataset.pen === 'bat' ? bat : fld}`);
  });
}

function renameModal() {
  const inp = (id, v) => `<input id="${id}" type="text" maxlength="30" autocomplete="off" value="${esc(v)}" aria-label="Name">`;
  const body = openModal('Edit names', `
    <div class="modal-block"><p class="modal-sub">Teams</p><div class="fields">${live.teams.map((t, k) => `<div class="field">${inp(`rn-t${k}`, t)}</div>`).join('')}</div></div>
    ${live.inns.map((inn, k) => `
      <div class="modal-block"><p class="modal-sub">${esc(live.teams[inn.bat])} batters (innings ${k + 1})</p><div class="fields">${inn.batters.map((b, j) => `<div class="field">${inp(`rn-b${k}-${j}`, b.name)}</div>`).join('')}</div></div>
      <div class="modal-block"><p class="modal-sub">${esc(live.teams[1 - inn.bat])} bowlers (innings ${k + 1})</p><div class="fields">${inn.bowlers.map((b, j) => `<div class="field">${inp(`rn-w${k}-${j}`, b.name)}</div>`).join('')}</div></div>`).join('')}
    <p class="err-text" id="rn-err"></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Save names</button></div>`, { wide: true });
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const val = id => ($('#' + id)?.value || '').trim();
    const names = { teams: live.teams.map((_, k) => val(`rn-t${k}`)), batters: [], bowlers: [] };
    live.inns.forEach((inn, k) => {
      names.batters[k] = inn.batters.map((_, j) => val(`rn-b${k}-${j}`));
      names.bowlers[k] = inn.bowlers.map((_, j) => val(`rn-w${k}-${j}`));
    });
    const dupe = list => list.filter(Boolean).map(s => s.toLowerCase()).some((s, k, a) => a.indexOf(s) !== k);
    if (names.teams[0] && names.teams[1] && names.teams[0].toLowerCase() === names.teams[1].toLowerCase()) { $('#rn-err').textContent = 'The two teams need different names.'; return; }
    if (names.bowlers.some(dupe) || names.batters.some(dupe)) { $('#rn-err').textContent = 'Two players in the same list have the same name.'; return; }
    closeModal();
    renameAll(names);
    toast('Names updated');
  });
}

export async function liveAction(action, el) {
  if (ballTarget && !['run', 'wkt', 'wd', 'nb', 'b', 'lb', 'more'].includes(action)) ballTarget = null;
  switch (action) {
    case 'start': startMatch(); break;
    case 'run': withShot({ type: 'run', runs: Number(el.dataset.r) }); break;
    case 'wkt': wicketModal(); break;
    case 'wd': pickRuns('Wide', 'Total runs from this wide, including the one-run penalty', [1, 2, 3, 4, 5].map(t => ({ l: String(t), v: t - 1 })), r => applyBall({ type: 'wd', runs: r })); break;
    case 'nb': pickRuns('No-ball', 'Runs off the bat (the one-run penalty is added for you)', [0, 1, 2, 3, 4, 6].map(r => ({ l: String(r), v: r })), r => withShot({ type: 'nb', runs: r })); break;
    case 'b': pickRuns('Byes', 'Byes run', [1, 2, 3, 4].map(r => ({ l: String(r), v: r })), r => applyBall({ type: 'b', runs: r })); break;
    case 'lb': pickRuns('Leg byes', 'Leg byes run', [1, 2, 3, 4].map(r => ({ l: String(r), v: r })), r => applyBall({ type: 'lb', runs: r })); break;
    case 'more': moreRunsModal(); break;
    case 'retire': retireModal(); break;
    case 'penalty': penaltyModal(); break;
    case 'rain': rainModal(); break;
    case 'dayovers': dayOversModal(); break;
    case 'session': {
      const stumps = el.dataset.v === '1', c = clockOf();
      const lastDay = (stumps || c.s === 2) && c.day >= (live.days || 5);
      if (lastDay && !(await confirmBox('Stumps on the last day?', 'The match ends as a draw. You can undo it.', 'Stumps: draw'))) break;
      if (stumps && c.s < 2 && !lastDay && !(await confirmBox('End the day now?', `The rest of today's overs (about ${fmtOvers(Math.max(0, dayBalls() - todayBalls()))}) are lost. Use this for bad light or rain. You can undo it.`, 'Stumps now'))) break;
      const err = act({ t: 'session', stumps }, () => coreSession(stumps));
      if (err) toast(`Can't do that: ${err}.`); else toast(live.status === 'done' ? live.result : `${live.sessions[live.sessions.length - 1].label}: ${live.sessions[live.sessions.length - 1].text}`);
      break;
    }
    case 'comm': openCommentary(live, `${live.teams[0]} v ${live.teams[1]}`); break;
    case 'newball': { const err = act({ t: 'newball' }, coreNewBall); toast(err ? `Can't do that: ${err}.` : 'New ball taken'); break; }
    case 'sc-image': scorecardImage(live); break;
    case 'print': printScorecard(live); break;
    case 'rename': renameModal(); break;
    case 'undo': undo(); break;
    case 'swap': act({ t: 'swap' }, coreSwap); break;
    case 'swap-teams': swapSetupTeams(); break;
    case 'edit-ball': openEditBall(Number(el.dataset.li)); break;
    case 'set-bowler': setBowler($('#live-bowler')?.value); break;
    case 'start-2nd': startSecond(); break;
    case 'end-inn':
      if (isTest() && live.inns.length === 4) { liveAction('draw', el); break; }
      if (await confirmBox(isTest() ? 'Declare this innings?' : 'End this innings?', isTest() ? 'The innings closes at the current score. You can undo it.' : live.inns.length === 1 ? 'The innings closes at the current score and the other side starts its chase. If play has stopped for good, use “No result” instead. You can undo it.' : `The chase stops at ${cur().runs}/${cur().wkts} and the result is decided on that score. If play has stopped for good, use “No result” instead. You can undo it.`, isTest() ? 'Declare' : 'End innings', true)) {
        act({ t: 'end', reason: 'declared' }, () => coreEnd('declared'));
      }
      break;
    case 'draw':
      if (await confirmBox('End the match as a draw?', 'Use this when time runs out or play is called off. You can undo it.', 'End as a draw')) {
        act({ t: 'end', reason: 'draw' }, () => coreEndAny('draw'));
      }
      break;
    case 'abandon':
      if (await confirmBox('End the match with no result?', 'Use this when rain or bad light stops play for good. Neither side wins, and in a tournament it counts as a no result. You can undo it.', 'No result', true)) {
        act({ t: 'end', reason: 'abandoned' }, () => coreAbandon());
      }
      break;
    case 'fo': followOn = el.dataset.v === '1'; renderLiveAll(); break;
    case 'new':
      if (await confirmBox('Start a new match?', 'The current match will be cleared. Save it first if you want to keep it.', 'Clear and start new', true)) {
        live = null; undoStack = []; store.del('live'); store.del('liveUndo'); renderLiveAll();
      }
      break;
    case 'save-match': saveMatch(); break;
    case 'image': shareImage(liveShareData()); break;
    case 'csv': showCSV(`${live.teams[0]}-v-${live.teams[1]}-scorecard.csv`, scorecardCSV(live)); break;
    default: break;
  }
}
$('#tab-live').addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const action = el.dataset.act, r = el.dataset.r;
  liveAction(action, el);
  // Re-rendering replaces the pad; put keyboard focus back on the same button.
  if (['run', 'swap', 'undo'].includes(action) && document.activeElement === document.body) {
    const sel = action === 'run' ? `#live-main [data-act="run"][data-r="${r}"]` : `#live-main [data-act="${action}"]`;
    const again = $(sel);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  }
});
$('#tab-live').addEventListener('input', e => {
  if (!live && e.target.closest('#live-main')) setupSync(e.target);
  if (live && e.target.id === 'l2-lost') previewLost2();
});
$('#live-cards').addEventListener('toggle', e => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || d.dataset.bbb == null || !live) return;
  const k = Number(d.dataset.bbb);
  if (d.open) { bbbOpen.add(k); if (!d.querySelector('.tbl-wrap') && live.inns[k]) d.insertAdjacentHTML('beforeend', bbbBody(live, live.inns[k])); }
  else bbbOpen.delete(k);
}, true);
$('#tab-live').addEventListener('change', e => {
  if (!live && e.target.id === 'ls-type') setupSync(e.target);
  if (e.target.id === 'ww-on') { e.target.blur(); store.set('wwOn', e.target.checked); toast(e.target.checked ? 'You\'ll be asked where each scoring shot went' : 'Wagon wheel prompts off'); }
  if (e.target.id === 'ww-who') { wwSel = e.target.value; liveCharts(live); }
  if (e.target.id === 'ww-lh') { const nm = e.target.dataset.name; const l = store.get('lefties', {}); if (e.target.checked) l[nm] = true; else delete l[nm]; store.set('lefties', l); liveCharts(live); }
});
$('#tab-live').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'live-bowler') { e.preventDefault(); setBowler(e.target.value); }
  if (e.key === 'Enter' && e.target.closest('.setup-grid')) { e.preventDefault(); live ? (live.status === 'break' ? startSecond() : null) : startMatch(); }
});
document.addEventListener('keydown', e => {
  if (nav.active !== 'live' || !live || !modal.hidden) return;
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'u' || e.key === 'U') { e.preventDefault(); undo(); return; } // works after an innings or the match ends too
  if (live.status !== 'live') return;
  const i = cur();
  if (i.needBowler) return;
  if (['0', '1', '2', '3', '4', '5', '6'].includes(e.key)) { e.preventDefault(); withShot({ type: 'run', runs: Number(e.key) }); }
  else if (e.key === 'w' || e.key === 'W') { e.preventDefault(); wicketModal(); }
});

export function liveShareData() {
  const f = live.format;
  return {
    eyebrow: `${f} · ${live.teams[0]} v ${live.teams[1]}`,
    title: live.result || (live.status === 'break' ? (isTest() ? leadText(true).replace(/^Innings over\. /, '') : `${live.teams[1 - live.inns[0].bat]} need ${plannedChase().target}`) : `${live.teams[cur().bat]} ${cur().runs}/${cur().wkts}`),
    subtitle: live.inns.map(i => `${live.teams[i.bat]} ${i.runs}/${i.wkts} (${fmtOvers(i.balls)} ov)`).join('  ·  '),
    stats: live.inns.flatMap(i => {
      const top = i.batters.slice().sort((a, b) => b.runs - a.runs)[0];
      const best = i.bowlers.slice().sort((a, b) => b.wkts - a.wkts || a.runs - b.runs)[0];
      return [
        { label: `${live.teams[i.bat]} top score`, value: top ? `${top.runs}${top.out ? '' : '*'}` : '—', sub: top?.name },
        { label: 'Best bowling', value: best ? `${best.wkts}/${best.runs}` : '—', sub: best?.name },
        { label: 'Run rate', value: i.balls ? nf(i.runs / (i.balls / 6)) : '—' },
      ];
    }),
  };
}
export function scorecardCSV(m) {
  const rows = [];
  m.inns.forEach((i, k) => {
    rows.push([`${m.teams[i.bat]} innings ${k + 1}`, `${i.runs}/${i.wkts}`, `${fmtOvers(i.balls)} overs`]);
    rows.push(['Batter', 'Dismissal', 'Runs', 'Balls', '4s', '6s', 'SR']);
    i.batters.forEach(b => rows.push([b.name + roleTag(m, i.bat, b.name), howOf(b), b.runs, b.balls, b.f4, b.f6, b.balls ? fx(b.runs / b.balls * 100) : '']));
    rows.push(['Extras', `b ${i.extras.b}, lb ${i.extras.lb}, w ${i.extras.wd}, nb ${i.extras.nb}${i.extras.pen ? `, pen ${i.extras.pen}` : ''}`]);
    rows.push(['Bowler', 'Overs', 'Maidens', 'Runs', 'Wickets', 'Econ', 'Dots']);
    i.bowlers.filter(b => b.balls || b.runs).forEach(b => rows.push([b.name + roleTag(m, 1 - i.bat, b.name), fmtOvers(b.balls), b.maidens, b.runs, b.wkts, b.balls ? fx(b.runs / (b.balls / 6)) : '', b.dots]));
    rows.push([]);
  });
  if (m.result) rows.push(['Result', m.result]);
  return toCSV(rows);
}


export function clearLive() { live = null; undoStack = []; store.del('live'); store.del('liveUndo'); }
export function resumeMatch(data) { live = JSON.parse(JSON.stringify(data)); undoStack = []; saveLive(); }

/* ---------- Rain dialog ---------- */
const poss = n => (/s$/i.test(n) ? `${n}'` : `${n}'s`);
function rainModal() {
  if (!live || live.status !== 'live' || !live.overs || isTest()) return;
  const i = cur(), k = live.inns.length - 1;
  const team = live.teams[i.bat], other = live.teams[1 - i.bat];
  const left = maxBallsOf(i) - i.balls;
  const body = openModal('Rain or bad light', `
    <p class="hint" style="margin:-6px 0 12px">${k === 0
      ? `Takes overs off ${esc(poss(team))} innings. ${esc(poss(other))} target is then set with a DLS-style calculation.`
      : `Takes overs off ${esc(poss(team))} chase and revises the target with a DLS-style calculation.`} ${fmtOvers(left)} overs are left in this innings.</p>
    <div class="fields">${liveField('rn-lost', 'Overs lost', '', { im: 'decimal', max: 5 })}</div>
    <label class="check" style="margin-top:10px"><input type="checkbox" id="rn-end"> No more play in this innings</label>
    <p class="answer" id="rn-prev" style="display:block;margin-top:14px" hidden></p>
    <p class="err-text" id="rn-err"></p>
    <p class="hint">The official DLS tables are licensed, so match officials' targets can differ by a few runs. Undo reverses this like any other change.</p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Apply</button></div>`);
  const read = () => {
    if ($('#rn-end', body).checked) return { noMore: true, balls: left };
    const s = $('#rn-lost', body).value.trim();
    if (!s) return { error: 'Enter the overs lost, or tick “No more play”.' };
    const p = parseOvers(s);
    if (p.error || p.balls == null) return { error: `Overs lost: ${p.error || 'write it like 4 or 4.3'}.` };
    if (p.balls <= 0) return { error: 'Enter the overs lost, or tick “No more play”.' };
    if (p.balls > left) return { error: `Only ${fmtOvers(left)} overs are left in this innings.` };
    return { balls: p.balls, noMore: p.balls === left };
  };
  // Preview: apply the stoppage to a copy of the match, describe it, and put the match back.
  const preview = () => {
    const r = read(), out = $('#rn-prev', body), errEl = $('#rn-err', body);
    $('#rn-lost', body).disabled = $('#rn-end', body).checked;
    if (r.error) { out.hidden = true; return r; }
    errEl.textContent = '';
    const snap = JSON.stringify(live);
    let text;
    try {
      const err = coreRain(r.balls, r.noMore);
      if (err) text = err;
      else if (live.status === 'done') text = `No more play: <strong>${esc(live.result)}</strong>${live.dlsPar != null ? ` (par was ${live.dlsPar})` : ''}.`;
      else if (k === 0) text = live.status === 'break' ? `${esc(poss(team))} innings ends at ${cur().runs}/${cur().wkts}. ${esc(other)} would need <strong>${plannedChase().target}</strong> from ${fmtOvers(plannedChase().balls)} overs.` : `${esc(poss(team))} innings becomes <strong>${fmtOvers(maxBallsOf(cur()))} overs</strong>. ${esc(poss(other))} target is revised when they bat.`;
      else { const c = cur(); text = c.ended === 'target' ? `${esc(team)} are already past the revised target of ${c.target}.` : `Revised target <strong>${c.target}</strong> from ${fmtOvers(maxBallsOf(c))} overs: ${esc(team)} need ${c.target - c.runs} more off ${plural(maxBallsOf(c) - c.balls, 'ball')}.`; }
    } finally { live = JSON.parse(snap); }
    out.hidden = false; out.innerHTML = text;
    return r;
  };
  body.addEventListener('input', preview);
  body.addEventListener('change', preview);
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const r = preview();
    if (r.error) { $('#rn-err', body).textContent = r.error; return; }
    closeModal();
    const err = applyRain(r.balls, r.noMore);
    toast(err ? `Can't apply that: ${err}.` : live.status === 'done' ? `Match over: ${live.result}` : 'Stoppage recorded. Target and overs updated.');
  });
}

// Tests: set how many overs today has (a late start or stoppage for rain, or extra overs to catch up).
function dayOversModal() {
  if (!live || live.status === 'done' || !isTest()) return;
  const day = clockOf().day, now = dayBalls() / 6, bowled = todayBalls();
  const body = openModal(`Overs for day ${day}`, `
    <p class="hint" style="margin:-6px 0 12px">A normal day has 90 overs. If rain or bad light delays the start or stops play, enter the overs the umpires have scheduled for today, such as 75. If they add overs to make up lost time, enter more than 90. ${fmtOvers(bowled)} overs have been bowled today.</p>
    <div class="fields">${liveField('do-overs', 'Overs today', String(now), { im: 'numeric', max: 3 })}</div>
    <p class="err-text" id="do-err"></p>
    <p class="hint">This changes today only. The overs left in the match and the result chances update. If play is over for the day, press “Stumps now” instead. Undo reverses this.</p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="ok">Apply</button></div>`);
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { closeModal(); return; }
    const v = $('#do-overs', body).value.trim();
    const o = Number(v);
    if (!v || !Number.isInteger(o)) { $('#do-err', body).textContent = 'Enter a whole number of overs, such as 75.'; return; }
    const err = act({ t: 'dayovers', overs: o }, () => coreDayOvers(o));
    if (err) { $('#do-err', body).textContent = `Can't do that: ${err}.`; return; }
    closeModal();
    toast(`Day ${day}: ${o} overs`);
  });
}

/* ---------- Scorecard as an image, and printing ---------- */
export async function scorecardImage(m) {
  if (!m) return;
  try { await Promise.all(['800 40px "Saira Condensed"', '700 30px "Saira Condensed"', '600 20px Figtree', '400 20px Figtree'].map(f => document.fonts.load(f))); } catch { /* fallback fonts */ }
  const W = 1200, P = 50, D = 'Saira Condensed, Arial Narrow, sans-serif', B = 'Figtree, system-ui, sans-serif';
  const num = (x, t, at) => { x.textAlign = 'right'; x.fillText(String(t), at, x._y); x.textAlign = 'left'; };
  // Draws the whole card and returns its height, so it can run once to measure and once for real.
  const paint = x => {
    x.fillStyle = '#08120f'; x.fillRect(0, 0, W, x.canvas.height);
    for (let s = 0; s < W; s += 160) { x.fillStyle = 'rgba(255,255,255,0.022)'; x.fillRect(s, 0, 80, x.canvas.height); }
    x.fillStyle = '#e95a4f'; x.beginPath(); x.arc(P + 22, 62, 22, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#e8f0eb'; x.font = `800 34px ${D}`; x.textBaseline = 'middle'; x.fillText('CREASE', P + 56, 64);
    x.fillStyle = '#f3c24c'; x.font = `600 20px ${B}`; x.textAlign = 'right'; x.fillText(fitText(x, `${m.format || ''} · ${m.teams[0]} v ${m.teams[1]}`.toUpperCase(), 640), W - P, 64); x.textAlign = 'left';
    x.textBaseline = 'alphabetic';
    let y = 150;
    x.fillStyle = '#ffffff'; x.font = `800 50px ${D}`; x.fillText(fitText(x, m.result || 'In progress', W - 2 * P), P, y);
    y += 50;
    m.inns.forEach((i, k) => {
      const ex = i.extras, exT = ex.wd + ex.nb + ex.b + ex.lb + (ex.pen || 0);
      x.fillStyle = '#11201b'; roundRect(x, P, y, W - 2 * P, 56, 12); x.fill(); x.strokeStyle = '#22392f'; x.lineWidth = 2; x.stroke();
      x.fillStyle = '#e8f0eb'; x.font = `700 30px ${D}`; x.fillText(fitText(x, `${m.teams[i.bat]} · innings ${k + 1}`.toUpperCase(), 640), P + 20, y + 38);
      x.fillStyle = '#f3c24c'; x._y = y + 38; num(x, `${i.runs}/${i.wkts} (${fmtOvers(i.balls)} ov)`, W - P - 20);
      y += 92;
      const cols = [['R', 840], ['B', 910], ['4s', 980], ['6s', 1050], ['SR', W - P]];
      x.fillStyle = '#8ea398'; x.font = `600 16px ${B}`; x.fillText('BATTER', P, y); x.fillText('DISMISSAL', P + 300, y); x._y = y; cols.forEach(([l, at]) => num(x, l, at));
      y += 12;
      i.batters.forEach(b => {
        y += 34; x._y = y;
        x.fillStyle = 'rgba(255,255,255,0.05)'; x.fillRect(P, y - 25, W - 2 * P, 1);
        x.fillStyle = '#e8f0eb'; x.font = `600 20px ${B}`; x.fillText(fitText(x, b.name + roleTag(m, i.bat, b.name), 285), P, y);
        x.fillStyle = '#8ea398'; x.font = `400 18px ${B}`; x.fillText(fitText(x, howOf(b), 470), P + 300, y);
        x.font = `600 20px ${B}`; x.fillStyle = '#ffffff'; num(x, b.runs, 840);
        x.fillStyle = '#c3d1c9'; [b.balls, b.f4, b.f6, b.balls ? nf(b.runs / b.balls * 100, 1) : '—'].forEach((v, j) => num(x, v, cols[j + 1][1]));
      });
      y += 36;
      x.fillStyle = '#a8bcb1'; x.font = `400 18px ${B}`;
      x.fillText(fitText(x, `Extras ${exT} (b ${ex.b}, lb ${ex.lb}, w ${ex.wd}, nb ${ex.nb}${ex.pen ? `, pen ${ex.pen}` : ''})${i.target != null ? ` · Target ${i.target}${i.dls ? ' (DLS)' : ''}` : ''}`, W - 2 * P), P, y);
      if (i.fow.length) { // wrap the fall of wickets over as many lines as it needs
        let lineTxt = 'Fall of wickets: ';
        i.fow.map(w => `${w.score}-${w.wkt} (${w.name}, ${w.over})`).forEach((part, j, all) => {
          const add = part + (j < all.length - 1 ? ', ' : '');
          if (x.measureText(lineTxt + add).width > W - 2 * P) { y += 26; x.fillText(lineTxt.trimEnd(), P, y); lineTxt = ''; }
          lineTxt += add;
        });
        y += 26; x.fillText(lineTxt, P, y);
      }
      const bw = i.bowlers.filter(b => b.balls || b.runs);
      if (bw.length) {
        y += 44;
        const bc = [['O', 760], ['M', 840], ['R', 920], ['W', 1000], ['ECON', W - P]];
        x.fillStyle = '#8ea398'; x.font = `600 16px ${B}`; x.fillText('BOWLER', P, y); x._y = y; bc.forEach(([l, at]) => num(x, l, at));
        y += 12;
        bw.forEach(b => {
          y += 34; x._y = y;
          x.fillStyle = 'rgba(255,255,255,0.05)'; x.fillRect(P, y - 25, W - 2 * P, 1);
          x.fillStyle = '#e8f0eb'; x.font = `600 20px ${B}`; x.fillText(fitText(x, b.name + roleTag(m, 1 - i.bat, b.name), 600), P, y);
          x.fillStyle = '#c3d1c9';
          [fmtOvers(b.balls), b.maidens, b.runs].forEach((v, j) => num(x, v, bc[j][1]));
          x.fillStyle = '#ffffff'; num(x, b.wkts, 1000);
          x.fillStyle = '#c3d1c9'; num(x, b.balls ? nf(b.runs / (b.balls / 6)) : '—', W - P);
        });
      }
      y += 50;
    });
    x.fillStyle = '#5f7569'; x.font = `500 18px ${B}`; x.fillText(`Made with Crease · ${new Date(m.created || Date.now()).toLocaleDateString()}`, P, y + 6);
    return y + 40;
  };
  const probe = document.createElement('canvas'); probe.width = W; probe.height = 1;
  const H = Math.ceil(paint(probe.getContext('2d')));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  paint(c.getContext('2d'));
  const slug = `${m.teams[0]}-v-${m.teams[1]}`.replace(/[^\w-]+/g, '-');
  c.toBlob(blob => { if (!blob) { toast('Could not create the image'); return; } showImageModal(blob, `${slug}-scorecard.png`, 'Scorecard image', 'Full scorecard'); }, 'image/png');
}

// Print just the scorecard. The browser's print dialog can also save it as a PDF.
export function printScorecard(m) {
  if (!m) return;
  let host = document.getElementById('print-area');
  if (!host) { host = document.createElement('div'); host.id = 'print-area'; document.body.appendChild(host); }
  const title = `${m.teams[0]} v ${m.teams[1]}`;
  host.innerHTML = `<h1>${esc(title)}</h1><p class="pa-result">${esc(m.result || 'In progress')}</p><p class="pa-meta">${esc(m.format || '')} · ${new Date(m.created || Date.now()).toLocaleDateString()}</p>${daysHTML(m)}${m.inns.map((_, k) => scorecardHTML(m, k)).join('')}`;
  host.querySelectorAll('details.parts').forEach(d => { d.open = true; });
  host.querySelectorAll('button').forEach(b => { b.replaceWith(Object.assign(document.createElement('span'), { className: b.className, textContent: b.textContent })); });
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  try { window.print(); }
  catch { done(); toast('Printing is blocked here. Use “Scorecard image” instead.'); }
}

// A saved or linked match's scorecard in a dialog, with image and print buttons.
export function openScorecard(m, title) {
  const body = openModal(title, `<p style="margin:0 0 12px;font-weight:700">${esc(m.result || 'In progress')}</p>${daysHTML(m)}${m.inns.map((_, k) => scorecardHTML(m, k)).join('')}
    <div class="modal-actions">${m.init && Array.isArray(m.log) ? '<button type="button" class="btn ghost" data-x="comm">Commentary</button>' : ''}<button type="button" class="btn ghost" data-x="img">Scorecard image</button><button type="button" class="btn ghost" data-x="print">Print or save as PDF</button></div>`, { wide: true });
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'comm') openCommentary(m, title);
    else if (x.dataset.x === 'img') scorecardImage(m); else printScorecard(m);
  });
}