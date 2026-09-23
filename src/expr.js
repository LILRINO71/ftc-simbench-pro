/* ============================================================
   3.  EXPRESSION LANGUAGE
   One grammar covers arithmetic, comparisons and booleans, so a
   condition like `gamepad2.right_bumper && !lastRightBumper`
   evaluates by the same rules as `(y + x + turn) * SPEED`.
   ============================================================ */
/* Idioms that aren't worth teaching the grammar — collapse them to a name the
   evaluator knows before tokenizing. */
function normalizeExpr(src){
  return String(src)
    .replace(/\w+\s*\.\s*getRobotYawPitchRollAngles\s*\(\s*\)\s*\.\s*get(Yaw|Pitch|Roll)\s*\([^)]*\)/g,"__imu$1")
    .replace(/\b[A-Za-z_$][\w$]*\s*\.\s*(RADIANS|DEGREES)\b/g,"0")
    .replace(/(\d)[fFdDlL]\b/g,"$1");
}
function tokenize(src){
  // no [ ]: arrays aren't modelled, so a subscript fails the parse and the
  // statement is reported, instead of reading as a silent 0
  const T=[]; const re=/\s*(?:(gamepad\d\s*\.\s*[A-Za-z_]\w*)|([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)|(\d*\.\d+|\d+)|(&&|\|\||[<>=!]=|[-+*/%<>!(),?:]))/g;
  let m, last=0;
  while((m=re.exec(src))){
    if(m.index!==last && src.slice(last,m.index).trim()) return null;   // unparseable
    if(m[1]) T.push({t:"pad", v:m[1].replace(/\s+/g,"")});
    else if(m[2]) T.push({t:"id", v:m[2].replace(/\s+/g,"")});
    else if(m[3]) T.push({t:"num", v:parseFloat(m[3])});
    else T.push({t:"op", v:m[4]});
    last=re.lastIndex;
  }
  return src.slice(last).trim() ? null : T;
}
function parseExpr(src){
  const T=tokenize(normalizeExpr(src)); if(!T||!T.length) return null;
  let i=0;
  const peek=()=>T[i], eat=v=>{ if(T[i]&&T[i].t==="op"&&T[i].v===v){i++;return true;} return false; };
  function ternary(){
    const c=or();
    if(peek()&&peek().t==="op"&&peek().v==="?"){
      i++; const a=ternary(); eat(":"); const b=ternary();
      return {o:"?:",c,a,b};
    }
    return c;
  }
  function or(){ let n=and(); while(peek()&&peek().t==="op"&&peek().v==="||"){i++; n={o:"||",a:n,b:and()};} return n; }
  function and(){ let n=cmp(); while(peek()&&peek().t==="op"&&peek().v==="&&"){i++; n={o:"&&",a:n,b:cmp()};} return n; }
  function cmp(){ let n=add();
    while(peek()&&peek().t==="op"&&["<",">","<=",">=","==","!="].indexOf(peek().v)>=0){
      const o=peek().v; i++; n={o,a:n,b:add()}; } return n; }
  function add(){ let n=mul();
    while(peek()&&peek().t==="op"&&(peek().v==="+"||peek().v==="-")){ const o=peek().v; i++; n={o,a:n,b:mul()}; } return n; }
  function mul(){ let n=un();
    while(peek()&&peek().t==="op"&&["*","/","%"].indexOf(peek().v)>=0){ const o=peek().v; i++; n={o,a:n,b:un()}; } return n; }
  function un(){
    if(peek()&&peek().t==="op"&&(peek().v==="-"||peek().v==="!"||peek().v==="+")){
      const o=peek().v; i++; return {o:"u"+o,a:un()}; }
    // (int) x: integer casts truncate toward zero, (double)/(float) change nothing
    const t2=T[i+1], t3=T[i+2];
    if(peek()&&peek().t==="op"&&peek().v==="("&&t2&&t2.t==="id"&&/^(int|long|short|byte|double|float)$/.test(t2.v)&&t3&&t3.t==="op"&&t3.v===")"){
      i+=3; return /^(double|float)$/.test(t2.v)? un() : {o:"trunc",a:un()}; }
    return prim();
  }
  function prim(){
    const t=peek();
    if(!t) return {o:"num",v:0};
    if(t.t==="num"){ i++; return {o:"num",v:t.v}; }
    if(t.t==="pad"){ i++; return {o:"pad",v:t.v}; }
    if(t.t==="id"){
      i++;
      if(peek()&&peek().t==="op"&&peek().v==="("){            // function call
        i++; const args=[];
        if(!(peek()&&peek().t==="op"&&peek().v===")")){
          args.push(ternary());
          while(peek()&&peek().t==="op"&&peek().v===","){ i++; args.push(ternary()); }
        }
        eat(")");
        return {o:"call",name:t.v,args};
      }
      if(/^(true|false)$/.test(t.v)) return {o:"num",v:t.v==="true"?1:0};
      return {o:"id",v:t.v};
    }
    if(t.t==="op"&&t.v==="("){ i++; const n=ternary(); eat(")"); return n; }
    i++; return {o:"num",v:0};
  }
  const node=ternary();
  return node;                          // trailing junk tolerated
}
function evalNode(n, env){
  if(!n) return 0;
  switch(n.o){
    case "num": return n.v;
    case "id":  if(n.v==="Math.PI") return Math.PI; return env.get(n.v);
    case "pad": return env.pad(n.v);
    case "u-": return -evalNode(n.a,env);
    case "u+": return  evalNode(n.a,env);
    case "u!": return  evalNode(n.a,env)?0:1;
    case "?:": return evalNode(n.c,env)? evalNode(n.a,env) : evalNode(n.b,env);
    case "&&": return (evalNode(n.a,env)&&evalNode(n.b,env))?1:0;
    case "||": return (evalNode(n.a,env)||evalNode(n.b,env))?1:0;
    case "<":  return evalNode(n.a,env)< evalNode(n.b,env)?1:0;
    case ">":  return evalNode(n.a,env)> evalNode(n.b,env)?1:0;
    case "<=": return evalNode(n.a,env)<=evalNode(n.b,env)?1:0;
    case ">=": return evalNode(n.a,env)>=evalNode(n.b,env)?1:0;
    case "==": return evalNode(n.a,env)===evalNode(n.b,env)?1:0;
    case "!=": return evalNode(n.a,env)!==evalNode(n.b,env)?1:0;
    case "+":  return evalNode(n.a,env)+evalNode(n.b,env);
    case "-":  return evalNode(n.a,env)-evalNode(n.b,env);
    case "*":  return evalNode(n.a,env)*evalNode(n.b,env);
    case "/":  { const d=evalNode(n.b,env); return d?evalNode(n.a,env)/d:0; }
    case "%":  { const d=evalNode(n.b,env); return d?evalNode(n.a,env)%d:0; }
    case "trunc": return Math.trunc(evalNode(n.a,env));
    case "call":{
      const a=n.args.map(x=>evalNode(x,env));
      // device readback: motor.getCurrentPosition(), servo.getPosition(), …
      // The raw argument nodes go along: getDistance(DistanceUnit.INCH) needs
      // the unit's name, and that id evaluates to 0.
      const dm=/^([A-Za-z_$][\w$]*)\.(getCurrentPosition|getPosition|getPower|getVelocity|getTargetPosition|isBusy|getDistance|isPressed|red|green|blue|alpha)$/.exec(n.name);
      if(dm) return env.device(dm[1],dm[2],n.args);
      // ElapsedTime: runtime.seconds(), timer.milliseconds()
      const tm=/^([A-Za-z_$][\w$]*)\.(seconds|milliseconds|nanoseconds|time)$/.exec(n.name);
      if(tm&&env.timer) return env.timer(tm[1],tm[2]);
      // ftclib / roadrunner PID objects
      const pm=/^([A-Za-z_$][\w$]*)\.(calculate|setPID|setP|setI|setD|reset)$/.exec(n.name);
      if(pm) return env.pid(pm[1],pm[2],a);
      switch(n.name){
        case "opModeIsActive": return env.active?env.active():1;
        case "isStopRequested": return env.active?(env.active()?0:1):0;
        case "getRuntime": return env.runtime?env.runtime():0;
        case "Math.abs": return Math.abs(a[0]);
        case "Math.max": return Math.max.apply(null,a);
        case "Math.min": return Math.min.apply(null,a);
        case "Math.hypot": return Math.hypot.apply(null,a);
        case "Math.sqrt": return Math.sqrt(Math.max(0,a[0]));
        case "Math.cbrt": return Math.cbrt(a[0]);
        case "Math.pow": return Math.pow(a[0],a[1]);
        case "Math.signum": return Math.sign(a[0]);
        case "Math.sin": return Math.sin(a[0]);
        case "Math.cos": return Math.cos(a[0]);
        case "Math.tan": return Math.tan(a[0]);
        case "Math.asin": return Math.asin(Math.max(-1,Math.min(1,a[0])));
        case "Math.acos": return Math.acos(Math.max(-1,Math.min(1,a[0])));
        case "Math.atan": return Math.atan(a[0]);
        case "Math.atan2": return Math.atan2(a[0],a[1]);
        case "Math.exp": return Math.exp(a[0]);
        case "Math.log": return a[0]>0?Math.log(a[0]):0;
        case "Math.floor": return Math.floor(a[0]);
        case "Math.ceil": return Math.ceil(a[0]);
        case "Math.round": return Math.round(a[0]);
        case "Math.toRadians": return a[0]*Math.PI/180;
        case "Math.toDegrees": return a[0]*180/Math.PI;
        case "Range.clip": return Math.max(a[1],Math.min(a[2],a[0]));
        default: return a.length?a[0]:0;
      }
    }
  }
  return 0;
}
/* every gamepad reference an expression touches, for the binding list */
const PADREF=/^gamepad(\d)\.(\w+)$/;
function splitPadRef(r){ const m=PADREF.exec(r); return m?{pad:+m[1],btn:m[2]}:null; }
function padRefs(n, out){
  out=out||[];
  if(!n||typeof n!=="object") return out;
  if(n.o==="pad") out.push(n.v);
  ["a","b"].forEach(k=>{ if(n[k]) padRefs(n[k],out); });
  if(n.args) n.args.forEach(x=>padRefs(x,out));
  return out;
}
