/* ============================================================
   CHALLENGES — a few short things to try with the sample robot
   ------------------------------------------------------------
   Four cards, one at a time: drive to the far tile, turn to face a HIVE,
   move the lift or claw, park in your LOADING ZONE. Each one is checked
   against what the simulator really holds (the robot's pose and speed, its
   devices, the field's own LOADING ZONES and HIVEs), never against a click.
   A card shows its goal, a live line that says how far there is to go, and a
   done state; any card can be skipped.

   The checks are pure: (snapshot, memory) in, {done, note, progress} out.
   The snapshot is metres and radians in the field frame (src/field.js); the
   page builds it from Sim and Field (chalSnapshot), the tests by hand.
   ============================================================ */
const CHAL_IN=0.0254;
const chalWrap=a=>{ while(a>Math.PI) a-=2*Math.PI; while(a<-Math.PI) a+=2*Math.PI; return a; };
const chalClamp=v=>Math.max(0,Math.min(1,v));
const chalInches=m=>Math.max(0,Math.round(m/CHAL_IN));
/* the OpMode is not running: after STOP (or the end of the period) it has to be INIT'd again first */
const chalIdle=snap=>({done:false, note:snap.phase==="stopped"?"Press INIT, then START.":"Press START to drive.", progress:0});

/* What the checks read. sim: the live Sim (phase, t, chassis, vel, footprint, dev, code); F: the
   field's data (Field.data.field); al: the alliance the robot plays for. */
function chalSnapshot(sim,F,al){
  const ch=sim.chassis||{x:0,y:0,h:0}, fp=sim.footprint||{hx:0.2286,hy:0.2286,ox:0,oy:0};
  const c=Math.cos(ch.h), s=Math.sin(ch.h), ox=fp.ox||0, oy=fp.oy||0, I=CHAL_IN;
  const zones={}, hives={};
  for(const a of ["red","blue"]){
    const z=F.loadingZones[a]; zones[a]={x0:z.x0*I, x1:z.x1*I, y0:z.y0*I, y1:z.y1*I};
    hives[a]={x:F.hive.hiveX[a]*I, y:0};
  }
  const code=sim.code&&sim.code.devices||[], devs=[];
  for(const d of code){
    const s0=sim.dev&&sim.dev[d.name]; if(!s0) continue;
    devs.push({name:d.name, kind:s0.kind, act:s0.act, ticks:s0.ticks, drive:typeof isDriveDevice==="function"&&isDriveDevice(d)});
  }
  return {
    running:sim.phase==="running", phase:sim.phase, t:sim.t||0, al:al==="blue"?"blue":"red",
    x:ch.x, y:ch.y, h:ch.h, vx:(sim.vel&&sim.vel.x)||0, vy:(sim.vel&&sim.vel.y)||0,
    box:{x:ch.x+ox*c-oy*s, y:ch.y+ox*s+oy*c, h:ch.h, hx:fp.hx, hy:fp.hy},
    half:F.field.half*I, tile:F.field.tile*I, zones, hives, devs,
  };
}

/* 1. The far tile: the last row of tiles, along the other alliance's wall. The HIVEs sit across the
      straight way, so the robot has to go around them. */
function chalFar(snap,st){
  const s=snap.al==="blue"?-1:1, edge=snap.half-snap.tile, d=s*snap.x;
  if(!snap.running) return chalIdle(snap);
  if(st.start==null) st.start=Math.min(d,edge-1e-6);
  if(d>=edge) return {done:true, note:"On the far tile.", progress:1};
  return {done:false, note:chalInches(edge-d)+" in to go", progress:chalClamp((d-st.start)/(edge-st.start))};
}

/* 2. Face a HIVE: the robot's front within 10 degrees of the line to a HIVE, held half a second.
      Not counted from where it already faced one: it has to turn off by 30 degrees or more first. */
function chalFace(snap,st){
  if(!snap.running) return chalIdle(snap);
  let best=null;
  for(const a of ["red","blue"]){
    const hv=snap.hives[a], dx=hv.x-snap.x, dy=hv.y-snap.y, dist=Math.hypot(dx,dy);
    if(dist<0.4) continue;                                    // on top of it, there is no front to point
    const err=chalWrap(Math.atan2(dy,dx)-snap.h);
    if(!best||Math.abs(err)<Math.abs(best.err)) best={err, dist};
  }
  if(!best) return {done:false, note:"Back away from the HIVE, then turn to it.", progress:0};
  const off=Math.abs(best.err)*180/Math.PI;
  if(off>30) st.armed=true;
  if(!st.armed) return {done:false, note:"Turn away from the HIVEs first.", progress:0};
  if(off<=10){
    if(st.since==null) st.since=snap.t;
    if(snap.t-st.since>=0.5) return {done:true, note:"Facing a HIVE.", progress:1};
    return {done:false, note:"Hold it there.", progress:0.9};
  }
  st.since=null;
  return {done:false, note:"Turn "+(best.err>0?"left":"right")+" "+Math.round(off)+"°", progress:chalClamp(1-(off-10)/170)};
}

