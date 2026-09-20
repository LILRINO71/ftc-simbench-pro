/* ============================================================
   2.  STEP PARSER
   ============================================================ */

/* Split the DATA section into entity records. A record ends at ';', but a
   STEP string can legally contain ';' (a part called "Bracket; left"), and
   any exporter may leave /* comments *\/ between records — splitting naively
   on ';' silently drops or corrupts entities in both cases. This jumps
   string-to-string with indexOf, so it stays fast on a 50 MB file. */
function splitStepRecords(s){
  const out=[]; const n=s.length;
  let start=0, i=0, pending="";
  // next ';', quote and comment, refreshed only once the cursor passes them —
  // re-scanning from the cursor every step would be quadratic on a big file
  let ns=s.indexOf(";"), nq=s.indexOf("'"), nc=s.indexOf("/*");
  for(;;){
    if(ns>=0&&ns<i) ns=s.indexOf(";",i);
    if(ns<0) break;
    if(nq>=0&&nq<i) nq=s.indexOf("'",i);
    if(nc>=0&&nc<i) nc=s.indexOf("/*",i);
    const q=nq<0?n:nq, c=nc<0?n:nc;
    if(q<ns&&q<c){                               // skip a string, honouring '' escapes
      let j=q+1;
      for(;;){ const k=s.indexOf("'",j); if(k<0){ j=n; break; }
        if(s.charCodeAt(k+1)===39){ j=k+2; continue; } j=k+1; break; }
      i=j; continue;
    }
    if(c<ns){                                    // drop a comment, keep the text around it
      pending+=s.slice(start,c);
      const e=s.indexOf("*/",c+2); start=i=(e<0?n:e+2);
      continue;
    }
    out.push((pending+s.slice(start,ns)).replace(/\r?\n/g," "));
    pending=""; start=i=ns+1;
  }
  return out;
}

