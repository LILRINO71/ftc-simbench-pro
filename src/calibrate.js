/* ============================================================
   6d.  CALIBRATION — fit the sim's drivetrain to a few measured numbers

   A team times its real robot at full power for two seconds and enters
   what it saw: forward speed, strafe speed, turn rate, mass and, if it
   has them, encoder ticks per inch. This module changes the drive
   parameters the rigid-body model already has until the sim, run the same
   way, reproduces them. It is pure: a rig in (src/sim.js buildRig), the
   measurements in, fitted parameters and a before/after table out. No DOM,
   no storage, nothing cached; the panel in src/mcui.js saves the result and
   hands it back to the sim as opts.calib, which buildRig applies.

   THE TEST, the same on the robot and in the sim: from standstill, full
   power for CAL_SECONDS (2 s). Forward and strafe speed are the distance
   covered divided by that time (so acceleration is in it), turn rate is the
   angle turned divided by it. The measuring OpMode (calJava) does exactly
   that and prints the numbers.

   WHAT IT CHANGES (each is an existing parameter of src/dynamics.js):
     massKg     the robot's mass, set straight to the measured value; yaw
                inertia scales with it
     gear       motor revolutions per wheel revolution on top of the gearbox
                (rig.gear): forward speed, and the encoder count per inch
     viscous    drivetrain drag in N per m/s (DYN_DEFAULTS.viscous): what takes
                the speed down when the encoders already say the gearing is right
     strafeEff  a mecanum base's strafe top speed over its forward top speed,
                the rollers' effective angle (DYN_DEFAULTS.strafeEff, see
                dynWheels): fitted to the
                strafe speed measured with a tape, NOT the encoders, which count
                the wheels' roll and so over-read a strafe on a real robot too.
                A fit made before roller slip (when strafeEff was a force loss
                and a mecanum base turned faster) carries no strafeModel: 2;
                on a mecanum base calCheck leaves out its strafeEff and its
                yawViscous and says to fit it again.
     yawViscous turn drag in N.m per rad/s (DYN_DEFAULTS.yawViscous): the
                scrub of rollers and traction wheels while turning
   With ticks per inch given, the encoders fix the gearing (gear) and the
   measured speed is matched with drag. Without it, gear takes the speed.

   Anything the model can't reach (a turn rate above what its wheels can
   spin, a strafe on a tank base) is left alone and said so in the notes.
   ============================================================ */
const CAL_FORMAT = "ftc-simbench.calibration";
const CAL_SECONDS = 2;
const CAL_DT = 0.02;
/* the fitted parameters stay inside what a real drive base can be */
const CAL_BOUNDS = {
  gear: [0.25, 6], viscous: [1.2, 800], strafeEff: [0.05, 1], yawViscous: [0.08, 120]
};
/* what strafeEff means in a fit: 2 is the strafe top speed over the forward one (the rollers'
   effective angle, dynWheels' one row per wheel) */
const CAL_STRAFE_MODEL = 2;
const CAL_IN = 0.0254;

function calNum(v) { v = +v; return Number.isFinite(v) ? v : 0; }

/* The commanded wheel powers for a full-power move along (vx, vy, w): the
   inverse kinematics of the rig's own wheels, scaled so the busiest wheel is
   at 1. Null when the drive can't make that move at all (a tank can't strafe). */
function calCmd(rig, vx, vy, w) {
  const d = rig.drive || {};
  const ws = wheelSpeeds(ikMatrix(d.kind, d.wheels), vx, vy, w);
  const k = Math.max.apply(null, ws.map(Math.abs));
  return k > 1e-6 ? ws.map(v => v / k) : null;
}

/* The robot's wheels at a share of what they do: the same rig with the fitted
   numbers on it. Pure; the rig handed in is not touched. */
function calApplyToRig(rig, p) {
  p = p || {};
  const r = Object.assign({}, rig);
  if (p.massKg > 0 && rig.props && rig.props.kg > 0) {
    const f = p.massKg / rig.props.kg, I = rig.props.I || {};
    r.props = Object.assign({}, rig.props, {
      kg: p.massKg, Izz: calNum(rig.props.Izz) * f,
      I: Object.assign({}, I, { xx: calNum(I.xx) * f, yy: calNum(I.yy) * f, zz: calNum(I.zz) * f })
    });
  }
  if (p.gear > 0) r.gear = p.gear;
  for (const k of ["strafeEff", "viscous", "yawViscous"]) if (p[k] > 0) r[k] = p[k];
  return r;
}

