/* ============================================================
   THE WHOLE ROBOT FROM ONSHAPE, NO STEP
   ------------------------------------------------------------
   A STEP file carries shapes and nothing else: no joints, no motors,
   and its colours and masses only sometimes. Guessing the joints from
   the shapes is never exact on a team's own robot. Onshape already has
   all of it, so the "Send to SimBench" bookmark (src/onshapelink.js)
   now reads, from the team's own signed-in tab:
   - the assembly definition: every part occurrence and where it sits,
     and the mates (each one a joint, exactly);
   - the assembly's features: mate limits and relations;
   - per part studio, once however many times its parts are used:
     tessellated faces with their appearance, and mass properties.
   cadFromOnshape builds the same CAD object parseSTEP does, with each
   part's real triangles and colour, then applies the mates directly (the
   placements are Onshape's own, so every part matches by construction).
   Geometry keys: onshapeGeomKey(instance). Coordinates: metres.
   ============================================================ */
/* The part studio an instance comes from, as the bookmark keys it: linked
   (COTS) documents at their version, the team's own at its microversion. */
function onshapeGeomKey(i){
  const ver=i.documentVersion?"v/"+i.documentVersion:"m/"+(i.documentMicroversion||"");
  return i.documentId+"/"+ver+"/e/"+i.elementId+"|"+(i.configuration||"");
}
/* A colour as Onshape may give it: [r,g,b] in 0..1 or 0..255, "#rrggbb",
   {red,green,blue}, or an appearance holding one. Out: [r,g,b] 0..1 or null. */
function osColor(c){
  if(c==null) return null;
  if(typeof c==="string"){ const m=/^#?([0-9a-f]{6})/i.exec(c.trim()); if(!m) return null; const v=parseInt(m[1],16); return [(v>>16&255)/255,(v>>8&255)/255,(v&255)/255]; }
  if(Array.isArray(c)&&c.length>=3){ const n=c.slice(0,3).map(Number); if(!n.every(Number.isFinite)) return null;
    const big=n.some(x=>x>1); return n.map(x=>Math.max(0,Math.min(1,big?x/255:x))); }
  if(typeof c==="object"){
    if(c.color) return osColor(c.color);
    if(c.appearance) return osColor(c.appearance);
    if(Number.isFinite(c.red)){ const a=[c.red,c.green,c.blue]; return osColor(a.some(x=>x>1)?a:a); }
  }
  return null;
}
/* One Part Studio's tessellatedfaces response, compacted: partId -> {name, tri
   (flat xyz triples, metres, part studio frame), color}. The bookmark sends
   this shape (it compacts on the Onshape tab); a raw response works too. */
function osCompactTess(tess){
  const bodies=Array.isArray(tess)?tess:(tess&&(tess.bodies||tess.parts))||[];
  const out={};
  for(const b of bodies){
    const id=b.id||b.partId; if(!id) continue;
    const tri=[], area={};
    let best=null, bestA=-1;
    for(const f of b.faces||[]){
      const col=osColor(f.color||f.appearance||b.color||b.appearance);
      const key=col?col.map(x=>Math.round(x*255)).join(","):"";
      for(const fc of f.facets||[]){
        const v0=fc.vertices||fc.points; if(!v0||v0.length<3) continue;
        // Onshape writes a point as [x,y,z] or as {x,y,z}
        const v=v0.slice(0,3).map(p=>Array.isArray(p)?p.map(Number):[+p.x,+p.y,+p.z]);
        tri.push(v[0][0],v[0][1],v[0][2],v[1][0],v[1][1],v[1][2],v[2][0],v[2][1],v[2][2]);
        const u=[v[1][0]-v[0][0],v[1][1]-v[0][1],v[1][2]-v[0][2]], w=[v[2][0]-v[0][0],v[2][1]-v[0][1],v[2][2]-v[0][2]];
        const a=Math.hypot(u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]);
        if(key){ area[key]=(area[key]||0)+a; if(area[key]>bestA){ bestA=area[key]; best=col; } }
      }
    }
    out[id]={name:b.name||id, tri, color:best||osColor(b.color||b.appearance)};
  }
  return out;
}
/* Mass properties of a Part Studio (bodies: partId -> {mass:[nominal…], centroid, inertia}) */
function osCompactMass(mp){
  const out={}, B=mp&&mp.bodies;
  if(!B) return out;
  for(const id in B){ const b=B[id]; const m=Array.isArray(b.mass)?b.mass[0]:b.mass;
    if(Number.isFinite(m)&&m>0) out[id]={kg:m, com:Array.isArray(b.centroid)?b.centroid.slice(0,3):null}; }
  return out;
}

