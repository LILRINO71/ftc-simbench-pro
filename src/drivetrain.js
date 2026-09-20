/* ============================================================
   6b.  DRIVETRAIN — what the drive base is, read straight off the CAD

   Nobody tags their assembly, so this module works the drivetrain out of
   the geometry alone: which solids are wheels, where they sit, which way
   their axles point, and from that whether the robot is tank, mecanum,
   X-drive, kiwi or swerve. Then it builds the kinematics for it.

   A wheel is a short fat cylinder, so its axle is the direction its points
   are LEAST spread along. That falls out of a 3x3 covariance eigen-
   decomposition (Jacobi rotations — small, exact enough, no library), and
   the same decomposition gives the radius: half the widest extent across
   the axle.

   Frames. CAD points are metres in the CAD's own axes; opts.front/opts.up
   say how those line up with the robot (the same "+x"/"-y" strings as
   FRONTS). Chassis axes are x forward, y left, z up, origin at the centre
   of the wheels, omega counter-clockwise. An ik row is [a,b,c] with

       wheel surface speed (m/s) = a*vx + b*vy + c*omega

   so a row is metres of rim travel per metre the robot moves and per
   radian it turns. Divide by the wheel radius for rad/s at the motor.
   ============================================================ */

const DRIVE_KINDS={
  mecanum:{label:"Mecanum",     desc:"four wheels with 45-degree rollers; drives, strafes and turns"},
  tank:   {label:"Tank",        desc:"traction wheels either side, all facing forward; no strafe"},
  x:      {label:"X-drive",     desc:"four omni wheels at 45 degrees to the chassis; holonomic"},
  omni:   {label:"Kiwi",        desc:"three omni wheels 120 degrees apart; holonomic"},
  swerve: {label:"Swerve",      desc:"every wheel steered by its own actuator"},
  unknown:{label:"Unknown",     desc:"nothing in the CAD reads as a drive wheel"}
};

/* Confidence is evidence, not enthusiasm: a part actually named "mecanum"
   beats a 45-degree axle, which beats four parallel axles — four parallel
   axles are the one case geometry genuinely cannot resolve. */
const DT_CONF={name:0.92, nameOmni:0.90, swerveGeom:0.75, x:0.80, kiwi:0.80, tank2:0.65, tank6:0.55, tank4:0.45};

const DT_WHEEL=/mecanum|omni|traction|tread|wheel|tyre|tire/i;
/* Things that match /wheel/ or turn like one but never carry the robot. */
const DT_NOTWHEEL=/fly ?wheel|pulley|sprocket|\bgear\b|spool|idler|bearing|\bhub\b|guard|shield|tensioner|encoder|odometry|dead ?wheel/i;

const DT_AXES={"+x":[1,0,0],"-x":[-1,0,0],"+y":[0,1,0],"-y":[0,-1,0],"+z":[0,0,1],"-z":[0,0,-1]};
const dtDot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const dtCross=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dtDeg=r=>r*180/Math.PI;                 // only ever for the why list

/* Chassis axes in CAD coordinates. */
function dtFrame(opts){
  const o=opts||{};
  const up=DT_AXES[o.up||"+z"]||DT_AXES["+z"];
  let fwd=DT_AXES[o.front||"+x"]||DT_AXES["+x"];
  if(Math.abs(dtDot(fwd,up))>0.9) fwd=Math.abs(up[0])>0.9?DT_AXES["+y"]:DT_AXES["+x"];
  return {fwd, left:dtCross(up,fwd), up};     // up x fwd: z cross x = y, so +y is left
}

function dtCentroid(pts){
  const c=[0,0,0];
  for(const p of pts){ c[0]+=p[0]; c[1]+=p[1]; c[2]+=p[2]; }
  const n=pts.length||1; return [c[0]/n,c[1]/n,c[2]/n];
}

/* Principal axes of a point cloud, biggest spread first. Cyclic Jacobi on
   the covariance: a symmetric 3x3 converges in two or three sweeps. */
