/* ============================================================
   URDF → THE SAME ROBOT AN ONSHAPE IMPORT GIVES
   ------------------------------------------------------------
   Teams on Fusion, SolidWorks or FreeCAD can export URDF (fusion2urdf,
   ACDC4Robot, sw_urdf_exporter, FreeCAD's CROSS): the robot's links and
   its joints, with axes, limits, masses, colours and meshes. That is the
   same information an Onshape assembly holds, so it is translated into
   the bookmark's payload (src/onshapecad.js): each link is a part, each
   joint a mate between them, a mimic joint a mate relation. One builder
   then makes the robot either way.
   Meshes: STL (binary or ASCII) dropped with the .urdf, matched by file
   name. Box, cylinder and sphere visuals are built here. Xacro must be
   expanded first (xacro robot.urdf.xacro > robot.urdf).
   ============================================================ */
/* A small XML reader: elements, attributes, self-closing tags. Enough for URDF. */
function urdfXml(text){
  const root={tag:"#root",attrs:{},kids:[]}, stack=[root];
  const re=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<\s*([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while((m=re.exec(text))){
    if(m[1]){ while(stack.length>1&&stack.pop().tag!==m[1]); continue; }
    if(!m[2]) continue;
    const attrs={}, ra=/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a;
    while((a=ra.exec(m[3]||""))) attrs[a[1]]=(a[3]!=null?a[3]:a[4]).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
    const el={tag:m[2].replace(/^.*:/,""),attrs,kids:[]};
    stack[stack.length-1].kids.push(el);
    if(!m[4]) stack.push(el);
  }
  return root;
}
const urdfKid=(el,tag)=>el&&el.kids.find(k=>k.tag===tag)||null;
const urdfKids=(el,tag)=>el?el.kids.filter(k=>k.tag===tag):[];
const urdfNums=(s,n,d)=>{ const v=String(s==null?"":s).trim().split(/\s+/).map(Number); return v.length>=n&&v.slice(0,n).every(Number.isFinite)?v.slice(0,n):d; };

/* 4x4 transforms as {r:[3][3], t:[3]} */
function urdfRpy(rpy){
  const [r,p,y]=rpy, cr=Math.cos(r), sr=Math.sin(r), cp=Math.cos(p), sp=Math.sin(p), cy=Math.cos(y), sy=Math.sin(y);
  return [[cy*cp, cy*sp*sr-sy*cr, cy*sp*cr+sy*sr],[sy*cp, sy*sp*sr+cy*cr, sy*sp*cr-cy*sr],[-sp, cp*sr, cp*cr]];
}
function urdfOrigin(el){
  const o=urdfKid(el,"origin");
  return {r:urdfRpy(urdfNums(o&&o.attrs.rpy,3,[0,0,0])), t:urdfNums(o&&o.attrs.xyz,3,[0,0,0])};
}
const urdfMul=(A,B)=>({r:A.r.map(row=>[0,1,2].map(j=>row[0]*B.r[0][j]+row[1]*B.r[1][j]+row[2]*B.r[2][j])),
  t:[0,1,2].map(i=>A.r[i][0]*B.t[0]+A.r[i][1]*B.t[1]+A.r[i][2]*B.t[2]+A.t[i])});
const urdfInv=A=>{ const R=[[A.r[0][0],A.r[1][0],A.r[2][0]],[A.r[0][1],A.r[1][1],A.r[2][1]],[A.r[0][2],A.r[1][2],A.r[2][2]]];
  return {r:R, t:[0,1,2].map(i=>-(R[i][0]*A.t[0]+R[i][1]*A.t[1]+R[i][2]*A.t[2]))}; };
const urdfPt=(A,p)=>[0,1,2].map(i=>A.r[i][0]*p[0]+A.r[i][1]*p[1]+A.r[i][2]*p[2]+A.t[i]);
const urdfDir=(A,v)=>[0,1,2].map(i=>A.r[i][0]*v[0]+A.r[i][1]*v[1]+A.r[i][2]*v[2]);
const urdfT16=A=>[A.r[0][0],A.r[0][1],A.r[0][2],A.t[0], A.r[1][0],A.r[1][1],A.r[1][2],A.t[1], A.r[2][0],A.r[2][1],A.r[2][2],A.t[2], 0,0,0,1];

/* STL, binary or ASCII: flat xyz triples */
function urdfStl(buf){
  const u8=buf instanceof Uint8Array?buf:new Uint8Array(buf);
  const head=String.fromCharCode.apply(null,u8.subarray(0,Math.min(512,u8.length)));
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  const n=u8.length>=84?dv.getUint32(80,true):0;
  // binary: the size says so exactly (an ASCII header can still start with "solid")
  if(u8.length>=84&&u8.length===84+n*50){
    const out=new Array(n*9);
    for(let i=0;i<n;i++){ const o=84+i*50+12; for(let k=0;k<9;k++) out[i*9+k]=dv.getFloat32(o+k*4,true); }
    return out;
  }
  const text=typeof TextDecoder==="function"?new TextDecoder().decode(u8):head;
  const out=[], re=/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g; let m;
  while((m=re.exec(text))) out.push(+m[1],+m[2],+m[3]);
  return out.length%9?out.slice(0,out.length-out.length%9):out;
}
/* box, cylinder (along z), sphere: triangles in the visual's own frame */
function urdfPrim(g){
  const T=[], push=(a,b,c)=>T.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);
  if(g.tag==="box"){
    const [x,y,z]=urdfNums(g.attrs.size,3,[0.01,0.01,0.01]).map(v=>v/2);
    const V=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]];
    for(const [a,b,c,d] of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]){ push(V[a],V[b],V[c]); push(V[a],V[c],V[d]); }
  } else if(g.tag==="cylinder"){
    const r=+g.attrs.radius||0.01, h=(+g.attrs.length||0.01)/2, N=24;
    for(let i=0;i<N;i++){ const a=2*Math.PI*i/N, b=2*Math.PI*(i+1)/N, A=[r*Math.cos(a),r*Math.sin(a)], B=[r*Math.cos(b),r*Math.sin(b)];
      push([0,0,-h],[B[0],B[1],-h],[A[0],A[1],-h]); push([0,0,h],[A[0],A[1],h],[B[0],B[1],h]);
      push([A[0],A[1],-h],[B[0],B[1],-h],[B[0],B[1],h]); push([A[0],A[1],-h],[B[0],B[1],h],[A[0],A[1],h]); }
  } else if(g.tag==="sphere"){
    const r=+g.attrs.radius||0.01, N=12, M=8, P=(i,j)=>{ const t=Math.PI*j/M, f=2*Math.PI*i/N; return [r*Math.sin(t)*Math.cos(f),r*Math.sin(t)*Math.sin(f),r*Math.cos(t)]; };
    for(let i=0;i<N;i++) for(let j=0;j<M;j++){ push(P(i,j),P(i,j+1),P(i+1,j+1)); push(P(i,j),P(i+1,j+1),P(i+1,j)); }
  }
  return T;
}

