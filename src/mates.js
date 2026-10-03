/* ============================================================
   ONSHAPE MATES -> JOINTS
   A STEP file has shapes and placements but never mates, so the bench has
   had to guess which subassemblies move and about what. Onshape's assembly
   definition carries every mate: its type and the exact coordinate frame on
   each side.

     GET https://cad.onshape.com/api/assemblies/d/{did}/w/{wid}/e/{eid}
         ?includeMateFeatures=true&includeMateConnectors=true

   src/onshapelink.js reads it through Sign in with Onshape, and src/urdf.js
   writes the same document from a URDF export. This file turns it into the
   bench's mechanisms:
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

const MATE_MOVING = {REVOLUTE:1, SLIDER:1, CYLINDRICAL:1, PIN_SLOT:1, PLANAR:1, BALL:1, PARALLEL:1};
const MATE_DEFAULT_NAME = /^(revolute|slider|fastened|cylindrical|pin[ _]?slot|planar|ball|parallel|tangent|width)\s*\d*$/i;

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
   "0.3 m", "25.4*mm", "1/2 in", "2 * 25.4 mm". Metres and radians out; NaN
   if unreadable (a variable like "#armMax") or not set: an unset bound
   comes as isNull, or with a nullValue such as "No minimum". */
const MATE_UNITS={"":1, m:1, meter:1, meters:1, mm:0.001, millimeter:0.001, millimeters:0.001, cm:0.01, centimeter:0.01, centimeters:0.01,
  in:0.0254, inch:0.0254, inches:0.0254, ft:0.3048, foot:0.3048, feet:0.3048, rad:1, radian:1, radians:1, deg:Math.PI/180, degree:Math.PI/180, degrees:Math.PI/180};
function mateQty(e){
  if(e&&typeof e==="object"){
    if(e.isNull===true||(typeof e.nullValue==="string"&&e.nullValue.trim())) return NaN;
    e=e.expression!=null?e.expression:(e.value!=null?e.value:"");
  }
  const m=/^(.*?)\s*\*?\s*([a-z]*)\s*$/i.exec(String(e==null?"":e).trim());
  const k=m?MATE_UNITS[m[2].toLowerCase()]:null;
  return k==null?NaN:mateNum(m[1])*k;
}
/* + - * / and brackets over plain numbers; NaN for anything else */
function mateNum(s){
  let i=0;
  const sp=()=>{ while(s[i]===" ") i++; };
  const atom=()=>{ sp();
    if(s[i]==="("){ i++; const v=sum(); sp(); if(s[i++]!==")") throw 0; return v; }
    if(s[i]==="-"||s[i]==="+"){ const g=s[i++]==="-"?-1:1; return g*atom(); }
    const m=/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); if(!m) throw 0; i+=m[0].length; return +m[0]; };
  const prod=()=>{ let v=atom(); for(;;){ sp(); if(s[i]==="*"){ i++; v*=atom(); } else if(s[i]==="/"){ i++; v/=atom(); } else return v; } };
  const sum=()=>{ let v=prod(); for(;;){ sp(); if(s[i]==="+"){ i++; v+=prod(); } else if(s[i]==="-"){ i++; v-=prod(); } else return v; } };
  try{ const v=sum(); sp(); return i===s.length?v:NaN; }catch(x){ return NaN; }
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
  const featById=new Map();                     // definition key#feature id -> its mates, one per copy
  const readFeatures=(feats,prefix,dk)=>{
    for(const f of (feats||[])){
      if(!f||f.suppressed) continue;
      const d=f.featureData||{}, id=pathKey(prefix)+"#"+(f.id||d.id||"");
      if(f.featureType==="mate"){
        const ends=(d.matedEntities||[]).map(e=>({path:prefix.concat(e.matedOccurrence||[]), cs:osCS(e.matedCS)}));
        if(ends.length!==2){ why.push("mate \""+(d.name||f.id)+"\" has "+ends.length+" ends; skipped."); continue; }
        const m={id, fid:f.id, name:d.name||String(d.mateType||"mate"), type:String(d.mateType||"").toUpperCase(), ends, limits:null};
        // some API versions carry the limits on the mate itself
        const L=d.limits||d.mateLimits;
        if(L) m.limits=L;
        mates.push(m);
        for(const k of [dk+"#"+f.id, "*#"+f.id]){ if(!featById.has(k)) featById.set(k,[]); featById.get(k).push(m); }
      }else if(f.featureType==="mateRelation"){
        const ids=[]; const grab=x=>{ if(!x) return; if(Array.isArray(x)) return x.forEach(grab);
          if(typeof x==="object"){ if(typeof x.featureId==="string") ids.push(x.featureId); for(const k in x) if(typeof x[k]==="object") grab(x[k]); } };
        grab(d.mates||d.mateIds||d.matedEntities);
        relations.push({name:d.name||"relation", type:String(d.relationType||"").toUpperCase(), ids,
                        ratio:+(d.relationRatio!=null?d.relationRatio:(d.ratio!=null?d.ratio:NaN)),
                        length:+(d.relationLength!=null?d.relationLength:NaN), reverse:!!d.reverseDirection, prefix});
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
        readFeatures(d.features,path,defKey(d));
      }
    }
  };
  walk(root.instances,[],0);
  readFeatures(root.features,[],"");

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
   (isNull) is open. That call lists one element's own features, so a
   subassembly's come with its definition key (dk, as subAssemblies writes
   it); the root's have none, and an old payload that put every mate's limits
   on the root still finds them. The limits stay as Onshape gives them, mate
   values; applyOnshapeMates makes them travel from the drawn pose. */
