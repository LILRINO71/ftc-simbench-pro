/* ============================================================
   4b. THE FTC LIBRARY FOR THE JAVA VM (src/jvm.js)
   ------------------------------------------------------------
   What a team's code calls that isn't the team's own code:
   - the FTC SDK's hardware (motors, servos, IMUs, odometry, sensors),
     gamepads, telemetry and the OpMode lifecycle, in JS, wired to the
     sim through vm.host;
   - java.lang / java.util basics, in JS;
   - FTCLib, Road Runner 1.0 and 0.5 core types, Pedro Pathing's drive,
     the SDK's navigation types: written in Java below (JV_PRELUDE)
     and run by the VM like the team's code, so they behave like the
     real libraries, line for line where it matters.
   A library class nobody describes here runs as a stub (jvm.js).
   ============================================================ */
const JV_HW="com.qualcomm.robotcore.hardware.";
const JV_NAV="org.firstinspires.ftc.robotcore.external.navigation.";
function jvGen(r){ return r&&typeof r.next==="function"&&typeof r[Symbol.iterator]==="function"; }
function jvArg(v){ return v&&v[JV_OPAQUE_TAG]?0:jvNum(v); }
const jvClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/* an enum constant's name, whatever enum it is (a string works too) */
const jvEn=v=>v==null?null:(typeof v==="string"?v:(v.__en!==undefined?v.__en:null));

/* ---- java.util collections ---- */
function jvList(vm,items,fqn){ return {__c:vm.classes.get(fqn||"java.util.ArrayList"),f:Object.create(null),n:{items:items||[]}}; }
function jvMapObj(vm,fqn){ return {__c:vm.classes.get(fqn||"java.util.HashMap"),f:Object.create(null),n:{map:new Map()}}; }
function jvKey(k){ return typeof k==="number"||typeof k==="string"||typeof k==="boolean"?typeof k+":"+k:k; }
function jvIdx(items,v){ for(let k=0;k<items.length;k++) if(jvEq(items[k],v)||(jvIsObj(items[k])&&items[k]===v)) return k; return -1; }
const JV_LIST_M={
  add(vm,o,a){ if(a.length===2) o.n.items.splice(jvNum(a[0]),0,a[1]); else o.n.items.push(a[0]); return true; },
  addAll(vm,o,a){ const src=a[a.length-1]; const v=Array.isArray(src)?src:(src&&src.n&&src.n.items)||(src&&src.n&&src.n.map&&Array.from(src.n.map.keys()))||[]; if(a.length===2) o.n.items.splice(jvNum(a[0]),0,...v); else o.n.items.push(...v); return v.length>0; },
  get(vm,o,a){ const i=jvNum(a[0]); if(i<0||i>=o.n.items.length) throw vm.jthrow("IndexOutOfBoundsException","Index "+i+" out of bounds for length "+o.n.items.length); return o.n.items[i]; },
  set(vm,o,a){ const i=jvNum(a[0]); const old=o.n.items[i]; o.n.items[i]=a[1]; return old; },
  remove(vm,o,a){ const v=a[0];
    if(typeof v==="number"&&o.__c.name!=="HashSet"&&o.__c.name!=="LinkedHashSet"){ return o.n.items.splice(v,1)[0]; }
    const i=jvIdx(o.n.items,v); if(i>=0){ o.n.items.splice(i,1); return true; } return false; },
  size(vm,o){ return o.n.items.length; }, isEmpty(vm,o){ return !o.n.items.length; },
  contains(vm,o,a){ return jvIdx(o.n.items,a[0])>=0; }, indexOf(vm,o,a){ return jvIdx(o.n.items,a[0]); },
  lastIndexOf(vm,o,a){ for(let k=o.n.items.length-1;k>=0;k--) if(jvEq(o.n.items[k],a[0])||o.n.items[k]===a[0]) return k; return -1; },
  clear(vm,o){ o.n.items.length=0; },
  iterator(vm,o){ return {__c:vm.classes.get("java.util.Iterator"),f:Object.create(null),n:{items:o.n.items.slice(),i:0,src:o}}; },
  listIterator(vm,o){ return JV_LIST_M.iterator(vm,o); },
  *forEach(vm,o,a){ for(const v of o.n.items.slice()) yield* vm.callFn(a[0],[v]); },
  *removeIf(vm,o,a){ const keep=[]; let any=false; for(const v of o.n.items){ if(jvTruth(yield* vm.callFn(a[0],[v]))) any=true; else keep.push(v); } o.n.items.length=0; o.n.items.push(...keep); return any; },
  toArray(vm,o){ return o.n.items.slice(); },
  *sort(vm,o,a){ yield* jvSort(vm,o.n.items,a[0]); },
  subList(vm,o,a){ return jvList(vm,o.n.items.slice(jvNum(a[0]),jvNum(a[1]))); },
  getFirst(vm,o){ return o.n.items[0]; }, getLast(vm,o){ return o.n.items[o.n.items.length-1]; },
  addFirst(vm,o,a){ o.n.items.unshift(a[0]); }, addLast(vm,o,a){ o.n.items.push(a[0]); },
  offerFirst(vm,o,a){ o.n.items.unshift(a[0]); return true; }, offerLast(vm,o,a){ o.n.items.push(a[0]); return true; },
  removeFirst(vm,o){ return o.n.items.shift(); }, removeLast(vm,o){ return o.n.items.pop(); },
  pollFirst(vm,o){ return o.n.items.length?o.n.items.shift():null; }, pollLast(vm,o){ return o.n.items.length?o.n.items.pop():null; },
  peekFirst(vm,o){ return o.n.items.length?o.n.items[0]:null; }, peekLast(vm,o){ return o.n.items.length?o.n.items[o.n.items.length-1]:null; },
  // a Deque/Stack pushes on the front (ArrayDeque) or the end (Stack)
  push(vm,o,a){ if(o.__c.name==="Stack") o.n.items.push(a[0]); else o.n.items.unshift(a[0]); return a[0]; },
  pop(vm,o){ return o.__c.name==="Stack"?o.n.items.pop():o.n.items.shift(); },
  peek(vm,o){ if(!o.n.items.length) return null; return o.__c.name==="Stack"?o.n.items[o.n.items.length-1]:o.n.items[0]; },
  poll(vm,o){ return o.n.items.length?o.n.items.shift():null; }, offer(vm,o,a){ o.n.items.push(a[0]); return true; },
  element(vm,o){ return o.n.items[0]; }, empty(vm,o){ return !o.n.items.length; },
  stream(vm,o){ return jvList(vm,o.n.items.slice(),"java.util.stream.Stream"); },
  equals(vm,o,a){ return o===a[0]; }, hashCode(){ return 17; },
  toString(vm,o){ return "["+o.n.items.map(v=>typeof v==="number"?jvNumStr(v,Number.isInteger(v)):String(v&&v.__en||v)).join(", ")+"]"; },
};
const JV_SET_ADD=(vm,o,a)=>{ if(jvIdx(o.n.items,a[0])>=0) return false; o.n.items.push(a[0]); return true; };
function* jvSort(vm,items,cmp){
  const arr=items.slice(), key=[];
  // insertion sort: the comparator may be Java (a generator), so no Array.sort
  for(let i=1;i<arr.length;i++){ const v=arr[i]; let j=i-1;
    while(j>=0){ const c=cmp?jvNum(yield* vm.callFn(cmp,[arr[j],v],"compare")):(arr[j]>v?1:arr[j]<v?-1:0); if(c<=0) break; arr[j+1]=arr[j]; j--; }
    arr[j+1]=v; }
  void key;
  items.length=0; items.push(...arr);
}
const JV_STREAM_M={
  *map(vm,o,a){ const r=[]; for(const v of o.n.items) r.push(yield* vm.callFn(a[0],[v])); return jvList(vm,r,"java.util.stream.Stream"); },
  *filter(vm,o,a){ const r=[]; for(const v of o.n.items) if(jvTruth(yield* vm.callFn(a[0],[v]))) r.push(v); return jvList(vm,r,"java.util.stream.Stream"); },
  *forEach(vm,o,a){ for(const v of o.n.items) yield* vm.callFn(a[0],[v]); },
  *anyMatch(vm,o,a){ for(const v of o.n.items) if(jvTruth(yield* vm.callFn(a[0],[v]))) return true; return false; },
  *allMatch(vm,o,a){ for(const v of o.n.items) if(!jvTruth(yield* vm.callFn(a[0],[v]))) return false; return true; },
  *noneMatch(vm,o,a){ for(const v of o.n.items) if(jvTruth(yield* vm.callFn(a[0],[v]))) return false; return true; },
  count(vm,o){ return o.n.items.length; }, sum(vm,o){ return o.n.items.reduce((x,y)=>x+jvNum(y),0); },
  max(vm,o){ return jvOptional(vm,o.n.items.length?Math.max(...o.n.items.map(jvNum)):null); },
  min(vm,o){ return jvOptional(vm,o.n.items.length?Math.min(...o.n.items.map(jvNum)):null); },
  average(vm,o){ return jvOptional(vm,o.n.items.length?o.n.items.reduce((x,y)=>x+jvNum(y),0)/o.n.items.length:null); },
  toArray(vm,o){ return o.n.items.slice(); }, collect(vm,o){ return jvList(vm,o.n.items.slice()); }, toList(vm,o){ return jvList(vm,o.n.items.slice()); },
  findFirst(vm,o){ return jvOptional(vm,o.n.items.length?o.n.items[0]:null); }, findAny(vm,o){ return jvOptional(vm,o.n.items.length?o.n.items[0]:null); },
};
["mapToDouble","mapToInt","mapToObj","boxed"].forEach(k=>{ JV_STREAM_M[k]=k==="boxed"?(vm,o)=>o:JV_STREAM_M.map; });
function jvOptional(vm,v){ return {__c:vm.classes.get("java.util.Optional"),f:Object.create(null),n:{v}}; }
const JV_MAP_M={
  put(vm,o,a){ const k=jvKey(a[0]); const old=o.n.map.has(k)?o.n.map.get(k)[1]:null; o.n.map.set(k,[a[0],a[1]]); return old; },
  get(vm,o,a){ const e=o.n.map.get(jvKey(a[0])); return e?e[1]:null; },
  getOrDefault(vm,o,a){ const e=o.n.map.get(jvKey(a[0])); return e?e[1]:a[1]; },
  containsKey(vm,o,a){ return o.n.map.has(jvKey(a[0])); },
  containsValue(vm,o,a){ for(const [,e] of o.n.map) if(jvEq(e[1],a[0])||e[1]===a[0]) return true; return false; },
  remove(vm,o,a){ const k=jvKey(a[0]); const e=o.n.map.get(k); o.n.map.delete(k); return e?e[1]:null; },
  size(vm,o){ return o.n.map.size; }, isEmpty(vm,o){ return !o.n.map.size; }, clear(vm,o){ o.n.map.clear(); },
  keySet(vm,o){ return jvList(vm,Array.from(o.n.map.values()).map(e=>e[0]),"java.util.HashSet"); },
  values(vm,o){ return jvList(vm,Array.from(o.n.map.values()).map(e=>e[1])); },
  entrySet(vm,o){ return jvList(vm,Array.from(o.n.map.values()).map(e=>({__c:vm.classes.get("java.util.Map.Entry"),f:Object.create(null),n:{e,map:o}})),"java.util.HashSet"); },
  putIfAbsent(vm,o,a){ const k=jvKey(a[0]); if(o.n.map.has(k)&&o.n.map.get(k)[1]!=null) return o.n.map.get(k)[1]; o.n.map.set(k,[a[0],a[1]]); return null; },
  *computeIfAbsent(vm,o,a){ const k=jvKey(a[0]); if(o.n.map.has(k)&&o.n.map.get(k)[1]!=null) return o.n.map.get(k)[1]; const v=yield* vm.callFn(a[1],[a[0]]); if(v!=null) o.n.map.set(k,[a[0],v]); return v; },
  *merge(vm,o,a){ const k=jvKey(a[0]); const e=o.n.map.get(k); const v=e&&e[1]!=null?yield* vm.callFn(a[2],[e[1],a[1]]):a[1]; o.n.map.set(k,[a[0],v]); return v; },
  *forEach(vm,o,a){ for(const [,e] of Array.from(o.n.map)) yield* vm.callFn(a[0],[e[0],e[1]]); },
  putAll(vm,o,a){ if(a[0]&&a[0].n&&a[0].n.map) for(const [k,e] of a[0].n.map) o.n.map.set(k,e.slice()); },
  equals(vm,o,a){ return o===a[0]; }, hashCode(){ return 31; },
};

