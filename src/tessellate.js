/* ============================================================
   7b.  EXACT GEOMETRY — the STEP file's own B-rep, tessellated

   The parser keeps a thinned point cloud per part, and the view used to draw
   each part as that cloud's convex hull: a U-channel came out a brick, a
   mecanum wheel a puck. The STEP file carries the exact surfaces, and
   OpenCascade (occt-import-js, LGPL-2.1, loaded unmodified from jsDelivr the
   first time a STEP is dropped) turns them into triangles — the same
   triangles Onshape draws.

   occt knows nothing about mechanisms, so every mesh is matched back to the
   parser's solid (by name, then by where its box sits) and inherits that
   solid's mechanism: the arm's exact meshes swing with the arm. The matching
   is pure and tested in Node against the corpus; only Tess touches the DOM.
   ============================================================ */
const OCCT_CDN="https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/";
const OCCT_PARAMS={linearUnit:"meter", linearDeflectionType:"bounding_box_ratio", linearDeflection:0.001, angularDeflection:0.5};

/* Which mechanism carries a point, the rule the view has always used: the
   nearest link, except that a leaf effector only claims what is genuinely
   near it and a turret only what sits inside its radius. */
function mechOwner(cad,turretScale){
  const M=(cad&&cad.mechs)||[], bb=cad&&cad.bbox;
  const size=bb?Math.max(bb.max[0]-bb.min[0],bb.max[1]-bb.min[1],bb.max[2]-bb.min[2])||0.5:0.5;
  const ts=turretScale==null?0.55:turretScale;
  const distSeg=(p,a,b)=>{
    const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
    const L2=ab[0]*ab[0]+ab[1]*ab[1]+ab[2]*ab[2];
    let t=0;
    if(L2>1e-12) t=Math.max(0,Math.min(1,((p[0]-a[0])*ab[0]+(p[1]-a[1])*ab[1]+(p[2]-a[2])*ab[2])/L2));
    return Math.hypot(p[0]-a[0]-ab[0]*t, p[1]-a[1]-ab[1]*t, p[2]-a[2]-ab[2]*t);
  };
  // the view's rule: only links that can move claim parts
  const segs=M.filter(m=>m.pivot&&m.kind!=="fixed").map(m=>({id:m.id, m, a:m.pivot, b:m.distalTo||m.pivot}));
  const radialTo=(p,m)=>{
    const a=m.pivot, ax=m.axis, d=[p[0]-a[0],p[1]-a[1],p[2]-a[2]];
    const t=d[0]*ax[0]+d[1]*ax[1]+d[2]*ax[2];
    return Math.hypot(d[0]-ax[0]*t, d[1]-ax[1]*t, d[2]-ax[2]*t);
  };
  return p=>{
    if(!segs.length) return "chassis";
    let best=null, bd=1e9;
    for(const s of segs){ const d=distSeg(p,s.a,s.b); if(d<bd){ bd=d; best=s; } }
    let id=best.id; const m=best.m;
    if(!rigKids(M,m.id).length && m.lever>0 && bd>m.lever*0.55 && m.parent!=="chassis") id=m.parent;
    const root=M.filter(x=>x.id===id)[0];
    if(root&&root.parent==="chassis"&&root.kind==="revolute-yaw"){
      const turretR=Math.max(size*0.10,(root.lever||size*0.3)*ts);
      // and nothing beneath its own bearing: the battery under a turret stays put
      if(root.axis&&(radialTo(p,root)>turretR||p[2]<root.pivot[2]-0.02)) id="chassis";
    }
    return id;
  };
}
const solidCentroid=s=>{ const c=[0,0,0]; for(const p of s.pts){ c[0]+=p[0]; c[1]+=p[1]; c[2]+=p[2]; }
  const n=s.pts.length||1; return [c[0]/n,c[1]/n,c[2]/n]; };

/* Is a point inside one of the drive wheels (hub, rollers, side plates)? A
   drive wheel belongs to the chassis whatever mechanism sits nearest: by
   proximity alone, the rollers of a back wheel on 7832's robot rode with the
   intake. Canonical frame; cached per CAD. */
