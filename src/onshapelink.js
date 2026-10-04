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
    if(!r.ok) throw fail("Onshape said "+r.status,r.status); return r.json(); }); };
  const cfg=ref.config?"&configuration="+encodeURIComponent(ref.config):"";
  say("Reading the assembly …");
  return Promise.all([
    get(base+"?includeMateFeatures=true&includeMateConnectors=true&includeNonSolids=false&excludeSuppressed=true"+cfg).catch(e=>{
      // a Part Studio or a drawing has no assembly definition: Onshape answers 400 or 404
      if(e.status===400||e.status===404) throw fail("this isn't an assembly",e.status); throw e; }),
    get(base+"/features"+(cfg?"?"+cfg.slice(1):"")).catch(()=>null)])
  .then(r=>{
    const asm=r[0], features=r[1];
    if(!asm||!asm.rootAssembly) throw fail("this isn't an assembly");
    // every Part Studio the robot uses, once, however many parts it places from it
    const jobs=[], seen={};
    [asm.rootAssembly].concat(asm.subAssemblies||[]).forEach(a=>(a.instances||[]).forEach(i=>{
      if(i.type!=="Part"||i.suppressed) return;
      const key=onshapeGeomKey(i);
      if(seen[key]) return; seen[key]=1; jobs.push({key, i, ver:i.documentVersion?"v/"+i.documentVersion:"m/"+i.documentMicroversion});
    }));
    const geom={}; let done=0, at=0;
    const one=()=>{
      if(at>=jobs.length) return Promise.resolve();
      const j=jobs[at++], i=j.i, ps=host+"/api/partstudios/d/"+i.documentId+"/"+j.ver+"/e/"+i.elementId;
      const q="?configuration="+encodeURIComponent(i.configuration||"")+(i.documentId!==ref.did?"&linkDocumentId="+ref.did:"");
      return Promise.all([
        // 1.5 mm chords, 20 degrees per facet: the low-poly mesh the bench wants (src/meshfiles.js thins it further)
        get(ps+"/tessellatedfaces"+q+"&outputFaceAppearances=true&outputFacetNormals=false&chordTolerance=0.0015&angleTolerance=0.35"),
        get(ps+"/massproperties"+q+"&massAsGroup=false&useMassPropertyOverrides=true").catch(()=>null)
      ]).then(t=>{ geom[j.key]={parts:osCompactTess(t[0]), mass:osCompactMass(t[1])}; },e=>{ if(e&&e.status===401) throw e; geom[j.key]=null; })   // a studio this user can't read (403) is left out, named by the builder
        .then(()=>{ done++; say("Reading part shapes: "+done+" of "+jobs.length+" part studios …",done,jobs.length); return one(); });
    };
    return Promise.all([one(),one(),one(),one()]).then(()=>({asm, features, geom}));
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
  const r=await onshapeRead(host, ref, {cred:"same-origin", say, denied});
  return {format:ONSHAPE_FORMAT, v:3, name:name||"Onshape assembly", url:String(href).trim(), asm:r.asm, features:r.features, geom:r.geom};
}

/* What came in is untrusted (a dropped .onshape.json, a relayed read): keep
   only the documents, the shapes and masses, and a short name and address. */
function checkOnshapePayload(p){
  if(!p||typeof p!=="object"||p.format!==ONSHAPE_FORMAT) throw new Error("it isn't a robot read from Onshape");
  if(!p.asm||typeof p.asm!=="object"||!p.asm.rootAssembly||typeof p.asm.rootAssembly!=="object") throw new Error("it has no assembly definition");
  const f=p.features, features=f&&(Array.isArray(f)||(typeof f==="object"&&Array.isArray(f.features)))?f:null;
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
  return {format:ONSHAPE_FORMAT, name:str(p.name).trim()||"Onshape assembly", url, asm:p.asm, features, geom};
}