/* The CAD object, from a bookmark payload {name, asm, features, geom}.
   geom: key -> {parts: partId -> {name, tri, color}, mass: partId -> {kg, com}}
   (or the raw API responses as {tess, mass}). */
function cadFromOnshape(p,opts){
  opts=opts||{};
  const A=p.asm;
  if(!A||!A.rootAssembly) throw new Error("no assembly in what Onshape sent");
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
  const solids=[], P=[], missing=new Set(), why=[];
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  let kgSum=0, kgParts=0, nOcc=0;
  for(const o of A.rootAssembly.occurrences||[]){
    if(o.hidden) continue;
    const inst=instAt(o.path);
    if(!inst||inst.type!=="Part"||inst.suppressed) continue;
    nOcc++;
    const key=onshapeGeomKey(inst), G=geom[key], body=G&&G.parts[inst.partId];
    if(!body||!body.tri||body.tri.length<9){ if(!inst.shapeless) missing.add(inst.name||inst.partId); continue; }
    const T=o.transform, R=[[T[0],T[1],T[2]],[T[4],T[5],T[6]],[T[8],T[9],T[10]]], t=[T[3],T[7],T[11]];
    const tri=body.tri, pos=new Array(tri.length), nor=new Array(tri.length);
    const smn=[Infinity,Infinity,Infinity], smx=[-Infinity,-Infinity,-Infinity], pts=[];
    for(let k=0;k<tri.length;k+=3){
      const x=tri[k], y=tri[k+1], z=tri[k+2];
      const w=[R[0][0]*x+R[0][1]*y+R[0][2]*z+t[0], R[1][0]*x+R[1][1]*y+R[1][2]*z+t[1], R[2][0]*x+R[2][1]*y+R[2][2]*z+t[2]];
      pos[k]=w[0]; pos[k+1]=w[1]; pos[k+2]=w[2];
      for(let q=0;q<3;q++){ if(w[q]<smn[q]) smn[q]=w[q]; if(w[q]>smx[q]) smx[q]=w[q]; }
      if((k/3)%3===0||tri.length<300) pts.push(w);
    }
    // flat normals, one per facet
    for(let k=0;k<pos.length;k+=9){
      const u=[pos[k+3]-pos[k],pos[k+4]-pos[k+1],pos[k+5]-pos[k+2]], v=[pos[k+6]-pos[k],pos[k+7]-pos[k+1],pos[k+8]-pos[k+2]];
      let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]; const L=Math.hypot(n[0],n[1],n[2])||1; n=[n[0]/L,n[1]/L,n[2]/L];
      for(let q=0;q<9;q+=3){ nor[k+q]=n[0]; nor[k+q+1]=n[1]; nor[k+q+2]=n[2]; }
    }
    for(let q=0;q<3;q++){ mn[q]=Math.min(mn[q],smn[q]); mx[q]=Math.max(mx[q],smx[q]); }
    const size=Math.hypot(smx[0]-smn[0],smx[1]-smn[1],smx[2]-smn[2]);
    const raw=inst.name||body.name||"", nm=String(raw).replace(/\s*<\d+>\s*$/,"");
    const pn=/(\d{4}-\d{4}-\d{1,4}|REV-\d{2}-\d{4})/.exec((inst.partNumber||"")+" "+raw);
    const mass=G.mass&&G.mass[inst.partId];
    // occT in the parser's convention (src/step.js, osT in src/mates.js): r[k] is
    // the part's own k axis in the world, a column of Onshape's row-major R
    const sd={name:nm, part:pn?pn[1]:null, kind:solidKind(nm,pn?pn[1]:null), size, pts:thinPoints(pts.length>=4?pts:pts.concat(pts),120),
      rawTri:{pos,nor}, color:osColor(body.color), occT:{r:[0,1,2].map(k=>[R[0][k],R[1][k],R[2][k]]), t:t.slice()}, osPath:o.path.join("/"),
      // the shape once, in its Part Studio's frame, and where this copy sits: a
      // robot package (src/simbot.js) stores eight identical channels as one mesh
      inst:{key:key+"#"+inst.partId, local:tri, M:[T[0],T[1],T[2],T[3], T[4],T[5],T[6],T[7], T[8],T[9],T[10],T[11], 0,0,0,1]}};
    if(mass){ sd.kg=mass.kg; kgSum+=mass.kg; kgParts++; }
    for(const q of sd.pts) P.push(q);
    solids.push(sd);
  }
  if(!solids.length) throw new Error("Onshape sent the assembly but none of its parts' shapes"+(missing.size?" (missing: "+[...missing].slice(0,4).join(", ")+")":""));
  if(missing.size) why.push(missing.size+" part(s) came without a shape and are left out: "+[...missing].slice(0,6).join(", ")+(missing.size>6?" …":""));
  solids.sort((a,b)=>b.size-a.size);
  // the robot frame, exactly as parseSTEP does it (src/frame.js)
  let frame=null;
  if(typeof robotFrame==="function"){
    const F=robotFrame({solids, bbox:{min:mn.slice(),max:mx.slice()}}, {up:opts.up, shift:opts.shift});
    const bb=applyFrame(F,{points:P, solids, placements:[], bbox:{min:mn.slice(),max:mx.slice()}});
    for(let k=0;k<3;k++){ mn[k]=bb.min[k]; mx[k]=bb.max[k]; }
    frame=frameRecord(F);
    for(const s of solids){ const r=s.rawTri, pos=new Array(r.pos.length), nor=new Array(r.nor.length);
      // the copy's placement in the robot frame: the frame after the occurrence
      const A=frame.M, B=s.inst.M, C=new Array(16);
      for(let i=0;i<4;i++) for(let j=0;j<4;j++){ let v=0; for(let k=0;k<4;k++) v+=A[4*i+k]*B[4*k+j]; C[4*i+j]=v; }
      s.inst.M=C;
      for(let k=0;k<r.pos.length;k+=3){ const a=F.toRobot([r.pos[k],r.pos[k+1],r.pos[k+2]]), b=F.dirToRobot([r.nor[k],r.nor[k+1],r.nor[k+2]]);
        pos[k]=a[0]; pos[k+1]=a[1]; pos[k+2]=a[2]; nor[k]=b[0]; nor[k+1]=b[1]; nor[k+2]=b[2]; }
      s.tri={pos,nor}; s.keepTri=true; delete s.rawTri; }
  } else for(const s of solids){ s.tri=s.rawTri; s.keepTri=true; delete s.rawTri; }
  const counts=new Map();
  for(const s of solids){ const e=counts.get(s.name)||{name:s.name,part:s.part,n:0,kind:"struct"}; e.n++; counts.set(s.name,e); }
  const parts=[...counts.values()].map(e=>{ const hw=typeof hwFromPart==="function"?hwFromPart(e.part,e.name):null; return Object.assign(e,{kind:hw?hw.kind:"struct"}); });
  const cad={name:p.name||"Onshape robot", units:"METRE", points:P, pointCount:P.length, solids, bbox:{min:mn,max:mx}, parts, mechs:[], placements:[], frame, occs:[],
    source:"onshape", onshape:{url:p.url||null, parts:nOcc, withShape:solids.length, kg:kgParts?kgSum:null, kgParts}};
  if(kgParts) why.push("Mass from Onshape's materials: "+kgSum.toFixed(2)+" kg over "+kgParts+" of "+solids.length+" parts.");
  // the joints: the mates, onto parts that are Onshape's own, so all of them match
  const rep=applyOnshapeMates(cad,A,{features:p.features||null});
  cad.onshape.report=rep; cad.onshape.why=why.concat(rep.why||[]);
  return cad;
}
