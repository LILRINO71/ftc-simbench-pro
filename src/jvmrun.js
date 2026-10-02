/* ============================================================
   4d. RUNNING AN OPMODE ON THE JAVA VM
   ------------------------------------------------------------
   JvProgram is one Driver Station run of one OpMode: INIT, START,
   one loop pass per sim tick, STOP. It talks to the sim only through
   a host object (Sim.vmHost in src/sim.js), so the same program runs
   headless for the probes below.

   jvAnalyze runs the OpMode a few times on a stand-in robot before
   anything is drawn, the way a team would test it on blocks:
   - which devices it asks hardwareMap for (and as what);
   - which motors are the drive, read from what they DO when the
     sticks move, not from their names;
   - which way each wheel must turn for the code's "forward" to be
     forward, which is how this robot's motors are mounted;
   - which buttons move which mechanisms.
   ============================================================ */
let JV_NATIVES_CACHE=null;
function jvNativeTable(){
  if(!JV_NATIVES_CACHE) JV_NATIVES_CACHE=Object.assign(jvNatives(),JV_PRELUDE_NATIVES);
  return JV_NATIVES_CACHE;
}
const JV_PARSE_CACHE=new Map();
function jvParseCached(src,file){
  const key=file+"\u0000"+src;
  if(JV_PARSE_CACHE.has(key)) return JV_PARSE_CACHE.get(key);
  let u;
  try{ u=jvParse(src,file); }catch(e){ u={error:String(e.message||e),pos:e.jvPos,file}; }
  if(JV_PARSE_CACHE.size>400) JV_PARSE_CACHE.clear();
  JV_PARSE_CACHE.set(key,u);
  return u;
}
/* The OpMode and the team's other files, parsed. libs: [{file, src}] */
function jvCompile(raw,libs){
  const main=jvParseCached(raw,"OpMode.java");
  if(main.error) return {ok:false,err:main.error,pos:main.pos};
  const units=[main], bad=[], srcs={"OpMode.java":raw};
  const seen=new Set([raw]);
  for(const l of libs||[]){
    if(!l||typeof l.src!=="string"||seen.has(l.src)) continue;
    seen.add(l.src);
    const u=jvParseCached(l.src,l.file||"Helper.java");
    if(u.error) bad.push({file:l.file,err:u.error}); else { units.push(u); srcs[l.file||"Helper.java"]=l.src; }
  }
  // the OpMode: the file's top-level class that is one, else its first class
  const t=main.types.find(x=>x.kind==="class")||main.types[0];
  if(!t) return {ok:false,err:"no class in the OpMode file"};
  const fqn=(main.pkg?main.pkg+".":"")+t.name;
  return {ok:true,units,main:fqn,mainDecl:t,bad,srcs};
}
function jvNewVM(comp){
  const vm=new JVM(comp.units.concat(jvPrelude()),jvNativeTable());
  vm.builders=new Set(JV_BUILDERS);
  return vm;
}

