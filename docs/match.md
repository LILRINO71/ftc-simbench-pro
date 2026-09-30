# The match: AI robots and human players

A robot never plays alone. With **Match → AI robots and human players** on (the Match menu in the top
bar), the bench fills the field around the team's robot for the period its OpMode runs, AUTO (0:30)
or TELEOP (2:00):
- an alliance partner and two opponents that the bench drives
- each alliance's HUMAN PLAYER

Each INIT starts a new match; the random parts come from a seed, so a match can be replayed exactly.

## What they do

| | |
|---|---|
| **AI robots** | Collect POLLEN (and their own NECTAR), launch it into their own up-CELL, move to the other side after every TIP, put NECTAR on FLOWERs in the last minute, and PARK in their LOADING ZONE at the end. Their shots go through the same Shot Sim as the team's, with the same scatter, into the same HIVEs: a TIP counts whoever makes it. |
| **Human players** | Stand at the alliance wall with 5 NECTAR. One goes into the LOADING ZONE after each of their HIVE's TIPs, and all that's left in the last 60 s. Nothing in AUTO. |
| **Getting around** | A path planner (A* on a 9 cm grid) round the HIVE's legs and foot bars, the FLOWERs, the walls and every nearby robot, with robots allowed under the HIVE between its legs. |
| **Contact** | Robots are boxes that can't overlap: two that touch are pushed apart, half each. The team's robot pushes and gets pushed the same way, and still can't leave the field. |
| **Scoring** | TIPs, LEAVE and PARK in AUTO; TIPs, the up-CELL, FLOWERs (owner and bottom NECTAR), GARDENs and PARK in TELEOP. The scoreboard over the field shows it live. |

## The rules they keep

Checked every tick in `tests/match.test.mjs`:
- **G402:** in AUTO, only their own side of the field
- **G407:** never more than 4 elements
- **G408:** never the other alliance's NECTAR
- **G410:** NECTAR into a FLOWER only in the last 60 s
- **G417:** a TIP only by launching into their own up-CELL
- **G418:** only POLLEN comes out of a FLOWER, from the bottom
- **G426 / G427:** a human player enters one NECTAR per own TIP, or any in the last 60 s, always into the own LOADING ZONE

A ball still in the air when its HIVE tips doesn't count in the new up-CELL. That applies to the team's shots too.

## How good they are

Pick **Rookie**, **Typical** or **Elite** in the Match menu. The levels are calibrated against the
strategy study's estimate for the best alliances: about 11 TIPs in TELEOP for an elite pair, about 7
for a typical pair and about 3 for rookies.

## What it isn't

- **Human-player scripts:** the AI robots don't coordinate with the team's robot. They avoid it and push it like anyone would.
- **Your robot's supply:** it still launches from an endless supply; only the AI robots have to pick elements up.
- **Physics:** the AI robots are generic 18-inch robots with a flywheel and an intake. Their motion is planned, not simulated through motors the way the team's robot is.
