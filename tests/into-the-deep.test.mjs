// GearGurus 7832's Into The Deep robot (assets/robots/into-the-deep), the one
// the app opens with: the team's Onshape STEP, its joint spec, and the team's
// own TeleOp. Every mechanism the code drives has to move the way the robot
// does: the lift and its cascading stages, the outtake arm on its 1425.1
// ticks a turn, the servo cranks pushing the intake out through their rods,
// and the intake arm, wrist and claw.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadEngine, run } from './load.mjs';

const E = loadEngine();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITD = path.join(ROOT, 'assets', 'robots', 'into-the-deep');
const DEG = Math.PI / 180;

const itd = (() => {
  let got = null;
  return () => {
    if (got) return got;
    const text = zlib.gunzipSync(fs.readFileSync(path.join(ITD, 'robot.step.gz'))).toString('utf8');
    const cad = E.parseSTEP(text);
    const spec = JSON.parse(fs.readFileSync(path.join(ITD, 'joints.json'), 'utf8'));
    return (got = { cad, spec, R: E.applyJointSpec(cad, spec) });
  };
})();
function drive(file) {
  const { cad, R } = itd();
  const code = E.parseJava(fs.readFileSync(path.join(ITD, file), 'utf8'));
  const map = E.autoMap(code.devices, cad.mechs);
  for (const d of code.devices) { const j = R.devices[d.name] || R.devices[d.cfg]; if (j) map[d.name] = j; }
  E.Sim.reset(code, cad, map, { payloadKg: 0, duty: 0.3, trust: 'code', front: R.front, startPose: { x: 0, y: 0, h: 0 } });
  const own = new Map();
  for (const n in E.Sim.dev) { const s = E.Sim.dev[n]; if (s.mech && !own.has(s.mech.id)) own.set(s.mech.id, s); }
  const at = () => E.jointValues(cad.mechs, (m) => { const s = own.get(m.id); return s ? E.mateJointQ(m, s, 0.5) : (m.couple ? null : (m.q0 || null)); });
  const press = (b, hold = 2.5) => { E.Sim.pad = { 1: {}, 2: { [b]: true } }; run(E, 0.1); E.Sim.pad = { 1: {}, 2: {} }; run(E, hold); return at(); };
  return { code, map, at, press, cad };
}

test('Into The Deep: the spec puts the right parts on each joint', () => {
  const { cad, R } = itd();
  const on = (id) => cad.solids.filter((s) => s.mech === id);
  assert.equal(R.report.joints, 17);
  for (const m of cad.mechs.filter((x) => !x.drive)) assert.ok(on(m.id).length, m.id + ' carries parts');
  // the outtake arm's motor rides the lift carriage; the arm carries the outtake
  assert.ok(on('lift').some((s) => /Motor Part/.test(s.name)), 'arm motor on the carriage');
  assert.ok(on('arm').some((s) => /1102-0029-0232/.test(s.name)), 'arm beams on the arm');
  assert.ok(on('extend').some((s) => /Servo Frame/.test(s.name)) && on('inY').length >= 4, 'the intake rides the extension');
  // no drive wheel part rides a joint
  assert.ok(!cad.solids.some((s) => s.mech && (s.kind === 'wheel' || /Roller|Wheel Core|Slant Plate/.test(s.name))));
  assert.equal(R.front, '-x');
});

