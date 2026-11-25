# SimBench on a phone

Open the page on a phone and the robot drives in under a minute, with no keyboard and no import.

## First visit

On a phone the first screen is one card with one button, **Drive the sample robot**. It waits until the GearGurus 7832 robot and their TeleOp are loaded, then picks that TeleOp, switches to the chase camera, presses START and puts the controls up. **Look around first** leaves the card and opens the panels instead. The card shows once per browser (`ftcbench.quick`); a link with `?opmode=`, `?robot=` or `?start=` in it skips it.

A phone is a touch screen whose short side is under 600 px. Panels and controls take turns there: **drive mode** hides the side panels, the dock and the readouts and shows the field with the controls; **Panels** goes back, and **Drive with touch** comes back to the controls.

## The controls

Left stick, right stick, A B X Y, the D-pad, and both bumpers and triggers, all at least 44 px. Several fingers work at once, so one thumb drives while the other turns. They write into the same `Sim.pad[1|2]` the keyboard writes (`src/touch.js`), so the team's Java reads them unchanged.

- Each control goes to the gamepad the OpMode reads it from (the keyboard's own rule, `padFor`). A stick or button both gamepads read goes to the one picked with **Gamepad 1 / 2** in the control bar.
- The sticks have a dead zone of 12 % of their travel, then ramp to 1 at the rim, and never go past it. Down and right are positive, as in the FTC SDK.
- A tapped button stays down for at least 70 ms: the OpMode looks at its gamepad every 20 ms, and a quicker tap would go by unseen. Where the browser has `navigator.vibrate`, a button press buzzes for 6 ms.
- On a small phone held sideways (under 720 px wide) the sticks shrink a little and Reset, Fullscreen and Panels sit behind the dots next to the gamepad toggle.
- The pad has `touch-action: none`, and drive mode stops the page scrolling and zooming.

On a desktop the controls stay hidden. **Touch controls** in the menu (top right, the three dots) shows them; a touch screen that the browser does not call coarse shows them at the first touch on the field.

## Fullscreen and the home screen

**Fullscreen** (where the browser has the Fullscreen API) also asks Android for landscape. In portrait a line says to turn the phone. On iPhone, which has no page fullscreen, add the page to the home screen: the menu item **Add to home screen** opens the install prompt where there is one and says how in Safari where there is not. `site/manifest.webmanifest` and the icons beside it (`tools/make-icons.py` draws them from the logo) make it an installable app.

## Challenges

Four cards on the sample robot, one at a time, each with a live line and **Skip**. They start with the quick start, or from **Guided challenges** in the menu. Each is checked against what the simulator holds, and only counts while the OpMode is running:

| Card | Done when |
|---|---|
| Drive to the far tile | the robot's centre is in the last row of tiles, on the other alliance's wall (the HIVEs are in the way, so it goes around) |
| Turn to face a HIVE | the front is within 10 degrees of the line to a HIVE for half a second, after it was 30 degrees or more off |
| Move the lift or the claw | a servo or motor off the drivetrain moves (0.12 of a servo's range, or 150 ticks), more than 1.5 s after START |
| Park in your LOADING ZONE | any part of the robot is over its own LOADING ZONE and it has been still for a second (the rule the match scores PARK by) |

The checks are `chalFar`, `chalFace`, `chalMove` and `chalPark` in `src/challenges.js`; `tests/challenges.test.mjs` runs them on snapshots and plays all four on the simulator. There is no card for picking up POLLEN or scoring in a GARDEN: the team's own robot never holds or places game pieces in the simulator, so there is nothing to check.
