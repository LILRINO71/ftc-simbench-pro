// The whole robot from Onshape with no STEP (src/onshapecad.js): parts with
// their own triangles, colours and masses, placed where Onshape says, and the
// joints straight from the mates. The `mated` corpus robot's assembly, as the
// pasted-link reader gathers it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();
const R = buildRobot('mated');
const payload = () => JSON.parse(JSON.stringify({ name: 'Mated Robot', asm: R.onshape.assembly, features: R.onshape.features, geom: R.onshape.geom }));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('onshape whole robot: every part arrives with real triangles, a colour and a mass', () => {
  const cad = E.cadFromOnshape(payload());
  assert.equal(cad.source, 'onshape');
  assert.equal(cad.solids.length, R.truth.leafParts);
  // every part is a placed copy of a thinned shape, the way the URDF route draws them (urdfExact -> View.setExact)
  for (const s of cad.solids) {
    assert.ok(s.shapes && s.shapes.length === 1 && cad.shapes[s.shapes[0]].pos.length >= 9, s.name + ' has a shape');
    assert.ok(Array.isArray(s.color) && s.color.length === 3, s.name + ' has a colour');
    assert.ok(s.occT && s.occT.r.length === 3, s.name + ' has its placement');
  }
  const ex = E.urdfExact(cad);
  assert.equal(ex.meshes.length, cad.solids.length, 'one placed mesh per part for the view');
  assert.ok(cad.shapes.length < cad.solids.length, 'a part placed twice is one shape: ' + cad.shapes.length + ' shapes, ' + cad.solids.length + ' parts');
  assert.ok(Math.abs(cad.onshape.kg - R.truth.massKg) < 1e-3, 'the mass is Onshape\'s, summed');
  // the same robot frame a STEP gets: up +z, standing on the floor
  assert.equal(cad.frame.up, R.truth.up);
  assert.ok(Math.abs(cad.bbox.min[2]) < 0.002, 'on the floor: ' + cad.bbox.min[2]);
  const w = R.truth.bbox, size = (b) => [0, 1, 2].map((k) => b.max[k] - b.min[k]).sort((a, c) => a - c);
  size(cad.bbox).forEach((v, k) => assert.ok(Math.abs(v - size(w)[k]) < 0.005, 'size matches: ' + v + ' vs ' + size(w)[k]));
});

test('onshape whole robot: the joints are the mates, exactly, with nothing to match or guess', () => {
  const cad = E.cadFromOnshape(payload());
  assert.equal(cad.onshape.report.matched, R.truth.leafParts);
  const joints = cad.mechs.filter((m) => m.fromMate);
  assert.deepEqual(joints.map((m) => m.id).sort(), R.truth.joints.map((j) => j.name).sort());
  for (const t of R.truth.joints) {
    const m = joints.find((x) => x.id === t.name);
    assert.equal(m.kind, t.kind, t.name);
    assert.ok(Math.abs(dot(m.axis, t.axis)) > 0.9999, t.name + ' axis');
    assert.deepEqual(cad.solids.filter((s) => s.mech === m.id).map((s) => s.name).sort(), t.carries.slice().sort(), t.name + ' carries');
  }
  assert.ok(cad.mechs.find((m) => m.id === 'Lift Stage').limits, 'limits from the features list');
});

test('onshape whole robot: a raw tessellatedfaces response compacts the same way', () => {
  const raw = [{ id: 'JHD', name: 'Plate', faces: [
    { color: '#ff8000', facets: [{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }, { vertices: [[1, 0, 0], [1, 1, 0], [0, 1, 0]] }] },
    { appearance: { color: { red: 0, green: 0, blue: 255 } }, facets: [{ vertices: [[0, 0, 0], [0, 0, 0.01], [0, 0.01, 0]] }] }] }];
  const c = E.osCompactTess(raw);
  assert.equal(c.JHD.tri.length, 27);
  assert.deepEqual(c.JHD.color.map((v) => Math.round(v * 255)), [255, 128, 0], 'the colour covering most of the part');
  assert.deepEqual(E.osCompactMass({ bodies: { JHD: { mass: [0.25, 0.24, 0.26], centroid: [0, 0, 0.1, 0, 0, 0.1, 0, 0, 0.1], volume: [1e-4, 1e-4, 1e-4] } } }), { JHD: { kg: 0.25, com: [0, 0, 0.1], I: null, vol: 1e-4 } });
  // no material: the volume stands in for the mass (density 1), exactly as Onshape's URDF export writes it
  assert.equal(E.osCompactMass({ bodies: { X: { hasMass: false, mass: [0, 0, 0], volume: [2e-5, 2e-5, 2e-5], centroid: [1, 2, 3] } } }).X.kg, 2e-5);
  // the tensor comes through, nominal first
  const I = Array.from({ length: 27 }, (_, i) => i + 1);
  assert.deepEqual(E.osCompactMass({ bodies: { Y: { mass: [1, 1, 1], centroid: [0, 0, 0], inertia: I } } }).Y.I, I.slice(0, 9));
  assert.equal(E.onshapeGeomKey({ documentId: 'D', documentVersion: 'V', elementId: 'E', configuration: 'c=1' }), 'D/v/V/e/E|c=1');
});

