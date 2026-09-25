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
| Claude | `src/jointspec.js`, `src/autorig.js` (new), `src/cadview.js` (joint editor), `src/app.js` (joints panel), `src/view3d.js` (joint preview), `src/roadrunner.js` | an automatic joint finder for any STEP, and a click-to-fix joint editor in the CAD view |

Done and released: drive direction, the 25f54d3 sim and parser fixes,
`autoMap`, and Onshape mates (`src/mates.js`, `tools/onshape-mates.mjs`).
Those files are free again; read the conventions below before changing them.

## Conventions both agents rely on

- **Motor direction** (FTC SDK): with `Direction.FORWARD`, positive power turns
  the output shaft **clockwise seen from the shaft end**. `REVERSE` flips it,
  and `getCurrentPosition()` flips with it, so encoder ticks always count up
  under positive commanded power. The sim keeps every motor in this commanded
  frame and turns it into physical motion only at the joint or wheel.
- **Robot frame** (`src/frame.js`): +z up, origin at the drivetrain centre on
  the floor, placement only through `robotToWorld`.
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
- **Joint kinds**: compare through `normJointKind(k)`; `prismatic` and
  `linear-slide` are aliases of `linear`. Slide travel per tick is
  `slideMmPerTick(mech, tpr)`, shared by the sim and the view.
- `npm test` runs every `tests/*.test.mjs`; `tests/anyrobot.test.mjs` is the
  any-robot corpus, and it must stay 14/14.
