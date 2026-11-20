// What a part is, read from its name (src/hull.js solidKind), decides its weight and whether it
// may be a drive wheel, and the drive wheels decide where the floor is (src/drivetrain.js
// dtOnFloor, src/frame.js robotFrame). The names were matched as substrings: "contROLLER" was a
// wheel, so a 2016 robot's four electronics boxes became its drive base and the robot ended
// 483 mm under its own floor; "Sample Intake" weighed nothing as a game element. A name is now
// read as words ("IntakeRoller" and "motor_mount" too), by its head ("Servo Frame (..., for
// Standard Size Servos)" is a frame), and a word followed by "mount", "hub", "chain",
// "controller" and the like only describes the part. The floor is the lowest wheels, all of them
// when the lowest stands alone, unless that one is far smaller than the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();

test('part kinds: a name says what the part is, not what it is attached to or happens to contain', () => {
  const table = {
    electronics: ['Core_Motor_Controller', 'Core_Servo_Controller', 'Core Device Interface Controller', 'SPARK Mini Motor Controller', 'Logitech F310 Controller',
      'Motor Controller', 'Servo Power Module', 'Power Distribution Module', 'Core_Power_Distribution_Module', 'Control Hub Top Frame', 'Expansion Hub', 'REV Servo Hub', 'Limit Switch', 'Webcam',
      'ControlHub', 'ExpansionHub', 'Power Distribution Hub', 'Servo Hub REV-11-1855', 'REV-11-1855', 'Motor Driver'],
    belt: ['Roller Chain', '#25 Roller Chain Loop', 'Roller Chain_1', 'Timing Belt', 'Chain', 'Retraction Spring', 'Motor Cable'],
    wheel: ['96mm Mecanum Wheel', 'Mecanum Wheel Left', 'Omni Wheel Roller', 'Intake Roller', 'Compliant Wheel', 'Flywheel', 'Traction Wheel', 'Gecko Wheel', 'Tire', 'Rear Tyres', 'Rollers',
      'IntakeRoller', 'FrontTire', 'Tire1', '4inOmni', 'MecanumWheel', 'am-2648_4inWheel8mmHub',
      'Roller Cover'],                                                  // goBILDA's: the rubber tread of a mecanum roller
    motor: ['Yellow Jacket Planetary Gear Motor', '5203 Series Yellow Jacket Motor (19.2:1 Ratio, 24mm Length 8mm REX Shaft, 312 RPM, 3.3 - 5V Encoder)', 'gearmotor', 'Drive Motors', 'NeveRest_Motor',
      'driveMotor', 'Motor Gearbox', 'Motor Housing', 'Motor Encoder', 'Part 3 (Yellow Jacket Motor)'],
    servo: ['Dual Mode Servo (25-2, Torque)', 'Axon Servo', 'TETRIX_739197_SERVO_2012', 'Servo with Servo Horn', 'Servo Gearbox'],
    metal: ['Wheel Hub', 'Mecanum Wheel Bearing', 'Wheel Spacer', 'Wheel Mount Plate', 'Wheel Bracket', 'Roller Bearing', 'Roller Axle', 'Entire Assembly',
      'Motor Mount', 'Motor mounting plate', 'Motor Plate', 'motor_mount', 'Servo Horn', 'Servo Block', 'Servo Mount', 'Servo Hub', '1900 Series Single Servo Arm (25 Tooth Spline, 32mm Length)',
      '1802 Series Servo Frame (43mm Width, for Standard Size Servos)', 'Bracket for servo',
      'Sonic Hub', '1310 Series Hyper Hub (5mm Hex Bore)', 'Clamping Hub', 'Hub', 'Belt Pulley', 'Chain Sprocket', 'Swerve Module', 'U-Channel', 'Part 12',
      // robot parts named after the game element they handle
      'sample_intake', 'Sample Intake', 'Specimen Claw', 'pixel_tray', 'artifact_ramp'],
    game: ['Sample', 'Red Sample 3', 'sample_1', 'Specimen', 'Pixel', 'CENTERSTAGE™ Pixel White am-5001_white', 'Artifact', 'Game Piece', 'Game Element 2', 'am-3376', 'Pollen', 'Blue Nectar 2'],
    fastener: ['M4 Socket Head Screw', 'Locknut'],
  };
  for (const [kind, names] of Object.entries(table)) for (const n of names) assert.equal(E.solidKind(n, null), kind, n);
  // a part number still decides, whatever the name says
  assert.equal(E.solidKind('Mount', '5203-2402-0019'), 'motor');
  assert.equal(E.solidKind('Bracket', '2000-0025-0002'), 'servo');
  assert.equal(E.solidKind('Hub', 'REV-11-1855'), 'electronics');
  assert.equal(E.solidKind('Ball', 'am-5852'), 'game');
});