function JvProgram(comp,host){
  const vm=jvNewVM(comp);
  this.vm=vm; vm.host=host; vm.prog=this;
  this.comp=comp;
  this.started=false; this.stopAsked=false; this.attached=false;
  this.gen=null; this.waitStart=false; this.resumeAt=0; this.done=false; this.error=null;
  this.cls=vm.classes.get(comp.main);
  this.linear=!!this.cls&&vm.isSubName(this.cls,"LinearOpMode");
  const pad=i=>{ const g=vm.mk("com.qualcomm.robotcore.hardware.Gamepad"); g.n={live:i,snap:{},edge:{}}; return g; };
  this.pads={1:pad(1),2:pad(2)};
  this.tel=vm.mk("org.firstinspires.ftc.robotcore.internal.Telemetry_");
  this.hw=vm.mk(JV_HW+"HardwareMap");
  this.self=null;
}
JvProgram.prototype.fail=function(e){
  if(e&&e.jvStop){ this.done=true; return; }
  const vm=this.vm;
  let msg, cls=null;
  if(e instanceof JvThrow){ const v=e.value; cls=v&&v.__c?v.__c.name:"exception"; msg=(v&&v.n&&v.n.msg)||(v&&v.f&&v.f.message)||""; }
  else msg=String(e&&e.message||e);
  const w=(e&&e.__where)||vm.where(), src=this.comp.srcs&&this.comp.srcs[w.file];
  const line=src&&w.pos!=null?src.slice(0,w.pos).split("\n").length:null;
  this.error={cls:cls||"error",msg:String(msg||"").replace(/ @\d+$/,""),file:w.file,line,in:(w.cls||"")+(w.meth?"."+w.meth+"()":"")};
  this.done=true;
};
/* Drive the program until it blocks: on START, a gate, a sleep, or the end. */
JvProgram.prototype.step=function(){
  if(this.done||!this.gen) return;
  const vm=this.vm;
  vm.budget=vm.BUDGET;
  try{
    for(let guard=0;guard<1e6;guard++){
      const r=this.gen.next();
      if(r.done){ this.gen=null; if(this.linear) this.done=true; return; }
      const b=r.value||{};
      if(b.wait==="start"){ if(this.started){ continue; } this.waitStart=true; return; }
      if(b.sleep!=null){ this.resumeAt=(vm.host?vm.host.now():0)+Math.max(0,b.sleep)/1000; return; }
      return;                                             // a gate: next tick
    }
  }catch(e){ this.fail(e); this.gen=null; }
};
JvProgram.prototype.drain=function(g){
  try{ for(let n=0;n<2e5;n++){ const r=g.next(); if(r.done) return r.value; } }catch(e){ this.fail(e); }
  return undefined;
};
JvProgram.prototype.init=function(){
  const vm=this.vm;
  if(!this.cls){ this.error={cls:"error",msg:"the OpMode class wasn't found"}; this.done=true; return; }
  try{
    this.self=this.drain(vm.construct(this.cls,[]));
  }catch(e){ this.fail(e); }
  if(!this.self||this.done) return;
  this.attached=true;
  if(this.linear){ this.gen=vm.invoke(this.self,"runOpMode",[],null); this.step(); }
  else{ this.drain(vm.invoke(this.self,"init",[],null)); }
};
/* A driver waits for INIT to finish before pressing START: run INIT's sleeps
   (a hub-by-hub firmware readout, a servo settling) until the OpMode parks on
   waitForStart(), sits in an INIT loop, or `maxSec` of INIT has passed. */
