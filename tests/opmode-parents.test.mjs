// An OpMode that extends another OpMode. Teams keep variants this way: "Main TeleOp + encoders"
// is ten lines on top of the main TeleOp, and the blue auto extends the red one. The parent is an
// OpMode itself, so it was never among the helper classes: the variant was read alone, its parent
// stood in for by an empty class, and it showed "no hardware" with no word about why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

const HEAD = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.hardware.DcMotor;
`;
const MAIN = HEAD + `
@TeleOp(name = "Main")
public class MainTeleOp extends OpMode {
    protected DcMotor fl, fr, bl, br, shooter;
    protected double shotPower() { return 0.6; }
    @Override public void init() {
        fl = hardwareMap.get(DcMotor.class, "FL");
        fr = hardwareMap.get(DcMotor.class, "FR");
        bl = hardwareMap.get(DcMotor.class, "BL");
        br = hardwareMap.get(DcMotor.class, "BR");
        shooter = hardwareMap.get(DcMotor.class, "shooter");
    }
    @Override public void loop() {
        double f = -gamepad1.left_stick_y, t = gamepad1.right_stick_x;
        fl.setPower(f + t); bl.setPower(f + t); fr.setPower(f - t); br.setPower(f - t);
        shooter.setPower(gamepad1.a ? shotPower() : 0);
    }
}`;
const ENCODERS = HEAD + `
@TeleOp(name = "Main + encoders")
public class MainTeleOpEncoders extends MainTeleOp {
    @Override protected double shotPower() { return 0.9; }
}`;
const TUNED = HEAD + `
@TeleOp(name = "Main + encoders, tuned")
public class MainTeleOpTuned extends MainTeleOpEncoders {
    @Override protected double shotPower() { return 0.75; }
}`;
const RED = HEAD + `
@Autonomous(name = "Park Red")
public class ParkAutoRed extends LinearOpMode {
    public static double FORWARD_SECONDS = 0.5;
    protected double side() { return 1; }
    @Override public void runOpMode() {
        DcMotor fl = hardwareMap.get(DcMotor.class, "FL"), fr = hardwareMap.get(DcMotor.class, "FR");
        waitForStart();
        fl.setPower(0.4 * side()); fr.setPower(0.4);
        sleep((long) (FORWARD_SECONDS * 1000));
        fl.setPower(0); fr.setPower(0);
    }
}`;
const BLUE = HEAD + `
@Autonomous(name = "Park Blue")
public class ParkAutoBlue extends ParkAutoRed {
    @Override protected double side() { return -1; }
}`;
const OTHER = HEAD + `
@TeleOp(name = "Motor test")
public class MotorTest extends OpMode {
    DcMotor m;
    @Override public void init() { m = hardwareMap.get(DcMotor.class, "FL"); }
    @Override public void loop() { m.setPower(gamepad1.a ? 0.5 : 0); }
}`;
const pool = [
  { file: 'MotorTest.java', src: OTHER }, { file: 'MainTeleOp.java', src: MAIN }, { file: 'MainTeleOpEncoders.java', src: ENCODERS },
  { file: 'MainTeleOpTuned.java', src: TUNED }, { file: 'ParkAutoRed.java', src: RED }, { file: 'ParkAutoBlue.java', src: BLUE },
];
const files = (l) => l.map((p) => p.file).sort();

test('siblings: an OpMode that extends another gets that file, and no other', () => {
  assert.deepEqual(files(E.jvSiblings(ENCODERS, pool)), ['MainTeleOp.java']);
  assert.deepEqual(files(E.jvSiblings(BLUE, pool)), ['ParkAutoRed.java']);
  assert.deepEqual(files(E.jvSiblings(MAIN, pool)), [], 'the parent needs nobody');
  assert.deepEqual(files(E.jvSiblings(OTHER, pool)), []);
});

test('siblings: a parent\'s parent comes too', () => {
  assert.deepEqual(files(E.jvSiblings(TUNED, pool)), ['MainTeleOp.java', 'MainTeleOpEncoders.java']);
});

test('siblings: a name in a comment, or inside a longer name, is not a use', () => {
  const src = OTHER.replace('DcMotor m;', 'DcMotor m; // copied from MainTeleOp\n    int MainTeleOpish, xParkAutoRed;');
  assert.deepEqual(files(E.jvSiblings(src, pool.filter((p) => p.src !== OTHER))), []);
});

test('siblings: another OpMode named for its constants is found too', () => {
  const src = OTHER.replace('m.setPower(gamepad1.a ? 0.5 : 0);', 'm.setPower(ParkAutoRed.FORWARD_SECONDS);');
  assert.deepEqual(files(E.jvSiblings(src, pool.filter((p) => p.src !== OTHER))), ['ParkAutoRed.java']);
});

test('the variant read with its parent has the parent\'s hardware and its own override', () => {
  const code = E.parseJava(ENCODERS, { libs: E.jvSiblings(ENCODERS, pool) });
  assert.equal(code.engine, 'vm');
  assert.deepEqual(code.devices.map((d) => d.name).sort(), ['BL', 'BR', 'FL', 'FR', 'shooter']);
  assert.ok(!code.vmTried);
  const comp = E.jvCompile(ENCODERS, E.jvSiblings(ENCODERS, pool));
  const r = E.jvProbeRun(comp, { a: true, left_stick_y: -1 }, {}, 6);
  assert.equal(r.P.error, null);
  assert.equal(r.motors.shooter.cmd, 0.9, 'shotPower() is the variant\'s, loop() the parent\'s');
  assert.equal(r.motors.FL.cmd, 1);
});

test('the blue auto drives as the red one does, mirrored', () => {
  const comp = E.jvCompile(BLUE, E.jvSiblings(BLUE, pool));
  const r = E.jvProbeRun(comp, {}, {}, 6);
  assert.equal(r.P.error, null);
  assert.equal(r.motors.FL.cmd, -0.4);
  assert.equal(r.motors.FR.cmd, 0.4);
});

test('read without its parent, the OpMode says which file is missing', () => {
  const P = new E.JvProgram(E.jvCompile(ENCODERS, []), E.jvProbeHost().host);
  P.init();
  assert.equal(P.error && P.error.cls, 'MissingClass');
  assert.match(P.error.msg, /^MainTeleOpEncoders extends MainTeleOp, and MainTeleOp\.java isn't loaded/);

  const code = E.parseJava(ENCODERS, { libs: [] });
  assert.equal(code.devices.length, 0);
  assert.match(code.vmTried.err, /^MissingClass: MainTeleOpEncoders extends MainTeleOp/);
  const F = E.analyze(code, JSON.parse(JSON.stringify(E.SAMPLE_CAD)), {}, {});
  const f = F.find((x) => x.key === 'struct:parent');
  assert.ok(f, 'the Checks tab names the missing parent');
  assert.equal(f.sev, 'fail');
  assert.match(f.body, /MainTeleOp\.java isn't loaded/);
  assert.match(f.fix, /Drop the missing/);
  assert.ok(!F.some((x) => x.key === 'struct:dev' || x.key === 'struct:loop' || x.key === 'struct:wait'),
    'and says nothing else about its structure: no hardware, no loop and no waitForStart() all follow from the one cause');
});

test('a parent from a library the bench does not have is named as that, not as a file to add', () => {
  const src = HEAD + `import com.example.menus.MenuOpMode;
