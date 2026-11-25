/* ============================================================
   THE MINIMAP — the whole field from above, as the drivers face it
   ------------------------------------------------------------
   In the Chase or Robot cam view a driver can't see the field, and in any
   view the far side hides behind the HIVEs. The minimap draws it flat:
   the LOADING ZONES and GARDENS, the HIVEs and FLOWERs, every robot (yours
   outlined) and every POLLEN and NECTAR on the floor. Your alliance's wall
   is at the bottom, so up on the map is away from you, as on the field.

   mapPoint and minimapItems are pure (field inches in, screen out), for the
   tests; Minimap draws them onto a small canvas in the viewport.
   ============================================================ */
/* Field inches (x, y) to the map's pixels, from al's driver station: their wall at the bottom.
   Red drives from -x, so up is +x and right is -y; blue drives from +x, so up is -x and right is +y. */
function mapPoint(x,y,al,half,W,H){
  const s=Math.min(W,H)/(2*half), right=al==="blue"?y:-y, up=al==="blue"?-x:x;
  return [W/2+right*s, H/2-up*s];
}
/* the heading on the map, radians clockwise from screen right, for a field heading (CCW from +x) */
function mapHeading(h,al){ return al==="blue"?-(h-Math.PI/2):-(h+Math.PI/2); }
/* What to draw, in field inches: S = {half, zones, gardens, hives:{red:x,blue:x}, flowers:[{x,y}],
   robots:[{x,y,h,hx,hy,al,me,name}] (metres), balls:[{x,y,kind,color}] (metres)} */
function minimapItems(S){
  const M=1/0.0254, out=[];
  for(const al of ["red","blue"]){
    const z=S.zones&&S.zones[al]; if(z) out.push({t:"zone", al, x0:z.x0, x1:z.x1, y0:z.y0, y1:z.y1});
    const g=S.gardens&&S.gardens[al]; if(g) out.push({t:"garden", al, x0:g.x0, x1:g.x1, y0:g.y0, y1:g.y1});
  }
  for(const al of ["red","blue"]) if(S.hives&&Number.isFinite(S.hives[al])) out.push({t:"hive", al, x:S.hives[al], y:0, r:10});
  for(const f of S.flowers||[]) out.push({t:"flower", x:f.x, y:f.y, r:3});
  for(const b of S.balls||[]) if(Number.isFinite(b.x)&&Number.isFinite(b.y)) out.push({t:"ball", x:b.x*M, y:b.y*M, kind:b.kind, color:b.color});
  for(const r of S.robots||[]) if(Number.isFinite(r.x)&&Number.isFinite(r.y))
    out.push({t:"robot", x:r.x*M, y:r.y*M, h:r.h||0, hx:(r.hx||0.23)*M, hy:(r.hy||0.23)*M, al:r.al||"red", me:!!r.me, name:r.name||""});
  return out;
}

