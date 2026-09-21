/* ============================================================
   6c.  ROBOT FRAME — one coordinate system for everything that moves

   Onshape puts an assembly wherever the team happened to insert it: the
   origin off to one side, the robot lying on the Front plane, the whole
   thing a metre from zero. Every consumer of the CAD used to cope with that
   separately, and they disagreed. The physics put the centre of mass in raw
   CAD coordinates and the wheels around the drivetrain centre, so a robot
   spinning in place thought its weight sat a metre outside the wheelbase,
   lifted wheels, and lurched sideways — the chassis "moved when it turned".
   Joint classification assumed Z was up, so a Y-up robot had its arm read
   as a turret.

   So the CAD is canonicalised once, inside the parser, before anything else
   looks at it:
     +z is up                  (detected from the wheels, else Onshape's Top plane)
     origin at the drivetrain  centre of the drive wheels in plan, on the floor
     x/y are the CAD's own     horizontal axes; which one is FORWARD is still
                               the front setting, so that stays a live toggle
   A robot with no wheels gets its box centre instead, and says so.

   robotFrame() only measures; canonicalizeCAD() applies it. The transform is
   a signed axis permutation plus a translation, so it is exact and invertible
   and the raw-CAD meshes from the tessellator can be moved by the same one.
   ============================================================ */

/* Proper rotations taking each possible up axis to +z. Rows are the new x, y
   and z axes written in CAD coordinates; every one has determinant +1, so no
   robot ever comes out mirrored. */
const FRAME_UP_ROWS={
  "+z":[[1,0,0],[0,1,0],[0,0,1]],
  "-z":[[1,0,0],[0,-1,0],[0,0,-1]],
  "+y":[[1,0,0],[0,0,-1],[0,1,0]],
  "-y":[[1,0,0],[0,0,1],[0,-1,0]],
  "+x":[[0,1,0],[0,0,1],[1,0,0]],
  "-x":[[0,1,0],[0,0,-1],[-1,0,0]],
};
const FRAME_AXES=[[1,0,0],[0,1,0],[0,0,1]];
const frDot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

/* Wheel-shaped parts, measured the same way the drivetrain detector does, in
   whatever orientation the CAD arrived. With no wheel names to go on, the
   same shape-only set the detector would fall back to — found here with up
   unknown, since finding up is what the wheels are for. */
function frameWheels(solids){
  const out=[];
  for(const s of solids||[]){
    if(!s||!s.pts||s.pts.length<4||!dtIsWheel(s)) continue;
    const g=dtWheelGeom(s.pts);
    if(!(g.r>0.012&&g.r<0.16)||g.round<0.75||g.width>2.2*g.r) continue;
    out.push(g);
  }
  if(out.length>=2) return out;
  const byShape=dtShapeWheels(solids,null);
  return byShape?byShape.wheels.map(c=>c.g):out;
}

/* Which CAD axis is up. Every drive axle is horizontal, so up is square to all
   of them; and the drive wheels share one height, so up is the axis their
   centres spread least along. Of the two directions on that axis, up is the
   one the rest of the robot sits on the side of. */
function frameUp(solids,bbox,opts){
  const o=opts||{};
  if(FRAME_UP_ROWS[o.up]) return {up:o.up, why:"set by hand"};
  const ws=frameWheels(solids);
  if(ws.length>=2){
    let best=null;
    for(let k=0;k<3;k++){
      const a=FRAME_AXES[k];
      const square=ws.reduce((s,w)=>s+Math.abs(frDot(w.axis,a)),0)/ws.length;
      if(square>0.3) continue;                      // some axle points along it: not up
      const h=ws.map(w=>w.c[k]), m=h.reduce((s,v)=>s+v,0)/h.length;
      const spread=Math.sqrt(h.reduce((s,v)=>s+(v-m)*(v-m),0)/h.length);
      // two wheels can't tell the two axes square to their axle apart by
      // spread; prefer Z, then Y — how people actually model robots
      const score=spread+(ws.length<3?[0.002,0.001,0][k]:0);
      if(!best||score<best.score) best={k, score, plane:m};
    }
    if(best){
      const b=bbox||{min:[0,0,0],max:[0,0,0]};
      const above=b.max[best.k]-best.plane, below=best.plane-b.min[best.k];
      const sign=above>=below?"+":"-";
      const ax="xyz"[best.k];
      return {up:sign+ax, why:ws.length+" wheels: their axles are all square to "+ax+
        ", their centres sit level along it, and the robot is built on the "+(sign==="+"?"positive":"negative")+" side"};
    }
  }
  return {up:"+z", why:ws.length?"the wheels found don't settle it, so Onshape's Top plane is taken as the floor"
                                 :"no wheels to go on, so Onshape's Top plane is taken as the floor"};
}

