// The pasted-link import (src/onshapelink.js, src/onshapecad.js): a team pastes
// its assembly's address and the robot is read from Onshape's API, through the
// sign-in relay, with no export. Onshape here is a stand-in serving the `mated`
// corpus robot the way the API does (the assembly definition, its features, and
// per Part Studio the tessellated faces and mass properties). What has to hold:
// the address is read as copied (configuration included), each Part Studio is
// read once, every part arrives as a placed copy of one thinned shape, the mates
// are the joints, and the rigid links' mass properties are Onshape's own, summed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();
const R = buildRobot('mated');
const D = 'a'.repeat(24), W = 'b'.repeat(24), EL = 'c'.repeat(24);
const LINK = `https://cad.onshape.com/documents/${D}/w/${W}/e/${EL}`;
const HOST = 'https://sb.test/onshape';

/* Onshape's API behind the relay: per part, a tensor about its centroid so the
   link sums can be checked; a part placed twice shares its Part Studio. */
const studioOf = (u) => {
  const m = /\/partstudios\/d\/(\w+)\/(v|m)\/(\w+)\/e\/(\w+)\/(tessellatedfaces|massproperties)\?configuration=([^&]*)/.exec(u);
  return m && { key: m[1] + '/' + m[2] + '/' + m[3] + '/e/' + m[4] + '|' + decodeURIComponent(m[6]), what: m[5] };
};
const tensorOf = (kg) => [kg * 1e-3, 0, 0, 0, kg * 2e-3, 0, 0, 0, kg * 3e-3];
function onshape({ asm = R.onshape.assembly, features = R.onshape.features, busy = 0, hasMass = true } = {}) {
  const o = { calls: [] };
  o.fetch = async (u, init) => {
    o.calls.push({ u, init });
    if (o.calls.length <= busy) return { ok: false, status: 429, headers: { get: (h) => (h === 'Retry-After' ? '0' : null) }, json: async () => ({}) };
    const st = studioOf(u);
    let body = null;
    if (st) {
      const g = R.onshape.geom[st.key];
      if (g) {
        if (st.what === 'massproperties') body = { bodies: Object.fromEntries(Object.entries(g.mass).map(([k, v]) => [k, hasMass
          ? { hasMass: true, mass: [v.kg, v.kg, v.kg], volume: [v.kg / 2700, v.kg / 2700, v.kg / 2700], centroid: [0.01, 0.02, 0.03, 0.01, 0.02, 0.03, 0.01, 0.02, 0.03], inertia: tensorOf(v.kg).concat(tensorOf(v.kg), tensorOf(v.kg)) }
          : { hasMass: false, mass: [0, 0, 0], volume: [v.kg / 2700, v.kg / 2700, v.kg / 2700], centroid: [0.01, 0.02, 0.03], inertia: tensorOf(v.kg / 2700).concat(tensorOf(v.kg / 2700), tensorOf(v.kg / 2700)) }])) };
        else body = Object.entries(g.parts).map(([id, b]) => {
          const facets = []; for (let i = 0; i < b.tri.length; i += 9) facets.push({ vertices: [0, 3, 6].map((k) => ({ x: b.tri[i + k], y: b.tri[i + k + 1], z: b.tri[i + k + 2] })) });
          return { id, name: b.name, faces: [{ appearance: b.color ? { color: b.color.map((v) => String(Math.round(v * 255))), opacity: 255 } : null, facets }] };
        });
      }
    } else if (/\/features(\?|$)/.test(u)) body = features;
    else if (u.startsWith(HOST + `/api/assemblies/d/${D}/w/${W}/e/${EL}`)) body = asm;
    if (body == null) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  return o;
}
const read = (os, href = LINK) => E.onshapeRead(HOST, E.onshapeRef(href), { fetch: os.fetch, say() {} });

test('link: the assembly, its features and each Part Studio once, through the relay, with the browser\'s own cookies', async () => {
  const os = onshape();
  const p = await read(os);
  const urls = os.calls.map((c) => c.u);
  assert.ok(urls[0].startsWith(HOST + `/api/assemblies/d/${D}/w/${W}/e/${EL}?`) && /excludeSuppressed=true/.test(urls[0]), 'the definition, suppressed parts left out');
  assert.ok(urls.includes(HOST + `/api/assemblies/d/${D}/w/${W}/e/${EL}/features`), 'its features (mate limits and relations)');
  const studios = Object.keys(R.onshape.geom);
  assert.equal(urls.filter((u) => /tessellatedfaces/.test(u)).length, studios.length, 'each Part Studio once, however many parts it places');
  assert.equal(urls.filter((u) => /massproperties/.test(u)).length, studios.length);
  assert.ok(os.calls.every((c) => c.init.credentials === 'same-origin'), 'the relay cookie, nothing else');
  assert.equal(Object.keys(p.geom).length, studios.length);
  for (const k of studios) for (const id in p.geom[k].parts) {
    assert.ok(p.geom[k].parts[id].tri instanceof Float32Array, 'triangles compacted on arrival');
    assert.equal(p.geom[k].mass[id].I.length, 9, 'the tensor, nominal first');
  }
});

test('link: the address is read as copied, configuration included, and the definition is read in it', async () => {
  const os = onshape();
  await read(os, LINK + '?configuration=List_7Xq%3DSim&foo=1#tab');
  assert.ok(/[?&]configuration=List_7Xq%3DSim/.test(os.calls[0].u), os.calls[0].u);
  assert.ok(/\/features\?configuration=List_7Xq%3DSim$/.test(os.calls[1].u), os.calls[1].u);
});

test('link: the robot: every part a placed copy of one thinned shape, the mates the joints, the mass Onshape\'s', async () => {
  const p = await read(onshape());
  const cad = E.cadFromOnshape(E.checkOnshapePayload(Object.assign({ format: E.ONSHAPE_FORMAT, name: 'Robot 2026', url: LINK }, p)));
  assert.equal(cad.source, 'onshape');
  assert.equal(cad.solids.length, R.truth.leafParts);
  assert.ok(cad.shapes.length < cad.solids.length, 'parts placed more than once share a shape');
  for (const s of cad.solids) {
    assert.ok(s.shapes.length === 1 && cad.shapes[s.shapes[0]].idx.length >= 3, s.name + ' has a shape');
    assert.ok(Array.isArray(s.color), s.name + ' has its colour');
    assert.ok(s.kg > 0 && s.com.length === 3 && s.I.length === 9, s.name + ' has its mass, centre and tensor');
  }
  const joints = cad.mechs.filter((m) => m.fromMate);
  assert.deepEqual(joints.map((m) => m.id).sort(), R.truth.joints.map((j) => j.name).sort());
  assert.ok(Math.abs(cad.onshape.kg - R.truth.massKg) < 1e-3, 'the mass is Onshape\'s, summed');
  assert.ok(E.urdfExact(cad).meshes.length === cad.solids.length, 'the view gets one instance per part');
  assert.equal(cad.frame.up, R.truth.up);
});

test('link: the rigid links\' mass properties are the parts\' own, summed with the parallel-axis shift', async () => {
  const cad = E.cadFromOnshape(E.checkOnshapePayload(Object.assign({ format: E.ONSHAPE_FORMAT }, await read(onshape()))));
  assert.ok(cad.links.length >= 2, 'the chassis and at least one moving link');
  // each part weighs what the bench weighs it (a vendor figure beats the CAD's), and every part is in exactly one link
  const kgOf = (s) => E.partMass(s, {}).kg;
  const total = cad.links.reduce((a, l) => a + l.kg, 0);
  assert.ok(Math.abs(total - cad.solids.reduce((a, s) => a + kgOf(s), 0)) < 1e-9, 'every part is in exactly one link');
  for (const L of cad.links) {
    assert.ok(L.exact, L.id + ' has every part\'s tensor');
    const list = cad.solids.filter((s) => (s.mech && cad.mechs.some((m) => m.id === s.mech) ? s.mech : 'chassis') === L.id);
    assert.equal(list.length, L.parts);
    // the sum by hand: I = sum(I_i + m_i (d^2 E - d d^T)) about the link's centre of mass
    const M = list.reduce((a, s) => a + kgOf(s), 0), c = [0, 1, 2].map((k) => list.reduce((a, s) => a + kgOf(s) * s.com[k], 0) / M);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(c[k] - L.com[k]) < 1e-9);
    const I = new Array(9).fill(0);
    for (const s of list) { const d = s.com.map((v, k) => v - c[k]), dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], kg = kgOf(s);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[3 * i + j] += s.I[3 * i + j] + kg * ((i === j ? dd : 0) - d[i] * d[j]); }
    for (let k = 0; k < 9; k++) assert.ok(Math.abs(I[k] - L.I[k]) < 1e-9, L.id + ' tensor');
    // the tensor is positive on its diagonal and symmetric
    assert.ok(L.I[0] > 0 && L.I[4] > 0 && L.I[8] > 0 && Math.abs(L.I[1] - L.I[3]) < 1e-12);
  }
  // each joint knows what it carries, itself and everything hanging from it
  const lift = cad.mechs.find((m) => m.id === 'Lift Stage');
  assert.ok(lift.carries.kg > 0 && lift.carries.com, 'the lift knows the mass it lifts');
  // the whole-robot mass properties: a recognised vendor part keeps its published weight, every other part
  // is weighed as Onshape weighed it, with Onshape's own centre and tensor
  const mp = E.massProps(cad, { payloadKg: 0 });
  assert.ok(mp.parts.every((p) => p.how === 'vendor' || p.how === 'cad'), mp.parts.map((p) => p.how).join(','));
  assert.ok(mp.parts.some((p) => p.how === 'cad'));
  assert.ok(Math.abs(mp.kg - R.truth.massKg) < R.truth.massKg * 0.05, 'the robot weighs about what Onshape says: ' + mp.kg);
  assert.ok(mp.I.zz > 0 && mp.I.xx > 0);
});

