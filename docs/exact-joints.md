# Exact joints: say which joints move, once

An Onshape export tells the bench where every joint is: its axis, its pivot, the parts it
carries and, where the team switched them on, its limits. It never says what the team *means*.
Which of the joints are mechanisms? Which motor or servo drives each one? Onshape doesn't store
that anywhere, so neither the URDF export nor the API can hand it over.

REVIVER, the first real export the bench read (2026-10-04), shows the gap:

| In the export | Count |
| --- | --- |
| Moving joints (every bearing, roller, gear, servo spline and shaft is one) | 465 |
| Mates the team had renamed | 0 |
| Joints with limits | 2 |
| Gear, rack or linear relations | 0 (the URDF export drops them) |
| "Mechanisms" the bench picked from sizes, names and the code | 19, most of them servo splines and one-part bodies |

Working it out gets most robots most of the way. It never gets to *exactly*. So the team says it
once, and from then on the bench guesses nothing.

## The rule

Once any joint is **declared with a device**, the robot is in **exact mode**:

- every declared joint is a mechanism, with exactly what was declared;
- every other joint (bearings, rollers, motor shafts, the servo spline nobody named) is held where
  it was drawn;
- a device in the code is tied to a joint **only** where a declaration names it: no name matching,
  no "the only servo left", no travel matching, no coupling hints;
- anything still missing becomes a question that names its fix, for example
  *"Your code moves intake, but no declared joint names it. In Onshape, rename the mate that moves
  it to "motor intake", or pick its joint in the joint sheet."*

There are two places to declare. Both land on the same joints, and the page wins where both speak.

## 1. In Onshape: the mate's own name

This is the best place: the declaration travels with the CAD, to every export and every teammate.
Double-click a mate in the assembly's mate list and rename it. A mate whose name **starts with one
of these words** is a declaration:

| Mate name | Means |
| --- | --- |
| `motor armMotor` | driven by the DcMotor `armMotor` (the name in the robot configuration) |
| `motor liftL liftR` | two motors on one joint |
| `servo claw` | a servo; its range is the mate's limits |
| `crservo intake` | a continuous-rotation servo |
| `follow liftL x2` | moves twice what `liftL`'s joint does (a cascade stage) |
| `follow claw rev` | turns the other way to `claw`'s joint (the second finger of a gear claw) |
| `free` | moves, and nothing drives it (a passive flap) |
| `fixed` | never moves, whatever the mate allows |

- `rev` anywhere: the device's positive direction is the mate's negative direction.
- A ratio is `x` and a number: `x2`, `x3`. A decimal point would arrive as an underscore, so 1.5 is
  written `x1p5`.
- **Limits are Onshape's own.** Tick *Limits* in the mate dialog and set them; the export carries
  them exactly (radians for a turn, metres for a slide). A servo needs them, and so does a slide.

### How the name reaches the bench

The URDF export writes each mate's name as its joint's name, in lower case with every other
character an underscore: `Revolute 10 (1)` arrives as `revolute_10__1_`, and `Motor armMotor`
should arrive as `motor_armmotor`. A mate inside a subassembly that is used more than once comes
once per copy, numbered: `motor_armmotor`, `motor_armmotor_1`, … The grammar is words only for
exactly this reason, and device names are compared without case or punctuation (`armmotor`
finds `armMotor`; `left front` finds `leftFront` or `left_front`).

> **Not yet checked against a real export.** The default names show the pattern above; nobody has
> yet renamed a mate in Onshape and re-exported to see a custom name come through. Do that once
> (rename one mate to `motor test`, export, look for `motor_test` in the `.urdf`) before relying
> on it.

The same names work on the advanced route (Onshape mates read through the API, `src/mates.js`),
where they arrive exactly as typed.

### Things to know

- **A mate in a subassembly declares every copy of it.** Two arms built from one subassembly and
  both named `motor armMotor`: the first is driven, the second turns with it (the same way round
  in the world, so a mirrored copy gets ratio −1).
- **A mate inside a library part can't be renamed.** A goBILDA servo's own spline mate is
  `Revolute 1` in every servo on the robot (REVIVER has 200+ of them). Declare those on the page
  instead.
- **Only `motor`, `servo` and `crservo` switch exact mode on.** A team's own descriptive name that
  happens to start with `free` or `follow` declares only that joint; the rest is still worked out.
  A moving mate named, say, "Motor shaft" *would* switch it on, and the check would then say that
  your code has no device called `shaft`.

## 2. On the page: the joint sheet

For whatever the CAD can't hold: a library part's mate, limits typed in without touching
Onshape, a robot the team doesn't own. Open it from the import card (**Declare joints** or
**Joint sheet**), or from the robot check's **Declare the joints**.

