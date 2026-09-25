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
/* String and char literal contents blanked, same length, so a scan for braces
   and keywords can't be fooled by "case 1:" inside a message. */
function maskStr(s){
  return s.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g,m=>m[0]+" ".repeat(m.length-2)+m[m.length-1]);
}
/* What the file being parsed declares, for the statement parser: constants a
   case label may name, enum types a local may have. parseJava sets it. */
let JCTX=null;
/* A counted loop that hasn't finished after this many passes is a bug in the
   loop, not a wait: let the rest of the autonomous run. */
const FOR_GUARD=1000;

/* Autonomous only: does this list sleep or wait? Then it can't run inside one
   exec() pass and has to be part of the program-counter sequence. */
function waits(list){
  return (list||[]).some(st=>st.kind==="sleep"||st.kind==="while"||st.kind==="if"&&(waits(st.then)||waits(st.else)));
}
/* Lift a branch into the sequence with every statement guarded by `g`: a
   sleep sleeps for 0 ms and a wait loop ends at once when `g` is false. The
   branch's condition was captured in a hidden var first, as Java evaluates it
   once, so a branch that changes it can't switch branches halfway. */
function guardAll(list,g,out){
  for(const st of list||[]){
    if(st.kind==="sleep"&&st.ast) out.push(Object.assign({},st,{ast:{o:"?:",c:g,a:st.ast,b:{o:"num",v:0}}}));
    else if((st.kind==="while"||st.synth&&st.kind==="if")&&st.condAst) out.push(Object.assign({},st,{condAst:{o:"&&",a:g,b:st.condAst}}));
    else out.push({kind:"if",synth:true,at:st.at,cond:"",condAst:g,then:[st],else:null});
  }
  return out;
}
function flattenIf(n){
  const h={o:"id",v:"__if"+n.at};
  return guardAll(n.else,{o:"u!",a:h},
    guardAll(n.then,h,[{kind:"assign",at:n.at,name:h.v,expr:n.cond,ast:n.condAst,of:"if"}]));
}
/* Where a case stops falling through: its own break (cut out, the chain does
   the breaking) or return/continue/throw (kept, so it gets reported). Braces
   only count when they're a plain block, not an if, loop or try body. */
function caseExit(M,from,end){
  const prev=i=>{ while(--i>=from&&/\s/.test(M[i])); return i<from?":":M[i]; };
  const blocks=[];
  for(let i=from;i<end;i++){
    const c=M[i];
    if(c==="{"){ blocks.push(/[;{}:]/.test(prev(i))); continue; }
    if(c==="}"){ blocks.pop(); continue; }
    if(blocks.indexOf(false)>=0||!/[bcrt]/.test(c)||/[\w$]/.test(M[i-1]||"")||!/[;{}:]/.test(prev(i))) continue;
    const t=/^(?:break\s*;|(?:return|continue|throw)\b)/.exec(M.slice(i,end));
    if(t) return {at:i, cut:t[0].charAt(0)==="b"?t[0].length:0};
  }
  return null;
}
/* switch → an if/else-if chain matching the value, the way Java picks a case.
   Labels count only at the switch's own brace depth and outside strings, so a
   nested switch can't split it. A case without break runs on into the next,
   which is also how stacked labels share one body. In an autonomous, a case
   that sleeps or waits is lifted into the sequence instead. Labels that aren't
   numbers or this file's constants (Strings, chars, enums from other files)
   make the whole switch a reported unknown, never a guess. */
