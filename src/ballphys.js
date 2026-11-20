/* ============================================================
   7a'. BALL PHYSICS — POLLEN and NECTAR as real balls

   A small sphere physics of its own (no Jolt: it runs headless in the
   tests, is cheap, and replays exactly): a fixed step near 240 Hz,
   gravity, the Shot Sim's own air drag and backspin lift while a ball
   flies, and on contact restitution and friction that turn slip into
   spin. On the foam tiles a ball bounces low, rolls with its spin matched
   to its speed, and slows to a stop on the tiles' rolling resistance.
   Balls hit each other (a spatial hash finds the pairs), and fall asleep
   once at rest, so forty balls lying about cost next to nothing.

   The field around them (field.js, Field.ballStatics) is planes for the
   tiles and the perimeter, capsules for the HIVE frame, boxes for the
   FLOWERs and the CELLs as the Shot Sim draws them: a thin-walled tube
   open at its mouth for the up-CELL a ball is aimed at, solid otherwise.
   A ball whose centre gets a radius past the mouth into that tube is in.

   Robots are kinematic boxes: each tick a robot goes from where it was
   to where it is in the same small steps, so a ball is pushed by the face
   that meets it and never passes through. A ball an intake has gripped
   (`hold`) rides with the robot until it's taken in or let go.

   Units: metres, seconds, radians, the field frame (field.js), +z up.
   A ball is any object with x, y, z, vx, vy, vz, wx, wy, wz and kind;
   ballSpawn fills in what's missing.
   ============================================================ */
const BALL_HZ=240;
const BALL_K={
  g:9.81,
  floorE:0.42, floorMu:0.55, rollC:0.05,   // foam tiles: soft, a low bounce, real rolling resistance
  wallE:0.55, wallMu:0.25,                 // the perimeter
  hiveE:0.5, hiveMu:0.3,                   // HIVE frame, CELL walls, FLOWERs
  robotE:0.3, robotMu:0.35,                // a robot's side
  ballE:0.6,                               // ball on ball (hollow plastic)
  vRest:0.12,                              // slower than this into a surface, no bounce: it just stays in contact
  spinZ:2.5,                               // 1/s: spin about the vertical dies on the foam
  sleepV:0.012, sleepT:0.3,                // at rest this long, a ball sleeps until something touches it
  cell:0.1                                 // m: spatial hash cell (a NECTAR is 92 mm across)
};
const BALL_DEF={pollen:{Din:2.80, massLb:0.055, wallIn:0.070}, nectar:{Din:91.948/25.4, massLb:0.091, wallIn:2.159/25.4}};
const BALL_AERO={rho:1.2, cd:0.45, clSlope:0.2, clSMax:1};

/* The constants of one kind of ball: radius, mass, k = I/(m r^2), drag and lift per unit mass.
   From the Shot Sim when it's loaded (the same numbers its flights use), else its defaults. */
const _ballSpecs={}, _bsFast={src:undefined, pollen:null, nectar:null};
function ballSpec(kind){
  const src=typeof Field!=="undefined"&&Field.ok&&Field.E?Field.E:null, F=_bsFast;
  if(F.src===src){ const s=kind==="nectar"?F.nectar:F.pollen; if(s) return s; }
  else{ F.src=src; F.pollen=F.nectar=null; }
  kind=kind==="nectar"?"nectar":"pollen";
  return (F[kind]=ballSpecOf(kind,src));
}
function ballSpecOf(kind,src){
  const key=kind+(src?"|E":"");
  if(_ballSpecs[key]&&_ballSpecs[key].src===src) return _ballSpecs[key];
  let r, m, I, A=BALL_AERO;
  if(src){
    const bp=src.ballProps(kind); r=bp.rIn*0.0254; m=bp.massKg; I=bp.I;
    try{ const c=src.constants().aero; A={rho:c.rho, cd:c.cd, clSlope:c.clSlope, clSMax:c.clSMax}; }catch(e){}
  }else{
    const d=BALL_DEF[kind], R=d.Din/2*0.0254, Ri=R-d.wallIn*0.0254;
    r=R; m=d.massLb*0.45359237;
    I=0.4*m*(Math.pow(R,5)-Math.pow(Ri,5))/(Math.pow(R,3)-Math.pow(Ri,3));
  }
  const area=Math.PI*r*r;
  return (_ballSpecs[key]={kind, src, r, m, I, k:I/(m*r*r), kd:0.5*A.rho*A.cd*area/m, kl0:0.5*A.rho*area/m*A.clSlope, smax:A.clSMax});
}

