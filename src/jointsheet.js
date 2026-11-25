/* ============================================================
   EXACT JOINTS — which joints move, and what moves them, said once
   ------------------------------------------------------------
   An Onshape export gives every mate as a joint: its axis, its pivot, the
   parts it carries and, where the team turned them on, its limits. What no
   export holds is what the team means. REVIVER's export has 465 moving
   mates; perhaps eight are mechanisms (a turret, a hood, a kicker ...), and
   nothing in the file says which, or which motor or servo turns each.
   src/bind.js works that out from sizes, names and the code, and is right
   most of the time. Most is not exactly.

   Here the team says it, and then nothing is guessed. Two places hold it,
   and both land on the same joints:

   1. The mate's own name in Onshape. It travels with the CAD (every export,
      every teammate), and the export writes it as the joint's name, lower
      case, every other character an underscore ("Revolute 10 (1)" arrives as
      "revolute_10__1_"). So the grammar is words only, and a mate whose name
      starts with one of these words is a declaration:
        motor armMotor          a joint driven by the DcMotor "armMotor"
        motor liftL liftR       two motors on one joint
        servo claw              a servo; its range is the mate's limits
        crservo intake          a continuous-rotation servo
        follow liftL x2         turns or slides twice what liftL's joint does
        follow claw rev         the other finger of a gear claw
        free                    it moves, and nothing drives it
        fixed                   it never moves, whatever the mate says
      "rev" anywhere: the device's positive way is the mate's negative way.
      "x1p5" is a ratio of 1.5 (a dot would arrive as an underscore). Limits
      are Onshape's own mate limits, which the export carries exactly.
   2. A joint sheet on the page (format ftc-simbench.jointsheet): the same
      facts keyed by the joint's name, for a team that can't edit the CAD, and
      for what a name can't hold (limits typed in, a servo's rest position, a
      spool's millimetres per tick). It is kept per robot in the browser, can
      be downloaded, and overrides a mate name's declaration where both speak.

   Once a joint is declared with a device, the robot is exact: a declared joint
   is a mechanism with what was declared, every other joint is held as drawn
   (a bearing, a roller, a motor shaft), and a device is bound only where a
   declaration names it. Whatever is still missing is a question that names
   its fix, never a guess. Pure data, tested in Node; src/importflow.js draws
   it.
   ============================================================ */
const JOINT_SHEET_FORMAT="ftc-simbench.jointsheet";
// words that name a part or join a phrase, never a device: a mate called "Servo Horn" describes, it doesn't declare
const JT_PART_WORDS=/^(horn|mount|mounts|bracket|plate|shaft|axle|gear|gearbox|pulley|hub|bearing|spacer|standoff|coupler|coupling|clamp|block|case|cover|holder|side|pivot|joint|mate|to|and|on|the|with|of|in)$/i;

