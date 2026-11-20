// An Autonomous has no stick for the bench to learn its drive from. It used to get no drive at all
// from the Java VM, the rig fell back on a "standard build" (left motors mirrored), and a robot
// whose code sets all four wheels REVERSE (right on that robot, and what its TeleOp shows) ran one
// side backward: Team 7831's park autos turned 20 degrees on the spot and moved 2.5 in instead of
// leaving their wall. An auto is the same robot as the team's TeleOp, so it now takes its drive
// from the TeleOp it preselects, else from one handed over with it that drives the same motors,
// else from its own setDirection calls read as "positive power is forward".
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, run } from './load.mjs';

const E = loadEngine();
const BOX = () => ({ name: 'box', units: 'METRE', pointCount: 0, parts: [], mechs: [], solids: [], placements: [],
  bbox: { min: [-0.2286, -0.2286, 0], max: [0.2286, 0.2286, 0.35] } });
const HEAD = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
`;
const GET = (names) => names.map((n) => `    DcMotorEx ${n.toLowerCase()} = hardwareMap.get(DcMotorEx.class, "${n}");`).join('\n');
const DIR = (rev) => Object.entries(rev).map(([n, r]) => `    ${n.toLowerCase()}.setDirection(DcMotorSimple.Direction.${r ? 'REVERSE' : 'FORWARD'});`).join('\n');
const ALL = { FL: true, BL: true, FR: true, BR: true };
// the team's TeleOp: every wheel REVERSE, which is what drives their real robot straight
const TELE = (name = 'Main TeleOp', cls = 'MainTele', names = ['FL', 'BL', 'FR', 'BR']) => HEAD + `
@TeleOp(name = "${name}")
public class ${cls} extends LinearOpMode {
  @Override public void runOpMode() {
${GET(names)}
${DIR(Object.fromEntries(names.map((n) => [n, true])))}
    waitForStart();
    while (opModeIsActive()) {
      double y = -gamepad1.left_stick_y, x = gamepad1.left_stick_x, rx = gamepad1.right_stick_x;
      ${names[0].toLowerCase()}.setPower(y + x + rx); ${names[1].toLowerCase()}.setPower(y - x + rx);
      ${names[2].toLowerCase()}.setPower(y - x - rx); ${names[3].toLowerCase()}.setPower(y + x - rx);
    }
  }
}`;
// a leave auto: half power on every wheel for a second. It never names the TeleOp in its code.
const AUTO = (rev = ALL, pre = 'Main TeleOp') => HEAD + `
@Autonomous(name = "Leave"${pre ? `, preselectTeleOp = "${pre}"` : ''})
public class LeaveAuto extends LinearOpMode {
  @Override public void runOpMode() {
${GET(['FL', 'BL', 'FR', 'BR'])}
${DIR(rev)}
    waitForStart();
    fl.setPower(0.5); bl.setPower(0.5); fr.setPower(0.5); br.setPower(0.5);
    sleep(1000);
    fl.setPower(0); bl.setPower(0); fr.setPower(0); br.setPower(0);
  }
}`;
const lib = (file, src) => ({ file, src });
/* Run an auto on a plain 18 in mecanum box from x = -1 m facing +x; how far it went and how much it turned. */
function drive(auto, libs) {
  const code = E.parseJava(auto, { engine: 'vm', libs });
  assert.ok(code.vm, 'runs on the Java VM: ' + JSON.stringify(code.vmTried || null));
  E.Sim.pad = { 1: {}, 2: {} };
  E.Sim.reset(code, BOX(), {}, { payloadKg: 0, duty: 0.3, trust: 'code', front: '+x', startPose: { x: -1, y: 0, h: 0 } });
  run(E, 1.6);
  const c = E.Sim.chassis;
  return { code, forward: c.x + 1, side: c.y, deg: c.h * 180 / Math.PI, mounts: E.Sim.rig.drive.wheels.map((w) => [w.mount, w.mountFrom, w.mountVia]) };
}

test('auto drive: an Autonomous brings the TeleOp it preselects, whether or not its code names it', () => {
  const pool = [lib('MainTele.java', TELE()), lib('OtherTele.java', TELE('Practice TeleOp', 'OtherTele'))];
  assert.deepEqual(E.jvSiblings(AUTO(), pool).map((p) => p.file), ['MainTele.java']);
  assert.deepEqual(E.jvSiblings(AUTO(ALL, null), pool).map((p) => p.file), [], 'no preselect, nothing named: nothing brought');
  assert.deepEqual(E.jvSiblings(TELE(), [lib('LeaveAuto.java', AUTO())]).map((p) => p.file), [], 'a TeleOp does not bring the autos that point at it');
});

test('auto drive: with its TeleOp beside it, an all-REVERSE auto leaves the wall and holds its heading', () => {
  const r = drive(AUTO(), [lib('MainTele.java', TELE())]);
  const d = E.detectDrivetrain(r.code);
  assert.equal(d.from, 'teleop'); assert.equal(d.teleop, 'MainTele.java');
  assert.deepEqual(d.wheels.map((w) => w.sense), [-1, -1, -1, -1], 'the TeleOp\'s stick-up turns every shaft the REVERSE way: that is how this robot is built');
  assert.deepEqual(r.mounts, [[-1, 'code', 'teleop'], [-1, 'code', 'teleop'], [-1, 'code', 'teleop'], [-1, 'code', 'teleop']]);
  assert.ok(r.forward > 0.3, `it drives off the wall: ${r.forward.toFixed(2)} m`);
  assert.ok(Math.abs(r.deg) < 2 && Math.abs(r.side) < 0.03, `straight: ${r.deg.toFixed(1)} degrees, ${r.side.toFixed(3)} m sideways (it turned on the spot before)`);
  // an auto has no sticks: no stick bindings are made up for it
  assert.ok(!r.code.bindings.some((b) => /stick/.test(b.btn)), 'no stick drives an Autonomous');
});

test('auto drive: with no TeleOp to learn from, its own setDirection calls mean "positive power is forward"', () => {
  const r = drive(AUTO(ALL, null), []);
  assert.equal(E.detectDrivetrain(r.code).from, 'directions');
  assert.deepEqual(r.mounts.map((m) => m[2]), ['directions', 'directions', 'directions', 'directions']);
  assert.ok(r.forward > 0.3 && Math.abs(r.deg) < 2, `forward ${r.forward.toFixed(2)} m, ${r.deg.toFixed(1)} degrees`);
  // the standard build's mix (left REVERSE, right FORWARD) drives straight too, as it always did
  const std = drive(AUTO({ FL: true, BL: true, FR: false, BR: false }, null), []);
  assert.ok(std.forward > 0.3 && Math.abs(std.deg) < 2, `forward ${std.forward.toFixed(2)} m, ${std.deg.toFixed(1)} degrees`);
});

test('auto drive: an auto whose directions disagree with its TeleOp is shown going wrong, not hidden', () => {
  // this auto forgot to reverse the front-right motor. On the robot its TeleOp describes, that wheel runs backward.
  const wrong = { FL: true, BL: true, FR: false, BR: true };
  const withTele = drive(AUTO(wrong), [lib('MainTele.java', TELE())]);
  assert.ok(Math.abs(withTele.deg) > 5 || withTele.forward < 0.2, `the TeleOp's mounting shows the mistake: ${withTele.forward.toFixed(2)} m, ${withTele.deg.toFixed(1)} degrees`);
  // alone, there is nothing to check its directions against
  const alone = drive(AUTO(wrong, null), []);
  assert.ok(alone.forward > 0.3 && Math.abs(alone.deg) < 2);
});

test('auto drive: a TeleOp for other motors says nothing about this robot', () => {
  const r = drive(AUTO(ALL, 'Main TeleOp'), [lib('MainTele.java', TELE('Main TeleOp', 'MainTele', ['leftFront', 'leftBack', 'rightFront', 'rightBack']))]);
  assert.equal(E.detectDrivetrain(r.code).from, 'directions', 'falls back to its own directions');
  assert.ok(r.forward > 0.3 && Math.abs(r.deg) < 2);
});
