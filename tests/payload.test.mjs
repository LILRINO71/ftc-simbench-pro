// Game pieces through the team's own robot (src/payload.js): an intake that picks a ball up off
// the tiles while it runs inward, four at most (G407), a path to the shooter, a feeder or gate
// that lets one out (or none: straight through once the shooter turns), an intake run backward
// that spits one out, POLLEN out of a FLOWER, and a flywheel that slows as each ball takes its
// energy and comes back on a DC motor's own time constant. Before this, a feeder pulse launched a
// ball from nowhere, nothing was ever picked up and the flywheel never noticed a shot.
//
// The OpModes are small LinearOpModes in the style of Team 7831's own TeleOps (Meet0MainTeleOp:
// intake + two shooter motors, no gate; FullRobotTeleOp: two intakes, a gate servo), run on the
// Java VM exactly as the page runs them, on a plain 18 in robot on the BIOBUZZ field.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWithField, run } from './load.mjs';

const E = loadWithField();
const DT = 0.02;
const BOX = () => ({ name: 'box', units: 'METRE', pointCount: 0, parts: [], mechs: [], solids: [], placements: [],
  bbox: { min: [-0.2286, -0.2286, 0], max: [0.2286, 0.2286, 0.35] } });

const HEAD = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.util.ElapsedTime;
`;
const DRIVE = `
    DcMotorEx fl = hardwareMap.get(DcMotorEx.class, "FL");
    DcMotorEx bl = hardwareMap.get(DcMotorEx.class, "BL");
    DcMotorEx fr = hardwareMap.get(DcMotorEx.class, "FR");
    DcMotorEx br = hardwareMap.get(DcMotorEx.class, "BR");`;
const DRIVE_LOOP = `
      double y = -gamepad1.left_stick_y, x = gamepad1.left_stick_x, rx = gamepad1.right_stick_x;
      fl.setPower(y + x + rx); bl.setPower(y - x + rx); fr.setPower(y - x - rx); br.setPower(y + x - rx);`;

// Meet 0: the intake pushes balls straight into two shooter rollers. A on, B off, RT in, LT out.
// IN is the power that takes balls in (the team's robot: +1 with the motor REVERSEd).
const MEET0 = (IN = '1.0', name = 'intake') => HEAD + `
@TeleOp(name = "Meet0 style")
public class Meet0Style extends LinearOpMode {
  public static double SHOOTER_POWER = 1.0;
  @Override public void runOpMode() {${DRIVE}
    DcMotorEx intake = hardwareMap.get(DcMotorEx.class, "${name}");
    DcMotorEx outtake1 = hardwareMap.get(DcMotorEx.class, "outtake1");
    DcMotorEx outtake2 = hardwareMap.get(DcMotorEx.class, "outtake2");
    intake.setDirection(DcMotorSimple.Direction.REVERSE);
    outtake1.setDirection(DcMotorSimple.Direction.FORWARD);
    outtake2.setDirection(DcMotorSimple.Direction.FORWARD);
    intake.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.FLOAT);
    boolean shooterOn = false;
    waitForStart();
    while (opModeIsActive()) {${DRIVE_LOOP}
      if (gamepad2.a) shooterOn = true;
      if (gamepad2.b) shooterOn = false;
      double out = shooterOn ? SHOOTER_POWER : 0;
      outtake1.setPower(out); outtake2.setPower(out);
      boolean intakeIn = gamepad2.right_trigger > 0.1, intakeOut = gamepad2.left_trigger > 0.1;
      intake.setPower(intakeOut ? -(${IN}) : (intakeIn ? ${IN} : 0.0));
      telemetry.addData("intake", intakeOut ? "REVERSE" : (intakeIn ? "in" : "off"));
      telemetry.update();
    }
  }
}`;

// The full robot: two intakes and a gate in front of the shooter. RB shoots once the shooter has
// had a second to spin up (the gate opens, then the intakes feed); X opens the gate by hand.
// late: the gate is first commanded a moment after START, as a VM thread may well do (a servo the
// code hasn't sent anywhere yet reads 0.5 on the VM)
const FULL_ = (late) => HEAD + `
@TeleOp(name = "Full robot style")
public class FullStyle extends LinearOpMode {
  public static double GATE_CLOSED = 0.9, GATE_OPEN = 0.1, GATE_SECONDS = 0.25, SPIN_UP_SECONDS = 1.0;
  @Override public void runOpMode() {${DRIVE}
    DcMotorEx intake = hardwareMap.get(DcMotorEx.class, "intake");
    DcMotorEx intake2 = hardwareMap.tryGet(DcMotorEx.class, "intake2");
    DcMotorEx outtake1 = hardwareMap.get(DcMotorEx.class, "outtake1");
    DcMotorEx outtake2 = hardwareMap.get(DcMotorEx.class, "outtake2");
    Servo gate = hardwareMap.tryGet(Servo.class, "gate");
    intake.setDirection(DcMotorSimple.Direction.REVERSE);
    intake2.setDirection(DcMotorSimple.Direction.REVERSE);
    outtake2.setDirection(DcMotorSimple.Direction.REVERSE);
    boolean shooterOn = false, gateWasOpen = false;
    double lastPower = 0;
    ElapsedTime sinceChange = new ElapsedTime();
    ElapsedTime sinceGate = new ElapsedTime();
    waitForStart();
    ElapsedTime sinceStart = new ElapsedTime();
    while (opModeIsActive()) {${DRIVE_LOOP}
      if (gamepad2.a) shooterOn = true;
      if (gamepad2.b) shooterOn = false;
      boolean shoot = gamepad2.right_bumper;
      boolean spin = shooterOn || shoot;
      double target = spin ? 1.0 : 0;
      if (Math.abs(target - lastPower) > 1e-6) { sinceChange.reset(); lastPower = target; }
      outtake1.setPower(target); outtake2.setPower(target);
      boolean ready = spin && sinceChange.seconds() >= SPIN_UP_SECONDS;
      boolean feed = shoot && ready;
      boolean gateOpen = feed || gamepad2.x;
      if (gateOpen != gateWasOpen) { sinceGate.reset(); gateWasOpen = gateOpen; }
      if (gate != null && ${late ? 'sinceStart.seconds() > 0.3' : 'true'}) gate.setPosition(gateOpen ? GATE_OPEN : GATE_CLOSED);
      boolean gateClear = gate == null || (gateOpen && sinceGate.seconds() >= GATE_SECONDS);
      boolean intakeIn = gamepad2.right_trigger > 0.1, intakeOut = gamepad2.left_trigger > 0.1;
      double in = 0;
      if (intakeOut) in = -1.0; else if (feed && gateClear) in = 1.0; else if (intakeIn) in = 1.0;
      intake.setPower(in);
      if (intake2 != null) intake2.setPower(in);
      telemetry.addData("gate", gateOpen ? "OPEN" : "closed");
      telemetry.update();
    }
  }
}`;
const FULL = FULL_(false);

// A kicker robot: a roller intake, a flywheel run by setPower, a kicker servo that flicks one ball.
const KICKER = HEAD + `
@TeleOp(name = "Kicker")
public class Kicker extends LinearOpMode {
  @Override public void runOpMode() {${DRIVE}
    DcMotorEx intake = hardwareMap.get(DcMotorEx.class, "intake");
    DcMotorEx flywheel = hardwareMap.get(DcMotorEx.class, "flywheel");
    Servo kicker = hardwareMap.get(Servo.class, "kicker");
    kicker.setPosition(0.2);
    waitForStart();
    while (opModeIsActive()) {${DRIVE_LOOP}
      flywheel.setPower(gamepad2.a ? 1.0 : 0.0);
      intake.setPower(gamepad2.right_trigger > 0.1 ? 1.0 : (gamepad2.left_trigger > 0.1 ? -1.0 : 0.0));
      kicker.setPosition(gamepad2.right_bumper ? 0.55 : 0.2);
    }
  }
}`;

// An auto with its pre-loads: spin up, then run the intake to feed them through (no gate).
const AUTO = HEAD + `
@Autonomous(name = "Preload auto")
public class PreloadAuto extends LinearOpMode {
  @Override public void runOpMode() {${DRIVE}
    DcMotorEx intake = hardwareMap.get(DcMotorEx.class, "intake");
    DcMotorEx outtake1 = hardwareMap.get(DcMotorEx.class, "outtake1");
    waitForStart();
    outtake1.setPower(1.0);
    sleep(1500);
    intake.setPower(1.0);
    sleep(4000);
    intake.setPower(0); outtake1.setPower(0);
  }
}`;

/* The robot on the field, as the page sets it up for an OpMode: the shot config from the code, the
   game pieces in solo (no AI robots), the floor and the FLOWERs emptied unless asked to keep them. */
function bench(java, o = {}) {
  const code = E.parseJava(java, { engine: 'vm' });
  assert.ok(code.vm, 'the OpMode runs on the Java VM: ' + JSON.stringify(code.vmTried || null));
  E.Field.reset(); E.Shots.cfg = null;
  E.Sim.pad = { 1: {}, 2: {} };
  E.Sim.reset(code, BOX(), {}, { payloadKg: 0.18, duty: 0.3, trust: 'code', front: '+x', startPose: o.pose || { x: -1.0, y: -0.9, h: 0 } });
  E.Shots.reset(); E.Shots.alliance = 'red'; E.Shots.adopt(code);
  if (o.payload) Object.assign(E.Shots.cfg.payload, o.payload);
  E.Match.on = true;
  E.Match.reset({ period: code.kind === 'Autonomous' ? 'Autonomous' : 'TeleOp', user: 'red', seed: 3, solo: true });
  if (!o.staged) { E.Match.floor = []; for (const f of E.Match.flowers) f.stack = []; }
  return code;
}
/* A ball on the tiles just outside the robot's front (or back) edge, in the middle. */
function ballAt(kind, side = 'front', color = null, lat = 0) {
  const fp = E.Sim.footprint, X = E.footBox(E.Sim.chassis, fp), r = E.ballSpec(kind).r, s = side === 'front' ? 1 : -1;
  const d = s * (fp.hx + r + 0.004), c = Math.cos(X.h), sn = Math.sin(X.h);
  return E.Match.drop(kind, color, X.x + d * c - lat * sn, X.y + d * sn + lat * c);
}
const pad = (k, v) => { E.Sim.pad[2][k] = v; };
const held = () => E.Payload.held.length;

test('payload: the roles come from the code\'s device names and types, the shooter\'s scheme extended', () => {
  const devs = (list) => ({ devices: list.map(([name, type]) => ({ name, type })) });
  const d = E.Shots.detect(devs([['intake', 'DcMotorEx'], ['intake2', 'DcMotorEx'], ['outtake1', 'DcMotorEx'], ['gate', 'Servo'],
    ['intakeSlide', 'DcMotor'], ['intakeWrist', 'Servo'], ['rollerServo', 'CRServo'], ['shooterRoller', 'DcMotorEx'], ['transfer', 'DcMotor'], ['sweeper', 'CRServo']]));
  assert.deepEqual(d.intake, ['intake', 'intake2', 'rollerServo', 'sweeper'], 'rollers that spin; not a slide, a wrist or the shooter\'s roller');
  assert.deepEqual(d.transfer, ['transfer']);
  assert.deepEqual(d.shooter, ['outtake1', 'shooterRoller']);
  assert.equal(d.feeder[0], 'gate');
  // the Shot tab starts from them, and keeps what the user set while the devices exist
  E.Shots.cfg = null; E.Shots.adopt(devs([['intake', 'DcMotorEx'], ['outtake1', 'DcMotorEx'], ['belt', 'DcMotor']]));
  assert.deepEqual(E.Shots.cfg.payload, { intakes: ['intake'], transfer: 'belt' });
  E.Shots.cfg.payload.intakes = ['belt']; E.Shots.cfg.payload.transfer = '';
  E.Shots.adopt(devs([['intake', 'DcMotorEx'], ['outtake1', 'DcMotorEx'], ['belt', 'DcMotor']]));
  assert.deepEqual(E.Shots.cfg.payload, { intakes: ['belt'], transfer: 'belt' }, 'a role left empty is filled again from the names, as the shooter is');
});

test('payload: a ball in the mouth comes in only while the intake runs inward, and rides in on the rollers', () => {
  bench(MEET0());
  run(E, 0.3);
  assert.equal(E.Payload.supply().mode, 'real', 'an intake in the code: real pieces');
  const b = ballAt('pollen');
  run(E, 1);
  assert.equal(held(), 0, 'the intake is off: the ball just sits there');
  assert.ok(E.Match.floor.includes(b));
  // first use: the code's first sustained command, with the robot empty, says which way is in
  pad('right_trigger', 1);
  run(E, 0.12);
  assert.equal(held(), 0, 'not before the direction is known (0.15 s of command)');
  let gripped = false, x0 = null, xs = [];
  for (let i = 0; i < 40 && held() === 0; i++) {
    E.Sim.tick(DT);
    if (b.hold && b.hold.id === 'user') { gripped = true; if (x0 == null) x0 = b.hold.lx; xs.push(b.hold.lx); }
  }
  assert.ok(gripped, 'the rollers gripped it (the AI robots\' mechanism: e.hold, carried by ballphys)');
  assert.ok(xs[xs.length - 1] < x0 - 0.03, 'and drew it in toward the robot: ' + x0.toFixed(3) + ' to ' + xs[xs.length - 1].toFixed(3));
  assert.equal(held(), 1, 'it is in');
  assert.ok(!E.Match.floor.includes(b), 'and off the floor');
  // the time to take it in is physics: a ball diameter plus a little at half the rollers' surface speed
  const sp = E.Sim.dev.intake.spec, surf = sp.rpm / 60 * Math.PI * 0.048, dist = 2 * E.ballSpec('pollen').r + 0.005;
  const expect = dist / (surf / 2);
  assert.ok(Math.abs(xs.length * DT - expect) <= 3 * DT, `in ${(xs.length * DT).toFixed(2)} s, physics says ${expect.toFixed(2)} s`);
  const s = E.Payload.summary();
  assert.equal(s.picked, 1);
  assert.deepEqual(s.intakes.map((m) => [m.name, m.edge, m.in, m.inFrom]), [['intake', 'front', 'positive', 'first use']]);
});

test('payload: an intake that stops before the ball is in lets it go; one running outward never grips', () => {
  bench(MEET0());
  pad('right_trigger', 1); run(E, 0.3); pad('right_trigger', 0); run(E, 0.2);   // direction learned on an empty robot
  const b = ballAt('pollen');
  pad('left_trigger', 1); run(E, 1); pad('left_trigger', 0);
  assert.equal(held(), 0, 'running out: nothing comes in');
  assert.ok(!b.hold, 'and nothing is gripped');
  // a slow roller (a 312 rpm motor on a 200 mm roller would be fast: shrink the roller instead) gives time to stop
  E.Shots.cfg.payload.rollerMm = 10;
  const c = ballAt('pollen', 'front', null, 0.12);
  pad('right_trigger', 1); run(E, 0.3);                // the motor slews from full reverse first
  assert.ok(c.hold || b.hold, 'gripped');
  pad('right_trigger', 0); run(E, 0.1);
  assert.equal(held(), 0, 'stopped half way: not in');
  assert.ok(!c.hold && !b.hold, 'and let go: a loose ball again');
});

test('payload: an intake held still by the joint it is on says so once, with the joint', () => {
  // The team's code on another robot's CAD: "intake" got bound to that robot's lift, which ran to
  // its stop and held the motor at zero. Nothing was picked up and nothing said why.
  bench(MEET0());
  run(E, 0.3);
  const note = () => E.Shots.log.filter((l) => /isn't turning/.test(l.text));
  // free to turn: no such note, however long it runs
  pad('right_trigger', 1); run(E, 1.5); pad('right_trigger', 0); run(E, 0.2);
  assert.equal(note().length, 0, 'a free intake is not called stuck: ' + JSON.stringify(E.Shots.log.map((l) => l.text)));
  assert.deepEqual(E.Payload.summary().notTurning, []);
  // on a joint with a few thousandths of a radian of travel: it reaches the stop at once
  bench(MEET0());
  E.Sim.dev.intake.mech = { id: 'lift', label: 'Lift (vertical slides)', kind: 'revolute', limits: [0, 0.001], gear: 1, dir: 1 };
  run(E, 0.3);
  const b = ballAt('pollen');
  pad('right_trigger', 1); run(E, 2);
  assert.ok(Math.abs(E.Sim.dev.intake.act) < 0.02, 'the joint holds the motor still: ' + E.Sim.dev.intake.act);
  assert.equal(held(), 0, 'so nothing comes in');
  assert.ok(E.Match.floor.includes(b));
  assert.equal(note().length, 1, 'said once: ' + JSON.stringify(E.Shots.log.map((l) => l.text)));
  assert.match(note()[0].text, /^intake is told to run but isn't turning: it is on the joint 'Lift \(vertical slides\)'/);
  assert.deepEqual(E.Payload.summary().notTurning, ['intake']);
  pad('right_trigger', 0);
});

test('payload: never more than four (G407); a fifth ball in the mouth is only pushed', () => {
  bench(MEET0());
  pad('right_trigger', 1);
  run(E, 0.3);
  for (let i = 0; i < 6; i++) { ballAt('pollen'); run(E, 0.6); }
  assert.equal(held(), 4, 'four in');
  assert.equal(E.Payload.summary().picked, 4);
  const extra = E.Match.floor.filter((e) => !e.hold);
  assert.equal(E.Match.floor.length, 2, 'the other two stay on the field');
  assert.equal(E.Match.floor.filter((e) => e.hold).length, 0, 'and nothing is gripped while full');
  assert.ok(extra.length === 2);
});

test('payload: no shot without a piece, and one note however often the feeder pulses', () => {
  bench(KICKER);
  pad('a', true); run(E, 2.5);
  assert.ok(E.Shots.exitSpeed() > 3, 'the flywheel is up');
  for (let i = 0; i < 4; i++) { pad('right_bumper', true); run(E, 0.4); pad('right_bumper', false); run(E, 0.4); }
  assert.equal(E.Shots.fired, 0, 'four kicks, nothing launched');
  const notes = E.Shots.log.filter((l) => /Nothing launched/.test(l.text));
  assert.equal(notes.length, 1, 'one note, not one per kick: ' + JSON.stringify(E.Shots.log.map((l) => l.text)));
  assert.match(notes[0].text, /holds no game piece/);
  // with a piece: the kick takes it, and only it
  pad('right_trigger', 1); ballAt('pollen'); run(E, 2.5); pad('right_trigger', 0);
  assert.equal(held(), 1);
  pad('right_bumper', true); run(E, 0.4); pad('right_bumper', false); run(E, 0.4);
  assert.equal(E.Shots.fired, 1, 'one kick, one ball');
  assert.equal(held(), 0);
  pad('right_bumper', true); run(E, 0.4); pad('right_bumper', false); run(E, 0.4);
  assert.equal(E.Shots.fired, 1, 'and nothing more after it');
});

test('payload: Meet 0 (no feeder, no gate): balls go straight through once the shooter turns, one at a time', () => {
  bench(MEET0());
  pad('right_trigger', 1);
  run(E, 0.3);
  ballAt('pollen'); run(E, 0.7); ballAt('pollen'); run(E, 0.7); ballAt('pollen'); run(E, 2);
  assert.equal(held(), 3, 'three in, waiting at the stopped shooter');
  assert.equal(E.Shots.fired, 0, 'the shooter is off: nothing leaves');
  assert.equal(E.Payload.summary().gate, null);
  pad('a', true);
  const times = [];
  for (let i = 0; i < 300 && E.Shots.fired < 3; i++) { const f = E.Shots.fired; E.Sim.tick(DT); if (E.Shots.fired > f) times.push({ t: E.Sim.t, v: E.Shots.flying[E.Shots.flying.length - 1].v }); }
  assert.equal(times.length, 3, 'all three through');
  assert.ok(times.every((x) => x.v >= 1), 'each one once the exit speed is at least 1 m/s');
  for (let i = 1; i < times.length; i++) assert.ok(times[i].t - times[i - 1].t >= 0.1, 'one at a time, a ball width apart on the intake: ' + (times[i].t - times[i - 1].t).toFixed(2) + ' s');
  assert.equal(held(), 0);
  assert.ok(E.Shots.flying.every((f) => f.kind === 'pollen' && f.piece), 'the balls the robot held, not the Shot tab\'s kind');
});

test('payload: a gate holds the pieces until it opens, then lets them through', () => {
  for (const late of [false, true]) {
    bench(FULL_(late));
    assert.equal(E.Payload.gate(), 'gate');
    pad('right_trigger', 1); run(E, 0.3);
    ballAt('pollen'); run(E, 0.7); ballAt('pollen'); run(E, 2);
    pad('right_trigger', 0);
    pad('a', true); run(E, 3);
    assert.equal(held(), 2, 'both in, the shooter up to speed');
    assert.ok(E.Payload.waiting(), 'the first is at the shooter');
    assert.equal(E.Shots.fired, 0, 'the gate is shut: nothing leaves' + (late ? ' (its rest is where the code first sent it, not the 0.5 it read before)' : ''));
    assert.ok(!E.Shots.log.some((l) => /Nothing launched/.test(l.text)), 'and nothing was pulsed');
    pad('right_bumper', true);
    run(E, 2);
    assert.equal(E.Shots.fired, 2, 'RB opens the gate: both go');
    assert.match(E.Shots.log.find((l) => /IN|Missed/.test(l.text)).text, /./);
  }
});

test('payload: run backward, the intake puts a piece out through its mouth onto the tiles', () => {
  bench(MEET0());
  pad('right_trigger', 1); run(E, 0.3);
  ballAt('nectar', 'front', 'red'); run(E, 1.2); pad('right_trigger', 0);
  assert.equal(held(), 1);
  assert.equal(E.Payload.held[0].kind, 'nectar');
  const X = E.footBox(E.Sim.chassis, E.Sim.footprint);
  pad('left_trigger', 1); run(E, 0.6); pad('left_trigger', 0);
  assert.equal(held(), 0, 'out');
  assert.equal(E.Payload.summary().ejected, 1);
  const e = E.Match.floor.find((x) => x.kind === 'nectar');
  assert.ok(e, 'a loose NECTAR again');
  assert.equal(e.color, 'red');
  assert.ok(e.x > X.x + E.Sim.footprint.hx, 'out of the front, where it came in');
  run(E, 0.5);
  assert.ok(e.x > X.x + E.Sim.footprint.hx + E.ballSpec('nectar').r, 'and rolled away from the robot');
});

test('payload: which way is in is the first sustained command on an empty robot; the user can pin it', () => {
  // this robot takes balls in on NEGATIVE power
  bench(MEET0('-1.0'));
  pad('right_trigger', 1); run(E, 0.04); pad('right_trigger', 0); run(E, 0.2);
  assert.equal(E.Payload.dirs.intake.sign, 0, 'a blip is not a decision');
  pad('right_trigger', 1); run(E, 0.3);
  assert.equal(E.Payload.dirs.intake.sign, -1, 'negative is in');
  assert.equal(E.Payload.dirs.intake.from, 'first use');
  ballAt('pollen'); run(E, 1);
  assert.equal(held(), 1, 'and it picks up');
  // with something inside, the opposite command is the eject, never a new decision
  pad('right_trigger', 0); pad('left_trigger', 1); run(E, 0.6); pad('left_trigger', 0);
  assert.equal(E.Payload.dirs.intake.sign, -1);
  assert.equal(E.Payload.summary().ejected, 1);
  // pinned the other way in the Shot tab: that wins
  bench(MEET0('-1.0'), { payload: { dirs: { intake: 'positive' } } });
  pad('left_trigger', 1); run(E, 0.3);
  ballAt('pollen'); run(E, 1);
  assert.equal(held(), 1, 'LT now takes it in');
  assert.equal(E.Payload.summary().intakes[0].inFrom, 'pinned');
});

test('payload: a back intake by its name has its mouth at the back edge; two unplaced intakes are one each end', () => {
  bench(MEET0('1.0', 'backIntake'));
  assert.deepEqual(E.Payload.mouths().map((m) => [m.name, m.edge, m.from]), [['backIntake', 'back', 'its name']]);
  pad('right_trigger', 1); run(E, 0.3);
  const front = ballAt('pollen', 'front'); run(E, 1);
  assert.equal(held(), 0, 'a ball at the front is not in a back mouth');
  ballAt('pollen', 'back'); run(E, 1);
  assert.equal(held(), 1, 'one at the back is');
  assert.ok(E.Match.floor.includes(front));
  bench(FULL);
  assert.deepEqual(E.Payload.mouths().map((m) => m.edge), ['front', 'back'], 'intake and intake2');
  // set by hand: both edges can be swapped (the team's own robot has intake at the back)
  E.Shots.cfg.payload.edges = { intake: 'back', intake2: 'front' };
  assert.deepEqual(E.Payload.mouths().map((m) => [m.name, m.edge]), [['intake', 'back'], ['intake2', 'front']]);
});

test('payload: a device on a CAD joint takes in at the edge nearest the joint', () => {
  bench(MEET0());
  // an intake joint drawn out at the robot's left side, 5 cm wide
  E.Sim.dev.intake.mech = { id: 'j1', label: 'side roller', kind: 'revolute', pivot: [0.02, 0.2, 0.05], cluster: [[0, 0.21, 0.05], [0.05, 0.21, 0.05]] };
  const m = E.Payload.mouths()[0];
  assert.equal(m.edge, 'left');
  assert.match(m.from, /CAD joint side roller/);
  assert.ok(Math.abs(m.c - 0.025) < 1e-6 && m.w < 0.1, 'centred on the parts it moves, about as wide');
  // a device the mapping put on a slide is moving something else: no mouth from it (the default robot's Lift)
  E.Sim.dev.intake.mech = { id: 'j2', label: 'Lift', kind: 'linear', pivot: [-0.1, 0.2, 0.05] };
  assert.deepEqual([E.Payload.mouths()[0].edge, E.Payload.mouths()[0].from], ['front', 'the default: the front edge']);
});

test('payload: AUTO starts with 4 pre-loaded POLLEN (G304), TELEOP with none unless set', () => {
  bench(AUTO);
  E.Sim.tick(DT);
  assert.equal(held(), 4, 'four POLLEN');
  assert.ok(E.Payload.held.every((p) => p.kind === 'pollen'));
  assert.equal(E.Payload.summary().preloaded, 4);
  // spun up, then the intake feeds them through: the auto's intake command decides which way is in
  run(E, 6);
  assert.equal(E.Shots.fired, 4, 'all four launched: ' + JSON.stringify(E.Shots.log.map((l) => l.text)));
  assert.equal(E.Payload.dirs.intake.from, 'first feed', 'decided while the flywheel was up');
  bench(MEET0());
  run(E, 0.1);
  assert.equal(held(), 0, 'TELEOP: none');
  bench(MEET0(), { payload: { preload: 2 } });
  run(E, 0.1);
  assert.equal(held(), 2, 'or what the Shot tab says');
});

test('payload: a robot that only shoots keeps the unlimited supply, exactly as before', () => {
  const play = (neutral) => {
    bench(E.SHOOTER_JAVA);
    if (neutral) { E.Payload.tick = () => {}; E.Payload.real = () => false; }
    pad('dpad_up', true); run(E, 2); pad('dpad_up', false);
    for (let i = 0; i < 3; i++) { pad('right_bumper', true); run(E, 0.3); pad('right_bumper', false); run(E, 0.5); }
    run(E, 3);
    return { fired: E.Shots.fired, log: E.Shots.log.map((l) => l.text), act: E.Sim.dev.flywheel.act, fly: E.Sim.dev.flywheel.flyT, pose: { ...E.Sim.chassis } };
  };
  const S = play(false);
  assert.equal(E.Payload.supply().mode, 'unlimited');
  assert.match(E.Payload.supply().why, /no intake/);
  assert.ok(S.fired >= 3, 'a ball at every kick, from nowhere: ' + S.fired);
  assert.equal(S.fly, undefined, 'the flywheel keeps the old slew');
  const tick = E.Payload.tick, real = E.Payload.real;
  try { assert.deepEqual(play(true), S, 'the same run with the game-piece code switched off'); }
  finally { E.Payload.tick = tick; E.Payload.real = real; }
});

test('payload: the flywheel spins up and recovers on its motor\'s time constant, and a shot takes its energy', () => {
  bench(KICKER);
  const s = E.Sim.dev.flywheel, f = E.Payload.flyParams('flywheel');
  // the Shot Sim's own model of the same shooter: the time constant, the dip a ball causes, the recovery
  const m = E.Field.E.motorModel(E.Shots.cfg.motorId, E.Shots.shooterSpec(), 'pollen', 1);
  assert.ok(Math.abs(f.T / m.tauS - 1) < 0.06, `T ${f.T.toFixed(3)} s against the Shot Sim's ${m.tauS.toFixed(3)} s (the rotor is the difference)`);
  pad('a', true);
  let t95 = null;
  for (let i = 0; i < 600 && t95 == null; i++) { E.Sim.tick(DT); if (s.act >= 0.95) t95 = (i + 1) * DT; }
  // plausible: a 6000 rpm goBILDA (0.144 N m stall) on the Shot Sim's reference wheel set (4e-4 kg m^2,
  // two 96 mm Geckos and an 82 mm steel flywheel) is a DC motor with T = I w / tau = 1.8 s: 95 % at 3 T.
  // Teams with that build wait about 3 to 6 s from cold; a bare wheel spins up in under 2 s.
  assert.ok(Math.abs(t95 - f.T * Math.log(20)) <= 2 * DT, `95 % at ${t95.toFixed(2)} s, 3T = ${(f.T * Math.log(20)).toFixed(2)} s`);
  assert.ok(t95 > 2 && t95 < 8, 'in the range a real heavy flywheel takes');
  run(E, 8);
  const before = s.act;
  pad('right_trigger', 1); ballAt('pollen'); run(E, 2.5); pad('right_trigger', 0);
  const v = E.Shots.exitSpeed();
  let pre = s.act;
  pad('right_bumper', true);
  for (let i = 0; i < 50 && E.Shots.fired === 0; i++) { pre = s.act; E.Sim.tick(DT); }   // the kicker swings out, the ball goes
  assert.equal(E.Shots.fired, 1);
  const drop = 1 - s.act / pre;
  // the Shot Sim's own figures for this shooter at this exit speed: the energy a ball takes (its
  // translation and spin, and the slip loss), and the dip that makes in a wheel turning just fast enough
  const mv = E.Field.E.motorModel(E.Shots.cfg.motorId, E.Shots.shooterSpec(), 'pollen', v);
  assert.ok(Math.abs(drop - E.Payload.lastDrop) < 0.002, 'the drop is the ball\'s energy');
  const KE = 0.5 * f.I * Math.pow(pre * f.wf, 2);
  assert.ok(Math.abs(E.Payload.lastDrop - (1 - Math.sqrt(1 - mv.shotEnergyJ / KE))) < 1e-3, 'its kinetic energy less the ball\'s');
  // ours spins at its share of the catalogue free speed, the Shot Sim's at the 97 % a real motor reaches: a few % apart
  assert.ok(Math.abs(E.Payload.lastDrop / mv.dip - 1) < 0.1, `drop ${(E.Payload.lastDrop * 100).toFixed(2)} % against the Shot Sim's ${(mv.dip * 100).toFixed(2)} %`);
  assert.ok(drop > 0.01 && drop < 0.15, 'a few percent for a POLLEN');
  // back to within 1 % of where it was, on the motor's own time: T ln(dip / 1 %), the Shot Sim's open-loop recovery
  let rec = null;
  for (let i = 0; i < 400 && rec == null; i++) { E.Sim.tick(DT); if (s.act >= pre * 0.99) rec = (i + 1) * DT; }
  const want = f.T * Math.log(drop / 0.01);
  assert.ok(rec != null && Math.abs(rec - want) <= 0.06 + 0.1 * want, `recovered in ${rec} s, T ln(dip/1 %) = ${want.toFixed(2)} s`);
  const open = E.Field.E.motorModel(E.Shots.cfg.motorId, Object.assign({}, E.Shots.shooterSpec(), { control: 'power' }), 'pollen', v);
  assert.ok(Math.abs(rec * 1000 / open.recoveryMs - 1) < 0.2, `the Shot Sim's own figure for a shooter run on power: ${open.recoveryMs.toFixed(0)} ms`);
  assert.ok(rec > 0.3 && rec < 4, 'a heavy wheel back in about a second or two between shots');
  assert.ok(before > 0.99 && v > 5);
  // and the old SLEW would have undone a 10 % drop in about a tenth of a second: a motor nobody marks keeps it
  assert.equal(E.Sim.dev.intake.flyT, undefined);
  assert.equal(E.SLEW, 8);
});

