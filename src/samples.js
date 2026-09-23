/* ============================================================
   1.  SAMPLES
   ============================================================ */
const SAMPLE_JAVA = `package org.firstinspires.ftc.teamcode.pedroPathing;

// ===== IMPORTS =====
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.Servo;


@TeleOp(name = "Basic Claw Test")
public class WORKSHOPCODE extends LinearOpMode {

    // Speed servo that opens and closes the claw
    Servo claw;

    // Torque servo that moves the arm up and down
    Servo arm;

    // Torque servo that rotates the arm
    Servo rotate;

    static final double CLAW_OPEN = 0.20;
    static final double CLAW_CLOSE = 0.50;

    static final double ARM_DOWN = 0.20;
    static final double ARM_UP = 0.40;

    double rotatePosition = 0.50;
    static final double ROTATE_STEP = 0.10;
    static final double ROTATE_MIN = 0.10;
    static final double ROTATE_MAX = 0.90;

    boolean lastLeftBumper = false;
    boolean lastRightBumper = false;

    @Override
    public void runOpMode() {

        claw = hardwareMap.servo.get("claw");
        arm = hardwareMap.servo.get("arm");
        rotate = hardwareMap.servo.get("rotate");

        claw.setPosition(CLAW_OPEN);
        arm.setPosition(ARM_DOWN);
        rotate.setPosition(rotatePosition);

        waitForStart();

        while (opModeIsActive()) {

            // A = close claw
            if (gamepad2.a) {
                claw.setPosition(CLAW_CLOSE);
            }

            // B = open claw
            if (gamepad2.b) {
                claw.setPosition(CLAW_OPEN);
            }

            // X = move arm up
            if (gamepad2.x) {
                arm.setPosition(ARM_UP);
            }

            // Y = move arm down
            if (gamepad2.y) {
                arm.setPosition(ARM_DOWN);
            }

            if (gamepad2.right_bumper && !lastRightBumper) {
                rotatePosition += ROTATE_STEP;
                if (rotatePosition > ROTATE_MAX) {
                    rotatePosition = ROTATE_MAX;
                }
                rotate.setPosition(rotatePosition);
            }

            if (gamepad2.left_bumper && !lastLeftBumper) {
                rotatePosition -= ROTATE_STEP;
                if (rotatePosition < ROTATE_MIN) {
                    rotatePosition = ROTATE_MIN;
                }
                rotate.setPosition(rotatePosition);
            }

            lastRightBumper = gamepad2.right_bumper;
            lastLeftBumper = gamepad2.left_bumper;

            telemetry.addData("Claw Position", claw.getPosition());
            telemetry.addData("Arm Position", arm.getPosition());
            telemetry.addData("Rotate Position", rotatePosition);

            telemetry.addLine("");
            telemetry.addLine("A = Close Claw");
            telemetry.addLine("B = Open Claw");
            telemetry.addLine("X = Arm Up");
            telemetry.addLine("Y = Arm Down");
            telemetry.addLine("LB = Rotate Left");
            telemetry.addLine("RB = Rotate Right");

            telemetry.update();
        }
    }
}`;

const DRIVE_JAVA = `package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.Servo;

@TeleOp(name = "Mecanum Drive + Lift")
public class MecanumTeleOp extends LinearOpMode {

    DcMotor leftFront;
    DcMotor rightFront;
    DcMotor leftBack;
    DcMotor rightBack;

    // Torque servo on the lift
    Servo lift;

    static final double SPEED = 0.85;
    static final double LIFT_DOWN = 0.15;
    static final double LIFT_UP = 0.75;

    @Override
    public void runOpMode() {

        leftFront = hardwareMap.get(DcMotor.class, "leftFront");
        rightFront = hardwareMap.get(DcMotor.class, "rightFront");
        leftBack = hardwareMap.get(DcMotor.class, "leftBack");
        rightBack = hardwareMap.get(DcMotor.class, "rightBack");
        lift = hardwareMap.get(Servo.class, "lift");

        // the left motors face the other way
        leftFront.setDirection(DcMotor.Direction.REVERSE);
        leftBack.setDirection(DcMotor.Direction.REVERSE);

        lift.setPosition(LIFT_DOWN);

        waitForStart();

        while (opModeIsActive()) {

            double y = -gamepad1.left_stick_y;
            double x = gamepad1.left_stick_x;
            double turn = gamepad1.right_stick_x;

            leftFront.setPower((y + x + turn) * SPEED);
            leftBack.setPower((y - x + turn) * SPEED);
            rightFront.setPower((y - x - turn) * SPEED);
            rightBack.setPower((y + x - turn) * SPEED);

            if (gamepad2.dpad_up) {
                lift.setPosition(LIFT_UP);
            }
            if (gamepad2.dpad_down) {
                lift.setPosition(LIFT_DOWN);
            }

            telemetry.addData("Left Front", leftFront.getPower());
            telemetry.addData("Right Front", rightFront.getPower());
            telemetry.addData("Lift", lift.getPosition());
            telemetry.update();
        }
    }
}`;

