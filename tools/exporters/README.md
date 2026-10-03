# Exporters: getting a robot out of a CAD tool with its joints

SimBench reads a robot's joints exactly from Onshape (its mates), from a URDF, from an MJCF, or
from a robot package (`.simbot`). These scripts are for teams on other CAD tools.

| CAD | Route | Status |
| --- | --- | --- |
| Onshape | **Get my robot from Onshape** in SimBench, or [onshape-to-robot](https://onshape-to-robot.readthedocs.io) to MJCF or URDF | Built in |
| Fusion | `fusion/ExportToSimBench`: an MJCF with STL meshes, joints, limits and masses; loops become `<connect>` | Written against the Fusion API reference, **not yet run in Fusion** |
| Fusion | [ACDC4Robot](https://github.com/bionicdl-sustech/ACDC4Robot) to URDF or MJCF (needs a flat component tree) | Third party |
| SolidWorks | Save As GLB for the shapes, joints in SimBench's joint editor; or sw_urdf_exporter to URDF | Third party |
| Any | STEP, joints found from the geometry and checked in the robot check | Built in |

## Fusion: Export to SimBench

1. In Fusion: **Utilities → Scripts and Add-Ins**, the green **+** next to My Scripts, and pick the
   `tools/exporters/fusion/ExportToSimBench` folder.
2. Open the robot's design, select **ExportToSimBench**, and **Run**. Pick a folder.
3. Drop the `.mjcf.xml` and the `meshes` folder together on SimBench.

What it reads: every joint and as-built joint, rigid joints and rigid groups (glued into one body),
revolute, slider and cylindrical joints (with their limits, measured from where the design is drawn),
the grounded component as the chassis, each body's mass, and each component's shape in the design's
own frame. Pin-slot, planar and ball joints are listed and left out. Name each driven joint exactly as
its device's configuration name and SimBench binds it by itself.

If something goes wrong, the message box shows the error. Please send it, with the Fusion version.
