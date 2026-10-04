/* ============================================================
   ROBOT CHECK — is this robot right, for this team's code?
   Not "does it look like a known mechanism": whatever the joints came from
   (Onshape mates, a joint spec, the finder, the old guess), check them
   against the team's own OpMode and the CAD itself, and say exactly what a
   person has to answer, in their own device names:
     source     exact (Onshape mates) or guessed (and so worth confirming)
     devices    every motor and servo the code moves drives a joint, a
                follower chain, or the drivetrain
     joints     every joint carries parts and has something driving it
     drive      the code's drive motors match the CAD's wheels
     swing      moving each joint a little doesn't push its parts through
                the frame both ways (wrong parts, or a wrong axis)
     axis       each driven turn has its motor or servo on its axis, and of
                the kind the code says (a wrong axis or pivot, a swapped device)
     range      the servo positions the code sends reach the joint at all
                (the wrong servo on it, or the wrong drawn position)
     targets    RUN_TO_POSITION targets fit the slide's travel
     scale      drawn at robot size and about a robot's weight (the STEP's units)
   Each item: {key, sev: "ok"|"note"|"warn"|"fail", text, device?, joint?, ask?}.
   Only "fail" (answer) and "warn" (confirm) are questions. Something the bench
   can run without a person is a "note": a device with no joint drawn for it
   runs as a live gauge driven by the code, a joint nothing drives sits still,
   guessed joints are offered an exact source. Notes carry one-click answers.
   ask says what to ask the team: "pick-parts" (click what this device
   moves), "drop-joint", "pick-device" (which of your devices drives it),
   "mates" (exact joints from Onshape), "look" (show it in the CAD view).
   ============================================================ */
