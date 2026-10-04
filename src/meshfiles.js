/* ============================================================
   MESH FILES — a robot export's zip, and the meshes inside it
   ------------------------------------------------------------
   Since March 2026 Onshape exports an assembly straight to URDF: the mates
   become joints, the mass properties become inertials, and every part's
   shape comes along as STL, glTF, GLB or OBJ in one zip. Fusion, SolidWorks
   and FreeCAD exporters write the same kind of zip. Reading it needs no
   server, no sign-in and no API call, so it is the main way a robot gets
   into SimBench (src/urdf.js turns it into the robot).

   Everything here is pure: bytes in, triangles out. The zip reader handles
   the two methods real zips use (stored and deflate; deflate through the
   platform's DecompressionStream). The glTF reader covers what CAD exporters
   write: float positions, indexed or not, node transforms, a base colour per
   material. Draco-compressed meshes are refused with the fix (export again
   with compression off), because decoding them needs a 300 KB WASM module.
   ============================================================ */

/* ---- zip ----
   The central directory at the end of the file lists every entry with its
   method, sizes and local header offset. Resolves to [{name, data:Uint8Array}].
   Directories and entries that can't be read are left out. */
async function zipEntries(buf){
  const u8=buf instanceof Uint8Array?buf:new Uint8Array(buf);
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  // the end-of-central-directory record: signature 0x06054b50, at most 65 KB from the end (the comment)
  let eocd=-1;
  for(let i=u8.length-22;i>=Math.max(0,u8.length-22-65536);i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
  if(eocd<0) throw new Error("not a zip file");
  const n=dv.getUint16(eocd+10,true), cdOff=dv.getUint32(eocd+16,true);
  const out=[], dec=new TextDecoder("utf-8");
  let p=cdOff;
  for(let k=0;k<n&&p+46<=u8.length;k++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const method=dv.getUint16(p+10,true), csize=dv.getUint32(p+20,true), usize=dv.getUint32(p+24,true);
    const nlen=dv.getUint16(p+28,true), xlen=dv.getUint16(p+30,true), clen=dv.getUint16(p+32,true), loc=dv.getUint32(p+42,true);
    const name=dec.decode(u8.subarray(p+46,p+46+nlen)).replace(/\\/g,"/");
    p+=46+nlen+xlen+clen;
    if(name.endsWith("/")||/(^|\/)(__MACOSX|\.DS_Store)/.test(name)) continue;
    if(loc+30>u8.length||dv.getUint32(loc,true)!==0x04034b50) continue;
    const lnlen=dv.getUint16(loc+26,true), lxlen=dv.getUint16(loc+28,true), start=loc+30+lnlen+lxlen;
    const raw=u8.subarray(start,Math.min(u8.length,start+csize));
    let data=null;
    if(method===0) data=raw;
    else if(method===8){
      try{ data=await inflateRaw(raw,usize); }catch(e){ data=null; }
    }
    if(data) out.push({name, data});
  }
  return out;
}
/* raw deflate -> bytes, through the platform (browsers and Node 18+) */
async function inflateRaw(raw,size){
  if(typeof DecompressionStream!=="function") throw new Error("this browser can't unzip");
  const ds=new DecompressionStream("deflate-raw");
  const w=ds.writable.getWriter(); w.write(raw); w.close();
  const chunks=[], rd=ds.readable.getReader(); let total=0;
  for(;;){ const {value,done}=await rd.read(); if(done) break; chunks.push(value); total+=value.length; }
  const out=new Uint8Array(total); let o=0; for(const c of chunks){ out.set(c,o); o+=c.length; }
  return out;
}

/* ---- glTF / GLB ----
   Returns {tri: Float32Array (flat xyz triples, the file's own metres), color:[r,g,b] 0..1 or null,
   colors: per-triangle material colour index into `palette` (Uint16Array) and palette:[[r,g,b],…]}.
   `files` resolves external buffers and is {basename: Uint8Array}. */
function gltfRead(bytes,files){
  const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  let json, bin=null;
  if(u8.length>=12&&dv.getUint32(0,true)===0x46546C67){           // "glTF": the binary container
    const total=Math.min(u8.length,dv.getUint32(8,true));
    let p=12;
    while(p+8<=total){
      const len=dv.getUint32(p,true), type=dv.getUint32(p+4,true), body=u8.subarray(p+8,p+8+len);
      if(type===0x4E4F534A) json=JSON.parse(new TextDecoder().decode(body));
      else if(type===0x004E4942) bin=body;
      p+=8+len;
    }
    if(!json) throw new Error("the GLB has no JSON chunk");
  }else json=JSON.parse(new TextDecoder().decode(u8));
  const used=JSON.stringify(json.extensionsRequired||json.extensionsUsed||[]);
  if(/KHR_draco_mesh_compression/.test(used)) throw new Error("the meshes are Draco-compressed; export again with compression off");
  const buffers=(json.buffers||[]).map((b,i)=>{
    if(b.uri==null) return bin;
    if(/^data:/.test(b.uri)){ const s=b.uri.slice(b.uri.indexOf(",")+1); const bs=atob(s), a=new Uint8Array(bs.length); for(let k=0;k<a.length;k++) a[k]=bs.charCodeAt(k); return a; }
    const f=files&&(files[b.uri]||files[decodeURIComponent(b.uri).replace(/^.*[\\/]/,"")]||files[b.uri.replace(/^.*[\\/]/,"")]);
    return f?(f instanceof Uint8Array?f:new Uint8Array(f)):null;
  });
  const views=json.bufferViews||[], accs=json.accessors||[];
  // component size and a DataView getter (a view into a zip is rarely 4-byte aligned, so no typed-array views)
  const CT={5120:[1,(d,o)=>d.getInt8(o)],5121:[1,(d,o)=>d.getUint8(o)],5122:[2,(d,o)=>d.getInt16(o,true)],5123:[2,(d,o)=>d.getUint16(o,true)],5125:[4,(d,o)=>d.getUint32(o,true)],5126:[4,(d,o)=>d.getFloat32(o,true)]};
  const NC={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
  // an accessor as a plain number array of its components, interleaving and normalisation handled
  const read=ai=>{
    const a=accs[ai]; if(!a||a.bufferView==null) return null;
    const v=views[a.bufferView], buf=buffers[v.buffer]; if(!buf) return null;
    const [sz,get]=CT[a.componentType]||[], nc=NC[a.type]||1; if(!get) return null;
    const stride=v.byteStride||sz*nc, base=(v.byteOffset||0)+(a.byteOffset||0);
    const bd=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
    const out=new Float64Array(a.count*nc);
    const norm=a.normalized?(a.componentType===5120?127:a.componentType===5121?255:a.componentType===5122?32767:65535):0;
    for(let i=0;i<a.count;i++){
      const off=base+i*stride;
      if(off+sz*nc>buf.byteLength) break;
      for(let k=0;k<nc;k++){ const x=get(bd,off+k*sz); out[i*nc+k]=norm?Math.max(-1,x/norm):x; }
    }
    return out;
  };
  const matColor=mi=>{
    const m=json.materials&&json.materials[mi]; if(!m) return null;
    const p=m.pbrMetallicRoughness||{}, c=p.baseColorFactor||(m.extensions&&m.extensions.KHR_materials_pbrSpecularGlossiness&&m.extensions.KHR_materials_pbrSpecularGlossiness.diffuseFactor);
    return Array.isArray(c)?c.slice(0,3).map(x=>Math.max(0,Math.min(1,+x||0))):null;
  };
  // node world matrices (column-major 16) from the scene's roots down
  const nodes=json.nodes||[], mats=new Array(nodes.length).fill(null);
  const mul=(A,B)=>{ const C=new Array(16); for(let i=0;i<4;i++) for(let j=0;j<4;j++){ let s=0; for(let k=0;k<4;k++) s+=A[k*4+i]*B[j*4+k]; C[j*4+i]=s; } return C; };
  const trs=n=>{
    if(n.matrix) return n.matrix.slice();
    const t=n.translation||[0,0,0], q=n.rotation||[0,0,0,1], s=n.scale||[1,1,1];
    const [x,y,z,w]=q, xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
    return [(1-2*(yy+zz))*s[0],(2*(xy+wz))*s[0],(2*(xz-wy))*s[0],0, (2*(xy-wz))*s[1],(1-2*(xx+zz))*s[1],(2*(yz+wx))*s[1],0, (2*(xz+wy))*s[2],(2*(yz-wx))*s[2],(1-2*(xx+yy))*s[2],0, t[0],t[1],t[2],1];
  };
  const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const scene=json.scenes&&json.scenes[json.scene||0];
  const roots=scene&&scene.nodes?scene.nodes:nodes.map((_,i)=>i).filter(i=>!nodes.some(n=>(n.children||[]).includes(i)));
  const walk=(i,P,depth)=>{ if(depth>64||!nodes[i]) return; const M=mul(P,trs(nodes[i])); mats[i]=M; for(const c of nodes[i].children||[]) walk(c,M,depth+1); };
  for(const r of roots) walk(r,I,0);
  // triangles, placed; one colour index per triangle
  const tris=[], tc=[], palette=[], palKey=new Map();
  const colIdx=c=>{ const k=c?c.map(v=>Math.round(v*255)).join(","):""; if(palKey.has(k)) return palKey.get(k); palette.push(c); palKey.set(k,palette.length-1); return palette.length-1; };
  const area=new Map();
  nodes.forEach((n,ni)=>{
    if(n.mesh==null||!mats[ni]) return;
    const M=mats[ni], mesh=json.meshes[n.mesh]; if(!mesh) return;
    for(const pr of mesh.primitives||[]){
      if(pr.mode!=null&&pr.mode!==4) continue;                  // triangles only
      const pos=read(pr.attributes&&pr.attributes.POSITION); if(!pos) continue;
      const idx=pr.indices!=null?read(pr.indices):null, nv=pos.length/3;
      const ci=colIdx(matColor(pr.material));
      const put=k=>{ const x=pos[3*k],y=pos[3*k+1],z=pos[3*k+2];
        tris.push(M[0]*x+M[4]*y+M[8]*z+M[12], M[1]*x+M[5]*y+M[9]*z+M[13], M[2]*x+M[6]*y+M[10]*z+M[14]); };
      const count=idx?idx.length:nv;
      for(let t=0;t+2<count;t+=3){
        const a=idx?idx[t]:t, b=idx?idx[t+1]:t+1, c=idx?idx[t+2]:t+2;
        if(a>=nv||b>=nv||c>=nv) continue;
        const at=tris.length; put(a); put(b); put(c); tc.push(ci);
        const ux=tris[at+3]-tris[at],uy=tris[at+4]-tris[at+1],uz=tris[at+5]-tris[at+2],wx=tris[at+6]-tris[at],wy=tris[at+7]-tris[at+1],wz=tris[at+8]-tris[at+2];
        area.set(ci,(area.get(ci)||0)+Math.hypot(uy*wz-uz*wy,uz*wx-ux*wz,ux*wy-uy*wx));
      }
    }
  });
  let best=null, bestA=-1; for(const [ci,a] of area) if(palette[ci]&&a>bestA){ bestA=a; best=palette[ci]; }
  return {tri:Float32Array.from(tris), color:best, colors:Uint16Array.from(tc), palette};
}

/* ---- OBJ (with its MTL's Kd for colour) ---- */
function objRead(text,mtlText){
  const kd={}; let cur=null;
  if(mtlText) for(const line of String(mtlText).split(/\r?\n/)){
    const m=/^\s*newmtl\s+(\S+)/.exec(line); if(m){ cur=m[1]; continue; }
    const k=/^\s*Kd\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/.exec(line); if(k&&cur) kd[cur]=[+k[1],+k[2],+k[3]];
  }
  const V=[], tris=[], tc=[], palette=[], palKey=new Map(), area=new Map();
  const colIdx=c=>{ const k=c?c.join(","):""; if(palKey.has(k)) return palKey.get(k); palette.push(c); palKey.set(k,palette.length-1); return palette.length-1; };
  let ci=colIdx(null);
  for(const line of String(text).split(/\r?\n/)){
    if(line.charCodeAt(0)===118&&line.charCodeAt(1)===32){        // "v "
      const p=line.slice(2).trim().split(/\s+/); if(p.length>=3) V.push(+p[0],+p[1],+p[2]);
    }else if(line.startsWith("usemtl")){ const n=line.slice(6).trim(); ci=colIdx(kd[n]||null); }
    else if(line.charCodeAt(0)===102&&line.charCodeAt(1)===32){    // "f "
      const idx=line.slice(2).trim().split(/\s+/).map(s=>{ const i=parseInt(s.split("/")[0],10); return i<0?V.length/3+i:i-1; }).filter(i=>i>=0&&i*3+2<V.length);
      for(let k=1;k+1<idx.length;k++){ const at=tris.length;
        for(const i of [idx[0],idx[k],idx[k+1]]) tris.push(V[3*i],V[3*i+1],V[3*i+2]);
        tc.push(ci);
        const ux=tris[at+3]-tris[at],uy=tris[at+4]-tris[at+1],uz=tris[at+5]-tris[at+2],wx=tris[at+6]-tris[at],wy=tris[at+7]-tris[at+1],wz=tris[at+8]-tris[at+2];
        area.set(ci,(area.get(ci)||0)+Math.hypot(uy*wz-uz*wy,uz*wx-ux*wz,ux*wy-uy*wx)); }
    }
  }
  let best=null, bestA=-1; for(const [c,a] of area) if(palette[c]&&a>bestA){ bestA=a; best=palette[c]; }
  return {tri:Float32Array.from(tris), color:best, colors:Uint16Array.from(tc), palette};
}

/* ---- any mesh file by name: STL (src/urdf.js urdfStl), glTF/GLB, OBJ ----
   files: {basename: Uint8Array|ArrayBuffer}; name is the mesh's file name. */
function meshRead(name,data,files){
  const ext=String(name||"").toLowerCase().replace(/^.*\./,"");
  if(ext==="stl") return {tri:Float32Array.from(urdfStl(data)), color:null};
  if(ext==="glb"||ext==="gltf") return gltfRead(data,files);
  if(ext==="obj"){
    const txt=new TextDecoder().decode(data instanceof Uint8Array?data:new Uint8Array(data));
    const mt=/^\s*mtllib\s+(\S+)/m.exec(txt), mtl=mt&&files&&(files[mt[1]]||files[mt[1].replace(/^.*[\\/]/,"")]);
    return objRead(txt,mtl?new TextDecoder().decode(mtl instanceof Uint8Array?mtl:new Uint8Array(mtl)):null);
  }
  if(ext==="dae") throw new Error("Collada (.dae) meshes aren't read; export the meshes as GLB or STL");
  throw new Error("unknown mesh format ."+ext);
}
const MESH_EXT=/\.(stl|glb|gltf|obj|bin|mtl)$/i;
