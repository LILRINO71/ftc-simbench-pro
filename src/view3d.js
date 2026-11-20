/* ============================================================
   8.  3D VIEW — the BIOBUZZ field and the robot, driven by the sim
   The field floor is y = 0. The robot is its CAD parts drawn as solids,
   on a drawn drive base when the CAD has no wheels of its own, with a
   drawn flywheel shooter when the code shoots and the CAD has none.
   ============================================================ */
const FIELD_COL={tile:0x303336, seam:0x474b50, ground:0x0e0c09, alu:0xa9b0b8, rail:0x7c848d, poly:0xc9d8e3,
  red:0xe0453c, blue:0x2f7dea, redTape:0xd8372f, blueTape:0x2a6ad8, pollen:0xf2c230, flower:0xe4e7ea,
  arm:0x4a4f55, logo:0x1b1d20, honey:0xf2b230};
/* A camera's slight fall-off toward the corners (makePost, tier 2): 12% at the very
   corner, nothing over the middle two thirds of the frame. */
const VIGNETTE={
  uniforms:{tDiffuse:{value:null}, amount:{value:0.12}},
  vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
  fragmentShader:"uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;"+
    "void main(){ vec4 c=texture2D(tDiffuse,vUv); vec2 d=vUv-0.5; float v=smoothstep(0.32,0.78,length(d*vec2(1.0,0.82)));"+
    " gl_FragColor=vec4(c.rgb*(1.0-amount*v),c.a); }"
};
// the most triangles one material group of the robot gets edge lines for (see mkSolids)
const VIEW_EDGE_TRIS=200000;
// a shape with fewer copies than this is merged into its group's mesh rather than instanced (see applyInstanced)
const INST_MIN=3;
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
/* How each kind of part takes light, for the exact surfaces. The STEP's own
   colour is the colour; this is the finish: machined aluminium, steel screws,
   satin motor cans, moulded plastic, rubber rollers. Metal only looks like
   metal with something to reflect, so these materials see a studio
   environment (View.envMap): soft overhead and side light, not the field. */
const REAL_MAT={
  // A CAD grey is a plain colour, not aluminium's 90% reflectance: fully metal, it drew as a
  // dark mirror. Part metal keeps the grey the team drew and puts the sheen over it.
  metal:      {m:0.62, r:0.36, e:1.1},    // machined / brushed aluminium
  anodised:   {m:0.5,  r:0.32, e:0.95},   // goBILDA red, blue, gold: the colour is the dye, the sheen is the metal under it
  darkmetal:  {m:0.45, r:0.4,  e:0.8},    // black anodise, black oxide steel
  fastener:   {m:0.9,  r:0.3,  e:1.0},
  motor:      {m:0.6,  r:0.38, e:0.9},
  hub:        {m:0.3,  r:0.45, e:0.8},
  yellow:     {m:0.3,  r:0.45, e:0.8},
  servo:      {m:0.0,  r:0.5,  e:0.55},
  electronics:{m:0.05, r:0.48, e:0.55},
  printed:    {m:0.0,  r:0.58, e:0.5},    // PLA / PETG: satin, no metal
  orange:     {m:0.05, r:0.5,  e:0.6},
  wheel:      {m:0.0,  r:0.82, e:0.35},   // rubber rollers: dark, rough, a dull sheen
  belt:       {m:0.0,  r:0.92, e:0.25},
  clear:      {m:0.0,  r:0.06, e:1.2}
};
/* The finish for a part of this kind in this colour (hex "#rrggbb", or none). A
   metal part's colour says which metal it is: a saturated one is anodised (it keeps
   its colour, with less mirror than bare aluminium), a near-black one is black oxide
   or black anodise, anything else is bare aluminium. Only how it takes light
   changes; the colour stays the team's. */
