/* ============================================================
   ONSHAPE → SIMBENCH: THE WHOLE ROBOT FROM A PASTED LINK
   ------------------------------------------------------------
   A team pastes its assembly's address. Nothing is exported and nothing
   is uploaded: SimBench reads the assembly from Onshape's own API, signed
   in as the team (Sign in with Onshape, through functions/onshape, because
   Onshape's API answers no cross-site call from a browser), and builds the
   robot from what Onshape already knows:

     the assembly definition   every part occurrence and where it sits;
                               every mate, with its type and its exact frame
                               on each side (the joints, no translation)
     the assembly's features   the mates' limits (zMin/zMax, the turn's
                               min/max) and their relations (gear, rack,
                               linear: a cascade's stages, a two-gear claw)
     per Part Studio, once     each part's tessellated faces with their
                               colours, and its mass, centre of mass and
                               inertia tensor as Onshape computes them

   onshapeRead gathers those (it is self-contained: fetch and nothing of
   SimBench, so it runs on the page or in the engine worker); onshapeFromLink
   is the page's call; src/onshapecad.js turns the payload into the robot
   (src/mates.js makes the rigid links and the joints).

   The address may carry a configuration (…/e/<eid>?configuration=…): that
   is the "Sim" configuration docs/robot-setup.md asks for, with the
   hardware suppressed, and the definition is read in it.
   ============================================================ */
const ONSHAPE_FORMAT="ftc-simbench.onshape";
const ONSHAPE_QUOTA="this copy of SimBench has used up its yearly allowance of Onshape reads (Onshape answered 402)";

/* An Onshape document address: its host, the assembly it points at, and the
   configuration it is open in, or null. Accepts the address bar as copied
   (workspace, version or microversion; a query; a fragment). */