function dtPrincipal(pts){
  const c=dtCentroid(pts), A=[[0,0,0],[0,0,0],[0,0,0]];
  for(const p of pts){ const d=[p[0]-c[0],p[1]-c[1],p[2]-c[2]];
    for(let i=0;i<3;i++) for(let j=i;j<3;j++) A[i][j]+=d[i]*d[j]; }
  const n=pts.length||1;
  for(let i=0;i<3;i++) for(let j=i;j<3;j++){ A[i][j]/=n; A[j][i]=A[i][j]; }
  const V=[[1,0,0],[0,1,0],[0,0,1]], PQ=[[0,1],[0,2],[1,2]];
  for(let sweep=0;sweep<32;sweep++){
    if(A[0][1]*A[0][1]+A[0][2]*A[0][2]+A[1][2]*A[1][2] < 1e-34) break;
    for(const pq of PQ){
      const p=pq[0], q=pq[1];
      if(Math.abs(A[p][q])<1e-26) continue;
      const th=(A[q][q]-A[p][p])/(2*A[p][q]);
      const t=(th>=0?1:-1)/(Math.abs(th)+Math.sqrt(th*th+1));
      const cs=1/Math.sqrt(t*t+1), sn=t*cs, h=t*A[p][q];
      A[p][p]-=h; A[q][q]+=h; A[p][q]=A[q][p]=0;
      for(let r=0;r<3;r++){ if(r===p||r===q) continue;
        const arp=A[r][p], arq=A[r][q];
        A[r][p]=A[p][r]=cs*arp-sn*arq; A[r][q]=A[q][r]=sn*arp+cs*arq; }
      for(let r=0;r<3;r++){ const vp=V[r][p], vq=V[r][q];
        V[r][p]=cs*vp-sn*vq; V[r][q]=sn*vp+cs*vq; }
    }
  }
  const idx=[0,1,2].sort((a,b)=>A[b][b]-A[a][a]);
  return {c, val:idx.map(i=>A[i][i]), vec:idx.map(i=>[V[0][i],V[1][i],V[2][i]])};
}

/* A part as a cylinder: centre, axle, radius and how thick it is along the
   axle. The axle is the least-spread principal axis.

   That rule only holds for a SHORT cylinder. Turn a wheel into a long rod —
   a shaft, an axle, a 300 mm intake roller — and the least-spread axis is a
   radial one instead, so the part comes back claiming a radius of half its
   length. `round` is the guard: the two extents across the axle, smaller
   over larger. A disc reads ~1 there and a rod reads its aspect ratio, so
   one number separates the wheels from everything shaped like a stick. */
function dtWheelGeom(pts){
  const pr=dtPrincipal(pts);
  const ext=d=>{ let lo=Infinity, hi=-Infinity;
    for(const p of pts){ const v=(p[0]-pr.c[0])*d[0]+(p[1]-pr.c[1])*d[1]+(p[2]-pr.c[2])*d[2];
      if(v<lo) lo=v; if(v>hi) hi=v; }
    return hi-lo; };
  const a=ext(pr.vec[0]), b=ext(pr.vec[1]), big=Math.max(a,b);
  return {c:pr.c, axis:pr.vec[2], r:big/2, width:ext(pr.vec[2]), round:big>0?Math.min(a,b)/big:0};
}

function dtIsWheel(s){
  const n=String((s&&s.name)||"")+" "+String((s&&s.part)||"");
  if(DT_NOTWHEEL.test(n)) return false;
  return (s&&s.kind)==="wheel" || DT_WHEEL.test(n);
}

/* How far the axle leans out of the chassis Y axis, folded into 0..90 deg:
   0 for a normal side-by-side wheel, 45 for an X-drive, 90 for a wheel
   turned to face sideways. Sign-free, which matters because a principal
   axis has no sign. */
const dtSkew=ax=>Math.atan2(Math.abs(ax[0]),Math.abs(ax[1]));

/* Corners, only where they mean something: four wheels split two and two
   both ways. Anything else (three wheels, six wheels, a diamond) gets null
   rather than a corner that would then be used to place rollers. */
function dtCorners(ws){
  for(const w of ws) w.corner=null;
  if(ws.length!==4) return false;
  if(ws.filter(w=>w.y>0).length!==2 || ws.filter(w=>w.x>0).length!==2) return false;
  for(const w of ws) w.corner=(w.x>0?"F":"B")+(w.y>0?"L":"R");
  return true;
}

/* "Left"/"right" in a part name is the wheel's HAND only when the name
   isn't naming a corner — "Mecanum Wheel, Left" is a hand, "front left
   mecanum" is a position and says nothing about the rollers. */
function dtHandFromName(w){
  const n=(String(w.name||"")+" "+String(w.part||"")).toLowerCase();
  if(/front|back|rear|\bfl\b|\bfr\b|\bbl\b|\bbr\b/.test(n)) return 0;
  if(/\bleft\b|\blh\b|\bl-?hand\b/.test(n)) return 1;
  if(/\bright\b|\brh\b|\br-?hand\b/.test(n)) return -1;
  return 0;
}

