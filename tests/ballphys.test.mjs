// POLLEN and NECTAR as real balls (src/ballphys.js): they bounce lower each time and
// settle, roll to a stop on the foam, knock each other about keeping momentum, get
// pushed by robots without ever being driven through, go into a CELL when shot at
// one, and do all of it the same way every run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithField } from './load.mjs';

const E = loadWithField();
const IN = 0.0254;
const floorOnly = () => { const W = E.ballWorld(); W.statics = E.Field.ballStatics().filter((c) => c.tag === 'floor' || c.tag === 'wall'); return W; };

test('ballphys: a dropped ball bounces lower each time and comes to rest on the tiles', () => {
  const W = floorOnly(), b = E.ballSpawn({ kind: 'pollen', x: 1, y: 1 }, { z: 1 }), r = E.ballSpec('pollen').r;
  const tops = []; let up = false;
  for (let i = 0; i < 1000 && !b.sleep; i++) {
    W.step(0.005, [b], []);
    if (b.vz > 0) up = true; else if (up) { tops.push(b.z); up = false; }
  }
  assert.ok(tops.length >= 2, 'it bounced: ' + tops.length);
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] < tops[i - 1], 'lower each time: ' + tops.map((z) => z.toFixed(3)));
  assert.ok(tops[0] < 0.35, 'the foam takes most of it: first bounce to ' + tops[0].toFixed(2) + ' m from 1 m');
  assert.ok(b.sleep, 'at rest');
  assert.ok(Math.abs(b.z - r) < 1e-6 && Math.abs(b.x - 1) < 1e-6, 'on the tiles where it fell');
});

test('ballphys: a rolling ball slows on the foam and stops, its spin matching its roll', () => {
  const W = floorOnly(), r = E.ballSpec('nectar').r, b = E.ballSpawn({ kind: 'nectar', x: -1, y: 0 }, { vx: 1.2 });
  let t = 0, last = 1.2, rolled = false;
  for (; t < 10 && !b.sleep; t += 0.02) {
    W.step(0.02, [b], []);
    assert.ok(b.vx <= last + 1e-9, 'never speeds up'); last = b.vx;
    if (b.vx > 0.2 && Math.abs(b.wy * r - b.vx) < 0.01) rolled = true;
  }
  assert.ok(rolled, 'it rolls (no slip) once the friction has caught it up');
  assert.ok(b.sleep && b.vx === 0, 'and stops');
  const d = b.x + 1;
  assert.ok(d > 0.3 && d < 2, 'a sensible way across the tiles: ' + d.toFixed(2) + ' m in ' + t.toFixed(1) + ' s');
});

test('ballphys: two balls collide and keep their momentum', () => {
  const W = E.ballWorld();      // nothing else in the world, so only the two of them
  const a = E.ballSpawn({ kind: 'pollen', x: -0.3, y: 0.01 }, { z: 2, vx: 3 }), c = E.ballSpawn({ kind: 'nectar', x: 0.3, y: 0 }, { z: 2, vx: -1 });
  const ma = E.ballSpec('pollen').m, mc = E.ballSpec('nectar').m, p0 = [ma * a.vx + mc * c.vx, ma * a.vy + mc * c.vy];
  let met = false;
  for (let i = 0; i < 50; i++) { W.step(0.005, [a, c], []); if (a.vx < 0) met = true; }
  assert.ok(met, 'they met and the light one bounced back');
  const p1 = [ma * a.vx + mc * c.vx, ma * a.vy + mc * c.vy], drag = 0.05 * Math.abs(p0[0]);
  assert.ok(Math.abs(p1[0] - p0[0]) < drag, `x momentum ${p0[0].toFixed(4)} -> ${p1[0].toFixed(4)}`);
  assert.ok(Math.abs(p1[1] - p0[1]) < drag, 'y momentum');
  assert.ok(Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z) >= E.ballSpec('pollen').r + E.ballSpec('nectar').r - 1e-6, 'apart');
});

