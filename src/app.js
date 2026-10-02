/* ============================================================
   9.  UI
   ============================================================ */
const $=s=>document.querySelector(s);
const $$=s=>Array.prototype.slice.call(document.querySelectorAll(s));
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
const store={
  get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:v; }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

let CODE=null, CAD=null, MAP={}, FINDINGS=[], activePad=2;
const OPTS={payloadKg:0.180, duty:0.30, trust:"code", robotConfig:null, front:"+x", baseModel:"auto", shooterModel:"auto", shift:null};
let IGNORED={};
try{ IGNORED=JSON.parse(store.get("ftcbench.ignored","{}"))||{}; }catch(e){ IGNORED={}; }
function saveIgnored(){ store.set("ftcbench.ignored",JSON.stringify(IGNORED)); }
let LIBRARY=[], CURRENT_ID=null;
let ROBOT_CFG_NAME=null;
let CONFIG_OVR={};                 // live-edited config variables, like FTC Dashboard
let RIG_DEVICES={};                // device → mechanism, remembered across OpModes
let RAILS_READY=false;             // after boot, picking a tab opens its panel

/* ============================================================
   TABS
   ============================================================ */
function initTabs(){
  calmLayoutOnce();
  $$(".tabs").forEach(nav=>{
    nav.addEventListener("click",e=>{ const b=e.target.closest("button[data-tab]"); if(b) selectTab(nav,b.dataset.tab); });
    nav.addEventListener("keydown",e=>{
      if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft") return;
      const tabs=[].slice.call(nav.querySelectorAll("button[data-tab]"));
      const i=tabs.indexOf(document.activeElement); if(i<0) return;
      const n=tabs[(i+(e.key==="ArrowRight"?1:tabs.length-1))%tabs.length];
      n.focus(); selectTab(nav,n.dataset.tab); e.preventDefault();
    });
    const saved=TAB_RENAMED[store.get("ftcbench.tab."+nav.dataset.tabs,"")]||store.get("ftcbench.tab."+nav.dataset.tabs,null);
    if(saved&&nav.querySelector(`button[data-tab="${saved}"]`)) selectTab(nav,saved);
  });
}
const TAB_RENAMED={code:"teleop", hardware:"robot", rig:"robot", config:"tune"};
/* The first view, once per browser: the field and the OpMode list. The analysis
   panel, the dock and the torque inset start folded; each opens with one click
   and remembers how it was left from then on. */
function calmLayoutOnce(){
  if(store.get("ftcbench.layout","1")==="2") return;
  store.set("ftcbench.rail.right","0"); store.set("ftcbench.dock","0"); store.set("ftcbench.pip","0");
  store.set("ftcbench.tab.left","teleop"); store.set("ftcbench.layout","2");
}
function selectTab(nav,tab){
  tab=TAB_RENAMED[tab]||tab;
  nav.querySelectorAll("button[data-tab]").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.tab===tab)));
  nav.parentElement.querySelectorAll(".pane").forEach(p=>{ p.hidden=p.dataset.pane!==tab; });
  store.set("ftcbench.tab."+nav.dataset.tabs,tab);
  const rail=nav.closest(".rail"); if(RAILS_READY&&rail) setRail(rail.id==="railLeft"?"left":"right",true,false);
  if(tab==="graph") Graph.draw();
  if(tab==="compare") renderCompare();
  if(tab==="shot"){ ShotUI.dirty=true; ShotUI.t=0; renderShotSetup(); }
  if(tab==="java") Editor.refresh();
}
const paneVisible=name=>{ const p=document.querySelector(`.pane[data-pane="${name}"]`); return p&&!p.hidden&&!p.closest(".app").classList.contains(p.closest(".rail-left")?"left-closed":"right-closed"); };

/* ============================================================
   FOLDING — every section, both side panels, the dock
   ============================================================ */
function initCollapsibles(){
  $$(".sec[data-sec]").forEach(sec=>{
    const id=sec.dataset.sec, h=sec.querySelector(".sec-head h3"); if(!h) return;
    const saved=store.get("ftcbench.sec."+id,null);
    const closed=saved==null?sec.dataset.collapsed==="1":saved==="1";
    const set=c=>{ sec.classList.toggle("closed",c); h.setAttribute("aria-expanded",String(!c)); };
    set(closed);
    h.tabIndex=0; h.setAttribute("role","button");
    const flip=()=>{ const c=!sec.classList.contains("closed"); set(c); store.set("ftcbench.sec."+id,c?"1":"0");
      if(id==="coverage") Editor.refresh(); };
    h.addEventListener("click",flip);
    h.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); flip(); } });
  });
}
function setRail(side,open,save){
  const cls=side+"-closed", app=$("#app"), was=!app.classList.contains(cls);
  app.classList.toggle(cls,!open);
  if(save!==false&&open!==was) store.set("ftcbench.rail."+side,open?"1":"0");
  if(open!==was){ View.resize(); if(open) Graph.draw(); }
}
function initRails(){
  $$("[data-rail]").forEach(b=>b.addEventListener("click",()=>{
    const side=b.dataset.rail; setRail(side,$("#app").classList.contains(side+"-closed")); }));
  for(const side of ["left","right"]) if(store.get("ftcbench.rail."+side,"1")==="0") setRail(side,false,false);
  const dock=$("#dock"), tg=$("#dockToggle");
  const setDock=open=>{ dock.classList.toggle("closed",!open); tg.setAttribute("aria-expanded",String(open));
    tg.title=open?"Fold the dock away":"Show the dock"; View.resize(); };
  setDock(store.get("ftcbench.dock","1")!=="0");
  tg.addEventListener("click",()=>{ const open=dock.classList.contains("closed"); setDock(open); store.set("ftcbench.dock",open?"1":"0"); });
  const pip=$("#pip"), ph=$("#pipHead");
  const setPip=open=>{ pip.classList.toggle("closed",!open); ph.setAttribute("aria-expanded",String(open)); };
  setPip(store.get("ftcbench.pip","0")!=="0");
  ph.addEventListener("click",()=>{ const open=pip.classList.contains("closed"); setPip(open); store.set("ftcbench.pip",open?"1":"0"); });
}

/* ============================================================
   OPMODE LIBRARY
   ============================================================ */
function entry(id){ return LIBRARY.filter(e=>e.id===id)[0]||null; }
function parseEntry(e){
  try{ e.code=parseJava(e.source,{libs:helperFiles()}); e.error=null; }
  catch(err){ e.code=null; e.error=err.message; }
  return e;
}
/* Helper classes: the team's other files an OpMode leans on (MecanumDrive,
   an Arm with Road Runner actions, a PID class). The default robot brings
   its own; a dropped .java that isn't an OpMode is kept here too. */
let USER_HELPERS=[], BUILTIN_HELPERS=[];
function helperFiles(){
  const mine=new Set(USER_HELPERS.map(h=>h.file));
  return USER_HELPERS.concat(BUILTIN_HELPERS.filter(h=>!mine.has(h.file)));
}
function saveHelpers(){ store.set("ftcbench.helpers",JSON.stringify(USER_HELPERS.map(h=>({file:h.file, src:h.src})))); }
function loadHelpers(){
  try{ USER_HELPERS=(JSON.parse(store.get("ftcbench.helpers","[]"))||[]).filter(h=>h&&h.file&&typeof h.src==="string"); }catch(e){ USER_HELPERS=[]; }
}
/* every OpMode again, when the helpers they may use have changed */
function reparseAll(){
  LIBRARY.forEach(parseEntry);
  if(entry(CURRENT_ID)) selectOpMode(CURRENT_ID); else { renderOpList(); renderOpSelect(); }
}
const isOpModeSource=t=>/@(TeleOp|Autonomous)\b/.test(stripComments(t))||/\bextends\s+(LinearOpMode|OpMode)\b/.test(t);
function initLibrary(){
  loadHelpers();
  LIBRARY=[
    {id:"sample-claw", file:"WORKSHOPCODE.java", source:SAMPLE_JAVA, builtin:true},
    {id:"sample-mecanum", file:"MecanumTeleOp.java", source:DRIVE_JAVA, builtin:true},
    {id:"sample-auto", file:"TimedDriveAuto.java", source:AUTO_JAVA, builtin:true},
    {id:"sample-shooter", file:"ShooterTeleOp.java", source:SHOOTER_JAVA, builtin:true}
  ];
  try{
    const saved=JSON.parse(store.get("ftcbench.library","[]"))||[];
    for(const s of saved) if(s&&s.id&&s.source) LIBRARY.push({id:s.id, file:s.file||"OpMode.java", source:s.source, builtin:false});
  }catch(e){}
  LIBRARY.forEach(parseEntry);
}
function saveLibrary(){
  store.set("ftcbench.library",JSON.stringify(LIBRARY.filter(e=>!e.builtin).map(e=>({id:e.id,file:e.file,source:e.source}))));
}
const opName=e=> e.code&&e.code.opmode ? e.code.opmode : e.file.replace(/\.java$/,"");
const opKind=e=> e.code&&e.code.kind==="Autonomous" ? "Auto" : "TeleOp";

/* TeleOp and Autonomous OpModes in their own lists. */
function renderOpList(){
  const row=e=>`
    <div class="oprow${e.id===CURRENT_ID?" on":""}" data-op="${esc(e.id)}" tabindex="0" role="button" aria-pressed="${e.id===CURRENT_ID}">
      <div><div class="on-name">${esc(opName(e))}</div><div class="on-file">${esc(e.file)}${e.builtin?" · "+esc(e.team||"sample"):""}</div></div>
      ${e.builtin?"<span></span>":`<button class="rm" data-oprm="${esc(e.id)}" title="Remove ${esc(e.file)}" aria-label="Remove ${esc(e.file)}">×</button>`}
    </div>`;
  const tele=LIBRARY.filter(e=>opKind(e)==="TeleOp"), auto=LIBRARY.filter(e=>opKind(e)==="Auto");
  $("#opListTele").innerHTML=tele.map(row).join("")||`<div class="op-empty">No TeleOp yet — drop a <code>@TeleOp</code> .java here.</div>`;
  $("#opListAuto").innerHTML=auto.map(row).join("")||`<div class="op-empty">No autonomous yet — an <code>@Autonomous</code> .java lands here.</div>`;
  $("#teleCount").textContent=tele.length||""; $("#autoCount").textContent=auto.length||"";
  const H=helperFiles();
  $("#helperList").innerHTML=H.map(h=>`<div class="oprow helper"><div><div class="on-name">${esc(h.file.replace(/\.java$/,""))}</div>
      <div class="on-file">${esc(h.file)}${h.team?" · "+esc(h.team):""}</div></div>
      ${h.team?"<span></span>":`<button class="rm" data-helperrm="${esc(h.file)}" title="Remove ${esc(h.file)}" aria-label="Remove ${esc(h.file)}">×</button>`}</div>`).join("")
    ||`<div class="op-empty">None yet.</div>`;
  $("#helperCount").textContent=H.length||"";
  $$("#helperList [data-helperrm]").forEach(b=>b.addEventListener("click",()=>{
    USER_HELPERS=USER_HELPERS.filter(h=>h.file!==b.dataset.helperrm); saveHelpers(); reparseAll();
  }));
  $$(".oplist [data-op]").forEach(r=>{
    const go=()=>{ if(r.dataset.op!==CURRENT_ID) selectOpMode(r.dataset.op); };
    r.addEventListener("click",e=>{ if(!e.target.closest("[data-oprm]")) go(); });
    r.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } });
  });
  $$(".oplist [data-oprm]").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.oprm;
    LIBRARY=LIBRARY.filter(e=>e.id!==id); saveLibrary();
    if(id===CURRENT_ID) selectOpMode(LIBRARY[0].id); else { renderOpList(); renderOpSelect(); renderCompareSelects(); }
  }));
}
function renderOpSelect(){
  const group=(k,label)=>{
    const items=LIBRARY.filter(e=>opKind(e)===k);
    return items.length?`<optgroup label="${label}">`+items.map(e=>
      `<option value="${esc(e.id)}"${e.id===CURRENT_ID?" selected":""}>${esc(opName(e))}</option>`).join("")+`</optgroup>`:"";
  };
  $("#opSelect").innerHTML=group("TeleOp","TeleOp")+group("Auto","Autonomous");
  const e=entry(CURRENT_ID);
  const k=$("#opKind"); k.textContent=e?opKind(e):"—"; k.className="kind"+(e&&opKind(e)==="Auto"?" auto":"");
}

function selectOpMode(id){
  const e=entry(id); if(!e) return;
  // online, mid-match: the robot could never START again, and the field isn't this bench's to reset
  if(Online.playing()&&CODE){ NetUI.say("The OpMode can't change during an online match. Leave the match first.","warn"); renderOpSelect(); return; }
  if(Sim.phase==="running") Sim.stop();
  CURRENT_ID=id; store.set("ftcbench.current",id);
  Editor.set(e.source); $("#srcName").textContent=e.file;
  CONFIG_OVR={};
  if(!e.code){
    CODE=null;
    $("#coverage").innerHTML=`<p class="cov-ok">Couldn't read this file: ${esc(e.error||"unknown error")}</p>`;
    renderOpList(); renderOpSelect(); return;
  }
  CODE=e.code;
  // an auto written for another season's field would run into this one's HIVEs
  if(e.field||OPTS.obstaclesBy){ OPTS.obstacles=e.field==="other"?"walls":"all"; OPTS.obstaclesBy=e.field==="other"?e.id:null; }
  mapDevices();
  analyzeAll();
  if(!Online.inMatch()) Field.reset();                            // selected and INIT'd: a fresh match
  Shots.reset();
  Sim.load(CODE,CAD,MAP,withPose());
  applyConfigOverrides(); Sim.init(); applyConfigOverrides();    // like a DS: selected and INIT'd, waiting for START
  resetMatch();
  Shots.adopt(CODE); ShotUI.dirty=true; renderShotSetup();
  setActivePad(busiestPad(CODE)); Pads.defaults();
  buildGauges(); Graph.reset(); renderConfigVars(); renderLegend3D();
  renderOpList(); renderOpSelect(); renderCompareSelects(); updateDS();
  NetUI.opChanged();
}
function addOpModeFromText(file,text){
  if(!isOpModeSource(text)&&/\bclass\s+\w+/.test(text)){
    USER_HELPERS=USER_HELPERS.filter(h=>h.file!==file).concat([{file, src:text}]);
    saveHelpers(); reparseAll();
    return;
  }
  const existing=LIBRARY.filter(x=>!x.builtin&&x.file===file)[0];
  const e=existing||{id:"u"+Date.now().toString(36)+Math.random().toString(36).slice(2,6), file, builtin:false};
  e.source=text; parseEntry(e);
  if(!existing) LIBRARY.push(e);
  saveLibrary(); selectOpMode(e.id);
}

/* ============================================================
   DRIVER STATION
   ============================================================ */
