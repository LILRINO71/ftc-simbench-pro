/* ============================================================
   JOINT SPECS — a robot's joints, written down
   Onshape mates are the best source of joints (src/mates.js), but a team
   doesn't always have them: the CAD came from someone else, the assembly
   was never mated, or a linkage was left loose and drawn half-folded.
   A joint spec says the same things by hand, once, in a small JSON file
   that lives next to the robot:
     - which parts ride on each joint (picked by name, path and position)
     - the joint's axis and pivot in the robot frame, and its travel
     - which device drives it, and how the code's numbers map to motion:
       encoder ticks per turn, millimetres per tick, the servo position
       the CAD was drawn at
     - how one joint drives another: a cascade stage, a gear pair, or a
       slider-crank linkage (a servo arm pushing a slide through a rod)
     - a drawn-pose fix for a part the CAD left in an impossible spot
   It lands on the same mechanisms a mate import makes, so the sim, the
   Checks and the view treat both alike.

   Units on file: millimetres and degrees, in the robot frame the bench
   uses for every CAD (src/frame.js: +z up, origin at the drivetrain
   centre on the floor). Axes follow the code's own sign: a joint turns
   right-handed about its axis, or slides along it, as the value the
   OpMode sends goes up — after any setDirection(REVERSE) in the code.
   ============================================================ */
const JOINT_SPEC_FORMAT="ftc-sim-bench.joints";

