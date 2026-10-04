/* ============================================================
   BINDING — the code's devices onto the robot's joints, with evidence
   ------------------------------------------------------------
   A robot that arrives with its joints declared (Onshape's URDF export, its
   mates, a joint spec) still leaves two things to settle before it can run
   the team's code, and this file settles both without a form:

   1. Which joints are mechanisms at all. An FTC assembly built from the
      goBILDA and REV libraries carries a revolute mate inside every motor
      (its shaft) and every bearing (its race). Exported, they are joints
      too: a real robot came out of Onshape with 113 of them. None is a
      mechanism; asking about any of them would be the "too many questions"
      the bench is known for. classifyJoints marks them `internal` from
      what they carry: a small body, or only shafts, bearings, spacers and
      hubs, and nothing riding on it.

   2. Which device drives which mechanism. The evidence, strongest first:
        spec       the joint spec or the mates named the device
        name       the device's variable or config name matches the joint's
                   (mate name, part names, FTC synonyms: src/mapping.js)
        travel     RUN_TO_POSITION targets reach exactly one slide's length
        only-one   one servo left and one servo-sized joint left (and so on
                   for motors and slides), so there is nothing to ask
        pair       the second motor of a pair (liftLeft/liftRight) drives
                   the same joint
      The actuator on a joint's axis (src/autorig-lib.js finds every servo
      and motor output in the CAD) says what kind of device the joint takes,
      so a servo never lands on a motor's joint. Whatever is left is a
      question with its likely answers, in the team's own device names.

   bindDevices never guesses between two live candidates: a question is
   cheaper than a wrong robot shown as right.

   When the team has declared its joints (src/jointsheet.js: the mates'
   names, or a joint sheet), none of this guessing runs. The declared joints
   are the mechanisms, every other joint is held, and a device is bound only
   where a declaration names it. Everything here is pure data,
   tested in Node; src/app.js and src/importflow.js draw it.
   ============================================================ */