const PERIOD={TeleOp:120, Autonomous:30};
function withPose(){ OPTS.startPose=Object.assign({x:0,y:0,h:0},Sim.chassis||{}); return OPTS; }
function applyConfigOverrides(){ for(const k in CONFIG_OVR) Sim.vars[k]=CONFIG_OVR[k]; }
/* The INIT button. Online, the match INITs and STARTs everyone together (NetUI). */
function dsInit(){ if(Online.inMatch()) return; initNow(); }
function initNow(){
  if(!CODE||Sim.phase==="running") return;
  // a fresh match: HIVEs as staged (online, src/net.js staged them for everyone at START)
  if(!Online.inMatch()) Field.reset();
  Shots.reset(); ShotUI.dirty=true;
  Sim.load(CODE,CAD,MAP,withPose());
  applyConfigOverrides(); Sim.init(); applyConfigOverrides();
  resetMatch();
  buildGauges(); Graph.reset(); updateDS();
}
function dsStart(){
  if(!CODE||Online.inMatch()) return;
  if(Sim.phase!=="init") dsInit();
  Sim.start(); updateDS();
}
function dsStop(){ Sim.stop(); updateDS(); }
function updateDS(){
  const ph=Sim.phase;
  const bi=$("#btnInit"), bs=$("#btnStart"), bx=$("#btnStop");
  bi.disabled=!(ph==="loaded"||ph==="stopped");
  bs.disabled=ph!=="init";
  bx.disabled=!(ph==="init"||ph==="running");
  if(Online.inMatch()){ bi.disabled=true; bs.disabled=true; }
  $("#opSelect").disabled=Online.playing();
  bi.classList.toggle("next",!bi.disabled);
  bs.classList.toggle("next",!bs.disabled);
  bx.classList.toggle("live",ph==="running");
  const P={loaded:["Ready — press INIT",""],init:["INIT — waiting for START","accentp"],
           running:["Running","live"],stopped:["Stopped",""],empty:["No OpMode",""]}[ph]||["—",""];
  const pill=$("#phasePill"); pill.textContent=P[0]; pill.className="pill "+P[1];
  const hint=$("#vpHint");
  if(!CODE){ hint.hidden=true; }
  else if(Online.playing()&&ph==="init"){ hint.hidden=false; hint.innerHTML=`Online match: it starts on its own<small>everyone's robot STARTs at the same moment</small>`; }
  else if(Online.state==="done"){ hint.hidden=false; hint.innerHTML=`Match over<small>the host can start another · Leave the match to drive on your own</small>`; }
  else hint.hidden=true;
  updateClock();
}
const clockText=s=>{ s=Math.max(0,s); return Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0"); };
function updateClock(){
  const kind=CODE&&CODE.kind==="Autonomous"?"Autonomous":"TeleOp";
  const P=PERIOD[kind], practice=$("#practice").checked&&!Online.inMatch();
  const t=(Sim.phase==="running"||Sim.phase==="stopped")?Sim.t:0;
  const c=$("#dsClock");
  if(practice){ c.textContent=clockText(t); $("#dsBar").style.width="0"; c.classList.remove("low"); return; }
  const rem=P-t;
  c.textContent=clockText(Math.ceil(rem-1e-6));
  $("#dsBar").style.width=Math.min(100,t/P*100).toFixed(1)+"%";
  c.classList.toggle("low",Sim.phase==="running"&&rem<=10);
  if(Sim.phase==="running"&&rem<=0) dsStop();          // the match period ended
}

/* ============================================================
   THE MATCH — AI robots and HUMAN PLAYERS (src/match.js)
   An alliance partner and two opponents the bench drives, and each
   alliance's HUMAN PLAYER, playing the period the OpMode runs. On with the
   "AI robots" switch; a fresh match (new seed) at every INIT.
   ============================================================ */
function resetMatch(){
  // online, the match is the one everyone plays: src/net.js staged it at START, and nothing here resets it
  if(Online.inMatch()){ renderMatchHud(true); return; }
  const box=$("#matchOn"), want=!!(box&&box.checked&&Field.ok&&OPTS.obstacles!=="walls");
  Match.on=want;
  if(!want){ Match.bots=[]; Match.floor=[]; Match.flying=[]; Match.events=[]; renderMatchHud(true); return; }
  Match.reset({period:CODE&&CODE.kind==="Autonomous"?"Autonomous":"TeleOp", user:Shots.alliance, userPose:Sim.chassis,
    seed:1+Math.floor(Math.random()*99999), skill:$("#matchSkill").value});
  renderMatchHud(true);
}
let HUD_T=0;
function renderMatchHud(force){
  const hud=$("#matchHud"); if(!hud) return;
  const on=Match.live();
  hud.hidden=!on; if(!on) return;
  const now=performance.now(); if(!force&&now-HUD_T<200) return; HUD_T=now;
  // online, the host keeps the score; a guest shows the host's
  const S=Online.guest()&&Online.score?Online.score:Match.score(Sim);
  $("#mhRed").textContent=S.red.total; $("#mhBlue").textContent=S.blue.total;
  const P=Match.period==="Autonomous"?"AUTO":"TELEOP";
  const cd=Online.playing()?Online.countdown():0;
  $("#mhMid").textContent=Online.state==="done"?"FINAL":cd>0?"STARTS IN "+Math.ceil(cd):Online.playing()?P:
    Sim.phase==="stopped"&&Match.t>=Match.len-0.05?"FINAL":Sim.phase==="running"?P:P+" · ready";
  const parts=r=>[r.tips?r.tips+" TIP"+(r.tips>1?"S":""):"", r.leave?"LEAVE "+r.leave:"", r.park?"PARK "+r.park:"",
    r.flower+r.bottom?"FLOWERS "+(r.flower+r.bottom):"", r.cell?"CELL "+r.cell:"", r.garden?"GARDEN "+r.garden:""].filter(Boolean).join(" · ")||"—";
  $("#mhParts").innerHTML=`<span class="red">${esc(parts(S.red))}</span><span class="blue">${esc(parts(S.blue))}</span>`;
  $("#mhEvents").innerHTML=Match.events.slice(0,4).map(e=>`<li class="${e.al||""}"><span>${clockText(Match.len-e.t)}</span>${esc(e.text)}</li>`).join("");
}

/* ============================================================
   GAMEPAD
   ============================================================ */
const PAD_GEO=[
  {id:"left_bumper", x:78,  y:26, w:62, h:17, r:8,  t:"LB"},
  {id:"right_bumper",x:288, y:26, w:62, h:17, r:8,  t:"RB"},
  {id:"left_trigger",x:82,  y:6,  w:54, h:14, r:7,  t:"LT"},
  {id:"right_trigger",x:292,y:6,  w:54, h:14, r:7,  t:"RT"},
  {id:"y", cx:322, cy:70, r:14, t:"Y"},
  {id:"b", cx:346, cy:94, r:14, t:"B"},
  {id:"a", cx:322, cy:118,r:14, t:"A"},
  {id:"x", cx:298, cy:94, r:14, t:"X"},
  {id:"dpad_up",   x:96, y:82, w:17, h:19, r:3, t:"↑"},
  {id:"dpad_down", x:96, y:117,w:17, h:19, r:3, t:"↓"},
  {id:"dpad_left", x:78, y:100,w:19, h:17, r:3, t:"←"},
  {id:"dpad_right",x:113,y:100,w:19, h:17, r:3, t:"→"},
  {id:"back",  x:176, y:80, w:26, h:13, r:6, t:"BK"},
  {id:"start", x:226, y:80, w:26, h:13, r:6, t:"ST"}
];
const STICKS=[{id:"left", cx:160, cy:141, r:22, ax:"left_stick_x", ay:"left_stick_y", t:"LS", btn:"left_stick_button"},
              {id:"right",cx:266, cy:141, r:22, ax:"right_stick_x",ay:"right_stick_y",t:"RS", btn:"right_stick_button"}];

function boundMap(){
  const b={};
  if(CODE) for(const bd of CODE.bindings) if(bd.pad===activePad){
    (b[bd.btn]=b[bd.btn]||[]).push(bd);
    if(bd.axes) bd.axes.forEach(a=>{ const r=splitPadRef(a); if(r) (b[r.btn]=b[r.btn]||[]).push(bd); });
  }
  return b;
}
function actionText(b){
  if(b.assign) return `${b.dev} ${b.op} ${b.expr}`;
  if(b.sleep) return `sleep(${b.expr})`;
  return `${b.dev}.${b.op}(${b.expr})`;
}
function describe(bds){
  const list=Array.isArray(bds)?bds:[bds]; const seen={};
  return list.map(b=>{ const t=actionText(b); if(seen[t]) return null; seen[t]=1; return t; }).filter(Boolean).join("  ·  ");
}
function renderPad(){
  const bound=boundMap();
  let s=`<svg class="padsvg" viewBox="0 0 428 194" role="group" aria-label="Virtual FTC gamepad ${activePad}">`;
  s+=`<path class="shell" d="M60 60 Q60 34 92 34 L336 34 Q368 34 368 60 L368 96 Q368 134 340 152 Q318 166 300 148 L272 120 L156 120 L128 148 Q110 166 88 152 Q60 134 60 96 Z"/>`;
  s+=`<text class="cap" x="214" y="60">gamepad${activePad}</text>`;
  for(const g of PAD_GEO){
    const bd=bound[g.id], cls="btn"+(bd?" bound":"");
    const aria=bd?`${g.t}: ${describe(bd)}`:`${g.t}: unbound`;
    if(g.cx!==undefined){
      s+=`<circle class="${cls}" data-btn="${g.id}" cx="${g.cx}" cy="${g.cy}" r="${g.r}" tabindex="0" role="button" aria-label="${esc(aria)}"><title>${esc(aria)}</title></circle>`;
      s+=`<text class="lbl" x="${g.cx}" y="${g.cy}">${g.t}</text>`;
    }else{
      s+=`<rect class="${cls}" data-btn="${g.id}" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="${g.r}" tabindex="0" role="button" aria-label="${esc(aria)}"><title>${esc(aria)}</title></rect>`;
      s+=`<text class="lbl" x="${g.x+g.w/2}" y="${g.y+g.h/2}">${g.t}</text>`;
    }
  }
  for(const k of STICKS){
    const bd=bound[k.ax]||bound[k.ay]||bound[k.btn];
    const aria=bd?`${k.t} stick: ${describe(bd)}`:`${k.t} stick: unbound`;
    s+=`<circle class="stickwell${bd?" bound":""}" data-stick="${k.id}" cx="${k.cx}" cy="${k.cy}" r="${k.r}" tabindex="0" role="slider" aria-label="${esc(aria)}"><title>${esc(aria)}</title></circle>`;
    s+=`<circle class="stickknob" data-knob="${k.id}" cx="${k.cx}" cy="${k.cy}" r="7"/>`;
    s+=`<text class="lbl" x="${k.cx}" y="${k.cy+k.r+8}">${k.t}</text>`;
  }
  s+=`</svg>`;
  $("#padwrap").innerHTML=s;

  $$("#padwrap [data-btn]").forEach(el=>{
    const b=el.dataset.btn;
    const dn=e=>{ if(e.cancelable) e.preventDefault(); Sim.pad[activePad][b]=true; el.classList.add("down"); };
    const up=()=>{ Sim.pad[activePad][b]=false; el.classList.remove("down"); };
    el.addEventListener("pointerdown",dn); el.addEventListener("pointerup",up); el.addEventListener("pointerleave",up);
    el.addEventListener("keydown",e=>{ if(e.key===" "||e.key==="Enter") dn(e); });
    el.addEventListener("keyup",e=>{ if(e.key===" "||e.key==="Enter") up(); });
  });
  STICKS.forEach(k=>{
    const well=$(`[data-stick="${k.id}"]`), knob=$(`[data-knob="${k.id}"]`); if(!well) return;
    let dragging=false;
    const set=(dx,dy)=>{
      const L=Math.hypot(dx,dy), max=k.r-7;
      if(L>max){ dx*=max/L; dy*=max/L; }
      knob.setAttribute("cx",k.cx+dx); knob.setAttribute("cy",k.cy+dy);
      Sim.pad[activePad][k.ax]=+(dx/max).toFixed(3);
      Sim.pad[activePad][k.ay]=+(dy/max).toFixed(3);   // down is positive, as on a real pad
    };
    const rel=()=>{ dragging=false; knob.setAttribute("cx",k.cx); knob.setAttribute("cy",k.cy);
      Sim.pad[activePad][k.ax]=0; Sim.pad[activePad][k.ay]=0; };
    const toLocal=e=>{ const r=$("#padwrap svg").getBoundingClientRect();
      return [(e.clientX-r.left)*428/r.width-k.cx, (e.clientY-r.top)*194/r.height-k.cy]; };
    well.addEventListener("pointerdown",e=>{ dragging=true; well.setPointerCapture(e.pointerId); const p=toLocal(e); set(p[0],p[1]); });
    well.addEventListener("pointermove",e=>{ if(!dragging) return; const p=toLocal(e); set(p[0],p[1]); });
    well.addEventListener("pointerup",rel); well.addEventListener("pointercancel",rel);
    well.addEventListener("keydown",e=>{
      const v=0.5; let dx=0,dy=0;
      if(e.key==="ArrowLeft")dx=-v; else if(e.key==="ArrowRight")dx=v; else if(e.key==="ArrowUp")dy=-v; else if(e.key==="ArrowDown")dy=v; else return;
      e.preventDefault(); set(dx*(k.r-7),dy*(k.r-7));
    });
    well.addEventListener("blur",rel);
  });
  renderBindList();
}
const CONTROL_LABEL=btn=>btn.replace(/^dpad_/,"D-").replace(/left_bumper/,"LB").replace(/right_bumper/,"RB")
  .replace(/left_trigger/,"LT").replace(/right_trigger/,"RT").replace(/left_stick_button/,"LS BTN").replace(/right_stick_button/,"RS BTN")
  .replace(/left_stick_/,"LS ").replace(/right_stick_/,"RS ").replace(/_/g," ").toUpperCase();
function renderBindList(){
  if(!CODE){ $("#bindlist").innerHTML=""; return; }
  const bs=CODE.bindings.filter(b=>b.pad===activePad);
  if(!bs.length){ $("#bindlist").innerHTML=`<div class="bindrow"><span class="bk">—</span><span class="bd"><span class="edge">Nothing on gamepad${activePad} in this OpMode.</span></span></div>`; return; }
  const byBtn={}; for(const b of bs) (byBtn[b.btn]=byBtn[b.btn]||[]).push(b);
  $("#bindlist").innerHTML=Object.keys(byBtn).sort((x,y)=>{
      const i=CONTROL_ORDER.indexOf(x), j=CONTROL_ORDER.indexOf(y); return (i<0?99:i)-(j<0?99:j); })
    .map(btn=>{
      const g=byBtn[btn];
      return `<div class="bindrow" data-btn="${btn}">
        <span class="bk">${esc(CONTROL_LABEL(btn).slice(0,7))}</span>
        <span class="bd">${esc(describe(g))}
        <span class="edge">${g[0].analog?"analog — follows the stick":(g[0].cond?"when "+esc(g[0].cond.trim().slice(0,52)):"while held")}</span></span></div>`;
    }).join("");
}
function setActivePad(p){
  activePad=p===1?1:2;
  $$("#padSeg button").forEach(x=>x.classList.toggle("on",+x.dataset.pad===activePad));
  renderPad(); Pads.renderChip();
}

/* ============================================================
   ACTUATOR GAUGES
   ============================================================ */
const ARC_R=34, ARC_A0=Math.PI*0.78, ARC_A1=Math.PI*2.22;
function arcPath(t0,t1){
  const a0=ARC_A0+(ARC_A1-ARC_A0)*t0, a1=ARC_A0+(ARC_A1-ARC_A0)*t1;
  const x0=48+ARC_R*Math.cos(a0), y0=44+ARC_R*Math.sin(a0), x1=48+ARC_R*Math.cos(a1), y1=44+ARC_R*Math.sin(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${ARC_R} ${ARC_R} 0 ${(a1-a0)>Math.PI?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function buildGauges(){
  if(!CODE){ $("#gauges").innerHTML=""; return; }
  const acts=CODE.devices.filter(d=>Sim.dev[d.name]&&/Servo|DcMotor/i.test(d.type||""));
  if(!acts.length){ $("#gauges").innerHTML=`<p class="hint" style="grid-column:1/-1">No servos or motors in this OpMode.</p>`; return; }
  $("#gauges").innerHTML=acts.map(d=>{
    const s=Sim.dev[d.name], isMotor=s.kind==="motor", r=travelRange(CODE,d.name);
    const lo=r?r.lo:0, hi=r?r.hi:1;
    return `<div class="gauge" data-dev="${esc(d.name)}" data-motor="${isMotor?1:0}">
      <div class="stallflag" hidden>STALL</div>
      <svg viewBox="0 0 96 74" aria-hidden="true">
        <path class="g-track" d="${arcPath(0,1)}"/>
        ${isMotor?"":`<path class="g-range" d="${arcPath(lo,hi)}"/>`}
        <path class="g-fill" d="${arcPath(0,0.001)}" data-fill></path>
        <line class="g-cmd" data-cmd x1="48" y1="44" x2="48" y2="12"></line>
        <text x="48" y="45" text-anchor="middle" dominant-baseline="central" style="font-family:var(--mono);font-size:14px;font-weight:700;fill:var(--tx)" data-val>0.00</text>
        <text x="48" y="60" text-anchor="middle" style="font-family:var(--mono);font-size:8.5px;fill:var(--tx-3)" data-deg>—</text>
      </svg>
      <div class="gname" title="${esc(d.name)}">${esc(d.name)}</div>
      <div class="gsub">${esc(isMotor?(s.mode==="rtp"?"to position":"power"):(s.spec.role||"servo"))}</div>
    </div>`;
  }).join("");
}
function updateGauges(){
  $$(".gauge").forEach(el=>{
    const s=Sim.dev[el.dataset.dev]; if(!s) return;
    const isMotor=el.dataset.motor==="1";
    const t=isMotor?(s.act+1)/2:clamp01(s.act), tc=isMotor?(s.cmd+1)/2:clamp01(s.cmd);
    el.querySelector("[data-fill]").setAttribute("d",arcPath(isMotor?0.5:0,Math.max(0.002,t)));
    const a=ARC_A0+(ARC_A1-ARC_A0)*clamp01(tc), ln=el.querySelector("[data-cmd]");
    ln.setAttribute("x2",(48+ARC_R*1.14*Math.cos(a)).toFixed(2));
    ln.setAttribute("y2",(44+ARC_R*1.14*Math.sin(a)).toFixed(2));
    el.querySelector("[data-val]").textContent=s.act.toFixed(2);
    el.querySelector("[data-deg]").textContent=isMotor?Math.round(s.ticks)+" ticks":(s.act*s.travelDeg).toFixed(0)+"°";
    el.classList.toggle("stalled",s.stalled);
    el.querySelector(".stallflag").hidden=!s.stalled;
  });
}

/* ============================================================
   TORQUE ANGLE (picture-in-picture)
   ============================================================ */
function liftState(){
  const M=CAD?CAD.mechs:[];
  const byKind=k=>M.filter(m=>m.kind===k)[0]||null;
  const R={lift:byKind("revolute-lift"), yaw:byKind("revolute-yaw"), eff:byKind("effector")};
  const dev=m=>m?deviceOn(m.id):null;
  return {R, aS:Sim.dev[dev(R.lift)]||null, cS:Sim.dev[dev(R.eff)]||null, yS:Sim.dev[dev(R.yaw)]||null};
}
function renderMech(){
  const {R,aS,cS}=liftState();
  if(!R.lift||!aS) return null;
  const L=leverOf(R.lift)*1000||163;
  const ang=(R.lift.restAngleDeg+(aS.act-aS.restPos)*aS.travelDeg)*Math.PI/180;
  const PX=96, PY=60, ARM=92, ex=PX+Math.cos(ang)*ARM, ey=PY-Math.sin(ang)*ARM;
  const open=cS?(1-clamp01(cS.act))*11+4:8, stall=aS.stalled, deg=Math.round(ang*180/Math.PI);
  const col=stall?"#EC5B51":"#F2B230";
  return {deg, svg:`<svg viewBox="0 0 250 150" role="img" aria-label="Side elevation: lift arm at ${deg} degrees from horizontal">
    <line x1="0" y1="136" x2="250" y2="136" stroke="#3A3328"/>
    <line x1="${PX}" y1="${PY}" x2="244" y2="${PY}" stroke="#4A4133" stroke-dasharray="3 3"/>
    <text x="244" y="${PY-4}" text-anchor="end" style="font-family:var(--mono);font-size:8px;fill:#7E7462">horizontal</text>
    <rect x="${PX-34}" y="112" width="68" height="24" rx="3" fill="#221E17" stroke="#3E362A"/>
    <text x="${PX}" y="127" text-anchor="middle" style="font-family:var(--mono);font-size:7.5px;fill:#9A907C">FRAME</text>
    <rect x="${PX-7}" y="${PY}" width="14" height="${112-PY}" fill="#2A251D" stroke="#443B2E"/>
    <line x1="${PX}" y1="${PY}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${col}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="${PX}" cy="${PY}" r="8" fill="#12100C" stroke="${col}" stroke-width="3"/>
    <g transform="translate(${ex.toFixed(1)},${ey.toFixed(1)}) rotate(${(-ang*180/Math.PI).toFixed(1)})">
      <line x1="0" y1="0" x2="13" y2="${(-open).toFixed(1)}" stroke="#E6D2A4" stroke-width="4" stroke-linecap="round"/>
      <line x1="0" y1="0" x2="13" y2="${open.toFixed(1)}" stroke="#E6D2A4" stroke-width="4" stroke-linecap="round"/>
      <circle r="5" fill="#12100C" stroke="#E6D2A4" stroke-width="2.2"/>
    </g>
    <text x="8" y="16" style="font-family:var(--mono);font-size:9px;fill:#B6AB94">${L.toFixed(0)} mm lever</text>
    ${stall?`<text x="8" y="30" style="font-family:var(--mono);font-size:9px;font-weight:700;fill:#EC5B51">STALLED — can't lift</text>`:""}
  </svg>`};
}

/* ============================================================
   TELEMETRY (Driver Station panel)
   ============================================================ */
function telemetryValue(t,env){
  const s=String(t.expr||"").trim();
  if(/^".*"$/.test(s)) return s.slice(1,-1);
  const em=/^([A-Za-z_$][\w$]*)\s*\.\s*get(Position|Power)\s*\(\s*\)$/.exec(s);
  if(em&&Sim.dev[em[1]]) return Sim.dev[em[1]].cmd;
  const ast=parseExpr(s); if(!ast) return null;
  const n=evalNode(ast,env);
  return (typeof n==="number"&&isFinite(n))?n:null;
}
const fmtNum=v=>typeof v!=="number"?String(v):(Math.abs(v)>=100||Number.isInteger(v)?String(Math.round(v*100)/100):v.toFixed(3));
function renderDS(){
  if(!CODE) return `<div class="dsk">No OpMode loaded.</div>`;
  const env=Sim.env(); let out="";
  if(Sim.phase==="loaded"||Sim.phase==="stopped")
    out+=`<div class="dsk">${Sim.phase==="stopped"?"OpMode stopped.":"Press INIT to start."}</div>`;
  // the Java VM runs the team's own telemetry.addData/update: show exactly what it sent
  const vmLines=CODE.engine==="vm"&&Array.isArray(Sim.vmTel)?Sim.vmTel:null;
  if(vmLines) for(const l of vmLines.slice(0,40)){
    const i=String(l).indexOf(" : ");
    out+=i<0?(l?`<div class="dsl">${esc(l)}</div>`:`<div>&nbsp;</div>`)
      :`<div><span class="dsk">${esc(l.slice(0,i))} :</span> <span class="dsv">${esc(l.slice(i+3))}</span></div>`;
  }
  else for(const t of CODE.telemetry){
    if(t.kind==="addLine"){ out+=t.label?`<div class="dsl">${esc(t.label)}</div>`:`<div>&nbsp;</div>`; continue; }
    const v=telemetryValue(t,env);
    out+=`<div><span class="dsk">${esc(t.label)} :</span> <span class="dsv">${v==null?"—":esc(fmtNum(v))}</span></div>`;
  }
  out+=`<div class="dshr">────────────────────</div>`;
  if(Sim.drivetrain&&Sim.drivetrain.ok)
    out+=`<div><span class="dsk">pose</span> <span class="dsv">${poseText(Sim.chassis)}</span></div>`;
  if(Sim.sleptMs&&CODE.hasLoop) out+=`<div><span class="dsk">bench</span> <span class="dsbad">sleep() blocked the loop for ${Math.round(Sim.sleptMs)} ms so far</span></div>`;
  const st=Object.keys(Sim.dev).filter(k=>Sim.dev[k].stalled);
  out+=st.length?`<div><span class="dsk">bench</span> <span class="dsbad">stalled: ${esc(st.join(", "))}</span></div>`
               :`<div><span class="dsk">bench</span> <span class="dsv">actuators tracking command</span></div>`;
  if(!CODE.hasLoop&&CODE.auto&&CODE.auto.length&&Sim.phase==="running")
    out+=`<div><span class="dsk">auto</span> <span class="dsv">${Sim.autoDone?"sequence finished":"step "+Math.min(Sim.pc+1,CODE.auto.length)+" of "+CODE.auto.length}</span></div>`;
  return out;
}

/* ============================================================
   HARDWARE MAP & ASSEMBLY
   ============================================================ */
function renderTables(){
  const mapT=$("#mapTable");
  if(!CODE.devices.length) mapT.innerHTML=`<tr><td class="dim">No devices found in this OpMode.</td></tr>`;
  else mapT.innerHTML=`<tr><th>device</th><th>mechanism</th><th>role</th><th>N·m</th><th>lever</th></tr>`+
    CODE.devices.map(d=>{
      const mech=CAD.mechs.filter(m=>m.id===MAP[d.name])[0]||null;
      const opts=[`<option value="">— none —</option>`].concat(CAD.mechs.map(m=>
        `<option value="${esc(m.id)}"${MAP[d.name]===m.id?" selected":""}>${esc(mlabel(m))}</option>`)).join("");
      const actuator=/Servo|DcMotor/i.test(d.type||"");
      const spec=specFor(d,mech,OPTS.trust);
      const ropts=["Torque","Speed","Servo","Motor","CR"].map(r=>`<option value="${r}"${spec.role===r?" selected":""}>${r}</option>`).join("");
      const lever=mech&&mech.kind!=="fixed"&&mech.kind!=="effector"
        ? `<input class="mini" type="number" step="1" min="0" data-lever="${esc(d.name)}" value="${(leverOf(mech)*1000).toFixed(0)}" aria-label="Lever length for ${esc(d.name)} in mm">`
        : `<span class="dim">—</span>`;
      return `<tr><td class="mono" title="${esc(d.type+" · "+(d.cfg?'"'+d.cfg+'"':"no config name")+" · "+spec.fam+" · from "+spec.src)}">${esc(d.name)}</td>
        <td><select data-dev="${esc(d.name)}" aria-label="Mechanism for ${esc(d.name)}">${opts}</select></td>
        <td>${actuator?`<select data-role="${esc(d.name)}" aria-label="Actuator role for ${esc(d.name)}">${ropts}</select>`:`<span class="dim mono">${esc(d.type)}</span>`}</td>
        <td>${actuator?`<input class="mini" type="number" step="0.05" min="0" data-nm="${esc(d.name)}" value="${(spec.stallNm||0).toFixed(2)}" aria-label="Stall torque for ${esc(d.name)}">`:""}</td>
        <td>${lever}</td></tr>`;
    }).join("");
  mapT.querySelectorAll("[data-role]").forEach(s=>s.addEventListener("change",()=>{
    const n=s.dataset.role;
    HW_USER[n]=Object.assign({},HW_USER[n],{role:s.value, kind:(s.value==="Motor"?"motor":s.value==="CR"?"crservo":"servo")});
    rebuild(); saveRig(); }));
  mapT.querySelectorAll("[data-nm]").forEach(i=>i.addEventListener("change",()=>{
    const v=parseFloat(i.value), n=i.dataset.nm;
    HW_USER[n]=Object.assign({},HW_USER[n],{stallNm:(isFinite(v)&&v>0)?v:undefined});
    rebuild(); saveRig(); }));
  mapT.querySelectorAll("select[data-dev]").forEach(sel=>sel.addEventListener("change",()=>{
    MAP[sel.dataset.dev]=sel.value||null; RIG_DEVICES[sel.dataset.dev]=sel.value||null;
    rebuild(); saveRig(); }));
  mapT.querySelectorAll("[data-lever]").forEach(inp=>inp.addEventListener("change",()=>{
    const mech=CAD.mechs.filter(m=>m.id===MAP[inp.dataset.lever])[0]; if(!mech) return;
    const v=parseFloat(inp.value);
    mech.leverOverride=(isFinite(v)&&v>0)?v/1000:null; mech.inferred=false; rebuild(); saveRig(); }));
  $("#mapPill").textContent=CODE.devices.length+" device"+(CODE.devices.length===1?"":"s");

  const srt=CAD.parts.slice().sort((a,b)=>{ const r=x=>x.kind==="servo"||x.kind==="motor"?0:1; return r(a)-r(b)||a.name.localeCompare(b.name); });
  $("#treeTable").innerHTML=`<tr><th>part</th><th style="text-align:right">qty</th><th>id</th></tr>`+
    srt.map(p=>`<tr><td>${esc(p.name)}${(p.kind==="servo"||p.kind==="motor")?' <span class="tag mut">'+p.kind+'</span>':""}</td>
      <td class="num dim">${p.n}</td><td class="mono dim" style="font-size:10.5px">${esc(p.part||"")}</td></tr>`).join("");
  $("#partPill").textContent=CAD.parts.reduce((s,p)=>s+p.n,0)+" occurrences";
}

/* ============================================================
   THE RIG DOCUMENT
   Detection only seeds this. Once written down it is the model
   everything runs on, it survives reloads, and it can be pasted
   into a repo so next season starts from last season's rig.
   ============================================================ */
let HW_USER={};            // per-device spec overrides
function rigKey(){ return "ftcbench.rig."+((CAD&&CAD.name)||"sample"); }
function exportRig(){
  return {
    format:"ftc-sim-bench.rig", version:1,
    cad:(CAD&&CAD.name)||null, opmode:(CODE&&CODE.opmode)||null,
    trust:OPTS.trust, payloadKg:OPTS.payloadKg, duty:OPTS.duty, turretScale:View.turretScale,
    front:OPTS.front, baseModel:OPTS.baseModel, shooterModel:OPTS.shooterModel, shot:Shots.cfg||null,
    joints:(CAD?CAD.mechs:[]).map(m=>({
      id:m.id, label:m.label||m.id, kind:m.kind, parent:m.parent, dir:m.dir||1,
      pivotMm:m.pivot?m.pivot.map(v=>+(v*1000).toFixed(1)):null,
      axis:m.axis?m.axis.map(v=>+v.toFixed(4)):null,
      leverMm:m.leverOverride!=null?+(m.leverOverride*1000).toFixed(1):null,
      part:m.part||null, manual:!!m.manual, inferred:!!m.inferred })),
    devices:Object.assign({},RIG_DEVICES,MAP), hardware:HW_USER, ignored:Object.keys(IGNORED),
    // the robot setup (SetupUI): which way is up, where the drive base's middle is, the
    // drive base when set by hand, and which checks the team has been through
    up:OPTS.up||null, shift:OPTS.shift||null, drive:(CAD&&CAD.driveSpec)||null, setup:Object.assign({},SETUP.done)
  };
}
function applyRig(r){
  if(!r||!CAD) return false;
  if(r.trust) OPTS.trust=r.trust;
  if(typeof r.payloadKg==="number") OPTS.payloadKg=r.payloadKg;
  if(typeof r.duty==="number") OPTS.duty=r.duty;
  if(typeof r.turretScale==="number") View.turretScale=r.turretScale;
  if(r.front&&FRONTS[r.front]!==undefined) OPTS.front=r.front;
  if(/^(auto|show|hide)$/.test(r.baseModel||"")) OPTS.baseModel=r.baseModel;
  if(/^(auto|show|hide)$/.test(r.shooterModel||"")) OPTS.shooterModel=r.shooterModel;
  if(r.shot&&typeof r.shot==="object") Shots.cfg=Object.assign(Shots.defaults(),r.shot);
  if(r.drive&&typeof r.drive==="object") CAD.driveSpec=cleanDriveSpec(r.drive); else delete CAD.driveSpec;
  SETUP.done=Object.assign({},r.setup&&typeof r.setup==="object"?r.setup:{});
  const byId={}; CAD.mechs.forEach(m=>byId[m.id]=m);
  for(const j of (r.joints||[])){
    let m=byId[j.id];
    if(!m){
      if(!j.manual&&!j.pivotMm) continue;
      m={id:j.id, cluster:[], part:j.part||null, partName:null, hasActuator:false};
      CAD.mechs.push(m); byId[j.id]=m;
    }
    m.label=j.label||m.label||m.id;
    if(j.kind) m.kind=normJointKind(j.kind);      // a saved alias (prismatic, linear-slide) is a linear slide
    if(j.parent) m.parent=j.parent;
    m.dir=j.dir||1;
    if(j.pivotMm) m.pivot=j.pivotMm.map(v=>v/1000);
    if(j.axis) m.axis=j.axis;
    m.leverOverride=(j.leverMm!=null)?j.leverMm/1000:null;
    m.manual=!!j.manual; m.inferred=!!j.inferred;
  }
  RIG_DEVICES=Object.assign({},r.devices||{});
  HW_USER=r.hardware||{};
  if(r.ignored){ IGNORED={}; r.ignored.forEach(k=>IGNORED[k]=1); }
  recomputeChain(CAD.mechs);
  syncOptionControls();
  return true;
}
function applyDeviceMemory(){
  if(!CODE) return;
  const ids={}; CAD.mechs.forEach(m=>ids[m.id]=1);
  // remembered by the device's name, or (code now run on the Java VM) by the variable it was before
  for(const d of CODE.devices){ const k=Object.prototype.hasOwnProperty.call(RIG_DEVICES,d.name)?d.name:(d.alias&&Object.prototype.hasOwnProperty.call(RIG_DEVICES,d.alias)?d.alias:null);
    if(k==null) continue; const v=RIG_DEVICES[k]; if(v===null||ids[v]) MAP[d.name]=v; }
}
function saveRig(){
  store.set(rigKey(),JSON.stringify(exportRig()));
  const ta=$("#rigJson"); if(ta&&document.activeElement!==ta) ta.value=JSON.stringify(exportRig(),null,1);
}
function loadSavedRig(){
  try{ const s=store.get(rigKey(),null); if(!s) return false; return applyRig(JSON.parse(s)); }catch(e){ return false; }
}
function rigSpots(){
  if(!CAD||!CAD.placements) return [];
  const out=[], seen={};
  for(const p of CAD.placements){
    if(!p.child||!p.loc||!p.loc.some(v=>v!==0)) continue;
    const key=p.child+"|"+p.loc.map(v=>v.toFixed(3)).join(",");
    if(seen[key]) continue; seen[key]=1;
    out.push({name:p.child, loc:p.loc, axis:p.axis});
    if(out.length>=400) break;
  }
  return out.sort((a,b)=>a.name.localeCompare(b.name));
}
function addManualJoint(){
  if(!CAD) return;
  const c=[0,1,2].map(i=>(CAD.bbox.min[i]+CAD.bbox.max[i])/2);
  let n=1; while(CAD.mechs.some(m=>m.id==="joint "+n)) n++;
  CAD.mechs.push({id:"joint "+n, label:"joint "+n, kind:"fixed", parent:"chassis", dir:1, axis:[0,0,1], pivot:c,
    cluster:[], part:null, partName:null, hasActuator:false, manual:true, inferred:false, leverOverride:null});
  rigChanged();
}
let RIG_SPOTS=[];
const byMech=id=>CAD?CAD.mechs.filter(m=>m.id===id)[0]||null:null;
function renderRig(){
  const M=CAD.mechs, t=$("#rigTable");
  if(!M.length){ t.innerHTML=`<tr><td class="dim">No mechanisms found in this CAD. Add one with + Joint.</td></tr>`;
    $("#rigChain").innerHTML=""; $("#rigPill").textContent="none"; $("#rigCount").textContent=""; $("#guessPill").textContent="—"; return; }
  RIG_SPOTS=rigSpots();
  const spotOpts=RIG_SPOTS.map((s,i)=>`<option value="${i}">${esc(s.name.slice(0,30))} (${s.loc.map(v=>(v*1000).toFixed(0)).join(",")})</option>`).join("");
  t.innerHTML=`<tr><th>name</th><th>joint</th><th>moves with</th><th>pivot at</th><th>dir</th><th></th></tr>`+
    M.map(m=>{
      const kopts=Object.keys(JOINT_KINDS).map(k=>`<option value="${k}"${m.kind===k?" selected":""}>${JOINT_KINDS[k].label}</option>`).join("");
      const popts=[`<option value="chassis"${m.parent==="chassis"?" selected":""}>chassis (frame)</option>`]
        .concat(M.filter(x=>x.id!==m.id).map(x=>`<option value="${esc(x.id)}"${m.parent===x.id?" selected":""}>${esc(mlabel(x))}</option>`)).join("");
      const dot=m.inferred?`<span class="guess" title="inferred — confirm or change it"></span>`:`<span class="guess set" title="you set this"></span>`;
      return `<tr class="${m.manual?"manual":""}">
        <td><input class="rigname" data-rigname="${esc(m.id)}" value="${esc(mlabel(m))}" aria-label="Name for ${esc(m.id)}">${dot}</td>
        <td><select data-rigkind="${esc(m.id)}" aria-label="Joint type for ${esc(mlabel(m))}">${kopts}</select></td>
        <td><select data-rigparent="${esc(m.id)}" aria-label="What ${esc(mlabel(m))} moves with">${popts}</select></td>
        <td><select data-rigspot="${esc(m.id)}" aria-label="Pivot location for ${esc(mlabel(m))}">
          <option value="">as measured (${m.pivot?m.pivot.map(v=>(v*1000).toFixed(0)).join(","):"—"})</option>${spotOpts}</select></td>
        <td><button class="dirbtn" data-rigdir="${esc(m.id)}" title="Flip which way this joint travels">${m.dir>0?"+":"−"}</button></td>
        <td>${m.manual?`<button class="rmbtn" data-rigrm="${esc(m.id)}" title="Remove this joint">×</button>`:""}</td></tr>`;
    }).join("");
  $("#rigChain").innerHTML=M.map(m=>{
    const carries=rigCarries(M,m.id), dev=deviceOn(m.id);
    const par=m.parent==="chassis"?"the frame":mlabel(M.filter(x=>x.id===m.parent)[0]||{id:m.parent});
    return `<div class="chainrow"><span class="cn">${esc(mlabel(m))}</span> <span class="cj">${esc((JOINT_KINDS[m.kind]||{label:String(m.kind)}).label)}</span>
      ${dev?` <code>${esc(dev)}</code>`:` <span class="cj">no device</span>`}
      <div class="cc">mounted on ${esc(par)} — ${carries.length?"swings <b>"+carries.map(c=>esc(mlabel(M.filter(x=>x.id===c)[0]||{id:c}))).join("</b>, <b>")+"</b> with it":"carries nothing further"}</div></div>`;
  }).join("");
  $("#rigPill").textContent=M.length+" joint"+(M.length===1?"":"s");
  t.querySelectorAll("[data-rigkind]").forEach(s=>s.addEventListener("change",()=>{ const m=byMech(s.dataset.rigkind); if(!m) return; m.kind=s.value; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigparent]").forEach(s=>s.addEventListener("change",()=>{ const m=byMech(s.dataset.rigparent); if(!m) return; m.parent=s.value; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigdir]").forEach(b=>b.addEventListener("click",()=>{ const m=byMech(b.dataset.rigdir); if(!m) return; m.dir=(m.dir>0?-1:1); m.inferred=false; renderRig(); saveRig(); }));
  t.querySelectorAll("[data-rigname]").forEach(i=>i.addEventListener("change",()=>{ const m=byMech(i.dataset.rigname); if(!m) return; m.label=i.value.trim()||m.id; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigspot]").forEach(s=>s.addEventListener("change",()=>{
    const m=byMech(s.dataset.rigspot), sp=RIG_SPOTS[+s.value]; if(!m||s.value===""||!sp) return;
    m.pivot=sp.loc.slice(); m.axis=sp.axis?sp.axis.slice():m.axis; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigrm]").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.rigrm;
    CAD.mechs=CAD.mechs.filter(x=>x.id!==id);
    CAD.mechs.forEach(x=>{ if(x.parent===id) x.parent="chassis"; });
    for(const k in MAP) if(MAP[k]===id){ MAP[k]=null; RIG_DEVICES[k]=null; }
    rigChanged(); }));
  const guessed=M.filter(m=>m.inferred).length, gp=$("#guessPill");
  gp.textContent=guessed?guessed+" guessed":"all confirmed"; gp.className="pill"+(guessed?" warnp":" live");
  const rc=$("#rigCount"); rc.textContent=guessed?String(guessed):""; rc.className="count"+(guessed?" warn":"");
}
function rigChanged(){ recomputeChain(CAD.mechs); View.load(CAD); rebuild(); saveRig(); }

/* ============================================================
   CHECKS (findings, with ignore)
   ============================================================ */
function renderFindings(){
  const live=FINDINGS.filter(f=>!IGNORED[f.key]), hidden=FINDINGS.filter(f=>IGNORED[f.key]);
  const cnt={fail:0,warn:0,pass:0,info:0}; live.forEach(f=>cnt[f.sev]++);
  $("#score").innerHTML=`<div class="s-fail"><div class="k">${cnt.fail}</div><div class="l">won't work</div></div>
     <div class="s-warn"><div class="k">${cnt.warn}</div><div class="l">risky</div></div>
     <div class="s-pass"><div class="k">${cnt.pass}</div><div class="l">checks out</div></div>`;
  const cc=$("#checkCount");
  cc.textContent=cnt.fail?String(cnt.fail):(cnt.warn?String(cnt.warn):"");
  cc.className="count"+(cnt.fail?" fail":cnt.warn?" warn":"");
  const SEVL={fail:"WON'T WORK",warn:"RISKY",pass:"OK",info:"NOTE"};
  $("#findings").innerHTML=live.length?live.map(f=>`<div class="finding ${f.sev}">
      <div class="fhead"><span class="fsev">${SEVL[f.sev]}</span><span class="ftitle">${f.title}</span>
        <button class="fignore" data-ig="${esc(f.key)}" title="Hide this finding — it stays hidden next time too">Ignore</button></div>
      <div class="fbody">${f.body}</div>
      ${(f.math||f.fix)?`<details class="fdetails"${f.sev==="fail"?" open":""}><summary>${f.math?"The numbers":"How to fix it"}</summary>
        ${f.math?`<div class="fmath">${esc(f.math)}</div>`:""}
        ${f.fix?`<div class="ffix"><b>Fix</b>${f.fix}</div>`:""}</details>`:""}</div>`).join("")
    :`<p class="cmp-note">Nothing to report${hidden.length?" — "+hidden.length+" finding"+(hidden.length>1?"s":"")+" ignored":""}.</p>`;
  $("#ignoredWrap").innerHTML=hidden.length
    ?`<div class="ignored-head"><h4>Ignored · ${hidden.length}</h4><span class="spacer"></span><button class="btn-sm" id="clearIgnored">Restore all</button></div>`+
      hidden.map(f=>`<div class="ign-row"><span class="t">${esc(f.title.replace(/<[^>]+>/g,""))}</span><button class="btn-sm" data-unig="${esc(f.key)}">Restore</button></div>`).join(""):"";
  $$("[data-ig]").forEach(b=>b.addEventListener("click",()=>{ IGNORED[b.dataset.ig]=1; saveIgnored(); renderFindings(); saveRig(); }));
  $$("[data-unig]").forEach(b=>b.addEventListener("click",()=>{ delete IGNORED[b.dataset.unig]; saveIgnored(); renderFindings(); saveRig(); }));
  const ci=$("#clearIgnored"); if(ci) ci.addEventListener("click",()=>{ IGNORED={}; saveIgnored(); renderFindings(); saveRig(); });
}

/* ============================================================
   COVERAGE — what the bench actually runs
   ============================================================ */
function renderCoverage(){
  if(!CODE){ $("#coverage").innerHTML=""; return; }
  const cov=coverage(CODE), pill=$("#covPill");
  // on the Java VM every statement runs; what's left to say is a crash or the library calls it stood in for
  const crash=cov.vm&&cov.skipped.find(s=>/exception/.test(s.why)), nStub=cov.vm?cov.skipped.length-(crash?1:0):0;
  pill.textContent=!cov.vm?cov.understood+" / "+cov.total+" statements":crash?"stopped":nStub?"runs · "+nStub+" stand-in"+(nStub===1?"":"s"):"runs as Java";
  pill.className="pill"+(crash?" failp":cov.skipped.length?" warnp":" live");
  Editor.marks(cov.skipped.map(s=>s.line));
  const mode=cov.vm?"Java, the way the robot runs it":CODE.hasLoop?"TeleOp loop":(CODE.auto&&CODE.auto.length?"autonomous sequence of "+CODE.auto.length+" steps":"no loop found");
  if(!cov.skipped.length){
    $("#coverage").innerHTML=`<p class="cov-ok"><b>Everything</b> in this OpMode runs on the bench — ${esc(mode)}.</p>`;
    return;
  }
  $("#coverage").innerHTML=`<p class="cov-ok" style="margin:0 0 6px">${cov.vm?"Runs as Java. "+(crash?"It stopped here, as it would on the robot:":"These library calls do nothing on the bench:"):"Runs as a "+esc(mode)+". These lines are skipped, not guessed at:"}</p>`+
    cov.skipped.map(s=>`<div class="cov-row"><span class="ln">line ${s.line||"?"}</span><span class="tx">${esc(String(s.text).slice(0,90))}</span><span class="why">${esc(s.why)}</span></div>`).join("");
}

/* ============================================================
   CONFIG VARIABLES — live-editable, as FTC Dashboard exposes them
   ============================================================ */
function renderConfigVars(){
  const box=$("#cfgVars"), note=$("#cfgVarNote"), pill=$("#cfgVarPill");
  if(!CODE||!CODE.config.length){
    pill.textContent="none"; box.innerHTML="";
    note.innerHTML="This OpMode has no <code>static</code> fields to tune. FTC Dashboard exposes <code>public static</code> fields of a class marked <code>@Config</code>.";
    return;
  }
  pill.textContent=CODE.config.length+" field"+(CODE.config.length===1?"":"s");
  note.innerHTML=CODE.hasConfigAnnotation
    ?"Edits apply live. INIT starts from the source values."
    :"Edits apply live. (No <code>@Config</code>, so FTC Dashboard won't list them.)";
  box.innerHTML=CODE.config.map(f=>{
    const v=Sim.vars[f.name]!==undefined?Sim.vars[f.name]:0;
    const input=f.type==="boolean"
      ?`<input type="checkbox" data-cv="${esc(f.name)}"${v?" checked":""} aria-label="${esc(f.name)}">`
      :`<input class="mini" type="number" step="${/int|long/.test(f.type)?1:"any"}" data-cv="${esc(f.name)}" value="${esc(fmtNum(v))}" aria-label="${esc(f.name)}">`;
    return `<div class="cv-row${CONFIG_OVR[f.name]!==undefined?" edited":""}" data-cvrow="${esc(f.name)}">
      <div class="cv-name">${esc(f.name)}<small>${esc((f.isPublic?"public static ":"static ")+f.type)}</small></div>
      ${input}<button class="cv-reset" data-cvreset="${esc(f.name)}" title="Back to the value in the source" aria-label="Reset ${esc(f.name)}">↺</button></div>`;
  }).join("");
  $$("#cfgVars [data-cv]").forEach(inp=>inp.addEventListener("change",()=>{
    const name=inp.dataset.cv, f=CODE.config.filter(x=>x.name===name)[0]; if(!f) return;
    let v=inp.type==="checkbox"?(inp.checked?1:0):parseFloat(inp.value);
    if(!isFinite(v)) return;
    if(/int|long/.test(f.type)) v=Math.round(v);
    CONFIG_OVR[name]=v; Sim.vars[name]=v;
    inp.closest(".cv-row").classList.add("edited");
  }));
  $$("#cfgVars [data-cvreset]").forEach(b=>b.addEventListener("click",()=>{
    const name=b.dataset.cvreset; delete CONFIG_OVR[name];
    const src=CODE.vars[name]!==undefined?CODE.vars[name]:0;
    Sim.vars[name]=src; renderConfigVars();
  }));
}
function updateConfigValues(){
  $$("#cfgVars [data-cv]").forEach(inp=>{
    if(document.activeElement===inp) return;
    const v=Sim.vars[inp.dataset.cv]; if(v===undefined) return;
    if(inp.type==="checkbox") inp.checked=!!v;
    else { const t=fmtNum(v); if(inp.value!==t) inp.value=t; }
  });
}

/* ============================================================
   GRAPH — telemetry and actuators over time
   One y-axis per chart: wide-range values (encoder counts) and unit-range
   values (servo position, motor power) get separate charts on a shared
   time axis rather than two scales on one plot.
   ============================================================ */
const Graph={
  win:30, paused:false, series:new Map(), t0:0, hoverT:null, maxSlots:8,
  reset(){ this.series.clear(); this.t0=performance.now()/1000; this.hoverT=null; this.renderLegend(); this.draw(); },
  now(){ return performance.now()/1000-this.t0; },
  slotFor(s){
    if(s.slot!=null) return s.slot;
    const used={}; this.series.forEach(x=>{ if(x.slot!=null) used[x.slot]=1; });
    for(let i=0;i<this.maxSlots;i++) if(!used[i]){ s.slot=i; return i; }
    let victim=null; this.series.forEach(x=>{ if(!victim&&x.slot!=null&&!x.on) victim=x; });
    if(victim){ s.slot=victim.slot; victim.slot=null; return s.slot; }
    return null;
  },
  push(key,label,sub,v,defaultOn,wide){
    let s=this.series.get(key);
    if(!s){
      s={key,label,sub,on:false,slot:null,data:[],wide:!!wide};
      this.series.set(key,s);
      if(defaultOn&&this.slotFor(s)!=null) s.on=true;
      this.legendDirty=true;
    }
    if(Math.abs(v)>2&&!s.wide){ s.wide=true; }
    const t=this.now();
    s.data.push(t,v);
    while(s.data.length>2&&s.data[0]<t-62) s.data.splice(0,2);
    s.last=v;
  },
  sample(){
    if(this.paused||!CODE||Sim.phase==="empty") return;
    const env=Sim.env(); let telCount=0;
    for(const t of CODE.telemetry) if(t.kind==="addData"){
      const v=telemetryValue(t,env);
      if(typeof v==="number"){ this.push("tel:"+t.label,t.label.trim(),"telemetry",v,true,false); telCount++; }
    }
    for(const d of CODE.devices){
      const s=Sim.dev[d.name]; if(!s||!/Servo|DcMotor/i.test(d.type||"")) continue;
      if(s.kind==="servo") this.push("pos:"+d.name,d.name,"servo position",s.act,telCount===0,false);
      else{
        this.push("pow:"+d.name,d.name,"motor power",s.act,false,false);
        this.push("tick:"+d.name,d.name,"encoder counts",s.ticks,false,true);
      }
    }
    if(this.legendDirty){ this.legendDirty=false; this.renderLegend(); }
  },
  color(slot){ return getComputedStyle(document.documentElement).getPropertyValue("--s"+(slot+1)).trim()||"#888"; },
  renderLegend(){
    const el=$("#legend"); if(!el) return;
    const list=[...this.series.values()];
    if(!list.length){ el.innerHTML=""; return; }
    const order={"telemetry":0,"servo position":1,"motor power":2,"encoder counts":3};
    list.sort((a,b)=>(order[a.sub]-order[b.sub])||a.label.localeCompare(b.label));
    el.innerHTML=list.map(s=>`<label class="lg-row${s.on?"":" off"}">
        <input type="checkbox" data-lg="${esc(s.key)}"${s.on?" checked":""}>
        <i style="background:${s.on&&s.slot!=null?this.color(s.slot):"transparent"};${s.on?"":"box-shadow:inset 0 0 0 1px var(--line)"}"></i>
        <span class="lg-name">${esc(s.label)} <small>${esc(s.sub)}</small></span>
        <span class="lg-v" data-lgv="${esc(s.key)}">—</span></label>`).join("")+
      `<div class="lg-note" id="lgNote">Up to ${this.maxSlots} series at once. Each keeps its colour while it's on.</div>`;
    $$("#legend [data-lg]").forEach(cb=>cb.addEventListener("change",()=>{
      const s=this.series.get(cb.dataset.lg); if(!s) return;
      if(cb.checked){ if(this.slotFor(s)==null){ cb.checked=false; $("#lgNote").textContent="Already showing "+this.maxSlots+" series — turn one off first."; return; } s.on=true; }
      else s.on=false;
      this.renderLegend(); this.draw();
    }));
    this.updateLegendValues();
  },
  updateLegendValues(){
    $$("#legend [data-lgv]").forEach(el=>{ const s=this.series.get(el.dataset.lgv); if(s&&s.last!=null) el.textContent=fmtNum(s.last); });
  },
  groups(){
    const on=[...this.series.values()].filter(s=>s.on&&s.slot!=null);
    return [{id:"wide", title:"Counts & wide-range values", list:on.filter(s=>s.wide)},
            {id:"norm", title:"Positions & power  (−1 … 1)", list:on.filter(s=>!s.wide)}].filter(g=>g.list.length);
  },
  layout(){
    const box=$("#charts"); if(!box) return [];
    const groups=this.groups();
    const sig=groups.map(g=>g.id).join("|");
    if(box.dataset.sig!==sig){
      box.dataset.sig=sig;
      box.innerHTML=groups.length?groups.map(g=>`<div class="chart" data-chart="${g.id}"><h4>${esc(g.title)}</h4><canvas></canvas><div class="tip" hidden></div></div>`).join("")
        :`<div class="chart-empty">${CODE?"Turn on a series below, or press START and drive — values appear as the OpMode runs.":"Load an OpMode to graph it."}</div>`;
      $$("#charts .chart canvas").forEach(cv=>{
        cv.addEventListener("pointermove",e=>{ const r=cv.getBoundingClientRect(); this.hoverX=(e.clientX-r.left)/r.width; this.hoverChart=cv.parentElement.dataset.chart; this.draw(); });
        cv.addEventListener("pointerleave",()=>{ this.hoverX=null; this.draw(); });
      });
    }
    return groups;
  },
  draw(){
    if(!paneVisible("graph")) return;
    const groups=this.layout(); if(!groups.length) return;
    const css=getComputedStyle(document.documentElement);
    const ink2=css.getPropertyValue("--tx-2").trim(), ink3=css.getPropertyValue("--tx-3").trim();
    const grid=css.getPropertyValue("--grid").trim(), axis=css.getPropertyValue("--axis").trim();
    const panel=css.getPropertyValue("--panel").trim();
    const tNow=this.paused&&this.pausedAt!=null?this.pausedAt:this.now(), t0=tNow-this.win;
    groups.forEach((g,gi)=>{
      const wrap=document.querySelector(`[data-chart="${g.id}"]`); if(!wrap) return;
      const cv=wrap.querySelector("canvas"), tip=wrap.querySelector(".tip");
      const last=gi===groups.length-1;
      const W=cv.clientWidth||300, H=last?168:146, dpr=Math.min(devicePixelRatio||1,2);
      cv.style.height=H+"px";
      if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){ cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); }
      const ctx=cv.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
      const L=46, R=66, T=8, B=last?22:8, pw=W-L-R, ph=H-T-B;
      // y domain from what's visible in the window
      let lo=Infinity, hi=-Infinity;
      for(const s of g.list) for(let i=0;i<s.data.length;i+=2){ if(s.data[i]<t0) continue; const v=s.data[i+1]; if(v<lo)lo=v; if(v>hi)hi=v; }
      if(!isFinite(lo)){ lo=0; hi=1; }
      if(g.id==="norm"){ lo=Math.min(lo,0); hi=Math.max(hi,lo<0?1:1); if(lo<0) lo=Math.min(lo,-1); }
      else { if(lo>0&&lo<hi*0.3) lo=0; if(hi<0&&hi>lo*0.3) hi=0; }
      if(hi-lo<1e-9){ hi+=1; lo-=1; }
      const span=hi-lo, raw=span/4, mag=Math.pow(10,Math.floor(Math.log10(raw))), f=raw/mag;
      const step=(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*mag;
      lo=Math.floor(lo/step)*step; hi=Math.ceil(hi/step)*step;
      const X=t=>L+(t-t0)/this.win*pw, Y=v=>T+(1-(v-lo)/(hi-lo))*ph;
      // grid and y labels
      ctx.lineWidth=1; ctx.font="10px "+css.getPropertyValue("--mono"); ctx.textBaseline="middle";
      for(let v=lo; v<=hi+step*0.5; v+=step){
        const y=Math.round(Y(v))+0.5;
        ctx.strokeStyle=Math.abs(v)<step*1e-6?axis:grid; ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(L+pw,y); ctx.stroke();
        ctx.fillStyle=ink3; ctx.textAlign="right"; ctx.fillText(fmtTick(v,step),L-6,y);
      }
      if(last){
        ctx.textAlign="center"; ctx.textBaseline="top";
        const marks=this.win<=10?[10,5,0]:this.win<=30?[30,20,10,0]:[60,45,30,15,0];
        for(const m of marks){ const x=X(tNow-m); ctx.fillStyle=ink3; ctx.fillText(m===0?"now":"−"+m+" s",x,T+ph+6); }
      }
      // lines
      ctx.save(); ctx.beginPath(); ctx.rect(L,T-2,pw,ph+4); ctx.clip();
      ctx.lineJoin="round"; ctx.lineCap="round"; ctx.lineWidth=2;
      for(const s of g.list){
        ctx.strokeStyle=this.color(s.slot); ctx.beginPath(); let started=false;
        for(let i=0;i<s.data.length;i+=2){
          if(s.data[i]<t0-1) continue;
          const x=X(s.data[i]), y=Y(s.data[i+1]);
          if(!started){ ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
      ctx.restore();
      // endpoint marks and direct labels, nudged apart
      const ends=g.list.filter(s=>s.data.length).map(s=>({s, x:X(s.data[s.data.length-2]), y:Y(s.data[s.data.length-1])}));
      ends.sort((a,b)=>a.y-b.y);
      for(let i=1;i<ends.length;i++) if(ends[i].ly==null){ ends[i].ly=Math.max(ends[i].y,(ends[i-1].ly!=null?ends[i-1].ly:ends[i-1].y)+12); }
      ctx.textAlign="left"; ctx.textBaseline="middle";
      ends.forEach(e=>{
        ctx.fillStyle=this.color(e.s.slot); ctx.strokeStyle=panel; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(Math.min(e.x,L+pw),e.y,4,0,Math.PI*2); ctx.fill(); ctx.stroke();
        if(g.list.length<=4){ ctx.fillStyle=ink2; ctx.fillText(e.s.label.slice(0,10),L+pw+8,Math.min(T+ph,Math.max(T,e.ly!=null?e.ly:e.y))); }
      });
      // crosshair and tooltip
      if(this.hoverX!=null){
        const x=L+Math.max(0,Math.min(1,(this.hoverX*W-L)/pw))*pw, t=t0+(x-L)/pw*this.win;
        ctx.strokeStyle=ink3; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(Math.round(x)+0.5,T); ctx.lineTo(Math.round(x)+0.5,T+ph); ctx.stroke();
        if(this.hoverChart===g.id){
          const rows=g.list.map(s=>{ let best=null,bd=1e9; for(let i=0;i<s.data.length;i+=2){ const d=Math.abs(s.data[i]-t); if(d<bd){bd=d;best=s.data[i+1];} } return {s,v:best}; });
          tip.hidden=false;
          tip.innerHTML=`<div class="tt">${(tNow-t).toFixed(1)} s ago</div>`+rows.map(r=>`<div class="tr"><i style="background:${this.color(r.s.slot)}"></i><span>${esc(r.s.label)}</span><span>${r.v==null?"—":esc(fmtNum(r.v))}</span></div>`).join("");
          const tw=tip.offsetWidth||140;
          tip.style.left=Math.max(0,Math.min(W-tw,x+(x>W/2?-tw-10:10)))+"px"; tip.style.top="22px";
        } else tip.hidden=true;
      } else tip.hidden=true;
    });
  }
};
function fmtTick(v,step){
  if(Math.abs(v)>=10000) return (v/1000).toFixed(0)+"k";
  // as many decimals as the step needs: 0.25 → 2, 0.5 → 1, 2 → 0
  let d=0; while(d<4&&Math.abs(Math.round(step*Math.pow(10,d))-step*Math.pow(10,d))>1e-6) d++;
  return v.toFixed(d);
}

/* ============================================================
   THEME — dark by default; the choice is remembered
   ============================================================ */
const SUN='<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M3 13l1.1-1.1M11.9 4.1L13 3"/></g></svg>';
const MOON='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.6 10.2A6 6 0 0 1 5.8 2.4a6 6 0 1 0 7.8 7.8z" fill="currentColor"/></svg>';
const currentTheme=()=>document.documentElement.getAttribute("data-theme")==="light"?"light":"dark";
function setTheme(t){
  document.documentElement.setAttribute("data-theme",t);
  store.set("ftcbench.theme",t);
  const b=$("#themeBtn"); if(!b) return;
  const next=t==="dark"?"light":"dark";
  b.innerHTML=t==="dark"?SUN:MOON;
  b.setAttribute("aria-label","Switch to "+next+" theme"); b.title="Switch to "+next+" theme";
  Graph.draw();
}

/* ============================================================
   COMPARE TWO OPMODES
   ============================================================ */
function renderCompareSelects(){
  const opts=LIBRARY.filter(e=>e.code).map(e=>`<option value="${esc(e.id)}">${esc(opName(e))} — ${esc(e.file)}</option>`).join("");
  const a=$("#cmpA"), b=$("#cmpB"), va=a.value, vb=b.value;
  a.innerHTML=opts; b.innerHTML=opts;
  a.value=entry(va)?va:(CURRENT_ID||"");
  const other=LIBRARY.filter(e=>e.code&&e.id!==a.value&&opKind(e)===opKind(entry(a.value)||{}))[0]||LIBRARY.filter(e=>e.code&&e.id!==a.value)[0];
  b.value=entry(vb)&&vb!==a.value?vb:(other?other.id:a.value);
  if(paneVisible("compare")) renderCompare();
}
function renderCompare(){
  const A=entry($("#cmpA").value), B=entry($("#cmpB").value), box=$("#compare");
  if(!A||!B||!A.code||!B.code){ box.innerHTML=`<p class="cmp-note">Load a second OpMode to compare against — two versions of the same TeleOp is the usual case.</p>`; return; }
  if(A.id===B.id){ box.innerHTML=`<p class="cmp-note">Pick two different OpModes.</p>`; return; }
  const d=diffOpModes(A.code,B.code), S=d.summary;
  const rank={changed:0,added:1,removed:2,same:3};
  const rows=d.controls.slice().sort((x,y)=>rank[x.status]-rank[y.status]);
  const side=list=>list.length?list.map(esc).join("<br>"):"<em>nothing</em>";
  box.innerHTML=`<div class="cmp-sum">
      <span class="pill${S.changed?" warnp":""}">${S.changed} changed</span>
      <span class="pill${S.added?" live":""}">${S.added} only in B</span>
      <span class="pill${S.removed?" failp":""}">${S.removed} only in A</span>
      <span class="pill">${S.same} same</span></div>
    <div class="cmp-sec"><h4>Controls</h4>${rows.length?rows.map(r=>`<div class="cmp-row ${r.status}">
        <div class="ctl">${esc(r.control)} <span class="st">${r.status==="added"?"only in B":r.status==="removed"?"only in A":r.status}</span></div>
        <div class="side">${side(r.a)}</div><div class="side">${side(r.b)}</div></div>`).join(""):`<p class="hint">Neither OpMode reads a gamepad.</p>`}</div>
    ${(d.devices.added.length||d.devices.removed.length)?`<div class="cmp-sec"><h4>Devices</h4>
      ${d.devices.removed.length?`<div class="cmp-row removed"><div class="ctl">only in A</div><div class="side">${d.devices.removed.map(esc).join(", ")}</div></div>`:""}
      ${d.devices.added.length?`<div class="cmp-row added"><div class="ctl">only in B</div><div class="side">${d.devices.added.map(esc).join(", ")}</div></div>`:""}</div>`:""}
    ${d.values.length?`<div class="cmp-sec"><h4>Values</h4>${d.values.map(v=>`<div class="cmp-row changed">
        <div class="ctl">${esc(v.name)}</div><div class="side">${v.a===undefined?"<em>not declared</em>":esc(fmtNum(v.a))}</div><div class="side">${v.b===undefined?"<em>not declared</em>":esc(fmtNum(v.b))}</div></div>`).join("")}</div>`:""}`;
}

/* ============================================================
   SHOT — the BIOBUZZ Shot Sim, live from where the robot is
   ============================================================ */
const VERDICT_CLASS={"POSSIBLE":"pass","NOT CONSISTENT":"warn","WON'T WORK":"fail"};
const VERDICT_HEX={"POSSIBLE":0x3FB68B,"NOT CONSISTENT":0xE0A42E,"WON'T WORK":0xE4574E};
const ShotUI={key:null, still:0, t:0, dirty:true, full:false, res:null, win:null, preview:null, arc:true, arcKey:null};
const wrap180=d=>((d%360)+540)%360-180;
const poseText=c=>Field.ok
  ? `x ${(c.x/IN).toFixed(1)} · y ${(c.y/IN).toFixed(1)} in · ${Math.round(wrap180(c.h*180/Math.PI))}°`
  : `x ${c.x.toFixed(2)} m · y ${c.y.toFixed(2)} m · ${Math.round(c.h*180/Math.PI)}°`;
function setHTML(el,html){ if(el&&el.innerHTML!==html) el.innerHTML=html; }
function placeAtStart(){
  const p=Field.ok?Field.startPose(Shots.alliance,footprintOf(CAD,OPTS.front)):{x:0,y:0,h:0};
  Sim.chassis={x:p.x,y:p.y,h:p.h}; OPTS.startPose=Object.assign({},p);
}
/* online: the match deals the alliance (NetUI.begin passes dealt); nobody changes sides mid-match */
function setAlliance(al,move,dealt){
  if(Online.inMatch()&&!dealt){ renderShotSetup(); return; }
  Shots.alliance=al==="blue"?"blue":"red"; View.alliance=Shots.alliance; store.set("ftcbench.alliance",Shots.alliance);
  if(View.mode==="field") View.setView("field");
  if(move&&CAD&&Sim.phase!=="running") placeAtStart();
  if(Sim.phase!=="running") resetMatch();
  ShotUI.dirty=true; ShotUI.t=0; renderShotSetup();
}
/* Ticks per second at full speed for the flywheel as the code declares it,
   so the advice comes out in the units setVelocity() takes. */
function flywheelTicks(){
  const s=Shots.cfg&&Shots.cfg.shooter&&Sim.dev[Shots.cfg.shooter];
  return s?(s.spec.rpm||300)/60*s.tpr:2800;
}
function shotEvaluate(mode){
  try{
    const c=Sim.chassis;
    ShotUI.res=Field.E.evaluate(Shots.params(c),mode);
    ShotUI.win=paneVisible("shot")?Shots.window(c,ShotUI.res.best?ShotUI.res.best.yawDeg:ShotUI.res.psi0Deg):null;
  }catch(e){ ShotUI.res=null; ShotUI.win=null; }
}
function shotTick(now){
  if(!Field.ok||!Shots.cfg||!CAD) return;
  const c=Sim.chassis;
  const key=[(c.x/IN).toFixed(1),(c.y/IN).toFixed(1),Field.hive.red,Field.hive.blue,Shots.alliance,JSON.stringify(Shots.cfg)].join("|");
  if(key!==ShotUI.key){ ShotUI.key=key; ShotUI.still=now; ShotUI.dirty=true; ShotUI.full=false; }
  let fresh=false;
  if(ShotUI.dirty&&now-ShotUI.t>=250){ shotEvaluate("coarse"); ShotUI.t=now; ShotUI.dirty=false; fresh=true; }
  else if(!ShotUI.dirty&&!ShotUI.full&&now-ShotUI.still>=700&&(paneVisible("shot")||Shots.cfg.shooter)){ shotEvaluate("full"); ShotUI.full=true; fresh=true; }
  // what would happen if the robot fired right now: the shot on aim, and the
  // share of real, scattered shots that go in — with the robot's motion in both
  ShotUI.preview=null;
  if(Shots.cfg.shooter&&Shots.spin()>0.1){
    const v=Shots.exitSpeed();
    if(v>=1){
      const L=Shots.withVelocity(v,Shots.cfg.hoodDeg,Shots.yawDeg(c),Sim.vel);
      ShotUI.preview=Field.E.classifyShot(Shots.params(c),L.th,L.v,L.yaw);
      if(now-(ShotUI.oddsT||0)>=250){ ShotUI.oddsT=now; ShotUI.odds=Shots.odds(c,Sim.vel,40); }
    }
  }else ShotUI.odds=null;
  updateArc();
  const sc=$("#shotCount"), r=ShotUI.res;
  // no flywheel in the code: the verdict is a what-if, so the tab gets no red cross
  if(sc){ const k=r&&Shots.cfg.shooter?VERDICT_CLASS[r.verdict]:""; sc.textContent=!k?"":(k==="pass"?"✓":k==="warn"?"~":"✕"); sc.className="count"+(k==="fail"?" fail":k==="warn"?" warn":""); }
  if(paneVisible("shot")){ if(fresh) renderShotVerdict(); renderShotLive(); renderHives(); renderShotLog(); }
}
function updateArc(){
  let path=null, col=0, dashed=false;
  // no flywheel in the code (and none picked): no arc. A claw robot used to
  // draw a phantom shot line up into the sky.
  if(ShotUI.arc&&Shots.cfg&&Shots.cfg.shooter){
    if(ShotUI.preview){ const o=ShotUI.odds==null?(ShotUI.preview.hit?1:0):ShotUI.odds;
      path=ShotUI.preview.path; col=o>=0.8?0x5DBE72:o>=0.4?0xEE7F42:0xEC5B51; }
    // the best arc only when it's worth showing: a WON'T WORK "best" can be a 6 m lob
    else if(ShotUI.res&&ShotUI.res.trajectory&&ShotUI.res.verdict!=="WON'T WORK"){
      path=ShotUI.res.trajectory; col=VERDICT_HEX[ShotUI.res.verdict]||0x8595A8; dashed=true; }
  }
  const k=path?[path.length,path[0].join(","),path[path.length-1].join(","),col,dashed].join("|"):"";
  if(k===ShotUI.arcKey) return;
  ShotUI.arcKey=k; View.setArc(path,col,dashed);
}
function renderShotVerdict(){
  const el=$("#shotVerdict"); if(!el) return;
  if(!Field.ok){ el.className="verdict"; el.innerHTML=`<div class="vs">The BIOBUZZ field didn't load, so there is nothing to shoot at. Everything else on the bench works.</div>`; return; }
  const r=ShotUI.res, c=Sim.chassis, al=Shots.target().toUpperCase();
  if(!r){ el.className="verdict"; el.innerHTML=`<div class="vs">Working out the shot from here…</div>`; return; }
  const b=r.best, what=!Shots.cfg||!Shots.cfg.shooter;
  el.className="verdict "+(what?"":VERDICT_CLASS[r.verdict]||"");
  el.innerHTML=what
    ?`<div class="vhead"><span class="vw">No shooter</span></div>
    <div class="vs">This OpMode has no flywheel. A tuned shooter here would be <b>${esc(r.verdict.toLowerCase())}</b>: ${Math.round((r.hitRate||0)*100)}% of shots in, from ${Math.round(r.distIn)} in to the ${al} up-CELL.</div>`
    :`<div class="vhead"><span class="vw">${esc(r.verdict)}</span><span class="vr">${Math.round((r.hitRate||0)*100)}% score</span></div>
    <div class="vs">From x ${(c.x/IN).toFixed(0)}, y ${(c.y/IN).toFixed(0)} in to the ${al} up-CELL, ${Math.round(r.distIn)} in away. ${esc(r.reason||"")}</div>
    ${b?`<div class="vk"><div><b>${b.thetaDeg.toFixed(0)}°</b><span>launch</span></div><div><b>${b.v.toFixed(2)}</b><span>m/s exit</span></div><div><b>${r.motor?Math.round(r.motor.motorRpm).toLocaleString():"—"}</b><span>motor rpm</span></div></div>`:""}
    ${(r.warnings||[]).map(w=>`<div class="vwarn">${esc(w.text)}</div>`).join("")}`;
}
function renderShotLive(){
  const el=$("#shotLive"); if(!el||!Shots.cfg) return;
  const cfg=Shots.cfg, full=Shots.full(), spin=Shots.spin(), c=Sim.chassis, out=[];
  // the headline: what happens if the robot fires right now
  if(cfg.shooter&&ShotUI.odds!=null){
    const o=ShotUI.odds, cls=o>=0.8?"ok":o>=0.4?"mid":"bad", p=ShotUI.preview;
    const aimNote=p?(p.hit?"a shot right on aim goes in":"a shot right on aim "+(CAUSE_TEXT[p.cause]||"misses")):"";
    const moving=Math.hypot(Sim.vel.x,Sim.vel.y)>0.05?" — while driving":"";
    out.push(`<div class="odds ${cls}"><span class="big">${Math.round(o*100)}%</span><span>of shots go in if you fire now${moving}.<br><span class="dim">${esc(aimNote)}</span></span></div>`);
  }
  if(!cfg.shooter) out.push(`<div>If the flywheel has another name, pick it below.</div>`);
  else out.push(`<div><code>${esc(cfg.shooter)}</code> ${spin>0.01
    ?`at <b>${Math.round(spin*100)}%</b> of free speed → ${Math.round(Math.min(full.rpm,spin*full.free)).toLocaleString()} rpm → <b>${Shots.exitSpeed().toFixed(2)} m/s</b>`
    :"is stopped"+(Sim.phase==="running"?"":" — press START")}</div>`);
  const w=ShotUI.win, T=flywheelTicks();
  if(w&&full.v){
    const sp=v=>v/full.v*full.rpm/full.free;           // exit speed → share of free speed
    const band=(a,b)=>a===b?a:a+"–"+b;
    out.push(`<div>At ${cfg.hoodDeg}° this spot scores from <b>${w.lo.toFixed(2)} to ${w.hi.toFixed(2)} m/s</b>: <code>setVelocity(${band(Math.round(sp(w.lo)*T),Math.round(sp(w.hi)*T))})</code> or power ${band(sp(w.lo).toFixed(2),sp(w.hi).toFixed(2))}.</div>`);
  }else if(ShotUI.res&&paneVisible("shot")){
    out.push(`<div>No flywheel speed scores from here at ${cfg.hoodDeg}°${ShotUI.res.best?` — the best arc from this spot leaves at ${ShotUI.res.best.thetaDeg.toFixed(0)}°`:""}.</div>`);
  }
  if(ShotUI.res&&ShotUI.res.best){
    const d=wrap180(ShotUI.res.best.yawDeg-Shots.yawDeg(c));
    out.push(Math.abs(d)<1.5?`<div>Aimed at the up-CELL.</div>`:`<div>Aim: turn <b>${Math.abs(d).toFixed(0)}° ${d>0?"left":"right"}</b>.</div>`);
  }
  setHTML(el,out.join(""));
}
function renderHives(){
  const el=$("#hiveRows"); if(!el||!Field.ok) return;
  const rows=["red","blue"].map(al=>{
    const list=Field.cells[al], g=Field.grams(al);
    const n={pollen:0,nectar:0}; list.forEach(e=>n[e.kind]++);
    const what=list.length?[n.nectar?n.nectar+" NECTAR":"",n.pollen?n.pollen+" POLLEN":""].filter(Boolean).join(" + "):"empty";
    const side=Field.hive[al]<0?"audience side":"far side";
    return `<div class="hive-row"><div class="hive-top"><span class="al ${al}">${al.toUpperCase()}</span>
      <span class="what">up-CELL on the ${side} · ${what}</span>
      <button class="btn-sm" data-tip="${al}" title="Swing the ${al} HIVE over by hand">TIP</button></div>
      <div class="tipbar"><i style="width:${Math.min(100,g/TIP_GRAMS*100).toFixed(0)}%"></i></div>
      <div class="hive-sub"><span>${Math.round(g)} g of ~${TIP_GRAMS} g to TIP</span><span>${Field.tips[al]} TIP${Field.tips[al]===1?"":"s"} · ${Field.tips[al]*20} pts</span></div></div>`;
  }).join("");
  setHTML(el,rows);
}
function renderShotLog(){
  const el=$("#shotLog"); if(!el) return;
  const head=Shots.fired?`<div><span>this run</span>${Shots.fired} fired · ${Shots.scored} in</div>`:"";
  setHTML(el,head+Shots.log.map(l=>`<div><span>${l.t.toFixed(1)} s</span>${esc(l.text)}</div>`).join(""));
}
function renderShotSetup(){
  if(!$("#shotDev")) return;
  $$("#allySeg button").forEach(b=>b.classList.toggle("on",b.dataset.al===Shots.alliance));
  const cfg=Shots.cfg;
  const fire=$("#fireBtn");
  if(fire){ fire.disabled=!Field.ok||!cfg||!cfg.shooter;
    fire.title=cfg&&cfg.shooter?"Launch one ball with the robot as it is (F)":"This OpMode has no flywheel to fire"; }
  if(!cfg||!Field.ok){ renderShotVerdict(); return; }
  const devs=(CODE&&CODE.devices)||[];
  const opt=(list,sel,none)=>[`<option value="">${none}</option>`].concat(list.map(d=>
    `<option value="${esc(d.name)}"${d.name===sel?" selected":""}>${esc(d.name)}</option>`)).join("");
  setHTML($("#shotDev"),opt(devs.filter(d=>/DcMotor/i.test(d.type||"")),cfg.shooter,"— none —"));
  setHTML($("#shotFeed"),opt(devs.filter(d=>d.name!==cfg.shooter&&/Servo|DcMotor/i.test(d.type||"")),cfg.feeder,"— by hand (F) —"));
  $$("#ballSeg button").forEach(b=>b.classList.toggle("on",b.dataset.ball===cfg.ball));
  $$("#typeSeg button").forEach(b=>b.classList.toggle("on",b.dataset.type===cfg.type));
  $$("#mountSeg button").forEach(b=>b.classList.toggle("on",+b.dataset.mount===(cfg.mountDeg||0)));
  $$("#precSeg button").forEach(b=>b.classList.toggle("on",b.dataset.prec===(cfg.precision||"typical")));
  $("#hoodSlider").value=cfg.hoodDeg; $("#hoodVal").textContent=cfg.hoodDeg+"°";
  $("#h0Slider").value=cfg.h0In; $("#h0Val").textContent=cfg.h0In+" in";
  const motors=Field.data.motors.motors;
  setHTML($("#motorSel"),motors.map(m=>`<option value="${esc(m.id)}"${m.id===cfg.motorId?" selected":""}>${esc(m.label)}</option>`).join(""));
  const wheels=Field.data.shooter.wheels;
  setHTML($("#wheelSel"),wheels.map(w=>`<option value="${w.diameterMm}|${esc(w.id)}"${w.diameterMm===cfg.wheelMm&&(!cfg.wheelId||cfg.wheelId===w.id)?" selected":""}>${esc(w.label)}</option>`).join(""));
  if(document.activeElement!==$("#gearIn")) $("#gearIn").value=cfg.gear;
  renderShotVerdict(); renderShotLive(); renderHives(); renderShotLog();
}
function shotChanged(){ ShotUI.dirty=true; ShotUI.t=0; saveRig(); renderShotSetup(); }
/* Fire the robot's own shooter as it stands — no perfect test shots. */
function shotFire(){
  if(!Field.ok||!Shots.cfg) return;
  if(!Shots.cfg.shooter) Shots.note("This OpMode has no flywheel — load one that shoots, or pick its motor in the Shot tab.");
  else Shots.fire(Sim.chassis,"fired by hand",Sim.vel);
  renderShotLog();
}
function wireShotTab(){
  $("#fireBtn").addEventListener("click",shotFire);
  $("#fieldReset").addEventListener("click",()=>{ Field.reset(); Shots.reset(); ShotUI.dirty=true; ShotUI.t=0; renderShotSetup(); });
  $("#hiveRows").addEventListener("click",e=>{ const b=e.target.closest("[data-tip]"); if(!b) return; Field.tip(b.dataset.tip); ShotUI.dirty=true; ShotUI.t=0; renderHives(); });
  $("#arcToggle").addEventListener("change",e=>{ ShotUI.arc=e.target.checked; store.set("ftcbench.arc",e.target.checked?"1":"0"); ShotUI.arcKey=null; updateArc(); });
  $("#allySeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(b) setAlliance(b.dataset.al,true); });
  const seg=(id,apply)=>$(id).addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b||!Shots.cfg) return; apply(b); shotChanged(); });
  seg("#ballSeg",b=>Shots.cfg.ball=b.dataset.ball);
  seg("#typeSeg",b=>Shots.cfg.type=b.dataset.type);
  seg("#mountSeg",b=>Shots.cfg.mountDeg=+b.dataset.mount);
  seg("#precSeg",b=>Shots.cfg.precision=b.dataset.prec);
  $("#hoodSlider").addEventListener("input",e=>{ if(!Shots.cfg) return; Shots.cfg.hoodDeg=+e.target.value; $("#hoodVal").textContent=e.target.value+"°"; ShotUI.dirty=true; saveRig(); });
  $("#h0Slider").addEventListener("input",e=>{ if(!Shots.cfg) return; Shots.cfg.h0In=+e.target.value; $("#h0Val").textContent=e.target.value+" in"; ShotUI.dirty=true; saveRig(); });
  $("#motorSel").addEventListener("change",e=>{ if(!Shots.cfg) return; Shots.cfg.motorId=e.target.value; shotChanged(); });
  $("#wheelSel").addEventListener("change",e=>{ if(!Shots.cfg) return; const p=e.target.value.split("|"); Shots.cfg.wheelMm=+p[0]; Shots.cfg.wheelId=p[1]; shotChanged(); });
  $("#gearIn").addEventListener("change",e=>{ if(!Shots.cfg) return; const v=parseFloat(e.target.value); if(isFinite(v)&&v>0) Shots.cfg.gear=Math.max(0.25,Math.min(4,v)); shotChanged(); });
  $("#shotDev").addEventListener("change",e=>{ if(!Shots.cfg) return; Shots.cfg.shooter=e.target.value||null; Shots.cfg.motorId=nearestMotorId(Shots.deviceRpm()); shotChanged(); });
  $("#shotFeed").addEventListener("change",e=>{ if(!Shots.cfg) return; Shots.cfg.feeder=e.target.value||null; shotChanged(); });
  // the drawn parts: which way the CAD faces, and whether to draw a base and a shooter
  const robotSeg=(id,apply)=>$(id).addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    apply(b); refitRobot(); syncOptionControls(); saveRig(); ShotUI.dirty=true; });
  robotSeg("#frontSeg",b=>OPTS.front=b.dataset.front);
  robotSeg("#baseSeg",b=>OPTS.baseModel=b.dataset.mode);
  robotSeg("#shooterSeg",b=>OPTS.shooterModel=b.dataset.mode);
  robotSeg("#obstacleSeg",b=>OPTS.obstacles=b.dataset.obst==="walls"?"walls":"all");
}
/* The drive base, footprint and obstacles follow the drawn-parts settings
   without restarting the OpMode. */
function refitRobot(){
  if(!CAD) return;
  Sim.base=robotBase(CAD,Sim.drivetrain,OPTS.baseModel,OPTS.front);
  Sim.footprint=footprintOf(CAD,OPTS.front,Sim.base);
  Sim.obstacles=Field.ok&&OPTS.obstacles!=="walls"?Field.obstacles(Sim.footprint.h):[];
  if(Field.ok) Field.collide(Sim.chassis,Sim.footprint,Sim.obstacles);
  // the physics rig is built in the robot's own axes, so a new front (or a
  // drawn base) needs a new one — a stale rig kept the wheels placed for the
  // old front and the robot slid sideways when it turned
  if(Sim.code){
    Sim.rig=buildRig(CAD,Sim.drivetrain,Sim.base,Sim.dev,OPTS);
    Sim.dstate=Sim.rig?Dyn.reset(Sim.rig):null;
  }
  renderFrameNote(); Physics.sync(); Status.render(); SetupUI.render();
}

/* ============================================================
   ORCHESTRATION
   ============================================================ */
/* The arm-torque picture only when the OpMode drives a lift joint. */
function renderLegend3D(){ $("#pip").hidden=!liftState().aS; }
function analyzeAll(){
  if(!CODE||!CAD) return;
  FINDINGS=analyze(CODE,CAD,MAP,OPTS);
  renderFindings(); renderTables(); renderRig(); renderCoverage(); renderRobotCheck();
  Status.render(); MathTab.invalidate();
}
/* Rebuild the simulation after a rig or hardware change, keeping the Driver
   Station where it was — a running OpMode restarts, like re-deploying code. */
function reloadSim(){
  if(!CODE||!CAD) return;
  const phase=Sim.phase;
  Sim.load(CODE,CAD,MAP,withPose()); applyConfigOverrides();
  if(phase!=="stopped"){ Sim.init(); applyConfigOverrides(); resetMatch(); }
  if(phase==="running") Sim.start();
  buildGauges(); renderPad(); renderLegend3D(); updateDS();
}
function rebuild(){ analyzeAll(); reloadSim(); }
function syncOptionControls(){
  $$("#trustSeg button").forEach(b=>b.classList.toggle("on",b.dataset.trust===OPTS.trust));
  $("#trustNote").textContent=OPTS.trust==="code"
    ?"Servo and motor types come from your declarations and comments. The CAD is used for geometry only."
    :"Servo and motor types come from the part numbers in the STEP assembly.";
  const g=Math.round(OPTS.payloadKg*1000), d=Math.round(OPTS.duty*100), t=Math.round((View.turretScale||0.55)*100);
  $("#massSlider").value=g; $("#massVal").textContent=g+" g";
  $("#dutySlider").value=d; $("#dutyVal").textContent=d+" %";
  $("#turretSlider").value=t; $("#turretVal").textContent=t+" %";
  $$("#frontSeg button").forEach(b=>b.classList.toggle("on",b.dataset.front===OPTS.front));
  $$("#baseSeg button").forEach(b=>b.classList.toggle("on",b.dataset.mode===OPTS.baseModel));
  $$("#shooterSeg button").forEach(b=>b.classList.toggle("on",b.dataset.mode===OPTS.shooterModel));
  $$("#obstacleSeg button").forEach(b=>b.classList.toggle("on",b.dataset.obst===(OPTS.obstacles==="walls"?"walls":"all")));
}
function loadCAD(cad,label,cls){
  // one frame for everything (src/frame.js): the parser does this for STEP
  // files; the sample and older workspaces come through here
  canonicalizeCAD(cad,{up:OPTS.up, shift:OPTS.shift});
  EXACT={state:"none", msg:null};            // a STEP's exactGeometry() sets it loading right after
  CAD=cad;
  $("#cadStatus").textContent=label; $("#cadDrop").className="drop "+(cls||"ok");
  const parts=cad.solids&&cad.solids.length?cad.solids.length+" parts":(cad.points?cad.points.length.toLocaleString():"0")+" pts";
  $("#vpTitle").textContent=(cad.name||label)+" · "+parts+" · "+cad.mechs.length+" mechanism"+(cad.mechs.length===1?"":"s")+(Field.ok?" · BIOBUZZ field":"");
  const b=cad.bbox, mm=v=>(v*1000).toFixed(0);
  $("#vpDims").textContent=`${mm(b.max[0]-b.min[0])} × ${mm(b.max[1]-b.min[1])} × ${mm(b.max[2]-b.min[2])} mm`;
  // the front defaults to the way the wheels roll; a saved rig can still say otherwise
  RIG_DEVICES={}; HW_USER={}; Shots.cfg=null; OPTS.front=frontFromWheels(cad)||"+x"; OPTS.baseModel="auto"; OPTS.shooterModel="auto";
  SETUP.done={}; delete cad.driveSpec;
  const restored=loadSavedRig();
  View.hiddenParts=new Set();
  View.load(cad);
  if(CadView.on){ CadView.hid=null; CadView.select(null); CadView.fit(); CadView.renderTree(); }
  if(Sim.phase!=="running") placeAtStart();
  if(CODE){ mapDevices(); rebuild(); }
  if(restored) $("#cadStatus").textContent=label+" · rig restored";
  syncOptionControls();
  DRIVE_CACHE={key:null,val:null}; Physics.sync(); MathTab.invalidate();
  OnshapeHelp.chip();
}

/* ============================================================
   FILE INTAKE — click, drop on a target, or drop anywhere
   ============================================================ */
function readText(file,cb,err){
  const r=new FileReader();
  r.onerror=()=>err&&err("couldn't read "+file.name);
  r.onload=()=>cb(r.result);
  r.readAsText(file);
}
let LAST_STEP=null;                 // the dropped file's text, for the Up override and the exact geometry
function takeCAD(file){
  $("#cadStatus").textContent="reading "+file.name+" …"; $("#cadDrop").className="drop";
  readText(file,text=>{ LAST_STEP={name:file.name, text}; parseAndLoad(); },m=>{ $("#cadStatus").textContent=m; });
}
/* The whole robot from Onshape (src/onshapecad.js): parts, colours, mass and
   the mates as joints, no STEP and nothing to answer. */
function loadOnshapeRobot(p,reparse){
  let cad;
  const from=p.from==="urdf"?"URDF":"Onshape";
  try{ cad=cadFromOnshape(p,{up:OPTS.up, shift:OPTS.shift}); }
  catch(e){ onshapeNote("Your robot came from "+from+", but it couldn't be built: "+esc(e.message)+(p.from==="urdf"?".":". Try the bookmark again; if it keeps failing, export a STEP and drop it."),"bad");
    if(p.from!=="urdf") OnshapeHelp.fail("Your robot arrived but couldn't be built: "+e.message+". Click the bookmark again; if it keeps failing, export a STEP from Onshape and use Open a file.");
    return false; }
  if(p.from==="urdf"){ cad.source="urdf"; if(p.notes&&p.notes.length) cad.onshape.why=p.notes.concat(cad.onshape.why||[]); }
  LAST_STEP={name:p.name, text:"", onshape:p, label:p.name+" · from "+from};
  // a new robot drops the last one's joints; the same one re-read (a new up, a new centre) keeps them
  if(!reparse||JOINTS.step!==p.name){ JOINTS.spec=JOINTS.report=JOINTS.devices=null; JOINTS.name=JOINTS.step=null; }
  MATES.asm=p.asm; MATES.features=p.features; MATES.name=p.name; MATES.url=p.url||null; MATES.fromLink=true; MATES.report=cad.onshape.report;
  SetupUI.beforeParse&&SetupUI.beforeParse(p.name);
  loadCAD(cad, p.name+" · from "+from+" · "+cad.solids.length+" parts · "+cad.mechs.filter(m=>m.fromMate).length+" joints", "ok");
  recomputeChain(cad.mechs);
  if(JOINTS.spec) applyJoints();
  const rep=cad.onshape.report, n=cad.mechs.filter(m=>m.fromMate).length;
  $("#mateStatus").textContent=p.name+" · whole robot from "+from+" · "+n+" joint"+(n===1?"":"s"); $("#mateDrop").className="drop ok";
  $("#mateNote").innerHTML=(cad.onshape.why||[]).map(w=>"<li>"+esc(w)+"</li>").join("");
  const pill=$("#matePill"); if(pill){ pill.textContent=n+" joint"+(n===1?"":"s"); pill.className="pill ok"; }
  if(p.from!=="urdf") OnshapeHelp.done(p.name, cad.solids.length, cad.mechs.filter(m=>m.fromMate).length, cad.onshape&&cad.onshape.kg);
  onshapeNote("<b>"+esc(p.name)+"</b> loaded "+(p.from==="urdf"?"from its URDF":"straight from Onshape")+": "+cad.solids.length+" parts with their colours"+
    (cad.onshape.kg?", "+cad.onshape.kg.toFixed(1)+" kg from your materials":"")+", and "+n+" joint"+(n===1?"":"s")+" from your "+(p.from==="urdf"?"joints":"mates")+". Load your code and press INIT.","ok");
  renderFrameNote&&renderFrameNote();
  Status.render&&Status.render();
  void rep;
  return true;
}
/* ============================================================
   ONSHAPE, STEP BY STEP: the pop-up that sets up the "Send to SimBench"
   bookmark and gets the robot, and the same pop-up showing progress when
   the bookmark sends one (waitForOnshape).
   ============================================================ */
const OnshapeHelp={
  mode:null,
  init(){
    const ov=$("#osOverlay"); if(!ov) return;
    const mac=/Mac|iPhone|iPad/i.test((navigator.userAgentData&&navigator.userAgentData.platform)||navigator.platform||navigator.userAgent);
    for(const id of ["osKey1","osKey2"]){ const k=$("#"+id); if(k) k.textContent=mac?"⌘ Cmd":"Ctrl"; }
    const phone=matchMedia("(pointer:coarse)").matches&&!matchMedia("(any-pointer:fine)").matches;
    $("#osPhone").hidden=!phone;
    const href=onshapeBookmarklet(location.origin+location.pathname);
    for(const a of $$(".bm-link")){
      a.href=href;
      // clicking it here does nothing useful: say so, right where they clicked
      a.addEventListener("click",e=>{ e.preventDefault(); this.tip("Drag it, don't click it here: press and hold the yellow button, move it up onto your bookmarks bar and let go. It only works when you click it on your Onshape tab."); });
      a.addEventListener("dragend",e=>{ const ok=e.dataTransfer&&e.dataTransfer.dropEffect!=="none";
        if(ok){ store.set("ftcbench.bookmark","1"); this.tip("✓ If you see Send to SimBench on your bookmarks bar, you're set. Now steps 3 and 4."); } });
    }
    $("#osCopy").addEventListener("click",async()=>{
      let ok=false;
      try{ await navigator.clipboard.writeText(href); ok=true; }catch(e){
        const t=document.createElement("textarea"); t.value=href; document.body.appendChild(t); t.select();
        try{ ok=document.execCommand("copy"); }catch(x){} t.remove(); }
      $("#osCopied").textContent=ok?"Copied. Now paste it as the bookmark's URL.":"Your browser blocked copying; drag the button instead.";
    });
    for(const b of $$("[data-os-open]")) b.addEventListener("click",()=>this.open());
    $("#cadPick").addEventListener("click",()=>$("#cadFile").click());
    $("#osClose").addEventListener("click",()=>this.close());
    $("#osDone").addEventListener("click",()=>this.close());
    $("#osShowSteps").addEventListener("click",()=>this.open());
    $("#osSeeRobot").addEventListener("click",()=>{ this.close(); const nav=$('.tabs[data-tabs="left"]'); if(nav) selectTab(nav,"robot"); });
    ov.addEventListener("click",e=>{ if(e.target===ov&&this.mode!=="busy") this.close(); });
    addEventListener("keydown",e=>{ if(e.key==="Escape"&&!ov.hidden&&this.mode!=="busy") this.close(); });
    this.chip();
  },
  view(guide){ $("#osGuide").hidden=!guide; $("#osProgress").hidden=guide; $("#osOverlay").hidden=false; },
  open(){ this.mode="guide"; $("#osBmTip").hidden=true; this.view(true); const s=$(".os-sheet"); if(s) s.scrollTop=0; },
  close(){ $("#osOverlay").hidden=true; this.mode=null; },
  tip(t){ const p=$("#osBmTip"); if(!p) return; p.textContent=t; p.hidden=false; if($("#osOverlay").hidden) this.open(); },
  meter(cls,frac){ const m=$("#osMeter"), f=$("#osMeterFill"); m.className="os-meter"+(cls?" "+cls:""); f.style.width=frac==null?"":Math.round(Math.max(.06,Math.min(1,frac))*100)+"%"; },
  progress(text,done,total){
    this.mode="busy"; this.view(false);
    $("#osProgTitle").textContent="Getting your robot from Onshape";
    $("#osProgText").textContent=text;
    $("#osProgHint").textContent="Keep your Onshape tab open until your robot appears.";
    $("#osSeeRobot").hidden=true; $("#osShowSteps").hidden=true;
    const known=Number.isFinite(done)&&Number.isFinite(total)&&total>0;
    this.meter(known?"":"busy",known?done/total:null);
    clearTimeout(this.timer);
    // the bookmark always answers (the robot, or an alert on the Onshape tab): if it goes quiet, say what to check
    this.timer=setTimeout(()=>{ if(this.mode==="busy") this.fail("Nothing has come from Onshape for 3 minutes. Check your Onshape tab for a message, then click the bookmark again."); },180000);
  },
  done(name,parts,joints,kg){
    clearTimeout(this.timer); this.mode="done"; this.view(false);
    $("#osProgTitle").textContent="✓ "+name+" is here";
    $("#osProgText").textContent=parts+" parts with their colours, "+joints+" joint"+(joints===1?"":"s")+" from your mates"+(kg?", "+kg.toFixed(1)+" kg":"")+".";
    $("#osProgHint").textContent="You can close the Onshape tab. Next time, just click the bookmark again on your assembly.";
    this.meter("ok",1); $("#osSeeRobot").hidden=false; $("#osShowSteps").hidden=true;
  },
  fail(msg){
    clearTimeout(this.timer); this.mode="fail"; this.view(false);
    $("#osProgTitle").textContent="Your robot didn't come through";
    $("#osProgText").textContent=msg;
    $("#osProgHint").textContent="The steps have a list of fixes under \u201cIt didn't work?\u201d.";
    this.meter("bad",1); $("#osSeeRobot").hidden=true; $("#osShowSteps").hidden=false;
  },
  // the field's chip: while the sample robot is on the field, offer the team's own
  chip(){ const c=$("#vpOnshape"); if(!c) return; let own=true; try{ own=ownRobot()||!!(CAD&&CAD.source==="onshape"); }catch(e){} c.hidden=own; },
};
/* This tab was opened by the bookmark: say we're ready, then take the robot.
   A second click reuses this tab and only changes its #hash: wait again then. */
let ONSHAPE_WAIT=null;
addEventListener("hashchange",()=>{ if(/^#onshape-wait/.test(location.hash)) waitForOnshape(); });
function waitForOnshape(){
  try{ history.replaceState(null,"",location.pathname+location.search); }catch(e){}
  onshapeNote("Reading your robot from Onshape … keep the Onshape tab open.");
  OnshapeHelp.progress("Waiting for your Onshape tab …",null,null);
  if(ONSHAPE_WAIT) removeEventListener("message",ONSHAPE_WAIT);
  let got=false;
  const okOrigin=o=>/^https:\/\/([a-z0-9-]+\.)*onshape\.com$/i.test(o);
  addEventListener("message",ONSHAPE_WAIT=e=>{
    if(!okOrigin(e.origin)||!e.data) return;
    const d=e.data;
    if(d.type==="simbench-progress"){ if(!got){ const t=String(d.text||"").slice(0,160); onshapeNote(esc(t)); OnshapeHelp.progress(t,+d.done,+d.total); } return; }
    if(d.format!==ONSHAPE_FORMAT||got) return;
    got=true;
    let p; try{ p=checkOnshapePayload(d); }catch(x){ onshapeNote("What came from Onshape couldn't be read: "+esc(x.message),"bad"); OnshapeHelp.fail("What came from Onshape couldn't be read: "+x.message); return; }
    removeEventListener("message",ONSHAPE_WAIT); ONSHAPE_WAIT=null;
    OnshapeHelp.progress("Building your robot …",1,1);
    // let the pop-up draw before the build takes the main thread
    setTimeout(()=>{ if(p.geom) loadOnshapeRobot(p); else { holdOnshape(p); OnshapeHelp.close(); } },30);
  });
  const ping=()=>{ if(got) return; try{ if(window.opener) window.opener.postMessage({type:"simbench-ready"},"*"); }catch(e){} setTimeout(ping,600); };
  ping();
}
function parseAndLoad(done){
  if(!LAST_STEP) return;
  if(LAST_STEP.onshape){ loadOnshapeRobot(LAST_STEP.onshape,true); if(done&&CAD) done(CAD); return; }
  const {name,text}=LAST_STEP, mb=(text.length/1048576).toFixed(1);
  SetupUI.beforeParse(name);
  $("#cadStatus").textContent="parsing "+mb+" MB …";
  setTimeout(()=>{
    try{
      const cad=parseSTEP(text,msg=>{ $("#cadStatus").textContent=msg; },{up:OPTS.up, shift:OPTS.shift});
      cad.name=name;
      // a joint spec belongs to the file it was written for; another robot drops it
      if(JOINTS.spec&&JOINTS.step!==name){ JOINTS.spec=JOINTS.report=JOINTS.devices=null; JOINTS.name=JOINTS.step=null; }
      // joints fixed by hand for this file before, in this browser
      const mine=savedJoints(name);
      if(mine&&(!JOINTS.spec||!JOINTS.spec.edited)){ JOINTS.spec=mine; JOINTS.step=name; JOINTS.name="your joints"; }
      loadCAD(cad, (LAST_STEP.label||name+" · "+mb+" MB")+" · "+cad.mechs.length+" mechanism"+(cad.mechs.length===1?"":"s"), cad.mechs.length?"ok":"bad");
      if(MATES.asm) applyMates();
      else if(JOINTS.spec) applyJoints();
      else findJoints(cad,true);                  // no mates, no spec: find them from the geometry
      exactGeometry(cad,text);
      if(done) done(cad);
    }catch(e){ $("#cadStatus").textContent="couldn't parse this STEP file — "+e.message; $("#cadDrop").className="drop bad"; }
    renderFrameNote();
  },30);
}

/* ============================================================
   THE DEFAULT ROBOT
   GearGurus 7832's Into The Deep robot (2024-25): their Onshape STEP,
   their joint spec, and their OpModes, served beside the app from
   robots/ (tools/build.mjs copies assets/robots there). The STEP is
   gzipped (52 MB -> 8 MB) and inflated here. Until it lands, and if it
   can't, the built-in sample robot stands in. ?robot=sample skips it.
   ============================================================ */
const DEFAULT_ROBOT={dir:"robots/into-the-deep/", step:"Into The Deep.step", file:"robot.step.gz", joints:"joints.json",
  team:"7832", label:"GearGurus 7832 · Into The Deep",
  opmodes:[{id:"itd-sample-tele", file:"sample_teleop.java"}, {id:"itd-bal", file:"BAL.java"}, {id:"itd-holy-grail", file:"TheHolyGrail.java", field:"other"}],
  helpers:["MecanumDrive.java", "Arm.java", "Arm_PID_Class.java", "Slides_PID_Class.java"]};
async function fetchStepText(url){
  const r=await fetch(url); if(!r.ok) throw new Error(r.status+" for "+url);
  const buf=new Uint8Array(await r.arrayBuffer());
  // a host may have unzipped it on the way already (Content-Encoding): only inflate real gzip
  if(buf[0]===0x1f&&buf[1]===0x8b){
    if(typeof DecompressionStream==="undefined") throw new Error("this browser can't unzip the robot");
    return await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  }
  return new TextDecoder().decode(buf);
}
async function loadDefaultRobot(){
  const R=DEFAULT_ROBOT, st=$("#cadStatus");
  st.textContent="loading "+R.label+" …";
  try{
    const get=f=>fetch(R.dir+f).then(r=>r.ok?r.text():null).catch(()=>null);
    const [text,spec,...srcs]=await Promise.all([fetchStepText(R.dir+R.file),
      fetch(R.dir+R.joints).then(r=>{ if(!r.ok) throw new Error(r.status+" for "+R.joints); return r.json(); }),
      ...R.opmodes.map(o=>get(o.file)), ...R.helpers.map(get)]);
    if(LAST_STEP) return;                       // a robot was dropped in meanwhile: that one wins
    // the team's helper classes first: their Road Runner auto needs them
    BUILTIN_HELPERS=R.helpers.map((f,i)=>({file:f, src:srcs[R.opmodes.length+i], team:R.team})).filter(h=>h.src);
    R.opmodes.forEach((o,i)=>{ if(srcs[i]&&!entry(o.id)){ const e={id:o.id, file:o.file, source:srcs[i], builtin:true, team:R.team, field:o.field||null}; parseEntry(e); LIBRARY.push(e); } });
    renderOpList();
    R.spec=spec; JOINTS.spec=spec; JOINTS.name=R.joints; JOINTS.step=R.step;
    LAST_STEP={name:R.step, text, label:R.label};
    parseAndLoad(()=>{
      // the team's own TeleOp, unless one of the user's OpModes was open
      const saved=store.get("ftcbench.current",null), mine=entry(saved);
      selectOpMode(mine&&(!mine.builtin||mine.team)?saved:R.opmodes[0].id);
    });
  }catch(e){
    if(!LAST_STEP) st.textContent="couldn't load the default robot ("+e.message+") — this is the built-in sample";
  }
}
/* The real surfaces, the way Onshape draws them. OpenCascade loads from the
   CDN the first time and runs off the main thread; until it answers — or if
   it can't (offline, blocked) — the robot stays drawn as simplified shapes,
   never blank. */
let EXACT={state:"none", msg:null};        // the exact surfaces for the CAD panel: none (sample), loading, ok, failed
function exactGeometry(cad,text){
  const note=$("#exactNote"); if(note){ note.textContent="loading exact geometry (OpenCascade) …"; note.className="hint"; }
  EXACT={state:"loading", msg:null}; if(CadView.on) CadView.renderTree();
  const t0=performance.now();
  // one shape at a time across a few workers (src/tessellate.js Tess.exact)
  const progress=(done,total)=>{ if(CAD===cad&&note) note.textContent="exact geometry: "+done+" of "+total+" part shapes meshed …"; };
  Tess.exact(cad,text,progress).then(res=>{
    if(CAD!==cad) return;                     // another file was dropped meanwhile
    EXACT={state:res&&res.meshes&&res.meshes.length?"ok":"failed", msg:"the file has no solid surfaces to mesh"};
    const n=View.setExact(cad,res);
    if(CadView.on) CadView.renderTree();
    const secs=((performance.now()-t0)/1000).toFixed(0);
    if(note) note.textContent=!n?"This STEP file has no solid surfaces to mesh, so the parts are drawn as simplified shapes."
      :res.perShape?"Exact geometry: "+n+" parts from "+res.shapes+" shapes, each in its own colour ("+secs+" s)"+
        (res.failedShapes?"; "+res.failedShapes+" shape"+(res.failedShapes===1?"":"s")+" wouldn't mesh and "+(res.failedShapes===1?"is":"are")+" drawn simplified.":".")
      :"Exact geometry: "+n+" surface meshes straight from the STEP file, in its own colours.";
  }).catch(e=>{
    if(CAD!==cad) return;
    EXACT={state:"failed", msg:e.message}; if(CadView.on) CadView.renderTree();
    if(note){ note.textContent="Exact geometry unavailable ("+e.message+") — showing simplified shapes. Everything else works the same."; note.className="hint warn"; }
  });
}
/* What the frame decided, in words: which way is up and where the centre is. */
function renderFrameNote(){
  const el=$("#frameNote"); if(!el||!CAD||!CAD.frame) return;
  const f=CAD.frame;
  const auto=frontFromWheels(CAD);
  el.textContent="Up is "+f.up+" — "+f.upWhy+". The robot turns about "+
    (f.originWhy==="wheels"?"the centre of its drive wheels.":"the middle of the CAD, since no drive wheels were found.")+
    (auto?(frontAcrossWheels(CAD,OPTS.front)?" CAD front is set ACROSS the wheels — they roll along "+auto.slice(1)+", so this robot will slide sideways when it turns. Pick "+auto+" or its opposite."
         :" Front "+OPTS.front+" runs the way the wheels roll."):"");
}
function takeCode(file){ readText(file,text=>addOpModeFromText(file.name,text)); }
function setRobotConfig(text,name){
  try{
    const cfg=parseRobotConfig(text);
    OPTS.robotConfig=cfg; ROBOT_CFG_NAME=name;
    store.set("ftcbench.robotconfig",JSON.stringify({name,text}));
    $("#cfgStatus").textContent=name+" · "+cfg.devices.length+" devices on "+cfg.modules.length+" hub"+(cfg.modules.length===1?"":"s");
    $("#cfgDrop").className="drop ok"; $("#cfgClear").hidden=false;
  }catch(e){
    $("#cfgStatus").textContent="couldn't read "+name+" — "+e.message; $("#cfgDrop").className="drop bad";
  }
  analyzeAll();
}
function takeRobotConfig(file){ readText(file,text=>setRobotConfig(text,file.name)); }
/* ============================================================
   ONSHAPE MATES — src/mates.js does the work; this is the panel.
   The two JSON files come from Onshape's own API, opened in a tab that's
   signed in to Onshape: no keys, nothing sent anywhere but Onshape.
   ============================================================ */
const MATES={asm:null, features:null, name:null, report:null, url:null};
/* ---- mates from the "Send to SimBench" bookmark (src/onshapelink.js) ----
   They arrive in this page's #onshape= fragment. If the team already has
   their own robot open in another SimBench tab, that tab is offered them
   and this one steps aside; otherwise they wait here for the STEP. */
const SB_CHANNEL=(()=>{ try{ return typeof BroadcastChannel==="function"?new BroadcastChannel("ftc-simbench"):null; }catch(e){ return null; } })();
let ONSHAPE_OFFER=null;
const ownRobot=()=>!!(LAST_STEP&&CAD&&LAST_STEP.name!==DEFAULT_ROBOT.step);
function onshapeNote(html,kind){
  const n=$("#onshapeNote"); if(!n) return;
  n.hidden=!html; n.className="onshape-note"+(kind?" "+kind:""); n.innerHTML=html||"";
  const nav=$('.tabs[data-tabs="left"]'); if(html&&nav) selectTab(nav,"robot");
}
async function takeOnshapeHash(){
  const h=location.hash.slice("#onshape=".length);
  try{ history.replaceState(null,"",location.pathname+location.search); }catch(e){}
  onshapeNote("Unpacking the mates from Onshape …");
  let p;
  try{ p=await readOnshapeHash(h); }
  catch(e){ onshapeNote("The link from Onshape couldn't be read: "+esc(e.message)+". Click the bookmark again, or use the steps under <b>Or by hand</b>.","bad"); return; }
  // their robot is already open in another tab: that one takes the mates
  if(SB_CHANNEL){
    const id=Math.random().toString(36).slice(2);
    const taken=await new Promise(res=>{
      const on=e=>{ const d=e.data; if(d&&d.type==="onshape-taken"&&d.id===id){ clearTimeout(t); SB_CHANNEL.removeEventListener("message",on); res(d); } };
      const t=setTimeout(()=>{ SB_CHANNEL.removeEventListener("message",on); res(null); },900);
      SB_CHANNEL.addEventListener("message",on);
      SB_CHANNEL.postMessage({type:"onshape", id, p:Object.assign({format:ONSHAPE_FORMAT},p)});
    });
    if(taken){
      onshapeNote("Sent the mates of <b>"+esc(p.name)+"</b> to your open SimBench tab with <b>"+esc(taken.robot)+"</b>. Switch to it and click <b>Apply</b>. You can close this tab.","ok");
      setTimeout(()=>{ try{ window.close(); }catch(e){} },2500);
      return;
    }
  }
  holdOnshape(p);
}
/* Use them: on the team's robot straight away, or when its STEP is dropped
   (parseAndLoad applies MATES by itself), never on the default robot. */
function holdOnshape(p){
  if(p.geom&&loadOnshapeRobot(p)) return;
  MATES.asm=p.asm; MATES.features=p.features; MATES.name=p.name; MATES.url=p.url||null; MATES.report=null; MATES.fromLink=true;
  JOINTS.spec=null; JOINTS.report=null; ONSHAPE_OFFER=null;
  if(ownRobot()) applyMates();
  else{
    $("#mateStatus").textContent="Got the mates of "+p.name+". Drop the STEP of the same assembly and they apply to it.";
    onshapeNote("Got the mates of <b>"+esc(p.name)+"</b> from Onshape. Now drop the STEP you exported from that assembly "+
      "(Onshape: right-click the assembly tab, <b>Export</b>, STEP) into <b>Robot CAD</b> below, and every joint is exact.","ask");
  }
}
if(SB_CHANNEL) SB_CHANNEL.addEventListener("message",e=>{
  const d=e.data; if(!d||d.type!=="onshape"||!ownRobot()) return;
  let p; try{ p=checkOnshapePayload(d.p); }catch(x){ return; }
  ONSHAPE_OFFER=p;
  SB_CHANNEL.postMessage({type:"onshape-taken", id:d.id, robot:LAST_STEP.name});
  onshapeNote("Mates from Onshape (<b>"+esc(p.name)+"</b>) arrived. <button class='btn-sm primary' id='onshapeApply'>Apply to "+esc(LAST_STEP.name)+"</button> <button class='btn-sm' id='onshapeLater'>Not now</button>","ask");
  $("#onshapeApply").addEventListener("click",()=>{ if(ONSHAPE_OFFER) holdOnshape(ONSHAPE_OFFER); });
  $("#onshapeLater").addEventListener("click",()=>{ ONSHAPE_OFFER=null; onshapeNote(""); });
});
/* A joint spec (src/jointspec.js): the joints written down by hand. It
   belongs to one STEP file and comes back each time that file is parsed. */
const JOINTS={spec:null, name:null, step:null, report:null, devices:null};
function takeMates(file){
  readText(file,text=>{
    let j; try{ j=JSON.parse(text); }catch(e){ $("#mateStatus").textContent=file.name+" isn't JSON — save the page Onshape shows as a .json file."; $("#mateDrop").className="drop bad"; return; }
    if(j&&j.format===ONSHAPE_FORMAT){
      let p; try{ p=checkOnshapePayload(j); }catch(e){ $("#mateStatus").textContent=file.name+": "+e.message; $("#mateDrop").className="drop bad"; return; }
      holdOnshape(p); return;
    }
    if(j&&j.format===SETUP_FORMAT){ SetupUI.take(j,file.name); return; }
    if(j&&j.format===JOINT_SPEC_FORMAT){
      MATES.asm=MATES.features=MATES.name=MATES.report=null;
      JOINTS.spec=j; JOINTS.name=file.name; JOINTS.step=LAST_STEP?LAST_STEP.name:null;
      applyJoints(); return;
    }
    if(j&&j.rootAssembly){ MATES.asm=j; MATES.name=file.name; MATES.fromLink=false; JOINTS.spec=null; JOINTS.report=null; }
    else if(j&&(Array.isArray(j.features)||Array.isArray(j))) MATES.features=j;
    else { $("#mateStatus").textContent=file.name+" isn't an Onshape assembly definition or features list."; $("#mateDrop").className="drop bad"; return; }
    applyMates();
  });
}
function applyMates(){
  const st=$("#mateStatus"), drop=$("#mateDrop"), note=$("#mateNote"), pill=$("#matePill");
  if(!MATES.asm){ st.textContent=MATES.features?"Got the mate limits. Now drop the assembly definition.":"Drop the assembly definition, and the features file too if you want limits."; return; }
  if(!CAD||!(CAD.solids||[]).some(s=>s.occT)){
    st.textContent="Got "+MATES.name+". Load the STEP of the same assembly and the mates apply to it."; drop.className="drop"; return;
  }
  try{
    const rep=applyOnshapeMates(CAD,MATES.asm,{features:MATES.features});
    MATES.report=rep;
    recomputeChain(CAD.mechs);
    View.hiddenParts=View.hiddenParts||new Set();
    View.load(CAD); if(View.exact) View.applyExact();
    if(CadView.on) CadView.renderTree();
    if(CODE){ mapDevices(); rebuild(); }
    pill.textContent=rep.joints+" joint"+(rep.joints===1?"":"s"); pill.className="pill ok";
    st.textContent=MATES.name+" · "+rep.matched+" of "+rep.parts+" parts matched"+(MATES.features?" · limits":"");
    drop.className="drop ok"; $("#mateClear").hidden=false;
    note.innerHTML=rep.why.map(w=>"<li>"+esc(w)+"</li>").join("");
    if(MATES.fromLink) onshapeNote("Joints from your Onshape mates (<b>"+esc(MATES.name)+"</b>) are on <b>"+esc(LAST_STEP?LAST_STEP.name:"this robot")+"</b>: "+
      rep.joints+" joint"+(rep.joints===1?"":"s")+", "+rep.matched+" of "+rep.parts+" parts matched. The Robot check below says if anything still needs you.",rep.matched<rep.parts*0.5?"bad":"ok");
  }catch(e){
    st.textContent="Couldn't apply the mates — "+e.message; drop.className="drop bad"; pill.textContent="error"; pill.className="pill bad";
  }
  Status.render&&Status.render();
}
/* The joint spec onto the loaded CAD: the same panel, the same rebuild as mates. */
function applyJoints(){
  const st=$("#mateStatus"), drop=$("#mateDrop"), note=$("#mateNote"), pill=$("#matePill");
  if(!JOINTS.spec||!CAD) return;
  try{
    const R=applyJointSpec(CAD,JOINTS.spec);
    JOINTS.report=R.report; JOINTS.devices=R.devices;
    if(R.front&&FRONTS[R.front]!==undefined) OPTS.front=R.front;
    recomputeChain(CAD.mechs);
    View.hiddenParts=View.hiddenParts||new Set();
    View.load(CAD); if(View.exact) View.applyExact();
    if(CadView.on) CadView.renderTree();
    if(Sim.phase!=="running") placeAtStart();
    if(CODE){ mapDevices(); rebuild(); }
    syncOptionControls();
    pill.textContent=R.report.joints+" joint"+(R.report.joints===1?"":"s"); pill.className="pill ok";
    st.textContent=(JOINTS.spec.robot||JOINTS.name)+" · "+R.report.matched+" of "+R.report.parts+" parts on joints"+(JOINTS.spec.edited?" · edited by you":"");
    $("#jointsReset").hidden=!(JOINTS.spec.edited||JOINTS.spec.auto&&JOINTS.step===DEFAULT_ROBOT.step);
    // the headline counted the joints the parser guessed; these replace them
    const J=R.report.joints+" joint"+(R.report.joints===1?"":"s");
    for(const el of [$("#vpTitle"),$("#cadStatus")]) el.textContent=el.textContent.replace(/\d+ mechanisms?/,J);
    drop.className="drop ok"; $("#mateClear").hidden=false;
    note.innerHTML=(JOINTS.spec.review||[]).map(w=>"<li><b>Check:</b> "+esc(w)+"</li>").join("")+
      R.report.why.map(w=>"<li>"+esc(w)+"</li>").join("")+
      JOINTS.spec.joints.filter(j=>j.note).map(j=>"<li><b>"+esc(j.label||j.id)+"</b>: "+esc(j.note)+"</li>").join("");
  }catch(e){
    JOINTS.report=null;
    st.textContent="Couldn't apply the joint spec — "+e.message; drop.className="drop bad"; pill.textContent="error"; pill.className="pill bad";
  }
  Status.render&&Status.render();
}
/* ============================================================
   THE JOINT EDITOR — the CAD view's click-to-fix (src/cadview.js)
   Every change lands in the robot's joint spec: a spec the robot came
   with, or one written from the joints it has now the first time anything
   is changed. It's kept per STEP file name in this browser, and it can be
   downloaded to share; dropping it back in applies it again.
   ============================================================ */
const jointsKey=name=>"ftcbench.joints."+(name||"");
function savedJoints(name){ try{ const j=JSON.parse(store.get(jointsKey(name),"null")); return j&&j.format===JOINT_SPEC_FORMAT?j:null; }catch(e){ return null; } }
function editableSpec(){
  if(!CAD) return null;
  if(!JOINTS.spec){
    // the joints as they are: guessed, or from mates, each with its exact parts
    const groups=typeof solidGroups==="function"?solidGroups(CAD,View.turretScale):[];
    JOINTS.spec=specFromCad(CAD,groups,MAP); JOINTS.name="your joints"; JOINTS.step=LAST_STEP?LAST_STEP.name:(CAD.name||null);
    MATES.asm=MATES.features=MATES.name=MATES.report=null;
  }
  return JOINTS.spec;
}
function editJoints(change){
  const spec=editableSpec(); if(!spec) return false;
  change(spec);
  spec.solids=(CAD.solids||[]).length; spec.edited=true;
  store.set(jointsKey(JOINTS.step||CAD.name),JSON.stringify(spec));
  applyJoints();
  return true;
}
/* ============================================================
   ROBOT SETUP — once per robot
   The bench finds a robot's floor, front, drive base and joints by itself,
   and gets most robots right. For the rest, a team checks four things once,
   fixes what's wrong by clicking (or, for the drive base, by typing the
   numbers off their chassis), and that's saved: in this browser for the
   STEP's file name (re-exports keep the name), and as one setup file to
   share. Nothing here needs the bench to be changed for a robot.
   ============================================================ */
const SETUP={done:{}};
const SETUP_FORMAT="ftc-simbench.robot";
const SETUP_STEPS=["up","front","drive","joints"];
/* A drive base set by hand, checked: only known kinds, numbers in metres and in range. */
function cleanDriveSpec(d){
  const num=(v,lo,hi,def)=>{ v=+v; return isFinite(v)?Math.max(lo,Math.min(hi,v)):def; };
  return {kind:["mecanum","tank","x"].includes(d.kind)?d.kind:"mecanum", n:[2,4,6].includes(+d.n)?+d.n:4,
    d:num(d.d,0.04,0.2,0.096), track:num(d.track,0.1,0.6,0.36), base:num(d.base,0,0.6,0.3), pattern:d.pattern==="O"?"O":"X"};
}
const SetupUI={
  formOpen:false, pending:null,
  /* the saved setup for a STEP about to be read: up and the drive base's centre decide its frame */
  beforeParse(name){
    if(this.pending&&(!this.pending.cad||this.pending.cad===name)){
      const P=this.pending; this.pending=null;
      if(P.rig) store.set("ftcbench.rig."+name,JSON.stringify(P.rig));
      if(P.joints) store.set(jointsKey(name),JSON.stringify(P.joints));
    }
    let r=null; try{ r=JSON.parse(store.get("ftcbench.rig."+name,"null")); }catch(e){ r=null; }
    OPTS.up=r&&FRAME_UP_ROWS[r.up]?r.up:undefined;
    OPTS.shift=r&&Array.isArray(r.shift)?r.shift.map(v=>Math.max(-0.4,Math.min(0.4,+v||0))):null;
    $$("#upSeg button").forEach(b=>b.classList.toggle("on",(b.dataset.up||undefined)===OPTS.up));
  },
  /* a setup file: this robot's (or the next one dropped with it) */
  take(j,file){
    const rig=j.rig&&typeof j.rig==="object"?j.rig:null, joints=j.joints&&j.joints.format===JOINT_SPEC_FORMAT?j.joints:null;
    const cad=typeof j.cad==="string"?j.cad:null;
    if(CAD&&LAST_STEP&&(!cad||cad===LAST_STEP.name)){
      if(rig) store.set("ftcbench.rig."+LAST_STEP.name,JSON.stringify(rig));
      if(joints){ store.set(jointsKey(LAST_STEP.name),JSON.stringify(joints)); JOINTS.spec=joints; JOINTS.step=LAST_STEP.name; JOINTS.name=file; }
      parseAndLoad();
      $("#cadStatus").textContent="setup applied from "+file;
    }else{
      // the STEP isn't here yet (dropped together, it's read after): it gets this when it is
      this.pending={cad, rig, joints};
      $("#cadStatus").textContent="setup "+file+" is waiting for its robot"+(cad?" ("+cad+")":"");
    }
  },
  download(){
    if(!CAD) return;
    const name=(CAD.name||"robot").replace(/\.(step|stp)$/i,"");
    const out={format:SETUP_FORMAT, version:1, cad:LAST_STEP?LAST_STEP.name:CAD.name, saved:new Date().toISOString(),
      rig:exportRig(), joints:JOINTS.spec&&JOINTS.spec.format===JOINT_SPEC_FORMAT?JOINTS.spec:(savedJoints(CAD.name)||null)};
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,1)],{type:"application/json"}));
    a.download=name+".simbench.json"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  },
  isDefault(){ return typeof DEFAULT_ROBOT!=="undefined"&&CAD&&CAD.name===DEFAULT_ROBOT.step; },
  /* a step is done when someone checked it, or the robot itself answers it (src/robotcheck.js setupAuto) */
  auto(){ try{ return CAD?setupAuto(CAD,CODE,MAP):{}; }catch(e){ return {}; } },
  isDone(k,A){ return !!(SETUP.done[k]||(A||this.auto())[k]); },
  complete(){ const A=this.auto(); return SETUP_STEPS.every(k=>this.isDone(k,A)); },
  confirm(k){ SETUP.done[k]=true; saveRig(); this.render(); },
  /* the drive base as typed: kind, wheel size, track, wheelbase, rollers, and the base's centre */
  applyForm(){
    const v=id=>$("#"+id)&&$("#"+id).value, mm=x=>(+x||0)/1000;
    const spec=cleanDriveSpec({kind:v("suKind"), n:v("suN"), d:mm(v("suD")), track:mm(v("suTrack")), base:mm(v("suBase")), pattern:v("suPat")});
    // the centre, forward and left of where it is now, into the CAD's own axes
    const fw=mm(v("suFwd")), lf=mm(v("suLeft")), F=dtFrame({up:"+z", front:OPTS.front}), old=OPTS.shift||[0,0];
    const shift=[old[0]+F.fwd[0]*fw+F.left[0]*lf, old[1]+F.fwd[1]*fw+F.left[1]*lf];
    CAD.driveSpec=spec; SETUP.done.drive=true; this.formOpen=false;
    if(fw||lf){ OPTS.shift=shift; saveRig(); if(LAST_STEP){ parseAndLoad(); return; } }
    saveRig(); refitRobot(); if(CODE) rebuild(); this.render();
  },
  backToCad(){ if(!CAD) return; delete CAD.driveSpec; OPTS.shift=null; SETUP.done.drive=false; saveRig(); if(LAST_STEP) parseAndLoad(); else { refitRobot(); this.render(); } },
  render(){
    const box=$("#setupSteps"), pill=$("#setupPill"), chip=$("#vpSetup"); if(!box) return;
    if(!CAD){ box.innerHTML=""; return; }
    let D=null; try{ D=driveFromCAD(CAD,{front:OPTS.front}); }catch(e){ D=null; }
    const A=this.auto(), done=k=>this.isDone(k,A);
    const F=CAD.frame||{}, n=SETUP_STEPS.filter(done).length, def=this.isDefault();
    pill.textContent=def?"ready":n===4?"set up":n+" of 4 checked"; pill.className="pill"+(def||n===4?" ok":"");
    chip.hidden=def||n===4||!LAST_STEP||this.chipGone===CAD;
    const seg=(attr,vals,cur)=>`<div class="seg">${vals.map(([v,t])=>`<button type="button" data-${attr}="${v}" class="${v===cur?"on":""}">${t}</button>`).join("")}</div>`;
    const ok=k=>done(k)?"":`<button class="btn-sm primary" type="button" data-su-ok="${k}">Looks right</button>`;
    // a step that's done folds to one line; click it to change it
    const open=this.open||(this.open=new Set());
    const li=(k,title,st,body)=>`<li class="su-step${done(k)?" done":""}"><details data-su-k="${k}"${!done(k)||open.has(k)||(k==="drive"&&this.formOpen)?" open":""}><summary class="su-head"><b>${title}</b><span class="su-st">${esc(st)}${!SETUP.done[k]&&A[k]?" · found":""}</span></summary>${body}</details></li>`;
    const out=[];
    // 1. floor and up
    out.push(li("up","Floor and up",F.up?"up is "+F.up:"",
      `<p class="su-why">${esc(F.upWhy?"Found: "+F.upWhy+".":"")} Is the robot standing on its wheels, the right way up?</p>`+
      `<div class="su-row">${seg("su-up",[["","auto"],["+z","Z"],["+y","Y"],["-y","−Y"],["+x","X"],["-x","−X"]],OPTS.up||"")}${ok("up")}</div>`));
    // 2. front
    const fw=frontFromWheels(CAD);
    out.push(li("front","Front","front is "+OPTS.front,
      `<p class="su-why">${fw?(fw.slice(1)===OPTS.front.slice(1)?"Along the way its wheels roll.":"Across the way its wheels roll: is that right?"):"Its wheels don't say."} In the top view the front faces up the screen.</p>`+
      `<div class="su-row">${seg("su-front",[["+x","+x"],["+y","+y"],["-x","−x"],["-y","−y"]],OPTS.front)}<button class="btn-sm" type="button" data-su-view="top">Top view</button>${ok("front")}</div>`));
    // 3. the drive base
    const W=D?D.wheels:[], kind={mecanum:"Mecanum",tank:"Tank",x:"X-drive",omni:"Omni",swerve:"Swerve",unknown:"Not found"}[D?D.kind:"unknown"]||"Not found";
    const r=W.length?W.reduce((s,w)=>s+w.r,0)/W.length:0;
    const sum=W.length?kind+", "+W.length+" wheels of "+Math.round(r*2000)+" mm, "+Math.round((D.track||0)*1000)+" × "+Math.round((D.base||0)*1000)+" mm":"no drive wheels found";
    const notes=((D&&D.why)||[]).filter(t=>/mirror|Check that wheel|"O" pattern|can't strafe|set by hand|from each wheel|read off/.test(t));
    const pat=W.length===4&&D.kind==="mecanum"?(W.every(w=>w.roller===((w.corner==="FL"||w.corner==="BR")?1:-1))?"X":"O"):"X";
    const fieldsOpen=this.formOpen||!W.length;
    // the form opens on what the base is now: a 6-wheel tank must not come back as 4 because nobody touched the box
    const nW=[2,4,6].includes(W.length)?W.length:4;
    const form=fieldsOpen?`<div class="su-form">
        <span>Type</span><select id="suKind">${[["mecanum","Mecanum"],["tank","Tank (traction / omni sides)"],["x","X-drive (omni at 45°)"]].map(([v,t])=>`<option value="${v}"${(D&&D.kind===v)?" selected":""}>${t}</option>`).join("")}</select>
        <span>Wheels</span><select id="suN">${[4,6,2].map(k=>`<option${k===nW?" selected":""}>${k}</option>`).join("")}</select>
        <span>Wheel ⌀ mm</span><input id="suD" type="number" min="40" max="200" step="1" value="${Math.round(r*2000)||96}" list="suWheelSizes"><datalist id="suWheelSizes"><option value="96">goBILDA 96 mm mecanum</option><option value="104">goBILDA 104 mm</option><option value="140">goBILDA 140 mm</option><option value="75">REV 75 mm mecanum</option><option value="90">REV 90 mm traction</option><option value="100">AndyMark 4 in</option></datalist>
        <span>Track mm</span><input id="suTrack" type="number" min="100" max="600" step="1" value="${Math.round((D&&D.track||0.36)*1000)}" title="left to right, wheel centre to wheel centre">
        <span>Wheelbase mm</span><input id="suBase" type="number" min="0" max="600" step="1" value="${Math.round((D&&D.base||0.3)*1000)}" title="front axle to back axle">
        <span>Rollers</span><select id="suPat"><option value="X"${pat==="X"?" selected":""}>X from above (standard)</option><option value="O"${pat==="O"?" selected":""}>O from above</option></select>
        <span>Move centre</span><div class="su-pair"><input id="suFwd" type="number" step="1" value="0" title="mm forward"><input id="suLeft" type="number" step="1" value="0" title="mm left"></div>
      </div>
      <div class="su-row"><button class="btn-sm primary" type="button" data-su-drive="apply">Use these</button>${W.length?`<button class="btn-sm" type="button" data-su-drive="close">Cancel</button>`:""}</div>`:"";
    out.push(li("drive","Drive base",sum,
      `<p class="su-why">${D&&D.set?"Set by hand.":W.length?"Found in the CAD.":"The CAD has no drive wheels the bench can read: type the numbers off your chassis (a kit's are on its product page)."}</p>`+
      notes.map(t=>`<p class="su-why${/Check|can't|"O"/.test(t)?" warn":""}">${esc(t)}</p>`).join("")+
      (fieldsOpen?form:`<div class="su-row">${ok("drive")}<button class="btn-sm" type="button" data-su-drive="open">Set it by numbers</button>${D&&D.set?`<button class="btn-sm" type="button" data-su-drive="auto">Back to what the CAD shows</button>`:""}</div>`)));
    // 4. joints and the code
    const q=RC?RC.need+RC.warn:null;
    out.push(li("joints","Joints and your code",q==null?"":q?q+" to look at":"nothing to ask",
      `<p class="su-why">${CODE?"Every motor and servo your code moves needs a joint that moves the right parts. The robot check below asks about anything it can't be sure of.":"Load your OpMode (Java) to check the joints against it."}</p>`+
      `<div class="su-row"><button class="btn-sm" type="button" data-su-goto="robotcheck">Robot check</button><button class="btn-sm" type="button" data-su-cad="1">Fix joints in the CAD view</button>${ok("joints")}</div>`));
    setHTML(box,out.join(""));
  },
  init(){
    $("#setupDownload").addEventListener("click",()=>this.download());
    $("#vpSetup").addEventListener("click",()=>{ const nav=$('.tabs[data-tabs="left"]'); if(nav) selectTab(nav,"robot");
      const s=document.querySelector('[data-sec="setup"]'); if(s) s.scrollIntoView({block:"start", behavior:"smooth"}); this.chipGone=CAD; this.render(); });
    $("#setupSteps").addEventListener("click",e=>{
      // a step the user opens stays open across re-renders (only their clicks count, not the first draw)
      const sm=e.target.closest("summary"), dt=sm&&sm.parentElement;
      if(dt&&dt.dataset.suK){ const o=this.open||(this.open=new Set()); if(dt.open) o.delete(dt.dataset.suK); else o.add(dt.dataset.suK); return; }
      const b=e.target.closest("button"); if(!b) return;
      const d=b.dataset;
      if(d.suOk) this.confirm(d.suOk);
      else if(d.suUp!==undefined){ OPTS.up=d.suUp||undefined; SETUP.done.up=true; saveRig(); if(LAST_STEP) parseAndLoad(); }
      else if(d.suFront){ OPTS.front=d.suFront; SETUP.done.front=true; refitRobot(); syncOptionControls(); saveRig(); ShotUI.dirty=true; this.render(); }
      else if(d.suView){ View.setView(d.suView); $$("#viewSeg button").forEach(x=>x.classList.toggle("on",x.dataset.v===d.suView)); }
      else if(d.suDrive==="open"){ this.formOpen=true; this.render(); }
      else if(d.suDrive==="close"){ this.formOpen=false; this.render(); }
      else if(d.suDrive==="apply") this.applyForm();
      else if(d.suDrive==="auto") this.backToCad();
      else if(d.suGoto){ const s=document.querySelector('[data-sec="'+d.suGoto+'"]'); if(s) s.scrollIntoView({block:"start", behavior:"smooth"}); }
      else if(d.suCad){ CadView.enter(); $$("#viewSeg button").forEach(x=>x.classList.toggle("on",x.dataset.v==="cad")); }
    });
  }
};

/* ============================================================
   ROBOT CHECK — the robot against the team's own code (src/robotcheck.js),
   as questions with their likely answers. An answer lands in the robot's
   joint spec like any other edit, so it's asked once.
   ============================================================ */
let RC=null;
/* The robot check, and the setup step that counts its questions. */
function renderRobotCheck(){ renderRobotCheckNow(); SetupUI.render(); }
function renderRobotCheckNow(){
  // shown twice: in the Robot tab, and at the top of the Checks tab
  const boxes=[$("#robotCheck"),$("#rcChecks")].filter(Boolean), pill=$("#rcPill"); if(!boxes.length) return;
  const put=h=>boxes.forEach(b=>{ b.innerHTML=(b.id==="rcChecks"?rcHead():"")+h; });
  const rcHead=()=>`<div class="rc-title"><b>Robot check</b><span class="pill ${RC?(RC.ready?(RC.warn?"warnp":"ok"):"bad"):""}">${RC?(RC.ready?(RC.warn?RC.warn+" to confirm":"ready"):RC.need+" to answer"):"—"}</span></div>`;
  if(!CAD||!CODE){ RC=null; put(`<p class="hint">Load a robot and an OpMode to check them together.</p>`); if(pill){ pill.textContent="—"; pill.className="pill"; } return; }
  try{ RC=checkRobot(CAD,CODE,MAP,{isCommanded:n=>isCommanded(CODE,n), front:OPTS.front}); }
  catch(e){ RC=null; put(`<p class="hint">The robot check stopped: ${esc(e.message)}</p>`); return; }
  pill.textContent=RC.ready?(RC.warn?RC.warn+" to confirm":"ready"):RC.need+" to answer";
  pill.className="pill "+(RC.ready?(RC.warn?"warnp":"ok"):"bad");
  const SEV={fail:"ANSWER",warn:"CONFIRM",note:"NOTE",ok:"OK"};
  const btn=(act,arg,txt,cls)=>`<button class="btn-sm${cls?" "+cls:""}" data-rc="${act}" data-a="${esc(arg)}">${esc(txt)}</button>`;
  const ok=RC.items.filter(i=>i.sev==="ok"), open=RC.items.filter(i=>i.sev!=="ok");
  const row=(it,n)=>{
    let acts="";
    if(it.ask==="pick-parts"){
      acts=(it.candidates||[]).map(c=>`<span class="rc-cand">${esc(c.label)} ${btn("show",c.joint,"show")}${btn("pair",it.device+"|"+c.joint,"this one","primary")}</span>`).join("")+
        btn("click",it.device,"Click it in the CAD view");
    }else if(it.ask==="pick-device"){
      acts=btn("show",it.joint,"show")+(it.candidates||[]).map(c=>btn("pair",c.device+"|"+it.joint,c.device)).join("")+btn("drop",it.joint,"not a joint");
    }else if(it.ask==="drop-joint") acts=btn("show",it.joint,"show")+btn("drop",it.joint,"remove it","primary");
    else if(it.ask==="look"&&it.joint) acts=btn("show",it.joint,"show");
    else if(it.ask==="mates") acts=btn("mates","","Use my Onshape mates");
    return `<div class="rc-item ${it.sev}"><div class="rc-head"><span class="rc-sev">${SEV[it.sev]}</span><span class="rc-text">${esc(it.text)}</span></div>${acts?`<div class="rc-acts">${acts}</div>`:""}</div>`;
  };
  // nothing to ask: say so, and say when there would be (joints the bench had to guess)
  const guessed=RC.items.some(i=>i.key==="source"&&i.ask==="mates");
  put((open.length?open.map(row).join(""):`<p class="rc-done">Nothing to ask: every motor and servo your code moves has a joint, and every joint checks out.</p>`+
      (guessed?"":`<p class="hint">These joints came with the robot, so nothing is guessed. ${btn("guess","","See it with guessed joints")}</p>`))+
    (ok.length?`<details class="rc-ok"><summary>${ok.length} checked</summary>${ok.map(row).join("")}</details>`:""));
  boxes.forEach(box=>box.querySelectorAll("[data-rc]").forEach(b=>b.addEventListener("click",()=>robotCheckAct(b.dataset.rc,b.dataset.a))));
}
function partsOfJoint(id){
  const kids=new Set([id]); let grew=true;
  while(grew){ grew=false; for(const m of CAD.mechs) if(m.parent&&kids.has(m.parent)&&!kids.has(m.id)){ kids.add(m.id); grew=true; } }
  const o=[]; (CAD.solids||[]).forEach((s,i)=>{ if(kids.has(s.mech)) o.push(i); }); return o;
}
// swing a joint back and forth for a moment in the CAD view, its parts picked out
let RC_WIGGLE=null;
function showJoint(id){
  const m=CAD&&CAD.mechs.find(x=>x.id===id); if(!m) return;
  if(!CadView.on) CadView.enter();
  // the CAD view picks meshes; each knows its part (solid)
  const parts=new Set(partsOfJoint(id)), asg=View.exactAsg;
  if(asg&&asg.solid){ const meshes=[]; asg.solid.forEach((si,j)=>{ if(parts.has(si)) meshes.push(j); }); if(meshes.length) CadView.select(meshes); }
  // and look at them
  const P=[...parts].flatMap(i=>CAD.solids[i].pts||[]);
  if(P.length&&CAD.bbox){ const lo=[0,1,2].map(k=>Math.min(...P.map(p=>p[k]))), hi=[0,1,2].map(k=>Math.max(...P.map(p=>p[k])));
    const c=[0,1,2].map(k=>(lo[k]+hi[k])/2), d=Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]), b=CAD.bbox, D=Math.hypot(b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2]);
    CadView.target=CadView.loc(c); CadView.zoom=Math.max(1,Math.min(4,0.8*D/Math.max(d,0.02))); }
  clearInterval(RC_WIGGLE); const t0=performance.now(), lin=normJointKind(m.kind)==="linear";
  RC_WIGGLE=setInterval(()=>{ const t=(performance.now()-t0)/1000;
    if(t>3){ clearInterval(RC_WIGGLE); View.preview=null; return; }
    View.preview={id, q:(lin?0.08:0.5)*Math.sin(t*Math.PI*1.3)+(lin?0:(m.q0||0))}; },30);
}
function robotCheckAct(act,a){
  if(act==="show") return showJoint(a);
  if(act==="pair"){ const [dev,joint]=a.split("|"); changeJoint(joint,{device:dev}); return; }
  if(act==="drop"){ removeJoint(a); return; }
  if(act==="click"){ CadView.pendingDevice=a; if(!CadView.on) CadView.enter();
    const h=document.querySelector(".cad-hint"); if(h){ h.textContent="Click the part "+a+" moves, then 'New joint from this part'"; h.classList.add("ask"); } return; }
  if(act==="guess"){ const f=$("#jointsFind"); if(f) f.click(); return; }
  if(act==="mates"){ const nav=$('.tabs[data-tabs="left"]'); if(nav) selectTab(nav,"robot");
    OnshapeHelp.open(); }
}

