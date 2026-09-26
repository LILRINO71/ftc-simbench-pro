# tests/

454 tests on Node's built-in runner (`node:test`). There's no browser, no mocks and no transpile
step: the tests run the same engine code that ships.

```bash
npm test                    # everything (tools/test.mjs runs every *.test.mjs)
node tools/test.mjs roadrunner mates    # only files whose names match
node --test tests/into-the-deep.test.mjs
```

## How the engine gets into Node

`load.mjs` reads the engine files from `src/` (every file except the DOM-side ones) in build order,
concatenates them, and evaluates them in one function scope, the way the page does. It returns
the API the tests use (`E.parseSTEP`, `E.Sim`, `E.applyJointSpec`, …). Its `EXPORTS` list is that
API; add a name there when a test needs a new function. It also provides:

- `fixture('robots/NAME.step')`: a corpus robot. The STEP files are gitignored and regenerated
  from `tools/stepgen.mjs` on first use; only their `.json` ground truth is committed.
- `run(E, seconds)`: tick the sim at 50 Hz.
- `loadWithField()`: the engine with the vendored BIOBUZZ field switched on.

A few tests (`physics-review`, `mates`, `syntax`) also evaluate `view3d.js`, whose top level is
pure, to test how joints are drawn.

## What's covered

| File | Covers |
|---|---|
| `anyrobot.test.mjs` | **"Will any robot work?"** 14 generated robots (every drivetrain, Y-up, inch units, offset origins, unnamed parts, 4-deep nesting, 1,500 parts) go through the whole engine. Each spins in place, and the true drivetrain centre must stay within 5 mm. |
| `into-the-deep.test.mjs` | **The real robot**, end to end: the team's STEP, joint spec, TeleOp and Road Runner auto. The right parts ride each joint. Gamepad buttons move the lift, arm, linkage and claws the right amounts. The fixed linkage stays above the floor. The auto passes all 9 waypoints within 2 in, in order. |
| `jointspec.test.mjs` | Slider-crank maths, followers, part picks, specs written from any robot's joints, hand fixes, axis suggestions. |
| `roadrunner.test.mjs` | Builder paths and profiles (limits held, rest at both ends), stages and markers, `setTangent` in radians, helper classes and actions, a small auto driven end to end. |
| `mates.test.mjs` | Onshape mates → joints, limits, relations, drawn the way the sim stops them. |
| `drivedir.test.mjs`, `drivetrain.test.mjs`, `wheel-envelope.test.mjs` | Motor direction and mounting, drivetrain detection, what a mecanum wheel is. |
| `dynamics.test.mjs`, `inertia.test.mjs`, `physics-review.test.mjs` | Rigid-body physics, mass properties, wheel loads, against hand-computed numbers. |
| `engine.test.mjs`, `features.test.mjs`, `parser-review.test.mjs`, `sim-review.test.mjs`, `pid-ftclib.test.mjs` | Parser and sim: Java constructs, the Driver Station lifecycle, encoders, `RUN_TO_POSITION`, slides, sensors, FTCLib PID. |
| `mapping-review.test.mjs`, `hardware-parts.test.mjs` | Which device drives which mechanism; motor specs by goBILDA part number. |
| `pershape.test.mjs`, `render.test.mjs` | Exact geometry through OpenCascade (needs the `occt-import-js` dev dependency; its absence fails, never skips). |
| `field.test.mjs`, `robot.test.mjs` | The BIOBUZZ field, collisions, shots, controllers. |
| `session.test.mjs`, `mathdoc.test.mjs`, `product.test.mjs` | Workspaces (including hostile files), the Math export, the status light and GitHub import. |
| `ship.test.mjs`, `syntax.test.mjs` | The minified build behaves like the readable one; every shipped file compiles, and no method is defined twice. |

## Adding a test

Every bug fix comes with a test that fails before the fix (rule 4 in `../AGENTS.md`). Put it in
the file for its area, or start a new `*.test.mjs`; the runner picks it up. Start the file with a
comment that says what is being held true and why, like the files above.
