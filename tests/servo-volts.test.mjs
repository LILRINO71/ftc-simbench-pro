// A servo's figures are quoted at 6 V (src/hardware.js), but a REV hub's servo port gives 5 V. The
// sim, the Checks tab's torque check and the Math tab take a servo at the volts it runs at: 5 V, or
// 6 V when a Servo Power Module feeds it (opts.servoVolts), with torque and speed taken between the
// vendor's 4.8 V and 6 V columns in proportion. goBILDA 25-2 Torque: 17.2 / 21.6 kg.cm and
// 0.25 / 0.20 s per 60 deg at 4.8 / 6 V, so at 5 V 17.2 + 4.4 x 0.2/1.2 = 17.9333 kg.cm and
// 60/0.25 + (60/0.20 - 60/0.25) x 0.2/1.2 = 250 deg/s (0.24 s per 60 deg).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadEngine, sampleBench } from './load.mjs';

const E = loadEngine();
const KGCM = 0.0980665;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('servo volts: 5 V by default, between the vendor\'s 4.8 V and 6 V columns, 6 V on a Servo Power Module', () => {
  assert.equal(E.servoVolts({}), 5);
  assert.equal(E.servoVolts(null), 5);
  assert.equal(E.servoVolts({ servoVolts: 6 }), 6);
  assert.equal(E.servoVolts({ servoVolts: 0 }), 5, 'a volts that is not positive is the hub port');
  const t = E.HW_PARTS['2000-0025-0002'];
  const at = (v) => E.servoScale(t, v);
  near(at(6).torque, 1, 1e-12, 'torque at 6 V'); near(at(6).speed, 1, 1e-12, 'speed at 6 V');
  near(at(4.8).torque * t.stallNm, 17.2 * KGCM, 1e-9, 'torque at 4.8 V is the 4.8 V column');
  near(t.sec60 / at(4.8).speed, 0.25, 1e-12, 'speed at 4.8 V is the 4.8 V column');
  near(at(5).torque * t.stallNm, 17.933333333 * KGCM, 1e-8, 'torque at 5 V');
  near(60 / t.sec60 * at(5).speed, 250, 1e-9, 'deg/s at 5 V');
  near(at(7.4).torque, 1, 1e-12, 'above 6 V: the 6 V column, nothing extrapolated');
  // REV's Smart Robot Servo is quoted at 6 V only: in proportion to the voltage
  const rev = E.servoScale(E.HW_PARTS['REV-41-1097'], 5);
  near(rev.torque, 5 / 6, 1e-12, 'REV torque at 5 V'); near(rev.speed, 5 / 6, 1e-12, 'REV speed at 5 V');
});

/* One servo on a bare sim, stepped by Sim.stepDevices: how far it turns in 0.1 s from 0 towards 1. */
function slew(opts) {
  const spec = E.specFor({ name: 'arm', type: 'Servo', declaredRole: 'Torque' }, null, 'code');
  const S = Object.create(E.Sim);
  Object.assign(S, { rig: null, drivetrain: null, mechWorld: null, physics: 'rigid', opts: Object.assign({ duty: 0.3, payloadKg: 0 }, opts),
    dev: { arm: { kind: 'servo', spec, mech: null, cmd: 1, act: 0, restPos: 0, sec60: spec.sec60, travelDeg: 300, stalled: false } } });
  for (let k = 0; k < 5; k++) S.stepDevices(0.02);
  return S.dev.arm.act * 300;                                   // degrees turned
}

test('servo volts: the sim slews a servo at the speed its port gives it', () => {
  near(slew({}), 250 * 0.1, 1e-9, 'degrees in 0.1 s on the hub\'s 5 V port');
  near(slew({ servoVolts: 6 }), 300 * 0.1, 1e-9, 'degrees in 0.1 s on a 6 V Servo Power Module');
});

