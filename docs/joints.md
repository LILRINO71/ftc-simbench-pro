# Joints: how a STEP file becomes a moving robot

A STEP export describes every part's shape and where it sits. It has no hinges, no slides, no
motors attached to anything. Before a robot can move, the bench has to know, for every
mechanism:

- the **parts** that ride on it
- its **axis** and **pivot** (or slide direction), in the robot frame
- how far it can **travel**
- which **device** in the code drives it, and how the code's numbers turn into motion (encoder ticks per turn, mm per tick, the servo position the CAD was drawn at)
- what it **follows**: a cascade slide stage, a meshed gear, a linkage

There are four ways to get those. They all end up as the same mechanisms, so the sim, the
Checks tab and the 3D view treat them alike.

## 0. Onshape's URDF export: exact, and the usual way

Since March 2026 Onshape exports an assembly as URDF (right-click the assembly tab → **Export** →
format **URDF**, geometry **GLB**): the mates become joints with their limits, the mass
properties become inertials, and every part comes as a mesh. Drop the zip on SimBench and
`src/meshfiles.js` unzips and reads it on the page, `src/urdf.js` makes the robot, and
`src/bind.js` sets aside the library's bearing and shaft turns and ties the code's devices to the
real joints. No sign-in, no server, no API quota. The export drops mate *relations*, so a cascade's
stages and a gear pair's followers are inferred as hints and coupled once the code says which is
driven. See [robot-setup.md](robot-setup.md).

## 1. Onshape mates, read live: exact, with relations

If the robot is in Onshape, its assembly already has every mate. `src/mates.js` reads the
assembly definition (`GET /api/assemblies/d/…/w/…/e/…?includeMateFeatures=true`). It groups parts
fastened together into rigid bodies and walks the moving mates (revolute, slider, cylindrical,
pin-slot) out from the chassis as a joint tree. Each joint gets its true axis and pivot, the parts
it carries, its limits from the features list, and any gear, rack or screw relation to another
joint.

**Sign in with Onshape** (`src/onshapelink.js`, `functions/onshape/`): in the **Get my robot from
Onshape** pop-up, sign in through Onshape's own page once, then paste the assembly's address. It
reads the same API calls as the bookmark below, through a small Cloudflare Pages Function, and works
on school computers, which block bookmarks. Setting it up for a site is in `DEPLOY.md`.

**In one click** (`src/onshapelink.js`): drag **Send to SimBench** from the **Mates & joints**
panel to the bookmarks bar once. Then, on the robot's assembly tab in Onshape, click the bookmark.
It reads that assembly's definition and mate features from Onshape's API with the team's own
sign-in (the same two pages as below) and opens SimBench with them packed into the address's
`#fragment`. A fragment never leaves the browser, so no server sees the robot, and no API key is
needed.
- **Robot already open:** if the team's robot is open in another SimBench tab, that tab offers
  **Apply**, and the new tab closes.
- **Robot not open yet:** the mates wait for the STEP of the same assembly and apply as soon as it's
  dropped. They never go onto the default robot.
- **Very big assembly:** it doesn't fit in an address, so the bookmark saves one `.onshape.json`
  file to drop instead.

**By hand**, the same panel builds the two API links from an assembly URL. Open them in a browser
that's signed in to Onshape, save the pages, and drop them on the panel. For scripting there's
`tools/onshape-mates.mjs`.

## 2. A joint spec: written down once

No Onshape, or mates that don't match how the robot really moves? A joint spec says the same
things in a small JSON file (`format: "ftc-sim-bench.joints"`). It is kept next to the robot,
dropped on the same panel, and applied every time that STEP is loaded.
[`assets/robots/into-the-deep/joints.json`](../assets/robots/into-the-deep/joints.json) is a full
real example: 17 joints, including a four-stage lift, a gear-coupled claw and a servo slider-crank
linkage.

Units are **millimetres and degrees**, in the bench's robot frame: +z up, origin at the drivetrain
centre on the floor. A joint turns right-handed about its axis, or slides along it, as the value
the code sends goes up, after any `setDirection(REVERSE)` in the code.