const WHEEL_TEST=new WeakMap();
function inDriveWheel(cad){
  if(!cad) return ()=>false;
  let f=WHEEL_TEST.get(cad); if(f) return f;
  let ws=[];
  try{ ws=(typeof driveFromCAD==="function"?driveFromCAD(cad,{front:"+x"}).wheels:[]).filter(w=>w.c&&w.axis); }catch(e){ ws=[]; }
  // centre inside the wheel's cylinder AND no bigger than the wheel: on 7832's
  // robot a 232 mm beam's centre sits inside the front-left wheel's cylinder,
  // and a centre test alone made it a wheel part that spun with the wheel
  f=(p,ext)=>ws.some(w=>{ if((ext||0)>2.2*w.r) return false;
    const a=w.axis, d=[p[0]-w.c[0],p[1]-w.c[1],p[2]-w.c[2]], t=d[0]*a[0]+d[1]*a[1]+d[2]*a[2];
    return Math.hypot(d[0]-t*a[0],d[1]-t*a[1],d[2]-t*a[2])<=w.r+0.003&&Math.abs(t)<=(w.width||0.05)/2+0.004; });
  WHEEL_TEST.set(cad,f); return f;
}
/* A part's largest box side, from its points or a {min,max} box: how big it is. */
const partExtent=x=>{
  let mn, mx;
  if(x&&x.min){ mn=x.min; mx=x.max; }
  else { mn=[Infinity,Infinity,Infinity]; mx=[-Infinity,-Infinity,-Infinity];
    for(const p of x||[]) for(let k=0;k<3;k++){ if(p[k]<mn[k]) mn[k]=p[k]; if(p[k]>mx[k]) mx[k]=p[k]; } }
  const e=Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]); return Number.isFinite(e)?e:0;
};
/* The group of every solid; a solid's group is the one its centroid falls in. */
function solidGroups(cad,turretScale){
  const own=mechOwner(cad,turretScale), ids=new Set(((cad&&cad.mechs)||[]).map(m=>m.id)), wheel=inDriveWheel(cad);
  // with Onshape mates each part's joint is known exactly (src/mates.js); a
  // part no joint carries is the frame's
  if(cad&&cad.mates) return ((cad&&cad.solids)||[]).map(s=>s.mech&&ids.has(s.mech)?s.mech:"chassis");
  return ((cad&&cad.solids)||[]).map(s=>{ if(!s.pts||!s.pts.length) return "chassis";
    const c=solidCentroid(s); if(wheel(c,partExtent(s.pts))) return "chassis";
    const g=own(c); return ids.has(g)?g:"chassis"; });
}

/* occt names the tree nodes, not always the meshes: the node that holds a
   mesh is the part it belongs to. */
function tessNames(res){
  const out=(res.meshes||[]).map(m=>m.name||"");
  const walk=n=>{ if(!n) return; for(const i of n.meshes||[]) if(!out[i]) out[i]=n.name||""; for(const c of n.children||[]) walk(c); };
  walk(res.root);
  return out;
}
const tessKey=s=>String(s||"").replace(/\s*<\d+>\s*$/,"").replace(/\s+/g," ").trim().toLowerCase();

/* A mesh's box in the canonical frame: raw CAD -> canonical by the frame's
   row-major 4x4, the same transform the parser gave its own points. */
function tessBox(pos,M){
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<pos.length;i+=3){
    const x=pos[i], y=pos[i+1], z=pos[i+2];
    for(let k=0;k<3;k++){ const v=M[4*k]*x+M[4*k+1]*y+M[4*k+2]*z+M[4*k+3]; if(v<mn[k]) mn[k]=v; if(v>mx[k]) mx[k]=v; }
  }
  return {min:mn, max:mx};
}
/* occt gives colours as linear RGB (a STEP's 0.78 grey comes back 0.57); the
   view draws sRGB, so they go back through the sRGB curve, or every part
   looks darker than it does in Onshape. */
const linToSrgb=v=>{ v=Math.max(0,Math.min(1,v)); return v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055; };
const tessColorHex=c=>c?"#"+c.map(v=>Math.round(linToSrgb(v)*255).toString(16).padStart(2,"0")).join(""):null;
const IDENT4=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const frameM=cad=>(cad&&cad.frame&&cad.frame.M)||IDENT4;

/* How much of box a lies inside box b; a hair of slack so a flat plate or a
   body touching its part's hull still counts as inside. */
function boxInside(a,b){
  const pad=0.0015; let va=1, vi=1;
  for(let k=0;k<3;k++){
    const la=Math.max(a.max[k]-a.min[k],2*pad);
    const lo=Math.max(a.min[k]-pad,b.min[k]-pad), hi=Math.min(a.max[k]+pad,b.max[k]+pad);
    va*=la+2*pad; vi*=Math.max(0,hi-lo);
  }
  return va>0?vi/va:0;
}

/* Every occt mesh -> the index of the parser solid it is part of, or -1.
   A part of several bodies (a mecanum wheel and its rollers) is several
   meshes but one solid, so a mesh belongs to the solid whose box holds it.
   Name first: two identical wheels are told apart by where they sit. */
