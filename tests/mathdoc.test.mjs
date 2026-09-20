// SHOW MATH: the portfolio exporter. The rig below has a gear ratio, a wheel
// radius and a mass that were all chosen so every figure in this file can be
// worked out by hand; each test states the arithmetic it is checking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadWithField, sampleBench } from './load.mjs';

const E = loadEngine();

/* ---- the rig ----------------------------------------------------------
   Four goBILDA Yellow Jacket 435 rpm motors (13.7:1, 1.68 N.m stall) on
   96 mm wheels, 12.5 kg, and one servo on a lift pivot that rests 30 deg
   above horizontal. Those are the only inputs; everything else is derived. */
const RIG_JAVA = `
@TeleOp(name="Rig")
public class Rig extends LinearOpMode {
  // 435 rpm goBILDA Yellow Jacket
  private DcMotorEx fl;
  // 435 rpm goBILDA Yellow Jacket
  private DcMotorEx fr;
  // 435 rpm goBILDA Yellow Jacket
  private DcMotorEx bl;
  // 435 rpm goBILDA Yellow Jacket
  private DcMotorEx br;
  private Servo arm;
  @Override public void runOpMode() {
    fl = hardwareMap.get(DcMotorEx.class, "fl");
    fr = hardwareMap.get(DcMotorEx.class, "fr");
    bl = hardwareMap.get(DcMotorEx.class, "bl");
    br = hardwareMap.get(DcMotorEx.class, "br");
    arm = hardwareMap.get(Servo.class, "arm");
    fl.setVelocityPIDFCoefficients(12.5, 0.5, 2.0, 14.0);
    arm.setPosition(0.5);
    waitForStart();
    while (opModeIsActive()) {
      double y = -gamepad1.left_stick_y;
      double x = gamepad1.left_stick_x;
      double rx = gamepad1.right_stick_x;
      fl.setPower(y + x + rx);
      fr.setPower(y - x - rx);
      bl.setPower(y - x + rx);
      br.setPower(y + x - rx);
      arm.setPosition(0.6);
    }
  }
}`;

const R = 0.048;                 // wheel radius, m
const GEAR = 13.7;               // goBILDA 435 rpm gearbox
const KG = 12.5;                 // robot mass, kg
const GRAV = 9.80665;

// pivot to load: 0.2 m at 30 deg up, so lever = 0.2 and restAngleDeg = 30
const ARM_MECH = {
  id: 'm1', kind: 'revolute-lift', label: 'Test arm', parent: 'chassis',
  pivot: [0, 0, 0], distalTo: [0.2 * Math.cos(Math.PI / 6), 0, 0.2 * Math.sin(Math.PI / 6)],
  lever: 0.2, restAngleDeg: 30,
};

// Wheels centred on x = 0.20 so the centre-of-mass offset has a direction the
// test can check the sign of; the IK is a textbook symmetric mecanum.
const L = 0.20;                                     // (track + base) / 2
const ikRow = (sx, sw) => [1 / R, sx / R, sw * L / R];
function rigBench(over) {
  const code = E.parseJava(RIG_JAVA);
  return Object.assign({
    cad: { mechs: [ARM_MECH] },
    code,
    map: { arm: 'm1' },
    opts: { payloadKg: 0.180, duty: 0.30, trust: 'code', mu: 0.90, batteryV: 12 },
    mass: {
      kg: KG, com: { x: 0.10, y: -0.05, z: 0.18 }, comHeight: 0.18, Izz: 0.42,
      parts: [{ name: 'chassis plate', kg: 1.2, how: 'vendor mass, goBILDA catalog' },
              { name: 'battery', kg: 0.62, how: 'estimated from 6061 density' }],
      confidence: 0.9,
    },
    drive: {
      kind: 'mecanum', track: 0.30, base: 0.30, confidence: 0.9,
      wheels: [{ x: 0.20 - 0.18, y: 0.15, z: R, r: R, corner: 'fl' },
               { x: 0.20 - 0.18, y: -0.15, z: R, r: R, corner: 'fr' },
               { x: 0.20 + 0.18, y: 0.15, z: R, r: R, corner: 'bl' },
               { x: 0.20 + 0.18, y: -0.15, z: R, r: R, corner: 'br' }],
      ik: [ikRow(-1, -1), ikRow(1, 1), ikRow(1, -1), ikRow(-1, 1)],
    },
  }, over || {});
}