test('part kinds: nothing that is not a wheel is a candidate for the drive base', () => {
  for (const name of ['Core_Motor_Controller', 'Logitech F310 Controller', 'Roller Chain', '#25 Roller Chain Loop', 'Retraction Spring', 'Entire Assembly', 'Wheel Hub', 'Flywheel',
    'Wheel Spacer', 'Wheel Mount Plate', 'Wheel Bracket'])
    assert.equal(E.dtIsWheel({ name, kind: E.solidKind(name, null) }), false, name);
  for (const name of ['96mm Mecanum Wheel', 'Omni Wheel', 'Traction Wheel', 'Rear Tire', 'Intake Roller', 'Mecanum Wheel', 'FrontTire', '4inOmni', 'am-2648_4inWheel8mmHub'])
    assert.equal(E.dtIsWheel({ name, kind: E.solidKind(name, null) }), true, name);
  // the name test alone, with no kind to lean on (the inventory rows cad.parts holds)
  for (const name of ['FrontTire', '4inOmni', 'MecanumWheel', 'Mecanum Wheel (96mm, for 8mm REX)']) assert.equal(E.dtIsWheel({ name }), true, name);
  for (const name of ['Wheel Spacer', 'Wheel Mount Plate', 'Wheel Bracket']) assert.equal(E.dtIsWheel({ name }), false, name);
  // a part number that says drive wheel decides, whatever the name
  assert.equal(E.dtIsWheel({ name: 'Wheel Spacer', part: '3213-3606-0002', kind: 'metal' }), true);
});

test('part mass: a robot part named after a game element is the robot', () => {
  const box = (c, s) => { const p = []; for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]) p.push([c[0] + i * s[0] / 2, c[1] + j * s[1] / 2, c[2] + k * s[2] / 2]); return p; };
  const solids = [['drive_frame', [0, 0, 0.05], [0.40, 0.40, 0.06]], ['sample_intake_frame', [0.25, 0, 0.06], [0.12, 0.30, 0.05]], ['Specimen Claw', [-0.15, 0.05, 0.40], [0.06, 0.02, 0.10]],
    ['pixel_tray', [0, 0, 0.30], [0.12, 0.20, 0.05]], ['artifact_ramp', [0.1, 0, 0.20], [0.10, 0.20, 0.01]], ['sample_1', [0.30, 0, 0.02], [0.089, 0.038, 0.038]]]
    .map(([name, c, s]) => ({ name, part: null, kind: E.solidKind(name, null), pts: box(c, s) }));
  for (const s of solids.slice(1, 5)) assert.ok(E.partMass(s).kg > 0, `${s.name} weighs something`);
  assert.equal(E.partMass(solids[5]).kg, 0, 'the sample in the claw is payload, not robot');
});

