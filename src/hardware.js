/* ============================================================
   0.  HARDWARE DATABASE
   Published ballpark figures. Everything here is overridable in
   the UI, and `guess:true` marks anything inferred rather than known.
   ============================================================ */
const G = 9.80665;

const HW_PARTS = {
  // ---- goBILDA 2000 Series Dual Mode servos (25-tooth spline) ----
  "2000-0025-0001":{fam:"goBILDA 2000 Dual Mode 25-1",kind:"servo",role:"Speed", stallNm:0.95,sec60:0.12,travelDeg:300},
  "2000-0025-0002":{fam:"goBILDA 2000 Dual Mode 25-2",kind:"servo",role:"Speed", stallNm:1.40,sec60:0.16,travelDeg:300},
  "2000-0025-0003":{fam:"goBILDA 2000 Dual Mode 25-3",kind:"servo",role:"Torque",stallNm:2.10,sec60:0.24,travelDeg:300},
  "2000-0025-0004":{fam:"goBILDA 2000 Dual Mode 25-4",kind:"servo",role:"Torque",stallNm:3.00,sec60:0.32,travelDeg:300},
  "2000-0025-0005":{fam:"goBILDA 2000 Dual Mode 25-5",kind:"servo",role:"Torque",stallNm:4.20,sec60:0.42,travelDeg:300},
  // ---- REV ----
  "REV-41-1097":{fam:"REV Smart Robot Servo",kind:"servo",role:"Torque",stallNm:1.86,sec60:0.28,travelDeg:270},
  "REV-41-1291":{fam:"REV HD Hex Motor",kind:"motor",role:"Motor",stallNm:0.105,rpm:6000,ratio:1,tpr:28},
  // the Core Hex's encoder counts 4 a motor turn, not 28: 288 at the output
  "REV-41-1300":{fam:"REV Core Hex Motor",kind:"motor",role:"Motor",stallNm:3.20,rpm:125,ratio:72,tpr:288}
};

/* goBILDA Yellow Jacket planetary gearmotors: the trailing group of the part
   number is the nominal reduction, which fixes both speed and stall torque.
   tpr is the encoder count per OUTPUT turn as goBILDA publishes it: 28 on
   the motor times the exact planetary ratio, which the nominal one rounds
   (19.2:1 is 537.7, not 537.6; 188:1 is 5281.1, not 5264). */
const YELLOW_JACKET = {
  1:{ratio:1,rpm:6000,nm:0.14,tpr:28},
  3:{ratio:3.7,rpm:1620,nm:0.46,tpr:103.8},   5:{ratio:5.2,rpm:1150,nm:0.65,tpr:145.1},
  13:{ratio:13.7,rpm:435,nm:1.68,tpr:384.5},  14:{ratio:13.7,rpm:435,nm:1.68,tpr:384.5},   // 5203-2402-0014 is the 13.7:1
  19:{ratio:19.2,rpm:312,nm:2.38,tpr:537.7},
  26:{ratio:26.9,rpm:223,nm:3.34,tpr:751.8},  27:{ratio:26.9,rpm:223,nm:3.34,tpr:751.8},
  50:{ratio:50.9,rpm:117,nm:6.08,tpr:1425.1}, 51:{ratio:50.9,rpm:117,nm:6.08,tpr:1425.1},
  71:{ratio:71.2,rpm:84,nm:8.53,tpr:1993.6},  100:{ratio:99.5,rpm:60,nm:11.57,tpr:2786.2},
  139:{ratio:139.0,rpm:43,nm:16.08,tpr:3895.9},188:{ratio:188.0,rpm:30,nm:21.77,tpr:5281.1},
  223:{ratio:223.0,rpm:27,nm:24.60}
};

