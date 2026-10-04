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
  Even when the reader covers everything, the code is still run, and each
  wheel's side and end come from what it did (`code.vmDrive`, used by
  `detectDrivetrain`), because config names don't always match where a
  motor sits.
- The drive probe tries the turn stick, then the right trigger, then the left
  stick's x (arcade). Wheels are the motors that get at least half the
  strongest forward power, so a lift that follows the stick a little isn't one.
- Busy-waits during INIT see the robot move (`Sim.stepDevices`, the host's
  `world(dt)`); an INIT that never returns stops with a `Hang` error.
- The IMU reports the robot's heading with a real gyro's small noise
  (±0.017°). Before, `getRobotYawPitchRollAngles()` always read 0.
- The sim (`src/sim.js`) runs the VM program live. Wheel mounting comes from
  the CAD's motors first (so a wrong `setDirection` still fails the drive
  check), then from the code's own forward, then from the standard build.

### CAD: joints that are declared, not guessed

- **Onshape, the whole robot, no STEP** (`src/onshapelink.js`,
  `src/onshapecad.js`). The pop-up (`OnshapeHelp` in `src/app.js`) walks a
  team through it in three steps with pictures and a troubleshooting list, and
  shows the progress while the robot comes in.
  - **Sign in with Onshape** is the main way (`functions/onshape/[[path]].js`,
    a Cloudflare Pages Function). School Chromebooks block bookmarklets (the
    admin's URL blocklist has `javascript://*`), and the owner hit exactly
    that: a click did nothing, and a drag showed `about:blank#blocked`. The
    team signs in through Onshape's OAuth page and pastes the assembly's
    address; the page runs the same reader (`onshapeRead`) through the
    function, which keeps the token in an encrypted HttpOnly cookie and passes
    on only read calls for the robot. Onshape's API has no CORS, so a server
    is needed. It needs the owner's OAuth app (`DEPLOY.md`); without it the
    pop-up falls back to the bookmark. Tests: `tests/onshape-signin.test.mjs`. Every endpoint, parameter and
  response field it relies on was checked against Onshape's OpenAPI spec
  (points as `[x,y,z]` or `{x,y,z}`, colours as `appearance.color`, retries
  on 429/503), and Onshape's CSP allows a bookmark to run there.
  - The "Send to SimBench" bookmark runs on the team's signed-in Onshape tab.
    It reads the assembly, its features, and each Part Studio's tessellated
    faces with colours and mass properties.
  - It posts all of that to the SimBench tab, which it opens at
    `#onshape-wait`.
  - `cadFromOnshape` builds the CAD with real triangles, colours and mass,
    and every mate becomes an exact joint (matched by occurrence path).
- **Onshape's own URDF export, as a zip** (`src/zipin.js`, `src/urdf.js`):
  the route the owner asked for when neither the bookmark (blocked on a
  managed browser, even at home with a school account) nor Sign in with
  Onshape (needs an OAuth app the school's Enterprise admin must allow) was
  usable. Right-click the assembly tab → Export → URDF → STL gives a zip;
  the zip is dropped whole. `robotFromZip` says what a zip holds (URDF, MJCF,
  STEP, glTF, a package) and the URDF reader knows Onshape's habits: the
  shapeless `root`, dummy links for loop closures (→ `closing_` mates),
  cylindrical and planar mates, `continuous` joints, `<mimic>`, underscored
  names with the part number inside, near-zero masses. The Onshape pop-up
  leads with these three steps now; sign-in and the bookmark are folds.
  The owner's first real export crashed the tab (out of memory): Onshape's
  STLs are dense and the builder held four plain-array copies of every
  triangle. Meshes are now decimated on import to a per-robot budget
  (`urdfDecimate`, `urdfTriBudget`, the tier's `ownTris`), shared shapes are
  computed once, and geometry is Float32Array transformed in place: a 300
  part, 6M-triangle export went from ~1 GB resident and 9 s to ~50 MB and
  1 s in Node. The owner's real robot (1,900 links, 9.4M triangles, 463
  continuous mates, 1,484 parts with no material) then drove the next
  round: passive bearings, device-side questions, volume masses, parallel
  and cylindrical dummy chains, size-shared triangle budgets, smooth
  normals (see docs/joints.md "What a real export taught"). It now loads
  with one question per unbound device and a plausible mass. Tests:
  `tests/urdf-onshape.test.mjs`.
  Driving it then showed the last two things (2026-10-03, round three):
  - **The drive follows the code.** The CAD read the owner's four motors
    as inboard (left side to reverse); their code reverses only one left
    motor and the robot drives straight on the field. The bench now takes
    each drive wheel's mounting from what the code commands it on "stick
    up" after setDirection (the VM measures it, the line reader is probed
    once in `Sim.probeSense`), for tank and mecanum bases; the CAD's
    reading is the cross-check, reported in the drive check and the robot
    check as "the CAD reads N motors the other way". `OPTS.driveFrom`
    ("code" | "cad") picks. A kiwi or X-drive keeps the CAD's reading:
    their wheels sit at angles, so stick-up signs are kinematics.
  - **A mecanum base is X.** The CAD read one wheel's rollers the other
    hand (an "O"/mixed pattern), which made strafing spin the robot. Four
    mecanum wheels are modelled X whatever the rollers read, with a note
    naming the odd wheel.
  - **Drawn like a STEP.** The imported robot goes down the exact per-shape
    path (tessFromSolids → View.setExact → applyInstanced): one geometry per
    shape, instanced per copy, lazy placed triangles (osLazyTri), budgets per
    unique shape. 196 MB of heap for the owner's export, the CAD view picks
    every part.
  - **Zero questions.** `src/autobind.js` binds every device the name
    mapper leaves to a joint from the CAD's own evidence and the code's
    usage (docs/joints.md "Zero questions: the binder"); the robot check
    shows each pick with its reason as a note. The owner's export went
    from 7 questions to 0. A mate named after a device is never passive
    and binds first.
  - **The UI, redone on the Apple design system** (the apple-design skill's
    restraint rules: light by default following the system theme, one
    accent, system type stack, type and space for hierarchy, glass only on
    what floats over the field, springs that respect reduced motion, 44 px
    targets): src/styles.css rewritten with the same selector inventory,
    tokens on :root and under [data-theme="dark"]; the field and game
    pieces in physically based materials with the studio environment map
    (src/view3d.js). Screenshots in the session scratchpad ui/.
  Also from the owner's list: the Actuators dock cell is gone (the gauges
  were noise), a robot read from its CAD gets no stand-in shooter drawn in,
  Onshape's default greys are no colour (the part is drawn by what it is,
  as a STEP's are), the CAD view has a "Back to the field" button, the
  sample robot stays hidden until the default robot loads (shown only if
  it can't), and the OpMode list starts with the default robot's own
  TeleOp only; everything else is what the team uploads.
- **URDF** (`src/urdf.js`): drop a `.urdf` with its meshes (STL, OBJ, glTF,
  GLB, COLLADA), loose or zipped. URDF is what the Fusion, SolidWorks and
  FreeCAD exporters write. Links become parts, joints become mates, and
  `mimic` becomes a coupled joint.
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
- **No lag after loading a robot.** One OpenCascade worker stopping used to
  send every remaining part to the page's own thread (seconds per part). Now
  a stopped worker costs one part and is replaced
  (`tests/tess-workers.test.mjs`). Panels redraw only when on screen and
  changed.
- **Graphics.** sRGB output with ACES filmic tone mapping (`linearize()` turns
  authored colours into linear light once), a shadow box that follows the
  robot (about 5.7 px/cm), a cool fill light, and painted foam tiles.
- **Online.** Players meet on seven named relays (`NET_RELAYS` in
  `src/net.js`); Trystero's own pick for this app id included two dead ones.
  The library falls back to esm.sh when jsDelivr fails.
- **Decluttered**:
  - the setup steps that are found fold to one line;
  - long hints are cut short;
  - "how the CAD was read" folds away;
  - the duplicate START banner is gone, and the arm-torque inset starts folded;
  - the CAD drop takes Onshape's exported .zip, .simbot, STEP, URDF, MJCF and glTF;
  - the Telemetry panel shows exactly what the VM sent;
  - the Java tab says whether the VM ran the code, stood in for a library
    call, or stopped on an exception.

## Measured

`research/fullrobots/bench.mjs` measures real teams' code and CAD; `baseline.txt` is the latest
run (engine 34d03fe). Against the base (4d7907e), on 28 teams' main TeleOps:

| | before | now |
| --- | --- | --- |
| drives correctly | 1 | 18 |
| drives at all | 4 | 19 |
| moves a mechanism | 4 | 18 |

Across all 190 enabled TeleOps, 55 drive correctly (it was 4), and 23 of 28 teams have one that
does. Nothing times out. The median number of questions on a CAD fell from 5 to 3 with no code,
and from 21 to 8 with the ITD code.

## Since then (branch claude/architecture-phase-1, 2026-10-03)

The CAD import and architecture design (robot packages, Jolt for the mechanisms, rooms on the
site's own origin, lockstep, tiers, offline) is mostly built, and four reviews' worth of bugs
(sim and physics, CAD import, online and sessions, the view and the build, and the new code
itself) are fixed with a failing-first test each.

**The CAD route that actually works for a school team (2026-10-03):** the owner tried the
bookmark on a home PC with their school's Enterprise Onshape account: a click did nothing and a
drag showed `about:blank#blocked`, because the account's browser policy follows the account.
Sign in with Onshape needs an OAuth app the school's admin must allow. So the file route is now
first: Onshape's own **Export → URDF** zip, dropped whole (`src/zipin.js`, the Onshape habits in
`src/urdf.js`, the pop-up's three steps in `src/markup.html`). It needs nothing but a download.
The body builder in `src/mates.js` also learned that a root-level part fastened to a moving part
rides it (it used to drag the arm into the frame), which is how Onshape's export lays out
subassembly frame links.

What's left of the design:

1. **Lockstep as the match's default.** The ledger, the room's command store, the hash vote and
   Jolt's determinism are built and tested (`tests/lockstep.test.mjs`); matches still send
   poses. Each computer needs to run the other teams' drivetrains from their robot packages.
2. **The simulation in a Worker.** The UI reads about 150 fields of `Sim` directly
   (`Sim.phase`, `Sim.chassis`, `Sim.dev`, `Sim.pad`...), so moving the interpreter and the
   physics off the page's thread needs a mirror of that state posted back each tick. The loop
   time is now measured and shown, so a slow machine is visible meanwhile.
3. **three.js past r128 / WebGPU.** Not started: r128 runs on every Chromebook's WebGL, and a
   current three.js changes colour management and lighting, which needs a person checking
   screenshots.
4. **The rooms and TURN, live.** Deploy `workers/room`, bind it as ROOMS, add the TURN secrets
   (DEPLOY.md), then play a match between two school networks.
5. **The Fusion exporter, in Fusion** (`tools/exporters/fusion`): written, never run.

## Not done, in order (from before)

1. **Switch on Sign in with Onshape and test it live.** Register the OAuth
   app and set the two secrets (`DEPLOY.md`), then try it on a school
   Chromebook with the team's own robot. Check that a second Onshape account
   can authorize the app before it has a public store entry. The reader is
   checked against Onshape's OpenAPI spec and a generated payload, never a
   real assembly (a cloud container can't sign in to Onshape). Still open from the research: the real call count and
   payload size, how Onshape counts session-cookie calls against its quota,
   and whether linked (COTS) parts come with their colours.
2. **Test online on two real computers.** The relays and the loader are
   fixed and tested with the library faked; a cloud container's proxy carries
   no WebSockets, so no live match ran here. A TURN relay would still be
   needed for networks that block direct connections.
3. **Teams whose main TeleOp still doesn't drive** (see `baseline.txt`):
   - t13115 leaves its drive in `STOP_AND_RESET_ENCODER` (real: it wouldn't
     drive on its robot either; the page now says so);
   - rr05 builds its Road Runner drive in a field initializer, where
     `hardwareMap` is still null (real: it crashes on the robot too);
   - tCyberRaptors and tTechTigers: no hardware is found (a runner class, a
     base class);
   - tTechTurb: Road Runner 1.0 `setDrivePowers` through its own drive;
   - t25609 and t27570: no stick reaches a wheel. Start with
     `node research/fullrobots/bench.mjs --code-only --primary-only --only=t25609 --no-compare`,
     then run `jvProbeRun` (exported by `tests/load.mjs`) on the team's files
     and print each motor's power under each stick.
4. **Loading still parses on the page's thread.** The default robot's STEP
   (`parseSTEP`), the shape list for meshing (`stepShapeUnits`) and the robot
   check take a few seconds on a laptop. A worker for `parseSTEP` would help.
5. **The robot package `ftc-sim-bench.robot`**: one file with the geometry,
   joints and device bindings. See section 4 of the report.
6. **Device to joint from the Control Hub config XML**, the first rung of
   the report's matching ladder. Not started.

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
- **The IMU always read 0.** The native IMU passed the yaw to the Java
  `YawPitchRollAngles` as native state instead of its fields. Any field-centric
  drive ran as if the robot never turned. Test: `tests/jvm.test.mjs`.
- **`DcMotor.Direction.REVERSE` did nothing on the VM.** The native interfaces
  didn't extend each other (`DcMotor` < `DcMotorSimple`), so the nested enum
  was a stub. Test: `tests/jvm.test.mjs`.
- **`analyze()` crashed on a VM drive** (it read the line reader's statement
  off each wheel), so robots on the VM lost all their findings.
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