test('ballphys: a robot driving into balls pushes them, and never overlaps one', () => {
  const W = floorOnly(), R = E.ballSpec('pollen').r;
  const balls = [0, 1, 2].map((i) => E.ballSpawn({ kind: 'pollen', x: 0, y: -0.1 + i * 0.1 }));
  const box = { id: 'bot', x: -0.6, y: 0, h: 0.3, hx: 0.2286, hy: 0.2286, hz: 0.4 };
  const pen = (b) => { const c = Math.cos(box.h), s = Math.sin(box.h), dx = b.x - box.x, dy = b.y - box.y;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c, ex = Math.max(0, Math.abs(lx) - box.hx), ey = Math.max(0, Math.abs(ly) - box.hy);
    return R - Math.hypot(ex, ey); };
  let worst = -1;
  for (let i = 0; i < 60; i++) {
    box.x += 1.6 * 0.02; box.h += 0.4 * 0.02;               // 1.6 m/s and turning a little
    W.step(0.02, balls, [box]);
    for (const b of balls) worst = Math.max(worst, pen(b));
  }
  assert.ok(worst < 1e-3, 'deepest a ball got into the robot: ' + (worst * 1000).toFixed(2) + ' mm');
  assert.ok(balls.some((b) => b.x > 0.5), 'shoved along');
});

test('ballphys: a ball shot at the up-CELL goes in; one shot short bounces and rolls away', () => {
  E.Field.reset();
  const p = { robot: { x: -40, y: -30 }, target: 'red', ballId: 'pollen', hiveState: { red: E.Field.hive.red, blue: E.Field.hive.blue }, h0: 16,
    motorId: 'yj6000', shooter: { type: 'single', wheelDiameterMm: 96, gear: 1, motorsPerWheel: 1 } };
  const m = E.Field.model().mouthCentroid.red, yaw = Math.atan2(m[1] - p.robot.y, m[0] - p.robot.x) * 180 / Math.PI;
  const band = [];
  for (let v = 3; v <= 11; v += 0.05) if (E.Field.E.classifyShot(p, 70, v, yaw).hit) band.push(v);
  assert.ok(band.length > 2, 'the Shot Sim has a scoring band here');
  const fly = (v) => {
    const W = E.ballWorld(); W.statics = E.Field.ballStatics();
    const b = E.shotBall('pollen', 'red', [p.robot.x, p.robot.y, p.h0], v, 70, yaw, 1);
    let first = null, moved = 0;
    for (let i = 0; i < 300 && !b.sunk && !(first && b.sleep); i++) {
      const x = b.x, y = b.y;
      for (const e of W.step(0.02, [b], [])) if (!first) first = e;
      if (first && first.tag) moved += Math.hypot(b.x - x, b.y - y);
    }
    return { b, first, moved };
  };
  const mid = band[Math.floor(band.length / 2)], inn = fly(mid);
  assert.ok(inn.b.sunk === 'red', 'in the RED up-CELL at ' + mid.toFixed(2) + ' m/s (' + (inn.first && (inn.first.tag || inn.first.type)) + ')');
  const out = fly(band[0] - 0.6);
  assert.ok(!out.b.sunk, 'short of the band it misses');
  assert.ok(out.first && out.first.type === 'hit', 'it hit something: ' + (out.first && out.first.tag));
  assert.ok(out.moved > 0.1, 'and went on bouncing and rolling: ' + out.moved.toFixed(2) + ' m after it hit');
});

