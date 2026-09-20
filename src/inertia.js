/* ============================================================
   2c.  MASS PROPERTIES — what the CAD actually weighs
   The hull from hull.js is a *filled* solid, and FTC parts are
   anything but: a U-channel's hull is a brick, a mecanum wheel's
   is a solid puck, a belt loop's is a slab of air. So every kind
   gets a density AND an honest fill factor — the fraction of its
   convex hull that is really material. Vendor masses win whenever
   the part number names something we actually know.

   Everything here is SI: metres in, kilograms and kg.m^2 out.
   Nothing returns NaN; degenerate input falls back to the part's
   oriented box, and a massless rig reports zeros.
   ============================================================ */

/* The very same floor boxCorners() uses — taken from it, not restated, so the
   mass model and the 3-D view can never drift apart. */
const MASS_MIN_T = THIN_T;

/* Density x fill for each solidKind(). The fills are the honest part:
     metal     6061-T6 aluminium is 2700. A goBILDA 1120 U-channel measures
               ~0.155 of its bounding box (a 240 mm piece is ~116 g, so
               43 cm^3 of metal inside a 276 cm^3 box); hole-riddled plates
               and brackets run 0.3-0.5 and solid hubs/shafts ~0.9 but are
               small. Weighted over a channel-framed rig: ~0.18.
     servo     a servo is a solid brick of plastic, steel gears and copper.
               A goBILDA 2000 series is ~84 g in ~54 cm^3 -> ~1550 effective;
               the hull usually swallows the mounting ears, hence 0.85 fill.
     motor     a Yellow Jacket is steel, magnets and a planetary stack. The
               part is ~0.31 kg, but its CONVEX HULL is not the part: hulling
               a 37x70 mm can with a 43x43x26 mm gearbox measures ~0.153 dm^3,
               so the fill that lands on 0.31 kg is 0.63, not 0.85.
     wheel     rubber/plastic tread on a mostly empty hub. A 104 mm mecanum
               hulls to ~0.40 dm^3 (measured with hullVolume, not guessed) and
               weighs 0.335 kg, so 1400 x 0.60.
     electronics  PCBs in plastic shells: heavy where the copper and the
               connectors are, air everywhere else.
     clear     polycarbonate 1200. A flat sheet's hull IS the sheet, so the
               fill is nearly 1; only a bent guard over-reads.
     printed   PLA/PETG 1240 at the 20-30% infill + 3 perimeters everyone
               prints FTC parts at -> ~0.35 of the envelope.
     belt      rubber/cable. The hull of a belt loop or a wire run is almost
               entirely air, so the fill is tiny.
     fastener  steel 7850, minus thread valleys, drives and countersinks. */
const MATERIALS = {
  metal:       {density:2700, fill:0.18, label:"aluminium structure"},
  servo:       {density:1800, fill:0.85, label:"servo"},
  motor:       {density:3200, fill:0.63, label:"gearmotor"},
  wheel:       {density:1400, fill:0.60, label:"wheel/tread"},
  electronics: {density:1500, fill:0.35, label:"electronics"},
  clear:       {density:1200, fill:0.90, label:"polycarbonate"},
  printed:     {density:1240, fill:0.35, label:"3D print"},
  belt:        {density:1200, fill:0.10, label:"belt/cable"},
  fastener:    {density:7850, fill:0.55, label:"steel fastener"}
};

/* Parts whose published mass we actually know, best match first. Anything
   not on this list is weighed by density — a guess, and labelled as one.
   These are vendor ballparks good to roughly +/-10%; the hub and battery
   rows are the ones to distrust first, since each is quoted for one SKU and
   teams run several. */
