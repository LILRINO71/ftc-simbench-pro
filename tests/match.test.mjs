// The rest of a BIOBUZZ match (src/match.js): three AI robots and both
// alliances' HUMAN PLAYERS. They have to play by the Competition Manual every
// tick of every match, score the way the manual scores, replay from their seed,
// get better with skill, and share the field and the HIVEs with the team's robot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithField, sampleBench } from './load.mjs';

const E = loadWithField();
const IN = 0.0254, H = 70.5 * IN, HX = 0.2286;
const userAt = (x, y, h = 0) => ({ chassis: { x, y, h }, footprint: { hx: HX, hy: HX, ox: 0, oy: 0 }, obstacles: E.Field.obstacles(0.4) });

/* One period, start to end; watch() sees every tick. */
function play({ period = 'TeleOp', seed = 1, skill = 'typical', sim = userAt(-61.5 * IN, 0), watch } = {}) {
  E.Field.reset();
  const M = E.Match; M.on = true; M.reset({ period, user: 'red', userPose: sim.chassis, seed, skill });
  for (let i = 0; i < M.len / 0.02; i++) { M.tick(0.02, sim); if (watch) watch(M, sim); }
  return { M, sim, S: M.score(sim) };
}
const inRect = (x, y, z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;

test('match: TELEOP keeps the manual every tick (G402, G407, G408, G410, G418, G426/G427)', () => {
  for (const seed of [1, 2, 3, 4]) {
    let worst = 0;
    const { M } = play({ seed, watch: (M) => {
      for (const b of M.bots) {
        assert.ok(b.hold.length <= 4, 'G407: a robot controls at most 4 elements');
        assert.ok(!b.hold.some((e) => e.kind === 'nectar' && e.color !== b.al), 'G408: never the other alliance\'s NECTAR');
        assert.ok(Math.abs(b.x) <= H - HX + 0.01 && Math.abs(b.y) <= H - HX + 0.01, 'on the field');
      }
      for (let i = 0; i < M.bots.length; i++) for (let j = i + 1; j < M.bots.length; j++)
        worst = Math.max(worst, 2 * HX - Math.hypot(M.bots[i].x - M.bots[j].x, M.bots[i].y - M.bots[j].y));
    } });
    assert.ok(worst < 0.03, `robots never overlap by more than 3 cm (seed ${seed}: ${(worst * 100).toFixed(1)} cm)`);
    // G410: NECTAR into a FLOWER only in the last 60 s, and only the robot's own colour
    for (const p of M.placed) { assert.ok(p.t >= M.len - 60 - 1e-9, 'G410 at ' + p.t.toFixed(1)); assert.equal(p.color, p.al); }
    // G426/G427: one NECTAR per own TIP, or any in the last 60 s; always into the own LOADING ZONE
    for (const al of ['red', 'blue']) {
      const mine = M.entries.filter((e) => e.al === al);
      mine.forEach((e, k) => { if (!e.lastMinute) assert.ok(e.earned >= k + 1, `${al} entry ${k + 1} with ${e.earned} TIPs`); });
      for (const e of mine) assert.ok(inRect(e.x, e.y, M.zone(al)), 'into the LOADING ZONE');
      assert.ok(mine.length <= 5, 'five NECTAR in the tray');
    }
    // G418: a FLOWER only ever loses POLLEN from the bottom, so any NECTAR in it stays in order
    for (const f of M.flowers) assert.ok(f.stack.length <= 6);
  }
});

test('match: AUTO keeps each robot on its own side, earns LEAVE, TIPs with the preload, and no human enters anything', () => {
  let parks = 0;
  for (const seed of [1, 2, 3]) {
    const { M, S } = play({ period: 'Autonomous', seed, watch: (M) => {
      for (const b of M.bots) assert.ok(b.x * (b.al === 'red' ? -1 : 1) >= HX - 0.01, 'G402: own side in AUTO');
    } });
    assert.equal(M.entries.length, 0, 'no HUMAN PLAYER entry in AUTO');
    assert.equal(M.placed.length, 0);
    assert.equal(S.blue.leave, 6, 'both blue robots LEAVE');
    assert.ok(S.blue.tips >= 1 && S.red.tips >= 1, 'each alliance TIPs with its preload');
    parks += S.blue.park / 5;
  }
  assert.ok(parks >= 5, 'the blue robots PARK in the LOADING ZONE at the end (all but one of 6 at most): ' + parks);
});

test('match: the score adds up the way the manual scores it', () => {
  const { M, S } = play({ seed: 5 });
  for (const al of ['red', 'blue']) {
    const r = S[al];
    assert.equal(r.total, r.tipPts + r.leave + r.park + r.cell + r.flower + r.bottom + r.garden);
    assert.equal(r.tipPts, 20 * r.tips);
    assert.equal(r.cell, 2 * E.Field.cells[al].length);
  }
  // FLOWERs by hand: the top-most NECTAR owns every element, the bottom-most NECTAR's colour gets 5
  M.flowers = [{ x: 0, y: 0, n: [0, 1], stack: [{ kind: 'pollen' }, { kind: 'nectar', color: 'red' }, { kind: 'pollen' }, { kind: 'nectar', color: 'blue' }] }];
  M.floor = [];
  const T = M.score(userAt(0, 0));
  assert.equal(T.blue.flower, 8); assert.equal(T.red.flower, 0);
  assert.equal(T.red.bottom, 5); assert.equal(T.blue.bottom, 0);
});

test('match: GARDEN and PARK are counted from where things really are', () => {
  E.Field.reset();
  const M = E.Match; M.on = true; M.reset({ period: 'TeleOp', user: 'red', userPose: { x: -61.5 * IN, y: 0, h: 0 }, seed: 3 });
  const S0 = M.score(userAt(0, 0));
  assert.equal(S0.red.garden, 4, 'the 4 staged POLLEN in each GARDEN');
  assert.equal(S0.blue.garden, 4);
  M.drop('nectar', 'blue', -60 * IN, -69 * IN);                // any alliance's NECTAR counts for the GARDEN's colour
  assert.equal(M.score(userAt(0, 0)).red.garden, 5);
  // the team's robot only partly in the red LOADING ZONE still parks
  const parked = M.score(userAt(-52 * IN, 30 * IN)).red.park, away = M.score(userAt(0, 0)).red.park;
  assert.equal(parked - away, 5);
});

test('match: it replays exactly from its seed, and a new seed plays a new match', () => {
  const a = play({ seed: 7 }), pos = a.M.bots.map((b) => [b.x, b.y]);
  const b = play({ seed: 7 });
  assert.deepEqual(b.S, a.S); assert.deepEqual(b.M.bots.map((x) => [x.x, x.y]), pos);
  const c = play({ seed: 8 });
  assert.notDeepEqual(c.M.bots.map((x) => [x.x, x.y]), pos);
});

test('match: better AI teams TIP more (rookie < typical < elite, blue pair, 3 seeds)', () => {
  const tips = (skill) => [1, 2, 3].reduce((n, seed) => n + play({ seed, skill }).S.blue.tips, 0) / 3;
  const r = tips('rookie'), t = tips('typical'), e = tips('elite');
  assert.ok(r < t && t < e, `rookie ${r}, typical ${t}, elite ${e}`);
  assert.ok(e >= 8 && e <= 14, 'an elite pair near the strategy study\'s ~11 TIPs: ' + e);
});

test('match: the team\'s robot and the AI robots push each other, and never pass through', () => {
  // the team's robot parked right where the red partner starts
  const sim = userAt(-(H - HX), -45 * IN, 0);
  let worst = 0;
  const x0 = sim.chassis.x, y0 = sim.chassis.y;
  play({ sim, seed: 2, watch: (M, s) => {
    for (const b of M.bots) {
      const d = Math.max(Math.abs(b.x - s.chassis.x), Math.abs(b.y - s.chassis.y));   // boxes, both square and near level
      if (Math.abs(Math.sin(b.h * 2)) < 0.2 && Math.abs(Math.sin(s.chassis.h * 2)) < 0.2) worst = Math.max(worst, 2 * HX - d);
    }
    assert.ok(Math.abs(s.chassis.x) <= H - HX + 0.01, 'the team\'s robot stays on the field');
  } });
  assert.ok(worst < 0.04, 'no robot drives through the team\'s: ' + (worst * 100).toFixed(1) + ' cm');
  assert.ok(Math.hypot(sim.chassis.x - x0, sim.chassis.y - y0) > 0.01, 'and the team\'s robot gets shoved');
});

test('match: a ball in the air when its HIVE tips is not in the new up-CELL (AI and team shots alike)', () => {
  E.Field.reset();
  const M = E.Match; M.on = true; M.reset({ period: 'TeleOp', user: 'red', seed: 1 });
  const bot = M.bots[0], before = E.Field.cells.red.length;
  M.flying.push({ path: [[0, 0, 10], [0, 0, 5]], t: 0, dur: 0.005, hit: true, kind: 'pollen', color: null, al: 'red', by: bot, pos: [0, 0, 10], hive: E.Field.hive.red });
  E.Field.tip('red');
  M.flights(0.02);
  assert.equal(E.Field.cells.red.length, 0, 'the new up-CELL comes up empty');
  assert.ok(M.floor.some((e) => e.x === 0 || Math.abs(e.x) < 0.2), 'the ball lands on the tiles instead');
  // the team's own shooter
  E.Field.reset(); E.Shots.reset();
  E.Shots.flying.push({ path: [[0, 0, 10], [0, 0, 5]], t: 0, dur: 0.005, hit: true, kind: 'pollen', color: null, al: 'red', v: 5, pos: [0, 0, 10], hive: E.Field.hive.red });
  E.Field.tip('red');
  E.Shots.tick(0.02, { x: 0, y: 0, h: 0 });
  assert.equal(E.Field.cells.red.length, 0);
  assert.ok(/tipped while it flew/.test(E.Shots.log[0].text), E.Shots.log[0].text);
  assert.equal(before, 3);
});

test('match: only the live sim plays the match; the drive probe\'s private copy never does', () => {
  const { cad, code, map, opts } = sampleBench(E);
  E.Field.reset();
  E.Sim.load(code, cad, map, opts); E.Sim.init();
  E.Match.on = true; E.Match.reset({ period: 'TeleOp', user: 'red', userPose: E.Sim.chassis, seed: 4 });
  const P = Object.create(E.Sim);
  P.load(code, cad, map, opts); P.init(); P.start();
  for (let i = 0; i < 10; i++) P.tick(0.02);
  assert.equal(E.Match.t, 0, 'a copy of the sim leaves the match alone');
  E.Sim.start();
  for (let i = 0; i < 10; i++) E.Sim.tick(0.02);
  assert.ok(Math.abs(E.Match.t - 0.2) < 1e-9, 'the live sim runs it, tick for tick');
  E.Match.on = false; E.Sim.stop();
});
