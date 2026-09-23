/* ============================================================
   4.  JAVA OPMODE PARSER  →  statement tree
   ============================================================ */
const DEVT="ServoImplEx|CRServo|Servo|DcMotorEx|DcMotor|AnalogInput|DigitalChannel|ColorSensor|DistanceSensor|TouchSensor|IMU|BNO055IMU";

function matchBlock(src,from){
  let d=0;
  for(let i=from;i<src.length;i++){
    const c=src[i];
    if(c==="{") d++;
    else if(c==="}"){ d--; if(!d) return [from+1,i]; }
  }
  return [from+1,src.length];
}
function stripComments(s){
  return s.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g," "))
          .replace(/\/\/[^\n]*/g,m=>" ".repeat(m.length));
}

/* Split a block into an ordered statement list, recursing into if/else.
   `base` is this block's offset in the whole file, so every statement can
   report its line. Anything the interpreter can't run becomes an "unknown"
   node with a reason — surfaced to the user, never silently dropped. */
function parseStatements(src, base, opts){
  base=base||0; opts=opts||{};
  const out=[]; let i=0;
  while(i<src.length){
    while(i<src.length && /\s/.test(src[i])) i++;
    if(i>=src.length) break;
    if(src[i]==="{"){ const r=matchBlock(src,i); out.push.apply(out,parseStatements(src.slice(r[0],r[1]),base+r[0],opts)); i=r[1]+1; continue; }
    const kw=/^(if|while|for|switch|do|try)\b/.exec(src.slice(i));
    if(kw){
      const at=base+i;
      if (kw[1]==="try") {
         let startBrace = src.indexOf("{", i);
         if (startBrace < 0) break;
         let r = matchBlock(src, startBrace);
         out.push.apply(out, parseStatements(src.slice(r[0], r[1]), base+r[0], opts));
         i = r[1]+1;
         while (i<src.length && /\s/.test(src[i])) i++;
         while (src.startsWith("catch", i) || src.startsWith("finally", i)) {
             let bStart = src.indexOf("{", i);
             if (bStart < 0) break;
             let bMatch = matchBlock(src, bStart);
             i = bMatch[1]+1;
             while (i<src.length && /\s/.test(src[i])) i++;
         }
         continue;
      }
      const lp=src.indexOf("(",i);
      if(lp<0||kw[1]==="do"){ out.push({kind:"unknown",at,text:src.slice(i,i+40).trim(),why:"do/while loops inside the OpMode aren't simulated"}); break; }
      let d=0,j=lp;
      for(;j<src.length;j++){ if(src[j]==="(")d++; else if(src[j]===")"){d--; if(!d)break;} }
      const cond=src.slice(lp+1,j);
      let k=j+1; while(k<src.length&&/\s/.test(src[k]))k++;
      let bodySrc,bodyAt,end;
      if(src[k]==="{"){ const r=matchBlock(src,k); bodySrc=src.slice(r[0],r[1]); bodyAt=base+r[0]; end=r[1]+1; }
      else { const sc=src.indexOf(";",k); if(sc<0) break; bodySrc=src.slice(k,sc+1); bodyAt=base+k; end=sc+1; }
      
      if(kw[1]==="for"){
        const parts = cond.split(";");
        const condStr = parts.length >= 2 ? parts[1].trim() : cond;
        if(opts.auto){
          out.push({kind:"while", at, cond:condStr, condAst:parseExpr(condStr), body:parseStatements(bodySrc,bodyAt)});
        }else{
          out.push({kind:"unknown",at,text:"for ("+cond.trim().slice(0,40)+")", why:"loops inside the OpMode loop aren't simulated"});
        }
        i=end; continue;
      }
      if(kw[1]==="switch"){
        let switchSrc = bodySrc;
        const caseRegex = /case\s+([^:]+):|default\s*:/g;
        let mCase, lastIndex = -1, lastCond = null;
        let caseBlocks = [];
        while ((mCase = caseRegex.exec(switchSrc))) {
           if (lastIndex !== -1) caseBlocks.push({cond: lastCond, src: switchSrc.slice(lastIndex, mCase.index)});
           lastCond = mCase[1] ? mCase[1].trim() : null;
           lastIndex = mCase.index + mCase[0].length;
        }
        if (lastIndex !== -1) caseBlocks.push({cond: lastCond, src: switchSrc.slice(lastIndex)});
        let elseStmts = [];
        let rootIf = null, currIf = null;
        for (let c=0; c<caseBlocks.length; c++) {
            let cb = caseBlocks[c];
            let bSrc = cb.src.replace(/break\s*;/g, "").trim();
            if (cb.cond === null) {
                elseStmts = parseStatements(bSrc, bodyAt + switchSrc.indexOf(cb.src));
            } else {
                let exprStr = cond + " == " + cb.cond;
                let ifNode = {kind:"if", at: base+i, cond: exprStr, condAst: parseExpr(exprStr), then: parseStatements(bSrc, bodyAt + switchSrc.indexOf(cb.src)), else: null};
                if (!rootIf) rootIf = ifNode; else currIf.else = [ifNode];
                currIf = ifNode;
            }
        }
        if (currIf) { currIf.else = elseStmts.length ? elseStmts : null; out.push(rootIf); }
        else out.push.apply(out, elseStmts);
        i=end; continue;
      }
      
      if(kw[1]!=="if"){
        // in an autonomous sequence a while loop is a wait: run the body each
        // tick until the condition goes false
        if(opts.auto && kw[1]==="while"){
          out.push({kind:"while", at, cond, condAst:parseExpr(cond), body:parseStatements(bodySrc,bodyAt)});
          i=end; continue;
        }
        out.push({kind:"unknown",at,text:kw[1]+" ("+cond.trim().slice(0,48)+")",
          why:"loops inside the OpMode loop aren't simulated"});
        i=end; continue;
      }
      // the sample autos wrap their whole sequence in `if (opModeIsActive())`
      if(opts.auto && /^\s*opModeIsActive\s*\(\s*\)\s*$/.test(cond)){
        out.push.apply(out,parseStatements(bodySrc,bodyAt,opts));
        i=end; continue;
      }
      let elseStmts=null, m2=end;
      while(m2<src.length&&/\s/.test(src[m2]))m2++;
      if(/^else\b/.test(src.slice(m2))){
        let k2=m2+4; while(k2<src.length&&/\s/.test(src[k2]))k2++;
        if(src[k2]==="{"){ const r=matchBlock(src,k2); elseStmts=parseStatements(src.slice(r[0],r[1]),base+r[0]); end=r[1]+1; }
        else { // else if … / single statement
          const rest=src.slice(k2);
          const stop=/^if\b/.test(rest)? findStatementEnd(rest) : rest.indexOf(";")+1;
          elseStmts=parseStatements(rest.slice(0,stop),base+k2); end=k2+stop;
        }
      }
      // `if (isStopRequested()) return;` is a guard for the real robot, not behaviour
      if(!/^\s*isStopRequested\s*\(\s*\)\s*$/.test(cond))
        out.push({kind:"if", at, cond, condAst:parseExpr(cond), then:parseStatements(bodySrc,bodyAt), else:elseStmts});
      i=end; continue;
    }
    const sc=src.indexOf(";",i);
    if(sc<0) break;
    const text=src.slice(i,sc).trim();
    const st=classifyStatement(text);
    if(st){ st.at=base+i; out.push(st); }
    i=sc+1;
  }
  return out;
}

