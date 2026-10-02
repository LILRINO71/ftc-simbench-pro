/* ============================================================
   4a. JAVA VM — runs a team's real OpMode and every class it uses
   ------------------------------------------------------------
   The statement reader in java.js reads one OpMode file a line at a
   time. Real team code keeps its motors in a Robot class, drives
   through Road Runner or Pedro, and runs commands through FTCLib, so
   that reader finds nothing to run. This is a real (small) Java:
   a full parser, classes with fields, constructors, inheritance,
   inner and anonymous classes, enums, lambdas, arrays, collections,
   exceptions, loops, switch. It runs the team's own files as written.
   The FTC SDK and the common libraries are supplied by src/jvmlib.js;
   a library class it doesn't know runs as a harmless stub that is
   reported, never guessed at.

   Blocking: a LinearOpMode blocks in its loop and in sleep(). The
   interpreter is written as generators, so a pass can stop at a gate
   (opModeIsActive(), idle(), sleep()) and carry on next tick.
   ============================================================ */
const JV_KW=new Set(("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float "+
  "for goto if implements import instanceof int interface long native new package private protected public return short static strictfp "+
  "super switch synchronized this throw throws transient try void volatile while true false null").split(" "));
const JV_PRIM=new Set(["int","long","short","byte","char","float","double","boolean","void"]);
const JV_INTS=new Set(["int","long","short","byte","char","Integer","Long","Short","Byte","Character"]);
const JV_MODS=new Set(["public","private","protected","static","final","abstract","native","synchronized","transient","volatile","strictfp","default","sealed","non-sealed"]);

function JvError(msg,p){ const e=new Error(msg); e.jvPos=p; return e; }

/* ---------------- lexer ---------------- */
function jvLex(src){
  const T=[], n=src.length; let i=0;
  const id0=c=>(c>="a"&&c<="z")||(c>="A"&&c<="Z")||c==="_"||c==="$"||c>"\u007f";
  const idc=c=>id0(c)||(c>="0"&&c<="9");
  const OPS=[">>>=","<<=","...","->","::","++","--","&&","||","==","!=","<=",">=","+=","-=","*=","/=","%=","&=","|=","^=","<<"];
  const esc=(s,j)=>{ // s[j]==="\\": [char, next index]
    const c=s[j+1];
    const m={n:"\n",t:"\t",r:"\r",b:"\b",f:"\f",s:" ","0":"\0","'":"'",'"':'"',"\\":"\\"};
    if(c==="u"){ let k=j+1; while(s[k]==="u") k++; return [String.fromCharCode(parseInt(s.substr(k,4),16)||0),k+4]; }
    if(c>="0"&&c<="7"){ let k=j+1, v=""; while(k<j+4&&s[k]>="0"&&s[k]<="7") v+=s[k++]; return [String.fromCharCode(parseInt(v,8)),k]; }
    return [m[c]!==undefined?m[c]:c, j+2];
  };
  while(i<n){
    const c=src[i];
    if(c===" "||c==="\t"||c==="\n"||c==="\r"||c==="\f"||c==="﻿"){ i++; continue; }
    if(c==="/"&&src[i+1]==="/"){ while(i<n&&src[i]!=="\n") i++; continue; }
    if(c==="/"&&src[i+1]==="*"){ const e=src.indexOf("*/",i+2); i=e<0?n:e+2; continue; }
    const p=i;
    if(id0(c)){ let j=i+1; while(j<n&&idc(src[j])) j++; const v=src.slice(i,j);
      T.push({t:JV_KW.has(v)?"kw":"id",v,p}); i=j; continue; }
    if((c>="0"&&c<="9")||(c==="."&&src[i+1]>="0"&&src[i+1]<="9")){
      let j=i, v, isInt=true;
      if(c==="0"&&/[xX]/.test(src[i+1])){ j=i+2; while(j<n&&/[0-9a-fA-F_]/.test(src[j])) j++; v=parseInt(src.slice(i+2,j).replace(/_/g,""),16); }
      else if(c==="0"&&/[bB]/.test(src[i+1])){ j=i+2; while(j<n&&/[01_]/.test(src[j])) j++; v=parseInt(src.slice(i+2,j).replace(/_/g,""),2); }
      else{
        while(j<n&&/[0-9_]/.test(src[j])) j++;
        if(src[j]==="."&&/[0-9]/.test(src[j+1]||"")){ isInt=false; j++; while(j<n&&/[0-9_]/.test(src[j])) j++; }
        else if(src[j]==="."&&!/[A-Za-z_$]/.test(src[j+1]||"")){ isInt=false; j++; }
        if(/[eE]/.test(src[j])&&/[-+0-9]/.test(src[j+1]||"")){ isInt=false; j++; if(/[-+]/.test(src[j])) j++; while(j<n&&/[0-9]/.test(src[j])) j++; }
        v=parseFloat(src.slice(i,j).replace(/_/g,""));
      }
      let suf="";
      if(/[lLfFdD]/.test(src[j]||"")){ suf=src[j].toLowerCase(); j++; if(suf==="f"||suf==="d") isInt=false; }
      T.push({t:"num",v,isInt,p}); i=j; continue;
    }
    if(c==='"'){
      if(src.startsWith('"""',i)){                         // text block
        let j=src.indexOf("\n",i+3)+1, s="";
        while(j>0&&j<n&&!src.startsWith('"""',j)){ if(src[j]==="\\"){ const r=esc(src,j); s+=r[0]; j=r[1]; } else s+=src[j++]; }
        const lines=s.split("\n"), ind=Math.min.apply(null,lines.filter(l=>l.trim()).map(l=>/^ */.exec(l)[0].length).concat([1e9]));
        T.push({t:"str",v:lines.map(l=>l.slice(ind===1e9?0:ind)).join("\n"),p}); i=j+3; continue;
      }
      let j=i+1, s="";
      while(j<n&&src[j]!=='"'&&src[j]!=="\n"){ if(src[j]==="\\"){ const r=esc(src,j); s+=r[0]; j=r[1]; } else s+=src[j++]; }
      T.push({t:"str",v:s,p}); i=j+1; continue;
    }
    if(c==="'"){
      let j=i+1, s;
      if(src[j]==="\\"){ const r=esc(src,j); s=r[0]; j=r[1]; } else s=src[j++];
      if(src[j]==="'") j++;
      T.push({t:"chr",v:s.charCodeAt(0)||0,p}); i=j; continue;
    }
    if(c==="@"&&src.startsWith("@interface",i)){ T.push({t:"kw",v:"@interface",p}); i+=10; continue; }
    let op=null;
    for(const o of OPS) if(src.startsWith(o,i)){ op=o; break; }
    if(!op) op=c;
    T.push({t:"op",v:op,p}); i+=op.length;
  }
  T.push({t:"eof",v:"",p:n});
  return T;
}

