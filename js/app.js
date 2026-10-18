// WorldPulse application entry point.
import { MOODS, MOOD_BY_CODE, WINDOWS } from './moods.js';
import { COUNTRIES, COUNTRY_BY_CODE, flagEmoji } from './countries.js';
import { SupabaseSource, DemoSource, countryName } from './data.js';
import { loadCountryShapes, svgPath } from './geo.js';
import { Globe, webglAvailable } from './globe.js';
import { renderDistribution, renderTimeline, fillTable, loadCharts } from './charts.js';

const config = window.WORLDPULSE_CONFIG || {};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const nf = new Intl.NumberFormat();
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowPower = matchMedia('(max-width: 640px)').matches || (navigator.hardwareConcurrency || 8) <= 4 || !!navigator.connection?.saveData;

const state = {
  source: null,
  window: '24h',
  filterMood: null,
  selected: null,
  global: null,
  markers: [],
  threshold: 10,
  status: 'connecting',
  lastUpdated: null,
  globe: null,
  shapes: [],
  pickMode: false,
  errored: false,
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// =====================================================================
// Boot
// =====================================================================
init();

async function init() {
  $('[data-year]').textContent = new Date().getFullYear();
  setupConfigLinks();
  setupNav();
  setupDialogs();
  setupMoodFilter();
  setupWindowTabs();
  setupShareModal();
  setupReport();
  setupCountrySearches();
  setupGlobeControls();

  const params = new URLSearchParams(location.search);
  const configured = !!(config.supabaseUrl && config.supabaseAnonKey);
  const demo = params.has('demo') || !configured;
  state.source = demo ? new DemoSource() : new SupabaseSource({ url: config.supabaseUrl, anonKey: config.supabaseAnonKey });
  if (demo) {
    $('#demo-banner').hidden = false;
    $('[data-demo-note]').hidden = false;
    if (!configured) console.info('[WorldPulse] Supabase is not configured — running in demo mode. See README.md.');
  }

  const globeReady = initGlobe();
  try {
    await state.source.init();
  } catch (err) {
    console.error('[WorldPulse] Could not connect to the database', err);
    setStatus('error');
    showPulseError(true);
    toast('We could not reach the WorldPulse database. Statistics will appear when the connection recovers.', 'error');
    schedulePolling();
    await globeReady;
    return;
  }

  await refreshAll();
  await globeReady;
  renderMarkers();
  startRealtime();

  const country = params.get('country')?.toUpperCase();
  if (country && COUNTRY_BY_CODE.has(country)) selectCountry(country);

  setInterval(() => $$('[data-rel-time]').forEach((el) => (el.textContent = relTime(el.dataset.relTime))), 30e3);
}

function setupConfigLinks() {
  const gh = $('[data-github-link]');
  if (config.githubUrl) { gh.href = config.githubUrl; gh.querySelector('.tag')?.remove(); gh.rel = 'noopener'; }
  else gh.addEventListener('click', (e) => { e.preventDefault(); toast('GitHub link not configured yet — set WORLDPULSE_GITHUB_URL.'); });
  const site = (config.siteUrl || '').replace(/\/$/, '');
  if (site) {
    $$('[data-site-url]').forEach((a) => {
      a.href = site;
      a.lastChild.textContent = a.lastChild.textContent.replace(/[\w.-]+\.[a-z]{2,}$/i, site.replace(/^https?:\/\//, ''));
    });
  }
  $('[data-copy-link]').addEventListener('click', () => copySiteLink(site || location.origin));
  const cfg = $('[data-config-link]');
  if (config.githubUrl) cfg.href = `${config.githubUrl}#connect-supabase`;
}

// =====================================================================
// Data refresh, realtime and polling
// =====================================================================
let refreshing = null;

async function refreshAll() {
  if (refreshing) return refreshing;
  $('[data-pulse-content]').classList.add('loading');
  refreshing = (async () => {
    try {
      const [global, markers, recent] = await Promise.all([
        state.source.getGlobalStats(state.window),
        state.source.getMarkers(state.window, state.filterMood),
        state.source.getRecent(18),
      ]);
      state.global = global;
      state.markers = markers.markers;
      state.threshold = markers.threshold ?? 10;
      state.lastUpdated = new Date();
      state.errored = false;
      showPulseError(false);
      renderHero();
      renderPulse();
      renderMarkers();
      renderFeed(recent.items);
      if (state.selected) await loadCountry(state.selected);
      if (state.status === 'error') setStatus(state.source.mode === 'demo' ? 'demo' : 'polling');
      else updateStatusText();
    } catch (err) {
      console.warn('[WorldPulse] refresh failed', err);
      state.errored = true;
      if (!state.global) showPulseError(true);
      setStatus('error');
    } finally {
      $('[data-pulse-content]').classList.remove('loading');
      refreshing = null;
    }
  })();
  return refreshing;
}

let pulseTimer = null;
let lastPulseRefresh = 0;
function onPulse() {
  // Batch bursts of submissions: at most one refresh every 5 seconds.
  if (pulseTimer) return;
  const wait = Math.max(2000, 5000 - (Date.now() - lastPulseRefresh));
  pulseTimer = setTimeout(async () => {
    pulseTimer = null;
    lastPulseRefresh = Date.now();
    await refreshAll();
  }, wait);
}

function startRealtime() {
  if (state.source.mode === 'demo') { setStatus('demo'); return; }
  setStatus('polling');
  try {
    state.source.subscribe(onPulse, (s) => {
      if (s === 'live') { setStatus('live'); refreshAll(); }
      else if (s === 'offline') setStatus('polling');
    });
  } catch (err) {
    console.warn('[WorldPulse] realtime unavailable, polling instead', err);
  }
  schedulePolling();
}

let pollTimer = null;
function schedulePolling() {
  clearTimeout(pollTimer);
  const base = Math.max(15e3, Number(config.pollIntervalMs) || 60e3);
  // When realtime is connected we still refresh occasionally so time windows roll forward.
  const interval = state.status === 'live' ? Math.max(base, 300e3) : base;
  pollTimer = setTimeout(async () => {
    if (!document.hidden) {
      if (!state.global && state.status === 'error') {
        try { await state.source.init(); } catch { schedulePolling(); return; }
      }
      await refreshAll();
    }
    schedulePolling();
  }, interval);
}

function setStatus(s) {
  state.status = s;
  $('[data-status-dot]').dataset.state = s;
  updateStatusText();
}

function updateStatusText() {
  const time = state.lastUpdated ? state.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const interval = Math.round(Math.max(15e3, Number(config.pollIntervalMs) || 60e3) / 1000);
  const text = {
    connecting: 'Connecting to the pulse…',
    live: 'Live · updating in real time',
    polling: time ? `Updated ${time} · refreshing every ${interval}s` : 'Connecting…',
    demo: 'Demo data · sample only, not live',
    error: 'Offline · retrying in the background',
  }[state.status];
  $('[data-status-text]').textContent = text;
  const upd = $('[data-updated]');
  upd.textContent = state.status === 'demo'
    ? `Sample data generated in your browser${time ? ` · ${time}` : ''}`
    : time ? `${WINDOWS[state.window].label} · last updated ${time}${state.status === 'live' ? ' · live' : ''}` : '—';
}

function showPulseError(on) {
  $('[data-pulse-error]').hidden = !on;
  if (on) $('[data-pulse-empty]').hidden = true;
  $('[data-pulse-content]').hidden = on && !state.global;
}

// =====================================================================
// Hero + live pulse
// =====================================================================
function topMood(distribution) {
  const total = distribution.reduce((a, d) => a + d.count, 0);
  if (!total) return null;
  const top = [...distribution].sort((a, b) => b.count - a.count)[0];
  return { ...MOOD_BY_CODE.get(top.mood), count: top.count, share: top.count / total };
}

const share = (dist, valence) => {
  const total = dist.reduce((a, d) => a + d.count, 0);
  return total ? dist.filter((d) => MOOD_BY_CODE.get(d.mood).valence === valence).reduce((a, d) => a + d.count, 0) / total : 0;
};

function renderHero() {
  const g = state.global;
  const top = topMood(g.distribution);
  $('[data-window-label]').textContent = `· ${WINDOWS[state.window].label.toLowerCase()}`;
  $('[data-stat="total"]').textContent = nf.format(g.total);
  $('[data-stat="countries"]').textContent = nf.format(g.countries);
  $('[data-stat="top"]').textContent = top ? `${top.emoji} ${top.label}` : '—';
}

let chartsVisible = false;
function renderPulse() {
  const g = state.global;
  const empty = g.total === 0;
  $('[data-pulse-empty]').hidden = !empty;
  $('[data-pulse-content]').hidden = false;

  const top = topMood(g.distribution);
  $('[data-pulse="top"]').textContent = top ? `${top.emoji} ${top.label}` : 'No moods yet';
  $('[data-pulse="top-sub"]').textContent = top ? `${(top.share * 100).toFixed(0)}% of moods · ${nf.format(top.count)} people` : 'Be the first to share';
  $('[data-pulse="total"]').textContent = nf.format(g.total);
  const diff = g.total - g.previous_total;
  $('[data-pulse="total-sub"]').textContent = g.previous_total
    ? `${diff >= 0 ? '+' : '−'}${nf.format(Math.abs(diff))} vs previous ${WINDOWS[state.window].label.replace('Last ', '').toLowerCase()}`
    : 'No earlier data to compare';
  $('[data-pulse="countries"]').textContent = nf.format(g.countries);

  const trendEl = $('[data-pulse="trend"]');
  const trendSub = $('[data-pulse="trend-sub"]');
  if (g.total >= 10 && g.previous_total >= 10) {
    const now = share(g.distribution, 'positive'), before = share(g.previous_distribution, 'positive');
    const pp = (now - before) * 100;
    const cls = Math.abs(pp) < 1 ? 'flat' : pp > 0 ? 'up' : 'down';
    trendEl.innerHTML = '';
    trendEl.append(`${(now * 100).toFixed(0)}% `, Object.assign(document.createElement('span'), {
      className: cls, textContent: `${cls === 'up' ? '▲' : cls === 'down' ? '▼' : '■'} ${Math.abs(pp).toFixed(1)} pts`,
    }));
    trendSub.textContent = `Positive moods, compared with ${(before * 100).toFixed(0)}% in the previous period`;
  } else {
    trendEl.textContent = g.total ? `${(share(g.distribution, 'positive') * 100).toFixed(0)}%` : '—';
    trendSub.textContent = 'Not enough history yet to compare periods';
  }

  const fm = state.filterMood && MOOD_BY_CODE.get(state.filterMood);
  const fmCount = fm ? g.distribution.find((d) => d.mood === fm.code)?.count || 0 : 0;
  $('[data-pulse="filter-note"]').textContent = fm
    ? `Highlighting ${fm.emoji} ${fm.label}: ${g.total ? ((fmCount / g.total) * 100).toFixed(1) : 0}% of moods (${nf.format(fmCount)})`
    : `${WINDOWS[state.window].label} · ${nf.format(g.total)} moods`;

  renderTrendList(g);
  fillTable($('[data-table="global"]'), [{ label: 'World', distribution: g.distribution }]);
  if (chartsVisible) drawPulseCharts();
}

function drawPulseCharts() {
  const g = state.global;
  if (!g) return;
  renderDistribution($('#chart-global'), [{ label: 'World', distribution: g.distribution }], { highlight: state.filterMood })
    .catch(chartFailed);
  renderTimeline($('#chart-timeline'), g.timeline, state.window).catch(chartFailed);
}

function chartFailed(err) {
  console.warn('[WorldPulse] charts unavailable', err);
  $$('.chart-box').forEach((b) => { b.hidden = true; });
  $$('.data-table').forEach((d) => { d.open = true; });
}

function renderTrendList(g) {
  const list = $('[data-trend-list]');
  list.innerHTML = '';
  if (g.total < 10 || g.previous_total < 10) return;
  const tot = (d) => d.reduce((a, x) => a + x.count, 0);
  const t1 = tot(g.distribution), t0 = tot(g.previous_distribution);
  for (const m of MOODS) {
    const now = (g.distribution.find((d) => d.mood === m.code)?.count || 0) / t1;
    const before = (g.previous_distribution.find((d) => d.mood === m.code)?.count || 0) / t0;
    const pp = (now - before) * 100;
    const cls = Math.abs(pp) < 0.5 ? 'flat' : pp > 0 ? 'up' : 'down';
    const item = document.createElement('div');
    item.className = 'trend-item';
    item.innerHTML = `<span></span><span class="delta ${cls}"></span>`;
    item.firstChild.textContent = `${m.emoji} ${m.label}`;
    item.lastChild.textContent = `${pp > 0 ? '+' : pp < 0 ? '−' : '±'}${Math.abs(pp).toFixed(1)}`;
    item.title = `${m.label}: ${(now * 100).toFixed(1)}% now vs ${(before * 100).toFixed(1)}% before (percentage points)`;
    list.append(item);
  }
}

function setupWindowTabs() {
  const tabs = $$('[data-window]');
  tabs.forEach((btn) => btn.addEventListener('click', () => setWindow(btn.dataset.window)));
  $('[data-window-tabs]').addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.dataset.window === state.window);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next == null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    setWindow(t.dataset.window);
    t.focus();
  });
  syncRoving(tabs, (t) => t.dataset.window === state.window);

  const pulse = $('#pulse');
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    chartsVisible = true;
    loadCharts().then(() => { drawPulseCharts(); if (state.selected) loadCountry(state.selected); }).catch(chartFailed);
  }, { rootMargin: '400px' }).observe(pulse);
  $('[data-retry]').addEventListener('click', async () => {
    if (!state.global) {
      try { await state.source.init(); } catch { toast('Still offline. We will keep trying.', 'error'); return; }
      startRealtime();
    }
    refreshAll();
  });
}

