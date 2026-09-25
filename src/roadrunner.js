/* ============================================================
   ROAD RUNNER — actions, trajectories and the follower (RR 1.0)
   Most FTC autos since 2024 are Road Runner 1.0: a TrajectoryActionBuilder
   chain (lineToY, splineToConstantHeading, strafeToLinearHeading,
   waitSeconds, stopAndAdd, afterTime …) run with Actions.runBlocking,
   next to the team's own Action classes (a claw, an arm PID) that live in
   other files. This reads all of it:
     - the team's helper classes: the hardware their constructor wires, each
       inner class that implements Action (its run() body and whether it
       keeps running), the methods that hand them out, and static helpers
       that return a number (an arm PID's power)
     - MecanumDrive.java: the drive motors, their directions, and PARAMS
       (profile limits and the follower's gains)
     - the OpMode: its start pose, its builder chains, and the action tree
       it runs
   Paths are built the way RR builds them (quintic splines, tangent or
   constant or linear heading, setTangent in radians as RR reads it) and
   time-profiled against PARAMS' wheel, acceleration and turn limits. The
   follower is RR's: target pose from the profile, the team's axial,
   lateral and heading gains on the pose error, then the drive motors. Only
   the feedforward is the bench's own — kS/kV/kA are tuned to one robot's
   encoders and battery, so the bench turns wheel speed into power from the
   CAD's motors and wheels. The localizer is perfect: the sim's true pose.
   ============================================================ */
