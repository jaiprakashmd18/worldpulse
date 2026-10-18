// Production build for Vercel (or any static host): copies the site into
// dist/ and writes dist/js/config.js from environment variables.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { configSource, loadDotEnv } from './config.mjs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);

loadDotEnv();
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const entry of ['index.html', 'css', 'js', 'assets']) {
  cpSync(new URL(entry, root), new URL(entry, dist), { recursive: true });
}
const source = configSource();
writeFileSync(new URL('js/config.js', dist), source);
const live = /"supabaseAnonKey": "[^"]+"/.test(source);
console.log(`Built dist/ in ${live ? 'LIVE (Supabase)' : 'DEMO'} mode.`);