const {applyJointSpec, jointSpecSelect, followQ, linkPin, sliderCrank, rodAngle, jointValues, mateJointQ, specFromCad, suggestJoint}=(function(){
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{ const n=Math.hypot(a[0],a[1],a[2]); return n>1e-12?mul(a,1/n):[0,0,1]; };
  const mm=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)?v.map(x=>x/1000):null;
  const DEG=Math.PI/180;
  // v turned by t radians, right-handed about the unit axis a (Rodrigues)
  const turn=(v,a,t)=>{ const c=Math.cos(t), s=Math.sin(t), k=dot(a,v)*(1-c), x=cross(a,v);
    return [v[0]*c+x[0]*s+a[0]*k, v[1]*c+x[1]*s+a[1]*k, v[2]*c+x[2]*s+a[2]*k]; };

  /* ---- the linkage: a crank on a servo, a rod, a slide ----
     L = {crankPivot, crankAxis, crankPin, pin, slideAxis, rod} in metres:
     the crank turns about crankAxis through crankPivot; crankPin is where
     the rod meets it and pin where the rod meets the slide, both as drawn;
     the slide runs along slideAxis. */
  function linkPin(L,q){ return add(L.crankPivot, turn(sub(L.crankPin,L.crankPivot), L.crankAxis, q)); }
  /* How far the slide has moved along its axis with the crank at q (as
     drawn: 0). Of the two places the rod can put the slide, the one it was
     drawn at; null where the rod can't reach at all. */
  function sliderCrank(L,q){
    const w=sub(linkPin(L,q),L.pin), ws=dot(w,L.slideAxis);
    const disc=ws*ws-dot(w,w)+L.rod*L.rod;
    if(disc<0) return null;
    const side=dot(sub(L.crankPin,L.pin),L.slideAxis)>0?-1:1;
    return ws+side*Math.sqrt(disc);
  }
  /* The rod's own turn about its axis (a, through the slide pin) from the
     way it was drawn, with the crank at q and the slide moved e along. */
  function rodAngle(L,q,e,a){
    const u=sub(L.crankPin,L.pin), w=sub(linkPin(L,q),add(L.pin,mul(L.slideAxis,e)));
    return Math.atan2(dot(a,cross(u,w)),dot(u,w));
  }
  /* A follower's value from the joints that drive it. get(id) is a joint's
     drawn value — radians for a turn, metres for a slide — or null. */
  function followQ(m,get){
    const c=m.couple; if(!c) return null;
    const q=get(c.to); if(q==null) return null;
    const L=c.link;
    if(!L) return q*(Number.isFinite(c.ratio)?c.ratio:1);
    if(c.via==="slider-crank") return sliderCrank(L,q);
    if(c.via==="rod"){ const e=get(L.slider); return rodAngle(L,q,e==null?0:e,m.axis); }
    return null;
  }
  /* A measured joint's value (a mate, or a spec) from its device: metres
     along a slide, radians about a turn, inside its limits, plus any
     drawn-pose fix. The same numbers the sim stops it at (src/sim.js) and
     the view draws (mechPose). s.revs is the gearmotor's output shaft;
     m.gear is output turns per joint turn. */
  function mateJointQ(m,s,size){
    const lin=normJointKind(m.kind)==="linear", travel=s.act-s.restPos;
    let q=lin?(s.kind==="motor"?(+s.ticks||0)*slideMmPerTick(m,s.tpr)/1000:travel*(m.lever||(size||0.5)*0.3))
             :(s.kind==="motor"?(+s.revs||0)/(+m.gear>0?+m.gear:1)*2*Math.PI:travel*(s.travelDeg||300)*DEG);
    q*=(m.dir||1);
    const L=m.limits;
    if(L) q=Math.max(Number.isFinite(L[0])?L[0]:-Infinity, Math.min(Number.isFinite(L[1])?L[1]:Infinity, q));
    return lin?q:q+(m.q0||0);
  }
  /* Every joint's drawn value, followers worked out from their leaders in
     whatever order they come. own(m) gives a driven joint's value or null. */
  function jointValues(mechs,own){
    const byId=new Map((mechs||[]).map(m=>[m.id,m])), out=new Map();
    const get=id=>{
      if(out.has(id)) return out.get(id);
      const m=byId.get(id); if(!m) return null;
      out.set(id,null);                           // a loop of followers reads as "not moving"
      let v=own(m);
      if(v==null&&m.couple) v=followQ(m,get);
      out.set(id,v); return v;
    };
    for(const m of mechs||[]) get(m.id);
    return out;
  }

  /* ---- picking parts ----
     A selector keeps the parts that pass every test it has:
       in:   a regular expression on the part's place in the assembly,
             "Sub/Sub/Part name" (case-insensitive)
       not:  the same, to leave parts out
       x, y, z: [lo, hi] millimetres, the part's centre in the robot frame
       solid: [indices], exact parts (for a spec written against one file) */
  function partInfo(cad){
    const occ=new Map();
    for(const o of cad.occs||[]) if(o.solid>=0&&!occ.has(o.solid)) occ.set(o.solid,o);
    return (cad.solids||[]).map((s,i)=>{
      const o=occ.get(i), path=o?o.path.map(p=>p.n).concat(o.name||s.name||"").join("/"):(s.name||"");
      const c=[0,0,0]; for(const p of s.pts||[]){ c[0]+=p[0]; c[1]+=p[1]; c[2]+=p[2]; }
      const n=(s.pts||[]).length||1;
      return {i, path, c:c.map(v=>v/n*1000)};
    });
  }
  const rx=(s,why)=>{ try{ return new RegExp(s,"i"); }catch(e){ throw new Error(why+": "+e.message); } };
  function jointSpecSelect(cad,sel,info){
    info=info||partInfo(cad);
    const inR=sel.in!=null?rx(sel.in,"bad \"in\" pattern"):null, notR=sel.not!=null?rx(sel.not,"bad \"not\" pattern"):null;
    const box=[sel.x,sel.y,sel.z].map(r=>Array.isArray(r)&&r.length===2?r:null);
    const only=Array.isArray(sel.solid)?new Set(sel.solid):null;
    return info.filter(p=>(!only||only.has(p.i))&&(!inR||inR.test(p.path))&&!(notR&&notR.test(p.path))&&
      box.every((r,k)=>!r||(p.c[k]>=r[0]&&p.c[k]<=r[1]))).map(p=>p.i);
  }

  /* ---- the spec -> the bench's mechanisms ---- */
  function applyJointSpec(cad,spec){
    if(!spec||spec.format!==JOINT_SPEC_FORMAT) throw new Error("not a joint spec (format "+JOINT_SPEC_FORMAT+")");
    const joints=Array.isArray(spec.joints)?spec.joints:[];
    const ids=new Set(), why=[];
    for(const j of joints){
      if(!j||typeof j.id!=="string"||!j.id) throw new Error("every joint needs an id");
      if(ids.has(j.id)) throw new Error("two joints are called \""+j.id+"\"");
      ids.add(j.id);
    }
    const info=partInfo(cad), solids=cad.solids||[];
    for(const s of solids) delete s.mech;         // a spec or mates applied before this one
    // parts: a later joint's pick wins, so a child can take parts out of its parent's
    const owner=new Array(solids.length).fill(null);
    for(const j of joints) for(const sel of j.parts||[]){
      const got=jointSpecSelect(cad,sel,info);
      if(!got.length) why.push("\""+j.id+"\": a part pick matched nothing ("+JSON.stringify(sel)+").");
      for(const i of got) owner[i]=j.id;
    }
    // hand fixes last (the joint editor writes these): these parts ride this joint, or the frame
    if(Number.isFinite(spec.solids)&&spec.solids!==solids.length)
      why.push("This spec was written for a STEP with "+spec.solids+" parts; this one has "+solids.length+", so parts picked by number may be off.");
    for(const a of Array.isArray(spec.assign)?spec.assign:[]){
      const to=a&&a.joint==="chassis"?null:(a&&ids.has(a.joint)?a.joint:undefined);
      if(to===undefined){ why.push("A hand fix names \""+(a&&a.joint)+"\", which isn't a joint here."); continue; }
      for(const sel of a.parts||[]) for(const i of jointSpecSelect(cad,sel,info)) owner[i]=to;
    }
    const mechs=[], byId=new Map();
    for(const j of joints){
      const lin=/^(slider|linear|prismatic)$/i.test(j.kind||"");
      const axis=unit(Array.isArray(j.axis)?j.axis:[0,0,1]);
      const pivot=mm(j.pivot)||[0,0,0];
      const parent=j.parent&&ids.has(j.parent)?j.parent:"chassis";
      if(j.parent&&j.parent!=="chassis"&&!ids.has(j.parent)) why.push("\""+j.id+"\" hangs from \""+j.parent+"\", which isn't a joint here; it hangs from the chassis.");
      const vertical=Math.abs(axis[2])>0.7;
      const members=owner.map((o,i)=>o===j.id?i:-1).filter(i=>i>=0);
      const cen=s=>{ const c=[0,0,0]; for(const p of s.pts) { c[0]+=p[0]; c[1]+=p[1]; c[2]+=p[2]; } return c.map(v=>v/(s.pts.length||1)); };
      const m={id:j.id, label:j.label||j.id, alias:j.label||j.id,
        kind:lin?"linear":(vertical?"revolute-yaw":"revolute-lift"),
        axis, pivot, dir:1, parent, part:j.part||null, partName:j.partName||null,
        hasActuator:!!(j.device||j.part), inferred:false, manual:false, leverOverride:null,
        cluster:members.map(i=>cen(solids[i])),
        fromMate:{name:j.label||j.id, type:lin?"SLIDER":"REVOLUTE", id:"spec:"+j.id}};
      if(Array.isArray(j.limits)&&j.limits.length===2)
        m.limits=j.limits.map(v=>Number.isFinite(v)?(lin?v/1000:v*DEG):null);
      if(Number.isFinite(j.mmPerTick)&&j.mmPerTick>0) m.mmPerTick=j.mmPerTick;
      if(Number.isFinite(j.gear)&&j.gear>0) m.gear=j.gear;
      if(Number.isFinite(j.restPos)) m.restPos=Math.max(0,Math.min(1,j.restPos));
      if(Number.isFinite(j.offsetDeg)&&j.offsetDeg) m.q0=j.offsetDeg*DEG;
      if(j.note) m.note=String(j.note);
      mechs.push(m); byId.set(m.id,m);
      for(const i of members) solids[i].mech=m.id;
    }
    // what drives what: a ratio, or a linkage through a rod
    for(const j of joints){
      const f=j.follows; if(!f) continue;
      const m=byId.get(j.id), L=f.joint&&byId.get(f.joint);
      if(!L){ why.push("\""+j.id+"\" follows \""+(f.joint||"?")+"\", which isn't a joint here."); continue; }
      if(f.linkage==="slider-crank"||f.linkage==="rod"){
        const link={crankPivot:L.pivot, crankAxis:L.axis, crankPin:mm(f.crankPin), pin:mm(f.pin), rod:0,
          slideAxis:unit(Array.isArray(f.slideAxis)?f.slideAxis:(f.linkage==="slider-crank"?m.axis:[1,0,0]))};
        if(f.linkage==="rod"){
          const S=f.slider&&byId.get(f.slider);
          if(!S){ why.push("\""+j.id+"\" is a rod on slide \""+(f.slider||"?")+"\", which isn't a joint here."); continue; }
          link.slider=S.id; link.slideAxis=S.axis;
        }
        if(!link.crankPin||!link.pin){ why.push("\""+j.id+"\": a linkage needs crankPin and pin."); continue; }
        link.rod=Math.hypot(...sub(link.crankPin,link.pin));
        m.couple={to:L.id, ratio:1, via:f.linkage, link};
      }else m.couple={to:L.id, ratio:Number.isFinite(f.ratio)?f.ratio:1, via:f.via||"ratio"};
    }
    // reach: everything a joint carries, itself and downstream
    const kids=id=>mechs.filter(k=>k.parent===id);
    for(const m of mechs){
      const all=[]; const walk=x=>{ all.push(...x.cluster); for(const k of kids(x.id)) walk(k); }; walk(m);
      const c=all.length?[0,1,2].map(k=>all.reduce((s,p)=>s+p[k],0)/all.length):m.pivot.slice();
      m.distalTo=c; m.lever=Math.hypot(...sub(c,m.pivot));
    }
    const devices={};
    for(const j of joints) for(const d of [].concat(j.device||[])) if(typeof d==="string"&&d) devices[d]=j.id;
    const used=owner.filter(Boolean).length;
    why.unshift(mechs.length+" joints from "+(spec.robot||"the joint spec")+"; "+used+" of "+solids.length+" parts ride on them, the rest are the frame.");
    const drives=(cad.mechs||[]).filter(m=>m.drive);
    cad.mechs=mechs.concat(drives);
    cad.mates={source:"spec", name:spec.robot||null, joints:mechs.length, matched:used, parts:solids.length, loops:0, why};
    return {report:cad.mates, devices, front:typeof spec.front==="string"?spec.front:null};
  }
  /* ---- the joint editor's helpers ----
     Whatever joints a robot has now (guessed, from mates, from a spec) as a
     spec the editor can change: each joint with its exact parts by number.
     group[i] is the joint part i rides, or "chassis"; devices maps code
     device names to joints. Numbers in mm and degrees, as on file. */
  function specFromCad(cad,group,devices){
    const r3=v=>v.map(x=>+(x*1000).toFixed(2)), mechs=((cad&&cad.mechs)||[]).filter(m=>!m.drive&&m.kind!=="fixed");   // a "fixed" group is frame, not a joint
    const joints=mechs.map(m=>{
      const k=normJointKind(m.kind), lin=k==="linear", own=[];
      (group||[]).forEach((g,i)=>{ if(g===m.id) own.push(i); });
      // a guessed joint moves by dir, and a lift the other way about its axis
      // (mechPose); written down, the axis carries that so nothing changes
      const sg=m.fromMate?1:(m.dir||1)*(k==="revolute-lift"?-1:1);
      const j={id:m.id, label:m.label||m.id, kind:lin?"slider":"revolute", axis:(m.axis||[0,0,1]).map(v=>+(v*sg).toFixed(5)),
        pivot:r3(m.pivot||[0,0,0]), parts:own.length?[{solid:own}]:[]};
      if(m.parent&&m.parent!=="chassis") j.parent=m.parent;
      if(m.part) j.part=m.part;
      if(m.limits) j.limits=m.limits.map(v=>v==null?null:+(lin?v*1000:v/DEG).toFixed(3));
      for(const k of ["mmPerTick","gear","restPos"]) if(Number.isFinite(m[k])) j[k]=m[k];
      if(Number.isFinite(m.q0)&&m.q0) j.offsetDeg=+(m.q0/DEG).toFixed(3);
      const dv=Object.keys(devices||{}).filter(d=>devices[d]===m.id); if(dv.length) j.device=dv.length===1?dv[0]:dv;
      if(m.couple&&!m.couple.link) j.follows={joint:m.couple.to, ratio:m.couple.ratio};
      else if(m.couple&&m.couple.link){ const L=m.couple.link; j.follows={joint:m.couple.to, linkage:m.couple.via, crankPin:r3(L.crankPin), pin:r3(L.pin)};
        if(L.slider) j.follows.slider=L.slider; }
      return j;
    });
    return {format:JOINT_SPEC_FORMAT, version:1, robot:(cad&&cad.name)||null, solids:((cad&&cad.solids)||[]).length, joints};
  }
  /* Where a joint made from these parts turns, or slides. A spline, a shaft
     or a pin turns about its length; a horn, a gear, a hub or a wheel about
     its thin direction; a rail slides along its length. The part that says
     most wins; with none, the selection's own shape decides. */
  function suggestJoint(cad,idx){
    const S=(cad&&cad.solids)||[], parts=(idx||[]).map(i=>S[i]).filter(s=>s&&s.pts&&s.pts.length>=4);
    if(!parts.length) return null;
    const pca=pts=>{
      const c=[0,1,2].map(k=>pts.reduce((a,p)=>a+p[k],0)/pts.length), C=[[0,0,0],[0,0,0],[0,0,0]];
      for(const p of pts) for(let a=0;a<3;a++) for(let b=0;b<3;b++) C[a][b]+=(p[a]-c[a])*(p[b]-c[b])/pts.length;
      const A=C.map(r=>r.slice()), V=[[1,0,0],[0,1,0],[0,0,1]];
      for(let sw=0;sw<40;sw++) for(let p=0;p<3;p++) for(let q=p+1;q<3;q++){
        if(Math.abs(A[p][q])<1e-18) continue;
        const th=0.5*Math.atan2(2*A[p][q],A[q][q]-A[p][p]), co=Math.cos(th), si=Math.sin(th);
        for(let k=0;k<3;k++){ const x=A[k][p], y=A[k][q]; A[k][p]=co*x-si*y; A[k][q]=si*x+co*y; }
        for(let k=0;k<3;k++){ const x=A[p][k], y=A[q][k]; A[p][k]=co*x-si*y; A[q][k]=si*x+co*y; }
        for(let k=0;k<3;k++){ const x=V[k][p], y=V[k][q]; V[k][p]=co*x-si*y; V[k][q]=si*x+co*y; }
      }
      const e=[0,1,2].map(i=>({val:Math.max(0,A[i][i]), vec:[V[0][i],V[1][i],V[2][i]]})).sort((a,b)=>b.val-a.val);
      return {c, e};
    };
    // snap an axis that is nearly a frame axis onto it, and point it the positive way
    const tidy=v=>{ v=unit(v); const k=[0,1,2].reduce((a,b)=>Math.abs(v[b])>Math.abs(v[a])?b:a,0);
      if(Math.abs(v[k])>0.995){ const s=[0,0,0]; s[k]=1; return s; } return v[k]<0?mul(v,-1):v; };
    const say=[
      {re:/spline|shaft|axle|pin\b|rex|hex shaft/i, how:"long"},
      {re:/horn|gear|hub|sprocket|pulley|disc|wheel|bearing|race/i, how:"thin"},
      {re:/slide|rail|viper|extrusion|linear/i, how:"slide"}];
    for(const t of say){
      const s=parts.find(p=>t.re.test(p.name||""));
      if(!s) continue;
      const P=pca(s.pts), ax=t.how==="thin"?P.e[2].vec:P.e[0].vec;
      return {kind:t.how==="slide"?"slider":"revolute", axis:tidy(ax), pivot:P.c, from:s.name, how:t.how};
    }
    const P=pca(parts.flatMap(s=>s.pts));
    const long=P.e[0].val>6*P.e[1].val;                // one long thing: a slide along it
    return {kind:long?"slider":"revolute", axis:tidy(long?P.e[0].vec:P.e[2].vec), pivot:P.c, from:null, how:"shape"};
  }
  return {applyJointSpec, jointSpecSelect, followQ, linkPin, sliderCrank, rodAngle, jointValues, mateJointQ, specFromCad, suggestJoint};
})();
