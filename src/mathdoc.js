/* ============================================================
   8.  SHOW MATH — the engineering portfolio exporter

   Takes the bench's own robot — this CAD, this OpMode, this mapping —
   and prints the equation behind every number the bench shows with the
   team's own values already substituted into it, so the result pastes
   straight into an Engineering Portfolio and every line can be defended
   to a judge.

   A bench is {cad, code, map, opts}. It may also carry two things that
   come from modules which are not always loaded:
     bench.mass    massProps(cad, opts)  — src/inertia.js
     bench.drive   driveFromCAD(cad)     — src/drivetrain.js
   Each is computed here when its module is present, taken from the bench
   when it is not, and when neither happens the rows that needed it say
   which input is missing rather than guessing at it.

   Nothing here invents a number. Every row carries where its inputs came
   from: CAD, code, vendor spec, Shot Sim or assumption.
   ============================================================ */

const MD_COLS = ["Quantity", "Formula", "With this robot's numbers", "Value", "Note", "Source"];

/* Three significant figures, and never a bare exponent where a plain
   number reads better — a portfolio table with "1.28e+3" in it looks wrong. */
function mdNum(v, sig) {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  if (v === 0) return "0";
  sig = sig || 3;
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(Math.max(0, sig - 1));
  let s = v.toPrecision(sig);
  if (s.indexOf("e") >= 0) s = String(Number(s));
  if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}
const mdQty = (v, unit) => mdNum(v) + (unit ? " " + unit : "");
const mdNo = (v) => typeof v === "number" && isFinite(v);

/* A sum with its terms written out, truncated once it stops being readable. */
function mdTerms(list, max) {
  const n = list.length, k = Math.min(n, max || 6);
  let s = list.slice(0, k).join(" + ");
  if (n > k) s += " + … (" + n + " terms)";
  return s;
}

/* A row whose inputs the bench doesn't have. It still goes in the table:
   a judge reading the portfolio should see what the team couldn't measure. */
function mdMiss(label, what) {
  return { label, symbols: "", expr: "", value: null, unit: "", note: "missing: " + what, source: "assumption" };
}

/* An inverse-kinematics matrix as a matrix, one row per wheel. */
function mdMatrix(rows, labels) {
  const cells = rows.map((r) => r.map((v) => mdNum(v)));
  let w = 1;
  cells.forEach((r) => r.forEach((c) => { w = Math.max(w, c.length); }));
  const tag = (i) => (labels && labels[i] ? (labels[i] + "    ").slice(0, 4) : "    ");
  return cells.map((r, i) => tag(i) + "[ " + r.map((c) => c.padStart(w)).join("  ") + " ]").join("\n");
}
/* The sibling module may hand the matrix over bare or wrapped. */
function mdRowsOf(ik) {
  const m = Array.isArray(ik) ? ik : (ik && (ik.rows || ik.m || ik.matrix));
  if (!Array.isArray(m) || !m.length || !Array.isArray(m[0])) return null;
  return m.every((r) => r.every(mdNo)) ? m : null;
}

/* A constant the OpMode actually wrote down: a literal, a final, or a
   plain field. Anything computed at run time comes back as nothing. */
function mdStatic(ast, code) {
  if (!ast) return null;
  if (ast.o === "num") return ast.v;
  if (ast.o === "id") {
    if (code.consts[ast.v] !== undefined) return code.consts[ast.v];
    if (code.vars[ast.v] !== undefined) return code.vars[ast.v];
  }
  return null;
}
function mdWalk(code, fn) {
  const go = (list) => { for (const st of list || []) {
    if (st.kind === "if") { go(st.then); go(st.else); }
    else if (st.kind === "while") go(st.body);
    else fn(st);
  } };
  go(code.inits); go(code.stmts); go(code.auto);
}
/* Every value a variable is assigned anywhere — a target the driver picks
   with a button is still a number the team chose. */
function mdAssigned(code, name) {
  const out = [];
  mdWalk(code, (st) => {
    if (st.kind === "assign" && st.name === name && !st.op) {
      const v = mdStatic(st.ast, code); if (v !== null) out.push(v);
    }
  });
  return out;
}
/* What the code commands a device to, through a variable if need be.
   A target kept in a variable is declared at rest — "double target = 0" — and
   then written wherever the driver picks a speed, so the declared value alone
   says nothing. Take both: the declaration and every assignment to it. */
function mdCommanded(code, devName, op) {
  const out = [];
  mdWalk(code, (st) => {
    if (st.kind !== "call" || st.dev !== devName || st.op !== op) return;
    const v = mdStatic(st.ast, code);
    if (v !== null) out.push(v);
    if (st.ast && st.ast.o === "id") mdAssigned(code, st.ast.v).forEach((x) => out.push(x));
  });
  return out;
}

/* PID gains the OpMode really sets, last write wins. */
function mdPids(code) {
  const by = {}, order = [];
  const at = (n) => { if (!by[n]) { by[n] = { name: n, p: null, i: null, d: null, f: null, where: "code" }; order.push(n); } return by[n]; };
  for (const st of code.inits || []) if (st.kind === "pidnew") {
    const c = at(st.obj), a = (st.args || []).map((x) => mdStatic(x, code));
    if (a.length >= 3) { c.p = a[0]; c.i = a[1]; c.d = a[2]; if (a.length > 3) c.f = a[3]; }
  }
  mdWalk(code, (st) => {
    if (st.kind !== "objcall") return;
    const a = (st.args || []).map((x) => mdStatic(x, code));
    if (/^(setPID|setPIDF|setVelocityPIDFCoefficients|setPositionPIDFCoefficients)$/.test(st.meth)) {
      const c = at(st.obj);
      if (a[0] !== null && a[0] !== undefined) c.p = a[0];
      if (a.length > 1) c.i = a[1];
      if (a.length > 2) c.d = a[2];
      if (a.length > 3) c.f = a[3];
    } else if (st.meth === "setP") at(st.obj).p = a[0];
    else if (st.meth === "setI") at(st.obj).i = a[0];
    else if (st.meth === "setD") at(st.obj).d = a[0];
  });
  return order.map((n) => by[n]).filter((c) => mdNo(c.p) || mdNo(c.i) || mdNo(c.d));
}

