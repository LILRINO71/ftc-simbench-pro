// Online matches (src/net.js): two or three benches, each a separate engine
// as if on its own computer, joined by an in-process network that passes
// every message through JSON. Finding a match, the room, the start, one
// clock, robots seeing and pushing each other, a guest's shot decided by the
// host, the host's match mirrored on the guests, the end, and junk from a
// stranger that must not change anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithField } from './load.mjs';

const IN = 0.0254;
/* A bench on its own computer: its engine, its clock, its robot (a box the test drives). */
function computer(hub, id, skew = 0) {
  const E = loadWithField(), clock = { t: 1_000_000 + skew };
  E.Online.now = () => clock.t;
  E.Online.use(hub.endpoint(id));
  const sim = { chassis: { x: 0, y: 0, h: 0 }, footprint: { hx: 0.2286, hy: 0.2286, ox: 0, oy: 0 }, obstacles: E.Field.obstacles(0.4), vel: { x: 0, y: 0 } };
  const events = [];
  E.Online.onChange((what, data) => events.push({ what, data }));
  return { E, O: E.Online, M: E.Match, F: E.Field, clock, sim, events, id };
}
/* Everyone steps 20 ms; the network delivers what was sent. */
function run(hub, pcs, seconds, each) {
  for (let i = 0; i < Math.round(seconds / 0.02); i++) {
    for (const pc of pcs) pc.clock.t += 20;
    for (const pc of pcs) { if (each) each(pc, i); pc.O.step(0.02, pc.sim); }
    hub.flush();
  }
}
/* Everyone at their place, the way the app puts a robot there at START. */
function placeAll(pcs) {
  for (const pc of pcs) { const s = pc.O.mySlot(); if (s) { const p = pc.E.netSlotPose(s, pc.sim.footprint); pc.sim.chassis = { x: p.x, y: p.y, h: p.h }; } }
}
/* A host and a guest in one room, both ready for a period, and the match started. */
function twoInAMatch(net, period = 'TeleOp', o = {}) {
  const H = computer(net, 'host'), G = computer(net, 'guest', o.skew || 0);
  H.O.host({ name: 'Team 111', period, skill: 'typical' });
  G.O.join(H.O.code, { name: 'Team 222' });
  net.flush();
  G.O.pick(o.guestSlot || 'red2'); net.flush();
  H.O.setReady(true, period); G.O.setReady(true, period); net.flush();
  assert.ok(H.O.start(), 'the host can start: ' + H.O.waitingFor().join('; '));
  net.flush();
  placeAll([H, G]);
  return { H, G };
}

test('online: a public match shows up in the lobby, a guest joins it by its code and gets a free place', () => {
  const hub = loadWithField().netLoopback();
  const H = computer(hub, 'h'), B = computer(hub, 'b');
  B.O.browse();
  H.O.host({ name: 'Team 12345', pub: true, period: 'TeleOp' });
  hub.flush();
  const open = B.O.openMatches();
  assert.equal(open.length, 1);
  assert.equal(open[0].code, H.O.code);
  assert.equal(open[0].name, "Team 12345's match");
  assert.equal(open[0].open, 3, 'three places left');
  assert.ok(/^[A-HJ-NP-Z2-9]{5}$/.test(H.O.code), 'a 5-letter code with no 0/O or 1/I');
  assert.ok(B.O.join(open[0].code, { name: 'Team 999', hid: open[0].hid }));
  hub.flush();
  assert.equal(B.O.state, 'room');
  assert.equal(B.O.hostId, 'h');
  assert.deepEqual(Object.values(H.O.players).map((p) => [p.name, p.slot]).sort(), [['Team 12345', 'red1'], ['Team 999', 'red2']]);
  assert.equal(B.O.mySlot(), 'red2', 'the guest sees its own place');
  assert.equal(B.O.lobby, null, 'in a room, a guest has left the lobby');
  // someone else still looking sees two places left
  const C = computer(hub, 'c'); C.O.browse();
  run(hub, [H, B, C], 2.1);
  assert.equal(C.O.ads[H.O.code].open, 2);
  assert.equal(C.O.ads[H.O.code].n, 2);
  // once it starts it isn't open any more
  H.O.setReady(true, 'TeleOp'); B.O.setReady(true, 'TeleOp'); hub.flush();
  assert.ok(H.O.start()); hub.flush();
  assert.equal(C.O.openMatches().length, 0);
});

