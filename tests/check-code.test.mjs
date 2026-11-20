// tools/check-code.mjs: every OpMode in a team's code run headless, for the team's own CI.
// These hold what it promises: an OpMode that only breaks when a button is pressed is caught, a
// library OpMode the bench has no copy of is not called the team's failure, base classes and
// @Disabled OpModes are left out, and the command line's exit code says pass or fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCode, opModeEntry, everyControl, report } from '../tools/check-code.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools', 'check-code.mjs');
const HEAD = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.Disabled;
import com.qualcomm.robotcore.hardware.DcMotor;
`;
const GOOD = HEAD + `
@TeleOp(name = "Good drive", group = "Main")
public class GoodTeleOp extends LinearOpMode {
    @Override public void runOpMode() {
        DcMotor left = hardwareMap.get(DcMotor.class, "left");
        DcMotor right = hardwareMap.get(DcMotor.class, "right");
        waitForStart();
        while (opModeIsActive()) {
            left.setPower(-gamepad1.left_stick_y);
            right.setPower(-gamepad1.right_stick_y);
        }
    }
}`;
// fine until the second driver presses Y: the array has two places and it writes the sixth
const BUTTON_BUG = HEAD + `
@TeleOp(name = "Breaks on a button")
public class ButtonBug extends LinearOpMode {
    @Override public void runOpMode() {
        DcMotor arm = hardwareMap.get(DcMotor.class, "arm");
        int[] presets = new int[2];
        waitForStart();
        while (opModeIsActive()) {
            if (gamepad2.y) presets[5] = 100;
            arm.setPower(gamepad2.right_trigger);
        }
    }
}`;
const AUTO = HEAD + `
@Autonomous(name = "Leave")
public class LeaveAuto extends LinearOpMode {
    @Override public void runOpMode() {
        DcMotor left = hardwareMap.get(DcMotor.class, "left");
        waitForStart();
        left.setPower(0.5); sleep(500); left.setPower(0);
    }
}`;
const OFF = HEAD + `
@Disabled
@TeleOp(name = "Old one")
public class OldTeleOp extends LinearOpMode { @Override public void runOpMode() { waitForStart(); } }`;
const BASE = HEAD + `
public abstract class BaseOpMode extends LinearOpMode { protected void setup() {} }`;
const LIBRARY = HEAD + `
import com.pedropathing.telemetry.SelectableOpMode;
@TeleOp(name = "Tuning")
public class Tuning extends SelectableOpMode {
    public Tuning() { super("Select a Tuning OpMode", s -> {}); }
}`;
const files = (...list) => list.map(([file, src]) => ({ file, src }));

test('check-code: what the Driver Station would list for a file', () => {
  assert.deepEqual(opModeEntry(GOOD), { kind: 'TeleOp', name: 'Good drive', group: 'Main', class: 'GoodTeleOp', disabled: false, abstract: false });
  assert.equal(opModeEntry(AUTO).kind, 'Autonomous');
  assert.equal(opModeEntry(OFF).disabled, true);
  assert.equal(opModeEntry(BASE), null, 'a base class is not an entry');
  assert.equal(opModeEntry('// @TeleOp(name = "in a comment")\nclass X {}'), null, 'an annotation in a comment does not count');
});

test('check-code: the control script presses every button of both gamepads and lets go between', () => {
  const s = everyControl();
  const pressed = new Set();
  for (const st of s.steps) for (const pad of ['gamepad1', 'gamepad2']) for (const k in st[pad] || {}) pressed.add(pad + '.' + k);
  for (const pad of ['gamepad1', 'gamepad2']) for (const b of ['a', 'b', 'x', 'y', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'left_bumper', 'right_bumper', 'back', 'start', 'left_trigger', 'right_trigger', 'left_stick_y', 'right_stick_x'])
    assert.ok(pressed.has(pad + '.' + b), pad + '.' + b + ' is never worked');
  assert.ok(s.steps.some((st) => !st.gamepad1 && !st.gamepad2), 'no step lets go');
  assert.ok(s.seconds > s.steps[s.steps.length - 1].t, 'the run ends before the last step');
});

test('check-code: good OpModes pass; one that breaks only on a button press is caught, and says where', () => {
  const r = checkCode({ code: files(['GoodTeleOp.java', GOOD], ['ButtonBug.java', BUTTON_BUG], ['LeaveAuto.java', AUTO]) });
  const by = Object.fromEntries(r.opmodes.map((o) => [o.file, o]));
  assert.equal(by['GoodTeleOp.java'].ok, true);
  assert.equal(by['GoodTeleOp.java'].devices, 2);
  assert.equal(by['LeaveAuto.java'].ok, true);
  const bug = by['ButtonBug.java'];
  assert.equal(bug.ok, false);
  assert.equal(bug.runs[0].ok, true, 'with the sticks at rest it runs clean: only the worked controls find it');
  assert.match(bug.why, /every control worked/);
  assert.match(bug.why, /ButtonBug\.java:\d+/, 'the file and line: ' + bug.why);
  assert.deepEqual([r.passed, r.failed, r.ok], [2, 1, false]);
});

test('check-code: @Disabled and base classes are not run, and are listed as such', () => {
  const r = checkCode({ code: files(['GoodTeleOp.java', GOOD], ['OldTeleOp.java', OFF], ['BaseOpMode.java', BASE]) });
  assert.deepEqual(r.opmodes.map((o) => o.file), ['GoodTeleOp.java']);
  assert.deepEqual(r.notRun.map((x) => x.file).sort(), ['BaseOpMode.java', 'OldTeleOp.java']);
  assert.equal(r.ok, true);
});

test('check-code: an OpMode that lives in a library the bench has no copy of is not the team\'s failure', () => {
  const r = checkCode({ code: files(['GoodTeleOp.java', GOOD], ['Tuning.java', LIBRARY]) });
  const t = r.opmodes.find((o) => o.file === 'Tuning.java');
  assert.equal(t.unmodelled, true, JSON.stringify(t));
  assert.deepEqual([r.passed, r.failed, r.unmodelled, r.ok], [1, 0, 1, true]);
  assert.match(report(r, false), /n\/a\s+Tuning\.java/);
});

test('check-code: a team\'s own missing parent class IS a failure', () => {
  const child = HEAD + `
