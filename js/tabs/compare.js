import { alpha, baseOpts, chart, pal } from '../charts.js';
import { group, persistGroup, readGroup, setGroup } from '../groups.js';
import { RENDER } from '../router.js';
import { fmt } from '../state.js';
import { errItems, setWarns } from '../ui.js';
import { $, FONT, clamp, esc, isNum, nf } from '../utils.js';
import { savedPlayers } from './saved.js';
/* =====================================================================
   13. COMPARE
   ===================================================================== */
export const CMP_FIELDS = (def) => [
  { k: 'name', label: 'Name', type: 'text', def: def[0], wide: true, maxlen: 40 },
  { k: 'runs', label: 'Runs', def: def[1] },
  { k: 'balls', label: 'Balls faced', def: def[2] },
  { k: 'inns', label: 'Innings', def: def[3] },
  { k: 'no', label: 'Not outs', def: def[4] },
  { k: 'f4', label: 'Fours', def: def[5] },
  { k: 'f6', label: 'Sixes', def: def[6] },
  { k: 'fifties', label: '50+ scores', def: def[7], tip: 'Fifties and hundreds together.' },
];
group('cmpA', 'compare', CMP_FIELDS(['Player A', 2140, 1610, 58, 6, 205, 64, 17]));
group('cmpB', 'compare', CMP_FIELDS(['Player B', 1765, 1180, 55, 9, 150, 88, 11]));

export const CMP_METRICS = [
  { k: 'avg', label: 'Average', dp: 2, hi: true },
  { k: 'sr', label: 'Strike rate', dp: 2, hi: true },
  { k: 'rpi', label: 'Runs per innings', dp: 1, hi: true },
  { k: 'bdry', label: 'Boundary %', dp: 1, hi: true },
  { k: 'bpb', label: 'Balls per boundary', dp: 1, hi: false },
  { k: 'fifty', label: '50+ scores per 10 innings', dp: 1, hi: true },
  { k: 'six', label: 'Sixes per 100 balls', dp: 2, hi: true },
];
export function cmpStats(v) {
  const R = v.runs ?? 0, B = v.balls ?? 0, I = v.inns ?? 0, NO = v.no ?? 0, F4 = v.f4 ?? 0, F6 = v.f6 ?? 0, FF = v.fifties ?? 0;
  const dism = I - NO;
  return {
    name: v.name || 'Unnamed',
    avg: dism > 0 ? R / dism : null,
    sr: B > 0 ? R / B * 100 : null,
    rpi: I > 0 ? R / I : null,
    bdry: R > 0 ? (4 * F4 + 6 * F6) / R * 100 : null,
    bpb: F4 + F6 > 0 && B > 0 ? B / (F4 + F6) : null,
    fifty: I > 0 ? FF / I * 10 : null,
    six: B > 0 ? F6 / B * 100 : null,
    bad: NO > I || FF > I || 4 * F4 + 6 * F6 > R,
  };
}
export function fillCmpSelects() {
  const ps = savedPlayers().filter(p => p.kind === 'bat');
  const opts = `<option value="">Load saved…</option>` + ps.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  ['a', 'b'].forEach(s => { const el = $('#cmp-load-' + s); el.innerHTML = opts; el.disabled = !ps.length; el.title = ps.length ? '' : 'Save batters from the Batting tab to load them here'; });
}
export function loadIntoCompare(side, player) {
  const d = player.data;
  const g = side === 'a' ? 'cmpA' : 'cmpB';
  setGroup(g, { name: player.name, runs: d.runs, balls: d.balls, inns: d.inns, no: d.no, f4: d.f4, f6: d.f6, fifties: (Number(d.fifties) || 0) + (Number(d.hundreds) || 0) });
  persistGroup(g);
}
RENDER.compare = function renderCompare() {
  fillCmpSelects();
  const f = fmt();
  const A = readGroup('cmpA'), B = readGroup('cmpB');
  const a = cmpStats(A.v), b = cmpStats(B.v);
  const w = errItems([...A.errs.map(e => `A: ${e}`), ...B.errs.map(e => `B: ${e}`)]);
  if (a.bad) w.push(`${a.name}: the numbers don't add up (check not outs, 50+ scores and boundaries).`);
  if (b.bad) w.push(`${b.name}: the numbers don't add up (check not outs, 50+ scores and boundaries).`);
  setWarns('w-cmp', w);

  let wa = 0, wb = 0;
  const rows = CMP_METRICS.map(m => {
    const va = a[m.k], vb = b[m.k];
    let ca = '', cb = '';
    if (isNum(va) && isNum(vb) && Math.abs(va - vb) > 1e-6) {
      const aWins = m.hi ? va > vb : va < vb;
      if (aWins) { ca = 'win-a'; wa++; } else { cb = 'win-b'; wb++; }
    }
    return `<tr><td>${esc(m.label)}${m.hi ? '' : ' <span class="dim">(lower is better)</span>'}</td><td class="num ${ca}">${nf(va, m.dp)}</td><td class="num ${cb}">${nf(vb, m.dp)}</td></tr>`;
  });
  $('#cmp-tbl').innerHTML = `<thead><tr><th>Metric</th><th class="num">${esc(a.name)}</th><th class="num">${esc(b.name)}</th></tr></thead><tbody>${rows.join('')}</tbody>`;
  $('#cmp-verdict').innerHTML = wa === wb ? `Dead level: each player leads on ${wa} of ${CMP_METRICS.length} metrics.` : `<strong>${esc(wa > wb ? a.name : b.name)}</strong> leads on ${Math.max(wa, wb)} of ${CMP_METRICS.length} metrics.`;

  const refs = { avg: f.bavg[2] * 1.4, sr: f.sr[2] * 1.25, bdry: 75, fifty: 5, six: f.sixRef };
  const axisLbl = ['Average', 'Strike rate', 'Boundary %', '50+ rate', 'Six hitting'];
  const keys = ['avg', 'sr', 'bdry', 'fifty', 'six'];
  const norm = s => keys.map(k => isNum(s[k]) ? Math.round(clamp(s[k] / refs[k], 0, 1) * 100) : 0);
  const p = pal();
  chart('c-cmp', {
    type: 'radar',
    data: { labels: axisLbl, datasets: [
      { label: a.name, data: norm(a), borderColor: p.accent, backgroundColor: alpha(p.accent, 0.22), pointBackgroundColor: p.accent, borderWidth: 2 },
      { label: b.name, data: norm(b), borderColor: p.sky, backgroundColor: alpha(p.sky, 0.2), pointBackgroundColor: p.sky, borderWidth: 2 },
    ] },
    options: baseOpts({
      scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 }, grid: { color: p.line }, angleLines: { color: p.line }, pointLabels: { color: p.fg2, font: { family: FONT, size: 12, weight: '600' } } } },
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => { const s = c.datasetIndex === 0 ? a : b; const k = keys[c.dataIndex]; return ` ${c.dataset.label}: ${nf(s[k], k === 'six' ? 2 : 1)} (${c.parsed.r}/100)`; } } } },
    }),
  });
};

