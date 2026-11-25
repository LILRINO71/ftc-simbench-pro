# Export to SimBench, from Fusion

Onshape exports URDF by itself. Fusion doesn't, so this script does the same job: it writes the
open design as `robot.urdf` with one OBJ mesh per rigid body (colours kept), and zips it. Drop
the zip on SimBench and the robot arrives with its joints, limits, masses and colours.

## Install, once

1. Download this folder (`ExportToSimBench`, the `.py` and the `.manifest` together).
2. In Fusion: **Utilities → Add-Ins → Scripts and Add-Ins**. On the **Scripts** tab click the
   green **+** and choose **Script or add-in from device**, then pick the folder.

## Run

Open the robot design, go back to **Scripts and Add-Ins**, select **ExportToSimBench**, **Run**.
Pick a folder. In about half a minute it writes `robot.urdf`, `meshes/`, and
`<design>.simbench.zip`. Drop the zip on SimBench.

## What it reads

| Fusion | SimBench |
|---|---|
| Joints and as-built joints: revolute, slider, rigid (cylindrical counts as revolute) | joints, with their axis and origin |
| Joint limits (`rotationLimits`, `slideLimits`) | the joint's travel |
| Rigid groups | one body |
| Motion links (`Joint.motionLinks`) | a `mimic`: a gear pair or a cascade stage follows its leader at the ratio |
| Physical properties per occurrence | the body's mass and centre of mass |
| Appearance (`opaque_albedo`) | the body's colour |

Lengths are converted from Fusion's centimetres to URDF's metres. The base link is the body no
joint moves; a body no joint reaches is fixed to it. Components Fusion hides (light bulb off) are
left out.

Needs Fusion with Python 3.12 or newer (every release since 2024). The script never changes the
design.
