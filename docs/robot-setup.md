# Robot setup: once per robot

The bench reads a robot's floor, front, drive base and joints from its STEP file by itself, and it
gets most robots right. No automatic reader gets every team's CAD right, though: a wheel left out of
the assembly, a robot exported lying on its side, a drive base drawn as plain blocks. So every robot
gets a short setup the first time it loads. The team checks four things, fixes anything that's wrong
by clicking (or by typing a few numbers), and the bench never asks again.

## The four checks

Open **Robot → Robot setup**. A new robot shows **New robot: set it up once** in the corner of the
field view as a reminder.

| Check | What the bench found | Fix it by |
|---|---|---|
| **Floor and up** | which CAD axis is up, from the drive wheels | picking the axis (auto, Z, Y, −Y, X, −X) |
| **Front** | the way the wheels roll | picking the front (+x, +y, −x, −y); **Top view** shows it facing up the screen |
| **Drive base** | the type, the wheels, their size, the track and wheelbase, the mecanum roller pattern, and anything it had to assume | **Set it by numbers**: type, wheel diameter, track, wheelbase, rollers X or O, and moving the drive base's centre forward or left |
| **Joints and your code** | the robot check's questions | answering them in **Robot check**, or fixing joints in the **CAD** view |

Each check is marked done when you press **Looks right** or change something. **Set it by numbers**
works for any robot, even one whose CAD has no wheels at all. Your chassis' numbers are on its kit's
product page, or measure wheel centre to wheel centre.

## Saved, and shared

- **This browser** keeps the setup for the STEP's file name, so it comes back every time that robot
  loads, including after you export the CAD again under the same name.
- **Download setup** saves one small file, `<robot>.simbench.json`. A teammate drops it in with the
  STEP, in either order, and gets the same robot: up, front, drive base, joints, device mapping and
  shooter. A setup file dropped before its STEP waits for it.

## What the bench reads by itself first

The setup is the guarantee. These make it rarely needed:

- **Wheels made of many parts.** A goBILDA or REV mecanum wheel is two side plates and a ring of
  rollers, often named nothing like a wheel. The CAD's own wheel sub-assembly is read as one wheel.
  A flattened file's wheel parts are grouped by where they sit.
- **Mecanum or omni from the rollers.** Rollers at about 45 degrees to the axle are mecanum, square
  on are omni, whatever the parts are called. The roller touching the floor gives each mecanum
  wheel's hand. Only the standard X pattern is taken as standard; an "O" base, or wheels on the
  wrong corners, is modelled as drawn and flagged.
- **One wheel drawn.** The other three are placed as its mirror images through the middle of the
  four drive motors, when the CAD has them. That's not the middle of the whole robot, which an
  intake out one side would move. The robot check says it did this.
- **Up and the front** come from the same wheels, so the frame and the drivetrain always agree.

Anything the bench had to assume shows up in the drive base check and in the robot check, so the
team knows what to look at.
