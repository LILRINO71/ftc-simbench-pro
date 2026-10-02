/* ============================================================
   ONSHAPE → SIMBENCH: THE WHOLE ROBOT, JOINTS AND ALL
   The exact joints are in the team's Onshape assembly (its mates), and the
   shapes, colours and mass are in its part studios. onshapeRead reads all
   of it from Onshape's API, signed in as the team. Two ways to run it:
   - Sign in with Onshape (onshapeFromLink): OAuth through
     functions/onshape, then the team pastes the assembly's address. This
     is the main way: school computers block bookmarklets.
   - The "Send to SimBench" bookmark (onshapeGrab): run on the team's own
     assembly tab with their Onshape session, it hands the robot to the
     SimBench tab it opens by postMessage, or saves one .onshape.json file.
   Either way it only reads, and nothing needs an API key.
   ============================================================ */
const ONSHAPE_FORMAT="ftc-simbench.onshape";

/* Reading one assembly, the whole robot: its definition (parts, placements,
   mates), its features (limits), and, once per part studio the robot uses,
   that studio's tessellated shapes with their colours and its mass
   properties. host is where "/api/..." lives: the Onshape tab's own origin
   for the bookmark, or "<SimBench>/onshape" (functions/onshape) after Sign
   in with Onshape. ref is {did, wvm, wvmid, eid} from the assembly's
   address. It's self-contained (the bookmark carries its source), so it
   uses nothing from SimBench. Resolves to {asm, features, geom}; a failed
   call rejects with e.status set. */
function onshapeRead(host, ref, opt){
  opt=opt||{};
  var cred=opt.cred||"include", say=opt.say||function(){};
  var base=host+"/api/assemblies/d/"+ref.did+"/"+ref.wvm+"/"+ref.wvmid+"/e/"+ref.eid;
  var fail=function(msg,status){ var e=new Error(msg); e.status=status; return e; };
  /* Onshape answers 429 (too many calls) or 503 when busy: wait as asked, up to 5 tries */
  var get=function(u,n){ n=n||0; return fetch(u,{credentials:cred,headers:{Accept:"application/json"}}).then(function(r){
    if((r.status===429||r.status===503)&&n<5){ var s=+r.headers.get("Retry-After"); return new Promise(function(ok){ setTimeout(ok,(s>0?s*1000:1500*Math.pow(2,n))); }).then(function(){ return get(u,n+1); }); }
    if(r.status===401||r.status===403) throw fail(opt.denied||("Onshape said you aren't allowed to read it ("+r.status+"): sign in to Onshape in this browser"),r.status);
    if(!r.ok) throw fail("Onshape said "+r.status,r.status); return r.json(); }); };
  /* a point as Onshape writes it: [x,y,z] or {x,y,z}, in metres */
  var P=function(p,k){ return Array.isArray(p)?+p[k]:p?+p["xyz"[k]]:NaN; };
  /* one part studio: each part's triangles (part studio frame, metres) and the colour that covers most of it */
  var compact=function(tess){
    var out={}, bodies=Array.isArray(tess)?tess:((tess&&tess.bodies)||[]);
    bodies.forEach(function(b){
      var n=0, best=null, bestA=-1, area={};
      (b.faces||[]).forEach(function(f){ (f.facets||[]).forEach(function(){ n++; }); });
      var tri=new Float32Array(n*9), o=0;
      (b.faces||[]).forEach(function(f){
        var c=f.color||f.appearance||null, key=JSON.stringify(c), a=0;
        (f.facets||[]).forEach(function(fc){ var v=fc.vertices; if(!v||v.length<3) return;
          var at=o;
          for(var q=0;q<3;q++){ tri[o++]=P(v[q],0); tri[o++]=P(v[q],1); tri[o++]=P(v[q],2); }
          var ux=tri[at+3]-tri[at],uy=tri[at+4]-tri[at+1],uz=tri[at+5]-tri[at+2],wx=tri[at+6]-tri[at],wy=tri[at+7]-tri[at+1],wz=tri[at+8]-tri[at+2];
          a+=Math.hypot(uy*wz-uz*wy,uz*wx-ux*wz,ux*wy-uy*wx); });
        if(c){ area[key]=(area[key]||0)+a; if(area[key]>bestA){ bestA=area[key]; best=c; } }
      });
      out[b.id]={name:b.name||b.id, tri:o<tri.length?tri.slice(0,o):tri, color:best||b.color||b.appearance||null};
    });
    return out;
  };
  var mass=function(mp){ var out={}, B=mp&&mp.bodies; if(B) for(var id in B){ var x=B[id], kg=Array.isArray(x.mass)?x.mass[0]:x.mass; if(kg>0) out[id]={kg:kg,com:x.centroid?x.centroid.slice(0,3):null}; } return out; };
  say("Reading the assembly …");
  return Promise.all([
    get(base+"?includeMateFeatures=true&includeMateConnectors=true&includeNonSolids=false&excludeSuppressed=true").catch(function(e){
      // a Part Studio or a drawing has no assembly definition: Onshape answers 400 or 404
      if(e.status===400||e.status===404) throw fail("this isn't an assembly",e.status); throw e; }),
    get(base+"/features").catch(function(){ return null; })])
  .then(function(r){
    var asm=r[0], features=r[1];
    if(!asm||!asm.rootAssembly) throw fail("this isn't an assembly");
    var jobs=[], seen={};
    [asm.rootAssembly].concat(asm.subAssemblies||[]).forEach(function(a){ (a.instances||[]).forEach(function(i){
      if(i.type!=="Part"||i.suppressed) return;
      var ver=i.documentVersion?"v/"+i.documentVersion:"m/"+i.documentMicroversion, key=i.documentId+"/"+ver+"/e/"+i.elementId+"|"+(i.configuration||"");
      if(seen[key]) return; seen[key]=1; jobs.push({key:key,i:i,ver:ver});
    }); });
    var geom={}, done=0, at=0;
    var one=function(){
      if(at>=jobs.length) return Promise.resolve();
      var j=jobs[at++], i=j.i, ps=host+"/api/partstudios/d/"+i.documentId+"/"+j.ver+"/e/"+i.elementId;
      var q="?configuration="+encodeURIComponent(i.configuration||"")+(i.documentId!==ref.did?"&linkDocumentId="+ref.did:"");
      return Promise.all([
        get(ps+"/tessellatedfaces"+q+"&outputFaceAppearances=true&outputFacetNormals=false&chordTolerance=0.0015&angleTolerance=0.35"),
        get(ps+"/massproperties"+q+"&massAsGroup=false").catch(function(){ return null; })
      ]).then(function(t){ geom[j.key]={parts:compact(t[0]),mass:mass(t[1])}; },function(e){ if(e&&e.status===401) throw e; geom[j.key]=null; })
        .then(function(){ done++; say("Reading part shapes: "+done+" of "+jobs.length+" part studios …",done,jobs.length); return one(); });
    };
    return Promise.all([one(),one(),one(),one()]).then(function(){ return {asm:asm, features:features, geom:geom}; });
  });
}
/* An Onshape document address: its host and the assembly it points at, or null. */
function onshapeRef(href){
  var m=/^(https:\/\/[a-z0-9-]+\.onshape\.com)\/documents\/([0-9a-f]{24})\/(w|v|m)\/([0-9a-f]{24})\/e\/([0-9a-f]{24})/i.exec(String(href||"").trim());
  return m?{host:m[1], did:m[2], wvm:m[3].toLowerCase(), wvmid:m[4], eid:m[5]}:null;
}

