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
   title, fetch answering the API (the assembly, its features, and per part
   studio its tessellated faces and mass properties, shaped like Onshape's),
   window.open, postMessage both ways, alert, a download. */
const hex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
function studioOf(u) {
  const m = /\/partstudios\/d\/(\w+)\/(v|m)\/(\w+)\/e\/(\w+)\/(tessellatedfaces|massproperties)\?configuration=([^&]*)/.exec(u);
  if (!m) return null;
  const key = m[1] + '/' + m[2] + '/' + m[3] + '/e/' + m[4] + '|' + decodeURIComponent(m[6]);
  return { key, what: m[5], g: R.onshape.geom[key] };
}
function apiAnswer(u, asm, features) {
  const st = studioOf(u);
  if (st) {
    if (!st.g) return null;
    if (st.what === 'massproperties') return { bodies: Object.fromEntries(Object.entries(st.g.mass).map(([k, v]) => [k, { mass: [v.kg, v.kg, v.kg], centroid: [0, 0, 0] }])) };
    return Object.entries(st.g.parts).map(([id, b]) => {
      const facets = []; for (let i = 0; i < b.tri.length; i += 9) facets.push({ vertices: [b.tri.slice(i, i + 3), b.tri.slice(i + 3, i + 6), b.tri.slice(i + 6, i + 9)] });
      return { id, name: b.name, faces: [{ color: b.color ? hex(b.color) : null, facets }] };
    });
  }
  return /\/features$/.test(u) ? features : asm;
}
function onshapeTab({ href = PAGE, asm = R.onshape.assembly, features = R.onshape.features, popups = true, answers = true } = {}) {
  const t = { fetched: [], alerts: [], opened: [], downloads: [], got: [], listeners: [] };
  const popup = { closed: false, location: { href: '' }, close() { this.closed = true; },
    postMessage(d, origin) { if (d && d.type === 'simbench-progress') return; t.got.push({ d, origin }); } };
  t.popup = popup;
  const win = { open: (u, n) => { t.opened.push([u, n]); if (!popups) return null; popup.location.href = u; return popup; },
    addEventListener: (ev, f) => { if (ev === 'message') t.listeners.push(f); } };
  t.env = {
    location: { href },
    document: { title: 'Robot 2026 | Onshape', body: { appendChild() {} },
      createElement: () => { const a = { click() { t.downloads.push({ name: a.download, href: a.href }); }, remove() {} }; return a; } },
    window: win,
    fetch: async (u, o) => {
      t.fetched.push({ u, cred: o && o.credentials });
      const body = apiAnswer(u, asm, features);
      if (body == null) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
    },
    alert: (m) => t.alerts.push(m),
    URL: Object.assign(function (u) { return new URL(u); }, { createObjectURL: (b) => b }),
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 50)),
  };
  // the SimBench tab, once open, says it's ready (from its own origin)
  if (answers) setTimeout(() => t.listeners.forEach((f) => f({ origin: new URL(SB).origin, data: { type: 'simbench-ready' } })), 5);
  return t;
}
async function click(engine, tab) {
  const href = engine.onshapeBookmarklet(SB);
  assert.ok(href.startsWith('javascript:'));
  const code = decodeURIComponent(href.slice('javascript:'.length));
  const names = Object.keys(tab.env);
  new Function(...names, code)(...names.map((k) => tab.env[k]));
  for (let i = 0; i < 400 && !tab.got.length && !tab.alerts.length && !tab.downloads.length; i++) await new Promise((r) => setTimeout(r, 10));
}

test('bookmark: reads the whole robot with the team\'s own sign-in and hands it to the SimBench tab', async () => {
  const tab = onshapeTab();
  await click(E, tab);
  assert.deepEqual(tab.alerts, []);
  const L = E.onshapeApiLinks(PAGE);
  const urls = tab.fetched.map((f) => f.u);
  assert.ok(urls.some((u) => u.startsWith(L.def.split('?')[0] + '?')), 'the assembly definition');
  assert.ok(urls.includes(L.features), 'its features (mate limits)');
  // each part studio once, however many times its parts are used
  const studios = Object.keys(R.onshape.geom);
  assert.equal(urls.filter((u) => /tessellatedfaces/.test(u)).length, studios.length);
  assert.equal(urls.filter((u) => /massproperties/.test(u)).length, studios.length);
  assert.ok(tab.fetched.every((f) => f.cred === 'include'));
  // it opened SimBench waiting, and posted the robot only to SimBench's own origin
  assert.ok(tab.popup.location.href.startsWith(SB + '#onshape-wait'));
  assert.equal(tab.got.length, 1);
  assert.equal(tab.got[0].origin, new URL(SB).origin);
  const p = E.checkOnshapePayload(tab.got[0].d);
  assert.deepEqual(p.asm, R.onshape.assembly);
  assert.equal(p.name, 'Robot 2026');
  // and that is the whole robot: every part with its shape, every joint from a mate
  const cad = E.cadFromOnshape(p);
  assert.equal(cad.solids.length, R.truth.leafParts);
  assert.equal(cad.mechs.filter((m) => m.fromMate).length, R.truth.joints.length);
  assert.ok(Math.abs(cad.onshape.kg - R.truth.massKg) < 1e-3);
});

test('bookmark: the ship build (minified) makes a bookmark that works the same', async () => {
  const M = loadEngine(minifyJS(engineBundle()));
  const tab = onshapeTab();
  await click(M, tab);
  const p = E.checkOnshapePayload(tab.got[0].d);
  assert.deepEqual(p.asm, R.onshape.assembly);
  assert.equal(E.cadFromOnshape(p).solids.length, R.truth.leafParts);
});

test('bookmark: no SimBench tab (pop-ups blocked) saves the whole robot as one file to drop in', async () => {
  const tab = onshapeTab({ popups: false, answers: false });
  await click(E, tab);
  assert.equal(tab.downloads.length, 1);
  assert.equal(tab.downloads[0].name, 'Robot 2026.onshape.json');
  const p = E.checkOnshapePayload(JSON.parse(await tab.downloads[0].href.text()));
  assert.ok(/Drop it into SimBench/.test(tab.alerts[0]));
  assert.equal(E.cadFromOnshape(p).solids.length, R.truth.leafParts);
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
  // gzip that's cut off half way: refused, not waited on for ever
  const whole = (await import('node:zlib')).gzipSync(JSON.stringify({ format: E.ONSHAPE_FORMAT, asm: { rootAssembly: {} } }));
  const cut = Buffer.from(whole.subarray(0, whole.length - 12)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await assert.rejects(E.readOnshapeHash(cut), /damaged/);
  assert.throws(() => E.checkOnshapePayload({ format: 'something else', asm: { rootAssembly: {} } }), /isn't mates/);
  assert.throws(() => E.checkOnshapePayload({ format: E.ONSHAPE_FORMAT, asm: {} }), /no assembly/);
  const p = E.checkOnshapePayload({ format: E.ONSHAPE_FORMAT, asm: { rootAssembly: {} }, features: 'x', name: 'n'.repeat(999), url: 'https://evil.example/x', extra: 1 });
  assert.equal(p.features, null); assert.equal(p.url, ''); assert.equal(p.name.length, 200); assert.equal(p.extra, undefined);
});