const AUTO_JAVA = `package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.util.ElapsedTime;

@Autonomous(name = "Timed Drive Auto", group = "samples")
public class TimedDriveAuto extends LinearOpMode {

    private ElapsedTime runtime = new ElapsedTime();

    static final double DRIVE = 0.6;
    static final double TURN = 0.5;

    @Override
    public void runOpMode() {
        DcMotor leftFront = hardwareMap.get(DcMotor.class, "leftFront");
        DcMotor rightFront = hardwareMap.get(DcMotor.class, "rightFront");
        DcMotor leftBack = hardwareMap.get(DcMotor.class, "leftBack");
        DcMotor rightBack = hardwareMap.get(DcMotor.class, "rightBack");
        Servo lift = hardwareMap.get(Servo.class, "lift");

        leftFront.setDirection(DcMotor.Direction.REVERSE);
        leftBack.setDirection(DcMotor.Direction.REVERSE);
        lift.setPosition(0.15);

        telemetry.addData("Status", "Ready");
        telemetry.update();

        waitForStart();
        runtime.reset();

        leftFront.setPower(DRIVE);
        rightFront.setPower(DRIVE);
        leftBack.setPower(DRIVE);
        rightBack.setPower(DRIVE);
        sleep(1200);

        leftFront.setPower(TURN);
        leftBack.setPower(TURN);
        rightFront.setPower(-TURN);
        rightBack.setPower(-TURN);
        sleep(700);

        leftFront.setPower(0);
        rightFront.setPower(0);
        leftBack.setPower(0);
        rightBack.setPower(0);
        lift.setPosition(0.75);
        sleep(800);

        while (opModeIsActive() && runtime.seconds() < 5.0) {
            leftFront.setPower(-0.3);
            rightFront.setPower(-0.3);
            leftBack.setPower(-0.3);
            rightBack.setPower(-0.3);
            telemetry.addData("Elapsed", runtime.seconds());
            telemetry.update();
        }

        leftFront.setPower(0);
        rightFront.setPower(0);
        leftBack.setPower(0);
        rightBack.setPower(0);
    }
}`;

const SHOOTER_JAVA = `package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.Servo;

@TeleOp(name = "BIOBUZZ Shooter")
public class ShooterTeleOp extends LinearOpMode {

    DcMotor leftFront;
    DcMotor rightFront;
    DcMotor leftBack;
    DcMotor rightBack;

    // 6000 rpm goBILDA, 1:1 to the flywheel
    DcMotorEx flywheel;
    Servo kicker;

    static double NEAR_VELOCITY = 1080;
    static double FAR_VELOCITY = 1280;
    static final double KICK_REST = 0.20;
    static final double KICK_FIRE = 0.55;

    double target = 0;

    @Override
    public void runOpMode() {
        leftFront = hardwareMap.get(DcMotor.class, "leftFront");
        rightFront = hardwareMap.get(DcMotor.class, "rightFront");
        leftBack = hardwareMap.get(DcMotor.class, "leftBack");
        rightBack = hardwareMap.get(DcMotor.class, "rightBack");
        flywheel = hardwareMap.get(DcMotorEx.class, "flywheel");
        leftFront.setDirection(DcMotor.Direction.REVERSE);
        leftBack.setDirection(DcMotor.Direction.REVERSE);
        kicker = hardwareMap.get(Servo.class, "kicker");

        kicker.setPosition(KICK_REST);

        waitForStart();

        while (opModeIsActive()) {
            double y = -gamepad1.left_stick_y;
            double x = gamepad1.left_stick_x;
            double turn = gamepad1.right_stick_x;

            leftFront.setPower(y + x + turn);
            leftBack.setPower(y - x + turn);
            rightFront.setPower(y - x - turn);
            rightBack.setPower(y + x - turn);

            if (gamepad2.dpad_up) {
                target = FAR_VELOCITY;
            }
            if (gamepad2.dpad_down) {
                target = NEAR_VELOCITY;
            }
            if (gamepad2.b) {
                target = 0;
            }
            flywheel.setVelocity(target);

            if (gamepad2.right_bumper) {
                kicker.setPosition(KICK_FIRE);
            } else {
                kicker.setPosition(KICK_REST);
            }

            telemetry.addData("Flywheel target", target);
            telemetry.addData("Flywheel velocity", flywheel.getVelocity());
            telemetry.update();
        }
    }
}`;

