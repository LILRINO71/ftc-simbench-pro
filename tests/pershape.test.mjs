// Issue #3. OpenCascade reads a whole 50 MB Onshape assembly and then meshes
// none of it (773 empty meshes on GearGurus 7832's robot). Cut into one small
// STEP per shape, every shape meshes, and each is placed at every occurrence
// the parser recorded. On robots small enough for the whole-file path, both
// paths have to agree: same parts, same places, same colours, same groups.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { engineBundle, fixture } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = new Function('"use strict";\n' + engineBundle().replace(/^"use strict";\n/, '') + '\n' +
  fs.readFileSync(path.join(ROOT, 'src', 'tessellate.js'), 'utf8') +
  '\nreturn { parseSTEP, stepShapeUnits, tessExpand, tessAssign, tessBuckets, tessEdges, tessMatch, tessTree, tessNames, tessBox, placeM, frameM, OCCT_PARAMS, applyOnshapeMates, inDriveWheel, driveFromCAD };')();
const require = createRequire(import.meta.url);
let occtP = null;
const occt = () => (occtP = occtP || require(process.env.OCCT_IMPORT_JS || require.resolve('occt-import-js'))());

async function both(text) {
  const oc = await occt();
  const cad = T.parseSTEP(text);
  const whole = oc.ReadStepFile(new TextEncoder().encode(text), T.OCCT_PARAMS);
  const units = T.stepShapeUnits(text, cad.occs), meshesOf = new Map();
  for (const u of units) {
    const r = oc.ReadStepFile(new TextEncoder().encode(u.text), T.OCCT_PARAMS);
    assert.ok(r && r.success && r.meshes.length, 'shape ' + u.rep + ' meshes on its own');
    meshesOf.set(u.rep, r.meshes);
  }
  return { cad, whole, units, per: T.tessExpand(cad.occs, meshesOf) };
}
const boxOf = (cad, m) => T.tessBox(m.attributes.position.array, T.placeM(T.frameM(cad), m.T));
const near = (a, b, tol) => [0, 1, 2].every((k) => Math.abs(a.min[k] - b.min[k]) <= tol && Math.abs(a.max[k] - b.max[k]) <= tol);

for (const name of ['mecanum-zup', 'nested', 'mated']) {
  test(`${name}: per-shape meshing places every part where the whole-file mesh has it`, async () => {
    const text = name === 'mated' ? buildRobot('mated').text : fixture('robots/' + name + '.step');
    const { cad, whole, units, per } = await both(text);
    assert.equal(units.length, new Set(cad.occs.map((o) => o.rep)).size, 'one unit per shape');
    assert.equal(per.meshes.length, whole.meshes.length, 'the same number of meshes');
    // every whole-file mesh has a per-shape twin: same name, same box
    const left = per.meshes.map((m, j) => ({ j, name: m.name.toLowerCase(), box: boxOf(cad, m) }));
    for (const m of whole.meshes) {
      const b = boxOf(cad, m), key = T.tessNames(whole)[whole.meshes.indexOf(m)].replace(/\s*<\d+>\s*$/, '').toLowerCase();
      const i = left.findIndex((x) => near(x.box, b, 5e-4));
      assert.ok(i >= 0, `${key}: a per-shape mesh sits within 0.5 mm of it`);
      left.splice(i, 1);
    }
    // colours come through the cut, and more of them: whole-file reading drops
    // most part colours (10 of 80 on mecanum-zup), per shape keeps each one
    const col = (r) => r.meshes.filter((m) => m.color || (m.brep_faces || []).some((f) => f.color)).length;
    assert.ok(col(per) >= col(whole), `coloured meshes: per-shape ${col(per)}, whole-file ${col(whole)}`);
    assert.equal(col(per), per.meshes.length, 'every part keeps its colour');
    // the same mechanism groups, without any name or box matching
    const ga = T.tessAssign(cad, whole, 0.55).group.slice().sort(), gb = T.tessAssign(cad, per, 0.55).group.slice().sort();
    assert.deepEqual(gb, ga);
  });
}