test('link: a part with no material weighs its volume at the density its kind implies, tensor scaled with it', async () => {
  const cad = E.cadFromOnshape(E.checkOnshapePayload(Object.assign({ format: E.ONSHAPE_FORMAT }, await read(onshape({ hasMass: false })))));
  const mp = E.massProps(cad, { payloadKg: 0 });
  assert.ok(mp.kg > R.truth.massKg * 0.2 && mp.kg < R.truth.massKg * 3, 'a plausible robot, not its volume in kilograms: ' + mp.kg);
  const part = mp.parts.find((p) => p.how === 'cad');
  assert.ok(part, 'the CAD\'s volume was used');
});

test('link: Onshape busy (429) is retried; a Part Studio address is refused with what to do; no sign-in says so', async () => {
  const os = onshape({ busy: 3 });
  const p = await read(os);
  assert.ok(p.asm.rootAssembly, 'read after the retries');
  await assert.rejects(read(onshape({ asm: null })), /isn't an assembly/);
  const denied = { fetch: async () => ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) }) };
  await assert.rejects(E.onshapeRead(HOST, E.onshapeRef(LINK), { fetch: denied.fetch }), (e) => e.status === 401);
});

test('link: a dropped or relayed payload is checked: only the documents, the shapes and the masses are kept', () => {
  assert.throws(() => E.checkOnshapePayload({ format: 'something else', asm: { rootAssembly: {} } }), /isn't a robot/);
  assert.throws(() => E.checkOnshapePayload({ format: E.ONSHAPE_FORMAT, asm: {} }), /no assembly/);
  const p = E.checkOnshapePayload({ format: E.ONSHAPE_FORMAT, asm: { rootAssembly: {} }, features: 'x', name: 'n'.repeat(999), url: 'https://evil.example/x', extra: 1,
    geom: { k: { parts: { a: { name: 'A', tri: [0, 0, 0, 1, 0, 0, 0, 1, 0], color: '#ff0000' }, b: { tri: 'junk' } }, mass: { a: { kg: 2, com: [1, 2, 3], I: [1, 0, 0, 0, 1, 0, 0, 0, 1], vol: 1e-3 }, b: { kg: -1 }, c: { kg: 'x' } } } } });
  assert.equal(p.features, null); assert.equal(p.url, ''); assert.equal(p.name.length, 200); assert.equal(p.extra, undefined);
  assert.deepEqual(Object.keys(p.geom.k.parts), ['a']);
  assert.deepEqual(p.geom.k.mass, { a: { kg: 2, com: [1, 2, 3], I: [1, 0, 0, 0, 1, 0, 0, 0, 1], vol: 1e-3 } });
});
