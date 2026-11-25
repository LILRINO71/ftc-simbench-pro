// The picture between two sim steps. The sim moves in 20 ms steps and a screen draws 60, 120 or 144
// frames a second, so a frame with no step in it made the robot stand still and the next one jump
// (measured at 125 Hz: 60 % of frames did not move the robot at all). The page draws the robot and the
// AI robots k of the way from where the last step began to where it ended (Interp in src/app.js).
// app.js needs a DOM, so Interp is read out of its source and run against stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
const E = loadEngine();

test('lerpPose: a pose k of the way, the short way round, and no smoothing of a jump', () => {
  const o = {};
  assert.ok(E.lerpPose(o, { x: 0, y: 0, h: 0 }, { x: 0.02, y: 0.04, h: 0.1 }, 0.5));
  assert.deepEqual(o, { x: 0.01, y: 0.02, h: 0.05 });
  // across the +-pi seam the heading goes through pi, not back through 0
  assert.ok(E.lerpPose(o, { x: 0, y: 0, h: 3.1 }, { x: 0, y: 0, h: -3.1 }, 0.5));
  assert.ok(Math.abs(Math.abs(o.h) - Math.PI) < 0.05, 'half way across the seam is about pi: ' + o.h);
  // a teleport (a reset, a drag, a placed robot) is not interpolated and leaves out alone
  const keep = { x: 9, y: 9, h: 9 };
  assert.equal(E.lerpPose(keep, { x: 0, y: 0, h: 0 }, { x: 2, y: 0, h: 0 }, 0.5), false);
  assert.equal(E.lerpPose(keep, { x: 0, y: 0, h: 0 }, { x: 0, y: 0, h: 2 }, 0.5), false);
  assert.equal(E.lerpPose(keep, { x: 0, y: 0, h: 0 }, { x: NaN, y: 0, h: 0 }, 0.5), false);
  assert.deepEqual(keep, { x: 9, y: 9, h: 9 });
});

function interpBench() {
  const m = /\nconst Interp=\{[\s\S]*?\n  \} \};\n/.exec(APP);
  assert.ok(m, 'Interp is still in src/app.js');
  const ctx = { Sim: { phase: 'running', chassis: { x: 0, y: 0, h: 0 } }, Match: { on: true, bots: [{ x: 1, y: 1, h: 0 }] }, lerpPose: E.lerpPose };
  vm.createContext(ctx);
  vm.runInContext(m[0] + ';this.Interp=Interp;', ctx);
  return ctx;
}

test('interpolation: drawn between the last two steps, then the real state is put back exactly', () => {
  const { Sim, Match, Interp } = interpBench();
  Interp.snap();                                             // before the step
  Sim.chassis.x = 0.02; Match.bots[0].x = 1.04;              // the step
  Interp.apply(0.25);
  assert.ok(Math.abs(Sim.chassis.x - 0.005) < 1e-12, 'the robot a quarter of the way: ' + Sim.chassis.x);
  assert.ok(Math.abs(Match.bots[0].x - 1.01) < 1e-12, 'so is an AI robot');
  Interp.restore();
  assert.equal(Sim.chassis.x, 0.02); assert.equal(Match.bots[0].x, 1.04);
  // every frame of the pair moves the robot a little: three frames, three positions
  const seen = [0.2, 0.5, 0.8].map((k) => { Interp.apply(k); const x = Sim.chassis.x; Interp.restore(); return x; });
  assert.ok(seen[0] < seen[1] && seen[1] < seen[2]);
});

test('interpolation: never outside a running sim, across a jump, or for a robot that is not the same one', () => {
  const { Sim, Match, Interp } = interpBench();
  Interp.snap();
  Sim.chassis.x = 0.02; Sim.phase = 'init';
  Interp.apply(0.5);
  assert.equal(Sim.chassis.x, 0.02, 'INIT shows the real pose');
  Sim.phase = 'running';
  Interp.snap(); Sim.chassis.x = 3;                          // a robot placed 3 m away
  Interp.apply(0.5); assert.equal(Sim.chassis.x, 3, 'a jump is shown as it is');
  Interp.restore(); assert.equal(Sim.chassis.x, 3);
  Interp.snap(); Match.bots = [{ x: 5, y: 5, h: 0 }];        // a new match: new robot objects
  Interp.apply(0.5); assert.equal(Match.bots[0].x, 5);
  Interp.restore(); assert.equal(Match.bots[0].x, 5);
});
