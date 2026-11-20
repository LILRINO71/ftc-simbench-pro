/* ============================================================
   2b.  SOLIDS — convex hulls for CAD parts
   A STEP file gives each part's points, not its tessellated faces.
   The convex hull of those points is a clean solid stand-in: a
   channel reads as a box, a wheel as a disc, a motor as a cylinder.
   ============================================================ */

/* Incremental 3-D convex hull. Returns {faces:[[a,b,c]…]} with indices
   into pts, wound counter-clockwise seen from outside, or null when the
   points are flat or too few (the caller falls back to a box). */
function convexHull(pts){
  // A point a hair off a face (the coplanar points all over a flat plate) made sliver faces
  // whose normals are rounding noise, and the hull came out open: a 6 mm plate's "volume" was
  // 250 times its own box, and it weighed 31 kg. So a point within a millionth of the part's
  // size of a face counts as on it, a hull that still isn't closed is built again looser, and
  // one that never closes is no hull (the caller uses the box).
  for(const tol of [1e-6,1e-5,1e-4]){ const h=convexHullAt(pts,tol); if(!h||hullClosed(h.faces)) return h; }
  return null;
}
/* every edge used once each way: a closed, consistently wound surface */
function hullClosed(faces){
  const e=new Set();
  for(const [a,b,c] of faces) for(const k of [a+","+b,b+","+c,c+","+a]){ if(e.has(k)) return false; e.add(k); }
  for(const k of e){ const i=k.indexOf(","); if(!e.has(k.slice(i+1)+","+k.slice(0,i))) return false; }
  return true;
}
function convexHullAt(pts,tol){
  const n=pts.length; if(n<4) return null;
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  for(const p of pts) for(let k=0;k<3;k++){ if(p[k]<mn[k]) mn[k]=p[k]; if(p[k]>mx[k]) mx[k]=p[k]; }
  const diag=Math.hypot(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]); if(!(diag>0)) return null;
  const eps=diag*tol;
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

  // a starting tetrahedron from well-spread points
  let i0=0, i1=0, best=-1;
  const ext=[];
  for(let k=0;k<3;k++){ let a=0,b=0; for(let i=1;i<n;i++){ if(pts[i][k]<pts[a][k]) a=i; if(pts[i][k]>pts[b][k]) b=i; } ext.push(a,b); }
  for(const a of ext) for(const b of ext){ const d=sub(pts[a],pts[b]), L=dot(d,d); if(L>best){ best=L; i0=a; i1=b; } }
  const u=sub(pts[i1],pts[i0]);
  let i2=-1; best=0;
  for(let i=0;i<n;i++){ const c=cross(u,sub(pts[i],pts[i0])), L=dot(c,c); if(L>best){ best=L; i2=i; } }
  if(i2<0||Math.sqrt(best)<=diag*diag*1e-7) return null;
  const nrm=cross(u,sub(pts[i2],pts[i0])), nl=Math.sqrt(dot(nrm,nrm));
  let i3=-1; best=0;
  for(let i=0;i<n;i++){ const d=Math.abs(dot(nrm,sub(pts[i],pts[i0])))/nl; if(d>best){ best=d; i3=i; } }
  if(i3<0||best<=diag*1e-6) return null;
  const inside=[0,1,2].map(k=>(pts[i0][k]+pts[i1][k]+pts[i2][k]+pts[i3][k])/4);

  const faces=[];
  const face=(a,b,c)=>{
    let nn=cross(sub(pts[b],pts[a]),sub(pts[c],pts[a]));
    const L=Math.sqrt(dot(nn,nn))||1; nn=[nn[0]/L,nn[1]/L,nn[2]/L];
    let d=dot(nn,pts[a]);
    if(dot(nn,inside)-d>0){ const t=b; b=c; c=t; nn=[-nn[0],-nn[1],-nn[2]]; d=-d; }
    faces.push({a,b,c,n:nn,d,alive:true});
  };
  face(i0,i1,i2); face(i0,i1,i3); face(i0,i2,i3); face(i1,i2,i3);

  for(let i=0;i<n;i++){
    if(i===i0||i===i1||i===i2||i===i3) continue;
    const p=pts[i], seen=[];
    for(const f of faces) if(f.alive&&dot(f.n,p)-f.d>eps) seen.push(f);
    if(!seen.length) continue;
    const edges=new Map();
    for(const f of seen){ f.alive=false;
      edges.set(f.a+","+f.b,[f.a,f.b]); edges.set(f.b+","+f.c,[f.b,f.c]); edges.set(f.c+","+f.a,[f.c,f.a]); }
    // the horizon: edges of lit faces whose twin belongs to an unlit face
    for(const [,e] of edges) if(!edges.has(e[1]+","+e[0])) face(e[0],e[1],i);
  }
  const out=faces.filter(f=>f.alive).map(f=>[f.a,f.b,f.c]);
  return out.length>=4?{faces:out}:null;
}

