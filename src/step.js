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

/* A quoted STEP string, '' escapes included: blanked before looking for #refs. */
const STEP_STR=/'(?:[^']|'')*'/g;
function parseSTEP(text, onProgress, opts){
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

  /* ===== length unit =====
     The unit is whatever the representation context the shape lives in
     assigns (GLOBAL_UNIT_ASSIGNED_CONTEXT). An inch is a CONVERSION_BASED_UNIT
     whose LENGTH_MEASURE_WITH_UNIT says "25.4 of this MILLI METRE", so the
     first SI length unit in the file is the millimetre that DEFINES the inch —
     reading that made an inch robot 25.4x too small. */
  const SI_PREFIX={EXA:1e18,PETA:1e15,TERA:1e12,GIGA:1e9,MEGA:1e6,KILO:1e3,HECTO:1e2,DECA:1e1,
                   DECI:1e-1,CENTI:1e-2,MILLI:1e-3,MICRO:1e-6,NANO:1e-9,PICO:1e-12};
  const unitMemo=new Map();
  function lengthUnit(id,depth){                 // metres per unit, or null if not a length unit
    if(id==null||(depth|0)>6) return null;
    if(unitMemo.has(id)) return unitMemo.get(id);
    const e=ents.get(id); let m=null;
    if(e&&e.some(x=>x[0]==="LENGTH_UNIT")){
      const si=T(id,"SI_UNIT"), cb=T(id,"CONVERSION_BASED_UNIT");
      if(si!=null){
        const g=A(si), pre=(g[0]||"").replace(/\./g,"").trim(), nm=(g[1]||"").replace(/\./g,"").trim();
        if(nm==="METRE") m=SI_PREFIX[pre]||1;
      }else if(cb!=null){
        const mw=REF(A(cb)[1]);
        const mv=T(mw,"LENGTH_MEASURE_WITH_UNIT")||T(mw,"MEASURE_WITH_UNIT");
        if(mv!=null){
          const g=A(mv), num=/-?[\d.]+(?:[eE][-+]?\d+)?/.exec(g[0]||""), base=lengthUnit(REF(g[1]),(depth|0)+1);
          if(num&&base) m=(+num[0])*base;
        }
      }
    }
    unitMemo.set(id,m); return m;
  }
  function contextUnit(ctx){
    const g=T(ctx,"GLOBAL_UNIT_ASSIGNED_CONTEXT"); if(g==null) return null;
    for(const r of (A(g)[0]||"").replace(/[()]/g,"").split(",")){ const u=lengthUnit(REF(r)); if(u) return u; }
    return null;
  }
  const repContext = rep => { for(const [t,a] of (ents.get(rep)||[]))
      if(/REPRESENTATION$/.test(t)){ const g=A(a); if(g.length>=3) return REF(g[2]); }
    return null; };
  const repUnit = rep => contextUnit(repContext(rep));

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
    // not inside quoted names: a part called "#25 Roller Chain Loop" names no record
    for(const pr of e){ const a=pr[1].indexOf("'")<0?pr[1]:pr[1].replace(STEP_STR,"''");
      rePat.lastIndex=0; while((mm=rePat.exec(a))) s.push(+mm[1]); }
    refs.set(id,s);
  }
  const blockCross=new Set();
  for(const [id,e] of ents) for(const [t,a] of e)
    if(t==="MAPPED_ITEM"||t==="REPRESENTATION_MAP"||t==="CONTEXT_DEPENDENT_SHAPE_REPRESENTATION") blockCross.add(id);
  /* ===== the points ON a part =====
     Only what lies on the solid: its vertices, and its curved edges sampled
     along the arc they actually cover. Everything else a representation
     reaches is construction — the placement axes of the rep itself (a point
     at the part's origin, which put every part modelled in place a leg away
     from the origin), a circle's centre, a plane's or cylinder's location.
     Collecting those made parts too big, too heavy and the robot too wide. */
  const NOT_GEOM=/^(AXIS[12]_PLACEMENT(_[23]D)?|CARTESIAN_POINT|DIRECTION|VECTOR|LINE|CIRCLE|ELLIPSE|PCURVE|DEFINITIONAL_REPRESENTATION|PLANE)$|SURFACE(?!_MODEL)|CONTEXT|UNIT|STYLE|COLOUR/;
  const construction = id => { const e=ents.get(id); if(!e) return true;
    for(const x of e) if(x[0]!=="FACE_SURFACE"&&NOT_GEOM.test(x[0])) return true; return false; };
  const CURVE_SEG=32;                            // samples per full turn: under 0.3 mm sag on a 104 mm wheel
  const hasType = (id,re) => { const e=ents.get(id); if(!e) return false; for(const x of e) if(re.test(x[0])) return true; return false; };
  function edgeSamples(curve,v1,v2,sense,out,depth){
    if(curve==null||depth>4) return;
    const sc=T(curve,"SURFACE_CURVE")||T(curve,"SEAM_CURVE");
    if(sc!=null) return edgeSamples(REF(A(sc)[1]),v1,v2,sense,out,depth+1);
    const tc=T(curve,"TRIMMED_CURVE");            // the vertices still bound it
    if(tc!=null) return edgeSamples(REF(A(tc)[1]),v1,v2,sense,out,depth+1);
    const ci=T(curve,"CIRCLE"), el=T(curve,"ELLIPSE");
    if(ci!=null||el!=null){
      const g=A(ci!=null?ci:el), M=matOf(REF(g[1])); if(!M) return;
      const ra=+g[2], rb=ci!=null?ra:+g[3]; if(!(ra>0&&rb>0)) return;
      const ang=p=>{ const d=[p[0]-M.t[0],p[1]-M.t[1],p[2]-M.t[2]]; return Math.atan2(dt3(d,M.r[1])/rb, dt3(d,M.r[0])/ra); };
      const pa=coords(T(v1,"VERTEX_POINT")!=null?REF(A(T(v1,"VERTEX_POINT"))[1]):null);
      const pb=coords(T(v2,"VERTEX_POINT")!=null?REF(A(T(v2,"VERTEX_POINT"))[1]):null);
      // the curve runs counter-clockwise about its axis; an edge against the
      // curve's sense covers the arc from its end vertex to its start vertex
      let t0=0, span=2*Math.PI;
      if(pa&&pb&&v1!==v2){
        const s0=ang(sense?pa:pb), s1=ang(sense?pb:pa);
        span=((s1-s0)%(2*Math.PI)+2*Math.PI)%(2*Math.PI); t0=s0;
        if(span<1e-9) span=2*Math.PI;
      }else if(pa) t0=ang(pa);
      const n=Math.max(2,Math.ceil(CURVE_SEG*span/(2*Math.PI)));
      for(let i=1;i<n;i++){ const t=t0+span*i/n, c=Math.cos(t)*ra, s=Math.sin(t)*rb;
        out.push([M.t[0]+c*M.r[0][0]+s*M.r[1][0], M.t[1]+c*M.r[0][1]+s*M.r[1][1], M.t[2]+c*M.r[0][2]+s*M.r[1][2]]); }
      return;
    }
    // splines and polylines: their control points hug the curve (convex hull property)
    if(hasType(curve,/^(B_SPLINE_CURVE|BEZIER_CURVE|POLYLINE|RATIONAL_B_SPLINE_CURVE|QUASI_UNIFORM_CURVE|UNIFORM_CURVE)/))
      for(const r of refs.get(curve)||[]){ const v=T(r,"CARTESIAN_POINT")!=null?coords(r):null; if(v&&v.length===3) out.push(v); }
  }
  function geomPoints(seed,seen,out){
    const stack=[seed];
    while(stack.length){
      const n=stack.pop();
      const vp=T(n,"VERTEX_POINT");
      if(vp!=null){ const v=coords(REF(A(vp)[1])); if(v&&v.length===3) out.push(v); continue; }
      const pl=T(n,"POLY_LOOP");
      if(pl!=null){ for(const r of refs.get(n)||[]){ const v=coords(r); if(v&&v.length===3) out.push(v); } continue; }
      const ec=T(n,"EDGE_CURVE");
      if(ec!=null){
        const g=A(ec), v1=REF(g[1]), v2=REF(g[2]);
        edgeSamples(REF(g[3]),v1,v2,!/\.F\./.test(g[4]||""),out,0);
        for(const r of [v1,v2]) if(r!=null&&!seen.has(r)){ seen.add(r); stack.push(r); }
        continue;
      }
      for(const r of refs.get(n)||[]){
        if(seen.has(r)||blockCross.has(r)) continue;
        seen.add(r);
        if(!construction(r)) stack.push(r);
      }
    }
  }
  let scale=1;
  const ptCache=new Map();
  function localPoints(rep){
    if(ptCache.has(rep)) return ptCache.get(rep);
    const seeds=[rep].concat(geomLink.get(rep)||[]);
    const out=[]; const seen=new Set(seeds);
    for(const s of seeds){
      const from=out.length;
      geomPoints(s,seen,out);
      // a part modelled in its own unit comes back in the assembly's
      const u=repUnit(s), k=u?u/scale:1;
      if(k!==1) for(let i=from;i<out.length;i++) out[i]=[out[i][0]*k,out[i][1]*k,out[i][2]*k];
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

  // the assembly's own context sets the unit everything is placed in; with no
  // context units at all (hand-written files), a length unit nothing is
  // defined in terms of
  {
    const rootRep=treeRoots.length?repOfPd.get(treeRoots[0]):null;
    let u=rootRep!=null?repUnit(rootRep):null;
    if(!u) for(const r of repOfPd.values()){ u=repUnit(r)||repUnit((geomLink.get(r)||[])[0]); if(u) break; }
    if(!u){
      const bases=new Set();
      for(const [id,e] of ents) for(const [t,a] of e)
        if(t==="LENGTH_MEASURE_WITH_UNIT"||t==="MEASURE_WITH_UNIT") bases.add(REF(A(a)[1]));
      for(const [id,e] of ents) if(!bases.has(id)&&e.some(x=>x[0]==="LENGTH_UNIT")){ u=lengthUnit(id); if(u) break; }
    }
    scale=u||1;
  }
  const UNIT_NAMES=[[1,"METRE"],[0.001,"MILLIMETRE"],[0.01,"CENTIMETRE"],[0.0254,"INCH"],[0.3048,"FOOT"]];
  const unitName=(UNIT_NAMES.find(x=>Math.abs(x[0]-scale)<=1e-9*x[0])||[0,scale+" m"])[1];

  const occs=[];            // every placed occurrence, with its global transform
  let totalPts=0;
  function walkOcc(pdid,M,depth,viaNauo,path){
    if(pdid==null||depth>12) return;
    const rep=repOfPd.get(pdid);
    if(rep!=null) totalPts+=localPoints(rep).length;
    occs.push({pd:pdid, M, rep, nauo:viaNauo, path});
    // each subassembly on the way, by its own occurrence (two identical wheel
    // assemblies side by side are two nodes, not one) and its name
    const here=depth?path.concat([{k:viaNauo, n:clean(pname(pdid)||"")}]):path;
    for(const k of (kidsOcc.get(pdid)||[]))
      walkOcc(k.pd, mulM(M, xfOfNauo.get(k.nauo)||IDM), depth+1, k.nauo, here);
  }
  walkOcc(treeRoots.length?treeRoots[0]:null, IDM, 0, null, []);
  // a single part, or parts with no assembly around them: each stands where modelled
  if(!occs.length) for(const [pdid,rep] of repOfPd) if(!asChild.has(pdid)){
    totalPts+=localPoints(rep).length; occs.push({pd:pdid, M:IDM, rep, nauo:null, path:[]});
  }

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
  {
    const stride=Math.max(1,Math.ceil(totalPts/TARGET));
    let seq=0; const once=new Set();
    for(const o of occs){
      if(o.rep==null) continue;
      // baked geometry is already where it goes, so a shared rep is drawn once
      if(bakedGlobal){ if(once.has(o.rep)) continue; once.add(o.rep); }
      const lp=localPoints(o.rep);
      for(let i=0;i<lp.length;i++){
        if((seq++ % stride)!==0) continue;
        const v=bakedGlobal?lp[i]:applyM(o.M,lp[i]);
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

  /* ---- the cloud. Every point above is on a solid, so nothing is trimmed:
     a quantile trim of the pooled cloud used to cut real parts off wherever
     the part density was uneven — the wheels of a robot whose fasteners
     crowd one plate. Only a file with no B-rep at all falls back to its bare
     points, and there the far-flung ones are plane and axis locations. */
  let src=raw, L=null;
  if(!src.length){
    src=[]; for(let i=0;i<pts.length;i+=3) src.push([pts[i]*scale,pts[i+1]*scale,pts[i+2]*scale]);
    const q=(arr,p)=>{ const s=Float64Array.from(arr).sort(); return s[Math.min(s.length-1,Math.max(0,Math.floor(s.length*p)))]; };
    L=[0,1,2].map(k=>{ const col=src.map(v=>v[k]); const a=q(col,0.01), b=q(col,0.99), pad=(b-a)*0.22+1e-9; return [a-pad,b+pad]; });
  }
  const P=[]; const mn=[1e18,1e18,1e18], mx=[-1e18,-1e18,-1e18];
  for(const p of src){
    if(L&&(p[0]<L[0][0]||p[0]>L[0][1]||p[1]<L[1][0]||p[1]>L[1][1]||p[2]<L[2][0]||p[2]>L[2][1])) continue;
    P.push(p);
    for(let k=0;k<3;k++){ if(p[k]<mn[k])mn[k]=p[k]; if(p[k]>mx[k])mx[k]=p[k]; }
  }
  if(!P.length){ mn[0]=mn[1]=mn[2]=-0.25; mx[0]=mx[1]=mx[2]=0.25; }

  /* ---- solids: each leaf part's own points, placed, so the view can draw
     the robot as parts instead of a cloud. Assemblies only hold placements. */
  const solids=[];
  /* Every leaf occurrence with geometry, tiny ones included: the exact-surface
     mesher (src/tessellate.js) meshes each shape once and places a copy at
     each of these. `rep` is the file's own representation id, `T` where the
     occurrence sits (metres; null when the file bakes placements in). */
  const leafOccs=[], bakedOnce=new Set();
  for(const o of occs){
    if(o.rep==null||kidsOcc.has(o.pd)) continue;
    if(bakedGlobal){ if(bakedOnce.has(o.rep)) continue; bakedOnce.add(o.rep); }
    leafOccs.push({rep:o.rep, name:clean(pname(o.pd)||""), path:o.path||[], sd:null,
      T:bakedGlobal?null:{r:o.M.r.map(a=>a.slice()), t:[o.M.t[0]*scale,o.M.t[1]*scale,o.M.t[2]*scale]}});
  }
  let leafAt=0;
  for(const o of occs){
    if(o.rep==null||kidsOcc.has(o.pd)) continue;
    const leaf=bakedGlobal?leafOccs.find(x=>x.rep===o.rep&&!x.seen):leafOccs[leafAt++];
    if(leaf) leaf.seen=true;
    const lp=localPoints(o.rep); if(lp.length<4) continue;
    const w=[]; const smn=[1e18,1e18,1e18], smx=[-1e18,-1e18,-1e18];
    for(const v0 of lp){
      const v=bakedGlobal?v0:applyM(o.M,v0);
      const p=[v[0]*scale,v[1]*scale,v[2]*scale];
      w.push(p);
      for(let k=0;k<3;k++){ if(p[k]<smn[k])smn[k]=p[k]; if(p[k]>smx[k])smx[k]=p[k]; }
    }
    if(w.length<4) continue;
    const size=Math.hypot(smx[0]-smn[0],smx[1]-smn[1],smx[2]-smn[2]);
    if(size<0.006) continue;                   // washers and grub screws
    const raw=pname(o.pd)||"", pm=/(\d{4}-\d{4}-\d{1,4}|REV-\d{2}-\d{4})/.exec(raw);
    const sd={name:clean(raw), part:pm?pm[1]:null, kind:solidKind(raw,pm?pm[1]:null), size, pts:thinPoints(w,120)};
    // where this occurrence sits in the file's own frame, in metres: how an
    // Onshape mate import (src/mates.js) finds it; meaningless if baked
    if(!bakedGlobal) sd.occT={r:o.M.r.map(a=>a.slice()), t:[o.M.t[0]*scale,o.M.t[1]*scale,o.M.t[2]*scale]};
    if(leaf) leaf.sd=sd;
    solids.push(sd);
  }
  solids.sort((a,b)=>b.size-a.size);
  if(solids.length>1800) solids.length=1800;
  { const at=new Map(solids.map((s,i)=>[s,i]));
    for(const l of leafOccs){ l.solid=l.sd&&at.has(l.sd)?at.get(l.sd):-1; delete l.sd; delete l.seen; } }
  onProgress && onProgress(solids.length+" parts");

  /* ---- one frame for everything downstream (src/frame.js): +z up, origin at
     the drivetrain centre on the floor. It has to happen here, before the
     mechanisms, because they are built from heights and "is this axis
     vertical" — both meaningless on a robot modelled lying on its side. */
  let frame=null;
  if(typeof robotFrame==="function"){
    const F=robotFrame({solids, bbox:{min:mn.slice(),max:mx.slice()}}, opts);
    const bb=applyFrame(F,{points:P, solids, placements, bbox:{min:mn.slice(),max:mx.slice()}});
    for(let k=0;k<3;k++){ mn[k]=bb.min[k]; mx[k]=bb.max[k]; }
    frame=frameRecord(F);
    onProgress && onProgress("up is "+F.up+" ("+F.upWhy+")");
  }

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
      const own=placements.filter(p=>p.child===nm && (p.placed!==undefined?p.placed:p.loc.some(v=>v!==0)));
      const mine=own.shift();
      if(mine){ pivot=mine.loc.slice(); axis=mine.axis; cluster=[mine.loc.slice()]; }
      // don't let a later occurrence of the same part reuse this placement
      if(mine) mine.child="__used";
    }else{
      const own=placements.filter(p=>p.parent===nm && (p.placed!==undefined?p.placed:p.loc.some(v=>v!==0)));
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
  /* Drive hardware is not a joint. A drive motor — or a swerve module's
     steering servo — sits on its wheel: within a hand's width of a drive
     wheel's centre in plan, at wheel height. Left as mechanisms they were
     typed as arm joints, the wheel beside each was drawn as part of that
     "arm", and an OpMode's lift motor could be mapped onto one, so raising
     the lift swung a wheel and a corner of the chassis round a drive motor. */
  if(frame&&typeof frameWheels==="function"){
    const dw=dtOnFloor(frameWheels(solids),[0,0,1]);
    for(const m of mechs){
      if(!m.pivot||!m.hasActuator||!dw.length) continue;
      const onWheel=dw.some(w=>Math.hypot(m.pivot[0]-w.c[0],m.pivot[1]-w.c[1])<Math.min(0.10,2.2*w.r) &&
                               m.pivot[2]<w.c[2]+2.2*w.r);
      if(onWheel){ m.kind="fixed"; m.drive=true; }
    }
  }
  classifyMechs(mechs);

  return {name:null, units:unitName, points:P, pointCount:P.length, solids,
          bbox:{min:mn,max:mx}, parts, mechs, placements, frame, occs:leafOccs};
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
/* "linear-slide" and "prismatic" are other names for "linear". Listed in the
   table, the joint dropdown offered "linear slide" three times. They still
   resolve (non-enumerable) so a session saved with one names its joint
   instead of throwing; compare kinds through normJointKind. */
for(const a of ["linear-slide","prismatic"]) Object.defineProperty(JOINT_KINDS,a,{value:JOINT_KINDS.linear,enumerable:false});
function normJointKind(k){ return k==="linear-slide"||k==="prismatic"?"linear":k; }
/* A motor-driven slide's travel per encoder count, mm: unset, a goBILDA-style
   spool pays out 120 mm of string per output revolution. */
const SPOOL_MM_PER_REV=120;
function slideMmPerTick(mech,tpr){ return (mech&&mech.mmPerTick>0)?mech.mmPerTick:SPOOL_MM_PER_REV/(tpr>0?tpr:28*19.2); }
const centroidOf = m => {
  if(!m.cluster||!m.cluster.length) return m.pivot;
  const s=[0,0,0]; for(const p of m.cluster){s[0]+=p[0];s[1]+=p[1];s[2]+=p[2];}
  return s.map(v=>v/m.cluster.length);
};

function classifyMechs(mechs){
  const vert = a => Math.abs(a[2])>0.85;
  // only actuator-bearing mechanisms get a joint type inferred; the rest are
  // offered as mapping targets but stay out of the chain until typed by hand
  // an Onshape mate joint (src/mates.js) is measured, not guessed: leave it be
  const act = mechs.filter(m=>m.kind!=="fixed"&&!m.fromMate);
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
    if(m.fromMate) continue;
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
