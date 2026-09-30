/* ============================================================
   7d.  ONLINE — one BIOBUZZ match, players on different computers

   Each player drives their own robot, from their own CAD and their own
   code, on their own computer, and sends where it is 20 times a second.
   One player hosts. The host's bench runs everything else in the match
   and sends it to everyone 12 times a second:
     - the AI robots filling any empty places
     - the HUMAN PLAYERS
     - every loose element, the FLOWERs, the HIVEs and the score
   A shot a player fires goes to the host, whose Shot Sim flies it again
   from the same launch and decides it, so every TIP is decided in one
   place. Robots that touch push each other apart, each computer moving its
   own robot half the way.

   Browsers talk to each other directly (WebRTC). They find each other
   through public relays (the Trystero library, loaded only when a player
   goes online); nothing about the match passes through the relays. The
   engine here never opens a connection itself. It is handed a transport
   (`join(room)`): the browser's (netTrystero) or the tests' (netLoopback),
   so the whole protocol runs in Node.
   Every message from another computer is untrusted: each is checked and
   clamped before it touches the match.
   ============================================================ */
const NET_PROTO=1;
const NET_APP="ftc-simbench-pro";
const NET_LIB="https://cdn.jsdelivr.net/npm/trystero@0.25.4/+esm";
const NET_SLOTS=["red1","red2","blue1","blue2"];
const NET_ABC="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O or 1/I to misread
const NET_HZ={pose:20, snap:12};
const NET_LEAD_MS=3000;                            // START to the match: a countdown, and time to INIT
const NET_MAX_PLAYERS=8;                           // four drivers, the rest watch
const netAl=s=>/^blue/.test(s||"")?"blue":"red";
const netNum=(v,lo,hi,d)=>typeof v==="number"&&isFinite(v)?Math.max(lo,Math.min(hi,v)):d;
const netStr=(v,n)=>typeof v==="string"?v.replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,n):"";
const netR=v=>Math.round(v*1000)/1000;
const netCodeOk=c=>typeof c==="string"&&/^[A-HJ-NP-Z2-9]{5}$/.test(c);
function netCode(rnd){ rnd=rnd||Math.random; let s=""; for(let i=0;i<5;i++) s+=NET_ABC[Math.floor(rnd()*NET_ABC.length)]; return s; }
/* Where a place starts (G304): place 1 in the middle of the alliance wall, place 2 toward its corner. */
function netSlotY(slot){ return /2$/.test(slot)?(netAl(slot)==="red"?-45:45)*IN:0; }
function netSlotPose(slot,fp){ const p=Field.startPose(netAl(slot),fp); p.y+=netSlotY(slot); return p; }
/* Elements on the wire: "p" POLLEN, "n" NECTAR, then "r" or "b" for a colour. */
const netEl=e=>(e.kind==="nectar"?"n":"p")+(e.color==="red"?"r":e.color==="blue"?"b":"");
function netEls(s,max){
  if(typeof s!=="string") return [];
  return (s.slice(0,64).match(/[pn][rb]?/g)||[]).slice(0,max||16)
    .map(t=>({kind:t[0]==="n"?"nectar":"pollen", color:t[1]==="r"?"red":t[1]==="b"?"blue":null}));
}

/* ---------------- transports ---------------- */
/* An in-process network for tests: endpoints join rooms by name and each
   message goes through JSON, delivered in order when flush() is called. */
function netLoopback(){
  const rooms={}, queue=[];
  return {
    queue,
    endpoint(self){
      return {self, join(name){
        const R=rooms[name]||(rooms[name]=new Map()), me={};
        const room={
          send(msg,to){
            const data=JSON.stringify(msg), T=to==null?null:[].concat(to);
            for(const [id,m] of R) if(id!==self&&(!T||T.indexOf(id)>=0)) queue.push(()=>{ if(R.get(id)===m&&m.msg) m.msg(JSON.parse(data),self); });
          },
          onMessage(f){ me.msg=f; }, onJoin(f){ me.join=f; }, onLeave(f){ me.leave=f; },
          peers(){ return [...R.keys()].filter(id=>id!==self); },
          leave(){ if(R.get(self)!==me) return; R.delete(self); for(const [,m] of R) queue.push(()=>m.leave&&m.leave(self)); }
        };
        for(const [id,m] of R){ queue.push(()=>m.join&&m.join(self)); queue.push(()=>R.get(self)===me&&me.join&&me.join(id)); }
        R.set(self,me);
        return room;
      }};
    },
    flush(max){ let n=0; while(queue.length&&n<(max||1e6)){ queue.shift()(); n++; } return n; }
  };
}
/* The browser's network: Trystero, WebRTC between the players' browsers,
   found through public Nostr relays. Loaded the first time a player goes online. */
async function netTrystero(){
  const T=await import(NET_LIB);
  const out={self:T.selfId, onError:null, join(name){
    const r=T.joinRoom({appId:NET_APP}, name, {onJoinError:d=>{ if(out.onError) out.onError(d); }});
    const a=r.makeAction("m");
    let msg=null, jn=null, lv=null;
    a.onMessage=(d,meta)=>{ if(msg) msg(d, meta&&meta.peerId); };
    r.onPeerJoin=id=>{ if(jn) jn(id); };
    r.onPeerLeave=id=>{ if(lv) lv(id); };
    return {send(m,to){ return a.send(m, to==null?undefined:{target:to}); },
      onMessage(f){ msg=f; }, onJoin(f){ jn=f; }, onLeave(f){ lv=f; },
      peers(){ return Object.keys(r.getPeers()); }, leave(){ r.leave(); }};
  }};
  return out;
}