test('payload: under setVelocity the hub\'s loop drives hard to the target and holds it there', () => {
  bench(E.SHOOTER_JAVA, { payload: { supply: 'real', preload: 1 } });
  const s = E.Sim.dev.flywheel;
  pad('dpad_up', true); run(E, 1); pad('dpad_up', false);
  const tgt = s.cmd;
  assert.ok(tgt > 0.2 && tgt < 0.95, 'a velocity target below free speed: ' + tgt);
  run(E, 6);
  assert.ok(Math.abs(s.act - tgt) < 0.01, 'settled on the target, not on its power share');
  const t = E.Payload.flyParams('flywheel').T;
  bench(E.SHOOTER_JAVA, { payload: { supply: 'real', preload: 1 } });
  pad('dpad_up', true);
  let k = 0; for (; k < 600 && E.Sim.dev.flywheel.act < 0.95 * tgt; k++) E.Sim.tick(DT);
  assert.ok(k * DT < t * Math.log(20) * 0.5, `at 95 % of the target in ${(k * DT).toFixed(2)} s: power alone takes 3T = ${(3 * t).toFixed(2)} s`);
});

test('payload: a running intake at a FLOWER\'s bottom opening takes its POLLEN, one at a time', () => {
  bench(MEET0(), { staged: true });
  E.Match.floor = [];
  const f = E.Match.flowers.find((q) => q.n[1] === -1), fp = E.Sim.footprint;
  assert.equal(f.stack.length, 4);
  // square up to it, the front edge 9 cm from its middle (where the AI robots stand to take from one)
  const h = Math.atan2(f.n[1], f.n[0]), off = fp.hx + 0.09;
  E.Sim.chassis = { x: f.x - f.n[0] * off - (fp.ox || 0), y: f.y - f.n[1] * off, h };
  pad('right_trigger', 1); run(E, 0.3);
  run(E, 0.18);
  assert.equal(held(), 1, 'one out of the stack');
  run(E, 1);
  assert.equal(held(), 4, 'one at a time until the robot is full');
  assert.equal(f.stack.length, 0);
  assert.equal(E.Payload.summary().fromFlowers, 4);
});

