# FTC Sim Bench

**Drop in any FTC robot's STEP CAD and any OpMode. The bench resolves the assembly, runs your code on a virtual Driver Station — INIT, START, STOP — and lets you drive the result on the real 2026-27 BIOBUZZ field. Then it tells you what won't work before you find out at an event.**

**Live:** https://lilrino71.github.io/ftc-sim-bench/ — runs entirely in the browser; nothing is uploaded anywhere.
One-click demos: [shoot into the HIVE](https://lilrino71.github.io/ftc-sim-bench/?opmode=sample-shooter&pose=-40,-30,29&start=1&view=field&right=shot) · [autonomous on the field](https://lilrino71.github.io/ftc-sim-bench/?opmode=sample-auto&start=1&view=field&right=graph) · [mecanum TeleOp](https://lilrino71.github.io/ftc-sim-bench/?opmode=sample-mecanum&start=1&view=field) · [arm + claw](https://lilrino71.github.io/ftc-sim-bench/?opmode=sample-claw)

![The bench with a TeleOp loaded and initialised, waiting for START](docs/bench.png)

---

## What it catches

Real findings from real team code:

| Finding | Why it matters |
|---|---|
| **A `hardwareMap` name isn't in the robot configuration** | Load the Robot Controller's configuration `.xml` and every name is checked exactly — including capitalisation (`"FrontRight"` ≠ `"frontRight"`) and type (a `Servo` in code configured as a continuous-rotation servo). Each of these stops the OpMode during INIT. |
| **`sleep()` inside the TeleOp loop** | A LinearOpMode is one thread. `sleep(450)` freezes the drivetrain and every PID loop for ~22 cycles. |
| **The servo can't hold the arm** — `0.42 N·m usable vs 0.48 N·m needed` | Lever measured from the CAD, servo spec from the part number or your code comment, worst case where the arm sweeps through horizontal. Press the button and the arm jams partway, just like on the robot. |
| **Code and CAD disagree about which servo is which** | The comment says *torque servo*; the STEP assembly has the *speed* variant bolted on. |
| **A button wired to an empty block**, **a mirrored pair set the same way round**, **a missing minus on `left_stick_y`** | Small things that cost a match. |
| **Lines the bench can't simulate** | Reported by line number with a reason (`follower.update()`, a `for` loop inside the loop) — never silently skipped. |

## What you can do with it

- **Driver Station flow.** Pick an OpMode, INIT runs everything before `waitForStart()`, START runs the loop, STOP drops motor power. TeleOp gets a 2:00 match clock, Autonomous 0:30.
- **Autonomous runs in order.** `sleep()` and wait loops hold the sequence while simulated time passes. `RUN_TO_POSITION`, `isBusy()`, `ElapsedTime` and `getRuntime()` behave as they do on the robot.
- **Drive it on the real field.** Tank and mecanum drivetrains drive the measured BIOBUZZ field — 141 in between the walls, 23.5 in tiles — and stop against the walls, the HIVE legs and foot bars, and the FLOWERs. Field-centric code reads the simulated IMU. The driver view is from your alliance station.
- **Plug in a real controller.** Xbox, PlayStation or Logitech, USB or Bluetooth: press a button and it becomes `gamepad1` or `gamepad2` (swap them in the controller menu). The on-screen gamepad mirrors it live, and `gamepad1.rumble(…)` in your code buzzes the real one. Without a controller, the keyboard works too — and each key goes to the gamepad your code actually reads it from, so the drive keys drive a `gamepad1` drivetrain while `gamepad2` is on screen.
- **Move the robot by hand.** Drag it anywhere on the field; shift-drag turns it. It still can't be dropped inside the HIVE or through a wall.
- **Shoot from your code.** Name a motor `flywheel` / `shooter` / `launcher` and a servo or motor `kicker` / `feeder` / `indexer` (or pick them in the Shot tab). When the feeder moves, a ball leaves at the speed your `setVelocity()` or `setPower()` gave the flywheel, from where the robot is, pointing where it points — and like a real shot it wanders: launch angle, aim and speed each scatter by the Shot Sim's precision figures, and the robot's own motion rides along with the ball. A spot the Shot Sim calls 40 % scores about 40 % of the time here. Three POLLEN on the staged NECTAR TIP the HIVE, and the up-CELL swings to the other side.
- **See a real robot, not a point cloud.** Every part in the STEP becomes a solid in its own material — aluminium channel, black servos, yellow-can motors, rubber, printed parts in honey — lit with shadows. A CAD of just a mechanism gets a drawn goBILDA-style mecanum base under it (its wheels spin with the motors), and a drawn hooded flywheel when the code shoots.
- **Watch PID loops converge.** Encoders integrate from commanded power, so `getCurrentPosition()` feeds your own `PIDController` back. The Graph tab plots telemetry, servo positions, motor power and encoder counts.
- **Tune live.** `static` fields show up as config variables you can edit while the OpMode runs, the way FTC Dashboard exposes `@Config` fields.
- **Compare two versions** of a TeleOp control by control — the quickest way to see what changed between `teleop_v3` and `teleop_final`.
- **Own the rig.** Joint types, what carries what, pivots and hardware specs are an editable, portable ~1 kB document you can commit next to your OpMode.
- **Your code, organised.** TeleOp and Autonomous OpModes in their own lists; the Java in its own tab, highlighted, with every line the bench can't run marked in the gutter.
- **Only what you need open.** Every section folds, both side panels fold away (<kbd>[</kbd> and <kbd>]</kbd>), the dock folds to a bar — and the bench remembers. Dark or light, in BIOBUZZ honey.

![An autonomous OpMode running on the field view with the telemetry graph open](docs/auto.png)

## The BIOBUZZ field and the Shot tab

![The shooter sample aimed at the red up-CELL: a green arc into the HIVE, a ball in flight, and the Shot tab saying POSSIBLE](docs/shot.png)

The field is built from the [BIOBUZZ Shot Sim](https://github.com/LILRINO71/biobuzz-shot-sim)'s measured data — the leaning A-frame HIVEs, both bistable arms with their pentagonal CELLs, the four FLOWERs on the walls, LOADING ZONES, GARDENS, alliance areas, and every staged POLLEN and NECTAR. The same engine does the shot physics, vendored in `vendor/biobuzz-shot-sim` (`npm run sync-shot-sim` refreshes it).

The **Shot** tab answers the questions a team has while writing the shooter code:

- **Can you score from here?** POSSIBLE / NOT CONSISTENT / WON'T WORK for the robot's current spot, with the launch angle, exit speed and motor rpm the best shot needs.
- **What should the code command?** With your fixed hood angle, the band of exit speeds that score from this spot — as `setVelocity(…)` ticks per second and as a power.
- **Will this shot go in?** The share of real, scattered shots that score if the robot fires right now — driving or standing still — and how many degrees to turn to be aimed. The arc in 3D shows it: solid for your shot as it stands, green, orange or red by those odds; dashed for the best one from here.
- **What's in the HIVEs?** Grams in each up-CELL against the ~190 g it takes to TIP, TIPs and points. Buttons fire by hand (<kbd>F</kbd>), TIP a HIVE, or reset the field. INIT resets it too, like the field crew between matches.

Link to a spot: `?pose=-40,-30,29` puts the robot at x −40 in, y −30 in, heading 29°; `?alliance=blue` switches sides.

![An Xbox controller driving gamepad1: the controller menu open, the on-screen gamepad mirroring it, the robot turning on its drawn mecanum base](docs/controller.png)

## How it works

The idea that makes it work across thousands of different robots: **separate what the files state from what has to be guessed.**

**Facts — parsed, never guessed.**
- **STEP (ISO 10303-21)**: entity graph, product tree, units and assembly transforms. Most exports store each part in its own coordinates and place it with the assembly, so the bench walks the occurrence tree and applies the transforms. The record splitter is string- and comment-aware and linear-time on 50 MB files.
- **Java OpMode**: parsed into a statement tree with a real expression grammar — precedence, ternaries, booleans, `Math.*`, `Range.clip`, `x++` — and **interpreted**, not pattern-matched. Rising-edge latches, stick mixing, field-centric drive and PID all behave the way they do on the robot.
- **Robot configuration `.xml`**: devices, hubs, ports and types.

**Guesses — seeded automatically, owned by you.** Which subassembly is a mechanism, what kind of joint it is, what carries what, which device maps where. None of that is in a STEP file — Onshape exports no kinematics — so no amount of tuning makes it reliable. The bench drafts it, marks every guess, and hands it to you to confirm.

## Built after studying

| Tool | What it does well | What the bench took from it |
|---|---|---|
| [virtual_robot](https://github.com/Beta8397/virtual_robot) (Beta8397) | Runs real OpModes against a 2D field, with explicit errors | The INIT / START / STOP flow, and reporting what can't run instead of failing silently |
| [Virtual Robot Simulator](https://www.vrobotsim.com/) | Browser-based, gamepad-driven TeleOp on the season field | A browser-only tool with a virtual gamepad |
| [FTC Dashboard](https://acmerobotics.github.io/ftc-dashboard/) | Live `@Config` variables, telemetry graphs | Live-editable config variables, and the telemetry graph |
| [AdvantageScope](https://github.com/Mechanical-Advantage/AdvantageScope) | Log viewer with line graphs and a 3D field | Hover readouts and small-multiple graphs — one y-axis per chart, not two |

## Run it

Open `docs/index.html` in a browser, or use the live link. To work on it:

```bash
npm run build           # src/ + vendor/ → dist/ftc-sim-bench.html, dist/preview.html, docs/index.html
npm test                # 55 tests, node --test, no dependencies
npm run sync-shot-sim   # refresh vendor/biobuzz-shot-sim from a checkout next to this one
```

Zero runtime dependencies beyond three.js (r128, from cdnjs) and Google Fonts; the Shot Sim engine is bundled in.

## Project layout

```
src/
  hardware.js     actuator database, part-number recognition, spec precedence (code vs CAD)
  samples.js      built-in robot and three sample OpModes
  step.js         STEP parser, assembly transforms, part solids, mechanism detection, the kinematic rig
  hull.js         convex hulls: each CAD part drawn as a solid
  expr.js         expression grammar and evaluator
  java.js         OpMode → statement tree, bindings, coverage, config fields
  mapping.js      device ↔ mechanism matching, drivetrain detection
  robotconfig.js  Robot Controller configuration .xml: parse and check hardwareMap names
  compare.js      control-by-control diff of two OpModes
  analyze.js      findings
  field.js        the BIOBUZZ field: start poses, collisions, HIVE state, TIPs
  shots.js        shooter and feeder from the code, ball flight with real scatter, the fixed-hood speed window
  controllers.js  a real gamepad read as the FTC SDK reads it; which gamepad each key presses
  sim.js          Driver Station lifecycle, 50 Hz interpreter, autonomous stepper, encoders, PID, chassis
  view3d.js       three.js field and articulated robot        (browser only)
  app.js          UI: tabs, gamepad, graph, rig editor, Shot tab, intake  (browser only)
vendor/biobuzz-shot-sim/   the Shot Sim engine and measured field data, with its source commit
tests/
  engine.test.mjs, features.test.mjs, field.test.mjs, robot.test.mjs   run the real engine files in Node
  fixtures/        hand-written STEP assembly, competition-style OpMode, robot configuration
tools/build.mjs          single-file bundle for Pages and for sharing
tools/sync-shot-sim.mjs  copies the Shot Sim engine and data into vendor/
```

## Honest limits

- **Torque figures are estimates**: published stall torque, a lever measured from CAD, and a payload you set. They tell you which joint to go measure.
- **Don't tune PID gains here.** Motors have no inertia, gravity load or friction; use the bench to check *which way* a target drives a mechanism.
- The interpreter covers the constructs TeleOps and autonomous routines actually use; it does not compile arbitrary Java. Anything it can't run is listed with its line number.
- Calls into your own classes and path followers (Road Runner, Pedro Pathing) aren't simulated.
- Collisions use the robot's footprint from the CAD box, in 2-D: walls, HIVE legs and foot bars, FLOWERs. There are no other robots, and no intake — the robot never runs out of balls.
- Each CAD part is drawn as the convex hull of its points: a U-channel reads as a box, a bracket loses its bend. Close enough to see the robot; not a replacement for your CAD tool.
- Controllers work in the live site and a local copy. Inside an embedded viewer that doesn't grant gamepad access, the bench says so and links to the live site.
- The flywheel follows the commanded speed after the bench's usual motor slew; the dip after each shot and the spin-up time are in the Shot Sim's motor model, not the live run.

## License

MIT
