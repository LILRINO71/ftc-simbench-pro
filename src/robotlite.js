/* ============================================================
   7e.  ROBOT LITE — a light copy of a robot's surfaces

   Vertex clustering: every vertex snaps to a cube of a grid, each cube
   keeps one vertex (the average of what fell in it), and the triangles
   that collapse go. Done once per distinct shape in its own frame, then
   placed wherever the robot has a copy of it, so a 773-part robot with 99
   shapes costs 99 clusterings. The cube grows until the whole robot fits
   the triangle budget.

   The robot stays in segments: the chassis, and one per mechanism, each
   in its own frame. A light copy therefore still moves like the real one
   when it's handed each segment's place.

   Used for:
     - other teams' robots in an online match (src/net.js sends it)
     - the team's own robot's shadow
     - the team's own robot in the driver's view, where it's small on screen

   liteEncode/liteDecode pack it into one ArrayBuffer. Decoding never
   trusts the bytes: every count, index and colour is checked.
   ============================================================ */
const LITE_FORMAT=1;
const LITE_UNIT=0.0005;                       // positions on the wire: half-millimetres, int16 (±16 m)
const LITE_MAX={segs:96, verts:400000, tris:400000, pal:256, header:65536};

/* One shape, clustered at `cell` (metres). pos: xyz Float32Array; idx: triangle
   indices or null (consecutive triples); tc: palette index per triangle (or one
   number for the whole shape). Returns {v, t, tc}. */
function liteCluster(pos,idx,tc,cell){
  const n=pos.length/3, inv=1/cell, vid=new Int32Array(n), map=new Map();
  const sum=[];
  for(let i=0;i<n;i++){
    const kx=Math.floor(pos[3*i]*inv), ky=Math.floor(pos[3*i+1]*inv), kz=Math.floor(pos[3*i+2]*inv);
    const key=((kx+32768)*65536+(ky+32768))*65536+(kz+32768);
    let c=map.get(key);
    if(c===undefined){ c=sum.length/4; map.set(key,c); sum.push(0,0,0,0); }
    sum[4*c]+=pos[3*i]; sum[4*c+1]+=pos[3*i+1]; sum[4*c+2]+=pos[3*i+2]; sum[4*c+3]++;
    vid[i]=c;
  }
  const nc=sum.length/4, v=new Float32Array(nc*3);
  for(let c=0;c<nc;c++){ const k=sum[4*c+3]; v[3*c]=sum[4*c]/k; v[3*c+1]=sum[4*c+1]/k; v[3*c+2]=sum[4*c+2]/k; }
  const nt=idx?idx.length/3:n/3, t=[], col=[];
  for(let f=0;f<nt;f++){
    const a=vid[idx?idx[3*f]:3*f], b=vid[idx?idx[3*f+1]:3*f+1], c=vid[idx?idx[3*f+2]:3*f+2];
    if(a===b||b===c||a===c) continue;
    t.push(a,b,c); col.push(typeof tc==="number"?tc:(tc?tc[f]:0));
  }
  // drop the cluster vertices no triangle kept
  const used=new Int32Array(nc).fill(-1); let nv=0;
  for(const k of t) if(used[k]<0) used[k]=nv++;
  const vv=new Float32Array(nv*3);
  for(let c=0;c<nc;c++) if(used[c]>=0){ const o=used[c]; vv[3*o]=v[3*c]; vv[3*o+1]=v[3*c+1]; vv[3*o+2]=v[3*c+2]; }
  return {v:vv, t:Uint32Array.from(t,k=>used[k]), tc:Uint8Array.from(col)};
}

/* The light robot. input: {shapes:[{pos, idx, tc}], parts:[{seg, shape, m}], pal:[[r,g,b]...]}
   where m is a 4x4 column-major matrix (three.js `elements`) from the shape's frame
   into its segment's, or null. opts: {budget: triangles, cell: first cube size (m)}.
   Returns {segs:[{id, v, t, tc}], pal, cell, tris}. */
function liteBuild(input,opts){
  opts=opts||{};
  const budget=opts.budget||60000;
  let cell=opts.cell||0.004;
  for(let tries=0;;tries++){
    const red=input.shapes.map(s=>liteCluster(s.pos,s.idx||null,s.tc==null?0:s.tc,cell));
    let tris=0; for(const p of input.parts) tris+=red[p.shape].t.length/3;
    if(tris<=budget||tries>=10) return liteAssemble(input,red,cell);
    cell*=Math.max(1.15,Math.sqrt(tris/budget)*1.05);
  }
}
function liteAssemble(input,red,cell){
  const bySeg=new Map();
  for(const p of input.parts){ if(!bySeg.has(p.seg)) bySeg.set(p.seg,[]); bySeg.get(p.seg).push(p); }
  const segs=[]; let tris=0;
  for(const [id,parts] of bySeg){
    let nv=0, nt=0; for(const p of parts){ nv+=red[p.shape].v.length/3; nt+=red[p.shape].t.length/3; }
    if(!nt) continue;
    const v=new Float32Array(nv*3), t=new Uint32Array(nt*3), tc=new Uint8Array(nt);
    let vo=0, to=0;
    for(const p of parts){
      const r=red[p.shape], m=p.m, k=r.v.length/3;
      for(let i=0;i<k;i++){
        const x=r.v[3*i], y=r.v[3*i+1], z=r.v[3*i+2], o=3*(vo+i);
        if(m){ v[o]=m[0]*x+m[4]*y+m[8]*z+m[12]; v[o+1]=m[1]*x+m[5]*y+m[9]*z+m[13]; v[o+2]=m[2]*x+m[6]*y+m[10]*z+m[14]; }
        else{ v[o]=x; v[o+1]=y; v[o+2]=z; }
      }
      for(let f=0;f<r.t.length;f++) t[3*to+f]=r.t[f]+vo;
      tc.set(r.tc,to);
      vo+=k; to+=r.t.length/3;
    }
    segs.push({id, v, t, tc}); tris+=nt;
  }
  return {segs, pal:input.pal||[[180,184,190]], cell, tris};
}

