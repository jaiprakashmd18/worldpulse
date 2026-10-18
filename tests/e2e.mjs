// End-to-end smoke tests (Playwright + Chromium).
//   npm install && npx playwright install chromium   # once
//   npm run test:e2e
// Set WORLDPULSE_VENDOR_DIR to a node_modules folder containing three@0.160.0,
// three-globe@2.31.0, world-atlas@2.0.2, chart.js@4.4.1 and
// @supabase/supabase-js@2.45.4 to run fully offline (CDN requests are served
// from that folder instead).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const VENDOR = process.env.WORLDPULSE_VENDOR_DIR;
const OUT = new URL('../test-results/', import.meta.url);
await mkdir(OUT, { recursive: true });

const server = spawn(process.execPath, ['scripts/dev-server.mjs', String(PORT)], {
  cwd: new URL('..', import.meta.url), stdio: 'ignore', env: { ...process.env, WORLDPULSE_SUPABASE_URL: '' },
});
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failures = 0;

async function vendor(route) {
  const url = route.request().url();
  const map = [
    [/three@0\.160\.0\/\+esm$/, 'three/build/three.module.js'],
    [/OrbitControls\.js\/\+esm$/, 'three/examples/jsm/controls/OrbitControls.js'],
    [/three-globe@2\.31\.0\/(example\/img\/.*)$/, 'three-globe/$1'],
    [/world-atlas@2\.0\.2\/(.*)$/, 'world-atlas/$1'],
    [/chart\.js@4\.4\.1\/(.*)$/, 'chart.js/$1'],
    [/supabase-js@2\.45\.4\/(.*)$/, '@supabase/supabase-js/$1'],
  ];
  for (const [re, target] of map) {
    const m = url.match(re);
    if (!m) continue;
    const file = join(VENDOR, target.replace('$1', m[1] || ''));
    let body = await readFile(file);
    if (file.endsWith('OrbitControls.js')) body = body.toString().replace(/from 'three'/g, "from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm'");
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return route.fulfill({ body, contentType: type, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  return route.abort();
}

// Software WebGL in headless Chromium is slow, so most tests emulate reduced
// motion (which also exercises that code path): the globe then renders only on change.
async function newPage(viewport, { live = null, motion = false } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: motion ? 'no-preference' : 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  if (VENDOR) await page.route('https://cdn.jsdelivr.net/**', vendor);
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  if (live) {
    await page.route(`${BASE}/js/config.js`, (r) => r.fulfill({
      contentType: 'text/javascript',
      body: `window.WORLDPULSE_CONFIG = { supabaseUrl: 'https://test-project.supabase.co', supabaseAnonKey: 'anon-test-key', pollIntervalMs: 60000 };`,
    }));
    await page.route('https://test-project.supabase.co/**', live);
  }
  return { page, errors, ctx };
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✘ ${name}\n  ${err.stack?.split('\n').slice(0, 3).join('\n  ')}`);
  }
}

await test('demo mode: loads, labels demo data, renders globe and stats', async () => {
  const { page, errors, ctx } = await newPage({ width: 1440, height: 900 }, { motion: true });
  await page.goto(BASE);
  await page.waitForSelector('#demo-banner:not([hidden])');
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-stat="total"]').textContent));
  await page.waitForSelector('#globe canvas, #map-fallback:not([hidden])', { timeout: 15000 });
  assert.match(await page.textContent('[data-status-text]'), /Demo/);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: new URL('desktop.png', OUT).pathname });
  await page.locator('#pulse').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: new URL('desktop-pulse.png', OUT).pathname, fullPage: true });
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('globe search selects a country and shows the card + insights', async () => {
  const { page, ctx } = await newPage({ width: 1280, height: 860 });
  await page.goto(BASE);
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-stat="total"]').textContent));
  await page.fill('#globe-search', 'germ');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#country-card:not([hidden])');
  assert.equal(await page.textContent('[data-cc="name"]'), 'Germany');
  await page.waitForSelector('[data-insights] .insights-title h3');
  assert.equal(await page.textContent('[data-insights] .insights-title h3'), 'Germany');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: new URL('country.png', OUT).pathname });
  // A tiny demo country stays suppressed below the threshold.
  await page.fill('#insights-search', 'Tuvalu');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-insights]').textContent.includes('No moods yet'));
  await ctx.close();
});

await test('time window and mood filter update stats', async () => {
  const { page, ctx } = await newPage({ width: 1280, height: 860 });
  await page.goto(BASE);
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-stat="total"]').textContent));
  const before = await page.textContent('[data-stat="total"]');
  await page.click('[data-window="30d"]');
  await page.waitForFunction((b) => document.querySelector('[data-stat="total"]').textContent !== b, before);
  assert.equal(await page.getAttribute('[data-window="30d"]', 'aria-checked'), 'true');
  await page.click('[data-mood-filter] [data-mood="calm"]');
  await page.waitForFunction(() => document.querySelector('[data-pulse="filter-note"]').textContent.includes('Calm'));
  await ctx.close();
});

await test('share flow works in under 15 seconds with mouse and is labelled as demo', async () => {
  const { page, errors, ctx } = await newPage({ width: 1280, height: 860 });
  await page.goto(BASE);
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-stat="total"]').textContent));
  const t0 = Date.now();
  await page.click('.nav-cta');
  await page.click('.mood-option:has(#mood-hopeful)');
  await page.waitForSelector('[data-step="2"]:not([hidden])');
  await page.fill('#share-country-search', 'new zea');
  await page.keyboard.press('Enter');
  await page.click('[data-next]');
  await page.screenshot({ path: new URL('share-step3.png', OUT).pathname });
  await page.click('[data-submit]');
  await page.waitForSelector('[data-step="done"]:not([hidden])');
  assert.ok(Date.now() - t0 < 15000);
  assert.match(await page.textContent('[data-success-text]'), /demo mode/i);
  await page.screenshot({ path: new URL('share-success.png', OUT).pathname });
  await page.click('[data-done]');
  await page.waitForFunction(() => document.querySelector('[data-feed]').textContent.includes('this browser'));
  // Immediate second submission is blocked client-side.
  await page.click('.nav-cta');
  await page.click('.mood-option:has(#mood-calm)');
  await page.waitForSelector('[data-step="2"]:not([hidden])');
  await page.click('[data-next]');
  await page.click('[data-submit]');
  await page.waitForSelector('[data-form-error]:not([hidden])');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('keyboard: mood can be chosen without auto-advancing, Escape closes modal', async () => {
  const { page, ctx } = await newPage({ width: 1280, height: 860 });
  await page.goto(BASE);
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-stat="total"]').textContent));
  await page.focus('.nav-cta');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#share-modal[open]');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  assert.equal(await page.isVisible('[data-step="1"]'), true);
  assert.equal(await page.isEnabled('[data-next]'), true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#share-modal:not([open])', { state: 'attached' });
  await ctx.close();
});

await test('mobile layout has no horizontal scroll and menu opens', async () => {
  const { page, errors, ctx } = await newPage({ width: 375, height: 780 });
  await page.goto(BASE);
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-stat="total"]').textContent));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: new URL('mobile.png', OUT).pathname, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page overflows by ${overflow}px`);
  await page.click('.menu-toggle');
  await page.waitForSelector('#nav-links.open');
  await page.screenshot({ path: new URL('mobile-menu.png', OUT).pathname });
  await page.click('#nav-links .nav-cta-mobile .btn');
  await page.waitForSelector('#share-modal[open]');
  await page.screenshot({ path: new URL('mobile-share.png', OUT).pathname });
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('no WebGL: falls back to a clickable flat map', async () => {
  const { page, ctx } = await newPage({ width: 1280, height: 860 });
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) { return /webgl/.test(type) ? null : orig.call(this, type, ...a); };
  });
  await page.goto(BASE);
  await page.waitForSelector('#map-fallback:not([hidden]) svg path');
  await page.click('#map-fallback path[data-code="BR"]', { force: true });
  await page.waitForSelector('#country-card:not([hidden])');
  assert.equal(await page.textContent('[data-cc="name"]'), 'Brazil');
  await page.screenshot({ path: new URL('fallback.png', OUT).pathname });
  await ctx.close();
});

