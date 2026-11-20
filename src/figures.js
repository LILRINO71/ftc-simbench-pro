/* ============================================================
   FIGURES — the AI robots and the HUMAN PLAYERS, built in code
   ------------------------------------------------------------
   A match's stand-in robots read as the FTC robots they stand for: an
   18-inch goBILDA-style chassis of aluminium U-channel (the hole pattern is
   a texture, not meshes), four mecanum wheels whose angled rollers show them
   turn (strafing too), a compliant-wheel intake at the front, a ramp up to
   the hopper, a hooded flywheel at the back with a kicker under it, a
   Control Hub and a battery, and the alliance's colour on the number signs
   and the hood. The still parts are merged into one geometry per material
   and shared by every copy: ten draw calls a robot, eight on tier 0.

   The HUMAN PLAYERS are people with joints (hips, spine, neck, shoulders,
   elbows, hips and knees), posed every frame by humanPose: breathing and a
   slow shift of weight at rest, the head turned to their alliance's robots,
   and an underhand lob of each NECTAR from the tray beside them: reach,
   pick up, wind up, let go at the moment the match does, follow through.
   humanPose, throwBallPhase and mecanumTurns are plain functions, tested in
   Node; nothing here touches THREE until a figure is built.
   ============================================================ */

function figClamp(x,a,b){ return x<a?a:x>b?b:x; }

/* A keyframed value at k: keys [[k, v], ...] in order, cubic between them.
   Tangents are Catmull-Rom, except at a key that is a turning point (both
   neighbours on one side of it), where the motion comes to rest: the arm
   stops at the top of its wind-up instead of overshooting it. */
function figTrack(keys,k){
  const n=keys.length;
  if(k<=keys[0][0]) return keys[0][1];
  if(k>=keys[n-1][0]) return keys[n-1][1];
  let i=0; while(i<n-2&&k>keys[i+1][0]) i++;
  const tan=j=>{
    if(j<=0||j>=n-1) return 0;
    const a=keys[j-1][1], b=keys[j][1], c=keys[j+1][1];
    if((b-a)*(c-b)<=0) return 0;
    return (c-a)/(keys[j+1][0]-keys[j-1][0]);
  };
  const t0=keys[i][0], t1=keys[i+1][0], h=t1-t0, u=(k-t0)/h, u2=u*u, u3=u2*u;
  return (2*u3-3*u2+1)*keys[i][1]+(u3-2*u2+u)*tan(i)*h+(-2*u3+3*u2)*keys[i+1][1]+(u3-u2)*tan(i+1)*h;
}

/* When, in a HUMAN PLAYER's entry (k from 0 to 1 over Match's anim.dur), the
   NECTAR leaves the tray and leaves the hand. The release is the match's own:
   src/view3d.js drew the ball flying from k = 0.55. */
const FIG_GRAB=0.2, FIG_RELEASE=0.55;
/* The standing pose, radians and metres. yaw: the chest turned left (+) or right;
   lean: the spine pitched back (+) or forward; sh?z: an arm swung forward (+);
   sh?x: an arm out to the side (right -, left +); el?: an elbow bent; knee: both
   knees bent; sx/sz: the hips over the front foot (+x) or to the right (+z);
   nod: the head up (+) or down; glance: the eyes' extra turn left (+) or right. */
const FIG_IDLE={yaw:0, lean:0, shRz:0.06, shRx:-0.1, elR:0.2, shLz:0.04, shLx:0.1, elL:0.22, knee:0.05, sx:0, sz:0, nod:0, glance:0};
/* The lob, right-handed, from the tray at the right hip: what differs from FIG_IDLE at each k. */
const FIG_THROW=[
  [0,    {}],
  [0.11, {yaw:-0.24, lean:-0.2,  shRz:0.2,   shRx:-0.42, elR:0.35, knee:0.24, nod:-0.32, glance:-0.45, shLz:0.1, sz:0.012}],
  [0.2,  {yaw:-0.36, lean:-0.32, shRz:0.24,  shRx:-0.5,  elR:0.3,  knee:0.36, nod:-0.42, glance:-0.55, shLz:0.12, sz:0.02}],
  [0.33, {yaw:-0.3,  lean:-0.12, shRz:-0.4,  shRx:-0.25, elR:0.26, knee:0.22, nod:-0.08, shLz:0.3, elL:0.45, sx:-0.015}],
  [0.47, {yaw:-0.28, lean:-0.14, shRz:-0.95, shRx:-0.2,  elR:0.12, knee:0.3,  nod:-0.04, shLz:0.45, shLx:0.2, elL:0.55, sx:-0.03}],
  [FIG_RELEASE, {yaw:0, lean:-0.08, shRz:0.95, shRx:-0.12, elR:0.1, knee:0.16, nod:0.05, shLz:-0.1, elL:0.4, sx:0.02}],
  [0.7,  {yaw:0.14,  lean:0.02,  shRz:1.75,  shRx:-0.1,  elR:0.3,  knee:0.06, nod:0.08, shLz:-0.25, elL:0.3, sx:0.035}],
  [0.86, {yaw:0.06,  lean:0,     shRz:0.7,   shRx:-0.12, elR:0.35, knee:0.08, nod:0.02, shLz:-0.05, elL:0.25, sx:0.015}],
  [1,    {}],
];
const FIG_TRACKS={};
for(const c in FIG_IDLE) FIG_TRACKS[c]=FIG_THROW.map(([k,v])=>[k, v[c]!=null?v[c]:FIG_IDLE[c]]);

/* A HUMAN PLAYER's pose at time t (s): k the entry's progress (null when not
   entering one), look the turn (rad, left +) from facing the field to what
   they watch, seed a per-person phase so two players don't breathe as one.
   Adds breath (the chest's swell), roll (the hips tipped toward the leg that
   takes the weight), head (the neck's turn, after the chest's) and drop (how
   far the hips sink over bent knees, the feet staying put). */