JvProgram.prototype.settle=function(maxSec){
  const host=this.vm.host; if(!host||!host.advance||!this.linear) return 0;
  let t=0;
  while(!this.done&&!this.waitStart&&this.gen&&t<(maxSec||8)){
    const now=host.now();
    if(now>=this.resumeAt){ const before=this.resumeAt; this.step(); if(this.resumeAt===before&&!this.waitStart) break; }   // an INIT loop: leave it running
    else { const dt=Math.min(this.resumeAt-now,0.5); host.advance(dt); t+=dt; }
  }
  return t;
};
JvProgram.prototype.start=function(){
  if(this.done&&!this.linear) return;
  this.started=true;
  const vm=this.vm;
  if(this.linear){ if(this.waitStart||this.gen){ this.waitStart=false; this.resumeAt=0; this.step(); } }
  else if(this.self&&!this.done){ this.drain(vm.invoke(this.self,"start",[],null)); }
};
/* One sim tick: threads the OpMode started, then the OpMode itself. */
JvProgram.prototype.tick=function(){
  if(this.done&&!(this.vm.threads&&this.vm.threads.length)) return;
  const vm=this.vm, now=vm.host?vm.host.now():0;
  if(vm.threads) for(const th of vm.threads.slice()){
    if(th.done||now<th.resumeAt) continue;
    vm.budget=vm.BUDGET;
    try{ const r=th.g.next(); if(r.done) th.done=true; else if(r.value&&r.value.sleep!=null) th.resumeAt=now+r.value.sleep/1000; }
    catch(e){ th.done=true; }
  }
  if(this.done) return;
  if(this.linear){
    if(this.waitStart) return;                          // INIT: parked on waitForStart()
    if(now<this.resumeAt) return;
    this.step();
    return;
  }
  if(!this.started){ if(this.self){ const g=vm.invoke(this.self,"init_loop",[],null); this.drain(g); } return; }
  if(now<this.resumeAt) return;
  if(!this.gen) this.gen=vm.invoke(this.self,"loop",[],null);
  // an iterative loop() runs to its end each tick; a sleep inside it holds the next one
  vm.budget=vm.BUDGET;
  try{
    for(let guard=0;guard<1e5;guard++){
      const r=this.gen.next();
      if(r.done){ this.gen=null; return; }
      if(r.value&&r.value.sleep!=null){ this.resumeAt=now+r.value.sleep/1000; return; }
      if(r.value&&r.value.gate) return;
    }
  }catch(e){ this.fail(e); this.gen=null; }
};
JvProgram.prototype.stop=function(){
  this.stopAsked=true;
  if(this.done) return;
  const vm=this.vm;
  if(this.linear){
    // a LinearOpMode sees isStopRequested() and falls out of its loop
    if(this.waitStart){ this.waitStart=false; }
    for(let k=0;k<20&&this.gen&&!this.done;k++){ this.resumeAt=0; this.step(); }
  } else if(this.self){ this.drain(vm.invoke(this.self,"stop",[],null)); }
  this.done=true;
};
/* What the stubs absorbed: calls into libraries the VM doesn't describe. */
JvProgram.prototype.stubs=function(){
  const srcs=this.comp.srcs||{};
  return Array.from(this.vm.stubbed.entries()).sort((a,b)=>b[1].n-a[1].n).map(([k,v])=>{
    const src=srcs[v.file]; return [k,v.n,v.file||null,src&&v.pos!=null?src.slice(0,v.pos).split("\n").length:null]; });
};