/* ---------------- the session ---------------- */
const Online={
  T:null, self:null, room:null, lobby:null,
  state:"off",           // off | joining | room | playing | done
  role:null,             // host | guest
  code:null, pub:false, hostId:null, name:"", fp:null,
  settings:{period:"TeleOp", skill:"typical"},
  players:{},            // everyone in the room, this computer too: id -> {id, name, slot, ready, kind, host}
  remote:{},             // the other drivers' robots as last heard
  slots:null, seed:1, startAt:0, started:false,
  ads:{}, chat:[], marks:[], score:null, final:null, why:null,
  offset:0, rtt:0, syncs:[], acc:null, fid:0, heard:{},
  now:()=>Date.now(),
  subs:[],

  /* UI hooks: fn(what, data) for "room", "ads", "start", "end", "chat", "mark", "error" */
  onChange(fn){ this.subs.push(fn); },
  emit(what,data){ for(const f of this.subs) try{ f(what,data); }catch(e){} },
  use(T){ this.T=T; this.self=T.self; },

  me(){ return this.players[this.self]||null; },
  mySlot(){ const p=this.me(); return p?p.slot:null; },
  myAl(){ return netAl(this.mySlot()); },
  hosting(){ return this.role==="host"&&this.state!=="off"; },
  guest(){ return this.role==="guest"&&this.state!=="off"; },
  playing(){ return this.state==="playing"; },
  inMatch(){ return this.state==="playing"||this.state==="done"; },
  holder(slot){ for(const id in this.players) if(this.players[id].slot===slot) return id; return null; },
  countdown(){ return (this.startAt-this.now())/1000; },

  /* ---- finding a match: the lobby, where public matches say they have room ---- */
  browse(){
    if(this.lobby||!this.T) return;
    const L=this.lobby=this.T.join("lobby");
    L.onMessage((m,from)=>this.lobbyMsg(m,from));
    L.onJoin(id=>{ if(this.pub&&this.role==="host"&&this.state==="room") L.send(this.ad(),id); });
  },
  unbrowse(){ if(this.lobby){ try{ this.lobby.leave(); }catch(e){} this.lobby=null; } this.ads={}; },
  lobbyMsg(m,from){
    if(!m||m.k!=="ad"||!from||!netCodeOk(m.code)) return;
    if(m.gone){ delete this.ads[m.code]; this.emit("ads"); return; }
    this.ads[m.code]={code:m.code, hid:from, name:netStr(m.name,40)||"An FTC match",
      period:m.period==="Autonomous"?"Autonomous":"TeleOp", skill:MATCH_SKILL[m.skill]?m.skill:"typical",
      n:netNum(m.n,0,NET_MAX_PLAYERS,0)|0, open:netNum(m.open,0,4,0)|0, proto:m.proto, at:this.now()};
    this.emit("ads");
  },
  openMatches(){
    const t=this.now();
    return Object.values(this.ads).filter(a=>a.proto===NET_PROTO&&a.open>0&&t-a.at<7000&&a.code!==this.code)
      .sort((a,b)=>b.n-a.n||b.at-a.at);
  },
  ad(){
    const me=this.me();
    return {k:"ad", code:this.code, name:(me?me.name+"'s match":""), period:this.settings.period, skill:this.settings.skill,
      n:Object.keys(this.players).length, open:NET_SLOTS.filter(s=>!this.holder(s)).length, proto:NET_PROTO};
  },
  unlist(){ if(this.lobby&&this.code) try{ this.lobby.send({k:"ad", code:this.code, gone:true}); }catch(e){} },

  /* ---- hosting and joining ---- */
  reset(){
    this.state="off"; this.role=null; this.code=null; this.pub=false; this.hostId=null; this.why=null;
    this.players={}; this.remote={}; this.slots=null; this.started=false; this.score=null; this.final=null;
    this.chat=[]; this.marks=[]; this.syncs=[]; this.offset=0; this.rtt=0; this.heard={};
    this.acc={pose:0, snap:0, sync:0, ad:0};
  },
  open(){
    const R=this.room=this.T.join("m-"+this.code);
    R.onMessage((m,from)=>this.recv(m,from));
    R.onJoin(id=>this.peerJoin(id));
    R.onLeave(id=>this.peerLeave(id));
  },
  /* o: {name, pub, period, skill, fp:{hx, hy}} */
  host(o){
    o=o||{};
    if(!this.T) return false;
    this.leave(); this.reset();
    this.role="host"; this.state="room"; this.pub=!!o.pub; this.name=netStr(o.name,24)||"Host"; this.fp=o.fp||null;
    this.code=netCodeOk(o.code)?o.code:netCode(); this.hostId=this.self;
    this.settings={period:o.period==="Autonomous"?"Autonomous":"TeleOp", skill:MATCH_SKILL[o.skill]?o.skill:"typical"};
    this.players[this.self]={id:this.self, name:this.name, slot:"red1", ready:false, kind:null, host:true};
    this.open();
    // a listed match stays in the lobby to say so; otherwise there's no need to be there
    if(this.pub){ this.browse(); this.lobby.send(this.ad()); } else this.unbrowse();
    this.emit("room");
    return true;
  },
  /* o: {name, hid (the host, when the lobby said), fp} */
  join(code,o){
    o=o||{};
    code=netStr(code,8).toUpperCase();
    if(!this.T||!netCodeOk(code)) return false;
    this.leave(); this.reset();
    this.role="guest"; this.state="joining"; this.code=code; this.name=netStr(o.name,24)||"Guest"; this.fp=o.fp||null;
    this.hostId=o.hid||null;
    this.players[this.self]={id:this.self, name:this.name, slot:null, ready:false, kind:null};
    this.unbrowse();
    this.open();
    this.emit("room");
    return true;
  },
  leave(){
    if(this.role==="host"&&this.pub) this.unlist();
    if(this.room){ try{ this.room.leave(); }catch(e){} this.room=null; }
    const was=this.state;
    this.reset();
    this.unmatch();
    if(was!=="off") this.emit("room");
  },
  /* The field goes back to this bench's own (between matches, or after leaving). */
  unmatch(){ if(typeof Match!=="undefined"){ Match.players=[]; Match.net=false; Match.mirror=false; Match.noUser=false; } },
  lost(why){ const w=why; this.leave(); this.why=w; this.emit("error",w); },

  peerJoin(id){
    // until it knows the host, a guest says hello to everyone who's there
    if(this.role==="guest"&&this.state==="joining"&&(!this.hostId||this.hostId===id))
      this.room.send({k:"hello", name:this.name, proto:NET_PROTO}, id);
  },
  peerLeave(id){
    if(this.role==="host"){
      const p=this.players[id]; if(!p) return;
      delete this.players[id]; delete this.remote[id];
      if(this.inMatch()&&typeof Match!=="undefined") Match.note(p.name+" left the match",p.slot?netAl(p.slot):null);
      this.sendRoster();
    }else if(id===this.hostId&&this.state!=="joining") this.lost("The host left, so the match is over.");
    else if(this.players[id]){ delete this.remote[id]; }
  },

  /* ---- messages ---- */
  recv(m,from){
    if(!m||typeof m!=="object"||typeof m.k!=="string"||typeof from!=="string") return;
    const fromHost=this.role==="guest"&&from===this.hostId;
    switch(m.k){
      case "hello": return this.onHello(m,from);
      case "welcome":
        if(this.role!=="guest"||this.state!=="joining"||(this.hostId&&from!==this.hostId)) return;
        this.hostId=from;
        if(typeof m.now==="number"&&isFinite(m.now)) this.offset=m.now-this.now();
        this.onRoster(m,from); this.sync();
        return;
      case "nope": if(this.role==="guest"&&this.state==="joining") this.lost("The host couldn't take you: "+(netStr(m.why,80)||"no reason given")); return;
      case "roster": if(fromHost) this.onRoster(m,from); return;
      case "pick": if(this.role==="host") this.assign(from,m.slot); return;
      case "ready":
        if(this.role==="host"&&this.state==="room"&&this.players[from]){
          const p=this.players[from]; p.ready=!!m.ready; p.kind=m.kind==="Autonomous"||m.kind==="TeleOp"?m.kind:null; this.sendRoster(); }
        return;
      case "start": if(fromHost) this.onStart(m); return;
      case "pose": return this.onPose(m,from);
      case "shot": if(this.role==="host") this.onShot(m,from); return;
      case "fly": if(fromHost) this.onFly(m); return;
      case "snap": if(fromHost&&this.state==="playing") this.applySnap(m); return;
      case "end": if(fromHost&&this.state==="playing") this.onEnd(m); return;
      case "chat": return this.onChat(m,from);
      case "mark": return this.onMark(m,from);
      case "sync": return this.onSync(m,from);
    }
  },
  /* A message a player may send only so often. */
  often(from,what,ms){ const k=from+"|"+what, t=this.now(); if(t-(this.heard[k]||-1e9)<ms) return true; this.heard[k]=t; return false; },

  /* host: someone arrived */
  onHello(m,from){
    if(this.role!=="host"||!this.room) return;
    if(m.proto!==NET_PROTO) return this.room.send({k:"nope", why:"they're on a different version of SimBench. Reload the page and try again"},from);
    if(!this.players[from]&&Object.keys(this.players).length>=NET_MAX_PLAYERS) return this.room.send({k:"nope", why:"the room is full"},from);
    const free=this.state==="room"?NET_SLOTS.find(s=>!this.holder(s)):null;
    const p=this.players[from]||(this.players[from]={id:from, slot:free||null, ready:false, kind:null});
    p.name=netStr(m.name,24)||"Guest";
    this.room.send(Object.assign(this.rosterMsg(),{k:"welcome", now:this.now()}),from);
    this.sendRoster();
    // arriving mid-match: they watch
    if(this.inMatch()&&this.lastStart) this.room.send(Object.assign({},this.lastStart,{late:true}),from);
  },
  rosterMsg(){
    return {k:"roster", state:this.state, settings:this.settings,
      players:Object.values(this.players).map(p=>({id:p.id, name:p.name, slot:p.slot, ready:p.ready, kind:p.kind, host:!!p.host}))};
  },
  sendRoster(){
    if(this.role!=="host") return;
    if(this.room) this.room.send(this.rosterMsg());
    if(this.pub&&this.lobby&&this.state==="room") this.lobby.send(this.ad());
    this.emit("room");
  },
  onRoster(m){
    const P={};
    for(const p of (Array.isArray(m.players)?m.players:[]).slice(0,NET_MAX_PLAYERS)){
      const id=netStr(p&&p.id,64); if(!id) continue;
      P[id]={id, name:netStr(p.name,24)||"Player", slot:NET_SLOTS.indexOf(p.slot)>=0?p.slot:null, ready:!!p.ready,
        kind:p.kind==="Autonomous"||p.kind==="TeleOp"?p.kind:null, host:!!p.host};
      const old=this.players[id]; if(old){ P[id].fired=old.fired; P[id].scored=old.scored; }
    }
    if(!P[this.self]) P[this.self]={id:this.self, name:this.name, slot:null, ready:false, kind:null};
    this.players=P;
    const s=m.settings||{};
    this.settings={period:s.period==="Autonomous"?"Autonomous":"TeleOp", skill:MATCH_SKILL[s.skill]?s.skill:"typical"};
    if(this.state==="joining") this.state="room";
    if(m.state==="room"&&this.state==="done"){ this.state="room"; this.final=null; this.unmatch(); }
    this.emit("room");
  },

  /* ---- the room: places, ready, settings ---- */
  pick(slot){
    slot=NET_SLOTS.indexOf(slot)>=0?slot:null;
    if(this.role==="host") this.assign(this.self,slot);
    else if(this.room&&this.hostId) this.room.send({k:"pick", slot},this.hostId);
  },
  assign(id,slot){
    const p=this.players[id]; if(!p||this.state!=="room") return;
    slot=NET_SLOTS.indexOf(slot)>=0?slot:null;
    if(slot&&this.holder(slot)&&this.holder(slot)!==id) return;
    p.slot=slot; p.ready=false;
    this.sendRoster();
  },
  setReady(ready,kind){
    const me=this.me(); if(!me||this.state!=="room") return;
    kind=kind==="Autonomous"||kind==="TeleOp"?kind:null;
    if(this.role==="host"){ me.ready=!!ready; me.kind=kind; this.sendRoster(); }
    else if(this.room&&this.hostId){ me.ready=!!ready; me.kind=kind; this.room.send({k:"ready", ready:!!ready, kind},this.hostId); this.emit("room"); }
  },
  set(o){
    if(this.role!=="host"||this.state!=="room") return;
    const was=this.settings.period;
    if(o.period) this.settings.period=o.period==="Autonomous"?"Autonomous":"TeleOp";
    if(o.skill&&MATCH_SKILL[o.skill]) this.settings.skill=o.skill;
    if(this.settings.period!==was) for(const id in this.players) this.players[id].ready=false;
    if(o.pub!=null&&!!o.pub!==this.pub){
      this.pub=!!o.pub;
      if(this.pub){ this.browse(); this.lobby.send(this.ad()); } else { this.unlist(); this.unbrowse(); }
    }
    this.sendRoster();
  },
  /* Who's holding the start up, in words; empty when it can start. */
  waitingFor(){
    const P=Object.values(this.players).filter(p=>p.slot), out=[];
    if(!P.length) out.push("nobody has a place yet");
    for(const p of P){
      if(!p.ready) out.push(p.name+" isn't ready");
      else if(p.kind!==this.settings.period) out.push(p.name+" has "+(p.kind==="Autonomous"?"an Autonomous":"a TeleOp")+" OpMode selected");
    }
    return out;
  },
  canStart(){ return this.role==="host"&&this.state==="room"&&!this.waitingFor().length; },
  start(){
    if(!this.canStart()) return false;
    const slots={}; for(const s of NET_SLOTS) slots[s]=this.holder(s)||"ai";
    const m={k:"start", seed:1+Math.floor(Math.random()*99999), period:this.settings.period, skill:this.settings.skill, slots, at:this.now()+NET_LEAD_MS};
    this.lastStart=m;
    this.room.send(m);
    if(this.pub){ this.unlist(); this.unbrowse(); }
    this.begin(m);
    return true;
  },
  onStart(m){
    const slots={};
    for(const s of NET_SLOTS){ const v=m.slots&&m.slots[s]; slots[s]=typeof v==="string"&&(v==="ai"||this.players[v])?v:"ai"; }
    // the host places everyone: whatever this computer thought its place was, it's this
    for(const id in this.players){ const p=this.players[id]; p.slot=null; }
    for(const s of NET_SLOTS) if(slots[s]!=="ai") this.players[slots[s]].slot=s;
    this.begin({seed:netNum(m.seed,1,1e6,1)|0, period:m.period==="Autonomous"?"Autonomous":"TeleOp",
      skill:MATCH_SKILL[m.skill]?m.skill:"typical", slots, at:netNum(m.at,0,1e16,this.now()+this.offset)});
  },
  /* Everyone, host too: the match as the host dealt it. */
  begin(m){
    this.slots=m.slots; this.seed=m.seed;
    this.settings={period:m.period, skill:m.skill};
    this.startAt=m.at-(this.role==="host"?0:this.offset);
    this.state="playing"; this.started=false; this.score=null; this.final=null; this.marks=[];
    for(const id in this.players){ this.players[id].fired=0; this.players[id].scored=0; }
    this.acc={pose:0, snap:0, sync:0, ad:0};
    if(typeof Field!=="undefined"&&Field.ok) Field.reset();
    this.matchReset(typeof Sim!=="undefined"?Sim:null);
    this.emit("start",{slot:this.mySlot(), al:this.myAl(), period:m.period, at:this.startAt});
  },
  /* The match itself, the same on every computer from the same seed; a guest's then follows the host's. */
  matchReset(sim){
    if(typeof Match==="undefined"||!this.slots) return;
    const my=this.mySlot(), fp=sim&&sim.footprint, slots={};
    for(const s of NET_SLOTS){ const h=this.slots[s]; slots[s]=h==="ai"?"ai":h===this.self?"user":"remote"; }
    Match.on=true; Match.net=true; Match.mirror=this.role!=="host"; Match.noUser=!my;
    Match.reset({period:this.settings.period, user:my?netAl(my):"red", userPose:my?netSlotPose(my,fp):null,
      seed:this.seed, skill:this.settings.skill, slots});
    Match.players=[];
  },

  /* ---- 50 times a second, after the local robot moved ---- */
  step(dt,sim){
    if(this.state==="off"||!this.room) return;
    this.acc.sync+=dt;
    if(this.role==="guest"&&this.hostId&&this.acc.sync>=(this.syncs.length<4?0.5:4)){ this.acc.sync=0; this.sync(); }
    if(this.role==="host"&&this.pub&&this.state==="room"&&this.lobby){ this.acc.ad+=dt; if(this.acc.ad>=2){ this.acc.ad=0; this.lobby.send(this.ad()); } }
    if(this.state!=="playing") return;
    this.smooth(dt);
    // my robot, to everyone
    this.acc.pose+=dt;
    if(this.mySlot()&&sim&&sim.chassis&&this.acc.pose>=1/NET_HZ.pose){ this.acc.pose=0; this.room.send(this.poseMsg(sim)); }
    if(this.now()<this.startAt) return;
    if(this.role==="host"){
      if(Match.t<Match.len){
        Match.tick(dt,sim);
        this.flightsOut();
        this.acc.snap+=dt;
        if(this.acc.snap>=1/NET_HZ.snap){ this.acc.snap=0; this.room.send(this.snap(sim)); }
      }else if(!this.final) this.finish(sim);
    }else this.mirror(dt,sim);
  },

  /* ---- robots: mine out, the others in ---- */
  poseMsg(sim){
    const ch=sim.chassis, fp=sim.footprint||{hx:MATCH_BOT.hx, hy:MATCH_BOT.hy}, c=Math.cos(ch.h), s=Math.sin(ch.h), ox=fp.ox||0, oy=fp.oy||0;
    const v=sim.vel||{x:0, y:0};
    return {k:"pose", x:netR(ch.x+ox*c-oy*s), y:netR(ch.y+ox*s+oy*c), h:netR(ch.h), vx:netR(v.x||0), vy:netR(v.y||0), hx:netR(fp.hx), hy:netR(fp.hy)};
  },
  onPose(m,from){
    const p=this.players[from]; if(!p||!p.slot||!this.inMatch()) return;
    const H=(typeof Field!=="undefined"&&Field.ok?Field.half():1.83)+0.2;
    const R=this.remote[from]||(this.remote[from]={id:from});
    R.tx=netNum(m.x,-H,H,0); R.ty=netNum(m.y,-H,H,0); R.th=netNum(m.h,-100,100,0);
    R.vx=netNum(m.vx,-4,4,0); R.vy=netNum(m.vy,-4,4,0);
    R.hx=netNum(m.hx,0.08,0.35,MATCH_BOT.hx); R.hy=netNum(m.hy,0.08,0.35,MATCH_BOT.hy); R.age=0;
    if(R.x==null){ R.x=R.tx; R.y=R.ty; R.h=R.th; }
  },
  /* The other drivers' robots, drawn and pushed where they were last heard, a little ahead. */
  smooth(dt){
    const k=Math.min(1,dt*15), out=[];
    for(const id in this.remote){
      const R=this.remote[id], p=this.players[id];
      if(!p||!p.slot){ delete this.remote[id]; continue; }
      R.age+=dt; const a=Math.min(R.age,0.2);
      R.x+=(R.tx+R.vx*a-R.x)*k; R.y+=(R.ty+R.vy*a-R.y)*k; R.h+=wrapA(R.th-R.h)*k;
      out.push({id, al:netAl(p.slot), slot:p.slot, name:p.name, x:R.x, y:R.y, h:R.h, hx:R.hx, hy:R.hy, vx:R.vx, vy:R.vy});
    }
    if(typeof Match!=="undefined") Match.players=out;
  },

  /* ---- shots ---- */
  /* guest: a ball this robot just fired; the host flies it again and decides it */
  shot(p,th,v,yaw){
    if(!this.guest()||this.state!=="playing"||!this.room||!this.hostId) return;
    this.room.send({k:"shot", x:netR(p.robot.x), y:netR(p.robot.y), ball:p.ballId, h0:p.h0, motor:p.motorId,
      type:p.shooter&&p.shooter.type, wheel:p.shooter&&p.shooter.wheelDiameterMm, gear:p.shooter&&p.shooter.gear,
      hs:[p.hiveState.red,p.hiveState.blue], th, v, yaw},this.hostId);
  },
  onShot(m,from){
    const p=this.players[from];
    if(this.state!=="playing"||!p||!p.slot||!Field.ok||this.now()<this.startAt||Match.t>=Match.len) return;
    if(this.often(from,"shot",150)) return;
    const al=netAl(p.slot), R=this.remote[from], L=Field.data.field.field.half-9;
    const x=netNum(m.x,-L,L,0), y=netNum(m.y,-L,L,0);
    if(R&&Math.hypot(x*IN-R.x,y*IN-R.y)>1.2) return;                 // not from where that robot is
    const kind=m.ball==="nectar"?"nectar":"pollen", motors=(Field.data.motors&&Field.data.motors.motors)||[];
    const hs=Array.isArray(m.hs)?m.hs:[], side=v=>v===1||v===-1?v:null;
    const hive={red:side(hs[0])||Field.hive.red, blue:side(hs[1])||Field.hive.blue};
    const params={robot:{x, y}, target:al, ballId:kind, hiveState:hive, h0:netNum(m.h0,4,30,16),
      motorId:motors.some(q=>q.id===m.motor)?m.motor:MATCH_BOT.motorId,
      shooter:{type:m.type==="dual"?"dual":"single", wheelDiameterMm:netNum(m.wheel,30,200,96), gear:netNum(m.gear,0.1,10,1), motorsPerWheel:1},
      precision:Match.precision()};
    let r=null;
    try{ r=Field.E.classifyShot(params,netNum(m.th,0,90,45),netNum(m.v,0,25,0),netNum(m.yaw,-720,720,0)); }catch(e){ return; }
    const path=(r&&r.path)||[]; if(path.length<2) return;
    p.fired=(p.fired||0)+1;
    // the CELL it was aimed at is the one up when it left; a TIP on the way makes it a miss (src/match.js)
    const f={path, t:0, dur:(path.length-1)*SHOT_STEP_S, hit:!!r.hit, cause:r.cause, kind, color:kind==="nectar"?al:null,
      al, by:p, pos:path[0].slice(), hive:hive[al], fid:++this.fid, owner:from};
    Match.flying.push(f);
    this.fly(f);
  },
  /* host: every ball that starts flying, AI robots' and the host's own included, to everyone once */
  flightsOut(){
    for(const f of Match.flying) if(!f.fid){ f.fid=++this.fid; f.owner=""; this.fly(f); }
    if(typeof Shots!=="undefined") for(const b of Shots.flying) if(!b.fid){ b.fid=++this.fid; b.owner=this.self; this.fly(b); }
  },
  fly(f){
    if(!this.room) return;
    const P=[], n=f.path.length, every=4, r1=v=>Math.round(v*10)/10;
    for(let i=0;i<n-1;i+=every) P.push(f.path[i].map(r1));
    P.push(f.path[n-1].map(r1));
    this.room.send({k:"fly", fid:f.fid, owner:f.owner||"", kind:f.kind, color:f.color||"", step:SHOT_STEP_S*every, path:P});
  },
  onFly(m){
    if(m.owner===this.self||!this.inMatch()) return;
    const path=(Array.isArray(m.path)?m.path:[]).slice(0,600)
      .filter(q=>Array.isArray(q)&&q.length===3).map(q=>q.map(v=>netNum(v,-400,400,0)));
    if(path.length<2) return;
    const step=netNum(m.step,0.001,0.1,0.02), kind=m.kind==="nectar"?"nectar":"pollen";
    Match.flying.push({path, step, t:0, dur:(path.length-1)*step, kind, color:kind==="nectar"?(m.color==="blue"?"blue":"red"):null,
      pos:path[0].slice(), fid:netNum(m.fid,0,1e9,0), mirror:true});
    if(Match.flying.length>60) Match.flying.shift();
  },

  /* ---- the host's match, to everyone ---- */
  snap(sim){
    const M=Match, L=Field.lastTip;
    return {k:"snap", t:netR(M.t),
      hive:[Field.hive.red,Field.hive.blue], tips:[Field.tips.red,Field.tips.blue],
      cells:[Field.cells.red.map(netEl).join(""),Field.cells.blue.map(netEl).join("")],
      tip:L?[L.id,L.al,L.from,L.by||""]:null,
      bots:M.bots.map(b=>[b.id,netR(b.x),netR(b.y),netR(b.h),netR(b.vx),netR(b.vy),b.hold.map(netEl).join("")]),
      floor:M.floor.map(e=>[e.id,netEl(e),netR(e.x),netR(e.y)]),
      flowers:M.flowers.map(f=>f.stack.map(netEl).join("")),
      humans:["red","blue"].map(al=>{ const H=M.humans[al], A=H.anim;
        return [H.tray,H.entered,A?[netR(A.t),A.dur,netR(A.to.x),netR(A.to.y)]:0]; }),
      ev:M.events.slice(0,6).map(e=>[netR(e.t),e.text,e.al||""]),
      score:this.scoreOut(M.score(sim))};
  },
  scoreOut(S){
    const o={};
    for(const al of ["red","blue"]){ const r=S[al], c={};
      for(const k of ["tips","tipPts","leave","park","cell","flower","bottom","garden","total"]) c[k]=netNum(r&&r[k],0,9999,0);
      o[al]=c; }
    return o;
  },
  applySnap(m){
    const M=Match; if(!M.on||!Field.ok) return;
    const H=Field.half()+0.2, side=v=>v===1?1:-1, num=(v,d)=>netNum(v,-H,H,d);
    M.t=netNum(m.t,0,M.len,M.t);
    const hv=Array.isArray(m.hive)?m.hive:[], tp=Array.isArray(m.tips)?m.tips:[], cl=Array.isArray(m.cells)?m.cells:[];
    const key=JSON.stringify([hv,tp,cl]);
    if(key!==this.fieldKey){
      this.fieldKey=key;
      Field.hive={red:side(hv[0]), blue:side(hv[1])};
      Field.tips={red:netNum(tp[0],0,99,0)|0, blue:netNum(tp[1],0,99,0)|0};
      Field.cells={red:netEls(cl[0],12), blue:netEls(cl[1],12)};
      Field.version++;
    }
    const T=m.tip;
    if(Array.isArray(T)&&(!Field.lastTip||Field.lastTip.id!==T[0])){
      const al=T[1]==="blue"?"blue":"red";
      Field.lastTip={id:netNum(T[0],0,1e6,0), al, from:side(T[2]), to:-side(T[2]), n:Field.tips[al], by:netStr(T[3],40)||undefined, spilled:[]};
    }
    for(const row of (Array.isArray(m.bots)?m.bots:[]).slice(0,4)){
      if(!Array.isArray(row)) continue;
      const b=M.bots.find(x=>x.id===row[0]); if(!b) continue;
      b.nx=num(row[1],b.x); b.ny=num(row[2],b.y); b.nh=netNum(row[3],-100,100,b.h);
      b.vx=netNum(row[4],-4,4,0); b.vy=netNum(row[5],-4,4,0); b.hold=netEls(row[6],4); b.age=0;
    }
    if(Array.isArray(m.floor)) M.floor=m.floor.slice(0,300).filter(Array.isArray).map(r=>{ const e=netEls(r[1],1)[0]||{kind:"pollen", color:null};
      return {id:netNum(r[0],0,1e9,0), kind:e.kind, color:e.color, x:num(r[2],0), y:num(r[3],0), claim:null}; });
    if(Array.isArray(m.flowers)) m.flowers.slice(0,M.flowers.length).forEach((s,i)=>{ M.flowers[i].stack=netEls(s,FLOWER_CAP); });
    if(Array.isArray(m.humans)) ["red","blue"].forEach((al,i)=>{ const r=m.humans[i]; if(!Array.isArray(r)) return;
      const Hm=M.humans[al]; Hm.tray=netNum(r[0],0,5,Hm.tray)|0; Hm.entered=netNum(r[1],0,5,Hm.entered)|0;
      const A=r[2]; Hm.anim=Array.isArray(A)?{t:netNum(A[0],0,5,0), dur:netNum(A[1],0.1,5,1.3), to:{x:num(A[2],0), y:num(A[3],0)}}:null; });
    if(Array.isArray(m.ev)) M.events=m.ev.slice(0,6).filter(Array.isArray).map(e=>({t:netNum(e[0],0,M.len,0), text:netStr(e[1],120), al:e[2]==="red"||e[2]==="blue"?e[2]:null}));
    if(m.score&&typeof m.score==="object") this.score=this.scoreOut(m.score);
  },
  /* guest: the host's match between two of its messages, and this robot in it */
  mirror(dt,sim){
    const M=Match;
    if(M.t<M.len) M.t=Math.min(M.len,M.t+dt);
    const k=Math.min(1,dt*12);
    for(const b of M.bots){
      if(b.nx==null) continue;
      b.age=(b.age||0)+dt; const a=Math.min(b.age,0.25);
      b.x+=(b.nx+b.vx*a-b.x)*k; b.y+=(b.ny+b.vy*a-b.y)*k; b.h+=wrapA(b.nh-b.h)*k;
    }
    for(const al of ["red","blue"]){ const A=M.humans[al].anim; if(A) A.t=Math.min(A.dur,A.t+dt); }
    for(const f of M.flying){
      const step=f.step||SHOT_STEP_S; f.t+=dt;
      const q=Math.min(f.path.length-1,f.t/step), i=Math.floor(q), fr=q-i, a=f.path[i], c=f.path[Math.min(f.path.length-1,i+1)];
      f.pos=[a[0]+(c[0]-a[0])*fr, a[1]+(c[1]-a[1])*fr, a[2]+(c[2]-a[2])*fr];
      if(f.t>=f.dur) f.done=true;
    }
    M.flying=M.flying.filter(f=>!f.done);
    M.separate(sim);
    M.version++;
  },

  /* ---- the end ---- */
  stats(){
    const out=[];
    for(const s of NET_SLOTS){
      const h=this.slots&&this.slots[s]; if(!h) continue;
      if(h==="ai"){ const b=Match.bots.find(x=>x.place===s); if(b) out.push({slot:s, name:b.name, ai:true, fired:b.fired, scored:b.scored}); }
      else if(h===this.self) out.push({slot:s, name:this.name, fired:typeof Shots!=="undefined"?Shots.fired:0, scored:typeof Shots!=="undefined"?Shots.scored:0});
      else{ const p=this.players[h]; out.push({slot:s, name:p?p.name:"(left)", fired:p?p.fired||0:0, scored:p?p.scored||0:0}); }
    }
    return out;
  },
  finish(sim){
    this.score=this.scoreOut(Match.score(sim));
    this.final={score:this.score, stats:this.stats()};
    this.room.send({k:"end", score:this.final.score, stats:this.final.stats});
    this.state="done";
    this.emit("end",this.final);
  },
  onEnd(m){
    const stats=(Array.isArray(m.stats)?m.stats:[]).slice(0,4).map(s=>({slot:NET_SLOTS.indexOf(s&&s.slot)>=0?s.slot:"red1",
      name:netStr(s&&s.name,40), ai:!!(s&&s.ai), fired:netNum(s&&s.fired,0,999,0)|0, scored:netNum(s&&s.scored,0,999,0)|0}));
    this.score=this.scoreOut(m.score||{});
    this.final={score:this.score, stats};
    this.state="done";
    this.emit("end",this.final);
  },
  /* host: back to the room, everyone in the same places, to play again */
  again(){
    if(this.role!=="host"||this.state!=="done") return;
    this.state="room"; this.final=null; this.unmatch();
    for(const id in this.players) this.players[id].ready=false;
    if(this.pub) this.browse();
    this.sendRoster();
  },

  /* ---- talking: chat to everyone or the alliance, and marks on the field ---- */
  team(){ const al=this.myAl(); return Object.values(this.players).filter(p=>p.id!==this.self&&p.slot&&netAl(p.slot)===al).map(p=>p.id); },
  say(text,team){
    text=netStr(text,200); if(!text||!this.room) return;
    team=!!team&&!!this.mySlot();
    const m={k:"chat", text, team};
    if(!team) this.room.send(m); else { const to=this.team(); if(to.length) this.room.send(m,to); }
    this.addChat(this.self,m);
  },
  onChat(m,from){
    if(!this.players[from]||this.often(from,"chat",250)) return;
    const text=netStr(m.text,200); if(!text) return;
    this.addChat(from,{text, team:!!m.team});
  },
  addChat(from,m){
    const p=this.players[from];
    this.chat.push({from, name:p?p.name:"?", al:p&&p.slot?netAl(p.slot):null, text:m.text, team:m.team, at:this.now()});
    if(this.chat.length>80) this.chat.shift();
    this.emit("chat");
  },
  /* A spot on the field for the alliance: go here, shoot from here, defend here. */
  mark(x,y,what){
    if(!this.room||!this.mySlot()) return;
    const H=Field.ok?Field.half():1.83;
    const m={k:"mark", x:netR(netNum(x,-H,H,0)), y:netR(netNum(y,-H,H,0)), what:["go","shoot","defend"].indexOf(what)>=0?what:"go"};
    const to=this.team(); if(to.length) this.room.send(m,to);
    this.addMark(this.self,m);
  },
  onMark(m,from){
    const p=this.players[from]; if(!p||!p.slot||!this.mySlot()||netAl(p.slot)!==this.myAl()||this.often(from,"mark",300)) return;
    const H=Field.ok?Field.half():1.83;
    this.addMark(from,{x:netNum(m.x,-H,H,0), y:netNum(m.y,-H,H,0), what:["go","shoot","defend"].indexOf(m.what)>=0?m.what:"go"});
  },
  addMark(from,m){
    const p=this.players[from];
    this.marks.push({x:m.x, y:m.y, what:m.what, name:p?p.name:"", at:this.now()});
    if(this.marks.length>12) this.marks.shift();
    this.emit("mark");
  },
  liveMarks(){ const t=this.now(); this.marks=this.marks.filter(k=>t-k.at<8000); return this.marks; },

  /* ---- one clock: the host's ---- */
  sync(){ if(this.room&&this.hostId&&this.role==="guest") this.room.send({k:"sync", t0:this.now()},this.hostId); },
  onSync(m,from){
    if(this.role==="host"){
      if(this.players[from]&&!this.often(from,"sync",200)) this.room.send({k:"sync", t0:netNum(m.t0,0,1e16,0), th:this.now()},from);
      return;
    }
    if(from!==this.hostId||typeof m.th!=="number"||typeof m.t0!=="number") return;
    const rtt=this.now()-m.t0; if(!(rtt>=0&&rtt<10000)) return;
    // the quickest round trip of the last few says the offset best
    this.syncs.push({rtt, off:m.th+rtt/2-this.now()}); if(this.syncs.length>8) this.syncs.shift();
    const best=this.syncs.reduce((a,b)=>b.rtt<a.rtt?b:a);
    this.rtt=rtt; this.offset=best.off;
  }
};
