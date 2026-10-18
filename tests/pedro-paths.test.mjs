// Pedro Pathing 2.x autos in the Java VM (src/jvmprelude.js): the follower
// localizes from the sim, follows Bezier paths and chains with their heading
// interpolation, holds a point, fires callbacks, and colour sensors and motor
// current read per device. Before this, followPath() did nothing and an auto
// sat still at its start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const IN = 0.0254, DT = 0.02;

// a small mecanum robot: the four commanded powers move a pose (metres), with motor lag
function run(main, libs, secs, opts = {}) {
  const H = { t: 0, clock: 0, x: (opts.x || 0) * IN, y: (opts.y || 0) * IN, h: opts.h || 0, vx: 0, vy: 0, w: 0, pads: { 1: {}, 2: {} } };
  const devs = new Map();
  const host = {
    dev(name, type, kind) { let s = devs.get(name); if (!s) { s = { name, type, kind, cmd: kind === 'servo' ? null : 0, act: 0, ticks: 0, offset: 0, vel: 0, target: 0, reversed: false, mode: 'run', tpr: 537.7, spec: { rpm: 312 } }; devs.set(name, s); } return s; },
    pad(i) { return H.pads[i] || {}; }, now() { return H.clock; }, runtime() { return H.t; }, heading() { return H.h; }, omega() { return H.w; },
    pose() { return { x: H.x, y: H.y, h: H.h }; },
    vel() { const c = Math.cos(H.h), s = Math.sin(H.h); return { x: H.vx * c + H.vy * s, y: -H.vx * s + H.vy * c }; },
    ray() { return 8.19; }, color: opts.color || (() => [120, 120, 120]), colorDist: opts.colorDist, volts() { return 12.6; }, touch() { return false; },
    telemetry(l) { H.tel = l; }, rumble() {},
  };
  const comp = E.jvCompile(main, libs || []);
  assert.ok(comp.ok, comp.err);
  const P = new E.JvProgram(comp, host);
  const cmd = (n) => { const s = devs.get(n); return s && s.cmd != null ? s.cmd : 0; };
  P.init();
  P.start();
  const track = [];
  for (let k = 0; k < Math.round(secs / DT); k++) {
    H.clock += DT; H.t += DT;
    P.tick();
    for (const [, d] of devs) if (d.kind === 'motor') d.act = d.cmd || 0;
    const lf = cmd('leftFront'), lr = cmd('leftRear'), rf = cmd('rightFront'), rr = cmd('rightRear');
    const f = (lf + lr + rf + rr) / 4, s = (-lf + lr + rf - rr) / 4, w = (-lf - lr + rf + rr) / 4;
    const c = Math.cos(H.h), sn = Math.sin(H.h), a = Math.min(1, DT / 0.12);
    H.vx += ((f * c - s * sn) * 1.5 - H.vx) * a; H.vy += ((f * sn + s * c) * 1.5 - H.vy) * a; H.w += (w * 5 - H.w) * a;
    H.x += H.vx * DT; H.y += H.vy * DT; H.h += H.w * DT;
    track.push([H.x / IN, H.y / IN, H.h]);
  }
  return { P, H, devs, track, tel: (H.tel || []).join('\n') };
}

const CONSTANTS = `package org.firstinspires.ftc.teamcode.pedro;
import com.pedropathing.follower.*; import com.pedropathing.ftc.FollowerBuilder; import com.pedropathing.ftc.drivetrains.MecanumConstants;
import com.pedropathing.ftc.localization.constants.PinpointConstants; import com.pedropathing.paths.PathConstraints;
import com.qualcomm.robotcore.hardware.*;
public class Constants {
  public static FollowerConstants followerConstants = new FollowerConstants().mass(12);
  public static MecanumConstants driveConstants = new MecanumConstants().maxPower(1)
    .leftFrontMotorDirection(DcMotorSimple.Direction.REVERSE).leftRearMotorDirection(DcMotorSimple.Direction.REVERSE);
  public static PinpointConstants localizerConstants = new PinpointConstants().forwardPodY(-0.15).strafePodX(-1.6).hardwareMapName("pinpoint");
  public static PathConstraints pathConstraints = new PathConstraints(0.99, 100, 1, 1);
  public static Follower createFollower(HardwareMap hardwareMap) {
    return new FollowerBuilder(followerConstants, hardwareMap).pathConstraints(pathConstraints)
      .mecanumDrivetrain(driveConstants).pinpointLocalizer(localizerConstants).build();
  }
}`;
const libs = [{ file: 'Constants.java', src: CONSTANTS }];

