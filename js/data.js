// Data sources. Both expose the same interface so the UI never needs to
// know where numbers come from — only whether they are demo or live.
import { MOODS, MOOD_BY_CODE, WINDOWS } from './moods.js';
import { COUNTRIES, COUNTRY_BY_CODE } from './countries.js';
import { LIBS, loadScript } from './libs.js';

const MIN_GROUP = 10;

export function clientToken() {
  const key = 'wp.clientToken';
  try {
    let t = localStorage.getItem(key);
    if (!t || !/^[A-Za-z0-9-]{16,64}$/.test(t)) {
      t = crypto.randomUUID();
      localStorage.setItem(key, t);
    }
    return t;
  } catch {
    clientToken.memo ||= crypto.randomUUID();
    return clientToken.memo;
  }
}

// ---------------------------------------------------------------------
// Live data: Supabase RPC functions defined in supabase/schema.sql
// ---------------------------------------------------------------------
export class SupabaseSource {
  constructor({ url, anonKey }) {
    this.mode = 'live';
    this.url = url;
    this.anonKey = anonKey;
    this.client = null;
  }

  async init() {
    await loadScript(LIBS.supabase);
    if (!window.supabase?.createClient) throw new Error('Supabase library failed to load');
    this.client = window.supabase.createClient(this.url, this.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 2 } },
    });
    // Probe once so configuration errors surface immediately.
    await this.getGlobalStats('24h');
  }

  async rpc(name, args) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) {
      console.warn(`[WorldPulse] ${name} failed`, error);
      throw new Error('network');
    }
    if (data && data.ok === false && name !== 'submit_mood' && name !== 'report_message') {
      throw new Error(data.error || 'request_failed');
    }
    return data;
  }

  getGlobalStats(win) { return this.rpc('get_global_stats', { p_window: win }); }
  getMarkers(win, mood) { return this.rpc('get_country_markers', { p_window: win, p_mood: mood || null }); }
  getCountryStats(code, win) { return this.rpc('get_country_stats', { p_country: code, p_window: win }); }
  getRecent(limit = 20) { return this.rpc('get_recent_activity', { p_limit: limit }); }

  submit({ mood, country, message, website }) {
    return this.rpc('submit_mood', {
      p_mood: mood,
      p_country: country,
      p_message: message || null,
      p_client_token: clientToken(),
      p_website: website || null,
    });
  }

  report(messageId, reason) {
    return this.rpc('report_message', { p_message_id: messageId, p_reason: reason, p_client_token: clientToken() });
  }

  /** Subscribes to content-free pulse broadcasts. onStatus receives 'live' | 'offline'. */
  subscribe(onPulse, onStatus) {
    const channel = this.client.channel('worldpulse-pulse');
    channel
      .on('broadcast', { event: 'pulse' }, () => onPulse())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') onStatus('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus('offline');
      });
    return () => this.client.removeChannel(channel);
  }
}

// ---------------------------------------------------------------------
// Demo data: clearly labelled sample records generated in the browser.
// The same base mood distribution is used for every country so the demo
// never implies that nationality predicts emotion.
// ---------------------------------------------------------------------
const DEMO_COUNTRIES = ['US', 'IN', 'BR', 'DE', 'GB', 'FR', 'JP', 'NG', 'MX', 'ID', 'CA', 'AU', 'ZA', 'KE', 'ES', 'IT',
  'KR', 'PH', 'EG', 'TR', 'AR', 'CO', 'PL', 'NL', 'SE', 'VN', 'TH', 'PK', 'BD', 'GH', 'MA', 'PE', 'CL', 'NZ', 'IE', 'PT',
  'NO', 'FI', 'SG', 'AE', 'UA', 'RO', 'CN', 'RU', 'SA', 'IS', 'NP', 'LK'];
const DEMO_MESSAGES = [
  'First coffee of the day on the balcony.', 'Exams are done!', 'Missing home a little tonight.',
  'Long shift, but the team was great.', 'Rain all week, still smiling.', 'New job starts Monday.',
  'Watching the sunrise with my dog.', 'Trying to take things one day at a time.', 'Grateful for small things.',
  'Big presentation tomorrow, wish me luck.',
];
const DEMO_WEIGHTS = [16, 8, 12, 7, 18, 8, 9, 6, 11, 9];

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rand, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = rand() * sum;
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
  return weights.length - 1;
}

export class DemoSource {
  constructor() {
    this.mode = 'demo';
    this.listeners = new Set();
  }

  async init() {
    const rand = mulberry32(20261018);
    const now = Date.now();
    const countryWeights = DEMO_COUNTRIES.map((_, i) => 1 / (1 + i * 0.12));
    this.records = [];
    for (let i = 0; i < 4200; i++) {
      const country = DEMO_COUNTRIES[pickWeighted(rand, countryWeights)];
      const mood = MOODS[pickWeighted(rand, DEMO_WEIGHTS)].code;
      const at = now - 30 * 864e5 * rand() ** 2;
      const message = rand() < 0.08 ? DEMO_MESSAGES[Math.floor(rand() * DEMO_MESSAGES.length)] : null;
      this.records.push({ id: `demo-${i}`, mood, country_code: country, created_at: at, message, sample: true });
    }
    for (const r of this.localRecords()) this.records.push(r);
    this.records.sort((a, b) => b.created_at - a.created_at);
  }

  localRecords() {
    try {
      return JSON.parse(localStorage.getItem('wp.demoSubmissions') || '[]')
        .filter((r) => MOOD_BY_CODE.has(r.mood) && COUNTRY_BY_CODE.has(r.country_code) && Date.now() - r.created_at < 30 * 864e5);
    } catch { return []; }
  }

