// Reading the same Onshape robot again (src/onshapelink.js onshapeRead with a
// cache): part studios at a version or microversion never change, so the
// second read costs the two assembly calls, not two more per part studio.
// That matters: a private Onshape app has 2,500 calls a year.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();
const R = buildRobot('mated');

/* Onshape's API, as far as the reader asks it: the mated robot's assembly, features and each part studio */
function fakeOnshape() {
  const calls = [];
  const studios = new Map();
  for (const k in R.onshape.geom) studios.set(k, R.onshape.geom[k]);
  const fetch = async (u) => {
    calls.push(u);
    const json = (v) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => v });
    if (/\/assemblies\/.*\/features$/.test(u)) return json(R.onshape.features);
    if (/\/assemblies\//.test(u)) return json(R.onshape.assembly);
    const m = /\/partstudios\/d\/([^/]+)\/(v|m)\/([^/]+)\/e\/([^/?]+)\/(tessellatedfaces|massproperties)\?configuration=([^&]*)/.exec(u);
    if (!m) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
    const key = m[1] + '/' + m[2] + '/' + m[3] + '/e/' + m[4] + '|' + decodeURIComponent(m[6]);
    const g = studios.get(key);
    if (m[5] === 'massproperties') return json({ bodies: Object.fromEntries(Object.entries((g && g.mass) || {}).map(([id, v]) => [id, { mass: [v.kg] }])) });
    return json(Object.entries((g && g.parts) || {}).map(([id, p]) => ({ id, name: p.name, faces: [{ color: p.color, facets: chunk(p.tri) }] })));
  };
  const chunk = (t) => { const out = []; for (let i = 0; i < t.length; i += 9) out.push({ vertices: [[t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]] }); return out; };
  return { calls, fetch };
}
const ref = { did: R.onshape.assembly.rootAssembly.documentId || 'd'.repeat(24), wvm: 'w', wvmid: 'w'.repeat(24), eid: 'e'.repeat(24) };

test('onshape: a second read of the same robot comes from the cache: two calls, the same robot', async () => {
  const api = fakeOnshape(), real = globalThis.fetch;
  const store = new Map(), cache = { get: async (k) => store.get(k) || null, put: async (k, v) => { store.set(k, v); } };
  globalThis.fetch = api.fetch;
  try {
    const first = await E.onshapeRead('https://cad.onshape.com', ref, { cache });
    const n1 = api.calls.length;
    const studios = Object.keys(first.geom).length, subs = Object.keys(first.featuresBy || {}).length;
    assert.equal(n1, 2 + 2 * studios + subs, 'first read: the assembly, its features, two per part studio and each subassembly limits');
    assert.equal(store.size, studios + subs);
    const second = await E.onshapeRead('https://cad.onshape.com', ref, { cache });
    assert.equal(api.calls.length - n1, 2, 'second read: only the assembly and its features');
    assert.equal(second.cached, studios);
    const a = E.cadFromOnshape({ name: 'x', asm: first.asm, features: first.features, geom: first.geom });
    const b = E.cadFromOnshape({ name: 'x', asm: second.asm, features: second.features, geom: second.geom });
    assert.equal(b.solids.length, a.solids.length);
    assert.deepEqual(b.mechs.map((m) => m.id), a.mechs.map((m) => m.id));
  } finally { globalThis.fetch = real; }
});

test('onshape: a cache that fails never stops the read', async () => {
  const api = fakeOnshape(), real = globalThis.fetch;
  const broken = { get: () => { throw new Error('no'); }, put: () => Promise.reject(new Error('full')) };
  globalThis.fetch = api.fetch;
  try {
    const r = await E.onshapeRead('https://cad.onshape.com', ref, { cache: broken });
    assert.ok(Object.values(r.geom).every((g) => g && g.parts));
  } finally { globalThis.fetch = real; }
});

test('onshape: no IndexedDB (a private window, Node) means no cache, quietly', () => {
  assert.equal(E.onshapeGeomCache(null), null);
});