/* The automatic joint finder (src/autorig.js): a joint spec from the STEP's
   geometry alone, with what a person should check. quiet: it ran by itself
   on a new robot, so finding nothing leaves the old guess in place. */
function findJoints(cad,quiet){
  const st=$("#mateStatus"); if(!cad||CAD!==cad) return;
  st.textContent="finding the joints from the geometry …";
  setTimeout(()=>{
    if(CAD!==cad) return;
    let R=null;
    try{ R=autoRig(cad,{front:OPTS.front}); }catch(e){ st.textContent="The joint finder stopped: "+e.message; return; }
    if(!R||!R.spec){ st.textContent=quiet?"No joints found from the geometry, so they're guessed. Add Onshape mates or a joint spec, or make them in the CAD view."
      :((R&&R.review[0])||"No joints found."); return; }
    MATES.asm=MATES.features=MATES.name=MATES.report=null;
    JOINTS.spec=R.spec; JOINTS.name="found automatically"; JOINTS.step=LAST_STEP?LAST_STEP.name:(cad.name||null);
    applyJoints();
  },40);
}
/* these parts (solid indices) ride this joint ("chassis": the frame) */
function assignParts(solids,joint){
  const set=new Set(solids);
  return editJoints(spec=>{
    spec.assign=(spec.assign||[]).map(a=>({joint:a.joint, parts:(a.parts||[]).map(p=>p.solid?{solid:p.solid.filter(i=>!set.has(i))}:p)
      .filter(p=>!p.solid||p.solid.length)})).filter(a=>a.parts.length);
    spec.assign.push({joint, parts:[{solid:[...set].sort((a,b)=>a-b)}]});
  });
}
function addJoint(def,solids){
  return editJoints(spec=>{
    let id=(def.label||"joint").trim().slice(0,40)||"joint", n=2; const base=id;
    while(spec.joints.some(j=>j.id===id)) id=base+" "+(n++);
    const j={id, label:def.label||id, kind:def.kind==="slider"?"slider":"revolute", axis:def.axis,
      pivot:def.pivot.map(v=>+(v*1000).toFixed(2)), parts:[]};
    if(def.parent&&def.parent!=="chassis") j.parent=def.parent;
    if(def.device) j.device=def.device;
    spec.joints.push(j);
    spec.assign=(spec.assign||[]).concat([{joint:id, parts:[{solid:solids.slice().sort((a,b)=>a-b)}]}]);
    def.id=id;
  });
}
function removeJoint(id){
  return editJoints(spec=>{
    const j=spec.joints.find(x=>x.id===id); if(!j) return;
    spec.joints=spec.joints.filter(x=>x!==j);
    for(const k of spec.joints){ if(k.parent===id){ if(j.parent) k.parent=j.parent; else delete k.parent; }
      if(k.follows&&(k.follows.joint===id||k.follows.slider===id)) delete k.follows; }
    // what it carried rides whatever carried it
    spec.assign=(spec.assign||[]).map(a=>a.joint===id?Object.assign({},a,{joint:j.parent||"chassis"}):a);
    if(j.parts&&j.parts.length) spec.assign.push({joint:j.parent||"chassis", parts:j.parts});
  });
}
function changeJoint(id,patch){
  return editJoints(spec=>{ const j=spec.joints.find(x=>x.id===id); if(j) Object.assign(j,patch); });
}
function downloadJoints(){
  const spec=editableSpec(); if(!spec) return;
  const blob=new Blob([JSON.stringify(spec,null,1)],{type:"application/json"}), a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=((JOINTS.step||CAD.name||"robot").replace(/\.(step|stp)$/i,""))+".joints.json";
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
}
/* Which device drives which joint: a joint spec says so outright (by the
   variable or the configuration name); otherwise the names and the CAD
   decide. Either way, what the user picked by hand in the table stays. */
