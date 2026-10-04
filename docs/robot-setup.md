# Getting a robot in, and knowing it is right

A team should be able to bring its robot in without reading anything, and the bench should
promise it is right, or say exactly what it can't be sure of. One card over the field does both.
It always says the one thing to do next, and it goes away when there is nothing left.

## 1. Bring the robot: two steps in Onshape

In Onshape, right-click the robot's **Assembly** tab at the bottom, **Export**, format **URDF**,
geometry **GLB**, resolution **Fine**, compression off. A zip downloads. Drop it on SimBench.

What arrives, with nothing to answer:

| From the export | In the bench |
|---|---|
| every mate (revolute, slider, cylindrical, fastened) | an exact joint, with its axis, pivot and travel limits |
| every part's mesh and appearance | the part, in its colour |
| the mass properties | each part's mass; the robot's weight, centre of mass and inertia |

Nothing is uploaded and nobody signs in: the zip is read on the computer, in a Web Worker, so
the page keeps drawing. It works on school Chromebooks. A URDF from Fusion, SolidWorks or FreeCAD
drops in the same way ([tools/fusion](../tools/fusion/README.md) writes one from Fusion), and so
does a plain STEP, with its joints found from the geometry instead.

Onshape's export carries two things wrong, and the bench corrects both:

- **Every library bearing and motor comes with a mate.** A real robot came out with 113 joints,
  most of them a shaft or a race turning on its own. `src/bind.js` marks those **internal** from
  what they carry (a body under 45 mm, or only hardware words: bearing, shaft, spacer, hub) and
  never asks about them. The review says how many it set aside.
- **Mate relations are dropped.** A cascade lift comes as three independent slides, a two-gear
  claw as two independent turns. `src/urdf.js` infers the obvious couplings as *hints* (stages
  along one axis extend together; two revolutes on one parent with parallel axes 5–80 mm apart
  mirror each other) and applies them only when the code drives the leader and nothing drives the
  follower. The review says which followed what.

## 2. Add the code

Drop the `.java` OpModes and helper classes (or a zip of the TeamCode folder), or paste the
team's GitHub repository. The code runs as written on the Java VM.

## 3. The review

With both in, the card shows what the bench worked out as facts, and the little it couldn't:

| Fact | Where it came from |
|---|---|
| up and front | the drive wheels: up from the ones that stand on the floor, front from the way they roll |
| drive base | the wheels' kind, size, track and wheelbase; or "set it by numbers" when the CAD has no wheels |
| joints | exact from the export, or found from the geometry |
| devices tied to joints | `bindDevices`: the device's name against the mate, part and subassembly names and FTC synonyms; the kind of actuator sitting on the joint's axis (a servo never lands on a motor's joint); `RUN_TO_POSITION` targets that reach exactly one slide's length; the second motor of a pair; and, last, the only device of its kind left for the only joint that takes it |
| weight | the export's masses, or the CAD's materials |

What's left is a question in the team's own names: *"Which part does `wrist` move?"* with the
candidate joints as buttons (each **show**s the joint moving in the CAD view) and **this one** to
answer, or **Click it in the CAD view** to make a joint from the part, or **It moves nothing
drawn** to keep the device as a live gauge. The robot check's own questions (a joint that moves no
parts, a servo sent where the joint can't go, a mecanum wheel drawn the wrong hand) appear in the
same list. **Looks right** closes the card; **Save setup** writes one file a teammate can drop in
with the robot to get the same setup.

Every answer is kept with the robot: in this browser for its file name, and in the setup file.
It is asked once.

## When nothing is asked

On GearGurus 7832's 773-part robot with the team's TeleOp and no hand-written joint spec, all
eleven devices bind (nine by name, one as the second motor of a pair, one by elimination) and
the card says **Ready to drive**. `tests/import-zip.test.mjs` holds that, and the synthetic
Onshape export it also checks: a two-stage lift, a two-gear claw and a motor shaft, every device
bound, the shaft set aside, the stages and fingers coupled.

## Under Advanced

The Robot tab keeps everything else out of the way under **Advanced**: the Onshape mates read
live (with gear and rack relations the export leaves out), the joint spec and the joint finder,
the drawn-parts settings (up, front, a drawn drive base or shooter), the hardware map table, the
Control Hub configuration XML, the kinematic rig and the portable rig document.
