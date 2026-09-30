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
   uses nothing from SimBench, only the browser. SB is SimBench's address. */
function onshapeGrab(SB){
  var m=/^(.*)\/documents\/([0-9a-f]{24})\/(w|v|m)\/([0-9a-f]{24})\/e\/([0-9a-f]{24})/i.exec(location.href);
  if(!m){ alert("Open your robot's assembly in Onshape (the assembly tab, not a Part Studio), then click the SimBench bookmark again."); return; }
  var base=m[1]+"/api/assemblies/d/"+m[2]+"/"+m[3]+"/"+m[4]+"/e/"+m[5];
  var name=String(document.title||"").replace(/\s*[|\-–]\s*Onshape\s*$/i,"").trim()||"Onshape assembly";
  /* open the tab now, while the click still counts, and fill it in when the mates are read */
  var w=window.open("","ftcsimbench_onshape");
  try{ if(w){ w.document.title="SimBench"; w.document.body.innerHTML="<p style='font:16px system-ui,sans-serif;margin:40px'>Reading <b></b> from Onshape…</p>"; w.document.body.querySelector("b").textContent=name; } }catch(e){}
  var get=function(u){ return fetch(u,{credentials:"include",headers:{Accept:"application/json"}}).then(function(r){ if(!r.ok) throw new Error("Onshape said "+r.status); return r.json(); }); };
  Promise.all([get(base+"?includeMateFeatures=true&includeMateConnectors=true&includeNonSolids=false"), get(base+"/features").catch(function(){ return null; })])
  .then(function(r){
    var asm=r[0], features=r[1];
    if(!asm||!asm.rootAssembly) throw new Error("this tab isn't an assembly");
    var payload={format:"ftc-simbench.onshape", v:1, name:name, url:location.href, asm:asm, features:features};
    var json=JSON.stringify(payload);
    var packed=new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(packed).arrayBuffer().then(function(buf){
      var u=new Uint8Array(buf), s="";
      for(var i=0;i<u.length;i+=32768) s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));
      var b=btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
      if(b.length<1500000){
        var to=SB+"#onshape="+b;
        if(w&&!w.closed){ w.location.href=to; return; }
        if(window.open(to,"_blank")) return;
      }
      /* too big for an address, or no new tab allowed: one file to drop into SimBench */
      if(w&&!w.closed) try{ w.close(); }catch(e){}
      var a=document.createElement("a");
      a.href=URL.createObjectURL(new Blob([json],{type:"application/json"}));
      a.download=name.replace(/[\\/:*?"<>|]+/g,"_")+".onshape.json";
      document.body.appendChild(a); a.click(); a.remove();
      alert("Saved \""+a.download+"\". Drop it into SimBench's Mates & joints box, with the STEP of the same assembly.");
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
  let text;
  try{ text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); }
  catch(e){ throw new Error("the link is damaged"); }
  let p; try{ p=JSON.parse(text); }catch(e){ throw new Error("the link is damaged"); }
  return checkOnshapePayload(p);
}
/* What came in is untrusted: keep only the two documents and a short name and address. */
function checkOnshapePayload(p){
  if(!p||typeof p!=="object"||p.format!==ONSHAPE_FORMAT) throw new Error("it isn't mates from the SimBench bookmark");
  if(!p.asm||typeof p.asm!=="object"||!p.asm.rootAssembly||typeof p.asm.rootAssembly!=="object") throw new Error("it has no assembly definition");
  const f=p.features, features=f&&(Array.isArray(f)||(typeof f==="object"&&Array.isArray(f.features)))?f:null;
  const str=v=>typeof v==="string"?v.slice(0,200):"";
  const url=/^https:\/\/([a-z0-9-]+\.)*onshape\.com\//i.test(str(p.url))?str(p.url):"";
  return {name:str(p.name).trim()||"Onshape assembly", url, asm:p.asm, features};
}