/* ---------------- parser ---------------- */
function jvParse(src,file){
  const T=jvLex(src); let i=0;
  const pk=(k)=>T[i+(k||0)], nx=()=>T[i++];
  const is=(v,k)=>{ const t=T[i+(k||0)]; return t.v===v&&t.t!=="str"&&t.t!=="chr"; };
  const isId=(k)=>T[i+(k||0)].t==="id";
  const eat=v=>{ if(is(v)){ i++; return true; } return false; };
  const fail=(msg)=>{ throw JvError((msg||"unexpected '"+pk().v+"'")+(file?" in "+file:""),pk().p); };
  const want=v=>{ if(!eat(v)) fail("expected '"+v+"' but found '"+pk().v+"'"); };
  const ident=()=>{ const t=pk(); if(t.t!=="id") fail("expected a name but found '"+t.v+"'"); i++; return t.v; };

  function annotation(){        // @Name or @Name(...) — skipped, the name kept
    want("@"); let name=ident(); while(is(".")&&isId(1)){ i++; name+="."+ident(); }
    if(is("(")) skipParens();
    return name.replace(/^.*\./,"");
  }
  function skipParens(){ let d=0; do{ if(is("(")) d++; else if(is(")")) d--; if(pk().t==="eof") fail(); i++; }while(d>0); }
  function skipBraces(){ let d=0; do{ if(is("{")) d++; else if(is("}")) d--; if(pk().t==="eof") fail(); i++; }while(d>0); }
  function mods(){
    const m={annos:[]};
    for(;;){
      if(is("@")&&!is("interface",1)) { m.annos.push(annotation()); continue; }
      const t=pk();
      if((t.t==="kw"||t.t==="id")&&JV_MODS.has(t.v)&&!(t.v==="default"&&(is(":",1)||is("->",1)))){
        if(t.v==="non"){ break; } m[t.v]=true; i++; continue; }
      if(t.t==="id"&&t.v==="non"&&is("-",1)&&pk(2).v==="sealed"){ i+=3; continue; }
      break;
    }
    return m;
  }
  /* types: generics are read and dropped (erasure) */
  function typeArgs(){
    want("<");
    if(eat(">")) return;
    for(;;){
      while(is("@")) annotation();
      if(eat("?")){ if(eat("extends")||eat("super")) type(); }
      else type();
      while(eat("&")) type();
      if(eat(",")) continue;
      want(">"); return;
    }
  }
  function type(){
    while(is("@")) annotation();
    const t=pk(); let name;
    if(t.t==="kw"&&JV_PRIM.has(t.v)){ i++; name=t.v; }
    else if(t.t==="id"){ i++; name=t.v; if(is("<")) typeArgs();
      while(is(".")&&isId(1)){ i++; name+="."+ident(); if(is("<")) typeArgs(); } }
    else fail("expected a type but found '"+t.v+"'");
    let dims=0;
    while(is("[")&&is("]",1)){ i+=2; dims++; }
    if(is("...")){ /* varargs: caller handles */ }
    return {name,dims};
  }
  function tryType(){ const s=i; try{ return type(); }catch(e){ i=s; return null; } }
  function typeParams(){ if(is("<")){ let d=0; do{ if(is("<")) d++; else if(is(">")) d--; i++; }while(d>0); } }

  /* ---- declarations ---- */
  function unit(){
    const u={file:file||"",pkg:"",imports:[],types:[]};
    while(is("@")&&!is("interface",1)) annotation();
    if(eat("package")){ let s=ident(); while(eat(".")) s+="."+ident(); want(";"); u.pkg=s; }
    while(is("import")){
      i++; const st=eat("static"); let s=ident(), star=false;
      while(eat(".")){ if(eat("*")){ star=true; break; } s+="."+ident(); }
      want(";"); u.imports.push({name:s,static:st,star});
    }
    while(pk().t!=="eof"){ if(eat(";")) continue; const m=mods(); u.types.push(typeDecl(m)); }
    return u;
  }
  function typeDecl(m){
    const p=pk().p;
    if(eat("@interface")){ ident(); skipBraces(); return {kind:"annotation",name:"",members:[],p}; }
    let kind=null;
    if(eat("class")) kind="class"; else if(eat("interface")) kind="interface"; else if(eat("enum")) kind="enum";
    else if(is("record")&&isId(1)){ i++; kind="record"; }
    else fail("expected a class but found '"+pk().v+"'");
    const d={kind,name:ident(),mods:m,ext:null,impls:[],members:[],consts:[],p,file};
    typeParams();
    if(kind==="record"){ want("("); d.recordParams=params(true); }
    if(eat("extends")){ if(kind==="interface"){ d.impls.push(type()); while(eat(",")) d.impls.push(type()); } else d.ext=type(); }
    if(eat("implements")){ d.impls.push(type()); while(eat(",")) d.impls.push(type()); }
    if(eat("permits")){ type(); while(eat(",")) type(); }
    if(is("permits")){ i++; type(); while(eat(",")) type(); }
    classBody(d);
    return d;
  }
  function classBody(d){
    want("{");
    if(d.kind==="enum"){
      while(!is(";")&&!is("}")){
        while(is("@")) annotation();
        const p=pk().p, name=ident(); let args=[], body=null;
        if(is("(")) args=argList();
        if(is("{")){ body={kind:"class",name:"",mods:{},members:[],impls:[],consts:[],p,file}; classBody(body); }
        d.consts.push({name,args,body,p});
        if(!eat(",")) break;
      }
      eat(";");
    }
    while(!eat("}")){
      if(pk().t==="eof") fail("missing '}'");
      if(eat(";")) continue;
      const p=pk().p, m=mods();
      if(is("{")){ d.members.push({k:"init",static:!!m.static,body:block(),p}); continue; }
      if(is("class")||is("interface")||is("enum")||is("@interface")||(is("record")&&isId(1)&&!is("(",2))){ const t=typeDecl(m); t.nested=true; d.members.push({k:"type",decl:t,p}); continue; }
      typeParams();
      if(isId()&&pk().v===d.name&&is("(",1)){            // constructor
        i++; want("("); const ps=params();
        if(eat("throws")){ type(); while(eat(",")) type(); }
        d.members.push({k:"ctor",params:ps,body:block(),mods:m,p}); continue;
      }
      if(d.kind==="record"&&isId()&&pk().v===d.name&&is("{",1)){ i++; d.members.push({k:"compact",body:block(),p}); continue; }
      const ty=type();
      const np=pk().p, name=ident();
      if(is("(")){
        i++; const ps=params();
        let dims=0; while(is("[")&&is("]",1)){ i+=2; dims++; }
        if(eat("throws")){ type(); while(eat(",")) type(); }
        let body=null;
        if(is("{")) body=block();
        else { if(eat("default")) expr(); want(";"); }
        d.members.push({k:"method",name,params:ps,ret:ty,body,mods:m,static:!!m.static,abstract:!body,p:np});
        continue;
      }
      // fields: one type, any number of names
      let nm=name, fp=np;
      for(;;){
        let dims=ty.dims; while(is("[")&&is("]",1)){ i+=2; dims++; }
        let init=null;
        if(eat("=")) init=is("{")?arrayInit():expr();
        d.members.push({k:"field",name:nm,type:{name:ty.name,dims},init,static:!!m.static||d.kind==="interface",final:!!m.final||d.kind==="interface",p:fp});
        if(!eat(",")) break;
        fp=pk().p; nm=ident();
      }
      want(";");
    }
  }
  function params(record){
    const ps=[];
    if(eat(")")) return ps;
    for(;;){
      mods();
      const ty=type(); let varargs=false;
      if(eat("...")) varargs=true;
      if(is("this")){ i++; if(eat(",")) continue; want(")"); return ps; }   // receiver parameter
      const name=ident(); let dims=ty.dims; while(is("[")&&is("]",1)){ i+=2; dims++; }
      ps.push({name,type:{name:ty.name,dims:dims+(varargs?1:0)},varargs});
      if(eat(",")) continue;
      want(")"); return ps;
    }
  }
  /* ---- statements ---- */
  function block(){ const p=pk().p; want("{"); const body=[]; while(!eat("}")){ if(pk().t==="eof") fail("missing '}'"); body.push(stmt()); } return {k:"block",body,p}; }
  function localDecl(){         // [mods] Type name [= init], ... — or null, position restored
    const s=i;
    const m=mods();
    if(is("class")||is("interface")||is("enum")||(is("record")&&isId(1)&&!is("(",2))){ const t=typeDecl(m); return {k:"localclass",decl:t,p:t.p}; }
    const ty=tryType();
    if(!ty||!isId()||!(is("=",1)||is(",",1)||is(";",1)||is("[",1)||is(":",1))){ i=s; return null; }
    const p=T[s].p, decls=[];
    for(;;){
      const name=ident(); let dims=ty.dims; while(is("[")&&is("]",1)){ i+=2; dims++; }
      let init=null;
      if(eat("=")) init=is("{")?arrayInit():expr();
      decls.push({name,dims,init});
      if(!eat(",")) break;
    }
    return {k:"local",type:ty,decls,p};
  }
  function stmt(){
    const t=pk(), p=t.p;
    if(is("{")) return block();
    if(eat(";")) return {k:"empty",p};
    if(t.t==="id"&&is(":",1)&&!is("::",1)){ i+=2; return {k:"label",label:t.v,body:stmt(),p}; }
    if(t.t==="kw") switch(t.v){
      case "if":{ i++; want("("); const c=expr(); want(")"); const th=stmt(); let el=null; if(eat("else")) el=stmt(); return {k:"if",c,th,el,p}; }
      case "while":{ i++; want("("); const c=expr(); want(")"); return {k:"while",c,body:stmt(),p}; }
      case "do":{ i++; const body=stmt(); want("while"); want("("); const c=expr(); want(")"); want(";"); return {k:"do",c,body,p}; }
      case "for":{
        i++; want("(");
        const s=i; mods(); const ty=tryType();
        if(ty&&isId()&&is(":",1)){ const name=ident(); i++; const it=expr(); want(")"); return {k:"foreach",name,type:ty,it,body:stmt(),p}; }
        i=s;
        let init=[];
        if(!is(";")){ const ld=localDecl(); if(ld) init=[ld]; else { init.push({k:"expr",e:expr(),p}); while(eat(",")) init.push({k:"expr",e:expr(),p}); } }
        want(";"); const c=is(";")?null:expr(); want(";");
        const upd=[]; if(!is(")")){ upd.push(expr()); while(eat(",")) upd.push(expr()); }
        want(")");
        return {k:"for",init,c,upd,body:stmt(),p};
      }
      case "switch":{ i++; const sw=switchBody(); return Object.assign(sw,{k:"switch",p}); }
      case "return":{ i++; const e=is(";")?null:expr(); want(";"); return {k:"return",e,p}; }
      case "break":{ i++; const l=isId()?ident():null; want(";"); return {k:"break",label:l,p}; }
      case "continue":{ i++; const l=isId()?ident():null; want(";"); return {k:"continue",label:l,p}; }
      case "throw":{ i++; const e=expr(); want(";"); return {k:"throw",e,p}; }
      case "try":{
        i++; const res=[];
        if(eat("(")){ while(!eat(")")){ const ld=localDecl(); if(ld) res.push(ld); else res.push({k:"expr",e:expr(),p}); eat(";"); } }
        const body=block(), catches=[]; let fin=null;
        while(eat("catch")){ want("("); mods(); const types=[type().name]; while(eat("|")) types.push(type().name); const name=ident(); want(")"); catches.push({types,name,body:block()}); }
        if(eat("finally")) fin=block();
        return {k:"try",res,body,catches,fin,p};
      }
      case "synchronized":{ i++; want("("); expr(); want(")"); return block(); }
      case "assert":{ i++; expr(); if(eat(":")) expr(); want(";"); return {k:"empty",p}; }
      case "class": case "interface": case "enum": case "abstract": case "final": case "static": {
        const ld=localDecl(); if(ld) return ld; break; }
    }
    if(t.t==="id"&&t.v==="yield"&&!is("=",1)&&!is("(",1)&&!is(".",1)&&!is("[",1)&&!is("++",1)&&!is("--",1)){ i++; const e=expr(); want(";"); return {k:"yield",e,p}; }
    if(is("@")||t.t==="id"||(t.t==="kw"&&JV_PRIM.has(t.v))){ const ld=localDecl(); if(ld){ want(";"); return ld; } }
    const e=expr(); want(";");
    return {k:"expr",e,p};
  }
  function switchBody(){
    want("("); const disc=expr(); want(")"); want("{");
    const cases=[]; let arrow=false;
    while(!eat("}")){
      const p=pk().p; let labels=null;
      if(eat("default")){ labels=null; }
      else { want("case"); labels=[]; do{
          // a type pattern (case Foo f ->) or a qualified/plain constant
          if(isId()&&isId(1)){ const ty=ident(), nm=ident(); labels.push({k:"pattern",type:ty,name:nm,p}); }
          else if(is("null")){ i++; labels.push({k:"lit",v:null,p}); }
          else if(eat("default")){ labels.push({k:"default"}); }
          else labels.push(ternary());
        }while(eat(",")); }
      if(eat("->")){
        arrow=true; let body;
        if(is("{")) body=[block()];
        else if(is("throw")) body=[stmt()];
        else { const e=expr(); want(";"); body=[{k:"yield",e,p,arrowExpr:true}]; }
        cases.push({labels,body,arrow:true,p});
      } else {
        if(!eat(":")) want("->");
        const body=[];
        while(!is("case")&&!is("default")&&!is("}")) body.push(stmt());
        // `default` here could also be a statement-level modifier; never in practice
        cases.push({labels,body,arrow:false,p});
      }
    }
    return {disc,cases,arrow};
  }
  /* ---- expressions ---- */
  const ASSIGN=new Set(["=","+=","-=","*=","/=","%=","&=","|=","^=","<<=",">>>="]);
  function isLambdaAhead(){
    if(isId()&&is("->",1)) return true;
    if(!is("(")) return false;
    let d=0, j=i;
    for(;;j++){ const t=T[j]; if(t.t==="eof") return false; if(t.v==="("&&t.t==="op") d++; else if(t.v===")"&&t.t==="op"){ d--; if(!d) break; } }
    return T[j+1]&&T[j+1].v==="->";
  }
  function lambda(){
    const p=pk().p, ps=[];
    if(isId()){ ps.push(ident()); }
    else { want("("); if(!eat(")")){ for(;;){ mods(); if(isId()&&(is(",",1)||is(")",1))) ps.push(ident()); else { type(); ps.push(ident()); } if(eat(",")) continue; want(")"); break; } } }
    want("->");
    const body=is("{")?block():expr();
    return {k:"lambda",ps,body,p};
  }
  function expr(){
    if(isLambdaAhead()) return lambda();
    const lhs=ternary();
    const t=pk();
    if(t.t==="op"&&(ASSIGN.has(t.v)||(t.v===">"&&is(">",1)&&is(">=",2)))){
      let op=t.v;
      if(op===">"){ i+=2; op=">>="; } else i++;    // `>>=` reaches us as `>` `>=`
      if(op===">"&&false) op=">>=";
      return {k:"assign",op,t:lhs,v:expr(),p:t.p};
    }
    if(t.t==="op"&&t.v===">"&&is(">=",1)&&T[i+1].p===t.p+1){ i+=2; return {k:"assign",op:">>=",t:lhs,v:expr(),p:t.p}; }
    return lhs;
  }
  function ternary(){
    const c=binary(0);
    if(is("?")){ const p=pk().p; i++; const a=isLambdaAhead()?lambda():ternary(); want(":"); const b=isLambdaAhead()?lambda():ternary(); return {k:"cond",c,a,b,p}; }
    return c;
  }
  const LEVELS=[["||"],["&&"],["|"],["^"],["&"],["==","!="],["<",">","<=",">=","instanceof"],["<<",">>",">>>"],["+","-"],["*","/","%"]];
  function binOp(level){
    const t=pk(); if(t.t!=="op"&&!(t.t==="kw"&&t.v==="instanceof")) return null;
    // `>` `>` (adjacent) is a shift; `>` `>` `>` an unsigned one
    if(level===7&&t.v===">"&&is(">",1)&&T[i+1].p===t.p+1){
      if(is(">",2)&&T[i+2].p===t.p+2&&!is("=",3)) return {op:">>>",n:3};
      if(is(">=",2)) return null;
      return {op:">>",n:2};
    }
    if(level===6&&t.v===">"&&is(">",1)&&T[i+1].p===t.p+1) return null;
    if(level===6&&t.v===">"&&is(">=",1)&&T[i+1].p===t.p+1) return null;
    return LEVELS[level].indexOf(t.v)>=0?{op:t.v,n:1}:null;
  }
  function binary(level){
    if(level>=LEVELS.length) return unary();
    let a=binary(level+1);
    for(;;){
      const o=binOp(level); if(!o) return a;
      const p=pk().p; i+=o.n;
      if(o.op==="instanceof"){
        const fin=eat("final"); const ty=type(); let bind=null;
        if(isId()) bind=ident();
        void fin; a={k:"instanceof",a,type:ty,bind,p}; continue;
      }
      a={k:"bin",op:o.op,a,b:binary(level+1),p};
    }
  }
  function startsUnary(t){
    return t.t==="id"||t.t==="num"||t.t==="str"||t.t==="chr"||(t.t==="op"&&(t.v==="("||t.v==="!"||t.v==="~"))||
      (t.t==="kw"&&/^(this|super|new|true|false|null|switch)$/.test(t.v))||(t.t==="kw"&&JV_PRIM.has(t.v));
  }
  function unary(){
    const t=pk(), p=t.p;
    if(t.t==="op"){
      if(t.v==="++"||t.v==="--"){ i++; return {k:"pre",op:t.v,a:unary(),p}; }
      if(t.v==="+"||t.v==="-"||t.v==="!"||t.v==="~"){ i++; return {k:"un",op:t.v,a:unary(),p}; }
      if(t.v==="("){
        // a cast: (int) x, (double) y, (Foo) bar
        const s=i; i++;
        const nt=pk();
        if(nt.t==="kw"&&JV_PRIM.has(nt.v)){
          const ty=tryType();
          if(ty&&eat(")")) return {k:"cast",type:ty,a:unary(),p};
          i=s;
        } else if(nt.t==="id"){
          let ty=tryType();
          if(ty&&is("&")){ const s2=i; try{ while(eat("&")) type(); if(!is(")")) i=s2; }catch(er){ i=s2; } }
          if(ty&&is(")")&&startsUnary(pk(1))){
            i++;
            if(isLambdaAhead()) return {k:"cast",type:ty,a:lambda(),p};
            return {k:"cast",type:ty,a:unary(),p};
          }
          i=s;
        } else i=s;
      }
    }
    return postfix(primary());
  }
  function argList(){ want("("); const a=[]; if(eat(")")) return a; for(;;){ a.push(expr()); if(eat(",")) continue; want(")"); return a; } }
  function arrayInit(){ const p=pk().p; want("{"); const el=[]; while(!eat("}")){ el.push(is("{")?arrayInit():expr()); if(!eat(",")){ want("}"); break; } } return {k:"arrinit",el,p}; }
  function creator(p){
    while(is("@")) annotation();
    const t=pk(); let name;
    if(t.t==="kw"&&JV_PRIM.has(t.v)){ i++; name=t.v; }
    else { name=ident(); if(is("<")) typeArgs(); while(is(".")&&isId(1)){ i++; name+="."+ident(); if(is("<")) typeArgs(); } }
    if(is("[")){
      const dims=[]; let extra=0;
      while(is("[")){ i++; if(eat("]")){ extra++; continue; } dims.push(expr()); want("]"); }
      const init=is("{")?arrayInit():null;
      return {k:"newarr",type:name,dims,extra,init,p};
    }
    const args=argList(); let body=null;
    if(is("{")){ body={kind:"class",name:"",anon:true,mods:{},members:[],impls:[],consts:[],p,file}; classBody(body); }
    return {k:"new",type:name,args,body,p};
  }
  function primary(){
    const t=pk(), p=t.p;
    if(t.t==="num"){ i++; return {k:"lit",v:t.v,ty:t.isInt?"i":"d",p}; }
    if(t.t==="str"){ i++; return {k:"lit",v:t.v,ty:"s",p}; }
    if(t.t==="chr"){ i++; return {k:"lit",v:t.v,ty:"c",p}; }
    if(t.t==="kw"){
      switch(t.v){
        case "true": i++; return {k:"lit",v:true,ty:"b",p};
        case "false": i++; return {k:"lit",v:false,ty:"b",p};
        case "null": i++; return {k:"lit",v:null,p};
        case "this": i++; if(is("(")) return {k:"ctorcall",which:"this",args:argList(),p}; return {k:"this",p};
        case "super":
          i++;
          if(is("(")) return {k:"ctorcall",which:"super",args:argList(),p};
          if(eat("::")){ const name=ident(); return {k:"mref",obj:{k:"super",p},name,p}; }
          want("."); { if(is("<")) typeArgs(); const name=ident(); if(is("(")) return {k:"call",obj:{k:"super",p},name,args:argList(),p}; return {k:"field",obj:{k:"this",p},name,p}; }
        case "new": i++; return creator(p);
        case "switch": i++; { const sw=switchBody(); return Object.assign(sw,{k:"switchx",p}); }
      }
      if(JV_PRIM.has(t.v)){
        const ty=type();
        if(eat("::")){ ident(); return {k:"lit",v:null,p}; }
        want("."); want("class"); return {k:"classlit",type:ty.name,p};
      }
    }
    if(t.t==="op"&&t.v==="("){ i++; const e=expr(); want(")"); return {k:"paren",e,p}; }
    if(t.t==="id"){
      i++;
      if(is("(")) return {k:"call",obj:null,name:t.v,args:argList(),p};
      // Type[]::new, Type[].class
      if(is("[")&&is("]",1)){ const s=i; let dims=0; while(is("[")&&is("]",1)){ i+=2; dims++; }
        if(eat(".")&&eat("class")) return {k:"classlit",type:t.v,p};
        if(eat("::")){ if(!eat("new")) ident(); return {k:"lambda",ps:["n"],body:{k:"newarr",type:t.v,dims:[{k:"name",name:"n",p}],extra:dims-1,init:null,p},p}; }
        i=s; }
      // generic type before :: (List<String>::size) — rare; plain name otherwise
      return {k:"name",name:t.v,p};
    }
    fail();
  }
  function postfix(e){
    for(;;){
      const t=pk(), p=t.p;
      if(eat(".")){
        if(is("<")) typeArgs();
        if(eat("new")){ const c=creator(p); c.outer=e; e=c; continue; }
        if(eat("class")){ e={k:"classlit",type:nameOf(e),p}; continue; }
        if(eat("this")){ e={k:"this",qual:nameOf(e),p}; continue; }
        if(is("super")&&is("::",1)){ i+=2; e={k:"mref",obj:{k:"super",p},name:ident(),p}; continue; }
        if(eat("super")){ want("."); const name=ident(); e={k:"call",obj:{k:"super",qual:nameOf(e),p},name,args:argList(),p}; continue; }
        const name=ident();
        if(is("(")) e={k:"call",obj:e,name,args:argList(),p};
        else e={k:"field",obj:e,name,p};
        continue;
      }
      if(is("[")){ i++; const ix=expr(); want("]"); e={k:"index",a:e,i:ix,p}; continue; }
      if(is("++")||is("--")){ i++; e={k:"post",op:t.v,a:e,p}; continue; }
      if(eat("::")){ const name=eat("new")?"new":ident(); e={k:"mref",obj:e,name,p}; continue; }
      if(is("<")&&e.k==="name"&&/^[A-Z]/.test(e.name)){
        // Type<Args>::method — try it, give it back otherwise
        const s=i; try{ typeArgs(); if(eat("::")){ const name=eat("new")?"new":ident(); e={k:"mref",obj:e,name,p}; continue; } }catch(er){}
        i=s;
      }
      return e;
    }
  }
  function nameOf(e){ return e.k==="name"?e.name:e.k==="field"?nameOf(e.obj)+"."+e.name:"?"; }
  return unit();
}