/* ---- a stand-in robot for the probes ---- */
function jvProbeHost(){
  const H={t:0,clock:0,h:0,pads:{1:{},2:{}},devs:new Map(),cmds:[],tel:[]};
  H.host={
    dev(name,type,kind){ let s=H.devs.get(name); if(!s){ s={name,type,kind,cmd:kind==="servo"?null:0,act:0,ticks:0,offset:0,vel:0,target:0,reversed:false,mode:"run",tpr:537.7,spec:{rpm:312}}; H.devs.set(name,s); } return s; },
    pad(i){ return H.pads[i]||{}; },
    now(){ return H.clock; }, runtime(){ return H.t; }, heading(){ return H.h; }, omega(){ return 0; },
    pose(){ return {x:0,y:0,h:H.h}; }, vel(){ return {x:0,y:0}; }, ray(){ return 8.19; }, color(){ return [120,120,120]; }, volts(){ return 12.6; },
    touch(){ return false; }, telemetry(l){ H.tel=l; }, rumble(){}, advance(dt){ H.clock+=dt; },
    cmd(name,op,v){ H.cmds.push([name,op,v]); },
  };
  return H;
}
/* One run: INIT, START, then `ticks` passes with these sticks. */
function jvProbeRun(comp,pad1,pad2,ticks){
  const H=jvProbeHost(), P=new JvProgram(comp,H.host);
  P.init(); P.settle(8);
  for(let k=0;k<3&&!P.done;k++){ H.clock+=0.02; P.tick(); }        // a few INIT ticks, like a driver waiting
  H.pads={1:Object.assign({},pad1||{}),2:Object.assign({},pad2||{})};
  P.start();
  for(let k=0;k<(ticks||6);k++){ H.clock+=0.02; H.t+=0.02; P.tick(); for(const [,s] of H.devs) s.ticks+=(s.cmd||0)*8; }
  const motors={};
  for(const [n,s] of H.devs) motors[n]={cmd:s.cmd, reversed:!!s.reversed, kind:s.kind, type:s.type, target:s.target, mode:s.mode};
  return {P,H,motors};
}
const JV_STICKS={F:{left_stick_y:-1},S:{left_stick_x:1},T:{right_stick_x:1},R:{right_stick_y:-1},L2:{left_trigger:1},R2:{right_trigger:1}};
/* What the OpMode does with the robot, found by running it. */
function jvAnalyze(comp,isAuto){
  const out={ok:false,devices:[],drive:null,error:null,stubs:[],mech:{},commanded:[],ranges:{},telemetry:[]};
  const base=jvProbeRun(comp,{},{},isAuto?150:6);
  out.error=base.P.error; out.stubs=base.P.stubs();
  out.telemetry=base.H.tel;
  const devs=base.P.vm.devices?Array.from(base.P.vm.devices.values()):[];
  if(base.P.error&&!devs.length){ return out; }
  out.ok=true;
  const runs={N:base};
  if(!isAuto) for(const k in JV_STICKS){ runs[k]=jvProbeRun(comp,JV_STICKS[k],{},6); for(const d of runs[k].P.vm.devices?runs[k].P.vm.devices.values():[]) if(!devs.find(x=>x.name===d.name)) devs.push(d); }
  const intents=jvIntents(comp.srcs||{});
  // named by its configuration name (the same in every file that asks for it); the
  // variable the line reader would have named it by is kept as its alias
  out.devices=devs.map(d=>{ const it=intents[d.name]||{}, intent=it.intent||"";
    return {name:d.name,type:d.type,kind:d.kind,cfg:d.name,alias:it.var&&it.var!==d.name?it.var:null,intent,declaredRole:/torque/i.test(intent)?"Torque":(/speed/i.test(intent)?"Speed":null),fromVm:true}; });
  // every command any run gave, for "is this device ever commanded"
  const cmdOf=new Map();
  // what moves a device: power, position, velocity, a target; not setDirection
  for(const k in runs) for(const [n,op,v] of runs[k].H.cmds){ if(op==="setDirection") continue; if(!cmdOf.has(n)) cmdOf.set(n,[]); cmdOf.get(n).push([op,v]); }
  out.commanded=Array.from(cmdOf.keys());
  for(const [n,l] of cmdOf){ const p=l.filter(x=>x[0]==="setPosition").map(x=>x[1]); if(p.length) out.ranges[n]={lo:Math.min(...p),hi:Math.max(...p),n:p.length}; }
  if(!isAuto) out.drive=jvDriveFrom(runs,devs);
  // given power while still in STOP_AND_RESET_ENCODER: on the robot that motor
  // stays off (the SDK removes power in that mode until another mode is set)
  out.heldByReset=[];
  for(const k in runs) for(const [n,m] of Object.entries(runs[k].motors))
    if(m.mode==="reset"&&m.cmd&&out.heldByReset.indexOf(n)<0) out.heldByReset.push(n);
  return out;
}
/* The drive base, read off what the motors do when the sticks move.
   Assume the code is right on its own robot: stick up rolls every wheel
   forward. So sign(power under stick up) is how that wheel is mounted,
   and turn and strafe then say which corner each wheel is on. */
