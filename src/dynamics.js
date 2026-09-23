/* ============================================================
   6c.  CHASSIS DYNAMICS — the robot as a rigid body on N contact patches

   sim.js moves the chassis kinematically: average the left and right
   powers, multiply by a fixed top speed, integrate. It can't be wrong
   about anything because it doesn't model anything — a 20 kg robot on
   polished tiles accelerates exactly like a 9 kg one on fresh tread, and
   a 6000 rpm motor and a 30 rpm motor reach the same speed in the same
   time. This module is the physical replacement.

   It is a pure function library on purpose: no state of its own, nothing
   cached between calls, no reach into Sim. Whoever rewires Sim passes the
   state in and gets the next state back.

   The chain, per wheel, per step:
       motor curve   ->  shaft torque at the commanded duty
       shaft torque  ->  rim force, less what spinning the wheel up costs
       rim force     ->  ground force, capped by mu x that wheel's load
       ground force  ->  chassis wrench, then F = m a and tau = Izz alpha

   Frames are drivetrain.js's: x forward, y left, z up, omega counter-
   clockwise, origin at the centre of the wheels. Velocities are in the
   BODY frame, so the omega x v terms are carried explicitly. SI
   throughout: newtons, N.m, m/s, rad/s, kg, kg.m^2.

   INTEGRATION SCHEME. Semi-implicit (symplectic) Euler at a fixed dt,
   with the contact forces solved BEFORE anything moves, by a projected
   Gauss-Seidel sweep over the wheels.

   The reason for the implicit contact solve is that an explicit slip
   model is unusably stiff here. The relaxation time of a 0.5 g m^2 wheel
   against rubber-on-tile stiffness is tens of microseconds; at the sim's
   dt = 0.02 s an explicit update overshoots by four orders of magnitude
   and diverges on the first step. So instead of evaluating the tyre force
   at the CURRENT slip, each wheel's force is the one consistent with the
   slip at the END of the step:

       F_i = K_i * b_i / (1 + K_i * D_i)

   where K_i = (slip stiffness x load) / reference speed is the linearised
   tyre stiffness, b_i is the relative rim-vs-ground speed the step would
   open up with no contact force, and D_i is how much one newton closes
   that gap through the wheel's own inertia (r^2/J) and through the
   chassis (the Delassus term, row_i . M^-1 . row_i). Two limits fall out
   of the same expression with no branching: soft contact (K small) gives
   the linear slip force K*b, and stiff contact (K large) gives b/D, which
   is exactly the force that makes the wheel roll without slipping at the
   end of the step and cannot overshoot it. That is the stability
   guarantee the fixed 50 Hz step needs — and it is also the "a wheel can
   never reverse the chassis in one step" clamp, applied explicitly after
   the sweeps as a belt-and-braces bound |F_i| <= |b_i| / D_i.

   Gauss-Seidel handles the coupling: four wheels pushing the same chassis
   are not independent, and A_ij = row_i . M^-1 . row_j is the off-diagonal
   that says so. r^2/J dominates the diagonal by an order of magnitude, so
   the system is strongly diagonally dominant and a handful of sweeps is
   converged. Forces are clamped to the friction limit inside the sweep
   (the "projected" part), which is what makes wheelspin fall out rather
   than having to be special-cased.

   Rolling resistance and viscous drag are applied last, as a decrement on
   the speed rather than a force, so they can shrink a velocity to exactly
   zero but never push it through zero and set the robot buzzing at rest.
   ============================================================ */