test('pedro: an auto follows a line then a curve and ends on the last pose, heading interpolated', () => {
  const main = `package org.firstinspires.ftc.teamcode;
import com.pedropathing.follower.Follower; import com.pedropathing.geometry.*; import com.pedropathing.paths.*;
import com.qualcomm.robotcore.eventloop.opmode.*; import org.firstinspires.ftc.teamcode.pedro.Constants;
@Autonomous public class A extends OpMode { Follower f; PathChain chain; int state = 0;
  public void init() { f = Constants.createFollower(hardwareMap); f.setStartingPose(new Pose(20, 20, 0)); }
  public void start() {
    chain = f.pathBuilder()
      .addPath(new BezierLine(new Pose(20, 20, 0), new Pose(60, 20, 0))).setConstantHeadingInterpolation(0)
      .addPath(new BezierCurve(new Pose(60, 20, 0), new Pose(90, 20, 0), new Pose(90, 60, 0))).setLinearHeadingInterpolation(0, Math.PI / 2)
      .build();
    f.followPath(chain, true);
  }
  public void loop() { f.update(); if (state == 0 && !f.isBusy()) state = 1;
    telemetry.addData("pose", "%.2f,%.2f,%.3f,%d", f.getPose().getX(), f.getPose().getY(), f.getPose().getHeading(), state); }
}`;
  const r = run(main, libs, 8);
  assert.equal(r.P.error, null, r.P.error && r.P.error.msg);
  const [x, y, h, state] = /pose : ([-\d.]+),([-\d.]+),([-\d.]+),(\d)/.exec(r.tel).slice(1).map(Number);
  assert.equal(state, 1, 'isBusy() went false at the end');
  assert.ok(Math.hypot(x - 90, y - 60) < 2, `ends near (90, 60): ${x}, ${y}`);
  assert.ok(Math.abs(h - Math.PI / 2) < Math.PI / 60, `heading ${h}`);
  // the robot really moved there (the sim pose, from the start at the origin): +70 in, +40 in
  const [sx, sy] = r.track[r.track.length - 1];
  assert.ok(Math.hypot(sx - 70, sy - 40) < 2, `sim moved ${sx}, ${sy}`);
  // and it went along the line first: the point where x reached 50 is still on y = 0
  const mid = r.track.find((p) => p[0] >= 30);
  assert.ok(Math.abs(mid[1]) < 2, `on the line at x 30: y ${mid[1]}`);
});

