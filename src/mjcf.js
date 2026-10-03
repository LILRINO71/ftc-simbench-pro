/* ============================================================
   MJCF → THE SAME ROBOT AN ONSHAPE IMPORT GIVES
   ------------------------------------------------------------
   MuJoCo's model format is what onshape-to-robot and ACDC4Robot write when
   asked for something richer than URDF: on top of a tree of bodies and
   joints it carries equality constraints, which is how it says a gear
   couples two joints (<joint joint1 joint2 polycoef>) and where a linkage
   closes its loop (<connect>). Like a URDF (src/urdf.js) it's translated
   into the bookmark's payload: each body a part, each joint a mate between
   it and its parent, a joint equality a mate relation, a connect a mate
   that closes a loop. One builder makes the robot (src/onshapecad.js).

   Read: <compiler angle eulerseq meshdir>, nested <default> classes for
   joint and geom (class / childclass), bodies placed by pos with quat,
   euler, axisangle, xyaxes or zaxis, hinge and slide joints with range and
   limited, inertial mass, box / cylinder / sphere / capsule / mesh geoms
   (STL meshes dropped with the file), rgba and materials. Free joints are
   the robot itself; ball joints are kept as ball mates.
   ============================================================ */
const MJCF_FORMAT_NOTE="MuJoCo MJCF";

