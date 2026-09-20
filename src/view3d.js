/* ============================================================
   8.  3D VIEW — the BIOBUZZ field and the robot, driven by the sim
   The field floor is y = 0. The robot is its CAD parts drawn as solids,
   on a drawn drive base when the CAD has no wheels of its own, with a
   drawn flywheel shooter when the code shoots and the CAD has none.
   ============================================================ */
const FIELD_COL={tile:0x303336, seam:0x474b50, ground:0x0e0c09, alu:0xa9b0b8, rail:0x7c848d, poly:0xc9d8e3,
  red:0xe0453c, blue:0x2f7dea, redTape:0xd8372f, blueTape:0x2a6ad8, pollen:0xf2c230, flower:0xe4e7ea,
  arm:0x4a4f55, logo:0x1b1d20, honey:0xf2b230};
const ROBOT_MAT={
  metal:{color:0xa9b1ba, metalness:0.55, roughness:0.42},
  motor:{color:0x2b2d31, metalness:0.45, roughness:0.45},
  servo:{color:0x1b1c1f, metalness:0.1, roughness:0.62},
  wheel:{color:0x35373b, metalness:0.05, roughness:0.9},
  electronics:{color:0x26282c, metalness:0.2, roughness:0.6},
  clear:{color:0xd6e6f0, metalness:0, roughness:0.1, transparent:true, opacity:0.3, depthWrite:false},
  printed:{color:0xe6a52a, metalness:0, roughness:0.55},
  fastener:{color:0x5a5e64, metalness:0.7, roughness:0.35},
  belt:{color:0x161616, metalness:0, roughness:0.95},
  yellow:{color:0xf2b230, metalness:0.3, roughness:0.45},
  hub:{color:0x1f2023, metalness:0.2, roughness:0.55},
  orange:{color:0xe8702a, metalness:0.1, roughness:0.5}
};
const View={
  init(el){
    this.el=el;
    this.scene=new THREE.Scene();
    this.cam=new THREE.PerspectiveCamera(42,1,0.01,200);
    this.ren=new THREE.WebGLRenderer({antialias:true});
    this.ren.setPixelRatio(Math.min(devicePixelRatio,2));
    this.ren.setClearColor(0x000000,0);
    this.ren.shadowMap.enabled=true;
    this.ren.shadowMap.type=THREE.PCFSoftShadowMap;
    el.appendChild(this.ren.domElement);
    this.scene.add(new THREE.HemisphereLight(0xfff3dc,0x1d1a15,0.72));
    const sun=new THREE.DirectionalLight(0xfff6e8,0.8);
    sun.position.set(-2.2,5.5,3.0); sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);
    const sc=sun.shadow.camera; sc.left=-3.2; sc.right=3.2; sc.top=3.2; sc.bottom=-3.2; sc.near=1; sc.far=14;
    sun.shadow.bias=-0.0004; sun.shadow.normalBias=0.02;
    this.scene.add(sun); this.scene.add(sun.target);
    this.world=new THREE.Group(); this.scene.add(this.world);
    this.ray=new THREE.Raycaster();
    this.theta=-0.7; this.phi=1.15; this.rad=0.95; this.size=0.5;
    this.bind(); this.resize();
  },
  /* Drag the robot to move it, shift- or right-drag to turn it; drag
     anywhere else to orbit, wheel to zoom. */
  bind(){
    const c=this.ren.domElement; let orbit=false,lx=0,ly=0;
    c.addEventListener("contextmenu",e=>e.preventDefault());
    c.addEventListener("pointerdown",e=>{
      c.setPointerCapture(e.pointerId);
      if(this.onRobotDrag&&this.hitsRobot(e)){
        const f=this.floorAt(e);
        if(f){ const ch=Sim.chassis;
          this.drag={turn:e.shiftKey||e.button===2, fx:f.x, fy:f.y, x0:ch.x, y0:ch.y, h0:ch.h, a0:Math.atan2(f.y-ch.y,f.x-ch.x)};
          this.setCursor("grabbing"); return; }
      }
      orbit=true; lx=e.clientX; ly=e.clientY; this.setCursor("grabbing");
    });
    const end=()=>{ orbit=false;
      if(this.drag){ this.drag=null; if(this.onRobotDrop) this.onRobotDrop(); }
      this.setCursor(this.hover?"move":"grab"); };
    c.addEventListener("pointerup",end); c.addEventListener("pointercancel",end);
    c.addEventListener("pointermove",e=>{
      if(this.drag){
        const f=this.floorAt(e), d=this.drag; if(!f) return;
        if(d.turn) this.onRobotDrag({x:d.x0, y:d.y0, h:d.h0+Math.atan2(f.y-d.y0,f.x-d.x0)-d.a0});
        else this.onRobotDrag({x:d.x0+f.x-d.fx, y:d.y0+f.y-d.fy, h:d.h0});
        return;
      }
      if(orbit){
        this.theta-=(e.clientX-lx)*0.008;
        this.phi=Math.max(0.08,Math.min(3.05,this.phi-(e.clientY-ly)*0.008));
        lx=e.clientX; ly=e.clientY; return;
      }
      const now=performance.now(); if(now-(this.hoverT||0)<50) return; this.hoverT=now;
      const over=!!(this.onRobotDrag&&this.hitsRobot(e));
      if(over!==this.hover){ this.hover=over; this.setCursor(over?"move":"grab"); if(this.onHover) this.onHover(over); }
    });
    c.addEventListener("wheel",e=>{ e.preventDefault();
      this.rad=Math.max(0.12,Math.min(24,this.rad*(1+Math.sign(e.deltaY)*0.09))); },{passive:false});
    addEventListener("resize",()=>this.resize());
  },
  setCursor(k){ this.ren.domElement.style.cursor=k; },
  resize(){ const w=this.el.clientWidth,h=this.el.clientHeight; if(!w||!h) return;
    this.cam.aspect=w/h; this.cam.updateProjectionMatrix(); this.ren.setSize(w,h,false); },
  ndc(e){ const r=this.ren.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1); },
  hitsRobot(e){
    if(!this.hitBox||!this.cam) return false;
    this.ray.setFromCamera(this.ndc(e),this.cam);
    return this.ray.intersectObject(this.hitBox,false).length>0;
  },
  /* Where the pointer meets the tiles, in field metres. */
  floorAt(e){
    this.ray.setFromCamera(this.ndc(e),this.cam);
    const o=this.ray.ray.origin, d=this.ray.ray.direction;
    if(Math.abs(d.y)<1e-6) return null;
    const t=-o.y/d.y; if(t<0) return null;
    return {x:o.x+d.x*t, y:-(o.z+d.z*t)};
  },

  /* robot CAD (Z-up, metres) → view (Y-up), centred on the CAD box */
  v3(p){ return new THREE.Vector3(p[0]-this.c[0], p[2]-this.c[2], -(p[1]-this.c[1])); },
  vAxis(a){ return new THREE.Vector3(a[0],a[2],-a[1]).normalize(); },
  /* field frame (inches, Z-up) → view */
  fv(p){ return new THREE.Vector3(p[0]*IN, p[2]*IN, -p[1]*IN); },

  load(cad){
    while(this.world.children.length){ const o=this.world.children[0]; this.world.remove(o); this.dispose(o); }
    const bb=cad.bbox;
    this.c=[0,1,2].map(i=>(bb.min[i]+bb.max[i])/2);
    const size=Math.max(bb.max[0]-bb.min[0],bb.max[1]-bb.min[1],bb.max[2]-bb.min[2])||0.5;
    this.size=size; this.cad=cad;
    this.floorY=0;
    this.lift0=this.c[2]-bb.min[2];            // the CAD's centre above its own bottom
    this.look=null;

    this.fieldG=new THREE.Group(); this.world.add(this.fieldG);
    this.hiveG={}; this.shownHive=null; this.tipAnim=null; this.shownCells=-1;
    if(Field.ok) this.buildField(); else this.buildPlainField();
    this.dynG=new THREE.Group(); this.world.add(this.dynG);
    this.ballPool=[]; this.arcLine=null;

    // everything that drives around; the CAD sits in frontG, raised onto the base
    this.chassisG=new THREE.Group(); this.world.add(this.chassisG);
    this.frontG=new THREE.Group(); this.chassisG.add(this.frontG);
    this.liftG=new THREE.Group(); this.liftG.position.y=this.lift0; this.frontG.add(this.liftG);
    this.front=null; this.footG=null; this.hitBox=null;
    this.baseG=null; this.baseKey=null; this.wheels=[];
    this.shooterG=null; this.shooterKey=null; this.fly=null;
    this.buildRobot(cad);
    this.rad=Math.max(size,0.46)*1.9;
  },
  turretScale:0.55, alliance:"red",

  robotMat(k){
    this._rmat=this._rmat||{};
    if(!this._rmat[k]){ const m=new THREE.MeshStandardMaterial(Object.assign({},ROBOT_MAT[k]||ROBOT_MAT.metal));
      m.userData.shared=true; this._rmat[k]=m; }
    return this._rmat[k];
  },
  /* The robot's own parts, grouped by the mechanism that moves them. */
  buildRobot(cad){
    const bb=cad.bbox, size=this.size, M=cad.mechs;
    const distSeg=(p,a,b)=>{
      const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
      const L2=ab[0]*ab[0]+ab[1]*ab[1]+ab[2]*ab[2];
      let t=0;
      if(L2>1e-12) t=Math.max(0,Math.min(1,((p[0]-a[0])*ab[0]+(p[1]-a[1])*ab[1]+(p[2]-a[2])*ab[2])/L2));
      const q=[a[0]+ab[0]*t, a[1]+ab[1]*t, a[2]+ab[2]*t];
      return Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
    };
    /* every link's own span: its pivot out to whatever it carries */
    const segs=M.filter(m=>m.pivot).map(m=>({id:m.id, m, a:m.pivot, b:m.distalTo||m.pivot}));
    /* Points far out from a root joint's axis are frame, not turret — they
       stay behind while the column above the joint swings. */
    const radialTo=(p,m)=>{
      const a=m.pivot, ax=m.axis;
      const d=[p[0]-a[0],p[1]-a[1],p[2]-a[2]];
      const t=d[0]*ax[0]+d[1]*ax[1]+d[2]*ax[2];
      return Math.hypot(d[0]-ax[0]*t, d[1]-ax[1]*t, d[2]-ax[2]*t);
    };
    const owner=p=>{
      if(!segs.length) return "chassis";
      let best=null, bd=1e9;
      for(const s of segs){ const d=distSeg(p,s.a,s.b); if(d<bd){bd=d; best=s;} }
      let id=best.id; const m=best.m;
      // a leaf effector only claims what is genuinely near it
      if(!rigKids(M,m.id).length && m.lever>0 && bd>m.lever*0.55 && m.parent!=="chassis") id=m.parent;
      // and a root joint only carries what sits inside its turret radius
      const root=M.filter(x=>x.id===id)[0];
      if(root && root.parent==="chassis" && root.kind==="revolute-yaw"){
        const turretR=Math.max(size*0.10, (root.lever||size*0.3)*this.turretScale);
        if(radialTo(p,root)>turretR) id="chassis";
      }
      return id;
    };
    const groups={chassis:[]};
    M.forEach(m=>groups[m.id]=[]);
    const solids=cad.solids&&cad.solids.length?cad.solids:null;
    if(solids){
      for(const s of solids){
        const c=[0,0,0]; for(const p of s.pts){ c[0]+=p[0]; c[1]+=p[1]; c[2]+=p[2]; }
        (groups[owner(c.map(v=>v/s.pts.length))]||groups.chassis).push(s);
      }
    }else{
      const pts=cad.points||[], stride=Math.max(1,Math.ceil(pts.length/110000));
      for(let i=0;i<pts.length;i+=stride) (groups[owner(pts[i])]||groups.chassis).push(pts[i]);
    }

    // solids of one group merged by material, a handful of draw calls per link
    const mkSolids=list=>{
      const byKind={};
      for(const s of list){
        if(!s.tri) s.tri=solidTriangles(s.pts)||{pos:[],nor:[]};
        (byKind[s.kind||"metal"]=byKind[s.kind||"metal"]||[]).push(s.tri);
      }
      const g=new THREE.Group();
      for(const k in byKind){
        let n=0; for(const t of byKind[k]) n+=t.pos.length; if(!n) continue;
        const pos=new Float32Array(n), nor=new Float32Array(n); let o=0;
        for(const t of byKind[k]) for(let i=0;i<t.pos.length;i+=3){
          pos[o]=t.pos[i]-this.c[0]; pos[o+1]=t.pos[i+2]-this.c[2]; pos[o+2]=-(t.pos[i+1]-this.c[1]);
          nor[o]=t.nor[i]; nor[o+1]=t.nor[i+2]; nor[o+2]=-t.nor[i+1]; o+=3;
        }
        const geo=new THREE.BufferGeometry();
        geo.setAttribute("position",new THREE.BufferAttribute(pos,3));
        geo.setAttribute("normal",new THREE.BufferAttribute(nor,3));
        const mesh=new THREE.Mesh(geo,this.robotMat(k)); mesh.castShadow=true; mesh.receiveShadow=true;
        g.add(mesh);
      }
      return g;
    };
    const mkPoints=list=>{
      const n=list.length; if(!n) return null;
      const pos=new Float32Array(n*3), col=new Float32Array(n*3);
      const zmin=bb.min[2], zspan=(bb.max[2]-zmin)||1;
      for(let i=0;i<n;i++){
        const v=this.v3(list[i]);
        pos[i*3]=v.x; pos[i*3+1]=v.y; pos[i*3+2]=v.z;
        const t=0.62+0.5*Math.max(0,Math.min(1,(list[i][2]-zmin)/zspan));
        col[i*3]=0.74*t; col[i*3+1]=0.72*t; col[i*3+2]=0.68*t;
      }
      const g=new THREE.BufferGeometry();
      g.setAttribute("position",new THREE.BufferAttribute(pos,3));
      g.setAttribute("color",new THREE.BufferAttribute(col,3));
      return new THREE.Points(g,new THREE.PointsMaterial({size:size*0.0042,vertexColors:true,sizeAttenuation:true}));
    };
    const mk=list=>solids?mkSolids(list):mkPoints(list);

    const chas=mk(groups.chassis); if(chas) this.liftG.add(chas);

    /* ---- the hierarchy from the rig, whatever shape it is ---- */
    this.jawSets=[]; this.markers=[];
    const markMat=new THREE.MeshBasicMaterial({color:FIELD_COL.honey});
    const buildLink=(mech,parentInv)=>{
      const g=new THREE.Group();  g.position.copy(this.v3(mech.pivot));
      const inv=new THREE.Group(); inv.position.copy(this.v3(mech.pivot).clone().multiplyScalar(-1));
      g.add(inv); parentInv.add(g);
      mech._g=g; mech._inv=inv;
      const p=mk(groups[mech.id]||[]); if(p) inv.add(p);
      if(mech.kind!=="fixed"){
        const s=new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.006,size*0.014),12,8),markMat);
        s.position.copy(this.v3(mech.pivot)); inv.add(s); this.markers.push(s);
      }
      if(mech.kind==="effector"){
        const par=M.filter(x=>x.id===mech.parent)[0];
        const from=par?par.pivot:[mech.pivot[0],mech.pivot[1],mech.pivot[2]-size*0.1];
        const reach=Math.max(size*0.05, Math.hypot(
          mech.pivot[0]-from[0],mech.pivot[1]-from[1],mech.pivot[2]-from[2])*0.30);
        const o=this.v3(mech.pivot);
        const dir=this.v3(mech.pivot).sub(this.v3(from)).normalize();
        if(!isFinite(dir.x)||dir.length()<0.1) dir.set(0,1,0);
        const side=new THREE.Vector3().crossVectors(dir,new THREE.Vector3(0,1,0));
        if(side.length()<0.1) side.set(1,0,0); else side.normalize();
        const mkl=()=>{ const gg=new THREE.BufferGeometry().setFromPoints([o.clone(),o.clone()]);
          const l=new THREE.Line(gg,new THREE.LineBasicMaterial({color:FIELD_COL.honey})); inv.add(l); return l; };
        this.jawSets.push({mech, a:mkl(), b:mkl(), o, dir, side, reach});
      }
      for(const k of rigKids(M,mech.id)) buildLink(k,inv);
    };
    for(const r of rigRoots(M)) buildLink(r,this.liftG);

    this.groupCounts={chassis:groups.chassis.length};
    M.forEach(m=>this.groupCounts[m.id]=(groups[m.id]||[]).length);
  },

  /* The footprint the collisions use, the drive base's forward, and the
     invisible box the pointer picks the robot up by. */
  buildFootprint(fp){
    if(this.footG){ this.chassisG.remove(this.footG); this.dispose(this.footG); }
    const g=new THREE.Group(), y=0.003;
    const pts=[[fp.hx,fp.hy],[fp.hx,-fp.hy],[-fp.hx,-fp.hy],[-fp.hx,fp.hy],[fp.hx,fp.hy]]
      .map(p=>new THREE.Vector3(p[0],y,-p[1]));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({color:FIELD_COL.honey,transparent:true,opacity:0.5})));
    const a=Math.min(fp.hx,fp.hy)*0.4;
    const tri=new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(fp.hx+a*0.9,y,0), new THREE.Vector3(fp.hx+0.01,y,-a*0.6), new THREE.Vector3(fp.hx+0.01,y,a*0.6)]);
    g.add(new THREE.Mesh(tri,new THREE.MeshBasicMaterial({color:FIELD_COL.honey,transparent:true,opacity:0.75,side:THREE.DoubleSide})));
    const hb=new THREE.Mesh(new THREE.BoxGeometry(2*fp.hx,Math.max(0.1,fp.h),2*fp.hy),new THREE.MeshBasicMaterial({visible:false}));
    hb.position.y=Math.max(0.1,fp.h)/2; g.add(hb);
    this.hitBox=hb; this.footG=g; this.fpShown=fp.hx+"|"+fp.hy+"|"+fp.h;
    this.chassisG.add(g);
  },

  /* A goBILDA-style mecanum base: frame rails, cross members, four motors,
     four wheels whose rollers make the X a mecanum drive shows from above. */
  buildBase(base){
    if(this.baseG){ this.chassisG.remove(this.baseG); this.dispose(this.baseG); }
    this.baseG=null; this.wheels=[];
    if(!base) return;
    const g=new THREE.Group(), M=k=>this.robotMat(k);
    const L=base.L, W=base.W, R=base.wheelR, ww=base.wheelW;
    const box=(x,y,z,sx,sy,sz,k)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sz,sy),M(k));
      m.position.set(x,z,-y); m.castShadow=true; m.receiveShadow=true; g.add(m); return m; };
    const cyl=(x,y,z,r,len,k)=>{ const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,20),M(k));
      m.rotation.x=Math.PI/2; m.position.set(x,z,-y); m.castShadow=true; g.add(m); return m; };
    const zc=R, railY=W/2-ww-0.016-0.024;
    for(const s of [1,-1]){
      box(0,s*railY,zc,L-0.03,0.048,0.048,"metal");
      box(0,s*railY,zc+0.0242,L-0.034,0.034,0.002,"hub");     // the channel's open top
    }
    for(const s of [1,-1]) box(s*(L/2-0.04),0,zc,0.048,2*railY-0.048,0.048,"metal");
    box(-0.03,0,zc+0.036,0.143,0.103,0.021,"electronics");      // Control Hub
    box(-0.03+0.0735,0,zc+0.036,0.004,0.103,0.021,"orange");
    box(0.105,0,zc+0.038,0.07,0.12,0.03,"hub");                 // battery
    const dt=Sim.drivetrain&&Sim.drivetrain.wheels||[];
    const devAt=(front,left)=>{
      let w=dt.filter(q=>!!q.front===front&&!!q.left===left&&(q.front||q.back))[0];
      if(!w) w=dt.filter(q=>!!q.left===left)[0];
      return w?w.dev:null;
    };
    for(const fx of [1,-1]) for(const sy of [1,-1]){
      const wx=fx*(L/2-R-0.012), wy=sy*(W/2-ww/2);
      cyl(wx, sy*(railY-0.024-0.045), zc, 0.019, 0.09, "motor");
      cyl(wx, sy*(railY-0.024-0.094), zc, 0.021, 0.012, "yellow");
      const wg=new THREE.Group(); wg.position.set(wx,zc,-wy); g.add(wg);
      const spin=new THREE.Group(); wg.add(spin);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(R*0.62,R*0.62,ww*0.9,24),M("hub"));
      hub.rotation.x=Math.PI/2; hub.castShadow=true; spin.add(hub);
      for(const side of [-1,1]){
        const plate=new THREE.Mesh(new THREE.CylinderGeometry(R*0.82,R*0.82,0.003,24),M("metal"));
        plate.rotation.x=Math.PI/2; plate.position.z=side*ww*0.46; spin.add(plate);
      }
      // rollers at 45°: front-left and back-right one way, the other pair mirrored
      const hand=(fx*sy>0)?1:-1, n=10, rr=0.0105, Y=new THREE.Vector3(0,1,0);
      for(let i=0;i<n;i++){
        const a=i/n*Math.PI*2;
        const radial=new THREE.Vector3(Math.cos(a),Math.sin(a),0), tang=new THREE.Vector3(-Math.sin(a),Math.cos(a),0);
        const dir=new THREE.Vector3(0,0,1).multiplyScalar(Math.SQRT1_2).add(tang.multiplyScalar(hand*Math.SQRT1_2)).normalize();
        const r=new THREE.Mesh(new THREE.CylinderGeometry(rr,rr*0.8,ww*1.2,10),M("wheel"));
        r.position.copy(radial.multiplyScalar(R-rr)); r.quaternion.setFromUnitVectors(Y,dir); r.castShadow=true;
        spin.add(r);
      }
      this.wheels.push({spin, dev:devAt(fx>0,sy>0)});
    }
    this.baseG=g; this.chassisG.add(g);
  },

  /* A hooded flywheel: the ball leaves at the Shot tab's exit height and
     launch angle, which is where the Shot Sim starts its flight. */
  buildShooter(mod){
    if(this.shooterG){ this.chassisG.remove(this.shooterG); this.dispose(this.shooterG); }
    this.shooterG=null; this.fly=null;
    const cfg=Shots.cfg; if(!mod||!cfg) return;
    const M=k=>this.robotMat(k), g=new THREE.Group();
    g.position.set(mod.ox,0,0); g.rotation.y=(mod.mount||0)*Math.PI/180;
    const h0=cfg.h0In*IN, r=Math.max(0.03,(cfg.wheelMm||96)/2000), br=(cfg.ball==="nectar"?1.81:1.4)*IN;
    const pe=Math.PI/2+cfg.hoodDeg*Math.PI/180, Rb=r+br;
    const cx=-Rb*Math.cos(pe), cz=h0-Rb*Math.sin(pe);
    const floor=Sim.base?Sim.base.H:0.02;
    const top=cz+r+2*br+0.02, H=Math.max(0.06,top-floor), Lp=2*(r+2*br)+0.03;
    for(const s of [1,-1]){
      const p=new THREE.Mesh(new THREE.BoxGeometry(Lp,H,0.005),M("clear"));
      p.position.set(cx,floor+H/2,s*0.036); g.add(p);
      const edge=new THREE.Mesh(new THREE.BoxGeometry(Lp,0.008,0.008),M("metal"));
      edge.position.set(cx,floor+0.004,s*0.036); edge.castShadow=true; g.add(edge);
      const post=new THREE.Mesh(new THREE.BoxGeometry(0.012,H,0.012),M("metal"));
      post.position.set(cx-Lp/2+0.006,floor+H/2,s*0.036); post.castShadow=true; g.add(post);
    }
    // the flywheel, with honey spokes so its spin shows
    const fw=new THREE.Group(); fw.position.set(cx,cz,0); g.add(fw);
    const wheel=new THREE.Mesh(new THREE.CylinderGeometry(r,r,0.05,28),M("wheel"));
    wheel.rotation.x=Math.PI/2; wheel.castShadow=true; fw.add(wheel);
    for(let i=0;i<3;i++){ for(const z of [0.0255,-0.0255]){
      const sp=new THREE.Mesh(new THREE.BoxGeometry(2*r*0.9,0.006,0.002),M("yellow"));
      sp.rotation.z=i*Math.PI/3; sp.position.z=z; fw.add(sp); } }
    const axle=new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,0.08,8),M("fastener"));
    axle.rotation.x=Math.PI/2; fw.add(axle);
    this.fly={g:fw};
    // the motor on the side plate
    const mot=new THREE.Mesh(new THREE.CylinderGeometry(0.019,0.019,0.07,18),M("motor"));
    mot.rotation.x=Math.PI/2; mot.position.set(cx,cz,-0.075); mot.castShadow=true; g.add(mot);
    // the hood: curved plate from behind the wheel round to the exit
    const Rh=r+2*br+0.002, a0=Math.PI+0.55, a1=pe-0.04, N=12;
    for(let i=0;i<N;i++){
      const a=a1+(a0-a1)*(i+0.5)/N, seg=Math.abs(a0-a1)/N*Rh;
      const b=new THREE.Mesh(new THREE.BoxGeometry(seg*1.08,0.004,0.07),M("metal"));
      b.position.set(cx+Math.cos(a)*Rh, cz+Math.sin(a)*Rh, 0); b.rotation.z=a+Math.PI/2; b.castShadow=true; g.add(b);
    }
    this.shooterG=g; this.chassisG.add(g);
  },

  /* ---------------- the field ---------------- */
  buildPlainField(){
    const FIELD=3.6576, WALL=0.31;
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(FIELD,FIELD),this.mat(0x2b2d30,{roughness:0.96,metalness:0}));
    floor.rotation.x=-Math.PI/2; floor.position.y=-0.002; floor.receiveShadow=true; this.fieldG.add(floor);
    const seams=new THREE.GridHelper(FIELD,6,0x484b50,0x484b50); this.fieldG.add(seams);
    const wall=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(FIELD,WALL,FIELD)),
      new THREE.LineBasicMaterial({color:0x5d6066}));
    wall.position.y=WALL/2; this.fieldG.add(wall);
    this.fieldSize=FIELD;
  },
  mat(c,o){ o=o||{}; return new THREE.MeshStandardMaterial(Object.assign({color:c, roughness:0.62, metalness:0.1},o)); },
  flat(c,op){ return new THREE.MeshBasicMaterial({color:c, transparent:op<1, opacity:op, depthWrite:op>=1,
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}); },
  box(g,center,size,mat,shadow){ // inches, field frame, size [x,y,z]
    const m=new THREE.Mesh(new THREE.BoxGeometry(size[0]*IN,size[2]*IN,size[1]*IN),mat);
    m.position.copy(this.fv(center)); if(shadow) m.castShadow=true; g.add(m); return m;
  },
  rod(g,a,b,r,mat,seg){
    const va=this.fv(a), vb=this.fv(b), len=va.distanceTo(vb); if(len<1e-6) return null;
    const m=new THREE.Mesh(new THREE.CylinderGeometry(r*IN,r*IN,len,seg||10),mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),vb.clone().sub(va).normalize());
    m.castShadow=true; g.add(m); return m;
  },
  rect(g,x0,x1,y0,y1,mat,lift){ // a flat rectangle on the tiles
    const m=new THREE.Mesh(new THREE.PlaneGeometry((x1-x0)*IN,(y1-y0)*IN),mat);
    m.rotation.x=-Math.PI/2; m.position.copy(this.fv([(x0+x1)/2,(y0+y1)/2,lift||0.03])); g.add(m); return m;
  },
  ball(kind,color){
    const r=(kind==="nectar"?1.81:1.4)*IN;
    const c=kind==="nectar"?(color==="blue"?FIELD_COL.blue:FIELD_COL.red):FIELD_COL.pollen;
    const key=kind+"|"+c;
    this._ballGeo=this._ballGeo||{}; this._ballMat=this._ballMat||{};
    if(!this._ballGeo[kind]){ this._ballGeo[kind]=new THREE.SphereGeometry(r,18,12); this._ballGeo[kind].userData.shared=true; }
    if(!this._ballMat[key]){ this._ballMat[key]=this.mat(c,{roughness:0.5}); this._ballMat[key].userData.shared=true; }
    const m=new THREE.Mesh(this._ballGeo[kind],this._ballMat[key]);
    m.castShadow=true; m.userData.ball=true;
    return m;
  },
  /* Free what an object owns; geometry and materials shared between
     objects (balls, robot materials) stay. */
  dispose(obj){
    obj.traverse(o=>{
      if(o.geometry&&!o.geometry.userData.shared) o.geometry.dispose();
      const ms=Array.isArray(o.material)?o.material:(o.material?[o.material]:[]);
      for(const m of ms) if(!m.userData.shared){ if(m.map) m.map.dispose(); m.dispose(); }
    });
  },
  label(g,text,x,y,rot,w,color){
    const cv=document.createElement("canvas"); cv.width=512; cv.height=64;
    const ctx=cv.getContext("2d");
    ctx.font="600 40px 'Barlow Semi Condensed', 'Arial Narrow', sans-serif";
    ctx.fillStyle=color||"#8a97a6"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(text,256,34);
    const tex=new THREE.CanvasTexture(cv);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w*IN,w/8*IN),
      new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));
    m.rotation.x=-Math.PI/2; m.rotation.z=rot||0;
    m.position.copy(this.fv([x,y,0.05])); g.add(m);
  },

  buildField(){
    const D=Field.data.field, F=D.field, H=F.half, g=this.fieldG, WH=F.wallHeight, WT=F.wallThickness||1;
    this.fieldSize=2*H*IN;

    // venue floor, alliance areas, labels
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(60,60),this.mat(FIELD_COL.ground,{roughness:1,metalness:0}));
    ground.rotation.x=-Math.PI/2; ground.position.y=-0.004; ground.receiveShadow=true; g.add(ground);
    for(const al of ["red","blue"]){
      const a=D.allianceAreas[al], col=al==="red"?FIELD_COL.redTape:FIELD_COL.blueTape;
      this.rect(g,a.x0,a.x1,a.y0,a.y1,this.flat(col,0.10),0.01);
      const edge=this.flat(col,0.8), outer=al==="red"?a.x0:a.x1;
      this.rect(g,a.x0,a.x1,a.y0,a.y0+2,edge,0.02); this.rect(g,a.x0,a.x1,a.y1-2,a.y1,edge,0.02);
      this.rect(g,Math.min(outer,outer-(al==="red"?-2:2)),Math.max(outer,outer-(al==="red"?-2:2)),a.y0,a.y1,edge,0.02);
      this.label(g,al.toUpperCase()+" ALLIANCE",(al==="red"?-1:1)*(H+14),0,al==="red"?-Math.PI/2:Math.PI/2,40,al==="red"?"#e0746c":"#6e9ff0");
      // the NECTAR tray each alliance starts with
      this.box(g,[(al==="red"?-1:1)*(H+30),0,1],[5,20,2],this.mat(0x2a2926),true);
      for(let i=0;i<5;i++){ const b=this.ball("nectar",al); b.position.copy(this.fv([(al==="red"?-1:1)*(H+30),-7.2+i*3.6,3.9])); g.add(b); }
    }
    this.label(g,"AUDIENCE",0,-H-12,0,34,"#8f8672");

    // foam tiles and their seams
    const tiles=new THREE.Mesh(new THREE.PlaneGeometry(2*H*IN,2*H*IN),this.mat(FIELD_COL.tile,{roughness:0.96,metalness:0}));
    tiles.rotation.x=-Math.PI/2; tiles.receiveShadow=true; g.add(tiles);
    const sp=[], yS=0.001;
    for(const s of F.tileSeams||[]){
      sp.push(s*IN,yS,-H*IN, s*IN,yS,H*IN, -H*IN,yS,-s*IN, H*IN,yS,-s*IN);
    }
    const sg=new THREE.BufferGeometry(); sg.setAttribute("position",new THREE.Float32BufferAttribute(sp,3));
    g.add(new THREE.LineSegments(sg,new THREE.LineBasicMaterial({color:FIELD_COL.seam})));

    // perimeter: polycarbonate panels on aluminium, a post at every seam
    const poly=this.mat(FIELD_COL.poly,{transparent:true,opacity:0.13,roughness:0.15,depthWrite:false,side:THREE.DoubleSide});
    const alu=this.mat(FIELD_COL.alu,{metalness:0.55,roughness:0.38});
    const rail=this.mat(FIELD_COL.rail,{metalness:0.45,roughness:0.5});
    const L=2*H+2*WT, o=H+WT/2;
    for(const w of [[0,o,L,WT],[0,-o,L,WT],[o,0,WT,2*H],[-o,0,WT,2*H]]){
      this.box(g,[w[0],w[1],WH/2],[w[2],w[3],WH],poly);
      this.box(g,[w[0],w[1],WH-0.5],[w[2]+0.01,w[3]+0.3,1],alu,true);
      this.box(g,[w[0],w[1],0.75],[w[2]+0.01,w[3]+0.3,1.5],rail,true);
    }
    const posts=[-H,-47,-23.5,0,23.5,47,H];
    for(const p of posts) for(const s of [-1,1]){
      this.box(g,[p,s*o,WH/2],[1.2,WT+0.4,WH],alu,true);
      this.box(g,[s*o,p,WH/2],[WT+0.4,1.2,WH],alu,true);
    }

    // tape: LOADING ZONES (outline, open to the wall) and GARDENS (a strip)
    const T=2;
    for(const al of ["red","blue"]){
      const z=D.loadingZones[al], m=this.flat(al==="red"?FIELD_COL.redTape:FIELD_COL.blueTape,0.95);
      const inner=al==="red"?z.x1:z.x0, s=al==="red"?-1:1;
      this.rect(g,Math.min(inner,inner+s*T),Math.max(inner,inner+s*T),z.y0,z.y1,m);
      this.rect(g,z.x0,z.x1,z.y0,z.y0+T,m); this.rect(g,z.x0,z.x1,z.y1-T,z.y1,m);
      const gd=D.gardens[al];
      this.rect(g,gd.x0,gd.x1,gd.y0,gd.y1,m);
      // four POLLEN staged in a line in the GARDEN corner
      const cx=al==="red"?-H+1.5:H-1.5, cy=al==="red"?-H+1.5:H-1.5;
      for(let i=0;i<4;i++){ const b=this.ball("pollen"); b.position.copy(this.fv([cx-s*i*2.9,cy,1.4])); g.add(b); }
    }

    // FLOWERs: rings on four pipes, POLLEN stacked inside from the tile
    const fm=this.mat(FIELD_COL.flower,{roughness:0.45});
    for(const fl of D.flowers){
      const ax=[fl.x,fl.y], R=fl.openingDia/2+0.25;
      const ring=(z,r,tube)=>{ const t=new THREE.Mesh(new THREE.TorusGeometry(r*IN,tube*IN,8,28),fm);
        t.rotation.x=Math.PI/2; t.position.copy(this.fv([ax[0],ax[1],z])); t.castShadow=true; g.add(t); };
      ring(fl.openingZ,R,0.3); ring(4,R,0.3); ring(0.25,R,0.25);
      for(let k=0;k<4;k++){ const a=Math.PI/4+k*Math.PI/2;
        this.rod(g,[ax[0]+Math.cos(a)*R,ax[1]+Math.sin(a)*R,0],[ax[0]+Math.cos(a)*R,ax[1]+Math.sin(a)*R,fl.openingZ],0.3,fm,8); }
      const n=fl.wall==="+y"?[0,1]:fl.wall==="-y"?[0,-1]:fl.wall==="+x"?[1,0]:[-1,0];
      const bs=[ax[0]+n[0]*(R+0.2),ax[1]+n[1]*(R+0.2),(fl.openingZ+fl.backstopTopZ)/2];
      this.box(g,bs,n[0]?[0.3,fl.openingDia,fl.backstopTopZ-fl.openingZ+0.3]:[fl.openingDia,0.3,fl.backstopTopZ-fl.openingZ+0.3],fm,true);
      for(let i=0;i<4;i++){ const b=this.ball("pollen"); b.position.copy(this.fv([ax[0],ax[1],1.4+i*2.8])); g.add(b); }
    }

    // HIVE frame: two leaning A-frames joined by a crossbar
    const fr=Field.model().frame, frame=this.mat(FIELD_COL.alu,{metalness:0.55,roughness:0.4});
    for(const s of fr.legs) this.rod(g,s[0],s[1],fr.tubeRadius,frame,8);
    this.rod(g,fr.crossbar[0],fr.crossbar[1],fr.tubeRadius,frame,8);
    if(fr.cornerBlocks) for(const s of fr.cornerBlocks.segments) this.rod(g,s[0],s[1],fr.cornerBlocks.radius,frame,10);
    if(fr.footBars) for(const s of fr.footBars.segments){
      const len=Math.hypot(s[1][0]-s[0][0],s[1][1]-s[0][1]);
      this.box(g,[(s[0][0]+s[1][0])/2,(s[0][1]+s[1][1])/2,0.5],[fr.footBars.width,len,1],frame,true);
    }
    if(fr.logoPanels) for(const q of fr.logoPanels.quads){
      const geo=new THREE.BufferGeometry().setFromPoints([q[0],q[1],q[2],q[0],q[2],q[3]].map(p=>this.fv(p)));
      geo.computeVertexNormals();
      const m=new THREE.Mesh(geo,this.mat(FIELD_COL.logo,{side:THREE.DoubleSide,roughness:0.8})); m.castShadow=true; g.add(m);
    }
  },

  /* The two HIVE arms with their CELLs, for the current state. Each lives in
     a group at its pivot so a TIP can swing it. */
  buildHive(al){
    if(this.hiveG[al]){ this.world.remove(this.hiveG[al]); this.dispose(this.hiveG[al]); }
    const hm=Field.model(), h=hm.hives.filter(x=>x.alliance===al)[0];
    const pz=Field.data.field.hive.pivotZ, piv=this.fv([h.hx,0,pz]);
    const G=new THREE.Group(); G.position.copy(piv); this.world.add(G);
    const inner=new THREE.Group(); inner.position.copy(piv.clone().multiplyScalar(-1)); G.add(inner);
    const col=al==="red"?FIELD_COL.red:FIELD_COL.blue;
    const armM=this.mat(FIELD_COL.arm,{metalness:0.4,roughness:0.5});
    for(let i=0;i+1<h.armBar.length;i++) this.rod(inner,h.armBar[i],h.armBar[i+1],h.armRadius,armM,8);
    this.rod(inner,[h.hx-1.6,0,pz],[h.hx+1.6,0,pz],1.3,armM,14);
    for(const cell of h.cells){
      const up=cell.role==="up", v=cell.vertices.map(p=>this.fv(p));
      const pos=[], idx=[];
      v.forEach(q=>pos.push(q.x,q.y,q.z));
      for(let i=0;i<5;i++){ const j=(i+1)%5; idx.push(i,j,5+j, i,5+j,5+i); }
      idx.push(0,1,2, 0,2,3, 0,3,4);
      const geo=new THREE.BufferGeometry();
      geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3)); geo.setIndex(idx); geo.computeVertexNormals();
      const shell=new THREE.Mesh(geo,this.mat(col,{transparent:true,opacity:up?0.46:0.30,side:THREE.DoubleSide,depthWrite:false,roughness:0.35}));
      shell.castShadow=true; inner.add(shell);
      const lp=[]; const seg=(a,b)=>lp.push(v[a].x,v[a].y,v[a].z,v[b].x,v[b].y,v[b].z);
      for(let k=0;k<5;k++){ seg(k,(k+1)%5); seg(5+k,5+(k+1)%5); seg(k,5+k); }
      const lg=new THREE.BufferGeometry(); lg.setAttribute("position",new THREE.Float32BufferAttribute(lp,3));
      inner.add(new THREE.LineSegments(lg,new THREE.LineBasicMaterial({color:col,transparent:true,opacity:up?0.95:0.6})));
      // the mouth ring
      const mouth=cell.mouth.concat([cell.mouth[0]]);
      const ringM=this.mat(up?0xf4f7fa:col,{roughness:0.4, emissive:up?0x222222:0x000000});
      for(let k=0;k+1<mouth.length;k++) this.rod(inner,mouth[k],mouth[k+1],Field.data.field.hive.cell.ringThickness+0.15,ringM,6);
      if(up) this.fillCell(inner,cell,al);
    }
    this.hiveG[al]=G;
  },
  /* What's in an up-CELL, resting on its floor against the back wall,
     from the alliance's side inward. */
  fillCell(g,cell,al){
    const list=Field.cells[al]; if(!list.length) return;
    const V=cell.vertices;
    const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], add=(a,b,k)=>[a[0]+b[0]*k,a[1]+b[1]*k,a[2]+b[2]*k];
    const len=a=>Math.hypot(a[0],a[1],a[2]), nrm=a=>{ const l=len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; };
    const across=nrm(sub(V[1],V[0])), depth=nrm(sub(V[5],V[0])), wide=len(sub(V[1],V[0]));
    let up=[across[1]*depth[2]-across[2]*depth[1], across[2]*depth[0]-across[0]*depth[2], across[0]*depth[1]-across[1]*depth[0]];
    const mid=V.slice(0,5).reduce((s,p)=>[s[0]+p[0]/5,s[1]+p[1]/5,s[2]+p[2]/5],[0,0,0]);
    const toMid=sub(mid,V[0]); if(up[0]*toMid[0]+up[1]*toMid[1]+up[2]*toMid[2]<0) up=[-up[0],-up[1],-up[2]];
    const fromHigh=al==="blue";          // start on the alliance-area side
    let u=0.4, row=0;
    for(const e of list){
      const r=e.kind==="nectar"?1.81:1.4;
      if(u+2*r>wide-0.4){ u=0.4; row++; }
      const along=fromHigh?wide-u-r:u+r;
      const p=add(add(add(V[0],across,along),depth,0.3+r+row*3.4),up,r+0.2);
      const b=this.ball(e.kind,e.color); b.position.copy(this.fv(p)); g.add(b);
      u+=2*r+0.15;
    }
  },

  /* A path in field inches, drawn as a line: solid for your shot, dashed for
     the best arc from here. */
  setArc(path,color,dashed){
    if(this.arcLine){ this.dynG.remove(this.arcLine); this.arcLine.geometry.dispose(); this.arcLine.material.dispose(); this.arcLine=null; }
    if(!path||path.length<2||!this.dynG) return;
    const geo=new THREE.BufferGeometry().setFromPoints(path.map(p=>this.fv(p)));
    const mat=dashed?new THREE.LineDashedMaterial({color,dashSize:0.06,gapSize:0.045,transparent:true,opacity:0.85})
                    :new THREE.LineBasicMaterial({color,transparent:true,opacity:0.95});
    const line=new THREE.Line(geo,mat); if(dashed) line.computeLineDistances();
    this.arcLine=line; this.dynG.add(line);
  },

  update(){
    if(!this.cad) return;
    const now=performance.now(), dt=Math.min(0.1,(now-(this.lastT||now))/1000); this.lastT=now;
    const ch=Sim.chassis;
    this.chassisG.position.set(ch.x, 0, -ch.y);
    this.chassisG.rotation.y = ch.h;                     // CCW from +x, like the field frame
    const front=(Sim.opts&&Sim.opts.front)||"+x";
    if(front!==this.front){ this.front=front; this.frontG.rotation.y=FRONTS[front]||0; }
    // the drawn drive base and shooter follow the OpMode and the Shot setup
    const base=Sim.base, bk=base?base.L+"|"+base.W:"";
    if(bk!==this.baseKey){ this.baseKey=bk; this.buildBase(base); this.liftG.position.y=this.lift0+(base?base.H:0); }
    const mod=Field.ok?Shots.module():null, cfg=Shots.cfg;
    const sk=mod&&cfg?[mod.ox,mod.mount,cfg.hoodDeg,cfg.h0In,cfg.wheelMm,cfg.ball,base?base.H:0].join("|"):"";
    if(sk!==this.shooterKey){ this.shooterKey=sk; this.buildShooter(mod); }
    const fp=Sim.footprint;
    if(fp&&(!this.footG||this.fpShown!==fp.hx+"|"+fp.hy+"|"+fp.h)) this.buildFootprint(fp);
    // wheels roll with their motors, the flywheel with the shooter
    for(const w of this.wheels){ const s=w.dev&&Sim.dev[w.dev]; if(s) w.spin.rotation.z-=s.act*(s.spec.rpm||312)/60*2*Math.PI*dt; }
    if(this.fly) this.fly.g.rotation.z-=Math.min(26,Shots.spin()*140)*dt;

    for(const m of this.cad.mechs){
      if(!m._g) continue;
      const dn=deviceOn(m.id);
      const s=dn?Sim.dev[dn]:null;
      if(!s) continue;
      const travel=(s.act-s.restPos);
      if(m.kind==="revolute-yaw"||m.kind==="revolute-lift"){
        const ang=travel*(s.travelDeg||300)*Math.PI/180*(m.dir||1)*(m.kind==="revolute-lift"?-1:1);
        m._g.quaternion.setFromAxisAngle(this.vAxis(m.axis), ang);
      }else if(m.kind==="linear"){
        const d=travel*(m.lever||this.size*0.3)*(m.dir||1);
        m._g.position.copy(this.v3(m.pivot).add(this.vAxis(m.axis).multiplyScalar(d)));
      }
    }
    for(const J of this.jawSets||[]){
      const dn=deviceOn(J.mech.id);
      const s=dn?Sim.dev[dn]:null;
      const open=s? (1-clamp01(s.act))*0.9+0.12 : 0.5;
      const setL=(line,sgn)=>{
        const end=J.o.clone().add(J.dir.clone().multiplyScalar(J.reach))
                  .add(J.side.clone().multiplyScalar(sgn*J.reach*open));
        line.geometry.setFromPoints([J.o.clone(),end]);
      };
      setL(J.a,1); setL(J.b,-1);
    }
    const marks=this.mode!=="field";
    for(const m of this.markers||[]) m.visible=marks;
    if(Field.ok) this.updateField();
  },
  updateField(){
    // a TIP swings the arm 2 × armDeg about the pivot, then the new state is built
    const now=performance.now();
    if(this.tipAnim){
      const A=this.tipAnim, k=Math.min(1,(now-A.t0)/420), e=k<0.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
      if(this.hiveG[A.al]) this.hiveG[A.al].rotation.x=A.angle*e;
      if(k>=1){ this.tipAnim=null; this.shownHive=null; }
    }
    const key=Field.hive.red+","+Field.hive.blue;
    if(!this.tipAnim&&(this.shownHive!==key||this.shownCells!==Field.version)){
      const was=this.shownHive?this.shownHive.split(",").map(Number):null;
      const al=was&&(was[0]!==Field.hive.red?"red":was[1]!==Field.hive.blue?"blue":null);
      if(al&&this.hiveG[al]){
        const from=al==="red"?was[0]:was[1];
        const arm=Field.data.field.hive.armDeg*Math.PI/180;
        this.tipAnim={al, t0:now, angle:2*arm*Math.sign(-from)};
        this.shownHive=key; this.shownCells=-2;        // rebuild after the swing
        // what was in the CELL spills as it goes down
        for(const g of this.hiveG[al].children[0].children) if(g.userData.ball) g.visible=false;
      }else{
        this.buildHive("red"); this.buildHive("blue");
        this.shownHive=key; this.shownCells=Field.version;
      }
    }
    // balls in flight, and misses lying on the tiles
    const want=Shots.flying.concat(Shots.landed);
    while(this.ballPool.length>want.length){ const m=this.ballPool.pop(); this.dynG.remove(m); }
    for(let i=0;i<want.length;i++){
      const b=want[i], key2=b.kind+"|"+(b.color||"");
      let m=this.ballPool[i];
      if(!m||m.userData.key!==key2){ if(m) this.dynG.remove(m); m=this.ball(b.kind,b.color); m.userData.key=key2; this.ballPool[i]=m; this.dynG.add(m); }
      m.position.copy(this.fv(b.pos));
    }
  },

  setView(v){
    this.mode=v;
    if(v==="field"){
      // from behind the alliance's own wall, where the drivers stand
      this.theta=this.alliance==="blue"?0:Math.PI; this.phi=0.82; this.rad=(this.fieldSize||3.58)*1.5; return;
    }
    if(v==="front"){ this.theta=-Math.PI/2; this.phi=Math.PI/2.2; }
    else if(v==="side"){ this.theta=0; this.phi=Math.PI/2.2; }
    else if(v==="top"){ this.theta=-Math.PI/2; this.phi=0.09; }
    else { this.theta=-0.7; this.phi=1.12; }
    this.rad=Math.max(this.size,0.46)*1.9;
  },
  render(){
    if(!this.cam) return;
    // robot views follow the chassis as it drives; the field view holds still
    const target=new THREE.Vector3(0,0,0);
    if(this.mode==="field") target.set(this.alliance==="blue"?0.25:-0.25,0.3,0);
    else if(this.chassisG){ target.copy(this.chassisG.position); target.y=(this.lift0||0.2)+(Sim.base?Sim.base.H:0); }
    if(!this.look) this.look=target.clone();
    if(!this.drag) this.look.lerp(target,0.18);          // hold still while the robot is being dragged
    const r=this.rad;
    this.cam.position.set(this.look.x+r*Math.sin(this.phi)*Math.cos(this.theta),
                          this.look.y+r*Math.cos(this.phi),
                          this.look.z+r*Math.sin(this.phi)*Math.sin(this.theta));
    this.cam.lookAt(this.look);
    this.ren.render(this.scene,this.cam);
  }
};
function deviceOn(mechId){
  for(const n in MAP) if(MAP[n]===mechId && Sim.dev[n]) return n;
  return null;
}
