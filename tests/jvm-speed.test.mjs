// Interpreter speed ratchet. tests/cpu-bench.test.mjs holds a whole sim tick (physics, match, the
// OpMode) at 2x; a 1.3-1.5x slowdown of the Java VM alone hid inside it. This holds the VM by itself
// on a loop-heavy OpMode (a tight loop of calls, ++ and op= nested in blocks, as the slowdown was
// in; ints, longs, fields and array elements; a list, a PID, the clock): its time divided by the
// time of the same fixed JavaScript reference cpu-bench uses, so a slow or busy machine moves both
// and the ratio stays put. Short pieces of each are taken in turn and the quickest of each kept,
// since another program on the machine can only add time. It fails past 2x, the margin cpu-bench
// uses: on a busy machine (other test runs sharing the CPU) the ratio swung by a third and more.
//
// A slowdown on purpose, or a faster VM that should stay fast: look at what changed, re-measure and
// commit tests/jvm-speed-baseline.json saying why:
//   UPDATE_JVM_SPEED=1 node --test tests/jvm-speed.test.mjs        (PowerShell: $env:UPDATE_JVM_SPEED=1)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';
import { reference } from '../tools/bench-cpu.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'tests', 'jvm-speed-baseline.json');
const MAX_SLOWDOWN = 2;
const E = loadEngine();

const SRC = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*;
import com.qualcomm.robotcore.hardware.*;
import com.qualcomm.robotcore.util.ElapsedTime;
import java.util.*;
@TeleOp(name="Loops") public class Loops extends LinearOpMode {
  int hits = 0; long total = 0; double[] hist = new double[16];
  static class Pid { double kp = 0.02, ki = 0.001, sum = 0; int n = 0;
    double out(double err, double dt) { sum += err * dt; n++; return kp * err + ki * sum; } }
  double f(double x) { return x * 0.5 + 1; }
  int g(int a, int b) { return (a * 31 + b) % 1000; }
  @Override public void runOpMode() {
    DcMotor lift = hardwareMap.get(DcMotor.class, "lift");
    Pid pid = new Pid(); List<Integer> marks = new ArrayList<>();
    for (int i = 0; i < 50; i++) marks.add(i);
    ElapsedTime t = new ElapsedTime();
    waitForStart();
    double s = 0; long n = 0;
    while (opModeIsActive()) {
      if (lift != null) { for (int j = 0; j < 4; j++) {
        if (j >= 0) { for (int i = 0; i < 200; i++) { s += f(i) / 3; n++; } }
        for (int i = 0; i < 25; i++) {
          hits++; total += g(i, hits);
          hist[i & 15] += 0.25; int k = i; k *= 3; k -= 1; k >>= 1; k++; k += j;
          if ((k & 7) == 0) { s -= 1; n--; }
        }
      } }
      for (int m : marks) total += m;
      double dt = t.seconds(); t.reset();
      lift.setPower(pid.out(100 - lift.getCurrentPosition(), dt));
      telemetry.addData("s", s); telemetry.update();
    }
  }
}`;

/* The OpMode running on a stand-in robot, warmed up; .time(n) is ms for n ticks of it */
function vmRun() {
  const comp = E.jvCompile(SRC, []);
  assert.ok(comp.ok, comp.err);
  const H = E.jvProbeHost(), P = new E.JvProgram(comp, H.host);
  P.init(); P.start();
  const tick = () => { H.clock += 0.02; H.t += 0.02; P.tick(); };
  for (let k = 0; k < 30; k++) tick();
  return { P, time(n) { const t0 = performance.now(); for (let k = 0; k < n; k++) tick(); return performance.now() - t0; } };
}
/* short pieces of each, taken in turn, the quickest of each kept: a burst of another program's
   work spoils a piece or two, not the result */
export function measure(rounds = 16, ticks = 15) {
  const run = vmRun();
  let vm = Infinity, ref = Infinity;
  for (let k = 0; k < rounds; k++) { vm = Math.min(vm, run.time(ticks)); ref = Math.min(ref, reference()); }
  assert.equal(run.P.error, null, JSON.stringify(run.P.error));
  return { vmMs: vm * 150 / ticks, referenceMs: ref, ratio: vm * 150 / ticks / ref };
}

test('jvm speed ratchet: the interpreter on a loop-heavy OpMode is not more than 2x slower than its baseline', () => {
  const now = measure();
  const line = `${now.vmMs.toFixed(1)} ms for 150 ticks, reference ${now.referenceMs.toFixed(2)} ms, ratio ${now.ratio.toFixed(3)}`;
  if (process.env.UPDATE_JVM_SPEED) {
    fs.writeFileSync(FILE, JSON.stringify({
      note: 'Time of 150 ticks of the loop-heavy OpMode in tests/jvm-speed.test.mjs on the Java VM alone (the quickest of 16 pieces of 15 ticks, times 10), divided by the time of the fixed JavaScript reference in tools/bench-cpu.mjs (the quickest of 16). The test fails when it is more than maxSlowdown times this. Re-measure: UPDATE_JVM_SPEED=1 node --test tests/jvm-speed.test.mjs',
      ratio: +now.ratio.toPrecision(4),
      maxSlowdown: MAX_SLOWDOWN,
      measured: { vmMs: +now.vmMs.toFixed(1), referenceMs: +now.referenceMs.toFixed(2), node: process.version },
    }, null, 2) + '\n');
    return;
  }
  const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const limit = base.ratio * (base.maxSlowdown || MAX_SLOWDOWN);
  assert.ok(now.ratio <= limit,
    `the Java VM is ${(now.ratio / base.ratio).toFixed(2)}x its baseline on a loop-heavy OpMode (${line}; the baseline ratio is ${base.ratio}, it fails past ${base.maxSlowdown || MAX_SLOWDOWN}x).\n` +
    'If the slowdown is on purpose, re-measure: UPDATE_JVM_SPEED=1 node --test tests/jvm-speed.test.mjs, and commit tests/jvm-speed-baseline.json saying why.');
});
