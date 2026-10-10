# Handoff

The handoffs live here, the newest first. The two older ones below mention `research/fullrobots`,
`research/realcad`, `research_notes/` and `reports/`: those folders were removed on 2026-10-04 as
unused (nothing in the build or the tests read them); the measurements they held stay in the text.

## 2026-10-09: review fixes, and what the Onshape link costs

On main. A review of the 2026-10-08 online and tier commits, plus a look at the link route
against Onshape's API limits now that the OAuth app is registered (`/onshape/status` on the
live site says `ready:true`).

### What changed

- **Onshape's yearly allowance** (`functions/onshape`, `src/onshapelink.js`). A private app's
  calls all count against its owner (2,500 a year on Free or EDU Student). A spent allowance
  (402) now stops the read and sends the team to the export zip; before, every Part Studio was
  silently left out. The edge cache's access check cost a call, the same as the read it saved;
  documents Onshape says are public are now remembered for a day, so kept library parts cost
  nothing. A linked part the team can only reach through its own document is read fresh rather
  than refused. DEPLOY.md "Quota", "Listing the app in the App Store" and "School networks"
  have the numbers and the steps.
- **Online rooms** (`src/netrelay.js`, `workers/room/room.js`): an SSE stream that drops gets
  its retries; batches are sized in UTF-8 bytes and only ask for keepalive while it fits; the
  room's ledger takes a player's ticks out of order, keeps its window across hibernation,
  replays only the ticks it has, and caps a POST while reading it.
- **Device tiers**: iPad Safari (a Mac user agent with touch points) starts at tier 0, and Macs
  in Safari ("Apple GPU") at tier 2 again.

### Measured here

- `npm test`: 772 green (11 new tests, each failing before its fix). `npm run build:ship` clean.

### Still open

- The first real import through the live app hasn't been watched from here: call count and time
  on a REVIVER-sized robot, `tessellatedfaces` size, COTS colours and masses.
- A robot in a school's own Onshape enterprise (`myschool.onshape.com`) is read through
  `cad.onshape.com`; untried.
- The App Store listing (free, and exempt from the allowance) needs the owner: Developer
  Relations, the agreement, five beta testers.
- The room's ledger lives in memory; a room that hibernates keeps its window but not its history
  (a replay after that has nothing before the pause). Persisting it is for when lockstep lands.
- The WebSocket client's "dropped" branch is unreachable (a hello resets the count, and a retry
  that never gets in falls back to SSE, which reports). Harmless; left as is.

## 2026-10-04 (later): the pasted Onshape link is the way in, and the repo is swept

Branch `claude/onshape-link`, on top of `claude/exact-joints`. The owner asked for the import the
way a team thinks of it: paste the Onshape assembly's address, nothing to export.

### What changed

- **The link route is the main route** (`src/onshapelink.js`, `src/onshapecad.js`,
  `src/engineworker.js` op `onshapelink`). The import card's first state is a link box. The read
  (assembly definition, features, per Part Studio the tessellated faces and mass properties) and
  the build both run in the engine worker; same-origin cookies travel with a worker's fetch, so the
  relay (`functions/onshape/`) needs nothing new. `onshapeRef` keeps the `?configuration=` of the
  address (the Sim configuration) and the definition is read in it.
- **The robot comes out in the URDF route's shape**: `cad.shapes` (one thinned mesh per unique
  Part Studio part, `meshReduce`) and solids with `shapes:[k]` + `occT`, so `urdfExact` and the
  view's instancing draw it with no new case. Before, each occurrence carried its own full triangle
  list and the view merged them per link.
- **Exact mass properties**: `osCompactMass` keeps the centroid, the inertia tensor (nominal, about
  the centroid) and the volume; `cadFromOnshape` rotates them into the robot frame per solid
  (`s.com`, `s.I`, `s.vol`); `onshapeLinks` sums each rigid link (parallel axis) into `cad.links`
  and gives each joint `carries` (kg, com, parts). `inertiaOf` takes a part's own tensor
  (`p.I`) instead of its box; `partMass` prefers the CAD's exact volume to the hull's; `massProps`
  uses the centre and tensor whenever the part keeps the CAD's mass. A part with no material
  carries its volume as kg (density 1, what the URDF export writes) and is weighed by kind.
  Vendor figures still beat CAD mass for recognised parts.
