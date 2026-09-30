/* ============================================================
   7c.  MATCH — the rest of a BIOBUZZ match around the team's robot

   Three robots the bench drives itself (an alliance partner and two
   opponents) and each alliance's HUMAN PLAYER, playing the period the
   team's OpMode runs (AUTO 0:30 or TELEOP 2:00) by the Competition Manual:
     - a robot controls at most 4 elements (G407) and never the other
       alliance's NECTAR (G408); in AUTO it stays on its own side (G402)
     - launching into its own up-CELL is the only way to TIP (G417); a
       CELL tips at 190 g (field.js), and what was in it falls out on the
       side it was up on
     - NECTAR goes into a FLOWER only in the last 60 s (G410), through the
       top; only POLLEN comes out, from the bottom (G418)
     - a HUMAN PLAYER enters one NECTAR into the LOADING ZONE after each of
       their own HIVE's TIPs, and all that's left in the last 60 s
       (G426/G427). Nobody enters anything in AUTO.
   Their shots go through the Shot Sim exactly like the team's (the same
   CELLs, the same scatter), so a TIP is a TIP whoever makes it, and the
   team's robot and these push each other around. Everything random comes
   from one seeded source, so a match replays exactly.
   Online (src/net.js), some places are other people's robots instead
   (Match.players): the host's bench plays the match with them in it, and
   every other bench only mirrors it (Match.mirror), pushing its own robot.
   Units: metres and radians in the field frame (field.js), like
   Sim.chassis; ball flight paths are the Shot Sim's inches.
   ============================================================ */
const MATCH_BOT={hx:0.2286, hy:0.2286, h0In:16, hoodDeg:70, wheelMm:96, motorId:"yj6000", cap:4};
/* How good the AI teams are. pick: seconds to take an element in; miss: the share of pickups
   that knock the element away instead; settle: seconds lining up before the first shot.
   Calibrated so an elite pair makes about 11 TIPs in TELEOP, the strategy study's figure
   for the best alliances; a typical pair about 7, a rookie pair 3. */
const MATCH_SKILL={
  rookie: {label:"Rookie",  vmax:0.9, acc:1.8, turn:2.4, precision:"rough",   pick:1.2, miss:0.35, feed:0.9, settle:1.2, think:1.0},
  typical:{label:"Typical", vmax:1.2, acc:2.6, turn:3.2, precision:"typical", pick:0.95,miss:0.22, feed:0.6, settle:0.85,think:0.6},
  elite:  {label:"Elite",   vmax:1.6, acc:3.6, turn:4.2, precision:"dialed",  pick:0.5, miss:0.08, feed:0.4, settle:0.45,think:0.25}};
const MATCH_PTS={leave:3, parkAuto:5, park:5, tip:20, cell:2, flower:2, bottom:5, garden:1};
const HIVE_KEEP={x:(24+11)*IN, y:(19.5+11)*IN};   // the HIVE frame, half a robot and a margin: drive around it
const FLOWER_CAP=6;                                // ~4 POLLEN + 2 NECTAR fit between the rings
const wrapA=a=>{ while(a>Math.PI) a-=2*Math.PI; while(a<-Math.PI) a+=2*Math.PI; return a; };

