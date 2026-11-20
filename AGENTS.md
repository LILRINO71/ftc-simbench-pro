# Working in this repo with more than one agent

Two coding agents work on this repo at the same time: **BATMAN** and **Claude**
(committing as LILRINO71). These rules keep them out of each other's way.
Read this file before you start, and again before you push.

## Rules

1. **Never rewrite `main`.** No force-push, no `git reset` of pushed commits,
   no amending pushed commits. Someone else may already have built on them.
2. **Work on a branch; rebase before pushing.**
   ```
   git fetch origin
   git rebase origin/main        # on your own branch
   npm test                      # must be all green
   git push origin HEAD:main     # fast-forward only; if rejected, fetch + rebase again
   ```
3. **One topic per commit.** Start the subject with the area:
   `parser:` `sim:` `physics:` `drive:` `mates:` `cad-view:` `mapping:` `docs:` `chore:`.
   The body says what was wrong, what changed, and how it was tested.
   Put `Fixes #N` in the body when a commit closes an issue.
4. **Every bug fix comes with a test** that fails before the fix.
5. **`dist/` is build output and is not tracked.** Cloudflare Pages runs
   `npm run build:ship` on every push to `main`. Committing the bundle made
   every pair of parallel changes conflict. Build locally, never commit it.
6. **Never commit robot CAD or test staging.** `dist/_t/`, `*.step`, and big
   CAD files stay local. The corpus STEPs regenerate from `tools/stepgen.mjs`.
   The one exception is the default robot, `assets/robots/into-the-deep/`.
7. **Claim before you edit a shared file.** Add a row below, push that change
   first, and remove the row when you're done. If a file you need is claimed,
   work around it or leave a note in the claimant's GitHub issue. Don't edit
   it silently.

## Current claims

