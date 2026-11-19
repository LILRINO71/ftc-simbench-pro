// The robot must look the same in both of its copies (src/view3d.js): the
// light copy a slow computer switches to (the frame-rate watchdog in app.js)
// and the hull/exact copy. They didn't: the hull's metal reflected nothing and
// drew near-black, the light copy reflected the room and drew near-white, so
// "after a while the robot turns white". Loaded with a stand-in for three.js
// that only records material parameters.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadView() {
  const THREE = {
    MeshStandardMaterial: function (p) { Object.assign(this, p || {}); this.userData = {}; },
    MeshBasicMaterial: function (p) { Object.assign(this, p || {}); this.userData = {}; },
    Color: function (r, g, b) { this.r = r; this.g = g; this.b = b; },
  };
  const src = fs.readFileSync(path.join(ROOT, 'src', 'view3d.js'), 'utf8');
  const api = new Function('THREE', 'window', 'document', src + '\nreturn { View, ROBOT_MAT, REAL_MAT, finishOf };')(THREE, {}, {});
  api.View.envMap = () => ({ env: true });          // the room both copies reflect
  return api;
}

test('robot look: the hull materials and the light copy reflect the same room', () => {
  const { View } = loadView();
  const hull = View.robotMat('metal'), lite = View.liteMat();
  assert.ok(hull.envMap && lite.envMap, 'both reflect the room');
  assert.ok(Math.abs(hull.envMapIntensity - lite.envMapIntensity) <= 0.35, 'with about the same strength');
});

test('robot look: the light copy has the exact meshes\' metal finish, so switching copies changes nothing', () => {
  const { View, REAL_MAT } = loadView();
  const lite = View.liteMat();
  assert.ok(Math.abs(lite.metalness - REAL_MAT.metal.m) <= 0.1, 'metalness ' + lite.metalness + ' vs ' + REAL_MAT.metal.m);
  assert.ok(Math.abs(lite.roughness - REAL_MAT.metal.r) <= 0.1, 'roughness ' + lite.roughness + ' vs ' + REAL_MAT.metal.r);
});

/* All the exact robot's metal used to share one finish, so a goBILDA red bracket, a black
   oxide screw plate and a bare aluminium channel all read as the same plastic. The part's
   own colour says which metal it is; only the finish follows it, never the colour. */
test('robot look: a metal part\'s colour picks its finish: anodised, black, or bare aluminium', () => {
  const { finishOf, REAL_MAT } = loadView();
  assert.equal(finishOf('metal', '#fd3030'), REAL_MAT.anodised, 'goBILDA red is anodised');
  assert.equal(finishOf('metal', '#3b61b4'), REAL_MAT.anodised, 'so is blue');
  assert.equal(finishOf('metal', 0xffd100), REAL_MAT.anodised, 'and gold, given as a number');
  assert.equal(finishOf('metal', '#2a2a2a'), REAL_MAT.darkmetal, 'near-black is black oxide');
  assert.equal(finishOf('metal', '#a5a5a5'), REAL_MAT.metal, 'grey is bare aluminium');
  assert.equal(finishOf('metal', null), REAL_MAT.metal, 'no colour: aluminium');
  assert.equal(finishOf('wheel', '#fd3030'), REAL_MAT.wheel, 'a red roller is still rubber');
  assert.ok(REAL_MAT.wheel.r > 0.7 && REAL_MAT.wheel.m === 0, 'rubber is rough and not metal');
  assert.ok(REAL_MAT.printed.m === 0, 'printed plastic is not metal');
});

test('robot look: a part with its own colour (Onshape, URDF) is drawn in it, lit like the rest', () => {
  const { View } = loadView();
  const m = View.robotMat('rgb:255,128,0');
  assert.deepEqual([m.color.r, m.color.g, m.color.b].map((v) => Math.round(v * 255)), [255, 128, 0]);
  assert.ok(m.envMap, 'reflects the same room');
});