test('online: places, ready and the right kind of OpMode hold the start; START deals the same match to everyone', () => {
  const hub = loadWithField().netLoopback();
  const H = computer(hub, 'h'), G = computer(hub, 'g'), W = computer(hub, 'w');
  H.O.host({ name: 'Host', period: 'TeleOp', skill: 'elite' });
  G.O.join(H.O.code, { name: 'Guest' }); hub.flush();
  G.O.pick('blue1'); hub.flush();
  assert.equal(H.O.players.g.slot, 'blue1');
  W.O.join(H.O.code, { name: 'Watcher' }); hub.flush();
  W.O.pick(null); hub.flush();
  W.O.pick('blue1'); hub.flush();                                  // taken: no
  assert.equal(H.O.players.w.slot, null);
  assert.ok(!H.O.canStart());
  H.O.setReady(true, 'TeleOp'); G.O.setReady(true, 'Autonomous'); hub.flush();
  assert.ok(!H.O.canStart());
  assert.match(H.O.waitingFor().join(), /Guest has an Autonomous OpMode selected/);
  G.O.setReady(true, 'TeleOp'); hub.flush();
  assert.ok(H.O.canStart());
  assert.ok(H.O.start()); hub.flush();
  for (const pc of [H, G, W]) {
    assert.equal(pc.O.state, 'playing');
    assert.equal(pc.M.period, 'TeleOp');
    assert.equal(pc.M.skill, 'elite');
    assert.deepEqual(pc.M.bots.map((b) => [b.id, b.name, b.place]), [['ai1', 'Red 2 (AI)', 'red2'], ['ai2', 'Blue 2 (AI)', 'blue2']], 'AI robots only in the empty places');
    assert.deepEqual(pc.M.floor.map((e) => [e.id, e.kind, e.x.toFixed(4), e.y.toFixed(4)]), H.M.floor.map((e) => [e.id, e.kind, e.x.toFixed(4), e.y.toFixed(4)]), 'the same field, from the same seed');
  }
  assert.equal(W.O.mySlot(), null, 'no place: watching');
  assert.ok(W.M.noUser);
  assert.ok(G.M.mirror && !H.M.mirror);
  assert.ok(G.events.some((e) => e.what === 'start' && e.data.slot === 'blue1' && e.data.al === 'blue'));
});

test('online: one clock. A guest whose computer runs 7 s fast still starts with the host', () => {
  const hub = loadWithField().netLoopback();
  const { H, G } = twoInAMatch(hub, 'TeleOp', { skew: 7000 });
  // the start instant, each in its own clock: 7 s apart, the same moment
  assert.ok(Math.abs((G.O.startAt - 7000) - H.O.startAt) < 5, `${G.O.startAt - 7000} vs ${H.O.startAt}`);
  run(hub, [H, G], 3.5);
  assert.ok(H.M.t > 0.4 && Math.abs(G.M.t - H.M.t) < 0.1, `host ${H.M.t.toFixed(2)} s, guest ${G.M.t.toFixed(2)} s`);
});

test('online: each sees the other\'s robot where it is, and the AI robots and the field where the host has them', () => {
  const hub = loadWithField().netLoopback();
  const { H, G } = twoInAMatch(hub);
  run(hub, [H, G], 3.2);                       // the countdown
  // the guest drives up the field; the host sits
  run(hub, [H, G], 6, (pc) => { if (pc === G) { pc.sim.chassis.y += 0.6 * 0.02; pc.sim.vel = { x: 0, y: 0.6 }; } });
  const hp = G.M.players.find((p) => p.id === 'host'), gp = H.M.players.find((p) => p.id === 'guest');
  assert.ok(hp && gp, 'each has the other');
  assert.ok(Math.hypot(hp.x - H.sim.chassis.x, hp.y - H.sim.chassis.y) < 0.02, 'the host robot, on the guest');
  assert.ok(Math.hypot(gp.x - G.sim.chassis.x, gp.y - G.sim.chassis.y) < 0.08, 'the guest robot, on the host (a moving one, a step behind)');
  assert.equal(gp.al, 'red'); assert.equal(gp.name, 'Team 222');
  for (const b of H.M.bots) {
    const m = G.M.bots.find((x) => x.id === b.id);
    assert.ok(Math.hypot(m.x - b.x, m.y - b.y) < 0.12, `${b.name}: ${(Math.hypot(m.x - b.x, m.y - b.y) * 100).toFixed(1)} cm off`);
  }
  assert.deepEqual(G.F.hive, H.F.hive);
  assert.deepEqual(G.F.tips, H.F.tips);
  assert.deepEqual(G.M.floor.map((e) => e.id).sort(), H.M.floor.map((e) => e.id).sort());
  assert.deepEqual(G.O.score, H.O.scoreOut(H.M.score(H.sim)));
});

