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

**Not yet verified.** The link has only been tested against a stand-in built from Onshape's
OpenAPI spec (`tests/onshapelink.test.mjs`, `tests/onshape-signin.test.mjs`). No real robot has
gone through the live app yet. The first real import should be the owner's own robot (REVIVER),
compared against its export zip (14.3 kg, 19 mechanisms, docs/HANDOFF.md): save the workspace
(`.ftcsim`) after the import and compare joints, limits and mass.

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

3. **The store entry** (the testing guidelines' Addendum B):
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
   | Empty assembly, wire-only Part Studio | ❌ fails with "none of its parts' shapes" and "try again"; should say the assembly has no parts |
   | Surface-only Part Studio | ❌ a surface is weighed (24 g in the probe); it should weigh nothing |
   | No avoidable console errors | ? not checked yet |
   | EULA, privacy page, support link | ❌ not on the site yet |

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
