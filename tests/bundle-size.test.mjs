// Size ratchet: the shipped page (npm run build:ship) may not grow past the budget stored in
// tests/bundle-budget.json. Every file in dist/ has its own limit (current size plus 10 %), and
// so does the total, so a library or a robot file added by accident fails here, not on a school
// network's first load. The libraries the page serves itself (dist/vendor/) are checked too:
// every file the import map and the loaders name must really be in the build.
//
// Raising a budget on purpose: look at what grew, then run
//   UPDATE_BUNDLE_BUDGET=1 node --test tests/bundle-size.test.mjs        (PowerShell: $env:UPDATE_BUNDLE_BUDGET=1)
// and commit tests/bundle-budget.json with a line in the commit saying why.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ADDONS, VENDOR_THREE, VENDOR_TRYSTERO, importMap } from '../tools/threeloader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// build.mjs is a script (importing it would build), so its version constants are read from the source
const buildSrc = fs.readFileSync(path.join(ROOT, 'tools', 'build.mjs'), 'utf8');
const ver = (name) => new RegExp(`export const ${name} = '([^']+)'`).exec(buildSrc)[1];
const THREE_VERSION = ver('THREE_VERSION'), TRYSTERO_VERSION = ver('TRYSTERO_VERSION'), JOLT_VERSION = ver('JOLT_VERSION'), OCCT_VERSION = ver('OCCT_VERSION');
const BUDGET_FILE = path.join(ROOT, 'tests', 'bundle-budget.json');
const HEADROOM = 1.10;
const PAGES_FILE_LIMIT = 25 * 1024 * 1024;   // Cloudflare Pages refuses a file over 25 MiB

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'simbench-size-'));
const built = spawnSync(process.execPath, ['tools/build.mjs', '--min', '--out', OUT], { cwd: ROOT, encoding: 'utf8' });

/* every file under dir as { 'posix/relative/path': bytes }; the worker's engine-<hash>.js is one entry, "engine-*.js" */
function sizes(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out[path.relative(dir, f).split(path.sep).join('/').replace(/^engine-[0-9a-f]{8}\.js$/, 'engine-*.js')] = fs.statSync(f).size;
    }
  };
  walk(dir);
  return out;
}
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

test('size ratchet: the ship build succeeds', () => {
  assert.equal(built.status, 0, built.stdout + built.stderr);
});

test('size ratchet: no dist file, and not the total, passes its stored budget', () => {
  const now = sizes(OUT);
  const total = Object.values(now).reduce((a, b) => a + b, 0);
  if (process.env.UPDATE_BUNDLE_BUDGET) {
    const files = {};
    for (const k of Object.keys(now).sort()) files[k] = Math.ceil(now[k] * HEADROOM / 1024) * 1024;
    fs.writeFileSync(BUDGET_FILE, JSON.stringify({
      note: 'Largest size in bytes each file of the ship build (npm run build:ship) may have: its size when set, plus 10 %. See tests/bundle-size.test.mjs for how to raise one.',
      total: Math.ceil(total * HEADROOM / 1024) * 1024, files,
    }, null, 2) + '\n');
    return;
  }
  const budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
  const how = '\nIf the growth is on purpose, raise the budget: UPDATE_BUNDLE_BUDGET=1 node --test tests/bundle-size.test.mjs ' +
    '(PowerShell: $env:UPDATE_BUNDLE_BUDGET=1 first), then commit tests/bundle-budget.json and say why in the commit.';
  const over = [];
  for (const [f, n] of Object.entries(now)) {
    if (n > PAGES_FILE_LIMIT) over.push(`${f} is ${kb(n)}, over Cloudflare Pages' 25 MiB limit per file`);
    const max = budget.files[f];
    if (max == null) over.push(`${f} (${kb(n)}) is a new file with no budget`);
    else if (n > max) over.push(`${f} grew to ${kb(n)}, budget ${kb(max)}`);
  }
  if (total > budget.total) over.push(`the whole of dist/ is ${kb(total)}, budget ${kb(budget.total)}`);
  assert.deepEqual(over, [], over.join('\n') + how);
});

test('size ratchet: the main page is one file well under its budget and loads no CDN script first', () => {
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  // the import map is what lets the page start from its own copy of three.js
  assert.match(html, /<script type="importmap">/);
  assert.ok(!/<script[^>]+src="https?:\/\/(cdn\.jsdelivr|esm\.sh)/.test(html), 'a CDN <script src> would block the first load');
});

test('vendor: every file the page names is in the build, and every import inside them resolves', () => {
  const missing = [];
  const need = (rel) => { if (!fs.existsSync(path.join(OUT, rel))) missing.push(rel); };
  // the import map
  for (const v of Object.values(importMap(THREE_VERSION, TRYSTERO_VERSION).imports)) need(v.replace(/^\.\//, ''));
  // the loaders in src/ (a version bump in only one place would leave one of them on the CDN)
  const t3 = VENDOR_THREE(THREE_VERSION);
  for (const [, p] of ADDONS) need(t3 + 'examples/jsm/' + p);
  need(VENDOR_TRYSTERO(TRYSTERO_VERSION) + 'index.mjs');
  need(`vendor/jolt-physics-${JOLT_VERSION}/jolt-physics.wasm-compat.js`);
  for (const f of ['occt-import-js.js', 'occt-import-js.wasm']) need(`vendor/occt-import-js-${OCCT_VERSION}/${f}`);
  // each vendored module's relative imports
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(path.join(OUT, 'vendor')).filter((x) => /\.m?js$/.test(x) && !/jolt|occt/.test(x))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
      if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) missing.push(`${path.relative(OUT, f)} imports ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
  // src/ names the same versions as the build
  const src = (n) => fs.readFileSync(path.join(ROOT, 'src', n), 'utf8');
  assert.ok(src('joltmech.js').includes(`jolt-physics-${JOLT_VERSION}/`) && src('joltmech.js').includes(`jolt-physics@${JOLT_VERSION}/`));
  assert.ok(src('net.js').includes(`trystero-${TRYSTERO_VERSION}/`) && src('net.js').includes(`trystero@${TRYSTERO_VERSION}`));
  assert.ok(src('tessellate.js').includes(`occt-import-js-${OCCT_VERSION}/`) && src('tessellate.js').includes(`occt-import-js@${OCCT_VERSION}/`));
});

test('vendor: the _headers file caches the versioned folder for good, and the page never', () => {
  const h = fs.readFileSync(path.join(OUT, '_headers'), 'utf8');
  assert.match(h, /\/vendor\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  assert.match(h, /\/index\.html\n\s+Cache-Control: public, max-age=0, must-revalidate/);
});

test.after(() => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* a temp folder */ } });
