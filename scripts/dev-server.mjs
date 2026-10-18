// Local development server. Serves the project root with the same security
// headers as vercel.json, and builds js/config.js from .env on the fly.
// Usage: node scripts/dev-server.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configSource, loadDotEnv } from './config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 5173);
const vercel = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const globalHeaders = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const allowed = /^\/(index\.html|css\/|js\/|assets\/)/;

loadDotEnv();

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = path === '/' ? '/index.html' : path;
  try {
    if (!allowed.test(file) || file.includes('..')) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    const body = file === '/js/config.js' && (process.env.WORLDPULSE_SUPABASE_URL || process.env.SUPABASE_URL)
      ? configSource()
      : await readFile(join(root, file));
    res.writeHead(200, { ...globalHeaders, 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}).listen(port, () => console.log(`WorldPulse running at http://localhost:${port}`));