const dtDiagonal=(ws,hand)=>{
  const plus=ws.filter((w,i)=>hand[i]>0).map(w=>w.corner).sort().join("");
  return plus==="BRFL" || plus==="BLFR";
};

/* Which way each mecanum wheel's rollers run: +1 when the roller axis goes
   front-left/back-right, -1 the other way. This is the one thing about a
   mecanum base that geometry at this resolution cannot see, so: names
   first, then two part numbers split across the diagonals, then the
   standard X pattern — and the why list always says which was used. */
function dtRollers(ws,why){
  const xPat=w=>(w.corner==="FL"||w.corner==="BR")?1:-1;
  const hand=ws.map(dtHandFromName);
  if(hand.every(h=>h!==0)){
    if(dtDiagonal(ws,hand)){
      ws.forEach((w,i)=>{ w.roller=hand[i]; });
      why.push("Roller handedness from the wheel names: left-hand wheels at "+
               ws.filter(w=>w.roller>0).map(w=>w.corner).sort().join(" and ")+".");
      return;
    }
    why.push("The wheel names give a handedness, but not on the diagonals - two wheels of the same hand sit on the same side, which would be a build error. Ignored in favour of the standard X pattern.");
  } else {
    const nums=[...new Set(ws.map(w=>w.part).filter(Boolean))];
    if(nums.length===2 && ws.every(w=>w.part)){
      const g=ws.map(w=>w.part===nums[0]?1:-1);
      if(g.filter(v=>v>0).length===2 && dtDiagonal(ws,g)){
        ws.forEach((w,i)=>{ w.roller=g[i]; });
        why.push("Roller handedness from the two wheel part numbers ("+nums.join(" and ")+"), which fall on the diagonals as a mecanum set should.");
        return;
      }
    }
  }
  ws.forEach(w=>{ w.roller=xPat(w); });
  why.push("Nothing in the wheel names or part numbers gives the roller handedness, so the standard X pattern is assumed: FL and BR one hand, FR and BL the other.");
}

/* A steered module has its actuator sitting on the wheel's axle line,
   above it. A drive motor for a fixed wheel is inboard or behind, not
   stacked on the axle, so this stays quiet on a normal base. */
function dtSteerers(ws,solids,F){
  const act=solids.filter(s=>(s.kind==="servo"||s.kind==="motor")&&s.pts&&s.pts.length>3);
  let n=0;
  for(const w of ws){
    w.steer=act.some(s=>{
      const c=dtCentroid(s.pts), d=[c[0]-w.c[0],c[1]-w.c[1],c[2]-w.c[2]];
      const up=dtDot(d,F.up);
      if(up<=0 || up>3.2*w.r) return false;
      return Math.hypot(dtDot(d,F.fwd),dtDot(d,F.left)) < 0.5*w.r;
    });
    if(w.steer) n++;
  }
  return n;
}

/* Give every wheel a drive-direction heading alpha (radians CCW from
   forward). A principal axis has no sign, so pick one: tangential for a
   kiwi, otherwise forward-ish, and flip the stored axle to match so the
   returned axis and alpha always agree. */
function dtOrient(ws,kind){
  for(const w of ws){
    let d=[w.ax[1],-w.ax[0]];                 // axle x up, in chassis axes
    let flip;
    if(kind==="omni"&&ws.length===3){ flip=(d[0]*-w.y+d[1]*w.x)<0; }   // counter-clockwise tangent
    else flip = d[0]<-1e-12 || (Math.abs(d[0])<=1e-12 && d[1]<0);
    if(flip){ d=[-d[0],-d[1]];
      w.ax=[-w.ax[0],-w.ax[1],-w.ax[2]];
      w.axis=[-w.axis[0],-w.axis[1],-w.axis[2]]; }
    w.alpha=Math.atan2(d[1],d[0]);
  }
}

/* Three wheels evenly round the centre, each axle pointing at it: a kiwi. */
function dtIsKiwi(ws){
  if(ws.length!==3) return false;
  const rad=ws.map(w=>Math.hypot(w.x,w.y));
  if(Math.min.apply(null,rad)<1e-4 || Math.max.apply(null,rad)/Math.min.apply(null,rad)>1.6) return false;
  const ang=ws.map(w=>Math.atan2(w.y,w.x)).sort((a,b)=>a-b);
  for(let i=0;i<3;i++){
    let d=ang[(i+1)%3]-ang[i]; if(d<0) d+=2*Math.PI;
    if(Math.abs(d-2*Math.PI/3)>25*Math.PI/180) return false;
  }
  // and each axle within 25 deg of radial (so the wheel rolls tangentially)
  return ws.every((w,i)=>{
    const L=Math.hypot(w.x,w.y), rx=w.x/L, ry=w.y/L;
    return Math.abs(w.ax[0]*rx+w.ax[1]*ry) > Math.cos(25*Math.PI/180)*Math.hypot(w.ax[0],w.ax[1]);
  });
}

