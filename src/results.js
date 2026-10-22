/* ============================================================
   RESULTS — the final score, line by line, and a personal best
   ------------------------------------------------------------
   At the final buzzer of a match with the AI robots (or online), a card
   shows both alliances' points the way the scoring table lists them, who
   won, and whether this run beat the driver's best for this robot, this
   OpMode and this period. Bests are kept in this browser, one per robot,
   OpMode, period and AI skill, so practice has a number to beat.

   resultRows, resultWinner, bestKey and bestUpdate are pure, for the tests.
   ============================================================ */
const RESULT_LINES=[["leave","LEAVE"],["park","PARK"],["tipPts","TIPS"],["cell","CELL"],["flower","FLOWER"],["bottom","FLOWER base"],["garden","GARDEN"]];
/* the rows of the table, only the lines anyone scored in, then the total */
function resultRows(S){
  const r=S&&S.red||{}, b=S&&S.blue||{}, rows=[];
  for(const [k,label] of RESULT_LINES){ const a=+r[k]||0, c=+b[k]||0; if(a||c) rows.push({label, red:a, blue:c}); }
  rows.push({label:"Total", red:+r.total||0, blue:+b.total||0, total:true});
  return rows;
}
function resultWinner(S){ const a=+(S&&S.red&&S.red.total)||0, b=+(S&&S.blue&&S.blue.total)||0; return a>b?"red":b>a?"blue":"tie"; }
/* one best per robot, OpMode, period and opponents */
function bestKey(m){
  m=m||{};
  const part=v=>String(v==null?"":v).toLowerCase().replace(/[^a-z0-9.+-]+/g,"_").slice(0,48);
  return "ftcbench.best."+[part(m.robot),part(m.opmode),part(m.period),part(m.skill||"solo")].join("|");
}
/* the stored best (a JSON string or null) against this run's score: {best, prev, isNew} */
function bestUpdate(stored,score,when){
  let prev=null;
  try{ const p=stored?JSON.parse(stored):null; if(p&&Number.isFinite(p.score)) prev=p; }catch(e){ prev=null; }
  score=+score||0;
  const isNew=!prev||score>prev.score;
  return {best:isNew?{score, when:when||null}:prev, prev, isNew};
}

/* ---- the ghost: the best run's path, raced against ----
   A trace is the robot's pose ten times a second, [t, x, y, h] in seconds, metres and
   radians, kept with the best. ghostAt says where the ghost is at time t. */
const GHOST_HZ=10, GHOST_MAX=GHOST_HZ*130;
/* add a sample when at least a tenth of a second has gone since the last */
function ghostRecord(trace,t,c){
  if(!(t>=0)||!c||!isFinite(c.x)) return trace;
  const last=trace[trace.length-1];
  if(!last||t-last[0]>=1/GHOST_HZ-1e-9){ if(trace.length<GHOST_MAX) trace.push([+t.toFixed(2),+c.x.toFixed(3),+c.y.toFixed(3),+c.h.toFixed(3)]); }
  return trace;
}
/* the pose at t, between the samples either side (the heading the short way round); null off the ends */
function ghostAt(trace,t){
  if(!trace||trace.length<2||!(t>=trace[0][0])||t>trace[trace.length-1][0]) return null;
  let lo=0, hi=trace.length-1;
  while(hi-lo>1){ const m=(lo+hi)>>1; if(trace[m][0]<=t) lo=m; else hi=m; }
  const a=trace[lo], b=trace[hi], k=b[0]>a[0]?(t-a[0])/(b[0]-a[0]):0;
  let dh=b[3]-a[3]; dh=Math.atan2(Math.sin(dh),Math.cos(dh));
  return {x:a[1]+(b[1]-a[1])*k, y:a[2]+(b[2]-a[2])*k, h:a[3]+dh*k};
}
/* What the run was like, from its trace and the times it hit something ([{t, what}]):
   distance (m), top speed (m/s), time standing still (s), when it last moved (s), the hits
   (each thing once, with how many times and the first time) */