/* Calls the simulator acts on, and calls that are safe to ignore. Anything
   else on a non-device object is reported as not simulated. */
const SIM_METHODS = /^(setDirection|setMode|setTargetPosition|setPID|setPIDF|setP|setI|setD|reset|resetYaw)$/;
const NOOP_METHODS = /^(initialize|clear|clearAll|addData|addLine|setMsTransmissionInterval|setAutoClear|setZeroPowerBehavior|setCaption|speak|log|getInstance|getTelemetry|close|setPwmEnable|setPwmDisable)$/;
/* On a gamepad: rumble reaches a plugged-in controller; the light bar has nowhere to go. */
const GAMEPAD_METHODS = /^(rumble|rumbleBlips|stopRumble|isRumbling|setLedColor|runLedEffect|runRumbleEffect)$/;
function findStatementEnd(rest){
  const lp=rest.indexOf("(");
  let d=0,j=lp;
  for(;j<rest.length;j++){ if(rest[j]==="(")d++; else if(rest[j]===")"){d--; if(!d)break;} }
  let k=j+1; while(k<rest.length&&/\s/.test(rest[k]))k++;
  if(rest[k]==="{"){ const r=matchBlock(rest,k); return r[1]+1; }
  return rest.indexOf(";",k)+1;
}
function splitArgsTop(s){
  const out=[]; let d=0,cur="",ins=false;
  for(let i=0;i<s.length;i++){ const c=s[i];
    if(ins){ cur+=c; if(c==='"') ins=false; continue; }
    if(c==='"'){ins=true;cur+=c;}
    else if(c==="("){d++;cur+=c;} else if(c===")"){d--;cur+=c;}
    else if(c===","&&!d){out.push(cur.trim());cur="";} else cur+=c; }
  if(cur.trim()) out.push(cur.trim());
  return out;
}
function classifyStatement(s){
  if(!s) return null;
  let m;
  if((m=/^((?:[A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*\s*\([^)]*\))*)\s*\.\s*(setPosition|setPower|setVelocity)\s*\(([\s\S]*)\)$/.exec(s)))
    return {kind:"call", dev:m[1], op:m[2], expr:m[3].trim(), ast:parseExpr(m[3])};
  if(/^telemetry\s*\./.test(s)) return null;
  if(/^(idle|waitForStart|telemetry\.update)\s*\(\s*\)$/.test(s)) return null;
  if(/^(return|break|continue)\b/.test(s))
    return {kind:"unknown", text:s, why:"control flow ("+s.split(/\W/)[0]+") isn't simulated"};
  // count++  count--  ++count  --count
  if((m=/^(\+\+|--)\s*([A-Za-z_$][\w$]*)$/.exec(s))||(m=/^([A-Za-z_$][\w$]*)\s*(\+\+|--)$/.exec(s))){
    const pre=m[1]==="++"||m[1]==="--";
    const name=pre?m[2]:m[1], inc=(pre?m[1]:m[2])==="++";
    return {kind:"assign", name, op:inc?"+":"-", expr:"1", ast:{o:"num",v:1}};
  }
  // a blocking wait: flagged in TeleOp, honoured as elapsed time in Autonomous
  if((m=/^sleep\s*\(\s*([^)]+)\s*\)$/.exec(s))){
    const ast=parseExpr(m[1]);
    return {kind:"sleep", ms:(ast&&ast.o==="num")?ast.v:null, ast};
  }
  // controller = new PIDController(p, i, d)   /   PIDController c = new PIDController(…)
  if((m=/^(?:[A-Z][\w.]*(?:<[^>]*>)?\s+)?([A-Za-z_$][\w$]*)\s*=\s*new\s+\w*PID\w*\s*\(([\s\S]*)\)$/.exec(s)))
    return {kind:"pidnew", obj:m[1], args:splitArgsTop(m[2]).map(x=>parseExpr(x))};
  // a typed object declaration: hardware wiring and construction are handled
  // elsewhere; anything else produces an object the bench doesn't model
  if((m=/^(?:final\s+)?([A-Z][\w.]*(?:<[^>]*>)?)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/.exec(s))){
    const rhs=m[3].trim();
    if(/^hardwareMap\b/.test(rhs)||/^new\b/.test(rhs)||m[1]==="String") return null;
    return {kind:"unknown", text:s, why:"objects of type "+m[1]+" aren't simulated"};
  }
  // any other method on an object: setDirection, setMode, setPID, resetYaw …
  if((m=/^((?:[A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*\s*\([^)]*\))*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/.exec(s))){
    const raw=m[3];
    return {kind:"objcall", obj:m[1], meth:m[2], raw,
            args:splitArgsTop(raw).map(x=>parseExpr(x))};
  }
  if((m=/^(?:(?:final|static)\s+)*(?:double|float|int|long|boolean)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/.exec(s))){
    const ast=parseExpr(m[2]);
    if(!ast) return {kind:"unknown", text:s, why:"couldn't read the right-hand side"};
    return {kind:"assign", name:m[1], expr:m[2].trim(), ast};
  }
  // `telemetry = new MultipleTelemetry(…)`, `arm = hardwareMap.get(…)`: wiring, not state
  if(/^[A-Za-z_$][\w$]*\s*=\s*(new\b|hardwareMap\b)/.test(s)) return null;
  if((m=/^([A-Za-z_$][\w$]*)\s*([+\-*/]?)=\s*([\s\S]+)$/.exec(s))){
    if(m[3].charAt(0)==="=") return {kind:"unknown", text:s, why:"a comparison on its own does nothing"};
    const ast=parseExpr(m[3]);
    if(!ast) return {kind:"unknown", text:s, why:"couldn't read the right-hand side"};
    return {kind:"assign", name:m[1], op:m[2], expr:m[3].trim(), ast};
  }
  // a declaration without a value, e.g. `double x;`
  if(/^(?:(?:final)\s+)?(?:double|float|int|long|boolean|String|[A-Z]\w*)\s+[A-Za-z_$][\w$]*$/.test(s)) return null;
  return {kind:"unknown", text:s, why:"not a form the interpreter understands"};
}