/* Mean wheel position: the point a mecanum robot turns about, and the
   point the centre of mass wants to sit over. */
function mdDriveCentre(drive) {
  const w = ((drive && drive.wheels) || []).filter((p) => p && mdNo(p.x) && mdNo(p.y));
  if (!w.length) return null;
  let sx = 0, sy = 0;
  w.forEach((p) => { sx += p.x; sy += p.y; });
  return { x: sx / w.length, y: sy / w.length, n: w.length };
}
/* A sibling module's confidence, however it chose to express it. */
function mdConf(c, what) {
  if (typeof c === "number" && c < 0.6) return what + " is a low-confidence read (" + mdNum(c * 100) + " %) — check it against the real robot before a judge does.";
  if (typeof c === "string" && /low|rough|guess/i.test(c)) return what + " is a low-confidence read (" + c + ") — check it against the real robot before a judge does.";
  return "";
}

/* Everything the sections share, gathered once. */
function mdInputs(bench) {
  const b = bench || {};
  const cad = b.cad || null;
  const code = Object.assign({ devices: [], inits: [], stmts: [], auto: [], consts: {}, vars: {} }, b.code || {});
  const map = b.map || {};
  const opts = Object.assign({ payloadKg: 0.180, duty: 0.30, trust: "code", mu: 0.90, batteryV: 12 }, b.opts || {});
  const mechs = (cad && cad.mechs) || [];
  const mechOf = (n) => mechs.filter((m) => m.id === map[n])[0] || null;

  let mass = b.mass || null;
  if (!mass && cad && typeof massProps === "function") { try { mass = massProps(cad, opts); } catch (e) { mass = null; } }
  let drive = b.drive || null;
  if (!drive && cad && typeof driveFromCAD === "function") { try { drive = driveFromCAD(cad); } catch (e) { drive = null; } }
  let dt = null;
  try { dt = detectDrivetrain(code); } catch (e) { dt = null; }

  // the drive motor: whichever wheel motor the code names first
  let dspec = null, ddev = null;
  for (const w of (dt && dt.wheels) || []) {
    const d = (code.devices || []).filter((x) => x.name === w.dev)[0];
    if (!d) continue;
    ddev = d;
    try { dspec = specFor(d, mechOf(d.name), opts.trust); } catch (e) { dspec = null; }
    if (dspec) break;
  }

  const wheels = (drive && drive.wheels) || [];
  const rFromCad = wheels.map((w) => w && w.r).filter(mdNo)[0];
  const r = mdNo(opts.wheelRm) ? opts.wheelRm : rFromCad;
  const gear = dspec && mdNo(dspec.ratio) ? dspec.ratio : null;
  const nOut = dspec && mdNo(dspec.rpm) ? dspec.rpm : null;
  const nMotor = mdNo(nOut) && mdNo(gear) ? nOut * gear : null;
  const wFree = mdNo(nMotor) ? nMotor * 2 * Math.PI / 60 : null;
  const vMax = mdNo(wFree) && mdNo(r) && mdNo(gear) ? wFree * r / gear : null;
  const nWheel = wheels.length || ((dt && dt.wheels.length) || 0);
  const tau = dspec && mdNo(dspec.stallNm) ? dspec.stallNm : null;
  const aMotor = mdNo(tau) && mdNo(r) && nWheel && mass && mdNo(mass.kg) && mass.kg > 0
    ? nWheel * tau / (r * mass.kg) : null;
  const tpr = mdNo(gear) ? 28 * gear : null;          // goBILDA: 28 encoder counts per motor revolution

  return { cad, code, map, opts, mechs, mechOf, mass, drive, dt, dspec, ddev,
           drv: { r, gear, nOut, nMotor, wFree, vMax, nWheel, tau, aMotor, tpr } };
}