const BIND_RULES={
  internalExtent:0.045,          // m: a body this small turning on its own is a shaft or a bearing race
  internalNamedExtent:0.14,      // m: a body of only hardware words up to this size is internal too
  hardwareWords:/\b(bearing|shaft|axle|race|spacer|standoff|washer|collar|bushing|hub|clamp|coupler|encoder|magnet|clip|retainer|nut|bolt|screw|insert|pin|dowel|rod end|heim)\b|\bmotor\b|servo horn|horn\b/i,
  odometryWords:/odometry|odo|dead ?wheel|encoder (cvr|cover|board|mount)|encoder.*pod|pod.*encoder/i,
  travelTolerance:0.25,          // a slide's travel vs what the code asks of a motor, as a fraction
  nameScoreSure:80,              // a name match this strong is bound outright
};
const {classifyJoints, bindDevices}=(function(){
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const DEG=Math.PI/180;
  const kindOf=m=>typeof normJointKind==="function"?normJointKind(m.kind):m.kind;
  const isServoDev=d=>/servo/i.test(d.type||"")&&!/crservo/i.test(d.type||"");
  const isMotorDev=d=>/dcmotor|crservo/i.test(d.type||"");
  const label=m=>m.label||m.id;

  /* the parts a joint carries itself, and its box */
  function members(cad,m){ const out=[]; (cad.solids||[]).forEach((s,i)=>{ if(s.mech===m.id) out.push(i); }); return out; }
  function boxOf(cad,idx){
    const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
    for(const i of idx) for(const p of cad.solids[i].pts||[]) for(let k=0;k<3;k++){ if(p[k]<mn[k]) mn[k]=p[k]; if(p[k]>mx[k]) mx[k]=p[k]; }
    return Number.isFinite(mn[0])?{min:mn,max:mx,extent:Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])}:null;
  }

  /* the drive wheels' axles, once per CAD: {c, axis, r} in the CAD's own frame */
  const AXLES=new WeakMap();
  function wheelAxles(cad){
    if(!cad||typeof cad!=="object") return [];
    if(AXLES.has(cad)) return AXLES.get(cad);
    let out=[];
    try{ if(typeof driveFromCAD==="function"){ const D=driveFromCAD(cad,{}); if(D&&D.wheels&&D.wheels.length>=2) out=D.wheels.filter(w=>w.c&&w.axis).map(w=>({c:w.c, axis:w.axis, r:w.r||0.05})); } }catch(e){ out=[]; }
    AXLES.set(cad,out); return out;
  }

  /* ---- 1. which joints are mechanisms ----
     Idempotent; a joint spec or a hand edit (m.keep) is never demoted. Returns
     {internal, mechanisms, why:[…]}. */
  function classifyJoints(cad){
    const mechs=((cad&&cad.mechs)||[]).filter(m=>!m.drive&&m.kind!=="fixed");
    const byId=new Map(mechs.map(m=>[m.id,m])), kids=new Map();
    for(const m of mechs){ if(!kids.has(m.parent)) kids.set(m.parent,[]); kids.get(m.parent).push(m); }
    // everything a joint carries: its own body and every joint hanging from it. A URDF
    // export gives a bearing's inner race its own joint, and the shaft in it another; judged
    // on its own body each is a 20 mm part, judged on what it carries an arm's pivot is an arm.
    const carried=new Map();
    const subtree=(m,depth)=>{ if(carried.has(m.id)) return carried.get(m.id); const idx=members(cad,m);
      if(depth<40) for(const k of kids.get(m.id)||[]) idx.push(...subtree(k,depth+1)); carried.set(m.id,idx); return idx; };
    const spec=!!(cad.mates&&cad.mates.source==="spec");
    // the team declared its joints: those are the mechanisms, and nothing else is
    if(typeof isExact==="function"&&isExact(cad)){
      let held=0;
      for(const m of mechs){
        if(m.declared&&!m.declaredFixed){ m.internal=false; delete m.internalWhy; }
        else { m.internal=true; m.internalWhy=m.declared?"declared fixed":"undeclared"; held++; }
      }
      const n=mechs.length-held;
      return {internal:held, mechanisms:n, exact:true, why:[n+" declared joint"+(n===1?" is the mechanism":"s are the mechanisms")+"; the other "+held+" "+(held===1?"is":"are")+" held as drawn."]};
    }
    let internal=0, why=[];
    const reasons={small:0, hardware:0, coaxial:0};
    for(const m of mechs){
      if(m.declaredFixed){ m.internal=true; m.internalWhy="declared fixed"; internal++; continue; }
      if(m.keep||m.manual||spec||m.declared){ m.internal=false; continue; }
      if(m.couple){ m.internal=false; continue; }                           // it follows another joint: a mechanism
      const idx=subtree(m,0), box=boxOf(cad,idx);
      if(!idx.length||!box){ m.internal=false; continue; }                 // empty joints are the robot check's business
      const names=idx.map(i=>String(cad.solids[i].name||""));
      const allHw=names.every(n=>BIND_RULES.hardwareWords.test(n));
      if(box.extent<BIND_RULES.internalExtent){ m.internal=true; m.internalWhy="small"; reasons.small++; }
      else if(allHw&&box.extent<BIND_RULES.internalNamedExtent){ m.internal=true; m.internalWhy="hardware"; reasons.hardware++; }
      else m.internal=false;
      if(m.internal) internal++;
    }
    // a turn on a drive wheel's axle that carries nothing big is the wheel's own shaft, hub or
    // bearing: the drive, not a mechanism (a URDF export gives each of them a joint)
    const axles=wheelAxles(cad);
    if(axles.length) for(const m of mechs){
      if(m.internal||m.keep||m.manual||m.declared||spec||m.couple||kindOf(m)==="linear"||!m.axis||!m.pivot) continue;
      const box=boxOf(cad,subtree(m,0)); if(!box||box.extent>0.16) continue;
      const on=axles.some(w=>Math.abs(dot(w.axis,m.axis))>Math.cos(5*DEG)&&(()=>{ const d=sub(m.pivot,w.c), t=dot(d,w.axis);
        return Math.hypot(d[0]-w.axis[0]*t,d[1]-w.axis[1]*t,d[2]-w.axis[2]*t)<0.012&&Math.abs(t)<2.5*w.r+0.08; })());
      if(on){ m.internal=true; m.internalWhy="axle"; reasons.axle=(reasons.axle||0)+1; internal++; }
    }
    // a turn on the same axis as the turn it hangs from (the gear on the gear a servo turns,
    // a bearing's two races, a shaft in its bearing) is one motion, not two joints: the one
    // with limits stays, else the one nearer the chassis, and the other turns with it
    const lim=x=>!!(x.limits&&Number.isFinite(x.limits[0])&&Number.isFinite(x.limits[1]));
    for(const m of mechs){
      if(m.internal||m.keep||m.manual||m.declared||spec||m.couple) continue;
      const p=byId.get(m.parent); if(!p||p.internal||p.couple||p.keep||p.manual||p.declared) continue;
      if(kindOf(m)==="linear"||kindOf(p)==="linear"||!m.axis||!p.axis||!m.pivot||!p.pivot) continue;
      if(Math.abs(dot(m.axis,p.axis))<Math.cos(3*DEG)) continue;
      const d=sub(m.pivot,p.pivot), t=dot(d,p.axis);
      if(Math.hypot(d[0]-p.axis[0]*t,d[1]-p.axis[1]*t,d[2]-p.axis[2]*t)>0.006) continue;
      const drop=lim(m)&&!lim(p)?p:m;
      drop.internal=true; drop.internalWhy="coaxial"; reasons.coaxial++; internal++;
    }
    // two joints off the same parent on one axis line (a spindexer plate mated twice, two servos
    // turning one turret, a hub and the shaft through it) are one motion too: the one with limits,
    // then with an actuator, then carrying more, stays; the code's second device pairs onto it
    const live=mechs.filter(m=>!m.internal&&!m.keep&&!m.manual&&!m.declared&&!spec&&!m.couple&&kindOf(m)!=="linear"&&m.axis&&m.pivot);
    const score=m=>(lim(m)?4:0)+(m.hasActuator?2:0)+Math.min(1,subtree(m,0).length/1000);
    for(let i=0;i<live.length;i++) for(let j=i+1;j<live.length;j++){
      const a=live[i], c=live[j]; if(a.internal||c.internal||a.parent!==c.parent) continue;
      if(Math.abs(dot(a.axis,c.axis))<Math.cos(3*DEG)) continue;
      const d=sub(c.pivot,a.pivot), t=dot(d,a.axis);
      if(Math.hypot(d[0]-a.axis[0]*t,d[1]-a.axis[1]*t,d[2]-a.axis[2]*t)>0.012) continue;
      const drop=score(c)>score(a)?a:c;
      drop.internal=true; drop.internalWhy="coaxial"; drop.coaxialWith=(drop===a?c:a).id; reasons.coaxial++; internal++;
    }
    // an odometry pod: a dead wheel with its encoder, swinging and spinning on its own joints
    for(const m of mechs){
      if(m.internal||m.keep||m.manual||m.declared||spec||m.couple) continue;
      const idx=subtree(m,0), box=boxOf(cad,idx); if(!box||box.extent>BIND_RULES.internalNamedExtent) continue;
      if(idx.some(i=>BIND_RULES.odometryWords.test(String(cad.solids[i].name||"")))){ m.internal=true; m.internalWhy="odometry"; reasons.odometry=(reasons.odometry||0)+1; internal++; }
    }
    if(reasons.small) why.push(reasons.small+" small turn"+(reasons.small===1?"":"s")+" (shafts, bearing races, rollers) left fixed.");
    if(reasons.hardware) why.push(reasons.hardware+" joint"+(reasons.hardware===1?"":"s")+" carrying only hardware (hubs, spacers, motor shafts) left fixed.");
    if(reasons.odometry) why.push(reasons.odometry+" odometry pod joint"+(reasons.odometry===1?"":"s")+" (a dead wheel and its encoder) left to themselves.");
    if(reasons.axle) why.push(reasons.axle+" turn"+(reasons.axle===1?"":"s")+" on the drive wheels' axles (shafts, hubs, bearings) left to the drive.");
    if(reasons.coaxial) why.push(reasons.coaxial+" turn"+(reasons.coaxial===1?"":"s")+" on the same axis as the turn "+(reasons.coaxial===1?"it hangs":"they hang")+" from (a gear on a gear, a shaft in its bearing) folded into "+(reasons.coaxial===1?"it":"them")+".");
    return {internal, mechanisms:mechs.length-internal, why};
  }

  /* ---- the actuator on each joint's axis: servo or motor, from the CAD ---- */
  const ACTS=new WeakMap();
  function actuators(cad){
    if(ACTS.has(cad)) return ACTS.get(cad);
    let A=[];
    try{ if(typeof ARActuators!=="undefined") A=(ARActuators.findActuators(cad,{driveFromCAD:c=>driveFromCAD(c,{}), hwFromPart}).actuators||[]).filter(a=>a.role!=="drive"); }catch(e){ A=[]; }
    ACTS.set(cad,A); return A;
  }
  function actuatorOn(cad,m){
    if(!m.axis||!m.pivot) return null;
    for(const a of actuators(cad)){
      if(Math.abs(dot(a.axis,m.axis))<Math.cos(6*DEG)) continue;
      const d=sub(a.pivot.map(v=>v/1000),m.pivot), t=dot(d,m.axis);
      if(Math.hypot(d[0]-m.axis[0]*t,d[1]-m.axis[1]*t,d[2]-m.axis[2]*t)<0.012) return a;
    }
    return null;
  }
  /* what kind of device a joint takes: "servo", "motor", or null (unknown) */
  function jointTakes(cad,m){
    const a=actuatorOn(cad,m); if(a) return a.kind==="servo"?"servo":"motor";
    if(kindOf(m)==="linear") return "motor";                      // a slide is pulled by a motor through a spool
    const L=m.limits;
    // a turn with a short, limited travel is servo territory; a full turn, a motor's
    if(L&&Number.isFinite(L[0])&&Number.isFinite(L[1])&&Math.abs(L[1]-L[0])<=300*DEG) return null;
    return null;
  }
  const roleFits=(d,m)=>m.declaredRole==="servo"?isServoDev(d):m.declaredRole==="crservo"?/crservo/i.test(d.type||""):m.declaredRole==="motor"?/dcmotor/i.test(d.type||""):false;
  const fits=(cad,d,m)=>{ if(m.declared) return roleFits(d,m);
    const t=jointTakes(cad,m); if(!t) return isServoDev(d)?kindOf(m)!=="linear":true; return isServoDev(d)?t==="servo":t==="motor"; };

  /* ---- 2. devices onto joints ---- */
  function bindDevices(code,cad,opts){
    opts=opts||{};
    classifyJoints(cad);
    const mechs=((cad&&cad.mechs)||[]).filter(m=>!m.drive&&m.kind!=="fixed"&&!m.internal);
    const byId=new Map(mechs.map(m=>[m.id,m]));
    const devs=((code&&code.devices)||[]).filter(d=>/servo|dcmotor/i.test(d.type||"")&&!isDriveDevice(d));
    const moved=typeof opts.isCommanded==="function"?opts.isCommanded:(typeof isCommanded==="function"&&code?n=>isCommanded(code,n):()=>true);
    const map={}, bound=[], twinOf=new Map();
    for(const d of ((code&&code.devices)||[])) map[d.name]=null;
    const take=(dev,joint,by,score,why)=>{ map[dev.name]=joint.id; bound.push({device:dev.name, joint:joint.id, label:label(joint), by, score, why}); };
    const used=()=>new Set(Object.values(map).filter(Boolean));

    // the spec or the mates said so
    const explicit=opts.explicit||{};
    for(const d of devs){ const j=[d.name,d.cfg,d.alias].map(k=>k&&explicit[k]).find(Boolean); if(j&&byId.has(j)) take(d,byId.get(j),"spec",100,"the joint spec names it"); }
    // a declaration names it: the mate's name in Onshape, or the joint sheet (src/jointsheet.js)
    const exact=typeof isExact==="function"&&isExact(cad);
    if(typeof sheetBindings==="function") for(const b of sheetBindings(cad,devs)){
      const d=devs.find(x=>x.name===b.device);
      if(d&&!map[d.name]&&byId.has(b.joint)) take(d,byId.get(b.joint),b.from==="tag"?"mate name":"sheet",100,b.from==="tag"?"its mate's name in Onshape says so":"the joint sheet says so");
    }
    const free=()=>mechs.filter(m=>!m.couple&&!used().has(m.id));
    // without a declaration: names, pairs and the code's travel (none of it runs once the team has declared)
    if(!exact){
      // names: the same scoring as the hardware table, kind-aware
      const nameMap=typeof autoMap==="function"?autoMap(devs,mechs,{cad}):{};
      for(const d of devs){
        if(map[d.name]) continue;
        const j=nameMap[d.name]&&byId.get(nameMap[d.name]); if(!j||used().has(j.id)) continue;
        if(!fits(cad,d,j)) continue;
        take(d,j,"name",80,"its name matches \""+label(j)+"\"");
      }
      // twins: the second motor of a pair drives what the first does (autoMap already pairs; this keeps them in `bound`)
      for(const d of devs){ if(map[d.name]||!isMotorDev(d)) continue;
        const st=mapStem(d.name)||mapStem(d.cfg); if(st.length<3) continue;
        const twin=devs.find(o=>o!==d&&map[o.name]&&isMotorDev(o)&&(mapStem(o.name)===st||mapStem(o.cfg)===st));
        if(twin){ twinOf.set(d.name,twin.name); take(d,byId.get(map[twin.name]),"pair",75,"it pairs with "+twin.name); } }
      // travel: a motor sent to positions that reach exactly one slide's length
      const T=typeof travelRange==="function"&&code;
      for(const d of devs){
        if(map[d.name]||!isMotorDev(d)||!T) continue;
        const tr=travelRange(code,d.name,"setTargetPosition"); if(!tr||!(tr.n>=1)) continue;
        const spec=typeof specFor==="function"?specFor(d,null,"code"):null, tpr=28*((spec&&spec.ratio)||19.2);
        const ticks=Math.max(Math.abs(tr.lo),Math.abs(tr.hi)); if(!(ticks>50)) continue;
        const hits=free().filter(m=>kindOf(m)==="linear"&&m.limits&&Number.isFinite(m.limits[1])).map(m=>{
          const mm=ticks*slideMmPerTick(m,tpr), top=Math.max(Math.abs(m.limits[0]||0),Math.abs(m.limits[1]||0))*1000;
          return {m, off:top>0?Math.abs(mm-top)/top:9}; }).filter(h=>h.off<=BIND_RULES.travelTolerance);
        if(hits.length===1) take(d,hits[0].m,"travel",70,"the positions it is sent to reach the slide's "+Math.round(Math.max(Math.abs(hits[0].m.limits[0]||0),Math.abs(hits[0].m.limits[1]||0))*1000)+" mm");
      }
    }
    // only one: the last device of a kind and the last joint that takes it
    for(let pass=0;pass<3;pass++){
      const left=devs.filter(d=>!map[d.name]&&moved(d.name));
      for(const K of ["servo","motor"]){
        const ds=left.filter(d=>K==="servo"?isServoDev(d):isMotorDev(d));
        // twins count once
        const stems=new Set(ds.map(d=>mapStem(d.name)||d.name));
        if(stems.size!==1) continue;
        const js=free().filter(m=>fits(cad,ds[0],m)&&!(exact&&m.sheetDevices&&m.sheetDevices.length));
        if(js.length!==1) continue;
        for(const d of ds) take(d,js[0],"only-one","the only "+K+" left, and the only "+(kindOf(js[0])==="linear"?"slide":"joint")+" that takes one");
      }
    }
    // couplings the import could only hint at (src/urdf.js): a hinted joint follows its
    // leader when the code drives the leader and nothing drives it
    const applied=[];
    for(const m of mechs){ const h=m.coupleHint; if(exact||!h||m.couple||used().has(m.id)) continue;
      const L=byId.get(h.to); if(!L||!used().has(L.id)) continue;
      m.couple={to:L.id, ratio:h.ratio, via:h.via}; applied.push({joint:m.id, to:L.id, via:h.via, ratio:h.ratio}); }

    // the questions: a device the code moves with no joint, and its likely answers
    const open=[];
    for(const d of devs){
      if(map[d.name]||!moved(d.name)) continue;
      const cands=free().filter(m=>fits(cad,d,m)).map(m=>{
        let score=10, why=[];
        const t=jointTakes(cad,m); if(t) { score+=20; why.push("a "+t+" sits on its axis"); }
        if(isMotorDev(d)&&kindOf(m)==="linear"){ score+=10; why.push("a slide"); }
        if(m.declared&&!(m.sheetDevices&&m.sheetDevices.length)){ score+=30; why.push("declared "+m.declaredRole+", with no device named"); }
        return {joint:m.id, label:label(m), score, why:why.join(", ")};
      }).sort((a,b)=>b.score-a.score);
      open.push({device:d.name, type:isServoDev(d)?"servo":"motor", candidates:cands.slice(0,6)});
    }
    // joints no device reaches (still mechanisms): told, not asked
    const idle=mechs.filter(m=>!m.couple&&!used().has(m.id)).map(m=>({joint:m.id, label:label(m)}));
    return {map, bound, open, idle, couplings:applied, mechanisms:mechs.length, exact};
  }
  return {classifyJoints, bindDevices};
})();
