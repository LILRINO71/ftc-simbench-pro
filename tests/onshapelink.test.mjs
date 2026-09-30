// The "Send to SimBench" bookmark (src/onshapelink.js), run against a stand-in
// Onshape tab that serves the `mated` robot's assembly definition and mate
// features the way Onshape's API does. What it opens SimBench with has to
// unpack to exactly those two documents, and they have to rebuild the robot's
// joints on its STEP. A too-big assembly becomes one file to drop instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, engineBundle } from './load.mjs';
import { minifyJS } from '../tools/minify.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();
const R = buildRobot('mated');
const D = 'a'.repeat(24), W = 'b'.repeat(24), EL = 'c'.repeat(24);
const PAGE = `https://cad.onshape.com/documents/${D}/w/${W}/e/${EL}`;
const SB = 'https://ftc-simbench-pro.pages.dev/';

/* A browser tab on Onshape, just enough for the bookmark: the page address and
   title, fetch answering the two API calls, window.open, alert, a download. */
function onshapeTab({ href = PAGE, asm = R.onshape.assembly, features = R.onshape.features, popups = true } = {}) {
  const t = { fetched: [], alerts: [], opened: [], downloads: [] };
  const popup = { closed: false, location: { href: '' }, document: { title: '', body: { innerHTML: '', querySelector: () => ({}) } }, close() { this.closed = true; } };
  t.popup = popup;
  t.env = {
    location: { href },
    document: { title: 'Robot 2026 | Onshape', body: { appendChild() {} },
      createElement: () => { const a = { click() { t.downloads.push({ name: a.download, href: a.href }); }, remove() {} }; return a; } },
    window: { open: (u, n) => { t.opened.push([u, n]); return popups ? (u ? { closed: false, location: { href: u } } : popup) : null; } },
    fetch: async (u, o) => {
      t.fetched.push({ u, cred: o && o.credentials });
      const body = /\/features$/.test(u) ? features : asm;
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
    },
    alert: (m) => t.alerts.push(m),
    URL: { createObjectURL: (b) => b },
  };
  return t;
}
async function click(engine, tab) {
  const href = engine.onshapeBookmarklet(SB);
  assert.ok(href.startsWith('javascript:'));
  const code = decodeURIComponent(href.slice('javascript:'.length));
  const names = Object.keys(tab.env);
  new Function(...names, code)(...names.map((k) => tab.env[k]));
  for (let i = 0; i < 200 && !tab.popup.location.href && !tab.alerts.length && !tab.downloads.length; i++) await new Promise((r) => setTimeout(r, 10));
}

test('bookmark: reads the assembly with the team own sign-in and opens SimBench with it in the #fragment', async () => {
  const tab = onshapeTab();
  await click(E, tab);
  assert.deepEqual(tab.alerts, []);
  // the same two API pages the manual steps open, with the browser's own cookies
  const L = E.onshapeApiLinks(PAGE);
  assert.deepEqual(tab.fetched.map((f) => f.u).sort(), [L.def, L.features].sort());
  assert.ok(tab.fetched.every((f) => f.cred === 'include'));
  // the tab it opened at the click is sent to SimBench, the robot in the fragment only
  const to = tab.popup.location.href;
  assert.ok(to.startsWith(SB + '#onshape='), to.slice(0, 80));
  const p = await E.readOnshapeHash(to.split('#onshape=')[1]);
  assert.deepEqual(p.asm, R.onshape.assembly);
  assert.deepEqual(p.features, R.onshape.features);
  assert.equal(p.name, 'Robot 2026');
  assert.equal(p.url, PAGE);
  // and those rebuild the robot's joints on its STEP
  const rep = E.applyOnshapeMates(E.parseSTEP(R.text), p.asm, { features: p.features });
  assert.equal(rep.matched, R.truth.leafParts);
  assert.equal(rep.joints, R.truth.joints.length);
});

test('bookmark: the ship build (minified) makes a bookmark that works the same', async () => {
  const M = loadEngine(minifyJS(engineBundle()));
  const tab = onshapeTab();
  await click(M, tab);
  const p = await E.readOnshapeHash(tab.popup.location.href.split('#onshape=')[1]);
  assert.deepEqual(p.asm, R.onshape.assembly);
});

test('bookmark: an assembly too big for an address is saved as one file to drop in', async () => {
  // incompressible filler: a 5 MB assembly definition
  let seed = 7; const junk = Array.from({ length: 600000 }, () => ((seed = (seed * 48271) % 2147483647) % 1e9).toString(36));
  const asm = Object.assign({}, R.onshape.assembly, { filler: junk });
  const tab = onshapeTab({ asm });
  await click(E, tab);
  assert.equal(tab.downloads.length, 1);
  assert.equal(tab.downloads[0].name, 'Robot 2026.onshape.json');
  const p = E.checkOnshapePayload(JSON.parse(await tab.downloads[0].href.text()));
  assert.equal(p.asm.filler.length, junk.length);
  assert.ok(/Drop it into SimBench/.test(tab.alerts[0]));
  assert.ok(tab.popup.closed, 'the waiting tab is closed');
});

test('bookmark: not on an assembly page, it says so and reads nothing', async () => {
  const tab = onshapeTab({ href: 'https://cad.onshape.com/documents?nodeId=x' });
  await click(E, tab);
  assert.equal(tab.fetched.length, 0);
  assert.ok(/Open your robot's assembly/.test(tab.alerts[0]));
});

test('bookmark: a Part Studio tab (no assembly definition) is refused with a message', async () => {
  const tab = onshapeTab({ asm: { message: 'not an assembly' } });
  await click(E, tab);
  assert.ok(/isn't an assembly/.test(tab.alerts[0]), tab.alerts[0]);
  assert.ok(tab.popup.closed);
});

test('SimBench side: a damaged or foreign #fragment is refused, and only the two documents are kept', async () => {
  await assert.rejects(E.readOnshapeHash('%%%not base64'), /damaged/);
  await assert.rejects(E.readOnshapeHash('aGVsbG8'), /damaged/);           // base64, not gzip
  assert.throws(() => E.checkOnshapePayload({ format: 'something else', asm: { rootAssembly: {} } }), /isn't mates/);
  assert.throws(() => E.checkOnshapePayload({ format: E.ONSHAPE_FORMAT, asm: {} }), /no assembly/);
  const p = E.checkOnshapePayload({ format: E.ONSHAPE_FORMAT, asm: { rootAssembly: {} }, features: 'x', name: 'n'.repeat(999), url: 'https://evil.example/x', extra: 1 });
  assert.equal(p.features, null); assert.equal(p.url, ''); assert.equal(p.name.length, 200); assert.equal(p.extra, undefined);
});
