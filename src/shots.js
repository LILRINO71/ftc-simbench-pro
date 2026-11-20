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

   The ball that leaves is a real one (src/ballphys.js): the launch
   speed, angle, aim and backspin the Shot Sim used, the same drag and
   lift, so it flies the Shot Sim's arc; then it goes in, or meets the
   rim, the frame, a robot or the tiles and bounces and rolls from there.
   A flight keeps its fields (path, t, dur, pos in inches, hit, cause) and
   adds `ball`, `vel` and `spin` (m/s, rad/s); `hit` is the Shot Sim's
   expectation until the ball has decided it.
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

/* The ball a shot launches: from p0 (inches, the Shot Sim's exit point) at v m/s, thDeg up,
   yawDeg round, with the backspin the shooter gives it (S0, the Shot Sim's spin share: a
   single flywheel 1, so its surface turns at v). ignore: the robot it leaves from. */
function shotBall(kind,al,p0,v,thDeg,yawDeg,S0,ignore){
  const th=thDeg*Math.PI/180, ps=yawDeg*Math.PI/180, c=Math.cos(th);
  const b=ballSpawn({kind},{x:p0[0]*IN, y:p0[1]*IN, z:p0[2]*IN, vx:v*c*Math.cos(ps), vy:v*c*Math.sin(ps), vz:v*Math.sin(th),
    target:al, hive:typeof Field!=="undefined"&&Field.hive?Field.hive[al]:null, ignore:ignore||null});
  ballBackspin(b,b.vx,b.vy,(S0==null?1:S0)*v);
  return b;
}
/* A flight that came without a ball (another bench's, a test's): one off its own path. */
function flightBall(f){
  const P=f.path, a=P[0], st=f.step||SHOT_STEP_S, k=Math.min(8,Math.floor((P.length-1)/2));
  // the launch speed from the first stretch of the path: a parabola through three of its points
  // (its points are whole millimetres, so one 5 ms step alone is 0.2 m/s out)
  const v=i=>k>=1?(4*(P[k][i]-a[i])-(P[2*k][i]-a[i]))/(2*k*st)*IN:(P[Math.min(1,P.length-1)][i]-a[i])*IN/st;
  const b=ballSpawn({kind:f.kind==="nectar"?"nectar":"pollen"},{x:a[0]*IN, y:a[1]*IN, z:a[2]*IN,
    vx:v(0), vy:v(1), vz:v(2), target:f.al||null, hive:f.hive==null?null:f.hive});
  ballBackspin(b,b.vx,b.vy,Math.hypot(b.vx,b.vy,b.vz));
  return b;
}
/* After a physics step: the flight's clock, where it is (inches), how it moves, and its path
   (what the trails and the online copy draw) to where it really went. */
function flightAdvance(f,dt){
  const b=f.ball, P=f.path, st=f.step||SHOT_STEP_S, pos=[b.x/IN, b.y/IN, b.z/IN];
  f.t+=dt; f.pos=pos; f.vel=[b.vx,b.vy,b.vz]; f.spin=[b.wx,b.wy,b.wz];
  const k=Math.floor(f.t/st+1e-9);
  if(k>=1&&P.length){
    if(k<P.length) P[k]=pos.slice();
    else{ const a=P[P.length-1], n0=P.length; for(let i=n0;i<=k;i++){ const u=(i-n0+1)/(k-n0+1); P.push([a[0]+(pos[0]-a[0])*u, a[1]+(pos[1]-a[1])*u, a[2]+(pos[2]-a[2])*u]); } }
  }
  f.dur=Math.max(f.dur||0,f.t);
}
/* Why a ball that didn't go in missed, in the Shot Sim's words where they fit. */
function flightCause(f){
  if(f.hit&&f.hive!=null&&typeof Field!=="undefined"&&Field.hive&&Field.hive[f.al]!==f.hive) return "tipped";
  const t=f.ball&&f.ball.hitTag;
  if(t&&t!=="floor") return t;
  if(f.cause==="short"||f.cause==="long") return f.cause;
  // on the tiles: short of the mouth or past it, along the way it was going
  try{ const m=Field.model().mouthCentroid[f.al], p=f.path[0], e=f.pos, ux=m[0]-p[0], uy=m[1]-p[1], L=Math.hypot(ux,uy)||1;
    return ((e[0]-p[0])*ux+(e[1]-p[1])*uy)/L<L?"short":"long"; }catch(e){ return "floor"; }
}

