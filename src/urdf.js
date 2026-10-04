/* ============================================================
   URDF → THE SAME ROBOT AN ONSHAPE IMPORT GIVES
   ------------------------------------------------------------
   Teams on Fusion, SolidWorks or FreeCAD can export URDF (fusion2urdf,
   ACDC4Robot, sw_urdf_exporter, FreeCAD's CROSS): the robot's links and
   its joints, with axes, limits, masses, colours and meshes. That is the
   same information an Onshape assembly holds, so it is translated into
   the assembly document the Onshape link gives (src/mates.js): each link
   is a part, each joint a mate between them, a mimic joint a mate
   relation. The mates then become joints the same way either route.
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

/* The coupling hints onto the robot's joints (by the mate id each joint came from). */
function urdfApplyHints(cad,hints){
  if(!cad||!Array.isArray(hints)||!hints.length) return;
  const byFid=new Map((cad.mechs||[]).filter(m=>m.fromMate).map(m=>[m.fromMate.id,m]));
  for(const h of hints){ const L=byFid.get(h.leader), F=byFid.get(h.follower); if(L&&F&&!F.couple) F.coupleHint={to:L.id, ratio:h.ratio, via:h.via}; }
}
/* ============================================================
   THE ROBOT FROM AN EXPORT, AT ANY SIZE
   ------------------------------------------------------------
   Onshape's export of a real robot: 1,920 links, 369 unique meshes placed
   1,950 times, 85 million triangles at its "Fine" setting, and a joint for
   every library bearing. A builder that copied each link's triangles ran
   out of memory at 12 GB. This one reads each unique mesh once,
   thins it (src/meshfiles.js meshReduce), keeps it shared, and gives each
   link only its placement; the view draws the shapes as instances
   (urdfExact), exactly as it draws a STEP's shapes.

   Onshape also writes a planar or cylindrical mate as a chain of two or
   three joints through "mate_connector" links that have no shape. Those
   chains collapse to one joint here: the turn when there is one, a slide
   when it is the only motion, fixed for a planar mate's three slides. A
   loop_closure placeholder link collapses the same way.
   ============================================================ */
