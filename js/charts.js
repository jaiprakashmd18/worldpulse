// Chart.js helpers. Charts always carry text labels (emoji + mood name +
// percentage) and an equivalent data table, so they never rely on colour alone.
import { MOODS, MOOD_BY_CODE, WINDOWS } from './moods.js';
import { LIBS, loadScript } from './libs.js';

const charts = new Map();
let ready = null;

export function loadCharts() {
  ready ||= loadScript(LIBS.chart).then(() => {
    const C = window.Chart;
    C.defaults.color = '#A7B1CC';
    C.defaults.font.family = "'Inter', system-ui, sans-serif";
    C.defaults.font.size = 12;
    C.defaults.borderColor = 'rgba(160,180,255,0.08)';
    C.defaults.animation.duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500;
    C.defaults.plugins.tooltip.backgroundColor = 'rgba(11,16,32,0.95)';
    C.defaults.plugins.tooltip.borderColor = 'rgba(69,230,255,0.35)';
    C.defaults.plugins.tooltip.borderWidth = 1;
    C.defaults.plugins.tooltip.padding = 10;
    return C;
  });
  return ready;
}

const pct = (n, total) => (total ? (n / total) * 100 : 0);

const valueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "600 11px 'Inter', system-ui, sans-serif";
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach((bar, i) => {
        const v = ds.data[i];
        if (v == null) return;
        ctx.fillStyle = ds.labelColor || '#E8EEFF';
        ctx.fillText(`${v.toFixed(v < 10 && v > 0 ? 1 : 0)}%`, bar.x + 6, bar.y);
      });
    });
    ctx.restore();
  },
};

/**
 * Horizontal mood distribution. `series` is [{ label, distribution, style }]
 * where style is 'solid' | 'outline'. Percentages are computed per series.
 */
export async function renderDistribution(canvas, series, { highlight = null } = {}) {
  const Chart = await loadCharts();
  const labels = MOODS.map((m) => `${m.emoji} ${m.label}`);
  const datasets = series.map((s) => {
    const total = s.distribution.reduce((a, d) => a + d.count, 0);
    const byMood = new Map(s.distribution.map((d) => [d.mood, d.count]));
    const colors = MOODS.map((m) => (highlight && highlight !== m.code ? withAlpha(m.color, 0.25) : m.color));
    return {
      label: s.label,
      data: MOODS.map((m) => pct(byMood.get(m.code) || 0, total)),
      counts: MOODS.map((m) => byMood.get(m.code) || 0),
      backgroundColor: s.style === 'outline' ? 'rgba(155,124,255,0.18)' : colors,
      borderColor: s.style === 'outline' ? '#9B7CFF' : colors,
      borderWidth: s.style === 'outline' ? 1.5 : 0,
      borderDash: s.style === 'outline' ? [4, 3] : [],
      borderRadius: 6,
      barPercentage: series.length > 1 ? 0.9 : 0.72,
      categoryPercentage: 0.8,
      labelColor: s.style === 'outline' ? '#C7B8FF' : '#E8EEFF',
    };
  });
  const max = Math.max(10, ...datasets.flatMap((d) => d.data));
  const config = {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 44 } },
      scales: {
        x: { display: false, max: Math.min(100, max * 1.15), beginAtZero: true },
        y: { grid: { display: false }, ticks: { color: '#DCE3F7', font: { size: 12.5 } } },
      },
      plugins: {
        legend: { display: series.length > 1, position: 'top', align: 'end', labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}% (${c.dataset.counts[c.dataIndex].toLocaleString()} moods)`,
          },
        },
      },
    },
    plugins: [valueLabels],
  };
  upsert(canvas, config);
  canvas.setAttribute('aria-label', describeDistribution(series[0]));
}

export async function renderTimeline(canvas, timeline, win) {
  const Chart = await loadCharts();
  const fmt = new Intl.DateTimeFormat(undefined, win === '1h' || win === '24h'
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', ...(win === '7d' ? { hour: '2-digit' } : {}) });
  const labels = timeline.map((b) => fmt.format(new Date(b.t)));
  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Moods shared',
          data: timeline.map((b) => b.total),
          borderColor: '#45E6FF',
          backgroundColor: (ctx) => {
            const { chartArea, ctx: c } = ctx.chart;
            if (!chartArea) return 'rgba(69,230,255,0.15)';
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, 'rgba(69,230,255,0.32)');
            g.addColorStop(1, 'rgba(69,230,255,0)');
            return g;
          },
          fill: true, tension: 0.35, pointRadius: 0, pointHitRadius: 12, borderWidth: 2, yAxisID: 'y',
        },
        {
          label: 'Positive share (%)',
          data: timeline.map((b) => (b.total ? Math.round((b.positive / b.total) * 100) : null)),
          borderColor: '#6EE7B7',
          borderDash: [5, 4],
          spanGaps: true, tension: 0.35, pointRadius: 0, pointHitRadius: 12, borderWidth: 1.6, yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } },
        y: { beginAtZero: true, ticks: { precision: 0, maxTicksLimit: 5 }, title: { display: true, text: 'Moods' } },
        y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: (v) => `${v}%`, maxTicksLimit: 5 } },
      },
      plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 18, boxHeight: 2 } } },
    },
  };
  upsert(canvas, config);
  const total = timeline.reduce((a, b) => a + b.total, 0);
  canvas.setAttribute('aria-label', `Line chart of ${total} moods shared over the ${WINDOWS[win].label.toLowerCase()}, with the positive share of each period.`);
}

function upsert(canvas, config) {
  const existing = charts.get(canvas);
  if (existing && existing.config.type === config.type && existing.data.datasets.length === config.data.datasets.length) {
    existing.data = config.data;
    existing.options = config.options;
    existing.update();
    return;
  }
  existing?.destroy();
  charts.set(canvas, new window.Chart(canvas, config));
}

function describeDistribution(s) {
  const total = s.distribution.reduce((a, d) => a + d.count, 0);
  if (!total) return `${s.label}: no moods recorded.`;
  const top = [...s.distribution].sort((a, b) => b.count - a.count).slice(0, 3)
    .map((d) => `${MOOD_BY_CODE.get(d.mood).label} ${pct(d.count, total).toFixed(0)}%`);
  return `Bar chart, ${s.label}: ${total} moods. Most reported: ${top.join(', ')}.`;
}

/** Fills a <table> with the same numbers the chart shows. */
export function fillTable(table, series) {
  const totals = series.map((s) => s.distribution.reduce((a, d) => a + d.count, 0));
  const head = `<thead><tr><th scope="col">Mood</th>${series.map((s) => `<th scope="col">${escapeHtml(s.label)}</th>`).join('')}</tr></thead>`;
  const rows = MOODS.map((m) => {
    const cells = series.map((s, i) => {
      const n = s.distribution.find((d) => d.mood === m.code)?.count || 0;
      return `<td>${pct(n, totals[i]).toFixed(1)}% (${n.toLocaleString()})</td>`;
    }).join('');
    return `<tr><th scope="row">${m.emoji} ${m.label}</th>${cells}</tr>`;
  }).join('');
  table.innerHTML = `${head}<tbody>${rows}</tbody>`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
