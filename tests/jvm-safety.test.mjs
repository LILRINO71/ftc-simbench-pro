// A team's code is untrusted as far as the page goes: broken or hostile, it must end with the error
// a student would recognise from the robot (StackOverflowError, OutOfMemoryError, a hang) and
// never freeze or kill the page, nor reach the interpreter's own objects. Each test failed before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpMode } from '../tools/run-opmode.mjs';

const HEAD = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*;
import java.util.*;
`;
const linear = (body, extra = '') => HEAD + `@TeleOp(name="T") public class T extends LinearOpMode {
${extra}
  @Override public void runOpMode() throws InterruptedException {
    waitForStart();
${body.replace(/\bsay\(/g, 'System.out.println(')}
  }
}`;
function run(body, extra = '', seconds = 0.2) {
  const t0 = Date.now();
  const r = runOpMode({ code: [{ file: 'T.java', src: linear(body, extra) }], opmode: 'T.java', seconds });
  r.wall = Date.now() - t0;
  return r;
}

test('memory: a huge array, string or collection is a Java OutOfMemoryError, not a dead page', () => {
  const arr = run('int[] a = new int[2000000000]; say(a.length);');
  assert.equal(arr.error.cls, 'OutOfMemoryError');
  assert.ok(arr.wall < 3000, arr.wall + ' ms');
  const str = run('String s = "x"; for (int i = 0; i < 40; i++) s = s + s; say(s.length());');
  assert.equal(str.error.cls, 'OutOfMemoryError');
  const sb = run('StringBuilder b = new StringBuilder("xxxxxxxxxxxxxxxx"); while (true) b.append(b.toString());');
  assert.equal(sb.error.cls, 'OutOfMemoryError');
  const list = run('List<Integer> l = new ArrayList<>(Collections.nCopies(8388608, 1)); l.add(2); say(l.size());');
  assert.equal(list.error.cls, 'OutOfMemoryError');
  // and the code can catch it, as Java's can
  const caught = run('try { int[][] g = new int[100000][100000]; } catch (OutOfMemoryError e) { say("OOM"); }');
  assert.deepEqual(caught.prints, ['OOM']);
});

test('recursion: too deep is a StackOverflowError the code can catch, at the same depth every time', () => {
  const extra = 'static int d(int n) { return n == 0 ? 0 : 1 + d(n - 1); }';
  assert.deepEqual(run('say(d(150));', extra).prints, ['150']);
  const deep = run('say(d(5000));', extra);
  assert.equal(deep.error.cls, 'StackOverflowError');
  assert.match(deep.error.msg, /more than 200 deep/);
  assert.deepEqual(run('try { say(d(5000)); } catch (StackOverflowError e) { say("caught"); } say("after");', extra).prints, ['caught', 'after']);
  // catch (Exception) is not for an Error
  assert.equal(run('try { say(d(5000)); } catch (Exception e) { say("wrong"); }', extra).error.cls, 'StackOverflowError');
  // a lambda that calls itself has no method frame to count: the page's own stack runs out, and
  // that is a StackOverflowError too, not a JS RangeError
  const lam = run('say(f.apply(100000));', 'java.util.function.Function<Integer, Integer> f = n -> n == 0 ? 0 : 1 + this.f.apply(n - 1);');
  assert.equal(lam.error.cls, 'StackOverflowError');
});

test('time: recursion with no loop and slow loop passes still let the world move', () => {
  // fib(32) is 7 million calls with no loop: it used to run as one pass for 10 s of the page's time
  const fib = run('say(fib(32));', 'static int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }', 0.3);
  assert.equal(fib.error, null);
  assert.equal(fib.ran, 0.3);
  assert.ok(fib.wall < 4000, fib.wall + ' ms');
  // each pass rewrites a 2-million-character string (tens of ms): 20000 passes before the busy-wait
  // guard would hold the page for minutes; the wall-clock watchdog ends the tick after 250 ms
  const slow = run(`String big = "x".repeat(2000000); long n = 0;
    while (true) { String t = big.replace("x", "y"); n++; }`, '', 0.1);
  assert.equal(slow.error, null);
  assert.ok(slow.wall < 15000, slow.wall + ' ms');
  // a regular expression that backtracks exponentially is reported as the hang it would be
  const re = run('say("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!".matches("(a+)+"));');
  assert.equal(re.error.cls, 'Hang');
  assert.ok(re.wall < 3000, re.wall + ' ms');
  assert.deepEqual(run('say("a1,b2,c3,d4,e5,f6,g7,h8,i9,j10".matches("([a-z]\\\\d+,)*[a-z]\\\\d+"));').prints, ['true']);
});

test('regex: a repeat inside a repeat is a reason to measure, not a verdict', () => {
  // harmless on these strings (Java finishes at once): they used to stop the run as a Hang
  const ok = run(`String line = "pose: 12.5 , 30.25 , 90.0 , 1 , 2";
    String[] p = line.split("(\\\\s*,\\\\s*)+"); say(p.length + " " + p[4]);
    say("Red Alliance Left Start Pos".matches("(\\\\w+\\\\s?)+"));
    say("heading 123 deg, x 456 in, y 789 in".replaceAll("([0-9]{1,3})+", "#"));`);
  assert.equal(ok.error, null, JSON.stringify(ok.error));
  assert.deepEqual(ok.prints, ['5 2', 'true', 'heading # deg, x # in, y # in']);
  // a short string runs whatever the pattern
  assert.deepEqual(run('say("aaaaaaaaaaaa!".matches("(a+)+b"));').prints, ['false']);
  // exponential on this string: stopped as the hang it is, long before it would end
  for (const pat of ['(a+)+b', '(a+)+']) {
    const t0 = Date.now();
    const h = run(`say("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!".matches("${pat}"));`);
    const ms = Date.now() - t0;
    assert.equal(h.error && h.error.cls, 'Hang', pat);
    assert.match(h.error.msg, /multiplied by [\d.]+ with each character/);
    assert.ok(ms < 1000, pat + ': ' + ms + ' ms');
  }
});

test('no way into the interpreter: Object.prototype names are not statics, a lambda has no fields', () => {
  const r = run(`Object x = Math.constructor(); say("" + x);
    Math.__defineGetter__("sqrt", null); say(Math.sqrt(16.0));
    say("" + Math.hasOwnProperty("abs"));
    Runnable q = () -> {}; Object v = q.vm; say(v == null);`);
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.deepEqual(r.prints, ['', '4.0', 'false', 'true']);
  assert.ok(r.stubs.some((s) => s.call === 'Math.constructor'), JSON.stringify(r.stubs));
});
