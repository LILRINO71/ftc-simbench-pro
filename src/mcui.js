/* ============================================================
   THE CALIBRATION AND MONTE CARLO PANELS (Tune tab)
   ------------------------------------------------------------
   The page side of src/calibrate.js and src/montecarlo.js: the inputs, what
   is saved for each robot, the worker a batch runs in, and the results.

   A batch runs in a Web Worker that loads the engine (dist/engine-<hash>.js)
   and the Shot Sim (dist/shotsim-<hash>.js), so the page keeps drawing. Where
   a worker can't start (a file:// page, a strict CSP) the runs are done on the
   page one at a time with a pause between them, on a copy of the sim, with a
   progress bar and Cancel; only the points target needs the worker.
   ============================================================ */
const IN_PER_M=1/0.0254;
const CALIB_KEY=name=>"ftcbench.calib."+(name||"robot");

/* ---------- calibration ---------- */
const CalUI={
  unit:"in", cal:null, keyApplied:null,
  load(){ try{ const c=JSON.parse(store.get(CALIB_KEY(CAD&&CAD.name),"null")); return c&&c.format===CAL_FORMAT&&c.params?c:null; }catch(e){ return null; } },
  save(){ if(this.cal) store.set(CALIB_KEY(CAD&&CAD.name),JSON.stringify(this.cal)); else store.del(CALIB_KEY(CAD&&CAD.name)); },
  /* the calibration saved for this robot, handed to the sim through OPTS; called every time the sim is built */
  apply(){
    const k=CAD&&CAD.name;
    if(this.keyApplied!==k){ this.keyApplied=k; this.cal=this.load(); if(typeof document!=="undefined"&&document.getElementById("calResult")) this.show(); }
    OPTS.calib=this.cal&&this.cal.on!==false?calOpts(this.cal):null;
  },
  /* the rig as the sim builds it with no calibration: what "before" means */
  baseRig(){
    if(!CAD||!Sim.drivetrain||!Sim.drivetrain.ok) return null;
    return buildRig(CAD,Sim.drivetrain,Sim.base,Sim.dev,Object.assign({},OPTS,{calib:null,massScale:null,volts:null,latencyMs:null,muScale:null}));
  },
  /* the numbers in the boxes, in SI */
  read(){
    const num=id=>{ const v=parseFloat($("#"+id).value); return isFinite(v)&&v>0?v:0; };
    const sp=this.unit==="in"?0.0254:1;
    return {fwd:num("calFwd")*sp, strafe:num("calStrafe")*sp, turn:num("calTurn"), massKg:num("calMass"), ticksPerIn:num("calTicks")};
  },
  fill(m){
    const sp=this.unit==="in"?1/0.0254:1, put=(id,v,d)=>{ $("#"+id).value=v>0?(+(v).toFixed(d)).toString():""; };
    put("calFwd",(m.fwd||0)*sp,3); put("calStrafe",(m.strafe||0)*sp,3); put("calTurn",m.turn||0,1); put("calMass",m.massKg||0,2); put("calTicks",m.ticksPerIn||0,2);
  },
  fit(){
    const rig=this.baseRig(), st=$("#calStatus");
    if(!rig){ st.textContent="Load a robot and an OpMode that drives it first: the fit needs its drive base."; return; }
    const m=calSanitize(this.read());
    if(!(m.fwd||m.strafe||m.turn||m.massKg||m.ticksPerIn)){ st.textContent="Enter at least one measured number."; return; }
    const r=calFit(rig,m);
    this.cal={format:CAL_FORMAT, v:1, on:true, measured:m, params:r.params, rows:r.rows, notes:r.notes, ok:r.ok, at:new Date().toISOString()};
    this.save(); this.show(); reloadSim();
  },
  reset(){
    this.cal=null; this.save(); OPTS.calib=null;
    for(const id of ["calFwd","calStrafe","calTurn","calMass","calTicks"]) $("#"+id).value="";
    this.show(); reloadSim();
  },
  show(){
    const c=this.cal, pill=$("#calPill"), res=$("#calResult"), box=$("#calOn");
    if(box) box.checked=!c||c.on!==false;
    if(!c){ pill.textContent="not fitted"; pill.className="pill"; setHTML(res,""); setHTML($("#calNotes"),""); $("#calStatus").textContent=""; return; }
    this.fill(c.measured||{});
    pill.textContent=c.on===false?"fitted, off":(c.ok?"fitted":"partly fitted"); pill.className="pill"+(c.ok&&c.on!==false?" pass":"");
    const sp=this.unit==="in"?1/0.0254:1, conv=(r,v)=>v==null?"—":((r.key==="fwd"||r.key==="strafe")?v*sp:v);
    const f=(r,v)=>{ const x=conv(r,v); return x==="—"?x:(r.key==="turn"||r.key==="ticks"?x.toFixed(1):x.toFixed(2)); };
    const unitOf=r=>r.key==="fwd"||r.key==="strafe"?(this.unit==="in"?"in/s":"m/s"):r.unit;
    const pc=v=>v==null?"—":(v>=0?"+":"")+v.toFixed(1)+" %";
    const cell=(r,v,e)=>`<td class="num">${f(r,v)}<small>${pc(e)}</small></td>`;
    setHTML(res,`<table class="grid cal-grid"><thead><tr><th></th><th class="num">Measured</th><th class="num">Sim before</th><th class="num">Sim after</th></tr></thead><tbody>`+
      (c.rows||[]).map(r=>`<tr><td>${esc(r.label)}<small>${esc(unitOf(r))}</small></td><td class="num">${f(r,r.measured)}</td>${cell(r,r.before,r.errBefore)}${cell(r,r.after,r.errAfter)}</tr>`).join("")+`</tbody></table>`);
    const p=c.params||{}, bits=[];
    if(p.massKg) bits.push("mass "+p.massKg.toFixed(2)+" kg");
    if(p.gear) bits.push("gearing "+p.gear.toFixed(2)+" motor turns per wheel turn");
    if(p.viscous) bits.push("drivetrain drag "+p.viscous.toFixed(1)+" N per m/s");
    if(p.strafeEff) bits.push("strafe efficiency "+p.strafeEff.toFixed(2));
    if(p.yawViscous) bits.push("turn drag "+p.yawViscous.toFixed(2)+" N·m per rad/s");
    const kin=OPTS.physics==="kinematic"?'<p class="hint">Chassis is set to kinematic, which ignores all of this. Switch it to rigid body above.</p>':"";
    setHTML($("#calNotes"),kin+(bits.length?`<p class="hint">Changed in the sim: ${esc(bits.join(", "))}.</p>`:"")+(c.notes||[]).map(n=>`<p class="hint">${esc(n)}</p>`).join(""));
    $("#calStatus").textContent="";
  },
  wire(){
    $("#calUnit").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
      const m=this.read(); this.unit=b.dataset.u; store.set("ftcbench.calUnit",this.unit); this.syncUnit(); this.fill(m); if(this.cal) this.show(); });
    this.unit=store.get("ftcbench.calUnit","in")==="m"?"m":"in"; this.syncUnit();
    $("#calFit").addEventListener("click",()=>this.fit());
    $("#calReset").addEventListener("click",()=>this.reset());
    $("#calOn").addEventListener("change",e=>{ if(!this.cal) return; this.cal.on=e.target.checked; this.save(); this.show(); reloadSim(); });
    $("#calJava").addEventListener("click",()=>download("CalibrateSimBench.java",calJava(),"text/x-java-source;charset=utf-8"));
    this.apply();
  },
  syncUnit(){
    $$("#calUnit button").forEach(b=>b.classList.toggle("on",b.dataset.u===this.unit));
    $$("[data-calunit]").forEach(s=>{ s.textContent=this.unit==="in"?"in/s":"m/s"; });
  },
};

