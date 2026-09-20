/* ============================================================
   5c. COMPARE TWO OPMODES
   Teams keep several versions of a TeleOp and lose track of what
   changed. Diff them the way a driver thinks: control by control.
   ============================================================ */
const CONTROL_ORDER=["a","b","x","y","left_bumper","right_bumper","left_trigger","right_trigger",
  "dpad_up","dpad_down","dpad_left","dpad_right","left_stick_button","right_stick_button",
  "back","start","options","guide","touchpad","left_stick_x","left_stick_y","right_stick_x","right_stick_y"];

function diffOpModes(A, B){
  /* Actions per control, as written — and a resolved key so that
     `claw.setPosition(CLAW_OPEN)` equals `claw.setPosition(0.2)` when it is. */
  const group=code=>{
    const g={};
    const resolve=expr=>{
      const t=String(expr).trim();
      if(code.consts[t]!==undefined) return String(+code.consts[t].toFixed(6));
      if(code.vars[t]!==undefined&&(code.config||[]).some(f=>f.name===t)) return t;
      if(/^-?\d*\.?\d+$/.test(t)) return String(+parseFloat(t).toFixed(6));
      return t.replace(/\s+/g,"");
    };
    for(const b of code.bindings){
      const k="gamepad"+b.pad+"."+b.btn;
      const text=b.assign? b.dev+" "+b.op+" "+b.expr : b.sleep? "sleep("+b.expr+")" : b.dev+"."+b.op+"("+b.expr+")";
      const key =b.assign? b.dev+b.op+resolve(b.expr) : b.sleep? "sleep"+resolve(b.expr) : b.dev+"."+b.op+"("+resolve(b.expr)+")";
      const list=(g[k]=g[k]||[]);
      if(!list.some(x=>x.key===key)) list.push({text,key});
    }
    return g;
  };
  const ga=group(A), gb=group(B);
  const rank=k=>{ const m=/^gamepad(\d)\.(\w+)$/.exec(k); const i=CONTROL_ORDER.indexOf(m?m[2]:"");
    return (m?+m[1]:9)*100+(i<0?99:i); };
  const keys=[...new Set([...Object.keys(ga),...Object.keys(gb)])].sort((x,y)=>rank(x)-rank(y));
  const controls=keys.map(k=>{
    const a=ga[k]||[], b=gb[k]||[];
    const same=a.length===b.length && a.every(x=>b.some(y=>y.key===x.key));
    return {control:k, a:a.map(x=>x.text), b:b.map(x=>x.text),
            status:!a.length?"added":!b.length?"removed":same?"same":"changed"};
  });

  const names=code=>new Set(code.devices.map(d=>d.name));
  const na=names(A), nb=names(B);
  const devices={added:[...nb].filter(x=>!na.has(x)), removed:[...na].filter(x=>!nb.has(x))};

  // class-level values only: constants and the fields FTC Dashboard would expose
  const values=code=>{
    const v={};
    for(const k in code.consts) v[k]=code.consts[k];
    for(const f of (code.config||[])) if(code.vars[f.name]!==undefined) v[f.name]=code.vars[f.name];
    return v;
  };
  const va=values(A), vb=values(B);
  const vals=[...new Set([...Object.keys(va),...Object.keys(vb)])].sort()
    .map(k=>({name:k, a:va[k], b:vb[k]}))
    .filter(r=>r.a!==r.b);

  const count=s=>controls.filter(c=>c.status===s).length;
  return {a:{opmode:A.opmode, cls:A.cls}, b:{opmode:B.opmode, cls:B.cls},
          controls, devices, values:vals,
          summary:{changed:count("changed"), added:count("added"), removed:count("removed"), same:count("same")}};
}