/* Make o a ball: at rest on the tiles unless o (or opts) says otherwise. */
function ballSpawn(o,opts){
  const sp=ballSpec(o.kind);
  if(opts) for(const k in opts) o[k]=opts[k];
  if(o.z==null) o.z=sp.r;
  for(const k of ["vx","vy","vz","wx","wy","wz"]) if(o[k]==null) o[k]=0;
  o.sleep=false; o.still=0;
  return o;
}

/* Backspin for a ball going along (vx, vy): about the horizontal axis across its way, s surface m/s. */
function ballBackspin(b,vx,vy,surf){
  const h=Math.hypot(vx,vy), r=ballSpec(b.kind).r;
  if(h<1e-9){ b.wx=b.wy=b.wz=0; return; }
  b.wx=vy/h*surf/r; b.wy=-vx/h*surf/r; b.wz=0;
}

function ballWorld(){
  return {
    statics:[], prev:new Map(), ms:0, msAvg:0, steps:0,
    /* Wake every ball (the HIVE swung: what lay on it has nothing under it now). */
    wakeAll(balls){ for(const b of balls) if(b.sleep){ b.sleep=false; b.still=0; } },

    /* One tick of dt for these balls among these robots.
       boxes: [{id, x, y, h, hx, hy, hz}] where each robot is now; where it was is remembered by id.
       Returns the events: {type:"hit", ball, tag} on a ball's first contact,
       {type:"sink", ball, tag} when one goes into a CELL (it's out of the world then). */
    step(dt,balls,boxes){
      const t0=ballNow(), ev=[];
      const n=Math.max(1,Math.round(dt*BALL_HZ)), h=dt/n;
      const B=this.boxes(dt,boxes||[]);
      for(let i=0;i<balls.length;i++){ const b=balls[i]; b._i=i; if(b.sunk) continue;
        // a sleeping ball wakes when a robot comes up to it
        if(b.sleep) for(const X of B) if(b.x>X.x0-0.06&&b.x<X.x1+0.06&&b.y>X.y0-0.06&&b.y<X.y1+0.06&&(X.moved||ballBoxPen(b,ballSpec(b.kind).r,X))){ b.sleep=false; b.still=0; break; }
      }
      for(let s=1;s<=n;s++){
        const f=s/n;
        for(const X of B) ballBoxAt(X,f);
        for(const b of balls){
          if(b.sunk||b.sleep) continue;
          if(b.hold){ this.carry(b,B,h); continue; }
          const sp=ballSpec(b.kind), V=Math.sqrt(b.vx*b.vx+b.vy*b.vy+b.vz*b.vz);
          // a fast ball moves at most 0.4 r between contact checks, so it can't skip through a thin CELL wall
          const m=Math.min(8,Math.max(1,Math.ceil(V*h/(0.4*sp.r)))), hm=h/m;
          b._floor=false;
          for(let k=0;k<m&&!b.sunk;k++){
            if(b.z>sp.r+1e-3||b.vz>0.05) ballFly(b,sp,hm);
            else{ b.vz-=BALL_K.g*hm; b.x+=b.vx*hm; b.y+=b.vy*hm; b.z+=b.vz*hm; }
            this.collide(b,sp,B,ev);
          }
        }
        this.pairs(balls);
        // a ball another one knocked into a robot comes back out: the robots win
        if(B.length) for(const b of balls) if(b._pm){ b._pm=false; if(!b.sunk&&!b.sleep&&!b.hold) this.robots(b,ballSpec(b.kind),B,null); }
        // asleep only at the end of a tick, so a robot arriving later in it always finds the ball awake
        for(const b of balls) if(!b.sunk&&!b.sleep&&!b.hold) ballRest(b,ballSpec(b.kind),h,s===n);
      }
      this.steps++;
      this.ms=ballNow()-t0; this.msAvg=this.msAvg?this.msAvg*0.95+this.ms*0.05:this.ms;
      return ev;
    },

    /* The robots for this tick: where each was, where it is, how fast its points move. */
    boxes(dt,boxes){
      const out=[], seen=new Set();
      for(const q of boxes){
        const p=this.prev.get(q.id)||q; seen.add(q.id);
        const dh=wrapAngle(q.h-p.h), moved=Math.abs(q.x-p.x)+Math.abs(q.y-p.y)+Math.abs(dh)>1e-6;
        const ext=(x,y,a)=>{ const c=Math.abs(Math.cos(a)), s=Math.abs(Math.sin(a)); return [c*q.hx+s*q.hy, s*q.hx+c*q.hy]; };
        const e0=ext(p.x,p.y,p.h), e1=ext(q.x,q.y,q.h);
        out.push({id:q.id, px:p.x, py:p.y, ph:p.h, dx:q.x-p.x, dy:q.y-p.y, dh, hx:q.hx, hy:q.hy, hz:q.hz||0.4,
          vx:(q.x-p.x)/dt, vy:(q.y-p.y)/dt, wz:dh/dt, moved,
          x0:Math.min(p.x-e0[0],q.x-e1[0]), x1:Math.max(p.x+e0[0],q.x+e1[0]), y0:Math.min(p.y-e0[1],q.y-e1[1]), y1:Math.max(p.y+e0[1],q.y+e1[1]),
          x:p.x, y:p.y, h:p.h, c:Math.cos(p.h), s:Math.sin(p.h)});
        this.prev.set(q.id,{x:q.x, y:q.y, h:q.h});
      }
      for(const id of [...this.prev.keys()]) if(!seen.has(id)) this.prev.delete(id);
      return out;
    },

    /* Everything a ball can touch, once: the field, then the robots, then the field again
       (a robot can shove a ball into a wall: then it squirts out sideways). */
    collide(b,sp,B,ev){
      const S=this.statics, r=sp.r;
      for(let i=0;i<S.length;i++){
        const C=S[i];
        // a group: the next n pieces, skipped together when the ball is nowhere near their box
        if(b.x<C.x0-r||b.x>C.x1+r||b.y<C.y0-r||b.y>C.y1+r||b.z<C.z0-r||b.z>C.z1+r){ if(C.type==="group") i+=C.n; continue; }
        if(C.type==="group") continue;
        if(C.type==="sdf"&&C.sink&&C.sink(b,r)){ b.sunk=C.al||"in"; ev.push({type:"sink", ball:b, al:C.al}); return; }
        if(ballStatic(b,sp,C)&&!b.hitTag){ b.hitTag=C.tagOf?C.tagOf(b):C.tag; ev.push({type:"hit", ball:b, tag:b.hitTag}); }
      }
      this.robots(b,sp,B,ev);
    },
    /* The robots win: a ball is pushed out of every one it's in. One pressed between a robot
       and a wall (or another robot) squirts out along the robot's face, the nearer way. */
    robots(b,sp,B,ev){
      const S=this.statics, r=sp.r;
      let pinned=null;
      for(const X of B){
        if(b.x<X.x0-r||b.x>X.x1+r||b.y<X.y0-r||b.y>X.y1+r) continue;
        // the robot a shot leaves from, until the ball is clear of it (or has hit anything)
        if(b.ignore===X.id){ if(!ballBoxPen(b,r,X)||b.hitTag) b.ignore=null; else continue; }
        if(ballBox(b,sp,X)){ pinned=X; if(ev&&!b.hitTag){ b.hitTag="robot"; ev.push({type:"hit", ball:b, tag:"robot"}); } }
      }
      if(!pinned) return;
      for(const C of S) if(C.type==="plane"&&!C.floor) ballStatic(b,sp,C);
      for(const X of B) if(X!==pinned&&b.ignore!==X.id) ballBox(b,sp,X);
      const walls=S.filter(C=>C.type==="plane"&&!C.floor);
      for(const X of B){
        if(b.ignore===X.id||!ballBoxPen(b,r,X)) continue;
        // still in it: the shortest way out of the box that isn't into a wall, quickly
        const dx=b.x-X.x, dy=b.y-X.y, lx=dx*X.c+dy*X.s, ly=-dx*X.s+dy*X.c;
        const ways=[[1,0,X.hx-lx+r],[-1,0,X.hx+lx+r],[0,1,X.hy-ly+r],[0,-1,X.hy+ly+r]].sort((p,q)=>p[2]-q[2]);
        const at=(w)=>{ const ux=w[0]*X.c-w[1]*X.s, uy=w[0]*X.s+w[1]*X.c; return [ux,uy,b.x+ux*(w[2]+5e-4),b.y+uy*(w[2]+5e-4)]; };
        const open=(q)=>{ const o={x:q[2], y:q[3], z:b.z};
          return walls.every(C=>q[2]*C.n[0]+q[3]*C.n[1]-C.c>=r-1e-4)&&B.every(Y=>Y===X||b.ignore===Y.id||!ballBoxPen(o,r,Y)); };
        let q=null;
        for(const w of ways){ const c=at(w); if(open(c)){ q=c; break; } }
        if(!q) for(const w of ways){ const c=at(w); if(walls.every(C=>c[2]*C.n[0]+c[3]*C.n[1]-C.c>=r-1e-4)){ q=c; break; } }
        if(!q) continue;
        b.x=q[2]; b.y=q[3];
        const vt=b.vx*q[0]+b.vy*q[1], want=0.6+Math.hypot(X.vx,X.vy);
        if(vt<want){ b.vx+=q[0]*(want-vt); b.vy+=q[1]*(want-vt); }
      }
    },

    /* A gripped ball rides in the intake, drawn in toward the rollers. */
    carry(b,B,h){
      const H=b.hold, X=B.find(x=>x.id===H.id);
      if(!X){ b.hold=null; return; }
      if(H.tx!=null){ const d=H.tx-H.lx, st=0.5*h; H.lx+=Math.abs(d)<st?d:Math.sign(d)*st; }
      const px=X.x+H.lx*X.c-H.ly*X.s, py=X.y+H.lx*X.s+H.ly*X.c;
      b.vx=X.vx-X.wz*(py-X.y); b.vy=X.vy+X.wz*(px-X.x); b.vz=0;
      b.x=px; b.y=py; b.z=ballSpec(b.kind).r; b.wx=b.wy=b.wz=0; b.still=0;
    },

    /* Ball on ball: the pairs from a spatial hash, in array order (the same every run). */
    pairs(balls){
      let any=false; for(const b of balls) if(!b.sunk&&!b.sleep){ any=true; break; }
      if(!any) return;
      const C=BALL_K.cell, grid=this._grid||(this._grid=new Map()), used=this._used||(this._used=[]), key=(i,j)=>(i+512)*2048+(j+512);
      for(const L of used) L.length=0;
      used.length=0;
      if(grid.size>4096) grid.clear();
      for(const b of balls){ if(b.sunk) continue;
        const k=key(Math.floor(b.x/C),Math.floor(b.y/C)); let L=grid.get(k); if(!L) grid.set(k,L=[]); if(!L.length) used.push(L); L.push(b); }
      for(const a of balls){
        if(a.sunk||a.sleep) continue;
        const i=Math.floor(a.x/C), j=Math.floor(a.y/C);
        for(let dj=-1;dj<=1;dj++) for(let di=-1;di<=1;di++){
          const L=grid.get(key(i+di,j+dj)); if(!L) continue;
          for(const b of L){
            if(b===a) continue;
            if(!(b.sleep||b.hold)&&b._i<a._i) continue;         // each awake pair once
            ballPair(a,b);
          }
        }
      }
    }
  };
}

