/* ============================================================
   JOLT MECHANISMS — the robot's joints in a real constraint solver
   ------------------------------------------------------------
   The bench poses mechanisms kinematically: a motor's revolutions turn
   straight into a joint angle, with a stall check bolted on. That can't
   show an arm sagging under a weak motor, a slide back-driving when the
   power is cut, a linkage that only closes one way, or two motors that
   fight. Jolt Physics (MIT, jrouwe/JoltPhysics, its WebAssembly build)
   solves the joints as constraints instead:

     - every rigid body the joints carry is a Jolt body with the CAD's
       mass and its inertia, in the robot frame (+z up, gravity down)
     - a revolute joint is a hinge, a slide a slider, with the CAD's limits
     - a DC motor is a velocity motor whose torque cap is recomputed every
       substep from the motor curve, tau = tau_stall * |d - w/w_free|, so
       stall, holding, back-driving and brake mode fall out of the solver
     - the motor's rotor inertia is reflected through the gearbox onto the
       joint (I_rotor * N^2 about the axis), and the gearbox has friction
     - a servo drives toward its commanded angle at its rated speed, capped
       at its stall torque
     - gear and rack relations between two joints on the frame are Jolt
       gear and rack-and-pinion constraints, so torque goes through them;
       any other coupling (a cascade stage, a linkage) follows its leader
     - a mate that closes a loop pins the two bodies together

   The chassis is fixed here: the drivetrain's own model (src/dynamics.js)
   moves the robot, and this world moves the mechanisms on it. One world per
   robot, single-threaded, so the same commands give the same result on
   every computer (src/lockstep.js hashes it).

   Jolt is handed in (the browser loads it on demand, the tests from
   node_modules), so this file never loads anything itself.
   ============================================================ */
const JOLT_LIB={self:"vendor/jolt-physics.wasm-compat.js",
  cdn:"https://cdn.jsdelivr.net/npm/jolt-physics@1.1.0/dist/jolt-physics.wasm-compat.js"};

