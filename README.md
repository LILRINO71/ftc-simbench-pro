# FTC SimBench Pro

**Put any FTC robot's CAD and its real Java code into a browser, and watch that robot run that code.**
It runs on the 2026-27 BIOBUZZ field, with its own mass, motors and traction, and the math behind
every number.

**Live:** https://ftc-simbench-pro.pages.dev · rebuilt from `main` on every push

![GearGurus 7832's Into The Deep robot on the BIOBUZZ field: lift at the high basket, intake out the front, running the team's own TeleOp](docs/into-the-deep.png)

*GearGurus 7832's 2024-25 robot, from the team's own Onshape export, running the team's own
`sample_teleop.java`. Gamepad 2's Y raised the four-stage lift 0.69 m and swung the outtake arm to
the basket. A pushed the intake out 226 mm through its servo linkage and dropped the claw. Nothing
here was re-coded for the simulator.*

---

## What we're building

FTC teams write most of their code before the robot is finished, and then test it on a robot that
is also being rebuilt. Existing simulators want the robot modelled again inside the simulator.
Teams don't have time for that, and the model drifts from the real robot.

SimBench Pro starts from what a team already has:

1. **The CAD** they built the robot from. From Onshape that is two steps: right-click the
   assembly tab, **Export → URDF** (GLB meshes), and drop the zip on the page. Every mate becomes
   an exact joint, every part keeps its colour and its material's mass, and nothing is uploaded or
   signed into. Fusion, SolidWorks and FreeCAD teams drop a URDF with its meshes
   ([tools/fusion](tools/fusion/README.md) writes one from Fusion); a plain STEP still works, with
   the joints found from the geometry.
2. **The OpModes** they already run on the Control Hub: TeleOps and Road Runner autos, as `.java`.

From those two things alone it works out the robot:
- **Frame and drivetrain:** where up is, where the drivetrain centre is, and what the drivetrain is (mecanum, tank, swerve, kiwi, X-drive).
- **Mass:** weight, centre of mass and inertia.
- **Actuators:** which motors and servos drive what.
- **Joints:** how every mechanism moves.

It then runs the code at 50 Hz against a rigid-body model on the season's field. You drive it
with a real gamepad and see what the code does, before the robot exists or while it's in pieces.

**The hard part is joints.** A STEP file has shapes and positions, but no hinges and no slides.
Getting from "773 parts" to "this lift, this arm, this claw, moving this way" is most of the
project. There are four layers, from exact to automatic:

| Layer | What it is | Status |
|---|---|---|
| **Onshape's URDF export** | The main way in. Onshape writes the assembly's mates as URDF joints (with limits), its mass properties as inertials, and every part as a GLB mesh in one zip. `src/meshfiles.js` unzips and reads GLB, glTF, OBJ and STL on the page; `src/urdf.js` turns it into the robot. The relations URDF can't carry (a cascade's stages, a two-gear claw) are inferred as hints and applied only when the code confirms them. No server, no sign-in, no quota; works on school Chromebooks. | ✅ `src/meshfiles.js`, `src/urdf.js` |
| **Which joints are mechanisms, and what drives them** | A library assembly carries a revolute inside every motor and bearing; exported, a real robot had 113. `src/bind.js` marks those internal from what they carry, then ties the code's devices to the real joints by name, by the actuator kind on each joint's axis, by the travel the code asks for, and by elimination. Only a device with two live candidates is a question. | ✅ `src/bind.js` |
| **Onshape mates, live** | The advanced way: the assembly's own mates read from Onshape's API, with gear and rack relations the export leaves out. **Sign in with Onshape** through a Cloudflare Pages Function, or the **Send to SimBench** bookmark on a home computer. | ✅ `src/mates.js`, `src/onshapelink.js` |
| **Joint spec** | A small JSON file that says the same by hand: parts, axis, pivot, travel, which device drives it. It also covers cascade slides and servo slider-crank linkages. | ✅ `src/jointspec.js`, [docs/joints.md](docs/joints.md) |
| **Click-to-fix editor** | In the CAD view: click parts, pick what they ride on, make a joint (the axis is suggested from the selected spline, gear or rail), flip it, try it. Every edit is a joint spec you can download. | ✅ `src/cadview.js` |
| **Automatic joint finder** | Finds actuators, slide stacks and the parts each joint carries, straight from geometry, for any STEP. Runs by itself when a robot has no mates and no spec, and lists what a person should check. | ✅ `src/autorig.js`, from the measured prototypes in [research/autorig](research/autorig/README.md) |

