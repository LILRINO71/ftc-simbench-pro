// From the Autonomous to the TeleOp. On a Robot Controller every OpMode runs in one app process,
// so a static field the Autonomous wrote (the pose it ended at) and OpMode.blackboard are still
// there when the TeleOp starts: teams hand the pose over this way (the team's BiobuzzAuto saves
// it into PoseStore in stop(), BiobuzzTeleOp starts from it). Each bench run was a fresh VM, so
// the TeleOp always started from zero. new JvProgram(comp, host, {carry: auto.carry()}) carries it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const PKG = 'package org.firstinspires.ftc.teamcode;\nimport com.qualcomm.robotcore.eventloop.opmode.*;\nimport com.qualcomm.robotcore.hardware.*;\n';
const STORE = PKG + `public class PoseStore {
  public static double heading = 0; public static int runs = 0; public static Side side = Side.NONE;
  public static Pose pose = null; public static DcMotor lift = null; public static java.util.List<Integer> marks = new java.util.ArrayList<>();
  public static final double FIELD = 144.0;
  public static boolean fresh() { return pose != null; }
}`;
const SIDE = PKG + 'public enum Side { NONE, RED, BLUE }';
const POSE = PKG + `public class Pose { public final double x, y; public Pose(double x, double y) { this.x = x; this.y = y; }
  public double dist() { return Math.hypot(x, y); } }`;
const AUTO = PKG + `@Autonomous(name = "Auto") public class Auto extends LinearOpMode {
  @Override public void runOpMode() {
    DcMotor lift = hardwareMap.get(DcMotor.class, "lift");
    waitForStart();
    PoseStore.heading = 90.0; PoseStore.runs++; PoseStore.side = Side.RED; PoseStore.pose = new Pose(3, 4);
    PoseStore.lift = lift; PoseStore.marks.add(7);
    blackboard.put("heading", 90.0);
    while (opModeIsActive()) idle();
    PoseStore.runs += 10;                        // after STOP, as BiobuzzAuto's stop() does
  }
}`;
const TELE = PKG + `@TeleOp(name = "Tele") public class Tele extends LinearOpMode {
  @Override public void runOpMode() {
    waitForStart();
    System.out.println("static=" + PoseStore.heading + " blackboard=" + blackboard.get("heading") + " runs=" + PoseStore.runs);
    System.out.println((PoseStore.side == Side.RED) + " " + PoseStore.fresh() + " " + PoseStore.pose.dist() + " " + PoseStore.marks.get(0) / 2);
    System.out.println(PoseStore.lift == hardwareMap.get(DcMotor.class, "lift"));
  }
}`;

function host(log) {
  const H = { clock: 0, t: 0 }, devs = new Map();
  return { H, host: {
    dev(name, type, kind) { let s = devs.get(name); if (!s) { s = { name, type, kind, cmd: 0, act: 0, ticks: 0, offset: 0, vel: 0, target: 0, reversed: false, mode: 'run', tpr: 537.7, spec: { rpm: 312 } }; devs.set(name, s); } return s; },
    pad() { return {}; }, now() { return H.clock; }, runtime() { return H.t; }, heading() { return 0; }, omega() { return 0; },
    pose() { return { x: 0, y: 0, h: 0 }; }, vel() { return { x: 0, y: 0 }; }, ray() { return 8.19; }, color() { return [0, 0, 0]; }, volts() { return 12.6; }, touch() { return false; },
    telemetry() {}, rumble() {}, log(t) { log.push(String(t)); },
  } };
}
/* INIT, START, `ticks` passes and STOP, as the Driver Station runs one OpMode */
function drive(main, libs, opts) {
  const log = [], h = host(log);
  const comp = E.jvCompile(main, libs.map((src, i) => ({ file: 'L' + i + '.java', src })));
  assert.ok(comp.ok, comp.err);
  const P = new E.JvProgram(comp, h.host, opts);
  P.init(); P.start();
  for (let k = 0; k < 5 && !P.done; k++) { h.H.clock += 0.02; h.H.t += 0.02; P.tick(); }
  P.stop();
  assert.equal(P.error, null, JSON.stringify(P.error));
  return { P, log };
}

