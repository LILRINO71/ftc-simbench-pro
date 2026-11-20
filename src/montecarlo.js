/* ============================================================
   6e.  MONTE CARLO — "does this auto work 7 times in 10?"

   The same autonomous, run N times from a seed each, with the things that
   change from one real run to the next changed a little: floor friction,
   robot mass, battery voltage, control latency, where the robot is set down,
   and where the field's elements sit. Each run is a full fresh sim (the
   rigid-body model, the team's code on the Java VM) so what comes out is
   what the sim says that auto does on that day, not a formula.

   Every run is its own seed. A run draws all its variation from that seed
   alone, in a fixed order, so it comes out the same whenever and wherever it
   is run, and a failure can be replayed by its seed. The master seed only
   decides which run seeds a batch uses (mcSeedFor).

   THE RANGES are assumptions, labelled as such in MC_RANGES and in the
   panel. The battery and latency ranges and the start jitter are the ones
   this feature was specified with; the friction, mass and field spreads are
   rough guesses at what changes between a pit and a match, not measurements.
   A team that knows its own spread can change them. The field is measured:
   jitter is around the nominal, never a move of it.

   SUCCESS is chosen by the caller:
     pose    the robot ends within posIn inches and degDeg degrees of a target:
             the end of the Road Runner path, or the place a no-variation run
             ends, or a pose given by hand
     points  the alliance's AUTO points (src/match.js) reach a target
   ============================================================ */
const MC_MAX_RUNS = 50;
const MC_DEFAULT_RUNS = 10;
/* Every factor: its range around the nominal, and what it is in plain words. All assumptions
   except where `given` says the number came from the feature's specification. */
const MC_RANGES = {
  friction:  { label: "Floor friction",   lo: -0.10, hi: 0.10, unit: "%",   scale: 100, assumed: "±10 %" },
  mass:      { label: "Robot mass",       lo: -0.05, hi: 0.05, unit: "%",   scale: 100, assumed: "±5 %" },
  volts:     { label: "Battery",          lo: 12.0,  hi: 13.5, unit: "V",   scale: 1,   given: "12.0 to 13.5 V" },
  latencyMs: { label: "Control latency",  lo: 0,     hi: 40,   unit: "ms",  scale: 1,   given: "0 to 40 ms" },
  start:     { label: "Start position",   lo: -1,    hi: 1,    unit: "in",  scale: 1,   given: "±1 in" },
  startH:    { label: "Start heading",    lo: -2,    hi: 2,    unit: "deg", scale: 1,   given: "±2 deg" },
  element:   { label: "Field elements",   lo: -0.5,  hi: 0.5,  unit: "in",  scale: 1,   assumed: "±0.5 in" },
  piece:     { label: "Game piece mass",  lo: -0.03, hi: 0.03, unit: "%",   scale: 100, assumed: "±3 %" }
};
const MC_KEYS = ["friction", "mass", "volts", "latencyMs", "start", "startH", "element", "piece"];
/* the AUTO period, and the longest a run may last */
const MC_AUTO_SECONDS = 30;