- **Removed**: the "Send to SimBench" bookmarklet and its `#onshape=` / `#onshape-wait` paths, the
  Onshape pop-up (`OnshapeHelp`, `#osOverlay`), the manual mates panel (saved API pages, the URL
  box, `onshapeApiLinks`, `tools/onshape-mates.mjs`), loose URDF files (zip them), the legacy
  eager URDF builder (`urdfToPayload`, `cadFromUrdf`, `urdfFromZip`; `urdfRobot` is the one),
  the dock gauges that had no element, the portable-rig textarea, the turret slider, the hidden
  Support link, the dead drop veil, `DOMAIN`/`dist/CNAME`, unreferenced names (`JV_LANG`, `jvGen`,
  `SYNONYM`, `HIVE_KEEP`, `segCrossesBox`, `MESH_EXT`), six unreferenced screenshots, and the
  research folders named above.
- **Docs**: `docs/robot-setup.md` is the Sim-ready CAD standard (a Sim configuration with hardware
  suppressed; mate sub-assemblies, not parts; name the mates that are mechanisms; set materials).
  `DEPLOY.md` is the owner's checklist, with the Onshape app registration the link route needs.

### Measured here

- `npm test`: 628 green (`tests/onshapelink.test.mjs` rewritten for the link; the URDF tests moved
  to `urdfRobot`). `npm run build` 1.7 MB page, 1.1 MB engine.

### Still open

- **Nothing here has touched Onshape's real API.** The reader is checked against a stand-in built
  from Onshape's OpenAPI spec and the corpus robot. The owner has to register the OAuth app
  (`DEPLOY.md`) before the link box even appears on the live site; then the first real import will
  say whether `tessellatedfaces` at 1.5 mm chords is the right size for a 700-part robot, how long
  a REVIVER-sized read takes against the quota, and whether linked (COTS) parts come with their
  colours and masses. `inertia` as "about the centroid, nominal first" follows onshape-to-robot's
  reading of the response; verify on a real part.
- The `onshape` worker op re-sends the whole payload for a re-read (a new up or centre). Fine for
  a corpus robot; a 100-studio robot may want the payload kept in the worker.
- `src/autorig-lib.js` still carries ~470 generated lines nothing calls (`inferCarry` and its
  helpers); cutting them means changing the research prototypes `tools/gen-autorig.mjs` wraps.

## 2026-10-04: the first real export, and what it taught the reader

The owner's own robot, REVIVER (an Onshape URDF export: 1,920 links, 1,919 joints, 186 MB zipped,
473 MB unpacked, 85.7 M triangles at Fine), and its 109 MB STEP. Everything below was found by
running them, not by reading Onshape's docs; each fix has a test.

### What a real export looks like

- **One link per rigid body, so the root link holds the whole chassis as 56 `<visual>`s** (and a
  turret link 13). Read as one solid it weighed as a 600 mm block and set the floor by its lowest
  stray part. `urdfRobot` now makes one solid per visual; the link is a sub-assembly of them in the
  mate model, so a mate on the link lands on every part. Names come from the mesh files.
- **Parts with no material are exported at a density of 1 kg/m³**: the inertial mass IS the part's
  volume in m³ (pins and rollers at 0.4–0.7 of their hull, channels at 0.1–0.3). `partMass` uses
  that volume at the kind's solid density; a part with a real material keeps its mass when it is
  plausible for the hull; a team-drawn part ("Part 1", no vendor number) is weighed as printed or
  polycarbonate (1300 kg/m³), because reading them all as aluminium put the robot 5 kg over. Game
  elements drawn in the robot (DECODE's artifacts) weigh nothing: `solidKind` → "game".
- **Unmated parts hang off the root** by a fixed `hanging_node_to_root_joint`. Most sit where they
  belong; a group whose box is clear of the mated robot's (a bracket 700 mm in front, two screws and
  a REV part 150 mm under the floor) is left off and named in the import notes. Parts wholly below
  the wheels' floor go the same way.
- **Planar and parallel mates come as chains of three prismatic connector links and a turn.**
  Collapsing a chain with two non-parallel slides gives a part free to slide about a plane: no
  mechanism, held where drawn (`held` in the notes).