const JoltMech=(function(){
  const fin=Number.isFinite;
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{ const n=Math.hypot(a[0],a[1],a[2]); return n>1e-12?[a[0]/n,a[1]/n,a[2]/n]:[0,0,1]; };
  const perp=a=>unit(Math.abs(a[0])<0.9?cross(a,[1,0,0]):cross(a,[0,1,0]));
  const DEG=Math.PI/180;
  // a motor's rotor (kg m^2) as the output shaft feels it once multiplied by the
  // square of the reduction; a goBILDA 5203 can is close to a 555-size motor
  const ROTOR={motor:5e-6, servo:1e-7};
  const FRICTION_SHARE=0.02;                 // gearbox drag: a share of the stall torque at the joint
  const UNDRIVEN_HOLD=50;                    // N m (or N): a joint no device drives holds its drawn pose

  /* Each joint's rigid body from the parts that ride it: mass from the CAD
     where it has one (partMass), the centre of mass, and a box the size of
     the parts for the inertia. */
  function bodiesOf(cad){
    const out=new Map();
    for(const s of (cad&&cad.solids)||[]){
      if(!s.mech) continue;
      const pm=typeof partMass==="function"?partMass(s):{kg:s.kg||0};
      const b=out.get(s.mech)||{kg:0, m:[0,0,0], mn:[Infinity,Infinity,Infinity], mx:[-Infinity,-Infinity,-Infinity], n:0};
      const c=[0,0,0]; for(const p of s.pts||[]){ c[0]+=p[0]; c[1]+=p[1]; c[2]+=p[2];
        for(let k=0;k<3;k++){ if(p[k]<b.mn[k]) b.mn[k]=p[k]; if(p[k]>b.mx[k]) b.mx[k]=p[k]; } }
      const np=(s.pts||[]).length||1;
      for(let k=0;k<3;k++) b.m[k]+=c[k]/np*pm.kg;
      b.kg+=pm.kg; b.n++;
      out.set(s.mech,b);
    }
    for(const [id,b] of out){
      b.com=b.kg>0?b.m.map(v=>v/b.kg):[0,1,2].map(k=>fin(b.mn[k])?(b.mn[k]+b.mx[k])/2:0);
      b.half=[0,1,2].map(k=>fin(b.mn[k])?Math.max(0.004,(b.mx[k]-b.mn[k])/2):0.01);
      b.kg=Math.max(0.01,b.kg);
      out.set(id,b);
    }
    return out;
  }
  /* Rotate inertia: a symmetric 3x3 -> diagonal + quaternion (Jacobi). */
  function diagonalize(I){
    const A=I.map(r=>r.slice()), V=[[1,0,0],[0,1,0],[0,0,1]];
    for(let sw=0;sw<50;sw++) for(let p=0;p<3;p++) for(let q=p+1;q<3;q++){
      if(Math.abs(A[p][q])<1e-20) continue;
      const th=0.5*Math.atan2(2*A[p][q],A[q][q]-A[p][p]), c=Math.cos(th), s=Math.sin(th);
      for(let k=0;k<3;k++){ const x=A[k][p], y=A[k][q]; A[k][p]=c*x-s*y; A[k][q]=s*x+c*y; }
      for(let k=0;k<3;k++){ const x=A[p][k], y=A[q][k]; A[p][k]=c*x-s*y; A[q][k]=s*x+c*y; }
      for(let k=0;k<3;k++){ const x=V[k][p], y=V[k][q]; V[k][p]=c*x-s*y; V[k][q]=s*x+c*y; }
    }
    // a right-handed rotation, eigenvectors as columns
    const det=V[0][0]*(V[1][1]*V[2][2]-V[1][2]*V[2][1])-V[0][1]*(V[1][0]*V[2][2]-V[1][2]*V[2][0])+V[0][2]*(V[1][0]*V[2][1]-V[1][1]*V[2][0]);
    if(det<0) for(let k=0;k<3;k++) V[k][2]=-V[k][2];
    const m=V, tr=m[0][0]+m[1][1]+m[2][2]; let x,y,z,w;
    if(tr>0){ const s=Math.sqrt(tr+1)*2; w=0.25*s; x=(m[2][1]-m[1][2])/s; y=(m[0][2]-m[2][0])/s; z=(m[1][0]-m[0][1])/s; }
    else if(m[0][0]>m[1][1]&&m[0][0]>m[2][2]){ const s=Math.sqrt(1+m[0][0]-m[1][1]-m[2][2])*2; w=(m[2][1]-m[1][2])/s; x=0.25*s; y=(m[0][1]+m[1][0])/s; z=(m[0][2]+m[2][0])/s; }
    else if(m[1][1]>m[2][2]){ const s=Math.sqrt(1+m[1][1]-m[0][0]-m[2][2])*2; w=(m[0][2]-m[2][0])/s; x=(m[0][1]+m[1][0])/s; y=0.25*s; z=(m[1][2]+m[2][1])/s; }
    else { const s=Math.sqrt(1+m[2][2]-m[0][0]-m[1][1])*2; w=(m[1][0]-m[0][1])/s; x=(m[0][2]+m[2][0])/s; y=(m[1][2]+m[2][1])/s; z=0.25*s; }
    return {d:[A[0][0],A[1][1],A[2][2]], q:[x,y,z,w]};
  }

  /* The world. opts: {gravity:[x,y,z] (robot frame, default -9.81 z),
     armature:{jointId: kg m^2 at the joint}, hold:false to let undriven
     joints hang free}. Returns {joints, step(dt, cmds, substeps), q(id),
     w(id), values(), hash(), destroy(), notes}. */
  function build(J,cad,opts){
    if(!J||typeof J.JoltInterface!=="function") throw new Error("Jolt Physics isn't loaded");
    const o=opts||{};
    const mechs=((cad&&cad.mechs)||[]).filter(m=>!m.drive&&m.kind!=="fixed"&&m.axis&&m.pivot);
    const notes=[];
    const live=[];                               // every Jolt object to free
    const keep=x=>{ live.push(x); return x; };
    const V3=v=>new J.Vec3(v[0],v[1],v[2]), R3=v=>new J.RVec3(v[0],v[1],v[2]);

    // one layer, nothing collides: these are a robot's own parts, held by joints
    const pair=new J.ObjectLayerPairFilterTable(1);
    const bpi=new J.BroadPhaseLayerInterfaceTable(1,1); bpi.MapObjectToBroadPhaseLayer(0,new J.BroadPhaseLayer(0));
    const st=new J.JoltSettings(); st.mMaxWorkerThreads=0; st.mObjectLayerPairFilter=pair; st.mBroadPhaseLayerInterface=bpi;
    st.mObjectVsBroadPhaseLayerFilter=new J.ObjectVsBroadPhaseLayerFilterTable(st.mBroadPhaseLayerInterface,1,st.mObjectLayerPairFilter,1);
    st.mMaxBodies=Math.max(64,mechs.length+8);
    const jolt=new J.JoltInterface(st); J.destroy(st);
    const ps=jolt.GetPhysicsSystem(), bi=ps.GetBodyInterface();
    ps.SetGravity(V3(Array.isArray(o.gravity)?o.gravity:[0,0,-9.81]));

    const body=(pos,half,dyn,kg)=>{
      const sh=new J.BoxShape(V3(half),0,null);
      const c=new J.BodyCreationSettings(sh,R3(pos),J.Quat.prototype.sIdentity(),dyn?J.EMotionType_Dynamic:J.EMotionType_Static,0);
      if(dyn){ c.mOverrideMassProperties=J.EOverrideMassProperties_CalculateInertia; c.mMassPropertiesOverride.mMass=kg;
        c.mAllowSleeping=false; c.mLinearDamping=0; c.mAngularDamping=0; c.mMaxAngularVelocity=200; }
      const b=bi.CreateBody(c); J.destroy(c);
      bi.AddBody(b.GetID(),dyn?J.EActivation_Activate:J.EActivation_DontActivate);
      return b;
    };
    const chassis=body([0,0,0],[0.05,0.05,0.05],false);
    const B=bodiesOf(cad);
    const joints=new Map();                      // id -> {m, lin, axis, body, parent, c, ...}
    for(const m of mechs){
      const b=B.get(m.id)||{kg:0.02, com:m.pivot.slice(), half:[0.01,0.01,0.01]};
      const jb=body(b.com,b.half,true,b.kg);
      joints.set(m.id,{m, id:m.id, lin:typeof normJointKind==="function"?normJointKind(m.kind)==="linear":/^(linear|prismatic|linear-slide)$/.test(m.kind),
        axis:unit(m.axis), body:jb, kg:b.kg, com:b.com, q:0, qPrev:0, w:0});
    }
    const bodyOf=id=>id==="chassis"||!joints.has(id)?chassis:joints.get(id).body;

    // reflected rotor inertia about each driven joint's axis
    const arm=o.armature||{};
    for(const [id,j] of joints){
      const a=fin(arm[id])&&arm[id]>0?arm[id]:0; if(!a||j.lin) continue;
      const mp=j.body.GetMotionProperties(), invD=mp.GetInverseInertiaDiagonal(), qr=mp.GetInertiaRotation();
      const d=[1/invD.GetX(),1/invD.GetY(),1/invD.GetZ()], q=[qr.GetX(),qr.GetY(),qr.GetZ(),qr.GetW()];
      // R from the quaternion, I = R diag R^T + a (axis axis^T)
      const [x,y,z,w]=q, R=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
      const I=[[0,0,0],[0,0,0],[0,0,0]];
      for(let r=0;r<3;r++) for(let c=0;c<3;c++){ let s=0; for(let k=0;k<3;k++) s+=R[r][k]*d[k]*R[c][k]; I[r][c]=s+a*j.axis[r]*j.axis[c]; }
      const D=diagonalize(I);
      mp.SetInverseInertia(new J.Vec3(1/D.d[0],1/D.d[1],1/D.d[2]),new J.Quat(D.q[0],D.q[1],D.q[2],D.q[3]));
      j.armature=a;
    }

    // the joints themselves
    for(const [id,j] of joints){
      const m=j.m, parent=bodyOf(m.parent), n=perp(j.axis);
      let lo=m.limits&&fin(m.limits[0])?m.limits[0]:null, hi=m.limits&&fin(m.limits[1])?m.limits[1]:null;
      // Jolt measures from where the joint was built (the drawn pose) and wants 0 inside the range
      if(lo!=null&&lo>0){ notes.push("\""+id+"\" is drawn outside its travel; its lower stop is taken at the drawn pose."); lo=0; }
      if(hi!=null&&hi<0){ notes.push("\""+id+"\" is drawn outside its travel; its upper stop is taken at the drawn pose."); hi=0; }
      let c;
      if(j.lin){
        const s=new J.SliderConstraintSettings(); s.mSpace=J.EConstraintSpace_WorldSpace; s.mAutoDetectPoint=false;
        s.mPoint1=s.mPoint2=R3(m.pivot); s.mSliderAxis1=s.mSliderAxis2=V3(j.axis); s.mNormalAxis1=s.mNormalAxis2=V3(n);
        if(lo!=null||hi!=null){ s.mLimitsMin=lo!=null?lo:-1e6; s.mLimitsMax=hi!=null?hi:1e6; }
        c=J.castObject(s.Create(parent,j.body),J.SliderConstraint); J.destroy(s);
      }else{
        const s=new J.HingeConstraintSettings(); s.mSpace=J.EConstraintSpace_WorldSpace;
        s.mPoint1=s.mPoint2=R3(m.pivot); s.mHingeAxis1=s.mHingeAxis2=V3(j.axis); s.mNormalAxis1=s.mNormalAxis2=V3(n);
        if(lo!=null||hi!=null){ s.mLimitsMin=Math.max(-Math.PI,lo!=null?lo:-Math.PI); s.mLimitsMax=Math.min(Math.PI,hi!=null?hi:Math.PI); }
        c=J.castObject(s.Create(parent,j.body),J.HingeConstraint); J.destroy(s);
      }
      c.SetNumVelocityStepsOverride(20); c.SetNumPositionStepsOverride(8);
      ps.AddConstraint(c);
      j.c=c; j.motor=c.GetMotorSettings();
      c.SetMotorState(J.EMotorState_Velocity);
      j.parentId=m.parent&&joints.has(m.parent)?m.parent:"chassis";
    }

    // couplings: through-torque constraints where the solver can do them, followers otherwise
    for(const [id,j] of joints){
      const cp=j.m.couple; if(!cp) continue;
      const L=joints.get(cp.to); if(!L){ notes.push("\""+id+"\" follows \""+cp.to+"\", which isn't simulated; it holds still."); continue; }
      const r=fin(cp.ratio)?cp.ratio:1, sameFrame=j.parentId==="chassis"&&L.parentId==="chassis";
      const off=Number.isFinite(cp.offset)&&cp.offset!==0;        // a gear or rack constraint has no offset: those track
      if(!cp.link&&!off&&sameFrame&&r!==0&&!L.lin&&!j.lin){
        // Jolt's gear: angle2 = -angle1 / ratio
        const s=new J.GearConstraintSettings(); s.mSpace=J.EConstraintSpace_WorldSpace;
        s.mHingeAxis1=V3(L.axis); s.mHingeAxis2=V3(j.axis); s.mRatio=-1/r;
        const g=J.castObject(s.Create(L.body,j.body),J.GearConstraint); J.destroy(s);
        g.SetConstraints(L.c,j.c); ps.AddConstraint(g); j.gear=g; j.follow="gear";
      }else if(!cp.link&&!off&&sameFrame&&r!==0&&!L.lin&&j.lin){
        // Jolt's rack: pinion angle = ratio * rack travel; ours: travel = r * angle
        const s=new J.RackAndPinionConstraintSettings(); s.mSpace=J.EConstraintSpace_WorldSpace;
        s.mHingeAxis=V3(L.axis); s.mSliderAxis=V3(j.axis); s.mRatio=1/r;
        const g=J.castObject(s.Create(L.body,j.body),J.RackAndPinionConstraint); J.destroy(s);
        g.SetConstraints(L.c,j.c); ps.AddConstraint(g); j.gear=g; j.follow="rack";
      }else j.follow="track";                    // driven to where its leader puts it, every substep
      j.leader=L.id;
    }

    // loops: the two bodies a closing mate joins are pinned together where it is;
    // every joint around the loop is then free to move with it, never held
    const chain=id=>{ const out=[]; let x=id, g=0; while(x&&x!=="chassis"&&joints.has(x)&&g++<64){ out.push(x); x=joints.get(x).parentId; } return out; };
    for(const L of (cad&&cad.loops)||[]){
      if(!L||L.a===L.b||!Array.isArray(L.point)) continue;
      const a=bodyOf(L.a), b=bodyOf(L.b); if(a===b) continue;
      const ca=chain(L.a), cb=chain(L.b);
      for(const x of ca.concat(cb)) if(!(ca.includes(x)&&cb.includes(x))) joints.get(x).passive=true;
      const s=new J.PointConstraintSettings(); s.mSpace=J.EConstraintSpace_WorldSpace; s.mPoint1=s.mPoint2=R3(L.point);
      const pc=J.castObject(s.Create(a,b),J.PointConstraint); J.destroy(s);
      pc.SetNumVelocityStepsOverride(20); pc.SetNumPositionStepsOverride(8);
      ps.AddConstraint(pc);
    }

    // a hinge reads -pi..pi; a turret or a roller turns on past that, so the turns are counted
    const qOf=j=>{
      if(j.lin) return j.c.GetCurrentPosition();
      const raw=j.c.GetCurrentAngle(), prev=j.raw==null?0:j.raw;      // built at the drawn pose: angle 0
      let d=raw-prev; if(d>Math.PI) d-=2*Math.PI; else if(d<-Math.PI) d+=2*Math.PI;
      j.raw=raw; return j.q+d;
    };
    const values=()=>{ const out=new Map(); for(const [id,j] of joints) out.set(id,j.q); return out; };
    const hold=o.hold!==false;

    /* cmds: id -> {mode:"dc", duty, stall, free, brake} (stall N m or N at the
       joint, free rad/s or m/s at the joint), {mode:"servo", target, stall,
       rate}, or nothing (held, or free with opts.hold false). */
    function step(dt,cmds,substeps){
      const n=Math.max(1,Math.min(16,substeps|0||4)), h=dt/n, C=cmds||{};
      const get=id=>{ const j=joints.get(id); return j?j.q:null; };
      for(let k=0;k<n;k++){
        for(const [id,j] of joints){
          const c=Object.prototype.hasOwnProperty.call(C,id)?C[id]:null;
          if(j.follow==="gear"||j.follow==="rack"){ j.c.SetMotorState(J.EMotorState_Off); continue; }
          let target=0, cap=0, fr=0;
          if(j.follow==="track"){
            // where the leader puts it, how fast that's moving, and a gentle pull onto it
            const want=typeof followQ==="function"?followQ(j.m,get):null;
            if(want==null){ target=-j.q/(3*h); j.wantPrev=null; }
            else { const rate=j.wantPrev==null?0:(want-j.wantPrev)/h; j.wantPrev=want; target=rate+(want-j.q)/(3*h); }
            cap=1e4;
          }else if(c&&c.mode==="dc"&&fin(c.duty)&&c.stall>0&&c.free>0){
            const d=Math.max(-1,Math.min(1,c.duty)), tf=FRICTION_SHARE*c.stall;
            target=d*c.free;
            // the motor curve: what the windings give at this speed, toward the target.
            // Jolt only applies joint friction to an unpowered joint, so the gearbox's
            // drag is folded in here: it fights the motor when the motor drives the
            // motion, and adds to it when the motor brakes it
            const e=d-j.w/c.free, along=Math.sign(e)===Math.sign(j.w)&&Math.abs(j.w)>1e-6;
            if(c.brake===false&&Math.abs(d)<1e-6) cap=tf;
            else cap=Math.max(0,c.stall*Math.abs(e)+(along?-tf:tf));
          }else if(c&&c.mode==="servo"&&fin(c.target)&&c.stall>0){
            const e=c.target-j.q, rate=c.rate>0?c.rate:6;
            target=Math.max(-rate,Math.min(rate,e/Math.max(h,0.02)));
            cap=c.stall;
          }else if(hold&&!j.passive){ target=-j.q/Math.max(h,0.02); cap=UNDRIVEN_HOLD; }
          else if(j.passive){ target=0; cap=0; fr=0.002; }    // a pin in a linkage: it goes where the loop puts it
          j.c.SetMotorState(J.EMotorState_Velocity);
          if(j.lin){ j.motor.mMinForceLimit=-cap; j.motor.mMaxForceLimit=cap; j.c.SetTargetVelocity(target); j.c.SetMaxFrictionForce(fr); }
          else { j.motor.mMinTorqueLimit=-cap; j.motor.mMaxTorqueLimit=cap; j.c.SetTargetAngularVelocity(target); j.c.SetMaxFrictionTorque(fr); }
        }
        jolt.Step(h,1);
        for(const j of joints.values()){ const q=qOf(j); j.w=(q-j.q)/h; j.qPrev=j.q; j.q=q; }
      }
    }
    /* Everything that decides what happens next, as one number: two computers
       that disagree here have diverged (src/lockstep.js). */
    function hash(){
      let hv=0x811c9dc5>>>0;
      const mix=x=>{ const v=Math.round(x*1e7)|0; for(let k=0;k<4;k++){ hv^=(v>>>(8*k))&255; hv=Math.imul(hv,16777619)>>>0; } };
      for(const id of [...joints.keys()].sort()){ const j=joints.get(id); mix(j.q); mix(j.w);
        const p=bi.GetPosition(j.body.GetID()); mix(p.GetX()); mix(p.GetY()); mix(p.GetZ()); }
      return hv>>>0;
    }
    function destroy(){
      try{ for(const j of joints.values()){ if(j.gear) ps.RemoveConstraint(j.gear); if(j.c) ps.RemoveConstraint(j.c); } }catch(e){}
      try{ J.destroy(jolt); }catch(e){}
      joints.clear();
    }
    return {joints, step, q:id=>{ const j=joints.get(id); return j?j.q:null; }, w:id=>{ const j=joints.get(id); return j?j.w:null; },
      values, hash, destroy, notes, chassis};
  }

  /* ---- the bench's devices -> commands, and the joints' motion -> encoders ----
     The sim keeps every device in the code's frame (AGENTS.md: ticks count up
     under positive power whatever setDirection says); a joint turns positive
     the way the code's positive goes, times m.dir. */
  function deviceCommands(dev,world,opts){
    const o=opts||{}, cmds={}, arm={};
    for(const name in dev){
      const s=dev[name], m=s.mech; if(!m||!world.joints.has(m.id)) continue;
      const j=world.joints.get(m.id), dir=m.dir||1, spec=s.spec||{};
      if(s.kind==="motor"){
        const rpm=spec.rpm||300, stall=spec.stallNm||0.5;
        let k;                                   // joint units per output-shaft radian
        if(j.lin){ const mpt=typeof slideMPerTick==="function"?slideMPerTick(s):0.0005; k=mpt*(s.tpr||537.7)/(2*Math.PI); }
        else k=1/(+m.gear>0?+m.gear:1);
        const free=rpm*2*Math.PI/60*k, st=stall/k;
        const prev=cmds[m.id];
        if(prev&&prev.mode==="dc"){                // two motors on one joint add up
          const S=prev.stall+st; prev.duty=(prev.duty*prev.stall+s.act*dir*st)/S; prev.stall=S; }
        else cmds[m.id]={mode:"dc", duty:(s.act||0)*dir, stall:st, free, brake:s.zeroPower!=="FLOAT", k};
        if(!j.lin) arm[m.id]=(arm[m.id]||0)+ROTOR.motor*Math.pow((spec.ratio||19.2)/k,2);
      }else if(s.kind==="servo"){
        const travel=(s.travelDeg||300)*DEG;
        const lever=j.lin?(m.lever||0.15):1;
        const target=(s.cmd-(fin(s.restPos)?s.restPos:0.5))*(j.lin?lever:travel)*dir;
        const rate=(60*DEG/(s.sec60||0.18))*(j.lin?lever:1);
        cmds[m.id]={mode:"servo", target, stall:(spec.stallNm||2.5)/(j.lin?lever:1), rate};
      }
    }
    return o.armature?{cmds, armature:arm}:cmds;
  }
  /* After a step: each driving device's encoder, from where its joint went. */
  function readBack(dev,world,dt){
    for(const name in dev){
      const s=dev[name], m=s.mech; if(!m||!world.joints.has(m.id)) continue;
      const j=world.joints.get(m.id), dir=m.dir||1;
      if(s.kind==="motor"){
        const prev=s.ticks;
        if(j.lin){ const mpt=typeof slideMPerTick==="function"?slideMPerTick(s):0.0005; s.ticks=j.q*dir/mpt; s.revs=s.ticks/(s.tpr||537.7); }
        else { s.revs=j.q*dir*(+m.gear>0?+m.gear:1)/(2*Math.PI); s.ticks=s.revs*(s.tpr||537.7); }
        s.vel=dt>0?(s.ticks-prev)/dt:0;
        s.stalled=Math.abs(s.act||0)>0.2&&Math.abs(j.w)<1e-3;
      }else if(s.kind==="servo"){
        const travel=(s.travelDeg||300)*DEG, lever=j.lin?(m.lever||0.15):1;
        s.act=(fin(s.restPos)?s.restPos:0.5)+j.q*dir/(j.lin?lever:travel);
        s.stalled=Math.abs(s.cmd-s.act)>0.02&&Math.abs(j.w)<1e-3;
      }
    }
  }
  return {build, bodiesOf, deviceCommands, readBack, diagonalize, ROTOR};
})();
