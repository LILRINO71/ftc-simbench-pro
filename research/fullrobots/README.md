# research/fullrobots: the regression bench

The owner's complaint: teams export their CAD, drop it in with their code, and "it never works. It asks
too many questions and never works as intended." This bench measures exactly that, on real teams' code
and real teams' CAD, with no browser. Every change that claims to fix it is measured against
[`baseline.txt`](baseline.txt).

What we're building toward: *drop your OpModes and your CAD. Your code runs unmodified on your robot. Your
CAD is drawn as your robot. Mechanisms move when the bench is exact or confident; anything else shows as a
live readout driven by your code. You never have to answer anything to press START.*

```bash
node --max-old-space-size=8192 research/fullrobots/bench.mjs      # both halves, about 90 s on 16 cores
```

| Option | |
|---|---|
| `--code-only`, `--cad-only` | one half |
| `--only=t21337,owner` | teams or CADs whose id contains one of these |
| `--primary-only` | each team's main TeleOp only (by default every enabled TeleOp in the corpus runs too) |
| `--corpus=<dir>` | default `../ftc-cad-corpus` next to the repo |
| `--owner=<a.step>;<b.step>` | the owner's robots (default: the two in `~/Downloads`; missing ones are skipped) |
| `--out=<file.json>` | default `last-run.json` here (git-ignored) |
| `--compare=<file.json>` | default [`baseline.json`](baseline.json); prints what got better or worse. `--no-compare` skips it |
| `--strict` | exit 1 when anything got worse than the comparison |
| `--workers=<n>`, `--timeout=<s>` | code workers (default 6); per-OpMode limit (default 120 s). A hung probe costs its row, not the run |

It loads the engine the way the tests do (`tests/load.mjs`, the shipped `src/*.js`), so it measures the
working tree. Code probes run in worker threads; the CADs run one at a time in an 8 GB worker.

## The corpus (outside the repo, never committed)

AGENTS.md rule 6: no team CAD or team code in the repo. Everything lives in `../ftc-cad-corpus/`:

| Folder | What | How to get it |
|---|---|---|
| `code/<team>/` | 28 teams' main TeleOp (picked by hand by the accuracy audit) plus every `.java` in their repo's TeamCode at a fixed commit (`repo/`), and two reference folders: `sdk/` (FTC SDK samples) and `rr1/` (the Road Runner 1.0 quickstart). `code/manifest.json` lists each team's OpModes and helpers. | `node research/fullrobots/corpus.mjs --fetch` clones each repo at the commit in [`code-sources.json`](code-sources.json), then writes the manifest. `sdk/` and `rr1/` come from FIRST-Tech-Challenge/FtcRobotController's samples and acmerobotics/road-runner-quickstart; copy them by hand. |
| `realcad/` | 8 real teams' STEP files ([research/realcad](../realcad/README.md)) | `node research/realcad/fetch.mjs ../ftc-cad-corpus/realcad` (with no folder it fetches into the corpus root, which the bench also reads) |
| `fullrobots/<team>/` | a team's whole robot with its code: `robot.step` + `java/`. Today `bo19280pp` (Onshape, FTCLib command-based) and `hh9384pp` (Fusion, mecanum); `gg7832` is the default robot again and is skipped. They were put there by an earlier session and their sources weren't recorded. | by hand: any `<team>/robot.step` + `java/` is picked up. Name the main TeleOp in `FULL_PRIMARY` in bench.mjs, or it takes the enabled `@TeleOp` with the most `hardwareMap` lookups. |
| `~/Downloads/REVIVER (Current Bot).step`, `~/Downloads/V1.1- BASE CURRENT--.step` | the owner's two robots (100 MB each, no code) | the owner's machine |

The default robot (`assets/robots/into-the-deep/robot.step.gz`) is gunzipped in memory, never to disk.

`node research/fullrobots/corpus.mjs` rewrites the manifest. A file is an OpMode if it has `@TeleOp` or
`@Autonomous` (fully qualified too), or extends `OpMode`/`LinearOpMode`/`CommandOpMode` directly or
through the team's own base classes. Everything else is a helper.

## A. Code: 28 teams' TeleOps on one standard robot