/* ---------- the runner: a worker, else the page ---------- */
const McRunner={
  /* spec, n, seed (or seeds) in; callbacks out. Returns {cancel}. */
  run(o){
    let dead=false, w=null;
    const finish=()=>{ dead=true; if(w){ try{ w.terminate(); }catch(e){} w=null; } };
    const handle={ cancel(){ if(!dead){ finish(); if(o.onCancel) o.onCancel(); } } };
    const local=()=>{
      // the page's own engine, on a copy of the sim so the live one is left alone
      let job; try{ job=mcPrepare(Object.assign({},o.spec,{code:CODE})); }catch(e){ if(o.onError) o.onError(String(e&&e.message||e)); return; }
      const S=Object.create(Sim), seeds=o.seeds&&o.seeds.length?o.seeds:null, n=seeds?seeds.length:o.n;
      let pre; try{ pre=mcSetup(job,S); }catch(e){ if(o.onError) o.onError(String(e&&e.message||e)); return; }
      if(o.onSetup) o.onSetup(pre);
      let i=0;
      const step=()=>{
        if(dead) return;
        if(i>=n){ dead=true; if(o.onDone) o.onDone(); return; }
        const r=mcJudge(mcRunOne(job,seeds?seeds[i]>>>0:mcSeedFor(o.seed,i),S),job);
        r.extremes=mcExtremes(r.v,job.ranges,3,r);
        if(o.onRun) o.onRun(i,n,r);
        i++; setTimeout(step,0);
      };
      setTimeout(step,0);
    };
    const url=typeof EngineWorker!=="undefined"?EngineWorker.src():null, shot=typeof SIMBENCH_SHOT_URL==="string"?SIMBENCH_SHOT_URL:null;
    if(!url||!shot||typeof Worker==="undefined"){ if(o.onLocal) o.onLocal(); local(); return handle; }
    try{
      const body=mcWorkerBody(url,new URL(shot,location.href).href);
      w=new Worker(URL.createObjectURL(new Blob([body],{type:"text/javascript"})));
    }catch(e){ if(o.onLocal) o.onLocal(); local(); return handle; }
    let started=false;
    w.onmessage=e=>{
      const m=e.data; if(dead||!m) return;
      if(m.ready){ started=true; w.postMessage({id:1,op:"mc",spec:o.spec,n:o.n,seed:o.seed,seeds:o.seeds||null}); return; }
      if(m.error){ finish(); if(o.onError) o.onError(m.error); return; }
      if(m.setup){ if(o.onSetup) o.onSetup({target:m.target,nominal:m.nominal}); return; }
      if(m.run!=null){ if(o.onRun) o.onRun(m.run,m.n,m.res); return; }
      if(m.done){ finish(); if(o.onDone) o.onDone(); }
    };
    w.onerror=e=>{
      if(e&&e.preventDefault) e.preventDefault();
      // the engine never loaded: the same runs on the page instead
      if(!started&&!dead){ try{ w.terminate(); }catch(x){} w=null; if(o.onLocal) o.onLocal(); local(); return; }
      finish(); if(o.onError) o.onError("the background worker stopped: "+(e&&e.message||"unknown error"));
    };
    return handle;
  },
};

