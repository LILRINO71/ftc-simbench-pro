# CAD export routes and file formats that carry robot joints (non-Onshape FTC teams)

Research date: 2026-10-02. Scope: how a static browser app (FTC SimBench Pro, three.js-style viewer, no server) can receive a whole FTC robot with joints (axis, origin, type, limits, parent/child), part names, colours and ideally mass from CAD tools other than Onshape; plus FTC CAD market share. Repo check: `src/` currently has no URDF, glTF or MJCF code (grep for `urdf|gltf|GLTFLoader|mjcf` returned 0 hits), so every route below is new work.

Note on source quality: GitHub READMEs and vendor docs were fetched directly where possible. Several Autodesk Fusion API pages returned 404 at their old `cloudhelp` URLs (the API help appears to have moved), and the Autodesk FIRST page returned 403, so some Fusion API and licensing details below rest on search snippets and are marked as such.

## 1. Autodesk Fusion (Fusion 360): API joint data, existing exporters, and a "Export to SimBench" add-in

### Takeaway
Fusion is the strongest non-Onshape route. Its API exposes joints and their limits. At least two maintained, MIT-licensed add-ins already export URDF/SDF/MJCF with joints, mass and inertia: ACDC4Robot (116 stars, on the Autodesk App Store and GitHub, but it needs a flat component tree) and the Adriaeik/fusion2URDF fork (handles nested assemblies and rigid groups, but is aimed at ROS 2 and is small, 19 stars). A small SimBench-specific Fusion script that writes one JSON file plus a GLB/OBJ is feasible, and would avoid ROS packaging and naming rules that trip up students.

### Cited Findings
**Fusion API (joint data)**
- `RevoluteJointMotion.rotationLimits` returns a `JointLimits` object (read-only property) used to "get, set, and modify the joint limits". [Autodesk API: RevoluteJointMotion.rotationLimits](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/RevoluteJointMotion_rotationLimits.htm)
- `JointLimits` has `isMinimumValueEnabled`/`isMaximumValueEnabled`, `minimumValue`/`maximumValue` and a resting-state value. Units are **centimetres or radians** depending on whether the joint is a distance or an angle. [Autodesk API: JointLimits](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/JointLimits.htm); [JointLimits.minimumValue](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/JointLimits_minimumValue.htm)
- `CylindricalJointMotion.rotationLimits` also exists, so cylindrical joints carry limits too. [Autodesk API: CylindricalJointMotion.rotationLimits](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/CylindricalJointMotion_rotationLimits.htm)
- Fusion's own UI supports nested rigid groups and joints inside sub-assemblies (users discuss nesting them). [Autodesk Community: Nested Rigid Groups / Joints](https://forums.autodesk.com/t5/fusion-design-validate-document/nested-rigid-groups-joints/td-p/11768552)

