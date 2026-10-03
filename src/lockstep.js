/* ============================================================
   7g. LOCKSTEP — one match, simulated the same on every computer
   ------------------------------------------------------------
   Today each computer runs its own robot and streams where it is; the host
   runs the rest. That is four slightly different matches: contacts are
   guessed, the host's computer decides what everyone else sees, and a
   host leaving ends it. In lockstep every computer runs the whole match,
   and all that travels is what each robot's code told its motors and
   servos to do, tick by tick:

     - a team's code never leaves its computer, only its commands do
     - every computer applies tick T's commands from every robot at tick T,
       LOCKSTEP_DELAY ticks after they were made, so a command made now has
       time to arrive everywhere before it's needed
     - a computer waits for a tick's missing commands; a robot whose
       commands stay missing past a limit is driven by a stand-in (its
       motors off) so one slow connection can't stall everyone
     - every few ticks each computer says a hash of its state; one that
       disagrees with the rest has diverged and is resynchronised

   This file is the bookkeeping: encoding, the ledger, the scheduler, the
   hash vote. The room (workers/room) carries and keeps the ledger.
   ============================================================ */
const LOCKSTEP_DELAY=2;          // ticks: 40 ms at 50 Hz
const LOCKSTEP_WAIT=25;          // ticks a computer waits for a robot before the stand-in drives it
const LOCKSTEP_HASH_EVERY=25;    // ticks between state hashes
const LOCKSTEP_MAX=64;           // values per robot per tick

/* A robot's commands for one tick, as a short string: version, count, then
   each value in -1..1 as a 16-bit integer (1/32767 resolution, finer than
   any FTC motor controller's), base64url. Servo positions go in as 2p-1. */
function lsEncode(values){
  const n=Math.min(LOCKSTEP_MAX,values.length), b=new Uint8Array(2+2*n), dv=new DataView(b.buffer);
  b[0]=1; b[1]=n;
  for(let i=0;i<n;i++){ const v=+values[i]; dv.setInt16(2+2*i,Number.isFinite(v)?Math.round(Math.max(-1,Math.min(1,v))*32767):0,true); }
  let s=""; for(const c of b) s+=String.fromCharCode(c);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
/* The values back, or null for anything that isn't a command string. */
function lsDecode(str){
  if(typeof str!=="string"||str.length>4+Math.ceil((2+2*LOCKSTEP_MAX)*4/3)) return null;
  let s; try{ s=atob(str.replace(/-/g,"+").replace(/_/g,"/")); }catch(e){ return null; }
  if(s.length<2||s.charCodeAt(0)!==1) return null;
  const n=s.charCodeAt(1); if(n>LOCKSTEP_MAX||s.length!==2+2*n) return null;
  const out=new Array(n);
  for(let i=0;i<n;i++){ let v=s.charCodeAt(2+2*i)|(s.charCodeAt(3+2*i)<<8); if(v&0x8000) v-=0x10000; out[i]=v/32767; }
  return out;
}
/* FNV-1a over numbers rounded to 1e-7: the same state hashes the same on every
   computer, and a difference anywhere changes it. */
function lsHash(nums,seed){
  let h=(seed>>>0)||0x811c9dc5;
  for(const x of nums){ const v=Math.round((+x||0)*1e7)|0; for(let k=0;k<4;k++){ h^=(v>>>(8*k))&255; h=Math.imul(h,16777619)>>>0; } }
  return h>>>0;
}

/* The ledger: who said what for which tick, and when a tick can be played.
   slots: the robots in the match (ids), each driven by one computer. */
function lsLedger(slots,opts){
  const o=opts||{}, delay=o.delay!=null?o.delay:LOCKSTEP_DELAY, wait=o.wait!=null?o.wait:LOCKSTEP_WAIT;
  const rows=new Map(), dropped=new Set(), lastHeard=new Map();
  const L={
    slots:[...slots], delay, tick:0, waited:0, standIns:[],
    /* a robot's commands for a tick: first one wins, late ones (for a tick already played) are refused */
    put(slot,tick,data){
      if(!L.slots.includes(slot)||!Number.isInteger(tick)||tick<L.tick||tick>L.tick+600) return false;
      const r=rows.get(tick)||rows.set(tick,new Map()).get(tick);
      if(r.has(slot)) return false;
      const v=typeof data==="string"?lsDecode(data):Array.isArray(data)?data.map(Number):null;
      if(!v) return false;
      r.set(slot,v); lastHeard.set(slot,tick);
      if(dropped.has(slot)&&tick>=L.tick){ dropped.delete(slot); L.standIns=L.standIns.filter(s=>s!==slot); }   // it's back
      return true;
    },
    missing(tick){ const r=rows.get(tick); return L.slots.filter(s=>!dropped.has(s)&&!(r&&r.has(s))); },
    ready(tick){ return L.missing(tick==null?L.tick:tick).length===0; },
    /* Play the next tick if it can be played: every robot's commands are in, or
       the ones that aren't have been waited for long enough. Returns
       {tick, cmds: slot -> values ([] for a stand-in)} or null (wait). */
    next(){
      const t=L.tick, miss=L.missing(t);
      // nobody has said anything for this tick: there's nothing to play, however long
      // it's been (this computer always says its own robot's, so a quiet tick is one
      // that hasn't happened yet anywhere)
      const r0=rows.get(t);
      if(!r0||!r0.size) return null;
      if(miss.length){
        if(++L.waited<wait) return null;
        for(const s of miss){ dropped.add(s); if(!L.standIns.includes(s)) L.standIns.push(s); }
      }
      L.waited=0;
      const r=rows.get(t)||new Map(), cmds={};
      for(const s of L.slots) cmds[s]=r.get(s)||[];
      rows.delete(t); L.tick=t+1;
      return {tick:t, cmds};
    },
    /* the tick this computer's command made now is for */
    forTick(){ return L.tick+delay; },
    size(){ return rows.size; }
  };
  return L;
}

/* The hash vote: each computer's state hash per tick; the ones that disagree
   with the most common answer have diverged. */
function lsVote(){
  const by=new Map();
  return {
    say(tick,who,hash){ if(!Number.isInteger(tick)) return; const m=by.get(tick)||by.set(tick,new Map()).get(tick); if(!m.has(who)) m.set(who,hash>>>0); },
    /* {tick, agreed, diverged:[who]} once `n` computers have said, else null */
    check(tick,n){
      const m=by.get(tick); if(!m||m.size<n) return null;
      const count=new Map(); for(const h of m.values()) count.set(h,(count.get(h)||0)+1);
      let best=null, bc=-1; for(const [h,c] of count) if(c>bc||(c===bc&&h<best)){ best=h; bc=c; }
      const diverged=[...m].filter(([,h])=>h!==best).map(([w])=>w).sort();
      by.delete(tick);
      return {tick, agreed:bc>m.size/2?best:null, diverged:bc>m.size/2?diverged:[...m.keys()].sort()};
    }
  };
}
