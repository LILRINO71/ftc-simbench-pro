/* ============================================================
   5.  MAPPING
   ============================================================ */
/* Devices that never drive a CAD mechanism: sensors and the IMU move nothing,
   and a drive motor turns a wheel (the drivetrain pairs those with wheels by
   corner). */
const MAP_NOT_ACTUATOR=/Sensor|IMU|BNO055|Gyro|Camera|Webcam|Limelight|Odometry|Pinpoint|OTOS|LED|Voltage/i;
function isDriveDevice(dev){
  if(!/DcMotor/i.test(dev.type||"")) return false;
  for(const n of [dev.name,dev.cfg]){
    if(!n) continue;
    const c=wheelCorner(n);
    if((c.front||c.back)&&(c.left||c.right)) return true;              // frontLeft, fL, rb
    if((c.left||c.right)&&/drive|wheel/i.test(n)) return true;         // leftDrive
  }
  return false;
}
/* Which CAD mechanism each device drives, by name. Both the variable and the
   hardware-config name count — `motor` says nothing, "Arm" does — and so do
   the joint's own names: its id, the mate it came from, the parts it carries.
   Names are read as words (liftMotorLeft -> lift motor left), against what
   FTC teams call each mechanism. Assignment is best match first across every
   device, so an early device can't take a later one's obvious match. Two
   motors named alike (liftLeft and liftRight, uppies and uppies1) drive the
   same joint, as a two-motor lift does. The old drive-word synonyms (left,
   front, motor) matched any mechanism with Left in its name, which is how a
   mecanum motor ended up driving a linear slide; those words never count.

   How sure a name is (autoMapScored gives each match its evidence; src/bind.js
   binds outright only at BIND_RULES.nameScoreSure, 70, and above):
     100  the device's name is the joint's name
      80  a word of the joint's OWN name (its id, its label, its mate's name)
      75  the joint's own name is nothing but a subsystem word the device's name has too
      70  the joint's id contains the device's name
     <70  hints, which only rank the answers to a question: a word found only in
          the name of a part the joint carries, a subsystem word shared with a
          longer joint name, a synonym, a short form, the joint's kind.
   "outtake" and "deposit" are no longer synonyms of a lift: an FTC outtake is as
   often an arm, a wrist or a claw (GearGurus' "Outtake arm" is an arm). */
const MAP_GROUPS=[
  ["lift","slide","slides","elevator","viper","linear","vertical","vslide","uppies","climb","ascent","cascade","rail"],
  ["extend","extendo","extension","horizontal","hslide","reach","telescope"],
  ["arm","pivot","shoulder","elbow","swing","fourbar","bar","boom","link","linkage"],
  ["wrist","rotate","rotation","rot","twist","roll","pitch","flip","tilt","diffy","differential"],
  ["claw","grip","gripper","grabber","pinch","hand","clamp","finger","jaw"],
  ["intake","roller","spinner","sweeper","brush","collector","suck"],
  ["turret","yaw","swivel","spin","base"],
  ["shooter","flywheel","launcher","shoot","launch","catapult","kicker"],
  ["hang","hook","winch","climber","hanger"],
];
/* Words that name a job the robot does, not one moving thing: an intake may be a
   roller, a claw, an arm and an extension; an outtake or a deposit a lift, an arm,
   a wrist and a claw; a shooter or launcher a flywheel, a hood, a turret and a
   feeder; a hang or climb a hook, a winch, a lift or an arm; transfer, feeder and
   scoring the same. Shared on their own they say which part of the robot, not
   which joint: "outtake1" (a flywheel) and "Outtake arm" share one. */
