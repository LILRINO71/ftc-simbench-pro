// Zero-config drivetrain detection from the CAD, and the kinematics it hands
// the simulator. Every wheel here is a real cylinder of points, so the tests
// go through the same PCA the app does — nothing is hand-fed an axle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const D2R = Math.PI / 180;

const unit = (v) => { const L = Math.hypot(v[0], v[1], v[2]); return [v[0] / L, v[1] / L, v[2] / L]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// A cylinder's surface as points: three rings of n, like a wheel's rim.
function cylPts(c, axis, r, h, n = 120) {
  const a = unit(axis);
  const u = unit(cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const v = cross(a, u);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
    for (const s of [-h / 2, 0, h / 2])
      pts.push([c[0] + u[0] * cs + v[0] * sn + a[0] * s,
                c[1] + u[1] * cs + v[1] * sn + a[1] * s,
                c[2] + u[2] * cs + v[2] * sn + a[2] * s]);
  }
  return pts;
}
const wheel = (name, c, axis, r = 0.048, h = 0.038, part = null) =>
  ({ name, part, kind: 'wheel', size: 2 * r, pts: cylPts(c, axis, r, h) });
const boxPts = (c, s) => { const p = []; for (let i = 0; i < 8; i++) p.push([c[0] + (i & 1 ? .5 : -.5) * s, c[1] + (i & 2 ? .5 : -.5) * s, c[2] + (i & 4 ? .5 : -.5) * s]); return p; };

// Wheels at the corners of a 0.32 m x 0.30 m base, 0.05 m off the floor.
const LX = 0.16, LY = 0.15, CZ = 0.05;
const CORNERS = { FL: [LX, LY, CZ], FR: [LX, -LY, CZ], BL: [-LX, LY, CZ], BR: [-LX, -LY, CZ] };
function corners(nameFor, axisFor, partFor) {
  return Object.keys(CORNERS).map((k) => wheel(nameFor(k), CORNERS[k], axisFor(k), 0.048, 0.038, partFor ? partFor(k) : null));
}
const at = (res, corner) => res.wheels.filter((w) => w.corner === corner)[0];

/* ---------- PCA ---------- */

test('PCA finds a wheel cylinder axle and radius whatever way it is turned', () => {
  // Two identical wheels so there is a drivetrain to report at all; the axle
  // is a deliberately awkward direction in every case.
  for (const ax of [[0, 1, 0], [1, 0, 0], [0, 0, 1], unit([1, 2, 3]), unit([-3, 0.4, 1]), unit([0.7, -0.7, 0.2])]) {
    // separate them horizontally, across the axle, so both sit at one ride height
    const side = Math.abs(ax[2]) > 0.9 ? [1, 0, 0] : unit(cross(ax, [0, 0, 1]));
    const c1 = [0, 0, 0.05], c2 = [side[0] * 0.3, side[1] * 0.3, 0.05];
    const res = E.driveFromCAD({ solids: [wheel('Wheel A', c1, ax, 0.05, 0.04), wheel('Wheel B', c2, ax, 0.05, 0.04)] });
    assert.equal(res.wheels.length, 2, 'both cylinders read as wheels');
    for (const w of res.wheels) {
      assert.ok(Math.abs(Math.abs(dot(w.axis, ax)) - 1) < 1e-6, `axle ${w.axis} vs ${ax}`);
      assert.ok(Math.abs(w.r - 0.05) < 5e-5, `radius ${w.r}`);    // 120-gon, so 3e-4 relative at worst
    }
    assert.ok(Math.abs(Math.hypot(res.wheels[0].x - res.wheels[1].x, res.wheels[0].y - res.wheels[1].y,
      res.wheels[0].z - res.wheels[1].z) - 0.3) < 1e-9, 'centres 300 mm apart');
  }
});

test('PCA rejects a long cylinder: a shaft is not a wheel', () => {
  const res = E.driveFromCAD({ solids: [
    { name: 'Drive Wheel Shaft', part: null, kind: 'wheel', size: 0.2, pts: cylPts([0, 0.1, 0.05], [0, 1, 0], 0.006, 0.2) },
    { name: 'Drive Wheel Shaft', part: null, kind: 'wheel', size: 0.2, pts: cylPts([0, -0.1, 0.05], [0, 1, 0], 0.006, 0.2) },
  ] });
  assert.equal(res.kind, 'unknown');
  assert.equal(res.confidence, 0);
  assert.ok(res.why.join(' ').includes('wrong shape'));
});

/* ---------- classification ---------- */

test('named mecanum: four corners, X rollers from the left/right names', () => {
  const res = E.driveFromCAD({ solids: corners(
    (k) => 'goBILDA 96mm Mecanum Wheel, ' + (k === 'FL' || k === 'BR' ? 'Left' : 'Right'),
    () => [0, 1, 0]) });
  assert.equal(res.kind, 'mecanum');
  assert.equal(res.confidence, 0.92);
  assert.deepEqual(res.wheels.map((w) => w.corner), ['FL', 'FR', 'BL', 'BR']);
  assert.equal(at(res, 'FL').roller, 1);
  assert.equal(at(res, 'BR').roller, 1);
  assert.equal(at(res, 'FR').roller, -1);
  assert.equal(at(res, 'BL').roller, -1);
  assert.ok(res.why.some((w) => /handedness from the wheel names/.test(w)), res.why.join(' | '));
  assert.ok(Math.abs(res.track - 2 * LY) < 1e-9 && Math.abs(res.base - 2 * LX) < 1e-9);
  assert.ok(Math.abs(at(res, 'FL').x - LX) < 1e-9 && Math.abs(at(res, 'FL').y - LY) < 1e-9);
});

test('mecanum with no handedness in the names falls back to the X pattern and says so', () => {
  const res = E.driveFromCAD({ solids: corners(() => 'Mecanum Wheel', () => [0, 1, 0]) });
  assert.equal(res.kind, 'mecanum');
  assert.equal(at(res, 'FL').roller, 1);
  assert.equal(at(res, 'FR').roller, -1);
  assert.ok(res.why.some((w) => /X pattern is assumed/.test(w)), res.why.join(' | '));
});

test('mecanum handedness from two part numbers on the diagonals', () => {
  const res = E.driveFromCAD({ solids: corners(() => 'Mecanum Wheel', () => [0, 1, 0],
    (k) => (k === 'FL' || k === 'BR' ? '3213-3606-0001' : '3213-3606-0002')) });
  assert.equal(res.kind, 'mecanum');
  assert.equal(at(res, 'FL').roller, at(res, 'BR').roller);
  assert.equal(at(res, 'FL').roller, -at(res, 'FR').roller);
  assert.ok(res.why.some((w) => /part numbers/.test(w)), res.why.join(' | '));
});

test('named traction wheels with parallel axles are tank, and four bare wheels are tank but unsure', () => {
  const named = E.driveFromCAD({ solids: corners(() => '104mm Traction Wheel', () => [0, 1, 0]) });
  assert.equal(named.kind, 'tank');
  assert.equal(named.confidence, 0.92);

  const bare = E.driveFromCAD({ solids: corners(() => '104mm Wheel', () => [0, 1, 0]) });
  assert.equal(bare.kind, 'tank');
  assert.equal(bare.confidence, 0.45);                 // geometry alone cannot tell mecanum from traction
  assert.ok(bare.confidence < named.confidence);
  assert.ok(bare.why.join(' ').includes('mecanum'), 'the ambiguity is spelled out');
});

test('two wheels are a differential base', () => {
  const res = E.driveFromCAD({ solids: [wheel('Wheel L', [0, LY, CZ], [0, 1, 0]), wheel('Wheel R', [0, -LY, CZ], [0, 1, 0])] });
  assert.equal(res.kind, 'tank');
  assert.equal(res.confidence, 0.65);
  assert.equal(res.ik.length, 2);
});

test('axles at 45 degrees are an X-drive, and its rows are mecanum turned 45 degrees', () => {
  // each corner's axle 45 deg from the chassis Y, alternating the way a real X-drive is built
  const res = E.driveFromCAD({ solids: corners(() => '3 inch Wheel',
    (k) => (k === 'FL' || k === 'BR' ? unit([1, 1, 0]) : unit([-1, 1, 0]))) });
  assert.equal(res.kind, 'x');
  assert.equal(res.confidence, 0.80);
  const mec = E.ikMatrix('mecanum', res.wheels.map((w) => Object.assign({}, w,
    { roller: w.corner === 'FL' || w.corner === 'BR' ? 1 : -1 })));
  res.ik.forEach((row, i) => row.forEach((v, j) =>
    assert.ok(Math.abs(v - mec[i][j] / Math.SQRT2) < 1e-9, `row ${i} col ${j}: ${v} vs ${mec[i][j] / Math.SQRT2}`)));
});

test('three wheels 120 degrees apart are a kiwi, every wheel the same lever arm', () => {
  const R = 0.15;
  const solids = [90, 210, 330].map((deg) => {
    const a = deg * D2R, c = [Math.cos(a) * R, Math.sin(a) * R, CZ];
    return wheel('Wheel ' + deg, c, [Math.cos(a), Math.sin(a), 0], 0.048, 0.038);   // axle radial
  });
  const res = E.driveFromCAD({ solids });
  assert.equal(res.kind, 'omni');
  assert.equal(res.confidence, 0.80);
  assert.equal(res.ik.length, 3);
  // tangential wheels all the same distance out: the omega column is the radius
  for (const row of res.ik) assert.ok(Math.abs(row[2] - R) < 1e-9, `omega column ${row[2]}`);
  // and their drive directions cancel, so spinning does not drag the robot anywhere
  assert.ok(Math.abs(res.ik.reduce((s, r) => s + r[0], 0)) < 1e-9);
  assert.ok(Math.abs(res.ik.reduce((s, r) => s + r[1], 0)) < 1e-9);
});

test('a servo stacked on each axle is a swerve module', () => {
  const solids = corners(() => '90mm Wheel', () => [0, 1, 0]);
  for (const k of Object.keys(CORNERS))
    solids.push({ name: 'Steering Servo', part: null, kind: 'servo', size: 0.05,
      pts: boxPts([CORNERS[k][0], CORNERS[k][1], CZ + 0.06], 0.04) });
  const res = E.driveFromCAD({ solids });
  assert.equal(res.kind, 'swerve');
  assert.equal(res.confidence, 0.75);
  assert.ok(res.wheels.every((w) => w.steer === true));

  // the same wheels without the servos are just a tank base
  const plain = E.driveFromCAD({ solids: corners(() => '90mm Wheel', () => [0, 1, 0]) });
  assert.equal(plain.kind, 'tank');
  assert.ok(plain.wheels.every((w) => w.steer === false));
});

test('confidence is ordered by how good the evidence is', () => {
  const mec = E.driveFromCAD({ solids: corners(() => 'Mecanum Wheel, Left', () => [0, 1, 0]) });
  const xd = E.driveFromCAD({ solids: corners(() => 'Wheel', (k) => (k === 'FL' || k === 'BR' ? unit([1, 1, 0]) : unit([-1, 1, 0]))) });
  const bare = E.driveFromCAD({ solids: corners(() => 'Wheel', () => [0, 1, 0]) });
  const none = E.driveFromCAD({ solids: [] });
  assert.ok(mec.confidence > xd.confidence, 'a name beats an angle');
  assert.ok(xd.confidence > bare.confidence, 'a 45 degree axle beats four parallel ones');
  assert.ok(bare.confidence > none.confidence, 'wheels beat no wheels');
  assert.equal(none.confidence, 0);
});

test('flywheels and intake rollers are not drive wheels', () => {
  const solids = corners(() => 'Mecanum Wheel, ' + 'Left', () => [0, 1, 0]);
  solids[1].name = 'Mecanum Wheel, Right'; solids[2].name = 'Mecanum Wheel, Right';
  solids.push(wheel('Shooter Flywheel', [0, 0, 0.22], [0, 1, 0], 0.05, 0.03));
  solids.push(wheel('Intake Roller', [0.2, 0, 0.30], [0, 1, 0], 0.03, 0.30));
  solids.push(wheel('Compliant Intake Roller', [0.2, 0, 0.25], [0, 1, 0], 0.035, 0.05));
  const res = E.driveFromCAD({ solids });
  assert.equal(res.kind, 'mecanum');
  assert.equal(res.wheels.length, 4, 'only the four at the bottom');
  assert.ok(res.wheels.every((w) => Math.abs(w.z) < 1e-9));
  assert.ok(res.why.some((w) => /clear of the floor/.test(w)), res.why.join(' | '));
});

test('nothing to go on: unknown, zero confidence, and a reason', () => {
  const empty = E.driveFromCAD({ solids: [] });
  assert.equal(empty.kind, 'unknown');
  assert.equal(empty.confidence, 0);
  assert.deepEqual(empty.wheels, []);
  assert.deepEqual(empty.ik, []);
  assert.ok(empty.why.length && /no part solids/.test(empty.why.join(' ')));

  const arm = E.driveFromCAD({ solids: [
    { name: 'U-Channel', part: null, kind: 'metal', size: 0.4, pts: boxPts([0, 0, 0.1], 0.3) },
    { name: 'Claw servo', part: null, kind: 'servo', size: 0.05, pts: boxPts([0, 0, 0.3], 0.04) },
  ] });
  assert.equal(arm.kind, 'unknown');
  assert.equal(arm.confidence, 0);
  assert.ok(/classified as a wheel|named like one/.test(arm.why.join(' ')));

  assert.equal(E.driveFromCAD(null).kind, 'unknown');
  assert.equal(E.driveFromCAD({}).kind, 'unknown');
});

test('the parts inventory alone is not enough, and says why', () => {
  const res = E.driveFromCAD({ parts: [{ name: 'Mecanum Wheel Set', part: '3213-3606-0001', n: 4, kind: 'struct' }] });
  assert.equal(res.kind, 'unknown');
  assert.equal(res.confidence, 0);
  assert.ok(/no per-part geometry/.test(res.why.join(' ')));
});

test('the sample CAD is an arm on a bench, so it reports no drivetrain rather than guessing', () => {
  const res = E.driveFromCAD({ solids: E.sampleSolids(), parts: E.SAMPLE_CAD.parts, bbox: E.SAMPLE_CAD.bbox });
  assert.equal(res.kind, 'unknown');
  assert.equal(res.confidence, 0);
  assert.ok(res.why.length > 0);
  assert.ok(/wheel/i.test(res.why.join(' ')));
  assert.deepEqual(res.ik, []);
});

test('the CAD frame is respected: a y-forward export gives the same base turned 90 degrees', () => {
  // the same robot modelled with +y forward: track and wheelbase must swap back
  const solids = Object.keys(CORNERS).map((k) => {
    const c = CORNERS[k];
    return wheel('Mecanum Wheel, ' + (k === 'FL' || k === 'BR' ? 'Left' : 'Right'), [-c[1], c[0], c[2]], [1, 0, 0]);
  });
  const res = E.driveFromCAD({ solids }, { front: '+y', up: '+z' });
  assert.equal(res.kind, 'mecanum');
  assert.ok(Math.abs(res.track - 2 * LY) < 1e-9, `track ${res.track}`);
  assert.ok(Math.abs(res.base - 2 * LX) < 1e-9, `base ${res.base}`);
  assert.equal(at(res, 'FL').roller, 1);
});

/* ---------- kinematics ---------- */

const mecWheels = [
  { corner: 'FL', x: LX, y: LY, roller: 1 },
  { corner: 'FR', x: LX, y: -LY, roller: -1 },
  { corner: 'BL', x: -LX, y: LY, roller: -1 },
  { corner: 'BR', x: -LX, y: -LY, roller: 1 },
];

test('mecanum ik rows are the hand-computed ones, signs and all', () => {
  const M = E.ikMatrix('mecanum', mecWheels);
  const S = LX + LY;                                   // 0.31 m
  assert.deepEqual(M, [[1, -1, -S], [1, 1, S], [1, 1, -S], [1, -1, S]]);

  // 1 m/s forward: every wheel forward at 1 m/s
  assert.deepEqual(E.wheelSpeeds(M, 1, 0, 0), [1, 1, 1, 1]);
  // 1 m/s to the LEFT: front-left and back-right run backwards (the X pattern)
  assert.deepEqual(E.wheelSpeeds(M, 0, 1, 0), [-1, 1, 1, -1]);
  // 1 rad/s counter-clockwise: the left side runs backwards at 0.31 m/s
  const spin = E.wheelSpeeds(M, 0, 0, 1);
  assert.ok(spin[0] < 0 && spin[2] < 0 && spin[1] > 0 && spin[3] > 0, 'spin signs');
  assert.ok(Math.abs(spin[0] + S) < 1e-12 && Math.abs(spin[1] - S) < 1e-12);
});

test('mecanum ik -> fk round-trips forward, strafe and spin to 1e-9', () => {
  const M = E.ikMatrix('mecanum', mecWheels), FK = E.fkFromIk(M);
  assert.equal(FK.length, 3);
  assert.equal(FK[0].length, 4);
  for (const [vx, vy, w] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1.2, -0.45, 2.7], [0, 0, 0]]) {
    const got = E.chassisFromWheels(FK, E.wheelSpeeds(M, vx, vy, w));
    assert.ok(Math.abs(got.vx - vx) < 1e-9, `vx ${got.vx} vs ${vx}`);
    assert.ok(Math.abs(got.vy - vy) < 1e-9, `vy ${got.vy} vs ${vy}`);
    assert.ok(Math.abs(got.omega - w) < 1e-9, `omega ${got.omega} vs ${w}`);
  }
});