/* ---- the gamepad ---- */
const JV_PAD_FIELDS=["left_stick_x","left_stick_y","right_stick_x","right_stick_y","left_trigger","right_trigger","a","b","x","y","dpad_up","dpad_down","dpad_left","dpad_right",
  "left_bumper","right_bumper","back","start","guide","left_stick_button","right_stick_button","options","share","touchpad","ps","cross","circle","square","triangle",
  "touchpad_finger_1","touchpad_finger_2","touchpad_finger_1_x","touchpad_finger_1_y","id","user","timestamp"];
const JV_PAD_ALIAS={cross:"a",circle:"b",square:"x",triangle:"y",options:"start",share:"back",ps:"guide"};
const JV_PAD_AXES=/^(left|right)_(stick_[xy]|trigger)$/;
function jvPadRaw(vm,o,f){
  const k=JV_PAD_ALIAS[f]||f;
  let v;
  if(o.n.live) { const p=vm.host&&vm.host.pad(o.n.live)||{}; v=p[k]; if(v===undefined&&JV_PAD_ALIAS[f]===undefined){ for(const a in JV_PAD_ALIAS) if(JV_PAD_ALIAS[a]===k&&p[a]!==undefined) v=p[a]; } }
  else v=o.n.snap[k];
  if(JV_PAD_AXES.test(k)) return typeof v==="number"?v:(v?1:0);
  if(k==="id") return o.n.live||0;
  return !!v;
}
/* SDK 10.3+: aWasPressed(), leftBumperWasReleased(), dpadUpWasPressed()… */
function jvPadEdge(vm,o,name){
  const m=/^(\w+?)Was(Pressed|Released)$/.exec(name); if(!m) return undefined;
  const field=m[1].replace(/([A-Z])/g,"_$1").toLowerCase();
  const cur=jvPadRaw(vm,o,field);
  const pv=o.n.edge[name]; o.n.edge[name]=cur;
  const was=pv===undefined?false:pv;
  return m[2]==="Pressed"?(cur&&!was):(!cur&&was);
}

/* ---- telemetry ---- */
function jvTel(vm){ return vm.rt||(vm.rt={lines:[],log:[],auto:true}); }
function jvTelAdd(vm,line){ const t=jvTel(vm); t.lines.push(line); if(t.lines.length>200) t.lines.shift(); }
const JV_TEL_M={
  *addData(vm,o,a){
    const cap=yield* vm.str(a[0]);
    let val;
    if(a.length>2&&typeof a[1]==="string") val=jvFormat(a[1],a.slice(2));
    else if(a[1] instanceof JvFn) val=yield* vm.str(yield* vm.callFn(a[1],[]));
    else val=yield* vm.str(a[1],typeof a[1]==="number"&&Number.isInteger(a[1])?"i":null);
    jvTelAdd(vm,cap+" : "+val);
    return vm.mk("org.firstinspires.ftc.robotcore.external.Telemetry.Item",null,{tel:o});
  },
  *addLine(vm,o,a){ jvTelAdd(vm,a.length?yield* vm.str(a[0]):""); return vm.mk("org.firstinspires.ftc.robotcore.external.Telemetry.Line",null,{tel:o}); },
  update(vm){ const t=jvTel(vm); if(vm.host&&vm.host.telemetry) vm.host.telemetry(t.lines.slice()); t.shown=t.lines.slice(); if(t.auto) t.lines=[]; return true; },
  clear(vm){ jvTel(vm).lines=[]; }, clearAll(vm){ jvTel(vm).lines=[]; },
  setAutoClear(vm,o,a){ jvTel(vm).auto=!!a[0]; }, isAutoClear(vm){ return jvTel(vm).auto; },
  speak(){}, setMsTransmissionInterval(){}, getMsTransmissionInterval(){ return 250; }, setDisplayFormat(){}, setCaptionValueSeparator(){}, setItemSeparator(){},
  log(vm){ return vm.mk("org.firstinspires.ftc.robotcore.external.Telemetry.Log",null,{}); },
  addAction(){ return null; }, removeAction(){ return true; }, removeItem(){ return true; }, removeLine(){ return true; },
  setNumDecimalPlaces(){},
};

/* ---- hardware devices, wired to the sim through vm.host ---- */
/* the kind of device a hardwareMap.get(X.class, …) asks for, by X's simple name */
/* the SDK's own interface tree: DcMotor.Direction is DcMotorSimple.Direction,
   DcMotorEx.RunMode is DcMotor.RunMode (nested types come down through these) */
const JV_HW_EXTENDS={DcMotor:["DcMotorSimple"], DcMotorEx:["DcMotor"], CRServo:["DcMotorSimple"], ServoImplEx:["Servo","PwmControl"]};
const JV_DEV_KIND={DcMotor:"motor",DcMotorEx:"motor",DcMotorImplEx:"motor",DcMotorImpl:"motor",DcMotorSimple:"motor",DcMotorControllerEx:null,
  Servo:"servo",ServoImplEx:"servo",ServoImpl:"servo",ServoEx:"servo",CRServo:"crservo",CRServoImplEx:"crservo",CRServoImpl:"crservo",
  IMU:"imu",BHI260IMU:"imu",BNO055IMUNew:"imu",BNO055IMU:"bno",BNO055IMUImpl:"bno",AdafruitBNO055IMU:"bno",LynxEmbeddedIMU:"bno",NavxMicroNavigationSensor:"imu",
  GoBildaPinpointDriver:"pinpoint",GoBildaPinpointDriverRR:"pinpoint",SparkFunOTOS:"otos",
  DistanceSensor:"distance",Rev2mDistanceSensor:"distance",ColorSensor:"color",NormalizedColorSensor:"color",RevColorSensorV3:"color",ColorRangeSensor:"color",LynxI2cColorRangeSensor:"color",
  TouchSensor:"touch",RevTouchSensor:"touch",DigitalChannel:"digital",DigitalChannelImpl:"digital",AnalogInput:"analog",VoltageSensor:"voltage",LynxModule:"hub",
  Limelight3A:"limelight",WebcamName:"webcam",HuskyLens:"opaque",LED:"led",ServoController:"opaque",DcMotorController:"opaque"};
/* the type name the rest of the bench knows each kind by (java.js DEVT) */
const JV_KIND_TYPE={motor:"DcMotorEx",servo:"Servo",crservo:"CRServo",imu:"IMU",bno:"BNO055IMU",distance:"DistanceSensor",color:"ColorSensor",touch:"TouchSensor",
  digital:"DigitalChannel",analog:"AnalogInput",pinpoint:"GoBildaPinpointDriver",otos:"SparkFunOTOS",voltage:"VoltageSensor",hub:"LynxModule",limelight:"Limelight3A"};
const JV_KIND_CLASS={motor:JV_HW+"DcMotorImplEx",servo:JV_HW+"ServoImplEx",crservo:JV_HW+"CRServoImplEx",imu:"com.qualcomm.hardware.rev.RevIMU_",bno:"com.qualcomm.hardware.bosch.BNO055IMUImpl",
  distance:"com.qualcomm.hardware.rev.Rev2mDistanceSensor",color:"com.qualcomm.hardware.rev.RevColorSensorV3",touch:"com.qualcomm.hardware.rev.RevTouchSensor",
  digital:JV_HW+"DigitalChannelImpl",analog:JV_HW+"AnalogInput",voltage:JV_HW+"VoltageSensor_",hub:"com.qualcomm.hardware.lynx.LynxModule",
  pinpoint:"com.qualcomm.hardware.gobilda.GoBildaPinpointDriver",otos:"com.qualcomm.hardware.sparkfun.SparkFunOTOS",limelight:"com.qualcomm.hardware.limelightvision.Limelight3A",
  webcam:"org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName",led:JV_HW+"LED"};
