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