test('servo volts: the Checks tab\'s holding check uses the torque at 5 V, or 6 V when told', () => {
  const java = `@TeleOp(name="A") public class A extends LinearOpMode {
    private Servo arm;
    @Override public void runOpMode() { arm = hardwareMap.get(Servo.class, "arm"); arm.setPosition(0.5); waitForStart();
      while (opModeIsActive()) { arm.setPosition(0.6); } } }`;
  const mech = { id: 'm1', kind: 'revolute-lift', label: 'Test arm', parent: 'chassis', pivot: [0, 0, 0],
    distalTo: [0.2 * Math.cos(Math.PI / 6), 0, 0.2 * Math.sin(Math.PI / 6)], lever: 0.2, restAngleDeg: 30 };
  const run = (extra) => E.analyze(E.parseJava(java), { mechs: [mech] }, { arm: 'm1' }, Object.assign({ payloadKg: 0.18, duty: 0.3, trust: 'code' }, extra))
    .find(f => /^torque:arm$/.test(f.key));
  const usable = (f) => +/usable\s+([\d.]+) N·m/.exec(f.math)[1];
  const hub = run({}), spm = run({ servoVolts: 6 });
  near(usable(hub), 17.933333 * KGCM * 0.3, 1e-3, 'usable torque on the hub port');
  near(usable(spm), 21.6 * KGCM * 0.3, 1e-3, 'usable torque on a Servo Power Module');
  assert.match(hub.math, /stall at 5 V/);
  assert.match(spm.math, /stall at 6 V/);
});

/* One servo on a joint the solver owns (Physics -> Mechanisms -> solved, src/joltmech.js), with a
   stand-in for the Jolt world: what the bench commands it with. */
function solvedServo() {
  const spec = E.specFor({ name: 'arm', type: 'Servo', declaredRole: 'Torque' }, null, 'code');
  const world = { joints: new Map([['arm', { lin: false, q: 0, w: 0 }]]), sent: null, step(dt, cmds) { this.sent = cmds; } };
  const dev = { arm: { kind: 'servo', spec, mech: { id: 'arm', kind: 'revolute', fromMate: { name: 'arm' } }, cmd: 1, act: 0, restPos: 0, sec60: spec.sec60, travelDeg: 300, stalled: false } };
  return { spec, world, dev };
}
const DEG = Math.PI / 180;

test('servo volts: a solved servo gets the same speed and torque as a posed one, 5 V unless told 6 V', () => {
  const { spec, world, dev } = solvedServo();
  const hub = E.JoltMech.deviceCommands(dev, world).arm, spm = E.JoltMech.deviceCommands(dev, world, { servoVolts: 6 }).arm;
  near(hub.rate / DEG, 250, 1e-9, 'deg/s on the hub port, as the posed sim slews it');
  near(hub.stall, 17.933333333 * KGCM, 1e-8, 'stall on the hub port');
  near(spm.rate / DEG, 300, 1e-9, 'deg/s on a Servo Power Module');
  near(spm.stall, spec.stallNm, 1e-12, 'stall on a Servo Power Module');
  // the sim hands the solver its own setting, every step
  for (const [opts, rate] of [[{}, 250], [{ servoVolts: 6 }, 300]]) {
    const S = Object.create(E.Sim);
    Object.assign(S, { rig: null, drivetrain: null, mechWorld: world, physics: 'rigid', opts: Object.assign({ duty: 0.3, payloadKg: 0 }, opts), dev });
    S.stepDevices(0.02);
    near(world.sent.arm.rate / DEG, rate, 1e-9, 'deg/s the sim sent the solver with ' + JSON.stringify(opts));
    near(slew(opts) / 0.1, rate, 1e-9, 'and the posed sim with the same setting');
  }
});

