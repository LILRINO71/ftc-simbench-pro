# Online matches

One BIOBUZZ match with other teams, each driving their own robot, from their own CAD and their own
code, on their own computer. Alliance partners practise together, and opponents play against each
other. Any empty place gets an AI robot ([match.md](match.md)).

Open **Online** in the top bar.

| | |
|---|---|
| **Quick match** | Joins the fullest open match that has a free place. If there isn't one, it starts a new match that others can find. |
| **Host a match** | Opens a room with a 5-letter code (like `K7QMX`). **Copy invite link** gives a link that opens SimBench with the code filled in. Tick **Listed under Open matches** to let anyone find it. |
| **Join** | Type a code, or pick one under **Open matches**. |

## In the room

- **Places:** four, RED 1 and 2, BLUE 1 and 2. Take any free one, or **Just watch**. Up to eight people fit in a room; anyone without a place watches.
- **Ready:** load your robot and pick an OpMode of the match's kind (a TeleOp for a TeleOp match), then press **I'm ready**.
- **Host settings:** the host picks the period (TeleOp 2:00 or Auto 0:30) and how good the AI robots are, and presses **Start the match** once everyone with a place is ready.
- **The start:** every robot goes to its place's start (G304) and INITs. After a 3-second countdown, every robot STARTs at the same moment.

## During the match

| | |
|---|---|
| **Your robot** | Runs on your computer, from your code, with your gamepad, exactly as it does on its own. |
| **The other robots** | Drawn from their own CAD, their mechanisms moving as their drivers move them, with their team over them. Until a robot's copy has arrived, a stand-in robot of its real size takes its place. Robots that touch push each other apart. |
| **Chat** | To everyone, or to your **Alliance** only. The other alliance never receives alliance messages. |
| **Marks** | Pick **Go here**, **Shoot from here** or **Defend here**, then click the map of the field. A ring shows on your partner's map and on their field for 8 seconds. Only your alliance sees it. |
| **The end** | Everyone sees the same final score and each robot's shots and hits. The host can press **Play again** with everyone in the same places. |

## How it works

`src/net.js`, with the protocol tested in `tests/net.test.mjs`.

- **Who runs what.** One player hosts. The host's bench runs everything that isn't a player's robot: the AI robots, the HUMAN PLAYERS, every loose element, the FLOWERs, the HIVEs and the score. It sends that to everyone 12 times a second. Every other bench mirrors it and runs only its own robot.
- **Robot positions.** Each player sends where their robot is 20 times a second, and where each of its mechanisms is 10 times a second. Everyone draws the other robots a tenth of a second behind (`NET_DELAY`), between two positions actually heard, so they move smoothly however the network bunches messages. A guest shows the host's match (the AI robots, the elements, the HIVEs) on the same delayed clock, so a ball leaves the floor as the robot reaches it.
- **Each robot's own CAD.** When players meet, each robot goes to the others once as a light copy (`src/robotlite.js`): a simplified mesh of the chassis and of each mechanism, packed and checked against its hash. A robot the other computer already has (the default robot, say) isn't sent at all.
- **Shots.** A player's shot is launched on their own computer (their flywheel, their hood, their aim, the same scatter). The launch goes to the host, whose Shot Sim flies that exact launch again and decides it. Every TIP is decided in one place, and a ball still in the air when its HIVE tips doesn't count, whoever threw it.
- **Contact.** When two robots touch, each computer moves its own robot half the way out, and the host moves the AI robots.
- **One clock.** Each guest measures how far its clock is from the host's, from the quickest of several round trips. That way the countdown ends at the same moment everywhere, even on a computer whose clock is seconds off.
- **Nothing from another computer is trusted.** Every message is checked and clamped: sizes, numbers, names, places. Only the host may say where things are, and a shot that doesn't start where that player's robot is gets thrown out. Chat is always shown as plain text. `tests/net.test.mjs` sends a match junk and lies from a stranger and checks that nothing changes.

## The network

School networks drop UDP, which WebRTC needs, and WebSockets to hosts their filter doesn't know, which the public relays are. The one path a school can't block without blocking SimBench itself is HTTPS to SimBench. So going online climbs a ladder (`netConnect` in `src/netrelay.js`), and takes the first rung the site has:

| Rung | How | Needs |
| --- | --- | --- |
| Match rooms on this site | A WebSocket to `/room/<name>/ws` on SimBench's own origin. Where a proxy strips WebSocket upgrades, Server-Sent Events down and batched POSTs up, which is plain HTTPS. | The site's room service is switched on (DEPLOY.md, "Online rooms") |
| WebRTC through TURN | Browsers connect directly; where they can't, through Cloudflare's TURN relay, which also listens on TCP port 443. | The site has TURN credentials (DEPLOY.md) |
| WebRTC | Browsers connect directly, found through public Nostr relays (Trystero). | Nothing: this is how it always worked |

- **The rooms** (`workers/room/room.js`): one Cloudflare Durable Object per room. It relays each message to everyone or to the players named, always stamped with who really sent it; tells everyone who arrives and leaves; tells the time, so the countdown is the same whoever hosts; and keeps each tick's commands for lockstep matches (`src/lockstep.js`). It refuses taken or malformed ids, full rooms, oversize messages and floods, and only this site's own pages may use it. It runs no physics, and it hibernates between messages.
- **Direct connections.** On the WebRTC rungs, browsers connect straight to each other. They find each other through public [Nostr](https://nostr.com) relays, using the [Trystero](https://github.com/dmotz/trystero) library (MIT), loaded from jsDelivr (or esm.sh) only when someone opens **Online**. SimBench names its relays (`NET_RELAYS` in `src/net.js`): seven large public ones, all used at once.
- **Your IP address.** On the WebRTC rungs, like any peer-to-peer game, the other players' browsers can see your IP address. In a room, only SimBench's server sees it.
- **Still can't connect?** On a site without rooms, some school and company networks block direct connections between browsers. A phone hotspot or a home network works.
- **Tab in the background.** A browser gives a hidden or covered tab no animation frames. While a match is on, SimBench keeps stepping it from a timer instead, so a host who switches tabs doesn't freeze everyone.

## Lockstep (built, not yet the match's default)

`src/lockstep.js` is the bookkeeping for matches where every computer runs every robot and only each robot's motor and servo commands travel: a 16-bit encoding (a tick's commands for one robot are a few dozen bytes), the ledger that plays tick T only once every robot's commands for T are in, a stand-in (motors off) for a robot whose commands stop coming, and a hash vote that names the computer that diverged. The rooms carry and keep the ledger. With Jolt Physics for the mechanisms (`src/joltmech.js`), three computers fed the same commands in a scrambled order end in identical states (`tests/lockstep.test.mjs`). Today's matches still run as described above; switching them to lockstep needs every computer to simulate the other teams' drivetrains from their robot packages, which is the next step.

## What it isn't yet

- **The host leaving ends the match.** It ends for everyone; nobody takes over as host. After the final buzzer, everyone keeps the result.
- **A player leaving mid-match.** Their robot leaves the field, and no AI robot takes their place. If they come back before the end, they watch.
- **Unlimited balls.** Players' robots still launch from an endless supply, the same as on your own; only the AI robots have to pick elements up.
- **No voice chat.** Trystero can carry it, but SimBench doesn't use it yet.
