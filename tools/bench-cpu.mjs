// CPU benchmark of the simulator: how many 50 Hz ticks per second one core runs, with the team's
// real TeleOp on the default robot (GearGurus 7832's Into The Deep) read by the Java VM, driving on
// the field with the AI robots playing. Each tick is the OpMode's loop in the interpreter, the
// mechanism joints, the drive dynamics, the collisions and the match.
//
//   node tools/bench-cpu.mjs                     print ticks per second and the ratio the test uses
//   node tools/bench-cpu.mjs --ticks 6000        a longer run
//   node --cpu-prof tools/bench-cpu.mjs          also write a V8 profile (open it in Chrome DevTools)
//
// tests/cpu-bench.test.mjs holds `ratio` against tests/cpu-baseline.json.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadWithField } from '../tests/load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITD = path.join(ROOT, 'assets', 'robots', 'into-the-deep');

/** The default robot with its TeleOp on the VM, a match with AI robots, started. */
export function setup() {
  const E = loadWithField();
  const cad = E.parseSTEP(zlib.gunzipSync(fs.readFileSync(path.join(ITD, 'robot.step.gz'))).toString('utf8'));
  const R = E.applyJointSpec(cad, JSON.parse(fs.readFileSync(path.join(ITD, 'joints.json'), 'utf8')));
  const code = E.parseJava(fs.readFileSync(path.join(ITD, 'sample_teleop.java'), 'utf8'), { engine: 'vm', libs: [] });
  if (!code.vm) throw new Error('the bench TeleOp did not compile on the Java VM');
  const map = E.autoMap(code.devices, cad.mechs);
  for (const d of code.devices) { const j = R.devices[d.name] || R.devices[d.cfg]; if (j) map[d.name] = j; }
  E.Sim.load(code, cad, map, { payloadKg: 0, duty: 0.3, trust: 'code', front: R.front, startPose: { x: 0, y: 0, h: 0 } });
  E.Sim.init();
  E.Match.on = true;
  E.Match.reset({ period: 'TeleOp', user: 'red', userPose: E.Sim.chassis, seed: 5, skill: 'medium' });
  E.Sim.start();
  return E;
}

/** `ticks` ticks of 20 ms after a warm-up. Returns { ticks, ms, ticksPerSec }. */
export function bench(ticks = 3000) {
  const E = setup();
  const keys = ['x', 'y', 'a', 'dpad_down', 'b', 'dpad_up'];
  const tick = (i) => {
    // the driver weaves and presses a button every 1.5 s, so the mechanisms and the code's branches all run
    E.Sim.pad = { 1: { left_stick_y: -0.8, left_stick_x: 0.3 * Math.sin(i / 60), right_stick_x: 0.4 * Math.cos(i / 90) }, 2: { [keys[Math.floor(i / 75) % keys.length]]: true } };
    E.Sim.tick(0.02);
  };
  for (let i = 0; i < 500; i++) tick(i);                         // let the JIT warm up
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) tick(500 + i);
  const ms = performance.now() - t0;
  if (E.Sim.phase !== 'running') throw new Error('the bench OpMode stopped: ' + E.Sim.phase);
  return { ticks, ms, ticksPerSec: ticks / (ms / 1000) };
}

/**
 * A fixed piece of plain JavaScript (generators, small objects, maths: what the interpreter does),
 * timed the same way. The test divides the sim's time by this one, so a slow or busy machine
 * moves both and the ratio stays put.
 */
export function reference() {
  function* leaf(i) { return { v: i * 0.5, w: Math.sin(i) }; }
  function* node(i) { const a = yield* leaf(i), b = yield* leaf(i + 1); return { v: a.v + b.v, w: Math.max(a.w, b.w) }; }
  const once = () => { let s = 0; for (let i = 0; i < 60000; i++) { const it = node(i); let r = it.next(); s += r.value.v + r.value.w; } return s; };
  for (let k = 0; k < 3; k++) once();
  const times = [];
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); once(); times.push(performance.now() - t0); }
  return times.sort((a, b) => a - b)[2];
}

/** Median of `runs` runs: { ticksPerSec, msPerTick, referenceMs, ratio } where ratio = ms per tick / reference ms (lower is faster). */
export function measure(runs = 3, ticks = 3000) {
  const rs = [];
  for (let k = 0; k < runs; k++) rs.push({ b: bench(ticks), ref: reference() });
  rs.sort((a, b) => (a.b.ms / a.ref) - (b.b.ms / b.ref));
  const m = rs[rs.length >> 1];
  const msPerTick = m.b.ms / m.b.ticks;
  return { ticksPerSec: m.b.ticksPerSec, msPerTick, referenceMs: m.ref, ratio: msPerTick / m.ref };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--ticks');
  const r = measure(3, i > 0 ? +process.argv[i + 1] : 3000);
  console.log(`${r.ticksPerSec.toFixed(0)} ticks/s (${r.msPerTick.toFixed(3)} ms per tick); reference ${r.referenceMs.toFixed(1)} ms; ratio ${r.ratio.toExponential(3)}`);
}
