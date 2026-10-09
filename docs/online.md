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
| **The other robots** | Drawn at their real size with their team on the bumpers. Robots that touch push each other apart. |
| **Chat** | To everyone, or to your **Alliance** only. The other alliance never receives alliance messages. |
| **Marks** | Pick **Go here**, **Shoot from here** or **Defend here**, then click the map of the field. A ring shows on your partner's map and on their field for 8 seconds. Only your alliance sees it. |
| **The end** | Everyone sees the same final score and each robot's shots and hits. The host can press **Play again** with everyone in the same places. |

## How it works

`src/net.js`, with the protocol tested in `tests/net.test.mjs`.

- **Who runs what.** One player hosts. The host's bench runs everything that isn't a player's robot: the AI robots, the HUMAN PLAYERS, every loose element, the FLOWERs, the HIVEs and the score. It sends that to everyone 12 times a second. Every other bench mirrors it and runs only its own robot.
- **Robot positions.** Each player sends where their robot is 20 times a second. Everyone draws the other robots a little ahead of where they were last heard, so they move smoothly.
- **Shots.** A player's shot is launched on their own computer (their flywheel, their hood, their aim, the same scatter). The launch goes to the host, whose Shot Sim flies that exact launch again and decides it. Every TIP is decided in one place, and a ball still in the air when its HIVE tips doesn't count, whoever threw it.
- **Contact.** When two robots touch, each computer moves its own robot half the way out, and the host moves the AI robots.
- **One clock.** Each guest measures how far its clock is from the host's, from the quickest of several round trips. That way the countdown ends at the same moment everywhere, even on a computer whose clock is seconds off.
- **Nothing from another computer is trusted.** Every message is checked and clamped: sizes, numbers, names, places. Only the host may say where things are, and a shot that doesn't start where that player's robot is gets thrown out. Chat is always shown as plain text. `tests/net.test.mjs` sends a match junk and lies from a stranger and checks that nothing changes.

## The network

- **Direct connections.** Browsers connect straight to each other with WebRTC. They find each other through public [Nostr](https://nostr.com) relays, using the [Trystero](https://github.com/dmotz/trystero) library (MIT). Trystero is loaded from jsDelivr (or esm.sh if jsDelivr fails), pinned to one version, and only when someone opens **Online**.
- **Which relays.** SimBench names its relays (`NET_RELAYS` in `src/net.js`): seven large public ones, all used at once, so one or two being down doesn't stop anyone. Left to itself, Trystero picked the same 5 of its built-in 28 for every SimBench player, and two of those were down or refused connections, so players often never found each other. Only "who is in which room" goes through a relay; the match itself is direct.
- **No server.** The match itself never passes through any server, and SimBench runs none. There's no account, no sign-in and no API key.
- **Your IP address.** Like any peer-to-peer game, the other players' browsers can see your IP address.
- **The ladder.** Going online, the page asks the site first (`/room/health`, `src/netrelay.js` `netConnect`): when the site runs its own match rooms (`functions/room`, `workers/room`, DEPLOY.md "Online rooms"), players meet there over HTTPS on SimBench's own address, which a school filter can't block without blocking SimBench; a room relays messages over a WebSocket, or Server-Sent Events and POSTs where a proxy strips WebSockets, and tells everyone the same time. Without rooms but with TURN credentials, WebRTC goes through Cloudflare's TURN on port 443. Without either, it is direct WebRTC as above.
- **Blocked networks.** Until the site's rooms are switched on, some school and company networks block direct connections between browsers. If players can't connect, try a phone hotspot or a home network.
- **Tab in the background.** A browser gives a hidden or covered tab no animation frames. While a match is on, SimBench keeps stepping it from a timer instead, so a host who switches tabs doesn't freeze everyone.

## What it isn't yet

- **The host leaving ends the match.** It ends for everyone; nobody takes over as host.
- **A player leaving mid-match.** Their robot leaves the field, and no AI robot takes their place.
- **Other teams' robots are boxes.** They're drawn at their real size, not from their CAD.
- **Unlimited balls.** Players' robots still launch from an endless supply, the same as on your own; only the AI robots have to pick elements up.
- **No voice chat.** Trystero can carry it, but SimBench doesn't use it yet.