/* ---------------- runtime values ---------------- */
/* Objects: {__c: class, f: {fields}, n: {native state}}. Enum constants add
   __en (name) and __eo (ordinal). Arrays are JS arrays. Strings and numbers
   are JS values; boxed values are the same. A Java lambda is a JvFn. */
function JvFn(params,body,scope,self,cls,vm,native){ this.params=params; this.body=body; this.scope=scope; this.self=self; this.cls=cls; this.vm=vm; this.native=native||null; }
const JV_OPAQUE_TAG="__jvOpaque";
function jvIsObj(v){ return v!==null&&typeof v==="object"&&v.__c!==undefined; }
function JvThrow(value){ this.value=value; }

/* Completion signals of a statement */
const JV_BRK=1, JV_CONT=2, JV_RET=3, JV_YIELD=4;

function JvScope(up,fr){ this.v=Object.create(null); this.t=Object.create(null); this.up=up||null; this.fr=fr||(up&&up.fr)||null; }
JvScope.prototype.find=function(n){ for(let s=this;s;s=s.up) if(n in s.v) return s; return null; };

/* ---------------- the VM ---------------- */
/* units: parsed compilation units (the team's files and the library
   preludes). host: what the outside world answers (src/jvmlib.js). */
function JVM(units,natives){
  this.classes=new Map();          // fqn -> class
  this.bySimple=new Map();         // simple name -> [class]
  this.natives=natives||{};
  this.opaque=new Map();           // stub classes made up on the fly
  this.stubbed=new Map();          // "Class.method" -> count, what the stubs absorbed
  this.BUDGET=20000; this.budget=this.BUDGET;   // loop passes left before a forced tick (a busy-wait)
  this.steps=0; this.gateMark=-1;   // statements run, and the count at the last gate
  this.host=null;
  // what a run learns about a node of the parsed code (who owns a method, a field's
  // type, whether a call returns an int, an anonymous class). Parsed code is cached
  // and shared by every VM, so none of it may be stored on the node itself.
  this.nodeInfo=new WeakMap();
  this.mcache=new WeakMap();        // class -> name -> its methods (methodsOf)
  for(const u of units) for(const d of u.types) this.declare(d,u,null);
  for(const k in this.natives) this.declareNative(k,this.natives[k]);
}
JVM.prototype.declare=function(d,u,outer){
  if(d.kind==="annotation") return null;
  const fqn=outer?outer.fqn+"."+d.name:(u.pkg?u.pkg+"."+d.name:d.name);
  const c={name:d.name,fqn,decl:d,unit:u,outer,kind:d.kind,isStatic:!outer||!!d.mods.static||d.kind!=="class"||(outer&&outer.kind==="interface"),
    supName:d.ext?d.ext.name:null, ifNames:d.impls.map(t=>t.name), sup:undefined, ifs:undefined,
    fields:[], ftypes:Object.create(null), sf:Object.create(null), methods:new Map(), ctors:[], inits:[], sinits:[], nested:new Map(),
    ready:false, consts:null};
  if(!outer||!this.classes.has(fqn)){
    this.classes.set(fqn,c);
    if(d.name){ const l=this.bySimple.get(d.name)||[]; l.push(c); this.bySimple.set(d.name,l); }
  }
  if(outer) outer.nested.set(d.name,c);
  if(d.kind==="record"){
    for(const p of d.recordParams){ c.fields.push({name:p.name,type:p.type,init:null}); c.ftypes[p.name]=p.type;
      if(!d.members.some(m=>m.k==="method"&&m.name===p.name&&!m.params.length))
        this.addMethod(c,{k:"method",name:p.name,params:[],ret:p.type,body:{k:"block",body:[{k:"return",e:{k:"field",obj:{k:"this"},name:p.name}}]},mods:{},static:false});
    }
    const compact=d.members.find(m=>m.k==="compact");
    if(!d.members.some(m=>m.k==="ctor"&&m.params.length===d.recordParams.length))
      c.ctors.push({params:d.recordParams,body:{k:"block",body:(compact?compact.body.body:[]).concat(d.recordParams.map(p=>({k:"expr",e:{k:"assign",op:"=",t:{k:"field",obj:{k:"this"},name:p.name},v:{k:"name",name:p.name}}})))},record:true});
  }
  for(const m of d.members){
    if(m.k==="field"){ if(m.static) c.sinits.push(m); else { c.fields.push(m); c.inits.push(m); } c.ftypes[m.name]=m.type; }
    else if(m.k==="method") this.addMethod(c,m);
    else if(m.k==="ctor") c.ctors.push(m);
    else if(m.k==="init") (m.static?c.sinits:c.inits).push(m);
    else if(m.k==="type") this.declare(m.decl,u,c);
  }
  return c;
};
JVM.prototype.addMethod=function(c,m){ const l=c.methods.get(m.name)||[]; l.push(m); c.methods.set(m.name,l); if(this.mcache) this.mcache=new WeakMap(); };
/* A native class: a JS description of a library type (src/jvmlib.js). */
JVM.prototype.declareNative=function(fqn,def){
  const name=fqn.replace(/^.*\./,"");
  let outer=null;
  if(def.outer){ outer=this.classes.get(def.outer)||null; }
  const c={name,fqn,native:def,kind:def.kind||"class",isStatic:true,supName:def.sup||null,ifNames:def.ifs||[],sup:undefined,ifs:undefined,
    fields:[],ftypes:Object.create(null),sf:Object.create(null),methods:new Map(),ctors:[],inits:[],sinits:[],nested:new Map(),ready:false,outer};
  if(def.enumConsts) c.kind="enum";
  this.classes.set(fqn,c);
  const l=this.bySimple.get(name)||[]; l.push(c); this.bySimple.set(name,l);
  if(outer) outer.nested.set(name,c);
  return c;
};
JVM.prototype.opaqueClass=function(name){
  let c=this.opaque.get(name);
  if(!c){ c={name:name.replace(/^.*\./,""),fqn:name,opaque:true,kind:"class",isStatic:true,supName:null,ifNames:[],sup:null,ifs:[],fields:[],ftypes:Object.create(null),
    sf:Object.create(null),methods:new Map(),ctors:[],inits:[],sinits:[],nested:new Map(),ready:true}; this.opaque.set(name,c); }
  return c;
};
JVM.prototype.opaqueVal=function(name){ return {__c:this.opaqueClass(name),f:Object.create(null),n:null,[JV_OPAQUE_TAG]:true}; };
JVM.prototype.mk=function(fqn,fields,n){
  const c=this.classes.get(fqn)||this.opaqueClass(fqn);
  const o={__c:c,f:Object.create(null),n:n||null};
  for(let k=c;k;k=this.supOf(k)) if(k.decl) for(const f of k.fields) if(!(f.name in o.f)) o.f[f.name]=jvDefault(f.type);
  if(fields) Object.assign(o.f,fields);
  return o;
};
JVM.prototype.enumConst=function(fqn,name){
  const c=this.classes.get(fqn); if(!c) return null;
  if(!c.ready) jvDrain(this.ready(c));
  return c.sf[name]||null;
};
JVM.prototype.note=function(what){
  const e=this.stubbed.get(what);
  if(e){ e.n++; return; }
  const w=this.where(); this.stubbed.set(what,{n:1,file:w.file,pos:w.pos});
};

/* ---- type resolution ---- */
const JV_LANG={String:1,Object:1,Math:1,Integer:1,Double:1,Float:1,Long:1,Boolean:1,Character:1,Short:1,Byte:1,Number:1,System:1,Thread:1,Runnable:1,
  Exception:1,RuntimeException:1,Throwable:1,Error:1,InterruptedException:1,IllegalArgumentException:1,IllegalStateException:1,NullPointerException:1,
  ArithmeticException:1,IndexOutOfBoundsException:1,ArrayIndexOutOfBoundsException:1,UnsupportedOperationException:1,StringBuilder:1,Iterable:1,Comparable:1,
  Enum:1,Record:1,Override:1,Deprecated:1,SuppressWarnings:1,FunctionalInterface:1,Void:1,CharSequence:1,AutoCloseable:1,Cloneable:1,Class:1,ClassCastException:1,NumberFormatException:1,StrictMath:1};
JVM.prototype.findType=function(name,ctx){
  if(!name) return null;
  const key=name;
  const cache=ctx?(ctx.tcache||(ctx.tcache=new Map())):(this.gcache||(this.gcache=new Map()));
  if(cache.has(key)) return cache.get(key);
  const r=this.findType0(name,ctx);
  cache.set(key,r);
  return r;
};
JVM.prototype.findType0=function(name,ctx){
  if(JV_PRIM.has(name)) return null;
  if(name.indexOf(".")>=0){
    if(this.classes.has(name)) return this.classes.get(name);
    const parts=name.split(".");
    // Outer.Inner(.Deeper): resolve the head, then walk nested types
    for(let k=1;k<=parts.length;k++){
      const head=parts.slice(0,k).join(".");
      let c=k===1?this.findType(head,ctx):this.classes.get(head);
      if(!c) continue;
      for(let j=k;j<parts.length&&c;j++) c=this.nestedOf(c,parts[j]);
      if(c) return c;
    }
    return this.libLike(name)?this.opaqueClass(name):null;
  }
  // nested in this class, its outers and their supers
  for(let c=ctx;c;c=c.outer){ const n=this.nestedOf(c,name); if(n) return n; if(c.name===name&&!c.decl||c.name===name) return c; }
  const u=ctx&&ctx.unit;
  if(u){
    for(const t of u.types) if(t.name===name){ const c=this.classes.get(u.pkg?u.pkg+"."+name:name); if(c) return c; }
    for(const im of u.imports){
      if(im.static&&!im.star&&im.name.endsWith("."+name)){
        const o=this.findType(im.name.slice(0,im.name.length-name.length-1),null), n=o&&this.nestedOf(o,name);
        if(n) return n;
      }
      if(im.static||im.star) continue;
      if(im.name===name||im.name.endsWith("."+name)){
        if(this.classes.has(im.name)) return this.classes.get(im.name);
        // import a.b.Outer.Inner
        const dot=im.name.lastIndexOf("."), o=this.findType(im.name.slice(0,dot),null);
        const n=o&&this.nestedOf(o,name); if(n) return n;
        return this.opaqueClass(im.name);
      }
    }
    if(u.pkg&&this.classes.has(u.pkg+"."+name)) return this.classes.get(u.pkg+"."+name);
    for(const im of u.imports) if(im.star&&!im.static){
      if(this.classes.has(im.name+"."+name)) return this.classes.get(im.name+"."+name);
      const o=this.classes.get(im.name); const n=o&&this.nestedOf(o,name); if(n) return n;
    }
  }
  if(this.classes.has("java.lang."+name)) return this.classes.get("java.lang."+name);
  const l=this.bySimple.get(name);
  if(l&&l.length){
    // the team's own class first, then a library's
    const own=l.filter(c=>c.decl&&!c.decl.lib);
    return (own.length?own:l)[0];
  }
  return null;
};
JVM.prototype.libLike=function(name){ return /^(com|org|java|javax|android|androidx|dev|io|net|edu|kotlin)\./.test(name); };
JVM.prototype.nestedOf=function(c,name){
  // up the whole tree, supers and interfaces (an interface's interfaces too):
  // DcMotorEx.Direction is declared on DcMotorSimple, two interfaces up
  const st=[c], seen=new Set();
  while(st.length&&seen.size<60){ const k=st.shift(); if(!k||seen.has(k)) continue; seen.add(k);
    if(k.nested&&k.nested.has(name)) return k.nested.get(name);
    st.push(this.supOf(k)); for(const f of this.ifsOf(k)) st.push(f); }
  return null;
};
JVM.prototype.supOf=function(c){
  if(c.sup!==undefined) return c.sup;
  c.sup=null;
  if(c.supName){ const ctx=c.decl?(c.outer||c):null; let s=this.findType(c.supName,c.decl?c:ctx); if(s===c) s=this.findType(c.supName,c.outer); if(!s&&!c.native) s=this.opaqueClass(c.supName); if(s&&s!==c) c.sup=s; }
  else if(c.kind==="enum"&&c.decl) c.sup=null;
  return c.sup;
};
JVM.prototype.ifsOf=function(c){
  if(c.ifs!==undefined) return c.ifs;
  c.ifs=[];
  for(const n of c.ifNames||[]){ const f=this.findType(n,c.decl?c:null); if(f&&f!==c) c.ifs.push(f); }
  return c.ifs;
};
JVM.prototype.isSub=function(c,target){
  if(!c||!target) return false;
  const seen=new Set(), st=[c];
  while(st.length){ const k=st.pop(); if(!k||seen.has(k)) continue; seen.add(k);
    if(k===target||k.fqn===target.fqn) return true;
    st.push(this.supOf(k)); for(const f of this.ifsOf(k)) st.push(f); }
  return false;
};
JVM.prototype.isSubName=function(c,name){
  const seen=new Set(), st=[c];
  while(st.length){ const k=st.pop(); if(!k||seen.has(k)) continue; seen.add(k);
    if(k.name===name||k.fqn===name) return true;
    st.push(this.supOf(k)); for(const f of this.ifsOf(k)) st.push(f);
    if(k.native&&k.native.alsoIs&&k.native.alsoIs.indexOf(name)>=0) return true; }
  return false;
};

