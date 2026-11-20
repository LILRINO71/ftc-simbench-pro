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

test('match: in AUTO an AI robot keeps its own side and still never ends a tick inside a HIVE leg or a FLOWER', () => {
  const obs = E.Field.obstacles(0.46), MB = { hx: HX, hy: HX };
  for (const skill of ['rookie', 'typical', 'elite']) for (const seed of [1, 2, 3, 4, 5]) {
    let worst = null;
    play({ period: 'Autonomous', seed, skill, watch: (M) => {
      for (const b of M.bots) {
        assert.ok(b.x * (b.al === 'red' ? -1 : 1) >= HX - 1e-9, 'G402: own side in AUTO');
        for (const o of obs) {
          const d = E.capsulePush({ x: b.x, y: b.y, h: b.h }, MB, o), p = d ? Math.hypot(d[0], d[1]) : 0;
          if (p > 1e-4 && (!worst || p > worst.p)) worst = { p, t: M.t, id: b.id, what: o.what };
        }
      }
    } });
    assert.equal(worst, null, worst && `${skill} seed ${seed}: ${worst.id} ${(worst.p * 1000).toFixed(1)} mm into a ${worst.what} at t=${worst.t.toFixed(2)} s`);
  }
});

test('match: the score adds up the way the manual scores it', () => {
  const { M, S } = play({ seed: 5 });
  for (const al of ['red', 'blue']) {
    const r = S[al];
    assert.equal(r.total, r.tipPts + r.leave + r.park + r.cell + r.flower + r.bottom + r.garden);
    assert.equal(r.tipPts, 20 * r.tips);
    assert.equal(r.cell, 2 * E.Field.cells[al].length);
  }
  // FLOWERs by hand: the top-most NECTAR owns every element in the scoring volume, the bottom-most
  // NECTAR's colour gets 5. The POLLEN on the tile (0-2.8 in) is under the middle ring and doesn't score
  // (manual sec 10.5.2 p88), so 3 of the 4 elements score
  M.flowers = [{ x: 0, y: 0, n: [0, 1], stack: [{ kind: 'pollen' }, { kind: 'nectar', color: 'red' }, { kind: 'pollen' }, { kind: 'nectar', color: 'blue' }] }];
  M.floor = [];
  const T = M.score(userAt(0, 0));
  assert.equal(T.blue.flower, 6); assert.equal(T.red.flower, 0);
  assert.equal(T.red.bottom, 5); assert.equal(T.blue.bottom, 0);
});