test('online: two robots that meet push each other apart, each computer moving its own', () => {
  const hub = loadWithField().netLoopback();
  const { H, G } = twoInAMatch(hub, 'TeleOp', { guestSlot: 'red2' });
  run(hub, [H, G], 3.2);
  // the guest drives into the host: both hold their line, and they end up side by side
  G.sim.chassis = { x: H.sim.chassis.x, y: H.sim.chassis.y - 0.3, h: 0 };
  const h0 = { ...H.sim.chassis };
  let worst = 0;
  run(hub, [H, G], 2, (pc, i) => {
    if (pc === G) { pc.sim.chassis.y += 0.3 * 0.02; pc.sim.vel = { x: 0, y: 0.3 }; }
    if (i > 40) worst = Math.max(worst, 2 * 0.2286 - Math.abs(G.sim.chassis.y - H.sim.chassis.y));
  });
  assert.ok(worst < 0.04, `they overlap ${(worst * 100).toFixed(1)} cm at most`);
  assert.ok(H.sim.chassis.y - h0.y > 0.1, `the host robot was pushed ${((H.sim.chassis.y - h0.y) * 100).toFixed(0)} cm up the field`);
  assert.ok(G.sim.chassis.y < H.sim.chassis.y, 'and the guest is still behind it');
});

test('online: a guest\'s shot is flown again by the host, decided there, and the guest sees the CELL fill', () => {
  const hub = loadWithField().netLoopback();
  const { H, G } = twoInAMatch(hub);
  run(hub, [H, G], 3.2);
  // the guest robot moves to a spot the AI robots shoot from, and fires what scores from there
  const sp = G.M.spots('red', 'pollen')[0];
  G.sim.chassis = { x: sp.x, y: sp.y, h: sp.yaw * Math.PI / 180 };
  run(hub, [H, G], 0.3);
  const p = G.M.params('red', sp.x, sp.y, 'pollen'), before = H.F.cells.red.length;
  G.O.shot(p, 70, sp.v, sp.yaw);
  hub.flush();
  assert.equal(H.O.players.guest.fired, 1);
  assert.ok(G.M.flying.length === 0, 'the guest doesn\'t get its own ball back');
  run(hub, [H, G], 2.5);
  assert.equal(H.O.players.guest.scored, 1, 'the host counts it for the guest');
  assert.ok(H.F.cells.red.length === before + 1 || H.F.tips.red === 1, 'in the red up-CELL');
  assert.deepEqual(G.F.cells, H.F.cells, 'and the guest sees the same CELLs');
  // one from somewhere the guest robot isn't: not a shot
  const far = G.M.params('red', -sp.x, -sp.y, 'pollen');
  G.O.shot(far, 70, sp.v, sp.yaw); hub.flush();
  assert.equal(H.O.players.guest.fired, 1, 'a shot from 2 m away from the robot is thrown out');
});

test('online: an AUTO to the end: the same final score and each robot\'s shots on both', () => {
  const hub = loadWithField().netLoopback();
  const { H, G } = twoInAMatch(hub, 'Autonomous');
  run(hub, [H, G], 3 + 30.5);
  assert.equal(H.O.state, 'done'); assert.equal(G.O.state, 'done');
  assert.deepEqual(G.O.final.score, H.O.final.score);
  assert.deepEqual(G.O.final.stats.map((s) => [s.slot, s.name, s.fired, s.scored]), H.O.final.stats.map((s) => [s.slot, s.name, s.fired, s.scored]));
  assert.deepEqual(H.O.final.stats.map((s) => s.slot), ['red1', 'red2', 'blue1', 'blue2']);
  assert.ok(H.O.final.stats.filter((s) => s.name.endsWith('(AI)')).every((s) => s.fired >= 1), 'the AI robots played');
  assert.ok(H.O.final.score.blue.leave >= 3, 'LEAVE counts');
  // again: back in the room, same places, nobody ready
  H.O.again(); hub.flush();
  assert.equal(G.O.state, 'room');
  assert.equal(G.O.mySlot(), 'red2');
  assert.ok(!H.O.canStart());
});

