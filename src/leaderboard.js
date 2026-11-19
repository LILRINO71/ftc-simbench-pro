/* ============================================================
   LEADERBOARD — personal bests, and a board everyone shares
   ------------------------------------------------------------
   Personal bests are always kept: in this browser, one per robot, OpMode and
   mode (TeleOp or Auto), and shown on the results card under the score.

   When the site has a place to keep scores (a Cloudflare KV namespace,
   DEPLOY.md "Shared leaderboard"), the card also shows the top of the shared
   board and a Post my score button. The server is functions/leaderboard. When
   it isn't set up, it answers 501 and this file says nothing about it: the
   card just shows personal bests. Nothing is sent unless the player presses
   Post, and what is sent is a display name they typed, the score, and the
   robot's and OpMode's names. No account, no e-mail.

   The helpers above Board are pure, for the tests (tests/leaderboard.test.mjs).
   ============================================================ */
/* the most one alliance can score (functions/leaderboard LIMITS: the same numbers) */
const LB_MAX={teleop:500, auto:150};
const LB_TOP=50, LB_PB_KEY="ftcbench.lb.pb", LB_NAME_KEY="ftcbench.lbName", LB_PB_MAX=200;
const lbMode=p=>/^auto/i.test(String(p||""))?"auto":"teleop";
const lbModeName=m=>m==="auto"?"Auto":"TeleOp";
/* a display name as the server wants it: no control characters, spaces tidied, 24 long at most */
function lbName(v){ return String(v==null?"":v).replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,24); }
/* a robot's or OpMode's name for comparing: "Meet 0.step" and "meet 0" are the same */
function lbNorm(s){ return String(s==null?"":s).replace(/\.(step|stp|zip|urdf)$/i,"").replace(/\s+/g," ").trim().toLowerCase().slice(0,48); }
const lbId=(robot,opmode,mode)=>lbNorm(robot)+"|"+lbNorm(opmode)+"|"+lbMode(mode);
const lbEsc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---- personal bests: {id: {robot, opmode, mode, score, when, posted}} ---- */
function lbPbRead(s){
  let o=null; try{ o=s?JSON.parse(s):null; }catch(e){ o=null; }
  const out={};
  if(!o||typeof o!=="object"||Array.isArray(o)) return out;
  for(const id of Object.keys(o).slice(0,LB_PB_MAX)){
    const e=o[id]; if(!e||typeof e!=="object"||!Number.isInteger(e.score)||e.score<1) continue;
    out[id]={robot:String(e.robot||"").slice(0,60), opmode:String(e.opmode||"").slice(0,60), mode:lbMode(e.mode), score:e.score,
      when:typeof e.when==="string"?e.when.slice(0,10):null, posted:Number.isInteger(e.posted)?e.posted:0};
  }
  return out;
}
/* One run against the bests: {map (a new object), prev (the best before, or null), best, isNew}.
   A score of 0 isn't a best, and a tie isn't a new one. At most LB_PB_MAX bests are kept (the oldest go). */
function lbPbUpdate(map,run){
  const id=lbId(run.robot,run.opmode,run.mode), score=Math.round(+run.score)||0;
  const m=Object.assign({},map||{}), prev=m[id]||null;
  if(score<1) return {map:m, prev, best:prev, isNew:false, id};
  const isNew=!prev||score>prev.score;
  if(isNew) m[id]={robot:String(run.robot||"").slice(0,60), opmode:String(run.opmode||"").slice(0,60), mode:lbMode(run.mode), score, when:run.when||null, posted:prev?prev.posted:0};
  const ids=Object.keys(m);
  if(ids.length>LB_PB_MAX){ ids.sort((a,b)=>String(m[a].when||"").localeCompare(String(m[b].when||""))); for(const k of ids.slice(0,ids.length-LB_PB_MAX)) if(k!==id) delete m[k]; }
  return {map:m, prev, best:m[id], isNew, id};
}
/* the bests to list: this run's first, then the rest by when they were set (newest first), then score */
function lbPbList(map,currentId,limit){
  const rows=Object.keys(map||{}).map(id=>Object.assign({id, now:id===currentId},map[id]));
  rows.sort((a,b)=>(b.now-a.now)||String(b.when||"").localeCompare(String(a.when||""))||b.score-a.score);
  return rows.slice(0,limit||5);
}