function jvDriveFrom(runs,devs){
  const motors=devs.filter(d=>d.kind==="motor").map(d=>d.name);
  const val=(k,n)=>{ const m=runs[k]&&runs[k].motors[n]; if(!m) return 0; return (m.cmd||0)*(m.reversed?-1:1); };
  const d0=(k,n)=>val(k,n)-val("N",n);
  const EPS=0.05;
  // the turn: the right stick's x, or (when it moves no motor) the right trigger,
  // as teams who turn with the triggers (right_trigger - left_trigger) have it
  const turnKey=motors.some(n=>Math.abs(d0("T",n))>EPS)||!runs.R2?"T":"R2";
  const d=(k,n)=>d0(k==="T"?turnKey:k,n);
  let cand=motors.filter(n=>Math.abs(d("F",n))>EPS||Math.abs(d("T",n))>EPS||Math.abs(d("S",n))>EPS||Math.abs(d("R",n))>EPS);
  // the wheels all get about the same power from a full stick; a lift or an
  // extension that also follows it a little (a PID, a feed-forward) gets much less
  const top=Math.max(0,...cand.map(n=>Math.abs(d("F",n))));
  if(top>EPS) cand=cand.filter(n=>Math.abs(d("F",n))>=0.5*top||Math.abs(d("R",n))>EPS);
  if(cand.length<2) return null;
  // tank: stick up moves one side only, the right stick's y moves the other
  const fOnly=cand.filter(n=>Math.abs(d("F",n))>EPS), rOnly=cand.filter(n=>Math.abs(d("R",n))>EPS&&Math.abs(d("F",n))<=EPS);
  const tank=rOnly.length>0&&fOnly.length>0&&fOnly.every(n=>Math.abs(d("R",n))<=EPS);
  const wheels=[];
  for(const n of cand){
    let left=false,right=false,front=false,back=false,sigma=0;
    const f=d("F",n), t=d("T",n), s=d("S",n), r=d("R",n);
    if(tank){ if(Math.abs(f)>EPS){ left=true; sigma=Math.sign(f); } else { right=true; sigma=Math.sign(r); } }
    else{
      sigma=Math.abs(f)>EPS?Math.sign(f):0;
      if(sigma){
        if(t*sigma>EPS) left=true; else if(t*sigma<-EPS) right=true;
        if(s*sigma>EPS){ if(left) front=true; else if(right) back=true; }        // FL, BR forward under strafe right
        else if(s*sigma<-EPS){ if(left) back=true; else if(right) front=true; }   // BL, FR backward
      }
    }
    // a name says more than nothing when the probe can't
    const c=typeof wheelCorner==="function"?wheelCorner(n):{};
    if(!left&&!right){ left=!!c.left; right=!!c.right; }
    if(!front&&!back){ front=!!c.front; back=!!c.back; }
    if(!sigma) continue;                                  // not driven by "stick up": not a wheel
    wheels.push({dev:n,left,right,front,back,sense:sigma});
  }
  // every drive wheel answers the turn stick; a lift or an extension that also
  // follows "stick up" doesn't (when at least two motors do turn the robot)
  if(!tank&&wheels.filter(w=>Math.abs(d("T",w.dev))>EPS).length>=2)
    for(let i=wheels.length-1;i>=0;i--) if(Math.abs(d("T",wheels[i].dev))<=EPS) wheels.splice(i,1);
  if(wheels.length<2) return null;
  const hasSide=wheels.some(w=>w.left)&&wheels.some(w=>w.right);
  const strafes=wheels.some(w=>Math.abs(d("S",w.dev))>EPS);
  return {wheels,style:!tank&&strafes&&wheels.length>=4?"mecanum":"tank",ok:hasSide,fromCode:true};
}

/* parseJava's VM half: compile, analyse, and say whether the VM should run it. */
const JV_MEMO=new Map();
function jvCodeFor(raw,libs,isAuto){
  const key=(isAuto?"A":"T")+raw.length+":"+raw+"\u0001"+(libs||[]).map(l=>l&&l.src?l.src.length+":"+l.src:"").join("\u0002");
  if(JV_MEMO.has(key)) return JV_MEMO.get(key);
  const r=jvCodeFor0(raw,libs,isAuto);
  if(JV_MEMO.size>30) JV_MEMO.clear();
  JV_MEMO.set(key,r);
  return r;
}
/* The comment written above a device's declaration, wherever it lives:
   "// 435 rpm goBILDA Yellow Jacket" names the motor (src/hardware.js specFor) */
