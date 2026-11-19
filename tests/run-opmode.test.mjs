// tools/run-opmode.mjs: the supported way to run a team's OpMode from Node (another repo's CI
// imports it). Until it existed the only way in was this folder's load.mjs, a test helper that
// could be renamed without anyone outside noticing. These tests hold its options and its result
// in place: the bundled Into The Deep OpModes, an OpMode that extends another OpMode, the
// errors it has to report rather than throw, a caller's own robot, and the command line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runOpMode, readJava, libsFor, isOpModeSource, engine, DT } from '../tools/run-opmode.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITD = path.join(ROOT, 'assets', 'robots', 'into-the-deep');
const TOOL = path.join(ROOT, 'tools', 'run-opmode.mjs');
const HELPERS = ['Arm.java', 'Arm_PID_Class.java', 'MecanumDrive.java', 'Slides_PID_Class.java'];

const HEAD = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.TouchSensor;
`;
const MAIN = HEAD + `
@TeleOp(name = "Main")
public class MainTeleOp extends OpMode {
    protected DcMotor left, right, shooter;
    protected double shotPower() { return Gains.SHOT; }
    @Override public void init() {
        left = hardwareMap.get(DcMotor.class, "left");
        right = hardwareMap.get(DcMotor.class, "right");
        shooter = hardwareMap.get(DcMotor.class, "shooter");
    }
    @Override public void loop() {
        double f = -gamepad1.left_stick_y;
        left.setPower(f); right.setPower(f);
        shooter.setPower(gamepad1.a ? shotPower() : 0);
        telemetry.addData("shot", shotPower());
    }
}`;
const ENCODERS = HEAD + `
@TeleOp(name = "Main + encoders")
public class MainTeleOpEncoders extends MainTeleOp {
    @Override protected double shotPower() { return 0.9; }
}`;
const GAINS = `package org.firstinspires.ftc.teamcode;
public class Gains { public static double SHOT = 0.6; }`;
const OTHER = HEAD + `
@TeleOp(name = "Motor test")
public class MotorTest extends OpMode {
    DcMotor m;
    @Override public void init() { m = hardwareMap.get(DcMotor.class, "left"); }
    @Override public void loop() { m.setPower(0.25); }
}`;
const TEAM = [
  { file: 'MotorTest.java', src: OTHER }, { file: 'Gains.java', src: GAINS },
  { file: 'MainTeleOp.java', src: MAIN }, { file: 'MainTeleOpEncoders.java', src: ENCODERS },
];

test('Into The Deep: the team\'s TeleOp runs headless and the sticks reach its motors', () => {
  const r = runOpMode({ code: ITD, opmode: 'sample_teleop.java', seconds: 4,
    gamepad: [{ t: 0, gamepad1: { left_stick_y: -1 } }, { t: 1, gamepad2: { x: true } }, { t: 1.1 }] });
  assert.equal(r.ok, true, JSON.stringify(r.error || r.compile));
  assert.equal(r.class, 'org.firstinspires.ftc.teamcode.TeleOp.sample_teleop');
  assert.equal(r.style, 'linear');
  assert.deepEqual(r.helpers, HELPERS, 'the four files that aren\'t OpModes are its helper classes');
  assert.deepEqual(r.siblings, [], 'and it leans on no other OpMode');
  assert.equal(r.ran, 4);
  assert.equal(r.ended, false, 'a TeleOp is still looping when the time is up');
  const names = r.devices.map((d) => d.name);
  for (const n of ['fL', 'bL', 'fR', 'bR', 'Arm', 'uppies', 'linkL', 'outClaw', 'imu']) assert.ok(names.includes(n), n + ' was asked for');
  assert.deepEqual(r.devices.find((d) => d.name === 'fL'), { name: 'fL', type: 'DcMotorEx', kind: 'motor' });
  // the first second: stick up. All four wheels at full power, then back to rest
  for (const n of ['fL', 'bL', 'fR', 'bR']) {
    assert.equal(Math.abs(r.peaks[n].peak), 1, n + ' at full power under the stick');
    assert.equal(r.peaks[n].last, 0, n + ' at rest once the stick is let go');
  }
  // gamepad2 X for a tenth of a second: the hand-off, lift to 1150 ticks and arm to -1130
  assert.ok(r.telemetry.includes('slides target  : 1150') && r.telemetry.includes('target  : -1130'), r.telemetry.join(' | '));
  assert.equal(r.peaks.uppies.peak, 1, 'the lift is driven up');
  assert.ok(r.peaks.linkL.last > 0 && r.peaks.linkL.last < 1, 'servos report the position they were sent to');
  assert.ok(!('imu' in r.peaks), 'a sensor has no command');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(r)));
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'the result is plain data');
});

test('Into The Deep: every bundled OpMode compiles with the team\'s helpers and runs clean', () => {
  const files = readJava(ITD);
  const ops = files.filter((f) => isOpModeSource(f.src)).map((f) => f.file);
  assert.deepEqual(ops, ['BAL.java', 'TheHolyGrail.java', 'sample_teleop.java']);
  for (const op of ops) {
    const r = runOpMode({ code: files, opmode: op, seconds: 2 });
    assert.equal(r.ok, true, op + ': ' + JSON.stringify(r.error || r.compile));
    assert.deepEqual(r.compile, { ok: true, error: null, line: null, parseErrors: [] });
    assert.deepEqual(r.helpers, HELPERS);
    assert.ok(r.devices.length >= 15, op + ' asks for its hardware (' + r.devices.length + ')');
  }
});

test('Into The Deep: the Road Runner auto is read with MecanumDrive, and what the VM did not follow is listed', () => {
  const r = runOpMode({ code: ITD, opmode: 'TheHolyGrail', seconds: 3 });
  assert.equal(r.ok, true, JSON.stringify(r.error || r.compile));
  assert.equal(r.opmode, 'TheHolyGrail.java', 'named without .java');
  assert.ok(r.devices.some((d) => d.name === ' bR'), 'MecanumDrive\'s " bR", stray space and all');
  assert.ok(r.devices.some((d) => d.kind === 'hub'));
  assert.ok(r.peaks.inClaw && r.peaks.inClaw.last === 0.3, 'INIT closes the claw');
  // the trajectory builder is Road Runner's own library: on this stand-in robot its calls are
  // absorbed, and the result says so instead of passing for a driven path
  assert.ok(r.stubs.some((s) => /strafeToLinearHeading|splineToConstantHeading/.test(s.call)), 'the builder calls are listed');
  const at = r.stubs.find((s) => /strafeToLinearHeading/.test(s.call));
  assert.ok(at.count > 0 && at.file === 'TheHolyGrail.java' && at.line > 0, 'with the file and line they were called from');
  assert.ok(!('fL' in r.peaks), 'so the drive motors show no command');
});

test('an OpMode that extends another OpMode is run with its parent', () => {
  const r = runOpMode({ code: TEAM, opmode: 'MainTeleOpEncoders.java', seconds: 1, gamepad: [{ t: 0, gamepad1: { a: true, left_stick_y: -0.5 } }] });
  assert.equal(r.ok, true, JSON.stringify(r.error || r.compile));
  assert.deepEqual(r.helpers, ['Gains.java']);
  assert.deepEqual(r.siblings, ['MainTeleOp.java'], 'its parent, and not the unrelated Motor test');
  assert.equal(r.style, 'iterative');
  assert.deepEqual(r.devices.map((d) => d.name), ['left', 'right', 'shooter'], 'the parent\'s hardware');
  assert.equal(r.peaks.shooter.peak, 0.9, 'shotPower() is the variant\'s, loop() the parent\'s');
  assert.equal(r.peaks.left.peak, 0.5);
  assert.deepEqual(r.telemetry, ['shot : 0.9']);
  // the parent itself, with the helper's constant
  const p = runOpMode({ code: TEAM, opmode: 'MainTeleOp', seconds: 1, gamepad: [{ t: 0, gamepad1: { a: true } }] });
  assert.equal(p.ok, true);
  assert.deepEqual(p.siblings, []);
  assert.equal(p.peaks.shooter.peak, 0.6);
});

test('a parent that was not given: the result carries MissingClass, it does not throw or pass', () => {
  const r = runOpMode({ code: TEAM.filter((f) => f.file !== 'MainTeleOp.java'), opmode: 'MainTeleOpEncoders.java', seconds: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.compile.ok, true, 'it compiles; it is the run that has nothing to run');
  assert.equal(r.error.cls, 'MissingClass');
  assert.match(r.error.msg, /^MainTeleOpEncoders extends MainTeleOp, and MainTeleOp\.java isn't loaded/);
  assert.equal(r.error.file, 'MainTeleOpEncoders.java', 'the file is named as the team names it');
  assert.equal(r.error.phase, 'init');
  assert.equal(r.ran, 0);
  assert.deepEqual(r.devices, []);
});

test('an OpMode that stops on an exception: where and when', () => {
  const src = HEAD + `