test('match: a FLOWER scores only what is in its scoring volume, between the middle and top rings', () => {
  // manual sec 10.5.2 p88: an element scores if "at least partially within" the volume between the top
  // ring (21.5 in) and the middle ring (~3.55 in). Every row is biobuzz-robot/strategy/rules-edges.md
  // Appendix A (straight stack: POLLEN 2.80 in, NECTAR 3.62 in; a bottom NECTAR rests on the 0.43 in ring)
  E.Field.reset();
  const M = E.Match; M.on = true; M.reset({ period: 'TeleOp', user: 'red', userPose: { x: -61.5 * IN, y: 0, h: 0 }, seed: 1 });
  M.floor = [];
  const P = { kind: 'pollen' }, N = { kind: 'nectar', color: 'red' };
  const rows = [
    ['staged 4 P', [P, P, P, P], 0, 0],
    ['4 P + 1 N', [P, P, P, P, N], 8, 5],
    ['4 P + 2 N', [P, P, P, P, N, N], 10, 5],
    ['4 P + 3 N', [P, P, P, P, N, N, N], 12, 5],
    ['3 P + 4 N', [P, P, P, N, N, N, N], 12, 5],
    ['0 P + 6 N', [N, N, N, N, N, N], 12, 5],
    ['1 N + 4 P + 2 N', [N, P, P, P, P, N, N], 14, 5],
    ['8 P', [P, P, P, P, P, P, P, P], 0, 0],
  ];
  for (const [name, stack, flower, bottom] of rows) {
    M.flowers = [{ x: 0, y: 0, n: [0, 1], stack }];
    const S = M.score(userAt(0, 0));
    assert.equal(S.red.flower, flower, name + ': owner points');
    assert.equal(S.red.bottom, bottom, name + ': bottom NECTAR bonus');
  }
  // the staged FLOWERs as reset() builds them: 3 of each 4 POLLEN in the volume
  M.reset({ period: 'TeleOp', user: 'red', userPose: { x: -61.5 * IN, y: 0, h: 0 }, seed: 1 });
  for (const f of M.flowers) assert.deepEqual(M.flowerScoring(f), [false, true, true, true]);
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

test('match: a seed replays the same match whether or not another was played first in the same engine', () => {
  // the team's robot ended the earlier match somewhere else; nothing of that match may reach this one
  const run = (Eng, before) => {
    const go = (seed, skill, sim, tr) => {
      Eng.Field.reset();
      const M = Eng.Match; M.on = true; M.reset({ period: 'TeleOp', user: 'red', userPose: sim.chassis, seed, skill });
      for (let i = 0; i < M.len / 0.02; i++) { M.tick(0.02, sim); if (tr) tr.push(M.bots.map((b) => b.x + ',' + b.y + ',' + b.h).join(';')); }
      return M.score(sim);
    };
    const at = (x, y) => ({ chassis: { x, y, h: 0 }, footprint: { hx: HX, hy: HX, ox: 0, oy: 0 }, obstacles: Eng.Field.obstacles(0.4) });
    if (before) go(107, 'elite', at(-61.5 * IN, -35 * IN));
    const tr = [], S = go(7, 'typical', at(-61.5 * IN, 0), tr);
    return { tr, S };
  };
  const fresh = run(loadWithField(), false), after = run(loadWithField(), true);
  const k = fresh.tr.findIndex((p, i) => p !== after.tr[i]);
  assert.equal(k, -1, `the AI robots first differ at t=${((k + 1) * 0.02).toFixed(2)} s`);
  assert.deepEqual(after.S, fresh.S);
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

test('match: TIPs between two ticks each spill their CELL, so no element is ever lost', () => {
  // the up-CELL "dumps its contents on that side" (game-brief.md HIVE); an AI shot and the team's can sink
  // in the same 20 ms, so two TIPs (both HIVEs, or one HIVE twice) can come before the next Match.tick
  E.Field.reset();
  const M = E.Match, F = E.Field, sim = userAt(-61.5 * IN, 0);
  M.on = true; M.reset({ period: 'TeleOp', user: 'red', userPose: sim.chassis, seed: 1 });
  M.tick(0.02, sim);
  const floor0 = M.floor.length;
  for (let i = 0; i < 3; i++) F.addToCell('red', 'pollen');     // 3 NECTAR + 3 POLLEN = 198.6 g: TIP
  for (let i = 0; i < 3; i++) F.addToCell('blue', 'pollen');
  for (let i = 0; i < 8; i++) F.addToCell('red', 'pollen');     // 8 POLLEN = 199.2 g: the red HIVE again
  assert.deepEqual(F.tips, { red: 2, blue: 1 });
  assert.equal(F.lastTip.al, 'red', 'lastTip is still the newest');
  M.tick(0.02, sim);
  assert.equal(M.floor.length - floor0, 6 + 6 + 8, 'every element of all three CELLs is on the tiles');
  const notes = M.events.map((e) => e.text).filter((t) => /TIPPED/.test(t)).reverse();
  assert.deepEqual(notes, ['RED HIVE TIPPED (TIP 1) +20', 'BLUE HIVE TIPPED (TIP 1) +20', 'RED HIVE TIPPED (TIP 2) +20']);
  const n = M.floor.length;
  M.tick(0.02, sim);
  assert.equal(M.floor.length, n, 'and each TIP spills once');
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