/* The eight corners of the points' axis-aligned box, for parts too flat
   or too small to hull. */
const THIN_T=0.0015;                          // a sheet still gets some thickness
function boxCorners(pts){
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  for(const p of pts) for(let k=0;k<3;k++){ if(p[k]<mn[k]) mn[k]=p[k]; if(p[k]>mx[k]) mx[k]=p[k]; }
  const t=THIN_T;
  for(let k=0;k<3;k++) if(mx[k]-mn[k]<t){ const c=(mx[k]+mn[k])/2; mn[k]=c-t/2; mx[k]=c+t/2; }
  const out=[];
  for(let i=0;i<8;i++) out.push([i&1?mx[0]:mn[0], i&2?mx[1]:mn[1], i&4?mx[2]:mn[2]]);
  return out;
}

/* A solid as flat-shaded triangles: positions and normals, three floats
   per vertex, ready to append to a merged buffer. */
function solidTriangles(pts){
  let P=pts, h=convexHull(P);
  if(!h){ P=boxCorners(pts); h=convexHull(P); }
  if(!h) return null;
  const pos=[], nor=[];
  for(const [a,b,c] of h.faces){
    const A=P[a], B=P[b], C=P[c];
    const u=[B[0]-A[0],B[1]-A[1],B[2]-A[2]], v=[C[0]-A[0],C[1]-A[1],C[2]-A[2]];
    let n=[u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const L=Math.hypot(n[0],n[1],n[2]); if(!(L>0)) continue;
    n=[n[0]/L,n[1]/L,n[2]/L];
    for(const q of [A,B,C]){ pos.push(q[0],q[1],q[2]); nor.push(n[0],n[1],n[2]); }
  }
  return {pos, nor};
}

/* Keep a part's shape with fewer points: every direction's extreme, then
   an even spread of the rest. */
const SPREAD_DIRS=(()=>{ const d=[]; for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) for(let z=-1;z<=1;z++) if(x||y||z) d.push([x,y,z]); return d; })();
function thinPoints(pts,max){
  if(pts.length<=max) return pts.slice();
  const keep=new Set();
  for(const d of SPREAD_DIRS){ let bi=0, bv=-Infinity;
    for(let i=0;i<pts.length;i++){ const v=pts[i][0]*d[0]+pts[i][1]*d[1]+pts[i][2]*d[2]; if(v>bv){ bv=v; bi=i; } }
    keep.add(bi); }
  const step=pts.length/Math.max(1,max-keep.size);
  for(let f=0; keep.size<max && f<pts.length; f+=step) keep.add(Math.floor(f));
  return [...keep].map(i=>pts[i]);
}

/* A part's name as words, the one reading every name test uses (solidKind here, dtIsWheel in
   src/drivetrain.js): underscores are spaces, and a lower-case letter followed by a capital, or a
   letter followed by a digit, is a word break. "IntakeRoller", "motor_mount", "Tire1", "4inOmni"
   and "ControlHub" read "intake roller", "motor mount", "tire 1", "4in omni", "control hub".
   Part numbers keep their shape: "am-3376", "REV-11-1855", "5203-2402-0019". */
