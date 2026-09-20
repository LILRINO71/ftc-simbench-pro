/* ============================================================
   5b. ROBOT CONFIGURATION  — the .xml the Robot Controller keeps
   Every hardwareMap.get("name") in an OpMode has to match a device
   in this file, by exact name and compatible type, or the OpMode
   throws during INIT. CAD can't check that; this can.
   ============================================================ */

/* Kind of device a configuration tag describes. Tags vary by SDK version and
   vendor (goBILDA5202SeriesMotor, RevRobotics20HDHexMotor, ContinuousRotationServo,
   ControlHubImuBHI260AP …), so classify by what the name says. */
function configKind(tag){
  const t=String(tag).toLowerCase();
  if(/continuousrotationservo|crservo/.test(t)) return "crservo";
  if(/servo/.test(t)) return "servo";
  if(/motor/.test(t)) return "motor";
  if(/imu|bno055|bhi260|navx|gyro/.test(t)) return "imu";
  if(/webcam|camera/.test(t)) return "camera";
  return "other";
}
/* Kind of device a Java type asks for. */
function codeKind(type){
  const t=String(type||"").toLowerCase();
  if(!t||t==="?") return null;
  if(/crservo/.test(t)) return "crservo";
  if(/servo/.test(t)) return "servo";
  if(/dcmotor/.test(t)) return "motor";
  if(/imu|bno055|navx|gyro/.test(t)) return "imu";
  if(/webcam|camera/.test(t)) return "camera";
  return "other";
}

function parseRobotConfig(xml){
  // a device commented out of the file is not configured
  const text=String(xml).replace(/<!--[\s\S]*?-->/g,"");
  if(!/<\s*Robot\b/.test(text)) throw new Error("not a Robot Controller configuration (no <Robot> element)");
  const devices=[], modules=[], stack=[];
  const attrsOf=s=>{ const o={}; let a; const ra=/([\w:.-]+)\s*=\s*"([^"]*)"/g; while((a=ra.exec(s))) o[a[1]]=a[2]; return o; };
  const re=/<(\/)?\s*([A-Za-z_][\w.:-]*)\b([^>]*?)(\/)?\s*>/g;
  let m;
  while((m=re.exec(text))){
    const closing=!!m[1], tag=m[2], selfClose=!!m[4];
    if(closing){
      for(let i=stack.length-1;i>=0;i--) if(stack[i].tag===tag){ stack.length=i; break; }
      continue;
    }
    const at=attrsOf(m[3]);
    if(!selfClose){
      stack.push({tag, name:at.name||null});
      if(tag==="LynxModule") modules.push({name:at.name||"module", port:at.port!=null?+at.port:null});
      continue;
    }
    if(at.name==null) continue;
    let mod=null;
    for(let i=stack.length-1;i>=0;i--) if(stack[i].tag==="LynxModule"){ mod=stack[i].name; break; }
    devices.push({tag, name:at.name, kind:configKind(tag),
      port:at.port!=null?+at.port:null, bus:at.bus!=null?+at.bus:null, module:mod});
  }
  return {devices, modules};
}

/* Findings for an OpMode against a configuration. Same shape as analyze(). */
function checkRobotConfig(code, cfg){
  const F=[];
  const add=(key,sev,title,body,math,fix)=>F.push({key,sev,title,body,math,fix});
  const exact={}, folded={};
  for(const d of cfg.devices){ exact[d.name]=d; folded[d.name.toLowerCase()]=d; }
  const used={};
  const TYPED={servo:1,crservo:1,motor:1,imu:1};
  const where=d=>(d.module?d.module+" · ":"")+(d.bus!=null?"I²C bus "+d.bus:d.port!=null?"port "+d.port:"");
  const ok=[];
  let problems=0;
  for(const d of code.devices){
    if(!d.cfg) continue;
    const hit=exact[d.cfg];
    if(hit){
      used[hit.name]=1;
      const ck=codeKind(d.type);
      if(TYPED[ck]&&TYPED[hit.kind]&&ck!==hit.kind){
        problems++;
        add("cfgtype:"+d.name,"fail",
          "<code>\""+d.cfg+"\"</code> is configured as a "+hit.kind+" but the code asks for a "+d.type,
          "The name matches, so the lookup gets past the first check, but the device on <b>"+where(hit)+"</b> is a <b>"+hit.tag+"</b>. "+
          (ck==="servo"&&hit.kind==="crservo" ? "A continuous-rotation servo can't hold a position — <code>setPosition</code> sets its speed." :
           "The SDK rejects the lookup when the type doesn't fit, and the OpMode stops during INIT."),
          null,
          "Change the configured type on the Driver Station, or change the Java type to match the hardware.");
      } else ok.push(("\""+d.cfg+"\"").padEnd(18)+where(hit).padEnd(26)+hit.tag);
      continue;
    }
    const near=folded[d.cfg.toLowerCase()];
    if(near){
      used[near.name]=1; problems++;
      add("cfgcase:"+d.name,"fail",
        "<code>\""+d.cfg+"\"</code> doesn't match <code>\""+near.name+"\"</code> — names are case-sensitive",
        "The configuration has a device that differs only in capitalisation. <code>hardwareMap</code> compares names exactly, so the lookup fails and the OpMode stops during INIT.",
        null, "Use <code>\""+near.name+"\"</code> in the code, or rename the device in the configuration.");
      continue;
    }
    problems++;
    add("cfgmiss:"+d.name,"fail",
      "<code>\""+d.cfg+"\"</code> isn't in the robot configuration",
      "<code>hardwareMap</code> throws when it can't find a name, so the OpMode stops during INIT before anything moves.",
      null, "Add <code>"+d.cfg+"</code> to the configuration on the Driver Station, or fix the name in the code.");
  }
  const unused=cfg.devices.filter(d=>!used[d.name]&&d.kind!=="camera"&&d.kind!=="imu");
  if(unused.length)
    add("cfgunused","info",unused.length+" configured device"+(unused.length>1?"s":"")+" this OpMode never uses",
      "Not a problem on its own — another OpMode may use them. Worth a look if you expected one of these to move.",
      unused.map(d=>("\""+d.name+"\"").padEnd(18)+where(d).padEnd(26)+d.tag).join("\n"), null);
  if(!problems && code.devices.some(d=>d.cfg))
    add("cfgok","pass","Every hardwareMap name matches the robot configuration",
      "Names match exactly and every servo, motor and IMU is the type the code expects.",
      ok.join("\n"), null);
  return F;
}