function applyMateLimits(A,featuresJson,dk){
  let n=0; dk=dk||"";
  const list=(featuresJson&&(featuresJson.features||featuresJson))||[];
  for(const f of (Array.isArray(list)?list:[])){
    const msg=f&&(f.message||f);
    const fid=msg&&(msg.featureId||msg.id); if(!fid) continue;
    const ms=A.featById.get(dk+"#"+fid)||(dk===""?A.featById.get("*#"+fid):null); if(!ms) continue;
    const P={};
    for(const p of (msg.parameters||[])){ const q=p&&(p.message||p); if(q&&q.parameterId) P[q.parameterId]=q; }
    if(P.limitsEnabled&&P.limitsEnabled.value===false) continue;
    const one=names=>{ for(const k of names) if(P[k]) return P[k].isNull===true?NaN:mateQty(P[k]); return NaN; };
    let hit=false;
    for(const m of ms){
      const lin=m.type==="SLIDER";
      const lo=one(lin?["limitZMin","limitAxialZMin"]:["limitAxialZMin","limitRotationMin"]);
      const hi=one(lin?["limitZMax","limitAxialZMax"]:["limitAxialZMax","limitRotationMax"]);
      if(Number.isFinite(lo)||Number.isFinite(hi)){ m.limits=[lo,hi]; hit=true; }
    }
    if(hit) n++;
  }
  return n;
}

/* Onshape measures a mate's value as its second end (connector 2) against
   its first, along or about the first's z. The bench measures a joint as
   the child's travel from where it was drawn, along or about the parent
   end's z. The value where it was drawn (v0) and the sign between the two
   (s), so a limit L becomes travel s*(L-v0). Null when the two z axes
   aren't parallel. */