@TeleOp(name = "Crash")
public class Crash extends OpMode {
    DcMotor m; int[] slots = new int[2]; int n = 0;
    @Override public void init() { m = hardwareMap.get(DcMotor.class, "m"); }
    @Override public void loop() {
        m.setPower(0.4);
        slots[n++] = 1;
    }
}`;
  const r = runOpMode({ code: [{ file: 'Crash.java', src }], opmode: 'Crash.java', seconds: 2 });
  assert.equal(r.ok, false);
  assert.match(r.error.cls, /ArrayIndexOutOfBounds/);
  assert.equal(r.error.file, 'Crash.java');
  assert.equal(r.error.line, src.split('\n').findIndex((l) => /slots\[n\+\+\]/.test(l)) + 1);
  assert.equal(r.error.phase, 'run');
  assert.equal(r.error.at, 0.06, 'on the third pass');
  assert.equal(r.ran, 0.06);
  assert.equal(r.peaks.m.peak, 0.4, 'what it did before stopping is still reported');
});

test('code that does not compile, and a helper that cannot be read', () => {
  const broken = MAIN.replace('double f = -gamepad1.left_stick_y;', 'double f = -gamepad1.left_stick_y');
  const r = runOpMode({ code: [{ file: 'MainTeleOp.java', src: broken }, { file: 'Gains.java', src: GAINS }], opmode: 'MainTeleOp.java' });
  assert.equal(r.ok, false);
  assert.equal(r.compile.ok, false);
  assert.ok(r.compile.error, 'the parser\'s message');
  assert.ok(r.compile.line >= broken.split('\n').findIndex((l) => /double f =/.test(l)) + 1, 'and about where (line ' + r.compile.line + ')');
  assert.equal(r.error, null);
  assert.deepEqual(r.devices, []);

  const h = runOpMode({ code: [{ file: 'MotorTest.java', src: OTHER }, { file: 'Gains.java', src: GAINS.replace('SHOT = 0.6;', 'SHOT = ;') }], opmode: 'MotorTest.java', seconds: 0.5 });
  assert.equal(h.compile.ok, true);
  assert.equal(h.compile.parseErrors.length, 1);
  assert.equal(h.compile.parseErrors[0].file, 'Gains.java');
  assert.equal(h.ok, false, 'a file the bench could not read is not a clean run');
  assert.equal(h.peaks.left.peak, 0.25, 'though the OpMode, which never uses it, ran');
});

test('the gamepad script: each step holds until the next, a negative time is during INIT, a function works too', () => {
  const src = HEAD + `