/* One full-power run of CAL_SECONDS from rest. what: "fwd" and "strafe" give m/s,
   "turn" gives deg/s; null when the drive can't do it. */
function calRun(rig, what) {
  const cmd = what === "fwd" ? calCmd(rig, 1, 0, 0) : what === "strafe" ? calCmd(rig, 0, 1, 0) : calCmd(rig, 0, 0, 1);
  if (!cmd) return null;
  let st = Dyn.reset(rig), sum = 0;
  const n = Math.round(CAL_SECONDS / CAL_DT);
  for (let i = 0; i < n; i++) {
    st = Dyn.step(st, cmd, rig, CAL_DT);
    sum += what === "fwd" ? st.v.x : what === "strafe" ? st.v.y : st.omega;
  }
  const avg = Math.abs(sum * CAL_DT / CAL_SECONDS);
  return what === "turn" ? avg * 180 / Math.PI : avg;
}

/* Encoder ticks per inch of rolling, as the sim counts them (src/sim.js driveEncoders):
   ticks per motor-output revolution times the gearing, over the wheel's circumference. */
function calTicksPerIn(rig) {
  const W = (rig.drive && rig.drive.wheels) || [];
  if (!W.length) return null;
  const r = W.reduce((a, w) => a + calNum(w.r), 0) / W.length;
  const m = (rig.motors || []).find(Boolean);
  const gear = Math.abs(+(Array.isArray(rig.gear) ? rig.gear[0] : rig.gear)) || 1;
  if (!(r > 0)) return null;
  return ticksPerRev(m) * gear / (2 * Math.PI * r) * CAL_IN;
}
/* the gearing that makes the sim count the measured ticks per inch */
function calGearFor(rig, ticksPerIn) {
  const W = (rig.drive && rig.drive.wheels) || [];
  if (!W.length || !(ticksPerIn > 0)) return null;
  const r = W.reduce((a, w) => a + calNum(w.r), 0) / W.length;
  const m = (rig.motors || []).find(Boolean);
  return (ticksPerIn / CAL_IN) * 2 * Math.PI * r / ticksPerRev(m);
}

/* What the sim does for the measuring test, in the units the team enters:
   fwd and strafe in m/s, turn in deg/s, mass in kg, ticks per inch. */
function calMeasure(rig) {
  return {
    fwd: calRun(rig, "fwd"), strafe: calRun(rig, "strafe"), turn: calRun(rig, "turn"),
    massKg: rig.props ? rig.props.kg : null, ticksPerIn: calTicksPerIn(rig)
  };
}

/* The measurements a team typed, cleaned: only positive finite numbers survive,
   every value in SI (m/s, deg/s, kg) with ticks per inch as entered. */
function calSanitize(m) {
  m = m || {};
  const pos = v => { v = +v; return Number.isFinite(v) && v > 0 ? v : 0; };
  return { fwd: pos(m.fwd), strafe: pos(m.strafe), turn: pos(m.turn), massKg: pos(m.massKg), ticksPerIn: pos(m.ticksPerIn) };
}

/* Find p in [lo, hi] where f(p) = target, f monotone (dir +1 rising, -1 falling), by
   bisection on a log scale. clamped: the target is outside what f reaches over the range. */