/* ---------------------------------------------------------- 1  mass ---- */
function mdMassSection(X) {
  const intro = "Every mass below is either the vendor's published figure for that part or the part's own volume in the CAD times the density of the material it is cut from. " +
    "The centre of mass is where the robot balances, and the yaw inertia is what a turn has to overcome.";
  const rows = [], m = X.mass;
  if (!m || !mdNo(m.kg) || m.kg <= 0) {
    rows.push(mdMiss("total mass", "no mass model — load a CAD assembly so src/inertia.js can weigh the parts, or pass bench.mass"));
    return { id: "mass", title: "Mass and balance", intro, rows, warn: "" };
  }
  const parts = (m.parts || []).filter((p) => p && mdNo(p.kg));
  rows.push({ label: "total mass", symbols: "m = Σ mᵢ",
    expr: parts.length ? "m = " + mdTerms(parts.map((p) => mdNum(p.kg)), 6) + " = " + mdNum(m.kg) + " kg"
                       : "m = " + mdNum(m.kg) + " kg",
    value: m.kg, unit: "kg",
    note: m.assumed
      ? "ASSUMED: the CAD has no solid parts to weigh" + (mdNo(m.cadKg) && m.cadKg > 0 ? " (it accounts for only " + mdNum(m.cadKg) + " kg)" : "") +
        ", so the bench is running a typical competition robot. Weigh yours and say so here before a judge asks."
      : parts.length ? "each of the " + parts.length + " parts is listed below with where its mass came from"
                     : "the mass model didn't break this down by part",
    source: m.assumed ? "assumption" : "CAD" });

  const com = m.com || {};
  const zc = mdNo(m.comHeight) ? m.comHeight : (mdNo(com.z) ? com.z : null);
  if (mdNo(zc)) rows.push({ label: "centre of mass height", symbols: "z_com = Σ mᵢ zᵢ / Σ mᵢ",
    expr: "z_com = " + mdNum(zc) + " m above the tiles (" + mdNum(zc / IN) + " in)",
    value: zc, unit: "m",
    note: "the tipping line: the robot goes over when the acceleration reaches g · (half the track) / z_com",
    source: "CAD" });
  else rows.push(mdMiss("centre of mass height", "the mass model returned no centre of mass height"));

  const c = mdDriveCentre(X.drive);
  if (c && mdNo(com.x) && mdNo(com.y)) {
    const dx = com.x - c.x, dy = com.y - c.y, d = Math.hypot(dx, dy);
    rows.push({ label: "centre of mass offset from the drive centre", symbols: "Δ = p_com − p_wheels",
      expr: "Δ = (" + mdNum(com.x) + ", " + mdNum(com.y) + ") − (" + mdNum(c.x) + ", " + mdNum(c.y) + ") = (" +
        mdNum(dx) + ", " + mdNum(dy) + ") m,  ∣Δ∣ = " + mdNum(d) + " m",
      value: d, unit: "m",
      note: "the wheel centre is the mean of the " + c.n + " wheel positions; an offset here is weight one pair of wheels carries and the other doesn't",
      source: "CAD" });
  } else if (mdNo(com.x) && mdNo(com.y)) {
    rows.push(mdMiss("centre of mass offset from the drive centre", "no wheel positions — src/drivetrain.js finds these in the CAD, or pass bench.drive"));
  } else {
    rows.push(mdMiss("centre of mass offset from the drive centre", "the mass model returned no centre of mass position"));
  }

  if (mdNo(m.Izz)) rows.push({ label: "yaw inertia", symbols: "I_zz = Σ (Iᵢ + mᵢ dᵢ²)",
    expr: "I_zz = " + mdNum(m.Izz) + " kg·m²  (parallel axis to the centre of mass, over " + (parts.length || "all") + " parts)",
    value: m.Izz, unit: "kg·m²",
    note: "the turn torque the drivetrain has to find: τ = I_zz · α",
    source: "CAD" });
  else rows.push(mdMiss("yaw inertia", "the mass model returned no I_zz"));

  const cap = 20;
  for (const p of parts.slice(0, cap)) {
    const vendor = /vendor|listed|catalog|published|spec/i.test(p.how || "");
    rows.push({ label: String(p.name || "part"), symbols: "", expr: "m = " + mdNum(p.kg) + " kg",
      value: p.kg, unit: "kg",
      note: p.how ? String(p.how) : "no note on how this mass was obtained",
      source: vendor ? "vendor spec" : "assumption" });
  }
  if (parts.length > cap) rows.push({ label: "… and " + (parts.length - cap) + " more parts", symbols: "",
    expr: "Σ = " + mdNum(parts.slice(cap).reduce((s, p) => s + p.kg, 0)) + " kg",
    value: parts.slice(cap).reduce((s, p) => s + p.kg, 0), unit: "kg",
    note: "the rest of the assembly, already counted in the total above", source: "CAD" });

  return { id: "mass", title: "Mass and balance", intro, rows, warn: mdConf(m.confidence, "the mass model") };
}

