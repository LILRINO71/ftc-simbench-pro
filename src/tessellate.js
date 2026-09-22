/* ============================================================
   7b.  EXACT GEOMETRY — the STEP file's own B-rep, tessellated

   The parser keeps a thinned point cloud per part, and the view used to draw
   each part as that cloud's convex hull: a U-channel came out a brick, a
   mecanum wheel a puck. The STEP file carries the exact surfaces, and
   OpenCascade (occt-import-js, LGPL-2.1, loaded unmodified from jsDelivr the
   first time a STEP is dropped) turns them into triangles — the same
   triangles Onshape draws.

   occt knows nothing about mechanisms, so every mesh is matched back to the
   parser's solid (by name, then by where its box sits) and inherits that
   solid's mechanism: the arm's exact meshes swing with the arm. The matching
   is pure and tested in Node against the corpus; only Tess touches the DOM.
   ============================================================ */
const OCCT_CDN="https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/";
const OCCT_PARAMS={linearUnit:"meter", linearDeflectionType:"bounding_box_ratio", linearDeflection:0.001, angularDeflection:0.5};

/* Which mechanism carries a point, the rule the view has always used: the
   nearest link, except that a leaf effector only claims what is genuinely
   near it and a turret only what sits inside its radius. */
function mechOwner(cad,turretScale){
  const M=(cad&&cad.mechs)||[], bb=cad&&cad.bbox;
  const size=bb?Math.max(bb.max[0]-bb.min[0],bb.max[1]-bb.min[1],bb.max[2]-bb.min[2])||0.5:0.5;
  const ts=turretScale==null?0.55:turretScale;
  const distSeg=(p,a,b)=>{
    const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
    const L2=ab[0]*ab[0]+ab[1]*ab[1]+ab[2]*ab[2];
    let t=0;
    if(L2>1e-12) t=Math.max(0,Math.min(1,((p[0]-a[0])*ab[0]+(p[1]-a[1])*ab[1]+(p[2]-a[2])*ab[2])/L2));
    return Math.hypot(p[0]-a[0]-ab[0]*t, p[1]-a[1]-ab[1]*t, p[2]-a[2]-ab[2]*t);
  };
  // the view's rule: only links that can move claim parts
  const segs=M.filter(m=>m.pivot&&m.kind!=="fixed").map(m=>({id:m.id, m, a:m.pivot, b:m.distalTo||m.pivot}));
  const radialTo=(p,m)=>{
    const a=m.pivot, ax=m.axis, d=[p[0]-a[0],p[1]-a[1],p[2]-a[2]];
    const t=d[0]*ax[0]+d[1]*ax[1]+d[2]*ax[2];
    return Math.hypot(d[0]-ax[0]*t, d[1]-ax[1]*t, d[2]-ax[2]*t);
  };
  return p=>{
    if(!segs.length) return "chassis";
    let best=null, bd=1e9;
    for(const s of segs){ const d=distSeg(p,s.a,s.b); if(d<bd){ bd=d; best=s; } }
    let id=best.id; const m=best.m;
    if(!rigKids(M,m.id).length && m.lever>0 && bd>m.lever*0.55 && m.parent!=="chassis") id=m.parent;
    const root=M.filter(x=>x.id===id)[0];
    if(root&&root.parent==="chassis"&&root.kind==="revolute-yaw"){
      const turretR=Math.max(size*0.10,(root.lever||size*0.3)*ts);
      // and nothing beneath its own bearing: the battery under a turret stays put
      if(root.axis&&(radialTo(p,root)>turretR||p[2]<root.pivot[2]-0.02)) id="chassis";
    }
    return id;
  };
}
const solidCentroid=s=>{ const c=[0,0,0]; for(const p of s.pts){ c[0]+=p[0]; c[1]+=p[1]; c[2]+=p[2]; }
  const n=s.pts.length||1; return [c[0]/n,c[1]/n,c[2]/n]; };

/* The group of every solid; a solid's group is the one its centroid falls in. */
function solidGroups(cad,turretScale){
  const own=mechOwner(cad,turretScale), ids=new Set(((cad&&cad.mechs)||[]).map(m=>m.id));
  return ((cad&&cad.solids)||[]).map(s=>{ if(!s.pts||!s.pts.length) return "chassis";
    const g=own(solidCentroid(s)); return ids.has(g)?g:"chassis"; });
}