const MAP_SUBSYSTEM=new Set(["intake","outtake","deposit","scoring","score","scorer","collector","collect","shooter","shoot","launcher","launch","transfer","feeder","climb","climber","ascent","hang","hanger","endgame"]);
const MAP_NOISE=new Set(["motor","servo","crservo","left","right","front","back","rear","top","bottom","the","and","of","main","sub","assembly","asm","part","mate","revolute","slider","fastened","series","gobilda","rev","mm","dual","mode","torque","speed"]);
function mapRaw(s){
  return String(s||"").replace(/([a-z0-9])([A-Z])/g,"$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean);
}
function mapWords(s){ return mapRaw(s).filter(w=>w.length>=2&&!MAP_NOISE.has(w)); }
/* qualifiers that tell two mechanisms apart: an "in" claw is not the outtake's */
const MAP_SIDES=[[/^(in|intake|inner)$/,/^(out|outtake|outer|deposit)$/],[/^(front|fwd)$/,/^(back|rear)$/],[/^(left|l)$/,/^(right|r)$/],
  [/^(upper|top|up)$/,/^(lower|bottom|down)$/],[/^(horizontal|h|hslide|extendo)$/,/^(vertical|v|vslide)$/]];
function mapClash(dw,mw){
  for(const [a,b] of MAP_SIDES){
    const da=dw.some(w=>a.test(w)), db=dw.some(w=>b.test(w)), ma=mw.some(w=>a.test(w)), mb=mw.some(w=>b.test(w));
    if((da&&mb&&!ma)||(db&&ma&&!mb)) return true;
  }
  return false;
}
const mapGroupOf=w=>MAP_GROUPS.findIndex(g=>g.indexOf(w)>=0||(w.length>=4&&g.some(x=>x.length>=4&&(w.startsWith(x)||x.startsWith(w)))));
/* a device's name with its side and number taken off: liftLeft, lift_r, lift2 -> lift */
function mapStem(n){ return String(n||"").replace(/([a-z0-9])([A-Z])/g,"$1 $2").toLowerCase().replace(/[_\-\s]*(left|right|l|r|[0-9]+)\b/g," ").replace(/[^a-z]+/g,""); }
function autoMap(devices,mechs,opts){ return autoMapScored(devices,mechs,opts).map; }
/* autoMap with its evidence: {map, pick, score}. pick[device] is the joint the
   name chose and why ({joint, v, raw, own, sub, whole, part, why}); score(dev, mech)
   is the same for any pair, so a question can rank its answers by it. raw is how
   sure the name is (see above); v is raw weighed by the device's kind, for ranking. */
function autoMapScored(devices,mechs,opts){
  const map={}, used={}, pick={};
  const solidsOf=opts&&opts.cad&&opts.cad.solids||[];
  const mechText=new Map();
  for(const m of mechs){
    const parts=solidsOf.filter(s=>s.mech===m.id).map(s=>s.name).slice(0,8);
    // the joint's own names (its id, label and mate) and the names of the parts it carries
    const ownNames=[m.id,m.alias,m.label,m.fromMate&&m.fromMate.name].filter(Boolean).map(mapWords).filter(ws=>ws.length);
    const own=new Set([].concat(...ownNames)), part=new Set([].concat(mapWords(m.partName),...parts.map(mapWords)));
    mechText.set(m.id,{id:String(m.id||"").toLowerCase(), alias:String(m.alias||"").toLowerCase(), own, part, ownNames, words:[...new Set([...own,...part])],
      raw:mapRaw(m.id).concat(mapRaw(m.alias))});
  }
  // a mate named exactly as the device's configuration name is the team saying so:
  // case, spaces, underscores and onshape-to-robot's dof_/_inv don't count
  const exact=s=>String(s||"").toLowerCase().replace(/^dof_/,"").replace(/_inv$/,"").replace(/[^a-z0-9]/g,"");
  const one=(name,mech)=>{
    const T=mechText.get(mech.id), s=T.id, d=String(name||"").toLowerCase();
    if(!s||!d) return null;
    const named="\""+(mech.label||mech.id)+"\"";
    if(d===s||(T.alias&&d===T.alias)) return {v:100, own:true, why:"its name is the joint's name, "+named};
    const de=exact(d); if(de.length>=2&&(de===exact(s)||(T.alias&&de===exact(T.alias)))) return {v:100, own:true, why:"its name is the joint's name, "+named};
    const dw=mapWords(name), clash=mapClash(mapRaw(name),T.raw)?50:0;
    // a meaningful word in both: "liftMotor" and the mate "Lift Stage". In the joint's own
    // name it is the team naming the joint; in a part the joint carries, only a hint
    const shared=dw.filter(w=>w.length>=3&&(T.own.has(w)||T.part.has(w)));
    if(shared.length){
      const own=shared.filter(w=>T.own.has(w)), mech=own.filter(w=>!MAP_SUBSYSTEM.has(w));
      if(mech.length) return {v:80-clash, own:true, word:mech[0], why:"its name and the joint's own name, "+named+", share \""+mech[0]+"\""};
      if(own.length){
        // the joint's own name is nothing but the subsystem word the device has too ("intake"
        // and the mate "revolute_intake"): as good as the joint's name. Shared with a longer
        // name ("Outtake arm"), it says which part of the robot, not which joint
        if(T.ownNames.some(ws=>ws.every(w=>dw.indexOf(w)>=0))) return {v:75-clash, own:true, sub:true, whole:true, word:own[0],
          why:"the joint's own name, "+named+", is \""+own[0]+"\", and so is the device's"};
        return {v:55-clash, own:true, sub:true, word:own[0], why:"\""+own[0]+"\" is in both names, but it names a part of the robot, not one joint"};
      }
      return {v:50-clash, part:true, word:shared[0], why:"\""+shared[0]+"\" is in the name of a part the joint carries"};
    }
    // a short form: "in" for intake, "ext" for extension
    if(!clash){ const w=mapRaw(name).find(w=>w.length>=2&&w.length<=3&&!MAP_NOISE.has(w)&&T.words.some(x=>x.length>=5&&x.startsWith(w)));
      if(w) return {v:60, why:"\""+w+"\" may be short for a word in "+named}; }
    if(clash) return null;
    const dc=d.replace(/[^a-z0-9]/g,""), sc=s.replace(/[^a-z0-9]/g,"");
    if(dc.length>=3&&sc.length>=3&&(sc.indexOf(dc)>=0||dc.indexOf(sc)>=0)){
      const short=dc.length<=sc.length?dc:sc, sub=[...MAP_SUBSYSTEM].some(x=>x.startsWith(short));
      return sub?{v:55, sub:true, why:"\""+short+"\" is in the joint's id, but it names a part of the robot, not one joint"}:{v:70, own:true, why:"the joint's id, "+named+", has its name in it"};
    }
    // the same kind of mechanism by another name: viper -> slide, grabber -> claw
    const dg=new Set(dw.map(mapGroupOf).filter(g=>g>=0));
    const syn=T.words.find(w=>dg.has(mapGroupOf(w)));
    if(syn) return {v:55, why:"its name and \""+syn+"\""+(T.own.has(syn)?" in the joint's name":", a part the joint carries,")+" are words for the same kind of mechanism"};
    const k=normJointKind(mech.kind), kind={v:45, why:"its name says the kind of mechanism this joint is"};
    if(mech.kind==="effector"&&dg.has(4)) return kind;
    if(k==="linear"&&(dg.has(0)||dg.has(1))) return kind;
    if(mech.kind==="revolute-lift"&&(dg.has(2)||dg.has(0))) return kind;
    if(mech.kind==="revolute-yaw"&&(dg.has(6)||dg.has(3))) return kind;
    return null;
  };
  // a servo turns things; a slide is pulled by a motor (or a continuous servo)
  const fitKind=(dev,mech)=>{ const sv=/servo/i.test(dev.type||"")&&!/crservo/i.test(dev.type||""), lin=normJointKind(mech.kind)==="linear";
    return sv&&lin?0.8:1; };
  const score=(dev,mech)=>{
    if(!mechText.has(mech.id)) return null;
    let best=null;
    for(const n of [dev.name,dev.cfg,dev.alias]){ if(!n) continue; const r=one(n,mech); if(r&&(!best||r.v>best.v)) best=r; }
    return best?Object.assign(best,{raw:best.v, v:best.v*fitKind(dev,mech)}):null;
  };
  const pairs=[];
  const acts=[];
  for(const dev of devices){
    map[dev.name]=null;
    if(MAP_NOT_ACTUATOR.test(dev.type||"")||isDriveDevice(dev)) continue;
    acts.push(dev);
    // a joint tied to another by a gear, rack or cascade is driven through that one
    for(const mech of mechs){ if(mech.couple||mech.internal) continue; const r=score(dev,mech); if(r&&r.v>=45) pairs.push({dev:dev.name, mech:mech.id, v:r.v, r}); }
  }
  pairs.sort((a,b)=>b.v-a.v);
  for(const p of pairs) if(map[p.dev]===null&&!used[p.mech]){ map[p.dev]=p.mech; used[p.mech]=p.dev; pick[p.dev]=Object.assign({joint:p.mech},p.r); }
  // the second motor of a pair drives the same joint
  for(const dev of acts){
    if(map[dev.name]!==null) continue;
    const st=mapStem(dev.name)||mapStem(dev.cfg);
    if(st.length<3) continue;
    // motors only: two servos named alike are usually a mirrored pair (one sent 1-p), not one joint's
    if(!/dcmotor/i.test(dev.type||"")) continue;
    const twin=acts.find(o=>o!==dev&&map[o.name]&&(mapStem(o.name)===st||mapStem(o.cfg)===st)&&/dcmotor/i.test(o.type||""));
    if(twin) map[dev.name]=map[twin.name];
  }
  return {map, pick, score};
}
/* Which corner a drive motor sits on, from its name. Teams write this every
   possible way — frontLeft, leftFront, left_front, motorFL, fl, lf, rearRight,
   rr — so split the name into words first, then read each word, including the
   two-letter corner codes. */
function wheelCorner(name){
  const words=String(name)
    .replace(/([a-z0-9])([A-Z])/g,"$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2")
    .toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const c={left:false,right:false,front:false,back:false};
  for(const w of words){
    if(w==="left"||w==="l") c.left=true;
    else if(w==="right") c.right=true;
    else if(w==="front"||w==="f") c.front=true;
    else if(w==="back"||w==="rear"||w==="b") c.back=true;
    else if(w.length===2){
      const a=w[0], b=w[1];
      if(a==="l"||b==="l") c.left=true;
      if(b==="r"&&"fbr".indexOf(a)>=0) c.right=true;        // fr br rr
      if(a==="r"&&"fb".indexOf(b)>=0) c.right=true;         // rf rb
      if(a==="f"||b==="f") c.front=true;
      if(a==="b"||b==="b") c.back=true;
      if(a==="r"&&(b==="l"||b==="r")) c.back=true;          // rl rr = rear
    }
  }
  return c;
}
/* A motor named like a wheel: a side, and an end or a word that says drive.
   A "leftLift" is not a wheel. */
function isWheelName(name){
  const c=wheelCorner(name);
  return (c.left||c.right)&&(c.front||c.back||/drive|wheel|motor/i.test(name));
}
/* Drive motors: those whose power comes straight off a stick. */
function detectDrivetrain(code){
  // on the VM the drive is what the motors did when the sticks moved (src/jvmrun.js)
  if(code&&code.vm){
    if(code.vm.an.drive) return Object.assign({},code.vm.an.drive,{wheels:code.vm.an.drive.wheels.map(w=>Object.assign({},w))});
    // an autonomous has no sticks to probe with: go by name, as the line reader does
    if(code.hasLoop) return null;
    const wheels=code.devices.filter(d=>/DcMotor/i.test(d.type||"")&&isWheelName(d.name)).map(d=>Object.assign({dev:d.name},wheelCorner(d.name)));
    return wheels.length<2?null:{wheels, style:wheels.length>=4?"mecanum":"tank", ok:wheels.some(w=>w.left)&&wheels.some(w=>w.right)};
  }
  const motors=code.devices.filter(d=>/DcMotor/i.test(d.type||""));
  if(motors.length<2) return null;
  const analog={};
  for(const b of (code.bindings||[])) if(b.analog) analog[b.dev]=1;
  const isAuto = !code.hasLoop && code.auto && code.auto.length>0;
  const wheels=[];
  for(const mo of motors){
    if(isAuto){ if(!isWheelName(mo.name)) continue; }   // no sticks in an autonomous: go by name
    else if(!analog[mo.name]) continue;   // PID-driven arms are not part of the drive base
    let expr=null;
    const scan=list=>{ for(const st of list||[]){
      if(st.kind==="if"){ scan(st.then); if(st.else) scan(st.else); }
      else if(st.kind==="while") scan(st.body);
      else if(st.kind==="call"&&st.dev===mo.name&&(st.op==="setPower"||st.op==="setVelocity")) expr=st;
    }};
    scan(code.stmts); scan(code.auto);
    if(!expr) continue;
    // the side and end: from running the code when that worked (src/jvmrun.js
    // vmDrive), since config names don't always match where a motor sits; else the name
    const vw=code.vmDrive&&code.vmDrive.wheels.find(w=>w.dev===mo.name||(mo.cfg&&w.dev===mo.cfg));
    const at=vw&&(vw.left||vw.right)?{left:!!vw.left,right:!!vw.right,front:!!vw.front,back:!!vw.back}:wheelCorner(mo.name);
    wheels.push(Object.assign({dev:mo.name, stmt:expr}, at));
  }
  if(wheels.length<2) return null;
  const hasSide=wheels.some(w=>w.left)&&wheels.some(w=>w.right);
  return {wheels, style: wheels.length>=4?"mecanum":"tank", ok:hasSide};
}