function driveFromCAD(cad,opts){
  const why=[], F=dtFrame(opts);
  const nothing=msg=>{ why.push(msg); return {kind:"unknown",confidence:0,why,wheels:[],track:0,base:0,ik:[]}; };

  const solids=((cad&&cad.solids)||[]).filter(s=>s&&s.pts&&s.pts.length>3);
  if(!solids.length){
    const named=((cad&&cad.parts)||[]).filter(dtIsWheel);
    if(named.length) return nothing("The parts inventory names "+named.length+" wheel-like part(s) (\""+named[0].name+"\"), but the CAD carries no per-part geometry, so there is nothing to measure.");
    return nothing("The CAD has no part solids, so there is nothing to read a drivetrain from.");
  }
  const cand=solids.filter(dtIsWheel);
  if(!cand.length) return nothing("None of the "+solids.length+" parts in the CAD is classified as a wheel or named like one.");

  // ---- each candidate as a cylinder, with the obvious non-wheels dropped
  let ws=[], odd=0;
  for(const s of cand){
    const g=dtWheelGeom(s.pts);
    // 24 mm to 320 mm diameter, round across the axle, and wider across than along it
    if(!(g.r>0.012&&g.r<0.16) || g.round<0.75 || g.width>2.2*g.r){ odd++; continue; }
    ws.push({name:s.name||"", part:s.part||null, c:g.c, axis:g.axis, r:g.r, width:g.width,
             x:0, y:0, z:0, ax:[0,0,0], skew:0, roller:0, steer:false, corner:null, alpha:0});
  }
  if(odd) why.push(odd+" wheel-named part(s) are the wrong shape for a wheel (too small, too big, not round, or longer than they are wide) and were dropped.");
  if(ws.length<2) return nothing("Only "+ws.length+" wheel-shaped solid"+(ws.length===1?"":"s")+" in the CAD; a drive base needs at least two.");

  // Drive wheels all sit at one height. Anything well above the lowest ring
  // of them is an intake roller or a flywheel, not part of the base.
  const rmax=Math.max.apply(null,ws.map(w=>w.r));
  const lift=ws.map(w=>dtDot(w.c,F.up)), lo=Math.min.apply(null,lift);
  const low=ws.filter((w,i)=>lift[i]<=lo+Math.max(0.03,0.6*rmax));
  if(low.length>=2 && low.length<ws.length){
    why.push((ws.length-low.length)+" wheel-shaped part(s) sit more than "+(Math.max(0.03,0.6*rmax)*1000).toFixed(0)+" mm above the lowest wheels, so they were read as rollers rather than drive wheels.");
    ws=low;
  }

  // ---- chassis-frame positions, axles and skews
  const mid=dtCentroid(ws.map(w=>w.c));
  for(const w of ws){
    const d=[w.c[0]-mid[0], w.c[1]-mid[1], w.c[2]-mid[2]];
    w.x=dtDot(d,F.fwd); w.y=dtDot(d,F.left); w.z=dtDot(d,F.up);
    w.ax=[dtDot(w.axis,F.fwd), dtDot(w.axis,F.left), dtDot(w.axis,F.up)];
    w.skew=dtSkew(w.ax);
  }
  ws.sort((a,b)=>(b.x-a.x)||(b.y-a.y));
  const square=dtCorners(ws);
  const steered=dtSteerers(ws,solids,F);
  const track=Math.max.apply(null,ws.map(w=>w.y))-Math.min.apply(null,ws.map(w=>w.y));
  const base=Math.max.apply(null,ws.map(w=>w.x))-Math.min.apply(null,ws.map(w=>w.x));
  const skewMax=Math.max.apply(null,ws.map(w=>w.skew));
  const parallel=skewMax<15*Math.PI/180;
  const diag45=ws.every(w=>Math.abs(w.skew-Math.PI/4)<15*Math.PI/180);

  why.push(ws.length+" wheels, radius "+(Math.min.apply(null,ws.map(w=>w.r))*1000).toFixed(0)+"-"+(rmax*1000).toFixed(0)+" mm, track "+(track*1000).toFixed(0)+" mm, wheelbase "+(base*1000).toFixed(0)+" mm.");
  why.push("Axles from the point clouds lean "+dtDeg(Math.min.apply(null,ws.map(w=>w.skew))).toFixed(1)+"-"+dtDeg(skewMax).toFixed(1)+" deg off the chassis Y axis.");

  // ---- the name evidence, which beats geometry when it exists
  const txt=ws.map(w=>w.name+" "+(w.part||""));
  const say=re=>txt.filter(t=>re.test(t)).length;
  const nMec=say(/mecanum/i), nOmni=say(/omni/i), nTrac=say(/traction|tread|\bgrip(py)?\b|rubber tread/i), nSw=say(/swerve/i);
  const half=ws.length/2;

  let kind="unknown", conf=0;
  if(nSw>=half){ kind="swerve"; conf=DT_CONF.name; why.push(nSw+" of "+ws.length+" wheel parts are named as swerve modules."); }
  else if(nMec>=half && ws.length>=3){ kind="mecanum"; conf=DT_CONF.name; why.push(nMec+" of "+ws.length+" wheel parts are named mecanum."); }
  else if(nOmni>=half){
    kind=diag45&&ws.length===4?"x":"omni"; conf=DT_CONF.nameOmni;
    why.push(nOmni+" of "+ws.length+" wheel parts are named omni, and their axles are "+(kind==="x"?"at 45 deg to the chassis, so it is an X-drive.":"not at 45 deg, so it is read as a plain omni base."));
  }
  else if(steered>=Math.max(2,ws.length-1)){ kind="swerve"; conf=DT_CONF.swerveGeom; why.push(steered+" of "+ws.length+" wheels have a servo or motor sitting on the axle line above them, which is a steered module."); }
  else if(nTrac>=half && parallel){ kind="tank"; conf=DT_CONF.name; why.push(nTrac+" of "+ws.length+" wheel parts are named as traction or tread wheels, and the axles are parallel: a tank base."); }
  else if(diag45&&ws.length===4){ kind="x"; conf=DT_CONF.x; why.push("Four wheels with every axle within 15 deg of 45 deg to the chassis: an X-drive."); }
  else if(dtIsKiwi(ws)){ kind="omni"; conf=DT_CONF.kiwi; why.push("Three wheels 120 deg apart with radial axles: a kiwi base."); }
  else if(parallel&&ws.length===2){ kind="tank"; conf=DT_CONF.tank2; why.push("Two wheels with parallel axles: a differential base."); }
  else if(parallel&&ws.length>=6){ kind="tank"; conf=DT_CONF.tank6; why.push(ws.length+" wheels with parallel axles, too many for a mecanum set: read as a "+ws.length+"-wheel tank base."); }
  else if(parallel&&ws.length===4&&square){
    kind="tank"; conf=DT_CONF.tank4;
    why.push("Four parallel axles at the corners of a rectangle. A mecanum wheel and a traction wheel are the same cylinder at this resolution, so tank is the answer only because nothing is named mecanum - tank is the conservative guess, since giving a robot strafe it does not have is the worse mistake. Rename the wheels, or say so in the panel, to settle it.");
  }
  else {
    why.push("The "+ws.length+" wheels found do not fall into any drivetrain this bench knows: axles "+dtDeg(skewMax).toFixed(0)+" deg apart at most"+(square?"":", and not two-and-two at the corners")+".");
    dtOrient(ws,"unknown");
    return {kind:"unknown", confidence:0, why, wheels:ws.map(dtPublic), track, base, ik:[]};
  }

  if(kind==="mecanum"){
    if(square) dtRollers(ws,why);
    else why.push("The mecanum wheels are not two-and-two at the corners, so the roller handedness cannot be placed; they are modelled as plain wheels until the layout is corrected.");
  }
  dtOrient(ws,kind);
  if(kind==="x"&&square){
    const alt=ws.every(w=>(w.corner==="FL"||w.corner==="BR")===(w.alpha<0));
    if(!alt) why.push("The X-drive wheel angles do not alternate FL/BR against FR/BL the way a working X-drive does; the kinematics use the angles as modelled.");
  }
  if(kind==="swerve") why.push("Swerve kinematics here are the linearisation at the module angles in the CAD, not a full steering model: each row is that module's drive direction as drawn.");

  const wheels=ws.map(dtPublic);
  return {kind, confidence:conf, why, wheels, track, base, ik:ikMatrix(kind,wheels)};
}