Every TeleOp runs on the same robot, the generated goBILDA mecanum base
`tests/fixtures/robots/mecanum-zup`, so only the code varies. All of the team's other `.java` files go
to `parseJava` as helpers, as `{file, src}` like `src/app.js` passes helper classes. (The app passes
only files that aren't OpModes, by `isOpModeSource`, so a base class that extends `LinearOpMode` reaches
the app's library, not its helpers. The bench passes everything.)

**Drive probe.** From a fresh INIT and START, 0.1 s with the sticks at rest, then gamepad1 held 1 s:

| | Push | Passes when |
|---|---|---|
| F | left stick up | > 0.3 m forward, sideways < 25 % of that, < 15° |
| S | left stick right | > 0.2 m right, forward < 25 % of that, < 15° |
| T | right stick right | > 20° clockwise, < 0.1 m off the spot |

- **The wheels must be told to do it.** Each push also records what the wheels were commanded, as the
  no-slip chassis motion through the engine's own `ikMatrix`/`fkFromIk`. A probe passes only if that
  agrees too (`INTENT`). Without it, tEverybot's wheels, commanded against each other, "drive" 0.42 m
  forward on physics drift alone.
- **Stick layout.** The layout is read off the code's gamepad1 reads (`layoutOf`). Mecanum: the table
  above. POV (left stick y drives, right stick x turns), arcade (one stick) and tank (a stick per side)
  get their own drive and turn pushes. They can't strafe, so S shows as `-` and doesn't count.
- **Motor mounting.** Which side a team reverses depends on how its motors are mounted, which code
  can't know about a robot it wasn't written for. So every push runs twice:
  - **as built:** the standard robot's own CAD mounting, which needs the left side reversed;
  - **mounted as the code says:** every drive wheel gets the same sense relative to the commanded power,
    both global senses are tried, and `Sim.wheelCmd` is overridden for that push only.

  Upper case `FST` means right as built. Lower case `fst` means right only when mounted as the code says,
  which also counts as driving correctly (a team that reverses the right side, like the repo's own
  `CompetitionTeleOp`).

**Mechanism probe.** It lists every control the OpMode reads straight from its source text, so the list
doesn't depend on the parser. It scans the file, its base classes, and team classes it names that read a
gamepad, covering `gamepad1/2.x`, SDK 10's `aWasPressed()`, `Gamepad` copies, and FTCLib
`GamepadEx`/`GamepadKeys`. For each control that isn't a drive axis, it holds the control 1 s from a
fresh start and compares against an unpressed run of the same length. It counts the non-drive motors and
servos whose commanded power, position or RUN_TO_POSITION target changed. A stick is pushed up or right;
a trigger fully.

**Scores, per team (its main TeleOp):** drives correctly (F, S and T), drives at all (any push moves
> 0.1 m or > 10°), moves a mechanism. The "every TeleOp" column and summary line repeat these over each
team's other enabled `@TeleOp`s (187 in all, each run once even when two folders share a repo).

**Reference rows** are the bench's own controls on the same robot: the default robot's
`sample_teleop.java` and `tests/fixtures/CompetitionTeleOp.java` (both drive correctly), and the FTC SDK
samples and the RR 1.0 quickstart. Several of those can't pass for honest reasons: 2-motor code on a
4-motor base, field-relative drive through a helper method, a telemetry-only demo.

## B. CAD: every real robot through the page's path for a new robot

Each STEP goes through what the page does when a team drops it:

1. `parseSTEP`, which also sets the frame.
2. Front from the wheels, else +x (`frontFromWheels`).
3. `driveFromCAD`.
4. The joint finder (`autoRig`), or a joint spec when there is one (only `itd-7832-spec`, the default
   robot with its `joints.json`, as the reference).
5. The front a spec gives.

Then it's checked three ways: with no code, with the default robot's `sample_teleop.java` (the same
code on every robot, so only the CAD varies), and with the robot's own code when it has some.

**Questions** = robot-check items the page labels ANSWER or CONFIRM + setup steps not done +
status-light rows:

- **robot check:** `checkRobot` items with `sev` fail or warn. The device map is built the way
  `app.js` `mapDevices` builds it: `autoMap`, then a spec's own device names.
- **setup:** `app.js` `SetupUI.render`'s four steps (up, front, drive base, joints). A step is done
  only when someone presses it, and `SETUP.done` is emptied for every new CAD, so today a new robot
  always shows 4. **This is mirrored by hand in `setupOpen()`**. Change it in the same commit that
  makes a step complete itself, or the bench will under-report the improvement.
- **status:** `statusOf(analyze(...))` rows, as `app.js` `Status.compute` builds them. With no code
  `analyze` isn't run, as on the page.

"No code" runs the robot check with no devices: what it says about the CAD alone (scale, mass, joints
that carry nothing, the drivetrain, swing). The page shows that once any OpMode is loaded.

With code, the CAD rows also show the drive probe on that robot, and **joint**: how many of the
devices the code commands (not the drive) have a joint to move. With the ITD TeleOp on another
team's robot, lower case counts as right. With a team's own code it doesn't: its CAD says how its
motors are mounted.

These counts match the question audit's measurements in the real page. The default robot without its
spec gives 9 ANSWER + 11 CONFIRM, 212 buttons, 12 status rows, and 1 of 10 devices on a joint. The
`tests/fixtures/assembly.step` + `CompetitionTeleOp` pair gives 5 ANSWER + 3 CONFIRM and a red light
with 2 rows. It drives backward, turns left and strafes left.

## The baseline (engine 41ce363)

```
CODE drives correctly 13/28, drives at all 17/28, mechanisms 17/28 | CAD parse 11/11, questions median 3 (no code) / 8 (ITD code)
```

Against the first baseline (4d7907e): 77 better, 0 worse. Two changes moved the numbers. The team's
real Java now runs on a small Java VM (`src/jvm*.js`), and the drive is measured from what its motors do.
Robot check notes (a live gauge, a suggestion) no longer count as questions.

- **Code, main TeleOp, 28 teams:** drives correctly 13 (was 1), at all 17 (was 4), moves a mechanism
  17 (was 4). Across all 190 enabled TeleOps: 46 drive correctly (was 4), 55 at all, 43 move a mechanism.
  21 of 28 teams have a TeleOp that drives correctly.
- **Errors:** rr05's main TeleOp and three of t25832's test OpModes hit the 120 s limit.
- **CAD:** median questions 3 with no code (was 5), 8 with the ITD TeleOp (was 21). The ITD TeleOp
  drives correctly on 9 of 11.
- **Corpus differences:** this run is from a container whose corpus has 11 CAD files. The owner's two
  robots and `fullrobots/` (bo19280pp, hh9384pp) are only on the owner's PC. Their rows are carried
  over from 4d7907e and marked `carried`. Re-run the baseline there to measure them.

The first baseline's per-team breakdown (what stopped each team) is in git history:
`git show 4d7907e:research/fullrobots/README.md`.

## Keeping it honest

- **A change that moves a number** commits a new baseline with it. Run
  `node --max-old-space-size=8192 research/fullrobots/bench.mjs --out=research/fullrobots/baseline.json > research/fullrobots/baseline.txt`
  and say in the commit body what moved and why. Run with `--strict` before pushing: anything worse
  than the baseline is listed as `WORSE`.
- **The thresholds** (`PASS`, `INTENT`, `LAYOUTS`, `MECH_EPS` at the top of bench.mjs) define every
  number. Changing one is its own commit.
- **The JSON holds no team code:** ids, file names, device names, counts, and the line numbers of
  skipped statements, never their text.

## Limits

- **The code probe's robot isn't the team's robot.** "Mounted as the code says" covers the common case
  of a team reversing the other side. A team whose code only works on an unusual build (a diagonal
  reversal, a sideways front) shows as wrong.
- **Layouts come from the controls read, not their meaning.** tEverybot's left stick x turns and its
  right stick x strafes. The bench calls that mecanum and fails it.
- **Controls are found by name.** A gamepad passed into a method under another name (`void update(Gamepad g)`)
  is pressed on both pads. One hidden behind deeper wrappers isn't found, so its mechanism isn't probed.
- **Mechanisms are judged by command, not motion.** The probe sees that the code tries to move a device.
  Whether a joint moves on the robot is the CAD half's **joint** column.
- **Setup steps are mirrored, not measured.** See above.
- **The CAD half runs no mechanisms.** A device with a joint isn't checked to move the right parts the
  right way.