test('shapes are shared, not copied: the robot costs its unique shapes', async () => {
  const { cad, per } = await both(fixture('robots/big.step'));
  const shared = new Set(per.meshes.map((m) => m.attributes.position.array)).size;
  assert.ok(shared < per.meshes.length / 5, `${per.meshes.length} placed meshes share ${shared} arrays`);
  assert.ok(per.meshes.every((m, j) => per.solidOf[j] != null), 'each knows its solid');
  // the assembly tree comes from the occurrences' own paths
  const tree = T.tessTree(per);
  assert.ok(tree.kids.length >= 1 && tree.all.length === per.meshes.length);
  // edges are worked out once per shape and placed with it
  const asg = T.tessAssign(cad, per, 0.55), e = T.tessEdges(cad, per, asg, null);
  assert.ok(e.reduce((n, g) => n + g.pos.length, 0) > 0);
});

test('a drive wheel part is inside the wheel AND no bigger than it; a long beam through it is not', () => {
  const cad = T.parseSTEP(fixture('robots/mecanum-zup.step'));
  const w = T.driveFromCAD(cad, { front: '+x' }).wheels[0], f = T.inDriveWheel(cad);
  assert.equal(f(w.c, 0.03), true, 'a roller-sized part at the hub');
  assert.equal(f(w.c, 2 * w.r), true, 'a side plate as big as the wheel');
  // 7832's 232 mm flat beam: its centre inside the front-left wheel's cylinder
  assert.equal(f(w.c, 0.232), false, 'a 232 mm beam passing through is not a wheel part');
  assert.equal(f([w.c[0] + 0.3, w.c[1], w.c[2]], 0.03), false, 'and nothing outside the cylinder is');
});

test('twin subassemblies under one parent stay two nodes in the parts tree', async () => {
  const { cad, per } = await both(fixture('robots/big.step'));
  // every distinct subassembly occurrence on the parts' paths is its own node
  const keys = new Set();
  for (const o of cad.occs) for (const p of o.path) keys.add(p.k);
  let nodes = 0;
  const walk = (n) => { for (const c of n.children || []) { if ((c.children || []).length) nodes++; walk(c); } };
  walk(per.root);
  assert.equal(nodes, keys.size, `${keys.size} subassembly occurrences, ${nodes} tree nodes`);
  assert.ok(keys.size > 100, 'big has its 165 identical gusset kits');
});

test('a part named "#25 Roller Chain Loop" pulls in no record: names are not references', () => {
  // FTC names are full of "#25" and "#35" (chain sizes). Rename the chain after
  // the battery's own geometry record: nothing of the battery may follow it.
  const t0 = fixture('robots/tank-traction.step');
  const id = /^#(\d+)=ADVANCED_BREP_SHAPE_REPRESENTATION\('REV Slim Battery/m.exec(t0)[1];
  const t = t0.split("'#25 Roller Chain Loop'").join("'#" + id + " Roller Chain Loop'");
  assert.notEqual(t, t0, 'the corpus has a part named #25');
  const cad = T.parseSTEP(t), cad0 = T.parseSTEP(t0);
  const occ = cad.occs.find((o) => /Roller Chain/.test(o.name));
  const unit = T.stepShapeUnits(t, cad.occs).find((u) => u.rep === occ.rep);
  assert.ok(!new RegExp('^#' + id + '=', 'm').test(unit.text), "the chain's own STEP holds no battery record");
  // and the parser's chain solid is the same with either name
  const box = (c) => { const s = c.solids.find((x) => /Roller Chain/.test(x.name)); const mn = [0, 1, 2].map((k) => Math.min(...s.pts.map((p) => p[k]))), mx = [0, 1, 2].map((k) => Math.max(...s.pts.map((p) => p[k]))); return mn.concat(mx).map((v) => +v.toFixed(6)); };
  assert.deepEqual(box(cad), box(cad0));
});