test('payload: taking the other alliance\'s NECTAR is not blocked, but it is called (G408)', () => {
  bench(MEET0());
  pad('right_trigger', 1); run(E, 0.3);
  ballAt('nectar', 'front', 'blue'); run(E, 1);
  assert.equal(held(), 1);
  const g = E.Shots.log.filter((l) => /G408/.test(l.text));
  assert.equal(g.length, 1, 'one note that names the rule');
  assert.equal(E.Payload.summary().otherNectar, 1);
});

test('solo: the staged pieces and the HUMAN PLAYERS without the AI robots, no clock, one list of loose balls', () => {
  bench(MEET0(), { staged: true });
  assert.equal(E.Match.bots.length, 0, 'no AI robots');
  assert.equal(E.Match.live(), false, 'no match to score');
  assert.equal(E.Match.pieces(), true, 'but pieces on the field');
  assert.equal(E.Match.floor.length, 8 + 16, 'both GARDENs and the TELEOP scatter');
  assert.ok(E.Match.flowers.every((f) => f.stack.length === 4));
  assert.equal(E.Match.len, Infinity, 'no time limit of its own');
  // a miss lands among them, in the same list
  pad('right_trigger', 1); run(E, 0.3); ballAt('pollen'); run(E, 1.2); pad('right_trigger', 0);
  pad('a', true); run(E, 4); run(E, 4);
  assert.equal(E.Shots.fired, 1);
  assert.equal(E.Shots.landed.length, 0, 'not in a list of its own');
  assert.ok(Math.abs(E.Match.t - 9.5) < 0.05, 'the field runs, tick for tick: ' + E.Match.t);
  // a TIP brings a HUMAN PLAYER's NECTAR into the LOADING ZONE, as in a match
  E.Field.tip('red'); run(E, 4);
  assert.ok(E.Match.floor.some((e) => e.kind === 'nectar' && e.color === 'red'), 'a NECTAR entered');
  E.Match.on = false;
  assert.equal(E.Match.pieces(), false);
  const t = E.Match.t; run(E, 1);
  assert.equal(E.Match.t, t, 'off: nothing runs');
});