const VENDOR_MASS = [
  {re:/\b5203-\d{4}-\d{1,4}\b/i,      kg:0.310, label:"goBILDA 5203 Yellow Jacket gearmotor"},
  {re:/\b2000-0025-000[1-5]\b/,       kg:0.084, label:"goBILDA 2000 Series Dual Mode servo"},
  {re:/\b3213-\d{4}-\d{1,4}\b/i,      kg:0.335, label:"goBILDA 104 mm mecanum wheel"},
  {re:/104\s*mm[^a-z]{0,4}mecanum|mecanum[^a-z]{0,6}104/i, kg:0.335, label:"104 mm mecanum wheel"},
  {re:/\bREV-31-1595\b|\bcontrol hub\b/i,   kg:0.270, label:"REV Control Hub"},
  {re:/\bREV-31-1153\b|\bexpansion hub\b/i, kg:0.190, label:"REV Expansion Hub"},
  {re:/\bbattery\b/i,                 kg:0.550, label:"12 V 3000 mAh NiMH pack"}
];

/* Hardware that lives *next to* a known device and borrows its name in the
   assembly tree. A battery strap is not a battery. These go by density. */
const VENDOR_NOT = /\b(mount|mounts|bracket|strap|clamp|cable|wire|harness|clip|spacer|standoff|cover|lid|guard|holder|tray|adapter|shim|plate|label|decal|sticker|screw|bolt|nut)\b/i;
/* …and a published mass is only believable when the part it lands on is
   roughly the right size. Outside this band, the name matched something else. */
const VENDOR_DENSITY = {lo:300, hi:9000};

/* Axis-aligned box of a point set: centre and the three side lengths.
   No points at all gives a zero box at the origin, never Infinity. */
function massBoxOf(pts){
  if(!pts || !pts.length) return {c:[0,0,0], L:0, W:0, H:0};
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  for(const p of pts){ if(!p) continue;
    for(let k=0;k<3;k++){ const v=+p[k]; if(!Number.isFinite(v)) continue;
      if(v<mn[k]) mn[k]=v; if(v>mx[k]) mx[k]=v; } }
  const c=[0,0,0], d=[0,0,0];
  for(let k=0;k<3;k++){
    if(!Number.isFinite(mn[k])||!Number.isFinite(mx[k])){ mn[k]=0; mx[k]=0; }
    c[k]=(mn[k]+mx[k])/2; d[k]=Math.max(mx[k]-mn[k], MASS_MIN_T);
  }
  return {c, L:d[0], W:d[1], H:d[2]};
}

/* Volume of the convex hull of `pts`, in m^3, by the divergence theorem:
   every outward face makes a tetrahedron with the origin, and
   sum(a . (b x c))/6 over the faces is the enclosed volume. convexHull()
   winds faces CCW seen from outside so the sum comes out positive; abs()
   keeps a mirrored hull honest. Too few, coincident or coplanar points
   cannot be hulled — those fall back to the oriented box, which is what
   the 3-D view draws for them too. */
function hullVolume(pts){
  if(!pts || pts.length < 1) return 0;
  const b = massBoxOf(pts), boxVol = b.L*b.W*b.H;
  let P = pts, h = pts.length>=4 ? convexHull(pts) : null;
  if(!h){ P = boxCorners(pts); h = convexHull(P); }
  if(!h) return Number.isFinite(boxVol) ? boxVol : 0;
  let v6 = 0;
  for(const f of h.faces){
    const A=P[f[0]], B=P[f[1]], C=P[f[2]];
    v6 += A[0]*(B[1]*C[2]-B[2]*C[1]) + A[1]*(B[2]*C[0]-B[0]*C[2]) + A[2]*(B[0]*C[1]-B[1]*C[0]);
  }
  const v = Math.abs(v6)/6;
  return (Number.isFinite(v) && v>0) ? v : (Number.isFinite(boxVol) ? boxVol : 0);
}

/* The vendor row for a solid, matched on its part number and its name — a
   STEP export often carries the number only in the name. */