function finishOf(kind,col){
  const P=REAL_MAT[kind]||REAL_MAT.metal;
  if(kind&&kind!=="metal") return P;
  const n=typeof col==="number"?col:typeof col==="string"&&/^#?[0-9a-f]{6}$/i.test(col)?parseInt(col.replace("#",""),16):null;
  if(n==null) return P;
  const r=(n>>16&255)/255, g=(n>>8&255)/255, b=(n&255)/255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2, s=mx===mn?0:(mx-mn)/(1-Math.abs(2*l-1));
  if(s>0.35&&l>0.12&&l<0.9) return REAL_MAT.anodised;
  if(l<0.2) return REAL_MAT.darkmetal;
  return P;
}
const View={
  init(el){
    this.el=el;
    this.scene=new THREE.Scene();
    this.cam=new THREE.PerspectiveCamera(42,1,0.01,200);
    // how much this machine can draw, decided before the first frame (src/tier.js)
    this.tier=this.readTier();
    const B=this.tier.budget;
    this.ren=new THREE.WebGLRenderer({antialias:B.tier>0, powerPreference:"high-performance", stencil:false});
    this.ren.setPixelRatio(Math.min(devicePixelRatio,B.pixelRatio));
    this.ren.setClearColor(0x000000,0);
    this.ren.shadowMap.enabled=B.shadows>0;
    this.ren.shadowMap.type=THREE.PCFShadowMap;            // PCFSoft is gone in r186; the sun's radius softens PCF
    // a camera's colour pipeline: light adds up in linear space, then Khronos PBR Neutral
    // maps it to the screen. ACES pushed every colour toward orange and crushed the
    // team's own part colours; AgX greyed them; Neutral keeps a goBILDA red red and
    // only rolls off what would clip, the curve product renders use
    this.ren.outputColorSpace=THREE.SRGBColorSpace;
    this.ren.toneMapping=THREE.NeutralToneMapping||THREE.ACESFilmicToneMapping; this.ren.toneMappingExposure=1.0;
    el.appendChild(this.ren.domElement);
    // after three.js's own handler (added first, so it runs first)
    this.ren.domElement.addEventListener("webglcontextrestored",()=>this.contextRestored());
    // Light in physical units (three r155+), as an event hall lights a field: one big
    // overhead key a little off to the side (the shadows fall short and soft), a dim
    // sky/floor bounce, a cool rim from the far side, and the studio environment (envMap)
    // for reflections and the soft light from everywhere. The old even wash (a bright
    // hemisphere plus a strong fill) lit every face the same and flattened the robot.
    this.hemi=new THREE.HemisphereLight(0xf1f0ec,0x26231f,0.55); this.scene.add(this.hemi);
    const sun=new THREE.DirectionalLight(0xfff4e8,4.2); this.sun=sun;
    sun.position.set(-1.9,6.2,2.5); sun.castShadow=B.shadows>0;
    sun.shadow.mapSize.set(B.shadows||512,B.shadows||512);
    if(B.lite) this.lowGfx=true;             // the robot's light copy from the start
    // the shadow box follows what the camera looks at (render(), fitShadow()): 3.6 m around
    // the robot in the robot views, the whole field in the driver's and the top view
    const sc=sun.shadow.camera; sc.left=-1.8; sc.right=1.8; sc.top=1.8; sc.bottom=-1.8; sc.near=1; sc.far=14;
    this.fitShadow(1.8);
    sun.shadow.radius=B.shadows>=4096?5:B.shadows>=2048?3:1.5;
    this.sunOff=sun.position.clone();
    this.scene.add(sun); this.scene.add(sun.target);
    // a cool rim from the far side: what the key leaves in shade still shows its edges
    const fill=new THREE.DirectionalLight(0xd4e0ff,0.9); fill.position.set(2.6,2.2,-2.8); this.scene.add(fill); this.fill=fill;
    // everything reflects the same studio (envMap), so metal reads as metal
    this.scene.environment=this.envMap()||null; this.scene.environmentIntensity=0.6;
    this.world=new THREE.Group(); this.scene.add(this.world);
    this.ray=new THREE.Raycaster();
    this.theta=-0.7; this.phi=1.15; this.rad=0.95; this.size=0.5;
    // the ambient-occlusion passes only where the tier can afford them (a tier-0 Chromebook draws plain)
    this.post=B.tier>0?this.makePost():null; this.postOn=B.tier>0;
    this.bind(); this.resize();
  },
  /* Post-processing: ambient occlusion (GTAO) grounds the robot on the tiles and
     darkens the gaps between parts, the way Onshape's viewport does; SMAA
     smooths the edges the MSAA buffer can't once a pass is in the chain. Off
     when the add-ons didn't load, and off when the frame-rate watchdog says so. */
  makePost(){
    const A=typeof window!=="undefined"&&window.THREE_ADDONS; if(!A||!A.EffectComposer) return null;
    const B=(this.tier&&this.tier.budget)||{}, aoN=B.aoSamples==null?12:B.aoSamples;
    try{
      const mk=cam=>{
        const c=new A.EffectComposer(this.ren);
        const rp=new A.RenderPass(this.scene,cam); c.addPass(rp);
        // a wider radius than the 6 cm it was: a robot sits IN the tiles' shade, not on top of them
        let ao=null;
        if(aoN>0){ ao=new A.GTAOPass(this.scene,cam,1,1); ao.output=A.GTAOPass.OUTPUT.Default; ao.blendIntensity=0.9;
          ao.updateGtaoMaterial({radius:0.11, distanceExponent:1.4, thickness:0.03, scale:1.1, samples:aoN, distanceFallOff:1, screenSpaceRadius:false});
          ao.updatePdMaterial({lumaPhi:10, depthPhi:2, normalPhi:3, radius:4, radiusExponent:1, rings:2, samples:16});
          c.addPass(ao); }
        const smaa=new A.SMAAPass(); c.addPass(smaa);
        // a slight darkening toward the corners, in linear light before the tone curve
        if(B.vignette&&A.ShaderPass) c.addPass(new A.ShaderPass(VIGNETTE));
        c.addPass(new A.OutputPass());
        return {c, rp, ao, smaa, cam};
      };
      return {mk, field:mk(this.cam), cad:null};
    }catch(e){ console.warn("bench: post-processing off",e); return null; }
  },
  /* The sun's shadow box, half metres across, and its biases to match. The robot's
     shadow is cast by its light copy (buildLite), a few millimetres off the exact
     surfaces it falls on, so the normal offset has a floor of 8 mm or those surfaces
     shade themselves in a checkerboard; past that it is a couple of shadow-map texels.
     (2 cm, as it was, slid every shadow out from under what cast it.) */
  fitShadow(half){
    const sun=this.sun; if(!sun||this.shadowHalf===half) return;
    this.shadowHalf=half;
    const sc=sun.shadow.camera; sc.left=-half; sc.right=half; sc.top=half; sc.bottom=-half; sc.updateProjectionMatrix();
    const texel=2*half/(sun.shadow.mapSize.x||1024);
    sun.shadow.bias=-0.0002; sun.shadow.normalBias=Math.max(0.008,2.2*texel);
  },
  /* draw the scene through a camera: with the passes when they're on, plain when not */
  draw(cam){
    const P=this.post;
    if(!P||!this.postOn||this.lowGfx){ this.ren.render(this.scene,cam); return; }
    let S=cam===this.cam?P.field:P.cad;
    if(!S||S.cam!==cam){ S=P.mk(cam); if(cam===this.cam) P.field=S; else P.cad=S; S.c.setSize(this.el.clientWidth||1,this.el.clientHeight||1); }
    S.c.render();
  },
  /* The machine, as the browser describes it: memory, cores, and the GPU's own
     name (asked of a throwaway WebGL context, so the real renderer can be built
     to fit). ?tier=0|1|2, or a tier saved in this browser, overrides. */
  readTier(){
    let renderer="", webgl2=null;
    try{
      const c=document.createElement("canvas"), gl=c.getContext("webgl2")||c.getContext("webgl");
      webgl2=!!(gl&&typeof WebGL2RenderingContext!=="undefined"&&gl instanceof WebGL2RenderingContext);
      if(gl){ const ext=gl.getExtension("WEBGL_debug_renderer_info"); renderer=String(gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER)||"");
        const lose=gl.getExtension("WEBGL_lose_context"); if(lose) lose.loseContext(); }
    }catch(e){}
    let override=null;
    try{ const q=new URLSearchParams(location.search).get("tier"), s=localStorage.getItem("ftcbench.tier"), v=q!=null?q:s;
      if(v!=null&&/^[012]$/.test(v)) override=+v; }catch(e){}
    const t=deviceTier({memoryGB:navigator.deviceMemory, cores:navigator.hardwareConcurrency, renderer, webgl2,
      mobile:tierMobile(navigator.userAgent, navigator.maxTouchPoints), override});
    try{ console.info("bench: drawing tier "+t.tier+" — "+t.why); }catch(e){}
    return t;
  },
  /* Drag the robot to move it, shift- or right-drag to turn it; drag
     anywhere else to orbit, wheel to zoom. */
  bind(){
    const c=this.ren.domElement; let orbit=false,lx=0,ly=0;
    c.addEventListener("contextmenu",e=>e.preventDefault());
    const cad=()=>typeof CadView!=="undefined"&&CadView.on;
    c.addEventListener("pointerdown",e=>{
      if(cad()) return;
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
      if(cad()) return;
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
    c.addEventListener("wheel",e=>{ if(cad()) return; e.preventDefault();
      this.rad=Math.max(0.12,Math.min(24,this.rad*(1+Math.sign(e.deltaY)*0.09))); },{passive:false});
    addEventListener("resize",()=>this.resize());
  },
  setCursor(k){ this.ren.domElement.style.cursor=k; },
  resize(){ const w=this.el.clientWidth,h=this.el.clientHeight; if(!w||!h) return;
    this.cam.aspect=w/h; this.cam.updateProjectionMatrix(); this.ren.setSize(w,h,false);
    const P=this.post; if(P) for(const S of [P.field,P.cad]) if(S) S.c.setSize(w,h); },
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
    if(this.onLoad) this.onLoad();
    this.loadN=(this.loadN||0)+1;                 // a new scene: whoever cached its objects (CadView.hid) looks again
    // another robot: the last one's exact surfaces go, GPU buffers and all, or a
    // hide click would redraw the old robot over this one
    if(this.exact&&this.exact.cad!==cad){ this.exact=null; this.exactG=[]; this.dropShapes(); this.shapeRes=null; this.spinWheels=[]; this.instHolder=null; }
    while(this.world.children.length){ const o=this.world.children[0]; this.world.remove(o); this.dispose(o); }
    if(this.cad&&this.cad!==cad) this.dropColourMats();
    const bb=cad.bbox;
    // A canonical CAD (src/frame.js) already has its origin at the drivetrain
    // centre on the floor — the point the physics turns the robot about — so it
    // is drawn from there. Centring on the bounding box instead made a robot
    // with an intake out the front swing it round like a door when it turned.
    this.c=cad.frame?[0,0,0]:[0,1,2].map(i=>(bb.min[i]+bb.max[i])/2);
    const size=Math.max(bb.max[0]-bb.min[0],bb.max[1]-bb.min[1],bb.max[2]-bb.min[2])||0.5;
    this.size=size; this.cad=cad;
    this.floorY=0;
    this.lift0=cad.frame?0:this.c[2]-bb.min[2];   // canonical: the floor is already z = 0
    this.look=null;

    this.fieldG=new THREE.Group(); this.world.add(this.fieldG);
    this.hiveG={}; this.shownHive=null; this.tipAnim=null; this.shownCells=-1;
    this.zones=(this.zones||[]).filter(z=>z.key==="ghost");      // the field's volumes went with the world
    if(Field.ok) this.buildField(); else this.buildPlainField();
    this.dynG=new THREE.Group(); this.world.add(this.dynG);
    // everything that lived in the last dynG went with it: ball trails and effects too,
    // or the trails would keep moving meshes that are no longer in the scene
    this.ballPool=[];
    this.matchG=null; this.matchShown=null;

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
    // a part's own colour (a robot read from Onshape): "rgb:r,g,b" in 0..255, as seen (sRGB)
    if(!this._rmat[k]&&/^rgb:/.test(k)){ const c=k.slice(4).split(",").map(Number), env=this.envMap();
      const col=new THREE.Color(c[0]/255,c[1]/255,c[2]/255); if(col.setRGB&&THREE.SRGBColorSpace) col.setRGB(c[0]/255,c[1]/255,c[2]/255,THREE.SRGBColorSpace);
      const m=new THREE.MeshStandardMaterial({color:col,metalness:0.3,roughness:0.55,envMap:env||null,envMapIntensity:0.7});
      m.userData.shared=true; this._rmat[k]=m; return m; }
    if(!this._rmat[k]){ const m=new THREE.MeshStandardMaterial(Object.assign({},ROBOT_MAT[k]||ROBOT_MAT.metal));
      // the same room to reflect as the light copy (liteMat): without it a metal part
      // reflects nothing and draws near-black, and the light copy, which has it, white,
      // so a slow computer switching copies turned the robot white
      const env=this.envMap(); if(env&&!m.transparent){ m.envMap=env; m.envMapIntensity=0.7; }
      m.userData.shared=true; this._rmat[k]=m; }
    return this._rmat[k];
  },
  /* The STEP file's own geometry, tessellated by OpenCascade (src/tessellate.js),
     in place of the convex hulls: the robot as Onshape draws it. Kept with the
     CAD it belongs to and re-applied on every rebuild, so a rig edit regroups
     the exact meshes too. Each mesh rides the mechanism of the part it came
     from; a group with no exact geometry keeps its hull. */
  setExact(cad,res){
    if(this.onLoad) this.onLoad();
    this.exact=res&&res.meshes&&res.meshes.length?{cad,res}:null;
    if(this.exact&&this.cad===cad) this.applyExact();
    return this.exact?this.exact.res.meshes.length:0;
  },
  /* The GPU context came back after being lost (a driver reset, a GPU switch;
     headless Chrome's software GL loses it seconds after start-up). three.js
     makes new buffers and programs as it draws, but two things stay broken:
     each geometry and texture still carries the dead context's dispose
     handler, so disposing it later (the next robot load) asks WebGL to delete a
     buffer or vertex array "that does not belong to this context", hundreds of
     warnings; and the reflection map was drawn on the GPU, so it came back
     black and every metal part with it. */
  contextRestored(){
    const seen=new Set(), old=this._env;
    const visit=x=>{
      if(!x||typeof x!=="object"||seen.has(x)) return; seen.add(x);
      // three keeps listeners in _listeners (r128 and r186 alike); the new context adds its own when it uploads again
      if(x.isBufferGeometry||x.isTexture){ if(x._listeners&&x._listeners.dispose) x._listeners.dispose.length=0; return; }
      if(x.isMaterial){ for(const k in x){ const v=x[k]; if(v&&v.isTexture) visit(v); } return; }
      if(x.isObject3D){ x.traverse(o=>{ visit(o.geometry); [].concat(o.material||[]).forEach(visit); }); return; }
      if(x instanceof Map||Array.isArray(x)) x.forEach(visit);
      else if(Object.getPrototypeOf(x)===Object.prototype) Object.values(x).forEach(visit);
    };
    // what is drawn, and what the caches hold for the next robot
    visit(this.scene); visit(this.shapeCache); visit(this.liteMeshes); visit(this.showMeshes);
    for(const k of Object.keys(this)) if(k[0]==="_") visit(this[k]);
    if(old){
      this._env=undefined; const env=this.envMap();
      for(const m of seen) if(m.isMaterial&&m.envMap===old){ m.envMap=env; m.needsUpdate=true; }
      // the whole scene reflects it too (three r155+: scene.environment), or every metal part stays dark
      if(this.scene&&this.scene.environment===old) this.scene.environment=env||null;
    }
  },
  /* A studio to reflect: a dim room with a big overhead softbox and side
     panels, pre-filtered once (PMREM) so every metal part picks up soft,
     believable highlights. Robot materials only; the field keeps its look. */
  envMap(){
    if(this._env!==undefined) return this._env;
    // A photo studio built from boxes: a dim grey hall with a big overhead softbox, two
    // tall strip lights at the sides, a warm low panel behind, and a mid-grey floor.
    // Metal reflects light bands against darker surroundings, so aluminium reads as
    // aluminium; three's RoomEnvironment is bright all round, and every metal part in it
    // came out the same flat light grey.
    const A=typeof window!=="undefined"&&window.THREE_ADDONS;
    if(this.envKind==="room"&&A&&A.RoomEnvironment){ try{ const pm=new THREE.PMREMGenerator(this.ren); this._env=pm.fromScene(new A.RoomEnvironment(),0.04).texture; pm.dispose(); return this._env; }catch(e){} }
    try{
      const pm=new THREE.PMREMGenerator(this.ren), room=new THREE.Scene(), box=new THREE.BoxGeometry(1,1,1);
      const shell=new THREE.Mesh(box,new THREE.MeshBasicMaterial({color:0x767a82, side:THREE.BackSide}));
      shell.scale.set(20,10,20); shell.position.y=4; room.add(shell);
      const lamp=(x,y,z,sx,sy,sz,c)=>{ const m=new THREE.Mesh(box,new THREE.MeshBasicMaterial({color:c}));
        m.position.set(x,y,z); m.scale.set(sx,sy,sz); room.add(m); };
      const I=(i,r,g,b)=>new THREE.Color(i*(r||1),i*(g||1),i*(b||1));
      lamp(0,-0.95,0, 19.8,0.1,19.8, 0x6e7175);           // the floor: grey tiles
      lamp(0,8.9,0, 11,0.1,7, I(6.0,1,0.98,0.95));         // overhead softbox
      lamp(-9.8,3.6,1.5, 0.1,6,2.2, I(4.0));               // strip light, key side
      lamp(9.8,3.6,-2.5, 0.1,5,1.8, I(2.6,0.92,0.96,1));   // strip light, cool side
      lamp(2,2.4,-9.8, 9,2.2,0.1, I(1.8,1,0.92,0.82));     // a low warm panel behind
      lamp(-3,6,9.8, 6,3,0.1, I(1.4));                     // a panel in front
      this._env=pm.fromScene(room,0.035).texture; pm.dispose();
      room.traverse(o=>{ if(o.material) o.material.dispose(); }); box.dispose();
    }catch(e){ this._env=null; }                    // no float render targets: plain lighting still works
    return this._env;
  },
  /* One material per colour and finish, shared by every part that has them. */
  finishMat(col,kind){
    const key=(col||"")+"|"+kind; this._mats=this._mats||{};
    if(this._mats[key]) return this._mats[key];
    const base=ROBOT_MAT[kind]||ROBOT_MAT.metal, P=finishOf(kind,col), env=this.envMap();
    // with nothing to reflect, metal just goes black: keep it low then
    const mat=new THREE.MeshStandardMaterial({color:col?new THREE.Color(col):base.color,
      metalness:env?P.m:Math.min(0.2,P.m), roughness:env?P.r:Math.max(0.45,P.r),
      envMap:env||null, envMapIntensity:P.e,
      transparent:!!base.transparent, opacity:base.opacity==null?1:base.opacity, depthWrite:base.depthWrite!==false,
      // faces sit a hair behind their edges, so the lines never z-fight
      polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1});
    mat.userData.shared=true;
    return this._mats[key]=mat;
  },
  /* Another robot: the last one's colours go. The material caches are keyed by
     colour, so without this every robot loaded added its palette for good (an
     Onshape robot has one per part colour). The fixed finishes stay. */
  dropColourMats(){
    for(const k in this._mats||{}) this._mats[k].dispose();
    this._mats={};
    for(const k in this._rmat||{}) if(/^rgb:/.test(k)){ this._rmat[k].dispose(); delete this._rmat[k]; }
  },
  /* A shape meshed once (src/tessellate.js tessExpand) as GPU geometry: one
     draw group per run of faces in one colour, plus its edges. Shared by every
     copy; freed when the next robot's surfaces arrive. */
  instGeo(m){
    const k=m.attributes.position.array; this.shapeCache=this.shapeCache||new Map();
    let e=this.shapeCache.get(k); if(e) return e;
    const g=new THREE.BufferGeometry();
    if(m.shape){
      // an export's thinned mesh has its vertices welded, so averaged normals smear every corner
      // into a blob: crease-angle normals instead (smooth across a fillet, sharp at a 45-degree edge)
      const C=creaseNormals(k,m.index.array,45);
      g.setAttribute("position",new THREE.BufferAttribute(C.pos,3)); g.setAttribute("normal",new THREE.BufferAttribute(C.nor,3));
    } else {
      g.setAttribute("position",new THREE.BufferAttribute(k,3));
      if(m.attributes.normal&&m.attributes.normal.array) g.setAttribute("normal",new THREE.BufferAttribute(m.attributes.normal.array,3));
      g.setIndex(new THREE.BufferAttribute(m.index.array,1));
      if(!g.attributes.normal) g.computeVertexNormals();
    }
    const runs=[], faces=m.brep_faces&&m.brep_faces.length?m.brep_faces:[{first:0,last:m.index.array.length/3-1,color:null}];
    for(const f of faces){ const col=tessColorHex(f.color)||tessColorHex(m.color)||"", last=runs[runs.length-1];
      if(last&&last.col===col&&last.end===f.first) last.end=f.last+1; else runs.push({col, start:f.first, end:f.last+1}); }
    runs.forEach((r,i)=>g.addGroup(r.start*3,(r.end-r.start)*3,i));
    g.computeBoundingSphere(); g.userData.shared=true;
    // an export's thinned mesh (m.shape): edges only at real corners, and none at all on a dense one
    // (every facet of a 20,000-triangle roller read as an edge: the robot looked wire-framed)
    const segs=m.shape?(m.index.array.length>3*6000?new Float32Array(0):meshEdgeSegs(m,62)):meshEdgeSegs(m); let eg=null;
    if(segs.length){ eg=new THREE.BufferGeometry(); eg.setAttribute("position",new THREE.BufferAttribute(segs,3)); eg.userData.shared=true; }
    e={g, runs, eg}; this.shapeCache.set(k,e); return e;
  },
  dropShapes(){
    for(const e of (this.shapeCache||new Map()).values()){ e.g.dispose(); if(e.eg) e.eg.dispose(); }
    this.shapeCache=new Map();
  },
  /* Where a placed copy sits in the view: its occurrence placement, then the
     robot frame, then canonical (Z up) -> view (Y up) as v3() does. */
  instMatrix(cad,m,out){
    const c=this.c, A=placeM(frameM(cad),m.T);
    const V=new THREE.Matrix4().set(1,0,0,-c[0], 0,0,1,-c[2], 0,-1,0,c[1], 0,0,0,1);
    return (out||new THREE.Matrix4()).multiplyMatrices(V,
      new THREE.Matrix4().set(A[0],A[1],A[2],A[3], A[4],A[5],A[6],A[7], A[8],A[9],A[10],A[11], 0,0,0,1));
  },
  /* Per-shape surfaces as instances: one InstancedMesh per shape per
     mechanism group and finish, so a 773-part robot is ~150 draw calls over
     its 99 shapes' triangles, not 3.4 million copied ones. Each copy keeps its
     own index (userData.js) for picking and hiding. A shape with one or two
     copies (an export robot is mostly those) is merged instead: one mesh per
     group and colour, its triangles mapped back to parts (userData.ranges). */
  applyInstanced(cad,res,asg,hidden){
    // the drive wheels turn: every chassis copy whose centre sits inside a drive
    // wheel's cylinder (hub, rollers, side plates, the wheel's own screws) goes
    // in that wheel's spin group, which update() turns about the axle
    const dw=(typeof driveFromCAD==="function"?driveFromCAD(cad,{front:(Sim.opts&&Sim.opts.front)||"+x"}).wheels:[]).filter(w=>w.c&&w.axis);
    // a joint held as drawn is drawn with the group above it (tessFold); one seen moving is split back out
    const fold=tessFold(cad.mechs,this.movingMechs(cad));
    this.folded=new Set((cad.mechs||[]).filter(m=>fold(m.id)!==m.id).map(m=>m.id));
    const wheelOf=(j,g)=>{
      if(g!=="chassis"||!dw.length) return -1;
      const b=asg.boxes&&asg.boxes[j]; if(!b||!Number.isFinite(b.min[0])) return -1;
      const p=[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,(b.min[2]+b.max[2])/2], ext=partExtent(b);
      for(let k=0;k<dw.length;k++){
        const w=dw[k]; if(ext>2.2*w.r) continue;            // bigger than the wheel: not part of it
        const a=w.axis, d=[p[0]-w.c[0],p[1]-w.c[1],p[2]-w.c[2]], t=d[0]*a[0]+d[1]*a[1]+d[2]*a[2];
        if(Math.hypot(d[0]-t*a[0],d[1]-t*a[1],d[2]-t*a[2])<=w.r+0.003&&Math.abs(t)<=(w.width||0.05)/2+0.004) return k;
      }
      return -1;
    };
    this.spinWheels=[];
    const spinG=[], M=new THREE.Matrix4(), off=new THREE.Matrix4();
    const holder=(g,k)=>{
      const parent=this.groupAt[g]||this.groupAt.chassis; if(k<0||!parent) return {parent, off:null};
      if(!spinG[k]){ const w=dw[k], G=new THREE.Group(); G.position.copy(this.v3(w.c)); parent.add(G); this.exactG.push(G);
        const av=this.vAxis(w.axis).normalize();
        spinG[k]={G, off:new THREE.Matrix4().makeTranslation(-G.position.x,-G.position.y,-G.position.z)};
        this.spinWheels.push({G, av, a:w.axis.slice(), c:w.c.slice()}); }
      return {parent:spinG[k].G, off:spinG[k].off};
    };
    const bins=new Map(), got=new Set();
    res.meshes.forEach((m,j)=>{
      if(hidden&&hidden.has(j)) return;
      if(!m.index||!m.index.array||!m.index.array.length) return;
      const g=fold(asg.group[j]), si=asg.solid[j], kind=(si>=0&&cad.solids[si]&&cad.solids[si].kind)||"metal";
      got.add(asg.group[j]);
      const wk=wheelOf(j,g), k=m.attributes.position.array, key=g+"|"+kind+"|"+wk;
      let b=bins.get(k); if(!b){ b=new Map(); bins.set(k,b); }
      let e=b.get(key); if(!e){ e={m, g, kind, wk, js:[]}; b.set(key,e); }
      e.js.push(j);
    });
    const edgeBins=new Map(), batches=new Map();
    this.instHolder=new Map();                       // copy -> where it lives, for highlights
    for(const b of bins.values()) for(const e of b.values()){
      const h=holder(e.g,e.wk), parent=h.parent; if(!parent) continue;
      for(const j of e.js) this.instHolder.set(j,h);
      const place=j=>{ this.instMatrix(cad,res.meshes[j],M); return h.off?M.premultiply(h.off):M; };
      const S=this.instGeo(e.m);
      if(S.eg){ let L=edgeBins.get(parent); if(!L){ L=[]; edgeBins.set(parent,L); }
        for(const j of e.js) L.push({a:S.eg.attributes.position.array, m:place(j).clone()}); }
      got.add(e.g);
      // a shape with only a copy or two (most of an export's parts): its triangles join
      // one mesh per group and finish, where an instance each was ~2,600 draw calls
      if(e.js.length<INST_MIN){
        let byMat=batches.get(parent); if(!byMat){ byMat=new Map(); batches.set(parent,byMat); }
        const P=S.g.attributes.position.array, N=S.g.attributes.normal.array, I=S.g.index?S.g.index.array:null;
        for(const j of e.js){ const mj=Float64Array.from(place(j).elements);
          for(const r of S.runs){ const key=r.col+"|"+e.kind; let B=byMat.get(key); if(!B){ B={col:r.col, kind:e.kind, items:[]}; byMat.set(key,B); }
            B.items.push({pos:P, nor:N, idx:I, m:mj, j, start:r.start, end:r.end}); } }
        continue;
      }
      const mats=S.runs.map(r=>this.finishMat(r.col||null,e.kind));
      const inst=new THREE.InstancedMesh(S.g,mats.length===1?mats[0]:mats,e.js.length);
      e.js.forEach((j,i)=>inst.setMatrixAt(i,place(j)));
      inst.instanceMatrix.needsUpdate=true;
      // the geometry's own bounds are one copy's; the copies are all over the robot
      inst.frustumCulled=false; inst.castShadow=true; inst.receiveShadow=true;
      inst.userData.js=e.js;
      parent.add(inst); this.exactG.push(inst);
    }
    for(const [parent,byMat] of batches) for(const B of byMat.values()){
      const R=tessBatch(B.items), geo=new THREE.BufferGeometry();
      geo.setAttribute("position",new THREE.BufferAttribute(R.pos,3)); geo.setAttribute("normal",new THREE.BufferAttribute(R.nor,3));
      geo.computeBoundingSphere();
      const mesh=new THREE.Mesh(geo,this.finishMat(B.col||null,B.kind)); mesh.castShadow=true; mesh.receiveShadow=true;
      mesh.userData.ranges=R.ranges;                 // which part each triangle is, for picking
      parent.add(mesh); this.exactG.push(mesh);
    }
    // every copy's edges in one set of lines per group (one draw, where one per copy was ~800)
    for(const [parent,L] of edgeBins){
      let n=0; for(const x of L) n+=x.a.length;
      const out=new Float32Array(n); let o=0;
      for(const {a,m} of L){ const E=m.elements;
        for(let i=0;i<a.length;i+=3){ const x=a[i], y=a[i+1], z=a[i+2];
          out[o++]=E[0]*x+E[4]*y+E[8]*z+E[12]; out[o++]=E[1]*x+E[5]*y+E[9]*z+E[13]; out[o++]=E[2]*x+E[6]*y+E[10]*z+E[14]; } }
      const geo=new THREE.BufferGeometry(); geo.setAttribute("position",new THREE.BufferAttribute(out,3));
      const Ls=new THREE.LineSegments(geo,this.edgeMat()); Ls.userData.edges=true; Ls.visible=this.edgesOn!==false; Ls.frustumCulled=false;
      parent.add(Ls); this.exactG.push(Ls);
    }
    this.hullBase={}; for(const g in this.hullOf){ this.hullBase[g]=!got.has(g); this.hullOf[g].visible=this.hullBase[g]&&!this.useLite; }
  },
  /* joints that move after all: a device drives it, the joint editor is trying it, or update() saw it move */
  movingMechs(cad){
    if(!this.moved||this.moved.cad!==cad) this.moved={cad, ids:new Set()};
    const out=new Set(this.moved.ids);
    for(const m of (cad&&cad.mechs)||[]) if(typeof deviceOn==="function"&&deviceOn(m.id)) out.add(m.id);
    if(this.preview&&this.preview.id) out.add(this.preview.id);
    return out;
  },
  applyExact(){
    for(const o of this.exactG||[]){ if(o.parent) o.parent.remove(o); this.dispose(o); }
    this.exactG=[]; this.folded=null;
    const {cad,res}=this.exact, hidden=this.hiddenParts;
    const asg=this.exactAsg=tessAssign(cad,res,this.turretScale);
    if(res.perShape){
      if(this.shapeRes!==res){ this.dropShapes(); this.shapeRes=res; }
      this.applyInstanced(cad,res,asg,hidden); this.scheduleLite(); return;
    }
    const list=tessBuckets(cad,res,asg,hidden);
    const c=this.c, got=new Set();
    const toView=(src,n)=>{ const out=new Float32Array(n);
      // canonical (Z up) -> view (Y up), exactly as v3() does for the parser's points
      for(let i=0;i<n;i+=3){ out[i]=src[i]-c[0]; out[i+1]=src[i+2]-c[2]; out[i+2]=-(src[i+1]-c[1]); }
      return out; };
    for(const b of list){
      const parent=this.groupAt[b.group]||this.groupAt.chassis; if(!parent) continue;
      const n=b.pos.length, pos=toView(b.pos,n), nor=new Float32Array(n);
      for(let i=0;i<n;i+=3){ nor[i]=b.nor[i]; nor[i+1]=b.nor[i+2]; nor[i+2]=-b.nor[i+1]; }
      const geo=new THREE.BufferGeometry();
      geo.setAttribute("position",new THREE.BufferAttribute(pos,3));
      geo.setAttribute("normal",new THREE.BufferAttribute(nor,3));
      geo.setIndex(new THREE.BufferAttribute(b.idx,1));
      if(!b.hasNormals) geo.computeVertexNormals();
      // the file's own colour when it has one (what makes it look like Onshape),
      // else the palette for what the part is made of; the finish by kind
      const mat=this.finishMat(b.color,b.kind);
      const mesh=new THREE.Mesh(geo,mat); mesh.castShadow=true; mesh.receiveShadow=true;
      mesh.userData.ranges=b.ranges;
      parent.add(mesh); this.exactG.push(mesh); got.add(b.group);
    }
    // the model's real edges, the thin dark lines that make CAD look like CAD
    for(const e of tessEdges(cad,res,asg,hidden)){
      const parent=this.groupAt[e.group]||this.groupAt.chassis; if(!parent) continue;
      const geo=new THREE.BufferGeometry(); geo.setAttribute("position",new THREE.BufferAttribute(toView(e.pos,e.pos.length),3));
      const lines=new THREE.LineSegments(geo,this.edgeMat()); lines.userData.edges=true; lines.visible=this.edgesOn!==false;
      parent.add(lines); this.exactG.push(lines);
    }
    this.hullBase={}; for(const g in this.hullOf){ this.hullBase[g]=!got.has(g); this.hullOf[g].visible=this.hullBase[g]&&!this.useLite; }
    this.scheduleLite();
  },
  edgeMat(){ if(!this._edgeMat){ this._edgeMat=new THREE.LineBasicMaterial({color:0x1b1e22, transparent:true, opacity:0.85}); this._edgeMat.userData.shared=true; } return this._edgeMat; },
  showEdges(on){ this.edgesOn=on; this.scene.traverse(o=>{ if(o.userData&&o.userData.edges) o.visible=on; }); this.applyQuality(); },

  /* ---------------- the light copy (src/robotlite.js) ----------------
     Built from what this view draws, a moment after the robot's surfaces
     arrive or it's rebuilt, in the same segments: the chassis (in the
     chassis group's frame) and each mechanism (in its own group's frame).
     It casts the robot's shadow (3.4 million triangles drawn twice a frame
     was most of the lag), draws the robot in the driver's view and on a slow
     computer, and is what an online match sends the other teams. */
  scheduleLite(){ clearTimeout(this._liteT); this._liteT=setTimeout(()=>this.buildLite(),600); },
  segRoots(){
    const out=[{id:"chassis", root:this.chassisG}];
    for(const m of (this.cad&&this.cad.mechs)||[]) if(m._g&&this.groupAt&&this.groupAt[m.id]) out.push({id:m.id, root:this.groupAt[m.id]});
    return out;
  },
  liteInput(){
    this.chassisG.updateMatrixWorld(true);
    const links=new Set(), skip=new Set([this.footG,this.hitBox].filter(Boolean)), marks=new Set(this.markers||[]);
    for(const m of this.cad.mechs) if(m._g) links.add(m._g);
    const shapes=[], shapeOf=new Map(), parts=[], pal=[], palOf=new Map();
    const palIdx=c=>{ const hex=c?c.getHex():0xb4b8be; let k=palOf.get(hex);
      if(k===undefined){ k=pal.length<255?pal.length:0; if(k===pal.length) pal.push([(hex>>16)&255,(hex>>8)&255,hex&255]); palOf.set(hex,k); } return k; };
    const inv=new THREE.Matrix4(), rel=new THREE.Matrix4(), I=new THREE.Matrix4(), M=new THREE.Matrix4();
    const shapeFor=o=>{
      const geo=o.geometry, mats=Array.isArray(o.material)?o.material:[o.material], key=geo.uuid+"|"+mats.map(m=>m.uuid).join(",");
      if(shapeOf.has(key)) return shapeOf.get(key);
      const P=geo.attributes.position, pos=P.array instanceof Float32Array&&P.itemSize===3&&!P.isInterleavedBufferAttribute?P.array:Float32Array.from({length:P.count*3},(_,i)=>P.getComponent?P.getComponent(Math.floor(i/3),i%3):0);
      const idx=geo.index?geo.index.array:null, nt=(idx?idx.length:P.count)/3;
      let tc=palIdx(mats[0]&&mats[0].color);
      if(mats.length>1&&geo.groups.length){ tc=new Uint8Array(nt);
        for(const g of geo.groups){ const k=palIdx(mats[g.materialIndex]&&mats[g.materialIndex].color); tc.fill(k,Math.floor(g.start/3),Math.min(nt,Math.floor((g.start+g.count)/3))); } }
      const s=shapes.length; shapes.push({pos, idx, tc}); shapeOf.set(key,s); return s;
    };
    for(const {id,root} of this.segRoots()){
      inv.copy(root.matrixWorld).invert();
      const walk=o=>{
        if(o!==root&&(links.has(o)||skip.has(o))) return;
        if(!o.visible) return;
        const mat=Array.isArray(o.material)?o.material[0]:o.material;
        if(o.isMesh&&!o.userData.lite&&!marks.has(o)&&o.geometry&&o.geometry.attributes.position&&mat&&!(mat.transparent&&mat.opacity<0.6)){
          const s=shapeFor(o); rel.multiplyMatrices(inv,o.matrixWorld);
          if(o.isInstancedMesh) for(let i=0;i<o.count;i++){ o.getMatrixAt(i,I); M.multiplyMatrices(rel,I); parts.push({seg:id, shape:s, m:Float32Array.from(M.elements)}); }
          else parts.push({seg:id, shape:s, m:Float32Array.from(rel.elements)});
        }
        for(const c of o.children) walk(c);
      };
      walk(root);
    }
    return {shapes, parts, pal};
  },
  buildLite(){
    if(!this.cad||!this.chassisG||typeof liteBuild!=="function") return;
    let L=null, Lshow=null;
    this.applyQuality(true);                             // read the robot as it really is, not its light copy
    // Two copies. The small one (70,000 triangles) is the robot's shadow, what the driver's
    // view draws, and what an online match sends. The fuller one is what a computer that
    // can't draw the whole robot draws up close: as many triangles as its tier affords
    // (src/tier.js ownTris). It was the 70,000 one there too, and a robot seen from a metre
    // away in 70,000 triangles is the "rendering" a 4 GB Chromebook got. A robot that fits
    // the tier's budget whole needs no fuller copy: it is drawn as it is.
    const own=this.tier&&this.tier.budget&&this.tier.budget.ownTris;
    this.showBudget=Math.min(600000,Number.isFinite(own)?own:600000);
    try{ const t0=performance.now(), inp=this.liteInput();
      let exact=0; for(const p of inp.parts){ const sh=inp.shapes[p.shape]; exact+=(sh.idx?sh.idx.length:sh.pos.length/3)/3; }
      this.exactTris=exact;
      L=liteBuild(inp,{budget:70000});
      if(exact>this.showBudget) Lshow=liteBuild(inp,{budget:this.showBudget});
      this.liteMs=Math.round(performance.now()-t0); }
    catch(e){ console.warn("bench: light copy",e); return; }
    for(const m of (this.liteMeshes||[]).concat(this.showMeshes||[])){ if(m.parent) m.parent.remove(m); m.geometry.dispose(); }
    this.liteMeshes=[]; this.showMeshes=[]; this.lite=L; this.liteShow=Lshow;
    for(const s of L.segs){
      const root=s.id==="chassis"?this.chassisG:this.groupAt[s.id]; if(!root) continue;
      const m=new THREE.Mesh(this.liteGeo(s,L.pal),this.shadowMat()); m.userData.lite=true; m.castShadow=true; m.frustumCulled=false;
      root.add(m); this.liteMeshes.push(m);
    }
    for(const s of Lshow?Lshow.segs:[]){
      const root=s.id==="chassis"?this.chassisG:this.groupAt[s.id]; if(!root) continue;
      const m=new THREE.Mesh(this.liteGeo(s,Lshow.pal,true),this.showMat()); m.userData.lite=true; m.castShadow=false; m.receiveShadow=true; m.frustumCulled=false; m.visible=false;
      root.add(m); this.showMeshes.push(m);
    }
    this.applyQuality();
    if(this.onLite) this.onLite(L);
  },
  /* A light copy's segment as triangles in its palette colours: flat-shaded, or (smooth) with
     each corner's normal averaged over the faces that lean less than 40 degrees from its own,
     so a cylinder is round and a plate's edge stays an edge (src/tessellate.js creaseNormals). */
  liteGeo(s,pal,smooth){
    const nt=s.t.length/3, col=new Float32Array(nt*9);
    let pos, nor=null;
    if(smooth&&typeof creaseNormals==="function"){ const C=creaseNormals(s.v,s.t,40); pos=C.pos; nor=C.nor; }
    else { pos=new Float32Array(nt*9);
      for(let f=0;f<nt;f++) for(let k=0;k<3;k++){ const v=s.t[3*f+k], o=9*f+3*k; pos[o]=s.v[3*v]; pos[o+1]=s.v[3*v+1]; pos[o+2]=s.v[3*v+2]; } }
    // vertex colours are linear light; the palette is as seen (sRGB)
    for(let f=0;f<nt;f++){ const c=pal[s.tc[f]]||pal[0], r=toLin(c[0]/255), g=toLin(c[1]/255), b=toLin(c[2]/255);
      for(let k=0;k<3;k++){ const o=9*f+3*k; col[o]=r; col[o+1]=g; col[o+2]=b; } }
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setAttribute("color",new THREE.BufferAttribute(col,3));
    if(nor) g.setAttribute("normal",new THREE.BufferAttribute(nor,3)); else g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  },
  /* lit like the full robot's own materials (robotMat), so switching copies doesn't change how it looks */
  liteMat(){ if(!this._liteMat){ const env=this.envMap(); this._liteMat=new THREE.MeshStandardMaterial({vertexColors:true, flatShading:true,
      metalness:env?0.62:0.2, roughness:env?0.38:0.5, envMap:env||null, envMapIntensity:1.0}); this._liteMat.userData.shared=true; } return this._liteMat; },
  /* the fuller copy's: the same, with its own normals instead of one per face */
  showMat(){ if(!this._showMat){ const env=this.envMap(); this._showMat=new THREE.MeshStandardMaterial({vertexColors:true,
      metalness:env?0.62:0.2, roughness:env?0.38:0.5, envMap:env||null, envMapIntensity:1.0}); this._showMat.userData.shared=true; } return this._showMat; },
  /* drawn into the shadow map only */
  shadowMat(){ if(!this._shadowMat){ this._shadowMat=new THREE.MeshBasicMaterial({colorWrite:false, depthWrite:false}); this._shadowMat.userData.shared=true; } return this._shadowMat; },
  /* Which copy draws: the exact one up close; the small light one in the driver's view,
     where the robot is small on screen; and on a computer that can't keep up, the fuller
     light copy up close, or the exact robot still when it fits what that computer affords.
     With a light copy, the small one casts the shadow either way. */
  applyQuality(exactOnly){
    const has=!!(this.liteMeshes&&this.liteMeshes.length);
    const cad=typeof CadView!=="undefined"&&CadView.on;
    const far=this.mode==="field", fits=this.exactTris!=null&&this.exactTris<=this.showBudget;
    const lite=has&&!exactOnly&&!cad&&(far||(this.lowGfx&&!fits));
    const fuller=lite&&!far&&!!(this.showMeshes&&this.showMeshes.length);
    for(const g in this.hullOf||{}) this.hullOf[g].visible=(!this.hullBase||this.hullBase[g]!==false)&&!lite;
    for(const o of this.exactG||[]){
      if(o.userData&&o.userData.edges){ o.visible=!lite&&this.edgesOn!==false; continue; }
      if(o.isMesh){ o.visible=!lite; o.castShadow=!has; o.receiveShadow=!has; }
    }
    for(const m of this.liteMeshes||[]){ m.material=lite&&!fuller?this.liteMat():this.shadowMat(); m.receiveShadow=lite&&!fuller; }
    for(const m of this.showMeshes||[]) m.visible=fuller;
    this.useLite=lite;
  },
  /* Where each mechanism is right now, relative to the chassis, in the light
     copy's segment order: [x, y, z mm, quaternion x, y, z, w x 10^4] each. */
  segJoints(){
    const L=this.lite; if(!L||!this.chassisG) return null;
    this.chassisG.updateMatrixWorld(true);
    const inv=new THREE.Matrix4().copy(this.chassisG.matrixWorld).invert(), M=new THREE.Matrix4();
    const p=new THREE.Vector3(), q=new THREE.Quaternion(), s=new THREE.Vector3(), out=[];
    for(const seg of L.segs){
      if(seg.id==="chassis") continue;
      const root=this.groupAt[seg.id]; if(!root){ out.push(0,0,0,0,0,0,10000); continue; }
      M.multiplyMatrices(inv,root.matrixWorld); M.decompose(p,q,s);
      out.push(Math.round(p.x*1000),Math.round(p.y*1000),Math.round(p.z*1000),Math.round(q.x*1e4),Math.round(q.y*1e4),Math.round(q.z*1e4),Math.round(q.w*1e4));
    }
    return out;
  },
  /* Another team's robot from its light copy: the chassis, and each mechanism
     placed where their computer last said, with their team over it. */
  buildRemote(p,model){
    const g=new THREE.Group(), segs=[]; let top=0.3;
    for(const s of model.segs){
      const G=new THREE.Group(), geo=this.liteGeo(s,model.pal), m=new THREE.Mesh(geo,this.liteMat());
      m.castShadow=true; m.receiveShadow=true; G.add(m); g.add(G);
      if(s.id==="chassis") top=Math.max(top,geo.boundingBox.max.y); else { G.visible=false; segs.push({G, init:false}); }
    }
    const tag=this.nameTag(p.name,p.al); tag.position.y=top+0.16; g.add(tag);
    g.userData.segs=segs; g.userData.remote=true;
    return g;
  },
  nameTag(text,al){
    const cv=document.createElement("canvas"); cv.width=512; cv.height=112;
    const c=cv.getContext("2d"); c.fillStyle=al==="red"?"rgba(196,52,44,.92)":"rgba(40,96,200,.92)";
    const r=40; c.beginPath(); c.moveTo(r,8); c.arcTo(504,8,504,104,r); c.arcTo(504,104,8,104,r); c.arcTo(8,104,8,8,r); c.arcTo(8,8,504,8,r); c.fill();
    fitFont(c,text,440,60,24,"Inter, -apple-system, system-ui, Arial, sans-serif");
    c.fillStyle="#fff"; c.textAlign="center"; c.textBaseline="middle"; c.fillText(text,256,60);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:srgbTex(new THREE.CanvasTexture(cv)), depthWrite:false}));
    sp.scale.set(0.46,0.1,1); sp.renderOrder=6;
    return sp;
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
    // only links that can move claim parts: a fixed mount (and drive hardware,
    // which the parser marks fixed) leaves its neighbours on the chassis
    const segs=M.filter(m=>m.pivot&&m.kind!=="fixed").map(m=>({id:m.id, m, a:m.pivot, b:m.distalTo||m.pivot}));
    /* Points far out from a root joint's axis are frame, not turret — they
       stay behind while the column above the joint swings. */
    const radialTo=(p,m)=>{
      const a=m.pivot, ax=m.axis;
      const d=[p[0]-a[0],p[1]-a[1],p[2]-a[2]];
      const t=d[0]*ax[0]+d[1]*ax[1]+d[2]*ax[2];
      return Math.hypot(d[0]-ax[0]*t, d[1]-ax[1]*t, d[2]-ax[2]*t);
    };
    const wheel=inDriveWheel(cad);
    const owner=(p,ext)=>{
      if(!segs.length||wheel(p,ext)) return "chassis";      // a drive wheel is the chassis's
      let best=null, bd=1e9;
      for(const s of segs){ const d=distSeg(p,s.a,s.b); if(d<bd){bd=d; best=s;} }
      let id=best.id; const m=best.m;
      // a leaf effector only claims what is genuinely near it
      if(!rigKids(M,m.id).length && m.lever>0 && bd>m.lever*0.55 && m.parent!=="chassis") id=m.parent;
      // and a root joint only carries what sits inside its turret radius
      const root=M.filter(x=>x.id===id)[0];
      if(root && root.parent==="chassis" && root.kind==="revolute-yaw"){
        const turretR=Math.max(size*0.10, (root.lever||size*0.3)*this.turretScale);
        // and nothing beneath its own bearing: the battery under a turret stays put
        if(radialTo(p,root)>turretR||p[2]<root.pivot[2]-0.02) id="chassis";
      }
      return id;
    };
    const groups={chassis:[]};
    M.forEach(m=>groups[m.id]=[]);
    const solids=cad.solids&&cad.solids.length?cad.solids:null;
    if(solids){
      for(const s of solids){
        const c=[0,0,0]; for(const p of s.pts){ c[0]+=p[0]; c[1]+=p[1]; c[2]+=p[2]; }
        // Onshape mates say exactly which joint carries a part (src/mates.js)
        const g=cad.mates?(s.mech&&groups[s.mech]?s.mech:"chassis"):owner(c.map(v=>v/s.pts.length),partExtent(s.pts));
        (groups[g]||groups.chassis).push(s);
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
        const mk=s.color&&s.keepTri?"rgb:"+s.color.map(v=>Math.round(v*255)).join(","):(s.kind||"metal");
        (byKind[mk]=byKind[mk]||[]).push(s.tri);
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
        // the edge lines are a look, not the robot: EdgesGeometry hashes every edge of the
        // group (hundreds of megabytes on a dense Onshape export), so a huge group goes without
        if(n/9<=VIEW_EDGE_TRIS){
          const lines=new THREE.LineSegments(new THREE.EdgesGeometry(geo,30),this.edgeMat());
          lines.userData.edges=true; lines.visible=this.edgesOn!==false; g.add(lines);
        }
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
        col[i*3]=toLin(0.74*t); col[i*3+1]=toLin(0.72*t); col[i*3+2]=toLin(0.68*t);
      }
      const g=new THREE.BufferGeometry();
      g.setAttribute("position",new THREE.BufferAttribute(pos,3));
      g.setAttribute("color",new THREE.BufferAttribute(col,3));
      return new THREE.Points(g,new THREE.PointsMaterial({size:size*0.0042,vertexColors:true,sizeAttenuation:true}));
    };
    const mk=list=>solids?mkSolids(list):mkPoints(list);

    // where each group's parts hang, so the exact meshes can replace the hulls
    this.groupAt={chassis:this.liftG}; this.hullOf={};
    const chas=mk(groups.chassis); if(chas){ this.liftG.add(chas); this.hullOf.chassis=chas; }

    /* ---- the hierarchy from the rig, whatever shape it is ---- */
    this.jawSets=[]; this.markers=[];
    const markMat=new THREE.MeshBasicMaterial({color:FIELD_COL.honey});
    const buildLink=(mech,parentInv)=>{
      const g=new THREE.Group();  g.position.copy(this.v3(mech.pivot));
      const inv=new THREE.Group(); inv.position.copy(this.v3(mech.pivot).clone().multiplyScalar(-1));
      g.add(inv); parentInv.add(g);
      mech._g=g; mech._inv=inv;
      const p=mk(groups[mech.id]||[]); if(p){ inv.add(p); this.hullOf[mech.id]=p; }
      this.groupAt[mech.id]=inv;
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
    this.exactG=[]; this.liteMeshes=[]; this.showMeshes=[]; this.lite=null; this.exactTris=null; this.hullBase=null; this.useLite=false;
    if(this.exact&&this.exact.cad===cad) this.applyExact(); else this.scheduleLite();
    M.forEach(m=>this.groupCounts[m.id]=(groups[m.id]||[]).length);
  },

  /* The footprint the collisions use, the drive base's forward, and the
     invisible box the pointer picks the robot up by. */
  buildFootprint(fp){
    if(this.footG){ this.chassisG.remove(this.footG); this.dispose(this.footG); }
    const g=new THREE.Group(), y=0.003;
    // the box sits (ox, oy) off the drivetrain centre, exactly as the collisions have it
    const ox=fp.ox||0, oy=fp.oy||0;
    const pts=[[fp.hx,fp.hy],[fp.hx,-fp.hy],[-fp.hx,-fp.hy],[-fp.hx,fp.hy],[fp.hx,fp.hy]]
      .map(p=>new THREE.Vector3(ox+p[0],y,-(oy+p[1])));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({color:FIELD_COL.honey,transparent:true,opacity:0.5})));
    const a=Math.min(fp.hx,fp.hy)*0.4;
    const tri=new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ox+fp.hx+a*0.9,y,-oy), new THREE.Vector3(ox+fp.hx+0.01,y,-oy-a*0.6), new THREE.Vector3(ox+fp.hx+0.01,y,-oy+a*0.6)]);
    // with no normals the AO pass read the arrow as a hole and drew it black
    tri.computeVertexNormals();
    g.add(new THREE.Mesh(tri,new THREE.MeshBasicMaterial({color:FIELD_COL.honey,transparent:true,opacity:0.75,side:THREE.DoubleSide})));
    // a soft contact shadow under the robot: what grounds it on a machine with no shadow
    // map (tier 0), and a little extra weight where the wheels meet the tiles elsewhere
    const cs=new THREE.Mesh(new THREE.PlaneGeometry(2*fp.hx+0.14,2*fp.hy+0.14),this.contactMat());
    cs.rotation.x=-Math.PI/2; cs.position.set(ox,0.0012,-oy); cs.renderOrder=1; g.add(cs);
    const hb=new THREE.Mesh(new THREE.BoxGeometry(2*fp.hx,Math.max(0.1,fp.h),2*fp.hy),new THREE.MeshBasicMaterial({visible:false}));
    hb.position.set(ox,Math.max(0.1,fp.h)/2,-oy); g.add(hb);
    this.hitBox=hb; this.footG=g; this.fpShown=fp.hx+"|"+fp.hy+"|"+fp.h+"|"+ox+"|"+oy;
    this.chassisG.add(g);
  },

  contactMat(){
    if(this._contactMat) return this._contactMat;
    const B=(this.tier&&this.tier.budget)||{};
    const m=new THREE.MeshBasicMaterial({color:0x000000, map:this.contactTex(), transparent:true, opacity:B.shadows?0.42:0.7, depthWrite:false,
      polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1});
    m.userData.shared=true;
    return this._contactMat=m;
  },
  /* a rounded rectangle of shade, darkest in the middle and gone at the edge (alpha only) */
  contactTex(){
    if(this._contactTex) return this._contactTex;
    const S=128, cv=document.createElement("canvas"); cv.width=cv.height=S;
    const c=cv.getContext("2d"), img=c.createImageData(S,S), d=img.data, e=0.16;   // e: the fade band, of the half size
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){
      const u=Math.abs((x+0.5)/S*2-1), v=Math.abs((y+0.5)/S*2-1);
      // distance into a rounded box, 0 at the rim, 1 well inside
      const qx=Math.max(0,u-(1-e)), qy=Math.max(0,v-(1-e)), out=Math.hypot(qx,qy)/e, t=Math.max(0,Math.min(1,1-out));
      const a=t*t*(3-2*t)*(0.75+0.25*(1-Math.max(u,v)));
      const o=(y*S+x)*4; d[o]=d[o+1]=d[o+2]=255; d[o+3]=Math.round(255*a);
    }
    c.putImageData(img,0,0);
    const t=new THREE.CanvasTexture(cv); t.userData.shared=true;
    return this._contactTex=t;
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
    this.buildVenue(this.fieldG);
    const tiles=this.tileField(72,24); tiles.position.y=-0.001; this.fieldG.add(tiles);
    const wall=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(FIELD,WALL,FIELD)),
      new THREE.LineBasicMaterial({color:0x5d6066}));
    wall.position.y=WALL/2; this.fieldG.add(wall);
    this.fieldSize=FIELD;
  },
  mat(c,o){ o=o||{}; return new THREE.MeshStandardMaterial(Object.assign({color:c, roughness:0.62, metalness:0.1},o)); },
  /* One grey foam tile, painted once and laid 36 times (tileField): the foam's
     pebbled grain at two scales, faint mottling, and the interlocking teeth along
     every edge as a soft dark groove. A seam is drawn on both edges it touches, so
     the two halves meet into one zig-zag when tiles sit side by side. Returns the
     colour map and a matching height map (the groove low, the grain rough) for the
     tiers that can afford a bump. */
  tileMaps(tileIn,bump){
    const N=1024, k=N/tileIn;
    let seed=11; const rnd=()=>((seed=(seed*16807)%2147483647)/2147483647);
    // the teeth: 8 a side, trapezoids 0.5 in deep, centred on the tile's edge
    const teeth=8, amp=0.5*k, P=[];
    for(let i=0;i<teeth;i++){ const t0=i/teeth*N, w=N/teeth;
      P.push([t0,-amp],[t0+0.12*w,amp],[t0+0.5*w,amp],[t0+0.62*w,-amp]); }
    P.push([N,-amp]);
    const seams=(c,width,style,blur)=>{
      c.save(); c.strokeStyle=style; c.lineWidth=width; c.lineJoin="round";
      if(blur&&"filter" in c) c.filter="blur("+blur+"px)";
      for(const off of [0,N]){
        c.beginPath(); P.forEach((p,i)=>i?c.lineTo(p[0],off+p[1]):c.moveTo(p[0],off+p[1])); c.stroke();     // a horizontal edge
        c.beginPath(); P.forEach((p,i)=>i?c.lineTo(off-p[1],p[0]):c.moveTo(off-p[1],p[0])); c.stroke();     // a vertical one, mirrored so they interlock
      }
      c.restore();
    };
    // low mottling: a coarse random grid, smoothed up to size
    const lo=document.createElement("canvas"); lo.width=lo.height=12;
    const lc=lo.getContext("2d"), li=lc.createImageData(12,12);
    for(let p=0;p<li.data.length;p+=4){ const v=Math.round(128+(rnd()-0.5)*26); li.data[p]=li.data[p+1]=li.data[p+2]=v; li.data[p+3]=255; }
    lc.putImageData(li,0,0);
    const paint=(base,mott,grain,groove,lip)=>{
      const cv=document.createElement("canvas"); cv.width=cv.height=N;
      const c=cv.getContext("2d");
      c.fillStyle=base; c.fillRect(0,0,N,N);
      c.globalAlpha=mott; c.globalCompositeOperation="overlay"; c.imageSmoothingEnabled=true; c.drawImage(lo,0,0,N,N);
      c.globalAlpha=1; c.globalCompositeOperation="source-over";
      // the foam's pebble: fine noise, plus a sparse coarser speckle
      const img=c.getImageData(0,0,N,N), d=img.data;
      for(let p=0;p<d.length;p+=4){ const n=(rnd()-0.5)*grain; d[p]+=n; d[p+1]+=n; d[p+2]+=n; }
      for(let s=0;s<N*N/90;s++){ const x=(rnd()*N)|0, y=(rnd()*N)|0, o=(y*N+x)*4, n=(rnd()-0.5)*grain*1.6;
        for(const q of [o,o+4,o+N*4,o+N*4+4]) if(q<d.length-3){ d[q]+=n; d[q+1]+=n; d[q+2]+=n; } }
      c.putImageData(img,0,0);
      seams(c,0.28*k,groove[0],0.9);          // the soft shade either side of the joint
      seams(c,0.07*k,groove[1],0);            // the joint itself
      if(lip) seams(c,0.02*k,lip,0);
      return cv;
    };
    const aniso=this.ren?Math.min(8,this.ren.capabilities.getMaxAnisotropy()):1;
    const tex=(cv,srgb)=>{ const t=new THREE.CanvasTexture(cv); if(srgb) srgbTex(t);
      t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=aniso; return t; };
    const map=tex(paint("rgb(98,100,103)",0.2,9,["rgba(30,31,34,0.12)","rgba(26,27,30,0.42)"],null),true);
    const height=bump?tex(paint("rgb(150,150,150)",0.12,40,["rgba(60,60,60,0.35)","rgba(20,20,20,0.8)"],null),false):null;
    return {map, height};
  },
  /* The 36 tiles as one draw: each its own faint shade of grey, as real tiles from
     different boxes are. */
  tileField(H,tileIn){
    const n=Math.round(2*H/tileIn), T=tileIn*IN, B=(this.tier&&this.tier.budget)||{};
    // painted once a page: every robot load rebuilds the field, and the paint is ~50 ms
    let mat=this._tileMat;
    if(!mat){ const M=this.tileMaps(tileIn,!!B.bump);
      mat=this._tileMat=new THREE.MeshStandardMaterial({color:0xffffff, map:M.map, roughness:0.9, metalness:0, envMapIntensity:0.6});
      if(M.height){ mat.bumpMap=M.height; mat.bumpScale=1.2; }
      mat.userData.shared=true; }
    const geo=new THREE.PlaneGeometry(T,T); geo.rotateX(-Math.PI/2);
    const inst=new THREE.InstancedMesh(geo,mat,n*n), m4=new THREE.Matrix4(), col=new THREE.Color();
    let seed=5; const rnd=()=>((seed=(seed*16807)%2147483647)/2147483647);
    for(let i=0;i<n;i++) for(let j=0;j<n;j++){
      const q=i*n+j; m4.makeTranslation((-H+tileIn*(i+0.5))*IN,0,-(-H+tileIn*(j+0.5))*IN); inst.setMatrixAt(q,m4);
      const v=0.94+rnd()*0.1; inst.setColorAt(q,col.setRGB(v,v,v*1.01));
    }
    inst.receiveShadow=true; inst.userData.tiles=true;
    return inst;
  },
  /* The hall around the field: a dark floor under a pool of light that falls off
     into the distance, and a dim backdrop that never competes with the field. A
     sphere of vertex colours (no shader, so tone mapping and every tier treat it like
     any other material) and one textured plane: two draws. */
  buildVenue(g){
    const S=512, cv=document.createElement("canvas"); cv.width=cv.height=S;
    const c=cv.getContext("2d"), gr=c.createRadialGradient(S/2,S/2,S*0.035,S/2,S/2,S/2);
    gr.addColorStop(0,"rgb(20,20,21)"); gr.addColorStop(0.06,"rgb(15,15,16)"); gr.addColorStop(0.16,"rgb(8,8,9)");
    gr.addColorStop(0.4,"rgb(4,4,5)"); gr.addColorStop(1,"rgb(3,3,4)");
    c.fillStyle=gr; c.fillRect(0,0,S,S);
    // matte with no specular at all (Lambert): at a glancing angle even a fully rough
    // standard material catches the key light, and the far floor became a grey band
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(80,80),
      new THREE.MeshLambertMaterial({color:0xffffff, map:srgbTex(new THREE.CanvasTexture(cv))}));
    floor.rotation.x=-Math.PI/2; floor.position.y=-0.004; floor.receiveShadow=true; g.add(floor);
    const geo=new THREE.SphereGeometry(39,48,24), P=geo.attributes.position, cols=new Float32Array(P.count*3);
    const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t), ss=(a,b,x)=>{ const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
    const below=[0.002,0.002,0.0024], hor=[0.008,0.0085,0.0098], wall=[0.024,0.026,0.031], top=[0.004,0.0043,0.005];
    for(let i=0;i<P.count;i++){
      const y=P.getY(i)/39;
      const v=y<0?mix(hor,below,ss(0,0.08,-y)):y<0.16?mix(hor,wall,ss(0,0.16,y)):mix(wall,top,ss(0.16,0.75,y));
      cols[3*i]=v[0]; cols[3*i+1]=v[1]; cols[3*i+2]=v[2];
    }
    geo.setAttribute("color",new THREE.BufferAttribute(cols,3));
    const dome=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true, side:THREE.BackSide, depthWrite:false, fog:false}));
    dome.renderOrder=-10; dome.frustumCulled=false; dome.userData.venue=true; g.add(dome);
  },
  /* Boxes (field inches, centre and size [x, y, z]) as one geometry, so a whole
     perimeter of rails is a draw call or two rather than forty. */
  mergedBoxes(list){
    const pos=[], nor=[], idx=[];
    for(const [cen,size] of list){
      const b=new THREE.BoxGeometry(size[0]*IN,size[2]*IN,size[1]*IN), v=this.fv(cen);
      b.translate(v.x,v.y,v.z);
      const o=pos.length/3, P=b.attributes.position.array, N=b.attributes.normal.array, I=b.index.array;
      for(let i=0;i<P.length;i++){ pos.push(P[i]); nor.push(N[i]); }
      for(let i=0;i<I.length;i++) idx.push(I[i]+o);
      b.dispose();
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3)); geo.setAttribute("normal",new THREE.Float32BufferAttribute(nor,3));
    geo.setIndex(idx); geo.computeBoundingSphere();
    return geo;
  },
  /* brushed aluminium, for the perimeter's extrusions and the HIVE's tubes */
  aluMat(){ return this.mat(0xc3c8ce,{metalness:0.75, roughness:0.46, envMapIntensity:1.0}); },
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
    if(!this._ballMat[key]){ this._ballMat[key]=this.mat(c,{roughness:0.5, map:this.ballTex(c)}); this._ballMat[key].userData.shared=true; }
    const m=new THREE.Mesh(this._ballGeo[kind],this._ballMat[key]);
    m.castShadow=true; m.userData.ball=true;
    return m;
  },
  /* POLLEN and NECTAR are 26-hole pickleball shells: rows of dark holes on the
     colour, so a ball that rolls or spins visibly does. */
  ballTex(hex){
    this._ballTex=this._ballTex||{};
    if(this._ballTex[hex]) return this._ballTex[hex];
    const cv=document.createElement("canvas"); cv.width=128; cv.height=64;
    const c=cv.getContext("2d");
    c.fillStyle="#ffffff"; c.fillRect(0,0,128,64);
    c.fillStyle="rgba(40,36,30,.78)";
    // 26 holes: one at each pole, and four rings of six, each ring turned half a step from the last
    c.fillRect(0,0,128,4); c.fillRect(0,60,128,4);
    [54,18,-18,-54].forEach((lat,i)=>{ const y=32-lat/90*32, w=4/Math.cos(lat*Math.PI/180);
      for(let k=0;k<6;k++){ const x=((k+(i%2)*0.5)/6)*128;
        for(const xx of [x,x-128,x+128]){ c.beginPath(); c.ellipse(xx,y,w,3.6,0,0,7); c.fill(); } } });
    const t=srgbTex(new THREE.CanvasTexture(cv)); t.userData={shared:true};
    return this._ballTex[hex]=t;
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
    ctx.font="600 40px Inter, -apple-system, system-ui, 'Arial Narrow', sans-serif";
    ctx.fillStyle=color||"#8a97a6"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(text,256,34);
    const tex=srgbTex(new THREE.CanvasTexture(cv));
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w*IN,w/8*IN),
      new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));
    m.rotation.x=-Math.PI/2; m.rotation.z=rot||0;
    m.position.copy(this.fv([x,y,0.05])); g.add(m);
  },

  buildField(){
    const D=Field.data.field, F=D.field, H=F.half, g=this.fieldG, WH=F.wallHeight, WT=F.wallThickness||1;
    this.fieldSize=2*H*IN;

    // the hall, alliance areas, labels
    this.buildVenue(g);
    for(const al of ["red","blue"]){
      const a=D.allianceAreas[al], col=al==="red"?FIELD_COL.redTape:FIELD_COL.blueTape;
      this.rect(g,a.x0,a.x1,a.y0,a.y1,this.flat(col,0.06),0.01);      // a tint on the dark hall floor, not a red slab
      const edge=this.flat(col,0.8), outer=al==="red"?a.x0:a.x1;
      this.rect(g,a.x0,a.x1,a.y0,a.y0+2,edge,0.02); this.rect(g,a.x0,a.x1,a.y1-2,a.y1,edge,0.02);
      this.rect(g,Math.min(outer,outer-(al==="red"?-2:2)),Math.max(outer,outer-(al==="red"?-2:2)),a.y0,a.y1,edge,0.02);
      this.label(g,al.toUpperCase()+" ALLIANCE",(al==="red"?-1:1)*(H+14),0,al==="red"?-Math.PI/2:Math.PI/2,40,al==="red"?"#e0746c":"#6e9ff0");
      // the NECTAR tray each alliance starts with
      this.box(g,[(al==="red"?-1:1)*(H+30),0,1],[5,20,2],this.mat(0x2a2926),true);
      for(let i=0;i<5;i++){ const b=this.ball("nectar",al); b.position.copy(this.fv([(al==="red"?-1:1)*(H+30),-7.2+i*3.6,3.9])); b.userData.staged=true; g.add(b); }
    }
    this.label(g,"AUDIENCE",0,-H-12,0,34,"#8f8672");

    // the foam tiles, 23.5 in each, their seams painted in (tileMaps)
    const tileIn=(F.tile||((F.tileSeams||[]).length>1?Math.abs(F.tileSeams[1]-F.tileSeams[0]):23.5));
    g.add(this.tileField(H,tileIn));

    // Perimeter: clear polycarbonate panels held in aluminium extrusion, a post at every
    // seam. The panels are nearly invisible straight on and catch the light at a glance,
    // as polycarbonate does: a faint tinted fill, and (where the tier affords it) a second
    // layer that adds only what the panel reflects. Transparency alone scaled the
    // reflection down with the fill, so the old panels read as grey fog.
    const B=(this.tier&&this.tier.budget)||{};
    const poly=this.mat(0xe4edf3,{transparent:true,opacity:B.glass?0.07:0.12,roughness:0.12,metalness:0,depthWrite:false,side:THREE.DoubleSide});
    const alu=this.aluMat(), slotM=this.mat(0x26292d,{metalness:0.4,roughness:0.6});
    const L=2*H+2*WT, o=H+WT/2, panels=[], rails=[], slots=[];
    const RW=WT+0.3, sl=0.24;                    // extrusion width; its T-slot's opening
    for(const w of [[0,o,L,WT],[0,-o,L,WT],[o,0,WT,2*H],[-o,0,WT,2*H]]){
      const alongX=w[3]===WT&&w[2]!==WT, len=alongX?w[2]:w[3];
      const sz=(a,b,c)=>alongX?[a,b,c]:[b,a,c];
      panels.push([[w[0],w[1],WH/2],sz(len,0.22,WH-1.6)]);
      for(const z of [WH-0.5,0.5]){
        rails.push([[w[0],w[1],z],sz(len+0.01,RW,1)]);
        // the slot down both faces, proud of them by 2 mm so it never z-fights from the driver's wall
        slots.push([[w[0],w[1],z],sz(len,RW+0.16,sl)]);
      }
    }
    const posts=[-H,-47,-23.5,0,23.5,47,H];
    for(const p of posts) for(const s of [-1,1]){
      rails.push([[p,s*o,WH/2],[1.2,RW+0.1,WH]]); rails.push([[s*o,p,WH/2],[RW+0.1,1.2,WH]]);
      slots.push([[p,s*o,WH/2],[sl,RW+0.26,WH-1.2]]); slots.push([[s*o,p,WH/2],[RW+0.26,sl,WH-1.2]]);
    }
    const pm=new THREE.Mesh(this.mergedBoxes(panels),poly); pm.renderOrder=2; g.add(pm);
    if(B.glass){
      // what the panel reflects, added on top: the hall's lights in a glancing sheen
      const sheen=this.mat(0x000000,{roughness:0.05,metalness:0,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,envMapIntensity:1.4});
      const sm=new THREE.Mesh(pm.geometry,sheen); sm.renderOrder=3; g.add(sm);
    }
    const rm=new THREE.Mesh(this.mergedBoxes(rails),alu); rm.castShadow=true; rm.receiveShadow=true; g.add(rm);
    g.add(new THREE.Mesh(this.mergedBoxes(slots),slotM));

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
      for(let i=0;i<4;i++){ const b=this.ball("pollen"); b.position.copy(this.fv([cx-s*i*2.9,cy,1.4])); b.userData.staged=true; g.add(b); }
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
      for(let i=0;i<4;i++){ const b=this.ball("pollen"); b.position.copy(this.fv([ax[0],ax[1],1.4+i*2.8])); b.userData.staged=true; g.add(b); }
    }

    // HIVE frame: two leaning A-frames joined by a crossbar
    const fr=Field.model().frame, frame=this.aluMat();
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

  /* See-through volumes (a HIVE CELL, the best run's ghost) fade as the camera
     closes in: within ~10 cm of one its fill is gone and its edges are a hint, so
     driving or orbiting through it never floods the frame with its colour.
     mats: [[material, its full opacity], ...] */
  addZone(o,mats,key){
    const g=o.geometry; if(g&&!g.boundingSphere) g.computeBoundingSphere();
    const s=g&&g.boundingSphere;
    this.zones=(this.zones||[]).concat([{o, mats, key, c:s?s.center.clone():new THREE.Vector3(), r:s?s.radius:0.1}]);
  },
  dropZones(key){ this.zones=(this.zones||[]).filter(z=>z.key!==key); },
  fadeZones(cam){
    const Z=this.zones; if(!Z||!Z.length) return;
    const w=this._zw||(this._zw=new THREE.Vector3());
    for(const z of Z){
      w.copy(z.c); z.o.localToWorld(w);
      const d=cam.position.distanceTo(w)-z.r, t=Math.max(0,Math.min(1,(d-0.1)/0.8)), k=t*t*(3-2*t);
      z.mats.forEach(([m,base],i)=>{ const op=i===0?base*k:base*(0.3+0.7*k); if(Math.abs(m.opacity-op)>0.004){ m.opacity=op; m.visible=op>0.004; } });
    }
  },
  /* The two HIVE arms with their CELLs, for the current state. Each lives in
     a group at its pivot so a TIP can swing it. */
  buildHive(al){
    if(this.hiveG[al]){ this.world.remove(this.hiveG[al]); this.dispose(this.hiveG[al]); }
    this.dropZones("hive-"+al);
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
      // A CELL reads by its edges and a faint tint, not a solid wash of colour: at 46% the
      // shell turned the whole frame red whenever the camera came near or through it.
      // fadeZones() thins it further, edges and all, as the camera closes in.
      const fillM=this.mat(col,{transparent:true,opacity:up?0.15:0.09,side:THREE.DoubleSide,depthWrite:false,roughness:0.3});
      const shell=new THREE.Mesh(geo,fillM);
      shell.castShadow=true; inner.add(shell);
      const lp=[]; const seg=(a,b)=>lp.push(v[a].x,v[a].y,v[a].z,v[b].x,v[b].y,v[b].z);
      for(let k=0;k<5;k++){ seg(k,(k+1)%5); seg(5+k,5+(k+1)%5); seg(k,5+k); }
      const lg=new THREE.BufferGeometry(); lg.setAttribute("position",new THREE.Float32BufferAttribute(lp,3));
      const lineM=new THREE.LineBasicMaterial({color:col,transparent:true,opacity:up?1:0.7});
      inner.add(new THREE.LineSegments(lg,lineM));
      this.addZone(shell,[[fillM,fillM.opacity],[lineM,lineM.opacity]],"hive-"+al);
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
    const list=Field.cells[al], fresh=ShotFx.cellsGrew(al,list.length); if(!list.length) return;
    const V=cell.vertices;
    const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], add=(a,b,k)=>[a[0]+b[0]*k,a[1]+b[1]*k,a[2]+b[2]*k];
    const len=a=>Math.hypot(a[0],a[1],a[2]), nrm=a=>{ const l=len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; };
    const across=nrm(sub(V[1],V[0])), depth=nrm(sub(V[5],V[0])), wide=len(sub(V[1],V[0]));
    let up=[across[1]*depth[2]-across[2]*depth[1], across[2]*depth[0]-across[0]*depth[2], across[0]*depth[1]-across[1]*depth[0]];
    const mid=V.slice(0,5).reduce((s,p)=>[s[0]+p[0]/5,s[1]+p[1]/5,s[2]+p[2]/5],[0,0,0]);
    const toMid=sub(mid,V[0]); if(up[0]*toMid[0]+up[1]*toMid[1]+up[2]*toMid[2]<0) up=[-up[0],-up[1],-up[2]];
    const fromHigh=al==="blue";          // start on the alliance-area side
    let u=0.4, row=0, ei=0;
    for(const e of list){
      const r=e.kind==="nectar"?1.81:1.4;
      if(u+2*r>wide-0.4){ u=0.4; row++; }
      const along=fromHigh?wide-u-r:u+r;
      const p=add(add(add(V[0],across,along),depth,0.3+r+row*3.4),up,r+0.2);
      const b=this.ball(e.kind,e.color); b.position.copy(this.fv(p)); g.add(b);
      if(fresh&&++ei===list.length) ShotFx.settle(b,al);        // the ball that just went in drops in from the mouth (src/shotfx.js)
      u+=2*r+0.15;
    }
  },

  /* A path in field inches, drawn as a line: solid for your shot, dashed for
     the best arc from here. */
  setArc(path,color,dashed){ ShotFx.arc(this,path,color,dashed); },

  /* Turn each exact drive wheel at the speed its motor drives it. The sim's
     wheel is found by where its CAD wheel sits, so a changed front can't
     mismatch them; the sense comes from the wheel's rolling direction now. */
  spinExact(dt){
    const r=Sim.rig; if(!r||!this.spinWheels||!this.spinWheels.length) return;
    const F={"+x":[1,0],"-x":[-1,0],"+y":[0,1],"-y":[0,-1]}[(Sim.opts&&Sim.opts.front)||"+x"]||[1,0];
    for(const sw of this.spinWheels){
      if(sw.rig!==r){ sw.rig=r; sw.i=-1; let bd=0.02;
        r.drive.wheels.forEach((w,k)=>{ if(!w.c) return; const d=Math.hypot(w.c[0]-sw.c[0],w.c[1]-sw.c[1],w.c[2]-sw.c[2]); if(d<bd){ bd=d; sw.i=k; } }); }
      if(sw.i<0) continue;
      const w=r.drive.wheels[sw.i], dev=r.devs[sw.i], s=Sim.dev[dev]; if(!s) continue;
      // rolling forward along f turns the wheel about up x f
      const ca=Math.cos(w.alpha||0), sa=Math.sin(w.alpha||0), f=[ca*F[0]-sa*F[1], ca*F[1]+sa*F[0]];
      const sense=(-f[1]*sw.a[0]+f[0]*sw.a[1])<0?-1:1;
      sw.G.rotateOnAxis(sw.av, sense*Sim.wheelCmd(dev,w.mount)*(s.spec.rpm||312)/60*2*Math.PI*dt);
    }
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
    if(fp&&(!this.footG||this.fpShown!==fp.hx+"|"+fp.hy+"|"+fp.h+"|"+(fp.ox||0)+"|"+(fp.oy||0))) this.buildFootprint(fp);
    // wheels roll with their motors, the flywheel with the shooter
    // physical direction, setDirection and mounting included (Sim.wheelCmd)
    const rig=Sim.rig, mountOf=d=>{ const i=rig?rig.devs.indexOf(d):-1; return i>=0?rig.drive.wheels[i].mount:1; };
    for(const w of this.wheels){ const s=w.dev&&Sim.dev[w.dev]; if(s) w.spin.rotation.z-=Sim.wheelCmd(w.dev,mountOf(w.dev))*(s.spec.rpm||312)/60*2*Math.PI*dt; }
    this.spinExact(dt);
    if(this.fly) this.fly.g.rotation.z-=Math.min(26,Shots.spin()*140)*dt;

    // a joint tied to a driven one (a cascade stage, a gear, a rack, a linkage's
    // slide and rod) follows it (src/jointspec.js); a joint nothing drives
    // still takes its drawn-pose fix
    const drawn=jointValues(this.cad.mechs,m=>{
      if(this.preview&&this.preview.id===m.id) return this.preview.q;     // the joint editor's "try it"
      // solved mechanisms (src/joltmech.js): every joint where the solver put it,
      // a linkage's free pins included
      const W=Sim.mechWorld;
      if(W&&W.joints.has(m.id)){ const q=W.q(m.id); return normJointKind(m.kind)==="linear"?q:q+(m.fromMate?(m.q0||0):0); }
      const dn=deviceOn(m.id), s=dn?Sim.dev[dn]:null;
      if(!s) return m.couple?null:(m.q0||null);
      const p=mechPose(m,s,this.size);
      return p.ang!=null?p.ang:(p.d!=null?p.d:null);
    });
    let refold=false;
    for(const m of this.cad.mechs){
      if(!m._g) continue;
      let q=drawn.get(m.id); if(q==null) continue;
      if(m.couple&&!deviceOn(m.id)) q=mateClamp(m,q);
      // a held joint drawn with the group above it has moved: draw it on its own from now on
      if(this.folded&&this.folded.has(m.id)&&Math.abs(q)>1e-3){ this.folded.delete(m.id); this.movingMechs(this.cad); this.moved.ids.add(m.id); refold=true; }
      if(normJointKind(m.kind)==="linear") m._g.position.copy(this.v3(m.pivot).add(this.vAxis(m.axis).multiplyScalar(q)));
      else m._g.quaternion.setFromAxisAngle(this.vAxis(m.axis), q);
    }
    if(refold&&this.exact&&this.exact.cad===this.cad){ this.applyExact();
      if(typeof CadView!=="undefined"&&CadView.sel) CadView.light(CadView.sel,"sel"); }
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
    const marks=!/^(field|chase|pov)$/.test(this.mode);          // joint markers only in the robot views
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
        const hx=(Field.data.field.hive.hiveX||{})[al]; this.tipAt={t:now, x:(hx!=null?hx:(al==="red"?-12.75:12.75))*IN, y:from*35*IN};
        this.shownHive=key; this.shownCells=-2;        // rebuild after the swing
        // what was in the CELL spills as it goes down
        for(const g of this.hiveG[al].children[0].children) if(g.userData.ball) g.visible=false;
      }else{
        this.buildHive("red"); this.buildHive("blue");
        this.shownHive=key; this.shownCells=Field.version;
      }
    }
    // balls in flight, and misses lying on the tiles
    const fl=Shots.flying.concat(typeof Match!=="undefined"&&Match.on?Match.flying:[]), want=fl.concat(Shots.landed);
    this.flightFx(fl,now);
    this.updateMatch();
    while(this.ballPool.length>want.length){ const m=this.ballPool.pop(); this.dynG.remove(m); }
    for(let i=0;i<want.length;i++){
      const b=want[i], key2=b.kind+"|"+(b.color||"");
      let m=this.ballPool[i];
      if(!m||m.userData.key!==key2){ if(m) this.dynG.remove(m); m=this.ball(b.kind,b.color); m.userData.key=key2; this.ballPool[i]=m; this.dynG.add(m); }
      const p=this.fv(b.pos);
      // in flight it spins (backspin off the flywheel); on the tiles it lies still
      if(i<fl.length) ShotFx.spinBall(m,p,fl[i]);
      m.userData.lp=p; m.position.copy(p);
    }
    this.trails(fl);
    this.stepFx(now);
    // a ball into an up-CELL: a flash at its mouth
    const cells={red:Field.cells.red.length, blue:Field.cells.blue.length};
    if(this.cellsSeen) for(const al of ["red","blue"]) if(cells[al]>this.cellsSeen[al]){
      try{ const m=Field.model().mouthCentroid[al]; this.fx("flash",this.fv([m[0],m[1],m[2]||0]),al==="red"?0xff7a5c:0x6aa8ff); }catch(e){}
    }
    this.cellsSeen=cells;
  },
  /* Each ball once as it leaves (a flash at the shooter, a kick to the robot that fired it) and
     once as it lands (a score or a miss; where a miss starts bouncing from). All of it is
     src/shotfx.js: pooled ribbons, particles, popups; nothing is allocated per frame. */
  flightFx(fl,now){ ShotFx.flightFx(this,fl,now); },
  /* A tapering ribbon behind every ball in the air, from its own path. */
  trails(fl){ ShotFx.trails(this,fl); },
  /* Short effects: a flash where a ball goes into an up-CELL (the flight that scored it has already made one). */
  fx(kind,pos,color){ ShotFx.fx(this,kind,pos,color); },
  stepFx(now){ ShotFx.step(this,now); },

  /* ---------------- the rest of the match (src/match.js) ----------------
     The AI robots, the HUMAN PLAYERS at the alliance walls, every loose
     element on the tiles and what's in each FLOWER. Drawn from Match's
     state each frame; the staged elements the field was built with hide
     while a match is on, because the match moves them. */
  updateMatch(){
    const live=typeof Match!=="undefined"&&Match.live();
    if(this.matchShown!==live){
      this.matchShown=live;
      this.fieldG.traverse(o=>{ if(o.userData&&o.userData.staged) o.visible=!live; });
      if(this.matchG){ this.world.remove(this.matchG); this.dispose(this.matchG); this.matchG=null; }
      if(live){ this.matchG=new THREE.Group(); this.world.add(this.matchG);
        this.botG={}; this.humanG={}; this.floorBalls=new Map(); this.flowerKey=[]; this.flowerG=[]; this.markG=[]; this.picked=[]; this.floorInit=false; }
    }
    if(!live) return;
    const G=this.matchG, now=performance.now(), dt=Math.min(0.1,(now-(this.mt||now))/1000); this.mt=now;
    // robots
    const seen=new Set();
    for(const b of Match.bots){
      seen.add(b.id);
      let g=this.botG[b.id];
      if(!g){ g=this.botG[b.id]=this.buildBot(b); G.add(g); }
      this.moveBot(g,b.x,b.y,b.h,dt);
      const U=g.userData;
      // the intake turns while something is in it, the flywheel while it holds something to shoot
      const eating=Match.floor.some(e=>Match.inIntake(b,e))||this.picked.some(p=>p.b===b);
      U.roll.rotateY((eating?-26:0)*dt);
      U.fly.rotateY((b.hold.length?-60:0)*dt);
      // what it's holding sits in the hopper on top
      const key=b.hold.map(e=>e.kind[0]+(e.color||"")).join(",");
      if(U.holdKey!==key){
        U.holdKey=key;
        for(const m of U.held) g.remove(m);
        U.held=b.hold.map((e,i)=>{ const m=this.ball(e.kind,e.color); m.position.set(-0.06+i*0.075-0.1,0.34,(i%2?0.05:-0.05)); g.add(m); return m; });
      }
    }
    // online: the other drivers' robots. Their own CAD once its light copy is here, a stand-in till then
    for(const p of Match.players){
      const model=typeof Online!=="undefined"?Online.modelFor(p.id):null;
      const id="pl:"+p.id, key=(model?"m:"+Online.modelOf[p.id]:"b:"+[p.hx.toFixed(3),p.hy.toFixed(3)].join(","))+"|"+p.al+"|"+p.name; seen.add(id);
      let g=this.botG[id];
      if(g&&g.userData.key!==key){ G.remove(g); this.dispose(g); g=null; }
      if(!g){ g=this.botG[id]=model?this.buildRemote(p,model):this.buildBot({id, al:p.al, hx:p.hx, hy:p.hy, label:p.name}); g.userData.key=key; G.add(g); }
      if(model){
        g.position.set(p.cx,0,-p.cy); g.rotation.y=p.h;
        const S=g.userData.segs, J=p.j, k=1-Math.exp(-dt*18), mh=Online.modelOf[p.id]||"";
        const P=this._tp||(this._tp=new THREE.Vector3()), Q=this._tq||(this._tq=new THREE.Quaternion());
        // only places meant for this copy: right after a team rebuilds its robot, the old copy waits for the new one
        if(J&&J.length===S.length*7&&p.jm&&mh.slice(0,8)===p.jm) S.forEach((s,i)=>{
          const o=i*7; P.set(J[o]/1000,J[o+1]/1000,J[o+2]/1000); Q.set(J[o+3]/1e4,J[o+4]/1e4,J[o+5]/1e4,J[o+6]/1e4).normalize();
          if(!s.init){ s.G.position.copy(P); s.G.quaternion.copy(Q); s.init=true; s.G.visible=true; }
          else{ s.G.position.lerp(P,k); s.G.quaternion.slerp(Q,k); }
        });
      }else this.moveBot(g,p.x,p.y,p.h,dt);
    }
    for(const id in this.botG) if(!seen.has(id)){ G.remove(this.botG[id]); this.dispose(this.botG[id]); delete this.botG[id]; }
    // human players, each with the NECTAR tray still to enter; seen through from the
    // driver's view, where they stand between the camera and the field
    const ghost=this.mode==="field";
    for(const al of ["red","blue"]){
      let g=this.humanG[al];
      if(!g){ g=this.humanG[al]=this.buildHuman(al); G.add(g); }
      if(g.userData.ghost!==ghost){ g.userData.ghost=ghost;
        // faint: at 22% the near player was a red cut-out over a corner of the field
        g.traverse(o=>{ if(o.material&&!o.userData.ball){ o.material.transparent=ghost; o.material.opacity=ghost?0.12:1; o.material.depthWrite=!ghost; o.material.needsUpdate=true; } }); }
      // breathing, watching their robots, and the lob of each NECTAR (src/figures.js)
      Figures.animHuman(this,g,al,dt);
    }
    // loose elements on the tiles: they arrive bouncing, roll where they're knocked, and get taken in
    const alive=new Set();
    for(const e of Match.floor){
      alive.add(e.id);
      let m=this.floorBalls.get(e.id);
      if(!m){ m=this.ball(e.kind,e.color); this.floorBalls.set(e.id,m); G.add(m); this.floorEnter(m,e,now); }
      this.floorMove(m,e,dt);
    }
    for(const [id,m] of this.floorBalls) if(!alive.has(id)){ this.floorBalls.delete(id); this.floorLeave(m,G); }
    this.floorInit=true;
    this.pickups(G,dt);
    // the alliance's marks on the field (src/net.js): a ring that pulses where a partner pointed
    const marks=typeof Online!=="undefined"&&Online.state==="playing"?Online.liveMarks():[];
    if(!this.markG){ this.markG=[]; }
    while(this.markG.length<marks.length){
      const m=new THREE.Mesh(new THREE.RingGeometry(0.16,0.2,40),new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.9, side:THREE.DoubleSide, depthWrite:false}));
      m.rotation.x=-Math.PI/2; G.add(m); this.markG.push(m);
    }
    const tt=now/1000;
    this.markG.forEach((m,i)=>{ const k=marks[i]; m.visible=!!k; if(!k) return;
      m.material.color.setHex(k.what==="shoot"?0xf0b54a:k.what==="defend"?0x6fd3e0:0xffffff);
      m.position.set(k.x,0.012,-k.y); const s=1+0.18*Math.sin(tt*5); m.scale.set(s,s,s); });
    // FLOWERs: the stack from the tile up
    Match.flowers.forEach((f,i)=>{
      const key=f.stack.map(e=>e.kind[0]+(e.color||"")).join(",");
      if(this.flowerKey[i]===key) return;
      this.flowerKey[i]=key;
      if(this.flowerG[i]){ G.remove(this.flowerG[i]); }
      const g=this.flowerG[i]=new THREE.Group(); G.add(g);
      let z=0, prev=0;
      for(const e of f.stack){ const r=e.kind==="nectar"?1.81:1.4; z+=prev+r; prev=r;
        const m=this.ball(e.kind,e.color); m.position.set(f.x,z*IN,-f.y); g.add(m); }
    });
  },
  /* A stand-in robot to where it is: its mecanum wheels turn as that motion turns them,
     and it kicks and rocks back a little when it fires (src/figures.js). */
  moveBot(g,x,y,h,dt){ Figures.moveBot(g,x,y,h,dt); },
  /* A new element on the tiles comes from somewhere: the end of a missed shot
     (it bounces on from there), a CELL that just tipped (it falls out), or a hand
     or a bumper (a small hop). The match's first elements are simply there. */
  floorEnter(m,e,now){
    const r=(e.kind==="nectar"?1.81:1.4)*IN, U=m.userData;
    U.cur={x:e.x, y:e.y};
    if(!this.floorInit) return;
    const end=(this.recentEnds||[]).filter(q=>Math.hypot(q.x-e.x,q.y-e.y)<0.8).pop();
    if(end){ end.t=-1e9; U.cur={x:end.x, y:end.y}; U.bounce={z:Math.max(r,end.z), vz:-2.2}; return; }
    const T=this.tipAt;
    if(T&&now-T.t<1200&&Math.hypot(e.x-T.x,e.y-T.y)<1.3){ U.cur={x:T.x+(e.x-T.x)*0.35, y:T.y+(e.y-T.y)*0.35}; U.bounce={z:1.05, vz:0.4}; return; }
    U.bounce={z:r+0.1, vz:0.8};
  },
  floorMove(m,e,dt){
    const r=(e.kind==="nectar"?1.81:1.4)*IN, U=m.userData, B=U.bounce, c=U.cur||(U.cur={x:e.x, y:e.y});
    let z=r;
    if(B){ B.vz-=9.8*dt; B.z+=B.vz*dt;
      if(B.z<=r){ B.z=r; if(Math.abs(B.vz)<0.5) U.bounce=null; else B.vz=-B.vz*0.42; }
      z=B.z; }
    const k=1-Math.exp(-dt*(B?3.5:9)), nx=c.x+(e.x-c.x)*k, ny=c.y+(e.y-c.y)*k, dx=nx-c.x, dy=ny-c.y, d=Math.hypot(dx,dy);
    // rolling: about the axis across the way it goes, its distance over its radius
    if(d>1e-5) m.rotateOnWorldAxis(new THREE.Vector3(-dy,0,-dx).normalize(),d/r);
    c.x=nx; c.y=ny;
    m.position.set(nx,z,-ny);
  },
  /* An element gone from the tiles next to an AI robot's intake was taken in:
     it rolls into the robot. Otherwise it simply goes. */
  floorLeave(m,G){
    const c=m.userData.cur||{x:m.position.x, y:-m.position.z};
    let best=null, bd=0.45;
    for(const b of Match.bots){ const d=Math.hypot(c.x-(b.x+Math.cos(b.h)*MATCH_BOT.hx), c.y-(b.y+Math.sin(b.h)*MATCH_BOT.hx)); if(d<bd){ bd=d; best=b; } }
    if(!best){ G.remove(m); return; }
    this.picked.push({m, b:best, t:0, x:c.x, y:c.y, z:m.position.y});
  },
  pickups(G,dt){
    for(const p of this.picked){
      p.t+=dt; const k=Math.min(1,p.t/0.3), e=k*k, b=p.b, fx=b.x+Math.cos(b.h)*MATCH_BOT.hx*0.4, fy=b.y+Math.sin(b.h)*MATCH_BOT.hx*0.4;
      const x=p.x+(fx-p.x)*e, y=p.y+(fy-p.y)*e;
      p.m.position.set(x,p.z+(0.2-p.z)*e,-y); p.m.rotateZ(dt*30);
      const s=1-0.45*e; p.m.scale.set(s,s,s);
      if(k>=1){ G.remove(p.m); p.done=true; }
    }
    this.picked=this.picked.filter(p=>!p.done);
  },
  /* An AI robot, or an online player's stand-in till their own CAD arrives: an 18-inch
     mecanum robot with an intake, a hooded flywheel and its number (src/figures.js). */
  buildBot(b){ return Figures.bot(this,b); },
  /* A HUMAN PLAYER behind the alliance wall, beside the LOADING ZONE, with the NECTAR tray (src/figures.js). */
  buildHuman(al){ return Figures.human(this,al); },

  /* Two cameras that ride with the robot (src/view3d.js followCamPose): "chase", above and
     behind it, turning as it turns, the way a driving game shows a car; "pov", on its front
     edge looking where it drives, like a webcam on the robot */
  followCam(){
    const ch=Sim.chassis||{x:0,y:0,h:0}, fp=Sim.footprint||{hx:0.23}, top=(this.lift0||0.2)+(Sim.base?Sim.base.H:0);
    const P=followCamPose(this.mode,ch,{hx:fp.hx||0.23, size:this.size||0.45, top});
    const pos=new THREE.Vector3(P.pos[0],P.pos[1],P.pos[2]), look=new THREE.Vector3(P.look[0],P.look[1],P.look[2]);
    // the chase camera eases after the robot (a hard follow jitters with every bump); the robot's own camera doesn't
    if(this.mode==="chase"&&this.followPos&&!this.followJump){ this.followPos.lerp(pos,0.12); this.followLook.lerp(look,0.2); }
    else { this.followPos=pos; this.followLook=look; this.followJump=false; }
    this.cam.position.copy(this.followPos); this.cam.lookAt(this.followLook); ShotFx.shake(this.cam);
    this.look=this.followLook.clone();
    if(this.sun){ const L=this.look; this.sun.position.set(L.x+this.sunOff.x,this.sunOff.y,L.z+this.sunOff.z); this.sun.target.position.set(L.x,0,L.z); this.sun.target.updateMatrixWorld(); }
  },
  /* The ghost of the best run (src/results.js): a see-through box of the robot's footprint at
     pose p (field metres and radians), with a stripe at its front; null hides it */
  setGhost(p,fp){
    if(!p){ if(this.ghostG) this.ghostG.visible=false; return; }
    if(!this.scene) return;
    const hx=(fp&&fp.hx)||0.23, hy=(fp&&fp.hy)||0.23, h=Math.min(0.5,(fp&&fp.h)||0.35), key=[hx,hy,h].map(v=>v.toFixed(3)).join("|");
    if(!this.ghostG||this.ghostKey!==key){
      if(this.ghostG){ this.scene.remove(this.ghostG); this.ghostG.traverse(o=>o.geometry&&o.geometry.dispose()); }
      this.dropZones("ghost");
      const g=new THREE.Group(), mat=new THREE.MeshBasicMaterial({color:0x7cf29a, transparent:true, opacity:0.14, depthWrite:false});
      const box=new THREE.Mesh(new THREE.BoxGeometry(2*hx,h,2*hy),mat); box.position.y=h/2; g.add(box);
      const edgeM=new THREE.LineBasicMaterial({color:0x7cf29a, transparent:true, opacity:0.85});
      const edge=new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry),edgeM);
      edge.position.y=h/2; g.add(edge);
      const noseM=new THREE.MeshBasicMaterial({color:0x7cf29a, transparent:true, opacity:0.5, depthWrite:false});
      const nose=new THREE.Mesh(new THREE.BoxGeometry(0.04,h*0.6,2*hy*0.8),noseM);
      nose.position.set(hx-0.02,h*0.3,0); g.add(nose);
      g.renderOrder=4; this.scene.add(g); this.ghostG=g; this.ghostKey=key;
      this.addZone(box,[[mat,mat.opacity],[edgeM,edgeM.opacity],[noseM,noseM.opacity]],"ghost");
    }
    const fx=(fp&&fp.ox)||0, fy=(fp&&fp.oy)||0, c=Math.cos(p.h), s=Math.sin(p.h);
    this.ghostG.visible=true;
    this.ghostG.position.set(p.x+fx*c-fy*s,0,-(p.y+fx*s+fy*c));
    this.ghostG.rotation.y=p.h;
  },
  /* The path editor's path on the field (src/pathedit.js): pts [[x, y], ...] in field
     metres, a line just above the tiles; null takes it away */
  setPath(pts){
    if(this.pathLine){ this.pathLine.parent&&this.pathLine.parent.remove(this.pathLine); this.pathLine.geometry.dispose(); this.pathLine=null; }
    if(!pts||pts.length<2||!this.scene) return;
    const g=new THREE.BufferGeometry().setFromPoints(pts.map(p=>new THREE.Vector3(p[0],0.012,-p[1])));
    this.pathLine=new THREE.Line(g,this.pathMat||(this.pathMat=new THREE.LineBasicMaterial({color:0xf2c230, depthTest:false, transparent:true, opacity:0.95})));
    this.pathLine.renderOrder=5; this.scene.add(this.pathLine);
  },
  setView(v){
    this.mode=v; this.applyQuality();
    if(v==="chase"||v==="pov"){ this.followJump=true; return; }
    if(v==="field"){
      // from behind the alliance's own wall, where the drivers stand
      this.theta=this.alliance==="blue"?0:Math.PI; this.phi=0.82; this.rad=(this.fieldSize||3.58)*1.5; return;
    }
    if(v==="front"){ this.theta=-Math.PI/2; this.phi=Math.PI/2.2; }
    else if(v==="side"){ this.theta=0; this.phi=Math.PI/2.2; }
    else if(v==="top"){ this.theta=-Math.PI/2; this.phi=0.09; }
    else { this.theta=-0.7; this.phi=1.12; }
    this.rad=Math.max(this.size,0.46)*2.4;
  },
  render(){
    if(!this.cam) return;
    const cad=typeof CadView!=="undefined"&&CadView.on;
    // the model's edge lines: crisp in the CAD view, a soft crease line on the field,
    // where black outlines made the robot look drawn rather than built
    const em=this._edgeMat; if(em){ const op=cad?0.85:0.42; if(em.opacity!==op) em.opacity=op; }
    if(cad){ CadView.render(); return; }
    // the whole field in the shadow box from the driver's wall and above, 3.6 m round the robot otherwise
    this.fitShadow(this.mode==="field"||this.mode==="top"?2.05:1.8);
    if(this.mode==="chase"||this.mode==="pov"){ this.followCam(); this.fadeZones(this.cam); this.draw(this.cam); return; }
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
    // the sun's shadow box rides along with what the camera looks at
    // the whole field's shadow box stays on the field's centre, so a robot dragged around
    // doesn't drag the box (and the HIVE's shadow) with it
    if(this.sun){ const L=this.shadowHalf>2?{x:0,z:0}:this.look; this.sun.position.set(L.x+this.sunOff.x,this.sunOff.y,L.z+this.sunOff.z); this.sun.target.position.set(L.x,0,L.z); this.sun.target.updateMatrixWorld(); }
    this.fadeZones(this.cam);
    this.draw(this.cam);
  }
};
/* The renderer works in linear light and writes sRGB (View.init). three's colour
   management (r152+) turns every hex and string colour into linear light by
   itself; what it can't know about are canvases drawn for labels (srgbTex says
   what they are) and vertex colours (toLin converts them where they're built). */