- **463 continuous joints, and only two with limits** (two servo horns, ±22°). Every bearing race,
  every shaft, every roller and every gear has its own joint. `classifyJoints` now judges a joint by
  everything it carries (its body plus every joint hanging from it), marks a turn on a drive wheel's
  axle as the drive's, and folds a turn that is coaxial with the turn it hangs from (the gear on the
  gear a servo turns) into it. REVIVER: 238 joints → 11 mechanisms, 227 set aside.
- **The wheels**: four goBILDA 104 mm mecanums, 66 parts each (one corner drawn twice). The
  per-roller "wheels" the grower found around each roller's own 45° axis used to beat the composite
  wheels and set the floor 50 mm low. A composite wheel now owns its parts (drive and frame alike),
  and box corners are only added to sparse shapes (they read a roller 17 mm fat). Mecanum ×4,
  103 mm, track 336, wheelbase 389, up from the wheels, floor at their bottom.
- **Roller hands read FR, FL and BL as the other hand** for their corners. Modelled as drawn the
  base couldn't strafe. A non-X reading now falls back to the X pattern and names the wheels to check
  in the CAD (`tests/wheels-composite.test.mjs`).
- **The zip is read lazily** (`zipEntries(buf,{lazy:true})`, `zipRead`): an entry is inflated only
  while its mesh is being thinned, and the page hands the bytes to the worker instead of copying
  them. A 520 MB export had run the tab out of memory; the import card and docs now say Medium
  resolution (Fine is ten times the file for no gain, since every shape is thinned to a budget).
- **Edges**: a thinned mesh is faceted everywhere, so its edges (30° crease) drew the robot as
  wire. Export meshes take a 62° crease and none at all over 6,000 triangles.

### The second pass, same day: the mechanisms were there all along

The owner reported the robot "doesn't move the right mates". It didn't: `applyOnshapeMates`
took every root-level part that wasn't the moving end of a mate as frame. In a URDF model every
link is root-level, so an arm's plates (fastened to the hub on its motor's shaft) were welded to
the chassis and the shaft's revolute became "a mate between parts also fastened together", ignored
— 99 of them. The frame is now the fixed parts plus the parts no mate touches (and, with nothing
fixed, the biggest root-level body); planar/parallel connector chains and loop closures are left
free instead of "fixed" (they are no fastening); a mate with a real degree of freedom is walked
before a planar one so loops land on the planar. REVIVER went from 11 one-part "mechanisms" to 19
real ones: the turret (96 parts, 123 carried, yaw), its hood servo and feeder wheel, the spindexer
(three coaxial copies folded to one), the intake arm (234 mm), the shooter shaft, the servos.
`classifyJoints` also folds coaxial siblings and sets odometry pods aside. Thinned meshes now keep
up to 60,000 triangles each (1.7 M for the robot) and get crease-angle normals, so flat faces stay
flat and fillets stay smooth. Tested: `tests/import-zip.test.mjs` (a plate fastened to the arm
moves with the arm), `tests/mates.test.mjs` still exact on the corpus; headless Chrome shows the
turret turning with its parts (`View.preview`).

**Research (deep-research, 22 claims verified 3-0 against Onshape's docs and OpenAPI spec,
2026-10-04):** the owner asked whether "STEP for looks + a JSON for mates" would be better. The
mates JSON exists (`getAssemblyDefinition` with `includeMateFeatures`), can be called with
per-user API keys and no OAuth, and glTF can be exported by API; but it carries the same mates
Onshape's URDF export already writes, the occurrence transforms are absolute (not parent-relative),
API keys are per user ("local testing only" per Onshape) and the browser still needs the relay for
CORS. STEP would need OpenCascade in the browser for looks, which is the slow path this import
replaced. So the URDF zip stays the route; the looks problem was ours (thinning and normals), not
the format's. onshape-to-robot's `dof_` naming convention does not apply to Onshape's native
export.

### Measured here

- Node: the zip builds in 22–30 s (536 unique shapes, 19.5 M → 0.92 M triangles, 1,939 parts);
  headless Chrome, in the worker: about 60 s with the page drawing. 14.3 kg (was 76 kg as one
  root solid, 21.5 kg with aluminium everywhere). The STEP parses in 11 s (839 solids, one mecanum
  wheel assembly drawn, the rest mirrored; 11 kg).