function mcRng(seed) { return makeRng(seed >>> 0); }
/* The seed of run i in a batch: a different, well mixed number for every i, the same every time. */
function mcSeedFor(master, i) {
  let h = (Math.imul((master | 0) ^ 0x9E3779B9, 0x85EBCA6B) + Math.imul(i + 1, 0xC2B2AE35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297A2D39) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}

/* One run's variation, drawn from its seed alone. Every factor is always drawn, in this order,
   so switching one off (vary.key === false) never changes another. `nObs` elements get an
   offset each, in inches. Returns plain numbers in the units of MC_RANGES, and `z`, how far
   each sits across its range (-1 low end, 0 nominal middle, +1 high end). */
function mcVariation(seed, ranges, nObs, vary) {
  const R = ranges || MC_RANGES, on = k => !vary || vary[k] !== false;
  const rnd = mcRng(seed), draw = k => R[k].lo + (R[k].hi - R[k].lo) * rnd();
  const raw = {};
  for (const k of ["friction", "mass", "volts", "latencyMs"]) raw[k] = draw(k);
  raw.dx = draw("start"); raw.dy = draw("start"); raw.dh = draw("startH");
  raw.piece = draw("piece");
  const offsets = [];
  for (let i = 0; i < (nObs | 0); i++) offsets.push([draw("element"), draw("element")]);
  const v = {
    seed: seed >>> 0,
    friction: on("friction") ? raw.friction : 0,
    mass: on("mass") ? raw.mass : 0,
    volts: on("volts") ? raw.volts : null,
    latencyMs: on("latencyMs") ? raw.latencyMs : 0,
    dx: on("start") ? raw.dx : 0, dy: on("start") ? raw.dy : 0, dh: on("startH") ? raw.dh : 0,
    piece: on("piece") ? raw.piece : 0,
    offsets: on("element") ? offsets : offsets.map(() => [0, 0])
  };
  const mid = k => (R[k].lo + R[k].hi) / 2, half = k => (R[k].hi - R[k].lo) / 2 || 1;
  const nz = (x, k) => (x - mid(k)) / half(k);
  const big = offsets.reduce((a, o) => Math.max(a, Math.abs(o[0]), Math.abs(o[1])), 0);
  const zz = (k, x, flag) => flag ? nz(x, k) : 0;
  v.z = {
    friction: zz("friction", v.friction, on("friction")), mass: zz("mass", v.mass, on("mass")),
    volts: v.volts == null ? 0 : nz(v.volts, "volts"), latencyMs: zz("latencyMs", v.latencyMs, on("latencyMs")),
    start: on("start") ? Math.max(Math.abs(v.dx), Math.abs(v.dy)) / half("start") : 0,
    startH: zz("startH", v.dh, on("startH")), piece: zz("piece", v.piece, on("piece")),
    element: on("element") ? big / half("element") : 0
  };
  return v;
}

/* Which factors were far out in this run, strongest first: the ones across the outer 40 % of their range. */
function mcExtremes(v, ranges, top, res) {
  const R = ranges || MC_RANGES, out = [];
  const pct = x => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + " %";
  const text = {
    friction: () => "floor friction " + pct(v.friction),
    mass: () => "mass " + pct(v.mass),
    volts: () => "battery " + (v.volts == null ? "" : v.volts.toFixed(1) + " V"),
    latencyMs: () => "control latency " + v.latencyMs.toFixed(0) + " ms",
    start: () => "set down " + Math.hypot(v.dx, v.dy).toFixed(1) + " in off the start mark",
    startH: () => "start heading " + (v.dh >= 0 ? "+" : "") + v.dh.toFixed(1) + " deg",
    piece: () => "game pieces " + pct(v.piece),
    element: () => "field elements up to " + v.offsets.reduce((a, o) => Math.max(a, Math.abs(o[0]), Math.abs(o[1])), 0).toFixed(1) + " in off"
  };
  for (const k of MC_KEYS) {
    // the elements are many small offsets: one of them is always near its limit, so they only count once something was touched
    if (k === "element") continue;
    const z = Math.abs(v.z[k] || 0);
    if (z >= 0.6) out.push({ key: k, z: v.z[k], label: R[k].label, text: text[k]() });
  }
  out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  if (res && res.bumps - (res.nominalBumps || 0) > 25) { const big = v.offsets.reduce((a, o) => Math.max(a, Math.abs(o[0]), Math.abs(o[1])), 0);
    out.unshift({ key: "element", z: 1, label: R.element.label, text: "pushed against a wall or field element " + ((res.bumps - (res.nominalBumps || 0)) * 0.02).toFixed(1) + " s longer than the nominal run (elements up to " + big.toFixed(1) + " in off)" }); }
  return out.slice(0, top || 3);
}

/* Where the last trajectory of a Road Runner auto ends, in inches and radians: the path's own end. */
function mcPathEnd(code) {
  if (!code || !code.rr || !code.rr.root) return null;
  let end = null;
  const walk = a => {
    if (!a) return;
    if (a.kids) a.kids.forEach(walk);
    else if (a.kind === "traj" && a.plan && a.plan.end) end = a.plan.end;
  };
  walk(code.rr.root);
  return end ? { x: end[0], y: end[1], h: end[2] } : null;
}

const mcWrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

/* A copy that is only plain data, which a worker can be handed: numbers, strings, arrays, typed
   arrays and plain objects, cycles kept. Functions and anything with a class behind it (the 3-D
   view hangs three.js objects on a loaded CAD) are left out. */
function mcPlain(x, seen) {
  if (x === null || typeof x !== "object") return typeof x === "function" ? undefined : x;
  if (ArrayBuffer.isView(x)) return x;
  seen = seen || new Map();
  if (seen.has(x)) return seen.get(x);
  if (Array.isArray(x)) {
    const a = []; seen.set(x, a);
    for (let i = 0; i < x.length; i++) { const v = mcPlain(x[i], seen); a.push(v === undefined ? null : v); }
    return a;
  }
  const proto = Object.getPrototypeOf(x);
  if (proto !== Object.prototype && proto !== null) return undefined;
  const o = {}; seen.set(x, o);
  for (const k of Object.keys(x)) { const v = mcPlain(x[k], seen); if (v !== undefined) o[k] = v; }
  return o;
}

/* A copy of the CAD that a worker can be handed, without what only the 3-D view draws (the triangles,
   the point cloud, the URDF shapes): the physics never reads them, and a worker is handed far less.
   Same results, checked in tests/montecarlo.test.mjs. */
function mcCadForWorker(cad) {
  const c = Object.assign({}, cad);
  c.solids = (cad.solids || []).map(s => { if (!s || !s.tri) return s; const o = Object.assign({}, s); delete o.tri; return o; });
  delete c.shapes; delete c.points;
  return mcPlain(c);
}

/* Everything a batch needs, as plain data a worker can be handed:
     spec {java:{src, libs}, cad, map, opts, alliance, shots, duration, success, ranges, vary}
   Returns the job mcRunOne takes. A caller that already has the parsed code passes spec.code. */
function mcPrepare(spec) {
  const code = spec.code || parseJava(spec.java.src, { libs: spec.java.libs || [] });
  const opts = Object.assign({ payloadKg: 0, duty: 0.3, trust: "code" }, spec.opts || {});
  const job = {
    code, cad: spec.cad, map: spec.map || {}, opts,
    alliance: spec.alliance === "blue" ? "blue" : "red", shots: spec.shots || null,
    duration: Math.min(MC_AUTO_SECONDS, Math.max(1, +spec.duration || MC_AUTO_SECONDS)),
    success: Object.assign({ mode: "pose", posIn: 2, degDeg: 5, target: "auto" }, spec.success || {}),
    ranges: spec.ranges || MC_RANGES, vary: spec.vary || null, target: null, nominal: null
  };
  job.nObs = Field.ok && !(opts.obstacles === "walls") ? Field.obstacles(0.46).length : 0;
  return job;
}

/* One run: the fresh sim, this seed's variation, the auto to its end or the end of the period.
   S is the sim to run it on: the one the engine has (a worker, a test) or, on a page that
   cannot start a worker, a copy of it. A copy cannot play the match, so points are null there. */
function mcRunOne(job, seed, S) {
  S = S || Sim;
  const v = mcVariation(seed, job.ranges, job.nObs, job.vary);
  return mcSim(job, v, S);
}
function mcSim(job, v, S) {
  const base = job.opts, d2r = Math.PI / 180;
  const opts = Object.assign({}, base, {
    mechanisms: "posed", jolt: null,
    muScale: 1 + v.friction,
    massScale: 1 + v.mass, volts: v.volts || undefined, latencyMs: v.latencyMs,
    obstacleOffsets: v.offsets.map(o => [o[0] * IN, o[1] * IN])
  });
  const wantPoints = job.success.mode === "points", live = S === Sim && Field.ok;
  const grams = { pollen: ELEMENT_G.pollen, nectar: ELEMENT_G.nectar }, was = { on: Match.on, bots: Match.bots, alliance: Shots.alliance, cfg: Shots.cfg, shotSeed: Shots.seed };
  const res = { seed: v.seed, v, ok: false, pose: null, err: null, points: null, t: 0, ended: null, bumps: 0, error: null };
  try {
    // game pieces a few percent off their nominal weight, for this run only
    if (v.piece) { ELEMENT_G.pollen = grams.pollen * (1 + v.piece); ELEMENT_G.nectar = grams.nectar * (1 + v.piece); }
    if (live) {
      Field.reset();
      Shots.alliance = job.alliance; if (job.shots) Shots.cfg = job.shots;
      // a fresh robot each run: nothing held over from the last one (its pre-loads were only ever given to
      // the first run of a batch), and the shots' scatter drawn from this run's own seed
      Shots.seed = (v.seed >>> 0) || 7; Shots.reset();
      if (wantPoints) { Match.on = true; Match.reset({ period: "Autonomous", user: job.alliance, userPose: { x: 0, y: 0, h: 0 }, seed: v.seed, skill: "typical" }); Match.bots = []; }
      else Match.on = false;
    }
    S.load(job.code, job.cad, job.map, opts);
    S.pad = { 1: {}, 2: {} }; S.onRumble = null;       // nobody is holding a controller
    S.init();
    // set down a little off the mark; the code's own idea of where it started is unchanged
    S.chassis = { x: S.chassis.x + v.dx * IN, y: S.chassis.y + v.dy * IN, h: S.chassis.h + v.dh * d2r };
    S.start();
    const n = Math.round(job.duration / 0.02);
    for (let i = 0; i < n; i++) {
      S.tick(0.02);
      if (S.phase !== "running") break;
      if (S.bump) res.bumps++;
      if ((S.rr && S.rr.done) || S.autoDone || (S.prog && S.prog.done)) { res.ended = +S.t.toFixed(2); break; }
    }
    res.t = +S.t.toFixed(2);
    const c = S.chassis, p = S.rr ? S.rr.pose() : { x: c.x / IN, y: c.y / IN, h: c.h };
    res.pose = { x: p.x, y: p.y, h: p.h };
    if (S.prog && S.prog.error) res.error = String(S.prog.error.msg || S.prog.error);
    if (wantPoints && live) { const sc = Match.score(S)[job.alliance]; res.points = sc ? sc.total : null; res.score = sc || null; }
  } catch (e) {
    res.error = String(e && e.message || e);
  } finally {
    ELEMENT_G.pollen = grams.pollen; ELEMENT_G.nectar = grams.nectar;
    if (live) { Match.on = was.on; Match.bots = was.bots; Shots.alliance = was.alliance; Shots.cfg = was.cfg; Shots.seed = was.shotSeed; }
  }
  return res;
}

/* Judge a finished run against the target and the thresholds. Fills err, ok and why. */
function mcJudge(res, job) {
  const s = job.success;
  res.nominalBumps = job.nominal ? job.nominal.bumps : 0;
  if (res.error && !res.pose) { res.ok = false; res.why = "stopped on an error: " + res.error; return res; }
  if (s.mode === "points") {
    res.ok = res.points != null && res.points >= (+s.points || 0);
    res.why = res.points == null ? "points need the background worker" : res.points + " points";
    return res;
  }
  const t = job.target;
  if (!t || !res.pose) { res.ok = false; res.why = "no target to compare with"; return res; }
  const dx = res.pose.x - t.x, dy = res.pose.y - t.y;
  res.err = { pos: Math.hypot(dx, dy), deg: Math.abs(mcWrap(res.pose.h - t.h)) * 180 / Math.PI };
  res.ok = !res.error && res.err.pos <= s.posIn && res.err.deg <= s.degDeg;
  res.why = res.err.pos.toFixed(1) + " in, " + res.err.deg.toFixed(1) + " deg off";
  return res;
}

/* The pose a batch is judged against: given by hand, the end of the Road Runner path, or the
   place a run with no variation at all ends (the auto as written, on a nominal robot). */
function mcTarget(job, S) {
  const t = job.success.target;
  if (t && typeof t === "object" && Number.isFinite(+t.x) && Number.isFinite(+t.y)) return { x: +t.x, y: +t.y, h: (+t.h || 0) * Math.PI / 180, from: "given" };
  if (t === "nominal" || !job.code.rr) return null;       // the nominal run decides
  const e = mcPathEnd(job.code);
  return e ? { x: e.x, y: e.y, h: e.h, from: "path end" } : null;
}
/* The run with no variation: friction, mass, battery and start exactly as set, the field as measured. */
function mcNominal(job, S) {
  const R = {};
  for (const k of MC_KEYS) R[k] = { lo: 0, hi: 0, label: MC_RANGES[k].label, unit: MC_RANGES[k].unit, scale: MC_RANGES[k].scale };
  R.volts = { lo: 12.6, hi: 12.6, label: "Battery", unit: "V", scale: 1 };
  const j = Object.assign({}, job, { ranges: R, vary: { volts: false } });
  return mcSim(j, mcVariation(0, R, job.nObs, j.vary), S || Sim);
}

/* A whole batch, in this thread. `n` runs, seeds from `master`; onRun(i, res) after each,
   and a true return from isCancelled() stops it. Returns {job, target, nominal, results}. */
function mcRun(job, n, master, hooks, S) {
  hooks = hooks || {}; S = S || Sim;
  const seeds = Array.isArray(hooks.seeds) && hooks.seeds.length ? hooks.seeds.slice(0, MC_MAX_RUNS) : null;
  n = seeds ? seeds.length : Math.max(1, Math.min(MC_MAX_RUNS, n | 0 || MC_DEFAULT_RUNS));
  const pre = mcSetup(job, S);
  const results = [];
  for (let i = 0; i < n; i++) {
    if (hooks.isCancelled && hooks.isCancelled()) break;
    const r = mcJudge(mcRunOne(job, seeds ? seeds[i] >>> 0 : mcSeedFor(master, i), S), job);
    r.extremes = mcExtremes(r.v, job.ranges, 3, r);
    results.push(r);
    if (hooks.onRun) hooks.onRun(i, r, n);
  }
  return { job, target: job.target, nominal: pre.nominal, results };
}
/* The target and the nominal run, done once before a batch (the worker reports them too). */
function mcSetup(job, S) {
  job.target = mcTarget(job, S);
  let nominal = null;
  if (job.success.mode === "pose") {
    nominal = mcNominal(job, S);
    if (!job.target && nominal.pose) job.target = { x: nominal.pose.x, y: nominal.pose.y, h: nominal.pose.h, from: "a run with no variation" };
    mcJudge(nominal, job);
  }
  job.nominal = nominal;
  return { target: job.target, nominal };
}

/* Counts in bins. edges ascending; the last bin is open ended. */
function mcHistogram(values, edges) {
  const bins = edges.map((lo, i) => ({ lo, hi: i + 1 < edges.length ? edges[i + 1] : Infinity, n: 0 }));
  for (const v of values) { for (let i = bins.length - 1; i >= 0; i--) if (v >= bins[i].lo) { bins[i].n++; break; } }
  return bins;
}

/* The batch as a few numbers and the runs worth looking at. */
function mcSummary(results, job) {
  const s = job.success, n = results.length, passed = results.filter(r => r.ok).length;
  let bins, metric, unit;
  if (s.mode === "points") {
    metric = results.map(r => r.points == null ? 0 : r.points); unit = "points";
    const top = Math.max(1, ...metric), step = Math.max(1, Math.ceil(top / 8));
    bins = mcHistogram(metric, Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => i * step));
    bins.forEach(b => { b.pass = b.hi > (+s.points || 0) || b.lo >= (+s.points || 0); });
  } else {
    metric = results.map(r => r.err ? r.err.pos : Infinity); unit = "in";
    const T = Math.max(0.25, +s.posIn || 2);
    bins = mcHistogram(metric, [0, 0.25 * T, 0.5 * T, 0.75 * T, T, 1.5 * T, 2 * T, 4 * T]);
    bins.forEach(b => { b.pass = b.hi <= T + 1e-9; });
  }
  // the worst: what failed, the furthest off first; with nothing failing, the furthest off
  const sev = r => s.mode === "points" ? -(r.points == null ? 0 : r.points) + (r.ok ? 1e6 : 0)
    : (r.err ? Math.max(r.err.pos / (+s.posIn || 2), r.err.deg / (+s.degDeg || 5)) : 1e9) + (r.ok ? 0 : 1e3);
  const worst = results.slice().sort((a, b) => sev(b) - sev(a)).slice(0, Math.min(3, n))
    .map(r => ({ seed: r.seed, ok: r.ok, why: r.why, error: r.error, pose: r.pose, err: r.err, points: r.points, extremes: r.extremes || mcExtremes(r.v, job.ranges, 3, r) }));
  return { n, passed, failed: n - passed, rate: n ? passed / n : 0, bins, unit, metric, worst, target: job.target, nominal: job.nominal || null,
    ended: results.filter(r => r.ended != null).length };
}