function mapDevices(){
  if(!CODE||!CAD) return;
  MAP=autoMap(CODE.devices,CAD.mechs,{cad:CAD});
  applyDeviceMemory();
  const J=JOINTS.report&&CAD.mates&&CAD.mates.source==="spec"?JOINTS.devices:null;
  if(J) for(const d of CODE.devices){
    const own=k=>k&&Object.prototype.hasOwnProperty.call(J,k)?J[k]:null;
    const j=own(d.name)||own(d.cfg)||own(d.alias), picked=RIG_DEVICES[d.name];
    // a device the user mapped to one of these joints by hand keeps it
    if(j&&CAD.mechs.some(m=>m.id===j)&&!(picked&&CAD.mechs.some(m=>m.id===picked))) MAP[d.name]=j;
  }
}
function clearMates(){
  if(JOINTS.spec){ JOINTS.spec=JOINTS.report=JOINTS.devices=null; JOINTS.name=JOINTS.step=null; }
  MATES.asm=MATES.features=MATES.name=MATES.report=MATES.url=null; MATES.fromLink=false; onshapeNote("");
  $("#matePill").textContent="none"; $("#matePill").className="pill"; $("#mateClear").hidden=true;
  $("#mateNote").innerHTML=""; $("#mateDrop").className="drop";
  $("#mateStatus").textContent="Drop the assembly definition, and the features file too if you want limits.";
  if(LAST_STEP) parseAndLoad();                 // back to the joints the STEP alone suggests
}
function wireMates(){
  const drop=$("#mateDrop"), input=$("#mateFile");
  const many=list=>[].forEach.call(list||[],takeMates);
  drop.addEventListener("click",()=>input.click());
  drop.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); input.click(); } });
  ["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); e.stopPropagation(); drop.classList.add("armed"); document.body.classList.remove("dragging"); }));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.remove("armed"); }));
  drop.addEventListener("drop",e=>{ e.stopPropagation(); document.body.classList.remove("dragging"); many(e.dataTransfer.files); });
  input.addEventListener("change",e=>{ many(e.target.files); input.value=""; });
  $("#mateUrl").addEventListener("input",e=>{
    const L=onshapeApiLinks(e.target.value), box=$("#mateLinks");
    box.hidden=!L; if(!L) return;
    $("#mateDefLink").href=L.def; $("#mateFeatLink").href=L.features;
  });
  $("#mateClear").addEventListener("click",clearMates);
  $("#jointsDownload").addEventListener("click",downloadJoints);
  $("#jointsFind").addEventListener("click",()=>{ if(CAD) findJoints(CAD,false); });
  $("#jointsReset").addEventListener("click",()=>{
    const name=JOINTS.step||(CAD&&CAD.name); store.del(jointsKey(name));
    JOINTS.spec=name===DEFAULT_ROBOT.step&&DEFAULT_ROBOT.spec?DEFAULT_ROBOT.spec:null;
    if(JOINTS.spec) applyJoints(); else if(LAST_STEP) parseAndLoad();
  });
}
/* A URDF and its STL meshes, dropped together (src/urdf.js): gathered as they
   are read, then built once into the robot, joints and all. */