@TeleOp(name = "Pick")
public class Pick extends OpMode {
    DcMotor m; String side = "RED";
    @Override public void init() { m = hardwareMap.get(DcMotor.class, "m"); }
    @Override public void init_loop() { if (gamepad1.x) side = "BLUE"; }
    @Override public void loop() { m.setPower(-gamepad1.left_stick_y); telemetry.addData("side", side); telemetry.addData("t", getRuntime()); }
}`;
  const code = [{ file: 'Pick.java', src }];
  const a = runOpMode({ code, opmode: 'Pick.java', seconds: 2, gamepad: [{ t: -0.2, gamepad1: { x: true } }, { t: 0, gamepad1: { left_stick_y: -0.5 } }, { t: 1, gamepad1: { left_stick_y: 1 } }, { t: 1.5 }] });
  assert.equal(a.telemetry[0], 'side : BLUE', 'X was held in INIT');
  assert.deepEqual([a.peaks.m.max, a.peaks.m.min, a.peaks.m.peak, a.peaks.m.last], [0.5, -1, -1, 0]);
  assert.ok(Math.abs(parseFloat(a.telemetry[1].replace('t : ', '')) - 2) < 1e-6, 'getRuntime() counts from START, not from INIT (' + a.telemetry[1] + ')');
  const none = runOpMode({ code, opmode: 'Pick.java', seconds: 1 });
  assert.equal(none.telemetry[0], 'side : RED');
  assert.equal(none.peaks.m.peak, 0);
  // the same script keyed by time, and as a function of the time since START
  const keyed = runOpMode({ code, opmode: 'Pick.java', seconds: 2, gamepad: { '-0.2': { gamepad1: { x: true } }, 0: { gamepad1: { left_stick_y: -0.5 } }, 1: { gamepad1: { left_stick_y: 1 } }, 1.5: {} } });
  assert.deepEqual(keyed.peaks, a.peaks);
  const seen = [];
  const fn = runOpMode({ code, opmode: 'Pick.java', seconds: 1, gamepad: (t, run) => { seen.push([run.phase, t]); return { 1: { left_stick_y: t > 0.5 ? -1 : 0 } }; } });
  assert.equal(fn.peaks.m.peak, 1);
  assert.equal(seen.filter((s) => s[0] === 'init').length, Math.round(0.4 / DT), 'asked on every INIT pass, with a time before START');
  assert.ok(seen.filter((s) => s[0] === 'init').every((s) => s[1] < 0));
});

test('a caller\'s own robot: its host answers the sensors, the stand-in answers the rest', () => {
  const src = HEAD + `
