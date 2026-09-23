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
   hardware-config name count — `motor` says nothing, "Arm" does. Assignment
   is best match first across every device, so an early device can't take a
   later one's obvious match. The old drive-word synonyms (left, front, motor)
   matched any mechanism with Left in its name, which is how a mecanum motor
   ended up driving a linear slide. */
function autoMap(devices,mechs){
  const map={}; const used={};
  const one=(d,mech)=>{
    const s=(mech.id||"").toLowerCase();
    if(!s||!d) return 0;
    if(d===s) return 100;
    if(d.length>=3&&(s.indexOf(d)>=0||d.indexOf(s)>=0)) return 70;
    for(const key in SYNONYM){
      const g=SYNONYM[key];
      if(g.some(w=>d.indexOf(w)>=0)&&g.some(w=>s.indexOf(w)>=0)) return 55;
    }
    if(mech.kind==="effector"&&SYNONYM.grip.some(w=>d.indexOf(w)>=0)) return 45;
    if(mech.kind==="revolute-lift"&&SYNONYM.lift.some(w=>d.indexOf(w)>=0)) return 45;
    if(mech.kind==="revolute-yaw"&&SYNONYM.yaw.some(w=>d.indexOf(w)>=0)) return 45;
    return 0;
  };
  const score=(dev,mech)=>Math.max(one(dev.name.toLowerCase(),mech), one(String(dev.cfg||"").toLowerCase(),mech));
  const pairs=[];
  for(const dev of devices){
    map[dev.name]=null;
    if(MAP_NOT_ACTUATOR.test(dev.type||"")||isDriveDevice(dev)) continue;
    for(const mech of mechs){ const v=score(dev,mech); if(v>=45) pairs.push({dev:dev.name, mech:mech.id, v}); }
  }
  pairs.sort((a,b)=>b.v-a.v);
  for(const p of pairs) if(map[p.dev]===null&&!used[p.mech]){ map[p.dev]=p.mech; used[p.mech]=1; }
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
