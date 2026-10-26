// What a frame and a rebuild cost (src/view3d.js, src/app.js). The view drew the
// whole picture, ambient occlusion and all, 60 times a second with nothing moving;
// every rebuild (a joint edit, a rig change, the turret slider) painted the 2048-pixel
// tile texture again, hashed every edge of the robot again, and let the old world's
// shader programs go before the new world drew, so each one was compiled again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
const VIEW = fs.readFileSync(path.join(ROOT, 'src', 'view3d.js'), 'utf8');
const grab = (src, re, what) => { const m = re.exec(src); assert.ok(m, what + ' not found'); return m[0]; };
/* one method of the View object, as a function body that can be set on a stub */
const method = (name) => grab(VIEW, new RegExp('\\n  ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n  \\},?\\n'), 'View.' + name)
  .trim().replace(/,$/, '');

function stillBench() {
  const ctx = { Sim: { chassis: { x: 0, y: 0, h: 0 }, phase: 'init' }, View: { loadN: 1 }, Field: { ok: true, version: 0 },
    Online: { state: 'off' }, Recorder: { on: false }, Pads: { sig: '' }, performance: { now: () => 0 }, addEventListener() {} };
  vm.createContext(ctx);
  vm.runInContext(grab(APP, /\nconst Still=\{[\s\S]*?\n\};\n/, 'Still') + 'this.Still=Still;', ctx);
  return ctx;
}

test('still: nothing moving for 1.5 s, no hand on the page, no match, no clip', () => {
  const c = stillBench(), S = c.Still;
  assert.equal(S.now(0), false, 'the first frame always draws');
  assert.equal(S.now(1000), false);
  assert.equal(S.now(1600), true);
  S.poke(); c.performance.now = () => 1700;
  S.poke(); assert.equal(S.now(2000), false, 'a key or the mouse wakes it');
  assert.equal(S.now(3300), true);
  c.Sim.chassis = { x: 0.1, y: 0, h: 0 };
  assert.equal(S.now(3400), false, 'the robot moved (dragged, placed by a link)');
  assert.equal(S.now(5000), true);
  c.View.loadN = 2; assert.equal(S.now(5100), false, 'a new world');
  assert.equal(S.now(7000), true);
  c.Field.version = 3; assert.equal(S.now(7100), false, 'the field changed');
});

test('still: never while the sim runs, a match is online, a clip records or a controller is in use', () => {
  for (const [what, set] of [['running', (c) => { c.Sim.phase = 'running'; }], ['online', (c) => { c.Online.state = 'room'; }],
    ['recording', (c) => { c.Recorder.on = true; }], ['controller', (c) => { c.Pads.sig = '0:1'; }]]) {
    const c = stillBench(); c.Still.now(0); set(c);
    assert.equal(c.Still.now(10000), false, what);
  }
  const c = stillBench(); c.Pads.sig = '0:0'; c.Still.now(0);
  assert.equal(c.Still.now(10000), true, 'a controller switched off is no hand on it');
});

function drawBench() {
  const ctx = { IDLE_EVERY: 4, Float64Array };
  vm.createContext(ctx);
  vm.runInContext('this.V={' + method('skipDraw') + '};', ctx);
  const V = ctx.V;
  const cam = (id, x) => ({ id, matrixWorld: { elements: Array.from({ length: 16 }, (_, i) => (i === 12 ? x : i % 5 ? 0 : 1)) },
    projectionMatrix: { elements: Array.from({ length: 16 }, (_, i) => (i % 5 ? 0 : 1)) }, updateMatrixWorld() {} });
  return { V, cam };
}

