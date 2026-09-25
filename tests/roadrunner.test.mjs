// Road Runner 1.0 autos (src/roadrunner.js): the builder chain becomes a
// path and a time profile the way RR builds them; the team's Action classes
// run from their own files; and the follower drives the robot along it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, fixture, run } from './load.mjs';

const E = loadEngine();
const DEG = Math.PI / 180;
const P = { maxWheelVel: 50, minProfileAccel: -30, maxProfileAccel: 50, maxAngVel: Math.PI, maxAngAccel: Math.PI,
  axialGain: 8, lateralGain: 8, headingGain: 8, inPerTick: 1, lateralInPerTick: 1, trackWidthTicks: 14 };
const plan = (start, calls) => E.rrBuildPlan(start, calls.map(([m, ...args]) => ({ m, args, raw: [] })), P, () => ({ kind: 'none' }), []);
const trajs = (p) => p.stages.filter((s) => s.kind === 'traj');

test('builder: lineToY runs along the tangent, and consecutive moves are one profile that starts and ends at rest', () => {
  const p = plan([-10, 61.5, 270 * DEG], [['lineToY', 31.5], ['strafeToLinearHeading', { vec: [20, 31.5] }, 180 * DEG]]);
  assert.equal(trajs(p).length, 1, 'two moves, one trajectory');
  const tr = trajs(p)[0].tr, a = tr.pts[0], z = tr.pts[tr.pts.length - 1];
  assert.equal(a.v, 0); assert.equal(z.v, 0);
  const mid = tr.pts.find((q) => Math.abs(q.y - 31.5) < 0.3 && Math.abs(q.x + 10) < 0.3);
  assert.ok(mid, 'the corner at (-10, 31.5) is on the path');
  assert.ok(Math.abs(mid.h - 270 * DEG) < 1e-6 || Math.abs(mid.h + 90 * DEG) < 1e-6, 'lineToY holds the tangent heading, 270°');
  assert.ok(Math.abs(z.x - 20) < 1e-6 && Math.abs(z.y - 31.5) < 1e-6);
  assert.ok(Math.abs(Math.cos(z.h) - Math.cos(180 * DEG)) < 1e-6, 'strafeToLinearHeading ends at its heading');
  assert.ok(Math.max(...tr.pts.map((q) => q.v)) <= P.maxWheelVel + 1e-9, 'never over maxWheelVel');
  // accelerations stay inside the profile's limits
  for (let i = 1; i < tr.pts.length; i++) {
    const q0 = tr.pts[i - 1], q1 = tr.pts[i], acc = (q1.v * q1.v - q0.v * q0.v) / (2 * ((q1.s - q0.s) || 1e-9));
    assert.ok(acc <= P.maxProfileAccel + 1e-6 && acc >= P.minProfileAccel - 1e-6, 'accel ' + acc.toFixed(2) + ' at ' + i);
  }
  // RR's sample: halfway in time, somewhere between the ends, moving
  const s = E.rrSample(tr, tr.dur / 2);
  assert.ok(Math.hypot(s.vx, s.vy) > 1);
});

test('builder: a wait, a stopAndAdd and a turn split the path; afterTime anchors to the last timed piece', () => {
  const calls = [['lineToY', 40], ['waitSeconds', 0.5], ['stopAndAdd'], ['afterTime', 0.25], ['turn', 90 * DEG], ['strafeTo', { vec: [0, 30] }]];
  const p = E.rrBuildPlan([0, 60, 270 * DEG], calls.map(([m, ...args]) => ({ m, args, raw: ['x', 'y'] })), P, () => ({ kind: 'none' }), []);
  assert.deepEqual(p.stages.map((s) => s.kind), ['traj', 'wait', 'act', 'turn', 'traj']);
  assert.equal(p.markers.length, 1);
  assert.equal(p.markers[0].anchor, 1, 'after the wait, the last timed stage before it');
  assert.equal(p.markers[0].dt, 0.25);
  const turn = p.stages[3].tr;
  assert.ok(Math.abs(turn.at(turn.dur) - Math.PI / 2) < 1e-9, 'the turn covers 90°');
  const d = p.end[2] - (270 + 90) * DEG;
  assert.ok(Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 1e-9, 'facing 270° + 90°');
});

test('builder: setTangent takes radians as Road Runner does, and splineToConstantHeading keeps the heading', () => {
  const p = plan([0, 0, 0], [['setTangent', -60], ['splineToConstantHeading', { vec: [20, 10] }, 90 * DEG]]);
  const tr = trajs(p)[0].tr;
  // leaves along -60 rad (= 162.3°), not -60°
  const a = tr.pts[0], b = tr.pts[3], dir = Math.atan2(b.y - a.y, b.x - a.x), want = Math.atan2(Math.sin(-60), Math.cos(-60));
  assert.ok(Math.abs(Math.atan2(Math.sin(dir - want), Math.cos(dir - want))) < 0.15, 'starts along -60 rad');
  assert.ok(tr.pts.every((q) => Math.abs(q.h) < 1e-9), 'heading held');
  const z = tr.pts[tr.pts.length - 1];
  assert.ok(Math.abs(z.x - 20) < 1e-6 && Math.abs(z.y - 10) < 1e-6);
});

