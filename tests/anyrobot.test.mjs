// "ARE YOU SURE THAT ANY ROBOT WILL WORK?" — the acceptance suite that answers it.
//
// Every fixture in tests/fixtures/robots/ is a real B-rep STEP assembly written the way
// Onshape exports them (tools/stepgen.mjs, validated by OpenCascade), with a JSON sidecar
// holding the ground truth. Each robot goes through the real engine end to end:
//
//   parse -> OpenCascade agrees -> drivetrain -> mass -> robot frame -> spin in place
//
// The spin test is the one the user hit: command a pure turn (right_stick_x = 1, every
// other stick 0) for 2 s and the DRIVETRAIN CENTRE must stay put (< 5 mm) while the
// heading goes past 90 degrees — in 'rigid' physics and in 'kinematic'.
//
// Where the drivetrain centre is, on the field: THE placement contract, robotToWorld()
// in src/frame.js, which the physics, the collisions and the view all use. The TRUE
// drivetrain centre (from the ground truth) is pushed through the engine's own cad.frame,
// so if the engine picks the wrong origin the point orbits and the test sees it — and it
// takes the worst moment of the run, not start-vs-end, which a full turn could hide.
//
// Tests that fail are the answer to the question, not a reason to loosen it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadEngine, loadWithField, sampleBench, run, engineBundle, fixture } from './load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(HERE, 'fixtures', 'robots');
const NAMES = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const truthOf = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n + '.json'), 'utf8'));
const stepOf = (n) => fixture('robots/' + n + '.step');

/* The engine, with src/frame.js in it whether or not load.mjs lists it yet. */
const FRAME_SRC = path.join(ROOT, 'src', 'frame.js');
const bundle = engineBundle() + (fs.existsSync(FRAME_SRC) && !/robotFrame/.test(engineBundle()) ? '\n' + fs.readFileSync(FRAME_SRC, 'utf8') : '');
const E = loadWithField(bundle);
const robotFrame = E.robotFrame || new Function(bundle + '\nreturn typeof robotFrame === "function" ? robotFrame : undefined;')();
void loadEngine; void sampleBench;

/* OpenCascade: a devDependency, so its absence is a failure, not a skip. */
const OCCT_PATH = process.env.OCCT_IMPORT_JS || createRequire(import.meta.url).resolve('occt-import-js');
let occtP = null;
const occt = () => (occtP ||= createRequire(import.meta.url)(OCCT_PATH)());

/* ---- geometry helpers ---- */
const AX = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mm = (v) => (v * 1000).toFixed(1) + ' mm';
const v3 = (p) => '[' + p.map((x) => (+x).toFixed(4)).join(', ') + ']';

/* The truth, in the robot frame: x forward, y left, z up, origin drivetrain centre on the floor. */
function truthFrame(T) {
  const up = AX[T.up], fwd = AX[T.front], left = cross(up, fwd);
  const c = T.wheelCentroid || [(T.bbox.min[0] + T.bbox.max[0]) / 2, (T.bbox.min[1] + T.bbox.max[1]) / 2, (T.bbox.min[2] + T.bbox.max[2]) / 2];
  const toRobot = (p) => { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return [dot(d, fwd), dot(d, left), dot(p, up) - T.floorZ]; };
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const x of [T.bbox.min[0], T.bbox.max[0]]) for (const y of [T.bbox.min[1], T.bbox.max[1]]) for (const z of [T.bbox.min[2], T.bbox.max[2]]) {
    const r = toRobot([x, y, z]);
    bounds.minX = Math.min(bounds.minX, r[0]); bounds.maxX = Math.max(bounds.maxX, r[0]);
    bounds.minY = Math.min(bounds.minY, r[1]); bounds.maxY = Math.max(bounds.maxY, r[1]);
    bounds.minZ = Math.min(bounds.minZ, r[2]); bounds.maxZ = Math.max(bounds.maxZ, r[2]);
  }
  return { up, fwd, left, toRobot, bounds };
}

/* Where the truth lands in the coordinates the parser hands back. Today parseSTEP
   canonicalises (cad.frame: +z up, origin at the drivetrain centre on the floor, x/y the
   CAD's own horizontal axes); before that it returned raw CAD coordinates. The truth is
   mapped with ITS OWN up and origin, never the engine's, so engine errors stay visible. */
