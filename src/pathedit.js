/* ============================================================
   THE PATH EDITOR — draw an auto, get its Pedro Pathing code
   ------------------------------------------------------------
   A field from above in a panel over the viewport. The starting pose is
   where the robot stands now; click the field to add a leg ending there,
   drag any end or control point to move it, drag the little handle beside
   a pose to turn it. Each leg is a line, or a curve with one or two
   control points; its heading is linear, tangent or constant; it can be
   driven backwards; it can wait after it. As it changes, the path is drawn
   on the 3D field too.

   Run it puts the generated OpMode (src/pedrogen.js pedroJava) in the
   OpMode list, with a stand-in pedroPathing/Constants.java when the team
   hasn't loaded theirs, places the robot at the start and presses INIT and
   START. Copy Java and Save .java hand the code over; the path itself is
   kept in this browser and saves as a small JSON a teammate can open.
   ============================================================ */
const PathEdit={
  P:null, sel:null, drag:null, cv:null, on:false,
  init(){
    const b=$("#pathBtn"); if(!b) return;
    b.addEventListener("click",()=>this.toggle());
    $("#peClose").addEventListener("click",()=>this.close());
    this.cv=$("#peField");
    this.cv.addEventListener("pointerdown",e=>this.down(e));
    this.cv.addEventListener("pointermove",e=>this.move(e));
    addEventListener("pointerup",()=>{ if(this.drag){ this.drag=null; this.changed(); } });
    $("#peLegs").addEventListener("input",e=>this.edit(e));
    $("#peLegs").addEventListener("change",e=>this.edit(e));
    $("#peLegs").addEventListener("click",e=>this.legClick(e));
    $("#peRun").addEventListener("click",()=>this.run());
    $("#peCopy").addEventListener("click",()=>this.copy());
    $("#peSave").addEventListener("click",()=>this.saveJava());
    $("#peNew").addEventListener("click",()=>{ this.P=pedroNew(this.startHere()); this.sel=null; this.changed(); });
    $("#peName").addEventListener("input",e=>{ if(this.P){ this.P.name=e.target.value.slice(0,40); this.store(); this.renderCode(); } });
    $("#peFile").addEventListener("click",()=>this.download());
    $("#peLink").addEventListener("click",()=>this.shareLink());
    // a shared link opens its path (and keeps the address clean afterwards)
    const fromHash=()=>{ const m=/^#path=([A-Za-z0-9_-]+)/.exec(location.hash||""); if(!m) return;
      try{ history.replaceState(null,"",location.pathname+location.search); }catch(e){}
      try{ this.P=pedroFromHash(m[1]); this.store(); this.open(); this.say("Opened a shared path. Run it, or change it and share it back."); }
      catch(e){ this.open(); this.say("That path link couldn't be read: "+e.message); } };
    addEventListener("hashchange",fromHash);
    this.fromHash=fromHash;
    try{ const s=store.get("ftcbench.pedroPath",null); if(s) this.P=pedroClean(JSON.parse(s)); }catch(e){ this.P=null; }
  },
  /* the robot where it stands, in Pedro's frame */
  startHere(){ const p=fieldToPedro(Sim.chassis||{x:0,y:0,h:0}); return {x:Math.round(p.x*10)/10, y:Math.round(p.y*10)/10, h:Math.round(p.h)}; },
  toggle(){ this.on?this.close():this.open(); },
  open(){
    if(!this.P) this.P=pedroNew(this.startHere());
    this.on=true; $("#pathPanel").hidden=false; $("#pathBtn").classList.add("on");
    $("#peName").value=this.P.name;
    this.render(); this.renderLegs(); this.renderCode(); this.show3d();
  },
  close(){ this.on=false; $("#pathPanel").hidden=true; $("#pathBtn").classList.remove("on"); if(View.setPath) View.setPath(null); },
  store(){ try{ store.set("ftcbench.pedroPath",JSON.stringify(this.P)); }catch(e){} },
  changed(){ this.store(); this.render(); this.renderLegs(); this.renderCode(); this.show3d(); },
  show3d(){ if(View.setPath&&this.P) View.setPath(pedroPolyline(this.P,20).map(p=>{ const f=pedroToField({x:p[0],y:p[1]}); return [f.x,f.y]; })); },

  /* ---------------- the field ---------------- */
  // the editor is drawn as Pedro draws it: x to the right, y up, (0, 0) bottom left
  geom(){ const cv=this.cv, W=cv.width, pad=10*(W/cv.clientWidth||1), s=(W-2*pad)/144; return {W, pad, s}; },
  toPx(x,y){ const g=this.geom(); return [g.pad+x*g.s, g.W-g.pad-y*g.s]; },
  toIn(px,py){ const g=this.geom(); return [(px-g.pad)/g.s, (g.W-g.pad-py)/g.s]; },
  ev(e){ const r=this.cv.getBoundingClientRect(), k=this.cv.width/r.width; return [(e.clientX-r.left)*k,(e.clientY-r.top)*k]; },
  /* everything a drag can grab: start, each end, each control point, each heading handle */
  handles(){
    const H=[], P=this.P, hd=(p,deg)=>{ const r=deg*Math.PI/180; return [p.x+10*Math.cos(r), p.y+10*Math.sin(r)]; };
    H.push({k:"start", x:P.start.x, y:P.start.y});
    { const [x,y]=hd(P.start,P.start.h); H.push({k:"starth", x, y}); }
    P.legs.forEach((L,i)=>{
      H.push({k:"end", i, x:L.to.x, y:L.to.y});
      const [x,y]=hd(L.to,L.to.h); H.push({k:"endh", i, x, y});
      (L.ctrl||[]).forEach((c,j)=>H.push({k:"ctrl", i, j, x:c[0], y:c[1]}));
    });
    return H;
  },
  down(e){
    if(!this.P) return;
    const [px,py]=this.ev(e), g=this.geom(), R=12*(this.cv.width/this.cv.clientWidth||1);
    let best=null, bd=R;
    for(const h of this.handles()){ const [hx,hy]=this.toPx(h.x,h.y), d=Math.hypot(hx-px,hy-py); if(d<bd){ bd=d; best=h; } }
    if(best){ this.drag=best; if(best.i!=null) this.sel=best.i; this.cv.setPointerCapture&&this.cv.setPointerCapture(e.pointerId); return; }
    // a click on the field: a new leg ending there, facing where it came from leaves it
    const [x,y]=this.toIn(px,py); if(x<0||x>144||y<0||y>144) return;
    const from=this.P.legs.length?this.P.legs[this.P.legs.length-1].to:this.P.start;
    this.P.legs.push({to:{x:pR(x), y:pR(y), h:from.h}, ctrl:[], heading:"linear", reversed:false, wait:0});
    this.sel=this.P.legs.length-1; this.changed();
    void g;
  },
  move(e){
    if(!this.drag||!this.P) return;
    const [px,py]=this.ev(e), [x0,y0]=this.toIn(px,py), x=pR(Math.max(0,Math.min(144,x0))), y=pR(Math.max(0,Math.min(144,y0)));
    const d=this.drag, P=this.P;
    if(d.k==="start"){ P.start.x=x; P.start.y=y; }
    else if(d.k==="end"){ P.legs[d.i].to.x=x; P.legs[d.i].to.y=y; }
    else if(d.k==="ctrl"){ P.legs[d.i].ctrl[d.j]=[x,y]; }
    else { const p=d.k==="starth"?P.start:P.legs[d.i].to; p.h=Math.round(Math.atan2(y-p.y,x-p.x)*180/Math.PI); }
    this.render(); this.show3d();
  },
  render(){
    const cv=this.cv; if(!cv||!this.P) return;
    const css=cv.clientWidth||360, dpr=Math.min(2,devicePixelRatio||1);
    if(cv.width!==Math.round(css*dpr)) cv.width=cv.height=Math.round(css*dpr);
    const c=cv.getContext("2d"), W=cv.width, g=this.geom(), P=this.P, k=dpr, F=Field.ok?Field.data.field:null;
    const T=(x,y)=>this.toPx(x,y), FX=(fx,fy)=>T(fx+72,fy+72);           // field inches (bench frame) to the canvas
    c.clearRect(0,0,W,W); c.fillStyle="#3a3d42"; c.fillRect(0,0,W,W);
    c.strokeStyle="rgba(255,255,255,.1)"; c.lineWidth=1;
    for(let i=0;i<=6;i++){ const [a]=T(i*24,0), [,b]=T(0,i*24); c.beginPath(); c.moveTo(a,g.pad); c.lineTo(a,W-g.pad); c.moveTo(g.pad,b); c.lineTo(W-g.pad,b); c.stroke(); }
    if(F){
      const rect=(z,fill)=>{ const a=FX(z.x0,z.y0), b=FX(z.x1,z.y1); c.fillStyle=fill; c.fillRect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1])); };
      rect(F.loadingZones.red,"rgba(229,72,61,.35)"); rect(F.loadingZones.blue,"rgba(47,124,246,.35)");
      rect(F.gardens.red,"rgba(229,72,61,.7)"); rect(F.gardens.blue,"rgba(47,124,246,.7)");
      for(const al of ["red","blue"]){ const [x,y]=FX(F.hive.hiveX[al],0); c.fillStyle="rgba(240,240,240,.85)"; c.beginPath(); c.arc(x,y,10*g.s,0,2*Math.PI); c.fill(); }
      for(const f of F.flowers){ const [x,y]=FX(f.x,f.y); c.fillStyle="#3fae5a"; c.fillRect(x-3*g.s,y-3*g.s,6*g.s,6*g.s); }
      // the walls the drivers stand at
      c.fillStyle="#e5483d"; c.fillRect(g.pad-4*k,g.pad,3*k,W-2*g.pad); c.fillStyle="#2f7cf6"; c.fillRect(W-g.pad+k,g.pad,3*k,W-2*g.pad);
    }
    // the control polygons, faint, then the path
    const curves=pedroCurves(P);
    c.setLineDash([4*k,4*k]); c.strokeStyle="rgba(255,255,255,.35)"; c.lineWidth=k;
    curves.forEach(pts=>{ if(pts.length>2){ c.beginPath(); pts.forEach((p,i)=>{ const [x,y]=T(p[0],p[1]); i?c.lineTo(x,y):c.moveTo(x,y); }); c.stroke(); } });
    c.setLineDash([]);
    curves.forEach((pts,i)=>{
      c.strokeStyle=i===this.sel?"#ffd23f":"#f2c230"; c.lineWidth=(i===this.sel?4:3)*k; c.beginPath();
      for(let s=0;s<=30;s++){ const p=bezierAt(pts,s/30), [x,y]=T(p[0],p[1]); s?c.lineTo(x,y):c.moveTo(x,y); }
      c.stroke();
    });
    // poses: a robot outline facing its heading, and its heading handle
    const robot=(p,col,label)=>{
      const [x,y]=T(p.x,p.y), r=-(p.h||0)*Math.PI/180, hs=9*g.s;
      c.save(); c.translate(x,y); c.rotate(r);
      c.strokeStyle=col; c.lineWidth=2*k; c.strokeRect(-hs,-hs,2*hs,2*hs);
      c.beginPath(); c.moveTo(hs,0); c.lineTo(hs+10*g.s-hs,0); c.lineTo(10*g.s,0); c.stroke();
      c.fillStyle=col; c.beginPath(); c.arc(10*g.s,0,3.2*k,0,2*Math.PI); c.fill();
      c.restore();
      c.fillStyle="#fff"; c.font="600 "+Math.round(11*k)+"px Inter, system-ui, sans-serif"; c.textAlign="center"; c.textBaseline="middle"; c.fillText(label,x,y);
    };
    robot(P.start,"#7cf29a","S");
    P.legs.forEach((L,i)=>{ robot(L.to,i===this.sel?"#ffd23f":"#ffffff",String(i+1));
      (L.ctrl||[]).forEach(cp=>{ const [x,y]=T(cp[0],cp[1]); c.fillStyle="#c9a6ff"; c.beginPath(); c.arc(x,y,4.5*k,0,2*Math.PI); c.fill(); }); });
    const len=pedroLength(P), chk=this.check();
    $("#peInfo").textContent=P.legs.length+" leg"+(P.legs.length===1?"":"s")+" · "+Math.round(len)+" in"+(chk.length?" · "+chk[0]:"");
    $("#peInfo").className="pe-info"+(chk.length?" warn":"");
  },
  /* the path against the field, with this robot's size */
  check(){ const fp=Sim.footprint||{hx:0.22,hy:0.22}; return pedroCheck(this.P,Field.ok?Field.obstacles(fp.h):null,Math.min(fp.hx,fp.hy)*0.9); },
  /* ---------------- the legs ---------------- */
  renderLegs(){
    const P=this.P, box=$("#peLegs"); if(!P||!box) return;
    const sel=(name,val,opts)=>`<select data-f="${name}">${opts.map(([v,t])=>`<option value="${v}"${v===val?" selected":""}>${t}</option>`).join("")}</select>`;
    const num=(f,v,step,w)=>`<input data-f="${f}" type="number" step="${step}" value="${v}" style="width:${w||54}px">`;
    box.innerHTML=`<div class="pe-leg start"><b>S</b><span>start</span>${num("sx",P.start.x,0.5)}${num("sy",P.start.y,0.5)}${num("sh",P.start.h,5,48)}°<button class="btn-sm" data-a="here" type="button" title="Where the robot stands now">here</button></div>`+
      P.legs.map((L,i)=>`<div class="pe-leg${i===this.sel?" on":""}" data-i="${i}"><b>${i+1}</b>
        ${sel("shape",String((L.ctrl||[]).length),[["0","line"],["1","curve"],["2","S-curve"]])}
        ${num("x",L.to.x,0.5)}${num("y",L.to.y,0.5)}${num("h",L.to.h,5,48)}°
        ${sel("heading",L.heading,[["linear","linear"],["tangent","tangent"],["constant","constant"]])}
        <label title="Drive this leg backwards"><input type="checkbox" data-f="reversed"${L.reversed?" checked":""}>back</label>
        <label title="Wait after this leg (s): your mechanism's time">wait ${num("wait",L.wait,0.1,44)}</label>
        <button class="pe-rm" data-a="rm" type="button" aria-label="Remove leg ${i+1}">×</button></div>`).join("");
  },
  edit(e){
    const t=e.target, f=t.dataset.f, P=this.P; if(!f||!P) return;
    const row=t.closest("[data-i]"), i=row?+row.dataset.i:null, v=+t.value;
    if(f==="sx"&&Number.isFinite(v)) P.start.x=v; else if(f==="sy"&&Number.isFinite(v)) P.start.y=v; else if(f==="sh"&&Number.isFinite(v)) P.start.h=v;
    else if(i!=null){
      const L=P.legs[i];
      if((f==="x"||f==="y"||f==="h")&&Number.isFinite(v)) L.to[f]=v;
      else if(f==="wait"&&Number.isFinite(v)) L.wait=Math.max(0,Math.min(30,v));
      else if(f==="heading") L.heading=t.value;
      else if(f==="reversed") L.reversed=t.checked;
      else if(f==="shape"){ const n=+t.value, from=i?P.legs[i-1].to:P.start;
        // new control points on the straight line, a third and two thirds along, nudged aside so they show
        const at=s=>[pR(from.x+(L.to.x-from.x)*s-(L.to.y-from.y)*0.2), pR(from.y+(L.to.y-from.y)*s+(L.to.x-from.x)*0.2)];
        L.ctrl=n===0?[]:n===1?[(L.ctrl&&L.ctrl[0])||at(0.5)]:[(L.ctrl&&L.ctrl[0])||at(1/3),(L.ctrl&&L.ctrl[1])||at(2/3)]; }
      this.sel=i;
    }
    if(e.type==="change"||f==="shape"||f==="heading"||f==="reversed") this.changed(); else { this.store(); this.render(); this.renderCode(); this.show3d(); }
  },
  legClick(e){
    const b=e.target.closest("[data-a]"), row=e.target.closest("[data-i]");
    if(b&&b.dataset.a==="rm"&&row){ this.P.legs.splice(+row.dataset.i,1); if(!this.P.legs.length) this.P=pedroNew(this.P.start); this.sel=null; this.changed(); return; }
    if(b&&b.dataset.a==="here"){ this.P.start=this.startHere(); this.changed(); return; }
    if(row&&!e.target.closest("input,select,label")){ this.sel=+row.dataset.i; this.render(); this.renderLegs(); }
  },
  /* ---------------- the code ---------------- */
  java(){ return pedroJava(this.P); },
  renderCode(){ const pre=$("#peCode"); if(pre&&this.P) pre.textContent=this.java().src; },
  async copy(){
    const src=this.java().src; let ok=false;
    try{ await navigator.clipboard.writeText(src); ok=true; }catch(e){}
    this.say(ok?"Copied. Paste it into a new file in your TeamCode.":"Your browser blocked copying: use Save .java.");
  },
  saveJava(){ const J=this.java(); this.file(J.file,J.src,"text/x-java"); },
  download(){ this.file(pedroClass(this.P.name)+".pedropath.json",JSON.stringify(this.P,null,1),"application/json"); },
  async shareLink(){
    const url=location.origin+location.pathname+"#path="+pedroToHash(this.P);
    let ok=false; try{ await navigator.clipboard.writeText(url); ok=true; }catch(e){}
    this.say(ok?"Link copied: whoever opens it gets this path in the editor.":"Copy this link: "+url);
  },
  file(name,text,type){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); },
  say(t){ const s=$("#peMsg"); if(s){ s.textContent=t||""; s.hidden=!t; } },
  /* a dropped .pedropath.json opens here */
  take(text){ try{ this.P=pedroClean(JSON.parse(text)); this.open(); this.changed(); return true; }catch(e){ this.say("That path couldn't be read: "+e.message); return false; } },
  /* run it on the bench: the OpMode in the list (and a stand-in Constants if the team has none),
     the robot at the start, INIT, START */
  run(){
    if(!this.P) return;
    const chk=this.check(); if(chk.some(s=>/goes nowhere|no legs/.test(s))){ this.say(chk[0]); return; }
    const hasConst=helperFiles().some(h=>/\bclass\s+Constants\b/.test(h.src)&&/createFollower/.test(h.src));
    if(!hasConst&&!BUILTIN_HELPERS.some(h=>h.file==="Constants.java"&&h.team==="SimBench stand-in")){
      BUILTIN_HELPERS.push({file:"Constants.java", src:PEDRO_CONSTANTS_JAVA, team:"SimBench stand-in"});
    }
    const J=this.java();
    addOpModeFromText(J.file,J.src);
    if(!CODE){ this.say("The OpMode didn't load: see the Code tab."); return; }
    const f=pedroToField(this.P.start);
    Sim.chassis={x:f.x, y:f.y, h:f.h};
    if(Field.ok&&Sim.footprint) Field.collide(Sim.chassis,Sim.footprint,Sim.obstacles);
    OPTS.startPose=Object.assign({},Sim.chassis);
    dsInit(); setTimeout(()=>{ dsStart(); this.say("Running "+J.cls+" on the bench. The robot drives what the code says."); },150);
  },
};