/* ---- the shared board, and this player on it ---- */
/* where a score would sit among entries (best first): 1-based, after anyone level with it; null past the top 50 */
function lbRank(entries,score){
  let n=0; for(const e of entries||[]) if(e.score>=score) n++;
  return n<LB_TOP?n+1:null;
}
/* The board as the player sees it. mine: {name, robot, score} (this player's best here, with the name they post under),
   or null. Returns {rows: the entries with rank and `me` set, mine: {rank, posted, better}} where `posted` is whether the
   board holds this score or more under that name, and `better` is the score the board holds when it's lower. */
function lbMerge(entries,mine){
  const rows=(entries||[]).map((e,i)=>({rank:i+1, name:e.name, score:e.score, robot:e.robot, opmode:e.opmode, date:e.date, me:false}));
  if(!mine||!mine.name) return {rows, mine:null};
  const nm=lbName(mine.name).toLowerCase(), rb=lbNorm(mine.robot);
  const at=rows.findIndex(r=>String(r.name).toLowerCase()===nm&&lbNorm(r.robot)===rb);
  if(at>=0){ rows[at].me=true; }
  const held=at>=0?rows[at].score:0;
  if(at>=0&&held>=mine.score) return {rows, mine:{rank:rows[at].rank, posted:true, better:0}};
  // not on the board yet, or on it with less: where the new score would go
  const others=rows.filter((_,i)=>i!==at);
  const rank=lbRank(others,mine.score);
  return {rows, mine:{rank, posted:false, better:held}};
}

/* ---- the card ---- */
/* v: {mode, runScore, isNew, prev, bests (lbPbList), shared: {rows, mine} | null, name, msg, busy}
   Everything typed by a player or read from the board goes through lbEsc. */
function lbCardHtml(v){
  const M=lbModeName(v.mode);
  let h=`<div class="lb"><h4>Your best scores</h4>`;
  h+=`<ul class="lb-pb">`+(v.bests||[]).map(b=>`<li class="${b.now?"now":""}"><span>${lbEsc(b.robot||"robot")}<small>${lbEsc(b.opmode||"OpMode")} · ${lbModeName(b.mode)}</small></span><b>${b.score}</b>${b.now&&v.isNew?`<i>new</i>`:""}</li>`).join("")+`</ul>`;
  if(v.shared){
    const rows=v.shared.rows, mine=v.shared.mine, top=rows.slice(0,5);
    const shown=top.slice(); const extra=rows.find(r=>r.me&&r.rank>5);
    h+=`<h4>Shared board · ${M}</h4>`;
    h+=rows.length?`<ol class="lb-rows">`+shown.map(r=>lbRowHtml(r)).join("")+(extra?`<li class="gap">…</li>`+lbRowHtml(extra):"")+`</ol>`:`<p class="lb-empty">Nobody has posted a ${M} score yet.</p>`;
    if(mine&&mine.posted) h+=`<p class="lb-note">You are #${mine.rank} on the board.</p>`;
    else if(v.runScore>0){
      h+=`<form class="lb-post" id="lbForm"><input id="lbName" maxlength="24" value="${lbEsc(v.name||"")}" placeholder="Team number or name" aria-label="Name for the board" autocomplete="off" spellcheck="false">`+
         `<button class="btn-sm primary" id="lbPost" type="submit"${v.busy?" disabled":""}>Post ${v.runScore}</button></form>`+
         `<p class="lb-note">${mine&&mine.rank?"It would be #"+mine.rank+". ":mine?"It is below the top "+LB_TOP+". ":""}Posting sends this name, the score, and the robot's and OpMode's names. Nothing else.</p>`;
    }
  }
  if(v.msg) h+=`<p class="lb-msg" role="status">${lbEsc(v.msg)}</p>`;
  return h+`</div>`;
}
const lbRowHtml=r=>`<li class="${r.me?"me":""}"><span class="r">${r.rank}</span><span class="n">${lbEsc(r.name)}<small>${lbEsc(r.robot)}</small></span><b>${r.score}</b></li>`;