- The review card with the sample OpMode still selected now says "Now your code" and offers
  "Drive this robot with it anyway"; with it, 8 items (sweeps of the stacked intake rollers).
- 618 tests green.

### Still open

- The 520 MB export itself was not re-run (the owner has it; this zip is 186 MB). The memory fix is
  by construction: nothing larger than one inflated mesh plus the zip is live at once.
- Masses of team-drawn parts are a guess at 1300 kg/m³; set materials in Onshape for exact.
- Frame rate on a real GPU with 1,939 instanced parts and GTAO was not measured (SwiftShader only).
- The STEP export of REVIVER has one wheel assembly; the URDF export is the one to use.

## 2026-10-03: the import redone, the page redone

Branch `claude/cad-import-apple-ui`. The problem set by the owner: getting a robot's CAD in took
too many steps, wasn't clear, and wasn't accurate; the page lagged and looked dated.

### What changed

- **Onshape's URDF export is the way in** (Onshape release 1.212, March 2026; GLB meshes since
  September 2026). Right-click the assembly tab → Export → URDF → drop the zip. `src/meshfiles.js`
  (zip, GLB/glTF, OBJ, STL readers; pure, tested in Node) and `src/urdf.js` (`urdfFromZip`,
  tolerant mesh paths, coupling hints) make the robot with no sign-in, no server and no quota.
- **`src/bind.js`**: `classifyJoints` marks the library's bearing and motor-shaft mates internal
  (never a question; the robot check and the name mapper skip them); `bindDevices` ties devices to
  joints by name, by the actuator kind on the axis, by `RUN_TO_POSITION` travel, by pairing and by
  elimination, applies the URDF's coupling hints when the code confirms the leader, and returns the
  open questions with candidates. On 7832's robot with the spec withheld: 11 of 11 bound, nothing
  asked (`tests/import-zip.test.mjs`).
- **`src/engineworker.js`**: the build ships the engine alone as `dist/engine-<hash>.js`; a Blob
  worker imports it and parses STEPs, finds joints, cuts the shape units and builds URDF robots off
  the page's thread (the robot is posted first; the joints and the units follow as promises). The
  eight-second freeze on loading a robot is gone. It falls back to the page on file://.
- **`src/importflow.js`**: one card over the field: bring → busy → code → review → done. The review
  shows facts (up, front, drive base, joints, devices bound, weight) and only the real questions,
  each answerable with one click and a "show" that wiggles the joint.
- **The page**: `src/markup.html` and `src/styles.css` rewritten with the apple-design skill:
  light by default (dark follows the system or the switch), glass chrome (top bar, side panels,
  dock) over a full-bleed field, quiet solid cards, one accent (system blue), spring motion on
  transforms only, reduced-motion and reduced-transparency honoured. Every element id the scripts
  use was kept; the Robot tab is "Your robot / Review / Your robot and your code", with everything
  else under **Advanced**.
- **Graphics**: three.js r128 → r186 as ES modules (an import map, `window.THREE` plus the add-ons,
  the app boots on `three-ready`). GTAO ambient occlusion, SMAA and an OutputPass through an
  EffectComposer (`View.draw`, one composer per camera); RoomEnvironment PMREM as the scene
  environment; physically scaled light intensities; colour management on (no more `linearize`;
  canvases marked sRGB, vertex colours converted where they are built). The frame-rate watchdog
  turns the passes off first, then pixels, then the light copy.
- **The Onshape relay** caches Part Studio shapes and masses at the edge by version or
  microversion (`CACHEABLE`), so the private app's 2,500 calls a year go much further.
- **`tools/fusion/ExportToSimBench`**: a Fusion script that writes robot.urdf, OBJ meshes and a
  zip, with joints and limits from the design's joints and motion links as mimics. Not run in
  Fusion itself (no Fusion here); the API names are from Autodesk's current reference pages.

### Measured here

- Parse 5.2 s, joint finder 3.1 s, shape units 3.1 s for the 773-part robot, all in the worker now.
- 610 tests, all green (`npm test`). `tests/net.test.mjs` is timing-sensitive: it failed once while
  Chrome was rendering alongside, and passes alone.