/* Measure the frame. `cad` needs solids and a bbox; nothing is changed. */
function robotFrame(cad,opts){
  const solids=(cad&&cad.solids)||[], bbox=cad&&cad.bbox;
  const U=frameUp(solids,bbox,opts), R=FRAME_UP_ROWS[U.up];
  const upv=R[2];
  const rot=p=>[frDot(R[0],p),frDot(R[1],p),frDot(R[2],p)];

  // the drive wheels are the ones on the floor — exactly as the drivetrain
  // detector picks them, so the two agree on where the centre is
  let ws=dtOnFloor(frameWheels(solids),upv);
  let origin, originWhy, floorWhy;
  if(ws.length>=2){
    const c=[0,0,0]; for(const w of ws){ c[0]+=w.c[0]; c[1]+=w.c[1]; c[2]+=w.c[2]; }
    for(let k=0;k<3;k++) c[k]/=ws.length;
    const r=ws.reduce((s,w)=>s+w.r,0)/ws.length;
    const drop=frDot(c,upv)-r;                         // the floor, along up
    origin=[c[0]+(drop-frDot(c,upv))*upv[0], c[1]+(drop-frDot(c,upv))*upv[1], c[2]+(drop-frDot(c,upv))*upv[2]];
    originWhy="wheels"; floorWhy="the bottom of the drive wheels";
  }else{
    const b=bbox||{min:[0,0,0],max:[0,0,0]};
    const c=[0,1,2].map(k=>(b.min[k]+b.max[k])/2);
    // the lowest corner of the box along up is the floor
    let lo=Infinity;
    for(let i=0;i<8;i++){ const q=[i&1?b.max[0]:b.min[0], i&2?b.max[1]:b.min[1], i&4?b.max[2]:b.min[2]]; lo=Math.min(lo,frDot(q,upv)); }
    const d=lo-frDot(c,upv);
    origin=[c[0]+d*upv[0], c[1]+d*upv[1], c[2]+d*upv[2]];
    originWhy="bbox"; floorWhy="the bottom of the CAD";
  }
  const O=origin;
  // opts.front turns "canonical" into "robot": x forward, y left. The parser
  // never passes it — front stays a live toggle — but anything that wants the
  // robot's own axes can ask.
  const yaw=o=>{ if(!opts||!opts.front) return o;
    const F=dtFrame({up:"+z", front:opts.front}); return [frDot(o,F.fwd),frDot(o,F.left),o[2]]; };
  const toCanon=p=>rot([p[0]-O[0],p[1]-O[1],p[2]-O[2]]);
  const F={
    up:U.up, upWhy:U.why, origin:O, originWhy, floorWhy, wheels:ws.length, R, front:(opts&&opts.front)||null,
    toCanon, toRobot:p=>yaw(toCanon(p)), dirToRobot:v=>yaw(rot(v)),
    fromRobot:q=>[R[0][0]*q[0]+R[1][0]*q[1]+R[2][0]*q[2]+O[0],
                  R[0][1]*q[0]+R[1][1]*q[1]+R[2][1]*q[2]+O[1],
                  R[0][2]*q[0]+R[1][2]*q[1]+R[2][2]*q[2]+O[2]],
  };
  // the whole robot in its own frame: the box corners map exactly, because
  // the transform is an axis permutation
  const b=bbox||{min:[0,0,0],max:[0,0,0]}, lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<8;i++){
    const q=F.toRobot([i&1?b.max[0]:b.min[0], i&2?b.max[1]:b.min[1], i&4?b.max[2]:b.min[2]]);
    for(let k=0;k<3;k++){ lo[k]=Math.min(lo[k],q[k]); hi[k]=Math.max(hi[k],q[k]); }
  }
  F.bounds={minX:lo[0],maxX:hi[0],minY:lo[1],maxY:hi[1],minZ:lo[2],maxZ:hi[2]};
  return F;
}

/* Canonical (x, y) -> the robot's own (forward, left) for a front setting.
   Everything canonical is already up-aligned and centred; this is the one
   rotation left, and it's the same one driveFromCAD uses. */
