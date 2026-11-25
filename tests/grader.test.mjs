// The auto grader (src/grader.js) and share-by-link (src/pedrogen.js pathLinkEncode/Decode),
// each on synthetic input whose answer is known by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithField } from './load.mjs';

const E = loadWithField();
const IN = 0.0254;
const fp = { hx: 0.2286, hy: 0.2286, ox: 0, oy: 0, h: 0.4 };       // an 18 in robot
const field = E.Field.data.field;
const obs = E.Field.obstacles(fp.h);
const grade = (P, o) => E.gradePath(P, Object.assign({ fp, field, obs }, o || {}));
const leg = (x, y, h = 0, extra = {}) => Object.assign({ to: { x, y, h }, ctrl: [], heading: 'linear', reversed: false, wait: 0 }, extra);
// Pedro inches: the bench's field moved by 72. Red's alliance wall is at x = 72 - 70.5 = 1.5, so an 18 in robot
// touching it stands at x = 10.5, in the middle of the wall (y = 72), facing +x.
const RED = { x: 10.5, y: 72, h: 0 };
const sev = (g, key) => (g.items.find((i) => i.key === key || i.key.startsWith(key + ':')) || {}).sev;

test('grader: a short drive off the wall is clean, and says what it can and cannot tell', () => {
  const g = grade({ start: RED, legs: [leg(10.5, 100, 0)] });
  assert.ok(g.ok); assert.equal(g.fail, 0);
  for (const k of ['field', 'structures', 'start', 'time']) assert.equal(sev(g, k), 'pass', k);
  const pts = g.items.find((i) => i.key === 'points').text;
  assert.match(pts, /TIPs, CELLs and FLOWERs are not estimated/);
  // from driving alone only: ends in the red LOADING ZONE (parks +5), still against the field's wall (no leave)
  assert.equal(g.points.total, g.points.park + g.points.leave);
  // the same path, the same list: it is deterministic
  assert.deepEqual(grade({ start: RED, legs: [leg(10.5, 100, 0)] }), g);
});

test('grader: leaving the field is a fail, with how far', () => {
  const g = grade({ start: RED, legs: [leg(10.5, 100, 0), leg(10.5, 150, 0)] });
  assert.equal(sev(g, 'field'), 'fail'); assert.ok(!g.ok);
  assert.match(g.items.find((i) => i.key === 'field').text, /Leg 2 puts the robot through the wall: its box goes [\d.]+ in past/);
  // an end inside the walls with the robot's own width counted: 6 in from the wall is NOT enough for a 9 in half width
  const near = grade({ start: RED, legs: [leg(10.5, 138, 0)] });     // the box edge would be 3 in past the wall
  assert.equal(sev(near, 'field'), 'fail');
});

test('grader: driving through a HIVE is a fail naming it; around it is clean', () => {
  const through = grade({ start: RED, legs: [leg(70, 72, 0)] });
  assert.equal(sev(through, 'structures'), 'fail');
  assert.match(through.items.find((i) => i.key === 'structures').text, /Leg 1 runs into the HIVE/);
  const around = grade({ start: RED, legs: [leg(30, 120, 0), leg(110, 120, 0)] });
  assert.equal(sev(around, 'structures'), 'pass');
});

test('grader: a path that waits past 30 s fails on time, and the points are those where the period ends', () => {
  const g = grade({ start: RED, legs: [leg(18, 100, 0, { wait: 15 }), leg(18, 112, 0, { wait: 14 })] });
  assert.equal(sev(g, 'time'), 'fail');
  assert.ok(g.time.total > 30 && g.time.waits === 29);
  // at 30 s the robot is on the second leg's end (it finished driving at ~2.5 s) and parked in the zone
  assert.equal(g.points.park, 5);
  // 28 s of waits in a 30 s period is tight, not over
  const tight = grade({ start: RED, legs: [leg(10.5, 100, 0, { wait: 26.5 })] });
  assert.equal(sev(tight, 'time'), 'warn');
  assert.equal(sev(grade({ start: RED, legs: [leg(10.5, 100, 0)] }), 'time'), 'pass');
});

test('grader: points are only the ones the app\'s scoring model computes (leave, park); a leave needs the robot off every wall', () => {
  const MP = E.MATCH_PTS || { leave: 3, parkAuto: 5 };
  // out to the middle of the red half: off the wall, not in the zone
  const out = grade({ start: RED, legs: [leg(30, 100, 0)] });
  assert.equal(out.points.leave, MP.leave); assert.equal(out.points.park, 0);
  // along the wall into the zone, staying against the wall: parks, no leave
  const park = grade({ start: RED, legs: [leg(10.5, 100, 0)] });
  assert.equal(park.points.leave, 0); assert.equal(park.points.park, MP.parkAuto);
  assert.ok(!('tip' in out.points) && !('cell' in out.points), 'no TIP or CELL numbers are made up');
});