/* ---- a robot of point clouds, as the parser hands them over ---- */
const cyl = (c, r, L, n = 16, m = 3) => {                       // a wheel: axle along y
  const pts = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const th = (2 * Math.PI * i) / n; pts.push([c[0] + r * Math.cos(th), c[1] + (j / (m - 1) - 0.5) * L, c[2] + r * Math.sin(th)]); }
  return pts;
};
const box = (c, sx, sy, sz, n = 4) => {                         // a block, points over its surface and inside
  const pts = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++)
    pts.push([c[0] + (i / n - 0.5) * sx, c[1] + (j / n - 0.5) * sy, c[2] + (k / n - 0.5) * sz]);
  return pts;
};
const part = (name, pts) => ({ name, part: null, kind: E.solidKind(name, null), pts });
const CORNERS = [[0.17, 0.19], [0.17, -0.19], [-0.17, 0.19], [-0.17, -0.19]];
const bboxOf = (solids) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) for (const p of s.pts) for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
  return { min, max };
};
function frameOf(solids) {
  const F = E.robotFrame({ solids, bbox: bboxOf(solids) });
  // how much of the robot the frame leaves under its own floor
  let n = 0, under = 0, lowest = Infinity;
  for (const s of solids) for (const p of s.pts) { const q = F.toCanon(p); n++; if (q[2] < -0.010) under++; if (q[2] < lowest) lowest = q[2]; }
  return { F, share: under / n, lowest };
}
// the drive detector on the same parts, after the frame has been applied
function driveOf(solids) {
  const cad = { solids: JSON.parse(JSON.stringify(solids)), bbox: bboxOf(solids), points: [] };
  E.canonicalizeCAD(cad);
  return E.driveFromCAD(cad, {});
}
/* A drive base drawn 0.5 m above the CAD's origin: four wheels of radius R on the tiles, a body above them. */
const R = 0.048, Z0 = 0.5;
const base = (wheelName = 'Mecanum Wheel', dz = [0, 0, 0, 0]) => [
  part('U-Channel Body', box([0, 0, Z0 + 0.20], 0.36, 0.36, 0.30)),
  ...CORNERS.map(([x, y], i) => part(wheelName + ' ' + (i + 1), cyl([x, y, Z0 + R + dz[i]], R, 0.038))),
];
const wheel = (x, y, z, r) => ({ c: [x, y, z], r });
const UP = [0, 0, 1];

test('floor: a drive base stands on its wheels, and the frame says so', () => {
  const { F, share } = frameOf(base());
  assert.equal(F.originWhy, 'wheels'); assert.equal(F.wheels, 4); assert.equal(F.up, '+z');
  assert.ok(Math.abs(F.origin[2] - Z0) < 1e-6, `the floor is under the wheels: ${F.origin[2]}`);
  assert.equal(share, 0);
});

test('floor: a drive wheel drawn 7 mm low is still a drive wheel', () => {
  // alone at its height, but the size of the others: a wheel drawn a little off, not a skid
  const ws = CORNERS.map(([x, y], i) => wheel(x, y, R + (i === 0 ? -0.007 : 0), R));
  assert.equal(E.dtOnFloor(ws, UP).length, 4);
  const { F } = frameOf(base('Mecanum Wheel', [-0.007, 0, 0, 0]));
  assert.equal(F.originWhy, 'wheels');
  assert.equal(F.wheels, 4, 'all four drive wheels, not the three level ones');
  assert.ok(Math.abs(F.origin[2] - (Z0 - 0.007 / 4)) < 1e-6, `the floor under the four: ${((F.origin[2] - Z0) * 1000).toFixed(2)} mm`);
  assert.equal(driveOf(base('Mecanum Wheel', [-0.007, 0, 0, 0])).wheels.length, 4, 'the drive detector agrees');
});

