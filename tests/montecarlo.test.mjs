// src/montecarlo.js: the same autonomous, many times, with a little variation each. The things
// that matter here: a run is a function of its seed alone (so a failure can be replayed), every
// factor stays inside its stated range, the field is only ever jittered AROUND where it was
// measured, a batch is judged the way the panel says, and the Web Worker that runs a batch gives
// exactly the numbers a plain call does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { loadEngine, loadWithField, engineBundle } from './load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITD = path.join(ROOT, 'assets', 'robots', 'into-the-deep');
const IN = 0.0254;
const E = loadWithField();

/* The default robot and its Road Runner auto, read once. */
const itd = (() => {
  let got = null;
  return () => {
    if (got) return got;
    const cad = E.parseSTEP(zlib.gunzipSync(fs.readFileSync(path.join(ITD, 'robot.step.gz'))).toString('utf8'));
    const R = E.applyJointSpec(cad, JSON.parse(fs.readFileSync(path.join(ITD, 'joints.json'), 'utf8')));
    const libs = ['MecanumDrive.java', 'Arm.java', 'Arm_PID_Class.java', 'Slides_PID_Class.java'].map((f) => ({ file: f, src: fs.readFileSync(path.join(ITD, f), 'utf8') }));
    const src = fs.readFileSync(path.join(ITD, 'TheHolyGrail.java'), 'utf8');
    const code = E.parseJava(src, { libs });
    const map = E.autoMap(code.devices, cad.mechs);
    for (const d of code.devices) { const j = R.devices[d.name] || R.devices[d.cfg]; if (j) map[d.name] = j; }
    return (got = { cad, R, libs, src, code, map });
  };
})();
// the trimmed copy a worker is handed, made once: a fresh copy costs a few seconds of caches again
let PLAIN = null;
const plainCad = () => PLAIN || (PLAIN = E.mcCadForWorker(itd().cad));
const jobFor = (extra = {}) => { const o = itd(); return E.mcPrepare(Object.assign({ code: o.code, cad: plainCad(), map: o.map, opts: { front: o.R.front } }, extra)); };

test('montecarlo: a run is its seed: the same seed gives the same variation, any other gives another', () => {
  const a = E.mcVariation(12345, E.MC_RANGES, 20), b = E.mcVariation(12345, E.MC_RANGES, 20), c = E.mcVariation(12346, E.MC_RANGES, 20);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  // batch seeds: stable, all different, and a different master seed is a different batch
  const s1 = Array.from({ length: 50 }, (_, i) => E.mcSeedFor(7, i)), s2 = Array.from({ length: 50 }, (_, i) => E.mcSeedFor(7, i)), s3 = Array.from({ length: 50 }, (_, i) => E.mcSeedFor(8, i));
  assert.deepEqual(s1, s2);
  assert.equal(new Set(s1).size, 50);
  assert.equal(s1.filter((v, i) => v === s3[i]).length, 0);
});

test('montecarlo: every factor stays inside its range, and the ranges are the specified ones', () => {
  const R = E.MC_RANGES;
  assert.deepEqual([R.volts.lo, R.volts.hi], [12.0, 13.5]);
  assert.deepEqual([R.latencyMs.lo, R.latencyMs.hi], [0, 40]);
  assert.deepEqual([R.start.lo, R.start.hi], [-1, 1]);
  assert.deepEqual([R.startH.lo, R.startH.hi], [-2, 2]);
  // the ones that are guesses say so
  for (const k of ['friction', 'mass', 'element', 'piece']) assert.ok(R[k].assumed, k + ' is labelled an assumption');
  const seen = { volts: [99, -99], latencyMs: [99, -99], dx: [99, -99], friction: [99, -99] };
  for (let i = 0; i < 2000; i++) {
    const v = E.mcVariation(E.mcSeedFor(3, i), R, 30);
    assert.ok(v.friction >= R.friction.lo && v.friction <= R.friction.hi);
    assert.ok(v.mass >= R.mass.lo && v.mass <= R.mass.hi);
    assert.ok(v.volts >= 12.0 && v.volts <= 13.5);
    assert.ok(v.latencyMs >= 0 && v.latencyMs <= 40);
    assert.ok(Math.abs(v.dx) <= 1 && Math.abs(v.dy) <= 1 && Math.abs(v.dh) <= 2);
    assert.ok(v.piece >= R.piece.lo && v.piece <= R.piece.hi);
    assert.equal(v.offsets.length, 30);
    for (const [x, y] of v.offsets) assert.ok(Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5);
    for (const k of Object.keys(v.z)) assert.ok(Math.abs(v.z[k]) <= 1 + 1e-9, k + ' ' + v.z[k]);
    for (const [k, x] of [['volts', v.volts], ['latencyMs', v.latencyMs], ['dx', v.dx], ['friction', v.friction]]) { seen[k][0] = Math.min(seen[k][0], x); seen[k][1] = Math.max(seen[k][1], x); }
  }
  // and the whole range is used, not a corner of it
  assert.ok(seen.volts[0] < 12.05 && seen.volts[1] > 13.45 && seen.latencyMs[1] > 39 && seen.dx[0] < -0.95 && seen.friction[1] > 0.09);
});

