/* ============================================================
   AUTORIG — a robot's joints, found from its STEP file alone
   No Onshape mates and no joint spec? Find them from the geometry, with
   the three pieces research/autorig built and measured (src/autorig-lib.js):
     1. slides    telescoping slide stacks: stages, fixed stage, direction
     2. actuators every servo and motor output: axis, pivot, what's on it,
                  and the gears it meshes with
     3. carry     which parts ride each joint, from a contact graph cut at
                  each joint
   Each actuator that turns something becomes a revolute joint; a gear it
   meshes with becomes a follower; each moving slide stage a slider, the
   middle ones following the carriage. What each joint hangs from comes
   from where its actuator's body ends up: carry is run once with every
   joint on the frame, then again with the parents that gives.
   The result is a joint spec (src/jointspec.js), the same format the joint
   editor changes, with a list of what a person should check.
   ============================================================ */
const {autoRig}=(function(){
  const round=v=>v.map(x=>+x.toFixed(4)), mm=v=>v.map(x=>+(x*1000).toFixed(1));
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  function majority(labels,idx){
    const n={}; for(const i of idx){ const l=labels[i]==null?"chassis":labels[i]; n[l]=(n[l]||0)+1; }
    let best="chassis", bn=0; for(const k in n) if(n[k]>bn){ best=k; bn=n[k]; }
    return best;
  }
  function autoRig(cad,opts){
    opts=opts||{};
    const S=(cad&&cad.solids)||[], review=[];
    if(!S.length) return null;
    // 1. slides
    let SL={joints:[], mechanisms:[]};
    try{ SL=ARSlides.findSlides(cad,{nested:"rigid"}); }catch(e){ review.push("The slide finder stopped: "+e.message); }
    // 2. actuators
    let AC={actuators:[]};
    try{ AC=ARActuators.findActuators(cad,{driveFromCAD:c=>driveFromCAD(c,{front:opts.front}), hwFromPart}); }
    catch(e){ review.push("The actuator finder stopped: "+e.message); }
    const joints=[], seeds={}, extra={}, belts=new Set();
    for(const j of SL.joints||[]){
      joints.push({id:j.id, kind:"linear", axis:j.axis, pivot:j.pivot, parent:"chassis", couple:j.couple, mech:(SL.mechanisms||[]).findIndex(m=>m.jointIds.includes(j.id))});
      seeds[j.id]=j.parts.slice();
      extra[j.id]={label:j.carriage?"Carriage "+j.id.replace(/\D+/g,""):j.stage===j.stages-1?"Slide "+j.id.replace(/\D+/g,""):"Slide "+j.id.replace(/^slide(\d+).*/,"$1")+", stage "+j.stage,
        limits:j.limits?[0,+(j.limits[1]*1000).toFixed(0)]:null, fixed:(SL.mechanisms.find(m=>m.jointIds.includes(j.id))||{stages:[{rails:[]}]}).stages[0].rails};
    }
    const acts=(AC.actuators||[]);
    let na=0;
    for(const A of acts){
      if(A.role!=="joint") continue;
      const id=(A.kind==="servo"?"servo ":"motor ")+(++na);
      joints.push({id, kind:"revolute-lift", axis:A.axis, pivot:A.pivot.map(v=>v/1000), parent:"chassis", couple:null});
      seeds[id]=[...new Set((A.output||[]).concat(A.attached||[]))];
      extra[id]={label:(A.kind==="servo"?"Servo ":"Motor ")+na, part:A.part||A.partGuess||null, body:(A.body||[]).concat(A.mounts||[])};
      if(A.ambiguous) review.push("\""+extra[id].label+"\": which end of the servo is its output isn't certain. Check its axis in the CAD view.");
      if(A.shapeOnly) review.push("\""+extra[id].label+"\" was found from its shape alone (no name or part number says what it is).");
      // a gear it meshes with turns the other way, at the ratio of their sizes
      for(const M of A.meshes||[]){
        const gid=id+" gear", ax=dot(M.withAxis,A.axis)<0?M.withAxis.map(v=>-v):M.withAxis;
        joints.push({id:gid, kind:"revolute-lift", axis:ax, pivot:M.withCentre.map(v=>v/1000), parent:"chassis", couple:{to:id, ratio:M.ratio}});
        seeds[gid]=[M.with]; extra[gid]={label:extra[id].label+", geared", body:extra[id].body};
      }
      // a pulley at the far end of a belt or chain turns the same way, at the ratio of their sizes
      (A.belts||[]).forEach((B,k)=>{
        const bid=id+" belt"+(A.belts.length>1?" "+(k+1):""), ax=dot(B.withAxis,A.axis)<0?B.withAxis.map(v=>-v):B.withAxis;
        joints.push({id:bid, kind:"revolute-lift", axis:ax, pivot:B.withCentre.map(v=>v/1000), parent:"chassis", couple:{to:id, ratio:B.ratio}});
        seeds[bid]=[B.with]; extra[bid]={label:extra[id].label+", belt", body:extra[id].body};
        belts.add(B.belt);
        if(!B.named) review.push("\""+extra[bid].label+"\": a belt or chain was found from its shape alone. Check its ratio ("+B.ratio+").");
      });
    }
    const spool=acts.filter(A=>A.role==="unloaded"&&A.kind==="motor").length;
    if(spool&&(SL.joints||[]).length)
      review.push((spool===1?"A motor":spool+" motors")+" with nothing modelled on the shaft "+(spool===1?"sits":"sit")+" near the slides: probably driving them through a spool. Map "+(spool===1?"it":"them")+" to the slide in the hardware table.");
    if(!joints.length) return {spec:null, review:["No joints found: no slide stacks, and no servo or motor turning anything."], actuators:acts.length};
    // 3. rigid bodies: the contact graph with every known joint cut (an
    // actuator's output from its body, one slide stage from the next); what
    // stays connected moves as one
    const G=ARCarry.contactGraph(cad), n=S.length;
    // a slide stage's hardware bolted to the fixed stage too (a bottom block the
    // retracted stage rests on) stays with the frame: only the moving rail says so
    const allRails=new Set(); for(const m of SL.mechanisms||[]) for(const g of m.stages) for(const i of g.rails) allRails.add(i);
    const onFixed=new Map(), allStaged=new Set(), allSeeds=new Set(); for(const j of joints) for(const i of seeds[j.id]) allSeeds.add(i);
    for(const m of SL.mechanisms||[]) for(const g of m.stages) for(const i of g.rails.concat(g.blocks||[],g.hw||[])) allStaged.add(i);
    for(const j of joints){ if(j.kind!=="linear") continue; const fx=new Set(extra[j.id].fixed||[]); if(!fx.size) continue;
      // held: touches the fixed rail and the frame beyond the slide (a block's rollers ride the fixed rail, but only that)
      const onRail=new Set(), onFrame=new Set();
      for(const e of G.edges) if(e.strong) for(const [u,v] of [[e.a,e.b],[e.b,e.a]]){ if(allRails.has(u)) continue;
        if(fx.has(v)) onRail.add(u); else if(!allStaged.has(v)&&!allSeeds.has(v)) onFrame.add(u); }
      const held=new Set([...onRail].filter(i=>onFrame.has(i)));
      const keep=seeds[j.id].filter(i=>!held.has(i)); if(keep.length<seeds[j.id].length&&keep.length){ seeds[j.id].filter(i=>held.has(i)).forEach(i=>onFixed.set(i,j.mech)); seeds[j.id]=keep; } }
    const par=[...Array(n).keys()], find=i=>{ while(par[i]!==i){ par[i]=par[par[i]]; i=par[i]; } return i; };
    const cut=new Set(), key=(a,b)=>a<b?a+","+b:b+","+a;
    for(const j of joints){ const x=extra[j.id]; if(!x.body) continue;
      for(const a of seeds[j.id]) for(const b of x.body) cut.add(key(a,b)); }
    // a belt or chain loop moves with neither pulley: it stays off every body
    for(const e of G.edges) if(belts.has(e.a)||belts.has(e.b)) cut.add(key(e.a,e.b));
    const link=Array.from({length:n},()=>[]);
    const stageOf=new Map();
    (SL.mechanisms||[]).forEach((m,mi)=>m.stages.forEach((g,k)=>{ for(const i of g.rails.concat(g.blocks||[],g.hw||[])) stageOf.set(i,mi+":"+k); }));
    for(const [i,mi] of onFixed) stageOf.set(i,mi+":0");
    // a contact on a joint's axis line (a shaft in a bearing, a hub on a spline)
    // is where it turns, unless both parts are that joint's own output (a hub
    // bolted face to face to its arm sits on the axis too, and doesn't turn)
    const onAxis=[];
    // (along the axis: 90 mm either side of the pivot, or as far as the output reaches, a long roller shaft)
    for(const j of joints){ if(j.kind==="linear") continue;
      let t0=-0.09, t1=0.09;
      for(const i of seeds[j.id]){ const B=G.box[i]; for(let k=0;k<8;k++){ const q=[k&1?B.mx[0]:B.mn[0],k&2?B.mx[1]:B.mn[1],k&4?B.mx[2]:B.mn[2]];
        const t=dot([q[0]-j.pivot[0],q[1]-j.pivot[1],q[2]-j.pivot[2]],j.axis); t0=Math.min(t0,t-0.01); t1=Math.max(t1,t+0.01); } }
      onAxis.push({p:j.pivot, a:j.axis, out:new Set(seeds[j.id]), t0, t1}); }
    const nearAxis=(c,a,b)=>onAxis.some(J=>{ if(J.out.has(a)&&J.out.has(b)) return false;
      const d=[c[0]-J.p[0],c[1]-J.p[1],c[2]-J.p[2]], t=dot(d,J.a);
      if(t<J.t0||t>J.t1) return false; const r=[d[0]-J.a[0]*t,d[1]-J.a[1]*t,d[2]-J.a[2]*t]; return Math.hypot(r[0],r[1],r[2])<0.009; });
    const joins=e=>{ if(cut.has(key(e.a,e.b))||nearAxis(e.c,e.a,e.b)||(opts.strongOnly===true&&!e.strong)) return false;
      const sa=stageOf.get(e.a), sb=stageOf.get(e.b); return !(sa!=null&&sb!=null&&sa!==sb); };
    /* Passive pivots. A driven joint whose output reaches back round to its
       own case closes a loop: a linkage, turning on pins nothing drives. A
       pin is a thin round part parallel to the joint's axis; the parts it
       passes through are cut apart where they meet around it. Only loops get
       this: a single bolt elsewhere may just as well hold a bracket rigid. */
    const loops=[];
    {
      const uf=()=>{ const p=[...Array(n).keys()], f=i=>{ while(p[i]!==i){ p[i]=p[p[i]]; i=p[i]; } return i; }; return {p,f}; };
      const U0=uf(); for(const e of G.edges) if(joins(e)) U0.p[U0.f(e.a)]=U0.f(e.b);
      const taken=new Set(); for(const j of joints){ for(const i of seeds[j.id]) taken.add(i); for(const i of extra[j.id].body||[]) taken.add(i); }
      for(const j of joints){
        const x=extra[j.id]; if(j.kind==="linear"||j.couple||!x.body||!x.body.length||!seeds[j.id].length) continue;
        const loop=U0.f(seeds[j.id][0]); if(!x.body.some(b=>U0.f(b)===loop)) continue;
        const a=j.axis, pins=[];
        for(let i=0;i<n;i++){
          if(U0.f(i)!==loop||taken.has(i)||allRails.has(i)) continue;
          const P=S[i].pts; if(!P||P.length<4) continue;
          let t0=Infinity, t1=-Infinity; const c=[0,0,0]; for(const q of P){ const t=dot(q,a); t0=Math.min(t0,t); t1=Math.max(t1,t); c[0]+=q[0]; c[1]+=q[1]; c[2]+=q[2]; }
          for(let k=0;k<3;k++) c[k]/=P.length;
          let r=0; for(const q of P){ const d=[q[0]-c[0],q[1]-c[1],q[2]-c[2]], t=dot(d,a); r=Math.max(r,Math.hypot(d[0]-a[0]*t,d[1]-a[1]*t,d[2]-a[2]*t)); }
          if(r>0.009||t1-t0<2*r||t1-t0>0.15) continue;
          // not on the joint's own axis (that is its shaft)
          const v=[c[0]-j.pivot[0],c[1]-j.pivot[1],c[2]-j.pivot[2]], tv=dot(v,a);
          if(Math.hypot(v[0]-a[0]*tv,v[1]-a[1]*tv,v[2]-a[2]*tv)<0.012) continue;
          const on=new Set(); for(const e of G.edges){ if(e.a===i) on.add(e.b); else if(e.b===i) on.add(e.a); }
          const members=[...on].filter(k=>!taken.has(k)||seeds[j.id].includes(k)||x.body.includes(k));
          if(members.length<2) continue;
          const near=e=>{ const d=[e.c[0]-c[0],e.c[1]-c[1],e.c[2]-c[2]], t=dot(d,a); return Math.hypot(d[0]-a[0]*t,d[1]-a[1]*t,d[2]-a[2]*t)<0.015; };
          const cuts=new Set();
          for(const e of G.edges){
            if(e.a===i||e.b===i) cuts.add(key(e.a,e.b));
            else if(members.includes(e.a)&&members.includes(e.b)&&near(e)) cuts.add(key(e.a,e.b));
          }
          pins.push({i, c, a, members, cuts});
        }
        // cut at every candidate pin: is it a crank, a coupler, a rocker and the case's side?
        const U=uf(); for(const e of G.edges) if(joins(e)&&!pins.some(p=>p.cuts.has(key(e.a,e.b)))) U.p[U.f(e.a)]=U.f(e.b);
        // the case's side: the body and what holds it (the case alone may sit apart, on its own axis)
        const K=U.f(seeds[j.id][0]), Fs=new Set(x.body.map(U.f)); Fs.delete(K);
        const P=pins.map(p=>({...p, comps:[...new Set(p.members.map(U.f))]})), has=(p,u)=>p.comps.includes(u);
        let found=null;
        for(const pB of P){ if(found||!has(pB,K)) continue;
          for(const X of pB.comps){ if(found||X===K||Fs.has(X)) continue;
            for(const pC of P){ if(found||pC===pB||!has(pC,X)) continue;
              for(const Y of pC.comps){ if(found||Y===K||Fs.has(Y)||Y===X) continue;
                const pD=P.find(p=>p!==pB&&p!==pC&&has(p,Y)&&p.comps.some(c=>Fs.has(c)));
                if(pD) found={pB,pC,pD,xPart:pB.members.find(m=>U.f(m)===X),yPart:pC.members.find(m=>U.f(m)===Y)}; } } } }
        if(!found){ review.push("\""+x.label+"\" closes a loop back to its own case (a linkage, or parts drawn touching). Check it in the CAD view."); continue; }
        for(const p of [found.pB,found.pC,found.pD]) for(const k of p.cuts) cut.add(k);
        loops.push({j, ...found});
      }
    }
    for(const e of G.edges){
      if(!joins(e)) continue;
      par[find(e.a)]=find(e.b); link[e.a].push(e.b); link[e.b].push(e.a);
    }
    // a part touching nothing (drawn with a gap) rides whatever it's nearest to
    const cnt=new Map(); for(let i=0;i<n;i++){ const r=find(i); cnt.set(r,(cnt.get(r)||0)+1); }
    const gap=(a,b)=>{ const A=G.box[a], B=G.box[b]; let d=0; for(let k=0;k<3;k++){ const g=Math.max(0,A.mn[k]-B.mx[k],B.mn[k]-A.mx[k]); d+=g*g; } return Math.sqrt(d); };
    for(let i=0;i<n;i++){ if(cnt.get(find(i))!==1||belts.has(i)) continue;
      let best=-1, bd=0.006; for(let k=0;k<n;k++){ if(k===i||cnt.get(find(k))===1||cut.has(key(i,k))) continue; const d=gap(i,k); if(d<bd){ bd=d; best=k; } }
      if(best>=0) par[find(i)]=find(best); }
    const comp=i=>find(i), compOf=idx=>majority(idx.map(comp),idx.map((_,k)=>k));
    // the frame: the body the drive motors are bolted to, else the biggest
    const size=new Map(); for(let i=0;i<n;i++) size.set(comp(i),(size.get(comp(i))||0)+1);
    const drv=acts.filter(A=>A.drive).flatMap(A=>(A.body||[]).concat(A.mounts||[]));
    const frame=drv.length?+majority(drv.map(comp),drv.map((_,k)=>k)):[...size].sort((a,b)=>b[1]-a[1])[0][0];
    /* A four-bar: the crank's body, a pin to the coupler, a pin to the rocker,
       a pin to the case's side. The rocker and the coupler follow the crank. */
    const fourBars=[];
    for(const L of loops){
      const j=L.j, x=extra[j.id];
      const onPlane=p=>{ const t=dot([j.pivot[0]-p.c[0],j.pivot[1]-p.c[1],j.pivot[2]-p.c[2]],p.a); return [p.c[0]+p.a[0]*t,p.c[1]+p.a[1]*t,p.c[2]+p.a[2]*t]; };
      const B=onPlane(L.pB), C=onPlane(L.pC), D=onPlane(L.pD);
      const members=c=>{ const o=[]; for(let i=0;i<n;i++) if(comp(i)===c) o.push(i); return o; };
      for(const [role,piv,part] of [["coupler",B,L.xPart],["rocker",D,L.yPart]]){
        const id=j.id+" "+role;
        joints.push({id, kind:"revolute-lift", axis:j.axis.slice(), pivot:piv, parent:role==="coupler"?j.id:"chassis",
          couple:{to:j.id, linkage:"four-bar", crankPin:B, pin:C, ground:D, role}});
        seeds[id]=members(comp(part)); extra[id]={label:x.label+", four-bar "+role, body:role==="rocker"?x.body:null, parentFixed:role==="coupler"?j.id:null};
      }
      fourBars.push(x.label);
    }
    if(fourBars.length) review.push("Four-bar linkages found from their pins: "+fourBars.map(l=>"\""+l+"\"").join(", ")+". Check they swing the right way.");
    // each joint owns the body its output is in. A body several joints claim
    // (a linkage closing a loop, an output drawn touching its own case) is
    // shared out by growing from each joint's output at once; a joint never
    // takes its own actuator's case, which rides the joint below it
    const label=new Array(n).fill(null), claim=new Map();
    for(const j of joints){ const c=+compOf(seeds[j.id].length?seeds[j.id]:[0]); if(c===frame) continue;
      if(!claim.has(c)) claim.set(c,[]); claim.get(c).push(j); }
    const bodyOf={}; for(const j of joints) bodyOf[j.id]=new Set(extra[j.id].body||[]);
    const shared=[];
    for(const [c,js] of claim){
      if(js.length===1){ for(let i=0;i<n;i++) if(comp(i)===c) label[i]=js[0].id; continue; }
      shared.push(js.map(j=>j.id));
      const q=[]; for(const j of js) for(const i of seeds[j.id]){ label[i]=j.id; q.push(i); }
      for(let h=0;h<q.length;h++){ const i=q[h], l=label[i];
        for(const k of link[i]) if(label[k]==null&&!bodyOf[l].has(k)){ label[k]=l; q.push(k); } }
      // what the flood couldn't give out (only reachable through a case) goes to a claimant that may have it
      for(let i=0;i<n;i++) if(comp(i)===c&&label[i]==null){ const j=js.find(x=>!bodyOf[x.id].has(i)); if(j) label[i]=j.id; }
    }
    if(shared.length) review.push("Joints sharing one rigid body were split by what's nearest each one's output: "+
      shared.map(g=>g.map(id=>"\""+extra[id].label+"\"").join(" / ")).join("; ")+". Check those in the CAD view.");
    for(const j of joints) for(const i of seeds[j.id]) label[i]=j.id;     // a joint's own output is always its
    // parents: the joint most of a joint's own case (or fixed stage) rides
    for(const j of joints){
      const x=extra[j.id]; if(x.parentFixed){ j.parent=x.parentFixed; continue; }
      const base=x.body&&x.body.length?x.body:x.fixed&&x.fixed.length?x.fixed:[];
      const p=base.length?majority(label,base):"chassis";
      j.parent=p&&p!==j.id&&p!=="chassis"?p:"chassis";
    }
    for(const j of joints){ const seen=new Set([j.id]); let p=j.parent;
      while(p&&p!=="chassis"){ if(seen.has(p)){ j.parent="chassis"; break; } seen.add(p); p=(joints.find(k=>k.id===p)||{}).parent; } }
    const final={label, members:{}};
    for(const j of joints) final.members[j.id]=[];
    label.forEach((l,i)=>{ if(l) final.members[l].push(i); });
    const spec={format:JOINT_SPEC_FORMAT, version:1, robot:(cad.name||"this robot")+" (found automatically)", solids:S.length, auto:true,
      about:"Found from the STEP file's geometry by src/autorig.js. Check each joint in the CAD view; fix anything with the joint editor.",
      joints:joints.map(j=>{
        const x=extra[j.id], o={id:j.id, label:x.label, kind:j.kind==="linear"?"slider":"revolute", axis:round(j.axis), pivot:mm(j.pivot),
          parts:[{solid:(final.members[j.id]||[]).slice()}]};
        if(j.parent!=="chassis") o.parent=j.parent;
        if(x.part) o.part=x.part;
        if(x.limits) o.limits=x.limits;
        if(j.couple&&j.couple.linkage) o.follows={joint:j.couple.to, linkage:j.couple.linkage, crankPin:mm(j.couple.crankPin), pin:mm(j.couple.pin), ground:mm(j.couple.ground), role:j.couple.role};
        else if(j.couple) o.follows={joint:j.couple.to, ratio:j.couple.ratio};
        return o;
      }), review};
    const moved=final.label.filter(l=>l!=null).length;
    if(opts.debug) opts.debug({comp:[...Array(n).keys()].map(comp), frame, extra, G, label});
    return {spec, review, actuators:acts.length, slides:(SL.mechanisms||[]).length, moved, ms:final.ms};
  }
  return {autoRig};
})();