test('Into The Deep: sample_teleop maps every mechanism and drives it the way the robot does', () => {
  const { code, map, press, at } = drive('sample_teleop.java');
  for (const d of code.devices) {
    if (/Motor$/.test(d.name) || d.name === 'imu') continue;              // drive motors and the IMU
    assert.ok(map[d.name], d.name + ' drives a joint');
  }
  run(E, 0.5);
  const rest = at();
  assert.ok(Math.abs(rest.get('extend')) < 1e-6 && Math.abs(rest.get('inY')) < 1e-6, 'uncommanded servos stay where the CAD drew them');
  // X: the hand-off. Lift to 1150 ticks, arm to -1130 (1425.1 ticks a turn)
  let v = press('x', 3);
  assert.ok(Math.abs(v.get('lift') - 1150 * 0.26 / 1000) < 0.01, 'lift ' + v.get('lift'));
  assert.ok(Math.abs(v.get('arm') / DEG + 1130 / 1425.1 * 360) < 4, 'arm ' + (v.get('arm') / DEG).toFixed(1) + '°, no wind-up overshoot');
  assert.ok(Math.abs(v.get('lift stage 3') - v.get('lift') * 2 / 3) < 1e-3, 'the stages cascade');
  // Y: the high basket
  v = press('y', 3);
  assert.ok(v.get('lift') > 0.66 && v.get('lift') <= 0.7, 'lift up ' + v.get('lift'));
  assert.ok(Math.abs(v.get('arm') / DEG + 260 / 1425.1 * 360) < 4, 'arm ' + (v.get('arm') / DEG).toFixed(1) + '°');
  // A: the intake goes out through its linkage and the arm drops to look
  v = press('dpad_down', 3);
  assert.ok(v.get('lift') < 0.01, 'lift home');
  v = press('a');
  assert.ok(v.get('extend') > 0.2 && v.get('extend') < 0.235, 'extension ' + v.get('extend'));
  assert.ok(Math.abs(v.get('crank L') - v.get('crank R') - (-149.2 * DEG)) < 1e-6, 'both cranks turn together');
  assert.ok(v.get('inY') / DEG < -100, 'intake arm swung forward and down');
  v = press('b');
  assert.ok(Math.abs(v.get('extend')) < 1e-3, 'B brings it back in');
});

test('Into The Deep: the left linkage is drawn the same way up as the right, above the floor (issue #5)', () => {
  const { cad } = itd();
  const crank = cad.mechs.find((m) => m.id === 'crank L'), beam = cad.solids.find((s) => s.mech === 'crank L' && /Flat Beam/.test(s.name));
  assert.ok(Math.min(...beam.pts.map((p) => p[2])) < -0.09, 'as drawn, it goes through the floor');
  // turned by its drawn-pose fix about its pivot
  const a = crank.axis, q = crank.q0, c = Math.cos(q), s = Math.sin(q);
  const turn = (p) => { const v = [p[0] - crank.pivot[0], p[1] - crank.pivot[1], p[2] - crank.pivot[2]];
    const k = (a[0] * v[0] + a[1] * v[1] + a[2] * v[2]) * (1 - c), x = [a[1] * v[2] - a[2] * v[1], a[2] * v[0] - a[0] * v[2], a[0] * v[1] - a[1] * v[0]];
    return [0, 1, 2].map((i) => crank.pivot[i] + v[i] * c + x[i] * s + a[i] * k); };
  const low = Math.min(...beam.pts.map((p) => turn(p)[2]));
  assert.ok(low > 0.05, 'fixed, its lowest point is ' + (low * 1000).toFixed(0) + ' mm up');
  const right = cad.solids.find((s) => s.mech === 'crank R' && /Flat Beam/.test(s.name));
  const top = (pts) => Math.max(...pts.map((p) => p[2]));
  assert.ok(Math.abs(top(beam.pts.map(turn)) - top(right.pts)) < 0.01, 'and it reaches as high as the right crank');
});

test('Into The Deep: a saved workspace keeps the linkage, the rest poses and the drawn-pose fix', () => {
  const { cad } = itd();
  const S = E.sessionFromBench({ cad, java: 'class X {}', code: null, map: {}, opts: { payloadKg: 0, duty: 0.3, trust: 'code' }, chassis: { x: 0, y: 0, h: 0 } });
  const back = E.unpackSession(E.packSession(S));
  assert.ok(back.ok, back.error);
  const m = (id) => back.session.cad.mechs.find((x) => x.id === id);
  assert.equal(m('extend').couple.via, 'slider-crank');
  assert.ok(Math.abs(m('extend').couple.link.rod - 0.2718) < 2e-4);
  assert.equal(m('rod L').couple.link.slider, 'extend');
  assert.equal(m('crank L').restPos, 0.56);
  assert.ok(Math.abs(m('crank L').q0 + 149.2 * DEG) < 1e-6);
  assert.equal(m('lift').mmPerTick, 0.26);
});