/* ---------- Monte Carlo ---------- */
const McUI={
  handle:null, results:[], job:null, pre:null, seed:1, total:0, local:false, watching:false,
  cfg(){ try{ return JSON.parse(store.get("ftcbench.mc","null"))||{}; }catch(e){ return {}; } },
  saveCfg(){ store.set("ftcbench.mc",JSON.stringify({runs:+$("#mcRuns").value,seed:+$("#mcSeed").value,mode:this.mode,posIn:+$("#mcPos").value,degDeg:+$("#mcDeg").value,points:+$("#mcPts").value,vary:this.vary()})); },
  vary(){ const v={}; $$("[data-vary]").forEach(c=>{ v[c.dataset.vary]=c.checked; }); return v; },
  isAuto(){ return !!(CODE&&CAD&&CODE.kind==="Autonomous"&&entry(CURRENT_ID)); },
  /* everything a batch needs, as plain data */
  spec(){
    const e=entry(CURRENT_ID), o={};
    for(const k of ["payloadKg","duty","trust","front","baseModel","physics","mu","obstacles","up","shift","calib"]) if(OPTS[k]!=null) o[k]=OPTS[k];
    o.startPose=Object.assign({x:0,y:0,h:0},OPTS.startPose);          // where the sim was last put at INIT, not where it has driven since
    const success=this.mode==="points"?{mode:"points",points:+$("#mcPts").value||0}:{mode:"pose",posIn:+$("#mcPos").value||2,degDeg:+$("#mcDeg").value||5,target:"auto"};
    return {java:{src:e.source,libs:libsFor(e)}, cad:mcCadForWorker(CAD), map:mcPlain(MAP||{}), opts:mcPlain(o), alliance:Shots.alliance,
      shots:Shots.cfg?mcPlain(Shots.cfg):null, duration:MC_AUTO_SECONDS, success, ranges:MC_RANGES, vary:this.vary()};
  },
  setMode(m){
    this.mode=m==="points"?"points":"pose";
    $$("#mcMode button").forEach(b=>b.classList.toggle("on",b.dataset.mode===this.mode));
    for(const id of ["mcPoseRow","mcPoseRow0"]) $("#"+id).hidden=this.mode!=="pose";
    for(const id of ["mcPtsRow","mcPtsRow0"]) $("#"+id).hidden=this.mode!=="points";
  },
  sync(){
    const auto=this.isAuto(), e=entry(CURRENT_ID);
    $("#mcWhich").textContent=auto?"Runs "+(e&&e.file?e.file:"the selected autonomous")+" again and again, a little different each time.":"Pick an Autonomous in the Code tab: this runs the selected one.";
    $("#mcRun").disabled=!auto||!!this.handle;
    $("#mcCancel").hidden=!this.handle;
  },
  say(t,bad){ const s=$("#mcStatus"); s.textContent=t; s.classList.toggle("bad",!!bad); },
  start(seeds){
    if(this.handle||!this.isAuto()) return;
    let n=Math.max(1,Math.min(MC_MAX_RUNS,Math.round(+$("#mcRuns").value)||MC_DEFAULT_RUNS));
    const seed=Math.max(0,Math.round(+$("#mcSeed").value)||0)>>>0;
    $("#mcRuns").value=n; this.saveCfg();
    let spec; try{ spec=this.spec(); }catch(e){ this.say("Couldn't read the robot: "+e.message,true); return; }
    // a replay is one seed again, shown beside the batch it came from (which stays)
    const replay=!!seeds, was=replay?this.results.find(r=>r.seed===seeds[0]):null;
    if(!replay){ this.results=[]; this.pre=null; this.local=false; this.seed=seed; this.total=n; setHTML($("#mcReplay"),""); this.job={success:spec.success, ranges:MC_RANGES}; }
    $("#mcBar").hidden=false; $("#mcBar").value=0; $("#mcBar").max=replay?1:n;
    this.say(replay?"Replaying seed "+seeds[0]+" …":"Running 0 of "+n+" …");
    this.handle=McRunner.run({spec, n, seed, seeds:seeds||null,
      onLocal:()=>{ this.local=true; },
      onSetup:pre=>{ if(replay) return; this.pre=pre; this.job.target=pre.target; this.job.nominal=pre.nominal; },
      onRun:(i,tot,res)=>{
        $("#mcBar").value=i+1;
        if(replay){ const same=was&&was.err&&res.err&&Math.abs(was.err.pos-res.err.pos)<1e-9&&Math.abs(was.err.deg-res.err.deg)<1e-9;
          setHTML($("#mcReplay"),`<p class="hint">Seed ${res.seed} again: ${esc(res.why||"")}${was?(same?". The same numbers as in the batch.":". Not the same numbers as in the batch."):"."}</p>`); return; }
        this.results.push(res); this.say("Running "+(i+1)+" of "+tot+" …"); this.render(false); },
      onDone:()=>{ this.handle=null; $("#mcBar").hidden=true; this.sync(); if(replay) this.say("Done."); else this.render(true); },
      onCancel:()=>{ this.handle=null; $("#mcBar").hidden=true; this.say(replay?"Cancelled.":"Cancelled after "+this.results.length+" of "+n+" runs."); this.sync(); if(!replay) this.render(true); },
      onError:msg=>{ this.handle=null; $("#mcBar").hidden=true; this.say("Couldn't run: "+msg,true); this.sync(); }});
    this.sync();
  },
  cancel(){ if(this.handle) this.handle.cancel(); },
  /* the results so far, or the final ones */
  render(done){
    const R=this.results, out=$("#mcResult"); if(!R.length){ setHTML(out,""); return; }
    const job=this.job, S=mcSummary(R,job);
    $("#mcPill").textContent=S.passed+" of "+S.n;
    $("#mcPill").className="pill"+(done&&S.passed===S.n?" pass":done&&S.passed<S.n?" bad":"");
    const pts=job.success.mode==="points";
    const T=job.target;
    let h=`<div class="mc-head"><b class="mc-rate">${S.passed} of ${S.n}</b> runs ${pts?"scored "+(+job.success.points)+" points or more":"ended within "+(+job.success.posIn)+" in and "+(+job.success.degDeg)+"° of "+(T?(T.from==="path end"?"the end of the path":T.from==="given"?"the target":"where a run with no variation ends"):"the target")}`+
      `${done?"":" so far"}</div>`;
    const nom=S.nominal;
    if(!pts&&nom&&nom.err) h+=`<p class="hint">With no variation at all the auto ends ${nom.err.pos.toFixed(1)} in and ${nom.err.deg.toFixed(1)}° off, so ${nom.ok?"that is the floor the spread adds to":"it misses before any variation"}.</p>`;
    if(pts&&this.local) h+=`<p class="hint">Points need the background worker, which couldn't start here.</p>`;
    // the histogram
    const top=Math.max(1,...S.bins.map(b=>b.n)), lab=b=>pts?(b.hi===Infinity||b.hi-b.lo<=1?(b.lo+""):b.lo+"–"+(b.hi-1)):(b.hi===Infinity?"over "+(+b.lo.toFixed(1)):(+b.lo.toFixed(2))+"–"+(+b.hi.toFixed(2)));
    h+=`<div class="mc-hist" role="img" aria-label="${pts?"Points":"Final position error in inches"} per run">`+
      S.bins.filter((b,i)=>b.n||i<(pts?0:5)).map(b=>`<div class="mc-bin"><span class="mc-lab">${esc(lab(b))}</span><span class="mc-bar"><i class="${b.pass?"ok":"miss"}" style="width:${Math.round(b.n/top*100)}%"></i></span><span class="mc-n">${b.n}</span></div>`).join("")+
      `</div><div class="hint">${pts?"Points scored":"Final position error, inches"}, one count per run.</div>`;
    // the worst runs
    const bad=S.worst.filter(w=>!w.ok||S.failed===0);
    if(bad.length){
      h+=`<h4 class="mc-sub">${S.failed?"Worst runs":"Furthest from the target"}</h4>`+bad.map(w=>{
        const why=w.error&&!w.pose?"stopped on an error: "+esc(w.error):esc(w.why||"");
        return `<div class="mc-run"><div><b class="mono">seed ${w.seed}</b> <span class="${w.ok?"dim":"mc-miss"}">${why}</span></div>`+
          `<div class="dim">${w.extremes.length?esc(w.extremes.map(x=>x.text).join("; ")):"nothing was far from its nominal: the miss comes from the auto itself"}</div>`+
          `<div class="mc-acts"><button class="btn-sm" type="button" data-mc-replay="${w.seed}">Run it again</button>`+
          `${pts?"":`<button class="btn-sm" type="button" data-mc-watch="${w.seed}">Watch in the sim</button>`}</div></div>`;
      }).join("");
    }
    h+=`<p class="hint">Every run is its own seed: run it again and it comes out the same. Seeds in this batch come from seed ${this.seed}.</p>`;
    setHTML(out,h);
    if(done) this.say(this.local?"Done, on the page (no background worker here).":"Done.");
  },
  /* the live sim, set up the way a run was: its variation applied, stopped at INIT, ready to START */
  watch(seed){
    const v=mcVariation(seed>>>0,MC_RANGES,Field.ok&&OPTS.obstacles!=="walls"?Field.obstacles(0.46).length:0,this.vary());
    Object.assign(OPTS,{muScale:1+v.friction,massScale:1+v.mass,volts:v.volts||undefined,latencyMs:v.latencyMs,obstacleOffsets:v.offsets.map(o=>[o[0]*IN,o[1]*IN])});
    this.watching=true;
    reloadSim();
    if(Sim.phase==="init"||Sim.phase==="loaded") Sim.chassis={x:Sim.chassis.x+v.dx*IN,y:Sim.chassis.y+v.dy*IN,h:Sim.chassis.h+v.dh*Math.PI/180};
    $("#mcWatchNote").hidden=false;
    this.say("The sim is set up as seed "+seed+" ran. Press Start to watch it.");
  },
  unwatch(){
    for(const k of ["muScale","massScale","volts","latencyMs","obstacleOffsets"]) delete OPTS[k];
    this.watching=false; $("#mcWatchNote").hidden=true; reloadSim();
  },
  wire(){
    const c=this.cfg();
    if(c.runs>=1) $("#mcRuns").value=Math.min(MC_MAX_RUNS,c.runs);
    if(c.seed>=0) $("#mcSeed").value=c.seed;
    if(c.posIn>0) $("#mcPos").value=c.posIn;
    if(c.degDeg>0) $("#mcDeg").value=c.degDeg;
    if(c.points>=0) $("#mcPts").value=c.points;
    if(c.vary) $$("[data-vary]").forEach(b=>{ if(c.vary[b.dataset.vary]===false) b.checked=false; });
    $("#mcVaryList").innerHTML=Object.keys(MC_RANGES).map(k=>{ const r=MC_RANGES[k];
      return `<label class="mc-vary"><input type="checkbox" data-vary="${k}" ${c.vary&&c.vary[k]===false?"":"checked"}> <span>${esc(r.label)}</span> <span class="dim">${esc(r.assumed?r.assumed+" (assumed)":r.given)}</span></label>`; }).join("");
    this.setMode(c.mode);
    $("#mcMode").addEventListener("click",e=>{ const b=e.target.closest("button"); if(b){ this.setMode(b.dataset.mode); this.saveCfg(); } });
    $("#mcRun").addEventListener("click",()=>this.start());
    $("#mcCancel").addEventListener("click",()=>this.cancel());
    $("#mcWatchOff").addEventListener("click",()=>this.unwatch());
    $("#mcResult").addEventListener("click",e=>{
      const r=e.target.closest("[data-mc-replay]"), w=e.target.closest("[data-mc-watch]");
      if(r) this.start([+r.dataset.mcReplay]); else if(w) this.watch(+w.dataset.mcWatch); });
    $("[data-sec=mc]").addEventListener("change",()=>this.saveCfg());
    this.sync();
  },
};