/* ----------------------------------------------------- 2  drivetrain ---- */
function mdDriveSection(X) {
  const D = X.drv, drive = X.drive, rows = [];
  const kind = (drive && drive.kind) || (X.dt && X.dt.style) || null;
  const intro = (kind ? "The bench is running this base as " + (kind === "unknown" ? "an unrecognised drivetrain" : kind) +
    " on " + (D.nWheel || "an unknown number of") + " wheels. " : "") +
    "Speed comes from the motor's free speed through the gearbox to the wheel; the matrix is what turns a wanted chassis motion into wheel speeds; " +
    "the odometry constant is what turns encoder ticks back into metres travelled.";

  if (mdNo(D.r)) rows.push({ label: "wheel radius", symbols: "r = d / 2",
    expr: "r = " + mdNum(D.r * 2) + " m / 2 = " + mdNum(D.r) + " m  (d = " + mdNum(D.r * 2000) + " mm)",
    value: D.r, unit: "m",
    note: "measured off the wheel solids in the assembly", source: "CAD" });
  else rows.push(mdMiss("wheel radius", "no wheels found in the CAD — src/drivetrain.js measures these, or pass bench.opts.wheelRm"));

  if (mdNo(D.gear) && mdNo(D.nOut)) rows.push({ label: "gear ratio", symbols: "G = n_motor / n_wheel",
    expr: "G = " + mdNum(D.nMotor) + " rpm / " + mdNum(D.nOut) + " rpm = " + mdNum(D.gear) + " : 1",
    value: D.gear, unit: ": 1",
    note: (X.dspec && X.dspec.fam ? X.dspec.fam + " — " : "") + "the gearbox alone; any chain or belt between the gearbox and the wheel is not in this number",
    source: X.dspec && X.dspec.guess ? "assumption" : "vendor spec" });
  else rows.push(mdMiss("gear ratio", "no drive motor with a known gearbox — name the motor in the OpMode, or set its part number"));

  if (mdNo(D.wFree)) rows.push({ label: "motor free speed", symbols: "ω_free = 2π n_free / 60",
    expr: "ω_free = 2π × " + mdNum(D.nMotor) + " rpm / 60 = " + mdNum(D.wFree) + " rad/s",
    value: D.wFree, unit: "rad/s",
    note: "free speed at 12 V with nothing on the shaft", source: X.dspec && X.dspec.guess ? "assumption" : "vendor spec" });

  if (mdNo(D.vMax)) rows.push({ label: "maximum linear speed", symbols: "v_max = ω_free · r / G",
    expr: "v_max = (" + mdNum(D.nMotor) + " rpm = " + mdNum(D.wFree) + " rad/s) × " + mdNum(D.r) + " m / " + mdNum(D.gear) +
      " = " + mdNum(D.vMax) + " m/s",
    value: D.vMax, unit: "m/s",
    note: "no load: on tiles, with a match's worth of battery sag, expect a few per cent under this",
    source: X.dspec && X.dspec.guess ? "assumption" : "vendor spec" });
  else rows.push(mdMiss("maximum linear speed", "needs the wheel radius, the gear ratio and the motor's free speed — see the rows above"));

  const ik = mdRowsOf(drive && drive.ik);
  if (ik) {
    const labels = ((drive && drive.wheels) || []).map((w) => String((w && w.corner) || "").toUpperCase());
    rows.push({ label: "inverse kinematics", symbols: "ω_wheel = A · [ v_x  v_y  ω_z ]ᵀ",
      expr: "A =\n" + mdMatrix(ik, labels),
      value: null, unit: "",
      note: "one row per wheel, in the order the wheels are listed; the third column carries the turn term, which is why it scales with the track and wheelbase",
      source: "CAD" });
  } else {
    rows.push(mdMiss("inverse kinematics", "no IK matrix — src/drivetrain.js builds this from the wheel positions, or pass bench.drive.ik"));
  }

  if (mdNo(D.r) && mdNo(D.tpr)) {
    const s = 2 * Math.PI * D.r / D.tpr;
    rows.push({ label: "odometry constant", symbols: "s = 2π r / (N_ppr · G)",
      expr: "s = 2π × " + mdNum(D.r) + " m / (28 × " + mdNum(D.gear) + ") = " + mdNum(s) + " m per tick",
      value: s, unit: "m/tick",
      note: "28 counts per motor revolution is the goBILDA/REV encoder on the back of the motor, so one metre is " + mdNum(1 / s) + " ticks",
      source: "vendor spec" });
  } else {
    rows.push(mdMiss("odometry constant", "needs the wheel radius and the gear ratio to turn ticks into metres"));
  }

  if (ik) {
    const cf = ik.reduce((s, r2) => s + Math.abs(r2[0]), 0) / ik.length;
    const cs = ik.reduce((s, r2) => s + Math.abs(r2[1] === undefined ? 0 : r2[1]), 0) / ik.length;
    if (cs > 0) rows.push({ label: "strafe factor", symbols: "k = c_forward / c_strafe",
      expr: "k = " + mdNum(cf) + " / " + mdNum(cs) + " = " + mdNum(cf / cs),
      value: cf / cs, unit: "",
      note: "geometry only: the rollers also slip sideways, which this number does not include, so a real strafe is slower again",
      source: "CAD" });
  }

  if (drive && (mdNo(drive.track) || mdNo(drive.base))) {
    const t = mdNo(drive.track) ? drive.track : null, w = mdNo(drive.base) ? drive.base : null;
    const half = mdNo(t) && mdNo(w) ? (t + w) / 2 : null;
    rows.push({ label: "track and wheelbase", symbols: "(t + b) / 2",
      expr: "t = " + mdNum(t) + " m, b = " + mdNum(w) + " m" + (mdNo(half) ? ",  (t + b) / 2 = " + mdNum(half) + " m" : ""),
      value: mdNo(half) ? half : (mdNo(t) ? t : w), unit: "m",
      note: "the turn term in the matrix above is this length: a wider robot needs more wheel speed for the same rate of turn",
      source: "CAD" });
  }

  return { id: "drive", title: "Drivetrain", intro, rows, warn: mdConf(drive && drive.confidence, "the drivetrain read") };
}

