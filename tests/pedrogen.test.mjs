// The path editor's Pedro side (src/pedrogen.js): a drawn path becomes the Pedro Pathing
// 2.x OpMode a team would write, it compiles and runs on the Java VM to the drawn end, and
// its coordinates are the bench's field moved by 72 in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const IN = 0.0254, DT = 0.02;

// a small mecanum robot: the four commanded powers move a pose (metres), with motor lag
function run(main, libs, secs, opts = {}) {
  const H = { t: 0, clock: 0, x: (opts.x || 0) * IN, y: (opts.y || 0) * IN, h: opts.h || 0, vx: 0, vy: 0, w: 0, pads: { 1: {}, 2: {} } };
  const devs = new Map();
  const host = {
    dev(name, type, kind) { let s = devs.get(name); if (!s) { s = { name, type, kind, cmd: kind === 'servo' ? null : 0, act: 0, ticks: 0, offset: 0, vel: 0, target: 0, reversed: false, mode: 'run', tpr: 537.7, spec: { rpm: 312 } }; devs.set(name, s); } return s; },
    pad(i) { return H.pads[i] || {}; }, now() { return H.clock; }, runtime() { return H.t; }, heading() { return H.h; }, omega() { return H.w; },
    pose() { return { x: H.x, y: H.y, h: H.h }; },
    vel() { const c = Math.cos(H.h), s = Math.sin(H.h); return { x: H.vx * c + H.vy * s, y: -H.vx * s + H.vy * c }; },
    ray() { return 8.19; }, color: opts.color || (() => [120, 120, 120]), colorDist: opts.colorDist, volts() { return 12.6; }, touch() { return false; },
    telemetry(l) { H.tel = l; }, rumble() {},
  };
  const comp = E.jvCompile(main, libs || []);
  assert.ok(comp.ok, comp.err);
  const P = new E.JvProgram(comp, host);
  const cmd = (n) => { const s = devs.get(n); return s && s.cmd != null ? s.cmd : 0; };
  P.init();
  P.start();
  const track = [];
  for (let k = 0; k < Math.round(secs / DT); k++) {
    H.clock += DT; H.t += DT;
    P.tick();
    for (const [, d] of devs) if (d.kind === 'motor') d.act = d.cmd || 0;
    const lf = cmd('leftFront'), lr = cmd('leftRear'), rf = cmd('rightFront'), rr = cmd('rightRear');
    const f = (lf + lr + rf + rr) / 4, s = (-lf + lr + rf - rr) / 4, w = (-lf - lr + rf + rr) / 4;
    const c = Math.cos(H.h), sn = Math.sin(H.h), a = Math.min(1, DT / 0.12);
    H.vx += ((f * c - s * sn) * 1.5 - H.vx) * a; H.vy += ((f * sn + s * c) * 1.5 - H.vy) * a; H.w += (w * 5 - H.w) * a;
    H.x += H.vx * DT; H.y += H.vy * DT; H.h += H.w * DT;
    track.push([H.x / IN, H.y / IN, H.h]);
  }
  return { P, H, devs, track, tel: (H.tel || []).join('\n') };
}


const libs = [{ file: 'Constants.java', src: E.PEDRO_CONSTANTS_JAVA }];

test('pedro path: Pedro inches and degrees are the bench field moved by 72 in', () => {
  const f = E.pedroToField({ x: 72, y: 72, h: 90 });
  assert.ok(Math.abs(f.x) < 1e-12 && Math.abs(f.y) < 1e-12 && Math.abs(f.h - Math.PI / 2) < 1e-12);
  const back = E.fieldToPedro(E.pedroToField({ x: 10, y: 130, h: -45 }));
  assert.ok(Math.abs(back.x - 10) < 1e-9 && Math.abs(back.y - 130) < 1e-9 && Math.abs(back.h + 45) < 1e-9);
  // the red drivers stand at the bench's -x wall: Pedro x = 0 there
  assert.ok(Math.abs(E.pedroToField({ x: 0, y: 72 }).x + 72 * IN) < 1e-12);
});

test('pedro path: a line, a curve and a reversed leg become Java that runs on the VM and ends where it was drawn', () => {
  const P = { name: 'Two cycle test', start: { x: 24, y: 72, h: 0 }, legs: [
    { to: { x: 60, y: 72, h: 0 }, ctrl: [], heading: 'constant', reversed: false, wait: 0.5 },
    { to: { x: 90, y: 100, h: 90 }, ctrl: [[90, 72]], heading: 'linear', reversed: false, wait: 0 },
    { to: { x: 70, y: 100, h: 90 }, ctrl: [], heading: 'constant', reversed: true, wait: 0 } ] };
  const J = E.pedroJava(P);
  assert.equal(J.file, 'TwoCycleTest.java');
  assert.match(J.src, /new BezierCurve\(pose1, new Pose\(90\.0, 72\.0\), pose2\)/);
  assert.match(J.src, /setReversed\(true\)/);
  assert.match(J.src, /timer\.seconds\(\) > 0\.5/);
  const r = run(J.src, libs, 14, { x: 24 - 72, y: 72 - 72, h: 0 });
  assert.equal(r.P.error, null, r.P.error && (r.P.error.msg + ' line ' + r.P.error.line));
  const tel = Object.fromEntries(r.tel.split(/\n/).map((l) => l.split(' : ')));
  assert.equal(+tel.state, -1, 'every leg done: ' + r.tel);
  assert.ok(Math.hypot(+tel.x - 70, +tel.y - 100) < 2.5, `the follower ends at (70, 100): ${tel.x}, ${tel.y}`);
  // and the robot itself is there on the bench (its start was Pedro (24, 72) = field (-48, 0) in)
  const [sx, sy] = r.track[r.track.length - 1];
  assert.ok(Math.hypot(sx - (70 - 72), sy - (100 - 72)) < 2.5, `the robot ends at field (-2, 28): ${sx}, ${sy}`);
});