const GENERIC = {
  Torque:{fam:"generic torque servo",kind:"servo",role:"Torque",stallNm:2.10,sec60:0.24,travelDeg:300,guess:true},
  Speed: {fam:"generic speed servo", kind:"servo",role:"Speed", stallNm:1.40,sec60:0.16,travelDeg:300,guess:true},
  Servo: {fam:"unspecified servo",   kind:"servo",role:"Servo", stallNm:1.50,sec60:0.18,travelDeg:300,guess:true},
  Motor: {fam:"unspecified motor",   kind:"motor",role:"Motor", stallNm:2.38,rpm:312,ratio:19.2,tpr:537.7,guess:true},
  CRServo:{fam:"continuous servo",   kind:"crservo",role:"CR",  stallNm:1.40,rpm:100,guess:true},
  DistanceSensor:{fam:"distance sensor",kind:"sensor",role:"DistanceSensor",guess:true},
  TouchSensor:{fam:"touch sensor",kind:"sensor",role:"TouchSensor",guess:true},
  ColorSensor:{fam:"color sensor",kind:"sensor",role:"ColorSensor",guess:true}
};

/* "// 6000 rpm goBILDA" above a motor: the person who built it said which one. */
function motorFromComment(text){
  const m=/(\d{2,4})\s*rpm/i.exec(text||""); if(!m) return null;
  const rpm=+m[1];
  for(const k in YELLOW_JACKET){ const yj=YELLOW_JACKET[k];
    if(yj.rpm===rpm) return {src:"code", fam:"goBILDA Yellow Jacket "+yj.ratio+":1", kind:"motor", role:"Motor", stallNm:yj.nm, rpm:yj.rpm, ratio:yj.ratio, tpr:yj.tpr}; }
  return Object.assign({}, GENERIC.Motor, {src:"code", fam:rpm+" rpm motor", rpm, ratio:6000/rpm, tpr:28*6000/rpm, guess:false});
}

/* Encoder counts per OUTPUT revolution, what getCurrentPosition() counts
   through one turn of the shaft: the part's published figure when it has
   one, else 28 counts on the motor through its gearbox (right for a REV HD
   Hex: 1120 at 40:1, 560 at 20:1), else the unspecified motor's. */
function ticksPerRev(spec){
  const t=spec?+spec.tpr:0; if(t>0) return t;
  const r=spec?+spec.ratio:0; if(r>0) return 28*r;
  return GENERIC.Motor.tpr;
}

/* Identify an actuator from a part number and/or the CAD part name. */
function hwFromPart(pn, name){
  name = name || "";
  if(pn && HW_PARTS[pn]) return Object.assign({part:pn}, HW_PARTS[pn]);
  let m;
  if(pn && (m=/^(520[234])-\d{4}-(\d{1,4})$/.exec(pn))){
    const yj = YELLOW_JACKET[+m[2]];
    if(yj) return {part:pn, fam:"goBILDA Yellow Jacket "+m[1]+"  "+yj.ratio+":1",
                   kind:"motor", role:"Motor", stallNm:yj.nm, rpm:yj.rpm, ratio:yj.ratio, tpr:yj.tpr};
    return {part:pn, fam:"goBILDA Yellow Jacket "+m[1], kind:"motor", role:"Motor",
            stallNm:GENERIC.Motor.stallNm, rpm:GENERIC.Motor.rpm, ratio:null, tpr:GENERIC.Motor.tpr, guess:true};
  }
  /* Name-only matching has to be strict: a real assembly is full of parts
     called "Motor Sleeve", "Servo Case" and "Motor Port" that are pieces of an
     actuator model, not actuators. */
  if(/\b(case|spline|frame|port|horn|mount|sleeve|cover|shaft|gearbox|bracket|clip|screw|nut|washer|bearing|axle|shim|core|label|wire|seal|plate|hub|standoff|beam|channel|wheel|spacer|pin|band|gear|pulley|tube|rod|part)\b/i.test(name)) return null;
  if(/\bservos?\b/i.test(name)) return Object.assign({part:pn||null, fam:name.trim()}, GENERIC.Servo);
  if(/\b(motor|gearmotor)s?\b/i.test(name)) return Object.assign({part:pn||null, fam:name.trim()}, GENERIC.Motor);
  return null;
}