/* ---- static initialisation ---- */
JVM.prototype.ready=function*(c){
  if(!c||c.ready) return;
  c.ready=true;
  const sup=this.supOf(c); if(sup) yield* this.ready(sup);
  if(c.native){
    const def=c.native;
    if(def.enumConsts){ c.consts=def.enumConsts.map((n,o)=>({__c:c,f:Object.create(null),n:{},__en:n,__eo:o})); c.consts.forEach(k=>{ c.sf[k.__en]=k; if(def.enumInit) def.enumInit(k); }); }
    if(def.sf) for(const k in def.sf) c.sf[k]=typeof def.sf[k]==="function"&&def.sfLazy?def.sf[k](this):def.sf[k];
    return;
  }
  const d=c.decl;
  for(const f of c.sinits) if(f.k==="field") c.sf[f.name]=jvDefault(f.type);
  if(d.kind==="enum"){
    c.consts=[];
    let o=0;
    for(const k of d.consts){
      let cls=c;
      if(k.body){ k.body.name=c.name+"$"+k.name; cls=this.declare(k.body,c.unit,c); cls.supName=null; cls.sup=c; cls.isStatic=true; }
      const args=[]; for(const a of k.args) args.push(yield* this.ev(a,this.staticScope(c)));
      const inst=yield* this.construct(cls,args,null,null,{__en:k.name,__eo:o++});
      c.consts.push(inst); c.sf[k.name]=inst;
    }
  }
  const sc=this.staticScope(c);
  const prevCls=this.curCls; this.curCls=c;
  try{
  for(const m of c.sinits){
    if(m.k==="field"){ if(m.init) c.sf[m.name]=jvCoerce(yield* this.evInit(m.init,m.type,sc),m.type); }
    else yield* this.exBlock(m.body.body,new JvScope(sc));
  }
  } catch(e){ if(e&&typeof e==="object"&&!e.__where) e.__where=this.where(); throw e; }
  finally { this.curCls=prevCls; }
};
JVM.prototype.staticScope=function(c){ const s=new JvScope(null,{self:null,cls:c}); return s; };
function jvDefault(t){
  if(!t||t.dims) return null;
  if(t.name==="boolean") return false;
  if(JV_PRIM.has(t.name)&&t.name!=="void") return 0;
  return null;
}
/* A store into a typed slot: ints truncate, a stub reads as 0 in a number */
function jvCoerce(v,t){
  if(!t||t.dims) return v;
  const n=t.name;
  if(n==="int"||n==="long"||n==="short"||n==="byte"||n==="char"){
    if(typeof v==="number") return Math.trunc(v);
    if(v&&v[JV_OPAQUE_TAG]) return 0;
    if(typeof v==="boolean") return v?1:0;
    return v==null?0:v;
  }
  if(n==="double"||n==="float"){ if(v&&v[JV_OPAQUE_TAG]) return 0; return typeof v==="number"?v:(v==null?0:v); }
  if(n==="boolean"){ if(v&&v[JV_OPAQUE_TAG]) return false; return v; }
  return v;
}

/* ---- objects ---- */
JVM.prototype.construct=function*(c,args,outerSelf,capScope,extra,node){
  if(c.opaque) return this.opaqueVal(c.fqn);
  yield* this.ready(c);
  if(c.kind==="interface"&&!c.native) throw this.jthrow("InstantiationException","can't create interface "+c.name);
  const o={__c:c,f:Object.create(null),n:null};
  if(extra) Object.assign(o,extra);
  // every field of the whole chain starts at its default
  for(let k=c;k;k=this.supOf(k)) if(k.decl) for(const f of k.fields) if(!(f.name in o.f)) o.f[f.name]=jvDefault(f.type);
  if(outerSelf) o.__outer=outerSelf;
  if(capScope) o.__cap=capScope;
  yield* this.runCtor(c,o,args,node);
  return o;
};
JVM.prototype.runCtor=function*(c,o,args,node){
  if(c.native){
    if(c.native.ctor){ const r=c.native.ctor(this,o,args,node); if(r&&r.next) yield* r; }
    else { const s=this.supOf(c); if(s) yield* this.runCtor(s,o,args,node); }
    return;
  }
  if(c.opaque){ return; }
  const ctor=this.pickMethod(c.ctors,args);
  const sup=this.supOf(c);
  const prevCls=this.curCls; this.curCls=c;
  try{
  const fr={self:o,cls:c};
  const sc=new JvScope(o.__cap||null,fr);
  if(ctor) this.bindParams(ctor.params,args,sc);
  const body=ctor?ctor.body.body:[];
  let rest=body, explicit=null;
  if(body[0]&&body[0].k==="expr"&&body[0].e.k==="ctorcall"){ explicit=body[0].e; rest=body.slice(1); }
  if(explicit&&explicit.which==="this"){
    const a=[]; for(const x of explicit.args) a.push(yield* this.ev(x,sc));
    yield* this.runCtor(c,o,a,node);
  } else {
    if(sup){
      const a=[]; if(explicit) for(const x of explicit.args) a.push(yield* this.ev(x,sc));
      // an anonymous class passes its arguments up to the class it extends
      else if(c.decl&&c.decl.anon) a.push.apply(a,args);
      yield* this.runCtor(sup,o,a,node);
    }
    yield* this.initFields(c,o);
  }
  this.curCls=c;
  if(rest.length){ const r=yield* this.exBlock(rest,sc); void r; }
  } catch(e){ if(e&&typeof e==="object"&&!e.__where) e.__where=this.where(); throw e; }
  finally { this.curCls=prevCls; }
};
JVM.prototype.initFields=function*(c,o){
  const fr={self:o,cls:c}, sc=new JvScope(o.__cap||null,fr);
  this.curCls=c;
  for(const m of c.inits){
    if(m.k==="field"){ if(m.init) o.f[m.name]=jvCoerce(yield* this.evInit(m.init,m.type,sc),m.type); }
    else yield* this.exBlock(m.body.body,new JvScope(sc));
  }
};
JVM.prototype.evInit=function*(e,t,sc){
  if(e.k==="arrinit") return yield* this.arrInit(e,t,sc);
  return yield* this.ev(e,sc);
};
JVM.prototype.arrInit=function*(e,t,sc){
  const out=[];
  const inner=t?{name:t.name,dims:Math.max(0,(t.dims||1)-1)}:null;
  for(const x of e.el) out.push(x.k==="arrinit"?yield* this.arrInit(x,inner,sc):jvCoerce(yield* this.ev(x,sc),inner));
  return out;
};
JVM.prototype.bindParams=function(ps,args,sc){
  for(let k=0;k<ps.length;k++){
    const p=ps[k];
    let v;
    if(p.varargs&&!(args.length===ps.length&&(Array.isArray(args[k])||args[k]===null))) v=args.slice(k);
    else v=args[k];
    sc.v[p.name]=jvCoerce(v===undefined?null:v,p.type); sc.t[p.name]=p.type;
  }
};
/* Overloads: arity first, then how well each argument fits its parameter. */
JVM.prototype.pickMethod=function(list,args){
  if(!list||!list.length) return null;
  if(list.length===1) return list[0];
  let best=null, bs=-1;
  for(const m of list){
    const ps=m.params, va=ps.length&&ps[ps.length-1].varargs;
    if(!(ps.length===args.length||(va&&args.length>=ps.length-1))) continue;
    let s=ps.length===args.length?2:1, bad=false;
    for(let k=0;k<args.length;k++){
      const p=ps[Math.min(k,ps.length-1)];
      if(!p) break;
      // a varargs slot takes its element type, unless one array is passed for it
      const vslot=p.varargs&&k>=ps.length-1&&!(args.length===ps.length&&(Array.isArray(args[k])||args[k]===null));
      const f=this.fit(args[k],vslot?{name:p.type.name,dims:p.type.dims-1}:p.type);
      if(f===0) bad=true;
      s+=f;
    }
    if(bad) s-=10;
    if(s>bs){ bs=s; best=m; }
  }
  return best||list.find(m=>m.params.length===args.length)||null;
};
JVM.prototype.fit=function(v,t){
  if(!t) return 0;
  const n=t.name;
  if(t.dims) return Array.isArray(v)?3:v===null?1:0;
  if(typeof v==="number") return n==="double"||n==="float"?3:JV_INTS.has(n)?(Number.isInteger(v)?3:1):(n==="Double"||n==="Number"||n==="Object"?2:0);
  if(typeof v==="boolean") return n==="boolean"||n==="Boolean"?3:0;
  if(typeof v==="string") return n==="String"||n==="CharSequence"||n==="Object"?3:0;
  if(v instanceof JvFn){ if(JV_PRIM.has(n)||n==="String") return 0; if(JV_FUNC_IFACE.test(n)) return 3; const l=this.bySimple.get(n.replace(/^.*\./,"")); return l&&l.some(c=>this.isFunctional(c))?3:1; }
  if(jvIsObj(v)){
    if(v.__c.name===n) return 4;
    const sn=n.replace(/^.*\./,"");
    if(this.isSubName(v.__c,sn)||v[JV_OPAQUE_TAG]||v.__c.opaque||sn==="Object") return 3;
    if(JV_PRIM.has(n)||n==="String") return 0;
    // a type the VM knows that this object isn't: no fit; one it can't see: maybe
    return (this.bySimple.has(sn)||JV_FUNC_IFACE.test(sn))&&!this.hasNativeBase(v.__c)?0:1;
  }
  if(v===null) return JV_PRIM.has(n)?0:1;
  return 1;
};
const JV_FUNC_IFACE=/^(?:java\.\w+\.(?:function\.)?)?(Runnable|Callable|Supplier|Consumer|BiConsumer|Function|BiFunction|Predicate|BiPredicate|BooleanSupplier|DoubleSupplier|IntSupplier|LongSupplier|DoubleUnaryOperator|DoubleBinaryOperator|UnaryOperator|BinaryOperator|DoubleConsumer|IntConsumer|DoubleFunction|IntFunction|ToDoubleFunction|ToIntFunction|Comparator|InstantFunction|\w*Listener|\w*Callback)$/;
/* An interface with exactly one abstract method: a lambda can be one */
JVM.prototype.isFunctional=function(c){
  if(!c||c.kind!=="interface") return false;
  if(c.native) return !!c.native.functional;
  if(c.functional!==undefined) return c.functional;
  let n=0; for(const [,l] of c.methods) for(const m of l) if(!m.body&&!m.static) n++;
  return (c.functional=n===1);
};
/* Every method with this name, from the class up its supers and interfaces */
JVM.prototype.methodsOf=function(c,name){
  // a class's methods never change once declared: look each name up once per class
  let byName=this.mcache.get(c); if(!byName){ byName=new Map(); this.mcache.set(c,byName); }
  let hit=byName.get(name); if(!hit){ hit=this.methodsOf0(c,name); byName.set(name,hit); }
  return hit;
};
JVM.prototype.methodsOf0=function(c,name){
  const out=[], seen=new Set(), st=[c];
  while(st.length){ const k=st.shift(); if(!k||seen.has(k)) continue; seen.add(k);
    const l=k.methods&&k.methods.get(name);
    // an override hides its super's method of the same signature; other overloads stay
    if(l) for(const m of l){ const sig=jvSig(m); if(!out.some(o=>o.body&&jvSig(o)===sig)) { const ni=this.ni(m); if(!ni.owner) ni.owner=k; out.push(m); } }
    st.push(this.supOf(k)); for(const f of this.ifsOf(k)) st.push(f); }
  // a concrete one before an abstract one with the same arity
  return out.sort((a,b)=>(a.body?0:1)-(b.body?0:1));
};
/* This VM's notes on a parsed node (see nodeInfo) */
JVM.prototype.ni=function(n){ let r=this.nodeInfo.get(n); if(!r){ r={}; this.nodeInfo.set(n,r); } return r; };
JVM.prototype.ownerOf=function(m){ const r=this.nodeInfo.get(m); return r?r.owner:undefined; };
function jvSig(m){ return m.sig||(m.sig=m.params.map(p=>p.type.name.replace(/^.*\./,"")+"[]".repeat(p.type.dims||0)).join(",")); }
JVM.prototype.findMethod=function(c,name,args){
  const own=this.methodsOf(c,name);
  const m=this.pickMethod(own.filter(x=>x.body),args)||this.pickMethod(own,args);
  return m;
};
JVM.prototype.nativeMethod=function(c,name){
  for(let k=c, g=0; k&&g<30; k=this.supOf(k), g++){
    if(k.native&&k.native.m&&Object.prototype.hasOwnProperty.call(k.native.m,name)) return k.native.m[name];
    for(const f of this.ifsOf(k)) if(f.native&&f.native.m&&Object.prototype.hasOwnProperty.call(f.native.m,name)) return f.native.m[name];
  }
  return null;
};
JVM.prototype.isLib=function(c){ for(let k=c;k;k=k.outer) if(k.decl&&k.decl.lib) return true; return false; };
JVM.prototype.isBuilder=function(c){ for(let k=c;k;k=this.supOf(k)) if(this.builders.has(k.fqn)) return true; return false; };
JVM.prototype.hasNativeBase=function(c){ for(let k=c;k;k=this.supOf(k)) if(k.native||k.opaque) return k; return null; };