test('online: chat to all or to the alliance, marks on the field only for the alliance', () => {
  const hub = loadWithField().netLoopback();
  const H = computer(hub, 'h'), R = computer(hub, 'r'), B = computer(hub, 'b');
  H.O.host({ name: 'Red one' });
  R.O.join(H.O.code, { name: 'Red two' }); B.O.join(H.O.code, { name: 'Blue one' }); hub.flush();
  B.O.pick('blue1'); hub.flush();
  assert.equal(R.O.mySlot(), 'red2');
  H.O.say('good luck everyone'); hub.flush();
  // each computer counts time on its own clock: a second passes on all of them
  const later = () => { for (const pc of [H, R, B]) pc.clock.t += 1000; };
  later(); R.O.say('I\'ll take the far side', true); hub.flush();
  assert.deepEqual(B.O.chat.map((c) => c.text), ['good luck everyone'], 'blue never sees red\'s alliance chat');
  assert.deepEqual(H.O.chat.map((c) => [c.name, c.text, c.team]), [['Red one', 'good luck everyone', false], ['Red two', 'I\'ll take the far side', true]]);
  R.O.mark(0.5, 1, 'shoot'); B.O.mark(0, 0, 'defend'); hub.flush();
  assert.deepEqual(H.O.marks.map((m) => [m.name, m.what]), [['Red two', 'shoot']]);
  assert.equal(B.O.marks.length, 1, 'blue sees only its own mark');
  later(); R.O.say('x'.repeat(5000)); hub.flush();
  assert.equal(H.O.chat.at(-1).text.length, 200, 'a long message is cut');
});

test('online: junk and lies from anyone but the host change nothing, and nothing throws', () => {
  const hub = loadWithField().netLoopback();
  const { H, G } = twoInAMatch(hub);
  const X = hub.endpoint('stranger').join('m-' + H.O.code);
  hub.flush();
  run(hub, [H, G], 3.3);
  const tips = { ...G.F.tips }, bots = G.M.bots.map((b) => b.x);
  // a stranger pretending to be the host
  X.send({ k: 'snap', t: 100, tips: [99, 99], hive: [1, 1], cells: ['nrnrnrnr', ''], bots: [['ai1', 9, 9, 0, 0, 0, '']], floor: [] });
  X.send({ k: 'start', seed: 5, period: 'Autonomous', slots: {}, at: 0 });
  X.send({ k: 'end', score: { red: { total: 999 } } });
  X.send({ k: 'roster', players: [] });
  // and plain junk, to everyone
  for (const m of [null, 42, 'hi', [], { k: 7 }, { k: 'pose', x: 'a', y: NaN }, { k: 'shot', x: 1e99 }, { k: 'chat', text: { a: 1 } },
    { k: 'fly', path: [[1, 2]] }, { k: 'mark', x: Infinity }, { k: 'sync', t0: -5 }, { k: 'hello', proto: 99 }, { k: 'pick', slot: '__proto__' }])
    X.send(m);
  hub.flush();
  run(hub, [H, G], 0.1);
  assert.equal(G.O.state, 'playing');
  assert.deepEqual(G.F.tips, tips);
  assert.equal(G.O.score.red.total < 999, true);
  assert.ok(G.M.bots.every((b, i) => Math.abs(b.x - bots[i]) < 0.5), 'the AI robots stay where the host has them');
  assert.ok(!('stranger' in H.O.players) || H.O.players.stranger.slot === null, 'a stranger never gets a place mid-match');
  // a snap from the real host with nonsense in it is clamped, not believed
  H.O.room.send({ k: 'snap', t: 5, hive: [7, 'x'], tips: [-4, 1e9], cells: [123, 'zz'], bots: 'no', floor: [[1, 'q', 'x', 1e9]], flowers: [5], humans: [[9e9, -1, 'x']], ev: [[1, { a: 1 }, 'green']], score: { red: { total: 'lots' } } });
  hub.flush();
  assert.ok([1, -1].includes(G.F.hive.red) && [1, -1].includes(G.F.hive.blue));
  assert.ok(G.F.tips.blue <= 99 && G.F.tips.red >= 0);
  assert.ok(Math.abs(G.M.floor[0].y) <= G.F.half() + 0.2);
  assert.equal(G.M.humans.red.tray, 5);
  assert.equal(G.O.score.red.total, 0);
});

test('online: the host leaving ends it for the guest, with a reason', () => {
  const hub = loadWithField().netLoopback();
  const { H, G } = twoInAMatch(hub);
  run(hub, [H, G], 1);
  H.O.leave(); hub.flush();
  assert.equal(G.O.state, 'off');
  assert.match(G.O.why, /host left/);
  assert.ok(!G.M.net && !G.M.mirror, 'back to a match on its own');
  assert.ok(G.events.some((e) => e.what === 'error'));
});