test('skip draw: still with the camera where it was, one frame in four; anything else draws', () => {
  const { V, cam } = drawBench(), a = cam(1, 0);
  V.still = true;
  const drawn = () => { let n = 0; for (let i = 0; i < 12; i++) if (!V.skipDraw(a)) n++; return n; };
  assert.equal(V.skipDraw(a), false, 'the first frame of a camera draws');
  assert.equal(drawn(), 3, 'twelve still frames draw three');
  assert.equal(V.skipDraw(cam(1, 0.01)), false, 'the camera moved (an orbit settling, a view change)');
  assert.equal(V.skipDraw(cam(2, 0.01)), false, 'another camera (the CAD view)');
  V.camKey[32] = -1;                                    // what resize() does: a new size clears the canvas
  assert.equal(V.skipDraw(cam(2, 0.01)), false, 'a resized canvas draws');
  V.still = false;
  for (let i = 0; i < 8; i++) assert.equal(V.skipDraw(cam(2, 0.01)), false, 'moving: every frame');
});

test('draw: a skipped frame says so, and the old world goes only once the new one has drawn', () => {
  const log = [];
  const ctx = { log };
  vm.createContext(ctx);
  vm.runInContext('this.V={retired:[],' + method('draw') + '};', ctx);
  const V = ctx.V;
  Object.assign(V, { post: null, scene: {}, ren: { render: () => log.push('render') }, dispose: (o) => log.push('dispose ' + o) });
  V.skipDraw = () => true; V.retired.push('old');
  assert.equal(V.draw({}), false, 'nothing may be drawn over a skipped frame (the CAD view cube)');
  assert.deepEqual(log, [], 'nor the old world let go before a frame of the new one');
  V.skipDraw = () => false;
  assert.equal(V.draw({}), true);
  assert.deepEqual(log, ['render', 'dispose old'], 'drawn first: the new materials take the old ones\' programs');
  assert.ok(/this\.retired\.push\(o\)/.test(method('load')), 'load() retires the old world instead of disposing it');
});

test('tile texture: painted once per layout, kept through a rebuild, not disposed with the field', () => {
  let painted = 0;
  const canvas = () => ({ getContext: () => ({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, putImageData() {},
    getImageData: () => { painted++; return { data: new Uint8ClampedArray(8) }; } }) });
  const ctx = { document: { createElement: canvas }, srgbTex: (t) => t,
    THREE: { CanvasTexture: class { constructor() { this.userData = {}; this.disposed = 0; } dispose() { this.disposed++; } } } };
  vm.createContext(ctx);
  vm.runInContext('this.V={' + method('tileTexture') + ',' + method('dispose') + '};', ctx);
  const V = ctx.V, t = V.tileTexture([24, 48], 72);
  assert.equal(V.tileTexture([24, 48], 72), t, 'the same seams: the same texture');
  assert.equal(painted, 1);
  const mesh = { geometry: { userData: {}, dispose() {} }, material: { userData: {}, map: t, dispose() {} } };
  V.dispose({ traverse: (f) => f(mesh) });
  assert.equal(t.disposed, 0, 'the field going leaves the shared texture');
  const u = V.tileTexture([30], 72);
  assert.notEqual(u, t); assert.equal(painted, 2); assert.equal(t.disposed, 1, 'a new layout lets the old texture go');
});

test('solid edges: hashed once per solid, again only when its triangles change', () => {
  let hashed = 0;
  const THREE = {
    BufferGeometry: class { setAttribute(k, a) { this.a = a; } dispose() {} },
    Float32BufferAttribute: class { constructor(a) { this.array = Float32Array.from(a); } },
    EdgesGeometry: class { constructor(g) { hashed++; this.p = { array: g.a.array.slice(0, 6) }; } getAttribute() { return this.p; } dispose() {} },
  };
  const ctx = { THREE, WeakMap };
  vm.createContext(ctx);
  vm.runInContext(grab(VIEW, /\nconst SOLID_EDGES=[\s\S]*?\n\}\n/, 'solidEdges') + 'this.solidEdges=solidEdges;', ctx);
  const s = { tri: { pos: [0, 0, 0, 1, 0, 0, 0, 1, 0], nor: [] } };
  const e = ctx.solidEdges(s);
  assert.equal(ctx.solidEdges(s), e); assert.equal(hashed, 1, 'a rebuild copies the kept outline');
  s.tri.pos.push(0, 0, 1, 1, 0, 1, 0, 1, 1); ctx.solidEdges(s);
  assert.equal(hashed, 2, 'triangles added in place');
  s.tri = { pos: [0, 0, 0, 2, 0, 0, 0, 2, 0], nor: [] }; ctx.solidEdges(s);
  assert.equal(hashed, 3, 'triangles made again (src/frame.js re-frames a solid)');
  assert.ok(!Object.keys(s).some((k) => k !== 'tri'), 'nothing on the solid itself (a saved workspace never carries it)');
});

