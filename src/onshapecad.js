/* ============================================================
   THE WHOLE ROBOT FROM ONSHAPE'S API
   ------------------------------------------------------------
   cadFromOnshape builds the robot from what src/onshapelink.js read:
   - the assembly definition: every part occurrence and where it sits, and
     the mates, each one a joint exactly (src/mates.js applies them; the
     placements are Onshape's own, so every part matches by construction);
   - the assembly's features: mate limits and relations;
   - per Part Studio, once however many times its parts are placed: each
     part's triangles with its colour, and its mass, centre of mass and
     inertia tensor as Onshape computes them.

   What comes out is the same robot the URDF route gives (src/urdf.js), in
   the same shape, so the view, the physics and the checks need no new case:
   - cad.shapes: one thinned mesh per unique part (a Part Studio part, in
     one configuration), shared by every occurrence of it. Four mecanum
     wheels of 66 parts each are 66 shapes placed 264 times, and the view
     draws them as instances (urdfExact → View.setExact).
   - cad.solids: one per occurrence, with its placement (occT), its sampled
     points for the frame and the drive finder, its mass, and after the
     mates its rigid link (solid.mech).
   - the rigid links: parts fastened together, grouped, or sharing a
     sub-assembly with nothing moving inside collapse into one link
     (src/mates.js). onshapeLinks sums each link's exact mass, centre of
     mass and inertia tensor from Onshape's per-part figures (mass
     properties add, with the parallel-axis shift), so no extra API call is
     spent per link and the sum is exact.
   Coordinates: metres. Geometry keys: onshapeGeomKey(instance).
   ============================================================ */
/* The Part Studio an instance comes from, as the reader keys it: linked
   (COTS) documents at their version, the team's own at its microversion. */
function onshapeGeomKey(i){
  const ver=i.documentVersion?"v/"+i.documentVersion:"m/"+(i.documentMicroversion||"");
  return i.documentId+"/"+ver+"/e/"+i.elementId+"|"+(i.configuration||"");
}
/* A colour as Onshape may give it: [r,g,b] in 0..1 or 0..255, "#rrggbb",
   {red,green,blue}, an appearance holding one, or four bytes (red, green,
   blue, opacity) in base64, which is how tessellatedfaces writes a part's
   colour ("nc/t/w=="). Out: [r,g,b] 0..1 or null. */
