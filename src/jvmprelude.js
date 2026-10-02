/* ============================================================
   4c. LIBRARY CLASSES WRITTEN IN JAVA, for the VM (src/jvm.js)
   ------------------------------------------------------------
   The parts of the SDK, FTCLib, Road Runner and Pedro Pathing a
   TeleOp reaches, as plain Java the VM runs exactly like a team's
   own files. They follow each library's behaviour (FTCLib's mecanum
   maths and command scheduler, Road Runner's kinematics, Pedro's
   TeleOp drive); the bodies are this project's own, kept short.
   Hardware itself is in src/jvmlib.js.
   ============================================================ */
const JV_PRELUDE=[
/* ---- SDK navigation ---- */
`package org.firstinspires.ftc.robotcore.external.navigation;
public enum AngleUnit { DEGREES, RADIANS;
  public double fromDegrees(double d){ return this==RADIANS ? Math.toRadians(d) : d; }
  public double fromRadians(double r){ return this==DEGREES ? Math.toDegrees(r) : r; }
  public double toDegrees(double v){ return this==RADIANS ? Math.toDegrees(v) : v; }
  public double toRadians(double v){ return this==DEGREES ? Math.toRadians(v) : v; }
  public double fromUnit(AngleUnit u, double v){ return u==this ? v : (this==DEGREES ? Math.toDegrees(v) : Math.toRadians(v)); }
  public double normalize(double v){ return this==DEGREES ? normalizeDegrees(v) : normalizeRadians(v); }
  public static double normalizeDegrees(double d){ while(d>=180.0) d-=360.0; while(d<-180.0) d+=360.0; return d; }
  public static double normalizeRadians(double r){ while(r>=Math.PI) r-=2*Math.PI; while(r<-Math.PI) r+=2*Math.PI; return r; }
  public UnnormalizedAngleUnit getUnnormalized(){ return this==DEGREES ? UnnormalizedAngleUnit.DEGREES : UnnormalizedAngleUnit.RADIANS; }
}`,
`package org.firstinspires.ftc.robotcore.external.navigation;
public enum UnnormalizedAngleUnit { DEGREES, RADIANS;
  public double fromRadians(double r){ return this==DEGREES ? Math.toDegrees(r) : r; }
  public double toRadians(double v){ return this==DEGREES ? Math.toRadians(v) : v; }
  public AngleUnit getNormalized(){ return this==DEGREES ? AngleUnit.DEGREES : AngleUnit.RADIANS; }
}`,
`package org.firstinspires.ftc.robotcore.external.navigation;
public enum DistanceUnit { METER(1.0), CM(0.01), MM(0.001), INCH(0.0254);
  public static final double infinity = Double.MAX_VALUE;
  public static final double mPerInch = 0.0254;
  public final double metres;
  DistanceUnit(double m){ metres = m; }
  public double fromMeters(double v){ return v/metres; }
  public double fromInches(double v){ return v*0.0254/metres; }
  public double fromCm(double v){ return v*0.01/metres; }
  public double fromMm(double v){ return v*0.001/metres; }
  public double fromUnit(DistanceUnit u, double v){ return v*u.metres/metres; }
  public double toMeters(double v){ return v*metres; }
  public double toInches(double v){ return v*metres/0.0254; }
  public double toCm(double v){ return v*metres/0.01; }
  public double toMm(double v){ return v*metres/0.001; }
}`,
`package org.firstinspires.ftc.robotcore.external.navigation;
public enum AxesReference { EXTRINSIC, INTRINSIC }`,
`package org.firstinspires.ftc.robotcore.external.navigation;
public enum AxesOrder { XZX, XYX, YXY, YZY, ZYZ, ZXZ, XZY, XYZ, YXZ, YZX, ZYX, ZXY }`,
`package org.firstinspires.ftc.robotcore.external.navigation;
public class Orientation {
  public AxesReference axesReference; public AxesOrder axesOrder; public AngleUnit angleUnit;
  public float firstAngle; public float secondAngle; public float thirdAngle; public long acquisitionTime;
  public Orientation(){}
  public Orientation(AxesReference r, AxesOrder o, AngleUnit u, float a, float b, float c, long t){ axesReference=r; axesOrder=o; angleUnit=u; firstAngle=a; secondAngle=b; thirdAngle=c; acquisitionTime=t; }
  public Orientation toAngleUnit(AngleUnit u){ if(u==angleUnit||angleUnit==null) return this; return new Orientation(axesReference, axesOrder, u, (float)u.fromUnit(angleUnit,firstAngle), (float)u.fromUnit(angleUnit,secondAngle), (float)u.fromUnit(angleUnit,thirdAngle), acquisitionTime); }
}`,
`package org.firstinspires.ftc.robotcore.external.navigation;
public class AngularVelocity {
  public AngleUnit unit; public float xRotationRate; public float yRotationRate; public float zRotationRate; public long acquisitionTime;
  public AngularVelocity(){}
  public AngularVelocity(AngleUnit u, float x, float y, float z, long t){ unit=u; xRotationRate=x; yRotationRate=y; zRotationRate=z; acquisitionTime=t; }
}`,
`package org.firstinspires.ftc.robotcore.external.navigation;
public class YawPitchRollAngles {
  public YawPitchRollAngles(){}
  public double getYaw(){ return Math.toDegrees(yaw); }
  public double getYaw(AngleUnit u){ return u==AngleUnit.RADIANS ? yaw : Math.toDegrees(yaw); }
  public double getPitch(){ return Math.toDegrees(pitch); }
  public double getPitch(AngleUnit u){ return u==AngleUnit.RADIANS ? pitch : Math.toDegrees(pitch); }
  public double getRoll(){ return Math.toDegrees(roll); }
  public double getRoll(AngleUnit u){ return u==AngleUnit.RADIANS ? roll : Math.toDegrees(roll); }
  public long getAcquisitionTime(){ return 0; }
  double yaw; double pitch; double roll;
}`,
`package org.firstinspires.ftc.robotcore.external.navigation;
public class Pose2D {
  protected double x; protected double y; protected double heading; protected DistanceUnit distanceUnit; protected AngleUnit headingUnit;
  public Pose2D(DistanceUnit du, double x, double y, AngleUnit hu, double h){ distanceUnit=du; this.x=x; this.y=y; headingUnit=hu; heading=h; }
  public double getX(DistanceUnit u){ return u.fromUnit(distanceUnit, x); }
  public double getY(DistanceUnit u){ return u.fromUnit(distanceUnit, y); }
  public double getHeading(AngleUnit u){ return u.fromUnit(headingUnit, heading); }
  public String toString(){ return "Pose2D(" + x + ", " + y + ", " + heading + ")"; }
}`,
`package org.firstinspires.ftc.robotcore.external.navigation;
public class Position { public DistanceUnit unit; public double x; public double y; public double z; public long acquisitionTime;
  public Position(){} public Position(DistanceUnit u, double x, double y, double z, long t){ unit=u; this.x=x; this.y=y; this.z=z; acquisitionTime=t; } }`,
`package com.qualcomm.robotcore.hardware;
public class NormalizedRGBA { public float red; public float green; public float blue; public float alpha; public int toColor(){ return 0; } }`,
`package com.qualcomm.robotcore.hardware;
public class PIDFCoefficients { public double p; public double i; public double d; public double f;
  public PIDFCoefficients(){} public PIDFCoefficients(double p, double i, double d, double f){ this.p=p; this.i=i; this.d=d; this.f=f; }
  public PIDFCoefficients(double p, double i, double d, double f, Object algo){ this(p,i,d,f); } }`,
`package com.qualcomm.robotcore.hardware;
public class PIDCoefficients { public double p; public double i; public double d;
  public PIDCoefficients(){} public PIDCoefficients(double p, double i, double d){ this.p=p; this.i=i; this.d=d; } }`,
`package com.qualcomm.robotcore.hardware;
public interface ImuOrientationOnRobot {}`,
`package com.qualcomm.hardware.rev;
import com.qualcomm.robotcore.hardware.ImuOrientationOnRobot;
public class RevHubOrientationOnRobot implements ImuOrientationOnRobot {
  public enum LogoFacingDirection { UP, DOWN, FORWARD, BACKWARD, LEFT, RIGHT }
  public enum UsbFacingDirection { UP, DOWN, FORWARD, BACKWARD, LEFT, RIGHT }
  public RevHubOrientationOnRobot(LogoFacingDirection logo, UsbFacingDirection usb){}
  public RevHubOrientationOnRobot(Object o){}
  public static Object xyzOrientation(double a, double b, double c){ return null; }
  public static Object zyxOrientation(double a, double b, double c){ return null; }
}`,
`package com.qualcomm.robotcore.hardware;
public interface IMU extends HardwareDevice {
  class Parameters { public ImuOrientationOnRobot imuOrientationOnRobot; public Parameters(ImuOrientationOnRobot o){ imuOrientationOnRobot=o; } }
}`,
`package com.qualcomm.hardware.bosch;
public interface BNO055IMU {
  enum AngleUnit { DEGREES, RADIANS; public org.firstinspires.ftc.robotcore.external.navigation.AngleUnit toAngleUnit(){ return this==DEGREES ? org.firstinspires.ftc.robotcore.external.navigation.AngleUnit.DEGREES : org.firstinspires.ftc.robotcore.external.navigation.AngleUnit.RADIANS; } }
  enum AccelUnit { METERS_PERSEC_PERSEC, MILLI_EARTH_GRAVITY }
  enum SensorMode { CONFIG, IMU, NDOF, GYRONLY, ACCONLY, MAGONLY, COMPASS, M4G, NDOF_FMC_OFF }
  class Parameters {
    public AngleUnit angleUnit = AngleUnit.RADIANS; public AccelUnit accelUnit = AccelUnit.METERS_PERSEC_PERSEC;
    public String calibrationDataFile; public boolean loggingEnabled; public String loggingTag; public Object accelerationIntegrationAlgorithm; public SensorMode mode = SensorMode.IMU;
    public boolean useExternalCrystal = true; public Object calibrationData; public Object accelPowerMode; public Object accelRange;
  }
}`,
`package com.qualcomm.hardware.sparkfun;
public class SparkFunOTOS {
  public static class Pose2D { public double x; public double y; public double h;
    public Pose2D(){} public Pose2D(double x, double y, double h){ this.x=x; this.y=y; this.h=h; }
    public void set(Pose2D p){ x=p.x; y=p.y; h=p.h; } }
}`,
/* ---- FTCLib (and SolversLib, the same API) ---- */
`package com.arcrobotics.ftclib.util;
public class MathUtils {
  public static double clamp(double v, double lo, double hi){ return Math.max(lo, Math.min(hi, v)); }
  public static int clamp(int v, int lo, int hi){ return Math.max(lo, Math.min(hi, v)); }
}`,
`package com.arcrobotics.ftclib.geometry;
public class Vector2d {
  private double x; private double y;
  public Vector2d(){ this(0,0); }
  public Vector2d(double x, double y){ this.x=x; this.y=y; }
  public Vector2d(Vector2d v){ this(v.x, v.y); }
  public double getX(){ return x; } public double getY(){ return y; }
  public double angle(){ return Math.atan2(y, x); }
  public double magnitude(){ return Math.hypot(x, y); }
  public Vector2d rotateBy(double deg){ double r=Math.toRadians(deg), c=Math.cos(r), s=Math.sin(r); return new Vector2d(x*c - y*s, x*s + y*c); }
  public Vector2d plus(Vector2d o){ return new Vector2d(x+o.x, y+o.y); }
  public Vector2d minus(Vector2d o){ return new Vector2d(x-o.x, y-o.y); }
  public Vector2d times(double k){ return new Vector2d(x*k, y*k); }
  public Vector2d div(double k){ return new Vector2d(x/k, y/k); }
  public Vector2d unaryMinus(){ return new Vector2d(-x, -y); }
  public double dot(Vector2d o){ return x*o.x + y*o.y; }
  public Vector2d normalize(){ double m=magnitude(); return m==0 ? this : div(m); }
  public Vector2d scale(double k){ return times(k); }
}`,
`package com.arcrobotics.ftclib.geometry;
public class Rotation2d {
  private double value; private double cos; private double sin;
  public Rotation2d(){ this(0); }
  public Rotation2d(double v){ value=v; cos=Math.cos(v); sin=Math.sin(v); }
  public Rotation2d(double x, double y){ this(Math.atan2(y, x)); }
  public static Rotation2d fromDegrees(double d){ return new Rotation2d(Math.toRadians(d)); }
  public double getRadians(){ return value; } public double getDegrees(){ return Math.toDegrees(value); }
  public double getCos(){ return cos; } public double getSin(){ return sin; } public double getTan(){ return sin/cos; }
  public Rotation2d plus(Rotation2d o){ return new Rotation2d(value+o.value); }
  public Rotation2d minus(Rotation2d o){ return new Rotation2d(value-o.value); }
  public Rotation2d unaryMinus(){ return new Rotation2d(-value); }
  public Rotation2d times(double k){ return new Rotation2d(value*k); }
}`,
`package com.arcrobotics.ftclib.geometry;
public class Translation2d {
  private double x; private double y;
  public Translation2d(){ this(0,0); } public Translation2d(double x, double y){ this.x=x; this.y=y; }
  public double getX(){ return x; } public double getY(){ return y; } public double getNorm(){ return Math.hypot(x,y); }
  public Translation2d plus(Translation2d o){ return new Translation2d(x+o.x, y+o.y); } public Translation2d minus(Translation2d o){ return new Translation2d(x-o.x, y-o.y); }
  public Translation2d rotateBy(Rotation2d r){ return new Translation2d(x*r.getCos()-y*r.getSin(), x*r.getSin()+y*r.getCos()); }
  public Translation2d times(double k){ return new Translation2d(x*k, y*k); }
}`,
`package com.arcrobotics.ftclib.geometry;
public class Pose2d {
  private Translation2d t; private Rotation2d r;
  public Pose2d(){ this(0,0,new Rotation2d()); }
  public Pose2d(Translation2d t, Rotation2d r){ this.t=t; this.r=r; }
  public Pose2d(double x, double y, Rotation2d r){ this(new Translation2d(x,y), r); }
  public double getX(){ return t.getX(); } public double getY(){ return t.getY(); } public double getHeading(){ return r.getRadians(); }
  public Translation2d getTranslation(){ return t; } public Rotation2d getRotation(){ return r; }
}`,
`package com.arcrobotics.ftclib.controller;
public class PIDFController {
  private double kP, kI, kD, kF;
  private double setPoint, measuredValue;
  private double minIntegral = -1.0, maxIntegral = 1.0;
  private double errorVal_p, errorVal_v, totalError, prevErrorVal;
  private double errorTolerance_p = 0.05, errorTolerance_v = Double.POSITIVE_INFINITY;
  private double lastTimeStamp, period;
  public PIDFController(double kp, double ki, double kd, double kf){ this(kp, ki, kd, kf, 0, 0); }
  public PIDFController(double kp, double ki, double kd, double kf, double sp, double pv){ kP=kp; kI=ki; kD=kd; kF=kf; setPoint=sp; measuredValue=pv; lastTimeStamp=0; period=0; errorVal_p=setPoint-measuredValue; reset(); }
  public void reset(){ totalError=0; prevErrorVal=0; lastTimeStamp=0; }
  public void setTolerance(double p){ setTolerance(p, Double.POSITIVE_INFINITY); }
  public void setTolerance(double p, double v){ errorTolerance_p=p; errorTolerance_v=v; }
  public double getSetPoint(){ return setPoint; }
  public void setSetPoint(double sp){ setPoint=sp; errorVal_p=setPoint-measuredValue; errorVal_v=(errorVal_p-prevErrorVal)/(period==0?1:period); }
  public boolean atSetPoint(){ return Math.abs(errorVal_p) < errorTolerance_p && Math.abs(errorVal_v) < errorTolerance_v; }
  public double[] getCoefficients(){ return new double[]{kP, kI, kD, kF}; }
  public double getPositionError(){ return errorVal_p; }
  public double[] getTolerance(){ return new double[]{errorTolerance_p, errorTolerance_v}; }
  public double getVelocityError(){ return errorVal_v; }
  public double calculate(){ return calculate(measuredValue); }
  public double calculate(double pv, double sp){ setSetPoint(sp); return calculate(pv); }
  public double calculate(double pv){
    prevErrorVal = errorVal_p;
    double now = (double) System.nanoTime() / 1E9;
    if (lastTimeStamp == 0) lastTimeStamp = now;
    period = now - lastTimeStamp;
    lastTimeStamp = now;
    if (measuredValue == pv) errorVal_p = setPoint - measuredValue;
    else { errorVal_p = setPoint - pv; measuredValue = pv; }
    if (Math.abs(period) > 1E-6) errorVal_v = (errorVal_p - prevErrorVal) / period; else errorVal_v = 0;
    totalError += period * (setPoint - measuredValue);
    totalError = totalError < minIntegral ? minIntegral : Math.min(maxIntegral, totalError);
    return kP * errorVal_p + kI * totalError + kD * errorVal_v + kF * setPoint;
  }
  public void setPIDF(double kp, double ki, double kd, double kf){ kP=kp; kI=ki; kD=kd; kF=kf; }
  public void setIntegrationBounds(double lo, double hi){ minIntegral=lo; maxIntegral=hi; }
  public void clearTotalError(){ totalError=0; }
  public void setP(double kp){ kP=kp; } public void setI(double ki){ kI=ki; } public void setD(double kd){ kD=kd; } public void setF(double kf){ kF=kf; }
  public double getP(){ return kP; } public double getI(){ return kI; } public double getD(){ return kD; } public double getF(){ return kF; }
  public double getPeriod(){ return period; }
}`,
`package com.arcrobotics.ftclib.controller;
public class PIDController extends PIDFController {
  public PIDController(double kp, double ki, double kd){ super(kp, ki, kd, 0); }
  public PIDController(double kp, double ki, double kd, double sp, double pv){ super(kp, ki, kd, 0, sp, pv); }
  public void setPID(double kp, double ki, double kd){ setPIDF(kp, ki, kd, 0); }
}`,
`package com.arcrobotics.ftclib.controller;
public class PController extends PIDController { public PController(double kp){ super(kp, 0, 0); } public PController(double kp, double sp, double pv){ super(kp, 0, 0, sp, pv); } }`,
`package com.arcrobotics.ftclib.controller;
public class PDController extends PIDController { public PDController(double kp, double kd){ super(kp, 0, kd); } public PDController(double kp, double kd, double sp, double pv){ super(kp, 0, kd, sp, pv); } }`,
`package com.arcrobotics.ftclib.controller.wpilibcontroller;
public class ArmFeedforward {
  public final double ks, kcos, kv, ka;
  public ArmFeedforward(double ks, double kcos, double kv, double ka){ this.ks=ks; this.kcos=kcos; this.kv=kv; this.ka=ka; }
  public ArmFeedforward(double ks, double kcos, double kv){ this(ks, kcos, kv, 0); }
  public double calculate(double pos, double vel, double acc){ return ks*Math.signum(vel) + kcos*Math.cos(pos) + kv*vel + ka*acc; }
  public double calculate(double pos, double vel){ return calculate(pos, vel, 0); }
}`,
`package com.arcrobotics.ftclib.controller.wpilibcontroller;
public class ElevatorFeedforward {
  public final double ks, kg, kv, ka;
  public ElevatorFeedforward(double ks, double kg, double kv, double ka){ this.ks=ks; this.kg=kg; this.kv=kv; this.ka=ka; }
  public ElevatorFeedforward(double ks, double kg, double kv){ this(ks, kg, kv, 0); }
  public double calculate(double vel, double acc){ return ks*Math.signum(vel) + kg + kv*vel + ka*acc; }
  public double calculate(double vel){ return calculate(vel, 0); }
}`,
`package com.arcrobotics.ftclib.controller.wpilibcontroller;
public class SimpleMotorFeedforward {
  public final double ks, kv, ka;
  public SimpleMotorFeedforward(double ks, double kv, double ka){ this.ks=ks; this.kv=kv; this.ka=ka; }
  public SimpleMotorFeedforward(double ks, double kv){ this(ks, kv, 0); }
  public double calculate(double vel, double acc){ return ks*Math.signum(vel) + kv*vel + ka*acc; }
  public double calculate(double vel){ return calculate(vel, 0); }
}`,
`package com.arcrobotics.ftclib.hardware;
public interface HardwareDevice { void disable(); String getDeviceType(); }`,
`package com.arcrobotics.ftclib.hardware.motors;
import com.qualcomm.robotcore.hardware.*;
import com.arcrobotics.ftclib.controller.*;
import com.arcrobotics.ftclib.controller.wpilibcontroller.SimpleMotorFeedforward;
import java.util.function.Supplier;
public class Motor implements com.arcrobotics.ftclib.hardware.HardwareDevice {
  public enum GoBILDA { RPM_30(5281.1, 30), RPM_43(3895.9, 43), RPM_60(2786.2, 60), RPM_84(1993.6, 84), RPM_117(1425.1, 117), RPM_223(751.8, 223),
    RPM_312(537.7, 312), RPM_435(384.5, 435), RPM_1150(145.1, 1150), RPM_1620(103.8, 1620), BARE(28, 6000), NONE(0, 0);
    private double cpr, rpm;
    GoBILDA(double cpr, double rpm){ this.cpr=cpr; this.rpm=rpm; }
    public double getCPR(){ return cpr; } public double getRPM(){ return rpm; }
    public double getAchievableMaxTicksPerSecond(){ return cpr * rpm / 60; } }
  public enum Direction { FORWARD(1), REVERSE(-1); private int val; Direction(int v){ val=v; } public int getMultiplier(){ return val; } }
  public enum ZeroPowerBehavior { UNKNOWN, BRAKE, FLOAT; public DcMotor.ZeroPowerBehavior getBehavior(){ return this==BRAKE ? DcMotor.ZeroPowerBehavior.BRAKE : DcMotor.ZeroPowerBehavior.FLOAT; } }
  public enum RunMode { VelocityControl, PositionControl, RawPower }
  public class Encoder {
    private Supplier<Integer> m_position; private int resetVal; private Direction direction; private double dpp = 1;
    public Encoder(Supplier<Integer> position){ m_position=position; resetVal=0; direction=Direction.FORWARD; }
    public int getPosition(){ return direction.getMultiplier() * m_position.get() - resetVal; }
    public double getDistance(){ return dpp * getPosition(); }
    public double getRate(){ return dpp * getCorrectedVelocity(); }
    public void reset(){ resetVal += getPosition(); }
    public Encoder setDistancePerPulse(double d){ dpp=d; return this; }
    public void setDirection(Direction d){ direction=d; }
    public double getRevolutions(){ return getPosition() / getCPR(); }
    public double getRawVelocity(){ return direction.getMultiplier() * ((DcMotorEx) motor).getVelocity(); }
    public double getCorrectedVelocity(){ return getRawVelocity(); }
  }
  public DcMotor motor; public Encoder encoder;
  protected RunMode runmode; protected GoBILDA type;
  protected PIDController veloController = new PIDController(1, 0, 0);
  protected PController positionController = new PController(1);
  protected SimpleMotorFeedforward feedforward = new SimpleMotorFeedforward(0, 1, 0);
  private boolean targetIsSet = false;
  protected double bufferFraction = 0.9;
  protected double cpr = 0, rpm = 0;
  public Motor(){}
  public Motor(HardwareMap hMap, String id){ this(hMap, id, GoBILDA.NONE); }
  public Motor(HardwareMap hMap, String id, GoBILDA gobildaType){
    motor = hMap.get(DcMotor.class, id); runmode = RunMode.RawPower; type = gobildaType; cpr = gobildaType.getCPR(); rpm = gobildaType.getRPM();
    encoder = new Encoder(motor::getCurrentPosition); }
  public Motor(HardwareMap hMap, String id, double cpr, double rpm){ this(hMap, id, GoBILDA.NONE); this.cpr=cpr; this.rpm=rpm; }
  public double ACHIEVABLE_MAX_TICKS_PER_SECOND(){ return cpr > 0 ? cpr * rpm / 60 : ((DcMotorEx) motor).getMotorType().getAchieveableMaxTicksPerSecond(); }
  public void set(double output){
    if (runmode == RunMode.VelocityControl) { motor.setPower(output); }
    else if (runmode == RunMode.PositionControl) { double error = positionController.calculate(getDistance()); motor.setPower(output * error); }
    else motor.setPower(output);
  }
  public double get(){ return motor.getPower(); }
  public void setBuffer(double f){ bufferFraction=f; }
  public void setTargetPosition(int target){ setTargetDistance(target * encoder.dpp); }
  public void setTargetDistance(double target){ targetIsSet = true; positionController.setSetPoint(target); }
  public void setPositionTolerance(double t){ positionController.setTolerance(t); }
  public boolean atTargetPosition(){ return positionController.atSetPoint(); }
  public void setPositionCoefficient(double kp){ positionController.setP(kp); }
  public double getPositionCoefficient(){ return positionController.getP(); }
  public void setVeloCoefficients(double kp, double ki, double kd){ veloController.setPIDF(kp, ki, kd, 0); }
  public void setFeedforwardCoefficients(double ks, double kv){ feedforward = new SimpleMotorFeedforward(ks, kv); }
  public void setFeedforwardCoefficients(double ks, double kv, double ka){ feedforward = new SimpleMotorFeedforward(ks, kv, ka); }
  public double[] getVeloCoefficients(){ return veloController.getCoefficients(); }
  public double[] getFeedforwardCoefficients(){ return new double[]{feedforward.ks, feedforward.kv}; }
  public void setRunMode(RunMode r){ runmode = r; veloController.reset(); positionController.reset(); if (r == RunMode.PositionControl && !targetIsSet) { setTargetPosition(getCurrentPosition()); targetIsSet = false; } }
  public void setZeroPowerBehavior(ZeroPowerBehavior b){ motor.setZeroPowerBehavior(b.getBehavior()); }
  public void setInverted(boolean inv){ motor.setDirection(inv ? DcMotor.Direction.REVERSE : DcMotor.Direction.FORWARD); }
  public boolean getInverted(){ return motor.getDirection() == DcMotor.Direction.REVERSE; }
  public Motor setDistancePerPulse(double d){ encoder.setDistancePerPulse(d); return this; }
  public double getDistance(){ return encoder.getDistance(); }
  public double getRate(){ return encoder.getRate(); }
  public int getCurrentPosition(){ return encoder.getPosition(); }
  public double getVelocity(){ return ((DcMotorEx) motor).getVelocity(); }
  public double getCorrectedVelocity(){ return getVelocity(); }
  public void resetEncoder(){ encoder.reset(); }
  public void stopAndResetEncoder(){ motor.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER); }
  public double getCPR(){ return cpr > 0 ? cpr : ((DcMotorEx) motor).getMotorType().getTicksPerRev(); }
  public double getMaxRPM(){ return rpm > 0 ? rpm : ((DcMotorEx) motor).getMotorType().getMaxRPM(); }
  public void stopMotor(){ motor.setPower(0); }
  public void disable(){ motor.close(); }
  public String getDeviceType(){ return "Motor"; }
}`,
`package com.arcrobotics.ftclib.hardware.motors;
import com.qualcomm.robotcore.hardware.*;
public class MotorEx extends Motor {
  public DcMotorEx motorEx;
  public MotorEx(HardwareMap hMap, String id){ this(hMap, id, GoBILDA.NONE); }
  public MotorEx(HardwareMap hMap, String id, GoBILDA type){ super(hMap, id, type); motorEx = (DcMotorEx) motor; }
  public MotorEx(HardwareMap hMap, String id, double cpr, double rpm){ super(hMap, id, cpr, rpm); motorEx = (DcMotorEx) motor; }
  public void setVelocity(double v){ motorEx.setVelocity(v); }
  public void setVelocity(double v, org.firstinspires.ftc.robotcore.external.navigation.AngleUnit u){ motorEx.setVelocity(v, u); }
  public double getVelocity(){ return motorEx.getVelocity(); }
  public double getAcceleration(){ return 0; }
  public void setTargetPositionTolerance(int t){ setPositionTolerance(t); }
  public DcMotorEx getMotor(){ return motorEx; }
}`,
`package com.arcrobotics.ftclib.hardware.motors;
import java.util.*;
public class MotorGroup extends Motor implements Iterable<Motor> {
  private final Motor[] group;
  public MotorGroup(Motor leader, Motor... followers){ group = new Motor[followers.length + 1]; group[0]=leader; for (int i=0;i<followers.length;i++) group[i+1]=followers[i]; motor = leader.motor; encoder = leader.encoder; }
  public void set(double speed){ for (Motor m : group) m.set(speed); }
  public double get(){ return group[0].get(); }
  public List<Double> getSpeeds(){ ArrayList<Double> s = new ArrayList<>(); for (Motor m : group) s.add(m.get()); return s; }
  public Iterator<Motor> iterator(){ return Arrays.asList(group).iterator(); }
  public void setRunMode(RunMode r){ for (Motor m : group) m.setRunMode(r); }
  public void setZeroPowerBehavior(ZeroPowerBehavior b){ for (Motor m : group) m.setZeroPowerBehavior(b); }
  public void resetEncoder(){ group[0].resetEncoder(); }
  public void stopMotor(){ for (Motor m : group) m.stopMotor(); }
  public void setInverted(boolean inv){ for (Motor m : group) m.setInverted(inv); }
  public int getCurrentPosition(){ return group[0].getCurrentPosition(); }
  public double getDistance(){ return group[0].getDistance(); }
  public double getVelocity(){ return group[0].getVelocity(); }
  public void setPositionCoefficient(double kp){ for (Motor m : group) m.setPositionCoefficient(kp); }
  public void setTargetPosition(int t){ for (Motor m : group) m.setTargetPosition(t); }
  public boolean atTargetPosition(){ return group[0].atTargetPosition(); }
  public void setPositionTolerance(double t){ for (Motor m : group) m.setPositionTolerance(t); }
  public Motor setDistancePerPulse(double d){ for (Motor m : group) m.setDistancePerPulse(d); return this; }
}`,
`package com.arcrobotics.ftclib.hardware.motors;
import com.qualcomm.robotcore.hardware.*;
public class CRServo implements com.arcrobotics.ftclib.hardware.HardwareDevice {
  protected com.qualcomm.robotcore.hardware.CRServo crServo;
  public CRServo(HardwareMap hMap, String id){ crServo = hMap.get(com.qualcomm.robotcore.hardware.CRServo.class, id); }
  public void set(double output){ crServo.setPower(output); }
  public double get(){ return crServo.getPower(); }
  public void setInverted(boolean inv){ crServo.setDirection(inv ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD); }
  public boolean getInverted(){ return crServo.getDirection() == DcMotorSimple.Direction.REVERSE; }
  public void stop(){ set(0); } public void stopMotor(){ set(0); }
  public void disable(){} public String getDeviceType(){ return "CRServo"; }
  public void setRunMode(Object m){}
}`,
`package com.arcrobotics.ftclib.hardware;
public interface ServoEx extends HardwareDevice {}`,
`package com.arcrobotics.ftclib.hardware;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
public class SimpleServo implements ServoEx {
  private Servo servo; private double maxAngle, minAngle; private final double maxPos = 1, minPos = 0;
  public SimpleServo(HardwareMap hw, String name, double minAngle, double maxAngle, AngleUnit u){ servo = hw.get(Servo.class, name); this.minAngle = toRad(minAngle, u); this.maxAngle = toRad(maxAngle, u); }
  public SimpleServo(HardwareMap hw, String name, double minDegree, double maxDegree){ this(hw, name, minDegree, maxDegree, AngleUnit.DEGREES); }
  private static double toRad(double v, AngleUnit u){ return u == AngleUnit.DEGREES ? Math.toRadians(v) : v; }
  public void rotateByAngle(double angle, AngleUnit u){ turnToAngle(getAngle(u) + angle, u); }
  public void rotateByAngle(double degrees){ rotateByAngle(degrees, AngleUnit.DEGREES); }
  public void turnToAngle(double angle, AngleUnit u){ double a = toRad(angle, u); a = Math.max(minAngle, Math.min(maxAngle, a)); setPosition((a - minAngle) / (maxAngle - minAngle)); }
  public void turnToAngle(double degrees){ turnToAngle(degrees, AngleUnit.DEGREES); }
  public void rotateBy(double p){ setPosition(getPosition() + p); }
  public void setPosition(double p){ servo.setPosition(Math.max(minPos, Math.min(maxPos, p))); }
  public void setRange(double min, double max, AngleUnit u){ minAngle = toRad(min, u); maxAngle = toRad(max, u); }
  public void setRange(double min, double max){ setRange(min, max, AngleUnit.DEGREES); }
  public void setInverted(boolean inv){ servo.setDirection(inv ? Servo.Direction.REVERSE : Servo.Direction.FORWARD); }
  public boolean getInverted(){ return servo.getDirection() == Servo.Direction.REVERSE; }
  public double getPosition(){ return servo.getPosition(); }
  public double getAngle(AngleUnit u){ double a = getPosition() * (maxAngle - minAngle) + minAngle; return u == AngleUnit.DEGREES ? Math.toDegrees(a) : a; }
  public double getAngle(){ return getAngle(AngleUnit.DEGREES); }
  public double getAngleRange(AngleUnit u){ double r = maxAngle - minAngle; return u == AngleUnit.DEGREES ? Math.toDegrees(r) : r; }
  public double getAngleRange(){ return getAngleRange(AngleUnit.DEGREES); }
  public void disable(){} public String getDeviceType(){ return "SimpleServo"; }
}`,
`package com.arcrobotics.ftclib.hardware;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.hardware.bosch.BNO055IMU;
import com.arcrobotics.ftclib.geometry.Rotation2d;
public class RevIMU {
  private BNO055IMU revIMU; private double offset = 0; private int multiplier = 1;
  public RevIMU(HardwareMap hw, String name){ revIMU = hw.get(BNO055IMU.class, name); }
  public RevIMU(HardwareMap hw){ this(hw, "imu"); }
  public void init(){ BNO055IMU.Parameters p = new BNO055IMU.Parameters(); p.angleUnit = BNO055IMU.AngleUnit.DEGREES; init(p); }
  public void init(BNO055IMU.Parameters p){ revIMU.initialize(p); }
  public void invertGyro(){ multiplier *= -1; }
  public double getHeading(){ return getAbsoluteHeading() - offset; }
  public double getAbsoluteHeading(){ return revIMU.getAngularOrientation().firstAngle * multiplier; }
  public double[] getAngles(){ return new double[]{ getAbsoluteHeading(), 0, 0 }; }
  public Rotation2d getRotation2d(){ return Rotation2d.fromDegrees(getHeading()); }
  public void reset(){ offset += getHeading(); }
  public void disable(){} public String getDeviceType(){ return "IMU"; }
  public BNO055IMU getRevIMU(){ return revIMU; }
}`,
`package com.arcrobotics.ftclib.drivebase;
public abstract class RobotDrive {
  protected double maxOutput = 1; protected double rightSideMultiplier = 1;
  public enum MotorType { kFrontLeft(0), kFrontRight(1), kBackLeft(2), kBackRight(3), kLeft(0), kRight(1), kBack(2); public final int value; MotorType(int v){ value=v; } }
  public void setMaxSpeed(double m){ maxOutput = m; }
  public double clipRange(double v){ return v <= -1 ? -1 : v >= 1 ? 1 : v; }
  protected void normalize(double[] ws, double magnitude){ double max = 0; for (double w : ws) max = Math.max(max, Math.abs(w)); for (int i = 0; i < ws.length; i++) ws[i] = max == 0 ? 0 : ws[i] / max * magnitude; }
  protected void normalize(double[] ws){ double max = 0; for (double w : ws) max = Math.max(max, Math.abs(w)); if (max > 1) for (int i = 0; i < ws.length; i++) ws[i] /= max; }
  protected double squareInput(double v){ return v * Math.abs(v); }
  public abstract void stop();
  public void setRange(double min, double max){}
}`,
`package com.arcrobotics.ftclib.drivebase;
import com.arcrobotics.ftclib.hardware.motors.Motor;
import com.arcrobotics.ftclib.geometry.Vector2d;
public class MecanumDrive extends RobotDrive {
  Motor[] motors;
  public MecanumDrive(Motor frontLeft, Motor frontRight, Motor backLeft, Motor backRight){ this(true, frontLeft, frontRight, backLeft, backRight); }
  public MecanumDrive(boolean autoInvert, Motor frontLeft, Motor frontRight, Motor backLeft, Motor backRight){ motors = new Motor[]{frontLeft, frontRight, backLeft, backRight}; setRightSideInverted(autoInvert); }
  public boolean isRightSideInverted(){ return rightSideMultiplier == -1.0; }
  public void setRightSideInverted(boolean inv){ rightSideMultiplier = inv ? -1.0 : 1.0; }
  public void setMaxSpeed(double v){ super.setMaxSpeed(v); }
  public void stop(){ for (Motor m : motors) m.stopMotor(); }
  public void driveRobotCentric(double strafeSpeed, double forwardSpeed, double turnSpeed){ driveFieldCentric(strafeSpeed, forwardSpeed, turnSpeed, 0.0); }
  public void driveRobotCentric(double strafeSpeed, double forwardSpeed, double turnSpeed, boolean square){
    if (square) { strafeSpeed = squareInput(strafeSpeed); forwardSpeed = squareInput(forwardSpeed); turnSpeed = squareInput(turnSpeed); }
    driveRobotCentric(strafeSpeed, forwardSpeed, turnSpeed); }
  public void driveFieldCentric(double strafeSpeed, double forwardSpeed, double turnSpeed, double gyroAngle, boolean square){
    if (square) { strafeSpeed = squareInput(strafeSpeed); forwardSpeed = squareInput(forwardSpeed); turnSpeed = squareInput(turnSpeed); }
    driveFieldCentric(strafeSpeed, forwardSpeed, turnSpeed, gyroAngle); }
  public void driveFieldCentric(double strafeSpeed, double forwardSpeed, double turnSpeed, double gyroAngle){
    strafeSpeed = clipRange(strafeSpeed); forwardSpeed = clipRange(forwardSpeed); turnSpeed = clipRange(turnSpeed);
    Vector2d input = new Vector2d(strafeSpeed, forwardSpeed);
    input = input.rotateBy(-gyroAngle);
    double theta = input.angle();
    double[] ws = new double[4];
    ws[0] = Math.sin(theta + Math.PI / 4);
    ws[1] = Math.sin(theta - Math.PI / 4);
    ws[2] = Math.sin(theta - Math.PI / 4);
    ws[3] = Math.sin(theta + Math.PI / 4);
    normalize(ws, input.magnitude());
    ws[0] += turnSpeed; ws[1] -= turnSpeed; ws[2] += turnSpeed; ws[3] -= turnSpeed;
    normalize(ws);
    motors[0].set(ws[0] * maxOutput);
    motors[1].set(ws[1] * rightSideMultiplier * maxOutput);
    motors[2].set(ws[2] * maxOutput);
    motors[3].set(ws[3] * rightSideMultiplier * maxOutput);
  }
  public void driveWithMotorPowers(double fl, double fr, double bl, double br){ motors[0].set(fl); motors[1].set(fr * rightSideMultiplier); motors[2].set(bl); motors[3].set(br * rightSideMultiplier); }
}`,
`package com.arcrobotics.ftclib.drivebase;
import com.arcrobotics.ftclib.hardware.motors.Motor;
public class DifferentialDrive extends RobotDrive {
  private Motor[] motors;
  public DifferentialDrive(Motor... myMotors){ motors = myMotors; setRightSideInverted(true); }
  public DifferentialDrive(boolean autoInvert, Motor... myMotors){ motors = myMotors; setRightSideInverted(autoInvert); }
  public void setRightSideInverted(boolean inv){ rightSideMultiplier = inv ? -1.0 : 1.0; }
  public void stop(){ for (Motor m : motors) m.stopMotor(); }
  public void arcadeDrive(double forward, double turn){ arcadeDrive(forward, turn, false); }
  public void arcadeDrive(double forward, double turn, boolean square){
    forward = clipRange(forward); turn = clipRange(turn);
    if (square) { forward = squareInput(forward); turn = squareInput(turn); }
    double[] ws = { forward + turn, forward - turn };
    normalize(ws);
    motors[0].set(ws[0] * maxOutput);
    motors[1].set(ws[1] * rightSideMultiplier * maxOutput);
  }
  public void tankDrive(double l, double r){ tankDrive(l, r, false); }
  public void tankDrive(double l, double r, boolean square){ l = clipRange(l); r = clipRange(r); if (square) { l = squareInput(l); r = squareInput(r); }
    motors[0].set(l * maxOutput); motors[1].set(r * rightSideMultiplier * maxOutput); }
}`,
`package com.arcrobotics.ftclib.gamepad;
public class GamepadKeys {
  public enum Button { Y, X, A, B, LEFT_BUMPER, RIGHT_BUMPER, BACK, START, DPAD_UP, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, LEFT_STICK_BUTTON, RIGHT_STICK_BUTTON,
    CROSS, CIRCLE, SQUARE, TRIANGLE, SHARE, OPTIONS, PS, TOUCHPAD }
  public enum Trigger { LEFT_TRIGGER, RIGHT_TRIGGER }
}`,
`package com.arcrobotics.ftclib.gamepad;
import java.util.function.BooleanSupplier;
public class ButtonReader implements KeyReader {
  private boolean lastState; private boolean currState; private final BooleanSupplier buttonState;
  public ButtonReader(GamepadEx gamepad, GamepadKeys.Button button){ this(() -> gamepad.getButton(button)); }
  public ButtonReader(BooleanSupplier buttonValue){ buttonState = buttonValue; currState = buttonState.getAsBoolean(); lastState = currState; }
  public boolean isDown(){ return buttonState.getAsBoolean(); }
  public boolean wasJustPressed(){ return !lastState && currState; }
  public boolean wasJustReleased(){ return lastState && !currState; }
  public void readValue(){ lastState = currState; currState = buttonState.getAsBoolean(); }
  public boolean stateJustChanged(){ return lastState != currState; }
}`,
`package com.arcrobotics.ftclib.gamepad;
public interface KeyReader { void readValue(); boolean isDown(); boolean wasJustPressed(); boolean wasJustReleased(); boolean stateJustChanged(); }`,
`package com.arcrobotics.ftclib.gamepad;
public class ToggleButtonReader extends ButtonReader {
  private boolean currToggleState = false;
  public ToggleButtonReader(GamepadEx gamepad, GamepadKeys.Button button){ super(gamepad, button); }
  public ToggleButtonReader(java.util.function.BooleanSupplier v){ super(v); }
  public boolean getState(){ if (wasJustReleased()) currToggleState = !currToggleState; return currToggleState; }
}`,
`package com.arcrobotics.ftclib.gamepad;
public class TriggerReader implements KeyReader {
  private GamepadEx gamepad; private GamepadKeys.Trigger trigger; private boolean lastState, currState;
  public TriggerReader(GamepadEx gamepad, GamepadKeys.Trigger trigger){ this.gamepad=gamepad; this.trigger=trigger; currState = gamepad.getTrigger(trigger) > 0.5; lastState = currState; }
  public boolean isDown(){ return gamepad.getTrigger(trigger) > 0.5; }
  public boolean wasJustPressed(){ return !lastState && currState; }
  public boolean wasJustReleased(){ return lastState && !currState; }
  public void readValue(){ lastState = currState; currState = gamepad.getTrigger(trigger) > 0.5; }
  public boolean stateJustChanged(){ return lastState != currState; }
}`,
`package com.arcrobotics.ftclib.gamepad;
import com.qualcomm.robotcore.hardware.Gamepad;
import com.arcrobotics.ftclib.command.button.GamepadButton;
import java.util.HashMap;
public class GamepadEx {
  public Gamepad gamepad;
  private HashMap<GamepadKeys.Button, ButtonReader> buttonReaders = new HashMap<>();
  private HashMap<GamepadKeys.Button, GamepadButton> gamepadButtons = new HashMap<>();
  public GamepadEx(Gamepad gamepad){ this.gamepad = gamepad;
    for (GamepadKeys.Button b : GamepadKeys.Button.values()) { buttonReaders.put(b, new ButtonReader(this, b)); gamepadButtons.put(b, new GamepadButton(this, b)); } }
  public boolean getButton(GamepadKeys.Button button){
    switch (button) {
      case Y: case TRIANGLE: return gamepad.y;
      case X: case SQUARE: return gamepad.x;
      case A: case CROSS: return gamepad.a;
      case B: case CIRCLE: return gamepad.b;
      case LEFT_BUMPER: return gamepad.left_bumper;
      case RIGHT_BUMPER: return gamepad.right_bumper;
      case BACK: case SHARE: return gamepad.back;
      case START: case OPTIONS: return gamepad.start;
      case DPAD_UP: return gamepad.dpad_up;
      case DPAD_DOWN: return gamepad.dpad_down;
      case DPAD_LEFT: return gamepad.dpad_left;
      case DPAD_RIGHT: return gamepad.dpad_right;
      case LEFT_STICK_BUTTON: return gamepad.left_stick_button;
      case RIGHT_STICK_BUTTON: return gamepad.right_stick_button;
      case PS: return gamepad.guide;
      case TOUCHPAD: return gamepad.touchpad;
      default: return false;
    }
  }
  public double getTrigger(GamepadKeys.Trigger t){ return t == GamepadKeys.Trigger.LEFT_TRIGGER ? gamepad.left_trigger : gamepad.right_trigger; }
  public double getLeftY(){ return -gamepad.left_stick_y; }
  public double getRightY(){ return -gamepad.right_stick_y; }
  public double getLeftX(){ return gamepad.left_stick_x; }
  public double getRightX(){ return gamepad.right_stick_x; }
  public boolean wasJustPressed(GamepadKeys.Button b){ return buttonReaders.get(b).wasJustPressed(); }
  public boolean wasJustReleased(GamepadKeys.Button b){ return buttonReaders.get(b).wasJustReleased(); }
  public void readButtons(){ for (GamepadKeys.Button b : buttonReaders.keySet()) buttonReaders.get(b).readValue(); }
  public boolean isDown(GamepadKeys.Button b){ return buttonReaders.get(b).isDown(); }
  public boolean stateJustChanged(GamepadKeys.Button b){ return buttonReaders.get(b).stateJustChanged(); }
  public GamepadButton getGamepadButton(GamepadKeys.Button b){ return gamepadButtons.get(b); }
  public void rumble(int ms){ gamepad.rumble(ms); }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.*;
public interface Subsystem {
  default void periodic(){}
  default void setDefaultCommand(Command c){ CommandScheduler.getInstance().setDefaultCommand(this, c); }
  default Command getDefaultCommand(){ return CommandScheduler.getInstance().getDefaultCommand(this); }
  default Command getCurrentCommand(){ return CommandScheduler.getInstance().requiring(this); }
  default void register(){ CommandScheduler.getInstance().registerSubsystem(this); }
}`,
`package com.arcrobotics.ftclib.command;
public abstract class SubsystemBase implements Subsystem {
  protected String m_name = getClass().getSimpleName();
  public SubsystemBase(){ CommandScheduler.getInstance().registerSubsystem(this); }
  public String getName(){ return m_name; } public void setName(String n){ m_name = n; }
  public String getSubsystem(){ return getName(); }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.*;
import java.util.function.BooleanSupplier;
public interface Command {
  default void initialize(){}
  default void execute(){}
  default void end(boolean interrupted){}
  default boolean isFinished(){ return false; }
  Set<Subsystem> getRequirements();
  default void schedule(){ CommandScheduler.getInstance().schedule(this); }
  default void schedule(boolean interruptible){ CommandScheduler.getInstance().schedule(interruptible, this); }
  default void cancel(){ CommandScheduler.getInstance().cancel(this); }
  default boolean isScheduled(){ return CommandScheduler.getInstance().isScheduled(this); }
  default boolean hasRequirement(Subsystem s){ return getRequirements().contains(s); }
  default boolean runsWhenDisabled(){ return false; }
  default String getName(){ return getClass().getSimpleName(); }
  default ParallelRaceGroup withTimeout(long ms){ return new ParallelRaceGroup(this, new WaitCommand(ms)); }
  default ParallelRaceGroup interruptOn(BooleanSupplier c){ return new ParallelRaceGroup(this, new WaitUntilCommand(c)); }
  default SequentialCommandGroup whenFinished(Runnable r){ return new SequentialCommandGroup(this, new InstantCommand(r)); }
  default SequentialCommandGroup beforeStarting(Runnable r){ return new SequentialCommandGroup(new InstantCommand(r), this); }
  default SequentialCommandGroup beforeStarting(Command c){ return new SequentialCommandGroup(c, this); }
  default SequentialCommandGroup andThen(Object... next){
    SequentialCommandGroup g = new SequentialCommandGroup(this);
    for (Object o : next) g.addCommands(o instanceof Command ? (Command) o : new InstantCommand((Runnable) o));
    return g; }
  default ParallelDeadlineGroup deadlineWith(Command... p){ return new ParallelDeadlineGroup(this, p); }
  default ParallelCommandGroup alongWith(Command... p){ ParallelCommandGroup g = new ParallelCommandGroup(this); g.addCommands(p); return g; }
  default ParallelRaceGroup raceWith(Command... p){ ParallelRaceGroup g = new ParallelRaceGroup(this); g.addCommands(p); return g; }
  default PerpetualCommand perpetually(){ return new PerpetualCommand(this); }
  default Command asProxy(){ return new ProxyScheduleCommand(this); }
  default Command withName(String n){ return this; }
  default Command repeatedly(){ return new RepeatCommand(this); }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.*;
public abstract class CommandBase implements Command {
  protected Set<Subsystem> m_requirements = new HashSet<>();
  protected String m_name = getClass().getSimpleName();
  public final void addRequirements(Subsystem... requirements){ for (Subsystem s : requirements) if (s != null) m_requirements.add(s); }
  public Set<Subsystem> getRequirements(){ return m_requirements; }
  public String getName(){ return m_name; } public void setName(String n){ m_name = n; }
  public String getSubsystem(){ return m_name; }
}`,
`package com.arcrobotics.ftclib.command;
public abstract class CommandGroupBase extends CommandBase {
  public abstract void addCommands(Command... commands);
  public static CommandGroupBase sequence(Command... c){ return new SequentialCommandGroup(c); }
  public static CommandGroupBase parallel(Command... c){ return new ParallelCommandGroup(c); }
  public static CommandGroupBase race(Command... c){ return new ParallelRaceGroup(c); }
  public static CommandGroupBase deadline(Command d, Command... c){ return new ParallelDeadlineGroup(d, c); }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.*;
public class SequentialCommandGroup extends CommandGroupBase {
  private final List<Command> m_commands = new ArrayList<>();
  private int m_currentCommandIndex = -1;
  public SequentialCommandGroup(Command... commands){ addCommands(commands); }
  public final void addCommands(Command... commands){ for (Command c : commands) { if (c == null) continue; m_commands.add(c); m_requirements.addAll(c.getRequirements()); } }
  public void initialize(){ m_currentCommandIndex = 0; if (!m_commands.isEmpty()) m_commands.get(0).initialize(); }
  public void execute(){
    if (m_commands.isEmpty()) return;
    Command c = m_commands.get(m_currentCommandIndex);
    c.execute();
    if (c.isFinished()) { c.end(false); m_currentCommandIndex++; if (m_currentCommandIndex < m_commands.size()) m_commands.get(m_currentCommandIndex).initialize(); }
  }
  public void end(boolean interrupted){ if (interrupted && !m_commands.isEmpty() && m_currentCommandIndex > -1 && m_currentCommandIndex < m_commands.size()) m_commands.get(m_currentCommandIndex).end(true); m_currentCommandIndex = -1; }
  public boolean isFinished(){ return m_currentCommandIndex == m_commands.size(); }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.*;
public class ParallelCommandGroup extends CommandGroupBase {
  private final List<Command> m_commands = new ArrayList<>(); private final List<Boolean> m_running = new ArrayList<>();
  public ParallelCommandGroup(Command... commands){ addCommands(commands); }
  public final void addCommands(Command... commands){ for (Command c : commands) { if (c == null) continue; m_commands.add(c); m_running.add(false); m_requirements.addAll(c.getRequirements()); } }
  public void initialize(){ for (int i = 0; i < m_commands.size(); i++) { m_commands.get(i).initialize(); m_running.set(i, true); } }
  public void execute(){ for (int i = 0; i < m_commands.size(); i++) { if (!m_running.get(i)) continue; Command c = m_commands.get(i); c.execute(); if (c.isFinished()) { c.end(false); m_running.set(i, false); } } }
  public void end(boolean interrupted){ if (interrupted) for (int i = 0; i < m_commands.size(); i++) if (m_running.get(i)) m_commands.get(i).end(true); }
  public boolean isFinished(){ return !m_running.contains(true); }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.*;
public class ParallelRaceGroup extends CommandGroupBase {
  private final List<Command> m_commands = new ArrayList<>(); private boolean m_finished = true;
  public ParallelRaceGroup(Command... commands){ addCommands(commands); }
  public final void addCommands(Command... commands){ for (Command c : commands) { if (c == null) continue; m_commands.add(c); m_requirements.addAll(c.getRequirements()); } }
  public void initialize(){ m_finished = false; for (Command c : m_commands) c.initialize(); }
  public void execute(){ for (Command c : m_commands) { c.execute(); if (c.isFinished()) m_finished = true; } }
  public void end(boolean interrupted){ for (Command c : m_commands) c.end(!c.isFinished()); }
  public boolean isFinished(){ return m_finished; }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.*;
public class ParallelDeadlineGroup extends CommandGroupBase {
  private final List<Command> m_commands = new ArrayList<>(); private final List<Boolean> m_running = new ArrayList<>(); private Command m_deadline; private boolean m_finished = true;
  public ParallelDeadlineGroup(Command deadline, Command... commands){ m_deadline = deadline; addCommands(deadline); addCommands(commands); }
  public final void addCommands(Command... commands){ for (Command c : commands) { if (c == null) continue; m_commands.add(c); m_running.add(false); m_requirements.addAll(c.getRequirements()); } }
  public void initialize(){ m_finished = false; for (int i = 0; i < m_commands.size(); i++) { m_commands.get(i).initialize(); m_running.set(i, true); } }
  public void execute(){ for (int i = 0; i < m_commands.size(); i++) { if (!m_running.get(i)) continue; Command c = m_commands.get(i); c.execute(); if (c.isFinished()) { c.end(false); m_running.set(i, false); if (c == m_deadline) m_finished = true; } } }
  public void end(boolean interrupted){ for (int i = 0; i < m_commands.size(); i++) if (m_running.get(i)) m_commands.get(i).end(true); }
  public boolean isFinished(){ return m_finished; }
}`,
`package com.arcrobotics.ftclib.command;
public class InstantCommand extends CommandBase {
  private final Runnable m_toRun;
  public InstantCommand(Runnable toRun, Subsystem... requirements){ m_toRun = toRun; addRequirements(requirements); }
  public InstantCommand(){ m_toRun = () -> {}; }
  public void initialize(){ m_toRun.run(); }
  public final boolean isFinished(){ return true; }
}`,
`package com.arcrobotics.ftclib.command;
public class RunCommand extends CommandBase {
  protected final Runnable m_toRun;
  public RunCommand(Runnable toRun, Subsystem... requirements){ m_toRun = toRun; addRequirements(requirements); }
  public void execute(){ m_toRun.run(); }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.function.*;
public class FunctionalCommand extends CommandBase {
  protected final Runnable m_onInit; protected final Runnable m_onExecute; protected final Consumer<Boolean> m_onEnd; protected final BooleanSupplier m_isFinished;
  public FunctionalCommand(Runnable onInit, Runnable onExecute, Consumer<Boolean> onEnd, BooleanSupplier isFinished, Subsystem... requirements){
    m_onInit = onInit; m_onExecute = onExecute; m_onEnd = onEnd; m_isFinished = isFinished; addRequirements(requirements); }
  public void initialize(){ m_onInit.run(); }
  public void execute(){ m_onExecute.run(); }
  public void end(boolean interrupted){ m_onEnd.accept(interrupted); }
  public boolean isFinished(){ return m_isFinished.getAsBoolean(); }
}`,
`package com.arcrobotics.ftclib.command;
public class StartEndCommand extends CommandBase {
  protected final Runnable m_onInit; protected final Runnable m_onEnd;
  public StartEndCommand(Runnable onInit, Runnable onEnd, Subsystem... requirements){ m_onInit = onInit; m_onEnd = onEnd; addRequirements(requirements); }
  public void initialize(){ m_onInit.run(); }
  public void end(boolean interrupted){ m_onEnd.run(); }
}`,
`package com.arcrobotics.ftclib.command;
import com.qualcomm.robotcore.util.ElapsedTime;
public class WaitCommand extends CommandBase {
  protected ElapsedTime m_timer; private final long m_duration;
  public WaitCommand(long millis){ m_duration = millis; m_timer = new ElapsedTime(); }
  public void initialize(){ m_timer.reset(); }
  public boolean isFinished(){ return m_timer.milliseconds() >= m_duration; }
  public boolean runsWhenDisabled(){ return true; }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.function.BooleanSupplier;
public class WaitUntilCommand extends CommandBase {
  private final BooleanSupplier m_condition;
  public WaitUntilCommand(BooleanSupplier condition){ m_condition = condition; }
  public boolean isFinished(){ return m_condition.getAsBoolean(); }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.function.BooleanSupplier;
public class ConditionalCommand extends CommandBase {
  private final Command m_onTrue; private final Command m_onFalse; private final BooleanSupplier m_condition; private Command m_selected;
  public ConditionalCommand(Command onTrue, Command onFalse, BooleanSupplier condition){ m_onTrue = onTrue; m_onFalse = onFalse; m_condition = condition;
    m_requirements.addAll(onTrue.getRequirements()); m_requirements.addAll(onFalse.getRequirements()); }
  public void initialize(){ m_selected = m_condition.getAsBoolean() ? m_onTrue : m_onFalse; m_selected.initialize(); }
  public void execute(){ m_selected.execute(); }
  public void end(boolean interrupted){ m_selected.end(interrupted); }
  public boolean isFinished(){ return m_selected.isFinished(); }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.*;
import java.util.function.Supplier;
public class SelectCommand extends CommandBase {
  private final Map<Object, Command> m_commands; private final Supplier<Object> m_selector; private final Supplier<Command> m_toRun; private Command m_selected;
  public SelectCommand(Map<Object, Command> commands, Supplier<Object> selector){ m_commands = commands; m_selector = selector; m_toRun = null;
    for (Command c : commands.values()) m_requirements.addAll(c.getRequirements()); }
  public SelectCommand(Supplier<Command> toRun){ m_commands = null; m_selector = null; m_toRun = toRun; }
  public void initialize(){
    if (m_selector != null) { Object k = m_selector.get(); m_selected = m_commands.containsKey(k) ? m_commands.get(k) : new InstantCommand(); }
    else m_selected = m_toRun.get();
    m_selected.initialize(); }
  public void execute(){ m_selected.execute(); }
  public void end(boolean interrupted){ m_selected.end(interrupted); }
  public boolean isFinished(){ return m_selected.isFinished(); }
}`,
`package com.arcrobotics.ftclib.command;
public class PerpetualCommand extends CommandBase {
  protected final Command m_command;
  public PerpetualCommand(Command command){ m_command = command; m_requirements.addAll(command.getRequirements()); }
  public void initialize(){ m_command.initialize(); }
  public void execute(){ m_command.execute(); }
  public void end(boolean interrupted){ m_command.end(interrupted); }
}`,
`package com.arcrobotics.ftclib.command;
public class RepeatCommand extends CommandBase {
  protected final Command m_command;
  public RepeatCommand(Command command){ m_command = command; m_requirements.addAll(command.getRequirements()); }
  public void initialize(){ m_command.initialize(); }
  public void execute(){ m_command.execute(); if (m_command.isFinished()) { m_command.end(false); m_command.initialize(); } }
  public void end(boolean interrupted){ m_command.end(interrupted); }
}`,
`package com.arcrobotics.ftclib.command;
public class ScheduleCommand extends CommandBase {
  private final Command[] m_toSchedule;
  public ScheduleCommand(Command... toSchedule){ m_toSchedule = toSchedule; }
  public void initialize(){ for (Command c : m_toSchedule) c.schedule(); }
  public boolean isFinished(){ return true; }
}`,
`package com.arcrobotics.ftclib.command;
public class ProxyScheduleCommand extends CommandBase {
  private final Command[] m_toSchedule; private boolean m_finished;
  public ProxyScheduleCommand(Command... toSchedule){ m_toSchedule = toSchedule; }
  public void initialize(){ for (Command c : m_toSchedule) c.schedule(); }
  public void end(boolean interrupted){ if (interrupted) for (Command c : m_toSchedule) c.cancel(); }
  public void execute(){ m_finished = true; for (Command c : m_toSchedule) m_finished &= !c.isScheduled(); }
  public boolean isFinished(){ return m_finished; }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.function.Supplier;
public class DeferredCommand extends CommandBase {
  private final Supplier<Command> m_supplier; private Command m_command;
  public DeferredCommand(Supplier<Command> supplier, java.util.Set<Subsystem> requirements){ m_supplier = supplier; if (requirements != null) m_requirements.addAll(requirements); }
  public DeferredCommand(Supplier<Command> supplier){ m_supplier = supplier; }
  public void initialize(){ m_command = m_supplier.get(); if (m_command == null) m_command = new InstantCommand(); m_command.initialize(); }
  public void execute(){ m_command.execute(); }
  public void end(boolean interrupted){ m_command.end(interrupted); }
  public boolean isFinished(){ return m_command.isFinished(); }
}`,
`package com.arcrobotics.ftclib.command;
import java.util.*;
public final class CommandScheduler {
  private static CommandScheduler instance;
  public static synchronized CommandScheduler getInstance(){ if (instance == null) instance = new CommandScheduler(); return instance; }
  private final ArrayList<Command> scheduled = new ArrayList<>();
  private final HashMap<Subsystem, Command> requirements = new HashMap<>();
  private final HashMap<Subsystem, Command> defaults = new HashMap<>();
  private final ArrayList<Subsystem> subsystems = new ArrayList<>();
  private final ArrayList<Runnable> buttons = new ArrayList<>();
  private boolean disabled = false;
  public void schedule(Command... commands){ for (Command c : commands) scheduleOne(c, true); }
  public void schedule(boolean interruptible, Command... commands){ for (Command c : commands) scheduleOne(c, interruptible); }
  private void scheduleOne(Command c, boolean interruptible){
    if (c == null || disabled || scheduled.contains(c)) return;
    for (Subsystem s : c.getRequirements()) { Command other = requirements.get(s); if (other != null && other != c) cancel(other); }
    c.initialize();
    scheduled.add(c);
    for (Subsystem s : c.getRequirements()) requirements.put(s, c);
  }
  public void run(){
    if (disabled) return;
    for (Subsystem s : new ArrayList<>(subsystems)) s.periodic();
    for (Runnable b : new ArrayList<>(buttons)) b.run();
    for (Command c : new ArrayList<>(scheduled)) {
      if (!scheduled.contains(c)) continue;
      c.execute();
      if (c.isFinished()) { c.end(false); remove(c); }
    }
    for (Subsystem s : subsystems) { Command d = defaults.get(s); if (d != null && requirements.get(s) == null) scheduleOne(d, true); }
  }
  private void remove(Command c){ scheduled.remove(c); for (Subsystem s : c.getRequirements()) if (requirements.get(s) == c) requirements.remove(s); }
  public void cancel(Command... cs){ for (Command c : cs) { if (!scheduled.contains(c)) continue; c.end(true); remove(c); } }
  public void cancelAll(){ for (Command c : new ArrayList<>(scheduled)) cancel(c); }
  public boolean isScheduled(Command... cs){ for (Command c : cs) if (!scheduled.contains(c)) return false; return true; }
  public Command requiring(Subsystem s){ return requirements.get(s); }
  public void registerSubsystem(Subsystem... ss){ for (Subsystem s : ss) if (!subsystems.contains(s)) subsystems.add(s); }
  public void unregisterSubsystem(Subsystem... ss){ for (Subsystem s : ss) subsystems.remove(s); }
  public void setDefaultCommand(Subsystem s, Command c){ registerSubsystem(s); defaults.put(s, c); }
  public Command getDefaultCommand(Subsystem s){ return defaults.get(s); }
  public void addButton(Runnable r){ buttons.add(r); }
  public void clearButtons(){ buttons.clear(); }
  public void reset(){ cancelAll(); subsystems.clear(); defaults.clear(); buttons.clear(); }
  public void disable(){ disabled = true; } public void enable(){ disabled = false; }
  public void onCommandInitialize(Object a){} public void onCommandExecute(Object a){} public void onCommandFinish(Object a){} public void onCommandInterrupt(Object a){}
}`,
`package com.arcrobotics.ftclib.command;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
public abstract class CommandOpMode extends LinearOpMode {
  public void reset(){ CommandScheduler.getInstance().reset(); }
  public void run(){ CommandScheduler.getInstance().run(); }
  public void schedule(Command... commands){ CommandScheduler.getInstance().schedule(commands); }
  public void register(Subsystem... subsystems){ CommandScheduler.getInstance().registerSubsystem(subsystems); }
  public void runOpMode() throws InterruptedException {
    initialize();
    waitForStart();
    while (!isStopRequested() && opModeIsActive()) { run(); }
    reset();
  }
  public abstract void initialize();
  public static void disable(){ CommandScheduler.getInstance().disable(); }
  public static void enable(){ CommandScheduler.getInstance().enable(); }
}`,
`package com.arcrobotics.ftclib.command.button;
import com.arcrobotics.ftclib.command.*;
import java.util.function.BooleanSupplier;
public class Trigger {
  private final BooleanSupplier m_isActive;
  public Trigger(BooleanSupplier isActive){ m_isActive = isActive; }
  public Trigger(){ m_isActive = () -> false; }
  public boolean get(){ return m_isActive.getAsBoolean(); }
  public Trigger whenActive(final Command command, boolean interruptible){
    final boolean[] last = { get() };
    CommandScheduler.getInstance().addButton(() -> { boolean p = get(); if (!last[0] && p) command.schedule(interruptible); last[0] = p; });
    return this; }
  public Trigger whenActive(final Command command){ return whenActive(command, true); }
  public Trigger whenActive(final Runnable toRun){ return whenActive(new InstantCommand(toRun)); }
  public Trigger whileActiveContinuous(final Command command, boolean interruptible){
    final boolean[] last = { get() };
    CommandScheduler.getInstance().addButton(() -> { boolean p = get(); if (p) command.schedule(interruptible); else if (last[0]) command.cancel(); last[0] = p; });
    return this; }
  public Trigger whileActiveContinuous(final Command command){ return whileActiveContinuous(command, true); }
  public Trigger whileActiveContinuous(final Runnable toRun){ return whileActiveContinuous(new InstantCommand(toRun)); }
  public Trigger whileActiveOnce(final Command command, boolean interruptible){
    final boolean[] last = { get() };
    CommandScheduler.getInstance().addButton(() -> { boolean p = get(); if (!last[0] && p) command.schedule(interruptible); else if (last[0] && !p) command.cancel(); last[0] = p; });
    return this; }
  public Trigger whileActiveOnce(final Command command){ return whileActiveOnce(command, true); }
  public Trigger whenInactive(final Command command, boolean interruptible){
    final boolean[] last = { get() };
    CommandScheduler.getInstance().addButton(() -> { boolean p = get(); if (last[0] && !p) command.schedule(interruptible); last[0] = p; });
    return this; }
  public Trigger whenInactive(final Command command){ return whenInactive(command, true); }
  public Trigger whenInactive(final Runnable toRun){ return whenInactive(new InstantCommand(toRun)); }
  public Trigger toggleWhenActive(final Command command, boolean interruptible){
    final boolean[] last = { get() };
    CommandScheduler.getInstance().addButton(() -> { boolean p = get(); if (!last[0] && p) { if (command.isScheduled()) command.cancel(); else command.schedule(interruptible); } last[0] = p; });
    return this; }
  public Trigger toggleWhenActive(final Command command){ return toggleWhenActive(command, true); }
  public Trigger toggleWhenActive(final Command c1, final Command c2){
    final boolean[] last = { get() }; final boolean[] first = { true };
    CommandScheduler.getInstance().addButton(() -> { boolean p = get(); if (!last[0] && p) { if (first[0]) { c2.cancel(); c1.schedule(); } else { c1.cancel(); c2.schedule(); } first[0] = !first[0]; } last[0] = p; });
    return this; }
  public Trigger cancelWhenActive(final Command command){
    final boolean[] last = { get() };
    CommandScheduler.getInstance().addButton(() -> { boolean p = get(); if (!last[0] && p) command.cancel(); last[0] = p; });
    return this; }
  public Trigger and(Trigger other){ return new Trigger(() -> get() && other.get()); }
  public Trigger or(Trigger other){ return new Trigger(() -> get() || other.get()); }
  public Trigger negate(){ return new Trigger(() -> !get()); }
}`,
`package com.arcrobotics.ftclib.command.button;
import com.arcrobotics.ftclib.command.*;
public abstract class Button extends Trigger {
  public Button(){ super(); }
  public Button(java.util.function.BooleanSupplier s){ super(s); }
  public Button whenPressed(final Command command, boolean interruptible){ whenActive(command, interruptible); return this; }
  public Button whenPressed(final Command command){ whenActive(command); return this; }
  public Button whenPressed(final Runnable toRun){ whenActive(toRun); return this; }
  public Button whileHeld(final Command command, boolean interruptible){ whileActiveContinuous(command, interruptible); return this; }
  public Button whileHeld(final Command command){ whileActiveContinuous(command); return this; }
  public Button whileHeld(final Runnable toRun){ whileActiveContinuous(toRun); return this; }
  public Button whenHeld(final Command command, boolean interruptible){ whileActiveOnce(command, interruptible); return this; }
  public Button whenHeld(final Command command){ whileActiveOnce(command); return this; }
  public Button whenReleased(final Command command, boolean interruptible){ whenInactive(command, interruptible); return this; }
  public Button whenReleased(final Command command){ whenInactive(command); return this; }
  public Button whenReleased(final Runnable toRun){ whenInactive(toRun); return this; }
  public Button toggleWhenPressed(final Command command, boolean interruptible){ toggleWhenActive(command, interruptible); return this; }
  public Button toggleWhenPressed(final Command command){ toggleWhenActive(command); return this; }
  public Button toggleWhenPressed(final Command c1, final Command c2){ toggleWhenActive(c1, c2); return this; }
  public Button cancelWhenPressed(final Command command){ cancelWhenActive(command); return this; }
}`,
`package com.arcrobotics.ftclib.command.button;
import com.arcrobotics.ftclib.gamepad.*;
public class GamepadButton extends Button {
  private final GamepadEx m_gamepad; private final GamepadKeys.Button[] m_buttons;
  public GamepadButton(GamepadEx gamepad, GamepadKeys.Button... buttons){ m_gamepad = gamepad; m_buttons = buttons; }
  public boolean get(){ boolean res = true; for (GamepadKeys.Button b : m_buttons) res = res && m_gamepad.getButton(b); return res; }
}`,
/* ---- Road Runner 1.0 core types ---- */
`package com.acmerobotics.roadrunner;
public final class Vector2d {
  public final double x; public final double y;
  public Vector2d(double x, double y){ this.x=x; this.y=y; }
  public Vector2d plus(Vector2d o){ return new Vector2d(x+o.x, y+o.y); }
  public Vector2d minus(Vector2d o){ return new Vector2d(x-o.x, y-o.y); }
  public Vector2d unaryMinus(){ return new Vector2d(-x, -y); }
  public Vector2d times(double k){ return new Vector2d(x*k, y*k); }
  public Vector2d div(double k){ return new Vector2d(x/k, y/k); }
  public double dot(Vector2d o){ return x*o.x + y*o.y; }
  public double sqrNorm(){ return x*x + y*y; }
  public double norm(){ return Math.sqrt(sqrNorm()); }
  public Rotation2d angleCast(){ return Rotation2d.fromDouble(Math.atan2(y, x)); }
  public double getX(){ return x; } public double getY(){ return y; }
}`,
`package com.acmerobotics.roadrunner;
public final class Rotation2d {
  public final double real; public final double imag;
  public Rotation2d(double real, double imag){ this.real=real; this.imag=imag; }
  public static Rotation2d exp(double theta){ return new Rotation2d(Math.cos(theta), Math.sin(theta)); }
  public static Rotation2d fromDouble(double theta){ return exp(theta); }
  public Rotation2d plus(double d){ return times(exp(d)); }
  public double minus(Rotation2d r){ return r.inverse().times(this).log(); }
  public Vector2d times(Vector2d v){ return new Vector2d(real*v.x - imag*v.y, imag*v.x + real*v.y); }
  public Rotation2d times(Rotation2d r){ return new Rotation2d(real*r.real - imag*r.imag, real*r.imag + imag*r.real); }
  public PoseVelocity2d times(PoseVelocity2d p){ return new PoseVelocity2d(times(p.linearVel), p.angVel); }
  public Rotation2d inverse(){ return new Rotation2d(real, -imag); }
  public double log(){ return Math.atan2(imag, real); }
  public double toDouble(){ return log(); }
  public Vector2d vec(){ return new Vector2d(real, imag); }
}`,
`package com.acmerobotics.roadrunner;
public final class Pose2d {
  public final Vector2d position; public final Rotation2d heading;
  public Pose2d(Vector2d position, Rotation2d heading){ this.position=position; this.heading=heading; }
  public Pose2d(Vector2d position, double heading){ this(position, Rotation2d.exp(heading)); }
  public Pose2d(double x, double y, double heading){ this(new Vector2d(x, y), Rotation2d.exp(heading)); }
  public Pose2d times(Pose2d p){ return new Pose2d(heading.times(p.position).plus(position), heading.times(p.heading)); }
  public Vector2d times(Vector2d v){ return heading.times(v).plus(position); }
  public Pose2d inverse(){ Rotation2d inv = heading.inverse(); return new Pose2d(inv.times(position).unaryMinus(), inv); }
  public Pose2d plus(Twist2d t){ return times(Pose2d.exp(t)); }
  public static Pose2d exp(Twist2d t){ if (t == null || t.line == null) return new Pose2d(0, 0, 0); Rotation2d h = Rotation2d.exp(t.angle); double u = t.angle + Math.signum(t.angle)*1e-9; double c = 1 - Math.cos(u), s = Math.sin(u);
    return new Pose2d(new Vector2d((s*t.line.x - c*t.line.y)/u, (c*t.line.x + s*t.line.y)/u), h); }
}`,
`package com.acmerobotics.roadrunner;
public final class Twist2d { public final Vector2d line; public final double angle; public Twist2d(Vector2d line, double angle){ this.line=line; this.angle=angle; } }`,
`package com.acmerobotics.roadrunner;
public final class PoseVelocity2d {
  public final Vector2d linearVel; public final double angVel;
  public PoseVelocity2d(Vector2d linearVel, double angVel){ this.linearVel=linearVel; this.angVel=angVel; }
  public PoseVelocity2d minus(PoseVelocity2d o){ return new PoseVelocity2d(linearVel.minus(o.linearVel), angVel - o.angVel); }
}`,
`package com.acmerobotics.roadrunner;
public final class DualNum<T> {
  final double[] values;
  public DualNum(double[] values){ this.values = values; }
  public static DualNum constant(double c, int n){ double[] v = new double[n]; v[0] = c; return new DualNum(v); }
  public double value(){ return values[0]; }
  public double get(int i){ return values[i]; }
  public int size(){ return values.length; }
  public DualNum plus(DualNum o){ double[] v = new double[values.length]; for (int i=0;i<v.length;i++) v[i]=values[i]+o.values[i]; return new DualNum(v); }
  public DualNum minus(DualNum o){ double[] v = new double[values.length]; for (int i=0;i<v.length;i++) v[i]=values[i]-o.values[i]; return new DualNum(v); }
  public DualNum times(double k){ double[] v = new double[values.length]; for (int i=0;i<v.length;i++) v[i]=values[i]*k; return new DualNum(v); }
  public DualNum div(double k){ return times(1.0/k); }
  public DualNum unaryMinus(){ return times(-1); }
}`,
`package com.acmerobotics.roadrunner;
public final class PoseVelocity2dDual<T> {
  public final Vector2dDual<T> linearVel; public final DualNum<T> angVel;
  public PoseVelocity2dDual(Vector2dDual<T> linearVel, DualNum<T> angVel){ this.linearVel=linearVel; this.angVel=angVel; }
  public static PoseVelocity2dDual constant(PoseVelocity2d p, int n){ return new PoseVelocity2dDual(new Vector2dDual(DualNum.constant(p.linearVel.x, n), DualNum.constant(p.linearVel.y, n)), DualNum.constant(p.angVel, n)); }
  public PoseVelocity2d value(){ return new PoseVelocity2d(new Vector2d(linearVel.x.value(), linearVel.y.value()), angVel.value()); }
}`,
`package com.acmerobotics.roadrunner;
public final class Vector2dDual<T> { public final DualNum<T> x; public final DualNum<T> y; public Vector2dDual(DualNum<T> x, DualNum<T> y){ this.x=x; this.y=y; } public Vector2d value(){ return new Vector2d(x.value(), y.value()); } }`,
`package com.acmerobotics.roadrunner;
public final class Time {}`,
`package com.acmerobotics.roadrunner;
public final class Arclength {}`,
`package com.acmerobotics.roadrunner;
import java.util.*;
public final class MecanumKinematics {
  public final double trackWidth; public final double lateralMultiplier;
  public MecanumKinematics(double trackWidth, double lateralMultiplier){ this.trackWidth=trackWidth; this.lateralMultiplier=lateralMultiplier; }
  public MecanumKinematics(double trackWidth){ this(trackWidth, 1.0); }
  public MecanumKinematics(double trackWidth, double wheelbase, double lateralMultiplier){ this((trackWidth + wheelbase) / 2, lateralMultiplier); }
  public final class WheelVelocities<T> {
    public final DualNum<T> leftFront; public final DualNum<T> leftBack; public final DualNum<T> rightBack; public final DualNum<T> rightFront;
    public WheelVelocities(DualNum<T> lf, DualNum<T> lb, DualNum<T> rb, DualNum<T> rf){ leftFront=lf; leftBack=lb; rightBack=rb; rightFront=rf; }
    public List<DualNum<T>> all(){ return Arrays.asList(leftFront, leftBack, rightBack, rightFront); }
  }
  public WheelVelocities inverse(PoseVelocity2dDual t){
    DualNum x = t.linearVel.x, y = t.linearVel.y, w = t.angVel;
    return new WheelVelocities(
      x.minus(y.times(lateralMultiplier)).minus(w.times(trackWidth)),
      x.plus(y.times(lateralMultiplier)).minus(w.times(trackWidth)),
      x.minus(y.times(lateralMultiplier)).plus(w.times(trackWidth)),
      x.plus(y.times(lateralMultiplier)).plus(w.times(trackWidth)));
  }
}`,
`package com.acmerobotics.roadrunner;
import java.util.*;
public final class TankKinematics {
  public final double trackWidth;
  public TankKinematics(double trackWidth){ this.trackWidth=trackWidth; }
  public final class WheelVelocities<T> {
    public final DualNum<T> left; public final DualNum<T> right;
    public WheelVelocities(DualNum<T> l, DualNum<T> r){ left=l; right=r; }
    public List<DualNum<T>> all(){ return Arrays.asList(left, right); }
  }
  public WheelVelocities inverse(PoseVelocity2dDual t){ DualNum x = t.linearVel.x, w = t.angVel;
    return new WheelVelocities(x.minus(w.times(0.5 * trackWidth)), x.plus(w.times(0.5 * trackWidth))); }
}`,
`package com.acmerobotics.roadrunner;
public interface Action { boolean run(com.acmerobotics.dashboard.telemetry.TelemetryPacket p); default void preview(Object c){} }`,
`package com.acmerobotics.roadrunner;
public interface InstantFunction { void run(); }`,
`package com.acmerobotics.roadrunner;
public class InstantAction implements Action { private final InstantFunction f; public InstantAction(InstantFunction f){ this.f=f; } public boolean run(com.acmerobotics.dashboard.telemetry.TelemetryPacket p){ f.run(); return false; } }`,
`package com.acmerobotics.roadrunner;
public class SleepAction implements Action { private final double dt; private double beginTs = -1;
  public SleepAction(double dt){ this.dt=dt; }
  public boolean run(com.acmerobotics.dashboard.telemetry.TelemetryPacket p){ double t = simbench.Sim.now(); if (beginTs < 0) beginTs = t; return t - beginTs < dt; } }`,
`package com.acmerobotics.roadrunner;
import java.util.*;
public class SequentialAction implements Action { private List<Action> actions;
  public SequentialAction(List<Action> a){ actions = new ArrayList<>(a); }
  public SequentialAction(Action... a){ actions = new ArrayList<>(Arrays.asList(a)); }
  public boolean run(com.acmerobotics.dashboard.telemetry.TelemetryPacket p){ if (actions.isEmpty()) return false; if (actions.get(0).run(p)) return true; actions.remove(0); return run(p); } }`,
`package com.acmerobotics.roadrunner;
import java.util.*;
public class ParallelAction implements Action { private List<Action> actions;
  public ParallelAction(List<Action> a){ actions = new ArrayList<>(a); }
  public ParallelAction(Action... a){ actions = new ArrayList<>(Arrays.asList(a)); }
  public boolean run(com.acmerobotics.dashboard.telemetry.TelemetryPacket p){ ArrayList<Action> keep = new ArrayList<>(); for (Action a : actions) if (a.run(p)) keep.add(a); actions = keep; return !actions.isEmpty(); } }`,
`package com.acmerobotics.roadrunner;
import java.util.*;
public class RaceAction implements Action { private List<Action> actions;
  public RaceAction(Action... a){ actions = Arrays.asList(a); }
  public boolean run(com.acmerobotics.dashboard.telemetry.TelemetryPacket p){ boolean all = true; for (Action a : actions) all = a.run(p) && all; return all; } }`,
`package com.acmerobotics.roadrunner.ftc;
import com.acmerobotics.roadrunner.Action;
public final class Actions {
  public static void runBlocking(Action a){ com.acmerobotics.dashboard.telemetry.TelemetryPacket p = new com.acmerobotics.dashboard.telemetry.TelemetryPacket(); while (a.run(p)) simbench.Sim.tick(); }
}`,
`package com.acmerobotics.roadrunner.ftc;
import com.qualcomm.robotcore.hardware.*;
public class LazyImu {
  private IMU imu;
  public LazyImu(HardwareMap hw, String name, ImuOrientationOnRobot o){ imu = hw.get(IMU.class, name); imu.initialize(new IMU.Parameters(o)); }
  public IMU get(){ return imu; }
}`,
`package com.acmerobotics.dashboard.telemetry;
public class TelemetryPacket { public TelemetryPacket(){} public TelemetryPacket(boolean b){} public void put(String k, Object v){} public void addLine(String l){} public void clearLines(){}
  public com.acmerobotics.dashboard.canvas.Canvas fieldOverlay(){ return new com.acmerobotics.dashboard.canvas.Canvas(); } public void addTimestamp(){} }`,
/* ---- Road Runner 0.5 ---- */
`package com.acmerobotics.roadrunner.geometry;
public class Vector2d { private final double x; private final double y;
  public Vector2d(){ this(0,0); } public Vector2d(double x, double y){ this.x=x; this.y=y; }
  public double getX(){ return x; } public double getY(){ return y; } public double norm(){ return Math.hypot(x,y); } public double angle(){ return Math.atan2(y,x); }
  public Vector2d plus(Vector2d o){ return new Vector2d(x+o.x, y+o.y); } public Vector2d minus(Vector2d o){ return new Vector2d(x-o.x, y-o.y); }
  public Vector2d times(double k){ return new Vector2d(x*k, y*k); } public Vector2d div(double k){ return new Vector2d(x/k, y/k); } public Vector2d unaryMinus(){ return new Vector2d(-x,-y); }
  public double dot(Vector2d o){ return x*o.x+y*o.y; } public Vector2d rotated(double a){ double c=Math.cos(a), s=Math.sin(a); return new Vector2d(x*c-y*s, x*s+y*c); }
  public static Vector2d polar(double r, double t){ return new Vector2d(r*Math.cos(t), r*Math.sin(t)); } }`,
`package com.acmerobotics.roadrunner.geometry;
public class Pose2d { private final double x; private final double y; private final double heading;
  public Pose2d(){ this(0,0,0); } public Pose2d(double x, double y, double heading){ this.x=x; this.y=y; this.heading=heading; }
  public Pose2d(Vector2d pos, double heading){ this(pos.getX(), pos.getY(), heading); }
  public double getX(){ return x; } public double getY(){ return y; } public double getHeading(){ return heading; }
  public Vector2d vec(){ return new Vector2d(x,y); } public Vector2d headingVec(){ return new Vector2d(Math.cos(heading), Math.sin(heading)); }
  public Pose2d plus(Pose2d o){ return new Pose2d(x+o.x, y+o.y, heading+o.heading); } public Pose2d minus(Pose2d o){ return new Pose2d(x-o.x, y-o.y, heading-o.heading); }
  public Pose2d times(double k){ return new Pose2d(x*k, y*k, heading*k); } public Pose2d div(double k){ return new Pose2d(x/k, y/k, heading/k); } public Pose2d unaryMinus(){ return new Pose2d(-x,-y,-heading); }
  public Pose2d copy(double x, double y, double h){ return new Pose2d(x, y, h); } }`,
`package com.acmerobotics.roadrunner.kinematics;
import com.acmerobotics.roadrunner.geometry.Pose2d;
import java.util.*;
public class MecanumKinematics {
  public static List<Double> robotToWheelVelocities(Pose2d v, double trackWidth, double wheelBase, double lateralMultiplier){
    double k = (trackWidth + wheelBase) / 2.0;
    return Arrays.asList(v.getX() - lateralMultiplier * v.getY() - k * v.getHeading(), v.getX() + lateralMultiplier * v.getY() - k * v.getHeading(),
      v.getX() - lateralMultiplier * v.getY() + k * v.getHeading(), v.getX() + lateralMultiplier * v.getY() + k * v.getHeading()); }
  public static List<Double> robotToWheelVelocities(Pose2d v, double trackWidth){ return robotToWheelVelocities(v, trackWidth, trackWidth, 1.0); }
  public static List<Double> robotToWheelVelocities(Pose2d v, double trackWidth, double wheelBase){ return robotToWheelVelocities(v, trackWidth, wheelBase, 1.0); }
  public static List<Double> robotToWheelAccelerations(Pose2d a, double trackWidth, double wheelBase, double lateralMultiplier){ return robotToWheelVelocities(a, trackWidth, wheelBase, lateralMultiplier); }
  public static List<Double> robotToWheelAccelerations(Pose2d a, double trackWidth){ return robotToWheelVelocities(a, trackWidth); }
}`,
`package com.acmerobotics.roadrunner.kinematics;
import com.acmerobotics.roadrunner.geometry.Pose2d;
import java.util.*;
public class TankKinematics {
  public static List<Double> robotToWheelVelocities(Pose2d v, double trackWidth){ return Arrays.asList(v.getX() - trackWidth / 2 * v.getHeading(), v.getX() + trackWidth / 2 * v.getHeading()); }
  public static List<Double> robotToWheelAccelerations(Pose2d a, double trackWidth){ return robotToWheelVelocities(a, trackWidth); }
}`,
`package com.acmerobotics.roadrunner.kinematics;
import java.util.*;
public class Kinematics {
  public static List<Double> calculateMotorFeedforward(List<Double> vels, List<Double> accels, double kV, double kA, double kStatic){
    ArrayList<Double> out = new ArrayList<>(); for (int i = 0; i < vels.size(); i++) { double v = vels.get(i), a = accels.get(i); out.add(kV * v + kA * a + (Math.abs(v) > 1e-6 ? kStatic * Math.signum(v) : 0)); } return out; }
}`,
`package com.acmerobotics.roadrunner.drive;
import com.acmerobotics.roadrunner.geometry.Pose2d;
public class DriveSignal { private Pose2d vel; private Pose2d accel;
  public DriveSignal(){ this(new Pose2d(), new Pose2d()); } public DriveSignal(Pose2d v){ this(v, new Pose2d()); } public DriveSignal(Pose2d v, Pose2d a){ vel=v; accel=a; }
  public Pose2d getVel(){ return vel; } public Pose2d getAccel(){ return accel; } }`,
`package com.acmerobotics.roadrunner.drive;
import com.acmerobotics.roadrunner.geometry.Pose2d;
public abstract class Drive {
  protected Pose2d poseEstimate = new Pose2d(); protected Object localizer;
  public Pose2d getPoseEstimate(){ return poseEstimate; } public void setPoseEstimate(Pose2d p){ poseEstimate = p; }
  public Pose2d getPoseVelocity(){ return new Pose2d(); }
  public Object getLocalizer(){ return localizer; } public void setLocalizer(Object l){ localizer = l; }
  public void updatePoseEstimate(){}
  public double getExternalHeading(){ return getRawExternalHeading(); }
  public double getRawExternalHeading(){ return 0; }
  public Double getExternalHeadingVelocity(){ return 0.0; }
  public abstract void setDriveSignal(DriveSignal s);
  public abstract void setDrivePower(Pose2d p);
}`,
`package com.acmerobotics.roadrunner.drive;
import com.acmerobotics.roadrunner.geometry.Pose2d;
import com.acmerobotics.roadrunner.kinematics.*;
import java.util.*;
public abstract class MecanumDrive extends Drive {
  protected double kV, kA, kStatic, trackWidth, wheelBase, lateralMultiplier;
  public MecanumDrive(double kV, double kA, double kStatic, double trackWidth){ this(kV, kA, kStatic, trackWidth, trackWidth, 1.0); }
  public MecanumDrive(double kV, double kA, double kStatic, double trackWidth, double wheelBase){ this(kV, kA, kStatic, trackWidth, wheelBase, 1.0); }
  public MecanumDrive(double kV, double kA, double kStatic, double trackWidth, double wheelBase, double lateralMultiplier){
    this.kV=kV; this.kA=kA; this.kStatic=kStatic; this.trackWidth=trackWidth; this.wheelBase=wheelBase; this.lateralMultiplier=lateralMultiplier; }
  public void setDriveSignal(DriveSignal s){
    List<Double> v = MecanumKinematics.robotToWheelVelocities(s.getVel(), trackWidth, wheelBase, lateralMultiplier);
    List<Double> a = MecanumKinematics.robotToWheelAccelerations(s.getAccel(), trackWidth, wheelBase, lateralMultiplier);
    List<Double> p = Kinematics.calculateMotorFeedforward(v, a, kV, kA, kStatic);
    setMotorPowers(p.get(0), p.get(1), p.get(2), p.get(3)); }
  public void setDrivePower(Pose2d drivePower){
    List<Double> p = MecanumKinematics.robotToWheelVelocities(drivePower, 1.0, 1.0, lateralMultiplier);
    setMotorPowers(p.get(0), p.get(1), p.get(2), p.get(3)); }
  public abstract void setMotorPowers(double frontLeft, double rearLeft, double rearRight, double frontRight);
  public abstract List<Double> getWheelPositions();
  public List<Double> getWheelVelocities(){ return null; }
}`,
`package com.acmerobotics.roadrunner.drive;
import com.acmerobotics.roadrunner.geometry.Pose2d;
import com.acmerobotics.roadrunner.kinematics.*;
import java.util.*;
public abstract class TankDrive extends Drive {
  protected double kV, kA, kStatic, trackWidth;
  public TankDrive(double kV, double kA, double kStatic, double trackWidth){ this.kV=kV; this.kA=kA; this.kStatic=kStatic; this.trackWidth=trackWidth; }
  public void setDriveSignal(DriveSignal s){ List<Double> v = TankKinematics.robotToWheelVelocities(s.getVel(), trackWidth); setMotorPowers(kV * v.get(0), kV * v.get(1)); }
  public void setDrivePower(Pose2d p){ List<Double> v = TankKinematics.robotToWheelVelocities(p, 2.0); setMotorPowers(v.get(0), v.get(1)); }
  public abstract void setMotorPowers(double left, double right);
  public abstract List<Double> getWheelPositions();
}`,
`package com.acmerobotics.roadrunner.util;
public class Angle {
  public static double norm(double a){ double m = a % (2 * Math.PI); return m < 0 ? m + 2 * Math.PI : m; }
  public static double normDelta(double d){ double m = norm(d); return m > Math.PI ? m - 2 * Math.PI : m; }
}`,
`package com.acmerobotics.roadrunner.control;
public class PIDCoefficients { public double kP; public double kI; public double kD;
  public PIDCoefficients(){} public PIDCoefficients(double p, double i, double d){ kP=p; kI=i; kD=d; } }`,
/* ---- Pedro Pathing (1.x and 2.x) ---- */
`package com.pedropathing.geometry;
public class Pose {
  private double x, y, heading;
  public Pose(){ this(0,0,0); }
  public Pose(double x, double y){ this(x, y, 0); }
  public Pose(double x, double y, double heading){ this.x=x; this.y=y; this.heading=heading; }
  public Pose(double x, double y, double heading, Object coords){ this(x, y, heading); }
  public double getX(){ return x; } public double getY(){ return y; } public double getHeading(){ return heading; }
  public void setX(double v){ x=v; } public void setY(double v){ y=v; } public void setHeading(double v){ heading=v; }
  public Pose plus(Pose o){ return new Pose(x+o.x, y+o.y, heading+o.heading); }
  public Pose minus(Pose o){ return new Pose(x-o.x, y-o.y, heading-o.heading); }
  public Pose times(double k){ return new Pose(x*k, y*k, heading*k); }
  public Pose mirror(){ return new Pose(144 - x, y, Math.PI - heading); }
  public Pose mirror(double w){ return new Pose(w - x, y, Math.PI - heading); }
  public Pose withHeading(double h){ return new Pose(x, y, h); }
  public Pose copy(){ return new Pose(x, y, heading); }
  public double distanceFrom(Pose o){ return Math.hypot(x-o.x, y-o.y); }
  public Pose getPose(){ return this; }
}`,
`package com.pedropathing.localization;
public class Pose extends com.pedropathing.geometry.Pose {
  public Pose(){ super(); } public Pose(double x, double y){ super(x, y); } public Pose(double x, double y, double heading){ super(x, y, heading); }
}`,
`package com.pedropathing.math;
public class Vector {
  private double magnitude, theta;
  public Vector(){ this(0, 0); }
  public Vector(double magnitude, double theta){ this.magnitude = magnitude; this.theta = theta; }
  public double getMagnitude(){ return magnitude; } public double getTheta(){ return theta; }
  public double getXComponent(){ return magnitude * Math.cos(theta); } public double getYComponent(){ return magnitude * Math.sin(theta); }
  public void setMagnitude(double m){ magnitude = m; } public void setTheta(double t){ theta = t; }
  public void setOrthogonalComponents(double x, double y){ magnitude = Math.hypot(x, y); theta = Math.atan2(y, x); }
  public Vector plus(Vector o){ Vector v = new Vector(); v.setOrthogonalComponents(getXComponent() + o.getXComponent(), getYComponent() + o.getYComponent()); return v; }
  public Vector times(double k){ return new Vector(magnitude * k, theta); }
  public double dot(Vector o){ return getXComponent() * o.getXComponent() + getYComponent() * o.getYComponent(); }
}`,
`package com.pedropathing.follower;
public class FollowerConstants {
  public static String leftFrontMotorName = "leftFront"; public static String leftRearMotorName = "leftRear";
  public static String rightFrontMotorName = "rightFront"; public static String rightRearMotorName = "rightRear";
  public static com.qualcomm.robotcore.hardware.DcMotorSimple.Direction leftFrontMotorDirection = com.qualcomm.robotcore.hardware.DcMotorSimple.Direction.REVERSE;
  public static com.qualcomm.robotcore.hardware.DcMotorSimple.Direction leftRearMotorDirection = com.qualcomm.robotcore.hardware.DcMotorSimple.Direction.REVERSE;
  public static com.qualcomm.robotcore.hardware.DcMotorSimple.Direction rightFrontMotorDirection = com.qualcomm.robotcore.hardware.DcMotorSimple.Direction.FORWARD;
  public static com.qualcomm.robotcore.hardware.DcMotorSimple.Direction rightRearMotorDirection = com.qualcomm.robotcore.hardware.DcMotorSimple.Direction.FORWARD;
  public static double maxPower = 1;
  public static Object localizers; public static double mass;
  public FollowerConstants(){}
}`,
`package com.pedropathing.ftc.drivetrains;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
public class MecanumConstants {
  public String leftFrontMotorName = "leftFront", leftRearMotorName = "leftRear", rightFrontMotorName = "rightFront", rightRearMotorName = "rightRear";
  public DcMotorSimple.Direction leftFrontMotorDirection = DcMotorSimple.Direction.REVERSE, leftRearMotorDirection = DcMotorSimple.Direction.REVERSE,
    rightFrontMotorDirection = DcMotorSimple.Direction.FORWARD, rightRearMotorDirection = DcMotorSimple.Direction.FORWARD;
  public double maxPower = 1;
  public MecanumConstants(){}
  public MecanumConstants leftFrontMotorName(String n){ leftFrontMotorName = n; return this; }
  public MecanumConstants leftRearMotorName(String n){ leftRearMotorName = n; return this; }
  public MecanumConstants rightFrontMotorName(String n){ rightFrontMotorName = n; return this; }
  public MecanumConstants rightRearMotorName(String n){ rightRearMotorName = n; return this; }
  public MecanumConstants leftFrontMotorDirection(DcMotorSimple.Direction d){ leftFrontMotorDirection = d; return this; }
  public MecanumConstants leftRearMotorDirection(DcMotorSimple.Direction d){ leftRearMotorDirection = d; return this; }
  public MecanumConstants rightFrontMotorDirection(DcMotorSimple.Direction d){ rightFrontMotorDirection = d; return this; }
  public MecanumConstants rightRearMotorDirection(DcMotorSimple.Direction d){ rightRearMotorDirection = d; return this; }
  public MecanumConstants maxPower(double p){ maxPower = p; return this; }
  public MecanumConstants xVelocity(double v){ return this; } public MecanumConstants yVelocity(double v){ return this; }
  public MecanumConstants useBrakeModeInTeleOp(boolean b){ return this; } public MecanumConstants useVoltageCompensation(boolean b){ return this; }
  public MecanumConstants nominalVoltage(double v){ return this; } public MecanumConstants motorCachingThreshold(double v){ return this; }
}`,
`package com.pedropathing.follower;
import com.qualcomm.robotcore.hardware.*;
import com.pedropathing.ftc.drivetrains.MecanumConstants;
import com.pedropathing.geometry.Pose;
public class Follower {
  private DcMotorEx lf, lr, rf, rr;
  private double fwd, str, turn, offset, maxPower = 1;
  private boolean robotCentric = true, teleop = false;
  private Pose start = new Pose();
  private double headingZero;
  private boolean busy = false;
  public Follower(HardwareMap hw){ initStatics(hw); }
  public Follower(HardwareMap hw, Class<?> fConstants, Class<?> lConstants){ simbench.Pedro.load(fConstants, lConstants); initStatics(hw); }
  public Follower(HardwareMap hw, MecanumConstants c){ init(hw, c.leftFrontMotorName, c.leftRearMotorName, c.rightFrontMotorName, c.rightRearMotorName,
    c.leftFrontMotorDirection, c.leftRearMotorDirection, c.rightFrontMotorDirection, c.rightRearMotorDirection, c.maxPower); }
  private void initStatics(HardwareMap hw){ init(hw, FollowerConstants.leftFrontMotorName, FollowerConstants.leftRearMotorName, FollowerConstants.rightFrontMotorName, FollowerConstants.rightRearMotorName,
    FollowerConstants.leftFrontMotorDirection, FollowerConstants.leftRearMotorDirection, FollowerConstants.rightFrontMotorDirection, FollowerConstants.rightRearMotorDirection, FollowerConstants.maxPower); }
  private void init(HardwareMap hw, String lfn, String lrn, String rfn, String rrn, DcMotorSimple.Direction lfd, DcMotorSimple.Direction lrd, DcMotorSimple.Direction rfd, DcMotorSimple.Direction rrd, double maxPower){
    lf = hw.get(DcMotorEx.class, lfn); lr = hw.get(DcMotorEx.class, lrn); rf = hw.get(DcMotorEx.class, rfn); rr = hw.get(DcMotorEx.class, rrn);
    lf.setDirection(lfd); lr.setDirection(lrd); rf.setDirection(rfd); rr.setDirection(rrd);
    this.maxPower = maxPower; headingZero = simbench.Sim.heading(); }
  public void setStartingPose(Pose p){ start = p; headingZero = simbench.Sim.heading(); }
  public void setPose(Pose p){ setStartingPose(p); }
  public void setCurrentPoseWithOffset(Pose p){ setStartingPose(p); }
  public Pose getPose(){ return new Pose(start.getX(), start.getY(), start.getHeading() + simbench.Sim.heading() - headingZero); }
  public double getHeading(){ return getPose().getHeading(); }
  public double getTotalHeading(){ return getHeading(); }
  public void startTeleopDrive(){ teleop = true; }
  public void startTeleopDrive(boolean brake){ teleop = true; }
  public void startTeleOpDrive(){ teleop = true; }
  public void startTeleOpDrive(boolean brake){ teleop = true; }
  public void setTeleOpDrive(double forward, double strafe, double turn, boolean robotCentric){ setTeleOpDrive(forward, strafe, turn, robotCentric, 0); }
  public void setTeleOpDrive(double forward, double strafe, double turn){ setTeleOpDrive(forward, strafe, turn, true, 0); }
  public void setTeleOpDrive(double forward, double strafe, double turn, boolean robotCentric, double offsetHeading){ fwd = forward; str = strafe; this.turn = turn; this.robotCentric = robotCentric; offset = offsetHeading; teleop = true; }
  public void setTeleOpMovementVectors(double forward, double strafe, double heading){ setTeleOpDrive(forward, strafe, heading, true, 0); }
  public void setTeleOpMovementVectors(double forward, double strafe, double heading, boolean robotCentric){ setTeleOpDrive(forward, strafe, heading, robotCentric, 0); }
  public void setMaxPower(double p){ maxPower = p; }
  public void update(){
    if (!teleop) return;
    double f = fwd, s = str;
    if (!robotCentric) { double h = getHeading() - offset; double c = Math.cos(-h), sn = Math.sin(-h); double nf = f*c - s*sn; double ns = f*sn + s*c; f = nf; s = ns; }
    double a = f - s - turn, b = f + s - turn, c = f + s + turn, d = f - s + turn;
    double m = Math.max(Math.max(Math.abs(a), Math.abs(b)), Math.max(Math.abs(c), Math.abs(d)));
    double k = m > maxPower ? maxPower / m : 1;
    lf.setPower(a * k); lr.setPower(b * k); rf.setPower(c * k); rr.setPower(d * k);
  }
  public void followPath(Object path){ teleop = false; busy = false; }
  public void followPath(Object path, boolean hold){ followPath(path); }
  public void followPath(Object path, double maxPower, boolean hold){ followPath(path); }
  public boolean isBusy(){ return busy; }
  public void breakFollowing(){ teleop = false; lf.setPower(0); lr.setPower(0); rf.setPower(0); rr.setPower(0); }
  public void holdPoint(Object p){} public void turnTo(double r){} public void turnToDegrees(double d){}
  public Object pathBuilder(){ return null; }
  public Pose getClosestPose(){ return getPose(); }
  public com.pedropathing.math.Vector getVelocity(){ return new com.pedropathing.math.Vector(); }
  public com.pedropathing.math.Vector getAcceleration(){ return new com.pedropathing.math.Vector(); }
  public boolean atParametricEnd(){ return true; }
  public void deactivateAllPIDFs(){} public void activateAllPIDFs(){}
}`,
`package com.pedropathing.follower;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.pedropathing.ftc.drivetrains.MecanumConstants;
public class FollowerBuilder {
  private HardwareMap hw; private MecanumConstants drive = new MecanumConstants();
  public FollowerBuilder(Object constants, HardwareMap hw){ this.hw = hw; }
  public FollowerBuilder mecanumDrivetrain(MecanumConstants c){ drive = c; return this; }
  public Follower build(){ return new Follower(hw, drive); }
}`,
`package com.pedropathing.ftc;
public class FollowerBuilder extends com.pedropathing.follower.FollowerBuilder {
  public FollowerBuilder(Object constants, com.qualcomm.robotcore.hardware.HardwareMap hw){ super(constants, hw); }
}`,
];
/* Pedro 1.x reads its constants from the team's FConstants/LConstants static blocks */
const JV_PRELUDE_NATIVES={
  "simbench.Pedro":{s:{*load(vm,a){ for(const c of a) if(c&&c.__type) yield* vm.ready(c.__type); return null; }}},
};
/* Builders the Java above doesn't spell out: any other setter returns the builder itself */
const JV_BUILDERS=["com.pedropathing.ftc.drivetrains.MecanumConstants","com.pedropathing.follower.FollowerBuilder","com.pedropathing.follower.FollowerConstants","com.pedropathing.ftc.FollowerBuilder"];

let JV_PRELUDE_UNITS=null;
function jvPrelude(){
  if(JV_PRELUDE_UNITS) return JV_PRELUDE_UNITS;
  const out=[];
  const mark=t=>{ t.lib=true; for(const m of t.members) if(m.k==="type") mark(m.decl); };
  for(const s of JV_PRELUDE){
    const u=jvParse(s,"(library)");
    u.types.forEach(mark);
    out.push(u);
    // SolversLib is FTCLib under another name
    if(/^package com\.arcrobotics\.ftclib/.test(s)){
      const v=jvParse(s.replace(/com\.arcrobotics\.ftclib/g,"com.seattlesolvers.solverslib"),"(library)");
      v.types.forEach(mark); out.push(v);
    }
  }
  return (JV_PRELUDE_UNITS=out);
}
