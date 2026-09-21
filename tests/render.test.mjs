// The exact robot: every OpenCascade mesh has to land in the mechanism group of
// the part it belongs to, in the same canonical frame as the parser's points,
// or "looks exactly like Onshape" would mean an arm whose exact geometry stays
// behind while its hull swings. Runs against the corpus with the occt-import-js
// that ships to the browser, when it is on this machine.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { engineBundle } from './load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(HERE, 'fixtures', 'robots');
const NAMES = fs.readdirSync(DIR).filter((f) => f.endsWith('.step')).map((f) => f.slice(0, -5)).sort();
const stepOf = (n) => fs.readFileSync(path.join(DIR, n + '.step'), 'utf8');

// tessellate.js is a DOM-side file, but everything it defines at the top level
// is pure; Tess only touches the DOM when it runs.
const T = new Function('"use strict";\n' + engineBundle().replace(/^"use strict";\n/, '') + '\n' +
  fs.readFileSync(path.join(ROOT, 'src', 'tessellate.js'), 'utf8') +
  '\nreturn { parseSTEP, mechOwner, solidGroups, tessMatch, tessAssign, tessBuckets, tessNames, OCCT_PARAMS };')();

// occt-import-js is a devDependency: the exact geometry is the feature, so a
// machine without it fails here rather than skipping into a false green
const require = createRequire(import.meta.url);
const OCCT_PATH = process.env.OCCT_IMPORT_JS || require.resolve('occt-import-js');
let occtP = null;
const occt = () => (occtP ||= require(OCCT_PATH)());
const tess = async (name) => { const oc = await occt(); return oc && oc.ReadStepFile(new TextEncoder().encode(stepOf(name)), T.OCCT_PARAMS); };

const boxOf = (pts) => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } return { min: mn, max: mx }; };

for (const name of NAMES) {
  describe('exact meshes: ' + name, () => {
    test('every mesh finds its part, in the canonical frame, to the millimetre', async (t) => {
      const res = await tess(name);
      assert.ok(res, 'occt-import-js did not load from ' + OCCT_PATH);
      assert.ok(res.success);
      const cad = T.parseSTEP(stepOf(name));
      const mt = T.tessMatch(cad, res);
      // the frame moved the meshes where it moved the parser's points
      const all = boxOf(mt.boxes.flatMap((b) => [b.min, b.max]));
      for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(all.min[k] - cad.bbox.min[k]) < 0.003 && Math.abs(all.max[k] - cad.bbox.max[k]) < 0.003,
          'meshes span ' + all.min.map((v) => v.toFixed(4)) + '..' + all.max.map((v) => v.toFixed(4)) +
          ', parser bbox ' + cad.bbox.min.map((v) => v.toFixed(4)) + '..' + cad.bbox.max.map((v) => v.toFixed(4)));
      }
      // a mesh that matched sits inside its part's box
      mt.solid.forEach((i, j) => {
        if (i < 0) return;
        const sb = boxOf(cad.solids[i].pts), b = mt.boxes[j];
        for (let k = 0; k < 3; k++) assert.ok(b.min[k] > sb.min[k] - 0.004 && b.max[k] < sb.max[k] + 0.004,
          'mesh ' + j + ' (' + mt.names[j] + ') is not inside ' + cad.solids[i].name);
      });
      // every solid the parser drew has exact geometry now
      const used = new Set(mt.solid.filter((i) => i >= 0));
      const bare = cad.solids.filter((s, i) => !used.has(i) && s.pts && s.pts.length >= 4).map((s) => s.name);
      assert.deepEqual(bare, [], 'parts with no exact mesh');
    });

    test('wheels ride the chassis; every matched mesh rides its part\'s mechanism', async (t) => {
      const res = await tess(name);
      assert.ok(res, 'occt-import-js did not load');
      const cad = T.parseSTEP(stepOf(name));
      const asg = T.tessAssign(cad, res, 0.55), sg = T.solidGroups(cad, 0.55);
      asg.solid.forEach((i, j) => { if (i >= 0) assert.equal(asg.group[j], sg[i], 'mesh ' + j + ' (' + asg.names[j] + ')'); });
      asg.solid.forEach((i, j) => {
        if (i >= 0 && cad.solids[i].kind === 'wheel') assert.equal(asg.group[j], 'chassis', 'wheel mesh ' + j + ' (' + asg.names[j] + ') is in ' + asg.group[j]);
      });
      const ids = new Set(['chassis', ...cad.mechs.map((m) => m.id)]);
      for (const g of asg.group) assert.ok(ids.has(g), 'unknown group ' + g);
    });

    test('draw buckets: one per (group, colour), every triangle kept once', async (t) => {
      const res = await tess(name);
      assert.ok(res, 'occt-import-js did not load');
      const cad = T.parseSTEP(stepOf(name));
      const asg = T.tessAssign(cad, res, 0.55), list = T.tessBuckets(cad, res, asg);
      const tris = res.meshes.reduce((s, m) => s + m.index.array.length / 3, 0);
      assert.equal(list.reduce((s, b) => s + b.idx.length / 3, 0), tris, 'triangles in the buckets');
      const keys = list.map((b) => b.group + '|' + (b.color || 'kind:' + b.kind));
      assert.equal(new Set(keys).size, keys.length, 'duplicate bucket');
      for (const b of list) {
        const nv = b.pos.length / 3;
        for (const i of b.idx) assert.ok(i < nv, 'index out of range');
        for (let i = 0; i < b.pos.length; i++) assert.ok(Number.isFinite(b.pos[i]));
        // occt's normals come through unit length after the frame's rotation
        for (let i = 0; i < b.nor.length; i += 3 * 97) { const l = Math.hypot(b.nor[i], b.nor[i + 1], b.nor[i + 2]); assert.ok(Math.abs(l - 1) < 1e-3 || l === 0, 'normal length ' + l); }
      }
      // the STEP colours make it through
      const coloured = res.meshes.some((m) => m.color || m.brep_faces.some((f) => f.color));
      if (coloured) assert.ok(list.some((b) => b.color), 'the file has colours but no bucket kept one');
    });
  });
}

test('mecanum-zup: the arm\'s meshes move with the arm, the drive stays on the chassis', async (t) => {
  const res = await tess('mecanum-zup');
  assert.ok(res, 'occt-import-js did not load');
  const cad = T.parseSTEP(stepOf('mecanum-zup'));
  const asg = T.tessAssign(cad, res, 0.55);
  const inMech = asg.group.filter((g) => g !== 'chassis').length;
  assert.ok(cad.mechs.length > 0 && inMech > 0, 'no exact mesh rides a mechanism (' + cad.mechs.length + ' mechanisms)');
  asg.names.forEach((n, j) => { if (/rail|pattern plate|control hub|battery|mecanum/i.test(n)) assert.equal(asg.group[j], 'chassis', n); });
});