/* Line number (1-based) of an offset in the comment-stripped source. Stripping
   preserves newlines, so this is also the line in the file the team wrote. */
function lineAt(code, at){
  if(at==null||!code.src) return null;
  let n=1; const s=code.src;
  for(let i=0;i<at&&i<s.length;i++) if(s.charCodeAt(i)===10) n++;
  return n;
}

/* What the interpreter actually runs, and what it had to skip. */
function coverage(code){
  const devices={}; code.devices.forEach(d=>devices[d.name]=1);
  const pids={}; (code.inits||[]).forEach(st=>{ if(st.kind==="pidnew") pids[st.obj]=1; });
  let total=0, ok=0; const skipped=[];
  const walk=(list,phase)=>{ for(const st of list||[]){
    total++;
    if(st.kind==="if"){ ok++; walk(st.then,phase); walk(st.else,phase); continue; }
    if(st.kind==="while"){ ok++; walk(st.body,phase); continue; }
    if(st.kind==="unknown"){ skipped.push({line:lineAt(code,st.at), text:st.text, why:st.why, phase}); continue; }
    if(st.kind==="objcall"){
      const known = devices[st.obj] ? SIM_METHODS.test(st.meth)||NOOP_METHODS.test(st.meth)
                  : pids[st.obj]||SIM_METHODS.test(st.meth)||NOOP_METHODS.test(st.meth)||
                    (/^gamepad[12]$/.test(st.obj)&&GAMEPAD_METHODS.test(st.meth));
      if(!known){ skipped.push({line:lineAt(code,st.at), text:st.obj+"."+st.meth+"(…)",
        why: devices[st.obj] ? "this device method isn't simulated"
                             : "calls into other classes aren't simulated", phase}); continue; }
      if(st.meth==="setMode"&&/RUN_USING_ENCODER|RUN_WITHOUT_ENCODER|STOP_AND_RESET_ENCODER|RUN_TO_POSITION/.test(st.raw||"")===false)
        { skipped.push({line:lineAt(code,st.at), text:st.obj+".setMode(…)", why:"unrecognised run mode", phase}); continue; }
    }
    ok++;
  }};
  walk(code.inits,"init"); walk(code.stmts,"loop"); walk(code.auto,"auto");
  return {total, understood:ok, skipped};
}

