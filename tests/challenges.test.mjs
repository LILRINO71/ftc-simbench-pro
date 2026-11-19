// The guided challenges (src/challenges.js): each card's completion check, against a snapshot of what
// the simulator holds (pose, speed, devices, the field's own LOADING ZONES and HIVEs), and the cards'
// progress. The last test plays all four on the real simulator, steering with the touch model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadWithField, loadShotEngine, sampleBench, run } from './load.mjs';

const E = loadEngine();
const F = loadShotEngine().data.field;
const IN = 0.0254, DEG = Math.PI / 180;
const FP = { hx: 0.2286, hy: 0.2286, ox: 0, oy: 0 };

// a stand-in for the live Sim: the chassis, how it moves and the devices the code declared
function simAt(p) {
  return Object.assign({ phase: 'running', t: 5, chassis: { x: 0, y: 0, h: 0 }, vel: { x: 0, y: 0 }, footprint: FP,
    code: { devices: [] }, dev: {} }, p);
}
const snapOf = (p, al = 'red') => E.chalSnapshot(simAt(p), F, al);
const at = (x, y, h = 0, extra = {}) => snapOf(Object.assign({ chassis: { x: x * IN, y: y * IN, h: h * DEG } }, extra));

test('snapshot: the field in metres, from the field data, and the devices that are not the drivetrain', () => {
  const s = E.chalSnapshot(simAt({
    code: { devices: [{ name: 'leftFront', type: 'DcMotor' }, { name: 'claw', type: 'Servo' }] },
    dev: { leftFront: { kind: 'motor', act: 0.2, ticks: 10 }, claw: { kind: 'servo', act: 0.4, ticks: 0 } } }), F, 'blue');
  assert.equal(s.al, 'blue');
  assert.equal(s.running, true);
  assert.ok(Math.abs(s.half - 70.5 * IN) < 1e-9 && Math.abs(s.tile - 23.5 * IN) < 1e-9);
  assert.ok(Math.abs(s.zones.red.x0 - -70.5 * IN) < 1e-9 && Math.abs(s.zones.blue.y0 - -46.6 * IN) < 1e-9);
  assert.ok(Math.abs(s.hives.red.x - -12.75 * IN) < 1e-9 && s.hives.blue.x > 0);
  assert.deepEqual(s.devs.map((d) => [d.name, d.drive]), [['leftFront', true], ['claw', false]]);
  assert.equal(E.chalSnapshot(simAt({ phase: 'init' }), F, 'red').running, false, 'only a running OpMode counts');
  assert.equal(E.chalSnapshot(simAt({ phase: 'stopped' }), F, 'red').phase, 'stopped');
});

test('snapshot: the box is where the footprint really is, off the drivetrain centre along the heading', () => {
  const s = snapOf({ chassis: { x: 0, y: 0, h: Math.PI / 2 }, footprint: { hx: 0.2, hy: 0.2, ox: 0.1, oy: 0 } });
  assert.ok(Math.abs(s.box.x) < 1e-9 && Math.abs(s.box.y - 0.1) < 1e-9);
});

test('far tile: the last row of tiles on the other alliance\'s wall, counted from START', () => {
  const st = {};
  let r = E.chalFar(at(-61, 0), st);
  assert.equal(r.done, false);
  assert.equal(r.note, '108 in to go', 'from the start, 47 in is where the last row begins');
  assert.equal(r.progress, 0);
  r = E.chalFar(at(-7, 0), st);
  assert.equal(r.done, false);
  assert.ok(r.progress > 0.45 && r.progress < 0.55, 'half way: ' + r.progress);
  r = E.chalFar(at(46.9, 20), st);
  assert.equal(r.done, false, 'one tile edge is the line: not yet');
  r = E.chalFar(at(47.1, 20), st);
  assert.equal(r.done, true);
});

