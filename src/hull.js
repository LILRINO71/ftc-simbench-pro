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
  const n=pts.length; if(n<4) return null;
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  for(const p of pts) for(let k=0;k<3;k++){ if(p[k]<mn[k]) mn[k]=p[k]; if(p[k]>mx[k]) mx[k]=p[k]; }
  const diag=Math.hypot(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]); if(!(diag>0)) return null;
  const eps=diag*1e-9;
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
function boxCorners(pts){
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  for(const p of pts) for(let k=0;k<3;k++){ if(p[k]<mn[k]) mn[k]=p[k]; if(p[k]>mx[k]) mx[k]=p[k]; }
  const t=0.0015;                             // a sheet still gets some thickness
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

/* What a part is made of, from its name and part number — only used to
   colour it: aluminium, a yellow-can motor, a black servo, rubber … */
function solidKind(name,pn){
  const s=String(name||"").toLowerCase(), p=String(pn||"");
  if(/screw|bolt|\bnut\b|washer|rivet|shcs|bhcs|fhcs|set ?screw|locknut/.test(s)) return "fastener";
  if(/^520[234]-/.test(p)||/yellow ?jacket|gearmotor|\bmotor\b/.test(s)) return "motor";
  if(/^2000-0025/.test(p)||/\bservo\b/.test(s)) return "servo";
  if(/mecanum|omni|wheel|tire|tyre|traction|gecko|roller/.test(s)) return "wheel";
  if(/hub|battery|switch|camera|limelight|sensor|webcam|\bled\b|pcb/.test(s)) return "electronics";
  if(/polycarb|lexan|window|acrylic/.test(s)) return "clear";
  if(/print|\bpla\b|petg|tpu|nylon|onyx|3d/.test(s)) return "printed";
  if(/belt|chain|string|cable|wire|spring|surgical/.test(s)) return "belt";
  return "metal";
}