/* ---------------------------------------------------- 3  joint torque ---- */
function mdTorqueSection(X) {
  const SERVO_KG = 0.060, LINK_KG = 0.055;      // the same figures the bench's own torque check uses
  const code = X.code, rows = [];
  const intro = "A joint that lifts has to hold its load at the worst angle it passes through, which is level, where the whole weight hangs on the lever. " +
    "The lever is measured in the CAD between the pivot and what the joint carries; the stall torque is the actuator's published figure.";
  const joints = [];
  for (const d of code.devices || []) {
    const mech = X.mechOf(d.name);
    if (!mech || mech.kind !== "revolute-lift") continue;
    let spec = null;
    try { spec = specFor(d, mech, X.opts.trust); } catch (e) { spec = null; }
    if (spec) joints.push({ d, mech, spec });
  }
  if (!joints.length) {
    rows.push(mdMiss("holding torque", "no lift joint — map a device onto a revolute-lift mechanism in Kinematics and this section fills itself in"));
    return { id: "torque", title: "Joint torque", intro, rows, warn: "" };
  }
  for (const j of joints) {
    const nm = mlabel(j.mech), lever = leverOf(j.mech);
    if (!(lever > 0)) { rows.push(mdMiss(nm + " — lever arm", "the CAD gives this joint nothing to carry, so its lever is zero; set a lever length in Kinematics")); continue; }
    const p = j.mech.pivot, q = j.mech.distalTo;
    const measured = j.mech.leverOverride != null ? "your value, typed into Kinematics" : "measured in the CAD from the pivot to what the joint carries";
    rows.push({ label: nm + " — lever arm", symbols: "r = ∣p_distal − p_pivot∣",
      expr: (p && q ? "r = ∣(" + q.map((v) => mdNum(v)).join(", ") + ") − (" + p.map((v) => mdNum(v)).join(", ") + ")∣ = " : "r = ") +
        mdNum(lever) + " m  (" + mdNum(lever * 1000) + " mm)",
      value: lever, unit: "m", note: measured, source: j.mech.leverOverride != null ? "assumption" : "CAD" });

    const load = X.opts.payloadKg + SERVO_KG + LINK_KG;
    rows.push({ label: nm + " — load on the lever", symbols: "m = m_payload + m_servo + m_link",
      expr: "m = " + mdNum(X.opts.payloadKg) + " + " + mdNum(SERVO_KG) + " + " + mdNum(LINK_KG) + " = " + mdNum(load) + " kg",
      value: load, unit: "kg",
      note: "the payload is the bench setting; 60 g for the end servo and 55 g for the link are the bench's standing figures — replace them with your own weighed parts if you have them",
      source: "assumption" });

    const rng = travelRange(code, j.d.name) || { lo: 0.5, hi: 0.5 };
    const rest = restPosOf(code, j.d.name);
    const a0 = armAngleDeg(j.mech, j.spec, rng.lo, rest), a1 = armAngleDeg(j.mech, j.spec, rng.hi, rest);
    const wa = worstAngle(a0, a1);
    const cf = Math.max(0.05, Math.abs(Math.cos(wa * Math.PI / 180)));
    const req = holdTorque(j.mech, wa, load);
    rows.push({ label: nm + " — holding torque needed", symbols: "τ = m · g · r · cos θ",
      expr: "τ = " + mdNum(load) + " kg × " + mdNum(G) + " m/s² × " + mdNum(lever) + " m × cos " + mdNum(wa) + "° (= " + mdNum(cf) + ") = " + mdNum(req) + " N·m",
      value: req, unit: "N·m",
      note: "θ is the worst angle in the sweep " + mdNum(a0) + "° → " + mdNum(a1) + "° off horizontal, which is level whenever the joint passes through it",
      source: "CAD" });

    const stall = mdNo(j.spec.stallNm) ? j.spec.stallNm : null;
    if (!mdNo(stall)) { rows.push(mdMiss(nm + " — stall torque", "no published stall torque for " + (j.spec.fam || j.d.name))); continue; }
    rows.push({ label: nm + " — actuator stall torque", symbols: "τ_stall",
      expr: "τ_stall = " + mdNum(stall) + " N·m  (" + (j.spec.fam || j.d.type || "actuator") + ")",
      value: stall, unit: "N·m",
      note: "stall is the most it can produce for an instant, not what it holds all match",
      source: j.spec.guess ? "assumption" : (j.spec.src === "code" ? "code" : "vendor spec") });

    const usable = stall * X.opts.duty;
    const margin = req > 0 ? usable / req : null;
    rows.push({ label: nm + " — safety margin", symbols: "n = τ_stall · duty / τ",
      expr: "n = " + mdNum(stall) + " N·m × " + mdNum(X.opts.duty) + " / " + mdNum(req) + " N·m = " + mdNum(margin) + "×",
      value: margin, unit: "×",
      note: "duty " + mdNum(X.opts.duty * 100) + " % is the share of stall a servo will hold continuously without cooking; " +
        (mdNo(margin) && margin < 1 ? "under 1.0 this joint cannot hold its load at all" : "under about 1.35 it holds on a fresh battery and sags as the voltage drops"),
      source: "assumption" });
  }
  return { id: "torque", title: "Joint torque", intro, rows, warn: "" };
}

/* ------------------------------------------ 4  traction and acceleration ---- */
function mdTractionSection(X) {
  const D = X.drv, rows = [];
  const m = X.mass && mdNo(X.mass.kg) ? X.mass.kg : null;
  const mu = mdNo(X.opts.mu) ? X.opts.mu : null;
  const intro = "A drivetrain is limited either by what the motors can push or by what the tiles will hold. " +
    "Whichever is smaller is the one the driver feels, and building past it buys nothing.";

  if (!mdNo(m)) rows.push(mdMiss("weight per wheel", "no robot mass — see the mass section"));
  else if (!D.nWheel) rows.push(mdMiss("weight per wheel", "no wheel count — src/drivetrain.js finds the wheels in the CAD, or name the drive motors in the OpMode"));
  else rows.push({ label: "weight per wheel", symbols: "W = m · g / N",
    expr: "W = " + mdNum(m) + " kg × " + mdNum(G) + " m/s² / " + D.nWheel + " = " + mdNum(m * G / D.nWheel) + " N",
    value: m * G / D.nWheel, unit: "N",
    note: "standing still and level; under acceleration weight shifts back and the front wheels carry less than this",
    source: "CAD" });

  if (mdNo(m) && mdNo(mu)) {
    rows.push({ label: "friction limit", symbols: "F_max = μ · m · g",
      expr: "F_max = " + mdNum(mu) + " × " + mdNum(m) + " kg × " + mdNum(G) + " m/s² = " + mdNum(mu * m * G) + " N",
      value: mu * m * G, unit: "N",
      note: "the most the tiles will hand back before the wheels slip; μ = " + mdNum(mu) + " is the bench's figure for rubber on FTC tile — pull the robot with a fish scale to measure your own",
      source: "assumption" });
    rows.push({ label: "traction-limited acceleration", symbols: "a_traction = μ · g",
      expr: "a_traction = " + mdNum(mu) + " × " + mdNum(G) + " m/s² = " + mdNum(mu * G) + " m/s²",
      value: mu * G, unit: "m/s²",
      note: "independent of mass: a heavier robot grips harder in exactly the same proportion as it is harder to accelerate",
      source: "assumption" });
  } else {
    rows.push(mdMiss("traction-limited acceleration", mdNo(m) ? "no coefficient of friction — set bench.opts.mu" : "no robot mass — see the mass section"));
  }

  if (mdNo(D.aMotor)) rows.push({ label: "motor-limited acceleration", symbols: "a_motor = N · τ_stall / (r · m)",
    expr: "a_motor = " + D.nWheel + " × " + mdNum(D.tau) + " N·m / (" + mdNum(D.r) + " m × " + mdNum(m) + " kg) = " + mdNum(D.aMotor) + " m/s²",
    value: D.aMotor, unit: "m/s²",
    note: "at stall, on the output shaft: the ceiling at zero speed, and it falls away linearly as the robot picks up speed",
    source: X.dspec && X.dspec.guess ? "assumption" : "vendor spec" });
  else rows.push(mdMiss("motor-limited acceleration", "needs the drive motor's stall torque, the wheel radius, the wheel count and the robot mass"));

  if (mdNo(D.aMotor) && mdNo(m) && mdNo(mu)) {
    const at = mu * G, gov = Math.min(at, D.aMotor);
    rows.push({ label: "governing limit", symbols: "a = min(a_traction, a_motor)",
      expr: "a = min(" + mdNum(at) + ", " + mdNum(D.aMotor) + ") = " + mdNum(gov) + " m/s² — " + (at <= D.aMotor ? "traction governs" : "the motors govern"),
      value: gov, unit: "m/s²",
      note: at <= D.aMotor
        ? "the wheels break loose before the motors run out, so a grippier wheel or more weight over the drive wheels buys acceleration and a faster motor does not"
        : "the motors run out before the wheels slip, so a lower gear ratio buys acceleration and a grippier wheel does not",
      source: "assumption" });
  } else {
    rows.push(mdMiss("governing limit", "needs both limits above before they can be compared"));
  }
  return { id: "traction", title: "Traction and acceleration", intro, rows, warn: "" };
}

