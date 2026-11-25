/* ============================================================
   8b.  SHOT FX — what a shot looks like from the flywheel to the CELL
   ------------------------------------------------------------
   Launch (a muzzle flash, a kick to the robot, a nudge to the follow camera),
   flight (a ball that spins the way a backspun ball does, a tapering ribbon
   behind it), score (a burst in the alliance colour, a ring, the CELL's glow,
   the ball settling into its place, a "+2" that floats up), miss (sparks where
   it hit the HIVE, dust where it lands) and intake (a swirl into the robot).

   Everything is pooled. Particles are one GPU Points object per blend mode,
   filled from a ring of slots; trails are one ribbon per ball in the air,
   rewritten in place; popups and rings are meshes made once. Nothing is
   allocated in a frame once the pools exist, and nothing is allocated per
   shot either.

   What a machine gets (src/tier.js, and View.lowGfx when the frame-rate
   watchdog has backed off):
     level 0  a few sparks, a short plain line for a trail, rings and popups
              that rise and fade (no pop, no shake)
     level 1  ribbon trails, ~160 sparks and ~60 dust puffs, camera nudge
     level 2  longer ribbons, ~384 sparks and ~128 dust puffs

   The top of this file is plain functions (tests/shotfx.test.mjs); the
   ShotFx object below them is the only thing that touches three.js.
   ============================================================ */

/* What each level draws. trail: samples along a ribbon (level 0: a line of
   `lineN` points); sparks/dust: particle slots; popups, rings: meshes. */
const FX_LEVELS=[
  {level:0, ribbon:false, trailN:6,  trailS:0.07, sparks:24,  dust:0,   popups:4, rings:2, burst:6,  flash:2,  shake:false, pop:false, glow:false},
  {level:1, ribbon:true,  trailN:14, trailS:0.13, sparks:160, dust:60,  popups:6, rings:4, burst:20, flash:6,  shake:true,  pop:true,  glow:true},
  {level:2, ribbon:true,  trailN:26, trailS:0.16, sparks:384, dust:128, popups:8, rings:6, burst:44, flash:12, shake:true,  pop:true,  glow:true}
];
/* the level a view draws at: its tier, one lower once the watchdog has said it can't keep up */
function fxLevel(tier,lowGfx){
  const t=Math.max(0,Math.min(2,(tier|0)));
  return lowGfx?0:t;
}

/* A pool of n things made once (make(i)). acquire() hands out a free one (or null
   when all are out); release(x) takes it back. No array grows past n. */
function fxPool(n,make){
  const items=new Array(n), free=new Array(n);
  for(let i=0;i<n;i++){ items[i]=make(i); free[i]=items[i]; }
  let nfree=n;
  return {
    items, size:n,
    free(){ return nfree; },
    used(){ return n-nfree; },
    acquire(){ return nfree>0?free[--nfree]:null; },
    release(x){ if(nfree<n) free[nfree++]=x; }
  };
}

const fxClamp01=v=>v<0?0:v>1?1:v;
const fxEaseOut=k=>{ k=fxClamp01(k); const u=1-k; return 1-u*u*u; };
/* a ball dropping into its place: the slide is an ease-out, the hop is a small bounce that dies away */
const fxHop=k=>{ k=fxClamp01(k); const u=1-k; return Math.abs(Math.sin(k*Math.PI*2.5))*u*u; };

/* How bright and how opaque sample i of n is along a trail (0 is the tail, n-1 the ball),
   age seconds after the ball landed (0 while it flies) over fade seconds. */
function trailFade(i,n,age,fade){
  const u=n>1?i/(n-1):1, a=fade>0?1-fxClamp01(age/fade):1;
  return Math.pow(u,1.6)*a;
}
/* how wide the ribbon is at sample i of n: a point at the tail, the ball's own width at the head */
function trailWidth(i,n,head){
  const u=n>1?i/(n-1):1;
  return head*(0.06+0.94*Math.pow(u,0.8));
}
/* The point of a path (field inches, one sample every `step` seconds) at time t, into out[0..2].
   Before the start it is the start, after the end it is the end. */
function fxPathAt(path,step,t,out){
  const last=path.length-1; if(last<0){ out[0]=out[1]=out[2]=0; return out; }
  const q=fxClamp01(t/(step*last))*last, i=Math.min(last-1,Math.floor(q)), f=q-i, a=path[i], c=path[Math.min(last,i+1)];
  out[0]=a[0]+(c[0]-a[0])*f; out[1]=a[1]+(c[1]-a[1])*f; out[2]=a[2]+(c[2]-a[2])*f;
  return out;
}
/* A floating score at age seconds of dur, into out: y (metres up from where it started), a (opacity),
   s (size, 1 = full: it pops in to 1.2 times and settles). pop false: no pop, it just rises and fades. */
function popupState(age,dur,pop,out){
  const k=fxClamp01(age/dur);
  out.y=0.2*fxEaseOut(k); out.a=k<0.55?1:k>=1?0:1-(k-0.55)/0.45; out.s=1;
  if(pop!==false){ const p=fxClamp01(age/0.14); out.s=p>=1?1:p<0.7?0.55+0.65*fxEaseOut(p/0.7):1.2-0.2*((p-0.7)/0.3); }
  return out;
}
/* The row a new floating score takes so it never covers one still showing near it: the lowest
   row no live popup within r metres (across the floor, x and z) is using. Each row is one popup
   height up on screen, so they stack from any camera distance. */