const URDF_IN={text:null,name:null,files:{},timer:null};
function takeUrdfPart(file){
  const r=new FileReader();
  const isUrdf=/\.urdf$/i.test(file.name);
  r.onload=()=>{
    if(isUrdf){ URDF_IN.text=r.result; URDF_IN.name=file.name.replace(/\.urdf$/i,""); }
    else URDF_IN.files[file.name]=r.result;
    clearTimeout(URDF_IN.timer);
    URDF_IN.timer=setTimeout(()=>{
      if(!URDF_IN.text){ $("#cadStatus").textContent=Object.keys(URDF_IN.files).length+" mesh file(s) waiting for their .urdf"; return; }
      let p;
      try{ p=urdfToPayload(URDF_IN.text,URDF_IN.files,URDF_IN.name); }
      catch(e){ $("#cadStatus").textContent="couldn't read this URDF — "+e.message; $("#cadDrop").className="drop bad"; return; }
      // gathered once: a lone .stl dropped later waits for its own .urdf, it doesn't rebuild this one
      const nm=URDF_IN.name; URDF_IN.text=null; URDF_IN.name=null; URDF_IN.files={};
      if(loadOnshapeRobot(p)) $("#cadStatus").textContent=nm+" · from URDF · "+CAD.solids.length+" parts · "+CAD.mechs.filter(m=>m.fromMate).length+" joints";
    },200);
  };
  if(isUrdf) r.readAsText(file); else r.readAsArrayBuffer(file);
}
function routeFile(file){
  const n=file.name.toLowerCase();
  if(/\.(urdf|stl)$/.test(n)) takeUrdfPart(file);
  else if(/\.(step|stp)$/.test(n)) takeCAD(file);
  else if(/\.ftcsim$/.test(n)) Session.take(file);
  else if(/\.xml$/.test(n)) takeRobotConfig(file);
  else if(/\.json$/.test(n)) takeMates(file);
  else takeCode(file);
}
function wireDrop(dropEl,inputEl,handler,all){
  const open=()=>inputEl.click();
  dropEl.addEventListener("click",e=>{ if(e.target!==inputEl) open(); });
  dropEl.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } });
  ["dragenter","dragover"].forEach(ev=>dropEl.addEventListener(ev,e=>{ e.preventDefault(); e.stopPropagation(); dropEl.classList.add("armed"); document.body.classList.remove("dragging"); }));
  ["dragleave","drop"].forEach(ev=>dropEl.addEventListener(ev,e=>{ e.preventDefault(); dropEl.classList.remove("armed"); }));
  dropEl.addEventListener("drop",e=>{ e.stopPropagation(); document.body.classList.remove("dragging");
    const fs=[].slice.call(e.dataTransfer.files||[]); (all?fs:fs.slice(0,1)).forEach(handler); });
  inputEl.addEventListener("change",e=>{ const fs=[].slice.call(e.target.files||[]); (all?fs:fs.slice(0,1)).forEach(handler); inputEl.value=""; });
}
function wirePageDrop(){
  let depth=0;
  addEventListener("dragenter",e=>{ if(e.dataTransfer&&[].indexOf.call(e.dataTransfer.types||[],"Files")>=0){ depth++; document.body.classList.add("dragging"); } });
  addEventListener("dragleave",()=>{ depth=Math.max(0,depth-1); if(!depth) document.body.classList.remove("dragging"); });
  addEventListener("dragover",e=>e.preventDefault());
  addEventListener("drop",e=>{ e.preventDefault(); depth=0; document.body.classList.remove("dragging");
    [].forEach.call((e.dataTransfer&&e.dataTransfer.files)||[],routeFile); });
}

