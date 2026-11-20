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

test('a team generic class: the declared return type decides, double included; a type variable takes the type argument', () => {
  assert.deepEqual(say(`Avg<Integer> avg = new Avg<>(); avg.add(2); avg.add(3);
    say(avg.get() / 2); double half = avg.get() / 2; say(half); say("avg " + avg.get());
    say(avg.peek() * 3 / 2); say(avg.next() / 2); say(avg.first() / 2); say(avg.count() / 2); say("n " + avg.count());
    say(avg.poll() / 2);
    Avg<Double> d = new Avg<>(); d.add(5.0); say(d.first() / 2);
    Pair<Integer, Double> p = new Pair<>(7, 7.0); say(p.left() / 2 + " " + p.right() / 2 + " " + p.get() / 2);`,
  `  static class Avg<T extends Number> {
    final List<T> xs = new ArrayList<>();
    void add(T x) { xs.add(x); }
    double get() { double s = 0; for (T x : xs) s += x.doubleValue(); return s / xs.size(); }
    double peek() { return 2.5; }
    double next() { return 3; }
    T first() { return xs.get(0); }
    int count() { return xs.size(); }
    Double poll() { return 4.0; }
  }
  static class Pair<A, B> { A a; B b; Pair(A a, B b) { this.a = a; this.b = b; } A left() { return a; } B right() { return b; } double get() { return 9; } }`),
  ['1.25', '1.25', 'avg 2.5', '3.75', '1.5', '1', '1', 'n 2', '2.0', '2.5', '3 3.5 4.5']);
});

test('what ++ and op= narrow to is worked out per program: one parsed helper, an int in one program and a double in another', () => {
  // Bump.java is the same text in both programs, so the parse cache hands both the same nodes;
  // o.count is an int in one program's Other and a double in the other's
  const bump = `package org.firstinspires.ftc.teamcode;
public class Bump { public static double go(Other o) { o.count++; o.count += 0.5; o.count -= 1; return o.count - 2147483000; } }`;
  const other = (t, v) => `package org.firstinspires.ftc.teamcode;\npublic class Other { public ${t} count = ${v}; }`;
  const main = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*;
@TeleOp(name="T") public class T extends LinearOpMode { @Override public void runOpMode() { waitForStart();
  Other o = new Other(); System.out.println(Bump.go(o) + " " + Bump.go(o)); } }`;
  const run = (t, v) => {
    const r = runOpMode({ code: [{ file: 'T.java', src: main }, { file: 'Bump.java', src: bump }, { file: 'Other.java', src: other(t, v) }], opmode: 'T.java', seconds: 0.1 });
    assert.equal(r.error, null, JSON.stringify(r.error));
    return r.prints;
  };
  // int: MAX_VALUE + 1 wraps to MIN_VALUE, += 0.5 is (int)(x + 0.5), and the int subtraction
  // wraps back (Java: 648.0, then 649.0); double: nothing wraps or truncates (647.5, 648.0)
  for (let k = 0; k < 2; k++) {
    assert.deepEqual(run('int', '2147483647'), ['648.0 649.0']);
    assert.deepEqual(run('double', '2147483647'), ['647.5 648.0']);
  }
});

test('int arithmetic wraps at 32 bits like Java (JLS 15.17, 15.18, 15.15)', () => {
  assert.deepEqual(say(`int a = Integer.MAX_VALUE; a = a + 1; say(a);
    int b = 100000; say(b * b);
    int c = Integer.MAX_VALUE; c++; say(c); c--; say(c);
    int m = Integer.MIN_VALUE; say(m / -1); say(-m); say(Math.abs(Integer.MIN_VALUE));
    int h = 7; for (int i = 0; i < 20; i++) h = 31 * h + 12345; say(h);
    int x = 5; x += 2.7; say(x); x += 3e10; say(x);
    byte by = 127; by++; say(by); short sh = 32767; sh += 1; say(sh);
    say(0xFFFFFFFF); say(1 << 31); say(-1 >>> 28); say(-1 >>> 0);`),
  ['-2147483648', '1410065408', '-2147483648', '2147483647', '-2147483648', '-2147483648', '-2147483648',
    String(Array.from({ length: 20 }).reduce((h) => (Math.imul(31, h) + 12345) | 0, 7)),
    '7', '2147483647', '-128', '-32768', '-1', '-2147483648', '15', '-1']);
});

test('long arithmetic: 64-bit shifts and masks, and wrapping at 2^63', () => {
  assert.deepEqual(say(`long x = 1L << 40; say(x); say(x >> 3); say((1L << 62) * 2);
    long a = Long.MAX_VALUE; a = a + 1; say(a); say(Long.MIN_VALUE);
    long mask = 0xFFFFFFFFFL; say(mask & (1L << 35)); say(mask | (1L << 40));
    long t = System.nanoTime(); say(t >= 0);
    int lo = (int) 4294967297L; say(lo); say((int) 3.9e10); say((long) 1e19);
    long ms = System.currentTimeMillis(); say(ms / 1000 > 1000000000);`),
  ['1099511627776', '137438953472', '-9223372036854775808', '-9223372036854775808', '-9223372036854775808',
    '34359738368', '1168231104511', 'true', '1', '2147483647', '9223372036854775807', 'true']);
});

test('Integer.parseInt is strict: a stray character or an out-of-range number throws', () => {
  assert.deepEqual(say(`String[] in = {"12a", " 12", "", "2147483648", "+7", "-0", "ff"};
    for (String s : in) { try { say(Integer.parseInt(s)); } catch (NumberFormatException e) { say("NFE " + e.getMessage()); } }
    say(Integer.parseInt("ff", 16)); say(Long.parseLong("9223372036854775807")); say(Integer.valueOf("42") / 5);`),
  ['NFE For input string: "12a"', 'NFE For input string: " 12"', 'NFE For input string: ""', 'NFE For input string: "2147483648"',
    '7', '0', 'NFE For input string: "ff"', '255', '9223372036854775807', '8']);
});
