// Numbers on the Java VM the way Java has them. Every value is a JS double underneath, so whether
// a value is an int has to come from the code's declared types: an Integer taken out of a
// List<Integer> divides as an int and prints without ".0" (JLS 15.17.2, Integer.toString).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpMode } from '../tools/run-opmode.mjs';

/* the lines `body` prints (say(x) is System.out.println(x)), run after START in a LinearOpMode */
function say(body, extra = '') {
  const src = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*;
import java.util.*;
@TeleOp(name="T") public class T extends LinearOpMode {
${extra}
  @Override public void runOpMode() throws InterruptedException {
    waitForStart();
${body.replace(/\bsay\(/g, 'System.out.println(')}
  }
}`;
  const r = runOpMode({ code: [{ file: 'T.java', src }], opmode: 'T.java', seconds: 0.1 });
  assert.equal(r.compile.error, null);
  return r.error ? ['ERROR ' + r.error.cls + ': ' + r.error.msg] : r.prints;
}

test('boxed ints out of generic collections divide and print as ints', () => {
  assert.deepEqual(say(`List<Integer> l = new ArrayList<>(); l.add(3); say(l.get(0) / 2);
    Map<String, Integer> m = new HashMap<>(); m.put("t", 1601); say(m.get("t") / 2); say("n=" + m.get("t"));
    List<Integer> presets = Arrays.asList(0, 850, 1700); int ratio = 3; say(presets.get(1) / ratio * ratio);
    ArrayDeque<Integer> d = new ArrayDeque<>(); d.add(5); say(d.peek() % 2 + " " + d.peek() / 2);
    say(m.getOrDefault("x", 9) / 2);`), ['1', '800', 'n=1601', '849', '1 2', '4']);
});

test('boxed ints: entries, iterators, var, fields, a team class of its own and Optional', () => {
  assert.deepEqual(say(`for (Map.Entry<String, Integer> e : table.entrySet()) say(e.getKey() + "=" + e.getValue() / 2);
    Iterator<Integer> it = list.iterator(); say(it.next() / 2);
    var v = new ArrayList<Integer>(); v.add(9); say(v.get(0) / 2);
    say(list.remove(0) / 2 + " " + list.size());
    Box<Integer> b = new Box<>(7); say(b.get() / 2);
    Optional<Integer> o = Optional.of(11); say(o.get() / 2);
    List<Double> ds = new ArrayList<>(); ds.add(3.0); say(ds.get(0) / 2); say(ds.get(0));`,
  `  Map<String, Integer> table = new LinkedHashMap<>(Map.of("a", 5));
  List<Integer> list = new ArrayList<>(List.of(7, 8));
  static class Box<T> { T v; Box(T v) { this.v = v; } T get() { return v; } }`),
  ['a=2', '3', '4', '3 1', '3', '5', '1.5', '3.0']);
});
