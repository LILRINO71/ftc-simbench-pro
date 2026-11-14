/* ============================================================
   7e.  ROBOT LITE — a light copy of a robot's surfaces

   Vertex clustering: every vertex snaps to a cube of a grid, each cube
   keeps one vertex (the average of what fell in it), and the triangles
   that collapse go. Done once per distinct shape in its own frame, then
   placed wherever the robot has a copy of it, so a 773-part robot with 99
   shapes costs 99 clusterings. Only the shapes too heavy for their share
   of the triangle budget are clustered at all (liteBuild).

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
   into its segment's, or null. opts: {budget: triangles}.
   Returns {segs:[{id, v, t, tc}], pal, cell, tris, rate, left, boxed}.

   Every shape is allowed triangles in proportion to its size (so many a metre of its
   box's diagonal): the highest rate that fits the whole robot in the budget. A shape
   under its allowance is kept as it is; only a shape over it is clustered, on a grid
   of its own, just coarse enough to come under. One grid for the whole robot (as this
   was) spent the budget on screws and gears and took it out of the plates: a flat side
   panel, twelve triangles, came back dented. A shape that would need a grid coarser
   than a fifth of itself has nothing left to cluster (a screw, a bearing): it is drawn
   as its box. When the rate would fall under LITE_MIN_RATE the smallest parts are left
   out first (screws, nuts, washers: nobody sees them at this size) and the rest share
   what they would have had. */
const LITE_MIN_RATE=1500, LITE_LEAVE_OUT=[0.010,0.016,0.025,0.040];   // triangles per metre of a part; part sizes (m) left out, smallest first
function liteBuild(input,opts){
  opts=opts||{};
  const budget=opts.budget||60000, S=input.shapes, n=S.length;
  const full=new Float64Array(n), size=new Float64Array(n), box=[];
  for(let k=0;k<n;k++){
    const P=S[k].pos; full[k]=(S[k].idx?S[k].idx.length:P.length/3)/3;
    let ax=Infinity,ay=Infinity,az=Infinity,bx=-Infinity,by=-Infinity,bz=-Infinity;
    for(let i=0;i<P.length;i+=3){ const x=P[i],y=P[i+1],z=P[i+2]; if(x<ax) ax=x; if(x>bx) bx=x; if(y<ay) ay=y; if(y>by) by=y; if(z<az) az=z; if(z>bz) bz=z; }
    size[k]=P.length?Math.hypot(bx-ax,by-ay,bz-az):0; box.push([ax,ay,az,bx,by,bz]);
  }
  // what a shape is allowed at a rate: never less than a box, never more than it has
  const share=(k,rate)=>Math.min(full[k],Math.max(12,Math.floor(rate*size[k])));
  // the highest rate with sum(copies x share) inside the budget, over the parts at least `least` big
  const rateFor=least=>{
    const copies=new Float64Array(n); for(const p of input.parts) if(size[p.shape]>=least) copies[p.shape]++;
    const cost=r=>{ let t=0; for(let k=0;k<n;k++) if(copies[k]) t+=copies[k]*share(k,r); return t; };
    let hi=1; for(let k=0;k<n;k++) if(copies[k]&&size[k]>0) hi=Math.max(hi,full[k]/size[k]+1);
    if(cost(hi)<=budget) return hi;
    let lo=0; for(let i=0;i<40&&hi-lo>1;i++){ const mid=(lo+hi)/2; if(cost(mid)<=budget) lo=mid; else hi=mid; }
    return lo;
  };
  let least=0, rate=rateFor(0);
  for(const cut of LITE_LEAVE_OUT){ if(rate>=LITE_MIN_RATE) break; least=cut; rate=rateFor(cut); }
  const used=new Uint8Array(n); let left=0, boxed=0;
  const parts=input.parts.filter(p=>{ if(size[p.shape]>=least){ used[p.shape]=1; return true; } left++; return false; });
  let worst=0;
  const red=S.map((s,k)=>{
    if(!used[k]) return null;
    const tc=s.tc==null?0:s.tc, cap=share(k,rate);
    // under its allowance: as it is, its coincident vertices welded (a twentieth of a millimetre)
    if(full[k]<=cap) return liteCluster(s.pos,s.idx||null,tc,0.00005);
    // over it: a grid of cell c leaves about 2A/c^2 triangles on a surface of area A
    let A=0; const P=s.pos, I=s.idx||null, nt=full[k], limit=size[k]/5;
    for(let f=0;f<nt;f++){ const a=3*(I?I[3*f]:3*f), b=3*(I?I[3*f+1]:3*f+1), c=3*(I?I[3*f+2]:3*f+2);
      const ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2],wx=P[c]-P[a],wy=P[c+1]-P[a+1],wz=P[c+2]-P[a+2];
      A+=0.5*Math.hypot(uy*wz-uz*wy,uz*wx-ux*wz,ux*wy-uy*wx); }
    // coarser until it is under, then back between the last grid that was over and the first
    // that was under, so the shape keeps most of what it is allowed (a grid twice too coarse
    // leaves a quarter of the triangles)
    let cell=Math.min(limit,Math.max(0.0002,Math.sqrt(2*A/cap)*0.7)), over=0, r=null, fits=false;
    for(let tries=0;tries<14;tries++){
      r=liteCluster(P,I,tc,cell);
      if(r.t.length/3<=cap){ fits=true; break; }
      if(cell>=limit) break;
      over=cell; cell=Math.min(limit,cell*Math.max(1.12,Math.min(2.5,Math.sqrt(r.t.length/3/cap)*1.05)));
    }
    if(!fits||r.t.length<3){ boxed++; return liteBox(box[k],tc); }
    for(let i=0;i<5&&over>0&&r.t.length/3<cap*0.8;i++){
      const mid=Math.sqrt(over*cell), m=liteCluster(P,I,tc,mid);
      if(m.t.length/3<=cap){ r=m; cell=mid; } else over=mid;
    }
    if(cell>worst) worst=cell;
    return r;
  });
  const L=liteAssemble({parts, pal:input.pal},red,worst);
  L.rate=rate; L.left=left; L.boxed=boxed;
  return L;
}
/* A shape as its box [x0,y0,z0,x1,y1,z1], in the colour most of it has. */
function liteBox(b,tc){
  let c=0;
  if(typeof tc==="number") c=tc;
  else if(tc&&tc.length){ const n=new Map(); let best=-1; for(let i=0;i<tc.length;i++){ const k=(n.get(tc[i])||0)+1; n.set(tc[i],k); if(k>best){ best=k; c=tc[i]; } } }
  const v=new Float32Array(24);
  for(let i=0;i<8;i++){ v[3*i]=i&1?b[3]:b[0]; v[3*i+1]=i&2?b[4]:b[1]; v[3*i+2]=i&4?b[5]:b[2]; }
  return {v, t:Uint32Array.from([0,2,3,0,3,1, 4,5,7,4,7,6, 0,1,5,0,5,4, 2,6,7,2,7,3, 0,4,6,0,6,2, 1,3,7,1,7,5]), tc:new Uint8Array(12).fill(c)};
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
