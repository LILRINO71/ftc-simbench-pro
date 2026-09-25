package org.firstinspires.ftc.teamcode.Auto;

import com.arcrobotics.ftclib.controller.PIDController;

public class Slides_PID_Class {
    private static PIDController controller1;
    public static double p1 = 0.008, i1 = 0, d1 = 0;
    public static double f1 = 0.2;



    public static int target1;

    public static final double ticks_in_degrees = (1425.1/360); //change the 360 back to 180 if no work

    static double power1;

    public static double returnArmPID1(double target1, double specArmPos1){

        controller1 = new PIDController(p1,i1,d1);
        controller1.setPID(p1,i1,d1);

        double pid1 = controller1.calculate(specArmPos1,target1);
        double ff1 = Math.cos(Math.toRadians(target1/ticks_in_degrees)) * f1;

        power1 = pid1 + ff1;

        return power1;


    }
}