/* hardwareMap.get(): one device object per config name, as on the robot */
function* jvGetDevice(vm,kindName,name,clsName){
  name=String(name);
  const rt=vm.dev||(vm.dev=new Map());
  const kind=JV_DEV_KIND[kindName]!==undefined?JV_DEV_KIND[kindName]:null;
  const key=name+"|"+(kind==="motor"||kind==="crservo"?"motor":kind);
  if(rt.has(key)){ const d=rt.get(key); vm.devUse(name,d.n.kind,clsName); return d; }
  if(!kind||kind==="opaque"){ vm.note("hardwareMap.get("+(clsName||kindName)+")"); const o=vm.opaqueVal(clsName||kindName); rt.set(key,o); return o; }
  const s=vm.host?vm.host.dev(name,JV_KIND_TYPE[kind]||kindName,kind):{};
  const cls=JV_KIND_CLASS[kind];
  let o;
  const c=vm.classes.get(cls);
  if(c&&c.decl){ o=yield* vm.construct(c,[name]); o.n=Object.assign(o.n||{},{name,kind,s}); }
  else o={__c:c||vm.opaqueClass(cls),f:Object.create(null),n:{name,kind,s,pos:null,min:0,max:1,rev:false,zero:null}};
  if(kind==="imu"||kind==="bno") o.n.zero=vm.host?vm.host.heading():0;
  rt.set(key,o);
  vm.devUse(name,kind,clsName);
  return o;
}
JVM.prototype.devUse=function(name,kind,cls){
  const u=this.devices||(this.devices=new Map());
  if(!u.has(name)) u.set(name,{name,kind,type:JV_KIND_TYPE[kind]||cls||kind,cls:cls||null});
};
const jvS=o=>o.n&&o.n.s||{};
const JV_MOTOR_M={
  setPower(vm,o,a){ const s=jvS(o); s.cmd=jvClamp(jvArg(a[0]),-1,1); if(vm.host&&vm.host.cmd) vm.host.cmd(o.n.name,"setPower",s.cmd); },
  getPower(vm,o){ return jvS(o).cmd||0; },
  setDirection(vm,o,a){ jvS(o).reversed=jvEn(a[0])==="REVERSE"; if(vm.host&&vm.host.cmd) vm.host.cmd(o.n.name,"setDirection",jvEn(a[0])); },
  getDirection(vm,o){ return vm.enumConst(JV_HW+"DcMotorSimple.Direction",jvS(o).reversed?"REVERSE":"FORWARD"); },
  setMode(vm,o,a){
    const s=jvS(o), m=jvEn(a[0])||"";
    s.modeName=m;
    if(/STOP_AND_RESET_ENCODER|RESET_ENCODERS/.test(m)){ s.offset=s.ticks||0; s.cmd=0; s.mode="reset"; }
    else if(/RUN_TO_POSITION/.test(m)) s.mode="rtp";
    else s.mode="run";
  },
  getMode(vm,o){ return vm.enumConst(JV_HW+"DcMotor.RunMode",jvS(o).modeName||"RUN_WITHOUT_ENCODER"); },
  setTargetPosition(vm,o,a){ jvS(o).target=Math.trunc(jvArg(a[0])); if(vm.host&&vm.host.cmd) vm.host.cmd(o.n.name,"setTargetPosition",jvS(o).target); },
  getTargetPosition(vm,o){ return jvS(o).target||0; },
  getCurrentPosition(vm,o){ const s=jvS(o); return Math.round((s.ticks||0)-(s.offset||0)); },
  isBusy(vm,o){ const s=jvS(o); return s.mode==="rtp"&&Math.abs((s.target||0)-((s.ticks||0)-(s.offset||0)))>(s.tol||10); },
  setVelocity(vm,o,a){
    const s=jvS(o), tpr=s.tpr||537.7, free=(s.spec&&s.spec.rpm||300)/60*tpr;
    let tps=jvArg(a[0]);
    const u=jvEn(a[1]); if(u==="RADIANS") tps=tps/(2*Math.PI)*tpr; else if(u==="DEGREES") tps=tps/360*tpr;
    s.cmd=jvClamp(tps/free,-1,1);
    if(vm.host&&vm.host.cmd) vm.host.cmd(o.n.name,"setVelocity",s.cmd);
  },
  getVelocity(vm,o,a){ const s=jvS(o), v=s.vel||0, u=jvEn(a[0]), tpr=s.tpr||537.7; return u==="RADIANS"?v/tpr*2*Math.PI:u==="DEGREES"?v/tpr*360:v; },
  setZeroPowerBehavior(vm,o,a){ jvS(o).zpb=jvEn(a[0]); },
  getZeroPowerBehavior(vm,o){ return vm.enumConst(JV_HW+"DcMotor.ZeroPowerBehavior",jvS(o).zpb||"FLOAT"); },
  setTargetPositionTolerance(vm,o,a){ jvS(o).tol=jvArg(a[0]); }, getTargetPositionTolerance(vm,o){ return jvS(o).tol||10; },
  getCurrent(vm,o,a){ const amps=0.2+Math.abs(jvS(o).act||0)*6; return jvEn(a[0])==="MILLIAMPS"?amps*1000:amps; },
  getCurrentAlert(){ return 8; }, setCurrentAlert(){}, isOverCurrent(){ return false; },
  setMotorEnable(){}, setMotorDisable(){}, isMotorEnabled(){ return true; },
  setPIDFCoefficients(){}, setVelocityPIDFCoefficients(){}, setPositionPIDFCoefficients(){}, setPIDCoefficients(){},
  getPIDFCoefficients(vm){ return vm.mk(JV_HW+"PIDFCoefficients",{p:10,i:3,d:0,f:0}); },
  getMotorType(vm,o){ const s=jvS(o); return vm.mk(JV_HW+"configuration.typecontainers.MotorConfigurationType",null,{tpr:s.tpr||537.7,rpm:s.spec&&s.spec.rpm||312}); },
  setMotorType(){},
  getDeviceName(vm,o){ return o.n.name; }, getConnectionInfo(vm,o){ return "sim:"+o.n.name; }, getVersion(){ return 1; }, getManufacturer(){ return null; },
  getPortNumber(vm,o){ return o.n.port||0; }, getController(vm){ return vm.opaqueVal("DcMotorController"); },
  resetDeviceConfigurationForOpMode(){}, close(){}, setPowerFloat(){}, getPowerFloat(){ return false; },
};
const JV_SERVO_M={
  setPosition(vm,o,a){
    const n=o.n, p=jvClamp(jvArg(a[0]),0,1);
    n.pos=p;
    const phys=n.min+(n.max-n.min)*(n.rev?1-p:p);
    jvS(o).cmd=phys;
    if(vm.host&&vm.host.cmd) vm.host.cmd(n.name,"setPosition",phys);
  },
  getPosition(vm,o){ const n=o.n; if(n.pos!=null) return n.pos; const c=jvS(o).cmd; return c==null?0.5:c; },
  setDirection(vm,o,a){ o.n.rev=jvEn(a[0])==="REVERSE"; },
  getDirection(vm,o){ return vm.enumConst(JV_HW+"Servo.Direction",o.n.rev?"REVERSE":"FORWARD"); },
  scaleRange(vm,o,a){ o.n.min=jvClamp(jvArg(a[0]),0,1); o.n.max=jvClamp(jvArg(a[1]),0,1); },
  setPwmRange(){}, getPwmRange(vm){ return vm.opaqueVal("PwmRange"); }, setPwmEnable(){}, setPwmDisable(){}, isPwmEnabled(){ return true; },
  getController(vm){ return vm.opaqueVal("ServoController"); }, getPortNumber(vm,o){ return o.n.port||0; },
  getDeviceName(vm,o){ return o.n.name; }, getConnectionInfo(vm,o){ return "sim:"+o.n.name; }, getVersion(){ return 1; }, getManufacturer(){ return null; },
  resetDeviceConfigurationForOpMode(){}, close(){},
};
const JV_CRSERVO_M={
  setPower(vm,o,a){ const s=jvS(o); s.cmd=jvClamp(jvArg(a[0]),-1,1); if(vm.host&&vm.host.cmd) vm.host.cmd(o.n.name,"setPower",s.cmd); },
  getPower(vm,o){ return jvS(o).cmd||0; },
  setDirection(vm,o,a){ jvS(o).reversed=jvEn(a[0])==="REVERSE"; },
  getDirection(vm,o){ return vm.enumConst(JV_HW+"DcMotorSimple.Direction",jvS(o).reversed?"REVERSE":"FORWARD"); },
  setPwmRange(){}, setPwmEnable(){}, setPwmDisable(){}, isPwmEnabled(){ return true; },
  getController(vm){ return vm.opaqueVal("ServoController"); }, getPortNumber(){ return 0; },
  getDeviceName(vm,o){ return o.n.name; }, getConnectionInfo(){ return "sim"; }, getVersion(){ return 1; }, getManufacturer(){ return null; },
  resetDeviceConfigurationForOpMode(){}, close(){},
};
/* heading the way an IMU reports it: since it came up or was last reset, -pi..pi */
function jvYaw(vm,o){ const h=(vm.host?vm.host.heading():0)-(o.n.zero||0); return Math.atan2(Math.sin(h),Math.cos(h)); }
const jvAng=(rad,unit)=>jvEn(unit)==="RADIANS"?rad:rad*180/Math.PI;
const JV_IMU_M={
  initialize(){ return true; },
  resetYaw(vm,o){ o.n.zero=vm.host?vm.host.heading():0; },
  getRobotYawPitchRollAngles(vm,o){ return vm.mk(JV_NAV+"YawPitchRollAngles",null,{yaw:jvYaw(vm,o),pitch:0,roll:0}); },
  getRobotOrientation(vm,o,a){ const u=a[2]; return vm.mk(JV_NAV+"Orientation",{firstAngle:jvAng(jvYaw(vm,o),u),secondAngle:0,thirdAngle:0,angleUnit:u||null,axesReference:a[0]||null,axesOrder:a[1]||null}); },
  getRobotAngularVelocity(vm,o,a){ const w=vm.host&&vm.host.omega?vm.host.omega():0; return vm.mk(JV_NAV+"AngularVelocity",{zRotationRate:jvAng(w,a[0]),xRotationRate:0,yRotationRate:0,unit:a[0]||null}); },
  getRobotOrientationAsQuaternion(vm){ return vm.opaqueVal("Quaternion"); },
  getDeviceName(vm,o){ return o.n.name; }, getConnectionInfo(){ return "sim"; }, getVersion(){ return 1; }, getManufacturer(){ return null; },
  resetDeviceConfigurationForOpMode(){}, close(){},
};
const JV_BNO_M={
  initialize(vm,o,a){ const p=a[0]; o.n.unit=p&&p.f&&p.f.angleUnit?jvEn(p.f.angleUnit):"RADIANS"; o.n.zero=vm.host?vm.host.heading():0; return true; },
  getAngularOrientation(vm,o,a){
    const u=a.length>=3?jvEn(a[2]):(o.n.unit||"RADIANS");
    return vm.mk(JV_NAV+"Orientation",{firstAngle:jvAng(jvYaw(vm,o),u),secondAngle:0,thirdAngle:0,angleUnit:vm.enumConst(JV_NAV+"AngleUnit",u==="DEGREES"?"DEGREES":"RADIANS")});
  },
  getAngularVelocity(vm,o){ const w=vm.host&&vm.host.omega?vm.host.omega():0; return vm.mk(JV_NAV+"AngularVelocity",{zRotationRate:jvAng(w,o.n.unit||"RADIANS"),xRotationRate:0,yRotationRate:0}); },
  isGyroCalibrated(){ return true; }, isSystemCalibrated(){ return true; }, isAccelerometerCalibrated(){ return true; }, isMagnetometerCalibrated(){ return true; },
  getCalibrationStatus(vm){ return vm.opaqueVal("CalibStatus"); }, getSystemStatus(vm){ return vm.opaqueVal("SystemStatus"); },
  startAccelerationIntegration(){}, stopAccelerationIntegration(){},
  getPosition(vm){ return vm.opaqueVal("Position"); }, getVelocity(vm){ return vm.opaqueVal("Velocity"); }, getAcceleration(vm){ return vm.opaqueVal("Acceleration"); },
  getDeviceName(vm,o){ return o.n.name; }, close(){},
};
/* goBILDA Pinpoint: x forward, y left (mm), heading CCW (rad), from where it was last reset */
function jvOdo(vm,o){
  const p=vm.host?vm.host.pose():{x:0,y:0,h:0}, z=o.n.org||(o.n.org={x:p.x,y:p.y,h:p.h,ox:0,oy:0,oh:0});
  const dx=p.x-z.x, dy=p.y-z.y, c=Math.cos(z.h), s=Math.sin(z.h);
  const lx=c*dx+s*dy, ly=-s*dx+c*dy, lh=p.h-z.h;
  // a setPosition() places that frame in the team's own coordinates
  const C=Math.cos(z.oh), S=Math.sin(z.oh);
  const h=z.oh+lh;
  return {x:z.ox+C*lx-S*ly, y:z.oy+S*lx+C*ly, h:Math.atan2(Math.sin(h),Math.cos(h)), raw:h};
}
function jvOdoSet(vm,o,x,y,h){ const p=vm.host?vm.host.pose():{x:0,y:0,h:0}; o.n.org={x:p.x,y:p.y,h:p.h,ox:x,oy:y,oh:h}; }
const jvLen=(m,unit)=>{ const u=jvEn(unit); return u==="INCH"?m/0.0254:u==="CM"?m*100:u==="METER"?m:m*1000; };
const jvFromLen=(v,unit)=>{ const u=jvEn(unit); return u==="INCH"?v*0.0254:u==="CM"?v/100:u==="METER"?v:v/1000; };
const JV_PINPOINT_M={
  update(){}, resetPosAndIMU(vm,o){ jvOdoSet(vm,o,0,0,0); }, recalibrateIMU(){}, resetPosition(vm,o){ jvOdoSet(vm,o,0,0,0); },
  getPosition(vm,o){ const q=jvOdo(vm,o); return vm.mk(JV_NAV+"Pose2D",{x:q.x,y:q.y,heading:q.h,distanceUnit:vm.enumConst(JV_NAV+"DistanceUnit","METER"),headingUnit:vm.enumConst(JV_NAV+"AngleUnit","RADIANS")}); },
  setPosition(vm,o,a){ const P=a[0]; if(!P||!P.f) return; const du=jvEn(P.f.distanceUnit)||"MM", hu=jvEn(P.f.headingUnit)||"RADIANS";
    jvOdoSet(vm,o,jvFromLen(jvNum(P.f.x),du),jvFromLen(jvNum(P.f.y),du),hu==="DEGREES"?jvNum(P.f.heading)*Math.PI/180:jvNum(P.f.heading)); },
  getPosX(vm,o,a){ return jvLen(jvOdo(vm,o).x,a[0]||"MM"); }, getPosY(vm,o,a){ return jvLen(jvOdo(vm,o).y,a[0]||"MM"); },
  getHeading(vm,o,a){ const q=jvOdo(vm,o); const u=jvEn(a[0]); return u==="DEGREES"?q.h*180/Math.PI:q.h; },
  setPosX(vm,o,a){ const q=jvOdo(vm,o); jvOdoSet(vm,o,jvFromLen(jvArg(a[0]),a[1]||"MM"),q.y,q.h); },
  setPosY(vm,o,a){ const q=jvOdo(vm,o); jvOdoSet(vm,o,q.x,jvFromLen(jvArg(a[0]),a[1]||"MM"),q.h); },
  setHeading(vm,o,a){ const q=jvOdo(vm,o); const u=jvEn(a[1]); jvOdoSet(vm,o,q.x,q.y,u==="DEGREES"?jvArg(a[0])*Math.PI/180:jvArg(a[0])); },
  getVelX(vm,o,a){ const v=vm.host&&vm.host.vel?vm.host.vel():{x:0,y:0}; return jvLen(v.x,a[0]||"MM"); }, getVelY(vm,o,a){ const v=vm.host&&vm.host.vel?vm.host.vel():{x:0,y:0}; return jvLen(v.y,a[0]||"MM"); },
  getHeadingVelocity(vm){ return vm.host&&vm.host.omega?vm.host.omega():0; },
  getVelocity(vm){ const v=vm.host&&vm.host.vel?vm.host.vel():{x:0,y:0}; return vm.mk(JV_NAV+"Pose2D",{x:v.x,y:v.y,heading:vm.host&&vm.host.omega?vm.host.omega():0,distanceUnit:vm.enumConst(JV_NAV+"DistanceUnit","METER"),headingUnit:vm.enumConst(JV_NAV+"AngleUnit","RADIANS")}); },
  setOffsets(){}, setEncoderResolution(){}, setEncoderDirections(){}, setYawScalar(){}, setErrorDetectionType(){}, initialize(){ return true; },
  getEncoderX(vm,o){ return Math.round(jvOdo(vm,o).x/0.048/Math.PI*2000); }, getEncoderY(vm,o){ return Math.round(jvOdo(vm,o).y/0.048/Math.PI*2000); },
  getDeviceStatus(vm){ return vm.enumConst("com.qualcomm.hardware.gobilda.GoBildaPinpointDriver.DeviceStatus","READY"); },
  getLoopTime(){ return 1000; }, getFrequency(){ return 1000; }, getDeviceVersion(){ return 2; }, getDeviceID(){ return 1; }, getXOffset(){ return 0; }, getYOffset(){ return 0; },
  getDeviceName(vm,o){ return o.n.name; }, close(){},
};
/* SparkFun OTOS: x forward, y left, heading CCW, in its own units (inch and degrees unless told) */
function jvOtosPose(vm,q,o){ const lu=o.n.lu||"INCH", au=o.n.au||"DEGREES";
  return vm.mk("com.qualcomm.hardware.sparkfun.SparkFunOTOS.Pose2D",{x:jvLen(q.x,lu),y:jvLen(q.y,lu),h:au==="RADIANS"?q.h:q.h*180/Math.PI}); }
