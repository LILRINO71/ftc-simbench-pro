# Importing an FTC robot directly from Onshape (geometry + real joints) into a static browser app

Research date: 2026-10-02. "Probe" below means a live unauthenticated `curl` run on that date against `cad.onshape.com` / `oauth.onshape.com` from this session (results are reproducible, but Onshape can change them at any time). The OpenAPI spec cited is the live one at `https://cad.onshape.com/api/openapi` (version `1.221.89963`, server `https://cad.onshape.com/api/v17`).

## 1. Which Onshape REST endpoints supply each piece of a simulatable robot?

### Takeaway
Everything needed exists in the REST API without STEP: the assembly definition (tree, absolute occurrence transforms, mates with mated coordinate systems, mate connectors), the assembly `/features` list (mate limits, mate relations with ratios, configured values), per-part `tessellatedfaces` or `gltf` (geometry plus face appearances), per-part `massproperties` (mass, centroid, inertia; material-based), part `metadata` (appearance colour, material, name), `matevalues` (current joint positions), and `elements/.../configuration` (configuration parameters). All coordinates are metres.

### Cited Findings
**Assembly tree, transforms, mates, connectors**
- `GET /api/v{N}/assemblies/d/{did}/{wvm}/{wvmid}/e/{eid}` (operationId `getAssembly`) with query params `configuration`, `explodedViewId`, `includeMateFeatures` (default false), `includeNonSolids` (default false), `includeMateConnectors` (default false), `excludeSuppressed` (default false; "exclude suppressed instances/mate features"), `linkDocumentId`. Description: "All coordinates and translation matrix components are in meters (m)." — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)
- Response `BTAssemblyDefinitionInfo` = `{rootAssembly, subAssemblies[], parts[], partStudioFeatures[]}`. `rootAssembly` has `instances[]`, `occurrences[]`, `features[]` ("including those created by replicates"), `patterns[]`, `parametricInstances[]`, `documentMicroversion`, `fullConfiguration`. Each occurrence has `path[]`, `transform[]` (16 numbers), `fixed`, `hidden`, `mateStatuses`. Each instance has `id`, `name`, `type`, `partId`, `documentId`, `elementId`, `documentMicroversion`, `documentVersion`, `configuration`, `fullConfiguration`, `isStandardContent`, `suppressed`, `partNumber`. `parts[]` carry `mateConnectors[]` of `{featureId, mateConnectorCS:{origin, xAxis, yAxis, zAxis}}` (spec spells the getters `getxAxis` etc.). `patterns[]` have `seedToPatternInstances`. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)
- Transform is row-major 4x4 `[R00,R01,R02,Tx, R10,…,Ty, R20,…,Tz, 0,0,0,1]`; "occurrence transforms are **absolute** and not relative to their parent's"; a part occurrence's transform is "the location of the owning Part Studio's coordinate system relative to the top-level assembly's coordinate system". Mate types listed: `FASTENED, SLIDER, CYLINDRICAL, REVOLUTE, PIN_SLOT, PLANAR, BALL, PARALLEL`. — [Onshape Assemblies API guide](https://onshape-public.github.io/docs/api-adv/assemblies/)
- Mate feature shape as consumed by a mature exporter: features with `featureType == "mate"`, `featureData.{name, mateType, matedEntities[2]}`; each mated entity has `matedOccurrence` (occurrence path) and `matedCS {xAxis, yAxis, zAxis, origin}` expressed in the owning part's frame, so world joint frame = `T_world_part(occurrence) @ T_part_mate(matedCS)`. `featureType == "mateGroup"` and `"mateConnector"` also appear. — [onshape-to-robot assembly.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/assembly.py)
- This repo already reads the same endpoint (`?includeMateFeatures=true&includeMateConnectors=true&includeNonSolids=false` plus `/features`) and parses `featureType === "mate" | "mateRelation" | "mateGroup"`; its mateRelation parsing tries several field names (`relationType`, `relationRatio`/`ratio`, `relationLength`, `reverseDirection`, `mates`/`mateIds`), i.e. the definition-side relation shape was not pinned down from docs. — `src/mates.js` lines 1–40, 99–113 (repo)

