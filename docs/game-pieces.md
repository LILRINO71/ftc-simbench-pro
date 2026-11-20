# Game pieces through the team's robot

The team's robot handles POLLEN and NECTAR the way its code does: an intake picks a ball up off the
tiles, the robot holds four at most, a piece travels to the shooter and waits there, a feeder or gate
lets it out (or, with neither, the intake pushes it into the shooter once that turns), an intake run backward puts one
out, and the flywheel slows as each ball takes its energy. It all comes from the OpMode's device names
and types, so it works for any team's code. The engine is `src/payload.js`; tests are in
`tests/payload.test.mjs`.

## The roles

| Role | Found by | Can be set in |
|---|---|---|
| **Intake** (up to 4, one mouth each) | a motor or CR servo named `intake`, `collect`, `sweep`, `suck`, `pickup`, or a `roller` that isn't the shooter. Not a slide, lift, arm, pivot, wrist or claw. | Shot tab → Game pieces: Intake, Second intake |
| **Transfer** | a motor or CR servo named `transfer`, `index`, `conveyor`, `belt`, `uptake`, `elevator` | Transfer |
| **Feeder or gate** | the Shot tab's feeder (`kick`, `flick`, `push`, `gate`, `stopper` ...), unless it is the intake or the transfer | Your shooter → Feeder |
| **Shooter** | the Shot tab's flywheel and every other motor named like a shooter (`shoot`, `flywheel`, `launch`, `outtake`) | Your shooter → Flywheel |

`Shots.detect` returns all four lists; `Shots.adopt` fills `Shots.cfg.payload` (intakes, transfer) the
way it fills the shooter and feeder.

## Where the mouth is

- **Default:** just outside the front edge of the footprint box (`Sim.footprint`, placed with
  `footBox`), the box's full width less 1 cm a side.
- **A name with `back` or `rear`:** the back edge (`front` in the name: the front).
- **A device on a CAD joint that turns:** the edge nearest the joint's pivot, centred on and as wide as
  the parts the joint moves. A device the mapping put on a slide is moving something else and keeps the
  default.
- **Two intakes nothing places** are taken to be one at each end: a robot with two intakes almost always
  has them so. Team 7831's `FullRobotTeleOp` has `intake` at the back and `intake2` at the front, the
  other way round from this guess: set each one's edge in the Shot tab.

A ball is in the mouth when it lies on the tiles with its centre at most two radii beyond the edge
(about one radius of strip outside a ball touching the robot) and across the mouth's width.

## Which way is in

Set it per intake (in: + power / − power), or leave it to be found: **the way the intake is running the
first time a loose ball lies in its mouth** (above 20 % power for 0.15 s) is "in", because an intake run
at a ball is taking it in. A driver who holds the intake on the way to a ball has it decided the moment
the ball is there. With pieces already inside (an AUTO's pre-loads) the way it runs while the flywheel
is up to speed is "in": it is feeding the shooter. The other sign ejects. Running the intake with no
ball near decides nothing, so a tap of reverse on an empty robot does no harm. The CAD can't settle it:
a roller's axis says nothing about which side of it the ball passes. What was decided, how, and when is
in the Shot tab and in a headless run's `payload.intakes` (`inFrom`: `first ball`, `first feed`, `pinned`).

An intake or a flywheel the code runs but that cannot turn, because the joint it is bound to is at its
stop (the wrong joint for it: a lift, an arm), is said once in the notes with the joint's name, and is
listed in `payload.notTurning`.

## Picking up, holding, letting out

- **Picking up.** While an intake runs inward a ball in its mouth is gripped (the AI robots' own
  mechanism: `e.hold` and `ballWorld.carry`) and rides in. It takes (ball diameter + 5 mm) at half the
  roller's surface speed (a ball rolling between a moving roller and a still surface), from the device's
  own speed (`act` × its spec rpm) and the roller diameter (48 mm unless set), never quicker than 0.06 s
  or slower than 2.5 s. An intake that stops or reverses first lets it go. A robot holding four (counting
  a ball in a mouth) grips nothing; the box just pushes the fifth.
- **Inside.** Held pieces are an ordered list of `{kind, color}`. Each travels 0.8 of the footprint length
  to the shooter end at half the surface speed of the transfer (or, without one, the intake running
  inward), a ball's width apart.
- **Letting one out.** With a feeder, each feeder pulse (as before: a servo leaving its rest, a motor
  running pushes one per 0.5 s) takes the next piece waiting at the shooter; none waiting, nothing is
  launched and one note says so. A gate (`gate`, `stopper`) held open lets the rest follow. A feeder
  servo's rest is where the code first puts it. With no feeder or gate (Team 7831's Meet 0 robot: the
  intake pushes balls straight into two shooter rollers) a waiting piece leaves while the intake or
  transfer is running inward and `Shots.exitSpeed()` is at least 1 m/s, no closer together than the ball
  takes to clear the shooter ((its diameter + half the wheel) at the exit speed). With nothing pushing
  it, a piece sits short of the wheels however fast they turn: spin up, then feed. Feed into a shooter
  that is only just turning and the ball dribbles out at whatever speed the wheels have reached. The ball launched is the piece's kind and colour.