function osColor(c){
  if(c==null) return null;
  if(typeof c==="string"){
    const t=c.trim();
    // four bytes in base64 are six characters and "==": read before the hex form, which six of those characters can look like
    if(/^[A-Za-z0-9+\/]{6}==$/.test(t)){ try{ const b=atob(t); if(b.length===4) return [b.charCodeAt(0)/255,b.charCodeAt(1)/255,b.charCodeAt(2)/255]; }catch(e){} return null; }
    const m=/^#?([0-9a-f]{6})/i.exec(t); if(!m) return null; const v=parseInt(m[1],16); return [(v>>16&255)/255,(v>>8&255)/255,(v&255)/255]; }
  if(Array.isArray(c)&&c.length>=3){ const n=c.slice(0,3).map(Number); if(!n.every(Number.isFinite)) return null;
    const big=n.some(x=>x>1); return n.map(x=>Math.max(0,Math.min(1,big?x/255:x))); }
  if(typeof c==="object"){
    if(c.color) return osColor(c.color);
    if(c.appearance) return osColor(c.appearance);
    if(Number.isFinite(c.red)) return osColor([c.red,c.green,c.blue]);
  }
  return null;
}
/* One Part Studio's tessellatedfaces response, compacted: partId -> {name, tri
   (Float32Array, flat xyz triples, metres, Part Studio frame), color (the one
   covering most of the part)}. Onshape writes a point as [x,y,z] or {x,y,z}. */
function osCompactTess(tess){
  const bodies=Array.isArray(tess)?tess:(tess&&(tess.bodies||tess.parts))||[];
  const out={};
  for(const b of bodies){
    const id=b.id||b.partId; if(!id) continue;
    let n=0; for(const f of b.faces||[]) n+=(f.facets||[]).length;
    const tri=new Float32Array(n*9), area={};
    let o=0, best=null, bestA=-1;
    for(const f of b.faces||[]){
      const col=osColor(f.color||f.appearance||b.color||b.appearance);
      const key=col?col.map(x=>Math.round(x*255)).join(","):"";
      let a=0;
      for(const fc of f.facets||[]){
        const v0=fc.vertices||fc.points; if(!v0||v0.length<3) continue;
        const at=o;
        for(let q=0;q<3;q++){ const p=v0[q]; if(Array.isArray(p)){ tri[o++]=+p[0]; tri[o++]=+p[1]; tri[o++]=+p[2]; } else { tri[o++]=+p.x; tri[o++]=+p.y; tri[o++]=+p.z; } }
        const ux=tri[at+3]-tri[at],uy=tri[at+4]-tri[at+1],uz=tri[at+5]-tri[at+2],wx=tri[at+6]-tri[at],wy=tri[at+7]-tri[at+1],wz=tri[at+8]-tri[at+2];
        a+=Math.hypot(uy*wz-uz*wy,uz*wx-ux*wz,ux*wy-uy*wx);
      }
      if(key){ area[key]=(area[key]||0)+a; if(area[key]>bestA){ bestA=area[key]; best=col; } }
    }
    out[id]={name:b.name||id, tri:o<tri.length?tri.slice(0,o):tri, color:best||osColor(b.color||b.appearance)};
  }
  return out;
}
/* Mass properties of a Part Studio: partId -> {kg, com, I, vol}. Onshape
   writes each figure three times (nominal first, then its bounds); the
   inertia is the tensor about the centroid, row-major. A part with no
   material has no mass: it carries its volume as kg (density 1), the way
   Onshape's own URDF export writes it, and src/inertia.js weighs that
   volume at the density its kind implies. For such a part Onshape writes
   zeros for the centroid too (it has no mass to centre), so the part comes
   with no centre here and cadFromOnshape takes it from the part's shape. */
function osCompactMass(mp){
  const out={}, B=mp&&mp.bodies;
  if(!B) return out;
  const first=(a,n)=>Array.isArray(a)&&a.length>=n&&a.slice(0,n).every(Number.isFinite)?a.slice(0,n):null;
  for(const id in B){
    const b=B[id]; if(!b) continue;
    const m=Array.isArray(b.mass)?+b.mass[0]:+b.mass, vol=Array.isArray(b.volume)?+b.volume[0]:+b.volume;
    const has=b.hasMass!==false&&Number.isFinite(m)&&m>0;
    const kg=has?m:(Number.isFinite(vol)&&vol>0?vol:NaN);
    // Onshape answered for this body, and it has neither mass nor volume: a surface or a sketch
    // curve, not a solid. It weighs nothing (left unsaid, its hull was weighed as metal)
    if(!(kg>0)){ if(Number.isFinite(vol)&&vol<=0&&!(m>0)) out[id]={kg:0, surface:true}; continue; }
    // the tensor only when it is one: Onshape writes zeros for a body with no material
    const I=first(b.inertia,9), real=I&&I.some(v=>v!==0)?I:null;
    const c=first(b.centroid,3);
    out[id]={kg, com:c&&(has||c.some(v=>v!==0))?c:null, I:real, vol:Number.isFinite(vol)&&vol>0?vol:null};
  }
  return out;
}

/* The centre of the volume a closed mesh encloses (flat xyz triples), or null
   when it encloses none (a surface, an open or inside-out shell). It is the
   centre of mass of a part of one material, which is what a part with no
   material set is weighed as. */
function osMeshCentroid(tri){
  let V=0, cx=0, cy=0, cz=0;
  // about the first corner, so a small part far from the origin keeps its digits
  const ox=tri[0], oy=tri[1], oz=tri[2];
  for(let i=0;i+8<tri.length;i+=9){
    const ax=tri[i]-ox, ay=tri[i+1]-oy, az=tri[i+2]-oz, bx=tri[i+3]-ox, by=tri[i+4]-oy, bz=tri[i+5]-oz, dx=tri[i+6]-ox, dy=tri[i+7]-oy, dz=tri[i+8]-oz;
    const v=ax*(by*dz-bz*dy)-ay*(bx*dz-bz*dx)+az*(bx*dy-by*dx);   // six times the corner tetrahedron's signed volume
    V+=v; cx+=v*(ax+bx+dx); cy+=v*(ay+by+dy); cz+=v*(az+bz+dz);
  }
  if(!(Math.abs(V)>1e-15)) return null;
  const c=[ox+cx/(4*V), oy+cy/(4*V), oz+cz/(4*V)];
  // a centre outside the shape's own box is a mesh that doesn't close: no answer beats a wrong one
  for(let a=0;a<3;a++){ let lo=Infinity, hi=-Infinity; for(let i=a;i<tri.length;i+=3){ if(tri[i]<lo) lo=tri[i]; if(tri[i]>hi) hi=tri[i]; } if(c[a]<lo-1e-6||c[a]>hi+1e-6) return null; }
  return c;
}

/* The CAD object, from a payload {name, url, asm, features, geom}. geom as
   onshapeRead gives it, or the raw API responses as {tess, mass}. */
function cadFromOnshape(p,opts){
  opts=opts||{};
  const A=p.asm;
  if(!A||!A.rootAssembly) throw new Error("no assembly in what Onshape sent");
  const say=opts.say||function(){};
  const geom={};
  for(const k in p.geom||{}){ const g=p.geom[k]||{};
    geom[k]={parts:g.parts||(g.tess?osCompactTess(g.tess):{}), mass:g.mass&&!g.mass.bodies?g.mass:osCompactMass(g.mass)}; }
  // an occurrence's path names instances from the root down: each step inside the
  // subassembly the step before it instances (two subassemblies can reuse an id)
  const defKey=o=>[o.documentId||"",o.elementId||"",o.fullConfiguration||o.configuration||"default"].join("|");
  const defs=new Map(); for(const d of A.subAssemblies||[]) defs.set(defKey(d),d);
  const instAt=path=>{ let list=A.rootAssembly.instances||[], i=null;
    for(const id of path||[]){ i=list.find(x=>x.id===id); if(!i) return null;
      if(i.type==="Assembly"){ const d=defs.get(defKey(i)); list=d?d.instances||[]:[]; } }
    return i; };
  const lin=c=>c==null?null:c.map(v=>{ v=Math.max(0,Math.min(1,+v||0)); return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4); });
  // Onshape's 4x4 (row-major, metres) as the view's placeM reads it: r = the part's axes in the world (columns), t = its origin
  const occOf=T=>({r:[[T[0],T[4],T[8]],[T[1],T[5],T[9]],[T[2],T[6],T[10]]], t:[T[3],T[7],T[11]]});
  const place=(T,v)=>[T[0]*v[0]+T[1]*v[1]+T[2]*v[2]+T[3], T[4]*v[0]+T[5]*v[1]+T[6]*v[2]+T[7], T[8]*v[0]+T[9]*v[1]+T[10]*v[2]+T[11]];
  // I' = R I R^T for a row-major 3x3 rotation R (as 9 numbers) and tensor I (9 numbers)
  const rotI=(R,I)=>{ const M=new Array(9).fill(0), out=new Array(9).fill(0);
    for(let i=0;i<3;i++) for(let j=0;j<3;j++) for(let k=0;k<3;k++) M[3*i+j]+=R[3*i+k]*I[3*k+j];
    for(let i=0;i<3;i++) for(let j=0;j<3;j++) for(let k=0;k<3;k++) out[3*i+j]+=M[3*i+k]*R[3*j+k];
    return out; };
  // ---- shapes: each unique part once, thinned ----
  const shapes=[], shapeOf=new Map(), missing=new Set(), why=[];
  let triBefore=0, triAfter=0;
  const shapeFor=(key,inst,body)=>{
    const sk=key+"#"+inst.partId;
    if(shapeOf.has(sk)) return shapeOf.get(sk);
    const tri=body.tri instanceof Float32Array?body.tri:Float32Array.from(body.tri);
    const R=meshReduce(tri,opts.reduce||{}); triBefore+=R.before; triAfter+=R.after;
    const idx=shapes.length;
    shapes.push({pos:R.pos, idx:R.idx, box:R.box, color:lin(osColor(body.color)), name:body.name||inst.name||inst.partId, file:null, tri0:tri});
    shapeOf.set(sk,idx);
    if(shapes.length%25===0) say("Thinning part shapes: "+shapes.length+" …");
    return idx;
  };
  // ---- solids: one per occurrence ----
  const solids=[], P=[];
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  let kgSum=0, kgParts=0, volParts=0, nOcc=0;
  // a part with no material: its centre from its own shape, worked out once per shape
  const cenOf=S=>{ if(S.cen===undefined) S.cen=osMeshCentroid(S.tri0); return S.cen; };
  const toSrgb=v=>v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055;
  for(const o of A.rootAssembly.occurrences||[]){
    if(o.hidden) continue;
    const inst=instAt(o.path);
    if(!inst||inst.type!=="Part"||inst.suppressed) continue;
    nOcc++;
    const key=onshapeGeomKey(inst), G=geom[key], body=G&&G.parts&&G.parts[inst.partId];
    if(!body||!body.tri||body.tri.length<9){ missing.add(inst.name||inst.partId); continue; }
    const T=o.transform; if(!Array.isArray(T)||T.length<12){ missing.add(inst.name||inst.partId); continue; }
    const k=shapeFor(key,inst,body), S=shapes[k];
    // sample points of the placed shape, thinned: what the physics, the frame and the drive finder read
    const pts=[], smn=[Infinity,Infinity,Infinity], smx=[-Infinity,-Infinity,-Infinity];
    const grow=q=>{ for(let a=0;a<3;a++){ if(q[a]<smn[a]) smn[a]=q[a]; if(q[a]>smx[a]) smx[a]=q[a]; } };
    const n=S.pos.length/3, step=Math.max(1,Math.floor(n/400));
    for(let i=0;i<n;i+=step){ const q=place(T,[S.pos[3*i],S.pos[3*i+1],S.pos[3*i+2]]); pts.push(q); grow(q); }
    // the shape's own box sets the extent exactly; its corners join the points only when the shape has few
    for(let c=0;c<8;c++){ const q=place(T,[c&1?S.box.max[0]:S.box.min[0], c&2?S.box.max[1]:S.box.min[1], c&4?S.box.max[2]:S.box.min[2]]); grow(q); if(n<48) pts.push(q); }
    for(let a=0;a<3;a++){ if(smn[a]<mn[a]) mn[a]=smn[a]; if(smx[a]>mx[a]) mx[a]=smx[a]; }
    const thin=thinPoints(pts,120);
    const raw=inst.name||body.name||"", nm=String(raw).replace(/\s*<\d+>\s*$/,"");
    const pn=/(\d{4}-\d{4}-\d{1,4}|REV-\d{2}-\d{4})/.exec((inst.partNumber||"")+" "+raw);
    const sd={name:nm, part:pn?pn[1]:null, kind:solidKind(nm,pn?pn[1]:null), size:Math.hypot(smx[0]-smn[0],smx[1]-smn[1],smx[2]-smn[2]), pts:thin,
      occT:occOf(T), osPath:o.path.join("/"), shapes:[k], color:S.color?S.color.map(toSrgb):null, tri:{pos:[],nor:[]}, keepTri:true};
    // the part's mass, centre of mass and inertia tensor, placed in the world (the robot frame below)
    const m=G.mass&&G.mass[inst.partId];
    if(m&&m.surface) sd.massless=true;
    if(m&&m.kg>0){
      sd.kg=m.kg;
      // a real mass, or a volume standing in for one (no material: density 1, to four digits)
      if(m.vol>0&&Math.abs(m.kg/m.vol-1)<1e-4) volParts++; else { kgSum+=m.kg; kgParts++; }
      const Rm=[T[0],T[1],T[2],T[4],T[5],T[6],T[8],T[9],T[10]];
      const c=m.com||cenOf(S);
      if(c) sd.com=place(T,c);
      if(m.I&&m.I.length===9) sd.I=rotI(Rm,m.I);
      if(m.vol>0) sd.vol=m.vol;
    }
    for(const q of thin) P.push(q);
    solids.push(sd);
  }
  // nothing to build: said as what it is, so nobody is told to "try again" on an empty tab
  if(!solids.length&&!nOcc) throw new Error("this assembly has no parts in it. Open the Assembly tab that holds your robot and paste that address");
  if(!solids.length) throw new Error("none of this assembly's "+nOcc+" part"+(nOcc===1?" has":"s have")+" a solid shape (sketches, curves or empty parts"+(missing.size?": "+[...missing].slice(0,4).join(", "):"")+"). A robot needs solid parts");
  if(missing.size) why.push(missing.size+" part(s) came without a shape and are left out: "+[...missing].slice(0,6).join(", ")+(missing.size>6?" …":""));
  solids.sort((a,b)=>b.size-a.size);
  // ---- the robot frame, exactly as parseSTEP and urdfRobot do it (src/frame.js) ----
  let frame=null, bbox={min:mn.slice(),max:mx.slice()};
  if(typeof robotFrame==="function"){
    say("Finding the floor and the front …");
    const F=robotFrame({solids, bbox:{min:mn.slice(),max:mx.slice()}}, {up:opts.up, shift:opts.shift});
    bbox=applyFrame(F,{points:P, solids, placements:[], bbox:{min:mn.slice(),max:mx.slice()}});
    frame=frameRecord(F);
    const R=[F.R[0][0],F.R[0][1],F.R[0][2],F.R[1][0],F.R[1][1],F.R[1][2],F.R[2][0],F.R[2][1],F.R[2][2]];
    for(const s of solids){ if(s.com) s.com=F.toRobot(s.com); if(s.I) s.I=rotI(R,s.I); }
  }
  const counts=new Map();
  for(const s of solids){ const e=counts.get(s.name)||{name:s.name,part:s.part,n:0,kind:"struct"}; e.n++; counts.set(s.name,e); }
  const parts=[...counts.values()].map(e=>{ const hw=typeof hwFromPart==="function"?hwFromPart(e.part,e.name):null; return Object.assign(e,{kind:hw?hw.kind:"struct"}); });
  why.push(shapes.length+" unique shapes placed "+solids.length+" times, thinned from "+(triBefore/1e6).toFixed(1)+" M to "+(triAfter/1e6).toFixed(2)+" M triangles.");
  for(const S of shapes) delete S.tri0;
  if(kgParts) why.push("Mass from Onshape: "+kgSum.toFixed(2)+" kg over "+kgParts+" of "+solids.length+" parts"+(volParts?"; "+volParts+" have no material set, so each is weighed by its own volume at the material its kind implies":"")+".");
  else if(volParts) why.push("No part has a material set in Onshape, so each of the "+volParts+" is weighed by its own volume at the material its kind implies. Set materials in Onshape (right-click a part, Assign material) for its real weight.");
  const cad={name:p.name||"Onshape robot", units:"METRE", points:P, pointCount:P.length, solids, bbox, parts, mechs:[], placements:[], frame, occs:[],
    source:"onshape", shapes, onshape:{url:p.url||null, parts:nOcc, withShape:solids.length, kg:kgParts?kgSum:null, kgParts, triangles:triAfter, trianglesBefore:triBefore}};
  // ---- the joints: the mates, onto parts that are Onshape's own, so all of them match ----
  say("The joints …");
  if(p.noLimits) why.push(p.noLimits+" list(s) of mate limits couldn't be read from Onshape, so some joints may have no stops. Try again to read them.");
  const rep=applyOnshapeMates(cad,A,{features:p.features||null, featuresBy:p.featuresBy||null});
  cad.onshape.report=rep; cad.onshape.why=why.concat(rep.why||[]);
  onshapeLinks(cad);
  return cad;
}

