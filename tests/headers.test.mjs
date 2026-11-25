// The site's response headers (tools/headers.mjs, written by tools/build.mjs as dist/_headers)
// and the CDN fallbacks' integrity hashes (tools/threeloader.mjs). The site sent no
// Content-Security-Policy and no frame protection, so any site could frame the page (which
// signs in with Onshape and posts scores), and a CDN fallback ran whatever bytes it got
// (audit F4). Enforced now: frame-ancestors (this site and Onshape), nosniff, Referrer-Policy.
// Report-only for now: the whole script/worker/connect policy, with each inline script named
// by a hash the build computes from the page it wrote.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inlineScripts, scriptHash, pageHeaders, FRAME_ANCESTORS } from '../tools/headers.mjs';
import { loadThree, ADDONS } from '../tools/threeloader.mjs';
import { handle as roomHandle } from '../functions/room/[[path]].js';
import { handle as lbHandle } from '../functions/leaderboard/[[path]].js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'simbench-headers-'));
const built = spawnSync(process.execPath, ['tools/build.mjs', '--min', '--out', OUT], { cwd: ROOT, encoding: 'utf8' });
test.after(() => fs.rmSync(OUT, { recursive: true, force: true }));

/* _headers as {path: {name: value}} */
function rules(text) {
  const out = {}; let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { cur = out[line.trim()] = {}; continue; }
    const i = line.indexOf(':'); cur[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const sha = (alg, bytes) => alg + '-' + crypto.createHash(alg).update(bytes).digest('base64');

test('headers: every path may be framed only by this site and Onshape, and is never sniffed', () => {
  assert.equal(built.status, 0, built.stderr);
  const text = fs.readFileSync(path.join(OUT, '_headers'), 'utf8');
  const r = rules(text);
  assert.equal(r['/*']['Content-Security-Policy'], `frame-ancestors ${FRAME_ANCESTORS}`);
  assert.equal(FRAME_ANCESTORS, "'self' https://*.onshape.com");
  assert.equal(r['/*']['X-Content-Type-Options'], 'nosniff');
  assert.equal(r['/*']['Referrer-Policy'], 'strict-origin-when-cross-origin');
  // Cloudflare Pages takes at most 2,000 characters a line and 100 rules
  for (const line of text.split('\n')) assert.ok(line.length <= 2000, `a ${line.length}-character line: ${line.slice(0, 60)}`);
  assert.ok(Object.keys(r).length <= 100);
  // the caching that was there stays
  assert.match(r['/index.html']['Cache-Control'], /max-age=0/);
  assert.match(r['/engine-*.js']['Cache-Control'], /immutable/);
});

test('headers: the report-only policy names every inline script of the built page by its hash, and allows no inline script otherwise', () => {
  const r = rules(fs.readFileSync(path.join(OUT, '_headers'), 'utf8'));
  for (const page of ['index.html', 'fragment.html']) {
    const html = fs.readFileSync(path.join(OUT, page), 'utf8');
    const policy = r['/' + page]['Content-Security-Policy-Report-Only'];
    assert.ok(policy, page + ' has a report-only policy');
    const dirs = Object.fromEntries(policy.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    // hashed here independently of tools/headers.mjs: every <script> without src, after the parser's newline rule
    const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter((m) => !/src=/.test(m[1] || ''));
    assert.ok(scripts.length >= 5, `${scripts.length} inline scripts: theme, import map, three loader, shot sim, app`);
    for (const m of scripts) assert.ok(dirs['script-src'].includes(`'${sha('sha256', m[2].replace(/\r\n?/g, '\n'))}'`), `${page}: an inline script ${(m[1] || '').trim()} is named`);
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'data:']) assert.ok(!dirs['script-src'].includes(bad), `script-src has no ${bad}`);
    assert.ok(dirs['script-src'].includes("'wasm-unsafe-eval'"), 'WebAssembly (Jolt, OpenCascade)');
    assert.deepEqual(dirs['worker-src'], ["'self'", 'blob:'], 'the CAD, Monte Carlo and timer workers start from blob: URLs');
    assert.ok(dirs['connect-src'].includes('wss:'), 'the matchmaking relays');
    assert.deepEqual(dirs['object-src'], ["'none'"]);
    assert.deepEqual(dirs['base-uri'], ["'self'"]);
    assert.equal(dirs['frame-ancestors'].join(' '), FRAME_ANCESTORS);
  }
  // the root path is the same page
  assert.equal(r['/']['Content-Security-Policy-Report-Only'], r['/index.html']['Content-Security-Policy-Report-Only']);
  // Pages redirects /fragment.html to /fragment and serves the page there: that path needs the policy too
  assert.equal(r['/fragment']['Content-Security-Policy-Report-Only'], r['/fragment.html']['Content-Security-Policy-Report-Only']);
});

test('headers: the hash is the one a browser computes (CR LF read as LF), and src= scripts are not hashed', () => {
  const page = '<script>a\r\nb\rc</script><script src="x.js"></script><script type="module">d</script>';
  assert.deepEqual(inlineScripts(page), ['a\nb\nc', 'd']);
  assert.equal(scriptHash('a\nb\nc'), `'${sha('sha256', 'a\nb\nc')}'`);
  assert.match(pageHeaders(page), new RegExp(scriptHash('d').replace(/[+/]/g, '\\$&')));
});

test('integrity: every CDN fallback that is a published file carries the hash of the file the build vendors', async () => {
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
  const sri = map.integrity || {};
  // what the three.js loader asks jsDelivr for when the site's copy is gone
  const asked = [];
  await loadThree(async (u) => { asked.push(u); if (!/jsdelivr/.test(u)) throw new Error('down'); return /module/.test(u) ? { WebGLRenderer() {} } : {}; }, '0.186.1', ADDONS, 'https://site.test/v/');
  const cdn = asked.filter((u) => /cdn\.jsdelivr\.net/.test(u));
  assert.ok(cdn.length >= 1 + ADDONS.length);
  const jolt = /cdn:"(https:\/\/cdn\.jsdelivr\.net\/npm\/jolt-physics@[^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'src', 'joltmech.js'), 'utf8'))[1];
  for (const u of cdn.concat([jolt, 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.core.js'])) {
    assert.ok(sri[u], 'integrity for ' + u);
    const rel = u.replace(/^https:\/\/cdn\.jsdelivr\.net\/npm\/([^@]+)@[^/]+\//, '$1/');
    assert.equal(sri[u], sha('sha384', fs.readFileSync(path.join(ROOT, 'node_modules', rel))), u);
  }
  // and every add-on's own relative imports
  for (const u of Object.keys(sri)) assert.ok(fs.existsSync(path.join(ROOT, 'node_modules', u.replace(/^https:\/\/cdn\.jsdelivr\.net\/npm\/([^@]+)@[^/]+\//, '$1/'))), u);
  assert.ok(!Object.keys(sri).some((u) => /\.min\.js$|esm\.sh|\+esm/.test(u)), 'nothing the CDN builds itself (no hash could hold)');
});

test('functions: their answers are not sniffed either (Pages applies _headers only to files)', async () => {
  const r = await roomHandle(new Request('https://sb.example/room/health'), {});
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  const l = await lbHandle(new Request('https://sb.example/leaderboard/teleop'), {});
  assert.equal(l.headers.get('X-Content-Type-Options'), 'nosniff');
  const on = fs.readFileSync(path.join(ROOT, 'functions', 'onshape', '[[path]].js'), 'utf8');
  assert.match(on, /"Content-Type": "text\/html; charset=utf-8"[^}]*\.\.\.NOSNIFF, "Content-Security-Policy": "frame-ancestors 'self' https:\/\/\*\.onshape\.com"/, 'the sign-in page');
});