function parseSTEP(text, onProgress){
  const di = text.indexOf("DATA;");
  const body = (di<0? text : text.slice(di+5));
  const recs = splitStepRecords(body);
  onProgress && onProgress("records "+recs.length.toLocaleString());

  const ents = new Map();
  const pts  = [];
  const reHead = /^\s*#(\d+)\s*=\s*(.*)$/;
  const reSimple = /^([A-Z_0-9]+)\s*\(([\s\S]*)\)\s*$/;
  const reCP = /^CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)/;

  for(let i=0;i<recs.length;i++){
    const m = reHead.exec(recs[i]); if(!m) continue;
    const id = +m[1]; const rest = m[2].trim();
    const cp = reCP.exec(rest);
    if(cp){
      const a = cp[1].split(",");
      if(a.length===3){ const x=+a[0],y=+a[1],z=+a[2];
        if(x===x&&y===y&&z===z) pts.push(x,y,z); }
    }
    if(rest.charAt(0)==="("){
      const parts=[]; const inner=rest.slice(1,-1);
      const rt=/([A-Z_0-9]+)\s*\(/g; let mm;
      while((mm=rt.exec(inner))){
        let d=0,j=mm.index+mm[0].length-1; const s=j; let ins=false;
        for(;j<inner.length;j++){ const c=inner[j];
          if(ins){ if(c==="'") ins=false; continue; }
          if(c==="'") ins=true; else if(c==="(") d++; else if(c===")"){ d--; if(!d) break; } }
        parts.push([mm[1], inner.slice(s+1,j)]); rt.lastIndex=j;
      }
      if(parts.length) ents.set(id,parts);
    }else{
      const s = reSimple.exec(rest);
      if(s) ents.set(id,[[s[1], s[2]]]);
    }
  }
  onProgress && onProgress("entities "+ents.size.toLocaleString());

  const A = s => { const out=[]; let d=0,cur="",ins=false;
    for(let i=0;i<s.length;i++){ const c=s[i];
      if(ins){ cur+=c; if(c==="'") ins=false; continue; }
      if(c==="'"){ins=true;cur+=c;} else if(c==="("){d++;cur+=c;} else if(c===")"){d--;cur+=c;}
      else if(c===","&&!d){out.push(cur.trim());cur="";} else cur+=c; }
    if(cur.trim()) out.push(cur.trim()); return out; };
  const S = x => { x=(x||"").trim();
    return x.startsWith("'")? x.slice(1,-1).replace(/''/g,"'").replace(/\\X2\\[0-9A-F]{4}\\X0\\/g,"").replace(/\\X\\[0-9A-F]{2}/g,"") : x; };
  const T = (id,want)=>{ const e=ents.get(id); if(!e) return null;
    for(const pr of e) if(pr[0]===want) return pr[1]; return null; };
  const REF = x => { x=(x||"").trim(); return x.startsWith("#")? +x.slice(1) : null; };

  const products=new Map(), pdf=new Map(), pd=new Map();
  for(const [id,e] of ents) for(const [t,a] of e){
    if(t==="PRODUCT") products.set(id,S(A(a)[0]));
    else if(t.indexOf("PRODUCT_DEFINITION_FORMATION")===0) pdf.set(id,REF(A(a)[2]));
    else if(t==="PRODUCT_DEFINITION") pd.set(id,REF(A(a)[2]));
  }
  const pname = r => { const f=pd.get(r); return f==null?null:(products.get(pdf.get(f))||null); };
  const clean = s => (s||"").replace(/\s*<\d+>\s*$/,"").trim();

  const nauo=new Map(), kids=new Map(), asChild=new Set();
  for(const [id,e] of ents) for(const [t,a] of e){
    if(t==="NEXT_ASSEMBLY_USAGE_OCCURRENCE"){
      const g=A(a), p=REF(g[3]), c=REF(g[4]);
      if(p!=null&&c!=null){ nauo.set(id,[p,c]); if(!kids.has(p)) kids.set(p,[]); kids.get(p).push(c); asChild.add(c); }
    }
  }
  const pdshape=new Map();
  for(const [id,e] of ents) for(const [t,a] of e) if(t==="PRODUCT_DEFINITION_SHAPE") pdshape.set(id,REF(A(a)[2]));
  const coords = ref => { const a=T(ref,"CARTESIAN_POINT")||T(ref,"DIRECTION"); if(!a) return null;
    const g=A(a)[1]; if(!g||g[0]!=="(") return null;
    return g.slice(1,-1).split(",").map(Number); };

  let scale=1;
  for(const [id,e] of ents){
    const names=e.map(x=>x[0]);
    if(names.indexOf("LENGTH_UNIT")>=0 && names.indexOf("SI_UNIT")>=0){
      const a=e.filter(x=>x[0]==="SI_UNIT")[0][1];
      scale = /MILLI/.test(a) ? 0.001 : 1;
      break;
    }
  }

  /* ===== assembly transforms =====
     Part geometry is usually stored in the part's OWN coordinates and placed
     by the assembly. Drawing the raw points piles most of the robot on the
     origin, so walk the occurrence tree and compose the transforms. */
  const nrm=v=>{const L=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/L,v[1]/L,v[2]/L];};
  const crs=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dt3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const IDM={r:[[1,0,0],[0,1,0],[0,0,1]],t:[0,0,0]};
  function matOf(id){
    const a=T(id,"AXIS2_PLACEMENT_3D"); if(!a) return null;
    const g=A(a);
    const p=coords(REF(g[1]))||[0,0,0];
    let z=(g[2]&&g[2][0]==="#")?coords(REF(g[2])):[0,0,1]; z=nrm(z||[0,0,1]);
    let x=(g[3]&&g[3][0]==="#")?coords(REF(g[3])):null;
    if(!x) x=Math.abs(z[0])<0.9?[1,0,0]:[0,1,0];
    const dd=dt3(x,z); x=nrm([x[0]-dd*z[0],x[1]-dd*z[1],x[2]-dd*z[2]]);
    return {r:[x,crs(z,x),z], t:p};
  }
  const applyM=(M,v)=>[
    M.r[0][0]*v[0]+M.r[1][0]*v[1]+M.r[2][0]*v[2]+M.t[0],
    M.r[0][1]*v[0]+M.r[1][1]*v[1]+M.r[2][1]*v[2]+M.t[1],
    M.r[0][2]*v[0]+M.r[1][2]*v[1]+M.r[2][2]*v[2]+M.t[2]];
  function mulM(Ma,Mb){
    const r=[[0,0,0],[0,0,0],[0,0,0]];
    for(let i=0;i<3;i++) for(let j=0;j<3;j++)
      r[i][j]=Ma.r[0][j]*Mb.r[i][0]+Ma.r[1][j]*Mb.r[i][1]+Ma.r[2][j]*Mb.r[i][2];
    return {r,t:applyM(Ma,Mb.t)};
  }
  function invM(M){
    const r=[[M.r[0][0],M.r[1][0],M.r[2][0]],
             [M.r[0][1],M.r[1][1],M.r[2][1]],
             [M.r[0][2],M.r[1][2],M.r[2][2]]];
    const t=applyM({r,t:[0,0,0]},M.t);
    return {r,t:[-t[0],-t[1],-t[2]]};
  }

  /* The rep a SHAPE_DEFINITION_REPRESENTATION names often holds only an axis
     placement; the real B-rep hangs off a plain SHAPE_REPRESENTATION_RELATIONSHIP.
     Ones that also carry ...WITH_TRANSFORMATION are assembly links, not geometry. */
  const geomLink=new Map();
  for(const [id,e] of ents){
    const names=e.map(x=>x[0]);
    if(names.indexOf("SHAPE_REPRESENTATION_RELATIONSHIP")<0) continue;
    if(names.indexOf("REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION")>=0) continue;
    const a=T(id,"SHAPE_REPRESENTATION_RELATIONSHIP")||T(id,"REPRESENTATION_RELATIONSHIP");
    if(!a) continue;
    const g=A(a), r1=REF(g[2]), r2=REF(g[3]);
    if(r1==null||r2==null) continue;
    if(!geomLink.has(r1)) geomLink.set(r1,[]);
    geomLink.get(r1).push(r2);
    if(!geomLink.has(r2)) geomLink.set(r2,[]);
    geomLink.get(r2).push(r1);
  }
  const repOfPd=new Map();
  for(const [id,e] of ents) for(const [t,a] of e) if(t==="SHAPE_DEFINITION_REPRESENTATION"){
    const g=A(a), owner=pdshape.get(REF(g[0]));
    if(owner!=null) repOfPd.set(owner,REF(g[1]));
  }
  const refs=new Map();
  const rePat=/#(\d+)/g;
  for(const [id,e] of ents){
    const s=[]; let mm;
    for(const pr of e){ rePat.lastIndex=0; while((mm=rePat.exec(pr[1]))) s.push(+mm[1]); }
    refs.set(id,s);
  }
  const blockCross=new Set();
  for(const [id,e] of ents) for(const [t,a] of e)
    if(t==="MAPPED_ITEM"||t==="REPRESENTATION_MAP"||t==="CONTEXT_DEPENDENT_SHAPE_REPRESENTATION") blockCross.add(id);
  const ptCache=new Map();
  function localPoints(rep){
    if(ptCache.has(rep)) return ptCache.get(rep);
    const seeds=[rep].concat(geomLink.get(rep)||[]);
    const out=[]; const seen=new Set(seeds); const stack=seeds.slice();
    while(stack.length){
      const n=stack.pop();
      const cp=T(n,"CARTESIAN_POINT");
      if(cp){ const g=A(cp)[1];
        if(g&&g[0]==="("){ const v=g.slice(1,-1).split(",").map(Number);
          if(v.length===3&&v[0]===v[0]&&v[1]===v[1]&&v[2]===v[2]) out.push(v); } }
      for(const r of refs.get(n)||[]){
        if(seen.has(r)||blockCross.has(r)) continue;
        seen.add(r); stack.push(r);
      }
    }
    ptCache.set(rep,out); return out;
  }

  const xfOfNauo=new Map();
  for(const [id,e] of ents){
    const cd=T(id,"CONTEXT_DEPENDENT_SHAPE_REPRESENTATION"); if(!cd) continue;
    const g=A(cd), rr=REF(g[0]), ps=REF(g[1]);
    const rt=T(rr,"REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION"); if(!rt) continue;
    const idt=REF(A(rt)[0]); const b=T(idt,"ITEM_DEFINED_TRANSFORMATION"); if(!b) continue;
    /* The second placement of the pair is the occurrence's position; the first
       is the source frame and is near-identity. Verified against both sample
       assemblies — using the composed pair mirrors the model. */
    const ga=A(b), m2=matOf(REF(ga[3]));
    const nk=pdshape.get(ps);
    if(nk==null||!m2) continue;
    xfOfNauo.set(nk, m2);
  }

  const kidsOcc=new Map(), childSet=new Set();
  for(const [id,pr] of nauo){
    if(!kidsOcc.has(pr[0])) kidsOcc.set(pr[0],[]);
    kidsOcc.get(pr[0]).push({nauo:id, pd:pr[1]});
    childSet.add(pr[1]);
  }
  const treeRoots=[...kidsOcc.keys()].filter(k=>!childSet.has(k));

  const occs=[];            // every placed occurrence, with its global transform
  let totalPts=0;
  function walkOcc(pdid,M,depth,viaNauo){
    if(pdid==null||depth>12) return;
    const rep=repOfPd.get(pdid);
    if(rep!=null) totalPts+=localPoints(rep).length;
    occs.push({pd:pdid, M, rep, nauo:viaNauo});
    for(const k of (kidsOcc.get(pdid)||[]))
      walkOcc(k.pd, mulM(M, xfOfNauo.get(k.nauo)||IDM), depth+1, k.nauo);
  }
  walkOcc(treeRoots.length?treeRoots[0]:null, IDM, 0, null);

  /* Two conventions exist in the wild. Some exporters bake each part's world
     position into its geometry; others store it locally and rely on the
     assembly transform. Transforming an already-baked file smears it, so ask
     the file directly: is a part's own centroid near ITS OWN origin (local),
     or already near where the assembly puts it (global)? */
  let sLocal=0, sGlobal=0, samples=0;
  for(const o of occs){
    if(o.rep==null||o.nauo==null) continue;
    const lp=localPoints(o.rep);
    if(lp.length<12) continue;
    const c=[0,0,0];
    for(const v of lp){ c[0]+=v[0]; c[1]+=v[1]; c[2]+=v[2]; }
    c[0]/=lp.length; c[1]/=lp.length; c[2]/=lp.length;
    // compare against this occurrence's OWN transform, not the accumulated one,
    // which is already meaningless if the file turns out to be baked
    const Td=xfOfNauo.get(o.nauo); if(!Td) continue;
    const t=Td.t;
    if(Math.hypot(t[0],t[1],t[2])<1e-6) continue;
    sLocal  += Math.hypot(c[0],c[1],c[2]);
    sGlobal += Math.hypot(c[0]-t[0],c[1]-t[1],c[2]-t[2]);
    samples++;
  }
  const bakedGlobal = samples>4 && sGlobal < sLocal*0.75;
  onProgress && onProgress(bakedGlobal?"geometry already placed":"applying assembly transforms");

  // ---- emit the point cloud, strided to something a browser can draw
  const TARGET=130000;
  const raw=[];
  if(bakedGlobal){
    const st=Math.max(1,Math.ceil(pts.length/3/TARGET));
    for(let i=0,n=0;i<pts.length;i+=3,n++){
      if(n%st) continue;
      raw.push([pts[i]*scale,pts[i+1]*scale,pts[i+2]*scale]);
    }
  }else{
    const stride=Math.max(1,Math.ceil(totalPts/TARGET));
    let seq=0;
    for(const o of occs){
      if(o.rep==null) continue;
      const lp=localPoints(o.rep);
      for(let i=0;i<lp.length;i++){
        if((seq++ % stride)!==0) continue;
        const v=applyM(o.M,lp[i]);
        raw.push([v[0]*scale,v[1]*scale,v[2]*scale]);
      }
    }
  }

  // ---- occurrence placements
  const placements=[];
  if(bakedGlobal){
    // positions are already world-space in the occurrence's own placement
    for(const [id,e] of ents){
      const cd=T(id,"CONTEXT_DEPENDENT_SHAPE_REPRESENTATION"); if(!cd) continue;
      const g=A(cd), rr=REF(g[0]), ps=REF(g[1]);
      const rt=T(rr,"REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION"); if(!rt) continue;
      const idt=REF(A(rt)[0]); const b=T(idt,"ITEM_DEFINED_TRANSFORMATION"); if(!b) continue;
      const a2=matOf(REF(A(b)[3])); if(!a2) continue;
      const nk=pdshape.get(ps); if(nk==null||!nauo.has(nk)) continue;
      const pr=nauo.get(nk);
      placements.push({nauo:nk, parent:clean(pname(pr[0])), child:clean(pname(pr[1])),
                       loc:[a2.t[0]*scale,a2.t[1]*scale,a2.t[2]*scale],
                       axis:[a2.r[2][0],a2.r[2][1],a2.r[2][2]]});
    }
  }else{
    for(const o of occs){
      if(o.nauo==null||!nauo.has(o.nauo)) continue;
      const pr=nauo.get(o.nauo);
      placements.push({nauo:o.nauo, parent:clean(pname(pr[0])), child:clean(pname(pr[1])),
                       loc:[o.M.t[0]*scale,o.M.t[1]*scale,o.M.t[2]*scale],
                       axis:[o.M.r[2][0],o.M.r[2][1],o.M.r[2][2]]});
    }
  }

  // ---- drop unbounded-surface construction points
  const src = raw.length? raw : (function(){ const a=[];
    for(let i=0;i<pts.length;i+=3) a.push([pts[i]*scale,pts[i+1]*scale,pts[i+2]*scale]); return a; })();
  const q=(arr,p)=>{ const s=Float64Array.from(arr).sort(); return s[Math.min(s.length-1,Math.max(0,Math.floor(s.length*p)))]; };
  const lim = k => { if(!src.length) return [-1,1];
    const col=src.map(v=>v[k]); const a=q(col,0.01), b=q(col,0.99), pad=(b-a)*0.22+1e-9; return [a-pad,b+pad]; };
  const L0=lim(0), L1=lim(1), L2=lim(2);
  const P=[]; const mn=[1e18,1e18,1e18], mx=[-1e18,-1e18,-1e18];
  for(const p of src){
    if(p[0]<L0[0]||p[0]>L0[1]||p[1]<L1[0]||p[1]>L1[1]||p[2]<L2[0]||p[2]>L2[1]) continue;
    P.push(p);
    for(let k=0;k<3;k++){ if(p[k]<mn[k])mn[k]=p[k]; if(p[k]>mx[k])mx[k]=p[k]; }
  }
  if(!P.length){ mn[0]=mn[1]=mn[2]=-0.25; mx[0]=mx[1]=mx[2]=0.25; }

  /* ---- solids: each leaf part's own points, placed, so the view can draw
     the robot as parts instead of a cloud. Assemblies only hold placements. */
  const solids=[];
  for(const o of occs){
    if(o.rep==null||kidsOcc.has(o.pd)) continue;
    const lp=localPoints(o.rep); if(lp.length<4) continue;
    const w=[]; const smn=[1e18,1e18,1e18], smx=[-1e18,-1e18,-1e18];
    for(const v0 of lp){
      const v=bakedGlobal?v0:applyM(o.M,v0);
      const p=[v[0]*scale,v[1]*scale,v[2]*scale];
      if(p[0]<L0[0]||p[0]>L0[1]||p[1]<L1[0]||p[1]>L1[1]||p[2]<L2[0]||p[2]>L2[1]) continue;
      w.push(p);
      for(let k=0;k<3;k++){ if(p[k]<smn[k])smn[k]=p[k]; if(p[k]>smx[k])smx[k]=p[k]; }
    }
    if(w.length<4) continue;
    const size=Math.hypot(smx[0]-smn[0],smx[1]-smn[1],smx[2]-smn[2]);
    if(size<0.006) continue;                   // washers and grub screws
    const raw=pname(o.pd)||"", pm=/(\d{4}-\d{4}-\d{1,4}|REV-\d{2}-\d{4})/.exec(raw);
    solids.push({name:clean(raw), part:pm?pm[1]:null, kind:solidKind(raw,pm?pm[1]:null), size, pts:thinPoints(w,120)});
  }
  solids.sort((a,b)=>b.size-a.size);
  if(solids.length>1800) solids.length=1800;
  onProgress && onProgress(solids.length+" parts");

  // ---- parts inventory
  const counts=new Map(), partNo=new Map();
  for(const [id,pr] of nauo){
    const raw=pname(pr[1]); if(!raw) continue;
    const n=clean(raw);
    counts.set(n,(counts.get(n)||0)+1);
    const pm=/(\d{4}-\d{4}-\d{1,4}|REV-\d{2}-\d{4})/.exec(raw);
    if(pm) partNo.set(n,pm[1]);
  }
  const parts=[];
  for(const [name,n] of counts){
    const pn=partNo.get(name)||null;
    const hw=hwFromPart(pn,name);
    parts.push({name, part:pn, n, kind:hw?hw.kind:"struct"});
  }

  // ---- mechanisms
  const roots=[...kids.keys()].filter(k=>asChild.has(k)===false);
  const mechs=[];
  const partOf = raw => { const m=/(\d{4}-\d{4}-\d{1,4}|REV-\d{2}-\d{4})/.exec(raw||""); return m?m[1]:null; };
  const hwOf = c => { const raw=pname(c)||""; return hwFromPart(partOf(raw), clean(raw)); };
  const isAct = h => !!h && (h.kind==="servo"||h.kind==="motor"||h.kind==="crservo");

  /* A real export is usually wrapped: "Into The Deep" → "CURRENT Robot CAD"
     → the actual parts. Walk down past levels that just hold one sub-assembly,
     or nothing would be found but a single mechanism for the whole robot. */
  let work=roots[0], guard=0;
  while(work!=null && guard++<10){
    const cs=kids.get(work)||[];
    const subs=cs.filter(c=>kids.has(c));
    // only a node whose ONLY child is a subassembly is a wrapper; a robot
    // made of one subassembly plus one loose part is not
    if(cs.length===1 && subs.length===1 && !isAct(hwOf(subs[0]))) work=subs[0]; else break;
  }

  /* Two different questions with two different answers. "Is this occurrence
     itself an actuator?" is strict — "Servo Case" is not a servo. "Does this
     subassembly contain one?" is loose — a part called "Servo Case" inside it
     means a servo is modelled there, even with no part number anywhere. */
  const scanFor=(node,depth,out)=>{
    if(depth>6) return;
    for(const c of (kids.get(node)||[])){
      const nm=clean(pname(c)||"");
      const hw=hwOf(c);
      if(isAct(hw)&&!out.hw){ out.hw=hw; out.partName=nm; }
      else if(!out.hint&&!/\b(hub|control|expansion|port|battery|camera|sensor)\b/i.test(nm)){
        if(/\bservos?\b/i.test(nm)) out.hint=Object.assign({},GENERIC.Servo);
        else if(/\b(motor|gearmotor)s?\b/i.test(nm)) out.hint=Object.assign({},GENERIC.Motor);
      }
      scanFor(c,depth+1,out);
    }
  };
  const used={};
  const uniqueId = nm => {
    let id=nm||"mechanism";
    if(used[id]==null){ used[id]=1; return id; }
    used[id]++; return id+" #"+used[id];
  };

  /* One mechanism per occurrence, not per product name — a robot with four
     identical drive motors has four distinct joints. */
  for(const c of (kids.get(work)||[])){
    const raw=pname(c)||"", nm=clean(raw);
    const selfHw=hwOf(c);
    const out={hw:selfHw||null, partName:selfHw?nm:null, hint:null};
    if(!selfHw) scanFor(c,0,out);
    if(!out.hw && out.hint && kids.has(c)){ out.hw=out.hint; out.partName=nm; }
    /* Offer every subassembly, not only the ones holding a recognizable
       actuator — otherwise a robot with a dozen devices gets two choices in
       the hardware map. Ones with no actuator start as "fixed mount" so they
       sit out of the chain until you give them a joint type. */
    const isSub=kids.has(c);
    if(!out.hw && !isSub) continue;
    if(mechs.length>=40) break;

    let pivot=null, axis=[0,0,1], cluster=[];
    if(selfHw){
      // the actuator itself: use this occurrence's own placement
      const own=placements.filter(p=>p.child===nm && p.loc.some(v=>v!==0));
      const mine=own.shift();
      if(mine){ pivot=mine.loc.slice(); axis=mine.axis; cluster=[mine.loc.slice()]; }
      // don't let a later occurrence of the same part reuse this placement
      if(mine) mine.child="__used";
    }else{
      const own=placements.filter(p=>p.parent===nm && p.loc.some(v=>v!==0));
      cluster=own.map(p=>p.loc.slice());
      const mounts=own.filter(p=>/servo|mount|body|midcase|topcase|botcase|motor|bracket|gearbox/i.test(p.child||""));
      const isVert=p=>Math.abs(p.axis[2])>0.85;
      const tilted=mounts.filter(p=>!isVert(p));
      let pick=null;
      if(tilted.length)      pick=tilted.reduce((a,b)=>b.loc[2]>a.loc[2]?b:a);
      else if(mounts.length) pick=mounts.reduce((a,b)=>b.loc[2]<a.loc[2]?b:a);
      if(pick){ pivot=pick.loc.slice(); axis=pick.axis; }
      else if(own.length){
        const sm=[0,0,0]; own.forEach(p=>{sm[0]+=p.loc[0];sm[1]+=p.loc[1];sm[2]+=p.loc[2];});
        pivot=sm.map(v=>v/own.length);
      }
      if(!pivot){
        const self=placements.filter(p=>p.child===nm)[0];
        if(self) pivot=self.loc.slice();
      }
    }
    if(!pivot) continue;
    mechs.push({id:uniqueId(nm.slice(0,44)), part:out.hw?(out.hw.part||null):null,
                partName:out.partName||null, hasActuator:!!out.hw,
                axis, pivot, kind:out.hw?null:"fixed", distalTo:null, cluster});
  }
  classifyMechs(mechs);

  return {name:null, units:scale===1?"METRE":"MILLIMETRE", points:P, pointCount:P.length, solids,
          bbox:{min:mn,max:mx}, parts, mechs, placements};
}