test('pedro path: the drawing samples the curves through their ends; length and checks', () => {
  const P = E.pedroNew({ x: 20, y: 20, h: 0 });
  assert.deepEqual(P.legs[0].to, { x: 44, y: 20, h: 0 }, 'a tile ahead');
  P.legs.push({ to: { x: 44, y: 56, h: 90 }, ctrl: [[70, 20], [70, 56]], heading: 'tangent', reversed: false, wait: 0 });
  const pl = E.pedroPolyline(P, 10);
  assert.deepEqual(pl[0], [20, 20]); assert.deepEqual(pl.at(-1), [44, 56]);
  assert.equal(pl.length, 21, 'shared ends counted once');
  assert.ok(E.pedroLength(P) > 24 + 36, 'the curve bows out past the straight line');
  assert.deepEqual(E.pedroCheck(P), []);
  P.legs.push({ to: { x: 200, y: 56, h: 0 }, ctrl: [], heading: 'linear', reversed: false, wait: 12 });
  const c = E.pedroCheck(P);
  assert.ok(c.some((s) => /Leg 3 ends off the field/.test(s)) && c.some((s) => /waits 12/.test(s)), c.join(' | '));
});

test('pedro path: a pasted path is held to the field, known modes and 40 legs; names become class names', () => {
  const P = E.pedroClean({ name: '<script>x', start: { x: 'a', y: 1e9 }, legs: [{ to: { x: 10, y: 10 }, heading: 'warp', ctrl: [[1, 2], [3, 4], [5, 6]] }] });
  assert.equal(P.name, 'scriptx');
  assert.deepEqual(P.start, { x: 72, y: 180, h: 0 });
  assert.equal(P.legs[0].heading, 'linear'); assert.equal(P.legs[0].ctrl.length, 2);
  assert.throws(() => E.pedroClean({ legs: [] }));
  assert.equal(E.pedroClass('blue far 2 cycle'), 'BlueFar2Cycle');
  assert.equal(E.pedroClass('3 ball'), 'Path3Ball');
  assert.equal(E.pedroClass(''), 'SimBenchPath');
});

test('pedro path: a leg that drives the robot into a HIVE is named before it runs', async () => {
  const { loadWithField } = await import('./load.mjs');
  const F = loadWithField();
  const obs = F.Field.obstacles(0.45);
  // from the red wall straight down the middle: through the red HIVE's base
  const into = { start: { x: 12, y: 72, h: 0 }, legs: [{ to: { x: 70, y: 72, h: 0 }, ctrl: [], heading: 'linear', reversed: false, wait: 0 }] };
  const hits = F.pedroHits(into, obs, 0.2);
  assert.equal(hits.length, 1); assert.match(hits[0].what, /HIVE/);
  assert.ok(F.pedroCheck(into, obs, 0.2).some((s) => /Leg 1 runs into the .*HIVE/.test(s)));
  // a tile along the wall: clear
  const clear = { start: { x: 12, y: 72, h: 0 }, legs: [{ to: { x: 12, y: 100, h: 90 }, ctrl: [], heading: 'linear', reversed: false, wait: 0 }] };
  assert.deepEqual(F.pedroHits(clear, obs, 0.2), []);
});

test('pedro path: a share link carries the path and gives back the same path; a hostile link gives a clean one or nothing', () => {
  const P = { format: E.PEDRO_FORMAT, v: 1, name: 'Blue far', start: { x: 12, y: 72, h: 0 }, legs: [
    { to: { x: 36, y: 72, h: 0 }, ctrl: [], heading: 'constant', reversed: false, wait: 0.5 },
    { to: { x: 30, y: 110, h: 90 }, ctrl: [[38, 95]], heading: 'linear', reversed: true, wait: 0 } ] };
  const h = E.pedroToHash(P);
  assert.match(h, /^[A-Za-z0-9_-]+$/, 'only URL-safe characters');
  assert.ok(h.length < 300, h.length + ' characters');
  assert.deepEqual(E.pedroFromHash(h), E.pedroClean(P));
  // made up by hand: far off the field, a script for a name, fifty legs
  const evil = Buffer.from(JSON.stringify({ n: '<img onerror=x>', s: [1e9, -1e9, 5], l: Array.from({ length: 50 }, () => [999, 2, 0, 7, 1, 99, [[1, 2]]]) })).toString('base64url');
  const Q = E.pedroFromHash(evil);
  assert.equal(Q.name, 'img onerrorx'); assert.equal(Q.start.x, 180); assert.equal(Q.legs.length, 40);
  assert.equal(Q.legs[0].heading, 'linear'); assert.equal(Q.legs[0].wait, 30);
  assert.throws(() => E.pedroFromHash('not-a-path'));
  assert.throws(() => E.pedroFromHash('a'.repeat(30000)));
});
