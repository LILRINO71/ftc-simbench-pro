// View.load (src/view3d.js) runs on every robot load and every joint, mate or
// rig change. It throws the old scene away and builds a new one, so anything
// View keeps a handle on inside that scene has to be dropped with it. The ball
// trails weren't: after any View.load the trails moved meshes that were no
// longer in the scene, so balls in the air lost their trails for good.
// Loaded with a stand-in for three.js that only keeps the scene graph.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class Obj {
  constructor() { this.isObject3D = true; this.children = []; this.parent = null; this.visible = true; this.userData = {};
    const v = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, copy(o) { return this.set(o.x, o.y, o.z); } });
    this.position = v(); this.scale = v(); }
  add(o) { if (o.parent) o.parent.remove(o); this.children.push(o); o.parent = this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; }
  traverse(f) { f(this); for (const c of this.children) c.traverse(f); }
}
function loadView() {
  const color = () => ({ setHex() { return this; }, convertSRGBToLinear() { return this; } });
  const THREE = {
    Group: class extends Obj {},
    Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
    MeshBasicMaterial: class { constructor(p) { Object.assign(this, p || {}); this.color = color(); this.userData = {}; } dispose() {} },
    MeshStandardMaterial: class { constructor(p) { Object.assign(this, p || {}); this.isMaterial = true; this.userData = {}; } dispose() { this.disposed = true; } },
    Color: class { constructor(...a) { this.a = a; } },
    SphereGeometry: class { constructor() { this.userData = {}; } dispose() {} },
    RingGeometry: class { constructor() { this.userData = {}; } dispose() {} },
    Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } },
    Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } },
    // what src/shotfx.js builds its pooled effects from: it only needs the scene graph and the attribute buffers
    BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; } setUsage() { return this; } },
    BufferGeometry: class { constructor() { this.attributes = {}; this.userData = {}; } setAttribute(n, a) { this.attributes[n] = a; return this; } setIndex() {} dispose() {} },
    ShaderMaterial: class { constructor(p) { Object.assign(this, p || {}); this.userData = {}; } dispose() {} },
    LineBasicMaterial: class { constructor(p) { Object.assign(this, p || {}); this.color = color(); this.userData = {}; } dispose() {} },
    Points: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
    Line: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
    Sprite: class extends Obj { constructor(m) { super(); this.material = m; } },
    SpriteMaterial: class { constructor(p) { Object.assign(this, p || {}); this.color = { setRGB() {} }; this.userData = {}; } dispose() {} },
    DynamicDrawUsage: 1, AdditiveBlending: 2, NormalBlending: 1, DoubleSide: 2,
  };
  THREE.MeshBasicMaterial = class { constructor(p) { Object.assign(this, p || {}); this.color = { setHex() { return this; }, setRGB() {}, convertSRGBToLinear() { return this; } }; this.userData = {}; } dispose() {} };
  const fx = fs.readFileSync(path.join(ROOT, 'src', 'shotfx.js'), 'utf8');
  const src = fx + '\n' + fs.readFileSync(path.join(ROOT, 'src', 'view3d.js'), 'utf8');
  const { View, ShotFx } = new Function('THREE', 'window', 'document', 'Field', 'IN', 'SHOT_STEP_S', src + '\nreturn { View, ShotFx };')(THREE, {}, {}, { ok: false }, 0.0254, 0.01);
  View.tier = { tier: 2 }; View.ShotFx = ShotFx;
  // the parts of a load that draw the field and the robot aren't what this is about
  View.buildPlainField = () => {}; View.buildRobot = () => {};
  View.world = new THREE.Group();
  return View;
}

const CAD = { bbox: { min: [-0.2, -0.2, 0], max: [0.2, 0.2, 0.4] }, frame: {}, solids: [], mechs: [] };
const inScene = (View, m) => { let o = m; while (o.parent) o = o.parent; return o === View.world; };
const flight = () => [{ path: [[0, 0, 10], [10, 0, 20], [20, 0, 25]], t: 0.05, dur: 0.02, step: 0.01, kind: 'pollen', al: 'red' }];
// every object the shot effects made (src/shotfx.js)
const fxObjects = (ShotFx) => [ShotFx.sparks.mesh, ...ShotFx.trPool.items.map((t) => t.mesh), ...ShotFx.rings.items.map((r) => r.m), ...ShotFx.popups.items.map((p) => p.s)];