const {rrDetect, rrParseHelpers, rrAttach, rrBuildPlan, rrSample, RRRuntime}=(function(){
  const TAU=2*Math.PI, IN_M=0.0254;
  const wrap=a=>{ a=(a+Math.PI)%TAU; if(a<0) a+=TAU; return a-Math.PI; };
  const DEFAULT_PARAMS={maxWheelVel:50, minProfileAccel:-30, maxProfileAccel:50, maxAngVel:Math.PI, maxAngAccel:Math.PI,
    axialGain:5, lateralGain:5, headingGain:5, axialVelGain:0, lateralVelGain:0, headingVelGain:0,
    inPerTick:1, lateralInPerTick:1, trackWidthTicks:0};

  function rrDetect(src){ return /\bactionBuilder\s*\(/.test(src)&&/\bActions\s*\.\s*runBlocking\s*\(/.test(src); }

  // ---- small scanners over comment-stripped source ----
  const block=(src,open)=>{ const r=matchBlock(src,open); return {body:src.slice(r[0],r[1]), at:r[0], end:r[1]}; };
  function parenAt(src,i){                      // src[i]==="(": [inside, index after ")"]
    let d=0,j=i,ins=false;
    for(;j<src.length;j++){ const c=src[j];
      if(ins){ if(c==='"'&&src[j-1]!=="\\") ins=false; continue; }
      if(c==='"') ins=true; else if(c==="(") d++; else if(c===")"){ d--; if(!d) break; } }
    return [src.slice(i+1,j), j+1];
  }
  const params=s=>String(s||"").split(",").map(p=>p.trim()).filter(Boolean).map(p=>p.split(/\s+/).pop());
  /* the last `return X;` of a body, and the body without its returns */
  function splitReturn(body){
    const re=/\breturn\b([^;]*);/g; let m, last=null;
    while((m=re.exec(body))) last=m[1].trim();
    return {ret:last, rest:body.replace(/\breturn\b[^;]*;/g,"")};
  }

  /* ---- the team's helper classes ---- */
  function rrParseHelpers(files){
    const H={classes:{}, statics:{}, drive:null, notes:[], ftclib:false};
    for(const f of files||[]){
      const src=stripComments(f.src||""), P=parseJava(f.src||"");
      const top=/\bclass\s+([A-Za-z_$][\w$]*)[^{]*\{/.exec(src); if(!top) continue;
      const name=top[1];
      const C={name, file:f.file, devices:P.devices.filter(d=>d.cfg), vars:P.vars, consts:P.consts, ctor:[], actions:{}, factories:{}};
      // a constant written with brackets, `(1425.1/360.0) / 2`, that the field scan skips
      const reK=/\bfinal\s+(?:double|float|int|long)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;{}]+);/g; let k;
      while((k=reK.exec(src))) if(C.consts[k[1]]===undefined){ const a=parseExpr(k[2]);
        const v=a?evalNode(a,{get:n=>C.consts[n]!==undefined?C.consts[n]:(C.vars[n]||0), pad:()=>0, device:()=>0, pid:()=>0}):NaN;
        if(Number.isFinite(v)) C.consts[k[1]]=v; }
      if(/\bcom\.arcrobotics\.ftclib\./.test(src)) H.ftclib=true;
      // the constructor that takes the hardware map
      const cm=new RegExp("\\b"+name+"\\s*\\(\\s*HardwareMap\\s+\\w+[^)]*\\)\\s*\\{").exec(src);
      if(cm) C.ctor=parseStatements(block(src,cm.index+cm[0].length-1).body);
      // inner Action classes
      const reA=/\bclass\s+([A-Za-z_$][\w$]*)\s+implements\s+Action\s*\{/g; let m;
      while((m=reA.exec(src))){
        const B=block(src,m.index+m[0].length-1).body, an=m[1], A={name:an, params:[], init:[], run:[], cont:false};
        const km=new RegExp("\\b"+an+"\\s*\\(([^)]*)\\)\\s*\\{").exec(B);
        if(km){ A.params=params(km[1]); A.init=parseStatements(block(B,km.index+km[0].length-1).body); }
        const rm=/\bboolean\s+run\s*\([^)]*\)\s*\{/.exec(B);
        if(rm){
          const s=splitReturn(block(B,rm.index+rm[0].length-1).body);
          A.cont=s.ret==="true";
          if(s.ret&&s.ret!=="true"&&s.ret!=="false") H.notes.push(name+"."+an+".run() returns "+s.ret+"; the bench reads it as done after one pass.");
          A.run=parseStatements(s.rest);
        }
        C.actions[an]=A;
      }
      // the methods that hand them out: public Action x(int p){ return new Arm.x2(p); }
      const reF=/\bAction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{\s*return\s+new\s+(?:[\w$]+\.)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*;\s*\}/g;
      while((m=reF.exec(src))) C.factories[m[1]]={params:params(m[2]), cls:m[3], args:splitArgsTop(m[4]).map(a=>parseExpr(a))};
      // static helpers that return a number
      const reS=/\bstatic\s+(?:double|float|int|long)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
      while((m=reS.exec(src))){
        const s=splitReturn(block(src,m.index+m[0].length-1).body);
        H.statics[name+"."+m[1]]={cls:name, params:params(m[2]), stmts:parseStatements(s.rest), ret:s.ret?parseExpr(s.ret):null};
      }
      if(name==="MecanumDrive"){
        const prm=Object.assign({},DEFAULT_PARAMS);
        for(const k in prm) if(Number.isFinite(P.vars[k])) prm[k]=P.vars[k]; else if(Number.isFinite(P.consts[k])) prm[k]=P.consts[k];
        H.drive={params:prm, devices:C.devices, ctor:C.ctor, file:f.file};
      }
      H.classes[name]=C;
    }
    return H;
  }

  /* ---- the path: segments, then samples, then a time profile ---- */
  // quintic Hermite with RR's end derivatives: first = tangent * distance, second = 0
  function quintic(p0,t0,p1,t1){
    const d=Math.hypot(p1[0]-p0[0],p1[1]-p0[1]);
    const v0=[Math.cos(t0)*d,Math.sin(t0)*d], v1=[Math.cos(t1)*d,Math.sin(t1)*d];
    return u=>{ const u2=u*u,u3=u2*u,u4=u3*u,u5=u4*u;
      const h0=1-10*u3+15*u4-6*u5, h1=u-6*u3+8*u4-3*u5, h5=10*u3-15*u4+6*u5, h4=-4*u3+7*u4-3*u5;
      return [h0*p0[0]+h1*v0[0]+h4*v1[0]+h5*p1[0], h0*p0[1]+h1*v0[1]+h4*v1[1]+h5*p1[1]]; };
  }
  const STEP_IN=0.5;
  /* A run of path segments -> samples {x,y,h,s} and the per-sample speed limit. */
  function sampleRun(segs){
    const pts=[];
    for(const g of segs){
      const n=Math.max(2,Math.ceil(g.len/STEP_IN)+1);
      for(let k=pts.length?1:0;k<n;k++){
        const u=k/(n-1), p=g.at(u);
        pts.push({x:p[0], y:p[1], h:g.head(u, p), vmax:g.vmax});
      }
    }
    let s=0; for(let i=0;i<pts.length;i++){ if(i) s+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y); pts[i].s=s; }
    return pts;
  }
  /* Time along the samples: fastest the limits allow, at rest at both ends. */
  function profile(pts,P){
    const n=pts.length, v=new Array(n).fill(0);
    const lat=Math.abs(P.inPerTick/(P.lateralInPerTick||P.inPerTick))||1;
    const tw=Math.abs(P.inPerTick*P.trackWidthTicks)||14;
    for(let i=0;i<n;i++){
      const a=pts[Math.max(0,i-1)], b=pts[Math.min(n-1,i+1)], ds=(b.s-a.s)||1e-9;
      const tan=Math.atan2(b.y-a.y,b.x-a.x), dh=Math.abs(wrap(b.h-a.h))/ds, rel=tan-pts[i].h;
      let lim=P.maxWheelVel/(Math.abs(Math.cos(rel))+lat*Math.abs(Math.sin(rel))+tw/2*dh);
      if(dh>1e-9) lim=Math.min(lim,P.maxAngVel/dh);
      if(pts[i].vmax>0) lim=Math.min(lim,pts[i].vmax);
      v[i]=lim;
    }
    v[0]=0; v[n-1]=0;
    for(let i=1;i<n;i++){ const ds=pts[i].s-pts[i-1].s; v[i]=Math.min(v[i],Math.sqrt(v[i-1]*v[i-1]+2*P.maxProfileAccel*ds)); }
    for(let i=n-2;i>=0;i--){ const ds=pts[i+1].s-pts[i].s; v[i]=Math.min(v[i],Math.sqrt(v[i+1]*v[i+1]+2*Math.abs(P.minProfileAccel)*ds)); }
    let t=0; pts[0].t=0; pts[0].v=0;
    for(let i=1;i<n;i++){ const ds=pts[i].s-pts[i-1].s, vm=(v[i]+v[i-1])/2; t+=vm>1e-6?ds/vm:(ds>1e-9?Math.sqrt(2*ds/Math.max(1e-3,P.maxProfileAccel)):0); pts[i].t=t; pts[i].v=v[i]; }
    return {pts, dur:t};
  }
  /* Where the profile says the robot is at time t, and how fast it's going. */
  function rrSample(tr,t){
    const p=tr.pts, n=p.length;
    if(t<=0||n<2) return {x:p[0].x,y:p[0].y,h:p[0].h,vx:0,vy:0,w:0};
    if(t>=tr.dur) return {x:p[n-1].x,y:p[n-1].y,h:p[n-1].h,vx:0,vy:0,w:0};
    let lo=0, hi=n-1; while(hi-lo>1){ const m=(lo+hi)>>1; if(p[m].t<=t) lo=m; else hi=m; }
    const a=p[lo], b=p[hi], k=(t-a.t)/((b.t-a.t)||1e-9), ds=(b.s-a.s)||1e-9, v=a.v+(b.v-a.v)*k;
    return {x:a.x+(b.x-a.x)*k, y:a.y+(b.y-a.y)*k, h:a.h+wrap(b.h-a.h)*k,
      vx:(b.x-a.x)/ds*v, vy:(b.y-a.y)/ds*v, w:wrap(b.h-a.h)/ds*v};
  }
  function turnProfile(h0,dh,P){
    const w=Math.abs(P.maxAngVel)||Math.PI, al=Math.abs(P.maxAngAccel)||Math.PI, d=Math.abs(dh), sg=Math.sign(dh)||1;
    const ta=w/al, da=w*ta/2;
    const dur=d<2*da?2*Math.sqrt(d/al):2*ta+(d-2*da)/w;
    const at=t=>{ t=Math.max(0,Math.min(dur,t));
      if(d<2*da){ const tm=dur/2; return t<tm?al*t*t/2:d-al*(dur-t)*(dur-t)/2; }
      if(t<ta) return al*t*t/2; if(t>dur-ta) return d-al*(dur-t)*(dur-t)/2; return da+w*(t-ta); };
    const rate=t=>{ if(t<=0||t>=dur) return 0; if(d<2*da) return al*Math.min(t,dur-t); return Math.min(w,al*t,al*(dur-t)); };
    return {turn:true, h0, sg, dur, at, rate};
  }

  /* ---- a builder chain -> a plan: stages and markers ---- */
  function rrBuildPlan(start,calls,P,act,notes){
    const stages=[], markers=[];
    let x=start[0], y=start[1], h=start[2], tan=start[2], run=[], lastTimed=-1;
    const flush=()=>{ if(!run.length) return; const tr=profile(sampleRun(run),P); stages.push({kind:"traj", tr}); lastTimed=stages.length-1; run=[]; };
    const vmaxOf=args=>{ for(const a of args) if(a&&a.maxVel>0) return a.maxVel; return 0; };
    const line=(x1,y1,head,args)=>{
      const x0=x, y0=y, h0=h, len=Math.hypot(x1-x0,y1-y0), dir=Math.atan2(y1-y0,x1-x0);
      if(len<1e-6) return;
      const hd=head==="tangent"?()=>dir+(tan!==undefined&&Math.abs(wrap(tan-dir))>Math.PI/2?Math.PI:0)
        :head==="constant"?()=>h0:(u=>h0+wrap(head-h0)*u);
      run.push({len, at:u=>[x0+(x1-x0)*u, y0+(y1-y0)*u], head:(u)=>hd(u), vmax:vmaxOf(args)});
      x=x1; y=y1; h=hd(1); tan=dir;
    };
    const spline=(x1,y1,endTan,head,args)=>{
      const x0=x, y0=y, h0=h, f=quintic([x0,y0],tan,[x1,y1],endTan);
      let len=0, prev=[x0,y0]; for(let k=1;k<=40;k++){ const p=f(k/40); len+=Math.hypot(p[0]-prev[0],p[1]-prev[1]); prev=p; }
      if(len<1e-6) return;
      const rev=h0!==undefined&&Math.abs(wrap(tan-h0))>Math.PI/2;
      const hd=head==="tangent"?(u=>{ const a=f(Math.max(0,u-1e-3)), b=f(Math.min(1,u+1e-3)); return Math.atan2(b[1]-a[1],b[0]-a[0])+(rev?Math.PI:0); })
        :head==="constant"?()=>h0:(u=>h0+wrap(head-h0)*u);
      run.push({len, at:f, head:hd, vmax:vmaxOf(args)});
      x=x1; y=y1; h=hd(1); tan=endTan;
    };
    for(const c of calls){
      const a=c.args, m=c.m;
      const vec=a[0]&&a[0].vec, pose=a[0]&&a[0].pose;
      switch(m){
        case "setTangent": tan=a[0]; break;
        case "setReversed": if(a[0]) tan=wrap(h+Math.PI); else tan=h; break;
        case "lineToX": case "lineToXConstantHeading": case "lineToXLinearHeading": case "lineToXSplineHeading": {
          const c0=Math.cos(tan); if(Math.abs(c0)<1e-6){ notes.push(m+" along a tangent with no x in it goes nowhere; skipped."); break; }
          const d=(a[0]-x)/c0; line(x+d*c0, y+d*Math.sin(tan), m==="lineToX"?"tangent":m==="lineToXConstantHeading"?"constant":a[1], a); break; }
        case "lineToY": case "lineToYConstantHeading": case "lineToYLinearHeading": case "lineToYSplineHeading": {
          const s0=Math.sin(tan); if(Math.abs(s0)<1e-6){ notes.push(m+" along a tangent with no y in it goes nowhere; skipped."); break; }
          const d=(a[0]-y)/s0; line(x+d*Math.cos(tan), y+d*s0, m==="lineToY"?"tangent":m==="lineToYConstantHeading"?"constant":a[1], a); break; }
        case "strafeTo": case "strafeToConstantHeading": if(vec) line(vec[0],vec[1],"constant",a); break;
        case "strafeToLinearHeading": case "strafeToSplineHeading": if(vec) line(vec[0],vec[1],a[1],a); break;
        case "splineTo": if(vec) spline(vec[0],vec[1],a[1],"tangent",a); break;
        case "splineToConstantHeading": if(vec) spline(vec[0],vec[1],a[1],"constant",a); break;
        case "splineToLinearHeading": case "splineToSplineHeading": if(pose) spline(pose[0],pose[1],a[1],pose[2],a); break;
        case "turn": case "turnTo": { flush(); const dh=m==="turn"?a[0]:wrap(a[0]-h); stages.push({kind:"turn", x, y, tr:turnProfile(h,dh,P)}); lastTimed=stages.length-1; h=h+dh; tan=h; break; }
        case "waitSeconds": flush(); stages.push({kind:"wait", dur:Math.max(0,a[0]||0)}); lastTimed=stages.length-1; break;
        case "stopAndAdd": flush(); stages.push({kind:"act", action:act(c.raw[0])}); break;
        case "afterTime": case "afterDisp": {
          flush();
          if(m==="afterDisp") notes.push("afterDisp is run as afterTime at 1 s per 50 in.");
          markers.push({anchor:lastTimed, dt:m==="afterDisp"?(a[0]||0)/50:(a[0]||0), action:act(c.raw[1])});
          break; }
        case "build": break;
        default: notes.push("."+m+"() on a trajectory builder isn't simulated; skipped.");
      }
    }
    flush();
    return {stages, markers, end:[x,y,h]};
  }

  /* ---- the OpMode: poses, the drive, helper objects, builders, the run ---- */
  function rrAttach(out,raw,libs){
    const src=stripComments(raw), notes=[], H=rrParseHelpers(libs);
    notes.push.apply(notes,H.notes);
    const P=H.drive?H.drive.params:Object.assign({},DEFAULT_PARAMS);
    if(!H.drive) notes.push("MecanumDrive.java isn't loaded, so the drive's limits and gains are Road Runner's defaults. Add it as a helper file for the team's own.");
    // numbers in the OpMode: its fields, MecanumDrive.PARAMS.*, Math.*
    const numEnv={get:k=>{ const q=/^(?:MecanumDrive\.)?PARAMS\.(\w+)$/.exec(k); if(q) return P[q[1]]||0;
        return out.consts[k]!==undefined?out.consts[k]:(out.vars[k]||0); }, pad:()=>0, device:()=>0, pid:()=>0};
    const num=s=>{ const a=parseExpr(String(s)); return a?evalNode(a,numEnv):0; };
    const vars={};
    const val=s=>{
      s=String(s).trim(); let m;
      if((m=/^new\s+(Vector2d|Pose2d)\s*\(([\s\S]*)\)$/.exec(s))){ const a=splitArgsTop(m[2]).map(num);
        return m[1]==="Vector2d"?{vec:[a[0],a[1]]}:{pose:[a[0],a[1],a[2]||0], vec:[a[0],a[1]]}; }
      if((m=/^new\s+TranslationalVelConstraint\s*\(([\s\S]*)\)$/.exec(s))) return {maxVel:num(m[1])};
      if(/^new\s+\w+Constraint\s*\(/.test(s)) return {};
      if((m=/^([A-Za-z_$][\w$]*)$/.exec(s))&&vars[m[1]]) return vars[m[1]];
      if((m=/^([A-Za-z_$][\w$]*)\s*\.\s*(position|heading)$/.exec(s))&&vars[m[1]]) return m[2]==="position"?{vec:vars[m[1]].vec}:vars[m[1]].pose[2];
      if(/^(true|false)$/.test(s)) return s==="true";
      return num(s);
    };
    let m;
    const reV=/\b(Pose2d|Vector2d)\s+([A-Za-z_$][\w$]*)\s*=\s*(new\s+\w+\s*\([^;]*\))\s*;/g;
    while((m=reV.exec(src))) vars[m[2]]=val(m[3]);
    // the drive, and where it starts
    let drive=null, start=[0,0,0];
    const reD=/\bMecanumDrive\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+MecanumDrive\s*\(\s*hardwareMap\s*,\s*([^;]*)\)\s*;/.exec(src);
    if(reD){ drive=reD[1]; const p=val(reD[2]); if(p&&p.pose) start=p.pose; }
    else notes.push("No MecanumDrive is made in this OpMode; the robot starts where it's placed.");
    // helper objects: Arm arm = new Arm(hardwareMap);
    const inst={};
    const reI=/\b([A-Z][\w$]*)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+\1\s*\(\s*hardwareMap\s*\)\s*;/g;
    while((m=reI.exec(src))){
      if(H.classes[m[1]]) inst[m[2]]=H.classes[m[1]];
      else notes.push(m[1]+" isn't loaded, so "+m[2]+"'s actions can't run. Add "+m[1]+".java as a helper file.");
    }

    // ---- devices: one per configuration name, whoever declares it ----
    const devs=[], byCfg={}, alias={};
    const key=c=>String(c||"").trim();
    const add=(name,type,cfg,from)=>{
      const k=key(cfg);
      if(byCfg[k]){ alias[from+name]=byCfg[k].name; return; }
      let n=name; while(devs.some(d=>d.name===n)) n=n+"_";
      const d={name:n, type:type||"DcMotorEx", cfg:k, intent:"", declaredRole:null}; devs.push(d); byCfg[k]=d; alias[from+name]=n;
      if(k!==cfg) notes.push(from.replace(/[.:]$/,"")+" looks up \""+cfg+"\", with a space; on the robot that only works if the configuration name has it too. The bench reads it as \""+k+"\".");
    };
    for(const n in inst) for(const d of inst[n].devices) add(d.name,d.type,d.cfg,n+".");
    if(H.drive&&drive) for(const d of H.drive.devices) add(d.name,d.type||"DcMotorEx",d.cfg,"MecanumDrive.");
    for(const d of out.devices){ if(d.cfg) add(d.name,d.type,d.cfg,""); else if(!/IMU/.test(d.type||"")) devs.push(d); }
    const imu=out.devices.find(d=>/IMU/.test(d.type||"")); if(imu&&!devs.includes(imu)) devs.push(imu);
    const ren=(list,from)=>(list||[]).map(st=>rename(st,from));
    function rename(st,from){
      const r=Object.assign({},st), A=n=>alias[from+n]||alias[n]||n;
      if(r.dev) r.dev=A(r.dev);
      if(r.obj&&r.kind==="objcall") r.obj=A(r.obj);
      if(r.ast) r.ast=renAst(r.ast,A);
      if(r.args) r.args=r.args.map(a=>renAst(a,A));
      if(r.then) r.then=r.then.map(s=>rename(s,from)); if(r.else) r.else=r.else.map(s=>rename(s,from));
      if(r.condAst) r.condAst=renAst(r.condAst,A);
      if(r.body) r.body=r.body.map(s=>rename(s,from));
      return r;
    }
    function renAst(n,A){
      if(!n||typeof n!=="object") return n;
      const o=Object.assign({},n);
      if(o.o==="call"){ const q=/^([A-Za-z_$][\w$]*)\.(\w+)$/.exec(o.name); if(q&&A(q[1])!==q[1]) o.name=A(q[1])+"."+q[2]; o.args=(o.args||[]).map(a=>renAst(a,A)); }
      for(const k of ["a","b","c"]) if(o[k]) o[k]=renAst(o[k],A);
      return o;
    }
    // what each helper's constructor does to its hardware runs at INIT
    const inits=[], hw=st=>st.kind==="call"||(st.kind==="objcall"&&devs.some(d=>d.name===st.obj));
    for(const n in inst) inits.push.apply(inits,ren(inst[n].ctor,n+".").filter(hw));
    if(H.drive&&drive) inits.push.apply(inits,ren(H.drive.ctor,"MecanumDrive.").filter(hw));
    inits.push.apply(inits,ren(out.inits,""));

    // ---- actions ----
    const builders={};
    const act=s=>{
      s=String(s||"").trim(); let q;
      if((q=/^new\s+(Parallel|Sequential)Action\s*\(([\s\S]*)\)$/.exec(s)))
        return {kind:q[1]==="Parallel"?"par":"seq", kids:splitArgsTop(q[2]).map(act)};
      if((q=/^new\s+SleepAction\s*\(([\s\S]*)\)$/.exec(s))) return {kind:"sleep", dur:num(q[1])};
      if((q=/^new\s+InstantAction\s*\(\s*\(\s*\)\s*->\s*([\s\S]*)\)$/.exec(s))){
        const body=q[1].trim().replace(/^\{([\s\S]*)\}$/,"$1");
        return {kind:"instant", stmts:ren(parseStatements(body.replace(/;?\s*$/,";")),"")};
      }
      if((q=/^([A-Za-z_$][\w$]*)\s*\.\s*build\s*\(\s*\)$/.exec(s))&&builders[q[1]]) return {kind:"traj", plan:builders[q[1]]()};
      if(drive&&(q=new RegExp("^"+drive+"\\s*\\.\\s*actionBuilder\\s*\\(").exec(s))) return {kind:"traj", plan:chain(s.slice(q[0].length-1))()};
      if((q=/^([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/.exec(s))&&inst[q[1]]){
        const C=inst[q[1]], F=C.factories[q[2]], A=F&&C.actions[F.cls];
        if(!A){ notes.push(q[1]+"."+q[2]+"() isn't an action "+C.name+" hands out; skipped."); return {kind:"none"}; }
        const argv=splitArgsTop(q[3]).map(num), scope={};
        F.params.forEach((p,i)=>{ scope[p]=argv[i]; });
        const ctorArgs=F.args.map(a=>evalNode(a,{get:k=>scope[k]!==undefined?scope[k]:numEnv.get(k), pad:()=>0, device:()=>0, pid:()=>0}));
        return {kind:"user", cls:C, from:q[1]+".", A, run:ren(A.run,q[1]+"."), init:A.init, ctorArgs, label:q[1]+"."+q[2]+"("+q[3].trim()+")"};
      }
      notes.push("The action "+s.slice(0,60)+" isn't simulated; skipped.");
      return {kind:"none"};
    };
    // drive.actionBuilder(POSE).a(..).b(..)… -> a function that builds the plan
    function chain(s){
      const [poseArg,after]=parenAt(s,0), p0=val(poseArg), from=(p0&&p0.pose)||start;
      const calls=[]; let i=after;
      for(;;){
        while(i<s.length&&/\s/.test(s[i])) i++;
        if(s[i]!==".") break;
        const q=/^\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(s.slice(i)); if(!q) break;
        const [inside,next]=parenAt(s,i+q[0].length-1);
        const raw=splitArgsTop(inside), m2=q[1];
        const args=/^(stopAndAdd)$/.test(m2)?[]:m2==="afterTime"||m2==="afterDisp"?[num(raw[0])]:raw.map(val);
        calls.push({m:m2, raw:m2==="afterTime"||m2==="afterDisp"?[raw[0],raw[1]]:raw, args});
        i=next;
      }
      return ()=>rrBuildPlan(from,calls,P,act,notes);
    }
    const reB=/\bTrajectoryActionBuilder\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*actionBuilder\s*\(/g;
    while((m=reB.exec(src))){
      const name=m[1], at=m.index+m[0].length-1;
      if(m[2]!==drive) continue;
      const endStmt=(()=>{ let d=0,j=at; for(;j<src.length;j++){ const c=src[j]; if(c==="(") d++; else if(c===")") d--; else if(c===";"&&d<=0) break; } return j; })();
      const f=chain(src.slice(at,endStmt)); let plan=null;
      builders[name]=()=>plan||(plan=f());
    }
    // what runs: each Actions.runBlocking(…) after START, one after another
    const runs=[], wf=src.search(/waitForStart\s*\(\s*\)\s*;/);
    const reR=/\bActions\s*\.\s*runBlocking\s*\(/g;
    while((m=reR.exec(src))){ if(wf>=0&&m.index<wf) continue; runs.push(act(parenAt(src,m.index+m[0].length-1)[0])); }
    // what it all adds up to, and which devices it ever commands
    const driveDevs=H.drive?H.drive.devices.map(d=>alias["MecanumDrive."+d.name]||d.name):[];
    const commanded=new Set(), summary={trajectories:0, actions:0, seconds:0};
    const calls=list=>{ for(const st of list||[]){ if(st.kind==="call") commanded.add(st.dev); if(st.then) calls(st.then); if(st.else) calls(st.else); } };
    const walk=a=>{ if(!a) return;
      if(a.kind==="par"||a.kind==="seq") a.kids.forEach(walk);
      else if(a.kind==="traj"){
        for(const st of a.plan.stages){ if(st.tr){ summary.trajectories++; summary.seconds+=st.tr.dur; } else if(st.kind==="wait") summary.seconds+=st.dur; else if(st.kind==="act") walk(st.action); }
        for(const k of a.plan.markers) walk(k.action);
        for(const d of driveDevs) commanded.add(d);
      }
      else if(a.kind==="user"||a.kind==="instant"){ summary.actions++; calls(a.run||a.stmts); }
      else if(a.kind==="sleep") summary.seconds+=a.dur;
    };
    runs.forEach(walk);
    out.rr={start, summary, commanded:[...commanded], drive:H.drive?{params:P, devs:H.drive.devices.map(d=>alias["MecanumDrive."+d.name]||d.name)}:{params:P, devs:[]},
      root:{kind:"seq", kids:runs}, statics:H.statics, classes:H.classes, notes};
    if(H.ftclib) out.ftclib=true;
    out.devices=devs; out.inits=inits; out.auto=[];
    out.parseNotes=(out.parseNotes||[]).concat(notes);
    return out.rr;
  }

  /* ---- running it ---- */
  function RRRuntime(sim,rr){
    const R={sim, rr, root:null, done:false, flip:0, mirrored:false};
    const devOf=n=>sim.dev[n];
    // the drive: which way "all motors forward" moves this robot, from the CAD
    R.setup=function(){
      const rig=sim.rig; R.flip=0; R.ok=false;
      if(!rig||!rr.drive.devs.length) return;
      const W=rig.drive.wheels, ik=ikMatrix(rig.drive.kind,W), fk=fkFromIk(ik);
      const role=n=>/leftFront/i.test(n)?[1,-1]:/leftBack|leftRear/i.test(n)?[1,1]:/rightBack|rightRear/i.test(n)?[1,-1]:/rightFront/i.test(n)?[1,1]:[1,0];
      const phys=pick=>rig.devs.map((n,i)=>{ const s=sim.dev[n];
        return pick(n)*((s&&s.reversed)?-1:1)*((W[i]&&W[i].mount)===-1?-1:1); });
      const fwd=chassisFromWheels(fk,phys(n=>role(n)[0])), side=chassisFromWheels(fk,phys(n=>role(n)[1]));
      R.flip=fwd.vx<0?Math.PI:0;
      R.mirrored=(fwd.vx<0)!==(side.vy<0)&&Math.abs(side.vy)>1e-6;
      R.ik=ik; R.ok=true;
    };
    R.pose=function(){ const c=sim.chassis; return {x:c.x/IN_M, y:c.y/IN_M, h:wrap(c.h-R.flip)}; };
    R.place=function(){ sim.chassis={x:rr.start[0]*IN_M, y:rr.start[1]*IN_M, h:rr.start[2]+R.flip}; };
    R.stop=function(){ for(const n of rr.drive.devs){ const s=devOf(n); if(s) s.cmd=0; } };
    /* RR's follower: the target from the profile, gains on the pose error in
       the robot's frame, then wheel speeds from the CAD's wheels and power. */
    R.follow=function(T){
      if(!R.ok) return;
      const P=rr.drive.params, a=R.pose(), c=Math.cos(a.h), s=Math.sin(a.h);
      const dx=T.x-a.x, dy=T.y-a.y, ex=c*dx+s*dy, ey=-s*dx+c*dy, eh=wrap(T.h-a.h);
      let vx=c*T.vx+s*T.vy+P.axialGain*ex, vy=-s*T.vx+c*T.vy+P.lateralGain*ey, w=T.w+P.headingGain*eh;
      if(R.flip){ vx=-vx; vy=-vy; }
      const rig=sim.rig, W=rig.drive.wheels, ws=wheelSpeeds(R.ik,vx*IN_M,vy*IN_M,w);
      const cmds=rig.devs.map((n,i)=>{ const d=sim.dev[n]; const rpm=(d&&d.spec&&d.spec.rpm)||312, r=(W[i]&&W[i].r)||0.048;
        return ws[i]/(rpm/60*2*Math.PI*r)*((d&&d.reversed)?-1:1)*((W[i]&&W[i].mount)===-1?-1:1); });
      const k=Math.max(1,...cmds.map(Math.abs));
      rig.devs.forEach((n,i)=>{ const d=sim.dev[n]; if(d){ d.cmd=cmds[i]/k; d.mode="run"; } });
    };
    // ---- actions, as RR runs them: one run() per loop, true while busy
    function make(spec){
      if(!spec) return {kind:"none"};
      if(spec.kind==="par"||spec.kind==="seq") return {kind:spec.kind, kids:spec.kids.map(make)};
      if(spec.kind==="traj") return {kind:"traj", plan:spec.plan, i:-1, t0:0, ends:[], marks:spec.plan.markers.map(m=>({m, on:false, a:null})), live:[]};
      return Object.assign({},spec);
    }
    // fields live per object (arm.setPosition) and per class for statics
    const stores={};
    const storeFor=(key,C)=>stores[key]||(stores[key]=Object.assign({},C?C.consts:{},C?C.vars:{}));
    function userRun(a){
      if(!a.scope){ a.scope={}; (a.A.params||[]).forEach((p,i)=>{ a.scope[p]=a.ctorArgs[i]; });
        exec(a.init,envWith([a.scope,storeFor(a.from,a.cls)],a.from,true)); }   // `set = position;`
      exec(a.run,envWith([a.scope,storeFor(a.from,a.cls)],a.from,false));
      return !!a.A.cont;
    }
    function run(a){
      const now=sim.t;
      switch(a.kind){
        case "seq": while(a.kids.length){ if(run(a.kids[0])) return true; a.kids.shift(); } return false;
        case "par": a.kids=a.kids.filter(run); return a.kids.length>0;
        case "sleep": if(a.t0==null) a.t0=now; return now-a.t0<a.dur;
        case "instant": exec(a.stmts,envWith([{}],"",false)); return false;
        case "user": return userRun(a);
        case "traj": return runTraj(a,now);
        default: return false;
      }
    }
    function runTraj(a,now){
      const S=a.plan.stages;
      if(a.i<0){ a.i=0; a.t0=now; a.start=now; }
      // markers: dt after the end of the timed stage they follow
      const fire=()=>{ for(const k of a.marks){ if(k.on) continue;
        const at=k.m.anchor<0?a.start:a.ends[k.m.anchor]; if(at==null) continue;
        if(now>=at+k.m.dt){ k.on=true; k.a=make(k.m.action); a.live.push(k.a); } } };
      fire();
      for(let guard=0; a.i<S.length&&guard<64; guard++){
        const st=S[a.i], t=now-a.t0;
        if(st.kind==="traj"){ if(t<st.tr.dur){ R.follow(rrSample(st.tr,t)); break; } R.stop(); }
        else if(st.kind==="turn"){ if(t<st.tr.dur){ const T=st.tr; R.follow({x:st.x,y:st.y,h:T.h0+T.sg*T.at(t),vx:0,vy:0,w:T.sg*T.rate(t)}); break; } R.stop(); }
        else if(st.kind==="wait"){ if(t<st.dur) break; }
        else if(st.kind==="act"){ if(!st.live) st.live=make(st.action); if(run(st.live)) break; }
        a.ends[a.i]=now; a.i++; a.t0=now; fire();
      }
      a.live=a.live.filter(run);
      return a.i<S.length||a.live.length>0||a.marks.some(k=>!k.on&&k.m.anchor<S.length);
    }
    // ---- the helpers' own statements, in their own scope: locals, then the
    // object's or class's fields, then the OpMode's. A name nothing holds yet
    // is a new local in a method (fresh), or the OpMode's in an action's run().
    function envWith(layers,pidScope,newLocal){
      const base=sim.env(), own=(L,k)=>Object.prototype.hasOwnProperty.call(L,k);
      const find=k=>layers.find(L=>own(L,k));
      return Object.assign({},base,{
        get:k=>{ const L=find(k); return L?L[k]:base.get(k); },
        set:(k,v)=>{ const L=find(k); if(L) L[k]=v; else if(newLocal) layers[0][k]=v; else sim.vars[k]=v; },
        pid:(n,m,a)=>sim.pidOp(pidScope+n,m,a),
        fn:(name,args)=>callStatic(name,args),
        pidScope
      });
    }
    function callStatic(name,args){
      const F=rr.statics[name]; if(!F) return undefined;
      const sc={}; F.params.forEach((p,i)=>{ sc[p]=args[i]; });
      const env=envWith([sc,storeFor(F.cls+"::",rr.classes[F.cls])],F.cls+".",true);
      exec(F.stmts,env);
      return F.ret?evalNode(F.ret,env):0;
    }
    function exec(list,env){
      for(const st of list||[]){
        if(st.kind==="if"){ if(evalNode(st.condAst,env)) exec(st.then,env); else if(st.else) exec(st.else,env); }
        else if(st.kind==="assign"){
          const v=evalNode(st.ast,env), cur=env.get(st.name)||0;
          env.set(st.name, st.op==="+"?cur+v:st.op==="-"?cur-v:st.op==="*"?cur*v:st.op==="/"?(v?cur/v:cur):v);
        }
        else if(st.kind==="pidnew"){ const k=(env.pidScope||"")+st.obj; delete sim.pids[k]; sim.pidOp(k,"setPID",st.args.map(x=>evalNode(x,env))); }
        else if(st.kind==="call"||st.kind==="objcall"){
          if(st.kind==="objcall"&&!sim.dev[st.obj]&&/^(setPID|setPIDF|setP|setI|setD|reset)$/.test(st.meth)){
            sim.pidOp((env.pidScope||"")+st.obj,st.meth,st.args.map(x=>evalNode(x,env))); continue; }
          sim.exec([st],env);
        }
      }
    }
    R.start=function(){ R.root=make(rr.root); R.done=false; for(const k in stores) delete stores[k]; };
    R.tick=function(){ if(R.done||!R.root) return; if(!run(R.root)){ R.done=true; R.stop(); } };
    return R;
  }
  return {rrDetect, rrParseHelpers, rrAttach, rrBuildPlan, rrSample, RRRuntime};
})();