function tessMatch(cad,res){
  const solids=(cad&&cad.solids)||[], M=frameM(cad), names=tessNames(res);
  const sb=solids.map(s=>{ const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
    for(const p of s.pts||[]) for(let k=0;k<3;k++){ if(p[k]<mn[k]) mn[k]=p[k]; if(p[k]>mx[k]) mx[k]=p[k]; }
    return {min:mn, max:mx, vol:[0,1,2].reduce((v,k)=>v*Math.max(1e-4,mx[k]-mn[k]),1)}; });
  const byName={};
  solids.forEach((s,i)=>{ const k=tessKey(s.name); (byName[k]=byName[k]||[]).push(i); });
  const keys=Object.keys(byName);
  const pick=(box,cands,min)=>{
    let best=-1, bs=min, bv=Infinity;
    for(const i of cands){ if(!Number.isFinite(sb[i].min[0])) continue;
      const s=boxInside(box,sb[i]);
      // equally inside two parts: the tighter one is the more specific
      if(s>bs+1e-6||(s>bs-1e-6&&best>=0&&sb[i].vol<bv)){ best=i; bs=s; bv=sb[i].vol; } }
    return best;
  };
  const all=solids.map((s,i)=>i);
  const solid=[], boxes=[];
  (res.meshes||[]).forEach((m,j)=>{
    const pos=m.attributes&&m.attributes.position&&m.attributes.position.array||[];
    const box=tessBox(pos,placeM(M,m.T)); boxes.push(box);
    if(!pos.length){ solid.push(-1); return; }
    // meshed per shape and placed per occurrence: the solid is already known
    if(res.solidOf){ solid.push(res.solidOf[j]!=null?res.solidOf[j]:-1); return; }
    const k=tessKey(names[j]);
    let cands=k?byName[k]:null;
    if(!cands&&k) for(const q of keys) if(q&&(q.startsWith(k)||k.startsWith(q))){ cands=(cands||[]).concat(byName[q]); }
    let i=cands?pick(box,cands,0.5):-1;
    if(i<0) i=pick(box,all,0.9);
    solid.push(i);
  });
  return {solid, boxes, names};
}

/* The mechanism group of every mesh: its solid's, and for a mesh with no
   solid (a screw the parser thinned away) the one its own centre falls in —
   an arm's screws ride the arm. */
function tessAssign(cad,res,turretScale){
  const mt=tessMatch(cad,res), sg=solidGroups(cad,turretScale), own=mechOwner(cad,turretScale);
  const ids=new Set(((cad&&cad.mechs)||[]).map(m=>m.id));
  const group=mt.solid.map((i,j)=>{
    if(i>=0) return sg[i];
    const b=mt.boxes[j]; if(!Number.isFinite(b.min[0])) return "chassis";
    const c=[0,1,2].map(k=>(b.min[k]+b.max[k])/2);
    if(!cad.mates&&inDriveWheel(cad)(c,partExtent(b))) return "chassis";
    const g=own(c); return ids.has(g)?g:"chassis";
  });
  return {group, solid:mt.solid, names:mt.names, boxes:mt.boxes};
}

/* The model's edges, as Onshape draws them: the boundaries of B-rep faces.
   occt says which triangles make each face (brep_faces), so an edge used by
   exactly one triangle of a face is that face's boundary — a real CAD edge,
   not a guess from angles (a crease threshold would draw every facet of a
   coarse cylinder and miss a tangent fillet). Meshes without face ranges
   fall back to creases steeper than 30 degrees on welded vertices. Returns
   line-segment pairs per mechanism group, in the canonical frame. */
/* A mesh's real edges, in its own coordinates: flat [ax,ay,az,bx,by,bz, …].
   occt says which triangles make each B-rep face (brep_faces), so an edge used
   by exactly one triangle of a face is that face's boundary — a real CAD edge,
   not a guess from angles. Meshes without face ranges fall back to creases
   steeper than 30 degrees on welded vertices. Shared meshes (one shape placed
   many times) are worked out once. */