test('montecarlo: switching a factor off holds it at nominal and never changes the others', () => {
  const all = E.mcVariation(99, E.MC_RANGES, 5), no = E.mcVariation(99, E.MC_RANGES, 5, { friction: false, element: false, volts: false });
  assert.equal(no.friction, 0); assert.equal(no.volts, null);
  assert.ok(no.offsets.every(([x, y]) => x === 0 && y === 0));
  assert.equal(no.z.friction, 0); assert.equal(no.z.element, 0);
  for (const k of ['mass', 'latencyMs', 'dx', 'dy', 'dh', 'piece']) assert.equal(no[k], all[k], k);
  // a switched-off latency does not read as an extreme
  const off = E.mcVariation(5, E.MC_RANGES, 0, { latencyMs: false });
  assert.equal(off.z.latencyMs, 0);
});

test('montecarlo: the worst-factor report names what was far out, and only that', () => {
  const v = { seed: 1, friction: -0.095, mass: 0.001, volts: 12.05, latencyMs: 20, dx: 0.1, dy: 0, dh: 0, piece: 0, offsets: [[0.4, 0.1]],
    z: { friction: -0.95, mass: 0.02, volts: -0.93, latencyMs: 0, start: 0.1, startH: 0, piece: 0, element: 0.8 } };
  const x = E.mcExtremes(v, E.MC_RANGES, 3);
  assert.deepEqual(x.map((e) => e.key), ['friction', 'volts']);
  assert.match(x[0].text, /floor friction -9\.5 %/); assert.match(x[1].text, /battery 12\.1 V/);
  assert.deepEqual(E.mcExtremes(Object.assign({}, v, { z: Object.assign({}, v.z, { friction: 0, volts: 0 }) }), E.MC_RANGES), []);
});

test('montecarlo: the default robot\'s Road Runner auto, run from seeds, comes out the same every time', () => {
  const job = jobFor();
  const a = E.mcRun(job, 2, 1);
  const b = E.mcRun(jobFor(), 2, 1);
  assert.equal(a.results.length, 2);
  assert.deepEqual(a.results.map((r) => r.seed), [E.mcSeedFor(1, 0), E.mcSeedFor(1, 1)]);
  // the path's own end is the target, from the Road Runner plan
  assert.equal(a.target.from, 'path end');
  assert.ok(Math.abs(a.target.x + 18.95) < 0.01 && Math.abs(a.target.y - 35) < 0.01, JSON.stringify(a.target));
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(a.results[i].pose, b.results[i].pose, 'run ' + i);
    assert.deepEqual(a.results[i].err, b.results[i].err);
    assert.ok(a.results[i].err.pos < 5, 'the auto ends near its path end: ' + a.results[i].err.pos + ' in');
  }
  // one run alone, by its seed, is the same run (that is how a failure is replayed), and a code that
  // has already been run is as good as one read afresh
  const alone = E.mcJudge(E.mcRunOne(job, a.results[1].seed), job);
  assert.deepEqual(alone.pose, a.results[1].pose);
  const fresh = jobFor({ code: E.parseJava(itd().src, { libs: itd().libs }) });
  fresh.target = job.target; fresh.nominal = job.nominal;
  assert.deepEqual(E.mcRunOne(fresh, a.results[1].seed).pose, a.results[1].pose);
  // the runs differ from each other: variation is really applied
  assert.notDeepEqual(a.results[0].pose, a.results[1].pose);
  // different seeds, different batch
  assert.notDeepEqual(E.mcRun(jobFor(), 1, 2).results[0].pose, a.results[0].pose);
});