/* ---- the page ---- */
const Board={
  state:"unknown",      // unknown | ready | off: whether the site has a shared board
  boards:null, view:null, el:null, msg:"", busy:false, started:false,
  /* does this site have a shared board? asked once; any answer but a board means no, silently */
  async ensure(){
    if(this.state!=="unknown") return this.state==="ready";
    try{
      const r=await fetch("/leaderboard",{headers:{Accept:"application/json"}});
      if(r.ok&&/json/.test(r.headers.get("content-type")||"")){ const j=await r.json(); if(j&&j.boards&&typeof j.boards==="object"){ this.boards=j.boards; this.state="ready"; return true; } }
    }catch(e){}
    this.state="off"; return false;
  },
  async refresh(){
    if(this.state!=="ready") return;
    try{ const r=await fetch("/leaderboard",{headers:{Accept:"application/json"}}); const j=r.ok?await r.json():null; if(j&&j.boards) this.boards=j.boards; }catch(e){}
  },
  /* a run's end: keep it if it's a best, and return what the card needs */
  record(meta,score){
    const run={robot:meta&&meta.robot||"", opmode:meta&&meta.opmode||"", mode:lbMode(meta&&meta.period), score, when:new Date().toISOString().slice(0,10)};
    const U=lbPbUpdate(lbPbRead(store.get(LB_PB_KEY,null)),run);
    if(U.isNew){ try{ store.set(LB_PB_KEY,JSON.stringify(U.map)); }catch(e){} }
    return {run, id:U.id, isNew:U.isNew, prev:U.prev, map:U.map, best:U.best};
  },
  /* draw the card's board part into el, then, once we know whether there is a shared board, again */
  show(el,rec){
    if(!el) return;
    this.el=el; this.rec=rec; this.msg=""; this.busy=false;
    if(!this.started){ this.started=true; el.addEventListener("submit",e=>{ if(e.target.id==="lbForm"){ e.preventDefault(); this.post(); } }); }
    this.draw();
    this.ensure().then(ok=>{ if(ok&&this.rec===rec) return this.refresh().then(()=>{ if(this.rec===rec) this.draw(); }); });
  },
  name(){ return lbName(store.get(LB_NAME_KEY,"")||store.get("ftcbench.netName","")); },
  draw(){
    if(!this.el||!this.rec) return;
    const r=this.rec, mode=r.run.mode;
    let shared=null;
    if(this.state==="ready"&&this.boards&&Array.isArray(this.boards[mode])){
      const best=r.best||{score:0}, name=this.name();
      shared=lbMerge(this.boards[mode],name&&best.score>0?{name, robot:r.run.robot, score:best.score}:null);
      if(shared.mine&&!shared.mine.posted&&best.score>0&&best.posted>=best.score) shared.mine.posted=true;
    }
    const best=r.best, v={mode, runScore:best?best.score:0, isNew:r.isNew, prev:r.prev, bests:lbPbList(r.map,r.id,3), shared, name:this.name(), msg:this.msg, busy:this.busy};
    this.el.innerHTML=lbCardHtml(v);
  },
  async post(){
    const r=this.rec; if(!r||this.busy||!r.best) return;
    const inp=this.el.querySelector("#lbName"), name=lbName(inp&&inp.value);
    if(!name){ this.msg="Put a name in first."; this.draw(); return; }
    try{ store.set(LB_NAME_KEY,name); }catch(e){}
    this.busy=true; this.msg="Posting…"; this.draw();
    try{
      const res=await fetch("/leaderboard",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},
        body:JSON.stringify({name, score:r.best.score, mode:r.run.mode, robot:r.run.robot, opmode:r.run.opmode})});
      const j=await res.json().catch(()=>null);
      if(res.ok&&j&&j.ok){
        if(this.boards&&Array.isArray(j.entries)) this.boards[r.run.mode]=j.entries;
        r.best.posted=r.best.score; r.map[r.id]=r.best;
        try{ store.set(LB_PB_KEY,JSON.stringify(r.map)); }catch(e){}
        this.msg=j.rank?(j.improved?"Posted. You are #"+j.rank+".":"Already on the board at #"+j.rank+"."):"Posted, but it is below the top "+LB_TOP+".";
      }else this.msg=(j&&j.message)||"The board couldn't take that score.";
    }catch(e){ this.msg="Couldn't reach the board. Try again in a moment."; }
    this.busy=false; this.draw();
  },
};