const DYN_DEFAULTS = {
  mu: 0.90,            // rubber tread on FTC field tile, dry and swept
  rolling: 0.015,      // rolling resistance coefficient, fraction of normal load
  viscous: 1.2,        // N per m/s: gearbox and bearing drag referred to the chassis
  yawViscous: 0.08,    // N.m per rad/s
  slipStiffness: 22,   // longitudinal force per unit slip ratio per unit load;
                       // peaks at kappa = mu/Cs, about 4% slip, which is where tread on tile does
  rollerMu: 0.28,      // an omni/mecanum roller along its own axis: it turns, so it barely resists
  strafeEff: 0.72,     // see dynWheels() — the empirical mecanum strafe loss
  wheelInertia: 4.6e-4,// kg.m^2, a 104 mm mecanum wheel about its axle
  wheelRadius: 0.048,  // only used when the CAD gave no radius at all
  gear: 1,             // motor shaft revs per wheel rev, on top of the gearmotor's own box
  efficiency: 0.90,    // chain/belt/spur losses between the gearbox and the wheel
  stallAmps: 9.2,      // goBILDA 5203, for turning a current limit into a torque cap
  freeAmps: 0.30,
  sweeps: 6,
  vEps: 0.05,          // m/s: the slip-ratio denominator floor, so kappa is finite at rest
  vMax: 8,             // sanity ceilings; nothing on an FTC field goes near these
  omegaMax: 40,
  wheelOmegaMax: 1200
};

const DYN_MIN_J = 1e-7;      // a massless wheel is a divide by zero; this makes it merely rigid

function dynNum(v, d) { v = +v; return Number.isFinite(v) ? v : d; }
function dynClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function dynFin(v) { return Number.isFinite(v) ? v : 0; }

/* A direction as a unit vector in chassis axes. Takes an angle in radians,
   a [x,y] pair or an {x,y}; anything unusable reads as straight ahead. */
function dynDir(d) {
  let x, y;
  if (typeof d === "number") { x = Math.cos(dynNum(d, 0)); y = Math.sin(dynNum(d, 0)); }
  else if (Array.isArray(d)) { x = dynNum(d[0], 0); y = dynNum(d[1], 0); }
  else if (d && typeof d === "object") { x = dynNum(d.x, 0); y = dynNum(d.y, 0); }
  else { x = 1; y = 0; }
  const L = Math.hypot(x, y);
  return L > 1e-12 ? [x / L, y / L] : [1, 0];
}

const dynOpt = (rig, key) => dynNum(rig && rig[key], DYN_DEFAULTS[key]);

/* Something that may be one value for the whole rig or one per wheel. */
function dynPer(v, i, d) {
  if (Array.isArray(v)) return dynNum(v[i], d);
  return dynNum(v, d);
}

/* ------------------------------------------------------------------
   MOTOR
   ------------------------------------------------------------------ */

/* Torque at the gearmotor's output shaft, N.m.

   A brushed DC motor through a fixed reduction is a straight line between
   stall torque at zero speed and zero torque at free speed, shifted by the
   commanded duty cycle:

       tau = tau_stall * (cmd - omega / omega_free)

   Both hardware.js figures are already at the OUTPUT shaft (a Yellow
   Jacket 19.2:1 is 2.38 N.m at 312 rpm), so `omega` is the output shaft
   too. The formula is sign-correct without help: a negative command gives
   negative torque, and a shaft dragged faster than its command — coasting
   downhill, or shoved by another robot — gives torque opposing the motion,
   which is the braking a hub does in BRAKE mode. A motor left FLOATing
   makes no torque at all, so callers that model float pass cmd = 0 and
   ignore the result rather than expecting this to know.

   The clip at stall matters: at cmd = 1 and omega = -omega_free the line
   says 2 x stall, which no motor does — that is the moment it would draw
   twice stall current. opts.currentLimit (amps, as setCurrentAlert /
   the REV hub's limit) lowers the cap further: current above the free-
   running draw is proportional to torque, so the limit scales linearly
   between the free and stall currents. */
