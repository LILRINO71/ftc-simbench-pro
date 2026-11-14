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

/* A box as 12 triangles, and a sphere of n x n quads (dense, like a screw head or a bearing). */
function boxShape(w, h, d) {
  const v = []; for (let i = 0; i < 8; i++) v.push(i & 1 ? w : 0, i & 2 ? h : 0, i & 4 ? d : 0);
  return { pos: Float32Array.from(v), idx: Uint32Array.from([0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5]) };
}
function ball(r, n = 40) {
  const pos = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const t = Math.PI * j / n, f = 2 * Math.PI * i / n; pos.push(r * Math.sin(t) * Math.cos(f), r * Math.sin(t) * Math.sin(f), r * Math.cos(t)); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}

test('lite: the budget is taken from the heavy shapes; a flat panel of twelve triangles comes through as it is', () => {
  // a 400 mm side panel, and 200 screws of 3,200 triangles each: 640,000 triangles into 20,000
  const panel = boxShape(0.4, 0.3, 0.004), screw = ball(0.004);
  const parts = [{ seg: 'chassis', shape: 0, m: null }];
  for (let k = 0; k < 200; k++) parts.push({ seg: 'chassis', shape: 1, m: translate(0.002 * k, 0.5, 0) });
  const L = E.liteBuild({ pal: [[200, 200, 200], [40, 40, 40]], shapes: [{ pos: panel.pos, idx: panel.idx, tc: 0 }, { pos: screw.pos, idx: screw.idx, tc: 1 }], parts }, { budget: 20000 });
  assert.ok(L.tris <= 20000, L.tris + ' triangles');
  // the panel: its 12 triangles and its 8 corners exactly (one grid for the whole robot moved them: a dented panel)
  const seg = L.segs[0], corners = new Set();
  let panelTris = 0;
  for (let f = 0; f < seg.t.length / 3; f++) if (seg.tc[f] === 0) { panelTris++; for (let k = 0; k < 3; k++) { const v = seg.t[3 * f + k]; corners.add([0, 1, 2].map((a) => seg.v[3 * v + a].toFixed(5)).join()); } }
  assert.equal(panelTris, 12);
  for (const c of corners) { const [x, y, z] = c.split(',').map(Number); assert.ok([0, 0.4].some((w) => Math.abs(x - w) < 1e-6) && [0, 0.3].some((w) => Math.abs(y - w) < 1e-6) && [0, 0.004].some((w) => Math.abs(z - w) < 1e-6), 'a panel corner at ' + c); }
});

test('lite: a part with nothing left to cluster is drawn as its box, and the smallest parts go first when there is no room', () => {
  const screw = ball(0.004), plate2 = plate(60, 30);
  const mk = (n) => { const parts = [{ seg: 'chassis', shape: 0, m: null }]; for (let k = 0; k < n; k++) parts.push({ seg: 'chassis', shape: 1, m: translate(0.01 * k, 0.5, 0) });
    return { pal: [[200, 200, 200], [40, 40, 40]], shapes: [{ pos: plate2.pos, idx: plate2.idx, tc: 0 }, { pos: screw.pos, idx: screw.idx, tc: 1 }], parts }; };
  // room for every part, but not for 3,200 triangles a screw: each screw is its box, where it was
  const A = E.liteBuild(mk(50), { budget: 3000 });
  assert.ok(A.tris <= 3000 && A.left === 0 && A.boxed === 1, JSON.stringify({ tris: A.tris, left: A.left, boxed: A.boxed }));
  const dark = []; for (let f = 0; f < A.segs[0].t.length / 3; f++) if (A.segs[0].tc[f] === 1) dark.push(f);
  assert.equal(dark.length, 50 * 12, 'twelve triangles a screw');
  // 4,000 of them into 3,000 triangles: there is no room even for boxes, so the screws are left out and the plate keeps the budget
  const B = E.liteBuild(mk(4000), { budget: 3000 });
  assert.equal(B.left, 4000);
  assert.ok(B.tris > 1500 && B.tris <= 3000, B.tris + ' triangles, all the plate\'s');
  const b = bounds(B.segs[0].v);
  assert.ok(b.mx[0] - b.mn[0] > 0.19 && b.mx[1] - b.mn[1] > 0.09, 'the plate is still 0.2 x 0.1 m');
});