/* occt names the tree nodes, not always the meshes: the node that holds a
   mesh is the part it belongs to. */
function tessNames(res){
  const out=(res.meshes||[]).map(m=>m.name||"");
  const walk=n=>{ if(!n) return; for(const i of n.meshes||[]) if(!out[i]) out[i]=n.name||""; for(const c of n.children||[]) walk(c); };
  walk(res.root);
  return out;
}
const tessKey=s=>String(s||"").replace(/\s*<\d+>\s*$/,"").replace(/\s+/g," ").trim().toLowerCase();

/* A mesh's box in the canonical frame: raw CAD -> canonical by the frame's
   row-major 4x4, the same transform the parser gave its own points. */
function tessBox(pos,M){
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<pos.length;i+=3){
    const x=pos[i], y=pos[i+1], z=pos[i+2];
    for(let k=0;k<3;k++){ const v=M[4*k]*x+M[4*k+1]*y+M[4*k+2]*z+M[4*k+3]; if(v<mn[k]) mn[k]=v; if(v>mx[k]) mx[k]=v; }
  }
  return {min:mn, max:mx};
}
const IDENT4=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const frameM=cad=>(cad&&cad.frame&&cad.frame.M)||IDENT4;

/* How much of box a lies inside box b; a hair of slack so a flat plate or a
   body touching its part's hull still counts as inside. */
function boxInside(a,b){
  const pad=0.0015; let va=1, vi=1;
  for(let k=0;k<3;k++){
    const la=Math.max(a.max[k]-a.min[k],2*pad);
    const lo=Math.max(a.min[k]-pad,b.min[k]-pad), hi=Math.min(a.max[k]+pad,b.max[k]+pad);
    va*=la+2*pad; vi*=Math.max(0,hi-lo);
  }
  return va>0?vi/va:0;
}

/* Every occt mesh -> the index of the parser solid it is part of, or -1.
   A part of several bodies (a mecanum wheel and its rollers) is several
   meshes but one solid, so a mesh belongs to the solid whose box holds it.
   Name first: two identical wheels are told apart by where they sit. */
function tessMatch(cad,res){
  const solids=(cad&&cad.solids)||[], M=frameM(cad), names=tessNames(res);
  const sb=solids.map(s=>{ const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
    for(const p of s.pts||[]) for(let k=0;k<3;k++){ if(p[k]<mn[k]) mn[k]=p[k]; if(p[k]>mx[k]) mx[k]=p[k]; }
    return {min:mn, max:mx, vol:[0,1,2].reduce((v,k)=>v*Math.max(1e-4,mx[k]-mn[k]),1)}; });
  const byName={};
  solids.forEach((s,i)=>{ const k=tessKey(s.name); (byName[k]=byName[k]||[]).push(i); });
  const keys=Object.keys(byName);
  const pick=(box,cands,min)=>{
    let best=-1, bs=min, bv=Infinity;
    for(const i of cands){ if(!Number.isFinite(sb[i].min[0])) continue;
      const s=boxInside(box,sb[i]);
      // equally inside two parts: the tighter one is the more specific
      if(s>bs+1e-6||(s>bs-1e-6&&best>=0&&sb[i].vol<bv)){ best=i; bs=s; bv=sb[i].vol; } }
    return best;
  };
  const all=solids.map((s,i)=>i);
  const solid=[], boxes=[];
  (res.meshes||[]).forEach((m,j)=>{
    const pos=m.attributes&&m.attributes.position&&m.attributes.position.array||[];
    const box=tessBox(pos,M); boxes.push(box);
    if(!pos.length){ solid.push(-1); return; }
    const k=tessKey(names[j]);
    let cands=k?byName[k]:null;
    if(!cands&&k) for(const q of keys) if(q&&(q.startsWith(k)||k.startsWith(q))){ cands=(cands||[]).concat(byName[q]); }
    let i=cands?pick(box,cands,0.5):-1;
    if(i<0) i=pick(box,all,0.9);
    solid.push(i);
  });
  return {solid, boxes, names};
}

/* The mechanism group of every mesh: its solid's, and for a mesh with no
   solid (a screw the parser thinned away) the one its own centre falls in —
   an arm's screws ride the arm. */