| agent | files / area | for |
| --- | --- | --- |
| Claude | `src/match.js` (new), `src/field.js`, `src/shots.js`, `src/sim.js` (the match), `src/onshapelink.js` (new), `src/robotcheck.js` (new), `src/markup.html` + `src/styles.css` (Robot check section), `src/jointspec.js`, `src/autorig.js`, `src/cadview.js` (joint editor), `src/app.js` (joints panel), `src/view3d.js` (joint preview), `src/roadrunner.js`, `src/net.js` (new), `src/robotlite.js` (new), `src/drivetrain.js` + `src/frame.js` + `src/step.js` (wheels built from many parts), `tools/build.mjs` (module order, link preview), `src/view3d.js` (match robots, light copy), `src/app.js` + `src/markup.html` + `src/styles.css` (online panel) | the joint finder and editor; online matches (players on different computers in one match) |
| Claude | `src/meshfiles.js` (mesh thinning, glTF reading), `src/urdf.js` (shape reading), `src/view3d.js` + `src/app.js` (frame cost), `tests/meshfiles-speed.test.mjs` (new) | faster and exact robot import from an export zip, less lag drawing big robots |
| Claude | `src/hardware.js`, `src/dynamics.js`, `src/calibrate.js` (servo and motor figures, mecanum strafe loss, FLOAT coast); `src/jvm.js`, `src/jvmlib.js`, `src/jvmprelude.js`, `src/jvmrun.js` (loop rate, time, Java integer rules, statics from Auto to TeleOp, one engine on the page, limits on runaway code) | fixes from the 2026-11-19 audit (37 reproduced findings; the list is in the owner's `ftc-platform` repo, `docs/titan/audit/`) |

Done and released: the audit's app-layer fixes (`functions/`, `workers/`, the site's response headers in `tools/headers.mjs`, `tools/minify.mjs`, the build's compile check, where an ignored finding is kept); game pieces through the team's robot (`src/payload.js`, the Shot tab's card, `Match.solo`); the arena lighting and post (`src/postfx.js`), dynamic resolution, AI robot and
HUMAN PLAYER models (`src/figures.js`), shot effects (`src/shotfx.js`), ball physics (`src/ballphys.js`),
render interpolation and the CPU ratchet; the 2026-11-19 graphics, phone controls, calibration and Monte Carlo, grader and
path links, size checks, libraries from the site, spectators, Save video and leaderboard; drive direction, the 25f54d3 sim and parser fixes,
`autoMap`, Onshape mates (`src/mates.js`) and the pasted Onshape link (`src/onshapelink.js`,
`src/onshapecad.js`).
Those files are free again; read the conventions below before changing them.

## Conventions both agents rely on

- **Motor direction** (FTC SDK): with `Direction.FORWARD`, positive power turns
  the output shaft **clockwise seen from the shaft end**. `REVERSE` flips it,
  and `getCurrentPosition()` flips with it, so encoder ticks always count up
  under positive commanded power. The sim keeps every motor in this commanded
  frame and turns it into physical motion only at the joint or wheel.
- **Wheel mounting** (`buildRig` in `src/sim.js`): which way positive power rolls a wheel comes
  from the CAD when `dtMounts` measured it (`mountHow` `direct` or `chain`), else from the
  code's own forward (`sense`, src/jvmrun.js), else the standard build. An `assumed` mount is
  never reported as "from the CAD"; each wheel's `mountFrom` says which it was.
- **Robot frame** (`src/frame.js`): +z up, origin at the drivetrain centre on
  the floor, placement only through `robotToWorld`.
- **What an OpMode is read with** (`libsFor` in `src/app.js`): the helper classes plus
  `jvSiblings(source, the other OpModes)`, the OpModes it extends or names. A headless run
  (`jvCompile(main, libs)`) must pass the same; a parent that is missing ends INIT with
  `error.cls === "MissingClass"` rather than running nothing.
- **The headless entry** is `tools/run-opmode.mjs` (`runOpMode`, `readJava`, `libsFor`, and the
  command line). Other repos' CI imports it, so its options and the fields of its result only
  grow; `tests/run-opmode.test.mjs` holds them. `tests/load.mjs` stays a test helper.
- **Onshape mates** (`src/mates.js`): a mate joint has `fromMate`, true
  `axis`/`pivot` (canonical frame), `limits` (m for a slide, rad for a turn,
  right-handed about the mate axis), and maybe `couple:{to, ratio}` (a
  cascade stage, gear or rack driven through another joint). Each part it
  carries has `solid.mech` set to its id; with `cad.mates` set, grouping
  uses that, never nearest-pivot. `classifyMechs` leaves mate joints alone.
- **Joint specs** (`src/jointspec.js`, format `ftc-sim-bench.joints`): the
  same joints written by hand for a robot with no mates. They land as mate
  joints (`fromMate`, `cad.mates.source === "spec"`) plus `restPos` (the servo
  position the CAD was drawn at), `q0` (a drawn-pose fix, rad), `mmPerTick`,
  `gear`, and `couple.via` of `"ratio"`, `"slider-crank"` or `"rod"` with a
  `couple.link`. A joint's value comes from `mateJointQ`, followers from
  `jointValues`/`followQ`; the sim and the view both use these.
- **The default robot** is `assets/robots/into-the-deep/` (GearGurus 7832):
  `robot.step.gz`, `joints.json` and the team's OpModes, copied to
  `dist/robots/` by the build. It is the one CAD file the repo tracks, at the
  owner's request; `tests/into-the-deep.test.mjs` runs the team's TeleOp and
  Road Runner auto on it (`src/roadrunner.js`).
- **Exact joints** (`src/jointsheet.js`, format `ftc-simbench.jointsheet`): a mate named
  `motor …`, `servo …`, `crservo …`, `follow …`, `free` or `fixed`, or an entry in the page's
  joint sheet, sets `declared`, `declaredRole`, `sheetDevices` (and `couple` for a follower) on a
  mate joint. While `isExact(cad)`, `classifyJoints` holds every undeclared joint and
  `bindDevices` binds only what a declaration names. A sheet is undone by `applyJointSheet` itself
  (it keeps what it changed in `sheetWas`), so apply it again rather than editing those fields.
- **Twins on one axis** (`src/bind.js`): joints off one part on one axis line are one motion.
  `classifyJoints` gives the followers `coaxialWith` and `couple:{to, ratio:±1, via:"coaxial"}`
  (never `internal`), and `bindDevices` re-points them at whichever one the code drives. Both
  work it out afresh on every call, so don't store anything on a `via:"coaxial"` couple.
- **A mate joint's `dir`** (`src/mates.js`): 1, or -1 when its limits lie wholly below the drawn
  pose (the code's positive goes the way the joint can go). A follower's ratio is in each
  joint's own axis, so it carries the sign between the two axes.
- **A servo's starting position** (`src/sim.js`): its `restPos` (the joint spec's, else the
  code's), so a joint starts as drawn. `cmd === 0.5` no longer means "never commanded".
- **Joint kinds**: compare through `normJointKind(k)`; `prismatic` and
  `linear-slide` are aliases of `linear`. Slide travel per tick is
  `slideMmPerTick(mech, tpr)`, shared by the sim and the view.
- **Game pieces** (`src/payload.js`, [docs/game-pieces.md](docs/game-pieces.md)): what the team's robot
  holds is `Payload.held`, never a count kept elsewhere. Roles come from `Shots.detect` (one naming
  scheme: shooter, feeder, intake, transfer) and `Shots.cfg.payload`; a mouth is in the `footBox`
  frame. A ball in a mouth is `e.hold = {id: "user", ...}`, which `Match.flights` leaves to Payload.
  `Match.pieces()` means loose pieces on the field (a match or solo), `Match.live()` a match to score;
  `Match.floor` is the one list of loose balls. Only motors Payload marks (`s.flyT`) leave `SLEW`.
  The unlimited supply is the old bench exactly; online stays unlimited.
- `npm test` runs every `tests/*.test.mjs`; `tests/anyrobot.test.mjs` is the
  any-robot corpus, and it must stay 14/14.