/* ----------------------------------------------- 5  feedforward and PID ---- */
function mdFFSection(X) {
  const D = X.drv, rows = [], V = mdNo(X.opts.batteryV) ? X.opts.batteryV : 12;
  const intro = "A feedforward says what voltage a wanted speed needs before any error is measured; the PID only cleans up what is left. " +
    "kV and kA below are the theoretical values from the motor curve and this robot's mass — a real robot's are measured, and land a little higher.";

  if (mdNo(D.vMax)) rows.push({ label: "kV — volts per metre per second", symbols: "kV = V_nominal / v_max",
    expr: "kV = " + mdNum(V) + " V / " + mdNum(D.vMax) + " m/s = " + mdNum(V / D.vMax) + " V·s/m",
    value: V / D.vMax, unit: "V·s/m",
    note: "hold this voltage and the robot settles at 1 m/s with nothing else acting on it",
    source: "vendor spec" });
  else rows.push(mdMiss("kV", "needs the maximum linear speed — see the drivetrain section"));

  if (mdNo(D.aMotor)) rows.push({ label: "kA — volts per metre per second squared", symbols: "kA = V_nominal / a_max",
    expr: "kA = " + mdNum(V) + " V / " + mdNum(D.aMotor) + " m/s² = " + mdNum(V / D.aMotor) + " V·s²/m",
    value: V / D.aMotor, unit: "V·s²/m",
    note: "the extra voltage a metre per second squared of acceleration costs; it is small, which is why a kV-only feedforward already tracks well",
    source: "vendor spec" });
  else rows.push(mdMiss("kA", "needs the motor-limited acceleration — see the traction section"));

  // kS is stiction. The motor's own no-load draw is the only part of it a
  // datasheet knows; everything else has to be measured on the real robot.
  let mo = null;
  try {
    if (typeof Field !== "undefined" && Field.ok && mdNo(D.nMotor)) {
      const id = nearestMotorId(D.nMotor);
      mo = (Field.data.motors.motors || []).filter((x) => x.id === id)[0] || null;
    }
  } catch (e) { mo = null; }
  if (mo && mdNo(mo.freeCurrentA) && mdNo(mo.stallCurrentA)) {
    const kS = V * mo.freeCurrentA / mo.stallCurrentA;
    rows.push({ label: "kS — the voltage floor", symbols: "kS ≈ V_nominal · I_free / I_stall",
      expr: "kS ≈ " + mdNum(V) + " V × " + mdNum(mo.freeCurrentA) + " A / " + mdNum(mo.stallCurrentA) + " A = " + mdNum(kS) + " V",
      value: kS, unit: "V",
      note: "the motor's own friction only (" + mo.label + "); the gearbox, the belts and the tiles add more, so measure the real kS with a slow voltage ramp until the robot just moves",
      source: "vendor spec" });
  } else {
    rows.push(mdMiss("kS — the voltage floor", "no free and stall current for this motor — kS is measured anyway, by ramping voltage until the robot just breaks away"));
  }

  const pids = mdPids(X.code);
  if (!pids.length) {
    rows.push(mdMiss("PID constants", "this OpMode never sets any, so the SDK's defaults stand: P 10, I 3, D 0, F 0 for RUN_USING_ENCODER and P 10 for RUN_TO_POSITION"));
  } else for (const c of pids) {
    const isDefault = c.p === 10 && c.i === 3 && (c.d === 0 || c.d === null);
    rows.push({ label: c.name + " — PID gains", symbols: "u = kP·e + kI·∫e dt + kD·de/dt",
      expr: "u = " + mdNum(c.p) + "·e + " + mdNum(c.i) + "·∫e dt + " + mdNum(c.d) + "·de/dt" +
        (mdNo(c.f) ? "  + " + mdNum(c.f) + " (kF)" : ""),
      value: null, unit: "",
      note: isDefault ? "these are the SDK's default velocity coefficients, not tuned values — P 10, I 3, D 0 is what a motor comes out of the box with"
                      : "set by this OpMode; the bench runs this loop for real but has no inertia or gravity in the motor model, so don't tune the gains here",
      source: "code" });
  }
  return { id: "ff", title: "Feedforward and PID", intro, rows, warn: "" };
}