/* Measured out of the user's fulll.step (AP242, metre units). */
const SAMPLE_CAD = {
  name:"fulll.step", units:"METRE", pointCount:127206,
  bbox:{min:[-0.144,-0.115,-0.167], max:[0.270,0.375,0.238]},
  parts:[
    {name:"Arm",  part:"2000-0025-0002", n:1, kind:"servo"},
    {name:"Base", part:"2000-0025-0002", n:1, kind:"servo"},
    {name:"Claw", part:"2000-0025-0003", n:1, kind:"servo"},
    {name:"Servo Mount", part:null, n:2, kind:"struct"},
    {name:"1201-0043-0002 rev2", part:null, n:4, kind:"struct"},
    {name:"1100-0010-0264 rev1", part:null, n:2, kind:"struct"},
    {name:"1100-0009-0240 rev1", part:null, n:1, kind:"struct"},
    {name:"1100-0008-0216 rev1", part:null, n:1, kind:"struct"},
    {name:"1107-0011-0288 rev1", part:null, n:1, kind:"struct"},
    {name:"1107-0005-0144 rev1", part:null, n:1, kind:"struct"},
    {name:"1908-0025-0032 rev1", part:null, n:3, kind:"struct"},
    {name:"Sonic Hub (8mm REX Bore)", part:null, n:1, kind:"struct"},
    {name:"8mm REX flanged bearing", part:null, n:1, kind:"struct"},
    {name:"2106-4008-0520 assembly", part:null, n:1, kind:"struct"},
    {name:"2920-0001-4008 assembly", part:null, n:1, kind:"struct"},
    {name:"1802-0043-0001", part:null, n:1, kind:"struct"}
  ],
  mechs:[
    {id:"Arm",  part:"2000-0025-0002", partName:"2000 Series Servo", axis:[-0.72,0.70,0.00], pivot:[0.1323,0.2244,0.1958]},
    {id:"Base", part:"2000-0025-0002", partName:"2000 Series Servo", axis:[0,0,1],           pivot:[0.1354,0.2310,-0.0522]},
    {id:"Claw", part:"2000-0025-0003", partName:"2000 Series Servo", axis:[-0.47,-0.49,0.73],pivot:[0.0296,0.1461,0.0918]}
  ]
};

/* The same robot as solids: goBILDA channel frame, the column, three
   servos, the arm and a printed claw. */
