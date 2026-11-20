// What a part is, read from its name (src/hull.js solidKind), decides its weight and whether it
// may be a drive wheel, and the drive wheels decide where the floor is (src/drivetrain.js
// dtOnFloor, src/frame.js robotFrame). The names were matched as substrings: "contROLLER" was a
// wheel, so a 2016 robot's four electronics boxes, at four heights, became its drive base and
// the robot ended 483 mm under its own floor; a roller chain weighed seven times too much as a
// tyre. A name now counts by whole words, a word followed by "mount", "hub", "chain",
// "controller" and the like only describes the part, a floor needs two wheels at one height,
// and a floor that leaves a real share of the robot under it is not believed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

test('part kinds: a name says what the part is, not what it is attached to or happens to contain', () => {
  const table = {
    electronics: ['Core_Motor_Controller', 'Core_Servo_Controller', 'Core Device Interface Controller', 'SPARK Mini Motor Controller', 'Logitech F310 Controller',
      'Motor Controller', 'Servo Power Module', 'Power Distribution Module', 'Core_Power_Distribution_Module', 'Control Hub Top Frame', 'Expansion Hub', 'REV Servo Hub', 'Limit Switch', 'Webcam'],
    belt: ['Roller Chain', '#25 Roller Chain Loop', 'Roller Chain_1', 'Timing Belt', 'Chain', 'Retraction Spring', 'Motor Cable'],
    wheel: ['96mm Mecanum Wheel', 'Mecanum Wheel Left', 'Omni Wheel Roller', 'Intake Roller', 'Compliant Wheel', 'Flywheel', 'Traction Wheel', 'Gecko Wheel', 'Tire', 'Rear Tyres', 'Rollers'],
    motor: ['Yellow Jacket Planetary Gear Motor', '5203 Series Yellow Jacket Motor (19.2:1 Ratio, 24mm Length 8mm REX Shaft, 312 RPM, 3.3 - 5V Encoder)', 'gearmotor', 'Drive Motors', 'NeveRest_Motor'],
    servo: ['Dual Mode Servo (25-2, Torque)', 'Axon Servo', 'TETRIX_739197_SERVO_2012'],
    metal: ['Wheel Hub', 'Mecanum Wheel Bearing', 'Wheel Spacer', 'Wheel Mount Plate', 'Roller Bearing', 'Roller Axle', 'Roller Cover', 'Entire Assembly',
      'Motor Mount', 'Motor mounting plate', 'Motor Plate', 'Servo Horn', 'Servo Block', 'Servo Mount', 'Servo Hub', '1900 Series Single Servo Arm (25 Tooth Spline, 32mm Length)',
      'Sonic Hub', '1310 Series Hyper Hub (5mm Hex Bore)', 'Clamping Hub', 'Hub', 'Belt Pulley', 'Chain Sprocket', 'Swerve Module', 'U-Channel', 'Part 12'],
    fastener: ['M4 Socket Head Screw', 'Locknut'],
  };
  for (const [kind, names] of Object.entries(table)) for (const n of names) assert.equal(E.solidKind(n, null), kind, n);
  // a part number still decides, whatever the name says
  assert.equal(E.solidKind('Mount', '5203-2402-0019'), 'motor');
  assert.equal(E.solidKind('Bracket', '2000-0025-0002'), 'servo');
});