function kindName(name){
  return String(name||"").replace(/_+/g," ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/([A-Za-z])(\d)/g,"$1 $2").toLowerCase().replace(/\s+/g," ").trim();
}
/* The head of a name says what the part is; what follows "(", " with ", " for " or a comma says
   what it fits, what it carries or how big it is: "Servo Frame (43mm Width, for Standard Size
   Servos)" is a frame, "Servo with Servo Horn" a servo. */
function kindHead(t){ return t.split(/\(| with | for |,/)[0].trim(); }

/* A name says what a part is by its last word of that sort: a "motor mount" is a mount, a
   "wheel hub" a hub, a "roller chain" a chain, a "Core Motor Controller" a controller. When one
   of these nouns follows the word that would give the kind, the word only describes the part.
   Nouns that ARE the device stay out: a "Motor Gearbox", a "Servo Gearbox" and a "Motor Housing"
   are the motor and the servo, a "Motor Encoder" is part of the motor, and goBILDA's "Roller
   Cover" is the rubber tread of a mecanum roller. */
const KIND_ACCESSORY=/^[\s-]*(mount(s|ing)?|brackets?|plates?|spacers?|adapt[eo]rs?|guards?|shields?|standoffs?|clamps?|shafts?|axles?|hubs?|horns?|arms?|holders?|cables?|wires?|leads?|connectors?|controllers?|drivers?|pinions?|pulleys?|sprockets?|inserts?|collars?|bearings?|blocks?|frames?|chains?|power modules?)\b/;
/* The last match of `re` (a global regex) in `w`: true when it is the thing itself, false when an
   accessory noun follows it (it only describes the part), null when `re` is not in `w` at all. */
function kindWord(w,re){
  let m, last=null; re.lastIndex=0;
  while((m=re.exec(w))){ last=m; if(m[0]==="") re.lastIndex++; }
  return last?!KIND_ACCESSORY.test(w.slice(last.index+last[0].length)):null;
}
/* Does the name say `re` (a global regex), judged on its head when the head names anything? */
function kindSays(name,re){
  const t=kindName(name), h=kindHead(t);
  return h===t||kindWords(h).named?kindWord(h,re)===true:kindWord(t,re)===true;
}

/* The kind the words of `t` (a kindName) give, and whether any word in it names one: a kind
   word, even one an accessory noun turned down, or an accessory noun as its last word. */
function kindWords(t){
  let named=false;
  const say=re=>{ const k=kindWord(t,re); if(k!==null) named=true; return k===true; };
  const kind=(()=>{
    if(/screw|bolt|\bnut\b|washer|rivet|shcs|bhcs|fhcs|set ?screw|locknut/.test(t)) return "fastener";
    if(say(/yellow ?jacket|gearmotors?|\bmotors?\b/g)) return "motor";
    if(say(/\bservos?\b/g)) return "servo";
    if(say(/mecanum|\bomni|wheels?|\bt[iy]res?\b|\btraction\b|gecko|\brollers?\b/g)) return "wheel";
    // a hub with a name is electronics (REV's Control, Expansion and Servo Hubs, a power
    // distribution hub); any other hub, goBILDA's servo hub among them, is a metal part on a shaft
    if(/\bcontrollers?\b|\b(control|expansion|driver|usb|power) hubs?\b|\b(power )?distribution hubs?\b|\brev\b.*\bservo hubs?\b|\b(motor|servo) drivers?\b|\b(power|distribution|interface|legacy) modules?\b|battery|switch|camera|limelight|sensor|webcam|\bled\b|pcb/.test(t)) return "electronics";
    if(/polycarb|lexan|window|acrylic/.test(t)) return "clear";
    if(/print|\bpla\b|petg|tpu|nylon|onyx|3d/.test(t)) return "printed";
    // a "belt pulley" or a "chain sprocket" is the metal part, not the loop
    if(say(/belts?|chains?|strings?|cables?|wires?|springs?|surgical/g)) return "belt";
    return "metal";
  })();
  return {kind, named:named||kind!=="metal"||KIND_ACCESSORY.test((/\S+$/.exec(t)||[""])[0])};
}

/* A season's game element drawn in the robot, only when the whole name is the element: "Sample",
   "Red Sample 3", "Specimen", "CENTERSTAGE Pixel White am-5001_white", "Artifact", "Game Piece".
   A team's "Sample Intake", "Specimen Claw", "pixel_tray" or "artifact_ramp" is robot. */
const KIND_GAME=/^((ftc|into the deep|centerstage|center stage|decode|power play|freight frenzy)\W*\s+)?((red|blue|yellow|white|purple|green|neutral)\s+)*(samples?|specimens?|pixels?|artifacts?|game ?(pieces?|elements?))(\s+(red|blue|yellow|white|purple|green|neutral))*(\s*[<(]?\d+[>)]?)*(\s+am-\d{4}(\s+[a-z]+)?)?$/;

/* What a part is made of, from its name and part number: aluminium, a yellow-can motor, a black
   servo, rubber … It colours the part, picks its density (src/inertia.js), and a "wheel" is a
   candidate for the drive base and so for the floor (src/drivetrain.js, src/frame.js), so a wrong
   kind is a wrong weight or a wrong frame. Whole words only: "controller" holds "roller",
   "retraction" holds "traction", "entire" holds "tire". Part numbers decide first; then the head
   of the name; a head that names nothing ("Part 3 (Yellow Jacket)") leaves it to the whole name. */
function solidKind(name,pn){
  const s=kindName(name), p=String(pn||"");
  // INTO THE DEEP's sample, CENTERSTAGE's pixel, DECODE's artifact: not the robot's mass
  if(/am-3376|am-5201|am-5101/.test(s)||/^am-(3376|5201|5101)/.test(p)||KIND_GAME.test(s)) return "game";
  // BIOBUZZ's POLLEN and NECTAR (AndyMark am-5852), only when the whole name is the ball: a team's
  // "pollen intake" or "nectar ramp" is robot
  if(/^(am[- ]?5852\b.*|(biobuzz |ftc )?(red |blue |yellow )?(pollen|nectar)( ball)?( \d+)?)$/.test(s)||/^am-5852/.test(p)) return "game";
  if(/^520[234]-/.test(p)) return "motor";
  if(/^2000-0025/.test(p)) return "servo";
  // REV's Servo Hub by its part number, in the name or the part number
  if(/\brev[- ]?11[- ]?1855\b/.test(s+" "+p.toLowerCase())) return "electronics";
  const h=kindHead(s), H=kindWords(h);
  return H.named||h===s?H.kind:kindWords(s).kind;
}