function vendorMassFor(solid, volume){
  const s = ((solid&&solid.part) || "") + " " + ((solid&&solid.name) || "");
  if(VENDOR_NOT.test(s)) return null;
  for(const v of VENDOR_MASS){
    if(!v.re.test(s)) continue;
    // a 0.55 kg battery in a 3 cm^3 hull is a cable, not a battery
    if(Number.isFinite(volume) && volume > 0){
      const d = v.kg/volume;
      if(d < VENDOR_DENSITY.lo || d > VENDOR_DENSITY.hi) return null;
    }
    return v;
  }
  return null;
}

/* What one solid weighs.
     opts.materials     partial override of MATERIALS, merged over it
     opts.vendor:false  ignore the known-part table, weigh everything by density
   `how` is 'vendor' when a published mass was used and 'density' otherwise,
   so the UI can separate what is known from what is inferred. */
function partMass(solid, opts){
  opts = opts || {};
  const pts = (solid && solid.pts) || [];
  const vol = hullVolume(pts);
  if(opts.vendor !== false){
    const v = vendorMassFor(solid, vol);
    // density here is the back-computed effective density, for display only
    if(v) return {kg:v.kg, how:"vendor", density:(vol>0 ? v.kg/vol : 0), fill:1, volume:vol,
                  why:"published mass, "+v.label};
  }
  let tbl = MATERIALS;
  if(opts.materials){                        // merge per kind: {metal:{density:5000}} keeps metal's fill
    tbl = Object.assign({}, MATERIALS);
    for(const k in opts.materials) tbl[k] = Object.assign({}, MATERIALS[k] || MATERIALS.metal, opts.materials[k]);
  }
  const kind = (solid && solid.kind) || "metal";
  const mat = tbl[kind] || tbl.metal || MATERIALS.metal;
  const density = Number.isFinite(mat.density) ? mat.density : 0;
  const fill = Number.isFinite(mat.fill) ? mat.fill : 0;
  const kg = vol*density*fill;
  return {kg:(Number.isFinite(kg)&&kg>0 ? kg : 0), how:"density", density, fill, volume:vol,
          why:(mat.label||kind)+" "+density+" kg/m^3 x "+fill+" fill of "+(vol*1e6).toFixed(1)+" cm^3 hull"};
}

/* Assemble rigid bodies into one. Each part is {kg, com:{x,y,z}, box:{L,W,H}};
   a part with no box is a point mass — a battery, a held game element.
   COM is sum(m_i r_i)/sum(m_i); the tensor is each part's own box inertia
   (m/12)(b^2+c^2) carried to the assembly COM by I = I_cm + m d^2.
   I is the INERTIA TENSOR: I.xy/xz/yz are its off-diagonal entries, already
   negated, so [[xx,xy,xz],[xy,yy,yz],[xz,yz,zz]] is the matrix. The raw
   products sum(m dx dy) come back separately as `products`. Zero total mass
   returns zeros and the plain centroid of the points given, never NaN. */
function inertiaOf(parts){
  const list = [];
  for(const p of (parts||[])){
    if(!p) continue;
    const c = p.com || {}, b = p.box || {}, g = (v)=>Number.isFinite(+v) ? +v : 0;
    list.push({kg:(Number.isFinite(p.kg) && p.kg>0 ? p.kg : 0), x:g(c.x), y:g(c.y), z:g(c.z),
               L:Math.max(0,g(b.L)), W:Math.max(0,g(b.W)), H:Math.max(0,g(b.H))});
  }
  const I = {xx:0, yy:0, zz:0, xy:0, xz:0, yz:0};
  const products = {xy:0, xz:0, yz:0};
  let M=0, cx=0, cy=0, cz=0;
  for(const p of list){ M+=p.kg; cx+=p.kg*p.x; cy+=p.kg*p.y; cz+=p.kg*p.z; }
  if(!(M>0)){
    let n=0, gx=0, gy=0, gz=0;
    for(const p of list){ n++; gx+=p.x; gy+=p.y; gz+=p.z; }
    return {I, products, kg:0, com:(n ? {x:gx/n, y:gy/n, z:gz/n} : {x:0, y:0, z:0})};
  }
  cx/=M; cy/=M; cz/=M;
  for(const p of list){
    const m=p.kg, dx=p.x-cx, dy=p.y-cy, dz=p.z-cz;
    I.xx += m/12*(p.W*p.W + p.H*p.H) + m*(dy*dy + dz*dz);
    I.yy += m/12*(p.L*p.L + p.H*p.H) + m*(dx*dx + dz*dz);
    I.zz += m/12*(p.L*p.L + p.W*p.W) + m*(dx*dx + dy*dy);
    products.xy += m*dx*dy; products.xz += m*dx*dz; products.yz += m*dy*dz;
  }
  I.xy = -products.xy; I.xz = -products.xz; I.yz = -products.yz;
  for(const k in I) if(!Number.isFinite(I[k])) I[k]=0;
  for(const k in products) if(!Number.isFinite(products[k])) products[k]=0;
  return {I, products, kg:M, com:{x:cx, y:cy, z:cz}};
}