const URDF_NO_LIMIT=1000;            // Onshape writes ±10000 for "no limit"
async function urdfRobot(text,files,name,opts){
  opts=opts||{}; files=files||{};
  const doc=urdfXml(text), robot=doc.kids.find(k=>k.tag==="robot");
  if(!robot) throw new Error("no <robot> in this file"+(/xacro/.test(text)?" (it's a xacro file: run xacro on it first)":""));
  if(/<xacro:|\$\{/.test(text)) throw new Error("this is a xacro file; run xacro on it first to get the plain URDF");
  const say=opts.say||function(){};
  const materials={};
  for(const m of urdfKids(robot,"material")){ const c=urdfKid(m,"color"); if(c&&m.attrs.name) materials[m.attrs.name]=urdfNums(c.attrs.rgba,3,null); }
  const links=urdfKids(robot,"link"), jEls=urdfKids(robot,"joint");
  if(!links.length) throw new Error("the URDF has no links");
  const childOf=new Set(jEls.map(j=>(urdfKid(j,"child")||{attrs:{}}).attrs.link));
  const root=links.find(l=>!childOf.has(l.attrs.name))||links[0];
  // where each link sits with every joint at zero
  const W=new Map([[root.attrs.name,{r:[[1,0,0],[0,1,0],[0,0,1]],t:[0,0,0]}]]);
  for(let pass=0;pass<links.length+2;pass++) for(const j of jEls){
    const p=(urdfKid(j,"parent")||{attrs:{}}).attrs.link, c=(urdfKid(j,"child")||{attrs:{}}).attrs.link;
    if(!W.has(p)||W.has(c)) continue;
    W.set(c,urdfMul(W.get(p),urdfOrigin(j)));
  }
  // joints as records, axes in the world
  let J=[];
  for(const j of jEls){
    const p=(urdfKid(j,"parent")||{attrs:{}}).attrs.link, c=(urdfKid(j,"child")||{attrs:{}}).attrs.link;
    if(!W.has(p)||!W.has(c)) continue;
    const type=j.attrs.type||"fixed";
    const ax=urdfNums((urdfKid(j,"axis")||{attrs:{}}).attrs.xyz,3,[1,0,0]), L=Math.hypot(ax[0],ax[1],ax[2])||1;
    const axis=urdfDir(W.get(c),ax.map(v=>v/L));
    const lim=urdfKid(j,"limit"); let lo=null, hi=null;
    if(lim&&type!=="continuous"&&(lim.attrs.lower!=null||lim.attrs.upper!=null)){ lo=+lim.attrs.lower||0; hi=+lim.attrs.upper||0;
      if(Math.abs(lo)>=URDF_NO_LIMIT&&Math.abs(hi)>=URDF_NO_LIMIT){ lo=null; hi=null; } }
    const mm=urdfKid(j,"mimic");
    J.push({name:j.attrs.name||("joint "+J.length), type, parent:p, child:c, axis, lo, hi, mimic:mm?{joint:mm.attrs.joint, ratio:mm.attrs.multiplier!=null?+mm.attrs.multiplier:1}:null});
  }
  // links with no shape are Onshape's connectors (a planar or cylindrical mate in pieces, a loop closure): collapse through them
  const hasShape=l=>urdfKids(l,"visual").some(v=>urdfKid(v,"geometry")&&urdfKid(v,"geometry").kids.length);
  const real=new Set(links.filter(l=>hasShape(l)||l===root).map(l=>l.attrs.name));
  const isTurn=t=>t==="revolute"||t==="continuous";
  const par=(a,b)=>Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])>0.985;
  let collapsed=0, held=0;
  for(let guard=0;guard<400;guard++){
    const conn=J.find(j=>!real.has(j.child)); if(!conn) break;
    const L=conn.child, up=conn, kids=J.filter(j=>j.parent===L);
    const merged=kids.map(jc=>{
      let type, axis=jc.axis, lo=jc.lo, hi=jc.hi;
      if(isTurn(jc.type)&&!isTurn(up.type)){ type=jc.type; }
      else if(isTurn(up.type)&&!isTurn(jc.type)){ type=up.type; axis=up.axis; lo=up.lo; hi=up.hi; }
      else if(isTurn(up.type)&&isTurn(jc.type)){ type=jc.type; }
      else if(up.type==="prismatic"&&jc.type==="prismatic"){ type=par(up.axis,jc.axis)?"prismatic":"planar"; }
      else if(up.type==="fixed"){ type=jc.type; }
      else if(jc.type==="fixed"){ type=up.type; axis=up.axis; lo=up.lo; hi=up.hi; }
      else type="fixed";
      // the slide directions gathered along the chain: two that aren't parallel make it a planar or
      // parallel mate (a part free about a plane), or a loop closure written as free slides. No
      // mechanism, but no fastening either: read as "fixed" it welded an arm to the chassis and
      // the arm's real pivot was "a mate between parts also fastened together", ignored.
      const slides=(up.slides||[]).concat(up.type==="prismatic"?[up.axis]:[],jc.type==="prismatic"?[jc.axis]:[])
        .filter((a,i,arr)=>arr.findIndex(b=>par(a,b))===i);
      if((slides.length>=2||/loop_closure/i.test(up.name+" "+jc.name))&&type!=="planar"){ type="planar"; held++; }
      return {name:jc.name, type, parent:up.parent, child:jc.child, axis, lo, hi, mimic:jc.mimic||up.mimic, collapsed:true, slides};
    });
    J=J.filter(j=>j!==up&&!kids.includes(j)).concat(merged); collapsed++;
  }
  // ---- shapes: each unique (mesh, visual origin, scale) once, thinned ----
  const base=s=>String(s||"").replace(/^.*[\\/]/,"").toLowerCase();
  const fileByBase={}, fileByPath={};
  for(const k in files){ fileByBase[base(k)]=files[k]; fileByPath[String(k).replace(/\\/g,"/").toLowerCase()]=files[k]; }
  const findMesh=fn=>{ const s=String(fn||"").replace(/\\/g,"/").replace(/^package:\/\/[^/]*\//,"").replace(/^file:\/\//,"").replace(/^\.\//,"").toLowerCase();
    if(fileByPath[s]) return fileByPath[s];
    for(const k in fileByPath) if(k.endsWith("/"+s)||s.endsWith("/"+k)) return fileByPath[k];
    return fileByBase[base(fn)]||null; };
  // a file is bytes, or a zip entry read when it is needed (src/meshfiles.js zipEntries lazy)
  const bytesOf=async f=>f&&(typeof f.read==="function"?await f.read():f);
  const sidecars={}; for(const k in files) if(/\.(bin|mtl)$/i.test(k)) sidecars[base(k)]=await bytesOf(files[k]);
  const shapes=[], shapeOf=new Map(), missing=new Set();
  let triBefore=0, triAfter=0, nShape=0;
  const lin=c=>c==null?null:c.map(v=>{ v=Math.max(0,Math.min(1,+v||0)); return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4); });
  const realLinks=links.filter(l=>real.has(l.attrs.name)&&hasShape(l));
  const shapeFor=async v=>{
    const O=urdfOrigin(v), g=urdfKid(v,"geometry"), shape=g&&g.kids[0]; if(!shape) return null;
    const sc=shape.tag==="mesh"?urdfNums(shape.attrs.scale,3,[1,1,1]):[1,1,1];
    const key=shape.tag==="mesh"?["m",shape.attrs.filename,sc.join(","),O.t.join(","),O.r.flat().map(x=>x.toFixed(5)).join(",")].join("|"):["p",JSON.stringify(shape.attrs),O.t.join(","),O.r.flat().join(",")].join("|");
    const mat=urdfKid(v,"material"), mc=mat?(urdfKid(mat,"color")?urdfNums(urdfKid(mat,"color").attrs.rgba,3,null):(materials[mat.attrs.name]||null)):null;
    if(shapeOf.has(key)){ const s=shapes[shapeOf.get(key)]; if(!s.color&&mc) s.color=lin(mc); return shapeOf.get(key); }
    let tri, color=mc;
    if(shape.tag==="mesh"){
      const f=findMesh(shape.attrs.filename); if(!f){ missing.add(base(shape.attrs.filename)); return null; }
      let M; try{ M=meshRead(shape.attrs.filename,await bytesOf(f),sidecars); }catch(e){ missing.add(base(shape.attrs.filename)+" ("+e.message+")"); return null; }
      tri=M.tri; if(!color&&M.color) color=M.color;
      if(sc[0]!==1||sc[1]!==1||sc[2]!==1){ tri=Float32Array.from(tri); for(let k=0;k<tri.length;k+=3){ tri[k]*=sc[0]; tri[k+1]*=sc[1]; tri[k+2]*=sc[2]; } }
    } else tri=Float32Array.from(urdfPrim(shape));
    if(!tri||tri.length<9) return null;
    // into the link's frame (the visual's origin), then thinned
    if(O.t.some(v=>v)||O.r.some((row,i)=>row.some((v,k)=>Math.abs(v-(i===k?1:0))>1e-9))){
      const out=new Float32Array(tri.length);
      for(let k=0;k<tri.length;k+=3){ const q=urdfPt(O,[tri[k],tri[k+1],tri[k+2]]); out[k]=q[0]; out[k+1]=q[1]; out[k+2]=q[2]; }
      tri=out;
    }
    const R=meshReduce(tri,opts.reduce||{}); triBefore+=R.before; triAfter+=R.after;
    const idx=shapes.length;
    shapes.push({pos:R.pos, idx:R.idx, box:R.box, color:lin(color), name:shape.tag==="mesh"?base(shape.attrs.filename):shape.tag, file:shape.tag==="mesh"?String(shape.attrs.filename).replace(/^.*[\/]/,""):null});
    shapeOf.set(key,idx); nShape++;
    if(nShape%20===0) say("reading part shapes: "+nShape+" …");
    return idx;
  };
  // ---- solids: one per visual (a part), grouped by link (a rigid body) ----
  // Onshape's export puts every part of a rigid body in one link, so the chassis
  // link holds fifty parts: read as one solid it weighed as a 600 mm block and
  // its lowest stray part set the floor. Each part is its own solid; the link is
  // a sub-assembly of them, so a mate on the link lands on all of them.
  let solids=[], P=[];
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  let instances=[], occurrences=[], subAssemblies=[];
  let kgSum=0, kgParts=0, li=0;
  const nice=s=>String(s||"").replace(/\.(stl|glb|gltf|obj)$/i,"").replace(/^_+|_+$/g,"").replace(/_/g," ").replace(/\s+/g," ").trim();
  const partNo=s=>{ const pn=/(\d{4})[_\- ](\d{4})[_\- ](\d{3,4})(?![\d])/.exec(String(s||"")); return pn?pn[1]+"-"+pn[2]+"-"+pn[3].padStart(4,"0"):null; };
  const toSrgb=v=>v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055;
  for(const l of realLinks){
    li++;
    const nm=l.attrs.name, Wl=W.get(nm), isRoot=nm===root.attrs.name;
    const vis=[]; for(const v of urdfKids(l,"visual")){ const k=await shapeFor(v); if(k!=null) vis.push(k); }
    if(!vis.length) continue;
    const inertial=urdfKid(l,"inertial"), mass=inertial&&urdfKid(inertial,"mass"), linkKg=mass?+mass.attrs.value:NaN;
    const many=vis.length>1;
    // the link's mass over its parts, by box volume
    const vols=vis.map(k=>{ const b=shapes[k].box; return Math.max(1e-9,(b.max[0]-b.min[0])*(b.max[1]-b.min[1])*(b.max[2]-b.min[2])); });
    const volSum=vols.reduce((a,b)=>a+b,0);
    const linkName=nm.replace(/_\d+$/,"").replace(/_/g," ").trim();
    if(many){
      instances.push({id:nm, name:nm, type:"Assembly", suppressed:false, documentId:"URDF", elementId:"L"+li, configuration:"default", fullConfiguration:"default", documentMicroversion:"MV"});
      occurrences.push({path:[nm], transform:urdfT16(Wl), fixed:isRoot, hidden:false});
      subAssemblies.push({documentId:"URDF", elementId:"L"+li, configuration:"default", fullConfiguration:"default", documentMicroversion:"MV", instances:[], features:[], patterns:[]});
    }
    vis.forEach((k,vi)=>{
      const S=shapes[k], id=many?nm+"#"+(vi+1):nm, path=many?[nm,id]:[nm];
      // sample points of the placed shape, thinned: what the physics, the frame and the drive finder read
      const pts=[]; let smn=[Infinity,Infinity,Infinity], smx=[-Infinity,-Infinity,-Infinity];
      const grow=q=>{ for(let a=0;a<3;a++){ if(q[a]<smn[a]) smn[a]=q[a]; if(q[a]>smx[a]) smx[a]=q[a]; } };
      const n=S.pos.length/3, step=Math.max(1,Math.floor(n/400));
      for(let i=0;i<n;i+=step){ const q=urdfPt(Wl,[S.pos[3*i],S.pos[3*i+1],S.pos[3*i+2]]); pts.push(q); grow(q); }
      // a shape with only a few vertices gets its box corners too, so its extent is exact. A
      // well-sampled one keeps its extreme points through the thinning; its box corners would
      // only add air (on a roller set at 45 degrees, 17 mm of it, and the wheel read 138 mm)
      if(n<48) for(let c=0;c<8;c++){ const q=urdfPt(Wl,[c&1?S.box.max[0]:S.box.min[0], c&2?S.box.max[1]:S.box.min[1], c&4?S.box.max[2]:S.box.min[2]]); pts.push(q); grow(q); }
      for(let a=0;a<3;a++){ if(smn[a]<mn[a]) mn[a]=smn[a]; if(smx[a]>mx[a]) mx[a]=smx[a]; }
      const thin=thinPoints(pts,120);
      const name=many?(nice(S.file)||linkName):linkName, part=partNo(many?S.file:nm)||partNo(nm);
      const sd={name, part, kind:solidKind(name,part), size:Math.hypot(smx[0]-smn[0],smx[1]-smn[1],smx[2]-smn[2]), pts:thin,
        // the placement, as the view's placeM reads it: r = the link's axes in the world (columns), t = its origin
        occT:{r:[0,1,2].map(a=>[Wl.r[0][a],Wl.r[1][a],Wl.r[2][a]]), t:Wl.t.slice()}, osPath:path.join("/"), link:nm, shapes:[k],
        color:S.color?S.color.map(toSrgb):null, tri:{pos:[],nor:[]}, keepTri:true};
      if(Number.isFinite(linkKg)&&linkKg>0){ sd.kg=linkKg*vols[vi]/volSum; kgSum+=sd.kg; kgParts++; }
      for(const q of thin) P.push(q);
      const inst={id, name:id, type:"Part", suppressed:false, documentId:"URDF", elementId:"L"+li, configuration:"default", documentMicroversion:"MV", partId:"P"+(vi+1)};
      if(many) subAssemblies[subAssemblies.length-1].instances.push(inst); else instances.push(inst);
      occurrences.push({path, transform:urdfT16(Wl), fixed:isRoot, hidden:false});
      solids.push(sd);
    });
  }
  if(!solids.length) throw new Error("none of the URDF's links have a shape that could be read"+(missing.size?" (missing: "+[...missing].slice(0,4).join(", ")+")":""));
  // the root link may have no shape: it still anchors the tree
  if(!solids.some(s=>s.link===root.attrs.name)){ instances.push({id:root.attrs.name, name:root.attrs.name, type:"Part", suppressed:false, documentId:"URDF", elementId:"EROOT", configuration:"default", documentMicroversion:"MV", partId:"PROOT"}); occurrences.push({path:[root.attrs.name], transform:urdfT16(W.get(root.attrs.name)), fixed:true, hidden:false}); }
  // ---- parts that were never mated to the robot ----
  // Onshape's exporter hangs an unmated part (or group) off the root with a fixed
  // "hanging_node_to_root_joint". Most are placed right (a channel dropped into place
  // and never mated); one left where it was inserted sits away from everything else.
  // A hanging group whose box is clear of the mated robot's box is left off.
  let stray=[];
  const drop=(gone,how)=>{
    const goneKey=new Set([...gone].map(s=>s.osPath)), goneLink=new Set([...gone].map(s=>s.link));
    stray=stray.concat([...gone].map(s=>s.name));
    solids=solids.filter(s=>!gone.has(s));
    occurrences=occurrences.filter(o=>!goneKey.has(o.path.join("/"))&&!(o.path.length===1&&goneLink.has(o.path[0])&&!solids.some(s=>s.link===o.path[0])));
    instances=instances.filter(i=>!goneKey.has(i.id)&&!(goneLink.has(i.id)&&!solids.some(s=>s.link===i.id)));
    for(const sa of subAssemblies) sa.instances=sa.instances.filter(i=>!goneKey.has(i.id));
    J=J.filter(j=>!(goneLink.has(j.child)&&!solids.some(s=>s.link===j.child)));
    P=[]; for(let a=0;a<3;a++){ mn[a]=Infinity; mx[a]=-Infinity; }
    for(const s of solids) for(const q of s.pts){ P.push(q); for(let a=0;a<3;a++){ if(q[a]<mn[a]) mn[a]=q[a]; if(q[a]>mx[a]) mx[a]=q[a]; } }
  };
  {
    const hanging=J.filter(j=>j.type==="fixed"&&j.parent===root.attrs.name&&/hanging/i.test(j.name));
    if(hanging.length){
      const kidsOf=new Map(); for(const j of J){ if(!kidsOf.has(j.parent)) kidsOf.set(j.parent,[]); kidsOf.get(j.parent).push(j.child); }
      const under=l=>{ const out=new Set([l]), q=[l]; while(q.length){ const x=q.pop(); for(const c of kidsOf.get(x)||[]) if(!out.has(c)){ out.add(c); q.push(c); } } return out; };
      const groups=hanging.map(j=>under(j.child)), inGroup=new Set(); for(const g of groups) for(const l of g) inGroup.add(l);
      const boxOf=list=>{ const b={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}; for(const s of list) for(const q of s.pts) for(let a=0;a<3;a++){ if(q[a]<b.min[a]) b.min[a]=q[a]; if(q[a]>b.max[a]) b.max[a]=q[a]; } return b; };
      const mated=boxOf(solids.filter(s=>!inGroup.has(s.link)));
      const clear=(a,b,gap)=>[0,1,2].some(k=>a.min[k]>b.max[k]+gap||a.max[k]<b.min[k]-gap);
      const gone=new Set();
      if(Number.isFinite(mated.min[0])) for(const g of groups){ const list=solids.filter(s=>g.has(s.link)); if(list.length&&clear(boxOf(list),mated,0.03)) for(const s of list) gone.add(s); }
      if(gone.size&&gone.size<solids.length/2) drop(gone,"hanging");
    }
  }
  // ---- the robot frame: up, the floor and the centre, from the wheels ----
  let frame=null, bbox={min:mn.slice(),max:mx.slice()};
  if(typeof robotFrame==="function"){
    say("finding the floor and the front …");
    const F=robotFrame({solids, bbox:{min:mn.slice(),max:mx.slice()}},{up:opts.up, shift:opts.shift});
    bbox=applyFrame(F,{points:P, solids, placements:[], bbox:{min:mn.slice(),max:mx.slice()}});
    frame=frameRecord(F);
    // a part wholly below the wheels' floor was never placed: Onshape leaves an insert
    // that nothing mates at the origin, and an export carries it there. Not on the robot.
    if(F.wheels>=2){
      const gone=new Set(solids.filter(s=>s.pts.length&&s.pts.every(q=>q[2]<-0.02)));
      if(gone.size&&gone.size<solids.length/2){ drop(gone,"floor"); bbox={min:mn.slice(),max:mx.slice()}; }
    }
  }
  // ---- the joints as mates, limits, relations; what the export couldn't say as hints ----
  const features=[], limitsOut=[], byJName=new Map();
  J.forEach((j,k)=>{
    if(!W.has(j.child)||!W.has(j.parent)) return;
    const mateType=isTurn(j.type)?"REVOLUTE":j.type==="prismatic"?"SLIDER":j.type==="planar"?"PLANAR":j.type==="floating"?"BALL":"FASTENED";
    const z=j.axis, x0=Math.abs(z[0])<0.9?[1,0,0]:[0,1,0], d=x0[0]*z[0]+x0[1]*z[1]+x0[2]*z[2];
    let x=[x0[0]-d*z[0],x0[1]-d*z[1],x0[2]-d*z[2]]; const Lx=Math.hypot(x[0],x[1],x[2])||1; x=x.map(v=>v/Lx);
    const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
    // the joint frame sits at the child's origin, z along the axis, in the world; then in each end's own frame
    const Jw={r:[[x[0],y[0],z[0]],[x[1],y[1],z[1]],[x[2],y[2],z[2]]], t:W.get(j.child).t.slice()};
    const inChild=urdfMul(urdfInv(W.get(j.child)),Jw), inParent=urdfMul(urdfInv(W.get(j.parent)),Jw);
    const cs=A=>({origin:A.t, xAxis:[A.r[0][0],A.r[1][0],A.r[2][0]], yAxis:[A.r[0][1],A.r[1][1],A.r[2][1]], zAxis:[A.r[0][2],A.r[1][2],A.r[2][2]]});
    const id="J"+k; byJName.set(j.name,id); j.fid=id;
    features.push({id, suppressed:false, featureType:"mate", featureData:{name:j.name, mateType, matedEntities:[{matedOccurrence:[j.parent],matedCS:cs(inParent)},{matedOccurrence:[j.child],matedCS:cs(inChild)}]}});
    if(j.lo!=null||j.hi!=null){ const linr=mateType==="SLIDER", q=v=>linr?(v*1000)+" mm":(v*180/Math.PI)+" deg";
      limitsOut.push({message:{featureId:id,name:j.name,parameters:[{message:{parameterId:"limitsEnabled",value:true}},
        {message:{parameterId:linr?"limitAxialZMin":"limitRotationMin",expression:q(j.lo||0)}},{message:{parameterId:linr?"limitAxialZMax":"limitRotationMax",expression:q(j.hi||0)}}]}}); }
  });
  for(const j of J){ if(!j.mimic||!j.fid) continue; const leader=byJName.get(j.mimic.joint); if(!leader) continue;
    features.push({id:"R"+j.fid,suppressed:false,featureType:"mateRelation",featureData:{name:"mimic "+j.mimic.joint,relationType:"LINEAR",mates:[{featureId:leader},{featureId:j.fid}],relationRatio:j.mimic.ratio,reverseDirection:false}}); }
  const hints=urdfHintsFromRecords(J,W);
  const asm={rootAssembly:{documentId:"URDF",elementId:"EROOT",configuration:"default",fullConfiguration:"default",documentMicroversion:"MV",instances,occurrences,features,patterns:[]},subAssemblies,parts:[]};
  // ---- the CAD, in the robot frame, with the mates as joints ----
  solids.sort((a,b)=>b.size-a.size);
  const counts=new Map();
  for(const s of solids){ const e=counts.get(s.name)||{name:s.name,part:s.part,n:0,kind:"struct"}; e.n++; counts.set(s.name,e); }
  const parts=[...counts.values()].map(e=>{ const hw=typeof hwFromPart==="function"?hwFromPart(e.part,e.name):null; return Object.assign(e,{kind:hw?hw.kind:"struct"}); });
  const why=[];
  if(missing.size) why.push(missing.size+" mesh file(s) named in the URDF weren't in the zip: "+[...missing].slice(0,5).join(", ")+(missing.size>5?" …":""));
  if(collapsed) why.push(collapsed+" connector link"+(collapsed===1?"":"s")+" (a planar or cylindrical mate written as a chain, a loop closure) folded into single joints"+
    (held?"; "+held+" of them planar or parallel mates or loop closures, left free (not a joint, not a fastening)":"")+".");
  why.push(shapes.length+" unique shapes placed "+solids.length+" times, thinned from "+(triBefore/1e6).toFixed(1)+" M to "+(triAfter/1e6).toFixed(2)+" M triangles.");
  if(stray.length) why.push(stray.length+" part"+(stray.length===1?" was":"s were")+" never mated to the robot and "+(stray.length===1?"sits":"sit")+" away from it (below the wheels, or off to one side, where "+(stray.length===1?"it was":"they were")+" inserted), so "+(stray.length===1?"it is":"they are")+" left off: "+[...new Set(stray)].slice(0,4).join(", ")+(new Set(stray).size>4?" …":"")+".");
  if(kgParts) why.push("Mass from the export: "+kgSum.toFixed(2)+" kg over "+kgParts+" of "+solids.length+" parts"+(kgParts<solids.length*0.7?" (parts with no material weigh nothing there; those are weighed by their shape instead)":"")+".");
  const cad={name:name||robot.attrs.name||"URDF robot", units:"METRE", points:P, pointCount:P.length, solids, bbox, parts, mechs:[], placements:[], frame, occs:[],
    source:"urdf", shapes, onshape:{url:null, parts:solids.length, withShape:solids.length, kg:kgParts?kgSum:null, kgParts, why}};
  say("the joints …");
  const rep=applyOnshapeMates(cad,asm,{features:{features:limitsOut}});
  cad.onshape.report=rep; cad.onshape.why=why.concat(rep.why||[]);
  urdfApplyHints(cad,hints);
  cad.urdf={links:links.length, joints:jEls.length, collapsed, shapes:shapes.length, triangles:triAfter, trianglesBefore:triBefore, missing:[...missing], parts:solids.length, stray};
  return cad;
}
/* the coupling hints (see urdfCoupleHints) from joint records: {type, parent, child, axis(world)} */
function urdfHintsFromRecords(J,W){
  const par=(a,b)=>Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])>0.985;
  const R=J.filter(j=>j.fid).map(j=>({id:j.fid, type:j.type, parent:j.parent, child:j.child, axis:j.axis, pivot:W.get(j.child).t, mimic:!!j.mimic}));
  const out=[], byChild=new Map(R.map(j=>[j.child,j]));
  for(const j of R){
    if(j.type!=="prismatic"||j.mimic) continue;
    let root=j, up=byChild.get(j.parent), n=0;
    while(up&&n++<12){ if(up.type==="prismatic"&&par(up.axis,j.axis)) root=up; else if(up.type!=="fixed") break; up=byChild.get(up.parent); }
    if(root!==j) out.push({leader:root.id, follower:j.id, ratio:1, via:"cascade"});
  }
  const rev=R.filter(j=>(j.type==="revolute"||j.type==="continuous")&&!j.mimic);
  for(let a=0;a<rev.length;a++) for(let b=a+1;b<rev.length;b++){
    const A=rev[a], B=rev[b];
    if(A.parent!==B.parent||!par(A.axis,B.axis)) continue;
    // two free-spinning bearings side by side aren't a gear pair; a claw's fingers have limits
    if(A.type==="continuous"&&B.type==="continuous") continue;
    const d=Math.hypot(A.pivot[0]-B.pivot[0],A.pivot[1]-B.pivot[1],A.pivot[2]-B.pivot[2]);
    if(d>0.08||d<0.005) continue;
    if(rev.some(j=>j!==A&&j!==B&&j.parent===A.parent&&par(j.axis,A.axis))) continue;
    const same=A.axis[0]*B.axis[0]+A.axis[1]*B.axis[1]+A.axis[2]*B.axis[2]>0;
    out.push({leader:A.id, follower:B.id, ratio:same?-1:1, via:"gear"});
  }
  return out;
}
/* The exact surfaces of a URDF robot for the view, in the same shape the STEP
   route's tessExpand gives: one mesh entry per placed copy, the shape's arrays
   shared, T placing the copy; solidOf says which part each is. */
