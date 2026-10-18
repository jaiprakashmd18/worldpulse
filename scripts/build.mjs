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
// Environment variables win; otherwise keep the committed js/config.js.
if (process.env.WORLDPULSE_SUPABASE_URL || process.env.SUPABASE_URL) {
  writeFileSync(new URL('js/config.js', dist), configSource());
  console.log('Built dist/ with config from environment variables.');
} else {
  console.log('Built dist/ with the committed js/config.js.');
}