function parseSwitch(disc,body,bodyAt,at,opts){
  const unk=why=>[{kind:"unknown",at,text:"switch ("+disc.trim().slice(0,40)+")",why}];
  const M=maskStr(body), segs=[];
  for(let i=0,d=0;i<M.length;i++){
    const c=M[i];
    if(c==="{") d++; else if(c==="}") d--;
    else if(!d&&(c==="c"||c==="d")&&!/[\w$]/.test(M[i-1]||"")){
      const lm=/^(?:case\b([^:]*?)|default\s*)(:|->)/.exec(M.slice(i));
      if(!lm) continue;
      if(lm[2]==="->") return unk("arrow-form switch (case X ->) isn't simulated");
      if(segs.length) segs[segs.length-1].end=i;
      segs.push({label:lm[1]==null?null:body.substr(i+4,lm[1].length), from:i+lm[0].length, end:M.length});
      i+=lm[0].length-1;
    }
  }
  if(!segs.length) return [];
  const discAst=parseExpr(disc);
  if(!discAst) return unk("couldn't read the switch value");
  const known=n=>!!n&&(n.o==="num"||n.o==="id"&&!!JCTX&&JCTX.consts[n.v]!==undefined||
    (n.o==="u-"||n.o==="u+")&&known(n.a)||/^[-+*\/%]$/.test(n.o)&&known(n.a)&&known(n.b));
  // on a variable of a known enum, `case LIFT:` is that enum's LIFT, whatever else is called LIFT
  const X=JCTX&&JCTX.enumOf&&JCTX.enumOf[disc.trim()];
  const lab=x=>X&&/^[A-Za-z_$][\w$]*$/.test(x)&&JCTX.consts[X+"."+x]!==undefined? X+"."+x : x;
  for(const s of segs){
    if(s.label!=null){
      if(/["']/.test(s.label)) return unk("switch on a String or char isn't simulated");
      s.labels=splitArgsTop(s.label.trim()); s.asts=s.labels.map(x=>parseExpr(lab(x)));
      if(!s.asts.length||!s.asts.every(known)) return unk("case labels that aren't numbers or constants declared in this file aren't simulated");
    }
    const t=caseExit(M,s.from,s.end);
    s.term=!!t;
    s.list=parseStatements(t&&t.cut? body.slice(s.from,t.at)+" ".repeat(t.cut)+body.slice(t.at+t.cut,s.end) : body.slice(s.from,s.end),
                           bodyAt+s.from,opts);
  }
  if(opts&&opts.auto&&segs.some(s=>waits(s.list))){
    // segment j runs for every entry from the last exit before it up to j
    const H={o:"id",v:"__sw"+at}, any=asts=>asts.map(a=>({o:"==",a:H,b:a})).reduce((x,y)=>({o:"||",a:x,b:y}));
    const all=[].concat.apply([],segs.map(s=>s.asts||[]));
    const dflt={o:"u!",a:all.length?any(all):{o:"num",v:0}};
    const out=[{kind:"assign",at,name:H.v,expr:disc.trim(),ast:discAst,of:"switch"}];
    let g=null;
    for(const s of segs){
      const hit=s.asts?any(s.asts):dflt;
      g=g?{o:"||",a:g,b:hit}:hit;
      guardAll(s.list,g,out);
      if(s.term) g=null;
    }
    return out;
  }
  // entry at segment e runs e, e+1, … through the first that exits; entries
  // that run the same statements (stacked labels) share one condition
  const runFrom=e=>{ const L=[]; for(let j=e;j<segs.length;j++){ L.push.apply(L,segs[j].list); if(segs[j].term) break; } return L; };
  const startOf=e=>{ while(e<segs.length&&!segs[e].list.length&&!segs[e].term) e++; return e; };
  const groups=[]; let def=null;
  segs.forEach((s,e)=>{
    const k=startOf(e);
    if(!s.asts){ def=k; return; }
    let g=groups.filter(x=>x.k===k)[0];
    if(!g) groups.push(g={k,labels:[],asts:[]});
    g.labels.push.apply(g.labels,s.labels); g.asts.push.apply(g.asts,s.asts);
  });
  const dList=def==null?[]:runFrom(def);
  let root=null, cur=null;
  for(const g of groups){
    const then=runFrom(g.k);
    if(!then.length&&!dList.length) continue;          // does nothing, and keeps nothing from default
    const node={kind:"if",at,cond:g.labels.map(l=>disc.trim()+" == "+l).join(" || "),
      condAst:g.asts.map(a=>({o:"==",a:discAst,b:a})).reduce((x,y)=>({o:"||",a:x,b:y})),then,else:null};
    if(cur) cur.else=[node]; else root=node;
    cur=node;
  }
  if(!root) return dList;
  cur.else=dList.length?dList:null;
  return [root];
}

/* Split a block into an ordered statement list, recursing into if/else.
   `base` is this block's offset in the whole file, so every statement can
   report its line. Anything the interpreter can't run becomes an "unknown"
   node with a reason — surfaced to the user, never silently dropped. */
function parseStatements(src, base, opts){
  base=base||0; opts=opts||{};
  const out=[], M=maskStr(src); let i=0;
  while(i<src.length){
    while(i<src.length && /\s/.test(src[i])) i++;
    if(i>=src.length) break;
    if(src[i]==="{"){ const r=matchBlock(src,i); out.push.apply(out,parseStatements(src.slice(r[0],r[1]),base+r[0],opts)); i=r[1]+1; continue; }
    const kw=/^(if|while|for|switch|do|try)\b/.exec(src.slice(i));
    if(kw){
      const at=base+i;
      if(kw[1]==="try"){
        const sb=src.indexOf("{",i); if(sb<0) break;
        const r=matchBlock(src,sb), fin=[];
        out.push.apply(out,parseStatements(src.slice(r[0],r[1]),base+r[0],opts));
        i=r[1]+1;
        // the sim never throws, so a catch body never runs; a finally body always does.
        // `catch (` and `finally {` exactly, so `catcher.setPosition(…)` isn't one
        for(let cm;(cm=/^\s*(catch\s*\([^)]*\)|finally)\s*\{/.exec(src.slice(i)));){
          const b=matchBlock(src,i+cm[0].length-1);
          if(cm[1]==="finally") fin.push.apply(fin,parseStatements(src.slice(b[0],b[1]),base+b[0],opts));
          i=b[1]+1;
        }
        out.push.apply(out,fin);
        continue;
      }
      if(kw[1]==="do"){
        // report it, then step over the whole `do … while (…);` so what follows still parses
        let e=i+2; while(e<src.length&&/\s/.test(src[e]))e++;
        e=src[e]==="{"? matchBlock(src,e)[1]+1 : src.indexOf(";",e)+1;
        const w=/^\s*while\s*\(/.exec(src.slice(e));
        if(w){ let d=0,q=e+w[0].length-1; for(;q<src.length;q++){ if(src[q]==="(")d++; else if(src[q]===")"){d--; if(!d)break;} } e=src.indexOf(";",q)+1; }
        out.push({kind:"unknown",at,text:src.slice(i,i+40).replace(/\s+/g," ").trim(),why:"do/while loops aren't simulated"});
        if(e<=i) break;
        i=e; continue;
      }
      const lp=src.indexOf("(",i);
      if(lp<0){ out.push({kind:"unknown",at,text:src.slice(i,i+40).trim(),why:"not a form the interpreter understands"}); break; }
      let d=0,j=lp;
      for(;j<src.length;j++){ if(src[j]==="(")d++; else if(src[j]===")"){d--; if(!d)break;} }
      const cond=src.slice(lp+1,j);
      let k=j+1; while(k<src.length&&/\s/.test(src[k]))k++;
      let bodySrc,bodyAt,end;
      if(src[k]==="{"){ const r=matchBlock(src,k); bodySrc=src.slice(r[0],r[1]); bodyAt=base+r[0]; end=r[1]+1; }
      else { const sc=src.indexOf(";",k); if(sc<0) break; bodySrc=src.slice(k,sc+1); bodyAt=base+k; end=sc+1; }
      
      if(kw[1]==="for"){
        const parts=cond.split(";"), text="for ("+cond.trim().slice(0,40)+")";
        if(!opts.auto){ out.push({kind:"unknown",at,text,why:"loops inside the OpMode loop aren't simulated"}); i=end; continue; }
        // for (init; cond; update) body  →  init; while (cond) { body; update },
        // with its own pass counter so a loop that never ends can't hold the auto forever
        const c=parts.length===3?parts[1].trim():"", cAst=c?parseExpr(c):null;
        const side=s=>splitArgsTop(s).map(x=>classifyStatement(x)).filter(Boolean);
        const ini=cAst?side(parts[0]):[], upd=cAst?side(parts[2]):[];
        if(!cAst||ini.concat(upd).some(st=>st.kind!=="assign")){
          out.push({kind:"unknown",at,text,why:parts.length!==3?"for-each loops aren't simulated"
            :!c?"for (;;) loops aren't simulated":"this for loop's header isn't simulated"});
          i=end; continue;
        }
        const G={o:"id",v:"__for"+at};
        ini.concat(upd).forEach(st=>{ st.at=at; });
        out.push({kind:"assign",synth:true,at,name:G.v,expr:"0",ast:{o:"num",v:0}});
        out.push.apply(out,ini);
        out.push({kind:"while",at,cond:c,condAst:{o:"&&",a:cAst,b:{o:"<",a:G,b:{o:"num",v:FOR_GUARD}}},
          body:parseStatements(bodySrc,bodyAt).concat(upd,[{kind:"assign",synth:true,at,name:G.v,op:"+",expr:"1",ast:{o:"num",v:1}}])});
        i=end; continue;
      }
      if(kw[1]==="switch"){ out.push.apply(out,parseSwitch(cond,bodySrc,bodyAt,at,opts)); i=end; continue; }

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
        if(src[k2]==="{"){ const r=matchBlock(src,k2); elseStmts=parseStatements(src.slice(r[0],r[1]),base+r[0],opts); end=r[1]+1; }
        else { // else if … / single statement
          const rest=src.slice(k2);
          const stop=/^if\b/.test(rest)? findStatementEnd(rest) : rest.indexOf(";")+1;
          elseStmts=parseStatements(rest.slice(0,stop),base+k2,opts); end=k2+stop;
        }
      }
      // `if (isStopRequested()) return;` is a guard for the real robot, not behaviour
      if(!/^\s*isStopRequested\s*\(\s*\)\s*$/.test(cond)){
        const node={kind:"if", at, cond, condAst:parseExpr(cond), then:parseStatements(bodySrc,bodyAt,opts), else:elseStmts};
        // autonomous: a branch that sleeps or waits joins the sequence so the wait holds
        if(opts.auto&&(waits(node.then)||waits(node.else))) out.push.apply(out,flattenIf(node));
        else out.push(node);
      }
      i=end; continue;
    }
    // a statement ends at the first `;` outside ( ) and strings, so an anonymous
    // class or lambda passed to a call, or a "a;b" message, doesn't cut it in two
    let sc=i;
    for(let d=0;sc<M.length&&!(M[sc]===";"&&d<=0);sc++){ if(M[sc]==="(") d++; else if(M[sc]===")") d--; }
    if(sc>=M.length&&(sc=src.indexOf(";",i))<0) break;    // unbalanced: the old plain split
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
/* End of an `if (…) …` at the start of `rest`, including its `else`: without
   that, `else if (b) … else …` lost its last branch. */
function findStatementEnd(rest){
  const lp=rest.indexOf("(");
  let d=0,j=lp;
  for(;j<rest.length;j++){ if(rest[j]==="(")d++; else if(rest[j]===")"){d--; if(!d)break;} }
  let k=j+1; while(k<rest.length&&/\s/.test(rest[k]))k++;
  const e=rest[k]==="{"? matchBlock(rest,k)[1]+1 : rest.indexOf(";",k)+1;
  let m=e; while(m<rest.length&&/\s/.test(rest[m]))m++;
  if(!e||!/^else\b/.test(rest.slice(m))) return e;
  let k2=m+4; while(k2<rest.length&&/\s/.test(rest[k2]))k2++;
  if(rest[k2]==="{") return matchBlock(rest,k2)[1]+1;
  return /^if\b/.test(rest.slice(k2))? k2+findStatementEnd(rest.slice(k2)) : rest.indexOf(";",k2)+1;
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
  if((m=/^((?:[A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*\s*\([^)]*\))*)\s*\.\s*(setPosition|setPower|setVelocity)\s*\(([\s\S]*)\)$/.exec(s))){
    const ast=parseExpr(m[3]);
    // an unreadable value would command the device to 0: report it instead
    if(!ast) return {kind:"unknown", text:s, why:"couldn't read the value"};
    return {kind:"call", dev:m[1], op:m[2], expr:m[3].trim(), ast};
  }
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
    // a local of an enum this file declares holds its constant's ordinal, like an int
    const ea=JCTX&&JCTX.enums[m[1].split(".").pop()]&&parseExpr(rhs);
    if(ea) return {kind:"assign", name:m[2], expr:rhs, ast:ea};
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
  const timers={}; (code.timers||[]).forEach(n=>timers[n]=1);
  // a PID object: built before START, or declared with a PID type anywhere (a field)
  const pids={}; (code.inits||[]).forEach(st=>{ if(st.kind==="pidnew") pids[st.obj]=1; });
  const reP=/\b\w*PID\w*(?:<[^>]*>)?\s+([A-Za-z_$][\w$]*)\s*[=;,)]/g; let pm;
  while((pm=reP.exec(code.src||""))) pids[pm[1]]=1;
  let total=0, ok=0; const skipped=[], seen=new Set();
  const skip=(st,text,why,phase)=>skipped.push({line:lineAt(code,st.at), text, why, phase});
  const walk=(list,phase,inLoop)=>{ for(const st of list||[]){
    if(seen.has(st)) continue; seen.add(st);            // a case that falls through shares its next case's nodes
    if(st.synth){ if(st.kind==="if") walk(st.then,phase,inLoop); continue; }   // the parser's own bookkeeping
    total++;
    if(st.kind==="if"||st.kind==="while"){
      if(st.condAst) ok++; else skip(st,st.kind+" ("+String(st.cond).trim().slice(0,48)+")","couldn't read the condition",phase);
      if(st.kind==="if"){ walk(st.then,phase,inLoop); walk(st.else,phase,inLoop); } else walk(st.body,phase,true);
      continue;
    }
    if(st.kind==="unknown"){ skip(st,st.text,st.why,phase); continue; }
    if(st.of&&!st.ast){ skip(st,st.of+" ("+String(st.expr).trim().slice(0,48)+")","couldn't read the condition",phase); continue; }
    if(st.kind==="sleep"&&!st.ast){ skip(st,"sleep(…)","couldn't read the duration",phase); continue; }
    if(st.kind==="sleep"&&inLoop){ skip(st,"sleep("+(st.ms!=null?st.ms:"…")+")",
      "sleep() inside a loop doesn't pause the sim: each pass of the loop takes one 20 ms tick",phase); continue; }
    // a call on something that isn't a declared device does nothing in the sim
    if(st.kind==="call"&&!devices[st.dev]){ skip(st,st.dev+"."+st.op+"(…)",
      st.dev.indexOf("(")>=0?"calls through other objects aren't simulated":"not a device this OpMode declares",phase); continue; }
    if(st.kind==="objcall"){
      const chained=st.obj.indexOf("(")>=0, noop=NOOP_METHODS.test(st.meth);
      const known = noop || !chained && (devices[st.obj] ? SIM_METHODS.test(st.meth)
                  : pids[st.obj] || timers[st.obj]&&SIM_METHODS.test(st.meth) || st.meth==="resetYaw" ||
                    /^gamepad[12]$/.test(st.obj)&&GAMEPAD_METHODS.test(st.meth));
      if(!known){ skip(st,st.obj+"."+st.meth+"(…)", devices[st.obj] ? "this device method isn't simulated"
        : chained ? "calls through other objects aren't simulated" : "calls into other classes aren't simulated",phase); continue; }
      if(st.meth==="setMode"&&/RUN_USING_ENCODER|RUN_WITHOUT_ENCODER|STOP_AND_RESET_ENCODER|RUN_TO_POSITION/.test(st.raw||"")===false)
        { skip(st,st.obj+".setMode(…)","unrecognised run mode",phase); continue; }
      if(!noop&&st.args.some(a=>!a)){ skip(st,st.obj+"."+st.meth+"(…)","couldn't read an argument",phase); continue; }
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

function parseJava(raw,opts){
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
  // FTCLib's PID controllers clamp the summed error to +-1 unless told otherwise
  out.ftclib=/\bcom\.arcrobotics\.ftclib\./.test(src);
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

  // ---- enums, anywhere in the file (nested ones too): each constant is its
  // ordinal, bound as X.A, Outer.X.A and, while no other name claims it, bare
  // A, which is how a case label writes it
  out.enums={};
  const reE=/\benum\s+([A-Za-z_$][\w$]*)[^{;]*\{/g, bare={};
  while((m=reE.exec(src))){
    const r=matchBlock(src,m.index+m[0].length-1), names=[]; let d=0, cur="";
    for(const c of src.slice(r[0],r[1])+";"){        // constants end at the first `;` outside ( ) { }
      if(c==="("||c==="{") d++; else if(c===")"||c==="}") d--;
      else if(!d&&(c===","||c===";")){ const q=/^\s*(?:@[\w.]+\s*)*([A-Za-z_$][\w$]*)/.exec(cur); if(q) names.push(q[1]); cur=""; if(c===";") break; }
      else if(!d) cur+=c;
    }
    out.enums[m[1]]=names;
    names.forEach((A,ord)=>{
      out.consts[m[1]+"."+A]=ord;
      if(out.cls) out.consts[out.cls+"."+m[1]+"."+A]=ord;
      if(bare[A]===undefined&&out.consts[A]===undefined&&out.vars[A]===undefined){ bare[A]=ord; out.consts[A]=ord; }
      else if(bare[A]!==undefined&&bare[A]!==ord){ delete out.consts[A]; bare[A]=NaN; }   // two enums share it: ambiguous
    });
  }
  // `State state = State.IDLE;` starts at that constant, not at 0, and a
  // switch on `state` reads its bare labels as State's
  const EN=Object.keys(out.enums).map(x=>x.replace(/\$/g,"\\$")), enumOf={};
  const reEF=EN.length&&new RegExp("\\b((?:(?:public|private|protected|static|final)\\s+)*)(?:[\\w$]+\\.)*("+EN.join("|")+
    ")\\s+([A-Za-z_$][\\w$]*)\\s*(?:=\\s*([^;{}]*))?;","g");
  while(reEF&&(m=reEF.exec(src))){
    enumOf[m[3]]=m[2];
    const v=m[4]==null?undefined:out.consts[m[4].trim()]; if(v===undefined) continue;
    if(/\bfinal\b/.test(m[1])) out.consts[m[3]]=v; else if(out.vars[m[3]]===undefined) out.vars[m[3]]=v;
  }

  out.src=src;
  out.config=collectStaticFields(src);
  out.hasConfigAnnotation=/@Config\b/.test(src);
  // a timer is anything built as `new ElapsedTime(…)`, or declared bare and built later
  out.timers=[];
  const reTimer=/\b([A-Za-z_$][\w$]*)\s*=\s*new\s+ElapsedTime\s*\(|\bElapsedTime\s+([A-Za-z_$][\w$]*)\s*;/g;
  while((m=reTimer.exec(src))){ const n=m[1]||m[2]; if(out.timers.indexOf(n)<0) out.timers.push(n); }
  JCTX={consts:out.consts, enums:out.enums, enumOf};

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
  JCTX=null;
  // a Road Runner 1.0 auto: its trajectories and actions (src/roadrunner.js),
  // with the team's helper classes from the other files it was given
  if(typeof rrDetect==="function"&&rrDetect(src)) rrAttach(out,raw,(opts&&opts.libs)||[]);
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
  // a Road Runner auto commands through its actions, and its drive through the follower
  if(!found&&code.rr&&code.rr.commanded) found=code.rr.commanded.indexOf(name)>=0;
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
