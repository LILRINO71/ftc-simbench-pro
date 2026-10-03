// The robot's joints in Jolt Physics (src/joltmech.js): each joint type,
// each coupling, the motor curve, gravity, loops and determinism, against
// answers worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const J = await (await import('jolt-physics/wasm-compat')).default();
const box = (c, h) => { const p = []; for (let i = 0; i < 8; i++) p.push([c[0] + (i & 1 ? h[0] : -h[0]), c[1] + (i & 2 ? h[1] : -h[1]), c[2] + (i & 4 ? h[2] : -h[2])]); return p; };
const part = (mech, c, h, kg) => ({ name: mech + ' part', kind: 'metal', pts: box(c, h), kg, mech });
// an arm 0.3 m long, 1 kg, its centre 0.15 m out along +x from a pivot at z = 0.3;
// about -y a positive turn lifts it against gravity
const armCad = (axis, limits) => ({ solids: [part('arm', [0.15, 0, 0.3], [0.15, 0.01, 0.01], 1)],
  mechs: [{ id: 'arm', kind: 'revolute-lift', axis: axis || [0, -1, 0], pivot: [0, 0, 0.3], parent: 'chassis', limits: limits || null }] });
const run = (w, cmds, secs, sub = 4) => { for (let t = 0; t < secs; t += 0.02) w.step(0.02, cmds, sub); };

test('jolt: a motor with no load spins its joint at the motor curve\'s free speed, less the gearbox drag', () => {
  const w = E.JoltMech.build(J, armCad([0, 0, 1]));             // a turret: gravity doesn't load it
  run(w, { arm: { mode: 'dc', duty: 0.6, stall: 9, free: 12 } }, 1.0);
  const want = 12 * (0.6 - 0.02);                               // w = w_free (d - friction/stall)
  assert.ok(Math.abs(w.w('arm') - want) / want < 0.03, 'speed ' + w.w('arm') + ' vs ' + want);
  w.destroy();
});

test('jolt: a motor too weak for the arm can\'t lift it; a strong one can', () => {
  const load = 1 * 9.81 * 0.15;                                 // 1.47 N m at horizontal
  const weak = E.JoltMech.build(J, armCad(null, [-1.2, 1.2]));
  run(weak, { arm: { mode: 'dc', duty: 1, stall: 0.8 * load, free: 12 } }, 1.5);
  assert.ok(weak.q('arm') < 0.02, 'a weak motor sags or holds: ' + weak.q('arm'));
  const strong = E.JoltMech.build(J, armCad(null, [-1.2, 1.2]));
  run(strong, { arm: { mode: 'dc', duty: 1, stall: 4 * load, free: 12 } }, 1.5);
  assert.ok(strong.q('arm') > 1.15, 'a strong motor reaches its stop: ' + strong.q('arm'));
  weak.destroy(); strong.destroy();
});

test('jolt: with no power a braked motor lets the arm down at the back-EMF speed', () => {
  const w = E.JoltMech.build(J, armCad(null, [-1.2, 1.2]));
  const stall = 9, free = 12, load = 9.81 * 0.15;
  run(w, { arm: { mode: 'dc', duty: 0, stall, free } }, 0.1);
  const wv = w.w('arm');
  // brake: tau = -stall w / free; it falls where gravity and the brake balance, less the gearbox drag
  const want = -(load - 0.02 * stall) * free / stall;
  assert.ok(wv < 0, 'it falls');
  assert.ok(Math.abs(wv - want) / Math.abs(want) < 0.15, 'falls at ' + wv + ' vs ' + want);
  w.destroy();
});

test('jolt: a slide stops at its travel limit', () => {
  const cad = { solids: [part('lift', [0, 0, 0.3], [0.02, 0.02, 0.1], 0.8)],
    mechs: [{ id: 'lift', kind: 'linear', axis: [0, 0, 1], pivot: [0, 0, 0.2], parent: 'chassis', limits: [0, 0.4] }] };
  const w = E.JoltMech.build(J, cad);
  run(w, { lift: { mode: 'dc', duty: 1, stall: 60, free: 1.2 } }, 1.5);
  assert.ok(Math.abs(w.q('lift') - 0.4) < 0.005, 'at the top: ' + w.q('lift'));
  run(w, { lift: { mode: 'dc', duty: -1, stall: 60, free: 1.2 } }, 1.5);
  assert.ok(Math.abs(w.q('lift')) < 0.005, 'at the bottom: ' + w.q('lift'));
  w.destroy();
});