const dtPublic=w=>({name:w.name, part:w.part, x:w.x, y:w.y, z:w.z, r:w.r,
                    axis:w.axis.slice(), alpha:w.alpha, roller:w.roller, steer:!!w.steer, corner:w.corner});

/* Inverse kinematics: one row per wheel, surface speed from chassis twist.

   A mecanum wheel's rollers let the contact point slide along one 45-degree
   line, so with k = +1/-1 for the two hands the constraint works out at
   v = vx - k*vy - omega*(y + k*x) — the [1,-1,-(lx+ly)] / [1,1,(lx+ly)]
   rows, with each wheel's own position in place of lx and ly.

   Everything else is a wheel that only rolls along its own heading alpha,
   which covers tank (alpha 0, so the strafe column is zero and the base
   cannot strafe), X-drive (alpha +-45 deg, which is exactly the mecanum
   rows turned 45 degrees and scaled by 1/sqrt(2)), kiwi, and a swerve
   module frozen at the angle it is drawn in. */
function ikMatrix(kind,wheels){
  const out=[];
  for(const w of (wheels||[])){
    const x=Number(w.x)||0, y=Number(w.y)||0;
    if(kind==="mecanum"){
      const k=Number(w.roller)||0;            // 0: handedness unknown, so it rolls like a traction wheel
      out.push([1,-k,-(y+k*x)]);
    } else {
      const a=Number(w.alpha)||0, ca=Math.cos(a), sa=Math.sin(a);
      out.push([ca,sa,x*sa-y*ca]);
    }
  }
  return out;
}

