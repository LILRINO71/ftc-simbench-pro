/* ============================================================
   AUTO GRADER — what a drawn path will and won't do, in a list
   ------------------------------------------------------------
   gradePath(P, o) takes a path from the path editor (src/pedrogen.js) and
   says, in plain words, one line per question, each pass, warn or fail:
     field       the robot stays inside the walls the whole way
     structures  it doesn't run into the HIVEs, their feet or a FLOWER
     start       a legal starting place for the season: on its own side,
                 against its alliance wall, facing the field, clear of the
                 LOADING ZONE and the FLOWER, inside the start cube
     time        how long the drive takes against the 30 s autonomous period
     points      what the drive alone earns under this app's own scoring model
                 (src/match.js: leaving the wall, parking in the LOADING ZONE).
                 TIPs, CELLs and FLOWERs depend on the mechanism, which a path
                 doesn't describe: those are "not estimated", never a guess.
     risks       tight bends at speed, passing close to a wall or a structure
   It is deterministic: the same path and robot always give the same list.

   The numbers: the field and the HIVE come from the field data the app
   already loads (o.field, o.obs; src/field.js). The start rules are what
   src/field.js startPose encodes (G304) plus the start cube; the 18 in cube
   is the season book's figure and every line that rests on a rule says
   "check the current manual", because Team Updates change them.
   The drive time is a model, not a measurement: each leg is driven from rest
   to rest (the generated OpMode waits for each leg to finish) with a
   trapezoid speed profile at o.vmax and o.acc, turning at o.turn, plus the
   waits. The defaults are the Typical AI skill in src/match.js.

   Pure, tested in Node. Needs pedrogen.js (the path maths).
   ============================================================ */
const GRADER_DEFAULTS={vmax:1.2, acc:2.6, turn:3.2, autoSec:30, half:70.5, cubeIn:18, wallNearIn:2, nearIn:2};
const GRADER_RULE=" (check the current manual)";