const JV_OTOS_M={
  begin(){ return true; }, calibrateImu(){ return true; }, isConnected(){ return true; }, resetTracking(vm,o){ jvOdoSet(vm,o,0,0,0); },
  setLinearUnit(vm,o,a){ o.n.lu=jvEn(a[0]); }, setAngularUnit(vm,o,a){ o.n.au=jvEn(a[0]); },
  getLinearUnit(vm,o){ return vm.enumConst(JV_NAV+"DistanceUnit",o.n.lu||"INCH"); }, getAngularUnit(vm,o){ return vm.enumConst(JV_NAV+"AngleUnit",o.n.au||"DEGREES"); },
  getPosition(vm,o){ return jvOtosPose(vm,jvOdo(vm,o),o); },
  setPosition(vm,o,a){ const P=a[0]; if(!P||!P.f) return; const lu=o.n.lu||"INCH", au=o.n.au||"DEGREES";
    jvOdoSet(vm,o,jvFromLen(jvNum(P.f.x),lu),jvFromLen(jvNum(P.f.y),lu),au==="RADIANS"?jvNum(P.f.h):jvNum(P.f.h)*Math.PI/180); },
  getVelocity(vm,o){ return jvOtosPose(vm,{x:0,y:0,h:0},o); }, getAcceleration(vm,o){ return jvOtosPose(vm,{x:0,y:0,h:0},o); },
  setOffset(){}, setLinearScalar(){ return true; }, setAngularScalar(){ return true; }, setSignalProcessConfig(){}, getStatus(vm){ return vm.opaqueVal("OtosStatus"); },
  getVersionInfo(){}, selfTest(){ return true; }, getDeviceName(vm,o){ return o.n.name; }, close(){},
};
const JV_DIST_M={
  getDistance(vm,o,a){ const m=vm.host&&vm.host.ray?vm.host.ray():8.19; return jvLen(m>2?8.19:m,a[0]||"CM"); },
  getDeviceName(vm,o){ return o.n.name; }, close(){}, didTimeoutOccur(){ return false; },
};
const JV_COLOR_M={
  red(vm,o){ return (vm.host&&vm.host.color?vm.host.color():[120,120,120])[0]; },
  green(vm,o){ return (vm.host&&vm.host.color?vm.host.color():[120,120,120])[1]; },
  blue(vm,o){ return (vm.host&&vm.host.color?vm.host.color():[120,120,120])[2]; },
  alpha(){ return 255; }, argb(vm,o){ const c=vm.host&&vm.host.color?vm.host.color():[120,120,120]; return (255<<24)|(c[0]<<16)|(c[1]<<8)|c[2]; },
  getNormalizedColors(vm,o){ const c=vm.host&&vm.host.color?vm.host.color():[120,120,120]; return vm.mk(JV_HW+"NormalizedRGBA",{red:c[0]/255,green:c[1]/255,blue:c[2]/255,alpha:1}); },
  getDistance(vm,o,a){ return jvLen(0.2,a[0]||"CM"); }, getLightDetected(){ return 0.1; }, getRawLightDetected(){ return 100; },
  enableLed(){}, setGain(){}, getGain(){ return 1; }, setI2cAddress(){}, getI2cAddress(vm){ return vm.opaqueVal("I2cAddr"); },
  getDeviceName(vm,o){ return o.n.name; }, close(){},
};
const JV_SENSOR_M={
  isPressed(vm,o){ return vm.host&&vm.host.touch?!!vm.host.touch(o.n.name):false; }, getValue(vm,o){ return vm.host&&vm.host.touch&&vm.host.touch(o.n.name)?1:0; },
  getState(vm,o){ return !(vm.host&&vm.host.touch&&vm.host.touch(o.n.name)); }, setState(){}, setMode(){}, getMode(vm){ return vm.opaqueVal("DigitalChannel.Mode"); },
  getVoltage(vm,o){ return o.n.kind==="voltage"||o.n.kind==="hub"?(vm.host&&vm.host.volts?vm.host.volts():12.6):0; },
  getMaxVoltage(){ return 3.3; },
  getInputVoltage(vm,o,a){ const v=vm.host&&vm.host.volts?vm.host.volts():12.6; return jvEn(a[0])==="MILLIVOLTS"?v*1000:v; },
  setBulkCachingMode(){}, clearBulkCache(){}, isParent(vm,o){ return o.n.name==="Control Hub"; }, getSerialNumber(vm,o){ return o.n.name==="Control Hub"?"(embedded)":"DQ2"+o.n.name.length; }, getBulkData(vm){ return vm.opaqueVal("BulkData"); }, setConstant(){}, setPattern(){}, getModuleAddress(){ return 2; },
  getCurrent(vm,o,a){ return jvEn(a[0])==="MILLIAMPS"?3000:3; }, getGpioBusCurrent(){ return 0; }, getI2cBusCurrent(){ return 0; },
  enable(){}, enableLight(){}, isLightOn(){ return false; },
  // Limelight: no camera in the sim, so no result, as with nothing in view
  start(){}, stop(){}, pause(){}, pipelineSwitch(){ return true; }, setPollRateHz(){}, getLatestResult(){ return null; }, isConnected(){ return true; }, isRunning(){ return true; },
  updateRobotOrientation(){ return true; }, getStatus(vm){ return vm.opaqueVal("LLStatus"); }, reloadPipeline(){ return true; }, captureSnapshot(){ return true; },
  getDeviceName(vm,o){ return o.n.name; }, getConnectionInfo(){ return "sim"; }, getVersion(){ return 1; }, getManufacturer(){ return null; }, close(){},
};

