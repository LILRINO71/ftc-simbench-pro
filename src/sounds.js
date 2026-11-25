/* ============================================================
   MATCH SOUNDS — the field's cues, made in the browser
   ------------------------------------------------------------
   A driver practises to the field's sounds as much as to its clock: the
   start, the end of AUTO, the last ten seconds, the final buzzer. These are
   SimBench's own, synthesised with Web Audio (no sound files, nothing
   copied from the field's), and they follow the match clock.

   SOUND_CUES describes each one as tones; soundCues(prev, now, len) says
   which fire as the clock goes from prev to now. Both are pure, for the
   tests. Off with the speaker switch, remembered in this browser.
   ============================================================ */
const SOUND_CUES={
  // a rising call to go
  start:[{f:523,t:0,d:0.12,w:"triangle"},{f:659,t:0.12,d:0.12,w:"triangle"},{f:784,t:0.24,d:0.12,w:"triangle"},{f:1047,t:0.36,d:0.45,w:"triangle",g:0.9}],
  // the last ten seconds: one short tick a second
  tick:[{f:1320,t:0,d:0.05,w:"sine",g:0.55}],
  // the period is over: a low two-tone horn
  end:[{f:196,t:0,d:0.9,w:"sawtooth",g:0.55},{f:147,t:0,d:0.9,w:"sawtooth",g:0.45}],
  // the alliance scored (quiet: it can come often)
  score:[{f:880,t:0,d:0.07,w:"sine",g:0.3},{f:1175,t:0.06,d:0.09,w:"sine",g:0.3}],
  // stopped early by the driver
  stop:[{f:440,t:0,d:0.12,w:"square",g:0.3},{f:330,t:0.12,d:0.2,w:"square",g:0.3}],
};
/* The cues the clock crosses going from prev to now (seconds into a period of len):
   "start" as it leaves 0, a "tick" at each of the last ten whole seconds, "end" at len. */
function soundCues(prev,now,len){
  const out=[];
  if(!(now>prev)||!(len>0)) return out;
  if(prev<=0&&now>0) out.push("start");
  for(let s=Math.max(1,Math.ceil(len-10));s<len;s++){ if(prev<s&&now>=s) out.push("tick"); }
  if(prev<len&&now>=len) out.push("end");
  return out;
}

const Sounds={
  ctx:null, on:true, vol:0.35, lastT:0, lastScore:null,
  init(){
    this.on=store.get("ftcbench.sound","1")!=="0";
    const b=$("#soundBtn"); if(!b) return;
    b.addEventListener("click",()=>{ this.on=!this.on; store.set("ftcbench.sound",this.on?"1":"0"); this.render(); if(this.on) this.play("score"); });
    // browsers only let a page make sound after a click or a key: wake the audio then
    const wake=()=>{ this.ensure(); };
    addEventListener("pointerdown",wake,{once:true}); addEventListener("keydown",wake,{once:true});
    this.render();
  },
  render(){ const b=$("#soundBtn"); if(!b) return; b.classList.toggle("off",!this.on); b.setAttribute("aria-pressed",this.on?"true":"false"); b.title=this.on?"Match sounds on: click to mute":"Match sounds off: click to turn on"; },
  ensure(){
    if(this.ctx) return this.ctx;
    const AC=typeof AudioContext!=="undefined"?AudioContext:(typeof webkitAudioContext!=="undefined"?webkitAudioContext:null);
    if(!AC) return null;
    try{ this.ctx=new AC(); }catch(e){ this.ctx=null; }
    return this.ctx;
  },
  play(name){
    if(!this.on) return;
    const tones=SOUND_CUES[name], ac=this.ensure(); if(!tones||!ac) return;
    if(ac.state==="suspended") ac.resume().catch(()=>{});
    const t0=ac.currentTime+0.02, out=ac.createGain(); out.gain.value=this.vol; out.connect(ac.destination);
    for(const n of tones){
      const o=ac.createOscillator(), g=ac.createGain(), a=t0+n.t, peak=n.g==null?0.7:n.g;
      o.type=n.w||"sine"; o.frequency.value=n.f;
      g.gain.setValueAtTime(0,a); g.gain.linearRampToValueAtTime(peak,a+0.01); g.gain.setValueAtTime(peak,a+Math.max(0.01,n.d-0.04)); g.gain.linearRampToValueAtTime(0,a+n.d);
      o.connect(g); g.connect(out); o.start(a); o.stop(a+n.d+0.02);
    }
  },
  /* the page's clock, each slow tick: t into a period of len, running or not */
  clock(t,len,running){
    if(!running){ this.lastT=t; return; }
    for(const c of soundCues(this.lastT,t,len)) this.play(c);
    this.lastT=t;
  },
  /* an alliance's total went up */
  scored(total){
    if(this.lastScore!=null&&total>this.lastScore) this.play("score");
    this.lastScore=total;
  },
};