function setWindow(w) {
  if (w === state.window) return;
  state.window = w;
  syncRoving($$('[data-window]'), (t) => t.dataset.window === w);
  refreshAll();
}

function syncRoving(items, isOn) {
  items.forEach((t) => {
    const on = isOn(t);
    t.setAttribute('aria-checked', String(on));
    t.tabIndex = on ? 0 : -1;
  });
}

// =====================================================================
// Mood filter
// =====================================================================
function setupMoodFilter() {
  const wrap = $('[data-mood-filter]');
  const all = [{ code: null, label: 'All moods', emoji: '🌐', color: '#45E6FF' }, ...MOODS];
  for (const m of all) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.dataset.mood = m.code ?? '';
    b.style.setProperty('--c', m.color);
    b.innerHTML = '<span aria-hidden="true"></span><span></span>';
    b.firstChild.textContent = m.emoji;
    b.lastChild.textContent = m.label;
    b.addEventListener('click', () => setFilter(m.code));
    wrap.append(b);
  }
  wrap.addEventListener('keydown', (e) => {
    const chips = $$('.chip', wrap);
    const i = chips.indexOf(document.activeElement);
    if (i < 0 || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const n = chips[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + chips.length) % chips.length];
    n.focus();
    n.click();
  });
  syncRoving($$('.chip', wrap), (c) => (c.dataset.mood || null) === state.filterMood);
}

