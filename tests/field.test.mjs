// The BIOBUZZ field, collisions and shots, run through the real engine files
// plus the vendored BIOBUZZ Shot Sim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadWithField, sampleBench, run } from './load.mjs';

const inch = (E, m) => m / E.IN;

function shooterBench() {
  const E = loadWithField();
  const b = sampleBench(E, E.SHOOTER_JAVA);
  b.opts.startPose = E.Field.startPose('red', E.footprintOf(b.cad, '+x'));
  E.Shots.cfg = null;
  E.Sim.reset(b.code, b.cad, b.map, b.opts);
  E.Shots.reset();
  E.Shots.alliance = 'red';
  E.Shots.adopt(b.code);
  return { E, ...b };
}
const press = (E, pad, btn, seconds) => { E.Sim.pad[pad][btn] = true; run(E, seconds); E.Sim.pad[pad][btn] = false; };

test('field: built from the Shot Sim\'s measured BIOBUZZ data', () => {
  const E = loadWithField();
  assert.equal(E.Field.ok, true);
  assert.ok(Math.abs(inch(E, E.Field.half()) - 70.5) < 1e-9, '141 in between the walls');
  const hm = E.Field.model();
  const red = hm.hives.find((h) => h.alliance === 'red');
  assert.equal(red.hx, -12.75);
  assert.equal(red.sigma, -1, 'red up-CELL starts on the audience side');
  assert.equal(E.Field.cells.red.length, 3, 'three NECTAR staged in each up-CELL');
  const kinds = E.Field.obstacles(0.4).map((o) => o.what);
  assert.equal(kinds.filter((k) => k === 'HIVE leg').length, 4);
  assert.equal(kinds.filter((k) => k === 'HIVE foot bar').length, 2);
  assert.equal(kinds.filter((k) => k === 'FLOWER').length, 4);
});

test('field: without the Shot Sim the bench keeps its plain field', () => {
  const E = loadEngine();
  assert.equal(E.Field.init(null, null), false);
  assert.equal(E.Field.ok, false);
  const { cad, code, map, opts } = sampleBench(E, E.DRIVE_JAVA);
  E.Sim.reset(code, cad, map, opts);
  E.Sim.pad[1].left_stick_y = -1;
  run(E, 6);
  assert.ok(E.Sim.chassis.x <= 1.78 + 1e-9, 'old half-field clamp still applies');
});

test('start pose: touching the alliance wall, facing the field, clear of the LOADING ZONE and FLOWER', () => {
  const E = loadWithField();
  const fp = { hx: 9 * E.IN, hy: 9 * E.IN, h: 0.4 };
  const red = E.Field.startPose('red', fp), blue = E.Field.startPose('blue', fp);
  assert.ok(Math.abs(inch(E, red.x) - (-70.5 + 9)) < 1e-9);
  assert.equal(red.h, 0);
  assert.ok(Math.abs(inch(E, blue.x) - (70.5 - 9)) < 1e-9);
  assert.ok(Math.abs(blue.h - Math.PI) < 1e-12);
  for (const p of [red, blue]) {
    const ch = { ...p };
    assert.equal(E.Field.collide(ch, fp, E.Field.obstacles(fp.h)), null, 'nothing to push it off');
    assert.ok(!/LOADING/.test(E.Field.zoneAt(inch(E, p.x), inch(E, p.y))));
  }
});

test('collisions: driving at the HIVE stops against the foot bar, never through it', () => {
  const { E } = shooterBench();
  E.Sim.pad[1].left_stick_y = -1;
  run(E, 4);
  const c = E.Sim.chassis, fp = E.Sim.footprint;
  const frontEdge = inch(E, c.x + fp.hx);
  assert.ok(frontEdge <= -24 + 0.73 + 0.05 && frontEdge > -24 - 0.73 - 0.3, `front edge at ${frontEdge.toFixed(2)} in`);
  assert.equal(E.Sim.bump, 'HIVE foot bar');
});

