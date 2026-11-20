/* ============================================================
   0.  HARDWARE DATABASE
   Every figure is the vendor's own, read off its product page on
   2026-11-19: `source` is that page and `ratedV` the voltage the vendor
   quotes the figures at. Everything here is overridable in the UI, and
   `guess:true` marks anything inferred rather than known.
   Fields: stallNm (N.m at the output), rpm (free speed at the output),
   ratio, tpr (encoder counts per output turn), sec60 (a servo's seconds
   per 60 degrees, no load), travelDeg, stallA / freeA (stall and
   free-running current in amps at ratedV). Motors are quoted at 12 V;
   servos at 6 V, the one column every servo vendor here publishes (on a
   hub's 5 V servo port a servo has about 5/6 of that torque and speed;
   goBILDA's own 4.8 V column is kept as at4v8).
   tests/hardware-vendor.test.mjs holds every part to the vendor's table.
   ============================================================ */
const G = 9.80665;
const KGCM = 0.0980665;   // N.m in one kg.cm, the unit goBILDA and REV quote servo and gearmotor torque in

const GB_SERVO = "https://www.gobilda.com/2000-series-";
const HW_PARTS = {
  // ---- goBILDA 2000 Series Dual Mode servos (25-tooth spline): 25-2 Torque, 25-3 Speed, 25-4 Super Speed.
  //      goBILDA makes no 25-1 or 25-5 in this line. 2.5 A stall at 6 V (2.0 A at 4.8 V) on all three.
  "2000-0025-0002":{fam:"goBILDA 2000 Dual Mode 25-2 Torque",kind:"servo",role:"Torque",stallNm:21.6*KGCM,sec60:0.20,travelDeg:300,
    stallA:2.5,freeA:0.16,ratedV:6,at4v8:{stallNm:17.2*KGCM,sec60:0.25},source:GB_SERVO+"dual-mode-servo-25-2-torque/"},
  "2000-0025-0003":{fam:"goBILDA 2000 Dual Mode 25-3 Speed",kind:"servo",role:"Speed",stallNm:9.3*KGCM,sec60:0.09,travelDeg:300,
    stallA:2.5,freeA:0.20,ratedV:6,at4v8:{stallNm:7.9*KGCM,sec60:0.11},source:GB_SERVO+"dual-mode-servo-25-3-speed/"},
  "2000-0025-0004":{fam:"goBILDA 2000 Dual Mode 25-4 Super Speed",kind:"servo",role:"Speed",stallNm:4.7*KGCM,sec60:0.043,travelDeg:300,
    stallA:2.5,freeA:0.20,ratedV:6,at4v8:{stallNm:4.0*KGCM,sec60:0.055},source:GB_SERVO+"dual-mode-servo-25-4-super-speed/"},
  // the 5-turn versions: the same motors and gears, 1800 degrees of travel
  "2000-0025-0502":{fam:"goBILDA 2000 5-Turn Dual Mode 25-2 Torque",kind:"servo",role:"Torque",stallNm:21.6*KGCM,sec60:0.20,travelDeg:1800,
    ratedV:6,at4v8:{stallNm:17.2*KGCM,sec60:0.25},source:GB_SERVO+"5-turn-dual-mode-servo-25-2-torque/"},
  "2000-0025-0503":{fam:"goBILDA 2000 5-Turn Dual Mode 25-3 Speed",kind:"servo",role:"Speed",stallNm:9.3*KGCM,sec60:0.09,travelDeg:1800,
    stallA:2.5,freeA:0.20,ratedV:6,at4v8:{stallNm:7.9*KGCM,sec60:0.11},source:GB_SERVO+"5-turn-dual-mode-servo-25-3-speed/"},
  "2000-0025-0504":{fam:"goBILDA 2000 5-Turn Dual Mode 25-4 Super Speed",kind:"servo",role:"Speed",stallNm:4.7*KGCM,sec60:0.043,travelDeg:1800,
    stallA:2.5,freeA:0.20,ratedV:6,at4v8:{stallNm:4.0*KGCM,sec60:0.055},source:GB_SERVO+"5-turn-dual-mode-servo-25-4-super-speed/"},
  // ---- REV ----
  // Smart Robot Servo: REV quotes it at 6 V only (13.5 kg.cm, 0.13 s/60, 2 A stall); no free current is published
  "REV-41-1097":{fam:"REV Smart Robot Servo",kind:"servo",role:"Torque",stallNm:13.5*KGCM,sec60:0.13,travelDeg:270,
    stallA:2.0,ratedV:6,source:"https://docs.revrobotics.com/rev-crossover-products/servo/srs"},
  "REV-41-1291":{fam:"REV HD Hex Motor",kind:"motor",role:"Motor",stallNm:0.105,rpm:6000,ratio:1,tpr:28,
    stallA:8.5,freeA:0.4,ratedV:12,source:"https://docs.revrobotics.com/duo-build/actuators/motors/hd-hex-motor"},
  // the Core Hex's encoder counts 4 a motor turn, not 28: 288 at the output. REV publishes its stall
  // current (4.4 A) but no free current: freeA is the 0.2 A an FTC motor table gives, not REV's figure.
  "REV-41-1300":{fam:"REV Core Hex Motor",kind:"motor",role:"Motor",stallNm:3.20,rpm:125,ratio:72,tpr:288,
    stallA:4.4,freeA:0.2,freeAFrom:"estimate (REV publishes none)",ratedV:12,source:"https://docs.revrobotics.com/duo-build/actuators/motors/core-hex-motor"}
};