test('far tile: blue goes the other way, and nothing counts before START', () => {
  const st = {};
  assert.equal(E.chalFar(snapOf({ chassis: { x: 61 * IN, y: 0, h: Math.PI } }, 'blue'), st).done, false);
  assert.equal(E.chalFar(snapOf({ chassis: { x: -48 * IN, y: 0, h: Math.PI } }, 'blue'), st).done, true, 'blue reaches the red wall\'s tiles');
  assert.equal(E.chalFar(snapOf({ chassis: { x: 60 * IN, y: 0, h: 0 } }, 'blue'), {}).done, false, 'its own wall is not the far one');
  const idle = E.chalFar(snapOf({ phase: 'init', chassis: { x: 60 * IN, y: 0, h: 0 } }), {});
  assert.equal(idle.done, false);
  assert.match(idle.note, /START/);
  assert.match(E.chalFar(snapOf({ phase: 'stopped' }), {}).note, /INIT, then START/, 'after STOP it has to be started again');
});

test('face a HIVE: a turn of 30 degrees away first, then the front within 10 degrees, held half a second', () => {
  const st = {};
  // standing at (30, 20) in; the blue HIVE is at (12.75, 0)
  const toward = Math.atan2(-20, 12.75 - 30) / DEG;
  let r = E.chalFace(at(30, 20, toward, { t: 1 }), st);
  assert.equal(r.done, false, 'already facing it when the card came up does not count');
  assert.match(r.note, /away/i);
  r = E.chalFace(at(30, 20, toward + 20, { t: 1.1 }), st);
  assert.equal(r.done, false);
  assert.match(r.note, /away/i, '20 degrees off is not far enough to arm it');
  r = E.chalFace(at(30, 20, toward + 90, { t: 1.2 }), st);
  assert.equal(r.done, false);
  assert.match(r.note, /^Turn (left|right) 90°$/);
  r = E.chalFace(at(30, 20, toward + 5, { t: 2 }), st);
  assert.equal(r.done, false);
  assert.match(r.note, /Hold/);
  r = E.chalFace(at(30, 20, toward + 5, { t: 2.3 }), st);
  assert.equal(r.done, false, '0.3 s is not enough');
  r = E.chalFace(at(30, 20, toward - 6, { t: 2.6 }), st);
  assert.equal(r.done, true, 'held 0.6 s');
});

test('face a HIVE: swinging past it does not count, and the nearer way round is the one it tells you', () => {
  const st = {};
  // standing over the blue HIVE (12.75, 0) at y = 40: it is straight ahead at -90 degrees
  E.chalFace(at(12.75, 40, 0, { t: 1 }), st);                  // armed: facing across the field
  let r = E.chalFace(at(12.75, 40, -50, { t: 1.1 }), st);
  assert.match(r.note, /Turn right 40°/, 'the HIVE is clockwise of the front: turn right');
  // and over the red one, from the other side of it
  const st2 = {};
  E.chalFace(at(-12.75, 40, 0, { t: 1 }), st2);
  r = E.chalFace(at(-12.75, 40, -130, { t: 1.1 }), st2);
  assert.match(r.note, /Turn left 40°/);
  E.chalFace(at(12.75, 40, -87, { t: 2 }), st);
  r = E.chalFace(at(12.75, 40, -60, { t: 2.2 }), st);
  assert.equal(r.done, false, 'it went off before the half second was up');
  r = E.chalFace(at(12.75, 40, -90, { t: 2.3 }), st);
  assert.equal(r.done, false, 'the half second starts again');
  r = E.chalFace(at(12.75, 40, -90, { t: 2.9 }), st);
  assert.equal(r.done, true);
});

test('face a HIVE: either HIVE counts, from either side, and not from on top of one', () => {
  const st = {};
  E.chalFace(at(-40, 10, 180, { t: 1 }), st);                  // armed: facing away from both, red HIVE at -12.75
  const toRed = Math.atan2(-10, -12.75 + 40) / DEG;
  E.chalFace(at(-40, 10, toRed, { t: 2 }), st);
  assert.equal(E.chalFace(at(-40, 10, toRed, { t: 2.6 }), st).done, true, 'the red HIVE');
  const r = E.chalFace(at(-12.75, 0, 0, { t: 3 }), {});
  assert.equal(r.done, false);
  assert.ok(/Back away|Turn away|Turn/.test(r.note));
});

