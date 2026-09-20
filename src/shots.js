/* ============================================================
   7b.  SHOTS — the running OpMode's shooter on the BIOBUZZ field

   The flywheel speed comes from what the code commands (setPower or
   setVelocity), the launch angle from the hood, the aim from where the
   robot is pointing. The BIOBUZZ Shot Sim flies the ball — drag, spin,
   the CELL lip, the frame — and says whether it goes in.

   Every shot wanders the way a real one does: launch angle, aim and exit
   speed each scatter by the Shot Sim's precision figures, and the robot's
   own motion is added to the ball. A spot the Shot Sim calls 40 % scores
   about 40 % of the time here too — no perfect shots.
   ============================================================ */
const SHOT_STEP_S=0.005;          // the Shot Sim stores a path sample every 5 ms
const SHOOTER_NAME=/shoot|fly_?wheel|launch|cannon|outtake/i;
const FEEDER_NAME=/feed|kick|flick|push|index|transfer|gate|trigger|stopper|loader|hammer/i;
const NOT_SHOOTER=/slide|lift|claw|wrist|elbow|drive/i;

/* A small seeded random source, so a test or a replay sees the same shots. */
function makeRng(seed){
  let s=seed>>>0;
  return ()=>{ s=(s+0x6D2B79F5)>>>0; let t=s;
    t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296; };
}
function gauss(rnd){ let u=0; while(u===0) u=rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*rnd()); }

