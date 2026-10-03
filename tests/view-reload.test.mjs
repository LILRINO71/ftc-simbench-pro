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
  constructor() { this.children = []; this.parent = null; this.visible = true; this.userData = {};
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
    SphereGeometry: class { constructor() { this.userData = {}; } dispose() {} },
    RingGeometry: class { constructor() { this.userData = {}; } dispose() {} },
    Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } },
  };
  const src = fs.readFileSync(path.join(ROOT, 'src', 'view3d.js'), 'utf8');
  const { View } = new Function('THREE', 'window', 'document', 'Field', 'IN', 'SHOT_STEP_S', src + '\nreturn { View };')(THREE, {}, {}, { ok: false }, 0.0254, 0.01);
  // the parts of a load that draw the field and the robot aren't what this is about
  View.buildPlainField = () => {}; View.buildRobot = () => {};
  View.world = new THREE.Group();
  return View;
}

const CAD = { bbox: { min: [-0.2, -0.2, 0], max: [0.2, 0.2, 0.4] }, frame: {}, solids: [], mechs: [] };
const inScene = (View, m) => { let o = m; while (o.parent) o = o.parent; return o === View.world; };
const flight = [{ path: [[0, 0, 10], [10, 0, 20], [20, 0, 25]], t: 0.05, step: 0.01, kind: 'pollen' }];

test('view: ball trails are drawn again after View.load', () => {
  const View = loadView();
  View.load(CAD);
  View.trails(flight);
  assert.ok(View.trailG.length >= 4 && View.trailG.every((m) => inScene(View, m)), 'trails in the scene to start with');
  View.load(CAD);                                   // a joint edit, a mate, a rig change...
  View.trails(flight);
  const shown = View.trailG.filter((m) => m.visible);
  assert.ok(shown.length >= 4, 'a ball in the air still has its trail');
  assert.ok(shown.every((m) => inScene(View, m)), 'and the trail meshes are in the scene that is drawn');
});

test('view: an effect from before View.load is not kept', () => {
  const View = loadView();
  View.load(CAD);
  View.fx('puff', { x: 0, y: 0, z: 0 }, 0xffffff);
  assert.equal(View.fxs.length, 1);
  View.load(CAD);
  assert.equal(View.fxs.length, 0, 'the old scene\'s effects went with it');
});
