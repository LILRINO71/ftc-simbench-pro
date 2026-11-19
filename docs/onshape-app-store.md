# The Onshape link for every team: the App Store plan

Written 2026-10-09. The pasted Onshape link is the way a team brings its robot in
([robot-setup.md](robot-setup.md)). It reads the assembly through Onshape's API, signed in as the
team, through the relay in `functions/onshape/`. The OAuth app is registered and switched on: the
live site's `/onshape/status` says `ready:true`. This page covers what that costs, how to make it
free for every team, and whether it is accurate.

## Why the App Store

Onshape meters API calls per year ([limits](https://onshape-public.github.io/docs/auth/limits/)):

- An app that isn't publicly listed in the App Store is a **private** app. Every call it makes
  counts against **the app owner's** allowance, whoever signed in: 2,500 a year on a Free,
  Standard or EDU Student account.
- When the allowance is spent, Onshape answers 402 to every call until the year renews. SimBench
  then stops the read and offers the export zip. More calls can only be bought.
- Calls from an app **listed publicly in the App Store** count against nobody.

One import costs about 3 calls plus 2 per Part Studio the robot uses, so a big robot's first read
is around 200 calls. On the private app, 2,500 a year covers the owner's own team and a few
testers, and that's all. The App Store listing is the only free way to open the link to every
team. DEPLOY.md, "Quota", has the detail, including what the browser and edge caches save.

The App Store is the marketplace built into Onshape: a team finds an app there and adds it to its
account. A listing changes **who pays for the calls**, not how the import works: same code, same
sign-in, same client ID, nothing to change in Cloudflare. There is precedent: FRCDesignApp
(formerly MKCad), a community-built FIRST app, is listed there and free for teams.

## Is the link accurate?

It is built to be more accurate than the export zip:

| | The link | The export zip |
|---|---|---|
| Gear, rack and screw relations | read exactly from the mate relations (`src/mates.js`) | URDF can't carry them: inferred as hints, applied only when the code confirms |
| Planar mates | read as the mate they are | exported as chains of connector slides |
| Mate limits in sub-assemblies | read from each sub-assembly's features | whatever the export wrote |
| Mass, centre of mass, inertia | Onshape's mass properties | Onshape's mass properties (same) |
| Parts with no material | weighed by kind (a guess) | weighed by kind (same guess) |
| Staying current | paste the link again | export and drop 100+ MB again |

**Verified on a real robot, 2026-11-18.** The owner's BIOBUZZ Meet 0 redesign (1,375 parts in
6 Part Studios) was read from cad.onshape.com by the page, the engine worker and the relay's own
code, run on one computer with `tools/onshape-dev.mjs` (below). What it showed:

| | Measured |
|---|---|
| Calls for the first read | 15 (3 + 2 per Part Studio), all answered 200 |
| Time | about 70 s; one Part Studio of 258 parts took Onshape 36 s to tessellate |
| Calls for the same robot again | 3 (the shapes are kept in the browser), about 20 s |
| Parts, shapes, triangles | 1,375 parts from 292 shapes, 2.6 M triangles thinned to 0.64 M |
| Mass | 9.7 kg: no part has a material, so each is weighed by its own volume |
| Console errors during the import | none |

It also found two things the OpenAPI spec doesn't say, both fixed and tested with Onshape's
verbatim answers (`tests/onshape-whole.test.mjs`): a part's colour arrives as four bytes in
base64 on the body (`"color":"nc/t/w=="`), and every robot had been drawn in one grey; and a part
with no material has zeros for its centroid, which had put every such part's weight at its Part
Studio's origin.

**Then on the live site, the same day,** signed in with the owner's Onshape account through the
real OAuth app, opened by the extension-style address: the same robot, whole (1,375 parts, 34
colours, 9.7 kg, no console errors). Getting there found two more things, which only the live
site could show:

- Onshape answered the sign-in with `{"message":"Invalid request","status":400}`: the client ID
  in the site's settings had been saved without its last `=`. The relay puts it back (`45b93e7`).
  `/onshape/status` saying `ready:true` only means the two settings exist, not that Onshape
  takes them.
- The first read arrived with 93 parts: the largest Part Studio's shapes are 281 MB of JSON, and
  the relay held each answer whole to keep it at the edge, which ended the function (Cloudflare
  error 1101). Answers over 16 MB are now passed straight through (`57b9261`); that one takes
  40 s. The local run never showed it, because Node has no 128 MB limit.

**Still not verified:** a robot with mate limits and gear relations, an enterprise document, the
bookmark on a real Onshape tab, and the right-click extension. For the first, compare REVIVER
against its export zip (14.3 kg, 19
mechanisms, docs/HANDOFF.md): save the workspace (`.ftcsim`) after the import and compare joints,
limits and mass.

### Watching a real import on your own computer

```
npm run build
ONSHAPE_ACCESS_KEY=… ONSHAPE_SECRET_KEY=… node tools/onshape-dev.mjs 8790 --keep ../onshape-kept --log calls.log
```

It serves `dist/` with the real relay behind `/onshape/*`. Open `http://localhost:8790/` and
paste an address, or `http://localhost:8790/?onshape=<address, encoded>`. Every real call is
printed and counted (`/onshape-dev/stats`); `--keep` stores what never changes, so trying the
same robot again costs 3 calls. The keys are your own API keys (Onshape → My account →
Developer); they are read from the environment or `--env <file>` and never printed.

## One click from Onshape

A team shouldn't have to copy an address. Three ways in, all of which read the assembly with
nothing pasted (`onshapeLaunch` in `src/onshapelink.js`; if the browser isn't signed in to
SimBench's Onshape link yet, Onshape's Allow page takes the tab once and comes straight back):

1. **A bookmark, today, with nothing to approve.** The "Bring your robot" card has a **Send to
   SimBench** link: drag it to the bookmarks bar once. After that, one click on the Assembly tab
   in Onshape opens SimBench with that robot being read. It works on any Onshape account,
   school ones included, because nothing is installed in Onshape. Not yet tried on a real
   Onshape tab, and a managed Chromebook that blocks `javascript:` bookmarks won't run it.
2. **A link.** `https://ftc-simbench-pro.pages.dev/?onshape=<the assembly's address, encoded>`
   opens the same way: good for a team's README or a pinned message.
3. **A menu entry inside Onshape** (an app extension). **Set up and working since 2026-11-18** on
   the owner's account: right-click the **Assembly tab** at the bottom → **Applications → FTC
   SimBench Launcher → Simulate in FTC SimBench**. A new tab opens and the robot is read (tried
   on the Meet 0 redesign: 1,375 parts, nothing pasted). How it is built:

   - The extension lives in its own OAuth app, **FTC SimBench Launcher** (Integrated Cloud App,
     read-only), in the owner's Onshape account (My account → Developer → OAuth applications).
     The app the site signs in with ("FTC SimBench", the one in Cloudflare) is in someone else's
     Onshape account and could not be edited; an extension only opens an address, so it does not
     have to belong to the same app. The Launcher's secret is not used by anything.
   - It has a **private store entry** (category Simulation, plan FREE) and the owner is
     subscribed to it: Onshape shows an extension only to accounts subscribed to its app. To give
     it to teammates, set the entry's **Team visibility** to a team they are in; each then
     subscribes once, free, in the App Store.
   - Onshape appends `companyId`, `userId`, `clientId`, `locale` and `theme` to the address; the
     page drops them with the rest.

   The same fields, to add it to another app (My account → Developer → OAuth applications → the
   app → **Extensions** → Add extension):

   | Field | Value |
   |---|---|
   | Name | Simulate in FTC SimBench |
   | Location | Element context menu (the right-click menu of a tab) |
   | Context | Inside assembly |
   | Action type | Open in new window |
   | Action URL | `https://ftc-simbench-pro.pages.dev/?documentId={$documentId}&workspaceOrVersion={$workspaceOrVersion}&workspaceOrVersionId={$workspaceOrVersionId}&elementId={$elementId}&configuration={$configuration}` |

   A new window keeps
   SimBench's sign-in cookie first-party, which a panel inside Onshape would not (school
   Chromebooks block third-party cookies).

