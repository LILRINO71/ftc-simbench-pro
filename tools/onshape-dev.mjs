// The site on this computer WITH the Onshape link working, for watching a real import end to end
// before a change ships. It serves dist/ and answers /onshape/* with the real relay
// (functions/onshape/[[path]].js), so the page, the engine worker and the relay all run as they do
// live. The one stand-in is Onshape's sign-in: there is no OAuth app for localhost, so "Allow" is
// answered here, and the relay's calls to cad.onshape.com are signed with YOUR API key instead.
//
//   npm run build
//   ONSHAPE_ACCESS_KEY=… ONSHAPE_SECRET_KEY=… node tools/onshape-dev.mjs [port] [--env <file>] [--keep <dir>] [--log <file>]
//
//   --env   a file of KEY=value lines to take the two keys from (never printed, never committed)
//   --keep  a folder to keep Onshape's answers in, so a second run of the same robot costs no calls
//   --log   a file to add one line per real call to (the yearly allowance is 2,500 on a free plan)
//
// Open http://localhost:<port>/ and paste an assembly's address, or open
// http://localhost:<port>/?onshape=<the address, encoded> to try the launch from Onshape.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { handle } from '../functions/onshape/[[path]].js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const port = +(args.find((a) => /^\d+$/.test(a)) || 8790);
const envFile = opt('--env'), keep = opt('--keep'), logFile = opt('--log');
const keys = { ...process.env };
if (envFile) for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m) keys[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
if (!keys.ONSHAPE_ACCESS_KEY || !keys.ONSHAPE_SECRET_KEY) { console.error('Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY (or --env <file>).'); process.exit(1); }
const basic = 'Basic ' + Buffer.from(keys.ONSHAPE_ACCESS_KEY + ':' + keys.ONSHAPE_SECRET_KEY).toString('base64');
if (keep) fs.mkdirSync(keep, { recursive: true });

const stats = { calls: 0, kept: 0, byStatus: {}, ms: 0 };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.png': 'image/png', '.svg': 'image/svg+xml', '.java': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

/* what the relay fetches: Onshape's token server (answered here) and its API (the real one, with the key) */
async function upstream(url, init) {
  url = String(url);
  if (url.startsWith('https://oauth.onshape.com/')) return new Response(JSON.stringify({ access_token: 'dev-token', refresh_token: 'dev-refresh', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (!url.startsWith('https://cad.onshape.com/api/')) return new Response('{}', { status: 502 });
  const file = keep ? path.join(keep, crypto.createHash('sha256').update(url).digest('hex').slice(0, 32) + '.json') : null;
  if (file && fs.existsSync(file)) { stats.kept++; return new Response(fs.readFileSync(file), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  const t0 = Date.now();
  const r = await fetch(url, { headers: { Authorization: basic, Accept: 'application/json' } });
  const body = Buffer.from(await r.arrayBuffer());
  stats.calls++; stats.byStatus[r.status] = (stats.byStatus[r.status] || 0) + 1; stats.ms += Date.now() - t0;
  const p = new URL(url).pathname;
  if (logFile) fs.appendFileSync(logFile, new Date().toLocaleString('sv-SE') + ' GET ' + p + '\n');
  console.log(r.status, ((Date.now() - t0) / 1000).toFixed(1) + ' s', (body.length / 1e6).toFixed(2) + ' MB', p.slice(0, 100));
  // only what never changes is kept: a Part Studio or an assembly at a version or a microversion
  if (file && r.ok && /\/[vm]\/[0-9a-f]{24}\/e\//i.test(p)) fs.writeFileSync(file, body);
  return new Response(body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
}

const env = { ONSHAPE_CLIENT_ID: 'dev', ONSHAPE_CLIENT_SECRET: 'dev-secret-' + port };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:' + port);
    if (url.pathname === '/onshape-dev/stats') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(stats)); return; }
    if (url.pathname.startsWith('/onshape/')) {
      const out = await handle(new Request(url, { method: req.method, headers: req.headers }), env, upstream);
      const headers = {}; out.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      // a cookie marked Secure is refused over plain http by some browsers, and this is localhost
      const cookies = out.headers.getSetCookie().map((c) => c.replace(/; Secure/i, ''));
      // Onshape's Allow page: nobody to ask here, so it is answered straight away
      const to = out.headers.get('Location');
      if (out.status === 302 && to && to.startsWith('https://oauth.onshape.com/')) headers.location = '/onshape/callback?code=dev&state=' + encodeURIComponent(new URL(to).searchParams.get('state'));
      if (cookies.length) headers['set-cookie'] = cookies;
      res.writeHead(out.status, headers); res.end(Buffer.from(await out.arrayBuffer())); return;
    }
    let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
    let file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(500); res.end(String(e && e.message || e)); }
}).listen(port, () => console.log('SimBench with the Onshape link on http://localhost:' + port + '/'));