function popupSlot(live,x,z,r){
  let used=0;
  for(const P of live) if(Math.hypot(P.x-x,P.z-z)<r) used|=1<<Math.min(30,P.k||0);
  let k=0; while(used&(1<<k)) k++;
  return k;
}
/* The ball's backspin in rad/s, from its speed. Slow enough to read at 60 fps (a real flywheel's
   100 turns a second is a blur and, drawn frame by frame, a flicker). */
function fxSpinRate(speed){ return Math.max(12,Math.min(30,speed*3.2)); }
/* The axis a backspun ball turns about for a ball moving (dx,dy,dz) in view space (y up):
   horizontal, across its path, so the top comes back toward the shooter. Into out. Null if it isn't moving sideways. */
function fxSpinAxis(dx,dz,out){
  const l=Math.hypot(dx,dz); if(l<1e-9) return null;
  out[0]=-dz/l; out[1]=0; out[2]=dx/l; return out;
}
/* A shake that decays: amplitude (metres) of a nudge of `amp` metres t seconds after it started. */
function fxShakeAmp(amp,t,decay){ return amp*Math.exp(-t*(decay||14)); }

/* The "score points" of a ball in a CELL, from the match's table when it is loaded */
function fxCellPoints(){ return (typeof MATCH_PTS!=="undefined"&&MATCH_PTS.cell)||2; }
function fxTipPoints(){ return (typeof MATCH_PTS!=="undefined"&&MATCH_PTS.tip)||20; }

/* ---------------- particles: one Points object, a ring of slots ---------------- */
const FX_VERT="attribute float aSize; attribute vec4 aCol; uniform float uScale; varying vec4 vC;"+
  "void main(){ vC=aCol; vec4 mv=modelViewMatrix*vec4(position,1.0);"+
  " gl_PointSize=min(160.0,aSize*uScale/max(0.05,-mv.z)); gl_Position=projectionMatrix*mv; }";
const FX_FRAG="varying vec4 vC; void main(){ float r=length(gl_PointCoord-0.5)*2.0; float a=1.0-smoothstep(0.0,1.0,r); a*=a;"+
  " gl_FragColor=vec4(vC.rgb,vC.a*a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}";

function fxPoints(n,additive,grav,drag,scene){
  const S={n, cur:0, alive:0, dirty:false, grav, drag, dead:true,
    p:new Float32Array(n*3), v:new Float32Array(n*3), life:new Float32Array(n), max:new Float32Array(n),
    s0:new Float32Array(n), s1:new Float32Array(n), c:new Float32Array(n*4),
    pa:new Float32Array(n*3), ca:new Float32Array(n*4), sa:new Float32Array(n)};
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.BufferAttribute(S.pa,3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aCol",new THREE.BufferAttribute(S.ca,4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aSize",new THREE.BufferAttribute(S.sa,1).setUsage(THREE.DynamicDrawUsage));
  const mat=new THREE.ShaderMaterial({uniforms:{uScale:{value:600}}, vertexShader:FX_VERT, fragmentShader:FX_FRAG,
    transparent:true, depthWrite:false, blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});
  S.mesh=new THREE.Points(geo,mat); S.mesh.frustumCulled=false; S.mesh.renderOrder=6; scene.add(S.mesh);
  S.geo=geo; S.mat=mat;
  /* one particle: position (view metres), velocity (m/s), life (s), size (m) start and end, colour rgb and alpha */
  S.emit=function(x,y,z,vx,vy,vz,life,sz0,sz1,r,g,b,a){
    const i=this.cur; this.cur=(i+1)%this.n;
    const j=i*3, k=i*4;
    this.p[j]=x; this.p[j+1]=y; this.p[j+2]=z; this.v[j]=vx; this.v[j+1]=vy; this.v[j+2]=vz;
    this.life[i]=life; this.max[i]=life; this.s0[i]=sz0; this.s1[i]=sz1;
    this.c[k]=r; this.c[k+1]=g; this.c[k+2]=b; this.c[k+3]=a;
    this.dead=false; this.dirty=true;
  };
  S.step=function(dt,floorY){
    if(this.dead&&!this.dirty) return;
    let alive=0; const n=this.n, p=this.p, v=this.v, life=this.life, drag=Math.exp(-this.drag*dt), g=this.grav*dt;
    for(let i=0;i<n;i++){
      const j=i*3, k=i*4;
      if(life[i]<=0){ if(this.sa[i]!==0){ this.sa[i]=0; this.ca[k+3]=0; } continue; }
      life[i]-=dt; alive++;
      if(life[i]<=0){ this.sa[i]=0; this.ca[k+3]=0; continue; }
      v[j]*=drag; v[j+1]=v[j+1]*drag+g; v[j+2]*=drag;
      p[j]+=v[j]*dt; p[j+1]+=v[j+1]*dt; p[j+2]+=v[j+2]*dt;
      if(p[j+1]<floorY&&this.grav<0){ p[j+1]=floorY; v[j+1]*=-0.35; v[j]*=0.6; v[j+2]*=0.6; }
      const u=1-life[i]/this.max[i];
      this.pa[j]=p[j]; this.pa[j+1]=p[j+1]; this.pa[j+2]=p[j+2];
      this.sa[i]=this.s0[i]+(this.s1[i]-this.s0[i])*u;
      this.ca[k]=this.c[k]; this.ca[k+1]=this.c[k+1]; this.ca[k+2]=this.c[k+2];
      this.ca[k+3]=this.c[k+3]*(1-u)*(1-u*0.4);
    }
    this.alive=alive; this.dead=alive===0;
    this.geo.attributes.position.needsUpdate=true; this.geo.attributes.aCol.needsUpdate=true; this.geo.attributes.aSize.needsUpdate=true;
    this.dirty=false;
  };
  S.free=function(){ this.mesh.parent&&this.mesh.parent.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); };
  return S;
}

