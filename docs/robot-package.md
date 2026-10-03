# The robot package (`.simbot`)

A robot package is the whole robot in one file: its shapes, its joints and how they're coupled, which device in the code drives which joint, and its masses. It's made once from whatever the team has, and opened anywhere after with nothing to re-parse and nothing to fetch from Onshape.

- **Make one:** load the robot (from Onshape, a URDF or MJCF, or a STEP with its joints), then **Mates & joints → Download robot package**. If your code is loaded, its device names are bound to the joints in the package.
- **Open one:** drop the `.simbot` anywhere on the page, or use **Open a file**.
- **Share it:** commit it next to your code, or send it to a teammate. It opens on a school Chromebook with no Onshape access.

The code is `src/simbot.js`; the tests are `tests/simbot.test.mjs`. A package picks parts by number only: a pattern pick in a package is ignored.

## What's inside

It's a plain zip. Any unzip tool opens it, and any glTF viewer shows `robot.glb`.

| File | What it holds |
| --- | --- |
| `manifest.json` | Format `ftc-simbench.robot`, version 1. The robot's name, where it came from (`onshape`, `urdf`, `mjcf` or `step`), whether its joints are exact or a draft, counts, total mass, and the validation report (below). |
| `joints.json` | A joint spec, format `ftc-sim-bench.joints`, **version 2**: every joint with its axis, pivot, travel limits, parent and the parts it carries, plus a `constraints` list (below). The joint editor reads and writes it like any joint spec. |
| `bindings.json` | Which code device drives which joint, with the actuator's part number and its `mmPerTick`, `gear` and `restPos`. |
| `mass.json` | Each rigid body's mass (kg) and centre of mass (mm), and how many of its parts carried a mass from the CAD. |
| `robot.glb` | The geometry, glTF 2.0 binary. One mesh per unique shape, placed at each copy (eight identical channels are one mesh), under one node per rigid body: `chassis` and each joint. Metres, Y up as glTF requires: the root node turns the bench's Z-up robot frame into it. Each part node carries its index, part number, kind and CAD mass in `extras`. |

## Joint spec version 2

Everything version 1 has (see [joints.md](joints.md)) plus:

- `constraints`: a list of
  - `{type: "gear" | "rack and pinion" | "screw" | "linear" | "ratio", leader, follower, ratio, offset?}`: the follower sits at `ratio × leader (+ offset)`. Gear, rack and screw come from Onshape's mate relations; `linear` is a cascade stage or a MuJoCo joint equality.
  - `{type: "loop", name, a, b, point, axis, joint}`: a mate that closes a linkage loop. `a` and `b` are the two joints (or `chassis`) whose bodies it pins together, `point` is where, in mm. The physics solver (`src/joltmech.js`) pins them; the kinematic bench drives the loop through its first joint.
- `continuous: true` on a joint: a roller or a wheel that has no limits on purpose.
- `exact`, `auto`, `source` at the top: whether the joints were read from mates (exact) or found from the geometry (a draft), and from what.

A follower written in version 1's `follows` still works.

## The validation report

Before anything moves, the package lists what a person should check (`validateRobot`). The robot check and the Mates & joints panel show it.

| Code | Means |
| --- | --- |
| `draft` | The joints were found from the shapes, not read from mates. Check each one. |
| `no-limits` | A joint has no travel limits, so nothing stops it short of the code. Turn on its mate limits. |
| `no-mass` | Parts came with no mass from the CAD; their mass is estimated from their shape. Give them a material. |
| `no-device` | No device in the code drives this joint. Name its mate exactly as the device's configuration name. |
| `floating` | Parts are tied to the chassis by no mate. |
| `unsupported-mate` | A planar, parallel or similar mate, held where it was drawn. |
| `relation-dangling` | A gear or rack relation names a mate the bench doesn't simulate. |
| `loop` | A linkage loop closed by a mate. |

## Trust

Teams mail these to each other, so a package being opened is hostile input. The reader caps the archive (20 MB), what it unpacks to (150 MB), the number of files, parts, meshes, nodes, triangles and joints; refuses encrypted, split and zip64 archives and any file name that climbs out of the archive; stops inflating a file the moment it passes its declared size; checks every CRC, every glTF accessor bound and every index; refuses JSON nested too deep; and never evaluates anything it holds. A bad package is refused with a reason, never with a crash.

## Authoring rules that make a package exact

Onshape assemblies give exact packages when:

- every motion is a real mate (revolute for arms and wrists, slider for each slide stage), and everything else is fastened or in a mate group;
- every revolute and slider mate has its limits on;
- gears, racks and cascade stages are mate relations, source joint first;
- each driven mate is named exactly as its device's configuration name (`dof_` names from onshape-to-robot work too, and `dof_x_inv` turns its axis round);
- every custom part has a material, so its mass is real.