test('move the lift or the claw: what the code settles to at the start is let go; a servo or a motor moving after it counts', () => {
  const dev = (o) => ({ code: { devices: [{ name: 'leftFront', type: 'DcMotor' }, { name: 'claw', type: 'Servo' }, { name: 'lift', type: 'DcMotorEx' }] },
    dev: Object.assign({ leftFront: { kind: 'motor', act: 0, ticks: 0 }, claw: { kind: 'servo', act: 0.3, ticks: 0 }, lift: { kind: 'motor', act: 0, ticks: 0 } }, o) });
  const st = {};
  const S = (t, o) => snapOf(Object.assign({ t }, dev(o)));
  assert.match(E.chalMove(S(1, {}), st).note, /Press A, B, X or Y/);
  // the claw settles to its first position in the first second: not a press
  assert.equal(E.chalMove(S(1.2, { claw: { kind: 'servo', act: 0.5, ticks: 0 } }), st).done, false);
  assert.equal(E.chalMove(S(2.6, { claw: { kind: 'servo', act: 0.5, ticks: 0 } }), st).done, false, 'the base is taken after the settle');
  // the drive wheels turning is not it
  assert.equal(E.chalMove(S(3, { claw: { kind: 'servo', act: 0.5, ticks: 0 }, leftFront: { kind: 'motor', act: 1, ticks: 5000 } }), st).done, false);
  // a little drift in a servo is not it either
  assert.equal(E.chalMove(S(3.2, { claw: { kind: 'servo', act: 0.55, ticks: 0 } }), st).done, false);
  const r = E.chalMove(S(3.5, { claw: { kind: 'servo', act: 0.7, ticks: 0 } }), st);
  assert.equal(r.done, true); assert.equal(r.note, 'claw moved.');
  // and a motor on the lift counts by ticks
  const st2 = {}; E.chalMove(S(1, {}), st2); E.chalMove(S(2.6, {}), st2);
  assert.equal(E.chalMove(S(3, { lift: { kind: 'motor', act: 0.2, ticks: 100 } }), st2).done, false);
  const r2 = E.chalMove(S(3.2, { lift: { kind: 'motor', act: 0.4, ticks: 400 } }), st2);
  assert.equal(r2.done, true); assert.equal(r2.note, 'lift moved.');
});

test('move the lift or the claw: an OpMode with nothing but drive motors says so, and nothing counts before START', () => {
  const only = simAt({ t: 9, code: { devices: [{ name: 'leftFront', type: 'DcMotor' }] }, dev: { leftFront: { kind: 'motor', act: 1, ticks: 9 } } });
  assert.match(E.chalMove(E.chalSnapshot(only, F, 'red'), {}).note, /nothing but the drive/);
  const idle = E.chalMove(E.chalSnapshot(simAt({ phase: 'init' }), F, 'red'), {});
  assert.equal(idle.done, false); assert.match(idle.note, /START/);
});

test('park: any part of the robot over its own LOADING ZONE, stopped there for a second', () => {
  // the red zone: x -70.5 to -59.5 in, y 23.9 to 46.6 in
  const st = {};
  let r = E.chalPark(at(-40, 0, 0, { t: 1 }), st);
  assert.equal(r.done, false);
  assert.match(r.note, /^\d+ in from your LOADING ZONE$/);
  r = E.chalPark(at(-58, 35, 0, { t: 2 }), st);                // the front just over the line (box half 9 in)
  assert.equal(r.done, false);
  assert.match(r.note, /Hold still/);
  r = E.chalPark(at(-58, 35, 0, { t: 2.5 }), st);
  assert.equal(r.done, false, 'half a second');
  r = E.chalPark(at(-58, 35, 0, { t: 3.1 }), st);
  assert.equal(r.done, true);
});

