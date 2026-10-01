// The light copy of a robot (src/robotlite.js): clustering keeps the shape and
// meets the triangle budget, segments stay in their own frames, and packing
// round-trips while anything malformed or hostile comes back null.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
/* A flat plate 0.2 x 0.1 m as an n x m grid of triangles (dense, like a real tessellation). */
function plate(n = 100, m = 50, w = 0.2, h = 0.1) {
  const pos = [], idx = [];
  for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) pos.push(i / n * w, j / m * h, 0);
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1); }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}
const bounds = (v) => {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[i + k]); mx[k] = Math.max(mx[k], v[i + k]); }
  return { mn, mx };
};
const translate = (x, y, z) => Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

test('lite: clustering cuts a dense plate to the grid and keeps its outline', () => {
  const p = plate(), r = E.liteCluster(p.pos, p.idx, 3, 0.01);
  assert.ok(r.t.length / 3 < p.idx.length / 3 / 20, `${r.t.length / 3} triangles from ${p.idx.length / 3}`);
  const b = bounds(r.v);
  assert.ok(b.mx[0] - b.mn[0] > 0.18 && b.mx[1] - b.mn[1] > 0.08, 'still 0.2 x 0.1 m');
  assert.ok(r.tc.every((c) => c === 3));
  for (const k of r.t) assert.ok(k < r.v.length / 3);
});

test('lite: a robot of shared shapes meets the budget, each segment in its own frame', () => {
  const p = plate();
  const input = { pal: [[200, 200, 200], [230, 120, 20]], shapes: [{ pos: p.pos, idx: p.idx, tc: 1 }],
    parts: [{ seg: 'chassis', shape: 0, m: null }, { seg: 'chassis', shape: 0, m: translate(0, 0, 0.1) }, { seg: 'arm', shape: 0, m: translate(0.3, 0, 0) }] };
  const L = E.liteBuild(input, { budget: 3000, cell: 0.002 });
  assert.ok(L.tris <= 3000, L.tris + ' triangles');
  assert.deepEqual(L.segs.map((s) => s.id), ['chassis', 'arm']);
  const arm = bounds(L.segs[1].v), ch = bounds(L.segs[0].v);
  assert.ok(arm.mn[0] > 0.29, 'the arm sits where its part was placed');
  assert.ok(ch.mx[2] > 0.09, 'both chassis copies are there');
});

test('lite: packs and unpacks to the same robot, to half a millimetre', () => {
  const p = plate();
  const L = E.liteBuild({ pal: [[1, 2, 3], [4, 5, 6]], shapes: [{ pos: p.pos, idx: p.idx, tc: 1 }],
    parts: [{ seg: 'chassis', shape: 0, m: null }, { seg: 'lift', shape: 0, m: translate(0, 0, 0.5) }] }, { budget: 4000 });
  const D = E.liteDecode(E.liteEncode(L));
  assert.ok(D);
  assert.deepEqual(D.pal, [[1, 2, 3], [4, 5, 6]]);
  assert.deepEqual(D.segs.map((s) => s.id), ['chassis', 'lift']);
  D.segs.forEach((s, k) => {
    assert.deepEqual([...s.t], [...L.segs[k].t]);
    assert.deepEqual([...s.tc], [...L.segs[k].tc]);
    for (let i = 0; i < s.v.length; i++) assert.ok(Math.abs(s.v[i] - L.segs[k].v[i]) <= 0.00026);
  });
});

test('lite: malformed or hostile packs come back null, never throw', () => {
  const p = plate(20, 10);
  const good = E.liteEncode(E.liteBuild({ pal: [[9, 9, 9]], shapes: [{ pos: p.pos, idx: p.idx }], parts: [{ seg: 'chassis', shape: 0, m: null }] }));
  const head = (obj) => {
    const h = new TextEncoder().encode(JSON.stringify(obj)), b = new ArrayBuffer(4 + h.length + 64);
    new DataView(b).setUint32(0, h.length, true); new Uint8Array(b).set(h, 4); return b;
  };
  assert.equal(E.liteDecode(null), null);
  assert.equal(E.liteDecode(new ArrayBuffer(3)), null);
  assert.equal(E.liteDecode(good.slice(0, good.byteLength - 8)), null, 'cut short');
  assert.equal(E.liteDecode(head({ f: 1, pal: [[1, 1, 1]], segs: [{ id: 'x', nv: 1e9, nt: 1 }] })), null, 'a billion vertices');
  assert.equal(E.liteDecode(head({ f: 2, pal: [], segs: [] })), null, 'another format');
  const b = new ArrayBuffer(16); new DataView(b).setUint32(0, 0xffffffff, true);
  assert.equal(E.liteDecode(b), null, 'a header longer than the pack');
  // an index past the vertices
  const bad = good.slice(0), D = E.liteDecode(good), hl = new DataView(bad).getUint32(0, true);
  const o = 4 + ((hl + 3) & ~3) + ((D.segs[0].v.length * 2 + 3) & ~3);
  new Uint16Array(bad, o, 1)[0] = 65535;
  assert.equal(E.liteDecode(bad), null, 'an index past the vertices');
});
