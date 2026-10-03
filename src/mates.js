/* ============================================================
   ONSHAPE MATES -> JOINTS
   A STEP file has shapes and placements but never mates, so the bench has
   had to guess which subassemblies move and about what. Onshape's assembly
   definition carries every mate: its type and the exact coordinate frame on
   each side.

     GET https://cad.onshape.com/api/assemblies/d/{did}/w/{wid}/e/{eid}
         ?includeMateFeatures=true&includeMateConnectors=true

   Opened in a browser tab that's signed in to Onshape, that URL returns the
   JSON directly, with no API keys. This file turns it into the bench's
   mechanisms:
   - rigid bodies: parts fastened together, or grouped, or sharing a
     subassembly that has nothing moving inside it
   - joints: the moving mates between bodies (revolute, slider, cylindrical,
     pin-slot), walked out from the chassis as a tree
   - each joint gets its true axis and pivot, the exact parts it carries,
     its travel limits, and any gear, rack or linear relation tying it to
     another joint
   Every Onshape part occurrence is matched to a STEP part by where it sits
   (its world transform), with the part name breaking ties.
   ============================================================ */

/* An assembly's URL -> the two API links the panel offers. Only ever an
   onshape.com host (company subdomains included), so the URL box can't be
   turned into a link to anywhere else. */