const UP_ROWS = {
  '+z': [[1, 0, 0], [0, 1, 0], [0, 0, 1]], '-z': [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
  '+y': [[1, 0, 0], [0, 0, -1], [0, 1, 0]], '-y': [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  '+x': [[0, 1, 0], [0, 0, 1], [1, 0, 0]], '-x': [[0, 1, 0], [0, 0, -1], [-1, 0, 0]]
};
const axisName = (v) => { for (const k in AX) if (dot(AX[k], v) > 0.999) return k; return null; };
function truthInCad(T, cad) {
  if (!cad || !cad.frame) return { toCad: (p) => p.slice(), dirToCad: (v) => v.slice(), up: T.up, front: T.front, canonical: false };
  const R = UP_ROWS[T.up], up = AX[T.up];
  const c = T.wheelCentroid || [0, 1, 2].map((k) => (T.bbox.min[k] + T.bbox.max[k]) / 2);
  const d = dot(c, up) - T.floorZ, O = [c[0] - d * up[0], c[1] - d * up[1], c[2] - d * up[2]];
  const rot = (v) => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];
  return { toCad: (p) => rot([p[0] - O[0], p[1] - O[1], p[2] - O[2]]), dirToCad: rot, up: '+z', front: axisName(rot(AX[T.front])), canonical: true };
}
function boxIn(T, map) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const q = map.toCad([i & 1 ? T.bbox.max[0] : T.bbox.min[0], i & 2 ? T.bbox.max[1] : T.bbox.min[1], i & 4 ? T.bbox.max[2] : T.bbox.min[2]]);
    for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); }
  }
  return { min: mn, max: mx };
}

/* The engine's robot frame for the RAW CAD: robotFrame() on it directly, or, when the
   parser already canonicalised, the frame it applied (cad.frame) followed by
   robotFrame() on the canonical CAD, which must then be the identity plus the front yaw. */
function engineFrame(cad, T) {
  if (!cad.frame) return { F: robotFrame(cad, { front: T.front }), second: null };
  const fr = cad.frame, O = fr.origin, R = fr.R;
  const rot = (v) => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];
  const F2 = robotFrame(cad, { front: truthInCad(T, cad).front });
  return {
    second: F2,
    F: { up: fr.up, upWhy: fr.upWhy, originWhy: fr.originWhy, front: F2.front, bounds: F2.bounds,
      toRobot: (p) => F2.toRobot(rot([p[0] - O[0], p[1] - O[1], p[2] - O[2]])), dirToRobot: (v) => F2.dirToRobot(rot(v)) }
  };
}

function inPolygon(p, poly) {                      // convex hull of the wheels, in plan
  const pts = poly.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of pts.slice().reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  const h = lo.slice(0, -1).concat(hi.slice(0, -1));
  for (let i = 0; i < h.length; i++) if (cr(h[i], h[(i + 1) % h.length], p) < 0) return false;
  return true;
}

const massClass = (kg) => (kg < 7.5 ? 'light' : kg < 14 ? 'typical' : 'heavy');