test('jolt: two gears on the frame turn in their ratio, through a gear constraint', () => {
  const cad = { solids: [part('g1', [0.3, 0, 0.3], [0.02, 0.02, 0.005], 0.05), part('g2', [0.36, 0, 0.3], [0.04, 0.04, 0.005], 0.1)],
    mechs: [{ id: 'g1', kind: 'revolute-yaw', axis: [0, 0, 1], pivot: [0.3, 0, 0.3], parent: 'chassis' },
      { id: 'g2', kind: 'revolute-yaw', axis: [0, 0, 1], pivot: [0.36, 0, 0.3], parent: 'chassis', couple: { to: 'g1', ratio: -0.5, via: 'gear' } }] };
  const w = E.JoltMech.build(J, cad);
  assert.equal(w.joints.get('g2').follow, 'gear');
  run(w, { g1: { mode: 'dc', duty: 0.5, stall: 2, free: 10 } }, 0.3);
  assert.ok(Math.abs(w.q('g1')) > 0.5);
  assert.ok(Math.abs(w.q('g2') - (-0.5) * w.q('g1')) < 1e-3, w.q('g2') + ' vs ' + (-0.5 * w.q('g1')));
  w.destroy();
});

test('jolt: a pinion drives its rack, through a rack-and-pinion constraint', () => {
  const cad = { solids: [part('pin', [0.2, 0, 0.3], [0.01, 0.01, 0.01], 0.05), part('rack', [0.2, 0.03, 0.3], [0.1, 0.005, 0.005], 0.3)],
    mechs: [{ id: 'pin', kind: 'revolute-yaw', axis: [0, 0, 1], pivot: [0.2, 0, 0.3], parent: 'chassis' },
      { id: 'rack', kind: 'linear', axis: [1, 0, 0], pivot: [0.2, 0.03, 0.3], parent: 'chassis', couple: { to: 'pin', ratio: 0.012, via: 'rack and pinion' } }] };
  const w = E.JoltMech.build(J, cad);
  assert.equal(w.joints.get('rack').follow, 'rack');
  run(w, { pin: { mode: 'dc', duty: 0.5, stall: 2, free: 20 } }, 0.3);
  assert.ok(Math.abs(w.q('rack') - 0.012 * w.q('pin')) < 1e-4, w.q('rack') + ' vs ' + 0.012 * w.q('pin'));
  w.destroy();
});

test('jolt: a cascade stage follows the stage that drives it', () => {
  const cad = { solids: [part('s1', [0, 0, 0.3], [0.02, 0.02, 0.1], 0.4), part('s2', [0, 0, 0.35], [0.02, 0.02, 0.1], 0.3)],
    mechs: [{ id: 's1', kind: 'linear', axis: [0, 0, 1], pivot: [0, 0, 0.2], parent: 'chassis', limits: [0, 0.3] },
      { id: 's2', kind: 'linear', axis: [0, 0, 1], pivot: [0, 0, 0.25], parent: 's1', limits: [0, 0.3], couple: { to: 's1', ratio: 1, via: 'linear' } }] };
  const w = E.JoltMech.build(J, cad);
  assert.equal(w.joints.get('s2').follow, 'track');
  run(w, { s1: { mode: 'dc', duty: 0.5, stall: 80, free: 1 } }, 0.4);
  assert.ok(w.q('s1') > 0.1);
  assert.ok(Math.abs(w.q('s2') - w.q('s1')) < 2e-3, w.q('s2') + ' vs ' + w.q('s1'));
  w.destroy();
});

test('jolt: a parallelogram closed by a loop mate keeps its coupler level as the crank turns', () => {
  // crank and rocker on the frame, 0.1 m apart vertically; the coupler hangs on the crank and is pinned to the rocker
  const cad = { solids: [part('crank', [0.1, 0, 0.3], [0.1, 0.01, 0.01], 0.2), part('rocker', [0.1, 0, 0.4], [0.1, 0.01, 0.01], 0.2),
    part('coupler', [0.2, 0, 0.35], [0.01, 0.01, 0.05], 0.1)],
  mechs: [{ id: 'crank', kind: 'revolute-lift', axis: [0, -1, 0], pivot: [0, 0, 0.3], parent: 'chassis' },
    { id: 'rocker', kind: 'revolute-lift', axis: [0, -1, 0], pivot: [0, 0, 0.4], parent: 'chassis' },
    { id: 'coupler', kind: 'revolute-lift', axis: [0, -1, 0], pivot: [0.2, 0, 0.3], parent: 'crank' }],
  loops: [{ name: 'pin', a: 'coupler', b: 'rocker', point: [0.2, 0, 0.4], axis: [0, -1, 0] }] };
  const w = E.JoltMech.build(J, cad);
  assert.ok(w.joints.get('rocker').passive && w.joints.get('coupler').passive, 'the pins around the loop move freely');
  run(w, { crank: { mode: 'servo', target: 0.5, stall: 20, rate: 3 } }, 1.0);
  assert.ok(Math.abs(w.q('crank') - 0.5) < 0.01, 'crank ' + w.q('crank'));
  assert.ok(Math.abs(w.q('rocker') - w.q('crank')) < 0.02, 'a parallelogram: rocker ' + w.q('rocker'));
  assert.ok(Math.abs(w.q('coupler') + w.q('crank')) < 0.02, 'the coupler stays level: ' + w.q('coupler'));
  w.destroy();
});