function mateTravel(A,m,parentEnd,lin){
  const W=m.ends.map(e=>{ const o=A.occ.get(pathKey(e.path)); return o?mMul(o.T,e.cs):null; });
  if(!W[0]||!W[1]) return null;
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const z1=W[0].r[2], z2=W[1].r[2], d=dot(z1,z2);
  if(Math.abs(d)<0.9) return null;
  let v0;
  if(lin) v0=dot([W[1].t[0]-W[0].t[0],W[1].t[1]-W[0].t[1],W[1].t[2]-W[0].t[2]],z1);
  else{ const x1=W[0].r[0], x2=W[1].r[0];
    v0=Math.atan2(dot([x1[1]*x2[2]-x1[2]*x2[1],x1[2]*x2[0]-x1[0]*x2[2],x1[0]*x2[1]-x1[1]*x2[0]],z1),dot(x1,x2)); }
  return {v0, s:parentEnd===0?1:-Math.sign(d)};
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
  if(opts.features||opts.featuresBy){
    let n=opts.features?applyMateLimits(A,opts.features,""):0;
    for(const k in (opts.featuresBy||{})) n+=applyMateLimits(A,opts.featuresBy[k],k);
    why.push(n+" mate limit(s) read from the features list"+(opts.featuresBy?"s":"")+".");
  }
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

  // the frame: fixed parts, and every root-level part no mate touches at all —
  // plates, rails, hubs dropped in and never mated. A part that is only fastened
  // to others hangs with them: taking "not the moving end" as frame welded every
  // plate of an arm (fastened to the hub on the motor's shaft) to the chassis, and
  // the shaft's revolute was then "a mate between parts also fastened together".
  const wheelIdx=[];
  (cad.solids||[]).forEach((s,i)=>{ if(s.kind==="wheel"||/wheel/i.test(s.name||"")) wheelIdx.push(i); });
  const solidOf=i=>map.get(keys[i]);
  const movingEnd=new Set();
  for(const m of moving) for(const e of m.ends) for(const i of under(e.path)) movingEnd.add(i);
  // The frame: the fixed parts, plus every root-level part no mate touches (dropped in and
  // never mated: it rides along). With nothing fixed, the biggest root-level body as well.
  // "Every root-level part that isn't the moving end of a mate" used to be frame too, which
  // welded the plates of an arm (fastened to the hub on its motor's shaft) to the chassis.
  const fixedIdx=keys.map((k,i)=>i).filter(i=>A.occ.get(keys[i]).fixed);
  let frameSeed=fixedIdx.concat(partsOf([]).filter(i=>!touched.has(i)));
  // a fixed subassembly (most teams fix a "Drivetrain" one) is frame too, all but what moves in it
  const fixedSubs=[...A.inst.values()].filter(x=>x.type==="Assembly"&&(A.occ.get(pathKey(x.path))||{}).fixed);
  for(const x of fixedSubs) frameSeed=frameSeed.concat(under(x.path).filter(i=>!movingEnd.has(i)));
  if(!fixedIdx.length&&!fixedSubs.length){
    const size=new Map(); for(const i of partsOf([])) if(touched.has(i)){ const b=find(i); size.set(b,(size.get(b)||0)+1); }
    let big=null; for(const [b,c] of size) if(big==null||c>size.get(big)) big=b;
    if(big!=null) frameSeed=frameSeed.concat(partsOf([]).filter(i=>find(i)===big));
  }
  unionAll(frameSeed);
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
  let ground;
  if(frameSeed.length) ground=find(frameSeed[0]);
  else{
    // nothing fixed and nothing at the root: the body with the most parts,
    // never a wheel on its own (the robot would spin about an axle)
    const n=new Map(); keys.forEach((k,i)=>{ const b=find(i); n.set(b,(n.get(b)||0)+1); });
    const wheelOnly=b=>keys.every((k,i)=>find(i)!==b||wheelIdx.includes(solidOf(i)));
    let best=null; for(const [b,c] of n) if(!wheelOnly(b)&&(best==null||c>n.get(best))) best=b;
    ground=best!=null?best:find(0);
  }
  const bodyOf=i=>find(i);

  // ---- joints: moving mates between two bodies, a tree out from the ground
  // the joints with a real degree of freedom first: a planar, parallel or ball mate between two
  // bodies (a guide, a loop closure) is walked last, so it is the one that closes a loop and the
  // arm's revolute, not the plate it slides on, is the joint that moves it
  const rank=m=>/^(REVOLUTE|SLIDER|CYLINDRICAL|PIN_SLOT)$/.test(m.type)?0:1;
  moving.sort((a,b)=>rank(a)-rank(b));
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
    if(Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])<0.2) wheelBody.add(b);
  }
  const seen=new Set([ground]), queue=[ground], joints=[], loops=[];
  const used=new Set();
  while(queue.length){
    const b=queue.shift();
    for(const e of edges){
      if(used.has(e)) continue;
      const other=e.ba===b?e.bb:(e.bb===b?e.ba:null); if(other==null) continue;
      used.add(e);
      if(seen.has(other)){ loops.push(e); continue; }
      seen.add(other); queue.push(other);
      joints.push({m:e.m, parent:b, child:other, parentEnd:e.ba===b?0:1});
    }
  }
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
      const lo=Array.isArray(j.m.limits)?j.m.limits[0]:mateQty(j.m.limits.min), hi=Array.isArray(j.m.limits)?j.m.limits[1]:mateQty(j.m.limits.max);
      const q=mateTravel(A,j.m,j.parentEnd,lin);
      if(q&&(Number.isFinite(lo)||Number.isFinite(hi))){
        // an end Onshape leaves open (no minimum, say) stays open: null, never NaN
        const a=Number.isFinite(lo)?q.s*(lo-q.v0):null, b=Number.isFinite(hi)?q.s*(hi-q.v0):null;
        m.limits=q.s>0?[a,b]:[b,a];
      }else if(!q&&(Number.isFinite(lo)||Number.isFinite(hi))) why.push("\""+j.m.name+"\" has limits, but its two ends' axes don't line up, so they were left off.");
      // an axis turned round (onshape-to-robot's _inv) runs the same travel the other way
      if(inv&&m.limits){ const [a,b]=m.limits; m.limits=[b==null?null:-b, a==null?null:-a]; }
    }
    if(t==="CYLINDRICAL") why.push("\""+j.m.name+"\" is cylindrical (turns and slides); it's simulated as the turn.");
    if(t==="PIN_SLOT") why.push("\""+j.m.name+"\" is a pin-slot; it's simulated as the pin's turn.");
    if(kind==="fixed"){
      why.push("\""+j.m.name+"\" is a "+t.toLowerCase().replace("_","-")+" mate, which the bench doesn't simulate; it's held where it was drawn.");
      issues.push({sev:"warn", code:"unsupported-mate", joint:m.id, text:"\""+j.m.name+"\" is a "+t.toLowerCase().replace("_","-")+" mate. The bench holds it where it was drawn; use revolute, slider or cylindrical mates for anything that moves."});
    }

    m.fromMate.key=j.m.id;
    mechOf.set(j.child,m);
    for(const si of members) solids[si].mech=m.id;
    mechs.push(m);
  }
  // parents: the joint whose child body this joint hangs from
  for(const j of joints){ const m=mechOf.get(j.child); if(!m) continue; const pm=mechOf.get(j.parent); if(pm) m.parent=pm.id; }

  // relations: one joint driven through another (a cascade slide, a gear pair, a rack)
  const byKey=new Map(); for(const [b,m] of mechOf) byKey.set(m.fromMate.key,m);
  for(const r of A.relations){
    // a relation names mates in its own definition: in this copy of it
    const ms=r.ids.map(id=>byKey.get(pathKey(r.prefix)+"#"+id)).filter(Boolean);
    if(ms.length!==2){
      issues.push({sev:"warn", code:"relation-dangling", text:"The "+(r.type?r.type.toLowerCase().replace(/_/g," ")+" ":"")+"relation \""+r.name+"\" ties "+(ms.length?"only one joint":"no joint")+
        " the bench simulates (a mate it names is suppressed, fastened, or a wheel), so it does nothing here."});
      continue;
    }
    const k=r.type==="RACK_AND_PINION"||r.type==="SCREW"?(Number.isFinite(r.length)?r.length/(2*Math.PI):NaN)
           :(Number.isFinite(r.ratio)&&r.ratio!==0?r.ratio:1);
    if(!Number.isFinite(k)) continue;
    ms[1].couple={to:ms[0].id, ratio:(r.reverse?-1:1)*k, via:r.type.toLowerCase().replace(/_/g," ")};
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
  // the team's own word, in the mates' names (src/jointsheet.js): "motor armMotor", "servo claw" ...
  // With one, the declared joints are the mechanisms and nothing is guessed
  cad.sheet=null;
  if(typeof sheetFromTags==="function"){ const tags=sheetFromTags(cad); if(tags) why.push(...applyJointSheet(cad,tags).why); }
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