test('park: driving through does not count, and the hold starts again if it moves; blue\'s zone is on the other wall', () => {
  const st = {};
  E.chalPark(at(-60, 35, 0, { t: 1 }), st);
  let r = E.chalPark(at(-60, 35, 0, { t: 1.6, vel: { x: 0.5, y: 0 } }), st);
  assert.equal(r.done, false); assert.match(r.note, /Stop/);
  r = E.chalPark(at(-60, 35, 0, { t: 2.2 }), st);
  assert.equal(r.done, false, 'the second began again at 2.2 s');
  r = E.chalPark(at(-60, 35, 0, { t: 3.3 }), st);
  assert.equal(r.done, true);
  // red's zone is no use to blue
  assert.equal(E.chalPark(snapOf({ chassis: { x: -60 * IN, y: 35 * IN, h: 0 }, t: 9 }, 'blue'), {}).done, false);
  const b = {};
  E.chalPark(snapOf({ chassis: { x: 62 * IN, y: -35 * IN, h: Math.PI }, t: 1 }, 'blue'), b);
  assert.equal(E.chalPark(snapOf({ chassis: { x: 62 * IN, y: -35 * IN, h: Math.PI }, t: 2.2 }, 'blue'), b).done, true);
  assert.equal(E.chalPark(snapOf({ phase: 'stopped', chassis: { x: -60 * IN, y: 35 * IN, h: 0 }, t: 9 }), {}).done, false, 'not after STOP');
});

test('park: the footprint is turned with the robot, not taken as a square on the axes', () => {
  // a long robot (hx 0.4) turned to face +y reaches 0.4 m up the y axis and 0.2 m along x
  const z = F.loadingZones.red, midY = (z.y0 + z.y1) / 2 * IN;
  const just = (y) => E.chalSnapshot(simAt({ chassis: { x: -1.65, y, h: Math.PI / 2 }, footprint: { hx: 0.4, hy: 0.15, ox: 0, oy: 0 } }), F, 'red');
  const st = {};
  assert.match(E.chalPark(just(z.y0 * IN - 0.38), st).note, /Hold|Stop/, 'the nose is in');
  assert.match(E.chalPark(just(z.y0 * IN - 0.45), {}).note, /in from/, 'the nose is not');
  assert.ok(midY > 0);
});

test('cards: the first not done or skipped is on show; marking is on a copy; saved progress is read back safely', () => {
  const ids = E.CHALLENGES.map((c) => c.id);
  assert.deepEqual(ids, ['far', 'face', 'move', 'park']);
  assert.equal(E.chalNext(null).id, 'far');
  let p = E.chalMark(null, 'far', 'done');
  assert.equal(E.chalNext(p).id, 'face');
  p = E.chalMark(p, 'face', 'skipped');
  assert.equal(E.chalNext(p).id, 'move');
  const q = E.chalMark(p, 'move', 'done');
  assert.deepEqual(p.done, { far: 1 }, 'the earlier progress was not changed');
  assert.equal(E.chalNext(E.chalMark(q, 'park', 'done')), null, 'all four taken');
  assert.deepEqual(E.chalMark(p, 'far', 'nonsense').done, { far: 1 }, 'unknown kinds change nothing');
  const s = E.chalLoad(JSON.stringify({ done: { far: 1, bogus: 1 }, skipped: { park: true, face: 0 }, on: 1, closed: 0 }));
  assert.deepEqual(s.done, { far: 1 }); assert.deepEqual(s.skipped, { park: 1 }); assert.equal(s.on, true); assert.equal(s.closed, false);
  assert.deepEqual(E.chalLoad('{not json'), { done: {}, skipped: {}, on: false, closed: false });
  assert.deepEqual(E.chalLoad('null'), { done: {}, skipped: {}, on: false, closed: false });
});

test('cards: each has a plain title and goal, in the game\'s own words', () => {
  for (const c of E.CHALLENGES) {
    assert.ok(c.title.length > 8 && c.title.length < 40, c.id + ' title');
    assert.ok(c.goal.length > 20 && c.goal.length < 140, c.id + ' goal');
    assert.equal(typeof c.check, 'function');
    assert.ok(!/[\u{1F300}-\u{1FAFF}✅✔✨]/u.test(c.title + c.goal), c.id + ' has no emoji');
  }
  assert.match(E.CHALLENGES[1].title, /HIVE/);
  assert.match(E.CHALLENGES[3].title, /LOADING ZONE/);
});

