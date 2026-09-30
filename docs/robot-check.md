# Making every robot right: exact mates, a robot check, and questions

No finder that reads geometry can be right about every robot. A STEP file doesn't say which bolt
is tight and which is a pivot, and real CAD has parts drawn overlapping. Testing on eight real
team files (below) showed it: the finder that scored 33 of 34 joints on generated mechanisms gave
real robots joints with no parts, belts that aren't there, and, on one robot, a joint list that
didn't even load.

So the bench doesn't promise to guess right. It promises that **every robot ends up right, for
that team's own robot and code, and that it never shows a wrong robot without saying so.** Three
pieces do that together:

1. **Exact joints when they exist.** Onshape mates (`src/mates.js`) give exact axes, pivots,
   limits and the parts each joint carries. The **Send to SimBench** bookmark
   (`src/onshapelink.js`) brings them over in one click from the team's Onshape tab, using their
   own sign-in. The robot travels inside the link, so nothing is uploaded, and no API key is needed.
   There's still a by-hand way: two links to open while signed in, with the saved pages dropped back in.
2. **A robot check against the team's own code** (`src/robotcheck.js`, the **Robot check** section
   of the Robot tab). Whatever the joints came from, it checks them against the OpMode:
   - every motor and servo the code moves drives a joint
   - every joint carries parts, and something in the code drives it (or it follows a joint that is driven)
   - the code's drive motors match the CAD's wheels
   - moving each joint a little doesn't push its parts into the frame. It only moves a joint the
     ways its limits allow, and a servo only as far as the team's code actually sends it.
3. **Questions, in the team's own names.** Anything the check can't confirm becomes a question with
   its likely answers: *"Your code moves `outClaw`, but no joint is tied to it. Which one is it?"*,
   with each candidate joint's **show** button (it zooms to the parts and swings them) and a
   **this one** button. If none fits, **Click it in the CAD view** makes a new joint for that device.
   Each answer is saved in the robot's joint spec (per STEP file in the browser, downloadable as
   `.joints.json`), so it's asked once.

It's personalised, not generic: the devices, their names and the ranges come from the team's code,
and the answers become that robot's joint spec.

## What "right" means, per robot

A robot is **ready** when the check has nothing left to ask:

| Check | Passes when | Otherwise it asks |
|---|---|---|
| Source | the joints are from Onshape mates or a joint spec | "Use my Onshape mates" (or confirm the ones below) |
| Devices | each motor and servo the code moves drives a joint | which joint it is, or to click the part it moves |
| Joints | each joint carries parts and something drives it | to remove it, or which device drives it |
| Drivetrain | the code's drive motors match the wheels on the floor | (a warning: check the drivetrain) |
| Swing | moving a joint doesn't push its parts into the frame | to look: a frame part on the joint, or the wrong axis |

On GearGurus 7832's robot with its hand-written joints and the team's TeleOp, it's ready: all ten
devices tied to joints, nothing to ask. With the finder's joints it asks nine questions: the eight
servos plus the lift motor, whose likely answer is offered first (the slides). Put a frame rail on
the arm and the swing check names the rail it hits. `tests/robotcheck.test.mjs` holds all of this.

## The real-team test set

[`research/realcad`](../research/realcad/README.md) lists eight CAD files real teams published on
GitHub: FTC 8375's 2016 World Championship robot, FTC 8400's 2024 arm, a CENTERSTAGE deposit and
intake, FTC 19234's INTO THE DEEP claw, FTC 30843's DECODE intake, and two drivebases.
`fetch.mjs` downloads them outside the repo; `run.mjs` runs the parser, the finder and the robot
check on each. It already found two bugs, both fixed:
- a pinion driving two gears gave both followers the same name, so the joint list didn't load
- joints that ended up with no parts

`tests/autorig-zoo.test.mjs` now has a generated robot for the first bug.
