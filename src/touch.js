/* ============================================================
   TOUCH — sticks and buttons on the screen, for a phone or a tablet
   ------------------------------------------------------------
   The keyboard writes into Sim.pad[1|2]; so does this. A finger on the left
   stick is gamepad.left_stick_x / left_stick_y, a finger on A is gamepad.a, and
   the team's Java reads them the way it reads a real controller. Each control
   goes to the gamepad the OpMode reads it from (padFor, the same rule the
   keyboard uses), and the gamepad toggle decides a control both read.

   Pure first (the stick maths, which finger holds what, the write onto the
   gamepads), so the tests run it as it ships; the page parts follow.
   Also here: the phone's "drive mode" (panels out of the way, the controls
   up), the one-tap quick start, fullscreen, and add to home screen.
   ============================================================ */
const TOUCH_DEAD=0.12;                       // a thumb never rests dead centre: this much of the travel reads as centre
const TOUCH_STICKS={left:["left_stick_x","left_stick_y"], right:["right_stick_x","right_stick_y"]};
const TOUCH_BUTTONS=["a","b","x","y","left_bumper","right_bumper","left_trigger","right_trigger","dpad_up","dpad_down","dpad_left","dpad_right"];
const TOUCH_HOLD=70;                         // ms a tapped button stays down at the least
const TOUCH_ANALOG=new Set(["left_trigger","right_trigger"]);   // pulled to 1, the way a key pulls them

/* A thumb's offset from the stick's centre (pixels) as the gamepad reads it: -1 to 1 on each axis,
   down and right positive as in the SDK. Inside the dead zone it is 0; past it the push ramps up to
   1 at the rim and stays there however far the thumb slides. Radial, so a diagonal is no stronger
   than a straight push. */
function touchStick(dx,dy,r,dead){
  const dz=dead==null?TOUCH_DEAD:dead, len=Math.hypot(dx,dy);
  if(!(r>0)||!(len>0)||len===Infinity) return {x:0,y:0};
  const m=len/r; if(!(m>dz)) return {x:0,y:0};
  const k=(Math.min(1,m)-dz)/(1-dz)/len;
  return {x:dx*k, y:dy*k};
}
/* a phone: a touch screen small enough that the side panels cannot share it with the field */
function touchPhone(coarse,w,h){ return !!coarse&&Math.min(+w||0,+h||0)>0&&Math.min(+w,+h)<600; }

/* Which finger holds which control. Fingers come and go on their own: a stick holds one at a time, a
   button as many as are on it (it stays down until the last lifts). Sticks need their centre and
   reach: g = {cx, cy, r} in pixels. */
function touchModel(){
  const ptr=new Map();                                // pointer id → {stick, g, dx, dy} | {btn}
  const held=ctl=>{ for(const p of ptr.values()) if(p.stick===ctl) return true; return false; };
  return {
    down(id,ctl,x,y,g){
      ptr.delete(id);
      if(TOUCH_STICKS[ctl]){ if(!g||held(ctl)) return false; ptr.set(id,{stick:ctl, g, dx:x-g.cx, dy:y-g.cy}); return true; }
      if(TOUCH_BUTTONS.indexOf(ctl)<0) return false;
      ptr.set(id,{btn:ctl}); return true;
    },
    move(id,x,y){ const p=ptr.get(id); if(p&&p.stick){ p.dx=x-p.g.cx; p.dy=y-p.g.cy; } },
    up(id){ return ptr.delete(id); },
    clear(){ ptr.clear(); },
    count(){ return ptr.size; },
    /* where the knob is drawn: the thumb's offset, held inside the rim (pixels) */
    knob(ctl){
      for(const p of ptr.values()) if(p.stick===ctl){ const len=Math.hypot(p.dx,p.dy)||1, k=Math.min(1,p.g.r/len); return {x:p.dx*k, y:p.dy*k}; }
      return {x:0, y:0};
    },
    /* every control and its value: sticks -1…1, triggers 0 or 1, buttons true or false */
    state(){
      const s={};
      for(const ctl in TOUCH_STICKS){ s[TOUCH_STICKS[ctl][0]]=0; s[TOUCH_STICKS[ctl][1]]=0; }
      for(const b of TOUCH_BUTTONS) s[b]=TOUCH_ANALOG.has(b)?0:false;
      for(const p of ptr.values()){
        if(p.stick){ const v=touchStick(p.dx,p.dy,p.g.r), n=TOUCH_STICKS[p.stick]; s[n[0]]=v.x; s[n[1]]=v.y; }
        else s[p.btn]=TOUCH_ANALOG.has(p.btn)?1:true;
      }
      return s;
    },
  };
}