const ShotFx={
  opts:{shake:true, on:true},
  L:null, group:null, view:null,
  // an alliance's colour: [r,g,b] in linear light, and a brighter tint for sparks
  col:{red:[1,0.22,0.12], blue:[0.16,0.42,1], pollen:[1,0.78,0.22], white:[1,0.92,0.78]},
  stat:{ms:0, n:0},
  prof:false,
  gen:0, era:0, liveT:[], flights:[], dying:[], lastT:0, dt:0.016, kickT:-1e9, kickAmp:0, kickDir:null, shakeT:-1e9, shakeAmp:0,
  lastScore:{red:-1e9, blue:-1e9}, counts:null, tips:null, settles:[], later:null,
  _v:null, _w:null, _ax:null, _o:null,

  /* ---------- the effect objects, for this view's dynamic group ---------- */
  /* Is the pool built for this group and level? Build it if not. */
  attach(view){
    const lv=fxLevel(view.tier&&view.tier.tier,view.lowGfx), same=this.group===view.dynG&&this.L&&this.L.level===lv;
    if(same) return true;
    if(!view.dynG||typeof THREE==="undefined") return false;
    this.free(); this.era++;
    this.view=view; this.group=view.dynG; this.L=FX_LEVELS[lv];
    this.read();
    const G=this.group, L=this.L;
    this._v=new THREE.Vector3(); this._ax=[0,0,0]; this._o=[0,0,0]; this._q=new THREE.Vector3(); this._st={y:0, a:1, s:1};
    this.sparks=fxPoints(L.sparks,true,-2.6,1.6,G);
    this.dust=L.dust>0?fxPoints(L.dust,false,0.12,2.2,G):null;
    this.later=new Float32Array(16*6); this.laterN=0;
    // trails: one per ball in the air, plus a few for the ones that just landed
    const TN=L.trailN, nTr=10;
    this.trMat=L.ribbon?new THREE.MeshBasicMaterial({vertexColors:true, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending})
                       :new THREE.LineBasicMaterial({vertexColors:true, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending});
    this.trPool=fxPool(nTr,()=>this.mkTrail(TN,L.ribbon));
    this.liveT=[]; this.dying=[]; this.flights=[];        // ribbons in the air, ribbons fading, balls in the air
    // rings
    this.ringGeo=new THREE.RingGeometry(0.72,1,36);
    this.rings=fxPool(L.rings,()=>{ const m=new THREE.Mesh(this.ringGeo,new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending}));
      m.visible=false; m.renderOrder=6; G.add(m); return {m, t:0, dur:0.5, r0:0.03, r1:0.2, active:false}; });
    this.ringsLive=[];
    // popups
    this.popups=fxPool(L.popups,()=>{ const s=new THREE.Sprite(new THREE.SpriteMaterial({map:null, transparent:true, depthTest:false, depthWrite:false}));
      s.visible=false; s.renderOrder=9; G.add(s); return {s, t:0, dur:1, x:0, y:0, z:0, active:false}; });
    this.popLive=[];
    this.texCache=this.texCache||{};
    this.settles.length=0;
    this.counts=this.counts||null;
    // the arc line is kept in place (no geometry per call)
    this.arcN=0;
    return true;
  },
  /* settings the page can change: ?shake=0, localStorage ftcbench.shake, and the system's reduced-motion */
  read(){
    let on=true;
    try{ if(typeof location!=="undefined"&&/[?&]shake=0\b/.test(location.search)) on=false; }catch(e){}
    try{ if(typeof localStorage!=="undefined"&&localStorage.getItem("ftcbench.shake")==="0") on=false; }catch(e){}
    try{ if(typeof matchMedia!=="undefined"&&matchMedia("(prefers-reduced-motion: reduce)").matches) on=false; }catch(e){}
    this.opts.shake=on;
  },
  setShake(on){ this.opts.shake=!!on; try{ localStorage.setItem("ftcbench.shake",on?"1":"0"); }catch(e){} },
  free(){
    if(this.sparks) this.sparks.free(); if(this.dust) this.dust.free();
    if(this.trPool) for(const t of this.trPool.items){ t.mesh.parent&&t.mesh.parent.remove(t.mesh); t.geo.dispose(); }
    if(this.trMat) this.trMat.dispose();
    if(this.rings) for(const r of this.rings.items){ r.m.parent&&r.m.parent.remove(r.m); r.m.material.dispose(); }
    if(this.ringGeo) this.ringGeo.dispose();
    if(this.popups) for(const p of this.popups.items){ p.s.parent&&p.s.parent.remove(p.s); p.s.material.dispose(); }
    if(this.arcSolid){ this.arcSolid.parent&&this.arcSolid.parent.remove(this.arcSolid); this.arcSolid.geometry.dispose(); this.arcSolid.material.dispose(); this.arcSolid=null; }
    if(this.arcDash){ this.arcDash.parent&&this.arcDash.parent.remove(this.arcDash); this.arcDash.geometry.dispose(); this.arcDash.material.dispose(); this.arcDash=null; }
    this.sparks=this.dust=this.trPool=this.rings=this.popups=null; this.liveT=[]; this.flights=[]; this.dying=[];
    this.ringsLive=[]; this.popLive=[]; this.settles.length=0; this.laterN=0;
  },
  /* one ribbon (or line) with room for n samples, hidden until a ball takes it */
  mkTrail(n,ribbon){
    const geo=new THREE.BufferGeometry(), nv=ribbon?n*2:n, cs=ribbon?4:3;
    const pos=new Float32Array(nv*3), col=new Float32Array(nv*cs);
    geo.setAttribute("position",new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color",new THREE.BufferAttribute(col,cs).setUsage(THREE.DynamicDrawUsage));
    if(ribbon){ const idx=[]; for(let i=0;i<n-1;i++) idx.push(2*i,2*i+1,2*i+2, 2*i+1,2*i+3,2*i+2); geo.setIndex(idx); }
    const mesh=ribbon?new THREE.Mesh(geo,this.trMat):new THREE.Line(geo,this.trMat);
    mesh.frustumCulled=false; mesh.visible=false; mesh.renderOrder=5; this.group.add(mesh);
    return {mesh, geo, pos, col, n, ribbon, f:null, age:0, endT:0, tint:[1,1,1], w:0.03};
  },

  /* ---------- helpers ---------- */
  alOf(color){ return color===0xff7a5c||color==="red"?"red":"blue"; },
  rgb(al){ return this.col[al]||this.col.pollen; },
  rnd(){ return Math.random(); },
  /* a view-space point from field inches, into a reused vector */
  at(p){ const v=this._v; v.set(p[0]*IN,p[2]*IN,-p[1]*IN); return v; },

  /* ---------- the five jobs the view calls ---------- */
  /* Each ball once as it leaves, once as it lands; trails follow the ones in the air. */
  flightFx(view,fl,now){
    this.dt=this.lastT?Math.min(0.1,(now-this.lastT)/1000):0.016; this.lastT=now;
    view.recentEnds=view.recentEnds||[];
    if(!this.opts.on||!this.attach(view)) return;
    const t0=this.prof?performance.now():0, gen=++this.gen, F=this.flights;
    for(let i=0;i<fl.length;i++){
      const f=fl[i]; f.fxGen=gen;
      if(f.fxSeen!==this.era){ f.fxSeen=this.era; if(f.path&&f.path[0]){ F.push(f); this.launch(view,f,now,f.t>0.05); } }
    }
    // a ball that was in the air last frame and isn't now has landed
    for(let i=F.length-1;i>=0;i--) if(F[i].fxGen!==gen){ const f=F[i]; F[i]=F[F.length-1]; F.pop(); if(f.pos) this.landed(view,f,now); }
    // the ends AI robots' balls start bouncing from (view.floorEnter) stay for 700 ms
    const E=view.recentEnds; let w=0; for(let i=0;i<E.length;i++) if(now-E[i].t<700) E[w++]=E[i]; E.length=w;
    if(this.prof) this.stat.ms+=performance.now()-t0;
  },
  /* the muzzle: a flash, sparks along the barrel, a puff, a kick, a nudge */
  /* quiet: a ball already under way when the scene was rebuilt only gets its trail back, no second muzzle flash */
  launch(view,f,now,quiet){
    const p0=f.path[0], L=this.L, v=this._v, al=f.al||"red";
    const k=Math.min(f.path.length-1,4), p1=f.path[k];
    let dx=(p1[0]-p0[0])*IN, dy=(p1[2]-p0[2])*IN, dz=-(p1[1]-p0[1])*IN; const dl=Math.hypot(dx,dy,dz)||1; dx/=dl; dy/=dl; dz/=dl;
    if(quiet){ this.trailFor(f,this.tintFor(f,al)); return; }
    this.at(p0); const x=v.x, y=v.y, z=v.z;
    const S=this.sparks, w=this.col.white, tint=this.tintFor(f,al);
    S.emit(x,y,z,dx*0.3,dy*0.3,dz*0.3,0.11,0.07,0.24,1,0.9,0.6,0.9);                       // the flash itself
    for(let i=0;i<L.flash;i++){
      const sp=1.5+this.rnd()*3.5, a=(this.rnd()-0.5)*0.55, b=(this.rnd()-0.5)*0.55;
      S.emit(x,y,z, dx*sp+a*sp*0.5, dy*sp+b*sp*0.5, dz*sp+(this.rnd()-0.5)*0.5*sp*0.5, 0.14+this.rnd()*0.16, 0.014,0.004, tint[0]*0.5+w[0]*0.5,tint[1]*0.5+w[1]*0.5,tint[2]*0.5+w[2]*0.5, 1);
    }
    if(this.dust) for(let i=0;i<Math.min(3,L.flash>>1);i++) this.dust.emit(x,y,z, dx*0.4+(this.rnd()-0.5)*0.3, 0.25+this.rnd()*0.2, dz*0.4+(this.rnd()-0.5)*0.3, 0.45, 0.03,0.12, 0.8,0.8,0.82,0.28);
    // a kick to whoever fired it; the player's own shot also nudges the follow camera
    const bx=p0[0]*IN, by=p0[1]*IN;
    for(const id in view.botG||{}){ const g=view.botG[id]; if(Math.hypot(g.position.x-bx,-g.position.z-by)<0.5) g.userData.kick=1; }
    if(!f.by){
      this.kickT=now; this.kickAmp=1; this.kickDir=this.kickDir||[0,0];
      const hl=Math.hypot(dx,dz)||1; this.kickDir[0]=dx/hl; this.kickDir[1]=dz/hl;
      if(L.shake&&this.opts.shake&&(view.mode==="chase"||view.mode==="pov")){ this.shakeT=now; this.shakeAmp=0.011; }
    }
    this.trailFor(f,tint);
  },
  /* a ribbon for this flight, if one is free */
  trailFor(f,tint){
    const T=this.trPool.acquire();
    if(T){ T.f=f; f.fxT=T; T.age=0; T.tint[0]=tint[0]; T.tint[1]=tint[1]; T.tint[2]=tint[2]; T.w=(f.kind==="nectar"?1.81:1.4)*IN*1.2; T.mesh.visible=true; this.liveT.push(T); }
  },
  /* the colour a ball's light is: its own, warmed toward its alliance's */
  tintFor(f,al){
    const a=this.rgb(f.kind==="nectar"&&f.color?f.color:al), b=f.kind==="nectar"?a:this.col.pollen, t=this.tint||(this.tint=[0,0,0]);
    t[0]=b[0]*0.45+a[0]*0.55; t[1]=b[1]*0.45+a[1]*0.55; t[2]=b[2]*0.45+a[2]*0.55;
    return t;
  },
  /* a flight ended: score or miss. Its ribbon stays a moment and fades. */
  landed(view,f,now){
    const T=f.fxT; if(T){ f.fxT=null; const i=this.liveT.indexOf(T); if(i>=0){ this.liveT[i]=this.liveT[this.liveT.length-1]; this.liveT.pop(); }
      T.endT=now; T.age=1e-6; this.dying.push(T); }
    const al=f.al||(f.color==="blue"?"blue":"red"), tipped=f.cause==="tipped";
    const scored=f.hit&&!tipped&&(typeof Field==="undefined"||Field.hive[al]===f.hive||f.hive==null);
    view.recentEnds.push({x:f.pos[0]*IN, y:f.pos[1]*IN, z:f.pos[2]*IN, t:now});
    if(scored){ this.score(view,al,f.pos,now,f.kind); return; }
    this.miss(view,f,now);
  },
  /* score: burst + ring + glow + popup */
  score(view,al,pos,now,kind){
    const L=this.L, S=this.sparks, c=this.rgb(al), w=this.col.white, v=this._v;
    this.lastScore[al]=now;
    let m=null; try{ m=Field.model().mouthCentroid[al]; }catch(e){}
    const mp=m?m:pos;
    this.at(pos); const x=v.x, y=v.y, z=v.z;
    for(let i=0;i<L.burst;i++){
      const th=this.rnd()*6.2832, ph=Math.acos(2*this.rnd()-1), sp=0.7+this.rnd()*1.9, mix=this.rnd()*0.5;
      S.emit(x,y,z, Math.sin(ph)*Math.cos(th)*sp, Math.cos(ph)*sp*0.8+0.4, Math.sin(ph)*Math.sin(th)*sp, 0.45+this.rnd()*0.5, 0.045+this.rnd()*0.03,0.008,
        c[0]*(1-mix)+w[0]*mix, c[1]*(1-mix)+w[1]*mix, c[2]*(1-mix)+w[2]*mix, 1);
    }
    this.at(mp); const mx=v.x, my=v.y, mz=v.z;
    if(L.glow) S.emit(mx,my,mz,0,0,0,0.6,0.55,0.95,c[0],c[1],c[2],0.7);              // the HIVE glows
    S.emit(mx,my,mz,0,0,0,0.18,0.12,0.3,1,1,1,0.8);                                     // and a flash at the mouth
    this.ring(mx,my,mz,c,0.04,0.3,0.5);
    this.popup("+"+fxCellPoints(),mx,my+0.1,mz,c);
  },
  /* a miss: sparks where it hit, dust on the floor when it lands */
  miss(view,f,now){
    const L=this.L, S=this.sparks, v=this._v, e=f.pos, hi=e[2]>4, c=this.col.white;
    this.at(e); const x=v.x, y=v.y, z=v.z, n=Math.max(2,L.burst>>1);
    if(hi){
      for(let i=0;i<n;i++){ const th=this.rnd()*6.2832, sp=0.5+this.rnd()*1.6;
        S.emit(x,y,z, Math.cos(th)*sp, 0.3+this.rnd()*sp*0.6, Math.sin(th)*sp, 0.25+this.rnd()*0.3, 0.02,0.004, c[0],c[1],c[2],0.9); }
      // it falls from there: dust when it reaches the tiles, a second smaller one on the bounce
      const fall=Math.sqrt(2*Math.max(0.01,y-0.036)/9.8);
      this.later_(now+fall*1000,x,0.01,z,1); this.later_(now+fall*1000+330,x,0.01,z,0.5);
    }else this.dustAt(x,Math.max(0.01,y),z,1);
  },
  /* queue a dust puff for a time (a few slots, no allocation) */
  later_(t,x,y,z,k){
    if(!this.dust||this.laterN>=16) return;
    const a=this.later, i=this.laterN++*6; a[i]=t; a[i+1]=x; a[i+2]=y; a[i+3]=z; a[i+4]=k; a[i+5]=1;
  },
  dustAt(x,y,z,k){
    const D=this.dust, S=this.sparks, n=Math.round(Math.min(7,this.L.dust/18)*k);
    if(D) for(let i=0;i<n;i++){ const th=this.rnd()*6.2832, sp=(0.15+this.rnd()*0.35)*k; D.emit(x,y+0.01,z, Math.cos(th)*sp,0.1+this.rnd()*0.15,Math.sin(th)*sp, 0.55+this.rnd()*0.25, 0.035*k,0.13*k, 0.72,0.7,0.66,0.38); }
    for(let i=0;i<Math.max(1,Math.round(3*k));i++){ const th=this.rnd()*6.2832, sp=0.4+this.rnd()*0.8; S.emit(x,y+0.01,z, Math.cos(th)*sp,0.5+this.rnd()*0.7,Math.sin(th)*sp, 0.2+this.rnd()*0.2, 0.012,0.004, 1,0.9,0.7,0.8); }
  },
  ring(x,y,z,c,r0,r1,dur){
    const R=this.rings.acquire(); if(!R) return;
    R.m.position.set(x,y,z); R.t=0; R.dur=dur; R.r0=r0; R.r1=r1; R.active=true; R.m.visible=true;
    R.m.material.color.setRGB(c[0],c[1],c[2]); R.m.material.opacity=0.9; this.ringsLive.push(R);
  },
  /* a number that floats up from a point; text is drawn once per distinct string */
  popup(text,x,y,z,c){
    const P=this.popups.acquire(); if(!P) return;
    let tex=this.texCache[text];
    if(!tex){ const cv=document.createElement("canvas"); cv.width=256; cv.height=128; const g=cv.getContext("2d");
      g.font="900 84px system-ui,Arial,sans-serif"; g.textAlign="center"; g.textBaseline="middle";
      g.lineJoin="round"; g.lineWidth=14; g.strokeStyle="rgba(8,10,14,0.92)"; g.strokeText(text,128,68);
      g.fillStyle="#ffffff"; g.fillText(text,128,68);
      tex=this.texCache[text]=srgbTex(new THREE.CanvasTexture(cv)); }
    const M=P.s.material; M.map=tex; M.needsUpdate=true;
    M.color.setRGB(Math.min(1,c[0]*0.4+0.7),Math.min(1,c[1]*0.4+0.6),Math.min(1,c[2]*0.4+0.6)); M.opacity=1;
    P.k=popupSlot(this.popLive,x,z,0.6);
    P.s.position.set(x,y,z); P.x=x; P.y=y; P.z=z; P.t=0; P.dur=1.0; P.active=true; P.s.visible=true; this.popLive.push(P);
  },

  /* ---------- per frame ---------- */
  /* ribbons, particles, rings, popups, the ball settling, the robot's kick */
  step(view,now){
    if(!this.opts.on||!this.attach(view)) return;
    const t0=this.prof?performance.now():0, dt=this.dt, cam=view.cam, L=this.L;
    // the screen size of a world-size point
    const ren=view.ren; let hpx=600; if(ren){ const s=ren.getDrawingBufferSize?ren.getDrawingBufferSize(this._q2||(this._q2=new THREE.Vector2())):null; if(s) hpx=s.y||600; }
    const sc=hpx*0.5/Math.tan((cam?cam.fov:42)*Math.PI/360);
    this.sparks.mat.uniforms.uScale.value=sc; if(this.dust) this.dust.mat.uniforms.uScale.value=sc;
    // deferred dust
    for(let i=0;i<this.laterN;){
      const a=this.later, o=i*6;
      if(now>=a[o]){ this.dustAt(a[o+1],a[o+2],a[o+3],a[o+4]); const last=--this.laterN*6; for(let q=0;q<6;q++) a[o+q]=a[last+q]; }
      else i++;
    }
    this.sparks.step(dt,0.012); if(this.dust) this.dust.step(dt,-9);
    // rings face the camera and grow
    for(let i=this.ringsLive.length-1;i>=0;i--){
      const R=this.ringsLive[i]; R.t+=dt; const k=fxClamp01(R.t/R.dur);
      const s=R.r0+(R.r1-R.r0)*fxEaseOut(k); R.m.scale.set(s,s,s); R.m.material.opacity=0.9*(1-k)*(1-k);
      if(cam) R.m.quaternion.copy(cam.quaternion);
      if(k>=1){ R.m.visible=false; R.active=false; this.rings.release(R); this.ringsLive.splice(i,1); }
    }
    // popups: constant size on screen, so they read from the driver's view and from up close
    for(let i=this.popLive.length-1;i>=0;i--){
      const P=this.popLive[i]; P.t+=dt; const st=popupState(P.t,P.dur,L.pop,this._st);
      const dist=cam?cam.position.distanceTo(P.s.position):2, h=Math.max(0.05,dist*0.085)*st.s;
      P.s.position.set(P.x,P.y+st.y+P.k*Math.max(0.05,dist*0.085)*1.1,P.z); P.s.scale.set(h*2,h,1); P.s.material.opacity=st.a;
      if(P.t>=P.dur){ P.s.visible=false; P.active=false; this.popups.release(P); this.popLive.splice(i,1); }
    }
    // a ball dropping into its CELL
    for(let i=this.settles.length-1;i>=0;i--){
      const S=this.settles[i]; S.t+=dt; const k=fxClamp01(S.t/S.dur), e=fxEaseOut(k), m=S.m;
      if(!m.parent){ this.settles.splice(i,1); continue; }
      m.position.set(S.tx+(S.fx-S.tx)*(1-e), S.ty+(S.fy-S.ty)*(1-e)+0.03*fxHop(k), S.tz+(S.fz-S.tz)*(1-e));
      if(k<1) m.rotateOnAxis(this._q.set(1,0,0),dt*8*(1-k));
      if(k>=1){ m.position.set(S.tx,S.ty,S.tz); this.settles.splice(i,1); }
    }
    this.watchTips(view,now);
    this.watchIntake(view);
    this.kick(view,now);
    if(this.prof){ this.stat.ms+=performance.now()-t0; this.stat.n++; }
  },
  /* ribbons (or lines): every ball in the air, and the ones that just landed, rewritten from their own paths */
  trails(view,fl){
    if(!this.opts.on||!this.attach(view)) return;
    const t0=this.prof?performance.now():0, now=this.lastT, F=this.liveT;
    for(let i=0;i<F.length;i++){ const T=F[i], f=T.f; this.drive(view,T,Math.min(f.t,f.dur),0,0); }
    for(let i=this.dying.length-1;i>=0;i--){
      const T=this.dying[i]; T.age=(now-T.endT)/1000;
      if(T.age>=0.25){ T.mesh.visible=false; T.f=null; this.dying[i]=this.dying[this.dying.length-1]; this.dying.pop(); this.trPool.release(T); continue; }
      this.drive(view,T,T.f.dur,0.25,T.age);
    }
    if(this.prof) this.stat.ms+=performance.now()-t0;
  },
  /* one trail: samples of the ball's path from `head` seconds back over the trail's span. A ribbon is
     as wide as the ball at its head and a point at its tail, turned to face the camera. */
  drive(view,T,head,fade,age){
    const cam=view.cam, cp=cam?cam.position:null, o=this._o, o2=this._o2||(this._o2=[0,0,0]);
    const f=T.f, n=T.n, step=f.step||SHOT_STEP_S, span=this.L.trailS*(1-0.5*(fade>0?fxClamp01(age/fade):0));
    const col=T.col, pos=T.pos, ti=T.tint, ribbon=T.ribbon;
    for(let i=0;i<n;i++){
      const u=n>1?i/(n-1):1, tt=Math.max(0,head-(1-u)*span);
      fxPathAt(f.path,step,tt,o);
      const x=o[0]*IN, y=o[2]*IN, z=-o[1]*IN, br=trailFade(i,n,age,fade);
      if(ribbon){
        fxPathAt(f.path,step,tt+0.004,o2);
        const tx=o2[0]*IN-x, ty=o2[2]*IN-y, tz=-o2[1]*IN-z;
        const vx=cp?cp.x-x:0, vy=cp?cp.y-y:1, vz=cp?cp.z-z:0;
        let sx=ty*vz-tz*vy, sy=tz*vx-tx*vz, sz=tx*vy-ty*vx; const sl=Math.hypot(sx,sy,sz)||1;
        const hw=trailWidth(i,n,T.w)*0.5/sl; sx*=hw; sy*=hw; sz*=hw;
        const j=i*6; pos[j]=x-sx; pos[j+1]=y-sy; pos[j+2]=z-sz; pos[j+3]=x+sx; pos[j+4]=y+sy; pos[j+5]=z+sz;
        const k=i*8, b=br*(i===n-1?1.9:1.25);
        col[k]=col[k+4]=Math.min(1,ti[0]*b); col[k+1]=col[k+5]=Math.min(1,ti[1]*b); col[k+2]=col[k+6]=Math.min(1,ti[2]*b);
        col[k+3]=col[k+7]=br;
      }else{
        const j=i*3; pos[j]=x; pos[j+1]=y; pos[j+2]=z;
        col[j]=ti[0]*br; col[j+1]=ti[1]*br; col[j+2]=ti[2]*br;
      }
    }
    T.geo.attributes.position.needsUpdate=true; T.geo.attributes.color.needsUpdate=true;
  },
  /* the player's robot rocks back as a ball leaves; the offset is gone at the next update(), which sets the position afresh */
  kick(view,now){
    if(!this.kickAmp) return;
    const t=(now-this.kickT)/1000, k=fxShakeAmp(this.kickAmp,t,16);
    if(k<0.01){ this.kickAmp=0; return; }
    const g=view.chassisG, d=this.kickDir; if(!g||!d) return;
    const s=0.016*k*(t<0.04?t/0.04:1);
    g.position.x-=d[0]*s; g.position.z-=d[1]*s;
  },
  /* a nudge to the follow camera: translation only, decaying, off when the player turns it off */
  shake(cam){
    if(!this.shakeAmp||!this.opts.shake) return;
    const t=(performance.now()-this.shakeT)/1000, a=fxShakeAmp(this.shakeAmp,t,13);
    if(a<0.0004){ this.shakeAmp=0; return; }
    cam.position.x+=Math.sin(t*73)*a; cam.position.y+=Math.sin(t*91+1.3)*a; cam.position.z+=Math.sin(t*59+2.1)*a;
  },
  /* a ball turning as it flies: backspin about the axis across its path, at a rate the eye can follow */
  spinBall(m,p,f){
    const lp=m.userData.lp;
    if(f&&lp){
      const dx=p.x-lp.x, dy=p.y-lp.y, dz=p.z-lp.z, ax=fxSpinAxis(dx,dz,this._ax||(this._ax=[0,0,0]));
      if(ax){ const sp=Math.hypot(dx,dy,dz)/Math.max(0.004,this.dt||0.016); const q=this._q||(this._q=new THREE.Vector3());
        m.rotateOnWorldAxis(q.set(ax[0],ax[1],ax[2]),fxSpinRate(sp)*(this.dt||0.016)); }
    }
  },
  /* a CELL that was just rebuilt with one ball more: that ball drops in from the mouth and settles */
  /* Called with the CELL's ball count each time it is drawn: did it grow by exactly one since last time? */
  cellsGrew(al,n){
    const C=this.counts||(this.counts={red:null, blue:null}), was=C[al]; C[al]=n;
    return this.opts.on&&!!this.L&&was!=null&&n===was+1;
  },
  /* that newest ball b (already at its place, in the HIVE's own frame) starts at the mouth and settles there */
  settle(b,al){
    let m=null; try{ m=Field.model().mouthCentroid[al]; }catch(e){}
    if(!m||this.settles.length>=6) return;
    const S={m:b, t:0, dur:0.5, tx:b.position.x, ty:b.position.y, tz:b.position.z, fx:m[0]*IN, fy:m[2]*IN, fz:-m[1]*IN};
    b.position.set(S.fx,S.fy,S.fz); this.settles.push(S);
  },
  /* a HIVE that tipped: its own popup */
  watchTips(view,now){
    if(typeof Field==="undefined"||!Field.tips) return;
    const T=this.tips; if(!T){ this.tips={red:Field.tips.red, blue:Field.tips.blue}; return; }
    if(Field.tips.red>T.red) this.tipped("red");
    if(Field.tips.blue>T.blue) this.tipped("blue");
    T.red=Field.tips.red; T.blue=Field.tips.blue;
  },
  tipped(al){
    let m=null; try{ m=Field.model().mouthCentroid[al]; }catch(e){}
    if(!m||!this.L) return;
    const v=this.at(m), c=this.rgb(al);
    this.popup("TIP +"+fxTipPoints(),v.x,v.y+0.32,v.z,c); this.ring(v.x,v.y,v.z,c,0.06,0.55,0.7);
    this.sparks.emit(v.x,v.y,v.z,0,0,0,0.8,0.8,1.2,c[0],c[1],c[2],0.6);
  },
  /* an element the AI robot's intake just took: a few sparks swirl in toward the roller */
  watchIntake(view){
    const P=view.picked; if(!P||!P.length||!this.L) return;
    for(const p of P){
      if(p.fx) continue; p.fx=true;
      const b=p.b, MB=typeof MATCH_BOT!=="undefined"?MATCH_BOT:{hx:0.2};
      const x=b.x+Math.cos(b.h)*MB.hx, y=b.y+Math.sin(b.h)*MB.hx, c=this.col.pollen, S=this.sparks, n=Math.min(8,this.L.burst>>1);
      for(let i=0;i<n;i++){
        const th=i/n*6.2832, r=0.09, tx=-Math.sin(th), tz=Math.cos(th);
        S.emit(x+Math.cos(th)*r, 0.07, -y+Math.sin(th)*r, tx*0.5-Math.cos(th)*0.5, 0.05, tz*0.5-Math.sin(th)*0.5, 0.22, 0.016,0.003, c[0],c[1],c[2],0.9);
      }
    }
  },

  /* ---------- the predicted arc, kept in place ---------- */
  arc(view,path,color,dashed){
    if(!this.attach(view)){ return; }
    const hide=()=>{ if(this.arcSolid) this.arcSolid.visible=false; if(this.arcDash) this.arcDash.visible=false; };
    if(!path||path.length<2){ hide(); return; }
    const cap=Math.max(path.length,512);
    const mk=(dash)=>{ const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(cap*3),3).setUsage(THREE.DynamicDrawUsage));
      const mt=dash?new THREE.LineDashedMaterial({color,dashSize:0.06,gapSize:0.045,transparent:true,opacity:0.85,depthWrite:false})
                   :new THREE.LineBasicMaterial({color,transparent:true,opacity:0.95,depthWrite:false});
      const l=new THREE.Line(g,mt); l.frustumCulled=false; l.renderOrder=4; this.group.add(l); return l; };
    const key=dashed?"arcDash":"arcSolid";
    let line=this[key];
    if(line&&line.geometry.attributes.position.count<path.length){ line.parent&&line.parent.remove(line); line.geometry.dispose(); line.material.dispose(); line=this[key]=null; }
    if(!line) line=this[key]=mk(dashed);
    hide();
    const pa=line.geometry.attributes.position.array;
    for(let i=0;i<path.length;i++){ const p=path[i]; pa[i*3]=p[0]*IN; pa[i*3+1]=p[2]*IN; pa[i*3+2]=-p[1]*IN; }
    line.geometry.attributes.position.needsUpdate=true; line.geometry.setDrawRange(0,path.length);
    line.material.color.set(color); line.visible=true;
    if(dashed) line.computeLineDistances();
    this.arcN=path.length;
  },

  /* the older call: kind "flash" (a ball went into an up-CELL) and "puff" */
  fx(view,kind,pos,color){
    if(!this.attach(view)) return;
    const al=this.alOf(color), now=performance.now();
    if(kind==="flash"){
      if(now-this.lastScore[al]<600) return;                  // the flight that scored it already did all this
      this.lastScore[al]=now;
      const c=this.rgb(al);
      this.sparks.emit(pos.x,pos.y,pos.z,0,0,0,0.5,0.3,0.7,c[0],c[1],c[2],0.5);
      this.ring(pos.x,pos.y,pos.z,c,0.04,0.3,0.5);
      for(let i=0;i<(this.L.burst>>1);i++){ const th=this.rnd()*6.2832, sp=0.6+this.rnd()*1.5;
        this.sparks.emit(pos.x,pos.y,pos.z,Math.cos(th)*sp,0.4+this.rnd()*sp,Math.sin(th)*sp,0.4+this.rnd()*0.4,0.03,0.006,c[0],c[1],c[2],1); }
      this.popup("+"+fxCellPoints(),pos.x,pos.y+0.1,pos.z,c);
    }else this.sparks.emit(pos.x,pos.y,pos.z,0,0.2,0,0.3,0.05,0.12,1,1,1,0.5);
  }
};