function tessAssign(cad,res,turretScale){
  const mt=tessMatch(cad,res), sg=solidGroups(cad,turretScale), own=mechOwner(cad,turretScale);
  const ids=new Set(((cad&&cad.mechs)||[]).map(m=>m.id));
  const group=mt.solid.map((i,j)=>{
    if(i>=0) return sg[i];
    const b=mt.boxes[j]; if(!Number.isFinite(b.min[0])) return "chassis";
    const g=own([0,1,2].map(k=>(b.min[k]+b.max[k])/2)); return ids.has(g)?g:"chassis";
  });
  return {group, solid:mt.solid, names:mt.names};
}

/* The model's edges, as Onshape draws them: the boundaries of B-rep faces.
   occt says which triangles make each face (brep_faces), so an edge used by
   exactly one triangle of a face is that face's boundary — a real CAD edge,
   not a guess from angles (a crease threshold would draw every facet of a
   coarse cylinder and miss a tangent fillet). Meshes without face ranges
   fall back to creases steeper than 30 degrees on welded vertices. Returns
   line-segment pairs per mechanism group, in the canonical frame. */
function tessEdges(cad,res,asg,hidden){
  const M=frameM(cad), out={};
  const put=(g,ax,ay,az,bx,by,bz)=>{ const a=out[g]||(out[g]=[]); a.push(
    M[0]*ax+M[1]*ay+M[2]*az+M[3], M[4]*ax+M[5]*ay+M[6]*az+M[7], M[8]*ax+M[9]*ay+M[10]*az+M[11],
    M[0]*bx+M[1]*by+M[2]*bz+M[3], M[4]*bx+M[5]*by+M[6]*bz+M[7], M[8]*bx+M[9]*by+M[10]*bz+M[11]); };
  (res.meshes||[]).forEach((m,j)=>{
    if(hidden&&hidden.has(j)) return;
    const P=m.attributes&&m.attributes.position&&m.attributes.position.array, I=m.index&&m.index.array;
    if(!P||!P.length||!I||!I.length) return;
    const g=asg.group[j];
    if(m.brep_faces&&m.brep_faces.length){
      for(const f of m.brep_faces){
        const cnt=new Map();
        for(let t=f.first;t<=f.last;t++) for(let e=0;e<3;e++){
          const a=I[3*t+e], b=I[3*t+(e+1)%3], k=a<b?a*4294967296+b:b*4294967296+a;
          cnt.set(k,(cnt.get(k)||0)+1);
        }
        for(const [k,n] of cnt){ if(n!==1) continue;
          const a=Math.floor(k/4294967296), b=k%4294967296;
          put(g,P[3*a],P[3*a+1],P[3*a+2],P[3*b],P[3*b+1],P[3*b+2]); }
      }
      return;
    }
    // no face ranges: weld by position, then keep creases and open borders
    const key=i=>Math.round(P[3*i]*1e5)+","+Math.round(P[3*i+1]*1e5)+","+Math.round(P[3*i+2]*1e5);
    const weld=new Map(), id=new Uint32Array(P.length/3);
    for(let i=0;i<id.length;i++){ const k=key(i); if(!weld.has(k)) weld.set(k,i); id[i]=weld.get(k); }
    const nrm=t=>{ const a=I[3*t],b=I[3*t+1],c=I[3*t+2];
      const ux=P[3*b]-P[3*a],uy=P[3*b+1]-P[3*a+1],uz=P[3*b+2]-P[3*a+2], vx=P[3*c]-P[3*a],vy=P[3*c+1]-P[3*a+1],vz=P[3*c+2]-P[3*a+2];
      const n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx], L=Math.hypot(n[0],n[1],n[2])||1; return [n[0]/L,n[1]/L,n[2]/L]; };
    const edges=new Map();
    for(let t=0;t<I.length/3;t++) for(let e=0;e<3;e++){
      const a=id[I[3*t+e]], b=id[I[3*t+(e+1)%3]]; if(a===b) continue;
      const k=a<b?a+"_"+b:b+"_"+a; const r=edges.get(k); if(r) r.t.push(t); else edges.set(k,{a,b,t:[t]}); }
    const cos30=Math.cos(Math.PI/6);
    for(const e of edges.values()){
      let keep=e.t.length!==2;
      if(!keep){ const n1=nrm(e.t[0]), n2=nrm(e.t[1]); keep=n1[0]*n2[0]+n1[1]*n2[1]+n1[2]*n2[2]<cos30; }
      if(keep) put(g,P[3*e.a],P[3*e.a+1],P[3*e.a+2],P[3*e.b],P[3*e.b+1],P[3*e.b+2]);
    }
  });
  return Object.keys(out).map(g=>({group:g, pos:new Float32Array(out[g])}));
}