/* ---- the natives table ---- */
function jvNatives(){
  const N={};
  const d=(fqn,def)=>{ N[fqn]=def; return def; };
  const en=(fqn,consts,outer,extra)=>d(fqn,Object.assign({enumConsts:consts,outer:outer||null},extra||{}));
  const THROW=(vm,o,a)=>{ o.n=Object.assign(o.n||{},{isThrowable:true,msg:a.length?(typeof a[0]==="string"?a[0]:(a[0]&&a[0].n&&a[0].n.msg)||null):null}); };
  // java.lang
  d("java.lang.Object",{ctor(){}});
  d("java.lang.Runnable",{kind:"interface",functional:true});
  ["Throwable","Exception","Error","RuntimeException","InterruptedException","IllegalArgumentException","IllegalStateException","NullPointerException",
   "ArithmeticException","IndexOutOfBoundsException","ArrayIndexOutOfBoundsException","UnsupportedOperationException","ClassCastException","NumberFormatException",
   "NoSuchMethodError","NoSuchFieldError","StackOverflowError","AbstractMethodError","InstantiationException","NegativeArraySizeException","AssertionError","IOException","ConcurrentModificationException"]
    .forEach(n=>d("java.lang."+n,{sup:n==="Throwable"?"java.lang.Object":/Error$/.test(n)?"java.lang.Error":/^(IllegalArgument|IllegalState|NullPointer|Arithmetic|IndexOutOfBounds|UnsupportedOperation|ClassCast|ConcurrentModification)Exception$/.test(n)?"java.lang.RuntimeException":
      n==="ArrayIndexOutOfBoundsException"?"java.lang.IndexOutOfBoundsException":n==="NumberFormatException"?"java.lang.IllegalArgumentException":n==="Error"||n==="Exception"?"java.lang.Throwable":"java.lang.Exception",
      ctor:THROW, m:{getMessage(vm,o){ return o.n&&o.n.msg; }, getLocalizedMessage(vm,o){ return o.n&&o.n.msg; }, printStackTrace(){}, getCause(){ return null; },
        toString(vm,o){ return o.__c.name+(o.n&&o.n.msg?": "+o.n.msg:""); }, getStackTrace(){ return []; }}}));
  d("java.lang.Math",{sf:{PI:Math.PI,E:Math.E},s:jvMathStatics()});
  d("java.lang.StrictMath",{sf:{PI:Math.PI,E:Math.E},s:jvMathStatics()});
  d("java.lang.System",{s:{
    currentTimeMillis(vm){ return Math.round(1.7e12+(vm.host?vm.host.now():0)*1000); },
    nanoTime(vm){ return Math.round((vm.host?vm.host.now():0)*1e9); },
    arraycopy(vm,a){ for(let k=0;k<a[4];k++) a[2][a[3]+k]=a[0][a[1]+k]; },
    exit(){}, gc(){}, getProperty(){ return null; }, lineSeparator(){ return "\n"; }, identityHashCode(vm,a){ return jvIsObj(a[0])?jvHash(a[0]):0; }},
    sget(vm,name){ if(name==="out"||name==="err") return vm.mk("java.io.PrintStream"); }});
  d("java.io.PrintStream",{m:{println(){}, print(){}, printf(){}, format(){}, flush(){}}});
  d("java.lang.Thread",{ctor(vm,o,a){ o.n={run:a[0]||null}; },
    s:{sleep(vm,a){ return {__block:{sleep:jvArg(a[0])}}; }, currentThread(vm){ return vm.mk("java.lang.Thread",null,{main:true}); }, interrupted(){ return false; }, yield(vm){ return {__block:{gate:true}}; }, onSpinWait(){}},
    m:{*start(vm,o){ const self=o; const run=o.n.run;
        const g=run?(run instanceof JvFn?vm.callFn(run,[],"run"):vm.invoke(run,"run",[],null)):vm.invoke(self,"run",[],null);
        (vm.threads||(vm.threads=[])).push({g,resumeAt:0}); },
      isInterrupted(){ return false; }, interrupt(){}, join(){}, setDaemon(){}, setPriority(){}, isAlive(){ return true; }, setName(){}, getName(){ return "thread"; }, run(){}}});
  d("java.lang.Integer",{sf:{MAX_VALUE:2147483647,MIN_VALUE:-2147483648},s:jvBoxStatics(true)});
  d("java.lang.Long",{sf:{MAX_VALUE:9223372036854775807,MIN_VALUE:-9223372036854775808},s:jvBoxStatics(true)});
  d("java.lang.Short",{sf:{MAX_VALUE:32767,MIN_VALUE:-32768},s:jvBoxStatics(true)});
  d("java.lang.Byte",{sf:{MAX_VALUE:127,MIN_VALUE:-128},s:jvBoxStatics(true)});
  d("java.lang.Double",{sf:{MAX_VALUE:Number.MAX_VALUE,MIN_VALUE:Number.MIN_VALUE,POSITIVE_INFINITY:Infinity,NEGATIVE_INFINITY:-Infinity,NaN:NaN},s:jvBoxStatics(false)});
  d("java.lang.Float",{sf:{MAX_VALUE:3.4028235e38,MIN_VALUE:1.4e-45,POSITIVE_INFINITY:Infinity,NEGATIVE_INFINITY:-Infinity,NaN:NaN},s:jvBoxStatics(false)});
  d("java.lang.Number",{});
  d("java.lang.Boolean",{sf:{TRUE:true,FALSE:false},s:{parseBoolean(vm,a){ return String(a[0]).toLowerCase()==="true"; }, valueOf(vm,a){ return typeof a[0]==="string"?a[0].toLowerCase()==="true":!!a[0]; }, toString(vm,a){ return String(!!a[0]); }, compare(vm,a){ return (a[0]?1:0)-(a[1]?1:0); }, logicalAnd(vm,a){ return a[0]&&a[1]; }, logicalOr(vm,a){ return a[0]||a[1]; }, logicalXor(vm,a){ return a[0]!==a[1]; }}});
  d("java.lang.Character",{s:{isDigit(vm,a){ return a[0]>=48&&a[0]<=57; }, isLetter(vm,a){ return /[A-Za-z]/.test(String.fromCharCode(a[0])); }, isWhitespace(vm,a){ return /\s/.test(String.fromCharCode(a[0])); },
    toUpperCase(vm,a){ return String.fromCharCode(a[0]).toUpperCase().charCodeAt(0); }, toLowerCase(vm,a){ return String.fromCharCode(a[0]).toLowerCase().charCodeAt(0); }, getNumericValue(vm,a){ return a[0]-48; }, valueOf(vm,a){ return a[0]; }, toString(vm,a){ return String.fromCharCode(a[0]); }, isUpperCase(vm,a){ return a[0]>=65&&a[0]<=90; }}});
  d("java.lang.String",{s:{format(vm,a){ return jvFormat(a[0],a.slice(1)); }, *valueOf(vm,a){ return yield* vm.str(a[0],typeof a[0]==="number"&&Number.isInteger(a[0])?"i":null); },
    *join(vm,a){ const sep=a[0]; const items=a.length===2&&a[1]&&a[1].n&&a[1].n.items?a[1].n.items:(a.length===2&&Array.isArray(a[1])?a[1]:a.slice(1)); const out=[]; for(const x of items) out.push(yield* vm.str(x)); return out.join(sep); },
    copyValueOf(vm,a){ return a[0].map(c=>String.fromCharCode(c)).join(""); }}, ctor(){}});
  d("java.lang.StringBuilder",{ctor(vm,o,a){ o.n={s:typeof a[0]==="string"?a[0]:""}; },
    m:{*append(vm,o,a){ o.n.s+=yield* vm.str(a[0]); return o; }, toString(vm,o){ return o.n.s; }, length(vm,o){ return o.n.s.length; },
      setLength(vm,o,a){ o.n.s=o.n.s.slice(0,a[0]); }, *insert(vm,o,a){ o.n.s=o.n.s.slice(0,a[0])+(yield* vm.str(a[1]))+o.n.s.slice(a[0]); return o; },
      reverse(vm,o){ o.n.s=o.n.s.split("").reverse().join(""); return o; }, deleteCharAt(vm,o,a){ o.n.s=o.n.s.slice(0,a[0])+o.n.s.slice(a[0]+1); return o; },
      charAt(vm,o,a){ return o.n.s.charCodeAt(a[0]); }, isEmpty(vm,o){ return !o.n.s.length; }}});
  N["java.lang.StringBuffer"]=Object.assign({},N["java.lang.StringBuilder"]);
  d("java.lang.Iterable",{kind:"interface"});
  d("java.lang.Comparable",{kind:"interface",functional:true});
  d("java.lang.AutoCloseable",{kind:"interface"});
  d("java.lang.Cloneable",{kind:"interface"});
  d("java.lang.Enum",{});
  d("java.lang.Record",{});
  d("java.lang.Void",{});
  d("java.lang.Class",{});
  d("java.lang.CharSequence",{kind:"interface"});
  // java.util
  const LIST={ctor(vm,o,a){ o.n={items:a.length&&a[0]&&a[0].n&&a[0].n.items?a[0].n.items.slice():(a.length&&Array.isArray(a[0])?a[0].slice():[])}; }, m:JV_LIST_M, alsoIs:["List","Collection","Iterable","Deque","Queue"]};
  ["ArrayList","LinkedList","ArrayDeque","Stack","Vector","PriorityQueue","CopyOnWriteArrayList"].forEach(n=>d((n==="CopyOnWriteArrayList"?"java.util.concurrent.":"java.util.")+n,LIST));
  const SET={ctor:LIST.ctor, m:Object.assign({},JV_LIST_M,{add:JV_SET_ADD}), alsoIs:["Set","Collection","Iterable"]};
  ["HashSet","LinkedHashSet","TreeSet"].forEach(n=>d("java.util."+n,SET));
  ["List","Collection","Queue","Deque","Set","Map","SortedMap","Iterator","ListIterator"].forEach(n=>{ if(!N["java.util."+n]) d("java.util."+n,{kind:"interface"}); });
  d("java.util.Iterator",{kind:"interface",m:{hasNext(vm,o){ return o.n.i<o.n.items.length; }, next(vm,o){ if(o.n.i>=o.n.items.length) throw vm.jthrow("NoSuchElementException","no more"); return o.n.items[o.n.i++]; },
    remove(vm,o){ const v=o.n.items[o.n.i-1]; if(o.n.src&&o.n.src.n.items){ const k=jvIdx(o.n.src.n.items,v); if(k>=0) o.n.src.n.items.splice(k,1); } }}});
  const MAP={ctor(vm,o,a){ o.n={map:new Map(a.length&&a[0]&&a[0].n&&a[0].n.map?Array.from(a[0].n.map).map(([k,e])=>[k,e.slice()]):[])}; }, m:JV_MAP_M, alsoIs:["Map"]};
  ["HashMap","LinkedHashMap","TreeMap","Hashtable","EnumMap","ConcurrentHashMap","WeakHashMap","IdentityHashMap"].forEach(n=>d((n==="ConcurrentHashMap"?"java.util.concurrent.":"java.util.")+n,MAP));
  d("java.util.Map.Entry",{kind:"interface",m:{getKey(vm,o){ return o.n.e[0]; }, getValue(vm,o){ return o.n.e[1]; }, setValue(vm,o,a){ const v=o.n.e[1]; o.n.e[1]=a[0]; return v; }}});
  N["java.util.Map"].s={of(vm,a){ const m=jvMapObj(vm); for(let k=0;k+1<a.length;k+=2) JV_MAP_M.put(vm,m,[a[k],a[k+1]]); return m; },
    entry(vm,a){ return {__c:vm.classes.get("java.util.Map.Entry"),f:Object.create(null),n:{e:[a[0],a[1]]}}; }, copyOf(vm,a){ return a[0]; }};
  N["java.util.List"].s={of(vm,a){ return jvList(vm,a.length===1&&Array.isArray(a[0])?a[0].slice():a.slice()); }, copyOf(vm,a){ return jvList(vm,(a[0]&&a[0].n&&a[0].n.items||[]).slice()); }};
  N["java.util.Set"].s={of(vm,a){ return jvList(vm,a.slice(),"java.util.HashSet"); }};
  d("java.util.Optional",{s:{of(vm,a){ return jvOptional(vm,a[0]); }, ofNullable(vm,a){ return jvOptional(vm,a[0]); }, empty(vm){ return jvOptional(vm,null); }},
    m:{isPresent(vm,o){ return o.n.v!=null; }, isEmpty(vm,o){ return o.n.v==null; }, get(vm,o){ return o.n.v; }, orElse(vm,o,a){ return o.n.v!=null?o.n.v:a[0]; },
      getAsDouble(vm,o){ return o.n.v; }, getAsInt(vm,o){ return o.n.v; }, *ifPresent(vm,o,a){ if(o.n.v!=null) yield* vm.callFn(a[0],[o.n.v]); }, *orElseGet(vm,o,a){ return o.n.v!=null?o.n.v:yield* vm.callFn(a[0],[]); }}});
  N["java.util.OptionalDouble"]=N["java.util.Optional"];
  d("java.util.stream.Stream",{m:JV_STREAM_M});
  d("java.util.stream.Collectors",{s:{toList(){ return null; }, toSet(){ return null; }}});
  d("java.util.Arrays",{s:{asList(vm,a){ return jvList(vm,a.length===1&&Array.isArray(a[0])?a[0]:a.slice()); }, fill(vm,a){ if(a.length===2) a[0].fill(a[1]); else a[0].fill(a[3],a[1],a[2]); },
    *sort(vm,a){ if(a.length>=2&&a[1] instanceof JvFn) yield* jvSort(vm,a[0],a[1]); else a[0].sort((x,y)=>x-y); }, toString(vm,a){ return "["+(a[0]||[]).join(", ")+"]"; },
    copyOf(vm,a){ const r=a[0].slice(0,a[1]); while(r.length<a[1]) r.push(0); return r; }, copyOfRange(vm,a){ return a[0].slice(a[1],a[2]); },
    stream(vm,a){ return jvList(vm,a[0].slice(),"java.util.stream.Stream"); }, equals(vm,a){ return a[0]&&a[1]&&a[0].length===a[1].length&&a[0].every((v,k)=>jvEq(v,a[1][k])); }}});
  d("java.util.Collections",{s:{emptyList(vm){ return jvList(vm,[]); }, emptyMap(vm){ return jvMapObj(vm); }, emptySet(vm){ return jvList(vm,[],"java.util.HashSet"); },
    unmodifiableList(vm,a){ return a[0]; }, unmodifiableMap(vm,a){ return a[0]; }, unmodifiableSet(vm,a){ return a[0]; }, synchronizedList(vm,a){ return a[0]; },
    *sort(vm,a){ yield* jvSort(vm,a[0].n.items,a[1]||null); }, reverse(vm,a){ a[0].n.items.reverse(); },
    max(vm,a){ return a[0].n.items.reduce((x,y)=>y>x?y:x); }, min(vm,a){ return a[0].n.items.reduce((x,y)=>y<x?y:x); },
    addAll(vm,a){ a[0].n.items.push(...a.slice(1)); return true; }, singletonList(vm,a){ return jvList(vm,[a[0]]); }, nCopies(vm,a){ return jvList(vm,new Array(a[0]).fill(a[1])); }}});
  d("java.util.Objects",{s:{equals(vm,a){ return jvEq(a[0],a[1])||a[0]===a[1]; }, requireNonNull(vm,a){ if(a[0]==null) throw vm.jthrow("NullPointerException",typeof a[1]==="string"?a[1]:"null"); return a[0]; },
    isNull(vm,a){ return a[0]==null; }, nonNull(vm,a){ return a[0]!=null; }, hash(){ return 1; }, hashCode(){ return 1; }, toString(vm,a){ return String(a[0]); }, requireNonNullElse(vm,a){ return a[0]!=null?a[0]:a[1]; }}});
  d("java.util.Random",{ctor(vm,o,a){ o.n={seed:(a.length?jvNum(a[0]):42)>>>0||1}; },
    m:{nextDouble(vm,o){ return jvRand(o.n); }, nextFloat(vm,o){ return jvRand(o.n); }, nextBoolean(vm,o){ return jvRand(o.n)<0.5; },
      nextInt(vm,o,a){ const r=jvRand(o.n); return a.length===2?Math.floor(a[0]+r*(a[1]-a[0])):a.length?Math.floor(r*a[0]):Math.floor(r*4294967296)-2147483648; },
      nextGaussian(vm,o){ const u=Math.max(1e-12,jvRand(o.n)), v=jvRand(o.n); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }}});
  d("java.util.concurrent.TimeUnit",{enumConsts:["NANOSECONDS","MICROSECONDS","MILLISECONDS","SECONDS","MINUTES","HOURS","DAYS"],
    m:{sleep(vm,o,a){ const k={NANOSECONDS:1e-6,MICROSECONDS:1e-3,MILLISECONDS:1,SECONDS:1000,MINUTES:60000}[o.__en]||1; return {__block:{sleep:jvArg(a[0])*k}}; },
      toMillis(vm,o,a){ return jvArg(a[0])*({NANOSECONDS:1e-6,MICROSECONDS:1e-3,MILLISECONDS:1,SECONDS:1000,MINUTES:60000}[o.__en]||1); },
      toSeconds(vm,o,a){ return jvArg(a[0])*({NANOSECONDS:1e-9,MICROSECONDS:1e-6,MILLISECONDS:1e-3,SECONDS:1,MINUTES:60}[o.__en]||1); },
      toNanos(vm,o,a){ return jvArg(a[0])*({NANOSECONDS:1,MICROSECONDS:1e3,MILLISECONDS:1e6,SECONDS:1e9,MINUTES:6e10}[o.__en]||1); }}});
  ["java.util.concurrent.atomic.AtomicBoolean","java.util.concurrent.atomic.AtomicInteger","java.util.concurrent.atomic.AtomicReference","java.util.concurrent.atomic.AtomicLong"].forEach(f=>
    d(f,{ctor(vm,o,a){ o.n={v:a.length?a[0]:(/Boolean/.test(f)?false:/Reference/.test(f)?null:0)}; },
      m:{get(vm,o){ return o.n.v; }, set(vm,o,a){ o.n.v=a[0]; }, getAndSet(vm,o,a){ const v=o.n.v; o.n.v=a[0]; return v; }, incrementAndGet(vm,o){ return ++o.n.v; }, getAndIncrement(vm,o){ return o.n.v++; },
        decrementAndGet(vm,o){ return --o.n.v; }, addAndGet(vm,o,a){ return (o.n.v+=a[0]); }, compareAndSet(vm,o,a){ if(jvEq(o.n.v,a[0])||o.n.v===a[0]){ o.n.v=a[1]; return true; } return false; }, intValue(vm,o){ return o.n.v; }}}));
  ["Supplier","Consumer","BiConsumer","Function","BiFunction","Predicate","BiPredicate","BooleanSupplier","DoubleSupplier","IntSupplier","LongSupplier","DoubleUnaryOperator",
   "DoubleBinaryOperator","UnaryOperator","BinaryOperator","DoubleConsumer","IntConsumer","DoubleFunction","IntFunction","ToDoubleFunction","ToIntFunction"].forEach(n=>d("java.util.function."+n,{kind:"interface",functional:true}));
  d("java.util.Comparator",{kind:"interface",functional:true,s:{*comparingDouble(vm,a){ const f=a[0]; return new JvFn(null,null,null,null,null,vm,function*(v,x){ return jvNum(yield* v.callFn(f,[x[0]]))-jvNum(yield* v.callFn(f,[x[1]])); }); },
    *comparing(vm,a){ const f=a[0]; return new JvFn(null,null,null,null,null,vm,function*(v,x){ const p=yield* v.callFn(f,[x[0]]), q=yield* v.callFn(f,[x[1]]); return p<q?-1:p>q?1:0; }); }}});
  N["java.util.Comparator"].s.comparingInt=N["java.util.Comparator"].s.comparingDouble;
  d("java.util.concurrent.Callable",{kind:"interface",functional:true});

  /* ---- the FTC SDK ---- */
  const OPMODE={
    has(n){ return n==="hardwareMap"||n==="telemetry"||n==="gamepad1"||n==="gamepad2"||n==="time"||n==="blackboard"||/^msStuckDetect/.test(n); },
    get(vm,o,n){ const rt=vm.prog;
      if(o.n&&o.n.ov&&n in o.n.ov) return o.n.ov[n];
      if(n==="hardwareMap") return rt&&rt.attached?rt.hw:null;
      if(n==="telemetry") return rt?rt.tel:null;
      if(n==="gamepad1") return rt?rt.pads[1]:null;
      if(n==="gamepad2") return rt?rt.pads[2]:null;
      if(n==="time") return vm.host?vm.host.runtime():0;
      if(n==="blackboard") return vm.blackboard||(vm.blackboard=jvMapObj(vm));
      if(/^msStuckDetect/.test(n)) return 5000;
      return undefined; },
    set(vm,o,n,v){ (o.n||(o.n={})).ov=(o.n.ov||{}); o.n.ov[n]=v; },
    sget(vm,n){ if(n==="blackboard") return vm.blackboard||(vm.blackboard=jvMapObj(vm)); },
    m:{getRuntime(vm){ return vm.host?vm.host.runtime():0; }, resetRuntime(vm){ if(vm.host&&vm.host.resetRuntime) vm.host.resetRuntime(); },
      requestOpModeStop(vm){ if(vm.prog) vm.prog.stopAsked=true; }, terminateOpModeNow(vm){ if(vm.prog) vm.prog.stopAsked=true; const e=new Error("terminateOpModeNow"); e.jvStop=true; throw e; },
      updateTelemetry(vm){ return JV_TEL_M.update(vm); }, init(){}, init_loop(){}, start(){}, loop(){}, stop(){}, internalPostInitLoop(){}, internalPostLoop(){}}};
  d("com.qualcomm.robotcore.eventloop.opmode.OpMode",Object.assign({},OPMODE));
  const LIN=vm=>vm.prog;
  d("com.qualcomm.robotcore.eventloop.opmode.LinearOpMode",{sup:"com.qualcomm.robotcore.eventloop.opmode.OpMode",
    m:{
      waitForStart(vm){ const p=LIN(vm); if(!p||p.started||p.stopAsked) return undefined; return {__block:{wait:"start"}}; },
      opModeIsActive(vm){ const p=LIN(vm); return jvGate(vm,()=>!!(p&&p.started&&!p.stopAsked)); },
      opModeInInit(vm){ const p=LIN(vm); return jvGate(vm,()=>!!(p&&!p.started&&!p.stopAsked)); },
      isStarted(vm){ const p=LIN(vm); return jvGate(vm,()=>!!(p&&p.started)); },
      isStopRequested(vm){ const p=LIN(vm); return jvGate(vm,()=>!!(p&&p.stopAsked)); },
      idle(vm){ return {__block:{gate:true}}; },
      sleep(vm,o,a){ return {__block:{sleep:jvArg(a[0])}}; },
      runOpMode(){}, waitOneFullHardwareCycle(vm){ return {__block:{gate:true}}; }}});
  // hardwareMap
  const DEVMAP=(kind)=>({ctor(){}, m:{
    *get(vm,o,a){ return yield* jvGetDevice(vm,kind,a[a.length-1],kind); },
    iterator(vm,o){ return JV_LIST_M.iterator(vm,{n:{items:jvDevMapItems(vm,kind)}}); },
    entrySet(vm){ return jvList(vm,[]); }, size(){ return 1; }, contains(){ return true; }}});
  d("com.qualcomm.robotcore.hardware.HardwareMap.DeviceMapping",{});
  d(JV_HW+"HardwareMap",{
    get(vm,o,n){ const map={dcMotor:"DcMotor",servo:"Servo",crservo:"CRServo",voltageSensor:"VoltageSensor",touchSensor:"TouchSensor",colorSensor:"ColorSensor",
      opticalDistanceSensor:"DistanceSensor",analogInput:"AnalogInput",digitalChannel:"DigitalChannel",led:"LED",lightSensor:"ColorSensor",dcMotorController:"DcMotorController",servoController:"ServoController"};
      if(map[n]){ const k=map[n]; return vm.mk(JV_HW+"HardwareMap.DeviceMapping."+k,null,{kind:k}); }
      if(n==="appContext") return vm.opaqueVal("Context");
      return undefined; },
    m:{
      *get(vm,o,a){
        if(a.length===1){ const nm=a[0]; return yield* jvGetDevice(vm,(vm.devices&&vm.devices.get(String(nm))||{}).type||"DcMotor",nm,null); }
        const cls=a[0]&&a[0].__type, nm=a[1];
        return yield* jvGetDevice(vm,cls?cls.name:"?",nm,cls?cls.name:null);
      },
      *tryGet(vm,o,a){ const cls=a[0]&&a[0].__type; return yield* jvGetDevice(vm,cls?cls.name:"?",a[1],cls?cls.name:null); },
      *getAll(vm,o,a){ const cls=a[0]&&a[0].__type, k=cls?cls.name:"";
        if(JV_DEV_KIND[k]==="hub") return jvList(vm,[yield* jvGetDevice(vm,"LynxModule","Control Hub","LynxModule"),yield* jvGetDevice(vm,"LynxModule","Expansion Hub 2","LynxModule")]);
        if(JV_DEV_KIND[k]==="voltage") return jvList(vm,[yield* jvGetDevice(vm,"VoltageSensor","Control Hub","VoltageSensor")]);
        return jvList(vm,[]); },
      getNamesOf(vm){ return jvList(vm,[],"java.util.HashSet"); }, size(){ return 0; },
      iterator(vm){ return JV_LIST_M.iterator(vm,{n:{items:[]}}); }}});
  ["DcMotor","Servo","CRServo","VoltageSensor","TouchSensor","ColorSensor","DistanceSensor","AnalogInput","DigitalChannel","LED","DcMotorController","ServoController"]
    .forEach(k=>d(JV_HW+"HardwareMap.DeviceMapping."+k,Object.assign({sup:JV_HW+"HardwareMap.DeviceMapping"},DEVMAP(k))));
  // devices
  d(JV_HW+"HardwareDevice",{kind:"interface"});
  ["DcMotorSimple","DcMotor","DcMotorEx","Servo","ServoImplEx","CRServo","DistanceSensor","ColorSensor","NormalizedColorSensor","TouchSensor","DigitalChannel","AnalogInput","VoltageSensor","PwmControl","LED"]
    .forEach(n=>{ if(!N[JV_HW+n]) d(JV_HW+n,{kind:"interface",ifs:[JV_HW+"HardwareDevice"].concat((JV_HW_EXTENDS[n]||[]).map(x=>JV_HW+x))}); });
  en(JV_HW+"DcMotorSimple.Direction",["FORWARD","REVERSE"],JV_HW+"DcMotorSimple",{m:{inverted(vm,o){ return vm.enumConst(JV_HW+"DcMotorSimple.Direction",o.__en==="FORWARD"?"REVERSE":"FORWARD"); }}});
  en(JV_HW+"DcMotor.RunMode",["RUN_WITHOUT_ENCODER","RUN_USING_ENCODER","RUN_TO_POSITION","STOP_AND_RESET_ENCODER","RESET_ENCODERS","RUN_USING_ENCODERS","RUN_WITHOUT_ENCODERS"],JV_HW+"DcMotor");
  en(JV_HW+"DcMotor.ZeroPowerBehavior",["UNKNOWN","BRAKE","FLOAT"],JV_HW+"DcMotor");
  en(JV_HW+"Servo.Direction",["FORWARD","REVERSE"],JV_HW+"Servo");
  en(JV_HW+"DigitalChannel.Mode",["INPUT","OUTPUT"],JV_HW+"DigitalChannel");
  d(JV_HW+"DcMotorImplEx",{ifs:[JV_HW+"DcMotorEx",JV_HW+"DcMotor",JV_HW+"DcMotorSimple"],alsoIs:["DcMotorEx","DcMotor","DcMotorSimple","DcMotorImpl","HardwareDevice"],m:JV_MOTOR_M});
  d(JV_HW+"ServoImplEx",{ifs:[JV_HW+"Servo"],alsoIs:["Servo","ServoImpl","PwmControl","HardwareDevice"],m:JV_SERVO_M});
  d(JV_HW+"CRServoImplEx",{ifs:[JV_HW+"CRServo"],alsoIs:["CRServo","DcMotorSimple","CRServoImpl","PwmControl","HardwareDevice"],m:JV_CRSERVO_M});
  d("com.qualcomm.hardware.rev.RevIMU_",{ifs:[JV_HW+"IMU"],alsoIs:["IMU","BHI260IMU","BNO055IMUNew","HardwareDevice"],m:JV_IMU_M});
  d("com.qualcomm.hardware.bosch.BNO055IMUImpl",{ifs:["com.qualcomm.hardware.bosch.BNO055IMU"],alsoIs:["BNO055IMU","HardwareDevice"],m:JV_BNO_M});
  d("com.qualcomm.hardware.gobilda.GoBildaPinpointDriver",{alsoIs:["GoBildaPinpointDriver","HardwareDevice"],m:JV_PINPOINT_M});
  en("com.qualcomm.hardware.gobilda.GoBildaPinpointDriver.EncoderDirection",["FORWARD","REVERSED"],"com.qualcomm.hardware.gobilda.GoBildaPinpointDriver");
  en("com.qualcomm.hardware.gobilda.GoBildaPinpointDriver.GoBildaOdometryPods",["goBILDA_SWINGARM_POD","goBILDA_4_BAR_POD"],"com.qualcomm.hardware.gobilda.GoBildaPinpointDriver");
  en("com.qualcomm.hardware.gobilda.GoBildaPinpointDriver.DeviceStatus",["NOT_READY","READY","CALIBRATING","FAULT_X_POD_NOT_DETECTED","FAULT_Y_POD_NOT_DETECTED","FAULT_NO_PODS_DETECTED","FAULT_IMU_RUNAWAY","FAULT_BAD_READ"],"com.qualcomm.hardware.gobilda.GoBildaPinpointDriver");
  en("com.qualcomm.hardware.gobilda.GoBildaPinpointDriver.ReadData",["ONLY_UPDATE_HEADING"],"com.qualcomm.hardware.gobilda.GoBildaPinpointDriver");
  d("com.qualcomm.hardware.sparkfun.SparkFunOTOS",{alsoIs:["SparkFunOTOS","HardwareDevice"],m:JV_OTOS_M});
  d("com.qualcomm.hardware.rev.Rev2mDistanceSensor",{ifs:[JV_HW+"DistanceSensor"],alsoIs:["DistanceSensor","Rev2mDistanceSensor","HardwareDevice"],m:JV_DIST_M});
  d("com.qualcomm.hardware.rev.RevColorSensorV3",{ifs:[JV_HW+"ColorSensor",JV_HW+"NormalizedColorSensor",JV_HW+"DistanceSensor"],alsoIs:["ColorSensor","NormalizedColorSensor","DistanceSensor","RevColorSensorV3","ColorRangeSensor","HardwareDevice"],m:JV_COLOR_M});
  ["com.qualcomm.hardware.rev.RevTouchSensor",JV_HW+"DigitalChannelImpl",JV_HW+"AnalogInput",JV_HW+"VoltageSensor_","com.qualcomm.hardware.lynx.LynxModule","com.qualcomm.hardware.limelightvision.Limelight3A",JV_HW+"LED"]
    .forEach(f=>{ if(!N[f]) d(f,{alsoIs:["TouchSensor","DigitalChannel","AnalogInput","VoltageSensor","LynxModule","Limelight3A","HardwareDevice"].filter(x=>f.indexOf(x)>=0||(x==="VoltageSensor"&&/Voltage/.test(f))||x==="HardwareDevice"),m:JV_SENSOR_M}); });
  N["com.qualcomm.hardware.lynx.LynxModule"].alsoIs=["LynxModule","HardwareDevice"];
  en("com.qualcomm.hardware.lynx.LynxModule.BulkCachingMode",["OFF","AUTO","MANUAL"],"com.qualcomm.hardware.lynx.LynxModule");
  d(JV_HW+"configuration.typecontainers.MotorConfigurationType",{m:{getTicksPerRev(vm,o){ return o.n.tpr; }, getMaxRPM(vm,o){ return o.n.rpm; }, getAchieveableMaxRPMFraction(){ return 0.85; },
    getAchieveableMaxTicksPerSecond(vm,o){ return o.n.tpr*o.n.rpm/60*0.85; }, getAchieveableMaxTicksPerSecondRounded(vm,o){ return Math.round(o.n.tpr*o.n.rpm/60*0.85); }, clone(vm,o){ return o; },
    setAchieveableMaxRPMFraction(){}, getGearing(){ return 1; }, getName(){ return "sim motor"; }}});
  // gamepad
  d("com.qualcomm.robotcore.hardware.Gamepad",{
    ctor(vm,o){ o.n={live:0,snap:{},edge:{}}; },
    has(n){ return JV_PAD_FIELDS.indexOf(n)>=0; },
    get(vm,o,n){ if(JV_PAD_FIELDS.indexOf(n)<0) return undefined; return jvPadRaw(vm,o,n); },
    set(vm,o,n,v){ o.n.snap[JV_PAD_ALIAS[n]||n]=v; },
    m:{copy(vm,o,a){ const src=a[0]; if(!src||!src.n) return; const snap={}; for(const f of JV_PAD_FIELDS) snap[JV_PAD_ALIAS[f]||f]=jvPadRaw(vm,src,f); o.n.snap=snap; o.n.live=0; },
      fromByteArray(){}, toByteArray(){ return []; },
      rumble(vm,o,a){ if(vm.host&&vm.host.rumble) vm.host.rumble(o.n.live,"rumble",a.map(jvArg)); }, rumbleBlips(vm,o,a){ if(vm.host&&vm.host.rumble) vm.host.rumble(o.n.live,"rumbleBlips",a.map(jvArg)); },
      stopRumble(vm,o){ if(vm.host&&vm.host.rumble) vm.host.rumble(o.n.live,"stopRumble",[]); }, isRumbling(){ return false; }, runRumbleEffect(){}, setLedColor(){}, runLedEffect(){},
      atRest(vm,o){ return ["left_stick_x","left_stick_y","right_stick_x","right_stick_y","left_trigger","right_trigger"].every(f=>Math.abs(jvPadRaw(vm,o,f))<0.05); },
      getGamepadId(vm,o){ return o.n.live; }, getUser(){ return null; }, type(){ return null; }, reset(vm,o){ o.n.snap={}; }, toString(){ return "gamepad"; }},
    any(vm,o,name){ const r=jvPadEdge(vm,o,name); if(r!==undefined) return r; vm.note("Gamepad."+name); return 0; }});
  // telemetry
  d("org.firstinspires.ftc.robotcore.external.Telemetry",{kind:"interface",m:JV_TEL_M});
  d("org.firstinspires.ftc.robotcore.internal.Telemetry_",{ifs:["org.firstinspires.ftc.robotcore.external.Telemetry"],m:JV_TEL_M});
  d("com.acmerobotics.dashboard.telemetry.MultipleTelemetry",{ctor(){},ifs:["org.firstinspires.ftc.robotcore.external.Telemetry"],m:JV_TEL_M});
  d("com.pedropathing.telemetry.JoinedTelemetry",{ctor(){},ifs:["org.firstinspires.ftc.robotcore.external.Telemetry"],m:JV_TEL_M});
  d("org.firstinspires.ftc.robotcore.external.Telemetry.Item",{any(vm,o){ return o; }});
  d("org.firstinspires.ftc.robotcore.external.Telemetry.Line",{m:{*addData(vm,o,a){ return yield* JV_TEL_M.addData(vm,o,a); }},any(vm,o){ return o; }});
  d("org.firstinspires.ftc.robotcore.external.Telemetry.Log",{m:{*add(vm,o,a){ jvTelAdd(vm,a.length>1&&typeof a[0]==="string"?jvFormat(a[0],a.slice(1)):yield* vm.str(a[0])); }, clear(){}, setCapacity(){}, setDisplayOrder(){}}});
  en("org.firstinspires.ftc.robotcore.external.Telemetry.DisplayFormat",["CLASSIC","MONOSPACE","HTML"],"org.firstinspires.ftc.robotcore.external.Telemetry");
  // time
  d("com.qualcomm.robotcore.util.ElapsedTime",{
    ctor(vm,o,a){ const r=a.find(x=>x&&x.__en); const n=a.find(x=>typeof x==="number");
      o.n={t0:(vm.host?vm.host.now():0)-(n?n/1e9:0),res:r?r.__en:"SECONDS"}; },
    m:{reset(vm,o){ o.n.t0=vm.host?vm.host.now():0; }, seconds(vm,o){ return (vm.host?vm.host.now():0)-o.n.t0; }, milliseconds(vm,o){ return ((vm.host?vm.host.now():0)-o.n.t0)*1000; },
      nanoseconds(vm,o){ return Math.round(((vm.host?vm.host.now():0)-o.n.t0)*1e9); }, microseconds(vm,o){ return ((vm.host?vm.host.now():0)-o.n.t0)*1e6; },
      time(vm,o,a){ const s=(vm.host?vm.host.now():0)-o.n.t0; const u=jvEn(a[0]); if(u) return s*({NANOSECONDS:1e9,MICROSECONDS:1e6,MILLISECONDS:1e3,SECONDS:1,MINUTES:1/60}[u]||1); return o.n.res==="MILLISECONDS"?s*1000:s; },
      startTime(vm,o){ return o.n.res==="MILLISECONDS"?o.n.t0*1000:o.n.t0; }, startTimeNanoseconds(vm,o){ return Math.round(o.n.t0*1e9); },
      now(vm,o,a){ const s=vm.host?vm.host.now():0; const u=jvEn(a[0]); return u==="MILLISECONDS"?s*1000:u==="NANOSECONDS"?s*1e9:s; },
      getResolution(vm,o){ return vm.enumConst("com.qualcomm.robotcore.util.ElapsedTime.Resolution",o.n.res); }, log(){}, toString(vm,o){ return ((vm.host?vm.host.now():0)-o.n.t0).toFixed(4)+" seconds"; }}});
  en("com.qualcomm.robotcore.util.ElapsedTime.Resolution",["SECONDS","MILLISECONDS"],"com.qualcomm.robotcore.util.ElapsedTime");
  d("com.qualcomm.robotcore.util.Range",{s:{clip(vm,a){ return Math.max(a[1],Math.min(a[2],a[0])); }, scale(vm,a){ const [n,x1,x2,y1,y2]=a.map(jvNum); return y1+(n-x1)*(y2-y1)/(x2-x1||1); }, throwIfRangeIsInvalid(){}}});
  d("com.qualcomm.robotcore.hardware.configuration.LynxConstants",{s:{isEmbeddedSerialNumber(vm,a){ return a[0]==="(embedded)"; }}});
  d("com.qualcomm.robotcore.util.RobotLog",{s:{}, });
  N["com.qualcomm.robotcore.util.RobotLog"].sany=true;
  // a direct line to the sim for the Java libraries below (tick, odometry)
  d("simbench.Sim",{s:{tick(){ return {__block:{gate:true}}; }, now(vm){ return vm.host?vm.host.now():0; }, heading(vm){ return vm.host?vm.host.heading():0; },
    *mecanum(vm,a){ // a: [lf, lb, rb, rf] motors, then the four powers in that order (normalised by the caller)
      for(let k=0;k<4;k++) if(a[k]) yield* vm.invoke(a[k],"setPower",[jvNum(a[k+4])],null); }}});
  return N;
}
function jvRand(n){ n.seed^=n.seed<<13; n.seed>>>=0; n.seed^=n.seed>>>17; n.seed^=n.seed<<5; n.seed>>>=0; return n.seed/4294967296; }
/* A gate: opModeIsActive() and friends end a tick, once per run of code */
function jvGate(vm,value){
  if(vm.steps===vm.gateMark) return value();
  return {__block:{gate:true},then(){ vm.gateMark=vm.steps; return value(); }};
}
function jvDevMapItems(vm,kind){
  const out=[]; if(vm.dev) for(const [,d] of vm.dev) if(d&&d.n&&JV_DEV_KIND[kind]===d.n.kind) out.push(d);
  if(!out.length&&JV_DEV_KIND[kind]==="voltage") out.push(jvDrain(jvGetDevice(vm,"VoltageSensor","Control Hub","VoltageSensor")));
  return out;
}
function jvMathStatics(){
  const ints=(vm,a)=>a;
  void ints;
  return {abs(vm,a){ return Math.abs(jvNum(a[0])); }, max(vm,a){ return Math.max(jvNum(a[0]),jvNum(a[1])); }, min(vm,a){ return Math.min(jvNum(a[0]),jvNum(a[1])); },
    signum(vm,a){ return Math.sign(jvNum(a[0])); }, sqrt(vm,a){ return Math.sqrt(jvNum(a[0])); }, cbrt(vm,a){ return Math.cbrt(jvNum(a[0])); },
    pow(vm,a){ return Math.pow(jvNum(a[0]),jvNum(a[1])); }, sin(vm,a){ return Math.sin(jvNum(a[0])); }, cos(vm,a){ return Math.cos(jvNum(a[0])); }, tan(vm,a){ return Math.tan(jvNum(a[0])); },
    asin(vm,a){ return Math.asin(jvNum(a[0])); }, acos(vm,a){ return Math.acos(jvNum(a[0])); }, atan(vm,a){ return Math.atan(jvNum(a[0])); }, atan2(vm,a){ return Math.atan2(jvNum(a[0]),jvNum(a[1])); },
    sinh(vm,a){ return Math.sinh(jvNum(a[0])); }, cosh(vm,a){ return Math.cosh(jvNum(a[0])); }, tanh(vm,a){ return Math.tanh(jvNum(a[0])); },
    hypot(vm,a){ return Math.hypot(jvNum(a[0]),jvNum(a[1])); }, floor(vm,a){ return Math.floor(jvNum(a[0])); }, ceil(vm,a){ return Math.ceil(jvNum(a[0])); },
    round(vm,a){ return Math.floor(jvNum(a[0])+0.5); }, rint(vm,a){ const v=jvNum(a[0]), f=Math.floor(v), d=v-f; return d===0.5?(f%2===0?f:f+1):Math.round(v); },
    toRadians(vm,a){ return jvNum(a[0])*Math.PI/180; }, toDegrees(vm,a){ return jvNum(a[0])*180/Math.PI; }, exp(vm,a){ return Math.exp(jvNum(a[0])); },
    log(vm,a){ return Math.log(jvNum(a[0])); }, log10(vm,a){ return Math.log10(jvNum(a[0])); }, log1p(vm,a){ return Math.log1p(jvNum(a[0])); }, expm1(vm,a){ return Math.expm1(jvNum(a[0])); },
    random(vm){ const n=vm.rand||(vm.rand={seed:12345}); return jvRand(n); }, copySign(vm,a){ return Math.sign(jvNum(a[1])||1)*Math.abs(jvNum(a[0])); },
    floorMod(vm,a){ const x=jvNum(a[0]), y=jvNum(a[1]); return ((x%y)+y)%y; }, floorDiv(vm,a){ return Math.floor(jvNum(a[0])/jvNum(a[1])); },
    clamp(vm,a){ return Math.max(jvNum(a[1]),Math.min(jvNum(a[2]),jvNum(a[0]))); }, ulp(){ return 2.220446049250313e-16; }, toIntExact(vm,a){ return Math.trunc(jvNum(a[0])); },
    addExact(vm,a){ return jvNum(a[0])+jvNum(a[1]); }, multiplyExact(vm,a){ return jvNum(a[0])*jvNum(a[1]); }, negateExact(vm,a){ return -jvNum(a[0]); }, nextUp(vm,a){ return jvNum(a[0]); }};
}
function jvBoxStatics(isInt){
  return {parseInt(vm,a){ const v=parseInt(a[0],a[1]||10); if(isNaN(v)) throw vm.jthrow("NumberFormatException","For input string: \""+a[0]+"\""); return v; },
    parseLong(vm,a){ return parseInt(a[0],10); },
    parseDouble(vm,a){ const v=parseFloat(a[0]); if(isNaN(v)&&String(a[0]).trim()!=="NaN") throw vm.jthrow("NumberFormatException","For input string: \""+a[0]+"\""); return v; },
    parseFloat(vm,a){ return parseFloat(a[0]); },
    valueOf(vm,a){ return typeof a[0]==="string"?(isInt?parseInt(a[0],10):parseFloat(a[0])):a[0]; },
    toString(vm,a){ return jvNumStr(jvNum(a[0]),isInt); }, compare(vm,a){ return a[0]<a[1]?-1:a[0]>a[1]?1:0; },
    max(vm,a){ return Math.max(a[0],a[1]); }, min(vm,a){ return Math.min(a[0],a[1]); }, sum(vm,a){ return a[0]+a[1]; }, signum(vm,a){ return Math.sign(a[0]); },
    abs(vm,a){ return Math.abs(a[0]); }, isNaN(vm,a){ return isNaN(a[0]); }, isInfinite(vm,a){ return !isFinite(a[0])&&!isNaN(a[0]); }, isFinite(vm,a){ return isFinite(a[0]); },
    toHexString(vm,a){ return (a[0]>>>0).toString(16); }, toBinaryString(vm,a){ return (a[0]>>>0).toString(2); }, hashCode(vm,a){ return Math.trunc(a[0]); },
    doubleToLongBits(vm,a){ return a[0]; }, bitCount(vm,a){ let v=a[0]>>>0,c=0; while(v){ c+=v&1; v>>>=1; } return c; }};
}