function ballNow(){ return typeof performance!=="undefined"&&performance.now?performance.now():Date.now(); }
function wrapAngle(a){ while(a>Math.PI) a-=2*Math.PI; while(a<-Math.PI) a+=2*Math.PI; return a; }
function ballBoxAt(X,f){ X.x=X.px+X.dx*f; X.y=X.py+X.dy*f; X.h=X.ph+X.dh*f; X.c=Math.cos(X.h); X.s=Math.sin(X.h); }

/* In the air: gravity, drag and backspin lift, RK4 like the Shot Sim's own flights. */
function ballFly(b,sp,h){
  const g=BALL_K.g, kd=sp.kd, kl0=sp.kl0, smax=sp.smax, r=sp.r;
  const W=Math.sqrt(b.wx*b.wx+b.wy*b.wy+b.wz*b.wz), ux=W>1e-9?b.wx/W:0, uy=W>1e-9?b.wy/W:0, uz=W>1e-9?b.wz/W:0, wr=W*r;
  // drag -kd V v; lift kl0 S V (u x v), S = w r / V capped (the Shot Sim's: kl0 S V^2 across the way it goes)
  const acc=(vx,vy,vz,o)=>{
    const V=Math.sqrt(vx*vx+vy*vy+vz*vz);
    let S=V>1e-9?wr/V:0; if(S>smax) S=smax;
    const kl=kl0*S*V;
    o[0]=-kd*V*vx+kl*(uy*vz-uz*vy); o[1]=-kd*V*vy+kl*(uz*vx-ux*vz); o[2]=-g-kd*V*vz+kl*(ux*vy-uy*vx);
  };
  const a1=_ka, a2=_kb, a3=_kc, a4=_kd;
  const vx=b.vx, vy=b.vy, vz=b.vz, h2=h/2;
  acc(vx,vy,vz,a1);
  acc(vx+h2*a1[0],vy+h2*a1[1],vz+h2*a1[2],a2);
  acc(vx+h2*a2[0],vy+h2*a2[1],vz+h2*a2[2],a3);
  acc(vx+h*a3[0],vy+h*a3[1],vz+h*a3[2],a4);
  b.x+=h/6*(vx+2*(vx+h2*a1[0])+2*(vx+h2*a2[0])+(vx+h*a3[0]));
  b.y+=h/6*(vy+2*(vy+h2*a1[1])+2*(vy+h2*a2[1])+(vy+h*a3[1]));
  b.z+=h/6*(vz+2*(vz+h2*a1[2])+2*(vz+h2*a2[2])+(vz+h*a3[2]));
  b.vx+=h/6*(a1[0]+2*a2[0]+2*a3[0]+a4[0]);
  b.vy+=h/6*(a1[1]+2*a2[1]+2*a3[1]+a4[1]);
  b.vz+=h/6*(a1[2]+2*a2[2]+2*a3[2]+a4[2]);
}
const _ka=[0,0,0], _kb=[0,0,0], _kc=[0,0,0], _kd=[0,0,0];