test('carry: the TeleOp starts from the statics and the blackboard the Autonomous left', () => {
  const auto = drive(AUTO, [STORE, SIDE, POSE]);
  assert.deepEqual(auto.P.statics(), { 'PoseStore.heading': 90, 'PoseStore.runs': 11, 'PoseStore.side': 'RED', 'PoseStore.pose': 'Pose', 'PoseStore.lift': 'DcMotorImplEx', 'PoseStore.marks': 'ArrayList' });
  const tele = drive(TELE, [STORE, SIDE, POSE], { carry: auto.P.carry() });
  // enum constants are the TeleOp's own (== works), objects keep their methods, the device is the
  // TeleOp's device of that name, an Integer out of a carried List<Integer> is still an int
  assert.deepEqual(tele.log, ['static=90.0 blackboard=90.0 runs=11', 'true true 5.0 3', 'true']);
  assert.ok(tele.P.carried.classes.includes('org.firstinspires.ftc.teamcode.PoseStore'));
  assert.equal(tele.P.carried.blackboard, true);
  // without a carry, as before: a fresh run
  const fresh = drive(TELE.replace('System.out.println((PoseStore.side', 'if (false) System.out.println((PoseStore.side').replace('System.out.println(PoseStore.lift', 'if (false) System.out.println(PoseStore.lift'), [STORE, SIDE, POSE]);
  assert.deepEqual(fresh.log, ['static=0.0 blackboard=null runs=0']);
});

test('carry: a class whose source changed between the runs starts afresh, as after a redeploy', () => {
  const auto = drive(AUTO, [STORE, SIDE, POSE]);
  const changed = STORE.replace('public static int runs = 0;', 'public static int runs = 5;');
  const tele = drive(TELE.replace('System.out.println((PoseStore.side', 'if (false) System.out.println((PoseStore.side').replace('System.out.println(PoseStore.lift', 'if (false) System.out.println(PoseStore.lift'),
    [changed, SIDE, POSE], { carry: auto.P.carry() });
  // PoseStore was edited: its statics are the new file's; the blackboard is the app's and stays
  assert.deepEqual(tele.log, ['static=0.0 blackboard=90.0 runs=5']);
});

test('carry: a device in a static is wired to the new robot only when the new run uses it, and never throws', () => {
  const store = PKG + 'public class Store { public static DcMotor lift = null; public static double heading = 0; }';
  const auto = PKG + '@Autonomous(name="A") public class A extends LinearOpMode { public void runOpMode() { Store.lift = hardwareMap.get(DcMotor.class, "lift"); waitForStart(); Store.heading = 90; } }';
  const tele = (body) => PKG + `@TeleOp(name="T") public class T extends LinearOpMode { public void runOpMode() { waitForStart(); ${body} } }`;
  const mk = (src, cfg, carry) => {
    const H = E.jvProbeHost(); if (cfg) H.host.robotConfig = () => cfg;
    H.host.log = (t) => H.tel.push(String(t)); H.tel = [];
    const comp = E.jvCompile(src, [{ file: 'Store.java', src: store }]);
    const P = new E.JvProgram(comp, H.host, carry ? { carry } : undefined);
    P.init(); P.start(); for (let k = 0; k < 3 && !P.done; k++) { H.clock += 0.02; H.t += 0.02; P.tick(); }
    return { H, P };
  };
  const a = mk(auto, { devices: [{ name: 'lift', kind: 'motor' }] });
  assert.equal(a.P.error, null);
  // the next robot's configuration has no "lift": no throw out of new JvProgram, the static is null
  const t1 = mk(tele('System.out.println("heading " + Store.heading + " " + (Store.lift == null));'), { devices: [{ name: 'drive', kind: 'motor' }] }, a.P.carry());
  assert.equal(t1.P.error, null, JSON.stringify(t1.P.error));
  assert.deepEqual(t1.H.tel, ['heading 90.0 true']);
  assert.ok(t1.P.carried.dropped.some((d) => /lift/.test(d)), JSON.stringify(t1.P.carried));
  // no configuration, and the TeleOp never touches Store.lift: it gains no device
  const t2 = mk(tele('System.out.println("heading " + Store.heading);'), null, a.P.carry());
  assert.deepEqual(t2.H.tel, ['heading 90.0']);
  assert.deepEqual([...t2.H.devs.keys()], []);
  assert.equal(t2.P.vm.devices, undefined);
  // one it does use is its device of that name, wired then
  const t3 = mk(tele('Store.lift.setPower(0.5); System.out.println(Store.lift == hardwareMap.get(DcMotor.class, "lift"));'), null, a.P.carry());
  assert.deepEqual(t3.H.tel, ['true']);
  assert.equal(t3.H.devs.get('lift').cmd, 0.5);
  assert.deepEqual([...t3.P.vm.devices.keys()], ['lift']);
});