/* The page's own resetMatch (src/app.js), with the page around it stood in for. */
function appResetMatch(env) {
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const a = src.indexOf('function resetMatch(){'), z = src.indexOf('\n}\n', a);
  const names = Object.keys(env);
  return new Function(...names, `${src.slice(a, z + 3)}\nreturn resetMatch;`)(...names.map((n) => env[n]));
}
test('solo: the match menu\'s switch puts the pieces on the field for a robot with an intake, and takes them off', () => {
  const code = bench(MEET0());
  E.Match.on = false; E.Match.floor = [];
  const boxes = { matchOn: { checked: false }, piecesOn: { checked: true }, matchSkill: { value: 'typical' } };
  const env = { $: (s) => boxes[s.slice(1)] || null, Online: { inMatch: () => false }, Field: E.Field, OPTS: { obstacles: 'all' },
    Match: E.Match, CODE: code, Shots: E.Shots, Sim: E.Sim, Payload: E.Payload, renderMatchHud: () => {} };
  const resetMatch = appResetMatch(env);
  resetMatch();
  assert.equal(E.Match.on, true); assert.equal(E.Match.solo, true);
  assert.equal(E.Match.floor.length, 24, 'the staged POLLEN');
  boxes.piecesOn.checked = false;
  resetMatch();
  assert.equal(E.Match.on, false); assert.equal(E.Match.floor.length, 0, 'switched off: gone');
  // a robot that only shoots never gets them (the unlimited supply), and the AI robots win over solo
  boxes.piecesOn.checked = true;
  const sc = bench(E.SHOOTER_JAVA); env.CODE = sc;
  E.Match.on = false; resetMatch();
  assert.equal(E.Match.on, false, 'no intake: no pieces');
  boxes.matchOn.checked = true; resetMatch();
  assert.equal(E.Match.solo, false); assert.equal(E.Match.bots.length, 3);
  E.Match.on = false;
});

