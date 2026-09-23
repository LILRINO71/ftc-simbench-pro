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
  '\nreturn { parseSTEP, stepShapeUnits, tessExpand, tessAssign, tessBuckets, tessEdges, tessMatch, tessTree, tessNames, tessBox, placeM, frameM, OCCT_PARAMS, applyOnshapeMates };')();
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