/* Settle a ball on the tiles: rolling resistance, spin matched to rolling, and sleep. */
function ballRest(b,sp,h,canSleep){
  const r=sp.r;
  if(b._floor){
    // still slipping (a spun ball landing): friction in contact does that; rolling: the foam holds it back
    const sx=b.vx-r*b.wy, sy=b.vy+r*b.wx;
    if(sx*sx+sy*sy<9e-4){
      const v=Math.sqrt(b.vx*b.vx+b.vy*b.vy), dv=BALL_K.rollC*BALL_K.g*h;
      if(v<=dv){ b.vx=0; b.vy=0; } else { const k=(v-dv)/v; b.vx*=k; b.vy*=k; }
      b.wx=-b.vy/r; b.wy=b.vx/r;
    }
    b.wz*=Math.max(0,1-BALL_K.spinZ*h);
    if(b.vx*b.vx+b.vy*b.vy<BALL_K.sleepV*BALL_K.sleepV&&Math.abs(b.vz)<0.05&&b.z<r+2e-3){
      b.still+=h;
      if(b.still>=BALL_K.sleepT&&canSleep){ b.sleep=true; b.vx=b.vy=b.vz=b.wx=b.wy=b.wz=0; b.z=r; }
    }else b.still=0;
  }else b.still=0;
}