/* -------------------------------------------------------- 6  shooter ---- */
function mdShooterSection(X) {
  const code = X.code;
  let name = X.opts.shooter || null;
  const S = (typeof Shots !== "undefined") ? Shots : null;
  if (!name && S && S.cfg && S.cfg.shooter) name = S.cfg.shooter;
  if (!name && S) { try { name = (S.detect(code).shooter || [])[0] || null; } catch (e) { name = null; } }
  if (!name) return null;                       // no flywheel on this robot: no section

  const cfg = Object.assign({}, S && S.cfg ? S.cfg : (S ? S.defaults() : {}), X.opts.shot || {});
  const rows = [];
  const intro = "The flywheel's surface speed is what the ball leaves at, less whatever slips between the wheel and the ball. " +
    "The scoring window is the BIOBUZZ Shot Sim's: the band of exit speeds that land in the up-CELL from where the robot is standing.";

  const dev = (code.devices || []).filter((d) => d.name === name)[0] || null;
  let spec = null;
  try { if (dev) spec = specFor(dev, X.mechOf(name), X.opts.trust); } catch (e) { spec = null; }
  const gear = mdNo(cfg.gear) ? cfg.gear : 1;
  const dM = mdNo(cfg.wheelMm) ? cfg.wheelMm / 1000 : null;
  const tpr = spec && mdNo(spec.ratio) ? 28 * spec.ratio : 28;

  const ticks = mdCommanded(code, name, "setVelocity").filter((v) => v > 0);
  const powers = mdCommanded(code, name, "setPower").map(Math.abs).filter((v) => v > 0);
  let nFly = null, how = "";
  if (ticks.length) {
    const t = Math.max.apply(null, ticks);
    nFly = 60 * t / tpr * gear;
    how = "n = 60 × " + mdNum(t) + " tick/s / " + mdNum(tpr) + " tick/rev × " + mdNum(gear) + " = " + mdNum(nFly) + " rpm";
    rows.push({ label: "flywheel speed", symbols: "n_fly = 60 · ticks_per_second / N_ppr · G_fly",
      expr: how, value: nFly, unit: "rpm",
      note: "the fastest setVelocity this OpMode commands " + name + "; " + mdNum(tpr) + " ticks per output revolution is 28 counts on the motor through its gearbox",
      source: "code" });
  } else if (powers.length && spec && mdNo(spec.rpm)) {
    const pw = Math.min(1, Math.max.apply(null, powers));
    nFly = spec.rpm * pw * gear;
    rows.push({ label: "flywheel speed", symbols: "n_fly = n_free · power · G_fly",
      expr: "n = " + mdNum(spec.rpm) + " rpm × " + mdNum(pw) + " × " + mdNum(gear) + " = " + mdNum(nFly) + " rpm",
      value: nFly, unit: "rpm",
      note: "open loop: setPower asks for a share of free speed, and a ball in the wheel drags it below this every shot",
      source: "code" });
  } else {
    rows.push(mdMiss("flywheel speed", "the OpMode never commands " + name + " with a constant setVelocity or setPower the bench can read"));
  }

  let vSurf = null;
  if (mdNo(nFly) && mdNo(dM)) {
    vSurf = Math.PI * dM * nFly / 60;
    rows.push({ label: "flywheel surface speed", symbols: "v_surface = π · d · n / 60",
      expr: "v_surface = π × " + mdNum(dM) + " m × " + mdNum(nFly) + " rpm / 60 = " + mdNum(vSurf) + " m/s",
      value: vSurf, unit: "m/s",
      note: "the rim speed of a " + mdNum(cfg.wheelMm) + " mm wheel — the ball never leaves this fast, because it only ever takes a share of it",
      source: "vendor spec" });
  } else {
    rows.push(mdMiss("flywheel surface speed", mdNo(nFly) ? "no flywheel wheel diameter — set it in the Shot tab" : "needs the flywheel speed above"));
  }

  // the share of surface speed a ball leaves with, straight out of the Shot Sim
  let fx = null;
  try {
    if (S && typeof Field !== "undefined" && Field.ok) {
      const mm = Field.E.motorModel(cfg.motorId || nearestMotorId(6000),
        { type: cfg.type || "single", wheelDiameterMm: cfg.wheelMm, gear: gear, motorsPerWheel: 1 },
        cfg.ball || "pollen", 1);
      if (mm && mm.details && mdNo(mm.details.exitFactor)) fx = mm.details.exitFactor;
    }
  } catch (e) { fx = null; }

  let vExit = null;
  if (mdNo(vSurf) && mdNo(fx)) {
    vExit = fx * vSurf;
    rows.push({ label: "exit speed", symbols: "v_exit = η · v_surface",
      expr: "v_exit = " + mdNum(fx) + " × " + mdNum(vSurf) + " m/s = " + mdNum(vExit) + " m/s",
      value: vExit, unit: "m/s",
      note: "η is the Shot Sim's transfer efficiency for a " + (cfg.type || "single") + "-wheel shooter: the ball rolls against a free surface, so it leaves at well under rim speed",
      source: "Shot Sim" });
  } else {
    rows.push(mdMiss("exit speed", mdNo(vSurf) ? "the Shot Sim isn't loaded, so the wheel-to-ball transfer efficiency is unknown" : "needs the surface speed above"));
  }

  const ball = cfg.ball || "pollen";
  const mBall = (typeof ELEMENT_G !== "undefined" && mdNo(ELEMENT_G[ball])) ? ELEMENT_G[ball] / 1000 : null;
  if (mdNo(mBall)) rows.push({ label: ball.toUpperCase() + " mass", symbols: "m_ball",
    expr: "m = " + mdNum(ELEMENT_G[ball]) + " g = " + mdNum(mBall) + " kg",
    value: mBall, unit: "kg", note: "the measured mass of a game element, from the Shot Sim's field data", source: "Shot Sim" });
  else rows.push(mdMiss("ball mass", "no mass on record for a " + ball));

  if (mdNo(vExit) && mdNo(mBall)) {
    const E = 0.5 * mBall * vExit * vExit;
    rows.push({ label: "kinetic energy at launch", symbols: "E = ½ · m · v²",
      expr: "E = 0.5 × " + mdNum(mBall) + " kg × (" + mdNum(vExit) + " m/s)² = " + mdNum(E) + " J",
      value: E, unit: "J",
      note: "every shot takes this out of the flywheel, which is why the wheel dips and has to recover before the next ball",
      source: "Shot Sim" });
  } else {
    rows.push(mdMiss("kinetic energy at launch", "needs the exit speed and the ball mass above"));
  }

  // The window can only come from the Shot tab's own configuration, because
  // that is the hood angle and alliance the team is actually shooting with.
  // Nothing here writes to it: a report must not change what it reports on.
  let win = null, pose = X.opts.pose || null, why = "";
  const hood = S && S.cfg && mdNo(S.cfg.hoodDeg) ? S.cfg.hoodDeg : null;
  if (!S || typeof Field === "undefined" || !Field.ok) {
    why = "the BIOBUZZ Shot Sim field isn't loaded, so no shot can be flown";
  } else if (!S.cfg) {
    why = "the Shot tab hasn't been set up yet, so there is no hood angle or alliance to fly a shot with";
  } else {
    try {
      if (!pose) pose = Field.startPose(S.alliance || "red", (typeof Sim !== "undefined" && Sim.footprint) || null);
      win = S.window(pose, pose.h * 180 / Math.PI + (S.cfg.mountDeg || 0));
      if (!win) why = "at a " + mdNum(hood) + "° hood no exit speed at all scores from where the robot starts, on its starting heading — " +
        "turn toward the CELL, or change the hood angle, and this row fills in";
    } catch (e) { win = null; why = "the Shot Sim could not fly a shot from this pose"; }
  }
  if (win && mdNo(win.lo) && mdNo(win.hi)) {
    rows.push({ label: "scoring speed window", symbols: "v ∈ [v_lo, v_hi]  at hood θ",
      expr: "v ∈ [" + mdNum(win.lo) + ", " + mdNum(win.hi) + "] m/s  at hood " + mdNum(hood) + "° from (" +
        mdNum(pose.x / IN) + ", " + mdNum(pose.y / IN) + ") in",
      value: (win.hi - win.lo), unit: "m/s wide",
      note: "the Shot Sim flies the ball with drag, the CELL lip and the HIVE frame in the way; a wider window is a shot that forgives a slow flywheel" +
        (mdNo(vExit) ? (vExit >= win.lo && vExit <= win.hi ? " — this robot's " + mdNum(vExit) + " m/s lands inside it" : " — this robot's " + mdNum(vExit) + " m/s is outside it") : ""),
      source: "Shot Sim" });
  } else {
    rows.push(mdMiss("scoring speed window", why));
  }

  return { id: "shooter", title: "Shooter", intro, rows, warn: "" };
}