/* Packed: u32 header length, the header (JSON), then per segment its int16
   positions, its indices (u16 when they fit, else u32) and a palette byte per
   triangle, each padded to 4 bytes. */
function liteEncode(model){
  const pad=n=>(n+3)&~3;
  const segs=model.segs.map(s=>({id:String(s.id).slice(0,64), nv:s.v.length/3, nt:s.t.length/3, i32:s.v.length/3>65535}));
  const head=new TextEncoder().encode(JSON.stringify({f:LITE_FORMAT, unit:LITE_UNIT, pal:model.pal, segs}));
  let size=4+pad(head.length);
  for(const s of segs) size+=pad(s.nv*6)+pad(s.nt*3*(s.i32?4:2))+pad(s.nt);
  const buf=new ArrayBuffer(size), dv=new DataView(buf), u8=new Uint8Array(buf);
  dv.setUint32(0,head.length,true); u8.set(head,4);
  let o=4+pad(head.length);
  model.segs.forEach((s,k)=>{
    const S=segs[k], P=new Int16Array(buf,o,S.nv*3);
    for(let i=0;i<P.length;i++) P[i]=Math.max(-32767,Math.min(32767,Math.round(s.v[i]/LITE_UNIT)));
    o+=pad(S.nv*6);
    const I=S.i32?new Uint32Array(buf,o,S.nt*3):new Uint16Array(buf,o,S.nt*3); I.set(s.t);
    o+=pad(S.nt*3*(S.i32?4:2));
    new Uint8Array(buf,o,S.nt).set(s.tc);
    o+=pad(S.nt);
  });
  return buf;
}
/* Back to {segs:[{id, v (Float32, metres), t, tc}], pal}, or null for anything malformed. */
function liteDecode(buf){
  try{
    if(!(buf instanceof ArrayBuffer)||buf.byteLength<8) return null;
    const pad=n=>(n+3)&~3, dv=new DataView(buf), hl=dv.getUint32(0,true);
    if(hl<2||hl>LITE_MAX.header||4+hl>buf.byteLength) return null;
    const H=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,4,hl)));
    if(!H||H.f!==LITE_FORMAT||!Array.isArray(H.segs)||!Array.isArray(H.pal)) return null;
    if(H.segs.length>LITE_MAX.segs||H.pal.length<1||H.pal.length>LITE_MAX.pal) return null;
    const unit=typeof H.unit==="number"&&H.unit>0&&H.unit<0.01?H.unit:LITE_UNIT;
    const pal=H.pal.map(c=>Array.isArray(c)?[0,1,2].map(i=>Math.max(0,Math.min(255,Number(c[i])|0))):[180,184,190]);
    let o=4+pad(hl), V=0, T=0;
    const segs=[];
    for(const S of H.segs){
      const nv=S&&S.nv, nt=S&&S.nt, i32=!!(S&&S.i32);
      if(!Number.isInteger(nv)||!Number.isInteger(nt)||nv<0||nt<0) return null;
      V+=nv; T+=nt; if(V>LITE_MAX.verts||T>LITE_MAX.tris) return null;
      const need=pad(nv*6)+pad(nt*3*(i32?4:2))+pad(nt);
      if(o+need>buf.byteLength) return null;
      const P=new Int16Array(buf.slice(o,o+nv*6)); o+=pad(nv*6);
      const ib=buf.slice(o,o+nt*3*(i32?4:2)), I=i32?new Uint32Array(ib):new Uint16Array(ib); o+=pad(nt*3*(i32?4:2));
      const C=new Uint8Array(buf.slice(o,o+nt)); o+=pad(nt);
      for(let i=0;i<I.length;i++) if(I[i]>=nv) return null;
      for(let i=0;i<C.length;i++) if(C[i]>=pal.length) C[i]=0;
      const v=new Float32Array(P.length); for(let i=0;i<P.length;i++) v[i]=P[i]*unit;
      segs.push({id:typeof S.id==="string"?S.id.slice(0,64):"chassis", v, t:Uint32Array.from(I), tc:C});
    }
    return {segs, pal};
  }catch(e){ return null; }
}
