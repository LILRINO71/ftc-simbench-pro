/* ============================================================
   ROBOT PACKAGE (.simbot) — the whole robot in one file
   ------------------------------------------------------------
   A STEP file has shapes and no joints; an Onshape import has both but
   needs Onshape every time; a joint spec needs the same STEP next to it.
   A robot package carries everything the bench needs, once, made from
   whichever of those the team had:

     manifest.json   what this is, where it came from, what to check
     joints.json     the joints (format ftc-sim-bench.joints, version 2):
                     axes, pivots, travel, the parts each carries, and the
                     constraints between them — gear, rack, screw and cascade
                     couplings, linkages, and the mates that close loops
     bindings.json   which code device drives which joint
     mass.json       each rigid body's mass and centre of mass
     robot.glb       the geometry: one mesh per unique shape, placed at every
                     copy (glTF instancing), grouped under one node per body

   It's a plain zip, so any unzip tool opens it and any glTF viewer shows
   the robot. Files are millimetres and degrees, like a joint spec; the
   glb is metres, Y up, as glTF says. Loading one never touches Onshape and
   never re-parses a STEP.

   TRUST: teams mail these to each other. Every size is capped before it is
   allocated, every index and offset is checked, and nothing in one is ever
   evaluated. The loader never throws on a bad file: it says why.
   ============================================================ */
const SIMBOT_FORMAT="ftc-simbench.robot";
const SIMBOT_VERSION=1;
const SIMBOT_BINDINGS="ftc-simbench.bindings";