function humanPose(t,k,look,seed){
  const s=seed||0, on=k!=null&&isFinite(k), kk=on?figClamp(k,0,1):0, P={};
  for(const c in FIG_IDLE) P[c]=on?figTrack(FIG_TRACKS[c],kk):FIG_IDLE[c];
  // breathing and weight shift: always, smaller mid-throw
  const calm=on?0.35:1, TAU=2*Math.PI;
  const br=Math.sin(t*TAU/3.8+s), sway=0.6*Math.sin(t*TAU/7.3+s*1.7)+0.4*Math.sin(t*TAU/12.1+s*0.6);
  P.breath=0.012*br;
  P.sz+=0.016*sway*calm;
  P.roll=-0.035*sway*calm;
  P.shRz+=0.025*br*calm; P.shLz+=0.025*br*calm;
  P.nod+=0.025*Math.sin(t*TAU/5.1+s*2.3)*calm;
  // the head turns to what they watch; past what a neck turns, the chest turns with it
  const L=figClamp(look||0,-2.2,2.2);
  if(!on) P.yaw+=figClamp(L*0.3,-0.5,0.5);
  P.head=figClamp(L-P.yaw+P.glance,-1.2,1.2);
  P.drop=0.85*(1-Math.cos(P.knee/2));
  return P;
}
/* Where the NECTAR being entered is at k: on the tray, in the hand, or in the air with u its share of the flight. */
function throwBallPhase(k){
  if(k==null||!isFinite(k)||k<FIG_GRAB) return {at:"tray", u:0};
  if(k<FIG_RELEASE) return {at:"hand", u:0};
  return {at:"air", u:figClamp((k-FIG_RELEASE)/(1-FIG_RELEASE),0,1)};
}
/* How far each mecanum wheel turns (rad, rolling forward +) when the robot goes
   fwd metres ahead, left metres to its left and turns dh radians CCW: the
   standard X-roller inverse kinematics. hx, hy: wheel half-spacing; r: wheel
   radius. Order: front-left, front-right, back-left, back-right. */
function mecanumTurns(fwd,left,dh,hx,hy,r){
  const a=(hx+hy)*dh, R=r||0.048;
  return [(fwd-left-a)/R, (fwd+left+a)/R, (fwd+left-a)/R, (fwd-left+a)/R];
}

/* Who stands where: the two HUMAN PLAYERS look like different people. */
const FIG_PEOPLE={
  red: {skin:0xb27a58, shirt:0xc8372f, pants:0x283140, shoe:0x26272b, sole:0xe9e9e6, hair:0x24170f, cap:0x1a2130, lanyard:0x1d4fa3, seed:0.7},
  blue:{skin:0xe0b394, shirt:0x2a6cd4, pants:0x41464f, shoe:0xeeeeea, sole:0x3b3d42, hair:0x6a4529, cap:null,     lanyard:0x15171a, seed:2.9},
};

