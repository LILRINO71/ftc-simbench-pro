// Mesh thinning (src/meshfiles.js meshDecimate, meshReduce): every part of an
// export zip goes through it. It packed a vertex's grid cell into one number past
// 2^53, so the x bits rounded away and vertices a whole part apart merged: a thin
// strip thinned to nothing, and the parts that survived lost their shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

/* a w x h grid of quads (two triangles each) at height z, as a triangle soup */
function plate(w, h, step, z, ox = 0) {
  const t = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
    const x = ox + i * step, y = j * step;
    t.push(x, y, z, x + step, y, z, x + step, y + step, z, x, y, z, x + step, y + step, z, x, y + step, z);
  }
  return Float32Array.from(t);
}

test('mesh thinning: vertices merge only within a cell, wherever the part sits', () => {
  // a strip of 200 triangles 0.5 mm apart, 0.2 m up, thinned at a 0.2 mm cell: nothing should merge
  const tri = []; for (let i = 0; i < 200; i++) { const x = i * 0.0005; tri.push(x, 0, 0.2, x + 0.0005, 0, 0.2, x, 0.0005, 0.2); }
  const r = E.meshDecimate(Float32Array.from(tri), 0.0002);
  assert.equal(r.idx.length / 3, 200, 'every triangle kept');
  assert.equal(r.pos.length / 3, 401, 'shared corners welded, nothing else');
  // far from the origin (a part placed in its studio's frame) it behaves the same
  const far = E.meshDecimate(plate(30, 30, 0.002, 1.7, 3.1), 0.001);
  assert.equal(far.idx.length / 3, 30 * 30 * 2);
  // coarser than the spacing: the grid merges whole cells and the plate keeps its outline
  const coarse = E.meshDecimate(plate(40, 40, 0.001, 0, 0), 0.004);
  const xs = Array.from({ length: coarse.pos.length / 3 }, (_, i) => coarse.pos[3 * i]);
  assert.ok(coarse.idx.length / 3 < 40 * 40 * 2 / 4 && Math.max(...xs) > 0.035, 'fewer triangles, same 40 mm extent');
});

test('mesh thinning: a part over its budget lands under it, and not far under, in a few passes', () => {
  const tri = plate(300, 300, 0.0005, 0.05);                        // 180,000 triangles, a 150 mm plate
  const R = E.meshReduce(tri, {});
  const budget = Math.max(1500, Math.min(60000, Math.round(R.diag * 150000)));
  assert.ok(R.after <= budget, R.after + ' over the budget ' + budget);
  assert.ok(R.after >= budget * 0.3, R.after + ' far under the budget ' + budget);
  assert.equal(R.before, 180000);
});

test('glTF: packed float positions and indices read as they lie; placed by the node, coloured', async () => {
  const { glb } = await import('./exportzip.mjs');
  const M = E.gltfRead(glb([0.2, 0.4, 0.6], 0.1, [1, 2, 3]), {});
  assert.equal(M.tri.length, 12 * 9, 'a cube: 12 triangles');
  const xs = []; for (let i = 0; i < M.tri.length; i += 3) xs.push(M.tri[i]);
  assert.ok(Math.abs(Math.min(...xs) - 0.95) < 1e-6 && Math.abs(Math.max(...xs) - 1.05) < 1e-6, 'moved by its node');
  assert.deepEqual(M.color.map((v) => +v.toFixed(2)), [0.2, 0.4, 0.6]);
});