@Autonomous(name = "To the wall")
public class ToTheWall extends LinearOpMode {
    @Override public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        Servo flag = hardwareMap.get(Servo.class, "flag");
        TouchSensor wall = hardwareMap.get(TouchSensor.class, "wall");
        waitForStart();
        while (opModeIsActive() && !wall.isPressed()) { drive.setPower(0.5); telemetry.addData("at", drive.getCurrentPosition()); telemetry.update(); }
        drive.setPower(0);
        flag.setPosition(1);
    }
}`;
  // a robot 0.6 m from a wall, moving 1.2 m/s at full power
  let x = 0;
  const calls = [];
  const r = runOpMode({
    code: [{ file: 'ToTheWall.java', src }], opmode: 'ToTheWall.java', seconds: 5, engine: engine(),
    host: (run) => ({ touch: (name) => name === 'wall' && x >= 0.6, rumble() {}, pose: () => ({ x, y: 0, h: 0 }) }),
    onStart: (run) => calls.push('start:' + run.phase),
    beforeTick: (run) => { if (run.tick === 0) calls.push('before:' + run.phase); },
    afterTick: (run) => { if (run.phase === 'run') x += (run.devices.get('drive').cmd || 0) * 1.2 * run.dt; },
  });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.ended, true, 'the auto ran to its own end');
  assert.ok(Math.abs(r.ran - 1.02) < 0.03, 'about a second to cover 0.6 m (' + r.ran + ' s), not the 5 asked for');
  assert.ok(x >= 0.6 && x < 0.63, 'and it stopped at the wall (' + x.toFixed(3) + ' m)');
  assert.deepEqual([r.peaks.drive.peak, r.peaks.drive.last], [0.5, 0]);
  assert.equal(r.peaks.flag.last, 1);
  assert.deepEqual(calls, ['before:init', 'start:init', 'before:run']);
  // the stand-in's own motor turned meanwhile: an encoder that counts, without the caller writing one
  assert.ok(parseFloat(r.telemetry[0].replace('at : ', '')) > 1000, r.telemetry.join(' | '));
  // a caller that keeps its own devices: they are its to move, and their commands are still reported
  const own = new Map();
  let d = 0;
  const mineToo = runOpMode({
    code: [{ file: 'ToTheWall.java', src }], opmode: 'ToTheWall.java', seconds: 5,
    host: {
      dev(name, type, kind) { if (!own.has(name)) own.set(name, { name, type, kind, cmd: kind === 'servo' ? null : 0, ticks: 0, offset: 0, vel: 0, target: 0, mode: 'run', tpr: 28, spec: { rpm: 6000 } }); return own.get(name); },
      touch: () => d >= 0.6,
    },
    afterTick: (run) => { d += (own.get('drive').cmd || 0) * 1.2 * run.dt; },
  });
  assert.equal(mineToo.ended, true);
  assert.deepEqual([...own.keys()], ['drive', 'flag', 'wall']);
  assert.equal(own.get('drive').ticks, 0, 'the stand-in leaves a motor that is the caller\'s alone');
  assert.deepEqual([mineToo.peaks.drive.peak, mineToo.peaks.drive.last, mineToo.peaks.flag.last], [0.5, 0, 1]);
  assert.equal(mineToo.telemetry[0], 'at : 0');
  // without the caller's robot nothing ever presses the wall: it drives for the whole time
  const alone = runOpMode({ code: [{ file: 'ToTheWall.java', src }], opmode: 'ToTheWall.java', seconds: 2 });
  assert.equal(alone.ended, false);
  assert.deepEqual([alone.peaks.drive.last, alone.ran], [0.5, 2]);
});

test('files: a folder is read to the bottom, and the OpMode is found by name or by the end of its path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-opmode-'));
  try {
    const pkg = path.join(dir, 'TeamCode', 'src', 'main', 'java', 'org', 'firstinspires', 'ftc', 'teamcode');
    fs.mkdirSync(path.join(pkg, 'robot'), { recursive: true });
    fs.mkdirSync(path.join(pkg, 'old'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'MainTeleOp.java'), MAIN);
    fs.writeFileSync(path.join(pkg, 'MainTeleOpEncoders.java'), ENCODERS);
    fs.writeFileSync(path.join(pkg, 'robot', 'Gains.java'), GAINS);
    fs.writeFileSync(path.join(pkg, 'old', 'MotorTest.java'), OTHER);
    fs.writeFileSync(path.join(pkg, 'notes.txt'), 'not code');
    assert.deepEqual(readJava(dir).map((f) => f.file), ['MainTeleOp.java', 'MainTeleOpEncoders.java', 'MotorTest.java', 'Gains.java']);
    const r = runOpMode({ code: dir, opmode: 'MainTeleOpEncoders.java', seconds: 0.5 });
    assert.equal(r.ok, true);
    assert.deepEqual([r.helpers, r.siblings], [['Gains.java'], ['MainTeleOp.java']]);
    // a list of files instead of the folder
    const l = runOpMode({ code: [path.join(pkg, 'MainTeleOp.java'), path.join(pkg, 'robot')], opmode: 'MainTeleOp', seconds: 0.5 });
    assert.equal(l.ok, true);
    // two files with one name: the end of the path says which
    fs.writeFileSync(path.join(pkg, 'old', 'MainTeleOp.java'), OTHER.replace(/MotorTest/g, 'MainTeleOp').replace('package org.firstinspires.ftc.teamcode;', 'package org.firstinspires.ftc.teamcode.old;'));
    assert.throws(() => runOpMode({ code: dir, opmode: 'MainTeleOp.java' }), /2 files are named MainTeleOp\.java/);
    const o = runOpMode({ code: dir, opmode: 'old/MainTeleOp.java', seconds: 0.5 });
    assert.equal(o.peaks.left.peak, 0.25, 'the one in old/');
    assert.throws(() => runOpMode({ code: dir, opmode: 'Nope.java' }), /no file named Nope\.java among the 5 \.java files/);
    assert.throws(() => runOpMode({ code: dir }), /no OpMode named/);
    assert.throws(() => runOpMode({ opmode: 'MainTeleOp.java' }), /no code given/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the picking rule is the app\'s: an annotation in a comment does not make a helper an OpMode', () => {
  assert.equal(isOpModeSource(MAIN), true);
  assert.equal(isOpModeSource(GAINS), false);
  assert.equal(isOpModeSource(GAINS + '\n// used by the @TeleOp classes\n/* and by @Autonomous ones */'), false);
  assert.equal(isOpModeSource('public abstract class Base extends LinearOpMode {}'), true, 'a base class with no annotation is still an OpMode');
  const E = engine();
  const files = TEAM.map((f) => ({ file: f.file, path: f.file, src: f.src }));
  const got = libsFor(E, files, files[3]);
  assert.deepEqual(got.libs.map((l) => l.file), ['Gains.java', 'MainTeleOp.java'], 'helpers first, then the OpModes it names: what jvCompile is handed');
});

test('the command line prints the result as JSON and says how it went in its exit code', () => {
  const cli = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-opmode-cli-'));
  try {
    const script = path.join(dir, 'sticks.json');
    fs.writeFileSync(script, JSON.stringify([{ t: 0, gamepad1: { left_stick_y: -1 } }, { t: 0.5 }]));
    const ok = cli(ITD, '--opmode', 'sample_teleop.java', '--seconds', '1', '--gamepad', script, '--compact');
    assert.equal(ok.status, 0, ok.stderr);
    const r = JSON.parse(ok.stdout);
    assert.equal(ok.stdout.trim().split('\n').length, 1, '--compact is one line');
    assert.equal(r.ok, true);
    assert.equal(Math.abs(r.peaks.fL.peak), 1);
    assert.equal(r.peaks.fL.last, 0);

    fs.writeFileSync(path.join(dir, 'MainTeleOpEncoders.java'), ENCODERS);
    const lost = cli(dir, '--opmode', 'MainTeleOpEncoders.java');
    assert.equal(lost.status, 1, 'an OpMode that stopped on an error');
    assert.equal(JSON.parse(lost.stdout).error.cls, 'MissingClass');

    const none = cli(dir, '--opmode', 'Nope.java');
    assert.equal(none.status, 2);
    assert.match(none.stderr, /no file named Nope\.java/);
    assert.equal(none.stdout, '');
    assert.equal(cli().status, 2);
    assert.equal(cli(dir, '--opmode', 'MainTeleOpEncoders.java', '--seconds', 'soon').status, 2);
    const help = cli('--help');
    assert.equal(help.status, 0);
    assert.match(help.stdout, /usage: node tools\/run-opmode\.mjs/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---- --runs / --seed: the OpMode many times, a little different each, and how often it worked ---- */
test('runs: the same OpMode N times from seeds, per-run results and a success rate; nothing else in the result changes', () => {
  const plain = runOpMode({ code: ITD, opmode: 'sample_teleop.java', seconds: 1 });
  assert.equal('monteCarlo' in plain, false, 'asked for nothing extra, gets nothing extra');
  const r = runOpMode({ code: ITD, opmode: 'sample_teleop.java', seconds: 1, runs: 4, seed: 3 });
  // the run you always got is still there, field for field
  for (const k of Object.keys(plain)) assert.deepEqual(r[k], plain[k], k);
  const mc = r.monteCarlo;
  assert.equal(mc.mode, 'stand-in'); assert.equal(mc.runs, 4); assert.equal(mc.seed, 3);
  assert.equal(mc.results.length, 4);
  assert.equal(mc.passed + mc.failed, 4); assert.equal(mc.successRate, 1);
  assert.deepEqual(mc.results.map((x) => x.seed), [0, 1, 2, 3].map((i) => engine().mcSeedFor(3, i)));
  for (const x of mc.results) {
    assert.equal(x.ok, true); assert.ok(x.variation.volts >= 12 && x.variation.volts <= 13.5);
    assert.ok(Math.abs(x.variation.startX) <= 1 && Math.abs(x.variation.startHeading) <= 2);
  }
  // the same seed, the same batch; another seed, another
  assert.deepEqual(runOpMode({ code: ITD, opmode: 'sample_teleop.java', seconds: 1, runs: 4, seed: 3 }).monteCarlo, mc);
  assert.notDeepEqual(runOpMode({ code: ITD, opmode: 'sample_teleop.java', seconds: 1, runs: 4, seed: 4 }).monteCarlo.results.map((x) => x.variation), mc.results.map((x) => x.variation));
  // an OpMode that stops on an error works in none of them
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-opmode-runs-'));
  try {
    fs.writeFileSync(path.join(dir, 'MainTeleOpEncoders.java'), ENCODERS);
    const bad = runOpMode({ code: dir, opmode: 'MainTeleOpEncoders.java', seconds: 1, runs: 3 });
    assert.equal(bad.ok, false); assert.equal(bad.monteCarlo.successRate, 0); assert.equal(bad.monteCarlo.failed, 3);
    assert.equal(bad.monteCarlo.results[0].error.cls, 'MissingClass');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // 50 runs at most
  assert.equal(runOpMode({ code: ITD, opmode: 'sample_teleop.java', seconds: 0.2, runs: 999 }).monteCarlo.runs, 50);
});

test('runs: with a robot (cad) the runs are the full sim: where the auto ends against the path\'s end, with the cause of each miss', () => {
  const opts = { code: ITD, opmode: 'TheHolyGrail.java', seconds: 30, runs: 3, seed: 1, cad: path.join(ITD, 'robot.step.gz'), joints: path.join(ITD, 'joints.json') };
  const r = runOpMode(opts);
  const mc = r.monteCarlo;
  assert.equal(mc.mode, 'physics'); assert.equal(mc.results.length, 3);
  assert.equal(mc.success, 'pose'); assert.equal(mc.within, 2); assert.equal(mc.degrees, 5);
  assert.deepEqual([mc.target.x, mc.target.y], [-18.95, 35]);
  assert.ok(mc.nominal.err.pos < 2 && mc.nominal.ok);
  for (const x of mc.results) {
    assert.ok(Number.isFinite(x.err.pos) && Number.isFinite(x.err.deg) && x.pose && Array.isArray(x.extremes));
    assert.equal(x.ok, x.err.pos <= 2 && x.err.deg <= 5);
  }
  assert.equal(mc.histogram.reduce((a, b) => a + b.runs, 0), 3);
  assert.ok(mc.successRate >= 0 && mc.successRate <= 1 && mc.passed + mc.failed === 3);
  // the same seed again, and a tighter threshold
  assert.deepEqual(runOpMode(opts).monteCarlo.results, mc.results);
  const tight = runOpMode(Object.assign({}, opts, { within: 0.01, degrees: 0.01 })).monteCarlo;
  assert.equal(tight.passed, 0); assert.equal(tight.worst.length, 3);
});

test('runs: the command line takes --runs, --seed and --min-rate, and says what is wrong with them', () => {
  const cli = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
  const ok = cli(ITD, '--opmode', 'sample_teleop.java', '--seconds', '1', '--runs', '3', '--seed', '9', '--compact');
  assert.equal(ok.status, 0, ok.stderr);
  const r = JSON.parse(ok.stdout);
  assert.equal(r.monteCarlo.runs, 3); assert.equal(r.monteCarlo.seed, 9); assert.equal(r.monteCarlo.successRate, 1);
  assert.equal(cli(ITD, '--opmode', 'sample_teleop.java', '--seconds', '1', '--runs', '2', '--min-rate', '1').status, 0);
  // the exit code follows the rate when it is asked to: a rate of 1 clears 0.5, an OpMode that stops on an error does not
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-opmode-runs-cli-'));
  try {
    fs.writeFileSync(path.join(dir, 'MainTeleOpEncoders.java'), ENCODERS);
    assert.equal(cli(dir, '--opmode', 'MainTeleOpEncoders.java', '--runs', '2', '--min-rate', '0.5').status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  for (const bad of [['--runs', '0'], ['--runs', '51'], ['--runs', '2.5'], ['--runs', 'many'], ['--seed', 'x', '--runs', '2'], ['--runs', '2', '--min-rate', '2'], ['--cad', 'robot.step']]) {
    const x = cli(ITD, '--opmode', 'sample_teleop.java', ...bad);
    assert.equal(x.status, 2, bad.join(' '));
  }
  assert.match(cli('--help').stdout, /--runs/);
});