function motorTorque(spec, omega, cmd, opts) {
  spec = spec || {}; opts = opts || {};
  const stall = dynNum(spec.stallNm, 0);
  const rpm = dynNum(spec.rpm, 0);
  const wFree = rpm * Math.PI / 30;                 // rev/min -> rad/s
  if (!(stall > 0) || !(wFree > 0)) return 0;

  const c = dynClamp(dynNum(cmd, 0), -1, 1);
  const w = dynNum(omega, 0);
  let cap = stall;

  const lim = dynNum(opts.currentLimit, 0);
  if (lim > 0) {
    const iStall = dynNum(opts.stallAmps, dynNum(spec.stallAmps, DYN_DEFAULTS.stallAmps));
    const iFree = dynNum(opts.freeAmps, dynNum(spec.freeAmps, DYN_DEFAULTS.freeAmps));
    if (iStall > iFree) cap = Math.min(cap, stall * dynClamp((lim - iFree) / (iStall - iFree), 0, 1));
  }
  return dynClamp(stall * (c - w / wFree), -cap, cap);
}

/* The slope of the motor line, N.m per rad/s at its own shaft.

   This is the stiff part of the whole model. A wheel with nothing under it
   is a first-order system with time constant 2J/k — for a 5203 on a mecanum
   wheel that is about 12 ms, shorter than the 20 ms the bench steps at, so
   an explicit step overshoots the motor's own free speed, the motor brakes
   harder than it drove, and the wheel oscillates with growing amplitude
   instead of spinning up. On a grippy tile the ground hides it; on a
   slippery one the wheel ends up spinning backwards under a forward
   command. Dyn.step therefore solves the wheel implicitly in omega, and
   this is the coefficient it needs. */
function motorSlope(spec) {
  const stall = dynNum(spec && spec.stallNm, 0), rpm = dynNum(spec && spec.rpm, 0);
  const wFree = rpm * Math.PI / 30;
  return (stall > 0 && wFree > 0) ? stall / wFree : 0;
}

/* ------------------------------------------------------------------
   LOAD
   ------------------------------------------------------------------ */

/* Normal force on every wheel, newtons, summing to m*g no matter what.

   Static share first. With more than three contacts the problem is
   statically indeterminate, so the loads are fitted as a plane over the
   contact patches — N_i = W*(1/n + b*dx_i + c*dy_i) with dx, dy measured
   from the wheel centroid — and b, c are whatever puts the resultant
   under the centre of mass. That is the standard even-suspension answer
   and it degenerates gracefully: three wheels have a unique plane, two
   wheels only constrain one axis.

   Load transfer is then free. The inertial force m*a acts at the centre
   of mass, height h above the patches, so its moment about the contacts
   is identical to leaving the robot static and sliding the centre of mass
   by -a*h/g. Accelerating forward shifts it backwards and loads the rear;
   braking shifts it forward and unloads the rear; cornering shifts it
   outboard. One substitution covers longitudinal and lateral at once and
   cannot invent or lose weight, because the total is fixed by the fit.

   A wheel the transfer would pull into tension is lifted, not glued down,
   so it clamps at zero and the wheels still on the ground take the slack. */
