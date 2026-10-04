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
   cheaper than a wrong robot shown as right. Everything here is pure data,
   tested in Node; src/app.js and src/importflow.js draw it.
   ============================================================ */
const BIND_RULES={
  internalExtent:0.045,          // m: a body this small turning on its own is a shaft or a bearing race
  internalNamedExtent:0.14,      // m: a body of only hardware words up to this size is internal too
  hardwareWords:/\b(bearing|shaft|axle|race|spacer|standoff|washer|collar|bushing|hub|clamp|coupler|encoder|magnet|clip|retainer|nut|bolt|screw|insert|pin|dowel|rod end|heim)\b|\bmotor\b|servo horn|horn\b/i,
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

  /* ---- 1. which joints are mechanisms ----
     Idempotent; a joint spec or a hand edit (m.keep) is never demoted. Returns
     {internal, mechanisms, why:[…]}. */
  function classifyJoints(cad){
    const mechs=((cad&&cad.mechs)||[]).filter(m=>!m.drive&&m.kind!=="fixed");
    const kids=id=>mechs.filter(k=>k.parent===id);
    let internal=0, why=[];
    const reasons={small:0, hardware:0};
    for(const m of mechs){
      if(m.keep||m.manual||(cad.mates&&cad.mates.source==="spec")){ m.internal=false; continue; }
      if(m.couple||kids(m.id).length){ m.internal=false; continue; }      // it carries another joint, or follows one: a mechanism
      const idx=members(cad,m), box=boxOf(cad,idx);
      if(!idx.length||!box){ m.internal=false; continue; }                 // empty joints are the robot check's business
      const names=idx.map(i=>String(cad.solids[i].name||""));
      const allHw=names.every(n=>BIND_RULES.hardwareWords.test(n)||/^(part|body)\s*\d*$/i.test(n)&&false);
      if(box.extent<BIND_RULES.internalExtent){ m.internal=true; m.internalWhy="small"; reasons.small++; }
      else if(allHw&&box.extent<BIND_RULES.internalNamedExtent){ m.internal=true; m.internalWhy="hardware"; reasons.hardware++; }
      else m.internal=false;
      if(m.internal) internal++;
    }
    if(reasons.small) why.push(reasons.small+" small turn"+(reasons.small===1?"":"s")+" (shafts, bearing races) left fixed.");
    if(reasons.hardware) why.push(reasons.hardware+" joint"+(reasons.hardware===1?"":"s")+" carrying only hardware (hubs, spacers, motor shafts) left fixed.");
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
  const fits=(cad,d,m)=>{ const t=jointTakes(cad,m); if(!t) return isServoDev(d)?kindOf(m)!=="linear":true; return isServoDev(d)?t==="servo":t==="motor"; };

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
    const free=()=>mechs.filter(m=>!m.couple&&!used().has(m.id));
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
    // only one: the last device of a kind and the last joint that takes it
    for(let pass=0;pass<3;pass++){
      const left=devs.filter(d=>!map[d.name]&&moved(d.name));
      for(const K of ["servo","motor"]){
        const ds=left.filter(d=>K==="servo"?isServoDev(d):isMotorDev(d));
        // twins count once
        const stems=new Set(ds.map(d=>mapStem(d.name)||d.name));
        if(stems.size!==1) continue;
        const js=free().filter(m=>fits(cad,ds[0],m));
        if(js.length!==1) continue;
        for(const d of ds) take(d,js[0],"only-one","the only "+K+" left, and the only "+(kindOf(js[0])==="linear"?"slide":"joint")+" that takes one");
      }
    }
    // couplings the import could only hint at (src/urdf.js): a hinted joint follows its
    // leader when the code drives the leader and nothing drives it
    const applied=[];
    for(const m of mechs){ const h=m.coupleHint; if(!h||m.couple||used().has(m.id)) continue;
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
        return {joint:m.id, label:label(m), score, why:why.join(", ")};
      }).sort((a,b)=>b.score-a.score);
      open.push({device:d.name, type:isServoDev(d)?"servo":"motor", candidates:cands.slice(0,6)});
    }
    // joints no device reaches (still mechanisms): told, not asked
    const idle=mechs.filter(m=>!m.couple&&!used().has(m.id)).map(m=>({joint:m.id, label:label(m)}));
    return {map, bound, open, idle, couplings:applied, mechanisms:mechs.length};
  }
  return {classifyJoints, bindDevices};
})();