test('grader: the start pose is held to the season: own side, the wall, facing the field, clear of the LOADING ZONE and the start cube', () => {
  assert.equal(sev(grade({ start: RED, legs: [leg(10.5, 100)] }), 'start'), 'pass');
  const mid = grade({ start: { x: 60, y: 72, h: 0 }, legs: [leg(60, 100)] });
  assert.equal(sev(mid, 'start'), 'warn'); assert.match(mid.items.find((i) => i.key === 'start').text, /off your alliance wall/);
  const turned = grade({ start: { x: 10.5, y: 72, h: 90 }, legs: [leg(10.5, 100, 90)] });
  assert.match(turned.items.find((i) => i.key === 'start').text, /off the field/);
  // red's LOADING ZONE is 11 in deep against the red wall, y 23.9..46.6 in the bench frame: Pedro y 95.9..118.6
  const zone = grade({ start: { x: 10.5, y: 100, h: 0 }, legs: [leg(30, 100)] });
  assert.equal(sev(zone, 'start'), 'fail'); assert.match(zone.items.find((i) => i.key === 'start').text, /LOADING ZONE/);
  // the other alliance's wall: a blue start is judged as blue
  const blue = grade({ start: { x: 133.5, y: 72, h: 180 }, legs: [leg(133.5, 44, 180)] });
  assert.equal(sev(blue, 'start'), 'pass');
  // an 20 in robot does not fit the 18 in start cube
  const big = grade({ start: RED, legs: [leg(30, 72)] }, { fp: { hx: 0.254, hy: 0.254, ox: 0, oy: 0, h: 0.4 } });
  assert.equal(big.items.find((i) => i.key === 'start').sev, 'warn'); assert.match(big.items.find((i) => i.key === 'start').text, /past the 18 in start cube/);
  // every start line that rests on a rule says so
  assert.match(grade({ start: RED, legs: [leg(30, 72)] }).items.find((i) => i.key === 'start').text, /check the current manual/);
});

test('grader: a tight bend at speed and a pass along a wall are risks; a straight line is not', () => {
  // an S-curve whose control points fold the leg back on itself: a very small radius at speed
  const sharp = grade({ start: { x: 30, y: 72, h: 0 }, legs: [leg(40, 72, 0, { ctrl: [[60, 72], [10, 80]] })] });
  assert.ok(sharp.items.some((i) => /^risk/.test(i.key) && /bends with a [\d.]+ in radius/.test(i.text)), sharp.items.map((i) => i.text).join('\n'));
  const wall = grade({ start: RED, legs: [leg(40, 100, 0), leg(40, 134, 0)] });
  assert.ok(wall.items.some((i) => /^risk/.test(i.key) && /within [\d.]+ in of a wall/.test(i.text)));
  const calm = grade({ start: RED, legs: [leg(40, 72, 0), leg(40, 100, 0)] });
  assert.equal(sev(calm, 'risks'), 'pass');
  // a turn-limited leg is said so
  const spin = grade({ start: RED, legs: [leg(12, 72, 180)] });
  assert.ok(spin.items.some((i) => /limited by the turn/.test(i.text)));
});

test('grader: no legs, or no field loaded, says so instead of guessing', () => {
  const none = E.gradePath({ start: RED, legs: [] }, {});
  assert.equal(none.fail, 1); assert.ok(!none.ok);
  const bare = E.gradePath({ start: RED, legs: [leg(10.5, 100)] }, { fp });
  assert.equal(bare.items.find((i) => i.key === 'structures').sev, 'warn');
  assert.equal(bare.items.find((i) => i.key === 'start').sev, 'warn');
  assert.equal(bare.items.find((i) => i.key === 'points').sev, 'warn');
  assert.equal(bare.points, null);
});

// ---------------- links ----------------
const PATH = { format: E.PEDRO_FORMAT, v: 1, name: 'Red near 3', start: { x: 10.5, y: 72, h: 0 }, legs: [
  { to: { x: 36, y: 72, h: 0 }, ctrl: [], heading: 'constant', reversed: false, wait: 0.5 },
  { to: { x: 30, y: 110, h: 90 }, ctrl: [[38, 95]], heading: 'linear', reversed: true, wait: 0 },
  { to: { x: 60, y: 120, h: 135 }, ctrl: [[40, 120], [50, 100]], heading: 'tangent', reversed: false, wait: 2 } ] };

