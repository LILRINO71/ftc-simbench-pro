/* ============================================================
   7.  SIMULATION  — interprets the statement tree
   Mirrors the Driver Station: load an OpMode, INIT runs everything
   before waitForStart(), START runs the loop (TeleOp) or steps the
   sequence (Autonomous), STOP halts motors.
   ============================================================ */
const Sim={
  dev:{}, vars:{}, pad:{1:{},2:{}}, t:0, chassis:{x:0,y:0,h:0}, phase:"empty",

  /* Build devices and state for an OpMode. Nothing runs yet. */
  load(code,cad,map,opts){
    // every CAD runs in the canonical robot frame; the parser does this for
    // STEP files, and this catches the rest (the sample, older workspaces)
    if(typeof canonicalizeCAD==="function") canonicalizeCAD(cad,{up:opts&&opts.up});
    // no front given: the way the wheels roll (see frontFromWheels)
    if(opts&&!opts.front&&typeof frontFromWheels==="function") opts.front=frontFromWheels(cad)||"+x";
    this.dev={}; this.vars={}; this.t=0; this.pids={}; this.timers={};
    const sp=(opts&&opts.startPose)||{x:0,y:0,h:0};
    this.chassis={x:sp.x,y:sp.y,h:sp.h};
    this.code=code; this.cad=cad; this.map=map; this.opts=opts;
    this.bump=null; this.vel={x:0,y:0};
    this.pc=0; this.sleepEnd=null; this.sleptMs=0; this.autoDone=false;
    for(const d of code.devices){
      const mech=cad.mechs.filter(m=>m.id===map[d.name])[0]||null;
      const spec=specFor(d,mech,opts.trust);
      const isMotor=spec.kind==="motor"||spec.kind==="crservo";
      this.dev[d.name]={kind:isMotor?"motor":"servo", mech, spec,
        cmd:isMotor?0:0.5, act:isMotor?0:0.5, revs:0, ticks:0, stalled:false,
        reversed:false, mode:"run", target:0,
        tpr: 28*(spec.ratio||19.2),        // goBILDA: 28 counts per motor rev
        restPos:restPosOf(code,d.name),
        sec60:spec.sec60||0.18, travelDeg:travelDegOf(spec)};
    }
    for(const v in code.vars) this.vars[v]=code.vars[v];
    for(const n of (code.timers||[])) this.timers[n]=0;
    this.dt=0.02;
    this.drivetrain=detectDrivetrain(code);
    // a CAD of just a mechanism still drives on a drawn drive base
    this.base=robotBase(cad,this.drivetrain,opts&&opts.baseModel,opts&&opts.front);
    this.footprint=footprintOf(cad,opts&&opts.front,this.base);
    this.obstacles=Field.ok?Field.obstacles(this.footprint.h):[];
    // the physical rig underneath: mass, wheels, motors. Null means we fall
    // back to the old kinematic glide, which is also what "kinematic" asks for.
    this.physics=(opts&&opts.physics)||"rigid";
    this.rig=buildRig(cad,this.drivetrain,this.base,this.dev,opts);
    this.dstate=this.rig?Dyn.reset(this.rig):null;
    this.slipping=false;
    this.phase="loaded";
  },
  /* INIT: everything before waitForStart() — directions, PID objects, start positions. */
  init(){
    if(!this.code) return;
    this.exec(this.code.inits||[],this.env());
    for(const n in this.dev){ const s=this.dev[n]; if(s.kind==="servo") s.act=s.cmd; }
    this.phase="init";
  },
  start(){
    if(!this.code) return;
    if(this.phase==="loaded") this.init();
    this.t=0; this.pc=0; this.sleepEnd=null; this.autoDone=false;
    for(const n in this.timers) this.timers[n]=0;
    this.phase="running";
  },
  stop(){
    for(const n in this.dev){ const s=this.dev[n]; if(s.kind==="motor"){ s.cmd=0; s.mode="run"; } }
    this.phase="stopped";
  },
  /* One call from load to running — what the tests and headless runs use. */
  reset(code,cad,map,opts){ this.load(code,cad,map,opts); this.init(); this.start(); },

  /* ---- PID objects the OpMode constructs (ftclib, RoadRunner, hand-rolled) ---- */
  pidOp(name,meth,a){
    const st=this.pids[name]||(this.pids[name]={p:0,i:0,d:0,sum:0,prev:null});
    if(meth==="setPID"||meth==="setPIDF"){ st.p=a[0]||0; st.i=a[1]||0; st.d=a[2]||0; return 0; }
    if(meth==="setP"){ st.p=a[0]||0; return 0; }
    if(meth==="setI"){ st.i=a[0]||0; return 0; }
    if(meth==="setD"){ st.d=a[0]||0; return 0; }
    if(meth==="reset"){ st.sum=0; st.prev=null; return 0; }
    if(meth==="calculate"){
      const cur=a[0]||0, tgt=(a.length>1?a[1]:0)||0;
      const err=tgt-cur, dt=this.dt||0.02;
      st.sum=Math.max(-1e7,Math.min(1e7,st.sum+err*dt));
      const der=(st.prev===null)?0:(err-st.prev)/dt;
      st.prev=err;
      st.err=err;
      return st.p*err + st.i*st.sum + st.d*der;
    }
    return 0;
  },
  env(){
    const self=this;
    return {
      get(n){
        if(n==="__imuYaw") return self.chassis.h;
        if(n==="__imuPitch"||n==="__imuRoll") return 0;
        if(self.vars[n]!==undefined) return self.vars[n];
        if(self.code.consts[n]!==undefined) return self.code.consts[n];
        const m=/^([A-Za-z_$][\w$]*)\.getPosition$/.exec(n);
        if(m&&self.dev[m[1]]) return self.dev[m[1]].cmd;
        return 0;
      },
      device(name,meth){
        const s=self.dev[name]; if(!s) return 0;
        if(meth==="getCurrentPosition") return Math.round(s.ticks);
        if(meth==="getTargetPosition") return s.target;
        if(meth==="getPosition") return s.cmd;
        if(meth==="getPower") return s.cmd;
        if(meth==="getVelocity") return (s.spec.rpm||300)*s.act*s.tpr/60;
        if(meth==="isBusy") return (s.mode==="rtp"&&Math.abs(s.target-s.ticks)>10)?1:0;
        return 0;
      },
      pid(name,meth,a){ return self.pidOp(name,meth,a); },
      timer(name,unit){
        if(self.timers[name]===undefined) return 0;
        const s=self.t-self.timers[name];
        return unit==="milliseconds"?s*1000 : unit==="nanoseconds"?s*1e9 : s;
      },
      runtime(){ return self.t; },
      active(){ return self.phase==="running"?1:0; },
      pad(ref){
        const r=splitPadRef(ref); if(!r) return 0;
        const st=self.pad[r.pad]||{};
        const v=st[r.btn];
        if(v===undefined) return 0;
        return typeof v==="boolean" ? (v?1:0) : v;
      }
    };
  },
  exec(list,env){
    for(const st of list){
      if(st.kind==="if"){
        if(evalNode(st.condAst,env)) this.exec(st.then,env);
        else if(st.else) this.exec(st.else,env);
      }else if(st.kind==="assign"){
        const v=evalNode(st.ast,env);
        const cur=this.vars[st.name]!==undefined?this.vars[st.name]:(this.code.consts[st.name]||0);
        this.vars[st.name] =
          st.op==="+"?cur+v : st.op==="-"?cur-v : st.op==="*"?cur*v : st.op==="/"?(v?cur/v:cur) : v;
      }else if(st.kind==="call"){
        const s=this.dev[st.dev]; if(!s) continue;
        const v=evalNode(st.ast,env);
        /* setDirection(REVERSE) cancels a mirrored mounting. Since the bench
           doesn't model the mirrored mounting either, applying the reversal
           here would double-count it — a robot told to drive forward would
           spin. It's tracked for reporting instead. */
        if(st.op==="setPosition") s.cmd=clamp01(v);
        else if(st.op==="setVelocity") s.cmd=Math.max(-1,Math.min(1,v/((s.spec.rpm||300)/60*s.tpr)));   // ticks/s → share of free speed
        else s.cmd=Math.max(-1,Math.min(1,v));
      }else if(st.kind==="pidnew"){
        const a=st.args.map(x=>evalNode(x,env));
        this.pidOp(st.obj,"setPID",a);
      }else if(st.kind==="sleep"){
        // inside a TeleOp loop a sleep blocks the robot; the analysis reports it
        this.sleptMs=(this.sleptMs||0)+(st.ast?evalNode(st.ast,env):(st.ms||0));
      }else if(st.kind==="objcall"){
        const s=this.dev[st.obj];
        if(this.timers[st.obj]!==undefined){ if(st.meth==="reset") this.timers[st.obj]=this.t; }
        else if(s&&st.meth==="setDirection") s.reversed=/REVERSE/i.test(st.raw||"");
        else if(s&&st.meth==="setTargetPosition") s.target=evalNode(st.args[0],env);
        else if(s&&st.meth==="setMode"){
          const raw=st.raw||"";
          if(/STOP_AND_RESET_ENCODER/.test(raw)){ s.ticks=0; s.revs=0; s.cmd=0; }
          else if(/RUN_TO_POSITION/.test(raw)) s.mode="rtp";
          else if(/RUN_USING_ENCODER|RUN_WITHOUT_ENCODER/.test(raw)) s.mode="run";
        }
        else if(/^set(PID|PIDF|P|I|D)$|^reset$/.test(st.meth) && !s)
          this.pidOp(st.obj,st.meth,st.args.map(x=>evalNode(x,env)));
        else if(st.meth==="resetYaw") this.chassis.h=0;
        else if(/^gamepad[12]$/.test(st.obj)&&this.onRumble&&/^(rumble|rumbleBlips|stopRumble)$/.test(st.meth))
          this.onRumble(+st.obj.slice(-1),st.meth,st.args.map(x=>evalNode(x,env)));   // a real controller buzzes
      }
      // "while" and "unknown" nodes only mean something to the autonomous stepper
    }
  },
  /* Autonomous: run statements in order. sleep() and wait loops hold the
     program counter while simulated time passes, exactly as they hold the
     real OpMode thread. */
  stepAuto(){
    const prog=this.code.auto||[]; const env=this.env();
    for(let guard=0; this.pc<prog.length && guard<500; guard++){
      const st=prog[this.pc];
      if(st.kind==="sleep"){
        if(this.sleepEnd==null){
          const ms=st.ast?evalNode(st.ast,env):(st.ms||0);
          this.sleepEnd=this.t+Math.max(0,ms)/1000;
        }
        if(this.t<this.sleepEnd) return;
        this.sleepEnd=null; this.pc++; continue;
      }
      if(st.kind==="while"){
        if(evalNode(st.condAst,env)){ this.exec(st.body,env); return; }   // one pass per tick
        this.pc++; continue;
      }
      this.exec([st],env); this.pc++;
    }
    if(this.pc>=prog.length) this.autoDone=true;
  },
  tick(dt){
    if(!this.code||this.phase==="empty") return;
    this.dt=dt;
    if(this.phase==="running"){
      this.t+=dt;
      if(this.code.hasLoop) this.exec(this.code.stmts,this.env());
      else if(this.code.auto&&this.code.auto.length) this.stepAuto();
    }

    for(const name in this.dev){
      const s=this.dev[name];
      if(s.kind==="motor"){
        let drive=s.cmd;
        if(s.mode==="rtp"){
          /* RUN_TO_POSITION: the hub's own loop, capped by the commanded power.
             Start slowing inside the distance the motor needs to stop from that
             power — a fixed small band overshoots badly at speed. */
          const err=s.target-s.ticks;
          const perSec=(s.spec.rpm||300)/60*s.tpr;           // ticks/s at full power
          const stop=Math.abs(s.cmd)*Math.abs(s.cmd)*perSec/(2*SLEW);
          const band=Math.max(8,1.8*stop);
          drive=Math.abs(s.cmd)*Math.max(-1,Math.min(1,err/band));
        }
        const slew=SLEW*dt;
        s.act += Math.sign(drive-s.act)*Math.min(Math.abs(drive-s.act),slew);
        const rpm=(s.spec.rpm||300)*s.act;
        s.revs += rpm/60*dt;
        s.ticks = s.revs*s.tpr;                 // what getCurrentPosition() reads
        s.stalled=false;
        continue;
      }
      const rate=60/(s.sec60*s.travelDeg);
      const err=s.cmd-s.act;
      const step=Math.sign(err)*Math.min(Math.abs(err), rate*dt);
      const want=s.act+step;
      s.stalled=false;
      if(s.mech&&s.mech.kind==="revolute-lift"&&leverOf(s.mech)>0&&s.spec.stallNm){
        const distal=this.opts.payloadKg+0.060+0.055;
        const usable=s.spec.stallNm*this.opts.duty;
        const req=holdTorque(s.mech, armAngleDeg(s.mech,s.spec,want,s.restPos), distal);
        if(req>usable){ s.stalled=true; if(step>0) continue; }
      }
      s.act=want;
    }
    this.driveChassis(dt);
    Shots.tick(dt,this.chassis);
  },
  driveChassis(dt){
    const dtn=this.drivetrain;
    if(!dtn||!dtn.ok){ this.vel={x:0,y:0}; return; }
    const x0=this.chassis.x, y0=this.chassis.y;
    if(this.rig&&this.physics!=="kinematic"){
      this.stepRigid(dt);
      const xi=this.chassis.x, yi=this.chassis.y;       // where the physics wanted to be
      if(Field.ok) this.bump=Field.collide(this.chassis,this.footprint,this.obstacles);
      else {
        const LIM=1.78;
        this.chassis.x=Math.max(-LIM,Math.min(LIM,this.chassis.x));
        this.chassis.y=Math.max(-LIM,Math.min(LIM,this.chassis.y));
      }
      this.vel={x:(this.chassis.x-x0)/dt, y:(this.chassis.y-y0)/dt};
      this.stopAgainst(this.chassis.x-xi, this.chassis.y-yi);
      return;
    }
    // Kinematic mode for anything that isn't a left/right base: forward
    // kinematics from the rig's real wheels. The left/right average below
    // can't turn a kiwi or a swerve at all.
    const rk=this.rig&&this.rig.drive.kind;
    if(this.rig&&rk!=="tank"&&rk!=="mecanum"){
      this.steerModules();
      const SPD=1.15;                          // m/s of rim at full power, as below
      const W=this.rig.drive.wheels, fk=fkFromIk(ikMatrix(rk,W));
      const t=chassisFromWheels(fk,this.rig.devs.map(n=>{ const sd=this.dev[n]; return (sd?sd.act:0)*SPD; }));
      const h=this.chassis.h, c=Math.cos(h), s=Math.sin(h);
      this.chassis.x+=(t.vx*c-t.vy*s)*dt; this.chassis.y+=(t.vx*s+t.vy*c)*dt; this.chassis.h+=t.omega*dt;
      if(Field.ok) this.bump=Field.collide(this.chassis,this.footprint,this.obstacles);
      this.vel={x:(this.chassis.x-x0)/dt, y:(this.chassis.y-y0)/dt};
      return;
    }
    let L=0,R=0,nl=0,nr=0,strafe=0;
    for(const w of dtn.wheels){
      const s=this.dev[w.dev]; if(!s) continue;
      if(w.left){ L+=s.act; nl++; } else if(w.right){ R+=s.act; nr++; }
    }
    if(nl) L/=nl; if(nr) R/=nr;
    if(dtn.style==="mecanum"){
      // strafe shows up as front/back disagreement on the same side
      const lf=this.dev[(dtn.wheels.filter(w=>w.left&&w.front)[0]||{}).dev];
      const lb=this.dev[(dtn.wheels.filter(w=>w.left&&w.back)[0]||{}).dev];
      if(lf&&lb) strafe=(lf.act-lb.act)/2;
    }
    const SPEED=1.15, TURN=3.4;               // m/s and rad/s at full power
    const v=(L+R)/2*SPEED, w=(R-L)/2*TURN;
    this.chassis.h += w*dt;
    this.chassis.x += (v*Math.cos(this.chassis.h) - strafe*SPEED*Math.sin(this.chassis.h))*dt;
    this.chassis.y += (v*Math.sin(this.chassis.h) + strafe*SPEED*Math.cos(this.chassis.h))*dt;
    if(Field.ok) this.bump=Field.collide(this.chassis,this.footprint,this.obstacles);
    else {
      const LIM=1.78;                          // half a nominal 12 ft field
      this.chassis.x=Math.max(-LIM,Math.min(LIM,this.chassis.x));
      this.chassis.y=Math.max(-LIM,Math.min(LIM,this.chassis.y));
    }
    // what the robot actually did, walls included — a moving shot carries it
    this.vel={x:(this.chassis.x-x0)/dt, y:(this.chassis.y-y0)/dt};
  },

  /* One step of real chassis dynamics: motor torque through the wheels,
     limited by what the tiles will take, against the robot's own mass and
     yaw inertia. Velocities come back in the chassis frame. */
  /* Point every swerve module where its steering actuator says. */
  steerModules(){
    const r=this.rig; if(!r||!r.steer) return;
    const c=r.steerCfg;
    r.steer.forEach((n,i)=>{ const s=n&&this.dev[n]; if(!s) return;
      r.drive.wheels[i].alpha=c.sense*(s.act-c.zero)*c.travel; });
  },

  stepRigid(dt){
    this.steerModules();
    const cmd=this.rig.devs.map(n=>{ const s=this.dev[n]; return s?s.act:0; });
    const st=Dyn.step(this.dstate,cmd,this.rig,dt);
    this.dstate=st;
    const c=Math.cos(this.chassis.h), s=Math.sin(this.chassis.h);
    this.chassis.x += (st.v.x*c - st.v.y*s)*dt;
    this.chassis.y += (st.v.x*s + st.v.y*c)*dt;
    this.chassis.h += st.omega*dt;
    this.slipping=(st.slip||[]).some(k=>Math.abs(k)>0.3);
  },

  /* A wall stops a robot, it doesn't throw it back. (px,py) is how far the
     field had to push to get the robot out of something, so it points out of
     whatever was hit: take that component out of the velocity and leave the
     rest, and the robot sits against the HIVE instead of bouncing off it.
     Reading the push back as velocity — displacement over dt — looks right
     and is very wrong: it hands the robot metres per second it never had. */
  stopAgainst(px,py){
    const L=Math.hypot(px,py);
    if(!(L>1e-12)||!this.dstate) return;
    const nx=px/L, ny=py/L, h=this.chassis.h, c=Math.cos(h), s=Math.sin(h);
    const v=this.dstate.v;
    let wx=v.x*c-v.y*s, wy=v.x*s+v.y*c;              // chassis frame -> world
    const into=wx*nx+wy*ny;
    if(into<0){ wx-=into*nx; wy-=into*ny; }          // only the part driving in
    this.dstate.v={x:wx*c+wy*s, y:-wx*s+wy*c};
  }
};