test('collisions: a spinning robot in a corner stays inside the walls', () => {
  const { E } = shooterBench();
  E.Sim.chassis = { x: -1.5, y: -1.5, h: 0.3 };
  E.Sim.pad[1].left_stick_x = -1; E.Sim.pad[1].left_stick_y = 1; E.Sim.pad[1].right_stick_x = 0.7;
  const H = E.Field.half(), fp = E.Sim.footprint;
  for (let i = 0; i < 300; i++) {
    E.Sim.tick(0.02);
    const c = E.Sim.chassis, a = Math.abs(Math.cos(c.h)), s = Math.abs(Math.sin(c.h));
    const ex = a * fp.hx + s * fp.hy, ey = s * fp.hx + a * fp.hy;
    assert.ok(c.x - ex >= -H - 1e-6 && c.x + ex <= H + 1e-6 && c.y - ey >= -H - 1e-6 && c.y + ey <= H + 1e-6, `left the field at tick ${i}`);
  }
});

test('setVelocity: ticks per second become a share of the motor\'s free speed', () => {
  const { E } = shooterBench();
  const fw = E.Sim.dev.flywheel;
  assert.equal(fw.spec.rpm, 6000, 'the "// 6000 rpm" comment picks the 1:1 Yellow Jacket');
  assert.equal(fw.tpr, 28);
  press(E, 2, 'dpad_down', 0.1);
  run(E, 1);
  assert.ok(Math.abs(fw.act - 1080 / 2800) < 1e-6, `flywheel at ${fw.act}`);
});

test('shooter: found by name in the code; a claw OpMode has none', () => {
  const E = loadWithField();
  assert.deepEqual(E.Shots.detect(E.parseJava(E.SHOOTER_JAVA)), { shooter: ['flywheel'], feeder: ['kicker'] });
  assert.deepEqual(E.Shots.detect(E.parseJava(E.SAMPLE_JAVA)), { shooter: [], feeder: [] });
});

test('verdict: a mid-field spot works, the far corner does not', () => {
  const { E } = shooterBench();
  const at = (x, y) => E.Field.E.evaluate(E.Shots.params({ x: x * E.IN, y: y * E.IN, h: 0 }), 'coarse');
  assert.equal(at(-40, -30).verdict, 'POSSIBLE');
  assert.equal(at(60, 60).verdict, "WON'T WORK");
});

test('hood window: speeds inside it score, speeds outside miss', () => {
  const { E } = shooterBench();
  const pose = { x: -40 * E.IN, y: -30 * E.IN, h: 0 };
  const r = E.Field.E.evaluate(E.Shots.params(pose), 'coarse');
  const w = E.Shots.window(pose, r.best.yawDeg);
  assert.ok(w && w.hi > w.lo);
  const shot = (v) => E.Field.E.classifyShot(E.Shots.params(pose), E.Shots.cfg.hoodDeg, v, r.best.yawDeg).hit;
  assert.equal(shot((w.lo + w.hi) / 2), true);
  assert.equal(shot(w.lo - 0.4), false);
  assert.equal(shot(w.hi + 0.4), false);
});

/* Aim the way a driver would: face where the Shot Sim says, with its angle and speed. */
function aimAt(E, xIn, yIn) {
  const pose = { x: xIn * E.IN, y: yIn * E.IN, h: 0 };
  let r = E.Field.E.evaluate(E.Shots.params(pose), 'full');
  for (let k = 0; k < 3 && r.best; k++) { pose.h = r.best.yawDeg * Math.PI / 180; r = E.Field.E.evaluate(E.Shots.params(pose), 'full'); }
  const full = E.Shots.full();
  E.Shots.cfg.hoodDeg = r.best.thetaDeg;
  E.Sim.dev.flywheel.act = r.best.v / full.v * full.rpm / full.free;
  return { pose, r };
}

