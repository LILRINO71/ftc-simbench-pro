/* ============================================================
   AUTO-BIND — which joint each motor and servo in the code drives, with
   no one asked.
   ------------------------------------------------------------
   A robot read from its CAD has exact joints but default mate names, so
   nothing says which joint "spinner" turns. A team shouldn't have to answer
   that for every device: the CAD and the code together usually do.

   From the CAD: the candidate joints (not bearings that just spin, not a
   motor's own gearbox internals, not an odometry pod, not a drive wheel's
   hub), what each carries (parts, mass, span, height), and whether a motor or
   a servo part sits on its axis (a direct drive) or a pulley, gear or sprocket
   is on it (a belt or gear drive).

   From the code: how each device is used. setVelocity on a motor is a
   flywheel; reading the encoder and holding a target is an indexer, turret
   or arm; plain setPower is a roller; a servo sent to two positions is a
   flipper or claw; one sent round 0.5 is a continuous spin. Two devices
   commanded alike (outtake/outtake2, uppies/uppies2) are a pair, and a pair
   goes on a pair of matching joints.

   Every pick comes with its reason, so the Checks tab can say "spinner
   drives this, because…" and the hardware table can change it. A pick is a
   guess the bench stands behind, not a question.
   ============================================================ */
const AB_INTERNAL=/gearbox|inner race|outer race|motor shaft|motor shield|encoder|\bcvr\b|side label|top label|sticker|paint|\bshim\b|magnet/i;
const AB_ODOMETRY=/odometry|odo ?pod|swingarm|dead ?wheel|3110.0001.0002|pinpoint/i;
const AB_WHEELISH=/roller|tire|tyre|wheel|2302k|3613|gripping|compliant|fly ?wheel|grip/i;
const AB_DRIVE_GEAR=/pulley|gear\b|sprocket|belt|chain/i;
const AB_SERVO=/2000.0025|servo|axon|\bgobilda servo\b/i;
const AB_HARDWARE=/hub|shaft|collar|bearing|spacer|standoff|e[- ]?clip|washer|screw|bolt|nut|pin|^d{4}[ _-]d{4}[ _-]d{1,4}( d+)?$/i;
const AB_MOTOR=/5203|5202|5204|gearbox face|yellow ?jacket|\bmotor\b|hd ?hex|core ?hex|ultra ?planetary|neverest/i;

/* how the code uses each device: the ops, the values, what it reads */
function abUsage(code){
  const src=String((code&&code.src)||"");
  const out={};
  for(const d of (code&&code.devices)||[]){
    if(!/servo|dcmotor/i.test(d.type||"")) continue;
    const names=[d.name,d.alias,d.cfg].filter(Boolean).map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
    const has=re=>names.some(n=>new RegExp("\\b"+n+"\\s*\\.\\s*(?:"+re+")\\s*\\(").test(src));
    const u={name:d.name, kind:/servo/i.test(d.type||"")?"servo":"motor", ops:new Set(), values:[], buttons:new Set(),
      velocity:has("setVelocity"), encoder:has("getCurrentPosition|setTargetPosition|getVelocity"), runTo:/RUN_TO_POSITION/.test(src)&&has("setMode"),
      cr:/CRServo/i.test(d.type||"")};
    for(const b of (code&&code.bindings)||[]) if(b.dev===d.name||b.dev===d.alias||b.dev===d.cfg){
      if(b.op) u.ops.add(b.op); if(Number.isFinite(b.to)) u.values.push(b.to); if(b.btn) u.buttons.add((b.pad||1)+"."+b.btn);
      if(b.op==="setVelocity") u.velocity=true;
    }
    if(code&&code.vm&&code.vm.an&&code.vm.an.ranges&&code.vm.an.ranges[d.name]){ const r=code.vm.an.ranges[d.name]; u.values.push(r.lo,r.hi); }
    const vals=[...new Set(u.values.map(v=>+v.toFixed(3)))];
    u.distinct=vals.length;
    if(u.kind==="servo"){
      const lo=Math.min(...vals), hi=Math.max(...vals);
      u.toggle=vals.length>=2&&hi-lo>=0.08;
      u.crLike=u.cr||(vals.length>=1&&vals.every(v=>Math.abs(v-0.5)<0.001))||(vals.length>=2&&Math.abs((lo+hi)/2-0.5)<0.03&&hi-lo>0.3);
    } else {
      u.holds=u.encoder||u.runTo;
      u.plain=!u.velocity&&!u.holds;
    }
    out[d.name]=u;
  }
  return out;
}