async function setFilter(code) {
  state.filterMood = code;
  syncRoving($$('[data-mood-filter] .chip'), (c) => (c.dataset.mood || null) === code);
  const m = code && MOOD_BY_CODE.get(code);
  $('[data-legend-note]').textContent = m
    ? `Brighter countries have a larger share of people feeling ${m.emoji} ${m.label.toLowerCase()}. Countries with fewer than ${state.threshold} moods are dimmed.`
    : `Markers show each country's most shared mood. Countries with fewer than ${state.threshold} moods appear as faint dots.`;
  if (!state.global) return;
  try {
    const markers = await state.source.getMarkers(state.window, code);
    state.markers = markers.markers;
    renderMarkers();
    renderPulse();
  } catch { toast('Could not update the filter right now.', 'error'); }
}

// =====================================================================
// Globe / fallback map
// =====================================================================
async function initGlobe() {
  const container = $('#globe');
  state.shapes = await loadCountryShapes().catch((err) => {
    console.warn('[WorldPulse] country boundaries unavailable', err);
    return [];
  });
  if (!webglAvailable()) return showFallbackMap('Your device does not support 3D graphics, so we are showing a flat map.');
  try {
    const globe = new Globe(container, {
      shapes: state.shapes, reducedMotion, lowPower,
      onHover: showTooltip,
      onSelect: (code) => onGlobeSelect(code),
      onAutoRotateChange: (on) => {
        const b = $('[data-globe="rotate"]');
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', on ? 'Pause rotation' : 'Resume rotation');
      },
    });
    await globe.init();
    state.globe = globe;
    $('[data-globe-loading]').remove();
    globe.onAutoRotateChange(globe.controls.autoRotate);
    renderMarkers();
  } catch (err) {
    console.error('[WorldPulse] globe failed to start', err);
    showFallbackMap('The 3D globe could not load, so we are showing a flat map.');
  }
}

