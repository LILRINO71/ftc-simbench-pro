/* ============================================================
   THE IMPORT FLOW — getting a robot in, and knowing it is right
   ------------------------------------------------------------
   One card over the field says, at every moment, the one thing to do next:

     bring      no robot of the team's own yet: paste the Onshape assembly's
                address (read through Sign in with Onshape, src/onshapelink.js,
                in the engine worker), or drop the export zip or any file
     busy       reading it: one bar, plain words, the robot appears when done
     code       a robot, no code: drop the .java files or paste a GitHub repo
     review     both: what the bench worked out (up, front, drive base, mass,
                joints, which device drives what) as facts, and the few things
                only the team can answer as one-click questions, each with a
                "show me" that moves the part in the CAD view
     done       nothing left to ask; the card goes away until something changes
     sheet      the joint sheet (src/jointsheet.js): which joints move and what
                drives each, said once so nothing is guessed, and the names to
                give the mates in Onshape so the next export says it by itself

   Nothing here decides anything about the robot: src/bind.js binds devices,
   src/robotcheck.js checks, src/engineworker.js reads. This only draws, and
   answers a click with the one engine call it stands for.
   ============================================================ */
const ImportFlow={
  state:"bring", dismissed:false, busy:null, code:null, last:null, sheetOpen:false, draft:null, showAll:false, showNames:false,
  signin:{ready:null, signedIn:false}, pendingLink:null, tip:"", tipBad:false,
  init(){
    const card=$("#importCard"); if(!card) return;
    card.addEventListener("click",e=>this.click(e));
    card.addEventListener("input",e=>this.sheetInput(e));
    card.addEventListener("change",e=>this.sheetInput(e));
    card.addEventListener("submit",e=>{ e.preventDefault(); const f=e.target;
      if(f.id==="icGh"){ $("#ghUrl").value=$("#icGhUrl").value; GH.find().then(()=>{ if(!$("#ghOverlay").hidden) return; }); GH.open(true); }
      if(f.id==="icLink") this.fromLink();
    });
    // the sign-in window says how it went (functions/onshape callback page)
    addEventListener("message",e=>{ if(e.origin===location.origin&&e.data&&e.data.type==="simbench-onshape-signin") this.signedIn(!!e.data.ok,String(e.data.msg||"")); });
    this.refreshSignIn().then(()=>{ if(this.state==="bring") this.render(); });
    // the drop target inside the card takes anything the page takes
    card.addEventListener("dragover",e=>{ e.preventDefault(); const d=e.target.closest(".ic-drop"); if(d) d.classList.add("armed"); });
    card.addEventListener("dragleave",e=>{ const d=e.target.closest(".ic-drop"); if(d) d.classList.remove("armed"); });
    card.addEventListener("drop",e=>{ e.preventDefault(); e.stopPropagation(); document.body.classList.remove("dragging"); card.querySelectorAll(".ic-drop").forEach(d=>d.classList.remove("armed"));
      [].forEach.call((e.dataTransfer&&e.dataTransfer.files)||[],routeFile); });
    for(const id of ["importOpen","vpOnshape"]){ const b=$("#"+id); if(b) b.addEventListener("click",()=>this.open()); }
    const chip=$("#vpSetup"); if(chip) chip.addEventListener("click",()=>this.open(),{capture:true});
  },
  /* which card, from what the bench has */
  compute(){
    if(this.busy) return "busy";
    const own=(()=>{ try{ return ownRobot()||!!(CAD&&(CAD.source==="onshape"||CAD.source==="urdf")); }catch(e){ return false; } })();
    if(!own) return store.get("ftcbench.import.seen","0")==="1"&&!this.forced?"done":"bring";
    if(this.dismissed===CAD) return "done";                 // "Not now" closes any card for this robot
    if(!CODE||!(CODE.devices||[]).length) return "code";
    // the team's own robot with a sample OpMode still selected: binding the sample's devices to
    // their joints would only raise questions about a robot the sample was never written for
    if(this.sampleOk!==CAD&&typeof entry==="function"&&typeof CURRENT_ID!=="undefined"){ const e=entry(CURRENT_ID); if(e&&e.builtin) return "code"; }
    const A=SetupUI.auto(), allSetup=SETUP_STEPS.every(k=>SetupUI.isDone(k,A));
    const rc=RC, bind=this.bind();
    const asks=(rc?rc.need+rc.warn:0)+(bind?bind.open.length:0);
    return asks||!allSetup?"review":"done";
  },
  bind(){
    if(!CODE||!CAD) return null;
    try{ return bindDevices(CODE,CAD,{explicit:(JOINTS.report&&CAD.mates&&CAD.mates.source==="spec"&&JOINTS.devices)||{}, isCommanded:n=>isCommanded(CODE,n)}); }
    catch(e){ return null; }
  },
  open(){ this.dismissed=false; this.forced=true; this.render(true); const c=$("#importCard"); if(c) c.scrollTop=0; },
  close(){ this.dismissed=CAD||true; this.forced=false; store.set("ftcbench.import.seen","1"); this.render(); },
  /* a job is running: the bar, in plain words */
  start(title,sub){ this.busy={title, text:"", frac:null, sub:sub||""}; this.render(); },
  progress(text,done,total){ if(!this.busy) return; this.busy.text=String(text||""); this.busy.frac=Number.isFinite(done)&&Number.isFinite(total)&&total>0?done/total:null; this.renderBusy(); },
  finish(){ this.busy=null; this.render(); },
  fail(msg){ this.busy=null; this.last={bad:msg}; this.render(); },

  render(force){
    const card=$("#importCard"); if(!card) return;
    const st=this.compute();
    if(st==="done"&&!force&&!this.sheetOpen){ card.hidden=true; this.state=st; this.chip(); return; }
    this.state=st==="done"?"review":st;
    if(this.sheetOpen&&CAD&&st!=="busy"&&st!=="bring") this.state="sheet";
    card.hidden=false;
    card.classList.toggle("wide",this.state==="sheet");
    const h=this.state==="bring"?this.htmlBring():this.state==="busy"?this.htmlBusy():this.state==="code"?this.htmlCode():this.state==="sheet"?this.htmlSheet():this.htmlReview();
    setIfChanged(card,h);
    this.chip();
  },
  renderBusy(){ const m=$("#icMeter"), t=$("#icProg"); if(!m||!this.busy) return;
    m.className="ic-meter"+(this.busy.frac==null?" busy":""); if(this.busy.frac!=null) m.firstElementChild.style.width=Math.round(Math.max(.04,Math.min(1,this.busy.frac))*100)+"%";
    if(t) t.textContent=this.busy.text||this.busy.title; },
  /* the field's chips: offer the card when it isn't showing and there's something to do */
  chip(){
    const hidden=$("#importCard").hidden;
    const c=$("#vpSetup"); if(c) c.hidden=!(hidden&&this.compute()==="review");
    // while the demo robot is on the field, offer the team's own
    const o=$("#vpOnshape"); if(o){ let own=true; try{ own=ownRobot()||!!(CAD&&(CAD.source==="onshape"||CAD.source==="urdf")); }catch(e){} o.hidden=own||!hidden; }
  },

  /* ---------------- the cards ---------------- */
  htmlBring(){
    const bad=this.last&&this.last.bad?`<p class="ic-why bad">${esc(this.last.bad)}</p>`:"";
    const tip=this.tip?`<p class="ic-why${this.tipBad?" bad":""}" id="icTip">${esc(this.tip)}</p>`:`<p class="ic-why" id="icTip" hidden></p>`;
    const S=this.signin||{}, relay=S.ready!==false, link=store.get("ftcbench.onshapeLink","")||"";
    const dropZone=`<div class="ic-drop" data-ic="pick" role="button" tabindex="0"><b>Drop the export zip, or click to choose it</b><span>Onshape: right-click the Assembly tab → Export → URDF, GLB, Medium. Also a STEP, a URDF with its meshes, or a saved .ftcsim workspace</span></div>`;
    const docs=`<a class="linkish" href="https://github.com/LILRINO71/ftc-simbench-pro/blob/main/docs/robot-setup.md" target="_blank" rel="noopener">Sim-ready CAD checklist ↗</a>`;
    if(!relay) return `<div class="ic-head"><div><h2>Bring your robot</h2><p>Export it from Onshape and drop the zip: every joint from your mates, every part in its colour, its real weight. Nothing is uploaded; the robot is read on this computer.</p></div>
      <button class="ic-x" type="button" data-ic="close" aria-label="Not now">×</button></div>
      ${dropZone}${bad}
      <div class="ic-row"><span>Not on Onshape?</span><button class="linkish" type="button" data-ic="fusion">Fusion, SolidWorks, FreeCAD →</button><span>·</span>${docs}<span>·</span><button class="linkish" type="button" data-ic="close">Keep the demo robot</button></div>`;
    return `<div class="ic-head"><div><h2>Bring your robot</h2><p>Paste your Onshape assembly's address. It arrives with every joint from your mates, every part in its colour, and its real weight. Nothing to export, nothing to install.</p></div>
      <button class="ic-x" type="button" data-ic="close" aria-label="Not now">×</button></div>
      <div class="ic-steps">
        <div class="ic-step"><span class="n">1</span><div><b>Open your robot's Assembly tab in Onshape</b><p>The assembly, not a Part Studio. If you made a <b>Sim</b> configuration (screws and nuts suppressed), pick it. Then copy the address bar.</p></div></div>
        <div class="ic-step"><span class="n">2</span><div><b>Paste it here</b><p>${S.signedIn?"You're signed in to Onshape; the robot is read straight away.":"Onshape asks you once to let SimBench <b>read</b> your documents. SimBench never writes to them."}</p></div></div>
      </div>
      <form class="ic-link" id="icLink" autocomplete="off"><input type="url" id="icLinkUrl" value="${esc(link)}" placeholder="https://cad.onshape.com/documents/…/w/…/e/…" spellcheck="false" aria-label="Your Onshape assembly's address"><button class="btn-sm primary" type="submit">Get my robot</button></form>
      ${tip}${bad}
      <details class="ic-alt"><summary>No link to paste? Drop the export instead</summary>${dropZone}</details>
      <div class="ic-row">${S.signedIn?`<button class="linkish" type="button" data-ic="signout">Sign out of Onshape</button><span>·</span>`:""}<button class="linkish" type="button" data-ic="fusion">Fusion, SolidWorks, FreeCAD →</button><span>·</span>${docs}<span>·</span><button class="linkish" type="button" data-ic="close">Keep the demo robot</button></div>`;
  },
  htmlBusy(){
    const b=this.busy||{};
    return `<div class="ic-head"><div><h2>${esc(b.title||"Reading your robot")}</h2>${b.sub?`<p>${esc(b.sub)}</p>`:""}</div></div>
      <div class="ic-meter${b.frac==null?" busy":""}" id="icMeter"><i style="width:${b.frac==null?"":Math.round(Math.max(.04,Math.min(1,b.frac))*100)+"%"}"></i></div>
      <p class="ic-prog" id="icProg">${esc(b.text||b.title||"")}</p>
      <p class="ic-sub">Big robots take a little while. The page stays usable.</p>`;
  },
  htmlCode(){
    const n=CAD?CAD.solids.length:0, j=CAD?CAD.mechs.filter(m=>m.fromMate&&!m.internal&&m.kind!=="fixed").length:0;
    const mass=(Sim.rig&&Sim.rig.props)||Physics.props, kg=mass&&!mass.assumed?mass.kg:(CAD&&CAD.onshape&&CAD.onshape.kg);
    const sample=CODE&&(CODE.devices||[]).length&&typeof entry==="function"&&entry(CURRENT_ID)&&entry(CURRENT_ID).builtin;
    return `<div class="ic-head"><div><h2>Now your code</h2><p><b>${esc(CAD?CAD.name:"Your robot")}</b> is in: ${n} parts${j?", "+j+" joint"+(j===1?"":"s")+" from your mates":""}${kg?", about "+kg.toFixed(1)+" kg":""}. Add the OpModes you run on the Control Hub, and every helper class they use.</p></div>
      <button class="ic-x" type="button" data-ic="close" aria-label="Not now">×</button></div>
      <div class="ic-drop" data-ic="pick-code" role="button" tabindex="0"><b>Drop your .java files, or click to choose them</b><span>TeleOps, autos and helper classes together, or a zip of the TeamCode folder</span></div>
      ${CAD&&CAD.mates&&CAD.mates.source==="onshape"?`<p class="ic-note">${isExact(CAD)?"Your joints are declared, so nothing about them is guessed.":"Which of the export's joints move was worked out from what they carry."} <button class="ic-textbtn" type="button" data-ic="sheet">${isExact(CAD)?"See the joint sheet":"Declare them instead"}</button></p>`:""}
      <form class="ic-code" id="icGh"><input id="icGhUrl" type="text" placeholder="or paste your team's GitHub repo" spellcheck="false" autocomplete="off"><button class="btn-sm primary" type="submit">Find OpModes</button></form>
      ${sample?`<p class="ic-note">The OpMode selected now is a sample written for another robot. <button class="ic-textbtn" type="button" data-ic="sample-ok">Drive this robot with it anyway</button></p>`:""}`;
  },
  htmlReview(){
    const A=SetupUI.auto(), B=this.bind(), rc=RC, F=CAD.frame||{};
    let D=null; try{ D=driveFromCAD(CAD,{front:OPTS.front}); }catch(e){}
    const W=D?D.wheels||[]:[], kindName={mecanum:"Mecanum",tank:"Tank",x:"X-drive",omni:"Omni",swerve:"Swerve"}[D&&D.kind]||null;
    const mass=(Sim.rig&&Sim.rig.props)||Physics.props, kg=mass&&!mass.assumed?mass.kg:null;
    const joints=CAD.mechs.filter(m=>!m.drive&&m.kind!=="fixed"&&!m.internal), declared=isExact(CAD);
    // exact: declared, or from a spec or mates with none of them set aside by size or name
    const picked=!declared&&CAD.mates&&CAD.mates.source==="onshape"&&CAD.mechs.some(m=>m.fromMate&&m.internal&&m.kind!=="fixed");
    const exact=declared||(!picked&&(CAD.source==="onshape"||CAD.source==="urdf"||(CAD.mates&&CAD.mates.source==="spec"&&!CAD.mates.auto)));
    const moving=CAD.mechs.filter(m=>m.fromMate&&!m.drive&&m.kind!=="fixed").length;
    const internal=CAD.mechs.filter(m=>m.internal).length;
    const devs=B?B.bound.length+B.open.length:0, bound=B?B.bound.length:0;
    const fact=(v,l,cls)=>`<div class="ic-fact${cls?" "+cls:""}"><b>${v}</b><span>${l}</span></div>`;
    const facts=[
      fact(esc(F.up?"up is "+F.up:"up"),A.up||SETUP.done.up?"from the wheels":"check",A.up||SETUP.done.up?"ok":"ask"),
      fact(esc("front "+OPTS.front),A.front||SETUP.done.front?"the way the wheels roll":"check",A.front||SETUP.done.front?"ok":"ask"),
      fact(esc(kindName?kindName+" ×"+W.length:"no wheels found"),kindName?Math.round((W[0]&&W[0].r||0)*2000)+" mm wheels":"set it by numbers",A.drive||SETUP.done.drive?"ok":"ask"),
      fact(joints.length+" joint"+(joints.length===1?"":"s"),declared?"declared, nothing guessed":picked?"picked from "+moving+" mates":exact?"exact, from your mates":"found from the geometry",exact?"ok":picked?"ask":""),
      fact(bound+" of "+devs,"devices tied to joints",devs&&bound===devs?"ok":devs?"ask":""),
      kg?fact(kg.toFixed(1)+" kg","from the CAD's materials","ok"):"",
    ].join("");
    // the questions: the robot check's, then the binding's
    const qs=[];
    if(rc) for(const it of rc.items) if(it.sev==="fail"||it.sev==="warn") qs.push(this.qHtml(it));
    // declared joints: what the declarations leave open, each with its fix, never a guess
    if(declared){
      const K=checkJointSheet(CAD,CODE,MAP,{isCommanded:n=>isCommanded(CODE,n)});
      for(const it of K.items) if(it.sev==="fail"||it.sev==="warn") qs.push(`<div class="ic-q"><b>${esc(it.text)}</b><div class="acts">`+
        (it.joint?`<button class="btn-sm" type="button" data-rc="show" data-a="${esc(it.joint)}">show</button>`:"")+
        `<button class="btn-sm primary" type="button" data-ic="sheet">Open the joint sheet</button>`+
        (it.tag?`<button class="btn-sm" type="button" data-js="copy" data-a="${esc(it.tag)}">Copy “${esc(it.tag)}”</button>`:"")+
        (it.device?`<button class="btn-sm" type="button" data-rc="gauge" data-a="${esc(it.device)}">It moves nothing drawn</button>`:"")+`</div></div>`);
    }
    if(B&&!declared) for(const o of B.open) qs.push(`<div class="ic-q"><b>Which part does <code>${esc(o.device)}</code> move?</b><div class="acts">`+
        o.candidates.map(c=>`<button class="btn-sm" type="button" data-rc="show" data-a="${esc(c.joint)}" title="${esc(c.why||"")}">${esc(c.label)}</button><button class="btn-sm primary" type="button" data-rc="pair" data-a="${esc(o.device+"|"+c.joint)}">this one</button>`).join("")+
        `<button class="btn-sm" type="button" data-rc="click" data-a="${esc(o.device)}">Click it in the CAD view</button><button class="btn-sm" type="button" data-rc="gauge" data-a="${esc(o.device)}">It moves nothing drawn</button></div></div>`);
    const notes=[];
    if(B&&B.couplings.length) notes.push(B.couplings.map(c=>`<li class="note"><i>↔</i><span class="t">"${esc(c.joint)}" follows "${esc(c.to)}"<small>${c.via==="cascade"?"a cascade slide: the stages extend together":"a gear pair: it turns the other way"}</small></span></li>`).join(""));
    if(internal&&declared) notes.push(`<li class="note"><i>·</i><span class="t">${internal} joints nobody declared, held as drawn<small>bearings, rollers and motor shafts: ${CAD.sheet.from==="sheet"?"your joint sheet says":"your mates' names say"} which joints move</small></span></li>`);
    else if(internal) notes.push(`<li class="note"><i>·</i><span class="t">${internal} small turns left fixed<small>bearing races and motor shafts the library draws as mates, set aside by their size and names. <button class="ic-textbtn" type="button" data-ic="sheet">Declare the joints</button> and nothing is worked out.</small></span></li>`);
    if(B&&B.idle.length) notes.push(`<li class="note"><i>·</i><span class="t">${B.idle.length} joint${B.idle.length===1?"":"s"} nothing in this OpMode drives<small>${esc(B.idle.slice(0,4).map(i=>i.label).join(", "))}${B.idle.length>4?" …":""}: they stay where they're drawn</small></span></li>`);
    const ready=!qs.length;
    return `<div class="ic-head"><div><h2>${ready?"Ready to drive":"Almost there"}</h2><p>${ready?"Everything the bench needs, it read from your robot and your code. Press INIT, then START.":qs.length+" thing"+(qs.length===1?"":"s")+" only you can answer. Each answer is kept with this robot."}</p></div>
      <button class="ic-x" type="button" data-ic="close" aria-label="Close">×</button></div>
      <div class="ic-facts">${facts}</div>
      ${qs.join("")}
      ${notes.length?`<ul class="ic-list">${notes.join("")}</ul>`:""}
      <div class="ic-foot"><button class="btn-sm primary" type="button" data-ic="${ready?"close":"accept"}">${ready?"Looks right":"Looks right as it is"}</button>
        <button class="btn-sm" type="button" data-ic="cad">Open the CAD view</button>${CAD.mates&&CAD.mates.source==="onshape"?`<button class="btn-sm" type="button" data-ic="sheet">${declared?"Joint sheet":"Declare joints"}</button>`:""}<button class="btn-sm" type="button" data-ic="save">Save setup</button><span class="spacer"></span><span class="dim">${esc(CAD.name||"")}</span></div>`;
  },
  qHtml(it){
    const btn=(act,arg,txt,cls)=>`<button class="btn-sm${cls?" "+cls:""}" type="button" data-rc="${act}" data-a="${esc(arg)}">${esc(txt)}</button>`;
    let acts="";
    if(it.ask==="pick-parts") acts=(it.candidates||[]).map(c=>btn("show",c.joint,c.label)+btn("pair",it.device+"|"+c.joint,"this one","primary")).join("")+btn("click",it.device,"Click it in the CAD view");
    else if(it.ask==="pick-device") acts=btn("show",it.joint,"show")+(it.candidates||[]).map(c=>btn("pair",c.device+"|"+it.joint,c.device)).join("")+btn("drop",it.joint,"not a joint");
    else if(it.ask==="drop-joint") acts=btn("show",it.joint,"show")+btn("drop",it.joint,"remove it","primary");
    else if(it.ask==="look"&&it.joint) acts=btn("show",it.joint,"show me");
    else if(it.ask==="mates") acts=btn("mates","","Bring the robot from Onshape");
    else if(it.ask==="declare") acts=btn("declare","","Declare the joints");
    return `<div class="ic-q"><b>${esc(it.text)}</b>${acts?`<div class="acts">${acts}</div>`:""}</div>`;
  },

  /* ---------------- clicks ---------------- */
  click(e){
    const js=e.target.closest("[data-js]"); if(js){ this.sheetClick(js.dataset.js,js.dataset.a); return; }
    const rc=e.target.closest("[data-rc]");
    if(rc){ if(rc.dataset.rc==="gauge"){ this.gauge(rc.dataset.a); return; } robotCheckAct(rc.dataset.rc,rc.dataset.a); return; }
    const b=e.target.closest("[data-ic]"); if(!b) return;
    const k=b.dataset.ic;
    if(k==="close") this.close();
    else if(k==="accept"){ for(const s of SETUP_STEPS) SETUP.done[s]=true; saveRig(); SetupUI.render(); this.close(); }
    else if(k==="pick") $("#cadFile").click();
    else if(k==="pick-code") $("#codeFile").click();
    else if(k==="sample-ok"){ this.sampleOk=CAD; this.render(true); }
    else if(k==="cad"){ CadView.enter(); $$("#viewSeg button").forEach(x=>x.classList.toggle("on",x.dataset.v==="cad")); }
    else if(k==="save") SetupUI.download();
    else if(k==="signout") this.signOut();
    else if(k==="fusion") this.fusion();
    else if(k==="sheet") this.openSheet();
  },
  /* a word under the link box, without redrawing the card while someone is typing in it */
  say(t,bad){ this.tip=t||""; this.tipBad=!!bad; const p=$("#icTip"); if(p){ p.textContent=this.tip; p.hidden=!this.tip; p.className="ic-why"+(bad?" bad":""); } else if(this.state==="bring") this.render(true); },

  /* ---------------- the Onshape link (src/onshapelink.js through functions/onshape) ----------------
     Whether this site can sign in to Onshape at all (it needs the relay), and whether this
     browser has. ready is false on a plain static host: the card offers the export then. */
  async refreshSignIn(){ this.signin=await onshapeSignInState(); return this.signin; },
  signIn(){
    const w=window.open("onshape/login","sb_onshape_login","popup,width=560,height=760");
    // no pop-up allowed: sign in in this tab; Onshape sends it back to #onshape-signed-in
    if(!w){ location.href="onshape/login"; return; }
    this.say("Finish in the Onshape window: sign in if it asks, then click Allow. The robot is read as soon as you do.");
  },
  async signedIn(ok,msg){
    const st=await this.refreshSignIn();
    if(ok&&st.signedIn){
      const href=this.pendingLink||store.get("ftcbench.onshapeLink","")||""; this.pendingLink=null;
      this.say(""); this.dismissed=false; this.forced=true;
      if(href&&onshapeRef(href)){ this.render(true); const i=$("#icLinkUrl"); if(i) i.value=href; this.fromLink(); }
      else this.render(true);
    } else { this.pendingLink=null; this.render(true); this.say("Onshape sign-in didn't finish"+(msg?": "+msg:"")+". Click Get my robot to try again.",true); }
  },
  async signOut(){ try{ await fetch("onshape/logout",{method:"POST",credentials:"same-origin"}); }catch(e){} await this.refreshSignIn(); this.render(true); },
  /* the pasted address: checked, then read and built in the engine worker */
  async fromLink(){
    const inp=$("#icLinkUrl"), href=String(inp?inp.value:"").trim();
    if(!onshapeRef(href)){ this.say(href?"That isn't an Onshape assembly address. In Onshape, click your Assembly tab, then copy the whole address from the address bar.":"Paste your assembly's address first.",true); if(inp) inp.focus(); return; }
    store.set("ftcbench.onshapeLink",href);
    const st=await this.refreshSignIn();
    if(!st.ready){ this.say("Reading straight from Onshape isn't switched on for this copy of SimBench. Export the robot instead (below).",true); return; }
    if(!st.signedIn){ this.pendingLink=href; this.signIn(); return; }
    this.last=null; this.say("");
    this.start("Reading your robot from Onshape","Through your Onshape sign-in, straight from the assembly. A big robot takes a minute or two; the page stays usable.");
    let r;
    try{ r=await EngineWorker.onshapeLink(href,{frame:{up:OPTS.up, shift:OPTS.shift}, onProgress:(t,d,n)=>this.progress(t,d,n)}); }
    catch(e){
      const m=String(e&&e.message||e);
      if(/sign in|aren't allowed|can't read it/i.test(m)){ this.signin.signedIn=false; this.busy=null; this.render(true); this.say(m+".",true); return; }
      this.fail("SimBench couldn't read your assembly: "+m+". "+(/isn't an assembly/.test(m)?"The address has to come from the Assembly tab, not a Part Studio or a drawing.":"Try again; if it keeps failing, export it (Export → URDF) and drop the zip."));
      return;
    }
    const cad=r.cad, p=r.payload; cad.name=p.name||cad.name;
    SetupUI.beforeParse&&SetupUI.beforeParse(cad.name);
    LAST_STEP={name:cad.name, text:"", onshape:p, label:cad.name+" · from Onshape"};
    JOINTS.spec=JOINTS.report=JOINTS.devices=null; JOINTS.name=JOINTS.step=null;
    this.robotIn(cad,"Onshape");
  },
  /* a robot that arrived whole (the link, the export zip, a re-read with a new up or centre): onto the field */
  robotIn(cad,from){
    this.progress("Placing it on the field …",1,1);
    MATES.name=cad.name; MATES.url=cad.onshape&&cad.onshape.url||null; MATES.report=cad.onshape&&cad.onshape.report||null;
    // the team's own joint sheet for this robot, over what the mates' names declare (src/jointsheet.js)
    const sheet=this.savedSheet(cad.name);
    if(sheet){ try{ applyJointSheet(cad,mergeJointSheets(sheetFromTags(cad),sheet)); }catch(e){} }
    this.sheetOpen=false; this.draft=null;
    // which of the joints are mechanisms (the rest are bearings, shafts, rollers): before anything is said about them
    classifyJoints(cad);
    const n=cad.mechs.filter(m=>m.fromMate&&!m.internal).length, hid=cad.mechs.filter(m=>m.fromMate&&m.internal).length, decl=isExact(cad);
    loadCAD(cad, cad.name+" · from "+from+" · "+cad.solids.length+" parts · "+n+(decl?" declared":"")+" joint"+(n===1?"":"s")+(hid?" ("+hid+(decl?" others held":" bearings and shafts left fixed")+")":""), "ok");
    // the robot's own surfaces, thinned in the worker: exact geometry with nothing more to load
    const ex=typeof urdfExact==="function"?urdfExact(cad):null;
    if(ex&&ex.meshes.length){
      EXACT={state:"ok", msg:null}; View.setExact(cad,ex);
      const note=$("#exactNote"); if(note){ const tri=cad.onshape&&cad.onshape.triangles||(cad.urdf&&cad.urdf.triangles); note.textContent="Exact geometry: "+ex.meshes.length+" parts from "+ex.shapes+" shapes, "+(tri?(tri/1e6).toFixed(1)+" M triangles":"")+"."; note.className="hint"; }
      if(CadView.on) CadView.renderTree();
    }
    recomputeChain(cad.mechs);
    classifyJoints(cad);
    const mine=savedJoints(cad.name); if(mine){ JOINTS.spec=mine; JOINTS.step=cad.name; JOINTS.name="your joints"; applyJoints(); }
    $("#mateStatus").textContent=cad.name+" · whole robot from "+from+" · "+n+" joint"+(n===1?"":"s"); $("#mateDrop").className="drop ok";
    $("#mateNote").innerHTML=(cad.onshape&&cad.onshape.why||[]).map(w=>"<li>"+esc(w)+"</li>").join("");
    const pill=$("#matePill"); if(pill){ pill.textContent=n+" joint"+(n===1?"":"s"); pill.className="pill ok"; }
    if(CODE) rebuild();
    this.finish();
  },
  /* a device that moves nothing drawn: a live gauge, and no more questions about it */
  gauge(dev){ RIG_DEVICES[dev]=null; MAP[dev]=null; saveRig(); rebuild(); this.render(true); },
  fusion(){
    const card=$("#importCard"); if(!card) return;
    setIfChanged(card,`<div class="ic-head"><div><h2>From Fusion, SolidWorks or FreeCAD</h2><p>SimBench reads a <b>URDF</b> with its meshes (STL, GLB or OBJ), which every one of them can write. Drop the folder's files or a zip of it.</p></div>
      <button class="ic-x" type="button" data-ic="back" aria-label="Back">×</button></div>
      <ul class="ic-list">
        <li><i>F</i><span class="t">Fusion<small>Run the <b>Export to SimBench</b> script (Utilities → Add-Ins → Scripts → + → choose the folder → Run). It writes robot.urdf and the meshes next to your design. The script is in the repository under tools/fusion.</small></span></li>
        <li><i>S</i><span class="t">SolidWorks<small>The SolidWorks URDF exporter (sw_urdf_exporter) writes a URDF package; drop its urdf and meshes folders here together.</small></span></li>
        <li><i>C</i><span class="t">FreeCAD<small>The CROSS workbench exports URDF. Drop the .urdf with its meshes.</small></span></li>
        <li class="note"><i>·</i><span class="t">Only a STEP?<small>Drop it: the joints are found from the geometry and checked against your code. The robot check will ask about anything it can't be sure of.</small></span></li>
      </ul>
      <div class="ic-drop" data-ic="pick" role="button" tabindex="0"><b>Drop the files or the zip here</b><span>robot.urdf and its meshes</span></div>
      <div class="ic-foot"><button class="btn-sm" type="button" data-ic="back">Back</button></div>`);
    card.querySelector('[data-ic="back"]').addEventListener("click",()=>this.render(true),{once:true});
  },

  /* ---------------- the joint sheet: exact joints (src/jointsheet.js) ----------------
     The page's own declarations, kept per robot in this browser, over whatever the
     mates' names in Onshape already declare. Edits live in a draft (per joint id)
     until "Use these joints", so a re-render never loses what is being typed. */
  sheetKey(name){ return "ftcbench.jointsheet."+(name||""); },
  savedSheet(name){ try{ const j=JSON.parse(store.get(this.sheetKey(name),"null")); return j&&j.format===JOINT_SHEET_FORMAT?j:null; }catch(e){ return null; } },
  /* the mates' names and the page's sheet onto the robot, and everything that reads joints again */
  useSheet(page){
    if(!CAD) return;
    const merged=mergeJointSheets(sheetFromTags(CAD),page);
    try{ if(merged&&merged.joints.length) applyJointSheet(CAD,merged); else clearJointSheet(CAD); }
    catch(e){ this.last={bad:e.message}; }
    classifyJoints(CAD);
    if(CODE){ mapDevices(); rebuild(); }
    if(typeof renderRobotCheck==="function") renderRobotCheck();
    this.render(true);
  },
  /* a dropped .jointsheet.json */
  takeSheet(j,file){
    if(!CAD){ this.last={bad:file+" is a joint sheet: bring the robot it belongs to first."}; this.render(true); return; }
    const page=Object.assign({},j,{joints:(j.joints||[]).filter(e=>e&&e.from!=="tag")});
    store.set(this.sheetKey(CAD.name),JSON.stringify(page)); this.draft=null; this.useSheet(page);
  },
  openSheet(){ this.sheetOpen=true; this.draft=null; this.showNames=false; this.render(true); const c=$("#importCard"); if(c) c.scrollTop=0; },
  /* the draft: every joint's row as the form shows it, from what is declared now */
  draftNow(){
    if(this.draft) return this.draft;
    const d={};
    for(const m of (CAD&&CAD.mechs)||[]){
      if(!m.declared||!m.declaredEntry) continue;
      const e=m.declaredEntry;
      d[m.id]={drive:e.drive, dev:e.drive==="follow"?String(e.follows||""):(e.devices||[]).join(" "), ratio:e.ratio!=null?String(e.ratio):"",
        lo:e.limits&&e.limits[0]!=null?String(e.limits[0]):"", hi:e.limits&&e.limits[1]!=null?String(e.limits[1]):"", rev:!!e.rev};
    }
    return this.draft=d;
  },
  /* the draft as a sheet: only what the mates' names don't already say */
  pageSheet(){
    const d=this.draftNow(), out=[];
    for(const m of CAD.mechs){
      if(!m.fromMate||m.drive) continue;
      const r=d[m.id], tag=jointTag(m.fromMate.name);
      if(!r||!r.drive){ if(tag) out.push({joint:m.fromMate.name, drive:"none"}); continue; }
      const words=String(r.dev||"").split(/[\s,+]+/).filter(Boolean);
      const e={joint:m.fromMate.name, drive:r.drive};
      if(r.drive==="follow"){ e.follows=String(r.dev||"").trim(); if(r.ratio!==""&&Number.isFinite(+r.ratio)&&+r.ratio!==1) e.ratio=+r.ratio; }
      else if(r.drive==="motor"||r.drive==="servo"||r.drive==="crservo") e.devices=words;
      if(r.rev) e.rev=true;
      if(r.drive!=="fixed"&&(r.lo!==""||r.hi!=="")) e.limits=[r.lo===""?null:+r.lo, r.hi===""?null:+r.hi];
      if(m.pivot) e.at=m.pivot.map(v=>+(v*1000).toFixed(1));
      // the same as the mate's name says, and nothing typed over its limits: the name is enough
      const same=tag&&tag.drive===e.drive&&!e.limits&&!!tag.rev===!!e.rev&&(e.drive!=="follow"||(String(tag.follows).toLowerCase()===e.follows.toLowerCase()&&(tag.ratio||1)===(e.ratio||1)))&&
        (!e.devices||(tag.devices||[]).join(" ").toLowerCase()===e.devices.join(" ").toLowerCase());
      if(!same) out.push(e);
    }
    return {format:JOINT_SHEET_FORMAT, version:1, robot:CAD.name||null, exact:true, joints:out};
  },
  sheetInput(e){
    const row=e.target.closest&&e.target.closest(".js-row"); if(!row||!this.draft) return;
    const id=row.dataset.id, f=e.target.dataset.f; if(!f) return;
    const r=this.draft[id]||(this.draft[id]={drive:"", dev:"", ratio:"", lo:"", hi:"", rev:false});
    r[f]=e.target.type==="checkbox"?e.target.checked:e.target.value;
    if(f==="drive"){ row.dataset.drive=r.drive; row.classList.toggle("on",!!r.drive); }
  },
  sheetClick(act,a){
    if(act==="show") return showJoint(a);
    if(act==="copy"){ try{ navigator.clipboard.writeText(a); }catch(e){} return; }
    if(act==="all"){ this.showAll=!this.showAll; this.render(true); return; }
    if(act==="names"){ this.showNames=!this.showNames; this.render(true); return; }
    if(act==="back"){ this.sheetOpen=false; this.draft=null; this.render(true); return; }
    if(act==="use"||act==="save"){
      const page=this.pageSheet(); store.set(this.sheetKey(CAD.name),JSON.stringify(page));
      this.draft=null; if(act==="use") this.sheetOpen=false; this.useSheet(page); return;
    }
    if(act==="download"){
      const page=this.pageSheet(), full=mergeJointSheets(sheetFromTags(CAD),page)||page;
      const a2=document.createElement("a"); a2.href=URL.createObjectURL(new Blob([JSON.stringify(full,null,1)],{type:"application/json"}));
      a2.download=(CAD.name||"robot").replace(/\.(zip|step|stp)$/i,"")+".jointsheet.json"; document.body.appendChild(a2); a2.click();
      setTimeout(()=>{ URL.revokeObjectURL(a2.href); a2.remove(); },500); return;
    }
    if(act==="copy-names"){ try{ navigator.clipboard.writeText(this.namesText()); }catch(e){} return; }
  },
  /* what to rename in Onshape, one line per declared joint */
  namesList(){
    const page=this.pageSheet(), full=mergeJointSheets(sheetFromTags(CAD),page);
    return ((full&&full.joints)||[]).map(e=>{ const o=onshapeMateName(e.joint); return {from:o.mate, copy:o.copy, to:tagFor(e), done:e.from==="tag"}; }).filter(x=>x.to);
  },
  namesText(){ return this.namesList().filter(x=>!x.done).map(x=>"\""+x.from+"\""+(x.copy>1?" (copy "+x.copy+")":"")+"  ->  \""+x.to+"\"").join("\n"); },
  /* a device paired from the robot check, or a joint dropped, when the joints are declared */
  sheetPair(dev,id){
    const m=CAD&&CAD.mechs.find(x=>x.id===id); if(!m) return;
    const d=this.draftNow(), r=d[id]||(d[id]={drive:"", dev:"", ratio:"", lo:"", hi:"", rev:false});
    const D=((CODE&&CODE.devices)||[]).find(x=>x.name===dev), name=D&&D.cfg||dev;
    if(!r.drive||r.drive==="free") r.drive=D&&/crservo/i.test(D.type||"")?"crservo":D&&/servo/i.test(D.type||"")?"servo":"motor";
    r.dev=(r.dev?r.dev+" ":"")+name;
    this.sheetClick("save");
  },
  sheetDrop(id){ const d=this.draftNow(); d[id]={drive:"", dev:"", ratio:"", lo:"", hi:"", rev:false}; this.sheetClick("save"); },
  htmlSheet(){
    const d=this.draftNow(), exact=isExact(CAD);
    const all=CAD.mechs.filter(m=>m.fromMate&&!m.drive&&m.kind!=="fixed");
    const count=new Map(); for(const s of CAD.solids||[]) if(s.mech) count.set(s.mech,(count.get(s.mech)||0)+1);
    const kids=new Map(); for(const m of CAD.mechs) if(m.parent&&m.parent!=="chassis"){ if(!kids.has(m.parent)) kids.set(m.parent,[]); kids.get(m.parent).push(m.id); }
    const carried=(id,depth)=>(count.get(id)||0)+(depth<30?(kids.get(id)||[]).reduce((n,k)=>n+carried(k,depth+1),0):0);
    const rank=m=>(d[m.id]&&d[m.id].drive?2e6:0)+(!m.internal||m.declared?1e6:0)+carried(m.id,0);
    const list=all.filter(m=>this.showAll||(d[m.id]&&d[m.id].drive)||!m.internal||m.declared).sort((a,b)=>rank(b)-rank(a));
    const devs=((CODE&&CODE.devices)||[]).filter(x=>/servo|dcmotor/i.test(x.type||"")&&!isDriveDevice(x)).map(x=>x.cfg||x.name);
    const opt=(v,t,cur)=>`<option value="${v}"${v===cur?" selected":""}>${t}</option>`;
    const rows=list.map(m=>{
      const r=d[m.id]||{drive:"", dev:"", ratio:"", lo:"", hi:"", rev:false}, lin=normJointKind(m.kind)==="linear", o=onshapeMateName(m.fromMate.name);
      const L=m.sheetWas&&m.sheetWas.limits!==undefined?m.sheetWas.limits:m.limits, u=lin?"mm":"°", k=lin?1000:180/Math.PI;
      const ph=i=>L&&L[i]!=null&&Number.isFinite(L[i])?String(+(L[i]*k).toFixed(1)):(i?"max":"min");
      const n=carried(m.id,0), from=m.declared?(m.declaredFrom==="tag"?"named in Onshape":"on this sheet"):m.internal?"held":"picked";
      return `<div class="js-row${r.drive?" on":""}" data-id="${esc(m.id)}" data-drive="${esc(r.drive)}">
        <div class="js-name"><b>${esc(m.declared&&m.label?m.label:o.mate)}</b><span>Onshape: “${esc(o.mate)}”${o.copy>1?" · copy "+o.copy:""} · ${lin?"slides":"turns"} · ${n} part${n===1?"":"s"} · ${from}</span></div>
        <button class="btn-sm" type="button" data-js="show" data-a="${esc(m.id)}">Show</button>
        <div class="js-ctl">
          <select data-f="drive" aria-label="What moves it">${opt("","not a mechanism",r.drive)}${opt("motor","motor",r.drive)}${opt("servo","servo",r.drive)}${opt("crservo","continuous servo",r.drive)}${opt("follow","follows another joint",r.drive)}${opt("free","moves freely",r.drive)}${opt("fixed","never moves",r.drive)}</select>
          <input class="js-dev" data-f="dev" list="jsDevs" value="${esc(r.dev)}" placeholder="${r.drive==="follow"?"the device it follows":"device name(s) in your code"}" spellcheck="false" autocomplete="off">
          <span class="js-ratio">× <input data-f="ratio" type="number" step="any" value="${esc(r.ratio)}" placeholder="1"></span>
          <span class="js-lim"><input data-f="lo" type="number" step="any" value="${esc(r.lo)}" placeholder="${ph(0)}"> to <input data-f="hi" type="number" step="any" value="${esc(r.hi)}" placeholder="${ph(1)}"> ${u}</span>
          <label class="js-rev"><input data-f="rev" type="checkbox"${r.rev?" checked":""}> reversed</label>
        </div></div>`;
    }).join("");
    const hidden=all.length-list.length;
    const names=this.showNames?this.namesList():null;
    const namesHtml=names?`<div class="js-names"><p>${names.some(x=>!x.done)?"Rename these mates in Onshape (double-click the mate in the assembly's mate list) and the next export declares them by itself. A mate inside a library part, like a servo's own spline mate, can't be renamed: keep that one on this sheet.":"Every declaration already comes from your mates' names."}</p>
        <ul>${names.map(x=>`<li${x.done?" class=\"done\"":""}><code>${esc(x.from)}</code>${x.copy>1?` <small>copy ${x.copy}</small>`:""} → <code>${esc(x.to)}</code>${x.done?" <small>already named</small>":""}</li>`).join("")}</ul>
        ${names.some(x=>!x.done)?`<button class="btn-sm" type="button" data-js="copy-names">Copy the list</button>`:""}</div>`:"";
    return `<div class="ic-head"><div><h2>Joint sheet</h2><p>Say which joints move and what moves them. Every joint you leave as “not a mechanism” is held as drawn, and nothing is guessed. ${exact?"<b>Exact now:</b> "+esc(CAD.sheet.declared+" declared, "+CAD.sheet.held+" held."):"Nothing is declared yet, so the bench is picking from what the joints carry."}</p></div>
      <button class="ic-x" type="button" data-js="back" aria-label="Back">×</button></div>
      <datalist id="jsDevs">${devs.map(v=>`<option value="${esc(v)}">`).join("")}</datalist>
      <div class="js-rows">${rows||`<p class="ic-why">This robot has no joints from mates.</p>`}</div>
      ${hidden||this.showAll?`<p class="ic-note"><button class="ic-textbtn" type="button" data-js="all">${this.showAll?"Show only the likely mechanisms":"Show all "+all.length+" moving mates ("+hidden+" more: bearings, rollers, shafts)"}</button></p>`:""}
      ${namesHtml}
      <div class="ic-foot"><button class="btn-sm primary" type="button" data-js="use">Use these joints</button>
        <button class="btn-sm" type="button" data-js="names">${this.showNames?"Hide":"Names for"} Onshape</button><button class="btn-sm" type="button" data-js="download">Download sheet</button>
        <span class="spacer"></span><button class="btn-sm" type="button" data-js="back">Back</button></div>`;
  },

  /* ---------------- the zip route ---------------- */
  async takeZip(file){
    this.last=null;
    this.start("Reading "+file.name,"Unpacking the export and building the robot on this computer.");
    let buf;
    try{ buf=await file.arrayBuffer(); }catch(e){ this.fail("Couldn't read "+file.name); return; }
    SetupUI.beforeParse&&SetupUI.beforeParse(file.name);
    let r;
    try{ r=await EngineWorker.urdfZip(buf,file.name,{frame:{up:OPTS.up, shift:OPTS.shift}, onProgress:(t,d,n)=>this.progress(t,d,n)}); }
    catch(e){ this.fail("This zip couldn't be read as a robot: "+(e&&e.message||e)+". Export again from Onshape as URDF with GLB geometry and compression off."); return; }
    if(!r.cad){
      // no .urdf inside: the team's code, perhaps
      const java=(r.entries||[]).filter(x=>/\.java$/i.test(x.name));
      if(java.length){ this.busy=null; for(const j of java) addOpModeFromText(j.name.replace(/^.*[\\/]/,""),new TextDecoder().decode(j.data)); this.render(); return; }
      this.fail("That zip has no robot.urdf and no .java files in it."); return;
    }
    const cad=r.cad; cad.name=r.name||file.name.replace(/\.zip$/i,"");
    LAST_STEP={name:cad.name, text:"", urdfZip:true, label:cad.name+" · from "+(/onshape|urdf/i.test(file.name)?"Onshape":"URDF")};
    JOINTS.spec=JOINTS.report=JOINTS.devices=null; JOINTS.name=JOINTS.step=null;
    this.robotIn(cad,"URDF");
  },
};
