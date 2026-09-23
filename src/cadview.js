/* ============================================================
   8b.  CAD VIEW — the robot the way Onshape shows it

   The field view is a game camera: perspective, a sun, shadows, following
   the robot round the field. Onshape is none of that, and looking like it
   takes more than the right triangles. This mode copies its graphics area:
     - an orthographic camera, locked to the robot, so the model holds still
     - the pale blue-grey gradient, and a headlight instead of a sun
     - the model's real edges (tessEdges) over smooth-shaded faces
     - a view cube in the corner: click a face to look from it
     - Onshape's mouse: right-drag rotate, middle-drag pan, scroll zooms
       about the cursor; left-click selects a part, left-drag also rotates
     - hover and selection highlights, the instance list with hide/isolate,
       and mass properties for whatever is selected
   Camera maths lives in liftG's frame — the canonical CAD — so Front, Top
   and Right mean the CAD's own axes, as they do in Onshape.
   ============================================================ */
const CAD_BG_TOP="#c9d4df", CAD_BG_BOTTOM="#f4f6f8";
const CAD_SELECT=0x2f80ed, CAD_HOVER=0xf2a33a;
// named views, as directions from the model to the camera in canonical axes
const CAD_VIEWS={iso:[1,-1,1], front:[0,-1,0], back:[0,1,0], right:[1,0,0], left:[-1,0,0], top:[0,0,1], bottom:[0,0,-1]};