/* the candidate joints, with what each carries and what sits on its axis */
function abCandidates(cad,drive){
  const mechs=(cad&&cad.mechs)||[], solids=(cad&&cad.solids)||[];
  const cen=s=>{ const p=s.pts||[]; if(!p.length) return [0,0,0]; const a=[0,0,0]; for(const q of p){ a[0]+=q[0]; a[1]+=q[1]; a[2]+=q[2]; } return a.map(v=>v/p.length); };
  const parts=solids.map((s,i)=>({s,i,c:cen(s), kind:(s.kind==="servo"||AB_SERVO.test((s.name||"")+" "+(s.part||"")))?"servo":(s.kind==="motor"||AB_MOTOR.test((s.name||"")+" "+(s.part||"")))?"motor":null}));
  const actuators=parts.filter(p=>p.kind);
  const wheels=(drive&&drive.wheels)||[];
  const kids=new Map(); for(const m of mechs) if(m.parent){ if(!kids.has(m.parent)) kids.set(m.parent,[]); kids.get(m.parent).push(m.id); }
  const carriedOf=new Map();
  const carried=id=>{ if(carriedOf.has(id)) return carriedOf.get(id); const ids=new Set([id]); const q=[id]; while(q.length){ const x=q.pop(); for(const k of kids.get(x)||[]) if(!ids.has(k)){ ids.add(k); q.push(k); } }
    const out=parts.filter(p=>ids.has(p.s.mech)); carriedOf.set(id,out); return out; };
  const out=[];
  for(const m of mechs){
    if(!m.fromMate||m.drive||m.couple||m.passive||m.kind==="fixed"||!m.axis||!m.pivot) continue;
    const C=carried(m.id); if(!C.length) continue;
    const own=C.filter(p=>p.s.mech===m.id);
    const text=C.map(p=>(p.s.name||"")+" "+(p.s.part||"")).join(" | "), ownText=own.map(p=>(p.s.name||"")+" "+(p.s.part||"")).join(" | ");
    if(C.every(p=>AB_INTERNAL.test(p.s.name||"")||p.kind==="motor")) continue;      // a motor's own insides
    // hubs, shafts, collars and bare part numbers, nothing else: a motor's output hub, not a mechanism
    if(C.every(p=>AB_INTERNAL.test(p.s.name||"")||p.kind==="motor"||(AB_HARDWARE.test(p.s.name||"")&&!AB_WHEELISH.test(p.s.name||"")))) continue;
    if(AB_ODOMETRY.test(text)) continue;                                             // an odometry pod's swingarm

    // anything small within reach of a drive wheel's centre is the wheel's own hub, roller or axle
    const nearWheel=wheels.some(w=>w.c&&Math.hypot(w.c[0]-m.pivot[0],w.c[1]-m.pivot[1],w.c[2]-m.pivot[2])<0.12);
    let kg=0; const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
    for(const p of C){ kg+=p.s.kg||0; for(const q of p.s.pts||[]) for(let k=0;k<3;k++){ if(q[k]<mn[k]) mn[k]=q[k]; if(q[k]>mx[k]) mx[k]=q[k]; } }
    const span=Math.hypot(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]);
    if(nearWheel&&span<0.2) continue;
    const wheelish=AB_WHEELISH.test(text), geared=AB_DRIVE_GEAR.test(text);
    // a joint named for a bearing, hub or gearbox part that carries nothing heavy and no wheel: hardware, not a mechanism
    if(C.length<=4&&kg<0.08&&!wheelish&&(AB_INTERNAL.test(ownText)||AB_HARDWARE.test(ownText))) continue;
    if(wheelish&&m.pivot[2]<0.08&&span<0.2) continue;                                // a drive wheel itself
    // an actuator part on the axis line, not carried by the joint: a direct drive
    let act=null, motorOn=false, servoOn=false;
    for(const a of actuators){
      if(C.includes(a)) continue;
      const d=[a.c[0]-m.pivot[0],a.c[1]-m.pivot[1],a.c[2]-m.pivot[2]], t=d[0]*m.axis[0]+d[1]*m.axis[1]+d[2]*m.axis[2];
      const rad=Math.hypot(d[0]-t*m.axis[0],d[1]-t*m.axis[1],d[2]-t*m.axis[2]);
      if(rad<0.02&&Math.abs(t)<0.12){ if(a.kind==="motor") motorOn=true; else servoOn=true; }
    }
    act=motorOn?"motor":servoOn?"servo":null;
    // a servo's spline or horn among what the joint carries: the joint is the servo's output
    const servoOut=/spline|servo ?horn|horn|h25t|25t/i.test(ownText);
    out.push({m, id:m.id, parts:C.length, kg, span, z:m.pivot[2], axis:m.axis, pivot:m.pivot, act, wheelish, geared, servoOut, text, carried:new Set(C.map(p=>p.i))});
  }
  // one chain, one joint: a child that carries exactly what its parent carries is the same
  // mechanism seen lower down (a servo's spline, then the horn, then the arm): keep the parent
  const byId=new Map(out.map(c=>[c.id,c]));
  // ...or the parent carries only a hub, spline or shaft more than the child does
  const HW=/spline|hub|shaft|collar|bearing|clamp|horn|adapter|spacer|screw|bolt|nut|washer/i;
  return out.filter(c=>{ const p=c.m.parent&&byId.get(c.m.parent); if(!p) return true;
    for(const i of c.carried) if(!p.carried.has(i)) return true;
    const extra=[...p.carried].filter(i=>!c.carried.has(i));
    return !(extra.length<=2&&extra.every(i=>HW.test(solids[i].name||"")));
  });
}

