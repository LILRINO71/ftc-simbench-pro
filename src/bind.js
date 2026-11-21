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
        name       the device's name is the joint's own name, or shares a
                   word with it (its id, label or mate: src/mapping.js). A word
                   found only in a part the joint carries, a subsystem word
                   (intake, outtake…) shared with a longer name, or a synonym
                   is a hint: it ranks a question's answers, it binds nothing
        travel     RUN_TO_POSITION targets reach exactly one slide's length
        only-one   one servo left and one servo-sized joint left (and so on
                   for motors and slides), so there is nothing to ask. Only
                   when (a) another device of this code is bound by strong
                   evidence (spec, declaration, its exact name), which shows
                   the code was written for this robot, and (b) the code uses
                   the device the way the joint needs: a joint that stops at
                   both ends needs positions (targets, RUN_TO_POSITION, its
                   encoder read, a servo's positions); a motor only given
                   power or a velocity is a roller or a wheel
        pair       the second motor of a pair (liftLeft/liftRight) drives
                   the same joint, as sure as the first and no surer
      The actuator on a joint's axis (src/autorig-lib.js finds every servo
      and motor output in the CAD) says what kind of device the joint takes,
      so a servo never lands on a motor's joint. Whatever is left is a
      question with its likely answers, in the team's own device names,
      the first one first for a reason the question says.

   bindDevices never guesses between two live candidates: a question is
   cheaper than a wrong robot shown as right. Every binding says how it was
   made (bound[].by and .why), so a guess is never silent.

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
  nameScoreSure:70,              // a name match this strong is bound outright (src/mapping.js); weaker ones are hints
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
    // the followings an earlier run worked out here (twins on one axis) are worked out again
    for(const m of mechs){ if(m.couple&&m.couple.via==="coaxial") delete m.couple; delete m.coaxialWith; }
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
    const reasons={small:0, hardware:0, coaxial:0, twin:0};
    const lim=x=>!!(x.limits&&Number.isFinite(x.limits[0])&&Number.isFinite(x.limits[1]));
    // two turns about one line: axes within 3 degrees, b's pivot within tol of a's axis
    const oneLine=(a,b,tol)=>{ if(Math.abs(dot(a.axis,b.axis))<Math.cos(3*DEG)) return false;
      const d=sub(b.pivot,a.pivot), t=dot(d,a.axis); return Math.hypot(d[0]-a.axis[0]*t,d[1]-a.axis[1]*t,d[2]-a.axis[2]*t)<=tol; };
    for(const m of mechs){
      if(m.declaredFixed){ m.internal=true; m.internalWhy="declared fixed"; internal++; continue; }
      if(m.keep||m.manual||spec||m.declared){ m.internal=false; continue; }
      if(m.couple){ m.internal=false; continue; }                           // it follows another joint: a mechanism
      const idx=subtree(m,0), box=boxOf(cad,idx);
      if(!idx.length||!box){ m.internal=false; continue; }                 // empty joints are the robot check's business
      // travel limits are the team's own word that it moves: no library bearing or motor shaft
      // has them. Set aside for its size, a 35 mm claw finger was a "bearing race" and the
      // claw servo had no joint to drive
      if(lim(m)){ m.internal=false; continue; }
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
    // (a library bearing writes three: the race, the shaft in it, the arm on the shaft. The turn
    // it hangs from is looked for past the ones already folded on this axis, or the race and the
    // arm both stayed, and the arm's servo landed on the race, which has no limits)
    const turns=x=>!!x&&kindOf(x)!=="linear"&&!!x.axis&&!!x.pivot;
    for(const m of mechs){
      if(m.internal||m.keep||m.manual||m.declared||spec||m.couple||!turns(m)) continue;
      let p=byId.get(m.parent);
      for(let n=0;n<40&&p&&p.internal&&p.internalWhy==="coaxial"&&turns(p)&&oneLine(p,m,0.006);n++) p=byId.get(p.parent);
      if(!p||p.internal||p.couple||p.keep||p.manual||p.declared||!turns(p)||!oneLine(p,m,0.006)) continue;
      const drop=lim(m)&&!lim(p)?p:m;
      drop.internal=true; drop.internalWhy="coaxial"; reasons.coaxial++; internal++;
    }
    // two joints off the same parent on one axis line (a spindexer's plates each mated to the
    // frame, two servos turning one turret, a hub and the shaft through it) are one motion too:
    // the one with limits, then with an actuator, then carrying more, leads, and the other
    // follows it turn for turn. (Held as drawn instead, two of a spindexer's three plates stood
    // still while the third turned.) bindDevices lets whichever one the code drives lead, and
    // leaves both free when the code drives both
    const live=mechs.filter(m=>!m.internal&&!m.keep&&!m.manual&&!m.declared&&!spec&&!m.couple&&kindOf(m)!=="linear"&&m.axis&&m.pivot);
    const score=m=>(lim(m)?4:0)+(m.hasActuator?2:0)+Math.min(1,subtree(m,0).length/1000);
    for(let i=0;i<live.length;i++) for(let j=i+1;j<live.length;j++){
      const a=live[i], c=live[j]; if(a.internal||c.internal||a.couple||c.couple||a.parent!==c.parent) continue;
      if(!oneLine(a,c,0.012)) continue;
      const drop=score(c)>score(a)?a:c, lead=drop===a?c:a;
      drop.coaxialWith=lead.id; drop.couple={to:lead.id, ratio:dot(drop.axis,lead.axis)<0?-1:1, via:"coaxial"}; reasons.twin++;
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
    if(reasons.twin) why.push(reasons.twin+" turn"+(reasons.twin===1?"":"s")+" on the same axis as another off the same part (plates on one shaft, a hub and its shaft) "+(reasons.twin===1?"turns":"turn")+" with it.");
    return {internal, mechanisms:mechs.length-internal, why};
  }

  /* ---- the actuator on each joint's axis: servo or motor, from the CAD ---- */
  const ACTS=new WeakMap();
  function actuators(cad){
    if(ACTS.has(cad)) return ACTS.get(cad);
    let A=[];
    try{ if(typeof actuatorsOf==="function") A=actuatorsOf(cad).filter(a=>a.role!=="drive"); }catch(e){ A=[]; }
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

  /* ---- how the code uses each device: power, a velocity, positions ----
     Read from what the engine already has: the line reader's statement tree (the
     setters, setTargetPosition, setMode(RUN_TO_POSITION), x.getCurrentPosition() or
     x.isBusy() anywhere in an expression, a Road Runner auto's actions as they run),
     or the Java VM's probes (src/jvmrun.js, an.use). Keyed by the code's device names. */
  const USES=new WeakMap();
  const USE_SKIP=new Set(["tr","pts","src","loopSrc","cls","A","statics","classes","params"]);
  function codeUses(code){
    if(!code||typeof code!=="object") return {};
    if(USES.has(code)) return USES.get(code);
    const U={}, u=n=>U[n]||(U[n]={});
    if(code.vm&&code.vm.an){
      const A=code.vm.an.use||{}; for(const n in A) Object.assign(u(n),A[n]);
      for(const n in code.vm.an.ranges||{}) u(n).position=true;
    } else {
      const seen=new Set(), OPS={setPower:"power", setVelocity:"velocity", setPosition:"position"};
      const walk=(x,depth)=>{
        if(!x||typeof x!=="object"||seen.has(x)||depth>300) return; seen.add(x);
        if(Array.isArray(x)){ for(const y of x) walk(y,depth+1); return; }
        if(x.kind==="call"&&typeof x.dev==="string"&&OPS[x.op]) u(x.dev)[OPS[x.op]]=true;
        if(x.kind==="objcall"&&typeof x.obj==="string"){
          if(x.meth==="setTargetPosition") u(x.obj).target=true;
          else if(x.meth==="setMode"&&/RUN_TO_POSITION/.test(x.raw||"")) u(x.obj).rtp=true;
        }
        if(x.o==="call"&&typeof x.name==="string"){ const q=/^(.+)\.(getCurrentPosition|isBusy)$/.exec(x.name); if(q) u(q[1]).encoder=true; }
        for(const k in x) if(!USE_SKIP.has(k)) walk(x[k],depth+1);
      };
      walk([code.stmts,code.inits,code.auto,code.rr&&code.rr.root],0);
    }
    USES.set(code,U); return U;
  }
  function deviceUse(code,d){
    const U=codeUses(code), o={};
    for(const k of [d.name,d.cfg,d.alias]) if(k&&U[k]) Object.assign(o,U[k]);
    return o;
  }
  /* position control: what a joint that stops at both ends needs */
  const positional=(d,u)=>!!(u.target||u.rtp||u.encoder||(isServoDev(d)&&u.position));
  const twoLimits=m=>!!(m.limits&&Number.isFinite(m.limits[0])&&Number.isFinite(m.limits[1]));
  function useWords(d,u){
    const w=[];
    if(u.target) w.push("sends it to target positions"); if(u.rtp) w.push("runs it to position");
    if(u.encoder) w.push("reads its encoder"); if(isServoDev(d)&&u.position) w.push("sets its position");
    if(w.length) return "the code "+w.join(" and ");
    if(u.power&&u.velocity) return "the code only gives it power and a velocity";
    if(u.power) return "the code only gives it power";
    if(u.velocity) return "the code only sets its velocity";
    return "the code never says how it moves";
  }
  const what=m=>kindOf(m)==="linear"?"slide":"joint";

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
    const use=d=>deviceUse(code,d);
    // a joint that stops at both ends takes a device the code sends to positions; one that turns freely takes either
    const useFits=(d,m)=>!twoLimits(m)||positional(d,use(d));
    // strong evidence that this code was written for this robot: a device bound by a declaration or its exact name
    const STRONG={spec:1, "mate name":1, sheet:1};
    const strongOther=group=>bound.find(b=>(STRONG[b.by]||(b.by==="name"&&b.score>=100))&&!group.some(d=>d.name===b.device));
    const howStrong=b=>b.by==="name"?"its exact name":b.by==="spec"?"the joint spec":b.by==="sheet"?"the joint sheet":"its mate's name";

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
    // a joint the import hints follows another (a lift's second stage, a mirrored finger) is
    // settled with its leader: never elimination's "only joint left", never an answer of its own
    const leaders=()=>free().filter(m=>!(m.coupleHint&&byId.has(m.coupleHint.to)&&!used().has(m.coupleHint.to)));
    // twins on one axis (classifyJoints): the one the code drives leads the others; with two of
    // them driven (a turret and a spindexer on one centre line) each is its own mechanism
    const twins=()=>{
      const U=used(), groups=new Map();
      const rootOf=m=>{ let r=m; for(let n=0;n<40&&r.coaxialWith&&byId.has(r.coaxialWith);n++) r=byId.get(r.coaxialWith); return r; };
      for(const m of mechs) if(m.coaxialWith){ const r=rootOf(m); if(!groups.has(r.id)) groups.set(r.id,[r]); groups.get(r.id).push(m); }
      for(const g of groups.values()){
        const lead=g.find(m=>U.has(m.id))||g[0];
        for(const m of g){
          if(m.couple&&m.couple.via==="coaxial") delete m.couple;
          if(m!==lead&&!U.has(m.id)&&!m.couple) m.couple={to:lead.id, ratio:dot(m.axis,lead.axis)<0?-1:1, via:"coaxial"};
        }
      }
    };
    twins();
    // couplings the import could only hint at (src/urdf.js): a hinted joint follows its leader
    // when the code drives the leader and nothing drives it. Before "only one" below: left for
    // after it, a lift's second stage was "the only joint left" for a motor that had none
    const applied=[];
    const hints=()=>{ for(const m of mechs){ const h=m.coupleHint; if(exact||!h||m.couple||used().has(m.id)) continue;
      const L=byId.get(h.to); if(!L||!used().has(L.id)) continue;
      m.couple={to:L.id, ratio:h.ratio, via:h.via}; applied.push({joint:m.id, to:L.id, via:h.via, ratio:h.ratio}); } };
    // the second motor of a pair drives what the first does, and is as sure as the first was:
    // the pair of a device that was asked about is asked about too (below)
    const stemOf=d=>mapStem(d.name)||mapStem(d.cfg);
    const twinIn=(d,list)=>{ if(!isMotorDev(d)) return null; const st=stemOf(d); if(st.length<3) return null;
      return list.find(o=>o!==d&&isMotorDev(o)&&(mapStem(o.name)===st||mapStem(o.cfg)===st))||null; };
    const pairs=()=>{ for(const d of devs){ if(map[d.name]) continue;
      const twin=twinIn(d,devs.filter(o=>map[o.name])); if(!twin) continue;
      const b=bound.find(x=>x.device===twin.name), how=b.by==="only-one"?"by elimination":b.by==="name"?"by its name":b.by==="travel"?"by its travel":b.by==="pair"?"as a pair":"by "+howStrong(b);
      twinOf.set(d.name,twin.name); take(d,byId.get(map[twin.name]),"pair",Math.min(75,b.score),"it pairs with "+twin.name+", which was bound "+how); } };
    // name hints, kept to rank the answers of a question
    let named={pick:{}, score:()=>null};
    // without a declaration: names, pairs and the code's travel (none of it runs once the team has declared)
    if(!exact){
      // names: the same scoring as the hardware table, kind-aware. Only a sure name binds: the
      // joint's own name, not a word in a part it carries; a subsystem word only when it is the
      // joint's whole name and the code uses the device the way the joint needs
      if(typeof autoMapScored==="function") named=autoMapScored(devs,mechs,{cad});
      for(const d of devs){
        if(map[d.name]) continue;
        const p=named.pick[d.name], j=p&&byId.get(p.joint); if(!j||used().has(j.id)) continue;
        if(!fits(cad,d,j)||!(p.raw>=BIND_RULES.nameScoreSure)) continue;
        if(p.sub&&!useFits(d,j)) continue;
        take(d,j,"name",p.raw,p.why+(p.sub?"; "+useWords(d,use(d))+", which the "+what(j)+" takes":""));
      }
      pairs();
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
      pairs();
    }
    twins(); hints();
    // only one: the last device of a kind and the last joint that takes it. Elimination assumes
    // the code and the CAD are the same robot and that the device drives some joint here; it
    // binds only when (a) another device of this code is tied to this robot by strong evidence
    // and (b) the device's use fits the joint. Otherwise that joint is offered first in a question
    const elim=new Map();                    // device -> {joint, why}: elimination's answer, not taken
    const sideOf=ws=>{ const L=ws.some(w=>/^(left|l)$/.test(w)), R=ws.some(w=>/^(right|r)$/.test(w)); return L===R?null:L?"left":"right"; };
    const devSide=d=>sideOf(mapRaw(d.name))||sideOf(mapRaw(d.cfg));
    const jointSide=m=>sideOf(mapRaw(m.id))||sideOf(mapRaw(m.alias))||sideOf(mapRaw(m.label));
    const settle=(lead,group,j,K,last)=>{
      const s=strongOther(group), ok=useFits(lead,j), u=use(lead);
      const base=last+", and the only "+what(j)+" that takes one";
      if(s&&ok){
        take(lead,j,"only-one",60,"by elimination: "+base+"; "+useWords(lead,u)+(twoLimits(j)?", as a "+what(j)+" that stops at both ends needs":"")+"; and "+s.device+" is tied to this robot by "+howStrong(s));
        for(const d of group) if(d!==lead){ twinOf.set(d.name,lead.name); take(d,j,"pair",60,"it pairs with "+lead.name+", which was bound by elimination"); }
        return;
      }
      const not=[];
      if(!s) not.push("nothing else in this code is tied to this robot by a declaration or an exact name, so it may not be written for this robot");
      if(!ok) not.push(useWords(lead,u)+", as a roller or a flywheel gets, and the "+what(j)+" stops at both ends: that needs a motor sent to positions");
      for(const d of group) elim.set(d.name,{joint:j.id, lead:lead.name, why:base+", but "+not.join("; and ")});
    };
    for(let pass=0;pass<3;pass++){
      const left=devs.filter(d=>!map[d.name]&&moved(d.name));
      for(const K of ["servo","motor"]){
        const ds=left.filter(d=>K==="servo"?isServoDev(d):isMotorDev(d));
        // twins count once
        const stems=new Set(ds.map(d=>mapStem(d.name)||d.name));
        if(stems.size!==1) continue;
        const js=leaders().filter(m=>fits(cad,ds[0],m)&&!(exact&&m.sheetDevices&&m.sheetDevices.length));
        // the one the code sends to positions leads its pair
        const lead=ds.find(d=>positional(d,use(d)))||ds[0];
        if(js.length===1) settle(lead,ds,js[0],K,"the only "+K+" left");
        // the last two, a left and a right, and the last two joints that take them, a left and a right
        else if(js.length===2&&ds.length===2){
          const dS=ds.map(devSide), jS=js.map(jointSide);
          if(dS[0]&&dS[1]&&dS[0]!==dS[1]&&jS[0]&&jS[1]&&jS[0]!==jS[1])
            for(const d of ds) if(!map[d.name]){ const j=js[jS.indexOf(devSide(d))]; if(!used().has(j.id)) settle(d,[d],j,K,"one of the last two "+K+"s, the "+devSide(d)+" one, and the "+devSide(d)+" one of the last two "+what(j)+"s"); }
        }
      }
      pairs();
      hints();
    }

    for(const m of mechs) if(m.couple&&m.couple.via==="coaxial") applied.push({joint:m.id, to:m.couple.to, via:"coaxial", ratio:m.couple.ratio});
    // the questions: a device the code moves with no joint, its likely answers in order, and why
    const open=[];
    for(const d of devs){
      if(map[d.name]||!moved(d.name)) continue;
      const u=use(d), E=elim.get(d.name);
      const cands=leaders().filter(m=>fits(cad,d,m)).map(m=>{
        let score=10, why=[];
        if(E&&E.joint===m.id){ score+=1000; why.push(E.lead===d.name?"the only joint left that takes it":"the joint offered to its pair, "+E.lead); }
        const h=named.score(d,m); if(h&&h.v>=45){ score+=Math.round(h.v); why.push(h.why); }
        const t=jointTakes(cad,m); if(t) { score+=20; why.push("a "+t+" sits on its axis"); }
        if(isMotorDev(d)&&kindOf(m)==="linear"){ score+=10; why.push("a slide"); }
        if(m.declared&&!(m.sheetDevices&&m.sheetDevices.length)){ score+=30; why.push("declared "+m.declaredRole+", with no device named"); }
        if(twoLimits(m)&&!positional(d,u)&&(u.power||u.velocity)){ score-=15; why.push("though it stops at both ends and "+useWords(d,u)); }
        return {joint:m.id, label:label(m), score, why:why.join(", ")};
      }).sort((a,b)=>b.score-a.score);
      const hint=cands.length&&named.score(d,byId.get(cands[0].joint));
      open.push({device:d.name, type:isServoDev(d)?"servo":"motor", use:useWords(d,u), candidates:cands.slice(0,6),
        why:E?"It would be "+E.why+".":hint&&hint.v>=45?"Its name only hints at a joint: "+hint.why+".":"Nothing in its name or in how the code drives it picks one joint.",
        first:cands.length?"\""+cands[0].label+"\" is offered first: "+(cands[0].why||"no joint is likelier than another")+".":null});
    }
    // a pair is asked as one: the second offered first what the first is offered first
    for(const q of open){
      const d=devs.find(x=>x.name===q.device), lead=twinIn(d,devs.filter(o=>open.some(p=>p.device===o.name)));
      if(!lead) continue;
      const L=open.find(p=>p.device===lead.name), Lq=elim.get(lead.name);
      if(open.indexOf(L)>open.indexOf(q)||(Lq&&Lq.lead!==lead.name)) continue;      // the earlier one, or elimination's own lead, leads
      const top=L.candidates[0]; if(!top) continue;
      const i=q.candidates.findIndex(c=>c.joint===top.joint);
      const c=i>=0?q.candidates.splice(i,1)[0]:{joint:top.joint, label:top.label, score:0, why:""};
      if(c.why.indexOf(lead.name)<0) c.why="the joint offered first to its pair, "+lead.name+(c.why?", "+c.why:"");
      q.candidates.unshift(c); q.candidates=q.candidates.slice(0,6); q.pair=lead.name;
      q.first="\""+c.label+"\" is offered first: "+lead.name+", its pair, is asked about with it first.";
    }
    // joints no device reaches (still mechanisms): told, not asked
    const idle=mechs.filter(m=>!m.couple&&!used().has(m.id)).map(m=>({joint:m.id, label:label(m)}));
    return {map, bound, open, idle, couplings:applied, mechanisms:mechs.length, exact};
  }
  return {classifyJoints, bindDevices};
})();