test('a tank base cannot strafe: the least-squares fit says so instead of inventing one', () => {
  const M = E.ikMatrix('tank', [{ x: 0, y: LY }, { x: 0, y: -LY }]);
  assert.deepEqual(M, [[1, 0, -LY], [1, 0, LY]]);      // no strafe column at all
  const FK = E.fkFromIk(M);
  assert.ok(FK[1].every((v) => Math.abs(v) < 1e-12), 'the vy row is exactly zero');

  const resid = (vx, vy, w) => {
    const got = E.chassisFromWheels(FK, E.wheelSpeeds(M, vx, vy, w));
    return Math.hypot(got.vx - vx, got.vy - vy, got.omega - w);
  };
  assert.ok(resid(1, 0, 0) < 1e-9, 'forward is exact');
  assert.ok(resid(0, 0, 1) < 1e-9, 'spin is exact');
  assert.ok(resid(0, 1, 0) > 0.99, 'a 1 m/s strafe command is lost entirely');

  // and the signs: driving forward runs both wheels forward, turning left runs
  // the left wheel backwards
  assert.deepEqual(E.wheelSpeeds(M, 1, 0, 0), [1, 1]);
  assert.deepEqual(E.wheelSpeeds(M, 0, 0, 1), [-LY, LY]);
});