const Match={
  on:false, skill:"typical", seed:1, period:"TeleOp", len:120, user:"red",
  bots:[], humans:null, floor:[], flowers:[], flying:[], events:[], placed:[], entries:[],
  version:0, t:0, rnd:null, nid:0, seenTip:0, tips0:{red:0, blue:0}, spotCache:null, obs:null,
  // online: the other drivers' robots as boxes {id, al, name, x, y, h, hx, hy}; net, this match is
  // an online one; mirror, the host plays it and this bench follows; noUser, this bench only watches
  players:[], net:false, mirror:false, noUser:false,
  /* Is there a match on the field? */
  live(){ return this.on&&(this.bots.length>0||this.net); },

  /* A fresh match: the field as staged, the three robots at legal starts.
     o: {period:"TeleOp"|"Autonomous", user:"red"|"blue", userPose, seed, skill,
         slots (online): {red1, red2, blue1, blue2: "user" | "ai" | "remote"}, AI robots only in "ai" places} */
  reset(o){
    o=o||{};
    this.period=o.period==="Autonomous"?"Autonomous":"TeleOp";
    this.len=this.period==="Autonomous"?30:120;
    this.user=o.user==="blue"?"blue":"red";
    if(o.seed!=null) this.seed=o.seed;
    if(o.skill&&MATCH_SKILL[o.skill]) this.skill=o.skill;
    this.rnd=makeRng(this.seed*7919+13);
    this.t=0; this.nid=0; this.flying=[]; this.events=[]; this.placed=[]; this.entries=[];
    this.spotCache=new Map(); this.obs=null; this.seenTip=Field.lastTip?Field.lastTip.id:0;
    this.tips0={red:Field.tips.red, blue:Field.tips.blue};
    this.floor=[]; this.flowers=[]; this.bots=[];
    this.humans={red:{tray:5, entered:0, busy:0, anim:null}, blue:{tray:5, entered:0, busy:0, anim:null}};
    if(!Field.ok){ this.version++; return; }
    const D=Field.data.field, H=D.field.half;
    // 4 POLLEN in each GARDEN, in a line in its corner; 4 in each FLOWER
    for(const al of ["red","blue"]){
      const s=al==="red"?-1:1, cx=s*(H-1.5), cy=s*(H-1.5);
      for(let i=0;i<4;i++) this.drop("pollen",null,(cx-s*i*2.9)*IN,cy*IN);
    }
    for(const fl of D.flowers){
      const n=fl.wall==="+y"?[0,1]:fl.wall==="-y"?[0,-1]:fl.wall==="+x"?[1,0]:[-1,0];
      this.flowers.push({x:fl.x*IN, y:fl.y*IN, n, stack:[0,1,2,3].map(()=>({kind:"pollen", color:null})), claim:null});
    }
    // TELEOP comes after AUTO: the 16 pre-loaded POLLEN have been launched, spilled or missed by
    // now and lie on the tiles around the HIVEs, both sides
    if(this.period==="TeleOp") for(let i=0;i<16;i++){
      const side=i%2?1:-1, al=i%4<2?"red":"blue", hx=Field.data.field.hive.hiveX[al];
      this.drop("pollen",null,(hx+(this.rnd()*2-1)*20)*IN,side*(30+this.rnd()*22)*IN);
    }
    if(o.slots){
      for(const s of ["red1","red2","blue1","blue2"]) if(o.slots[s]==="ai"){
        const al=/^blue/.test(s)?"blue":"red";
        this.addBot(al,/2$/.test(s)?(al==="red"?-45:45)*IN:0,s.slice(-1),s);
      }
      this.version++;
      return;
    }
    // the partner takes the start slot away from the team's robot; two opponents on the other wall
    const other=this.user==="red"?"blue":"red", up=o.userPose||Field.startPose(this.user);
    const slots=al=>[0,(al==="red"?-45:45)*IN];
    const ys=slots(this.user).sort((a,b)=>Math.abs(b-up.y)-Math.abs(a-up.y));
    this.addBot(this.user,ys[0],"partner");
    slots(other).forEach((y,i)=>this.addBot(other,y,"opponent "+(i+1)));
    this.version++;
  },
  addBot(al,y,role,place){
    const s=al==="red"?-1:1, H=Field.half();
    const b={id:"ai"+(this.bots.length+1), al, role, place:place||null, name:(al==="red"?"Red ":"Blue ")+role+" (AI)",
      x:s*(H-MATCH_BOT.hx), y, h:al==="red"?0:Math.PI, vx:0, vy:0,
      hold:[], plan:null, route:null, cool:0.2+this.bots.length*0.15, fire:0, stuck:0, best:1e9, fired:0, scored:0, skip:new Map()};
    b.x0=b.x; b.y0=b.y;
    // AUTO starts with 4 pre-loaded POLLEN (G304); TELEOP with whatever AUTO left, here none
    if(this.period==="Autonomous") for(let i=0;i<4;i++) b.hold.push({kind:"pollen", color:null});
    this.bots.push(b);
    return b;
  },
  drop(kind,color,x,y){
    const H=Field.half()-0.04;
    const e={id:++this.nid, kind, color:kind==="nectar"?color:null, x:Math.max(-H,Math.min(H,x)), y:Math.max(-H,Math.min(H,y)), claim:null};
    this.floor.push(e); return e;
  },
  note(text,al){ this.events.unshift({t:this.t, text, al:al||null}); if(this.events.length>40) this.events.length=40; },
  left(){ return this.len-this.t; },
  sk(){ return MATCH_SKILL[this.skill]||MATCH_SKILL.typical; },

  /* One 20 ms step, after the team's robot has moved. sim: the live Sim. */
  tick(dt,sim){
    if(!this.live()||!Field.ok||this.t>=this.len) return;
    this.t+=dt;
    if(!this.obs) this.obs=Field.obstacles(0.46);
    this.spill();
    for(const b of this.bots) this.think(b,dt);
    this.separate(sim);
    this.flights(dt);
    this.humansTick(dt);
    this.version++;
  },

  /* ---------------- a TIP: the CELL that was up spills on its side ---------------- */
  spill(){
    const L=Field.lastTip; if(!L||L.id===this.seenTip) return;
    this.seenTip=L.id;
    const hx=(Field.data.field.hive.hiveX||{})[L.al]!=null?Field.data.field.hive.hiveX[L.al]:(L.al==="red"?-12.75:12.75);
    for(const e of L.spilled||[]){
      const r=this.rnd();
      this.drop(e.kind,e.color,(hx+(r*2-1)*16)*IN,L.from*(26+this.rnd()*18)*IN);
    }
    const who=L.by?" by "+L.by:"";
    this.note(L.al.toUpperCase()+" HIVE TIPPED"+who+" (TIP "+(Field.tips[L.al]-this.tips0[L.al])+") +"+MATCH_PTS.tip,L.al);
  },

  /* ---------------- one robot's brain and body ---------------- */
  think(b,dt){
    const sk=this.sk();
    b.cool-=dt; b.fire-=dt;
    if(!b.plan||b.plan.done) b.plan=null;
    // the end of the period: park in the own LOADING ZONE
    if((!b.plan||b.plan.kind!=="park")&&this.left()<=this.parkTime(b)) b.plan=this.parkPlan(b);
    if(!b.plan&&b.cool<=0){ b.plan=this.choose(b); b.cool=sk.think; b.best=1e9; b.stuck=0; b.route=null; }
    const P=b.plan;
    if(!P){ this.drive(b,dt,b.x,b.y,null,true); return; }
    if(P.kind==="park"){ const d=this.drive(b,dt,P.x,P.y,P.h); if(d<0.04) P.parked=true; return; }
    if(P.kind==="collect") return this.doCollect(b,P,dt);
    if(P.kind==="retrieve") return this.doRetrieve(b,P,dt);
    if(P.kind==="shoot") return this.doShoot(b,P,dt);
    if(P.kind==="flower") return this.doFlower(b,P,dt);
    if(P.kind==="wait"){ P.until-=dt; this.drive(b,dt,b.x,b.y,null,true); if(P.until<=0) P.done=true; }
  },
  own(b,kind,color){ return kind==="pollen"||color===b.al; },
  autoSide(b){ return this.period==="Autonomous"?(b.al==="red"?-1:1):0; },
  onSide(b,x){ const s=this.autoSide(b); return !s||x*s>0.05; },
  zone(al){ const z=Field.data.field.loadingZones[al]; return {x0:z.x0*IN, x1:z.x1*IN, y0:z.y0*IN, y1:z.y1*IN}; },
  inRect(x,y,r){ return x>=r.x0&&x<=r.x1&&y>=r.y0&&y<=r.y1; },
  garden(al){ const g=Field.data.field.gardens[al]; return {x0:g.x0*IN-0.06, x1:g.x1*IN+0.06, y0:g.y0*IN-0.06, y1:g.y1*IN+0.06}; },

  /* What to do next: score what it holds, or fetch more. */
  choose(b){
    const nectarTime=this.period==="TeleOp"&&this.left()<=60;
    const hasNectar=b.hold.some(e=>e.kind==="nectar");
    if(nectarTime&&hasNectar){ const f=this.flowerFor(b); if(f) return f; }
    if(b.hold.length>=MATCH_BOT.cap) return this.shootPlan(b);
    const got=this.fetchPlan(b);
    if(got) return got;
    if(b.hold.length) return this.shootPlan(b);
    return {kind:"wait", until:0.8};
  },
  fetchPlan(b){
    const nectarTime=this.period==="TeleOp"&&this.left()<=60;
    let best=null, bc=1e9;
    for(const [id,until] of b.skip) if(until<=this.t) b.skip.delete(id);
    for(const e of this.floor){
      if(e.claim&&e.claim!==b.id) continue;
      if(b.skip.has(e.id)) continue;
      if(!this.own(b,e.kind,e.color)||!this.onSide(b,e.x)) continue;
      let c=Math.hypot(e.x-b.x,e.y-b.y);
      if(this.inRect(e.x,e.y,this.garden(b.al))) c+=1.2;           // it scores 1 where it lies
      if(this.inRect(e.x,e.y,this.garden(b.al==="red"?"blue":"red"))) c-=0.3; // and 1 for them
      if(e.kind==="nectar") c+=nectarTime?-1.0:-0.3;
      if(c<bc){ bc=c; best={kind:"collect", el:e}; }
    }
    for(const f of this.flowers){
      if(f.claim&&f.claim!==b.id) continue;
      if(!f.stack.length||f.stack[0].kind!=="pollen"||!this.onSide(b,f.x)||b.skip.has("f"+this.flowers.indexOf(f))) continue;
      let c=Math.hypot(f.x-b.x,f.y-b.y)+0.9;
      if(this.flowerOwner(f)===b.al) c+=2.5;                            // every element in an owned FLOWER is worth 2
      if(c<bc){ bc=c; best={kind:"retrieve", f}; }
    }
    if(best&&bc<6){ if(best.el) best.el.claim=b.id; if(best.f) best.f.claim=b.id; return best; }
    return null;
  },
  release(P){ if(P&&P.el&&P.el.claim) P.el.claim=null; if(P&&P.f&&P.f.claim) P.f.claim=null; },

  /* ---- fetching: drive the intake (the front edge) onto an element ---- */
  doCollect(b,P,dt){
    const e=P.el;
    if(this.floor.indexOf(e)<0||b.hold.length>=MATCH_BOT.cap){ this.release(P); P.done=true; return; }
    if(!P.dir) P.dir=this.approach(b,e);
    const reach=MATCH_BOT.hx+0.05, th=Math.atan2(P.dir[1],P.dir[0]);
    // where the robot's centre goes, kept where a robot can be (a ball in a corner is taken off-centre)
    const lim=Field.half()-MATCH_BOT.hx-0.01;
    const tx=Math.max(-lim,Math.min(lim,e.x-P.dir[0]*reach)), ty=Math.max(-lim,Math.min(lim,e.y-P.dir[1]*reach));
    const d=this.drive(b,dt,tx,ty,th);
    if(this.giveUp(b,d)){ this.release(P); b.skip.set(e.id,this.t+12); P.done=true; return; }
    if(this.inIntake(b,e)){
      P.pick=(P.pick||0)+dt;
      if(P.pick>=this.sk().pick){
        if(this.rnd()<this.sk().miss){                       // it squirted out: knocked a little way off
          const a=this.rnd()*2*Math.PI, r=0.1+this.rnd()*0.2, H=Field.half()-0.04;
          e.x=Math.max(-H,Math.min(H,e.x+Math.cos(a)*r)); e.y=Math.max(-H,Math.min(H,e.y+Math.sin(a)*r));
          P.dir=null; P.pick=0; b.best=1e9; b.stuck=0;
          return;
        }
        this.floor.splice(this.floor.indexOf(e),1);
        b.hold.push({kind:e.kind, color:e.color});
        P.done=true;
      }
    }
  },
  /* Which way to drive onto an element: straight at it, or square into a wall it's against. */
  approach(b,e){
    const H=Field.half(), near=0.33;
    const walls=[[1,0,H-e.x],[-1,0,H+e.x],[0,1,H-e.y],[0,-1,H+e.y]].filter(w=>w[2]<near).sort((p,q)=>p[2]-q[2]);
    if(walls.length) return [walls[0][0],walls[0][1]];
    const d=Math.hypot(e.x-b.x,e.y-b.y)||1; return [(e.x-b.x)/d,(e.y-b.y)/d];
  },
  /* The intake: just past the front edge, the robot's full width. */
  inIntake(b,e){
    const c=Math.cos(b.h), s=Math.sin(b.h), dx=e.x-b.x, dy=e.y-b.y, fx=dx*c+dy*s, fy=-dx*s+dy*c;
    return fx>MATCH_BOT.hx-0.03&&fx<MATCH_BOT.hx+0.13&&Math.abs(fy)<MATCH_BOT.hy-0.02;
  },
  /* POLLEN out of a FLOWER's bottom opening, from the field side (G418) */
  doRetrieve(b,P,dt){
    const f=P.f;
    if(!f.stack.length||f.stack[0].kind!=="pollen"||b.hold.length>=MATCH_BOT.cap){ this.release(P); P.done=true; return; }
    const off=MATCH_BOT.hx+0.09, tx=f.x-f.n[0]*off, ty=f.y-f.n[1]*off, th=Math.atan2(f.n[1],f.n[0]);
    const d=this.drive(b,dt,tx,ty,th);
    if(this.giveUp(b,d)){ this.release(P); b.skip.set("f"+this.flowers.indexOf(f),this.t+12); P.done=true; return; }
    if(d<0.05){
      P.pick=(P.pick||0)+dt;
      if(P.pick>=this.sk().pick*1.6){ f.stack.shift(); b.hold.push({kind:"pollen", color:null}); this.release(P); P.done=true; }
    }
  },
  /* ---- NECTAR on top of a FLOWER, last 60 s only (G410) ---- */
  flowerOwner(f){ for(let i=f.stack.length-1;i>=0;i--) if(f.stack[i].kind==="nectar") return f.stack[i].color; return null; },
  flowerFor(b){
    let best=null, bc=1e9;
    for(const f of this.flowers){
      if(f.stack.length>=FLOWER_CAP||(f.claim&&f.claim!==b.id)||b.skip.has("f"+this.flowers.indexOf(f))) continue;
      let c=Math.hypot(f.x-b.x,f.y-b.y);
      const own=this.flowerOwner(f);
      if(own===b.al) c+=2.0;                 // already ours: a second one only guards it
      else if(own) c-=0.8;                   // take it back: every element in it swings to us
      c-=f.stack.length*0.15;
      if(c<bc){ bc=c; best=f; }
    }
    if(best) best.claim=b.id;
    return best?{kind:"flower", f:best}:null;
  },
  doFlower(b,P,dt){
    const f=P.f, i=b.hold.findIndex(e=>e.kind==="nectar");
    if(i<0||f.stack.length>=FLOWER_CAP||!(this.period==="TeleOp"&&this.left()<=60)){ this.release(P); P.done=true; return; }
    const off=MATCH_BOT.hx+0.10, tx=f.x-f.n[0]*off, ty=f.y-f.n[1]*off, th=Math.atan2(f.n[1],f.n[0]);
    const d=this.drive(b,dt,tx,ty,th);
    if(this.giveUp(b,d)){ this.release(P); b.skip.set("f"+this.flowers.indexOf(f),this.t+12); P.done=true; return; }
    if(d<0.05){
      P.pick=(P.pick||0)+dt;
      if(P.pick>=this.sk().feed){
        const e=b.hold.splice(i,1)[0];
        f.stack.push({kind:"nectar", color:e.color});
        this.placed.push({t:this.t, al:b.al, by:b.id, color:e.color});
        this.note(b.name+" put a NECTAR on a FLOWER"+(this.flowerOwner(f)===b.al?" (theirs now)":""),b.al);
        this.release(P); P.done=true;
      }
    }
  },

  /* ---- shooting: a spot the Shot Sim likes, aimed at the own up-CELL ---- */
  params(al,x,y,kind){
    return {robot:{x:x/IN, y:y/IN}, target:al, ballId:kind, hiveState:{red:Field.hive.red, blue:Field.hive.blue},
      h0:MATCH_BOT.h0In, motorId:MATCH_BOT.motorId, shooter:{type:"single", wheelDiameterMm:MATCH_BOT.wheelMm, gear:1, motorsPerWheel:1},
      precision:this.precision()};
  },
  precision(){ const P=(Field.data.shooter&&Field.data.shooter.precision)||{}; return P[this.sk().precision]||P.typical||{sigThetaDeg:1,sigYawDeg:1,sigShooter:0.015}; },
  mouth(al){ return Field.model().mouthCentroid[al]; },
  /* The exit speeds that score from (x, y) aimed straight at the mouth: the middle of that band. */
  aimAt(al,x,y,kind){
    const m=this.mouth(al), yaw=Math.atan2(m[1]*IN-y,m[0]*IN-x)*180/Math.PI, p=this.params(al,x,y,kind), th=MATCH_BOT.hoodDeg;
    let lo=null, hi=null;
    for(let v=3; v<=11.01; v+=0.2) if(Field.E.classifyShot(p,th,v,yaw).hit){ if(lo===null) lo=v; hi=v; }
    if(lo===null) return null;
    const edge=(v0,dir)=>{ let v=v0; for(let i=0;i<9;i++){ const n=v+dir*0.02; if(!Field.E.classifyShot(p,th,n,yaw).hit) break; v=n; } return v; };
    lo=edge(lo,-1); hi=edge(hi,1);
    return {v:(lo+hi)/2, width:hi-lo, yaw};
  },
  spots(al,kind){
    const key=al+"|"+kind+"|"+Field.hive.red+","+Field.hive.blue+"|"+this.period;
    if(this.spotCache.has(key)) return this.spotCache.get(key);
    const sg=Field.hive[al], hx=(Field.data.field.hive.hiveX||{})[al]!=null?Field.data.field.hive.hiveX[al]:(al==="red"?-12.75:12.75);
    const s=this.period==="Autonomous"?(al==="red"?-1:1):0, out=[];
    for(const dx of [-26,-10,10,26]) for(const dy of [42,50,58]){
      const x=(hx+dx)*IN, y=sg*dy*IN;
      if(s&&x*s<0.25) continue;
      const a=this.aimAt(al,x,y,kind);
      if(a&&a.width>=0.15) out.push({x, y, v:a.v, width:a.width, yaw:a.yaw});
    }
    out.sort((a,b)=>b.width-a.width);
    this.spotCache.set(key,out);
    return out;
  },
  shootPlan(b){
    const kind=b.hold.length&&b.hold[0].kind==="nectar"?"nectar":"pollen", S=this.spots(b.al,kind);
    if(!S.length) return {kind:"wait", until:1};
    const taken=this.bots.filter(o=>o!==b&&o.plan&&o.plan.kind==="shoot"&&o.plan.spot).map(o=>o.plan.spot);
    let best=null, bc=1e9;
    for(const sp of S){
      if(taken.some(t=>Math.hypot(t.x-sp.x,t.y-sp.y)<0.6)) continue;
      const c=Math.hypot(sp.x-b.x,sp.y-b.y)-sp.width*2;
      if(c<bc){ bc=c; best=sp; }
    }
    if(!best) best=S[0];
    return {kind:"shoot", spot:best, hive:Field.hive[b.al]};
  },
  doShoot(b,P,dt){
    if(!b.hold.length){ P.done=true; return; }
    if(Field.hive[b.al]!==P.hive){ P.done=true; return; }             // it TIPPED: the up-CELL is on the other side now
    const sp=P.spot, m=this.mouth(b.al), aim=Math.atan2(m[1]*IN-b.y,m[0]*IN-b.x);
    const d=this.drive(b,dt,sp.x,sp.y,aim);
    if(this.giveUp(b,d)){ P.done=true; return; }
    const still=Math.hypot(b.vx,b.vy)<0.08, aimed=Math.abs(wrapA(aim-b.h))<0.03;
    if(d<0.06&&still&&aimed){ P.settled=(P.settled||0)+dt; } else if(d>0.15) P.settled=0;
    if(d<0.06&&still&&aimed&&b.fire<=0&&(P.settled||0)>=this.sk().settle){
      const e=b.hold.shift(), sk=this.sk(), pr=this.precision();
      const a=e.kind===(P.kindAim||"")?P.aim:this.aimAt(b.al,b.x,b.y,e.kind);
      P.kindAim=e.kind; P.aim=a;
      if(!a){ this.drop(e.kind,e.color,b.x,b.y); P.done=true; return; }
      const th=MATCH_BOT.hoodDeg+gauss(this.rnd)*pr.sigThetaDeg, yaw=b.h*180/Math.PI+gauss(this.rnd)*pr.sigYawDeg;
      const v=a.v*(1+gauss(this.rnd)*pr.sigShooter);
      const r=Field.E.classifyShot(this.params(b.al,b.x,b.y,e.kind),th,v,yaw);
      const path=r.path||[];
      b.fired++; b.fire=sk.feed;
      if(path.length<2){ this.drop(e.kind,e.color,b.x,b.y); return; }
      this.flying.push({path, t:0, dur:(path.length-1)*SHOT_STEP_S, hit:!!r.hit, cause:r.cause, kind:e.kind,
        color:e.color, al:b.al, by:b, pos:path[0].slice(), hive:Field.hive[b.al]});
    }
  },
  flights(dt){
    for(const f of this.flying){
      f.t+=dt;
      const k=Math.min(f.path.length-1,f.t/SHOT_STEP_S), i=Math.floor(k), fr=k-i;
      const a=f.path[i], c=f.path[Math.min(f.path.length-1,i+1)];
      f.pos=[a[0]+(c[0]-a[0])*fr, a[1]+(c[1]-a[1])*fr, a[2]+(c[2]-a[2])*fr];
      if(f.t>=f.dur) f.done=true;
    }
    for(const f of this.flying.filter(f=>f.done)){
      if(f.hit&&Field.hive[f.al]===f.hive){
        f.by.scored++;
        if(Field.addToCell(f.al,f.kind,f.color)) Field.lastTip.by=f.by.name;
      }else{
        const end=f.path[f.path.length-1];
        this.drop(f.kind,f.color,end[0]*IN+(this.rnd()-0.5)*0.15,end[1]*IN+(this.rnd()-0.5)*0.15);
      }
    }
    this.flying=this.flying.filter(f=>!f.done);
  },

  /* ---- parking ---- */
  /* A spot at least partly in the own LOADING ZONE, off the wall (parked against it, a robot
     would still be touching the wall and lose LEAVE in AUTO), clear of the other robots' spots. */
  parkSlot(b){
    if(b.slot) return b.slot;
    const z=this.zone(b.al), s=b.al==="red"?-1:1, x=s*(Field.half()-MATCH_BOT.hx-0.05);
    const ys=[z.y0+0.02,(z.y0+z.y1)/2,z.y1-0.02], busy=[];
    for(const o of this.bots) if(o!==b&&o.slot) busy.push(o.slot);
    busy.push(...this.people());
    let best=ys[1], bd=-1;
    for(const y of ys){ const m=Math.min(9,...busy.map(p=>Math.hypot(p.x-x,p.y-y))); if(m>bd+1e-6){ bd=m; best=y; } }
    b.slot={x, y:best, h:b.al==="red"?0:Math.PI};
    return b.slot;
  },
  /* Seconds to get parked from here, along the way it would really drive (re-measured twice a second). */
  parkTime(b){
    if(b.parkEst&&this.t-b.parkEst.t<0.5) return b.parkEst.s;
    const p=this.parkSlot(b), pts=this.routeTo(b,p,b); let L=0, a=b;
    for(const q of pts){ L+=Math.hypot(q.x-a.x,q.y-a.y); a=q; }
    b.parkEst={t:this.t, s:L/(this.sk().vmax*0.65)+3};
    return b.parkEst.s;
  },
  parkPlan(b){ this.release(b.plan); b.slot=null; const p=this.parkSlot(b); return {kind:"park", x:p.x, y:p.y, h:p.h}; },

  /* ---------------- moving: a holonomic drive around the HIVE ---------------- */
  giveUp(b,d){
    if(d<b.best-0.02){ b.best=d; b.stuck=0; return false; }
    b.stuck+=0.02;
    return b.stuck>3;
  },
  /* A path from a to t on a 9 cm grid of the field: A* round the HIVE's legs
     and foot bars, the FLOWERs, the walls and every other robot where it is
     now (the team's included), then cut down to the corners that matter.
     Under the HIVE is open between the legs, so robots may cross there. */
  routeTo(a,t,self){
    const g=this.grid(self), C=g.C, N=g.N, idx=(i,j)=>j*N+i;
    const cell=p=>[Math.max(0,Math.min(N-1,Math.floor((p.x+g.H)/C))), Math.max(0,Math.min(N-1,Math.floor((p.y+g.H)/C)))];
    const free=(i,j)=>i>=0&&j>=0&&i<N&&j<N&&!g.block[idx(i,j)];
    let [si,sj]=cell(a), [gi,gj]=cell(t);
    const near=(i0,j0)=>{ if(free(i0,j0)) return [i0,j0];            // the nearest open cell (a robot pressed on a leg, a target by a wall)
      for(let r=1;r<8;r++) for(let dj=-r;dj<=r;dj++) for(let di=-r;di<=r;di++){ if(Math.max(Math.abs(di),Math.abs(dj))!==r) continue; if(free(i0+di,j0+dj)) return [i0+di,j0+dj]; }
      return null; };
    const S=near(si,sj), T=near(gi,gj);
    if(!S||!T) return [t];
    const n=N*N, gs=new Float32Array(n).fill(Infinity), came=new Int32Array(n).fill(-1), open=[];
    const h=(i,j)=>{ const dx=Math.abs(i-T[0]), dy=Math.abs(j-T[1]); return Math.max(dx,dy)+0.4142*Math.min(dx,dy); };
    const push=(k,f)=>{ open.push([f,k]); let c=open.length-1; while(c>0){ const pr=(c-1)>>1; if(open[pr][0]<=open[c][0]) break; [open[pr],open[c]]=[open[c],open[pr]]; c=pr; } };
    const pop=()=>{ const top=open[0], last=open.pop(); if(open.length){ open[0]=last; let c=0; for(;;){ const l=2*c+1, r=l+1; let m=c;
      if(l<open.length&&open[l][0]<open[m][0]) m=l; if(r<open.length&&open[r][0]<open[m][0]) m=r; if(m===c) break; [open[m],open[c]]=[open[c],open[m]]; c=m; } } return top; };
    const s0=idx(S[0],S[1]), t0=idx(T[0],T[1]); gs[s0]=0; push(s0,h(S[0],S[1]));
    let found=false, guard=0;
    while(open.length&&guard++<4*n){
      const [f,k]=pop(); if(k===t0){ found=true; break; }
      const i=k%N, j=(k-i)/N, gk=gs[k];
      if(f-h(i,j)>gk+1e-6) continue;
      for(let dj=-1;dj<=1;dj++) for(let di=-1;di<=1;di++){
        if(!di&&!dj) continue;
        const ni=i+di, nj=j+dj; if(!free(ni,nj)) continue;
        if(di&&dj&&(!free(i+di,j)||!free(i,j+dj))) continue;          // no squeezing past a corner
        const nk=idx(ni,nj), w=gk+(di&&dj?1.4142:1);
        if(w<gs[nk]){ gs[nk]=w; came[nk]=k; push(nk,w+h(ni,nj)); }
      }
    }
    if(!found) return [t];
    const cells=[]; for(let k=t0;k!==-1;k=came[k]) cells.unshift(k);
    const at=k=>{ const i=k%N, j=(k-i)/N; return {x:-g.H+(i+0.5)*C, y:-g.H+(j+0.5)*C}; };
    // keep only the corners: the next point is as far along as a straight, clear run reaches
    const clear=(p,q)=>{ const L=Math.hypot(q.x-p.x,q.y-p.y), n2=Math.ceil(L/(C*0.5));
      for(let s2=1;s2<n2;s2++){ const u=s2/n2, c=cell({x:p.x+(q.x-p.x)*u, y:p.y+(q.y-p.y)*u}); if(!free(c[0],c[1])) return false; } return true; };
    const pts=[]; let from={x:a.x,y:a.y}, k=0;
    while(k<cells.length-1){
      let j=cells.length-1; while(j>k+1&&!clear(from,at(cells[j]))) j--;
      const p=j===cells.length-1?t:at(cells[j]);
      pts.push(p); from=p; k=j;
    }
    if(!pts.length||pts[pts.length-1]!==t) pts.push(t);
    return pts;
  },
  /* Is the straight run from a to q open, for robot self, right now? */
  clearRun(a,q,self){
    const g=this.grid(self), C=g.C, N=g.N, L=Math.hypot(q.x-a.x,q.y-a.y), n=Math.ceil(L/(C*0.5));
    for(let s=1;s<n;s++){ const u=s/n, i=Math.floor((a.x+(q.x-a.x)*u+g.H)/C), j=Math.floor((a.y+(q.y-a.y)*u+g.H)/C);
      if(i>=0&&j>=0&&i<N&&j<N&&g.block[j*N+i]) return false; }
    return true;
  },
  /* The grid: the field's fixed things once, every robot but `self` each time. */
  grid(self){
    // a robot driving at an angle sticks its corners out: keep its centre a corner's reach off the HIVE and FLOWERs
    const C=0.09, H=Field.half(), N=Math.ceil(2*H/C), R0=MATCH_BOT.hx+0.03, RC=Math.hypot(MATCH_BOT.hx,MATCH_BOT.hy)+0.02;
    if(!this._fixed||this._fixedN!==N){
      const f=new Uint8Array(N*N), obs=this.obs||Field.obstacles(0.46);
      for(let j=0;j<N;j++) for(let i=0;i<N;i++){
        const x=-H+(i+0.5)*C, y=-H+(j+0.5)*C;
        if(Math.abs(x)>H-MATCH_BOT.hx||Math.abs(y)>H-MATCH_BOT.hx){ f[j*N+i]=1; continue; }
        for(const o of obs){ if(segDist(x,y,o.a,o.b)<o.r+RC){ f[j*N+i]=1; break; } }
      }
      this._fixed=f; this._fixedN=N;
    }
    const block=this._fixed.slice();
    // AUTO: the other alliance's side of the field is off limits (G402)
    const side=self?this.autoSide(self):0;
    if(side) for(let j=0;j<N;j++) for(let i=0;i<N;i++){ const x=-H+(i+0.5)*C; if(x*side<MATCH_BOT.hx+0.02) block[j*N+i]=1; }
    // robots nearby, where they are now; ones far off will have moved by the time it gets there
    let bodies=this.bots.filter(o=>o!==self).map(o=>({x:o.x, y:o.y, r:Math.hypot(MATCH_BOT.hx,MATCH_BOT.hy)*0.8}));
    bodies.push(...this.people());
    if(self) bodies=bodies.filter(o=>Math.hypot(o.x-self.x,o.y-self.y)<1.3);
    for(const o of bodies){
      const rr=o.r+R0, i0=Math.floor((o.x-rr+H)/C), i1=Math.floor((o.x+rr+H)/C), j0=Math.floor((o.y-rr+H)/C), j1=Math.floor((o.y+rr+H)/C);
      for(let j=Math.max(0,j0);j<=Math.min(N-1,j1);j++) for(let i=Math.max(0,i0);i<=Math.min(N-1,i1);i++){
        const x=-H+(i+0.5)*C, y=-H+(j+0.5)*C; if(Math.hypot(x-o.x,y-o.y)<rr) block[j*N+i]=1; }
    }
    return {C, H, N, block};
  },
  /* Toward (tx, ty), facing th (null: the way it's going). Returns the distance left. */
  drive(b,dt,tx,ty,th,hold){
    const sk=this.sk(), goal={x:tx,y:ty};
    if(!hold){
      // plan again for a new goal, or twice a second; keep the old way unless the new one is
      // clearly shorter or the old one is blocked now, so a robot doesn't dither north and south of the HIVE
      if(!b.route||b.route.goal.x!==tx||b.route.goal.y!==ty) b.route={goal, pts:this.routeTo(b,goal,b), age:0};
      else if((b.route.age+=dt)>0.45){
        const pts=this.routeTo(b,goal,b), len=q=>{ let L=0, a=b; for(const p of q){ L+=Math.hypot(p.x-a.x,p.y-a.y); a=p; } return L; };
        const blocked=b.route.pts.length&&!this.clearRun(b,b.route.pts[0],b);
        if(blocked||len(pts)<len(b.route.pts)*0.85) b.route.pts=pts;
        b.route.age=0;
      }
    }
    let wp=hold?{x:b.x,y:b.y}:b.route.pts[0];
    if(!hold&&b.route.pts.length>1&&Math.hypot(wp.x-b.x,wp.y-b.y)<0.12){ b.route.pts.shift(); wp=b.route.pts[0]; }
    const dx=wp.x-b.x, dy=wp.y-b.y, dw=Math.hypot(dx,dy), last=hold||b.route.pts.length===1;
    let sp=Math.min(sk.vmax, last?Math.sqrt(2*sk.acc*Math.max(0,dw-0.005))*0.9:sk.vmax);
    let dvx=dw>1e-4?dx/dw*sp:0, dvy=dw>1e-4?dy/dw*sp:0;
    // keep off the other robots (the team's included); one in the way is driven round, on the goal's side
    const gx=dw>1e-4?dx/dw:0, gy=dw>1e-4?dy/dw:0;
    for(const o of this.others(b)){
      // the same clearance the planner keeps (grid(): r + half a robot + 3 cm), and a little more
      const ex=b.x-o.x, ey=b.y-o.y, e=Math.hypot(ex,ey), R=o.r+MATCH_BOT.hx+0.06;
      if(e<R&&e>1e-6){
        const k=(R-e)/R*sk.vmax*0.9; dvx+=ex/e*k; dvy+=ey/e*k;
        if(-(ex*gx+ey*gy)/e>0.25&&dw>0.05){
          let tx=ey/e, ty=-ex/e; if(tx*gx+ty*gy<0){ tx=-tx; ty=-ty; }
          const kt=Math.max(0.35,k)*1.1; dvx+=tx*kt; dvy+=ty*kt;
        }
      }
    }
    // AUTO: stay on the own side (G402)
    const s=this.autoSide(b); if(s&&(b.x+dvx*dt)*s<MATCH_BOT.hx) dvx=Math.max(0,dvx*s)*s;
    const ax=dvx-b.vx, ay=dvy-b.vy, a=Math.hypot(ax,ay), am=sk.acc*dt;
    if(a>am){ b.vx+=ax/a*am; b.vy+=ay/a*am; } else { b.vx=dvx; b.vy=dvy; }
    b.x+=b.vx*dt; b.y+=b.vy*dt;
    const want=th!=null?th:(Math.hypot(b.vx,b.vy)>0.25?Math.atan2(b.vy,b.vx):b.h);
    const eh=wrapA(want-b.h); b.h=wrapA(b.h+Math.sign(eh)*Math.min(Math.abs(eh),sk.turn*dt));
    this.keepOnField(b);
    return Math.hypot(tx-b.x,ty-b.y);
  },
  keepOnField(b){
    const box={x:b.x, y:b.y, h:b.h}, x0=b.x, y0=b.y;
    Field.collideBox(box,MATCH_BOT,this.obs||[]);
    if(this.autoSide(b)){ const s=this.autoSide(b); if(box.x*s<MATCH_BOT.hx) box.x=s*MATCH_BOT.hx; }
    b.x=box.x; b.y=box.y;
    if(Math.abs(b.x-x0)>1e-6) b.vx=0;
    if(Math.abs(b.y-y0)>1e-6) b.vy=0;
  },
  /* The robots people drive, as circles: the team's own and, online, everyone else's. */
  people(){
    const out=this.players.map(p=>({x:p.x, y:p.y, r:Math.hypot(p.hx,p.hy)*0.8}));
    if(this.userBody) out.push(this.userBody);
    return out;
  },
  /* Everyone else on the field, as circles: the other AI robots and the robots people drive. */
  others(b){
    const out=this.bots.filter(o=>o!==b).map(o=>({x:o.x, y:o.y, r:Math.hypot(MATCH_BOT.hx,MATCH_BOT.hy)*0.8}));
    return out.concat(this.people());
  },
  /* Robots can't share a spot: two boxes that overlap are pushed apart along
     the shallowest way out (exact for rotated boxes), half each. The team's
     robot takes its half too; the walls and the HIVE still hold it after.
     Online, another driver's robot moves only on its own computer: against
     it, this bench moves its own robots its half of the way, once a tick,
     and that computer does the other half. A mirror moves no AI robot. */
  separate(sim){
    const fp=sim&&sim.footprint, ch=sim&&sim.chassis, me=!!(fp&&ch&&!this.noUser), mine=!this.mirror;
    this.userBody=null;
    const userBox=()=>{ const c=Math.cos(ch.h), s=Math.sin(ch.h), ox=fp.ox||0, oy=fp.oy||0;
      return {x:ch.x+ox*c-oy*s, y:ch.y+ox*s+oy*c, h:ch.h, hx:fp.hx, hy:fp.hy}; };
    const box=b=>({x:b.x, y:b.y, h:b.h, hx:MATCH_BOT.hx, hy:MATCH_BOT.hy});
    const stopInto=(b,nx,ny)=>{ const into=b.vx*nx+b.vy*ny; if(into<0){ b.vx-=into*nx; b.vy-=into*ny; } };
    // the other drivers' robots: our half, once
    for(const P of this.players){
      if(mine) for(const B of this.bots){
        const m=boxPush(box(B),P); if(!m) continue;
        B.x+=m[0]/2; B.y+=m[1]/2; const l=Math.hypot(m[0],m[1])||1; stopInto(B,m[0]/l,m[1]/l);
      }
      if(me){ const m=boxPush(userBox(),P); if(m){ ch.x+=m[0]/2; ch.y+=m[1]/2; } }
    }
    for(let pass=0; pass<4; pass++){
      let moved=false;
      if(mine) for(let i=0;i<this.bots.length;i++) for(let j=i+1;j<this.bots.length;j++){
        const A=this.bots[i], B=this.bots[j], m=boxPush(box(A),box(B));
        if(!m) continue;
        moved=true; A.x+=m[0]/2; A.y+=m[1]/2; B.x-=m[0]/2; B.y-=m[1]/2;
        const l=Math.hypot(m[0],m[1])||1; stopInto(A,m[0]/l,m[1]/l); stopInto(B,-m[0]/l,-m[1]/l);
      }
      if(me) for(const B of this.bots){
        const m=boxPush(box(B),userBox());
        if(!m) continue;
        if(mine){ moved=true; B.x+=m[0]/2; B.y+=m[1]/2; ch.x-=m[0]/2; ch.y-=m[1]/2;
          const l=Math.hypot(m[0],m[1])||1; stopInto(B,m[0]/l,m[1]/l); }
        else if(pass===0){ ch.x-=m[0]/2; ch.y-=m[1]/2; }       // the host moves the AI robot its half
      }
      if(mine) for(const B of this.bots) this.keepOnField(B);
      if(me&&Field.ok) Field.collide(ch,fp,sim.obstacles||[]);
      if(!moved) break;
    }
    if(me){ const u=userBox(); this.userBody={x:u.x, y:u.y, r:Math.hypot(fp.hx,fp.hy)*0.8}; }
  },

  /* ---------------- HUMAN PLAYERS (G426/G427) ---------------- */
  humansTick(dt){
    if(this.period!=="TeleOp") return;
    for(const al of ["red","blue"]){
      const H=this.humans[al];
      H.busy-=dt;
      if(H.anim){
        H.anim.t+=dt;
        if(H.anim.t>=H.anim.dur){
          const to=H.anim.to; H.anim=null; H.tray--; H.entered++;
          this.drop("nectar",al,to.x,to.y);
          this.entries.push({t:this.t, al, earned:this.earned(al), lastMinute:this.left()<=60, x:to.x, y:to.y});
          this.note((al==="red"?"Red":"Blue")+" HUMAN PLAYER entered a NECTAR"+(this.left()<=60?"":" (for TIP "+H.entered+")"),al);
        }
        continue;
      }
      const allowed=H.entered<this.earned(al)||this.left()<=60;
      if(H.tray>0&&allowed&&H.busy<=0){
        const z=this.zone(al), r=this.rnd, s=al==="red"?-1:1;
        H.anim={t:0, dur:1.3, to:{x:s*(Field.half()-0.08-r()*0.12), y:z.y0+0.1+r()*(z.y1-z.y0-0.2)}};
        H.busy=2.2;
      }
    }
  },
  /* NECTAR a HUMAN PLAYER may enter: one per own TIP this period */
  earned(al){ return Field.tips[al]-this.tips0[al]; },

  /* ---------------- the score, as the period stands now ---------------- */
  robotsOf(al,sim){
    const out=this.bots.filter(b=>b.al===al).map(b=>({x:b.x, y:b.y, h:b.h, hx:MATCH_BOT.hx, hy:MATCH_BOT.hy, x0:b.x0, name:b.name}));
    for(const p of this.players) if(p.al===al) out.push({x:p.x, y:p.y, h:p.h, hx:p.hx, hy:p.hy, name:p.name});
    if(al===this.user&&!this.noUser&&sim&&sim.chassis&&sim.footprint){
      const ch=sim.chassis, fp=sim.footprint, c=Math.cos(ch.h), s=Math.sin(ch.h), ox=fp.ox||0, oy=fp.oy||0;
      out.push({x:ch.x+ox*c-oy*s, y:ch.y+ox*s+oy*c, h:ch.h, hx:fp.hx, hy:fp.hy, name:"your robot"});
    }
    return out;
  },
  score(sim){
    const S={};
    for(const al of ["red","blue"]){
      const r={tips:0, tipPts:0, leave:0, park:0, cell:0, flower:0, bottom:0, garden:0, total:0};
      r.tips=Field.tips[al]-this.tips0[al]; r.tipPts=r.tips*MATCH_PTS.tip;
      const bots=this.robotsOf(al,sim), z=this.zone(al), H=Field.half();
      for(const b of bots){
        const c=Math.abs(Math.cos(b.h)), s=Math.abs(Math.sin(b.h)), ex=c*b.hx+s*b.hy, ey=s*b.hx+c*b.hy;
        const inZone=b.x+ex>z.x0&&b.x-ex<z.x1&&b.y+ey>z.y0&&b.y-ey<z.y1;
        const offWall=H-Math.abs(b.x)-ex>0.01&&H-Math.abs(b.y)-ey>0.01;
        if(this.period==="Autonomous"){ if(offWall) r.leave+=MATCH_PTS.leave; if(inZone) r.park+=MATCH_PTS.parkAuto; }
        else if(inZone) r.park+=MATCH_PTS.park;
      }
      if(this.period==="TeleOp"){
        r.cell=Field.cells[al].length*MATCH_PTS.cell;
        for(const f of this.flowers){
          if(this.flowerOwner(f)===al) r.flower+=f.stack.length*MATCH_PTS.flower;
          const bottom=f.stack.find(e=>e.kind==="nectar"); if(bottom&&bottom.color===al) r.bottom+=MATCH_PTS.bottom;
        }
        const g=this.garden(al);
        r.garden=this.floor.filter(e=>this.inRect(e.x,e.y,g)).length*MATCH_PTS.garden;
      }
      r.total=r.tipPts+r.leave+r.park+r.cell+r.flower+r.bottom+r.garden;
      S[al]=r;
    }
    return S;
  }
};
/* Distance from (x, y) to segment a-b (2-D points as [x, y]). */
function segDist(x,y,a,b){
  const ux=b[0]-a[0], uy=b[1]-a[1], L2=ux*ux+uy*uy;
  const t=L2>1e-12?Math.max(0,Math.min(1,((x-a[0])*ux+(y-a[1])*uy)/L2)):0;
  return Math.hypot(x-a[0]-ux*t, y-a[1]-uy*t);
}
/* Does segment a-b pass through the inside of the box |x|<B.x, |y|<B.y? */
function segCrossesBox(a,b,B){
  let t0=0, t1=1; const dx=b.x-a.x, dy=b.y-a.y;
  const clip=(p,q)=>{ if(Math.abs(p)<1e-12) return q>0; const r=q/p; if(p<0){ if(r>t1) return false; if(r>t0) t0=r; } else { if(r<t0) return false; if(r<t1) t1=r; } return true; };
  if(!clip(-dx,a.x+B.x)||!clip(dx,B.x-a.x)||!clip(-dy,a.y+B.y)||!clip(dy,B.y-a.y)) return false;
  return t1-t0>1e-6;
}
/* How far to move box A so it no longer overlaps box B (both {x, y, h, hx, hy}),
   along the axis they overlap least on (separating axes); null when apart. */
function boxPush(A,B){
  const ax=[[Math.cos(A.h),Math.sin(A.h)],[-Math.sin(A.h),Math.cos(A.h)],[Math.cos(B.h),Math.sin(B.h)],[-Math.sin(B.h),Math.cos(B.h)]];
  const half=(Bx,n)=>{ const c=Math.cos(Bx.h), s=Math.sin(Bx.h);
    return Bx.hx*Math.abs(c*n[0]+s*n[1])+Bx.hy*Math.abs(-s*n[0]+c*n[1]); };
  let best=null, bo=Infinity;
  for(const n of ax){
    const d=(A.x-B.x)*n[0]+(A.y-B.y)*n[1], o=half(A,n)+half(B,n)-Math.abs(d);
    if(o<=0) return null;
    if(o<bo){ bo=o; const sg=d>=0?1:-1; best=[n[0]*o*sg, n[1]*o*sg]; }
  }
  return best;
}