const {checkRobot, setupAuto}=(function(){
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const DEG=Math.PI/180;
  // a rigid move: p -> R p + t, R as three rows
  const ID={R:[[1,0,0],[0,1,0],[0,0,1]], t:[0,0,0]};
  const apply=(T,p)=>[dot(T.R[0],p)+T.t[0], dot(T.R[1],p)+T.t[1], dot(T.R[2],p)+T.t[2]];
  const compose=(A,B)=>{ // A after B
    const R=[0,1,2].map(i=>[0,1,2].map(j=>A.R[i][0]*B.R[0][j]+A.R[i][1]*B.R[1][j]+A.R[i][2]*B.R[2][j]));
    return {R, t:apply(A,B.t)};
  };
  function jointMove(m,q){
    const a=m.axis||[0,0,1];
    if(normJointKind(m.kind)==="linear") return {R:ID.R, t:mul(a,q)};
    const c=Math.cos(q), s=Math.sin(q), C=1-c, [x,y,z]=a;
    const R=[[c+x*x*C, x*y*C-z*s, x*z*C+y*s],[y*x*C+z*s, c+y*y*C, y*z*C-x*s],[z*x*C-y*s, z*y*C+x*s, c+z*z*C]];
    const p=m.pivot||[0,0,0], Rp=[dot(R[0],p),dot(R[1],p),dot(R[2],p)];
    return {R, t:sub(p,Rp)};
  }
  const sevRank={fail:0,warn:1,note:2,ok:3};
  // from the geometry alone, so once per CAD (the joints change, the parts don't)
  const ACTS=new WeakMap(), MASS=new WeakMap();
  function cadActuators(cad){
    if(!cad||typeof ARActuators==="undefined") return [];
    if(ACTS.has(cad)) return ACTS.get(cad);
    let A=[]; try{ A=ARActuators.findActuators(cad,{driveFromCAD:c=>driveFromCAD(c,{}), hwFromPart}).actuators||[]; }catch(e){ A=[]; }
    ACTS.set(cad,A); return A;
  }
  function cadMass(cad){
    if(MASS.has(cad)) return MASS.get(cad);
    let kg=0; try{ kg=massProps(cad).kg||0; }catch(e){ kg=0; }
    MASS.set(cad,kg); return kg;
  }

  function checkRobot(cad,code,map,opts){
    opts=opts||{};
    const items=[], put=o=>items.push(o);
    const S=(cad&&cad.solids)||[];
    const mechs=((cad&&cad.mechs)||[]).filter(m=>!m.drive&&m.kind!=="fixed");
    const byId=new Map(mechs.map(m=>[m.id,m]));
    const label=m=>m.label||m.id;
    const devs=((code&&code.devices)||[]).filter(d=>/servo|dcmotor/i.test(d.type||""));
    const drives=devs.filter(d=>isDriveDevice(d)), acts=devs.filter(d=>!isDriveDevice(d));
    const moved=typeof opts.isCommanded==="function"?opts.isCommanded:()=>true;

    // where the joints came from
    const src=cad&&cad.mates&&cad.mates.source;
    if(src==="onshape") put({key:"source", sev:"ok", text:cad.source==="urdf"?"Joints come from your URDF's joints, so axes, pivots and parts are exact.":"Joints come from your Onshape mates, so axes, pivots and parts are exact."});
    // a robot package made from mates (src/simbot.js) is as exact as the mates were
    else if(src==="spec"&&cad.mates.exact&&!cad.mates.auto) put({key:"source", sev:"ok", text:"Joints come from your robot package, made from your "+(cad.source==="urdf"?"URDF's joints":cad.source==="mjcf"?"MJCF's joints":"Onshape mates")+", so axes, pivots and parts are exact."});
    else if(src==="spec"&&!(cad.mates.auto)) put({key:"source", sev:"ok", text:"Joints come from a joint spec"+(cad.mates.name?" ("+cad.mates.name+")":"")+"."});
    else put({key:"source", sev:"note", ask:"mates", text:(src==="spec"?"Joints were found from the geometry":"Joints are guessed from the assembly")+
      ". The Onshape bookmark or a URDF would make them exact."});

    // what the CAD itself leaves open (src/simbot.js validateRobot): shown, never asked.
    // Drafted joints are the source line above; devices are the lines below.
    if(typeof validateRobot==="function"&&cad&&cad.mates&&(cad.mates.source==="onshape"||cad.mates.exact)){
      for(const i of validateRobot(cad,{}).items){
        if(i.code==="draft"||i.code==="no-device") continue;
        put({key:"cad:"+i.code+(i.joint?":"+i.joint:""), sev:"note", joint:i.joint||undefined, text:i.text});
      }
    }

    // every device the code moves
    const driven=new Map();                          // joint id -> device
    for(const d of acts){
      const j=map&&map[d.name]&&byId.get(map[d.name]);
      if(j){ driven.set(j.id,d.name); put({key:"dev:"+d.name, sev:"ok", device:d.name, joint:j.id, ask:"look", text:d.name+" drives \""+label(j)+"\"."}); continue; }
      if(!moved(d.name)) continue;
      put({key:"dev:"+d.name, sev:"note", device:d.name, ask:"pick-parts",
        text:d.name+" runs as a live gauge: your code moves it, and no joint in the CAD is tied to it yet. Click the part it moves to see it move."});
    }

    // every joint
    const own=new Map(mechs.map(m=>[m.id,0]));
    for(const s of S) if(s.mech&&own.has(s.mech)) own.set(s.mech,own.get(s.mech)+1);
    const kids=id=>mechs.filter(k=>k.parent===id);
    const carries=m=>own.get(m.id)>0||kids(m.id).some(carries);
    // joints nothing drives: asked about in order of how likely a device moves them (a
    // motor or servo on it, then what it carries), and only up to twice the devices the
    // code has; the rest, and hardware that just spins (src/mates.js passive), are one line
    const undriven=[];
    for(const m of mechs){
      if(!carries(m)){ put({key:"empty:"+m.id, sev:"fail", joint:m.id, ask:"drop-joint", text:"\""+label(m)+"\" moves no parts. Remove it, or give it the parts it carries."}); continue; }
      if(m.couple){
        const to=byId.get(m.couple.to);
        if(!to) put({key:"follow:"+m.id, sev:"fail", joint:m.id, ask:"drop-joint", text:"\""+label(m)+"\" follows \""+m.couple.to+"\", which isn't a joint."});
        continue;
      }
      if(!driven.has(m.id)&&acts.length&&!m.passive) undriven.push(m);
    }
    // while a device still has no joint, the question is asked from the device's side
    // (above, with its likely joints); the joints are one line. Once every device is
    // placed, the joints left over are asked about one by one, up to a handful
    const unbound=acts.some(d=>!driven.has(map&&map[d.name])&&moved(d.name)&&!(map&&map[d.name]&&byId.get(map[d.name])));
    const askMax=unbound?0:Math.max(6,2*acts.length);
    const weight=m=>(m.hasActuator?1e3:0)+(m.lever||0)*10+S.filter(s=>s.mech===m.id).length;
    undriven.sort((a,b)=>weight(b)-weight(a));
    for(const m of undriven.slice(0,askMax)) put({key:"undriven:"+m.id, sev:"note", joint:m.id, ask:"pick-device",
      text:"\""+label(m)+"\" stays where it's drawn: nothing in your code drives it. Pick the device that moves it, if one does."});
    const rest=undriven.slice(askMax), spinners=mechs.filter(m=>m.passive&&!driven.has(m.id)).length;
    if(rest.length||spinners) put({key:"undriven:more", sev:"note", text:(rest.length?rest.length+" more joint"+(rest.length===1?"":"s")+" ("+rest.slice(0,4).map(label).join(", ")+(rest.length>4?" …":"")+") and ":"")+
      (spinners?spinners+" bearings, hubs and idlers that just spin":"")+" stay where they're drawn with nothing driving them. If a device moves one, pick it in the joint editor."});

    // the likely answers: a device the code moves and the joints nothing drives, paired by kind
    // (a servo turns something; a motor turns an arm or pulls a slide through a spool)
    const free=mechs.filter(m=>!m.couple&&!driven.has(m.id)&&!m.passive&&carries(m));
    const fits=(d,m)=>{ const lin=normJointKind(m.kind)==="linear", sv=/servo/i.test(d.type||""), l=(m.label||m.id).toLowerCase();
      if(sv) return lin?0:(/servo/.test(l)?3:2);
      return lin?3:(/motor/.test(l)?3:1); };
    for(const it of items) if(it.ask==="pick-parts"&&it.device){
      const d=acts.find(x=>x.name===it.device);
      const weight=m=>(m.hasActuator?1e3:0)+(m.lever||0)*10+S.filter(s=>s.mech===m.id).length;
      it.candidates=free.map(m=>({joint:m.id, label:label(m), v:fits(d,m)*1e4+weight(m)})).filter(c=>c.v>=1e4).sort((a,b)=>b.v-a.v).slice(0,6).map(({joint,label})=>({joint,label}));
      if(it.candidates.length) it.text=it.device+" runs as a live gauge: no joint is tied to it yet. Is it one of these? Or click the part it moves.";
    }
    const loose=items.filter(i=>i.ask==="pick-parts").map(i=>acts.find(x=>x.name===i.device)).filter(Boolean);
    for(const it of items) if(it.ask==="pick-device"){
      const m=byId.get(it.joint);
      it.candidates=loose.map(d=>({device:d.name, v:fits(d,m)})).filter(c=>c.v>0).sort((a,b)=>b.v-a.v).map(c=>({device:c.device}));
    }

    // the drive motors the code and the CAD read differently: the bench follows the code
    // (it drives the real robot), and says which motors the CAD would have the other way
    const dis=Array.isArray(opts.mountDisagree)?opts.mountDisagree:[];
    if(dis.length) put({key:"drive:mounts", sev:"warn", ask:"look", text:"Your code and the CAD disagree on which way "+dis.join(", ")+(dis.length===1?" is":" are")+" mounted: by the CAD's motor"+(dis.length===1?"":"s")+" positive power would push "+(dis.length===1?"it":"them")+" the other way. The bench follows your code, since it drives your robot; if the real robot spins or runs backward, this is where to look."});
    // the CAD itself: drawn at robot size, about a robot's weight
    const bb=cad&&cad.bbox;
    if(bb&&S.length){
      const size=Math.max(bb.max[0]-bb.min[0],bb.max[1]-bb.min[1],bb.max[2]-bb.min[2]);
      if(size>1.4||size<0.12) put({key:"scale", sev:"fail", text:"The robot is "+(size>=1?size.toFixed(1)+" m":(size*1000).toFixed(0)+" mm")+
        " across; an FTC robot is about half a metre. The STEP's units are probably wrong (inches read as millimetres, or the other way)."});
      else{ const kg=cadMass(cad);
        if(kg>30||kg<2) put({key:"mass", sev:"warn", text:"The CAD comes to "+kg.toFixed(1)+" kg; FTC robots are usually 6 to 18 kg. "+
          "Parts may be drawn solid that are hollow, or missing; the physics drives this mass."}); }
    }
    // each driven turn: its motor or servo on its axis, of the kind the code says
    const A=cadActuators(cad).filter(a=>a.role!=="drive");
    const onAxis=(a,m)=>{ if(Math.abs(dot(a.axis,m.axis))<Math.cos(4*DEG)) return false;
      const d=sub(a.pivot.map(v=>v/1000),m.pivot||[0,0,0]), t=dot(d,m.axis); return Math.hypot(d[0]-m.axis[0]*t,d[1]-m.axis[1]*t,d[2]-m.axis[2]*t)<0.008; };
    if(A.length) for(const m of mechs){
      if(normJointKind(m.kind)==="linear"||m.couple||!driven.has(m.id)||!m.axis) continue;
      const dv=acts.find(d=>d.name===driven.get(m.id)); if(!dv) continue;
      const hit=A.find(a=>onAxis(a,m));
      if(!hit){ put({key:"axis:"+m.id, sev:"warn", joint:m.id, device:dv.name, ask:"look",
        text:"No motor or servo in the CAD sits on \""+label(m)+"\"'s axis. If "+dv.name+" turns it through gears, a belt or a chain, that's fine; otherwise the joint's axis or pivot is off."}); continue; }
      const wantServo=/servo/i.test(dv.type||"");
      if(wantServo!==(hit.kind==="servo")) put({key:"kind:"+m.id, sev:"warn", joint:m.id, device:dv.name, ask:"pick-device",
        text:"Your code drives \""+label(m)+"\" with "+dv.name+", a "+(wantServo?"servo":"motor")+", but the CAD has a "+hit.kind+" on that joint's axis. The wrong device on this joint?"});
    }
    // servo positions the joint can't reach at all: the wrong servo on it, or the wrong drawn position
    for(const m of mechs){
      if(m.couple||!driven.has(m.id)||!m.limits||!Number.isFinite(m.restPos)||normJointKind(m.kind)==="linear") continue;
      const dv=acts.find(d=>d.name===driven.get(m.id));
      if(!dv||!/servo/i.test(dv.type||"")||/crservo/i.test(dv.type||"")||typeof travelRange!=="function") continue;
      const tr=travelRange(code,dv.name); if(!tr) continue;
      const spec=typeof specFor==="function"?specFor(dv,m,"code"):null, k=((spec&&spec.travelDeg)||300)*DEG*(m.dir||1);
      const q1=(tr.lo-m.restPos)*k, q2=(tr.hi-m.restPos)*k, lo=Math.min(q1,q2), hi=Math.max(q1,q2);
      const L0=Number.isFinite(m.limits[0])?m.limits[0]:-Infinity, L1=Number.isFinite(m.limits[1])?m.limits[1]:Infinity, M=5*DEG;
      const deg=v=>(v/DEG).toFixed(0);
      // a claw is sent past its stop to squeeze (most of its range still lands inside); a joint
      // that can reach hardly any of what the code asks is on the wrong servo or drawn wrong
      const reach=Math.max(0,Math.min(hi,L1+M)-Math.max(lo,L0-M)), span=hi-lo;
      if((hi<L0-M||lo>L1+M)||(span>10*DEG&&reach<0.2*span)) put({key:"range:"+m.id, sev:"fail", joint:m.id, device:dv.name, ask:"pick-device",
        text:"Your code sends "+dv.name+" between "+tr.lo+" and "+tr.hi+", which would turn \""+label(m)+"\" "+deg(lo)+"° to "+deg(hi)+"° from where it's drawn, "+
          "but it only moves "+deg(L0)+"° to "+deg(L1)+"°. The wrong servo on this joint, or the wrong drawn position (restPos)."});
    }
    // RUN_TO_POSITION targets past the end of a slide
    for(const m of mechs){
      if(m.couple||!driven.has(m.id)||!m.limits||normJointKind(m.kind)!=="linear"||typeof travelRange!=="function") continue;
      const dv=acts.find(d=>d.name===driven.get(m.id)); if(!dv||!/dcmotor/i.test(dv.type||"")) continue;
      const tr=travelRange(code,dv.name,"setTargetPosition"); if(!tr) continue;
      const spec=typeof specFor==="function"?specFor(dv,m,"code"):null, tpr=typeof ticksPerRev==="function"?ticksPerRev(spec):537.7;
      const mm=Math.max(Math.abs(tr.lo),Math.abs(tr.hi))*slideMmPerTick(m,tpr), top=Math.max(Math.abs(m.limits[0]||0),Math.abs(m.limits[1]||0))*1000;
      if(top>0&&mm>top*1.1+10) put({key:"targets:"+m.id, sev:"warn", joint:m.id, device:dv.name, ask:"look",
        text:"Your code sends "+dv.name+" to "+Math.max(Math.abs(tr.lo),Math.abs(tr.hi))+" ticks, "+mm.toFixed(0)+" mm up \""+label(m)+"\", but it only travels "+top.toFixed(0)+
          " mm. The spool (mm per tick) or the slide's travel is off, or the code drives it into its stop."});
    }

    // the drivetrain
    let D=null; try{ D=driveFromCAD(cad,{front:opts.front}); }catch(e){}
    const wheels=D?(D.wheels||[]).length:0;
    if(drives.length&&!wheels) put({key:"drive", sev:"fail", text:"Your code drives "+drives.length+" wheel motors ("+drives.map(d=>d.name).join(", ")+"), but the CAD has no wheels on the floor."});
    else if(drives.length&&wheels&&drives.length!==wheels&&!(drives.length===2&&wheels>=4))
      put({key:"drive", sev:"warn", text:"Your code has "+drives.length+" drive motors and the CAD "+wheels+" drive wheels. Check the drivetrain."});
    else if(drives.length) put({key:"drive", sev:"ok", text:drives.length+" drive motors and "+wheels+" wheels."});
    // what the drivetrain finder had to assume about the CAD, said where the team looks
    if(D&&wheels&&(drives.length||D.wheels.some(w=>w.mirrored))){
      const said=re=>(D.why||[]).some(t=>re.test(t));
      if(D.wheels.some(w=>w.mirrored)) put({key:"drive:mirrored", sev:"warn", ask:"look",
        text:"Only one drive wheel is drawn in the CAD; the other three are placed as its mirror images"+(said(/four drive motors/)?", from where the four drive motors are":"")+". Draw all four for an exact drive base."});
      if(said(/Check that wheel in the CAD/)) put({key:"drive:hand", sev:"warn", ask:"look",
        text:"The mecanum wheel drawn is the other hand for its corner, read off its rollers: built that way, the robot couldn't turn in place. The standard X pattern is used; check that wheel in the CAD."});
      else if(said(/"O" pattern|can't strafe properly/)) put({key:"drive:pattern", sev:"warn", ask:"look",
        text:"The mecanum wheels' rollers aren't in the standard X pattern ("+((D.why||[]).find(t=>/"O" pattern|can't strafe properly/.test(t))||"").replace(/^.*?: /,"").slice(0,120)+"). Modelled as drawn: check the wheels' corners in the CAD."});
      if(D.kind==="unknown") put({key:"drive:kind", sev:"warn", ask:"look", text:"The CAD's "+wheels+" wheels don't make a drivetrain this bench knows; it drives on what your code says."});
    }

    // swing each driven joint a little each way: its parts must not go through the frame both ways
    if(opts.swing!==false) for(const it of swingChecks(S,mechs,byId,driven,opts,code,devs)) put(it);

    items.sort((a,b)=>sevRank[a.sev]-sevRank[b.sev]);
    const need=items.filter(i=>i.sev==="fail").length, warn=items.filter(i=>i.sev==="warn").length;
    return {items, need, warn, ready:need===0};
  }

  /* The frame as a grid of shrunk part boxes; a joint's parts, moved, as
     sample points. A point that was clear of the frame as drawn and lands
     inside a frame part after the move is a clash. */
  function swingChecks(S,mechs,byId,driven,opts,code,devs){
    const out=[];
    const frame=[]; S.forEach((s,i)=>{ if(!s.mech&&s.pts&&s.pts.length) frame.push(i); });
    if(!frame.length) return out;
    const box=i=>{ const P=S[i].pts, lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
      for(const p of P) for(let k=0;k<3;k++){ if(p[k]<lo[k]) lo[k]=p[k]; if(p[k]>hi[k]) hi[k]=p[k]; }
      const sh=0.002; return {i, lo:lo.map(v=>v+sh), hi:hi.map(v=>v-sh)}; };
    const B=frame.map(box).filter(b=>b.lo.every((v,k)=>v<b.hi[k]));
    const G=0.03, grid=new Map(), cell=p=>p.map(v=>Math.floor(v/G));
    for(const b of B){ const a=cell(b.lo), c=cell(b.hi);
      for(let x=a[0];x<=c[0];x++) for(let y=a[1];y<=c[1];y++) for(let z=a[2];z<=c[2];z++){ const k=x+","+y+","+z; if(!grid.has(k)) grid.set(k,[]); grid.get(k).push(b); } }
    // inside a part: inside its box, then inside its convex hull by 2 mm (a big plate's box is mostly air)
    const planes=new Map(), planesOf=i=>{
      if(planes.has(i)) return planes.get(i);
      const P=S[i].pts.length>400?thinPoints(S[i].pts,400):S[i].pts, H=convexHull(P); let L=null;
      if(H) L=H.faces.map(([a,b,c])=>{ const n=cross(sub(P[b],P[a]),sub(P[c],P[a])), l=Math.hypot(n[0],n[1],n[2]); return l>1e-12?{n:mul(n,1/l), d:dot(n,P[a])/l}:null; }).filter(Boolean);
      planes.set(i,L); return L; };
    const inHull=(i,p)=>{ const L=planesOf(i); if(!L) return true; for(const f of L) if(dot(f.n,p)-f.d>-0.002) return false; return true; };
    const hit=p=>{ const k=cell(p).join(","), L=grid.get(k); if(!L) return null;
      for(const b of L) if(p[0]>b.lo[0]&&p[0]<b.hi[0]&&p[1]>b.lo[1]&&p[1]<b.hi[1]&&p[2]>b.lo[2]&&p[2]<b.hi[2]&&inHull(b.i,p)) return b.i; return null; };
    // sample points of each moving part (a hull's points, thinned)
    const pts=new Map();
    S.forEach((s,i)=>{ if(!s.mech||!s.pts) return; const P=s.pts, st=Math.max(1,Math.floor(P.length/40)); const q=[]; for(let k=0;k<P.length;k+=st) q.push(P[k]); pts.set(i,q); });
    const clear=new Map(); for(const [i,q] of pts) clear.set(i,q.map(p=>hit(p)==null));
    const depth=m=>{ let d=0, p=m.parent; while(p&&byId.has(p)&&d<20){ d++; p=byId.get(p).parent; } return d; };
    const order=mechs.slice().sort((a,b)=>depth(a)-depth(b));
    const T0=new Map();
    const pose=vals=>{ const T=new Map(); for(const m of order){ const par=m.parent&&T.get(m.parent)||ID, v=vals.get(m.id); T.set(m.id,compose(par,v?jointMove(m,v):ID)); } return T; };
    for(const m of mechs){
      if(m.couple||!driven.has(m.id)) continue;
      const lin=normJointKind(m.kind)==="linear", step=lin?0.04:12*DEG;
      // only the ways it can go from where it was drawn (a lift drawn at the bottom only goes up)
      const L=m.limits, lim=sg=>{ if(!L) return step; const e=sg>0?L[1]:L[0]; return e==null||!Number.isFinite(e)?step:Math.min(step,Math.max(0,sg*e)); };
      // and only as far as the team's own code sends a servo from where it was drawn
      const dv=devs.find(d=>d.name===driven.get(m.id)), servo=dv&&/servo/i.test(dv.type||"")&&!/crservo/i.test(dv.type||"");
      let used=null;
      if(servo&&Number.isFinite(m.restPos)&&typeof travelRange==="function"){ const r=travelRange(code,dv.name);
        if(r&&r.n>=1){ const k=(opts.servoDeg||300)*DEG*(m.dir||1), q1=(r.lo-m.restPos)*k, q2=(r.hi-m.restPos)*k; used=[Math.min(q1,q2,0),Math.max(q1,q2,0)]; } }
      const room=sg=>Math.min(lim(sg), used?Math.max(0,sg*used[sg>0?1:0]):step);
      const clashes=sg=>{
        const r=room(sg); if(r<step*0.25) return {n:0, tot:0, part:null, stop:true};
        const vals=jointValues(mechs,k=>k.id===m.id?sg*r:(k.couple?null:0));
        const T=pose(vals); let n=0, tot=0; const with_=new Map();
        for(const [i,q] of pts){ const Ti=T.get(S[i].mech); if(!Ti) continue; const cl=clear.get(i);
          q.forEach((p,k)=>{ if(!cl[k]) return; tot++; const f=hit(apply(Ti,p)); if(f!=null){ n++; with_.set(f,(with_.get(f)||0)+1); } }); }
        const worst=[...with_].sort((a,b)=>b[1]-a[1])[0];
        return {n, tot, part:worst?worst[0]:null};
      };
      const a=clashes(1), b=clashes(-1), bad=r=>r.n>=6;
      if(bad(a)&&bad(b)){
        const f=S[a.part!=null?a.part:b.part];
        out.push({key:"swing:"+m.id, sev:"fail", joint:m.id, device:driven.get(m.id), ask:"look",
          text:"\""+(m.label||m.id)+"\" can't move either way: its parts hit "+(f&&f.name?"\""+f.name+"\"":"the frame")+
            ". It probably has a frame part on it, or the wrong axis."});
      }else if(bad(a)||bad(b)){
        const f=S[(bad(a)?a:b).part];
        out.push({key:"swing:"+m.id, sev:"warn", joint:m.id, device:driven.get(m.id), ask:"look",
          text:"Moving \""+(m.label||m.id)+"\" one way pushes its parts into "+(f&&f.name?"\""+f.name+"\"":"the frame")+
            " straight away. Fine if that's a hard stop; if that part shouldn't move with it, take it off the joint."});
      }
    }
    return out;
  }
  /* The robot setup steps (src/app.js SetupUI) the robot itself already
     answers, so nobody is asked them: up from standing wheels or an exact
     import; the front axis from the way the wheels roll; the drive base from
     real wheels of a known kind; the joints when they are exact (Onshape,
     URDF, a joint spec) or every device the code moves already has one. */
  function setupAuto(cad,code,map){
    const out={up:false,front:false,drive:false,joints:false};
    if(!cad) return out;
    const exact=cad.source==="onshape"||cad.source==="urdf"||cad.source==="mjcf"||!!(cad.mates&&cad.mates.exact&&!cad.mates.auto);
    const F=cad.frame||{};
    let D=null; try{ D=driveFromCAD(cad,{}); }catch(e){ D=null; }
    const W=D&&D.wheels?D.wheels:[];
    out.up=exact||(Array.isArray(F.wheels)?F.wheels.length>=3:!!F.wheels)||/wheel/i.test(F.upWhy||"");
    out.front=W.length>=3&&typeof frontFromWheels==="function"&&!!frontFromWheels(cad);
    out.drive=W.length>=3&&!!D.kind&&D.kind!=="unknown"&&!W.some(w=>w.mirrored);
    const src=cad.mates&&cad.mates.source;
    if(exact||(src==="spec"&&!cad.mates.auto)) out.joints=true;
    else if(code){
      const acts=(code.devices||[]).filter(d=>/servo|dcmotor/i.test(d.type||"")&&!isDriveDevice(d));
      const moved=acts.filter(d=>typeof isCommanded!=="function"||isCommanded(code,d.name));
      out.joints=moved.length>0&&moved.every(d=>map&&map[d.name]);
    }
    return out;
  }
  return {checkRobot, setupAuto};
})();