function calSolve(f, lo, hi, target, dir) {
  const a = f(lo), b = f(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { p: null, clamped: true };
  if (target <= Math.min(a, b)) return { p: dir > 0 ? lo : hi, clamped: true };
  if (target >= Math.max(a, b)) return { p: dir > 0 ? hi : lo, clamped: true };
  let l = Math.log(lo), h = Math.log(hi);
  for (let i = 0; i < 26; i++) {
    const mid = (l + h) / 2, v = f(Math.exp(mid));
    if ((v < target) === (dir > 0)) l = mid; else h = mid;
  }
  return { p: Math.exp((l + h) / 2), clamped: false };
}

const calErr = (sim, meas) => (meas > 0 && sim != null) ? (sim - meas) / meas * 100 : null;

/* Fit the rig to the measurements. Returns
     params   {massKg?, gear?, viscous?, strafeEff?, yawViscous?}, only what was changed
     rows     one per measured quantity: {key, label, unit, measured, before, after, errBefore, errAfter}
     notes    what the model could not reach, in plain words
     ok       every measured value within 5 % after */
function calFit(rig, measured) {
  const m = calSanitize(measured);
  const notes = [], p = {};
  const D = Dyn.defaults;
  const before = calMeasure(rig);
  const canStrafe = calRun(rig, "strafe") != null;
  if (m.massKg > 0) p.massKg = m.massKg;
  const rigWith = q => calApplyToRig(rig, Object.assign({}, p, q));
  // the encoders pin the gearing down when they are given
  let byTicks = false;
  if (m.ticksPerIn > 0) {
    const g = calGearFor(rig, m.ticksPerIn);
    if (g > 0) { p.gear = Math.min(CAL_BOUNDS.gear[1], Math.max(CAL_BOUNDS.gear[0], g)); byTicks = true;
      if (p.gear !== g) notes.push("The encoder count asks for a gearing outside what a drive base has; check ticks per inch and the wheel size."); }
  }

  for (let pass = 0; pass < 3; pass++) {
    const was = JSON.stringify(p);
    if (m.fwd > 0) {
      if (byTicks) {
        // the gearing is known; if the sim is still too fast, that is drag
        delete p.viscous;
        if (calRun(rigWith({}), "fwd") > m.fwd) {
          const s = calSolve(v => calRun(rigWith({ viscous: v }), "fwd"), CAL_BOUNDS.viscous[0], CAL_BOUNDS.viscous[1], m.fwd, -1);
          if (s.p) p.viscous = s.p;
        }
      } else {
        const s = calSolve(g => calRun(rigWith({ gear: g }), "fwd"), CAL_BOUNDS.gear[0], CAL_BOUNDS.gear[1], m.fwd, -1);
        if (s.p) p.gear = s.p;
      }
    }
    if (m.strafe > 0 && canStrafe) {
      const s = calSolve(e => calRun(rigWith({ strafeEff: e }), "strafe"), CAL_BOUNDS.strafeEff[0], CAL_BOUNDS.strafeEff[1], m.strafe, +1);
      if (s.p) p.strafeEff = s.p;
    }
    if (m.turn > 0) {
      delete p.yawViscous;
      if (calRun(rigWith({}), "turn") > m.turn) {
        const s = calSolve(v => calRun(rigWith({ yawViscous: v }), "turn"), Math.max(D.yawViscous, CAL_BOUNDS.yawViscous[0]), CAL_BOUNDS.yawViscous[1], m.turn, -1);
        if (s.p) p.yawViscous = s.p;
      }
    }
    // a pass that moved nothing by more than a hair is the answer
    if (pass > 0) { const w = JSON.parse(was); if (Object.keys(p).every(k => Math.abs(p[k] - (w[k] || 0)) <= 2e-4 * Math.abs(p[k]))) break; }
  }

  // what model the fit was made against: a fit with no strafeModel 2 predates mecanum roller slip (calCheck)
  if (Object.keys(p).length) p.strafeModel = CAL_STRAFE_MODEL;
  const fitted = rigWith({});
  const after = calMeasure(fitted);
  const rows = [];
  const add = (key, label, unit, meas, b, a) => rows.push({ key, label, unit, measured: meas, before: b, after: a, errBefore: calErr(b, meas), errAfter: calErr(a, meas) });
  if (m.fwd > 0) add("fwd", "Forward speed", "m/s", m.fwd, before.fwd, after.fwd);
  if (m.strafe > 0 && canStrafe) add("strafe", "Strafe speed", "m/s", m.strafe, before.strafe, after.strafe);
  if (m.turn > 0) add("turn", "Turn rate", "deg/s", m.turn, before.turn, after.turn);
  if (m.massKg > 0) add("mass", "Mass", "kg", m.massKg, before.massKg, after.massKg);
  if (m.ticksPerIn > 0) add("ticks", "Encoder ticks per inch", "ticks/in", m.ticksPerIn, before.ticksPerIn, after.ticksPerIn);

  // what could not be matched, said plainly
  const row = k => rows.find(r => r.key === k);
  if (m.strafe > 0 && !canStrafe) notes.push("This drive base can't strafe, so the strafe speed was left out.");
  const miss = (r, why) => { if (r && Math.abs(r.errAfter) > 5) notes.push(why); };
  miss(row("fwd"), byTicks ? "Forward speed is above what the encoders' gearing lets the motors reach (or drag is already at its limit); check the ticks per inch."
    : "Forward speed is outside what the motors can reach with any gearing from " + CAL_BOUNDS.gear[0] + " to " + CAL_BOUNDS.gear[1] + ".");
  miss(row("strafe"), "Strafe speed is outside what the strafe loss can reach once forward speed is matched.");
  miss(row("turn"), "Turn rate is above what these wheels can spin the robot at: the model has no way to turn it faster.");
  const ok = rows.length > 0 && rows.every(r => Math.abs(r.errAfter) <= 5);
  const kind = rig && rig.drive && rig.drive.kind ? String(rig.drive.kind) : null;
  return { params: p, rows, notes, ok, before, after, kind };
}

/* What of a saved calibration the sim can still use. `kind` is the drive base's kind when the
   caller knows it, else the one the fit saved (cal.kind).
   A fit made before mecanum roller slip (no strafeModel 2) was fitted to a sim whose mecanum
   base turned about 8% faster and whose strafeEff was a force loss: on a mecanum base its
   turn drag (yawViscous) and strafe loss now make the robot turn and strafe off what the team
   measured, so both are left out and `refit` says to fit it again (mass, gearing and drag set
   the forward speed, which the slip does not touch, and stay). With no kind to go on, a fit
   that strafed (a strafeEff, or a measured strafe) is taken for a mecanum base. Off mecanum
   an old strafeEff meant nothing and its turn drag still holds. */
function calCheck(cal, kind) {
  const p = (cal && cal.params) || {}, o = {};
  for (const k of ["massKg", "gear", "viscous", "strafeEff", "yawViscous"]) if (p[k] > 0) o[k] = +p[k];
  const dropped = [];
  let refit = null;
  if (Object.keys(o).length && p.strafeModel !== CAL_STRAFE_MODEL) {
    const k = String(kind || (cal && cal.kind) || "").toLowerCase();
    const strafed = p.strafeEff > 0 || !!(cal && cal.measured && cal.measured.strafe > 0);
    const mecanum = k ? k === "mecanum" : strafed;
    if ("strafeEff" in o) { delete o.strafeEff; if (mecanum) dropped.push("strafeEff"); }
    if (mecanum && "yawViscous" in o) { delete o.yawViscous; dropped.push("yawViscous"); }
    if (dropped.length) refit = "This calibration was fitted before the sim modelled mecanum roller slip, so its " +
      dropped.map(d => d === "yawViscous" ? "turn drag" : "strafe loss").join(" and ") +
      " no longer match" + (dropped.length > 1 ? "" : "es") + " what you measured and " + (dropped.length > 1 ? "are" : "is") +
      " left out: the sim does not match your turn and strafe until you press Fit the sim again (the numbers are still in the boxes).";
  }
  return { opts: Object.keys(o).length ? o : null, dropped, refit };
}

/* The kind of drive base the sim is about to build for this OpMode and CAD, worked out the way
   Sim.load and buildRig (src/sim.js) work it out: the CAD put in the robot frame, the drive the
   code runs (a Road Runner MecanumDrive, else the code's drivetrain), the front (given, else the
   way the wheels roll), then the CAD's wheels, with mecanum code settling four parallel axles
   the geometry can't tell apart. The Tune panel checks a saved calibration against this before
   the sim is built, so the first build and every rebuild hand the sim the same thing (asking
   the last-built sim, the first build had no kind at all). Null when the sim would build no
   drive base. tests/calibrate-kind.test.mjs holds it to the rig Sim.load really builds. */
function calDriveKind(code, cad, opts) {
  if (!code || !cad) return null;
  const o = opts || {};
  if (typeof canonicalizeCAD === "function") canonicalizeCAD(cad, { up: o.up });
  const rr = code.rr && code.rr.drive && code.rr.drive.devs && code.rr.drive.devs.length;
  const dtn = rr ? { style: "mecanum", ok: true } : (typeof detectDrivetrain === "function" ? detectDrivetrain(code) : null);
  if (!dtn || !dtn.ok) return null;
  const front = o.front || (typeof frontFromWheels === "function" && frontFromWheels(cad)) || "+x";
  const geo = typeof driveFromCAD === "function" ? driveFromCAD(cad, { front: front }) : null;
  let kind = geo && geo.kind && geo.kind !== "unknown" ? geo.kind : (dtn.style === "mecanum" ? "mecanum" : "tank");
  if (geo && geo.kind === "tank" && (geo.confidence || 0) < 0.5 && dtn.style === "mecanum") kind = "mecanum";
  return kind;
}

/* The parameters a fit gave, as the opts.calib the sim's buildRig reads. */
function calOpts(cal, kind) {
  return calCheck(cal, kind).opts;
}

/* What a saved calibration changes in the sim, in words, built from what calOpts really hands
   it (never from the saved params), and the refit note when part of it is left out (calCheck). */
function calApplied(cal, kind) {
  const c = calCheck(cal, kind), o = c.opts || {}, bits = [];
  if (o.massKg) bits.push("mass " + o.massKg.toFixed(2) + " kg");
  if (o.gear) bits.push("gearing " + o.gear.toFixed(2) + " motor turns per wheel turn");
  if (o.viscous) bits.push("drivetrain drag " + o.viscous.toFixed(1) + " N per m/s");
  if (o.strafeEff) bits.push("strafe efficiency " + o.strafeEff.toFixed(2));
  if (o.yawViscous) bits.push("turn drag " + o.yawViscous.toFixed(2) + " N·m per rad/s");
  return { bits, refit: c.refit };
}

/* The measuring OpMode a team runs on its real robot: plain FTC SDK, three timed
   full-power runs of CAL_SECONDS, printed on the Driver Station. */
function calJava() {
  const T = CAL_SECONDS.toFixed(1);
  return `package org.firstinspires.ftc.teamcode;

// CalibrateSimBench: measures how fast this robot really drives, so FTC SimBench can copy it.
//
// How to use it
//   1. Fill in the motor names below (the names in your robot configuration).
//   2. Put the robot on open floor with a tape measure along its path, hub and wheels as they run in a match.
//   3. INIT. Push the robot 48 in forward by hand. The Driver Station shows ticks per inch.
//   4. START. Press A for each run: forward, strafe, then turn. Each run is ${T} s at full power from standstill.
//      Before the strafe run, mark where the robot stands; after it, measure how far it went sideways with the tape.
//   5. Enter the numbers it prints in FTC SimBench: Tune, Calibration. Strafe speed is the tape distance / ${T} s:
//      mecanum rollers slip sideways, so the encoders over-read a strafe (that ratio is your lateral multiplier).
// Mass: weigh the robot with its battery on a scale (kg).

import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.util.ElapsedTime;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;

@Autonomous(name = "CalibrateSimBench", group = "Calibration")
public class CalibrateSimBench extends LinearOpMode {

    // FILL IN: the motor names from your robot configuration
    static final String FRONT_LEFT = "leftFront";
    static final String FRONT_RIGHT = "rightFront";
    static final String BACK_LEFT = "leftBack";
    static final String BACK_RIGHT = "rightBack";

    // FILL IN: the name of the hub's IMU in your configuration
    static final String IMU_NAME = "imu";

    // FILL IN: how the control hub sits on the robot (the logo and the USB port faces)
    static final RevHubOrientationOnRobot.LogoFacingDirection LOGO = RevHubOrientationOnRobot.LogoFacingDirection.UP;
    static final RevHubOrientationOnRobot.UsbFacingDirection USB = RevHubOrientationOnRobot.UsbFacingDirection.FORWARD;

    // How far you push the robot by hand in INIT, in inches
    static final double PUSH_INCHES = 48;

    // FILL IN (optional): ticks per inch from your own drive code; leave 0 to use the push in INIT
    static final double TICKS_PER_INCH = 0;

    static final double RUN_SECONDS = ${T};

    DcMotorEx fl, fr, bl, br;
    IMU imu;

    @Override
    public void runOpMode() {
        fl = hardwareMap.get(DcMotorEx.class, FRONT_LEFT);
        fr = hardwareMap.get(DcMotorEx.class, FRONT_RIGHT);
        bl = hardwareMap.get(DcMotorEx.class, BACK_LEFT);
        br = hardwareMap.get(DcMotorEx.class, BACK_RIGHT);

        // FILL IN: reverse the motors the way your own drive code does, so power 1 on all four goes forward
        fl.setDirection(DcMotor.Direction.REVERSE);
        bl.setDirection(DcMotor.Direction.REVERSE);

        for (DcMotorEx m : new DcMotorEx[]{fl, fr, bl, br}) {
            m.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            m.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
            m.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        }

        imu = hardwareMap.get(IMU.class, IMU_NAME);
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(LOGO, USB)));

        // INIT: push the robot PUSH_INCHES forward by hand and read the ticks per inch
        double ticksPerInch = TICKS_PER_INCH;
        while (!isStarted() && !isStopRequested()) {
            double pushed = averageTicks();
            if (TICKS_PER_INCH <= 0) ticksPerInch = pushed / PUSH_INCHES;
            telemetry.addLine("Push the robot " + (int) PUSH_INCHES + " in forward, then press START");
            telemetry.addData("ticks (average of 4 wheels)", "%.0f", pushed);
            telemetry.addData("ticks per inch", "%.2f", ticksPerInch);
            telemetry.update();
        }
        waitForStart();
        if (isStopRequested()) return;

        double fwdTicks = 0, strafeTicks = 0, turnDegrees = 0;

        // 1. forward: all four wheels at full power
        waitForA("Press A: forward run");
        fwdTicks = run(1, 1, 1, 1, false);
        show(ticksPerInch, fwdTicks, strafeTicks, turnDegrees);

        // 2. strafe right: the standard mecanum pattern (change the signs if your wheels differ)
        waitForA("Press A: strafe run");
        strafeTicks = run(1, -1, -1, 1, false);
        show(ticksPerInch, fwdTicks, strafeTicks, turnDegrees);

        // 3. turn clockwise: the left side forward, the right side backward
        waitForA("Press A: turn run");
        turnDegrees = run(1, -1, 1, -1, true);
        show(ticksPerInch, fwdTicks, strafeTicks, turnDegrees);

        while (opModeIsActive()) idle();
    }

    // Full power for RUN_SECONDS from standstill. Returns the average ticks the wheels counted,
    // or, for the turn run, the degrees the IMU saw. Powers are front left, front right, back left, back right.
    double run(double pfl, double pfr, double pbl, double pbr, boolean turning) {
        for (DcMotorEx m : new DcMotorEx[]{fl, fr, bl, br}) {
            m.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            m.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
        }
        imu.resetYaw();
        double last = 0, total = 0;
        ElapsedTime clock = new ElapsedTime();
        fl.setPower(pfl);
        fr.setPower(pfr);
        bl.setPower(pbl);
        br.setPower(pbr);
        while (opModeIsActive() && clock.seconds() < RUN_SECONDS) {
            // the IMU wraps at 180, so add up the small steps
            double yaw = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
            double step = yaw - last;
            if (step > 180) step -= 360;
            if (step < -180) step += 360;
            total += step;
            last = yaw;
        }
        double ticks = averageTicks();
        fl.setPower(0);
        fr.setPower(0);
        bl.setPower(0);
        br.setPower(0);
        return turning ? Math.abs(total) : ticks;
    }

    // The average of the four wheels' distances, in ticks, whichever way each one counts
    double averageTicks() {
        return (Math.abs(fl.getCurrentPosition()) + Math.abs(fr.getCurrentPosition())
                + Math.abs(bl.getCurrentPosition()) + Math.abs(br.getCurrentPosition())) / 4.0;
    }

    void waitForA(String prompt) {
        telemetry.addLine(prompt);
        telemetry.update();
        while (opModeIsActive() && !gamepad1.a) idle();
        while (opModeIsActive() && gamepad1.a) idle();
    }

    void show(double ticksPerInch, double fwdTicks, double strafeTicks, double turnDegrees) {
        telemetry.addLine("Type these into FTC SimBench (Tune, Calibration)");
        telemetry.addData("ticks per inch", "%.2f", ticksPerInch);
        if (ticksPerInch > 0) {
            telemetry.addData("forward speed", "%.1f in/s", fwdTicks / ticksPerInch / RUN_SECONDS);
            telemetry.addData("strafe by the encoders (not the strafe speed)", "%.1f in", strafeTicks / ticksPerInch);
        } else {
            telemetry.addData("forward ticks in " + RUN_SECONDS + " s", "%.0f", fwdTicks);
            telemetry.addData("strafe ticks in " + RUN_SECONDS + " s", "%.0f", strafeTicks);
        }
        telemetry.addLine("strafe speed: the sideways distance on the tape (in) / " + RUN_SECONDS + " s");
        telemetry.addData("turn rate", "%.0f deg/s", turnDegrees / RUN_SECONDS);
        telemetry.update();
    }
}
`;
}
