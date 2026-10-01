// Wheels made of many parts (src/drivetrain.js dtCompositeWheels): a real FTC
// mecanum wheel is two side plates and a ring of rollers, often named nothing
// like a wheel ("OR", "IR", "Part 7"). It must still be found as one wheel, read
// as mecanum from its rollers' angle, and given the hand its rollers show, on
// a robot modelled with wheel sub-assemblies or flattened, with four wheels
// drawn or only one. Failing these is what made a team's 109 MB Onshape robot
// load without a drivetrain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const unit = (v) => { const L = Math.hypot(...v); return v.map((x) => x / L); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/* A cylinder's surface points: centre c, axis a, radius r, length L. */
function cyl(c, a, r, L, n = 10, m = 5) {
  a = unit(a); const u = unit(Math.abs(a[2]) < 0.9 ? cross(a, [0, 0, 1]) : cross(a, [1, 0, 0])), v = cross(a, u), pts = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const th = (2 * Math.PI * i) / n, s = (j / (m - 1) - 0.5) * L;
    pts.push(add(add(add(c, u, r * Math.cos(th)), v, r * Math.sin(th)), a, s));
  }
  return pts;
}
const XPAT = { FL: 1, BR: 1, FR: -1, BL: -1 };
/* One mecanum wheel: two thin side plates and ten rollers at 45 degrees round an axle
   along +y, at c. hand: the ikMatrix hand its floor roller gives (+1 = floor roller
   front-right to back-left). The parts are named like a real export's. */
function mecanumWheel(c, hand, { roll = 45, names = ['OR', 'IR', 'RollerCore'] } = {}) {
  const axle = [0, 1, 0], parts = [];
  for (const [k, side] of [[0, -0.017], [1, 0.017]]) parts.push({ name: names[k], kind: 'metal', pts: cyl(add(c, axle, side), axle, 0.044, 0.003, 16, 2) });
  // the floor roller's axis is fwd*cos + axle*h*sin; hand +1 needs it front-right/back-left: h = -hand
  const h = -hand, tilt = (roll * Math.PI) / 180;
  for (let k = 0; k < 10; k++) {
    const th = (2 * Math.PI * k) / 10 - Math.PI / 2, out = [Math.cos(th), 0, Math.sin(th)];
    const tan = [-Math.sin(th), 0, Math.cos(th)], ax = unit(add(tan.map((x) => x * Math.cos(tilt)), axle, h * Math.sin(tilt)));
    parts.push({ name: names[2], kind: 'wheel', pts: cyl(add(c, out, 0.04), ax, 0.008, 0.03, 8, 4) });
  }
  return parts;
}
const CORNERS = { FL: [0.17, 0.19], FR: [0.17, -0.19], BL: [-0.17, 0.19], BR: [-0.17, -0.19] };
/* A robot: a chassis plate and mecanum wheels at the corners given, each its own sub-assembly
   (or flattened: no assembly paths at all). */
function robot({ corners = Object.keys(CORNERS), hands = XPAT, flat = false, roll = 45 } = {}) {
  // a chassis plate, and a tower on it: like any robot, most of it above the axles
  const solids = [{ name: 'Chassis Plate', kind: 'metal', pts: cyl([0, 0, 0.09], [0, 0, 1], 0.2, 0.004, 24, 2) },
    { name: 'Lift Tower', kind: 'metal', pts: cyl([0, 0, 0.25], [0, 0, 1], 0.05, 0.3, 8, 6) }];
  corners.forEach((k, i) => {
    const [x, y] = CORNERS[k];
    for (const p of mecanumWheel([x, y, 0.048], hands[k], { roll })) solids.push(flat ? p : Object.assign(p, { asm: [{ k: 'base', n: 'Drive Base' }, { k: 'w' + i, n: 'Wheel Assembly' }] }));
  });
  return { solids, parts: [], mechs: [] };
}

test('composite wheels: four mecanum wheels of plates and rollers, named nothing like wheels, are found and read as mecanum', () => {
  const d = E.driveFromCAD(robot(), { front: '+x' });
  assert.equal(d.kind, 'mecanum', d.why.join(' | '));
  assert.equal(d.wheels.length, 4);
  for (const w of d.wheels) assert.ok(Math.abs(w.r - 0.048) < 0.003, `radius ${(w.r * 1000).toFixed(1)} mm, the rollers' outer edge`);
  assert.ok(d.why.some((s) => /rollers at about 45 degrees/.test(s)));
  assert.ok(d.why.some((s) => /wheel assemblies/.test(s)));
});