function showFallbackMap(reason) {
  $('#globe').hidden = true;
  $('.globe-controls').hidden = true;
  const wrap = $('#map-fallback');
  wrap.hidden = false;
  wrap.innerHTML = '';
  const note = Object.assign(document.createElement('p'), { className: 'fallback-note muted', textContent: reason });
  if (state.shapes.length) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 1000 500');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'World map. Use the country search to select a country with the keyboard.');
    for (const s of state.shapes) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', svgPath(s, 1000, 500));
      p.dataset.code = s.code;
      const title = document.createElementNS(ns, 'title');
      title.textContent = countryName(s.code);
      p.append(title);
      p.addEventListener('click', () => onGlobeSelect(s.code));
      svg.append(p);
    }
    wrap.append(svg, note);
  } else {
    // No geometry either: a plain list of countries is the most reliable selector.
    const list = document.createElement('div');
    list.className = 'country-list';
    for (const c of COUNTRIES) {
      const b = Object.assign(document.createElement('button'), { className: 'chip', textContent: `${flagEmoji(c.code)} ${c.name}` });
      b.addEventListener('click', () => onGlobeSelect(c.code));
      list.append(b);
    }
    wrap.append(note, list);
  }
  $('[data-globe-loading]')?.remove();
  renderMarkers();
}

function renderMarkers() {
  if (state.globe) state.globe.setData({ markers: state.markers, filterMood: state.filterMood });
  const svg = $('#map-fallback svg');
  if (svg) {
    const byCode = new Map(state.markers.map((m) => [m.code, m]));
    for (const p of $$('path', svg)) {
      const m = byCode.get(p.dataset.code);
      let fill = '';
      if (m && !m.suppressed) {
        const mood = MOOD_BY_CODE.get(state.filterMood || m.top_mood);
        const a = state.filterMood ? Math.min(0.85, 0.15 + m.mood_share * 2.4) : 0.6;
        fill = hexA(mood.color, a);
      }
      p.style.fill = fill;
      p.classList.toggle('selected', p.dataset.code === state.selected);
    }
  }
}

function markerFor(code) { return state.markers.find((m) => m.code === code); }

function showTooltip(code, e) {
  const tip = $('#globe-tooltip');
  if (!code || !e) { tip.hidden = true; return; }
  const rect = $('#globe-stage').getBoundingClientRect();
  const m = markerFor(code);
  const desc = !m ? 'No moods yet in this window'
    : m.suppressed ? `Fewer than ${state.threshold} moods`
    : `${MOOD_BY_CODE.get(m.top_mood).emoji} ${MOOD_BY_CODE.get(m.top_mood).label} · ${nf.format(m.total)} moods`;
  tip.innerHTML = '<strong></strong><br><span class="muted"></span>';
  tip.firstChild.textContent = `${flagEmoji(code)} ${countryName(code)}`;
  tip.lastChild.textContent = desc;
  tip.style.left = `${e.clientX - rect.left}px`;
  tip.style.top = `${e.clientY - rect.top}px`;
  tip.hidden = false;
}

function onGlobeSelect(code) {
  if (state.pickMode) {
    state.pickMode = false;
    setShareCountry(code);
    openShare({ step: 2 });
    return;
  }
  selectCountry(code, { fly: true });
}

function setupGlobeControls() {
  $('[data-globe="rotate"]').addEventListener('click', () => {
    if (!state.globe) return;
    state.globe.setAutoRotate(!state.globe.controls.autoRotate);
  });
  $('[data-globe="reset"]').addEventListener('click', () => {
    state.globe?.reset();
    closeCountryCard();
  });
  $('[data-close-card]').addEventListener('click', closeCountryCard);
  $('[data-cc="share"]').addEventListener('click', () => {
    if (state.selected) setShareCountry(state.selected);
    openShare({ step: 1 });
  });
  $('[data-explore]').addEventListener('click', () => setTimeout(() => $('#globe-search').focus({ preventScroll: true }), 500));
}

function closeCountryCard() {
  $('#country-card').hidden = true;
  state.selected = null;
  state.globe?.setSelected(null);
  renderMarkers();
}

// =====================================================================
// Country selection, card and insights
// =====================================================================
async function selectCountry(code, { fly = true, scroll = false } = {}) {
  if (!COUNTRY_BY_CODE.has(code)) return;
  state.selected = code;
  state.globe?.setSelected(code);
  if (fly) state.globe?.flyTo(code);
  renderMarkers();
  $('#globe-tooltip').hidden = true;

  const card = $('#country-card');
  card.hidden = false;
  $('[data-cc="flag"]').textContent = flagEmoji(code);
  $('[data-cc="name"]').textContent = countryName(code);
  $('[data-cc="meta"]').textContent = `${code} · ${WINDOWS[state.window].label}`;
  $('[data-cc="body"]').innerHTML = '<span class="skeleton">Loading the pulse…</span>';
  if (scroll) $('#insights').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  await loadCountry(code);
}