function onshapeRef(href){
  const s=String(href||"").trim();
  const m=/^(https:\/\/(?:[a-z0-9-]+\.)*onshape\.com)\/documents\/([0-9a-f]{24})\/(w|v|m)\/([0-9a-f]{24})\/e\/([0-9a-f]{24})(?:[/?#]|$)/i.exec(s);
  if(!m) return null;
  let config="";
  try{ config=new URL(s).searchParams.get("configuration")||""; }catch(e){}
  return {host:m[1], did:m[2], wvm:m[3].toLowerCase(), wvmid:m[4], eid:m[5], config};
}

/* Reading one assembly, the whole robot. host is where "/api/..." lives:
   "<SimBench>/onshape" (functions/onshape) after Sign in with Onshape. ref is
   onshapeRef(href). opt.say(text, done, total) reports progress. Resolves to
   {asm, features, geom}; a failed call rejects with e.status set.
     geom: "<did>/<v|m>/<id>/e/<eid>|<configuration>" -> {
       parts: partId -> {name, tri (Float32Array, xyz triples, metres, the
                         Part Studio's frame), color ([r,g,b] 0..1 or null)},
       mass:  partId -> {kg, com [x,y,z], I [9] (about the centroid, the Part
                         Studio's frame), vol (m^3)} }
   Mass with no material: Onshape reports hasMass false and a volume. The
   part then carries kg = its volume (density 1, exactly what Onshape's URDF
   export writes), and src/inertia.js weighs that volume at the material its
   kind implies. */
function onshapeRead(host, ref, opt){
  opt=opt||{};
  const cred=opt.cred||"same-origin", say=opt.say||function(){}, fetchImpl=opt.fetch||fetch;
  const base=host+"/api/assemblies/d/"+ref.did+"/"+ref.wvm+"/"+ref.wvmid+"/e/"+ref.eid;
  const fail=(msg,status)=>{ const e=new Error(msg); e.status=status; return e; };
  // Onshape answers 429 (too many calls) or 503 when busy: wait as asked, up to 5 tries
  const get=(u,n)=>{ n=n||0; return fetchImpl(u,{credentials:cred,headers:{Accept:"application/json"}}).then(r=>{
    if((r.status===429||r.status===503)&&n<5){ const s=+(r.headers&&r.headers.get&&r.headers.get("Retry-After")); return new Promise(ok=>setTimeout(ok,(s>0?s*1000:1500*Math.pow(2,n)))).then(()=>get(u,n+1)); }
    if(r.status===401||r.status===403) throw fail(opt.denied||("Onshape said you aren't allowed to read it ("+r.status+"): sign in with Onshape again"),r.status);
    // 402: the app's yearly allowance of API calls is used up. Every call after it is refused too,
    // so the read stops here instead of leaving each part studio out as if it couldn't be opened
    if(r.status===402) throw fail(ONSHAPE_QUOTA,402);
    if(!r.ok) throw fail("Onshape said "+r.status,r.status); return r.json(); }); };
  const cfg=ref.config?"&configuration="+encodeURIComponent(ref.config):"";
  say("Reading the assembly …");
  return Promise.all([
    get(base+"?includeMateFeatures=true&includeMateConnectors=true&includeNonSolids=false&excludeSuppressed=true"+cfg).catch(e=>{
      // a Part Studio or a drawing has no assembly definition: Onshape answers 400 or 404
      if(e.status===400||e.status===404) throw fail("this isn't an assembly",e.status); throw e; }),
    get(base+"/features"+(cfg?"?"+cfg.slice(1):"")).catch(e=>{ if(e&&e.status===402) throw e; return null; })])
  .then(r=>{
    const asm=r[0], features=r[1], featuresBy={}; let noLimits=0;
    if(!asm||!asm.rootAssembly) throw fail("this isn't an assembly");
    // that call lists the root's own features: each subassembly's mate limits (where lifts and
    // claws live) come from its own definition, keyed the way subAssemblies is
    const subs=(asm.subAssemblies||[]).filter(d=>d.documentMicroversion&&(d.features||[]).some(f=>f&&f.featureType==="mate"));
    // at a microversion, so they never change either: kept like the part studios (opt.cache, below)
    const subLimits=()=>Promise.all(subs.map(d=>{
      const c=d.fullConfiguration||d.configuration||"default", key=[d.documentId||"",d.elementId||"",c].join("|");
      const ck="features|"+d.documentId+"/m/"+d.documentMicroversion+"/e/"+d.elementId+"|"+c, cache=opt.cache||null;
      const read=()=>get(host+"/api/assemblies/d/"+d.documentId+"/m/"+d.documentMicroversion+"/e/"+d.elementId+"/features?configuration="+encodeURIComponent(c)+(d.documentId!==ref.did?"&linkDocumentId="+ref.did:""))
        .then(f=>{ featuresBy[key]=f; if(cache&&f) try{ Promise.resolve(cache.put(ck,{features:f})).catch(()=>{}); }catch(e){} },e=>{ if(e&&(e.status===401||e.status===402)) throw e; noLimits++; });
      const kept=cache?Promise.resolve().then(()=>cache.get(ck)).catch(()=>null):Promise.resolve(null);
      return kept.then(hit=>{ if(hit&&hit.features){ featuresBy[key]=hit.features; return; } return read(); });
    }));
    // every Part Studio the robot uses, once, however many parts it places from it
    const jobs=[], seen={};
    [asm.rootAssembly].concat(asm.subAssemblies||[]).forEach(a=>(a.instances||[]).forEach(i=>{
      if(i.type!=="Part"||i.suppressed) return;
      const key=onshapeGeomKey(i);
      if(seen[key]) return; seen[key]=1; jobs.push({key, i, ver:i.documentVersion?"v/"+i.documentVersion:"m/"+i.documentMicroversion});
    }));
    const geom={}; let done=0, at=0, hits=0;
    /* A part studio at a version or a microversion never changes, so what was
       read once (opt.cache: {get(key), put(key, value)}, promises) is kept:
       reading the same robot again costs the assembly and its features, not
       two calls per part studio (a private Onshape app has 2,500 a year). A
       cache that throws or is full never stops a read. */
    const cache=opt.cache||null;
    const one=()=>{
      if(at>=jobs.length) return Promise.resolve();
      const j=jobs[at++], i=j.i, ps=host+"/api/partstudios/d/"+i.documentId+"/"+j.ver+"/e/"+i.elementId;
      const q="?configuration="+encodeURIComponent(i.configuration||"")+(i.documentId!==ref.did?"&linkDocumentId="+ref.did:"");
      const fresh=()=>Promise.all([
        // 1.5 mm chords, 20 degrees per facet: the low-poly mesh the bench wants (src/meshfiles.js thins it further)
        get(ps+"/tessellatedfaces"+q+"&outputFaceAppearances=true&outputFacetNormals=false&chordTolerance=0.0015&angleTolerance=0.35"),
        get(ps+"/massproperties"+q+"&massAsGroup=false&useMassPropertyOverrides=true").catch(()=>null)
      ]).then(t=>{ geom[j.key]={parts:osCompactTess(t[0]), mass:osCompactMass(t[1])}; if(cache) try{ Promise.resolve(cache.put(j.key,geom[j.key])).catch(()=>{}); }catch(e){} },
        e=>{ if(e&&(e.status===401||e.status===402)) throw e; geom[j.key]=null; });   // a studio this user can't read (403) is left out, named by the builder
      const kept=cache?Promise.resolve().then(()=>cache.get(j.key)).catch(()=>null):Promise.resolve(null);
      return kept.then(hit=>{ if(hit&&hit.parts){ geom[j.key]=hit; hits++; return; } return fresh(); })
        .then(()=>{ done++; say("Reading part shapes: "+done+" of "+jobs.length+" part studios"+(hits?" ("+hits+" already here)":"")+" …",done,jobs.length); return one(); });
    };
    return Promise.all([one(),one(),one(),one(),subLimits()]).then(()=>({asm, features, featuresBy, geom, noLimits:noLimits+(features?0:1), cached:hits}));
  });
}

/* ---- Sign in with Onshape (functions/onshape) ---- */
/* Whether this site can sign in to Onshape, and whether it already has:
   {ready, signedIn}; ready is false with no server (a file, a plain host). */
async function onshapeSignInState(){
  try{
    const r=await fetch("onshape/status",{credentials:"same-origin",cache:"no-store"});
    if(!r.ok) return {ready:false, signedIn:false};
    const j=await r.json();
    return {ready:!!j.ready, signedIn:!!j.signedIn};
  }catch(e){ return {ready:false, signedIn:false}; }
}
/* Part studios read before, kept in this browser (IndexedDB), by the key
   onshapeRead uses: a document at a version or a microversion, which never
   changes. At most CACHE_MAX of them; the oldest go first. Null where there's
   no IndexedDB (a private window, Node). */
const ONSHAPE_CACHE_MAX=400;
function onshapeGeomCache(idb){
  const I=idb||(typeof indexedDB!=="undefined"?indexedDB:null);
  if(!I) return null;
  let dbp=null, puts=0;
  const db=()=>dbp||(dbp=new Promise((ok,no)=>{ const r=I.open("simbench-onshape",1);
    r.onupgradeneeded=()=>r.result.createObjectStore("geom"); r.onsuccess=()=>ok(r.result); r.onerror=()=>no(r.error); }));
  const tx=(mode,f)=>db().then(d=>new Promise((ok,no)=>{ const t=d.transaction("geom",mode), q=f(t.objectStore("geom"));
    t.oncomplete=()=>ok(q&&q.result); t.onerror=()=>no(t.error); t.onabort=()=>no(t.error); }));
  const prune=()=>tx("readwrite",s=>{ const all=[]; const c=s.openCursor();
    c.onsuccess=()=>{ const cur=c.result; if(cur){ all.push([cur.key,(cur.value&&cur.value.at)||0]); cur.continue(); }
      else if(all.length>ONSHAPE_CACHE_MAX){ all.sort((a,b)=>a[1]-b[1]); for(const [k] of all.slice(0,all.length-Math.floor(ONSHAPE_CACHE_MAX*0.75))) s.delete(k); } };
    return null; });
  return {
    get:k=>tx("readonly",s=>s.get(k)).then(v=>v&&v.parts?v:null),
    put:(k,v)=>tx("readwrite",s=>s.put(Object.assign({at:Date.now()},v),k)).then(()=>{ if(++puts%50===0) return prune(); })
  };
}
/* The whole robot from a pasted assembly address, read through the sign-in.
   host is the relay ("<SimBench>/onshape"); the page's own when not given
   (the engine worker has no page address, so it passes one). */
async function onshapeFromLink(href, say, host){
  const ref=onshapeRef(href);
  if(!ref) throw new Error("that isn't an Onshape document link. Open your assembly in Onshape and copy the whole address from the address bar");
  host=host||new URL("onshape",location.href).href.replace(/\/$/,"");
  const denied="Onshape says you can't read it: sign in again, and make sure the document is yours or shared with you";
  let name="";
  try{ const r=await fetch(host+"/api/documents/"+ref.did,{credentials:"same-origin",headers:{Accept:"application/json"}}); if(r.ok) name=String((await r.json()).name||""); }catch(e){}
  const r=await onshapeRead(host, ref, {cred:"same-origin", say, denied, cache:onshapeGeomCache()});
  return {format:ONSHAPE_FORMAT, v:3, name:name||"Onshape assembly", url:String(href).trim(), asm:r.asm, features:r.features, featuresBy:r.featuresBy, noLimits:r.noLimits, geom:r.geom};
}

/* What came in is untrusted (a dropped .onshape.json, a relayed read): keep
   only the documents, the shapes and masses, and a short name and address. */
function checkOnshapePayload(p){
  if(!p||typeof p!=="object"||p.format!==ONSHAPE_FORMAT) throw new Error("it isn't a robot read from Onshape");
  if(!p.asm||typeof p.asm!=="object"||!p.asm.rootAssembly||typeof p.asm.rootAssembly!=="object") throw new Error("it has no assembly definition");
  const isFeat=f=>!!f&&(Array.isArray(f)||(typeof f==="object"&&Array.isArray(f.features)));
  const features=isFeat(p.features)?p.features:null;
  // each subassembly's features, by its definition key
  let featuresBy=null;
  if(p.featuresBy&&typeof p.featuresBy==="object"&&!Array.isArray(p.featuresBy)){
    featuresBy={};
    for(const k of Object.keys(p.featuresBy).slice(0,2000)) if(isFeat(p.featuresBy[k])) featuresBy[String(k).slice(0,200)]=p.featuresBy[k];
  }
  const str=v=>typeof v==="string"?v.slice(0,200):"";
  const url=/^https:\/\/([a-z0-9-]+\.)*onshape\.com\//i.test(str(p.url))?str(p.url):"";
  const num=v=>Number.isFinite(+v)?+v:null, vec=(v,n)=>Array.isArray(v)&&v.length>=n&&v.slice(0,n).every(x=>Number.isFinite(+x))?v.slice(0,n).map(Number):null;
  let geom=null;
  if(p.geom&&typeof p.geom==="object"){
    geom={};
    let tris=0;
    for(const k of Object.keys(p.geom).slice(0,5000)){
      const g=p.geom[k]; if(!g||typeof g!=="object"||!g.parts||typeof g.parts!=="object") continue;
      const parts={}, mass={};
      for(const id of Object.keys(g.parts).slice(0,2000)){
        const b=g.parts[id]; if(!b) continue;
        const t=b.tri; if(!(t instanceof Float32Array||Array.isArray(t))) continue;
        tris+=t.length/9; if(tris>8e6) throw new Error("the robot is too big to draw");
        parts[id]={name:str(b.name), tri:t, color:b.color==null?null:(typeof b.color==="object"||typeof b.color==="string"?b.color:null)};
      }
      if(g.mass&&typeof g.mass==="object") for(const id of Object.keys(g.mass).slice(0,2000)){
        const m=g.mass[id]; if(!m||typeof m!=="object"||!(num(m.kg)>0)) continue;
        mass[id]={kg:num(m.kg), com:vec(m.com,3), I:vec(m.I,9), vol:num(m.vol)};
      }
      geom[k]={parts, mass};
    }
  }
  const noLimits=Number.isFinite(+p.noLimits)?Math.max(0,Math.min(1e4,Math.round(+p.noLimits))):0;
  return {format:ONSHAPE_FORMAT, name:str(p.name).trim()||"Onshape assembly", url, asm:p.asm, features, featuresBy, noLimits, geom};
}