/* ============================================================
   KEYBOARD — each key presses the gamepad the code reads it from,
   so I J K L drive a gamepad1 drivetrain even while gamepad2 is on screen
   ============================================================ */
const KEYMAP={KeyA:"a",KeyB:"b",KeyX:"x",KeyY:"y",KeyQ:"left_bumper",KeyE:"right_bumper",
  ArrowUp:"dpad_up",ArrowDown:"dpad_down",ArrowLeft:"dpad_left",ArrowRight:"dpad_right"};
const STICKKEYS={KeyI:["left_stick_y",-1],KeyK:["left_stick_y",1],KeyJ:["left_stick_x",-1],KeyL:["left_stick_x",1],
                 KeyU:["right_stick_x",-1],KeyO:["right_stick_x",1]};
const KEY_PAD={};                   // which gamepad each held key went to
const typing=e=>{ const t=e.target.tagName; return t==="TEXTAREA"||t==="INPUT"||t==="SELECT"||(e.target.dataset&&e.target.dataset.stick)||(e.target.getAttribute&&e.target.getAttribute("role")==="tab"); };
function knobTo(pad,axis,v){
  if(pad!==activePad) return;
  for(const k of STICKS){
    if(k.ax!==axis&&k.ay!==axis) continue;
    const knob=$(`[data-knob="${k.id}"]`); if(!knob) continue;
    if(k.ax===axis) knob.setAttribute("cx",k.cx+v*(k.r-7)); else knob.setAttribute("cy",k.cy+v*(k.r-7));
  }
}
function releaseKey(code){
  const p=KEY_PAD[code]; if(p==null) return; delete KEY_PAD[code];
  const sk=STICKKEYS[code];
  if(sk){ Sim.pad[p][sk[0]]=0; knobTo(p,sk[0],0); return; }
  const b=KEYMAP[code]; if(!b) return;
  Sim.pad[p][b]=false;
  const el=$(`#padwrap [data-btn="${b}"]`); if(el&&p===activePad) el.classList.remove("down");
}
addEventListener("keydown",e=>{
  if(typing(e)||e.ctrlKey||e.metaKey||e.altKey) return;
  if(e.code==="BracketLeft"||e.code==="BracketRight"){ const side=e.code==="BracketLeft"?"left":"right";
    setRail(side,$("#app").classList.contains(side+"-closed")); return; }
  if(e.code==="KeyF"&&!e.repeat){ e.preventDefault(); shotFire(); return; }
  const sk=STICKKEYS[e.code];
  if(sk){ e.preventDefault(); const p=padFor(CODE,sk[0],activePad); KEY_PAD[e.code]=p;
    Sim.pad[p][sk[0]]=sk[1]; knobTo(p,sk[0],sk[1]); return; }
  const b=KEYMAP[e.code]; if(!b) return;
  e.preventDefault(); const p=padFor(CODE,b,activePad); KEY_PAD[e.code]=p; Sim.pad[p][b]=true;
  const el=$(`#padwrap [data-btn="${b}"]`); if(el&&p===activePad) el.classList.add("down");
});
addEventListener("keyup",e=>releaseKey(e.code));
addEventListener("blur",()=>Object.keys(KEY_PAD).forEach(releaseKey));

/* ============================================================
   CONTROLLERS — plug in a real gamepad and it drives the OpMode
   ============================================================ */
const Pads={
  assign:{},                        // controller index → gamepad 1 | 2, or 0 for off
  deadzone:0.08, blocked:false, sig:"", lastBuzz:{},
  init(){
    const dz=parseFloat(store.get("ftcbench.deadzone","0.08")); this.deadzone=isFinite(dz)?dz:0.08;
    try{ const fp=document.featurePolicy||document.permissionsPolicy;
      if(fp&&fp.allowsFeature&&!fp.allowsFeature("gamepad")) this.blocked=true; }catch(e){}
    try{ if(navigator.getGamepads) navigator.getGamepads(); }catch(e){ this.blocked=true; }
    addEventListener("gamepadconnected",e=>this.connect(e.gamepad));
    addEventListener("gamepaddisconnected",e=>{ delete this.assign[e.gamepad.index]; this.render(); });
    $("#ctrlChip").addEventListener("click",()=>this.toggle());
    $("#ctrlClose").addEventListener("click",()=>this.toggle(false));
    document.addEventListener("pointerdown",e=>{ if(!$("#ctrlPanel").hidden&&!e.target.closest(".ctrl-wrap")) this.toggle(false); });
    addEventListener("keydown",e=>{ if(e.key==="Escape"&&!$("#ctrlPanel").hidden) this.toggle(false); });
    $("#deadzone").value=this.deadzone; $("#deadzoneVal").textContent=this.deadzone.toFixed(2);
    $("#deadzone").addEventListener("input",e=>{ this.deadzone=+e.target.value;
      $("#deadzoneVal").textContent=this.deadzone.toFixed(2); store.set("ftcbench.deadzone",String(this.deadzone)); });
    $("#ctrlList").addEventListener("click",e=>{ const b=e.target.closest("[data-assign]"); if(b) this.set(+b.dataset.idx,+b.dataset.assign); });
    Sim.onRumble=(pad,meth,args)=>this.rumble(pad,meth,args);
    this.render();
  },
  list(){
    if(this.blocked||!navigator.getGamepads) return [];
    try{ return [].slice.call(navigator.getGamepads()).filter(Boolean); }catch(e){ this.blocked=true; return []; }
  },
  /* A new controller takes the gamepad this OpMode reads most, unless
     another controller already has it. */
  connect(gp){
    if(this.assign[gp.index]==null){
      const taken=Object.keys(this.assign).map(k=>this.assign[k]);
      const want=busiestPad(CODE), other=want===1?2:1;
      this.assign[gp.index]=taken.indexOf(want)<0?want:(taken.indexOf(other)<0?other:0);
    }
    this.render();
  },
  set(idx,pad){
    if(pad) for(const k in this.assign) if(+k!==idx&&this.assign[k]===pad) this.assign[k]=0;   // one controller per gamepad
    this.assign[idx]=pad;
    if(pad) setActivePad(pad); else this.render();
  },
  /* A lone controller follows the OpMode: gamepad2 for a claw TeleOp,
     gamepad1 for a drive TeleOp. */
  defaults(){
    const gps=this.list();
    if(gps.length===1&&this.assign[gps[0].index]!==0) this.assign[gps[0].index]=busiestPad(CODE);
    this.render();
  },
  padOf(p){ return this.list().filter(g=>this.assign[g.index]===p)[0]||null; },
  poll(){
    const gps=this.list();
    for(const g of gps){
      if(this.assign[g.index]==null) this.connect(g);        // some browsers skip the connect event
      const p=this.assign[g.index]; if(!p) continue;
      const s=padFromGamepad(g,this.deadzone), dst=Sim.pad[p];
      for(const k in s) dst[k]=s[k];
    }
    const sig=gps.map(g=>g.index+":"+this.assign[g.index]).join(",");
    if(sig!==this.sig){ this.sig=sig; this.render(); }
  },
  /* The on-screen gamepad mirrors a real controller on the pad it shows. */
  mirror(){
    if(!this.padOf(activePad)) return;
    const st=Sim.pad[activePad];
    $$("#padwrap [data-btn]").forEach(el=>{ const v=st[el.dataset.btn]; el.classList.toggle("down",typeof v==="number"?v>0.2:!!v); });
    for(const k of STICKS){ const knob=$(`[data-knob="${k.id}"]`); if(!knob) continue;
      knob.setAttribute("cx",k.cx+(st[k.ax]||0)*(k.r-7)); knob.setAttribute("cy",k.cy+(st[k.ay]||0)*(k.r-7)); }
  },
  /* gamepad1.rumble(…) in the OpMode buzzes the real controller */
  rumble(pad,meth,args){
    const g=this.padOf(pad), act=g&&g.vibrationActuator; if(!act||!act.playEffect) return;
    const key=pad+meth+args.join(","), now=performance.now();
    if(this.lastBuzz[pad]&&this.lastBuzz[pad].key===key&&now-this.lastBuzz[pad].t<250) return;
    this.lastBuzz[pad]={key,t:now};
    try{
      if(meth==="stopRumble"){ if(act.reset) act.reset(); return; }
      const ms=meth==="rumbleBlips"?Math.max(1,args[0]||1)*160:(args.length>=3?args[2]:args[0])||250;
      const s=meth==="rumble"&&args.length>=3?[args[0],args[1]]:[1,1];
      act.playEffect("dual-rumble",{duration:Math.min(2000,ms), strongMagnitude:clamp01(s[0]), weakMagnitude:clamp01(s[1])});
    }catch(e){}
  },
  renderChip(){
    const chip=$("#ctrlChip"), lab=$("#ctrlLabel"); if(!chip) return;
    const gps=this.list(), used=gps.filter(g=>this.assign[g.index]);
    chip.classList.toggle("live",used.length>0);
    lab.textContent=this.blocked?"Controller":used.length?used.map(g=>"gamepad"+this.assign[g.index]).join(" + "):gps.length?"Controller off":"Controller";
    chip.title=used.length?used.map(g=>padName(g.id)+" → gamepad"+this.assign[g.index]).join("\n"):"Plug in a controller";
    const live=$("#padLive"); if(live) live.hidden=!this.padOf(activePad);
  },
  render(){
    this.renderChip();
    const box=$("#ctrlList"); if(!box) return;
    const gps=this.list();
    if(this.blocked){ setHTML(box,`<div class="ctrl-empty">This embedded view isn't allowed to read controllers. Open the bench in its own tab — <a href="https://lilrino71.github.io/ftc-sim-bench/" target="_blank" rel="noopener">lilrino71.github.io/ftc-sim-bench</a> — and they work there.</div>`); return; }
    if(!gps.length){ setHTML(box,`<div class="ctrl-empty"><b>No controller yet.</b> Plug one in over USB or Bluetooth, then press any button on it.</div>`); return; }
    setHTML(box,gps.map(g=>{ const p=this.assign[g.index]||0;
      return `<div class="ctrl-row"><div class="ctrl-name" title="${esc(g.id)}">${esc(padName(g.id))}</div>
        <div class="seg">${[1,2,0].map(v=>`<button type="button" data-idx="${g.index}" data-assign="${v}" class="${p===v?"on":""}">${v?"gamepad"+v:"off"}</button>`).join("")}</div>
        <div class="ctrl-sub">${g.mapping==="standard"?"standard layout":"unusual layout — some buttons may be swapped"}${g.vibrationActuator?" · rumbles when the code asks":""}</div>
        <div class="ctrl-bars" data-bars="${g.index}" aria-hidden="true">${"<i></i>".repeat(10)}</div></div>`; }).join(""));
  },
  /* Activity lights in the open panel: face buttons, bumpers, sticks. */
  meters(){
    if($("#ctrlPanel").hidden) return;
    for(const g of this.list()){
      const el=$(`[data-bars="${g.index}"]`); if(!el) continue;
      const b=i=>g.buttons[i]&&g.buttons[i].pressed, a=i=>Math.abs(g.axes[i]||0)>0.3;
      const v=[b(0),b(1),b(2),b(3),b(4),b(5),a(0)||a(1),a(2)||a(3),b(12)||b(13)||b(14)||b(15),(g.buttons[6]&&g.buttons[6].value>0.2)||(g.buttons[7]&&g.buttons[7].value>0.2)];
      el.querySelectorAll("i").forEach((i,k)=>i.classList.toggle("on",!!v[k]));
    }
  },
  toggle(open){
    const p=$("#ctrlPanel"), o=open==null?p.hidden:open;
    p.hidden=!o; $("#ctrlChip").setAttribute("aria-expanded",String(o));
    if(o) this.render();
  }
};

/* ============================================================
   JAVA — the OpMode's source, highlighted, with the lines the
   bench can't run marked in the gutter
   ============================================================ */