const Minimap={
  on:false, cv:null, T:0,
  init(){
    this.cv=$("#minimap"); const b=$("#mapBtn"); if(!this.cv||!b) return;
    this.on=store.get("ftcbench.minimap","0")==="1";
    b.addEventListener("click",()=>{ this.on=!this.on; store.set("ftcbench.minimap",this.on?"1":"0"); this.render(); });
    this.render();
  },
  render(){ const b=$("#mapBtn"); if(b){ b.classList.toggle("on",this.on); b.setAttribute("aria-pressed",this.on?"true":"false"); } if(this.cv) this.cv.hidden=!this.on||!Field.ok; },
  /* what's on the field now */
  state(){
    const F=Field.data.field, al=Shots.alliance==="blue"?"blue":"red";
    const robots=[], fp=Sim.footprint||{hx:0.23,hy:0.23};
    if(!(Match.noUser)) robots.push({x:Sim.chassis.x, y:Sim.chassis.y, h:Sim.chassis.h, hx:fp.hx, hy:fp.hy, al, me:true});
    if(Match.on||Match.net){
      for(const b of Match.bots||[]) robots.push({x:b.x, y:b.y, h:b.h, hx:b.hx, hy:b.hy, al:b.al, name:b.name});
      for(const p of Match.players||[]) robots.push({x:p.x, y:p.y, h:p.h, hx:p.hx, hy:p.hy, al:p.al, name:p.name});
    }
    const balls=[].concat(Match.on||Match.net?(Match.floor||[]):[]);
    return {al, half:F.field.half, zones:F.loadingZones, gardens:F.gardens, hives:F.hive&&F.hive.hiveX, flowers:F.flowers, robots, balls};
  },
  /* the page's slow loop: ten times a second while it shows */
  tick(){
    if(!this.on||!this.cv||!Field.ok) return;
    const now=performance.now(); if(now-this.T<100) return; this.T=now;
    const S=this.state(), cv=this.cv, dpr=Math.min(2,devicePixelRatio||1), css=cv.clientWidth||160;
    if(cv.width!==Math.round(css*dpr)){ cv.width=cv.height=Math.round(css*dpr); }
    const c=cv.getContext("2d"), W=cv.width, H=cv.height, half=S.half, al=S.al;
    const P=(x,y)=>mapPoint(x,y,al,half,W,H), k=Math.min(W,H)/(2*half);
    const rect=(o,fill)=>{ const a=P(o.x0,o.y0), b=P(o.x1,o.y1); c.fillStyle=fill; c.fillRect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1])); };
    const RED="#e5483d", BLUE="#2f7cf6";
    c.clearRect(0,0,W,H);
    c.fillStyle="rgba(58,61,66,.92)"; c.fillRect(0,0,W,H);
    c.strokeStyle="rgba(255,255,255,.08)"; c.lineWidth=1;
    for(let i=1;i<6;i++){ const v=i*W/6; c.beginPath(); c.moveTo(v,0); c.lineTo(v,H); c.moveTo(0,v); c.lineTo(W,v); c.stroke(); }
    for(const it of minimapItems(S)){
      const col=it.al==="blue"?BLUE:RED;
      if(it.t==="zone") rect(it,it.al==="blue"?"rgba(47,124,246,.35)":"rgba(229,72,61,.35)");
      else if(it.t==="garden") rect(it,it.al==="blue"?"rgba(47,124,246,.6)":"rgba(229,72,61,.6)");
      else if(it.t==="hive"){ const p=P(it.x,it.y); c.fillStyle="rgba(240,240,240,.85)"; c.beginPath(); c.arc(p[0],p[1],it.r*k,0,2*Math.PI); c.fill(); c.strokeStyle=col; c.lineWidth=2*dpr; c.stroke(); }
      else if(it.t==="flower"){ const p=P(it.x,it.y); c.fillStyle="#3fae5a"; c.fillRect(p[0]-it.r*k,p[1]-it.r*k,2*it.r*k,2*it.r*k); }
      else if(it.t==="ball"){ const p=P(it.x,it.y); c.fillStyle=it.kind==="nectar"?(it.color==="blue"?BLUE:RED):"#f2c230"; c.beginPath(); c.arc(p[0],p[1],Math.max(1.5*dpr,2.2*k),0,2*Math.PI); c.fill(); }
      else if(it.t==="robot"){
        const p=P(it.x,it.y);
        c.save(); c.translate(p[0],p[1]); c.rotate(mapHeading(it.h,al));
        c.fillStyle=col; c.globalAlpha=it.me?1:0.8; c.fillRect(-it.hx*k,-it.hy*k,2*it.hx*k,2*it.hy*k);
        c.fillStyle="#fff"; c.beginPath(); c.moveTo(it.hx*k,0); c.lineTo(it.hx*k*0.35,-it.hy*k*0.5); c.lineTo(it.hx*k*0.35,it.hy*k*0.5); c.closePath(); c.fill();   // its front
        if(it.me){ c.globalAlpha=1; c.strokeStyle="#fff"; c.lineWidth=2*dpr; c.strokeRect(-it.hx*k,-it.hy*k,2*it.hx*k,2*it.hy*k); }
        c.restore();
      }
    }
    // the drivers' wall
    c.fillStyle=al==="blue"?BLUE:RED; c.fillRect(0,H-3*dpr,W,3*dpr);
  },
};
