package org.firstinspires.ftc.teamcode.Auto;

import com.arcrobotics.ftclib.controller.PIDController;

public class Arm_PID_Class {
    private static PIDController controller;
    public static double p = 0.0036, i = 0.03, d = 0.000525;
    public static double f = 0.08;
    public static final double ticks_in_degrees = (1425.1/360.0) / 2; //change the 360 back to 180 if no work

    static double power;

    public static double returnArmPID(double target, double specArmPos){

        controller = new PIDController(p,i,d);
        controller.setPID(p,i,d);

        double pid = controller.calculate(specArmPos,target);
        double ff = Math.cos(Math.toRadians(target/ticks_in_degrees)) * f;

        power = pid + ff;

        return power;


    }
}