function wheelLoads(props, accel, wheels, opts) {
  props = props || {}; opts = opts || {};
  const ws = Array.isArray(wheels) ? wheels : [];
  const n = ws.length;
  if (!n) return [];

  const g = dynNum(opts.g, 9.80665);
  const m = dynNum(props.kg, 0);
  const W = m * g;
  const out = new Array(n).fill(0);
  if (!(W > 0)) return out;

  const com = props.com || {};
  const h = Math.max(0, dynNum(props.comHeight, dynNum(com.z, 0)));
  const ax = dynNum(accel && accel.x, 0), ay = dynNum(accel && accel.y, 0);

  // the centre of mass, plus where the inertial force pretends it is
  const cx = dynNum(com.x, 0) - ax * h / g;
  const cy = dynNum(com.y, 0) - ay * h / g;

  let weights = new Array(n).fill(1);
  if (n >= 6) {
    const xs = ws.map(w => dynNum(w && w.x, 0));
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const tol = Math.max(0.01, (maxX - minX) * 0.1);
    for (let i = 0; i < n; i++) {
      if (xs[i] > minX + tol && xs[i] < maxX - tol) weights[i] = 2.0; // Center wheels carry double
    }
  }
  let sumW = 0;
  for (let i = 0; i < n; i++) sumW += weights[i];
  const wFrac = weights.map(w => w / sumW);

  let mwx = 0, mwy = 0;
  for (let i = 0; i < n; i++) {
    mwx += wFrac[i] * dynNum(ws[i] && ws[i].x, 0);
    mwy += wFrac[i] * dynNum(ws[i] && ws[i].y, 0);
  }

  let Sxx = 0, Syy = 0, Sxy = 0;
  const dx = new Array(n), dy = new Array(n);
  for (let i = 0; i < n; i++) {
    dx[i] = dynNum(ws[i] && ws[i].x, 0) - mwx;
    dy[i] = dynNum(ws[i] && ws[i].y, 0) - mwy;
    Sxx += dx[i] * dx[i]; Syy += dy[i] * dy[i]; Sxy += dx[i] * dy[i];
  }

  // solve for the plane's tilt, skipping any axis the contacts don't span
  const tol = 1e-8;
  const rx = cx - mwx, ry = cy - mwy;
  let b = 0, c = 0;
  const det = Sxx * Syy - Sxy * Sxy;
  if (Sxx > tol && Syy > tol && Math.abs(det) > tol * Math.max(Sxx, Syy)) {
    b = (rx * Syy - ry * Sxy) / det;
    c = (ry * Sxx - rx * Sxy) / det;
  } else {
    if (Sxx > tol) b = rx / Sxx;
    if (Syy > tol) c = ry / Syy;
  }

  let pos = 0;
  for (let i = 0; i < n; i++) {
    const N = W * (wFrac[i] + b * dx[i] + c * dy[i]);
    out[i] = Number.isFinite(N) && N > 0 ? N : 0;
    pos += out[i];
  }
  // whatever the lifted wheels were carrying goes to the ones still down
  if (pos > 1e-12) { const k = W / pos; for (let i = 0; i < n; i++) out[i] *= k; }
  else for (let i = 0; i < n; i++) out[i] = W / n;
  return out;
}

/* ------------------------------------------------------------------
   GRIP
   ------------------------------------------------------------------ */

/* The largest ground force this contact patch can pass in direction `dir`.

   A traction wheel is a friction circle: mu*N whichever way you lean on
   it. A roller wheel is not. A mecanum roller sits at 45 degrees and is
   free to turn about its own axis, so the patch can push hard along the
   roller NORMAL and hardly at all along the roller axis — shove an idle
   mecanum robot sideways and it rolls away. Same story for an omni or an
   X-drive wheel, with the free axis across the wheel instead of at 45.

   So the limit is an ellipse, not a circle: semi-axis mu*N along the
   direction the patch drives, rollerMu*mu*N across it, and a demand at
   some angle in between is capped where it crosses the ellipse. That also
   makes the combined case work without a second function — a wheel using
   most of its grip to corner has little left to accelerate with, which is
   the classic friction ellipse and is why a tank base that is already
   sliding sideways can't also launch.

   `kind` is the drivetrain kind as a string, or an object carrying the
   wheel's own geometry: {kind, roller, alpha, sideMu}. `dir` is an angle
   in radians, an [x,y] or an {x,y} in chassis axes; forward if omitted. */