/* ---- OpModes for the drive bases DRIVE_JAVA (4 motors) does not cover ---- */
const TANK_JAVA = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
@TeleOp(name = "Tank Drive")
public class TankTeleOp extends LinearOpMode {
    DcMotor leftDrive;
    DcMotor rightDrive;
    @Override
    public void runOpMode() {
        leftDrive = hardwareMap.get(DcMotor.class, "leftDrive");
        rightDrive = hardwareMap.get(DcMotor.class, "rightDrive");
        leftDrive.setDirection(DcMotor.Direction.REVERSE);
        waitForStart();
        while (opModeIsActive()) {
            double y = -gamepad1.left_stick_y;
            double turn = gamepad1.right_stick_x;
            leftDrive.setPower(y + turn);
            rightDrive.setPower(y - turn);
        }
    }
}
`;
/* Kiwi: three omni wheels, each driven along its own tangent; a pure turn is all three the same way. */
const KIWI_JAVA = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
@TeleOp(name = "Kiwi Drive")
public class KiwiTeleOp extends LinearOpMode {
    DcMotor leftFront;
    DcMotor rightFront;
    DcMotor back;
    @Override
    public void runOpMode() {
        leftFront = hardwareMap.get(DcMotor.class, "leftFront");
        rightFront = hardwareMap.get(DcMotor.class, "rightFront");
        back = hardwareMap.get(DcMotor.class, "back");
        waitForStart();
        while (opModeIsActive()) {
            double y = -gamepad1.left_stick_y;
            double x = gamepad1.left_stick_x;
            double turn = gamepad1.right_stick_x;
            leftFront.setPower(0.866 * x + 0.5 * y + turn);
            rightFront.setPower(0.866 * x - 0.5 * y + turn);
            back.setPower(-x + turn);
        }
    }
}
`;
/* Swerve: drive motors carry the speed, steering servos the direction. A pure turn
   needs every module along the counter-clockwise tangent: FL 135, FR 45, BL 225, BR 315
   degrees. A module only sweeps +/-90 degrees (the bench's default calibration: 0.5 is
   straight ahead, 0..1 is 180 degrees, higher is counter-clockwise), so — like all real
   swerve code — FL and BL turn to the opposite angle and run their wheel backwards.
   (The first version of this OpMode drove all four the same way with mirrored servo
   offsets; worked through by hand, its left and right torques cancel under ANY single
   servo convention, so it could never have turned.) */
