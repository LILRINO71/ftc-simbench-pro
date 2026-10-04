/* ============================================================
   THE ENGINE WORKER — reading a robot off the page's thread
   ------------------------------------------------------------
   Parsing a 50 MB STEP takes about five seconds, finding its joints three
   more, and cutting it into one small STEP per shape another two. Done on
   the page's thread that is eight seconds of frozen UI, the lag every team
   noticed on loading a robot. The build ships the engine on its own as
   dist/engine-<hash>.js (tools/build.mjs), and this runs it in a Web Worker:
   the same functions, the same results, with the page drawing throughout.

   Jobs:  step     text, name, opts            -> {cad, rig, units}
          urdfzip  bytes, name, opts           -> {cad, notes} or {entries} (no .urdf: the team's code, perhaps)
          onshape  payload, opts               -> {cad}   (a robot already read, built again)
          onshapelink href, host, opts         -> {cad, payload}   (a pasted address: read through the relay, then built)
   Progress comes back as it happens. Anywhere a worker can't start (a file://
   page, a strict CSP, an old browser) the same work runs on the page, as it
   always did, so nothing is lost but the smoothness.
   ============================================================ */
const EngineWorker={
  worker:null, seq:0, pending:{}, dead:false, ready:null,
  /* where the engine lives: next to the page, named by the build */
  src(){
    const name=typeof SIMBENCH_ENGINE_URL==="string"?SIMBENCH_ENGINE_URL:null;
    if(!name||typeof location==="undefined"||location.protocol==="file:") return null;
    try{ return new URL(name,location.href).href; }catch(e){ return null; }
  },
  /* the worker's own code: load the engine, answer jobs */
  body(engineUrl){
    return `importScripts(${JSON.stringify(engineUrl)});
// the engine loaded: only now does the page hand over a job (and a zip's bytes with it)
postMessage({ready:true});
const say=(id,t,d,n)=>postMessage({id, progress:String(t||""), done:d, total:n});
// typed arrays travel without a copy; plain number arrays are copied, so the big ones are converted
function pack(cad){
  const tr=new Set();
  for(const s of cad.solids||[]){
    if(s.tri&&s.tri.pos&&!(s.tri.pos instanceof Float32Array)){ s.tri.pos=Float32Array.from(s.tri.pos); s.tri.nor=Float32Array.from(s.tri.nor||[]); }
    if(s.tri&&s.tri.pos instanceof Float32Array){ tr.add(s.tri.pos.buffer); if(s.tri.nor) tr.add(s.tri.nor.buffer); }
  }
  // a URDF robot's shapes, shared by every placed copy
  (cad.shapes||[]).forEach(S=>{ if(S.pos&&S.pos.buffer) tr.add(S.pos.buffer); if(S.idx&&S.idx.buffer) tr.add(S.idx.buffer); });
  return [...tr];
}
onmessage=async e=>{
  const d=e.data;
  try{
    if(d.op==="step"){
      // the robot first, so it is on the field while the rest is worked out; then the
      // joints found from the geometry; then the file cut per shape for the surfaces
      const cad=parseSTEP(d.text,msg=>say(d.id,msg),d.opts||{}); cad.name=d.name;
      postMessage({id:d.id, ok:true, cad, later:["rig","units"]},pack(cad));
      let rig=null;
      if(d.rig){ try{ rig=autoRig(cad,{front:d.front||"+x"}); }catch(x){ rig={spec:null, review:["The joint finder stopped: "+(x&&x.message||x)]}; } }
      postMessage({id:d.id, late:"rig", value:rig});
      const units=d.units===false?null:stepShapeUnits(d.text,cad.occs||[]);
      postMessage({id:d.id, late:"units", value:units});
    }else if(d.op==="urdfzip"){
      say(d.id,"unpacking …");
      const r=await urdfRobotFromZip(d.bytes,d.name,Object.assign({say:msg=>say(d.id,msg)},d.opts||{}));
      if(!r.cad){ postMessage({id:d.id, ok:true, entries:r.entries.map(x=>({name:x.name, data:x.data}))},r.entries.map(x=>x.data&&x.data.buffer).filter((b,i,a)=>b&&a.indexOf(b)===i)); return; }
      const cad=r.cad; cad.source="urdf";
      postMessage({id:d.id, ok:true, cad, notes:cad.onshape.why||[], name:cad.name},pack(cad));
    }else if(d.op==="onshape"){
      say(d.id,"building the robot …");
      const cad=cadFromOnshape(d.payload,Object.assign({say:msg=>say(d.id,msg)},d.opts||{}));
      postMessage({id:d.id, ok:true, cad},pack(cad));
    }else if(d.op==="onshapelink"){
      // the whole read through the sign-in relay (same-origin cookies travel with a worker's fetch), then the build
      const p=checkOnshapePayload(await onshapeFromLink(d.href,(t,n,k)=>say(d.id,t,n,k),d.host));
      say(d.id,"Building your robot …");
      const cad=cadFromOnshape(p,Object.assign({say:msg=>say(d.id,msg)},d.opts||{}));
      // the payload goes back too (its shapes handed over, not copied): a new up or centre rebuilds from it without another read
      const tr=pack(cad); for(const k in p.geom||{}){ const g=p.geom[k]; if(g) for(const id in g.parts){ const t=g.parts[id].tri; if(t&&t.buffer&&!tr.includes(t.buffer)) tr.push(t.buffer); } }
      postMessage({id:d.id, ok:true, cad, payload:p},tr);
    }else postMessage({id:d.id, ok:false, error:"unknown job "+d.op});
  }catch(err){ postMessage({id:d.id, ok:false, error:String(err&&err.message||err)}); }
};`;
  },
  get(){
    if(this.worker||this.dead) return this.worker;
    const url=this.src(); if(!url){ this.dead=true; return null; }
    try{
      const w=new Worker(URL.createObjectURL(new Blob([this.body(url)],{type:"text/javascript"})));
      // a job waits for the engine to load in the worker: a zip's bytes are handed over (not
      // copied), and handed to a worker whose engine never loaded (an old page after a deploy,
      // a blocked file) they could not be read on the page instead
      let ready; this.ready=new Promise((res,rej)=>{ ready={res,rej}; }); this.ready.catch(()=>{});
      w.onmessage=e=>{ const m=e.data; if(m&&m.ready){ ready.res(); return; }
        const p=this.pending[m.id]; if(!p) return;
        if(m.progress!==undefined){ if(p.onProgress) p.onProgress(m.progress,m.done,m.total); return; }
        // a result that arrives after the main one (the joints, the shape units): its promise
        if(m.late){ const L=p.late&&p.late[m.late]; if(L) L.resolve(m.value); if(p.late&&Object.values(p.late).every(x=>x.done=x.done||x===L)) delete this.pending[m.id]; return; }
        if(!m.ok){ delete this.pending[m.id]; p.reject(new Error(m.error||"the engine worker failed")); return; }
        if(Array.isArray(m.later)&&m.later.length){
          p.late={}; for(const k of m.later){ let res; const pr=new Promise(r=>{ res=r; }); p.late[k]={resolve:res, promise:pr}; m[k]=pr; }
        } else delete this.pending[m.id];
        p.resolve(m); };
      w.onerror=e=>{ e.preventDefault&&e.preventDefault();
        // it never started (the engine file didn't load): everything pending runs on the page instead
        const err=new Error("worker: "+(e.message||"stopped"));
        ready.rej(Object.assign(new Error(err.message),{fallback:true}));
        for(const id in this.pending){ const p=this.pending[id]; delete this.pending[id];
          // a job whose bytes were handed to the worker can't run again on the page: the worker
          // died on it (a browser out of memory on a huge export), so say that instead
          p.reject(p.handed?new Error("the browser ran out of memory reading it. Export again at Medium resolution (Onshape: Export → URDF → Resolution), which is plenty for the bench")
                          :Object.assign(err,{fallback:true}));
          if(p.late) for(const k in p.late) p.late[k].resolve(null); }
        try{ w.terminate(); }catch(x){} this.worker=null; this.dead=true; };
      this.worker=w;
    }catch(e){ this.dead=true; this.worker=null; }
    return this.worker;
  },
  run(msg,transfer,onProgress){
    const w=this.get();
    if(!w) return Promise.reject(Object.assign(new Error("no worker"),{fallback:true}));
    return this.ready.then(()=>{
      if(this.dead||this.worker!==w) throw Object.assign(new Error("no worker"),{fallback:true});
      const id=++this.seq;
      return new Promise((resolve,reject)=>{ this.pending[id]={resolve,reject,onProgress,handed:!!(transfer&&transfer.length)}; w.postMessage(Object.assign({id},msg),transfer||[]); });
    });
  },
  /* the same work on the page, when there is no worker */
  async local(msg,onProgress){
    const say=t=>onProgress&&onProgress(t);
    await new Promise(r=>setTimeout(r,30));                 // let the status paint first
    if(msg.op==="step"){
      const cad=parseSTEP(msg.text,say,msg.opts||{}); cad.name=msg.name;
      // on the page, the joints and the units come a moment later each, so the robot draws between
      const rig=new Promise(r=>setTimeout(()=>{ let R=null; if(msg.rig){ try{ R=autoRig(cad,{front:msg.front||"+x"}); }catch(x){ R={spec:null, review:["The joint finder stopped: "+(x&&x.message||x)]}; } } r(R); },60));
      const units=rig.then(()=>new Promise(r=>setTimeout(()=>{ let U=null; try{ U=msg.units===false?null:stepShapeUnits(msg.text,cad.occs||[]); }catch(x){} r(U); },60)));
      return {ok:true, cad, rig, units};
    }
    if(msg.op==="urdfzip"){
      const r=await urdfRobotFromZip(msg.bytes,msg.name,Object.assign({say},msg.opts||{}));
      if(!r.cad) return {ok:true, entries:r.entries};
      const cad=r.cad; cad.source="urdf";
      return {ok:true, cad, notes:cad.onshape.why||[], name:cad.name};
    }
    if(msg.op==="onshape"){
      const cad=cadFromOnshape(msg.payload,Object.assign({say},msg.opts||{}));
      return {ok:true, cad};
    }
    if(msg.op==="onshapelink"){
      const p=checkOnshapePayload(await onshapeFromLink(msg.href,(t,n,k)=>onProgress&&onProgress(t,n,k),msg.host));
      say("Building your robot …");
      const cad=cadFromOnshape(p,Object.assign({say},msg.opts||{}));
      return {ok:true, cad, payload:p};
    }
    throw new Error("unknown job "+msg.op);
  },
  /* a job, in the worker when there is one, else on the page */
  job(msg,transfer,onProgress){
    return this.run(msg,transfer,onProgress).catch(e=>{ if(e&&e.fallback) return this.local(msg,onProgress); throw e; });
  },
  parseStep(text,name,opts){ return this.job({op:"step", text, name, opts:opts.frame||{}, rig:opts.rig!==false, front:opts.front||"+x", units:opts.units!==false},[],opts.onProgress); },
  // the zip's bytes are handed over, not copied: a 500 MB export would otherwise sit in memory twice
  urdfZip(bytes,name,opts){ const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes); return this.job({op:"urdfzip", bytes:u8, name, opts:opts.frame||{}},[u8.buffer],opts.onProgress); },
  /* a payload already read (a new up or centre for the same robot): built again, off the page */
  onshape(payload,opts){ return this.job({op:"onshape", payload, opts:opts.frame||{}},[],opts.onProgress); },
  /* a pasted assembly address: read through the relay and built, both off the page */
  onshapeLink(href,opts){ const host=new URL("onshape",location.href).href.replace(/\/$/,""); return this.job({op:"onshapelink", href, host, opts:opts.frame||{}},[],opts.onProgress); },
};
