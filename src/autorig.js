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
    const joints=[], seeds={}, extra={};
    for(const j of SL.joints||[]){
      joints.push({id:j.id, kind:"linear", axis:j.axis, pivot:j.pivot, parent:"chassis", couple:j.couple});
      seeds[j.id]=j.parts.slice();
      extra[j.id]={label:j.stage===j.stages-1?"Slide "+j.id.replace(/\D+/g,""):"Slide "+j.id.replace(/^slide(\d+).*/,"$1")+", stage "+j.stage,
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
    }
    const spool=acts.filter(A=>A.role==="unloaded"&&A.kind==="motor").length;
    if(spool&&(SL.joints||[]).length)
      review.push((spool===1?"A motor":spool+" motors")+" with nothing modelled on the shaft "+(spool===1?"sits":"sit")+" near the slides: probably driving them through a spool. Map "+(spool===1?"it":"them")+" to the slide in the hardware table.");
    if(!joints.length) return {spec:null, review:["No joints found: no slide stacks, and no servo or motor turning anything."], actuators:acts.length};
    // 3. rigid bodies: the contact graph with every known joint cut (an
    // actuator's output from its body, one slide stage from the next); what
    // stays connected moves as one
    const G=ARCarry.contactGraph(cad), n=S.length;
    const par=[...Array(n).keys()], find=i=>{ while(par[i]!==i){ par[i]=par[par[i]]; i=par[i]; } return i; };
    const cut=new Set(), key=(a,b)=>a<b?a+","+b:b+","+a;
    for(const j of joints){ const x=extra[j.id]; if(!x.body) continue;
      for(const a of seeds[j.id]) for(const b of x.body) cut.add(key(a,b)); }
    const link=Array.from({length:n},()=>[]);
    const stageOf=new Map();
    (SL.mechanisms||[]).forEach((m,mi)=>m.stages.forEach((g,k)=>{ for(const i of g.rails.concat(g.blocks||[],g.hw||[])) stageOf.set(i,mi+":"+k); }));
    // a contact on a joint's axis line (a shaft in a bearing, a hub on a spline) is where it turns
    const onAxis=[];
    for(const j of joints){ if(j.kind==="linear") continue; onAxis.push({p:j.pivot, a:j.axis}); }
    const nearAxis=c=>onAxis.some(J=>{ const d=[c[0]-J.p[0],c[1]-J.p[1],c[2]-J.p[2]], t=dot(d,J.a);
      if(Math.abs(t)>0.09) return false; const r=[d[0]-J.a[0]*t,d[1]-J.a[1]*t,d[2]-J.a[2]*t]; return Math.hypot(r[0],r[1],r[2])<0.009; });
    for(const e of G.edges){
      if(cut.has(key(e.a,e.b))||nearAxis(e.c)||(opts.strongOnly===true&&!e.strong)) continue;
      const sa=stageOf.get(e.a), sb=stageOf.get(e.b);
      if(sa!=null&&sb!=null&&sa!==sb) continue;
      par[find(e.a)]=find(e.b); link[e.a].push(e.b); link[e.b].push(e.a);
    }
    // a part touching nothing (drawn with a gap) rides whatever it's nearest to
    const cnt=new Map(); for(let i=0;i<n;i++){ const r=find(i); cnt.set(r,(cnt.get(r)||0)+1); }
    const gap=(a,b)=>{ const A=G.box[a], B=G.box[b]; let d=0; for(let k=0;k<3;k++){ const g=Math.max(0,A.mn[k]-B.mx[k],B.mn[k]-A.mx[k]); d+=g*g; } return Math.sqrt(d); };
    for(let i=0;i<n;i++){ if(cnt.get(find(i))!==1) continue;
      let best=-1, bd=0.006; for(let k=0;k<n;k++){ if(k===i||cnt.get(find(k))===1||cut.has(key(i,k))) continue; const d=gap(i,k); if(d<bd){ bd=d; best=k; } }
      if(best>=0) par[find(i)]=find(best); }
    const comp=i=>find(i), compOf=idx=>majority(idx.map(comp),idx.map((_,k)=>k));
    // the frame: the body the drive motors are bolted to, else the biggest
    const size=new Map(); for(let i=0;i<n;i++) size.set(comp(i),(size.get(comp(i))||0)+1);
    const drv=acts.filter(A=>A.drive).flatMap(A=>(A.body||[]).concat(A.mounts||[]));
    const frame=drv.length?+majority(drv.map(comp),drv.map((_,k)=>k)):[...size].sort((a,b)=>b[1]-a[1])[0][0];
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
      const x=extra[j.id], base=x.body&&x.body.length?x.body:x.fixed&&x.fixed.length?x.fixed:[];
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
        if(j.couple) o.follows={joint:j.couple.to, ratio:j.couple.ratio};
        return o;
      }), review};
    const moved=final.label.filter(l=>l!=null).length;
    if(opts.debug) opts.debug({comp:[...Array(n).keys()].map(comp), frame, extra, G, label});
    return {spec, review, actuators:acts.length, slides:(SL.mechanisms||[]).length, moved, ms:final.ms};
  }
  return {autoRig};
})();
