# tools/

Node scripts for building, testing and generating test robots. None of them ship.

| Script | What it does |
|---|---|
| `build.mjs` | Concatenates `src/*.js` in `ORDER` into `dist/index.html` and `dist/fragment.html`, inlines the vendored shot engine, writes the engine alone as `dist/engine-<hash>.js` for the Web Worker, loads three.js r186 with an import map, copies `assets/robots/` to `dist/robots/`, and writes `_headers` for Cloudflare Pages. `--min` is the ship build; `--strings` also hides string literals. The build hash (`SIMBENCH_BUILD`) is a hash of the engine source. |
| `minify.mjs` | The ship-build minifier: tokenizes JS, CSS and HTML properly and strips comments and layout. It never renames anything. `tests/ship.test.mjs` proves the minified engine behaves the same. |
| `test.mjs` | Runs every `tests/*.test.mjs`, or the ones whose names match the arguments. |
| `stepgen.mjs` | Writes the **robot corpus**: STEP assemblies the way Onshape exports them, with real B-rep solids. There are 14 robots covering every drivetrain and the awkward CAD habits (Y-up, inches, offset origins, unnamed parts, deep nesting, 1,500 parts), plus `mated`, which comes with a matching Onshape assembly JSON. Each robot has a `.json` ground truth. `--check` meshes every file with OpenCascade. |
| `mechgen.mjs` | The **mechanism zoo**: the corpus's mecanum base plus one kind of mechanism each (direct-drive, servo and Core Hex arms, a turret, gear and belt drives, a Viper slide, a rail and carriage, an intake roller, a four-bar, a wrist on an arm), with the true joints. `buildMech(name, {strip})` also writes it with every part renamed "Part N". It's for the joint finder's tests. |
| `gen-autorig.mjs` | Regenerates `src/autorig-lib.js` from the joint-finder prototypes in `research/autorig`. Change a prototype, re-run its eval, then run this. |
| `fusion/ExportToSimBench` | A Fusion **script** (not an add-in): writes the open design as robot.urdf with one OBJ per rigid body, joints and limits from the design's joints, motion links as mimics, masses and colours, zipped to drop on SimBench. [fusion/README.md](fusion/README.md). |
| `sync-shot-sim.mjs` | Copies the BIOBUZZ Shot Sim engine and field data into `vendor/`, so the bench and the shot sim can't disagree about the field. |

```bash
npm run build            # node tools/build.mjs
npm run build:ship       # node tools/build.mjs --min   (what Cloudflare Pages runs)
npm test                 # node tools/test.mjs
npm run corpus           # node tools/stepgen.mjs --check
```