const JAVA_RE=/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(@[A-Za-z_]\w*)|\b(gamepad[12]\.\w+)|\b(package|import|public|private|protected|static|final|abstract|class|interface|enum|extends|implements|void|if|else|while|for|do|switch|case|default|break|continue|return|new|try|catch|finally|throw|throws|this|super|true|false|null|double|int|long|float|boolean|char|byte|short|var|instanceof|synchronized|volatile)\b|\b(\d+(?:\.\d+)?[fFdDlL]?)\b|\b([A-Z][A-Za-z0-9_]*)\b/g;
function highlightJava(src){
  let out="", last=0, m;
  JAVA_RE.lastIndex=0;
  while((m=JAVA_RE.exec(src))){
    out+=esc(src.slice(last,m.index));
    const cls=m[1]?"c":m[2]?"s":m[3]?"a":m[4]?"g":m[5]?"k":m[6]?"n":"t";
    out+=`<span class="${cls}">${esc(m[0])}</span>`;
    last=JAVA_RE.lastIndex;
  }
  return out+esc(src.slice(last));
}
const Editor={
  skip:{},
  init(){
    this.ta=$("#srcbox"); this.hl=$("#edHl"); this.gut=$("#edGutter");
    this.ta.addEventListener("input",()=>{ clearTimeout(this.tm); this.tm=setTimeout(()=>this.refresh(),110); });
    this.ta.addEventListener("scroll",()=>this.sync());
    this.ta.addEventListener("keydown",e=>{
      if(e.key==="Tab"&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey){
        e.preventDefault();
        if(!(document.execCommand&&document.execCommand("insertText",false,"    "))){
          this.ta.setRangeText("    ",this.ta.selectionStart,this.ta.selectionEnd,"end"); this.refresh(); }
      }
      if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){ e.preventDefault(); $("#reparse").click(); }
    });
  },
  set(text){ if(!this.ta) return; this.ta.value=text; this.ta.scrollTop=0; this.ta.scrollLeft=0; this.refresh(); },
  marks(lines){ this.skip={}; for(const l of lines||[]) if(l) this.skip[l]=1; this.refresh(); },
  refresh(){
    if(!this.ta) return;
    const v=this.ta.value;
    this.hl.innerHTML=highlightJava(v)+"\n";
    const n=v.split("\n").length; let g="";
    for(let i=1;i<=n;i++) g+=(this.skip[i]?`<b title="The bench can't run this line">● ${i}</b>`:i)+"\n";
    this.gut.innerHTML=g;
    this.sync();
  },
  sync(){ this.hl.scrollTop=this.ta.scrollTop; this.hl.scrollLeft=this.ta.scrollLeft; this.gut.scrollTop=this.ta.scrollTop; }
};

/* ============================================================
   ONLINE — one match with other teams, each on their own computer
   (src/net.js). The panel finds or hosts a match, deals the places,
   INITs and STARTs this robot with everyone else, and keeps the chat
   and the alliance's marks on a map of the field.
   ============================================================ */
const NetUI={
  loading:null, markKind:"go", joinT:0, was:"off", quickT:null,
  init(){
    $("#onlineBtn").addEventListener("click",()=>this.toggle());
    $("#onpClose").addEventListener("click",()=>this.show(false));
    $("#onpName").value=store.get("ftcbench.netName","");
    $("#onpName").addEventListener("change",()=>this.name());
    $("#onpQuick").addEventListener("click",()=>this.quick());
    $("#onpHost").addEventListener("click",()=>this.hostNow(false));
    $("#onpJoinForm").addEventListener("submit",e=>{ e.preventDefault(); this.joinCode($("#onpCode").value); });
    $("#onpCode").addEventListener("input",e=>{ e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""); });
    $("#onpCopy").addEventListener("click",()=>this.copyInvite());
    $("#onpGo").addEventListener("click",()=>{ if(!Online.start()) this.render(); });
    $("#onpAgain").addEventListener("click",()=>Online.again());
    $("#onpLeave").addEventListener("click",()=>{ Online.leave(); if(Online.lobby==null) Online.browse(); resetMatch(); this.say(""); this.render(); });
    $("#onpSkill").addEventListener("change",e=>Online.set({skill:e.target.value}));
    $("#onpPub").addEventListener("change",e=>Online.set({pub:e.target.checked}));
    $$("#onpPeriod button").forEach(b=>b.addEventListener("click",()=>Online.set({period:b.dataset.p})));
    $$("#onpMarkSeg button").forEach(b=>b.addEventListener("click",()=>{ this.markKind=b.dataset.m; $$("#onpMarkSeg button").forEach(x=>x.classList.toggle("on",x===b)); }));
    $("#onpMap").addEventListener("click",e=>this.mapClick(e));
    $("#onpSay").addEventListener("submit",e=>{ e.preventDefault(); const t=$("#onpText"); Online.say(t.value,$("#onpTo").value==="team"); t.value=""; });
    $("#onpSlots").addEventListener("click",e=>{ const b=e.target.closest("button[data-slot]"); if(b) Online.pick(b.dataset.slot==="none"?null:b.dataset.slot); });
    $("#onpReady").addEventListener("click",e=>{ const b=e.target.closest("button[data-ready]"); if(b) Online.setReady(b.dataset.ready==="1",this.kind()); });
    $("#onpList").addEventListener("click",e=>{ const b=e.target.closest("button[data-code]"); if(b) this.joinCode(b.dataset.code,b.dataset.hid); });
    Online.onChange((what,data)=>this.on(what,data));
    View.onLite=L=>this.modelReady(L); if(View.lite) this.modelReady(View.lite);
    Online.jointsOf=()=>View.lite&&View.lite===this.packed?View.segJoints():null;
    View.onLoad=()=>Perf.quiet();
    // an invite link opened in a tab that already has SimBench open only changes the fragment
    addEventListener("hashchange",()=>{ if(/^#join=/i.test(location.hash)) this.invited(location.hash.slice(6)); });
  },
  show(o){ $("#onlinePanel").hidden=!o; $("#onlineBtn").setAttribute("aria-expanded",String(!!o)); if(o) this.render(); },
  async toggle(){
    if(!$("#onlinePanel").hidden){ this.show(false); return; }
    this.show(true);
    if(await this.connect()&&Online.state==="off") Online.browse();
    this.render();
  },
  /* Trystero, the first time: from jsDelivr, pinned to one version */
  connect(){
    if(Online.T) return Promise.resolve(true);
    if(!this.loading) this.loading=netTrystero().then(T=>{
      Online.use(T);
      T.onError=d=>{
        if(!d||!Online.code||d.room!=="m-"+Online.code) return;       // a stranger in the lobby, not this match
        this.say("A player couldn't connect: "+String((d.error&&d.error.message)||d.error||"no reason given")+
          ". Some school and company networks block direct connections between browsers.","warn");
      };
      return true;
    }).catch(e=>{ this.loading=null; this.say("Couldn't load the online library ("+String(e&&e.message||e)+"). Check the internet connection and try again.","fail"); return false; });
    return this.loading;
  },
  say(text,kind){ const m=$("#onpMsg"); m.hidden=!text; m.textContent=text||""; m.className="onp-msg"+(kind?" "+kind:""); },
  name(){ const v=netStr($("#onpName").value,24); $("#onpName").value=v; if(v) store.set("ftcbench.netName",v); return v; },
  needName(){ const n=this.name(); if(!n){ this.say("Put your team number or name in first. The other players see it.","warn"); $("#onpName").focus(); } return n; },
  kind(){ return CODE&&CODE.kind==="Autonomous"?"Autonomous":"TeleOp"; },
  async hostNow(pub){
    const n=this.needName(); if(!n||!await this.connect()) return;
    this.say("");
    Online.host({name:n, pub, period:this.kind(), skill:$("#matchSkill").value});
  },
  async joinCode(code,hid){
    const n=this.needName(); if(!n||!await this.connect()) return;
    code=String(code||"").toUpperCase();
    if(!/^[A-HJ-NP-Z2-9]{5}$/.test(code)){ this.say("A match code is 5 letters and numbers, like K7QMX.","warn"); return; }
    this.say(""); this.joinT=performance.now();
    Online.join(code,{name:n, hid:hid||null});
  },
  /* Quick match: the fullest open match there is, or a new listed one if there's none. */
  async quick(){
    const n=this.needName(); if(!n||!await this.connect()) return;
    Online.browse(); this.say("Looking for an open match…");
    clearInterval(this.quickT);
    const t0=performance.now();
    const look=()=>{
      if(Online.state!=="off"){ clearInterval(this.quickT); return; }
      const L=Online.openMatches();
      if(L.length){ clearInterval(this.quickT); this.joinCode(L[0].code,L[0].hid); return; }
      if(performance.now()-t0>4500){ clearInterval(this.quickT);
        this.hostNow(true).then(()=>this.say("No open match right now, so you're hosting one. Other teams find it under Open matches.")); }
    };
    this.quickT=setInterval(look,400); look();
  },
  invited(code){
    try{ history.replaceState(null,"",location.pathname+location.search); }catch(e){}
    code=String(code||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5);
    this.show(true); $("#onpCode").value=code;
    this.say("You were invited to match "+code+". Put your team in and press Join.");
    this.connect();
  },
  copyInvite(){
    const url=location.origin+location.pathname+"#join="+Online.code;
    const done=()=>{ const b=$("#onpCopy"); b.textContent="Copied"; setTimeout(()=>{ b.textContent="Copy invite link"; },1500); };
    try{ navigator.clipboard.writeText(url).then(done,()=>prompt("The invite link:",url)); }catch(e){ prompt("The invite link:",url); }
  },
  /* This robot's light copy, packed for the other teams (they each fetch it once). */
  async modelReady(L){
    try{
      const gz=await netGzip(liteEncode(L)), h=await netHash(gz);
      if(gz.byteLength>NET_MODEL_MAX) return;
      Online.setModel(gz,h,L); this.packed=L; this.modelInfo={tris:L.tris, kb:Math.round(gz.byteLength/1024)};
      this.render();
    }catch(e){ console.warn("bench: packing the robot",e); }
  },
  opChanged(){ const me=Online.me(); if(me&&Online.state==="room"&&me.ready) Online.setReady(true,this.kind()); else this.render(); },

  /* what the session says */
  on(what){
    if(what==="start") this.begin();
    if(what==="error"){ this.say(Online.why||"The match ended.","warn"); resetMatch(); this.show(true); }
    if(what==="end"){ this.show(true); if(Sim.phase==="running") dsStop(); else updateDS(); }
    if(what==="room"||what==="error") updateDS();
    if(what==="room"&&this.was!==Online.state){
      // back from a match to the room, or out of it: the field is this bench's own again
      if((this.was==="done"||this.was==="playing")&&!Online.inMatch()) resetMatch();
      if(Online.state==="off"&&Online.T) Online.browse();
    }
    this.was=Online.state;
    this.render();
  },
  /* START: this robot to its place, INIT, and START with everyone when the countdown ends */
  begin(){
    if(Sim.phase==="running") Sim.stop();
    const slot=Online.mySlot();
    if(slot&&CODE&&CAD){
      setAlliance(netAl(slot),false,true);
      const p=netSlotPose(slot,footprintOf(CAD,OPTS.front));
      Sim.chassis={x:p.x, y:p.y, h:p.h}; Sim.vel={x:0,y:0}; OPTS.startPose=Object.assign({},p);
      initNow();
    }else resetMatch();
    updateDS(); this.render();
  },
  tick(){
    if(Online.playing()&&!Online.started&&Online.now()>=Online.startAt){
      Online.started=true;
      if(Online.mySlot()&&Sim.phase==="init"){ Sim.start(); updateDS(); }
    }
    if(Online.state==="joining"&&this.joinT&&performance.now()-this.joinT>15000){
      this.joinT=0; Online.leave();
      this.say("Nobody answered. Check the code; the host may have closed the room, or a network between you blocks direct connections.","warn");
    }
  },
  slow(){
    const st=Online.state, btn=$("#onlineBtn"), badge=$("#onlineBadge");
    btn.classList.toggle("on",st!=="off");
    badge.hidden=st==="off"; badge.textContent=st==="playing"?"LIVE":st==="done"?"FINAL":Online.code||"";
    if($("#onlinePanel").hidden) return;
    if(st==="playing"){ this.renderLive(); this.drawMap(); }
    if(st==="off") this.renderList();
  },

  /* ---- drawing the panel ---- */
  render(){
    const st=Online.state;
    $("#onpStart").hidden=st!=="off";
    $("#onpRoom").hidden=!(st==="room"||st==="joining");
    $("#onpPlay").hidden=st!=="playing";
    $("#onpEnd").hidden=st!=="done";
    $("#onpTalk").hidden=st==="off"||st==="joining";
    $("#onpFoot").hidden=st==="off";
    $("#onpTitle").textContent=st==="off"?"Play online":st==="joining"?"Joining…":st==="done"?"Match over":"Match "+Online.code;
    $("#onpSub").textContent=st==="off"?"":Online.role==="host"?"you're hosting":"";
    $("#onpLeave").textContent=st==="joining"?"Cancel":"Leave the match";
    if(st==="off") this.renderList();
    if(st==="room"||st==="joining") this.renderRoom();
    if(st==="playing") this.renderLive();
    if(st==="done") this.renderEnd();
    this.renderChat();
    this.slow();
  },
  renderList(){
    const L=Online.T?Online.openMatches():null;
    const html=!Online.T?`<li class="onp-empty">Opens when you go online</li>`:!L.length?`<li class="onp-empty">None right now. Host one, or use Quick match.</li>`:
      L.map(a=>`<li><div><b>${esc(a.name)}</b><small>${a.period==="Autonomous"?"Auto 0:30":"TeleOp 2:00"} · ${a.n} in the room · ${a.open} place${a.open===1?"":"s"} free</small></div>`+
        `<button class="btn-sm" type="button" data-code="${esc(a.code)}" data-hid="${esc(a.hid)}">Join</button></li>`).join("");
    setHTML($("#onpList"),html);
  },
  renderRoom(){
    const st=Online.state, me=Online.me(), host=Online.role==="host";
    $("#onpCodeShow").textContent=Online.code||"—";
    $("#onpCopy").hidden=st==="joining";
    if(st==="joining"){ setHTML($("#onpSlots"),`<p class="onp-watch">Asking the host's browser to let you in…</p>`); $("#onpReady").innerHTML=""; $("#onpHostCtl").hidden=true; $("#onpWatch").textContent=""; return; }
    const cards=NET_SLOTS.map(s=>{
      const id=Online.holder(s), p=id&&Online.players[id], al=netAl(s), mine=id===Online.self;
      const bot=mine?(Online.model?"":" · packing robot…"):(Online.modelFor(id)?" · robot here":" · robot coming");
      const who=p?`<b>${esc(p.name)}${mine?" (you)":""}</b><span class="st${p.ready?" ok":""}">${p.ready?"ready":"getting ready"}${p.host?" · host":""}${bot}</span>`:
        `<b class="ai">AI robot</b>`;
      const act=!p&&me?`<button class="btn-sm" type="button" data-slot="${s}">Take this place</button>`:mine?`<button class="btn-sm" type="button" data-slot="none">Just watch</button>`:"";
      return `<div class="onp-slot ${al}${mine?" me":""}"><small>${al.toUpperCase()} ${s.slice(-1)}</small>${who}${act}</div>`;
    });
    // red on the left, blue on the right, place 1 above place 2
    setHTML($("#onpSlots"),[cards[0],cards[2],cards[1],cards[3]].join(""));
    const watch=Object.values(Online.players).filter(p=>!p.slot).map(p=>esc(p.name)+(p.id===Online.self?" (you)":""));
    setHTML($("#onpWatch"),watch.length?"Watching: "+watch.join(", "):"");
    // this robot: the right kind of OpMode, then ready
    const want=Online.settings.period, have=CODE?this.kind():null;
    let r="";
    if(me&&me.slot){
      if(!CODE||!CAD) r=`<span class="bad">Load a robot and an OpMode first.</span>`;
      else if(have!==want) r=`<span class="bad">This match is ${want==="Autonomous"?"an Auto":"a TeleOp"}: pick ${want==="Autonomous"?"an Autonomous":"a TeleOp"} OpMode in the OpMode menu.</span>`;
      else r=`<span>“${esc(CODE.opmode||"OpMode")}”</span>`+(me.ready?`<button class="btn-sm" type="button" data-ready="0">Not ready</button>`:`<button class="btn-sm primary" type="button" data-ready="1">I'm ready</button>`);
    }
    setHTML($("#onpReady"),r);
    $("#onpHostCtl").hidden=!host;
    if(host){
      $$("#onpPeriod button").forEach(b=>b.classList.toggle("on",b.dataset.p===want));
      $("#onpSkill").value=Online.settings.skill; $("#onpPub").checked=Online.pub;
      $("#onpGo").disabled=!Online.canStart();
      $("#onpWait").textContent=Online.waitingFor().join(" · ");
    }
  },
  renderLive(){
    const slot=Online.mySlot(), cd=Online.countdown(), al=slot?netAl(slot):null, left=Math.max(0,Match.len-Match.t);
    const who=Object.values(Online.players).filter(p=>p.slot).map(p=>`<span class="${netAl(p.slot)}">${esc(p.name)}</span>`).join(" ");
    setHTML($("#onpLive"),(slot?`<b class="${al}">${al.toUpperCase()} ${slot.slice(-1)}</b>`:`<b>Watching</b>`)+
      `<span>${cd>0?"starts in "+Math.ceil(cd):clockText(Math.ceil(left))+" left"}</span>`+who);
    $("#onpMarkSeg").hidden=!slot;
    $("#onpPing").textContent=Online.role==="guest"&&Online.rtt?Math.round(Online.rtt)+" ms to the host":"";
  },
  renderEnd(){
    const F=Online.final; if(!F) return;
    const r=F.score.red.total, b=F.score.blue.total, al=Online.mySlot()?Online.myAl():null;
    const verdict=r===b?"A tie":(r>b?"Red":"Blue")+" wins"+(al?(al===(r>b?"red":"blue")?". Your alliance won.":". Your alliance lost."):"");
    const rows=F.stats.map(s=>`<tr class="${netAl(s.slot)}"><td>${esc(s.name)}</td><td class="n">${s.fired}</td><td class="n">${s.scored}</td></tr>`).join("");
    setHTML($("#onpFinal"),`<div class="onp-final"><div class="red"><b>${r}</b><small>RED</small></div><div class="blue"><b>${b}</b><small>BLUE</small></div></div>`+
      `<p class="onp-verdict">${esc(verdict)}</p><table class="onp-stats"><tr><th>Robot</th><th class="n">Shots</th><th class="n">In</th></tr>${rows}</table>`+
      (Online.role==="host"?"":`<p class="onp-wait">The host can start another match with everyone in the same places.</p>`));
    $("#onpAgain").hidden=Online.role!=="host";
  },
  renderChat(){
    const ol=$("#onpChat"), atEnd=ol.scrollTop+ol.clientHeight>=ol.scrollHeight-4;
    setHTML(ol,Online.chat.slice(-50).map(c=>`<li class="${c.al||""}">${c.team?"<i>alliance</i>":""}<b>${esc(c.name)}</b>${esc(c.text)}</li>`).join(""));
    if(atEnd) ol.scrollTop=ol.scrollHeight;
    const to=$("#onpTo"); to.disabled=!Online.mySlot(); if(!Online.mySlot()) to.value="all";
  },

  /* ---- the map: the field from above, the robots, the loose elements, the alliance's marks ---- */
  drawMap(){
    const cv=$("#onpMap"); if(!cv||!Field.ok||!cv.clientWidth) return;
    const dpr=window.devicePixelRatio||1, S=Math.round(cv.clientWidth*dpr);
    if(cv.width!==S){ cv.width=S; cv.height=S; }
    const c=cv.getContext("2d"), H=Field.half(), k=S/(2*H), X=x=>(x+H)*k, Y=y=>(H-y)*k;
    const font=this.font||(this.font=getComputedStyle(document.body).fontFamily);
    c.clearRect(0,0,S,S); c.fillStyle="#1b1c20"; c.fillRect(0,0,S,S);
    c.strokeStyle="rgba(255,255,255,.05)"; c.lineWidth=1;
    for(let i=1;i<6;i++){ const v=Math.round(i*S/6)+0.5; c.beginPath(); c.moveTo(v,0); c.lineTo(v,S); c.moveTo(0,v); c.lineTo(S,v); c.stroke(); }
    for(const al of ["red","blue"]){ const z=Match.zone(al);
      c.fillStyle=al==="red"?"rgba(216,84,74,.22)":"rgba(63,127,224,.22)"; c.fillRect(X(z.x0),Y(z.y1),(z.x1-z.x0)*k,(z.y1-z.y0)*k); }
    c.lineCap="round"; c.strokeStyle="rgba(214,211,200,.38)";
    if(!this.obs) this.obs=Field.obstacles(0.46);
    for(const o of this.obs){ c.lineWidth=Math.max(1.5,2*o.r*k); c.beginPath(); c.moveTo(X(o.a[0]),Y(o.a[1])); c.lineTo(X(o.b[0]),Y(o.b[1])); c.stroke(); }
    for(const e of Match.floor){ c.fillStyle=e.kind==="nectar"?(e.color==="red"?"#ff7a70":"#7fb0ff"):"#e2c24a";
      c.beginPath(); c.arc(X(e.x),Y(e.y),2.2*dpr,0,7); c.fill(); }
    const box=(x,y,h,hx,hy,al,me,label)=>{
      c.save(); c.translate(X(x),Y(y)); c.rotate(-h);
      c.fillStyle=me?(al==="red"?"#d8544a":"#3f7fe0"):(al==="red"?"rgba(216,84,74,.45)":"rgba(63,127,224,.45)");
      c.strokeStyle=me?"#fff":(al==="red"?"#e07a71":"#78a6ee"); c.lineWidth=(me?2:1.2)*dpr;
      c.fillRect(-hx*k,-hy*k,2*hx*k,2*hy*k); c.strokeRect(-hx*k,-hy*k,2*hx*k,2*hy*k);
      c.beginPath(); c.moveTo(0,0); c.lineTo(hx*k,0); c.stroke();
      c.restore();
      if(label){ c.fillStyle="rgba(255,255,255,.85)"; c.font=`${10*dpr}px ${font}`; c.textAlign="center";
        c.fillText(label,X(x),Y(y)-Math.max(hx,hy)*k-4*dpr); }
    };
    for(const b of Match.bots) box(b.x,b.y,b.h,MATCH_BOT.hx,MATCH_BOT.hy,b.al,false,"AI");
    for(const p of Match.players) box(p.x,p.y,p.h,p.hx,p.hy,p.al,false,p.name.slice(0,12));
    if(Online.mySlot()&&Sim.footprint){ const u=footBox(Sim.chassis,Sim.footprint); box(u.x,u.y,u.h,u.hx,u.hy,Online.myAl(),true,"you"); }
    const t=performance.now()/1000;
    for(const m of Online.liveMarks()){
      const col=m.what==="shoot"?"#f0b54a":m.what==="defend"?"#6fd3e0":"#ffffff", r=(7+2*Math.sin(t*5))*dpr;
      c.strokeStyle=col; c.lineWidth=2*dpr; c.beginPath(); c.arc(X(m.x),Y(m.y),r,0,7); c.stroke();
      c.fillStyle=col; c.font=`600 ${9.5*dpr}px ${font}`; c.textAlign="center";
      c.fillText(m.what==="shoot"?"shoot":m.what==="defend"?"defend":"go",X(m.x),Y(m.y)+r+10*dpr);
    }
  },
  mapClick(e){
    if(!Online.mySlot()||!Field.ok) return;
    const cv=$("#onpMap"), r=cv.getBoundingClientRect(), H=Field.half(), k=r.width/(2*H);
    Online.mark((e.clientX-r.left)/k-H,H-(e.clientY-r.top)/k,this.markKind);
  }
};

/* ============================================================
   MAIN LOOP
   ============================================================ */
let last=performance.now(), acc=0, slowAcc=0, loopErr=null, frameAt=0, slowN=0;
/* Keeping up: when frames come slower than ~38 a second for two seconds, draw
   fewer pixels; at the fewest, draw the robot's light copy (src/robotlite.js).
   Pixels come back when there's room again. */
const Perf={ema:16.7, t:0, pr:Math.min(devicePixelRatio||1,2), downAt:-1e9, quietTo:0, recovered:false,
  /* loading a robot (parsing, meshing) makes slow frames that say nothing about drawing */
  quiet(ms){ this.quietTo=Math.max(this.quietTo,performance.now()+(ms||15000)); this.ema=16.7; },
  frame(fd,now){
    if(!(fd>0&&fd<250)||now<this.quietTo) return;
    this.ema+=(fd-this.ema)*0.05;
    if(now-this.t<2000) return; this.t=now;
    const cap=Math.min(devicePixelRatio||1,2), min=Math.min(cap,0.75);
    if(this.ema>26){
      if(this.pr>min+0.01){ this.pr=Math.max(min,this.pr-0.25); this.set(); this.downAt=now; }
      else if(!View.lowGfx){ View.lowGfx=true; View.applyQuality(); }
    }else if(this.ema<18.5&&now-this.downAt>20000){
      // room to spare: the full robot back once (a computer that can't keep up goes back to light for good)
      if(View.lowGfx&&!this.recovered){ View.lowGfx=false; this.recovered=true; this.downAt=now; View.applyQuality(); }
      else if(this.pr<cap-0.01){ this.pr=Math.min(cap,this.pr+0.25); this.set(); }
    }
  },
  set(){ if(View.ren){ View.ren.setPixelRatio(this.pr); View.resize(); } }
};
/* innerHTML only when the markup differs: an identical string still costs a layout */
function setIfChanged(el,html){ if(el&&el.__html!==html){ el.__html=html; el.innerHTML=html; } }
/* on screen: in the page, not hidden, and laid out (a folded section or a closed tab has no box) */
function shown(sel){ const el=typeof sel==="string"?document.querySelector(sel):sel; return !!(el&&el.getClientRects().length); }
function guarded(fn){ try{ fn(); }catch(e){ if(!loopErr){ loopErr=e; console.error("bench:",e); } } }
function frame(now){
  Perf.frame(now-frameAt,now); frameAt=performance.now();
  const dt=Math.min(0.1,(now-last)/1000); last=now;
  guarded(()=>{
    Pads.poll();
    acc+=dt;
    stepFixed(8);
    NetUI.tick();
    View.update(); View.render(); updateGauges(); Pads.mirror();
  });
  slowAcc+=dt;
  if(slowAcc>=0.05){ slowAcc=0; guarded(()=>{
    Pads.meters();
    // 20 times a second: only what's on screen, and only when it changed (each
    // innerHTML is a layout; a folded or hidden panel needs none)
    Graph.sample(); Graph.draw(); Graph.updateLegendValues();          // draw() skips itself off screen
    if(shown("#dsPanel")) setIfChanged($("#dsPanel"),renderDS());
    updateClock(); updateConfigValues(); renderMatchHud();
    const pip=$("#pip");
    if(pip&&!pip.hidden&&!pip.classList.contains("closed")){ const m=renderMech();
      if(m){ setIfChanged($("#mech"),m.svg); $("#pipDeg").textContent=m.deg+"° off level"; } }
    const c=Sim.chassis||{x:0,y:0,h:0};
    const zone=Field.ok?Field.zoneAt(c.x/IN,c.y/IN):null;
    $("#vpPose").textContent=poseText(c)+(Sim.bump?` · against the ${Sim.bump}`:zone&&/LOADING|HIVE/.test(zone)?` · ${zone}`:"");
    shotTick(now);
    const anyDown=Object.keys(Sim.pad[activePad]).some(k=>Sim.pad[activePad][k]);
    const tp=$("#tickPill");
    tp.textContent=Sim.phase==="running"?(anyDown?"commanding":"holding"):Sim.phase==="init"?"init positions":"idle";
    const lp=$("#loopPill");
    lp.textContent=Sim.phase==="running"?Sim.t.toFixed(1)+" s · 50 Hz":Sim.phase; lp.className="pill"+(Sim.phase==="running"?" live":"");
    $$(".bindrow").forEach(r=>r.classList.toggle("active",!!Sim.pad[activePad][r.dataset.btn]));
    MathTab.tick(); if(slowN++%5===0) Status.render(); NetUI.slow();
  }); }
  requestAnimationFrame(frame);
}
// A hidden or covered window gets no animation frames (even one that says it's
// visible), and its page timers run once a second; an online match, a host's
// above all, has to go on at full rate. So it steps from a worker's timer while
// the frames are gone: a worker's timers aren't slowed that way. The mechanisms
// the others see are posed ten times a second meanwhile.
let bgViewT=0;
/* The sim and the online match in fixed 20 ms steps, as many as are due (at most max). */
function stepFixed(max){
  let n=0; while(acc>=0.02&&n++<max){ Sim.tick(0.02); Online.step(0.02,Sim); acc-=0.02; }
  if(acc>0.5) acc=0;
}
function backgroundStep(){
  if(Online.state==="off"||performance.now()-frameAt<300) return;
  guarded(()=>{
    const now=performance.now(); acc+=Math.min(2,(now-last)/1000); last=now;
    stepFixed(100);
    if(now-bgViewT>100){ bgViewT=now; View.update(); }
    NetUI.tick();
  });
}
(()=>{
  try{ const w=new Worker(URL.createObjectURL(new Blob(["setInterval(function(){postMessage(0)},20)"],{type:"text/javascript"})));
    w.onmessage=backgroundStep; return; }catch(e){}
  setInterval(backgroundStep,200);
})();

/* ============================================================
   PRO — one status light, the walkthrough, .ftcsim workspaces,
   GitHub import, the physics panel and the portfolio math sheet.
   Everything here stays quiet until it has something to say.
   ============================================================ */

/* ---------- the one light -------------------------------- */
const Status={
  cur:null,
  compute(){
    const rt={ stalled:[], missing:[], blocked:!!(Sim&&Sim.blocked), slipping:!!(Sim&&Sim.slipping),
               frontAcross:!!(CAD&&frontAcrossWheels(CAD,OPTS.front)) };
    return statusOf(FINDINGS,rt);
  },
  render(){
    const s=this.compute();
    const chip=$("#statusChip"); if(!chip) return;
    // the same count can hide a different list: one warning cleared and another raised
    const key=s.items.map(i=>i.level+":"+i.text).join("|");
    if(this.cur&&this.cur.level===s.level&&this.cur.label===s.label&&this.cur.key===key){ this.cur=Object.assign(s,{key}); return; }
    const wasWorse=this.cur&&s.rank>this.cur.rank;
    this.cur=Object.assign(s,{key});
    chip.className="status-chip "+s.level;
    $("#statusLabel").textContent=s.label;
    chip.title=s.headline;
    // the list says each one; the head only counts them, so it doesn't repeat the first row
    $("#statusHead").textContent=s.level==="go"?"Nothing to report":s.items.length>1?s.label:s.headline;
    setHTML($("#statusList"), s.items.length
      ? s.items.map((i,n)=>`<button class="row ${i.level}" data-go="${esc(i.where)}" data-n="${n}"><i></i><span>${esc(i.text)}</span></button>`).join("")
      : `<p class="ok">Code, CAD and configuration agree. Nothing is over its limit.</p>`);
    // only a new problem is allowed to interrupt; warnings never open themselves
    if(wasWorse&&s.level==="stop") this.open(true);
  },
  open(b){
    const p=$("#statusPanel"); if(!p) return;
    p.hidden=b===undefined?!p.hidden:!b;
    $("#statusChip").setAttribute("aria-expanded",String(!p.hidden));
  },
  wire(){
    $("#statusChip").addEventListener("click",()=>this.open());
    $("#statusClose").addEventListener("click",()=>this.open(false));
    $("#statusList").addEventListener("click",e=>{
      const b=e.target.closest("button[data-go]"); if(!b) return;
      const nav=$('.tabs[data-tabs="right"]'), tab=b.dataset.go==="robot"?"checks":b.dataset.go;
      if(b.dataset.go==="robot") selectTab($('.tabs[data-tabs="left"]'),"robot");
      else selectTab(nav,tab);
      this.open(false);
    });
    document.addEventListener("click",e=>{
      if(!$("#statusPanel").hidden&&!e.target.closest(".status-wrap")) this.open(false);
      if(!$("#sessionMenu").hidden&&!e.target.closest(".menu-wrap")) Menu.open(false);
    });
  },
};

const Menu={
  open(b){
    const m=$("#sessionMenu");
    m.hidden=b===undefined?!m.hidden:!b;
    $("#sessionBtn").setAttribute("aria-expanded",String(!m.hidden));
  },
};

/* ---------- the walkthrough ------------------------------ */
const Tour={
  i:0, hi:null,
  wire(){
    $("#helpBtn").addEventListener("click",()=>this.start(0));
    $("#tourClose").addEventListener("click",()=>this.close());
    $("#tourBack").addEventListener("click",()=>this.go(this.i-1));
    $("#tourNext").addEventListener("click",()=>{ if(this.i>=TOUR.length-1) this.close(); else this.go(this.i+1); });
    $("#tourSkip").addEventListener("change",e=>store.set("ftcbench.tour.seen",e.target.checked?"1":"0"));
    $("#tourOverlay").addEventListener("click",e=>{ if(e.target===$("#tourOverlay")) this.close(); });
    addEventListener("keydown",e=>{
      if($("#tourOverlay").hidden) return;
      if(e.key==="Escape") this.close();
      else if(e.key==="ArrowRight") this.go(this.i+1);
      else if(e.key==="ArrowLeft") this.go(this.i-1);
    });
    setHTML($("#tourDots"),TOUR.map(()=>"<i></i>").join(""));
    // offered, not forced: a small link on the field until the tour has been seen once
    const chip=$("#vpTour");
    if(chip){ chip.hidden=store.get("ftcbench.tour.seen","0")==="1"; chip.addEventListener("click",()=>this.start(0)); }
  },
  start(n){ $("#tourOverlay").hidden=false; $("#tourSkip").checked=store.get("ftcbench.tour.seen","0")==="1"; this.go(n); },
  close(){
    $("#tourOverlay").hidden=true; this.light(null);
    store.set("ftcbench.tour.seen","1");
    const chip=$("#vpTour"); if(chip) chip.hidden=true;
  },
  go(n){
    this.i=Math.max(0,Math.min(TOUR.length-1,n));
    const s=TOUR[this.i];
    $("#tourStep").textContent=(this.i+1)+" / "+TOUR.length;
    $("#tourTitle").textContent=s.title;
    setHTML($("#tourBody"),s.body);
    $("#tourTip").textContent=s.tip||"";
    $("#tourTip").hidden=!s.tip;
    $("#tourBack").disabled=this.i===0;
    $("#tourNext").textContent=this.i===TOUR.length-1?"Get started":"Next";
    $$("#tourDots i").forEach((d,k)=>d.classList.toggle("on",k===this.i));
    if(s.tab){
      const side=["teleop","java","robot","tune"].indexOf(s.tab)>=0?"left":"right";
      const nav=$(`.tabs[data-tabs="${side}"]`);
      if(nav&&nav.querySelector(`button[data-tab="${s.tab}"]`)) selectTab(nav,s.tab);
    }
    this.light(s.target?$(s.target):null);
  },
  light(el){
    if(this.hi) this.hi.classList.remove("tour-hi");
    this.hi=el; if(el) el.classList.add("tour-hi");
  },
};

/* ---------- .ftcsim workspaces --------------------------- */
function download(name,text,mime){
  const blob=new Blob([text],{type:mime||"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
}
const Session={
  name(){ return ((CAD&&CAD.name)||"robot").replace(/\.(step|stp)$/i,"").replace(/[^\w.-]+/g,"-")+".ftcsim"; },
  save(){
    if(typeof packSession!=="function"||!CAD){ this.toast("nothing to save yet"); return; }
    const e=entry(CURRENT_ID);
    const text=packSession(sessionFromBench({
      cad:CAD, code:CODE, java:e?e.source:"", opName:e?e.file:"", map:MAP, opts:OPTS,
      chassis:Sim.chassis, alliance:Shots.alliance, rig:exportRig(),
      savedISO:new Date().toISOString(),
    }));
    download(this.name(),text,"application/json");
    this.toast("saved "+this.name()+" · "+(text.length/1048576).toFixed(1)+" MB");
  },
  take(file){
    readText(file,text=>{
      const r=unpackSession(text);
      if(!r.ok){ this.toast("that .ftcsim wouldn't open — "+r.error); return; }
      this.apply(r.session,file.name);
    },m=>this.toast(m));
  },
  apply(s,fileName){
    try{
      if(s.cad){
        const cad=s.cad; cad.name=cad.name||fileName;
        classifyMechs(cad.mechs);
        loadCAD(cad,(cad.name||fileName)+" · from workspace","ok");
      }
      // the file name if the workspace kept one, else what the OpMode calls itself
      if(s.java) addOpModeFromText(s.opName||((s.code&&s.code.opmode)||"Workspace").replace(/[^\w.-]+/g,"")+".java",s.java);
      if(s.map&&Object.keys(s.map).length) { MAP=s.map; rebuild(); }
      if(s.opts){ for(const k of ["payloadKg","duty","trust","front","baseModel","shooterModel","mu","physics"]) if(s.opts[k]!==undefined) OPTS[k]=s.opts[k]; syncOptionControls(); Physics.sync(); }
      if(s.alliance) setAlliance(s.alliance,false);
      if(s.chassis&&isFinite(s.chassis.x)){
        Sim.chassis={x:s.chassis.x,y:s.chassis.y,h:s.chassis.h||0};
        if(Field.ok&&Sim.footprint) Field.collide(Sim.chassis,Sim.footprint,Sim.obstacles);
        OPTS.startPose=Object.assign({},Sim.chassis);
      }
      this.toast("opened "+(fileName||"workspace")+(s.saved?" · saved "+String(s.saved).slice(0,10):""));
    }catch(e){ this.toast("that workspace didn't load — "+e.message); }
  },
  toast(msg){
    const el=$("#cadStatus"); if(el) el.textContent=msg;
  },
};

/* ---------- import from GitHub --------------------------- */
const GH={
  open(b){
    $("#ghOverlay").hidden=b===false;
    if(b!==false) setTimeout(()=>$("#ghUrl").focus(),30);
  },
  say(msg,bad){ const s=$("#ghStatus"); s.textContent=msg; s.className="gh-status"+(bad?" bad":""); },
  async find(){
    const ref=parseRepoRef($("#ghUrl").value);
    if(!ref){ this.say("that doesn't look like a public GitHub repo or .java file",true); return; }
    const urls=rawUrlsFor(ref);
    setHTML($("#ghList"),"");
    this.say("looking in "+ref.owner+"/"+ref.repo+" …");
    try{
      if(ref.kind==="file"){ await this.take(urls.raw(ref.path),ref.path); return; }
      const res=await fetch(urls.tree,{headers:{Accept:"application/vnd.github+json"}});
      if(res.status===403){ this.say("GitHub is rate-limiting this browser — try again in a few minutes, or paste a link to the .java file itself",true); return; }
      if(!res.ok){ this.say("GitHub said "+res.status+" — is the repository public?",true); return; }
      const tree=await res.json();
      const files=pickOpModes(tree.tree||[],{under:ref.path});
      if(!files.length){ this.say("no .java files in there",true); return; }
      this.say(files.length+" Java file"+(files.length===1?"":"s")+" — pick one to load");
      setHTML($("#ghList"),files.map((f,i)=>
        `<button type="button" data-i="${i}"><b>${esc(f.name)}</b><span>${esc(f.path)}</span>${f.sample?'<span class="tag">sample</span>':""}</button>`).join(""));
      $("#ghList").onclick=e=>{ const b=e.target.closest("button[data-i]"); if(!b) return;
        const f=files[+b.dataset.i]; this.take(urls.raw(f.path),f.path); };
    }catch(e){ this.say("couldn't reach GitHub — "+e.message,true); }
  },
  async take(url,path){
    this.say("fetching "+path+" …");
    try{
      const r=await fetch(url);
      if(!r.ok){ this.say("couldn't fetch that file ("+r.status+")",true); return; }
      const src=await r.text();
      if(src.length>400000){ this.say("that file is suspiciously large",true); return; }
      addOpModeFromText(path.split("/").pop(),src);
      if(!javaLooksLikeOpMode(src)) this.say("loaded, but that file has no @TeleOp or @Autonomous — the bench may find nothing to run",true);
      else { this.open(false); }
    }catch(e){ this.say("couldn't fetch that file — "+e.message,true); }
  },
  wire(){
    $("#importGh").addEventListener("click",()=>{ Menu.open(false); this.open(true); });
    $("#ghClose").addEventListener("click",()=>this.open(false));
    $("#ghGo").addEventListener("click",()=>this.find());
    $("#ghUrl").addEventListener("keydown",e=>{ if(e.key==="Enter") this.find(); });
    $("#ghOverlay").addEventListener("click",e=>{ if(e.target===$("#ghOverlay")) this.open(false); });
    const last=store.get("ftcbench.gh.last","");
    if(last) $("#ghUrl").value=last;
    $("#ghUrl").addEventListener("change",e=>store.set("ftcbench.gh.last",e.target.value));
  },
};

/* ---------- physics panel -------------------------------- */
const Physics={
  props:null,
  recompute(){
    if(typeof massProps!=="function"||!CAD){ this.props=null; return null; }
    try{ this.props=massProps(CAD,{payloadKg:OPTS.payloadKg}); }catch(e){ this.props=null; }
    if(this.props) Sim.props=this.props;
    return this.props;
  },
  sync(){
    $$("#physSeg button").forEach(b=>b.classList.toggle("on",b.dataset.phys===(OPTS.physics||"rigid")));
    const mu=OPTS.mu==null?0.9:OPTS.mu;
    $("#muSlider").value=mu; $("#muVal").textContent=mu.toFixed(2);
    this.recompute();
    // show what the simulation is actually running on, not a second opinion
    const p=(Sim.rig&&Sim.rig.props)||this.props, pill=$("#physPill");
    if(!p){ pill.textContent="—"; setHTML($("#massRead"),'<i>No mass properties yet — load a CAD assembly with solid parts.</i>'); return; }
    pill.textContent=!Sim.rig?"no drivetrain":(OPTS.physics==="kinematic"?"kinematic":"rigid body");
    const cadDrive=safeDrive(), drawn=!(cadDrive&&cadDrive.kind!=="unknown")&&!!(Sim.rig&&Sim.rig.drive);
    const d=driveInUse();
    const mm=v=>(v*1000).toFixed(0)+" mm";
    setHTML($("#massRead"),[
      `<span>mass <b>${p.kg.toFixed(2)} kg</b>${p.assumed?' <i>assumed — the CAD has no solid parts to weigh</i>':""}</span>`,
      `<span>COM <b>${mm(p.com.x)}, ${mm(p.com.y)}</b> <i>${CAD&&CAD.frame&&CAD.frame.originWhy==="wheels"?"from the drivetrain centre":"from the robot's centre"}</i></span>`,
      `<span>height <b>${mm(p.comHeight==null?p.com.z:p.comHeight)}</b></span>`,
      `<span>I<sub>zz</sub> <b>${p.Izz.toFixed(3)}</b> <i>kg·m²</i></span>`,
      d?`<span>drive <b>${esc(d.kind)}</b> <i>${(d.wheels||[]).length} wheels · ${drawn?"placed from your code":Math.round((d.confidence||0)*100)+"% sure from the CAD"}</i></span>`:"",
      (p.confidence!=null&&!p.assumed)?`<span><i>mass confidence ${Math.round(p.confidence*100)} %</i></span>`:"",
    ].join(""));
  },
  wire(){
    $("#physSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
      OPTS.physics=b.dataset.phys; store.set("ftcbench.physics",OPTS.physics); this.sync(); reloadSim(); });
    $("#muSlider").addEventListener("input",e=>{ OPTS.mu=+e.target.value; $("#muVal").textContent=OPTS.mu.toFixed(2);
      store.set("ftcbench.mu",String(OPTS.mu)); if(Sim.rig) Sim.rig.mu=OPTS.mu; });
  },
};
/* The drivetrain the bench is actually driving: what the CAD gave us when it
   recognised one, otherwise the base the simulator built from your code. */
function driveInUse(){
  const cad=safeDrive();
  if(cad&&cad.kind&&cad.kind!=="unknown") return cad;
  return (Sim.rig&&Sim.rig.drive)||cad||null;
}
let DRIVE_CACHE={key:null,val:null};
function safeDrive(){
  const key=(CAD&&CAD.name)+"|"+(CAD&&CAD.solids?CAD.solids.length:0)+"|"+OPTS.front;
  if(DRIVE_CACHE.key===key) return DRIVE_CACHE.val;
  let val=null;
  try{ val=driveFromCAD(CAD,{front:OPTS.front}); }catch(e){ val=null; }
  DRIVE_CACHE={key,val};
  return val;
}

/* ---------- the math sheet ------------------------------- */
const MathTab={
  dirty:true, report:null,
  invalidate(){ this.dirty=true; },
  /* The math has to describe the robot the bench is actually running — the
     same mass and the same wheels, assumptions included. */
  bench(){
    return { cad:CAD, code:CODE, map:MAP, opts:OPTS, sim:Sim, shots:Shots, field:Field,
             mass:(Sim.rig&&Sim.rig.props)||Physics.props,
             drive:driveInUse() };
  },
  build(){
    if(typeof mathReport!=="function") return null;
    try{ this.report=mathReport(this.bench()); }catch(e){ this.report={sections:[{id:"err",title:"Couldn't build the math",rows:[{label:"error",value:e.message}]}]}; }
    this.dirty=false;
    return this.report;
  },
  tick(){ if(this.dirty&&paneVisible("math")) this.render(); },
  render(){
    const r=this.build();
    if(!r){ setHTML($("#mathBody"),'<div class="msec"><p class="intro">The math exporter isn\'t in this build.</p></div>'); return; }
    const rows=(r.sections||[]).reduce((n,s)=>n+((s.rows||[]).length),0);
    $("#mathPill").textContent=rows+" line"+(rows===1?"":"s");
    setHTML($("#mathBody"),(r.sections||[]).map(s=>
      `<div class="msec${s.warn?" warn":""}">
         <h4>${esc(s.title||s.id||"")}</h4>
         ${s.intro?`<p class="intro">${esc(s.intro)}</p>`:""}
         ${(s.rows||[]).map(w=>`<div class="mrow">
            <div class="lbl">${esc(w.label||"")}${w.source?`<span class="src">${esc(w.source)}</span>`:""}</div>
            <div class="val">${esc(w.value==null?"":(typeof w.value==="number"?mdNum(w.value,3):String(w.value)))}${w.unit?" "+esc(w.unit):""}</div>
            ${w.expr?`<div class="expr">${esc(w.expr)}</div>`:""}
            ${w.note?`<div class="note">${esc(w.note)}</div>`:""}
          </div>`).join("")}
       </div>`).join(""));
  },
  text(){ const r=this.build(); return r&&typeof mathText==="function"?mathText(r):""; },
  md(){ const r=this.build(); return r&&typeof mathMarkdown==="function"?mathMarkdown(r):this.text(); },
  wire(){
    $("#mathCopy").addEventListener("click",()=>{
      const t=this.text(), b=$("#mathCopy");
      const done=ok=>{ b.textContent=ok?"Copied":"Couldn't copy"; setTimeout(()=>{ b.textContent="Copy"; },1400); };
      if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(()=>done(true),()=>done(false));
      else done(false);
    });
    const dl=()=>download(((CAD&&CAD.name)||"robot").replace(/\.(step|stp)$/i,"")+"-math.md",this.md(),"text/markdown;charset=utf-8");
    $("#mathDl").addEventListener("click",dl);
    $("#exportMath").addEventListener("click",()=>{ Menu.open(false); dl(); });
  },
};

/* ---------- Pro boot ------------------------------------- */
function proBoot(){
  OPTS.physics=store.get("ftcbench.physics","rigid")==="kinematic"?"kinematic":"rigid";
  OPTS.mu=+store.get("ftcbench.mu","0.9")||0.9;
  Status.wire(); Tour.wire(); GH.wire(); Physics.wire(); MathTab.wire();
  $("#sessionBtn").addEventListener("click",()=>Menu.open());
  $("#saveSession").addEventListener("click",()=>{ Menu.open(false); Session.save(); });
  $("#openSession").addEventListener("click",()=>{ Menu.open(false); $("#sessionFile").click(); });
  $("#sessionFile").addEventListener("change",e=>{ const f=e.target.files[0]; if(f) Session.take(f); e.target.value=""; });
  addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){ e.preventDefault(); Session.save(); }
    if(e.key==="Escape"&&!$("#ghOverlay").hidden) GH.open(false);
  });
  // Up: auto reads it from the wheels; set it by hand for a robot with none
  const syncUp=()=>$$("#upSeg button").forEach(b=>b.classList.toggle("on",(b.dataset.up||undefined)===OPTS.up));
  $("#upSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    OPTS.up=b.dataset.up||undefined; syncUp();
    if(CAD){ SETUP.done.up=true; saveRig(); }
    if(LAST_STEP) parseAndLoad();
    else $("#frameNote").textContent="Up can be changed for a STEP file you drop in; the built-in sample is already Z-up."; });
  syncUp(); renderFrameNote();
  Physics.sync(); Status.render();
}

