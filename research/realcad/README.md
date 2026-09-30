# research/realcad: the bench on real teams' CAD

Generated robots only test what they were built to test. These are real FTC robots and subsystems
that teams published on GitHub, listed in [`sources.json`](sources.json):

| File | What it is |
|---|---|
| `ftc8375-worlds-2016.step` | FTC 8375 Vulcan Robotics' 2016 World Championship robot, whole (299 parts, inches) |
| `ftc8400-arm-2024.step` | FTC 8400 Perfect Paradox's 2024 arm on slides (REV parts) |
| `centerstage-deposit.step`, `centerstage-intake.step` | a CENTERSTAGE lift and deposit, and an intake with belts |
| `ftc19234-itd-claw.step` | FTC 19234 ByteForce's INTO THE DEEP claw |
| `ftc30843-decode-intake.step` | FTC 30843's DECODE intake (exported as two bodies) |
| `gobilda-uchannel-chassis.step`, `ultimate-drivebase.stp` | two drivebases |

The files stay out of the repo (AGENTS.md rule 6) and under their owners' terms; we only read them.

```bash
node research/realcad/fetch.mjs                              # into ../ftc-cad-corpus
node --max-old-space-size=8192 research/realcad/run.mjs      # parse, drivetrain, finder, robot check
```

[`results.txt`](results.txt) is the last run. These files come without the team's code, so the
robot check here reports the CAD side only. The full check (devices, and servo ranges from the
code) needs a robot and its OpMode, like GearGurus 7832's in `tests/robotcheck.test.mjs`.

What the set showed so far: every file parses. The finder alone gets real robots wrong (see
[docs/robot-check.md](../../docs/robot-check.md)). That's why the plan is exact mates plus a robot
check that asks the team, rather than more mechanism types.