test('shots: real shots scatter, so what goes in matches the Shot Sim\'s verdict', () => {
  const { E } = shooterBench();
  for (const [x, y] of [[-40, -30], [-62.35, -12], [-35, -10]]) {
    const { pose, r } = aimAt(E, x, y);
    const odds = E.Shots.odds(pose, null, 400);
    assert.ok(Math.abs(odds - r.hitRate) < 0.12, `(${x}, ${y}): ${Math.round(odds * 100)} % here vs ${Math.round(r.hitRate * 100)} % in the Shot Sim`);
  }
});

test('shots: a WON\'T WORK spot mostly misses, even aimed perfectly', () => {
  const { E } = shooterBench();
  const { pose, r } = aimAt(E, -50, 40);
  assert.equal(r.verdict, "WON'T WORK");
  let hits = 0;
  for (let i = 0; i < 40; i++) { const b = E.Shots.fire(pose, 'test'); if (b && b.hit) hits++; }
  assert.equal(E.Shots.fired, 40);
  assert.ok(hits <= 12, `${hits} of 40 went in`);
});

test('shots: the robot\'s own motion rides with the ball', () => {
  const { E } = shooterBench();
  const L = E.Shots.withVelocity(5, 45, 0, { x: 1, y: 0 });
  assert.ok(Math.abs(L.v - 5.7507) < 1e-3 && Math.abs(L.th - 37.937) < 1e-3 && Math.abs(L.yaw) < 1e-9);
  const S = E.Shots.withVelocity(5, 45, 0, { x: 0, y: 1 });
  assert.ok(S.yaw > 10, 'strafing bends the aim');
  // at the top of the scoring band, driving at the HIVE sends it long
  E.Shots.spreadScale = 0;
  const { pose } = aimAt(E, -40, -30);
  const w = E.Shots.window(pose, pose.h * 180 / Math.PI);
  const full = E.Shots.full();
  E.Sim.dev.flywheel.act = (w.hi - 0.05) / full.v * full.rpm / full.free;
  const still = E.Shots.odds(pose, null, 8), moving = E.Shots.odds(pose, { x: Math.cos(pose.h) * 0.8, y: Math.sin(pose.h) * 0.8 }, 8);
  assert.equal(still, 1);
  assert.equal(moving, 0);
});

test('shots: the kicker fires what the code spins up — three POLLEN on the staged NECTAR TIP the HIVE', () => {
  const { E } = shooterBench();
  E.Shots.spreadScale = 0;                  // this one checks the mechanics, not the luck
  const pose = { x: -40 * E.IN, y: -30 * E.IN, h: 0 };
  const r = E.Field.E.evaluate(E.Shots.params(pose), 'coarse');
  E.Sim.chassis = { x: pose.x, y: pose.y, h: r.best.yawDeg * Math.PI / 180 };
  press(E, 2, 'dpad_down', 0.1);                   // NEAR_VELOCITY
  run(E, 1);
  for (let i = 0; i < 3; i++) { press(E, 2, 'right_bumper', 0.3); run(E, 0.5); }
  run(E, 1.5);
  assert.equal(E.Shots.fired, 3);
  assert.equal(E.Shots.scored, 3, E.Shots.log.map((l) => l.text).join(' | '));
  assert.equal(E.Field.tips.red, 1);
  assert.equal(E.Field.hive.red, 1, 'the up-CELL swung to the far side');
  assert.equal(E.Field.cells.red.length, 0, 'the new up-CELL comes up empty');
});

test('shots: holding the kicker out fires once, and a stopped flywheel fires nothing', () => {
  const { E } = shooterBench();
  press(E, 2, 'right_bumper', 1.5);
  run(E, 1);
  assert.equal(E.Shots.fired, 0, 'flywheel never spun');
  press(E, 2, 'dpad_up', 0.1);
  run(E, 1);
  press(E, 2, 'right_bumper', 1.5);
  run(E, 2);
  assert.equal(E.Shots.fired, 1);
});