**Mate limits and mate relations (feature list)**
- `GET /api/v{N}/assemblies/d/{did}/{wvm}/{wvmid}/e/{eid}/features` (params `configuration`, `featureId`, `explodedViewId`, `linkDocumentId`). — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)
- Limits are not in the definition; onshape-to-robot reads them from `/features`: per mate (matched by `feature.message.name`) parameter `limitsEnabled`, then `limitAxialZMin`/`limitAxialZMax` for revolute, `limitZMin`/`limitZMax` for slider, `limitEulerConeAngleMax` for ball. Values may be `BTMParameterNullableQuantity` (expression string) or `BTMParameterConfigured` (per-configuration values via `BTMConfiguredValueByBoolean`/`ByEnum` keyed by `configurationParameterId`), so the client must evaluate expressions/units and resolve configurations itself. It also subtracts a mate "offset" (`translationZ` etc.) from limits. — [onshape-to-robot assembly.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/assembly.py)
- Mate relations in `/features`: `typeName == "BTMMateRelation"`; parameters `matesQuery` (two `queries[].message.featureId` pointing at the related mates), `relationRatio` (expression), `reverseDirection` (bool). onshape-to-robot only consumes gear-style ratio relations between two `dof_` mates and sets `ratio = -ratio` when `reverseDirection` is false. — [onshape-to-robot assembly.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/assembly.py)
- Onshape has four relation types: Gear (two revolute DOFs, constant angular ratio; ratio = driving teeth / driven teeth), Rack and Pinion (revolute rotation ↔ slider translation, "for every rotation of the pinion gear, the rack moves … by the input amount"), Screw (rotation and translation within one cylindrical mate), Linear (constant ratio between two linear motions). — [Onshape Help: Relations](https://cad.onshape.com/help/Content/Assembly/relations.htm), [Gear Relation](https://cad.onshape.com/help/Content/materelation-gear.htm), [Rack and Pinion](https://cad.onshape.com/help/Content/materelation-rackandpinion.htm)

**Mate values (current joint positions)**
- `GET /api/v{N}/assemblies/d/{did}/{wv}/{wvid}/e/{eid}/matevalues` → `BTAssemblyMateValuesInfo {mateValues[]: {featureId, mateName, jsonType, ownerOccurrencePath[] , …}}`; "Describes the relative position of the first mate connector with respect to the second along the designated degrees of freedom". Note: `wv` only (workspace or version, not microversion). `POST …/w/{wid}/e/{eid}/matevalues` sets them. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)

**Mass properties (material-based)**
- Assembly: `GET /assemblies/d/{did}/{wvm}/{wvmid}/e/{eid}/massproperties` (params `configuration`, `namedPositionId`, `linkDocumentId`); "The assembly must contain parts that have density"; when three values are returned they are nominal, min, max (tolerance). Returns `BTMassPropertiesInfo {mass[], centroid[], inertia[], principalInertia[], principalAxes[], volume[], periphery[], hasMass, massMissingCount}`. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)
- Per part: `GET /parts/d/{did}/{wvm}/{wvmid}/e/{eid}/partid/{partid}/massproperties` (params `configuration`, `useMassPropertyOverrides`, `inferMetadataOwner`, `linkDocumentId`); Part Studio: `GET /partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/massproperties` (params `partId` (repeatable), `massAsGroup`, `useMassPropertyOverrides`) returning `BTMassPropertiesBulkInfo {bodies: {partId → BTMassPropertiesInfo}, microversionId}`. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi); [Part Studios API guide](https://onshape-public.github.io/docs/api-adv/partstudios/)
- onshape-to-robot gets per-part mass via `/parts/.../partid/{pid}/massproperties`, uses `bodies[partId].mass[0]`, centroid, 3x3 of `inertia[:9]`; for standard content (`isStandardContent`, e.g. Onshape fasteners) it calls the same endpoint on `v/{documentVersion}` with `linkDocumentId` = the robot document; it warns "part … has no mass, maybe you should assign a material to it". — [onshape-to-robot robot_builder.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/robot_builder.py)
- Material info schema `BTPartMaterialInfo {id, displayName, libraryName, libraryReference, properties[]}` exists (part metadata). — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)

