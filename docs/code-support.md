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

**An OpMode that extends another OpMode** (a "Main TeleOp + encoders" on top of the main TeleOp,
a blue auto on top of the red one) is read together with its parent, and with any other OpMode
whose constants it names (`jvSiblings` in `src/jvmrun.js`). Drop the files in any order. If the
parent isn't there, Checks says which file is missing instead of "no hardware found"; a parent
from a library the bench doesn't have (Pedro's `SelectableOpMode` behind `Tuning`) is named as that.

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

## Running an OpMode without the page (`tools/run-opmode.mjs`)

Another repo, or its CI, runs a team's OpMode on the bench's Java VM through one file. It needs
Node and a checkout of this repo, nothing installed. Import this file and not `tests/load.mjs`,
which is a test helper and can change.

```bash
node tools/run-opmode.mjs TeamCode/src/main/java --opmode MainTeleOp.java --seconds 5 --gamepad sticks.json
```

```js
import { runOpMode } from '../ftc-simbench-pro/tools/run-opmode.mjs';
const r = runOpMode({ code: 'TeamCode/src/main/java', opmode: 'MainTeleOp.java', seconds: 5,
  gamepad: [{ t: 0, gamepad1: { left_stick_y: -1 } }, { t: 2, gamepad1: { a: true } }] });
```

- **Code:** a folder (read to the bottom), a list of files, or `{file, src}` entries. The OpMode is
  read as the app reads it: the files that aren't OpModes are its helper classes, and the OpModes
  it extends or names come with it.
- **Gamepad script:** each step holds from its time, in seconds after START, until the next one. A
  negative time is during INIT (picking the alliance in `init_loop()`). A function
  `(t, run) => ({ gamepad1, gamepad2 })` works too.
- **The run:** INIT, a 0.4 s wait, START, then one pass every 20 ms.
- **The result** is plain data; the command prints it as JSON and exits 0, 1 (not clean) or 2 (bad command):
  - `ok`: it compiled, every file was read, and the OpMode didn't stop on an error
  - `compile`: `ok`, `error`, `line`, and `parseErrors` for helper files that couldn't be read
  - `error`: what stopped the OpMode (`cls`, `msg`, `file`, `line`, `phase`, `at`); `cls` is
    `MissingClass` when the parent it extends wasn't among the files
  - `devices`: what it asked `hardwareMap` for (`name`, `type`, `kind`)
  - `peaks`: per commanded device, the largest command (`peak`), `min`, `max`, `last`, and
    `target` for `setTargetPosition`. A device that is missing here was never commanded.
  - `telemetry`: the last lines sent; `stubs`: library calls the VM absorbed without running
  - `helpers`, `siblings`, `class`, `style`, `ran`, `ended`, `prints`

**The robot it runs on is a stand-in,** not CAD and not physics: motors turn at the speed they are
told to, `RUN_TO_POSITION` reaches its target, servos are where they were sent, and the robot
stands still on the field. That checks that code compiles, runs and commands what it should. It
doesn't follow a Road Runner trajectory (the builder calls land in `stubs`; the page follows them
on the CAD robot) and a Pedro follower never arrives, because the pose never changes.

**On the field, with the game pieces** (`field`, command line `--field`): the same VM drives the
bench's own sim instead, a plain 18 in robot at the alliance's start (or `startPose`) that drives and
meets the walls and the HIVEs, among the staged pieces ([game-pieces.md](game-pieces.md)).
`field: { alliance, pieces: false, balls: [{ x, y, kind, color }], payload: {…}, shot: {…} }` empties the
field, adds loose balls (inches) and sets the Shot tab's settings. The result keeps every field above and
adds `payload`: `supply` and `why`, `picked`, `ejected`, `fired`, `scored`, `fromFlowers`, `otherNectar`
(G408), `preloaded`, `held` (`kind`, `color`), `intakes` (each one's `edge` and `edgeFrom`, `in`
(`positive`/`negative`/null), `inFrom` and `decidedAt`), `transfer`, `gate`, `flywheels`. Without `field`
there is no `payload`.

