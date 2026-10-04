# Getting a robot in, and knowing it is right

A team should be able to bring its robot in without reading anything, and the bench should
promise it is right, or say exactly what it can't be sure of. One card over the field does both.
It always says the one thing to do next, and it goes away when there is nothing left.

## 1. Bring the robot: paste the Onshape link

In Onshape, open the robot's **Assembly** tab (not a Part Studio) and copy the address bar. Paste
it on the card and click **Get my robot**. The first time, Onshape asks you to let SimBench **read**
your documents; click **Allow**. That is all.

SimBench then reads the assembly from Onshape's own API (`src/onshapelink.js`, through the sign-in
relay in `functions/onshape/`, in a Web Worker so the page keeps drawing):

| From Onshape | In the bench |
|---|---|
| the assembly definition: every part, where it sits, and every mate | each **Revolute**, **Slider** and **Cylindrical** mate is a joint with its exact axis and pivot (`src/mates.js`); parts joined by **Fastened** mates, in a mate group, or inside a sub-assembly with nothing moving in it collapse into one rigid link, so 700 parts become a handful of links |
| the assembly's features | each mate's **limits** (zMin/zMax, the turn's min and max) and its **relations**: a gear pair, a rack, a cascade's stages |
| each Part Studio's tessellated faces, once per studio | every part's shape in its colour, thinned to a low-poly mesh (`src/meshfiles.js`) and drawn as one instance per occurrence, so a robot made of 264 wheel parts costs 66 shapes |
| each Part Studio's mass properties | every part's mass, centre of mass and inertia tensor as Onshape computes them, summed per rigid link with the parallel-axis shift (`onshapeLinks` in `src/onshapecad.js`); a part with no material carries its exact volume and is weighed at the density its kind implies |

Nothing is exported, nothing is installed, and the robot is never stored on our side: it goes from
Onshape to your browser. Changed the robot in Onshape? Click **Get my robot** again.

No link to paste (a plain static copy of SimBench, or a robot in Fusion, SolidWorks or FreeCAD)?
Open **Drop the export instead** on the same card: in Onshape, right-click the Assembly tab,
**Export**, format **URDF**, geometry **GLB**, resolution **Medium**, and drop the zip. A URDF from
another CAD package drops in the same way as a zip ([tools/fusion](../tools/fusion/README.md) writes
one from Fusion), and so does a plain STEP, with its joints found from the geometry instead.

## 2. The Sim-ready CAD standard

Perfect code can't fix an assembly that doesn't say what the robot is. Two habits make a robot
import flawless, and they are good CAD habits anyway:

1. **Make a "Sim" configuration.** In the assembly, add a configuration (the **Configurations**
   panel) named `Sim` in which every piece of hardware is **suppressed**: screws, nuts, washers,
   zip ties, rivets, standoffs that carry nothing. Open the assembly in that configuration before
   you copy the address; the address then carries `?configuration=…`, and SimBench reads the
   assembly in it. Suppressed parts are never fetched, so the robot is lighter to read and to draw,
   and no z-fighting washers.
2. **Mate sub-assemblies, not parts.** Build each mechanism as its own sub-assembly (the intake, the
   arm, the lift stage, the claw) and mate the sub-assemblies to each other: the intake assembly's
   pivot to the arm assembly, not an intake plate to an arm extrusion. A sub-assembly with nothing
   moving inside it is one rigid link, exactly. Mates between loose parts work too, but every
   loose part is a chance to leave one unmated, and an unmated part rides with the chassis.

And two things that make the robot *exact* rather than *right most of the time*
([exact-joints.md](exact-joints.md)):

3. **Name the mates that are mechanisms.** Rename the mate (double-click it in the mate list) to
   what drives it, in the words your code uses: `motor armMotor`, `servo claw`, `crservo intake`,
   `follow liftL x2`, `free`, `fixed`. Every library bearing and motor shaft arrives as a mate too;
   a named mate is a mechanism, and once one is named nothing else is guessed.
4. **Set materials.** A part with a material has an exact mass, centre of mass and inertia tensor.
   A part without one is weighed by its volume at a guessed density.

Switch **limits** on in each mate that has them (the slider's travel, the arm's swing): the bench
reads them as the joint's travel.

## 3. Add the code

Drop the `.java` OpModes and helper classes (or a zip of the TeamCode folder), or paste the
team's GitHub repository. The code runs as written on the Java VM.

## 4. The review

With both in, the card shows what the bench worked out as facts, and the little it couldn't:

| Fact | Where it came from |
|---|---|
| up and front | the drive wheels: up from the ones that stand on the floor, front from the way they roll |
| drive base | the wheels' kind, size, track and wheelbase; or "set it by numbers" when the CAD has no wheels |
| joints | exact from the mates; declared when the mates are named; found from the geometry on a plain STEP |
| devices tied to joints | the mate names when they declare it; otherwise `bindDevices`: the device's name against the mate, part and sub-assembly names and FTC synonyms; the kind of actuator sitting on the joint's axis; `RUN_TO_POSITION` targets that reach exactly one slide's length; the second motor of a pair; and, last, the only device of its kind left for the only joint that takes it |
| weight | Onshape's mass properties, summed; a recognised vendor part keeps its published weight |

What's left is a question in the team's own names: *"Which part does `wrist` move?"* with the
candidate joints as buttons (each **show**s the joint moving in the CAD view) and **this one** to
answer, or **Click it in the CAD view** to make a joint from the part, or **It moves nothing
drawn** to keep the device as a live gauge. The robot check's own questions (a joint that moves no
parts, a servo sent where the joint can't go, a mecanum wheel drawn the wrong hand) appear in the
same list. **Looks right** closes the card; **Save setup** writes one file a teammate can drop in
with the robot to get the same setup.

Every answer is kept with the robot: in this browser for its name, and in the setup file. It is
asked once.

## When nothing is asked

On GearGurus 7832's 773-part robot with the team's TeleOp and no hand-written joint spec, all
eleven devices bind (nine by name, one as the second motor of a pair, one by elimination) and
the card says **Ready to drive**. `tests/import-zip.test.mjs` holds that, and the synthetic
Onshape export it also checks: a two-stage lift, a two-gear claw and a motor shaft, every device
bound, the shaft set aside, the stages and fingers coupled. `tests/onshapelink.test.mjs` holds the
link route on the `mated` corpus robot: each Part Studio read once, every part a placed copy of
one shape, the mates the joints, the links' mass properties the parts' own, summed.

## What the export route still corrects

Onshape's URDF export carries a few things the reader has to correct (all seen on a real robot's
export; the link route has none of them, because it reads the assembly itself):

- every library bearing and motor comes with a joint (a real robot came out with 113); `src/bind.js`
  marks those **internal** from what they carry and never asks about them;
- mate relations are dropped, so a cascade lift comes as independent slides and a two-gear claw as
  two turns; `src/urdf.js` infers the obvious couplings as *hints*, applied when the code drives the
  leader and nothing drives the follower;
- every part of a rigid body is one link; each part is read as its own solid, named after its mesh;
- parts never mated to anything hang off the root; one sitting clear of the robot is left off;
- parts with no material weigh their volume (the exporter writes them at a density of 1).

## Under Advanced

The Robot tab keeps everything else out of the way under **Advanced**: the joints' status and the
files that set them (a joint sheet, a joint spec, a setup file), the joint finder, the drawn-parts
settings (up, front, a drawn drive base or shooter), the hardware map table, the Control Hub
configuration XML and the kinematic rig.
