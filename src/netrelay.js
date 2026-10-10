/* ============================================================
   7f. ROOMS ON THE APP'S OWN ORIGIN — the transport ladder
   ------------------------------------------------------------
   Online matches used WebRTC between the players' browsers, found through
   public Nostr relays. School networks break both: UDP is dropped (so WebRTC
   can't connect) and WebSockets to hosts the filter doesn't know are
   dropped (so the relays can't be reached). The one path a school can't
   block without blocking SimBench itself is HTTPS to SimBench, so the site
   runs match rooms there (functions/room, workers/room).

   netRelay(opts) is that room as a transport, the same shape net.js takes
   from netTrystero or netLoopback: join(name) -> {send, sendBin, onMessage,
   onBin, onJoin, onLeave, leave}. It speaks a WebSocket to the room; where a
   proxy strips the upgrade it falls back to Server-Sent Events down and
   batched POSTs up, which is plain HTTPS. The room also tells the time, so a
   countdown is the same everywhere, and keeps the lockstep command ledger.

   netConnect() climbs the ladder: the site's own rooms when it has them,
   else WebRTC with TURN over port 443 when the site has TURN credentials,
   else WebRTC as before. Nothing here opens a connection until a player
   goes online, and every constructor is handed in, so tests run it in Node.
   ============================================================ */
const RELAY_OPEN_MS=4000;                       // a WebSocket that hasn't said hello by now: try SSE
const RELAY_POST_MS=25;                         // SSE clients batch what they say this long

function netRandomId(n){
  const a=new Uint8Array(n||14), A="abcdefghijklmnopqrstuvwxyz0123456789";
  (typeof crypto!=="undefined"&&crypto.getRandomValues?crypto:{getRandomValues:x=>{ for(let i=0;i<x.length;i++) x[i]=Math.floor(Math.random()*256); return x; }}).getRandomValues(a);
  return Array.from(a,b=>A[b%36]).join("");
}
/* a string's length in UTF-8 bytes, which is what the room and the browser's limits count */
function netUtf8Len(s){ let n=0; for(let i=0;i<s.length;i++){ const c=s.charCodeAt(i); n+=c<0x80?1:c<0x800?2:(c>=0xd800&&c<0xdc00)?(i++,4):3; } return n; }
/* binary frames, as workers/room/room.js reads them: [u32 header length][header JSON][payload] */
function netPackBin(header,payload){
  const h=new TextEncoder().encode(JSON.stringify(header)), p=payload instanceof Uint8Array?payload:new Uint8Array(payload||0);
  const out=new Uint8Array(4+h.length+p.length); new DataView(out.buffer).setUint32(0,h.length,true); out.set(h,4); out.set(p,4+h.length);
  return out;
}
function netUnpackBin(buf){
  const u=buf instanceof Uint8Array?buf:new Uint8Array(buf);
  if(u.length<4) return null;
  const n=new DataView(u.buffer,u.byteOffset,u.byteLength).getUint32(0,true);
  if(n>4096||4+n>u.length) return null;
  let header; try{ header=JSON.parse(new TextDecoder().decode(u.subarray(4,4+n))); }catch(e){ return null; }
  if(!header||typeof header!=="object") return null;
  return {header, payload:u.slice(4+n)};
}
const netUnB64=s=>{ try{ return Uint8Array.from(atob(String(s||"")),c=>c.charCodeAt(0)); }catch(e){ return null; } };

/* opts: base (the site, default this page's origin), self, WebSocket,
   EventSource, fetch, sse (true: skip the WebSocket), setTimeout, tok (the secret) */
