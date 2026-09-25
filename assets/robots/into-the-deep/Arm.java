package org.firstinspires.ftc.teamcode.Auto;

import static java.lang.Thread.sleep;

import androidx.annotation.NonNull;

import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import com.acmerobotics.roadrunner.Action;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

import org.firstinspires.ftc.teamcode.Auto.Arm_PID_Class;
import org.firstinspires.ftc.teamcode.Auto.Slides_PID_Class;


public class Arm {

    public DcMotorEx Arm;
    public int setPosition;

    public DcMotorEx uppies;
    public DcMotorEx uppies1;

    public int setPosition1;

    Servo linkL;
    Servo linkR;
    Servo inY;
    Servo inX;
    Servo inClaw;
    Servo outRot;
    Servo outClaw;

    Servo inPiv;

    public Arm(HardwareMap hardwareMap) {


        Arm = hardwareMap.get(DcMotorEx.class, "Arm");
        Arm.setZeroPowerBehavior(DcMotorEx.ZeroPowerBehavior.BRAKE);

        uppies = hardwareMap.get(DcMotorEx.class, "uppies");
//        uppies1 = hardwareMap.get(DcMotorEx.class, "uppies1");

        uppies.setZeroPowerBehavior(DcMotorEx.ZeroPowerBehavior.BRAKE);

        linkL = hardwareMap.servo.get("linkL");
        linkR = hardwareMap.servo.get("linkR");

        inY = hardwareMap.servo.get("inY");
        inX = hardwareMap.servo.get("inX");
        inClaw = hardwareMap.servo.get("inClaw");
        outRot = hardwareMap.servo.get("outRot");
        outClaw = hardwareMap.servo.get("outClaw");

        inPiv = hardwareMap.servo.get("inPiv");

        linkR.setDirection(Servo.Direction.REVERSE);
        outRot.setDirection(Servo.Direction.REVERSE);


    }

// use public void

    public class updatePID implements Action {
        public updatePID(){

        }
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {
            Arm.setPower(Arm_PID_Class.returnArmPID(setPosition,Arm.getCurrentPosition()));

            return true;
        }
    }
    public Action UpdatePID(){return new updatePID();}

    public class setPosition implements Action {
        int set;
        public setPosition(int position){set = position;}
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {
            setPosition = set;
            return false;
        }
    }
    public Action SetPosition(int pos){return new setPosition(pos);}
    ////////////////////////////////////////////////////////////////////////////////////////////////
    public class armDown implements Action {
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {

            outRot.setPosition(0.32);

            return false;
        }
    }
    public Action armDown() {
        return new Arm.armDown();
    }
    ///////////////////////////////////////////////////////////////////////////////////////////////
    public class armUp implements Action {
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {

            outRot.setPosition(0.97);
            outClaw.setPosition(0.72);


            return false;
        }
    }
    public Action armUp() {
        return new Arm.armUp();
    }

    //////////////////////////////////////////////////////////////////////////////////////


    public class openClaw implements Action {
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {

            outClaw.setPosition(0.35);



            return false;
        }
    }
    public Action openClaw() {
        return new Arm.openClaw();
    }

    //////////////////////////////////////////////////////////////////////////////////////
    public class lockIntake implements Action {
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {

            linkL.setPosition(0.53);
            linkR.setPosition(0.53);
            inClaw.setPosition(0.3);
            inY.setPosition(0.83);//bring claw back
            inPiv.setPosition(0.4);




            return false;
        }
    }
    public Action lockIntake() {
        return new Arm.lockIntake();
    }

    public class extendIn implements Action {
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {
            outClaw.setPosition(0.35);
            inY.setPosition(0.19);//lower claw to ground-level
            inPiv.setPosition(0.23);
            linkL.setPosition(0.25);
            linkR.setPosition(0.25);





            return false;
        }
    }
    public Action extendIn() {
        return new Arm.extendIn();
    }


    public class closeClaw implements Action {
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {

            outClaw.setPosition(0.68);
            inX.setPosition(0.5); // Set to neutral if joystick is idle



            return false;
        }
    }
    public Action closeClaw() {
        return new Arm.closeClaw();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public class updatePID1 implements Action {
        public updatePID1(){

        }
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {
            uppies.setPower(Slides_PID_Class.returnArmPID1(setPosition1,uppies.getCurrentPosition()));

            return true;
        }
    }
    public Action UpdatePID1(){return new updatePID1();}

    public class setPosition1 implements Action {
        int set1;
        public setPosition1(int position1){set1 = position1;}
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {
            setPosition1 = set1;
            return false;
        }
    }
    public Action SetPosition1(int pos1){return new setPosition1(pos1);}
/////////////////////////////////////////////////////////////////////////////////////////////////
public class grab implements Action {
    @Override
    public boolean run(@NonNull TelemetryPacket packet) {

        inClaw.setPosition(0.495);//close claw
        return false;
    }
}
    public Action grab() {
        return new Arm.grab();
    }

/////////////////////////////////////////////////////////////////////////////////////
    public class transferPos implements Action {
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {
            outRot.setPosition(0.32);
            outClaw.setPosition(0.4);
            inY.setPosition(0.7);//bring claw back
            inPiv.setPosition(0.15);
            linkL.setPosition(0.53);
            linkR.setPosition(0.53);
            inClaw.setPosition(0.51);//close claw
            inX.setPosition(0.5);
            return false;
        }
    }
    public Action transferPos() {
        return new Arm.transferPos();
    }
    //////////////////////////////////////////////////////////////////////////////////////////////

    public class transfer implements Action {
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {

            inClaw.setPosition(0.4);
            outClaw.setPosition(0.65);





            return false;
        }
    }
    public Action transfer() {
        return new Arm.transfer();
    }
    ////////////////////////////////////////////////////////////////////
    public class clawTilt implements Action {
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {

            inX.setPosition(0.2);
            return false;
        }
    }
    public Action clawTilt() {
        return new Arm.clawTilt();
    }
    ////////////////////////////////////////////////////////////////////
    public class resetpiddd implements Action {
        @Override
        public boolean run(@NonNull TelemetryPacket packet) {

            Arm.setPower(0);
            uppies.setPower(0);
            Arm.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            uppies.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            Arm.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
            uppies.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
            return false;
        }
    }
    public Action resetpiddd() {
        return new Arm.resetpiddd();
    }
}