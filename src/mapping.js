/* ============================================================
   5.  MAPPING
   ============================================================ */
const SYNONYM={ lift:["arm","lift","shoulder","elbow","slide","extend","pivot"],
                grip:["claw","grip","gripper","hand","intake","clamp","wrist"],
                yaw: ["rotate","base","turret","yaw","swivel","spin"],
                drive:["drive","left","right","front","back","rear","wheel","motor"] };
function autoMap(devices,mechs){
  const map={}; const used={};
  const score=(dev,mech)=>{
    const d=dev.name.toLowerCase(), s=(mech.id||"").toLowerCase();
    if(!s) return 0;
    if(d===s) return 100;
    if(s.indexOf(d)>=0||d.indexOf(s)>=0) return 70;
    for(const key in SYNONYM){
      const g=SYNONYM[key];
      if(g.some(w=>d.indexOf(w)>=0)&&g.some(w=>s.indexOf(w)>=0)) return 55;
    }
    if(mech.kind==="effector"&&SYNONYM.grip.some(w=>d.indexOf(w)>=0)) return 45;
    if(mech.kind==="revolute-lift"&&SYNONYM.lift.some(w=>d.indexOf(w)>=0)) return 45;
    if(mech.kind==="revolute-yaw"&&SYNONYM.yaw.some(w=>d.indexOf(w)>=0)) return 45;
    return 0;
  };
  for(const dev of devices){
    let best=null,bv=0;
    for(const mech of mechs){ if(used[mech.id]) continue;
      const v=score(dev,mech); if(v>bv){bv=v;best=mech;} }
    if(best&&bv>=45){ map[dev.name]=best.id; used[best.id]=1; } else map[dev.name]=null;
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
    wheels.push(Object.assign({dev:mo.name, stmt:expr}, wheelCorner(mo.name)));
  }
  if(wheels.length<2) return null;
  const hasSide=wheels.some(w=>w.left)&&wheels.some(w=>w.right);
  return {wheels, style: wheels.length>=4?"mecanum":"tank", ok:hasSide};
}