function netRelay(opts){
  const o=opts||{};
  const base=String(o.base||(typeof location!=="undefined"?location.origin:"")).replace(/\/$/,"");
  const WS=o.WebSocket!==undefined?o.WebSocket:(typeof WebSocket!=="undefined"?WebSocket:null);
  const ES=o.EventSource!==undefined?o.EventSource:(typeof EventSource!=="undefined"?EventSource:null);
  const F=o.fetch||(typeof fetch!=="undefined"?fetch.bind(globalThis):null);
  const later=o.setTimeout||((f,ms)=>setTimeout(f,ms)), stop=o.clearTimeout||(t=>clearTimeout(t));
  const self=o.self||netRandomId();
  // a secret this browser chose: the room binds the id to it, so only this browser
  // can speak as the id, or take its place back after a dropped connection
  const tok=o.tok||netRandomId(24);
  const out={self, onError:null, mode:null, join(name){
    const url=base+"/room/"+encodeURIComponent(name), q="?id="+encodeURIComponent(self)+"&tok="+encodeURIComponent(tok);
    let ws=null, es=null, mode=null, ready=false, closed=false, timer=null, postT=null, tries=0, inRoom=false, keepBytes=0;
    const queue=[], posts=[], peers=new Set();
    const H={msg:null, bin:null, join:null, leave:null, time:[], cmd:null, replay:null};
    const err=d=>{ if(out.onError) out.onError(Object.assign({room:name, via:mode},d)); };
    const handle=m=>{
      if(!m||typeof m!=="object") return;
      if(m.t==="hello"){ ready=true; inRoom=true; tries=0; out.mode=mode; stop(timer);
        // back after a drop: whoever left meanwhile has left, whoever came has come
        const now=new Set((m.peers||[]).filter(p=>typeof p==="string"));
        for(const p of [...peers]) if(!now.has(p)){ peers.delete(p); if(H.leave) H.leave(p); }
        for(const p of now) if(!peers.has(p)){ peers.add(p); if(H.join) H.join(p); }
        while(queue.length) queue.shift()(); }
      else if(m.t==="join"&&typeof m.id==="string"){ if(!peers.has(m.id)){ peers.add(m.id); if(H.join) H.join(m.id); } }
      else if(m.t==="leave"&&typeof m.id==="string"){ if(peers.delete(m.id)&&H.leave) H.leave(m.id); }
      else if(m.t==="m"){ if(H.msg&&peers.has(m.from)) H.msg(m.d,m.from); }
      else if(m.t==="b"&&m.b64!=null){ const u=netUnB64(m.b64); if(u&&H.bin&&peers.has(m.from)) H.bin(u.buffer,m.meta||{},m.from); }
      else if(m.t==="time"){ const fs=H.time.splice(0); for(const f of fs) f(m.now); }
      else if(m.t==="cmd"){ if(H.cmd) H.cmd(m.from,m.tick,m.d); }
      else if(m.t==="replay"){ if(H.replay) H.replay(m.rows||[],!!m.done); }
      else if(m.t==="err") err({error:m.why||"error"});
    };
    /* keepalive lets a POST finish after the page goes, but a browser allows
       64 KB of keepalive bodies in flight in all and refuses the fetch past
       that: only the POSTs that fit in what's left are sent with it */
    const post=(body,type)=>{
      const n=typeof body==="string"?netUtf8Len(body):body.length, keep=keepBytes+n<=60000;
      if(keep) keepBytes+=n;
      return F(url+"/send"+q,{method:"POST", headers:{"Content-Type":type}, body, keepalive:keep})
        .then(r=>{ if(!r.ok) err({error:"send-"+r.status}); }).catch(()=>err({error:"send-failed"}))
        .then(()=>{ if(keep) keepBytes-=n; });
    };
    // what an SSE client says goes up in POSTs: JSON in batches under the room's
    // 64 KB (counted in UTF-8 bytes, as the room counts them), and each binary on its own as raw bytes
    const flushPosts=()=>{ postT=null; if(!posts.length||closed) return;
      const batch=[]; let size=2;
      while(posts.length&&batch.length<64){ const s=netUtf8Len(JSON.stringify(posts[0]))+1; if(batch.length&&size+s>60000) break; batch.push(posts.shift()); size+=s; }
      post(JSON.stringify(batch),"application/json");
      if(posts.length) postT=later(flushPosts,RELAY_POST_MS); };
    const say=m=>{
      if(closed) return;
      const go=()=>{
        if(mode==="ws"&&ws&&ws.readyState===1){
          if(m.t==="b") ws.send(netPackBin({t:"b", to:m.to, meta:m.meta},m.payload));
          else ws.send(JSON.stringify(m));
        }else if(mode==="sse"){
          if(m.t==="b") post(netPackBin({t:"b", to:m.to, meta:m.meta},m.payload),"application/octet-stream");
          else { posts.push(m); if(!postT) postT=later(flushPosts,RELAY_POST_MS); }
        }
      };
      if(ready) go(); else queue.push(go);
    };
    const sse=()=>{
      if(closed||es) return;                           // one stream, however we got here
      if(!ES||!F){ err({error:"no-route", fatal:true}); return; }
      mode="sse"; ready=false;
      es=new ES(url+"/sse"+q);
      es.onmessage=e=>{ let m; try{ m=JSON.parse(e.data); }catch(x){ return; } handle(m); };
      // the browser reconnects a dropped stream by itself, with the same secret, and the
      // room takes it back (its hello resets the count); a stream the browser gave up on
      // (an error answer) is opened again here. One that never got in, or keeps failing,
      // is reported
      es.onerror=()=>{ if(closed) return;
        if(!inRoom||++tries>5){ err({error:"unreachable", fatal:true}); try{ es.close(); }catch(x){} return; }
        ready=false;
        if(es.readyState===2){ const me=es; es=null; try{ me.close(); }catch(x){} later(()=>{ if(!closed&&!es) sse(); },1000*tries); }
      };
    };
    // a socket that's been given up on says nothing more, closes quietly, and can't start a second fallback
    const drop=s=>{ if(!s) return; s.onopen=s.onmessage=s.onclose=s.onerror=null; try{ s.close(); }catch(e){} };
    const wsOpen=()=>{
      mode="ws"; ready=false;
      try{ ws=new WS(url.replace(/^http/,"ws")+"/ws"+q); }catch(e){ ws=null; sse(); return; }
      ws.binaryType="arraybuffer";
      const me=ws;
      timer=later(()=>{ if(!ready&&!closed&&ws===me){ drop(me); ws=null; sse(); } },RELAY_OPEN_MS);
      me.onmessage=e=>{
        if(ws!==me) return;
        if(typeof e.data==="string"){ let m; try{ m=JSON.parse(e.data); }catch(x){ return; } handle(m); return; }
        const f=netUnpackBin(e.data); if(!f||!H.bin||!peers.has(f.header.from)) return;
        H.bin(f.payload.buffer,f.header.meta||{},f.header.from);
      };
      me.onclose=()=>{
        if(closed||ws!==me) return;
        stop(timer); ws=null;
        if(!ready){ sse(); return; }                    // never got in: plain HTTPS instead
        // dropped mid-match: back in with the same secret, which the room recognises
        ready=false;
        if(++tries<=3) later(()=>{ if(!closed&&!ws) wsOpen(); },400*tries);
        else { for(const p of [...peers]){ peers.delete(p); if(H.leave) H.leave(p); } err({error:"dropped", fatal:true}); }
      };
      me.onerror=()=>{};
    };
    if(o.sse||!WS) sse(); else wsOpen();
    return {
      send(m,to){ say({t:"m", to:to==null?undefined:[].concat(to), d:m}); },
      sendBin(buf,meta,to){ say({t:"b", to:to==null?undefined:[].concat(to), meta:meta||{}, payload:new Uint8Array(buf instanceof ArrayBuffer?buf:(buf.buffer||buf))}); },
      onMessage(f){ H.msg=f; }, onBin(f){ H.bin=f; }, onJoin(f){ H.join=f; }, onLeave(f){ H.leave=f; },
      /* the room's clock, in ms: one round trip, and how long it took */
      time(){ const t0=Date.now(); return new Promise(res=>{ H.time.push(now=>res({now, rtt:Date.now()-t0, at:Date.now()})); say({t:"time", echo:t0}); }); },
      /* lockstep's command ledger (src/lockstep.js) */
      command(tick,d){ say({t:"cmd", tick, d}); }, onCommand(f){ H.cmd=f; },
      replay(from){ say({t:"replay", from}); }, onReplay(f){ H.replay=f; },
      via(){ return mode; },
      leave(){ closed=true; stop(timer); if(postT) stop(postT);
        try{ if(ws) ws.close(1000,"bye"); }catch(e){} try{ if(es) es.close(); }catch(e){}
        ws=null; es=null; peers.clear(); }
    };
  }};
  return out;
}

