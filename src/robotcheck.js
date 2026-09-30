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
   Each item: {key, sev: "ok"|"warn"|"fail", text, device?, joint?, ask?}.
   ask says what to ask the team: "pick-parts" (click what this device
   moves), "drop-joint", "pick-device" (which of your devices drives it),
   "mates" (exact joints from Onshape), "look" (show it in the CAD view).
   ============================================================ */
const {checkRobot}=(function(){
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
  const sevRank={fail:0,warn:1,ok:2};

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
    if(src==="onshape") put({key:"source", sev:"ok", text:"Joints come from your Onshape mates, so axes, pivots and parts are exact."});
    else if(src==="spec"&&!(cad.mates.auto)) put({key:"source", sev:"ok", text:"Joints come from a joint spec"+(cad.mates.name?" ("+cad.mates.name+")":"")+"."});
    else put({key:"source", sev:"warn", ask:"mates", text:(src==="spec"?"Joints were found from the geometry":"Joints are guessed from the assembly")+
      ". Your Onshape mates would make them exact; otherwise confirm the ones below."});

    // every device the code moves
    const driven=new Map();                          // joint id -> device
    for(const d of acts){
      const j=map&&map[d.name]&&byId.get(map[d.name]);
      if(j){ driven.set(j.id,d.name); put({key:"dev:"+d.name, sev:"ok", device:d.name, joint:j.id, ask:"look", text:d.name+" drives \""+label(j)+"\"."}); continue; }
      if(!moved(d.name)) continue;
      put({key:"dev:"+d.name, sev:"fail", device:d.name, ask:"pick-parts",
        text:"Your code moves "+d.name+", but no joint in the CAD is tied to it. Click the part "+d.name+" moves."});
    }

    // every joint
    const own=new Map(mechs.map(m=>[m.id,0]));
    for(const s of S) if(s.mech&&own.has(s.mech)) own.set(s.mech,own.get(s.mech)+1);
    const kids=id=>mechs.filter(k=>k.parent===id);
    const carries=m=>own.get(m.id)>0||kids(m.id).some(carries);
    for(const m of mechs){
      if(!carries(m)){ put({key:"empty:"+m.id, sev:"fail", joint:m.id, ask:"drop-joint", text:"\""+label(m)+"\" moves no parts. Remove it, or give it the parts it carries."}); continue; }
      if(m.couple){
        const to=byId.get(m.couple.to);
        if(!to) put({key:"follow:"+m.id, sev:"fail", joint:m.id, ask:"drop-joint", text:"\""+label(m)+"\" follows \""+m.couple.to+"\", which isn't a joint."});
        continue;
      }
      if(!driven.has(m.id)&&acts.length) put({key:"undriven:"+m.id, sev:"warn", joint:m.id, ask:"pick-device",
        text:"Nothing in your code drives \""+label(m)+"\". Which of your devices moves it, or is it not a joint?"});
    }

    // the likely answers: a device the code moves and the joints nothing drives, paired by kind
    // (a servo turns something; a motor turns an arm or pulls a slide through a spool)
    const free=mechs.filter(m=>!m.couple&&!driven.has(m.id)&&carries(m));
    const fits=(d,m)=>{ const lin=normJointKind(m.kind)==="linear", sv=/servo/i.test(d.type||""), l=(m.label||m.id).toLowerCase();
      if(sv) return lin?0:(/servo/.test(l)?3:2);
      return lin?3:(/motor/.test(l)?3:1); };
    for(const it of items) if(it.ask==="pick-parts"&&it.device){
      const d=acts.find(x=>x.name===it.device);
      it.candidates=free.map(m=>({joint:m.id, label:label(m), v:fits(d,m)})).filter(c=>c.v>0).sort((a,b)=>b.v-a.v).slice(0,6).map(({joint,label})=>({joint,label}));
      if(it.candidates.length) it.text="Your code moves "+it.device+", but no joint is tied to it. Which one is it? Or click the part "+it.device+" moves.";
    }
    const loose=items.filter(i=>i.ask==="pick-parts").map(i=>acts.find(x=>x.name===i.device)).filter(Boolean);
    for(const it of items) if(it.ask==="pick-device"){
      const m=byId.get(it.joint);
      it.candidates=loose.map(d=>({device:d.name, v:fits(d,m)})).filter(c=>c.v>0).sort((a,b)=>b.v-a.v).map(c=>({device:c.device}));
    }

    // the drivetrain
    let wheels=0; try{ wheels=(driveFromCAD(cad,{}).wheels||[]).length; }catch(e){}
    if(drives.length&&!wheels) put({key:"drive", sev:"fail", text:"Your code drives "+drives.length+" wheel motors ("+drives.map(d=>d.name).join(", ")+"), but the CAD has no wheels on the floor."});
    else if(drives.length&&wheels&&drives.length!==wheels&&!(drives.length===2&&wheels>=4))
      put({key:"drive", sev:"warn", text:"Your code has "+drives.length+" drive motors and the CAD "+wheels+" drive wheels. Check the drivetrain."});
    else if(drives.length) put({key:"drive", sev:"ok", text:drives.length+" drive motors and "+wheels+" wheels."});

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
  return {checkRobot};
})();
