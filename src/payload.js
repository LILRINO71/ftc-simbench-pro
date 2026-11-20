/* ============================================================
   7d.  PAYLOAD — the game pieces inside the team's robot

   What the team's own code does with POLLEN and NECTAR: an intake that
   picks a ball up off the tiles, at most four held (G407), a path to the
   shooter, a feeder or gate that lets one out, and a flywheel that slows
   as each ball takes its energy. It works from the OpMode's device names
   and types alone, so any robot's code gets it.

   The roles (Shots.detect: one naming scheme for all of them):
     intake     a motor or CR servo named intake / collect / sweep / suck /
                pickup, or a roller that isn't the shooter. Up to four, one
                mouth each.
     transfer   a motor or CR servo named transfer / index / conveyor / belt:
                once a piece is in, this moves it to the shooter
     feeder     Shots.cfg.feeder (kicker, gate, pusher ...) when it isn't one of
                the above: it lets a waiting piece out. With none, a piece
                leaves when the intake or transfer pushes it into a shooter that
                turns fast enough
     shooter    Shots.cfg.shooter and every other motor named like a shooter:
                the flywheels, which pay for each shot
   Each can be chosen in the Shot tab: the choice is kept in Shots.cfg.pick,
   and Shots.adopt puts what is in effect for each OpMode (the choice where it
   applies, else the code's) in Shots.cfg.payload.intakes and .transfer.

   Where a mouth is: the front edge of the footprint box, nearly its full
   width; a device named back or rear, the back edge; a device bound to a
   CAD joint, the edge nearest the joint and the joint's own width. Two
   intakes nothing places are taken to be one at each end.

   Which way is in: pinned by the user, else the way the intake is running
   (0.15 s above 20 % power) the first time a loose ball lies in its mouth:
   an intake run at a ball is taking it in. Or the way it runs with pieces
   inside while the flywheel is up (it is feeding the shooter: how an AUTO
   with pre-loads decides). Not the first thing the driver pressed: a tap
   of reverse on an empty robot says nothing. The CAD can't settle it: a
   roller's axis says nothing about which side of it the ball passes. The
   opposite sign ejects.

   Supply (Shots.cfg.payload.supply): "real" is all of the above;
   "unlimited" is the old bench, a ball from nowhere at every feeder pulse,
   exactly; "auto" is real when the code has an intake or the user
   pre-loads, unlimited when it only shoots (a hand-fed robot). Online
   matches stay unlimited for now (src/net.js decides shots on the host).

   Units: metres, seconds, radians; the field frame (src/field.js). A
   mouth is in the footprint box's own frame (footBox in src/match.js):
   x forward, y left, from the box's centre.
   ============================================================ */
const INTAKE_ON=0.2;                    // share of power an intake must run at to move a ball
const INTAKE_LEARN_S=0.15;              // a command held this long says which way is in
const TAKE_MIN_S=0.06, TAKE_MAX_S=2.5;  // a ball takes at least / at most this long to come in
const TAKE_CLEAR_M=0.005;               // a ball travels its diameter plus this to be inside
const FLOWER_OUTLET_M=0.061;            // a FLOWER's bottom opening: its field-side face, from its centre
const GATE_NAME=/gate|stopper|door|latch|blocker/i;
const BACK_NAME=/back|rear/i, FRONT_NAME=/front/i;
const STUCK_S=0.5;                       // a device told to run that stays still this long is said to be stuck
const FLY_KP=20;                        // a hub velocity loop drives near full voltage until it's close (setVelocity)