function dtInv3(A){
  const c=[[A[1][1]*A[2][2]-A[1][2]*A[2][1], A[0][2]*A[2][1]-A[0][1]*A[2][2], A[0][1]*A[1][2]-A[0][2]*A[1][1]],
           [A[1][2]*A[2][0]-A[1][0]*A[2][2], A[0][0]*A[2][2]-A[0][2]*A[2][0], A[0][2]*A[1][0]-A[0][0]*A[1][2]],
           [A[1][0]*A[2][1]-A[1][1]*A[2][0], A[0][1]*A[2][0]-A[0][0]*A[2][1], A[0][0]*A[1][1]-A[0][1]*A[1][0]]];
  const det=A[0][0]*c[0][0]+A[0][1]*c[1][0]+A[0][2]*c[2][0];
  if(!isFinite(det)||Math.abs(det)<1e-300) return [[0,0,0],[0,0,0],[0,0,0]];
  for(let i=0;i<3;i++) for(let j=0;j<3;j++) c[i][j]/=det;
  return c;
}

/* Forward kinematics: the least-squares inverse of ik, 3 x N, so that a set
   of measured wheel speeds becomes the chassis twist that best explains
   them. Normal equations, (M'M + lambda I)^-1 M', with lambda tiny and
   scaled to the matrix — a tank base has an all-zero strafe column, so M'M
   is singular there and the ridge is what keeps it invertible. Because the
   strafe column really is zero, the vy row comes back zero: the base cannot
   strafe and the fit says so instead of inventing a value. */
function fkFromIk(M){
  const rows=M||[], N=rows.length, A=[[0,0,0],[0,0,0],[0,0,0]];
  for(const r of rows) for(let i=0;i<3;i++) for(let j=0;j<3;j++) A[i][j]+=(Number(r[i])||0)*(Number(r[j])||0);
  const lam=1e-12*(A[0][0]+A[1][1]+A[2][2])+1e-18;
  for(let i=0;i<3;i++) A[i][i]+=lam;
  const inv=dtInv3(A), out=[[],[],[]];
  for(let i=0;i<3;i++) for(let n=0;n<N;n++){
    let s=0; for(let j=0;j<3;j++) s+=inv[i][j]*(Number(rows[n][j])||0);
    out[i][n]=s;
  }
  return out;
}

/* Wheel surface speeds, m/s, for a commanded chassis twist. */
function wheelSpeeds(ik,vx,vy,w){
  return (ik||[]).map(r=>(Number(r[0])||0)*vx+(Number(r[1])||0)*vy+(Number(r[2])||0)*w);
}

/* And back: the chassis twist that best fits measured wheel speeds. */
function chassisFromWheels(fk,v){
  const row=i=>{ const r=(fk&&fk[i])||[]; let s=0;
    for(let n=0;n<r.length;n++) s+=r[n]*(Number(v&&v[n])||0); return s; };
  return {vx:row(0), vy:row(1), omega:row(2)};
}
