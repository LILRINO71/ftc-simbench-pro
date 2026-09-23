/* ============================================================
   9.  SESSION — the .ftcsim save/load bundle
   A whole workspace in one plain UTF-8 JSON file: the CAD as the
   bench understands it, the OpMode source, the hardware map, the
   options, the pose, the alliance and the shooter setup. Drag the
   file back in and you are where you left off, with no STEP to
   re-parse (a 40 MB export takes seconds; this takes none).

   Two things shape the format.

   SIZE. A 2000-part assembly is a quarter of a million points, so
   every length is written as a whole number of tenths of a
   millimetre (0.1 mm) and point arrays are flat [x,y,z,x,y,z,...].
   That quantization is the format's only lossy step: pack→unpack
   reproduces every coordinate to within 0.1 mm and everything else
   — code, map, options, pose, alliance — exactly. Directions are
   dimensionless, so they keep 6 decimals instead.

   TRUST. Teams mail these files to each other, so a file being
   loaded is hostile input. unpackSession type-checks every field,
   enforces hard caps on length, count and nesting, drops unknown
   keys, refuses to let a "__proto__" key reach Object.prototype,
   rejects NaN/Infinity, and never throws — it returns
   {ok:false, error, detail}. The Java is carried as TEXT and is
   never evaluated, here or anywhere else in the engine.

   The statement tree is deliberately NOT stored: it is a pure
   function of the source text, which is carried verbatim, so the
   app re-derives it with parseJava(session.java).
   ============================================================ */
const FTCSIM_MAGIC = "FTCSIMBENCH";

/* One closure so the helpers below can keep short names without
   colliding with the rest of the concatenated engine. */