test("Into The Deep: the team's Road Runner auto drives its path with its own helper classes", () => {
  const { cad, R } = itd();
  const libs = ['MecanumDrive.java', 'Arm.java', 'Arm_PID_Class.java', 'Slides_PID_Class.java'].map((f) => ({ file: f, src: fs.readFileSync(path.join(ITD, f), 'utf8') }));
  const code = E.parseJava(fs.readFileSync(path.join(ITD, 'TheHolyGrail.java'), 'utf8'), { libs });
  assert.equal(code.opmode, 'The Holy Grail');
  assert.ok(code.rr.notes.some((n) => /" bR"/.test(n)), 'the space in MecanumDrive\'s " bR" is pointed out');
  const map = E.autoMap(code.devices, cad.mechs);
  for (const d of code.devices) { const j = R.devices[d.name] || R.devices[d.cfg]; if (j) map[d.name] = j; }
  E.Sim.reset(code, cad, map, { payloadKg: 0, duty: 0.3, trust: 'code', front: R.front });
  const IN = 0.0254, at = () => E.Sim.rr.pose();
  assert.ok(Math.abs(E.Sim.chassis.x / IN + 10) < 1e-6 && Math.abs(E.Sim.chassis.y / IN - 61.5) < 1e-6, 'placed at (-10, 61.5)');
  // Road Runner's forward is the way all four drive motors push: the outtake side
  assert.equal(E.Sim.rr.flip, Math.PI);
  assert.equal(E.Sim.rr.mirrored, false);
  // the waypoints it has to pass, in order: the chamber, the wall, the chamber again …
  const want = [[-10, 31.5], [35, 61.25], [-23, 31], [17, 61.25], [-21, 35], [17, 61.25], [-19, 35], [17, 61.5], [-18.95, 35]];
  const best = want.map(() => Infinity), when = want.map(() => null);
  let armAt = null;
  for (let i = 0; i < 28 / 0.02; i++) {
    run(E, 0.02);
    const p = at();
    want.forEach((w, k) => { const d = Math.hypot(p.x - w[0], p.y - w[1]); if (d < best[k]) { best[k] = d; when[k] = E.Sim.t; } });
    if (armAt == null && E.Sim.t > 2.2) armAt = E.Sim.dev.Arm.ticks - (E.Sim.dev.Arm.offset || 0);
  }
  want.forEach((w, k) => assert.ok(best[k] < 2, `reaches (${w}) within 2 in (${best[k].toFixed(2)} in at ${when[k] && when[k].toFixed(1)} s)`));
  assert.ok(when[0] < 3 && when[2] > when[1], 'in order');
  assert.ok(Math.abs(Math.cos(at().h - 270 * DEG) - 1) < 0.01, 'still square to the field, facing 270°');
  assert.ok(armAt < -300, 'the arm is up at the chamber (' + Math.round(armAt) + ' ticks)');
  assert.equal(E.Sim.dev.outClaw.cmd, 0.35, 'and the claw has let the last specimen go');
  // the slides' PID action is never started in this auto: the Checks say so
  const F = E.analyze(code, cad, map, { payloadKg: 0.1, duty: 0.3, trust: 'code', front: R.front });
  assert.ok(F.some((f) => f.key === 'rr:plan'));
  assert.ok(F.some((f) => /uppies is never commanded/.test(f.title.replace(/<[^>]+>/g, ''))));
  assert.ok(!F.some((f) => f.sev === 'fail'), F.filter((f) => f.sev === 'fail').map((f) => f.title).join('; '));
});