/* Call a method on a receiver. */
JVM.prototype.invoke=function*(self,name,args,node,startCls){
  if(self===null||self===undefined) throw this.jthrow("NullPointerException","called "+name+"() on null"+jvWhere(node));
  if(self instanceof JvFn) return yield* this.callFn(self,args,name);
  if(typeof self==="string") return jvStringMethod(this,self,name,args);
  if(typeof self==="number"||typeof self==="boolean") return jvBoxMethod(self,name,args,node);
  if(Array.isArray(self)){ if(name==="clone") return self.slice(); if(name==="length") return self.length; if(name==="getClass") return {__c:this.opaqueClass("Class"),f:{},n:{name:"Array"}}; return this.opaqueVal("array"); }
  if(self.__type) return yield* this.invokeStatic(self.__type,name,args,node);
  const c=self.__c;
  if(self[JV_OPAQUE_TAG]||c.opaque){ this.note(c.name+"."+name); return jvOpaqueResult(this,name,c.name,args); }
  const m=this.findMethod(startCls||c,name,args);
  if(m&&m.body) return yield* this.run(m,self,args,this.ownerOf(m));
  const nm=this.nativeMethod(startCls||c,name);
  if(nm){ const r=nm(this,self,args,node); return (r&&typeof r.next==="function"&&typeof r[Symbol.iterator]==="function")?yield* r:r; }
  // Object's methods, and enum constants'
  const om=yield* this.objectMethod(self,name,args,node);
  if(om!==JV_NONE) return om;
  // a library builder: any setter records its value and hands the object back
  for(let k=startCls||c, g=0; k&&g<30; k=this.supOf(k), g++) if(k.native&&k.native.any){ const r=k.native.any(this,self,name,args,node); return (r&&typeof r.next==="function"&&typeof r[Symbol.iterator]==="function")?yield* r:r; }
  if(m&&!m.body){ throw this.jthrow("AbstractMethodError",c.name+"."+name+"() has no body"+jvWhere(node)); }
  // a library builder written in Java: a setter it doesn't spell out still chains
  if(this.builders&&this.isBuilder(c)){ this.note(c.name+"."+name); return self; }
  // the library classes here are partial: a member they don't spell out is a stub
  if(this.isLib(c)){ this.note(c.name+"."+name); return jvOpaqueResult(this,name,c.name,args); }
  // a class that extends a library type nobody describes: its methods are stubs
  if(this.hasNativeBase(c)){ this.note(c.name+"."+name); return jvOpaqueResult(this,name,c.name,args); }
  throw this.jthrow("NoSuchMethodError",c.name+" has no method "+name+"("+args.length+" args)"+jvWhere(node));
};
const JV_NONE={};
JVM.prototype.objectMethod=function*(self,name,args,node){
  const c=self.__c;
  switch(name){
    case "equals": if(args.length===1) return jvEq(self,args[0]); break;
    case "hashCode": if(!args.length) return jvHash(self); break;
    case "getClass": if(!args.length) return {__type:c,classLit:true}; break;
    case "toString": if(!args.length) return self.__en!==undefined?self.__en:c.name+"@"+(jvHash(self)>>>0).toString(16); break;
    case "name": if(self.__en!==undefined&&!args.length) return self.__en; break;
    case "ordinal": if(self.__en!==undefined&&!args.length) return self.__eo; break;
    case "compareTo": if(self.__en!==undefined&&args.length===1) return self.__eo-(args[0]?args[0].__eo:0); break;
    case "getDeclaringClass": if(self.__en!==undefined) return {__type:c}; break;
    case "getMessage": case "getLocalizedMessage": if(self.n&&self.n.isThrowable) return self.n.msg; break;
    case "printStackTrace": return undefined;
    case "notify": case "notifyAll": case "wait": return undefined;
    case "clone": return Object.assign({},self,{f:Object.assign(Object.create(null),self.f)});
  }
  void node;
  return JV_NONE;
};
JVM.prototype.invokeStatic=function*(c,name,args,node){
  if(c.opaque){ this.note(c.name+"."+name); return jvOpaqueResult(this,name,c.name,args); }
  yield* this.ready(c);
  if(c.native){
    const sm=c.native.s&&c.native.s[name];
    if(sm){ const r=sm(this,args,node); return (r&&typeof r.next==="function"&&typeof r[Symbol.iterator]==="function")?yield* r:r; }
    if(c.kind==="enum"){ if(name==="values") return c.consts.slice(); if(name==="valueOf") return c.sf[args[args.length-1]]||null; }
    const s=this.supOf(c); if(s) return yield* this.invokeStatic(s,name,args,node);
    this.note(c.name+"."+name); return jvOpaqueResult(this,name,c.name,args);
  }
  const m=this.findMethod(c,name,args);
  if(m&&m.body) return yield* this.run(m,null,args,this.ownerOf(m));
  if(c.kind==="enum"){ if(name==="values") return c.consts.slice(); if(name==="valueOf") return c.sf[args[args.length-1]]||null; }
  const s=this.supOf(c); if(s&&(s.native||s.opaque)) return yield* this.invokeStatic(s,name,args,node);
  if(this.isLib(c)){ this.note(c.name+"."+name); return jvOpaqueResult(this,name,c.name,args); }
  throw this.jthrow("NoSuchMethodError",c.name+" has no static method "+name+jvWhere(node));
};
/* Run a method body. */
JVM.prototype.run=function*(m,self,args,owner){
  const sc=new JvScope(self&&self.__cap?self.__cap:null,{self,cls:owner||(self&&self.__c),meth:m});
  this.bindParams(m.params,args,sc);
  this.depth=(this.depth||0)+1;
  if(this.depth>400){ this.depth=0; throw this.jthrow("StackOverflowError","calls nested too deep in "+m.name+"()"); }
  const prevCls=this.curCls, prevM=this.curMeth; this.curCls=owner||(self&&self.__c)||prevCls; this.curMeth=m.name;
  try{
    const r=yield* this.exBlock(m.body.body,sc);
    if(r&&r.s===JV_RET) return m.ret?jvCoerce(r.v,m.ret):r.v;
    return undefined;
  } catch(e){ if(e&&typeof e==="object"&&!e.__where) e.__where=this.where(); throw e; }
  finally { this.depth--; this.curCls=prevCls; this.curMeth=prevM; }
};
/* Where the VM is: file and line, for a crash report */
JVM.prototype.where=function(){
  const u=this.curCls&&this.unitOf(this.curCls);
  return {file:u?u.file:null,pos:this.at,cls:this.curCls&&this.curCls.name,meth:this.curMeth};
};
/* A lambda, a method reference or a native function value. */
JVM.prototype.callFn=function*(fn,args,name){
  if(fn.native){ const r=fn.native(this,args,name); return (r&&typeof r.next==="function"&&typeof r[Symbol.iterator]==="function")?yield* r:r; }
  // a functional interface's default methods: andThen, negate…
  if(name==="negate"&&!args.length) return new JvFn(null,null,null,null,null,this,function*(vm,a){ return !(yield* vm.callFn(fn,a)); });
  if(name==="andThen"&&args.length===1){ const g=args[0]; return new JvFn(null,null,null,null,null,this,function*(vm,a){ const r=yield* vm.callFn(fn,a); if(g instanceof JvFn) return r===undefined?yield* vm.callFn(g,a):yield* vm.callFn(g,[r]); return r; }); }
  if(name==="equals") return fn===args[0];
  if(name==="hashCode") return 7;
  const sc=new JvScope(fn.scope,{self:fn.self,cls:fn.cls});
  for(let k=0;k<fn.params.length;k++){ sc.v[fn.params[k]]=args[k]===undefined?null:args[k]; }
  if(fn.body.k==="block"){
    const r=yield* this.exBlock(fn.body.body,sc);
    return r&&r.s===JV_RET?r.v:undefined;
  }
  return yield* this.ev(fn.body,sc);
};
/* Exceptions the VM raises, as Java objects a catch can match. */
JVM.prototype.jthrow=function(cls,msg){
  const c=this.classes.get("java.lang."+cls)||this.opaqueClass(cls);
  const o={__c:c,f:Object.create(null),n:{isThrowable:true,msg:msg||null}};
  return new JvThrow(o);
};
function jvWhere(node){ return node&&node.p!=null?" @"+node.p:""; }