const sec = (rep, id) => rep.sections.filter((s) => s.id === id)[0];
const row = (s, re) => (s.rows || []).filter((r) => re.test(r.label))[0];
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: got ${a}, expected ${b} +/- ${tol}`);

/* ==================================================== the worked example ==== */

test('v_max: the hand calculation reaches the text', () => {
  // n_motor = 435 rpm * 13.7 = 5959.5 rpm
  // w_free  = 5959.5 * 2pi/60 = 624.0774 rad/s
  // v_max   = 624.0774 * 0.048 / 13.7 = 2.1865485 m/s
  //           (equivalently the wheel's own 435 rpm = 45.5531 rad/s times r)
  const rep = E.mathReport(rigBench());
  const r = row(sec(rep, 'drive'), /maximum linear speed/);
  near(r.value, 2.1865485, 1e-6, 'v_max');
  assert.equal(r.unit, 'm/s');

  // the same number, printed, and the inputs it came from printed beside it
  const txt = E.mathText(rep);
  assert.ok(txt.includes('2.19 m/s'), 'v_max is not in the text');
  assert.ok(/624/.test(r.expr) && /0\.048/.test(r.expr) && /13\.7/.test(r.expr),
    `the substituted inputs are missing from "${r.expr}"`);
  assert.ok(txt.includes('435'), 'the motor free speed is not in the text');
});

test('v_max: the documented 19.2:1 example comes out at 1.57 m/s', () => {
  // 312 rpm Yellow Jacket: 312 * 19.2 = 5990.4 rpm -> 627.311 rad/s
  //   v = 627.311 * 0.048 / 19.2 = 1.568283 m/s
  const b = rigBench();
  b.code = E.parseJava(RIG_JAVA.replace(/435 rpm/g, '312 rpm'));
  const rep = E.mathReport(b);
  const r = row(sec(rep, 'drive'), /maximum linear speed/);
  near(r.value, 1.568283, 1e-5, 'v_max at 19.2:1');
  assert.ok(E.mathText(rep).includes('1.57 m/s'), 'the 1.57 m/s example is not in the text');
  // and the gear ratio really came from the code, not from a default
  near(row(sec(rep, 'drive'), /gear ratio/).value, 19.2, 1e-9, 'gear ratio');
});

test('the gear ratio is read from the OpMode, not assumed', () => {
  // the generic fallback motor is 19.2:1; this rig is 13.7:1, so a report that
  // fell back to the default would give 1.568 m/s here instead of 2.187
  const rep = E.mathReport(rigBench());
  const g = row(sec(rep, 'drive'), /gear ratio/);
  near(g.value, GEAR, 1e-9, 'gear ratio');
  assert.equal(g.source, 'vendor spec');
  assert.ok(/goBILDA/.test(g.note), `the motor family is missing from "${g.note}"`);
});

/* ============================================================== units ==== */

test('free speed converts rpm to rad/s, not the other way round', () => {
  // 5959.5 rpm * 2pi/60 = 624.0774 rad/s. Dividing instead would give 56 900.
  const r = row(sec(E.mathReport(rigBench()), 'drive'), /free speed/);
  near(r.value, 624.0774, 1e-3, 'omega_free');
  assert.equal(r.unit, 'rad/s');
});

test('the odometry constant uses the radius, not the diameter', () => {
  // s = 2pi * 0.048 / (28 * 13.7) = 0.30159289 / 383.6 = 7.8621714e-4 m/tick
  // using the diameter would double it, and 1 m would come out at 636 ticks
  const r = row(sec(E.mathReport(rigBench()), 'drive'), /odometry constant/);
  near(r.value, 7.8621714e-4, 1e-10, 'metres per tick');
  near(1 / r.value, 1271.9, 0.1, 'ticks per metre');
  assert.equal(r.unit, 'm/tick');
  assert.ok(/28/.test(r.expr), 'the ticks per motor revolution are not shown');
});

test('the IK matrix prints one row per wheel, labelled', () => {
  const r = row(sec(E.mathReport(rigBench()), 'drive'), /inverse kinematics/);
  const lines = r.expr.split('\n').filter((l) => /\[/.test(l));
  assert.equal(lines.length, 4, 'one line per wheel');
  assert.ok(/FL/.test(r.expr) && /BR/.test(r.expr), `wheel labels are missing from\n${r.expr}`);
  // 1/0.048 = 20.8333 is the forward coefficient
  assert.ok(/20\.8/.test(r.expr), 'the matrix entries are not the wheel coefficients');
});

test('the strafe factor is forward over strafe, not strafe over forward', () => {
  const b = rigBench();
  b.drive = Object.assign({}, b.drive, { ik: [[2, -1, 0], [2, 1, 0], [2, 1, 0], [2, -1, 0]] });
  const r = row(sec(E.mathReport(b), 'drive'), /strafe factor/);
  near(r.value, 2, 1e-12, 'strafe factor');   // inverted it would be 0.5
});

/* ============================================================== signs ==== */

test('the centre-of-mass offset points from the wheels to the mass', () => {
  // wheels average to x = 0.20, y = 0; the mass sits at (0.10, -0.05)
  // so the offset is (-0.10, -0.05) and |offset| = 0.1118034
  const r = row(sec(E.mathReport(rigBench()), 'mass'), /offset from the drive centre/);
  near(r.value, 0.1118034, 1e-6, '|offset|');
  assert.ok(/-0\.1\b/.test(r.expr) && /-0\.05/.test(r.expr),
    `the offset has the wrong sign or is not substituted: "${r.expr}"`);
});

test('traction governs this rig, and the report says so', () => {
  // a_traction = 0.9 * 9.80665 = 8.825985
  // a_motor    = 4 * 1.68 / (0.048 * 12.5) = 6.72 / 0.6 = 11.2
  const s = sec(E.mathReport(rigBench()), 'traction');
  near(row(s, /traction-limited/).value, 0.9 * GRAV, 1e-9, 'a_traction');
  near(row(s, /motor-limited/).value, 11.2, 1e-9, 'a_motor');
  const g = row(s, /governing limit/);
  near(g.value, 8.825985, 1e-6, 'governing acceleration');   // max() would give 11.2
  assert.ok(/traction governs/.test(g.expr), `expected traction to govern: "${g.expr}"`);
});

test('weight per wheel and the friction limit are forces, per wheel', () => {
  // W = 12.5 * 9.80665 / 4 = 30.6458 N;  F_max = 0.9 * 12.5 * 9.80665 = 110.325 N
  const s = sec(E.mathReport(rigBench()), 'traction');
  near(row(s, /weight per wheel/).value, KG * GRAV / 4, 1e-9, 'weight per wheel');
  assert.equal(row(s, /weight per wheel/).unit, 'N');
  near(row(s, /friction limit/).value, 0.9 * KG * GRAV, 1e-9, 'F_max');
});

/* ====================================================== joint torque ==== */

test('holding torque takes the cosine in degrees, not radians', () => {
  // the arm rests at 30 deg and sweeps to 60, so the worst angle is 30 deg
  // load = 0.180 + 0.060 + 0.055 = 0.295 kg
  // tau  = 0.295 * 9.80665 * 0.2 * cos 30 = 0.5785924 * 0.8660254 = 0.5010757 N.m
  // in radians cos(30) = 0.15425 and this would come out at 0.0892
  const s = sec(E.mathReport(rigBench()), 'torque');
  near(row(s, /lever arm/).value, 0.2, 1e-9, 'lever');
  near(row(s, /load on the lever/).value, 0.295, 1e-12, 'load');
  const t = row(s, /holding torque needed/);
  near(t.value, 0.5010757, 1e-6, 'holding torque');
  assert.equal(t.unit, 'N·m');
  assert.ok(/cos 30/.test(t.expr), `the worst angle is not substituted: "${t.expr}"`);
});

test('the safety margin derates the stall torque, it does not inflate the load', () => {
  // n = 1.5 N.m * 0.30 / 0.5010757 = 0.45 / 0.5010757 = 0.898067
  // applying the duty to the requirement instead would give 9.98
  const s = sec(E.mathReport(rigBench()), 'torque');
  near(row(s, /stall torque/).value, 1.5, 1e-12, 'stall torque');
  const m = row(s, /safety margin/);
  near(m.value, 0.898067, 1e-5, 'safety margin');
  assert.ok(/cannot hold its load/.test(m.note), 'a margin under 1.0 should be called out');
});

/* ================================================ feedforward and PID ==== */

test('kV and kA are volts per unit of motion', () => {
  // kV = 12 / 2.1865485 = 5.4881015 V.s/m ; kA = 12 / 11.2 = 1.071429 V.s^2/m
  // a kV built on rpm rather than m/s would land near 0.002
  const s = sec(E.mathReport(rigBench()), 'ff');
  near(row(s, /^kV/).value, 5.4881015, 1e-6, 'kV');
  near(row(s, /^kA/).value, 1.071429, 1e-6, 'kA');
});

test('the PID gains the OpMode actually sets are the ones reported', () => {
  const s = sec(E.mathReport(rigBench()), 'ff');
  const r = row(s, /PID gains/);
  assert.equal(r.source, 'code');
  for (const n of ['12.5', '0.5', '2', '14']) assert.ok(r.expr.includes(n), `gain ${n} is missing from "${r.expr}"`);
  assert.ok(!/SDK/.test(r.note), 'tuned gains must not be called defaults');
});

test('an OpMode that sets no gains is told the SDK defaults stand', () => {
  const b = rigBench();
  b.code = E.parseJava(RIG_JAVA.replace(/fl\.setVelocityPIDFCoefficients\([^)]*\);/, ''));
  const r = row(sec(E.mathReport(b), 'ff'), /PID/);
  assert.ok(/missing:/.test(r.note) && /P 10, I 3/.test(r.note), `expected the SDK defaults: "${r.note}"`);
});

/* ================================================== output well-formed ==== */

const BAD = ['NaN', 'undefined', 'null'];
function assertClean(s, what) {
  for (const b of BAD) assert.ok(!s.includes(b), `${what} contains "${b}"`);
}

test('no NaN, undefined or null reaches the page, for any bench', () => {
  const benches = { rig: rigBench(), sample: sampleBench(E), empty: {}, nothing: undefined };
  for (const k in benches) {
    const rep = E.mathReport(benches[k]);
    assertClean(E.mathText(rep), `mathText(${k})`);
    assertClean(E.mathMarkdown(rep), `mathMarkdown(${k})`);
  }
});

test('every row is a complete record', () => {
  for (const s of E.mathReport(rigBench()).sections) {
    assert.ok(s.id && s.title && s.intro, `section ${s.id} is missing its header`);
    assert.ok(s.rows.length > 0, `section ${s.id} has no rows`);
    for (const r of s.rows) {
      assert.equal(typeof r.label, 'string');
      assert.ok(r.label.length > 0, `a row in ${s.id} has no label`);
      assert.ok(['CAD', 'code', 'vendor spec', 'Shot Sim', 'assumption'].includes(r.source),
        `row "${r.label}" has source "${r.source}"`);
    }
  }
});

test('markdown tables are well formed', () => {
  for (const b of [rigBench(), sampleBench(E), {}]) {
    const md = E.mathMarkdown(E.mathReport(b));
    let cols = 0, seen = 0;
    for (const line of md.split('\n')) {
      if (line[0] !== '|') continue;
      assert.ok(line.endsWith('|'), `unterminated table row: ${line}`);
      const n = line.split('|').length - 2;      // the leading and trailing pipes
      if (/^\|\s*Quantity\s*\|/.test(line)) { cols = n; seen++; assert.equal(n, 6, 'header width'); }
      else assert.equal(n, cols, `row has ${n} cells, header has ${cols}: ${line}`);
    }
    assert.ok(seen >= 4, `expected a table per section, found ${seen}`);
  }
});

/* ================================================== missing inputs ==== */

test('a bench with no drivetrain still reports, and names what is missing', () => {
  const rep = E.mathReport({});
  assert.ok(rep.sections.length >= 5, 'the sections should still be there');

  const d = sec(rep, 'drive');
  const wr = row(d, /wheel radius/);
  assert.ok(/^missing:/.test(wr.note), `expected a missing-input note, got "${wr.note}"`);
  assert.ok(/drivetrain\.js|wheelRm/.test(wr.note), `the note should say what to supply: "${wr.note}"`);
  assert.equal(wr.value, null);

  // and it must not invent a speed out of nothing
  assert.equal(row(d, /maximum linear speed/).value, null);
  assert.ok(/^missing:/.test(row(sec(rep, 'mass'), /total mass/).note));
  assert.ok(/^missing:/.test(row(sec(rep, 'traction'), /weight per wheel/).note));

  const txt = E.mathText(rep);
  assert.ok(txt.includes('missing:'), 'the text should say what is missing');
  assertClean(txt, 'mathText(empty)');
});

test('a bench with mass but no wheels says which of the two is missing', () => {
  const b = rigBench();
  delete b.drive;                                   // mass stays, the wheels go
  const rep = E.mathReport(b);
  const off = row(sec(rep, 'mass'), /offset from the drive centre/);
  assert.ok(/wheel positions/.test(off.note), `expected the wheels to be named: "${off.note}"`);
  // the mass rows are unaffected
  near(row(sec(rep, 'mass'), /total mass/).value, KG, 1e-12, 'total mass');
});

test('per-part masses carry how each one was obtained', () => {
  const s = sec(E.mathReport(rigBench()), 'mass');
  const plate = row(s, /chassis plate/), batt = row(s, /battery/);
  assert.equal(plate.source, 'vendor spec');        // "vendor mass, goBILDA catalog"
  assert.equal(batt.source, 'assumption');          // "estimated from 6061 density"
  near(plate.value, 1.2, 1e-12, 'plate mass');
  assert.ok(/density/.test(batt.note), 'the estimate should say what it was estimated from');
});

test('no shooter section when the robot has no flywheel', () => {
  assert.equal(sec(E.mathReport(rigBench()), 'shooter'), undefined);
});

/* ========================================================== shooter ==== */
/* A second engine, with the BIOBUZZ Shot Sim's measured field switched on —
   the shooter section is the only one that needs it. */
const F = loadWithField();

function shooterBench(opts) {
  const b = sampleBench(F, F.SHOOTER_JAVA);
  F.Shots.cfg = null;                          // the Shot tab, as the app leaves it
  F.Shots.adopt(b.code);
  b.opts = Object.assign(b.opts, opts || {});
  return b;
}

test('flywheel speed comes from the velocity the OpMode commands, not its rest value', () => {
  // the OpMode holds the target in a variable declared "double target = 0" and
  // writes FAR_VELOCITY = 1280 tick/s into it; 0 is the rest state, not the shot
  // n = 60 * 1280 / 28 = 2742.857 rpm  (6000 rpm motor, 1:1, so 28 ticks/rev)
  const s = sec(F.mathReport(shooterBench()), 'shooter');
  const n = row(s, /flywheel speed/);
  near(n.value, 2742.857143, 1e-5, 'flywheel rpm');
  assert.equal(n.source, 'code');
  assert.ok(n.expr.includes('1280'), `the commanded velocity is not substituted: "${n.expr}"`);
});

test('surface speed is pi*d*n/60, with the diameter in metres', () => {
  // v = pi * 0.096 m * 1280/28 rev/s = 0.3015929 * 45.714286 = 13.787104 m/s
  const s = sec(F.mathReport(shooterBench()), 'shooter');
  const v = row(s, /surface speed/);
  near(v.value, 13.787104, 1e-5, 'surface speed');
  assert.equal(v.unit, 'm/s');
  // the exit speed is a fraction of it: a ball never leaves faster than the rim
  const x = row(s, /exit speed/);
  assert.ok(x.value > 0 && x.value < v.value, `exit ${x.value} should be under rim ${v.value}`);
  assert.equal(x.source, 'Shot Sim');
});

test('kinetic energy uses kilograms, not grams', () => {
  // a POLLEN is 24.9 g = 0.0249 kg; leaving it in grams would inflate E by 1000
  const s = sec(F.mathReport(shooterBench()), 'shooter');
  const m = row(s, /mass/), e = row(s, /kinetic energy/), x = row(s, /exit speed/);
  near(m.value, 0.0249, 1e-12, 'ball mass');
  assert.equal(m.unit, 'kg');
  near(e.value, 0.5 * m.value * x.value * x.value, 1e-12, 'E = 1/2 m v^2');
  assert.ok(e.value > 0.1 && e.value < 5, `a shot is joules, not kilojoules: ${e.value} J`);
});

test('the scoring window fills in when the robot is aimed at the CELL', () => {
  // from 60 in back on the red side, turned 20 deg off the wall, a 75 deg hood
  // has one narrow band of exit speeds that scores, a little over 6 m/s
  const b = shooterBench({ pose: { x: -60 * F.IN, y: 0, h: -20 * Math.PI / 180 } });
  const s = sec(F.mathReport(b), 'shooter');
  const w = row(s, /scoring speed window/);
  assert.equal(w.source, 'Shot Sim');
  assert.ok(/hood 75/.test(w.expr), `the hood angle should be substituted: "${w.expr}"`);
  assert.ok(/\(-60, 0\) in/.test(w.expr), `the pose should be printed in inches: "${w.expr}"`);

  const band = /\[([\d.]+), ([\d.]+)\] m\/s/.exec(w.expr);
  assert.ok(band, `the window should print as a band: "${w.expr}"`);
  const lo = +band[1], hi = +band[2];
  assert.ok(lo < hi, `the window is inverted: ${lo} to ${hi}`);
  assert.ok(lo > 4 && hi < 9, `a steep BIOBUZZ shot is about 6 m/s, got ${lo} to ${hi}`);
  near(w.value, hi - lo, 0.02, 'the reported width is the printed band');

  // and the section cross-checks itself: this robot's own exit speed sits in it
  const x = row(s, /exit speed/);
  assert.ok(x.value >= lo && x.value <= hi, `exit ${x.value} should be inside ${lo}..${hi}`);
  assert.ok(/lands inside it/.test(w.note), `expected the note to say so: "${w.note}"`);
});

test('an unaimed robot is told why there is no window, not that the sim is missing', () => {
  // the field IS loaded here: the honest answer is that nothing scores from
  // the start pose, and the note must say that rather than blame the sim
  const w = row(sec(F.mathReport(shooterBench()), 'shooter'), /scoring speed window/);
  assert.ok(/^missing:/.test(w.note));
  assert.ok(/hood/.test(w.note) && /CELL/.test(w.note), `expected an aiming note: "${w.note}"`);
  assert.ok(!/isn't loaded/.test(w.note), 'must not claim the Shot Sim is missing when it is loaded');
});

test('the shooter section is clean and well formed too', () => {
  const rep = F.mathReport(shooterBench());
  assert.ok(sec(rep, 'shooter'), 'the shooter section should be present');
  assertClean(F.mathText(rep), 'mathText(shooter)');
  assertClean(F.mathMarkdown(rep), 'mathMarkdown(shooter)');
});

test('mathText and mathMarkdown survive an empty report', () => {
  for (const r of [{ sections: [] }, {}, undefined]) {
    assert.equal(typeof E.mathText(r), 'string');
    assert.equal(typeof E.mathMarkdown(r), 'string');
  }
});

test('the report is deterministic', () => {
  const a = E.mathText(E.mathReport(rigBench()));
  const b = E.mathText(E.mathReport(rigBench()));
  assert.equal(a, b);
});