const SWERVE_JAVA = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.Servo;
@TeleOp(name = "Swerve Drive")
public class SwerveTeleOp extends LinearOpMode {
    DcMotor leftFront;
    DcMotor rightFront;
    DcMotor leftBack;
    DcMotor rightBack;
    Servo leftFrontSteer;
    Servo rightFrontSteer;
    Servo leftBackSteer;
    Servo rightBackSteer;
    @Override
    public void runOpMode() {
        leftFront = hardwareMap.get(DcMotor.class, "leftFront");
        rightFront = hardwareMap.get(DcMotor.class, "rightFront");
        leftBack = hardwareMap.get(DcMotor.class, "leftBack");
        rightBack = hardwareMap.get(DcMotor.class, "rightBack");
        leftFrontSteer = hardwareMap.get(Servo.class, "leftFrontSteer");
        rightFrontSteer = hardwareMap.get(Servo.class, "rightFrontSteer");
        leftBackSteer = hardwareMap.get(Servo.class, "leftBackSteer");
        rightBackSteer = hardwareMap.get(Servo.class, "rightBackSteer");
        waitForStart();
        while (opModeIsActive()) {
            double turn = gamepad1.right_stick_x;
            leftFrontSteer.setPosition(0.5 - 0.25 * turn);
            rightFrontSteer.setPosition(0.5 + 0.25 * turn);
            leftBackSteer.setPosition(0.5 + 0.25 * turn);
            rightBackSteer.setPosition(0.5 - 0.25 * turn);
            leftFront.setPower(-turn);
            rightFront.setPower(turn);
            leftBack.setPower(-turn);
            rightBack.setPower(turn);
        }
    }
}
`;
const opModeFor = (T) => (T.drive.kind === 'tank' ? TANK_JAVA : T.drive.kind === 'omni' ? KIWI_JAVA : T.drive.kind === 'swerve' ? SWERVE_JAVA : E.DRIVE_JAVA);

/* ---- the spin ---- */
const START = { x: 1.0, y: 1.0, h: 0 };            // open floor: 0.65 m from the nearest HIVE leg, 0.79 m from the walls

/* Where the TRUE drivetrain centre (the fixture's ground truth, raw CAD
   coordinates) sits in the coordinates the ENGINE draws and drives with — its
   own cad.frame. If the engine chose the wrong origin this point isn't at 0,
   and it orbits the pose as the robot turns: exactly the user's bug. */
function trueCentreInEngine(cad, T) {
  const c = T.wheelCentroid || [0, 1, 2].map((k) => (T.bbox.min[k] + T.bbox.max[k]) / 2);
  if (!cad.frame) return c.slice();
  const R = cad.frame.R, O = cad.frame.origin, d = [c[0] - O[0], c[1] - O[1], c[2] - O[2]];
  return [dot(R[0], d), dot(R[1], d), dot(R[2], d)];
}

function spin(name, physics, autoFront) {
  const T = truthOf(name);
  const cad = E.parseSTEP(stepOf(name));
  const code = E.parseJava(opModeFor(T));
  const map = E.autoMap(code.devices, cad.mechs);
  // autoFront: set nothing, the way a user who just dropped the file would —
  // the engine reads the front off the wheels
  const opts = { payloadKg: 0, duty: 0.30, trust: 'code', physics, startPose: { ...START } };
  if (!autoFront) opts.front = truthInCad(T, cad).front;
  E.Sim.reset(code, cad, map, opts);
  const front = E.Sim.opts.front;                 // the front the engine actually runs with
  E.Sim.pad = { 1: { right_stick_x: 1 }, 2: {} };
  // THE placement contract (src/frame.js robotToWorld) — the one the physics,
  // the collisions and the view all use — so this watches what the user sees
  const q = trueCentreInEngine(cad, T);
  const where = () => E.robotToWorld(E.Sim.chassis, front, q);
  const h0 = E.Sim.chassis.h, p0 = where();
  let bumped = null, drift = 0;
  for (let i = 0; i < 100; i++) {
    run(E, 0.02); bumped = bumped || E.Sim.bump;
    // the worst moment, not the end: a robot that turns a full circle comes
    // back to where it started and would hide any drift in between
    const p = where(); drift = Math.max(drift, Math.hypot(p[0] - p0[0], p[1] - p0[1]));
  }
  const pose = Math.hypot(E.Sim.chassis.x - START.x, E.Sim.chassis.y - START.y);
  const turned = Math.abs(E.Sim.chassis.h - h0);
  const info = name + ' ' + physics + ': drivetrain centre moved up to ' + mm(drift) + ' (the pose itself ' + mm(pose) + '), heading changed ' +
    (turned * 180 / Math.PI).toFixed(0) + ' deg; true drivetrain centre ' + mm(Math.hypot(q[0], q[1])) + ' off the engine origin' +
    '; drivetrain ' + (E.Sim.drivetrain ? E.Sim.drivetrain.wheels.length + ' motors ok=' + E.Sim.drivetrain.ok : 'none') +
    (E.Sim.rig ? '; rig ' + E.Sim.rig.drive.kind + ' ' + E.Sim.rig.props.kg.toFixed(1) + ' kg' + (E.Sim.rig.props.assumed ? ' (assumed)' : '') + ', COM ' + v3([E.Sim.rig.props.com.x, E.Sim.rig.props.com.y, E.Sim.rig.props.com.z]) : '; no rig') +
    (bumped ? '; hit ' + bumped : '');
  return { drift, turned, info };
}

/* ---- per-robot suites ---- */
const parsed = new Map();
const cadOf = (n) => { if (!parsed.has(n)) parsed.set(n, E.parseSTEP(stepOf(n))); return parsed.get(n); };

for (const name of NAMES) {
  const T = truthOf(name);
  describe(name, () => {
    test('parseSTEP places every part', () => {
      const cad = cadOf(name);
      assert.equal(cad.placements.length, T.occurrences, 'placements vs NAUOs in the file');
      assert.equal(cad.solids.length, T.leafParts, 'solids: ' + cad.solids.length + ' of ' + T.leafParts + ' leaf parts came out as solids');
      const want = T.units === 'in' ? 'INCH' : T.units === 'mm' ? 'MILLIMETRE' : 'METRE';
      assert.equal(cad.units, want, 'units in the representation context');
    });

    test('cad.bbox matches the true extent within 5 mm', () => {
      const cad = cadOf(name), b = cad.bbox, map = truthInCad(T, cad), tb = boxIn(T, map);
      const where = map.canonical ? ' (canonical frame; truth mapped by its own up and origin)' : ' (CAD coordinates)';
      for (let k = 0; k < 3; k++) {
        const ax = 'xyz'[k];
        assert.ok(Math.abs(b.min[k] - tb.min[k]) < 0.005, 'min ' + ax + ': parsed ' + b.min[k].toFixed(4) + ', true ' + tb.min[k].toFixed(4) + ' (off ' + mm(Math.abs(b.min[k] - tb.min[k])) + ')' + where);
        assert.ok(Math.abs(b.max[k] - tb.max[k]) < 0.005, 'max ' + ax + ': parsed ' + b.max[k].toFixed(4) + ', true ' + tb.max[k].toFixed(4) + ' (off ' + mm(Math.abs(b.max[k] - tb.max[k])) + ')' + where);
      }
    });

    test('OpenCascade tessellates every part', async (t) => {
      const oc = await occt();
      assert.ok(oc, 'occt-import-js did not load from ' + OCCT_PATH);
      const r = oc.ReadStepFile(new TextEncoder().encode(stepOf(name)), { linearUnit: 'meter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 });
      assert.ok(r.success, 'occt could not read the file');
      const empty = r.meshes.filter((m) => !(m.index && m.index.array.length && m.attributes.position.array.length)).length;
      assert.equal(empty, 0, empty + ' empty meshes');
      assert.equal(r.meshes.length, T.bodies, 'one mesh per solid body');
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const m of r.meshes) { const P = m.attributes.position.array; for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); } }
      for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(mn[k] - T.bbox.min[k]) < 0.002 && Math.abs(mx[k] - T.bbox.max[k]) < 0.002, 'occt extent ' + v3(mn) + '..' + v3(mx) + ' vs truth');
      }
    });

    test('driveFromCAD finds the drivetrain', () => {
      const cad = cadOf(name), map = truthInCad(T, cad);
      const d = E.driveFromCAD(cad, { front: map.front, up: map.up });
      const why = ' | why: ' + d.why.join(' / ');
      const want = T.drive.kind === 'none' ? 'unknown' : T.drive.kind;
      assert.equal(d.kind, want, 'kind' + why);
      assert.equal(d.wheels.length, T.drive.wheels, 'wheel count' + why);
      for (const w of d.wheels) assert.ok(Math.abs(w.r - T.drive.radius) < 0.003, 'wheel radius ' + mm(w.r) + ' vs true ' + mm(T.drive.radius) + why);
    });

    test('massProps: mass within the stated accuracy of the model, COM inside the wheelbase', () => {
      const cad = cadOf(name), mp = E.massProps(cad), map = truthInCad(T, cad);
      const com = [mp.com.x, mp.com.y, mp.com.z];
      // CAD-derived mass is volume x density x an honest fill factor: good to
      // about +/-30 %, which is exactly why the Math tab calls it an estimate.
      // A mass class let 0 kg pass on 13 of 14 robots; this band does not.
      const ratio = mp.kg / T.massKg;
      assert.ok(ratio > 0.65 && ratio < 1.4, 'mass ' + mp.kg.toFixed(2) + ' kg vs true ' + T.massKg + ' kg (x' + ratio.toFixed(2) + ')');
      // plan coordinates in the cad's own axes: along front, and along up x front
      const up = AX[map.up], fw = AX[map.front], lf = cross(up, fw);
      const plan = (p) => [dot(p, fw), dot(p, lf)];
      if (T.wheels.length >= 3) {
        const poly = T.wheels.map((w) => plan(map.toCad(w.c)));
        const c = plan(com);
        assert.ok(inPolygon(c, poly), 'COM ' + v3(com) + ' (plan ' + v3(c) + ') is outside the wheels ' + poly.map(v3).join(' '));
      } else if (T.wheels.length === 0) {
        const tb = boxIn(T, map);
        assert.ok([0, 1, 2].every((k) => com[k] > tb.min[k] && com[k] < tb.max[k]), 'COM ' + v3(com) + ' is outside the robot itself');
      }
    });

    test('robotFrame: up, origin on the drivetrain centre at the floor, bounds', (t) => {
      assert.equal(typeof robotFrame, 'function', 'robotFrame missing (src/frame.js)');
      const cad = cadOf(name), ef = engineFrame(cad, T), f = ef.F;
      const F = truthFrame(T);
      if (ef.second) assert.equal(ef.second.up, '+z', 'robotFrame on the already-canonical CAD should find +z up (found ' + ef.second.up + ')');
      assert.equal(f.up, T.up, 'up axis (upWhy: ' + f.upWhy + ')');
      assert.equal(f.front, truthInCad(T, cad).front, 'front');
      const fw = f.dirToRobot(AX[T.front]);
      assert.ok(Math.abs(fw[0] - 1) < 1e-6 && Math.abs(fw[1]) < 1e-6 && Math.abs(fw[2]) < 1e-6, 'dirToRobot(front) = ' + v3(fw) + ', want [1,0,0]');
      const upR = f.dirToRobot(AX[T.up]);
      assert.ok(Math.abs(upR[2] - 1) < 1e-6, 'dirToRobot(up) = ' + v3(upR) + ', want [0,0,1]');
      if (T.wheelCentroid) {
        assert.equal(f.originWhy, 'wheels', 'originWhy');
        const r = f.toRobot(T.wheelCentroid), want = F.toRobot(T.wheelCentroid);
        assert.ok(Math.hypot(r[0], r[1]) < 0.003, 'toRobot(wheel centroid) = ' + v3(r) + ': not on the origin in plan (off ' + mm(Math.hypot(r[0], r[1])) + ')');
        assert.ok(Math.abs(r[2] - want[2]) < 0.003, 'toRobot(wheel centroid) z = ' + mm(r[2]) + ', want the axle height ' + mm(want[2]));
      } else {
        assert.equal(f.originWhy, 'bbox', 'originWhy for a robot with no wheels');
      }
      const b = f.bounds, tb = F.bounds;
      assert.ok(Math.abs(b.minZ) < 0.003, 'bounds.minZ = ' + mm(b.minZ) + ', want the floor at 0');
      for (const k of ['minX', 'maxX', 'minY', 'maxY', 'maxZ'])
        assert.ok(Math.abs(b[k] - tb[k]) < 0.005, 'bounds.' + k + ' = ' + (b[k] * 1000).toFixed(1) + ' mm, true ' + (tb[k] * 1000).toFixed(1) + ' mm');
    });

    test('the front comes from the wheels: square to the axles', () => {
      // the default front used to be +x for every robot, and every robot modelled
      // facing +y slid ~400 mm sideways when it turned
      const cad = cadOf(name), f = E.frontFromWheels(cad), truth = truthInCad(T, cad).front;
      if (!T.wheels.length || T.drive.kind === 'x' || T.drive.kind === 'omni') { assert.equal(f, null, 'any front drives this base, got ' + f); return; }
      assert.ok(f && f.slice(1) === truth.slice(1), 'front from the wheels ' + f + ', the robot really faces ' + truth);
      assert.equal(E.frontAcrossWheels(cad, truth), false);
      assert.equal(E.frontAcrossWheels(cad, truth.slice(1) === 'x' ? '+y' : '+x'), true, 'a front across the wheels is caught');
    });

    for (const physics of ['rigid', 'kinematic']) {
      test('spin in place (' + physics + '): drivetrain centre < 5 mm, heading > 90 deg', () => {
        const s = spin(name, physics);
        assert.ok(s.turned > Math.PI / 2, 'did not turn: ' + s.info);
        assert.ok(s.drift < 0.005, 'the chassis moves while turning: ' + s.info);
      });
      test('spin in place with NO front set (' + physics + '): what a user who just dropped the file gets', () => {
        const s = spin(name, physics, true);
        assert.ok(s.turned > Math.PI / 2, 'did not turn: ' + s.info);
        assert.ok(s.drift < 0.005, 'the chassis moves while turning: ' + s.info);
      });
    }
  });
}

test('performance: parseSTEP on "big" (~1500 parts) under 3 s', () => {
  const txt = stepOf('big');
  const t0 = performance.now();
  const cad = E.parseSTEP(txt);
  const ms = performance.now() - t0;
  assert.ok(cad.solids.length > 1000, 'parsed only ' + cad.solids.length + ' solids');
  assert.ok(ms < 3000, 'parseSTEP took ' + ms.toFixed(0) + ' ms');
});

test('the corpus is all there and every fixture is small enough to commit', () => {
  const want = ['mecanum-zup', 'mecanum-offset', 'mecanum-yup', 'mecanum-inch', 'mecanum-front-y', 'tank-traction', 'tank-6wd', 'xdrive', 'kiwi', 'swerve', 'unnamed-wheels', 'nested', 'big', 'arm-only'];
  for (const n of want) assert.ok(NAMES.includes(n), n + ' missing from tests/fixtures/robots');
  for (const n of NAMES) assert.ok(stepOf(n).length < 400 * 1024, n + '.step is over 400 KB');
});