const {simbotFromCad, simbotPack, simbotUnpack, cadFromSimbot, validateRobot, zipWrite, zipRead, glbWrite, glbRead, sbCrc32, SIMBOT_CAPS}=(function(){
  const CAPS={
    zipBytes:20e6,          // the package as mailed
    unzipped:150e6,         // everything in it, unpacked
    files:32, json:8e6, jsonDepth:40,
    parts:6000, meshes:6000, nodes:20000, triangles:4e6, joints:400, constraints:400, devices:400
  };
  const fin=Number.isFinite;
  const isObj=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
  const enc=s=>new TextEncoder().encode(s);
  const dec=u=>new TextDecoder().decode(u);
  const bad=(code,msg)=>{ const e=new Error(msg); e.simbot=code; throw e; };

  /* ---- CRC-32 (the zip one) ---- */
  const CRC=(()=>{ const t=new Uint32Array(256);
    for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
  function sbCrc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=CRC[(c^u8[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }

  /* ---- deflate, the browser's own (and Node's): no library ---- */
  async function deflateRaw(u8){
    if(typeof CompressionStream!=="function") return null;
    try{ const s=new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(s).arrayBuffer()); }catch(e){ return null; }
  }
  // stops the moment the output passes what the zip said it would be: a zip bomb
  // gets no further than its own claim
  async function inflateRaw(u8,expect){
    if(typeof DecompressionStream!=="function") bad("no-inflate","this browser can't unpack compressed files");
    const rd=new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const out=new Uint8Array(expect); let n=0;
    for(;;){ const {done,value}=await rd.read(); if(done) break;
      if(n+value.length>expect){ try{ rd.cancel(); }catch(e){} bad("zip-size","a file in the package is bigger than the package says"); }
      out.set(value,n); n+=value.length; }
    if(n!==expect) bad("zip-size","a file in the package is shorter than the package says");
    return out;
  }

  /* ---- zip: the plain kind, deterministic (a fixed date), UTF-8 names ---- */
  async function zipWrite(entries,opts){
    const o=opts||{}, files=[];
    for(const e of entries){
      const data=typeof e.data==="string"?enc(e.data):e.data;
      const crc=sbCrc32(data);
      let method=0, body=data;
      if(o.deflate!==false&&data.length>64){ const z=await deflateRaw(data); if(z&&z.length<data.length){ method=8; body=z; } }
      files.push({name:enc(e.name), data, body, crc, method});
    }
    let size=22; for(const f of files) size+=30+f.name.length+f.body.length+46+f.name.length;
    const out=new Uint8Array(size), dv=new DataView(out.buffer);
    let p=0; const offs=[];
    const head=(sig,f,central,off)=>{
      dv.setUint32(p,sig,true); p+=4;
      if(central){ dv.setUint16(p,20,true); p+=2; }
      dv.setUint16(p,20,true); dv.setUint16(p+2,0x0800,true); dv.setUint16(p+4,f.method,true);
      dv.setUint16(p+6,0,true); dv.setUint16(p+8,0x0021,true);            // 00:00, 1 Jan 1980
      dv.setUint32(p+10,f.crc,true); dv.setUint32(p+14,f.body.length,true); dv.setUint32(p+18,f.data.length,true);
      dv.setUint16(p+22,f.name.length,true); dv.setUint16(p+24,0,true); p+=26;
      if(central){ dv.setUint16(p,0,true); dv.setUint16(p+2,0,true); dv.setUint16(p+4,0,true); dv.setUint32(p+6,0,true); dv.setUint32(p+10,off,true); p+=14; }
      out.set(f.name,p); p+=f.name.length;
    };
    for(const f of files){ offs.push(p); head(0x04034b50,f,false); out.set(f.body,p); p+=f.body.length; }
    const cd=p;
    files.forEach((f,i)=>head(0x02014b50,f,true,offs[i]));
    dv.setUint32(p,0x06054b50,true); dv.setUint16(p+4,0,true); dv.setUint16(p+6,0,true);
    dv.setUint16(p+8,files.length,true); dv.setUint16(p+10,files.length,true);
    dv.setUint32(p+12,p-cd,true); dv.setUint32(p+16,cd,true); dv.setUint16(p+20,0,true);
    return out;
  }
  /* name -> bytes. Refuses encrypted, spanned and zip64 archives, paths that
     climb out (../, /x, C:\x), duplicate names, and anything over the caps. */
  async function zipRead(u8,caps){
    const C=Object.assign({},CAPS,caps||{});
    if(!(u8 instanceof Uint8Array)) u8=new Uint8Array(u8);
    if(u8.length>C.zipBytes) bad("too-big","the package is "+u8.length+" bytes; the limit is "+C.zipBytes);
    if(u8.length<22) bad("not-zip","this isn't a robot package (too short to be a zip)");
    const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
    let e=-1;
    for(let i=u8.length-22;i>=Math.max(0,u8.length-22-65535);i--) if(dv.getUint32(i,true)===0x06054b50){ e=i; break; }
    if(e<0) bad("not-zip","this isn't a robot package (no zip directory)");
    const n=dv.getUint16(e+10,true), cdSize=dv.getUint32(e+12,true), cdOff=dv.getUint32(e+16,true);
    if(dv.getUint16(e+4,true)||dv.getUint16(e+6,true)) bad("not-zip","a split zip can't be read");
    if(n>C.files) bad("too-big","the package holds "+n+" files; the limit is "+C.files);
    if(cdOff+cdSize>e||cdOff===0xFFFFFFFF) bad("not-zip","the zip directory points outside the file");
    const out=new Map(); let p=cdOff, total=0;
    for(let k=0;k<n;k++){
      if(p+46>e||dv.getUint32(p,true)!==0x02014b50) bad("not-zip","the zip directory is damaged");
      const flags=dv.getUint16(p+8,true), method=dv.getUint16(p+10,true), crc=dv.getUint32(p+16,true);
      const csize=dv.getUint32(p+20,true), usize=dv.getUint32(p+24,true);
      const nl=dv.getUint16(p+28,true), xl=dv.getUint16(p+30,true), cl=dv.getUint16(p+32,true), off=dv.getUint32(p+42,true);
      if(p+46+nl>e) bad("not-zip","the zip directory is damaged");
      const name=dec(u8.subarray(p+46,p+46+nl));
      p+=46+nl+xl+cl;
      if(flags&1) bad("encrypted","the package is password-protected");
      if(csize===0xFFFFFFFF||usize===0xFFFFFFFF||off===0xFFFFFFFF) bad("too-big","zip64 packages aren't read");
      if(!name||name.length>200||/(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[a-z]:/i.test(name)||/\\/.test(name)) bad("bad-name","a file in the package has an unsafe name");
      if(name.endsWith("/")) continue;                                  // a folder entry
      if(out.has(name)) bad("bad-name","two files in the package are both called "+name);
      if(method!==0&&method!==8) bad("not-zip","a file in the package uses a compression this can't read");
      total+=usize; if(total>C.unzipped) bad("too-big","the package unpacks to more than "+C.unzipped+" bytes");
      if(off+30>e||dv.getUint32(off,true)!==0x04034b50) bad("not-zip","a file in the package is damaged");
      const start=off+30+dv.getUint16(off+26,true)+dv.getUint16(off+28,true);
      if(start+csize>cdOff) bad("not-zip","a file in the package runs past its end");
      const raw=u8.subarray(start,start+csize);
      const data=method===0?(csize===usize?raw.slice():bad("zip-size","a stored file's sizes disagree")):await inflateRaw(raw,usize);
      if(sbCrc32(data)!==crc) bad("bad-crc","a file in the package is damaged (its checksum is wrong)");
      out.set(name,data);
    }
    return out;
  }

  /* JSON from a file: size and nesting refused before parsing */
  function readJson(u8,what){
    if(!u8) bad("missing",what+" is missing from the package");
    if(u8.length>CAPS.json) bad("too-big",what+" is "+u8.length+" bytes; the limit is "+CAPS.json);
    const t=dec(u8);
    let d=0, max=0, inStr=false, esc=false;
    for(let i=0;i<t.length;i++){ const c=t.charCodeAt(i);
      if(inStr){ if(esc) esc=false; else if(c===92) esc=true; else if(c===34) inStr=false; continue; }
      if(c===34) inStr=true; else if(c===123||c===91){ if(++d>max) max=d; } else if(c===125||c===93) d--; }
    if(max>CAPS.jsonDepth) bad("too-deep",what+" nests "+max+" levels deep");
    try{ return JSON.parse(t); }catch(e){ bad("bad-json",what+" isn't valid JSON"); }
  }

  /* ---- matrices: row-major 4x4 inside, glTF's column-major at the edge ---- */
  const I4=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const m4=M=>Array.isArray(M)||ArrayBuffer.isView(M)?(M.length>=16?Array.from(M).slice(0,16):M.length===12?Array.from(M).concat([0,0,0,1]):I4.slice()):I4.slice();
  const mul4=(A,B)=>{ const o=new Array(16); for(let r=0;r<4;r++) for(let c=0;c<4;c++){ let s=0; for(let k=0;k<4;k++) s+=A[4*r+k]*B[4*k+c]; o[4*r+c]=s; } return o; };
  const toCol=M=>[M[0],M[4],M[8],M[12], M[1],M[5],M[9],M[13], M[2],M[6],M[10],M[14], M[3],M[7],M[11],M[15]];
  const fromCol=c=>[c[0],c[4],c[8],c[12], c[1],c[5],c[9],c[13], c[2],c[6],c[10],c[14], c[3],c[7],c[11],c[15]];
  const isI=M=>M.every((v,i)=>Math.abs(v-I4[i])<1e-12);
  // the robot frame is +z up; glTF is +y up: the root node turns one into the other
  const ZUP_TO_YUP=[1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1];
  const YUP_TO_ZUP=[1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1];
  const trs=(t,r,s)=>{ const [x,y,z,w]=r||[0,0,0,1], S=s||[1,1,1], T=t||[0,0,0];
    return [(1-2*(y*y+z*z))*S[0],2*(x*y-z*w)*S[1],2*(x*z+y*w)*S[2],T[0],
            2*(x*y+z*w)*S[0],(1-2*(x*x+z*z))*S[1],2*(y*z-x*w)*S[2],T[1],
            2*(x*z-y*w)*S[0],2*(y*z+x*w)*S[1],(1-2*(x*x+y*y))*S[2],T[2], 0,0,0,1]; };

  /* triangle soup -> shared vertices and indices (a shape's facets share corners) */
  function weld(soup){
    const map=new Map(), pos=[], idx=new Uint32Array(Math.floor(soup.length/3));
    for(let i=0;i<idx.length;i++){
      const x=soup[3*i], y=soup[3*i+1], z=soup[3*i+2];
      const k=Math.round(x*1e7)+","+Math.round(y*1e7)+","+Math.round(z*1e7);
      let v=map.get(k); if(v===undefined){ v=pos.length/3; map.set(k,v); pos.push(x,y,z); }
      idx[i]=v;
    }
    return {pos:Float32Array.from(pos), idx};
  }

  /* ---- glb: glTF 2.0's one-file form ----
     doc = {meshes:[{pos, idx, material, name}], materials:[{color, name, extras}],
            nodes:[{name, mesh, matrix (row-major), children, extras}], scene:[roots], extras} */
  function glbWrite(doc){
    const views=[], accessors=[], chunks=[]; let off=0;
    const push=(u8,target)=>{ const pad=(4-(off%4))%4; if(pad){ chunks.push(new Uint8Array(pad)); off+=pad; }
      views.push({buffer:0, byteOffset:off, byteLength:u8.length, target}); chunks.push(u8); off+=u8.length; return views.length-1; };
    const meshes=doc.meshes.map(m=>{
      const P=m.pos instanceof Float32Array?m.pos:Float32Array.from(m.pos);
      const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<P.length;i+=3) for(let k=0;k<3;k++){ if(P[i+k]<mn[k]) mn[k]=P[i+k]; if(P[i+k]>mx[k]) mx[k]=P[i+k]; }
      if(!P.length){ mn.fill(0); mx.fill(0); }
      const pv=push(new Uint8Array(P.buffer,P.byteOffset,P.byteLength),34962);
      accessors.push({bufferView:pv, componentType:5126, count:P.length/3, type:"VEC3", min:mn, max:mx});
      const prim={attributes:{POSITION:accessors.length-1}, mode:4};
      if(m.idx){
        const small=P.length/3<=65535, I=small?Uint16Array.from(m.idx):(m.idx instanceof Uint32Array?m.idx:Uint32Array.from(m.idx));
        const iv=push(new Uint8Array(I.buffer,I.byteOffset,I.byteLength),34963);
        accessors.push({bufferView:iv, componentType:small?5123:5125, count:I.length, type:"SCALAR"});
        prim.indices=accessors.length-1;
      }
      if(Number.isInteger(m.material)) prim.material=m.material;
      return {name:m.name||undefined, primitives:[prim]};
    });
    const json={asset:{version:"2.0", generator:"FTC SimBench Pro"}, scene:0, scenes:[{nodes:doc.scene}],
      nodes:doc.nodes.map(n=>{ const o={}; if(n.name) o.name=n.name; if(Number.isInteger(n.mesh)) o.mesh=n.mesh;
        if(n.matrix&&!isI(n.matrix)) o.matrix=toCol(n.matrix); if(n.children&&n.children.length) o.children=n.children; if(n.extras) o.extras=n.extras; return o; }),
      meshes, materials:doc.materials.map(m=>({name:m.name||undefined, pbrMetallicRoughness:{baseColorFactor:[m.color[0],m.color[1],m.color[2],1], metallicFactor:m.metal!=null?m.metal:0.3, roughnessFactor:m.rough!=null?m.rough:0.6}, extras:m.extras})),
      accessors, bufferViews:views, buffers:[{byteLength:off}]};
    if(doc.extras) json.extras=doc.extras;
    if(!meshes.length){ delete json.meshes; delete json.accessors; delete json.bufferViews; delete json.buffers; }
    let J=enc(JSON.stringify(json)); const jp=(4-J.length%4)%4;
    if(jp){ const t=new Uint8Array(J.length+jp); t.set(J); t.fill(0x20,J.length); J=t; }
    const binLen=off+((4-off%4)%4);
    const total=12+8+J.length+(off?8+binLen:0);
    const out=new Uint8Array(total), dv=new DataView(out.buffer);
    dv.setUint32(0,0x46546C67,true); dv.setUint32(4,2,true); dv.setUint32(8,total,true);
    dv.setUint32(12,J.length,true); dv.setUint32(16,0x4E4F534A,true); out.set(J,20);
    if(off){ let p=20+J.length; dv.setUint32(p,binLen,true); dv.setUint32(p+4,0x004E4942,true); p+=8;
      for(const c of chunks){ out.set(c,p); p+=c.length; } }
    return out;
  }
  /* The glb's JSON and, for every mesh, its positions and indices: bounds-checked */
  function glbRead(u8,caps){
    const C=Object.assign({},CAPS,caps||{});
    if(!(u8 instanceof Uint8Array)) u8=new Uint8Array(u8);
    const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
    if(u8.length<20||dv.getUint32(0,true)!==0x46546C67) bad("not-glb","robot.glb isn't a glTF binary");
    if(dv.getUint32(4,true)!==2) bad("not-glb","robot.glb isn't glTF 2.0");
    const jl=dv.getUint32(12,true);
    if(dv.getUint32(16,true)!==0x4E4F534A||20+jl>u8.length) bad("not-glb","robot.glb is damaged");
    const json=readJson(u8.subarray(20,20+jl),"robot.glb's description");
    let bin=new Uint8Array(0); const bp=20+jl;
    if(bp+8<=u8.length&&dv.getUint32(bp+4,true)===0x004E4942){ const bl=dv.getUint32(bp,true); if(bp+8+bl>u8.length) bad("not-glb","robot.glb is cut short"); bin=u8.subarray(bp+8,bp+8+bl); }
    const A=Array.isArray(json.accessors)?json.accessors:[], V=Array.isArray(json.bufferViews)?json.bufferViews:[];
    if((json.meshes||[]).length>C.meshes) bad("too-big","robot.glb has "+json.meshes.length+" meshes; the limit is "+C.meshes);
    if((json.nodes||[]).length>C.nodes) bad("too-big","robot.glb has "+json.nodes.length+" nodes; the limit is "+C.nodes);
    let tris=0;
    const view=(ai,type,comp)=>{
      const a=A[ai]; if(!isObj(a)||a.type!==type||!comp.includes(a.componentType)) bad("not-glb","robot.glb has a mesh this can't read");
      const v=V[a.bufferView]; if(!isObj(v)||(v.buffer||0)!==0) bad("not-glb","robot.glb points outside its data");
      const size={5126:4,5125:4,5123:2,5121:1}[a.componentType], n=type==="VEC3"?3:1, count=a.count;
      if(!Number.isInteger(count)||count<0) bad("not-glb","robot.glb has a bad count");
      const stride=v.byteStride||size*n; if(stride!==size*n) bad("not-glb","robot.glb interleaves data, which this doesn't read");
      const start=(v.byteOffset||0)+(a.byteOffset||0), len=count*n*size;
      if(start+len>(v.byteOffset||0)+v.byteLength||start+len>bin.length||start%size) bad("not-glb","robot.glb points outside its data");
      const b=bin.slice(start,start+len);
      return a.componentType===5126?new Float32Array(b.buffer):a.componentType===5125?new Uint32Array(b.buffer):a.componentType===5123?new Uint16Array(b.buffer):new Uint8Array(b.buffer);
    };
    const meshes=(json.meshes||[]).map(m=>{
      const p=m&&Array.isArray(m.primitives)?m.primitives[0]:null;
      if(!p||!p.attributes||!Number.isInteger(p.attributes.POSITION)) bad("not-glb","robot.glb has a mesh with no positions");
      if(p.mode!=null&&p.mode!==4) bad("not-glb","robot.glb has a mesh that isn't triangles");
      const pos=view(p.attributes.POSITION,"VEC3",[5126]);
      for(let i=0;i<pos.length;i++) if(!fin(pos[i])) bad("bad-number","robot.glb has a point that isn't a number");
      let idx=Number.isInteger(p.indices)?view(p.indices,"SCALAR",[5125,5123,5121]):null;
      const nv=pos.length/3;
      if(idx){ for(let i=0;i<idx.length;i++) if(idx[i]>=nv) bad("not-glb","robot.glb indexes past its points"); }
      const nt=idx?idx.length/3:nv/3; tris+=nt;
      if(tris>C.triangles) bad("too-big","robot.glb has more than "+C.triangles+" triangles");
      return {name:m.name||"", pos, idx, material:Number.isInteger(p.material)?p.material:null};
    });
    return {json, meshes};
  }

  /* ---- the colours a part's kind gets when its CAD gave none ---- */
  const KIND_RGB={metal:[0.66,0.69,0.72], motor:[0.17,0.18,0.19], servo:[0.11,0.11,0.12], wheel:[0.21,0.22,0.23],
    electronics:[0.15,0.16,0.17], clear:[0.84,0.9,0.94], printed:[0.9,0.65,0.16], fastener:[0.35,0.37,0.39],
    belt:[0.09,0.09,0.09], yellow:[0.95,0.7,0.19], hub:[0.12,0.13,0.14], orange:[0.91,0.44,0.16]};

  /* ---- what a person should check before trusting the robot ---- */
  const CONTINUOUS=/intake|roller|wheel|spin|flywheel|shooter|launcher|sweeper|brush|continuous/i;
  function validateRobot(cad,opts){
    const o=opts||{}, items=[], seen=new Set();
    const put=it=>{ const k=it.code+"|"+(it.joint||"")+"|"+it.text; if(!seen.has(k)){ seen.add(k); items.push(it); } };
    const mates=cad&&cad.mates;
    for(const i of (mates&&mates.issues)||[]) if(i&&i.code&&i.text) put({sev:i.sev||"warn", code:i.code, text:i.text, joint:i.joint||null});
    if(!mates) put({sev:"warn", code:"draft", text:"No joints were read from the CAD: every mechanism is a guess from the shapes. Get the robot from Onshape, or check each joint in the robot check."});
    else if(mates.source==="spec"&&mates.auto) put({sev:"warn", code:"draft", text:"The joints were found from the geometry, not read from the CAD. Check each one in the robot check before trusting it."});
    const mechs=((cad&&cad.mechs)||[]).filter(m=>!m.drive&&m.kind!=="fixed");
    for(const m of mechs){
      if(m.couple) continue;                                    // a follower's travel is its leader's
      const lim=m.limits&&(fin(m.limits[0])||fin(m.limits[1]));
      if(!lim&&!m.continuous&&!CONTINUOUS.test((m.id||"")+" "+(m.alias||"")))
        put({sev:"warn", code:"no-limits", joint:m.id, text:"\""+(m.label||m.id)+"\" has no travel limits, so nothing stops it short of the code. Give it limits in the CAD (Onshape mate limits, a URDF limit, an MJCF range), or set them in the joint editor."});
    }
    if(cad&&(cad.source==="onshape"||cad.source==="urdf"||cad.source==="mjcf")){
      const none=(cad.solids||[]).filter(s=>!(s.kg>0));
      if(none.length) put({sev:none.length>(cad.solids||[]).length/4?"warn":"note", code:"no-mass", text:none.length+" of "+(cad.solids||[]).length+" parts came with no mass ("+
        [...new Set(none.map(s=>s.name||"part"))].slice(0,5).join(", ")+(none.length>5?" …":"")+"). Give them a material in the CAD; until then their mass is estimated from their shape."});
    }
    if(Array.isArray(o.devices)){
      const acts=o.devices.filter(d=>d&&/servo|dcmotor/i.test(d.type||"")&&!(typeof isDriveDevice==="function"&&isDriveDevice(d)));
      const driven=new Set(Object.values(o.map||{}).filter(Boolean));
      for(const m of mechs){
        if(m.couple||driven.has(m.id)||m.passive) continue;
        put({sev:"note", code:"no-device", joint:m.id, text:"No device in the code drives \""+(m.label||m.id)+"\". Name its mate exactly as the device's configuration name ("+
          (acts.slice(0,3).map(d=>d.cfg||d.name).join(", ")||"none in this OpMode")+") and it binds by itself."});
      }
    }
    if(cad&&Array.isArray(cad.loops)&&cad.loops.length&&!items.some(i=>i.code==="loop"))
      put({sev:"note", code:"loop", text:cad.loops.length+" linkage loop"+(cad.loops.length===1?"":"s")+" closed by a mate. The physics solver pins "+(cad.loops.length===1?"it":"them")+"; the kinematic bench drives each through its first joint."});
    const counts={error:0, warn:0, note:0}; for(const i of items) counts[i.sev]=(counts[i.sev]||0)+1;
    return {items, counts, ok:!counts.error};
  }

  /* ---- a live robot -> the package (a plain object; simbotPack zips it) ----
     opts: devices (the code's), map (device -> joint), created (an ISO date; the
     engine never reads the clock), app {version, build}, meshFor(i, solid) ->
     [{key, pos, idx?, M}] for exact geometry the bench holds outside the CAD
     object (a STEP's OpenCascade meshes). */
  function simbotFromCad(cad,opts){
    const o=opts||{};
    if(!cad||!Array.isArray(cad.solids)||!cad.solids.length) bad("empty","there's no robot with parts to package");
    const solids=cad.solids;
    const mechs=(cad.mechs||[]).filter(m=>!m.drive&&m.kind!=="fixed");
    const ids=new Set(mechs.map(m=>m.id));
    // a "fixed" joint (a mate the bench holds where it's drawn) is part of whatever
    // moving joint carries it: its parts ride that one, and joints below hang from it
    const byId=new Map((cad.mechs||[]).map(m=>[m.id,m]));
    const moving=id=>{ let x=id, g=0; while(x&&x!=="chassis"&&g++<64){ if(ids.has(x)) return x; const m=byId.get(x); x=m?m.parent:null; } return "chassis"; };
    const group=solids.map(s=>s.mech?moving(s.mech):"chassis");

    // geometry: one mesh per unique shape, placed at each copy
    const meshes=[], meshAt=new Map(), materials=[], matAt=new Map();
    const matFor=(color,kind)=>{
      const rgb=color&&color.length>=3?color.slice(0,3):(KIND_RGB[kind]||KIND_RGB.metal);
      const k=rgb.map(v=>Math.round(v*255)).join(",")+"|"+(color?"cad":kind);
      if(!matAt.has(k)){ matAt.set(k,materials.length); materials.push({name:color?"rgb("+k.split("|")[0]+")":kind, color:rgb, extras:{kind:kind||"metal", cad:!!color}}); }
      return matAt.get(k);
    };
    let tris=0;
    const meshFor=(key,pos,idx,mat)=>{
      const k=key+"|"+mat;
      if(meshAt.has(k)) return meshAt.get(k);
      const w=idx?{pos:pos instanceof Float32Array?pos:Float32Array.from(pos), idx:idx instanceof Uint32Array?idx:Uint32Array.from(idx)}:weld(pos);
      tris+=w.idx.length/3;
      meshAt.set(k,meshes.length); meshes.push({pos:w.pos, idx:w.idx, material:mat, name:key});
      return meshes.length-1;
    };
    const nodes=[{name:"robot", matrix:ZUP_TO_YUP, children:[], extras:{up:"+z", units:"m"}}];
    const bodyNode=new Map();
    const bodyOf=id=>{ if(!bodyNode.has(id)){ bodyNode.set(id,nodes.length); nodes[0].children.push(nodes.length);
      nodes.push({name:id, children:[], extras:{body:id}}); } return bodyNode.get(id); };
    bodyOf("chassis");
    solids.forEach((s,i)=>{
      const mat=matFor(s.color&&s.keepTri!==false?s.color:null, s.kind||"metal");
      let inst=typeof o.meshFor==="function"?o.meshFor(i,s):null;
      if(!inst&&s.inst&&s.inst.local) inst=[{key:s.inst.key, pos:s.inst.local, M:s.inst.M}];
      if(!inst&&s.tri&&s.tri.pos&&s.tri.pos.length>=9) inst=[{key:"solid:"+i, pos:s.tri.pos, M:I4}];
      if(!inst){ const t=typeof solidTriangles==="function"?solidTriangles(s.pts||[]):null; inst=t?[{key:"hull:"+i, pos:t.pos, M:I4}]:[]; }
      const part={name:s.name||"part", children:[], extras:{solid:i, part:s.part||null, kind:s.kind||"metal"}};
      if(s.kg>0) part.extras.kg=s.kg;
      if(s.osPath) part.extras.path=s.osPath;
      const pi=nodes.length; nodes.push(part); nodes[bodyOf(group[i])].children.push(pi);
      for(const g of inst){
        if(!g||!g.pos||g.pos.length<9) continue;
        const mi=meshFor(String(g.key||("solid:"+i)), g.pos, g.idx||null, g.color?matFor(g.color,s.kind):mat);
        if(inst.length===1){ part.mesh=mi; part.matrix=m4(g.M); }
        else { part.children.push(nodes.length); nodes.push({mesh:mi, matrix:m4(g.M)}); }
      }
    });
    for(const n of nodes) if(n.children&&!n.children.length) delete n.children;

    // the joints, as a spec (src/jointspec.js), plus the constraints a spec v1 couldn't say
    const devMap={};
    for(const [d,j] of Object.entries(o.map||{})) if(j&&ids.has(j)) devMap[d]=j;
    const spec=specFromCad(cad,group,devMap);
    for(const j of spec.joints) if(j.parent&&!ids.has(j.parent)){ const p=moving(j.parent); if(p==="chassis") delete j.parent; else j.parent=p; }
    spec.version=2;
    spec.source=cad.source||"step";
    spec.exact=!!(cad.mates&&(cad.mates.source==="onshape"||cad.mates.exact));
    if(cad.mates&&cad.mates.source==="spec"&&cad.mates.auto||!cad.mates) spec.auto=true;
    for(const j of spec.joints){ const m=mechs.find(x=>x.id===j.id); if(m&&!m.limits&&(m.continuous||(/^revolute/.test(m.kind)&&CONTINUOUS.test(m.id+" "+(m.alias||""))))) j.continuous=true; }
    spec.constraints=[];
    for(const j of spec.joints){
      const f=j.follows; if(!f||f.linkage) continue;
      const c={type:f.via&&f.via!=="ratio"?f.via:"ratio", leader:f.joint, follower:j.id, ratio:f.ratio};
      if(f.offset) c.offset=f.offset;                         // mm or degrees, as the spec writes it
      spec.constraints.push(c);
      delete j.follows;
    }
    const mmv=v=>v.map(x=>+(x*1000).toFixed(3));
    for(const L of cad.loops||[]) spec.constraints.push({type:"loop", name:L.name, a:L.a, b:L.b, point:mmv(L.point), axis:L.axis.map(v=>+v.toFixed(6)), joint:L.type||"REVOLUTE"});
    if(!spec.constraints.length) delete spec.constraints;

    // which device drives which joint, and how its numbers turn into motion
    const bindings={format:SIMBOT_BINDINGS, version:1, devices:Object.keys(devMap).sort().map(d=>{
      const m=mechs.find(x=>x.id===devMap[d]), b={name:d, joint:devMap[d]};
      if(m&&m.part) b.part=m.part;
      for(const k of ["mmPerTick","gear","restPos"]) if(m&&fin(m[k])) b[k]=m[k];
      return b; })};

    // each body's mass, from the CAD's own where it has it
    const bodies={};
    solids.forEach((s,i)=>{
      const pm=typeof partMass==="function"?partMass(s):{kg:s.kg||0, how:"cad"};
      const b=bodies[group[i]]||(bodies[group[i]]={kg:0, com:[0,0,0], parts:0, fromCad:0});
      const c=(s.pts||[]).reduce((a,p)=>[a[0]+p[0],a[1]+p[1],a[2]+p[2]],[0,0,0]).map(v=>v/Math.max(1,(s.pts||[]).length));
      for(let k=0;k<3;k++) b.com[k]+=c[k]*pm.kg;
      b.kg+=pm.kg; b.parts++; if(pm.how==="cad") b.fromCad++;
    });
    let total=0;
    for(const id in bodies){ const b=bodies[id]; total+=b.kg; b.com=b.kg>0?mmv(b.com.map(v=>v/b.kg)):[0,0,0]; b.kg=+b.kg.toFixed(5); }
    const mass={format:"ftc-simbench.mass", version:1, kg:+total.toFixed(5), bodies};

    const validation=validateRobot(cad,{devices:o.devices, map:devMap});
    const manifest={format:SIMBOT_FORMAT, version:SIMBOT_VERSION, name:cad.name||"robot",
      created:typeof o.created==="string"?o.created:null,
      app:{name:"ftc-simbench-pro", version:(o.app&&o.app.version)||null, build:(o.app&&o.app.build)||null},
      source:{kind:cad.source||"step", url:(cad.onshape&&cad.onshape.url)||null},
      joints:{count:spec.joints.length, exact:spec.exact, auto:!!spec.auto, loops:(cad.loops||[]).length},
      parts:solids.length, meshes:meshes.length, triangles:tris, kg:mass.kg,
      validation:{counts:validation.counts, items:validation.items}};
    const glb=glbWrite({meshes, materials, nodes, scene:[0], extras:{format:SIMBOT_FORMAT}});
    return {manifest, joints:spec, bindings, mass, glb};
  }

  async function simbotPack(pkg,opts){
    const js=v=>JSON.stringify(v,null,1);
    return zipWrite([{name:"manifest.json", data:js(pkg.manifest)}, {name:"joints.json", data:js(pkg.joints)},
      {name:"bindings.json", data:js(pkg.bindings)}, {name:"mass.json", data:js(pkg.mass)}, {name:"robot.glb", data:pkg.glb}], opts);
  }
  /* bytes -> {ok:true, pkg} or {ok:false, error, detail}. Never throws. */
  async function simbotUnpack(bytes,caps){
    try{
      const files=await zipRead(bytes,caps);
      const manifest=readJson(files.get("manifest.json"),"manifest.json");
      if(!isObj(manifest)||manifest.format!==SIMBOT_FORMAT) bad("not-simbot","this zip isn't a SimBench robot package (no "+SIMBOT_FORMAT+" manifest)");
      if(!Number.isInteger(manifest.version)||manifest.version<1) bad("bad-version","the package's version is missing or nonsense");
      if(manifest.version>SIMBOT_VERSION) bad("future-version","this package was made by a newer SimBench (format "+manifest.version+"; this one reads "+SIMBOT_VERSION+"). Update the bench.");
      const joints=readJson(files.get("joints.json"),"joints.json");
      if(!isObj(joints)||joints.format!==JOINT_SPEC_FORMAT) bad("bad-joints","joints.json isn't a joint spec");
      if(Array.isArray(joints.joints)&&joints.joints.length>CAPS.joints) bad("too-big","joints.json has "+joints.joints.length+" joints; the limit is "+CAPS.joints);
      if(Array.isArray(joints.constraints)&&joints.constraints.length>CAPS.constraints) bad("too-big","joints.json has too many constraints");
      const bindings=files.has("bindings.json")?readJson(files.get("bindings.json"),"bindings.json"):{format:SIMBOT_BINDINGS, version:1, devices:[]};
      const mass=files.has("mass.json")?readJson(files.get("mass.json"),"mass.json"):null;
      const glb=files.get("robot.glb"); if(!glb) bad("missing","robot.glb is missing from the package");
      const g=glbRead(glb,caps);
      return {ok:true, pkg:{manifest, joints, bindings, mass, glb, gltf:g}};
    }catch(e){
      return {ok:false, error:(e&&e.message)||String(e), detail:(e&&e.simbot)||"internal"};
    }
  }

  /* ---- the package -> the robot the bench runs ----
     {cad, map, devices, why}; throws only on a package simbotUnpack let through
     that still can't be built (it says why). */
  function cadFromSimbot(pkg,opts){
    const g=pkg.gltf||glbRead(pkg.glb), J=g.json, N=Array.isArray(J.nodes)?J.nodes:[];
    const mats=Array.isArray(J.materials)?J.materials:[];
    const scene=(J.scenes&&J.scenes[J.scene||0]&&J.scenes[J.scene||0].nodes)||[];
    const parts=[], seen=new Set();
    const walk=(ni,P,depth,part)=>{
      if(depth>16||!Number.isInteger(ni)||ni<0||ni>=N.length) bad("not-glb","robot.glb's node tree is damaged");
      if(seen.has(ni)) bad("not-glb","robot.glb's node tree loops"); seen.add(ni);
      const n=N[ni]||{};
      const L=Array.isArray(n.matrix)&&n.matrix.length===16?fromCol(n.matrix.map(Number)):trs(n.translation,n.rotation,n.scale);
      if(!L.every(fin)) bad("bad-number","robot.glb has a placement that isn't numbers");
      const W=mul4(P,L);
      const ex=isObj(n.extras)?n.extras:{};
      if(Number.isInteger(ex.solid)){ if(part) bad("not-glb","robot.glb has a part inside a part");
        part={i:ex.solid, name:typeof n.name==="string"?n.name.slice(0,200):"part", ex, inst:[]}; parts.push(part); }
      if(Number.isInteger(n.mesh)){ if(!part) bad("not-glb","robot.glb has a shape that belongs to no part");
        if(n.mesh<0||n.mesh>=g.meshes.length) bad("not-glb","robot.glb points at a mesh it doesn't have");
        part.inst.push({mesh:n.mesh, W}); }
      for(const c of Array.isArray(n.children)?n.children:[]) walk(c,W,depth+1,part);
    };
    for(const r of scene) walk(r,YUP_TO_ZUP,0,null);
    if(!parts.length) bad("empty","robot.glb has no parts");
    // the triangles drawn, every copy counted: a few meshes placed many times can't blow past the cap
    let drawn=0;
    for(const p of parts) for(const it of p.inst){ const m=g.meshes[it.mesh]; drawn+=m.idx?m.idx.length/3:m.pos.length/9;
      if(drawn>CAPS.triangles) bad("too-big","robot.glb places more than "+CAPS.triangles+" triangles"); }
    if(parts.length>CAPS.parts) bad("too-big","robot.glb has "+parts.length+" parts; the limit is "+CAPS.parts);
    parts.sort((a,b)=>a.i-b.i);
    parts.forEach((p,k)=>{ if(p.i!==k) bad("not-glb","robot.glb's parts aren't numbered 0.."+(parts.length-1)); });

    const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity], P=[];
    const solids=parts.map(p=>{
      const pos=[], nor=[], pts=[];
      let col=null;
      for(const it of p.inst){
        const m=g.meshes[it.mesh], W=it.W, V=m.pos, I=m.idx;
        if(col==null&&Number.isInteger(m.material)&&mats[m.material]){ const mt=mats[m.material], f=mt.pbrMetallicRoughness&&mt.pbrMetallicRoughness.baseColorFactor;
          if(isObj(mt.extras)&&mt.extras.cad&&Array.isArray(f)&&f.slice(0,3).every(fin)) col=f.slice(0,3).map(v=>Math.max(0,Math.min(1,v))); }
        const nt=I?I.length/3:V.length/9;
        const at=k=>{ const q=3*k, x=V[q], y=V[q+1], z=V[q+2];
          return [W[0]*x+W[1]*y+W[2]*z+W[3], W[4]*x+W[5]*y+W[6]*z+W[7], W[8]*x+W[9]*y+W[10]*z+W[11]]; };
        for(let t=0;t<nt;t++){
          const a=at(I?I[3*t]:3*t), b=at(I?I[3*t+1]:3*t+1), c=at(I?I[3*t+2]:3*t+2);
          pos.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);
          const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], w=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
          let n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]]; const L=Math.hypot(n[0],n[1],n[2])||1; n=n.map(v=>v/L);
          for(let q=0;q<3;q++) nor.push(n[0],n[1],n[2]);
          if(t%3===0||nt<100) pts.push(a);
        }
      }
      const smn=[Infinity,Infinity,Infinity], smx=[-Infinity,-Infinity,-Infinity];
      for(let k=0;k<pos.length;k+=3) for(let q=0;q<3;q++){ const v=pos[k+q]; if(v<smn[q]) smn[q]=v; if(v>smx[q]) smx[q]=v; }
      for(let q=0;q<3;q++){ if(smn[q]<mn[q]) mn[q]=smn[q]; if(smx[q]>mx[q]) mx[q]=smx[q]; }
      const thin=typeof thinPoints==="function"?thinPoints(pts.length>=4?pts:pts.concat(pts,pts,pts).slice(0,4),120):pts;
      for(const q of thin) P.push(q);
      const ex=p.ex, pn=typeof ex.part==="string"?ex.part.slice(0,64):null;
      const s={name:p.name.replace(/\s*<\d+>\s*$/,""), part:pn, kind:typeof ex.kind==="string"&&Object.prototype.hasOwnProperty.call(KIND_RGB,ex.kind)?ex.kind:(typeof solidKind==="function"?solidKind(p.name,pn):"metal"),
        size:pos.length?Math.hypot(smx[0]-smn[0],smx[1]-smn[1],smx[2]-smn[2]):0, pts:thin, tri:{pos,nor}, keepTri:true, color:col};
      if(fin(ex.kg)&&ex.kg>0) s.kg=ex.kg;
      if(typeof ex.path==="string") s.osPath=ex.path.slice(0,400);
      return s;
    });
    if(!fin(mn[0])){ mn.fill(0); mx.fill(0); }
    const counts=new Map();
    for(const s of solids){ const e=counts.get(s.name)||{name:s.name, part:s.part, n:0, kind:"struct"}; e.n++; counts.set(s.name,e); }
    const partList=[...counts.values()].map(e=>{ const hw=typeof hwFromPart==="function"?hwFromPart(e.part,e.name):null; return Object.assign(e,{kind:hw?hw.kind:"struct"}); });
    const M=pkg.manifest||{};
    const src=M.source&&typeof M.source.kind==="string"&&/^(onshape|urdf|mjcf|step)$/.test(M.source.kind)?M.source.kind:"step";
    const cad={name:typeof M.name==="string"?M.name.slice(0,200):"robot", units:"METRE", points:P, pointCount:P.length, solids, bbox:{min:mn,max:mx}, parts:partList, mechs:[], placements:[], occs:[],
      frame:{up:"+z", upWhy:"the robot package's own frame", origin:[0,0,0], originWhy:"package", floorWhy:"package", wheels:null,
        R:[[1,0,0],[0,1,0],[0,0,1]], M:I4.slice(), shift:null},
      source:src==="step"?"simbot":src, simbot:{manifest:M}};
    // the joints, through the same reader a hand-written spec takes
    // a package only ever picks parts by number: a pattern in a mailed file would be
    // run against its part names (a crafted one can hang the page), so none is
    const pick=sel=>{ if(!isObj(sel)) return null; const o={}; for(const k of ["solid","x","y","z"]) if(Array.isArray(sel[k])) o[k]=sel[k].slice(0,CAPS.parts).filter(v=>typeof v==="number"&&fin(v)); return Object.keys(o).length?o:null; };   // nothing left picks nothing, not everything
    const J0=pkg.joints, joints=Object.assign({},J0,{
      joints:(Array.isArray(J0.joints)?J0.joints:[]).map(j=>isObj(j)?Object.assign({},j,{parts:(Array.isArray(j.parts)?j.parts:[]).map(pick).filter(Boolean)}):j),
      assign:(Array.isArray(J0.assign)?J0.assign:[]).map(a=>isObj(a)?Object.assign({},a,{parts:(Array.isArray(a.parts)?a.parts:[]).map(pick).filter(Boolean)}):a)});
    const R=applyJointSpec(cad,joints);
    cad.mates.origin=src;
    const why=R.report.why.slice();
    // which device drives what
    const map={}, devices={};
    const B=pkg.bindings&&Array.isArray(pkg.bindings.devices)?pkg.bindings.devices.slice(0,CAPS.devices):[];
    const byId=new Map(cad.mechs.map(m=>[m.id,m]));
    for(const b of B){
      if(!isObj(b)||typeof b.name!=="string"||typeof b.joint!=="string"||!byId.has(b.joint)) continue;
      map[b.name]=b.joint; devices[b.name]=b.joint;
      const m=byId.get(b.joint);
      if(typeof b.part==="string"&&!m.part) m.part=b.part.slice(0,64);
    }
    for(const d in R.devices) if(!devices[d]) devices[d]=R.devices[d];
    const v=M.validation&&Array.isArray(M.validation.items)?M.validation.items.filter(i=>isObj(i)&&typeof i.text==="string").slice(0,64):[];
    cad.mates.issues=v.map(i=>({sev:/^(error|warn|note)$/.test(i.sev)?i.sev:"note", code:String(i.code||"note").slice(0,40), text:i.text.slice(0,600), joint:typeof i.joint==="string"?i.joint:null}));
    why.unshift("Robot package \""+cad.name+"\": "+solids.length+" parts, "+cad.mechs.filter(m=>!m.drive).length+" joints"+(cad.mates.exact?" read from "+(src==="urdf"?"its URDF":src==="mjcf"?"its MJCF":"Onshape mates"):cad.mates.auto?" found from the geometry (a draft)":"")+".");
    cad.mates.why=why;
    return {cad, map, devices, why};
  }

  return {simbotFromCad, simbotPack, simbotUnpack, cadFromSimbot, validateRobot, zipWrite, zipRead, glbWrite, glbRead, sbCrc32, SIMBOT_CAPS:CAPS};
})();