test('montecarlo: what a run changes is what its variation says, and a trimmed CAD gives the same runs as the full one', () => {
  const o = itd(), job = jobFor();
  const seed = E.mcSeedFor(4, 2), v = E.mcVariation(seed, E.MC_RANGES, job.nObs);
  const r = E.mcRunOne(job, seed);
  const kg0 = (() => { E.Sim.load(o.code, o.cad, o.map, { front: o.R.front }); return E.Sim.rig.props.kg; })();
  E.mcRunOne(job, seed);
  // after the run the sim still holds that run's robot
  assert.ok(Math.abs(E.Sim.rig.props.kg / kg0 - (1 + v.mass)) < 1e-6, 'mass ' + E.Sim.rig.props.kg / kg0 + ' vs ' + (1 + v.mass));
  assert.ok(Math.abs(E.Sim.rig.mu - E.Dyn.defaults.mu * (1 + v.friction)) < 1e-9, 'friction');
  assert.ok(Math.abs(E.Sim.rig.vScale - v.volts / 12.6) < 1e-9, 'battery');
  assert.equal(E.Sim.opts.latencyMs, v.latencyMs);
  // the full CAD, with everything the view hangs on it, gives the same run
  const full = E.mcPrepare({ code: o.code, cad: o.cad, map: o.map, opts: { front: o.R.front } });
  assert.deepEqual(E.mcRunOne(full, seed).pose, r.pose);
  // the copy is plain data: nothing that cannot be handed to a worker
  const plain = E.mcCadForWorker(Object.assign({}, o.cad, { view: { fn() {}, three: new (class Euler {})() }, points: [1, 2, 3] }));
  assert.equal(plain.points, undefined); assert.equal(plain.view.fn, undefined); assert.equal(plain.view.three, undefined);
  assert.doesNotThrow(() => structuredClone(plain));
});

test('montecarlo: the field is jittered around where it was measured, never moved, and game pieces return to their weight', () => {
  const o = itd();
  const nominal = JSON.stringify(E.Field.obstacles(0.46)), grams = JSON.stringify(E.ELEMENT_G || null);
  assert.ok(E.Field.ok && E.Field.obstacles(0.46).length > 5, 'the BIOBUZZ field is on');
  const job = jobFor();
  assert.equal(job.nObs, E.Field.obstacles(0.46).length);
  const seed = E.mcSeedFor(9, 1), v = E.mcVariation(seed, E.MC_RANGES, job.nObs);
  E.mcRunOne(job, seed);
  const nom = E.Field.obstacles(E.Sim.footprint.h), got = E.Sim.obstacles;
  assert.equal(got.length, nom.length);
  let moved = 0;
  got.forEach((g, i) => {
    const dx = g.a[0] - nom[i].a[0], dy = g.a[1] - nom[i].a[1];
    assert.ok(Math.abs(dx) <= 0.5 * IN + 1e-9 && Math.abs(dy) <= 0.5 * IN + 1e-9, `element ${i} off by ${dx / IN}, ${dy / IN} in`);
    assert.ok(Math.abs(dx - v.offsets[i][0] * IN) < 1e-9, 'offsets are the seed\'s');
    // the capsule moves as one piece
    assert.ok(Math.abs((g.b[0] - nom[i].b[0]) - dx) < 1e-9 && g.r === nom[i].r);
    if (dx || dy) moved++;
  });
  assert.ok(moved > 0, 'something did move');
  // the nominal field is exactly as it was: the jitter lives in the run, not in the field
  assert.equal(JSON.stringify(E.Field.obstacles(0.46)), nominal);
  assert.equal(JSON.stringify(E.ELEMENT_G || null), grams, 'piece weights are put back');
  // switched off, the field is as measured
  const still = jobFor({ vary: { element: false } });
  E.mcRunOne(still, seed);
  assert.deepEqual(E.Sim.obstacles.map((g) => g.a), E.Field.obstacles(E.Sim.footprint.h).map((g) => g.a));
  void o;
});