const Figures={
  /* everything every copy shares, made once per View: geometry by size and tier, materials */
  kit(V){ return V._fig||(V._fig={geo:{}, mat:null, tex:null}); },
  tierOf(V){ const b=V.tier&&V.tier.budget; return b&&b.tier!=null?b.tier:1; },

  /* ---------- geometry helpers ---------- */
  put(list,geo,col,p,r,s,order){
    const m=new THREE.Matrix4(), q=new THREE.Quaternion().setFromEuler(new THREE.Euler(r?r[0]:0,r?r[1]:0,r?r[2]:0,order||"XYZ"));
    m.compose(new THREE.Vector3(p?p[0]:0,p?p[1]:0,p?p[2]:0),q,new THREE.Vector3(s?s[0]:1,s?s[1]:1,s?s[2]:1));
    geo.applyMatrix4(m); list.push({g:geo, c:col}); return geo;
  },
  /* Many geometries as one: positions, normals, uvs and a colour per vertex
     (col a hex, or a function of the vertex's position giving one). */
  merge(list){
    let nv=0, ni=0;
    for(const p of list){ const n=p.g.attributes.position.count; nv+=n; ni+=p.g.index?p.g.index.count:n; }
    const pos=new Float32Array(nv*3), nor=new Float32Array(nv*3), col=new Float32Array(nv*3), uv=new Float32Array(nv*2);
    const idx=nv>65535?new Uint32Array(ni):new Uint16Array(ni), c=new THREE.Color();
    let ov=0, oi=0;
    for(const p of list){
      const g=p.g, P=g.attributes.position, N=g.attributes.normal, T=g.attributes.uv, n=P.count;
      for(let i=0;i<n;i++){
        const x=P.getX(i), y=P.getY(i), z=P.getZ(i), o=(ov+i)*3;
        pos[o]=x; pos[o+1]=y; pos[o+2]=z;
        if(N){ nor[o]=N.getX(i); nor[o+1]=N.getY(i); nor[o+2]=N.getZ(i); }
        if(T){ uv[(ov+i)*2]=T.getX(i); uv[(ov+i)*2+1]=T.getY(i); }
        c.setHex(typeof p.c==="function"?p.c(x,y,z):p.c==null?0xffffff:p.c);
        col[o]=c.r; col[o+1]=c.g; col[o+2]=c.b;
      }
      if(g.index){ const I=g.index.array; for(let j=0;j<I.length;j++) idx[oi++]=I[j]+ov; }
      else for(let j=0;j<n;j++) idx[oi++]=ov+j;
      ov+=n; g.dispose();
    }
    const out=new THREE.BufferGeometry();
    out.setAttribute("position",new THREE.BufferAttribute(pos,3));
    out.setAttribute("normal",new THREE.BufferAttribute(nor,3));
    out.setAttribute("uv",new THREE.BufferAttribute(uv,2));
    out.setAttribute("color",new THREE.BufferAttribute(col,3));
    out.setIndex(new THREE.BufferAttribute(idx,1));
    out.computeBoundingSphere(); out.userData.shared=true;
    return out;
  },
  /* uvs in hole-pattern cells (tu along a face's longer side, tv across it), so the
     goBILDA pattern sits on every face of a channel at its real size */
  tileUV(geo,tu,tv,edge){
    geo.computeBoundingBox();
    const b=geo.boundingBox, P=geo.attributes.position, N=geo.attributes.normal, U=geo.attributes.uv;
    const ext=[b.max.x-b.min.x, b.max.y-b.min.y, b.max.z-b.min.z];
    for(let i=0;i<P.count;i++){
      const n=[Math.abs(N.getX(i)),Math.abs(N.getY(i)),Math.abs(N.getZ(i))];
      const ax=n[0]>=n[1]&&n[0]>=n[2]?0:n[1]>=n[2]?1:2, o=[0,1,2].filter(a=>a!==ax);
      const [a,c]=ext[o[0]]>=ext[o[1]]?o:[o[1],o[0]];
      const q=[P.getX(i)-b.min.x, P.getY(i)-b.min.y, P.getZ(i)-b.min.z];
      // a plate's thin edges show plain metal, not a row of half holes
      if(edge&&n[2]<0.5){ U.setXY(i,0.25,0.08); continue; }
      U.setXY(i,q[a]/tu,(q[c]-ext[c]/2)/tv+0.5);
    }
    return geo;
  },
  /* a ring sector in the x-y plane about (cx, cy), extruded d along z and centred on z = 0 */
  arcPlate(cx,cy,ri,ro,a0,a1,d,seg){
    const s=new THREE.Shape();
    s.moveTo(cx+ro*Math.cos(a0),cy+ro*Math.sin(a0));
    s.absarc(cx,cy,ro,a0,a1,false); s.lineTo(cx+ri*Math.cos(a1),cy+ri*Math.sin(a1)); s.absarc(cx,cy,ri,a1,a0,true);
    const g=new THREE.ExtrudeGeometry(s,{depth:d, bevelEnabled:false, curveSegments:seg});
    g.translate(0,0,-d/2); return g;
  },
  cylZ(r,len,seg){ const g=new THREE.CylinderGeometry(r,r,len,seg); g.rotateX(Math.PI/2); return g; },

  /* ---------- materials ---------- */
  /* The goBILDA pattern on one cell, 24 mm along a channel by 48 mm across: a 14 mm hole in the
     middle, 4 mm holes round it, on brushed aluminium. Drawn once. */
  holeTex(){
    const K=this._holeTex; if(K) return K;
    const cv=document.createElement("canvas"); cv.width=64; cv.height=128;
    const c=cv.getContext("2d"), px=64/24;
    c.fillStyle="#c9ced4"; c.fillRect(0,0,64,128);
    // brushing: faint streaks along the channel
    for(let y=0;y<128;y++){ const v=200+((y*37)%11)-5; c.fillStyle="rgba("+v+","+(v+4)+","+(v+9)+",0.35)"; c.fillRect(0,y,64,1); }
    const hole=(x,y,dmm)=>{ const r=dmm/2*px;
      c.beginPath(); c.arc(x,y,r+1.6,0,7); c.fillStyle="#9aa1a8"; c.fill();     // the chamfer catches light
      c.beginPath(); c.arc(x,y,r,0,7); c.fillStyle="#141619"; c.fill(); };
    hole(32,64,14);
    for(const [x,y] of [[32,64-16*px],[32,64+16*px],[0,64-8*px],[0,64+8*px],[64,64-8*px],[64,64+8*px]]) hole(x,y,4);
    const t=new THREE.CanvasTexture(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=4;
    if(THREE.SRGBColorSpace) t.colorSpace=THREE.SRGBColorSpace;
    t.userData={shared:true};
    return this._holeTex=t;
  },
  mats(V){
    const K=this.kit(V); if(K.mat) return K.mat;
    const env=V.envMap?V.envMap():null, T=this.tierOf(V);
    const std=(o,e)=>{ const m=new THREE.MeshStandardMaterial(o);
      if(env){ m.envMap=env; m.envMapIntensity=e; } else { m.metalness=Math.min(0.2,m.metalness); m.roughness=Math.max(0.45,m.roughness); }
      m.userData.shared=true; return m; };
    const hole=T>0?this.holeTex():null;
    K.mat={
      alu:std({color:0xffffff, map:hole, bumpMap:hole, bumpScale:1.2, metalness:0.62, roughness:0.36},1.0),
      dark:std({vertexColors:true, metalness:0.3, roughness:0.48},0.75),
      wheel:std({vertexColors:true, metalness:0.15, roughness:0.62},0.55),
      // the HUMAN PLAYERS have their own: the driver's view fades them (src/view3d.js updateMatch)
      person:std({vertexColors:true, metalness:0, roughness:0.74},0.35),
      lens:std({color:0x6d8394, metalness:0.15, roughness:0.05},1.5),
    };
    return K.mat;
  },
  /* the number sign: the robot's label in white on its alliance's colour; the hood shares the
     material, its uvs all on the plain colour at the corner */
  signMat(text,al){
    const cv=document.createElement("canvas"); cv.width=256; cv.height=128;
    const c=cv.getContext("2d"), col=al==="red"?"#d93a31":"#2a72e0";
    c.fillStyle=col; c.fillRect(0,0,256,128);
    c.fillStyle="rgba(0,0,0,0.16)"; c.fillRect(0,0,256,7); c.fillRect(0,121,256,7);
    fitFont(c,text,226,74,26,"Inter, -apple-system, system-ui, Arial, sans-serif");
    c.fillStyle="#ffffff"; c.textAlign="center"; c.textBaseline="middle"; c.fillText(text,128,68);
    const t=srgbTex(new THREE.CanvasTexture(cv)); t.anisotropy=4;
    return new THREE.MeshStandardMaterial({map:t, metalness:0.05, roughness:0.42});
  },

  /* ---------- the robot ---------- */
  mecanum(hand,T,wr,ww){
    const L=[], n=T>0?10:8, rr=0.0105, rlen=0.044, rc=wr-rr, hi=T>0;
    for(const z of [ww/2-0.004,-ww/2+0.004]) this.put(L,this.cylZ(wr*0.74,0.003,hi?22:12),0xb4bac2,[0,0,z]);
    this.put(L,this.cylZ(0.015,ww-0.004,hi?14:8),0x2a2c30);
    this.put(L,this.cylZ(0.006,ww+0.004,6),0xd9c25a);                     // the hex hub's bore
    const prof=[[0,-0.5],[0.62,-0.5],[0.95,-0.2],[0.95,0.2],[0.62,0.5],[0,0.5]].map(([r,y])=>new THREE.Vector2(r*rr,y*rlen));
    const up=new THREE.Vector3(0,1,0);
    for(let i=0;i<n;i++){
      const phi=i/n*2*Math.PI, geo=new THREE.LatheGeometry(prof,hi?6:4);
      // each roller lies in the rim's tangent plane at 45 degrees to the axle
      const ax=new THREE.Vector3(-Math.sin(phi)*Math.SQRT1_2,Math.cos(phi)*Math.SQRT1_2,hand*Math.SQRT1_2);
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up,ax));
      geo.translate(rc*Math.cos(phi),rc*Math.sin(phi),0);
      L.push({g:geo, c:0x2c2e33});
    }
    return this.merge(L);
  },
  /* compliant wheels on a hex shaft, its axis along y */
  intake(T,span){
    const L=[], hi=T>0, fins=6, R=0.03, r1=0.011, w=2*Math.PI/fins;
    this.put(L,new THREE.CylinderGeometry(0.0055,0.0055,span+0.05,6),0xa3aab1);
    const P=(a,r)=>[Math.cos(a)*r,Math.sin(a)*r];
    const s=new THREE.Shape(); s.moveTo(...P(0,r1));
    for(let i=0;i<fins;i++){ const a=i*w;
      s.quadraticCurveTo(...P(a+0.1*w,0.78*R),...P(a+0.58*w,R));
      s.lineTo(...P(a+0.68*w,0.94*R));
      s.quadraticCurveTo(...P(a+0.36*w,0.6*R),...P(a+0.45*w,r1));
      s.lineTo(...P(a+w,r1)); }
    const N=Math.max(3,Math.round(span/0.09));
    for(let i=0;i<N;i++){
      const g=new THREE.ExtrudeGeometry(s,{depth:0.02, bevelEnabled:false, curveSegments:hi?3:2});
      g.translate(0,0,-0.01); g.rotateX(Math.PI/2); g.translate(0,(i/(N-1)-0.5)*span,0);
      L.push({g, c:0x37b04b});
    }
    for(const y of [-span/2-0.012,span/2+0.012]) this.put(L,new THREE.CylinderGeometry(0.009,0.009,0.006,10),0xd9c25a,[0,y,0]);
    return this.merge(L);
  },
  /* the flywheel, its axis along y: a black tread, grey hubs, a white stripe and spokes to show it spin */
  flywheel(T,r){
    const L=[], hi=T>0, w=0.04;
    this.put(L,new THREE.CylinderGeometry(r,r,w,hi?28:14),0x1c1d20);
    this.put(L,new THREE.CylinderGeometry(r*0.78,r*0.78,w+0.002,hi?24:12),0x8d949b);
    this.put(L,new THREE.BoxGeometry(0.005,w+0.001,0.012),0xf1f1ee,[r-0.002,0,0]);
    for(let i=0;i<3;i++){ const a=i*2*Math.PI/3;
      this.put(L,new THREE.BoxGeometry(r*1.4,w+0.004,0.007),0x2b2d31,[0,0,0],[0,a,0]); }
    return this.merge(L);
  },
  kicker(){
    const L=[];
    this.put(L,new THREE.BoxGeometry(0.075,0.006,0.014),0xe8702a,[0.0375,0,0]);
    this.put(L,new THREE.BoxGeometry(0.007,0.028,0.06),0xe8702a,[0.073,0.011,0]);
    this.put(L,this.cylZ(0.008,0.02,10),0x1b1c1f);
    return this.merge(L);
  },
  /* Everything that doesn't move, by material, for a robot of half-size hx by hy on tier T.
     Robot frame: x ahead, y up, z to its right; the floor is y = 0. */
  botGeo(V,hx,hy,T){
    const key=hx.toFixed(3)+"|"+hy.toFixed(3)+"|"+T, K=this.kit(V);
    if(K.geo[key]) return K.geo[key];
    const hi=T>0, A=[], D=[], C=[], ALU=0xb8bec5;
    const wr=0.048, ww=0.038, wx=hx-0.08, wz=hy-0.0235, rz=hy-0.074, cy=wr;
    const sgn=v=>v<0?-1:1;
    // U-channel, 48 x 48 mm, open toward the middle; tier 0 draws it as a plain bar
    const chan=(along,a0,a1,at)=>{
      const len=a1-a0, m=(a0+a1)/2, out=sgn(at), X=along==="x";
      const P=(a,y,b)=>X?[a,y,b]:[b,y,a], S=(a,y,b)=>X?[a,y,b]:[b,y,a];
      if(!hi){ this.put(D,new THREE.BoxGeometry(...S(len,0.048,0.048)),ALU,P(m,cy,at)); return; }
      const wall=(s,p)=>this.put(A,this.tileUV(new THREE.BoxGeometry(...s),0.024,0.048),null,p);
      wall(S(len,0.048,0.0025),P(m,cy,at+out*0.02275));
      wall(S(len,0.0025,0.048),P(m,cy+0.02275,at)); wall(S(len,0.0025,0.048),P(m,cy-0.02275,at));
    };
    chan("x",-(hx-0.012),hx-0.012,-rz); chan("x",-(hx-0.012),hx-0.012,rz);
    chan("z",-(rz-0.024),rz-0.024,-(hx-0.06)); chan("z",-(rz-0.024),rz-0.024,0.0001);
    // the electronics plate across the rails
    this.put(D,new THREE.BoxGeometry(0.23,0.003,2*(rz+0.024)),0x202226,[0,cy+0.0255,0]);
    // drive motors: a gold gearbox off the rail, the black can inboard
    for(const x of [wx,-wx]) for(const s of [-1,1]){
      const z0=s*(rz-0.024);
      this.put(D,this.cylZ(0.0185,0.032,hi?16:8),0xc9a43c,[x,cy,z0-s*0.016]);
      this.put(D,this.cylZ(0.0185,0.068,hi?16:8),0x1c1d20,[x,cy,z0-s*0.066]);
      if(hi) this.put(D,this.cylZ(0.008,0.004,8),0x9aa1a8,[x,cy,z0-s*0.1015]);
    }
    // the side plates: goBILDA pattern plate, pocketed, carrying the intake at the front and the shooter at the back
    const fx=-0.19, fy=0.41, pz=0.112;
    const plate=new THREE.Shape();
    [[0.215,0.035],[0.215,0.088],[0.172,0.128],[0.072,0.302],[-0.115,0.302],[-0.135,0.455],[-0.175,0.475],[-0.215,0.468],[-hx+0.002,0.44],[-hx+0.002,0.076],[0.178,0.076],[0.178,0.035]]
      .forEach(([x,y],i)=>i?plate.lineTo(x,y):plate.moveTo(x,y));
    if(hi) for(const [x,y,r] of [[0.03,0.165,0.04],[-0.07,0.19,0.05],[-0.17,0.19,0.035],[-0.175,0.33,0.03],[0.12,0.14,0.022],[fx,fy,0.007]]){
      const h=new THREE.Path(); h.absarc(x,y,r,0,Math.PI*2,true); plate.holes.push(h); }
    for(const s of [-1,1]){
      const g=new THREE.ExtrudeGeometry(plate,{depth:0.004, bevelEnabled:false, curveSegments:hi?10:4});
      if(hi) this.put(A,this.tileUV(g,0.024,0.048,true),null,[0,0,s*pz-0.002]); else this.put(D,g,0x5a5f66,[0,0,s*pz-0.002]);
    }
    // the ramp from the intake up to the hopper, and the hopper's floor the held elements ride on
    const r0=[0.19,0.1], r1=[0.07,0.298];
    this.put(D,new THREE.BoxGeometry(Math.hypot(r1[0]-r0[0],r1[1]-r0[1]),0.004,2*pz-0.004),0x6f7f8c,[(r0[0]+r1[0])/2,(r0[1]+r1[1])/2,0],[0,0,Math.atan2(r1[1]-r0[1],r1[0]-r0[0])]);
    this.put(D,new THREE.BoxGeometry(0.275,0.004,2*pz-0.004),0x6f7f8c,[-0.0675,0.298,0]);
    // the shooter: axle, bearings, and its motor outside the right plate
    this.put(D,this.cylZ(0.004,0.31,8),0xa3aab1,[fx,fy,0.035]);
    for(const s of [-1,1]) this.put(D,this.cylZ(0.011,0.006,hi?14:8),0x9aa1a8,[fx,fy,s*(pz+0.004)]);
    this.put(D,this.cylZ(0.0185,0.012,hi?16:8),0xc9a43c,[fx,fy,pz+0.012]);
    this.put(D,this.cylZ(0.0185,0.064,hi?16:8),0x1c1d20,[fx,fy,pz+0.05]);
    // the Control Hub on the back, the battery on the plate, and the leads between them
    this.put(D,new THREE.BoxGeometry(0.032,0.103,0.143),0x2a2c30,[-hx+0.0196,0.13,0]);
    this.put(D,new THREE.BoxGeometry(0.002,0.05,0.09),0x868d95,[-hx+0.003,0.14,-0.01]);
    this.put(D,new THREE.BoxGeometry(0.003,0.007,0.007),0x36e06a,[-hx+0.003,0.17,0.055]);
    this.put(D,new THREE.BoxGeometry(0.075,0.036,0.13),0x161719,[0.02,cy+0.045,0]);
    this.put(D,new THREE.BoxGeometry(0.0765,0.012,0.1315),0xe2b52b,[0.02,cy+0.045,0]);
    if(hi) for(const [col,dz] of [[0xc0392b,0.06],[0x15161a,0.045]]){
      const path=new THREE.CatmullRomCurve3([[0.0,cy+0.064,dz],[-0.06,cy+0.1,dz+0.02],[-0.15,cy+0.14,dz],[-hx+0.03,0.185,dz-0.005]].map(p=>new THREE.Vector3(...p)));
      this.put(D,new THREE.TubeGeometry(path,18,0.0035,5,false),col);
    }
    // alliance colour: the number signs on the rails' faces, and the shooter's hood
    for(const s of [-1,1]){
      const g=new THREE.BoxGeometry(0.19,0.1,0.003), N=g.attributes.normal, U=g.attributes.uv;
      for(let i=0;i<N.count;i++) if(Math.abs(N.getZ(i))<0.5) U.setXY(i,0.02,0.02);
      this.put(C,g,null,[0,cy+0.026,s*(rz+0.024+0.0035)]);
    }
    const hood=this.arcPlate(fx,fy,0.096,0.1,0.26,1.92,2*pz-0.006,hi?14:6), HU=hood.attributes.uv;
    for(let i=0;i<HU.count;i++) HU.setXY(i,0.02,0.02);
    C.push({g:hood, c:null});
    const G={wr, alu:A.length?this.merge(A):null, dark:this.merge(D), accent:this.merge(C),
      wheelL:this.mecanum(1,T,wr,ww), wheelR:this.mecanum(-1,T,wr,ww),
      roll:this.intake(T,2*(hy-0.06)), fly:this.flywheel(T,0.038), kick:hi?this.kicker():null,
      // front-left, front-right, back-left, back-right (mecanumTurns' order), each with its roller hand
      wheelPos:[[wx,-wz,1],[wx,wz,-1],[-wx,-wz,-1],[-wx,wz,1]],
      rollAt:[hx-0.034,0.06,0], flyAt:[fx,fy,0], kickAt:[-0.205,0.29,0]};
    return K.geo[key]=G;
  },
  /* An AI robot (or an online player's stand-in) b: {id, al, hx, hy, label}. Its userData is what
     src/view3d.js turns each frame: wheels, roll (the intake) and fly (the flywheel), both spun
     about their own y; held, the elements in its hopper. */
  bot(V,b){
    const T=this.tierOf(V), hx=b.hx||MATCH_BOT.hx, hy=b.hy||MATCH_BOT.hy, M=this.mats(V), G=this.botGeo(V,hx,hy,T);
    const g=new THREE.Group();
    const add=(geo,mat,p)=>{ const m=new THREE.Mesh(geo,mat); m.castShadow=true; m.receiveShadow=T>0; if(p) m.position.set(p[0],p[1],p[2]); g.add(m); return m; };
    if(G.alu) add(G.alu,M.alu);
    add(G.dark,M.dark);
    add(G.accent,this.signMat(b.label||"AI "+String(b.id).slice(2),b.al));
    const wheels=G.wheelPos.map(([x,z,hand])=>add(hand>0?G.wheelL:G.wheelR,M.wheel,[x,G.wr,z]));
    const roll=add(G.roll,M.wheel,G.rollAt); roll.rotation.x=Math.PI/2;
    const fly=add(G.fly,M.wheel,G.flyAt); fly.rotation.x=Math.PI/2;
    const kicker=G.kick?add(G.kick,M.dark,G.kickAt):null;
    Object.assign(g.userData,{held:[], holdKey:null, wheels, roll, fly, kicker, wr:G.wr, hx:G.wheelPos[0][0], hy:G.wheelPos[1][1]});
    return g;
  },
  /* A robot to where it is: each mecanum wheel turns the way that motion turns it, the
     kicker flicks up and the robot rocks back a little when it fires (userData.kick, set by
     src/view3d.js flightFx). A jump (a reset, a new start) turns nothing. */
  moveBot(g,x,y,h,dt){
    const U=g.userData, c=Math.cos(h), s=Math.sin(h);
    if(U.px==null){ U.px=x; U.py=y; U.ph=h; }
    const dx=x-U.px, dy=y-U.py, dh=Math.atan2(Math.sin(h-U.ph),Math.cos(h-U.ph));
    U.px=x; U.py=y; U.ph=h;
    if(Math.hypot(dx,dy)<0.5&&Math.abs(dh)<1){
      const W=mecanumTurns(dx*c+dy*s,-dx*s+dy*c,dh,U.hx||0.15,U.hy||0.2,U.wr||0.048);
      (U.wheels||[]).forEach((w,i)=>{ w.rotation.z-=W[i]; });
    }
    U.kick=Math.max(0,(U.kick||0)-dt*7);
    const k=Math.sin(Math.min(1,U.kick)*Math.PI), back=0.018*k;
    if(U.kicker) U.kicker.rotation.z=0.95*k;
    g.position.set(x-c*back,0,-(y-s*back)); g.rotation.y=h;
  },

  /* ---------- the HUMAN PLAYER ---------- */
  lathe(pts,seg){ return new THREE.LatheGeometry(pts.map(([r,y])=>new THREE.Vector2(r,y)),seg); },
  humanGeo(V,al,T){
    const key="h|"+al+"|"+T, K=this.kit(V);
    if(K.geo[key]) return K.geo[key];
    const C=FIG_PEOPLE[al]||FIG_PEOPLE.red, hi=T>0, seg=hi?12:7, sw=hi?14:8, sh=hi?10:6;
    const sph=(r)=>new THREE.SphereGeometry(r,sw,sh);
    // the hips, the belt at their top (pelvis frame: the hip joints 3 cm below its origin)
    const pel=[];
    this.put(pel,this.lathe([[0,-0.13],[0.1,-0.125],[0.148,-0.08],[0.158,-0.02],[0.154,0.025],[0,0.03]],seg),y=>y>0.0?0x1d1e21:C.pants,null,null,[0.68,1,1]);
    // the chest: shirt, neck, collar, lanyard and badge (torso frame: the waist at its origin)
    const ch=[];
    this.put(ch,this.lathe([[0,-0.02],[0.148,-0.015],[0.15,0.06],[0.158,0.16],[0.178,0.27],[0.19,0.36],[0.188,0.42],[0.165,0.47],[0.11,0.5],[0.06,0.51],[0,0.512]],seg),C.shirt,null,null,[0.62,1,1]);
    this.put(ch,new THREE.CylinderGeometry(0.046,0.05,0.1,seg),C.skin,[0.005,0.52,0]);
    this.put(ch,new THREE.TorusGeometry(0.055,0.011,6,seg),C.shirt,[0.004,0.498,0],[Math.PI/2,0,0],[1,1.12,1]);
    for(const s of [-1,1]){
      const path=new THREE.CatmullRomCurve3([[-0.02,0.52,s*0.05],[0.045,0.49,s*0.06],[0.098,0.4,s*0.045],[0.118,0.31,s*0.012]].map(p=>new THREE.Vector3(...p)));
      ch.push({g:new THREE.TubeGeometry(path,hi?12:6,0.0045,4,false), c:C.lanyard});
    }
    this.put(ch,new THREE.BoxGeometry(0.004,0.075,0.055),0xf3f3f0,[0.121,0.262,0]);
    this.put(ch,new THREE.BoxGeometry(0.0045,0.016,0.0555),al==="red"?0xd93a31:0x2a72e0,[0.1212,0.292,0]);
    // the head: skull, jaw, nose, ears, mouth, brows, and a cap or hair (head frame: the base of the neck)
    const hd=[], hc=[0.012,0.12,0];
    this.put(hd,sph(0.1),C.skin,hc,null,[1.02,1.16,0.86]);
    this.put(hd,sph(0.064),C.skin,[0.03,0.075,0],null,[1,0.85,0.92]);
    this.put(hd,sph(0.017),C.skin,[0.11,0.108,0],[0,0,0.25],[0.85,1.45,0.72]);
    for(const s of [-1,1]){
      this.put(hd,sph(0.024),C.skin,[0.002,0.118,s*0.086],null,[0.55,1,0.35]);
      this.put(hd,new THREE.BoxGeometry(0.006,0.0055,0.03),C.hair,[0.104,0.163,s*0.034],[s*0.12,0,0]);
    }
    this.put(hd,new THREE.BoxGeometry(0.004,0.006,0.032),0x8c4a3e,[0.1,0.066,0]);
    if(C.cap!=null){
      this.put(hd,new THREE.SphereGeometry(0.104,sw,sh,0,Math.PI*2,0,Math.PI*0.5),C.cap,[0.006,0.15,0],[0,0,0.18],[1.04,0.92,0.9]);
      this.put(hd,new THREE.CylinderGeometry(0.076,0.076,0.007,sw,1,false,0,Math.PI),C.cap,[0.07,0.165,0],[0,0,-0.12]);
      this.put(hd,new THREE.SphereGeometry(0.101,sw,sh,-Math.PI*0.4,Math.PI*0.8,Math.PI*0.3,Math.PI*0.35),C.hair,hc,null,[1.03,1.15,0.9]);
    } else {
      // phi 0 of a sphere is at -x, the back of the head: tipped back, the hairline rises at the front
      this.put(hd,new THREE.SphereGeometry(0.106,sw,sh,0,Math.PI*2,0,Math.PI*0.54),C.hair,[-0.004,0.128,0],[0,0,0.3],[1.04,1.14,0.9]);
    }
    // safety glasses: a wrap-around lens and its arms
    const gl=[];
    gl.push({g:new THREE.CylinderGeometry(0.106,0.104,0.03,sw,1,true,Math.PI/2-0.95,1.9).scale(1.02,1,0.88).translate(0.012,0.137,0), c:null});
    for(const s of [-1,1]) this.put(gl,new THREE.BoxGeometry(0.08,0.006,0.004),null,[0.035,0.14,s*0.091]);
    // arms: a short sleeve, then skin; the hand's thumb forward. Both arms share them.
    const ua=[], fa=[];
    this.put(ua,this.lathe([[0,0.022],[0.03,0.018],[0.045,0.0],[0.047,-0.05],[0.0445,-0.118],[0.044,-0.122],[0.04,-0.2],[0.036,-0.275],[0.025,-0.293],[0,-0.296]],seg),(x,y)=>y>-0.12?C.shirt:C.skin);
    this.put(fa,this.lathe([[0,0.012],[0.03,0.006],[0.038,-0.02],[0.036,-0.12],[0.027,-0.232],[0.022,-0.248],[0,-0.252]],seg),C.skin);
    this.put(fa,sph(0.04),C.skin,[0.004,-0.3,0],null,[0.95,1.3,0.52]);
    this.put(fa,new THREE.CapsuleGeometry(0.0105,0.03,3,6),C.skin,[0.03,-0.275,0],[0,0,0.55]);
    // legs: jeans down to the ankle
    const th=[], sn=[];
    this.put(th,this.lathe([[0,0.03],[0.06,0.022],[0.075,-0.03],[0.068,-0.2],[0.056,-0.38],[0.05,-0.43],[0,-0.44]],seg),C.pants);
    this.put(sn,this.lathe([[0,0.012],[0.05,0.004],[0.053,-0.05],[0.046,-0.2],[0.041,-0.37],[0.044,-0.405],[0,-0.41]],seg),C.pants);
    // what stays put: the shoes (the feet are planted) and the tray stand at the right hip
    const st=[];
    for(const s of [-1,1]){
      this.put(st,new THREE.CapsuleGeometry(0.047,0.165,4,sw),C.shoe,[0.045,0.042,s*0.09],[0,0,Math.PI/2],[0.78,1,1.06]);
      this.put(st,new THREE.BoxGeometry(0.255,0.016,0.098),C.sole,[0.045,0.008,s*0.09]);
    }
    const tz=0.43, ty=0.8;
    this.put(st,new THREE.BoxGeometry(0.52,0.025,0.15),0x3a3d42,[0,ty,tz]);
    for(const s of [-1,1]){ this.put(st,new THREE.BoxGeometry(0.52,0.03,0.008),0x2b2d31,[0,ty+0.02,tz+s*0.071]);
      this.put(st,new THREE.CylinderGeometry(0.011,0.011,ty,8),0x8a9097,[s*0.2,ty/2,tz]); }
    this.put(st,new THREE.BoxGeometry(0.5,0.02,0.22),0x2b2d31,[0,0.01,tz]);
    const G={pelvis:this.merge(pel), chest:this.merge(ch), head:this.merge(hd), glasses:this.merge(gl),
      upper:this.merge(ua), fore:this.merge(fa), thigh:this.merge(th), shin:this.merge(sn), still:this.merge(st), tray:{y:ty+0.0125, z:tz}};
    return K.geo[key]=G;
  },
  /* A HUMAN PLAYER behind the alliance wall, level with the middle of the LOADING ZONE,
     facing the field, the tray of NECTAR still to enter at the right hip. */
  human(V,al){
    const T=this.tierOf(V), M=this.mats(V), G=this.humanGeo(V,al,T), C=FIG_PEOPLE[al]||FIG_PEOPLE.red;
    const g=new THREE.Group(), J={};
    const mesh=(geo,mat,parent)=>{ const m=new THREE.Mesh(geo,mat); m.castShadow=true; m.receiveShadow=T>0; parent.add(m); return m; };
    const joint=(parent,p,order)=>{ const o=new THREE.Group(); o.position.set(p[0],p[1],p[2]); if(order) o.rotation.order=order; parent.add(o); return o; };
    mesh(G.still,M.person,g);
    J.pelvis=joint(g,[0,0.95,0]); mesh(G.pelvis,M.person,J.pelvis);
    J.torso=joint(J.pelvis,[0,0,0],"YZX"); J.chest=mesh(G.chest,M.person,J.torso);
    J.head=joint(J.torso,[0,0.53,0],"YZX"); J.head.scale.setScalar(1.07);
    // the cap's brim would put the whole face in shadow under the arena lights
    mesh(G.head,M.person,J.head).receiveShadow=false; mesh(G.glasses,M.lens,J.head).receiveShadow=false;
    for(const [s,n] of [[1,"R"],[-1,"L"]]){
      J["sh"+n]=joint(J.torso,[0,0.44,s*0.195],"XZY"); mesh(G.upper,M.person,J["sh"+n]);
      J["el"+n]=joint(J["sh"+n],[0,-0.29,0]); mesh(G.fore,M.person,J["el"+n]);
      J["hip"+n]=joint(J.pelvis,[0,-0.03,s*0.09],"XZY"); mesh(G.thigh,M.person,J["hip"+n]);
      J["kn"+n]=joint(J["hip"+n],[0,-0.43,0]); mesh(G.shin,M.person,J["kn"+n]);
    }
    J.palm=joint(J.elR,[0.012,-0.31,0.045]);   // where a NECTAR sits in the right hand
    const tray=[0,1,2,3,4].map(i=>{ const b=V.ball("nectar",al); b.position.set(-0.18+i*0.09,G.tray.y+1.81*IN,G.tray.z); g.add(b); return b; });
    const tb=V.ball("nectar",al); tb.visible=false; V.matchG.add(tb);
    const D=Field.data.field, z=D.loadingZones[al], s=al==="red"?-1:1;
    g.position.set(s*(H_OF(D)+0.55),0,-((z.y0+z.y1)/2)*IN);
    g.rotation.y=al==="red"?0:Math.PI;
    Object.assign(g.userData,{J, tray, throwBall:tb, seed:C.seed, t:C.seed*3, look:0, rel:null});
    this.poseHuman(J,humanPose(0,null,0,C.seed));
    return g;
  },
  poseHuman(J,P){
    J.pelvis.position.set(P.sx,0.95-P.drop,P.sz);
    J.pelvis.rotation.set(P.roll,0,0);
    J.torso.rotation.set(0,P.yaw,P.lean);
    J.chest.scale.set(1+P.breath*0.7,1+P.breath*0.25,1+P.breath*0.5);
    J.head.rotation.set(0,P.head,P.nod);
    J.shR.rotation.set(P.shRx,0,P.shRz); J.elR.rotation.z=P.elR;
    J.shL.rotation.set(P.shLx,0,P.shLz); J.elL.rotation.z=P.elL;
    // the legs keep the feet where they stand while the hips shift, tip and sink
    const Lg=0.85, ax=Math.asin(figClamp(P.sx/Lg,-0.5,0.5)), az=Math.asin(figClamp(P.sz/Lg,-0.5,0.5));
    for(const n of ["R","L"]){ J["hip"+n].rotation.set(az-P.roll,0,P.knee/2-ax); J["kn"+n].rotation.z=-P.knee; }
  },
  /* One frame of a HUMAN PLAYER (from src/view3d.js updateMatch): watch the alliance's
     nearest robot, or where the NECTAR is going while entering one; pose; and carry the
     NECTAR from the tray to the hand to the LOADING ZONE. */
  animHuman(V,g,al,dt){
    const U=g.userData, J=U.J, Hm=Match.humans[al], A=Hm&&Hm.anim, k=A?Math.min(1,A.t/A.dur):null;
    U.t+=dt;
    let tx=null, ty=null;
    if(A){ tx=A.to.x; ty=A.to.y; }
    else {
      const hx=g.position.x, hy=-g.position.z; let bd=1e9;
      const see=(x,y)=>{ const d=Math.hypot(x-hx,y-hy); if(d<bd){ bd=d; tx=x; ty=y; } };
      for(const b of Match.bots) if(b.al===al) see(b.x,b.y);
      for(const p of Match.players||[]) if(p.al===al) see(p.x,p.y);
      if(typeof Sim!=="undefined"&&Sim.chassis&&Match.user===al&&!Match.noUser) see(Sim.chassis.x,Sim.chassis.y);
    }
    let want=0;
    if(tx!=null){ const wx=tx-g.position.x, wz=-ty-g.position.z, a=g.rotation.y;
      want=Math.atan2(-(Math.sin(a)*wx+Math.cos(a)*wz),Math.cos(a)*wx-Math.sin(a)*wz); }
    U.look+=(want-U.look)*(1-Math.exp(-dt*(A?6:2.5)));
    this.poseHuman(J,humanPose(U.t,k,U.look,U.seed));
    const ph=throwBallPhase(k), out=!!A&&ph.at!=="tray";
    U.tray.forEach((m,i)=>{ m.visible=i<Hm.tray-(out?1:0); });
    const ball=U.throwBall; ball.visible=out;
    if(!out){ U.rel=null; return; }
    g.updateMatrixWorld(true);
    if(ph.at==="hand"){ J.palm.getWorldPosition(ball.position); U.rel=null; return; }
    if(!U.rel) U.rel=J.palm.getWorldPosition(new THREE.Vector3());
    const to=new THREE.Vector3(A.to.x,1.81*IN,-A.to.y), u=ph.u;
    ball.position.lerpVectors(U.rel,to,u); ball.position.y+=Math.sin(Math.PI*u)*0.32;
    ball.rotation.z-=dt*9;
  },
};
