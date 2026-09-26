# tools/

Node scripts for building, testing and generating test robots. None of them ship.

| Script | What it does |
|---|---|
| `build.mjs` | Concatenates `src/*.js` in `ORDER` into `dist/index.html` and `dist/fragment.html`, inlines the vendored shot engine, copies `assets/robots/` to `dist/robots/`, and writes `_headers` for Cloudflare Pages. `--min` is the ship build; `--strings` also hides string literals. The build hash (`SIMBENCH_BUILD`) is a hash of the engine source. |
| `minify.mjs` | The ship-build minifier: tokenizes JS, CSS and HTML properly and strips comments and layout. It never renames anything. `tests/ship.test.mjs` proves the minified engine behaves the same. |
| `test.mjs` | Runs every `tests/*.test.mjs`, or the ones whose names match the arguments. |
| `stepgen.mjs` | Writes the **robot corpus**: STEP assemblies the way Onshape exports them, with real B-rep solids. There are 14 robots covering every drivetrain and the awkward CAD habits (Y-up, inches, offset origins, unnamed parts, deep nesting, 1,500 parts), plus `mated`, which comes with a matching Onshape assembly JSON. Each robot has a `.json` ground truth. `--check` meshes every file with OpenCascade. |
| `onshape-mates.mjs` | Fetches an Onshape assembly's mates with API keys (`ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY` from the environment, never from files). You don't need it if you can sign in to Onshape in a browser; the app's Mates panel builds the same two links. |
| `sync-shot-sim.mjs` | Copies the BIOBUZZ Shot Sim engine and field data into `vendor/`, so the bench and the shot sim can't disagree about the field. |

```bash
npm run build            # node tools/build.mjs
npm run build:ship       # node tools/build.mjs --min   (what Cloudflare Pages runs)
npm test                 # node tools/test.mjs
npm run corpus           # node tools/stepgen.mjs --check
```