/* 3. Move something: any servo or motor that is not on the drivetrain. What the code does as soon
      as it starts (a servo settling to its first position) is let go by for a second and a half;
      what moves after that counts, a servo by 0.12 of its range, a motor by 150 ticks. */
function chalMove(snap,st){
  if(!snap.running) return chalIdle(snap);
  if(st.t0==null) st.t0=snap.t;
  const others=snap.devs.filter(d=>!d.drive);
  if(!others.length) return {done:false, note:"This OpMode has nothing but the drive motors.", progress:0};
  if(snap.t-st.t0<1.5) return {done:false, note:"Press A, B, X or Y.", progress:0};
  if(!st.base){ st.base={}; for(const d of others) st.base[d.name]=d.kind==="servo"?d.act:d.ticks; }
  let best=null;
  for(const d of others){
    const was=st.base[d.name]; if(was==null) continue;
    const moved=d.kind==="servo"?Math.abs(d.act-was)/0.12:Math.abs(d.ticks-was)/150;
    if(!best||moved>best.moved) best={name:d.name, moved};
  }
  if(best&&best.moved>=1) return {done:true, note:best.name+" moved.", progress:1};
  return {done:false, note:"Press A, B, X or Y.", progress:best?chalClamp(best.moved):0};
}

/* 4. PARK: any part of the robot over its own LOADING ZONE (the bench scores PARK by the same rule),
      and stopped there for a second. */
function chalPark(snap,st){
  if(!snap.running) return chalIdle(snap);
  const z=snap.zones[snap.al], b=snap.box, c=Math.abs(Math.cos(b.h)), s=Math.abs(Math.sin(b.h));
  const ex=c*b.hx+s*b.hy, ey=s*b.hx+c*b.hy;
  const inZone=b.x+ex>z.x0&&b.x-ex<z.x1&&b.y+ey>z.y0&&b.y-ey<z.y1;
  if(!inZone){
    st.since=null;
    const dx=Math.max(z.x0-(b.x+ex),0,(b.x-ex)-z.x1), dy=Math.max(z.y0-(b.y+ey),0,(b.y-ey)-z.y1);
    return {done:false, note:chalInches(Math.hypot(dx,dy))+" in from your LOADING ZONE", progress:0};
  }
  if(Math.hypot(snap.vx,snap.vy)>0.12){ st.since=null; return {done:false, note:"In the zone. Stop there.", progress:0.5}; }
  if(st.since==null) st.since=snap.t;
  const held=snap.t-st.since;
  if(held>=1) return {done:true, note:"Parked.", progress:1};
  return {done:false, note:"Hold still…", progress:0.5+0.5*chalClamp(held)};
}

const CHALLENGES=[
  {id:"far",  title:"Drive to the far tile",         goal:"Cross to the last row of tiles, on the other alliance's wall. The HIVEs are in the way, so go around.", check:chalFar},
  {id:"face", title:"Turn to face a HIVE",           goal:"Turn the robot until its front points at a HIVE, and hold it there for a moment.", check:chalFace},
  {id:"move", title:"Move the lift or the claw",     goal:"Press A, B, X or Y. This robot's lift and claw answer to gamepad2.", check:chalMove},
  {id:"park", title:"Park in your LOADING ZONE",     goal:"Drive into your own LOADING ZONE and stop. That is PARK, worth 5 points in a match.", check:chalPark},
];

/* Progress: {done:{id:1}, skipped:{id:1}}. The card on show is the first one not done or skipped. */
function chalNext(prog,list){
  const L=list||CHALLENGES, p=prog||{};
  for(const c of L) if(!(p.done&&p.done[c.id])&&!(p.skipped&&p.skipped[c.id])) return c;
  return null;
}
function chalMark(prog,id,kind){
  const p={done:Object.assign({},prog&&prog.done), skipped:Object.assign({},prog&&prog.skipped)};
  if(kind==="done"||kind==="skipped") p[kind][id]=1;
  return p;
}
function chalLoad(text){
  let j=null; try{ j=JSON.parse(text); }catch(e){}
  const ids=new Set(CHALLENGES.map(c=>c.id)), pick=o=>{ const r={}; for(const k in (o||{})) if(ids.has(k)&&o[k]) r[k]=1; return r; };
  return {done:pick(j&&j.done), skipped:pick(j&&j.skipped), on:!!(j&&j.on), closed:!!(j&&j.closed)};
}

