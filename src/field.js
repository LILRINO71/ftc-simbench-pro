/* ============================================================
   7a.  FIELD — FTC 2026-27 BIOBUZZ

   Built from the BIOBUZZ Shot Sim's measured field data and HIVE model
   (vendor/biobuzz-shot-sim), so the field the robot drives on and the
   shot physics agree to the inch. The frame is the Shot Sim's, in metres:
   origin at the field centre on the tile tops, +x toward the blue
   alliance wall, +y away from the audience, +z up, headings
   counter-clockwise from +x. Sim.chassis lives in this frame.
   ============================================================ */
const IN=0.0254;
const TIP_GRAMS=190;             // EFSG 12.3: 174 g placed must not TIP, 199 g launched must
const ELEMENT_G={pollen:24.9, nectar:41.3};
const FRONTS={"+x":0, "+y":-Math.PI/2, "-x":Math.PI, "-y":Math.PI/2};

const Field={
  E:null, data:null, ok:false, version:0,
  hive:{red:-1, blue:1},          // side each HIVE's up-CELL faces: -1 audience, +1 far
  cells:{red:[], blue:[]},        // what sits in each up-CELL right now
  tips:{red:0, blue:0}, lastTip:null,

  init(engine,data){
    this.E=null; this.data=null; this.ok=false;
    try{
      if(!engine||!data||!data.field||!data.field.field) return false;
      const r=engine.init(data);
      if(!r||!r.ok) return false;
    }catch(e){ return false; }
    this.E=engine; this.data=data; this.ok=true;
    this.reset();
    return true;
  },
  /* Match start: up-CELLs as staged, each holding 3 NECTAR of its own colour. */
  reset(){
    if(!this.ok) return;
    const s=this.data.field.hive.upSideStart;
    this.hive={red:s.red, blue:s.blue};
    this.cells={red:[], blue:[]};
    for(const al of ["red","blue"]) for(let i=0;i<3;i++) this.cells[al].push({kind:"nectar", color:al});
    this.tips={red:0, blue:0}; this.lastTip=null;
    this._hm=null; this.version++;
  },
  half(){ return this.ok ? this.data.field.field.half*IN : 1.83; },
  wallH(){ return this.ok ? this.data.field.field.wallHeight*IN : 0.31; },
  model(){
    const key=this.hive.red+","+this.hive.blue;
    if(!this._hm||this._hmKey!==key){ this._hm=this.E.hiveModel({red:this.hive.red, blue:this.hive.blue}); this._hmKey=key; }
    return this._hm;
  },
  grams(al){ return this.cells[al].reduce((g,e)=>g+(ELEMENT_G[e.kind]||0),0); },
  /* An element lands in an up-CELL. Past the TIP mass the HIVE swings over:
     that CELL goes down and spills on its own side, the other comes up empty. */
  addToCell(al,kind,color){
    this.cells[al].push({kind, color:color||al});
    if(this.grams(al)>=TIP_GRAMS){ this.tip(al); return true; }
    this.version++;
    return false;
  },
  tip(al){
    const from=this.hive[al];
    this.hive[al]=-from;
    this.cells[al]=[];
    this.tips[al]++;
    this.lastTip={al, from, to:-from, n:this.tips[al]};
    this.version++;
  },

  /* Legal start (G304): own side, touching the alliance wall, facing the field,
     clear of the LOADING ZONE and the FLOWER on that wall. */
  startPose(alliance,fp){
    const H=this.half(), s=alliance==="blue"?1:-1;
    const hx=(fp&&fp.hx)||0.2286;
    return {x:s*(H-hx), y:0, h:alliance==="blue"?Math.PI:0};
  },

  /* Things a robot can't drive through, flattened to 2-D capsules at the
     height the robot reaches (the HIVE legs lean inward, so a taller robot
     meets them further in). */
  obstacles(robotH){
    if(!this.ok) return [];
    const F=this.data.field, fr=F.hive.frame, out=[];
    const reach=Math.max(0.05,Math.min(robotH||0.35, 0.74))/IN;
    for(const leg of fr.legs){
      const a=leg[0][2]<=leg[1][2]?leg[0]:leg[1], b=a===leg[0]?leg[1]:leg[0];
      const t=Math.min(1, reach/Math.max(1e-6,b[2]-a[2]));
      out.push({what:"HIVE leg", r:fr.tubeRadius*IN,
        a:[a[0]*IN, a[1]*IN], b:[(a[0]+(b[0]-a[0])*t)*IN, (a[1]+(b[1]-a[1])*t)*IN]});
    }
    if(fr.footBars) for(const sg of fr.footBars.segments)
      out.push({what:"HIVE foot bar", r:(fr.footBars.width/2)*IN, a:[sg[0][0]*IN, sg[0][1]*IN], b:[sg[1][0]*IN, sg[1][1]*IN]});
    const H=F.field.half;
    for(const fl of F.flowers){
      // a box against the wall, as a capsule along the wall
      const along=fl.wall==="+y"||fl.wall==="-y", sgn=fl.wall.charAt(0)==="+"?1:-1;
      const across=sgn*(H-fl.depth/2), half=Math.max(0,(fl.alongWall-fl.depth)/2);
      const c=along?[fl.x,across]:[across,fl.y];
      const a=along?[c[0]-half,c[1]]:[c[0],c[1]-half], b=along?[c[0]+half,c[1]]:[c[0],c[1]+half];
      out.push({what:"FLOWER", r:fl.depth/2*IN, a:[a[0]*IN,a[1]*IN], b:[b[0]*IN,b[1]*IN]});
    }
    return out;
  },

  /* Keep the chassis on the field: walls exactly (the rotated footprint's
     extent), obstacles by pushing out along the shallowest direction.
     Returns what it hit, or null. Mutates ch. */
  collide(ch,fp,obs){
    let hit=null;
    for(let pass=0; pass<3; pass++){
      const H=this.half(), c=Math.abs(Math.cos(ch.h)), s=Math.abs(Math.sin(ch.h));
      const ex=c*fp.hx+s*fp.hy, ey=s*fp.hx+c*fp.hy;
      const nx=Math.max(-H+ex,Math.min(H-ex,ch.x)), ny=Math.max(-H+ey,Math.min(H-ey,ch.y));
      if(nx!==ch.x||ny!==ch.y){ ch.x=nx; ch.y=ny; hit=hit||"wall"; }
      let moved=false;
      for(const o of obs||[]){
        const d=capsulePush(ch,fp,o);
        if(d){ ch.x+=d[0]; ch.y+=d[1]; hit=hit||o.what; moved=true; }
      }
      if(!moved) break;
    }
    return hit;
  },

  /* Which zone a point is in, for the pose readout. Inches in, name out. */
  zoneAt(xIn,yIn){
    if(!this.ok) return null;
    const F=this.data.field;
    for(const al of ["red","blue"]){
      const z=F.loadingZones[al];
      if(xIn>=z.x0&&xIn<=z.x1&&yIn>=z.y0&&yIn<=z.y1) return al+" LOADING ZONE";
    }
    const fr=F.hive.frame;
    if(Math.abs(xIn)<=fr.baseX/2&&Math.abs(yIn)<=fr.baseY/2) return "under the HIVEs";
    return xIn<0?"red side":"blue side";
  }
};