test('servo volts: the setting is kept in a workspace file and in the robot\'s saved rig, and an old file means the hub port', () => {
  // a real workspace of the sample robot, with the setting written into its options and its rig
  const b = sampleBench(E); b.java = E.SAMPLE_JAVA; b.chassis = { x: 0, y: 0, h: 0 };
  const base = JSON.parse(E.packSession(E.sessionFromBench(b)));
  base.rig = { format: 'ftc-sim-bench.rig', version: 1, duty: 0.3 };
  const read = (opts, rig) => {
    const r = E.unpackSession(JSON.stringify(Object.assign({}, base, { opts: Object.assign({}, base.opts, opts), rig: Object.assign({}, base.rig, rig) })));
    assert.equal(r.ok, true, r.error);
    return r.session;
  };
  const six = read({ servoVolts: 6 }, { servoVolts: 6 });
  assert.equal(six.opts.servoVolts, 6); assert.equal(six.rig.servoVolts, 6);
  const back = E.unpackSession(E.packSession(six)).session;
  assert.equal(back.opts.servoVolts, 6, 'and it packs back'); assert.equal(back.rig.servoVolts, 6);
  for (const bad of [7, '6', -1, 0, 4.8, true]) {
    const s = read({ servoVolts: bad }, { servoVolts: bad });
    assert.equal(s.opts.servoVolts, 5, 'anything but 6 is the hub port: ' + JSON.stringify(bad)); assert.equal(s.rig.servoVolts, 5);
  }
  const old = read({}, {});
  assert.equal('servoVolts' in old.opts, false, 'a file from before says nothing'); assert.equal('servoVolts' in old.rig, false);
  assert.equal(E.servoVolts(old.opts), 5, 'which the sim reads as the hub port');

  // the page's own save and restore (src/app.js exportRig / applyRig), run with the rest of the page stood in for
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function exportRig(){'), src.indexOf('function applyDeviceMemory(){'));
  const page = (OPTS) => new Function('OPTS', 'CAD', 'CODE', 'View', 'Shots', 'RIG_DEVICES', 'MAP', 'HW_USER', 'Ignores', 'IGNORED', 'ignoreRobot', 'SETUP', 'FRONTS',
    'cleanDriveSpec', 'normJointKind', 'recomputeChain', 'syncOptionControls', 'saveIgnored', body + '\nreturn { exportRig, applyRig };')(
    OPTS, { name: 'r', mechs: [] }, null, { turretScale: 0.55 }, { cfg: null, defaults: () => ({}) }, {}, {}, {}, { forRig: () => [], fromRig() {} }, {}, () => 'r',
    { done: {} }, { '+x': 0 }, (d) => d, (k) => k, () => {}, () => {}, () => {});
  const opts = { trust: 'code', payloadKg: 0.18, duty: 0.3, front: '+x', servoVolts: 6 };
  const rig = page(opts).exportRig();
  assert.equal(rig.servoVolts, 6, 'saved with the robot');
  const fresh = { trust: 'code', payloadKg: 0.18, duty: 0.3, front: '+x', servoVolts: 5 };
  page(fresh).applyRig(JSON.parse(JSON.stringify(rig)));
  assert.equal(fresh.servoVolts, 6, 'and restored');
  const other = Object.assign({}, rig); delete other.servoVolts;
  page(fresh).applyRig(other);
  assert.equal(fresh.servoVolts, 5, 'a robot saved before the setting runs on the hub port, not the last robot\'s setting');
  // a workspace's options carry it too, and the control is where the servos are set up
  assert.match(src, /for\(const k of \[[^\]]*"servoVolts"[^\]]*\]\) if\(s\.opts\[k\]!=null\) OPTS\[k\]=s\.opts\[k\]/);
  assert.match(src, /const OPTS=\{[^}]*servoVolts:5\}/, 'the hub port by default');
  assert.match(src, /\$\("#servoVoltSeg"\)\.addEventListener\("click"[^\n]*\n[^\n]*OPTS\.servoVolts=[^\n]*saveRig\(\)/, 'applied at once and saved');
  const html = fs.readFileSync(new URL('../src/markup.html', import.meta.url), 'utf8');
  const hw = html.slice(html.indexOf('data-sec="hwmap"'), html.indexOf('data-sec="cfgxml"'));
  assert.match(hw, /Servo power/);
  assert.match(hw, /id="servoVoltSeg"[^\n]*<button data-volts="5" class="on">hub port \(5 V\)<\/button><button data-volts="6">Servo Power Module \(6 V\)<\/button>/);
});
