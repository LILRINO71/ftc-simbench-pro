// How fast a team's loop runs on the bench, and what its clock reads. The sim steps the robot every
// 20 ms and runs one pass of the OpMode's loop per step. opModeIsActive(), isStopRequested() and
// idle() are flag reads and a Thread.yield() on the robot: they take no robot time, so a loop that
// checks opModeIsActive() three times, or ends in idle() (the SDK samples do), must still run one
// pass per step. It used to lose a whole step at every extra check (25 or 13 passes a second).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpMode } from '../tools/run-opmode.mjs';

const HEAD = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*;
import com.qualcomm.robotcore.hardware.*;
import com.qualcomm.robotcore.util.*;
import java.util.*;
`;
const linear = (body, extra = '') => HEAD + `@TeleOp(name="T") public class T extends LinearOpMode {
${extra}
  @Override public void runOpMode() throws InterruptedException {
${body}
  }
}`;
const run = (src, seconds = 1.5) => {
  const r = runOpMode({ code: [{ file: 'T.java', src }], opmode: 'T.java', seconds });
  assert.equal(r.error, null, JSON.stringify(r.error));
  return r;
};

/* passes in one simulated second, and the smallest and largest dt the loop measured (ms) */
function passes(body, extra = '') {
  const r = run(linear(`    DcMotorEx m = hardwareMap.get(DcMotorEx.class, "m");
    waitForStart();
    ElapsedTime rt = new ElapsedTime(), t = new ElapsedTime();
    int n = 0; double lo = 1e9, hi = 0;
    while (opModeIsActive() && rt.seconds() < 1.0) {
      double dt = t.seconds(); t.reset();
      if (n > 0) { lo = Math.min(lo, dt); hi = Math.max(hi, dt); }
      n++;
${body}
    }
    System.out.println(n + " " + Math.round(lo * 1000) + " " + Math.round(hi * 1000));`, extra));
  return r.prints[0].split(' ').map(Number);
}

test('loop rate: extra opModeIsActive() checks and idle() cost no robot time', () => {
  const plain = passes('      m.setPower(0.5);');
  assert.ok(plain[0] >= 50 && plain[0] <= 51, 'one pass per 20 ms step: ' + plain);
  assert.deepEqual(plain.slice(1), [20, 20]);
  // the SDK sample idiom, a second check in the body, and three helpers that each check it
  assert.deepEqual(passes('      m.setPower(0.5);\n      idle();'), plain);
  assert.deepEqual(passes('      if (opModeIsActive()) m.setPower(0.5);\n      telemetry.update();'), plain);
  assert.deepEqual(passes('      drive(m); drive(m); drive(m);', '  void drive(DcMotorEx m){ if (!opModeIsActive()) return; m.setPower(0.3); }'), plain);
  assert.deepEqual(passes('      if (isStopRequested()) break;\n      Thread.yield();\n      m.setPower(0.5);'), plain);
  // a loop inside the pass with no gate in it (four motors set in a for loop) is part of the pass
  assert.deepEqual(passes('      for (int k = 0; k < 4; k++) m.setPower(0.1 * k);\n      idle();'), plain);
});

test('loop rate: a wait loop takes a step per pass, and a sleep() in the loop is the pass', () => {
  // an autonomous step that waits on a condition: each check of the condition is one step
  const r = run(linear(`    waitForStart();
    ElapsedTime t = new ElapsedTime();
    int n = 0;
    while (opModeIsActive() && n < 10) { n++; telemetry.addData("n", n); telemetry.update(); }
    System.out.println(n + " " + Math.round(t.milliseconds()));
    int k = 0; ElapsedTime s = new ElapsedTime();
    while (opModeIsActive() && k < 5) { k++; sleep(100); }
    System.out.println(k + " " + Math.round(s.milliseconds()));`), 3);
  const [a, b] = r.prints.map((l) => l.split(' ').map(Number));
  assert.equal(a[0], 10);
  assert.ok(Math.abs(a[1] - 180) <= 20, '10 checks of the condition: 9 or 10 steps, ' + a[1] + ' ms');
  assert.equal(b[0], 5);
  // five sleeps of 100 ms: about 500 ms (each rounded up to the 20 ms step), not 100 ms plus a step each
  assert.ok(b[1] >= 480 && b[1] <= 520, 'sleeps: ' + b[1] + ' ms');
});

test('loop rate: a busy-wait with no gate still lets time pass, and a thread loops at its own rate', () => {
  // no gate at all: the guard forces a step, so the run ends instead of hanging
  const r = run(linear(`    waitForStart();
    long x = 0;
    while (true) { x++; }`), 0.3);
  assert.equal(r.ran, 0.3);
  // a team thread with its own opModeIsActive() loop: one pass per step, and the main loop too
  const t = run(linear(`    waitForStart();
    final int[] th = {0};
    new Thread(() -> { while (opModeIsActive()) { th[0]++; idle(); } }).start();
    int n = 0; ElapsedTime rt = new ElapsedTime();
    while (opModeIsActive() && rt.seconds() < 1.0) { n++; if (opModeIsActive()) idle(); }
    System.out.println(n + " " + th[0]);`));
  const [n, th] = t.prints[0].split(' ').map(Number);
  assert.ok(n >= 50 && n <= 51, 'main loop: ' + n);
  assert.ok(th >= 48 && th <= 52, 'thread loop: ' + th);
});