function tractionLimit(load, mu, kind, dir) {
  const N = Math.max(0, dynNum(load, 0));
  const m = Math.max(0, dynNum(mu, DYN_DEFAULTS.mu));
  const F0 = N * m;
  if (!(F0 > 0)) return 0;

  const k = (kind && typeof kind === "object") ? kind : { kind: kind };
  const name = String(k.kind == null ? "tank" : k.kind).toLowerCase();
  const d = dynDir(dir);

  let drive, side;
  if (name === "mecanum") {
    const roll = dynNum(k.roller, 0);
    // rollers at 45 degrees: the normal they can push along is (1,-k)/sqrt(2).
    // Handedness unknown means drivetrain.js is treating it as a plain wheel.
    drive = roll ? [Math.SQRT1_2, -Math.sign(roll) * Math.SQRT1_2] : [1, 0];
    side = roll ? dynNum(k.sideMu, DYN_DEFAULTS.rollerMu) : 1;
  } else if (name === "x" || name === "omni" || name === "kiwi") {
    const a = dynNum(k.alpha, 0);
    drive = [Math.cos(a), Math.sin(a)];
    side = dynNum(k.sideMu, DYN_DEFAULTS.rollerMu);
  } else {
    drive = [1, 0];
    side = 1;                                  // a traction wheel grips the same all round
  }

  const p = d[0] * drive[0] + d[1] * drive[1];       // along the drive axis
  const q = -d[0] * drive[1] + d[1] * drive[0];      // across it
  const A = F0, B = F0 * Math.max(1e-6, side);
  const v = (p / A) * (p / A) + (q / B) * (q / B);
  return v > 0 ? 1 / Math.sqrt(v) : 0;
}

/* ------------------------------------------------------------------
   THE STEP
   ------------------------------------------------------------------ */

/* Each wheel resolved into the two rows the solver needs.

   `vel` maps the chassis twist to this wheel's rim speed — drivetrain.js's
   ik row, which is the authority when it is there.

   `force` maps one newton of rim force back to a chassis wrench. At unit
   efficiency it is the same row, which is just the principle of virtual
   work. It differs on mecanum, and only there, by `strafeEff`: the
   sideways half of a mecanum wheel's ground force reaches the chassis
   through the roller's own little axle, and real rollers on real tile are
   not free. On paper a square mecanum set strafes exactly as hard as it
   drives; in the pit it doesn't, and 0.7-0.8 is the factor everyone
   measures. This is that measurement, lumped into one honest coefficient
   rather than pretended away — the lost force is heat in the roller, so it
   never reaches the chassis, but the GROUND still sees the full force and
   the traction cap is applied there. */
function dynWheels(rig) {
  const drive = (rig && rig.drive) || {};
  const list = Array.isArray(drive.wheels) ? drive.wheels : [];
  const ik = Array.isArray(drive.ik) ? drive.ik : [];
  const kind = String(drive.kind || "tank").toLowerCase();
  const eta = dynClamp(dynOpt(rig, "strafeEff"), 0.05, 1);
  const out = [];

  for (let i = 0; i < list.length; i++) {
    const w = list[i] || {};
    const x = dynNum(w.x, 0), y = dynNum(w.y, 0);
    const r = Math.max(1e-4, dynNum(w.r, DYN_DEFAULTS.wheelRadius));
    const k = kind === "mecanum" ? Math.sign(dynNum(w.roller, 0)) : 0;

    let vel, force, dir, gain;
    if (k) {
      vel = [1, -k, -(y + k * x)];
      force = [1, -k * eta, -(y + k * eta * x)];
      // the patch can only push along the roller normal, and because that
      // is 45 degrees off the rolling direction the ground force is
      // sqrt(2) times the rim force it came from
      dir = [Math.SQRT1_2, -k * Math.SQRT1_2];
      gain = Math.SQRT2;
    } else {
      const a = dynNum(w.alpha, 0), ca = Math.cos(a), sa = Math.sin(a);
      vel = [ca, sa, x * sa - y * ca];
      force = [ca, sa, x * sa - y * ca];
      dir = [ca, sa];
      gain = 1;
    }
    const row = ik[i];
    if (row && row.length === 3) vel = [dynNum(row[0], vel[0]), dynNum(row[1], vel[1]), dynNum(row[2], vel[2])];

    out.push({
      x: x, y: y, r: r, roller: k, alpha: dynNum(w.alpha, 0), kind: kind,
      vel: vel, force: force, dir: dir, gain: gain,
      J: Math.max(DYN_MIN_J, dynPer(rig && rig.wheelInertia, i, DYN_DEFAULTS.wheelInertia)),
      gear: Math.max(1e-6, Math.abs(dynPer(rig && rig.gear, i, DYN_DEFAULTS.gear))),
      eff: dynClamp(dynPer(rig && rig.efficiency, i, DYN_DEFAULTS.efficiency), 0, 1),
      rolls: k !== 0 || kind === "x" || kind === "omni" || kind === "kiwi"
    });
  }
  return out;
}