const {sessionFromBench, packSession, unpackSession} = (function(){
  const APP = "ftc-simbench-pro";
  const VERSION = 1;
  const MM = 10000;                 // metres -> tenths of a millimetre (the file's only unit conversion)
  const DIR = 1e6;                  // unit vectors: 6 decimals is ~0.2 arc-seconds of axis error

  /* Ceilings, not budgets. Real files sit far below every one of them;
     they exist so a malformed or malicious file fails fast instead of
     eating the tab. unpackSession(text, opts) can lower any of them. */
  const CAPS = {
    maxChars: 24e6, maxDepth: 12, maxKeys: 2000, maxStr: 512,
    maxJava: 2e6, maxNotes: 20000,
    maxSolids: 4000, maxPointsPerSolid: 2000, maxCloud: 400000,
    maxParts: 6000, maxMechs: 400, maxPlacements: 4000,
    maxDevices: 400, maxTelemetry: 400
  };

  const fin = Number.isFinite;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
  const at = (o, k) => (isObj(o) && own(o, k)) ? o[k] : undefined;
  const unsafeKey = k => k === "__proto__" || k === "constructor" || k === "prototype";
  /* Never `o[k] = v` with a key from a file: assigning "__proto__" runs the
     Object.prototype setter and repoints the object. defineProperty writes a
     plain own property and nothing else — and the poisonous names are dropped
     before they get this far anyway. */
  const put = (o, k, v) => { if(!unsafeKey(k)) Object.defineProperty(o, k, {value:v, writable:true, enumerable:true, configurable:true}); };

  // thrown only inside this closure, and always caught at the unpackSession boundary
  const fail = (code, msg) => { throw {ftcsim:code, msg:msg}; };

  const capsFrom = o => {
    const c = {};
    for(const k in CAPS) c[k] = (isObj(o) && fin(at(o, k)) && at(o, k) >= 0) ? at(o, k) : CAPS[k];
    return c;
  };

  /* ---- reading: one reader, two moods ----
     C.strict is the file path (fail on anything out of bounds); the loose path
     builds a session from the live bench and simply clips. C.s turns whatever
     the source stores into metres — /MM from a file, quantized from the bench —
     so both moods produce the identical session shape. -0 is normalised away
     so a round-tripped session compares equal. */
  const qm = v => { const n = Math.round(v * MM); return n === 0 ? 0 : n / MM; };
  const qd = v => { const n = Math.round(v * DIR); return n === 0 ? 0 : n / DIR; };
  const dm = v => v === 0 ? 0 : v / MM;
  const fileCtx = caps => ({strict:true, caps:caps, s:dm});
  const benchCtx = caps => ({strict:false, caps:caps, s:qm});

  const text = (v, cap, C, what) => {
    if(typeof v !== "string") return null;
    if(v.length > cap){ if(C.strict) fail("too-big", what + " is " + v.length + " characters; the limit is " + cap); return v.slice(0, cap); }
    return v;
  };
  const str = (v, C, what) => text(v, C.caps.maxStr, C, what);
  /* A missing or wrongly typed field falls back to its default; a number that
     is NaN or Infinity is a corrupt file, not a default. */
  const num = (v, def, C, what) => {
    if(typeof v === "number" && fin(v)) return v;
    if(typeof v === "number" && C.strict) fail("bad-number", what + " is not a finite number");
    return def;
  };
  const int = (v, def, C, what) => Math.round(num(v, def, C, what));
  const bool = v => v === true;
  const list = (v, cap, C, what) => {
    if(!Array.isArray(v)) return [];
    if(v.length > cap){ if(C.strict) fail("too-big", what + " has " + v.length + " entries; the limit is " + cap); return v.slice(0, cap); }
    return v;
  };
  const oneOf = (v, allowed, def) => (typeof v === "string" && allowed.indexOf(v) >= 0) ? v : def;

  const dict = (v, C, what, read) => {
    const out = {};
    if(!isObj(v)) return out;
    const ks = [];
    for(const k in v) if(own(v, k) && !unsafeKey(k) && k.length <= C.caps.maxStr) ks.push(k);
    if(ks.length > C.caps.maxKeys){ if(C.strict) fail("too-big", what + " has " + ks.length + " keys; the limit is " + C.caps.maxKeys); ks.length = C.caps.maxKeys; }
    ks.sort();                      // sorted here so packing is byte-deterministic
    for(const k of ks){ const r = read(v[k], k); if(r !== undefined) put(out, k, r); }
    return out;
  };

  const vec3 = (a, C, what, def) => {
    if(!Array.isArray(a) || a.length < 3) return def || null;
    const x = a[0], y = a[1], z = a[2];
    if(!fin(x) || !fin(y) || !fin(z)){ if(C.strict) fail("bad-number", what + " is not three finite numbers"); return def || null; }
    return [C.s(x), C.s(y), C.s(z)];
  };
  const dir3 = (a, C, what) => {
    if(!Array.isArray(a) || a.length < 3) return [0, 0, 1];
    const x = a[0], y = a[1], z = a[2];
    if(!fin(x) || !fin(y) || !fin(z)){ if(C.strict) fail("bad-number", what + " is not three finite numbers"); return [0, 0, 1]; }
    return [qd(x), qd(y), qd(z)];
  };
  /* Points arrive flat from a file and as [[x,y,z],...] from the bench; both
     come back as [[x,y,z],...] in metres. */
  const points = (a, cap, C, what) => {
    if(!Array.isArray(a)) return [];
    const nested = a.length > 0 && Array.isArray(a[0]);
    if(nested) return list(a, cap, C, what).map(p => vec3(p, C, what, [0, 0, 0]));
    if(a.length % 3){ if(C.strict) fail("bad-shape", what + " is not a flat list of x,y,z triples"); return []; }
    const src = list(a, cap * 3, C, what), out = [];
    for(let i = 0; i < src.length; i += 3){
      const x = src[i], y = src[i + 1], z = src[i + 2];
      if(!fin(x) || !fin(y) || !fin(z)){ if(C.strict) fail("bad-number", what + " holds a value that is not a finite number"); continue; }
      out.push([C.s(x), C.s(y), C.s(z)]);
    }
    return out;
  };

  function readCad(v, C){
    if(!isObj(v)) return null;
    const bb = at(v, "bbox");
    const solids = list(at(v, "solids"), C.caps.maxSolids, C, "cad.solids").map((s, i) => ({
      name: str(at(s, "name"), C, "solid name"), part: str(at(s, "part"), C, "solid part number"),
      kind: str(at(s, "kind"), C, "solid kind") || "metal",
      size: C.s(num(at(s, "size"), 0, C, "solid size")),
      pts: points(at(s, "pts"), C.caps.maxPointsPerSolid, C, "solid " + i + " points"),
      mech: str(at(s, "mech"), C, "solid joint")              // set by an Onshape mate import
    }));
    // a joint's travel limits: metres for a slide (mm on file), radians for a turn
    const limits = (m, lin) => {
      const L = at(m, "limits");
      if(!Array.isArray(L) || L.length !== 2) return null;
      const one = v => v == null ? null : (lin ? C.s(num(v, 0, C, "mech limit")) : qd(num(v, 0, C, "mech limit")));
      return [one(L[0]), one(L[1])];
    };
    const mechs = list(at(v, "mechs"), C.caps.maxMechs, C, "cad.mechs").map(m => ({
      id: str(at(m, "id"), C, "mech id") || "mechanism",
      label: str(at(m, "label"), C, "mech label"),
      kind: str(at(m, "kind"), C, "mech kind"),
      parent: str(at(m, "parent"), C, "mech parent") || "chassis",
      dir: num(at(m, "dir"), 1, C, "mech dir") < 0 ? -1 : 1,
      axis: dir3(at(m, "axis"), C, "mech axis"),
      pivot: vec3(at(m, "pivot"), C, "mech pivot", [0, 0, 0]),
      distalTo: vec3(at(m, "distalTo"), C, "mech distalTo", null),
      cluster: points(at(m, "cluster"), C.caps.maxPointsPerSolid, C, "mech cluster"),
      lever: C.s(num(at(m, "lever"), 0, C, "mech lever")),
      restAngleDeg: qd(num(at(m, "restAngleDeg"), 0, C, "mech restAngleDeg")),   // degrees, an edge unit: the rig panel's own
      leverOverride: at(m, "leverOverride") == null ? null : C.s(num(at(m, "leverOverride"), 0, C, "mech leverOverride")),
      part: str(at(m, "part"), C, "mech part number"),
      partName: str(at(m, "partName"), C, "mech part name"),
      hasActuator: bool(at(m, "hasActuator")),
      manual: bool(at(m, "manual")), inferred: bool(at(m, "inferred")),
      // from an Onshape mate import (src/mates.js)
      alias: str(at(m, "alias"), C, "mech alias"),
      limits: limits(m, /^(linear|linear-slide|prismatic)$/.test(str(at(m, "kind"), C, "mech kind") || "")),
      couple: isObj(at(m, "couple")) ? {to: str(at(at(m, "couple"), "to"), C, "mech couple"),
        ratio: qd(num(at(at(m, "couple"), "ratio"), 1, C, "mech couple ratio")), via: str(at(at(m, "couple"), "via"), C, "mech couple via")} : null,
      fromMate: isObj(at(m, "fromMate")) ? {name: str(at(at(m, "fromMate"), "name"), C, "mate name"),
        type: str(at(at(m, "fromMate"), "type"), C, "mate type"), id: str(at(at(m, "fromMate"), "id"), C, "mate id")} : null
    }));
    for(const m of mechs){ if(!m.limits) delete m.limits; if(!m.couple) delete m.couple; if(!m.fromMate) delete m.fromMate; if(!m.alias) delete m.alias; }
    for(const s of solids) if(!s.mech) delete s.mech;
    const mt = at(v, "mates");
    return {
      name: str(at(v, "name"), C, "cad.name"),
      units: oneOf(at(v, "units"), ["METRE", "MILLIMETRE"], "METRE"),
      pointCount: Math.max(0, int(at(v, "pointCount"), 0, C, "cad.pointCount")),
      bbox: {
        min: vec3(at(bb, "min"), C, "bbox.min", [0, 0, 0]),
        max: vec3(at(bb, "max"), C, "bbox.max", [0, 0, 0])
      },
      parts: list(at(v, "parts"), C.caps.maxParts, C, "cad.parts").map(p => ({
        name: str(at(p, "name"), C, "part name") || "part",
        part: str(at(p, "part"), C, "part number"),
        n: Math.max(0, int(at(p, "n"), 1, C, "part count")),
        kind: str(at(p, "kind"), C, "part kind") || "struct"
      })),
      mechs: mechs,
      solids: solids,
      mates: isObj(mt) ? {source: oneOf(at(mt, "source"), ["onshape"], "onshape"),
        joints: Math.max(0, int(at(mt, "joints"), 0, C, "mates.joints")), matched: Math.max(0, int(at(mt, "matched"), 0, C, "mates.matched")),
        parts: Math.max(0, int(at(mt, "parts"), 0, C, "mates.parts")), loops: Math.max(0, int(at(mt, "loops"), 0, C, "mates.loops")),
        why: list(at(mt, "why"), 64, C, "mates.why").map(w => str(w, C, "mates note") || "")} : null,
      placements: list(at(v, "placements"), C.caps.maxPlacements, C, "cad.placements").map(p => ({
        nauo: str(at(p, "nauo"), C, "placement id"),
        parent: str(at(p, "parent"), C, "placement parent"),
        child: str(at(p, "child"), C, "placement child"),
        loc: vec3(at(p, "loc"), C, "placement loc", [0, 0, 0]),
        axis: dir3(at(p, "axis"), C, "placement axis")
      })),
      // the raw cloud is a fallback render only: once there are solids the view
      // never looks at it, so it is not worth the megabytes
      points: solids.length ? null : points(at(v, "points"), C.caps.maxCloud, C, "cad.points")
    };
  }

  function readCode(v, C){
    if(!isObj(v)) return null;
    return {
      opmode: str(at(v, "opmode"), C, "code.opmode"),
      kind: oneOf(at(v, "kind"), ["TeleOp", "Autonomous"], null),
      cls: str(at(v, "cls"), C, "code.cls"),
      base: str(at(v, "base"), C, "code.base"),
      devices: list(at(v, "devices"), C.caps.maxDevices, C, "code.devices").map(d => ({
        name: str(at(d, "name"), C, "device name") || "device",
        type: str(at(d, "type"), C, "device type") || "?",
        cfg: str(at(d, "cfg"), C, "device config name"),
        intent: str(at(d, "intent"), C, "device comment") || "",
        declaredRole: oneOf(at(d, "declaredRole"), ["Torque", "Speed"], null)
      })),
      consts: dict(at(v, "consts"), C, "code.consts", (x, k) => num(x, undefined, C, "const " + k)),
      vars: dict(at(v, "vars"), C, "code.vars", (x, k) => num(x, undefined, C, "var " + k)),
      timers: list(at(v, "timers"), C.caps.maxDevices, C, "code.timers").map(t => str(t, C, "timer")).filter(Boolean),
      telemetry: list(at(v, "telemetry"), C.caps.maxTelemetry, C, "code.telemetry").map(t => ({
        kind: oneOf(at(t, "kind"), ["addData", "addLine"], "addData"),
        label: str(at(t, "label"), C, "telemetry label") || "",
        expr: str(at(t, "expr"), C, "telemetry expression") || ""
      })),
      hasLoop: bool(at(v, "hasLoop")), hasWait: bool(at(v, "hasWait")),
      hasConfigAnnotation: bool(at(v, "hasConfigAnnotation"))
    };
  }

  const readPose = (v, C) => ({
    x: num(at(v, "x"), 0, C, "pose.x"),        // metres, full precision: a pose must come back exactly
    y: num(at(v, "y"), 0, C, "pose.y"),
    h: num(at(v, "h"), 0, C, "pose.h")         // radians
  });

  const readOpts = (v, C) => ({
    payloadKg: num(at(v, "payloadKg"), 0.18, C, "opts.payloadKg"),
    duty: num(at(v, "duty"), 0.3, C, "opts.duty"),
    trust: oneOf(at(v, "trust"), ["code", "cad"], "code"),
    front: oneOf(at(v, "front"), ["+x", "+y", "-x", "-y"], "+x"),
    baseModel: oneOf(at(v, "baseModel"), ["auto", "show", "hide"], "auto"),
    shooterModel: oneOf(at(v, "shooterModel"), ["auto", "show", "hide"], "auto"),
    turretScale: num(at(v, "turretScale"), 0.55, C, "opts.turretScale"),
    startPose: readPose(at(v, "startPose"), C)
  });

  /* The shot config is the Shot Sim's own document, in the Shot Sim's own
     units (h0In inches, wheelMm millimetres, angles degrees) — carried through
     verbatim rather than converted, so it goes back into Shots.cfg unchanged. */
  const readShots = (v, C) => {
    const c = at(v, "cfg");
    return {
      seed: int(at(v, "seed"), 7, C, "shots.seed"),
      spreadScale: num(at(v, "spreadScale"), 1, C, "shots.spreadScale"),
      fired: Math.max(0, int(at(v, "fired"), 0, C, "shots.fired")),
      scored: Math.max(0, int(at(v, "scored"), 0, C, "shots.scored")),
      cfg: !isObj(c) ? null : {
        shooter: str(at(c, "shooter"), C, "shot shooter"),
        feeder: str(at(c, "feeder"), C, "shot feeder"),
        motorId: str(at(c, "motorId"), C, "shot motor"),
        hoodDeg: num(at(c, "hoodDeg"), 75, C, "shot hoodDeg"),
        h0In: num(at(c, "h0In"), 16, C, "shot h0In"),
        wheelMm: num(at(c, "wheelMm"), 96, C, "shot wheelMm"),
        gear: num(at(c, "gear"), 1, C, "shot gear"),
        mountDeg: num(at(c, "mountDeg"), 0, C, "shot mountDeg"),
        ball: str(at(c, "ball"), C, "shot ball") || "pollen",
        type: str(at(c, "type"), C, "shot type") || "single",
        precision: str(at(c, "precision"), C, "shot precision") || "typical"
      }
    };
  };

  /* The session, in engine units (metres/radians), already snapped to the grid
     the file will use — so what you hold is exactly what will come back. */
  function readSession(v, C){
    const code = readCode(at(v, "code"), C);
    const src = at(v, "java");
    return {
      magic: FTCSIM_MAGIC, app: APP, version: VERSION,
      savedISO: str(at(v, "savedISO"), C, "savedISO") || "",
      notes: text(at(v, "notes"), C.caps.maxNotes, C, "notes") || "",
      cad: readCad(at(v, "cad"), C),
      java: text(typeof src === "string" ? src : at(at(v, "code"), "src"), C.caps.maxJava, C, "the OpMode source") || "",
      code: code,
      map: dict(at(v, "map"), C, "map", (x, k) => { const s = str(x, C, "map." + k); return s === null ? null : s; }),
      opts: readOpts(at(v, "opts"), C),
      chassis: readPose(at(v, "chassis"), C),
      alliance: at(v, "alliance") === "blue" ? "blue" : "red",
      shots: readShots(at(v, "shots"), C)
    };
  }

  /* ---- writing ---- */
  const mmI = v => { const n = Math.round(v * MM); return n === 0 ? 0 : n; };
  const vecI = p => [mmI(p[0]), mmI(p[1]), mmI(p[2])];
  const flat = pts => { const a = []; for(const p of pts) a.push(mmI(p[0]), mmI(p[1]), mmI(p[2])); return a; };

  const encCad = cad => !cad ? null : {
    name: cad.name, units: cad.units, pointCount: cad.pointCount,
    bbox: {min: vecI(cad.bbox.min), max: vecI(cad.bbox.max)},
    parts: cad.parts.map(p => ({name:p.name, part:p.part, n:p.n, kind:p.kind})),
    mechs: cad.mechs.map(m => ({
      id: m.id, label: m.label, kind: m.kind, parent: m.parent, dir: m.dir, axis: m.axis,
      pivot: vecI(m.pivot), distalTo: m.distalTo ? vecI(m.distalTo) : null, cluster: flat(m.cluster),
      lever: mmI(m.lever), restAngleDeg: m.restAngleDeg,
      leverOverride: m.leverOverride == null ? null : mmI(m.leverOverride),
      part: m.part, partName: m.partName, hasActuator: m.hasActuator, manual: m.manual, inferred: m.inferred,
      alias: m.alias || null,
      limits: m.limits ? m.limits.map(v => !Number.isFinite(v) ? null : (/^(linear|linear-slide|prismatic)$/.test(m.kind) ? mmI(v) : v)) : null,
      couple: m.couple ? {to: m.couple.to, ratio: m.couple.ratio, via: m.couple.via || null} : null,
      fromMate: m.fromMate ? {name: m.fromMate.name, type: m.fromMate.type, id: m.fromMate.id} : null
    })),
    solids: cad.solids.map(s => ({name:s.name, part:s.part, kind:s.kind, size:mmI(s.size), pts:flat(s.pts), mech:s.mech || null})),
    mates: cad.mates ? {source: cad.mates.source, joints: cad.mates.joints, matched: cad.mates.matched,
      parts: cad.mates.parts, loops: cad.mates.loops, why: cad.mates.why} : null,
    placements: cad.placements.map(p => ({nauo:p.nauo, parent:p.parent, child:p.child, loc:vecI(p.loc), axis:p.axis})),
    points: cad.points ? flat(cad.points) : null
  };

  /* Key order is fixed here and dictionary keys were sorted on the way in, so
     the same session always serialises to the same bytes. */
  const encode = s => ({
    magic: FTCSIM_MAGIC, app: APP, version: VERSION, unit: "0.1mm",
    savedISO: s.savedISO, notes: s.notes,
    cad: encCad(s.cad), java: s.java, code: s.code, map: s.map, opts: s.opts,
    chassis: s.chassis, alliance: s.alliance, shots: s.shots
  });

  /* Maximum bracket nesting of a JSON text, counted by scanning characters
     rather than by parsing. A nesting bomb has to be turned away BEFORE
     JSON.parse touches it — that is the whole point of doing it here. */
  function jsonDepth(t){
    let d = 0, max = 0, inStr = false, esc = false;
    for(let i = 0; i < t.length; i++){
      const c = t.charCodeAt(i);
      if(inStr){ if(esc) esc = false; else if(c === 92) esc = true; else if(c === 34) inStr = false; continue; }
      if(c === 34) inStr = true;
      else if(c === 123 || c === 91){ if(++d > max) max = d; }
      else if(c === 125 || c === 93) d--;
    }
    return max;
  }

  /* ---- the three public functions ---- */

  /* The plain object to save, from the live bench. savedISO comes from the
     caller: engine code never reads the clock. */
  function sessionFromBench(bench){
    const b = isObj(bench) ? bench : {};
    return readSession(b, benchCtx(CAPS));
  }

  /* JSON text. Lengths become whole tenths of a millimetre and point arrays go
     flat; everything else is written as it stands. opts.pretty indents it for
     a human (the bytes stay deterministic either way). */
  function packSession(session, opts){
    const o = isObj(opts) ? opts : {};
    const norm = readSession(isObj(session) ? session : {}, benchCtx(capsFrom(o)));
    return JSON.stringify(encode(norm), null, o.pretty ? (fin(o.indent) ? o.indent : 1) : 0);
  }

  /* {ok:true, session} or {ok:false, error, detail}. Never throws, never
     trusts the file, never evaluates the Java it carries. */
  function unpackSession(t, opts){
    const caps = capsFrom(opts);
    try{
      if(typeof t !== "string") fail("not-text", "a .ftcsim file is text; this was " + (t === null ? "null" : typeof t));
      if(!t.length) fail("empty", "the file is empty");
      if(t.length > caps.maxChars) fail("too-big", "the file is " + t.length + " characters; the limit is " + caps.maxChars);
      const depth = jsonDepth(t);
      if(depth > caps.maxDepth) fail("too-deep", "the file nests " + depth + " levels deep; the limit is " + caps.maxDepth);
      let raw;
      try{ raw = JSON.parse(t); }
      catch(e){ fail("bad-json", "this is not valid JSON, so it is not a .ftcsim file"); }
      if(!isObj(raw)) fail("not-a-session", "the file holds " + (Array.isArray(raw) ? "an array" : String(raw)) + ", not a saved session");
      if(at(raw, "magic") !== FTCSIM_MAGIC) fail("bad-magic", "this file is not a .ftcsim session (no " + FTCSIM_MAGIC + " marker)");
      const app = at(raw, "app");
      if(app !== APP) fail("wrong-app", "this session was saved by " + (typeof app === "string" ? JSON.stringify(app.slice(0, 64)) : "another program") + ", not " + APP);
      const v = at(raw, "version");
      if(!fin(v) || v < 1 || Math.round(v) !== v) fail("bad-version", "the file's version number is missing or nonsense");
      if(v > VERSION) fail("future-version", "this session was saved by a newer version of FTC SimBench Pro (file format " + v + ", this build reads " + VERSION + ") — update the bench, or ask for a file saved from this one");
      return {ok: true, session: readSession(raw, fileCtx(caps))};
    }catch(e){
      if(isObj(e) && typeof e.ftcsim === "string") return {ok: false, error: e.msg, detail: e.ftcsim};
      // a bug in here must still look like a bad file to the app, not a crash
      return {ok: false, error: "this file could not be read: " + ((e && e.message) || String(e)), detail: "internal"};
    }
  }

  return {sessionFromBench, packSession, unpackSession};
})();