const {jointTag, jointNameKey, onshapeMateName, sheetFromTags, applyJointSheet, clearJointSheet, mergeJointSheets, sheetBindings, checkJointSheet, tagFor, isExact}=(function(){
  const DEG=Math.PI/180;
  const ROLES={motor:"motor", servo:"servo", crservo:"crservo", follow:"follow", follows:"follow", free:"free", passive:"free", fixed:"fixed", rigid:"fixed"};
  const DRIVEN=new Set(["motor","servo","crservo"]);
  const KINDS=new Set(["motor","servo","crservo","follow","free","fixed","none"]);
  const DEFAULT_MATE=/^(revolute|slider|cylindrical|pin_slot|planar|ball|parallel|fastened|tangent|width)_(\d+)((?:__\d+_)*)(?:_(\d+))?$/;

  /* a name as the export writes it: lower case, every other character an underscore */
  const jointNameKey=s=>String(s==null?"":s).toLowerCase().replace(/[^a-z0-9]/g,"_");
  /* a device name for comparing: letters and digits only */
  const devKey=s=>String(s==null?"":s).toLowerCase().replace(/[^a-z0-9]/g,"");
  /* every run of consecutive words joined: "left front" could be leftFront, or left and front */
  const joins=words=>{ const out=new Set(); const w=(words||[]).map(devKey).filter(Boolean);
    for(let i=0;i<w.length;i++){ let s=""; for(let j=i;j<w.length&&j<i+4;j++){ s+=w[j]; out.add(s); } } return out; };

  /* ---- a mate's name -> a declaration, or null when it is just a name ---- */
  function jointTag(name){
    const words=String(name==null?"":name).split(/[^A-Za-z0-9]+/).filter(Boolean);
    if(!words.length) return null;
    const drive=ROLES[words[0].toLowerCase()]; if(!drive) return null;
    let rev=false, ratio=null; const rest=[];
    for(const w of words.slice(1)){
      const l=w.toLowerCase();
      if(/^\d+$/.test(l)) continue;                       // a copy's "(1)", an instance's "_3"
      if(l==="loop"||l==="closure") continue;             // the export's loop-closure suffix
      if(l==="rev"||l==="reverse"||l==="reversed"||l==="inv") { rev=true; continue; }
      const r=/^x(\d+)(?:p(\d+))?$/.exec(l); if(r){ ratio=+(r[1]+(r[2]?"."+r[2]:"")); continue; }
      rest.push(w);
    }
    // "Servo Horn", "Motor Mount to Plate": a team describing the parts, not declaring a device.
    // Read as a declaration it would make the robot exact and hold every other joint
    if(DRIVEN.has(drive)&&rest.length&&rest.every(w=>JT_PART_WORDS.test(w))) return null;
    const t={drive, rev};
    if(drive==="follow"){ if(!rest.length) return null; t.follows=rest.join(" "); if(ratio!=null) t.ratio=ratio; }
    else if(DRIVEN.has(drive)) t.devices=rest;
    return t;
  }
  /* The mate to look for in Onshape, from the joint's name in an export. A default
     name reads back exactly ("revolute_10__1__3" is "Revolute 10 (1)", its fourth
     copy: the mate sits in a subassembly used more than once); any other comes
     back as its words. */
  function onshapeMateName(joint){
    const s=String(joint==null?"":joint), m=DEFAULT_MATE.exec(s);
    if(m){ const t=m[1].replace("_"," "), name=t[0].toUpperCase()+t.slice(1)+" "+m[2]+(m[3]||"").replace(/__(\d+)_/g," ($1)");
      return {mate:name, copy:m[4]!=null?+m[4]+1:1, exact:true}; }
    const c=/^(.*?)(?:_(\d+))?$/.exec(s);
    return {mate:c[1].replace(/__(\d+)_/g," ($1)").replace(/_+/g," ").trim()||s, copy:c[2]!=null?+c[2]+1:1, exact:false};
  }
  /* what to name the mate in Onshape so the next export says this by itself */
  function tagFor(e){
    if(!e||!KINDS.has(e.drive)||e.drive==="none") return "";
    const ratio=Number.isFinite(+e.ratio)&&+e.ratio!==1?" x"+String(+(+e.ratio).toFixed(3)).replace(".","p"):"";
    if(e.drive==="follow") return "follow "+String(e.follows||"").trim()+ratio+(e.rev?" rev":"");
    if(DRIVEN.has(e.drive)) return (e.drive+" "+(e.devices||[]).join(" ")).trim()+(e.rev?" rev":"");
    return e.drive;
  }

  /* ---- the declarations in the mates' names ---- */
  function sheetFromTags(cad){
    const joints=[];
    for(const m of (cad&&cad.mechs)||[]){
      if(m.drive||!m.fromMate) continue;
      const t=jointTag(m.fromMate.name); if(!t) continue;
      joints.push(Object.assign({joint:m.fromMate.name, from:"tag"},t));
    }
    if(!joints.length) return null;
    // only a joint declared with what drives it makes the robot exact: a lone "free" or
    // "follow" mate (a team's own descriptive name, perhaps) only says what it says
    return {format:JOINT_SHEET_FORMAT, version:1, robot:(cad&&cad.name)||null, exact:joints.some(j=>DRIVEN.has(j.drive)), joints};
  }
  /* b's joints over a's, joint by joint; a "none" in b takes a's declaration away */
  function mergeJointSheets(a,b){
    if(!a&&!b) return null;
    const by=new Map();
    for(const s of [a,b]) for(const e of (s&&s.joints)||[]) if(e&&e.joint) by.set(jointNameKey(e.joint),e);
    const joints=[...by.values()].filter(e=>e.drive!=="none");
    const exact=[a,b].some(s=>s&&s.exact!==false&&(s.joints||[]).some(e=>DRIVEN.has(e.drive)))&&joints.some(e=>DRIVEN.has(e.drive));
    return {format:JOINT_SHEET_FORMAT, version:1, robot:(b&&b.robot)||(a&&a.robot)||null, exact, joints};
  }

  /* ---- the sheet onto the robot's joints ----
     Idempotent: what a joint had before any sheet is kept on it and put back
     first, so a sheet applied again, or a changed one, starts from the mates. */
  const KEPT=["limits","dir","couple","label","gear","mmPerTick","restPos","q0"];
  function reset(m){
    if(m.sheetWas){ for(const k of KEPT){ if(m.sheetWas[k]===undefined) delete m[k]; else m[k]=m.sheetWas[k]; } delete m.sheetWas; }
    for(const k of ["declared","declaredRole","declaredFrom","declaredFixed","declaredEntry","sheetDevices","sheetFollows"]) delete m[k];
  }
  function remember(m){ if(!m.sheetWas){ m.sheetWas={}; for(const k of KEPT) m.sheetWas[k]=m[k]===undefined?undefined:JSON.parse(JSON.stringify(m[k])); } }
  function clearJointSheet(cad){ for(const m of (cad&&cad.mechs)||[]) reset(m); if(cad) cad.sheet=null; }
  const lims=x=>!!(x&&Array.isArray(x.limits)&&x.limits.some(v=>Number.isFinite(v)));
  const kindOf=m=>typeof normJointKind==="function"?normJointKind(m.kind):m.kind;

  function applyJointSheet(cad,sheet){
    if(!sheet||sheet.format!==JOINT_SHEET_FORMAT) throw new Error("not a joint sheet (format "+JOINT_SHEET_FORMAT+")");
    const all=((cad&&cad.mechs)||[]).filter(m=>!m.drive&&m.fromMate);
    for(const m of all) reset(m);
    const byKey=new Map();
    for(const m of all) for(const k of new Set([jointNameKey(m.fromMate.name),jointNameKey(m.id)])){ if(!byKey.has(k)) byKey.set(k,[]); if(!byKey.get(k).includes(m)) byKey.get(k).push(m); }
    const entries=((sheet.joints)||[]).filter(e=>e&&typeof e.joint==="string"&&e.joint&&KINDS.has(e.drive)&&e.drive!=="none");
    const missing=[], why=[], cannot=[], moved=[];
    let fromTag=0, fromSheet=0;
    // A sheet entry written on the page also keeps where its joint was (at, mm). A mate inside a
    // subassembly used many times is numbered by instance ("revolute_1_179"), and adding a servo
    // can renumber them: the entry follows its pivot to the new number rather than land on another servo.
    const off=(m,at)=>m.pivot?Math.hypot(m.pivot[0]*1000-at[0],m.pivot[1]*1000-at[1],m.pivot[2]*1000-at[2]):Infinity;
    const baseOf=n=>{ const k=jointNameKey(n), d=DEFAULT_MATE.exec(k); return d?d[1]+"_"+d[2]+(d[3]||""):k.replace(/_\d+$/,""); };
    for(const e of entries){
      let ms=byKey.get(jointNameKey(e.joint))||[];
      const at=Array.isArray(e.at)&&e.at.length===3&&e.at.every(v=>Number.isFinite(+v))?e.at.map(Number):null;
      if(at){
        ms=ms.filter(m=>off(m,at)<=15);
        if(!ms.length){
          const b=baseOf(e.joint), c=all.filter(m=>baseOf(m.fromMate.name)===b).map(m=>({m, d:off(m,at)})).filter(x=>x.d<=15).sort((p,q)=>p.d-q.d)[0];
          if(c){ ms=[c.m]; moved.push(e.joint+" → "+c.m.fromMate.name); }
        }
      }
      if(!ms.length){ missing.push(e.joint); continue; }
      if(e.from==="tag") fromTag++; else fromSheet++;
      for(const m of ms){
        if(m.kind==="fixed"&&e.drive!=="fixed"){ cannot.push(e.joint); continue; }   // a planar or ball mate: nothing to drive
        remember(m);
        m.declared=true; m.declaredRole=e.drive; m.declaredFrom=e.from==="tag"?"tag":"sheet"; m.declaredEntry=JSON.parse(JSON.stringify(e));
        if(e.drive==="fixed"){ m.declaredFixed=true; continue; }
        const lin=kindOf(m)==="linear";
        if(Array.isArray(e.limits)&&e.limits.length===2&&e.limits.some(v=>v!=null&&v!==""&&Number.isFinite(+v)))
          m.limits=e.limits.map(v=>v==null||v===""||!Number.isFinite(+v)?null:(lin?+v/1000:+v*DEG));
        if(e.drive!=="follow") m.dir=e.rev?-1:1;
        if(Number.isFinite(+e.gear)&&+e.gear>0) m.gear=+e.gear;
        if(Number.isFinite(+e.mmPerTick)&&+e.mmPerTick>0) m.mmPerTick=+e.mmPerTick;
        if(e.restPos!=null&&Number.isFinite(+e.restPos)) m.restPos=Math.max(0,Math.min(1,+e.restPos));
        if(DRIVEN.has(e.drive)) m.sheetDevices=(e.devices||[]).map(String).filter(Boolean);
        const named=e.as?String(e.as):DRIVEN.has(e.drive)&&m.sheetDevices.length?m.sheetDevices.join(" + "):null;
        if(named) m.label=named;
      }
    }
    // a follower's leader: the declared joint its device drives, else the joint by its name or label
    const declared=all.filter(m=>m.declared&&!m.declaredFixed);
    const leaderFor=ref=>{
      const k=devKey(ref), kn=jointNameKey(ref);
      return declared.find(m=>m.declaredRole!=="follow"&&joins(m.sheetDevices).has(k))
        ||declared.find(m=>jointNameKey(m.fromMate.name)===kn||devKey(m.label)===k||devKey(m.id)===k)||null;
    };
    for(const e of entries){
      if(e.drive!=="follow") continue;
      const L=leaderFor(e.follows||"");
      for(const m of byKey.get(jointNameKey(e.joint))||[]){
        if(!m.declared||m.declaredFixed) continue;
        m.sheetFollows=String(e.follows||"");
        if(!L||L===m){ why.push("\""+e.joint+"\" follows \""+(e.follows||"?")+"\", which no declared joint is."); continue; }
        const r=Number.isFinite(+e.ratio)&&+e.ratio!==0?+e.ratio:1;
        m.couple={to:L.id, ratio:(e.rev?-1:1)*r, via:"declared"};
        if(!m.label||m.label===m.sheetWas.label) m.label=(L.label||L.id)+" (follows)";
      }
    }
    // one device named on several joints (a mate in a subassembly used twice: two arms on one
    // shaft) drives the first; the rest turn with it, the same way round in the world
    const groups=new Map();
    for(const m of declared){ if(!DRIVEN.has(m.declaredRole)||!m.sheetDevices.length||m.couple) continue;
      const k=m.declaredRole+":"+m.sheetDevices.map(devKey).sort().join("+"); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(m); }
    for(const g of groups.values()) for(const m of g.slice(1)){
      const a=g[0].axis, b=m.axis, same=!a||!b||a[0]*b[0]+a[1]*b[1]+a[2]*b[2]>=0;
      m.couple={to:g[0].id, ratio:same?1:-1, via:"same device"};
    }
    const exact=sheet.exact!==false&&declared.some(m=>DRIVEN.has(m.declaredRole));
    const live=declared.length, held=all.filter(m=>m.kind!=="fixed").length-live;
    const where=[fromTag?fromTag+" from your mates' names":"",fromSheet?fromSheet+" from your joint sheet":""].filter(Boolean).join(", ");
    if(live) why.unshift(live+" joint"+(live===1?"":"s")+" declared ("+where+")"+(exact?"; the other "+held+" are held as drawn, so nothing is guessed.":"."));
    if(moved.length) why.push("Renumbered by this export, found by where they sit: "+moved.slice(0,4).join(", ")+(moved.length>4?" …":"")+".");
    if(missing.length) why.push(missing.length+" declared joint"+(missing.length===1?" isn't":"s aren't")+" in this export (renamed or deleted in Onshape?): "+missing.slice(0,4).join(", ")+(missing.length>4?" …":"")+".");
    if(cannot.length) why.push(cannot.slice(0,3).join(", ")+(cannot.length===1?" is a planar, parallel or ball mate":" are planar, parallel or ball mates")+": nothing can drive "+(cannot.length===1?"it":"them")+".");
    const from=fromTag&&fromSheet?"tags+sheet":fromTag?"tags":"sheet";
    cad.sheet={exact, from, declared:live, held:Math.max(0,held), missing, why,
      joints:entries.map(e=>JSON.parse(JSON.stringify(e)))};
    return cad.sheet;
  }
  /* exact mode is on: a sheet says so and some joint is still declared on this robot */
  function isExact(cad){ return !!(cad&&cad.sheet&&cad.sheet.exact&&(cad.mechs||[]).some(m=>m.declared&&!m.declaredFixed)); }

  /* ---- the code's devices onto the declared joints ----
     [{device, joint, from}] for every device a declaration names. devs: the
     code's devices ({name, cfg, alias, type}). */
  function sheetBindings(cad,devs){
    const out=[], decl=((cad&&cad.mechs)||[]).filter(m=>m.declared&&!m.declaredFixed&&m.sheetDevices&&m.sheetDevices.length);
    for(const d of devs||[]){
      const keys=[d.name,d.cfg,d.alias].filter(Boolean).map(devKey);
      const hit=decl.find(m=>{ const J=joins(m.sheetDevices); return keys.some(k=>J.has(k)); });
      if(hit) out.push({device:d.name, joint:hit.id, from:hit.declaredFrom});
    }
    return out;
  }

  /* ---- what the declarations still leave open, each with its fix ----
     {exact, items:[{sev:"fail"|"warn"|"ok", text, joint?, device?, tag?}]}.
     code may be null (no OpModes yet); map is device -> joint id. */
  const lev=(a,b)=>{ a=devKey(a); b=devKey(b); const d=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){ let p=d[0]; d[0]=i; for(let j=1;j<=b.length;j++){ const t=d[j]; d[j]=Math.min(d[j]+1,d[j-1]+1,p+(a[i-1]===b[j-1]?0:1)); p=t; } } return d[b.length]; };
  function checkJointSheet(cad,code,map,opts){
    opts=opts||{};
    const S=cad&&cad.sheet, items=[];
    if(!S) return {exact:false, items};
    const exact=isExact(cad);
    const mechs=(cad.mechs||[]).filter(m=>m.declared&&!m.declaredFixed);
    const name=m=>m.label||m.id;
    for(const j of S.missing||[]) items.push({sev:"warn", joint:null, text:"Your sheet names \""+j+"\", which isn't a joint in this export: renamed or deleted in Onshape?"});
    const devs=((code&&code.devices)||[]).filter(d=>/servo|dcmotor/i.test(d.type||"")&&!(typeof isDriveDevice==="function"&&isDriveDevice(d)));
    const moved=typeof opts.isCommanded==="function"?opts.isCommanded:()=>true;
    for(const m of mechs){
      const role=m.declaredRole, lin=kindOf(m)==="linear";
      // a name that matches no device in the code
      if(code&&m.sheetDevices&&m.sheetDevices.length){
        const J=joins(m.sheetDevices), any=devs.some(d=>[d.name,d.cfg,d.alias].filter(Boolean).some(k=>J.has(devKey(k))));
        if(!any){ const said=m.sheetDevices.join(""), near=devs.map(d=>({d, n:Math.min(...[d.cfg,d.name].filter(Boolean).map(k=>lev(said,k)))})).sort((p,q)=>p.n-q.n)[0];
          items.push({sev:"warn", joint:m.id, text:"\""+name(m)+"\" is declared as "+role+" "+m.sheetDevices.join(" ")+", but your code has no device by that name"+(near&&near.n<=3?" (did you mean "+(near.d.cfg||near.d.name)+"?)":"")+"."}); }
      }
      if(role==="servo"&&!lims(m)&&!lin) items.push({sev:"warn", joint:m.id, text:"\""+name(m)+"\" is a servo with no range. Turn on Limits in its mate in Onshape, or type them in the joint sheet."});
      if(lin&&role==="motor"&&!lims(m)) items.push({sev:"warn", joint:m.id, text:"\""+name(m)+"\" is a slide with no travel limits, so it would run on forever. Turn on Limits in its mate in Onshape, or type them in the joint sheet."});
    }
    for(const w of S.why||[]) if(/which no declared joint is/.test(w)) items.push({sev:"fail", text:w});
    // devices the code moves that no declaration names
    if(code&&exact) for(const d of devs){
      if(!moved(d.name)) continue;
      const j=map&&map[d.name];
      if(j&&mechs.some(m=>m.id===j)) continue;
      const kind=/crservo/i.test(d.type||"")?"crservo":/servo/i.test(d.type||"")?"servo":"motor";
      items.push({sev:"fail", device:d.name, tag:kind+" "+(d.cfg||d.name), text:"Your code moves "+d.name+", but no declared joint names it. In Onshape, rename the mate that moves it to \""+kind+" "+(d.cfg||d.name)+"\", or pick its joint in the joint sheet."});
    }
    if(exact&&!items.some(i=>i.sev==="fail")) items.unshift({sev:"ok", text:mechs.length+" declared joint"+(mechs.length===1?"":"s")+"; nothing guessed."});
    return {exact, items};
  }

  return {jointTag, jointNameKey, onshapeMateName, sheetFromTags, applyJointSheet, clearJointSheet, mergeJointSheets, sheetBindings, checkJointSheet, tagFor, isExact};
})();
