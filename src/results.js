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

const Results={
  init(){
    const p=$("#resultsPanel"); if(!p) return;
    $("#resultsClose").addEventListener("click",()=>this.hide());
    $("#resultsAgain").addEventListener("click",()=>{ this.hide(); if(typeof dsInit==="function") dsInit(); });
    $("#resultsReplay").addEventListener("click",()=>{ this.hide(); Recorder.show(); });
  },
  hide(){ const p=$("#resultsPanel"); if(p) p.hidden=true; },
  /* the final buzzer: S is the score, al the user's alliance */
  show(S,al,meta){
    const p=$("#resultsPanel"); if(!p||!S) return;
    const win=resultWinner(S), mine=S[al]||{total:0};
    const key=bestKey(meta), B=bestUpdate(store.get(key,null),mine.total,new Date().toISOString().slice(0,10));
    if(B.isNew) store.set(key,JSON.stringify(B.best));
    $("#resultsHead").innerHTML=win==="tie"?"Tie":`<span class="${win}">${win==="red"?"Red":"Blue"} wins</span>`;
    $("#resultsSub").textContent=(al==="red"?"You were red":"You were blue")+" · "+(meta&&meta.period==="Autonomous"?"AUTO":"TELEOP")+(meta&&meta.skill?" · "+meta.skill+" AI":"");
    $("#resultsTable").innerHTML="<tr><th></th><th class='red'>Red</th><th class='blue'>Blue</th></tr>"+
      resultRows(S).map(r=>`<tr class="${r.total?"tot":""}"><td>${esc(r.label)}</td><td>${r.red}</td><td>${r.blue}</td></tr>`).join("");
    $("#resultsBest").innerHTML=B.isNew&&B.prev?`<b>New personal best: ${mine.total}</b> (was ${B.prev.score})`
      :B.isNew?`<b>First score on the board: ${mine.total}</b>`:`Your best here: <b>${B.best.score}</b>${B.best.when?" ("+esc(B.best.when)+")":""}`;
    $("#resultsReplay").hidden=!Recorder.url;
    p.hidden=false;
  },
};