- Headless Chrome (swiftshader) loads the page with no exceptions, in both themes.

### Not done, in order

1. **Try a real Onshape URDF export.** Done 2026-10-04 with REVIVER (see above). Still worth doing
   with GearGurus 7832's assembly to check the lift's stages couple, the claw fingers mirror and the
   eleven devices bind against a robot whose code is here.
2. **Run the Fusion script in Fusion** once and fix whatever the API disagrees with (occurrence
   transforms against body coordinates in `meshManager`, joint geometry on as-built joints).
3. **"Set it by numbers"** for a CAD with no wheels still lives in the Robot tab's Review section;
   the card points at it. Bringing that form into the card would finish the one-place promise.
4. The earlier handoff's list still stands: Sign in with Onshape secrets, online on two real
   computers, the teams whose TeleOps don't drive.

## Earlier: real joints and real Java

Where the "it never works on our robot" work stands, for whoever picks it up
next. Branch `claude/ftc-simbench-ui-bugs-63kx2s`, pull request
[LILRINO71/ftc-simbench-pro#10](https://github.com/LILRINO71/ftc-simbench-pro/pull/10).

## The problem

A team drops in its CAD and its code, and the bench:

- asks too many questions;
- turns the robot white after a while;
- shows a robot check that doesn't make sense;
- doesn't move the way the real robot does.

There were two root causes.

1. **CAD.** A STEP file has shapes and nothing else: no joints, no motors,
   and only sometimes colours and mass. Every joint was a guess from the
   geometry, and FTC teams build too creatively for guessing to be right.
2. **Code.** The bench read the team's Java with a line-by-line pattern
   reader. Hardware in a `Robot` class, FTCLib commands, Road Runner or
   Pedro meant the reader saw nothing, so the drive and the mechanisms
   were guessed too.

The research behind the fixes is in
`reports/FTC robot import and code running.md`, with its sources in
`research_notes/FTC robot import and code running/`.

## What is done

### Code: the team's real Java runs

- `src/jvm.js` is a small Java interpreter: lexer, parser (it parses all
  1951 files of the code corpus) and a generator-based evaluator.
  `LinearOpMode` blocks by yielding (`{gate}`, `{sleep}`, `{wait:"start"}`),
  so `sleep()`, `waitForStart()` and busy-waits act as they do on a robot.
- `src/jvmlib.js` mocks the FTC SDK in JS:
  - `HardwareMap`, motors, servos and CR servos;
  - IMU, Pinpoint and OTOS odometry, sensors;
  - gamepads with edge detection, telemetry, `ElapsedTime`.
- `src/jvmprelude.js` holds the libraries teams use, written in Java:
  - FTCLib, including the whole command framework;
  - Road Runner 1.0 and 0.5 geometry and kinematics;
  - Pedro Pathing's follower for TeleOp;
  - the SDK's navigation types.
- `src/jvmrun.js` runs the OpMode:
  - `jvCompile` parses it; `JvProgram` runs init, start, tick and stop.
  - `jvAnalyze` probes it on a stand-in robot. The drive comes from what
    the motors do when the stick is pushed, never from names.
  - `jvMechProbe` finds which control moves which device.
- `parseJava` (`src/java.js`) tries the old line reader first and switches
  to the VM when the reader can't follow all of the code (`code.engine === "vm"`).
  Even when the reader covers everything, the code is still run, and each
  wheel's side and end come from what it did (`code.vmDrive`, used by
  `detectDrivetrain`), because config names don't always match where a
  motor sits.
- The drive probe tries the turn stick, then the right trigger, then the left
  stick's x (arcade). Wheels are the motors that get at least half the
  strongest forward power, so a lift that follows the stick a little isn't one.
- Busy-waits during INIT see the robot move (`Sim.stepDevices`, the host's
  `world(dt)`); an INIT that never returns stops with a `Hang` error.
- The IMU reports the robot's heading with a real gyro's small noise
  (±0.017°). Before, `getRobotYawPitchRollAngles()` always read 0.
- The sim (`src/sim.js`) runs the VM program live. Wheel mounting comes from
  the CAD's motors first (so a wrong `setDirection` still fails the drive
  check), then from the code's own forward, then from the standard build.

### CAD: joints that are declared, not guessed