```jsonc
{
  "format": "ftc-sim-bench.joints", "version": 1,
  "robot": "Team 1234 · Example",
  "front": "-x",                          // which way the robot's front faces (optional)
  "joints": [
    {
      "id": "lift", "label": "Lift",
      "kind": "slider",                   // "slider" or "revolute"
      "axis": [0, 0, 1], "pivot": [0, 0, 97],
      "device": ["uppies", "uppies1"],    // variable or configuration names
      "part": "5203-2402-0019",           // the actuator, for its speed and torque
      "mmPerTick": 0.26,                  // slide travel per encoder tick
      "limits": [0, 700],                 // mm for a slide, degrees for a turn
      "parts": [                          // which parts ride it (see "Picking parts")
        { "in": "(^|/)Left SAR 230/SAR2XX/", "x": [-40, -11] }
      ]
    },
    { "id": "lift stage 2", "kind": "slider", "axis": [0, 0, 1], "pivot": [0, 0, 97],
      "follows": { "joint": "lift", "ratio": 0.3333 },            // a cascade stage
      "parts": [ { "in": "SAR2XX/", "x": [3, 17] } ] },
    { "id": "arm", "kind": "revolute", "axis": [0, 1, 0], "pivot": [-49.5, 0, 352],
      "parent": "lift",                   // rides on the lift
      "device": "Arm", "part": "5203-2402-0051", "limits": [-305, 8],
      "parts": [ { "in": "/Outtake Arm/" } ] },
    { "id": "claw", "kind": "revolute", "axis": [0.44, 0.35, 0.83], "pivot": [177, 62, 250],
      "parent": "arm", "device": "outClaw",
      "restPos": 0.43,                    // the servo position the CAD was drawn at
      "parts": [ { "solid": [127, 308] } ] },
    { "id": "extend", "kind": "slider", "axis": [-1, 0, 0], "pivot": [-46, 0, 103],
      "follows": { "joint": "crank", "linkage": "slider-crank",   // pushed by a servo crank
                   "crankPin": [176.5, -168, 259], "pin": [-46, -168, 103] },
      "parts": [ { "in": "/Intake/" } ] }
  ],
  "assign": [                             // hand fixes, applied last (the editor writes these)
    { "joint": "chassis", "parts": [ { "solid": [42] } ] }
  ]
}
```

