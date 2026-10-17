/* Crease — Exports: shareable stat image and CSV. */
import { readGroup } from './groups.js';
import { RATINGS, fmtOvers, rate } from './maths.js';
import { RENDER } from './router.js';
import { fmt } from './state.js';
import { batStats } from './tabs/batting.js';
import { bowlStats } from './tabs/bowling.js';
import { impactShare, verdictFor } from './tabs/impact.js';
import { openModal, toast } from './ui.js';
import { $, esc, nf, plural } from './utils.js';
/* =====================================================================
   16. Exports: share image and CSV
   ===================================================================== */
export function toCSV(rows) {
  return rows.map(r => r.map(c => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
}
export function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export async function copyText(text, fallbackEl) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { if (fallbackEl) { fallbackEl.focus(); fallbackEl.select(); } toast('Select the text and copy it'); }
}
export function showCSV(name, csv) {
  const body = openModal('Export CSV', `<textarea class="csv-box" readonly aria-label="CSV data">${esc(csv)}</textarea>
    <p class="hint">Download the file, or copy the text and paste it into a spreadsheet.</p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="copy">Copy CSV</button><button type="button" class="btn" data-x="dl">Download .csv</button></div>`, { wide: true });
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'copy') copyText(csv, $('.csv-box', body));
    else download(name.replace(/[^\w.-]+/g, '-'), new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  });
}

export function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
export function fitText(ctx, text, maxW) { let t = String(text); if (ctx.measureText(t).width <= maxW) return t; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
export async function shareImage(d) {
  if (!d) { toast('Nothing to share yet'); return; }
  try { await Promise.all(['800 64px "Saira Condensed"', '700 64px "Saira Condensed"', '600 24px Figtree', '400 24px Figtree'].map(f => document.fonts.load(f))); } catch { /* fallback fonts */ }
  const W = 1200, cols = 3, tileH = 168, gap = 20;
  const rows = Math.ceil(d.stats.length / cols);
  const H = 330 + rows * (tileH + gap) + 70;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const D = 'Saira Condensed, Arial Narrow, sans-serif', Bf = 'Figtree, system-ui, sans-serif';
  x.fillStyle = '#08120f'; x.fillRect(0, 0, W, H);
  for (let s = 0; s < W; s += 160) { x.fillStyle = 'rgba(255,255,255,0.022)'; x.fillRect(s, 0, 80, H); }
  const g1 = x.createRadialGradient(120, -40, 10, 120, -40, 640); g1.addColorStop(0, 'rgba(243,194,76,0.30)'); g1.addColorStop(1, 'rgba(243,194,76,0)');
  x.fillStyle = g1; x.fillRect(0, 0, W, H);
  const g2 = x.createRadialGradient(W - 80, -60, 10, W - 80, -60, 560); g2.addColorStop(0, 'rgba(243,194,76,0.22)'); g2.addColorStop(1, 'rgba(243,194,76,0)');
  x.fillStyle = g2; x.fillRect(0, 0, W, H);
  // ball mark + brand
  x.fillStyle = '#e95a4f'; x.beginPath(); x.arc(84, 82, 26, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#fff4e8'; x.lineWidth = 2.4; x.setLineDash([4, 4]);
  x.beginPath(); x.moveTo(68, 64); x.quadraticCurveTo(80, 82, 68, 100); x.stroke();
  x.beginPath(); x.moveTo(100, 64); x.quadraticCurveTo(88, 82, 100, 100); x.stroke(); x.setLineDash([]);
  x.fillStyle = '#e8f0eb'; x.font = `800 40px ${D}`; x.textBaseline = 'middle'; x.fillText('CREASE', 124, 84);
  x.fillStyle = '#f3c24c'; x.font = `600 22px ${Bf}`; x.textAlign = 'right'; x.fillText(fitText(x, (d.eyebrow || '').toUpperCase(), 640), W - 60, 84); x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#ffffff'; x.font = `800 66px ${D}`; x.fillText(fitText(x, d.title || '', W - 120), 60, 210);
  x.fillStyle = '#a8bcb1'; x.font = `500 26px ${Bf}`; x.fillText(fitText(x, d.subtitle || '', W - 120), 60, 258);
  const tw = (W - 120 - gap * (cols - 1)) / cols;
  d.stats.forEach((s, k) => {
    const cx = 60 + (k % cols) * (tw + gap), cy = 300 + Math.floor(k / cols) * (tileH + gap);
    x.fillStyle = '#11201b'; roundRect(x, cx, cy, tw, tileH, 18); x.fill();
    x.strokeStyle = '#22392f'; x.lineWidth = 2; x.stroke();
    x.fillStyle = '#f3c24c'; x.fillRect(cx, cy + 22, 4, tileH - 44);
    x.fillStyle = '#8ea398'; x.font = `600 20px ${Bf}`; x.fillText(fitText(x, s.label.toUpperCase(), tw - 52), cx + 28, cy + 46);
    x.fillStyle = '#e8f0eb'; x.font = `700 64px ${D}`; x.fillText(fitText(x, s.value, tw - 52), cx + 28, cy + 116);
    if (s.sub) { x.fillStyle = '#8ea398'; x.font = `500 20px ${Bf}`; x.fillText(fitText(x, s.sub, tw - 52), cx + 28, cy + 148); }
  });
  x.fillStyle = '#5f7569'; x.font = `500 18px ${Bf}`; x.fillText(`Made with Crease · ${new Date().toLocaleDateString()}`, 60, H - 34);
  c.toBlob(blob => {
    if (!blob) { toast('Could not create the image'); return; }
    showImageModal(blob, 'crease-stats.png', 'Share image', 'Shareable stat card');
  }, 'image/png');
}
// Preview an image with download and copy buttons.
export function showImageModal(blob, filename, title = 'Share image', alt = 'Image') {
  const url = URL.createObjectURL(blob);
  const body = openModal(title, `<img class="img-preview" src="${url}" alt="${esc(alt)}">
    <p class="hint">If the download button does nothing in this view, right-click or long-press the image to save it.</p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="copy">Copy image</button><button type="button" class="btn" data-x="dl">Download PNG</button></div>`, { wide: true, onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000) });
  body.addEventListener('click', async e => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === 'dl') download(filename, blob);
    else {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Image copied'); }
      catch { toast('Copying images is blocked here. Right-click or long-press the image instead.'); }
    }
  });
}