**A caller with its own robot** passes `host`, an object with any of the methods the VM asks of a
robot (`pose`, `heading`, `omega`, `vel`, `touch`, `color`, `colorDist`, `ray`, `volts`, `rumble`,
`dev`); the stand-in answers the rest. `beforeTick(run)` and `afterTick(run)` run around every
pass and `onStart(run)` just before START; `run` carries `t`, `tick`, `phase`, `dt`, `pads`,
`telemetry` and `devices`. [biobuzz-robot-2026](https://github.com/LILRINO71/biobuzz-robot-2026/blob/main/sim/run-opmode.mjs)
models a whole robot this way and checks its auto and TeleOp in CI.

### How often does the auto work? (`--runs`, `--seed`)

```bash
node tools/run-opmode.mjs TeamCode/src/main/java --opmode MyAuto.java --seconds 30 --runs 10 --seed 1 \
  --cad Robot.step.gz --joints Robot.joints.json --within 2 --deg 5 --min-rate 0.7
```

`runs` (1 to 50) runs the same OpMode again and again, each run from its own seed so a batch comes
out the same every time (`seed`, default 1). The plain run is exactly what it always was; the batch
comes back as one more field, `monteCarlo`: `{mode, runs, seed, passed, failed, successRate, results}`.

- **With `cad`** (a `.step` or `.step.gz`, and its joint spec in `joints`) every run is the full
  rigid-body sim on that robot. Floor friction, mass, battery voltage, control latency, where the robot
  is set down and where the field's elements sit are varied a little (the ranges are in `src/montecarlo.js`,
  with the guessed ones marked as assumptions). A run works when the robot ends within `within` inches
  and `degrees` degrees of the end of the Road Runner path. Each result has `seed`, `ok`, `pose`,
  `err` (`pos` in inches, `deg`) and `extremes`, the variation that was far out in that run, so a miss
  can be replayed (`seeds`) and explained. `histogram`, `target`, `nominal` (the run with no variation) and
  `worst` (the three furthest-off seeds) come with it.
- **Without `cad`** the runs are on the stand-in robot, which has no mass or friction to vary. Battery
  voltage and the start pose are varied, and a run works when the OpMode ran clean.
- `--min-rate 0.7` makes the exit code 1 when fewer than 70 % of the runs worked, for CI.

In code: `runOpMode({ code, opmode, seconds: 30, runs: 10, seed: 1, cad, joints, within: 2, degrees: 5 })`;
`success` takes a whole definition (`{mode: 'points', points: 10}` counts the alliance's AUTO points) and
`vary` (`{ friction: false }`) holds a factor at its nominal.

### Every OpMode, on every push (`tools/check-code.mjs`)

```
node tools/check-code.mjs TeamCode/src/main/java [--seconds 3] [--skip Tuning.java] [--only Main.java] [--json] [--summary file.md]
```

Runs every OpMode the Driver Station would list (`@TeleOp` or `@Autonomous`, not `@Disabled`, not
abstract) twice on the stand-in robot: once with the sticks at rest, and once with every stick,
trigger and button of both gamepads worked in turn, so the code behind a button runs too. An
OpMode that stops on an error fails, with the file and line; the exit code is 1 when any fails.
An OpMode whose whole body is a library class the bench has no copy of (Pedro's `Tuning`) is
listed as `n/a`, not as a failure. A pass means the code was read and ran without stopping on an
error. It does not mean the robot does what you want.

In a team's own repository, as `.github/workflows/simbench.yml`:

```yaml
name: simbench
on: [push, pull_request]
jobs:
  opmodes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: git clone --depth 1 https://github.com/LILRINO71/ftc-simbench-pro.git ../ftc-simbench-pro
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: node ../ftc-simbench-pro/tools/check-code.mjs TeamCode/src/main/java --summary "$GITHUB_STEP_SUMMARY"
```

It needs nothing installed but Node. In code: `checkCode({ code, seconds, skip, only })` returns
`{ok, passed, failed, unmodelled, skipped, opmodes: [{file, name, kind, ok, why, devices, stubs}], notRun}`.

## Seeing what was understood

- **Java tab:** the parsed statements, and coverage. Each skipped line gives its reason.
- **Checks tab:** findings about the code on this robot.
- **Math tab:** the equations behind the motion, with this robot's numbers.