test('montecarlo: a batch is judged by the thresholds, with a histogram and the worst runs', () => {
  // the first 8 s of the auto: what is judged is how the runs spread, not the whole path
  const short = { duration: 8 };
  const job = jobFor(Object.assign({ success: { mode: 'pose', posIn: 2, degDeg: 5, target: 'nominal' } }, short));
  const mc = E.mcRun(job, 5, 5);
  const S = E.mcSummary(mc.results, job);
  assert.equal(S.n, 5); assert.equal(S.passed + S.failed, 5);
  assert.equal(S.bins.reduce((a, b) => a + b.n, 0), 5, 'every run is in a bin');
  assert.ok(S.worst.length >= 1 && S.worst.length <= 3);
  assert.ok(S.worst.every((w) => Number.isFinite(w.seed) && Array.isArray(w.extremes)));
  assert.equal(S.rate, S.passed / 5);
  // a threshold nothing can meet fails every run; a generous one passes them
  const none = jobFor(Object.assign({ success: { mode: 'pose', posIn: 0.01, degDeg: 0.01, target: 'nominal' } }, short));
  const N = E.mcSummary(E.mcRun(none, 4, 5).results, none);
  assert.equal(N.passed, 0); assert.equal(N.worst.length, 3);
  assert.ok(N.worst.every((w) => !w.ok && /in,/.test(w.why)));
  const easy = jobFor(Object.assign({ success: { mode: 'pose', posIn: 30, degDeg: 90, target: 'nominal' } }, short));
  assert.equal(E.mcSummary(E.mcRun(easy, 3, 5).results, easy).passed, 3);
  // a pose by hand
  const hand = jobFor(Object.assign({ success: { mode: 'pose', posIn: 2, degDeg: 5, target: { x: 0, y: 0, h: 0 } } }, short));
  assert.equal(E.mcRun(hand, 1, 1).target.from, 'given');
  assert.equal(E.mcRun(hand, 1, 1).results[0].ok, false, 'nowhere near the origin');
  // the no-variation run is reported, and the target for a code with no path is where it ends
  assert.ok(mc.nominal && mc.nominal.pose && mc.nominal.err.pos < 1e-9, 'judged against itself, the nominal run is dead on');
  const noPath = jobFor(Object.assign({ success: { mode: 'pose', posIn: 2, degDeg: 5, target: 'nominal' } }, short));
  const NP = E.mcRun(noPath, 1, 1);
  assert.equal(NP.target.from, 'a run with no variation');
  assert.deepEqual([NP.target.x, NP.target.y], [NP.nominal.pose.x, NP.nominal.pose.y]);
});

test('montecarlo: success by points counts the alliance\'s AUTO points; the cap on runs is 50', () => {
  const job = jobFor({ success: { mode: 'points', points: 3 }, duration: 10 });
  const mc = E.mcRun(job, 2, 1);
  for (const r of mc.results) { assert.ok(Number.isInteger(r.points) && r.points >= 0, 'points ' + r.points); assert.equal(r.ok, r.points >= 3); }
  const S = E.mcSummary(mc.results, job);
  assert.equal(S.unit, 'points'); assert.equal(S.bins.reduce((a, b) => a + b.n, 0), 2);
  assert.equal(E.MC_MAX_RUNS, 50);
  assert.equal(E.mcRun(jobFor({ duration: 1 }), 999, 1, { seeds: [11, 12] }).results.length, 2, 'explicit seeds replace the count');
  assert.equal(E.mcRun(jobFor({ duration: 1 }), 999, 1).results.length, 50);
});

test('montecarlo: Cancel stops a batch between runs', () => {
  let seen = 0;
  const r = E.mcRun(jobFor({ duration: 1 }), 20, 1, { onRun: () => { seen++; }, isCancelled: () => seen >= 3 });
  assert.equal(r.results.length, 3);
});

/* ---- the Web Worker ----
   The page runs a batch in a worker built from mcWorkerBody: it loads the engine file and the
   shot-sim file the build writes, and answers {op:"mc"} messages. Here the same body runs in a
   worker thread, with importScripts reading those two files the way the build makes them. */