test('floor: a small guide roller drawn under the drive wheels is not one of them', () => {
  // a 15 mm guide roller 12 mm under the tiles (a sprung pod, uncompressed): alone at its height and small
  const ws = CORNERS.map(([x, y]) => wheel(x, y, R, R)).concat([wheel(0, 0, 0.015 - 0.012, 0.015)]);
  const low = E.dtOnFloor(ws, UP);
  assert.equal(low.length, 4); assert.ok(!low.includes(ws[4]), 'the roller is left out');
  const solids = base().concat([part('Guide Roller', cyl([0, 0, Z0 - 0.012 + 0.015], 0.015, 0.02))]);
  const { F } = frameOf(solids);
  assert.equal(F.originWhy, 'wheels');
  assert.equal(F.wheels, 4, 'the four drive wheels, not five');
  assert.ok(Math.abs(F.origin[2] - Z0) < 1e-6, `the floor is still under the four wheels: ${(F.origin[2] - Z0) * 1000} mm off`);
  const D = driveOf(solids);
  assert.equal(D.wheels.length, 4);
  assert.ok(D.why.some((w) => /^1 wheel-shaped part\(s\) reach 12 mm below the floor the drive wheels stand on, each alone at its height and under 60% of their size/.test(w)),
    'the why says the part was left out BELOW the wheels: ' + D.why.join(' | '));
  assert.ok(!D.why.some((w) => /clear of the floor/.test(w)), 'and does not call it a part riding clear above them');
});

test('floor: the wheels on the floor are never none of them', () => {
  const sets = {
    'two wheels 50 mm apart in height': [wheel(0.1, 0.19, R, R), wheel(0.1, -0.19, R + 0.05, R)],
    'four boxes at four heights': [0.15, 0.20, 0.26, 0.31].map((z, i) => wheel(CORNERS[i][0], CORNERS[i][1], z, 0.05)),
    'three small and one big, all apart': [wheel(0, 0, 0.01, 0.01), wheel(0.1, 0, 0.03, 0.012), wheel(0.2, 0, 0.06, 0.013), wheel(0.3, 0, 0.2, 0.05)],
    'one wheel': [wheel(0, 0, R, R)],
  };
  for (const [name, ws] of Object.entries(sets)) {
    const low = E.dtOnFloor(ws, UP);
    assert.ok(low.length >= Math.min(2, ws.length), `${name}: ${low.length} of ${ws.length}`);
  }
  assert.deepEqual(E.dtOnFloor([], UP), []);
});

test('floor: controllers on edge half way up a robot whose wheels have no wheel names do not bury it', () => {
  // the 2016 robot's trap on a robot with ground truth: every part is "Part N", so the drive wheels
  // are found by their shape; four motor controllers stand on edge half way up, round enough in
  // outline to pass for wheels. On main "contROLLER" made them wheels by name, they became the
  // drive base, and the robot was buried to their height.
  const { text, truth } = buildRobot('unnamed-wheels');
  const solids = E.parseSTEP(text).solids.slice();
  const mid = (truth.bbox.min[2] + truth.bbox.max[2]) / 2;
  for (const [x, y] of [[0.08, 0.06], [0.08, -0.06], [-0.08, 0.06], [-0.08, -0.06]]) solids.push(part('Core_Motor_Controller', box([x, y, mid], 0.10, 0.03, 0.09)));
  const { F, lowest } = frameOf(solids);
  assert.equal(F.up, truth.up);
  assert.equal(F.originWhy, 'wheels'); assert.equal(F.wheels, truth.drive.wheels);
  const want = [truth.wheelCentroid[0], truth.wheelCentroid[1], truth.floorZ];
  assert.ok(Math.hypot(...F.origin.map((v, k) => v - want[k])) < 0.002,
    `the origin is the drive centre on the floor: ${F.origin.map((v) => (v * 1000).toFixed(1))} mm, truth ${want.map((v) => (v * 1000).toFixed(1))} mm`);
  assert.ok(lowest > -0.002, `nothing under the floor: lowest ${(lowest * 1000).toFixed(0)} mm`);
  const D = driveOf(solids);
  assert.equal(D.wheels.length, truth.drive.wheels);
  assert.ok(D.why.some((w) => /found by shape/.test(w)), 'the drive detector finds the same wheels by shape: ' + D.why.join(' | '));
  assert.equal(solids.filter((s) => E.dtIsWheel(s)).length, 0, 'no part is a wheel by its name');
});