| **The match** | An alliance partner and two opponents the bench drives, and both alliances' human players, playing AUTO or TELEOP by the manual's rules, sharing the HIVEs with the team's robot, with a live scoreboard. | ✅ `src/match.js`, [docs/match.md](docs/match.md) |
| **The import card** | One card over the field says the one thing to do next: bring the robot (two Onshape steps), add the code, then a review of what the bench worked out (up, front, drive base, mass, joints, device bindings) with the few questions only the team can answer, each with a "show me" that moves the part. Reading happens in a Web Worker, so the page never freezes. | ✅ `src/importflow.js`, `src/engineworker.js`, [docs/robot-setup.md](docs/robot-setup.md) |
| **Online matches** | One match with other teams, each on their own computer with their own robot and code: Quick match, a room code or an invite link, alliance chat, marks on the field. Browsers connect directly; the host's bench keeps the score. | ✅ `src/net.js`, [docs/online.md](docs/online.md) |
| **Robot check** | Checks the joints, wherever they came from, against the team's own OpMode: every motor and servo it moves has a joint, every joint carries parts and is driven, nothing swings through the frame. What it can't confirm becomes a question in the team's device names, with the likely answers and a button to see each one move. | ✅ `src/robotcheck.js`, [docs/robot-check.md](docs/robot-check.md) |

The goal is that every robot ends up right: exact from Onshape mates when there are any, and
otherwise checked against the team's code, with a few questions only that team can answer.
Nothing wrong is shown without saying so. Real teams' CAD ([research/realcad](research/realcad/README.md))
is the test set.

## What it does today