/* A state object with the right shape and nothing but finite numbers in it. */
function dynState(state, n) {
  const s = state || {};
  const v = s.v || {};
  const arr = (a) => { const o = new Array(n); for (let i = 0; i < n; i++) o[i] = dynFin(Array.isArray(a) ? +a[i] : 0); return o; };
  const wr = s.wrench || {};
  return {
    v: { x: dynFin(+v.x), y: dynFin(+v.y) },
    omega: dynFin(+s.omega),
    wheelOmega: arr(s.wheelOmega),
    slip: arr(s.slip),
    loads: new Array(n).fill(0),
    force: arr(s.force),
    accel: { x: dynFin(+(s.accel && s.accel.x)), y: dynFin(+(s.accel && s.accel.y)) },
    alpha: dynFin(+s.alpha),
    wrench: { fx: dynFin(+wr.fx), fy: dynFin(+wr.fy), tz: dynFin(+wr.tz) }
  };
}

/* Everything stopped, arrays intact: what a rig with no mass or no wheels does. */
function dynStill(n) {
  return {
    v: { x: 0, y: 0 }, omega: 0,
    wheelOmega: new Array(n).fill(0), slip: new Array(n).fill(0),
    loads: new Array(n).fill(0), force: new Array(n).fill(0),
    accel: { x: 0, y: 0 }, alpha: 0, wrench: { fx: 0, fy: 0, tz: 0 }
  };
}