/* ---------------- statements ---------------- */
JVM.prototype.exBlock=function*(list,sc){
  for(let k=0;k<list.length;k++){
    const r=yield* this.ex(list[k],sc);
    if(r) return r;
  }
  return null;
};
JVM.prototype.tickCheck=function*(node){
  // a loop with no gate in it (a busy-wait on isBusy(), say) still lets time pass
  if(--this.budget<0){ this.budget=this.BUDGET; yield {gate:true,forced:true,at:node&&node.p}; }
};
JVM.prototype.ex=function*(st,sc){
  this.at=st.p; this.steps++;
  switch(st.k){
    case "expr": yield* this.ev(st.e,sc); return null;
    case "local":
      for(const d of st.decls){
        const t={name:st.type.name,dims:d.dims};
        const v=d.init?(d.init.k==="arrinit"?yield* this.arrInit(d.init,t,sc):yield* this.ev(d.init,sc)):jvDefault(t);
        sc.v[d.name]=jvCoerce(v,t); sc.t[d.name]=t;
      }
      return null;
    case "block": return yield* this.exBlock(st.body,new JvScope(sc));
    case "if":
      if(jvTruth(yield* this.ev(st.c,sc))) return yield* this.ex(st.th,new JvScope(sc));
      if(st.el) return yield* this.ex(st.el,new JvScope(sc));
      return null;
    case "while":
      while(jvTruth(yield* this.ev(st.c,sc))){
        const r=yield* this.ex(st.body,new JvScope(sc));
        if(r){ if(r.s===JV_BRK&&(!r.l||r.l===st.label)) break; if(r.s===JV_CONT&&(!r.l||r.l===st.label)){ yield* this.tickCheck(st); continue; } return r; }
        yield* this.tickCheck(st);
      }
      return null;
    case "do":
      do{
        const r=yield* this.ex(st.body,new JvScope(sc));
        if(r){ if(r.s===JV_BRK&&(!r.l||r.l===st.label)) break; if(r.s===JV_CONT&&(!r.l||r.l===st.label)){ yield* this.tickCheck(st); continue; } return r; }
        yield* this.tickCheck(st);
      }while(jvTruth(yield* this.ev(st.c,sc)));
      return null;
    case "for":{
      const fs=new JvScope(sc);
      for(const x of st.init) yield* this.ex(x,fs);
      for(;;){
        if(st.c&&!jvTruth(yield* this.ev(st.c,fs))) break;
        const r=yield* this.ex(st.body,new JvScope(fs));
        if(r){ if(r.s===JV_BRK&&(!r.l||r.l===st.label)) break; if(!(r.s===JV_CONT&&(!r.l||r.l===st.label))) return r; }
        for(const u of st.upd) yield* this.ev(u,fs);
        yield* this.tickCheck(st);
      }
      return null;
    }
    case "foreach":{
      const it=yield* this.ev(st.it,sc);
      const items=yield* this.iterate(it,st);
      for(const v of items){
        const bs=new JvScope(sc); bs.v[st.name]=jvCoerce(v,st.type); bs.t[st.name]=st.type;
        const r=yield* this.ex(st.body,bs);
        if(r){ if(r.s===JV_BRK&&(!r.l||r.l===st.label)) break; if(!(r.s===JV_CONT&&(!r.l||r.l===st.label))) return r; }
        yield* this.tickCheck(st);
      }
      return null;
    }
    case "label":{
      st.body.label=st.label;
      const r=yield* this.ex(st.body,sc);
      if(r&&r.s===JV_BRK&&r.l===st.label) return null;
      return r;
    }
    case "switch":{
      const r=yield* this.switchRun(st,sc,false);
      if(r&&r.s===JV_BRK&&!r.l) return null;
      return r;
    }
    case "return": return {s:JV_RET,v:st.e?yield* this.ev(st.e,sc):undefined};
    case "break": return {s:JV_BRK,l:st.label};
    case "continue": return {s:JV_CONT,l:st.label};
    case "yield": return {s:JV_YIELD,v:yield* this.ev(st.e,sc)};
    case "throw":{ const v=yield* this.ev(st.e,sc); if(v===null) throw this.jthrow("NullPointerException","threw null"); throw new JvThrow(v); }
    case "try":{
      const ts=new JvScope(sc);
      let out=null, pending=null;
      try{
        for(const r of st.res) yield* this.ex(r,ts);
        out=yield* this.exBlock(st.body.body,new JvScope(ts));
      }catch(e){
        const jt=e instanceof JvThrow?e:(e&&e.jvStop?null:this.wrapJs(e));
        if(!jt) throw e;                                     // stopping the OpMode isn't an exception it can catch
        const cat=st.catches.find(c=>c.types.some(t=>this.catches(jt.value,t,st)));
        if(!cat) pending=jt;
        else {
          const cs=new JvScope(sc); cs.v[cat.name]=jt.value;
          try{ out=yield* this.exBlock(cat.body.body,cs); }
          catch(e2){ pending=e2; }
        }
      }
      if(st.fin){ const r=yield* this.exBlock(st.fin.body,new JvScope(sc)); if(r) return r; }
      for(const r of st.res) if(r.k==="local") for(const d of r.decls){ const v=ts.v[d.name]; if(jvIsObj(v)) try{ yield* this.invoke(v,"close",[],st); }catch(e){} }
      if(pending) throw pending;
      return out;
    }
    case "localclass":{
      const c=this.declare(st.decl,sc.fr&&sc.fr.cls?sc.fr.cls.unit:{pkg:"",imports:[],types:[]},sc.fr&&sc.fr.cls);
      c.isStatic=!(sc.fr&&sc.fr.self); c.capture=sc;
      sc.v["\u0000class:"+st.decl.name]=c;
      return null;
    }
    case "empty": return null;
  }
  throw JvError("statement "+st.k+" isn't supported",st.p);
};
/* A JS error inside the VM, seen by the team's catch as a Java exception. */
JVM.prototype.wrapJs=function(e){
  if(e instanceof JvThrow) return e;
  const m=String(e&&e.message||e);
  return this.jthrow(/null|undefined/.test(m)?"NullPointerException":"RuntimeException",m);
};
JVM.prototype.catches=function(val,tname,st){
  const n=tname.replace(/^.*\./,"");
  if(n==="Throwable") return true;
  const vc=val&&val.__c;
  if(!vc) return n==="Exception";
  if(n==="Exception") return !/Error$/.test(vc.name)||vc.name==="AssertionError"&&false;
  if(n==="RuntimeException"&&/^(NullPointer|Arithmetic|IndexOutOfBounds|ArrayIndexOutOfBounds|IllegalArgument|IllegalState|ClassCast|NumberFormat|UnsupportedOperation|Runtime)Exception$/.test(vc.name)) return true;
  if(vc.name===n) return true;
  const t=this.findType(tname,st&&this.ctxCls);
  return t?this.isSub(vc,t):this.isSubName(vc,n);
};
JVM.prototype.iterate=function*(v,node){
  if(v===null||v===undefined) throw this.jthrow("NullPointerException","for-each over null"+jvWhere(node));
  if(Array.isArray(v)) return v.slice();
  if(typeof v==="string") return v.split("").map(ch=>ch.charCodeAt(0));
  if(v.n&&v.n.items) return v.n.items.slice();
  if(v.n&&v.n.map) return Array.from(v.n.map.keys());
  if(v[JV_OPAQUE_TAG]) return [];
  if(jvIsObj(v)){
    const it=yield* this.invoke(v,"iterator",[],node);
    if(it&&it.n&&it.n.items) return it.n.items.slice(it.n.i||0);
    const out=[];
    for(let g=0;g<100000&&jvTruth(yield* this.invoke(it,"hasNext",[],node));g++) out.push(yield* this.invoke(it,"next",[],node));
    return out;
  }
  return [];
};
JVM.prototype.switchRun=function*(st,sc,isExpr){
  const d=yield* this.ev(st.disc,sc);
  let start=-1, dflt=-1;
  for(let k=0;k<st.cases.length&&start<0;k++){
    const cs=st.cases[k];
    if(!cs.labels){ dflt=k; continue; }
    for(const L of cs.labels){
      if(L.k==="default"){ dflt=k; continue; }
      if(L.k==="pattern"){ if(jvIsObj(d)&&this.isSubName(d.__c,L.type)){ start=k; sc=new JvScope(sc); sc.v[L.name]=d; break; } continue; }
      // a bare enum constant name
      if(L.k==="name"&&d&&d.__en!==undefined){ if(d.__en===L.name){ start=k; break; } continue; }
      if(L.k==="field"&&d&&d.__en!==undefined){ if(d.__en===L.name){ start=k; break; } continue; }
      const v=yield* this.ev(L,sc);
      if(jvEq(d,v)){ start=k; break; }
    }
  }
  if(start<0) start=dflt;
  if(start<0){ return isExpr?{s:JV_YIELD,v:null}:null; }
  const ss=new JvScope(sc);
  for(let k=start;k<st.cases.length;k++){
    const cs=st.cases[k];
    const r=yield* this.exBlock(cs.body,ss);
    if(r) return r;
    if(cs.arrow) return null;            // no fall-through after ->
  }
  return null;
};

/* ---------------- expressions ---------------- */
function jvTruth(v){ return !!v&&!(v[JV_OPAQUE_TAG]); }
function jvNum(v){ if(typeof v==="number") return v; if(typeof v==="boolean") return v?1:0; if(v==null) return 0; if(typeof v==="string"){ const n=parseFloat(v); return isFinite(n)?n:0; } return 0; }
function jvEq(a,b){
  if(a===b) return true;
  if(typeof a==="number"&&typeof b==="number") return a===b;
  if(typeof a==="string"&&typeof b==="string") return a===b;
  if(a&&a[JV_OPAQUE_TAG]&&b==null) return false;
  return false;
}
function jvHash(o){ if(!o.__h) o.__h=(Math.random()*0x7fffffff)|0; return o.__h; }
/* Java's String.valueOf for a number: ints plain, doubles with a ".0" */
function jvNumStr(v,isInt){
  if(typeof v!=="number") return String(v);
  if(isInt||!isFinite(v)) return isFinite(v)?String(Math.trunc(v)):(isNaN(v)?"NaN":v>0?"Infinity":"-Infinity");
  if(Number.isInteger(v)&&Math.abs(v)<1e7) return v.toFixed(1);
  const a=Math.abs(v);
  if(a!==0&&(a<1e-3||a>=1e7)){ const s=v.toExponential(); const m=/^(-?[\d.]+)e([+-]\d+)$/.exec(s); if(m){ const man=m[1].indexOf(".")<0?m[1]+".0":m[1]; return man+"E"+(+m[2]); } }
  return String(v);
}
JVM.prototype.str=function*(v,kind){
  if(v===null||v===undefined) return "null";
  if(typeof v==="string") return v;
  if(typeof v==="number") return kind==="c"?String.fromCharCode(v):jvNumStr(v,kind==="i");
  if(typeof v==="boolean") return v?"true":"false";
  if(Array.isArray(v)) return "[array]";
  if(v instanceof JvFn) return "lambda";
  if(v.__type) return "class "+v.__type.name;
  if(v[JV_OPAQUE_TAG]) return "";
  const r=yield* this.invoke(v,"toString",[],null);
  return typeof r==="string"?r:String(r);
};
/* Is this expression an int in Java? (5/2 is 2, 5.0/2 is 2.5) */
JVM.prototype.kind=function(e,sc){
  switch(e.k){
    case "lit": return e.ty==="i"?"i":e.ty==="c"?"c":e.ty==="d"?"d":e.ty;
    case "paren": return this.kind(e.e,sc);
    case "cast": return JV_INTS.has(e.type.name)&&!e.type.dims?(e.type.name==="char"?"c":"i"):(e.type.name==="double"||e.type.name==="float"?"d":null);
    case "name":{ const s=sc.find(e.name); let t=s?s.t[e.name]:null;
      if(!s){ const fr=sc.fr; const c=fr&&fr.cls; t=c?this.fieldType(c,e.name):null; }
      return t&&!t.dims?(t.name==="char"?"c":JV_INTS.has(t.name)?"i":null):null; }
    case "field":{ if(e.name==="length") return "i"; const r=this.nodeInfo.get(e), t=r&&r.ftype; return t&&!t.dims?(JV_INTS.has(t.name)?"i":null):null; }
    case "call":{ const r=this.nodeInfo.get(e); return r&&r.rk||null; }
    case "un": return e.op==="!"?null:this.kind(e.a,sc);
    case "pre": case "post": return this.kind(e.a,sc);
    case "bin":{
      if(/^(==|!=|<|>|<=|>=|&&|\|\|)$/.test(e.op)) return null;
      const a=this.kind(e.a,sc), b=this.kind(e.b,sc);
      if(e.op==="+"&&(a==="s"||b==="s")) return "s";
      if(e.op==="<<"||e.op===">>"||e.op===">>>") return "i";
      return (a==="i"||a==="c")&&(b==="i"||b==="c")?"i":null;
    }
    case "cond": { const a=this.kind(e.a,sc), b=this.kind(e.b,sc); return a===b?a:null; }
    case "assign": return this.kind(e.t,sc);
  }
  return null;
};
JVM.prototype.fieldType=function(c,name){
  for(let k=c;k;k=this.supOf(k)){ if(k.ftypes&&k.ftypes[name]) return k.ftypes[name]; for(const f of this.ifsOf(k)) if(f.ftypes&&f.ftypes[name]) return f.ftypes[name]; }
  if(c.outer) return this.fieldType(c.outer,name);
  return null;
};

/* Where a name lives: a local, a field of this (or an outer this), a static. */
JVM.prototype.lookup=function(name,sc){
  const s=sc.find(name);
  if(s) return {k:"local",s};
  const fr=sc.fr;
  for(let self=fr&&fr.self, cls=fr&&fr.cls; cls; ){
    if(self&&self.f&&name in self.f) return {k:"field",o:self};
    if(self&&self.__cap){ const cs=self.__cap.find(name); if(cs) return {k:"local",s:cs}; }
    // statics of this class and its supers and interfaces
    for(let k=cls, g=0; k&&g<30; k=this.supOf(k), g++){
      if(k.decl&&!k.ready&&(k.sinits.some(f=>f.name===name)||(k.decl.kind==="enum"&&k.decl.consts.some(q=>q.name===name)))) return {k:"static",c:k};
      if(name in k.sf) return {k:"static",c:k};
      if(k.decl&&(k.sinits.some(f=>f.name===name)||(k.decl.kind==="enum"&&k.decl.consts.some(q=>q.name===name)))) return {k:"static",c:k};
      for(const f of this.ifsOf(k)){ if(f.decl&&f.sinits.some(q=>q.name===name)) return {k:"static",c:f}; if(name in f.sf) return {k:"static",c:f}; }
      if(self&&k.native&&k.native.get&&k.native.has&&k.native.has(name)) return {k:"nfield",o:self,c:k};
    }
    if(cls.capture){ const cs=cls.capture.find(name); if(cs) return {k:"local",s:cs}; }
    // out to the enclosing instance (inner classes) or class (static nested)
    const nextSelf=self&&self.__outer?self.__outer:(cls.isStatic?null:self&&self.__outer);
    if(self&&self.__outer){ self=self.__outer; cls=self.__c; continue; }
    self=null; cls=cls.outer; void nextSelf;
  }
  // static imports
  const u=fr&&fr.cls&&this.unitOf(fr.cls);
  if(u) for(const im of u.imports) if(im.static){
    if(im.star){ const c=this.findType(im.name,null); if(c&&(name in c.sf||(c.decl&&c.sinits.some(f=>f.name===name))||(c.native&&c.native.sf&&name in c.native.sf)||(c.native&&c.native.enumConsts&&c.native.enumConsts.indexOf(name)>=0)||(c.decl&&c.decl.kind==="enum"&&c.decl.consts.some(q=>q.name===name)))) return {k:"static",c}; }
    else if(im.name.endsWith("."+name)){ const c=this.findType(im.name.slice(0,im.name.length-name.length-1),null);
      // `import static a.B.Inner;` brings in a nested class, not a field
      if(c&&!(name in c.sf)&&!(c.decl&&c.sinits.some(f=>f.name===name))&&this.nestedOf(c,name)) continue;
      if(c) return {k:"static",c}; }
  }
  return null;
};
JVM.prototype.unitOf=function(c){ for(let k=c;k;k=k.outer) if(k.unit) return k.unit; return null; };
JVM.prototype.ctxType=function(sc){ return sc.fr&&sc.fr.cls||null; };
JVM.prototype.typeIn=function(name,sc){
  for(let s=sc;s;s=s.up){ const lc=s.v["\u0000class:"+name]; if(lc) return lc; }
  return this.findType(name,this.ctxType(sc));
};

