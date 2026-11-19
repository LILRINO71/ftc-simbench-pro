// Spectators and invite links for online matches (src/net.js): joining to watch, the
// limit of eight, no place and no ready for a spectator, the count the drivers see,
// and the link that opens SimBench into the join box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithField } from './load.mjs';

function computer(hub, id) {
  const E = loadWithField(), clock = { t: 1_000_000 };
  E.Online.now = () => clock.t;
  E.Online.use(hub.endpoint(id));
  const sim = { chassis: { x: 0, y: 0, h: 0 }, footprint: { hx: 0.2286, hy: 0.2286, ox: 0, oy: 0 }, obstacles: E.Field.obstacles(0.4), vel: { x: 0, y: 0 } };
  return { E, O: E.Online, M: E.Match, clock, sim, id };
}
function room(hub, o = {}) {
  const H = computer(hub, 'host');
  H.O.host(Object.assign({ name: 'Host', period: 'TeleOp' }, o));
  hub.flush();
  return H;
}

test('spectators: someone who joins to watch gets no place, even with places free, and everyone sees them as watching', () => {
  const hub = loadWithField().netLoopback();
  const H = room(hub), W = computer(hub, 'w');
  assert.ok(W.O.join(H.O.code, { name: 'Fan', watch: true }));
  hub.flush();
  assert.equal(W.O.state, 'room');
  assert.equal(H.O.players.w.slot, null, 'red2, blue1 and blue2 were free, and none was given');
  assert.equal(H.O.players.w.watch, true);
  assert.equal(W.O.me().watch, true);
  assert.equal(W.O.mySlot(), null);
  assert.deepEqual(H.O.watchers().map((p) => p.name), ['Fan']);
  assert.deepEqual(W.O.watchers().map((p) => p.name), ['Fan'], 'the spectator sees it in the roster too');
  // a driver arriving after still gets the first free place
  const G = computer(hub, 'g');
  G.O.join(H.O.code, { name: 'Driver' }); hub.flush();
  assert.equal(G.O.mySlot(), 'red2');
  assert.equal(G.O.me().watch, false);
});

test('spectators: no picking a place, no ready; the host\'s start doesn\'t wait for them', () => {
  const hub = loadWithField().netLoopback();
  const H = room(hub), W = computer(hub, 'w');
  W.O.join(H.O.code, { name: 'Fan', watch: true }); hub.flush();
  W.O.pick('blue1'); hub.flush();
  assert.equal(H.O.players.w.slot, null, 'the spectator asked for a place: refused on its own computer');
  // a modified client that sends the pick anyway
  W.O.room.send({ k: 'pick', slot: 'blue1' }, 'host'); hub.flush();
  assert.equal(H.O.players.w.slot, null, 'and refused by the host');
  W.O.room.send({ k: 'ready', ready: true, kind: 'TeleOp' }, 'host'); hub.flush();
  assert.equal(H.O.players.w.ready, false);
  W.O.setReady(true, 'TeleOp');
  assert.equal(W.O.me().ready, false);
  H.O.setReady(true, 'TeleOp'); hub.flush();
  assert.ok(H.O.canStart(), 'the host alone is ready: ' + H.O.waitingFor().join('; '));
  assert.ok(H.O.start()); hub.flush();
  assert.equal(W.O.state, 'playing');
  assert.equal(W.O.mySlot(), null);
  assert.ok(W.M.noUser, 'no robot of its own on the field');
  assert.ok(W.M.mirror, 'it follows the host\'s match');
  assert.equal(H.O.watchers().length, 1);
});

test('spectators: eight can watch, the ninth is told the places are taken, and a driver can still join', () => {
  const hub = loadWithField().netLoopback();
  const H = room(hub), fans = [];
  for (let i = 0; i < 9; i++) {
    const W = computer(hub, 'w' + i);
    W.O.join(H.O.code, { name: 'Fan ' + i, watch: true, hid: 'host' }); hub.flush();
    fans.push(W);
  }
  assert.equal(H.O.watchers().length, 8);
  assert.equal(fans[7].O.state, 'room');
  assert.equal(fans[8].O.state, 'off', 'the ninth was turned away');
  assert.match(fans[8].O.why, /8 places to watch are taken/);
  assert.equal(Object.keys(H.O.players).length, 9, 'the host and eight');
  const D = computer(hub, 'd');
  D.O.join(H.O.code, { name: 'Driver' }); hub.flush();
  assert.equal(D.O.state, 'room');
  assert.equal(D.O.mySlot(), 'red2');
  // everyone together can't pass four drivers and eight watching
  const more = [];
  for (let i = 0; i < 4; i++) { const X = computer(hub, 'x' + i); X.O.join(H.O.code, { name: 'X' + i, hid: 'host' }); hub.flush(); more.push(X); }
  assert.equal(Object.keys(H.O.players).length, 12);
  assert.equal(more[3].O.state, 'off', 'the room is full at twelve');
  assert.match(more[3].O.why, /full/);
  // a spectator leaving makes room for another
  fans[0].O.leave(); hub.flush();
  assert.equal(H.O.watchers().length, 7);
});

