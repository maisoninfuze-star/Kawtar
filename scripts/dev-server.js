#!/usr/bin/env node
/* Local dev server: static files + api/*.js functions with Vercel-style req/res.
   Loads .env.local. Usage: node scripts/dev-server.js [port]   (default 8176) */
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const ROOT = path.join(__dirname, '..');
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/i); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
process.env.SITE_URL = process.env.SITE_URL_DEV || `http://localhost:${process.argv[2] || 8176}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webp': 'image/webp', '.ttf': 'font/ttf' };

function resHelpers(res) {
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  res.send = s => { res.end(s); return res; };
  return res;
}
async function readBody(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks); const ct = req.headers['content-type'] || '';
  if (!raw.length) return undefined;
  if (ct.includes('application/json')) { try { return JSON.parse(raw.toString('utf8')); } catch { return raw.toString('utf8'); } }
  return raw.toString('utf8');
}
http.createServer(async (req, res) => {
  const u = url.parse(req.url, true); resHelpers(res);
  if (u.pathname.startsWith('/api/')) {
    const file = path.join(ROOT, u.pathname.replace(/\/$/, '') + '.js');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'no_such_function' });
    delete require.cache[require.resolve(file)];
    const fn = require(file); req.query = u.query;
    const raw = (fn.config && fn.config.api && fn.config.api.bodyParser === false);
    if (!raw) req.body = await readBody(req);
    try { await fn(req, res); } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'crash', message: e.message }); }
    return;
  }
  let p = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream'); res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(p).pipe(res);
}).listen(process.argv[2] || 8176, () => console.log('dev server → http://localhost:' + (process.argv[2] || 8176)));