function mjcfToPayload(text,files,name){
  files=files||{};
  const doc=urdfXml(text), root=doc.kids.find(k=>k.tag==="mujoco");
  if(!root) throw new Error("no <mujoco> in this file: it isn't an MJCF model");
  const comp=urdfKid(root,"compiler")||{attrs:{}};
  const deg=(comp.attrs.angle||"degree")!=="radian";               // MuJoCo's default is degrees
  const A=v=>deg?v*Math.PI/180:v;
  const seq=String(comp.attrs.eulerseq||"xyz");
  // ---- default classes: <default class="x"> nest, each holds <joint .../> and <geom .../> defaults
  const classes=new Map();
  const readDefaults=(el,parent)=>{
    const name=el.attrs.class||"main", own={joint:Object.assign({},parent&&parent.joint), geom:Object.assign({},parent&&parent.geom)};
    for(const k of el.kids){ if(k.tag==="joint"||k.tag==="geom") Object.assign(own[k.tag],k.attrs); }
    classes.set(name,own);
    for(const k of el.kids) if(k.tag==="default") readDefaults(k,own);
  };
  for(const d of urdfKids(root,"default")) readDefaults(d,null);
  const withDefaults=(el,cls)=>{ const c=classes.get(el.attrs.class||cls||"main")||classes.get("main"); return Object.assign({},c&&c[el.tag]||{},el.attrs); };
  // ---- assets: meshes (STL dropped with the file) and materials
  const meshes={}, materials={};
  for(const a of urdfKids(root,"asset")){
    for(const m of urdfKids(a,"mesh")){ const file=m.attrs.file||""; const nm=m.attrs.name||file.replace(/^.*[\\/]/,"").replace(/\.[^.]+$/,""); meshes[nm]={file, scale:urdfNums(m.attrs.scale,3,[1,1,1])}; }
    for(const m of urdfKids(a,"material")) if(m.attrs.name) materials[m.attrs.name]=urdfNums(m.attrs.rgba,3,null);
  }
  const base=s=>String(s||"").replace(/^.*[\\/]/,"").toLowerCase(), fileByBase={};
  for(const k in files) fileByBase[base(k)]=files[k];

  // ---- orientation: quat (w x y z), euler, axisangle, xyaxes, zaxis -> 3x3
  const quatR=q=>{ const [w,x,y,z]=q, n=Math.hypot(w,x,y,z)||1, a=w/n, b=x/n, c=y/n, d=z/n;
    return [[1-2*(c*c+d*d),2*(b*c-a*d),2*(b*d+a*c)],[2*(b*c+a*d),1-2*(b*b+d*d),2*(c*d-a*b)],[2*(b*d-a*c),2*(c*d+a*b),1-2*(b*b+c*c)]]; };
  const axisR=(ax,t)=>{ const n=Math.hypot(ax[0],ax[1],ax[2])||1, [x,y,z]=ax.map(v=>v/n), c=Math.cos(t), s=Math.sin(t), C=1-c;
    return [[c+x*x*C,x*y*C-z*s,x*z*C+y*s],[y*x*C+z*s,c+y*y*C,y*z*C-x*s],[z*x*C-y*s,z*y*C+x*s,c+z*z*C]]; };
  const mul3=(P,Q)=>P.map(r=>[0,1,2].map(j=>r[0]*Q[0][j]+r[1]*Q[1][j]+r[2]*Q[2][j]));
  const I3=[[1,0,0],[0,1,0],[0,0,1]];
  const orient=at=>{
    if(at.quat!=null) return quatR(urdfNums(at.quat,4,[1,0,0,0]));
    if(at.axisangle!=null){ const v=urdfNums(at.axisangle,4,[0,0,1,0]); return axisR(v.slice(0,3),A(v[3])); }
    if(at.euler!=null){ const e=urdfNums(at.euler,3,[0,0,0]).map(A); let R=I3;
      // lowercase: about the moving axes (intrinsic), multiplied on the right; uppercase: fixed axes, on the left
      for(let i=0;i<3;i++){ const ch=seq[i]||"xyz"[i], ax={x:[1,0,0],y:[0,1,0],z:[0,0,1]}[ch.toLowerCase()]||[1,0,0], Ri=axisR(ax,e[i]);
        R=ch===ch.toLowerCase()?mul3(R,Ri):mul3(Ri,R); }
      return R; }
    if(at.xyaxes!=null){ const v=urdfNums(at.xyaxes,6,[1,0,0,0,1,0]); const x=v.slice(0,3), n=Math.hypot(...x)||1, X=x.map(t=>t/n);
      let y=v.slice(3,6); const d=X[0]*y[0]+X[1]*y[1]+X[2]*y[2]; y=y.map((t,i)=>t-d*X[i]); const m=Math.hypot(...y)||1, Y=y.map(t=>t/m);
      const Z=[X[1]*Y[2]-X[2]*Y[1],X[2]*Y[0]-X[0]*Y[2],X[0]*Y[1]-X[1]*Y[0]];
      return [[X[0],Y[0],Z[0]],[X[1],Y[1],Z[1]],[X[2],Y[2],Z[2]]]; }
    if(at.zaxis!=null){ const z=urdfNums(at.zaxis,3,[0,0,1]), n=Math.hypot(...z)||1, Z=z.map(t=>t/n), c=Z[2];
      if(c>0.999999) return I3; if(c<-0.999999) return [[1,0,0],[0,-1,0],[0,0,-1]];
      const ax=[-Z[1],Z[0],0]; return axisR(ax,Math.acos(c)); }
    return I3;
  };
  const frame=at=>({r:orient(at), t:urdfNums(at.pos,3,[0,0,0])});

  // ---- the body tree, at the model's zero pose
  const world=urdfKid(root,"worldbody");
  if(!world) throw new Error("the MJCF has no <worldbody>");
  const bodies=[], byName=new Map();
  const walk=(el,parentW,parent,cls,depth)=>{
    if(depth>40) throw new Error("the MJCF nests bodies too deep");
    for(const b of urdfKids(el,"body")){
      const W=urdfMul(parentW,frame(b.attrs)), name=b.attrs.name||"body"+bodies.length, ccls=b.attrs.childclass||cls;
      const rec={el:b, name, W, parent, cls:ccls, id:"L"+bodies.length};
      bodies.push(rec); byName.set(name,rec);
      walk(b,W,rec,ccls,depth+1);
    }
  };
  walk(world,{r:I3,t:[0,0,0]},null,null,0);
  if(!bodies.length) throw new Error("the MJCF's worldbody has no bodies");
  // geometry at the world level (a floor, the field) is scenery, not robot: left out

  const instances=[], occurrences=[], geom={}, missing=new Set();
  const notes=[];
  bodies.forEach((B,i)=>{
    const tri=[]; let color=null;
    for(const g0 of urdfKids(B.el,"geom")){
      const g=withDefaults(g0,B.cls);
      // collision-only geoms (group 3 by convention, or contype on and rgba alpha 0) aren't drawn
      if(g.group!=null&&+g.group===3) continue;
      const O=frame(g), type=g.type||(g.mesh?"mesh":"sphere");
      let T=[];
      if(type==="mesh"){
        const m=meshes[g.mesh]; if(!m){ missing.add(String(g.mesh)); continue; }
        if(!/\.stl$/i.test(m.file)){ missing.add(base(m.file)+" (only STL is read)"); continue; }
        const f=fileByBase[base(m.file)]; if(!f){ missing.add(base(m.file)); continue; }
        T=urdfStl(f); for(let k=0;k<T.length;k+=3){ T[k]*=m.scale[0]; T[k+1]*=m.scale[1]; T[k+2]*=m.scale[2]; }
      }else{
        const s=urdfNums(g.size,3,null)||urdfNums(g.size,2,null)||urdfNums(g.size,1,[0.01]);
        if(g.fromto!=null&&(type==="cylinder"||type==="capsule")){
          // a cylinder from one point to another: its own frame along the segment
          const ft=urdfNums(g.fromto,6,[0,0,0,0,0,0.01]), a=ft.slice(0,3), b=ft.slice(3,6), d=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], L=Math.hypot(...d)||0.001;
          const z=d.map(v=>v/L), c=z[2], R=c>0.999999?I3:c<-0.999999?[[1,0,0],[0,-1,0],[0,0,-1]]:axisR([-z[1],z[0],0],Math.acos(c));
          O.r=R; O.t=[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
          T=urdfPrim({tag:"cylinder", attrs:{radius:s[0], length:L}});
        }
        else if(type==="box") T=urdfPrim({tag:"box", attrs:{size:[2*s[0],2*(s[1]!=null?s[1]:s[0]),2*(s[2]!=null?s[2]:s[0])].join(" ")}});
        else if(type==="cylinder"||type==="capsule") T=urdfPrim({tag:"cylinder", attrs:{radius:s[0], length:2*(s[1]!=null?s[1]:s[0])}});
        else if(type==="sphere"||type==="ellipsoid") T=urdfPrim({tag:"sphere", attrs:{radius:s[0]}});
        else continue;                                           // planes, hfields: scenery
      }
      for(let k=0;k<T.length;k+=3){ const q=urdfPt(O,[T[k],T[k+1],T[k+2]]); tri.push(q[0],q[1],q[2]); }
      if(!color){ const rgba=g.rgba!=null?urdfNums(g.rgba,3,null):(g.material&&materials[g.material])||null; if(rgba) color=rgba; }
    }
    const inertial=urdfKid(B.el,"inertial"), kg=inertial?+inertial.attrs.mass:NaN;
    const key="MJCF/m/MV/e/E"+i+"|default";
    geom[key]={parts:{["P"+i]:{name:B.name, tri, color}}, mass:Number.isFinite(kg)&&kg>0?{["P"+i]:{kg}}:{}};
    instances.push({id:B.id, name:B.name, type:"Part", suppressed:false, documentId:"MJCF", elementId:"E"+i, configuration:"default", documentMicroversion:"MV", partId:"P"+i});
    occurrences.push({path:[B.id], transform:urdfT16(B.W), fixed:!B.parent, hidden:false});
  });

  // ---- joints: each in its child body, at its pos along its axis (body frame)
  const features=[], limitsOut=[], fidOfJoint=new Map();
  const cs=Mx=>({origin:Mx.t, xAxis:[Mx.r[0][0],Mx.r[1][0],Mx.r[2][0]], yAxis:[Mx.r[0][1],Mx.r[1][1],Mx.r[2][1]], zAxis:[Mx.r[0][2],Mx.r[1][2],Mx.r[2][2]]});
  const jointFrame=(axis,pos)=>{ const L=Math.hypot(...axis)||1, z=axis.map(v=>v/L), x0=Math.abs(z[0])<0.9?[1,0,0]:[0,1,0], d=x0[0]*z[0]+x0[1]*z[1]+x0[2]*z[2];
    let x=[x0[0]-d*z[0],x0[1]-d*z[1],x0[2]-d*z[2]]; const Lx=Math.hypot(...x); x=x.map(v=>v/Lx);
    const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
    return {r:[[x[0],y[0],z[0]],[x[1],y[1],z[1]],[x[2],y[2],z[2]]], t:pos}; };
  let k=0;
  for(const B of bodies){
    const js=urdfKids(B.el,"joint").map(j=>withDefaults(j,B.cls)).concat(urdfKids(B.el,"freejoint").map(()=>({type:"free"})));
    const real=js.filter(j=>(j.type||"hinge")!=="free");
    if(!B.parent){ if(real.length) notes.push("\""+B.name+"\" is the robot's root and has a joint to the world; the robot is taken as its root."); continue; }
    if(real.length>1) notes.push("\""+B.name+"\" has "+real.length+" joints to its parent; only the first is read.");
    const j=real[0];
    const type=j?(j.type||"hinge"):"fixed";
    const mateType=type==="hinge"?"REVOLUTE":type==="slide"?"SLIDER":type==="ball"?"BALL":"FASTENED";
    const Jc=jointFrame(urdfNums(j&&j.axis,3,[0,0,1]),urdfNums(j&&j.pos,3,[0,0,0]));
    const inWorld=urdfMul(B.W,Jc), inParent=urdfMul(urdfInv(B.parent.W),inWorld);
    const id="J"+(k++), nm=(j&&j.name)||(B.name+" joint");
    features.push({id, suppressed:false, featureType:"mate", featureData:{name:nm, mateType, matedEntities:[
      {matedOccurrence:[B.parent.id], matedCS:cs(inParent)}, {matedOccurrence:[B.id], matedCS:cs(Jc)}]}});
    if(j&&j.name) fidOfJoint.set(j.name,id);
    const lim=j&&j.range!=null&&String(j.limited||"auto")!=="false"?urdfNums(j.range,2,null):null;
    if(lim&&(type==="hinge"||type==="slide")){
      const lin=type==="slide", q=v=>lin?(v*1000)+" mm":(A(v)*180/Math.PI)+" deg";
      // both spellings: Onshape's own (limitZ* on a slider, limitAxialZ* on a turn) and the bench's older one
      const P=lin?[["limitZMin",lim[0]],["limitZMax",lim[1]],["limitAxialZMin",lim[0]],["limitAxialZMax",lim[1]]]:[["limitAxialZMin",lim[0]],["limitAxialZMax",lim[1]]];
      limitsOut.push({message:{featureId:id, name:nm, parameters:[{message:{parameterId:"limitsEnabled",value:true}}].concat(P.map(([p,v])=>({message:{parameterId:p, expression:q(v)}})))}});
    }
  }
  // ---- equality constraints: joint couplings, and loops closed by connect
  for(const eq of urdfKids(root,"equality")) for(const e of eq.kids){
    if(e.tag==="joint"){
      const f1=fidOfJoint.get(e.attrs.joint1), f2=fidOfJoint.get(e.attrs.joint2);
      if(!f1||!f2){ notes.push("A joint equality names \""+(e.attrs.joint1||"?")+"\" and \""+(e.attrs.joint2||"?")+"\"; one isn't a joint here."); continue; }
      // joint1 = c0 + c1 joint2 (+ higher terms, which a gear or cascade doesn't have)
      const c=urdfNums(e.attrs.polycoef,5,null)||urdfNums(e.attrs.polycoef,2,[0,1]);
      features.push({id:"R"+features.length, suppressed:false, featureType:"mateRelation", featureData:{name:"equality "+e.attrs.joint1, relationType:"LINEAR",
        mates:[{featureId:f2},{featureId:f1}], relationRatio:c[1], reverseDirection:false}});
      if(c[0]) notes.push("\""+e.attrs.joint1+"\" follows \""+e.attrs.joint2+"\" with an offset of "+c[0]+"; the offset is left out.");
    }else if(e.tag==="connect"){
      const b1=byName.get(e.attrs.body1), b2=e.attrs.body2?byName.get(e.attrs.body2):null;
      if(!b1||!b2){ notes.push("A connect constraint names a body that isn't here; it's left out."); continue; }
      const anchor=urdfNums(e.attrs.anchor,3,[0,0,0]);           // in body1's frame
      const W1={r:I3, t:anchor}, inW=urdfMul(b1.W,W1), in2=urdfMul(urdfInv(b2.W),inW);
      features.push({id:"C"+features.length, suppressed:false, featureType:"mate", featureData:{name:"connect "+b1.name+"-"+b2.name, mateType:"BALL", matedEntities:[
        {matedOccurrence:[b1.id], matedCS:cs(W1)}, {matedOccurrence:[b2.id], matedCS:cs(in2)}]}});
    }
  }
  const asm={rootAssembly:{documentId:"MJCF",elementId:"EROOT",configuration:"default",fullConfiguration:"default",documentMicroversion:"MV",instances,occurrences,features,patterns:[]},subAssemblies:[],parts:[]};
  if(missing.size) notes.unshift("Meshes not found with the MJCF (drop them together): "+[...missing].slice(0,6).join(", "));
  return {format:typeof ONSHAPE_FORMAT==="string"?ONSHAPE_FORMAT:"ftc-simbench.onshape", name:name||root.attrs.model||"MJCF robot", url:"", asm, features:{features:limitsOut}, geom, notes, from:"mjcf"};
}
/* The robot itself */
function cadFromMjcf(text,files,opts){
  const p=mjcfToPayload(text,files,opts&&opts.name);
  const cad=cadFromOnshape(p,opts);
  cad.source="mjcf";
  if(p.notes.length) cad.onshape.why=p.notes.concat(cad.onshape.why||[]);
  return cad;
}