/* ---------------- the card on the field ---------------- */
const Challenges={
  prog:{done:{},skipped:{}}, on:false, closed:false, card:null, cur:null, st:{}, flash:null, shown:"",
  init(){
    const s=chalLoad(store.get("ftcbench.challenges","{}"));
    this.prog={done:s.done, skipped:s.skipped}; this.on=s.on; this.closed=s.closed;
    const vp=$("#viewport"); if(!vp) return;
    const c=document.createElement("section");
    c.className="chal-card panel-glass"; c.id="chalCard"; c.hidden=true; c.setAttribute("aria-label","Challenge"); c.setAttribute("aria-live","polite");
    vp.appendChild(c); this.card=c;
    c.addEventListener("click",e=>{
      const b=e.target.closest("[data-chal]"); if(!b) return;
      if(b.dataset.chal==="skip") this.skip();
      else if(b.dataset.chal==="close") this.close();
      else if(b.dataset.chal==="again") this.restart();
    });
    const m=$("#chalMenu"); if(m) m.addEventListener("click",()=>{ Menu.open(false); this.enable(true,true); });
  },
  save(){ store.set("ftcbench.challenges",JSON.stringify({done:this.prog.done, skipped:this.prog.skipped, on:this.on, closed:this.closed})); },
  /* turn the cards on (the quick start does; so does the menu, which also starts over when all were done) */
  enable(b,fromMenu){
    this.on=!!b; this.closed=false;
    if(b&&!chalNext(this.prog)&&fromMenu){ this.prog={done:{},skipped:{}}; }
    this.cur=null; this.flash=null; this.save();
  },
  restart(){ this.prog={done:{},skipped:{}}; this.closed=false; this.on=true; this.cur=null; this.flash=null; this.save(); },
  skip(){ if(!this.cur) return; this.prog=chalMark(this.prog,this.cur.id,"skipped"); this.cur=null; this.flash=null; this.save(); },
  close(){ this.closed=true; this.save(); this.card.hidden=true; },
  /* the sample robot is on the field: the cards are about it, not about a robot of the user's own */
  fits(){ return !!(CAD&&CODE&&Field.ok&&!ownRobot()&&CAD.name===DEFAULT_ROBOT.step); },
  tick(now){
    const c=this.card; if(!c) return;
    if(!this.on||this.closed||!this.fits()||(typeof CadView!=="undefined"&&CadView.on)){ c.hidden=true; return; }
    c.hidden=false;
    const total=CHALLENGES.length;
    // a card just finished stays up for a moment, then the next one
    if(this.flash){
      if(now<this.flash.until){ this.paint({n:this.flash.n, total, title:this.flash.title, goal:"", note:"Done.", progress:1, done:true}); return; }
      this.flash=null;
    }
    const cur=chalNext(this.prog);
    if(!cur){
      const skipped=Object.keys(this.prog.skipped).length;
      this.paint({n:total, total, title:"That is all of them", goal:skipped?"You skipped "+skipped+". Start again to try them.":"Drop in your own robot from the Robot tab to drive it the same way.", note:"", progress:1, done:true, last:true});
      return;
    }
    if(!this.cur||this.cur.id!==cur.id){ this.cur=cur; this.st={}; }
    const r=cur.check(chalSnapshot(Sim,Field.data.field,Shots.alliance),this.st);
    const n=CHALLENGES.indexOf(cur)+1;
    if(r.done){
      this.prog=chalMark(this.prog,cur.id,"done"); this.save();
      this.flash={until:now+1600, n, title:cur.title}; this.cur=null;
      this.paint({n, total, title:cur.title, goal:"", note:"Done.", progress:1, done:true});
      return;
    }
    this.paint({n, total, title:cur.title, goal:cur.goal, note:r.note, progress:r.progress||0, done:false});
  },
  paint(v){
    const key=JSON.stringify([v.n,v.title,v.goal,v.note,Math.round(v.progress*50),v.done,!!v.last]);
    if(key===this.shown) return;
    this.shown=key;
    const check=`<svg class="chal-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    this.card.className="chal-card panel-glass"+(v.done?" done":"");
    this.card.innerHTML=
      `<div class="chal-head"><span class="chal-n">${v.last?"Challenges":"Challenge "+v.n+" of "+v.total}</span><span class="spacer"></span>`+
        (v.done?"":`<button type="button" class="chal-btn" data-chal="skip">Skip</button>`)+
        (v.last&&Object.keys(this.prog.skipped).length?`<button type="button" class="chal-btn" data-chal="again">Start again</button>`:"")+
        `<button type="button" class="chal-x" data-chal="close" aria-label="Close the challenges">×</button></div>`+
      `<h3 class="chal-title">${v.done?check:""}${esc(v.title)}</h3>`+
      (v.goal?`<p class="chal-goal">${esc(v.goal)}</p>`:"")+
      (v.note&&!v.last?`<div class="chal-live"><i style="width:${Math.round(v.progress*100)}%"></i><span>${esc(v.note)}</span></div>`:"");
  },
};