/* The ladder. Asks the site what it has (GET /room/health), then:
     rooms here   -> netRelay (a WebSocket to the room; SSE + POST if stripped)
     TURN here    -> WebRTC with Cloudflare's TURN, which can run over TCP 443
     neither      -> WebRTC as before
   Returns {T, via, why}. opts: base, fetch, trystero (a loader for netTrystero),
   relay (extra netRelay options). */
async function netConnect(opts){
  const o=opts||{}, F=o.fetch||(typeof fetch!=="undefined"?fetch.bind(globalThis):null);
  const base=String(o.base||(typeof location!=="undefined"?location.origin:"")).replace(/\/$/,"");
  let health=null;
  try{
    const ctl=typeof AbortController!=="undefined"?new AbortController():null;
    const t=ctl?setTimeout(()=>ctl.abort(),2500):null;
    const r=await F(base+"/room/health",{cache:"no-store", signal:ctl?ctl.signal:undefined});
    if(t) clearTimeout(t);
    health=r.ok?await r.json():null;
  }catch(e){ health=null; }
  if(health&&health.ready) return {T:netRelay(Object.assign({base}, o.relay||{})), via:"room", why:"this site's own match rooms, over HTTPS"};
  let ice=null;
  if(health&&health.turn){
    try{ const r=await F(base+"/room/turn",{cache:"no-store"}); const j=r.ok?await r.json():null; if(j&&Array.isArray(j.iceServers)&&j.turn) ice=j.iceServers; }catch(e){ ice=null; }
  }
  const T=await netTrystero(o.trystero,ice?{turnConfig:ice}:null);
  return {T, via:ice?"webrtc+turn":"webrtc", why:ice?"direct between browsers, through TURN on port 443 where it must":"direct between browsers"};
}