const toLin=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
function srgbTex(t){ if(t&&THREE.SRGBColorSpace) t.colorSpace=THREE.SRGBColorSpace; return t; }
/* The biggest bold font, from px down to min, that fits text in maxW on canvas context c. */
function fitFont(c,text,maxW,px,min,family){
  c.font="700 "+px+"px "+family;
  while(px>min&&c.measureText(text).width>maxW){ px-=2; c.font="700 "+px+"px "+family; }
}
function deviceOn(mechId){
  for(const n in MAP) if(MAP[n]===mechId && Sim.dev[n]) return n;
  return null;
}
/* Where a mechanism is drawn: {ang} radians about its axis for a joint, {d}
   metres along it for a slide, {} for anything that doesn't move. Pure, so
   it is tested without a scene.
   A motor is drawn from its physical count, s.revs / s.ticks, never less
   s.offset: STOP_AND_RESET_ENCODER zeroes what the code reads, not where the
   arm is. s.revs is the gearmotor's OUTPUT shaft (spec.rpm is output rpm);
   m.gear is the joint's own reduction after it, output revs per joint rev as
   in Dyn, so it divides. Unclamped, a 1200-tick RUN_TO_POSITION swung an arm
   2.2 turns through the chassis: a joint stops at the sweep a servo on it
   would get, a slide at its maxExt. */