/* Put a state of controls onto the gamepads. padOf(control) says which gamepad reads it (padFor);
   routes remembers where each pressed control went, so letting go clears the same gamepad even if
   the OpMode changed meanwhile. Only what changed since `was` is written, and a real controller's
   fields are left alone. Returns the controls written. */
function touchWrite(pads,routes,now,padOf,was){
  const wrote=[];
  for(const c in now){
    const v=now[c];
    if(was&&was[c]===v) continue;
    const on=typeof v==="number"?v!==0:!!v;
    if(on){ const p=routes[c]!=null?routes[c]:padOf(c); routes[c]=p; pads[p][c]=v; wrote.push(c); }
    else if(routes[c]!=null){ pads[routes[c]][c]=typeof v==="number"?0:false; delete routes[c]; wrote.push(c); }
  }
  return wrote;
}

const TOUCH_FACE=[["y","Y","tc-y"],["x","X","tc-x"],["b","B","tc-b"],["a","A","tc-a"]];
const TouchUI={
  mode:"auto",                       // auto (a touch device), on or off (the menu)
  coarse:false, touched:false, phone:false, drive:false,
  model:null, routes:{}, at:{}, last:null, opSeen:null, root:null, bar:null, toastT:0, installEv:null,
  init(){
    try{ this.coarse=!!(matchMedia&&matchMedia("(pointer: coarse)").matches); }catch(e){}
    this.phone=touchPhone(this.coarse,innerWidth,innerHeight);
    const m=store.get("ftcbench.touch","auto"); this.mode=m==="on"||m==="off"?m:"auto";
    // a phone starts with the panels away and the controls up, until its owner says otherwise
    this.drive=this.phone&&store.get("ftcbench.drive","1")!=="0";
    this.model=touchModel();
    this.build();
    // a touch screen the media query did not call coarse: the first finger on the field says so
    const vp=$("#viewport");
    if(vp) vp.addEventListener("pointerdown",e=>{ if(e.pointerType==="touch"&&!this.touched){ this.touched=true; this.sync(); } },true);
    addEventListener("blur",()=>this.release());
    addEventListener("pagehide",()=>this.release());
    document.addEventListener("visibilitychange",()=>{ if(document.hidden) this.release(); });
    addEventListener("resize",()=>{ this.phone=touchPhone(this.coarse,innerWidth,innerHeight); this.release(); this.sync(); });
    addEventListener("orientationchange",()=>this.release());
    document.addEventListener("fullscreenchange",()=>this.tick());
    document.addEventListener("webkitfullscreenchange",()=>this.tick());
    addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); this.installEv=e; this.menu(); });
    addEventListener("appinstalled",()=>{ this.installEv=null; this.menu(); });
    const item=$("#touchMenu"); if(item) item.addEventListener("click",()=>{ Menu.open(false); this.toggle(); });
    const inst=$("#installMenu"); if(inst) inst.addEventListener("click",()=>{ Menu.open(false); this.install(); });
    this.menu(); this.sync();
  },

  /* ---- what shows ---- */
  wanted(){ return this.mode==="on"||(this.mode==="auto"&&(this.coarse||this.touched)); },
  visible(){
    if(!this.wanted()) return false;
    if(this.phone&&!this.drive) return false;                   // on a phone: the panels or the controls
    if(typeof QuickStart!=="undefined"&&QuickStart.card&&!QuickStart.card.hidden) return false;   // the first-visit card has the screen
    return !(typeof CadView!=="undefined"&&CadView.on);
  },
  sync(){
    const app=$("#app"); if(!app||!this.root) return;
    const vis=this.visible();
    this.root.hidden=!vis;
    app.classList.toggle("drive-mode",this.phone&&this.drive&&this.wanted());
    app.classList.toggle("touch-on",vis);
    this.back.hidden=!(this.phone&&this.wanted()&&!this.drive);
    if(!vis) this.release();
    this.menu(); this.tick();
  },
  /* phone only: the panels away and the controls up, or the other way round */
  setDrive(b){
    this.drive=!!b; store.set("ftcbench.drive",this.drive?"1":"0"); this.sync();
    if(typeof View!=="undefined"&&View.resize) View.resize();
  },
  toggle(){
    if(this.visible()||(this.phone&&this.drive&&this.wanted())){ this.mode="off"; if(this.phone) this.drive=false; }
    else { this.mode="on"; if(this.phone) this.drive=true; }
    store.set("ftcbench.touch",this.mode); store.set("ftcbench.drive",this.drive?"1":"0");
    this.sync(); this.menu();
  },
  menu(){
    const t=$("#touchMenu"); if(t) t.firstChild.nodeValue=this.visible()||(this.phone&&this.drive&&this.wanted())?"Hide touch controls":"Touch controls";
    const i=$("#installMenu"); if(i) i.hidden=!(this.installEv||this.iosHome());
  },
  iosHome(){ try{ return /iPhone|iPad|iPod/.test(navigator.userAgent)&&!(navigator.standalone||matchMedia("(display-mode: standalone)").matches); }catch(e){ return false; } },

  /* ---- the page parts ---- */
  build(){
    const vp=$("#viewport"); if(!vp) return;
    const root=document.createElement("div");
    root.className="touch-ui"; root.id="touchUI"; root.hidden=true;
    const face=TOUCH_FACE.map(f=>`<button type="button" class="tc-btn tc-face ${f[2]}" data-tc="${f[0]}" tabindex="-1" aria-label="${f[1]}">${f[1]}</button>`).join("");
    const pad=[["dpad_up","↑","tc-du"],["dpad_left","←","tc-dl"],["dpad_right","→","tc-dr"],["dpad_down","↓","tc-dd"]]
      .map(d=>`<button type="button" class="tc-btn tc-dp ${d[2]}" data-tc="${d[0]}" tabindex="-1" aria-label="D-pad ${d[0].slice(5)}">${d[1]}</button>`).join("");
    root.innerHTML=
      `<div class="tc-bar" id="tcBar">
        <div class="tc-row"><span class="seg tc-pads" role="group" aria-label="Which gamepad the unclaimed controls go to"><button type="button" data-tcpad="1">1</button><button type="button" data-tcpad="2">2</button></span>
        <button type="button" class="tc-chip tc-more" data-tcact="more" aria-label="More controls" aria-expanded="false"><svg viewBox="0 0 16 4" width="16" height="4" aria-hidden="true"><circle cx="2" cy="2" r="1.6" fill="currentColor"/><circle cx="8" cy="2" r="1.6" fill="currentColor"/><circle cx="14" cy="2" r="1.6" fill="currentColor"/></svg></button></div>
        <button type="button" class="tc-chip" data-tcact="reset" title="Back to the start position">Reset</button>
        <button type="button" class="tc-chip" data-tcact="full" id="tcFull">Fullscreen</button>
        <button type="button" class="tc-chip" data-tcact="panels" id="tcPanels">Panels</button>
      </div>
      <div class="tc-rotate" id="tcRotate" hidden><span>Turn your phone sideways for more room.</span><button type="button" data-tcact="rotate" aria-label="Dismiss">Got it</button></div>
      <div class="tc-stick tc-left" data-tc="left" aria-label="Left stick: drive"><i class="tc-knob"></i></div>
      <div class="tc-stick tc-right" data-tc="right" aria-label="Right stick: turn"><i class="tc-knob"></i></div>
      <div class="tc-shoulders tc-sl"><button type="button" class="tc-btn tc-sh" data-tc="left_trigger" tabindex="-1" aria-label="Left trigger">LT</button><button type="button" class="tc-btn tc-sh" data-tc="left_bumper" tabindex="-1" aria-label="Left bumper">LB</button></div>
      <div class="tc-shoulders tc-sr"><button type="button" class="tc-btn tc-sh" data-tc="right_bumper" tabindex="-1" aria-label="Right bumper">RB</button><button type="button" class="tc-btn tc-sh" data-tc="right_trigger" tabindex="-1" aria-label="Right trigger">RT</button></div>
      <div class="tc-cluster tc-faces">${face}</div>
      <div class="tc-cluster tc-dpad">${pad}</div>`;
    vp.appendChild(root); this.root=root;
    this.back=document.createElement("button");
    this.back.type="button"; this.back.className="tc-back"; this.back.hidden=true; this.back.textContent="Drive with touch";
    this.back.addEventListener("click",()=>{ if(this.mode==="off"){ this.mode="auto"; store.set("ftcbench.touch","auto"); } this.setDrive(true); });
    vp.appendChild(this.back);
    this.say=document.createElement("div");
    this.say.className="tc-toast"; this.say.hidden=true; this.say.setAttribute("role","status");
    vp.appendChild(this.say);
    this.wire(root);
  },
  wire(root){
    root.addEventListener("contextmenu",e=>e.preventDefault());
    root.addEventListener("pointerdown",e=>{
      const el=e.target.closest("[data-tc]"); if(!el||!root.contains(el)) return;
      e.preventDefault();
      const ctl=el.dataset.tc, r=el.getBoundingClientRect();
      const g=TOUCH_STICKS[ctl]?{cx:r.left+r.width/2, cy:r.top+r.height/2, r:r.width/2}:null;
      if(!this.model.down(e.pointerId,ctl,e.clientX,e.clientY,g)) return;
      this.at[e.pointerId]={t:performance.now(), btn:!g};
      try{ el.setPointerCapture(e.pointerId); }catch(err){}
      if(!TOUCH_STICKS[ctl]) this.buzz();
      this.push();
    });
    root.addEventListener("pointermove",e=>{ this.model.move(e.pointerId,e.clientX,e.clientY); if(this.model.count()) this.push(); });
    // a quick tap is held for TOUCH_HOLD ms at least: the OpMode looks at its gamepad every 20 ms, and a tap shorter than that would go by unseen
    const up=e=>{
      const id=e.pointerId, a=this.at[id], wait=a&&a.btn?TOUCH_HOLD-(performance.now()-a.t):0;
      const done=()=>{ if(this.at[id]===a) delete this.at[id]; if(this.model.up(id)) this.push(); };
      if(wait>0) setTimeout(()=>{ if(this.at[id]===a) done(); },wait); else done();
    };
    root.addEventListener("pointerup",up); root.addEventListener("pointercancel",up);
    root.addEventListener("lostpointercapture",up);
    root.addEventListener("click",e=>{
      const b=e.target.closest("[data-tcpad]"); if(b){ setActivePad(+b.dataset.tcpad); this.tick(); return; }
      const a=e.target.closest("[data-tcact]"); if(!a) return;
      const act=a.dataset.tcact, bar=$("#tcBar");
      // the small phone keeps Reset, Fullscreen and Panels behind one button
      if(act==="more"){ const o=!bar.classList.contains("open"); bar.classList.toggle("open",o); a.setAttribute("aria-expanded",String(o)); return; }
      bar.classList.remove("open");
      if(act==="reset") $("#resetPose").click();
      else if(act==="full") this.fullscreen();
      else if(act==="panels"){ if(this.phone) this.setDrive(false); else { this.mode="off"; store.set("ftcbench.touch","off"); this.sync(); this.menu(); } }
      else if(act==="rotate"){ try{ sessionStorage.setItem("ftcbench.rotate","1"); }catch(err){} $("#tcRotate").hidden=true; }
    });
  },
  /* the controls onto the gamepads, and onto the page's own gamepad picture */
  push(){
    const now=this.model.state(), was=this.last;
    const wrote=touchWrite(Sim.pad,this.routes,now,c=>padFor(CODE,c,activePad),was);
    this.last=now;
    if(!wrote.length) { this.paint(now); return; }
    for(const c of wrote){
      const p=this.routes[c]!=null?this.routes[c]:padFor(CODE,c,activePad), v=now[c];
      if(/_stick_[xy]$/.test(c)) knobTo(p,c,v);
      else { const el=$(`#padwrap [data-btn="${c}"]`); if(el&&p===activePad) el.classList.toggle("down",typeof v==="number"?v>0.2:!!v); }
    }
    this.paint(now);
  },
  paint(now){
    if(!this.root) return;
    for(const el of this.root.querySelectorAll(".tc-btn")){ const v=now[el.dataset.tc]; el.classList.toggle("down",typeof v==="number"?v>0.2:!!v); }
    for(const el of this.root.querySelectorAll(".tc-stick")){
      const k=this.model.knob(el.dataset.tc), knob=el.firstChild;
      knob.style.transform=`translate(${(k.x*0.79).toFixed(1)}px,${(k.y*0.79).toFixed(1)}px)`;      // the knob stays inside the ring
      el.classList.toggle("down",k.x!==0||k.y!==0);
    }
  },
  /* every finger up: the app lost the screen, or the controls went away */
  release(){ if(!this.model) return; this.at={}; this.model.clear(); this.push(); },
  buzz(){ try{ if(typeof navigator.vibrate==="function") navigator.vibrate(6); }catch(e){} },

  /* ---- fullscreen, add to home ---- */
  canFull(){ const d=document; return !!(d.fullscreenEnabled||d.webkitFullscreenEnabled); },
  fullscreen(){
    const d=document, el=d.documentElement;
    try{
      if(d.fullscreenElement||d.webkitFullscreenElement){ (d.exitFullscreen||d.webkitExitFullscreen).call(d); return; }
      const f=el.requestFullscreen||el.webkitRequestFullscreen; if(!f) return;
      const r=f.call(el);
      // Android lets a page in fullscreen pick landscape
      const lock=()=>{ try{ if(screen.orientation&&screen.orientation.lock) screen.orientation.lock("landscape").catch(()=>{}); }catch(e){} };
      if(r&&r.then) r.then(lock).catch(()=>{}); else lock();
    }catch(e){}
  },
  install(){
    if(this.installEv){ const ev=this.installEv; this.installEv=null; try{ ev.prompt(); }catch(e){} this.menu(); return; }
    this.toast("In Safari, tap Share, then Add to Home Screen.");
  },
  toast(msg){
    if(!this.say) return;
    this.say.textContent=msg; this.say.hidden=false;
    clearTimeout(this.toastT); this.toastT=setTimeout(()=>{ this.say.hidden=true; },5000);
  },

  /* ~20 times a second, from the page's slow loop */
  tick(){
    if(!this.root) return;
    if(this.visible()===this.root.hidden){ this.sync(); return; }       // the CAD view, or the first-visit card, came or went
    if(this.root.hidden) return;
    // a new OpMode: what both gamepads read goes to the one that has the drive stick (the toggle can say otherwise after)
    if(CODE&&this.opSeen!==CURRENT_ID){ this.opSeen=CURRENT_ID; const d=padFor(CODE,"left_stick_y",-1); if(d===1||d===2) setActivePad(d); }   // -1: neither, or both
    for(const b of this.root.querySelectorAll("[data-tcpad]")) b.classList.toggle("on",+b.dataset.tcpad===activePad);
    const full=$("#tcFull"); if(full){ full.hidden=!this.canFull(); full.textContent=(document.fullscreenElement||document.webkitFullscreenElement)?"Exit fullscreen":"Fullscreen"; }
    const pn=$("#tcPanels"); if(pn) pn.textContent=this.phone?"Panels":"Hide";
    let seen=false; try{ seen=sessionStorage.getItem("ftcbench.rotate")==="1"; }catch(e){}
    $("#tcRotate").hidden=seen||!(this.phone&&innerHeight>innerWidth)||innerHeight<=720;   // a short portrait screen has no room to spare for the line
  },
};