const Dyn = {
  defaults: DYN_DEFAULTS,

  /* A fresh state. Sized to the rig when one is handed over, so the arrays
     line up with the wheels from the very first step. */
  reset(rig) {
    const d = (rig && rig.drive) || {};
    const n = Array.isArray(d.wheels) ? d.wheels.length : 0;
    return dynStill(n);
  },

  /* One fixed step. `cmd` is the per-wheel motor command, -1..1, already
     produced by whatever ran the OpMode; this function only does physics.
     Returns the next state — the one passed in is not touched. */
  step(state, cmd, rig, dt) {
    rig = rig || {};
    const W = dynWheels(rig), n = W.length;
    const st = dynState(state, n);

    dt = dynNum(dt, 0.02);
    if (!(dt > 0)) return st;
    dt = Math.min(dt, 0.1);                 // a stray frame-time must not become a teleport

    const props = rig.props || {};
    const m = dynNum(props.kg, 0);
    if (!n || !(m > 0)) return dynStill(n);

    const I = props.I || {};
    let Izz = dynNum(props.Izz, dynNum(I.zz, 0));
    if (!(Izz > 0)) {
      // no tensor: the thin-slab estimate off the wheel footprint is better than a divide by zero
      const d = rig.drive || {};
      const tr = dynNum(d.track, 0.35), bs = dynNum(d.base, 0.35);
      Izz = Math.max(1e-4, m * (tr * tr + bs * bs) / 12);
    }

    const g = dynNum(rig.g, G);
    const mu = Math.max(0, dynNum(rig.mu, DYN_DEFAULTS.mu));
    const Cs = Math.max(1e-6, dynOpt(rig, "slipStiffness"));
    const vEps = Math.max(1e-4, dynOpt(rig, "vEps"));
    const sweeps = Math.max(1, Math.min(32, Math.round(dynOpt(rig, "sweeps"))));
    const motors = Array.isArray(rig.motors) ? rig.motors : [];
    const mOpts = { currentLimit: dynNum(rig.currentLimit, 0), stallAmps: rig.stallAmps, freeAmps: rig.freeAmps };

    const vx = st.v.x, vy = st.v.y, om = st.omega;
    const loads = wheelLoads(props, st.accel, W, { g: g });

    // ---- per-wheel setup: drive torque, grip ceiling, and the two solver terms
    const u = new Array(n), v = new Array(n), b0 = new Array(n), D = new Array(n),
      K = new Array(n), cap = new Array(n), tauW = new Array(n), kW = new Array(n), Jdt = new Array(n);

    for (let i = 0; i < n; i++) {
      const w = W[i], row = w.vel;
      const spec = motors[i] || motors[0] || null;
      const c = dynClamp(dynNum(Array.isArray(cmd) ? cmd[i] : cmd, 0), -1, 1);

      u[i] = st.wheelOmega[i] * w.r;                                   // rim speed, m/s
      v[i] = row[0] * vx + row[1] * vy + row[2] * om;                  // ground speed under it
      tauW[i] = motorTorque(spec, st.wheelOmega[i] * w.gear, c, mOpts) * w.gear * w.eff;

      // grip available for driving, after this patch pays for the cornering
      // force it is already passing. A roller wheel makes no cornering force
      // worth the name, so there is nothing for it to trade away.
      const kObj = { kind: w.kind, roller: w.roller, alpha: w.alpha, sideMu: rig.rollerMu };
      let grip = tractionLimit(loads[i], mu, kObj, w.dir);
      if (!w.rolls) {
        const lat = [-w.dir[1], w.dir[0]];
        const latCap = tractionLimit(loads[i], mu, kObj, lat);
        const need = Math.abs(st.wrench.fx * lat[0] + st.wrench.fy * lat[1]) / n;
        const f = latCap > 0 ? Math.min(1, need / latCap) : 0;
        grip *= Math.sqrt(Math.max(0, 1 - f * f));
      }
      cap[i] = grip / w.gain;                                          // ceiling on the RIM force

      // implicit in the motor's speed droop (see motorSlope): with the ground
      // taking nothing, the rim gains tau / (J/dt + k), not dt*tau/J
      kW[i] = motorSlope(spec) * w.gear * w.gear * w.eff;
      Jdt[i] = w.J / dt;
      b0[i] = (u[i] - v[i]) + tauW[i] * w.r / (Jdt[i] + kW[i]);
      K[i] = Cs * loads[i] / Math.max(Math.abs(v[i]), vEps);
    }

    // ---- coupling: how much one newton at wheel j closes wheel i's slip gap
    const A = [];
    for (let i = 0; i < n; i++) {
      const p = W[i].vel; A[i] = new Array(n);
      for (let j = 0; j < n; j++) {
        const q = W[j].force;
        A[i][j] = (p[0] * q[0] + p[1] * q[1]) / m + p[2] * q[2] / Izz;
      }
      D[i] = W[i].r * W[i].r / (Jdt[i] + kW[i]) + dt * Math.max(0, A[i][i]);
      if (!(D[i] > 0)) D[i] = W[i].r * W[i].r / (Jdt[i] + kW[i]);
    }

    // ---- projected Gauss-Seidel, warm-started from last step's forces
    const F = st.force.slice(), bb = new Array(n).fill(0);
    for (let s = 0; s < sweeps; s++) {
      for (let i = 0; i < n; i++) {
        let off = 0;
        for (let j = 0; j < n; j++) if (j !== i) off += A[i][j] * F[j];
        const b = b0[i] - dt * off;
        bb[i] = b;
        let f = K[i] * b / (1 + K[i] * D[i]);
        if (!Number.isFinite(f)) f = 0;
        F[i] = dynClamp(f, -cap[i], cap[i]);
      }
    }
    // the hard guarantee: no wheel may push past the point where its own slip
    // closes, so it can never drag the chassis backwards through zero in a step
    for (let i = 0; i < n; i++) {
      const lim = Math.abs(bb[i]) / D[i];
      F[i] = dynClamp(F[i], -lim, lim);
      if (bb[i] > 0 && F[i] < 0) F[i] = 0;
      if (bb[i] < 0 && F[i] > 0) F[i] = 0;
      if (!Number.isFinite(F[i])) F[i] = 0;
    }

    // ---- chassis wrench from the contacts
    let Fx = 0, Fy = 0, Tz = 0;
    for (let i = 0; i < n; i++) {
      const q = W[i].force;
      Fx += F[i] * q[0]; Fy += F[i] * q[1]; Tz += F[i] * q[2];
    }

    // ---- rigid body, body frame: omega x v is what makes a turning robot
    // carry its speed round the corner instead of sliding off tangentially
    let ax = Fx / m + om * vy;
    let ay = Fy / m - om * vx;
    let al = Tz / Izz;
    const aMax = DYN_DEFAULTS.vMax / dt;
    ax = dynClamp(dynFin(ax), -aMax, aMax);
    ay = dynClamp(dynFin(ay), -aMax, aMax);
    al = dynClamp(dynFin(al), -DYN_DEFAULTS.omegaMax / dt, DYN_DEFAULTS.omegaMax / dt);

    let nvx = vx + dt * ax, nvy = vy + dt * ay, nom = om + dt * al;

    // ---- losses, as a decrement rather than a force: a robot that has
    // stopped must stay stopped, not jitter across the tile
    const roll = Math.max(0, dynOpt(rig, "rolling")) * m * g;
    const cv = Math.max(0, dynOpt(rig, "viscous"));
    const sp = Math.hypot(nvx, nvy);
    if (sp > 1e-9) {
      const dec = dt * (roll + cv * sp) / m;
      const k = Math.max(0, sp - dec) / sp;
      nvx *= k; nvy *= k;
    }
    let rad = 0;
    for (const w of W) rad += Math.hypot(w.x, w.y);
    rad = n ? rad / n : 0;
    const spin = Math.abs(nom);
    if (spin > 1e-9) {
      const dec = dt * (roll * rad + Math.max(0, dynOpt(rig, "yawViscous")) * spin) / Izz;
      nom = Math.sign(nom) * Math.max(0, spin - dec);
    }

    nvx = dynClamp(dynFin(nvx), -DYN_DEFAULTS.vMax, DYN_DEFAULTS.vMax);
    nvy = dynClamp(dynFin(nvy), -DYN_DEFAULTS.vMax, DYN_DEFAULTS.vMax);
    nom = dynClamp(dynFin(nom), -DYN_DEFAULTS.omegaMax, DYN_DEFAULTS.omegaMax);

    // ---- wheels: what the motor put in, less what the ground took back out
    const wo = new Array(n), slip = new Array(n);
    for (let i = 0; i < n; i++) {
      const w = W[i];
      // implicit in omega: J/dt (o' - o) = tau(o') - F r, with the motor line
      // tau(o') = tau(o) + k (o - o'). The result is a weighted step towards the
      // motor's equilibrium speed, so it can never overshoot it, whatever dt is.
      let o = (Jdt[i] * st.wheelOmega[i] + tauW[i] + kW[i] * st.wheelOmega[i] - F[i] * w.r) / (Jdt[i] + kW[i]);
      o = dynClamp(dynFin(o), -DYN_DEFAULTS.wheelOmegaMax, DYN_DEFAULTS.wheelOmegaMax);
      wo[i] = o;
      const row = w.vel;
      const vn = row[0] * nvx + row[1] * nvy + row[2] * nom;
      slip[i] = dynClamp((o * w.r - vn) / Math.max(Math.abs(vn), vEps), -10, 10);
    }

    return {
      v: { x: nvx, y: nvy }, omega: nom,
      wheelOmega: wo, slip: slip, loads: loads, force: F,
      accel: { x: ax, y: ay }, alpha: al,
      wrench: { fx: dynFin(Fx), fy: dynFin(Fy), tz: dynFin(Tz) }
    };
  }
};