export function shareDataFor(tab) {
  const f = fmt();
  if (tab === 'batting') {
    const { v } = readGroup('bat'); const s = batStats(v);
    return { eyebrow: `${f.label} batting`, title: v.name || 'Batting summary', subtitle: `${s.R} runs off ${s.B} balls in ${plural(s.I, 'innings', 'innings')}`, stats: [
      { label: 'Strike rate', value: nf(s.sr), sub: s.sr != null ? RATINGS[rate(s.sr, f.sr)] : '' },
      { label: 'Average', value: nf(s.avg) },
      { label: 'Boundary %', value: s.bdry != null ? nf(s.bdry, 1) + '%' : '—' },
      { label: 'Balls per boundary', value: nf(s.bpb, 1) },
      { label: 'Dot-ball %', value: s.dot != null ? nf(s.dot, 1) + '%' : '—' },
      { label: '50s / 100s', value: `${s.fifties} / ${s.hundreds}` },
    ] };
  }
  if (tab === 'bowling') {
    const { v } = readGroup('bowl'); const s = bowlStats(v);
    return { eyebrow: `${f.label} bowling`, title: v.name || 'Bowling summary', subtitle: `${s.W}/${s.R} in ${fmtOvers(s.balls)} overs`, stats: [
      { label: 'Economy', value: nf(s.econ), sub: s.econ != null ? RATINGS[rate(s.econ, f.econ, false)] : '' },
      { label: 'Average', value: nf(s.avg) },
      { label: 'Strike rate', value: nf(s.sr, 1) },
      { label: 'Dot-ball %', value: s.dot != null ? nf(s.dot, 1) + '%' : '—' },
      { label: 'Maidens', value: String(s.M) },
      { label: 'Wickets', value: String(s.W) },
    ] };
  }
  if (tab === 'impact') {
    RENDER.impact();
    const d = impactShare;
    return { eyebrow: `${f.label} impact`, title: 'Match impact ratings', subtitle: `${d.r} off ${d.b} with the bat · ${d.wk}/${d.rc} in ${fmtOvers(d.balls)} overs`, stats: [
      { label: 'Batting impact', value: d.batScore != null ? String(Math.round(d.batScore)) : '—', sub: d.batScore != null ? verdictFor(d.batScore) : '' },
      { label: 'Bowling impact', value: d.bowlScore != null ? String(Math.round(d.bowlScore)) : '—', sub: d.bowlScore != null ? verdictFor(d.bowlScore) : '' },
      { label: 'Combined', value: d.batScore != null && d.bowlScore != null ? String(Math.round((d.batScore + d.bowlScore) / 2)) : '—', sub: 'Average of both' },
    ] };
  }
  return null;
}