/* ============================================================
   QUICK START — the first visit on a phone: one big button
   ------------------------------------------------------------
   "Drive the sample robot" loads the demo robot's own TeleOp, presses START
   and brings up the controls. The panels stay out of the way until asked
   for. Shown once per browser, and only when no robot of the user's own
   is coming back.
   ============================================================ */
const QuickStart={
  card:null, busy:false, t0:0,
  due(){
    if(!TouchUI.phone||!TouchUI.wanted()) return false;
    if(store.get("ftcbench.quick","0")==="1") return false;
    // a link into a state of its own (?opmode=, ?robot=, #join=) is not a first look
    return !/[?&](opmode|robot|start)=/.test(location.search)&&!/^#(join|path|onshape)/.test(location.hash);
  },
  init(){
    if(!this.due()) return;
    const vp=$("#viewport"); if(!vp) return;
    const c=document.createElement("section");
    c.className="quick-card panel-glass"; c.id="quickCard"; c.setAttribute("aria-label","Quick start");
    c.innerHTML=
      `<svg class="qc-mark" viewBox="0 0 32 32" aria-hidden="true"><path class="bm-hex" d="M16 2.6 27.6 9.3v13.4L16 29.4 4.4 22.7V9.3Z"/><path class="bm-arc" d="M9.3 21c2-6.4 8.2-9.8 14-8"/><circle class="bm-dot" cx="23.4" cy="13" r="2.2"/></svg>
      <h2>SimBench</h2>
      <p class="qc-lede">Drive a real FTC robot on the BIOBUZZ field, in your browser.</p>
      <button type="button" class="qc-go" id="qcGo" disabled>Getting the robot…</button>
      <p class="qc-sub" id="qcSub">The GearGurus 7832 robot, with their own TeleOp.</p>
      <button type="button" class="qc-skip" id="qcSkip">Look around first</button>`;
    vp.appendChild(c); this.card=c;
    $("#qcGo").addEventListener("click",()=>this.go());
    $("#qcSkip").addEventListener("click",()=>this.skip());
    TouchUI.setDrive(true);
    this.tick();
  },
  /* the demo robot and its TeleOp are in and waiting for START */
  ready(){
    return !!(CODE&&CAD&&!ownRobot()&&CAD.name===DEFAULT_ROBOT.step&&entry("itd-sample-tele")&&Sim.phase!=="empty");
  },
  tick(){
    const c=this.card; if(!c||c.hidden) return;
    // a robot of their own came back from last time: this is not a first look, so the controls without the card
    if(LAST_STEP&&ownRobot()){ store.set("ftcbench.quick","1"); c.hidden=true; TouchUI.sync(); return; }
    const ok=this.ready(), go=$("#qcGo");
    go.disabled=!ok||this.busy;
    go.textContent=ok?"Drive the sample robot":"Getting the robot…";
    if(!this.t0) this.t0=performance.now();
    const slow=!ok&&performance.now()-this.t0>45000;
    $("#qcSub").textContent=slow?"This is taking a while. Check the connection, or look around first.":"The GearGurus 7832 robot, with their own TeleOp.";
  },
  go(){
    if(!this.ready()||this.busy) return;
    this.busy=true;
    store.set("ftcbench.quick","1"); store.set("ftcbench.touch","auto");
    if(TouchUI.mode==="off") TouchUI.mode="auto";
    this.card.hidden=true;
    TouchUI.setDrive(true);
    // the team's TeleOp; the left stick is gamepad1's and so is the turn
    if(CURRENT_ID!=="itd-sample-tele"){ USER_CHOSE=true; selectOpMode("itd-sample-tele"); }
    setActivePad(1);
    // from behind the robot, turning as it turns: the view a thumb can drive by
    $$("#viewSeg button").forEach(x=>x.classList.toggle("on",x.dataset.v==="chase"));
    if(CadView.on) CadView.exit();
    View.setView("chase");
    if(Sim.phase!=="running") dsStart();
    if(typeof Challenges!=="undefined") Challenges.enable(true);
    this.busy=false;
  },
  skip(){
    store.set("ftcbench.quick","1");
    this.card.hidden=true;
    TouchUI.setDrive(false);
  },
};