const Shots={
  cfg:null, alliance:"red", seed:7, spreadScale:1,
  flying:[], landed:[], log:[], fired:0, scored:0, t:0, lastFeed:-1e9, feedWas:false,
  defaults(){ return {shooter:null, feeder:null, motorId:null, hoodDeg:75, h0In:16, wheelMm:96, gear:1, mountDeg:0,
                      ball:"pollen", type:"single", precision:"typical"}; },
  reset(){ this.flying=[]; this.landed=[]; this.log=[]; this.fired=0; this.scored=0; this.t=0;
           this.lastFeed=-1e9; this.feedWas=false; this.rnd=makeRng(this.seed); this.world=ballWorld(); },
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
      // a robot read whole from its CAD (Onshape, a URDF, a package) is the real robot,
      // shooter and all: nothing is drawn in for it
      const cad=Sim.cad;
      if(cad&&(cad.source==="urdf"||cad.source==="onshape"||cad.source==="mjcf"||cad.source==="gltf"||(cad.mates&&cad.mates.exact))) return null;
      if(this._ownCad!==cad){ this._ownCad=cad;
        this._own=((cad&&cad.parts)||[]).some(p=>/fly ?wheel|shooter|launcher/i.test(p.name||"")); }
      if(this._own) return null;
    }
    const fp=Sim.footprint||{hx:0.2};
    // the back of the BOX, which sits (fp.ox) off the drivetrain centre
    return {ox:(fp.ox||0)-Math.max(0,fp.hx-0.08), mount:c.mountDeg||0};
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
    const p=this.params(pose), r=Field.E.classifyShot(p,L.th,L.v,L.yaw);
    const b=this.launchPath(r,L.v,why,odds,L);
    // online, away from the host: the host's Shot Sim flies this same launch and decides it (src/net.js)
    if(b&&typeof Online!=="undefined"&&Online.guest()&&Online.playing()){ b.net=true; Online.shot(p,L.th,L.v,L.yaw); }
    return b;
  },
  /* L: the launch ({v, th, yaw} as fired); without it the ball starts off the path. */
  launchPath(r,v,why,odds,L){
    const ball=this.cfg.ball, path=r.path||[];
    if(path.length<2) return null;
    const b={path, t:0, dur:(path.length-1)*SHOT_STEP_S, hit:!!r.hit, cause:r.cause, kind:ball,
             color:ball==="nectar"?this.target():null, al:this.target(), v, why, odds, pos:path[0].slice(), hive:Field.hive[this.target()]};
    let S0=1; try{ S0=Field.E.shooterSpin(this.shooterSpec()); }catch(e){}
    b.ball=L?shotBall(ball,b.al,path[0],L.v,L.th,L.yaw,S0,"user"):flightBall(b);
    if(!L) b.ball.ignore="user";
    b.vel=[b.ball.vx,b.ball.vy,b.ball.vz]; b.spin=[b.ball.wx,b.ball.wy,b.ball.wz];
    this.flying.push(b); this.fired++;
    return b;
  },
  /* The robots a ball can meet: this one, and in a match everyone else's too. */
  ballBoxes(){
    if(typeof Match!=="undefined"&&Match.live()) return Match.ballBoxes(Sim);
    if(!Sim.chassis||!Sim.footprint) return [];
    const u=footBox(Sim.chassis,Sim.footprint);
    return [{id:"user", x:u.x, y:u.y, h:u.h, hx:u.hx, hy:u.hy, hz:Math.max(0.1,Math.min(0.6,Sim.footprint.h||0.35))}];
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
    if(!this.world) this.world=ballWorld();
    for(const b of this.flying) if(!b.ball) b.ball=flightBall(b);
    for(const l of this.landed) if(!l.ball) l.ball=ballSpawn({kind:l.kind==="nectar"?"nectar":"pollen"},{x:l.pos[0]*IN, y:l.pos[1]*IN, z:Math.max(l.pos[2]*IN,0)});
    if(Field.ok) this.world.statics=Field.ballStatics();
    const balls=this.flying.map(b=>b.ball).concat(this.landed.map(l=>l.ball));
    if(balls.length) this.world.step(dt,balls,this.ballBoxes());
    for(const b of this.flying){ flightAdvance(b,dt); if(b.ball.sunk||b.ball.hitTag||b.t>6) b.done=true; }
    for(const b of this.flying.filter(b=>b.done)){
      const od=b.odds!=null?` · a ${Math.round(b.odds*100)} % shot`:"";
      // the ball says: in its up-CELL, or it met something first (the HIVE tipping while it
      // flew swings that CELL down, so it can't be in it: src/field.js)
      if(b.ball.sunk){ b.hit=true; b.cause=null; } else { b.cause=flightCause(b); b.hit=false; }
      if(b.net){ this.note(b.hit?`IN, the host says how it counts · ${b.v.toFixed(1)} m/s${od}`:`Missed — ${CAUSE_TEXT[b.cause]||b.cause||"no score"} at ${b.v.toFixed(1)} m/s${od}`); continue; }
      if(b.hit){
        this.scored++;
        const tipped=Field.addToCell(b.al,b.kind,b.color);
        this.note(`IN the ${b.al.toUpperCase()} up-CELL at ${b.v.toFixed(1)} m/s${od}`+(tipped?` — TIP ${Field.tips[b.al]}`:""));
      }else{
        this.note(`Missed — ${CAUSE_TEXT[b.cause]||b.cause||"no score"} at ${b.v.toFixed(1)} m/s${od}`);
        // in a full match a miss stays on the field, bouncing and rolling where any robot can pick it up (src/match.js)
        if(typeof Match!=="undefined"&&Match.live()) Match.adopt(b.ball,b.kind,b.color);
        else this.landed.push({pos:b.pos.slice(), t:0, kind:b.kind, color:b.color, ball:b.ball});
      }
    }
    this.flying=this.flying.filter(b=>!b.done);
    // a miss bounces and rolls on the tiles, and lies there a moment once it stops
    for(const l of this.landed){ l.t+=dt; l.pos=[l.ball.x/IN, l.ball.y/IN, l.ball.z/IN]; if(!l.ball.sleep) l.rest=l.t; }
    this.landed=this.landed.filter(l=>l.t<12&&l.t-(l.rest||0)<2);
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
const CAUSE_TEXT={tipped:"the HIVE tipped while it flew", short:"fell short", long:"went long", lip:"hit the lip", roof:"hit the CELL roof", cell:"hit the CELL",
  frame:"hit the HIVE frame", wall:"hit the wall", floor:"hit the floor", robot:"hit a robot", flower:"hit a FLOWER"};

/* The goBILDA motor in the Shot Sim's table nearest a free speed. */
function nearestMotorId(rpm){
  const list=(Field.data&&Field.data.motors&&Field.data.motors.motors)||[];
  let best=null, bd=1e9;
  for(const m of list){ const d=Math.abs(Math.log((m.freeRpm||1)/(rpm||6000))); if(d<bd){ bd=d; best=m.id; } }
  return best;
}