// ---- all four, on the real simulator, steered by the touch model ----
test('on the simulator: a driver on the touch controls plays all four cards', () => {
  const Ef = loadWithField();
  const { cad, code, map, opts } = sampleBench(Ef, Ef.DRIVE_JAVA);
  const start = Ef.Field.startPose('red', { hx: 0.2286, hy: 0.2286 }, 'centre');
  Ef.Sim.reset(code, cad, map, Object.assign({ startPose: start }, opts));
  const fieldData = Ef.Field.data.field;
  const model = Ef.touchModel(), routes = {};
  let was = null;
  const L = { cx: 100, cy: 400, r: 60 }, R = { cx: 700, cy: 400, r: 60 };
  // a thumb: where on the stick (-1..1 of the reach) it rests
  const thumb = (id, ctl, g, x, y) => { model.up(id); if (x || y) { model.down(id, ctl, g.cx + x * g.r, g.cy + y * g.r, g); } };
  const press = (ctl, on) => { if (on) model.down(99, ctl); else model.up(99); };
  const steer = (fwd, turn) => {                                // fwd -1..1 (1 is forward), turn -1..1 (1 is left, counter-clockwise)
    thumb(1, 'left', L, 0, -fwd);
    thumb(2, 'right', R, -turn, 0);
  };
  const state = {};
  const tick = (name) => {                                      // 20 times a second, the way the page asks
    const snap = Ef.chalSnapshot(Ef.Sim, fieldData, 'red');
    return Ef.CHALLENGES.find((c) => c.id === name).check(snap, state[name] || (state[name] = {}));
  };
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const go = (name, seconds, aim) => {                          // aim(): {fwd, turn} for this moment
    for (let i = 0; i < seconds * 20; i++) {
      const a = aim(); steer(a.fwd, a.turn);
      const now = model.state(); Ef.touchWrite(Ef.Sim.pad, routes, now, (c) => (c.startsWith('dpad') ? 2 : 1), was); was = now;
      run(Ef, 0.05);
      const r = tick(name);
      if (r.done) return r;
    }
    return tick(name);
  };
  // toward a point: turn onto the bearing, drive when roughly on it
  const toward = (x, y) => () => {
    const c = Ef.Sim.chassis, err = wrap(Math.atan2(y - c.y, x - c.x) - c.h);
    return { turn: Math.max(-1, Math.min(1, err * 2)), fwd: Math.abs(err) < 0.5 ? 1 : 0 };
  };
  const face = (x, y) => () => { const c = Ef.Sim.chassis, err = wrap(Math.atan2(y - c.y, x - c.x) - c.h); return { turn: Math.max(-1, Math.min(1, err * 1.5)), fwd: 0 }; };
  const still = () => ({ fwd: 0, turn: 0 });
  run(Ef, 0.2);

  // 1. around the HIVEs, along y = 0.9 m, to the last row of tiles
  const way = [[-1.0, 0.95], [0.9, 0.95], [1.3, 0.95]];
  let r = null;
  for (const [x, y] of way) { r = go('far', 14, toward(x, y)); if (r.done) break; }
  assert.ok(r.done, 'on the far tile; pose ' + JSON.stringify(Ef.Sim.chassis) + ' ' + r.note);
  go('far', 0.3, still);

  // 2. turn to face the blue HIVE from there
  r = go('face', 12, face(0.324, 0));
  assert.ok(r.done, 'facing a HIVE; ' + r.note);

  // 3. press D-pad up on gamepad 2: the lift servo goes up
  tick('move');
  go('move', 1.6, still);
  model.down(98, 'dpad_up');
  r = go('move', 3, still);
  model.up(98);
  assert.ok(r.done, 'the lift moved; ' + r.note);

  // 4. back along the same line to the red wall, and into the LOADING ZONE
  const home = [[0.9, 0.95], [-1.0, 0.95], [-1.62, 0.9]];
  r = null;
  for (const [x, y] of home) { r = go('park', 16, toward(x, y)); if (r.done) break; }
  r = go('park', 6, still);
  assert.ok(r.done, 'parked; ' + r.note + ' ' + JSON.stringify(Ef.Sim.chassis));
});