const CadView={
  on:false, theta:Math.PI/4, phi:0.955, zoom:1, target:null, sel:null, hover:null,
  edgesOn:true, saved:null,

  /* canonical direction -> view-local (Y up), as View.v3 maps points */
  loc(d){ return new THREE.Vector3(d[0],d[2],-d[1]); },

  init(){
    const V=View;
    this.cam=new THREE.OrthographicCamera(-1,1,1,-1,-50,50);
    this.head=new THREE.DirectionalLight(0xffffff,0.0); V.scene.add(this.head); V.scene.add(this.head.target);
    // the pale gradient Onshape paints behind a model
    const cv=document.createElement("canvas"); cv.width=2; cv.height=256;
    const g=cv.getContext("2d"), gr=g.createLinearGradient(0,0,0,256);
    gr.addColorStop(0,CAD_BG_TOP); gr.addColorStop(1,CAD_BG_BOTTOM); g.fillStyle=gr; g.fillRect(0,0,2,256);
    this.bg=new THREE.CanvasTexture(cv);
    this.buildCube();
    this.bind();
  },

  /* ---------------- enter / leave ---------------- */
  enter(){
    if(!View.cad) return;
    if(!this.cam) this.init();
    this.on=true;
    const V=View;
    this.saved={bg:V.scene.background, hemi:V.hemi?V.hemi.intensity:null, sun:V.sun?V.sun.intensity:null, shadow:V.sun?V.sun.castShadow:null};
    V.scene.background=this.bg;
    if(V.hemi){ V.hemi.intensity=0.62; }
    if(V.sun){ V.sun.intensity=0.18; V.sun.castShadow=false; }
    this.head.intensity=0.78;
    V.el.classList.add("cad");
    $("#cadUI").hidden=false;
    this.fit(); this.view("iso");
    this.renderTree(); this.showInfo();
  },
  exit(){
    if(!this.on) return;
    this.on=false;
    const V=View, s=this.saved||{};
    V.scene.background=s.bg||null;
    if(V.hemi&&s.hemi!=null) V.hemi.intensity=s.hemi;
    if(V.sun&&s.sun!=null){ V.sun.intensity=s.sun; V.sun.castShadow=s.shadow; }
    this.head.intensity=0;
    this.light(null,"sel"); this.light(null,"hover"); this.sel=null; this.hover=null;
    V.el.classList.remove("cad");
    $("#cadUI").hidden=true;
    for(const o of this.hid||[]) o.visible=true; this.hid=null;
    for(const o of [V.fieldG,V.dynG,V.footG,V.baseG,V.shooterG]) if(o) o.visible=true;
    for(const m of V.markers||[]) m.visible=true;
    for(const J of V.jawSets||[]){ J.a.visible=true; J.b.visible=true; }
  },

  /* ---------------- camera ---------------- */
  size(){ const b=View.cad&&View.cad.bbox; if(!b) return 0.5;
    return Math.max(b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2])||0.5; },
  fit(){
    const b=View.cad&&View.cad.bbox; if(!b) return;
    this.target=this.loc([(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,(b.min[2]+b.max[2])/2]);
    this.zoom=1;
  },
  view(name){
    const d=CAD_VIEWS[name]; if(!d) return;
    const v=this.loc(d).normalize();
    this.phi=Math.min(Math.PI-1e-3,Math.max(1e-3,Math.acos(Math.max(-1,Math.min(1,v.y)))));
    this.theta=Math.atan2(v.z,v.x);
    // straight down or up has no azimuth: pick the one that puts +Y up on screen
    if(Math.abs(v.y)>0.999){ this.theta=Math.PI/2; }
  },
  dir(){ return new THREE.Vector3(Math.sin(this.phi)*Math.cos(this.theta), Math.cos(this.phi), Math.sin(this.phi)*Math.sin(this.theta)); },
  /* camera basis in the model's frame: right, up, and towards the viewer */
  basis(){
    const f=this.dir(), up=new THREE.Vector3(0,1,0);
    let r=new THREE.Vector3().crossVectors(up,f);
    if(r.lengthSq()<1e-10) r.set(-Math.sin(this.theta),0,Math.cos(this.theta)).negate();
    r.normalize();
    const u=new THREE.Vector3().crossVectors(f,r).normalize();
    return {r,u,f};
  },
  halfH(){ return this.size()*0.95/this.zoom; },
  /* The visible window, in model metres about the target. It is shifted,
     not the model, so the robot sits in the space beside the instance list
     yet still spins about its own centre. */
  frustum(w,h){
    const a=w/h, hh=this.halfH(), tree=document.querySelector(".cad-tree");
    const pad=tree&&tree.offsetParent?tree.offsetWidth+10:0, s=pad/2*(2*hh/h);
    return {l:-hh*a-s, r:hh*a-s, t:hh, b:-hh};
  },

  render(){
    const V=View; if(!V.cad||!this.target) return;
    // nothing but the model: every other thing in the world (field, HIVEs,
    // balls — they don't all live under one group) steps out of the way
    if(!this.hid){ this.hid=[]; for(const o of V.world.children) if(o!==V.chassisG&&o.visible){ o.visible=false; this.hid.push(o); } }
    for(const o of [V.fieldG,V.dynG,V.footG,V.baseG,V.shooterG]) if(o) o.visible=false;
    for(const m of V.markers||[]) m.visible=false;
    for(const J of V.jawSets||[]){ J.a.visible=false; J.b.visible=false; }
    V.liftG.position.y=0;
    const w=V.el.clientWidth||1, h=V.el.clientHeight||1, F=this.frustum(w,h);
    const c=this.cam; c.left=F.l; c.right=F.r; c.top=F.t; c.bottom=F.b; c.near=-this.size()*20; c.far=this.size()*20;
    c.updateProjectionMatrix();
    // everything is worked out in the model's frame, then carried to the world
    V.liftG.updateMatrixWorld(true);
    const {r,u,f}=this.basis();
    const tW=V.liftG.localToWorld(this.target.clone());
    const pW=V.liftG.localToWorld(this.target.clone().add(f.clone().multiplyScalar(this.size()*4)));
    const q=new THREE.Quaternion(); V.liftG.getWorldQuaternion(q);
    c.position.copy(pW); c.up.copy(u.clone().applyQuaternion(q)); c.lookAt(tW);
    this.head.position.copy(pW); this.head.target.position.copy(tW);
    V.ren.autoClear=true;
    V.ren.render(V.scene,c);
    this.renderCube(w,h);
  },

  /* ---------------- the view cube ---------------- */
  buildCube(){
    this.cubeScene=new THREE.Scene();
    this.cubeCam=new THREE.OrthographicCamera(-0.95,0.95,0.95,-0.95,-10,10);
    const face=(label)=>{
      const cv=document.createElement("canvas"); cv.width=cv.height=128;
      const g=cv.getContext("2d");
      g.fillStyle="#f7f9fb"; g.fillRect(0,0,128,128);
      g.strokeStyle="#9aa6b2"; g.lineWidth=4; g.strokeRect(2,2,124,124);
      g.fillStyle="#3a4652"; g.font="600 25px Barlow, 'Segoe UI', sans-serif"; g.textAlign="center"; g.textBaseline="middle";
      g.fillText(label,64,66);
      const t=new THREE.CanvasTexture(cv);
      return new THREE.MeshBasicMaterial({map:t, color:0xffffff});
    };
    // BoxGeometry faces: +x -x +y -y +z -z in view axes = Right Left Top Bottom Front Back
    this.cubeFaces=["right","left","top","bottom","front","back"];
    this.cubeMats=["RIGHT","LEFT","TOP","BOTTOM","FRONT","BACK"].map(face);
    this.cube=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.cubeMats);
    this.cubeScene.add(this.cube);
    this.cubeScene.add(new THREE.LineSegments(new THREE.EdgesGeometry(this.cube.geometry),new THREE.LineBasicMaterial({color:0x5b6773})));
    // the axis triad under it, in Onshape's red/green/blue
    const ax=(d,col)=>{ const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.62,-0.62,0.62),new THREE.Vector3(-0.62,-0.62,0.62).add(d)]);
      this.cubeScene.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:col}))); };
    ax(new THREE.Vector3(0.55,0,0),0xd23b3b); ax(new THREE.Vector3(0,0,-0.55),0x2f9e44); ax(new THREE.Vector3(0,0.55,0),0x2f6fd2);
    this.cubeSize=96;
  },
  cubeRect(w,h){ const s=this.cubeSize, m=14; return {x:w-s-m, y:m+36, s}; },   // below the viewport's top bar
  renderCube(w,h){
    const V=View, R=this.cubeRect(w,h), {u,f}=this.basis();
    this.cubeCam.position.copy(f.clone().multiplyScalar(3)); this.cubeCam.up.copy(u); this.cubeCam.lookAt(0,0,0);
    const dpr=V.ren.getPixelRatio?1:1;
    V.ren.autoClear=false;
    V.ren.setScissorTest(true);
    V.ren.setViewport(R.x*dpr, (h-R.y-R.s)*dpr, R.s*dpr, R.s*dpr);
    V.ren.setScissor(R.x*dpr, (h-R.y-R.s)*dpr, R.s*dpr, R.s*dpr);
    V.ren.clearDepth();
    V.ren.render(this.cubeScene,this.cubeCam);
    V.ren.setScissorTest(false);
    V.ren.setViewport(0,0,w,h);
    V.ren.autoClear=true;
  },
  cubeHit(e){
    const V=View, rect=V.ren.domElement.getBoundingClientRect(), R=this.cubeRect(rect.width,rect.height);
    const x=e.clientX-rect.left, y=e.clientY-rect.top;
    if(x<R.x||x>R.x+R.s||y<R.y||y>R.y+R.s) return null;
    const n=new THREE.Vector2(((x-R.x)/R.s)*2-1, -((y-R.y)/R.s)*2+1);
    const ray=new THREE.Raycaster(); ray.setFromCamera(n,this.cubeCam);
    const hit=ray.intersectObject(this.cube,false)[0];
    return hit?this.cubeFaces[hit.face.materialIndex]:"miss";
  },

  /* ---------------- picking and highlights ---------------- */
  pick(e){
    const V=View; if(!V.exactG||!V.exactG.length) return null;
    const rect=V.ren.domElement.getBoundingClientRect();
    const n=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
    const ray=new THREE.Raycaster(); ray.setFromCamera(n,this.cam);
    const meshes=V.exactG.filter(o=>o.isMesh&&o.visible&&(o.userData.ranges||o.userData.js));
    const hit=ray.intersectObjects(meshes,false)[0];
    if(!hit) return null;
    // a shape drawn as instances: the copy that was hit is the part
    if(hit.object.userData.js) return hit.instanceId!=null?hit.object.userData.js[hit.instanceId]:null;
    const rs=hit.object.userData.ranges, t=hit.faceIndex;
    let lo=0, hi=rs.length-1;
    while(lo<hi){ const mid=(lo+hi+1)>>1; if(rs[mid].start<=t) lo=mid; else hi=mid-1; }
    return rs[lo]?rs[lo].j:null;
  },
  /* A highlight is the part's own triangles again, tinted, in the same group
     as the part, so it follows an arm as it swings. */
  light(parts,which){
    const V=View, old=this[which+"G"];
    if(old){ for(const o of old){ if(o.parent) o.parent.remove(o); V.dispose(o); } }
    this[which+"G"]=[];
    if(!parts||!parts.length||!V.exact) return;
    const {cad,res}=V.exact, M=frameM(cad), asg=V.exactAsg; if(!asg) return;
    const col=which==="sel"?CAD_SELECT:CAD_HOVER;
    if(res.perShape){
      // per-shape surfaces: the part's shared shape again, at the same place, tinted
      const mat=new THREE.MeshBasicMaterial({color:col, transparent:true, opacity:which==="sel"?0.42:0.28,
        depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2});
      parts.forEach(j=>{
        const m=res.meshes[j]; if(!m||!m.index) return;
        // where the copy lives: its mechanism group, or its wheel's spin group, so
        // the highlight turns with a wheel too
        const h=V.instHolder&&V.instHolder.get(j), parent=h?h.parent:(V.groupAt[asg.group[j]]||V.groupAt.chassis); if(!parent) return;
        // the shape's geometry is shared (never freed here); the tint is this highlight's own
        const mesh=new THREE.Mesh(V.instGeo(m).g,mat); mesh.matrixAutoUpdate=false; V.instMatrix(cad,m,mesh.matrix);
        if(h&&h.off) mesh.matrix.premultiply(h.off);
        mesh.renderOrder=5; parent.add(mesh); this[which+"G"].push(mesh);
      });
      return;
    }
    const byGroup={};
    for(const j of parts){ const m=res.meshes[j]; if(!m||!m.index) continue; (byGroup[asg.group[j]]=byGroup[asg.group[j]]||[]).push(j); }
    for(const g in byGroup){
      const parent=V.groupAt[g]||V.groupAt.chassis; if(!parent) continue;
      let nv=0, ni=0; for(const j of byGroup[g]){ nv+=res.meshes[j].attributes.position.array.length; ni+=res.meshes[j].index.array.length; }
      const pos=new Float32Array(nv), idx=new Uint32Array(ni); let vo=0, io=0;
      for(const j of byGroup[g]){
        const P=res.meshes[j].attributes.position.array, I=res.meshes[j].index.array;
        for(let i=0;i<P.length;i+=3){
          const x=P[i], y=P[i+1], z=P[i+2];
          const cx=M[0]*x+M[1]*y+M[2]*z+M[3], cy=M[4]*x+M[5]*y+M[6]*z+M[7], cz=M[8]*x+M[9]*y+M[10]*z+M[11];
          pos[vo*3+i]=cx; pos[vo*3+i+1]=cz; pos[vo*3+i+2]=-cy;
        }
        for(let i=0;i<I.length;i++) idx[io++]=I[i]+vo;
        vo+=P.length/3;
      }
      const geo=new THREE.BufferGeometry();
      geo.setAttribute("position",new THREE.BufferAttribute(pos,3)); geo.setIndex(new THREE.BufferAttribute(idx,1));
      const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:col, transparent:true, opacity:which==="sel"?0.42:0.28,
        depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}));
      mesh.renderOrder=5; parent.add(mesh); this[which+"G"].push(mesh);
    }
  },
  select(parts,from){
    this.sel=parts&&parts.length?parts:null;
    this.light(this.sel,"sel");
    this.showInfo(from);
    for(const el of document.querySelectorAll("#cadTreeBody .row.on")) el.classList.remove("on");
    if(from&&from.id){ const el=document.querySelector(`#cadTreeBody .row[data-id="${from.id}"]`); if(el) el.classList.add("on"); }
  },

  /* ---------------- the panels ---------------- */
  renderTree(){
    const body=$("#cadTreeBody"); if(!body) return;
    const V=View;
    if(!V.exact&&typeof EXACT!=="undefined"&&EXACT.state!=="none"){
      // a real STEP whose surfaces aren't in yet: say which, never "the sample"
      const n=(CAD&&CAD.solids||[]).length;
      body.innerHTML='<p class="cad-empty">'+(EXACT.state==="loading"
        ? 'Loading the exact surfaces from your STEP (OpenCascade)… Until then its '+n+' parts are drawn as simplified shapes. Big assemblies can take a minute.'
        : "The exact surfaces couldn't be loaded ("+esc(EXACT.msg||"unknown error")+"), so your STEP's "+n+" parts are drawn as simplified shapes. Joints, mass and physics are unaffected.")+'</p>';
      $("#cadCount").textContent=n?String(n):""; return; }
    if(!V.exact){
      body.innerHTML='<p class="cad-empty">This robot is the built-in sample, drawn from simple shapes — it has no STEP file behind it. '+
        'Drop your own Onshape STEP export anywhere on the page, or:</p><div class="cad-empty"><button class="btn-sm primary" id="cadDemo" type="button">Open the demo robot</button>'+
        '<span class="cad-demo-note">a real STEP assembly, 32 parts</span></div>';
      $("#cadCount").textContent=""; return; }
    this.tree=tessTree(V.exact.res);
    const hidden=V.hiddenParts||new Set();
    const rows=[];
    const walk=(n,d)=>{
      const leaf=!n.kids.length, off=n.all.every(j=>hidden.has(j));
      rows.push(`<div class="row${off?" off":""}" data-id="${n.id}" style="padding-left:${6+d*12}px">`+
        `<button class="eye" data-eye="${n.id}" title="${off?"Show":"Hide"}" aria-label="${off?"Show":"Hide"} ${esc(n.name)}">${off?"◌":"●"}</button>`+
        `<span class="nm${leaf?"":" asm"}">${esc(n.name)}</span></div>`);
      if(d<6) for(const k of n.kids) walk(k,d+1);
    };
    for(const k of (this.tree.kids.length?this.tree.kids:[this.tree])) walk(k,0);
    body.innerHTML=rows.join("");
    $("#cadCount").textContent=V.exact.res.meshes.length;
  },
  node(id){ const f=n=>{ if(n.id===id) return n; for(const k of n.kids){ const r=f(k); if(r) return r; } return null; }; return this.tree?f(this.tree):null; },
  setHidden(parts,hide){
    const V=View; V.hiddenParts=V.hiddenParts||new Set();
    for(const j of parts){ if(hide) V.hiddenParts.add(j); else V.hiddenParts.delete(j); }
    V.applyExact(); this.light(this.sel,"sel"); this.renderTree();
  },
  showInfo(from){
    const box=$("#cadInfo"); if(!box) return;
    const V=View;
    if(!this.sel||!V.exact){ box.hidden=true; return; }
    const {cad,res}=V.exact, asg=V.exactAsg, names=tessNames(res);
    const j0=this.sel[0], si=asg?asg.solid[j0]:-1, s=si>=0?cad.solids[si]:null;
    // mass of the selection: each matched part once
    const solids=new Set(); for(const j of this.sel){ const i=asg?asg.solid[j]:-1; if(i>=0) solids.add(i); }
    let kg=0, vendor=0; for(const i of solids){ const pm=partMass(cad.solids[i]); kg+=pm.kg; if(pm.how==="vendor") vendor++; }
    // bounding size of the selection, canonical metres
    const M=frameM(cad), mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
    for(const j of this.sel){ const b=tessBox(res.meshes[j].attributes.position.array,M); for(let k=0;k<3;k++){ mn[k]=Math.min(mn[k],b.min[k]); mx[k]=Math.max(mx[k],b.max[k]); } }
    const mm=v=>(v*1000).toFixed(v<0.01?1:0);
    const name=(from&&from.name)||names[j0]||(s&&s.name)||"Part";
    const rows=[
      ["Parts", this.sel.length===1?"1 body":this.sel.length+" bodies"],
      s&&s.part?["Part number", s.part]:null,
      s?["Material", (MATERIALS[s.kind]&&MATERIALS[s.kind].label)||s.kind]:null,
      solids.size?["Mass", (kg>=1?kg.toFixed(3)+" kg":(kg*1000).toFixed(1)+" g")+(vendor===solids.size?" · published":vendor?" · mixed":" · estimated")]:null,
      ["Size", mm(mx[0]-mn[0])+" × "+mm(mx[1]-mn[1])+" × "+mm(mx[2]-mn[2])+" mm"],
    ].filter(Boolean);
    box.innerHTML=`<div class="ci-head"><b title="${esc(name)}">${esc(name)}</b><button class="sheet-x" id="cadInfoX" aria-label="Clear selection">×</button></div>`+
      rows.map(r=>`<div class="ci-row"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join("")+
      `<div class="ci-acts"><button class="btn-sm" id="cadHide">Hide</button><button class="btn-sm" id="cadIsolate">Isolate</button></div>`;
    box.hidden=false;
  },

  /* ---------------- input: Onshape's mouse ---------------- */
  bind(){
    const c=View.ren.domElement;
    let drag=null, lastHover=0;
    c.addEventListener("pointerdown",e=>{
      if(!this.on) return;
      const face=this.cubeHit(e);
      if(face&&face!=="miss"){ this.view(face); e.stopImmediatePropagation(); return; }
      c.setPointerCapture(e.pointerId);
      const pan=e.button===1||(e.button===2&&e.shiftKey)||(e.button===0&&e.shiftKey);
      drag={x:e.clientX, y:e.clientY, x0:e.clientX, y0:e.clientY, button:e.button, pan, moved:false};
      e.stopImmediatePropagation(); e.preventDefault();
    },true);
    c.addEventListener("pointermove",e=>{
      if(!this.on) return;
      e.stopImmediatePropagation();
      if(!drag){
        const now=performance.now(); if(now-lastHover<50) return; lastHover=now;
        const face=this.cubeHit(e);
        c.style.cursor=face&&face!=="miss"?"pointer":"default";
        const j=face?null:this.pick(e);
        const cur=this.hover&&this.hover[0];
        if(j!==cur){ this.hover=j==null?null:[j]; this.light(this.hover&&!(this.sel&&this.sel.includes(j))?this.hover:null,"hover"); }
        return;
      }
      const dx=e.clientX-drag.x, dy=e.clientY-drag.y; drag.x=e.clientX; drag.y=e.clientY;
      if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)>3) drag.moved=true;
      if(!drag.moved) return;
      const h=c.clientHeight||1;
      if(drag.pan){
        const {r,u}=this.basis(), k=2*this.halfH()/h;
        this.target.addScaledVector(r,-dx*k).addScaledVector(u,dy*k);
      }else{
        this.theta+=dx*0.0085;
        this.phi=Math.min(Math.PI-1e-3,Math.max(1e-3,this.phi-dy*0.0085));
      }
    },true);
    const up=e=>{
      if(!this.on||!drag) return;
      const was=drag; drag=null; e.stopImmediatePropagation();
      if(!was.moved&&was.button===0){
        const j=this.pick(e);
        this.select(j==null?null:[j]);
      }
    };
    c.addEventListener("pointerup",up,true); c.addEventListener("pointercancel",()=>{ drag=null; },true);
    c.addEventListener("wheel",e=>{
      if(!this.on) return;
      e.preventDefault(); e.stopImmediatePropagation();
      // zoom about the point under the cursor, the way Onshape does
      const rect=c.getBoundingClientRect(), fx=(e.clientX-rect.left)/rect.width, fy=1-(e.clientY-rect.top)/rect.height;
      const at=F=>[F.l+fx*(F.r-F.l), F.b+fy*(F.t-F.b)];   // the cursor, in model metres about the target
      const p0=at(this.frustum(rect.width,rect.height));
      this.zoom=Math.max(0.15,Math.min(40,this.zoom*(e.deltaY<0?1.12:1/1.12)));
      const p1=at(this.frustum(rect.width,rect.height)), {r,u}=this.basis();
      this.target.addScaledVector(r,p0[0]-p1[0]).addScaledVector(u,p0[1]-p1[1]);
    },{capture:true,passive:false});
    c.addEventListener("dblclick",e=>{ if(this.on){ e.stopImmediatePropagation(); this.fit(); } },true);

    // the panels
    $("#cadBar").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
      if(b.dataset.cv) this.view(b.dataset.cv); else if(b.id==="cadFit") this.fit(); });
    $("#cadEdges").addEventListener("change",e=>{ this.edgesOn=e.target.checked; View.showEdges(this.edgesOn); });
    $("#cadShowAll").addEventListener("click",()=>{ View.hiddenParts=new Set(); View.applyExact(); this.renderTree(); this.light(this.sel,"sel"); });
    $("#cadTreeBody").addEventListener("click",e=>{
      if(e.target.id==="cadDemo"){ const b=e.target; b.disabled=true; b.textContent="Loading…";
        fetch("demo/mecanum-demo.step").then(r=>{ if(!r.ok) throw new Error(r.status); return r.text(); })
          .then(t=>takeCAD(new File([t],"demo mecanum robot.step")))
          .catch(()=>{ b.disabled=false; b.textContent="Open the demo robot"; $("#cadStatus").textContent="the demo robot is only on the hosted site"; });
        return; }
      const eye=e.target.closest("[data-eye]");
      if(eye){ const n=this.node(eye.dataset.eye); if(n){ const hid=View.hiddenParts||new Set(); this.setHidden(n.all,!n.all.every(j=>hid.has(j))); } return; }
      const row=e.target.closest(".row"); if(!row) return;
      const n=this.node(row.dataset.id); if(n) this.select(n.all.slice(),n);
    });
    $("#cadInfo").addEventListener("click",e=>{
      if(e.target.id==="cadInfoX") this.select(null);
      else if(e.target.id==="cadHide"&&this.sel){ const s=this.sel; this.select(null); this.setHidden(s,true); }
      else if(e.target.id==="cadIsolate"&&this.sel&&View.exact){
        const keep=new Set(this.sel); View.hiddenParts=new Set(View.exact.res.meshes.map((m,j)=>j).filter(j=>!keep.has(j)));
        View.applyExact(); this.renderTree(); this.light(this.sel,"sel");
      }
    });
    addEventListener("keydown",e=>{
      if(!this.on||typing(e)) return;
      if(e.key==="f"||e.key==="F"){ this.fit(); e.preventDefault(); }
      else if(e.key==="Escape") this.select(null);
    });
  },
};