When a robot came from the link, its review card has **Update from Onshape**: one click reads
the assembly again as it is now.

Either way, the biggest factor is the CAD itself: every mechanism mated, materials set, and the
mates that are mechanisms named (`motor armMotor`), as in [robot-setup.md](robot-setup.md).

## Getting listed, free

From Onshape's [launch checklist](https://onshape-public.github.io/docs/app-store/checklist/) and
[testing guidelines](https://onshape-public.github.io/docs/app-store/testingguidelines/):

1. **Prove it on the owner's robot first.** Paste the link, check the robot against the export,
   and look at **My account → Developer → View your API usage** to see what one import cost.
   Onshape's QA will try it too.
2. **Email Developer Relations** (<onshape-developer-relations@ptc.com>) before anything else.
   Onshape doesn't publish whether the developer licenses a public app needs cost anything. A
   draft:

   > Subject: Free FTC app – App Store listing
   >
   > Hi, I'm a student on FTC team [number]. I built FTC SimBench Pro
   > (https://ftc-simbench-pro.pages.dev), a free browser simulator that reads a team's Onshape
   > assembly (read-only OAuth, Connected Cloud App) and runs their robot code. I'd like to list
   > it free so teams can use it. (1) Can a free, non-commercial app be listed, and do I need paid
   > Developer Licenses? (2) Could you send the developer agreement, and can our team mentor sign
   > it? (3) Can beta testers' API calls get a temporary allowance? (4) Do the testing rules about
   > browsing 20+ documents apply to an app that reads one pasted assembly?

3. **The store entry** (the testing guidelines' Addendum B), in the developer portal at
   <https://dev-portal.onshape.com>, signed in as the account that registered the OAuth app:
   **OAuth applications → FTC SimBench → Store entries → Create store entry**. Ready to paste:

   | Field | Value |
   |---|---|
   | Name | FTC SimBench |
   | Summary | Simulate your FTC robot from its Onshape assembly and run your team's real Java OpModes. |
   | Description | Paste your robot's Assembly address and FTC SimBench reads its mates, parts and mass properties (read-only), builds the robot on a FIRST Tech Challenge field in your browser, and runs your team's TeleOp and Road Runner autonomous code on it. Free, no install, nothing written back to Onshape. |
   | Price | Free |
   | Support URL | https://ftc-simbench-pro.pages.dev/support |
   | EULA / terms URL | https://ftc-simbench-pro.pages.dev/terms |
   | Privacy URL | https://ftc-simbench-pro.pages.dev/privacy |
   | Launch URL | https://ftc-simbench-pro.pages.dev/ |

   Its checklist:
   - name, summary and description that say what it does;
   - category, and the price **Free**;
   - permission: **Application can read your documents** only (already so);
   - a **support URL** to a real channel: GitHub Issues or a team email (an FAQ alone doesn't pass);
   - a link to an **English EULA** (terms of use);
   - a feature graphic and screenshots that show the app as it is.
   - Type **Connected Cloud App**, kept on purpose: an Integrated app runs in an iframe inside
     Onshape and needs third-party cookies, which school Chromebooks usually block. A connected
     app opens in its own tab, where SimBench's sign-in cookie is first-party.
4. **What QA checks, and where SimBench stands** (probed 2026-10-09):

   | QA check | SimBench |
   |---|---|
   | Onshape OAuth, minimal grant | ✅ read-only |
   | A revoked grant handled | ✅ the relay answers signed-out and the card asks to sign in again |
   | Versions and workspaces | ✅ `w`, `v` and `m` addresses, configuration kept |
   | Empty assembly, wire-only Part Studio | ✅ says the assembly has no parts, or no solid ones (`e99a8ab`) |
   | Surface-only Part Studio | ✅ a surface weighs nothing (`e99a8ab`) |
   | No avoidable console errors | ✅ none during a real import (2026-11-18); other screens not swept |
   | EULA, privacy page, support link | ✅ `/terms`, `/privacy`, `/support` (`site/`, 2026-11-14); have a mentor read them |

5. **Beta test with at least 5 active testers.** Make an Onshape team, add a private store entry
   visible to it, and have the testers add the app and import their robots. Their calls count
   against the owner's 2,500: ask for a beta allowance (question 3) or keep testers on small
   robots, and have them paste version addresses so repeats come from the browser's cache.
6. **Sign the developer agreement and submit for QA.** Up to a week, and no code changes during
   it unless asked. The answer is approved, approved with feedback, or changes required.
7. **Support and publish.** Set up the support channel with Developer Relations, then email them
   a publish date.
8. **Stay listed.** Answer tickets in reasonable time (or the app is removed); medium-priority
   bugs within 30 days.

Still unknown until Developer Relations answers: whether developer licenses cost anything, whether
a student can own the listing (a mentor can sign), and how long it takes end to end.

## Until then

- The owner's team uses the link, within the 2,500.
- Other teams use the export zip (Export → URDF), which needs no API at all.
- The site needs nothing new from Cloudflare: `ONSHAPE_CLIENT_ID` and `ONSHAPE_CLIENT_SECRET`
  are set. School networks need `ftc-simbench-pro.pages.dev` and `cdn.jsdelivr.net` let through
  (DEPLOY.md, "School networks and Chromebooks").

## Sources

- [Onshape API limits](https://onshape-public.github.io/docs/auth/limits/)
- [App Store launch checklist](https://onshape-public.github.io/docs/app-store/checklist/)
- [Testing guidelines](https://onshape-public.github.io/docs/app-store/testingguidelines/)
- [Quality considerations](https://onshape-public.github.io/docs/app-store/quality/)
- [App Store FAQs](https://cad.onshape.com/help/Content/Home/app_store_faqs.htm)
- [My account – Developer](https://cad.onshape.com/help/Content/Plans/my_account_developer.htm)
- [Build an integration (developer licenses)](https://www.onshape.com/en/app-integrations/build-an-integration)
- [Onshape on Wikipedia (FRCDesignApp)](https://en.wikipedia.org/wiki/Onshape),
  [The MKCad App on Chief Delphi](https://www.chiefdelphi.com/t/the-mkcad-app/392654)