/* How far to move an oriented rectangle (the robot) so a capsule no longer
   overlaps it. Works in the robot's own frame, then rotates back. */
function capsulePush(ch,fp,o){
  const c=Math.cos(ch.h), s=Math.sin(ch.h);
  const toL=p=>{ const dx=p[0]-ch.x, dy=p[1]-ch.y; return [dx*c+dy*s, -dx*s+dy*c]; };
  const A=toL(o.a), B=toL(o.b), dx=B[0]-A[0], dy=B[1]-A[1], L2=dx*dx+dy*dy;
  // quick reject: capsule's box against the footprint
  if(Math.min(A[0],B[0])-o.r>fp.hx||Math.max(A[0],B[0])+o.r<-fp.hx||
     Math.min(A[1],B[1])-o.r>fp.hy||Math.max(A[1],B[1])+o.r<-fp.hy) return null;
  const ts=[0,1];
  for(let i=1;i<16;i++) ts.push(i/16);
  if(L2>1e-12){
    for(const q of [[fp.hx,fp.hy],[fp.hx,-fp.hy],[-fp.hx,fp.hy],[-fp.hx,-fp.hy],[0,0]])
      ts.push(Math.max(0,Math.min(1,((q[0]-A[0])*dx+(q[1]-A[1])*dy)/L2)));
  }
  let best=null, pen=0;
  for(const t of ts){
    const px=A[0]+dx*t, py=A[1]+dy*t;
    const qx=Math.max(-fp.hx,Math.min(fp.hx,px)), qy=Math.max(-fp.hy,Math.min(fp.hy,py));
    const ex=qx-px, ey=qy-py, d=Math.hypot(ex,ey);
    let p, ux, uy;
    if(d>1e-9){ p=o.r-d; ux=ex/d; uy=ey/d; }
    else{
      const ox=fp.hx-Math.abs(px), oy=fp.hy-Math.abs(py);
      if(ox<oy){ p=ox+o.r; ux=px>0?-1:1; uy=0; } else { p=oy+o.r; ux=0; uy=py>0?-1:1; }
    }
    if(p>pen){ pen=p; best=[ux,uy]; }
  }
  if(!best) return null;
  return [(best[0]*c-best[1]*s)*pen, (best[0]*s+best[1]*c)*pen];
}

/* The robot's footprint in its own frame (forward = +x) from the CAD box,
   which way the CAD's front faces, and the drive base under it if any. */
function footprintOf(cad,front,base){
  const b=cad&&cad.bbox;
  let fp={hx:0.2286, hy:0.2286, h:0.35};
  if(b){
    const ex=Math.max(0.05,(b.max[0]-b.min[0])/2), ey=Math.max(0.05,(b.max[1]-b.min[1])/2);
    const side=/y/.test(front||"+x");
    fp={hx:side?ey:ex, hy:side?ex:ey, h:Math.max(0.05,b.max[2]-b.min[2])};
  }
  if(base) fp={hx:Math.max(fp.hx,base.L/2), hy:Math.max(fp.hy,base.W/2), h:fp.h+base.H};
  return fp;
}

/* A drive base drawn under the CAD when the code drives but the CAD has no
   wheels — a CAD of just an arm still becomes a robot you can drive. */
const BASE_H=0.078;
function robotBase(cad,drivetrain,mode,front){
  if(mode==="hide") return null;
  const hasWheels=((cad&&cad.parts)||[]).some(p=>/wheel|mecanum|omni|traction/i.test(p.name||""));
  if(mode!=="show"&&(hasWheels||!(drivetrain&&drivetrain.ok))) return null;
  const f=footprintOf(cad,front,null), cl=(v,a,b)=>Math.max(a,Math.min(b,v));
  return {L:cl(2*f.hx,0.38,0.457), W:cl(2*f.hy,0.34,0.457), H:BASE_H, wheelR:0.052, wheelW:0.038,
          style:(drivetrain&&drivetrain.style)||"mecanum"};
}