const EDGE_CACHE=new WeakMap();
function meshEdgeSegs(m){
  const P=m.attributes&&m.attributes.position&&m.attributes.position.array, I=m.index&&m.index.array;
  if(!P||!P.length||!I||!I.length) return new Float32Array(0);
  const hit=EDGE_CACHE.get(P); if(hit) return hit;
  const out=[], put=(a,b)=>out.push(P[3*a],P[3*a+1],P[3*a+2],P[3*b],P[3*b+1],P[3*b+2]);
  if(m.brep_faces&&m.brep_faces.length){
    for(const f of m.brep_faces){
      const cnt=new Map();
      for(let t=f.first;t<=f.last;t++) for(let e=0;e<3;e++){
        const a=I[3*t+e], b=I[3*t+(e+1)%3], k=a<b?a*4294967296+b:b*4294967296+a;
        cnt.set(k,(cnt.get(k)||0)+1);
      }
      for(const [k,n] of cnt) if(n===1) put(Math.floor(k/4294967296), k%4294967296);
    }
  }else{
    // no face ranges: weld by position, then keep creases and open borders
    const key=i=>Math.round(P[3*i]*1e5)+","+Math.round(P[3*i+1]*1e5)+","+Math.round(P[3*i+2]*1e5);
    const weld=new Map(), id=new Uint32Array(P.length/3);
    for(let i=0;i<id.length;i++){ const k=key(i); if(!weld.has(k)) weld.set(k,i); id[i]=weld.get(k); }
    const nrm=t=>{ const a=I[3*t],b=I[3*t+1],c=I[3*t+2];
      const ux=P[3*b]-P[3*a],uy=P[3*b+1]-P[3*a+1],uz=P[3*b+2]-P[3*a+2], vx=P[3*c]-P[3*a],vy=P[3*c+1]-P[3*a+1],vz=P[3*c+2]-P[3*a+2];
      const n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx], L=Math.hypot(n[0],n[1],n[2])||1; return [n[0]/L,n[1]/L,n[2]/L]; };
    const edges=new Map();
    for(let t=0;t<I.length/3;t++) for(let e=0;e<3;e++){
      const a=id[I[3*t+e]], b=id[I[3*t+(e+1)%3]]; if(a===b) continue;
      const k=a<b?a+"_"+b:b+"_"+a; const r=edges.get(k); if(r) r.t.push(t); else edges.set(k,{a,b,t:[t]}); }
    const cos30=Math.cos(Math.PI/6);
    for(const e of edges.values()){
      let keep=e.t.length!==2;
      if(!keep){ const n1=nrm(e.t[0]), n2=nrm(e.t[1]); keep=n1[0]*n2[0]+n1[1]*n2[1]+n1[2]*n2[2]<cos30; }
      if(keep) put(e.a,e.b);
    }
  }
  const segs=new Float32Array(out); EDGE_CACHE.set(P,segs); return segs;
}
/* The model's edges per mechanism group, in the canonical frame. */
function tessEdges(cad,res,asg,hidden){
  const out={};
  (res.meshes||[]).forEach((m,j)=>{
    if(hidden&&hidden.has(j)) return;
    const S=meshEdgeSegs(m); if(!S.length) return;
    const g=asg.group[j], A=placeM(frameM(cad),m.T), a=out[g]||(out[g]=[]);
    for(let i=0;i<S.length;i+=3){ const x=S[i], y=S[i+1], z=S[i+2];
      a.push(A[0]*x+A[1]*y+A[2]*z+A[3], A[4]*x+A[5]*y+A[6]*z+A[7], A[8]*x+A[9]*y+A[10]*z+A[11]); }
  });
  return Object.keys(out).map(g=>({group:g, pos:new Float32Array(out[g])}));
}
/* raw -> canonical for a mesh: the frame's 4x4 (row-major), after the mesh's own
   placement when it's a shape placed per occurrence (src/tessellate tessExpand) */
function placeM(M,T){
  if(!T) return M;
  const r=T.r, t=T.t, O=[r[0][0],r[1][0],r[2][0],t[0], r[0][1],r[1][1],r[2][1],t[1], r[0][2],r[1][2],r[2][2],t[2]];
  const C=new Array(16).fill(0); C[15]=1;
  for(let i=0;i<3;i++) for(let k=0;k<4;k++)
    C[4*i+k]=M[4*i]*O[k]+M[4*i+1]*O[4+k]+M[4*i+2]*O[8+k]+(k===3?M[4*i+3]:0);
  return C;
}

/* The assembly as occt read it — the instance list Onshape shows — with
   every node's meshes (its own and all below) so a click anywhere selects
   the whole sub-assembly. */
function tessTree(res){
  const names=tessNames(res);
  let n=0;
  const walk=node=>{
    const kids=(node.children||[]).map(walk).filter(Boolean);
    const own=(node.meshes||[]).slice();
    const all=own.concat(...kids.map(k=>k.all));
    if(!all.length) return null;
    const name=node.name||(own.length===1?names[own[0]]:"")||"(unnamed)";
    return {id:"n"+(n++), name, own, all, kids};
  };
  return walk(res.root||{})||{id:"n0", name:"", own:[], all:[], kids:[]};
}