JVM.prototype.ev=function*(e,sc){
  switch(e.k){
    case "lit": return e.v;
    case "paren": return yield* this.ev(e.e,sc);
    case "name":{
      const w=this.lookup(e.name,sc);
      if(w){
        if(w.k==="local") return w.s.v[e.name];
        if(w.k==="field") return w.o.f[e.name];
        if(w.k==="nfield") return w.c.native.get(this,w.o,e.name);
        yield* this.ready(w.c);
        if(e.name in w.c.sf) return w.c.sf[e.name];
        if(w.c.native&&w.c.native.sget){ const r=w.c.native.sget(this,e.name); if(r!==undefined) return r; }
        return null;
      }
      const c=this.typeIn(e.name,sc);
      if(c) return {__type:c};
      // a package name heading a qualified class name: com.foo.Bar
      if(/^[a-z]/.test(e.name)) return {__pkg:e.name};
      this.note("?"+e.name);
      return this.opaqueVal(e.name);
    }
    case "this":{
      let self=sc.fr&&sc.fr.self;
      if(e.qual){ const q=e.qual.replace(/^.*\./,""); while(self&&!(self.__c.name===q||this.isSubName(self.__c,q))) self=self.__outer; }
      return self||null;
    }
    case "field":{
      // qualified names: com.foo.Bar.X, Outer.Inner.CONST
      const o=yield* this.ev(e.obj,sc);
      return yield* this.getField(o,e.name,e,sc);
    }
    case "index":{
      const a=yield* this.ev(e.a,sc), ix=jvNum(yield* this.ev(e.i,sc));
      if(a===null||a===undefined) throw this.jthrow("NullPointerException","indexing null"+jvWhere(e));
      if(Array.isArray(a)){ if(ix<0||ix>=a.length||!Number.isInteger(ix)) throw this.jthrow("ArrayIndexOutOfBoundsException","Index "+ix+" out of bounds for length "+a.length); return a[ix]; }
      return this.opaqueVal("array");
    }
    case "call": return yield* this.call(e,sc);
    case "new":{
      let c;
      let outerSelf=null;
      if(e.outer){ outerSelf=yield* this.ev(e.outer,sc); c=outerSelf&&outerSelf.__c?this.nestedOf(outerSelf.__c,e.type):null; }
      else c=this.typeIn(e.type,sc);
      const args=[]; for(const a of e.args) args.push(yield* this.ev(a,sc));
      if(!c){ if(e.body) c=this.opaqueClass(e.type); else { this.note("new "+e.type); return this.opaqueVal(e.type); } }
      if(e.body){
        // an anonymous class: extends c, or implements it when c is an interface
        const ac=this.ni(e).anonCls||null;
        let cls=ac;
        if(!cls){
          const ctx=this.ctxType(sc);
          cls=this.declare(Object.assign({},e.body,{name:(ctx?ctx.name:"")+"$anon"}),ctx?this.unitOf(ctx):{pkg:"",imports:[],types:[]},ctx);
          cls.isStatic=false; cls.anonOf=c;
          if(c.kind==="interface"&&!c.opaque){ cls.sup=null; cls.ifs=[c]; } else { cls.sup=c; cls.ifs=[]; }
          cls.decl.anon=true;
          this.ni(e).anonCls=cls;
        }
        const self=sc.fr&&sc.fr.self;
        return yield* this.construct(cls,args,self,sc,null,e);
      }
      if(c.kind==="interface"&&c.native&&!c.native.ctor) return this.opaqueVal(c.fqn);
      if(!c.isStatic&&!outerSelf){ outerSelf=sc.fr&&sc.fr.self; }
      const cap=c.capture||null;
      return yield* this.construct(c,args,c.isStatic?null:outerSelf,cap,null,e);
    }
    case "newarr":{
      if(e.init) return yield* this.arrInit(e.init,{name:e.type,dims:e.dims.length+e.extra},sc);
      const dims=[]; for(const d of e.dims) dims.push(Math.trunc(jvNum(yield* this.ev(d,sc))));
      const leaf=e.extra?null:jvDefault({name:e.type,dims:0});
      const mk=k=>{ const n=dims[k]; if(n<0) throw this.jthrow("NegativeArraySizeException",String(n)); const a=new Array(n); for(let q=0;q<n;q++) a[q]=k+1<dims.length?mk(k+1):leaf; return a; };
      return mk(0);
    }
    case "arrinit": return yield* this.arrInit(e,null,sc);
    case "classlit":{ const c=this.typeIn(e.type,sc); return c?{__type:c,classLit:true}:{__type:this.opaqueClass(e.type),classLit:true}; }
    case "un":{
      const v=yield* this.ev(e.a,sc);
      switch(e.op){ case "-": return -jvNum(v); case "+": return jvNum(v); case "!": return !jvTruth(v); case "~": return ~jvNum(v); }
      break;
    }
    case "pre": case "post":{
      const old=jvNum(yield* this.ev(e.a,sc));
      const nv=e.op==="++"?old+1:old-1;
      yield* this.store(e.a,nv,sc);
      return e.k==="pre"?nv:old;
    }
    case "bin": return yield* this.binop(e,sc);
    case "cond": return jvTruth(yield* this.ev(e.c,sc))?yield* this.ev(e.a,sc):yield* this.ev(e.b,sc);
    case "assign":{
      if(e.op==="="){ const v=yield* this.ev(e.v,sc); return yield* this.store(e.t,v,sc); }
      const cur=yield* this.ev(e.t,sc), v=yield* this.ev(e.v,sc);
      const op=e.op.slice(0,-1);
      let r;
      if(op==="+"&&(typeof cur==="string"||typeof v==="string")) r=(yield* this.str(cur,this.kind(e.t,sc)))+(yield* this.str(v,this.kind(e.v,sc)));
      else r=this.arith(op,cur,v,this.kind(e.t,sc)==="i"&&this.kind(e.v,sc)==="i",e);
      return yield* this.store(e.t,r,sc);
    }
    case "cast":{
      const v=yield* this.ev(e.a,sc), n=e.type.name;
      if(e.type.dims) return v;
      if(n==="int"||n==="long"||n==="short"||n==="byte") return v&&v[JV_OPAQUE_TAG]?0:jvToInt(jvNum(v),n);
      if(n==="char") return Math.trunc(jvNum(v))&0xffff;
      if(n==="double"||n==="float") return v&&v[JV_OPAQUE_TAG]?0:jvNum(v);
      if((n==="Integer"||n==="Double"||n==="Long")&&typeof v==="number") return v;
      return v;
    }
    case "instanceof":{
      const v=yield* this.ev(e.a,sc);
      const ok=this.instOf(v,e.type.name,sc);
      if(ok&&e.bind){ sc.v[e.bind]=v; }
      return ok;
    }
    case "lambda": return new JvFn(e.ps,e.body,sc,sc.fr&&sc.fr.self,sc.fr&&sc.fr.cls,this);
    case "mref": return yield* this.methodRef(e,sc);
    case "switchx":{
      const r=yield* this.switchRun(e,sc,true);
      return r&&r.s===JV_YIELD?r.v:(r&&r.s===JV_RET?r.v:null);
    }
    case "ctorcall": return undefined;      // handled by runCtor
    case "super": return sc.fr&&sc.fr.self;
  }
  throw JvError("expression "+e.k+" isn't supported",e.p);
};
function jvToInt(v,n){
  if(!isFinite(v)) return isNaN(v)?0:(v>0?(n==="long"?9.2e18:2147483647):(n==="long"?-9.2e18:-2147483648));
  const t=Math.trunc(v);
  if(n==="int"){ if(t>2147483647) return 2147483647; if(t<-2147483648) return -2147483648; }
  if(n==="short") return (t<<16)>>16;
  if(n==="byte") return (t<<24)>>24;
  return t;
}
JVM.prototype.instOf=function(v,tname,sc){
  if(v===null||v===undefined) return false;
  const n=tname.replace(/^.*\./,"");
  if(n==="Object") return true;
  if(typeof v==="string") return n==="String"||n==="CharSequence"||n==="Comparable";
  if(typeof v==="number") return /^(Number|Double|Integer|Float|Long|Short|Byte|Comparable)$/.test(n);
  if(typeof v==="boolean") return n==="Boolean";
  if(Array.isArray(v)) return false;
  if(v instanceof JvFn){ const t=this.typeIn(tname,sc); return JV_FUNC_IFACE.test(n)||!!(t&&this.isFunctional(t)); }
  if(!v.__c) return false;
  const t=this.typeIn(tname,sc);
  return t?this.isSub(v.__c,t)||this.isSubName(v.__c,n):this.isSubName(v.__c,n);
};
JVM.prototype.arith=function(op,a,b,ints,node){
  const x=jvNum(a), y=jvNum(b);
  switch(op){
    case "+": return ints?jvToInt(x+y,"long"):x+y;
    case "-": return ints?jvToInt(x-y,"long"):x-y;
    case "*": return ints?jvToInt(x*y,"long"):x*y;
    case "/": if(ints){ if(y===0) throw this.jthrow("ArithmeticException","/ by zero"+jvWhere(node)); return Math.trunc(x/y); } return x/y;
    case "%": if(ints&&y===0) throw this.jthrow("ArithmeticException","% by zero"+jvWhere(node)); return x%y;
    case "&": return typeof a==="boolean"?(a&&b):(x&y);
    case "|": return typeof a==="boolean"?(a||b):(x|y);
    case "^": return typeof a==="boolean"?(a!==b):(x^y);
    case "<<": return x<<y;
    case ">>": return x>>y;
    case ">>>": return x>>>y;
  }
  return 0;
};
JVM.prototype.binop=function*(e,sc){
  if(e.op==="&&") return jvTruth(yield* this.ev(e.a,sc))&&jvTruth(yield* this.ev(e.b,sc));
  if(e.op==="||") return jvTruth(yield* this.ev(e.a,sc))||jvTruth(yield* this.ev(e.b,sc));
  const a=yield* this.ev(e.a,sc), b=yield* this.ev(e.b,sc);
  switch(e.op){
    case "==": return jvEq(a,b)||(a&&b&&a.__type&&b.__type&&a.__type===b.__type);
    case "!=": return !(jvEq(a,b)||(a&&b&&a.__type&&b.__type&&a.__type===b.__type));
    case "<": return jvNum(a)<jvNum(b);
    case ">": return jvNum(a)>jvNum(b);
    case "<=": return jvNum(a)<=jvNum(b);
    case ">=": return jvNum(a)>=jvNum(b);
    case "+":
      if(typeof a==="string"||typeof b==="string") return (yield* this.str(a,this.kind(e.a,sc)))+(yield* this.str(b,this.kind(e.b,sc)));
      break;
  }
  const ka=this.kind(e.a,sc), kb=this.kind(e.b,sc);
  return this.arith(e.op,a,b,(ka==="i"||ka==="c")&&(kb==="i"||kb==="c"),e);
};
JVM.prototype.store=function*(t,v,sc){
  if(t.k==="paren") return yield* this.store(t.e,v,sc);
  if(t.k==="name"){
    const w=this.lookup(t.name,sc);
    if(!w){ sc.v[t.name]=v; return v; }       // shouldn't happen in Java; keep running
    if(w.k==="local"){ const ty=w.s.t[t.name]; const cv=jvCoerce(v,ty); w.s.v[t.name]=cv; return cv; }
    if(w.k==="field"){ const ty=this.fieldType(w.o.__c,t.name); const cv=jvCoerce(v,ty); w.o.f[t.name]=cv; return cv; }
    if(w.k==="nfield"){ if(w.c.native.set) w.c.native.set(this,w.o,t.name,v); return v; }
    yield* this.ready(w.c);
    const ty=w.c.decl?(w.c.ftypes[t.name]||null):null; const cv=jvCoerce(v,ty); w.c.sf[t.name]=cv; return cv;
  }
  if(t.k==="field"){
    const o=yield* this.ev(t.obj,sc);
    if(o===null||o===undefined) throw this.jthrow("NullPointerException","set ."+t.name+" on null"+jvWhere(t));
    if(o.__type){ const c=o.__type; yield* this.ready(c); const ty=c.ftypes[t.name]||null; const cv=jvCoerce(v,ty);
      if(c.native&&c.native.sset){ c.native.sset(this,t.name,cv); return cv; }
      // the static may live on a superclass or interface
      for(let k=c;k;k=this.supOf(k)) if(t.name in k.sf){ k.sf[t.name]=cv; return cv; }
      c.sf[t.name]=cv; return cv; }
    if(o[JV_OPAQUE_TAG]) return v;
    if(jvIsObj(o)){
      if(t.name in o.f){ const ty=this.fieldType(o.__c,t.name); const cv=jvCoerce(v,ty); o.f[t.name]=cv; return cv; }
      for(let k=o.__c;k;k=this.supOf(k)) if(k.native&&k.native.set){ k.native.set(this,o,t.name,v); return v; }
      o.f[t.name]=v; return v;
    }
    return v;
  }
  if(t.k==="index"){
    const a=yield* this.ev(t.a,sc), ix=jvNum(yield* this.ev(t.i,sc));
    if(!Array.isArray(a)) { if(a==null) throw this.jthrow("NullPointerException","indexing null"); return v; }
    if(ix<0||ix>=a.length) throw this.jthrow("ArrayIndexOutOfBoundsException","Index "+ix+" out of bounds for length "+a.length);
    a[ix]=v; return v;
  }
  throw JvError("can't assign to "+t.k,t.p);
};
JVM.prototype.getField=function*(o,name,e,sc){
  if(o&&o.__pkg){ const q=o.__pkg+"."+name; const c=this.classes.get(q)||(/^[A-Z]/.test(name)?(this.findType(q,null)||(this.libLike(q)?this.opaqueClass(q):null)):null); return c?{__type:c}:{__pkg:q}; }
  if(o===null||o===undefined) throw this.jthrow("NullPointerException","read ."+name+" of null"+jvWhere(e));
  if(Array.isArray(o)){ if(name==="length") return o.length; return undefined; }
  if(o.__type){
    const c=o.__type;
    if(name==="class") return {__type:c,classLit:true};
    const n=this.nestedOf(c,name); if(n&&!(name in c.sf)) return {__type:n};
    yield* this.ready(c);
    for(let k=c, g=0; k&&g<30; k=this.supOf(k), g++){
      if(name in k.sf){ if(e) this.ni(e).ftype=k.ftypes&&k.ftypes[name]||null; return k.sf[name]; }
      if(k.native&&k.native.sget){ const r=k.native.sget(this,name); if(r!==undefined) return r; }
      for(const f of this.ifsOf(k)){ yield* this.ready(f); if(name in f.sf) return f.sf[name]; }
    }
    if(c.opaque){ this.note(c.name+"."+name); return this.opaqueVal(c.fqn+"."+name); }
    if(this.hasNativeBase(c)||this.isLib(c)){ this.note(c.name+"."+name); return this.opaqueVal(c.fqn+"."+name); }
    throw this.jthrow("NoSuchFieldError",c.name+"."+name+jvWhere(e));
  }
  if(typeof o==="string"||typeof o==="number"||typeof o==="boolean") return undefined;
  if(o[JV_OPAQUE_TAG]) return this.opaqueVal(o.__c.fqn+"."+name);
  if(name in o.f){ if(e){ const ni=this.ni(e); if(!ni.ftype) ni.ftype=this.fieldType(o.__c,name); } return o.f[name]; }
  for(let k=o.__c;k;k=this.supOf(k)) if(k.native&&k.native.get){ const r=k.native.get(this,o,name); if(r!==undefined) return r; }
  // a static read through an instance
  for(let k=o.__c;k;k=this.supOf(k)) if(name in k.sf) return k.sf[name];
  if(this.hasNativeBase(o.__c)||this.isLib(o.__c)){ this.note(o.__c.name+"."+name); return this.opaqueVal(name); }
  return null;
};
JVM.prototype.methodRef=function*(e,sc){
  const vm=this;
  if(e.obj.k==="super"){ const self=sc.fr.self, sup=this.supOf(sc.fr.cls), nm=e.name; return new JvFn(null,null,null,null,null,this,function*(v,a){ return yield* v.invoke(self,nm,a,e,sup); }); }
  // Type::new, Type::staticMethod, Type::instanceMethod (first arg is the receiver)
  let tgt=null;
  if(e.obj.k==="name"&&!this.lookup(e.obj.name,sc)){ const c=this.typeIn(e.obj.name,sc); if(c) tgt={__type:c}; }
  if(!tgt) tgt=yield* this.ev(e.obj,sc);
  const nm=e.name;
  if(tgt&&tgt.__type){
    const c=tgt.__type;
    if(nm==="new") return new JvFn(null,null,null,null,null,this,function*(v,a){ return yield* v.construct(c,a,null,null,null,e); });
    return new JvFn(null,null,null,null,null,this,function*(v,a){
      const sm=c.decl?v.methodsOf(c,nm).filter(m=>m.static):[];
      if(sm.length||c.native&&c.native.s&&c.native.s[nm]) return yield* v.invokeStatic(c,nm,a,e);
      if(a.length) return yield* v.invoke(a[0],nm,a.slice(1),e);
      return yield* v.invokeStatic(c,nm,a,e);
    });
  }
  void vm;
  return new JvFn(null,null,null,null,null,this,function*(v,a){ return yield* v.invoke(tgt,nm,a,e); });
};

