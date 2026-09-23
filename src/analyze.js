/* ============================================================
   6.  ANALYSIS
   ============================================================ */
function analyze(code,cad,map,opts){
  const F=[];
  const add=(key,sev,title,body,math,fix)=>F.push({key,sev,title,body,math,fix});
  const mechOf = n => cad.mechs.filter(m=>m.id===map[n])[0] || null;
  const payload=opts.payloadKg, duty=opts.duty, trust=opts.trust;
  const SERVO_MASS=0.060, LINK_MASS=0.055;

  if(!code.kind) add("struct:anno","warn","No OpMode annotation",
    "Nothing marked <code>@TeleOp</code> or <code>@Autonomous</code>, so this class won't appear on the Driver Station list.",null,
    "Add <code>@TeleOp(name = \"…\")</code> above the class.");
  const hasAuto = code.auto && code.auto.length>0;
  if(!code.hasLoop && !hasAuto) add("struct:loop","fail","Nothing to run after START",
    "The bench couldn't find a <code>while (opModeIsActive())</code> loop, a <code>loop()</code> method, or any statements after <code>waitForStart()</code>.",null,
    "Check the class structure — everything below is based on whatever it could read.");
  else if(!code.hasWait&&code.kind==="TeleOp"&&!/void\s+loop\s*\(/.test(code.src||"")) add("struct:wait","fail","Missing waitForStart()",
    "A LinearOpMode that never calls <code>waitForStart()</code> runs its loop during init and is stopped by the SDK.",null,
    "Call <code>waitForStart();</code> before the main loop.");
  if(!code.devices.length) add("struct:dev","warn","No hardware devices found",
    "No <code>hardwareMap</code> lookups were recognized, so there is nothing to simulate.",null,
    "The parser understands <code>hardwareMap.get(Type.class, \"name\")</code> and <code>hardwareMap.servo.get(\"name\")</code>.");

  for(const d of code.devices){
    if(!/Servo|DcMotor/i.test(d.type||"")) continue;          // sensors are read, not driven
    if(!isCommanded(code,d.name)) add("idle:"+d.name,"warn","<code>"+d.name+"</code> is never commanded",
      "It's declared and pulled out of <code>hardwareMap</code>, but nothing in the loop moves it.",null,
      "Bind it to a control, or drop the declaration.");
  }

  // ---- torque on lift joints
  for(const d of code.devices){
    const mech=mechOf(d.name); if(!mech||mech.kind!=="revolute-lift") continue;
    const lever=leverOf(mech); if(!(lever>0)) continue;
    const spec=specFor(d,mech,trust);
    if(spec.kind!=="servo") continue;
    const distal=payload+SERVO_MASS+LINK_MASS;
    const rng=travelRange(code,d.name)||{lo:0.5,hi:0.5};
    const rest=restPosOf(code,d.name);
    const a0=armAngleDeg(mech,spec,rng.lo,rest), a1=armAngleDeg(mech,spec,rng.hi,rest);
    const wa=worstAngle(a0,a1);
    const req=holdTorque(mech,wa,distal);
    const usable=spec.stallNm*duty;
    const ratio=usable/req;
    const sev=ratio<1?"fail":(ratio<1.35?"warn":"pass");
    const crosses=(Math.min(a0,a1)<=0&&Math.max(a0,a1)>=0);
    const math=
`joint     ${mlabel(mech)}  (lift)
servo     ${spec.part||spec.fam}  [${spec.role}]
source    ${spec.src}${spec.guess?"  (estimated spec)":""}
lever     ${(lever*1000).toFixed(0)} mm${mech.leverOverride!=null?"  ← your value":"  measured from CAD"}
sweep     ${a0.toFixed(0)}° → ${a1.toFixed(0)}°  off horizontal
worst     ${wa.toFixed(0)}°${crosses?"  — sweeps through level":""}
load      ${(distal*1000).toFixed(0)} g = ${(payload*1000).toFixed(0)} held + 60 servo + 55 link
needed    ${req.toFixed(3)} N·m   m·g·r·cos θ
usable    ${usable.toFixed(3)} N·m   ${spec.stallNm.toFixed(2)} stall × ${(duty*100).toFixed(0)}%
headroom  ${ratio.toFixed(2)}×${ratio<1?"  ◄ SHORT":""}`;
    if(sev==="fail")
      add("torque:"+d.name,"fail","The "+mlabel(mech).toLowerCase()+" servo cannot hold the load it's carrying",
        "<code>"+d.name+"</code> drives a <b>"+(lever*1000).toFixed(0)+" mm</b> lever with the end effector on it. "+
        "The <b>"+spec.role.toLowerCase()+"</b> servo here gives <b>"+usable.toFixed(2)+" N·m</b> usable against <b>"+
        req.toFixed(2)+" N·m</b> needed. It will buzz, sag under load, or refuse to lift.",math,
        "Fit a higher-torque servo, shorten the lever, or add a counterbalance spring at the pivot.");
    else if(sev==="warn")
      add("torque:"+d.name,"warn","The "+mlabel(mech).toLowerCase()+" joint has very little torque margin",
        "Headroom is <b>"+ratio.toFixed(2)+"×</b>. It will lift on a fresh battery and start sagging as voltage drops.",math,
        "Move to a higher-torque servo or reduce the payload.");
    else
      add("torque:"+d.name,"pass","The "+mlabel(mech).toLowerCase()+" joint has torque headroom",
        "<b>"+ratio.toFixed(2)+"×</b> margin between what the servo can hold and what the joint demands.",math,null);
  }

  // ---- code vs CAD hardware disagreement
  const swaps=[];
  for(const d of code.devices){
    const mech=mechOf(d.name); if(!mech||!mech.part) continue;
    const cadSpec=hwFromPart(mech.part,mech.partName); if(!cadSpec) continue;
    if(d.declaredRole && cadSpec.kind==="servo" && cadSpec.role!==d.declaredRole)
      swaps.push({dev:d, mech, cadSpec, kindClash:false});
    else if(/DcMotor/i.test(d.type||"") && cadSpec.kind==="servo")
      swaps.push({dev:d, mech, cadSpec, kindClash:true});
    else if(/Servo/i.test(d.type||"") && !/CRServo/i.test(d.type||"") && cadSpec.kind==="motor")
      swaps.push({dev:d, mech, cadSpec, kindClash:true});
  }
  if(swaps.length){
    const rows=swaps.map(s=>{
      const said=s.kindClash? s.dev.type : s.dev.declaredRole;
      const has =s.kindClash? (s.cadSpec.kind==="servo"?"a servo":"a motor") : s.cadSpec.role;
      return (s.dev.name+"        ").slice(0,9)+"code says "+(said+"       ").slice(0,8)+
             "│ CAD has "+(has+"       ").slice(0,8)+"("+s.mech.part+")"; }).join("\n");
    if(trust==="code")
      add("swap","info","The CAD disagrees with your code about "+swaps.length+" device"+(swaps.length>1?"s":""),
        "Hardware truth is set to <b>code</b>, so the bench is using your declarations and comments and ignoring these part numbers. "+
        "Worth knowing the model is out of date, but nothing above depends on it.",rows,
        "Update the CAD when you get a chance, or switch hardware truth to CAD to see what the model implies.");
    else
      add("swap","fail","Your code and your CAD disagree about which servo is which",
        swaps.length+" device"+(swaps.length>1?"s are":" is")+" declared as one type but modelled as another. "+
        "Hardware truth is set to <b>CAD</b>, so the numbers above use the part numbers.",rows,
        "Switch hardware truth to <b>code</b> if the CAD is the stale one.");
  }

  // ---- travel sweeps
  for(const d of code.devices){
    const r=travelRange(code,d.name); if(!r||r.n<2) continue;
    const mech=mechOf(d.name);
    const spec=specFor(d,mech,trust);
    if(spec.kind!=="servo") continue;
    const span=r.hi-r.lo, deg=span*travelDegOf(spec);
    if(span<0.05)
      add("travel:"+d.name,"warn","<code>"+d.name+"</code> barely moves",
        "Commanded positions span only <b>"+span.toFixed(2)+"</b> &mdash; about <b>"+deg.toFixed(0)+"°</b>. If the mechanism isn't reaching, this is why.",null,
        "Widen the two constants and check the mechanism clears its frame.");
    else
      add("travel:"+d.name,"info","<code>"+d.name+"</code> sweeps "+deg.toFixed(0)+"°",
        "Travel <b>"+r.lo.toFixed(2)+" → "+r.hi.toFixed(2)+"</b> on a "+travelDegOf(spec)+"° servo.",null,null);
  }

  // ---- a blocking wait inside the TeleOp loop freezes the whole robot
  const sleeps=[];
  (function findSleep(list,ctx){ for(const st of list){
    if(st.kind==="if"){
      const r=padRefs(st.condAst).map(splitPadRef).filter(Boolean)[0];
      findSleep(st.then, r?("gamepad"+r.pad+"."+r.btn):ctx);
      if(st.else) findSleep(st.else, ctx);
    } else if(st.kind==="sleep") sleeps.push({ms:st.ms, on:ctx});
  }})(code.stmts,null);
  if(sleeps.length){
    const bare=sleeps.filter(x=>!x.on), total=sleeps.reduce((a,x)=>a+(x.ms||0),0);
    const what="A LinearOpMode runs one thread. While a <code>sleep()</code> runs, nothing else in the loop does: "+
      "every motor keeps the last power it was given (the drive coasts on at whatever speed it had), no button is read, "+
      "and PID loops stop correcting. The bench runs it the same way: the loop stops for that long, then finishes the pass.";
    if(bare.length)
      add("sleep","warn","<code>sleep("+(bare[0].ms||"…")+")</code> runs on every pass of the loop",
        what+" This one isn't behind a button, so the robot answers the driver at most every <b>"+(bare.reduce((a,x)=>a+(x.ms||0),0)+20)+" ms</b>.",
        sleeps.map(x=>(x.on?x.on:"(every pass)")+"   sleep("+x.ms+")").join("\n"),
        "Drive the delay off a timer instead: latch a state, note the time, and act on it in a later pass of the same loop.");
    else
      add("sleep","info","<code>sleep()</code> on "+sleeps.map(x=>"<code>"+x.on+"</code>").join(", ")+" pauses the whole loop",
        what+" Pressing "+(sleeps.length===1?"it":"one")+" holds the robot's controls for <b>"+(sleeps.length===1?sleeps[0].ms:total)+" ms</b>.",
        sleeps.map(x=>x.on+"   sleep("+x.ms+")").join("\n"),
        "If the drive mustn't coast, run the sequence off a timer so the loop keeps going.");
  }

  // ---- buttons wired to nothing
  (function findEmpty(list){ for(const st of list){
    if(st.kind!=="if") continue;
    const r=padRefs(st.condAst).map(splitPadRef).filter(Boolean)[0];
    if(r && !st.then.length && !(st.else&&st.else.length))
      add("empty:"+r.pad+r.btn,"warn","<code>gamepad"+r.pad+"."+r.btn+"</code> is wired to an empty block",
        "The button is tested but the body does nothing, so pressing it has no effect.",null,
        "Fill it in or delete the block &mdash; an empty one reads like an unfinished binding.");
    findEmpty(st.then); if(st.else) findEmpty(st.else);
  }})(code.stmts);

  // ---- mirrored pairs: one of the two should be reversed, not both or neither
  const revd={};
  (function scanDir(list){ for(const st of list){
    if(st.kind==="if"){ scanDir(st.then); if(st.else) scanDir(st.else); }
    else if(st.kind==="objcall"&&st.meth==="setDirection")
      revd[st.obj]=/REVERSE/i.test(st.raw||"");
  }})(code.inits.concat(code.stmts));
  const pairs=[];
  for(const d of code.devices){
    const m=/^(.*?)(L|Left|left)$/.exec(d.name);
    if(!m) continue;
    const mate=code.devices.filter(x=>x.name===m[1]+"R"||x.name===m[1]+"Right"||x.name===m[1]+"right")[0];
    if(!mate) continue;
    pairs.push({a:d.name, b:mate.name, ra:!!revd[d.name], rb:!!revd[mate.name]});
  }
  const badPairs=pairs.filter(p=>p.ra===p.rb);
  if(badPairs.length)
    add("mirror","warn","A mirrored pair is set the same way round",
      "<b>"+badPairs.map(p=>p.a+"/"+p.b).join(", ")+"</b> read as a left/right pair, but "+
      (badPairs[0].ra?"both are reversed":"neither is reversed")+". A mirrored pair usually needs exactly one "+
      "<code>setDirection(REVERSE)</code>, or the two halves fight each other.",
      pairs.map(p=>(p.a+"        ").slice(0,10)+(p.ra?"REVERSED":"forward")+"   "+
                   (p.b+"        ").slice(0,10)+(p.rb?"REVERSED":"forward")).join("\n"),
      "Check how they're physically mounted — if they face opposite ways, one of them needs reversing.");
  else if(pairs.length)
    add("mirror","pass","Mirrored pairs are set opposite ways round",
      pairs.map(p=>"<b>"+p.a+"/"+p.b+"</b>").join(", ")+" &mdash; exactly one of each pair is reversed, which is what a mirrored mounting needs.",
      pairs.map(p=>(p.a+"        ").slice(0,10)+(p.ra?"REVERSED":"forward")+"   "+
                   (p.b+"        ").slice(0,10)+(p.rb?"REVERSED":"forward")).join("\n"),null);

  // ---- closed-loop motors
  const pidNames=[];
  for(const st of code.inits) if(st.kind==="pidnew") pidNames.push(st.obj);
  if(pidNames.length)
    add("pid","info",pidNames.length+" PID controller"+(pidNames.length>1?"s":"")+" driving motors",
      "The bench runs these closed loops for real: it integrates each motor's encoder from commanded power, feeds "+
      "<code>getCurrentPosition()</code> back in, and applies the output. Watch a target change and the motor chase it in the gauges.",
      pidNames.join("\n"),
      "Use it to check <b>which way</b> a target drives the mechanism and whether a button reaches the right one. "+
      "Don't tune gains here &mdash; the motor model has no inertia, gravity load or friction, so overshoot on the bench won't match the robot.");

  // ---- drivetrain
  const dt=detectDrivetrain(code);
  if(dt){
    if(!dt.ok)
      add("drive:names","warn","Drive motors don't name their side",
        "Found <b>"+dt.wheels.length+"</b> stick-driven motors, but their names don't say which are left and which are right, so the bench can't tell which way the robot will go.",
        dt.wheels.map(w=>w.dev).join("\n"),
        "Name them <code>leftFront</code> / <code>rightFront</code> and so on.");
    else
      add("drive:ok","pass",dt.style==="mecanum"?"Mecanum drive reads correctly":"Tank drive reads correctly",
        "<b>"+dt.wheels.length+"</b> motors mixing stick axes. Drive it with the left stick in the panel below and watch the base move.",
        dt.wheels.map(w=>(w.dev+"              ").slice(0,15)+w.stmt.expr).join("\n"),null);
    const allExpr=[];
    (function walk(l){ for(const st of l){
      if(st.kind==="if"){ walk(st.then); if(st.else) walk(st.else); }
      else if(st.expr) allExpr.push(st.expr); } })(code.stmts);
    const usesY=allExpr.some(e=>/left_stick_y/.test(e));
    const negY =allExpr.some(e=>/-\s*gamepad\d\s*\.\s*left_stick_y/.test(e));
    // try it: a private sim pushes the sticks on this robot (src/sim.js driveProbe)
    const pr=typeof driveProbe==="function"?driveProbe(code,cad,map,opts):null;
    if(pr) driveVerdict(pr,add);
    else if(usesY && !negY)
      add("drive:sticky","info","Check the sign on <code>left_stick_y</code>",
        "On a real gamepad, pushing the stick <b>forward reports a negative value</b>. Most drivetrains need <code>-gamepad1.left_stick_y</code> or the robot drives backwards.",null,null);
  }

  // ---- CAD mechanisms nothing drives
  const mapped={}; for(const k in map) if(map[k]) mapped[map[k]]=1;
  for(const mech of cad.mechs) if(!mapped[mech.id]){
    // drive hardware turns wheels; a cascade stage or gear is driven through its leader
    if(mech.drive||mech.couple) continue;
    const cadSpec=mech.part?hwFromPart(mech.part,mech.partName):null;
    const actuator=cadSpec&&/^(motor|servo|crservo)$/.test(cadSpec.kind);
    if(mech.fromMate&&mech.kind!=="fixed")
      add("unmapped:"+mech.id,"warn","The Onshape joint <b>"+mlabel(mech)+"</b> has nothing driving it",
        "It's a "+((JOINT_KINDS[mech.kind]||{label:mech.kind}).label)+" in your mates, but no device in this OpMode maps to it, so it stays where it was drawn.",null,
        "Pick the device that drives it in the hardware table.");
    else if(actuator||mech.hasActuator&&mech.kind!=="fixed")
      add("unmapped:"+mech.id,"warn","CAD has an actuator on <b>"+mlabel(mech)+"</b> with no code behind it",
        "The assembly mounts "+(cadSpec?"<code>"+mech.part+"</code>":"an actuator")+" on this mechanism, but no device in this OpMode maps to it.",null,
        "Map it in the hardware table, or add the device if it really is unused.");
  }

  if(cad.mechs.length){
    const chain=cad.mechs.map(m=>{
      const carries=rigCarries(cad.mechs,m.id);
      const dev=Object.keys(map).filter(k=>map[k]===m.id)[0];
      return (mlabel(m)+"            ").slice(0,13)+
             ((JOINT_KINDS[m.kind]||{label:String(m.kind)}).label+"              ").slice(0,15)+
             (dev?dev:"—").padEnd(10)+
             (carries.length? "swings "+carries.map(c=>mlabel(cad.mechs.filter(x=>x.id===c)[0])).join(", ") : "carries nothing");
    }).join("\n");
    add("rig","info","This is the chain the bench inferred",
      "Joint types and what-moves-with-what are guessed from the CAD &mdash; axis direction, height, and which subassembly holds each actuator. "+
      "On anything past a simple arm some of it will be wrong. Check it reads like your robot, and correct it in <b>Kinematics</b> if not.",
      chain, "Everything in that panel is editable: rename a joint, change its type, change what it moves with, or flip its direction.");
  }

  const cfgs=code.devices.filter(d=>d.cfg).map(d=>'"'+d.cfg+'"');
  if(opts.robotConfig) checkRobotConfig(code,opts.robotConfig).forEach(f=>F.push(f));
  else if(cfgs.length) add("cfg","info","Config names aren't checked yet",
    "This OpMode asks the Robot Controller for "+cfgs.join(", ")+". No CAD file can confirm those — but the robot's configuration file can.",null,
    "Load the configuration <code>.xml</code> from the Robot Controller (the <code>FIRST</code> folder on the Control Hub) and every name is checked exactly.");

  // ---- what the interpreter had to skip
  const cov=coverage(code);
  if(cov.skipped.length){
    const byWhy={};
    cov.skipped.forEach(s=>{ (byWhy[s.why]=byWhy[s.why]||[]).push(s); });
    add("coverage","info",cov.skipped.length+" line"+(cov.skipped.length>1?"s":"")+" the bench can't simulate",
      "It ran <b>"+cov.understood+" of "+cov.total+"</b> statements. The rest are skipped, not guessed at &mdash; if one of them moves the robot, the bench won't show it.",
      cov.skipped.slice(0,12).map(s=>("line "+(s.line||"?")).padEnd(9)+String(s.text).slice(0,46).padEnd(48)+s.why).join("\n")+
        (cov.skipped.length>12?"\n… and "+(cov.skipped.length-12)+" more":""),
      null);
  }

  const order={fail:0,warn:1,pass:2,info:3};
  F.sort((a,b)=>order[a.sev]-order[b.sev]);
  return F;
}
function restPosOf(code,devName){
  for(const i of code.inits) if(i.dev===devName&&i.op==="setPosition"){
    const v=staticValue(i.ast,code); if(v!==null) return v;
    if(i.ast&&i.ast.o==="id"&&code.vars[i.ast.v]!==undefined) return code.vars[i.ast.v];
  }
  const r=travelRange(code,devName); return r?r.lo:0.5;
}