- **Reverse.** With pieces held, an intake running the eject way puts the last one in out through its
  mouth, on the same take-in time, onto the tiles at 0.5 m/s away from the robot.
- **FLOWERs and the LOADING ZONE.** A running mouth at a FLOWER's bottom opening takes its POLLEN one at
  a time (G418) on the same take-in time. A HUMAN PLAYER's NECTAR is a loose ball like any other. Taking
  the other alliance's NECTAR (G408) isn't blocked, since a real intake can't tell, but it is noted once
  per piece.
- **Pre-load.** 4 POLLEN at the shooter end at the start of an Autonomous OpMode (G304); none in TELEOP;
  or 0 to 4 set in the Shot tab.

## The flywheel pays for the shot

A ball leaving takes the Shot Sim's `shotEnergyJ` out of the flywheels (`vendor/biobuzz-shot-sim`,
`motorModel`): its kinetic energy at the exit speed the wheels give it, its spin (the Shot Sim's
`shooterSpin` share), and the Shot Sim's slip loss factor (2). Every motor Payload marks as a flywheel
slows by the same share, `sqrt(1 − E / KE)`.

A marked motor no longer ramps at the bench's fixed `SLEW` (8 power units a second, which would undo a
10 % drop in about 12 ms). Its speed follows its voltage as a DC motor's does, with time constant
**T = I × ω_free / τ_stall** at the wheel: I is the Shot Sim's wheel set (its `medium` preset, 4.0e-4
kg m²: two 96 mm Geckos and an 82 mm steel flywheel) plus the motor's rotor (5e-6 kg m², the figure
`src/joltmech.js` uses) through its gearbox and the wheel gearing; free speed and stall torque come from
the device's spec in `src/hardware.js`, else from the Shot Sim's motor table. Under `setVelocity` the
hub's loop is modelled as driving near full voltage until the wheel is close, then holding it. Every
other motor keeps `SLEW`.

**What "plausible" means, and what the tests hold.** Plausible here is: the same first-order DC-motor
model the Shot Sim's SPEC uses, fed with goBILDA's catalogue free speed and stall torque and wheel
inertias from catalogue masses, so the bench and the Shot Sim agree. A goBILDA 6000 rpm 1:1 motor
(0.144 N m stall) on that wheel set has T ≈ 1.8 s: 95 % of free speed at 3T ≈ 5.3 s from rest (a single
bare 96 mm wheel, 1.3e-4 kg m², would take about 1.8 s). The tests hold 95 % at 3T to a tick, between 2
and 8 s for this build, and T against the Shot Sim's own `tauS` within the rotor's few percent. A POLLEN at full speed takes about 5 % of the wheel's
speed, within 10 % of the Shot Sim's `dip` (it measures from the speed the exit needs, the bench from the
wheel's share of catalogue free speed). Recovery to within 1 % takes T ln(dip / 1 %), about 2.8 s for this
heavy wheel, within 20 % of the Shot Sim's open-loop `recoveryMs`.

## Supply

| Mode | When (auto) | What it does |
|---|---|---|
| **real** | the code has an intake, or the user pre-loads | everything above |
| **unlimited** | the code has a shooter but no intake | the old bench, exactly: a ball from nowhere at every feeder pulse, the flywheel on `SLEW` |
| none | no intake and no shooter | nothing changes (the Into The Deep robot) |

The Shot tab can force real or unlimited. **Online matches stay unlimited for now:** `src/net.js` decides
the shots on the host and is unchanged.

## Pieces on the field without the AI robots

With **Match → AI robots and human players** off and **Game pieces without them** on (the default), a
robot with real pieces plays **solo**: `Match.reset({solo:true})` stages the GARDENs, the FLOWERs and the
TELEOP scatter, the HUMAN PLAYERS enter NECTAR after TIPs, there is no clock of its own and no score
board (`Match.live()` stays a match with AI robots or online). `Match.pieces()` is the one test for
"loose pieces on the field": the view, the minimap, `Shots.ballBoxes` and the misses (`Match.adopt`) all
use it, so there is one list of loose balls, `Match.floor`. Switching it off clears the field.

## Headless

`runOpMode({..., field})` (command line `--field`) runs the OpMode on the field with these pieces and adds
`payload` to the result; see [code-support.md](code-support.md#running-an-opmode-without-the-page-toolsrun-opmodemjs).

## What it isn't (yet)

- No jams, no double feeds, no ball stuck half in: a ball is in or out.
- The roller diameter and the path length are settings, not read from the CAD.
- The bench's robot holds pieces as a list; the view doesn't draw them inside the CAD robot.
- Online matches: still the unlimited supply.