/* The draw buckets: one indexed buffer per (group, colour), in the canonical
   frame. STEP colours win, per face where the file has them; a part with
   none gets its solid kind and the view's palette. Each bucket remembers
   which triangles came from which mesh (`ranges`), so a click on the merged
   buffer still finds the part; `hidden` leaves meshes out. */
function tessBuckets(cad,res,asg,hidden){
  const M0=frameM(cad), solids=(cad&&cad.solids)||[], out={};
  const hex=tessColorHex;
  const bucket=(g,col,kind)=>{ const key=g+"|"+(col||"kind:"+kind);
    return out[key]=out[key]||{group:g, color:col, kind, parts:[], nv:0, ni:0}; };
  (res.meshes||[]).forEach((m,j)=>{
    if(hidden&&hidden.has(j)) return;
    const P=m.attributes&&m.attributes.position&&m.attributes.position.array, I=m.index&&m.index.array;
    if(!P||!P.length||!I||!I.length) return;
    const g=asg.group[j], si=asg.solid[j], kind=(si>=0&&solids[si].kind)||"metal";
    const base=hex(m.color);
    // triangle ranges by colour; faces without their own take the mesh's
    const runs={};
    const faces=m.brep_faces&&m.brep_faces.length?m.brep_faces:[{first:0,last:I.length/3-1,color:null}];
    for(const f of faces){ const c=hex(f.color)||base||""; (runs[c]=runs[c]||[]).push(f); }
    for(const c in runs){
      const b=bucket(g,c||null,kind);
      let nt=0; for(const f of runs[c]) nt+=f.last-f.first+1;
      b.parts.push({m, j, faces:runs[c], nt}); b.nv+=P.length/3; b.ni+=nt*3;
    }
  });
  const list=[];
  for(const key in out){
    const b=out[key], pos=new Float32Array(b.nv*3), nor=new Float32Array(b.nv*3), idx=new Uint32Array(b.ni);
    let vo=0, io=0; const ranges=[];
    for(const p of b.parts){
      ranges.push({j:p.j, start:io/3, count:p.nt});
      const P=p.m.attributes.position.array, N=p.m.attributes.normal&&p.m.attributes.normal.array, I=p.m.index.array;
      const M=placeM(M0,p.m.T);
      for(let i=0;i<P.length;i+=3){
        const x=P[i], y=P[i+1], z=P[i+2], o=vo*3+i;
        pos[o]=M[0]*x+M[1]*y+M[2]*z+M[3]; pos[o+1]=M[4]*x+M[5]*y+M[6]*z+M[7]; pos[o+2]=M[8]*x+M[9]*y+M[10]*z+M[11];
        if(N){ const a=N[i], c=N[i+1], d=N[i+2];
          nor[o]=M[0]*a+M[1]*c+M[2]*d; nor[o+1]=M[4]*a+M[5]*c+M[6]*d; nor[o+2]=M[8]*a+M[9]*c+M[10]*d; }
      }
      for(const f of p.faces) for(let t=f.first*3;t<=f.last*3+2;t++) idx[io++]=I[t]+vo;
      vo+=P.length/3;
    }
    list.push({group:b.group, color:b.color, kind:b.kind, pos, nor, idx, ranges, hasNormals:b.parts.every(p=>p.m.attributes.normal)});
  }
  return list;
}

/* ---- big assemblies: one small STEP per shape ----
   OpenCascade reads a whole 50 MB assembly, then fails to mesh any of it: a
   real 773-part Onshape export came back as 773 empty meshes. Meshing each
   shape on its own works, and a robot has far fewer shapes than parts (that
   one has 99: a screw is one shape used 200 times). So the file is cut into
   one small, complete STEP per shape, each meshed once, then placed at every
   occurrence the parser recorded (cad.occs).

   A unit is the part's representation (the one SHAPE_DEFINITION_REPRESENTATION
   names), the geometry hanging off it by a plain SHAPE_REPRESENTATION_
   RELATIONSHIP, and everything those reference, product records included, so
   OpenCascade sees a proper part. Assembly links (the WITH_TRANSFORMATION
   relationships, context-dependent representations, mapped items) are left
   out, and nothing is pulled in backwards except the part's own definition,
   its geometry relationship and its colours. Colours need a presentation
   representation listing the styled items, which the whole file has once for
   everything, so each unit gets its own. */