test('onshape whole robot: a part Onshape sent no shape for is named, not silently lost', () => {
  const p = payload();
  delete p.geom[Object.keys(p.geom)[0]];
  const cad = E.cadFromOnshape(p);
  assert.equal(cad.solids.length, R.truth.leafParts - 1);
  assert.ok(cad.onshape.why.some((w) => /without a shape/.test(w)));
});

// ---- the shapes Onshape's API really sends (its OpenAPI spec, cad.onshape.com/api/openapi) ----
test('onshape whole robot: facet points written as {x,y,z} and colours as strings still draw', () => {
  const tess = [{ id: 'JHD', name: 'Plate', faces: [{ appearance: { color: ['255', '128', '0'], opacity: 255 },
    facets: [{ vertices: [{ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, { x: 0, y: 0.1, z: 0 }] }] }] }];
  const c = E.osCompactTess(tess);
  Array.from(c.JHD.tri).forEach((v, i) => assert.ok(Math.abs(v - [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0][i]) < 1e-6));
  assert.deepEqual(c.JHD.color.map((x) => Math.round(x * 255)), [255, 128, 0]);
});

test('onshape whole robot: two subassemblies that reuse an instance id each place their own part', () => {
  const p = payload(), A = p.asm;
  // the first part instance in the root, as a template
  const part = A.rootAssembly.instances.find((i) => i.type === 'Part');
  const occ = A.rootAssembly.occurrences.find((o) => o.path.length === 1 && o.path[0] === part.id);
  const key = E.onshapeGeomKey(part);
  // two subassemblies, each with one instance called "Shared" but different parts
  const mk = (eid, name) => ({ documentId: part.documentId, elementId: eid, configuration: 'default', fullConfiguration: 'default',
    instances: [Object.assign({}, part, { id: 'Shared', name })], features: [] });
  A.subAssemblies = (A.subAssemblies || []).concat([mk('a'.repeat(24), 'Left claw'), mk('b'.repeat(24), 'Right claw')]);
  const T = occ.transform.slice(), T2 = T.slice(); T2[3] += 0.5;
  A.rootAssembly.instances.push({ id: 'SubA', type: 'Assembly', name: 'Claw A', documentId: part.documentId, elementId: 'a'.repeat(24), configuration: 'default', fullConfiguration: 'default' },
    { id: 'SubB', type: 'Assembly', name: 'Claw B', documentId: part.documentId, elementId: 'b'.repeat(24), configuration: 'default', fullConfiguration: 'default' });
  A.rootAssembly.occurrences.push({ path: ['SubA', 'Shared'], transform: T }, { path: ['SubB', 'Shared'], transform: T2 });
  assert.ok(p.geom[key]);
  const cad = E.cadFromOnshape(p);
  const names = cad.solids.map((s) => s.name);
  assert.ok(names.includes('Left claw') && names.includes('Right claw'), names.join(', '));
});

// ---- what cad.onshape.com really answered for the owner's robot (read 2026-11-18): the two things the spec didn't say ----
test('onshape whole robot: a part\'s colour comes as four bytes in base64, on the body', () => {
  // verbatim: "color":"nc/t/w==" on the body, no colour on its faces
  const tess = [{ id: 'JJD', bodyType: 'solid', color: 'nc/t/w==', faces: [{ id: 'JJG', facets: [{ vertices: [[0, 0, 0], [0.1, 0, 0], [0, 0.1, 0]] }] }] }];
  assert.deepEqual(E.osColor('nc/t/w==').map((v) => Math.round(v * 255)), [157, 207, 237]);
  assert.deepEqual(E.osCompactTess(tess).JJD.color.map((v) => Math.round(v * 255)), [157, 207, 237], 'the body\'s colour reaches the part');
  // six base64 characters can spell a hex colour: the "==" says which it is
  assert.deepEqual(E.osColor('abcdeA==').map((v) => Math.round(v * 255)), [105, 183, 29]);
  assert.deepEqual(E.osColor('#abcdef').map((v) => Math.round(v * 255)), [171, 205, 239]);
  assert.equal(E.osColor('not a colour'), null);
});

test('onshape whole robot: a part with no material has no centroid in Onshape\'s answer, so its centre comes from its shape', () => {
  // verbatim figures for one body of an imported part: hasMass false, a volume, and zeros where the centroid would be
  const raw = { hasMass: false, massMissingCount: 1, mass: [0, -1.4e-9, 1.4e-9], volume: [5.2371e-5, 5.2369e-5, 5.2372e-5],
    centroid: [0, 0, 0, -0.000001, -0.000001, -0.000001, 0.000001, 0.000001, 0.000001], inertia: new Array(9).fill(0).concat(new Array(9).fill(-5.2e-11), new Array(9).fill(5.2e-11)) };
  const m = E.osCompactMass({ bodies: { JID: raw } }).JID;
  assert.equal(m.com, null, 'zeros are not a centre');
  assert.equal(m.kg, 5.2371e-5); assert.equal(m.vol, 5.2371e-5); assert.equal(m.I, null);
  // a part with a material keeps Onshape's centroid, the origin included
  assert.deepEqual(E.osCompactMass({ bodies: { A: { hasMass: true, mass: [1, 1, 1], volume: [4e-4, 4e-4, 4e-4], centroid: [0, 0, 0] } } }).A.com, [0, 0, 0]);

  // the centre of a closed shape: a 20 x 40 x 60 mm box with one corner at (1, 2, 3) m
  const box = (o, s) => { const v = (i) => [o[0] + (i & 1 ? s[0] : 0), o[1] + (i & 2 ? s[1] : 0), o[2] + (i & 4 ? s[2] : 0)];
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]], out = [];
    for (const q of quads) for (const t of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) for (const i of t) out.push(...v(i));
    return Float32Array.from(out); };
  const c = E.osMeshCentroid(box([1, 2, 3], [0.02, 0.04, 0.06]));
  [1.01, 2.02, 3.03].forEach((w, a) => assert.ok(Math.abs(c[a] - w) < 1e-5, 'box centre ' + c));
  assert.equal(E.osMeshCentroid(box([0, 0, 0], [0.02, 0.04, 0.06]).slice(0, 18)), null, 'one open face encloses nothing');

  // the whole robot with no material anywhere, as the API answers it: every part's centre is inside its own shape
  const p = payload();
  for (const k in p.geom) p.geom[k].mass = { bodies: Object.fromEntries(Object.keys(p.geom[k].parts).map((id) => [id, raw])) };
  const cad = E.cadFromOnshape(p);
  let far = 0;
  for (const s of cad.solids) {
    assert.ok(Array.isArray(s.com) && s.com.every(Number.isFinite), s.name + ' has a centre');
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const q of s.pts) for (let a = 0; a < 3; a++) { if (q[a] < lo[a]) lo[a] = q[a]; if (q[a] > hi[a]) hi[a] = q[a]; }
    for (let a = 0; a < 3; a++) if (s.com[a] < lo[a] - 0.005 || s.com[a] > hi[a] + 0.005) { far++; break; }
  }
  assert.equal(far, 0, far + ' part(s) have their centre outside their own shape (it was each Part Studio\'s origin)');
  assert.equal(cad.onshape.kg, null, 'no mass came from Onshape, and none is claimed');
  assert.ok(cad.onshape.why.some((w) => /No part has a material set/.test(w)), cad.onshape.why.join(' | '));
  assert.ok(!cad.onshape.why.some((w) => /Mass from Onshape: 0\.00 kg/.test(w)), 'a volume is not reported as a mass');
});