/* One contact: push out along n by pen, bounce off a surface moving at u, and let friction
   turn the contact point's slip into spin. Returns true. */
function ballContact(b,sp,nx,ny,nz,pen,ux,uy,uz,e,mu){
  const r=sp.r;
  b.x+=nx*pen; b.y+=ny*pen; b.z+=nz*pen;
  const rx=b.vx-ux, ry=b.vy-uy, rz=b.vz-uz, vn=rx*nx+ry*ny+rz*nz;
  if(vn>=0) return true;
  const jn=-(1+(vn<-BALL_K.vRest?e:0))*vn;
  b.vx+=jn*nx; b.vy+=jn*ny; b.vz+=jn*nz;
  // the contact point is -r n from the centre: its velocity v + w x (-r n)
  const cx=b.wy*nz-b.wz*ny, cy=b.wz*nx-b.wx*nz, cz=b.wx*ny-b.wy*nx;
  let tx=b.vx-ux-r*cx, ty=b.vy-uy-r*cy, tz=b.vz-uz-r*cz;
  const tn=tx*nx+ty*ny+tz*nz; tx-=tn*nx; ty-=tn*ny; tz-=tn*nz;
  const s=Math.sqrt(tx*tx+ty*ty+tz*tz);
  if(s>1e-9){
    const jt=Math.min(mu*jn, s/(1+1/sp.k)), qx=tx/s, qy=ty/s, qz=tz/s, kw=jt/(sp.k*r);
    b.vx-=jt*qx; b.vy-=jt*qy; b.vz-=jt*qz;
    b.wx+=kw*(ny*qz-nz*qy); b.wy+=kw*(nz*qx-nx*qz); b.wz+=kw*(nx*qy-ny*qx);
  }
  return true;
}

