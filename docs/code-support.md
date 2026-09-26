# What code runs

The bench runs a team's real `.java` files; nothing is re-coded for the simulator. The interpreter
reads the parts of Java that FTC OpModes use, and the **Java** tab's coverage list names every
statement it couldn't simulate and why, so nothing is skipped silently.

## TeleOps and plain autos (`src/java.js`, `src/expr.js`, `src/sim.js`)

- **Both OpMode styles.** `LinearOpMode` (`runOpMode()`: INIT up to `waitForStart()`, then the
  `while (opModeIsActive())` loop, or a sequence for an auto) and iterative `OpMode`
  (`init()` / `loop()`).
- **Hardware.** `DcMotor`/`DcMotorEx`, `Servo`, `CRServo`, `IMU` (yaw from the robot's real heading,
  zeroed at INIT and by `resetYaw()`; pitch and roll read 0), distance, touch and colour sensors, found
  through `hardwareMap.get(...)` or `hardwareMap.x.get(...)` with their configuration names.
- **Motors.**
  - `setPower`, `setVelocity`, `setDirection` (the SDK's convention: FORWARD turns the shaft clockwise seen from its end)
  - `setMode` (`RUN_TO_POSITION`, `STOP_AND_RESET_ENCODER`, `RUN_USING/WITHOUT_ENCODER`), `setTargetPosition`
  - encoder reads that behave like a real hub: `getCurrentPosition`, `getVelocity`, `isBusy`
- **Servos.** `setPosition` and `getPosition`; speed and stall from the servo model. An uncommanded
  servo stays where the CAD drew it.
- **Control.**
  - FTCLib `PIDController` / `PIDFController`, with FTCLib's default integral bounds of ±1
  - hand-written PIDs
  - `ElapsedTime` timers and `sleep()` (a sleep inside a TeleOp loop freezes that pass, as on the robot)
- **Language.**
  - locals and fields, arithmetic and `Math.*`, `Range.clip`
  - `if`/`else` chains, `switch` on ints or enums, enum state machines
  - `for` and `while` in autos, `try`/`finally`
  - telemetry
- **Gamepads.** Every button, stick and trigger on gamepad1 and gamepad2, from a real controller
  or the keyboard, with rumble.
- **Not simulated,** and listed by the coverage panel when it appears:
  - `do/while`
  - loops inside a TeleOp loop pass
  - `return`/`break`/`continue` inside the loop
  - objects the bench doesn't model (vision, most third-party libraries)

## Road Runner 1.0 autos (`src/roadrunner.js`)

Road Runner autos lean on classes in other files, so the bench keeps **helper classes**: any
`.java` without `@TeleOp` or `@Autonomous` that you drop in (a `MecanumDrive`, an `Arm` with its
actions, a PID class) is available to every OpMode.

**From the OpMode:**
- `Pose2d` / `Vector2d` values and `new MecanumDrive(hardwareMap, pose)`, which sets the start pose (the robot is placed there at INIT)
- `new <HelperClass>(hardwareMap)` objects
- `TrajectoryActionBuilder x = drive.actionBuilder(pose)…` chains, and inline `drive.actionBuilder(...)...build()`
- `Actions.runBlocking(...)` calls after `waitForStart()`, in order

**Builder methods:**
- lines: `lineToX`, `lineToY` (with tangent, constant, linear or spline heading)
- strafes: `strafeTo`, `strafeToConstantHeading`, `strafeToLinearHeading`, `strafeToSplineHeading`
- splines: `splineTo`, `splineToConstantHeading`, `splineToLinearHeading`, `splineToSplineHeading`
- turns: `turn`, `turnTo`
- tangent: `setTangent` (in **radians**, as Road Runner reads it), `setReversed`
- actions and time: `waitSeconds`, `stopAndAdd`, `afterTime`, `afterDisp` (run as time, at 1 s per 50 in)
- `build`
- constraints: `TranslationalVelConstraint`

**Actions:**
- `ParallelAction`, `SequentialAction`, `SleepAction`
- `InstantAction(() -> …)`
- `builder.build()`
- the helper classes' own actions, which the bench reads from their source:
  - inner classes that `implements Action`, whose `run()` body runs each loop until it returns `false`
  - the methods that hand them out (`public Action open() { return new Open(); }`), with constructor arguments
  - static helpers that return a number (`Arm_PID_Class.returnArmPID(target, position)`), each with its own PID objects and fields

**Paths and following.**
- Paths are Road Runner's shapes: quintic splines with its end derivatives, and lines. They are
  time-profiled against `MecanumDrive.PARAMS`: `maxWheelVel`, the acceleration limits and
  `maxAngVel`.
- The follower takes the target pose from the profile, puts the team's `axialGain`,
  `lateralGain` and `headingGain` on the pose error, and drives the four motors named in
  `MecanumDrive`, with their directions, through the CAD's wheels.
- Which way Road Runner's "forward" points on the robot comes from those motor directions and the
  CAD, as it does on the real robot.

**What's different from the real robot:**
- **The localizer is perfect:** it reads the sim's true pose.
- **The feedforward is the bench's own:** wheel speed to power from the CAD's motors and wheels.
  A team's `kS`/`kV`/`kA` are tuned to their encoders and battery, and GearGurus 7832's, for
  example, only work with their dead wheels' encoder directions.
- **Paths from another season's field** run into this season's field elements. Set **Field →
  walls only** on the Robot tab; the default robot's auto does this by itself.

**The Checks tab adds:**
- the plan: trajectories, actions and seconds of driving
- devices the auto never commands (GearGurus 7832's auto never starts its slides' PID)
- a configuration name with a stray space (`" bR"`)

## Seeing what was understood

- **Java tab:** the parsed statements, and coverage. Each skipped line gives its reason.
- **Checks tab:** findings about the code on this robot.
- **Math tab:** the equations behind the motion, with this robot's numbers.