/* ---- the rig: an explicit, editable kinematic chain ----
   Everything below is a first guess. On anything more involved than a single
   arm the guess will be wrong somewhere, so each field is editable in the
   Kinematics panel and the whole model rebuilds from whatever is in there. */
const JOINT_KINDS = {
  "revolute-yaw" :{label:"turret yaw",  hint:"swings everything above it around a vertical axis"},
  "revolute-lift":{label:"lift pivot",  hint:"raises and lowers what it carries — torque is checked here"},
  "linear"       :{label:"linear slide",hint:"extends along its axis"},
  "effector"     :{label:"end effector",hint:"grips or intakes; carries nothing further"},
  "fixed"        :{label:"fixed mount", hint:"does not move the structure"}
};
const centroidOf = m => {
  if(!m.cluster||!m.cluster.length) return m.pivot;
  const s=[0,0,0]; for(const p of m.cluster){s[0]+=p[0];s[1]+=p[1];s[2]+=p[2];}
  return s.map(v=>v/m.cluster.length);
};

function classifyMechs(mechs){
  const vert = a => Math.abs(a[2])>0.85;
  // only actuator-bearing mechanisms get a joint type inferred; the rest are
  // offered as mapping targets but stay out of the chain until typed by hand
  const act = mechs.filter(m=>m.kind!=="fixed");
  let yaw=null, lowest=1e18;
  for(const m of act){ if(m.pivot&&vert(m.axis)&&m.pivot[2]<lowest){lowest=m.pivot[2]; yaw=m;} }
  if(yaw) yaw.kind="revolute-yaw";
  let lift=null, high=-1e18;
  for(const m of act){ if(m===yaw||!m.pivot) continue;
    if(!vert(m.axis)&&m.pivot[2]>high){high=m.pivot[2]; lift=m;} }
  if(lift) lift.kind="revolute-lift";
  for(const m of act) if(!m.kind) m.kind="effector";

  /* Default chain: chassis → yaw → lift, plus the one effector actually within
     the lift's reach. Everything else mounts on the frame. On a robot with a
     dozen mechanisms, hanging them all off the lift would be confidently wrong;
     a flat default is honest and the Kinematics panel builds the real chain. */
  let span=0;
  for(const a of mechs) for(const b of mechs)
    if(a.pivot&&b.pivot) span=Math.max(span,Math.hypot(a.pivot[0]-b.pivot[0],a.pivot[1]-b.pivot[1],a.pivot[2]-b.pivot[2]));
  let nearEff=null, nd=1e18;
  if(lift) for(const m of act){
    if(m===lift||m===yaw||!m.pivot) continue;
    const dd=Math.hypot(m.pivot[0]-lift.pivot[0],m.pivot[1]-lift.pivot[1],m.pivot[2]-lift.pivot[2]);
    if(dd<nd){ nd=dd; nearEff=m; }
  }
  /* An arm's end effector sits closer to the elbow than the elbow does to the
     shoulder. Anything further away is its own thing, mounted on the frame. */
  const reach = (lift&&yaw)
    ? Math.hypot(lift.pivot[0]-yaw.pivot[0],lift.pivot[1]-yaw.pivot[1],lift.pivot[2]-yaw.pivot[2])
    : span*0.5;
  if(nearEff && nd>reach) nearEff=null;
  for(const m of mechs){
    m.inferred=true;
    m.dir=m.dir||1;
    m.leverOverride = (m.leverOverride===undefined)?null:m.leverOverride;
    if(m===yaw) m.parent="chassis";
    else if(m===lift) m.parent=yaw?yaw.id:"chassis";
    else if(m===nearEff) m.parent=lift.id;
    else m.parent="chassis";
  }
  recomputeChain(mechs);
}