| Field | Meaning |
|---|---|
| `id`, `label` | Name in the UI and in `parent` / `follows`. |
| `kind` | `slider` or `revolute`. |
| `axis`, `pivot` | Direction (unit or not) and a point on the axis, in mm. |
| `parent` | The joint this one rides on (default: the chassis). |
| `device` | The code device or devices that drive it, by variable name or configuration name. |
| `part` | The actuator's part number: speed, torque, ticks per revolution (e.g. `5203-2402-0051` = 50.9:1, 1425.1 ticks per turn). |
| `mmPerTick`, `gear` | A slide's travel per tick; a turn's reduction after the gearmotor. |
| `limits` | Hard stops: mm for a slider, degrees for a revolute. |
| `restPos` | The servo position the CAD was drawn at. A servo nothing has commanded yet stays here. |
| `offsetDeg` | A drawn-pose fix, for a part the CAD left in an impossible spot (Into The Deep's left linkage was drawn folded through the floor). |
| `follows` | `{joint, ratio}` for a cascade stage or a gear pair (`-1` for a meshed gear). `{joint, linkage:"slider-crank", crankPin, pin}` for a slide pushed by a crank through a rod. `{joint, linkage:"rod", slider, crankPin, pin}` for the rod itself. `{joint, linkage:"four-bar", crankPin, pin, ground, role}` for a four-bar: `crankPin` joins crank and coupler, `pin` joins coupler and rocker, `ground` is the rocker's frame pin, and `role` is `"rocker"` (it turns about `ground`) or `"coupler"` (it rides the crank, turning about `crankPin`). |
| `parts` | Part picks, below. A later joint's pick wins over an earlier one's, so a child can take parts from its parent. |
| `assign` | Hand fixes applied after all picks: these parts ride this joint, or `"chassis"`. |
| `solids` | How many parts the STEP had when the spec was written, so a spec for another version of the file says so. |

### Picking parts

A pick keeps the parts that pass all of its tests:

- `in`: a case-insensitive regular expression on the part's place in the assembly, `"Sub/Sub/Part name"`
- `not`: the same, to leave parts out
- `x`, `y`, `z`: `[lo, hi]` in mm, the part's centre in the robot frame
- `solid`: `[indices]`, exact parts. Fine for a spec tied to one STEP file; the editor uses these.

## 3. The joint editor: fix it by clicking

Open the **CAD** view and click a part (Ctrl-click to add more). The info panel shows:

- **Rides on**: the joint these parts move with. Pick another joint, or *the frame*, and the parts move there.
- The joint's **axis** drawn through its pivot, with **Flip direction**, **Delete joint**, and a **Try it** slider that moves it before any code runs.
- **New joint from these parts**. The axis and pivot come from what's selected: a spline, shaft or pin turns about its length; a horn, gear, hub or wheel turns about its thin direction; a rail slides along its length. With none of those, the parts' own shape decides. Name the joint, pick the device that drives it and the joint it hangs from, then **Make the joint**.

![The CAD view with a crank selected: what it rides, its axis, and the Try it slider](joint-editor.png)

Every edit is a joint spec: the robot's own, or one written from its current joints the first
time anything changes (`specFromCad`). It's kept per STEP file name in the browser.
**Download joint spec** saves it to share with the team or commit next to the CAD, and **Undo my
joint edits** goes back.

## 4. The automatic joint finder

The aim is to need none of the above for most robots. [research/autorig](../research/autorig/README.md)
prototypes the three parts of finding joints from geometry alone and measures them against the
hand-written spec for GearGurus 7832's robot:

| Piece | Result on Into The Deep |
|---|---|
| **Actuators** (every servo and motor output, its axis and pivot) | 15/15 found, 0 false positives, the 9 driven joints within 0.2° and 2.8 mm; still 9/9 with part names removed or the robot rotated |
| **Slides** (stacks, stage order, fixed stage, direction) | both mechanisms found, direction and fixed stage 4/4, 0 false positives |
| **What each joint carries** (contact graph cut at each joint) | 99.7% of 773 parts on the right joint (precision 99.3%, recall 98.6%); 0 parts wrongly moved on 14 robots with no mechanisms |

It's in the app as `src/autorig.js`. A dropped STEP with no mates, no spec and no saved edits
gets its joints this way by itself, and **Find joints automatically** on the Mates & joints panel
runs it on demand. How it puts the pieces together:
1. **Slides:** each moving slide stage becomes a slider. The middle stages follow the carriage.
2. **Revolute joints:** each actuator that turns something becomes a revolute joint. A gear it
   meshes with, or a pulley at the far end of a belt or chain, becomes a follower.
   An output that reaches back round to its own case is a linkage: the finder looks for the
   pins it turns on (thin round parts parallel to the axis), and a crank, coupler and rocker on
   three pins become a four-bar whose coupler and rocker follow the crank.
3. **Rigid bodies:** the contact graph is cut wherever motion is known, at each actuator's output
   and between slide stages. What stays connected moves as one.
4. **Owners and parents:** each joint owns the body its output is in. A joint hangs from whichever
   joint owns its own case. A body several joints claim (a linkage loop) is shared out by what's
   nearest each one's output.

On GearGurus 7832's robot, the finder in the app gets:
- all 15 actuators, the 9 driven joints on their true axes, both claw gears and both slides
- 158 of 171 moving parts, with no frame part moved

The misses are mostly the left intake linkage, which the CAD draws folded through the chassis.

One robot doesn't prove it works on other designs, so it's also tested on a **mechanism zoo**
(`tools/mechgen.mjs`): arms on goBILDA gearmotors, servos and REV Core Hex motors, a turret,
gear and belt drives, Viper-style slides, a linear rail with a carriage, an intake roller, a
four-bar arm and a servo wrist on a motor arm. Each is tested with its part names and with every
name stripped. It finds 33 of 34 joints and 76 of 78 moving parts, and moves no frame part. The
one miss is an unnamed Core Hex motor.
The panel lists what to check: split bodies, motors that drive a spool, servos found by shape
alone or with an uncertain output end. The joint editor fixes the rest.

## Before any of these: the old guess

Before the finder, `classifyMechs` in `src/step.js` made one mechanism per subassembly that
holds an actuator, and every part rode the nearest mechanism. That's fine for a simple arm and
wrong for most real robots: on Into The Deep it put 238 frame parts on joints. It's still the
fallback when the finder finds nothing.