/* The assembly as occt read it — the instance list Onshape shows — with
   every node's meshes (its own and all below) so a click anywhere selects
   the whole sub-assembly. */
function tessTree(res){
  const names=tessNames(res);
  let n=0;
  const walk=node=>{
    const kids=(node.children||[]).map(walk).filter(Boolean);
    const own=(node.meshes||[]).slice();
    const all=own.concat(...kids.map(k=>k.all));
    if(!all.length) return null;
    const name=node.name||(own.length===1?names[own[0]]:"")||"(unnamed)";
    return {id:"n"+(n++), name, own, all, kids};
  };
  return walk(res.root||{})||{id:"n0", name:"", own:[], all:[], kids:[]};
}

/* The draw buckets: one indexed buffer per (group, colour), in the canonical
   frame. STEP colours win, per face where the file has them; a part with
   none gets its solid kind and the view's palette. Each bucket remembers
   which triangles came from which mesh (`ranges`), so a click on the merged
   buffer still finds the part; `hidden` leaves meshes out. */
function tessBuckets(cad,res,asg,hidden){
  const M=frameM(cad), solids=(cad&&cad.solids)||[], out={};
  const hex=c=>c?"#"+c.map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,"0")).join(""):null;
  const bucket=(g,col,kind)=>{ const key=g+"|"+(col||"kind:"+kind);
    return out[key]=out[key]||{group:g, color:col, kind, parts:[], nv:0, ni:0}; };
  (res.meshes||[]).forEach((m,j)=>{
    if(hidden&&hidden.has(j)) return;
    const P=m.attributes&&m.attributes.position&&m.attributes.position.array, I=m.index&&m.index.array;
    if(!P||!P.length||!I||!I.length) return;
    const g=asg.group[j], si=asg.solid[j], kind=(si>=0&&solids[si].kind)||"metal";
    const base=hex(m.color);
    // triangle ranges by colour; faces without their own take the mesh's
    const runs={};
    const faces=m.brep_faces&&m.brep_faces.length?m.brep_faces:[{first:0,last:I.length/3-1,color:null}];
    for(const f of faces){ const c=hex(f.color)||base||""; (runs[c]=runs[c]||[]).push(f); }
    for(const c in runs){
      const b=bucket(g,c||null,kind);
      let nt=0; for(const f of runs[c]) nt+=f.last-f.first+1;
      b.parts.push({m, j, faces:runs[c], nt}); b.nv+=P.length/3; b.ni+=nt*3;
    }
  });
  const list=[];
  for(const key in out){
    const b=out[key], pos=new Float32Array(b.nv*3), nor=new Float32Array(b.nv*3), idx=new Uint32Array(b.ni);
    let vo=0, io=0; const ranges=[];
    for(const p of b.parts){
      ranges.push({j:p.j, start:io/3, count:p.nt});
      const P=p.m.attributes.position.array, N=p.m.attributes.normal&&p.m.attributes.normal.array, I=p.m.index.array;
      for(let i=0;i<P.length;i+=3){
        const x=P[i], y=P[i+1], z=P[i+2], o=vo*3+i;
        pos[o]=M[0]*x+M[1]*y+M[2]*z+M[3]; pos[o+1]=M[4]*x+M[5]*y+M[6]*z+M[7]; pos[o+2]=M[8]*x+M[9]*y+M[10]*z+M[11];
        if(N){ const a=N[i], c=N[i+1], d=N[i+2];
          nor[o]=M[0]*a+M[1]*c+M[2]*d; nor[o+1]=M[4]*a+M[5]*c+M[6]*d; nor[o+2]=M[8]*a+M[9]*c+M[10]*d; }
      }
      for(const f of p.faces) for(let t=f.first*3;t<=f.last*3+2;t++) idx[io++]=I[t]+vo;
      vo+=P.length/3;
    }
    list.push({group:b.group, color:b.color, kind:b.kind, pos, nor, idx, ranges, hasNormals:b.parts.every(p=>p.m.attributes.normal)});
  }
  return list;
}