/* Fields FTC Dashboard would let you edit live: static and not final. */
function collectStaticFields(src){
  const out=[]; let m;
  const re=/\b((?:(?:public|private|protected|static|final|volatile|transient)\s+)+)(double|float|int|long|boolean)\s+([^;(){}]+);/g;
  while((m=re.exec(src))){
    const mods=m[1];
    if(!/\bstatic\b/.test(mods)||/\bfinal\b/.test(mods)) continue;
    for(const part of m[3].split(",")){
      const q=/^\s*([A-Za-z_$][\w$]*)/.exec(part); if(!q) continue;
      out.push({name:q[1], type:m[2], isPublic:/\bpublic\b/.test(mods), at:m.index});
    }
  }
  return out;
}

function parseJava(raw){
  const src = stripComments(raw);
  const out = {opmode:null, kind:null, cls:null, devices:[], consts:{}, vars:{},
               stmts:[], inits:[], telemetry:[], hasLoop:false, hasWait:false, parseNotes:[]};
  let m;
  if((m=/@TeleOp\s*\(([^)]*)\)/.exec(src))){ out.kind="TeleOp";
    const n=/name\s*=\s*"([^"]*)"/.exec(m[1]); out.opmode=n?n[1]:"(unnamed)"; }
  else if((m=/@Autonomous\s*\(([^)]*)\)/.exec(src))){ out.kind="Autonomous";
    const n=/name\s*=\s*"([^"]*)"/.exec(m[1]); out.opmode=n?n[1]:"(unnamed)"; }
  else if(/@TeleOp\b/.test(src)){ out.kind="TeleOp"; out.opmode="(unnamed)"; }
  if((m=/class\s+(\w+)\s+extends\s+(\w+)/.exec(src))){ out.cls=m[1]; out.base=m[2]; }
  out.hasWait=/waitForStart\s*\(\s*\)/.test(src);
  out.hasLoop=false;                     // set once the main loop is actually found below

  // ---- device declarations, carrying the comment written just above them
  const reDecl=new RegExp("\\b(?:(?:public|private|protected|static|final)\\s+)*("+DEVT+")\\s+([A-Za-z_$][\\w$]*)\\s*(?:=[^;]*)?;","g");
  const rawLines=raw.split(/\r?\n/);
  while((m=reDecl.exec(src))){
    const type=m[1], name=m[2];
    const upto=src.slice(0,m.index).split(/\r?\n/).length-1;
    const lines=[];
    for(let L=upto; L>=0 && L>upto-5; L--){
      const t=(rawLines[L]||"").trim();
      if(/^\/\//.test(t)){ const c=t.replace(/^\/+\s*/,"").trim();
        if(c && !/^=+$/.test(c)) lines.unshift(c); }
      else if(t==="" || new RegExp("\\b"+type+"\\s+"+name).test(t)) { if(lines.length && t==="") break; }
      else break;
    }
    const intent=lines.join(" ");
    out.devices.push({name,type,cfg:null,intent,
      declaredRole:/torque/i.test(intent)?"Torque":(/speed/i.test(intent)?"Speed":null)});
  }
  const reHM1=/([A-Za-z_$][\w$]*)\s*=\s*hardwareMap\s*\.\s*(\w+)\s*\.\s*get\s*\(\s*"([^"]+)"\s*\)/g;
  const reHM2=/([A-Za-z_$][\w$]*)\s*=\s*hardwareMap\s*\.\s*get\s*\(\s*(\w+)\s*\.\s*class\s*,\s*"([^"]+)"\s*\)/g;
  const bind=(v,cfg,t)=>{ const d=out.devices.filter(d=>d.name===v)[0];
    if(d){ d.cfg=cfg; if(d.type==="?"&&t) d.type=t; }
    else out.devices.push({name:v,type:t||"?",cfg,intent:"",declaredRole:null}); };
  while((m=reHM1.exec(src))) bind(m[1],m[3],null);
  while((m=reHM2.exec(src))) bind(m[1],m[3],m[2]);

  // ---- fields
  const reC=/\b((?:(?:public|private|protected|static|final)\s+)*)(double|float|int|long)\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d*\.?\d+)\s*;/g;
  while((m=reC.exec(src))){
    const v=parseFloat(m[4]), name=m[3];
    if(/\bfinal\b/.test(m[1])) out.consts[name]=v; else out.vars[name]=v;
  }
  const reB=/\b((?:(?:public|private|protected|static|final)\s+)*)boolean\s+([A-Za-z_$][\w$]*)\s*=\s*(true|false)\s*;/g;
  while((m=reB.exec(src))) out.vars[m[2]] = m[3]==="true"?1:0;
  // several names on one line: `double p = 0.0036, i = 0.03, d = 0.000525;`
  const reMulti=/\b((?:(?:public|private|protected|static|final)\s+)*)(double|float|int|long)\s+([^;=(){}]*=[^;{}]*);/g;
  while((m=reMulti.exec(src))){
    const isFinal=/\bfinal\b/.test(m[1]);
    for(const part of m[3].split(",")){
      const q=/^\s*([A-Za-z_$][\w$]*)\s*=\s*(-?\d*\.?\d+)\s*$/.exec(part);
      if(!q) continue;
      if(isFinal){ if(out.consts[q[1]]===undefined) out.consts[q[1]]=parseFloat(q[2]); }
      else if(out.vars[q[1]]===undefined) out.vars[q[1]]=parseFloat(q[2]);
    }
  }
  // `public static int target1;` — no initializer, but it exists and reads 0
  const reU=/\b((?:(?:public|private|protected|static)\s+)+)(double|float|int|long)\s+([A-Za-z_$][\w$]*)\s*;/g;
  while((m=reU.exec(src)))
    if(out.vars[m[3]]===undefined&&out.consts[m[3]]===undefined) out.vars[m[3]]=0;
  // an initializer that is an expression, e.g. `1425.1/360.0`
  const constEnv={ get:k=>out.consts[k]!==undefined?out.consts[k]:(out.vars[k]||0),
                   pad:()=>0, device:()=>0, pid:()=>0 };
  const reX=/\b((?:(?:public|private|protected|static|final)\s+)*)(double|float|int|long)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;{}()]*[\d.][^;{}]*);/g;
  while((m=reX.exec(src))){
    const name=m[3];
    if(out.consts[name]!==undefined||out.vars[name]!==undefined) continue;
    const ast=parseExpr(m[4]);
    if(!ast) continue;
    const v=evalNode(ast,constEnv);
    if(typeof v==="number"&&isFinite(v)){
      if(/\bfinal\b/.test(m[1])) out.consts[name]=v; else out.vars[name]=v;
    }
  }

  out.src=src;
  out.config=collectStaticFields(src);
  out.hasConfigAnnotation=/@Config\b/.test(src);
  out.timers=[];
  const reTimer=/\bElapsedTime\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+ElapsedTime\s*\(/g;
  while((m=reTimer.exec(src))) out.timers.push(m[1]);

  // ---- init: runOpMode() up to waitForStart(), or an iterative init()
  const rom=/void\s+runOpMode\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\{/.exec(src);
  const romBody = rom ? matchBlock(src, rom.index+rom[0].length-1) : null;
  const wf=src.search(/waitForStart\s*\(\s*\)\s*;/);
  if(romBody && wf>romBody[0] && wf<romBody[1]) out.inits=parseStatements(src.slice(romBody[0],wf),romBody[0]);
  else if(wf>0) out.inits=parseStatements(src.slice(0,wf));
  else {
    const ii=/public\s+void\s+init\s*\(\s*\)\s*\{/.exec(src);
    if(ii){ const r=matchBlock(src,ii.index+ii[0].length-1); out.inits=parseStatements(src.slice(r[0],r[1]),r[0]); }
  }

  // ---- the main loop: while (opModeIsActive()) / while (!isStopRequested()) / loop()
  const lm=/while\s*\(\s*((?:!\s*)?(?:opModeIsActive|isStopRequested)\s*\(\s*\)(?:\s*&&\s*(?:!\s*)?(?:opModeIsActive|isStopRequested)\s*\(\s*\))?)\s*\)\s*\{/.exec(src);
  let loop="", loopAt=0;
  if(lm){ const r=matchBlock(src,lm.index+lm[0].length-1); loop=src.slice(r[0],r[1]); loopAt=r[0]; out.hasLoop=true; }
  else {
    const im=/public\s+void\s+loop\s*\(\s*\)\s*\{/.exec(src);
    if(im){ const r=matchBlock(src,im.index+im[0].length-1); loop=src.slice(r[0],r[1]); loopAt=r[0]; out.hasLoop=true; }
  }
  out.loopSrc=loop;
  out.stmts=parseStatements(loop,loopAt);

  // ---- autonomous without a main loop: run what follows waitForStart() in order
  out.auto=[];
  let autoSrc="";
  if(!out.hasLoop && romBody && wf>romBody[0] && wf<romBody[1]){
    const from=src.indexOf(";",wf)+1;
    autoSrc=src.slice(from,romBody[1]);
    out.auto=parseStatements(autoSrc,from,{auto:true});
  }

  const reT=/telemetry\s*\.\s*(addData|addLine)\s*\(\s*("([^"]*)")?\s*(?:,\s*([\s\S]*?))?\)\s*;/g;
  const telSrc=loop||autoSrc;
  const seenTel={};
  while((m=reT.exec(telSrc))){
    const key=m[1]+"|"+(m[3]||"")+"|"+(m[4]||"").trim();
    if(seenTel[key]) continue; seenTel[key]=1;
    out.telemetry.push({kind:m[1],label:m[3]||"",expr:(m[4]||"").trim()});
  }

  out.bindings = deriveBindings(out.stmts);
  return out;
}

function idRefs(n, out){
  out=out||[];
  if(!n||typeof n!=="object") return out;
  if(n.o==="id") out.push(n.v);
  if(n.a) idRefs(n.a,out);
  if(n.b) idRefs(n.b,out);
  if(n.args) n.args.forEach(x=>idRefs(x,out));
  return out;
}
/* Static read of the statement tree: which control drives what. Drivetrain
   code rarely names a stick inside setPower — it goes through locals like
   `double y = -gamepad1.left_stick_y`, so trace those back to their axes. */
function deriveBindings(stmts){
  const varAxes={};
  const seed=list=>{ for(const st of list){
    if(st.kind==="if"){ seed(st.then); if(st.else) seed(st.else); }
    else if(st.kind==="assign"){
      const ax=padRefs(st.ast).slice();
      idRefs(st.ast).forEach(id=>{ if(varAxes[id]) ax.push.apply(ax,varAxes[id]); });
      // `y *= powerFactor` refines y, it doesn't replace where y came from
      varAxes[st.name] = (st.op && varAxes[st.name]) ? varAxes[st.name].concat(ax) : ax;
    }
  }};
  seed(stmts);
  const axesOf=ast=>{
    const ax=padRefs(ast).slice();
    idRefs(ast).forEach(id=>{ if(varAxes[id]) ax.push.apply(ax,varAxes[id]); });
    return ax.filter((v,i,a)=>a.indexOf(v)===i);
  };
  const B=[];
  const walk=(list,ctx)=>{
    for(const st of list){
      if(st.kind==="if"){
        const refs=padRefs(st.condAst).map(splitPadRef).filter(Boolean);
        const next = refs.length? {pad:refs[0].pad, btn:refs[0].btn, cond:st.cond} : ctx;
        walk(st.then, next);
        if(st.else) walk(st.else, next);
      }else if(st.kind==="call"){
        const axes=axesOf(st.ast);
        if(ctx) B.push({pad:ctx.pad, btn:ctx.btn, cond:ctx.cond, dev:st.dev, op:st.op, expr:st.expr, axes});
        else if(axes.length){
          const a=splitPadRef(axes[0]);
          if(a) B.push({pad:a.pad, btn:a.btn, cond:null, dev:st.dev, op:st.op, expr:st.expr, axes, analog:true});
        }
      }else if(st.kind==="assign" && ctx){
        // a button that sets a PID target is a binding too, even though it
        // never touches a device directly
        B.push({pad:ctx.pad, btn:ctx.btn, cond:ctx.cond, dev:st.name,
                op:(st.op||"")+"=", expr:st.expr, axes:[], assign:true});
      }else if(st.kind==="objcall" && ctx){
        // lift.setMode(STOP_AND_RESET_ENCODER), imu.resetYaw() — what a driver presses them for
        const arg=String(st.raw||"").replace(/\b[A-Za-z_$][\w$]*\.(?:[A-Za-z_$][\w$]*\.)*(?=[A-Z_]+\b)/g,"").trim();
        B.push({pad:ctx.pad, btn:ctx.btn, cond:ctx.cond, dev:st.obj, op:st.meth, expr:arg, axes:[]});
      }else if(st.kind==="sleep" && ctx){
        B.push({pad:ctx.pad, btn:ctx.btn, cond:ctx.cond, dev:"", op:"sleep",
                expr:st.ms!=null?String(st.ms):"…", axes:[], sleep:true});
      }
    }
  };
  walk(stmts,null);
  return B;
}
/* Does anything in the loop actually move this device? */
function isCommanded(code,name){
  let found=false;
  const scan=list=>{ for(const st of list||[]){
    if(st.kind==="if"){ scan(st.then); if(st.else) scan(st.else); }
    else if(st.kind==="while") scan(st.body);
    else if(st.kind==="call"&&st.dev===name) found=true; } };
  scan(code.stmts); scan(code.auto); scan(code.inits);
  return found;
}

/* Positions a device is commanded to, for gauge ranges and travel checks. */
function travelRange(code,devName){
  const vals=[]; const seenVar={};
  const scan=(list)=>{ for(const st of list){
    if(st.kind==="if"){ scan(st.then); if(st.else) scan(st.else); }
    else if(st.kind==="call" && st.dev===devName && st.op==="setPosition"){
      const v=staticValue(st.ast,code);
      if(v!==null) vals.push(v);
      else if(st.ast && st.ast.o==="id") seenVar[st.ast.v]=1;
    }
  }};
  scan(code.stmts);
  for(const i of code.inits) if(i.dev===devName&&i.op==="setPosition"){
    const v=staticValue(i.ast,code); if(v!==null) vals.push(v);
  }
  // a servo fed from a variable sweeps wherever that variable is clamped
  for(const vn in seenVar){
    const b=varBounds(code,vn);
    if(b){ vals.push(b.lo,b.hi); } else if(code.vars[vn]!==undefined) vals.push(code.vars[vn]);
  }
  if(!vals.length) return null;
  return {lo:Math.min.apply(null,vals), hi:Math.max.apply(null,vals), n:vals.length};
}
function staticValue(ast,code){
  if(!ast) return null;
  if(ast.o==="num") return ast.v;
  if(ast.o==="id"){
    if(code.consts[ast.v]!==undefined) return code.consts[ast.v];
    return null;
  }
  return null;
}
/* clamps written as `if (v > MAX) v = MAX;` bound the variable's sweep */
function varBounds(code,name){
  const lows=[], highs=[];
  const scan=(list)=>{ for(const st of list){
    if(st.kind==="if"){
      const c=st.condAst;
      if(c&&(c.o===">"||c.o==="<"||c.o===">="||c.o==="<=")&&c.a&&c.a.o==="id"&&c.a.v===name){
        const bound=staticValue(c.b,code);
        if(bound!==null){ (c.o.charAt(0)===">"?highs:lows).push(bound); }
      }
      scan(st.then); if(st.else) scan(st.else);
    }
  }};
  scan(code.stmts);
  if(!lows.length&&!highs.length) return null;
  return {lo: lows.length?Math.max.apply(null,lows):0,
          hi: highs.length?Math.min.apply(null,highs):1};
}
