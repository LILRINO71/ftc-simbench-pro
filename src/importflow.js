/* ============================================================
   THE IMPORT FLOW — getting a robot in, and knowing it is right
   ------------------------------------------------------------
   One card over the field says, at every moment, the one thing to do next:

     bring      no robot of the team's own yet: the two Onshape steps (Export
                as URDF, drop the zip), or any file at all
     busy       reading it: one bar, plain words, the robot appears when done
     code       a robot, no code: drop the .java files or paste a GitHub repo
     review     both: what the bench worked out (up, front, drive base, mass,
                joints, which device drives what) as facts, and the few things
                only the team can answer as one-click questions, each with a
                "show me" that moves the part in the CAD view
     done       nothing left to ask; the card goes away until something changes

   Nothing here decides anything about the robot: src/bind.js binds devices,
   src/robotcheck.js checks, src/engineworker.js reads. This only draws, and
   answers a click with the one engine call it stands for.
   ============================================================ */
const ImportFlow={
  state:"bring", dismissed:false, busy:null, code:null, last:null,
  init(){
    const card=$("#importCard"); if(!card) return;
    card.addEventListener("click",e=>this.click(e));
    card.addEventListener("submit",e=>{ e.preventDefault(); const f=e.target;
      if(f.id==="icGh"){ $("#ghUrl").value=$("#icGhUrl").value; GH.find().then(()=>{ if(!$("#ghOverlay").hidden) return; }); GH.open(true); }
    });
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
    if(st==="done"&&!force){ card.hidden=true; this.state=st; this.chip(); return; }
    this.state=st==="done"?"review":st;
    card.hidden=false;
    const h=this.state==="bring"?this.htmlBring():this.state==="busy"?this.htmlBusy():this.state==="code"?this.htmlCode():this.htmlReview();
    setIfChanged(card,h);
    this.chip();
  },
  renderBusy(){ const m=$("#icMeter"), t=$("#icProg"); if(!m||!this.busy) return;
    m.className="ic-meter"+(this.busy.frac==null?" busy":""); if(this.busy.frac!=null) m.firstElementChild.style.width=Math.round(Math.max(.04,Math.min(1,this.busy.frac))*100)+"%";
    if(t) t.textContent=this.busy.text||this.busy.title; },
  /* the field's chip: offer the card when it isn't showing and there's something to do */
  chip(){ const c=$("#vpSetup"); if(!c) return; const show=$("#importCard").hidden&&(this.compute()==="review"); c.hidden=!show; },

  /* ---------------- the cards ---------------- */
  htmlBring(){
    const bad=this.last&&this.last.bad?`<p class="ic-why bad">${esc(this.last.bad)}</p>`:"";
    return `<div class="ic-head"><div><h2>Bring your robot</h2><p>Two steps in Onshape, and it arrives with every joint from your mates, every part in its colour, and its real weight.</p></div>
      <button class="ic-x" type="button" data-ic="close" aria-label="Not now">×</button></div>
      <div class="ic-steps">
        <div class="ic-step"><span class="n">1</span><div><b>Export it from Onshape</b><p>Right-click your <b>Assembly</b> tab at the bottom of Onshape → <b>Export</b>. Format <code>URDF</code>, geometry <code>GLB</code>, resolution <code>Medium</code> (Fine is ten times the file for no gain here), compression off. A zip downloads.</p>
          <svg class="ic-pic" viewBox="0 0 300 70" aria-hidden="true"><rect x="1" y="1" width="298" height="68" rx="8" fill="var(--card)" stroke="var(--sep-2)"/><rect x="10" y="8" width="280" height="30" rx="4" fill="var(--card-2)"/><text x="150" y="27" text-anchor="middle" font-size="10" fill="var(--label-3)">your robot</text>
          <rect x="10" y="46" width="70" height="16" rx="3" fill="var(--card-2)"/><text x="18" y="58" font-size="9" fill="var(--label-3)">Part Studio 1</text><rect x="86" y="46" width="70" height="16" rx="3" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5"/><text x="94" y="58" font-size="9" font-weight="600" fill="var(--accent-tx)">◈ Assembly 1</text>
          <path d="M190 54 h-26 M170 49 l-6 5 6 5" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="196" y="58" font-size="9.5" font-weight="600" fill="var(--accent-tx)">right-click → Export</text></svg></div></div>
        <div class="ic-step"><span class="n">2</span><div><b>Drop the zip here</b><p>Nothing is uploaded: the robot is read on this computer. Works on school Chromebooks.</p></div></div>
      </div>
      <div class="ic-drop" data-ic="pick" role="button" tabindex="0"><b>Drop the zip, or click to choose it</b><span>Also a STEP file, a URDF with its meshes, or a saved .ftcsim workspace</span></div>
      ${bad}
      <div class="ic-row"><span>Not on Onshape?</span><button class="linkish" type="button" data-ic="fusion">Fusion, SolidWorks, FreeCAD →</button><span>·</span><button class="linkish" type="button" data-ic="onshape-live">Read Onshape live (advanced)</button><span>·</span><button class="linkish" type="button" data-ic="close">Keep the demo robot</button></div>`;
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
      <form class="ic-code" id="icGh"><input id="icGhUrl" type="text" placeholder="or paste your team's GitHub repo" spellcheck="false" autocomplete="off"><button class="btn-sm primary" type="submit">Find OpModes</button></form>
      ${sample?`<p class="ic-note">The OpMode selected now is a sample written for another robot. <button class="ic-textbtn" type="button" data-ic="sample-ok">Drive this robot with it anyway</button></p>`:""}`;
  },
  htmlReview(){
    const A=SetupUI.auto(), B=this.bind(), rc=RC, F=CAD.frame||{};
    let D=null; try{ D=driveFromCAD(CAD,{front:OPTS.front}); }catch(e){}
    const W=D?D.wheels||[]:[], kindName={mecanum:"Mecanum",tank:"Tank",x:"X-drive",omni:"Omni",swerve:"Swerve"}[D&&D.kind]||null;
    const mass=(Sim.rig&&Sim.rig.props)||Physics.props, kg=mass&&!mass.assumed?mass.kg:null;
    const joints=CAD.mechs.filter(m=>!m.drive&&m.kind!=="fixed"&&!m.internal), exact=CAD.source==="onshape"||CAD.source==="urdf"||(CAD.mates&&CAD.mates.source==="spec"&&!CAD.mates.auto);
    const internal=CAD.mechs.filter(m=>m.internal).length;
    const devs=B?B.bound.length+B.open.length:0, bound=B?B.bound.length:0;
    const fact=(v,l,cls)=>`<div class="ic-fact${cls?" "+cls:""}"><b>${v}</b><span>${l}</span></div>`;
    const facts=[
      fact(esc(F.up?"up is "+F.up:"up"),A.up||SETUP.done.up?"from the wheels":"check",A.up||SETUP.done.up?"ok":"ask"),
      fact(esc("front "+OPTS.front),A.front||SETUP.done.front?"the way the wheels roll":"check",A.front||SETUP.done.front?"ok":"ask"),
      fact(esc(kindName?kindName+" ×"+W.length:"no wheels found"),kindName?Math.round((W[0]&&W[0].r||0)*2000)+" mm wheels":"set it by numbers",A.drive||SETUP.done.drive?"ok":"ask"),
      fact(joints.length+" joint"+(joints.length===1?"":"s"),exact?"exact, from your mates":"found from the geometry",exact?"ok":""),
      fact(bound+" of "+devs,"devices tied to joints",devs&&bound===devs?"ok":devs?"ask":""),
      kg?fact(kg.toFixed(1)+" kg","from the CAD's materials","ok"):"",
    ].join("");
    // the questions: the robot check's, then the binding's
    const qs=[];
    if(rc) for(const it of rc.items) if(it.sev==="fail"||it.sev==="warn") qs.push(this.qHtml(it));
    if(B) for(const o of B.open) qs.push(`<div class="ic-q"><b>Which part does <code>${esc(o.device)}</code> move?</b><div class="acts">`+
        o.candidates.map(c=>`<button class="btn-sm" type="button" data-rc="show" data-a="${esc(c.joint)}" title="${esc(c.why||"")}">${esc(c.label)}</button><button class="btn-sm primary" type="button" data-rc="pair" data-a="${esc(o.device+"|"+c.joint)}">this one</button>`).join("")+
        `<button class="btn-sm" type="button" data-rc="click" data-a="${esc(o.device)}">Click it in the CAD view</button><button class="btn-sm" type="button" data-rc="gauge" data-a="${esc(o.device)}">It moves nothing drawn</button></div></div>`);
    const notes=[];
    if(B&&B.couplings.length) notes.push(B.couplings.map(c=>`<li class="note"><i>↔</i><span class="t">"${esc(c.joint)}" follows "${esc(c.to)}"<small>${c.via==="cascade"?"a cascade slide: the stages extend together":"a gear pair: it turns the other way"}</small></span></li>`).join(""));
    if(internal) notes.push(`<li class="note"><i>·</i><span class="t">${internal} small turns left fixed<small>bearing races and motor shafts the library draws as mates</small></span></li>`);
    if(B&&B.idle.length) notes.push(`<li class="note"><i>·</i><span class="t">${B.idle.length} joint${B.idle.length===1?"":"s"} nothing in this OpMode drives<small>${esc(B.idle.slice(0,4).map(i=>i.label).join(", "))}${B.idle.length>4?" …":""}: they stay where they're drawn</small></span></li>`);
    const ready=!qs.length;
    return `<div class="ic-head"><div><h2>${ready?"Ready to drive":"Almost there"}</h2><p>${ready?"Everything the bench needs, it read from your robot and your code. Press INIT, then START.":qs.length+" thing"+(qs.length===1?"":"s")+" only you can answer. Each answer is kept with this robot."}</p></div>
      <button class="ic-x" type="button" data-ic="close" aria-label="Close">×</button></div>
      <div class="ic-facts">${facts}</div>
      ${qs.join("")}
      ${notes.length?`<ul class="ic-list">${notes.join("")}</ul>`:""}
      <div class="ic-foot"><button class="btn-sm primary" type="button" data-ic="${ready?"close":"accept"}">${ready?"Looks right":"Looks right as it is"}</button>
        <button class="btn-sm" type="button" data-ic="cad">Open the CAD view</button><button class="btn-sm" type="button" data-ic="save">Save setup</button><span class="spacer"></span><span class="dim">${esc(CAD.name||"")}</span></div>`;
  },
  qHtml(it){
    const btn=(act,arg,txt,cls)=>`<button class="btn-sm${cls?" "+cls:""}" type="button" data-rc="${act}" data-a="${esc(arg)}">${esc(txt)}</button>`;
    let acts="";
    if(it.ask==="pick-parts") acts=(it.candidates||[]).map(c=>btn("show",c.joint,c.label)+btn("pair",it.device+"|"+c.joint,"this one","primary")).join("")+btn("click",it.device,"Click it in the CAD view");
    else if(it.ask==="pick-device") acts=btn("show",it.joint,"show")+(it.candidates||[]).map(c=>btn("pair",c.device+"|"+it.joint,c.device)).join("")+btn("drop",it.joint,"not a joint");
    else if(it.ask==="drop-joint") acts=btn("show",it.joint,"show")+btn("drop",it.joint,"remove it","primary");
    else if(it.ask==="look"&&it.joint) acts=btn("show",it.joint,"show me");
    else if(it.ask==="mates") acts=btn("mates","","Bring the robot from Onshape");
    return `<div class="ic-q"><b>${esc(it.text)}</b>${acts?`<div class="acts">${acts}</div>`:""}</div>`;
  },

  /* ---------------- clicks ---------------- */
  click(e){
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
    else if(k==="onshape-live") OnshapeHelp.open();
    else if(k==="fusion") this.fusion();
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
    this.progress("Placing it on the field …",1,1);
    const cad=r.cad; cad.name=r.name||file.name.replace(/\.zip$/i,"");
    LAST_STEP={name:cad.name, text:"", urdfZip:true, label:cad.name+" · from "+(/onshape|urdf/i.test(file.name)?"Onshape":"URDF")};
    JOINTS.spec=JOINTS.report=JOINTS.devices=null; JOINTS.name=JOINTS.step=null;
    MATES.asm=MATES.features=MATES.name=MATES.report=MATES.url=null; MATES.fromLink=false;
    // which of the export's joints are mechanisms (the rest are bearings, shafts, rollers): before anything is said about them
    classifyJoints(cad);
    const n=cad.mechs.filter(m=>m.fromMate&&!m.internal).length, hid=cad.mechs.filter(m=>m.fromMate&&m.internal).length;
    loadCAD(cad, cad.name+" · from URDF · "+cad.solids.length+" parts · "+n+" joint"+(n===1?"":"s")+(hid?" ("+hid+" bearings and shafts left fixed)":""), "ok");
    // the export's own surfaces, thinned in the worker: exact geometry with nothing more to load
    const ex=typeof urdfExact==="function"?urdfExact(cad):null;
    if(ex&&ex.meshes.length){
      EXACT={state:"ok", msg:null}; View.setExact(cad,ex);
      const note=$("#exactNote"); if(note){ note.textContent="Exact geometry: "+ex.meshes.length+" parts from "+ex.shapes+" shapes in the export, "+(cad.urdf?(cad.urdf.triangles/1e6).toFixed(1)+" M triangles":"")+"."; note.className="hint"; }
      if(CadView.on) CadView.renderTree();
    }
    recomputeChain(cad.mechs);
    classifyJoints(cad);
    const mine=savedJoints(cad.name); if(mine){ JOINTS.spec=mine; JOINTS.step=cad.name; JOINTS.name="your joints"; applyJoints(); }
    $("#mateStatus").textContent=cad.name+" · whole robot from URDF · "+n+" joint"+(n===1?"":"s"); $("#mateDrop").className="drop ok";
    $("#mateNote").innerHTML=(cad.onshape&&cad.onshape.why||[]).map(w=>"<li>"+esc(w)+"</li>").join("");
    const pill=$("#matePill"); if(pill){ pill.textContent=n+" joint"+(n===1?"":"s"); pill.className="pill ok"; }
    if(CODE) rebuild();
    this.finish();
  },
};