**Geometry**
- `GET /parts/d/{did}/{wvm}/{wvmid}/e/{eid}/partid/{partid}/tessellatedfaces` and `GET /partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/tessellatedfaces` with params `partId`, `angleTolerance`, `chordTolerance`, `maxFacetWidth`, `precomputedLevelOfDetail`, `outputFaceAppearances` (default false), `outputVertexNormals` (false), `outputFacetNormals` (true), `outputIndexTable` (false), `outputTextureCoordinates`, `outputErrorFaces`, `combineCompositePartConstituents`, `configuration`; "Coordinates are in meters". Also `/tessellatededges`. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)
- Per-part synchronous glTF: `GET /parts/.../partid/{partid}/gltf` and Part Studio `GET /partstudios/.../gltf` (params `partId`, `angleTolerance`, `chordTolerance`, `maxFacetWidth`, `outputSeparateFaceNodes`, `outputFaceAppearances`, `configuration`); responses `model/gltf+json` or `model/gltf-binary`. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)
- STL per part: `GET /parts/d/{did}/{wmv}/{wmvid}/e/{eid}/partid/{pid}/stl?mode=binary&units=meter[&linkDocumentId=…]` is what onshape-to-robot uses. — [onshape-to-robot client.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/onshape_api/client.py)

**Colours / appearances**
- Options: `outputFaceAppearances=true` on tessellatedfaces/gltf (per-face colour), or part metadata `GET /metadata/d/{did}/{wvm}/{wvmid}/e/{eid}/p/{partid}` whose `properties[]` include an entry whose `value` has `color {red, green, blue}` (0–255) and `opacity`. onshape-to-robot uses the metadata route and comments "There must be a better way to retrieve the part color". Bulk: `GET /metadata/d/{did}/{wvm}/{wvmid}/e/{eid}/p` lists all parts' metadata in one call. — [onshape-to-robot robot_builder.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/robot_builder.py); [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)

**Configurations**
- `GET /elements/d/{did}/{wvm}/{wvmid}/e/{eid}/configuration` returns `configurationParameters`; `POST /elements/d/{did}/e/{eid}/configurationencodings` and `GET …/configurationencodings/{cid}` encode/decode; the `configuration` query param on every geometry/mass/assembly call is "URL-encoded string of configuration values (separated by `;`)". onshape-to-robot validates names/values and rewrites `key=value` with spaces → `+`. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi); [onshape-to-robot assembly.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/assembly.py)

**Other useful**
- `GET /documents/d/{did}/{wvm}/{wvmid}/elements` (find the assembly tab), `GET /assemblies/.../boundingboxes`, `GET /assemblies/.../shadedviews` (PNG thumbnails), `GET /assemblies/d/{did}/e/{eid}/namedViews`; named positions via `namedPositionId`. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)

### Inferences
- Minimal call plan per robot: 1× elements, 1× assembly definition (with mate features + connectors), 1× assembly `/features`, 1× `elements/configuration` (only if configured), 1× `matevalues` (optional), then per unique Part Studio (keyed by `documentId+elementId+microversion/version+configuration`): 1× Part Studio `tessellatedfaces` (all parts, `outputFaceAppearances=true`) + 1× Part Studio `massproperties` (all parts via `bodies` map) + optionally 1× `metadata/.../p`. Fetching per Part Studio rather than per part is the main lever for call count.
- Linked COTS parts (goBILDA/REV/Onshape standard content) must be fetched at their own `documentId` + `documentVersion`/`documentMicroversion` with `linkDocumentId` set to the robot document, otherwise access to another team's/vendor's document can fail.
- Mate types beyond revolute/slider/fastened (pin-slot, planar, ball, cylindrical, parallel) are all present in the definition; the simulator must decide how to model them (onshape-to-robot rejects pin-slot/planar/parallel for `dof_`).

### Gaps
- No official doc found that fully specifies `featureData` for `mateRelation` features in the assembly *definition* (as opposed to `BTMMateRelation` in `/features`); `relationType` enum values (`GEAR`, `RACK_AND_PINION`, `SCREW`, `LINEAR` assumed) and `relationLength` field name are unconfirmed — verify against a real response.
- Exact JSON shape of `matevalues` per mate type (e.g. `rotationZ`, `translationZ` fields) is not in the spec beyond the base fields; onshape-to-robot code references `translationZ` for offsets.
- Whether `tessellatedfaces` on a whole Part Studio has a response-size cap was not documented.

## 2. glTF export: synchronous vs async, and does it preserve hierarchy/node names?