// Live mode against a mocked Supabase API: verifies wiring, honest empty
// states, privacy suppression and that output is escaped.
const calls = [];
const emptyDist = ['happy', 'loved', 'calm', 'excited', 'okay', 'sad', 'anxious', 'frustrated', 'tired', 'hopeful'].map((mood) => ({ mood, count: 0 }));
async function mockSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const fn = url.pathname.split('/').pop();
  const body = req.postDataJSON?.() ?? null;
  calls.push({ fn, body });
  const json = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  switch (fn) {
    case 'get_global_stats': return json({ ok: true, window: body.p_window, generated_at: new Date().toISOString(), total: 0, countries: 0, distribution: emptyDist, previous_total: 0, previous_distribution: emptyDist, timeline: [], last_submission_at: null });
    case 'get_country_markers': return json({ ok: true, threshold: 10, markers: [{ code: 'FR', suppressed: true }] });
    case 'get_country_stats': return json({ ok: true, code: body.p_country, window: body.p_window, suppressed: true, threshold: 10, has_activity: true });
    case 'get_recent_activity': return json({ ok: true, items: [{ mood: 'calm', country_code: 'FR', created_at: new Date().toISOString(), message_id: '00000000-0000-0000-0000-000000000001', message: '<img src=x onerror="window.__xss=1">' }] });
    case 'submit_mood': return json({ ok: true, message_status: 'pending' });
    case 'report_message': return json({ ok: true });
    default: return route.abort();
  }
}