@TeleOp(name = "Child")
public class Child extends MissingParent { }`;
  const r = checkCode({ code: files(['Child.java', child]) });
  assert.equal(r.opmodes[0].ok, false, JSON.stringify(r.opmodes[0]));
  assert.ok(!r.opmodes[0].unmodelled);
  assert.match(r.opmodes[0].why, /MissingParent/);
});

test('check-code: --skip leaves an OpMode out, --only runs just one', () => {
  const all = files(['GoodTeleOp.java', GOOD], ['ButtonBug.java', BUTTON_BUG]);
  const skipped = checkCode({ code: all, skip: ['ButtonBug.java'] });
  assert.deepEqual([skipped.ok, skipped.passed, skipped.failed, skipped.skipped], [true, 1, 0, 1]);
  const only = checkCode({ code: all, only: ['GoodTeleOp.java'] });
  assert.deepEqual(only.opmodes.map((o) => o.file), ['GoodTeleOp.java']);
});

test('check-code: the command line exits 0 on a pass, 1 on a failure, 2 on nothing to run, and writes the summary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simbench-check-'));
  try {
    fs.writeFileSync(path.join(dir, 'GoodTeleOp.java'), GOOD);
    const sum = path.join(dir, 'summary.md');
    let p = spawnSync(process.execPath, [TOOL, dir, '--summary', sum], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stdout, /pass\s+GoodTeleOp\.java/);
    assert.match(fs.readFileSync(sum, 'utf8'), /\| pass \| Good drive \| `GoodTeleOp\.java` \|/);
    fs.writeFileSync(path.join(dir, 'ButtonBug.java'), BUTTON_BUG);
    p = spawnSync(process.execPath, [TOOL, dir, '--json'], { encoding: 'utf8' });
    assert.equal(p.status, 1, p.stdout + p.stderr);
    assert.equal(JSON.parse(p.stdout).failed, 1);
    p = spawnSync(process.execPath, [TOOL, dir, '--skip', 'ButtonBug.java'], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'simbench-check-empty-'));
    fs.writeFileSync(path.join(empty, 'Helper.java'), 'package x; public class Helper {}');
    p = spawnSync(process.execPath, [TOOL, empty], { encoding: 'utf8' });
    assert.equal(p.status, 2, p.stdout + p.stderr);
    fs.rmSync(empty, { recursive: true, force: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