  inRange(from, to, country) {
    return this.records.filter((r) => r.created_at >= from && r.created_at < to && (!country || r.country_code === country));
  }

  distribution(rows) {
    const counts = Object.fromEntries(MOODS.map((m) => [m.code, 0]));
    for (const r of rows) counts[r.mood]++;
    return MOODS.map((m) => ({ mood: m.code, count: counts[m.code] }));
  }

  timeline(win, country) {
    const { ms, bucketMs } = WINDOWS[win];
    const now = Date.now();
    const start = Math.floor((now - ms) / bucketMs) * bucketMs;
    const buckets = [];
    for (let t = start; t <= now; t += bucketMs) buckets.push({ t: new Date(t).toISOString(), total: 0, positive: 0, negative: 0, _t: t });
    for (const r of this.inRange(now - ms, now + 1, country)) {
      const b = buckets[Math.floor((r.created_at - start) / bucketMs)];
      if (!b) continue;
      const v = MOOD_BY_CODE.get(r.mood).valence;
      b.total++;
      if (v === 'positive') b.positive++;
      if (v === 'negative') b.negative++;
    }
    return buckets.map(({ _t, ...b }) => b);
  }

  async getGlobalStats(win) {
    const { ms } = WINDOWS[win];
    const now = Date.now();
    const cur = this.inRange(now - ms, now + 1);
    const prev = this.inRange(now - 2 * ms, now - ms);
    return {
      ok: true, window: win, generated_at: new Date(now).toISOString(),
      total: cur.length,
      countries: new Set(cur.map((r) => r.country_code)).size,
      distribution: this.distribution(cur),
      previous_total: prev.length,
      previous_distribution: this.distribution(prev),
      timeline: this.timeline(win),
      last_submission_at: this.records[0] ? new Date(this.records[0].created_at).toISOString() : null,
    };
  }

  async getMarkers(win, mood) {
    const now = Date.now();
    const byCountry = new Map();
    for (const r of this.inRange(now - WINDOWS[win].ms, now + 1)) {
      if (!byCountry.has(r.country_code)) byCountry.set(r.country_code, []);
      byCountry.get(r.country_code).push(r);
    }
    const markers = [...byCountry].map(([code, rows]) => {
      if (rows.length < MIN_GROUP) return { code, suppressed: true };
      const dist = this.distribution(rows).sort((a, b) => b.count - a.count || a.mood.localeCompare(b.mood));
      const moodN = mood ? rows.filter((r) => r.mood === mood).length : 0;
      return { code, suppressed: false, total: rows.length, top_mood: dist[0].mood, mood_share: mood ? moodN / rows.length : null };
    });
    return { ok: true, threshold: MIN_GROUP, markers };
  }

  async getCountryStats(code, win) {
    const { ms } = WINDOWS[win];
    const now = Date.now();
    const cur = this.inRange(now - ms, now + 1, code);
    const prev = this.inRange(now - 2 * ms, now - ms, code);
    const base = { ok: true, code, window: win, generated_at: new Date(now).toISOString(), threshold: MIN_GROUP };
    if (cur.length < MIN_GROUP) return { ...base, suppressed: true, has_activity: cur.length > 0 };
    return {
      ...base, suppressed: false, total: cur.length,
      distribution: this.distribution(cur),
      previous_total: prev.length >= MIN_GROUP ? prev.length : null,
      previous_distribution: prev.length >= MIN_GROUP ? this.distribution(prev) : null,
      timeline: this.timeline(win, code),
      last_updated: new Date(Math.max(...cur.map((r) => r.created_at))).toISOString(),
    };
  }

  async getRecent(limit = 20) {
    const items = this.records.slice(0, limit).map((r) => ({
      mood: r.mood, country_code: r.country_code,
      created_at: new Date(Math.floor(r.created_at / 60e3) * 60e3).toISOString(),
      message: r.message, message_id: r.message ? r.id : null,
      sample: r.sample, local: !!r.local,
    }));
    return { ok: true, items };
  }

  async submit({ mood, country, message, website }) {
    if (website) return { ok: true, message_status: 'none' };
    if (!MOOD_BY_CODE.has(mood)) return { ok: false, error: 'invalid_mood' };
    if (!COUNTRY_BY_CODE.has(country)) return { ok: false, error: 'invalid_country' };
    const last = this.records.find((r) => r.local);
    if (last && Date.now() - last.created_at < 60e3) return { ok: false, error: 'rate_limited', retry_after: 60 };
    // Demo messages are never shown publicly; they stay private to this browser.
    const record = { id: `local-${Date.now()}`, mood, country_code: country, created_at: Date.now(), message: null, local: true };
    this.records.unshift(record);
    try {
      const saved = this.localRecords();
      saved.push(record);
      localStorage.setItem('wp.demoSubmissions', JSON.stringify(saved.slice(-50)));
    } catch { /* storage unavailable: keep in memory only */ }
    setTimeout(() => this.listeners.forEach((fn) => fn()), 300);
    return { ok: true, message_status: message ? 'demo_not_published' : 'none' };
  }

  async report() { return { ok: true }; }

  subscribe(onPulse, onStatus) {
    this.listeners.add(onPulse);
    onStatus('demo');
    return () => this.listeners.delete(onPulse);
  }
}

export function countryName(code) {
  return COUNTRY_BY_CODE.get(code)?.name ?? code;
}

export { COUNTRIES };