/* The whole rig: mass, COM in robot-space metres, and the inertia tensor
   about that COM. Takes a parsed CAD (it reads cad.solids) or a bare solids
   array.
     opts.payloadKg   a held game element. It rides at the top of the rig
                      above the COM, because where the payload sits is the
                      point of asking: tipping and turn inertia both care.
     opts.payloadAt   {x,y,z} to put it somewhere specific instead
     opts.extra       [{kg,x,y,z,name}] point masses — battery, ballast, a
                      counterweight the CAD does not have
   `confidence` is a self-assessment in 0..1: half of it is how much of the
   mass came from published figures rather than a fill factor, and it never
   reaches 1, because the fills stay estimates even when the parts are known. */
function massProps(cad, opts){
  opts = opts || {};
  const solids = Array.isArray(cad) ? cad : ((cad && cad.solids) || []);
  const parts = [], items = [];
  let vendorKg = 0, zTop = -Infinity;
  for(const s of solids){
    if(!s) continue;
    const pm = partMass(s, opts), b = massBoxOf(s.pts || []);
    parts.push({name:s.name || "part", kg:pm.kg, how:pm.how});
    items.push({kg:pm.kg, com:{x:b.c[0], y:b.c[1], z:b.c[2]}, box:{L:b.L, W:b.W, H:b.H}});
    if(pm.how === "vendor") vendorKg += pm.kg;
    const top = b.c[2] + b.H/2; if(top > zTop) zTop = top;
  }
  if(!Number.isFinite(zTop)) zTop = 0;

  const payload = (Number.isFinite(opts.payloadKg) && opts.payloadKg > 0) ? opts.payloadKg : 0;
  if(payload){
    const dry = inertiaOf(items);                                      // where the structure balances…
    const at = opts.payloadAt || {};                                   // …then load it on top
    const pick = (v, d) => Number.isFinite(+v) ? +v : d;               // half a placement keeps the rest
    items.push({kg:payload, box:{L:0, W:0, H:0},
                com:{x:pick(at.x, dry.com.x), y:pick(at.y, dry.com.y), z:pick(at.z, zTop)}});
    parts.push({name:"payload", kg:payload, how:"given"});
  }
  for(const e of (opts.extra || [])){
    if(!e || !Number.isFinite(e.kg) || !(e.kg > 0)) continue;
    items.push({kg:e.kg, com:{x:+e.x||0, y:+e.y||0, z:+e.z||0}, box:{L:0, W:0, H:0}});
    parts.push({name:e.name || "extra", kg:e.kg, how:"given"});
  }

  const r = inertiaOf(items);
  const vendorFrac = r.kg > 0 ? vendorKg/r.kg : 0;
  const confidence = items.length ? Math.max(0, Math.min(0.9, 0.40 + 0.5*vendorFrac)) : 0;
  return {kg:r.kg, com:r.com, I:r.I, products:r.products, Izz:r.I.zz, comHeight:r.com.z, parts, confidence};
}