test('pedro: getPose is the starting pose plus how far the sim moved, in the team\'s own frame', () => {
  const main = `package org.firstinspires.ftc.teamcode;
import com.pedropathing.follower.Follower; import com.pedropathing.geometry.Pose;
import com.qualcomm.robotcore.eventloop.opmode.*; import org.firstinspires.ftc.teamcode.pedro.Constants;
@TeleOp public class T extends OpMode { Follower f;
  public void init() { f = Constants.createFollower(hardwareMap); f.setStartingPose(new Pose(72, 10, Math.PI / 2)); }
  public void start() { f.startTeleopDrive(); }
  public void loop() { f.setTeleOpDrive(0.5, 0, 0, true); f.update();
    telemetry.addData("p", "%.2f,%.2f,%.3f,%.2f", f.getPose().getX(), f.getPose().getY(), f.getPose().getHeading(), f.getVelocity().getMagnitude()); }
}`;
  const r = run(main, libs, 1);
  const [x, y, h, v] = /p : ([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/.exec(r.tel).slice(1).map(Number);
  const moved = r.track[r.track.length - 2][0];
  // the sim drove along its +x; the team's robot faces +y in its own frame, so y grows
  assert.ok(moved > 15, `the robot moved ${moved} in`);
  assert.ok(Math.abs(x - 72) < 0.5 && Math.abs(y - (10 + moved)) < 1, `pose ${x}, ${y} after ${moved} in`);
  assert.ok(Math.abs(h - Math.PI / 2) < 0.01, `heading ${h}`);
  assert.ok(v > 15, `velocity ${v} in/s`);
});

test('pedro: holdPoint turns in place to the asked heading and stays put', () => {
  const main = `package org.firstinspires.ftc.teamcode;
import com.pedropathing.follower.Follower; import com.pedropathing.geometry.Pose;
import com.qualcomm.robotcore.eventloop.opmode.*; import org.firstinspires.ftc.teamcode.pedro.Constants;
@Autonomous public class H extends OpMode { Follower f;
  public void init() { f = Constants.createFollower(hardwareMap); f.setStartingPose(new Pose(30, 30, 0)); }
  public void start() { f.holdPoint(new Pose(30, 30, Math.toRadians(70))); }
  public void loop() { f.update(); telemetry.addData("p", "%.2f,%.2f,%.4f", f.getPose().getX(), f.getPose().getY(), f.getPose().getHeading()); }
}`;
  const r = run(main, libs, 3);
  const [x, y, h] = /p : ([-\d.]+),([-\d.]+),([-\d.]+)/.exec(r.tel).slice(1).map(Number);
  assert.ok(Math.abs(h - 70 * Math.PI / 180) < 2 * Math.PI / 180, `heading ${h * 180 / Math.PI}`);
  assert.ok(Math.hypot(x - 30, y - 30) < 1, `stayed at ${x}, ${y}`);
});

test('pedro: a parametric callback runs once, partway along its path', () => {
  const main = `package org.firstinspires.ftc.teamcode;
import com.pedropathing.follower.Follower; import com.pedropathing.geometry.*; import com.pedropathing.paths.*;
import com.qualcomm.robotcore.eventloop.opmode.*; import org.firstinspires.ftc.teamcode.pedro.Constants;
@Autonomous public class C extends OpMode { Follower f; int hits = 0; double atX = -1;
  public void init() { f = Constants.createFollower(hardwareMap); f.setStartingPose(new Pose(0, 0, 0)); }
  public void start() {
    f.followPath(f.pathBuilder().addPath(new BezierLine(new Pose(0, 0, 0), new Pose(40, 0, 0)))
      .setConstantHeadingInterpolation(0).addParametricCallback(0.5, () -> { hits++; atX = f.getPose().getX(); }).build());
  }
  public void loop() { f.update(); telemetry.addData("c", "%d,%.2f", hits, atX); }
}`;
  const r = run(main, libs, 4);
  const [hits, atX] = /c : (\d+),([-\d.]+)/.exec(r.tel).slice(1).map(Number);
  assert.equal(hits, 1);
  assert.ok(atX > 17 && atX < 26, `ran at x ${atX}`);
});

test('sensors: each colour sensor reads its own colour and distance, and motor current takes CurrentUnit', () => {
  const main = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.hardware.rev.RevColorSensorV3; import com.qualcomm.robotcore.hardware.*; import com.qualcomm.robotcore.eventloop.opmode.*;
import org.firstinspires.ftc.robotcore.external.navigation.*;
@TeleOp public class S extends OpMode { RevColorSensorV3 a, b; DcMotorEx m;
  public void init() { a = hardwareMap.get(RevColorSensorV3.class, "frontColor"); b = hardwareMap.get(RevColorSensorV3.class, "backColor"); m = hardwareMap.get(DcMotorEx.class, "intake"); }
  public void loop() { m.setPower(1); NormalizedRGBA ca = a.getNormalizedColors(), cb = b.getNormalizedColors();
    telemetry.addData("s", "%.2f,%.2f,%.0f,%.0f,%.2f", ca.blue, cb.red, a.getDistance(DistanceUnit.MM), b.getDistance(DistanceUnit.MM), m.getCurrent(CurrentUnit.AMPS)); }
}`;
  const r = run(main, [], 0.1, {
    color: (n) => (n === 'frontColor' ? [20, 40, 230] : [220, 30, 30]),
    colorDist: (n) => (n === 'frontColor' ? 0.03 : null),
  });
  assert.equal(r.P.error, null);
  const [blueA, redB, distA, distB, amps] = /s : ([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/.exec(r.tel).slice(1).map(Number);
  assert.ok(blueA > 0.85 && redB > 0.85, `front reads blue ${blueA}, back reads red ${redB}`);
  assert.equal(distA, 30);
  assert.equal(distB, 200, 'a host with no answer for this sensor still reads the old 20 cm');
  assert.ok(amps > 1, `current ${amps} A`);
  assert.ok(!r.P.stubs().some(([k]) => /CurrentUnit/.test(k)), 'CurrentUnit is a real enum now');
});