### Takeaway
Part Studio and single-part glTF are synchronous (307 redirect to the file); whole-assembly glTF is only an async translation job (POST, poll, download). Onshape documents no guarantee that assembly glTF preserves instance hierarchy or occurrence IDs, so per-Part-Studio/per-part geometry placed with the assembly definition's occurrence transforms is the reliable way to tie meshes to mates.

### Cited Findings
- Sync: `GET /partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/gltf` "Returns a 307 redirect from which to download the exported file. Export is much faster than asynchronous endpoints at the expense of limited control on tessellation settings." — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi); [Translation guide](https://onshape-public.github.io/docs/api-adv/translation/)
- Async: `POST /assemblies/d/{did}/{wv}/{wvid}/e/{eid}/export/gltf` (and `/partstudios/.../export/gltf`) with body `BTBGltfExportParams {meshParams{angularTolerance, distanceTolerance, maximumChordLength, resolution, unit}, storeInDocument, grouping, excludeHiddenEntities, isYAxisUp, destinationName, notifyUser, triggerAutoDownload, …}`; returns `BTTranslationRequestInfo {id, requestState, resultExternalDataIds[], resultElementIds[], failureReason}`. Poll `GET /translations/{tid}` until `requestState` is `DONE`/`FAILED`; download via `GET /documents/d/{did}/externaldata/{fid}` when `storeInDocument=false`. Only `wv` (workspace/version), not microversion. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi); [Translation guide](https://onshape-public.github.io/docs/api-adv/translation/)
- Polling guidance: "avoid polling multiple times a second, use an exponential backoff strategy"; no size or time limits are stated for glTF exports. — [Translation guide](https://onshape-public.github.io/docs/api-adv/translation/)
- Mesh exports create "a unique sub-mesh for each face of the part instead of a single mesh per part" (supports per-face colours, hurts real-time performance). — [Onshape forum: exporting parts as single meshes](https://forum.onshape.com/discussion/23958/exporting-parts-as-single-meshes-instead-of-many-sub-meshes)
- Onshape UI can export instances, subassemblies and assemblies; glTF/GLB is a listed format. — [Onshape Help: Exporting Files](https://cad.onshape.com/help/Content/exporting-files.htm)
- The translation guide says nothing about hierarchy or node-name preservation. — [Translation guide](https://onshape-public.github.io/docs/api-adv/translation/)

### Inferences
- Async assembly glTF costs ≥3 calls (start, ≥1 poll, download) plus an extra translation record in the document's translation history; with `storeInDocument=true` it would *write* a blob into the team's document, so use `false`.
- Sync per-Part-Studio glTF with `outputSeparateFaceNodes=false` (one node per part, presumably named by part) plus `outputFaceAppearances=true` is the cheapest geometry+colour route compatible with three.js `GLTFLoader`; `tessellatedfaces` JSON is the alternative if glTF nodes cannot be mapped to `partId` reliably.
- Because one Part Studio mesh can be instanced many times in the assembly (e.g. 8 identical goBILDA channels), fetching per Part Studio and instancing by occurrence transform is both smaller and maps 1:1 to mate occurrences.

### Gaps
- Not verified (needs an authenticated request): whether assembly glTF nodes carry instance names/IDs and nested hierarchy, and whether Part Studio glTF node names equal part names or `partId`s. Test on a real robot before relying on it.
- No published glTF size/time limits; the 307 redirect target host and whether it is CORS-readable were not probed.

## 3. Auth routes for a static browser app, and CORS

### Takeaway
`cad.onshape.com/api` sends no CORS headers to third-party origins, so a static Cloudflare Pages app cannot call it directly with any credential. The workable routes are (a) the existing bookmarklet / same-origin trick using the user's own Onshape session (no keys, no proxy), or (b) OAuth2 authorization-code flow through a tiny Cloudflare Worker that holds the client secret and forwards API calls. API keys must never be in the static site. PKCE is not documented.

### Cited Findings
- Onshape staff on the forum: the API does not support CORS; use a non-browser service (e.g. a lambda). A school-browser user saw `Access-Control-Allow-Origin` = `https://cad.onshape.com`, "not equal to the supplied origin". — [Onshape forum (search summary)](https://forum.onshape.com/discussion/comment/64059), [forum comment 42174](https://forum.onshape.com/discussion/comment/42174), [forum comment 107304](https://forum.onshape.com/discussion/comment/107304)
- Probe (2026-10-02): `OPTIONS https://cad.onshape.com/api/v10/documents` with `Origin: https://example.pages.dev` → `401`, no `Access-Control-*` headers; `GET /api/v10/users/sessioninfo` with that Origin → `204`, no `Access-Control-Allow-Origin`; `OPTIONS https://oauth.onshape.com/oauth/token` → `401`, no CORS headers. So neither API nor token endpoint is callable from a third-party page. — Probe (this session)
- Auth methods: "All applications must authenticate with OAuth2 to be approved in the Onshape App Store"; API keys "authenticate an application, NOT its users, and will only perform operations on behalf of the Onshape user who generated the API keys". — [Onshape Auth docs](https://onshape-public.github.io/docs/auth/)
- OAuth2: authorize `https://oauth.onshape.com/oauth/authorize`, token `https://oauth.onshape.com/oauth/token`; authorization-code and refresh-token flows; client secret used in token exchange; redirect URIs are HTTPS URLs (also `http://localhost:<port>` and `urn:ietf:wg:oauth:2.0:oob` for installed apps); access token "valid for the next 60 minutes", refresh token "valid for the lifetime of the user's grant"; apps registered via Developer Settings (individual: My Account settings; company/classroom/enterprise settings). PKCE, scopes list and CORS are not mentioned. — [Onshape OAuth docs](https://onshape-public.github.io/docs/auth/oauth/)
- Probe: `https://oauth.onshape.com/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server` return the Onshape web-app HTML, i.e. no discovery document (so no advertised `code_challenge_methods_supported`). — Probe (this session)
- PKCE is the standard way for public clients (SPAs) that cannot keep a secret. — [oauth.com: Single-Page Apps](https://www.oauth.com/oauth2-servers/single-page-apps/)
- Session-cookie route already in this repo: opening `GET https://cad.onshape.com/api/assemblies/d/{did}/w/{wid}/e/{eid}?includeMateFeatures=true&includeMateConnectors=true` "in a browser tab that's signed in to Onshape … returns the JSON directly, with no API keys". — `src/mates.js` header (repo)
- Probe: the Onshape document page CSP is `frame-ancestors 'self' *.onshape.com …` (plus `X-Frame-Options: SAMEORIGIN`), `script-src-elem` limited to an allowlist (includes `https://cdnjs.cloudflare.com`, not `*.pages.dev`), and **no `connect-src`/`default-src`** directive. — Probe (this session) of a `cad.onshape.com/documents/...` page response headers
- Cloudflare Worker is acceptable to the app's hosting model (Cloudflare Pages runs `npm run build:ship`). — `AGENTS.md` (repo)

### Inferences
- **Bookmarklet route (zero backend, zero quota impact likely):** a bookmarklet run on a `cad.onshape.com/documents/...` tab can `fetch('/api/...', {credentials:'include'})` same-origin, gather definition, features, tessellation, mass and metadata, then hand the bundle to the app via `window.open(appURL)` + `postMessage` (target origin pinned to the app) or by POSTing to the app's own origin (no `connect-src` blocks it, but the app endpoint would need CORS). It cannot load a script from `*.pages.dev` (blocked by `script-src-elem`), so the whole fetcher must be inline in the `javascript:` URL or loaded from an allowlisted CDN (cdnjs is allowlisted but publishing there is impractical). Mutating requests (POST) from the session may need Onshape's CSRF/XSRF header; all needed calls here are GETs except async export (avoid it in this route).
- **OAuth route:** register an OAuth app; Worker endpoints `/login` (redirect to authorize with `state`), `/callback` (exchange code with client secret, store tokens in an encrypted, `HttpOnly; Secure; SameSite=Lax` cookie or encrypted KV keyed by random session id), `/api/*` (allow-list of GET paths only, forward with `Authorization: Bearer`, add `Access-Control-Allow-Origin` = the app origin only, never `*`, refresh on 401). Security: strict path allow-list (no write endpoints, no arbitrary host → not an open proxy/SSRF), `state` + origin checks against CSRF, don't log tokens/bodies, stream large bodies, follow the 307 for glTF server-side.
- A Worker that merely relays a user-pasted API key is technically possible but teaches teams to paste secrets into a third-party site; avoid.

### Gaps
- PKCE support at `oauth.onshape.com` is undocumented; an authenticated test (send `code_challenge`, omit secret) is needed. Even with PKCE, the token and API endpoints lack CORS, so a Worker is still needed for OAuth.
- Available OAuth scopes (historically `OAuth2Read`, `OAuth2ReadPII`, etc.) are not listed on the current OAuth page; confirm in the dev portal.
- Whether Onshape's ToS / API Agreement permits bookmarklet-style automated use of a user's web session was not found in public text (the API Agreement is only shown on first dev-portal access). — [Onshape Terms of Use](https://www.onshape.com/en/legal/terms-of-use)
- Whether a bookmarklet's `javascript:` code is subject to the page CSP varies by browser; not verified here.

## 4. Public documents without auth; API quotas for free/education accounts

### Takeaway
Public documents are **not** fully readable anonymously: document/element listing, metadata, shaded views and Part Studio features work, but assembly definition, assembly features, mass properties, tessellation and glTF all return 401. Since October 2025 Onshape documents annual API call quotas: 2,500 calls/year per user on Free, EDU Student and Standard plans — far too few for per-import API-key or private-OAuth-app use — but calls from **public App Store OAuth apps** and browser client calls do not count.

### Cited Findings
- Probe (2026-10-02) against public document `862948a6ea6d38343e1d3272` (onshape-to-robot example; `"public": true, "permission": "ANONYMOUS_ACCESS"`), no credentials: `GET /documents/{did}` 200; `GET /documents/d/{did}/w/{wid}/elements` 200; `GET /metadata/d/…/e/{asm}` 200; `GET /assemblies/…/shadedviews` 200; `GET /partstudios/…/features` 200; **401** for `GET /assemblies/…` (definition), `/assemblies/…/features`, `/assemblies/…/massproperties`, `/partstudios/…/tessellatedfaces`, `/partstudios/…/massproperties`, `/partstudios/…/gltf`, `/partstudios/…/bodydetails`, `/parts/…`; `GET /documents?filter=4` (public search) 401. — Probe (this session); example URL from [onshape-to-robot-examples README](https://github.com/Rhoban/onshape-to-robot-examples)
- Annual limits: Enterprise "10,000 per Full User in Company"; Professional "5,000 per User in Company"; EDU Student / Free / Standard "2,500 per User"; EDU Enterprise "10,000 per Enterprise"; EDU Educator / Pro Discovery "2,500 per Company". Over the limit → HTTP 402; buy more from sales. Per-endpoint rate limits exist (values undisclosed) → HTTP 429. — [Onshape API Limits](https://onshape-public.github.io/docs/auth/limits/)
- What counts: only 2xx/3xx calls from API keys, OAuth2 *private* applications ("counting toward the app owner's limits, not end users'"), and authenticated API Explorer requests. Not counted: public Onshape App Store OAuth applications, browser/mobile client calls, webhooks, failed (4xx/5xx) requests. — [Onshape API Limits](https://onshape-public.github.io/docs/auth/limits/)
- Policy updated October 2025 (limits existed before but were undocumented); EDU = 2,500/year (~6.85/day); annual so running out early blocks the rest of the year; no documented way to see current usage; pricing for more is not transparent. — [Onshape forum: API limits](https://forum.onshape.com/discussion/27916/api-limits) (via search summary; thread requires sign-in)

### Inferences
- A private (unlisted) OAuth app would bill every team's imports to the app owner's 2,500/year (or 5,000/10,000) budget: unusable at FTC scale. The only OAuth path that scales is a **public Onshape App Store** listing (calls exempt), which requires Onshape's approval process.
- API-key scripts (like `tools/onshape-mates.mjs`) spend the team's own 2,500/year; a ~200-call robot import would allow only ~12 imports a year.
- The bookmarklet/session route most plausibly falls under "browser client calls", but Onshape does not say how it classifies cookie-authenticated `/api` calls initiated by user script; treat as likely-uncounted, unconfirmed.
- Public docs cannot be imported anonymously, so even a "paste a public link" feature needs auth.

### Gaps
- Numeric per-endpoint rate limits (requests/second) are not published.
- Classification of bookmarklet (session-cookie) calls for quota purposes is not documented.
- App Store listing requirements/timeline for a free educational app were not found publicly.

## 5. How existing Onshape→robot tools work, their conventions, and failure modes

### Takeaway
onshape-to-robot (Rhoban) is the reference: it needs named mates (`dof_*`), takes the first instance as base, reads limits and gear relations from `/features`, downloads one STL + mass + colour per unique part (cached), and fails on unnamed or unsupported mate types. Newer tools (onshape-robotics-toolkit, K-Scale `kol`) relax naming; MATLAB Simscape has its own exporter. All run server/desktop-side with API keys.

### Cited Findings
- onshape-to-robot endpoints: `/api/documents/{did}`, `/documents/d/…/elements`, `/assemblies/…` (definition), `/assemblies/…/features`, `/assemblies/…/matevalues`, `/parts/d/{did}/m/{mid}/e/{eid}` (parts list), `/parts/…/partid/{pid}/stl`, `/parts/…/partid/{pid}/massproperties`, `/metadata/…/p/{pid}` (colour), `/elements/…/configuration`, `/variables/…/variables`, `/partstudios/…/sketches`; all wrapped in `@cache_response`; no explicit retry logic. — [onshape-to-robot client.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/onshape_api/client.py)
- Naming rules: `dof_name` → DOF (revolute/cylindrical → revolute; slider → prismatic; fastened → fixed), `_inv` suffix inverts axis (`dof_head_pitch_inv` → joint `head_pitch`), `frame_name` adds frames/sites, `fix_name` merges links, `closing_name` closes kinematic loops, `link_name` names the link; "The first instance in the assembly list will be considered as the base link"; gear relations exported as `<mimic>` (URDF/SDF) or equality constraints (MuJoCo), "click source joint first, then target"; orphan links "fixed to the base link, with a warning". The docs say "mate connector" but the code matches on the **mate feature** name. — [onshape-to-robot design docs](https://onshape-to-robot.readthedocs.io/en/stable/_sources/design.rst.txt); [assembly.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/assembly.py)
- Code details: `dof_…wheel…` or `…continuous…` → continuous joint; `BALL` supported; any other `dof_` mate type raises "Only REVOLUTE, CYLINDRICAL, SLIDER and FASTENED are supported"; non-`dof_`/non-`closing_` FASTENED mates (and `fix_`) merge bodies; `closing_` mates with REVOLUTE/BALL etc. become loop closures; mates with an empty `matedOccurrence` are skipped. — [assembly.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/assembly.py)
- Dedupe: STL filename keyed by `(documentId, documentMicroversion, elementId, configuration, partId)`, so identical parts download once; parts with no mass produce a warning. — [robot_builder.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/robot_builder.py)
- onshape-robotics-toolkit (neurobionics): Python, API keys, URDF export, graph visualisation, claims "no … specific naming conventions" and support for "any assembly". — [GitHub neurobionics/onshape-robotics-toolkit](https://github.com/neurobionics/onshape-robotics-toolkit)
- K-Scale `kscale-onshape-library`: `kol run <url>` → URDF + MJCF; needs `ONSHAPE_ACCESS_KEY`/`ONSHAPE_SECRET_KEY`; post-processing merges fixed joints and simplifies meshes (vertex clustering). — [PyPI kscale-onshape-library](https://pypi.org/project/kscale-onshape-library)
- onshape-urdf-exporter is a fork with the same design-time doc. — [onshape-urdf-exporter docs](https://onshape-urdf-exporter.readthedocs.io/en/latest/_sources/design.rst.txt)
- MATLAB Simscape Multibody: `smexportonshape` writes intermediate XML, `smimport` builds the model. — [MathWorks: Export a model from Onshape](https://www.mathworks.com/help/sm/ug/export-a-model-from-onshape-software.html)

### Inferences
- What fails for FTC robots with these tools: unnamed mates (default "Revolute 3"), pin-slot/planar/parallel mates, rack-and-pinion/screw/linear relations (only gear ratios read), cascaded slides and linkages (closed loops need explicit `closing_` mates), parts without material (zero mass), deep sub-assemblies of linked COTS parts, and rate/quota limits.
- SimBench should not require `dof_` prefixes ("zero questions"): treat every non-fastened, non-suppressed mate between different rigid groups as a candidate joint (as `src/mates.js` already does), accept `dof_`/`_inv` names when present as hints, and model relations of all four types.

### Gaps
- Didn't inspect onshape-robotics-toolkit / K-Scale source for how they choose joints without naming or handle loops.
- No "Onshape-to-MuJoCo" tool distinct from onshape-to-robot's MuJoCo output was found.

## 6. Practical size, time and staying within limits

### Takeaway
No published statistics on FTC assembly sizes or fetch times were found. The design levers are: fetch per unique Part Studio (not per part), dedupe by `(documentId, elementId, microversion/version, configuration, partId)`, cache by document microversion, use versions (`v/`) for linked COTS documents (immutable, cacheable forever), and back off on 429.

### Cited Findings
- Every assembly instance carries `documentId`, `elementId`, `documentMicroversion`, `documentVersion`, `configuration`, `isStandardContent`; the definition's `rootAssembly.documentMicroversion` identifies the exact state. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)
- Calls can target `m/{microversionId}` for exact reproducibility; `elementMicroversionId` param exists on geometry/mass calls. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)
- Part Studio mass properties return all bodies in one call (`bodies` map); Part Studio tessellation accepts `partId` filters or returns all parts. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)
- onshape-to-robot dedupes geometry per `(documentId, documentMicroversion, elementId, configuration, partId)` and caches every API response. — [robot_builder.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/robot_builder.py); [client.py](https://github.com/Rhoban/onshape-to-robot/blob/master/onshape_to_robot/onshape_api/client.py)
- Exceeding per-endpoint rate limits yields 429; polling should use exponential backoff. — [Onshape API Limits](https://onshape-public.github.io/docs/auth/limits/); [Translation guide](https://onshape-public.github.io/docs/api-adv/translation/)

### Inferences
- A typical FTC robot (estimate, unsourced): a few hundred part instances but only tens of unique Part Studios once COTS duplicates collapse (goBILDA/REV parts come from a handful of vendor documents, each a configured Part Studio). Call count ≈ 5 + 2–3 × (unique Part Studio+configuration pairs), likely 50–200 calls; per-part calls (onshape-to-robot style) could be several hundred.
- Cache in the browser (IndexedDB) keyed by `documentId/v|m/id/elementId/configuration`: vendor-version entries never expire; team workspace entries are re-validated by comparing the new definition's microversion.
- Use coarse tessellation (`chordTolerance`/`angleTolerance` larger) for collision and view; meshes per face can be merged client-side.

### Gaps
- No real measurements of response sizes or latency for an FTC assembly; measure on the default robot (`assets/robots/into-the-deep/`) if its Onshape source is available.
- Whether goBILDA/REV official Onshape libraries are public documents with versions (vs. Part Studios copied into team docs) was not verified.

## 7. Mapping Onshape mate names to the team's code device names

### Takeaway
No FTC-specific convention for naming Onshape mates after `hardwareMap` device names was found. The only established convention in the Onshape→robot ecosystem is onshape-to-robot's `dof_<jointName>[_inv]`; SimBench can adopt "mate name == hardwareMap name" as an optional hint and fall back to matching otherwise.

### Cited Findings
- `dof_<name>` sets the exported joint name and `_inv` flips the axis; `link_<name>` names a link. — [onshape-to-robot design docs](https://onshape-to-robot.readthedocs.io/en/stable/_sources/design.rst.txt)
- Onshape default mate names follow the type (e.g. "Revolute 3"); this repo already detects default names with `/^(revolute|slider|fastened|cylindrical|pin[ _]?slot|planar|ball|parallel|tangent|width)\s*\d*$/i`. — `src/mates.js` (repo)
- `matevalues` returns `mateName` alongside `featureId`, so names are available without the feature list. — [Onshape OpenAPI spec](https://cad.onshape.com/api/openapi)
- A search for FTC simulators importing Onshape mates by hardwareMap name returned only generic robotics tools (onshape-to-robot, Simscape). — [search results incl. MathWorks](https://www.mathworks.com/help/sm/ug/export-a-model-from-onshape-software.html)

### Inferences
- Suggested matching ladder: exact (case/underscore-insensitive) match of mate name to a `hardwareMap.get(DcMotor/Servo, "name")` string from the team's Java; then `dof_<name>` stripping; then token similarity ("lift"/"slide"/"arm"/"claw"/"wrist") plus mate type (slider ↔ `DcMotor` slide, revolute with limits ↔ `Servo`); then the existing joint-spec editor for the remainder. Relations (gear/rack) propagate one driven device to followers.

### Gaps
- No Reddit r/FTC, Chief Delphi or FTC Discord source was found describing Onshape API use or mate-naming conventions by FTC teams.