async function loadCountry(code) {
  if (!state.global) return;
  let stats;
  try {
    stats = await state.source.getCountryStats(code, state.window);
  } catch {
    $('[data-cc="body"]').textContent = 'Country statistics are unavailable right now.';
    return;
  }
  if (state.selected !== code) return;
  $('[data-cc="meta"]').textContent = `${code} · ${WINDOWS[state.window].label}`;
  renderCountryCard(code, stats);
  renderInsights(code, stats);
}

function renderCountryCard(code, s) {
  const body = $('[data-cc="body"]');
  body.innerHTML = '';
  if (s.suppressed) {
    const n = document.createElement('p');
    n.className = 'notice';
    n.textContent = s.has_activity
      ? `Fewer than ${s.threshold} moods so far in this window. To protect privacy, the breakdown appears once ${s.threshold} people have shared.`
      : `No moods shared from ${countryName(code)} in this window yet. Yours could be the first.`;
    body.append(n);
    return;
  }
  const top = topMood(s.distribution);
  const p = document.createElement('p');
  p.innerHTML = '<strong></strong> <span class="muted"></span>';
  p.firstChild.textContent = `${top.emoji} ${top.label}`;
  p.lastChild.textContent = `is the most shared mood · ${nf.format(s.total)} moods`;
  body.append(p, miniBars(s.distribution, 4));
}

function miniBars(dist, limit) {
  const total = dist.reduce((a, d) => a + d.count, 0);
  const wrap = document.createElement('div');
  wrap.className = 'mini-bars';
  for (const d of [...dist].sort((a, b) => b.count - a.count).slice(0, limit)) {
    const m = MOOD_BY_CODE.get(d.mood);
    const row = document.createElement('div');
    row.className = 'mini-bar';
    row.innerHTML = '<span></span><span class="track"><span class="fill"></span></span><span class="num"></span>';
    row.children[0].textContent = `${m.emoji} ${m.label}`;
    const fill = row.querySelector('.fill');
    fill.style.setProperty('--c', m.color);
    requestAnimationFrame(() => fill.style.setProperty('--w', `${((d.count / total) * 100).toFixed(1)}%`));
    row.children[2].textContent = `${Math.round((d.count / total) * 100)}%`;
    wrap.append(row);
  }
  return wrap;
}

function renderInsights(code, s) {
  const panel = $('[data-insights]');
  const name = countryName(code);
  panel.innerHTML = `
    <div class="insights-layout">
      <div class="insights-summary">
        <div class="insights-title"><span class="flag" aria-hidden="true"></span><div><h3></h3><p class="muted small"></p></div></div>
        <dl class="kv"></dl>
        <p class="muted small" data-disclaimer></p>
        <button class="btn btn-primary btn-sm" data-insight-share>Share your mood from here</button>
      </div>
      <div class="insights-charts"></div>
    </div>`;
  $('.flag', panel).textContent = flagEmoji(code);
  $('h3', panel).textContent = name;
  $('.insights-title .muted', panel).textContent = `ISO ${code} · ${WINDOWS[state.window].label}`;
  $('[data-disclaimer]', panel).textContent = `These are voluntary self-reports from people who chose to share. They don't describe how anyone from ${name} feels.`;
  $('[data-insight-share]', panel).addEventListener('click', () => { setShareCountry(code); openShare({ step: 1 }); });
  $$('[data-threshold]').forEach((el) => (el.textContent = s.threshold));

  const kv = $('.kv', panel);
  const add = (k, v) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    kv.append(dt, dd);
  };
  const charts = $('.insights-charts', panel);

  if (s.suppressed) {
    add('Moods shared', `Fewer than ${s.threshold}`);
    add('Breakdown', 'Hidden for privacy');
    const n = document.createElement('div');
    n.className = 'insights-empty';
    n.innerHTML = '<div class="empty-orb" aria-hidden="true">🛡️</div><h3></h3><p class="muted"></p>';
    n.querySelector('h3').textContent = s.has_activity ? 'Not enough moods yet' : 'No moods yet';
    n.querySelector('p').textContent = s.has_activity
      ? `We show a country's mood breakdown only after at least ${s.threshold} people have shared in the selected window, so no one can be singled out. Try a longer time window.`
      : `Nobody has shared a mood from ${name} in this window. Be the first.`;
    charts.append(n);
    return;
  }

  const top = topMood(s.distribution);
  add('Moods shared', nf.format(s.total));
  add('Most reported', `${top.emoji} ${top.label} (${(top.share * 100).toFixed(0)}%)`);
  if (s.previous_total != null) {
    const pos = share(s.distribution, 'positive') * 100, prev = share(s.previous_distribution, 'positive') * 100;
    const pp = pos - prev;
    add('Positive share', `${pos.toFixed(0)}% (${pp >= 0 ? '+' : '−'}${Math.abs(pp).toFixed(1)} pts)`);
    add('Previous period', `${nf.format(s.previous_total)} moods`);
  } else {
    add('Recent trend', 'Not enough earlier data');
  }
  add('Last updated', new Date(s.last_updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));

  charts.innerHTML = `
    <div>
      <div class="card-head"><h3>Compared with the world</h3><p class="muted small">Share of each mood, ${escapeText(name)} vs global.</p></div>
      <div class="chart-box tall"><canvas role="img" data-chart="compare"></canvas></div>
      <details class="data-table"><summary>View as table</summary><table data-table="compare"></table></details>
    </div>
    <div>
      <div class="card-head"><h3>Recent trend</h3></div>
      <div class="chart-box"><canvas role="img" data-chart="country-timeline"></canvas></div>
    </div>`;
  const series = [
    { label: name, distribution: s.distribution, style: 'solid' },
    { label: 'World', distribution: state.global.distribution, style: 'outline' },
  ];
  fillTable($('[data-table="compare"]', charts), series);
  if (chartsVisible) {
    renderDistribution($('[data-chart="compare"]', charts), series).catch(chartFailed);
    renderTimeline($('[data-chart="country-timeline"]', charts), s.timeline, state.window).catch(chartFailed);
  }
}