function sampleSolids(){
  const box=(name,kind,c,s)=>{ const pts=[];
    for(let i=0;i<8;i++) pts.push([c[0]+(i&1?.5:-.5)*s[0], c[1]+(i&2?.5:-.5)*s[1], c[2]+(i&4?.5:-.5)*s[2]]);
    return {name, kind, pts, size:Math.hypot(s[0],s[1],s[2])}; };
  const bar=(name,kind,a,b,w,t)=>{
    const d=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], L=Math.hypot(d[0],d[1],d[2]), u=d.map(v=>v/L);
    const up=Math.abs(u[2])<0.9?[0,0,1]:[1,0,0];
    let s=[u[1]*up[2]-u[2]*up[1], u[2]*up[0]-u[0]*up[2], u[0]*up[1]-u[1]*up[0]];
    const sl=Math.hypot(s[0],s[1],s[2]); s=s.map(v=>v/sl);
    const n=[u[1]*s[2]-u[2]*s[1], u[2]*s[0]-u[0]*s[2], u[0]*s[1]-u[1]*s[0]];
    const pts=[];
    for(const e of [a,b]) for(const i of [-1,1]) for(const j of [-1,1])
      pts.push([e[0]+s[0]*i*w/2+n[0]*j*t/2, e[1]+s[1]*i*w/2+n[1]*j*t/2, e[2]+s[2]*i*w/2+n[2]*j*t/2]);
    return {name, kind, pts, size:L};
  };
  const cyl=(name,kind,c,r,h,axis)=>{ const pts=[];
    for(let i=0;i<16;i++){ const t=i/16*Math.PI*2, a=Math.cos(t)*r, b=Math.sin(t)*r;
      for(const z of [-h/2,h/2]) pts.push(axis==="x"?[c[0]+z,c[1]+a,c[2]+b]:axis==="y"?[c[0]+a,c[1]+z,c[2]+b]:[c[0]+a,c[1]+b,c[2]+z]); }
    return {name, kind, pts, size:Math.hypot(2*r,h)}; };
  return [
    box("1120 U-Channel, left","metal",[0.014,0.255,-0.026],[0.032,0.240,0.048]),
    box("1120 U-Channel, right","metal",[0.254,0.255,-0.026],[0.032,0.240,0.048]),
    box("1120 U-Channel, back","metal",[0.134,0.372,-0.026],[0.250,0.032,0.048]),
    box("1120 U-Channel, front","metal",[0.134,0.140,-0.026],[0.250,0.032,0.048]),
    box("1121 Low-Side U-Channel column","metal",[0.135,0.231,0.055],[0.042,0.042,0.210]),
    box("Base servo 2000-0025-0002","servo",[0.135,0.231,-0.040],[0.056,0.056,0.050]),
    cyl("Sonic Hub","metal",[0.135,0.231,-0.010],0.018,0.012,"z"),
    box("Arm servo 2000-0025-0002","servo",[0.132,0.224,0.196],[0.046,0.056,0.040]),
    bar("Arm 1107 Channel","metal",[0.132,0.224,0.196],[0.030,0.172,0.094],0.030,0.018),
    box("Claw servo 2000-0025-0003","servo",[0.030,0.150,0.092],[0.040,0.048,0.036]),
    box("Claw palm (printed)","printed",[0.016,0.181,0.084],[0.030,0.030,0.030]),
    box("Claw finger (printed)","printed",[0.004,0.196,0.104],[0.014,0.056,0.012]),
    box("Claw finger (printed)","printed",[0.030,0.200,0.112],[0.014,0.056,0.012])
  ];
}

function synthGeometry(){
  const P=[]; const R=(a,b)=>a+Math.random()*(b-a);
  const box=(c,s,n)=>{for(let i=0;i<n;i++){
    const f=Math.floor(Math.random()*6), u=R(-.5,.5), v=R(-.5,.5);
    const w=(f<2?0:f<4?1:2), sg=(f%2)?.5:-.5; const p=[0,0,0];
    p[w]=sg; p[(w+1)%3]=u; p[(w+2)%3]=v;
    P.push([c[0]+p[0]*s[0], c[1]+p[1]*s[1], c[2]+p[2]*s[2]]);}};
  box([0.014,0.255,-0.026],[0.032,0.240,0.048],7000);
  box([0.254,0.255,-0.026],[0.032,0.240,0.048],7000);
  box([0.134,0.372,-0.026],[0.250,0.032,0.048],6000);
  box([0.134,0.140,-0.026],[0.250,0.032,0.048],6000);
  box([0.135,0.231,0.055],[0.042,0.042,0.210],8000);
  box([0.135,0.231,-0.040],[0.056,0.056,0.050],3500);
  box([0.132,0.224,0.196],[0.046,0.056,0.040],4500);
  for(let i=0;i<10000;i++){ const t=Math.random();
    P.push([0.132+(0.020-0.132)*t + R(-.010,.010), 0.224+(0.170-0.224)*t + R(-.010,.010),
            0.196+(0.090-0.196)*t + R(-.008,.008)]); }
  box([0.030,0.150,0.092],[0.040,0.048,0.036],4500);
  box([0.016,0.181,0.084],[0.030,0.030,0.030],2400);
  box([0.004,0.196,0.104],[0.014,0.056,0.012],2000);
  box([0.030,0.200,0.112],[0.014,0.056,0.012],2000);
  return P;
}
