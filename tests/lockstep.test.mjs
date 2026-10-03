// Lockstep bookkeeping (src/lockstep.js): commands encode small and exactly
// enough, the ledger plays a tick only when every robot's commands are in,
// a robot that goes quiet is driven by a stand-in, and the hash vote finds
// the computer that diverged. Then a whole match in lockstep: three
// computers, each running every robot in Jolt from exchanged commands, end
// in the same state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

test('lockstep: commands round-trip to 1/32767 and stay small', () => {
  const v = [1, -1, 0, 0.5, -0.123456, 2, NaN];
  const s = E.lsEncode(v);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(s), 'base64url');
  assert.ok(s.length <= 22, s.length + ' characters for 7 values');
  const back = E.lsDecode(s);
  assert.equal(back.length, 7);
  [1, -1, 0, 0.5, -0.123456, 1, 0].forEach((x, i) => assert.ok(Math.abs(back[i] - x) <= 1 / 32767, i + ': ' + back[i]));
  assert.equal(E.lsDecode('not base64!'), null);
  assert.equal(E.lsDecode(E.lsEncode([1]).slice(0, -1)), null, 'cut short');
  assert.equal(E.lsDecode('A'.repeat(500)), null);
});

test('lockstep: a tick is played once every robot\'s commands are in, in tick order', () => {
  const L = E.lsLedger(['red1', 'blue1'], { delay: 2, wait: 10 });
  assert.equal(L.forTick(), 2);
  assert.ok(L.put('red1', 0, [0.5]));
  assert.equal(L.next(), null, 'blue1 hasn\'t said tick 0');
  assert.ok(L.put('blue1', 0, [-0.5]));
  assert.ok(!L.put('blue1', 0, [0.9]), 'said once');
  const t0 = L.next();
  assert.deepEqual(t0, { tick: 0, cmds: { red1: [0.5], blue1: [-0.5] } });
  assert.ok(!L.put('red1', 0, [1]), 'a tick already played is closed');
  assert.ok(!L.put('nobody', 1, [1]), 'not a robot in this match');
});

test('lockstep: a robot that goes quiet is driven by a stand-in, and takes back over when it returns', () => {
  const L = E.lsLedger(['a', 'b'], { delay: 0, wait: 3 });
  for (let t = 0; t < 10; t++) L.put('a', t, [1]);
  assert.equal(L.next(), null); assert.equal(L.next(), null);
  const got = L.next();
  assert.deepEqual(got.cmds, { a: [1], b: [] }, 'motors off for the quiet one');
  assert.deepEqual(L.standIns, ['b']);
  assert.ok(L.next(), 'no more waiting for it');
  L.put('b', L.tick, [0.25]);
  const back = L.next();
  assert.deepEqual(back.cmds.b, [0.25]);
  assert.deepEqual(L.standIns, []);
});

test('lockstep: the hash vote names the computer that diverged', () => {
  const V = E.lsVote();
  V.say(25, 'x', 7); V.say(25, 'y', 7); assert.equal(V.check(25, 3), null, 'waits for everyone');
  V.say(25, 'z', 9);
  assert.deepEqual(V.check(25, 3), { tick: 25, agreed: 7, diverged: ['z'] });
  assert.notEqual(E.lsHash([1, 2, 3]), E.lsHash([1, 2, 3.0000002]));
  assert.equal(E.lsHash([1, 2, 3]), E.lsHash([1, 2, 3]));
});

test('lockstep: three computers running every robot from exchanged commands end in the same state', async () => {
  const J = await (await import('jolt-physics/wasm-compat')).default();
  const box = (c, h) => { const p = []; for (let i = 0; i < 8; i++) p.push([c[0] + (i & 1 ? h[0] : -h[0]), c[1] + (i & 2 ? h[1] : -h[1]), c[2] + (i & 4 ? h[2] : -h[2])]); return p; };
  const robot = () => ({ solids: [{ name: 'arm', kind: 'metal', pts: box([0.15, 0, 0.3], [0.15, 0.01, 0.01]), kg: 1, mech: 'arm' },
    { name: 'lift', kind: 'metal', pts: box([0, 0.1, 0.3], [0.02, 0.02, 0.1]), kg: 0.6, mech: 'lift' }],
  mechs: [{ id: 'arm', kind: 'revolute-lift', axis: [0, -1, 0], pivot: [0, 0, 0.3], parent: 'chassis', limits: [-1.2, 1.2] },
    { id: 'lift', kind: 'linear', axis: [0, 0, 1], pivot: [0, 0.1, 0.2], parent: 'chassis', limits: [0, 0.4] }] });
  const slots = ['red1', 'red2', 'blue1'];
  // each computer: one Jolt world per robot, a ledger, and its own team's "code"
  const computers = slots.map((me, k) => ({ me, worlds: Object.fromEntries(slots.map((s) => [s, E.JoltMech.build(J, robot())])),
    L: E.lsLedger(slots, { delay: 2, wait: 50 }), code: (t) => [Math.sin(t / (9 + k)), Math.cos(t / (5 + 2 * k))] }));
  const wire = [];                           // what the room would carry: [slot, tick, string], delivered in a scrambled order
  const toCmd = (v) => ({ arm: { mode: 'dc', duty: v[0] || 0, stall: 6, free: 10 }, lift: { mode: 'dc', duty: v[1] || 0, stall: 40, free: 1 } });
  for (const c of computers) c.made = 0;
  for (let round = 0; round < 400; round++) {
    // each computer says its robot's commands for every tick up to LOCKSTEP_DELAY ahead of where it is
    for (const c of computers) while (c.made <= c.L.tick + c.L.delay && c.made < 300) { wire.push([c.me, c.made, E.lsEncode(c.code(c.made))]); c.made++; }
    // the network delivers, in no particular order
    for (let i = wire.length - 1; i > 0; i--) { const j = (i * 7919 + round) % (i + 1); [wire[i], wire[j]] = [wire[j], wire[i]]; }
    for (const [s, t, d] of wire.splice(0)) for (const c of computers) c.L.put(s, t, d);
    for (const c of computers) { let g; while ((g = c.L.next())) for (const s of slots) c.worlds[s].step(0.02, toCmd(g.cmds[s]), 4); }
  }
  const state = (c) => slots.map((s) => c.worlds[s].hash());
  assert.ok(computers[0].L.tick > 250, 'the match ran: ' + computers[0].L.tick + ' ticks');
  assert.deepEqual(state(computers[1]), state(computers[0]));
  assert.deepEqual(state(computers[2]), state(computers[0]));
  assert.deepEqual(computers[0].L.standIns, [], 'nobody needed a stand-in');
  for (const c of computers) for (const s of slots) c.worlds[s].destroy();
});

test('lockstep: a tick nobody has spoken for is never played, however long everyone waits', () => {
  const L = E.lsLedger(['a', 'b'], { delay: 0, wait: 2 });
  L.put('a', 0, [1]); L.put('b', 0, [1]);
  assert.ok(L.next());
  for (let i = 0; i < 100; i++) assert.equal(L.next(), null, 'nothing to play at ' + L.tick);
  assert.equal(L.tick, 1);
});
