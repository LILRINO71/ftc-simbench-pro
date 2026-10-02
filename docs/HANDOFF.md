# Handoff: real joints and real Java

Where the "it never works on our robot" work stands, for whoever picks it up
next. Branch `claude/ftc-simbench-ui-bugs-63kx2s`, pull request
[LILRINO71/ftc-simbench-pro#10](https://github.com/LILRINO71/ftc-simbench-pro/pull/10).

## The problem

A team drops in its CAD and its code, and the bench:

- asks too many questions;
- turns the robot white after a while;
- shows a robot check that doesn't make sense;
- doesn't move the way the real robot does.

There were two root causes.

1. **CAD.** A STEP file has shapes and nothing else: no joints, no motors,
   and only sometimes colours and mass. Every joint was a guess from the
   geometry, and FTC teams build too creatively for guessing to be right.
2. **Code.** The bench read the team's Java with a line-by-line pattern
   reader. Hardware in a `Robot` class, FTCLib commands, Road Runner or
   Pedro meant the reader saw nothing, so the drive and the mechanisms
   were guessed too.

The research behind the fixes is in
`reports/FTC robot import and code running.md`, with its sources in
`research_notes/FTC robot import and code running/`.

## What is done

### Code: the team's real Java runs

- `src/jvm.js` is a small Java interpreter: lexer, parser (it parses all
  1951 files of the code corpus) and a generator-based evaluator.
  `LinearOpMode` blocks by yielding (`{gate}`, `{sleep}`, `{wait:"start"}`),
  so `sleep()`, `waitForStart()` and busy-waits act as they do on a robot.
- `src/jvmlib.js` mocks the FTC SDK in JS:
  - `HardwareMap`, motors, servos and CR servos;
  - IMU, Pinpoint and OTOS odometry, sensors;
  - gamepads with edge detection, telemetry, `ElapsedTime`.
- `src/jvmprelude.js` holds the libraries teams use, written in Java:
  - FTCLib, including the whole command framework;
  - Road Runner 1.0 and 0.5 geometry and kinematics;
  - Pedro Pathing's follower for TeleOp;
  - the SDK's navigation types.
- `src/jvmrun.js` runs the OpMode:
  - `jvCompile` parses it; `JvProgram` runs init, start, tick and stop.
  - `jvAnalyze` probes it on a stand-in robot. The drive comes from what
    the motors do when the stick is pushed, never from names.
  - `jvMechProbe` finds which control moves which device.
- `parseJava` (`src/java.js`) tries the old line reader first and switches
  to the VM when the reader can't follow all of the code (`code.engine === "vm"`).
- The sim (`src/sim.js`) runs the VM program live. Wheel mounting comes from
  the CAD's motors first (so a wrong `setDirection` still fails the drive
  check), then from the code's own forward, then from the standard build.

### CAD: joints that are declared, not guessed

- **Onshape, the whole robot, no STEP** (`src/onshapelink.js`,
  `src/onshapecad.js`).
  - The "Send to SimBench" bookmark runs on the team's signed-in Onshape tab.
    It reads the assembly, its features, and each Part Studio's tessellated
    faces with colours and mass properties.
  - It posts all of that to the SimBench tab, which it opens at
    `#onshape-wait`.
  - `cadFromOnshape` builds the CAD with real triangles, colours and mass,
    and every mate becomes an exact joint (matched by occurrence path).
- **URDF** (`src/urdf.js`): drop a `.urdf` with its `.stl` meshes. URDF is
  what the Fusion, SolidWorks and FreeCAD exporters write. Links become
  parts, joints become mates, and `mimic` becomes a coupled joint.
- **Devices to joints** (`autoMap`, `src/mapping.js`):
  - names are split into words and matched through FTC synonym groups;
  - short forms count ("in" for intake);
  - left/right qualifiers have to agree;
  - the names of the parts a joint carries count too;
  - two motors named alike share one joint.

### The page