/* The rig the chassis dynamics runs on: one wheel per driven motor, placed
   from the CAD when its wheels are in the assembly and from the drawn base
   when they are not. The code always says which corner a motor drives, even
   for a CAD that has no wheels at all, so there is always something to run. */
/* A competition robot with a battery and a full build on it, for when the CAD
   can't say. 12 kg sits in the middle of what FTC robots actually weigh; the
   limit is 19 kg. */
const ASSUMED_KG=12, ASSUMED_MIN_KG=2;
function buildRig(cad,dtn,base,dev,opts){
  if(!dtn||!dtn.ok||typeof Dyn==="undefined"||typeof massProps!=="function") return null;
  const o=opts||{};
  // Everything below is in ONE frame: the robot's own (x forward, y left, z up,
  // origin at the drivetrain centre on the floor). The CAD arrives canonical
  // (src/frame.js) — up-aligned and centred — so the only rotation left is
  // which way is forward. Mixing frames here is exactly what made a robot
  // lurch sideways when it turned in place.
  const toR=typeof frontToRobot==="function"?frontToRobot(o.front):(p=>p);
  let props=massProps(cad,{payloadKg:o.payloadKg});
  // A STEP with no solid parts (or a CAD of one mechanism) weighs nothing, and
  // a 0.2 kg robot accelerates like nothing on Earth. Rather than pretend, run
  // a typical competition robot and say so — ASSUMED_KG is flagged all the way
  // out to the Math tab, where it reads as an assumption, not a measurement.
  if(!(props.kg>ASSUMED_MIN_KG)){
    const L=(base&&base.L)||0.40, W=(base&&base.W)||0.36;
    props={kg:ASSUMED_KG, com:{x:0,y:0,z:0.11}, comHeight:0.11,
           I:{xx:0,yy:0,zz:ASSUMED_KG*(L*L+W*W)/12}, Izz:ASSUMED_KG*(L*L+W*W)/12,
           parts:[], confidence:0.15, assumed:true, cadKg:props.kg};
  }else{
    // yaw about z doesn't change Izz, so only the centre of mass moves
    const c=toR([props.com.x,props.com.y,props.com.z]);
    props=Object.assign({},props,{com:{x:c[0],y:c[1],z:c[2]}, comHeight:c[2]});
  }
  const geo=(typeof driveFromCAD==="function")?driveFromCAD(cad,{front:o.front}):null;
  const cadWheels=(geo&&geo.wheels)||[];
  const corners={};
  for(const w of cadWheels) if(w.corner) corners[w.corner]=w;
  // Wheels the CAD has but can't hand out by corner (six-wheel, drop-centre,
  // a diamond) still say where the drive base is: use its real span.
  const span=cadWheels.length>=2?{
    x0:Math.min.apply(null,cadWheels.map(w=>w.x)), x1:Math.max.apply(null,cadWheels.map(w=>w.x)),
    y0:Math.min.apply(null,cadWheels.map(w=>w.y)), y1:Math.max.apply(null,cadWheels.map(w=>w.y)),
    r:cadWheels.reduce((a,w)=>a+w.r,0)/cadWheels.length}:null;
  const L=(base&&base.L)||0.40, W=(base&&base.W)||0.36, R=(base&&base.wheelR)||0.048;
  // Four parallel axles are a mecanum set or a tank set and the geometry
  // genuinely can't tell which; the drivetrain detector says "tank" with low
  // confidence for exactly that case. Code that does mecanum maths settles it.
  let kind=(geo&&geo.kind&&geo.kind!=="unknown")?geo.kind:(dtn.style==="mecanum"?"mecanum":"tank");
  const weakTank=geo&&geo.kind==="tank"&&(geo.confidence||0)<0.5;
  if(weakTank&&dtn.style==="mecanum") kind="mecanum";
  const wheels=[], devs=[], motors=[];
  // Pair each driven motor with a real CAD wheel: by corner when the layout
  // has corners, otherwise by direction — "back" is the wheel behind the
  // centre, "leftFront" the one out front-left. Without this a kiwi (three
  // wheels, no corners) got three synthetic forward-facing wheels and could
  // not turn at all.
  const taken=new Set();
  const pick=w=>{
    const corner=(w.front?"F":w.back?"B":"")+(w.left?"L":w.right?"R":"");
    if(corner.length===2&&corners[corner]&&!taken.has(corners[corner])) return corners[corner];
    const dx=w.front?1:(w.back?-1:0), dy=w.left?1:(w.right?-1:0);
    if((!dx&&!dy)||!cadWheels.length) return null;
    const h=Math.atan2(dy,dx);
    let best=null, bd=Infinity;
    for(const g of cadWheels){
      if(taken.has(g)) continue;
      let d=Math.abs(Math.atan2(g.y,g.x)-h); if(d>Math.PI) d=2*Math.PI-d;
      if(d<bd){ bd=d; best=g; }
    }
    return bd<1.4?best:null;                  // within ~80 degrees, or it's only a guess
  };
  for(const w of dtn.wheels){
    const corner=(w.front?"F":w.back?"B":"")+(w.left?"L":w.right?"R":"");
    const g=pick(w); if(g) taken.add(g);
    const x=g?g.x:span?(w.front?span.x1:(w.back?span.x0:(span.x0+span.x1)/2)):(w.front?L/2:(w.back?-L/2:0));
    const y=g?g.y:span?(w.left?span.y1:span.y0):(w.left?W/2:-W/2);
    // the standard mecanum X when nothing says otherwise: FL and BR one way,
    // FR and BL the other
    const roller=kind!=="mecanum"?0
      :(g&&g.roller?g.roller:(((w.front&&w.left)||(w.back&&w.right))?1:-1));
    const r=(g&&g.r>0.015)?g.r:(span&&span.r>0.015?span.r:R);
    // non-mecanum wheels roll along the CAD's own drive direction (a kiwi's
    // wheels point round the circle, an X-drive's at 45 degrees)
    const alpha=(kind!=="mecanum"&&g&&Number.isFinite(g.alpha))?g.alpha:0;
    wheels.push({x, y, z:0, r, roller, alpha, corner:corner.length===2?corner:null});
    devs.push(w.dev);
    const sd=dev&&dev[w.dev];
    motors.push((sd&&sd.spec)||null);
  }
  // Swerve: each module's steering actuator is whatever the code drives that
  // isn't a drive motor and sits on the same corner (leftFrontSteer steers
  // leftFront). How a servo position maps to a module angle depends on the
  // horn and the gearing, which no CAD shows, so it is an explicit
  // calibration: 0.5 is straight ahead, the full 0..1 sweep is travelDeg,
  // counter-clockwise for a higher position unless sense is -1.
  let steer=null;
  if(kind==="swerve"){
    const drive=new Set(devs);
    const same=(a,b)=>a.front===b.front&&a.back===b.back&&a.left===b.left&&a.right===b.right;
    const cands=Object.keys(dev||{}).filter(n=>!drive.has(n)&&dev[n]);
    steer=dtn.wheels.map(w=>cands.find(n=>{ const c=wheelCorner(n); return (c.front||c.back||c.left||c.right)&&same(c,w); })||null);
    if(!steer.some(Boolean)) steer=null;
  }
  const sw=o.swerve||{};
  return {props, drive:{kind, wheels, from:g0(geo)}, motors, devs, gear:1, steer,
          steerCfg:{zero:Number.isFinite(sw.zero)?sw.zero:0.5, travel:(Number.isFinite(sw.travelDeg)?sw.travelDeg:180)*Math.PI/180, sense:sw.sense===-1?-1:1},
          mu:(Number.isFinite(o.mu)&&o.mu>0)?o.mu:undefined};
}
// where the wheel geometry came from, for the physics panel and the math sheet
const g0=geo=>geo&&geo.wheels&&geo.wheels.length?"cad":"code";
const clamp01=v=>Math.max(0,Math.min(1,v));
const SLEW=8;                                   // motor power change per second (power units / s)
