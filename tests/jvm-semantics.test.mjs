// The Java VM against real Java: values a team's OpMode computes and prints
// have to come out the way they would on the robot. Each test here failed
// before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

/* a stand-in robot: devices that count ticks, a clock, telemetry and System.out */
function run(java, { secs = 0.1 } = {}) {
  const H = { t: 0, clock: 0, tel: [], log: [] };
  const devs = new Map();
  const host = {
    dev(name, type, kind) { let s = devs.get(name); if (!s) { s = { name, type, kind, cmd: kind === 'servo' ? null : 0, act: 0, ticks: 0, offset: 0, vel: 0, target: 0, reversed: false, mode: 'run', tpr: 537.7, spec: { rpm: 312 } }; devs.set(name, s); } return s; },
    pad() { return {}; }, now() { return H.clock; }, runtime() { return H.t; }, heading() { return 0; }, omega() { return 0; },
    pose() { return { x: 0, y: 0, h: 0 }; }, vel() { return { x: 0, y: 0 }; }, ray() { return 8.19; }, color() { return [0, 0, 0]; }, volts() { return 12.6; }, touch() { return false; },
    telemetry(l) { H.tel = l; }, rumble() {}, log(t) { H.log.push(String(t)); },
  };
  const comp = E.jvCompile(java, []);
  assert.ok(comp.ok, 'compiles: ' + comp.err);
  const P = new E.JvProgram(comp, host);
  P.init(); P.start();
  for (let k = 0; k < Math.round(secs / 0.02) && !P.done; k++) { H.clock += 0.02; H.t += 0.02; P.tick(); }
  assert.equal(P.error, null, 'runs without an error: ' + JSON.stringify(P.error));
  return H;
}
/* `body` in a LinearOpMode after START; its say(x) lines are System.out.println(x) */
function say(body, extra = '') {
  return run(`package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*;
import com.qualcomm.robotcore.hardware.*;
import java.util.*;
@TeleOp(name="T") public class T extends LinearOpMode {
${extra}
  public void runOpMode() {
    waitForStart();
${body.replace(/\bsay\(/g, 'System.out.println(')}
  }
}`).log;
}

test('== and != are booleans, so printing them and comparing them works', () => {
  assert.deepEqual(say(`int x = 3; boolean b = (x == 5);
    say(b); say("" + (x == 1)); say((x == 3) == false);
    if (b == false) say("took if"); else say("took else");`), ['false', 'false', 'false', 'took if']);
});

test('a method declared int returns an int: it prints without ".0" and divides as an int', () => {
  assert.deepEqual(say(`say("pos=" + lift()); say(ticks() / 2); say(half(7));`,
    `int lift() { return 1200; } int ticks() { return 7; } int half(int t) { return t / 2; }`),
  ['pos=1200', '3', '3']);
});

test('int array elements are ints, and compound assignment to one narrows like Java', () => {
  assert.deepEqual(say(`int[] L = {0, 800, 1600}; say("tgt " + L[2]); say(L[2] / 3);
    int[] a = {5}; a[0] /= 2; say(a[0]); a[0] += 1.7; say(a[0]);`), ['tgt 1600', '533', '2', '3']);
});

test('Math.abs/max/min of ints, the clock and Integer.MAX_VALUE are ints; Math.signum is a double', () => {
  assert.deepEqual(say(`int a = 7, b = 2; say(Math.abs(a - b) / 2); say(Math.max(a, b) / 2);
    say(Integer.MAX_VALUE / 2); say(Math.signum(-0.4) / 2); say("" + Math.signum(-0.4));
    long t = System.currentTimeMillis(); say((System.currentTimeMillis() - t + 3500) / 1000);`),
  ['2', '3', '1073741823', '-0.5', '-1.0', '3']);
});

test('chars print as characters, and StringBuilder.append prints like Java', () => {
  assert.deepEqual(say(`String s = "abc"; char c = 'a'; say("" + c + s.charAt(1)); say(String.valueOf('c'));
    say(new StringBuilder().append(1).append(',').append(2.5).toString());`), ['ab', 'c', '1,2.5']);
});

test('an iterative OpMode that never calls telemetry.update() still shows its telemetry', () => {
  const H = run(`package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*;
@TeleOp(name="I") public class I extends OpMode {
  int n = 0;
  public void init() { telemetry.addData("Status", "Initialized"); }
  public void loop() { telemetry.addData("loops", ++n); }
}`);
  assert.ok(H.tel.length === 1 && /^loops : \d+$/.test(H.tel[0]), JSON.stringify(H.tel));
});
