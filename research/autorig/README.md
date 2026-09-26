# research/autorig: finding a robot's joints automatically

**The question:** can the bench find a robot's joints from its STEP file alone (no Onshape mates,
no hand-written spec), well enough that any team can drop in their CAD and have it move?

A hand-written joint spec works (see [the default robot's](../../assets/robots/into-the-deep/joints.json)),
but it took measuring spline axes and slide stages by hand. That doesn't scale to every robot.
This folder is the study that decides how to automate it. The problem splits into three pieces,
each prototyped here in plain JavaScript and **measured against ground truth**: the hand-written
spec for GearGurus 7832's 773-part Into The Deep robot, and 14 generated robots that have no
mechanisms, so any joint found on them is a false positive.

Nothing here is tuned to that robot's names or coordinates. Only generic vendor vocabulary
(servo, spline, gearbox, part-number shapes like `5203-xxxx-xxxx`) is allowed, and geometry is
preferred: each prototype also runs with every name stripped.

## Results

### Actuators: [`actuators/actuators.mjs`](actuators/actuators.mjs), `findActuators(cad)`

Finds every servo and motor output: kind, axis, pivot, the output side (spline, horn, hub, gears
and what's bolted to them), the body and mounts, a role (drive, steer, joint, unloaded,
transmission), and meshing gears with their ratio.

| | |
|---|---|
| Actuators on Into The Deep | **15/15 found, 0 false positives** (8 servos, 7 gearmotors) |
| The 9 driven joints | right device 9/9; axis error mean **0.1°**, pivot mean **0.7 mm** (max 2.8 mm) |
| Claw gears | both driven gears and both meshing followers found, ratio −1.001 (truth −1) |
| Drive motors | exactly the 4 drive motors flagged; both lift motors found and marked "unloaded" (they drive spools, not joints) |
| Names, part numbers and tree removed | still 9/9, all 15 found by shape |
| Robot rotated 37°, 45°, 71° | still 9/9 |
| 14 generated robots | 60 actuators, 0 false positives, 0 missed |

Weak spots:
- **Which end of a servo is the output,** when nothing is mounted on it. These are flagged
  `ambiguous`.
- **Actuator types with no real CAD tested yet:** REV Core Hex, UltraPlanetary, Axon.

### Slides: [`slides/slides.mjs`](slides/slides.mjs), `findSlides(cad)` → `toJointSpec()`

Finds telescoping slide stacks from long parallel rails: travel axis, stages in order, the fixed
stage, which way they extend, the travel, and each stage's parts including end hardware. Mirror
copies on the two sides become one mechanism.

| | |
|---|---|
| Into The Deep | the lift (4-stage, vertical) and the intake extension (2-stage, horizontal), each found as one mechanism; direction **4/4**, fixed stage **4/4**, **0** false positives |
| 14 generated robots | 0 false positives; the `mated` robot's lift found with its stages |

**It found an open question in the hand-written spec.** The lift rails are MISUMI SAR230 units,
which the vendor sells as two-piece ball slides (300 mm long, 180 mm stroke). Read that way, the
moving bodies are {inslide of one unit + the printed inserts + outslide of the next}. That gives
5 bodies for the lift where `joints.json` has 4, and 4 × 180 = 720 mm of travel, which fits the
0.69 m the team's code lifts to. Three stages at 180 mm would be only 540 mm. The prototype does
both readings:
- `nested: 'slide'` (the physical one, the default): 100% against a truth built on that reading, and 50–75% against the hand spec, because the bodies are grouped differently.
- `nested: 'rigid'`: 100% against the hand spec.

Which one is right is settled by looking at the robot.

### What each joint carries: [`carry/carry.mjs`](carry/carry.mjs), `inferCarry(cad, joints, seeds)`

Given the joints (axis, pivot, kind, parent) and a seed part for each, it works out every part
that rides each one. It builds a contact graph between parts from their convex hulls and cuts it
at each joint: shafts, bearings and hubs that sit on the joint axis connect both sides and are
handled on their own. Slide rails are ordered by stage.

| | |
|---|---|
| Into The Deep | **99.7%** of 773 parts on the right joint; precision **99.3%**, recall **98.6%**; 0 frame parts moved |
| Robot re-posed 13 ways (lift up, arm swung, intake out) | 99.9% (worst pose 99.7%) |
| 14 generated robots with no joints | **0** parts put on a joint |
| For comparison | subassemblies alone 86.2%; the old nearest-mechanism rule 56.4% (it put 238 frame parts on joints) |

The remaining misses are one linkage beam the CAD draws folded through the frame (a drawn-pose
problem that contact can't see; the joint editor's pose fix handles it) and one pulley-axle screw.

### Side finding

The actuator study found that goBILDA's 13.7:1 Yellow Jacket (`5203-2402-0014`) wasn't recognised,
so GearGurus 7832's drive motors ran as generic 312 rpm motors instead of 435. That's fixed in
`src/hardware.js`, with `tests/hardware-parts.test.mjs`.

## Next

Build the three into the app as one finder (`src/autorig.js`):
1. Actuators give revolute joints (axis, pivot, and the device from `mapping.js`).
2. Unloaded motors next to slide stacks drive those slides.
3. Meshing gears become followers.
4. `inferCarry` assigns the parts.

The output is a joint spec, the same format the editor edits. A dropped STEP with no mates and no
spec gets it automatically, with the uncertain parts (ambiguous servo ends, unknown actuator
types) listed for a person to confirm in the CAD view. This needs more real robots to test on,
especially non-goBILDA ones.

## Running it

Everything runs in Node from the repo; the parser loads the real robot in about 4 s.

```bash
cd research/autorig
node --max-old-space-size=8192 actuators/eval.mjs    # ITD vs truth, and the 14 generated robots
node --max-old-space-size=8192 actuators/robust.mjs  # no splines, no names, rotated robots
node --max-old-space-size=8192 slides/eval.mjs       # both nesting readings, the corpus, 'mated'
node --max-old-space-size=8192 slides/stress.mjs     # synthetic slide designs
node --max-old-space-size=8192 carry/eval.mjs        # all approaches vs truth
node --max-old-space-size=8192 carry/posetest.mjs    # the robot re-posed 13 ways
node --max-old-space-size=8192 carry/leak.mjs        # fake joints: how much does a wrong joint swallow?
```

`lib.mjs` loads the robot (`loadITD()` → `{cad, truth, spec}`) and the corpus. `results/` holds
the output of each evaluation as last run.