test('ballphys: the same start plays out the same, every time', () => {
  const run = () => {
    const W = E.ballWorld(); W.statics = E.Field.ballStatics();
    const rnd = E.makeRng(42), balls = [];
    for (let i = 0; i < 40; i++) balls.push(E.ballSpawn({ kind: i % 3 ? 'pollen' : 'nectar', x: (rnd() - 0.5) * 3, y: (rnd() - 0.5) * 3 },
      { z: 0.05 + rnd() * 0.6, vx: (rnd() - 0.5) * 3, vy: (rnd() - 0.5) * 3 }));
    const box = { id: 'b', x: -1.2, y: 0.3, h: 0, hx: 0.2286, hy: 0.2286, hz: 0.4 };
    for (let i = 0; i < 250; i++) { box.x += 0.02; box.h += 0.01; W.step(0.02, balls, [box]); }
    return balls.map((b) => [b.x, b.y, b.z, b.vx, b.vy, b.sleep]);
  };
  const a = run(), b = run();
  assert.deepEqual(b, a);
  assert.ok(a.filter((q) => q[5]).length > 20, 'most of them asleep by the end: ' + a.filter((q) => q[5]).length);
});

test('ballphys: in a match nothing goes through a robot, misses roll on, and the HUMAN PLAYER\'s NECTAR lands in the LOADING ZONE', () => {
  E.Field.reset();
  const M = E.Match; M.on = true;
  const sim = { chassis: { x: -61.5 * IN, y: 0, h: 0 }, footprint: { hx: 0.2286, hy: 0.2286, ox: 0, oy: 0, h: 0.35 }, obstacles: E.Field.obstacles(0.4) };
  M.reset({ period: 'TeleOp', user: 'red', userPose: sim.chassis, seed: 11, skill: 'elite' });
  let worst = 0, pinched = 0, rolled = 0;
  const seen = new Map(), H = E.Field.half();
  let entries = 0, landedIn = 0;
  for (let i = 0; i < 90 / 0.02; i++) {
    M.tick(0.02, sim);
    if (M.entries.length > entries) {
      // the NECTAR a HUMAN PLAYER just entered: on its way down into the LOADING ZONE
      entries = M.entries.length;
      const en = M.entries[entries - 1], e = M.floor.filter((q) => q.kind === 'nectar' && q.color === en.al).sort((p, q) => q.id - p.id)[0], z = M.zone(en.al);
      if (e && e.x >= z.x0 - 0.05 && e.x <= z.x1 + 0.05 && e.y >= z.y0 && e.y <= z.y1 && e.z < 0.2) landedIn++;
    }
    for (const e of M.floor) {
      if (e.hold) continue;
      const r = E.ballSpec(e.kind).r, onWall = H - Math.max(Math.abs(e.x), Math.abs(e.y)) < r + 0.002;
      for (const b of M.bots) {
        const c = Math.cos(b.h), s = Math.sin(b.h), dx = e.x - b.x, dy = e.y - b.y, lx = dx * c + dy * s, ly = -dx * s + dy * c;
        const p = r - Math.hypot(Math.max(0, Math.abs(lx) - 0.2286), Math.max(0, Math.abs(ly) - 0.2286), Math.max(0, e.z - 0.4));
        // a robot pressing a ball into the perimeter squeezes it (a hollow ball gives); it squirts out along the face
        if (onWall) pinched = Math.max(pinched, p); else worst = Math.max(worst, p);
      }
      const was = seen.get(e.id); if (was && Math.hypot(e.x - was[0], e.y - was[1]) > 1e-4) rolled++;
      seen.set(e.id, [e.x, e.y]);
    }
  }
  assert.ok(worst < 0.003, 'deepest a loose ball got into an AI robot: ' + (worst * 1000).toFixed(1) + ' mm');
  assert.ok(pinched < 0.02, 'squeezed against the wall by at most 2 cm: ' + (pinched * 1000).toFixed(1) + ' mm');
  assert.ok(rolled > 200, 'loose elements really move: ' + rolled);
  assert.ok(entries > 0, 'HUMAN PLAYERS entered NECTAR');
  assert.equal(landedIn, entries, 'each one comes down in its LOADING ZONE');
  M.on = false;
});