// =====================================================================
// Recent activity feed
// =====================================================================
function renderFeed(items) {
  const feed = $('[data-feed]');
  feed.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'feed-empty glass';
    li.innerHTML = '<p class="muted">No moods shared in the last 7 days yet.</p>';
    const b = Object.assign(document.createElement('button'), { className: 'btn btn-primary btn-sm', textContent: 'Share the first mood' });
    b.style.marginTop = '12px';
    b.addEventListener('click', () => openShare({ step: 1 }));
    li.append(b);
    feed.append(li);
    return;
  }
  for (const it of items) {
    const m = MOOD_BY_CODE.get(it.mood);
    if (!m) continue;
    const li = document.createElement('li');
    li.className = 'feed-item glass';
    li.style.setProperty('--c', m.color);
    li.innerHTML = '<span class="emoji" aria-hidden="true"></span><div class="line"><span class="mood-label"></span><span class="where"></span></div><span class="when"></span>';
    li.querySelector('.emoji').textContent = m.emoji;
    li.querySelector('.mood-label').textContent = `Feeling ${m.label.toLowerCase()}`;
    li.querySelector('.where').textContent = `${flagEmoji(it.country_code)} ${countryName(it.country_code)}`;
    const when = li.querySelector('.when');
    when.dataset.relTime = it.created_at;
    when.textContent = relTime(it.created_at);
    if (it.sample || it.local) {
      const badge = Object.assign(document.createElement('span'), { className: 'badge', textContent: it.local ? 'You · this browser' : 'Sample' });
      li.querySelector('.line').append(badge);
    }
    if (it.message) {
      const msg = Object.assign(document.createElement('p'), { className: 'msg', textContent: it.message });
      li.append(msg);
      if (it.message_id && !it.sample) {
        const rep = Object.assign(document.createElement('button'), { className: 'link-btn report', textContent: 'Report' });
        rep.setAttribute('aria-label', 'Report this note');
        rep.addEventListener('click', () => openReport(it.message_id, rep));
        li.append(rep);
      }
    }
    feed.append(li);
  }
}

