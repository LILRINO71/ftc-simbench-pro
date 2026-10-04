# Handoff

Two handoffs live here, the newer one first.

## 2026-10-03: the import redone, the page redone

Branch `claude/cad-import-apple-ui`. The problem set by the owner: getting a robot's CAD in took
too many steps, wasn't clear, and wasn't accurate; the page lagged and looked dated.

### What changed

- **Onshape's URDF export is the way in** (Onshape release 1.212, March 2026; GLB meshes since
  September 2026). Right-click the assembly tab → Export → URDF → drop the zip. `src/meshfiles.js`
  (zip, GLB/glTF, OBJ, STL readers; pure, tested in Node) and `src/urdf.js` (`urdfFromZip`,
  tolerant mesh paths, coupling hints) make the robot with no sign-in, no server and no quota.
- **`src/bind.js`**: `classifyJoints` marks the library's bearing and motor-shaft mates internal
  (never a question; the robot check and the name mapper skip them); `bindDevices` ties devices to
  joints by name, by the actuator kind on the axis, by `RUN_TO_POSITION` travel, by pairing and by
  elimination, applies the URDF's coupling hints when the code confirms the leader, and returns the
  open questions with candidates. On 7832's robot with the spec withheld: 11 of 11 bound, nothing
  asked (`tests/import-zip.test.mjs`).
- **`src/engineworker.js`**: the build ships the engine alone as `dist/engine-<hash>.js`; a Blob
  worker imports it and parses STEPs, finds joints, cuts the shape units and builds URDF robots off
  the page's thread (the robot is posted first; the joints and the units follow as promises). The
  eight-second freeze on loading a robot is gone. It falls back to the page on file://.
- **`src/importflow.js`**: one card over the field: bring → busy → code → review → done. The review
  shows facts (up, front, drive base, joints, devices bound, weight) and only the real questions,
  each answerable with one click and a "show" that wiggles the joint.
- **The page**: `src/markup.html` and `src/styles.css` rewritten with the apple-design skill:
  light by default (dark follows the system or the switch), glass chrome (top bar, side panels,
  dock) over a full-bleed field, quiet solid cards, one accent (system blue), spring motion on
  transforms only, reduced-motion and reduced-transparency honoured. Every element id the scripts
  use was kept; the Robot tab is "Your robot / Review / Your robot and your code", with everything
  else under **Advanced**.
- **Graphics**: three.js r128 → r186 as ES modules (an import map, `window.THREE` plus the add-ons,
  the app boots on `three-ready`). GTAO ambient occlusion, SMAA and an OutputPass through an
  EffectComposer (`View.draw`, one composer per camera); RoomEnvironment PMREM as the scene
  environment; physically scaled light intensities; colour management on (no more `linearize`;
  canvases marked sRGB, vertex colours converted where they are built). The frame-rate watchdog
  turns the passes off first, then pixels, then the light copy.
- **The Onshape relay** caches Part Studio shapes and masses at the edge by version or
  microversion (`CACHEABLE`), so the private app's 2,500 calls a year go much further.
- **`tools/fusion/ExportToSimBench`**: a Fusion script that writes robot.urdf, OBJ meshes and a
  zip, with joints and limits from the design's joints and motion links as mimics. Not run in
  Fusion itself (no Fusion here); the API names are from Autodesk's current reference pages.

### Measured here

- Parse 5.2 s, joint finder 3.1 s, shape units 3.1 s for the 773-part robot, all in the worker now.
- 610 tests, all green (`npm test`). `tests/net.test.mjs` is timing-sensitive: it failed once while
  Chrome was rendering alongside, and passes alone.
- Headless Chrome (swiftshader) loads the page with no exceptions, in both themes.

### Not done, in order

1. **Try a real Onshape URDF export.** The reader was built from Onshape's documented behaviour and
   a synthetic export (`tests/import-zip.test.mjs`), not a real zip: no Onshape account was at hand.
   Export GearGurus 7832's assembly (URDF, GLB, Fine, compression off), drop it, and check: mesh
   paths resolve, colours arrive, the lift's stages couple, the claw fingers mirror, the shaft and
   bearing turns are set aside, the eleven devices bind. Composite parts come as one mesh (a known
   Onshape issue) and closed linkages come with a `loop_closure_link`.
2. **Run the Fusion script in Fusion** once and fix whatever the API disagrees with (occurrence
   transforms against body coordinates in `meshManager`, joint geometry on as-built joints).
3. **"Set it by numbers"** for a CAD with no wheels still lives in the Robot tab's Review section;
   the card points at it. Bringing that form into the card would finish the one-place promise.
4. The earlier handoff's list still stands: Sign in with Onshape secrets, online on two real
   computers, the teams whose TeleOps don't drive.

## Earlier: real joints and real Java

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
  - the CAD drop says STEP · URDF · Onshape;
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

## Not done, in order

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
