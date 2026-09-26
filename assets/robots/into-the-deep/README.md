# GearGurus 7832 · Into The Deep (2024-25)

The robot FTC SimBench Pro opens with. Published here at the team's request.

| file | what it is |
| --- | --- |
| `robot.step.gz` | the team's Onshape export (AP242, 773 parts, 52.6 MB unzipped). The app inflates it in the browser. |
| `joints.json` | the robot's joint spec (`ftc-sim-bench.joints`, see `src/jointspec.js`): which parts ride on the lift, the outtake arm and claw, the linkage-driven intake extension, the intake arm, wrist, twist and claw, with each joint's axis, travel and the servo position the CAD was drawn at |
| `sample_teleop.java`, `BAL.java` | the team's TeleOps, unchanged |
| `TheHolyGrail.java` | the team's Road Runner 1.0 specimen auto, unchanged |
| `MecanumDrive.java`, `Arm.java`, `Arm_PID_Class.java`, `Slides_PID_Class.java` | the helper classes the auto needs: the drive's motors and `PARAMS`, the `Arm` class with its Road Runner actions, and the PID helpers. The app loads them as helper classes. |
| `LICENSE-TeamCode.txt` | the licence the team's code repository carries |

What the bench finds when it runs this code:
- `sample tele` drives every mechanism the way the robot does (`tests/into-the-deep.test.mjs`).
- The Holy Grail passes all of its scoring and pickup waypoints within 2 in, in order.
- The auto was written for the Into The Deep field, so the app runs it against the walls only.
- `MecanumDrive` looks up its right-back motor as `" bR"`, with a space, while the TeleOps use
  `"bR"`. On the real robot only one of the two can match the configuration.
- The auto never starts `UpdatePID1`, so the slides are never powered in auto.
- `uppies1` is declared but its `setPower` is commented out in the TeleOps; only `uppies` lifts.

The OpModes come from
[eli-lame/GearGurus7832_Into_the_Deep_24-25](https://github.com/eli-lame/GearGurus7832_Into_the_Deep_24-25)
at commit `0e537b1`, under the BSD 3-Clause Clear licence in `LICENSE-TeamCode.txt`.

## Reading the joint spec

Millimetres and degrees, in the bench's robot frame: +z up, origin at the drivetrain
centre on the floor, the intake at −x (the robot's front). A joint turns right-handed
about its axis, or slides along it, as the value the team's code sends goes up.

Things the CAD doesn't say, taken from the team's code:

- The outtake arm counts 1425.1 ticks per turn (`ticks_in_degrees = 1425.1/360`), so it
  is simulated as a 50.9:1 Yellow Jacket, though the CAD shows a 19.2:1.
- The lift: 2650 ticks (the high basket) is about 0.69 m of travel, 0.26 mm per tick.
- The CAD is posed at the hand-off: `inY` 0.69, `inPiv` 0.1, `inClaw` 0.51 (closed),
  `linkL`/`linkR` 0.56 (intake in), `outClaw` 0.43 (open), `outRot` 0.32.
- The left extension linkage is drawn folded the wrong way, through the floor. The spec
  turns its crank 149.2° so it matches the right side (issue #5).