/* Re-derive everything that depends on the chain. Called after any edit. */
function recomputeChain(mechs){
  const byId={}; mechs.forEach(m=>byId[m.id]=m);
  // guard against a parent loop the user might create
  for(const m of mechs){
    const seen={}; let p=m.parent, hops=0;
    while(p&&p!=="chassis"&&byId[p]&&hops++<32){
      if(seen[p]||p===m.id){ m.parent="chassis"; break; }
      seen[p]=1; p=byId[p].parent;
    }
    if(m.parent!=="chassis"&&!byId[m.parent]) m.parent="chassis";
  }
  for(const m of mechs){
    const kids=mechs.filter(k=>k.parent===m.id);
    // a joint reaches to whatever it carries; a leaf reaches across its own parts
    if(kids.length){
      const s=[0,0,0];
      kids.forEach(k=>{ s[0]+=k.pivot[0]; s[1]+=k.pivot[1]; s[2]+=k.pivot[2]; });
      m.distalTo=s.map(v=>v/kids.length);
    } else {
      const c=centroidOf(m);
      m.distalTo=(c===m.pivot)?null:c;
    }
    if(m.pivot&&m.distalTo){
      const d=[0,1,2].map(i=>m.distalTo[i]-m.pivot[i]);
      m.lever=Math.hypot(d[0],d[1],d[2]);
      m.restAngleDeg=Math.atan2(d[2],Math.hypot(d[0],d[1]))*180/Math.PI;
    } else { m.lever=0; m.restAngleDeg=0; }
  }
}
const mlabel = m => m ? (m.label||m.id) : "—";
const rigKids = (mechs,id) => mechs.filter(m=>m.parent===id);
const rigRoots = mechs => mechs.filter(m=>m.parent==="chassis");
function rigCarries(mechs,id){
  const out=[]; const walk=i=>{ for(const k of rigKids(mechs,i)){ out.push(k.id); walk(k.id); } };
  walk(id); return out;
}
const leverOf = m => (m && m.leverOverride!=null) ? m.leverOverride : (m?m.lever:0);

function travelDegOf(spec){ return (spec&&spec.travelDeg)||300; }
function armAngleDeg(mech,spec,pos,restPos){ return mech.restAngleDeg + (pos-restPos)*travelDegOf(spec); }
function holdTorque(mech,angDeg,distalKg){
  return distalKg*G*leverOf(mech)*Math.max(0.05,Math.abs(Math.cos(angDeg*Math.PI/180)));
}
function worstAngle(a0,a1){
  const lo=Math.min(a0,a1), hi=Math.max(a0,a1);
  if(lo<=0&&hi>=0) return 0;
  return Math.abs(lo)<Math.abs(hi)?lo:hi;
}