test('spectators: arriving mid-match to watch works, and the drivers count them', () => {
  const hub = loadWithField().netLoopback();
  const H = room(hub), G = computer(hub, 'g');
  G.O.join(H.O.code, { name: 'Driver' }); hub.flush();
  H.O.setReady(true, 'TeleOp'); G.O.setReady(true, 'TeleOp'); hub.flush();
  assert.ok(H.O.start()); hub.flush();
  const W = computer(hub, 'w');
  W.O.join(H.O.code, { name: 'Late fan', watch: true }); hub.flush();
  assert.equal(W.O.state, 'playing', 'straight into the match as it is now');
  assert.equal(W.O.mySlot(), null);
  assert.equal(H.O.watchers().length, 1);
  assert.equal(G.O.watchers().length, 1, 'the other driver hears it too');
  assert.equal(G.O.players.w.watch, true);
});

test('spectators: a driver who has no robot in a running match counts as watching, one in the room does not', () => {
  const hub = loadWithField().netLoopback();
  const H = room(hub), G = computer(hub, 'g');
  G.O.join(H.O.code, { name: 'Driver' }); hub.flush();
  G.O.pick(null); hub.flush();
  assert.equal(H.O.watchers().length, 0, 'in the room, no place yet: not a spectator');
  H.O.setReady(true, 'TeleOp'); hub.flush();
  assert.ok(H.O.start()); hub.flush();
  assert.equal(H.O.watchers().length, 1);
});

test('spectators: the lobby listing says how many are watching', () => {
  const hub = loadWithField().netLoopback();
  const B = computer(hub, 'b'); B.O.browse();
  const H = room(hub, { pub: true, name: 'Team 77' });
  const W = computer(hub, 'w'); W.O.join(H.O.code, { name: 'Fan', watch: true }); hub.flush();
  const ad = B.O.openMatches()[0];
  assert.equal(ad.code, H.O.code);
  assert.equal(ad.w, 1);
  assert.equal(ad.open, 3, 'a spectator takes no place: three left beside the host');
});

test('spectators: a roster from the host can\'t make anyone a spectator on this computer by lying about the flag', () => {
  const hub = loadWithField().netLoopback();
  const G = computer(hub, 'g');
  G.O.join('ABCDE', { name: 'Guest' });
  G.O.hostId = 'host';
  G.O.onRoster({ players: [{ id: 'g', name: 'Guest', slot: 'red1', watch: 'yes' }, { id: 'p', name: 'P', watch: true }], settings: {} });
  assert.equal(G.O.players.g.watch, false, 'only a real true counts');
  assert.equal(G.O.players.p.watch, true);
});

test('invite links: a join link and a watch link, read back, with a bad code told apart', () => {
  const O = loadWithField().Online;
  O.code = 'K7QMX';
  assert.equal(O.inviteLink('https://ftc-simbench-pro.pages.dev/', false), 'https://ftc-simbench-pro.pages.dev/#join=K7QMX');
  assert.equal(O.inviteLink('https://x.test/app#join=OLD12', true), 'https://x.test/app#watch=K7QMX', 'an old fragment is replaced');
  assert.deepEqual(O.parseInvite('#join=k7qmx'), { code: 'K7QMX', watch: false });
  assert.deepEqual(O.parseInvite('#watch=K7QMX'), { code: 'K7QMX', watch: true });
  assert.equal(O.parseInvite('#path=abc'), null);
  assert.equal(O.parseInvite(''), null);
  const bad = O.parseInvite('#join=K7');
  assert.equal(bad.bad, true);
  assert.equal(bad.code, 'K7');
  assert.equal(O.parseInvite('#join=K7QM0').bad, true, 'a 0 is never in a code');
  O.code = null;
  assert.equal(O.inviteLink('https://x.test/', false), '', 'no room, no link');
});