test('payload: the workspace file keeps the game-piece settings and refuses junk', () => {
  const cfg = { shooter: 'outtake1', feeder: 'gate', motorId: 'yj6000', hoodDeg: 70, h0In: 16, wheelMm: 96, gear: 1, mountDeg: 0, ball: 'pollen', type: 'single', precision: 'typical',
    payload: { intakes: ['intake', 'intake2'], transfer: '', dirs: { intake: 'negative' }, edges: { intake: 'back', intake2: 'front' }, preload: 3, supply: 'real', rollerMm: 60 } };
  const s = E.sessionFromBench({ code: null, java: '', map: {}, opts: {}, chassis: { x: 0, y: 0, h: 0 }, shots: { seed: 7, spreadScale: 1, fired: 0, scored: 0, cfg } });
  const back = E.unpackSession(E.packSession(s));
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.session.shots.cfg, cfg, 'round trip');
  // an older file without it stays without it
  const old = JSON.parse(JSON.stringify(cfg)); delete old.payload;
  assert.equal('payload' in E.unpackSession(E.packSession(E.sessionFromBench({ shots: { cfg: old } }))).session.shots.cfg, false);
  // junk: wrong types dropped, numbers held to what is physically there, unknown words to the default
  const raw = JSON.parse(E.packSession(s));
  raw.shots.cfg.payload = { intakes: ['a', 5, null, 'b', 'c', 'd', 'e'], transfer: 7, dirs: { intake: 'sideways', x: 'positive', __proto__: 'negative' },
    edges: { intake: 'top' }, preload: 99, supply: 'infinite', rollerMm: -4, extra: 'dropped' };
  const j = E.unpackSession(JSON.stringify(raw));
  assert.equal(j.ok, true, j.error);
  const p = j.session.shots.cfg.payload;
  assert.deepEqual(p, { intakes: ['a', 'b', 'c', 'd'], transfer: null, dirs: { x: 'positive' }, edges: {}, preload: 4, supply: 'auto', rollerMm: 10 });
  raw.shots.cfg.payload = { preload: NaN };
  assert.equal(E.unpackSession(JSON.stringify(raw).replace('"preload":null', '"preload":1e999')).ok, false, 'Infinity is a corrupt file');
  raw.shots.cfg.payload = 'not an object';
  assert.equal('payload' in E.unpackSession(JSON.stringify(raw)).session.shots.cfg, false);
});