const ARM = `package x;
import com.acmerobotics.roadrunner.Action;
public class Arm {
  public DcMotorEx lift; Servo claw; public int target;
  public Arm(HardwareMap hardwareMap) {
    lift = hardwareMap.get(DcMotorEx.class, "lift");
    claw = hardwareMap.servo.get("claw");
    claw.setDirection(Servo.Direction.REVERSE);
  }
  public class hold implements Action {
    @Override public boolean run(@NonNull TelemetryPacket p) { lift.setPower(LiftPID.power(target, lift.getCurrentPosition())); return true; }
  }
  public Action Hold() { return new hold(); }
  public class goTo implements Action {
    int t; public goTo(int to) { t = to; }
    @Override public boolean run(@NonNull TelemetryPacket p) { target = t; return false; }
  }
  public Action GoTo(int to) { return new Arm.goTo(to); }
  public class open implements Action {
    @Override public boolean run(@NonNull TelemetryPacket p) { claw.setPosition(0.7); return false; }
  }
  public Action open() { return new open(); }
}`;
const PID = `package x;
public class LiftPID {
  public static double kP = 0.01;
  public static double power(double target, double pos) { double e = target - pos; return kP * e; }
}`;
const AUTO = `package x;
@Autonomous(name = "rr test")
public class Auto extends LinearOpMode {
  public void runOpMode() {
    Pose2d start = new Pose2d(0, 0, Math.toRadians(0));
    MecanumDrive drive = new MecanumDrive(hardwareMap, start);
    Arm arm = new Arm(hardwareMap);
    waitForStart();
    TrajectoryActionBuilder go = drive.actionBuilder(start)
        .afterTime(0, arm.GoTo(300))
        .lineToX(24)
        .stopAndAdd(arm.open());
    Actions.runBlocking(new ParallelAction(go.build(), arm.Hold()));
  }
}`;
const DRIVE = `package x;
public final class MecanumDrive {
  public static class Params { public double maxWheelVel = 40; public double minProfileAccel = -30; public double maxProfileAccel = 40;
    public double axialGain = 10; public double lateralGain = 10; public double headingGain = 8; public double inPerTick = 1; public double trackWidthTicks = 14; }
  public static Params PARAMS = new Params();
  public final DcMotorEx leftFront, leftBack, rightBack, rightFront;
  public MecanumDrive(HardwareMap hardwareMap, Pose2d pose) {
    leftFront = hardwareMap.get(DcMotorEx.class, "leftFront");
    leftBack = hardwareMap.get(DcMotorEx.class, "leftBack");
    rightBack = hardwareMap.get(DcMotorEx.class, "rightBack");
    rightFront = hardwareMap.get(DcMotorEx.class, "rightFront");
    leftFront.setDirection(DcMotorSimple.Direction.REVERSE);
    leftBack.setDirection(DcMotorSimple.Direction.REVERSE);
  }
}`;
const libs = [{ file: 'Arm.java', src: ARM }, { file: 'LiftPID.java', src: PID }, { file: 'MecanumDrive.java', src: DRIVE }];

test("the team's helper classes: devices, actions, a PID helper, and what the drive's PARAMS say", () => {
  const code = E.parseJava(AUTO, { libs });
  assert.ok(code.rr, 'read as a Road Runner auto');
  assert.deepEqual(code.rr.start, [0, 0, 0]);
  assert.deepEqual(code.devices.map((d) => d.name).sort(), ['claw', 'leftBack', 'leftFront', 'lift', 'rightBack', 'rightFront']);
  assert.equal(code.rr.drive.params.maxWheelVel, 40);
  assert.equal(code.rr.drive.params.axialGain, 10);
  assert.ok(code.inits.some((s) => s.kind === 'objcall' && s.obj === 'claw' && s.meth === 'setDirection'), "Arm's constructor runs at INIT");
  assert.deepEqual(code.rr.commanded.sort(), ['claw', 'leftBack', 'leftFront', 'lift', 'rightBack', 'rightFront']);
  assert.equal(code.rr.summary.trajectories, 1);
  // without the helpers it still reads, and says what's missing
  const bare = E.parseJava(AUTO);
  assert.ok(bare.rr.notes.some((n) => /Arm isn't loaded/.test(n)) && bare.rr.notes.some((n) => /MecanumDrive\.java isn't loaded/.test(n)));
});

test('the auto drives its path and its actions run: target set at the start, claw opened at the end, PID holding', () => {
  const code = E.parseJava(AUTO, { libs });
  const cad = E.parseSTEP(fixture('robots/mecanum-zup.step'));
  const map = E.autoMap(code.devices, cad.mechs);
  E.Sim.reset(code, cad, map, { payloadKg: 0, duty: 0.3, trust: 'code', front: E.frontFromWheels(cad) });
  const IN = 0.0254;
  assert.ok(Math.hypot(E.Sim.chassis.x, E.Sim.chassis.y) < 1e-9, 'placed at the start pose');
  run(E, 0.1);
  assert.equal(E.Sim.vars.target === undefined ? null : E.Sim.vars.target, null, 'the target is the Arm object\'s own field');
  run(E, 4);
  const p = E.Sim.rr.pose();
  assert.ok(Math.abs(p.x - 24) < 1.5 && Math.abs(p.y) < 1.5, 'drove to x=24 in: ' + p.x.toFixed(2) + ', ' + p.y.toFixed(2));
  assert.equal(E.Sim.dev.claw.cmd, 0.7, 'stopAndAdd opened the claw after the move');
  // the hold action runs every loop: power = 0.01 * (300 - position)
  const lift = E.Sim.dev.lift, pos = Math.round(lift.ticks - (lift.offset || 0));
  assert.ok(Math.abs(lift.cmd - Math.max(-1, Math.min(1, 0.01 * (300 - pos)))) < 0.02, 'the PID helper sets the lift power (' + lift.cmd + ' at ' + pos + ')');
  assert.ok(!E.Sim.rr.done, 'a hold that returns true keeps the whole thing running');
});