const {gradePath}=(function(){
  const IN_M=0.0254, RAD=Math.PI/180;
  const wrap=a=>{ while(a>Math.PI) a-=2*Math.PI; while(a<-Math.PI) a+=2*Math.PI; return a; };
  const r1=v=>Math.round(v*10)/10;

  /* The pose along a leg, s in [0, 1] by path fraction: Pedro inches, heading radians.
     Linear turns steadily start to end; constant holds the leg's end heading; tangent
     faces the way it's going (backwards when the leg is driven reversed). */
  function legPose(pts,L,h0,s){
    const p=bezierAt(pts,s);
    let h;
    if(L.heading==="constant") h=(L.to.h||0)*RAD;
    else if(L.heading==="tangent"){
      const a=bezierAt(pts,Math.max(0,s-0.01)), b=bezierAt(pts,Math.min(1,s+0.01));
      h=(Math.hypot(b[0]-a[0],b[1]-a[1])>1e-9?Math.atan2(b[1]-a[1],b[0]-a[0]):h0)+(L.reversed?Math.PI:0);
    }else h=h0+wrap((L.to.h||0)*RAD-h0)*s;
    return {x:p[0], y:p[1], h};
  }
  /* Curvature (1/in) of a Bezier at s, from its first two derivatives. */
  function curvature(pts,s){
    const d=1e-3, a=bezierAt(pts,Math.max(0,s-d)), b=bezierAt(pts,s), c=bezierAt(pts,Math.min(1,s+d));
    const h=Math.min(d,s,1-s)||d;
    const v=[(c[0]-a[0])/(2*h),(c[1]-a[1])/(2*h)], w=[(c[0]-2*b[0]+a[0])/(h*h),(c[1]-2*b[1]+a[1])/(h*h)];
    const sp=Math.hypot(v[0],v[1]); if(sp<1e-6) return 0;
    return Math.abs(v[0]*w[1]-v[1]*w[0])/(sp*sp*sp);
  }
  /* One leg driven from rest to rest: trapezoid speed up to vmax at acc, and no faster than the
     turn allows. Returns the seconds, and the fraction f of that time spent speeding up. */
  function legTime(len,dh,o){
    const vm=o.vmax, a=o.acc, m=len>0?len:0;                  // len in metres
    let td, f;
    if(m<=0) td=0;
    else if(m>=vm*vm/a){ td=m/vm+vm/a; f=(vm/a)/td; }
    else{ td=2*Math.sqrt(m/a); f=0.5; }
    const tw=Math.abs(dh)/o.turn, T=Math.max(td,tw);
    return {T, f:Math.min(0.5,f==null?0.5:f), td, tw};
  }
  /* path fraction reached at time fraction u of a leg whose speed-up is the fraction f */
  function progress(u,f){
    u=Math.max(0,Math.min(1,u)); if(f<=1e-9) return u;
    const k=1-f;                                       // area under the 0..1..0 profile
    if(u<f) return 0.5*u*u/f/k;
    if(u<=1-f) return (0.5*f+(u-f))/k;
    const w=1-u; return 1-0.5*w*w/f/k;
  }
  /* the footprint box of the robot standing at pose (field metres): centre, extent along x and y */
  function box(ch,fp){
    const c=Math.cos(ch.h), s=Math.sin(ch.h), ox=fp.ox||0, oy=fp.oy||0;
    const x=ch.x+ox*c-oy*s, y=ch.y+ox*s+oy*c, ac=Math.abs(c), as=Math.abs(s);
    return {x, y, ex:ac*fp.hx+as*fp.hy, ey:as*fp.hx+ac*fp.hy};
  }
  function hitsObs(ch,fp,obs){
    if(typeof capsulePush!=="function") return null;
    // capsulePush works in the box's own frame, so give it the box centre as the pose
    const c=Math.cos(ch.h), s=Math.sin(ch.h), cx=ch.x+(fp.ox||0)*c-(fp.oy||0)*s, cy=ch.y+(fp.ox||0)*s+(fp.oy||0)*c;
    for(const o of obs||[]) if(capsulePush({x:cx,y:cy,h:ch.h},fp,o)) return o;
    return null;
  }
  const field=p=>pedroToField({x:p.x,y:p.y,h:0});

  function gradePath(P,o){
    o=Object.assign({}, GRADER_DEFAULTS, o||{});
    const items=[], put=(key,sev,text)=>items.push({key, sev, text});
    if(!P||!Array.isArray(P.legs)||!P.legs.length){
      put("path","fail","The path has no legs."); return {items, pass:0, warn:0, fail:1, ok:false, time:null, points:null};
    }
    const fp=Object.assign({hx:0.2286, hy:0.2286, ox:0, oy:0}, o.fp||{}), H=o.half*IN_M;
    const curves=pedroCurves(P), N=40;
    // the legs as poses, with the time each takes
    const legs=[]; let h0=(P.start.h||0)*RAD, t=0, driven=0, waits=0, atS=P.start;
    P.legs.forEach((L,i)=>{
      const pts=curves[i]; let len=0, prev=bezierAt(pts,0);
      for(let k=1;k<=N;k++){ const q=bezierAt(pts,k/N); len+=Math.hypot(q[0]-prev[0],q[1]-prev[1]); prev=q; }
      const lenM=len*IN_M, end=legPose(pts,L,h0,1), dh=wrap(end.h-h0);
      const lt=legTime(lenM,L.heading==="linear"||L.heading==="constant"?dh:0,o);
      const wait=Math.max(0,+L.wait||0);
      legs.push({i, pts, L, h0, len, lenM, t0:t, T:lt.T, f:lt.f, wait, turnLimited:lt.tw>lt.td+0.05, tw:lt.tw, td:lt.td});
      t+=lt.T+wait; driven+=lt.T; waits+=wait; h0=end.h; atS=L.to;
    });
    const total=t;
    /* where the robot is at time tt (seconds into the period) */
    const poseAt=tt=>{
      for(const g of legs){
        if(tt<g.t0+g.T) return legPose(g.pts,g.L,g.h0,progress((tt-g.t0)/Math.max(g.T,1e-9),g.f));
        if(tt<g.t0+g.T+g.wait) return legPose(g.pts,g.L,g.h0,1);
      }
      const g=legs[legs.length-1]; return legPose(g.pts,g.L,g.h0,1);
    };
    void atS;

    // ---- the field and the structures, along the whole path (with the robot's box, turned as it turns)
    let againstAtStart=[false,false,false,false]; const wallBy=[], hit=[], near=[], nearWall=[]; const inflate={hx:fp.hx+o.nearIn*IN_M, hy:fp.hy+o.nearIn*IN_M, ox:fp.ox, oy:fp.oy};
    const sample=(pose,leg,s,isStart)=>{
      const f=pedroToField(pose), ch={x:f.x,y:f.y,h:pose.h}, b=box(ch,fp);
      const gaps=[H-(b.x+b.ex), H+(b.x-b.ex), H-(b.y+b.ey), H+(b.y-b.ey)];       // to each wall: +x, -x, +y, -y
      const over=-Math.min.apply(null,gaps);
      if(isStart) againstAtStart=gaps.map(g=>g<0.03);
      if(over>0.012&&!(isStart&&over<0.03)) wallBy.push({leg, over});
      else if(!isStart&&s>0.02){
        // the wall the robot starts against doesn't count: driving off it and back is the plan
        const clear=Math.min.apply(null,gaps.filter((g,k)=>!againstAtStart[k]));
        if(clear<o.wallNearIn*IN_M) nearWall.push({leg, clear});
      }
      const ob=hitsObs(ch,fp,o.obs);
      if(ob) hit.push({leg, what:ob.what||"something on the field"});
      else if(o.obs&&!isStart&&s>0.02){ const nb=hitsObs(ch,inflate,o.obs); if(nb) near.push({leg, what:nb.what||"something on the field"}); }
    };
    sample({x:P.start.x,y:P.start.y,h:(P.start.h||0)*RAD},-1,0,true);
    for(const g of legs) for(let k=1;k<=N;k++){ const s=k/N; sample(legPose(g.pts,g.L,g.h0,s),g.i,s,false); }
    const firstPerLeg=list=>{ const seen=new Set(), out=[]; for(const x of list){ if(seen.has(x.leg)) continue; seen.add(x.leg); out.push(x); } return out; };

    const wallLegs=firstPerLeg(wallBy);
    if(wallLegs.length){
      const w=wallLegs[0], lab=w.leg<0?"The start":"Leg "+(w.leg+1);
      put("field","fail",lab+" puts the robot through the wall"+(wallLegs.length>1?" (and "+(wallLegs.length-1)+" more leg"+(wallLegs.length>2?"s":"")+")":"")+
        ": its box goes "+r1(w.over/IN_M)+" in past it. Keep the whole robot inside the field.");
    }else put("field","pass","The robot stays inside the walls the whole way.");

    if(!o.obs||!o.obs.length) put("structures","warn","The field's structures aren't loaded, so the HIVEs and FLOWERs weren't checked.");
    else{
      const hl=firstPerLeg(hit);
      if(hl.length) put("structures","fail",hl.map(h=>(h.leg<0?"The start":"Leg "+(h.leg+1))+" runs into the "+h.what).slice(0,3).join("; ")+(hl.length>3?"; and "+(hl.length-3)+" more":"")+". Route around it.");
      else put("structures","pass","It doesn't run into the HIVEs, their feet or a FLOWER.");
    }

    // ---- the start, as the season has it
    if(o.field){
      const F=o.field, st={x:P.start.x,y:P.start.y,h:(P.start.h||0)*RAD}, f=pedroToField(st), b=box({x:f.x,y:f.y,h:st.h},fp);
      const red=f.x<0, al=red?"red":"blue", s=red?-1:1;
      const probs=[], notes=[];
      // own side: the whole box on the alliance's half
      if(red?b.x+b.ex>0.005:b.x-b.ex<-0.005) probs.push("part of the robot is over the middle line: start on your own half");
      // touching the alliance wall
      const gap=H-(Math.abs(b.x)+b.ex);
      if(gap>0.5*IN_M&&gap<H) notes.push("starts "+r1(gap/IN_M)+" in off your alliance wall: the robot must touch it");
      // facing the field
      const face=Math.abs(wrap(st.h-(red?0:Math.PI)))/RAD;
      if(face>10) notes.push("faces "+Math.round(face)+" degrees off the field: start facing it");
      // the LOADING ZONE
      const z=F.loadingZones&&F.loadingZones[al];
      if(z){ const zx0=z.x0*IN_M, zx1=z.x1*IN_M, zy0=z.y0*IN_M, zy1=z.y1*IN_M;
        if(b.x+b.ex>zx0&&b.x-b.ex<zx1&&b.y+b.ey>zy0&&b.y-b.ey<zy1) probs.push("part of the robot is in your LOADING ZONE: start clear of it"); }
      // the FLOWER on that wall
      const fl=(o.obs||[]).filter(x=>x.what==="FLOWER");
      if(fl.length&&hitsObs({x:f.x,y:f.y,h:st.h},fp,fl)) probs.push("the robot touches a FLOWER: start clear of it");
      void s;
      const cube=o.cubeIn*IN_M;
      if(2*fp.hx>cube+0.002||2*fp.hy>cube+0.002) notes.push("the robot is "+r1(2*fp.hx/IN_M)+" x "+r1(2*fp.hy/IN_M)+" in seen from above, past the "+o.cubeIn+" in start cube (the Robot check measures all three sides)");
      if(probs.length) put("start","fail","Start pose: "+probs.concat(notes).join("; ")+"."+GRADER_RULE);
      else if(notes.length) put("start","warn","Start pose: "+notes.join("; ")+"."+GRADER_RULE);
      else put("start","pass","Start pose is a legal one for the "+al+" alliance: own side, against its wall, facing the field, clear of the LOADING ZONE and the FLOWER."+GRADER_RULE);
    }else put("start","warn","The season's field data isn't loaded, so the start pose wasn't checked.");

    // ---- time
    const sec=o.autoSec, tl=r1(total);
    const tm="about "+tl+" s of "+sec+" ("+r1(driven)+" s driving"+(waits>0?", "+r1(waits)+" s of waits":"")+", at "+o.vmax+" m/s top speed; a model, not a measurement)";
    if(total>sec) put("time","fail","The auto runs out of time: it needs "+tm+". The period stops it "+r1(total-sec)+" s short of the end.");
    else if(total>sec-3) put("time","warn","Tight on time: "+tm+".");
    else put("time","pass","Fits the period: "+tm+".");

    // ---- points, from the app's own scoring model (src/match.js score), the robot where the period ends
    let points=null;
    if(o.field){
      const MP=typeof MATCH_PTS!=="undefined"?MATCH_PTS:{leave:3, parkAuto:5};
      const end=poseAt(Math.min(total,sec)), f=pedroToField(end), b=box({x:f.x,y:f.y,h:end.h},fp);
      const al=pedroToField(P.start).x<0?"red":"blue", z=o.field.loadingZones&&o.field.loadingZones[al];
      const leave=H-Math.abs(b.x)-b.ex>0.01&&H-Math.abs(b.y)-b.ey>0.01;
      const park=!!z&&b.x+b.ex>z.x0*IN_M&&b.x-b.ex<z.x1*IN_M&&b.y+b.ey>z.y0*IN_M&&b.y-b.ey<z.y1*IN_M;
      points={leave:leave?MP.leave:0, park:park?MP.parkAuto:0, alliance:al};
      points.total=points.leave+points.park;
      const bits=[(leave?"leaves the wall +"+MP.leave:"still touching a wall at the end, no leave points"), (park?"ends in the LOADING ZONE +"+MP.parkAuto:"ends outside the LOADING ZONE, no park points")];
      put("points",points.total>0?"pass":"warn","From driving alone: "+points.total+" points ("+bits.join("; ")+"). TIPs, CELLs and FLOWERs are not estimated: they depend on what your mechanism does, which a path doesn't say.");
    }else put("points","warn","Points not estimated: the season's field data isn't loaded.");

    // ---- risks
    const risks=[];
    for(const g of legs){
      let worst=0; for(let k=1;k<N;k++){ const c=curvature(g.pts,k/N); if(c>worst) worst=c; }
      const R=worst>1e-6?1/worst:Infinity, vTop=Math.min(o.vmax,g.lenM>0?Math.sqrt(g.lenM*o.acc):0);
      // sideways acceleration at speed, v^2 / R, against what a mecanum base holds (a third of g)
      if(R<Infinity&&vTop*vTop/(R*IN_M)>3.3) risks.push("Leg "+(g.i+1)+" bends with a "+r1(R)+" in radius at up to "+r1(vTop)+" m/s: the follower will cut it or slide. Slow it or widen the curve.");
      if(g.turnLimited) risks.push("Leg "+(g.i+1)+" is limited by the turn ("+r1(Math.abs(wrap(legPose(g.pts,g.L,g.h0,1).h-g.h0))/RAD)+" degrees in "+r1(g.tw)+" s), not by the drive: shorten the turn or lengthen the leg.");
    }
    for(const w of firstPerLeg(nearWall)) risks.push((w.leg<0?"The start":"Leg "+(w.leg+1))+" passes within "+r1(Math.max(0,w.clear)/IN_M)+" in of a wall: a little drift puts the robot against it.");
    for(const n of firstPerLeg(near)) if(!hit.some(h=>h.leg===n.leg)) risks.push("Leg "+(n.leg+1)+" passes within "+o.nearIn+" in of the "+n.what+".");
    if(risks.length) risks.forEach((r,i)=>put("risk:"+i,"warn",r)); else put("risks","pass","No tight bends at speed, and nothing passes within "+o.nearIn+" in of a wall or structure.");

    const pass=items.filter(i=>i.sev==="pass").length, warn=items.filter(i=>i.sev==="warn").length, fail=items.filter(i=>i.sev==="fail").length;
    return {items, pass, warn, fail, ok:fail===0, time:{total:tl, driving:r1(driven), waits:r1(waits), limit:sec, legs:legs.map(g=>({leg:g.i+1, sec:r1(g.T), wait:g.wait, lengthIn:r1(g.len)}))}, points};
  }
  return {gradePath};
})();