test('view: ball trails are drawn again after View.load', () => {
  const View = loadView(), ShotFx = View.ShotFx;
  View.load(CAD);
  const f1 = flight();
  View.flightFx(f1, 1000); View.trails(f1);
  assert.equal(ShotFx.liveT.length, 1, 'a ball in the air has a trail');
  assert.ok(fxObjects(ShotFx).every((m) => inScene(View, m)), 'the effects are in the scene to start with');
  View.load(CAD);                                   // a joint edit, a mate, a rig change...
  const f2 = flight();
  View.flightFx(f2, 1100); View.trails(f2);
  assert.equal(ShotFx.liveT.length, 1, 'a ball in the air still has its trail');
  assert.ok(fxObjects(ShotFx).every((m) => inScene(View, m)), 'and the effect meshes are in the scene that is drawn');
  // a ball already in the air when the scene is rebuilt gets a trail in the new one too
  View.flightFx(f2, 1150); View.load(CAD); View.flightFx(f2, 1200);
  assert.equal(ShotFx.liveT.length, 1, 'a flight that was under way when the scene changed');
  assert.ok(ShotFx.liveT[0].mesh.visible && inScene(View, ShotFx.liveT[0].mesh));
});

/* A lost WebGL context that comes back (a driver reset; headless Chrome's
   software GL at start-up) killed every buffer and texture made before it.
   Each geometry and texture still carried the dead context's dispose handler,
   so the next robot load asked WebGL to delete hundreds of objects "that do not
   belong to this context"; and the reflection map, drawn on the GPU, came back
   black, so every metal part went dark. */
test('view: after a lost context comes back, old dispose handlers go and the reflections are redrawn', () => {
  const View = loadView();
  View.load(CAD);
  const handler = () => { throw new Error('the dead context\'s handler ran'); };
  const geo = { isBufferGeometry: true, _listeners: { dispose: [handler] } };
  const tex = { isTexture: true, _listeners: { dispose: [handler] } };
  const oldEnv = { isTexture: true, _listeners: { dispose: [handler] } }, newEnv = { isTexture: true };
  const mat = { isMaterial: true, map: tex, envMap: oldEnv };
  const cached = { isMaterial: true, envMap: oldEnv };              // not drawn right now, kept for the next robot
  const cachedGeo = { isBufferGeometry: true, _listeners: { dispose: [handler] } };
  const mesh = new Obj(); mesh.geometry = geo; mesh.material = mat; View.world.add(mesh);
  View.scene = new Obj(); View.scene.add(View.world);
  View._env = oldEnv; View._rmat = { metal: cached }; View.shapeCache = new Map([['s', { g: cachedGeo }]]);
  View.envMap = function () { if (this._env === undefined) this._env = newEnv; return this._env; };
  View.contextRestored();
  for (const [what, x] of [['drawn geometry', geo], ['its texture', tex], ['the old reflections', oldEnv], ['a cached shape', cachedGeo]])
    assert.equal(x._listeners.dispose.length, 0, what + ' still has the dead context\'s dispose handler');
  assert.equal(mat.envMap, newEnv, 'a drawn part reflects the new map');
  assert.equal(cached.envMap, newEnv, 'so does a cached material');
  assert.ok(mat.needsUpdate && cached.needsUpdate);
});

test('view: an effect from before View.load is not kept', () => {
  const View = loadView(), ShotFx = View.ShotFx;
  View.load(CAD);
  View.fx('puff', { x: 0, y: 0, z: 0 }, 0xffffff);
  const old = fxObjects(ShotFx), oldGroup = View.dynG;
  assert.ok(old.length > 0 && old.every((m) => m.parent === oldGroup));
  View.load(CAD);
  View.fx('puff', { x: 0, y: 0, z: 0 }, 0xffffff);
  assert.notEqual(View.dynG, oldGroup);
  assert.ok(old.every((m) => m.parent !== View.dynG), 'the old scene\'s effects went with it');
  assert.ok(fxObjects(ShotFx).every((m) => m.parent === View.dynG), 'new ones live in the new scene');
});

/* The material caches are keyed by colour (finishMat for the exact surfaces,
   robotMat's "rgb:" entries for a robot read from Onshape or a URDF) and were
   never emptied, so every robot loaded added its whole palette for good. */
test('view: the last robot\'s colours leave the material caches when another robot loads', () => {
  const View = loadView();
  View.envMap = () => null;
  const A = { ...CAD }, B = { ...CAD };
  View.load(A);
  const fin = View.finishMat(0xff0000, 'metal'), rgb = View.robotMat('rgb:255,0,0'), fixed = View.robotMat('metal');
  View.load(A);                                     // a joint or rig change: the same robot keeps its materials
  assert.equal(View.finishMat(0xff0000, 'metal'), fin);
  assert.equal(View.robotMat('rgb:255,0,0'), rgb);
  View.load(B);
  assert.ok(fin.disposed && rgb.disposed, 'the old robot\'s colours are given back');
  assert.equal(Object.keys(View._mats).length, 0);
  assert.ok(!('rgb:255,0,0' in View._rmat));
  assert.equal(View.robotMat('metal'), fixed, 'the fixed finishes stay');
  assert.ok(!fixed.disposed);
});