/* A ball against one fixed piece of the field. Returns true on contact. */
function ballStatic(b,sp,C){
  const r=sp.r;
  if(C.type==="plane"){
    const d=b.x*C.n[0]+b.y*C.n[1]+b.z*C.n[2]-C.c;
    if(d>=r) return false;
    if(C.floor) b._floor=true;
    return ballContact(b,sp,C.n[0],C.n[1],C.n[2],r-d,0,0,0,C.e,C.mu);
  }
  if(C.type==="capsule"){
    const a=C.a, ex=C.b[0]-a[0], ey=C.b[1]-a[1], ez=C.b[2]-a[2], L2=ex*ex+ey*ey+ez*ez;
    let t=L2>1e-12?((b.x-a[0])*ex+(b.y-a[1])*ey+(b.z-a[2])*ez)/L2:0; t=t<0?0:t>1?1:t;
    const dx=b.x-a[0]-ex*t, dy=b.y-a[1]-ey*t, dz=b.z-a[2]-ez*t, d=Math.sqrt(dx*dx+dy*dy+dz*dz), R=r+C.r;
    if(d>=R) return false;
    if(d<1e-9) return ballContact(b,sp,0,0,1,R,0,0,0,C.e,C.mu);
    return ballContact(b,sp,dx/d,dy/d,dz/d,R-d,0,0,0,C.e,C.mu);
  }
  if(C.type==="aabb"){
    const qx=Math.max(C.x0,Math.min(C.x1,b.x)), qy=Math.max(C.y0,Math.min(C.y1,b.y)), qz=Math.max(C.z0,Math.min(C.z1,b.z));
    const dx=b.x-qx, dy=b.y-qy, dz=b.z-qz, d=Math.sqrt(dx*dx+dy*dy+dz*dz);
    if(d>=r) return false;
    if(d>1e-9) return ballContact(b,sp,dx/d,dy/d,dz/d,r-d,0,0,0,C.e,C.mu);
    const f=[[C.x1-b.x,1,0,0],[b.x-C.x0,-1,0,0],[C.y1-b.y,0,1,0],[b.y-C.y0,0,-1,0],[C.z1-b.z,0,0,1]].sort((p,q)=>p[0]-q[0])[0];
    return ballContact(b,sp,f[1],f[2],f[3],f[0]+r,0,0,0,C.e,C.mu);
  }
  if(C.type==="sdf"){
    const d=C.dist(b.x,b.y,b.z,b);
    if(d>=r) return false;
    const e=1e-4;
    let gx=C.dist(b.x+e,b.y,b.z,b)-C.dist(b.x-e,b.y,b.z,b);
    let gy=C.dist(b.x,b.y+e,b.z,b)-C.dist(b.x,b.y-e,b.z,b);
    let gz=C.dist(b.x,b.y,b.z+e,b)-C.dist(b.x,b.y,b.z-e,b);
    let g=Math.sqrt(gx*gx+gy*gy+gz*gz);
    if(g<1e-9){ const V=Math.hypot(b.vx,b.vy,b.vz)||1; gx=-b.vx/V; gy=-b.vy/V; gz=V===1&&!b.vz?1:-b.vz/V; g=Math.hypot(gx,gy,gz)||1; }
    return ballContact(b,sp,gx/g,gy/g,gz/g,r-d,0,0,0,C.e,C.mu);
  }
  return false;
}