/* The code of the Web Worker that runs a batch off the page's thread. It loads the engine
   (dist/engine-<hash>.js) and the shot engine and its field data, then answers
     {op:"mc", spec, n, seed, seeds?}  with  {id, run:i, res} after each run and {id, done:true, target, nominal}.
   The page stops it by terminating the worker. */
function mcWorkerBody(engineUrl, shotUrl) {
  return `importScripts(${JSON.stringify(engineUrl)}${shotUrl ? ", " + JSON.stringify(shotUrl) : ""});
${shotUrl ? "var fieldError=null; try{ if(!Field.init(self.ShotEngine, self.SHOT_DATA)){ try{ var r=self.ShotEngine&&self.ShotEngine.init(self.SHOT_DATA); fieldError=\"the field data was refused: \"+(self.ShotEngine?JSON.stringify(r).slice(0,160)+\" data \"+typeof self.SHOT_DATA:\"no shot engine\"); }catch(e2){ fieldError=\"the shot engine stopped: \"+String(e2&&e2.message||e2); } } }catch(e){ fieldError=String(e&&e.message||e); }" : "var fieldError=\"no shot engine\";"}
postMessage({ready:true});
onmessage=function(e){
  const d=e.data;
  try{
    if(d.op!=="mc") throw new Error("unknown job "+d.op);
    const job=mcPrepare(d.spec);
    const pre=mcSetup(job,Sim);
    postMessage({id:d.id, setup:true, target:pre.target, nominal:pre.nominal, field:!!Field.ok, fieldError:fieldError, elements:job.nObs});
    const seeds=Array.isArray(d.seeds)&&d.seeds.length?d.seeds.slice(0,MC_MAX_RUNS):null;
    const n=seeds?seeds.length:Math.max(1,Math.min(MC_MAX_RUNS,d.n|0||MC_DEFAULT_RUNS));
    for(let i=0;i<n;i++){
      const r=mcJudge(mcRunOne(job,seeds?seeds[i]>>>0:mcSeedFor(d.seed,i),Sim),job);
      r.extremes=mcExtremes(r.v,job.ranges,3,r);
      postMessage({id:d.id, run:i, n:n, res:r});
    }
    postMessage({id:d.id, done:true});
  }catch(err){ postMessage({id:d.id, error:String(err&&err.message||err)}); }
};`;
}