function relTime(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

// =====================================================================
// Country search comboboxes
// =====================================================================
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const SEARCH_INDEX = COUNTRIES.map((c) => ({ ...c, key: normalize(c.name) }));

function searchCountries(q) {
  const n = normalize(q.trim());
  if (!n) return [];
  const starts = [], contains = [];
  for (const c of SEARCH_INDEX) {
    if (c.key.startsWith(n) || c.code.toLowerCase() === n) starts.push(c);
    else if (c.key.includes(n)) contains.push(c);
  }
  return [...starts, ...contains].slice(0, 8);
}

function setupCombobox(input, list, onPick, { keepValue = false } = {}) {
  let results = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const render = () => {
    results = searchCountries(input.value);
    list.innerHTML = '';
    if (!input.value.trim()) return close();
    if (!results.length) {
      list.innerHTML = '<li class="empty" role="option" aria-disabled="true">No matching country</li>';
    }
    results.forEach((c, i) => {
      const li = document.createElement('li');
      li.id = `${list.id}-${c.code}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.innerHTML = '<span class="flag" aria-hidden="true"></span><span></span>';
      li.firstChild.textContent = flagEmoji(c.code);
      li.lastChild.textContent = c.name;
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => pick(c));
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const highlight = () => {
    $$('[role="option"]', list).forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    const el = list.children[active];
    if (el) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
  };
  const pick = (c) => {
    input.value = keepValue ? c.name : '';
    close();
    onPick(c.code);
  };
  input.addEventListener('input', () => { active = -1; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (list.hidden) render();
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      highlight();
    } else if (e.key === 'Enter') {
      if (results.length) { e.preventDefault(); pick(results[Math.max(0, active)]); }
    } else if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault(); e.stopPropagation(); close();
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

function setupCountrySearches() {
  setupCombobox($('#globe-search'), $('#globe-search-list'), (code) => onGlobeSelect(code));
  setupCombobox($('#insights-search'), $('#insights-search-list'), (code) => selectCountry(code, { fly: true }));
  setupCombobox($('#share-country-search'), $('#share-country-list'), (code) => setShareCountry(code), { keepValue: true });
}

// =====================================================================
// Share modal
// =====================================================================
const share$ = { mood: null, country: null, step: 1, busy: false };

function setupShareModal() {
  const grid = $('[data-mood-options]');
  for (const m of MOODS) {
    const div = document.createElement('div');
    div.className = 'mood-option';
    div.style.setProperty('--c', m.color);
    div.innerHTML = `<input type="radio" name="mood" id="mood-${m.code}" value="${m.code}"><label for="mood-${m.code}"><span class="em" aria-hidden="true"></span><span></span></label>`;
    div.querySelector('.em').textContent = m.emoji;
    div.querySelector('label span:last-child').textContent = m.label;
    const input = div.querySelector('input');
    input.addEventListener('change', () => { share$.mood = m.code; updateShareButtons(); });
    // Pointer users move on automatically; keyboard users confirm with Continue.
    div.addEventListener('click', (e) => {
      if (e.detail > 0) setTimeout(() => share$.step === 1 && share$.mood && goStep(2), 260);
    });
    grid.append(div);
  }

  const select = $('#share-country-select');
  for (const c of [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name))) {
    select.append(new Option(`${flagEmoji(c.code)} ${c.name}`, c.code));
  }
  select.addEventListener('change', () => select.value && setShareCountry(select.value));

  $$('[data-share]').forEach((b) => b.addEventListener('click', () => {
    closeMenu();
    if (state.selected && !share$.country) setShareCountry(state.selected);
    openShare({ step: 1 });
  }));

  $('[data-next]').addEventListener('click', () => goStep(share$.step + 1));
  $('[data-back]').addEventListener('click', () => goStep(share$.step - 1));
  $('[data-submit]').addEventListener('click', submitShare);
  $('[data-done]').addEventListener('click', () => {
    $('#share-modal').close();
    const code = share$.country;
    $('#explore').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    if (code) selectCountry(code);
  });
  $('[data-pick-on-globe]').addEventListener('click', () => {
    state.pickMode = true;
    $('#share-modal').close();
    $('#globe-stage').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    toast('Tap or click your country on the globe (or use the search box).');
  });

  $$('input[name="note-mode"]').forEach((r) => r.addEventListener('change', () => {
    const on = $('input[name="note-mode"]:checked').value === 'note';
    $('[data-note-field]').hidden = !on;
    if (on) $('#share-message').focus();
  }));
  const msg = $('#share-message');
  msg.addEventListener('input', () => { $('#note-count').textContent = `${msg.value.length} / 140`; });

  $('#share-modal').addEventListener('close', () => {
    if (share$.step === 'done') resetShare();
  });

  const last = store.get('wp.lastCountry');
  if (last && COUNTRY_BY_CODE.has(last)) setShareCountry(last);
}

function resetShare() {
  share$.mood = null;
  share$.step = 1;
  $$('input[name="mood"]').forEach((i) => (i.checked = false));
  $('#share-message').value = '';
  $('#note-count').textContent = '0 / 140';
  $('input[name="note-mode"][value="none"]').checked = true;
  $('[data-note-field]').hidden = true;
  $('[data-form-error]').hidden = true;
}

function openShare({ step = 1 } = {}) {
  const dlg = $('#share-modal');
  if (share$.step === 'done') resetShare();
  if (!dlg.open) dlg.showModal();
  goStep(step === 2 && !share$.mood ? 1 : step);
}

function setShareCountry(code) {
  share$.country = code;
  $('#share-country-select').value = code;
  const el = $('[data-selected-country]');
  el.innerHTML = '<span class="flag" aria-hidden="true"></span><span></span>';
  el.firstChild.textContent = flagEmoji(code);
  el.lastChild.textContent = `Counting your mood in ${countryName(code)}`;
  updateShareButtons();
}

const STEP_TITLES = { 1: 'How are you feeling?', 2: 'Where are you sharing from?', 3: 'Add your pulse', done: 'Thank you' };

function goStep(step) {
  if (step === 2 && !share$.mood) return;
  if (step === 3 && !share$.country) return;
  share$.step = step;
  $$('#share-modal [data-step]').forEach((s) => (s.hidden = String(s.dataset.step) !== String(step)));
  $('[data-step-title]').textContent = STEP_TITLES[step];
  $('[data-step-label]').textContent = step === 'done' ? 'Shared' : `Step ${step} of 3`;
  $('[data-progress]').style.width = step === 'done' ? '100%' : `${(step / 3) * 100}%`;
  $('[data-back]').hidden = step === 1 || step === 'done';
  $('[data-next]').hidden = step === 3 || step === 'done';
  $('[data-submit]').hidden = step !== 3;
  $('[data-done]').hidden = step !== 'done';
  $('[data-form-error]').hidden = true;
  if (step === 3) renderSummary();
  updateShareButtons();
  requestAnimationFrame(() => {
    if (step === 1) ($('input[name="mood"]:checked') || $('input[name="mood"]')).focus();
    else if (step === 2) $('#share-country-search').focus();
    else if (step === 3) $('input[name="note-mode"]:checked').focus();
    else $('[data-done]').focus();
  });
}

function updateShareButtons() {
  const next = $('[data-next]');
  next.disabled = share$.step === 1 ? !share$.mood : share$.step === 2 ? !share$.country : false;
}

function renderSummary() {
  const m = MOOD_BY_CODE.get(share$.mood);
  const el = $('[data-summary]');
  el.innerHTML = '<span class="em" aria-hidden="true"></span><span><strong></strong><span class="muted small"></span></span>';
  el.querySelector('.em').textContent = m.emoji;
  el.querySelector('strong').textContent = `Feeling ${m.label.toLowerCase()}`;
  el.querySelector('.muted').textContent = `${flagEmoji(share$.country)} ${countryName(share$.country)}`;
}

const SUBMIT_ERRORS = {
  invalid_mood: 'Please choose one of the moods.',
  invalid_country: 'Please choose a valid country.',
  rate_limited: 'You just shared a mood. Please wait a minute before sharing again.',
  daily_limit: "You've reached today's limit for sharing. Thank you — come back tomorrow!",
  message_too_long: 'Your note is too long. Please keep it to 140 characters.',
};

async function submitShare() {
  if (share$.busy) return;
  const errEl = $('[data-form-error]');
  const showErr = (t) => { errEl.textContent = t; errEl.hidden = false; };
  const wantsNote = $('input[name="note-mode"]:checked').value === 'note';
  const message = wantsNote ? $('#share-message').value.trim() : '';
  if (!MOOD_BY_CODE.has(share$.mood)) return showErr(SUBMIT_ERRORS.invalid_mood);
  if (!COUNTRY_BY_CODE.has(share$.country)) return showErr(SUBMIT_ERRORS.invalid_country);
  if (message.length > 140) return showErr(SUBMIT_ERRORS.message_too_long);
  const lastAt = Number(store.get('wp.lastSubmitAt') || 0);
  if (Date.now() - lastAt < 60e3) return showErr(SUBMIT_ERRORS.rate_limited);

  const btn = $('[data-submit]');
  share$.busy = true;
  btn.classList.add('loading');
  btn.disabled = true;
  try {
    const res = await state.source.submit({
      mood: share$.mood, country: share$.country, message: message || null, website: $('#share-website').value,
    });
    if (!res?.ok) return showErr(SUBMIT_ERRORS[res?.error] || 'We could not save your mood right now. Please try again in a moment.');
    store.set('wp.lastSubmitAt', String(Date.now()));
    store.set('wp.lastCountry', share$.country);
    showSuccess(res.message_status);
    refreshAll();
  } catch {
    showErr('We could not reach WorldPulse. Check your connection and try again.');
  } finally {
    share$.busy = false;
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function showSuccess(messageStatus) {
  const demo = state.source.mode === 'demo';
  $('[data-success-emoji]').textContent = MOOD_BY_CODE.get(share$.mood).emoji;
  $('[data-success-title]').textContent = demo ? 'Demo pulse recorded' : 'Your pulse has joined the world.';
  let text = demo
    ? 'Demo mode: your mood was added to the sample data in this browser only. It was not saved to a database or shared with anyone.'
    : 'Thanks for sharing how you feel. 💙';
  if (!demo && messageStatus === 'pending') text += ' Your note will appear after a quick review.';
  if (!demo && messageStatus === 'rejected') text += " Your note didn't pass our automatic checks, so we shared your mood without it.";
  if (demo && messageStatus === 'demo_not_published') text += ' Notes are never shown in demo mode.';
  $('[data-success-text]').textContent = text;
  goStep('done');
}

// =====================================================================
// Reporting
// =====================================================================
let reportTarget = null;
function setupReport() {
  $('[data-report-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dlg = $('#report-dialog');
    const { id, button } = reportTarget || {};
    if (!id) return dlg.close();
    try {
      const res = await state.source.report(id, $('#report-reason').value);
      if (!res?.ok && res?.error !== 'not_found') throw new Error(res?.error);
      button.textContent = 'Reported';
      button.disabled = true;
      toast('Thank you. Our moderators will take a look.');
    } catch {
      toast('Could not send the report right now. Please try again later.', 'error');
    }
    dlg.close();
  });
}

function openReport(id, button) {
  reportTarget = { id, button };
  $('#report-dialog').showModal();
}

// =====================================================================
// Navigation, dialogs, toasts
// =====================================================================
function setupNav() {
  const toggle = $('.menu-toggle');
  const links = $('#nav-links');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    links.classList.toggle('open', open);
  });
  links.addEventListener('click', (e) => e.target.closest('a') && closeMenu());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());

  const navLinks = $$('.nav-links a');
  const sections = navLinks.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      navLinks.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${e.target.id}`)));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => io.observe(s));
}