/* ============================================================
   BOOT
   ============================================================ */
(function boot(){
  setTheme(store.get("ftcbench.theme","dark")==="light"?"light":"dark");
  $("#themeBtn").addEventListener("click",()=>setTheme(currentTheme()==="dark"?"light":"dark"));
  // the BIOBUZZ field and shot physics, from the vendored Shot Sim
  Field.init(window.ShotEngine,window.SHOT_DATA);
  let al=store.get("ftcbench.alliance","red");
  try{ const qa=new URLSearchParams(location.search).get("alliance"); if(qa==="red"||qa==="blue") al=qa; }catch(e){}
  Shots.alliance=View.alliance=al==="blue"?"blue":"red";
  ShotUI.arc=store.get("ftcbench.arc","1")!=="0"; $("#arcToggle").checked=ShotUI.arc;
  View.init($("#viewport"));
  View.setView("iso");
  initTabs(); initCollapsibles(); initRails();
  Editor.init(); Pads.init();
  initLibrary();
  // drag the robot anywhere on the field; it still can't pass through the HIVE or the walls
  View.onRobotDrag=p=>{
    const ch={x:p.x, y:p.y, h:p.h};
    if(Field.ok&&Sim.footprint) Field.collide(ch,Sim.footprint,Sim.obstacles);
    Sim.chassis=ch; Sim.vel={x:0,y:0}; OPTS.startPose=Object.assign({},ch);
  };
  View.onHover=over=>{ $("#vpTip").hidden=!over; };

  try{ const rc=JSON.parse(store.get("ftcbench.robotconfig","null")); if(rc&&rc.text){ OPTS.robotConfig=parseRobotConfig(rc.text); ROBOT_CFG_NAME=rc.name;
    $("#cfgStatus").textContent=rc.name+" · "+OPTS.robotConfig.devices.length+" devices"; $("#cfgDrop").className="drop ok"; $("#cfgClear").hidden=false; } }catch(e){}

  const sample=JSON.parse(JSON.stringify(SAMPLE_CAD));
  sample.points=synthGeometry();
  sample.solids=sampleSolids();
  classifyMechs(sample.mechs);
  loadCAD(sample,"sample: fulll.step (measured)","ok");

  const saved=store.get("ftcbench.current",null);
  selectOpMode(entry(saved)?saved:"sample-claw");
  renderCompareSelects();

  // Driver Station
  $("#btnInit").addEventListener("click",dsInit);
  $("#btnStart").addEventListener("click",dsStart);
  $("#btnStop").addEventListener("click",dsStop);
  $("#opSelect").addEventListener("change",e=>selectOpMode(e.target.value));
  $("#practice").checked=store.get("ftcbench.practice","0")==="1";
  $("#matchOn").checked=store.get("ftcbench.match","1")==="1";
  const mb=$("#matchBtn"), mm=$("#matchMenu"), matchDot=()=>mb.classList.toggle("on",$("#matchOn").checked);
  const openMatch=o=>{ mm.hidden=!o; mb.setAttribute("aria-expanded",String(o)); };
  mb.addEventListener("click",e=>{ e.stopPropagation(); openMatch(mm.hidden); });
  document.addEventListener("click",e=>{ if(!mm.hidden&&!e.target.closest(".match-wrap")) openMatch(false); });
  addEventListener("keydown",e=>{ if(e.key==="Escape"&&!mm.hidden) openMatch(false); });
  $("#matchOn").addEventListener("change",matchDot); matchDot();
  $("#matchSkill").value=store.get("ftcbench.matchSkill","typical");
  $("#matchOn").addEventListener("change",e=>{ store.set("ftcbench.match",e.target.checked?"1":"0"); if(Online.inMatch()) return; if(Sim.phase!=="running") resetMatch(); else { Match.on=e.target.checked; if(!Match.on) resetMatch(); } });
  $("#matchSkill").addEventListener("change",e=>{ store.set("ftcbench.matchSkill",e.target.value); if(Online.inMatch()) return; if(Sim.phase!=="running") resetMatch(); else Match.skill=e.target.value; });
  $("#practice").addEventListener("change",e=>{ store.set("ftcbench.practice",e.target.checked?"1":"0"); updateClock(); });
  NetUI.init(); SetupUI.init(); OnshapeHelp.init();

  // code
  $("#addOpMode").addEventListener("click",()=>$("#codeFile").click());
  $("#codeFile").addEventListener("change",e=>{ [].forEach.call(e.target.files,takeCode); e.target.value=""; });
  $("#reparse").addEventListener("click",()=>{
    const e=entry(CURRENT_ID); if(!e) return;
    e.source=$("#srcbox").value; parseEntry(e);
    if(!e.builtin) saveLibrary();
    selectOpMode(e.id);
  });

  // hardware
  // the robot: a STEP, an Onshape .onshape.json, or a URDF with its meshes
  wireDrop($("#cadDrop"),$("#cadFile"),f=>/\.(urdf|stl|json)$/i.test(f.name)?routeFile(f):takeCAD(f),true);
  wireDrop($("#cfgDrop"),$("#cfgFile"),takeRobotConfig);
  wireMates();
  wirePageDrop();
  $("#cfgClear").addEventListener("click",()=>{
    OPTS.robotConfig=null; ROBOT_CFG_NAME=null; store.del("ftcbench.robotconfig");
    $("#cfgStatus").textContent="From the FIRST folder on the Control Hub. Every hardwareMap name gets checked.";
    $("#cfgDrop").className="drop"; $("#cfgClear").hidden=true; analyzeAll();
  });
  $("#trustSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    OPTS.trust=b.dataset.trust; syncOptionControls(); rebuild(); saveRig(); });

  // rig
  $("#turretSlider").addEventListener("input",e=>{ View.turretScale=+e.target.value/100; $("#turretVal").textContent=e.target.value+" %"; View.load(CAD); saveRig(); });
  $("#addJoint").addEventListener("click",addManualJoint);
  $("#rigCopy").addEventListener("click",()=>{
    const txt=JSON.stringify(exportRig(),null,1); $("#rigJson").value=txt;
    const done=ok=>{ const b=$("#rigCopy"); b.textContent=ok?"Copied":"Select & copy"; setTimeout(()=>{ b.textContent="Copy"; },1400); };
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(()=>done(true),()=>{ $("#rigJson").select(); done(false); });
    else { $("#rigJson").select(); done(false); }
  });
  $("#rigApply").addEventListener("click",()=>{
    const b=$("#rigApply");
    try{
      const r=JSON.parse($("#rigJson").value);
      if(r.format!=="ftc-sim-bench.rig") throw new Error("not a rig document");
      applyRig(r); applyDeviceMemory(); View.load(CAD); rebuild(); saveRig();
      b.textContent="Applied"; setTimeout(()=>{ b.textContent="Apply"; },1400);
    }catch(err){ b.textContent="Not a rig"; setTimeout(()=>{ b.textContent="Apply"; },1800); }
  });
  $("#rigReset").addEventListener("click",()=>{
    store.del(rigKey()); HW_USER={}; RIG_DEVICES={};
    if(MATES.report){ applyMates(); return; }   // the mates are the rig
    if(JOINTS.report){ applyJoints(); return; } // and so is a joint spec
    for(const m of CAD.mechs){ m.kind=m.hasActuator===false?"fixed":null; m.leverOverride=null; m.label=null; }
    CAD.mechs=CAD.mechs.filter(m=>!m.manual);
    classifyMechs(CAD.mechs);
    if(CODE) MAP=autoMap(CODE.devices,CAD.mechs,{cad:CAD});
    rigChanged();
  });

  // config
  $("#massSlider").addEventListener("input",e=>{ OPTS.payloadKg=+e.target.value/1000; $("#massVal").textContent=e.target.value+" g"; analyzeAll(); saveRig(); });
  $("#dutySlider").addEventListener("input",e=>{ OPTS.duty=+e.target.value/100; $("#dutyVal").textContent=e.target.value+" %"; analyzeAll(); saveRig(); });

  // stage & dock
  $("#viewSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    $$("#viewSeg button").forEach(x=>x.classList.toggle("on",x===b));
    if(b.dataset.v==="cad") CadView.enter(); else { CadView.exit(); View.setView(b.dataset.v); } });
  $("#resetPose").addEventListener("click",placeAtStart);
  wireShotTab();
  $("#padSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(b) setActivePad(+b.dataset.pad); });

  // graph & compare
  $("#winSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    Graph.win=+b.dataset.w; $$("#winSeg button").forEach(x=>x.classList.toggle("on",x===b)); Graph.draw(); });
  $("#graphPause").addEventListener("click",()=>{ Graph.paused=!Graph.paused; Graph.pausedAt=Graph.paused?Graph.now():null;
    $("#graphPause").textContent=Graph.paused?"Resume":"Pause"; });
  $("#graphClear").addEventListener("click",()=>Graph.reset());
  $("#cmpA").addEventListener("change",renderCompare);
  $("#cmpB").addEventListener("change",renderCompare);

  addEventListener("resize",()=>{ View.resize(); Graph.draw(); });
  if(typeof ResizeObserver!=="undefined") new ResizeObserver(()=>View.resize()).observe($("#viewport"));

  /* Link straight into a state: ?opmode=sample-auto&start=1&view=field&right=graph
     — for demo links in a README, or sharing "look at this" with a teammate. */
  try{
    const q=new URLSearchParams(location.search);
    if(q.get("opmode")&&entry(q.get("opmode"))) selectOpMode(q.get("opmode"));
    // ?pose=-40,-30,29 — a spot on the field in inches and a heading in degrees
    const ps=(q.get("pose")||"").split(",").filter(s=>s!=="").map(Number);
    if(ps.length>=2&&ps.every(isFinite)){
      Sim.chassis={x:ps[0]*IN, y:ps[1]*IN, h:(ps[2]||0)*Math.PI/180};
      if(Field.ok&&Sim.footprint) Field.collide(Sim.chassis,Sim.footprint,Sim.obstacles);
      OPTS.startPose=Object.assign({},Sim.chassis);
    }
    const v=q.get("view");
    if(v&&/^(iso|front|side|top|field|cad)$/.test(v)){ if(v==="cad") CadView.enter(); else View.setView(v); $$("#viewSeg button").forEach(x=>x.classList.toggle("on",x.dataset.v===v)); }
    ["left","right"].forEach(side=>{ const t=TAB_RENAMED[q.get(side)]||q.get(side), nav=$(`.tabs[data-tabs="${side}"]`);
      if(t&&nav&&nav.querySelector(`button[data-tab="${t}"]`)) selectTab(nav,t); });
    if(q.get("start")==="1") dsStart();
  }catch(e){}

  proBoot();
  saveRig();
  RAILS_READY=true;
  requestAnimationFrame(frame);
  try{
    if(/^#join=/i.test(location.hash)) NetUI.invited(location.hash.slice(6));
    if(/^#onshape=/.test(location.hash)) takeOnshapeHash();
    else if(/^#onshape-wait/.test(location.hash)) waitForOnshape();
    else if(new URLSearchParams(location.search).get("robot")!=="sample") loadDefaultRobot();
  }catch(e){}
})();