/* The bookmark itself: this function's source, run on an Onshape tab with
   onshapeRead's source as read. It uses nothing from SimBench, only the
   browser. SB is SimBench's address. It reads the robot with the team's own
   sign-in, then hands it to the SimBench tab it opened, by postMessage (no
   size limit, never through a server). */
function onshapeGrab(SB, read){
  var m=/^(.*)\/documents\/([0-9a-f]{24})\/(w|v|m)\/([0-9a-f]{24})\/e\/([0-9a-f]{24})/i.exec(location.href);
  if(!m){ alert("Open your robot's assembly in Onshape (the assembly tab, not a Part Studio), then click the SimBench bookmark again."); return; }
  var host=m[1], ref={did:m[2], wvm:m[3], wvmid:m[4], eid:m[5]};
  var name=String(document.title||"").replace(/\s*[|\-–]\s*Onshape\s*$/i,"").trim()||"Onshape assembly";
  var sbOrigin=new URL(SB).origin;
  /* open the tab now, while the click still counts; it says it's ready, then gets the robot */
  var w=window.open(SB+"#onshape-wait","ftcsimbench_onshape");
  var ready=false, payload=null, sent=false, failed=false;
  var say=function(t,d,n){ try{ if(w&&!w.closed) w.postMessage({type:"simbench-progress",text:t,done:d,total:n},sbOrigin); }catch(e){} };
  var send=function(){ if(sent||!ready||!payload) return; sent=true; try{ w.postMessage(payload,sbOrigin); }catch(e){ sent=false; save(); } };
  var save=function(){
    /* no SimBench tab, or it never answered: one file to drop into SimBench instead */
    var j=JSON.stringify(payload,function(k,v){ return v instanceof Float32Array?Array.from(v,function(x){ return Math.round(x*1e5)/1e5; }):v; });
    var a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([j],{type:"application/json"}));
    a.download=name.replace(/[\\/:*?"<>|]+/g,"_")+".onshape.json";
    document.body.appendChild(a); a.click(); a.remove();
    alert("Saved \""+a.download+"\". Drop it into SimBench: it is the whole robot, joints and all.");
  };
  window.addEventListener("message",function(e){ if(e.origin===sbOrigin&&e.data&&e.data.type==="simbench-ready"){ ready=true; send(); } });
  read(host, ref, {cred:"include", say:say})
  .then(function(r){
    payload={format:"ftc-simbench.onshape", v:2, name:name, url:location.href, asm:r.asm, features:r.features, geom:r.geom};
    if(!w||w.closed){ save(); return; }
    send();
    /* the SimBench tab never said it was ready: the file instead */
    setTimeout(function(){ if(!sent&&!failed){ failed=true; save(); } },30000);
  })
  .catch(function(e){
    if(w&&!w.closed) try{ w.close(); }catch(x){}
    alert("SimBench couldn't read this assembly from Onshape: "+e.message+". Open the assembly tab (not a Part Studio) while signed in, and try again.");
  });
}
/* The bookmark's address, for a SimBench at sb (its own address). */
function onshapeBookmarklet(sb){
  return "javascript:"+encodeURIComponent("("+onshapeGrab.toString()+")("+JSON.stringify(String(sb).replace(/#.*$/,""))+","+onshapeRead.toString()+");void 0");
}

/* ---- Sign in with Onshape (functions/onshape): works where bookmarks are blocked ---- */
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
   Resolves to the same payload the bookmark sends. */
async function onshapeFromLink(href, say){
  const ref=onshapeRef(href);
  if(!ref) throw new Error("that isn't an Onshape document link. Open your assembly in Onshape and copy the whole address from the address bar");
  const host=new URL("onshape",location.href).href.replace(/\/$/,"");
  const denied="Onshape says you can't read it: sign in again, and make sure the document is yours or shared with you";
  let name="";
  try{ const r=await fetch(host+"/api/documents/"+ref.did,{credentials:"same-origin",headers:{Accept:"application/json"}}); if(r.ok) name=String((await r.json()).name||""); }catch(e){}
  const r=await onshapeRead(host, ref, {cred:"same-origin", say, denied});
  return {format:ONSHAPE_FORMAT, v:2, name:name||"Onshape assembly", url:String(href).trim(), asm:r.asm, features:r.features, geom:r.geom};
}

/* ---- the SimBench side: the #onshape= fragment, back into the two JSON documents ---- */
function onshapeBytes(s){
  s=String(s||"").replace(/-/g,"+").replace(/_/g,"/");
  if(!/^[A-Za-z0-9+/]*$/.test(s)) throw new Error("the link is damaged");
  while(s.length%4) s+="=";
  const bin=atob(s), u=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  return u;
}
async function readOnshapeHash(h){
  if(typeof DecompressionStream!=="function") throw new Error("this browser can't unpack it; use the manual steps below");
  const bytes=onshapeBytes(h);
  if(bytes.length>20e6) throw new Error("the link is too big");
  // gzip or nothing: some decompressors never finish on data that isn't
  if(bytes.length<18||bytes[0]!==0x1f||bytes[1]!==0x8b) throw new Error("the link is damaged");
  let text, timer;
  try{
    text=await Promise.race([
      new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text(),
      new Promise((_,no)=>{ timer=setTimeout(()=>no(new Error("timeout")),15000); })]);
  }catch(e){ throw new Error("the link is damaged"); }
  finally{ clearTimeout(timer); }
  let p; try{ p=JSON.parse(text); }catch(e){ throw new Error("the link is damaged"); }
  return checkOnshapePayload(p);
}
/* What came in is untrusted: keep only the documents, the shapes, and a short name and address. */
function checkOnshapePayload(p){
  if(!p||typeof p!=="object"||p.format!==ONSHAPE_FORMAT) throw new Error("it isn't mates from the SimBench bookmark");
  if(!p.asm||typeof p.asm!=="object"||!p.asm.rootAssembly||typeof p.asm.rootAssembly!=="object") throw new Error("it has no assembly definition");
  const f=p.features, features=f&&(Array.isArray(f)||(typeof f==="object"&&Array.isArray(f.features)))?f:null;
  const str=v=>typeof v==="string"?v.slice(0,200):"";
  const url=/^https:\/\/([a-z0-9-]+\.)*onshape\.com\//i.test(str(p.url))?str(p.url):"";
  // the shapes: part studio key -> {parts: id -> {name, tri (numbers), color}, mass}
  let geom=null;
  if(p.geom&&typeof p.geom==="object"){
    geom={};
    let tris=0;
    for(const k of Object.keys(p.geom).slice(0,5000)){
      const g=p.geom[k]; if(!g||typeof g!=="object"||!g.parts||typeof g.parts!=="object") continue;
      const parts={};
      for(const id of Object.keys(g.parts).slice(0,2000)){
        const b=g.parts[id]; if(!b) continue;
        const t=b.tri; if(!(t instanceof Float32Array||Array.isArray(t))) continue;
        tris+=t.length/9; if(tris>8e6) throw new Error("the robot is too big to draw");
        parts[id]={name:str(b.name), tri:t, color:b.color==null?null:(typeof b.color==="object"||typeof b.color==="string"?b.color:null)};
      }
      geom[k]={parts, mass:g.mass&&typeof g.mass==="object"?g.mass:{}};
    }
  }
  return {name:str(p.name).trim()||"Onshape assembly", url, asm:p.asm, features, geom};
}