/* The spec actually used for a device. Precedence is a user setting: with
   "code" the declared java type and the comment above it win, because the
   person who wired the robot knows what they installed and the CAD may be
   older than the build. */
function specFor(dev, mech, trust){
  const base = specDetect(dev, mech, trust);
  const ov = (typeof HW_USER!=="undefined" && HW_USER) ? HW_USER[dev.name] : null;
  if(!ov) return base;
  const out=Object.assign({},base);
  for(const k in ov) if(ov[k]!==undefined && ov[k]!==null) out[k]=ov[k];
  // a ratio set by hand outdates the part's published count
  if(ov.ratio!=null && ov.tpr==null) delete out.tpr;
  out.src = "you";
  if(ov.kind==="motor"&&!ov.rpm&&!base.rpm) out.rpm=GENERIC.Motor.rpm;
  return out;
}
function specDetect(dev, mech, trust){
  const cadSpec = mech && mech.part ? hwFromPart(mech.part, mech.partName) : null;
  const wantsMotor = /DcMotor|DcMotorEx/i.test(dev.type||"");
  const wantsCR = /CRServo/i.test(dev.type||"");
  const wantsDist = /DistanceSensor/i.test(dev.type||"");
  const wantsTouch = /TouchSensor/i.test(dev.type||"");
  const wantsColor = /ColorSensor/i.test(dev.type||"");

  // a declared sensor is a sensor whatever the CAD part it landed on says
  if(wantsDist) return Object.assign({src:"code"}, GENERIC.DistanceSensor);
  if(wantsTouch) return Object.assign({src:"code"}, GENERIC.TouchSensor);
  if(wantsColor) return Object.assign({src:"code"}, GENERIC.ColorSensor);

  if(trust === "cad" && cadSpec) return Object.assign({src:"CAD"}, cadSpec);

  // --- code wins ---

  if(wantsMotor){
    const said=motorFromComment(dev.intent);
    if(said) return said;
    if(cadSpec && cadSpec.kind === "motor") return Object.assign({src:"CAD part, code type"}, cadSpec);
    return Object.assign({src:"code"}, GENERIC.Motor);
  }
  if(wantsCR) return Object.assign({src:"code"}, GENERIC.CRServo);
  if(dev.declaredRole){
    // prefer a real part from the same family that matches the declared role
    if(cadSpec && cadSpec.kind === "servo"){
      if(cadSpec.role === dev.declaredRole) return Object.assign({src:"code + CAD"}, cadSpec);
      // same family, the declared role: pick the variant nearest the typical
      // figure for that role rather than whichever happens to be listed first
      const fam = (cadSpec.part||"").slice(0,10);
      const want = (GENERIC[dev.declaredRole]||GENERIC.Servo).stallNm;
      let bestP=null, bestD=1e9;
      for(const p in HW_PARTS){
        const c = HW_PARTS[p];
        if(p.slice(0,10)!==fam || c.role!==dev.declaredRole) continue;
        const d=Math.abs(c.stallNm-want);
        if(d<bestD){ bestD=d; bestP=p; }
      }
      if(bestP) return Object.assign({src:"code", part:bestP}, HW_PARTS[bestP]);
    }
    return Object.assign({src:"code"}, GENERIC[dev.declaredRole] || GENERIC.Servo);
  }
  if(cadSpec) return Object.assign({src:"CAD"}, cadSpec);
  return Object.assign({src:"default"}, GENERIC.Servo);
}

/* Encoder counts per output revolution, by its older name: ticksPerRev above is the one place a count comes from */
function motorTpr(spec){ return ticksPerRev(spec&&(spec.tpr>0||spec.ratio>0)?spec:{ratio:19.2}); }   // the same count (ticksPerRev); a spec with neither is a 19.2:1