const Shots={
  cfg:null, alliance:"red", seed:7, spreadScale:1,
  flying:[], landed:[], log:[], fired:0, scored:0, t:0, lastFeed:-1e9, feedWas:false,
  defaults(){ return {shooter:null, feeder:null, motorId:null, hoodDeg:75, h0In:16, wheelMm:96, gear:1, mountDeg:0,
                      ball:"pollen", type:"single", precision:"typical"}; },
  reset(){ this.flying=[]; this.landed=[]; this.log=[]; this.fired=0; this.scored=0; this.t=0;
           this.lastFeed=-1e9; this.feedWas=false; this.rnd=makeRng(this.seed); },
  target(){ return this.alliance==="blue"?"blue":"red"; },

  /* Which devices look like a shooter and a feeder, by name and type. */
  detect(code){
    const devs=(code&&code.devices)||[];
    const motors=devs.filter(d=>/DcMotor/i.test(d.type||""));
    const shooter=motors.filter(d=>SHOOTER_NAME.test(d.name)&&!NOT_SHOOTER.test(d.name)).map(d=>d.name);
    const feeder=devs.filter(d=>FEEDER_NAME.test(d.name)&&shooter.indexOf(d.name)<0).map(d=>d.name);
    return {shooter, feeder};
  },
  /* Fill in whatever the user hasn't chosen from what the code declares. */
  adopt(code){
    if(!this.cfg) this.cfg=this.defaults();
    const d=this.detect(code), names=((code&&code.devices)||[]).map(x=>x.name);
    if(!this.cfg.shooter||names.indexOf(this.cfg.shooter)<0) this.cfg.shooter=d.shooter[0]||null;
    if(!this.cfg.feeder||names.indexOf(this.cfg.feeder)<0) this.cfg.feeder=d.feeder[0]||null;
    if(!this.cfg.motorId) this.cfg.motorId=nearestMotorId(this.deviceRpm());
    if(!this.cfg.precision) this.cfg.precision="typical";
  },
  /* Output-shaft free speed of the shooter motor. An unnamed motor is
     assumed to be the 6000 rpm 1:1 most flywheels use. */
  deviceRpm(){
    const s=this.cfg&&this.cfg.shooter&&Sim.dev[this.cfg.shooter];
    return s&&s.spec&&s.spec.rpm&&!s.spec.guess ? s.spec.rpm : 6000;
  },
  shooterSpec(){
    const c=this.cfg;
    return {type:c.type, wheelDiameterMm:c.wheelMm, gear:c.gear, motorsPerWheel:1};
  },
  precision(){
    const P=(Field.data&&Field.data.shooter&&Field.data.shooter.precision)||{};
    return P[(this.cfg&&this.cfg.precision)||"typical"]||P.typical||{sigThetaDeg:1, sigYawDeg:1, sigShooter:0.015};
  },

  /* The shooter the bench draws when the CAD doesn't have one: at the back
     of the robot, so it clears whatever mechanism the CAD carries. */
  module(){
    const c=this.cfg; if(!c||!c.shooter) return null;
    const mode=(Sim.opts&&Sim.opts.shooterModel)||"auto";
    if(mode==="hide") return null;
    if(mode!=="show"){
      if(this._ownCad!==Sim.cad){ this._ownCad=Sim.cad;
        this._own=((Sim.cad&&Sim.cad.parts)||[]).some(p=>/fly ?wheel|shooter|launcher/i.test(p.name||"")); }
      if(this._own) return null;
    }
    const fp=Sim.footprint||{hx:0.2};
    return {ox:-Math.max(0,fp.hx-0.08), mount:c.mountDeg||0};
  },
  /* Where the ball leaves, on the field. */
  exitPoint(pose){
    const m=this.module(); if(!m) return {x:pose.x, y:pose.y};
    return {x:pose.x+Math.cos(pose.h)*m.ox, y:pose.y+Math.sin(pose.h)*m.ox};
  },
  /* Engine parameters for a robot at this pose (metres, radians). The Shot
     Sim keeps an 18 in robot's centre 9 in off the walls; the bench's own
     collisions already keep this robot on the field, so meet it there. */
  params(pose){
    const c=this.cfg, L=Field.data.field.field.half-9, e=this.exitPoint(pose);
    const x=Math.max(-L,Math.min(L,e.x/IN)), y=Math.max(-L,Math.min(L,e.y/IN));
    return {robot:{x, y}, target:this.target(), ballId:c.ball,
      hiveState:{red:Field.hive.red, blue:Field.hive.blue}, h0:c.h0In,
      motorId:c.motorId, shooter:this.shooterSpec(), precision:this.precision()};
  },
  /* Exit speed with the flywheel at full free speed, and the motor behind it. */
  full(){
    const c=this.cfg;
    const key=[c.motorId,c.type,c.wheelMm,c.gear,c.ball].join("|");
    if(this._full&&this._fullKey===key) return this._full;
    let m=null;
    try{ m=Field.E.motorModel(c.motorId, this.shooterSpec(), c.ball, 1); }catch(e){ m=null; }
    this._full=m?{v:m.vCap, rpm:m.usableFreeRpm, free:m.freeRpm}:{v:0, rpm:0, free:0};
    this._fullKey=key;
    return this._full;
  },
  /* How fast the flywheel is turning, as a share of free speed — what the
     code's setPower / setVelocity asked for, after the motor slews there. */
  spin(){
    const s=this.cfg&&this.cfg.shooter&&Sim.dev[this.cfg.shooter];
    return s?Math.min(1,Math.abs(s.act)):0;
  },
  /* Commanded share of the nominal free speed, capped at what the battery
     can actually turn the motor at. */
  exitSpeed(){ const f=this.full(); return f.rpm?f.v*Math.min(1,this.spin()*f.free/f.rpm):0; },
  yawDeg(pose){ return pose.h*180/Math.PI+(this.cfg.mountDeg||0); },

  /* How far a real shot wanders at this exit speed: the precision preset
     plus the motor's own speed error — what the Shot Sim's verdict assumes. */
  spread(v){
    const pr=this.precision(), k=this.spreadScale;
    let sm=0, sr=0;
    try{ const m=Field.E.motorModel(this.cfg.motorId,this.shooterSpec(),this.cfg.ball,v); sm=m.sigmaMotor||0; sr=m.sigmaRecovery||0; }catch(e){}
    return {th:pr.sigThetaDeg*k, yaw:pr.sigYawDeg*k, v:Math.sqrt(pr.sigShooter*pr.sigShooter+sm*sm+sr*sr)*k};
  },
  /* The robot's own velocity rides along with the ball. */
  withVelocity(v,thDeg,yawDeg,vel){
    if(!vel||(!vel.x&&!vel.y)) return {v, th:thDeg, yaw:yawDeg};
    const th=thDeg*Math.PI/180, ps=yawDeg*Math.PI/180, h=v*Math.cos(th);
    const hx=h*Math.cos(ps)+vel.x, hy=h*Math.sin(ps)+vel.y, vz=v*Math.sin(th), hh=Math.hypot(hx,hy);
    return {v:Math.hypot(hh,vz), th:Math.atan2(vz,hh)*180/Math.PI, yaw:Math.atan2(hy,hx)*180/Math.PI};
  },
  /* One real shot's launch: the nominal angle, aim and speed, scattered. */
  sample(v0,th0,yaw0,s,rnd,vel){
    return this.withVelocity(v0*(1+gauss(rnd)*s.v), th0+gauss(rnd)*s.th, yaw0+gauss(rnd)*s.yaw, vel);
  },
  /* The share of shots that go in if the robot fires now, as it stands. */
  odds(pose,vel,n){
    const v0=this.exitSpeed(); if(v0<1) return 0;
    n=n||48;
    const rnd=makeRng(20260917), s=this.spread(v0), p=this.params(pose), th=this.cfg.hoodDeg, yaw=this.yawDeg(pose);
    let hits=0;
    for(let i=0;i<n;i++){ const L=this.sample(v0,th,yaw,s,rnd,vel); if(Field.E.classifyShot(p,L.th,L.v,L.yaw).hit) hits++; }
    return hits/n;
  },

  /* Fire one ball with the robot exactly as it is. */
  fire(pose,why,vel){
    if(!Field.ok||!this.cfg) return null;
    if(!this.cfg.shooter) return this.note("No flywheel picked — choose one in the Shot tab.");
    const v0=this.exitSpeed();
    if(v0<1) return this.note("Flywheel isn't spinning — "+this.cfg.shooter+" is at "+Math.round(this.spin()*100)+"%.");
    if(!this.rnd) this.rnd=makeRng(this.seed);
    const odds=this.odds(pose,vel,32);
    const L=this.sample(v0,this.cfg.hoodDeg,this.yawDeg(pose),this.spread(v0),this.rnd,vel);
    const r=Field.E.classifyShot(this.params(pose),L.th,L.v,L.yaw);
    return this.launchPath(r,L.v,why,odds);
  },
  launchPath(r,v,why,odds){
    const ball=this.cfg.ball, path=r.path||[];
    if(path.length<2) return null;
    const b={path, t:0, dur:(path.length-1)*SHOT_STEP_S, hit:!!r.hit, cause:r.cause, kind:ball,
             color:ball==="nectar"?this.target():null, al:this.target(), v, why, odds, pos:path[0].slice()};
    this.flying.push(b); this.fired++;
    return b;
  },
  note(text){ this.log.unshift({t:Sim.t||0, text}); this.log.length=Math.min(this.log.length,6); return null; },

  /* The feeder decides when a ball goes: a servo moving off its rest
     position pushes one ball; a feed motor running pushes one per interval. */
  autoFire(pose){
    const c=this.cfg; if(!c||!c.feeder) return;
    const f=Sim.dev[c.feeder]; if(!f) return;
    let pulse=false;
    if(f.kind==="servo"){
      const away=Math.abs(f.act-(f.restPos==null?f.cmd:f.restPos))>=0.12;
      pulse=away&&!this.feedWas; this.feedWas=away;
    }else{
      const on=Math.abs(f.act)>0.35;
      if(on&&this.t-this.lastFeed>=0.5){ pulse=true; this.lastFeed=this.t; }
      if(!on) this.lastFeed=-1e9;
    }
    if(pulse) this.fire(pose,"fed by "+c.feeder,Sim.vel);
  },
  tick(dt,pose){
    this.t+=dt;
    if(Field.ok&&this.cfg&&Sim.phase==="running") this.autoFire(pose);
    for(const b of this.flying){
      b.t+=dt;
      const k=Math.min(b.path.length-1, b.t/SHOT_STEP_S), i=Math.floor(k), f=k-i;
      const a=b.path[i], c=b.path[Math.min(b.path.length-1,i+1)];
      b.pos=[a[0]+(c[0]-a[0])*f, a[1]+(c[1]-a[1])*f, a[2]+(c[2]-a[2])*f];
      if(b.t>=b.dur) b.done=true;
    }
    for(const b of this.flying.filter(b=>b.done)){
      const od=b.odds!=null?` · a ${Math.round(b.odds*100)} % shot`:"";
      if(b.hit){
        this.scored++;
        const tipped=Field.addToCell(b.al,b.kind,b.color);
        this.note(`IN the ${b.al.toUpperCase()} up-CELL at ${b.v.toFixed(1)} m/s${od}`+(tipped?` — TIP ${Field.tips[b.al]}`:""));
      }else{
        this.note(`Missed — ${CAUSE_TEXT[b.cause]||b.cause||"no score"} at ${b.v.toFixed(1)} m/s${od}`);
        this.landed.push({pos:b.pos.slice(), vz:0, t:0, kind:b.kind, color:b.color});
      }
    }
    this.flying=this.flying.filter(b=>!b.done);
    // a miss drops to the tiles and lies there a moment
    for(const l of this.landed){
      l.t+=dt;
      if(l.pos[2]>1.4){ l.vz-=386*dt; l.pos[2]=Math.max(1.4,l.pos[2]+l.vz*dt); }
    }
    this.landed=this.landed.filter(l=>l.t<3);
  },

  /* What a hood fixed at this angle needs from here: the band of exit
     speeds that score when aimed at `yawDeg`. */
  window(pose,yawDeg){
    const p=this.params(pose), th=this.cfg.hoodDeg, vmax=Math.max(3,Math.min(16,this.full().v||14));
    let lo=null, hi=null;
    for(let v=1.5; v<=vmax+1e-9; v+=0.1){
      if(Field.E.classifyShot(p,th,v,yawDeg).hit){ if(lo===null) lo=v; hi=v; }
    }
    if(lo===null) return null;
    const edge=(v0,dir)=>{ let v=v0; for(let i=0;i<10;i++){ const n=v+dir*0.01; if(!Field.E.classifyShot(p,th,n,yawDeg).hit) break; v=n; } return v; };
    return {lo:edge(lo,-1), hi:edge(hi,1)};
  }
};
const CAUSE_TEXT={short:"fell short", long:"went long", lip:"hit the lip", roof:"hit the CELL roof", cell:"hit the CELL",
  frame:"hit the HIVE frame", wall:"hit the wall", floor:"hit the floor"};

/* The goBILDA motor in the Shot Sim's table nearest a free speed. */
function nearestMotorId(rpm){
  const list=(Field.data&&Field.data.motors&&Field.data.motors.motors)||[];
  let best=null, bd=1e9;
  for(const m of list){ const d=Math.abs(Math.log((m.freeRpm||1)/(rpm||6000))); if(d<bd){ bd=d; best=m.id; } }
  return best;
}
