/* ============================================================
   ONSHAPE → SIMBENCH IN ONE CLICK
   The exact joints are in the team's Onshape assembly (its mates). Getting
   them used to mean opening two API pages signed in to Onshape, saving each
   one and dropping both here. The "Send to SimBench" bookmark does the same
   thing in one click: run on the team's own assembly tab, signed in as
   them, it reads that assembly's definition and mate features from
   Onshape's API (the same two pages), packs them, and opens SimBench with
   them in the address's #fragment. A fragment never leaves the browser: no
   server, ours or anyone's, sees the robot. Nothing needs an API key.
   A very big assembly doesn't fit in an address; then it's saved as one
   .onshape.json file to drop in instead.
   ============================================================ */
const ONSHAPE_FORMAT="ftc-simbench.onshape";

/* The bookmark itself: this function's source, run on an Onshape tab. It
   uses nothing from SimBench, only the browser. SB is SimBench's address.
   It reads the assembly (parts, placements, mates), its features (limits),
   and, once per part studio the robot uses, that studio's tessellated
   shapes with their colours and its mass properties: the whole robot, no
   STEP. Then it hands all of it to the SimBench tab it opened, by
   postMessage (no size limit, never through a server). */
function onshapeGrab(SB){
  var m=/^(.*)\/documents\/([0-9a-f]{24})\/(w|v|m)\/([0-9a-f]{24})\/e\/([0-9a-f]{24})/i.exec(location.href);
  if(!m){ alert("Open your robot's assembly in Onshape (the assembly tab, not a Part Studio), then click the SimBench bookmark again."); return; }
  var host=m[1], did=m[2], base=host+"/api/assemblies/d/"+did+"/"+m[3]+"/"+m[4]+"/e/"+m[5];
  var name=String(document.title||"").replace(/\s*[|\-\u2013]\s*Onshape\s*$/i,"").trim()||"Onshape assembly";
  var sbOrigin=new URL(SB).origin;
  /* open the tab now, while the click still counts; it says it's ready, then gets the robot */
  var w=window.open(SB+"#onshape-wait","ftcsimbench_onshape");
  var ready=false, payload=null, sent=false, failed=false;
  var say=function(t){ try{ if(w&&!w.closed) w.postMessage({type:"simbench-progress",text:t},sbOrigin); }catch(e){} };
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
  var get=function(u){ return fetch(u,{credentials:"include",headers:{Accept:"application/json"}}).then(function(r){ if(!r.ok) throw new Error("Onshape said "+r.status); return r.json(); }); };
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
          for(var q=0;q<3;q++){ tri[o++]=v[q][0]; tri[o++]=v[q][1]; tri[o++]=v[q][2]; }
          var ux=v[1][0]-v[0][0],uy=v[1][1]-v[0][1],uz=v[1][2]-v[0][2],wx=v[2][0]-v[0][0],wy=v[2][1]-v[0][1],wz=v[2][2]-v[0][2];
          a+=Math.hypot(uy*wz-uz*wy,uz*wx-ux*wz,ux*wy-uy*wx); });
        if(c){ area[key]=(area[key]||0)+a; if(area[key]>bestA){ bestA=area[key]; best=c; } }
      });
      out[b.id]={name:b.name||b.id, tri:o<tri.length?tri.slice(0,o):tri, color:best||b.color||b.appearance||null};
    });
    return out;
  };
  var mass=function(mp){ var out={}, B=mp&&mp.bodies; if(B) for(var id in B){ var x=B[id], kg=Array.isArray(x.mass)?x.mass[0]:x.mass; if(kg>0) out[id]={kg:kg,com:x.centroid?x.centroid.slice(0,3):null}; } return out; };
  say("Reading the assembly …");
  Promise.all([get(base+"?includeMateFeatures=true&includeMateConnectors=true&includeNonSolids=false&excludeSuppressed=true"), get(base+"/features").catch(function(){ return null; })])
  .then(function(r){
    var asm=r[0], features=r[1];
    if(!asm||!asm.rootAssembly) throw new Error("this tab isn't an assembly");
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
      var q="?configuration="+encodeURIComponent(i.configuration||"")+(i.documentId!==did?"&linkDocumentId="+did:"");
      return Promise.all([
        get(ps+"/tessellatedfaces"+q+"&outputFaceAppearances=true&outputFacetNormals=false&chordTolerance=0.0015&angleTolerance=0.35"),
        get(ps+"/massproperties"+q+"&massAsGroup=false").catch(function(){ return null; })
      ]).then(function(t){ geom[j.key]={parts:compact(t[0]),mass:mass(t[1])}; },function(){ geom[j.key]=null; })
        .then(function(){ done++; say("Reading part shapes: "+done+" of "+jobs.length+" part studios …"); return one(); });
    };
    return Promise.all([one(),one(),one(),one()]).then(function(){
      payload={format:"ftc-simbench.onshape", v:2, name:name, url:location.href, asm:asm, features:features, geom:geom};
      if(!w||w.closed){ save(); return; }
      send();
      /* the SimBench tab never said it was ready: the file instead */
      setTimeout(function(){ if(!sent&&!failed){ failed=true; save(); } },30000);
    });
  })
  .catch(function(e){
    if(w&&!w.closed) try{ w.close(); }catch(x){}
    alert("SimBench couldn't read this assembly from Onshape: "+e.message+". Open the assembly tab (not a Part Studio) while signed in, and try again.");
  });
}
/* The bookmark's address, for a SimBench at sb (its own address). */
function onshapeBookmarklet(sb){
  return "javascript:"+encodeURIComponent("("+onshapeGrab.toString()+")("+JSON.stringify(String(sb).replace(/#.*$/,""))+");void 0");
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