function frontToRobot(front){
  const F=dtFrame({up:"+z", front:front||"+x"});
  return p=>[frDot(p,F.fwd),frDot(p,F.left),p[2]];
}

/* Where a canonical CAD point is on the field. THE contract between the
   physics, the view and the tests: pose.x/y is the drivetrain centre in field
   metres, pose.h is the heading (CCW from field +x), and the front setting
   says which canonical axis is the robot's forward. Anything that draws or
   measures the robot in the world goes through this, so the thing the
   collisions push, the thing the view draws and the thing the tests watch
   can never be three different points again. */
function robotToWorld(pose,front,p){
  const r=frontToRobot(front)(p), c=Math.cos(pose.h), s=Math.sin(pose.h);
  return [pose.x+r[0]*c-r[1]*s, pose.y+r[0]*s+r[1]*c, r[2]];
}

/* Canonicalise a CAD that didn't come through the parser — the built-in
   sample, or a workspace saved before frames existed. Joints move with the
   parts. Idempotent: a CAD that already carries a frame is left alone, and
   re-measuring a canonical CAD gives the identity anyway. */
function canonicalizeCAD(cad,opts){
  if(!cad||cad.frame) return cad;
  const F=robotFrame(cad,{up:opts&&opts.up});
  cad.bbox=applyFrame(F,{points:cad.points, solids:cad.solids, placements:cad.placements, bbox:cad.bbox});
  for(const m of cad.mechs||[]){
    if(m.pivot) m.pivot=F.toRobot(m.pivot);
    if(m.distalTo) m.distalTo=F.toRobot(m.distalTo);
    if(m.axis) m.axis=F.dirToRobot(m.axis);
    if(m.cluster) m.cluster=m.cluster.map(F.toRobot);
  }
  cad.frame=frameRecord(F);
  return cad;
}

/* The same transform as a 4x4 (row-major), for moving a whole tessellated
   mesh in one go: canonical = M * [x y z 1]. */
function frameMatrix(F){
  const R=F.R, t=F.toRobot([0,0,0]);
  return [R[0][0],R[0][1],R[0][2],t[0], R[1][0],R[1][1],R[1][2],t[1], R[2][0],R[2][1],R[2][2],t[2], 0,0,0,1];
}

/* Apply a frame to the parser's working data, in place: the point cloud, the
   part solids and the occurrence placements. The bbox is recomputed from what
   moved. `placed` is recorded first, because "does this occurrence sit at the
   origin?" is how the mechanism builder skips unplaced parts, and moving the
   origin would otherwise change the answer. */
function applyFrame(F,data){
  const tp=F.toRobot, td=F.dirToRobot;
  for(const p of data.placements||[]){
    if(p.placed===undefined) p.placed=p.loc.some(v=>v!==0);
    p.loc=tp(p.loc); p.axis=td(p.axis);
  }
  const mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  const grow=q=>{ for(let k=0;k<3;k++){ if(q[k]<mn[k]) mn[k]=q[k]; if(q[k]>mx[k]) mx[k]=q[k]; } };
  const P=data.points||[];
  for(let i=0;i<P.length;i++){ P[i]=tp(P[i]); grow(P[i]); }
  for(const s of data.solids||[]){ s.pts=s.pts.map(tp); s.pts.forEach(grow); if(s.tri) s.tri=null; }
  // Nothing to measure from (a CAD that is only a box and some joints): move
  // the box it already has. Inventing a default here quietly resized the
  // robot, and with it the footprint and where the shooter sits.
  if(!Number.isFinite(mn[0])&&data.bbox){
    const b=data.bbox;
    for(let i=0;i<8;i++) grow(tp([i&1?b.max[0]:b.min[0], i&2?b.max[1]:b.min[1], i&4?b.max[2]:b.min[2]]));
  }
  if(!Number.isFinite(mn[0])){ mn[0]=mn[1]=-0.25; mn[2]=0; mx[0]=mx[1]=0.25; mx[2]=0.5; }
  return {min:mn, max:mx};
}

/* The frame record a CAD carries once canonicalised: enough to explain it in
   the UI and to move raw-CAD meshes (the tessellator's) the same way. */
function frameRecord(F){
  return {up:F.up, upWhy:F.upWhy, origin:F.origin.slice(), originWhy:F.originWhy, floorWhy:F.floorWhy,
          wheels:F.wheels, R:F.R.map(r=>r.slice()), M:frameMatrix(F)};
}
