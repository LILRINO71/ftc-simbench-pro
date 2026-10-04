/* ============================================================
   5.  MAPPING
   ============================================================ */
const SYNONYM={ lift:["arm","lift","shoulder","elbow","slide","extend","pivot"],
                grip:["claw","grip","gripper","hand","intake","clamp","wrist"],
                yaw: ["rotate","base","turret","yaw","swivel","spin"] };
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
   mecanum motor ended up driving a linear slide; those words never count. */
const MAP_GROUPS=[
  ["lift","slide","slides","elevator","viper","linear","vertical","vslide","outtake","deposit","uppies","climb","ascent","cascade","rail"],
  ["extend","extendo","extension","horizontal","hslide","reach","telescope"],
  ["arm","pivot","shoulder","elbow","swing","fourbar","bar","boom","link","linkage"],
  ["wrist","rotate","rotation","rot","twist","roll","pitch","flip","tilt","diffy","differential"],
  ["claw","grip","gripper","grabber","pinch","hand","clamp","finger","jaw"],
  ["intake","roller","spinner","sweeper","brush","collector","suck"],
  ["turret","yaw","swivel","spin","base"],
  ["shooter","flywheel","launcher","shoot","launch","catapult","kicker"],
  ["hang","hook","winch","climber","hanger"],
];
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
function autoMap(devices,mechs,opts){
  const map={}, used={};
  // hardware that just spins (src/mates.js passive) is never a device's joint, unless its
  // mate carries the device's own name (the team said so)
  const exactly=(d,m)=>{ const e=s=>String(s||"").toLowerCase().replace(/^dof_/,"").replace(/_inv$/,"").replace(/[^a-z0-9]/g,""); const id=e(m.id), al=e(m.alias);
    return [d.name,d.cfg,d.alias].some(n=>n&&e(n).length>=2&&(e(n)===id||(al&&e(n)===al))); };
  mechs=(mechs||[]).filter(m=>!m.passive||(devices||[]).some(d=>exactly(d,m)));
  // with a handful of joints, a device can take the one of its kind; among dozens
  // (an Onshape export of a whole robot) only a name can say
  const few=mechs.filter(m=>!m.couple).length<=8;
  const solidsOf=opts&&opts.cad&&opts.cad.solids||[];
  const mechText=new Map();
  for(const m of mechs){
    const parts=solidsOf.filter(s=>s.mech===m.id).map(s=>s.name).slice(0,8);
    mechText.set(m.id,{id:String(m.id||"").toLowerCase(), alias:String(m.alias||"").toLowerCase(), words:[...new Set(mapWords(m.id).concat(mapWords(m.alias),mapWords(m.partName),...parts.map(mapWords)))],
      raw:mapRaw(m.id).concat(mapRaw(m.alias))});
  }
  // a mate named exactly as the device's configuration name is the team saying so:
  // case, spaces, underscores and onshape-to-robot's dof_/_inv don't count
  const exact=s=>String(s||"").toLowerCase().replace(/^dof_/,"").replace(/_inv$/,"").replace(/[^a-z0-9]/g,"");
  const one=(name,mech)=>{
    const T=mechText.get(mech.id), s=T.id, d=String(name||"").toLowerCase();
    if(!s||!d) return 0;
    if(d===s||(T.alias&&d===T.alias)) return 100;
    const de=exact(d); if(de.length>=2&&(de===exact(s)||(T.alias&&de===exact(T.alias)))) return 100;
    const dw=mapWords(name), clash=mapClash(mapRaw(name),T.raw)?50:0;
    // a meaningful word in both: "liftMotor" and the mate "Lift Stage"
    if(dw.some(w=>w.length>=3&&T.words.indexOf(w)>=0)) return 80-clash;
    // a short form: "in" for intake, "ext" for extension
    if(!clash&&mapRaw(name).some(w=>w.length>=2&&w.length<=3&&!MAP_NOISE.has(w)&&T.words.some(x=>x.length>=5&&x.startsWith(w)))) return 60;
    if(clash) return 0;
    // one name inside the other, as a whole word: "lift" in "Lift Stage", never "pin" in "spinner"
    const dc=d.replace(/[^a-z0-9]/g,""), sc=s.replace(/[^a-z0-9]/g,"");
    if(dc.length>=4&&sc.length>=4&&(T.words.indexOf(dc)>=0||mapWords(name).indexOf(sc)>=0)) return 70;
    // the same kind of mechanism by another name: viper -> slide, grabber -> claw
    const dg=new Set(dw.map(mapGroupOf).filter(g=>g>=0));
    if(T.words.some(w=>dg.has(mapGroupOf(w)))) return 55;
    if(!few) return 0;
    const k=normJointKind(mech.kind);
    if(mech.kind==="effector"&&dg.has(4)) return 45;
    if(k==="linear"&&(dg.has(0)||dg.has(1))) return 45;
    if(mech.kind==="revolute-lift"&&(dg.has(2)||dg.has(0))) return 45;
    if(mech.kind==="revolute-yaw"&&(dg.has(6)||dg.has(3))) return 45;
    return 0;
  };
  // a servo turns things; a slide is pulled by a motor (or a continuous servo)
  const fitKind=(dev,mech)=>{ const sv=/servo/i.test(dev.type||"")&&!/crservo/i.test(dev.type||""), lin=normJointKind(mech.kind)==="linear";
    return sv&&lin?0.8:1; };
  const score=(dev,mech)=>Math.max(one(dev.name,mech), one(dev.cfg,mech), dev.alias?one(dev.alias,mech):0)*fitKind(dev,mech);
  const pairs=[];
  const acts=[];
  for(const dev of devices){
    map[dev.name]=null;
    if(MAP_NOT_ACTUATOR.test(dev.type||"")||isDriveDevice(dev)) continue;
    acts.push(dev);
    // a joint tied to another by a gear, rack or cascade is driven through that one
    for(const mech of mechs){ if(mech.couple) continue; const v=score(dev,mech); if(v>=45) pairs.push({dev:dev.name, mech:mech.id, v}); }
  }
  pairs.sort((a,b)=>b.v-a.v);
  for(const p of pairs) if(map[p.dev]===null&&!used[p.mech]){ map[p.dev]=p.mech; used[p.mech]=p.dev; }
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
  return map;
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
/* Drive motors: those whose power comes straight off a stick. */
function detectDrivetrain(code){
  // on the VM the drive is what the motors did when the sticks moved (src/jvmrun.js)
  if(code&&code.vm) return code.vm.an.drive?Object.assign({},code.vm.an.drive,{wheels:code.vm.an.drive.wheels.map(w=>Object.assign({},w))}):null;
  const motors=code.devices.filter(d=>/DcMotor/i.test(d.type||""));
  if(motors.length<2) return null;
  const analog={};
  for(const b of (code.bindings||[])) if(b.analog) analog[b.dev]=1;
  const isAuto = !code.hasLoop && code.auto && code.auto.length>0;
  const wheels=[];
  for(const mo of motors){
    if(isAuto){
      // no sticks in an autonomous: go by name, but a "leftLift" is not a wheel
      const c=wheelCorner(mo.name);
      if(!(c.left||c.right)) continue;
      if(!(c.front||c.back||/drive|wheel|motor/i.test(mo.name))) continue;
    } else if(!analog[mo.name]) continue;   // PID-driven arms are not part of the drive base
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