test('jolt: the motor\'s rotor, reflected through the gearbox, slows the arm\'s spin-up', () => {
  const t50 = (armature) => {
    const w = E.JoltMech.build(J, armCad([0, 0, 1]), { armature: armature ? { arm: armature } : {} });
    let t = 0; for (; t < 2 && w.w('arm') < 0.5 * 12 * 0.98; t += 0.02) w.step(0.02, { arm: { mode: 'dc', duty: 1, stall: 3, free: 12 } }, 4);
    w.destroy(); return t;
  };
  const bare = t50(0), geared = t50(0.03);
  assert.ok(geared > 1.5 * bare, 'half speed in ' + geared + ' s with the rotor vs ' + bare + ' s without');
});

test('jolt: the same commands give the same state, step for step (lockstep needs it)', () => {
  const play = () => { const w = E.JoltMech.build(J, armCad(null, [-1.2, 1.2])), hs = [];
    for (let i = 0; i < 100; i++) { w.step(0.02, { arm: { mode: 'dc', duty: Math.sin(i / 7), stall: 5, free: 10 } }, 4); hs.push(w.hash()); }
    w.destroy(); return hs; };
  const a = play(), b = play();
  assert.deepEqual(a, b);
  assert.ok(new Set(a).size > 50, 'the hash follows the state');
});

test('jolt: the bench\'s devices drive their joints and read their encoders back in the code\'s frame', () => {
  const cad = armCad([0, 0, 1]);
  const m = cad.mechs[0]; m.gear = 2; m.fromMate = { name: 'arm' };
  const w = E.JoltMech.build(J, cad);
  const s = { kind: 'motor', mech: m, spec: { rpm: 117, stallNm: 9, ratio: 50.9 }, act: 1, cmd: 1, tpr: 1425.1, revs: 0, ticks: 0 };
  const dev = { arm: s };
  for (let i = 0; i < 50; i++) { w.step(0.02, E.JoltMech.deviceCommands(dev, w), 4); E.JoltMech.readBack(dev, w, 0.02); }
  // the joint turns at half the output shaft's speed (gear 2); the encoder counts the shaft
  assert.ok(Math.abs(s.revs - w.q('arm') * 2 / (2 * Math.PI)) < 1e-9);
  assert.ok(s.ticks > 0 && Math.abs(s.ticks - s.revs * 1425.1) < 1e-6);
  const shaftRps = 117 / 60;                                   // about where a lightly loaded motor runs
  assert.ok(s.revs > 0.5 * shaftRps && s.revs < 1.0 * shaftRps, 'revs in 1 s: ' + s.revs);
  // REVERSE in the code doesn't change the joint's sign in this frame: the code's positive is the joint's
  const { cmds, armature } = E.JoltMech.deviceCommands(dev, w, { armature: true });
  assert.equal(cmds.arm.mode, 'dc');
  assert.ok(Math.abs(cmds.arm.stall - 9 * 2) < 1e-9 && Math.abs(cmds.arm.free - 117 * 2 * Math.PI / 60 / 2) < 1e-9);
  assert.ok(armature.arm > 0);
  w.destroy();
});

test('jolt: the rotors two motors put on one joint add up, through the gearbox squared', () => {
  const m = { id: 'arm', kind: 'revolute-lift', gear: 2 };
  const dev = { a: { kind: 'motor', mech: m, spec: { ratio: 50.9 } }, b: { kind: 'motor', mech: m, spec: { ratio: 50.9 } },
    s: { kind: 'motor', mech: { id: 'lift', kind: 'linear' }, spec: { ratio: 19.2 } }, v: { kind: 'servo', mech: m, spec: {} } };
  const a = E.JoltMech.armatureOf(dev);
  assert.ok(Math.abs(a.arm - 2 * E.JoltMech.ROTOR.motor * (50.9 * 2) ** 2) < 1e-12);
  assert.equal(a.lift, undefined, 'a slide\'s spool isn\'t a turning joint');
});

test('jolt: a guessed lift turns the way the kinematic view draws it; a mate joint by its own axis', () => {
  assert.equal(E.JoltMech.jointSign({ kind: 'revolute-lift' }), -1);
  assert.equal(E.JoltMech.jointSign({ kind: 'revolute-lift', dir: -1 }), 1);
  assert.equal(E.JoltMech.jointSign({ kind: 'revolute-lift', fromMate: {} }), 1);
  assert.equal(E.JoltMech.jointSign({ kind: 'linear', dir: -1 }), -1);
});