/* The bindings the CAD and the code agree on, with reasons. Fills what `map` leaves null. */
function autoBind(cad,code,map,opts){
  opts=opts||{};
  const picks=[], notes=[];
  if(!cad||!code||!cad.mates) return {map:Object.assign({},map||{}), picks, notes};
  const usage=abUsage(code);
  const devs=((code.devices)||[]).filter(d=>/servo|dcmotor/i.test(d.type||"")&&!(typeof isDriveDevice==="function"&&isDriveDevice(d))&&!(map&&map[d.name]));
  if(!devs.length) return {map:Object.assign({},map||{}), picks, notes};
  const drive=typeof driveFromCAD==="function"?(()=>{ try{ return driveFromCAD(cad,{front:opts.front}); }catch(e){ return null; } })():null;
  const cands=abCandidates(cad,drive).filter(c=>!(map&&Object.values(map).includes(c.id)));
  if(!cands.length) return {map:Object.assign({},map||{}), picks, notes};
  const maxKg=Math.max(1e-6,...cands.map(c=>c.kg)), maxParts=Math.max(1,...cands.map(c=>c.parts));
  const used=new Set(), out=Object.assign({},map||{});
  const label=c=>c.m.label||c.id;
  const sig=d=>{ const u=usage[d.name]; return u?[...u.ops].sort().join(",")+"|"+[...u.buttons].sort().join(","):""; };
  const stem=n=>typeof mapStem==="function"?mapStem(n):String(n).toLowerCase().replace(/[0-9]+$/,"");
  // a device's partner: commanded alike, or named alike (uppies/uppies2, leftArm/rightArm)
  const partner=d=>devs.find(o=>o!==d&&usage[o.name]&&usage[d.name]&&usage[o.name].kind===usage[d.name].kind&&!out[o.name]&&
    ((sig(o)&&sig(o)===sig(d))||(stem(o.name).length>=3&&stem(o.name)===stem(d.name))));
  const score=(d,c)=>{
    const u=usage[d.name]; if(!u) return 0;
    let s=0; const why=[];
    if(u.kind==="servo"){
      if(c.act==="servo"){ s+=45; why.push("a servo sits on its axis"); } else if(c.act==="motor") s-=40; else { s+=5; }
      if(c.servoOut){ s+=10; why.push("it turns on a servo spline"); }
      if(c.kg>5||c.parts>60) s-=25;                                   // a servo doesn't turn the biggest thing on the robot
      s+=Math.min(10,20*c.kg);                                        // what it carries, a little
      if(u.toggle){ if(c.kg>=0.03&&c.kg<=2) { s+=10; why.push("your code sends it between two positions"); } }
      if(u.crLike){ if(c.m.continuous) { s+=10; why.push("your code spins it round 0.5"); } }
    } else {
      // a motor on the axis is strong for a flywheel or a roller (direct drive) and weaker for a
      // mechanism held to a position (often belt- or gear-driven); and it has to carry something,
      // or it's the motor's own output hub
      const substance=Math.min(1,Math.max(c.kg/0.1,c.parts/3));
      if(c.act==="motor"){ s+=(u.holds?20:40)*substance; why.push("a motor sits on its axis"); } else if(c.act==="servo") s-=15;
      if(c.act!=="motor"&&c.geared){ s+=15; why.push("a pulley, gear or sprocket is on it"); }
      if(c.servoOut) s-=30;                                             // a servo's output isn't a motor's joint
      if(u.velocity){ if(c.wheelish){ s+=25; why.push("it carries a wheel"); } if(c.kg<0.6) s+=10; if(c.z>0.18) s+=10; if(c.parts<=8) s+=5; why.push("your code spins it with setVelocity"); }
      else if(u.holds){ s+=35*c.kg/maxKg+15*c.parts/maxParts; why.push("the "+(c.kg>=0.8*maxKg?"heaviest":"heavier")+" joint ("+c.kg.toFixed(1)+" kg, "+c.parts+" parts), held to encoder targets in your code"); if(c.wheelish&&c.kg<0.3) s-=15; }
      else { if(c.wheelish){ s+=25; why.push("it carries a roller or wheel"); } if(/intake|roller|grip|3613/i.test(c.text)) { s+=10; } if(c.kg>0.8*maxKg) s-=10; why.push("your code runs it on plain power"); }
    }
    if(c.parts<=1&&c.span<0.03) s-=20;                                // a bare hub or spline: nothing is on it to move
    return {s, why};
  };
  const pairFit=(a,b)=>{ const dot=Math.abs(a.axis[0]*b.axis[0]+a.axis[1]*b.axis[1]+a.axis[2]*b.axis[2]); const dz=Math.abs(a.z-b.z), dist=Math.hypot(a.pivot[0]-b.pivot[0],a.pivot[1]-b.pivot[1],a.pivot[2]-b.pivot[2]);
    const kgOk=Math.max(a.kg,b.kg)<3*Math.max(1e-3,Math.min(a.kg,b.kg)); return dot>0.95&&dz<0.08&&dist>0.02&&dist<0.6&&kgOk&&a.parts<=3*b.parts&&b.parts<=3*a.parts; };
  // two joints on one axle (a shaft, then the hub on it) are one mechanism: once one is
  // picked, the others on that line are taken with it
  const coaxial=(a,b)=>{ const dot=Math.abs(a.axis[0]*b.axis[0]+a.axis[1]*b.axis[1]+a.axis[2]*b.axis[2]); if(dot<0.995) return false;
    const d=[b.pivot[0]-a.pivot[0],b.pivot[1]-a.pivot[1],b.pivot[2]-a.pivot[2]], t=d[0]*a.axis[0]+d[1]*a.axis[1]+d[2]*a.axis[2];
    return Math.abs(t)<0.3&&Math.hypot(d[0]-t*a.axis[0],d[1]-t*a.axis[1],d[2]-t*a.axis[2])<0.005; };
  const take=c=>{ used.add(c.id); for(const o of cands) if(o!==c&&!used.has(o.id)&&coaxial(c,o)) used.add(o.id); };
  const MIN=45;
  for(let round=0;round<devs.length;round++){
    let best=null;
    for(const d of devs){
      if(out[d.name]) continue;
      const p=partner(d);
      if(p){
        for(const c1 of cands){ if(used.has(c1.id)) continue; const s1=score(d,c1); if(!s1||s1.s<MIN) continue;
          for(const c2 of cands){ if(c2===c1||used.has(c2.id)) continue; const s2=score(p,c2); if(!s2||s2.s<MIN||!pairFit(c1,c2)) continue;
            const s=s1.s+s2.s+30; if(!best||s>best.s) best={s, pair:true, picks:[[d,c1,s1.why],[p,c2,s2.why]]}; } }
      }
      for(const c of cands){ if(used.has(c.id)) continue; const r=score(d,c); if(!r||r.s<MIN) continue; const s=r.s; if(!best||s>best.s) best={s, pair:false, picks:[[d,c,r.why]]}; }
    }
    if(!best) break;
    for(const [d,c,why] of best.picks){ out[d.name]=c.id; take(c);
      picks.push({device:d.name, joint:c.id, label:label(c), score:Math.round(best.pair?best.s/2:best.s), pair:best.pair, why:(best.pair?"one of a matching pair; ":"")+why.join("; ")}); }
  }
  // what's left: a device with exactly one joint that still fits it reasonably takes it
  for(const d of devs){
    if(out[d.name]) continue;
    const fits=cands.filter(c=>!used.has(c.id)).map(c=>({c, r:score(d,c)})).filter(x=>x.r&&x.r.s>=30).sort((a,b)=>b.r.s-a.r.s);
    if(fits.length===1||(fits.length>1&&fits[0].r.s>=fits[1].r.s+15)){ const {c,r}=fits[0]; out[d.name]=c.id; take(c);
      picks.push({device:d.name, joint:c.id, label:label(c), score:Math.round(r.s), pair:false, why:(fits.length===1?"the only joint left that fits; ":"the joint that fits best of what's left; ")+r.why.join("; ")}); }
  }
  for(const p of picks) notes.push(p.device+" drives \""+p.label+"\": "+p.why+".");
  // what each device still unbound would score on every joint (the hardware table's ordering, and debugging)
  const ranked={};
  for(const d of devs) if(!out[d.name]) ranked[d.name]=cands.filter(c=>!used.has(c.id)).map(c=>({c, r:score(d,c)})).filter(x=>x.r&&x.r.s>0).sort((a,b)=>b.r.s-a.r.s).slice(0,8).map(x=>({joint:x.c.id, score:Math.round(x.r.s), why:x.r.why.join("; ")}));
  return {map:out, picks, notes, ranked};
}