function onshapeApiLinks(url){
  const m=/^(https:\/\/(?:[a-z0-9-]+\.)*onshape\.com)\/documents\/([0-9a-f]{24})\/(w|v|m)\/([0-9a-f]{24})\/e\/([0-9a-f]{24})(?:[/?#]|$)/i.exec(String(url||"").trim());
  if(!m) return null;
  const base=m[1]+"/api/assemblies/d/"+m[2]+"/"+m[3]+"/"+m[4]+"/e/"+m[5];
  return {def:base+"?includeMateFeatures=true&includeMateConnectors=true&includeNonSolids=false", features:base+"/features"};
}

const MATE_MOVING = {REVOLUTE:1, SLIDER:1, CYLINDRICAL:1, PIN_SLOT:1, PLANAR:1, BALL:1, PARALLEL:1};
// Onshape's own mate names ("Revolute 3"), and the same as its URDF export writes them ("revolute_3", "cylindrical_1_2")
const MATE_DEFAULT_NAME = /^(revolute|slider|fastened|cylindrical|pin[ _]?slot|planar|ball|parallel|tangent|width)[\s_]*\d*(?:_\d+)*$/i;

/* ---- transforms, in the parser's convention: r = the local x, y, z axes in
   world coordinates, t = the origin; applied as x*v0 + y*v1 + z*v2 + t */
function osT(a){                                 // Onshape 4x4, row-major, metres
  if(!Array.isArray(a)||a.length<12) return {r:[[1,0,0],[0,1,0],[0,0,1]], t:[0,0,0]};
  return {r:[[a[0],a[4],a[8]],[a[1],a[5],a[9]],[a[2],a[6],a[10]]], t:[a[3],a[7],a[11]]};
}
function osCS(cs){                               // a mate connector frame
  const v=(x,d)=>Array.isArray(x)&&x.length===3?x.map(Number):d;
  return {r:[v(cs&&cs.xAxis,[1,0,0]), v(cs&&cs.yAxis,[0,1,0]), v(cs&&cs.zAxis,[0,0,1])], t:v(cs&&cs.origin,[0,0,0])};
}
const mApply=(M,v)=>[M.r[0][0]*v[0]+M.r[1][0]*v[1]+M.r[2][0]*v[2]+M.t[0],
                     M.r[0][1]*v[0]+M.r[1][1]*v[1]+M.r[2][1]*v[2]+M.t[1],
                     M.r[0][2]*v[0]+M.r[1][2]*v[1]+M.r[2][2]*v[2]+M.t[2]];
const mDir=(M,v)=>[M.r[0][0]*v[0]+M.r[1][0]*v[1]+M.r[2][0]*v[2],
                   M.r[0][1]*v[0]+M.r[1][1]*v[1]+M.r[2][1]*v[2],
                   M.r[0][2]*v[0]+M.r[1][2]*v[1]+M.r[2][2]*v[2]];
function mMul(A,B){ return {r:B.r.map(ax=>mDir(A,ax)), t:mApply(A,B.t)}; }
function mInv(M){
  const r=[[M.r[0][0],M.r[1][0],M.r[2][0]],[M.r[0][1],M.r[1][1],M.r[2][1]],[M.r[0][2],M.r[1][2],M.r[2][2]]];
  const t=mApply({r,t:[0,0,0]},M.t);
  return {r,t:[-t[0],-t[1],-t[2]]};
}
function mNear(A,B,tol){                         // same placement: origin within tol, axes within ~0.5 deg
  if(Math.hypot(A.t[0]-B.t[0],A.t[1]-B.t[1],A.t[2]-B.t[2])>tol) return false;
  for(let i=0;i<3;i++) if(A.r[i][0]*B.r[i][0]+A.r[i][1]*B.r[i][1]+A.r[i][2]*B.r[i][2]<0.99996) return false;
  return true;
}
const mateKey=s=>String(s||"").replace(/\s*<\d+>\s*$/,"").replace(/\s+/g," ").trim().toLowerCase();
const pathKey=p=>(p||[]).join("/");

/* ---- quantity expressions from the features endpoint: "18 in", "-90 deg",
   "0.3 m", "25.4*mm", "+1e+2 millimetres". Metres and radians out; NaN if
   unreadable. A parameter whose expression can't be read here (a variable,
   a formula) falls back to its own number, value (in its units, else
   metres or radians). */
const MATE_UNITS={"":1, m:1, meter:1, meters:1, metre:1, metres:1,
  mm:0.001, millimeter:0.001, millimeters:0.001, millimetre:0.001, millimetres:0.001,
  cm:0.01, centimeter:0.01, centimeters:0.01, centimetre:0.01, centimetres:0.01,
  in:0.0254, inch:0.0254, inches:0.0254, ft:0.3048, foot:0.3048, feet:0.3048, yd:0.9144, yard:0.9144, yards:0.9144,
  rad:1, radian:1, radians:1, deg:Math.PI/180, degree:Math.PI/180, degrees:Math.PI/180};
function mateQty(e){
  if(e&&typeof e==="object"){
    const v=mateQty(e.expression);
    if(Number.isFinite(v)) return v;
    if(typeof e.value==="string") return mateQty(e.value);
    const k=MATE_UNITS[String(e.units||"").trim().toLowerCase()];
    return typeof e.value==="number"&&Number.isFinite(e.value)&&k!=null?e.value*k:NaN;
  }
  const m=/^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*\*?\s*([a-z]*)\s*$/i.exec(String(e==null?"":e));
  if(!m) return NaN;
  const k=MATE_UNITS[m[2].toLowerCase()];
  return k==null?NaN:+m[1]*k;
}

/* ---- read the assembly definition. Mates in a subassembly are written
   against paths inside it, so each is re-rooted at every place that
   subassembly is instanced. */
function parseOnshapeAssembly(json){
  const why=[];
  const root=json&&json.rootAssembly;
  if(!root||!Array.isArray(root.instances)) throw new Error("not an Onshape assembly definition (no rootAssembly.instances). Open the assembly definition link from the Onshape mates panel and save that page.");
  const defKey=o=>[o.documentId||"",o.elementId||"",o.fullConfiguration||o.configuration||"default"].join("|");
  const defs=new Map();
  for(const d of (json.subAssemblies||[])) defs.set(defKey(d),d);

  const inst=new Map();                          // path -> {path, name, type, partId, parent}
  const mates=[], relations=[], groups=[];
  const featById=new Map();
  const readFeatures=(feats,prefix)=>{
    for(const f of (feats||[])){
      if(!f||f.suppressed) continue;
      const d=f.featureData||{}, id=pathKey(prefix)+"#"+(f.id||d.id||"");
      if(f.featureType==="mate"){
        const ends=(d.matedEntities||[]).map(e=>({path:prefix.concat(e.matedOccurrence||[]), cs:osCS(e.matedCS)}));
        if(ends.length!==2){ why.push("mate \""+(d.name||f.id)+"\" has "+ends.length+" ends; skipped."); continue; }
        const m={id, fid:f.id, name:d.name||String(d.mateType||"mate"), type:String(d.mateType||"").toUpperCase(), ends, limits:null, continuous:d.continuous===true};
        // some API versions carry the limits on the mate itself
        const L=d.limits||d.mateLimits;
        if(L) m.limits=L;
        // a subassembly used twice has the same feature ids in each copy
        mates.push(m); if(!featById.has(f.id)) featById.set(f.id,[]); featById.get(f.id).push(m);
      }else if(f.featureType==="mateRelation"){
        const ids=[]; const grab=x=>{ if(!x) return; if(Array.isArray(x)) return x.forEach(grab);
          if(typeof x==="object"){ if(typeof x.featureId==="string") ids.push(x.featureId); for(const k in x) if(typeof x[k]==="object") grab(x[k]); } };
        grab(d.mates||d.mateIds||d.matedEntities);
        // relationOffset: a URDF mimic's offset (src/urdf.js), the follower's own m or rad
        relations.push({name:d.name||"relation", type:String(d.relationType||"").toUpperCase(), ids,
                        ratio:+(d.relationRatio!=null?d.relationRatio:(d.ratio!=null?d.ratio:NaN)),
                        length:+(d.relationLength!=null?d.relationLength:NaN), reverse:!!d.reverseDirection, prefix,
                        offset:+(d.relationOffset!=null?d.relationOffset:0)});
      }else if(f.featureType==="mateGroup"){
        const occ=(d.occurrences||[]).map(o=>prefix.concat(Array.isArray(o)?o:(o.occurrence||[])));
        if(occ.length>1) groups.push({name:d.name||"group", occ});
      }
    }
  };
  const walk=(list,prefix,depth)=>{
    if(depth>12) return;
    for(const i of (list||[])){
      if(!i||i.suppressed) continue;
      const path=prefix.concat([i.id]);
      inst.set(pathKey(path),{path, name:i.name||"", type:i.type||"Part", partId:i.partId||null, std:!!i.isStandardContent});
      if(i.type==="Assembly"){
        const d=defs.get(defKey(i));
        if(!d){ why.push("subassembly \""+i.name+"\" has no definition in subAssemblies; its parts are read as one rigid body."); continue; }
        walk(d.instances,path,depth+1);
        readFeatures(d.features,path);
      }
    }
  };
  walk(root.instances,[],0);
  readFeatures(root.features,[]);

  const occ=new Map();
  for(const o of (root.occurrences||[])){
    const k=pathKey(o.path);
    if(!inst.has(k)) continue;                   // suppressed or from a pattern we don't read
    occ.set(k,{path:o.path.slice(), T:osT(o.transform), fixed:!!o.fixed, hidden:!!o.hidden});
  }
  const parts=[...inst.values()].filter(i=>i.type==="Part"&&occ.has(pathKey(i.path)));
  if(!parts.length) throw new Error("the assembly definition lists no part occurrences with transforms.");
  return {inst, occ, parts, mates, relations, groups, featById, why};
}

/* Mate limits live in the assembly's features (GET …/assemblies/…/features),
   under the names Onshape gives them (onshape-to-robot reads the same):
   limitsEnabled, then limitZMin/limitZMax along a slider and
   limitAxialZMin/limitAxialZMax about a revolute's axis (a cylindrical or
   pin-slot mate is simulated as that turn, so it reads those too). The names
   SimBench's own fixtures once wrote (limitAxialZ for a slider, limitRotation
   for a turn) are still read after them. A limit Onshape leaves empty
   (isNull) is open. */
function applyMateLimits(A,featuresJson){
  let n=0;
  const list=(featuresJson&&(featuresJson.features||featuresJson))||[];
  for(const f of (Array.isArray(list)?list:[])){
    const msg=f&&(f.message||f);
    const fid=msg&&(msg.featureId||msg.id); if(!fid) continue;
    const ms=A.featById.get(fid); if(!ms||!ms.length) continue;   // every copy of the mate
    const P={};
    for(const p of (msg.parameters||[])){ const q=p&&(p.message||p); if(q&&q.parameterId) P[q.parameterId]=q; }
    if(P.limitsEnabled&&P.limitsEnabled.value===false) continue;
    const one=names=>{ for(const k of names) if(P[k]) return P[k].isNull===true?NaN:mateQty(P[k]); return NaN; };
    const lin=ms[0].type==="SLIDER";
    const lo=one(lin?["limitZMin","limitAxialZMin"]:["limitAxialZMin","limitRotationMin"]);
    const hi=one(lin?["limitZMax","limitAxialZMax"]:["limitAxialZMax","limitRotationMax"]);
    if(Number.isFinite(lo)||Number.isFinite(hi)){ for(const m of ms) m.limits=[lo,hi]; n++; }
  }
  return n;
}

/* Where a moving mate was drawn, measured from its zero (where its two
   connectors meet), the way its limits are: the child end against the parent
   end, metres along the parent connector's z for a slider, radians
   right-handed about it for a turn. 0 when an end has no placement. */
function mateDrawnValue(m,parentEnd,occ){
  const P=m.ends[parentEnd], C=m.ends[1-parentEnd];
  const op=P&&occ.get(pathKey(P.path)), oc=C&&occ.get(pathKey(C.path));
  if(!op||!oc) return 0;
  const Wp=mMul(op.T,P.cs), Wc=mMul(oc.T,C.cs);
  const d=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const n=Math.hypot(Wp.r[2][0],Wp.r[2][1],Wp.r[2][2]); if(!(n>1e-12)) return 0;
  const z=Wp.r[2].map(v=>v/n);
  let v;
  if(m.type==="SLIDER") v=d([Wc.t[0]-Wp.t[0],Wc.t[1]-Wp.t[1],Wc.t[2]-Wp.t[2]],z);
  else{
    const flat=a=>{ const k=d(a,z); return [a[0]-k*z[0],a[1]-k*z[1],a[2]-k*z[2]]; };
    const a=flat(Wp.r[0]), b=flat(Wc.r[0]);
    v=Math.atan2(d([a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],z),d(a,b));
  }
  return Number.isFinite(v)&&Math.abs(v)>1e-9?v:0;   // drawn at zero, to rounding
}

/* ---- Onshape part occurrences -> STEP solids, by placement.
   The STEP export and the API describe the same assembly in the same world
   frame, but a STEP export of a different level of the tree — or one wrapped
   in an extra top assembly, as Onshape does — sits under one global
   placement. That placement is found first: every pairing of a part that's
   uniquely named on both sides proposes one, and the proposal that lines up
   the most parts wins. */
function matchOnshapeParts(A,cad,why){
  const solids=(cad&&cad.solids)||[];
  // parts built from Onshape itself (src/onshapecad.js) carry their own path: exact
  if(solids.length&&solids.every(s=>s.osPath)){
    const at=new Map(solids.map((s,i)=>[s.osPath,i])), map=new Map();
    for(const p of A.parts){ const k=pathKey(p.path); if(at.has(k)) map.set(k,at.get(k)); }
    why.push("All "+map.size+" parts come from Onshape itself, so every mate lands on its own part.");
    return {map, G:{r:[[1,0,0],[0,1,0],[0,0,1]],t:[0,0,0]}};
  }
  const S=solids.map((s,i)=>({i, key:mateKey(s.name), T:s.occT||null})).filter(x=>x.T);
  if(!S.length) return {map:new Map(), G:null};
  const P=A.parts.map(p=>({p, key:mateKey(p.name), T:A.occ.get(pathKey(p.path)).T}));
  const count=(arr,k)=>arr.reduce((n,x)=>n+(x.key===k?1:0),0);
  const cands=[];
  for(const p of P){
    if(cands.length>=40) break;
    if(count(P,p.key)!==1) continue;
    const s=S.find(x=>x.key===p.key); if(!s||count(S,p.key)!==1) continue;
    cands.push(mMul(s.T,mInv(p.T)));
  }
  cands.push({r:[[1,0,0],[0,1,0],[0,0,1]],t:[0,0,0]});
  const tol=5e-4;
  // spatial hash of STEP placements by origin
  const cell=0.002, hash=new Map(), hk=v=>v.map(c=>Math.floor(c/cell)).join(",");
  for(const s of S){ const k=hk(s.T.t); if(!hash.has(k)) hash.set(k,[]); hash.get(k).push(s); }
  const near=T=>{ const out=[], c=T.t.map(v=>Math.floor(v/cell));
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) for(let dz=-1;dz<=1;dz++){
      const b=hash.get([c[0]+dx,c[1]+dy,c[2]+dz].join(",")); if(b) for(const s of b) if(mNear(s.T,T,tol)) out.push(s); }
    return out; };
  let G=null, best=-1;
  for(const g of cands){
    let n=0; for(const p of P) if(near(mMul(g,p.T)).length) n++;
    if(n>best){ best=n; G=g; }
  }
  const map=new Map(), taken=new Set();
  for(const p of P){
    const hits=near(mMul(G,p.T)).filter(s=>!taken.has(s.i));
    const pick=hits.find(s=>s.key===p.key)||hits[0];
    if(pick){ map.set(pathKey(p.p.path),pick.i); taken.add(pick.i); }
  }
  why.push("Matched "+map.size+" of "+P.length+" Onshape parts to the STEP by placement ("+solids.length+" STEP parts, "+
           (solids.length-taken.size)+" left unmatched: hardware too small to keep, or not in this export).");
  return {map, G};
}

/* ---- the whole import */
function applyOnshapeMates(cad,json,opts){
  opts=opts||{};
  const A=parseOnshapeAssembly(json);
  const why=A.why.slice();
  if(opts.features) why.push(applyMateLimits(A,opts.features)+" mate limit(s) read from the features list.");
  const {map, G}=matchOnshapeParts(A,cad,why);
  if(!map.size) throw new Error("none of the Onshape parts line up with this STEP's parts. Export the STEP from the same assembly, and load it first.");

  // union-find over part occurrences
  const keys=A.parts.map(p=>pathKey(p.path)), idx=new Map(keys.map((k,i)=>[k,i]));
  const par=keys.map((_,i)=>i), find=i=>{ while(par[i]!==i){ par[i]=par[par[i]]; i=par[i]; } return i; };
  const union=(a,b)=>{ a=find(a); b=find(b); if(a!==b) par[b]=a; };
  // every part at or under a path: a mate or group on a subassembly means all of it
  const under=path=>{ const k=pathKey(path); const out=[];
    keys.forEach((q,i)=>{ if(q===k||q.startsWith(k+"/")) out.push(i); }); return out; };
  const unionAll=list=>{ for(let i=1;i<list.length;i++) union(list[0],list[i]); };

  const moving=A.mates.filter(m=>MATE_MOVING[m.type]);
  for(const m of A.mates) if(m.type==="FASTENED") unionAll(under(m.ends[0].path).concat(under(m.ends[1].path)));
  for(const g of A.groups) unionAll([].concat(...g.occ.map(under)));
  // a subassembly with no moving mate inside is one rigid body
  const movingIn=new Set();
  for(const m of moving) for(const e of m.ends) for(let d=1;d<e.path.length;d++) movingIn.add(pathKey(e.path.slice(0,d)));
  for(const i of A.inst.values()) if(i.type==="Assembly"&&!movingIn.has(pathKey(i.path))) unionAll(under(i.path));
  // a part no mate touches rides with the body its own subassembly is built on
  const touched=new Set();
  for(const m of A.mates) for(const e of m.ends) for(const i of under(e.path)) touched.add(i);
  for(const g of A.groups) for(const o of g.occ) for(const i of under(o)) touched.add(i);
  const partsOf=prefix=>keys.map((k,i)=>i).filter(i=>{ const p=A.parts[i].path; return p.length===prefix.length+1&&pathKey(p.slice(0,-1))===pathKey(prefix); });

  // the frame: fixed parts, and every root-level part that isn't the moving
  // end of a mate — plates, rails, hubs and the parts bolted to them
  const wheelIdx=[];
  (cad.solids||[]).forEach((s,i)=>{ if(s.kind==="wheel"||/wheel/i.test(s.name||"")) wheelIdx.push(i); });
  const solidOf=i=>map.get(keys[i]);
  const movingEnd=new Set();
  for(const m of moving) for(const e of m.ends) for(const i of under(e.path)) movingEnd.add(i);
  // A root-level part no moving mate touches is frame only if nothing it's fastened to
  // moves either: a camera bolted to the arm rides the arm (Onshape's URDF export
  // also puts a shapeless frame link for each subassembly at the root, fastened to
  // whatever carries it). Of the bodies that hold such parts, the biggest is the
  // ground when no part is fixed.
  const fixedIdx=keys.map((k,i)=>i).filter(i=>A.occ.get(keys[i]).fixed);
  const rootStill=partsOf([]).filter(i=>!movingEnd.has(i));
  const movingBody=new Set([...movingEnd].map(i=>find(i)));
  // parts no moving mate reaches, directly or through what they're fastened to, are frame
  const loose=rootStill.filter(i=>!movingBody.has(find(i)));
  unionAll(fixedIdx.concat(loose));
  // a part nothing mates to rides with the body its own subassembly is
  // attached by: the touched part there that's joined to something outside it
  for(const s of A.inst.values()) if(s.type==="Assembly"){
    const inside=partsOf(s.path), loose=inside.filter(i=>!touched.has(i));
    if(!loose.length) continue;
    const pre=pathKey(s.path)+"/";
    const outside=keys.map((k,i)=>i).filter(i=>!keys[i].startsWith(pre));
    const touchedIn=inside.filter(i=>touched.has(i));
    const anchor=touchedIn.find(i=>outside.some(o=>find(o)===find(i)))??touchedIn[0];
    if(anchor!=null) for(const i of loose) union(anchor,i);
  }
  const sizeIn=i=>{ const s=solidOf(i); return (s!=null&&cad.solids[s]?(cad.solids[s].size||0):0)+1e-6; };
  let ground;
  if(fixedIdx.length) ground=find(fixedIdx[0]);
  else{
    // the chassis: the biggest body a moving mate touches, over all its parts (the
    // drivetrain with what's bolted to it, the rail a lift is fastened to); the loose
    // parts ride it
    const size=new Map(); keys.forEach((k,i)=>{ const b=find(i); size.set(b,(size.get(b)||0)+sizeIn(i)); });
    const pool=[...movingBody];
    if(pool.length) ground=pool.sort((a,b)=>(size.get(b)||0)-(size.get(a)||0))[0];
    else if(loose.length) ground=find(loose[0]);
    else{ const w=keys.map((k,i)=>i).find(i=>wheelIdx.includes(solidOf(i))); ground=find(w!=null?w:0); }
    if(loose.length) union(ground,loose[0]);
  }
  // A body of root-level still parts that no path of moving mates reaches from the
  // chassis is chassis too (the right rail, when only the left one is mated). One a
  // path does reach rides what moves it: a camera bolted to the arm stays on the arm,
  // and Onshape's URDF export puts a shapeless frame link for each subassembly at the
  // root, fastened to whatever carries it. Folding one in can open the path to the
  // next (a lift whose mount was never mated to the chassis), so this repeats.
  for(let pass=0;pass<=rootStill.length;pass++){
    const adj=new Map(), link=(a,b)=>{ (adj.get(a)||adj.set(a,new Set()).get(a)).add(b); };
    for(const m of moving){ const a=under(m.ends[0].path), b=under(m.ends[1].path); if(!a.length||!b.length) continue;
      const ba=find(a[0]), bb=find(b[0]); if(ba!==bb){ link(ba,bb); link(bb,ba); } }
    const g=find(ground), reach=new Set([g]), q=[g];
    while(q.length){ const b=q.pop(); for(const n of adj.get(b)||[]) if(!reach.has(n)){ reach.add(n); q.push(n); } }
    const i=rootStill.find(i=>!reach.has(find(i))); if(i==null) break;
    union(ground,i);
  }
  ground=find(ground);
  const bodyOf=i=>find(i);

  // ---- joints: moving mates between two bodies, a tree out from the ground
  const edges=[];
  for(const m of moving){
    const a=under(m.ends[0].path), b=under(m.ends[1].path);
    if(!a.length||!b.length) continue;
    const ba=bodyOf(a[0]), bb=bodyOf(b[0]);
    if(ba===bb){ why.push("mate \""+m.name+"\" joins two parts that are also fastened together; it can't move and was ignored."); continue; }
    edges.push({m, ba, bb});
  }
  // a wheel on its axle — a drive wheel, its rollers, an intake's compliant
  // wheel — is a compact body with a wheel in it; spinning it is not a joint
  // the bench drives. A bigger body that happens to carry a wheel (an intake
  // arm) keeps its joint.
  const wheelBody=new Set();
  for(const b of new Set(keys.map((k,i)=>i).filter(i=>wheelIdx.includes(solidOf(i))).map(bodyOf))){
    const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
    for(const si of keys.map((k,i)=>i).filter(i=>bodyOf(i)===b).map(solidOf).filter(x=>x!=null))
      for(const p of cad.solids[si].pts) for(let k=0;k<3;k++){ if(p[k]<mn[k]) mn[k]=p[k]; if(p[k]>mx[k]) mx[k]=p[k]; }
    // compact, and on the floor: an intake's roller higher up is a joint the code drives
    if(Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])<0.2&&mn[2]<0.03) wheelBody.add(b);
  }
  const seen=new Set([ground]), queue=[ground], joints=[], loops=[];
  const used=new Set();
  // onshape-to-robot's convention: a mate named closing_<x> closes a loop and is never
  // a joint of the tree (an MJCF <connect> comes in named that way), so the tree is
  // walked without them first, and they're taken only for what that walk didn't reach
  const closing=e=>/^closing[_ ]/i.test(String(e.m.name||""));
  const walk=allow=>{
    while(queue.length){
      const b=queue.shift();
      for(const e of edges){
        if(used.has(e)||!allow(e)) continue;
        const other=e.ba===b?e.bb:(e.bb===b?e.ba:null); if(other==null) continue;
        used.add(e);
        if(seen.has(other)){ loops.push(e); continue; }
        seen.add(other); queue.push(other);
        joints.push({m:e.m, parent:b, child:other, parentEnd:e.ba===b?0:1});
      }
    }
  };
  walk(e=>!closing(e));
  queue.push(...seen); walk(()=>true);
  // what a person should look at, as data (src/simbot.js validateRobot reads these)
  const issues=[];
  const floating=new Set(keys.map((k,i)=>bodyOf(i)).filter(b=>!seen.has(b)));
  if(floating.size){
    why.push(floating.size+" bod"+(floating.size===1?"y is":"ies are")+" attached by no mate path to the chassis; "+(floating.size===1?"it rides":"they ride")+" with the chassis.");
    const names=[]; for(const b of floating) for(const i of keys.map((k,q)=>q).filter(q=>bodyOf(q)===b)){ if(names.length<8) names.push(A.parts[i].name||"part"); }
    issues.push({sev:"warn", code:"floating", text:floating.size+" rigid bod"+(floating.size===1?"y has":"ies have")+" no mate tying "+(floating.size===1?"it":"them")+" to the chassis ("+names.join(", ")+"). Mate "+(floating.size===1?"it":"them")+" in Onshape, or "+(floating.size===1?"it rides":"they ride")+" with the frame.", parts:names});
  }
  if(loops.length) why.push(loops.length+" mate"+(loops.length===1?" closes a loop":"s close loops")+" (a linkage: "+loops.slice(0,3).map(e=>"\""+e.m.name+"\"").join(", ")+"). The bench drives each loop through its first joint and holds the rest rigid, so a four-bar's coupler moves with that link.");

  // ---- to the canonical frame the rest of the bench works in
  const F=cad.frame&&cad.frame.M;
  const raw2c=p=>F?[F[0]*p[0]+F[1]*p[1]+F[2]*p[2]+F[3], F[4]*p[0]+F[5]*p[1]+F[6]*p[2]+F[7], F[8]*p[0]+F[9]*p[1]+F[10]*p[2]+F[11]]:p.slice();
  const dir2c=v=>F?[F[0]*v[0]+F[1]*v[1]+F[2]*v[2], F[4]*v[0]+F[5]*v[1]+F[6]*v[2], F[8]*v[0]+F[9]*v[1]+F[10]*v[2]]:v.slice();
  const up=[0,0,1];

  const solids=cad.solids||[];
  const bodySolids=b=>keys.map((k,i)=>i).filter(i=>bodyOf(i)===b).map(solidOf).filter(i=>i!=null);
  const byChild=new Map(joints.map(j=>[j.child,j]));
  const idUsed={};
  const uid=n=>{ let id=n.slice(0,44)||"joint"; if(idUsed[id]==null){ idUsed[id]=1; return id; } return id+" #"+(++idUsed[id]); };
  const nameOfBody=b=>{
    // the subassembly that holds the body, else its biggest part
    const ps=keys.map((k,i)=>i).filter(i=>bodyOf(i)===b).map(i=>A.parts[i]);
    const counts=new Map();
    for(const p of ps) for(let d=1;d<p.path.length;d++){ const k=pathKey(p.path.slice(0,d)); counts.set(k,(counts.get(k)||0)+1); }
    let best=null, bn=0;
    for(const [k,n] of counts) if(n===ps.length&&(!best||k.length>best.length)){ best=k; bn=n; }
    if(best) return mateKey(A.inst.get(best).name);
    const si=bodySolids(b).sort((x,y)=>(solids[y].size||0)-(solids[x].size||0))[0];
    return si!=null?solids[si].name:"part";
  };
  const mechOf=new Map();
  const mechs=[];
  for(const j of joints){
    if(wheelBody.has(j.child)&&(j.m.type==="REVOLUTE"||j.m.type==="CYLINDRICAL")) continue;
    // the mate frame in world: the end's occurrence placement, then its connector
    const e=j.m.ends[j.parentEnd], endOcc=A.occ.get(pathKey(e.path));
    if(!endOcc){ why.push("mate \""+j.m.name+"\" names an occurrence with no placement; skipped."); continue; }
    const W=mMul(G,mMul(endOcc.T,e.cs));
    const pivot=raw2c(W.t);
    let axis=dir2c(W.r[2]);
    const L=Math.hypot(axis[0],axis[1],axis[2])||1; axis=axis.map(v=>v/L);
    const t=j.m.type;
    const lin=t==="SLIDER";
    // onshape-to-robot's naming, for teams already using it: dof_<name> names the
    // joint, and a trailing _inv turns its axis (and so its travel) the other way
    const hint=mateNameHint(j.m.name), inv=hint.inv;
    if(inv) axis=axis.map(v=>-v);
    const vertical=Math.abs(axis[0]*up[0]+axis[1]*up[1]+axis[2]*up[2])>0.7;
    const kind=lin?"linear":(t==="REVOLUTE"||t==="PIN_SLOT"||t==="CYLINDRICAL")?(vertical?"revolute-yaw":"revolute-lift"):"fixed";
    const named=MATE_DEFAULT_NAME.test(hint.name)?nameOfBody(j.child):hint.name;
    const members=bodySolids(j.child);
    // reach: centroid of everything this joint carries, itself and downstream
    const carried=[]; const collect=b=>{ carried.push(...bodySolids(b)); for(const k of joints) if(k.parent===b) collect(k.child); };
    collect(j.child);
    let cen=[0,0,0], n=0;
    for(const si of carried){ for(const p of solids[si].pts){ cen[0]+=p[0]; cen[1]+=p[1]; cen[2]+=p[2]; n++; } }
    cen=n?cen.map(v=>v/n):pivot.slice();
    const lever=Math.hypot(cen[0]-pivot[0],cen[1]-pivot[1],cen[2]-pivot[2]);
    // an actuator part on either side of the joint, nearest the pivot
    let hw=null, hwName=null, bd=Infinity;
    for(const si of bodySolids(j.parent).concat(members)){
      const s=solids[si]; if(!(s.kind==="motor"||s.kind==="servo")) continue;
      const h=typeof hwFromPart==="function"?hwFromPart(s.part,s.name):null; if(!h) continue;
      const c=s.pts.reduce((a,p)=>[a[0]+p[0],a[1]+p[1],a[2]+p[2]],[0,0,0]).map(v=>v/s.pts.length);
      const d=Math.hypot(c[0]-pivot[0],c[1]-pivot[1],c[2]-pivot[2]);
      if(d<bd&&d<0.15){ bd=d; hw=h; hwName=s.name; }
    }
    const m={id:uid(named), alias:j.m.name, kind, axis, pivot, distalTo:cen, lever, dir:1,
             parent:"chassis", limits:null, part:hw?(hw.part||null):null, partName:hwName, hasActuator:!!hw,
             inferred:false, leverOverride:null,
             cluster:carried.map(si=>solids[si].pts.reduce((a,p)=>[a[0]+p[0],a[1]+p[1],a[2]+p[2]],[0,0,0]).map(v=>v/solids[si].pts.length)),
             fromMate:{name:j.m.name, type:t, id:j.m.fid}};
    if(j.m.limits){
      let lo=Array.isArray(j.m.limits)?j.m.limits[0]:mateQty(j.m.limits.min), hi=Array.isArray(j.m.limits)?j.m.limits[1]:mateQty(j.m.limits.max);
      // Onshape counts a limit from the mate's zero, where its two connectors
      // meet; the bench counts q from the pose the CAD was drawn in. A carriage
      // drawn 100 mm up a 0-300 mm rail has 100 mm down and 200 mm up left.
      const v0=mateDrawnValue(j.m,j.parentEnd,A.occ);
      if(Number.isFinite(lo)) lo-=v0;
      if(Number.isFinite(hi)) hi-=v0;
      // an axis turned round runs the same travel the other way
      if(inv){ const a=lo; lo=Number.isFinite(hi)?-hi:hi; hi=Number.isFinite(a)?-a:a; }
      if(Number.isFinite(lo)||Number.isFinite(hi)) m.limits=[Number.isFinite(lo)?lo:null, Number.isFinite(hi)?hi:null];
    }
    if(j.m.continuous) m.continuous=true;
    // Hardware spinning on an axle (a bearing, an idler, a hub, a shaft collar, an e-clip):
    // a continuous mate carrying a few small parts, nothing beneath it, no motor or servo
    // on it, and nothing in its names that a team drives. Kept as a joint, never asked about.
    if(m.continuous&&!hw&&!joints.some(k=>k.parent===j.child)){
      const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
      for(const si of carried) for(const p of solids[si].pts) for(let k=0;k<3;k++){ if(p[k]<mn[k]) mn[k]=p[k]; if(p[k]>mx[k]) mx[k]=p[k]; }
      const span=carried.length?Math.hypot(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]):0;
      const names=carried.map(si=>(solids[si].name||"")+" "+(solids[si].part||"")).join(" ")+" "+named;
      const driven=/roller|tire|tyre|flywheel|wheel|intake|shooter|launcher|drum|carousel|turret|arm|lift|slide|claw|grip|finger|wrist|pivot|spinner|indexer|kicker|hood|flap|door|gate|bucket|ramp/i.test(names);
      const hardware=/bearing|collar|shaft|spline|\bhub\b|gear|pulley|sprocket|spacer|standoff|e[- ]?clip|idler|axle|\bpin\b|washer|bushing|screw|bolt|nut\b/i.test(names);
      if(!driven&&((carried.length<=6&&span<=0.15)||(hardware&&carried.length<=12&&span<=0.3))) m.passive=true;
    }
    if(t==="CYLINDRICAL") why.push("\""+j.m.name+"\" is cylindrical (turns and slides); it's simulated as the turn.");
    if(t==="PIN_SLOT") why.push("\""+j.m.name+"\" is a pin-slot; it's simulated as the pin's turn.");
    if(kind==="fixed"){
      why.push("\""+j.m.name+"\" is a "+t.toLowerCase().replace("_","-")+" mate, which the bench doesn't simulate; it's held where it was drawn.");
      issues.push({sev:"warn", code:"unsupported-mate", joint:m.id, text:"\""+j.m.name+"\" is a "+t.toLowerCase().replace("_","-")+" mate. The bench holds it where it was drawn; use revolute, slider or cylindrical mates for anything that moves."});
    }
    mechOf.set(j.child,m);
    for(const si of members) solids[si].mech=m.id;
    mechs.push(m);
  }
  // parents: the joint whose child body this joint hangs from
  for(const j of joints){ const m=mechOf.get(j.child); if(!m) continue; const pm=mechOf.get(j.parent); if(pm) m.parent=pm.id; }

  // relations: one joint driven through another (a cascade slide, a gear pair, a rack).
  // Mates are keyed by where they sit ("path#featureId"): a subassembly used
  // twice has the same feature ids in each copy, and each copy's relation
  // ties that copy's own joints
  const byKey=new Map();
  for(const j of joints){ const m=mechOf.get(j.child); if(m&&m.fromMate.id===j.m.fid) byKey.set(j.m.id,m); }
  for(const r of A.relations){
    const pre=pathKey(r.prefix)+"#";
    const ms=r.ids.map(id=>byKey.get(pre+id)).filter(Boolean);
    if(ms.length!==2){
      issues.push({sev:"warn", code:"relation-dangling", text:"The "+(r.type?r.type.toLowerCase().replace(/_/g," ")+" ":"")+"relation \""+r.name+"\" ties "+(ms.length?"only one joint":"no joint")+
        " the bench simulates (a mate it names is suppressed, fastened, or a wheel), so it does nothing here."});
      continue;
    }
    const k=r.type==="RACK_AND_PINION"||r.type==="SCREW"?(Number.isFinite(r.length)?r.length/(2*Math.PI):NaN)
           :(Number.isFinite(r.ratio)?r.ratio:1);       // a ratio of 0 (a URDF mimic held still) is 0
    if(!Number.isFinite(k)) continue;
    // an _inv mate's axis was turned round, so its value runs the other way:
    // the ratio turns round once for each end that was, the offset with the follower
    const inv=m=>mateNameHint(m.fromMate.name).inv?-1:1;
    ms[1].couple={to:ms[0].id, ratio:(r.reverse?-1:1)*inv(ms[0])*inv(ms[1])*k||0, via:r.type.toLowerCase().replace(/_/g," ")};
    if(Number.isFinite(r.offset)&&r.offset) ms[1].couple.offset=inv(ms[1])*r.offset;
    why.push("\""+ms[1].id+"\" follows \""+ms[0].id+"\" through a "+r.type.toLowerCase().replace(/_/g," ")+" relation (ratio "+(+k.toFixed(4))+").");
  }

  // the mates that close a loop: where the two bodies are pinned, so a solver
  // that can close loops (src/joltmech.js) pins them there; the kinematic bench
  // keeps driving each loop through its first joint
  const jointOfBody=b=>{ const m=mechOf.get(b); return m?m.id:"chassis"; };
  const loopRecs=[];
  for(const e of loops){
    const end=e.m.ends[0], occ=A.occ.get(pathKey(end.path)); if(!occ) continue;
    const W=mMul(G,mMul(occ.T,end.cs)), ax=dir2c(W.r[2]), L=Math.hypot(ax[0],ax[1],ax[2])||1;
    loopRecs.push({name:e.m.name, type:e.m.type, a:jointOfBody(e.ba), b:jointOfBody(e.bb), point:raw2c(W.t), axis:ax.map(v=>v/L)});
  }
  if(loopRecs.length) issues.push({sev:"note", code:"loop", text:loopRecs.length+" mate"+(loopRecs.length===1?" closes a linkage loop":"s close linkage loops")+" ("+loopRecs.slice(0,3).map(l=>"\""+l.name+"\"").join(", ")+
    "). The physics solver pins "+(loopRecs.length===1?"it":"them")+" closed; the kinematic bench drives each loop through its first joint."});

  why.unshift(A.mates.length+" mates ("+moving.length+" moving), "+keys.length+" parts in "+new Set(keys.map((k,i)=>bodyOf(i))).size+
              " rigid bodies; "+mechs.length+" joint"+(mechs.length===1?"":"s")+" become mechanisms.");
  const drives=cad.mechs?cad.mechs.filter(m=>m.drive):[];
  cad.mechs=mechs.concat(drives);
  cad.loops=loopRecs;
  cad.mates={source:"onshape", joints:mechs.length, matched:map.size, parts:keys.length, loops:loops.length, why, issues};
  return cad.mates;
}

/* A mate's name read the way onshape-to-robot writes it: "dof_lift" is the
   joint "lift", "dof_wrist_inv" the joint "wrist" with its axis turned round.
   Any other name comes back as it is. */
function mateNameHint(name){
  const s=String(name||"");
  const m=/^dof_(.+?)(_inv)?$/i.exec(s);
  return m?{name:m[1], inv:!!m[2]}:{name:s, inv:false};
}