test('fk is a real least-squares fit: a noisy over-determined set averages out', () => {
  const M = E.ikMatrix('mecanum', mecWheels), FK = E.fkFromIk(M);
  const truth = { vx: 0.8, vy: -0.3, omega: 1.1 };
  const v = E.wheelSpeeds(M, truth.vx, truth.vy, truth.omega);
  // The one wheel-speed pattern a mecanum base cannot produce: both front
  // wheels over and both back wheels under. That vector is orthogonal to all
  // three columns of M — it is pure roller scrub, not chassis motion — so the
  // fit must throw it away whole, at any size.
  const scrub = [1, 1, -1, -1];                        // FL, FR, BL, BR
  for (const g of [0.02, 0.2, 5]) {
    const got = E.chassisFromWheels(FK, v.map((x, i) => x + g * scrub[i]));
    assert.ok(Math.abs(got.vx - truth.vx) < 1e-9, `vx ${got.vx} at scrub ${g}`);
    assert.ok(Math.abs(got.vy - truth.vy) < 1e-9, `vy ${got.vy} at scrub ${g}`);
    assert.ok(Math.abs(got.omega - truth.omega) < 1e-9, `omega ${got.omega} at scrub ${g}`);
  }

  // A 0.1 m/s overspeed on both LEFT wheels is not scrub. M'M is diagonal for
  // this layout (4, 4, 4S^2), so the correction is exactly
  //   dvx = 0.2/4 = +0.05, dvy = 0, domega = -0.2S/4S^2 = -0.05/S,
  // i.e. the robot creeps forward and turns CLOCKWISE. The omega sign is the
  // whole point: run the left side faster and the robot yaws right.
  const S = LX + LY;
  const skewed = E.chassisFromWheels(FK, [v[0] + 0.1, v[1], v[2] + 0.1, v[3]]);
  assert.ok(Math.abs(skewed.vx - (truth.vx + 0.05)) < 1e-9, `vx ${skewed.vx}`);
  assert.ok(Math.abs(skewed.vy - truth.vy) < 1e-9, `vy ${skewed.vy}`);
  assert.ok(Math.abs(skewed.omega - (truth.omega - 0.05 / S)) < 1e-9, `omega ${skewed.omega}`);
});

test('fk of an empty or degenerate matrix does not blow up', () => {
  assert.deepEqual(E.fkFromIk([]), [[], [], []]);
  assert.deepEqual(E.chassisFromWheels(E.fkFromIk([]), []), { vx: 0, vy: 0, omega: 0 });
  const one = E.fkFromIk(E.ikMatrix('tank', [{ x: 0, y: 0 }]));
  assert.ok(one[0].every((v) => isFinite(v)) && one[2].every((v) => isFinite(v)));
});

test('DRIVE_KINDS covers exactly the kinds that can be returned', () => {
  assert.deepEqual(Object.keys(E.DRIVE_KINDS).sort(), ['mecanum', 'omni', 'swerve', 'tank', 'unknown', 'x']);
  for (const k of Object.keys(E.DRIVE_KINDS)) {
    assert.equal(typeof E.DRIVE_KINDS[k].label, 'string');
    assert.ok(E.DRIVE_KINDS[k].desc.length > 10);
  }
});