JVM.prototype.call=function*(e,sc){
  const args=[]; for(const a of e.args) args.push(yield* this.ev(a,sc));
  let r;
  if(e.obj===null){
    // an unqualified call: this class, its supers, enclosing classes, a local lambda never
    const fr=sc.fr;
    let self=fr&&fr.self, cls=fr&&fr.cls, done=false;
    for(let g=0; cls&&g<20&&!done; g++){
      const m=this.findMethod(cls,e.name,args);
      if(m&&m.body){
        if(m.static) r=yield* this.run(m,null,args,this.ownerOf(m));
        else if(self){ const vm2=self.__c!==cls?this.findMethod(self.__c,e.name,args):m; { const mm=vm2&&vm2.body?vm2:m; r=yield* this.run(mm,self,args,this.ownerOf(mm)); } }
        else r=yield* this.run(m,null,args,this.ownerOf(m));
        done=true; break;
      }
      if(self||!m){
        const nm=this.nativeMethod(cls,e.name);
        if(nm&&self&&this.isSub(self.__c,cls)){ const x=nm(this,self,args,e); r=(x&&typeof x.next==="function"&&typeof x[Symbol.iterator]==="function")?yield* x:x; done=true; break; }
        if(cls.native&&cls.native.s&&cls.native.s[e.name]){ r=yield* this.invokeStatic(cls,e.name,args,e); done=true; break; }
      }
      if(m&&!m.body&&self){ r=yield* this.invoke(self,e.name,args,e); done=true; break; }
      // a library base (an OpMode) that the VM doesn't describe: its methods are stubs
      if(self&&cls.opaque){ this.note(cls.name+"."+e.name); r=jvOpaqueResult(this,e.name,cls.name,args); done=true; break; }
      if(self&&self.__outer){ self=self.__outer; cls=self.__c; continue; }
      if(cls.capture&&cls.capture.fr){ self=cls.capture.fr.self; cls=cls.capture.fr.cls; continue; }
      self=cls.isStatic?null:self; cls=cls.outer;
      if(!cls){
        // a supers chain ended in a stub
        const base=fr&&fr.cls&&this.hasNativeBase(fr.cls);
        if(base&&base.opaque){ this.note(base.name+"."+e.name); r=jvOpaqueResult(this,e.name,base.name,args); done=true; }
      }
    }
    if(!done){
      for(let k=fr&&fr.cls;k&&!done;k=k.outer) if(k.kind==="enum"&&(e.name==="values"||e.name==="valueOf")){ r=yield* this.invokeStatic(k,e.name,args,e); done=true; }
      if(!done&&fr&&fr.self){ const om=yield* this.objectMethod(fr.self,e.name,args,e); if(om!==JV_NONE){ r=om; done=true; } }
    }
    if(!done){
      // static imports
      const u=fr&&fr.cls&&this.unitOf(fr.cls);
      if(u) for(const im of u.imports) if(im.static&&(im.star||im.name.endsWith("."+e.name))){
        const c=this.findType(im.star?im.name:im.name.slice(0,im.name.length-e.name.length-1),null);
        if(c&&(c.opaque||(c.native&&c.native.s&&c.native.s[e.name])||(c.decl&&this.methodsOf(c,e.name).length))){ r=yield* this.invokeStatic(c,e.name,args,e); done=true; break; }
      }
    }
    if(!done){
      // a lambda held in a local and called like a method can't happen in Java; report
      throw this.jthrow("NoSuchMethodError","no method "+e.name+"("+args.length+" args) here"+jvWhere(e));
    }
  } else if(e.obj.k==="super"){
    const self=sc.fr.self; let cls=sc.fr.cls;
    if(e.obj.qual){ const q=this.typeIn(e.obj.qual,sc); if(q&&q.kind==="interface"){ r=yield* this.invoke(self,e.name,args,e,q); this.setRk(e); return r; } }
    const sup=this.supOf(cls);
    if(!sup){ const om=yield* this.objectMethod(self,e.name,args,e); r=om===JV_NONE?undefined:om; }
    else r=yield* this.invoke(self,e.name,args,e,sup);
  } else {
    // a qualified name that is a type: Math.abs, Robot.init, com.foo.Bar.baz
    let o;
    if(e.obj.k==="name"&&!this.lookup(e.obj.name,sc)){ const c=this.typeIn(e.obj.name,sc); o=c?{__type:c}:yield* this.ev(e.obj,sc); }
    else o=yield* this.ev(e.obj,sc);
    if(o&&o.__pkg){ this.note(o.__pkg+"."+e.name); r=this.opaqueVal(o.__pkg+"."+e.name); }
    else if(o&&o.__type&&!o.classLit) r=yield* this.invokeStatic(o.__type,e.name,args,e);
    else if(o&&o.__type&&o.classLit) r=jvClassMethod(o.__type,e.name,args);
    else r=yield* this.invoke(o,e.name,args,e);
  }
  if(r&&r.__block){ const b=r.__block; yield b; r=r.then?r.then():undefined; }
  this.setRk(e,r);
  return r;
};
/* Remember whether a call returned an int, for the / that uses it */
JVM.prototype.setRk=function(e,r){
  const ni=this.ni(e);
  if(ni.rk!==undefined) return;
  ni.rk=(JV_INT_METHODS.has(e.name)&&typeof r==="number"&&Number.isInteger(r))?"i":null;
};
const JV_INT_METHODS=new Set(["getCurrentPosition","getTargetPosition","size","length","ordinal","indexOf","lastIndexOf","intValue","longValue","parseInt","parseLong",
  "round","getPortNumber","compareTo","floorDiv","floorMod","getTargetPositionTolerance","nextInt","hashCode","getAsInt","toIntExact","charAt","count","signum"]);
function jvClassMethod(c,name){
  if(name==="getSimpleName") return c.name;
  if(name==="getName"||name==="getCanonicalName"||name==="getTypeName") return c.fqn;
  if(name==="isInstance") return false;
  return null;
}
/* What a stub hands back: a number from a getter that sounds like one,
   false from a question, another stub for anything else. */
function jvOpaqueResult(vm,name,cls,args){
  if(/^(is|has|can|should|was|at)[A-Z]/.test(name)||/^(equals|contains|isEmpty)$/.test(name)) return false;
  if(/^(get[A-Z]\w*(Position|Power|Velocity|Voltage|Distance|Angle|Heading|X|Y|Value|Time|Seconds|Milliseconds|Current|Count)|getX|getY|getHeading|seconds|milliseconds|value|doubleValue|intValue|size|length)$/.test(name)) return 0;
  if(/^(toString|getName|name)$/.test(name)) return cls;
  void args;
  return vm.opaqueVal(cls+"."+name+"()");
}
/* ---- strings, boxed numbers ---- */
function jvStringMethod(vm,s,name,a){
  switch(name){
    case "length": return s.length;
    case "equals": return s===a[0];
    case "equalsIgnoreCase": return typeof a[0]==="string"&&s.toLowerCase()===a[0].toLowerCase();
    case "isEmpty": return !s.length;
    case "isBlank": return !s.trim().length;
    case "charAt": return s.charCodeAt(a[0])||0;
    case "contains": return s.indexOf(String(a[0]))>=0;
    case "startsWith": return s.startsWith(String(a[0]));
    case "endsWith": return s.endsWith(String(a[0]));
    case "indexOf": return typeof a[0]==="number"?s.indexOf(String.fromCharCode(a[0])):s.indexOf(String(a[0]),a[1]||0);
    case "lastIndexOf": return s.lastIndexOf(typeof a[0]==="number"?String.fromCharCode(a[0]):String(a[0]));
    case "substring": return s.substring(a[0],a.length>1?a[1]:undefined);
    case "toUpperCase": return s.toUpperCase();
    case "toLowerCase": return s.toLowerCase();
    case "trim": case "strip": return s.trim();
    case "replace": return s.split(typeof a[0]==="number"?String.fromCharCode(a[0]):String(a[0])).join(typeof a[1]==="number"?String.fromCharCode(a[1]):String(a[1]));
    case "replaceAll": try{ return s.replace(new RegExp(a[0],"g"),a[1]); }catch(e){ return s; }
    case "split": try{ return s.split(new RegExp(a[0])); }catch(e){ return [s]; }
    case "hashCode": { let h=0; for(let k=0;k<s.length;k++) h=(h*31+s.charCodeAt(k))|0; return h; }
    case "toString": case "intern": return s;
    case "compareTo": return s<a[0]?-1:s>a[0]?1:0;
    case "toCharArray": return s.split("").map(ch=>ch.charCodeAt(0));
    case "matches": try{ return new RegExp("^(?:"+a[0]+")$").test(s); }catch(e){ return false; }
    case "concat": return s+a[0];
    case "repeat": return s.repeat(Math.max(0,a[0]|0));
    case "format": case "formatted": return jvFormat(s,a);
  }
  vm.note("String."+name);
  return null;
}
function jvBoxMethod(v,name,a,node){
  switch(name){
    case "intValue": case "longValue": case "shortValue": case "byteValue": return Math.trunc(jvNum(v));
    case "doubleValue": case "floatValue": return jvNum(v);
    case "booleanValue": return !!v;
    case "equals": return v===a[0];
    case "compareTo": return v<a[0]?-1:v>a[0]?1:0;
    case "toString": return typeof v==="boolean"?String(v):jvNumStr(v,Number.isInteger(v));
    case "hashCode": return Math.trunc(jvNum(v));
    case "isNaN": return isNaN(v);
    case "isInfinite": return !isFinite(v)&&!isNaN(v);
  }
  void node;
  return 0;
}
/* String.format: %d %f %.2f %s %b %x %e %n %% */
function jvFormat(fmt,args){
  let k=0;
  return String(fmt).replace(/%([-#+ 0,(]*)(\d+)?(?:\.(\d+))?([a-zA-Z%])/g,(m,flags,w,prec,c)=>{
    if(c==="%") return "%"; if(c==="n") return "\n";
    let v=args[k++], s;
    switch(c.toLowerCase()){
      case "d": s=String(Math.trunc(jvNum(v))); if(flags.indexOf(",")>=0) s=s.replace(/\B(?=(\d{3})+(?!\d))/g,","); break;
      case "f": s=jvNum(v).toFixed(prec!=null?+prec:6); break;
      case "e": s=jvNum(v).toExponential(prec!=null?+prec:6); break;
      case "x": s=(Math.trunc(jvNum(v))>>>0).toString(16); break;
      case "b": s=String(!!v); break;
      case "c": s=typeof v==="number"?String.fromCharCode(v):String(v); break;
      default: s=v===null||v===undefined?"null":typeof v==="number"?jvNumStr(v,Number.isInteger(v)):(typeof v==="string"?v:(v&&v.__en)||String(v));
    }
    if(flags.indexOf("+")>=0&&/^[0-9]/.test(s)) s="+"+s;
    if(w&&s.length<+w) s=flags.indexOf("-")>=0?s+" ".repeat(+w-s.length):(flags.indexOf("0")>=0?s.replace(/^(-?)/,"$1"+"0".repeat(+w-s.length)):" ".repeat(+w-s.length)+s);
    if(c==="X"||c==="S") s=s.toUpperCase();
    return s;
  });
}
/* Run a generator to the end, gates and all: for work that must finish now */
function jvDrain(g,limit){ let r=g.next(), n=0; while(!r.done){ if(++n>(limit||1e6)) throw new Error("ran too long"); r=g.next(); } return r.value; }