**Existing exporters**
- **syuntoku14/fusion2urdf (original):** "nested components are not supported; each component should contain only bodies". There is an open issue asking whether it supports rigid groups. [deepwiki summary of syuntoku14/fusion2urdf](https://deepwiki.com/syuntoku14/fusion2urdf); [Issue #44 "Does the exporter support rigid groups?"](https://github.com/syuntoku14/fusion2urdf/issues/44)
- **vipzms/fusion2urdf-ros2:** a ROS 2 port that still does not support nested components. [GitHub vipzms/fusion2urdf-ros2](https://github.com/vipzms/fusion2urdf-ros2) (via search snippet)
- **newtonjeri/fusion2urdf-master:** a fork that added nested-component support, with ROS 1 and 2 output. [GitHub newtonjeri/fusion2urdf-master](https://github.com/newtonjeri/fusion2urdf-master) (via search snippet)
- Other forks seen: screamlab/fusion2urdf-ros2, runtimerobotics/fusion360-urdf-ros2, nilutpolkashyap/fusion2urdf, and cadop/fusion360descriptor. [deepwiki screamlab](https://deepwiki.com/screamlab/fusion2urdf-ros2); [deepwiki runtimerobotics](https://deepwiki.com/runtimerobotics/fusion360-urdf-ros2); [GitHub nilutpolkashyap/fusion2urdf](https://github.com/nilutpolkashyap/fusion2urdf); [science.ecosyste.ms entry for fusion360descriptor](https://science.ecosyste.ms/projects/164829)
- **Adriaeik/fusion2URDF (v3.1, MIT, 19 stars):**
  - Behaviour: nested assemblies become hierarchical xacro macros, and it has been "tested on nested assemblies five layers deep". A Fusion Rigid Group of several components becomes one URDF link with a merged mesh, summed mass and combined inertia. It "preserves as-built joint types, axes, and limits". It exports loop-closing joints to `robot_data.yaml`, and "writes the full inertia tensor at the centre of mass for every link".
  - Output: a flat URDF, DAE/OBJ visual meshes with colours, and STL collision meshes.
  - Install: clone the repo and add it as a Fusion script.
  - [GitHub Adriaeik/fusion2URDF](https://github.com/Adriaeik/fusion2URDF)
- **ACDC4Robot (MIT, 116 stars, v1.1.1 stable, v1.2.0 in development):**
  - Formats: URDF, SDFormat, MJCF and an experimental "URDF+".
  - Joint types: rigid, revolute and slider. As-built joints are supported. "A joint cannot connect directly to Fusion root/ground."
  - Structure rules: it needs "a flat top-level occurrence structure", and "nested occurrences, surface-only components, and mesh-only components fail the MJCF preflight". Component names must use only alphanumerics, `_` or `-`, and the design must form "one tree".
  - Not covered: users must add actuators, joint dynamics and collision geometry downstream ("does not infer them from CAD").
  - Install: GitHub Releases (recommended; copy the `Add-IN/ACDC4Robot` folder into Fusion's Add-Ins directory) or the "legacy" Autodesk App Store.
  - Sources: [GitHub bionicdl-sustech/ACDC4Robot](https://github.com/bionicdl-sustech/ACDC4Robot); [ROS Discourse announcement](https://discourse.openrobotics.org/t/acdc4robot-a-new-tool-for-robot-description-formats/38534); [Autodesk Marketplace listing](https://marketplace.autodesk.com/apps/88e15030-3cbf-4c87-9ff8-b7df4a7a1ba6)
- ACDC4Robot's own rationale for its formats: URDF is the most widely used but limited; SDFormat supports closed-loop chains; MJCF is MuJoCo's format and is also supported by other simulators such as Isaac Sim. [GitHub ACDC4Robot](https://github.com/ACDC4Robot/Fusion360) (via search snippet)

**Fusion native mesh export**
- Exports available on all licence types: 3MF, F3D, Inventor (IAM/IPT), FBX, OBJ, SketchUp, STEP, STL and **USD (`*.usdz`)**. DWG, Alias and Eagle exports are excluded on Personal Use. Fusion has no native glTF export; glTF needs a third-party plugin. [Autodesk Fusion: Supported file formats](https://help.autodesk.com/cloudhelp/ENU/Fusion-Designs/files/TPD-SUPPORTED-FILE-FORMATS.htm)

**Licensing for FTC**
- FIRST's FTC sponsor page lists Autodesk as providing "Autodesk CAD software (including Fusion 360, Inventor, 3ds Max, and more…)" with no access codes required. [FTC Docs: Complimentary Software Sponsors](https://ftc-docs.firstinspires.org/en/latest/sponsors/software/software.html)
- Autodesk is described as a "Crown Supplier to the 2026 FIRST Robotics Competition, providing free access" to its CAD/CAM/CAE software. Fusion is "free for education" on PC, Mac and Chromebook. [Autodesk Education: FIRST](https://www.autodesk.com/education/competitions/first) (page returned 403 to the fetcher; text from a search snippet); [Autodesk Fusion for education](https://www.autodesk.com/in/education/edu-software/fusion)
- Forum threads describe friction for FIRST teams that are not tied to an accredited school (licence eligibility). [Autodesk forum: Fusion 360 for FIRST Robotics team](https://forums.autodesk.com/t5/fusion-support-forum/fusion-360-for-first-robotics-team/m-p/13098816)

### Inferences
- **Install effort for a student:**
  - App Store install of ACDC4Robot is about 2 minutes, but its flat-tree rule fails on a typical FTC robot built from nested sub-assemblies (drivetrain, lift, intake), so students would have to restructure the design.
  - Adriaeik/fusion2URDF handles real structure but needs a git clone or zip and a "Scripts and Add-Ins → +" step, about 3–5 minutes for a first-timer, and it writes a whole ROS 2 package, which is more than SimBench needs.
  - Neither is tuned for FTC (no motor/servo port names, no cascade/gear coupling).
- **Recommendation: ship our own "Export to SimBench" Fusion Python script (MIT, GitHub zip first).**
  - What it reads:
    - Walks `rootComponent.allOccurrences` for names, colours (appearance), and mass and centre of mass (physical properties).
    - Walks `allJoints` + `allAsBuiltJoints` for type, `occurrenceOne/Two`, the joint origin and axis, and `jointMotion.*Limits`.
    - Treats rigid groups as one body.
  - What it writes: one `.simbench.json` that maps onto the existing `ftc-sim-bench.joints` / `cad.mates` convention (`fromMate`, `axis`, `pivot`, `limits`; cm converted to m), plus geometry as OBJ, or STEP that SimBench already parses.
  - Distribution: as a Fusion **script** (not an add-in) it installs with Utilities → Scripts and Add-Ins → "+" → pick the folder, then Run. That avoids App Store review delays. An App Store listing can come later for discoverability (ACDC4Robot shows both channels work, and calls the App Store channel "legacy").
- Fusion's USDZ export is a possible zero-install route for named and coloured geometry. Whether it includes joints (UsdPhysics) is unverified (see Gaps).
- Fusion `Joint` objects attach to a `JointGeometry` or `JointOrigin` through `geometryOrOriginOne/Two`. As-built joints are positioned in place without moving components. This is from training knowledge; the API pages 404'd, so check it against the current API reference before coding.

### Gaps
- The Fusion API pages for `Joint`, `AsBuiltJoint` and `Joint.geometryOrOriginOne` returned 404 at `help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/*.htm`, so property names (`occurrenceOne`, `jointMotion`, `geometry`, `isFlipped`, `timelineObject`) were not re-confirmed this session.
- Not checked: Fusion2PyBullet or any fusion-to-MJCF tool other than ACDC4Robot.
- Not checked: whether fusion2urdf forks handle Fusion's "Motion Link" (coupled joints), which is how cascades and gears are modelled.
- No confirmed 2025–2026 Autodesk policy text on FTC eligibility (the Autodesk FIRST page returned 403). The "Crown Supplier 2026" wording comes from a search snippet about FRC.
- Unknown whether Fusion's `.usdz` export writes any joint or physics schema.

## 2. SolidWorks: sw_urdf_exporter, mates via API, glTF export, education access

### Takeaway
SolidWorks has a mature URDF exporter (sw_urdf_exporter). It derives joints from the assembly tree, but the user still has to build the link tree by hand in a dialog, and it is Windows-only and tied to specific SolidWorks versions. A better zero-install route for geometry is SolidWorks' native "Extended Reality" glTF/GLB export, which keeps appearances, configurations and motion studies but not kinematic joints. FTC teams get SolidWorks through the Dassault sponsorship.

### Cited Findings
- **sw_urdf_exporter:**
  - It is a SolidWorks add-in. For assemblies it will "build the links and create a tree based on the SW assembly hierarchy" and "can automatically determine the proper joint type, joint transforms, and axes".
  - Tested on Windows 10 64-bit with SolidWorks 2018 SP5. It "may not work with versions earlier than SolidWorks 2018", and 2018 has a known STL export bug before SP5.
  - It is community-maintained on GitHub, after moving from BitBucket.
  - Sources: [ROS wiki mirror: sw_urdf_exporter](https://mirror.umd.edu/roswiki/sw_urdf_exporter.html); [SolidWorks partner product page](https://www.solidworks.com/partner-product/solidworks-urdf-exporter)
- EPFL's SW2URDF instruction PDF documents the manual step-by-step link and joint configuration workflow. [EPFL BioRob SW2URDF instructions (2019)](https://www.epfl.ch/labs/biorob/wp-content/uploads/2019/02/SW2URDF_instructions.pdf) (older; not fetched in full)
- **SolidWorks native glTF/GLB:**
  - File → Save As → "Extended Reality (*.gltf)" or "(*.glb)".
  - The files contain "geometry, appearances, textures, animations, motion studies, configurations, display states, exploded views, lights, and metadata", with Draco compression supported.
  - Documented for 2019 through 2025.
  - Sources: [SolidWorks 2025 Help: Exporting Using Extended Reality](https://help.solidworks.com/2025/English/SolidWorks/sldworks/t_export_using_extended_reality.htm); [SolidWorks 2024 What's New](https://help.solidworks.com/2024/English/WhatsNew/c_wn2024_export_exporting_extended_reality.htm)
- **Access for FTC:** Dassault Systèmes provides "SOLIDWORKS and the 3D EXPERIENCE Platform" to FTC teams ("Access codes coming soon" on the current page). [FTC Docs: Complimentary Software Sponsors](https://ftc-docs.firstinspires.org/en/latest/sponsors/software/software.html)
- An FTC community doc describes SolidWorks as "Professional-grade tool, available through FIRST grants, extreme learning curve". [FTC Community Docs: CAD Overview](https://www.firstcommunitydocs.com/cad/overview/)

### Inferences
- Joint setup burden: sw_urdf_exporter requires the user to assign every link, its parent, a joint type and (usually) a reference axis and coordinate system in the "URDF Exporter" property manager. For a 50+ part FTC robot that is well over 5 minutes. That is from training knowledge and the EPFL PDF title; the ROS wiki page does not spell it out.
- Best SolidWorks route for SimBench:
  - Use GLB via Save As for names, colours and hierarchy (zero install).
  - Add joints by one of two means:
    - (a) SimBench's existing hand-written joint spec / joint editor, keyed to GLB node names; or
    - (b) a small SolidWorks VBA/C# macro that reads mates through the API (`IMate2`, `MateEntity2` on concentric/distance/limit mates) and writes the same `.simbench.json`.
  - A macro (`.swp`) runs from Tools → Macro → Run with no add-in install, which fits a 5-minute budget.
- The motion studies inside SolidWorks glTF are keyframed node animations, not joint definitions. With care, the axis and range of a revolute part could be inferred from a motion-study animation, but that is fragile.

### Gaps
- The sw_urdf_exporter GitHub repo (latest release, SolidWorks 2023/2024/2025 support, open issues) was not fetched.
- The SolidWorks mate API and its read-out of limit mates were not verified this session.
- Not verified whether SolidWorks glTF export writes node names from component names and per-part materials (likely, but unconfirmed).

## 3. Autodesk Inventor and FreeCAD

### Takeaway
Inventor has no prominent maintained URDF/joint exporter (none found). FreeCAD 1.0 has a native Assembly workbench with joints and limits, and the CROSS workbench exports URDF/xacro from FreeCAD. A FreeCAD → SimBench route is possible but serves a very small FTC user base.

### Cited Findings
- Searching for an Inventor URDF exporter returned only SolidWorks, Fusion and Onshape exporters. [Search results incl. onshape-to-robot docs](https://onshape-to-robot.readthedocs.io/en/stable/_sources/exporter_urdf.rst.txt)
- Inventor is included in Autodesk's FTC sponsorship (with Fusion and 3ds Max). [FTC Docs: Software Sponsors](https://ftc-docs.firstinspires.org/en/latest/sponsors/software/software.html)
- Fusion can export to Inventor formats (`.iam/.ipt`), which shows the two tools interoperate. [Fusion supported file formats](https://help.autodesk.com/cloudhelp/ENU/Fusion-Designs/files/TPD-SUPPORTED-FILE-FORMATS.htm)
- **FreeCAD 1.0 Assembly workbench:** built by the Ondsel team. Users insert parts as links, ground one part, "connect parts with joints, set offsets and limits, and then test the motion". 1.0 also added an "Export ASMT File" command (the Ondsel solver format). [LibreArts: FreeCAD 1.0](https://librearts.org/2024/11/freecad-1-0/); [Ondsel: Assembly workbench preview](https://www.ondsel.com/blog/assembly-workbench-preview/); [FreeCAD wiki: Assembly ExportASMT](https://wiki.freecad.org/Assembly_ExportASMT/en)
- **CROSS (galou/freecad.cross):** a FreeCAD workbench that generates ROS URDF/xacro and imports/exports URDF. It is installed through the Addon Manager (custom repository) and needs FreeCAD 0.21.2 or later. A fork, **freecad.overcross**, also exists. [GitHub galou/freecad.cross](https://github.com/galou/freecad.cross); [GitHub drfenixion/freecad.overcross](https://github.com/drfenixion/freecad.overcross)
- Older: freecad_to_gazebo exporter. [GitHub Dave-Elec/freecad_to_gazebo](https://github.com/Dave-Elec/freecad_to_gazebo)

### Inferences
- Inventor route: export STEP (already supported) and annotate joints in SimBench's joint editor. Alternatively, an Inventor iLogic/VBA macro could read `AssemblyJoints` (Inventor's joint objects, which carry type and limits) into `.simbench.json`. That is from training knowledge and was not verified.
- FreeCAD route: as of the sources found, CROSS builds its own robot/link/joint objects and does not automatically translate Assembly-workbench joints, so a student would set joints up twice. A FreeCAD macro (Python) reading `Assembly` `JointObject`s would be the cleaner route if demand appears.
- A2plus and Assembly4 were not researched; with 1.0's built-in Assembly they are lower priority.

### Gaps
- Not verified: Inventor's API for joints vs constraints, and any Inventor → URDF or MJCF tool.
- Not confirmed: whether CROSS (2025–2026 versions) reads FreeCAD 1.0 Assembly joints directly.
- No data on how many FTC teams use Inventor or FreeCAD (likely very few).

## 4. Formats that carry joints (URDF, SDF, MJCF, glTF physics extensions, USD/UsdPhysics) and browser parsers

### Takeaway
URDF is the format most CAD exporters write. It has a mature three.js loader (gkjohnson/urdf-loaders) and is the pragmatic interchange target. MJCF matters if SimBench ever uses MuJoCo physics: Google DeepMind now ships official WASM/JS bindings on npm (`@mujoco/mujoco`). glTF physics (`KHR_physics_rigid_bodies`, which includes joints) is still a **Review Draft**, not ratified, and no CAD tool writes it. OMI_physics_joint is a Stage 1 proposal with only a Godot implementation. USD has browser viewers (Needle's OpenUSD WASM, three.js USDLoader), but none was found to expose UsdPhysics joints.

### Cited Findings
**URDF**
- gkjohnson/urdf-loaders provides "URDF loading code in C# for Unity and Javascript for THREE.js". It has an Apache 2.0 licence, about 819 stars, 222 forks and 972 commits, and NASA JPL copyright. [GitHub gkjohnson/urdf-loaders](https://github.com/gkjohnson/urdf-loaders)
- Exporters that write URDF: fusion2urdf family, ACDC4Robot, Adriaeik/fusion2URDF (Fusion); sw_urdf_exporter (SolidWorks); CROSS (FreeCAD); onshape-to-robot (Onshape). See sections 1–3 and [onshape-to-robot docs](https://onshape-to-robot.readthedocs.io/en/stable/_sources/exporter_urdf.rst.txt).

**SDFormat**
- SDFormat "has more features than URDF, such as supporting closed loop chain mechanism". ACDC4Robot writes it. [GitHub ACDC4Robot](https://github.com/ACDC4Robot/Fusion360)

**MJCF and browser MuJoCo**
- MJCF is "used in simulator MuJoCo and has been support by more simulators such as Nvidia Isaac Sim". [GitHub ACDC4Robot](https://github.com/ACDC4Robot/Fusion360)
- Official JS/TS bindings: "The canonical JavaScript and TypeScript bindings for the MuJoCo physics engine are developed and maintained by Google DeepMind", published as `@mujoco/mujoco` on npm with prebuilt WASM. The single-threaded build "does not require special security headers", which fits static hosting such as Cloudflare Pages. [MuJoCo JS bindings README (@mujoco/mujoco 3.9.0)](https://cdn.jsdelivr.net/npm/@mujoco/mujoco@3.9.0/README.md); [google-deepmind/mujoco wasm/README](https://raw.githubusercontent.com/google-deepmind/mujoco/main/wasm/README.md)
- Community projects: zalo/mujoco_wasm (three.js demo, coordinate conversion helpers) and a React Three Fiber wrapper ("mujoco-react"). [mujoco_wasm](https://github.com/krishpop/mujoco_wasm); [three.js forum: Mujoco React](https://discourse.threejs.org/t/mujoco-react-a-react-three-fiber-wrapper-around-mujoco-js-wasm-bindings/89991)

**glTF physics extensions**
- `KHR_physics_rigid_bodies` is "Review Draft" status in the Khronos registry (PR #2424). It adds motion properties, colliders and "joints to physically connect models". [Khronos glTF extensions README](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md); [Khronos blog: glTF Now and Next](https://www.khronos.org/blog/gltf-now-and-next)
- A Blender glTF-IO issue requests support for KHR_physics_rigid_bodies and KHR_implicit_shapes, so the official Blender exporter did not have it at the time of the issue. [glTF-Blender-IO issue #2612](https://github.com/KhronosGroup/glTF-Blender-IO/issues/2612)
- The reference Blender add-on (eoineoineoin/glTF_Physics_Blender_Exporter) writes `motion` (mass) and `collider` data. It is "a work in progress", and its README names no viewer implementations. [GitHub eoineoineoin/glTF_Physics_Blender_Exporter](https://github.com/eoineoineoin/glTF_Physics_Blender_Exporter)
- The 3ds Max glTF plugin documentation references the physics extensions. [KhronosGroup glTF-3ds-Max-Plugin docs](https://github.com/KhronosGroup/glTF-3ds-Max-Plugin/blob/main/User_Documentation/EditingDocumentation.md) (search snippet only)
- `OMI_physics_joint` is a "Stage 1 Proposal" from the OMI group. It defines linear/angular limits per axis (metres/radians, min/max, stiffness, damping) and drives (motor/spring), linking a joint node to a `connectedNode`. The only implementation listed is the Godot add-on. [omigroup/gltf-extensions OMI_physics_joint](https://github.com/omigroup/gltf-extensions/tree/main/extensions/2.0/OMI_physics_joint)
- KHR_implicit_shapes did not appear in the fetched registry README listing. [Khronos glTF extensions README](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md)

**USD / UsdPhysics in the browser**
- Needle's USD viewer runs "OpenUSD 26.05 WebAssembly runtime" with a three.js Hydra render delegate and MaterialX. three.js has a built-in USDLoader that handles USDZ, with limited USDC support. `@cinevva/usdjs` is a pure TypeScript USDC parser. None of these sources mention UsdPhysics joints. [Needle OpenUSD docs](https://engine.needle.tools/docs/cloud/openusd.md); [usd-viewer.needle.tools](https://usd-viewer.needle.tools); [Cinevva: Three.js + USDC in the Browser](https://app.cinevva.com/guides/threejs-usdc-tech-report)

### Inferences
- **Format ranking for SimBench import (joints in, browser-parseable, CAD tools that write it):**
  1. **URDF + meshes (zip):** broadest exporter coverage (Fusion, SolidWorks, FreeCAD, Onshape); JS loader exists; carries type, axis, origin, limits, parent/child, mass and inertia, and `mimic` for simple couplings. It cannot express closed loops (slider-crank, four-bar linkages) natively; Adriaeik's exporter puts those in a side YAML. Colours come from the meshes (DAE/OBJ+MTL) or from URDF `<material>`.
  2. **MJCF:** richer (equality constraints for loops and couplings, actuators), with an official WASM engine, but only ACDC4Robot writes it from CAD, and its flat-tree rule is limiting.
  3. **SDF:** handles loops, but has no mature JS loader (none found).
  4. **glTF + KHR_physics_rigid_bodies joints:** this is the right long-term "one file" target, but no CAD tool writes it and three.js's GLTFLoader does not interpret it (not verified; none found). SimBench could read its `extensions` JSON itself, since GLTFLoader keeps unknown extensions on `userData`/the parser JSON.
  5. **USD/UsdPhysics:** Fusion writes USDZ, but joint support is unconfirmed and browser USD runtimes are heavy WASM.
- Practical plan: accept a **URDF zip** (use urdf-loaders or a small URDF parser that maps joints onto SimBench's `cad.mates` format, with `fromMate` and `source:"urdf"`) and a **GLB + `.simbench.json` sidecar** (from our own Fusion/SolidWorks scripts). Both fit the existing `ftc-sim-bench.joints` convention.

### Gaps
- Not fetched: the KHR_physics_rigid_bodies joint schema itself (field names, limit and drive model), and whether it reached Release Candidate in 2026. The registry README fetched still says Review Draft.
- Not confirmed: whether three.js GLTFLoader, Babylon.js or any JS engine implements KHR_physics_rigid_bodies joints. Babylon.js support is plausible but unverified.
- Not checked: urdf-loaders specifics (supported mesh types STL/DAE/OBJ, `setJointValue`, mimic, limits). From training knowledge it supports these, but the fetched page did not confirm it.
- No source found for a JS SDFormat parser or a browser UsdPhysics joint reader.

## 5. Mesh formats CAD tools export that keep part names and colours, and are easy to parse in a browser

### Takeaway
GLB/glTF is the best browser format (native three.js GLTFLoader, keeps the node hierarchy, names and PBR colours). SolidWorks writes it natively; Fusion does not (it writes OBJ, 3MF, FBX and USDZ instead). OBJ+MTL and 3MF keep names and colours and have three.js loaders; STL keeps neither.

### Cited Findings
- **SolidWorks:** native GLB/glTF with appearances, configurations and metadata. [SolidWorks 2025 Help: Extended Reality export](https://help.solidworks.com/2025/English/SolidWorks/sldworks/t_export_using_extended_reality.htm)
- **Fusion:** native 3MF, OBJ, FBX, STEP, STL and USDZ on all licences; no native glTF. [Fusion supported formats](https://help.autodesk.com/cloudhelp/ENU/Fusion-Designs/files/TPD-SUPPORTED-FILE-FORMATS.htm)
- **Third-party converter:** CAD Exchanger offers SLDASM → GLB conversion (commercial). [CAD Exchanger: SLDASM to GLB](https://cadexchanger.com/sldasm-to-glb/)
- **Fusion URDF exporters** write DAE/OBJ visual meshes with colours (Adriaeik) or STL (original fusion2urdf, per its README). [GitHub Adriaeik/fusion2URDF](https://github.com/Adriaeik/fusion2URDF)

### Inferences
- In practice Fusion gives OBJ (per-body named groups with MTL colours) or 3MF (names and colours per object, standard zip+XML), and three.js has OBJLoader/MTLLoader and 3MFLoader (training knowledge).
- STEP, which SimBench already parses, carries names, colours and hierarchy (AP214/AP242) and is universal. For non-Onshape tools the missing piece is joints, not geometry. So the cheapest universal route is **STEP (geometry) + a joints sidecar JSON** produced by a tool-specific script or by SimBench's joint editor.

### Gaps
- Not verified: whether Fusion OBJ/3MF exports keep component (occurrence) names vs only body names, and whether they keep appearance colours.
- Not verified: whether SolidWorks glTF node names match component names in a way stable enough to key joints on.

## 6. FTC CAD tool market share

### Takeaway
No quantitative, sourced FTC CAD market-share survey was found. Onshape (PTC) claims to be the most widely used CAD among FIRST teams, based on unspecified "informal surveys" (June 2025). All three major vendors (PTC/Onshape, Autodesk/Fusion+Inventor, Dassault/SolidWorks) give FTC teams free licences. FTC community docs list Onshape, Fusion, SolidWorks and TinkerCAD as the common tools.

### Cited Findings
- Onshape blog (2025-06-25): "Informal surveys suggest that Onshape is the most widely used CAD and PDM system among FIRST Robotics teams" and "An overwhelming number of world championship teams used Onshape". No numbers, method or survey source are given. [Onshape blog: Robot Design Tools for FIRST Robotics Teams](https://www.onshape.com/en/blog/first-robotics-cad-platform)
- Onshape/PTC provides free CAD, PDM and collaboration to all FRC, FTC and FLL teams. [Onshape: FIRST Robotics](https://www.onshape.com/en/education/first-robotics); [PTC: FIRST](https://www.ptc.com/en/education/first)
- A state FIRST affiliate (Wisconsin) advertised a grant for FIRST teams that use Onshape, an example of PTC incentives. [FIRST Inspires Wisconsin: Grant for FIRST teams that use Onshape](https://www.firstinspireswi.org/post/grant-for-first-teams-that-use-onshape)
- FTC official sponsor list: Autodesk (Fusion 360, Inventor, 3ds Max…), Dassault (SolidWorks, 3DEXPERIENCE), PTC (Creo, Onshape). [FTC Docs: Complimentary Software Sponsors](https://ftc-docs.firstinspires.org/en/latest/sponsors/software/software.html)
- FTC Community Docs list Onshape ("fully cloud-based… excellent for teams"), Fusion ("feature-dense… simple learning curve"), SolidWorks ("extreme learning curve") and TinkerCAD. Their CAD section is "currently written for Fusion only". [FTC Community Docs: CAD Overview](https://www.firstcommunitydocs.com/cad/overview/)
- Project Robotica wiki says Onshape, Fusion 360 and SolidWorks are each free for FTC teams. [Project Robotica: FTC CAD](https://projectrobotica.wiki/wiki/FTC:CAD)
- FRC proxy data (not FTC):
  - A Chief Delphi 2019 "What CAD program does your team use?" poll (options: SolidWorks, Inventor, Onshape, Creo, Other) did not render its vote counts to the fetcher.
  - Later threads say teams are moving to Onshape, with more switching after GrabCAD Workbench shut down in 2023.
  - Sources: [Chief Delphi 2019 poll](https://www.chiefdelphi.com/t/poll-what-cad-program-does-your-team-use-2019/342389); [Chief Delphi: What CAD software do people use in 2022?](https://www.chiefdelphi.com/t/what-cad-software-do-people-use-in-2022/413849); [Chief Delphi: Solidworks vs Onshape](https://www.chiefdelphi.com/t/solidworks-vs-onshape/495810)
- General industry (not FTC): CNCCookbook's hobby/small-shop survey puts Fusion 360 first and SolidWorks second, with Onshape at about 1.2% (down from 2.1%). That population differs sharply from FTC. [CNCCookbook 2024 CAD Survey](https://www.cnccookbook.com/cnccookbook-2024-cad-survey-market-share-customer-satisfaction/)

### Inferences
- Likely FTC order: Onshape > Fusion > SolidWorks > others (Inventor, TinkerCAD, FreeCAD, Creo). This is consistent with Onshape's claim, the free cloud access that suits Chromebook-heavy schools, and community docs that focus on Onshape and Fusion. **No percentage can be cited.** The report should say so rather than invent shares.
- So after Onshape (already supported via mates), **Fusion is the clear second priority**, then SolidWorks. Inventor and FreeCAD can rely on STEP + SimBench's joint editor.

### Gaps
- No FTC-specific CAD survey with numbers was found: no FIRST data, no r/FTC or FTC Discord poll surfaced in search, and gm0.org's CAD page returned 404 at the guessed URL.
- No FIRST/PTC official adoption numbers (for example, count of FTC team Onshape accounts) were found.
- An r/FTC search for a poll returned no Reddit results (Reddit may be poorly indexed by the search tool).

## 7. STEP AP242 kinematics (ISO 10303-105)

### Takeaway
The standard can carry kinematics: AP242 Edition 2 (2020) includes the ISO 10303-105 kinematics resources. No evidence was found that any mainstream CAD tool, and certainly none FTC teams use, writes kinematic STEP, and no JavaScript parser for it was found. It is not a practical route for FTC teams in 2026.

### Cited Findings
- ISO 10303-105:2019 "specifies the integrated resource constructs for Kinematics… for communication between CAD systems and kinematic analysis systems". [ISO committee page 10303-105](https://committee.iso.org/standard/78589.html)
- AP242 Edition 2 (2020) transmits "kinematics along with 3D model-based engineering information, product structure, CAD models, and composites". [ProSTEP fact sheet: ISO 10303-242](https://www.prostep.org/mediathek/fact-sheets/iso-10303-242); [Wikipedia: ISO 10303](https://en.wikipedia.org/wiki/ISO_10303)
- Dassault (CATIA) "hopes to standardize the export of information such as electrical, kinematic, and composite data" through AP242, which reads as an aspiration, not shipped support. [CADinterop: STEP](https://www.cadinterop.com/en/step.html)
- PTC's AP242 support note for Creo Elements/Direct covers AP242/ISO 10303-21:2016 import/export, with no mention of kinematics. [PTC CS254733](https://www.ptc.com/en/support/article/CS254733)

### Inferences
- SimBench's STEP parser could in principle look for `KINEMATIC_*` / `*_PAIR` entities (e.g. `REVOLUTE_PAIR`, `PRISMATIC_PAIR`) cheaply as a bonus. Expect them to be absent from Onshape, Fusion and SolidWorks exports.

### Gaps
- No confirmed list of CAD tools that write AP242 kinematics in practice (CATIA, NX and Creo were not verified). Fusion, SolidWorks, Onshape, Inventor and FreeCAD are not known to.
- No JS STEP parser with kinematics support was found (occt-import-js and similar are geometry-only, per training knowledge, not verified).

### Inferences: cross-cutting recommendation per CAD tool (synthesis of sections 1-7, for the report writer)

| CAD tool (approx. FTC rank, unsourced) | Best 5-minute route today | Joints carried | Build next |
| --- | --- | --- | --- |
| Onshape (1st) | Existing SimBench Onshape mates route | yes | (done) |
| Fusion (2nd) | ACDC4Robot (App Store) → URDF/MJCF, only if the design is a flat tree; otherwise STEP + SimBench joint editor | yes (rigid/revolute/slider, limits, mass) | **"Export to SimBench" Fusion script** on GitHub (zip → Scripts and Add-Ins → Run) writing `.simbench.json` (joints from `allJoints` + `allAsBuiltJoints`, limits in cm→m, rigid groups merged, mass/CoM) next to STEP/OBJ; plus a **URDF zip importer** in SimBench so fusion2urdf, ACDC4Robot and Adriaeik outputs all work |
| SolidWorks (3rd) | Save As GLB (names/colours) or STEP + SimBench joint editor; sw_urdf_exporter if the team is willing to set up links by hand | URDF: yes (manual setup); GLB: no | A **SolidWorks macro (.swp)** that reads mates and writes `.simbench.json`; reuse the URDF importer |
| Inventor | STEP + SimBench joint editor | no | Optional iLogic macro later |
| FreeCAD | CROSS → URDF, or STEP + joint editor | yes via CROSS | Reuse the URDF importer |
| Any | STEP AP242 kinematics | not in practice | Optional cheap scan for `*_PAIR` entities |