/* ========================================================== the report ==== */
function mathReport(bench) {
  const X = mdInputs(bench);
  const S = [mdMassSection(X), mdDriveSection(X), mdTorqueSection(X),
             mdTractionSection(X), mdFFSection(X), mdShooterSection(X)];
  return { sections: S.filter(Boolean) };
}

/* Greedy wrap, so the plain-text export reads in a fixed-width editor. */
function mdWrap(text, width) {
  const out = [];
  let line = "";
  for (const w of String(text == null ? "" : text).split(/\s+/).filter(Boolean)) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += " " + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

function mathText(report) {
  const secs = (report && report.sections) || [];
  const out = ["SHOW MATH — the numbers behind this robot",
    "========================================",
    "Every line below is the equation the bench used with this robot's own values put into it.",
    ""];
  secs.forEach((s, i) => {
    const head = (i + 1) + ".  " + String(s.title || "").toUpperCase();
    out.push(head, "-".repeat(head.length));
    if (s.intro) { mdWrap(s.intro, 76).forEach((l) => out.push(l)); }
    if (s.warn) { mdWrap("! " + s.warn, 76).forEach((l) => out.push(l)); }
    out.push("");
    for (const r of s.rows || []) {
      const v = mdNo(r.value) ? "  =  " + mdQty(r.value, r.unit) : "";
      out.push("  " + String(r.label || "") + v);
      if (r.symbols) out.push("      " + r.symbols);
      if (r.expr) String(r.expr).split("\n").forEach((l, k) => out.push((k ? "      " : "      ") + l));
      out.push("      [" + (r.source || "assumption") + "]");
      if (r.note) mdWrap(r.note, 70).forEach((l) => out.push("      " + l));
      out.push("");
    }
  });
  return out.join("\n");
}

/* A table cell: no pipes (they would split the row), no newlines, never blank. */
function mdCell(s) {
  const t = String(s == null ? "" : s).replace(/\r?\n/g, "<br>").replace(/\|/g, "∣").replace(/`/g, "'").trim();
  return t || "—";
}
const mdCode = (s) => { const t = mdCell(s); return t === "—" ? t : "`" + t + "`"; };

function mathMarkdown(report) {
  const secs = (report && report.sections) || [];
  const out = ["# Show math", "",
    "Every line below is the equation the bench used with this robot's own values put into it.", ""];
  secs.forEach((s, i) => {
    out.push("## " + (i + 1) + ". " + String(s.title || ""), "");
    if (s.intro) out.push(String(s.intro), "");
    if (s.warn) out.push("> **Check this:** " + String(s.warn), "");
    out.push("| " + MD_COLS.join(" | ") + " |");
    out.push("| " + MD_COLS.map(() => "---").join(" | ") + " |");
    for (const r of s.rows || []) {
      out.push("| " + [
        mdCell(r.label),
        mdCode(r.symbols),
        mdCode(r.expr),
        mdCell(mdNo(r.value) ? mdQty(r.value, r.unit) : ""),
        mdCell(r.note),
        mdCell(r.source || "assumption"),
      ].join(" | ") + " |");
    }
    out.push("");
  });
  return out.join("\n");
}