await test('live mode (mocked API): empty state, suppression, escaping, submission payload', async () => {
  const { page, ctx } = await newPage({ width: 1280, height: 860 }, { live: mockSupabase });
  await page.goto(BASE);
  await page.waitForSelector('[data-pulse-empty]:not([hidden])');
  assert.equal(await page.isVisible('#demo-banner'), false);
  assert.equal(await page.textContent('[data-stat="total"]'), '0');
  // Escaped message renders as text.
  await page.waitForFunction(() => document.querySelector('[data-feed] .msg')?.textContent.includes('<img'));
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  // Suppressed country.
  await page.fill('#globe-search', 'France');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-cc="body"]').textContent.includes('Fewer than 10'));
  // Submission sends only the documented fields.
  await page.click('.nav-cta');
  await page.click('.mood-option:has(#mood-happy)');
  await page.waitForSelector('[data-step="2"]:not([hidden])');
  await page.click('[data-next]');
  await page.check('input[name="note-mode"][value="note"]');
  await page.fill('#share-message', 'Lovely evening');
  await page.click('[data-submit]');
  await page.waitForSelector('[data-step="done"]:not([hidden])');
  assert.match(await page.textContent('[data-success-title]'), /joined the world/);
  assert.match(await page.textContent('[data-success-text]'), /after a quick review/);
  const submit = calls.find((c) => c.fn === 'submit_mood');
  assert.deepEqual(Object.keys(submit.body).sort(), ['p_client_token', 'p_country', 'p_message', 'p_mood', 'p_website']);
  assert.equal(submit.body.p_country, 'FR');
  assert.equal(submit.body.p_message, 'Lovely evening');
  await page.screenshot({ path: new URL('live-mock.png', OUT).pathname });
  await ctx.close();
});

await test('live mode with unreachable database shows an honest error, not demo data', async () => {
  const { page, ctx } = await newPage({ width: 1280, height: 860 }, { live: (r) => r.abort() });
  await page.goto(BASE);
  await page.waitForSelector('[data-pulse-error]:not([hidden])');
  assert.match(await page.textContent('[data-status-text]'), /Offline/);
  assert.equal(await page.isVisible('#demo-banner'), false);
  await ctx.close();
});

await browser.close();
server.kill();
console.log(failures ? `\n${failures} test(s) failed` : '\nAll end-to-end tests passed');
process.exit(failures ? 1 : 0);