function closeMenu() {
  const toggle = $('.menu-toggle');
  if (toggle.getAttribute('aria-expanded') !== 'true') return;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open menu');
  $('#nav-links').classList.remove('open');
}

const INFO = { privacy: 'Privacy', guidelines: 'Community Guidelines', contact: 'Contact' };

function setupDialogs() {
  $$('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    $$('[data-close-modal]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  });
  $$('[data-info]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.info;
    $('[data-info-title]').textContent = INFO[key];
    const body = $('[data-info-body]');
    body.innerHTML = '';
    body.append($(`#tpl-${key}`).content.cloneNode(true));
    const mail = $('[data-contact-email]', body);
    if (mail) {
      if (config.contactEmail) { mail.href = `mailto:${config.contactEmail}`; mail.textContent = config.contactEmail; }
      else { mail.removeAttribute('href'); mail.textContent = 'the contact address configured for this deployment (not set yet — WORLDPULSE_CONTACT_EMAIL)'; }
    }
    $('#info-dialog').showModal();
  }));
}

function toast(text, kind = '') {
  const el = Object.assign(document.createElement('div'), { className: `toast ${kind}`, textContent: text });
  $('[data-toasts]').append(el);
  setTimeout(() => el.remove(), 5200);
}

async function copySiteLink(url) {
  const label = $('[data-copy-label]');
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: 'WorldPulse', text: 'How is the world feeling today?', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    label.textContent = 'Copied';
    setTimeout(() => (label.textContent = 'Copy'), 2000);
  } catch (err) {
    if (err?.name !== 'AbortError') toast(`Copy this link: ${url}`);
  }
}

function escapeText(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