Each row is one moving joint: its Onshape mate name (and which copy), whether it turns or slides,
how many parts it carries, and **Show** to swing it in the CAD view. Set what moves it, the device
name(s) from your code, limits (degrees or millimetres, about the mate's own axis, as Onshape shows
them) and *reversed*. The likely mechanisms are listed first; **Show all moving mates** lists the
bearings and rollers too. **Use these joints** applies it at once.

- It is kept per robot (by the export's name) in this browser, and comes back on every re-import.
- **Download sheet** saves `<robot>.jointsheet.json`. Drop it on the page to load it, or keep it in
  the team's repository next to TeamCode.
- **Names for Onshape** lists each declared joint as "rename this mate to that", with **Copy the
  list**, so the next export declares itself and the sheet can shrink.
- Setting a row named in Onshape to "not a mechanism" takes that declaration away.

### The file

```json
{
  "format": "ftc-simbench.jointsheet",
  "version": 1,
  "robot": "REVIVER",
  "exact": true,
  "joints": [
    { "joint": "revolute_1_179", "drive": "servo", "devices": ["kickerL"], "limits": [0, 90], "at": [161, 116, 125] },
    { "joint": "revolute_2_13",  "drive": "motor", "devices": ["turret"], "rev": true },
    { "joint": "slider_2",       "drive": "follow", "follows": "liftL", "ratio": 2 },
    { "joint": "revolute_4",     "drive": "none" }
  ]
}
```

| Field | |
| --- | --- |
| `joint` | The export's joint name. Onshape's own spelling (`Revolute 2`) finds the same joint. |
| `drive` | `motor`, `servo`, `crservo`, `follow`, `free`, `fixed`, or `none` (takes away a mate name's declaration). |
| `devices` | The code's device names (configuration names). |
| `follows`, `ratio` | For `follow`: the leader's device (or joint) and the ratio, 1 if left out. |
| `rev` | The device's positive direction is the mate's negative one (for `follow`: turns the other way). |
| `limits` | `[lo, hi]` in degrees for a turn, millimetres for a slide; `null` for an open end. Replaces the mate's limits. |
| `restPos`, `gear`, `mmPerTick` | As in a joint spec: the servo position the CAD was drawn at, output turns per joint turn, millimetres per encoder tick. |
| `at` | Where the joint's pivot was, mm in the robot frame. Written by the page. A mate in a subassembly used many times is numbered by copy, and adding a servo can renumber them; an entry whose joint has moved more than 15 mm finds the copy of the same mate that sits where it was, and says so, instead of landing on another servo. |
| `exact` | `false` to annotate a few joints and leave the rest worked out. |

## What changes on the page

- The import card's joints fact reads **"6 joints · declared, nothing guessed"** when declared, and
  **"19 joints · picked from 356 mates"** (in amber) when they were worked out.
- In exact mode the card's questions come from the declarations, each with **Open the joint
  sheet**, **Copy "motor intake"** (the mate name to type) and **It moves nothing drawn**.
- The robot check's first line says where the joints came from, and offers **Declare the joints**
  when they were picked rather than declared. In exact mode, pairing a device or removing a joint
  from the robot check edits the joint sheet, not a joint spec.

A joint spec made in the CAD view's editor (src/jointspec.js) still replaces the joints entirely;
a sheet only annotates the export's own joints.

## Tested, and not yet

- `tests/jointsheet.test.mjs` (10 tests): the name grammar as typed and as exported, mapping an
  export name back to the Onshape mate, the mate name to type round-tripping, exact mode on an
  export built the way Onshape writes one, limits, `rev`, `follow`, one device on two mirrored
  joints, binding by declaration only (a device that would have matched by name is a question
  instead), the checks' wording, the sheet applied, re-applied and overridden, `none`, and a
  renumbered copy found by its pivot.
- REVIVER, with four mates renamed in the URDF text (turret, flywheel, spindexer, hood) and a
  two-line sheet for the kicker servos: 19 picked joints became 6 declared ones with 350 held, and
  all six devices of a made-up OpMode bound by declaration. The spindexer servo was flagged for
  having no range.
- **Not yet:** a real Onshape export with renamed mates (see above), and the joint sheet card in a
  browser.

## Where it lives

| File | |
| --- | --- |
| `src/jointsheet.js` | The grammar (`jointTag`), the sheet (`applyJointSheet`, `mergeJointSheets`, `clearJointSheet`), binding (`sheetBindings`), the checks (`checkJointSheet`), `tagFor`, `onshapeMateName`, `isExact`. Pure data, runs in Node. |
| `src/mates.js` | Reads the mate-name declarations after every mates import, URDF or API. |
| `src/bind.js` | `classifyJoints` and `bindDevices` in exact mode. |
| `src/robotcheck.js` | The "where the joints came from" line. |
| `src/importflow.js`, `src/app.js`, `src/styles.css` | The joint sheet card and its actions. |
