# src/ — the app

Every file here is a **plain script fragment**: no `import`, no `export`, no bundler.
`tools/build.mjs` concatenates them in its `ORDER` into one `"use strict"` scope inside
`dist/index.html`, so a later file can use what an earlier one declares.

The split that matters:

- **Engine:** every file except the four marked 🖥. It never touches the DOM or three.js.
  `tests/load.mjs` evaluates it in Node exactly as it ships, so the parser, physics and sim are
  tested without a browser.
- **Browser side** (🖥): `tessellate.js`, `view3d.js`, `cadview.js`, `app.js`.

Files are listed in build order. The number in each file's header comment is the order the bench
was designed in, not the build order.

## CAD → a robot

| File | What it does |
|---|---|
| `hardware.js` | The actuator database: goBILDA / REV motors and servos by part number (ratio, rpm, stall torque, servo range), and the spec a device ends up with. |
| `samples.js` | The built-in sample robot and sample OpModes (`?robot=sample`). |
| `step.js` | STEP (AP203/214/242) parser: records, the assembly tree, placements, one solid per part, part kinds, the occurrence list, and the old nearest-mechanism guess (`classifyMechs`). Canonicalises the frame once parsing is done. |
| `hull.js` | Convex hulls, so every part is a solid. |
| `inertia.js` | Mass, centre of mass and inertia from part shapes, materials and vendor figures. |
| `frame.js` | The robot frame: +z up, origin at the drivetrain centre on the floor. `robotToWorld` is the one placement contract for physics, collisions and the view. |
| `drivetrain.js` | Wheels, drivetrain type (mecanum, tank, swerve, kiwi, X), each motor's mounting sign, and the inverse and forward kinematics. |

## Joints

| File | What it does |
|---|---|
| `mates.js` | Onshape assembly definition JSON → exact joints: rigid bodies, a joint tree, limits, gear/rack/screw relations. |
| `jointspec.js` | Joint specs (`ftc-sim-bench.joints`). Part picks by path, name and position; axis, pivot, travel, devices, rest poses; followers (ratio, slider-crank, rod); hand fixes. Also the joint editor's helpers: `specFromCad`, `suggestJoint`, and `mateJointQ`/`jointValues`, which the sim and the view share. See [../docs/joints.md](../docs/joints.md). |

## Code → behaviour

| File | What it does |
|---|---|
| `expr.js` | The expression language: arithmetic, comparisons, gamepad reads, device reads, PID calls, the team's static helper methods. |
| `java.js` | The OpMode parser: devices and their config names, fields, INIT, the main loop, autonomous sequences, `if`/`for`/`switch`/enums, FTCLib detection. |
| `roadrunner.js` | Road Runner 1.0: helper classes (Action inner classes, factories, static PID helpers, `MecanumDrive` `PARAMS`), builder chains → quintic/line paths with time profiles, the action tree runtime, the follower. See [../docs/code-support.md](../docs/code-support.md). |
| `mapping.js` | Which code device drives which joint (`autoMap`): names, config names, the CAD actuator. |
| `robotconfig.js` | Reads the Robot Controller's `.xml` config and checks every `hardwareMap` name against it. |
| `compare.js` | Diffs two OpModes. |
| `analyze.js` | The Checks tab: mapping, stalls, sleeps, travel, joints nothing drives, a Road Runner plan summary. |

## The world

| File | What it does |
|---|---|
| `dynamics.js` | The chassis as a rigid body on N contact patches: motor torque curves, load transfer, slip-limited friction. |
| `field.js` | The BIOBUZZ field: walls, HIVEs, FLOWERs, zones, start poses, collisions. |
| `shots.js` | The running OpMode's shooter on the field, through the vendored shot engine. |
| `controllers.js` | Real gamepads, read the way the FTC SDK reads them. |
| `sim.js` | The Driver Station: INIT / START / STOP, 50 Hz ticks, devices, motors, servos, PIDs, the loop and auto steppers, the Road Runner runtime, sensors, the drive probe. |

## Product layer

| File | What it does |
|---|---|
| `session.js` | `.ftcsim` workspaces: the parsed robot, joints, code, map and pose in one JSON, validated as untrusted input. |
| `mathdoc.js` | The Math tab and its Markdown export. |
| `gitimport.js` | Import OpModes from a public GitHub repo. |
| `onboarding.js` | The first-run tour and the status light. |

## Browser side 🖥

| File | What it does |
|---|---|
| `tessellate.js` | Exact geometry: one mini STEP per unique shape, meshed by OpenCascade (occt-import-js) in up to four Web Workers, then placed at every occurrence and matched to the parser's solids. |
| `view3d.js` | The three.js scene: the field, the robot, instanced exact meshes, materials, the joint hierarchy posed each frame from the sim (`mechPose`, `jointValues`), spinning wheels. |
| `cadview.js` | The Onshape-style CAD view and the click-to-fix joint editor. |
| `app.js` | The UI: panels, the OpMode library and helper classes, file intake, the default robot loader, mates and joint specs, the joint editor's actions, sessions. |
| `markup.html`, `styles.css` | The page. |

Conventions both coding agents rely on (motor direction, the robot frame, joint kinds, joint
specs) are in [../AGENTS.md](../AGENTS.md).