function stepShapeUnits(text,occs){
  const di=text.indexOf("DATA;"); if(di<0) return [];
  const de=text.lastIndexOf("ENDSEC;");
  const head=text.slice(0,di+5);
  const recs=splitStepRecords(text.slice(di+5,de>di?de:text.length));
  const byId=new Map(), headRe=/^\s*#(\d+)\s*=\s*/;
  for(const r of recs){ const m=headRe.exec(r); if(m) byId.set(+m[1],r.trim()); }
  const refsOf=r=>{ const out=[], re=/#(\d+)/g; re.lastIndex=r.indexOf("=")+1; let m; while((m=re.exec(r))) out.push(+m[1]); return out; };
  // the few backward links a unit needs, found by type
  const sdrOf=new Map(), srrOf=new Map(), styledOf=new Map();
  let maxId=0;
  for(const [id,r] of byId){
    if(id>maxId) maxId=id;
    if(/=\s*SHAPE_DEFINITION_REPRESENTATION\s*\(/.test(r)){ const k=refsOf(r); if(k.length>=2) sdrOf.set(k[1],id); }
    else if(/SHAPE_REPRESENTATION_RELATIONSHIP/.test(r)&&!/WITH_TRANSFORMATION/.test(r)){
      const k=refsOf(r); for(const x of k.slice(-2)){ if(!srrOf.has(x)) srrOf.set(x,[]); srrOf.get(x).push(id); } }
    else if(/=\s*(OVER_RIDING_STYLED_ITEM|STYLED_ITEM)\s*\(/.test(r)){
      const k=refsOf(r), item=k[k.length-(/OVER_RIDING/.test(r)?2:1)];
      if(item!=null){ if(!styledOf.has(item)) styledOf.set(item,[]); styledOf.get(item).push(id); } }
  }
  const NOFOLLOW=/=\s*\(?\s*(MAPPED_ITEM|REPRESENTATION_MAP|CONTEXT_DEPENDENT_SHAPE_REPRESENTATION|NEXT_ASSEMBLY_USAGE_OCCURRENCE|MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION)\b/;
  const units=[], seenRep=new Set();
  for(const o of occs||[]){
    if(o.rep==null||seenRep.has(o.rep)) continue;
    seenRep.add(o.rep);
    const seeds=[o.rep];
    if(sdrOf.has(o.rep)) seeds.push(sdrOf.get(o.rep));
    for(const srr of srrOf.get(o.rep)||[]){ seeds.push(srr); for(const x of refsOf(byId.get(srr)).slice(-2)) seeds.push(x); }
    const keep=new Set(), stack=seeds.slice();
    while(stack.length){
      const id=stack.pop(); if(keep.has(id)) continue;
      const r=byId.get(id); if(!r) continue;
      if(keep.size&&NOFOLLOW.test(r)) continue;
      keep.add(id);
      for(const k of refsOf(r)) if(!keep.has(k)) stack.push(k);
      for(const s of styledOf.get(id)||[]) if(!keep.has(s)) stack.push(s);
    }
    const styled=[...keep].filter(id=>/=\s*(OVER_RIDING_STYLED_ITEM|STYLED_ITEM)\s*\(/.test(byId.get(id)));
    const ctx=/,\s*#(\d+)\s*\)\s*$/.exec(byId.get(o.rep)||"");
    const body=[...keep].sort((a,b)=>a-b).map(id=>byId.get(id));
    if(styled.length&&ctx) body.push("#"+(maxId+1)+"=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',("+styled.map(i=>"#"+i).join(",")+"),#"+ctx[1]+")");
    units.push({rep:o.rep, text:head+"\n"+body.join(";\n")+";\nENDSEC;\nEND-ISO-10303-21;\n"});
  }
  return units;
}

/* The meshed shapes, placed: one entry per occurrence per shape mesh, the
   shape's arrays shared and `T` placing the copy (placeM applies it wherever
   a whole-file mesh would just take the frame). `solidOf` says which parser
   solid each came from, so nothing is matched by name or box; the tree is the
   assembly's own, from each occurrence's path. The view draws these as
   instances of one geometry, so a 773-part robot costs its 99 shapes. */
function tessExpand(occs,meshesOf){
  const meshes=[], solidOf=[], root={name:"", children:[], meshes:[]};
  const nodeAt=path=>{ let n=root;
    for(const p of path){ const key=p&&p.k!=null?p.k:p, name=p&&p.n!=null?p.n:String(p);
      let c=n.children.find(x=>x.sub===key); if(!c){ c={name, sub:key, children:[], meshes:[]}; n.children.push(c); } n=c; }
    return n; };
  for(const o of occs||[]){
    const list=meshesOf.get(o.rep); if(!list||!list.length) continue;
    const leaf={name:o.name, children:[], meshes:[]};
    nodeAt(o.path||[]).children.push(leaf);
    for(const m of list){
      leaf.meshes.push(meshes.length); solidOf.push(o.solid==null?-1:o.solid);
      // the shape's own arrays, shared by every copy; T places this copy
      meshes.push({name:o.name, color:m.color, brep_faces:m.brep_faces, attributes:m.attributes, index:m.index, T:o.T||null, shape:m});
    }
  }
  const strip=n=>{ delete n.sub; n.children.forEach(strip); return n; };
  return {success:true, meshes, root:strip(root), solidOf, perShape:true};
}

/* ---- the DOM side: fetch OpenCascade once, run it off the main thread ---- */
const Tess={
  worker:null, mod:null, seq:0, pending:{},
  /* A Blob worker that pulls occt from the CDN, so a 2000-part assembly
     tessellates without freezing the page. Typed arrays come back
     transferred, not copied. */
  makeWorker(){
    const src=`importScripts(${JSON.stringify(OCCT_CDN+"occt-import-js.js")});
let ready=null;
onmessage=async e=>{
  const d=e.data;
  try{
    ready=ready||occtimportjs({locateFile:f=>${JSON.stringify(OCCT_CDN)}+f});
    const oc=await ready, r=oc.ReadStepFile(new Uint8Array(d.buf),d.params), tr=[];
    if(r&&r.success) for(const m of r.meshes){
      const P=new Float32Array(m.attributes.position.array); m.attributes.position.array=P; tr.push(P.buffer);
      if(m.attributes.normal){ const N=new Float32Array(m.attributes.normal.array); m.attributes.normal.array=N; tr.push(N.buffer); }
      if(m.index){ const I=new Uint32Array(m.index.array); m.index.array=I; tr.push(I.buffer); }
    }
    postMessage({id:d.id, ok:!!(r&&r.success), res:r},tr);
  }catch(err){ postMessage({id:d.id, ok:false, error:String(err&&err.message||err)}); }
};`;
    const url=URL.createObjectURL(new Blob([src],{type:"text/javascript"}));
    const w=new Worker(url);
    w.onmessage=e=>{ const p=this.pending[e.data.id]; if(!p) return; delete this.pending[e.data.id];
      e.data.ok?p.resolve(e.data.res):p.reject(new Error(e.data.error||"OpenCascade couldn't read this STEP file")); };
    w.onerror=e=>{ e.preventDefault&&e.preventDefault(); this.fail(new Error("the OpenCascade worker didn't start ("+(e.message||"blocked")+")")); };
    return w;
  },
  fail(err){ for(const id in this.pending){ this.pending[id].reject(err); } this.pending={};
    if(this.worker){ try{ this.worker.terminate(); }catch(e){} } this.worker=null; this.noWorker=true; },
  /* No worker (a sandbox that forbids blob workers): the same library on the
     main thread, loaded by a script tag. */
  mainThread(buf,params){
    const load=this.mod||(this.mod=new Promise((res,rej)=>{
      if(typeof occtimportjs==="function"){ res(); return; }
      const s=document.createElement("script"); s.src=OCCT_CDN+"occt-import-js.js"; s.async=true;
      s.onload=()=>res(); s.onerror=()=>rej(new Error("couldn't load OpenCascade from the CDN"));
      document.head.appendChild(s);
    }).then(()=>occtimportjs({locateFile:f=>OCCT_CDN+f})));
    load.catch(()=>{ this.mod=null; });
    return load.then(oc=>{ const r=oc.ReadStepFile(new Uint8Array(buf),params||OCCT_PARAMS);
      if(!r||!r.success) throw new Error("OpenCascade couldn't read this STEP file"); return r; });
  },
  /* STEP text -> occt result, or a rejection with a short reason. */
  run(text,timeoutMs){
    const buf=new TextEncoder().encode(text).buffer;
    let job;
    if(!this.noWorker){
      try{ this.worker=this.worker||this.makeWorker(); }catch(e){ this.worker=null; this.noWorker=true; }
    }
    if(this.worker){
      const id=++this.seq;
      job=new Promise((resolve,reject)=>{ this.pending[id]={resolve,reject}; });
      this.worker.postMessage({id, buf, params:OCCT_PARAMS},[buf]);
      // a worker that dies on start (CSP, offline importScripts) falls back once
      job=job.catch(e=>{ if(this.noWorker&&!/couldn't read/.test(e.message)) return this.mainThread(new TextEncoder().encode(text).buffer); throw e; });
    }else job=this.mainThread(buf);
    const ms=timeoutMs||120000;
    let timer=null;
    const late=new Promise((_,rej)=>{ timer=setTimeout(()=>{
      // a stuck worker is dropped, so the next STEP starts clean
      if(this.worker){ try{ this.worker.terminate(); }catch(e){} this.worker=null; this.pending={}; }
      rej(new Error("OpenCascade took over "+Math.round(ms/1000)+" s")); },ms); });
    return Promise.race([job,late]).finally(()=>clearTimeout(timer));
  },

  /* ---- per shape: stepShapeUnits cuts the file, a few workers mesh the
     shapes side by side (biggest first, so the long ones start early), and
     tessExpand places each at its occurrences. One shape that won't mesh or
     hangs is skipped, not fatal. */
  send(w,text,params,ms){
    const id=++this.seq, buf=new TextEncoder().encode(text).buffer;
    const job=new Promise((resolve,reject)=>{ this.pending[id]={resolve,reject}; });
    w.postMessage({id, buf, params},[buf]);
    let timer=null;
    const late=new Promise((_,rej)=>{ timer=setTimeout(()=>{ delete this.pending[id]; rej(new Error("slow")); },ms); });
    return Promise.race([job,late]).finally(()=>clearTimeout(timer));
  },
  async perShape(cad,text,onProgress){
    const units=stepShapeUnits(text,cad.occs||[]);
    if(!units.length) throw new Error("no part shapes found to mesh");
    const b=cad.bbox, diag=Math.hypot(b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2])||0.5;
    // one tolerance for the whole robot, as fine as a whole-file mesh: per shape,
    // a ratio of each part's own box would mesh an M4 nut to the micron
    const params={linearUnit:"meter", linearDeflectionType:"absolute_value", linearDeflection:Math.max(0.0001,0.0005*diag), angularDeflection:0.5};
    const queue=units.slice().sort((a,c)=>c.text.length-a.text.length);
    const meshesOf=new Map(); let done=0, failed=0;
    const got=(u,r)=>{ if(r&&r.meshes&&r.meshes.some(m=>m.index&&m.index.array&&m.index.array.length)) meshesOf.set(u.rep,r.meshes); else failed++; };
    const tick=()=>{ done++; if(onProgress) onProgress(done,units.length); };
    if(!this.noWorker){
      const n=Math.max(1,Math.min(4,((typeof navigator!=="undefined"&&navigator.hardwareConcurrency)||4)-1,units.length));
      const pool=[];
      try{ this.worker=this.worker||this.makeWorker(); pool.push(this.worker); while(pool.length<n) pool.push(this.makeWorker()); }catch(e){ this.noWorker=true; }
      if(!this.noWorker){
        const lane=async i=>{
          for(let u;(u=queue.shift());){
            try{ got(u,await this.send(pool[i],u.text,params,90000)); }
            catch(e){ failed++;
              // a shape that hangs takes its worker with it: start a fresh one
              if(/slow/.test(e.message)){ const dead=pool[i]; try{ dead.terminate(); }catch(x){}
                if(dead===this.worker) this.worker=null; pool[i]=this.makeWorker(); } }
            tick();
            if(this.noWorker) break;
          }
        };
        await Promise.all(pool.map((w,i)=>lane(i)));
        // keep one warm for the next file; the rest give their memory back
        if(!this.worker&&!this.noWorker) this.worker=pool[0];
        for(const w of pool) if(w!==this.worker) try{ w.terminate(); }catch(e){}
      }
    }
    // no worker allowed (or it died): the same, on the main thread, one shape
    // per turn of the event loop so the page stays alive
    for(let u;(u=queue.shift());){
      try{ got(u,await this.mainThread(new TextEncoder().encode(u.text).buffer,params)); }catch(e){ failed++; }
      tick(); await new Promise(r=>setTimeout(r,0));
    }
    if(!meshesOf.size) throw new Error("none of the "+units.length+" part shapes would mesh");
    const res=tessExpand(cad.occs,meshesOf);
    res.shapes=units.length; res.failedShapes=failed;
    return res;
  },
  /* The exact surfaces of a parsed STEP: per shape when the parser could list
     the shapes (every part in its own colour, and a 50 MB assembly meshes at
     all), else the whole file at once. */
  exact(cad,text,onProgress){
    if(cad&&cad.occs&&cad.occs.length)
      return this.perShape(cad,text,onProgress).catch(e=>{
        if(text.length>30e6) throw e;                 // a big file won't do better whole
        return this.run(text);
      });
    return this.run(text);
  },
};
