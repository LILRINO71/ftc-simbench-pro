/* ============================================================
   MATCH CLIPS — the field as a video, and its replay
   ------------------------------------------------------------
   Teams share driving on Discord as clips. The recorder draws each frame
   of the 3D view onto a canvas of its own, with the score, the clock and
   the robot's name on top (they are page elements, not in the 3D view),
   and the browser's MediaRecorder turns that canvas into a video. When it
   stops, the replay plays in the viewport with a scrubber, and the clip
   saves as a file.

   Record by hand (the ● Clip button), or let every match record itself
   from START to the final buzzer. Nothing is uploaded: the clip is made
   and kept on this computer until it is saved.

   The helpers above Recorder are pure, for the tests.
   ============================================================ */
const REC_TYPES=["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm","video/mp4;codecs=avc1","video/mp4"];
const REC_FPS=30, REC_MAX=1280, REC_SITE="ftc-simbench-pro.pages.dev";

/* the first video type this browser can record, or null */
function recPickType(isSupported){
  for(const t of REC_TYPES){ try{ if(isSupported(t)) return t; }catch(e){} }
  return null;
}
/* the clip's size: the view's own, at most max on its long side, both even (encoders want that) */
function recSize(w,h,max){
  w=Math.max(1,+w||1); h=Math.max(1,+h||1); max=max||REC_MAX;
  const k=Math.min(1,max/Math.max(w,h)), even=v=>Math.max(2,Math.round(v*k/2)*2);
  return {w:even(w), h:even(h)};
}
/* the clip's long side for a drawing tier: 854 (480p) on tier 0, else 1280 (720p) */
function recMaxFor(tier){ return tier===0?854:REC_MAX; }
/* a file name a team can tell apart later: the robot, the date and time, the right extension */
function recFileName(robot,when,type){
  const slug=String(robot||"robot").replace(/\.(step|stp|zip|urdf)$/i,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"robot";
  const d=when instanceof Date&&!isNaN(when)?when:new Date(0), p=n=>String(n).padStart(2,"0");
  const stamp=d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"-"+p(d.getHours())+p(d.getMinutes());
  return "simbench-"+slug+"-"+stamp+(/mp4/.test(type||"")?".mp4":".webm");
}
/* what the clip shows on top of the field: {red, blue, mid, left, mark} as text, or null parts
   s: {match:bool, red, blue, period:"TeleOp"|"Autonomous", clock:"1:23", final:bool, robot, opmode, site} */
function recHud(s){
  s=s||{};
  const mid=s.final?"FINAL":(s.period==="Autonomous"?"AUTO":"TELEOP")+(s.clock?" "+s.clock:"");
  return {
    red:s.match?String(s.red|0):null, blue:s.match?String(s.blue|0):null, mid,
    left:[s.robot,s.opmode].filter(Boolean).join(" · ").slice(0,80),
    mark:"FTC SimBench · "+(s.site||REC_SITE)
  };
}

const Recorder={
  on:false, rec:null, chunks:[], cv:null, ctx:null, type:null, t0:0, url:null, blob:null, auto:false, why:null,
  /* whether this browser can make a clip at all */
  supported(){
    try{ return typeof MediaRecorder!=="undefined"&&typeof HTMLCanvasElement!=="undefined"&&!!HTMLCanvasElement.prototype.captureStream
      &&!!recPickType(t=>MediaRecorder.isTypeSupported(t)); }catch(e){ return false; }
  },
  /* start recording the view; auto: started by START, stopped by the end of the run */
  start(auto){
    if(this.on) return true;
    if(!this.supported()){ this.why="This browser can't record video. Chrome, Edge and Firefox can."; return false; }
    const src=View.ren&&View.ren.domElement; if(!src){ this.why="The 3D view isn't ready yet."; return false; }
    // a tier-0 machine (src/tier.js: a school Chromebook) records at 480p, so the clip doesn't cost it frames
    const S=recSize(src.width,src.height,recMaxFor(View.tier&&View.tier.tier));
    this.cv=document.createElement("canvas"); this.cv.width=S.w; this.cv.height=S.h;
    this.ctx=this.cv.getContext("2d");
    this.type=recPickType(t=>MediaRecorder.isTypeSupported(t));
    this.chunks=[];
    try{
      const stream=this.cv.captureStream(REC_FPS);
      this.rec=new MediaRecorder(stream,{mimeType:this.type, videoBitsPerSecond:S.w>=1280?6e6:3.5e6});
    }catch(e){ this.why="Recording couldn't start: "+(e&&e.message||e); this.rec=null; return false; }
    this.rec.ondataavailable=e=>{ if(e.data&&e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.on=true; this.auto=!!auto; this.t0=performance.now(); this.why=null;
    this.bg=null;
    this.render();
    return true;
  },
  /* stop and hand back the clip (a Blob), or null when nothing was recorded */
  stop(){
    if(!this.on||!this.rec) return Promise.resolve(null);
    this.on=false;
    const rec=this.rec; this.rec=null;
    return new Promise(res=>{
      rec.onstop=()=>{
        const blob=this.chunks.length?new Blob(this.chunks,{type:(this.type||"video/webm").split(";")[0]}):null;
        this.chunks=[];
        if(this.url) try{ URL.revokeObjectURL(this.url); }catch(e){}
        this.blob=blob; this.url=blob?URL.createObjectURL(blob):null;
        this.render();
        res(blob);
      };
      try{ rec.stop(); }catch(e){ rec.onstop(); }
    });
  },
  secs(){ return this.on?(performance.now()-this.t0)/1000:0; },
  /* one frame: the 3D view, then the score and the name on top. Called right after
     View.render, in the same frame, so the WebGL canvas still holds its picture. */
  frame(hud){
    if(!this.on||!this.ctx) return;
    const src=View.ren&&View.ren.domElement; if(!src) return;
    const c=this.ctx, W=this.cv.width, H=this.cv.height;
    if(!this.bg){ try{ this.bg=getComputedStyle(document.getElementById("viewport")).backgroundColor; }catch(e){}
      // the view shows the page through it: the page's own background, light or dark
      if(!this.bg||/rgba\(0, 0, 0, 0\)|transparent/.test(this.bg)) this.bg=document.documentElement.getAttribute("data-theme")==="dark"?"#1c1c1e":"#dfe4ea"; }
    c.fillStyle=this.bg; c.fillRect(0,0,W,H);                // the view is transparent where the page shows through
    c.drawImage(src,0,0,W,H);
    const h=recHud(hud), k=H/720;
    c.textBaseline="middle"; c.font="600 "+Math.round(24*k)+"px Inter, system-ui, sans-serif";
    // the score bar, top centre
    if(h.red!=null){
      const bw=Math.round(360*k), bh=Math.round(46*k), x=(W-bw)/2, y=Math.round(14*k);
      c.fillStyle="rgba(14,15,17,.78)"; this.round(c,x,y,bw,bh,bh/2); c.fill();
      c.textAlign="left"; c.fillStyle="#ff6b61"; c.fillText(h.red,x+Math.round(22*k),y+bh/2);
      c.textAlign="right"; c.fillStyle="#69a3ff"; c.fillText(h.blue,x+bw-Math.round(22*k),y+bh/2);
      c.textAlign="center"; c.fillStyle="#f2f2f2"; c.font="600 "+Math.round(16*k)+"px Inter, system-ui, sans-serif"; c.fillText(h.mid,W/2,y+bh/2);
    }else{
      c.textAlign="center"; c.fillStyle="rgba(14,15,17,.7)"; c.font="600 "+Math.round(16*k)+"px Inter, system-ui, sans-serif";
      c.fillText(h.mid,W/2,Math.round(30*k));
    }
    // the robot and OpMode, bottom left; where it was made, bottom right
    c.font="500 "+Math.round(15*k)+"px Inter, system-ui, sans-serif";
    c.textAlign="left"; c.fillStyle="rgba(14,15,17,.72)"; if(h.left) c.fillText(h.left,Math.round(16*k),H-Math.round(20*k));
    c.textAlign="right"; c.fillText(h.mark,W-Math.round(16*k),H-Math.round(20*k));
    // a red dot while recording (only in the page, never in the clip)
  },
  round(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); },

  /* ---------------- the page ---------------- */
  init(){
    const b=$("#recBtn"); if(!b) return;
    if(!this.supported()){ b.hidden=true; return; }
    b.hidden=false;
    b.addEventListener("click",()=>this.toggle());
    const auto=$("#recAuto"); if(auto){ auto.checked=store.get("ftcbench.recAuto","0")==="1"; auto.addEventListener("change",()=>store.set("ftcbench.recAuto",auto.checked?"1":"0")); }
    $("#replayClose").addEventListener("click",()=>this.hide());
    $("#replaySave").addEventListener("click",()=>this.save());
    const sh=$("#replayShare"); if(sh) sh.addEventListener("click",()=>this.share());
  },
  wantsAuto(){ const a=$("#recAuto"); return !!(a&&a.checked); },
  async toggle(){
    if(this.on){ const blob=await this.stop(); if(blob) this.show(); else this.say("Nothing was recorded."); }
    else if(!this.start(false)) this.say(this.why);
  },
  say(t){ const s=$("#cadStatus"); if(s&&t) s.textContent=t; },
  render(){
    const b=$("#recBtn"); if(!b) return;
    b.classList.toggle("on",this.on);
    b.querySelector("span").textContent=this.on?"Stop clip":"Clip";
    b.title=this.on?"Stop recording and watch it back":"Record the field as a video clip, with the score on it";
  },
  /* each tick of the page's slow loop: the button shows how long it has run */
  tick(){ if(this.on){ const b=$("#recBtn"); if(b){ const s=Math.floor(this.secs()); b.querySelector("span").textContent="Stop "+Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); } } },
  show(){
    if(!this.url) return;
    const p=$("#replayPanel"), v=$("#replayVideo"); if(!p||!v) return;
    v.src=this.url; p.hidden=false;
    const mb=this.blob?(this.blob.size/1048576).toFixed(1):"0";
    $("#replayInfo").textContent=mb+" MB · "+(/mp4/.test(this.type||"")?"MP4":"WebM")+" · made on this computer";
    const sh=$("#replayShare"); if(sh) sh.hidden=!(navigator.canShare&&this.blob&&navigator.canShare({files:[new File([this.blob],"clip.webm",{type:this.blob.type})]}));
    try{ v.currentTime=0; v.play().catch(()=>{}); }catch(e){}
  },
  hide(){ const p=$("#replayPanel"), v=$("#replayVideo"); if(v) try{ v.pause(); }catch(e){} if(p) p.hidden=true; },
  name(){ return recFileName((typeof CAD!=="undefined"&&CAD&&CAD.name)||"robot",new Date(),this.type); },
  save(){
    if(!this.blob) return;
    const a=document.createElement("a"); a.href=this.url; a.download=this.name();
    document.body.appendChild(a); a.click(); a.remove();
  },
  async share(){
    if(!this.blob||!navigator.share) return;
    try{ await navigator.share({files:[new File([this.blob],this.name(),{type:this.blob.type})], title:"FTC SimBench clip"}); }catch(e){}
  },
};