function jvIntents(srcs){
  const out={};
  for(const f in srcs){
    const src=srcs[f], lines=src.split(/\r?\n/);
    const re=/(?:this\s*\.\s*)?([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)\s*)?(?:[\w$]+\s*\.\s*)?(?:hardwareMap|hwMap|hw|map|hardware|hMap|ahwMap)\s*\.\s*(?:get\s*\(\s*[\w.]+\s*\.\s*class\s*,\s*|\w+\s*\.\s*get\s*\(\s*)"([^"]+)"/g;
    let m;
    while((m=re.exec(src))){
      const v=m[1], cfg=m[2];
      if(out[cfg]&&out[cfg].intent) continue;
      if(!out[cfg]) out[cfg]={intent:"",var:v};
      const dl=lines.findIndex(l=>new RegExp("\\b(?:"+DEVT+"|\\w*Motor\\w*|\\w*Servo\\w*)\\s+"+v.replace(/\$/g,"\\$")+"\\s*[;=,]").test(l));
      if(dl<0) continue;
      const got=[];
      for(let L=dl-1;L>=0&&L>dl-5;L--){ const t=lines[L].trim(); if(/^\/\//.test(t)){ const c=t.replace(/^\/+\s*/,"").trim(); if(c&&!/^=+$/.test(c)) got.unshift(c); } else break; }
      const tail=/\/\/\s*(.+)$/.exec(lines[dl]); if(tail) got.push(tail[1].trim());
      out[cfg]={intent:got.join(" "), var:v};
    }
  }
  return out;
}
function jvCodeFor0(raw,libs,isAuto){
  const comp=jvCompile(raw,libs);
  if(!comp.ok) return {ok:false,err:comp.err,comp};
  let an;
  try{ an=jvAnalyze(comp,isAuto); }catch(e){ return {ok:false,err:String(e&&e.message||e),comp}; }
  return {ok:an.ok,comp,an,err:an.error&&(an.error.cls+": "+an.error.msg)};
}

/* Which controls move which devices: hold each one from START and compare
   with an untouched run. Gives the controls list and "is this ever moved". */
const JV_CONTROLS=["a","b","x","y","dpad_up","dpad_down","dpad_left","dpad_right","left_bumper","right_bumper","left_trigger","right_trigger",
  "right_stick_y","left_stick_button","right_stick_button","back","start"];
/* The controls the code reads anywhere: gamepad fields, SDK 10 edge methods, FTCLib keys */
function jvControlsRead(comp){
  const all=Object.values(comp.srcs||{}).join("\n"), out=new Set();
  let m;
  const re=/\b(?:gamepad[12]|\w*[Gg]amepad\w*|driver\w*|operator\w*|gp[12]?)\s*\.\s*([a-z_]+)\b/g;
  while((m=re.exec(all))) out.add(m[1]);
  const re2=/\b([a-z]+(?:[A-Z][a-z]+)*)Was(?:Pressed|Released)\s*\(/g;
  while((m=re2.exec(all))) out.add(m[1].replace(/([A-Z])/g,"_$1").toLowerCase());
  const re3=/\b(?:Button|Trigger)\s*\.\s*([A-Z_]+)\b/g;
  while((m=re3.exec(all))){ const k=m[1].toLowerCase(); out.add(({cross:"a",circle:"b",square:"x",triangle:"y",options:"start",share:"back"})[k]||k); }
  if(/getRightY|getLeftY|getRightX|getLeftX/.test(all)) ["right_stick_y","left_stick_y"].forEach(x=>out.add(x));
  return JV_CONTROLS.filter(c=>out.has(c));
}
function jvMechProbe(comp,an){
  const base=jvProbeRun(comp,{},{},8), B=[];
  const used=jvControlsRead(comp);
  const snap=r=>{ const o={}; for(const [n,s] of r.H.devs) o[n]=[s.cmd==null?null:+s.cmd,+s.target||0,s.mode]; return o; };
  const b0=snap(base);
  const drive=new Set(an.drive?an.drive.wheels.map(w=>w.dev):[]);
  for(const pad of [1,2]) for(const c of used){
    const v=/trigger/.test(c)?1:/_stick_y$/.test(c)?-1:true;
    const p={}; p[c]=v;
    let r; try{ r=jvProbeRun(comp,pad===1?p:{},pad===2?p:{},8); }catch(e){ continue; }
    const now=snap(r);
    for(const n in now){
      if(drive.has(n)) continue;
      const a=now[n], b=b0[n]||[null,0,"run"];
      if(a[0]!==b[0]&&!(a[0]==null&&b[0]==null)&&Math.abs((a[0]||0)-(b[0]||0))>0.02||Math.abs(a[1]-b[1])>2){
        const s=r.H.devs.get(n);
        B.push({pad,btn:c,cond:null,dev:n,op:s.kind==="servo"?"setPosition":(a[2]==="rtp"?"setTargetPosition":"setPower"),expr:"",axes:[],vm:true,to:a[0]});
      }
    }
  }
  return B;
}
/* parseJava's last step: run the code on the VM when the line reader can't. */
function jvMaybe(out,raw,opts){
  const want=opts&&opts.engine;
  if(want==="legacy"||typeof JVM!=="function") return out;
  if(out.rr&&want!=="vm") return out;               // a Road Runner auto: src/roadrunner.js follows its trajectories
  let legacyFull=false, cov=null;
  try{ cov=coverage(out); legacyFull=out.devices.length>0&&(out.hasLoop||(out.auto&&out.auto.length>0))&&cov.skipped.length===0; }catch(e){}
  if(legacyFull&&want!=="vm"){
    // the line reader follows every line, but it places wheels by their names, and
    // a team's config names don't always match where the motors sit. Running the
    // code says which side and end each wheel is really on (src/mapping.js uses it).
    try{ const r0=jvCodeFor(raw,(opts&&opts.libs)||[],false), an0=r0&&r0.an;
      if(an0&&!an0.error&&an0.drive&&an0.drive.ok) out.vmDrive=an0.drive; }catch(e){}
    return out;
  }
  const isAuto=out.kind==="Autonomous"||(!out.hasLoop&&out.auto&&out.auto.length>0&&!/@TeleOp/.test(raw));
  const r=jvCodeFor(raw,(opts&&opts.libs)||[],isAuto);
  const an=r.an;
  if(!r.ok||!an||!an.devices.length||(an.devices.length<out.devices.length&&want!=="vm")){ out.vmTried={err:r.err||(an&&an.error?an.error.cls+": "+an.error.msg:"found no hardware")}; return out; }
  const legacy=out;
  const v=Object.assign({},out,{
    // the line reader's constants, statements and fields stay as a static view of
    // the file (the math sheet reads gear ratios and gains from them); the VM runs it
    engine:"vm", devices:an.devices, hasLoop:!isAuto, hasWait:true,
    vm:{comp:r.comp, an, error:an.error, stubs:an.stubs.slice(0,40)}, legacy:{devices:legacy.devices.length, skipped:cov?cov.skipped.length:null}
  });
  // which control moves what: probed once per code (r is memoized), never against the clock
  if(!r.bindings){ try{ r.bindings=isAuto?[]:jvMechProbe(r.comp,an); }catch(e){ r.bindings=[]; } }
  v.bindings=r.bindings.slice();
  for(const b of v.bindings) if(an.commanded.indexOf(b.dev)<0) an.commanded.push(b.dev);
  // drive bindings: the sticks feed the wheels
  if(an.drive) for(const w of an.drive.wheels) for(const ax of ["left_stick_y","left_stick_x","right_stick_x"])
    v.bindings.push({pad:1,btn:ax,cond:null,dev:w.dev,op:"setPower",expr:"",axes:["gamepad1."+ax],analog:true,vm:true});
  return v;
}
/* The probe's results stand in for the statement tree in the checks */
function jvCommanded(code,name){ return !!(code&&code.vm&&code.vm.an&&code.vm.an.commanded.indexOf(name)>=0); }