function runInWorker(spec, n, seed, seeds) {
  return new Promise((resolve, reject) => {
    const engineText = engineBundle(), shotDir = path.join(ROOT, 'vendor', 'biobuzz-shot-sim');
    const data = (f) => JSON.parse(fs.readFileSync(path.join(shotDir, 'data', f), 'utf8'));
    const shotText = `self.SHOT_DATA = ${JSON.stringify({ field: data('field.json'), motors: data('motors.json'), shooter: data('shooter.json') })};\n` + fs.readFileSync(path.join(shotDir, 'engine.js'), 'utf8');
    const body = E.mcWorkerBody('engine.js', 'shotsim.js');
    const boot = `
      const { parentPort, workerData } = require('node:worker_threads');
      const vm = require('node:vm');
      globalThis.self = globalThis;
      delete globalThis.module; delete globalThis.exports;       // a browser worker has no CommonJS
      globalThis.postMessage = (m) => parentPort.postMessage(m);
      globalThis.importScripts = (...urls) => { for (const u of urls) vm.runInThisContext(workerData.files[u], { filename: u }); };
      vm.runInThisContext(workerData.body, { filename: 'worker.js' });
      parentPort.on('message', (d) => globalThis.onmessage({ data: d }));`;
    const w = new Worker(boot, { eval: true, workerData: { files: { 'engine.js': engineText, 'shotsim.js': shotText }, body } });
    const out = { setup: null, runs: [], done: false };
    w.on('message', (m) => {
      if (m.ready) w.postMessage({ id: 1, op: 'mc', spec, n, seed, seeds: seeds || null });
      else if (m.error) { w.terminate(); reject(new Error(m.error)); }
      else if (m.setup) out.setup = m;
      else if (m.run != null) out.runs.push(m.res);
      else if (m.done) { out.done = true; w.terminate(); resolve(out); }
    });
    w.on('error', reject);
  });
}

test('montecarlo: the worker gives exactly the numbers a plain call does, and a replay by seed matches', async () => {
  const o = itd();
  const spec = { java: { src: o.src, libs: o.libs }, cad: plainCad(), map: E.mcPlain(o.map), opts: { front: o.R.front }, success: { mode: 'pose', posIn: 2, degDeg: 5 }, duration: 30, alliance: 'red' };
  const w = await runInWorker(spec, 3, 1);
  assert.ok(w.done && w.runs.length === 3);
  assert.equal(w.setup.field, true, 'the worker has the BIOBUZZ field: ' + w.setup.fieldError);
  assert.equal(w.setup.elements, E.Field.obstacles(0.46).length);
  const here = E.mcRun(jobFor(), 3, 1);
  assert.deepEqual(w.setup.target, here.target);
  for (let i = 0; i < 3; i++) {
    assert.equal(w.runs[i].seed, here.results[i].seed);
    assert.deepEqual(w.runs[i].pose, here.results[i].pose, 'run ' + i);
    assert.equal(w.runs[i].ok, here.results[i].ok);
    assert.deepEqual(w.runs[i].extremes.map((x) => x.text), here.results[i].extremes.map((x) => x.text));
  }
  // one of them again, by its seed, in this thread: the same run
  const again = E.mcRun(jobFor(), 1, 0, { seeds: [w.runs[2].seed] });
  assert.deepEqual(again.results[0].pose, w.runs[2].pose);
});

test('montecarlo: a batch does not freeze the page: the worker answers run by run, and the build ships what it loads', () => {
  const body = E.mcWorkerBody('engine-x.js', 'shotsim-y.js');
  assert.doesNotThrow(() => new vm.Script(body), 'the worker code is valid');
  assert.match(body, /importScripts\("engine-x\.js", "shotsim-y\.js"\)/);
  assert.match(body, /postMessage\(\{id:d\.id, run:i/, 'a message per run, so the page can draw progress and cancel between them');
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build.mjs'), 'utf8');
  assert.match(build, /SIMBENCH_SHOT_URL/); assert.match(build, /shotsim-/);
  // the engine file the worker loads has the Monte Carlo runner in it
  const engineOnly = engineBundle();
  assert.ok(engineOnly.includes('function mcWorkerBody') && engineOnly.includes('function calFit'));
  assert.ok(loadEngine);
});