/* The URDF as a SimBench robot payload. files: {basename: ArrayBuffer} for meshes. */
function urdfToPayload(text,files,name){
  files=files||{};
  const doc=urdfXml(text), robot=doc.kids.find(k=>k.tag==="robot");
  if(!robot) throw new Error("no <robot> in this file"+(/xacro/.test(text)?" (it's a xacro file: run xacro on it first)":""));
  if(/<xacro:|\$\{/.test(text)) throw new Error("this is a xacro file; run xacro on it first to get the plain URDF");
  const materials={};
  for(const m of urdfKids(robot,"material")){ const c=urdfKid(m,"color"); if(c&&m.attrs.name) materials[m.attrs.name]=urdfNums(c.attrs.rgba,3,null); }
  const links=urdfKids(robot,"link"), joints=urdfKids(robot,"joint");
  if(!links.length) throw new Error("the URDF has no links");
  const childOf=new Set(joints.map(j=>(urdfKid(j,"child")||{attrs:{}}).attrs.link));
  const root=links.find(l=>!childOf.has(l.attrs.name))||links[0];
  const byName=new Map(links.map(l=>[l.attrs.name,l]));
  // where each link sits with every joint at zero
  const W=new Map([[root.attrs.name,{r:[[1,0,0],[0,1,0],[0,0,1]],t:[0,0,0]}]]);
  const jOf=new Map();
  for(let pass=0;pass<links.length+2;pass++) for(const j of joints){
    const p=(urdfKid(j,"parent")||{attrs:{}}).attrs.link, c=(urdfKid(j,"child")||{attrs:{}}).attrs.link;
    if(!W.has(p)||W.has(c)) continue;
    W.set(c,urdfMul(W.get(p),urdfOrigin(j))); jOf.set(c,j);
  }
  const missingMesh=new Set(), base=s=>String(s||"").replace(/^.*[\\/]/,"").toLowerCase();
  // meshes by their file name, and by their path inside the zip; a URDF's
  // "package://robot/meshes/arm.glb" or "meshes/arm.glb" both find meshes/arm.glb
  const fileByBase={}, fileByPath={};
  for(const k in files){ fileByBase[base(k)]=files[k]; fileByPath[String(k).replace(/\\/g,"/").toLowerCase()]=files[k]; }
  const findMesh=fn=>{ const s=String(fn||"").replace(/\\/g,"/").replace(/^package:\/\/[^/]*\//,"").replace(/^file:\/\//,"").replace(/^\.\//,"").toLowerCase();
    if(fileByPath[s]) return fileByPath[s];
    for(const k in fileByPath) if(k.endsWith("/"+s)||s.endsWith("/"+k)) return fileByPath[k];
    return fileByBase[base(fn)]||null; };
  // the mesh files a mesh may itself refer to (a .gltf's .bin, an .obj's .mtl), by name
  const sidecars={}; for(const k in files) if(/\.(bin|mtl)$/i.test(k)) sidecars[base(k)]=files[k];
  const meshCache=new Map();
  const instances=[], occurrences=[], geom={}, idOf=new Map();
  links.forEach((l,i)=>{
    const id="L"+i, nm=l.attrs.name||id;
    idOf.set(nm,id);
    const tri=[]; let color=null;
    for(const v of urdfKids(l,"visual")){
      const O=urdfOrigin(v), g=urdfKid(v,"geometry"), shape=g&&g.kids[0]; if(!shape) continue;
      let T=[];
      if(shape.tag==="mesh"){
        const f=findMesh(shape.attrs.filename);
        if(!f){ missingMesh.add(base(shape.attrs.filename)); continue; }
        // STL, GLB, glTF or OBJ (src/meshfiles.js); the same file used by several links is read once
        let M=meshCache.get(f);
        if(!M){ try{ M=typeof meshRead==="function"?meshRead(shape.attrs.filename,f,sidecars):{tri:Float32Array.from(urdfStl(f)),color:null}; }
          catch(e){ missingMesh.add(base(shape.attrs.filename)+" ("+e.message+")"); continue; } meshCache.set(f,M); }
        const sc=urdfNums(shape.attrs.scale,3,[1,1,1]);
        T=Array.from(M.tri); for(let k=0;k<T.length;k+=3){ T[k]*=sc[0]; T[k+1]*=sc[1]; T[k+2]*=sc[2]; }
        // the mesh's own colour (a GLB's material, an OBJ's Kd) when the URDF gives none
        if(!color&&M.color) color=M.color.slice(0,3);
      } else T=urdfPrim(shape);
      for(let k=0;k<T.length;k+=3){ const q=urdfPt(O,[T[k],T[k+1],T[k+2]]); tri.push(q[0],q[1],q[2]); }
      const mat=urdfKid(v,"material");
      if(mat){ const c=urdfKid(mat,"color"); const mc=c?urdfNums(c.attrs.rgba,3,null):(materials[mat.attrs.name]||null); if(mc) color=mc; }
    }
    const inertial=urdfKid(l,"inertial"), mass=inertial&&urdfKid(inertial,"mass");
    const kg=mass?+mass.attrs.value:NaN;
    const key="URDF/m/MV/e/E"+i+"|default";
    geom[key]={parts:{["P"+i]:{name:nm,tri,color}}, mass:Number.isFinite(kg)&&kg>0?{["P"+i]:{kg}}:{}};
    instances.push({id,name:nm,type:"Part",suppressed:false,documentId:"URDF",elementId:"E"+i,configuration:"default",documentMicroversion:"MV",partId:"P"+i});
    if(W.has(nm)) occurrences.push({path:[id],transform:urdfT16(W.get(nm)),fixed:nm===root.attrs.name,hidden:false});
  });
  // joints as mates: the joint frame, z along its axis, in each end's own frame
  const features=[], limitsOut=[], mimic=[];
  joints.forEach((j,k)=>{
    const p=(urdfKid(j,"parent")||{attrs:{}}).attrs.link, c=(urdfKid(j,"child")||{attrs:{}}).attrs.link;
    if(!W.has(p)||!W.has(c)) return;
    const type=j.attrs.type||"fixed";
    const mateType=type==="revolute"||type==="continuous"?"REVOLUTE":type==="prismatic"?"SLIDER":type==="planar"?"PLANAR":type==="floating"?"BALL":"FASTENED";
    const ax=urdfNums((urdfKid(j,"axis")||{attrs:{}}).attrs.xyz,3,[1,0,0]);
    const L=Math.hypot(ax[0],ax[1],ax[2])||1, z=ax.map(v=>v/L);
    const x0=Math.abs(z[0])<0.9?[1,0,0]:[0,1,0], d=x0[0]*z[0]+x0[1]*z[1]+x0[2]*z[2];
    let x=[x0[0]-d*z[0],x0[1]-d*z[1],x0[2]-d*z[2]]; const Lx=Math.hypot(x[0],x[1],x[2]); x=x.map(v=>v/Lx);
    const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
    // in the child's frame the joint sits at its origin; in the parent's, through the chain
    const Jw={r:[[x[0],y[0],z[0]],[x[1],y[1],z[1]],[x[2],y[2],z[2]]],t:[0,0,0]};
    const inWorld=urdfMul(W.get(c),Jw), inParent=urdfMul(urdfInv(W.get(p)),inWorld);
    const cs=A=>({origin:A.t, xAxis:[A.r[0][0],A.r[1][0],A.r[2][0]], yAxis:[A.r[0][1],A.r[1][1],A.r[2][1]], zAxis:[A.r[0][2],A.r[1][2],A.r[2][2]]});
    const id="J"+k, nm=j.attrs.name||id;
    features.push({id,suppressed:false,featureType:"mate",featureData:{name:nm,mateType,matedEntities:[
      {matedOccurrence:[idOf.get(p)],matedCS:cs(inParent)},{matedOccurrence:[idOf.get(c)],matedCS:cs(Jw)}]}});
    const lim=urdfKid(j,"limit");
    if(lim&&type!=="continuous"&&(lim.attrs.lower!=null||lim.attrs.upper!=null)){
      const lo=+lim.attrs.lower||0, hi=+lim.attrs.upper||0, lin=mateType==="SLIDER";
      const q=v=>lin?(v*1000)+" mm":(v*180/Math.PI)+" deg";
      limitsOut.push({message:{featureId:id,name:nm,parameters:[{message:{parameterId:"limitsEnabled",value:true}},
        {message:{parameterId:lin?"limitAxialZMin":"limitRotationMin",expression:q(lo)}},{message:{parameterId:lin?"limitAxialZMax":"limitRotationMax",expression:q(hi)}}]}});
    }
    const mm=urdfKid(j,"mimic");
    if(mm) mimic.push({joint:mm.attrs.joint, id, ratio:mm.attrs.multiplier!=null?+mm.attrs.multiplier:1});
  });
  const fid=new Map(); features.forEach(f=>fid.set(f.featureData.name,f.id));
  for(const r of mimic){ const leader=fid.get(r.joint); if(!leader) continue;
    features.push({id:"R"+r.id,suppressed:false,featureType:"mateRelation",featureData:{name:"mimic "+r.joint,relationType:"LINEAR",mates:[{featureId:leader},{featureId:r.id}],relationRatio:r.ratio,reverseDirection:false}}); }
  // what URDF can't say: Onshape drops its mate relations on the way out, so a
  // cascade lift comes as three independent slides and a two-gear claw as two
  // independent turns. These are offered as hints; src/bind.js ties a hinted joint
  // to its leader only when the code drives the leader and nothing drives it.
  const hints=urdfCoupleHints(joints,W,fid,mimic);
  const asm={rootAssembly:{documentId:"URDF",elementId:"EROOT",configuration:"default",fullConfiguration:"default",documentMicroversion:"MV",instances,occurrences,features,patterns:[]},subAssemblies:[],parts:[]};
  const note=missingMesh.size?["Meshes not found with the URDF (drop them together): "+[...missingMesh].slice(0,6).join(", ")]:[];
  // Onshape's own loop closures: a placeholder link the mates couldn't make a tree of
  if(links.some(l=>/loop_closure/i.test(l.attrs.name||""))) note.push("The assembly has a closed linkage (Onshape wrote a loop_closure_link): the bench drives it through its first joint and holds the rest.");
  return {format:typeof ONSHAPE_FORMAT==="string"?ONSHAPE_FORMAT:"ftc-simbench.onshape", name:name||robot.attrs.name||"URDF robot", url:"", asm, features:{features:limitsOut}, geom, notes:note, from:"urdf", hints};
}
/* Coupling hints from the joint tree alone (in the URDF's own frame):
   - a cascade: prismatic joints in a chain along one axis, each stage riding the
     one before it, extend together (ratio 1 to the first stage);
   - a mirrored pair: two revolute joints on the same parent, parallel axes,
     pivots close together, turning opposite ways (a two-gear claw, ratio -1). */
function urdfCoupleHints(joints,W,fid,mimic){
  const mimicked=new Set(mimic.map(m=>m.id));
  const J=joints.map((j,k)=>{
    const p=(urdfKid(j,"parent")||{attrs:{}}).attrs.link, c=(urdfKid(j,"child")||{attrs:{}}).attrs.link, id="J"+k;
    if(!W.has(p)||!W.has(c)) return null;
    const ax=urdfNums((urdfKid(j,"axis")||{attrs:{}}).attrs.xyz,3,[1,0,0]), L=Math.hypot(ax[0],ax[1],ax[2])||1;
    const z=ax.map(v=>v/L), wz=urdfDir(W.get(c),z), lim=urdfKid(j,"limit");
    return {id, type:j.attrs.type||"fixed", parent:p, child:c, axis:wz, pivot:W.get(c).t, limit:lim?[+lim.attrs.lower||0,+lim.attrs.upper||0]:null};
  }).filter(Boolean);
  const par=(a,b)=>Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])>0.985;
  const out=[], byChild=new Map(J.map(j=>[j.child,j]));
  // cascades: walk up from each prismatic joint to the first prismatic along the same axis
  for(const j of J){
    if(j.type!=="prismatic"||mimicked.has(j.id)) continue;
    let root=j, up=byChild.get(j.parent), n=0;
    while(up&&n++<12){ if(up.type==="prismatic"&&par(up.axis,j.axis)) root=up; else if(up.type!=="fixed") break; up=byChild.get(up.parent); }
    if(root!==j) out.push({leader:root.id, follower:j.id, ratio:1, via:"cascade"});
  }
  // mirrored pairs
  const rev=J.filter(j=>(j.type==="revolute"||j.type==="continuous")&&!mimicked.has(j.id));
  for(let a=0;a<rev.length;a++) for(let b=a+1;b<rev.length;b++){
    const A=rev[a], B=rev[b];
    if(A.parent!==B.parent||!par(A.axis,B.axis)) continue;
    const d=Math.hypot(A.pivot[0]-B.pivot[0],A.pivot[1]-B.pivot[1],A.pivot[2]-B.pivot[2]);
    if(d>0.08||d<0.005) continue;
    const others=rev.filter(j=>j!==A&&j!==B&&j.parent===A.parent&&par(j.axis,A.axis)).length;
    if(others) continue;
    // the same way round about parallel axes drawn the same direction turns them opposite: a gear pair
    const same=A.axis[0]*B.axis[0]+A.axis[1]*B.axis[1]+A.axis[2]*B.axis[2]>0;
    out.push({leader:A.id, follower:B.id, ratio:same?-1:1, via:"gear"});
  }
  return out;
}
/* The robot itself */
function cadFromUrdf(text,files,opts){
  const p=urdfToPayload(text,files,opts&&opts.name);
  const cad=cadFromOnshape(p,opts);
  cad.source="urdf";
  if(p.notes.length) cad.onshape.why=p.notes.concat(cad.onshape.why||[]);
  urdfApplyHints(cad,p.hints);
  return cad;
}
/* The coupling hints onto the robot's joints (by the mate id each joint came from). */
function urdfApplyHints(cad,hints){
  if(!cad||!Array.isArray(hints)||!hints.length) return;
  const byFid=new Map((cad.mechs||[]).filter(m=>m.fromMate).map(m=>[m.fromMate.id,m]));
  for(const h of hints){ const L=byFid.get(h.leader), F=byFid.get(h.follower); if(L&&F&&!F.couple) F.coupleHint={to:L.id, ratio:h.ratio, via:h.via}; }
}
/* A robot export's zip (Onshape's URDF export, or any exporter's): the .urdf and
   its meshes, read with src/meshfiles.js. Resolves to the same payload. A zip
   with no .urdf but with .java files is the team's code, which the app handles. */
async function urdfFromZip(buf,name){
  const entries=await zipEntries(buf);
  const urdf=entries.find(e=>/\.urdf$/i.test(e.name))||entries.find(e=>/\.xml$/i.test(e.name)&&/<robot[\s>]/.test(new TextDecoder().decode(e.data.subarray(0,4000))));
  if(!urdf) return {entries, payload:null};
  const files={}; for(const e of entries) if(e!==urdf&&(MESH_EXT.test(e.name)||/\.(stl|glb|gltf|obj)$/i.test(e.name))) files[e.name]=e.data;
  const text=new TextDecoder().decode(urdf.data);
  const robotName=String(name||urdf.name).replace(/^.*[\\/]/,"").replace(/\.(zip|urdf)$/i,"");
  return {entries, payload:urdfToPayload(text,files,robotName)};
}