/* The rigid links' mass properties, summed from the parts' exact figures:
   cad.links = [{id ("chassis" or the joint's id), parts, kg, com, I (9,
   about com, robot frame), exact (every part had Onshape's tensor)}]. Parts
   with no tensor (a mass but no inertia, or a mass guessed from the shape)
   count as point masses at their centre. Each joint also learns what it
   carries, itself and everything hanging from it: mech.carries =
   {kg, com}, which the torque checks read instead of a guessed lever. */
function onshapeLinks(cad){
  const solids=cad.solids||[], mechs=cad.mechs||[], ids=new Set(mechs.map(m=>m.id));
  const groups=new Map([["chassis",[]]]); for(const m of mechs) groups.set(m.id,[]);
  for(const s of solids) (groups.get(s.mech&&ids.has(s.mech)?s.mech:"chassis")).push(s);
  // the part's weight as the bench weighs it (src/inertia.js): a volume standing in for a mass is weighed by kind
  const mass=s=>{ if(typeof partMass==='function'){ try{ const p=partMass(s,{}); return p.kg>0?p.kg:0; }catch(e){} } return s.kg>0?s.kg:0; };
  const centre=s=>{ if(s.com) return s.com; const c=[0,0,0]; for(const q of s.pts){ c[0]+=q[0]; c[1]+=q[1]; c[2]+=q[2]; } return s.pts.length?c.map(v=>v/s.pts.length):[0,0,0]; };
  const sum=list=>{
    let M=0; const c=[0,0,0]; let exact=true;
    for(const s of list){ const kg=mass(s); if(!kg) continue; const q=centre(s); M+=kg; c[0]+=kg*q[0]; c[1]+=kg*q[1]; c[2]+=kg*q[2]; if(!s.I) exact=false; }
    if(!(M>0)) return {kg:0, com:null, I:null, exact:false};
    const com=c.map(v=>v/M), I=new Array(9).fill(0);
    for(const s of list){ const kg=mass(s); if(!kg) continue; const q=centre(s), d=[q[0]-com[0],q[1]-com[1],q[2]-com[2]], dd=d[0]*d[0]+d[1]*d[1]+d[2]*d[2];
      for(let i=0;i<3;i++) for(let j=0;j<3;j++) I[3*i+j]+=(s.I?s.I[3*i+j]:0)+kg*((i===j?dd:0)-d[i]*d[j]); }
    return {kg:M, com, I, exact};
  };
  cad.links=[];
  for(const [id,list] of groups){ if(!list.length) continue; const r=sum(list); cad.links.push(Object.assign({id, parts:list.length},r)); }
  // what each joint carries: its own link and every link hanging from it
  const kids=new Map(); for(const m of mechs) if(m.parent&&m.parent!=="chassis"){ if(!kids.has(m.parent)) kids.set(m.parent,[]); kids.get(m.parent).push(m.id); }
  const under=(id,depth)=>{ let list=groups.get(id)||[]; if(depth<40) for(const k of kids.get(id)||[]) list=list.concat(under(k,depth+1)); return list; };
  for(const m of mechs){ const L=under(m.id,0), r=sum(L); m.carries={kg:r.kg, com:r.com, parts:L.length}; }
  return cad.links;
}