@TeleOp(name = "Tuning")
public class Tuning extends MenuOpMode {
    public Tuning() { super("pick one"); }
}`;
  const P = new E.JvProgram(E.jvCompile(src, []), E.jvProbeHost().host);
  P.init();
  assert.equal(P.error && P.error.cls, 'MissingClass');
  assert.match(P.error.msg, /Tuning extends MenuOpMode, a class from com\.example\.menus that the bench doesn't have/);
  const F = E.analyze(E.parseJava(src, { libs: [] }), JSON.parse(JSON.stringify(E.SAMPLE_CAD)), {}, {});
  const f = F.find((x) => x.key === 'struct:parent');
  assert.ok(f && !/Drop the missing/.test(f.fix), 'the advice is not "add the file": there is no file of the team\'s to add');
});

test('a missing parent under an OpMode with its own init() and loop() is no error: it still runs', () => {
  const src = HEAD + `
@TeleOp(name = "Own loop")
public class OwnLoop extends TeamBase {
    DcMotor m;
    public void init() { m = hardwareMap.get(DcMotor.class, "arm"); }
    public void loop() { m.setPower(0.3); }
}`;
  const P = new E.JvProgram(E.jvCompile(src, []), E.jvProbeHost().host);
  P.init();
  assert.equal(P.error, null);
});