function urdfExact(cad){
  if(!cad||!cad.shapes) return null;
  const meshes=[], solidOf=[], root={name:"", children:[], meshes:[]};
  cad.solids.forEach((s,i)=>{
    if(!s.shapes||!s.shapes.length) return;
    const leaf={name:s.name, children:[], meshes:[]}; root.children.push(leaf);
    for(const k of s.shapes){ const S=cad.shapes[k]; if(!S||!S.idx||!S.idx.length) continue;
      leaf.meshes.push(meshes.length); solidOf.push(i);
      meshes.push({name:s.name, color:S.color, attributes:{position:{array:S.pos}}, index:{array:S.idx}, T:s.occT, shape:S}); }
  });
  return {success:true, meshes, root, solidOf, perShape:true, shapes:cad.shapes.length, failedShapes:0};
}
/* A robot export's zip, read whole: {cad} or, with no .urdf, {entries} (the team's code, perhaps). */
async function urdfRobotFromZip(buf,name,opts){
  opts=opts||{};
  // entries stay zipped until a mesh is read, so a half-gigabyte export never sits unpacked in memory
  const entries=await zipEntries(buf,{lazy:true});
  let urdf=entries.find(e=>/\.urdf$/i.test(e.name));
  if(!urdf) for(const e of entries) if(/\.xml$/i.test(e.name)&&e.size<4e6){ const d=await zipRead(e); if(/<robot[\s>]/.test(new TextDecoder().decode(d.subarray(0,4000)))){ urdf=e; break; } }
  if(!urdf){ for(const e of entries) e.data=await zipRead(e); return {entries, cad:null}; }
  const files={}; for(const e of entries) if(e!==urdf&&/\.(stl|glb|gltf|obj|bin|mtl)$/i.test(e.name)) files[e.name]=e;
  const text=new TextDecoder().decode(await zipRead(urdf));
  const robotName=String(name||urdf.name).replace(/^.*[\\/]/,"").replace(/\.(zip|urdf)$/i,"");
  const cad=await urdfRobot(text,files,robotName,opts);
  return {entries:null, cad};
}