/* ---- the DOM side: fetch OpenCascade once, run it off the main thread ---- */
const Tess={
  worker:null, mod:null, seq:0, pending:{},
  /* A Blob worker that pulls occt from the CDN, so a 2000-part assembly
     tessellates without freezing the page. Typed arrays come back
     transferred, not copied. */
  makeWorker(){
    const src=`importScripts(${JSON.stringify(OCCT_CDN+"occt-import-js.js")});
let ready=null;
onmessage=async e=>{
  const d=e.data;
  try{
    ready=ready||occtimportjs({locateFile:f=>${JSON.stringify(OCCT_CDN)}+f});
    const oc=await ready, r=oc.ReadStepFile(new Uint8Array(d.buf),d.params), tr=[];
    if(r&&r.success) for(const m of r.meshes){
      const P=new Float32Array(m.attributes.position.array); m.attributes.position.array=P; tr.push(P.buffer);
      if(m.attributes.normal){ const N=new Float32Array(m.attributes.normal.array); m.attributes.normal.array=N; tr.push(N.buffer); }
      if(m.index){ const I=new Uint32Array(m.index.array); m.index.array=I; tr.push(I.buffer); }
    }
    postMessage({id:d.id, ok:!!(r&&r.success), res:r},tr);
  }catch(err){ postMessage({id:d.id, ok:false, error:String(err&&err.message||err)}); }
};`;
    const url=URL.createObjectURL(new Blob([src],{type:"text/javascript"}));
    const w=new Worker(url);
    w.onmessage=e=>{ const p=this.pending[e.data.id]; if(!p) return; delete this.pending[e.data.id];
      e.data.ok?p.resolve(e.data.res):p.reject(new Error(e.data.error||"OpenCascade couldn't read this STEP file")); };
    w.onerror=e=>{ e.preventDefault&&e.preventDefault(); this.fail(new Error("the OpenCascade worker didn't start ("+(e.message||"blocked")+")")); };
    return w;
  },
  fail(err){ for(const id in this.pending){ this.pending[id].reject(err); } this.pending={};
    if(this.worker){ try{ this.worker.terminate(); }catch(e){} } this.worker=null; this.noWorker=true; },
  /* No worker (a sandbox that forbids blob workers): the same library on the
     main thread, loaded by a script tag. */
  mainThread(buf){
    const load=this.mod||(this.mod=new Promise((res,rej)=>{
      if(typeof occtimportjs==="function"){ res(); return; }
      const s=document.createElement("script"); s.src=OCCT_CDN+"occt-import-js.js"; s.async=true;
      s.onload=()=>res(); s.onerror=()=>rej(new Error("couldn't load OpenCascade from the CDN"));
      document.head.appendChild(s);
    }).then(()=>occtimportjs({locateFile:f=>OCCT_CDN+f})));
    load.catch(()=>{ this.mod=null; });
    return load.then(oc=>{ const r=oc.ReadStepFile(new Uint8Array(buf),OCCT_PARAMS);
      if(!r||!r.success) throw new Error("OpenCascade couldn't read this STEP file"); return r; });
  },
  /* STEP text -> occt result, or a rejection with a short reason. */
  run(text,timeoutMs){
    const buf=new TextEncoder().encode(text).buffer;
    let job;
    if(!this.noWorker){
      try{ this.worker=this.worker||this.makeWorker(); }catch(e){ this.worker=null; this.noWorker=true; }
    }
    if(this.worker){
      const id=++this.seq;
      job=new Promise((resolve,reject)=>{ this.pending[id]={resolve,reject}; });
      this.worker.postMessage({id, buf, params:OCCT_PARAMS},[buf]);
      // a worker that dies on start (CSP, offline importScripts) falls back once
      job=job.catch(e=>{ if(this.noWorker&&!/couldn't read/.test(e.message)) return this.mainThread(new TextEncoder().encode(text).buffer); throw e; });
    }else job=this.mainThread(buf);
    const ms=timeoutMs||120000;
    let timer=null;
    const late=new Promise((_,rej)=>{ timer=setTimeout(()=>{
      // a stuck worker is dropped, so the next STEP starts clean
      if(this.worker){ try{ this.worker.terminate(); }catch(e){} this.worker=null; this.pending={}; }
      rej(new Error("OpenCascade took over "+Math.round(ms/1000)+" s")); },ms); });
    return Promise.race([job,late]).finally(()=>clearTimeout(timer));
  },
};