test('field: fixed parts merged by material; staged balls, see-through panels and groups kept as they are', () => {
  // just enough of three for mergeStatic: points as [x,y,z], matrices as a shift
  class V3 { constructor() { this.x = this.y = this.z = 0; }
    fromBufferAttribute(a, i) { this.x = a.array[i * 3]; this.y = a.array[i * 3 + 1]; this.z = a.array[i * 3 + 2]; return this; }
    applyMatrix4(m) { this.x += m.t[0]; this.y += m.t[1]; this.z += m.t[2]; return this; } applyMatrix3() { return this; } normalize() { return this; } }
  class Attr { constructor(array, n) { this.array = array; this.itemSize = n; this.count = array.length / n; } getX(i) { return this.array[i * this.itemSize]; } getY(i) { return this.array[i * this.itemSize + 1]; } }
  class Geo { constructor() { this.attributes = {}; this.morphAttributes = {}; this.groups = []; this.index = null; this.userData = {}; this.disposed = 0; }
    setAttribute(k, a) { this.attributes[k] = a; } dispose() { this.disposed++; } }
  class Mesh { constructor(g, m) { this.geometry = g; this.material = m; this.children = []; this.visible = true; this.userData = {}; this.castShadow = false; this.receiveShadow = false; this.renderOrder = 0; this.isMesh = true; this.t = [0, 0, 0]; }
    updateMatrix() { this.matrix = { t: this.t }; } }
  const THREE = { Vector3: V3, Matrix3: class { getNormalMatrix() { return this; } }, BufferGeometry: Geo, BufferAttribute: Attr, Mesh };
  const ctx = { THREE, Float32Array, Map };
  vm.createContext(ctx);
  vm.runInContext('this.V={' + method('mergeStatic') + '};', ctx);
  const mat = (o) => Object.assign({ uuid: Math.random().toString(36), transparent: false }, o);
  const tri = () => { const g = new Geo(); g.setAttribute('position', new Attr(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('normal', new Attr(Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3)); g.groups = [{ start: 0, count: 3 }]; return g; };
  const steel = mat(), poly = mat({ transparent: true }), tape = mat();
  const g = { children: [], remove(o) { this.children.splice(this.children.indexOf(o), 1); }, add(o) { this.children.push(o); } };
  const at = (m, x) => { const o = new Mesh(tri(), m); o.t = [x, 0, 0]; o.castShadow = true; g.add(o); return o; };
  const a = at(steel, 0), b = at(steel, 5); at(steel, 9).castShadow = false;
  at(poly, 0); at(poly, 1);
  const ball = at(tape, 0); ball.userData.staged = true; at(tape, 2);
  const hive = at(tape, 3); hive.children.push({});
  ctx.V.mergeStatic(g);
  assert.equal(g.children.length, 7, 'the two shadow-casting steel parts became one');
  const merged = g.children[g.children.length - 1];
  assert.equal(merged.material, steel); assert.equal(merged.castShadow, true);
  assert.deepEqual(Array.from(merged.geometry.attributes.position.array.filter((_, i) => i % 3 === 0)), [0, 1, 0, 5, 6, 5], 'each where it stood');
  assert.ok(!g.children.includes(a) && !g.children.includes(b) && a.geometry.disposed === 1);
  assert.ok(g.children.includes(ball) && g.children.includes(hive), 'what moves or hides stays its own');
  assert.equal(g.children.filter((o) => o.material === poly).length, 2, 'see-through panels still sort one by one');
});