test('composite wheels: each wheel’s hand is read off its floor roller, the standard X pattern', () => {
  const d = E.driveFromCAD(robot(), { front: '+x' });
  for (const w of d.wheels) assert.equal(w.roller, XPAT[w.corner], `${w.corner} hand ${w.roller}`);
  assert.ok(d.why.some((s) => /read off each wheel's own rollers.*the standard X pattern/.test(s)));
});

test('composite wheels: the same robot built "O" (every wheel the other hand) is modelled as drawn, and said to be wrong', () => {
  const O = Object.fromEntries(Object.entries(XPAT).map(([k, v]) => [k, -v]));
  const d = E.driveFromCAD(robot({ hands: O }), { front: '+x' });
  for (const w of d.wheels) assert.equal(w.roller, O[w.corner]);
  assert.ok(d.why.some((s) => /can't turn in place/.test(s)));
});

test('composite wheels: a flattened file (no sub-assemblies) still has its four wheels', () => {
  const d = E.driveFromCAD(robot({ flat: true }), { front: '+x' });
  assert.equal(d.kind, 'mecanum'); assert.equal(d.wheels.length, 4);
  assert.ok(d.why.some((s) => /packed round one centre/.test(s)));
});

test('composite wheels: one wheel drawn, the other three mirrored through the middle, in the X pattern', () => {
  const cad = robot({ corners: ['FR'] });
  // the rest of the robot, so its middle is where a real one's would be
  cad.solids[0].pts = cyl([0, 0, 0.09], [0, 0, 1], 0.26, 0.004, 32, 2);
  const d = E.driveFromCAD(cad, { front: '+x' });
  assert.equal(d.kind, 'mecanum'); assert.equal(d.wheels.length, 4);
  assert.deepEqual(d.wheels.map((w) => w.corner).sort(), ['BL', 'BR', 'FL', 'FR']);
  for (const w of d.wheels) assert.equal(w.roller, XPAT[w.corner], `${w.corner}`);
  assert.ok(d.why.some((s) => /Only one drive wheel is drawn/.test(s)));
  // and the wrong hand drawn: the mirrored set would be an O, so the X is used and the wheel is named
  const bad = robot({ corners: ['FR'], hands: { FR: 1 } });
  bad.solids[0].pts = cad.solids[0].pts;
  const b = E.driveFromCAD(bad, { front: '+x' });
  for (const w of b.wheels) assert.equal(w.roller, XPAT[w.corner]);
  assert.ok(b.why.some((s) => /Check that wheel in the CAD/.test(s)));
});

test('composite wheels: one wheel drawn and the four drive motors in the CAD: the rest go where the motors say, not round the middle of an arm out one side', () => {
  const cad = robot({ corners: ['FR'] });
  // a drive motor inboard of each corner, on the wheel's axle line, and an arm reaching 30 cm out to the left
  for (const [x, y] of Object.values(CORNERS))
    cad.solids.push({ name: '5203 Series Yellow Jacket Motor', kind: 'motor', pts: cyl([x, y - Math.sign(y) * 0.07, 0.048], [0, 1, 0], 0.018, 0.08, 8, 4) });
  cad.solids.push({ name: 'Intake Arm', kind: 'metal', pts: cyl([0, 0.42, 0.15], [0, 1, 0], 0.03, 0.3, 8, 6) });
  const d = E.driveFromCAD(cad, { front: '+x' });
  assert.equal(d.kind, 'mecanum'); assert.equal(d.wheels.length, 4);
  assert.ok(d.why.some((s) => /middle of the four drive motors/.test(s)), d.why.join(' | '));
  const byC = Object.fromEntries(d.wheels.map((w) => [w.corner, w]));
  // track and wheelbase as built: 380 mm and 340 mm, centred on the base, not on the arm
  assert.ok(Math.abs(byC.FL.y - byC.FR.y - 0.38) < 0.01 && Math.abs(byC.FL.x - byC.BL.x - 0.34) < 0.01, JSON.stringify(byC));
  for (const w of d.wheels) assert.equal(w.roller, XPAT[w.corner]);
  // and the robot frame puts the middle of the drive base at the origin
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of cad.solids) for (const p of s.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const F = E.robotFrame({ solids: cad.solids, bbox: { min: lo, max: hi } }, {});
  assert.equal(F.originWhy, 'wheels');
  assert.ok(Math.hypot(F.origin[0], F.origin[1]) < 0.01, 'origin at the base middle: ' + F.origin);
});

test('composite wheels: rollers square to the axle are omni wheels', () => {
  const d = E.driveFromCAD(robot({ roll: 88 }), { front: '+x' });
  assert.notEqual(d.kind, 'mecanum', 'not mecanum: ' + d.why.join(' | '));
  assert.ok(d.wheels.length === 4);
});

test('composite wheels: the frame finds up and the front from the same wheels', () => {
  const cad = robot();
  // modelled lying on its side: z in the CAD is the robot's left
  for (const s of cad.solids) s.pts = s.pts.map(([x, y, z]) => [x, -z, y]);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of cad.solids) for (const p of s.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const F = E.robotFrame({ solids: cad.solids, bbox: { min: lo, max: hi } }, {});
  assert.equal(F.up, '-y', F.upWhy);
  assert.equal(F.originWhy, 'wheels');
});