/* goBILDA Yellow Jacket planetary gearmotors: the trailing group of the part
   number is the nominal reduction, which fixes both speed and stall torque.
   tpr is the encoder count per OUTPUT turn as goBILDA publishes it: 28 on
   the motor times the exact planetary ratio, which the nominal one rounds
   (19.2:1 is 537.7, not 537.6; 188:1 is 5281.1, not 5264). kgcm is the
   page's stall torque; every ratio is the same motor, 9.2 A stall and
   0.25 A free at 12 V (YJ_ELEC). The 5202 and 5204 series carry the same
   motor and gearbox stages. `page` is the 5203 product page's slug. */
const YJ_ELEC = {stallA:9.2, freeA:0.25, ratedV:12};
const YJ_PAGE = "https://www.gobilda.com/5203-series-yellow-jacket-";
const YELLOW_JACKET = {
  1:{ratio:1,rpm:6000,kgcm:1.47,tpr:28, page:"motor-1-1-ratio-24mm-length-8mm-rex-shaft-6000-rpm-3-3-5v-encoder/"},
  3:{ratio:3.7,rpm:1620,kgcm:5.4,tpr:103.8, page:"planetary-gear-motor-3-7-1-ratio-1620-rpm-3-3-5v-encoder/"},
  5:{ratio:5.2,rpm:1150,kgcm:7.9,tpr:145.1, page:"planetary-gear-motor-5-2-1-ratio-24mm-length-8mm-rex-shaft-1150-rpm-3-3-5v-encoder/"},
  14:{ratio:13.7,rpm:435,kgcm:18.7,tpr:384.5, page:"planetary-gear-motor-13-7-1-ratio-24mm-length-8mm-rex-shaft-435-rpm-3-3-5v-encoder/"},
  19:{ratio:19.2,rpm:312,kgcm:24.3,tpr:537.7, page:"planetary-gear-motor-19-2-1-ratio-24mm-length-8mm-rex-shaft-312-rpm-3-3-5v-encoder/"},
  27:{ratio:26.9,rpm:223,kgcm:38.0,tpr:751.8, page:"planetary-gear-motor-26-9-1-ratio-24mm-length-8mm-rex-shaft-223-rpm-3-3-5v-encoder/"},
  51:{ratio:50.9,rpm:117,kgcm:68.4,tpr:1425.1, page:"planetary-gear-motor-50-9-1-ratio-24mm-length-8mm-rex-shaft-117-rpm-3-3-5v-encoder/"},
  71:{ratio:71.2,rpm:84,kgcm:93.6,tpr:1993.6, page:"planetary-gear-motor-71-2-1-ratio-24mm-length-8mm-rex-shaft-84-rpm-3-3-5v-encoder/"},
  100:{ratio:99.5,rpm:60,kgcm:133.2,tpr:2786.2, page:"planetary-gear-motor-99-5-1-ratio-24mm-length-8mm-rex-shaft-60-rpm-3-3-5v-encoder/"},
  139:{ratio:139,rpm:43,kgcm:185,tpr:3895.9, page:"planetary-gear-motor-139-1-ratio-24mm-length-8mm-rex-shaft-43-rpm-3-3-5v-encoder/"},
  188:{ratio:188,rpm:30,kgcm:250,tpr:5281.1, page:"planetary-gear-motor-188-1-ratio-24mm-length-8mm-rex-shaft-30-rpm-3-3-5v-encoder/"}
};
// the nominal ratio rounded (13, 26, 50) reads as the same part as goBILDA's own code (0014, 0027, 0051)
YELLOW_JACKET[13]=YELLOW_JACKET[14]; YELLOW_JACKET[26]=YELLOW_JACKET[27]; YELLOW_JACKET[50]=YELLOW_JACKET[51];

