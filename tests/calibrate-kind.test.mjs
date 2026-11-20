// A saved calibration is checked against the drive base it will run on (src/calibrate.js
// calCheck): a mecanum fit made before roller slip keeps neither its turn drag nor its strafe
// loss. The Tune panel (src/mcui.js CalUI.apply, called from withPose in src/app.js) hands it to
// the sim BEFORE Sim.load builds the rig, so it used to ask the last-built sim for the kind and
// got null on the very first build: a stale mecanum fit kept its stale turn drag until the next
// rebuild (186.9 against 200 deg/s, no "fit again"). calDriveKind works the kind out the way
// Sim.load does, so the first build and every rebuild agree. What only a browser shows: the pill
// and the note on the Tune tab on the first page load (mcui.js and app.js are not in the engine).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadEngine, fixture } from './load.mjs';

const E = loadEngine();

const TANK_JAVA = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
@TeleOp(name = "Tank")
public class Tank extends OpMode {
  DcMotor leftDrive, rightDrive;
  public void init() { leftDrive = hardwareMap.get(DcMotor.class, "leftDrive"); rightDrive = hardwareMap.get(DcMotor.class, "rightDrive"); }
  public void loop() { leftDrive.setPower(-gamepad1.left_stick_y); rightDrive.setPower(-gamepad1.right_stick_y); }
}`;
const CODES = { sample: () => E.SAMPLE_JAVA, drive: () => E.DRIVE_JAVA, tank: () => TANK_JAVA };
const CADS = {
  sample: () => { const c = JSON.parse(JSON.stringify(E.SAMPLE_CAD)); E.classifyMechs(c.mechs); return c; },
};
for (const n of ['mecanum-zup', 'mecanum-yup', 'mecanum-front-y', 'tank-traction', 'tank-6wd', 'unnamed-wheels', 'arm-only']) {
  const text = fixture('robots/' + n + '.step');
  CADS[n] = () => E.parseSTEP(text);
}
const opts = (front) => Object.assign({ payloadKg: 0, duty: 0.3, trust: 'code' }, front ? { front } : {});
const builtKind = () => E.Sim.rig && E.Sim.rig.drive ? E.Sim.rig.drive.kind : null;

test('calibrate: the drive kind the Tune panel checks a fit against is the kind Sim.load builds, before the first build and after it', () => {
  const kinds = new Set();
  for (const [cn, codeOf] of Object.entries(CODES)) for (const [rn, cadOf] of Object.entries(CADS)) for (const front of [undefined, '+x', '+y']) {
    const code = E.parseJava(codeOf());
    // the first build: asked before Sim.load has seen this CAD (not yet in the robot frame, no front)
    const cad = cadOf(), o = opts(front), map = E.autoMap(code.devices, cad.mechs);
    const first = E.calDriveKind(code, cad, o);
    E.Sim.load(code, cad, map, o);
    assert.equal(first, builtKind(), `${cn} code on ${rn}, front ${front || 'from the wheels'}: told ${first}, built ${builtKind()}`);
    // a rebuild: asked again with the same opts the sim was built with
    assert.equal(E.calDriveKind(code, cad, o), builtKind(), `${cn} on ${rn}: a rebuild`);
    E.Sim.load(code, cad, map, o);
    assert.equal(E.calDriveKind(code, cad, o), builtKind(), `${cn} on ${rn}: after a second build`);
    kinds.add(builtKind());
  }
  // the robots above really are different drive bases, so agreeing means something
  for (const k of ['mecanum', 'tank']) assert.ok(kinds.has(k), 'built a ' + k + ' base: ' + [...kinds]);
});

test('calibrate: a mecanum fit made before roller slip is checked as mecanum on the very first build, the same as on a rebuild', () => {
  // a fit of forward and turn only, from before roller slip: no strafeModel, no kind saved, no strafe
  // measured, so nothing in it says mecanum; only the robot does
  const cal = { params: { gear: 1.06, yawViscous: 0.95 }, measured: { fwd: 1.3, turn: 200 } };
  assert.deepEqual(E.calOpts(cal, null), cal.params, 'with no kind the turn drag is kept: what the first build used to get');
  const code = E.parseJava(E.DRIVE_JAVA);
  const build = (kindOf) => {
    const cad = CADS['mecanum-zup'](), o = opts('+x'), map = E.autoMap(code.devices, cad.mechs);
    // withPose: the calibration goes into the opts, then Sim.load builds the rig from them
    o.calib = E.calOpts(cal, kindOf(cad, o));
    E.Sim.load(code, cad, map, o);
    return { calib: o.calib, kind: builtKind(), turn: E.calRun(E.Sim.rig, 'turn'), refit: E.calApplied(cal, kindOf(cad, o)).refit };
  };
  const first = build((cad, o) => E.calDriveKind(code, cad, o));
  assert.equal(first.kind, 'mecanum');
  const rebuild = build(() => first.kind);                         // what the panel saw once a rig existed
  assert.deepEqual(first.calib, { gear: 1.06 }, 'the stale turn drag is left out on the first build');
  assert.deepEqual(first.calib, rebuild.calib);
  assert.equal(first.turn, rebuild.turn, `first build turns at ${first.turn.toFixed(1)} deg/s, a rebuild at ${rebuild.turn.toFixed(1)}`);
  assert.match(first.refit, /turn drag/, 'and the panel says to fit it again from the first build');
  // the panel asks calDriveKind, never the last-built sim
  const ui = fs.readFileSync(new URL('../src/mcui.js', import.meta.url), 'utf8');
  const kindFn = ui.slice(ui.indexOf('  kind(){'), ui.indexOf('  baseRig(){'));
  assert.match(kindFn, /calDriveKind\(code,CAD,OPTS\)/);
  assert.doesNotMatch(kindFn, /Sim\.rig/);
  // and the app still applies the calibration with the pose, before Sim.load
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /function withPose\(\)\{[^\n]*CalUI\.apply\(\)/);
});