const Payload={
  held:[], grips:[], fgrips:[], dirs:{}, ej:{}, stats:null, t:0, lastOut:-1e9, primed:false, dryNoted:false,
  mode:"none", why:"", _fly:null,

  defaults(){ return {intakes:null, transfer:null, dirs:{}, edges:{}, preload:null, supply:"auto", rollerMm:48}; },
  /* The settings (Shots.cfg.payload) with every gap filled. */
  cfg(){
    const d=this.defaults(), p=typeof Shots!=="undefined"&&Shots.cfg&&Shots.cfg.payload;
    if(p&&typeof p==="object") for(const k in d) if(p[k]!==undefined&&p[k]!==null) d[k]=p[k];
    // a headless caller or an old file can put anything here: only what the rest can use
    d.rollerMm=Number.isFinite(+d.rollerMm)&&+d.rollerMm>0?Math.max(10,Math.min(150,+d.rollerMm)):48;
    d.preload=d.preload!=null&&Number.isFinite(+d.preload)?Math.max(0,Math.min(MATCH_BOT.cap,Math.round(+d.preload))):null;
    if(d.supply!=="real"&&d.supply!=="unlimited") d.supply="auto";
    if(d.intakes!==null&&!Array.isArray(d.intakes)) d.intakes=null;
    if(!d.dirs||typeof d.dirs!=="object") d.dirs={};
    if(!d.edges||typeof d.edges!=="object") d.edges={};
    return d;
  },
  /* A fresh run: nothing held, nothing learned. Shots.reset calls this. */
  reset(){
    for(const g of this.grips) if(g.ball.hold&&g.ball.hold.id==="user") g.ball.hold=null;
    this.held=[]; this.grips=[]; this.fgrips=[]; this.dirs={}; this.ej={}; this.t=0; this.lastOut=-1e9;
    this.primed=false; this.dryNoted=false; this.preloaded=0; this.lastDrop=0; this.feedV=0; this.stuck={}; this.stuckSaid={};
    this.stats={picked:0, ejected:0, fired:0, scored:0, flower:0, g408:0};
  },

  /* ---------------- which devices do what ---------------- */
  devNames(){ return Object.keys((typeof Sim!=="undefined"&&Sim.dev)||{}); },
  /* What the code's names say (Shots.detect), once per OpMode. */
  detected(){
    const code=(typeof Sim!=="undefined"&&Sim.code)||null;
    if(!this._det||this._detCode!==code){ this._detCode=code; this._det=Shots.detect(code); }
    return this._det;
  },
  /* The intakes: the Shot tab's list, else what the names say. */
  intakes(){
    const P=this.cfg(), have=this.devNames();
    const list=Array.isArray(P.intakes)?P.intakes:this.detected().intake;
    // never the shooter itself: a flywheel named "roller" the user picked as the shooter is not an intake
    const sh=Shots.cfg&&Shots.cfg.shooter;
    return list.filter(n=>typeof n==="string"&&have.indexOf(n)>=0&&n!==sh).slice(0,4);
  },
  /* The transfer: the Shot tab's ("" for none), else what the names say. */
  transfer(){
    const p=Shots.cfg&&Shots.cfg.payload, have=this.devNames(), ins=this.intakes();
    const n=p&&typeof p.transfer==="string"?p.transfer:this.detected().transfer[0];
    return n&&have.indexOf(n)>=0&&ins.indexOf(n)<0?n:null;
  },
  /* The feeder or gate that lets a piece out, unless it is one of the devices that move pieces. */
  gate(){
    const f=Shots.cfg&&Shots.cfg.feeder;
    if(!f||!Sim.dev[f]||this.intakes().indexOf(f)>=0||f===this.transfer()) return null;
    return f;
  },
  /* Every motor that spins a shooter wheel. */
  flywheels(){
    const c=Shots.cfg; if(!c) return [];
    const skip=this.intakes().concat([this.transfer()]), out=[];
    for(const n of [c.shooter].concat(this.detected().shooter))
      if(n&&out.indexOf(n)<0&&skip.indexOf(n)<0&&Sim.dev[n]&&Sim.dev[n].kind==="motor") out.push(n);
    return out;
  },

  /* ---------------- the supply ---------------- */
  supply(){
    const c=typeof Shots!=="undefined"?Shots.cfg:null;
    if(!c) return {mode:"none", why:"no OpMode loaded"};
    const online=(typeof Match!=="undefined"&&Match.net)||(typeof Online!=="undefined"&&Online.guest&&Online.guest());
    if(online) return {mode:"unlimited", why:"online matches keep the unlimited supply for now"};
    const P=this.cfg();
    if(P.supply==="real") return {mode:"real", why:"set in the Shot tab"};
    if(P.supply==="unlimited") return {mode:"unlimited", why:"set in the Shot tab"};
    const ins=this.intakes();
    if(ins.length) return {mode:"real", why:"the code runs an intake ("+ins.join(", ")+")"};
    if(P.preload>0) return {mode:"real", why:"pre-loaded in the Shot tab"};
    if(c.shooter) return {mode:"unlimited", why:"no intake in the code: a ball for every feed, as if fed by hand"};
    return {mode:"none", why:"no intake and no shooter in the code"};
  },
  real(){ return this.supply().mode==="real"; },
  /* The alliance the team's robot plays for. */
  alliance(){ return typeof Match!=="undefined"&&Match.pieces()?Match.user:(Shots.alliance==="blue"?"blue":"red"); },

  /* ---------------- where the mouths are ---------------- */
  footprint(){ return (typeof Sim!=="undefined"&&Sim.footprint)||{hx:0.2286, hy:0.2286, ox:0, oy:0, h:0.35}; },
  box(){ return footBox(Sim.chassis,this.footprint()); },
  pathLen(){ return 0.8*2*this.footprint().hx; },
  mouths(){
    const fp=this.footprint(), P=this.cfg(), ins=this.intakes(), out=[];
    for(const name of ins){
      const set=P.edges&&P.edges[name];
      let m=null;
      if(set==="front"||set==="back") m=this.mouth(name,set,fp,null,null,"set in the Shot tab");
      if(!m) m=this.jointMouth(name,fp);
      if(!m&&BACK_NAME.test(name)) m=this.mouth(name,"back",fp,null,null,"its name");
      if(!m&&FRONT_NAME.test(name)) m=this.mouth(name,"front",fp,null,null,"its name");
      if(!m){ m=this.mouth(name,"front",fp,null,null,"the default: the front edge"); m.guess=true; }
      out.push(m);
    }
    // two intakes nothing places: one at each end, as a robot with two almost always has them
    if(out.length===2&&out[0].edge===out[1].edge){
      const k=out[1].guess?1:out[0].guess?0:-1;
      if(k>=0){ const o=out[k]; out[k]=this.mouth(o.name,o.edge==="back"?"front":"back",fp,null,null,"a second intake: the other end"); }
    }
    return out;
  },
  mouth(name,edge,fp,lat,half,from){
    const E={front:{n:[1,0], e:fp.hx, t:[0,1], L:fp.hy}, back:{n:[-1,0], e:fp.hx, t:[0,1], L:fp.hy},
             left:{n:[0,1], e:fp.hy, t:[1,0], L:fp.hx}, right:{n:[0,-1], e:fp.hy, t:[1,0], L:fp.hx}}[edge];
    const w=Math.max(0.03,Math.min(half!=null?half:Infinity,E.L-0.01)), lim=Math.max(0,E.L-w);
    const c=lat!=null?Math.max(-lim,Math.min(lim,lat)):0;
    return {name, edge, from, n:E.n, e:E.e, t:E.t, c, w};
  },
  /* A device on a CAD joint: the edge nearest the joint's pivot, as wide as the parts it moves. */
  jointMouth(name,fp){
    const s=Sim.dev[name], m=s&&s.mech;
    // a roller turns: a device bound to a slide is moving something else, and says nothing about the mouth
    if(!m||!Array.isArray(m.pivot)||typeof frontToRobot!=="function"||(typeof isLinearKind==="function"&&isLinearKind(m.kind))) return null;
    const toR=frontToRobot(Sim.opts&&Sim.opts.front), ox=fp.ox||0, oy=fp.oy||0;
    const p=toR(m.pivot), lx=p[0]-ox, ly=p[1]-oy;
    const d=[["front",fp.hx-lx],["back",fp.hx+lx],["left",fp.hy-ly],["right",fp.hy+ly]].sort((a,b)=>a[1]-b[1])[0];
    const side=d[0]==="front"||d[0]==="back";
    let lat=side?ly:lx, half=null;
    const pts=Array.isArray(m.cluster)?m.cluster.filter(q=>Array.isArray(q)&&q.length>=2):[];
    if(pts.length>=2){
      let lo=Infinity, hi=-Infinity;
      for(const q of pts){ const r=toR([q[0],q[1],q[2]||0]), v=side?r[1]-oy:r[0]-ox; lo=Math.min(lo,v); hi=Math.max(hi,v); }
      half=Math.max(0.05,(hi-lo)/2+0.01); lat=(hi+lo)/2;
    }
    return this.mouth(name,d[0],fp,lat,half,"the CAD joint "+(m.label||m.id||""));
  },
  local(X,x,y){ const c=Math.cos(X.h), s=Math.sin(X.h), dx=x-X.x, dy=y-X.y; return [dx*c+dy*s, -dx*s+dy*c]; },
  world(X,lx,ly){ const c=Math.cos(X.h), s=Math.sin(X.h); return [X.x+lx*c-ly*s, X.y+lx*s+ly*c]; },

  /* ---------------- which way is in ---------------- */
  /* atBall: a loose ball (or a FLOWER's POLLEN) is in this intake's mouth right now. any: a transfer,
     which only ever runs one way that matters. */
  learn(name,dt,any,atBall){
    const P=this.cfg(), pin=P.dirs&&P.dirs[name];
    const st=this.dirs[name]||(this.dirs[name]={sign:0, from:null, run:0, want:0, t:null});
    if(pin==="positive"||pin==="negative"){ st.sign=pin==="positive"?1:-1; st.from="pinned"; return; }
    if(st.from==="pinned"){ st.sign=0; st.from=null; st.run=0; }
    if(st.sign) return;
    const s=Sim.dev[name]; if(!s) return;
    const sg=Math.abs(s.cmd)>INTAKE_ON?Math.sign(s.cmd):0;
    // how long it has run one way, whatever is in front of it: a driver holds the intake on the way to a
    // ball, and it has to count the moment the ball is there
    if(sg&&sg===st.want) st.run+=dt; else { st.want=sg; st.run=sg?dt:0; }
    if(!sg||st.run<INTAKE_LEARN_S-1e-9) return;
    // pieces inside and the flywheel up: running the intake is feeding the shooter
    const feeding=this.held.length>0&&!!(Shots.cfg&&Shots.cfg.shooter)&&Shots.exitSpeed()>=1;
    const why=any?"first use":atBall?"first ball":feeding?"first feed":null;
    if(!why) return;
    st.sign=sg; st.from=why; st.t=+(Sim.t||0).toFixed(2);
    Shots.note(name+": "+(sg>0?"positive":"negative")+" power takes pieces in ("+(why==="first ball"?"the way it ran at its first ball":why==="first feed"?"the way it ran with the shooter up":"its first use")+")");
  },
  /* Is there something for this mouth to take: a loose ball lying in it, or a FLOWER's POLLEN at it? */
  atBall(m,X){
    if(this.ballIn(m,X)) return true;
    const fl=typeof Match!=="undefined"&&Match.pieces()?Match.flowers:[];
    return fl.some(q=>q.stack.length&&q.stack[0].kind==="pollen"&&this.atOutlet(q,m,X));
  },
  /* The loose ball lying in a mouth (a strip just outside the edge, a ball radius deep), the one
     nearest the edge: {e, p (in the box frame)}, or null. */
  ballIn(m,X){
    const F=this.loose(); if(!F) return null;
    let best=null, bd=Infinity;
    for(const e of F){
      if(e.hold) continue;
      const r=ballSpec(e.kind).r;
      if(e.z!=null&&e.z>r+0.03) continue;
      const p=this.local(X,e.x,e.y), d=p[0]*m.n[0]+p[1]*m.n[1]-m.e, lat=p[0]*m.t[0]+p[1]*m.t[1]-m.c;
      if(d<-0.25*r||d>2*r||Math.abs(lat)>m.w) continue;
      if(d<bd){ bd=d; best={e, p}; }
    }
    return best;
  },
  /* A device that should be turning a roller or a wheel but is held still by the joint it is on (a
     slide at its stop, an arm at its limit: the wrong joint for it) picks nothing up and launches
     nothing. Say so once, with the joint, or the user only sees a robot that does not work. */
  stuckTick(dt,names){
    if(!this.stuck){ this.stuck={}; this.stuckSaid={}; }
    for(const n of names){
      const s=Sim.dev[n]; if(!s) continue;
      const still=Math.abs(s.cmd)>INTAKE_ON&&Math.abs(s.act)<0.02;
      this.stuck[n]=still?(this.stuck[n]||0)+dt:0;
      if(this.stuck[n]<STUCK_S||this.stuckSaid[n]) continue;
      this.stuckSaid[n]=true;
      const j=s.mech?(s.mech.label||s.mech.id):null;
      Shots.note(n+" is told to run but isn't turning"+(j?": it is on the joint '"+j+"', which is at its stop. Check what "+n+" drives in the Robot tab":""));
    }
  },
  /* How hard a device runs the way that moves pieces in (share of power; negative is out). */
  inward(name){ const s=Sim.dev[name], d=this.dirs[name]; return s&&d&&d.sign?d.sign*s.act:0; },
  /* Roller surface speed (m/s) from the device's own speed. */
  surf(name){ const s=Sim.dev[name]; if(!s) return 0; const rpm=(s.spec&&s.spec.rpm)||312;
    return Math.abs(s.act)*rpm/60*Math.PI*Math.max(0.01,this.cfg().rollerMm/1000); },
  /* A ball rolling between a moving roller and a still surface goes at half the roller's surface
     speed; it takes dist at that, no quicker than TAKE_MIN_S and no slower than TAKE_MAX_S. */
  ballSpeed(name,dist){ return Math.max(dist/TAKE_MAX_S,Math.min(dist/TAKE_MIN_S,0.5*this.surf(name))); },
  takeDist(kind){ return 2*ballSpec(kind).r+TAKE_CLEAR_M; },

  /* ---------------- one tick ---------------- */
  /* Before the devices move (src/sim.js stepWorld): the supply, and which motors are flywheels. */
  prepare(){
    const S=this.supply(); this.mode=S.mode; this.why=S.why;
    this.markFlywheels(S.mode==="real");
    return S;
  },
  /* After the robot has moved: pieces in, along, out. */
  tick(dt,sim){
    sim=sim||Sim;
    if(!this.stats) this.reset();
    const S=this.prepare();
    if(S.mode!=="real"){ this.letGoAll(); return; }
    // pre-loads go in before START (or on its first pass, for a run started in one call), never into a
    // run already going: a field reset mid-run leaves the robot empty
    if(!this.primed){ if(sim.phase!=="running"||(sim.t||0)<=1.5*dt) this.prime(); else{ this.primed=true; this.held=[]; this.preloaded=0; } }
    if(sim.phase!=="running") return;
    this.t+=dt;
    const ins=this.intakes(), tr=this.transfer(), M=this.mouths(), X=this.box(), room=this.count()<MATCH_BOT.cap;
    for(const m of M) this.learn(m.name,dt,false,room&&this.atBall(m,X));
    if(tr) this.learn(tr,dt,true,false);
    this.stuckTick(dt,ins.concat(tr?[tr]:[],this.flywheels()));
    this.gripTick(dt);
    this.flowerTick(dt,M,X);
    this.grab(M,X);
    this.ejectTick(dt,M,X);
    this.move(dt,ins,tr);
    if(!this.gate()) this.straight(sim);
  },
  /* What the robot starts with: 4 POLLEN in AUTO (G304), none in TELEOP, or what the user set. */
  prime(){
    this.primed=true; this.held=[];
    const P=this.cfg(), auto=!!(Sim.code&&Sim.code.kind==="Autonomous");
    const n=Math.max(0,Math.min(MATCH_BOT.cap,P.preload!=null?Math.round(+P.preload)||0:(auto?4:0)));
    const L=this.pathLen(), r=ballSpec("pollen").r;
    for(let i=0;i<n;i++) this.held.push({kind:"pollen", color:null, s:L-i*2*r});
    this.preloaded=n;
  },
  count(){ return this.held.length+this.grips.length+this.fgrips.length; },
  letGoAll(){
    for(const g of this.grips) if(g.ball.hold&&g.ball.hold.id==="user"){ g.ball.hold=null; g.ball.sleep=false; }
    this.grips=[]; this.fgrips=[];
  },
  loose(){ return typeof Match!=="undefined"&&Match.pieces()?Match.floor:null; },

  /* A ball in a mouth rides in at the rollers' speed; the intake stopping lets it go. */
  gripTick(dt){
    const F=this.loose()||[];
    this.grips=this.grips.filter(g=>{
      const e=g.ball;
      if(F.indexOf(e)<0||!e.hold||e.hold.id!=="user") return false;
      if(this.inward(g.name)<=INTAKE_ON){ e.hold=null; e.sleep=false; return false; }
      const v=this.ballSpeed(g.name,g.dist); e.hold.v=v; g.prog+=v*dt;
      if(g.prog<g.dist-1e-9) return true;
      F.splice(F.indexOf(e),1); e.hold=null;
      this.takeIn(e.kind,e.color);
      return false;
    });
  },
  /* A loose ball on the tiles in a running mouth: a strip just outside the edge, a ball radius deep. */
  grab(M,X){
    const F=this.loose(); if(!F) return;
    for(const m of M){
      if(this.count()>=MATCH_BOT.cap) return;
      if(this.inward(m.name)<=INTAKE_ON) continue;
      if(this.grips.some(g=>g.name===m.name)||this.fgrips.some(g=>g.name===m.name)) continue;
      const best=this.ballIn(m,X);
      if(!best) continue;
      const e=best.e, dist=this.takeDist(e.kind);
      e.hold={id:"user", lx:best.p[0], ly:best.p[1], tx:best.p[0]-m.n[0]*dist, ty:best.p[1]-m.n[1]*dist, v:this.ballSpeed(m.name,dist)};
      e.sleep=false; e.claim=null;
      this.grips.push({ball:e, name:m.name, prog:0, dist});
    }
  },
  /* POLLEN out of a FLOWER's bottom opening, one at a time, when a running mouth is at it (G418). */
  flowerTick(dt,M,X){
    const fl=typeof Match!=="undefined"&&Match.pieces()?Match.flowers:[];
    this.fgrips=this.fgrips.filter(g=>{
      const m=M.find(q=>q.name===g.name);
      if(!m||this.inward(m.name)<=INTAKE_ON||!this.atOutlet(g.f,m,X)||!g.f.stack.length||g.f.stack[0].kind!=="pollen") return false;
      g.prog+=this.ballSpeed(m.name,g.dist)*dt;
      if(g.prog<g.dist-1e-9) return true;
      const e=g.f.stack.shift(); this.stats.flower++;
      this.takeIn(e.kind,e.color);
      return false;
    });
    for(const m of M){
      if(this.count()>=MATCH_BOT.cap) return;
      if(this.inward(m.name)<=INTAKE_ON||this.fgrips.some(g=>g.name===m.name)||this.grips.some(g=>g.name===m.name)) continue;
      const f=fl.find(q=>q.stack.length&&q.stack[0].kind==="pollen"&&this.atOutlet(q,m,X));
      if(f) this.fgrips.push({f, name:m.name, prog:0, dist:this.takeDist("pollen")});
    }
  },
  atOutlet(f,m,X){
    const p=this.local(X,f.x-f.n[0]*FLOWER_OUTLET_M,f.y-f.n[1]*FLOWER_OUTLET_M);
    const d=p[0]*m.n[0]+p[1]*m.n[1]-m.e, lat=p[0]*m.t[0]+p[1]*m.t[1]-m.c;
    return d>-0.04&&d<0.12&&Math.abs(lat)<m.w;
  },
  takeIn(kind,color){
    this.held.push({kind, color:kind==="nectar"?color:null, s:0});
    this.stats.picked++; this.dryNoted=false;
    // a real intake can't tell one NECTAR from another: taking the other alliance's isn't stopped, it's called
    if(kind==="nectar"&&color&&color!==this.alliance()){
      this.stats.g408++;
      Shots.note("Took in a "+color.toUpperCase()+" NECTAR: G408, a robot may not control the other alliance's NECTAR");
    }
  },
  /* An intake running the eject way puts out the piece nearest it, on its own take-in time. */
  ejectTick(dt,M,X){
    for(const m of M){
      if(this.inward(m.name)>=-INTAKE_ON||!this.held.length){ this.ej[m.name]=0; continue; }
      const p=this.held[this.held.length-1], dist=this.takeDist(p.kind);
      this.ej[m.name]=(this.ej[m.name]||0)+this.ballSpeed(m.name,dist)*dt;
      if(this.ej[m.name]<dist-1e-9) continue;
      this.ej[m.name]=0; this.held.pop(); this.stats.ejected++;
      this.spit(p,m,X);
    }
  },
  spit(p,m,X){
    const r=ballSpec(p.kind).r, lx=m.n[0]*(m.e+r+0.01)+m.t[0]*m.c, ly=m.n[1]*(m.e+r+0.01)+m.t[1]*m.c;
    const w=this.world(X,lx,ly), c=Math.cos(X.h), s=Math.sin(X.h), nx=m.n[0]*c-m.n[1]*s, ny=m.n[0]*s+m.n[1]*c;
    const v=Sim.vel||{x:0,y:0}, o={vx:nx*0.5+v.x, vy:ny*0.5+v.y};
    if(this.loose()) Match.drop(p.kind,p.color,w[0],w[1],o);
    else Shots.landed.push({pos:[w[0]/IN,w[1]/IN,r/IN], t:0, kind:p.kind, color:p.color, ball:ballSpawn({kind:p.kind},Object.assign({x:w[0], y:w[1]},o))});
  },
  /* Pieces inside travel to the shooter end at the speed the transfer (else the intake) moves
     them, a ball's width apart; the first one there waits to be let out. */
  move(dt,ins,tr){
    let v=0;
    if(tr){ if(this.inward(tr)>INTAKE_ON) v=0.5*this.surf(tr); }
    else for(const n of ins) if(this.inward(n)>INTAKE_ON) v=Math.max(v,0.5*this.surf(n));
    this.feedV=v;                                       // how hard the pieces are being pushed along, this tick
    if(!(v>0)) return;
    const L=this.pathLen();
    for(let i=0;i<this.held.length;i++){
      const p=this.held[i], cap=i===0?L:this.held[i-1].s-ballSpec(p.kind).r-ballSpec(this.held[i-1].kind).r;
      if(p.s<cap) p.s=Math.min(cap,p.s+v*dt);
    }
  },
  waiting(){ const h=this.held[0]; return !!h&&h.s>=this.pathLen()-1e-6; },
  /* No feeder or gate: what pushes a piece into the shooter is the intake or the transfer. While
     one of them is running inward and the shooter turns fast enough the waiting piece goes, one at a
     time, no closer together than a ball takes to clear the shooter (its width and half the wheel it
     rides round, at the exit speed). With nothing pushing, it sits short of the wheels: a piece
     that left the moment the shooter started turning dribbled out at 1 m/s every time a driver
     picked a ball up before spinning up. */
  straight(sim){
    if(!this.waiting()||!Shots.cfg||!Shots.cfg.shooter||!(this.feedV>0)) return;
    const v=Shots.exitSpeed(); if(v<1) return;
    if(this.t-this.lastOut<this.clearTime(this.held[0].kind,v)) return;
    this.release(sim.chassis,"through "+Shots.cfg.shooter);
  },
  clearTime(kind,v){ return (2*ballSpec(kind).r+((Shots.cfg&&Shots.cfg.wheelMm)||96)/2000)/Math.max(1,v); },
  /* A gate held open passes waiting pieces on the same spacing. */
  flow(pose,why){
    if(!this.waiting()) return null;
    const v=Shots.exitSpeed();
    if(v<1||this.t-this.lastOut<this.clearTime(this.held[0].kind,v)) return null;
    return this.release(pose,why);
  },
  /* Let the next waiting piece out through the shooter. None waiting: nothing goes, one note. */
  release(pose,why){
    if(!this.waiting()){
      if(!this.dryNoted){ this.dryNoted=true;
        Shots.note(this.held.length?"Nothing launched: the next piece hasn't reached the shooter yet":"Nothing launched: the robot holds no game piece. Run the intake over one"); }
      return null;
    }
    const h=this.held[0];
    const b=Shots.fire(pose,why,(typeof Sim!=="undefined"&&Sim.vel)||null,{kind:h.kind, color:h.color});
    if(b){ this.held.shift(); this.stats.fired++; this.lastOut=this.t; this.dryNoted=false; }
    return b;
  },

  /* ---------------- the flywheel pays for the shot ---------------- */
  /* A wheel's numbers at the wheel: inertia (this motor's share of the Shot Sim's wheel set plus its
     own rotor through its gearbox and the wheel gearing), free speed and stall torque from the
     device's spec (src/hardware.js), else the Shot Sim's motor. T = I omega_free / tau_stall is how
     fast a DC motor's speed follows its command. The Shot tab describes ONE shooter: two motors the
     code runs together turn that one wheel set between them, so each carries half of it (counting
     the whole set on each made a shot cost half the dip the Shot Sim gives the same shooter). */
  flyParams(name,n){
    const s=Sim.dev[name], c=Shots.cfg||{}, sp=s&&s.spec;
    n=n>0?n:Math.max(1,this.flywheels().length);
    const key=[n,c.motorId,c.type,c.wheelMm,c.gear,sp&&sp.rpm,sp&&sp.stallNm,sp&&sp.guess].join("|");
    const hit=this._fly&&this._fly[name];
    if(hit&&hit.key===key) return hit;
    let rpm=6000, stall=0.1442, ratio=1;
    const mo=((typeof Field!=="undefined"&&Field.data&&Field.data.motors&&Field.data.motors.motors)||[]).find(x=>x.id===c.motorId);
    if(sp&&sp.rpm>0&&sp.stallNm>0&&!sp.guess){ rpm=sp.rpm; stall=sp.stallNm; ratio=sp.ratio>0?sp.ratio:6000/rpm; }
    else if(mo){ rpm=mo.freeRpm; stall=mo.stallTorqueNm; ratio=mo.ratio>0?mo.ratio:1; }
    const gear=c.gear>0?c.gear:1;
    let I=4e-4;
    try{ I=Field.E.motorModel(c.motorId,Shots.shooterSpec(),c.ball||"pollen",1).details.inertiaKgM2; }catch(e){}
    const rotor=((typeof JoltMech!=="undefined"&&JoltMech.ROTOR)?JoltMech.ROTOR.motor:5e-6)*ratio*ratio/(gear*gear);
    const share=I/n, It=share+rotor, wf=rpm*gear*2*Math.PI/60, ts=stall/gear;
    if(!this._fly) this._fly={};
    return (this._fly[name]={key, wheel:share, set:I, motors:n, rotor, I:It, wf, ts, T:It*wf/ts});
  },
  /* The flywheels get the torque model (src/sim.js stepDevices); every other motor keeps SLEW. */
  markFlywheels(on){
    if(typeof Sim==="undefined"||!Sim.dev) return;
    const names=on?this.flywheels():[];
    for(const n in Sim.dev){
      const s=Sim.dev[n];
      if(names.indexOf(n)>=0) s.flyT=this.flyParams(n,names.length).T;
      else if(s.flyT) delete s.flyT;
    }
  },
  /* A ball leaving at v takes its kinetic energy and spin (and the Shot Sim's slip loss) out of
     the wheels: each slows by the same share. Returns that share. */
  spend(v,kind){
    const c=Shots.cfg; if(!c) return 0;
    let E=0;
    try{ E=Field.E.motorModel(c.motorId,Shots.shooterSpec(),kind,v).shotEnergyJ; }
    catch(e){ const b=ballSpec(kind); E=2*(0.5*b.m*v*v+0.5*b.I*Math.pow(v/b.r,2)); }
    const names=this.flywheels(), fw=names.map(n=>[Sim.dev[n],this.flyParams(n,names.length)]);
    let KE=0;
    for(const [s,f] of fw) KE+=0.5*f.I*Math.pow(s.act*f.wf,2);
    if(!(KE>0)||!(E>0)) return 0;
    const k=Math.sqrt(Math.max(0,1-E/KE));
    for(const [s] of fw) s.act*=k;
    this.lastDrop=1-k;
    return 1-k;
  },

  /* ---------------- what the panel, the HUD and a headless run show ---------------- */
  summary(){
    const S=this.supply(), st=this.stats||{picked:0, ejected:0, fired:0, scored:0, flower:0, g408:0};
    const mouths=S.mode==="real"?this.mouths():[];
    return {supply:S.mode, why:S.why, picked:st.picked, ejected:st.ejected, fired:st.fired, scored:st.scored,
      fromFlowers:st.flower, otherNectar:st.g408, preloaded:this.preloaded||0,
      held:this.held.map(p=>({kind:p.kind, color:p.color})),
      intakes:mouths.map(m=>{ const d=this.dirs[m.name]||{};
        return {name:m.name, edge:m.edge, edgeFrom:m.from, in:d.sign>0?"positive":d.sign<0?"negative":null, inFrom:d.from||null, decidedAt:d.t==null?null:d.t}; }),
      transfer:S.mode==="real"?this.transfer():null, gate:S.mode==="real"?this.gate():null,
      flywheels:S.mode==="real"?this.flywheels():[],
      notTurning:Object.keys(this.stuckSaid||{})};
  }
};