/* The motor spec of one Yellow Jacket row. */
function yjSpec(yj){
  return Object.assign({kind:"motor", role:"Motor", stallNm:yj.kgcm*KGCM, rpm:yj.rpm, ratio:yj.ratio, tpr:yj.tpr},
    YJ_ELEC, {source:YJ_PAGE+yj.page});
}

const GENERIC = {
  // the generic servos are the goBILDA part of that role, at 6 V
  Torque:Object.assign({}, HW_PARTS["2000-0025-0002"], {fam:"generic torque servo", guess:true}),
  Speed: Object.assign({}, HW_PARTS["2000-0025-0003"], {fam:"generic speed servo", guess:true}),
  Servo: Object.assign({}, HW_PARTS["2000-0025-0002"], {fam:"unspecified servo", role:"Servo", guess:true}),
  // the unspecified motor is the 312 rpm Yellow Jacket
  Motor: Object.assign(yjSpec(YELLOW_JACKET[19]), {fam:"unspecified motor", guess:true}),
  // a continuous servo: the goBILDA 25-3 Speed in continuous mode (115 rpm at 6 V)
  CRServo:{fam:"continuous servo",   kind:"crservo",role:"CR",  stallNm:9.3*KGCM,rpm:115,stallA:2.5,freeA:0.20,ratedV:6,
    source:GB_SERVO+"dual-mode-servo-25-3-speed/",guess:true},
  DistanceSensor:{fam:"distance sensor",kind:"sensor",role:"DistanceSensor",guess:true},
  TouchSensor:{fam:"touch sensor",kind:"sensor",role:"TouchSensor",guess:true},
  ColorSensor:{fam:"color sensor",kind:"sensor",role:"ColorSensor",guess:true}
};

/* "// 6000 rpm goBILDA" above a motor: the person who built it said which one.
   A speed that is no Yellow Jacket is the same 5203 motor through some other
   box: its power stays the 312 rpm one's, so torque goes as 1/speed. */
function motorFromComment(text){
  const m=/(\d{2,4})\s*rpm/i.exec(text||""); if(!m) return null;
  const rpm=+m[1];
  for(const k in YELLOW_JACKET){ const yj=YELLOW_JACKET[k];
    if(yj.rpm===rpm) return Object.assign({src:"code", fam:"goBILDA Yellow Jacket "+yj.ratio+":1"}, yjSpec(yj)); }
  const g=GENERIC.Motor;
  return Object.assign({}, g, {src:"code", fam:rpm+" rpm motor", rpm, ratio:6000/rpm, tpr:28*6000/rpm,
    stallNm:g.stallNm*g.rpm/rpm, guess:false});
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
    if(yj) return Object.assign({part:pn, fam:"goBILDA Yellow Jacket "+m[1]+"  "+yj.ratio+":1"}, yjSpec(yj));
    // a ratio this table does not know: the motor's electrical figures are still the 5203's
    return Object.assign({part:pn, fam:"goBILDA Yellow Jacket "+m[1], kind:"motor", role:"Motor",
            stallNm:GENERIC.Motor.stallNm, rpm:GENERIC.Motor.rpm, ratio:null, tpr:GENERIC.Motor.tpr}, YJ_ELEC, {guess:true});
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