function runReport(trace,hits,len){
  const R={dist:0, top:0, still:0, lastMove:0, hits:[], len:len||0};
  for(let i=1;i<(trace||[]).length;i++){
    const a=trace[i-1], b=trace[i], dt=b[0]-a[0]; if(!(dt>0)) continue;
    const d=Math.hypot(b[1]-a[1],b[2]-a[2]), turn=Math.abs(Math.atan2(Math.sin(b[3]-a[3]),Math.cos(b[3]-a[3])));
    R.dist+=d; R.top=Math.max(R.top,d/dt);
    if(d/dt<0.03&&turn/dt<0.05) R.still+=dt; else R.lastMove=b[0];
  }
  const by=new Map();
  for(const h of hits||[]){ const k=String(h.what||"something"); const e=by.get(k); if(e) e.n++; else by.set(k,{what:k, n:1, t:h.t}); }
  R.hits=[...by.values()].sort((a,b)=>a.t-b.t);
  return R;
}
/* a stored trace, or null when it isn't one */
function ghostRead(s){
  try{ const g=JSON.parse(s); return Array.isArray(g)&&g.length>1&&g.every(p=>Array.isArray(p)&&p.length===4&&p.every(Number.isFinite))?g:null; }catch(e){ return null; }
}

const Results={
  init(){
    const p=$("#resultsPanel"); if(!p) return;
    $("#resultsClose").addEventListener("click",()=>this.hide());
    $("#resultsAgain").addEventListener("click",()=>{ this.hide(); if(typeof dsInit==="function") dsInit(); });
    $("#resultsReplay").addEventListener("click",()=>{ this.hide(); Recorder.show(); });
  },
  hide(){ const p=$("#resultsPanel"); if(p) p.hidden=true; },
  reportHtml(R,period){
    const ft=m=>(m/0.3048).toFixed(0)+" ft", sec=s=>s.toFixed(1)+" s";
    const rows=[["Driven",ft(R.dist)],["Top speed",(R.top/0.3048).toFixed(1)+" ft/s"],["Standing still",sec(R.still)]];
    if(period==="Autonomous") rows.push(["Last moved at",sec(R.lastMove)+(R.len?" of "+R.len:"")]);
    const hit=R.hits.length?R.hits.map(h=>esc(h.what)+(h.n>1?" ×"+h.n:"")+" ("+sec(h.t)+")").join(", "):"nothing";
    return `<div class="rs-rep">${rows.map(r=>`<span><small>${r[0]}</small><b>${r[1]}</b></span>`).join("")}</div><p class="rs-hits${R.hits.length?" bad":""}">Hit: ${hit}</p>`;
  },
  /* the final buzzer: S is the score, al the user's alliance */
  show(S,al,meta){
    const p=$("#resultsPanel"); if(!p||!S) return;
    const win=resultWinner(S), mine=S[al]||{total:0};
    const key=bestKey(meta), B=bestUpdate(store.get(key,null),mine.total,new Date().toISOString().slice(0,10));
    if(B.isNew){ store.set(key,JSON.stringify(B.best)); if(meta&&meta.trace&&meta.trace.length>1) store.set(key+".ghost",JSON.stringify(meta.trace)); }
    $("#resultsHead").innerHTML=win==="tie"?"Tie":`<span class="${win}">${win==="red"?"Red":"Blue"} wins</span>`;
    $("#resultsSub").textContent=(al==="red"?"You were red":"You were blue")+" · "+(meta&&meta.period==="Autonomous"?"AUTO":"TELEOP")+(meta&&meta.skill?" · "+meta.skill+" AI":"");
    $("#resultsTable").innerHTML="<tr><th></th><th class='red'>Red</th><th class='blue'>Blue</th></tr>"+
      resultRows(S).map(r=>`<tr class="${r.total?"tot":""}"><td>${esc(r.label)}</td><td>${r.red}</td><td>${r.blue}</td></tr>`).join("");
    $("#resultsBest").innerHTML=B.isNew&&B.prev?`<b>New personal best: ${mine.total}</b> (was ${B.prev.score})`
      :B.isNew?`<b>First score on the board: ${mine.total}</b>`:`Your best here: <b>${B.best.score}</b>${B.best.when?" ("+esc(B.best.when)+")":""}`;
    const rep=meta&&meta.trace?runReport(meta.trace,meta.hits,meta.period==="Autonomous"?30:120):null;
    $("#resultsReport").innerHTML=rep?this.reportHtml(rep,meta.period):"";
    $("#resultsReplay").hidden=!Recorder.url;
    p.hidden=false;
  },
};
