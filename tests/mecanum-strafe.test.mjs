// A mecanum base must not strafe farther than it drives. Ideal mecanum
// kinematics strafe exactly as fast as they drive forward; real rollers slip,
// so a real robot strafes at about 70-90% of its forward speed. Anything over
// 1.0 is the physics inventing speed sideways.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadEngine, run } from './load.mjs';

const E = loadEngine();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Wheels FL, FR, BL, BR in the standard X; equal |power| on every wheel. */
function mecRig(opts = {}) {
  const L = opts.L || 0.40, W = opts.W || 0.36;
  const corners = [['FL', L / 2, W / 2, 1], ['FR', L / 2, -W / 2, -1], ['BL', -L / 2, W / 2, -1], ['BR', -L / 2, -W / 2, 1]];
  const spec = { rpm: opts.rpm || 312, stallNm: opts.stallNm || 2.38 };
  const R = {
    props: { kg: opts.kg || 12, com: { x: 0, y: 0, z: 0.1 }, Izz: 0.4, comHeight: 0.1 },
    drive: { kind: 'mecanum', wheels: corners.map(([corner, x, y, roller]) => ({ corner, x, y, z: 0, r: 0.048, roller })) },
    motors: [spec, spec, spec, spec], gear: 1, mu: 0.9,
  };
  R.drive.ik = E.ikMatrix('mecanum', R.drive.wheels);
  return R;
}
// 0.8 s at a fixed command, then 0.8 s coasting; distance covered in the body frame
function travel(R, cmd) {
  let st = E.Dyn.reset(R), x = 0, y = 0;
  for (let i = 0; i < 80; i++) {
    st = E.Dyn.step(st, i < 40 ? cmd : [0, 0, 0, 0], R, 0.02);
    x += st.v.x * 0.02; y += st.v.y * 0.02;
  }
  return { x, y };
}

test('Dyn: a mecanum rig strafes 0.6-1.0 of the distance it drives, same wheel power', () => {
  for (const o of [{}, { kg: 18 }, { kg: 6, rpm: 435, stallNm: 1.9 }]) {
    const R = mecRig(o);
    for (const p of [0.3, 0.6, 1]) {
      const fwd = travel(R, [p, p, p, p]);
      const right = travel(R, [p, -p, -p, p]);
      const left = travel(R, [-p, p, p, -p]);
      assert.ok(fwd.x > 0.05 && Math.abs(fwd.y) < 1e-3, `forward goes forward: ${JSON.stringify(fwd)}`);
      assert.ok(right.y < 0 && left.y > 0, 'FL+BR forward strafes right, FR+BL forward strafes left');
      for (const s of [-right.y, left.y]) {
        const ratio = s / fwd.x;
        assert.ok(ratio >= 0.6 && ratio <= 1.0, `${JSON.stringify(o)} power ${p}: strafe ${s.toFixed(3)} m vs forward ${fwd.x.toFixed(3)} m (${ratio.toFixed(2)})`);
      }
    }
  }
});

test('Sim: the Mecanum Drive + Lift sample on the default robot strafes no farther than it drives', () => {
  const ITD = path.join(ROOT, 'assets', 'robots', 'into-the-deep');
  const cad = E.parseSTEP(zlib.gunzipSync(fs.readFileSync(path.join(ITD, 'robot.step.gz'))).toString('utf8'));
  const R = E.applyJointSpec(cad, JSON.parse(fs.readFileSync(path.join(ITD, 'joints.json'), 'utf8')));
  const code = E.parseJava(E.DRIVE_JAVA);
  const map = E.autoMap(code.devices, cad.mechs);
  const go = (pad) => {
    E.Sim.reset(code, cad, map, { payloadKg: 0, trust: 'code', front: R.front, startPose: { x: 0, y: 0, h: 0 } });
    E.Sim.obstacles = [];
    E.Sim.pad = { 1: pad, 2: {} }; run(E, 0.8);
    E.Sim.pad = { 1: {}, 2: {} }; run(E, 0.8);
    return Math.hypot(E.Sim.chassis.x, E.Sim.chassis.y);
  };
  const fwd = go({ left_stick_y: -0.6 });
  assert.equal(E.Sim.rig.drive.kind, 'mecanum');
  const strafe = go({ left_stick_x: 0.6 });
  const ratio = strafe / fwd;
  assert.ok(fwd > 0.2, `forward ${fwd.toFixed(3)} m`);
  assert.ok(ratio >= 0.6 && ratio <= 1.0, `strafe ${strafe.toFixed(3)} m vs forward ${fwd.toFixed(3)} m (${ratio.toFixed(2)})`);
});
