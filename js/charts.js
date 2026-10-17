/* Crease — Chart.js helpers: theme colours and shared chart options. */
import { FONT, deepMerge, reduceMotion, sum } from './utils.js';
/* =====================================================================
   5. Charts
   ===================================================================== */
export const charts = {};
export function pal() {
  const s = getComputedStyle(document.documentElement);
  const g = n => s.getPropertyValue(n).trim();
  return { fg: g('--fg'), fg2: g('--fg-2'), muted: g('--muted'), line: g('--line'), line2: g('--line-2'), surface: g('--surface'), raise: g('--raise'), accent: g('--accent'), turf: g('--turf'), ball: g('--ball'), sky: g('--sky'), violet: g('--violet'), warn: g('--warn') };
}
export function alpha(hex, a) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
export function chart(id, cfg) {
  const c = document.getElementById(id);
  if (!c) return null;
  if (!window.Chart) {
    if (!c.dataset.nochart) { c.dataset.nochart = '1'; c.insertAdjacentHTML('afterend', '<div class="nochart">Charts need an internet connection to load the chart library.</div>'); }
    return null;
  }
  const ex = charts[id];
  if (ex) { ex.data = cfg.data; ex.options = cfg.options; ex.update(); return ex; }
  charts[id] = new Chart(c, cfg);
  return charts[id];
}
export function baseOpts(extra = {}) {
  const p = pal();
  return deepMerge({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: reduceMotion ? 0 : 450 },
    plugins: {
      legend: { labels: { color: p.fg2, boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle', padding: 14, font: { family: FONT, size: 12 } } },
      tooltip: { backgroundColor: p.raise, titleColor: p.fg, bodyColor: p.fg2, borderColor: p.line2, borderWidth: 1, padding: 10, cornerRadius: 8, titleFont: { family: FONT, weight: '700' }, bodyFont: { family: FONT }, boxPadding: 4 },
    },
  }, extra);
}
export function axes(o = {}) {
  const p = pal();
  const t = text => text ? { display: true, text, color: p.muted, font: { family: FONT, size: 12 } } : { display: false };
  return {
    x: { grid: { display: false }, ticks: { color: p.muted, font: { family: FONT }, maxRotation: 0, autoSkip: true }, border: { color: p.line }, title: t(o.x) },
    y: { beginAtZero: o.yZero !== false, suggestedMax: o.yMax, grid: { color: alpha(p.line.startsWith('#') ? p.line : '#22392f', 0.7) }, ticks: { color: p.muted, font: { family: FONT } }, border: { display: false }, title: t(o.y) },
  };
}
export const narrow = () => window.innerWidth < 560;
export function doughnut(id, labels, data, colors) {
  const p = pal();
  const total = sum(data);
  return chart(id, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: p.surface, borderWidth: 3, hoverOffset: 6 }] },
    options: baseOpts({
      cutout: '66%',
      plugins: {
        legend: { position: narrow() ? 'bottom' : 'right' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString('en-US')}${total ? ` (${(ctx.parsed / total * 100).toFixed(1)}%)` : ''}` } },
      },
    }),
  });
}

