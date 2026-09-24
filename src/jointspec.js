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

const {applyJointSpec, jointSpecSelect, followQ, linkPin, sliderCrank, rodAngle, jointValues, mateJointQ}=(function(){
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
  return {applyJointSpec, jointSpecSelect, followQ, linkPin, sliderCrank, rodAngle, jointValues, mateJointQ};
})();