| | |
|---|---|
| **Any robot's export** | `meshfiles.js` reads the zip Onshape (or a Fusion, SolidWorks or FreeCAD exporter) writes: the URDF and its GLB, glTF, OBJ or STL meshes, all on the page. `urdf.js` makes the robot from it, and `bind.js` settles which joints are mechanisms and which device drives each. `step.js` resolves a plain STEP's assembly tree. `frame.js` puts every robot in one frame (+z up, origin at the drivetrain centre on the floor). `drivetrain.js` finds the wheels, the drivetrain type and each motor's mounting. `inertia.js` works out mass, centre of mass and inertia from part shapes and vendor data. Tested on 14 generated robots of every drivetrain type and on a real 773-part robot. |
| **The robot as Onshape draws it** | `tessellate.js` meshes every real surface with OpenCascade in Web Workers, one small STEP per unique shape. The real robot has 99 shapes, placed 773 times, in about 12 s. `view3d.js` draws them with realistic materials; the wheels spin with their motors. `cadview.js` is an Onshape-style CAD view with a view cube, instance tree, part picking and mass properties. |
| **Real code, unmodified** | `java.js` + `expr.js` interpret LinearOpMode/OpMode TeleOps and autos: hardware maps, directions, encoders, `RUN_TO_POSITION`, FTCLib PID (with its real integral bounds), timers, sleeps, switch/enum state machines. Gamepads map to gamepad1/2, with rumble. |
| **Road Runner 1.0 autos** | `roadrunner.js` reads `TrajectoryActionBuilder` chains, `Actions.runBlocking` trees, and the team's own `Action` classes from their helper files (an `Arm` class, a PID class, `MecanumDrive` and its `PARAMS`). It builds the paths, time-profiles them, and follows them with the team's gains. See [docs/code-support.md](docs/code-support.md). |
| **Rigid-body physics** | `dynamics.js` models motor torque curves, per-wheel normal loads with load transfer, and slip-limited friction. Motor direction follows the FTC SDK: FORWARD turns the shaft clockwise seen from the shaft end, and the CAD says how each motor is mounted. |
| **Checks** | `analyze.js` reads the code against the robot: devices mapped or not, servos that stall, sleeps that freeze a TeleOp, slides the code never powers, a drive probe that says whether the sticks drive this robot the way a driver expects, and a lookup with a stray space in its config name. |
| **Show the math** | `mathdoc.js` prints the equations for *your* robot with your numbers in them (gear ratios, holding torque, traction limits, feedforward) and exports Markdown for an Engineering Portfolio. |
| **BIOBUZZ field** | The measured 2026-27 field from the [BIOBUZZ Shot Sim](https://github.com/LILRINO71/biobuzz-shot-sim), vendored in `vendor/`: HIVEs, CELLs, FLOWERs, POLLEN and NECTAR, and a shot model. |
| **Workspaces** | `session.js` saves the parsed robot, its joints, the code and the pose as a `.ftcsim` file; opening it needs no STEP re-parse. OpModes can also be imported straight from a GitHub repo. |

## Try it

Open **https://ftc-simbench-pro.pages.dev**. It loads GearGurus 7832's Into The Deep robot
([assets/robots/into-the-deep](assets/robots/into-the-deep/README.md)) with the team's `sample tele`.

- **START**, then gamepad 2 (or the keys shown on the page):
  - **Y:** high basket (lift up, arm back)
  - **X:** hand-off pose
  - **A:** intake out, arm down
  - **B:** intake back in
  - **bumpers:** claws
- Pick **The Holy Grail** under Autonomous to run the team's Road Runner specimen auto. It was
  written for the Into The Deep field, so it runs against the walls only.
- The **CAD** button opens the CAD view. Click a part, and its panel shows the joint it rides on,
  the joint's axis, and a slider to try it.
- **Bring your own robot:** in Onshape, right-click the assembly tab → **Export** → format
  **URDF**, geometry **GLB**, compression off. Drop the zip anywhere on the page. Then drop your
  `.java` OpModes and helper classes (or a zip of the TeamCode folder, or paste the GitHub repo).
  The card over the field says what, if anything, is left to answer. A `.step`, a URDF with its
  meshes, or a saved `.ftcsim` workspace work the same way.
- `?robot=sample` opens the small built-in sample instead.
- **Online** in the top bar plays one match with other teams, each on their own computer. Use
  **Quick match**, or host and send the invite link ([docs/online.md](docs/online.md)).

| The joint editor | The team's Road Runner auto |
|---|---|
| ![The CAD view with a crank beam selected: the joint it rides, its axis, and a slider to try it](docs/joint-editor.png) | ![The Holy Grail running on the field](docs/roadrunner-auto.png) |

## How it works

```
 URDF zip ──► meshfiles.js ──► urdf.js ─┐                                  (in a Web Worker:
 (Onshape      unzip, GLB/OBJ   joints,  │                                   engineworker.js)
  export)      /STL meshes      hints    ├──► frame.js ──► drivetrain.js · inertia.js ──► bind.js ──┐
 STEP file ──► step.js ────────────────┘    +z up,       wheels, drive type,         which joints  │
               parts, assembly tree,         origin at    motor mounting,             move, which   │
               the geometry's joints         drive centre mass & inertia              device drives │
               (autorig.js)                                                           each          ▼
 .java OpModes ──► java.js · jvm.js ──► robotcheck.js ────────────────────────────────► sim.js ──► dynamics.js
 + helper files    the team's code,     what only the team can answer                  50 Hz       rigid body,
                   run as written       (importflow.js asks, once)                     Driver      wheels, slip
                                                                                       Station     on field.js
                                                                                               │
                         tessellate.js (OpenCascade) ──► view3d.js (three r186, GTAO) · cadview.js ◄┘
                         analyze.js · mathdoc.js ──► Checks, Math, Graph tabs
```

Every `src/*.js` is a plain script fragment. `tools/build.mjs` concatenates them into one page;
there's no bundler and no framework. Only `tessellate.js`, `view3d.js`, `cadview.js`,
`engineworker.js`, `importflow.js` and `app.js` touch the browser. Everything else is the
**engine**, which `tests/load.mjs` loads into Node exactly as it ships, so the whole simulator is
tested without a browser; the build also ships the engine alone as `dist/engine-<hash>.js`, which
the page runs in a Web Worker to read CAD without freezing. The module map is in
[src/README.md](src/README.md).

## Repository map

| Path | What's there |
|---|---|
| [`src/`](src/README.md) | The app: engine modules, the 3D and CAD views, the UI. |
| [`tests/`](tests/README.md) | 610 `node:test` tests: the robot corpus, physics, parser, Road Runner, the real robot end to end, the match, online play, the URDF zip import and the device binding. |
| [`tools/`](tools/README.md) | The build, the minifier, the test runner, the robot corpus generator, the Onshape mates CLI, and the Fusion **Export to SimBench** script. |
| [`assets/robots/`](assets/robots/into-the-deep/README.md) | The default robot: GearGurus 7832's STEP (gzipped), its joint spec, and the team's OpModes. |
| [`research/autorig/`](research/autorig/README.md) | The automatic joint finder study: three prototypes, measured against the real robot. |
| [`docs/`](docs/README.md) | Guides ([joints](docs/joints.md), [code support](docs/code-support.md)) and the screenshots. |
| `vendor/biobuzz-shot-sim/` | The BIOBUZZ field and shot engine (MIT, ours), synced by `tools/sync-shot-sim.mjs`. |
| [`AGENTS.md`](AGENTS.md) | How the two coding agents on this repo work together: rules, file claims, shared conventions. |
| [`DEPLOY.md`](DEPLOY.md) | Hosting on Cloudflare Pages. |

## Build and test

```bash
npm install            # dev dependency only: occt-import-js, for the geometry tests
npm run build          # dev build  -> dist/index.html (open it, or serve dist/)
npm test               # the whole suite: 556 tests
npm run build:ship     # what Cloudflare Pages builds: comments and layout stripped
```

`dist/` is build output and isn't committed. Cloudflare Pages builds it on every push to `main`;
check the live build by comparing its `SIMBENCH_BUILD` hash with a local ship build.

## Honest limits

- **The physics is a model, not a measurement.** Mass comes from CAD shapes and material density,
  or from a vendor figure when a part is recognised. Every number in the Math tab says where it
  came from. Check a real robot on a real field before you bet a match on it.
- **Guessed joints need a person.** On real teams' CAD the finder alone makes mistakes, which is
  why the robot check asks about anything it can't confirm. Onshape mates skip the guessing.
- **Automatic joints are a first draft.** The finder is measured on one real robot so far (see
  [research/autorig](research/autorig/README.md)). On it, it finds every joint, and every part it
  moves really moves, but 13 of 171 moving parts stay on the frame, mostly where the CAD itself
  is drawn wrong. The panel lists what to check, and the joint editor fixes the rest.
- **Road Runner is emulated, not run.** Paths, timing, markers and every action are the team's.
  The follower uses the team's gains, but its feedforward is the bench's own, taken from the CAD's
  motors and wheels, and the localizer is perfect. Tuned `kS`/`kV`/`kA` values belong to one real
  robot's encoders and battery.
- **Shipped code can be read.** The ship build strips comments, which is not encryption. Nothing
  secret belongs in a browser bundle.

## License and credits

The repository is public so it can be read, but it is **not open source**: all rights reserved,
see [LICENSE](LICENSE). The free, MIT-licensed bench it grew from is
[LILRINO71/ftc-sim-bench](https://github.com/LILRINO71/ftc-sim-bench).

- The default robot and its code are GearGurus 7832's, published at the team's request. The code
  is BSD-3-Clause-Clear, credited in [its folder](assets/robots/into-the-deep/README.md).
- OpenCascade meshing is [occt-import-js](https://github.com/kovacsv/occt-import-js) (LGPL-2.1),
  loaded from jsDelivr at run time.
- 3D is [three.js](https://threejs.org) r186 (MIT), loaded as an ES module from jsDelivr with its
  GTAO, SMAA and RoomEnvironment add-ons.
- Online matches connect through [Trystero](https://github.com/dmotz/trystero) (MIT), loaded from
  jsDelivr only when a player goes online.