test('part kinds: nothing that is not a wheel is a candidate for the drive base', () => {
  for (const name of ['Core_Motor_Controller', 'Logitech F310 Controller', 'Roller Chain', '#25 Roller Chain Loop', 'Retraction Spring', 'Entire Assembly', 'Wheel Hub', 'Flywheel'])
    assert.equal(E.dtIsWheel({ name, kind: E.solidKind(name, null) }), false, name);
  for (const name of ['96mm Mecanum Wheel', 'Omni Wheel', 'Traction Wheel', 'Rear Tire', 'Intake Roller'])
    assert.equal(E.dtIsWheel({ name, kind: E.solidKind(name, null) }), true, name);
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
function frameOf(solids) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) for (const p of s.pts) for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
  const F = E.robotFrame({ solids, bbox: { min, max } });
  // how much of the robot the frame leaves under its own floor
  let n = 0, under = 0, lowest = Infinity;
  for (const s of solids) for (const p of s.pts) { const q = F.toCanon(p); n++; if (q[2] < -0.010) under++; if (q[2] < lowest) lowest = q[2]; }
  return { F, share: under / n, lowest };
}
/* A drive base drawn 0.5 m above the CAD's origin: four wheels of radius R on the tiles, a body above them. */
const R = 0.048, Z0 = 0.5;
const base = (wheelName = 'Mecanum Wheel') => [
  part('U-Channel Body', box([0, 0, Z0 + 0.20], 0.36, 0.36, 0.30)),
  ...CORNERS.map(([x, y], i) => part(wheelName + ' ' + (i + 1), cyl([x, y, Z0 + R], R, 0.038))),
];

test('floor: a drive base stands on its wheels, and the frame says so', () => {
  const { F, share } = frameOf(base());
  assert.equal(F.originWhy, 'wheels'); assert.equal(F.wheels, 4); assert.equal(F.up, '+z');
  assert.ok(Math.abs(F.origin[2] - Z0) < 1e-6, `the floor is under the wheels: ${F.origin[2]}`);
  assert.equal(share, 0);
});

test('floor: one wheel-shaped part lower than the wheels is not the floor', () => {
  // a guide roller drawn 12 mm under the tiles (a sprung pod, uncompressed): alone at its height
  const solids = base().concat([part('Guide Roller', cyl([0, 0, Z0 - 0.012 + 0.015], 0.015, 0.02))]);
  const { F } = frameOf(solids);
  assert.equal(F.originWhy, 'wheels');
  assert.equal(F.wheels, 4, 'the four that share a height, not five');
  assert.ok(Math.abs(F.origin[2] - Z0) < 1e-6, `the floor is still under the four wheels: ${(F.origin[2] - Z0) * 1000} mm off`);
});

test('floor: electronics boxes at four heights are not a drive base, whatever they are called', () => {
  // the 2016 robot: no part named as a wheel, four controllers standing on edge up the side of the frame
  const solids = [part('Frame', box([0, 0, 0.25], 0.40, 0.40, 0.50))].concat(
    [0.15, 0.20, 0.26, 0.31].map((z, i) => part(i < 3 ? 'Core_Motor_Controller' : 'Core_Servo_Controller', box([CORNERS[i][0], CORNERS[i][1], z], 0.10, 0.03, 0.09))));
  const { F, share, lowest } = frameOf(solids);
  assert.equal(F.originWhy, 'bbox', 'no floor from them: the bottom of the CAD');
  assert.equal(F.up, '+z');
  assert.ok(share === 0 && lowest > -0.001, `nothing under the floor: ${(share * 100).toFixed(0)} % of points, lowest ${(lowest * 1000).toFixed(0)} mm (it was 43.9 % and -483 mm on the real file)`);
});

test('floor: wheels half way up a robot are not what it stands on', () => {
  // intake wheels, rightly named, level with each other, in the middle of a robot whose drive wheels are not drawn
  const solids = [part('Frame', box([0, 0, 0.25], 0.40, 0.40, 0.50))].concat(CORNERS.map(([x, y], i) => part('Compliant Wheel ' + (i + 1), cyl([x * 0.6, y * 0.6, 0.25], 0.036, 0.03))));
  const { F, share, lowest } = frameOf(solids);
  assert.equal(F.originWhy, 'bbox');
  assert.match(F.floorWhy, /% of it lies more than 25 mm below the wheel-shaped parts found/);
  assert.equal(F.up, '+z'); assert.equal(F.wheels, 0);
  assert.ok(share === 0 && lowest > -0.001, `nothing under the floor: lowest ${(lowest * 1000).toFixed(0)} mm`);
});