function H_OF(D){ return D.field.half*IN; }
/* Where a camera that rides with the robot sits and looks, in the scene's frame (x, up, -y):
   ch the chassis pose (m, rad CCW from +x), o.hx its half length, o.size its size, o.top
   the height of its frame. "chase": behind and above, looking a little ahead of it;
   "pov": on its front edge at the frame's height, looking 3 m ahead and slightly down. */
function followCamPose(mode,ch,o){
  const c=Math.cos(ch.h||0), s=Math.sin(ch.h||0), at=(d,y)=>[ch.x+c*d, y, -(ch.y+s*d)];
  if(mode==="pov"){ const edge=(o.hx||0.23)+0.03, y=Math.max(0.18,(o.top||0.2)+0.05); return {pos:at(edge,y), look:at(edge+3,Math.max(0.05,y-0.35))}; }
  const sz=Math.max(0.3,o.size||0.45);
  return {pos:at(-(1.1+sz*1.3),0.7+sz*0.9), look:at(0.7,0.15)};
}
function mechPose(m,s,size){
  const k=normJointKind(m.kind), dir=m.dir||1, travel=s.act-s.restPos;
  // an Onshape mate: right-handed about the mate's own axis, inside its limits,
  // exactly as the sim stops it (src/sim.js)
  if(m.fromMate&&(k==="revolute-yaw"||k==="revolute-lift"||k==="linear")){
    const q=mateJointQ(m,s,size);                 // src/jointspec.js, shared with the sim
    return k==="linear"?{d:q}:{ang:q};
  }
  if(k==="revolute-yaw"||k==="revolute-lift"){
    const sgn=dir*(k==="revolute-lift"?-1:1);
    if(s.kind!=="motor") return {ang:travel*(s.travelDeg||300)*Math.PI/180*sgn};
    const lim=(m.travelDeg||s.travelDeg||300)*Math.PI/180, g=+m.gear>0?+m.gear:1;
    return {ang:Math.max(-lim,Math.min(lim,(+s.revs||0)/g*2*Math.PI))*sgn};
  }
  if(k==="linear"){
    if(s.kind!=="motor") return {d:travel*(m.lever||size*0.3)*dir};
    const lim=m.maxExt>0?m.maxExt:1000;
    return {d:Math.max(-lim,Math.min(lim,(+s.ticks||0)*slideMmPerTick(m,s.tpr)))/1000*dir};
  }
  return {};
}
function mateClamp(m,q){
  const L=m.limits; if(!L) return q;
  return Math.max(Number.isFinite(L[0])?L[0]:-Infinity, Math.min(Number.isFinite(L[1])?L[1]:Infinity, q));
}
