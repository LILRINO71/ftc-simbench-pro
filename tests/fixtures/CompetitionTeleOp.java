package org.firstinspires.ftc.teamcode;

import com.arcrobotics.ftclib.controller.PIDController;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.Servo;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;

// Test fixture: exercises the constructs real competition TeleOps use.
@TeleOp(name = "Fixture Competition", group = "test")
public class CompetitionTeleOp extends LinearOpMode {

    private PIDController liftPid;
    public static double kP = 0.004, kI = 0.0, kD = 0.0002;
    public static double kF = 0.10;
    public static int liftTarget;                       // no initializer: reads as 0

    private final double ticksPerDeg = 537.7 / 360.0;   // expression initializer

    private DcMotorEx lift;
    boolean slowMode = false;

    @Override
    public void runOpMode() throws InterruptedException {
        DcMotor fl = hardwareMap.dcMotor.get("frontLeft");
        DcMotor bl = hardwareMap.dcMotor.get("backLeft");
        DcMotor fr = hardwareMap.dcMotor.get("frontRight");
        DcMotor br = hardwareMap.dcMotor.get("backRight");

        Servo wristL = hardwareMap.servo.get("wristL");
        Servo wristR = hardwareMap.servo.get("wristR");
        Servo grip = hardwareMap.servo.get("grip");

        lift = hardwareMap.get(DcMotorEx.class, "lift");
        liftPid = new PIDController(kP, kI, kD);

        wristR.setDirection(Servo.Direction.REVERSE);
        fr.setDirection(DcMotorSimple.Direction.REVERSE);
        br.setDirection(DcMotorSimple.Direction.REVERSE);

        IMU imu = hardwareMap.get(IMU.class, "imu");
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.UP,
                RevHubOrientationOnRobot.UsbFacingDirection.FORWARD)));

        waitForStart();

        while (opModeIsActive()) {
            double scale = slowMode ? 0.4 : 1.0;

            if (gamepad2.a) {
                wristL.setPosition(0.30);
                wristR.setPosition(0.30);
                liftTarget = 1200;
            }
            if (gamepad2.b) {
                wristL.setPosition(0.70);
                wristR.setPosition(0.70);
                liftTarget = 0;
            }
            if (gamepad2.right_bumper) {
                grip.setPosition(0.55);
                sleep(300);
                grip.setPosition(0.20);
            }
            if (gamepad2.y) {
            }
            if (gamepad2.back) {
                lift.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
                lift.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
            }

            liftPid.setPID(kP, kI, kD);
            int pos = lift.getCurrentPosition();
            double out = liftPid.calculate(pos, liftTarget);
            double ff = Math.cos(Math.toRadians(liftTarget / ticksPerDeg)) * kF;
            lift.setPower(out + ff);

            double heading = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS);
            double y = -gamepad1.left_stick_y * scale;
            double x = gamepad1.left_stick_x * scale;
            double rx = gamepad1.right_stick_x * scale;
            double rotX = x * Math.cos(-heading) - y * Math.sin(-heading);
            double rotY = x * Math.sin(-heading) + y * Math.cos(-heading);
            double den = Math.max(Math.abs(rotY) + Math.abs(rotX) + Math.abs(rx), 1);

            fl.setPower((rotY + rotX + rx) / den);
            bl.setPower((rotY - rotX + rx) / den);
            fr.setPower((rotY - rotX - rx) / den);
            br.setPower((rotY + rotX - rx) / den);

            telemetry.addData("lift", pos);
            telemetry.addData("target", liftTarget);
            telemetry.update();
        }
    }
}