/* How deep a ball is in a robot's box, and which way is out (world frame), or null. */
function ballBoxPen(b,r,X){
  if(b.z-r>=X.hz) return null;
  const dx=b.x-X.x, dy=b.y-X.y, lx=dx*X.c+dy*X.s, ly=-dx*X.s+dy*X.c;
  const qx=Math.max(-X.hx,Math.min(X.hx,lx)), qy=Math.max(-X.hy,Math.min(X.hy,ly)), qz=Math.max(0,Math.min(X.hz,b.z));
  const ex=lx-qx, ey=ly-qy, ez=b.z-qz, d=Math.sqrt(ex*ex+ey*ey+ez*ez);
  if(d>=r) return null;
  let nx, ny, nz, pen;
  if(d>1e-9){ nx=ex/d; ny=ey/d; nz=ez/d; pen=r-d; }
  else{
    const ox=X.hx-Math.abs(lx), oy=X.hy-Math.abs(ly), oz=X.hz-b.z;
    if(oz<ox&&oz<oy){ nx=0; ny=0; nz=1; pen=oz+r; }
    else if(ox<oy){ nx=lx>=0?1:-1; ny=0; nz=0; pen=ox+r; }
    else{ nx=0; ny=ly>=0?1:-1; nz=0; pen=oy+r; }
  }
  return {nx:nx*X.c-ny*X.s, ny:nx*X.s+ny*X.c, nz, pen};
}
/* A ball against a robot: pushed out, and hit by the robot's face at the speed that point moves. */
function ballBox(b,sp,X){
  const p=ballBoxPen(b,sp.r,X); if(!p) return false;
  const ux=X.vx-X.wz*(b.y-X.y), uy=X.vy+X.wz*(b.x-X.x);
  return ballContact(b,sp,p.nx,p.ny,p.nz,p.pen,ux,uy,0,BALL_K.robotE,BALL_K.robotMu);
}

/* Two balls: apart along the line of centres, and a bounce that keeps momentum. A sleeping ball
   only wakes for a real knock; a gripped one is held as if fixed. */
function ballPair(a,b){
  const sa=ballSpec(a.kind), sb=ballSpec(b.kind), R=sa.r+sb.r;
  const dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z, d2=dx*dx+dy*dy+dz*dz;
  if(d2>=R*R) return;
  const d=Math.sqrt(d2), nx=d>1e-9?dx/d:1, ny=d>1e-9?dy/d:0, nz=d>1e-9?dz/d:0, pen=R-d;
  const vn=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny+(a.vz-b.vz)*nz;
  if(b.sleep&&(vn<-0.03||pen>0.002)){ b.sleep=false; b.still=0; }
  const wa=a.hold?0:1/sa.m, wb=b.sleep||b.hold?0:1/sb.m, W=wa+wb;
  if(W<=0) return;
  a._pm=b._pm=true;
  a.x+=nx*pen*wa/W; a.y+=ny*pen*wa/W; a.z+=nz*pen*wa/W;
  b.x-=nx*pen*wb/W; b.y-=ny*pen*wb/W; b.z-=nz*pen*wb/W;
  if(vn>=0) return;
  const J=-(1+(vn<-BALL_K.vRest?BALL_K.ballE:0))*vn/W;
  a.vx+=J*wa*nx; a.vy+=J*wa*ny; a.vz+=J*wa*nz;
  b.vx-=J*wb*nx; b.vy-=J*wb*ny; b.vz-=J*wb*nz;
}