- **Onshape, the whole robot, no STEP** (`src/onshapelink.js`,
  `src/onshapecad.js`). The pop-up (`OnshapeHelp` in `src/app.js`) walks a
  team through it in three steps with pictures and a troubleshooting list, and
  shows the progress while the robot comes in.
  - **Sign in with Onshape** is the main way (`functions/onshape/[[path]].js`,
    a Cloudflare Pages Function). School Chromebooks block bookmarklets (the
    admin's URL blocklist has `javascript://*`), and the owner hit exactly
    that: a click did nothing, and a drag showed `about:blank#blocked`. The
    team signs in through Onshape's OAuth page and pastes the assembly's
    address; the page runs the same reader (`onshapeRead`) through the
    function, which keeps the token in an encrypted HttpOnly cookie and passes
    on only read calls for the robot. Onshape's API has no CORS, so a server
    is needed. It needs the owner's OAuth app (`DEPLOY.md`); without it the
    pop-up falls back to the bookmark. Tests: `tests/onshape-signin.test.mjs`. Every endpoint, parameter and
  response field it relies on was checked against Onshape's OpenAPI spec
  (points as `[x,y,z]` or `{x,y,z}`, colours as `appearance.color`, retries
  on 429/503), and Onshape's CSP allows a bookmark to run there.
  - The "Send to SimBench" bookmark runs on the team's signed-in Onshape tab.
    It reads the assembly, its features, and each Part Studio's tessellated
    faces with colours and mass properties.
  - It posts all of that to the SimBench tab, which it opens at
    `#onshape-wait`.
  - `cadFromOnshape` builds the CAD with real triangles, colours and mass,
    and every mate becomes an exact joint (matched by occurrence path).
- **URDF** (`src/urdf.js`): drop a `.urdf` with its `.stl` meshes. URDF is
  what the Fusion, SolidWorks and FreeCAD exporters write. Links become
  parts, joints become mates, and `mimic` becomes a coupled joint.
- **Devices to joints** (`autoMap`, `src/mapping.js`):
  - names are split into words and matched through FTC synonym groups;
  - short forms count ("in" for intake);
  - left/right qualifiers have to agree;
  - the names of the parts a joint carries count too;
  - two motors named alike share one joint.

### The page

- **Robot check** (`src/robotcheck.js`): only `fail` and `warn` items are
  questions. A device with no joint, or a joint nothing drives, is a `note`:
  it shows as a live gauge and asks nothing.
- **Setup** (`setupAuto`): a step counts as done when the robot itself
  answers it.
- **White robot**: the frame-rate watchdog swapped in the light copy, whose
  materials differed from the full robot's. Both now use the same
  environment-lit metal (`src/view3d.js`; `tests/robot-look.test.mjs`).
- **No lag after loading a robot.** One OpenCascade worker stopping used to
  send every remaining part to the page's own thread (seconds per part). Now
  a stopped worker costs one part and is replaced
  (`tests/tess-workers.test.mjs`). Panels redraw only when on screen and
  changed.
- **Graphics.** sRGB output with ACES filmic tone mapping (`linearize()` turns
  authored colours into linear light once), a shadow box that follows the
  robot (about 5.7 px/cm), a cool fill light, and painted foam tiles.
- **Online.** Players meet on seven named relays (`NET_RELAYS` in
  `src/net.js`); Trystero's own pick for this app id included two dead ones.
  The library falls back to esm.sh when jsDelivr fails.
- **Decluttered**:
  - the setup steps that are found fold to one line;
  - long hints are cut short;
  - "how the CAD was read" folds away;
  - the duplicate START banner is gone, and the arm-torque inset starts folded;
  - the CAD drop says STEP · URDF · Onshape;
  - the Telemetry panel shows exactly what the VM sent;
  - the Java tab says whether the VM ran the code, stood in for a library
    call, or stopped on an exception.

## Measured

`research/fullrobots/bench.mjs` measures real teams' code and CAD; `baseline.txt` is the latest
run (engine 34d03fe). Against the base (4d7907e), on 28 teams' main TeleOps:

| | before | now |
| --- | --- | --- |
| drives correctly | 1 | 18 |
| drives at all | 4 | 19 |
| moves a mechanism | 4 | 18 |

Across all 190 enabled TeleOps, 55 drive correctly (it was 4), and 23 of 28 teams have one that
does. Nothing times out. The median number of questions on a CAD fell from 5 to 3 with no code,
and from 21 to 8 with the ITD code.

## Not done, in order

1. **Switch on Sign in with Onshape and test it live.** Register the OAuth
   app and set the two secrets (`DEPLOY.md`), then try it on a school
   Chromebook with the team's own robot. Check that a second Onshape account
   can authorize the app before it has a public store entry. The reader is
   checked against Onshape's OpenAPI spec and a generated payload, never a
   real assembly (a cloud container can't sign in to Onshape). Still open from the research: the real call count and
   payload size, how Onshape counts session-cookie calls against its quota,
   and whether linked (COTS) parts come with their colours.
2. **Test online on two real computers.** The relays and the loader are
   fixed and tested with the library faked; a cloud container's proxy carries
   no WebSockets, so no live match ran here. A TURN relay would still be
   needed for networks that block direct connections.
3. **Teams whose main TeleOp still doesn't drive** (see `baseline.txt`):
   - t13115 leaves its drive in `STOP_AND_RESET_ENCODER` (real: it wouldn't
     drive on its robot either; the page now says so);
   - rr05 builds its Road Runner drive in a field initializer, where
     `hardwareMap` is still null (real: it crashes on the robot too);
   - tCyberRaptors and tTechTigers: no hardware is found (a runner class, a
     base class);
   - tTechTurb: Road Runner 1.0 `setDrivePowers` through its own drive;
   - t25609 and t27570: no stick reaches a wheel. Start with
     `node research/fullrobots/bench.mjs --code-only --primary-only --only=t25609 --no-compare`,
     then run `jvProbeRun` (exported by `tests/load.mjs`) on the team's files
     and print each motor's power under each stick.
4. **Loading still parses on the page's thread.** The default robot's STEP
   (`parseSTEP`), the shape list for meshing (`stepShapeUnits`) and the robot
   check take a few seconds on a laptop. A worker for `parseSTEP` would help.
5. **The robot package `ftc-sim-bench.robot`**: one file with the geometry,
   joints and device bindings. See section 4 of the report.
6. **Device to joint from the Control Hub config XML**, the first rung of
   the report's matching ladder. Not started.

## Fixed along the way (worth knowing)

- **VM state shared through the parse cache.** Parsed units are cached by
  source, so two programs sharing an OpMode file share its AST. The VM used
  to store per-run facts (a method's owner class, field types, int-returning
  calls, anonymous classes) on those nodes. They now live in a per-VM
  `WeakMap` (`JVM.nodeInfo`). Never store anything run-specific on an AST
  node. Test: `tests/jvm.test.mjs`, "two programs sharing an OpMode file".
- **STEP parsing turned quadratic after a few files.** `splitStepRecords`
  kept `-1` for "no comment left". From about the fourth `parseSTEP` in one
  process, V8's optimised code searched for that comment again on every
  record (found with gdb: memchr over the whole body, ~80k times). That was
  the CAD benchmark's 600 s timeouts. "None" is now the string length. Test:
  `tests/step-speed.test.mjs`.
- **The IMU always read 0.** The native IMU passed the yaw to the Java
  `YawPitchRollAngles` as native state instead of its fields. Any field-centric
  drive ran as if the robot never turned. Test: `tests/jvm.test.mjs`.
- **`DcMotor.Direction.REVERSE` did nothing on the VM.** The native interfaces
  didn't extend each other (`DcMotor` < `DcMotorSimple`), so the nested enum
  was a stub. Test: `tests/jvm.test.mjs`.
- **`analyze()` crashed on a VM drive** (it read the line reader's statement
  off each wheel), so robots on the VM lost all their findings.
- `tests/robotcheck.test.mjs` is slow (minutes) in a cloud container but
  passes.

## How to check your work

```
npm test                                   # every tests/*.test.mjs
node --test tests/jvm.test.mjs             # the VM
node research/fullrobots/bench.mjs --only=<id> --no-compare   # one team or CAD
npm run build && (cd dist && python3 -m http.server 8765)     # the page
```

The bench needs the corpus at `/home/user/ftc-cad-corpus` or `--corpus=`.
Only the PC has the owner's own robots and the `fullrobots/` folders.