- **Robot check** (`src/robotcheck.js`): only `fail` and `warn` items are
  questions. A device with no joint, or a joint nothing drives, is a `note`:
  it shows as a live gauge and asks nothing.
- **Setup** (`setupAuto`): a step counts as done when the robot itself
  answers it.
- **White robot**: the frame-rate watchdog swapped in the light copy, whose
  materials differed from the full robot's. Both now use the same
  environment-lit metal (`src/view3d.js`; `tests/robot-look.test.mjs`).
- **Decluttered**:
  - the setup steps that are found fold to one line;
  - long hints are cut short;
  - "how the CAD was read" folds away;
  - the duplicate START banner is gone, and the arm-torque inset starts folded;
  - the CAD drop says STEP · URDF · Onshape;
  - the Telemetry panel shows exactly what the VM sent;
  - the Java tab says whether the VM ran the code, stood in for a library
    call, or stopped on an exception.

## Measured

`research/fullrobots/bench.mjs` measures real teams' code and CAD. The
corpus is built by `research/realcad/fetch.mjs` and the code fetchers.
Against the base (4d7907e), on 28 teams' main TeleOps:

| | before | now |
| --- | --- | --- |
| drives correctly | 1 | 12 |
| drives at all | 4 | 16 |
| mechanisms found | 4 | 16 |

Across every enabled TeleOp, 41 drive correctly, and 20 of the 28 teams have
at least one that does. The median number of questions on a CAD fell from 5
to 4 with no code, and from 21 to 8 with the ITD code.

## Not done, in order

1. **Test the bookmark against live Onshape.** It is tested only against
   the payload `tools/stepgen.mjs` produces. The research's three spikes are
   still open: the real call count and payload size for a full FTC
   assembly, how Onshape counts session-cookie calls against its quota, and
   whether `tessellatedfaces` returns `outputFaceAppearances` colours for
   linked (COTS) documents.
2. **A Fusion 360 "Export to SimBench" script.** It would write the URDF
   `src/urdf.js` reads, or the package below. Not written.
3. **The robot package `ftc-sim-bench.robot`**: one file with the
   geometry, joints and device bindings, so reloading and sharing a robot
   asks nothing. See section 4 of the report. For now the joint spec
   (`src/jointspec.js`) plus the setup file covers most of it.
4. **Device to joint from the Control Hub config XML**, the first rung of
   the report's matching ladder. Not started.
5. **The legacy line reader's drive sense.** When the old reader handles
   the code, the drive still comes from names, not from a probe. An
   optional cleanup: the VM path already probes.

## Fixed along the way (worth knowing)

- **VM state shared through the parse cache.** Parsed units are cached by
  source, so two programs sharing an OpMode file share its AST. The VM used
  to store per-run facts (a method's owner class, field types, int-returning
  calls, anonymous classes) on those nodes. They now live in a per-VM
  `WeakMap` (`JVM.nodeInfo`). Never store anything run-specific on an AST
  node. Test: `tests/jvm.test.mjs`, "two programs sharing an OpMode file".
- **STEP parsing turned quadratic after a few files.** `splitStepRecords`
  kept `-1` for "no comment left". From about the fourth `parseSTEP` in one
  process, V8's optimised code searched for that comment again on every
  record (found with gdb: memchr over the whole body, ~80k times). That was
  the CAD benchmark's 600 s timeouts. "None" is now the string length. Test:
  `tests/step-speed.test.mjs`.
- `tests/robotcheck.test.mjs` is slow (minutes) in a cloud container but
  passes.

## How to check your work

```
npm test                                   # every tests/*.test.mjs
node --test tests/jvm.test.mjs             # the VM
node research/fullrobots/bench.mjs --only=<id> --no-compare   # one team or CAD
npm run build && (cd dist && python3 -m http.server 8765)     # the page
```

The bench needs the corpus at `/home/user/ftc-cad-corpus` or `--corpus=`.
Only the PC has the owner's own robots and the `fullrobots/` folders.