test('path link: encodes versioned, compact and URL-safe; opens to the same path, with what it was drawn for', async () => {
  const code = await E.pathLinkEncode(PATH, { field: 'biobuzz', robot: [17.5, 17.9] });
  assert.match(code, /^p1=[zj][A-Za-z0-9_-]+$/);
  assert.ok(code.length < 300, code.length + ' characters');
  const r = await E.pathLinkDecode('#' + code);
  assert.deepEqual(r.path, E.pedroClean(PATH));
  assert.equal(r.field, 'biobuzz'); assert.deepEqual(r.robot, [17.5, 17.9]); assert.equal(r.v, 1);
  // with the address in front, or without the hash
  assert.deepEqual((await E.pathLinkDecode('https://x.pages.dev/app/#' + code)).path, r.path);
  assert.deepEqual((await E.pathLinkDecode(code)).path, r.path);
  // no meta is fine
  const bare = await E.pathLinkDecode(await E.pathLinkEncode(PATH));
  assert.equal(bare.field, null); assert.equal(bare.robot, null);
});

test('path link: a plain (j) link, with no CompressionStream, opens the same; links made on the old #path= format still open', async () => {
  const z = await E.pathLinkEncode(PATH, { field: 'biobuzz' });
  const saved = globalThis.CompressionStream;
  try {
    globalThis.CompressionStream = undefined;
    const plain = await E.pathLinkEncode(PATH, { field: 'biobuzz' });
    assert.match(plain, /^p1=j/);
    assert.deepEqual((await E.pathLinkDecode(plain)).path, (await E.pathLinkDecode(z)).path);
  } finally { globalThis.CompressionStream = saved; }
  const old = 'path=' + E.pedroToHash(PATH);
  assert.deepEqual((await E.pathLinkDecode('#' + old)).path, E.pedroClean(PATH));
});

test('path link: a link carries the numbers only, nothing personal', async () => {
  const code = await E.pathLinkEncode(Object.assign({}, PATH, { name: 'Red near 3', owner: 'Pat', email: 'pat@example.com' }), { field: 'biobuzz', robot: [18, 18], team: 'Team 1234' });
  const { inflateSync } = await import('node:zlib');
  const raw = Buffer.from(code.slice(4), 'base64url');            // after "p1=z"
  const json = JSON.parse(inflateSync(raw).toString());
  assert.deepEqual(Object.keys(json).sort(), ['f', 'l', 'n', 'r', 's'], 'path name, start, legs, field, robot size: nothing else goes in');
  assert.ok(!/Pat|pat@example|Team 1234/.test(JSON.stringify(json)));
  const dec = await E.pathLinkDecode(code);
  assert.deepEqual(Object.keys(dec).sort(), ['field', 'path', 'robot', 'v']);
  assert.ok(!/Pat|pat@example|Team 1234/.test(JSON.stringify(dec)));
});

test('path link: malformed, hostile and too-big links fail with a message, never a crash or a wild path', async () => {
  const bad = ['', '#', '#p1=', '#p1=z', '#p1=!!!', '#p1=zAAAA', '#p1=j' + Buffer.from('not json').toString('base64url'),
    '#p1=j' + Buffer.from('{"s":[1],"l":5}').toString('base64url'), '#p1=j' + Buffer.from('{"s":[1,2,3],"l":[null]}').toString('base64url'),
    '#p9=zAAAA', '#hello', '#path=nope'];
  for (const b of bad) await assert.rejects(E.pathLinkDecode(b), (e) => e instanceof Error && e.message.length > 5, JSON.stringify(b));
  await assert.rejects(E.pathLinkDecode('#p1=j' + 'A'.repeat(13000)), /too long/);
  await assert.rejects(E.pathLinkDecode('#p2=zAAAA'), /newer version/);
  // a hand-made link with far-off numbers is pulled onto the field and capped at 40 legs
  const evil = '#p1=j' + Buffer.from(JSON.stringify({ n: '<img onerror=x>', s: [1e9, -1e9, 5], l: Array.from({ length: 80 }, () => [999, 2, 0, 7, 1, 99, [[1, 2]]]) })).toString('base64url');
  const r = await E.pathLinkDecode(evil);
  assert.equal(r.path.name, 'img onerrorx'); assert.equal(r.path.start.x, 180); assert.equal(r.path.legs.length, 40);
  // a small deflate stream that unpacks to a lot is stopped (a zip bomb)
  const { deflateSync } = await import('node:zlib');
  const bomb = '#p1=z' + deflateSync(Buffer.alloc(5_000_000, 0x20)).toString('base64url');
  assert.ok(bomb.length < 12000, 'the bomb itself is small: ' + bomb.length);
  await assert.rejects(E.pathLinkDecode(bomb), /far more than a path/);
});
